"""Data access for simulator v1, with a hard pre-2021 guard.

HONESTY RULE: nothing dated 2021-01-01 or later is ever loaded by this module.
Every time-series read goes through `_read_ts`, which pushes a `ts_utc < 2021-01-01`
filter down into the parquet reader, so 2021+ rows never enter memory. Asking for a
window that ends on or after the cutoff raises `HonestyError`.

The fleet (EIA-860 generator list) is static metadata, not weather/load, so it may be
built for any season as a capability; but `sim.scenarios` only pairs it with
pre-2021 weather.
"""
from __future__ import annotations

import json
import math
import os
from functools import lru_cache

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROC = os.path.join(ROOT, "data", "processed")
RAW = os.path.join(ROOT, "data", "raw")

CUTOFF = pd.Timestamp("2021-01-01", tz="UTC")


class HonestyError(RuntimeError):
    """Raised on any attempt to touch data dated 2021-01-01 or later."""


# The 8 ERA5 weather points (requested coordinates from DATA_REPORT.md).
REGIONS = [
    ("houston", "Houston", 29.7604, -95.3698),
    ("dallas", "Dallas", 32.7767, -96.7970),
    ("san_antonio", "San Antonio", 29.4241, -98.4936),
    ("austin", "Austin", 30.2672, -97.7431),
    ("midland", "Midland", 31.9973, -102.0779),
    ("sweetwater", "Sweetwater", 32.4710, -100.4059),
    ("corpus_christi", "Corpus Christi", 27.8006, -97.3964),
    ("lubbock", "Lubbock", 33.5779, -101.8552),
]
REGION_IDS = [r[0] for r in REGIONS]
R = len(REGIONS)
RIDX = {r: i for i, r in enumerate(REGION_IDS)}

# population weights for the demand-model temperature (same as v0)
POP_WEIGHTS = {"houston": 0.30, "dallas": 0.30, "san_antonio": 0.12, "austin": 0.10,
               "corpus_christi": 0.05, "midland": 0.04, "sweetwater": 0.04, "lubbock": 0.05}
# wind-speed weights used by the v0 wind CF fit (fleet-weighted 10 m wind)
WIND_LOCS = {"sweetwater": 0.45, "lubbock": 0.2, "midland": 0.2, "corpus_christi": 0.15}
# gas production basins -> nearest weather point; weights ~ 2011 basin production declines
# (FERC-2011 p.114: Permian 1.31, Fort Worth 1.63, East Texas 0.72, Gulf Coast 0.65 Bcf/d; San Juan is NM)
BASIN_WEIGHTS = {"midland": 0.30, "dallas": 0.45, "houston": 0.13, "corpus_christi": 0.12}

VARS = ("temp", "wind", "precip", "snow")


def slug(s: str) -> str:
    return s.lower().replace(" ", "_")


def to_utc(x) -> pd.Timestamp:
    t = pd.Timestamp(x)
    return t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")


def _guard(end) -> None:
    e = to_utc(end)
    if e >= CUTOFF:
        raise HonestyError(f"requested data through {e}, which is on/after the 2021-01-01 cutoff")


def _read_ts(name: str, columns=None, start=None) -> pd.DataFrame:
    filters = [("ts_utc", "<", CUTOFF)]
    if start is not None:
        filters.append(("ts_utc", ">=", to_utc(start)))
    df = pd.read_parquet(os.path.join(PROC, name), columns=columns, filters=filters)
    if len(df) and df["ts_utc"].max() >= CUTOFF:  # belt and braces
        raise HonestyError(f"{name}: post-cutoff rows leaked through the filter")
    return df


CACHE_DIR = os.path.join(os.path.dirname(__file__), "_cache")


@lru_cache(maxsize=1)
def weather_wide() -> pd.DataFrame:
    """All pre-2021 ERA5 weather, wide: columns temp_<loc>, wind_<loc>, precip_<loc>, snow_<loc>.
    Cached (pre-2021 rows only, float32) in sim/_cache/ so parallel workers stay small."""
    src = os.path.join(PROC, "weather_hourly.parquet")
    cache = os.path.join(CACHE_DIR, "weather_wide_pre2021.pkl")
    if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(src):
        wide = pd.read_pickle(cache)
        if wide.index.max() >= CUTOFF:
            raise HonestyError("weather cache contains post-cutoff rows")
        return wide.astype(float)
    wide = _weather_wide_build().astype("float32")
    os.makedirs(CACHE_DIR, exist_ok=True)
    wide.to_pickle(cache)
    return wide.astype(float)


