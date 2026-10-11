"""Public entry points: run(scenario, policy, seed) and run_many(scenario, policy, seeds)."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache

import numpy as np

from . import scenarios as S
from .engine import Result, World, build_world, simulate
from .params import Params, load_params

_WORLDS: dict = {}
_DEFAULT_PARAMS: list = []


def default_params() -> Params:
    if not _DEFAULT_PARAMS:
        _DEFAULT_PARAMS.append(load_params())
    return _DEFAULT_PARAMS[0]


def params_key(p: Params) -> str:
    return hashlib.sha1(json.dumps(p.to_json(), sort_keys=True, default=str).encode()).hexdigest()[:12]


def get_world(scenario, p: Params) -> World:
    scn = S.get(scenario) if isinstance(scenario, str) else scenario
    key = (scn.id, json.dumps(scn.transforms, sort_keys=True, default=str), params_key(p))
    w = _WORLDS.get(key)
    if w is None:
        w = build_world(scn.materialize(), p)
        if len(_WORLDS) > 64:
            _WORLDS.clear()
        _WORLDS[key] = w
    return w


def run(scenario, policy, seed: int = 0, params: Params | None = None, capital_budget: float | None = None) -> Result:
    """Simulate one scenario (id or Scenario) with one policy and one seed. Deterministic per seed."""
    p = params or default_params()
    return simulate(get_world(scenario, p), policy, p, seed=seed, capital_budget=capital_budget)


def run_many(scenario, policy, seeds=None, params: Params | None = None, capital_budget: float | None = None) -> dict:
    """Run several seeds (default: the scenario's own, [0, 1, 2]). Returns {'results': [Result...], 'mean': {...},
    'passed_seeds': int, 'storm_passed': bool (majority of seeds passed)}. Gates average over seeds."""
    scn = S.get(scenario) if isinstance(scenario, str) else scenario
    seeds = list(seeds if seeds is not None else scn.seeds)
    res = [run(scn, policy, s, params, capital_budget) for s in seeds]
    keys = ["homes_dark_hours", "peak_shed_mw", "peak_shed_frac", "min_freq", "unnecessary_homes_hours"]
    mean = {k: float(np.mean([getattr(r, k) for r in res])) for k in keys}
    mean["collapse_rate"] = float(np.mean([r.collapsed for r in res]))
    mean["pass_rate"] = float(np.mean([r.passed for r in res]))
    mean["score"] = float(np.mean([r.score["total"] for r in res]))
    mean["cost_usd"] = float(np.mean([r.cost["total_usd"] for r in res]))
    n_pass = sum(r.passed for r in res)
    return {"scenario_id": scn.id, "policy": getattr(policy, "name", type(policy).__name__), "seeds": seeds,
            "results": res, "mean": mean, "passed_seeds": n_pass, "storm_passed": n_pass * 2 > len(res)}
