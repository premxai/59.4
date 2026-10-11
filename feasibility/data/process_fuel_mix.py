"""ERCOT historical Fuel Mix reports (15-minute MWh by fuel, 2007-2024) -> hourly MW parquet.

Input : data/raw/ercot_fuel_mix/extracted/IntGenByFuel<YYYY>.xls(x)  (one sheet per month)
Output: data/processed/ercot_gen_by_fuel_hourly.parquet  (ts_utc, ts_local, fuel, mw, n_intervals, source)

Units: cells are MWh per 15-minute interval (ERCOT "Daily MWH"/"Total" column = row sum).
Hourly MW = sum of the 4 quarter-hour MWh values that end inside the hour (hour-ending).
Header-driven column parsing handles every layout variant seen 2007-2024:
  * combined "Date-Fuel" strings ("02/01/07 - Coal", "02/01/08-Coal", "02/01/13_Biomass")
    or separate Date / Fuel (/ Settlement Type) columns;
  * midnight column as time(0,0) or datetime(1900,1,1) == interval ending 24:00;
  * fall-back repeated hour as trailing 'DST1..4' / '01:15 (DST)' columns or as inline
    repeated time labels (2009) -> treated as the 2nd (CST) occurrence of 01:00-02:00;
  * spring-forward nonexistent quarter-hours (02:00-03:00 local) are dropped (pre-2016
    files sometimes contain values there; they are counted and reported).
"""
import datetime as dt
import re
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(r"D:\dev\MongoDB\data\raw\ercot_fuel_mix\extracted")
OUT = Path(r"D:\dev\MongoDB\data\processed")
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
FUEL_MAP = {
    "coal": "coal", "gas": "gas", "gas_cc": "gas_cc", "gas-cc": "gas_cc", "gas_gt": "gas",
    "gas_st": "gas", "nuclear": "nuclear", "wind": "wind", "wnd": "wind", "hydro": "hydro",
    "solar": "solar", "sun": "solar", "biomass": "biomass", "other": "other", "oth": "other",
    "wsl": "storage_charging_wsl",
    "pwrstr": "storage", "power storage": "storage",
}


def header_minutes(h):
    """Return (minutes_after_midnight_of_interval_end, is_dst_label) or None if not an interval."""
    if isinstance(h, dt.datetime):  # 1900-01-01 00:00 == 24:00
        return (24 * 60 if (h.hour, h.minute) == (0, 0) else h.hour * 60 + h.minute), False
    if isinstance(h, dt.time):
        m = h.hour * 60 + h.minute
        return (24 * 60 if m == 0 else m), False
    if isinstance(h, (float, np.floating)) and not np.isnan(h) and 0 <= h <= 1:  # Excel day fraction
        m = int(round(h * 1440))
        return (24 * 60 if m in (0, 1440) else m), False
    if isinstance(h, str):
        s = h.strip()
        m = re.fullmatch(r"(?i)dst([1-4])", s)
        if m:
            return 60 + 15 * int(m.group(1)), True
        m = re.fullmatch(r"(\d{1,2}):(\d\d)(?::\d\d)?\s*(\(DST\))?", s)
        if m:
            mins = int(m.group(1)) * 60 + int(m.group(2))
            return (24 * 60 if mins == 0 else mins), bool(m.group(3))
    return None


def parse_sheet(df, name=""):
    hdr = list(df.iloc[0])
    body = df.iloc[1:].reset_index(drop=True)
    cols = [str(h).strip().lower() if isinstance(h, str) else h for h in hdr]
    # identify date & fuel
    if "fuel" in cols:
        date = pd.to_datetime(body.iloc[:, cols.index("date")], errors="coerce")
        fuel = body.iloc[:, cols.index("fuel")].astype(str).str.strip()
    else:
        s = body.iloc[:, 0].astype(str)
        m = s.str.extract(r"^\s*(\d{1,2}/\d{1,2}/\d{2,4})\s*[-_]\s*(.+?)\s*$")
        date = pd.to_datetime(m[0], format="%m/%d/%y", errors="coerce")
        fuel = m[1]
    # Regular intervals are assigned POSITIONALLY (the 96 columns after Total), because a few
    # sheets have header typos (Aug09 repeats two labels; Oct2007/Sep16 have an unparseable label).
    tot_idx = next(j for j, h in enumerate(hdr) if isinstance(h, str) and h.strip().lower() in ("total", "daily mwh"))
    after = list(range(tot_idx + 1, len(hdr)))
    dst_cols = [j for j in after if (header_minutes(hdr[j]) or (0, False))[1]]
    regular = [j for j in after if j not in dst_cols]
    if len(regular) == 100 and not dst_cols:  # 2009-style inline repeat of 01:15..02:00
        seen, inline = set(), []
        for j in regular:
            m = (header_minutes(hdr[j]) or (None,))[0]
            if m is not None and m in seen and 75 <= m <= 120:
                inline.append(j)
            seen.add(m)
        dst_cols, regular = inline, [j for j in regular if j not in inline]
    if len(regular) != 96:
        print(f"  WARNING {name}: {len(regular)} regular interval columns; using first 96", flush=True)
    interval_cols = [(j, 15 * (k + 1), False) for k, j in enumerate(regular[:96])]
    interval_cols += [(j, 60 + 15 * (k + 1), True) for k, j in enumerate(dst_cols)]
    recs = []
    vals = body.apply(pd.to_numeric, errors="coerce")
    for j, mins, second in interval_cols:
        recs.append(pd.DataFrame({"date": date, "fuel": fuel, "end_min": mins, "second": second, "mwh": vals.iloc[:, j]}))
    out = pd.concat(recs, ignore_index=True)
    return out.dropna(subset=["date", "fuel"])


