"""Make the flagged decisions stand out in Raindrop Workshop's run list (Workshop keeps our flags as 'issue'
annotations but does not show them in the list): renames each flagged decision to "⚠ FLAG ... · <storm> h<hour>".
Re-run after Workshop restarts if the names are gone.

  .venv/Scripts/python scripts/raindrop_mark_flags.py        (Workshop running: `raindrop workshop start`)
"""
from __future__ import annotations

import json

import requests

W = "http://127.0.0.1:5899"


def main():
    s = requests.Session()
    runs = [r for r in s.get(f"{W}/api/runs", params={"limit": 5000}, timeout=30).json()
            if str(r.get("convo_id", "")).startswith("rdnight:") and not str(r.get("convo_id")).startswith("rdnight:trial")]
    n = 0
    for r in runs:
        notes = [a for a in s.get(f"{W}/api/annotations", params={"run_id": r["id"]}, timeout=10).json()
                 if a.get("kind") == "issue"]
        if not notes:
            continue
        meta = json.loads(r["metadata"]) if r.get("metadata") else {}
        note = notes[0]["note"].split("] ", 1)[-1]
        kind = "FLAG homes dark w/ spare power" if note.startswith("homes_dark") else "FLAG false all-clear"
        storm = r["convo_id"].split(":")[1].replace("train_", "")
        n += s.patch(f"{W}/api/runs/{r['id']}", json={"name": f"⚠ {kind} · {storm} h{meta.get('hour')}"}, timeout=5).ok
    print(f"{len(runs)} traced decisions, {n} flagged ones marked")


if __name__ == "__main__":
    main()
