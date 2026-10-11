"""EIA-930 ERCO per-BA workbook -> data/processed/eia930_erco_hourly.parquet (wide, cross-check source).

Input : data/raw/eia930/ERCO.xlsx, sheet 'Published Hourly Data'
'UTC time' in this workbook is the hour-ENDING UTC timestamp (row 1: UTC 2015-07-01 06:00 =
local hour 1 = HE 01:00 CDT), consistent with the other processed tables.
Units: MW (MWh per hour). Fuel columns 'NG: XXX' are net generation by energy source.
"""
from pathlib import Path

import pandas as pd

RAW = Path(r"D:\dev\MongoDB\data\raw\eia930\ERCO.xlsx")
OUT = Path(r"D:\dev\MongoDB\data\processed")


def main():
    df = pd.read_excel(RAW, sheet_name="Published Hourly Data", engine="openpyxl")
    print("columns:", list(df.columns))
    df = df.rename(columns={"UTC time": "ts_utc"})
    df["ts_utc"] = pd.to_datetime(df["ts_utc"]).dt.tz_localize("UTC")
    df["ts_local"] = df["ts_utc"].dt.tz_convert("US/Central")
    keep = ["ts_utc", "ts_local", "Demand forecast", "Demand", "Net generation", "Total interchange",
            "Adjusted demand", "Adjusted net generation"]
    keep += [c for c in df.columns if str(c).startswith("NG: ") or str(c).startswith("Adjusted ") and c not in keep]
    keep += [c for c in df.columns if str(c).startswith("Subregion") or str(c).startswith("Demand by subregion")]
    keep = list(dict.fromkeys([c for c in keep if c in df.columns]))
    out = df[keep].copy()
    out.columns = [str(c).strip().lower().replace(": ", "_").replace(" ", "_") for c in out.columns]
    for c in out.columns[2:]:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    out = out.sort_values("ts_utc")
    out.to_parquet(OUT / "eia930_erco_hourly.parquet", index=False)
    print("rows", len(out), out.ts_utc.min(), "->", out.ts_utc.max(), "dup ts", int(out.ts_utc.duplicated().sum()))
    print(out.notna().groupby(out.ts_utc.dt.year).mean().round(2).iloc[:, 2:].to_string())


if __name__ == "__main__":
    main()
