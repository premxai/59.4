"""Judge-made storms and live streaming of a run, hour by hour (for the stage demo).

A judge picks how cold, how long, where, how much demand surges and whether freezing rain falls. That becomes a
new synthetic storm built from a real pre-2021 cold wave with the simulator's own storm transforms (the locked
simulator is not modified; weather after 2020 cannot be used). Both manuals (Day 1 and the learned one) then run
it with the same frozen AI; every hour is pushed to a callback as it happens.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from typing import Callable

from sim import api
from sim.scenarios import CORE11, CORE18, CORE89, SOUTH, W11, W18, W89, WEST, Scenario

from .memory import Manual
from .operator import HarnessPolicy, decision_text
from .schema import Harness

BASES = {"feb2011": (W11, CORE11), "dec1989": (W89, CORE89), "jan2018": (W18, CORE18)}
REGIONS = {"statewide": None, "west": WEST, "coast": SOUTH, "north": ["dallas", "lubbock", "sweetwater"]}


def judge_storm(colder_c: float = 4.0, longer_x: float = 1.5, where: str = "statewide", surge: float = 0.0,
                freezing_rain: bool = False, base: str = "feb2011", compact: bool = True) -> Scenario:
    """compact=True trims the weather window to 1 day before the cold core through 2 days after it (the stretch
    still lengthens the core itself), so a fully live run with fresh AI calls fits a judge's few minutes."""
    window, core = BASES[base]
    if compact:
        import pandas as pd
        fmt = "%Y-%m-%d %H:%M"
        window = ((pd.Timestamp(core[0]) - pd.Timedelta(hours=24)).strftime(fmt),
                  (pd.Timestamp(core[1]) + pd.Timedelta(hours=48)).strftime(fmt))
    tr = []
    if longer_x > 1.0:
        tr.append({"op": "stretch", "factor": round(float(longer_x), 2), "core": core})
    if colder_c:
        tr.append({"op": "shift", "delta": -abs(round(float(colder_c), 1)), "regions": REGIONS[where], "core": core})
    if surge:
        tr.append({"op": "demand", "mult": round(1.0 + float(surge), 3), "core": core})
    if freezing_rain:
        tr.append({"op": "precip", "mm": 0.8, "regions": REGIONS[where], "core": core})
    params = {"colder_c": colder_c, "longer_x": longer_x, "where": where, "surge": surge, "rain": freezing_rain, "base": base,
              "compact": compact}
    sid = "judge_" + hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:8]
    desc = (f"{abs(colder_c):g} C colder ({where}), {longer_x:g}x as long" + (f", demand +{surge:.0%}" if surge else "")
            + (", freezing rain" if freezing_rain else ""))
    return Scenario(sid, "Judge's storm", window[0], window[1], 2020, tr, kind="synthetic", description=desc,
                    split="judge")


class StreamingPolicy(HarnessPolicy):
    """HarnessPolicy that reports each hour (what the operator saw, what it did, new events) to a callback."""

    def __init__(self, harness: Harness, on_hour: Callable[[dict], None], manual: Manual | None = None,
                 use_llm: bool = True, model: str | None = None, label: str = "", fresh: bool = False):
        super().__init__(harness, manual, use_llm, model, fresh)
        self.on_hour, self.label, self.world = on_hour, label, None

    def act(self, obs):
        n0 = len(self.events)
        a = super().act(obs)
        cap, avail = obs.get("capacity_by_fuel") or {}, obs.get("avail_by_fuel") or {}
        i = int(obs["hour"])
        w = self.world
        weather = {}
        if w is not None and i < len(w.ts):
            weather = {"gas_production_frac": round(1.0 - float(w.prod_loss[i]), 3),
                       "snow_cm": round(float(w.wx["snow"][i].mean()), 2), "wind_ms": round(float(w.wx["wind"][i].mean()), 1),
                       "wind_ok_frac": round(float(w.wind_ok[i].mean()), 3)}
        self.on_hour({
            "fuel_avail": {f: round(avail.get(f, 0.0) / cap[f], 3) for f in ("gas", "coal", "nuclear", "wind", "solar")
                           if cap.get(f)},
            "outages_by_fuel_mw": {f: round(v) for f, v in (obs.get("outages_by_fuel") or {}).items()},
            **weather,
            "label": self.label, "h": int(obs["hour"]), "stamp": str(obs.get("ts")), "local_hour": obs.get("local_hour"),
            "shed_frac": obs["shed_now"] / max(obs["demand_now"], 1.0),
            "gas_avail_frac": (avail.get("gas", 0.0) / cap["gas"]) if cap.get("gas") else None,
            "protect_gas": bool(a.get("protect_gas")),
            "demand_mw": obs["demand_now"], "supply_mw": obs["supply_now"],
            "reserve_mw": obs["reserve_now"], "shed_mw": obs["shed_now"], "freq_min_hz": obs["freq_min_last"],
            "below_59_4_min": obs.get("below_59_4_min", 0), "countdown_s": obs.get("countdown_s"),
            "homes_dark": obs.get("homes_dark_now"), "temp_c": obs["temp_now"],
            "action": decision_text(a), "events": self.events[n0:],
        })
        return a


def run_live(scn, manuals: dict, on_hour: Callable[[dict], None], seed: int = 0, use_llm: bool = True,
             fresh: bool = False) -> dict:
    """Run several manuals ({label: (Harness, pages)}) on the same storm (Scenario or storm id) at once;
    returns {label: (Result, policy)}."""
    out, threads = {}, []

    world = api.get_world(scn, api.default_params())     # weather/gas-field state is the same for every manual
    run_tag = hashlib.sha1(f"{time.time()}".encode()).hexdigest()[:6]

    def one(label, h, pages):
        pol = StreamingPolicy(h, on_hour, Manual(pages), use_llm=use_llm, label=label, fresh=fresh)
        pol.world = world
        pol.rd_label, pol.rd_convo = f"{label}:{h.id}", f"{getattr(scn, 'id', scn)}:{run_tag}:{label}"   # Raindrop grouping
        out[label] = (api.run(scn, pol, seed), pol)

    for label, (h, pages) in manuals.items():
        t = threading.Thread(target=one, args=(label, h, pages), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()
    from . import raindrop_bridge
    raindrop_bridge.flush()
    return out
