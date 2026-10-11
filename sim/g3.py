"""G3 difficulty check: scripted policies on the TRAIN and HELD-OUT synthetic storms (pre-2021 weather) plus
the real pre-2021 GATE windows.

    .venv/Scripts/python.exe -m sim.g3            # writes sim/out/g3_final.json

PASS (Result.passed): the grid never totally collapses AND at the worst hour at least 80% of homes still have
power (peak shed <= 20% of that hour's demand). A STORM counts as passed for a policy when it passes on a
majority of its seeds (>= 2 of 3).

Targets (difficulty spread): naive and status quo pass <= 2 of 8 storms per set; good scripted passes >= 6.
Single process on purpose: one storm run takes ~0.02-0.05 s, so a Windows process pool costs more than it saves.
"""
from __future__ import annotations

import json
import os
import time

import numpy as np

from . import scenarios as S
from .api import run
from .policies import POLICIES

OUT = os.path.join(os.path.dirname(__file__), "out")
SETS = {"train": S.TRAIN_IDS, "heldout": S.HELDOUT_IDS, "gate": S.GATE_IDS}


def _row(sid, pol, seed):
    r = run(sid, POLICIES[pol](), seed=seed)
    f = r.frame()
    return {"scenario": sid, "policy": pol, "seed": seed, "passed": r.passed, "verdict_plain": r.verdict_plain,
            "peak_shed_frac": round(r.peak_shed_frac, 4), "worst_hour": r.worst_hour,
            "collapsed": r.collapsed, "collapse_hour": r.collapse_hour,
            "homes_dark_hours": r.homes_dark_hours, "peak_shed_mw": r.peak_shed_mw, "min_freq": r.min_freq,
            "unnecessary_hh": r.unnecessary_homes_hours, "cost_usd": r.cost["total_usd"], "score": r.score["total"],
            "peak_cold_out_mw": float(f.out_cold.max()), "peak_gas_nofuel_mw": float(f.gas_nofuel.max()),
            "peak_fts_mw": float(f.out_fts.max()), "min_turbines_running": float(f.turbines_running.min()),
            "peak_feedback": float(f.feedback.max()), "peak_demand_mw": float(f.demand.max()),
            "event_counts": {t: sum(1 for e in r.events if e["type"] == t) for t in sorted({e["type"] for e in r.events})},
            "cause_summary": r.cause_summary, "runtime_s": r.runtime_s}


def main():
    t0 = time.time()
    rows = [_row(sid, pol, sd) for ids in SETS.values() for sid in ids for pol in POLICIES
            for sd in S.get(sid).seeds]
    storms, summary = {}, {}
    for set_name, ids in SETS.items():
        summary[set_name] = {}
        for pol in POLICIES:
            n_storm_pass, n_run_pass, n_run, n_col = 0, 0, 0, 0
            for sid in ids:
                rr = [r for r in rows if r["scenario"] == sid and r["policy"] == pol]
                k = sum(r["passed"] for r in rr)
                n_storm_pass += k * 2 > len(rr)
                n_run_pass += k
                n_run += len(rr)
                n_col += sum(r["collapsed"] for r in rr)
                scn = S.get(sid)
                st = storms.setdefault(sid, {"set": set_name, "public": scn.public, "description": scn.description,
                                             "failure_modes": scn.failure_modes,
                                             "source_window": [scn.start, scn.end], "fleet_year": scn.fleet_year})
                st[pol] = {"passed_seeds": f"{k}/{len(rr)}", "storm_passed": k * 2 > len(rr),
                           "collapsed_seeds": f"{sum(r['collapsed'] for r in rr)}/{len(rr)}",
                           "peak_shed_frac_mean": round(float(np.mean([r["peak_shed_frac"] for r in rr])), 3),
                           "homes_dark_hours_M_mean": round(float(np.mean([r["homes_dark_hours"] for r in rr])) / 1e6, 2),
                           "verdicts": [r["verdict_plain"] for r in rr], "cause_seed0": rr[0]["cause_summary"]}
            summary[set_name][pol] = {"storms_passed": f"{n_storm_pass}/{len(ids)}", "runs_passed": f"{n_run_pass}/{n_run}",
                                      "runs_collapsed": f"{n_col}/{n_run}"}
    modes = {m: [sid for sid in S.TRAIN_IDS + S.HELDOUT_IDS if m in S.get(sid).failure_modes]
             for m in S.FAILURE_MODES}
    rep = {"pass_rule": "passed = no total collapse AND worst-hour shed <= 20% of demand; storm passed = majority of seeds",
           "summary": summary, "failure_mode_coverage": modes, "storms": storms, "rows": rows,
           "elapsed_s": round(time.time() - t0, 1)}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "g3_final.json"), "w") as fh:
        json.dump(rep, fh, indent=1, default=str)
    print(json.dumps(summary, indent=1))
    for set_name, ids in SETS.items():
        print(f"--- {set_name}")
        for sid in ids:
            cells = []
            for pol in POLICIES:
                t = storms[sid][pol]
                cells.append(f"{pol[:6]:<6} P{t['passed_seeds']} C{t['collapsed_seeds']} f{t['peak_shed_frac_mean']:.2f}")
            print(f"{sid:<26}" + " | ".join(cells))
    print(f"elapsed {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
