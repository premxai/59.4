"""L0: the frozen AI operator running the grid with its operating manual (a sim Policy).

Each hour:
  1. read the situation (anonymized), update gauges (sensors) from the manual
  2. apply the manual's habits (rules)
  3. if an alarm is on, brief the frozen AI (readings + gauges + recalled manual pages) and take its decision
  4. enforce hard limits (guardrails)
  5. emit plain-language events for the Mission Control sidebar
"""
from __future__ import annotations

import math
import os

from sim.policies import Policy

from . import anonymize as A
from . import dsl, llm
from .memory import Manual
from .schema import Harness

CAUTION_FIELDS = ("shed_mw", "precommit", "conservation", "imports_mw", "dr_mw")   # take the more cautious value
CUSTOMERS_PER_MW = 225.0
from . import raindrop_bridge as RD  # noqa: E402
DETECTOR_ACTOR = "raindrop" if RD.enabled else "detector"   # say Raindrop only when events really go there
SYSTEM = (
    "You are the operator of an electric power grid during winter. When called, decide this hour's actions.\n"
    "Goals, in order: (1) never let the grid collapse: a total blackout lasts days; (2) keep as many homes powered "
    "as possible; (3) avoid unnecessary outages and bring homes back when it is safe.\n"
    "You only know what is in the briefing. Reply with ONLY a JSON object with these keys:\n"
    "shed_mw (target level of rolling outages in MW, 0 = none), restore_mw (MW of homes to bring back now), "
    "rotation_min (10-240, how long each neighborhood stays off), protect_gas (true keeps gas facilities off the outage "
    "list; needs the critical-load map), conservation (0-0.03 public appeal), imports_mw, dr_mw (ask big customers to cut "
    "use), battery_mw (+ discharge / - charge), precommit (0-1 share of idle gas plants to start now), rt_shed (true lets "
    "the real-time desk cut load within the hour if supply suddenly drops), all_clear (true if you judge the grid safe "
    "this hour), rationale (one plain-English sentence)."
)


