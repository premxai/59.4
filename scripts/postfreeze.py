"""After the overnight runs: freeze the notebooks, then compute everything Mission Control shows about them.

  .venv/Scripts/python scripts/postfreeze.py --freeze          write data/frozen.json (refuses while loops run)
  .venv/Scripts/python scripts/postfreeze.py --all             score + ablate + tearout + presets (after --freeze)

  score     every notebook version of each track on the 8 unseen storms x 3 seeds (mostly cached runs)
  ablate    AI unplugged, remove one organ (habit / hard limit / build) at a time from the frozen notebook: instant,
            ranks which parts carry the result
  tearout   the top-2 organs from `ablate`, removed with the AI on, unseen storms x 3 seeds (the tear-out demo)
  presets   judge-storm presets (compact) for Day 1 vs frozen notebook, run once so the stage's "fast" mode is instant
Results: data/postfreeze.json (merged into the Mission Control bundle by scripts/export_mission.py).
"""
from __future__ import annotations

import argparse
import copy
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from harness.evolve import BUILD_PRESETS, evaluate  # noqa: E402
from harness.schema import Harness, v1  # noqa: E402
from harness.store import get_store  # noqa: E402
from sim.scenarios import HELDOUT_IDS  # noqa: E402

OUT = ROOT / "data" / "postfreeze.json"
SEEDS = (0, 1, 2)
TAGS = {"A": "evoA", "B": "evoB"}


def save(key, val):
    d = json.loads(OUT.read_text()) if OUT.exists() else {}
    d[key] = val
    OUT.write_text(json.dumps(d, indent=1, default=str))


def summarize(runs):
    per = {}
    for r in runs:
        per.setdefault(r["scenario_id"], []).append(r)
    by_seed = {sd: {"passed": sum(r["passed"] for r in runs if r["seed"] == sd),
                    "homes_dark_hours": sum(r["homes_dark_hours"] for r in runs if r["seed"] == sd)} for sd in SEEDS}
    hh = [v["homes_dark_hours"] for v in by_seed.values()]
    return {"majority_passed": sum(sum(x["passed"] for x in rs) * 2 > len(rs) for rs in per.values()),
            "ticks": "".join("✓" if sum(x["passed"] for x in per[s]) * 2 > len(per[s]) else "✗" for s in HELDOUT_IDS),
            "by_seed": by_seed, "hh_median": statistics.median(hh), "hh_min": min(hh), "hh_max": max(hh),
            "inconclusive": sum(bool(r.get("inconclusive")) for r in runs)}


def _running() -> int:
    import subprocess
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          "@(Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object { $_.CommandLine -match 'harness.evolve' }).Count"],
                         capture_output=True, text=True).stdout.strip()
    return int(out or 0)


def freeze(force: bool = False):
    """Freeze the notebook each learning loop ENDED with (never the best held-out version: that would be test-set
    selection). --force: freeze a loop that stopped without its 'finished' line, only if no learning loop runs."""
    for t, tag in TAGS.items():
        log = ROOT / "data" / f"evolve_{tag}.log"
        if log.exists() and "##### finished ok" not in log.read_text(encoding="utf-8", errors="ignore")[-3000:]:
            if not force:
                sys.exit(f"{tag} has no 'finished ok' line in {log.name}; freeze after it stops (or --force)")
            if _running():
                sys.exit("a learning loop is still running; stop it before --force")
    lock = json.loads((ROOT / "sim" / "LOCK.json").read_text())
    out = {"frozen_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "sim_lock": lock.get("sim_hash"),
           "day1": {"harness": v1().to_json()}, "tracks": {}}
    for t, tag in TAGS.items():
        st = ROOT / "data" / f"loop_state_{tag}.json"
        if not st.exists():
            continue
        d = json.loads(st.read_text())
        h = Harness.from_json(d["h"])
        out["tracks"][t] = {"tag": tag, "harness": h.to_json(), "hash": h.hash(), "pages": d.get("pages", []),
                            "counts": h.counts(), "generations_run": d.get("gen", 1) - 1}
        print(f"froze track {t}: {h.id} {h.hash()} ({len(d.get('pages', []))} pages)")
    (ROOT / "data" / "frozen.json").write_text(json.dumps(out, indent=1))


def frozen():
    f = ROOT / "data" / "frozen.json"
    if not f.exists():
        sys.exit("freeze first: --freeze")
    return json.loads(f.read_text())


def score(workers=48):
    st = get_store()
    vers = {}
    for v in sorted(st.all("harness_versions"), key=lambda d: d.get("_ts", 0)):
        if v.get("tag") in TAGS.values():
            vers.setdefault(v["tag"], []).append(v)
    pages_all = st.all("manual_pages")
    out = {}
    for t, tag in TAGS.items():
        rows = []
        for v in vers.get(tag, []):
            h = Harness.from_json(v)
            night = v.get("night") or 0
            pages = [p for p in pages_all if p.get("tag") == tag and (p.get("generation") or 0) <= night and night > 0]
            s = summarize(evaluate(h, pages, HELDOUT_IDS, SEEDS, workers))
            rows.append({"id": h.id, "night": night, "counts": h.counts(), **s})
            print(f"{tag} {h.id} night {night}: {s['majority_passed']}/8 {s['ticks']} homes-dark median {s['hh_median'] / 1e6:,.0f}M")
        out[t] = rows
    save("score", out)


