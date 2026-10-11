"""Step 0: the deciding experiments before the overnight learning runs. Results go to data/step0.json.

  python scripts/step0.py a1          sim-only skill/build matrix (minutes, no LLM)
  python scripts/step0.py a2          tear-outs of the latest evo1 manual (LLM, held-out seed 0)
  python scripts/step0.py a3          night-zero: Claude writes a manual zero-shot, per track (LLM)
  python scripts/step0.py a4          extra seeds for v1 / h_005 / zero-shot on held-out (LLM)
  python scripts/step0.py a6          one Gemma call (transplant test feasibility)

Decision rules live in the plan (C:/Users/kanap/.claude/plans/lively-chasing-canyon.md, Phase 0).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sim import api  # noqa: E402
from sim.policies import GoodScriptedPolicy, StatusQuoPolicy  # noqa: E402
from sim.scenarios import HELDOUT_IDS, TRAIN_IDS  # noqa: E402

OUT = ROOT / "data" / "step0.json"
SEEDS = (0, 1, 2)
FULL_BUILD = {"winterize_plants": {"gas": 0.7, "coal": 0.7, "nuclear": 0.5, "other": 0.5, "wind": 0.2},
              "winterize_wells": 0.4, "firm_fuel": 0.1, "critical_load_map": True, "dr_mw": 1000.0}
BUILDS = {"none": {}, "map": {"critical_load_map": True},
          "map_wells": {"critical_load_map": True, "winterize_wells": 0.4}, "full": FULL_BUILD}
SKILLS = ("protect_gas", "forecast", "margin", "slow_restore", "rt_shed")


def save(key, value):
    d = json.loads(OUT.read_text()) if OUT.exists() else {}
    d[key] = value
    OUT.write_text(json.dumps(d, indent=1, default=str))


class SkillPolicy(GoodScriptedPolicy):
    """GoodScriptedPolicy's in-storm operations with each skill switchable, on a chosen build."""

    def __init__(self, build: dict, off: tuple = ()):
        super().__init__()
        self._build, self.off = dict(build), set(off)
        self.name = "good_ops" + ("-no_" + "-no_".join(sorted(self.off)) if self.off else "")

    def build(self, info):
        return dict(self._build)

    def act(self, obs):
        cold = False
        if "forecast" not in self.off:
            fmin = obs["forecast_min_temp_72h"]
            reg_min = min(obs["forecast_min_temp_by_region_72h"].values())
            cold = fmin < -3.0 or reg_min < -8.0
        if "margin" in self.off:
            margin, projected = 0.0, obs["supply_now"]
        else:
            margin = self.margin + (1500.0 if cold else 0.0)
            projected = obs["supply_now"] + 1.5 * min(0.0, obs["supply_trend_1h"])
        dem = obs["demand_now"]
        cons = 0.03 if (cold and projected - dem < margin + 3000) else 0.0
        imports = obs["imports_max"] if (cold or projected - dem < margin) else 0.0
        gap = dem * (1 - cons) + margin - projected - imports
        dr = min(obs["dr_available_mw"], max(0.0, gap)) if gap > 0 else 0.0
        batt = 0.0
        if obs["battery_mw_max"] > 0:
            if gap - dr > 0:
                batt = min(obs["battery_mw_max"], gap - dr)
            elif projected - dem > margin + 4000:
                batt = -obs["battery_mw_max"]
        shed = max(0.0, gap - dr - max(batt, 0.0))
        if "slow_restore" not in self.off and cold and shed < self.prev_shed:
            shed = max(shed, self.prev_shed - 1500.0)
        self.prev_shed = shed
        return {"conservation": cons, "imports_mw": imports, "dr_mw": dr, "battery_mw": batt,
                "precommit": 1.0 if cold else 0.0, "shed_mw": shed, "protect_gas": "protect_gas" not in self.off,
                "rotation_min": 30.0, "rt_shed": "rt_shed" not in self.off}


class StatusQuoOn(StatusQuoPolicy):
    def __init__(self, build: dict, protect_gas: bool = False):
        self._build, self.pg = dict(build), protect_gas
        self.name = "status_quo" + ("+protect_gas" if protect_gas else "")

    def build(self, info):
        return dict(self._build)

    def act(self, obs):
        a = super().act(obs)
        if self.pg:
            a["protect_gas"] = True
        return a


