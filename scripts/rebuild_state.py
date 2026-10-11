"""Rebuild a learning loop's checkpoint (data/loop_state_<tag>.json) from the store, after a crash that happened
between checkpoints. Uses the last champion notebook, its pages, the edit history and coach metrics already
recorded, so the loop resumes at the next day without redoing (or duplicating) the last night.

  .venv/Scripts/python scripts/rebuild_state.py evoB --track B [--fixed-build map]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from harness.evolve import BUILD_PRESETS, DEFAULT_CONFIG  # noqa: E402
from harness.store import get_store  # noqa: E402

HIST_KEYS = ("generation", "title", "organ", "status", "reason", "reason_kind", "predicted", "predicted_pct", "actual",
             "actual_pct", "ops_hash", "strategy_version", "redteam")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tag")
    ap.add_argument("--track", required=True)
    ap.add_argument("--fixed-build", default="none")
    a = ap.parse_args()
    st = get_store()
    by_ts = lambda rows: sorted(rows, key=lambda d: d.get("_ts", 0))  # noqa: E731
    versions = by_ts(st.find("harness_versions", tag=a.tag))
    champ = versions[-1]
    muts = by_ts(st.find("mutations", tag=a.tag))
    pages = by_ts(st.find("manual_pages", tag=a.tag))
    metrics = by_ts(st.find("coach_metrics", tag=a.tag))
    strategies = by_ts(st.find("evolver_strategies", tag=a.tag))
    last_night = max([m["generation"] for m in muts] + [champ.get("night") or 0])
    ids = [champ["id"]] + [m.get("child_id") or "" for m in muts] + [m.get("stacked_id") or "" for m in muts]
    n_versions = max(int(x) for x in re.findall(rf"{a.tag}-h(\d+)", " ".join(ids)))
    adopted = [s for s in strategies if s.get("adopted")]
    state = {
        "h": {k: champ[k] for k in ("id", "parent_id", "generation", "sensors", "rules", "guardrails", "alerts", "context",
                                    "authority", "build", "memory_policy")},
        "pages": [{k: v for k, v in p.items() if k != "_ts"} for p in pages],
        "history": [{k: m.get(k) for k in HIST_KEYS} for m in muts],
        "strategy": adopted[-1]["proposed_strategy"] if adopted else "",
        "config": dict(adopted[-1]["proposed_config"]) if adopted else dict(DEFAULT_CONFIG),
        "strategy_version": adopted[-1].get("strategy_version", len(adopted)) if adopted else 0,
        "metrics": [{k: v for k, v in m.items() if k != "_ts"} for m in metrics],
        "n_versions": n_versions, "gen": last_night + 1, "last_night": None, "scored_hash": None,
        "track": a.track, "fixed_build": BUILD_PRESETS.get(a.fixed_build, {}), "tag": a.tag,
    }
    out = ROOT / "data" / f"loop_state_{a.tag}.json"
    if out.exists():
        out.replace(out.with_suffix(".bak.json"))
    out.write_text(json.dumps(state, default=str))
    print(f"rebuilt {out.name}: resume at day {state['gen']} with {champ['id']} ({len(pages)} pages, "
          f"{len(muts)} edits, strategy v{state['strategy_version']}, next version h{n_versions + 1:03d})")


if __name__ == "__main__":
    main()