def to_utc(long):
    """long: date, fuel, end_min, second, mwh -> add ts_utc of interval END."""
    begin_local = long["date"] + pd.to_timedelta(long["end_min"] - 15, unit="m")
    # ambiguous (fall-back 01:00-02:00): first occurrence is DST (True), second is CST (False)
    amb = ~long["second"].to_numpy()
    loc = pd.DatetimeIndex(begin_local).tz_localize("US/Central", ambiguous=amb, nonexistent="NaT")
    return loc.tz_convert("UTC") + pd.Timedelta(minutes=15)


def main():
    frames, notes = [], []
    for path in sorted(RAW.glob("IntGen*")):
        year = int(re.search(r"(20\d\d)", path.name).group(1))
        x = pd.ExcelFile(path)
        for sh in x.sheet_names:
            key = sh.strip().lower()[:3]
            if key not in MONTHS or not re.fullmatch(r"[A-Za-z]{3}(\d{2}|\d{4})?", sh.strip()):
                continue
            long = parse_sheet(x.parse(sh, header=None), f"{path.name}:{sh}")
            long = long[long["date"].dt.year == year]
            frames.append(long.assign(file=path.name))
        print(path.name, "parsed", flush=True)
    long = pd.concat(frames, ignore_index=True)
    long["fuel_raw"] = long["fuel"]
    long["fuel"] = long["fuel"].str.strip().str.lower().map(FUEL_MAP)
    unknown = long.loc[long.fuel.isna(), "fuel_raw"].value_counts()
    if len(unknown):
        print("UNMAPPED fuels:", unknown.to_dict())
    long = long.dropna(subset=["fuel", "mwh"])
    # DST columns hold zeros on ordinary days; keep them only on fall-back days (1st Sunday of Nov)
    d = long["date"]
    fallback = (d.dt.month == 11) & (d.dt.dayofweek == 6) & (d.dt.day <= 7)
    long = long[~long["second"] | fallback]
    long["ts_end_utc"] = to_utc(long)
    nonexist = long["ts_end_utc"].isna()
    print("dropped spring-forward nonexistent quarter-hours with values:", int(nonexist.sum()))
    long = long[~nonexist]
    dup = long.duplicated(["ts_end_utc", "fuel_raw"], keep=False)
    if dup.any():
        print("duplicate (ts,fuel_raw) quarter-hours:", int(dup.sum()), long[dup].head(8).to_string())
        long = long.drop_duplicates(["ts_end_utc", "fuel_raw"], keep="first")
    # several raw labels can map to one fuel (e.g. 'Gas-CC' and 'Gas_CC' in 2012): sum them
    long = long.groupby(["ts_end_utc", "fuel"], as_index=False)["mwh"].sum()
    long["ts_utc"] = long["ts_end_utc"].dt.ceil("h")
    hourly = long.groupby(["ts_utc", "fuel"], as_index=False).agg(mw=("mwh", "sum"), n_intervals=("mwh", "size"))
    hourly["ts_local"] = hourly["ts_utc"].dt.tz_convert("US/Central")
    hourly["source"] = "ercot_fuel_mix_report"
    hourly = hourly[["ts_utc", "ts_local", "fuel", "mw", "n_intervals", "source"]].sort_values(["ts_utc", "fuel"])
    hourly.to_parquet(OUT / "ercot_gen_by_fuel_hourly.parquet", index=False)
    print("rows", len(hourly), "first", hourly.ts_utc.min(), "last", hourly.ts_utc.max())
    print("incomplete hours (n_intervals<4):", int((hourly.n_intervals < 4).sum()))
    print(hourly.groupby(hourly.ts_utc.dt.year)["fuel"].unique().apply(sorted).to_string())


if __name__ == "__main__":
    main()
