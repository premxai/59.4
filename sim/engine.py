"""Simulator v1 engine: unit-level ERCOT winter model with minute-level frequency in stressed hours.

Physics per hour (all deterministic given the seed; every random draw is made up front from
per-seed streams, so different policies on the same seed see the same weather, thresholds,
trip minutes and repair times: common random numbers):

  1. operator acts (obs = state at the end of the previous hour + current demand + noisy forecasts)
  2. unit availability: planned outages (seasonal), background forced outages (Markov),
     cold trips (vulnerable units whose cold exposure crosses their threshold), gas fuel starvation
     (freeze-off production loss -> deliverability -> per-unit fuel rank; + electric-gas feedback),
     fail-to-start of units started in the cold (merit-order commitment; precommit avoids it)
  3. each unit that changes state does so at its own minute -> lumpy intra-hour supply
  4. minute loop (only when stressed): frequency from reserve shortfall / deficit + trip
     transients; Load Resources trip at 59.7 Hz; battery fast response below 59.8 Hz; UFLS
     5/15/25% at 59.3/58.9/58.5 Hz; real-time desk sheds after a lag; collapse after >9 minutes
     at <=59.4 Hz (counter resets after 10 minutes above) or instantly below 58.4 Hz
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import data as D
from . import levers as L
from .demand import DemandModel, pop_temp
from .fleet import FUEL_CODE, THERMAL_FUELS, Fleet, build_fleet, season_info
from .params import Params

GAS, COAL, NUC, OTH = (FUEL_CODE[f] for f in ("gas", "coal", "nuclear", "other"))
FC_H = 72
FC_ISSUE_H = 6       # a new weather forecast is issued every 6 h (NWP cycle); the operator sees the latest one
KERNEL_LEN = 60
PASS_MAX_SHED_FRAC = 0.20   # a storm is PASSED if no collapse AND worst-hour shed <= 20% of demand


# =========================================================================== world (seed-independent)
@dataclass
class World:
    scenario_id: str
    public: str
    ts: pd.DatetimeIndex
    fleet: Fleet
    wx: dict
    t_pw: np.ndarray
    demand: np.ndarray
    base_ext: np.ndarray       # calendar part of demand for n + FC_H hours (for demand forecasts)
    dscale: np.ndarray         # (n + FC_H,) multiplicative demand scale (event scaling x surge)
    expo: np.ndarray           # (n, R) cold exposure
    prod_loss: np.ndarray      # (n,) basin-weighted gas production loss share (before well winterization)
    basin_temp: np.ndarray
    wind_cf: np.ndarray        # (n,)
    wind_ok: np.ndarray        # (n, R) 1 - icing/low-temp loss
    solar: np.ndarray          # (n,) MW
    planned_frac: np.ndarray   # (n,)
    local_hour: np.ndarray
    snow_cover: np.ndarray     # (n, R) 0..1
    temp_ext: np.ndarray       # (n + FC_H, R) truth padded with last value (only used to build noisy forecasts)
    surge: np.ndarray          # (n,) synthetic demand-surge multiplier (1 = none)
    meta: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.ts)


def _ewma(x: np.ndarray, tau: float) -> np.ndarray:
    a = 1.0 - math.exp(-1.0 / max(tau, 1e-6))
    out = np.empty_like(x)
    acc = x[0].copy()
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        out[i] = acc
    return out


def planned_fraction(ts: pd.DatetimeIndex, knots) -> np.ndarray:
    local = ts.tz_convert("US/Central")
    yr = np.where(local.month <= 6, local.year, local.year + 1)
    jan1 = pd.to_datetime([f"{y}-01-01" for y in yr]).tz_localize("US/Central")
    days = (local - jan1).total_seconds().to_numpy() / 86400.0
    k = np.asarray(knots, dtype=float)
    return np.interp(days, k[:, 0], k[:, 1])


def solar_shape(ts: pd.DatetimeIndex) -> np.ndarray:
    h = ts.tz_convert("US/Central").hour.to_numpy() + 0.5
    return np.clip(np.sin((h - 7.0) / 11.0 * math.pi), 0.0, None) * 0.6  # winter clear-sky CF (v0)


def build_world(spec: dict, p: Params) -> World:
    """spec: output of Scenario.materialize(): ts, wx arrays, fleet_year, demand scaling."""
    ts = spec["ts"]
    n = len(ts)
    wx = spec["wx"]
    fleet = build_fleet(int(spec["fleet_year"]))
    dm = DemandModel.from_dict(p.demand)
    t_pw = pop_temp(wx["temp"])
    ts_ext = pd.date_range(ts[0], periods=n + FC_H, freq="h")
    year_shift = float(spec["demand_year"] - ts[len(ts) // 2].year) if spec.get("demand_year") else 0.0
    base_ext = dm.base_part(ts_ext, year_shift)
    raw = base_ext[:n] + dm.temp_part(t_pw)
    k_event = 1.0
    if spec.get("demand_peak_mw"):
        k_event = float(spec["demand_peak_mw"]) / float(raw.max())
    mult = np.ones(n + FC_H) * k_event
    dmult = np.asarray(spec.get("demand_mult", 1.0), dtype=float)
    if dmult.ndim == 0:
        mult *= float(dmult)
    else:
        mult[:n] *= dmult
        mult[n:] *= dmult[-1]
    demand = raw * mult[:n]

    T, W, P, S = wx["temp"], wx["wind"], wx["precip"], wx["snow"]
    t_eff = np.where(T < 5.0, T - p.windchill_k * np.maximum(0.0, W - 2.0), T)
    expo = _ewma(t_eff, p.expo_tau_h)

    # gas production loss: leaky freezing-degree-hour accumulator per basin
    bw = D.weights_vec(D.BASIN_WEIGHTS)
    a = math.exp(-1.0 / p.gas_tau_h)
    F = np.zeros(D.R)
    loss = np.zeros(n)
    fz = np.maximum(0.0, p.gas_freeze_t - T)
    for i in range(n):
        F = F * a + fz[i]
        loss[i] = float(bw @ (p.prod_loss_max * (1.0 - np.exp(-F / p.prod_loss_k))))
    basin_temp = T @ bw

    # wind: v0 CF fit on fleet-weighted wind speed; icing and low-temperature limits per region
    ws = W @ D.weights_vec(D.WIND_LOCS)
    a0, a1, a2 = p.wind_cf_coef
    cf = np.clip(a0 + a1 * ws + a2 * ws ** 2, 0.0, 0.95)
    cf[ws >= p.wind_cut_out] = 0.0
    ice = np.zeros((n, D.R))
    acc = np.zeros(D.R)
    for i in range(n):
        icing = (T[i] < 0.0) & (P[i] > 0.0)
        melt = T[i] > 1.0
        acc = np.where(icing, np.minimum(1.0, acc + p.ice_gain * np.minimum(1.0, P[i] / 0.3 + 0.3)),
                       np.where(melt, np.maximum(0.0, acc - p.ice_melt), acc))
        ice[i] = acc
    lowt = np.clip((p.wind_lowtemp_c - T) / p.wind_lowtemp_span, 0.0, 1.0)
    wind_ok = (1.0 - ice) * (1.0 - lowt)

    # snow cover (solar derate + viewer)
    sc = np.zeros((n, D.R))
    acc = np.zeros(D.R)
    for i in range(n):
        acc = np.where(S[i] > 0, np.minimum(1.0, acc + S[i] * 0.2), np.maximum(0.0, acc - 0.02))
        sc[i] = acc
    solar = fleet.solar_by_region.sum() * solar_shape(ts) * (1.0 - sc.mean(axis=1))

    temp_ext = np.vstack([T, np.repeat(T[-1:], FC_H, axis=0)])
    return World(scenario_id=spec["id"], public=spec.get("public", spec["id"]), ts=ts, fleet=fleet, wx=wx,
                 t_pw=t_pw, demand=demand, base_ext=base_ext, dscale=mult, expo=expo, prod_loss=loss,
                 basin_temp=basin_temp, wind_cf=cf, wind_ok=wind_ok, solar=solar,
                 planned_frac=planned_fraction(ts, p.planned_knots),
                 local_hour=ts.tz_convert("US/Central").hour.to_numpy(), snow_cover=sc, temp_ext=temp_ext,
                 surge=(np.ones(n) * dmult) if dmult.ndim == 0 else dmult.copy(),
                 meta={k: v for k, v in spec.items() if k not in ("ts", "wx")})


# =========================================================================== observation
class Obs(dict):
    """What a real operator could see at the top of hour i. Heavy keys are computed lazily.
    No future truth: forecasts are noisy, with error growing with horizon."""

    def __init__(self, base: dict, sim: "_Run", i: int):
        super().__init__(base)
        self._sim, self._i = sim, i

    def __missing__(self, key):
        s, i = self._sim, self._i
        if key == "forecast_temp_72h":  # (72, R) by region, hours i+1 .. i+72, from the latest 6-hourly issue
            j, age = divmod(i, FC_ISSUE_H)
            v = s.w.temp_ext[i + 1:i + 1 + FC_H] + s.fc_err[j, age:age + FC_H]
        elif key == "forecast_temp_pw_72h":
            v = self["forecast_temp_72h"] @ _POPW
        elif key == "demand_forecast_72h":
            dm = s.dm
            v = (s.w.base_ext[i + 1:i + 1 + FC_H] + dm.temp_part(self["forecast_temp_pw_72h"])) * s.w.dscale[i + 1:i + 1 + FC_H]
        elif key == "forecast_issued_hours_ago":
            v = int(i % FC_ISSUE_H)
        elif key in ("forecast_min_temp_24h", "forecast_min_temp_48h", "forecast_min_temp_72h"):
            hz = int(key.split("_")[-1][:-1])
            v = round(float(self["forecast_temp_pw_72h"][:hz].min()), 2)
        elif key in ("forecast_min_temp_by_region_24h", "forecast_min_temp_by_region_48h",
                     "forecast_min_temp_by_region_72h"):
            hz = int(key.split("_")[-1][:-1])
            v = dict(zip(D.REGION_IDS, np.round(self["forecast_temp_72h"][:hz].min(axis=0), 2).tolist()))
        elif key in ("forecast_coldest_region_min_24h", "forecast_coldest_region_min_48h",
                     "forecast_coldest_region_min_72h"):
            hz = int(key.split("_")[-1][:-1])
            v = round(float(self["forecast_temp_72h"][:hz].min()), 2)
        elif key == "forecast_temp_by_region_72h":
            v = {r: np.round(self["forecast_temp_72h"][:, k], 2).tolist() for k, r in enumerate(D.REGION_IDS)}
        elif key == "forecast":
            v = {f"{h}h": {"statewide_min_c": self[f"forecast_min_temp_{h}h"],
                           "coldest_region_min_c": self[f"forecast_coldest_region_min_{h}h"],
                           "by_region_min_c": self[f"forecast_min_temp_by_region_{h}h"]} for h in (24, 48, 72)}
            v["issued_hours_ago"] = self["forecast_issued_hours_ago"]
        else:
            raise KeyError(key)
        self[key] = v
        return v

    def keys_all(self) -> list:
        """Every key (eager + lazy) an operator may read."""
        return sorted(set(self.keys()) | set(LAZY_OBS_KEYS))


LAZY_OBS_KEYS = ("forecast_temp_72h", "forecast_temp_pw_72h", "demand_forecast_72h", "forecast_issued_hours_ago",
                 "forecast_min_temp_24h", "forecast_min_temp_48h", "forecast_min_temp_72h",
                 "forecast_min_temp_by_region_24h", "forecast_min_temp_by_region_48h", "forecast_min_temp_by_region_72h",
                 "forecast_coldest_region_min_24h", "forecast_coldest_region_min_48h",
                 "forecast_coldest_region_min_72h", "forecast_temp_by_region_72h", "forecast")


_POPW = D.weights_vec(D.POP_WEIGHTS)


# =========================================================================== result
@dataclass
class Result:
    scenario_id: str
    policy: str
    seed: int
    collapsed: bool
    collapse_hour: int | None
    collapse_ts: str | None
    homes_dark_hours: float
    peak_homes_dark: float
    peak_shed_mw: float
    shed_hours: int
    min_freq: float
    max_below_59_4_min: int
    unnecessary_homes_hours: float
    cost: dict
    score: dict
    cause_chain: list
    cause_summary: str
    events: list
    build: dict
    budget_scale: float
    hourly: dict
    world: World | None = None
    runtime_s: float = 0.0
    peak_shed_frac: float = 0.0        # max over hours (before any collapse) of shed_mw / demand
    worst_hour: int | None = None      # hour index of that maximum (None if nothing was shed)

    # ------------------------------------------------------------------ scoreboard verdict
    @property
    def passed(self) -> bool:
        """PASSED = the grid never totally collapses AND at the worst hour at least 80% of homes still
        have power (peak shed <= 20% of that hour's demand)."""
        return (not self.collapsed) and self.peak_shed_frac <= PASS_MAX_SHED_FRAC + 1e-9

    @property
    def verdict_plain(self) -> str:
        if self.collapsed:
            return f"Failed: total blackout at hour {self.collapse_hour}"
        pct = int(round(100 * self.peak_shed_frac))
        if self.passed:
            if self.peak_shed_frac <= 0.0:
                return "Passed: no homes lost power, no blackout"
            return f"Passed: worst moment {max(pct, 1)}% of homes dark, no blackout"
        return f"Failed: {pct}% of homes dark at the worst hour (hour {self.worst_hour})"

    def frame(self) -> pd.DataFrame:
        h = dict(self.hourly)
        ts = h.pop("ts")
        return pd.DataFrame(h, index=ts)

    def summary(self) -> dict:
        return {"scenario_id": self.scenario_id, "policy": self.policy, "seed": self.seed,
                "passed": self.passed, "verdict_plain": self.verdict_plain,
                "peak_shed_frac": round(self.peak_shed_frac, 4), "worst_hour": self.worst_hour,
                "collapsed": self.collapsed, "collapse_hour": self.collapse_hour,
                "homes_dark_hours": round(self.homes_dark_hours), "peak_homes_dark": round(self.peak_homes_dark),
                "peak_shed_mw": round(self.peak_shed_mw), "shed_hours": self.shed_hours,
                "min_freq": round(self.min_freq, 3), "max_below_59_4_min": self.max_below_59_4_min,
                "unnecessary_homes_hours": round(self.unnecessary_homes_hours),
                "cost_usd": round(self.cost["total_usd"]), "score": round(self.score["total"]),
                "cause_summary": self.cause_summary, "budget_scale": round(self.budget_scale, 3),
                "runtime_s": round(self.runtime_s, 3)}


# =========================================================================== cause tracking
class Causes:
    def __init__(self, w: World):
        self.w = w
        self.events = []      # cause-chain entries
        self.flags = set()
        self.cold_run = np.zeros(D.R, dtype=int)
        self.max_cold_run = np.zeros(D.R, dtype=int)

    def add(self, i, kind, text, **kw):
        self.events.append({"h": int(i), "t": self.w.ts[i].strftime("%Y-%m-%dT%H:%MZ"), "kind": kind, "text": text, **kw})

    def once(self, key, i, kind, text, **kw):
        if key not in self.flags:
            self.flags.add(key)
            self.add(i, kind, text, **kw)
            return True
        return False

    def cold_note(self, i) -> str:
        r = int(np.argmax(self.cold_run))
        if self.cold_run[r] == 0:
            r = int(np.argmin(self.w.wx["temp"][i]))
            return f"{D.REGIONS[r][1]} at {self.w.wx['temp'][i, r]:.0f} C"
        lo = float(self.w.wx["temp"][max(0, i - self.cold_run[r] + 1):i + 1, r].min())
        return f"{D.REGIONS[r][1]} below -5 C for {self.cold_run[r]} h (low {lo:.0f} C)"


def _summary_chain(c: Causes, collapsed: bool, peak_shed: float) -> str:
    """Compact causal chain: first onset of each mechanism (with its peak), in time order."""
    supply = ("gas_prod", "gas_fuel", "frozen", "fts", "icing")
    first, last = {}, {}
    for e in c.events:
        first.setdefault(e["kind"], e)
        last[e["kind"]] = e
    items = []
    for k, e in first.items():
        if k == "collapse":
            continue
        text = e["text"]
        if k in supply and last[k] is not e:
            text = f"{e['text']}, rising to {last[k]['text'].split(':')[-1].strip() if k in ('gas_prod', 'icing') else last[k]['text']} by h{last[k]['h']}"
        items.append((e["h"], k != "cold", f"h{e['h']}: {text}"))
    items.sort(key=lambda x: (x[0], x[1]))
    parts = [t for _, _, t in items]
    if collapsed:
        e = first.get("collapse")
        if e:
            parts.append(f"h{e['h']}: {e['text']}")
        parts.append("TEXAS DARK")
    elif peak_shed > 0:
        parts.append(f"survived with rotating outages (peak {peak_shed:,.0f} MW)")
    else:
        parts.append("lights stayed on")
    return " -> ".join(parts)


# =========================================================================== run
class _Run:
    pass


def simulate(w: World, policy, p: Params, seed: int = 0, capital_budget: float | None = None,
             keep_world: bool = True) -> Result:
    t_start = time.perf_counter()
    fl = w.fleet
    n, U, R = w.n, fl.n, D.R
    cap = fl.cap
    fuel = fl.fuel
    is_gas = fuel == GAS
    reg = fl.region
    order = np.argsort(fl.merit, kind="stable")
    dm = DemandModel.from_dict(p.demand)

    # ------------------------------------------------------------------ build plan
    info = season_info(fl)
    info["capital_budget_usd"] = float(capital_budget if capital_budget is not None else L.DEFAULT_CAPITAL_BUDGET)
    info["scenario_hours"] = n
    info["levers"] = list(L.BuildPlan.__dataclass_fields__)
    raw_plan = policy.build(info) if hasattr(policy, "build") and callable(policy.build) else getattr(policy, "build", None)
    plan = L.BuildPlan.coerce(raw_plan).clamp()
    plan, budget_scale = L.fit_budget(plan, info["units"], info["capacity_mw"], info["capital_budget_usd"])
    capex_items = L.capex(plan, info["units"], info["capacity_mw"])
    if hasattr(policy, "reset"):
        policy.reset()

    # ------------------------------------------------------------------ per-seed draws
    ss = np.random.SeedSequence([int(seed), 4037])
    g_unit, g_bg, g_haz, g_min, g_fc, g_sen = (np.random.default_rng(s) for s in ss.spawn(6))
    vul_u = g_unit.random(U)
    thr_u = p.thr_mu + p.thr_sigma * g_unit.standard_normal(U)
    fuel_rank = g_unit.random(U)
    maint_u = g_unit.random(U)
    firm_u = g_unit.random(U)
    rec_lo, rec_hi = p.recover_delay_h
    rec_delay = np.round(rec_lo + (rec_hi - rec_lo) * g_unit.random(U)).astype(int)
    bg_init = g_unit.random(U)
    bg_init_dur = g_unit.exponential(p.bg_repair_mean_h, U)
    UH1 = g_bg.random((n, U), dtype=np.float32)
    UH2 = g_haz.random((n, U), dtype=np.float32)
    MM = g_min.integers(0, 60, size=(n, U), dtype=np.int64)
    # forecast errors: one forecast issue every FC_ISSUE_H hours; error is a random walk along lead time
    # (sd ~0.6 C at 1 h growing to ~4 C at 72 h), regionally correlated. Never ground truth.
    n_iss = n // FC_ISSUE_H + 1
    L_fc = FC_H + FC_ISSUE_H
    z_c = g_fc.standard_normal((n_iss, L_fc, 1)).astype(np.float32)
    z_r = g_fc.standard_normal((n_iss, L_fc, R)).astype(np.float32)
    rho = p.fc_region_corr
    steps = (math.sqrt(rho) * z_c + math.sqrt(1 - rho) * z_r) * p.fc_sigma_step
    steps[:, 0, :] *= p.fc_sigma0 / max(p.fc_sigma_step, 1e-6)
    fc_err = np.cumsum(steps, axis=1)
    sensor = (g_sen.standard_normal((n, R)) * p.sensor_noise_c).astype(float)

    # ------------------------------------------------------------------ build effects
    wz = plan.winterize_plants
    vmult = np.array([p.vuln_mult.get(d, 1.0) for d in fl.detail])
    wshare = np.array([wz.get(THERMAL_FUELS[f], 0.0) for f in fuel])
    vulnerable = vul_u < np.clip(p.vuln_base * vmult, 0, 1) * (1.0 - wshare)
    thr_eff = thr_u.copy()
    immune = is_gas & (firm_u < plan.firm_fuel)
    prod_loss = w.prod_loss * (1.0 - p.wells_winterize_eff * plan.winterize_wells)
    w_wind = wz.get("wind", 0.0)
    wcap_r = fl.wind_by_region
    wcap = float(wcap_r.sum())
    wind_frac_ok = (w.wind_ok @ wcap_r) / wcap if wcap > 0 else np.ones(n)
    wind_avail = w.wind_cf * wcap * (w_wind + (1.0 - w_wind) * wind_frac_ok)
    turbines_running = w_wind + (1.0 - w_wind) * wind_frac_ok
    extra = plan.extra_reserve_mw
    has_map = plan.critical_load_map
    batt_mw, batt_mwh = plan.battery_mw, plan.battery_mwh
    soc = batt_mwh
    old_grid = fl.year < 2007
    imports_cap = p.imports_max_1989_mw if old_grid else p.imports_max_mw
    lr_cap = 0.0 if old_grid else p.baseline_lr_mw
    dr_cap = (p.baseline_dr_1989_mw if old_grid else p.baseline_lr_mw + p.baseline_ers_mw) + plan.dr_mw
    dr_energy = dr_cap * L.DR_ENERGY_HOURS
    nonnuc = fuel != NUC
    # planned outages: units taken out in a per-seed random order until the scheduled MW share is reached
    perm = np.argsort(np.where(nonnuc, maint_u, 2.0), kind="stable")
    cfrac = np.cumsum(np.where(nonnuc, cap, 0.0)[perm])
    cfrac = (cfrac - np.where(nonnuc, cap, 0.0)[perm]) / max(cap[nonnuc].sum(), 1.0)
    plan_pos = np.full(U, np.inf)
    plan_pos[perm] = np.where(nonnuc[perm], cfrac + 0.5 * cap[perm] / max(cap[nonnuc].sum(), 1.0), np.inf)

    # ------------------------------------------------------------------ state
    bg_out = bg_init < (p.bg_fail_rate * p.bg_repair_mean_h) / (1 + p.bg_fail_rate * p.bg_repair_mean_h)
    bg_rem = np.where(bg_out, np.ceil(bg_init_dur), 0).astype(int)
    cold_out = np.zeros(U, bool)
    cold_rem = np.zeros(U, int)
    fts_rem = np.zeros(U, int)
    starved = np.zeros(U, bool)
    unst_cnt = np.zeros(U, int)
    online = np.zeros(U, bool)
    pc_flag = np.zeros(U, bool)
    ever_forced = np.zeros(U, bool)   # units that went out for weather/fuel/start reasons at any time
    fts_done = np.zeros(U, bool)      # a unit that failed to start once gets fixed (no repeat risk)
    planned0 = plan_pos < w.planned_frac[0]
    off_h = np.full(U, 24, dtype=int)
    avail_prev = ~planned0 & ~bg_out
    thermal_prev = float(cap[avail_prev].sum())
    shed_level = 0.0
    controlled_prev = 0.0
    feedback = 0.0
    clp = 0.0
    shed_since = -1
    below = 0
    above_run = 999
    ufls_armed = [True] * len(p.ufls_stages)
    collapsed, collapse_h, collapse_min = False, None, None
    supply_hist = [None, None]
    last_freq, last_fmin = 60.0, 60.0
    unprot_prev = 0.0
    eea_prev = 0
    dem_prev = None

    cols = ["demand", "demand_eff", "supply", "supply_min", "reserve", "shed_mw", "shed_end", "controlled_end",
            "ufls_mw", "rt_mw", "freq_min", "freq_end", "below_min", "eea", "avail_gas", "avail_coal",
            "avail_nuclear", "avail_other", "avail_wind", "avail_solar", "avail_extra", "out_cold", "out_fuel",
            "out_fts", "out_bg", "planned", "gas_short", "prod_loss", "feedback", "imports", "battery", "soc",
            "dr", "lr", "conservation", "precommit_mw", "clp", "homes_dark", "unprotected_frac",
            "turbines_running", "unnecessary_mw", "trips_mw", "protect_gas", "rotation_min", "out_coal", "gas_nofuel"]
    H = {c: np.zeros(n) for c in cols}
    c = Causes(w)
    events = []  # UI events: {h, type, text_plain, data}

    def emit(h, typ, text_plain, **data):
        events.append({"h": int(h), "type": typ, "text_plain": text_plain,
                       "data": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in data.items()}})

    if any(v for v in plan.to_dict().values()):
        emit(0, "build", _build_text(plan), **{k: v for k, v in plan.to_dict().items() if v})
    ev_flags = set()
    weather_out_ref = 0.0     # weather-related outage level at the last "plants coming back" event
    shed_ref, last_restore_h, last_plants_h = 0.0, -99, -99

    run = _Run()
    run.w, run.fc_err, run.dm = w, fc_err, dm
    R0 = p.reserves_mw
    kern = np.exp(-np.arange(KERNEL_LEN) / p.trip_tau_min)
    T_all = w.wx["temp"]
    X_all = w.expo
    imports_total = 0.0
    precommit_cost = 0.0
    capbyf = info["capacity_mw"]

    plan_dict = plan.to_dict()
    ts_list = list(w.ts)
    _loc = w.ts.tz_convert("US/Central")
    weekday = _loc.dayofweek.to_numpy()
    _ld = _loc.normalize()
    day_index = ((_ld - _ld[0]).days).to_numpy().astype(int)
    for i in range(n):
        T = T_all[i]
        Tu = T[reg]
        Xu = X_all[i][reg]
        dem_true = w.demand[i] + clp

        # ---------------------------------------------------------- observation + action
        supply_now = supply_hist[0] if supply_hist[0] is not None else thermal_prev + wind_avail[i] + w.solar[i] + extra
        trend = (supply_hist[0] - supply_hist[1]) if supply_hist[1] is not None else 0.0
        abf = np.bincount(fuel, weights=cap * avail_prev, minlength=4)
        avail_by = {"gas": float(abf[0]), "coal": float(abf[1]), "nuclear": float(abf[2]), "other": float(abf[3])}
        avail_by["wind"] = float(wind_avail[i - 1]) if i else float(wind_avail[0])
        avail_by["solar"] = float(w.solar[i - 1]) if i else float(w.solar[0])
        forced_now = ~avail_prev & ~(plan_pos < w.planned_frac[max(i - 1, 0)])
        obf = np.bincount(fuel, weights=cap * forced_now, minlength=4)
        obs = Obs({
            "hour": i, "day_index": int(day_index[i]), "ts": ts_list[i], "local_hour": int(w.local_hour[i]),
            "weekday": int(weekday[i]),
            "demand_now": float(dem_true), "supply_now": float(supply_now), "supply_trend_1h": float(trend),
            "reserve_now": float(supply_now - (dem_true - shed_level)),
            "shed_now": float(shed_level), "freq_last": last_freq, "freq_min_last": last_fmin,
            "below_59_4_min": int(below), "countdown_s": _countdown(below, p),
            "eea_last": eea_prev,
            "avail_by_fuel": avail_by, "capacity_by_fuel": capbyf,
            "outages_by_fuel": {"gas": float(obf[0]), "coal": float(obf[1]), "nuclear": float(obf[2]), "other": float(obf[3])},
            "temps_now": dict(zip(D.REGION_IDS, np.round(T + sensor[i], 2).tolist())),
            "temp_now": float(w.t_pw[i] + sensor[i].mean()),
            "wind_speed_now": dict(zip(D.REGION_IDS, np.round(w.wx["wind"][i], 1).tolist())),
            "imports_max": imports_cap, "battery_soc_mwh": float(soc), "battery_mw_max": batt_mw,
            "dr_available_mw": float(dr_cap if dr_energy > 0 else 0.0), "dr_energy_left_mwh": float(dr_energy),
            "lr_mw": lr_cap, "build": plan_dict, "homes_dark_now": float(shed_level * p.customers_per_mw),
            "reserve_target_mw": R0,
        }, run, i)
        a = L.normalize_action(policy.act(obs))

        conservation = a["conservation"]
        dr = min(a["dr_mw"], dr_cap, max(0.0, dr_energy))
        dr_energy -= dr
        imports = min(a["imports_mw"], imports_cap)
        imports_total += imports
        bm = a["battery_mw"]
        if bm >= 0:
            bdis = min(bm, batt_mw, soc)
        else:
            bdis = -min(-bm, batt_mw, (batt_mwh - soc) / 0.85)
        demand_eff = dem_true * (1.0 - conservation) - dr
        protect = bool(a["protect_gas"] and has_map)
        pool = p.max_manual_shed_frac * demand_eff * (1.0 - (p.gas_facility_load_frac if protect else 0.0))
        if a["shed_mw"] is not None:
            target = min(a["shed_mw"], pool)
        else:
            target = max(0.0, shed_level - a["restore_mw"])
        rotation = a["rotation_min"]
        rt_auth = a["rt_shed"]

        # ---------------------------------------------------------- unit availability for this hour
        planned = plan_pos < w.planned_frac[i]
        # background forced outages
        bg_rem = np.where(bg_out, bg_rem - 1, 0)
        bg_out = bg_out & (bg_rem > 0)
        u1 = UH1[i]
        lam = p.bg_fail_rate * (1.0 + p.bg_cold_mult * np.clip(-Xu / 10.0, 0.0, 2.0))
        newbg = ~bg_out & (u1 < lam)
        if newbg.any():
            dur = np.ceil(-p.bg_repair_mean_h * np.log(np.maximum(u1[newbg] / lam[newbg], 1e-6)))
            bg_rem[newbg] = dur.astype(int)
            bg_out = bg_out | newbg
        # cold trips and recovery
        u2 = UH2[i]
        warm = Tu > p.recover_temp_c
        if cold_out.any():
            cold_rem = np.where(cold_out & warm, cold_rem - 1, cold_rem)
            fixed = cold_out & ~warm & (u2 < p.cold_repair_rate)
            thr_eff = np.where(fixed, thr_eff - p.fix_delta_c, thr_eff)
            cold_out = cold_out & ~((warm & (cold_rem <= 0)) | fixed)
        newcold = vulnerable & ~cold_out & ~planned & (Xu < thr_eff)
        if newcold.any():
            cold_out = cold_out | newcold
            cold_rem = np.where(newcold, rec_delay, cold_rem)
        # gas fuel
        P = prod_loss[i]
        deliv = max(0.0, P - p.deliv_buffer) / (1.0 - p.deliv_buffer)
        feedback = p.feedback_decay * feedback + p.feedback_per_shed * unprot_prev
        gshort = min(0.95, deliv + feedback)
        st_now = is_gas & ~immune & (fuel_rank < gshort)
        unst_cnt = np.where(st_now, 0, unst_cnt + 1)
        starved = st_now | (starved & (unst_cnt < p.gas_restart_h))
        # fail-to-start bookkeeping
        fts_rem = np.maximum(0, fts_rem - 1)
        avail = ~planned & ~bg_out & ~cold_out & ~starved & (fts_rem == 0)

        # ---------------------------------------------------------- commitment and fail-to-start
        renew = wind_avail[i] + w.solar[i]
        need = demand_eff - target + p.commit_margin_mw - renew - imports - max(bdis, 0.0) - extra
        av_o = avail[order]
        capav = cap[order] * av_o
        cum = np.cumsum(capav) - capav
        on_o = av_o & (cum < need)
        want = np.zeros(U, bool)
        want[order] = on_o
        pc = a["precommit"]
        if pc > 0:
            cand = avail & is_gas & ~want & ~pc_flag
            if cand.any():
                idx = np.where(cand[order])[0]
                cc = np.cumsum(cap[order][idx])
                take = idx[cc <= pc * cc[-1] + 1e-6]
                pc_flag[order[take]] = True
        else:
            pc_flag[:] = False
        pc_flag &= avail
        want_merit = want.copy()
        want |= pc_flag
        starts = want & ~online & avail
        cold_start = starts & (Xu < -p.fts_t0) & (off_h >= p.fts_soak_h) & ~fts_done
        if cold_start.any():
            pf = np.minimum(p.fts_max, p.fts_slope * np.maximum(0.0, -Xu - p.fts_t0))
            fail = cold_start & (u2 < pf)
            if fail.any():
                fts_done |= fail
                lo, hi = p.fts_outage_h
                fts_rem = np.where(fail, np.ceil(lo + (hi - lo) * (u2 / np.maximum(pf, 1e-6))).astype(int), fts_rem)
                avail = avail & ~fail
                want = want & ~fail
        online = want & avail
        off_h = np.where(online, 0, off_h + 1)
        precommit_mw = float(cap[pc_flag & online & ~want_merit].sum()) if pc > 0 else 0.0
        precommit_cost += precommit_mw * L.PRECOMMIT_USD_PER_MWH

        # ---------------------------------------------------------- supply profile within the hour
        thermal_end = float(cap[avail].sum())
        changed = avail != avail_prev
        sched = changed & (planned != (plan_pos < w.planned_frac[max(i - 1, 0)]))
        lumpy = changed & ~sched
        newly_forced = avail_prev & ~avail & ~planned
        ever_forced |= newly_forced & (cold_out | starved | (fts_rem > 0))
        delta = np.where(avail, cap, -cap)
        dmin = np.bincount(MM[i][lumpy], weights=delta[lumpy], minlength=60)[:60] if lumpy.any() else np.zeros(60)
        sched_delta = float(delta[sched].sum()) if sched.any() else 0.0
        mins = np.arange(1, 61) / 60.0
        thermal_m = thermal_prev + np.cumsum(dmin) + sched_delta * mins
        wprev = wind_avail[i - 1] if i else wind_avail[0]
        sprev = w.solar[i - 1] if i else w.solar[0]
        renew_m = wprev + (wind_avail[i] - wprev) * mins + sprev + (w.solar[i] - sprev) * mins
        S_m = thermal_m + renew_m + imports + bdis + extra
        trip_mw = np.bincount(MM[i][lumpy & ~avail], weights=cap[lumpy & ~avail], minlength=60)[:60] \
            if (lumpy & ~avail).any() else np.zeros(60)
        if target >= shed_level:
            ctrl_m = np.minimum(target, shed_level + p.shed_ramp_mw_per_min * np.arange(1, 61))
        else:
            ctrl_m = np.maximum(target, shed_level - p.restore_mw_per_min * np.arange(1, 61))
        # demand moves smoothly from last hour's level to this hour's (no step at the top of the hour)
        dprev = demand_eff if dem_prev is None else dem_prev
        L_m = dprev + (demand_eff - dprev) * mins - ctrl_m
        r_m = S_m - L_m
        r_before = np.concatenate([[r_m[0] + trip_mw[0]], r_m[:-1]])
        scar = 1.0 + 2.0 * np.clip(1.0 - r_before / R0, 0.0, 1.0)
        trans = np.convolve(trip_mw * scar, kern)[:60] * (p.b_trip / 1000.0)
        d_m = np.maximum(0.0, -r_m)
        f_m = 60.0 - p.s_low * np.clip(R0 - r_m, 0.0, R0) / 1000.0 - p.s_def * np.minimum(d_m, p.def_knee_mw) / 1000.0             - p.s_def2 * np.maximum(0.0, d_m - p.def_knee_mw) / 1000.0 - trans

        ufls_mw = 0.0
        rt_mw = 0.0
        lr_off = 0.0
        ffr = 0.0
        if (r_m >= 0).all() and f_m.min() > p.lr_trip_hz:
            f_min_h, f_end_h = float(f_m.min()), float(f_m[-1])
            above_run += 60
            if above_run >= p.relay_reset_min:
                below = 0
            shed_m_mean = float(ctrl_m.mean())
            shed_end = float(ctrl_m[-1])
            supply_min = float(S_m.min())
            r_end = float(r_m[-1])
        else:
            # ---------------------------------------------------- slow path: minute loop with protection
            f_min_h = 60.0
            lag = 0
            shed_sum = 0.0
            supply_min = 1e12
            batt_head = max(0.0, batt_mw - max(bdis, 0.0))
            soc_room = max(0.0, soc - max(bdis, 0.0))
            ufls_gas = 0.0
            f = 60.0
            r = float(r_m[0])
            for m in range(60):
                S = S_m[m] + ffr
                Lm = L_m[m] - lr_off - ufls_mw - rt_mw
                r = S - Lm
                f = _freq(r, trans[m], p, R0)
                nadir = f
                # UFLS relays act within cycles, as frequency falls through each stage (before generator protection)
                for k, (hz, frac) in enumerate(p.ufls_stages):
                    if f < hz and ufls_armed[k]:
                        ufls_armed[k] = False
                        ufls_mw += frac * demand_eff
                        r += frac * demand_eff
                        nadir = min(nadir, hz - 0.03) if f >= hz - 0.03 else hz - 0.03
                        f = _freq(r, trans[m], p, R0)
                        emit(i, "ufls", f"Emergency: the grid's frequency fell dangerously low, so automatic safety "
                                        f"switches cut power to {frac:.0%} of homes", stage_hz=hz, frac=frac,
                             mw=round(frac * demand_eff), minute=m)
                        c.add(i, "ufls", f"under-frequency relays shed {frac:.0%} at {hz} Hz")
                nadir = min(nadir, f)
                supply_min = min(supply_min, S)
                f_min_h = min(f_min_h, nadir)
                shed_sum += ctrl_m[m] + ufls_mw + rt_mw
                # collapse counter (generator under-frequency relays)
                if f <= p.collapse_hz:
                    below += 1
                    above_run = 0
                else:
                    above_run += 1
                    if above_run >= p.relay_reset_min:
                        below = 0
                if below > p.collapse_minutes or f < p.instant_collapse_hz:
                    collapsed, collapse_h, collapse_min = True, i, m
                    f_min_h = min(f_min_h, f)
                    break
                # automatic responses (act from the next minute)
                if f < 59.8 and batt_head > 0 and soc_room > 0 and ffr == 0.0:
                    ffr = min(batt_head, soc_room * 60.0 / max(60 - m, 1))
                if f < p.lr_trip_hz and lr_off == 0.0:
                    lr_off = max(0.0, lr_cap - dr)
                if r < 0 and rt_auth:
                    lag += 1
                    if lag > p.rt_lag_min:
                        room = max(0.0, pool - ctrl_m[m] - rt_mw)
                        rt_mw += min(p.rt_shed_mw_per_min, room)
                else:
                    lag = 0
            nm = (collapse_min + 1) if collapsed else 60
            shed_m_mean = shed_sum / nm
            shed_end = float(ctrl_m[nm - 1] + ufls_mw + rt_mw)
            f_end_h = f
            r_end = r
            if ffr > 0:
                soc = max(0.0, soc - ffr * (nm - 0) / 60.0)

        # ---------------------------------------------------------- bookkeeping
        if bdis >= 0:
            soc = max(0.0, soc - bdis)
        else:
            soc = min(batt_mwh, soc - bdis * 0.85)
        restored = max(0.0, shed_level - shed_end)
        if restored > 0:
            dur_h = rotation / 60.0 if rotation < 240 else (i - shed_since if shed_since >= 0 else 1)
            clp = clp * 0.5 + restored * p.clp_max * min(1.0, dur_h / 4.0)
        else:
            clp *= 0.5
        if shed_end > 0 and shed_level == 0:
            shed_since = i
        if shed_end == 0:
            shed_since = -1
        for k, (hz, frac) in enumerate(p.ufls_stages):  # relays re-arm once their load has been restored
            if not ufls_armed[k] and shed_end < sum(fr for _, fr in p.ufls_stages[:k + 1]) * demand_eff * 0.5:
                ufls_armed[k] = True
        # electric-gas feedback: share of load shed that hits gas facilities. With the critical-load map,
        # gas facilities are off UFLS circuits; controlled/real-time shed spares them only if protect_gas.
        if protect or shed_m_mean <= 0:
            unprot_prev = 0.0
        else:
            unprot_prev = max(0.0, shed_m_mean - (ufls_mw if has_map else 0.0)) / max(demand_eff, 1.0)
        controlled_end = float(ctrl_m[-1]) if not collapsed else float(ctrl_m[min(collapse_min, 59)])
        eea = 3 if (shed_end > 0 or r_end < 1000) else (2 if r_end < 1750 else (1 if r_end < R0 else 0))
        out_cold = float(cap[cold_out & ~planned].sum())
        out_fuel = float(cap[starved & ~cold_out & ~planned].sum())
        out_fts = float(cap[(fts_rem > 0) & ~starved & ~cold_out & ~planned].sum())
        out_bg = float(cap[bg_out & (fts_rem == 0) & ~starved & ~cold_out & ~planned].sum())
        unn = min(controlled_end, max(0.0, r_end - R0)) if not collapsed else 0.0
        vals = {
            "demand": dem_true, "demand_eff": demand_eff, "supply": thermal_end + wind_avail[i] + w.solar[i] + extra,
            "supply_min": supply_min, "reserve": r_end, "shed_mw": shed_m_mean, "shed_end": shed_end,
            "controlled_end": controlled_end, "ufls_mw": ufls_mw, "rt_mw": rt_mw, "freq_min": f_min_h,
            "freq_end": f_end_h, "below_min": below, "eea": eea,
            "avail_gas": float(cap[avail & is_gas].sum()), "avail_coal": float(cap[avail & (fuel == COAL)].sum()),
            "avail_nuclear": float(cap[avail & (fuel == NUC)].sum()), "avail_other": float(cap[avail & (fuel == OTH)].sum()),
            "avail_wind": wind_avail[i], "avail_solar": w.solar[i], "avail_extra": extra,
            "out_cold": out_cold, "out_fuel": out_fuel, "out_fts": out_fts, "out_bg": out_bg,
            "planned": float(cap[planned].sum()), "gas_short": gshort, "prod_loss": P, "feedback": feedback,
            "imports": imports, "battery": bdis + ffr, "soc": soc, "dr": dr, "lr": lr_off,
            "conservation": conservation, "precommit_mw": precommit_mw, "clp": clp,
            "homes_dark": shed_m_mean * p.customers_per_mw, "unprotected_frac": unprot_prev,
            "turbines_running": turbines_running[i], "unnecessary_mw": unn, "trips_mw": float(trip_mw.sum()),
            "protect_gas": float(protect), "rotation_min": rotation,
            "out_coal": float(cap[~avail & ~planned & (fuel == COAL)].sum()),
            "gas_nofuel": float(cap[starved].sum()),
        }
        for k2, v in vals.items():
            H[k2][i] = v

        # ---------------------------------------------------------- cause chain
        cold_now = T < -5.0
        c.cold_run = np.where(cold_now, c.cold_run + 1, 0)
        c.max_cold_run = np.maximum(c.max_cold_run, c.cold_run)
        if c.cold_run.max() == 12:
            c.once("cold", i, "cold", c.cold_note(i))
        for thr in (0.10, 0.25, 0.40):
            if P >= thr:
                c.once(f"gp{thr}", i, "gas_prod",
                       f"gas wells freezing (basin temp {w.basin_temp[i]:.0f} C): production -{P:.0%}")
        gas_nofuel = float(cap[starved].sum())
        for thr in (2000, 5000, 10000, 15000, 20000):
            if gas_nofuel >= thr:
                c.once(f"gf{thr}", i, "gas_fuel", f"{gas_nofuel / 1000:.0f} GW of gas plants without fuel")
        for thr in (2000, 5000, 10000, 15000, 20000):
            if out_cold >= thr:
                c.once(f"fz{thr}", i, "frozen", f"{out_cold / 1000:.0f} GW of power plants frozen ({c.cold_note(i)})")
        for thr in (1000, 3000):
            if out_fts >= thr:
                c.once(f"fts{thr}", i, "fts", f"{out_fts / 1000:.1f} GW of units failed to start in the cold")
        iced = 1.0 - turbines_running[i]
        for thr in (0.25, 0.5, 0.75):
            if iced >= thr and wcap > 1000:
                c.once(f"ice{thr}", i, "icing", f"wind turbines iced or too cold: {iced:.0%} of wind fleet stopped")
        if (w.surge[i] > 1.01 and dem_true > 1.04 * w.demand[i] / w.surge[i]) or dem_true > 62000:
            c.once("dem", i, "demand", f"demand surge to {dem_true:,.0f} MW")
        if r_end < R0:
            c.once("eea1", i, "reserve", f"reserves below {R0:,.0f} MW ({r_end:,.0f} MW)")
        if r_end < 0 or supply_min < demand_eff - ctrl_m.max():
            c.once("deficit", i, "reserve", f"not enough electricity: short {max(0.0, -r_end, demand_eff - ctrl_m.max() - supply_min):,.0f} MW")
        if shed_end > 0 and shed_level == 0:
            emit(i, "shed_start", f"Rolling blackouts begin: {shed_end:,.0f} MW cut, about "
                                  f"{_homes(shed_end * p.customers_per_mw)} homes take turns without power",
                 mw=round(shed_end), homes=round(shed_end * p.customers_per_mw),
                 share_of_homes=round(shed_end / max(dem_true, 1.0), 3))
            c.once("shed", i, "shed", f"rotating outages begin ({shed_end:,.0f} MW)")
        elif shed_end == 0 and shed_level > 0:
            emit(i, "shed_end", "Rolling blackouts end: every home has power again", mw_restored=round(shed_level))
        if shed_end > 0:
            shed_ref = max(shed_ref, shed_end) if shed_level > 0 else shed_end
            if shed_ref - shed_end >= 2000 and i - last_restore_h >= 6:   # partial restoration (rate-limited)
                emit(i, "restore", f"Power coming back: about {_homes((shed_ref - shed_end) * p.customers_per_mw)} homes "
                                   f"reconnected", kind="homes", mw=round(shed_ref - shed_end),
                     homes=round((shed_ref - shed_end) * p.customers_per_mw))
                shed_ref, last_restore_h = shed_end, i
        weather_out = out_cold + out_fuel + out_fts
        weather_out_ref = max(weather_out_ref, weather_out)
        if weather_out_ref - weather_out >= 3000 and i - last_plants_h >= 6:
            emit(i, "restore", f"Power plants coming back as things thaw: {(weather_out_ref - weather_out) / 1000:.0f} GW "
                               f"returned", kind="plants", mw=round(weather_out_ref - weather_out))
            weather_out_ref, last_plants_h = weather_out, i
        fb_mw = feedback * float(cap[is_gas].sum())
        if fb_mw > 500 and unprot_prev > 0:
            c.once("fb", i, "feedback", f"shedding cut power to gas facilities: -{fb_mw / 1000:.1f} GW gas fuel")
        for thr in (500, 2000, 5000):
            if fb_mw >= thr and unprot_prev > 0 and f"fb{thr}" not in ev_flags:
                ev_flags.add(f"fb{thr}")
                emit(i, "gas_feedback", f"The blackouts also cut power to gas pipeline pumps, so even less gas reaches "
                                        f"power plants: {fb_mw / 1000:.1f} GW more of them go short of fuel",
                     mw=round(fb_mw), gas_fleet_share=round(feedback, 3))
        for thr in (0.10, 0.25, 0.40):
            if P >= thr and f"fo{thr}" not in ev_flags:
                ev_flags.add(f"fo{thr}")
                emit(i, "freeze_off", f"Gas wells are freezing in the cold: gas production down {P:.0%}",
                     production_loss=P, basin_temp_c=round(float(w.basin_temp[i]), 1),
                     gas_plants_short_mw=round(gas_nofuel))
        for thr in (0.25, 0.5, 0.75):
            if iced >= thr and wcap > 1000 and f"ice{thr}" not in ev_flags:
                ev_flags.add(f"ice{thr}")
                emit(i, "icing", f"Ice and extreme cold are stopping wind turbines: {iced:.0%} of them are idle",
                     share_stopped=float(iced))
        for thr in (65000, 70000, 75000, 80000):
            if dem_true >= thr and f"dem{thr}" not in ev_flags:
                ev_flags.add(f"dem{thr}")
                emit(i, "demand_surge", f"Heating demand surges to {dem_true:,.0f} MW as people crank up heaters",
                     demand_mw=round(dem_true))
        if w.surge[i] > 1.02 and "surge" not in ev_flags:
            ev_flags.add("surge")
            emit(i, "demand_surge", f"Extra demand: homes and businesses use {w.surge[i] - 1:.0%} more power than usual "
                                    f"for this cold", demand_mw=round(dem_true), surge=float(w.surge[i]))
        big = newly_forced & (cap >= 400)
        for u in np.where(big)[0][:6]:
            why = ("froze up in the cold" if cold_out[u] else ("ran out of gas fuel" if starved[u] else
                   ("failed to start in the cold" if fts_rem[u] > 0 else "broke down")))
            reason = "frozen" if cold_out[u] else ("no_fuel" if starved[u] else ("failed_start" if fts_rem[u] > 0 else "breakdown"))
            emit(i, "trip", f"Power plant {fl.name[u]} {why} ({cap[u]:,.0f} MW lost)", plant=str(fl.name[u]),
                 mw=round(float(cap[u])), fuel=THERMAL_FUELS[int(fuel[u])], reason=reason,
                 region=D.REGION_IDS[int(reg[u])], minute=int(MM[i][u]))

        if collapsed:
            c.add(i, "collapse", f"{below} min below {p.collapse_hz} Hz (min {f_min_h:.2f} Hz): grid collapse")
            emit(i, "collapse", "Total blackout: the grid collapsed and the whole state went dark",
                 minutes_below_59_4=int(below), min_freq_hz=round(float(f_min_h), 3), minute=int(collapse_min))
            for j in range(i + 1, n):
                H["demand"][j] = w.demand[j]
                H["demand_eff"][j] = w.demand[j]
                H["shed_mw"][j] = w.demand[j]
                H["shed_end"][j] = w.demand[j]
                H["homes_dark"][j] = p.total_customers
                H["eea"][j] = 3
                H["turbines_running"][j] = 0.0
                H["gas_short"][j] = 1.0
                H["prod_loss"][j] = prod_loss[j]
            H["homes_dark"][i] = p.total_customers
            break

        # ---------------------------------------------------------- roll state
        supply_hist = [thermal_end + wind_avail[i] + w.solar[i] + extra, supply_hist[0]]
        dem_prev = demand_eff
        thermal_prev = thermal_end
        avail_prev = avail
        shed_level = shed_end
        controlled_prev = controlled_end
        last_freq, last_fmin = f_end_h, f_min_h
        eea_prev = eea

    # ------------------------------------------------------------------ score
    hh = float(H["homes_dark"].sum())
    shed_mask = H["shed_mw"] > 1.0
    peak_shed = float(H["shed_mw"][:collapse_h if collapsed else n].max()) if n else 0.0
    unn_hh = float(H["unnecessary_mw"].sum()) * p.customers_per_mw
    hours = n
    annual = sum(capex_items.values()) * L.ANNUALIZE
    cost = {
        "capex_usd": float(sum(capex_items.values())), "capex_items": capex_items,
        "capital_annualized_usd": annual * hours / 8760.0,
        "dr_contract_usd": plan.dr_mw * L.DR_USD_PER_MW_H * hours,
        "imports_usd": imports_total * L.IMPORT_USD_PER_MWH,
        "precommit_usd": precommit_cost,
    }
    cost["total_usd"] = cost["capital_annualized_usd"] + cost["dr_contract_usd"] + cost["imports_usd"] + cost["precommit_usd"]
    score = {
        "homes_dark_hours": hh,
        "collapse_penalty": p.collapse_penalty_hh if collapsed else 0.0,
        "unnecessary_shed": p.unnecessary_weight * unn_hh,
        "cost_homes_hours_equiv": cost["total_usd"] / p.usd_per_home_hour,
    }
    score["total"] = sum(score.values())
    fmins = H["freq_min"][:(collapse_h + 1) if collapsed else n]
    m_end = collapse_h if collapsed else n
    frac_h = H["shed_mw"][:m_end] / np.maximum(H["demand"][:m_end], 1.0)
    peak_frac = float(frac_h.max()) if m_end > 0 else 0.0
    worst_h = int(np.argmax(frac_h)) if peak_frac > 0 else None
    H["ts"] = w.ts
    res = Result(scenario_id=w.scenario_id, policy=getattr(policy, "name", type(policy).__name__), seed=int(seed),
                 collapsed=collapsed, collapse_hour=collapse_h,
                 collapse_ts=w.ts[collapse_h].strftime("%Y-%m-%dT%H:%MZ") if collapsed else None,
                 homes_dark_hours=hh, peak_homes_dark=float(H["homes_dark"].max()), peak_shed_mw=peak_shed,
                 shed_hours=int(shed_mask[:collapse_h if collapsed else n].sum()),
                 min_freq=float(fmins.min()) if len(fmins) else 60.0,
                 max_below_59_4_min=int(H["below_min"].max()), unnecessary_homes_hours=unn_hh, cost=cost,
                 score=score, cause_chain=c.events, cause_summary=_summary_chain(c, collapsed, peak_shed),
                 events=events, build=plan.to_dict(), budget_scale=budget_scale, hourly=H,
                 world=w if keep_world else None, peak_shed_frac=peak_frac, worst_hour=worst_h)
    res.extra = {"gross_forced_mw": float(cap[ever_forced].sum()), "max_cold_run_h": dict(zip(D.REGION_IDS, c.max_cold_run.tolist()))}
    res.runtime_s = time.perf_counter() - t_start
    return res


