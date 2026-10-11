"""The locked 2021 exam: run ONCE, after the notebooks are frozen (scripts/postfreeze.py --freeze).

  .venv/Scripts/python scripts/run_locked.py --register          pre-register configs + hashes (no runs)
  .venv/Scripts/python scripts/run_locked.py --run --once        run every config on seeds 0-2, once

Configs (each on the anonymized storm "Locked storm #1"; the AI never sees names, dates or places):
  A    Day-1 notebook                              B    Day-1 notebook, AI told outright it is Uri / Feb 2021
  C_A  Track A frozen notebook                     C_B  Track B frozen notebook
  D_A  Track A notebook, AI unplugged (rules only) D_B  Track B notebook, AI unplugged
  T0   another AI (Gemma-3-27B) with the Day-1 notebook
  T    Gemma-3-27B with the Track B frozen notebook  (does the notebook transfer to a different AI?)
Writes: vault.locked_tests (registration) and vault.test_runs (results) with the evaluator user when
MONGODB_URI_EVAL is set, else data/vault_local/*.jsonl (append-only). Refuses to run twice for the same frozen
hashes. Also writes data/locked_results.json and city replays for Mission Control's FINAL EXAM tab.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

from harness import locked  # noqa: E402
from harness.memory import Manual  # noqa: E402
from harness.operator import HarnessPolicy  # noqa: E402
from harness.schema import Harness  # noqa: E402

EXAM = "locked_2021_feb"
SEEDS = (0, 1, 2)
GEMMA = "google/gemma-3-27b-it"
TOLD = ("\nCONTEXT: This is ERCOT, the Texas grid, during Winter Storm Uri in February 2021. Use everything you know "
        "about what happened.")          # same text as feasibility/llm_runs.py
LOCAL_VAULT = ROOT / "data" / "vault_local"


class Vault:
    def __init__(self):
        load_dotenv(ROOT / ".env")
        uri = os.getenv("MONGODB_URI_EVAL")
        self.db = None
        if uri and os.getenv("FOUR37_LOCAL_STORE") != "1":
            from pymongo import MongoClient
            self.db = MongoClient(uri, serverSelectionTimeoutMS=10000, appname="59.4-evaluator")["vault"]
        LOCAL_VAULT.mkdir(parents=True, exist_ok=True)

    def insert(self, coll, doc):
        doc = {**doc, "_ts": time.time()}
        if self.db is not None:
            self.db[coll].insert_one(dict(doc))
        with open(LOCAL_VAULT / f"{coll}.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, default=str) + "\n")

    def find(self, coll, **eq):
        if self.db is not None:
            return list(self.db[coll].find(eq, {"_id": 0}))
        f = LOCAL_VAULT / f"{coll}.jsonl"
        rows = [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()] if f.exists() else []
        return [r for r in rows if all(r.get(k) == v for k, v in eq.items())]


def configs(frozen: dict) -> dict:
    out = {}
    day1 = Harness.from_json(frozen["day1"]["harness"])
    for t in ("A", "B"):
        if t not in frozen["tracks"]:
            continue
        fz = frozen["tracks"][t]
        h, pages = Harness.from_json(fz["harness"]), fz["pages"]
        out[f"C_{t}"] = dict(h=h, pages=pages, use_llm=True, model=None, extra="", label=f"Track {t} frozen notebook")
        out[f"D_{t}"] = dict(h=h, pages=pages, use_llm=False, model=None, extra="", label=f"Track {t} notebook, AI unplugged")
    out["A"] = dict(h=day1, pages=[], use_llm=True, model=None, extra="", label="Day-1 notebook")
    out["B"] = dict(h=day1, pages=[], use_llm=True, model=None, extra=TOLD, label="Day-1 notebook, AI told it is Feb 2021")
    out["T0"] = dict(h=day1, pages=[], use_llm=True, model=GEMMA, extra="", label="Gemma-3-27B, Day-1 notebook")
    if "B" in frozen["tracks"]:
        fz = frozen["tracks"]["B"]
        out["T"] = dict(h=Harness.from_json(fz["harness"]), pages=fz["pages"], use_llm=True, model=GEMMA, extra="",
                        label="Gemma-3-27B, Track B frozen notebook")
    return out


def run_one(cfg, seed):
    pol = HarnessPolicy(cfg["h"], Manual(cfg["pages"]), use_llm=cfg["use_llm"], model=cfg["model"],
                        system_extra=cfg["extra"])
    r = locked.run(EXAM, pol, seed)
    errors = sum(1 for e in pol.events if e["type"] == "ai_decision" and (e.get("data") or {}).get("error"))
    return r, pol, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--once", action="store_true", help="required with --run: the exam runs exactly once")
    a = ap.parse_args()
    ff = ROOT / "data" / "frozen.json"
    if not ff.exists():
        sys.exit("data/frozen.json missing: freeze first (scripts/postfreeze.py --freeze)")
    frozen = json.loads(ff.read_text())
    cfgs = configs(frozen)
    key = hashlib.sha1(json.dumps({k: c["h"].hash() + str(c["use_llm"]) + str(c["model"]) + c["extra"]
                                   for k, c in sorted(cfgs.items())}, sort_keys=True).encode()).hexdigest()[:16]
    vault = Vault()
    reg = vault.find("locked_tests", registration=key)
    if a.register:
        if reg:
            print(f"already registered: {key}")
        else:
            vault.insert("locked_tests", {"registration": key, "exam": EXAM, "public": locked.EXAMS[EXAM]["public"],
                                          "sim_lock": frozen.get("sim_lock"), "seeds": list(SEEDS),
                                          "configs": {k: {"label": c["label"], "harness_hash": c["h"].hash(),
                                                          "use_llm": c["use_llm"], "model": c["model"] or "Qwen3-30B-A3B",
                                                          "told": bool(c["extra"])} for k, c in cfgs.items()}})
            print(f"registered {len(cfgs)} configs: {key}")
        return
    if not a.run or not a.once:
        sys.exit("use --register, or --run --once")
    if not reg:
        sys.exit("not registered yet: run --register first")
    if vault.find("test_runs", registration=key):
        sys.exit(f"the locked exam already ran for registration {key}; it runs only once")
    jobs = [(k, sd) for k in cfgs for sd in SEEDS]
    print(f"running {len(jobs)} locked-exam runs once ...", flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(len(jobs)) as ex:
        outs = list(ex.map(lambda j: (j, run_one(cfgs[j[0]], j[1])), jobs))
    rows, summary = [], {}
    from sim.export_replay import build_replay
    for (k, sd), (r, pol, errors) in outs:
        row = {"registration": key, "config": k, "label": cfgs[k]["label"], "seed": sd, "passed": bool(r.passed),
               "verdict": r.verdict_plain, "collapsed": bool(r.collapsed), "collapse_hour": r.collapse_hour,
               "peak_shed_frac": float(r.peak_shed_frac), "homes_dark_hours": float(r.homes_dark_hours),
               "min_freq": float(r.min_freq), "max_below_59_4_min": int(r.max_below_59_4_min), "ai_calls": pol.ai_calls,
               "api_errors": errors}
        vault.insert("test_runs", row)
        rows.append(row)
        if sd == 0 and k in ("A", "C_A", "C_B"):
            out = ROOT / "viewer" / "public" / "mission" / f"exam_{k}.json"
            out.write_text(json.dumps(build_replay(r, label=cfgs[k]["label"], scenario_public="Locked storm #1",
                                                   harness={"id": cfgs[k]["h"].id, "hash": cfgs[k]["h"].hash()})))
    for k in cfgs:
        rs = [x for x in rows if x["config"] == k]
        summary[k] = {"label": cfgs[k]["label"], "passed_seeds": sum(x["passed"] for x in rs), "storm_passed": sum(x["passed"] for x in rs) >= 2,
                      "collapses": sum(x["collapsed"] for x in rs), "homes_dark_hours": [x["homes_dark_hours"] for x in rs],
                      "peak_shed_frac": [x["peak_shed_frac"] for x in rs], "max_below_59_4_min": [x["max_below_59_4_min"] for x in rs],
                      "api_errors": sum(x["api_errors"] for x in rs)}
        print(f"{k:4s} {cfgs[k]['label']:42s} passed {summary[k]['passed_seeds']}/3  collapses {summary[k]['collapses']}  "
              f"worst-hour dark {[round(x, 2) for x in summary[k]['peak_shed_frac']]}", flush=True)
    (ROOT / "data" / "locked_results.json").write_text(json.dumps({"registration": key, "ran_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                                                    "minutes": round((time.time() - t0) / 60, 1),
                                                                    "summary": summary, "rows": rows}, indent=1))
    print(f"done in {(time.time() - t0) / 60:.1f} min -> data/locked_results.json")


if __name__ == "__main__":
    main()
