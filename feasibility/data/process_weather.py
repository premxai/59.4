"""Open-Meteo ERA5 JSON (one per location-year) -> data/processed/weather_hourly.parquet

Columns: ts_utc, location, lat, lon, grid_lat, grid_lon, temp_c, wind_ms, snowfall_cm, precip_mm
  lat/lon         = requested city coordinates
  grid_lat/lon    = ERA5 grid cell actually returned by Open-Meteo
  temp_c, wind_ms = instantaneous values at ts_utc (2 m air temp, 10 m wind)
  snowfall_cm, precip_mm = totals over the hour ENDING at ts_utc (so ts_utc is hour-ending,
  matching the hour-ending load/generation tables)
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from fetch_open_meteo import LOCATIONS  # noqa: E402

RAW = Path(r"D:\dev\MongoDB\data\raw\open_meteo")
OUT = Path(r"D:\dev\MongoDB\data\processed")


def main():
    frames = []
    names = {n.replace(" ", "_"): n for n in LOCATIONS}
    for p in sorted(RAW.glob("*.json")):
        m = re.fullmatch(r"(.+)_(\d{4})\.json", p.name)
        loc = names[m.group(1)]
        d = json.loads(p.read_text())
        h = d["hourly"]
        frames.append(pd.DataFrame({
            "ts_utc": pd.to_datetime(h["time"], utc=True),
            "location": loc,
            "lat": LOCATIONS[loc][0], "lon": LOCATIONS[loc][1],
            "grid_lat": d["latitude"], "grid_lon": d["longitude"],
            "temp_c": h["temperature_2m"], "wind_ms": h["wind_speed_10m"],
            "snowfall_cm": h["snowfall"], "precip_mm": h["precipitation"],
        }))
    w = pd.concat(frames, ignore_index=True).sort_values(["location", "ts_utc"])
    assert not w.duplicated(["location", "ts_utc"]).any()
    w.to_parquet(OUT / "weather_hourly.parquet", index=False)
    for loc, g in w.groupby("location"):
        full = pd.date_range(g.ts_utc.min(), g.ts_utc.max(), freq="h")
        print(f"{loc:15s} {g.ts_utc.min()} -> {g.ts_utc.max()} rows {len(g)} expected {len(full)} "
              f"NaN temp {g.temp_c.isna().sum()} grid ({g.grid_lat.iloc[0]}, {g.grid_lon.iloc[0]})")


if __name__ == "__main__":
    main()