def _freq(r: float, trans: float, p: Params, R0: float) -> float:
    d = max(0.0, -r)
    return (60.0 - p.s_low * min(max(R0 - r, 0.0), R0) / 1000.0 - p.s_def * min(d, p.def_knee_mw) / 1000.0
            - p.s_def2 * max(0.0, d - p.def_knee_mw) / 1000.0 - trans)


def _homes(x: float) -> str:
    """Round a home count for plain-language text: 1,234,567 -> '1.2 million', 345,678 -> '350,000'."""
    if x >= 1e6:
        return f"{x / 1e6:.1f} million"
    if x >= 1e4:
        return f"{round(x, -4):,.0f}"
    return f"{round(x, -3):,.0f}"


def _countdown(below: int, p: Params):
    if below <= 0:
        return None
    return max(0, int((p.collapse_minutes - below) * 60))


def _build_text(plan: L.BuildPlan) -> str:
    names = {"gas": "gas", "coal": "coal", "nuclear": "nuclear", "other": "other", "wind": "wind"}
    bits = []
    for f, v in plan.winterize_plants.items():
        if v:
            bits.append(f"weatherproofed {v:.0%} of {names[f]} plants")
    if plan.winterize_wells:
        bits.append(f"weatherproofed {plan.winterize_wells:.0%} of gas wells")
    if plan.firm_fuel:
        bits.append(f"backup fuel for {plan.firm_fuel:.0%} of gas plants")
    if plan.battery_mw:
        bits.append(f"{plan.battery_mw:,.0f} MW of batteries")
    if plan.dr_mw:
        bits.append(f"{plan.dr_mw:,.0f} MW of paid demand cuts from big users")
    if plan.critical_load_map:
        bits.append("mapped gas facilities so blackouts can skip them")
    if plan.extra_reserve_mw:
        bits.append(f"{plan.extra_reserve_mw:,.0f} MW of cold-proof backup generators")
    return "Before the storm: " + ("; ".join(bits) if bits else "no preparations")