def tally(policy_factory, storms):
    per = {}
    for s in storms:
        rs = [api.run(s, policy_factory(), sd) for sd in SEEDS]
        per[s] = {"passed_seeds": sum(r.passed for r in rs), "homes_dark_hours": [float(r.homes_dark_hours) for r in rs],
                  "collapsed": sum(r.collapsed for r in rs)}
    return {"majority_passed": sum(v["passed_seeds"] >= 2 for v in per.values()),
            "seed_passes": [sum(per[s]["passed_seeds"] > k for s in storms) for k in range(len(SEEDS))],
            "homes_dark_hours_total": sum(sum(v["homes_dark_hours"]) for v in per.values()) / len(SEEDS),
            "collapses": sum(v["collapsed"] for v in per.values()), "per_storm": per}


def a1():
    t0 = time.time()
    out = {}
    for bname, b in BUILDS.items():
        rows = {}
        variants = [("good_ops", lambda b=b: SkillPolicy(b))]
        variants += [(f"good_ops-no_{k}", lambda b=b, k=k: SkillPolicy(b, (k,))) for k in SKILLS]
        variants += [("status_quo", lambda b=b: StatusQuoOn(b)), ("status_quo+protect_gas", lambda b=b: StatusQuoOn(b, True))]
        for name, fac in variants:
            rows[name] = {"train": tally(fac, TRAIN_IDS), "heldout": tally(fac, HELDOUT_IDS)}
            r = rows[name]
            print(f"{bname:10s} {name:28s} train {r['train']['majority_passed']}/9  held-out {r['heldout']['majority_passed']}/8  "
                  f"held-out homes-dark {r['heldout']['homes_dark_hours_total'] / 1e6:,.0f}M  collapses {r['heldout']['collapses']}")
        out[bname] = rows
    # decision rule for Track A's fixed build
    choice = None
    for bname in BUILDS:
        # best in-storm operations available on this build (any skill subset), vs the pre-2021 procedure
        ops_rows = {k: v for k, v in out[bname].items() if k.startswith("good_ops")}
        best = max(ops_rows, key=lambda k: (ops_rows[k]["heldout"]["majority_passed"], -ops_rows[k]["heldout"]["homes_dark_hours_total"]))
        g = ops_rows[best]["heldout"]["majority_passed"]
        sq, sqp = (out[bname][k]["heldout"]["majority_passed"] for k in ("status_quo", "status_quo+protect_gas"))
        ok = g >= 5 and sq <= 2 and g - sqp >= 2
        print(f"rule[{bname}]: best operations {best} {g}/8, status_quo {sq}/8, status_quo+protect_gas {sqp}/8 -> {'OK' if ok else 'no'}")
        if ok and choice is None:
            choice = bname
    print(f"Track A fixed build: {choice} {BUILDS.get(choice)}  ({time.time() - t0:.0f}s)")
    slim = {b: {p: {sp: {k: v for k, v in r[sp].items() if k != 'per_storm'} for sp in r} for p, r in rows.items()}
            for b, rows in out.items()}
    save("a1", {"builds": BUILDS, "results": slim, "track_a_build": choice,
                "track_a_build_value": BUILDS.get(choice), "per_storm": out})


def _harness(hid):
    from harness.schema import Harness
    for line in reversed((ROOT / "data/local_store/harness_versions.jsonl").read_text(encoding="utf-8").splitlines()):
        d = json.loads(line)
        if d["id"] == hid:
            return Harness.from_json(d)
    raise KeyError(hid)


def a1_llm_off():
    """The evolved manuals with the AI unplugged (rules + limits + build only)."""
    from harness.memory import Manual
    from harness.run import run_storm
    out = {}
    for hid in ("h_001", "h_005", "h_008"):
        h = _harness(hid)
        rows = []
        for s in HELDOUT_IDS:
            for sd in SEEDS:
                r = run_storm(h, s, sd, Manual(), use_llm=False)
                rows.append({"scenario_id": s, "seed": sd, "passed": r["passed"], "homes_dark_hours": r["homes_dark_hours"]})
        maj = sum(sum(x["passed"] for x in rows if x["scenario_id"] == s) >= 2 for s in HELDOUT_IDS)
        hh = sum(x["homes_dark_hours"] for x in rows) / len(SEEDS)
        print(f"{hid} AI unplugged: held-out majority {maj}/8, homes-dark {hh / 1e6:,.0f}M")
        out[hid] = {"majority_passed": maj, "homes_dark_hours_total": hh, "runs": rows}
    save("a1_llm_off", out)


def _held(h, seeds=(0,), workers=48):
    from harness.evolve import evaluate
    runs = evaluate(h, [], HELDOUT_IDS, seeds, workers)
    per = {}
    for r in runs:
        per.setdefault(r["scenario_id"], []).append(r)
    maj = sum(sum(x["passed"] for x in rs) * 2 > len(rs) for rs in per.values())
    by_seed = {sd: {"passed": sum(r["passed"] for r in runs if r["seed"] == sd),
                    "homes_dark_hours": sum(r["homes_dark_hours"] for r in runs if r["seed"] == sd)} for sd in seeds}
    return {"majority_passed": maj, "by_seed": by_seed, "inconclusive": sum(bool(r.get("inconclusive")) for r in runs),
            "ticks": "".join("✓" if sum(x["passed"] for x in per[s]) * 2 > len(per[s]) else "✗" for s in HELDOUT_IDS)}


