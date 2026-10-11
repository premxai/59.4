"""ERCOT hourly Native Load archives -> tidy parquet.

Inputs : data/raw/ercot_native_load/*.xls and extracted/*.xlsx (one file per year)
Outputs: data/processed/ercot_load_hourly.parquet        (ts_utc, ts_local, load_mw, source)
         data/processed/ercot_load_zonal_hourly.parquet  (ts_utc, ts_local, zone, load_mw)

Timestamp convention: ts_utc / ts_local are HOUR-ENDING (as published by ERCOT).
Each yearly file is a strictly sequential hourly series in Central Prevailing Time
(23-hour spring day, 25-hour fall day), starting with HE 01:00 on Jan 1 (CST) and
ending with HE 24:00 on Dec 31 (CST). Row i therefore ends at Jan-1 07:00 UTC + i hours.
We verify this against the printed labels.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(r"D:\dev\MongoDB\data\raw\ercot_native_load")
OUT = Path(r"D:\dev\MongoDB\data\processed")
OUT.mkdir(parents=True, exist_ok=True)

ZONE_MAP = {  # normalise old/new zone names
    "COAST": "COAST", "EAST": "EAST", "FAR_WEST": "FWEST", "FWEST": "FWEST",
    "NORTH": "NORTH", "NORTH_C": "NCENT", "NCENT": "NCENT", "SOUTHERN": "SOUTH",
    "SOUTH": "SOUTH", "SOUTH_C": "SCENT", "SCENT": "SCENT", "WEST": "WEST", "ERCOT": "ERCOT",
}


def find_files():
    files = {}
    for p in list(RAW.glob("*.xls")) + list((RAW / "extracted").glob("*.xlsx")):
        m = re.search(r"(20\d\d)", p.name)
        files[int(m.group(1))] = p
    return dict(sorted(files.items()))


def label_to_local(lbl):
    """Parse ERCOT hour-ending label to naive local datetime (24:00 -> next day 00:00)."""
    if isinstance(lbl, pd.Timestamp) or hasattr(lbl, "year"):
        return pd.Timestamp(lbl).round("h"), False
    s = str(lbl).strip()
    dst = s.endswith("DST")
    s = s.replace("DST", "").strip()
    d, t = s.split(" ")
    hh, mm = t.split(":")
    base = pd.to_datetime(d, format="%m/%d/%Y")
    return base + pd.Timedelta(hours=int(hh), minutes=int(mm)), dst


def main():
    frames, report = [], []
    for year, path in find_files().items():
        df = pd.read_excel(path)
        tcol = df.columns[0]
        df = df.rename(columns={c: ZONE_MAP.get(str(c).strip().upper(), c) for c in df.columns[1:]})
        n = len(df)
        expected = 8784 if pd.Timestamp(year=year, month=12, day=31).dayofyear == 366 else 8760
        start = pd.Timestamp(f"{year}-01-01 07:00", tz="UTC")  # HE01 CST = 07:00 UTC
        ts_utc = pd.date_range(start, periods=n, freq="h")
        ts_local = ts_utc.tz_convert("US/Central")
        # verify sequential assumption against labels (ignoring DST-transition rows)
        parsed = [label_to_local(v)[0] for v in df[tcol]]
        loc_naive = ts_local.tz_localize(None)
        mism = int(np.sum(np.array(parsed, dtype="datetime64[ns]") != loc_naive.values.astype("datetime64[ns]")))
        report.append((year, path.name, n, expected, mism))
        df["ts_utc"] = ts_utc
        df["ts_local"] = ts_local
        frames.append(df.drop(columns=[tcol]))
    allz = pd.concat(frames, ignore_index=True)
    for r in report:
        print("year %d file %s rows %d expected %d label-mismatches %d" % r)

    zones = [c for c in allz.columns if c in set(ZONE_MAP.values()) and c != "ERCOT"]
    total = allz[["ts_utc", "ts_local", "ERCOT"]].rename(columns={"ERCOT": "load_mw"})
    total["source"] = "ercot_native_load"
    total = total.sort_values("ts_utc").reset_index(drop=True)
    assert total["ts_utc"].is_unique
    total.to_parquet(OUT / "ercot_load_hourly.parquet", index=False)

    zonal = allz.melt(id_vars=["ts_utc", "ts_local"], value_vars=zones, var_name="zone", value_name="load_mw")
    zonal.sort_values(["ts_utc", "zone"]).to_parquet(OUT / "ercot_load_zonal_hourly.parquet", index=False)
    # zone sum vs ERCOT column check
    zs = allz[zones].sum(axis=1)
    print("max |sum(zones)-ERCOT| MW:", float((zs - allz["ERCOT"]).abs().max()))
    print("rows", len(total), "first", total.ts_utc.min(), "last", total.ts_utc.max(),
          "NaN load", int(total.load_mw.isna().sum()))


if __name__ == "__main__":
    main()
