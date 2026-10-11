"""Raindrop night: one learning night where Raindrop Workshop is load-bearing (tag rdA, on top of Track A's frozen
notebook; the frozen loops and the exam are untouched).

  1. DAY      the frozen operator runs the 9 practice storms x 2 seeds with Track A's final notebook. Every AI decision
              is a Raindrop Workshop trace (prompt in, decision out), and two detectors flag decisions on it as issues:
              "said all clear while power was running out" and "kept homes dark with spare power".
  2. READ     the coach's evidence is read back OUT of Raindrop Workshop (its local API): which decisions were flagged,
              with the AI's own briefing and answer.
  3. NIGHT    the coach proposes edits from that evidence (plus the usual failure reports); the normal test keeps or
              rejects them, exactly like every other night.

  .venv/Scripts/python scripts/raindrop_night.py            (needs `raindrop workshop start`)
Writes data/raindrop_night.json; records go to the local store under tag rdA (migrate to Atlas afterwards).
"""
from __future__ import annotations

import collections
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ["FOUR37_RAINDROP_LOCAL"] = "1"          # Workshop on this laptop: every decision traced, no cloud quota
os.environ.setdefault("FOUR37_LOCAL_STORE", "1")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import requests  # noqa: E402

from harness import coach, raindrop_bridge  # noqa: E402
from harness import run as hrun  # noqa: E402
from harness.evolve import Loop, by_storm, majority_passed  # noqa: E402
from harness.memory import Manual  # noqa: E402
from harness.schema import Harness  # noqa: E402
from sim.scenarios import TRAIN_IDS  # noqa: E402

WS = raindrop_bridge.WORKSHOP.replace("/v1/", "").replace("localhost", "127.0.0.1")   # Windows: localhost costs ~2 s per connect
HTTP = requests.Session()
TAG, SEEDS = "rdA", (0, 1)
_ctx = threading.local()
_Base = hrun.HarnessPolicy


class TracedPolicy(_Base):
    """Groups each storm's decisions into one Raindrop conversation (rdnight:<storm>:<seed>)."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.rd_label = self.h.id
        self.rd_convo = getattr(_ctx, "convo", None) or f"rdnight:trial:{self.h.id}"


hrun.HarnessPolicy = TracedPolicy


def day_run(h, pages, scn, seed):
    _ctx.convo = f"rdnight:{scn}:{seed}"
    r = hrun.run_storm(h, scn, seed, Manual(pages))
    r.pop("_result", None)
    r["inconclusive"] = False
    return r


def read_workshop(t0_ms: int) -> dict:
    """Everything the coach learns from Raindrop comes from here: Workshop's own API."""
    runs = [r for r in HTTP.get(f"{WS}/api/runs", params={"limit": 5000}, timeout=30).json()
            if str(r.get("convo_id", "")).startswith("rdnight:") and not str(r.get("convo_id")).startswith("rdnight:trial")
            and (r.get("started_at") or 0) >= t0_ms]
    flagged = []
    for r in runs:
        notes = [a for a in HTTP.get(f"{WS}/api/annotations", params={"run_id": r["id"]}, timeout=10).json()
                 if a.get("kind") == "issue"]
        if notes:
            meta = json.loads(r["metadata"]) if isinstance(r.get("metadata"), str) and r["metadata"] else {}
            flagged.append({"run_id": r["id"], "convo": r["convo_id"], "hour": meta.get("hour"),
                            "notes": [n["note"] for n in notes]})
    return {"traced_decisions": len(runs), "flagged": flagged}


def payload(run_id: str) -> dict:
    out = {}
    for t in ("input", "output"):
        try:
            r = HTTP.get(f"{WS}/api/spans/evt_{run_id}/payload", params={"target": t, "max_chars": 4000}, timeout=10)
            j = r.json()
            out[t] = j.get("payload", j) if isinstance(j, dict) else j
        except Exception:
            out[t] = ""
    return out