def _show(label, d):
    hh = [v["homes_dark_hours"] / 1e6 for v in d["by_seed"].values()]
    print(f"{label:34s} held-out {d['majority_passed']}/8 {d['ticks']}  homes-dark by seed {[round(x) for x in hh]}M"
          f"  inconclusive {d['inconclusive']}", flush=True)


def a2():
    """Tear-outs of evo1's last manual (h_008) + throughput (A5)."""
    from harness import llm
    from harness.schema import Harness
    h8 = _harness("h_008")
    j = h8.to_json()
    variants = {"h_008 (full)": j,
                "minus hard limit g1_3 (protect gas)": {**j, "guardrails": [g for g in j["guardrails"] if g["id"] != "g1_3"]},
                "minus habit r1_2 (restore)": {**j, "rules": [r for r in j["rules"] if r["id"] != "r1_2"]},
                "minus build": {**j, "build": {}},
                "build only": {**j, "rules": [], "guardrails": []}}
    out, t0, c0 = {}, time.time(), dict(llm.STATS)
    for k, v in variants.items():
        out[k] = _held(Harness.from_json(v))
        _show(k, out[k])
    dt_s = time.time() - t0
    calls = llm.STATS["operator_calls"] - c0.get("operator_calls", 0)
    thr = {"seconds": round(dt_s), "operator_calls": calls, "calls_per_s": round(calls / max(dt_s, 1), 2),
           "retries": llm.STATS.get("operator_retries", 0) - c0.get("operator_retries", 0),
           "errors": llm.STATS.get("operator_errors", 0) - c0.get("operator_errors", 0)}
    print("throughput (A5):", thr)
    save("a2", out)
    save("a5", thr)


def a3():
    """Night zero: Claude's zero-shot manual per track, scored on held-out (seed 0); plus Track A's Day 1."""
    from harness import coach
    from harness.evolve import zero_shot_manual
    from harness.schema import v1
    d = json.loads(OUT.read_text())
    build_a = d.get("a1", {}).get("track_a_build_value") or {"critical_load_map": True}
    out = {}
    for track in ("B", "A"):
        base = v1()
        if track == "A":
            base.build = dict(build_a)
            out["A_day1 (v1 + fixed build)"] = _held(base)
            _show("Track A day 1 (v1 + fixed build)", out["A_day1 (v1 + fixed build)"])
        zs = zero_shot_manual(base, track, build_a if track == "A" else None)
        p = zs["proposals"][0]
        child = base.apply_ops(coach.decode_ops(p["ops"]), f"zero_shot_{track}", "night0")
        out[f"zero_shot_{track}"] = {**_held(child), "title": p["title"], "n_ops": len(p["ops"]),
                                     "predicted_pct": p.get("predicted_change_pct"), "counts": child.counts()}
        _show(f"zero-shot {track}: {p['title'][:20]}", out[f"zero_shot_{track}"])
    save("a3", out)


def a4():
    """Seeds 1,2 for v1, h_005 and zero-shot B on held-out (robustness)."""
    from harness import coach
    from harness.schema import v1
    zs = json.loads((ROOT / "data" / "zero_shot_B.json").read_text())["proposals"][0]
    zb = v1().apply_ops(coach.decode_ops(zs["ops"]), "zero_shot_B", "night0")
    out = {}
    for label, h in (("v1", v1()), ("h_005", _harness("h_005")), ("h_008", _harness("h_008")), ("zero_shot_B", zb)):
        out[label] = _held(h, SEEDS)
        _show(label + " (3 seeds)", out[label])
    save("a4", out)


