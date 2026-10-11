"""Unit-level ERCOT fleet for one winter season, built from EIA-860 (`ercot_generators.csv`).

Assumptions (documented, calibration-safe sources only):
  * Season `year` means the winter whose February falls in `year`; units count if they were
    operating on Feb 1 of that year and not retired before it (same rule as
    `ercot_capacity_by_fuel_winter.csv`).
  * Units are aggregated per (plant, fuel_detail) and split into balanced blocks of at most
    1,300 MW. A combined-cycle train or a CT farm typically trips together (shared sensing
    lines / fuel header), which gives the lumpy 100-1,300 MW trips seen in real events.
  * EIA-860 overstates dispatchable gas capacity (private-use-network cogeneration, mothballed
    units; DATA_REPORT.md). Gas (and "other") winter ratings are scaled by one factor chosen so
    the Feb 2011 thermal fleet equals FERC-2011's 74,345 MW (79,658 MW total fleet at 8 AM Feb 2
    minus wind at 57% of 9,321 MW). The same factor is applied to every season. Coal and nuclear
    EIA ratings agree with FERC-2011's derived mix and are not scaled.
  * Dec 1989: ~54,000 MW / 323 units (FERC-2011 fn.234). EIA-860 omits units retired before 2007,
    so we take units operating by 1989 and rescale each fuel to our approximate split:
    gas 35,000 / coal 15,000 / nuclear 2,500 (STP 1-2) / other 1,500 MW nameplate, x 0.96 for winter
    rating (EIA Feb 2011 winter/nameplate ratio). The split is OUR approximation (FERC gives only the
    total); wind/solar = 0.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
import pandas as pd

from . import data as D

THERMAL_FUELS = ["gas", "coal", "nuclear", "other"]
FUEL_CODE = {f: i for i, f in enumerate(THERMAL_FUELS)}
DETAIL_ORDER = ["nuclear", "coal", "gas_cc", "gas_steam", "other", "gas_ct", "gas_ice"]  # merit order
GAS_DETAILS = {"gas_cc", "gas_steam", "gas_ct", "gas_ice"}
OTHER_DETAILS = {"oil", "biomass", "hydro", "other"}
MAX_BLOCK_MW = 1300.0
FERC_2011_THERMAL_MW = 74345.0
FLEET_1989_SPLIT = {"gas": 35000.0, "coal": 15000.0, "nuclear": 2500.0, "other": 1500.0}
WINTER_OVER_NAMEPLATE = 0.96   # EIA-860 Feb 2011: 92.1 GW winter rating / 95.9 GW nameplate


@dataclass
class Fleet:
    year: int
    cap: np.ndarray            # (U,) MW winter rating (scaled)
    fuel: np.ndarray           # (U,) int code into THERMAL_FUELS
    detail: np.ndarray         # (U,) str fuel_detail
    region: np.ndarray         # (U,) int region index
    merit: np.ndarray          # (U,) int rank (0 = first committed)
    name: np.ndarray           # (U,) plant name
    lat: np.ndarray
    lon: np.ndarray
    wind_by_region: np.ndarray  # (R,) MW
    solar_by_region: np.ndarray  # (R,) MW
    storage_mw: float
    notes: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.cap)

    def cap_by_fuel(self) -> dict:
        out = {f: float(self.cap[self.fuel == FUEL_CODE[f]].sum()) for f in THERMAL_FUELS}
        out["wind"] = float(self.wind_by_region.sum())
        out["solar"] = float(self.solar_by_region.sum())
        return out


def _class(detail: str) -> str:
    if detail in GAS_DETAILS:
        return "gas"
    if detail in OTHER_DETAILS:
        return "other"
    return detail


def _operating_mask(g: pd.DataFrame, year: int) -> np.ndarray:
    asof = year * 12 + 2  # Feb of `year`
    op = g["operating_year"].fillna(9999) * 12 + g["operating_month"].fillna(1)
    ret = g["retirement_year"].fillna(9999) * 12 + g["retirement_month"].fillna(12)
    ok = (op <= asof) & (ret > asof)
    return ok.to_numpy() & (g["status"] != "MISSING_IN_2025").to_numpy()


def _blocks(g: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for (pid, det), grp in g.groupby(["plant_id", "fuel_detail"], sort=True):
        tot = float(grp["winter_mw"].fillna(grp["nameplate_mw"]).sum())
        if tot <= 0:
            continue
        k = max(1, int(np.ceil(tot / MAX_BLOCK_MW)))
        if det == "nuclear":  # nuclear units stay individual
            for _, u in grp.iterrows():
                rows.append((pid, det, float(u["winter_mw"]), u["plant_name"], u["lat"], u["lon"]))
            continue
        for _ in range(k):
            rows.append((pid, det, tot / k, grp["plant_name"].iloc[0], grp["lat"].iloc[0], grp["lon"].iloc[0]))
    return pd.DataFrame(rows, columns=["plant_id", "detail", "cap", "name", "lat", "lon"])


@lru_cache(maxsize=1)
def gas_scale() -> float:
    """EIA -> ERCOT dispatchable scale for gas/other, fixed on Feb 2011 (FERC-2011 thermal 74,345 MW)."""
    g = D.generators()
    g = g[_operating_mask(g, 2011)]
    th = g[g["fuel_detail"].isin(DETAIL_ORDER) | g["fuel_detail"].isin(OTHER_DETAILS)]
    w = th["winter_mw"].fillna(th["nameplate_mw"])
    cls = th["fuel_detail"].map(_class)
    fixed = float(w[cls.isin(["coal", "nuclear"])].sum())
    scal = float(w[cls.isin(["gas", "other"])].sum())
    return (FERC_2011_THERMAL_MW - fixed) / scal


@lru_cache(maxsize=32)
def build_fleet(year: int) -> Fleet:
    """Unit-level fleet for the winter whose February is in `year` (1989 handled specially)."""
    g = D.generators()
    special_1989 = year < 2007
    if special_1989:
        mask = (g["operating_year"].fillna(9999) <= year).to_numpy() & (g["status"] != "MISSING_IN_2025").to_numpy()
    else:
        mask = _operating_mask(g, year)
    g = g[mask].copy()
    g["winter_mw"] = g["winter_mw"].fillna(g["nameplate_mw"])
    th = g[g["fuel_detail"].isin(DETAIL_ORDER) | g["fuel_detail"].isin(OTHER_DETAILS)].copy()
    th["fuel_detail"] = th["fuel_detail"].where(~th["fuel_detail"].isin(OTHER_DETAILS), "other")
    b = _blocks(th)
    cls = b["detail"].map(_class)
    notes = {}
    if special_1989:
        for f, target in FLEET_1989_SPLIT.items():
            m = cls == f
            have = float(b.loc[m, "cap"].sum())
            if have > 0:
                b.loc[m, "cap"] *= target * WINTER_OVER_NAMEPLATE / have
            notes[f"scale_{f}"] = round(target / have, 3) if have else None
        wind = np.zeros(D.R)
        solar = np.zeros(D.R)
        storage = 0.0
    else:
        k = gas_scale()
        b.loc[cls.isin(["gas", "other"]), "cap"] *= k
        notes["gas_other_scale"] = round(k, 4)
        wnd = g[g["fuel_detail"] == "wind"]
        sol = g[g["fuel_detail"] == "solar"]
        wind = np.bincount(D.nearest_region(wnd["lat"].to_numpy(), wnd["lon"].to_numpy()),
                           weights=wnd["winter_mw"].to_numpy(), minlength=D.R).astype(float)
        solar = np.bincount(D.nearest_region(sol["lat"].to_numpy(), sol["lon"].to_numpy()),
                            weights=sol["winter_mw"].to_numpy(), minlength=D.R).astype(float)
        storage = float(g.loc[g["fuel_detail"] == "storage", "winter_mw"].sum())
    b = b.sort_values(["detail", "cap"], key=lambda s: s.map({d: i for i, d in enumerate(DETAIL_ORDER)})
                      if s.name == "detail" else -s).reset_index(drop=True)
    merit_key = b["detail"].map({d: i for i, d in enumerate(DETAIL_ORDER)}).to_numpy() * 1e5 - b["cap"].to_numpy()
    merit = np.argsort(np.argsort(merit_key, kind="stable"), kind="stable")
    region = D.nearest_region(b["lat"].to_numpy(dtype=float), b["lon"].to_numpy(dtype=float))
    return Fleet(year=year, cap=b["cap"].to_numpy(dtype=float),
                 fuel=b["detail"].map(lambda d: FUEL_CODE[_class(d)]).to_numpy(dtype=int),
                 detail=b["detail"].to_numpy(dtype=object), region=region, merit=merit,
                 name=b["name"].to_numpy(dtype=object), lat=b["lat"].to_numpy(dtype=float),
                 lon=b["lon"].to_numpy(dtype=float), wind_by_region=wind, solar_by_region=solar,
                 storage_mw=storage, notes=notes)


def season_info(fleet: Fleet) -> dict:
    """What a planner can know before the season (used by policy.build)."""
    by = fleet.cap_by_fuel()
    units = {f: int((fleet.fuel == FUEL_CODE[f]).sum()) for f in THERMAL_FUELS}
    return {"fleet_year": fleet.year, "capacity_mw": {k: round(v) for k, v in by.items()}, "units": units,
            "storage_mw": round(fleet.storage_mw)}
