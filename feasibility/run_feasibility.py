"""Feasibility runner: demand fit (G2 prep), 2011 calibration (G2), 2021 difficulty (G3), validity (G4).

Calibration uses ONLY pre-2021 data. 2021 data is touched only in the final evaluation block.
"""
from __future__ import annotations

import itertools
import json
import os
import sys
from dataclasses import replace

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from sim_v0 import (DemandModel, Fleet, GoodScriptedPolicy, NaivePolicy, Params,  # noqa: E402
                    StatusQuoPolicy, simulate)

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)


def slug(s: str) -> str:
    return s.lower().replace(" ", "_")


def load_frames():
    load = pd.read_parquet(os.path.join(ROOT, "data/processed/ercot_load_hourly.parquet"))
    load = load.set_index("ts_utc")["load_mw"].sort_index()
    w = pd.read_parquet(os.path.join(ROOT, "data/processed/weather_hourly.parquet"))
    w["loc"] = w["location"].map(slug)
    wide = w.pivot_table(index="ts_utc", columns="loc",
                         values=["temp_c", "wind_ms", "precip_mm", "snowfall_cm"], aggfunc="first")
    rename = {"temp_c": "temp", "wind_ms": "wind", "precip_mm": "precip", "snowfall_cm": "snow"}
    wide.columns = [f"{rename[a]}_{b}" for a, b in wide.columns]
    wide = wide.sort_index()
    cap = pd.read_csv(os.path.join(ROOT, "data/processed/ercot_capacity_by_fuel_winter.csv"))
    return load, wide, cap


def load_1989_wide() -> pd.DataFrame:
    """Dec 1989 freeze weather from the raw Open-Meteo JSON (hour-beginning GMT -> hour-ending UTC)."""
    raw = os.path.join(ROOT, "data/raw/open_meteo")
    cols = {}
    for fn in os.listdir(raw):
        if not fn.endswith("_1989.json"):
            continue
        loc = slug(fn[: -len("_1989.json")].replace("_", " "))
        with open(os.path.join(raw, fn)) as fh:
            h = json.load(fh)["hourly"]
        idx = pd.to_datetime(h["time"], utc=True) + pd.Timedelta(hours=1)
        for src, dst in [("temperature_2m", "temp"), ("wind_speed_10m", "wind"), ("precipitation", "precip"), ("snowfall", "snow")]:
            cols[f"{dst}_{loc}"] = pd.Series(h[src], index=idx, dtype=float)
    return pd.DataFrame(cols).sort_index()


class ScaledDemand:
    """Demand shape from the fitted model, rescaled to a known historical peak (pre-2021 fact)."""
    def __init__(self, dm: DemandModel, df: pd.DataFrame, peak_mw: float):
        self.dm, self.k = dm, peak_mw / float(dm.predict(df).max())

    def predict(self, df):
        return self.dm.predict(df) * self.k


# Dec 1989 fleet: ~54,000 MW nameplate (FERC 2011 report fn.234). Fuel split is our approximation.
FLEET_1989 = Fleet(gas=34000.0, coal=15000.0, nuclear=2500.0, wind=0.0, solar=0.0, other=1500.0)


def fleet_for(cap: pd.DataFrame, year: int) -> Fleet:
    c = cap[cap["as_of"] == f"{year}-02-01"].set_index("fuel_detail")["winter_mw"]
    g = lambda *k: float(sum(c.get(x, 0.0) for x in k))  # noqa: E731
    return Fleet(gas=g("gas_cc", "gas_ct", "gas_ice", "gas_steam"), coal=g("coal"), nuclear=g("nuclear"),
                 wind=g("wind"), solar=g("solar"), other=g("biomass", "hydro", "oil", "other"))


def window(wide, start, end):
    return wide.loc[pd.Timestamp(start, tz="UTC"):pd.Timestamp(end, tz="UTC")]


