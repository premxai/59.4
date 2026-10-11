"""Feasibility simulator v0 for 4:37: a single-node ERCOT winter model.

Purpose: answer the go/no-go gates (G2 calibration, G3 difficulty, G4 validity)
before building the real harness. Deliberately simple and deterministic.

Mechanisms modeled (all documented before 2021, so calibration-safe):
  - temperature-driven demand (fit on pre-2021 hourly load)
  - cold-induced thermal unit trips and slow recovery
  - natural-gas supply loss from wellhead freeze-offs, with heating priority
  - wind icing, solar snow derate
  - electric-gas feedback: shedding unprotected gas facilities cuts gas supply
  - minute-level frequency dynamics in stressed hours, under-frequency load
    shedding, and collapse after 9 cumulative minutes below 59.4 Hz
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

FUELS = ["gas", "coal", "nuclear", "wind", "solar", "other"]
THERMAL = ["gas", "coal", "nuclear", "other"]


# --------------------------------------------------------------------------- params
@dataclass
class Fleet:
    """Installed capacity (MW) for one winter season."""
    gas: float
    coal: float
    nuclear: float
    wind: float
    solar: float
    other: float = 0.0

    def cap(self, fuel: str) -> float:
        return getattr(self, fuel)


@dataclass
class Params:
    # availability
    # 2011 FERC/NERC report: 12,413 MW scheduled outages on Feb 2, 2011 (~16% of the non-nuclear thermal fleet);
    # early February is maintenance season. Calibration-safe.
    planned_outage: dict = field(default_factory=lambda: {"gas": 0.16, "coal": 0.16, "nuclear": 0.0, "other": 0.16})
    forced_base: dict = field(default_factory=lambda: {"gas": 0.04, "coal": 0.05, "nuclear": 0.01, "other": 0.05})
    # cold trip hazard per hour: p_max / (1 + exp((T - t50) / scale)), for non-winterized units
    trip_pmax: dict = field(default_factory=lambda: {"gas": 0.020, "coal": 0.015, "nuclear": 0.004, "other": 0.020})
    trip_t50: float = -9.0          # deg C at which hazard reaches half of pmax
    trip_scale: float = 2.0
    recover_rate_warm: float = 0.05  # per hour, once local temp > 0 C
    recover_rate_cold: float = 0.004
    winterize_eff: float = 0.8       # fraction of hazard removed by winterization
    # gas fuel: share of the gas fleet starved of fuel by wellhead freeze-offs (saturating in
    # freezing degree-hours below gas_freeze_t at the basin over the last 48 h)
    gas_freeze_t: float = -4.0
    gas_loss_max: float = 0.5
    gas_loss_k: float = 300.0        # deg C * h scale
    # extra fuel loss per unit unprotected shed fraction (decays 10%/h). Upper bound derived from
    # the 2011 FERC/NERC report: 4.9 GW shed for 7.4 h coincided with only 1,282 MW of gas-supply outages.
    feedback_per_shed: float = 0.06
    # wind: CF = clip(a + b*ws + c*ws^2) on fleet-weighted 10 m wind, fit on pre-2021 output
    wind_cf_coef: tuple = (0.0, 0.03, 0.002)
    wind_cut_out: float = 25.0
    ice_gain: float = 0.08           # per hour when T<0 and precip>0
    ice_melt: float = 0.05           # per hour when T>1
    # frequency
    reserves_mw: float = 2300.0      # responsive reserve minimum (ERCOT, pre-2021)
    hz_per_gw: float = 0.14          # frequency drop per GW of deficit beyond reserves
    ufls_stages: tuple = ((59.3, 0.05), (58.9, 0.10), (58.5, 0.10))  # 5% / 15% / 25% cumulative
    collapse_hz: float = 59.4
    collapse_minutes: int = 9
    instant_collapse_hz: float = 58.4
    operator_lag_min: int = 5
    operator_shed_mw_per_min: float = 500.0
    imports_max_mw: float = 1200.0
    # customers
    customers_per_mw: float = 225.0  # assumption: ~11M meters over ~49 GW average winter load
    blackstart_days: float = 30.0
    total_customers: float = 11_000_000


# --------------------------------------------------------------------------- data
POP_WEIGHTS = {  # population-weighted Texas temperature
    "houston": 0.30, "dallas": 0.30, "san_antonio": 0.12, "austin": 0.10,
    "corpus_christi": 0.05, "midland": 0.04, "sweetwater": 0.04, "lubbock": 0.05,
}
GAS_PLANT_LOCS = {"houston": 0.4, "dallas": 0.3, "san_antonio": 0.15, "corpus_christi": 0.15}
COAL_LOCS = {"dallas": 0.5, "houston": 0.3, "austin": 0.2}
NUCLEAR_LOCS = {"dallas": 0.5, "houston": 0.5}  # Comanche Peak (N. Central), South Texas Project (Coast)
WIND_LOCS = {"sweetwater": 0.45, "lubbock": 0.2, "midland": 0.2, "corpus_christi": 0.15}
BASIN_LOC = "midland"


def weighted(df: pd.DataFrame, prefix: str, weights: dict) -> pd.Series:
    cols = {k: w for k, w in weights.items() if f"{prefix}_{k}" in df}
    tot = sum(cols.values())
    return sum(df[f"{prefix}_{k}"] * (w / tot) for k, w in cols.items())


# --------------------------------------------------------------------------- demand
class DemandModel:
    """load ~ heating + cooling degree terms + hour + weekday + trend (least squares)."""

    hdd_max = None  # set at fit time: beyond the training range the quadratic extends linearly
    cdd_max = None

    @staticmethod
    def _sq_capped(x: np.ndarray, xmax: float | None) -> np.ndarray:
        if xmax is None:
            return x ** 2
        return np.where(x <= xmax, x ** 2, xmax ** 2 + 2 * xmax * (x - xmax))  # tangent-line extension

    def _features(self, df: pd.DataFrame) -> np.ndarray:
        t = weighted(df, "temp", POP_WEIGHTS).to_numpy()
        local = df.index.tz_convert("US/Central")
        hdd = np.maximum(0.0, 15.0 - t)
        cdd = np.maximum(0.0, t - 20.0)
        cols = [np.ones_like(t), hdd, self._sq_capped(hdd, self.hdd_max), cdd, self._sq_capped(cdd, self.cdd_max),
                (local.year + local.dayofyear / 365.0 - 2015.0).to_numpy(),
                (local.dayofweek >= 5).astype(float)]
        hours = local.hour.to_numpy()
        cols += [(hours == h).astype(float) for h in range(1, 24)]
        return np.column_stack(cols)

    def fit(self, df: pd.DataFrame, load: pd.Series) -> "DemandModel":
        t = weighted(df, "temp", POP_WEIGHTS).to_numpy()
        self.hdd_max = float(np.nanmax(np.maximum(0.0, 15.0 - t)))
        self.cdd_max = float(np.nanmax(np.maximum(0.0, t - 20.0)))
        X = self._features(df)
        y = load.to_numpy()
        ok = np.isfinite(y) & np.isfinite(X).all(axis=1)
        self.coef, *_ = np.linalg.lstsq(X[ok], y[ok], rcond=None)
        resid = y[ok] - X[ok] @ self.coef
        self.rmse = float(np.sqrt(np.mean(resid ** 2)))
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        return self._features(df) @ self.coef

    def calibrate_peak(self, df_event: pd.DataFrame, target_mw: float) -> float:
        """Rescale the heating-squared term so the event peak matches a known estimate
        (e.g. ERCOT's ~59,000 MW 'demand without shedding' for Feb 2011, a pre-2021 fact)."""
        X = self._features(df_event)
        pred = X @ self.coef
        k = int(np.argmax(pred))
        if X[k, 2] > 0:
            self.coef[2] += (target_mw - pred[k]) / X[k, 2]
        return float((X @ self.coef).max())


# --------------------------------------------------------------------------- policies
@dataclass
class BuildPlan:
    winterize_plants: dict = field(default_factory=dict)   # fuel -> fraction
    winterize_wells: float = 0.0
    critical_load_map: bool = False
    battery_mw: float = 0.0
    battery_mwh: float = 0.0
    dr_mw: float = 0.0


class Policy:
    name = "base"
    build = BuildPlan()

    def act(self, obs: dict) -> dict:
        """Return {'shed_mw', 'conservation', 'dr', 'imports', 'precommit'} for this hour."""
        raise NotImplementedError


class NaivePolicy(Policy):
    """v1-like: no investments, sheds only to cover the deficit it sees right now."""
    name = "naive"

    def __init__(self):
        self.build = BuildPlan()

    def act(self, obs):
        deficit = obs["demand_now"] - obs["supply_now"]
        return {"shed_mw": max(0.0, deficit), "conservation": 0.0, "dr": 0.0,
                "imports": obs["imports_max"] if deficit > 0 else 0.0, "precommit": False}


class GoodScriptedPolicy(Policy):
    """Hand-written 'what a good operator who read the 2011 report would do'."""
    name = "good_scripted"

    def __init__(self, margin_mw: float = 2500.0):
        self.margin = margin_mw
        self.build = BuildPlan(winterize_plants={"gas": 0.5, "coal": 0.5, "nuclear": 0.5, "other": 0.3},
                               winterize_wells=0.5, critical_load_map=True)

    def act(self, obs):
        cold = obs["forecast_min_temp_48h"] < -5.0
        # anticipate the next hour's supply using the recent trend
        projected = obs["supply_now"] + 1.5 * min(0.0, obs["supply_trend_1h"])
        need = obs["demand_now"] * (0.98 if cold else 1.0) + self.margin - projected
        return {"shed_mw": max(0.0, need), "conservation": 0.02 if cold else 0.0,
                "dr": 0.0, "imports": obs["imports_max"] if cold else 0.0, "precommit": cold}


class StatusQuoPolicy(Policy):
    """Pre-2021 ERCOT emergency procedure, scripted from public rules (no hindsight):
    no extra winterization, no critical-load map; conservation appeal at EEA1 (reserves < 2,300 MW),
    imports at EEA2 (< 1,750 MW), rotating outages at EEA3 to hold reserves at 1,000 MW."""
    name = "status_quo"

    def __init__(self):
        self.build = BuildPlan()

    def act(self, obs):
        reserve = obs["supply_now"] + obs["imports_max"] - obs["demand_now"]
        eea1, eea2 = reserve < 2300, reserve < 1750
        shed = max(0.0, 1000.0 - reserve) if reserve < 1000 else 0.0
        return {"shed_mw": shed, "conservation": 0.01 if eea1 else 0.0, "dr": 0.0,
                "imports": obs["imports_max"] if eea2 else 0.0, "precommit": False}


class ScheduledShedPolicy(Policy):
    """Replays an externally given hourly shed schedule (e.g. what operators actually did)."""
    name = "scheduled"

    def __init__(self, schedule_mw: pd.Series, build: BuildPlan | None = None):
        self.schedule = schedule_mw
        self.build = build or BuildPlan()

    def act(self, obs):
        mw = float(self.schedule.get(obs["ts"], 0.0))
        return {"shed_mw": mw, "conservation": 0.0, "dr": 0.0,
                "imports": obs["imports_max"] if mw > 0 else 0.0, "precommit": False}


# --------------------------------------------------------------------------- simulator
@dataclass
class Result:
    hourly: pd.DataFrame
    collapsed: bool
    collapse_ts: pd.Timestamp | None
    customer_hours: float
    peak_shed_mw: float
    min_freq: float
    minutes_below_59_4_max: int
    cause_chain: list


def _wind_cf(ws10: np.ndarray, p: Params) -> np.ndarray:
    a, b, c = p.wind_cf_coef
    cf = np.clip(a + b * ws10 + c * ws10 ** 2, 0.0, 0.95)
    cf[ws10 >= p.wind_cut_out] = 0.0
    return cf


def fit_wind_cf(ws10: np.ndarray, cf_obs: np.ndarray) -> tuple:
    ok = np.isfinite(ws10) & np.isfinite(cf_obs)
    X = np.column_stack([np.ones(ok.sum()), ws10[ok], ws10[ok] ** 2])
    coef, *_ = np.linalg.lstsq(X, cf_obs[ok], rcond=None)
    return tuple(float(x) for x in coef)


def _solar_shape(ts: pd.DatetimeIndex) -> np.ndarray:
    h = ts.tz_convert("US/Central").hour.to_numpy() + 0.5
    return np.clip(np.sin((h - 7.0) / 11.0 * math.pi), 0.0, None) * 0.6  # winter clear-sky CF


def simulate(df: pd.DataFrame, fleet: Fleet, policy: Policy, demand: DemandModel,
             p: Params | None = None) -> Result:
    """df: hourly UTC index with temp_/wind_/precip_/snow_<loc> columns."""
    p = p or Params()
    n = len(df)
    ts = df.index
    dem = demand.predict(df)
    t_gas = weighted(df, "temp", GAS_PLANT_LOCS).to_numpy()
    t_coal = weighted(df, "temp", COAL_LOCS).to_numpy()
    t_nuc = weighted(df, "temp", NUCLEAR_LOCS).to_numpy()
    t_wind = weighted(df, "temp", WIND_LOCS).to_numpy()
    t_pw = weighted(df, "temp", POP_WEIGHTS).to_numpy()
    t_basin = df[f"temp_{BASIN_LOC}"].to_numpy()
    precip_wind = weighted(df, "precip", WIND_LOCS).to_numpy()
    wind_cf = _wind_cf(weighted(df, "wind", WIND_LOCS).to_numpy(), p)
    snow = weighted(df, "snow", POP_WEIGHTS).fillna(0).to_numpy()
    solar_cf = _solar_shape(ts)
    temps = {"gas": t_gas, "coal": t_coal, "nuclear": t_nuc, "other": t_gas}

    b = policy.build
    out = {f: 0.0 for f in THERMAL}  # cold-trip outage fraction
    G, ice, snow_cover, feedback = 1.0, 0.0, 0.0, 0.0
    fdh48 = pd.Series(np.maximum(0.0, p.gas_freeze_t - t_basin)).rolling(48, min_periods=1).sum().to_numpy()
    ufls_done = [False] * len(p.ufls_stages)
    shed_prev, supply_prev, supply_prev2 = 0.0, None, None
    below_run, below_max, min_f = 0, 0, 60.0
    collapsed, collapse_ts = False, None
    cust_hours = 0.0
    rows, chain = [], []
    future_min = pd.Series(t_pw, index=ts)[::-1].rolling(48, min_periods=1).min()[::-1].to_numpy()

    for i in range(n):
        if collapsed:
            break  # black-start penalty is added after the loop

        # --- physics: thermal trips and recovery
        for f in THERMAL:
            T = temps[f][i]
            haz = p.trip_pmax[f] / (1.0 + math.exp((T - p.trip_t50) / p.trip_scale))
            haz *= 1.0 - p.winterize_eff * b.winterize_plants.get(f, 0.0)
            rec = p.recover_rate_warm if T > 0 else p.recover_rate_cold
            out[f] = min(1.0, max(0.0, out[f] + haz * (1 - out[f]) - rec * out[f]))
        # --- gas fuel: freeze-off loss (saturating) plus electric-gas feedback from unprotected shedding
        freeze_loss = p.gas_loss_max * (1.0 - math.exp(-fdh48[i] / p.gas_loss_k))
        freeze_loss *= 1.0 - p.winterize_eff * b.winterize_wells
        unprotected_shed = 0.0 if b.critical_load_map else shed_prev / max(dem[i], 1.0)
        feedback = 0.9 * feedback + p.feedback_per_shed * unprotected_shed
        G = 1.0 - min(0.95, freeze_loss + feedback)  # share of the gas fleet that has fuel
        # --- wind icing, solar snow
        if t_wind[i] < 0 and precip_wind[i] > 0:
            ice = min(1.0, ice + p.ice_gain)
        elif t_wind[i] > 1:
            ice = max(0.0, ice - p.ice_melt)
        snow_cover = min(1.0, snow_cover + snow[i] * 0.2) if snow[i] > 0 else max(0.0, snow_cover - 0.02)

        avail = {}
        for f in THERMAL:
            avail[f] = fleet.cap(f) * (1 - p.planned_outage[f]) * (1 - p.forced_base[f]) * (1 - out[f])
        avail["gas"] *= G
        avail["wind"] = fleet.wind * wind_cf[i] * (1 - ice)
        avail["solar"] = fleet.solar * solar_cf[i] * (1 - snow_cover)
        supply = sum(avail.values())
        if supply_prev is None:
            supply_prev = supply_prev2 = supply

        # --- operator acts at the top of the hour
        obs = {"ts": ts[i], "demand_now": dem[i], "supply_now": supply_prev,
               "supply_trend_1h": supply_prev - supply_prev2,  # past-only: no lookahead into this hour
               "forecast_min_temp_48h": future_min[i], "imports_max": p.imports_max_mw,
               "temp_now": float(t_pw[i]), "freq_last": rows[-1]["freq_min"] if rows else 60.0,
               "avail_last": {k: rows[-1][f"avail_{k}"] for k in FUELS} if rows else None}
        a = policy.act(obs)
        demand_eff = dem[i] * (1 - a["conservation"]) - a["dr"]
        imports = min(a["imports"], p.imports_max_mw)
        shed = min(a["shed_mw"], demand_eff)

        # --- minute-level dynamics: supply ramps from last hour's level to this hour's
        f_min_hour, extra = 60.0, 0.0
        stressed = (demand_eff - shed) > (min(supply, supply_prev) + imports + p.reserves_mw * 0.5)
        if stressed:
            lag = 0
            for m in range(60):
                s_m = supply_prev + (supply - supply_prev) * (m + 1) / 60.0 + imports
                served = demand_eff - shed - extra
                deficit = served - s_m - p.reserves_mw
                f = 60.0 - max(0.0, deficit) / 1000.0 * p.hz_per_gw
                for k, (hz, frac) in enumerate(p.ufls_stages):
                    if f < hz and not ufls_done[k]:
                        ufls_done[k] = True
                        extra += frac * demand_eff
                        chain.append((ts[i], f"under-frequency relay shed {frac:.0%} at {hz} Hz"))
                if deficit > 0:
                    lag += 1
                    if lag > p.operator_lag_min:
                        extra += p.operator_shed_mw_per_min
                else:
                    lag = 0
                f_min_hour = min(f_min_hour, f)
                below_run = below_run + 1 if f < p.collapse_hz else 0
                below_max = max(below_max, below_run)
                if below_run > p.collapse_minutes or f < p.instant_collapse_hz:
                    collapsed, collapse_ts = True, ts[i]
                    chain.append((ts[i], f"COLLAPSE: {below_run} min below {p.collapse_hz} Hz (min {f:.2f} Hz)"))
                    break
        else:
            below_run = 0
            if shed + extra == 0:
                ufls_done = [False] * len(p.ufls_stages)

        total_shed = shed + extra
        min_f = min(min_f, f_min_hour)
        cust_hours += total_shed * p.customers_per_mw
        if total_shed > 0 and (not rows or rows[-1]["shed_mw"] == 0):
            chain.append((ts[i], f"load shed begins: {total_shed:,.0f} MW; supply {supply:,.0f} MW, demand {dem[i]:,.0f} MW, gas index {G:.2f}"))
        rows.append({"ts": ts[i], "freq_min": f_min_hour, "demand": dem[i], "supply": supply,
                     "shed_mw": total_shed, "gas_index": G, "ice": ice,
                     **{f"avail_{k}": v for k, v in avail.items()},
                     **{f"out_{f}": out[f] for f in THERMAL}})
        # each hour the operator re-decides shedding from scratch; last hour's level feeds the gas feedback
        shed_prev, supply_prev2, supply_prev = total_shed, supply_prev, supply

    if collapsed:
        cust_hours += p.total_customers * 24 * p.blackstart_days
    h = pd.DataFrame(rows).set_index("ts")
    return Result(h, collapsed, collapse_ts, cust_hours, float(h["shed_mw"].max()), min_f, below_max, chain)