def _weather_wide_build() -> pd.DataFrame:
    w = _read_ts("weather_hourly.parquet", columns=["ts_utc", "location", "temp_c", "wind_ms", "precip_mm", "snowfall_cm"])
    w["loc"] = w["location"].map(slug)
    wide = w.pivot_table(index="ts_utc", columns="loc",
                         values=["temp_c", "wind_ms", "precip_mm", "snowfall_cm"], aggfunc="first")
    rename = {"temp_c": "temp", "wind_ms": "wind", "precip_mm": "precip", "snowfall_cm": "snow"}
    wide.columns = [f"{rename[a]}_{b}" for a, b in wide.columns]
    return wide.sort_index()


@lru_cache(maxsize=1)
def weather_1989() -> pd.DataFrame:
    """Dec 1989 freeze weather from the raw Open-Meteo JSON (hour-beginning GMT -> hour-ending UTC), as in v0."""
    raw = os.path.join(RAW, "open_meteo")
    cols = {}
    for fn in os.listdir(raw):
        if not fn.endswith("_1989.json"):
            continue
        loc = slug(fn[: -len("_1989.json")].replace("_", " "))
        with open(os.path.join(raw, fn)) as fh:
            h = json.load(fh)["hourly"]
        idx = pd.to_datetime(h["time"], utc=True) + pd.Timedelta(hours=1)
        for src, dst in [("temperature_2m", "temp"), ("wind_speed_10m", "wind"),
                         ("precipitation", "precip"), ("snowfall", "snow")]:
            cols[f"{dst}_{loc}"] = pd.Series(h[src], index=idx, dtype=float)
    return pd.DataFrame(cols).sort_index()


def weather_window(start, end) -> pd.DataFrame:
    """Hourly weather [start, end] (UTC, inclusive). 1989 comes from the raw JSON; 2007-2020 from the parquet."""
    _guard(end)
    s, e = to_utc(start), to_utc(end)
    src = weather_1989() if s.year < 2007 else weather_wide()
    out = src.loc[s:e]
    if len(out) == 0:
        raise ValueError(f"no weather for {start}..{end}")
    return out


@lru_cache(maxsize=1)
def load_hourly() -> pd.Series:
    df = _read_ts("ercot_load_hourly.parquet", columns=["ts_utc", "load_mw"])
    return df.set_index("ts_utc")["load_mw"].sort_index()


@lru_cache(maxsize=1)
def gen_by_fuel() -> pd.DataFrame:
    df = _read_ts("ercot_gen_by_fuel_hourly.parquet", columns=["ts_utc", "fuel", "mw"])
    return df.pivot_table(index="ts_utc", columns="fuel", values="mw", aggfunc="sum").sort_index()


@lru_cache(maxsize=1)
def capacity_by_fuel() -> pd.DataFrame:
    return pd.read_csv(os.path.join(PROC, "ercot_capacity_by_fuel_winter.csv"))


@lru_cache(maxsize=1)
def generators() -> pd.DataFrame:
    return pd.read_csv(os.path.join(PROC, "ercot_generators.csv"))


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


def nearest_region(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    d = np.stack([haversine_km(lat, lon, r[2], r[3]) for r in REGIONS], axis=1)
    return np.argmin(d, axis=1)


def weights_vec(weights: dict) -> np.ndarray:
    v = np.zeros(R)
    for k, w in weights.items():
        v[RIDX[k]] = w
    return v / v.sum()


def wide_to_arrays(df: pd.DataFrame) -> dict:
    """wide frame -> {'temp': (n, R), 'wind':..., 'precip':..., 'snow':...} in REGION order."""
    out = {}
    for v in VARS:
        out[v] = np.column_stack([df[f"{v}_{r}"].to_numpy(dtype=float) if f"{v}_{r}" in df else np.zeros(len(df))
                                  for r in REGION_IDS])
        out[v] = np.nan_to_num(out[v], nan=0.0)
    return out


def tx_cities() -> list:
    with open(os.path.join(PROC, "tx_cities.json")) as fh:
        return json.load(fh)


__all__ = ["CUTOFF", "HonestyError", "REGIONS", "REGION_IDS", "R", "RIDX", "POP_WEIGHTS", "WIND_LOCS",
           "BASIN_WEIGHTS", "weather_wide", "weather_1989", "weather_window", "load_hourly", "gen_by_fuel",
           "capacity_by_fuel", "generators", "nearest_region", "weights_vec", "wide_to_arrays", "math"]
