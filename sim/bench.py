"""Timing, no LLM calls: one full pre-2021 season (Nov 15 -> Mar 15, ~2,900 hourly steps) and one storm window.

    .venv/Scripts/python.exe -m sim.bench          # writes sim/out/bench.json

World build (weather transforms, demand, gas/icing accumulators) is cached per scenario by sim.api, so repeated
runs of the same scenario (other seeds / other policies / other harness versions) pay only the sim time.
"""
from __future__ import annotations

import json
import os
import platform
import time

from . import data as D
from . import scenarios as S
from .api import default_params, get_world
from .engine import simulate
from .policies import POLICIES

OUT = os.path.join(os.path.dirname(__file__), "out")


def _time(scn, p, seeds=(0, 1, 2)):
    t = time.perf_counter()
    w = get_world(scn, p)
    tw = time.perf_counter() - t
    rows = {}
    for name, P in POLICIES.items():
        ts = []
        for seed in seeds:
            t = time.perf_counter()
            r = simulate(w, P(), p, seed=seed)
            ts.append(time.perf_counter() - t)
        rows[name] = {"sim_s_min": round(min(ts), 3), "sim_s_max": round(max(ts), 3), "verdict_seed_last": r.verdict_plain}
    return {"scenario": scn.id, "hours": w.n, "world_build_s": round(tw, 3), "policies": rows,
            "full_run_s_worst": round(tw + max(v["sim_s_max"] for v in rows.values()), 3)}


def main():
    t = time.perf_counter()
    D.weather_wide()
    t_wx = time.perf_counter() - t
    p = default_params()
    out = {"python": platform.python_version(), "machine": platform.processor(), "weather_cache_load_s": round(t_wx, 3),
           "season": _time(S.season(2020), p), "storm": _time(S.get("heldout_flash_2014"), p)}
    print(f"weather cache load {t_wx:.2f}s (once per process)")
    for k in ("season", "storm"):
        b = out[k]
        print(f"{k}: {b['scenario']} {b['hours']} h, world build {b['world_build_s']:.2f}s, worst full run {b['full_run_s_worst']:.2f}s")
        for name, v in b["policies"].items():
            print(f"   {name:<14} sim {v['sim_s_min']:.3f}-{v['sim_s_max']:.3f}s  ({v['verdict_seed_last']})")
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "bench.json"), "w") as fh:
        json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
