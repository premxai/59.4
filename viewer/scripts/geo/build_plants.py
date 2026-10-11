"""Export a compact plant list for the viewer.

    D:\\dev\\MongoDB\\.venv\\Scripts\\python.exe -I viewer/scripts/geo/build_plants.py

Source: data/processed/ercot_plants.csv (EIA-860 2025 + 2020, BA = ERCO; every plant that
operated at some point since 2007) joined with data/processed/ercot_generators.csv for the
first-online month and last-retired month. NOT ercot_plants.json (2025-only fleet).

The viewer filters at runtime by the replay's meta.fleet_year / start_utc:
    online  if (op_year, op_month) <= (fleet_year, start_month)
    retired if ret_year is set and (ret_year, ret_month) <= (fleet_year, start_month)
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROC = ROOT / "data" / "processed"
OUT = ROOT / "viewer" / "public" / "geo" / "plants.json"


def f(v: str) -> float | None:
    v = (v or "").strip()
    return float(v) if v else None


def main() -> None:
    gens: dict[str, dict] = {}
    with open(PROC / "ercot_generators.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            pid = row["plant_id"]
            g = gens.setdefault(pid, {"op": None, "ret": None, "all_ret": True})
            oy, om = f(row["operating_year"]), f(row["operating_month"])
            if oy:
                ym = int(oy) * 12 + int(om or 1) - 1
                g["op"] = ym if g["op"] is None else min(g["op"], ym)
            ry, rm = f(row["retirement_year"]), f(row["retirement_month"])
            if ry:
                ym = int(ry) * 12 + int(rm or 12) - 1
                g["ret"] = ym if g["ret"] is None else max(g["ret"], ym)
            else:
                g["all_ret"] = False

    rows = []
    with open(PROC / "ercot_plants.csv", newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            pid = row["plant_id"]
            g = gens.get(pid, {})
            op_year = f(row["operating_year"])
            ret_year = f(row["retirement_year"])
            op_ym = g.get("op")
            if op_ym is None and op_year:
                op_ym = int(op_year) * 12
            ret_ym = g.get("ret") if (ret_year and g.get("all_ret")) else None
            if ret_year and ret_ym is None:
                ret_ym = int(ret_year) * 12 + 11
            mw = f(row["winter_mw"]) or f(row["nameplate_mw"]) or 0.0
            rows.append([
                int(pid),
                row["name"],
                round(float(row["lat"]), 4),
                round(float(row["lon"]), 4),
                row["fuel"],
                row["fuel_detail"],
                round(mw, 1),
                op_ym,
                ret_ym,
            ])
    rows.sort(key=lambda r: -r[6])
    doc = {
        "source": "EIA-860 (2025 + 2020 releases), ERCOT balancing authority; data/processed/ercot_plants.csv",
        "fields": ["id", "name", "lat", "lon", "fuel", "fuel_detail", "winter_mw", "op_ym", "ret_ym"],
        "note": "op_ym/ret_ym = year*12 + (month-1); ret_ym null = not fully retired",
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    by = {}
    for r in rows:
        by[r[4]] = by.get(r[4], 0) + 1
    print(len(rows), "plants", by, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