def llm_all(workers: int = 64):
    """a2 + a3 + a4 + a5 in one pool (every manual x storm x seed at once), so the run takes minutes, not an hour."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from harness import coach, llm
    from harness.evolve import cached_run, zero_shot_manual
    from harness.schema import Harness, v1
    d = json.loads(OUT.read_text())
    build_a = d.get("a1", {}).get("track_a_build_value") or {"critical_load_map": True}
    base_b, base_a = v1(), v1()
    base_a.build = dict(build_a)
    with ThreadPoolExecutor(2) as ex:
        zs = dict(zip("BA", ex.map(lambda tb: zero_shot_manual(tb[1], tb[0], build_a if tb[0] == "A" else None),
                                   [("B", base_b), ("A", base_a)])))
    zman = {t: (b.apply_ops(coach.decode_ops(zs[t]["proposals"][0]["ops"]), f"zero_shot_{t}", "night0"), zs[t]["proposals"][0])
            for t, b in (("B", base_b), ("A", base_a))}
    j8 = _harness("h_008").to_json()
    manuals = {
        "a2:h_008 (full)": (Harness.from_json(j8), (0,)),
        "a2:minus hard limit g1_3 (protect gas)": (Harness.from_json({**j8, "guardrails": [g for g in j8["guardrails"] if g["id"] != "g1_3"]}), (0,)),
        "a2:minus habit r1_2 (restore)": (Harness.from_json({**j8, "rules": [r for r in j8["rules"] if r["id"] != "r1_2"]}), (0,)),
        "a2:minus build": (Harness.from_json({**j8, "build": {}}), (0,)),
        "a2:build only": (Harness.from_json({**j8, "rules": [], "guardrails": []}), (0,)),
        "a3:A day 1 (v1 + fixed build)": (base_a, SEEDS),
        "a3:zero-shot A": (zman["A"][0], SEEDS),
        "a3:zero-shot B": (zman["B"][0], SEEDS),
        "a4:v1": (base_b, SEEDS),
        "a4:h_005": (_harness("h_005"), SEEDS),
        "a4:h_008": (Harness.from_json(j8), SEEDS),
    }
    jobs = [(lab, h, s, sd) for lab, (h, seeds) in manuals.items() for s in HELDOUT_IDS for sd in seeds]
    print(f"{len(jobs)} storm runs, {workers} at a time", flush=True)
    t0, c0 = time.time(), dict(llm.STATS)
    res: dict = {lab: [] for lab in manuals}
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(cached_run, h, s, sd, []): lab for lab, h, s, sd in jobs}
        for k, f in enumerate(as_completed(futs), 1):
            res[futs[f]].append(f.result())
            if k % 10 == 0:
                print(f"  {k}/{len(jobs)} done ({time.time() - t0:.0f}s, operator calls {llm.STATS['operator_calls'] - c0.get('operator_calls', 0)}, "
                      f"retries {llm.STATS.get('operator_retries', 0)}, errors {llm.STATS.get('operator_errors', 0)})", flush=True)
    dt_s = time.time() - t0
    calls = llm.STATS["operator_calls"] - c0.get("operator_calls", 0)
    thr = {"seconds": round(dt_s), "storm_runs": len(jobs), "operator_calls": calls, "calls_per_s": round(calls / max(dt_s, 1), 2),
           "retries": llm.STATS.get("operator_retries", 0), "errors": llm.STATS.get("operator_errors", 0), "workers": workers}
    summary = {}
    for lab, runs in res.items():
        per = {}
        for r in runs:
            per.setdefault(r["scenario_id"], []).append(r)
        seeds = sorted({r["seed"] for r in runs})
        summary[lab] = {
            "majority_passed": sum(sum(x["passed"] for x in rs) * 2 > len(rs) for rs in per.values()),
            "ticks": "".join("✓" if sum(x["passed"] for x in per[s]) * 2 > len(per[s]) else "✗" for s in HELDOUT_IDS),
            "by_seed": {sd: {"passed": sum(r["passed"] for r in runs if r["seed"] == sd),
                             "homes_dark_hours": sum(r["homes_dark_hours"] for r in runs if r["seed"] == sd)} for sd in seeds},
            "inconclusive": sum(bool(r.get("inconclusive")) for r in runs),
            "per_storm": {s: [{"seed": r["seed"], "passed": r["passed"], "homes_dark_hours": r["homes_dark_hours"],
                               "cache_key": r.get("cache_key")} for r in per[s]] for s in per}}
        _show(lab, summary[lab])
    for t in "AB":
        summary[f"a3:zero-shot {t}"].update(title=zman[t][1]["title"], n_ops=len(zman[t][1]["ops"]),
                                             predicted_pct=zman[t][1].get("predicted_change_pct"), counts=zman[t][0].counts())
    print("throughput (A5):", thr)
    save("llm_all", summary)
    save("a5", thr)


def a6():
    from harness import llm
    d = llm.operator_json("Reply with JSON {\"ok\": true}.", "Say ok.", "google/gemma-3-27b-it")
    print("gemma:", d)
    save("a6", {"ok": "_error" not in d, "reply": d})


if __name__ == "__main__":
    for step in sys.argv[1:]:
        {"a1": a1, "a1_llm_off": a1_llm_off, "a2": a2, "a3": a3, "a4": a4, "a6": a6, "llm": llm_all}[step]()
