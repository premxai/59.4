"""Locked exams: storms the harness never sees while learning (evaluator path only).

The locked simulator (`sim/`, hash in sim/LOCK.json) refuses to load anything dated 2021 or later, by design:
calibration and every training/held-out storm are pre-2021. The locked exams are run once, after the manual is
frozen, so this module builds their storm "world" OUTSIDE that guard, using exactly the steps of
`Scenario.materialize()` for a historical storm (no transforms): read the hourly weather window, convert it to
region arrays, then hand the spec to the unchanged `sim.engine.build_world` and `simulate`. Only weather enters
from the exam period; every model parameter stays the pre-2021 calibration.

`check_equivalence()` proves the loader is faithful: for the Feb 2011 calibration storm it must produce
identical arrays to `sim.api.get_world`. The learning loop never imports this module.

The agent never sees names or dates (harness.anonymize); exams carry neutral public labels.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

from sim import data as D
from sim import engine
from sim.api import default_params

EXAMS = {
    # Winter Storm Uri (Feb 2021). Shown to the AI only as "Locked storm #1", day/hour stamps, regions A-H.
    "locked_2021_feb": {"public": "Locked storm #1", "start": "2021-02-08 00:00", "end": "2021-02-21 23:00",
                        "fleet_year": 2021},
}


def _weather_window_unguarded(start, end) -> pd.DataFrame:
    s, e = D.to_utc(start), D.to_utc(end)
    w = pd.read_parquet(os.path.join(D.PROC, "weather_hourly.parquet"),
                        columns=["ts_utc", "location", "temp_c", "wind_ms", "precip_mm", "snowfall_cm"],
                        filters=[("ts_utc", ">=", s), ("ts_utc", "<=", e)])
    w["loc"] = w["location"].map(D.slug)
    wide = w.pivot_table(index="ts_utc", columns="loc", values=["temp_c", "wind_ms", "precip_mm", "snowfall_cm"],
                         aggfunc="first")
    rename = {"temp_c": "temp", "wind_ms": "wind", "precip_mm": "precip", "snowfall_cm": "snow"}
    wide.columns = [f"{rename[a]}_{b}" for a, b in wide.columns]
    wide = wide.sort_index().astype("float32").astype(float)   # same dtype path as sim.data.weather_wide()
    if len(wide) == 0:
        raise ValueError(f"no weather for {start}..{end}")
    return wide


def spec_for(exam_id: str, start=None, end=None, fleet_year=None, public=None) -> dict:
    ex = EXAMS.get(exam_id, {})
    start, end = start or ex["start"], end or ex["end"]
    wide = _weather_window_unguarded(start, end)
    wx = D.wide_to_arrays(wide)
    n = len(wide.index)
    ts = pd.date_range(D.to_utc(start), periods=n, freq="h")
    return {"id": exam_id, "public": public or ex.get("public", exam_id), "ts": ts, "wx": wx,
            "fleet_year": int(fleet_year or ex["fleet_year"]), "demand_year": None, "demand_peak_mw": None,
            "demand_mult": np.ones(n), "kind": "locked", "source_window": [start, end], "transforms": [],
            "failure_modes": [], "description": "", "split": "locked"}


def world(exam_id: str):
    return engine.build_world(spec_for(exam_id), default_params())


def run(exam_id: str, policy, seed: int = 0):
    """Simulate one locked exam with one policy (same engine and parameters as every other storm)."""
    p = default_params()
    return engine.simulate(world(exam_id), policy, p, seed=seed)


def check_equivalence() -> dict:
    """Feb 2011 built by this loader must equal the locked simulator's own world, array for array."""
    from sim import api
    from sim.scenarios import get
    ref_scn = get("hist_2011_feb")
    ref = api.get_world(ref_scn, default_params())
    mine = engine.build_world(spec_for("check_2011", ref_scn.start, ref_scn.end, ref_scn.fleet_year), default_params())
    diffs = {}
    for k, v in vars(ref).items():
        mv = getattr(mine, k, None)
        if isinstance(v, np.ndarray):
            diffs[k] = float(np.max(np.abs(v.astype(float) - np.asarray(mv, dtype=float)))) if v.size else 0.0
        elif isinstance(v, dict):
            for kk, vv in v.items():
                if isinstance(vv, np.ndarray):
                    diffs[f"{k}.{kk}"] = float(np.max(np.abs(vv.astype(float) - np.asarray(mv[kk], dtype=float)))) if vv.size else 0.0
    worst = max(diffs.values()) if diffs else 0.0
    return {"arrays_compared": len(diffs), "max_abs_diff": worst, "identical": worst == 0.0,
            "nonzero": {k: d for k, d in diffs.items() if d}}


if __name__ == "__main__":
    print(check_equivalence())
