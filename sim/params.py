"""Simulator v1 parameters. Defaults are pre-calibration guesses; `sim/params_v1.json` holds the
calibrated values (written by `python -m sim.calibrate`). Every number is either a CALIBRATION-SAFE
fact (cited), a calibrated value, or a documented generic assumption.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, fields

PARAMS_PATH = os.path.join(os.path.dirname(__file__), "params_v1.json")


@dataclass
class Params:
    # ---------------------------------------------------------------- availability
    # Planned (scheduled) outage share of NON-NUCLEAR thermal MW, piecewise-linear in days from Jan 1
    # (negative = December). Anchors (CALIBRATION-SAFE): Jan 6, 2014 2,468 MW planned (~3.5%);
    # SARA winter 2020/21 4,074 MW maintenance; Feb 2, 2011 12,413 MW scheduled (FERC-2011 p.79).
    # The Feb level is calibrated to reproduce 12,413 MW on the 2011 fleet. Dec/Jan are winter-peak
    # months with little maintenance (our assumption, consistent with the 2014 and SARA anchors).
    planned_knots: list = field(default_factory=lambda: [[-47, 0.10], [-31, 0.06], [-15, 0.035], [10, 0.035],
                                                         [32, 0.1793], [59, 0.22], [75, 0.25]])
    # Background (non-weather) forced outages: 2010 typical 900-6,300 MW/day, avg 3,200 MW (FERC-2011 p.150)
    bg_fail_rate: float = 0.0013     # per unit-hour
    bg_repair_mean_h: float = 30.0   # => steady-state unavailability ~3.8%
    # Non-weather failures rise under cold stress: Feb 1-5, 2011 had 100 units / 14,386 MW of non-weather
    # outages (FERC-2011 p.150) vs ~3,200 MW/day normally; Jan 6, 2014 lost 9,355 MW of which only 3,541 MW
    # weather-related (ERCOT-EEA-2014). Hazard x (1 + bg_cold_mult * clip(-exposure/10, 0, 2)) (calibrated).
    bg_cold_mult: float = 2.0
    # ---------------------------------------------------------------- cold trips (vulnerable fraction)
    # Unit count failure rate / fleet share by type, Feb 2011 (FERC-2011 p.143): CC 48/35, CT 21/20,
    # gas steam 13/13, coal 7/7, nuclear 0 -> relative vulnerability multipliers.
    vuln_base: float = 0.30          # share of (gas-steam-like) units that are NOT winterized (calibrated)
    vuln_mult: dict = field(default_factory=lambda: {"gas_cc": 1.37, "gas_steam": 1.0, "gas_ct": 1.05,
                                                     "gas_ice": 1.05, "coal": 1.0, "nuclear": 0.25, "other": 1.0})
    thr_mu: float = -9.0             # mean failure threshold of vulnerable units, deg C of cold exposure
    thr_sigma: float = 3.0
    expo_tau_h: float = 6.0          # thermal-inertia time constant of the cold exposure (EWMA)
    windchill_k: float = 0.35        # deg C of effective cooling per m/s of wind above 2 m/s (when T < 5 C)
    recover_temp_c: float = 0.0      # a frozen unit starts recovering once local temp is above this
    recover_delay_h: list = field(default_factory=lambda: [4.0, 20.0])
    cold_repair_rate: float = 0.03   # per hour: crews thaw lines / temporary enclosures while still cold
    fix_delta_c: float = 6.0         # a unit repaired in the cold has its threshold lowered by this much
    # ---------------------------------------------------------------- fail-to-start
    # Feb 2, 2011: non-spin 1,840 MW deployed, 10 units (669 MW) failed to respond (FERC-2011 p.76) at
    # about -7 C => ~36%.
    fts_slope: float = 0.07
    fts_t0: float = 2.0              # start failures only below -2 C: 0.07*(7-2) = 35% at -7 C
    fts_soak_h: int = 6              # only units offline >= 6 h are cold-soaked
    fts_max: float = 0.35            # no evidence for higher start-failure rates than 2011's ~36%
    fts_outage_h: list = field(default_factory=lambda: [3.0, 18.0])
    commit_margin_mw: float = 3300.0  # online target = demand + this (2,300 RRS + ~1,000 regulation/non-spin)
    # ---------------------------------------------------------------- gas fuel
    gas_freeze_t: float = -2.0       # wellhead freeze-off accumulates below this basin temperature
    gas_tau_h: float = 48.0          # wells thaw: leaky freezing-degree-hour accumulator time constant
    prod_loss_max: float = 0.6       # assumption: at most 60% of basin production freezes off
    prod_loss_k: float = 400.0       # deg C*h scale (calibrated: 2011 TX+NM production fell ~21%, FERC-2011 p.114)
    deliv_buffer: float = 0.18       # linepack/storage/LDC priority absorb production losses up to this share
    wells_winterize_eff: float = 0.8
    feedback_per_shed: float = 0.06  # extra gas-fleet fuel loss per unit unprotected shed fraction (v0, 2011 bound)
    feedback_decay: float = 0.9
    gas_restart_h: int = 3
    # ---------------------------------------------------------------- renewables
    wind_cf_coef: list = field(default_factory=lambda: [-0.1732, 0.14613, -0.0051336])
    wind_cut_out: float = 25.0
    ice_gain: float = 0.05           # per hour when T<0 and precip>0 (scaled by precip mm, capped)
    ice_melt: float = 0.05           # per hour when T>1
    wind_lowtemp_c: float = -17.0    # standard turbines stop near -20 C (2011: 17 units / 1,237 MW low-temp limits)
    wind_lowtemp_span: float = 5.0
    # ---------------------------------------------------------------- frequency (ERCOT rules, CALIBRATION-SAFE)
    reserves_mw: float = 2300.0      # responsive reserve minimum
    s_low: float = 0.08              # Hz per GW of reserve shortfall below 2,300 MW (governor sag; 1989 59.79-59.92)
    s_def: float = 0.20              # Hz per GW of deficit (calibrated)
    b_trip: float = 0.10             # Hz per GW of sudden trip, transient (calibrated)
    # Beyond the 2,300 MW responsive reserve (sized for N-2, FERC-2011 p.84) primary response is exhausted
    # and only load damping (~1-2% of load per Hz, textbook) resists: ~0.6 Hz per extra GW at ~55 GW load.
    # Added for G3 lever realism (v0 finding: "supply changes too smoothly"); calibration targets re-checked.
    def_knee_mw: float = 2300.0
    s_def2: float = 0.6
    trip_tau_min: float = 3.0
    ufls_stages: list = field(default_factory=lambda: [[59.3, 0.05], [58.9, 0.10], [58.5, 0.10]])
    lr_trip_hz: float = 59.7         # Load Resources auto-trip
    collapse_hz: float = 59.4
    collapse_minutes: int = 9
    relay_reset_min: int = 10        # minutes above 59.4 Hz before the 9-minute counter resets (assumption)
    instant_collapse_hz: float = 58.4
    # ---------------------------------------------------------------- real-time desk and shed mechanics
    rt_lag_min: int = 5
    rt_shed_mw_per_min: float = 100.0   # 2011: 4,000 MW directed in 40 min (FERC-2011 p.87)
    shed_ramp_mw_per_min: float = 1000.0
    restore_mw_per_min: float = 100.0   # 2011: restoration in 500 MW blocks (FERC-2011 p.86)
    max_manual_shed_frac: float = 0.65  # 25% must stay on UFLS relays (FERC-2011 p.90) + ~10% critical load
    gas_facility_load_frac: float = 0.03
    clp_max: float = 0.3             # cold-load pickup on restoring long outages (generic assumption)
    imports_max_mw: float = 1200.0   # generic DC-tie assumption (2011 max 1,090 MW, FERC-2011 p.25)
    # Dec 1989 capability: only the North (Oklaunion, 1984) DC tie existed (~220 MW; East/Eagle Pass/Laredo/
    # Railroad ties came 1995-2007) and no LR/EILS/ERS market (interruptible tariffs only, ~500 MW). OUR assumption.
    imports_max_1989_mw: float = 220.0
    baseline_dr_1989_mw: float = 500.0
    baseline_lr_mw: float = 1062.0   # Load Resources, Feb 2011 (FERC-2011 p.53)
    baseline_ers_mw: float = 331.0   # EILS contracted Feb 2011 (FERC-2011 p.53); ERS 620 MW Jan 2014
    # ---------------------------------------------------------------- forecast / sensors
    fc_sigma0: float = 0.6
    fc_sigma_step: float = 0.45      # random-walk step => ~4 C sd at 72 h
    fc_region_corr: float = 0.7
    sensor_noise_c: float = 0.3
    # ---------------------------------------------------------------- score
    customers_per_mw: float = 225.0  # assumption: ~11M meters / ~49 GW avg winter load (ERCOT: 1 MW ~ 200 homes)
    total_customers: float = 11_000_000
    collapse_penalty_hh: float = 11_000_000 * 24 * 7  # black start of an islanded grid: ~a week (assumption)
    usd_per_home_hour: float = 40.0  # VOLL ~$9,000/MWh / 225 homes (generic assumption)
    unnecessary_weight: float = 1.0
    # ---------------------------------------------------------------- fitted inputs (set by calibrate)
    demand: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> "Params":
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in names})


def load_params(path: str | None = None) -> Params:
    path = path or PARAMS_PATH
    with open(path) as fh:
        d = json.load(fh)
    return Params.from_json(d.get("params", d))


def save_params(p: Params, extra: dict | None = None, path: str | None = None) -> None:
    out = {"version": "sim-v1", "params": p.to_json()}
    if extra:
        out.update(extra)
    with open(path or PARAMS_PATH, "w") as fh:
        json.dump(out, fh, indent=1)
