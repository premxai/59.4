"""Calibrate simulator v1 on PRE-2021 events only, with the status-quo (pre-2021 ERCOT procedure) operator.

    .venv/Scripts/python.exe -m sim.calibrate --n 1600 --workers 24

Stages: (0) fit demand + wind CF (2010-2020 / 2016-2020); (1) random search over the free
parameters on the event set (Feb 2011, Dec 1989, Jan 2014, Feb 10 2011, Jan 17 2018) x 3 seeds;
(2) local refinement around the best; (3) quiet-winter check (5 pre-2021 winters, no shedding) on the
top candidates; write sim/params_v1.json and sim/out/calibration_report.json.

Targets are CALIBRATION-SAFE rows of data/facts/EVENTS.md (FERC-2011, ERCOT-EEA-2014) plus the
2011 observed wind output (ERCOT fuel mix, 2011).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
from dataclasses import replace
from multiprocessing import Pool

import numpy as np
import pandas as pd

from . import data as D
from . import scenarios as S
from .api import get_world
from .demand import fit_demand, fit_wind_cf
from .engine import simulate
from .params import PARAMS_PATH, Params, save_params
from .policies import StatusQuoPolicy

OUT = os.path.join(os.path.dirname(__file__), "out")
SEEDS = [0, 1, 2]
GATE_SEEDS = [0, 1, 2, 3, 4, 5]          # no-shed gates are checked on more seeds (robustness)
GATE_SCNS = {"hist_2014_jan", "gate_2011_feb10", "gate_2018_jan17"}
EVENT_SCNS = ["hist_2011_feb", "hist_1989_dec", "hist_2014_jan", "gate_2011_feb10", "gate_2018_jan17"]

# (target, scale) -- loss term = weight * |sim - target| / scale
TARGETS = {
    "2011_peak_shed_mw": (4948.0, 1500.0, 2.5),      # FERC-2011 p.89 max simultaneous 4,947.9 MW
    "2011_shed_hours": (7.4, 3.0, 1.5),              # FERC-2011 p.178: 7 h 24 min
    "2011_planned_mw": (12413.0, 1500.0, 0.5),       # FERC-2011 p.79 (Feb 2)
    "2011_forced_peak_mw": (14702.0, 2500.0, 2.0),   # FERC-2011 p.79 peak net forced outage 6:12 AM Feb 2
    "2011_coal_out_mw": (5200.0, 2000.0, 0.7),       # coal generation drop, ERCOT fuel mix (v0 measure)
    "2011_gas_fuel_mw": (1282.0, 1000.0, 0.7),       # FERC-2011 p.153 fuel-supply outages
    "2011_prod_loss": (0.21, 0.06, 0.7),             # FERC-2011 p.114: TX+NM production -21%
    "2011_min_freq": (59.576, 0.08, 1.0),            # FERC-2011 p.87
    "2011_wind_mean_mw": (None, 1500.0, 0.5),        # observed Feb 1-4 2011 mean wind output (set at runtime)
    "2011_weather_gross_mw": (24087.0, 8000.0, 0.3),  # weather 22,805 + fuel 1,282 MW (FERC-2011 pp.144,153)
    "1989_forced_peak_mw": (11809.0, 2500.0, 1.5),   # FERC-2011 p.178 net capacity reduction
    "1989_weather_gross_mw": (15559.0, 6000.0, 0.3),  # 16,805 gross minus 1,246 non-weather (FERC-2011 p.175)
    "1989_peak_shed_mw": (1710.0, 1000.0, 1.0),      # FERC-2011 p.178
    "1989_shed_hours": (5.8, 3.0, 0.5),              # 5 h 47 min
    "1989_min_freq": (59.65, 0.08, 1.0),             # FERC-2011 pp.173-174
    "1989_gas_fuel_mw": (1500.0, 1000.0, 0.5),       # gas-curtailment derate (FERC-2011 p.175)
    "2014_forced_peak_mw": (9355.0, 2500.0, 1.0),    # ERCOT-EEA-2014: 9,355 MW lost
    "2014_shed_mw": (0.0, 300.0, 1.5),               # no firm load shed
    "2014_eea_max": (2.0, 1.0, 0.5),                 # reached EEA 2
    "2011feb10_shed_mw": (0.0, 300.0, 1.5),          # no load shed
    "2018jan17_shed_mw": (0.0, 300.0, 1.5),          # no load shed
    "gate_shed_any": (0.0, 0.1, 1.0),                # share of (gate, seed) runs with any shed > 100 MW
}

# free parameters: name -> (lo, hi, log)
SPACE = {
    "vuln_base": (0.12, 0.55, False),
    "coal_mult": (0.4, 3.0, False),
    "thr_mu": (-13.0, -3.0, False),
    "thr_sigma": (1.5, 6.0, False),
    "expo_tau_h": (2.0, 14.0, False),
    "windchill_k": (0.0, 1.0, False),
    "cold_repair_rate": (0.005, 0.08, True),
    "recover_hi": (6.0, 36.0, False),
    "fts_slope": (0.02, 0.08, False),
    "prod_loss_k": (100.0, 3000.0, True),
    "deliv_buffer": (0.05, 0.35, False),
    "s_def": (0.05, 0.6, True),
    "b_trip": (0.02, 0.35, True),
    "ice_gain": (0.005, 0.1, True),
    "bg_cold_mult": (0.0, 15.0, False),
    "prod_loss_max": (0.2, 0.7, False),
}


# Gas sub-model calibrated separately on its own observables (see gas_block()): prod_loss_max is an
# assumption (60%); prod_loss_k pins the 2011 TX+NM production drop at 21% (FERC-2011 p.114);
# deliv_buffer makes 1989's gas-curtailment derate ~1,500 MW (FERC-2011 p.175, ~300 MW of it from the
# shed feedback) while 2011's 1,282 MW (p.153) comes from the electric-gas feedback alone.
GAS_FIXED = {"prod_loss_max": 0.6, "prod_loss_k": 328.5, "deliv_buffer": 0.315}


def apply(base: Params, x: dict) -> Params:
    x = {**x, **GAS_FIXED}
    vm = dict(base.vuln_mult)
    vm["coal"] = x["coal_mult"]
    return replace(base, vuln_base=x["vuln_base"], vuln_mult=vm, thr_mu=x["thr_mu"], thr_sigma=x["thr_sigma"],
                   expo_tau_h=x["expo_tau_h"], windchill_k=x["windchill_k"], cold_repair_rate=x["cold_repair_rate"],
                   recover_delay_h=[4.0, max(5.0, x["recover_hi"])], fts_slope=x["fts_slope"],
                   prod_loss_k=x["prod_loss_k"], deliv_buffer=x["deliv_buffer"], s_def=x["s_def"],
                   b_trip=x["b_trip"], ice_gain=x["ice_gain"], bg_cold_mult=x["bg_cold_mult"],
                   prod_loss_max=x["prod_loss_max"])


def sample(rng, center=None, width=1.0) -> dict:
    x = {}
    for k, (lo, hi, lg) in SPACE.items():
        if center is None:
            u = rng.random()
        else:
            c = center[k]
            cu = (math.log(c / lo) / math.log(hi / lo)) if lg else (c - lo) / (hi - lo)
            u = float(np.clip(cu + width * 0.15 * rng.standard_normal(), 0.0, 1.0))
        x[k] = lo * (hi / lo) ** u if lg else lo + u * (hi - lo)
    return x


def _win(f: pd.DataFrame, a: str, b: str) -> pd.DataFrame:
    return f.loc[pd.Timestamp(a, tz="UTC"):pd.Timestamp(b, tz="UTC")]


def measures(p: Params, seeds=SEEDS) -> dict:
    acc: dict = {}

    def add(k, v):
        acc.setdefault(k, []).append(float(v))

    for sid in EVENT_SCNS:
        w = get_world(sid, p)
        for sd in (GATE_SEEDS if sid in GATE_SCNS else seeds):
            r = simulate(w, StatusQuoPolicy(), p, seed=sd, keep_world=False)
            f = r.frame()
            forced = f.out_cold + f.out_fuel + f.out_fts + f.out_bg
            if sid == "hist_2011_feb":
                e = _win(f, "2011-02-01 06:00", "2011-02-05 06:00")
                add("2011_peak_shed_mw", e.shed_mw.max())
                add("2011_shed_hours", (e.shed_mw > 50).sum())
                add("2011_planned_mw", f.planned.loc[pd.Timestamp("2011-02-02 12:00", tz="UTC")])
                add("2011_forced_peak_mw", forced.loc[e.index].max())
                add("2011_coal_out_mw", e.out_coal.max() - _win(f, "2011-01-30", "2011-01-31 23:00").out_coal.min())
                add("2011_gas_fuel_mw", e.gas_nofuel.max())
                add("2011_prod_loss", e.prod_loss.max())
                add("2011_min_freq", e.freq_min.min())
                add("2011_wind_mean_mw", _win(f, "2011-02-01", "2011-02-04 23:00").avail_wind.mean())
                add("2011_weather_gross_mw", r.extra["gross_forced_mw"])
                add("2011_collapse", r.collapsed)
            elif sid == "hist_1989_dec":
                e = _win(f, "1989-12-21 00:00", "1989-12-26 00:00")
                add("1989_forced_peak_mw", forced.loc[e.index].max() + 0.0)
                add("1989_weather_gross_mw", r.extra["gross_forced_mw"])
                add("1989_peak_shed_mw", e.shed_mw.max())
                add("1989_shed_hours", (e.shed_mw > 50).sum())
                add("1989_min_freq", e.freq_min.min())
                add("1989_gas_fuel_mw", e.gas_nofuel.max())
                add("1989_collapse", r.collapsed)
            elif sid == "hist_2014_jan":
                e = _win(f, "2014-01-05 12:00", "2014-01-08 12:00")
                add("2014_forced_peak_mw", forced.loc[e.index].max())
                add("2014_shed_mw", e.shed_mw.max())
                add("gate_shed_any", e.shed_mw.max() > 100)
                add("2014_eea_max", min(2.0, e.eea.max()) if e.shed_mw.max() <= 0 else 3.0)
                add("2014_collapse", r.collapsed)
            elif sid == "gate_2011_feb10":
                add("2011feb10_shed_mw", f.shed_mw.max())
                add("gate_shed_any", f.shed_mw.max() > 100)
                add("2011feb10_collapse", r.collapsed)
            elif sid == "gate_2018_jan17":
                add("2018jan17_shed_mw", f.shed_mw.max())
                add("gate_shed_any", f.shed_mw.max() > 100)
                add("2018jan17_collapse", r.collapsed)
    return {k: float(np.mean(v)) for k, v in acc.items()}


def loss(m: dict, targets: dict) -> float:
    s = 0.0
    for k, (tgt, scale, wt) in targets.items():
        if k in m and tgt is not None:
            s += wt * abs(m[k] - tgt) / scale
    s += 5.0 * sum(v for k, v in m.items() if k.endswith("_collapse"))
    return s


def quiet_check(p: Params, seeds=(0,)) -> dict:
    out = {}
    for sid in S.QUIET:
        w = get_world(sid, p)
        hrs, mx, col = 0, 0.0, False
        for sd in seeds:
            r = simulate(w, StatusQuoPolicy(), p, seed=sd, keep_world=False)
            hrs += int((r.hourly["shed_mw"] > 1.0).sum())
            mx = max(mx, float(r.hourly["shed_mw"].max()))
            col = col or r.collapsed
        out[sid] = {"shed_hours": hrs, "peak_shed_mw": round(mx), "collapsed": col}
    return out


def _prior_centers() -> list:
    """Seed the refinement with the best point of a previous calibration report, if any."""
    path = os.path.join(OUT, "calibration_report.json")
    try:
        with open(path) as fh:
            rep = json.load(fh)
        xs = [dict(rep["free_params"])] + [dict(c["x"]) for c in rep.get("candidates", [])[:3]]
    except Exception:
        return []
    for x in xs:
        for k, (lo, hi, _) in SPACE.items():
            x.setdefault(k, {"bg_cold_mult": 2.0, "prod_loss_max": 0.6}.get(k, (lo + hi) / 2))
            x[k] = float(min(hi, max(lo, x[k])))
    return xs


# ------------------------------------------------------------------ multiprocessing plumbing
_BASE: dict = {}


def _init(base_json, targets):
    _BASE["p"] = Params.from_json(base_json)
    _BASE["t"] = targets
    D.weather_wide()
    D.weather_1989()


def _eval(x):
    p = apply(_BASE["p"], x)
    try:
        m = measures(p)
        return x, loss(m, _BASE["t"]), m
    except Exception as e:  # pragma: no cover
        return x, 1e9, {"error": repr(e)}


def _eval_quiet(x):
    p = apply(_BASE["p"], x)
    return x, quiet_check(p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1600)
    ap.add_argument("--refine", type=int, default=800)
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--width", type=float, default=1.0)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()

    # stage 0: fitted inputs (pre-2021 only)
    dm, dinfo = fit_demand()
    wc, winfo = fit_wind_cf()
    base = Params(demand=dm.to_dict(), wind_cf_coef=wc)
    gen = D.gen_by_fuel()
    wind_obs = float(gen.loc["2011-02-01":"2011-02-04", "wind"].mean())
    coal_pre = float(gen.loc["2011-01-30":"2011-01-31", "coal"].max())
    coal_drop = coal_pre - float(gen.loc["2011-02-01":"2011-02-04", "coal"].min())
    targets = dict(TARGETS)
    targets["2011_wind_mean_mw"] = (wind_obs, 1500.0, 0.5)
    print(f"demand fit {dinfo}\nwind fit {winfo}\n2011 observed wind mean {wind_obs:,.0f} MW; coal drop {coal_drop:,.0f} MW")

    rng = np.random.default_rng(20261010 + args.n + args.refine)
    xs = [sample(rng) for _ in range(args.n)] + _prior_centers()
    with Pool(args.workers, initializer=_init, initargs=(base.to_json(), targets)) as pool:
        res = pool.map(_eval, xs, chunksize=4)
        res.sort(key=lambda r: r[1])
        print(f"stage 1: {len(res)} samples in {time.time() - t0:.0f}s; best loss {res[0][1]:.3f}")
        # stage 2: local refinement around the best few
        centers = [r[0] for r in res[:6]]
        xs2 = [sample(rng, centers[k % len(centers)], width=args.width if k < args.refine // 2 else 0.4 * args.width)
               for k in range(args.refine)]
        res2 = pool.map(_eval, xs2, chunksize=4)
        allr = sorted(res + res2, key=lambda r: r[1])
        print(f"stage 2: best loss {allr[0][1]:.3f} ({time.time() - t0:.0f}s)")
        top = allr[:args.top]
        q = pool.map(_eval_quiet, [r[0] for r in top])
    ranked = []
    for (x, l_, m), (_, qc) in zip(top, q):
        qpen = sum(v["shed_hours"] for v in qc.values()) / 3.0 + 5.0 * sum(v["collapsed"] for v in qc.values())
        ranked.append((l_ + qpen, l_, x, m, qc))
    ranked.sort(key=lambda r: r[0])
    total, l_best, x_best, m_best, q_best = ranked[0]
    P = apply(base, x_best)

    table = []
    for k, (tgt, scale, wt) in targets.items():
        table.append({"measure": k, "target": tgt, "sim_mean_3seeds": round(m_best.get(k, float("nan")), 3),
                      "scale": scale, "weight": wt})
    report = {"loss_events": round(l_best, 3), "loss_with_quiet": round(total, 3), "free_params": x_best,
              "targets_vs_sim": table, "quiet_winters": q_best, "demand_fit": dinfo, "wind_fit": winfo,
              "observed_2011": {"wind_mean_mw": round(wind_obs), "coal_gen_drop_mw": round(coal_drop)},
              "search": {"stage1": args.n, "stage2": args.refine, "seeds": SEEDS, "elapsed_s": round(time.time() - t0)},
              "candidates": [{"loss_total": round(r[0], 3), "loss_events": round(r[1], 3), "x": r[2]} for r in ranked]}
    save_params(P, {"status": "calibrated (pre-2021 only)", "calibrated_at": time.strftime("%Y-%m-%d %H:%M"),
                    "calibration": {k: report[k] for k in ("loss_events", "loss_with_quiet", "free_params",
                                                           "targets_vs_sim", "quiet_winters")},
                    "demand_fit": dinfo, "wind_fit": winfo})
    with open(os.path.join(OUT, "calibration_report.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=str)
    print(json.dumps({k: report[k] for k in ("loss_events", "loss_with_quiet", "free_params", "quiet_winters")}, indent=1))
    for row in table:
        print(f"  {row['measure']:<26} target {row['target']!s:>10}  sim {row['sim_mean_3seeds']}")
    print(f"wrote {PARAMS_PATH} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
