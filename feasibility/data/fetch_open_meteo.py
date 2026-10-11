"""Fetch hourly ERA5 weather from the Open-Meteo historical archive API (no key).

Saves one raw JSON per location-year to data/raw/open_meteo/.
Usage: python -I fetch_open_meteo.py [start_year] [end_year]
"""
import json
import sys
import time
from pathlib import Path

import requests

RAW = Path(r"D:\dev\MongoDB\data\raw\open_meteo")
RAW.mkdir(parents=True, exist_ok=True)

LOCATIONS = {
    "Houston": (29.7604, -95.3698),
    "Dallas": (32.7767, -96.7970),
    "San Antonio": (29.4241, -98.4936),
    "Austin": (30.2672, -97.7431),
    "Midland": (31.9973, -102.0779),
    "Sweetwater": (32.4710, -100.4059),
    "Corpus Christi": (27.8006, -97.3964),
    "Lubbock": (33.5779, -101.8552),
}
URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY = "temperature_2m,wind_speed_10m,snowfall,precipitation"
MODEL = "era5"  # consistent 0.25 deg reanalysis across all years (best_match switches to 9 km IFS from 2017)


def fetch(name, lat, lon, year):
    out = RAW / f"{name.replace(' ', '_')}_{year}.json"
    if out.exists() and out.stat().st_size > 1000:
        return "cached"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": f"{year}-01-01",
        "end_date": f"{year}-12-31",
        "hourly": HOURLY,
        "timezone": "GMT",
        "wind_speed_unit": "ms",
        "models": MODEL,
    }
    for attempt in range(6):
        r = requests.get(URL, params=params, timeout=120)
        if r.status_code == 200:
            data = r.json()
            data["_request_url"] = r.url
            out.write_text(json.dumps(data))
            return f"ok {len(data['hourly']['time'])} h"
        if r.status_code == 429:
            wait = 30 * (attempt + 1)
            print(f"  429 rate limited, sleeping {wait}s: {r.text[:200]}", flush=True)
            time.sleep(wait)
            continue
        return f"HTTP {r.status_code}: {r.text[:300]}"
    return "gave up"


def main():
    y0 = int(sys.argv[1]) if len(sys.argv) > 1 else 2010
    y1 = int(sys.argv[2]) if len(sys.argv) > 2 else 2023
    for name, (lat, lon) in LOCATIONS.items():
        for year in range(y0, y1 + 1):
            status = fetch(name, lat, lon, year)
            print(f"{name} {year}: {status}", flush=True)
            if status != "cached":
                time.sleep(1.5)


if __name__ == "__main__":
    main()
