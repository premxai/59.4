"""Texas right now: ERCOT's public real-time system conditions page (read-only, display only).

The agent never controls anything real. This feeds the opening screen ("60.008 Hz right now; below 59.4 Hz for
9 minutes and generators trip"). The page refreshes every 60 s; the last good reading is cached so the screen
still works offline (marked stale).

  python -m harness.ercot_live
"""
from __future__ import annotations

import html
import json
import re
import time
import urllib.request
from pathlib import Path

URL = "https://www.ercot.com/content/cdr/html/real_time_system_conditions.html"
CACHE = Path(__file__).resolve().parents[1] / "data" / "ercot_last.json"
FIELDS = {
    "frequency_hz": "Current Frequency",
    "demand_mw": "Actual System Demand",
    "capacity_mw": "Total System Capacity (not including Ancillary Services)",
    "wind_mw": "Total Wind Output",
    "solar_mw": "Total PVGR Output",
    "inertia_mw_s": "Current System Inertia",
    "net_load_mw": "Average Net Load",
}


def parse(page: str) -> dict:
    txt = html.unescape(re.sub(r"<[^>]+>", "|", page))
    cells = [c.strip() for c in txt.split("|") if c.strip()]
    out = {}
    for key, label in FIELDS.items():
        if label in cells:
            i = cells.index(label)
            try:
                out[key] = float(cells[i + 1].replace(",", ""))
            except (IndexError, ValueError):
                pass
    m = re.search(r"Last Updated:\s*([A-Za-z]{3} \d{1,2}, \d{4} [\d:]+)", txt)
    out["updated"] = m.group(1) if m else None
    return out


def fetch(timeout: float = 10.0) -> dict:
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (59.4 hackathon demo; read-only)"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = parse(r.read().decode("utf-8", errors="ignore"))
        if "frequency_hz" not in d:
            raise ValueError("page layout changed")
        d.update(fetched_at=time.time(), stale=False, source=URL)
        CACHE.write_text(json.dumps(d))
        return d
    except Exception as e:  # offline or blocked: last good reading, marked stale
        if CACHE.exists():
            d = json.loads(CACHE.read_text())
            d.update(stale=True, error=f"{type(e).__name__}")
            return d
        return {"stale": True, "error": f"{type(e).__name__}: {e}"}


if __name__ == "__main__":
    print(json.dumps(fetch(), indent=1))
