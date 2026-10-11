"""Export everything Mission Control shows into one bundle: viewer/public/mission/594_mission.json (594-mission/1).

  python scripts/export_mission.py --track A=evoA --track B=evoB [--showcase heldout_west_gas_2018:0]

Reads the store (data/local_store/*.jsonl, or Atlas when configured), the loop checkpoints (data/loop_state_*.json),
step-0 baselines (data/step0.json) and the cached runs (data/run_cache) for per-hour agent steps. Nothing is
recomputed except, for showcase storms, a re-run of cached decisions to rebuild the city replay (identical: the
operator's answers come from the prompt cache); the export checks that homes x hours match the cached run.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from harness.store import get_store  # noqa: E402

OUT = ROOT / "viewer" / "public" / "mission"
MODEL = {"operator": "Qwen3-30B-A3B-Instruct-2507", "weights_frozen": True, "fine_tune_runs": 0}
NICE = {"day1": "Day 1 notebook", "final": "Learned notebook"}
KEEP_EVENT_DATA = {"organ", "vid", "kind", "actual_pct", "gained", "ticks", "harness_id", "page", "redteam", "ab",
                   "counts", "acceptance_rate", "config", "tests"}


def src(coll: str, doc: dict) -> dict:
    """Where a record lives in Atlas: same sha1 _id that scripts/migrate_to_atlas.py upserts it under."""
    import hashlib
    body = {k: v for k, v in doc.items() if k != "embedding"}
    return {"db": "simdb", "coll": coll,
            "id": hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()}


def _by_tag(rows, tag):
    return [r for r in rows if r.get("tag") == tag]


def latest_day_starts(store, tag: str) -> dict:
    """generation -> timestamp of its last gen_start event (a resumed loop restarts the day)."""
    out = {}
    for e in _by_tag(store.all("events"), tag):
        if e["type"] == "gen_start":
            out[e["generation"]] = max(out.get(e["generation"], 0), e.get("_ts", 0))
    return out


def track_bundle(store, tag: str) -> dict:
    # a resumed loop can re-score a day after a crash: keep the latest record per generation
    board = list({r["generation"]: r for r in sorted(_by_tag(store.all("scoreboard"), tag),
                                                       key=lambda r: (r["generation"], r.get("_ts", 0)))}.values())
    gens = [{"generation": b["generation"], "harness_id": b["harness_id"], "hash": b["hash"], "counts": b["counts"],
             "pages": b["pages"], "train_majority": b.get("train_majority"), "heldout_majority": b.get("heldout_majority"),
             "heldout_hh_median": b.get("heldout_hh_median"), "heldout_hh_by_seed": b.get("heldout_hh_by_seed"),
             "held_seeds": b.get("held_seeds"), "heldout_seed_passes": b.get("heldout_seed_passes"),
             "heldout": b.get("heldout"), "inconclusive": b.get("inconclusive", 0)} for b in board]
    # A night that was redone after a crash leaves its first attempt in the store: keep only records written after the
    # LAST start of that day (the attempt the loop actually continued from).
    last_start = latest_day_starts(store, tag)
    fresh = lambda rows, key: [r for r in rows if r.get("_ts", 0) >= last_start.get(r.get(key) or 0, 0)]  # noqa: E731
    muts = sorted(fresh(_by_tag(store.all("mutations"), tag), "generation"), key=lambda m: m.get("_ts", 0))
    versions = [v for v in _by_tag(store.all("harness_versions"), tag)
                if not v.get("night") or v.get("_ts", 0) >= last_start.get(v["night"], 0)]
    nb_keys = ("sensors", "rules", "guardrails", "alerts", "context", "authority", "build", "memory_policy")
    lineage = [{"id": v["id"], "parent_id": v.get("parent_id"), "night": v.get("night"), "status": v.get("status"),
                "counts": v.get("counts"), "kept": v.get("kept", []), "born_from": v.get("born_from"),
                "hash": v.get("hash"), "notebook": {k: v.get(k) for k in nb_keys},  # full rules, for reading + diffs
                "_src": src("harness_versions", v)}
               for v in sorted(versions, key=lambda d: d.get("_ts", 0))]
    edits = [{k: m.get(k) for k in ("generation", "title", "organ", "organs_touched", "status", "reason", "reason_kind",
                                    "ops", "predicted", "predicted_pct", "actual", "actual_pct", "ticks", "lesson",
                                    "child_id", "stacked_id", "parent_id", "strategy_version", "night0", "redteam")}
             | {"_src": src("mutations", m)} for m in muts]
    # With a Night 0 (zero-shot) the learning nights are numbered 1, 2, ... (generation - 1) on screen.
    night0 = any(m.get("night0") for m in _by_tag(store.all("mutations"), tag))
    shift = 1 if night0 else 0
    nights: dict = {}
    for e in sorted(_by_tag(store.all("events"), tag), key=lambda e: e.get("_ts", 0)):
        data = {k: v for k, v in (e.get("data") or {}).items() if k in KEEP_EVENT_DATA}
        text = e["text_plain"]
        if e["type"] == "sleep_start" and shift:
            text = re.sub(r"^(Polish night|Night) (\d+)", lambda m: f"{m.group(1)} {int(m.group(2)) - shift if int(m.group(2)) > 0 else 0}", text)
        if e["type"] == "gen_start":      # a resumed loop restarts the day: drop the interrupted attempt's steps
            nights[str(e["generation"])] = []
        nights.setdefault(str(e["generation"]), []).append({"type": e["type"], "actor": e["actor"], "text": text,
                                                             "data": data, "night": max(0, e["generation"] - shift),
                                                             "_src": src("events", e)})
    metrics = [m | {"_src": src("coach_metrics", m)}
               for m in sorted(_by_tag(store.all("coach_metrics"), tag), key=lambda m: m["generation"])]
    l2 = sorted(_by_tag(store.all("evolver_strategies"), tag), key=lambda m: m["generation"])
    calib = [{"generation": m["generation"], "organ": m.get("organ"), "predicted_pct": m.get("predicted_pct"),
              "actual_pct": m.get("actual_pct"), "strategy_version": m.get("strategy_version"), "status": m["status"]}
             for m in muts if m.get("actual_pct") is not None and not m.get("redteam")]
    pages = sorted(fresh(_by_tag(store.all("manual_pages"), tag), "generation"), key=lambda p: p.get("_ts", 0))
    st = ROOT / "data" / f"loop_state_{tag}.json"
    state = json.loads(st.read_text()) if st.exists() else {}
    return {"tag": tag, "track": state.get("track"), "fixed_build": state.get("fixed_build"), "generations": gens,
            "lineage": lineage, "edits": edits, "nights": nights, "coach_metrics": metrics,
            "l2": [{k: s.get(k) for k in ("generation", "insight", "adopted", "ab", "acceptance_rate", "proposed_config",
                                          "previous_config", "strategy_version", "proposed_strategy")}
                   | {"_src": src("evolver_strategies", s)} for s in l2],
            "calibration": calib, "manual": state.get("h"), "pages": [{k: p.get(k) for k in ("id", "title", "text",
                                                                                          "generation", "organ", "harness_id", "scenario_id")}
                                                         | {"_src": src("manual_pages", p)} for p in pages]}


def showcase(scenario: str, seed: int, manuals: dict, track: str = "") -> dict:
    """Re-run a storm for each manual from the prompt cache to rebuild the city replay + per-hour agent steps."""
    from harness.memory import Manual
    from harness.run import run_storm
    from sim.export_replay import build_replay
    out = {"scenario_id": scenario, "seed": seed, "runs": {}}
    OUT.mkdir(parents=True, exist_ok=True)
    for label, (h, pages) in manuals.items():
        r = run_storm(h, scenario, seed, Manual(pages))
        rp = build_replay(r["_result"], label=NICE.get(label, label), scenario_public="Unseen storm",
                          harness={"id": h.id, "hash": h.hash()}, model=MODEL)
        f = OUT / f"replay_{track}_{scenario}_{seed}_{label}.json"
        f.write_text(json.dumps(rp))
        out["runs"][label] = {"replay": f.name, "passed": r["passed"], "verdict": r["verdict_plain"],
                              "homes_dark_hours": r["homes_dark_hours"], "api_errors": sum(
                                  1 for e in r["events"] if e["type"] == "ai_decision" and (e.get("data") or {}).get("error")),
                              "_src": {"db": "file", "coll": "run_cache", "id": f"{scenario}:{seed}:{h.hash()}"},
                              "steps": [{"h": e["h"], "type": e["type"], "actor": e["actor"], "text": e["text_plain"],
                                         "raw": e}
                                        for e in r["events"] if e["actor"] != "sim" or e["type"] in
                                        ("freeze_off", "shed_start", "shed_end", "ufls", "collapse", "gas_feedback", "restore")]}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", action="append", default=[], help="A=evoA (track letter = loop tag)")
    ap.add_argument("--showcase", action="append", default=[], help="scenario:seed (Day 1 vs final manual per track)")
    a = ap.parse_args()
    store = get_store()
    bundle = {"format": "594-mission/1", "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "tracks": {}}
    for spec in a.track:
        letter, tag = spec.split("=")
        bundle["tracks"][letter] = track_bundle(store, tag)
    s0 = ROOT / "data" / "step0.json"
    if s0.exists():
        d = json.loads(s0.read_text())
        bundle["baselines"] = {"scripted": (d.get("a1") or {}).get("results"),
                               "track_a_rule": (d.get("a1") or {}).get("track_a_rule"),
                               "llm": {k: {kk: v.get(kk) for kk in ("majority_passed", "ticks", "by_seed", "title")}
                                       for k, v in (d.get("llm_all") or {}).items()}}
    pf = ROOT / "data" / "postfreeze.json"
    if pf.exists():
        p = json.loads(pf.read_text())
        llm_rows = bundle.setdefault("baselines", {}).setdefault("llm", {})
        for t, to in (p.get("tearout") or {}).items():
            llm_rows[f"post{t}:Track {t} frozen notebook (full)"] = to["full"]
            for m in to["minus"]:
                llm_rows[f"post{t}:minus {m['organ']} {m['id']} ({m['desc'][:60]})"] = m
        for t, rows in (p.get("score") or {}).items():
            if t in bundle["tracks"]:
                on_path = {v["id"] for v in bundle["tracks"][t]["lineage"]}
                bundle["tracks"][t]["final_scores"] = [r for r in rows if r["id"] in on_path]
        for t, ab in (p.get("ablate") or {}).items():
            if t in bundle["tracks"]:
                bundle["tracks"][t]["ablation"] = ab
        bundle["presets"] = p.get("presets")
    lock = ROOT / "sim" / "LOCK.json"
    bundle["honesty"] = {"sim_lock": json.loads(lock.read_text()) if lock.exists() else None,
                         "atlas_check": json.loads((ROOT / "data" / "atlas_check.json").read_text())
                         if (ROOT / "data" / "atlas_check.json").exists() else None}
    rn = ROOT / "data" / "raindrop_night.json"          # the night whose evidence was read back out of Raindrop
    bundle["raindrop_night"] = json.loads(rn.read_text()) if rn.exists() else None
    lr = ROOT / "data" / "locked_results.json"
    fz = ROOT / "data" / "frozen.json"
    if fz.exists():
        bundle["honesty"]["frozen"] = {k: v for k, v in json.loads(fz.read_text()).items() if k != "day1"}
        for t in bundle["honesty"]["frozen"].get("tracks", {}).values():
            t.pop("harness", None)
            t.pop("pages", None)
    if lr.exists():
        res = json.loads(lr.read_text())
        rows = {}
        for k, s in res["summary"].items():
            short = {"C_B": "C", "D_B": "D"}.get(k, k)
            rows[short if short not in rows else k] = {
                "label": s["label"], "passed": s["storm_passed"], "passed_seeds": s["passed_seeds"],
                "peak_shed_frac": statistics.median(s["peak_shed_frac"]), "homes_dark_hours": statistics.median(s["homes_dark_hours"]),
                "below_59_4_s": 60 * max(s["max_below_59_4_min"]), "collapsed": s["collapses"] >= 2, "collapses": s["collapses"],
                "api_errors": s.get("api_errors", 0),
                "seeds": [{f: r.get(f) for f in ("seed", "passed", "collapsed", "collapse_hour", "peak_shed_frac", "homes_dark_hours",
                                                 "min_freq", "max_below_59_4_min", "ai_calls")}
                          for r in sorted((r for r in res.get("rows", []) if r["config"] == k), key=lambda r: r["seed"])]}
            if short != k:
                rows[k] = rows[short]
        bundle["honesty"]["locked_2021"] = {"run": True, "ran_at": res["ran_at"], "registration": res["registration"], "rows": rows}
    else:
        bundle["honesty"]["locked_2021"] = {"run": False}
    if a.showcase:
        from harness.schema import Harness
        bundle["showcase"] = []
        for spec in a.showcase:
            scn, seed = spec.split(":")
            for letter, tb in bundle["tracks"].items():
                if not tb.get("manual"):
                    continue
                first = next((v for v in tb["lineage"] if v.get("parent_id") is None), None)
                day1 = Harness.from_json(store.find("harness_versions", id=first["id"])[0]) if first else None
                mans = {"day1": (day1, []), "final": (Harness.from_json(tb["manual"]),
                                                      json.loads((ROOT / "data" / f"loop_state_{tb['tag']}.json").read_text()).get("pages", []))}
                bundle["showcase"].append({"track": letter, **showcase(scn, int(seed), mans, letter)})
    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / "594_mission.json"
    f.write_text(json.dumps(bundle, default=str))
    print(f"wrote {f} ({f.stat().st_size / 1e6:.2f} MB): tracks {list(bundle['tracks'])}, "
          f"showcase {len(bundle.get('showcase', []))}")


if __name__ == "__main__":
    main()
