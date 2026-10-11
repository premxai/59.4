"""Run one storm with a harness and collect everything the coach and the screen need."""
from __future__ import annotations

import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from sim import api

from .memory import Manual
from .operator import HarnessPolicy
from .schema import Harness


def run_storm(h: Harness, scenario_id: str, seed: int = 0, manual: Manual | None = None, use_llm: bool = True,
              model: str | None = None) -> dict:
    pol = HarnessPolicy(h, manual, use_llm=use_llm, model=model)
    t0 = time.time()
    res = api.run(scenario_id, pol, seed)
    sim_events = [{"h": int(e.get("h", 0)), "type": e.get("type"), "actor": "sim",
                   "text_plain": e.get("text_plain") or e.get("text") or str(e.get("type")), "data": e.get("data", {})}
                  for e in (res.events or [])]
    events = sorted(sim_events + pol.events, key=lambda e: (e["h"], e["actor"] != "sim"))
    passed = getattr(res, "passed", None)
    if passed is None:   # until sim exposes Result.passed: no collapse and worst hour <= 20% shed
        passed = (not res.collapsed) and res.peak_shed_mw <= 0.2 * max(1.0, max(res.hourly.get("demand", [1.0])))
    return {
        "run_id": f"r_{uuid.uuid4().hex[:10]}", "scenario_id": scenario_id, "seed": seed,
        "harness_id": h.id, "harness_hash": h.hash(), "generation": h.generation, "use_llm": use_llm,
        "model": model or "Qwen/Qwen3-30B-A3B-Instruct-2507",
        "passed": bool(passed), "collapsed": bool(res.collapsed), "collapse_hour": res.collapse_hour,
        "verdict_plain": getattr(res, "verdict_plain", None) or ("Failed: total blackout" if res.collapsed else
                                                                 ("Passed" if passed else "Failed: too many homes dark")),
        "homes_dark_hours": float(res.homes_dark_hours), "peak_homes_dark": float(res.peak_homes_dark),
        "peak_shed_mw": float(res.peak_shed_mw), "unnecessary_homes_hours": float(res.unnecessary_homes_hours),
        "min_freq": float(res.min_freq), "cost_usd": float(res.cost.get("total_usd", 0.0)),
        "score": float(res.score.get("total", 0.0)), "cause_summary": res.cause_summary,
        "cause_chain": res.cause_chain, "events": events, "decisions": pol.decisions, "ai_calls": pol.ai_calls,
        "runtime_s": round(time.time() - t0, 1), "_result": res,
    }


def run_set(h: Harness, scenario_ids: list, seeds=(0,), manual: Manual | None = None, use_llm: bool = True,
            workers: int = 12, model: str | None = None) -> list:
    jobs = [(s, sd) for s in scenario_ids for sd in seeds]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(lambda j: run_storm(h, j[0], j[1], manual, use_llm, model), jobs))