def main():
    load, wide, cap = load_frames()
    report = {}

    # ------------------------------------------------------------------ demand model (pre-2021 only)
    train_idx = wide.loc["2010-01-01":"2020-12-31"].index.intersection(load.index)
    shed_2011 = (train_idx >= pd.Timestamp("2011-02-01", tz="UTC")) & (train_idx < pd.Timestamp("2011-02-06", tz="UTC"))
    fit_idx = train_idx[~shed_2011]
    dm = DemandModel().fit(wide.loc[fit_idx], load.loc[fit_idx])
    # ERCOT/FERC 2011 report: demand without shedding would have been ~59,000 MW (calibration-safe)
    peak_2011 = dm.calibrate_peak(window(wide, "2011-02-01", "2011-02-04"), 59000.0)
    print(f"demand model: 2011 event peak recalibrated to {peak_2011:,.0f} MW")
    checks = {}
    for label, ts in [("2011-02-10 peak (57,284 obs)", "2011-02-10 02:00"), ("2018-01-17 peak (65.8k obs)", "2018-01-17 14:00")]:
        day = wide.loc[pd.Timestamp(ts[:10], tz="UTC"):pd.Timestamp(ts[:10], tz="UTC") + pd.Timedelta(hours=36)]
        pred = dm.predict(day)
        obs = load.reindex(day.index)
        checks[label] = {"pred_peak": round(float(pred.max())), "obs_peak": round(float(obs.max()))}
    report["demand_model"] = {"rmse_mw": round(dm.rmse), "peak_checks": checks}
    print("DEMAND MODEL", json.dumps(report["demand_model"], indent=1))

    # ------------------------------------------------------------------ calibration on Feb 2011 (pre-2021)
    f2011 = fleet_for(cap, 2011)
    w2011 = window(wide, "2011-01-30", "2011-02-07")
    served_2011 = load.reindex(w2011.index)
    est_shed_2011 = np.maximum(0.0, dm.predict(w2011) - served_2011.to_numpy())
    obs_shed_hours = served_2011.index[(est_shed_2011 > 1500)]
    print(f"\n2011 fleet: {f2011}")
    print(f"2011 estimated shed (pred demand - served): peak {est_shed_2011.max():,.0f} MW, hours>1.5GW: {len(obs_shed_hours)}")

    # observed generation by fuel (pre-2021) for calibration targets
    gen = pd.read_parquet(os.path.join(ROOT, "data/processed/ercot_gen_by_fuel_hourly.parquet"))
    gen = gen.pivot_table(index="ts_utc", columns="fuel", values="mw", aggfunc="sum").sort_index()

    # wind CF curve fit on 2016-2020 observed output (pre-2021)
    from sim_v0 import WIND_LOCS, fit_wind_cf, weighted  # noqa: E402
    wspan = gen.loc["2016-01-01":"2020-12-31", "wind"].dropna()
    wcap = wspan.index.year.map(lambda y: fleet_for(cap, y).wind).to_numpy()
    ws10 = weighted(wide.reindex(wspan.index), "wind", WIND_LOCS).to_numpy()
    wind_coef = fit_wind_cf(ws10, wspan.to_numpy() / wcap)
    print(f"wind CF fit (2016-2020): coef={tuple(round(c, 4) for c in wind_coef)}")

    ev = gen.reindex(w2011.index)
    coal_pre = float(gen.loc["2011-01-30":"2011-01-31", "coal"].max())
    target_coal_drop = coal_pre - float(ev.loc["2011-02-01":"2011-02-04", "coal"].min())
    target_wind_mean = float(ev.loc["2011-02-01":"2011-02-04", "wind"].mean())
    print(f"2011 targets: coal drop {target_coal_drop:,.0f} MW, event wind mean {target_wind_mean:,.0f} MW")

    # quiet-winter windows (pre-2021, no real load shed): false shortages are penalized
    quiet = [(f"{y}-12-01", f"{y+1}-02-28") for y in (2012, 2013, 2015, 2017, 2018, 2019)]
    # FERC/NERC 2011 report (calibration-safe): 4,948 MW actual max shed for 7 h 24 min; gas supply outages ~1,282 MW
    TARGET_PEAK, TARGET_HOURS, TARGET_GAS_LOSS = 4948.0, 7, 1300.0
    # Dec 1989 (calibration-safe): 11,809 MW net / 16,805 gross lost; 1,710 MW shed; peak 38,300 MW
    w1989 = load_1989_wide().loc["1989-12-19":"1989-12-27"]
    dm1989 = ScaledDemand(dm, w1989, 38300.0 + 1710.0)
    TARGET_1989_OUT, TARGET_1989_SHED = 13500.0, 1710.0

    def score(p: Params) -> tuple[float, dict]:
        r = simulate(w2011, f2011, NaivePolicy(), dm, p)
        h = r.hourly
        sim_deficit = np.maximum(0.0, h["demand"] - h["supply"]).to_numpy()
        ev_h = h.loc["2011-02-01":"2011-02-04"]
        coal_drop = float(h["avail_coal"].iloc[:24].max() - ev_h["avail_coal"].min())
        wind_mean = float(ev_h["avail_wind"].mean())
        gas_loss = float((ev_h["avail_gas"] / ev_h["gas_index"].clip(lower=0.05) * (1 - ev_h["gas_index"])).max())
        r89 = simulate(w1989, FLEET_1989, NaivePolicy(), dm1989, p)
        h89 = r89.hourly
        out89 = float(max(sum(FLEET_1989.cap(f) * h89[f"out_{f}"].iloc[k] for f in ("gas", "coal", "nuclear", "other"))
                          for k in range(len(h89))))
        def89 = float(np.maximum(0.0, h89["demand"] - h89["supply"]).max())
        loss = (abs(sim_deficit.max() - TARGET_PEAK) / 3000.0 + abs((sim_deficit > 1500).sum() - TARGET_HOURS) / 10.0
                + abs(coal_drop - target_coal_drop) / 2000.0 + abs(wind_mean - target_wind_mean) / 1500.0
                + abs(gas_loss - TARGET_GAS_LOSS) / 1500.0
                + abs(out89 - TARGET_1989_OUT) / 3500.0 + abs(def89 - TARGET_1989_SHED) / 2000.0
                + (3.0 if r.collapsed else 0.0) + (3.0 if r89.collapsed else 0.0))
        false_hours = 0
        for a, b in quiet:
            rq = simulate(window(wide, a, b), fleet_for(cap, int(b[:4])), NaivePolicy(), dm, p)
            false_hours += int((rq.hourly["shed_mw"] > 500).sum()) + (50 if rq.collapsed else 0)
        return loss + false_hours / 5.0, {
            "sim_peak_deficit": round(float(sim_deficit.max())), "sim_hours_gt_1.5GW": int((sim_deficit > 1500).sum()),
            "sim_coal_drop": round(coal_drop), "sim_wind_mean": round(wind_mean), "sim_gas_fuel_loss_2011": round(gas_loss),
            "sim_1989_cold_outage_mw": round(out89), "sim_1989_peak_deficit": round(def89),
            "collapsed": r.collapsed, "false_shed_hours_quiet_winters": false_hours}

    base = Params(wind_cf_coef=wind_coef, ice_gain=0.02)
    grid = {
        "trip_t50": [-12.0, -9.0, -7.0, -5.0],
        "trip_pmax_mult": [0.5, 1.0, 2.0],
        "trip_scale": [2.0, 4.0],
        "recover_rate_cold": [0.004, 0.02],
        "gas_loss_max": [0.3, 0.6],
        "gas_loss_k": [300.0, 1000.0, 3000.0],
    }
    best = None
    for t50, pm, tsc, rrc, glm, glk in itertools.product(*grid.values()):
        p = replace(base, trip_t50=t50, trip_pmax={k: v * pm for k, v in base.trip_pmax.items()}, trip_scale=tsc,
                    recover_rate_cold=rrc, gas_loss_max=glm, gas_loss_k=glk)
        s, info = score(p)
        if best is None or s < best[0]:
            best = (s, p, info, {"trip_t50": t50, "trip_pmax_mult": pm, "trip_scale": tsc, "recover_rate_cold": rrc,
                                 "gas_loss_max": glm, "gas_loss_k": glk})
    s, P, info, knobs = best
    info.update({"target_coal_drop": round(target_coal_drop), "target_wind_mean": round(target_wind_mean)})
    report["calibration_2011"] = {"loss": round(s, 3), "knobs": knobs, **info,
                                  "target_peak_shed": TARGET_PEAK, "target_hours_gt_1.5GW": TARGET_HOURS,
                                  "model_estimated_2011_shed_peak": round(float(est_shed_2011.max()))}
    print("\nCALIBRATION", json.dumps(report["calibration_2011"], indent=1))
    with open(os.path.join(OUT, "calibrated_params.json"), "w") as fh:
        json.dump({k: (v if not isinstance(v, tuple) else list(v)) for k, v in P.__dict__.items()}, fh, indent=1)

    # Jan 2018 cold snap (pre-2021 gate): should not collapse with a naive operator
    r18 = simulate(window(wide, "2018-01-10", "2018-01-22"), fleet_for(cap, 2018), NaivePolicy(), dm, P)
    report["gate_jan_2018"] = {"collapsed": r18.collapsed, "peak_shed": round(r18.peak_shed_mw)}
    print("\nGATE Jan 2018", report["gate_jan_2018"])

    # ------------------------------------------------------------------ LOCK. Everything below touches 2021 (test-only).
    f2021 = fleet_for(cap, 2021)
    w2021 = window(wide, "2021-02-08", "2021-02-22")
    pred_2021 = dm.predict(w2021)
    served_2021 = load.reindex(w2021.index).to_numpy()
    real_shed = pd.Series(np.maximum(0.0, pred_2021 - served_2021), index=w2021.index)
    real_shed[real_shed < 1000] = 0.0  # ignore model noise outside the shed period
    print(f"\n2021 fleet: {f2021}")
    print(f"2021 model demand peak {pred_2021.max():,.0f} MW; served peak {np.nanmax(served_2021):,.0f}; "
          f"estimated real shed peak {real_shed.max():,.0f} MW over {(real_shed>0).sum()} h")

    runs = {}
    for name, pol in [("naive_v1", NaivePolicy()), ("status_quo_2021_rules", StatusQuoPolicy()),
                      ("good_scripted", GoodScriptedPolicy())]:
        r = simulate(w2021, f2021, pol, dm, P)
        runs[name] = {"collapsed": r.collapsed, "collapse_ts": str(r.collapse_ts) if r.collapse_ts is not None else None,
                      "customer_hours_M": round(r.customer_hours / 1e6, 1), "peak_shed_mw": round(r.peak_shed_mw),
                      "min_freq": round(r.min_freq, 3), "max_min_below_59.4": r.minutes_below_59_4_max,
                      "chain_head": [f"{t}: {m}" for t, m in r.cause_chain[:4]]}
        r.hourly.to_csv(os.path.join(OUT, f"2021_{name}.csv"))
    report["test_2021"] = runs
    print("\nTEST 2021", json.dumps(runs, indent=1))

    # Reference (TEST-ONLY facts, data/facts/EVENTS.md): ~20 GW peak shed, 70.5 h, avg ~14 GW
    real_ref = {"peak_shed_mw": 20000, "shed_hours": 70.5, "customer_hours_M": round(14000 * 70.5 * 225 / 1e6, 1),
                "collapsed": False, "min_freq": 59.302, "minutes_below_59.4": 4.4}
    report["real_2021_reference"] = real_ref
    print("REAL 2021 (reference, test-only):", real_ref)
    sq, good, naive = runs["status_quo_2021_rules"], runs["good_scripted"], runs["naive_v1"]
    report["gates"] = {
        "G3a_v1_fails_badly": naive["collapsed"] or naive["customer_hours_M"] > 2 * sq["customer_hours_M"],
        "G3b_good_beats_status_quo": (not good["collapsed"]) and good["customer_hours_M"] < sq["customer_hours_M"],
        "G4_status_quo_vs_real": {"sim_status_quo": {k: sq[k] for k in ("collapsed", "peak_shed_mw", "customer_hours_M", "min_freq")},
                                  "real": real_ref},
    }
    print("\nGATES", report["gates"])
    with open(os.path.join(OUT, "feasibility_report.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
