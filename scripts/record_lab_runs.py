"""Record Live-lab comparisons for the hosted site (no live server there): Day 1 vs the final frozen notebook, per
track, on each unseen storm, seed 0. Uses the running live server's /api/compare (fresh=false: identical AI answers
reused) and saves exactly what it streamed to viewer/public/lab/runs/<storm>__<left>__<right>__<seed>.json.

  .venv/Scripts/python scripts/record_lab_runs.py          (live server on :8594)
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
API = "http://127.0.0.1:8594"
OUT = ROOT / "viewer" / "public" / "lab"
PAIRS = {"B": ("evoB-h001", "evoB-h017"), "A": ("evoA-h001", "evoA-h020")}
HTTP = requests.Session()


def one(storm: str, left: str, right: str, seed: int = 0) -> dict:
    r = HTTP.post(f"{API}/api/compare", json={"storm_id": storm, "left": left, "right": right, "seed": seed, "fresh": False},
                  timeout=60)
    r.raise_for_status()
    start = r.json()
    hours, done = [], None
    with HTTP.get(f"{API}/api/stream/{start['run_id']}", stream=True, timeout=1800) as s:
        for line in s.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            m = json.loads(line[6:])
            if m.get("type") == "hour":
                hours.append(m)
            elif m.get("type") in ("done", "error"):
                done = m
                break
    if not done or done.get("type") != "done":
        raise RuntimeError(f"{storm} {left} {right}: {done}")
    name = f"{storm}__{left}__{right}__{seed}.json"
    (OUT / "runs" / name).write_text(json.dumps({"start": start, "hours": hours, "done": done}, separators=(",", ":")))
    return {"storm_id": storm, "left": left, "right": right, "seed": seed, "file": f"runs/{name}",
            "left_passed": done["results"]["left"]["passed"], "right_passed": done["results"]["right"]["passed"]}


def main():
    cat = json.loads((OUT / "catalog.json").read_text(encoding="utf-8"))
    storms = [s["storm_id"] for s in cat["hidden_pool"] if str(s.get("storm_id", "")).startswith("heldout_")]
    (OUT / "runs").mkdir(parents=True, exist_ok=True)
    jobs = [(s, *PAIRS[t]) for t in ("B", "A") for s in storms]
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(lambda j: one(*j), jobs))
    (OUT / "runs" / "index.json").write_text(json.dumps({"seed": 0, "runs": rows}, indent=1))
    for r in rows:
        print(r["storm_id"], r["left"], "vs", r["right"], "passed:", r["left_passed"], r["right_passed"])
    print(f"{len(rows)} recorded runs -> {OUT / 'runs'}")


if __name__ == "__main__":
    sys.exit(main())