def _variants(h: Harness, fixed_build: dict | None):
    j = h.to_json()
    for r in j["rules"]:
        yield ("habit", r["id"], r.get("description") or r["if"], {**j, "rules": [x for x in j["rules"] if x["id"] != r["id"]]})
    for g in j["guardrails"]:
        yield ("hard_limit", g["id"], g.get("description") or g["when"],
               {**j, "guardrails": [x for x in j["guardrails"] if x["id"] != g["id"]]})
    if j["build"] and j["build"] != (fixed_build or {}):
        yield ("build", "build", "before-winter preparation", {**j, "build": copy.deepcopy(fixed_build or {})})


def ablate(workers=48):
    fz = frozen()
    out = {}
    for t, f in fz["tracks"].items():
        h = Harness.from_json(f["harness"])
        fixed = BUILD_PRESETS["map"] if t == "A" else {}
        base = summarize(evaluate(h, f["pages"], HELDOUT_IDS, SEEDS, workers, use_llm=False))
        rows = []
        for organ, oid, desc, vj in _variants(h, fixed):
            s = summarize(evaluate(Harness.from_json(vj), f["pages"], HELDOUT_IDS, SEEDS, workers, use_llm=False))
            rows.append({"organ": organ, "id": oid, "desc": desc, "majority_passed": s["majority_passed"],
                         "hh_median": s["hh_median"], "x_darker": s["hh_median"] / max(base["hh_median"], 1.0)})
        rows.sort(key=lambda r: -r["x_darker"])
        out[t] = {"full_ai_unplugged": base, "removed": rows}
        for r in rows[:5]:
            print(f"track {t} AI unplugged, minus {r['organ']} {r['id']} ({r['desc'][:50]}): {r['majority_passed']}/8, {r['x_darker']:.1f}x darker")
    save("ablate", out)


def tearout(workers=48, top=2):
    fz = frozen()
    ab = json.loads(OUT.read_text()).get("ablate", {})
    out = {}
    for t, f in fz["tracks"].items():
        h = Harness.from_json(f["harness"])
        full = summarize(evaluate(h, f["pages"], HELDOUT_IDS, SEEDS, workers))
        picks = [r for r in ab.get(t, {}).get("removed", []) if r["organ"] in ("habit", "hard_limit", "build")][:top]
        rows = []
        variants = {(o, i): vj for o, i, _, vj in _variants(h, BUILD_PRESETS["map"] if t == "A" else {})}
        for r in picks:
            s = summarize(evaluate(Harness.from_json(variants[(r["organ"], r["id"])]), f["pages"], HELDOUT_IDS, SEEDS, workers))
            rows.append({"organ": r["organ"], "id": r["id"], "desc": r["desc"], **s})
            print(f"track {t} tear-out {r['organ']} {r['id']}: {full['majority_passed']}/8 -> {s['majority_passed']}/8, "
                  f"homes dark x{s['hh_median'] / max(full['hh_median'], 1):.1f}")
        out[t] = {"full": full, "minus": rows}
    save("tearout", out)


def presets():
    from harness.live import judge_storm, run_live
    fz = frozen()
    grid = [(c, x) for c in (3.0, 5.0, 7.0) for x in (1.25, 2.0)]
    out = []

    def one(args):
        t, c, x = args
        f = fz["tracks"][t]
        day1 = v1()
        if t == "A":
            day1.build = dict(BUILD_PRESETS["map"])
        scn = judge_storm(c, x, "statewide", 0.0, False)
        res = run_live(scn, {"day1": (day1, []), "frozen": (Harness.from_json(f["harness"]), f["pages"])}, lambda m: None,
                       fresh=False)
        return {"track": t, "colder_c": c, "longer_x": x, "storm_id": scn.id,
                **{k: {"passed": bool(r.passed), "verdict": r.verdict_plain, "homes_dark_hours": float(r.homes_dark_hours)}
                   for k, (r, _) in res.items()}}

    jobs = [(t, c, x) for t in fz["tracks"] for c, x in grid]
    with ThreadPoolExecutor(len(jobs)) as ex:
        for row in ex.map(one, jobs):
            out.append(row)
            print(f"preset track {row['track']} {row['colder_c']}C x{row['longer_x']}: day1 {row['day1']['verdict']} | "
                  f"frozen {row['frozen']['verdict']}")
    save("presets", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--all", action="store_true")
    for s in ("score", "ablate", "tearout", "presets"):
        ap.add_argument(f"--{s}", action="store_true")
    a = ap.parse_args()
    if a.freeze:
        freeze(a.force)
    for s in ("score", "ablate", "tearout", "presets"):
        if a.all or getattr(a, s):
            print(f"== {s}", flush=True)
            globals()[s]()