def flatten(obs: dict) -> dict:
    v = {
        "reserve": obs["reserve_now"], "demand": obs["demand_now"], "supply": obs["supply_now"],
        "supply_trend": obs["supply_trend_1h"], "freq": obs["freq_min_last"], "shed": obs["shed_now"],
        "temp": obs["temp_now"], "hour": obs["local_hour"], "day": obs.get("day_index", obs["hour"] // 24),
        "battery_soc": obs.get("battery_soc_mwh", 0.0), "dr_left": obs.get("dr_energy_left_mwh", 0.0),
        "below_59_4_min": obs.get("below_59_4_min", 0),
    }
    v["reserve_margin"] = v["reserve"] / v["demand"] if v["demand"] else math.nan
    for r, t in obs["temps_now"].items():
        v[f"temp.{A.region(r)}"] = t
    for r, w in obs.get("wind_speed_now", {}).items():
        v[f"wind.{A.region(r)}"] = w
    for key, pre in (("avail_by_fuel", "avail"), ("capacity_by_fuel", "cap"), ("outages_by_fuel", "out")):
        for f, mw in (obs.get(key) or {}).items():
            v[f"{pre}.{A.fuel(f)}"] = mw
    try:
        fc = obs["forecast_temp_pw_72h"]
        v["fc_min_24"], v["fc_min_48"], v["fc_min_72"] = float(min(fc[:24])), float(min(fc[:48])), float(min(fc))
        for r, t in obs["forecast_min_temp_by_region_72h"].items():
            v[f"fc_min.{A.region(r)}"] = t
    except (KeyError, IndexError, ValueError):
        pass
    return v


def decision_text(a: dict) -> str:
    parts = []
    if (a.get("shed_mw") or 0) > 0:
        parts.append(f"rolling outages {a['shed_mw']:,.0f} MW (about {a['shed_mw'] * CUSTOMERS_PER_MW / 1e3:,.0f}k homes take turns)")
    if (a.get("restore_mw") or 0) > 0:
        parts.append(f"bring {a['restore_mw']:,.0f} MW of homes back")
    if a.get("protect_gas"):
        parts.append("keep gas facilities powered")
    if (a.get("precommit") or 0) > 0:
        parts.append("start extra power plants early")
    if (a.get("conservation") or 0) > 0:
        parts.append("ask the public to save power")
    if (a.get("dr_mw") or 0) > 0:
        parts.append("ask big customers to cut use")
    if (a.get("imports_mw") or 0) > 0:
        parts.append("import power from neighbors")
    if (a.get("battery_mw") or 0) > 0:
        parts.append("discharge batteries")
    if a.get("rt_shed"):
        parts.append("let the control room cut load fast if needed")
    return "; ".join(parts) if parts else "no action needed"


class HarnessPolicy(Policy):
    def __init__(self, harness: Harness, manual: Manual | None = None, use_llm: bool = True, model: str | None = None,
                 fresh: bool = False, system_extra: str = ""):
        self.h, self.manual, self.use_llm, self.model, self.fresh = harness, manual or Manual(), use_llm, model, fresh
        self.system_extra = system_extra      # only the locked-exam control "told it is Uri" uses this
        self.name = f"harness:{harness.id}" + ("" if use_llm else ":no-ai")
        self._sensors = [(s["name"], dsl.parse(s["expr"])) for s in harness.sensors]
        self._rules = [(r, dsl.parse(r["if"]), [dsl.parse_action(x) for x in r["then"]])
                       for r in sorted(harness.rules, key=lambda r: -r.get("priority", 1))]
        self._guards = [(g, dsl.parse(g.get("when", "1")), [dsl.parse_action(x) for x in g["enforce"]]) for g in harness.guardrails]
        self._alerts = [(al, dsl.parse(al["when"])) for al in harness.alerts]
        self.reset()

    # ----------------------------------------------------------------- Policy protocol
    def reset(self):
        self.hist = dsl.History()
        self.events, self.decisions = [], []
        self.last_ai_hour, self.last_ai = -10**9, None
        self._on_rules, self._on_alerts, self._on_guards = set(), set(), set()
        self.ai_calls = 0

    def build(self, info):
        return dict(self.h.build)

    def act(self, obs):
        i = obs["hour"]
        row = flatten(obs)
        self.hist.push(row)
        ev = dsl.Evaluator(self.hist)
        for name, tree in self._sensors:
            row[name] = ev.value(tree)
        stamp = A.stamp(i)
        act: dict = {}

        fired = []
        for r, cond, acts in self._rules:
            if ev.truth(cond):
                for verb, args in acts:
                    dsl.apply_action(verb, args, act, obs)
                fired.append(r)
        fired_ids = {r["id"] for r in fired}
        for r in fired:
            if r["id"] not in self._on_rules:
                self._event(i, "rule_fired", "manual", f"Manual habit: {r.get('description') or r['if']}",
                            {"rule": r["id"], "then": r["then"]})
        self._on_rules = fired_ids

        alerts_on = [al for al, cond in self._alerts if ev.truth(cond)]
        for al in alerts_on:
            if al["when"] not in self._on_alerts:
                self._event(i, "sensor_alert", "manual", f"Alarm: {al.get('description') or al['when']}", {"when": al["when"]})
        self._on_alerts = {al["when"] for al in alerts_on}

        decision = None
        every = int(self.h.authority.get("call_every_h", 1) or 1)
        want_ai = self.use_llm and (alerts_on or act.pop("_call_ai", False))
        act.pop("_call_ai", None)
        if want_ai and i - self.last_ai_hour >= every:
            decision = self._ask(obs, row, alerts_on, fired, stamp)
            self.last_ai, self.last_ai_hour = decision, i
        elif want_ai and self.last_ai is not None:
            decision = self.last_ai          # hold the last decision between calls
        if decision:
            self._merge(act, decision)

        for g, cond, acts in self._guards:
            if ev.truth(cond):
                for verb, args in acts:
                    dsl.apply_action(verb, args, act, obs)
                if g["id"] not in self._on_guards:
                    self._event(i, "guardrail", "manual", f"Hard limit: {g.get('description') or ', '.join(g['enforce'])}", {"guardrail": g["id"]})
                self._on_guards.add(g["id"])
            else:
                self._on_guards.discard(g["id"])

        self._detect(i, row, act, decision)
        return act

    # ----------------------------------------------------------------- the frozen AI
    def _briefing(self, obs, row, alerts_on, fired, stamp) -> tuple[str, list]:
        show = self.h.context.get("show", [])
        fmt = {"demand": ("demand", "{:,.0f} MW"), "supply": ("supply last hour", "{:,.0f} MW"),
               "reserve": ("spare power", "{:,.0f} MW"), "reserve_margin": ("reserve margin", "{:+.1%}"),
               "supply_trend": ("supply change last hour", "{:+,.0f} MW"), "freq": ("grid stability", "{:.2f} Hz"),
               "shed": ("current rolling outages", "{:,.0f} MW"), "temp": ("temperature", "{:.1f} C")}
        lines = []
        for k in show:
            label, f = fmt.get(k, (k, "{:.2f}"))
            val = row.get(k, math.nan)
            if not (isinstance(val, float) and math.isnan(val)):
                lines.append(f"{label} {f.format(val)}")
        txt = f"{stamp}.\nReadings: " + "; ".join(lines) + "."
        if self.h.context.get("show_forecast"):
            txt += (f"\nForecast (can be wrong): coldest next 24 h {row.get('fc_min_24', math.nan):.0f} C, "
                    f"next 72 h {row.get('fc_min_72', math.nan):.0f} C.")
        if self._sensors:
            txt += "\nGauges: " + "; ".join(f"{n} {row.get(n, math.nan):.2f}" for n, _ in self._sensors) + "."
        if alerts_on:
            txt += "\nAlarms: " + "; ".join(al.get("description") or al["when"] for al in alerts_on) + "."
        if fired:
            txt += "\nManual habits already applied this hour: " + "; ".join(r.get("description") or r["if"] for r in fired) + "."
        pages = []
        k = int(self.h.context.get("memory_top_k", 0) or 0)
        if k and self.manual.pages:
            q = f"{txt}"
            pages = self.manual.recall(q, k)
            txt += "\nYour manual pages (lessons from earlier failures):\n" + "\n".join(f"- {p['title']}: {p['text']}" for p in pages)
        n_recent = int(self.h.context.get("recent_hours", 6) or 0)
        if n_recent and len(self.hist.rows) > 1:
            rec = list(self.hist.rows)[-n_recent - 1:-1]
            txt += "\nRecent hours: " + "; ".join(
                f"outages {r.get('shed', 0):,.0f} MW, margin {r.get('reserve_margin', 0):+.1%}" for r in rec) + "."
        cm = "yes" if obs.get("build", {}).get("critical_load_map") else "no"
        txt += (f"\nAvailable: imports up to {obs['imports_max']:,.0f} MW; demand response up to {obs['dr_available_mw']:,.0f} MW; "
                f"batteries {obs.get('battery_mw_max', 0):,.0f} MW (stored {obs.get('battery_soc_mwh', 0):,.0f} MWh); "
                f"critical-load map: {cm}.\nDecide this hour.")
        return txt, pages

    def _ask(self, obs, row, alerts_on, fired, stamp) -> dict:
        user, pages = self._briefing(obs, row, alerts_on, fired, stamp)
        for p in pages:
            self._event(obs["hour"], "memory_recall", "memory", f"Remembers: \"{p['title']}\" (from MongoDB)", {"page": p["id"]})
        d = llm.operator_json(SYSTEM + self.system_extra, user, self.model, fresh=self.fresh)
        self.ai_calls += 1
        dec = self._clean(d, obs)
        self._event(obs["hour"], "ai_decision", "ai", f"AI decides: {decision_text(dec)}",
                    {"rationale": d.get("rationale", ""), "all_clear": bool(d.get("all_clear", False)), "raw": dec,
                     "error": d.get("_error")})
        self._rd_event = RD.track_decision(
            getattr(self, "rd_label", self.h.id), getattr(self, "rd_convo", self.h.id), self.model or "qwen3-30b-a3b",
            user, {k: v for k, v in dec.items() if not k.startswith("_")},
            {"hour": int(obs["hour"]), "notebook": self.h.id, "reserve_margin": round(row.get("reserve_margin") or 0.0, 4),
             "rationale": d.get("rationale", "")[:300], "all_clear": bool(d.get("all_clear", False))})
        self.decisions.append({"h": obs["hour"], "stamp": stamp, "reserve_margin": row.get("reserve_margin"),
                               "supply_trend": row.get("supply_trend"), "temp": row.get("temp"), "action": decision_text(dec),
                               "rationale": d.get("rationale", ""), "all_clear": bool(d.get("all_clear", False))})
        return dec

    def _clean(self, d: dict, obs: dict) -> dict:
        out = {}
        allowed = set(self.h.authority.get("llm_decides", []))
        num = lambda x: float(x) if isinstance(x, (int, float)) else None  # noqa: E731
        for k in ("shed_mw", "restore_mw", "rotation_min", "conservation", "imports_mw", "dr_mw", "battery_mw", "precommit"):
            if k in allowed and num(d.get(k)) is not None:
                out[k] = num(d[k])
        for k in ("protect_gas", "rt_shed"):
            if k in allowed and isinstance(d.get(k), bool):
                out[k] = d[k]
        out["_all_clear"] = bool(d.get("all_clear", False))
        return out

    def _merge(self, act: dict, dec: dict):
        for k, v in dec.items():
            if k.startswith("_"):
                continue
            if k in CAUTION_FIELDS:
                act[k] = max(act.get(k) or 0.0, v)
            elif k in ("protect_gas", "rt_shed"):
                act[k] = bool(act.get(k)) or v
            else:
                act[k] = v

    # ----------------------------------------------------------------- detectors + events
    def _detect(self, i, row, act, decision):
        """'False all-clear': the AI says things are fine while power is running out. Local detector; it is labeled
        Raindrop only once events are actually sent to Raindrop (FOUR37_RAINDROP=1)."""
        if decision is None or i != self.last_ai_hour:
            return
        rm, tr = row.get("reserve_margin", 0.0), row.get("supply_trend", 0.0)
        risky = rm < 0.03 or (tr < -1500 and rm < 0.08)
        calm = decision.get("_all_clear") or ((act.get("shed_mw") or 0) == 0 and not act.get("rt_shed"))
        if risky and calm:
            self._event(i, "false_all_clear", DETECTOR_ACTOR,
                        "Flag: the AI said all clear while power was running out", {"reserve_margin": rm, "supply_trend": tr})
            RD.signal_false_all_clear(getattr(self, "_rd_event", None), rm, tr)
        # Raindrop only (never changes the run): homes kept dark although there is power to spare
        if RD.enabled and (act.get("shed_mw") or 0) > 300 and rm > 0.06:
            RD.signal(getattr(self, "_rd_event", None), "homes_dark_with_spare_power",
                      f"kept {act.get('shed_mw'):,.0f} MW of homes dark with {rm:.1%} spare power")

    def _event(self, h, typ, actor, text, data=None):
        self.events.append({"h": int(h), "type": typ, "actor": actor, "text_plain": text, "data": data or {}})
