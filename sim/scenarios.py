"""Scenarios: historical pre-2021 windows (calibration/gate) and synthetic practice storms.

Every scenario is built ONLY from pre-2021 weather (2007-2020 ERA5 parquet, or the Dec 1989 raw
JSON). Synthetic storms transform those windows (PLAN.md §8 "Train" split):
  shift    temperatures X C colder in a core window (12 h cosine taper), optionally some regions only
  stretch  repeat the coldest whole days of a core window (duration x factor)
  geo      move cold to other regions (region <- another region's weather)
  flash    a sharp cold pulse: -X C reached within `onset_h`, held, then released
  precip   add freezing precipitation (wind icing) in chosen regions while T < 0
  wind     scale wind speed (stronger wind chill)
  demand   scale demand in the core window (demand surge)
  relabel  timing: replay the weather on another (pre-2021) calendar date, e.g. in the late-February
           maintenance season when ~20% of thermal capacity is out for planned work
A storm = spec + seed list. `materialize()` returns the dict the engine's `build_world` consumes.

Splits: TRAIN_IDS (9 synthetic storms, evolution), HELDOUT_IDS (8 synthetic storms, the practice exam, never used for
evolution), GATE_IDS (real pre-2021 no-shed days: no-regression / don't-over-shed). See sim/README.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import data as D

UTC = "UTC"


def _t(x) -> pd.Timestamp:
    return D.to_utc(x)


@dataclass
class Scenario:
    id: str
    public: str
    start: str
    end: str
    fleet_year: int
    transforms: list = field(default_factory=list)
    demand_peak_mw: float | None = None
    seeds: list = field(default_factory=lambda: [0, 1, 2])
    kind: str = "historical"            # historical | gate | quiet | synthetic | season
    failure_modes: list = field(default_factory=list)
    description: str = ""
    split: str = ""                     # train | heldout | gate | calibration | ""

    def materialize(self) -> dict:
        wide = D.weather_window(self.start, self.end)
        src_ts = wide.index
        wx = D.wide_to_arrays(wide)
        dmult = np.ones(len(src_ts))
        start_label = _t(self.start)
        for tr in self.transforms:
            op = tr["op"]
            if op == "relabel":
                # timing: replay the same weather on another calendar date (whole days, so the local hour of
                # day is unchanged). Changes the season's planned-maintenance level, weekday and demand calendar.
                to = _t(tr["to"])
                if to >= D.CUTOFF:
                    raise D.HonestyError("relabel target must be before 2021-01-01")
                days = round((to - start_label).total_seconds() / 86400.0)
                start_label = start_label + pd.Timedelta(days=days)
            elif op == "stretch":
                src_ts, wx, dmult = _stretch(src_ts, wx, dmult, tr)
            elif op == "shift":
                w8 = _window(src_ts, tr.get("core"), tr.get("taper_h", 12))
                cols = _cols(tr.get("regions"))
                wx["temp"][:, cols] += tr["delta"] * w8[:, None]
            elif op == "geo":
                src = {k: wx["temp"][:, D.RIDX[v]].copy() for k, v in tr["map"].items()}
                srcw = {k: wx["wind"][:, D.RIDX[v]].copy() for k, v in tr["map"].items()}
                for k in tr["map"]:
                    wx["temp"][:, D.RIDX[k]] = src[k] + tr.get("offset", 0.0)
                    wx["wind"][:, D.RIDX[k]] = srcw[k]
            elif op == "flash":
                t0 = _t(tr["start"])
                hrs = (src_ts - t0).total_seconds().to_numpy() / 3600.0
                on, hold, off = tr.get("onset_h", 3), tr.get("hold_h", 24), tr.get("recover_h", 12)
                env = np.clip(hrs / on, 0, 1) * (hrs >= 0)
                env = np.where(hrs > on + hold, np.clip(1 - (hrs - on - hold) / off, 0, 1), env)
                cols = _cols(tr.get("regions"))
                wx["temp"][:, cols] += tr["delta"] * env[:, None]
                if tr.get("wind_mult"):
                    wx["wind"][:, cols] *= 1 + (tr["wind_mult"] - 1) * env[:, None]
            elif op == "precip":
                w8 = _window(src_ts, tr.get("core"), 0)
                cols = _cols(tr.get("regions"))
                cold = wx["temp"][:, cols] < tr.get("when_below", 0.0)
                # freezing drizzle in pulses: every other 3-hour block while cold
                pulse = ((np.arange(len(src_ts)) // 3) % 2 == 0)[:, None]
                wx["precip"][:, cols] += tr["mm"] * cold * pulse * (w8[:, None] > 0.5)
            elif op == "wind":
                w8 = _window(src_ts, tr.get("core"), 6)
                cols = _cols(tr.get("regions"))
                wx["wind"][:, cols] *= 1 + (tr["mult"] - 1) * w8[:, None]
            elif op == "demand":
                w8 = _window(src_ts, tr.get("core"), tr.get("taper_h", 12))
                dmult *= 1 + (tr["mult"] - 1) * w8
            else:
                raise ValueError(op)
        ts = pd.date_range(start_label, periods=len(src_ts), freq="h")
        # synthetic storms hit their fleet year's system, so they use that year's load level (trend term)
        demand_year = self.fleet_year if self.kind == "synthetic" else None
        return {"id": self.id, "public": self.public, "ts": ts, "wx": wx, "fleet_year": self.fleet_year,
                "demand_year": demand_year,
                "demand_peak_mw": self.demand_peak_mw, "demand_mult": dmult, "kind": self.kind,
                "source_window": [self.start, self.end], "transforms": self.transforms,
                "failure_modes": self.failure_modes, "description": self.description, "split": self.split}


def _cols(regions):
    return list(range(D.R)) if not regions else [D.RIDX[r] for r in regions]


def _window(src_ts: pd.DatetimeIndex, core, taper_h: float) -> np.ndarray:
    if not core:
        return np.ones(len(src_ts))
    a, b = _t(core[0]), _t(core[1])
    h = src_ts.to_numpy()
    w = np.zeros(len(src_ts))
    hrs_a = (src_ts - a).total_seconds().to_numpy() / 3600.0
    hrs_b = (src_ts - b).total_seconds().to_numpy() / 3600.0
    inside = (hrs_a >= 0) & (hrs_b <= 0)
    w[inside] = 1.0
    if taper_h > 0:
        pre = (hrs_a < 0) & (hrs_a > -taper_h)
        post = (hrs_b > 0) & (hrs_b < taper_h)
        w[pre] = 0.5 * (1 + np.cos(np.pi * hrs_a[pre] / taper_h))
        w[post] = 0.5 * (1 + np.cos(np.pi * hrs_b[post] / taper_h))
    del h
    return w


def _stretch(src_ts, wx, dmult, tr):
    """Repeat the core window's whole days so the cold lasts `factor` times longer (diurnal cycle kept)."""
    a, b = _t(tr["core"][0]), _t(tr["core"][1])
    i0 = int(np.searchsorted(src_ts, a))
    i1 = int(np.searchsorted(src_ts, b))
    span = max(24, ((i1 - i0) // 24) * 24)
    i1 = i0 + span
    extra = int(round((tr["factor"] - 1.0) * span / 24.0)) * 24
    reps = [np.arange(i0, i1)] * (extra // span) + ([np.arange(i0, i0 + extra % span)] if extra % span else [])
    idx = np.concatenate([np.arange(0, i1)] + reps + [np.arange(i1, len(src_ts))])
    new_ts = src_ts[idx]
    return new_ts, {k: v[idx].copy() for k, v in wx.items()}, dmult[idx].copy()


# =========================================================================== historical (pre-2021)
HIST = {
    "hist_2011_feb": Scenario("hist_2011_feb", "Feb 2011 freeze", "2011-01-30 00:00", "2011-02-07 23:00", 2011,
                              description="Feb 1-5, 2011 Southwest cold weather event (primary calibration)"),
    "hist_1989_dec": Scenario("hist_1989_dec", "Dec 1989 freeze", "1989-12-19 00:00", "1989-12-27 23:00", 1989,
                              demand_peak_mw=38300.0 + 1710.0,
                              description="Dec 21-23, 1989 freeze; demand scaled to 38,300 MW served + 1,710 MW shed"),
    "hist_2014_jan": Scenario("hist_2014_jan", "Jan 2014 polar vortex", "2014-01-04 00:00", "2014-01-09 23:00", 2014,
                              kind="gate", description="Jan 6, 2014: 9,355 MW lost, EEA2, no firm load shed"),
    "gate_2011_feb10": Scenario("gate_2011_feb10", "Feb 10, 2011 peak", "2011-02-08 00:00", "2011-02-12 23:00", 2011,
                                kind="gate", description="57.9 GW winter peak, no load shed"),
    "gate_2018_jan17": Scenario("gate_2018_jan17", "Jan 17, 2018 record", "2018-01-14 00:00", "2018-01-19 23:00", 2018,
                                kind="gate", description="65.9 GW winter record, no load shed"),
}
QUIET = {f"quiet_{y}_{y + 1}": Scenario(f"quiet_{y}_{y + 1}", f"Winter {y}/{str(y + 1)[2:]}", f"{y}-12-01 06:00",
                                         f"{y + 1}-02-28 23:00", y + 1, kind="quiet",
                                         description="quiet winter: no load shed expected")
         for y in (2012, 2015, 2017, 2018, 2019)}


def season(year: int) -> Scenario:
    """A full training season Nov 15 -> Mar 15 (~2,900 h). Pre-2021 only (year <= 2020)."""
    if year > 2020:
        raise D.HonestyError("seasons after 2019/20 are not available before the lock")
    return Scenario(f"season_{year - 1}_{year}", f"Winter {year - 1}/{str(year)[2:]}", f"{year - 1}-11-15 06:00",
                    f"{year}-03-15 05:00", year, kind="season")


# =========================================================================== synthetic storms
# Severity (the temperature deltas, stretch factors and surges below) was tuned on the SCRIPTED reference
# policies only (see sim/out/g3_final.json) so that naive / status quo fail and the good scripted operator
# passes: a gap that a smarter operating manual can close. Calibration params (params_v1.json) untouched.
W11 = ("2011-01-30 00:00", "2011-02-08 23:00")
CORE11 = ("2011-02-01 06:00", "2011-02-04 06:00")
W89 = ("1989-12-19 00:00", "1989-12-28 23:00")
CORE89 = ("1989-12-21 12:00", "1989-12-24 12:00")
W10 = ("2010-01-05 00:00", "2010-01-13 23:00")
W17 = ("2017-01-04 00:00", "2017-01-10 23:00")
W16 = ("2016-12-15 00:00", "2016-12-22 23:00")
W18 = ("2018-01-13 00:00", "2018-01-21 23:00")
CORE18 = ("2018-01-15 12:00", "2018-01-18 12:00")
W14 = ("2014-01-04 00:00", "2014-01-10 23:00")
W14M = ("2014-02-28 00:00", "2014-03-06 23:00")
W07 = ("2007-02-12 00:00", "2007-02-20 23:00")
WEST = ["midland", "lubbock", "sweetwater"]
CITIES = ["houston", "dallas", "san_antonio", "austin"]
WINDREG = ["sweetwater", "lubbock", "midland", "corpus_christi"]
SOUTH = ["houston", "corpus_christi", "san_antonio", "austin"]


def _syn(sid, public, window, fleet_year, transforms, modes, desc, split):
    return Scenario(sid, public, *window, fleet_year, transforms, seeds=[0, 1, 2], kind="synthetic",
                    failure_modes=modes, description=desc, split=split)


# --------------------------------------------------------------------------- TRAIN (evolution only)
# Source windows: Feb 2011, Dec 1989, Jan 2010, Jan 2017, Dec 2016 (all in PLAN.md section 8's train era).
TRAIN = {s.id: s for s in [
    _syn("train_permian_gas", "Training storm #1", W11, 2020,
         [{"op": "stretch", "factor": 2.0, "core": CORE11},
          {"op": "shift", "delta": -5.2, "regions": WEST + ["dallas"], "core": ("2011-02-01 00:00", "2011-02-05 06:00")}],
         ["gas_freeze_off", "long_freeze"],
         "Feb 2011 cold, 5 C colder over the Permian and Fort Worth gas basins and held twice as long: wells freeze",
         "train"),
    _syn("train_sensing_lines", "Training storm #2", W11, 2018,
         [{"op": "shift", "delta": -3.6, "core": CORE11},
          {"op": "wind", "mult": 1.5, "core": CORE11}],
         ["frozen_units"],
         "Feb 2011 statewide 3.6 C colder with 50% stronger wind: plant instruments and water lines freeze",
         "train"),
    _syn("train_compressor_spiral", "Training storm #3", W89, 2020,
         [{"op": "stretch", "factor": 2.0, "core": CORE89}],
         ["gas_compressor_feedback", "gas_freeze_off", "long_freeze"],
         "Dec 1989 freeze on the 2020 grid, twice as long: blackouts cut power to gas compressors, starving gas plants",
         "train"),
    _syn("train_long_freeze", "Training storm #4", W89, 2019,
         [{"op": "stretch", "factor": 3.0, "core": CORE89},
          {"op": "shift", "delta": 0.6, "core": ("1989-12-21 00:00", "1989-12-26 00:00")}],
         ["long_freeze", "frozen_units"],
         "Dec 1989 freeze (slightly milder) held three times as long on the 2019 grid: a week-long siege",
         "train"),
    _syn("train_flash_2010", "Training storm #5", W10, 2020,
         [{"op": "flash", "delta": -9.2, "start": "2010-01-07 06:00", "onset_h": 3, "hold_h": 30, "recover_h": 12,
           "wind_mult": 1.5}],
         ["flash_freeze", "frozen_units"],
         "Jan 2010 cold wave with a 9 C plunge in 3 hours and strong wind: plants freeze before anyone reacts",
         "train"),
    _syn("train_ice_2017", "Training storm #6", W17, 2020,
         [{"op": "shift", "delta": -4.5, "core": ("2017-01-06 06:00", "2017-01-08 18:00")},
          {"op": "precip", "mm": 0.8, "regions": WINDREG + ["dallas"], "core": ("2017-01-05 12:00", "2017-01-09 00:00")}],
         ["wind_icing", "frozen_units"],
         "Jan 2017 cold 4.5 C colder with freezing drizzle over West Texas wind farms and Dallas",
         "train"),
    _syn("train_surge_dec2016", "Training storm #7", W16, 2019,
         [{"op": "shift", "delta": -8.4, "regions": CITIES, "core": ("2016-12-17 12:00", "2016-12-19 18:00")},
          {"op": "demand", "mult": 1.08, "core": ("2016-12-17 12:00", "2016-12-19 18:00")}],
         ["demand_surge"],
         "Dec 2016 cold snap with the big cities 8 C colder and 8% extra heating demand (early winter)",
         "train"),
    _syn("train_coast_2011", "Training storm #8", W11, 2018,
         [{"op": "geo", "map": {"houston": "dallas", "corpus_christi": "austin", "san_antonio": "midland"}},
          {"op": "shift", "delta": -1.2, "core": CORE11}],
         ["frozen_units", "geography_shift"],
         "Feb 2011 cold moved south to the Gulf Coast, where plants are least protected",
         "train"),
    _syn("train_grand_2011", "Training storm #9", W11, 2020,
         [{"op": "stretch", "factor": 2.0, "core": CORE11},
          {"op": "shift", "delta": -1.2, "core": ("2011-02-01 00:00", "2011-02-05 06:00")},
          {"op": "precip", "mm": 0.6, "regions": WINDREG, "core": ("2011-02-01 00:00", "2011-02-06 00:00")}],
         ["gas_freeze_off", "frozen_units", "wind_icing", "long_freeze", "gas_compressor_feedback"],
         "Feb 2011 statewide, twice as long, with icing on the wind fleet: everything at once",
         "train"),
]}

# --------------------------------------------------------------------------- HELD-OUT practice exam
# Never used for evolution. Different source windows (Jan 2018, Jan 2014, Mar 2014, Feb 2007) or, for the
# one 1989-based storm, a different timing (February maintenance season) and failure mode.
HELDOUT = {s.id: s for s in [
    _syn("heldout_flash_2014", "Practice exam #1", W14, 2020,
         [{"op": "flash", "delta": -8.1, "start": "2014-01-06 03:00", "onset_h": 2, "hold_h": 26, "recover_h": 10,
           "wind_mult": 1.6}],
         ["flash_freeze", "frozen_units"],
         "Jan 2014 polar vortex with an 8 C plunge in 2 hours and strong wind: the fastest freeze in the set",
         "heldout"),
    _syn("heldout_ice_2018", "Practice exam #2", W18, 2020,
         [{"op": "shift", "delta": -4.0, "core": CORE18},
          {"op": "precip", "mm": 0.8, "regions": ["dallas", "houston", "austin", "sweetwater", "lubbock"], "core": CORE18}],
         ["wind_icing", "frozen_units"],
         "Jan 2018 record cold 4 C colder with an ice storm over Dallas, Houston, Austin and the northern wind farms",
         "heldout"),
    _syn("heldout_surge_2018", "Practice exam #3", W18, 2020,
         [{"op": "stretch", "factor": 1.7, "core": CORE18},
          {"op": "shift", "delta": -4.0, "regions": CITIES, "core": ("2018-01-15 00:00", "2018-01-19 06:00")},
          {"op": "demand", "mult": 1.08, "core": ("2018-01-15 00:00", "2018-01-19 06:00")}],
         ["demand_surge", "long_freeze"],
         "Jan 2018 record cold, longer, cities 4 C colder and 8% extra demand: the grid runs out of headroom",
         "heldout"),
    _syn("heldout_late_march_2014", "Practice exam #4", W14M, 2020,
         [{"op": "shift", "delta": -3.3, "core": ("2014-03-02 00:00", "2014-03-04 12:00")},
          {"op": "precip", "mm": 0.6, "regions": ["dallas", "austin", "sweetwater", "lubbock"],
           "core": ("2014-03-01 12:00", "2014-03-04 12:00")}],
         ["late_season_maintenance", "wind_icing", "frozen_units"],
         "Early March 2014 ice storm made colder: a quarter of the plants are already down for spring maintenance",
         "heldout"),
    _syn("heldout_late_feb_1989", "Practice exam #5", W89, 2020,
         [{"op": "relabel", "to": "2020-02-14 00:00"},
          {"op": "stretch", "factor": 1.5, "core": CORE89},
          {"op": "shift", "delta": 3.75, "core": ("1989-12-20 00:00", "1989-12-26 00:00")}],
         ["late_season_maintenance", "gas_compressor_feedback", "gas_freeze_off"],
         "The Dec 1989 freeze pattern (milder) arriving in mid-February, when many plants are out for maintenance",
         "heldout"),
    _syn("heldout_west_gas_2018", "Practice exam #6", W18, 2019,
         [{"op": "stretch", "factor": 2.5, "core": CORE18},
          {"op": "shift", "delta": -11.7, "regions": WEST + ["dallas"], "core": ("2018-01-15 00:00", "2018-01-20 00:00")}],
         ["gas_freeze_off", "long_freeze", "gas_compressor_feedback"],
         "Jan 2018 with a deep, long freeze over the West Texas and Fort Worth gas fields: gas supply collapses",
         "heldout"),
    _syn("heldout_feb_2007", "Practice exam #7", W07, 2020,
         [{"op": "shift", "delta": -9.0, "core": ("2007-02-14 12:00", "2007-02-17 12:00")},
          {"op": "wind", "mult": 1.4, "core": ("2007-02-14 12:00", "2007-02-17 12:00")}],
         ["frozen_units", "flash_freeze"],
         "Mid-February 2007 cold front made 9 C colder with stronger wind, arriving as maintenance season starts",
         "heldout"),
    _syn("heldout_south_flash_2018", "Practice exam #8", W18, 2020,
         [{"op": "flash", "delta": -8.1, "regions": SOUTH, "start": "2018-01-16 06:00", "onset_h": 3, "hold_h": 36,
           "recover_h": 12}],
         ["flash_freeze", "frozen_units", "geography_shift"],
         "A sudden freeze over Houston, San Antonio, Austin and Corpus Christi, where plants are built for heat",
         "heldout"),
]}

SYN = {**TRAIN, **HELDOUT}
TRAIN_IDS = list(TRAIN)
HELDOUT_IDS = list(HELDOUT)
# Real pre-2021 windows used as a no-regression / "don't over-shed" gate (no-shed days included)
GATE_IDS = ["gate_2011_feb10", "gate_2018_jan17", "hist_2014_jan"]
FAILURE_MODES = ["gas_freeze_off", "frozen_units", "wind_icing", "demand_surge", "gas_compressor_feedback",
                 "flash_freeze", "long_freeze"]

ALL = {**HIST, **QUIET, **SYN}
for _sid in GATE_IDS:
    ALL[_sid].split = "gate"
for _sid in ("hist_2011_feb", "hist_1989_dec"):
    ALL[_sid].split = "calibration"


def get(sid: str) -> Scenario:
    if sid in ALL:
        return ALL[sid]
    if sid.startswith("season_"):
        return season(int(sid.split("_")[-1]))
    raise KeyError(sid)