def evidence_text(ws: dict, k: int = 8) -> str:
    kinds = collections.Counter(n.split("]")[1].split(":")[0].strip() for f in ws["flagged"] for n in f["notes"])
    by_storm_n = collections.Counter(f["convo"].split(":")[1] for f in ws["flagged"])
    lines = [f"RAINDROP WORKSHOP EVIDENCE (read from Raindrop's trace store, {ws['traced_decisions']} traced AI decisions "
             f"today, {len(ws['flagged'])} flagged as issues).",
             "Flags by kind: " + ", ".join(f"{n}x {kname}" for kname, n in kinds.most_common()),
             "Flags by storm: " + ", ".join(f"{s}: {n}" for s, n in by_storm_n.most_common()),
             "Flagged decisions (the AI's own briefing tail and answer):"]
    for f in sorted(ws["flagged"], key=lambda f: f["hour"] or 0)[:: max(1, len(ws["flagged"]) // k)][:k]:
        p = payload(f["run_id"])
        inp = str(p.get("input") or p.get("input_payload") or "")[-500:].replace("\n", " | ")
        out = str(p.get("output") or p.get("output_payload") or "")[:300]
        lines.append(f"- {f['convo'].split(':')[1]} hour {f['hour']}: {'; '.join(f['notes'])}\n  briefing: ...{inp}\n  AI answer: {out}")
    return "\n".join(lines)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse-traces", action="store_true",
                    help="use the decisions already traced in Workshop; the failure list comes from the cached day")
    a = ap.parse_args()
    t_start = time.time()
    t0_ms = 0 if a.reuse_traces else int(t_start * 1000) - 5000
    try:
        HTTP.get(f"{WS}/health", timeout=3).raise_for_status()
    except Exception:
        sys.exit("Raindrop Workshop is not running: `raindrop workshop start`")
    st = json.loads((ROOT / "data" / "loop_state_evoA.json").read_text())
    loop = Loop(workers=16, train_seeds=SEEDS, held_seeds=(0,), tag=TAG, track="A", fixed_build=st["fixed_build"])
    for k in ("pages", "history", "strategy", "config", "strategy_version", "n_versions"):
        setattr(loop, k, st[k])
    loop.h = Harness.from_json(st["h"])
    gen = st["gen"]                                   # the night after Track A's last one
    print(f"[day] {loop.h.id} on {len(TRAIN_IDS)} practice storms x {len(SEEDS)} seeds, every decision traced in Raindrop")
    jobs = [(s, sd) for s in TRAIN_IDS for sd in SEEDS]
    if a.reuse_traces:      # the traced replay was stopped early for time: same notebook, same storms, cached results
        from harness.evolve import evaluate_jobs
        runs = evaluate_jobs(loop.h, loop.pages, jobs, 16)
    else:
        with ThreadPoolExecutor(16) as ex:
            runs = list(ex.map(lambda j: day_run(loop.h, loop.pages, *j), jobs))
    loop.train = runs
    raindrop_bridge.flush()
    time.sleep(3)
    passed = sum(majority_passed(rs) for rs in by_storm(runs).values())
    print(f"[day] practice {passed}/{len(TRAIN_IDS)}, {sum(r['ai_calls'] for r in runs)} AI decisions "
          f"({(time.time() - t_start) / 60:.1f} min)")

    ws = read_workshop(t0_ms)
    print(f"[read] Workshop holds {ws['traced_decisions']} traced decisions, {len(ws['flagged'])} flagged")
    evidence = evidence_text(ws)
    print(evidence[:1500])

    failing = loop.failing() or loop.darkest()
    worst = failing[0]
    loop.ev(gen, "sleep_start", f"Raindrop night: the coach reads {len(ws['flagged'])} decisions Raindrop flagged "
                                f"(of {ws['traced_decisions']} traced) plus {min(3, len(failing))} failure reports")
    loop.ev(gen, "raindrop_evidence", evidence[:1200], {"traced": ws["traced_decisions"], "flagged": len(ws["flagged"])},
            actor="raindrop")
    targets, jobs_t, jobs_o = loop.test_jobs(failing)
    reports = [evidence] + [coach.failure_report(r) for r in failing[:2]]
    out = coach.propose(loop.h, reports, loop.pages, loop.history, loop.strategy, 3, "A", loop.fixed_build, None)
    loop.ev(gen, "diagnosis", out["diagnosis"][:400])
    props = list(out["proposals"][:3])
    print(f"[night] diagnosis: {out['diagnosis'][:300]}")
    for p in props:
        print(f"[night] idea: [{p.get('organ')}] {p.get('title')} (predicted {p.get('predicted_change_pct')}%)")
    res = loop.trial_round(gen, props, jobs_t, jobs_o, born_from=worst["run_id"], scenario=worst["scenario_id"])
    rows = [{"title": r["p"].get("title"), "organ": r.get("organ"), "predicted_pct": r["p"].get("predicted_change_pct"),
             "kind": r.get("kind"), "reason": r.get("reason"), "accepted": r.get("status") == "accepted",
             "status": r.get("status"), "actual_pct": (r.get("verdict") or {}).get("actual_pct"),
             "ticks": (r.get("verdict") or {}).get("ticks"), "vid": r.get("vid")} for r in res]
    for x in rows:
        print(f"[test] {x['title']}: {'KEPT' if x['accepted'] else 'rejected'} {x['kind'] or ''} {x['reason'] or ''} "
              f"actual {x['actual_pct']}")
    summary = {"ran_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "minutes": round((time.time() - t_start) / 60, 1),
               "day_mode": ("traced replay of the practice storms (stopped early for time); failure list from the cached "
                            "day of the same notebook" if a.reuse_traces else "full traced replay"),
               "notebook": st["h"]["id"], "tag": TAG, "practice_passed": passed, "practice_storms": len(TRAIN_IDS),
               "workshop": {"url": WS, "traced_decisions": ws["traced_decisions"], "flagged": len(ws["flagged"]),
                            "flags_by_kind": dict(collections.Counter(
                                n.split("]")[1].split(":")[0].strip() for f in ws["flagged"] for n in f["notes"]))},
               "evidence": evidence, "diagnosis": out["diagnosis"], "ideas": rows,
               "kept": [x["vid"] for x in rows if x["accepted"]], "champion_after": loop.h.id}
    (ROOT / "data" / "raindrop_night.json").write_text(json.dumps(summary, indent=1, default=str))
    print(f"done in {summary['minutes']} min -> data/raindrop_night.json; champion after the night: {loop.h.id}")


if __name__ == "__main__":
    main()
