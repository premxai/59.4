"""Demand model (v0 structure, refit on 2010-2020) and the wind capacity-factor fit (2016-2020).

load ~ heating + cooling degree terms (squared terms extend linearly beyond the training
range: tangent-line rule fixed before any test) + hour-of-day + weekend + trend.
The heating-squared coefficient is then recalibrated so the Feb 1-4, 2011 event peak is
~59,000 MW (FERC-2011 p.77, IMM estimate of demand absent load shed; CALIBRATION-SAFE).

Only pre-2021 data is used (sim.data enforces the cutoff).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import data as D

POP_W = D.weights_vec(D.POP_WEIGHTS)


def pop_temp(temp: np.ndarray) -> np.ndarray:
    """(n, R) regional temps -> population-weighted temperature."""
    return temp @ POP_W


class DemandModel:
    def __init__(self, coef=None, hdd_max=None, cdd_max=None, rmse=None):
        self.coef = None if coef is None else np.asarray(coef, dtype=float)
        self.hdd_max, self.cdd_max, self.rmse = hdd_max, cdd_max, rmse

    # --- features
    @staticmethod
    def _sq(x, xmax):
        if xmax is None:
            return x ** 2
        return np.where(x <= xmax, x ** 2, xmax ** 2 + 2 * xmax * (x - xmax))

    def temp_part(self, t: np.ndarray) -> np.ndarray:
        c = self.coef
        hdd = np.maximum(0.0, 15.0 - t)
        cdd = np.maximum(0.0, t - 20.0)
        return c[1] * hdd + c[2] * self._sq(hdd, self.hdd_max) + c[3] * cdd + c[4] * self._sq(cdd, self.cdd_max)

    @staticmethod
    def calendar(ts: pd.DatetimeIndex, year_shift: float = 0.0) -> np.ndarray:
        local = ts.tz_convert("US/Central")
        hours = local.hour.to_numpy()
        cols = [(local.year + local.dayofyear / 365.0 - 2015.0 + year_shift).to_numpy(), (local.dayofweek >= 5).astype(float)]
        cols += [(hours == h).astype(float) for h in range(1, 24)]
        return np.column_stack(cols)

    def base_part(self, ts: pd.DatetimeIndex, year_shift: float = 0.0) -> np.ndarray:
        """Calendar (non-temperature) part of demand: intercept + trend + weekend + hour.
        year_shift moves the load-growth trend (synthetic storms use their fleet year's load level)."""
        return self.coef[0] + self.calendar(ts, year_shift) @ self.coef[5:]

    def predict_from(self, ts: pd.DatetimeIndex, t_pw: np.ndarray) -> np.ndarray:
        return self.base_part(ts) + self.temp_part(t_pw)

    def _X(self, ts, t):
        hdd = np.maximum(0.0, 15.0 - t)
        cdd = np.maximum(0.0, t - 20.0)
        return np.column_stack([np.ones_like(t), hdd, self._sq(hdd, self.hdd_max), cdd, self._sq(cdd, self.cdd_max),
                                self.calendar(ts)])

    # --- fit
    def fit(self, wide: pd.DataFrame, load: pd.Series) -> "DemandModel":
        t = pop_temp(D.wide_to_arrays(wide)["temp"])
        self.hdd_max = float(np.max(np.maximum(0.0, 15.0 - t)))
        self.cdd_max = float(np.max(np.maximum(0.0, t - 20.0)))
        X = self._X(wide.index, t)
        y = load.to_numpy()
        ok = np.isfinite(y) & np.isfinite(X).all(axis=1)
        self.coef, *_ = np.linalg.lstsq(X[ok], y[ok], rcond=None)
        self.rmse = float(np.sqrt(np.mean((y[ok] - X[ok] @ self.coef) ** 2)))
        return self

    def calibrate_peak(self, wide_event: pd.DataFrame, target_mw: float) -> float:
        t = pop_temp(D.wide_to_arrays(wide_event)["temp"])
        X = self._X(wide_event.index, t)
        pred = X @ self.coef
        k = int(np.argmax(pred))
        if X[k, 2] > 0:
            self.coef[2] += (target_mw - pred[k]) / X[k, 2]
        return float((X @ self.coef).max())

    def to_dict(self) -> dict:
        return {"coef": [float(c) for c in self.coef], "hdd_max": self.hdd_max, "cdd_max": self.cdd_max,
                "rmse": self.rmse}

    @classmethod
    def from_dict(cls, d: dict) -> "DemandModel":
        return cls(d["coef"], d["hdd_max"], d["cdd_max"], d.get("rmse"))


def fit_demand() -> tuple[DemandModel, dict]:
    """Fit on 2010-2020 (minus the Feb 1-5, 2011 shed days), then pin the 2011 event peak to 59,000 MW."""
    wide = D.weather_wide()
    load = D.load_hourly()
    idx = wide.loc["2010-01-01":"2020-12-31"].index.intersection(load.index)
    shed = (idx >= pd.Timestamp("2011-02-01", tz="UTC")) & (idx < pd.Timestamp("2011-02-06", tz="UTC"))
    idx = idx[~shed]
    dm = DemandModel().fit(wide.loc[idx], load.loc[idx])
    peak = dm.calibrate_peak(D.weather_window("2011-02-01", "2011-02-04 23:00"), 59000.0)
    checks = {}
    for label, day in [("2011-02-10", "2011-02-10"), ("2018-01-17", "2018-01-17"), ("2014-01-06", "2014-01-06")]:
        w = wide.loc[pd.Timestamp(day, tz="UTC"):pd.Timestamp(day, tz="UTC") + pd.Timedelta(hours=36)]
        pred = dm.predict_from(w.index, pop_temp(D.wide_to_arrays(w)["temp"]))
        checks[label] = {"pred_peak": round(float(pred.max())), "obs_served_peak": round(float(load.reindex(w.index).max()))}
    return dm, {"rmse_mw": round(dm.rmse), "event_2011_peak_mw": round(peak), "checks": checks}


def fit_wind_cf() -> tuple[list, dict]:
    """CF = clip(a + b*ws + c*ws^2, 0, 0.95) on fleet-weighted 10 m wind, fit on 2016-2020 output (v0 method)."""
    gen = D.gen_by_fuel()
    cap = D.capacity_by_fuel()
    wspan = gen.loc["2016-01-01":"2020-12-31", "wind"].dropna()
    capy = {y: float(cap[(cap["as_of"] == f"{y}-02-01") & (cap["fuel_detail"] == "wind")]["winter_mw"].sum())
            for y in range(2016, 2021)}
    wcap = np.array([capy[y] for y in wspan.index.year])
    wide = D.weather_wide().reindex(wspan.index)
    ws = D.wide_to_arrays(wide)["wind"] @ D.weights_vec(D.WIND_LOCS)
    cf = wspan.to_numpy() / wcap
    ok = np.isfinite(ws) & np.isfinite(cf)
    X = np.column_stack([np.ones(ok.sum()), ws[ok], ws[ok] ** 2])
    coef, *_ = np.linalg.lstsq(X, cf[ok], rcond=None)
    pred = np.clip(X @ coef, 0, 0.95)
    return [float(c) for c in coef], {"rmse_cf": round(float(np.sqrt(np.mean((pred - cf[ok]) ** 2))), 4),
                                      "mean_cf_obs": round(float(cf[ok].mean()), 4)}
