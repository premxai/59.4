"""Live stage server: the judge's storm, run by the same frozen AI with the Day-1 and the learned manual,
streamed hour by hour to the browser (Server-Sent Events), plus the read-only ERCOT "Texas right now" feed.

  .venv/Scripts/python scripts/live_server.py            (http://localhost:8594)

  GET  /api/ercot                       live public ERCOT reading (cached 30 s, stale-marked when offline)
  GET  /api/manuals                     the manuals available (day1, champion) with their organ counts
  POST /api/storm   {colder_c, longer_x, where, surge, freezing_rain, base, use_llm}
                                        -> {run_id, storm}; already-run storms replay instantly from data/live_cache
  POST /api/compare {storm_id|custom, left, right, seed, fresh}   two notebooks side by side (fresh=false replays an
                                        identical earlier comparison instantly)
  GET  /api/record/{coll}/{id}          one stored record from Atlas (vault/test_runs: the AI's user is refused)
  GET  /api/stream/{run_id}             SSE: {"type":"hour", ...} per manual per hour, then {"type":"done", results}
The champion manual is read from data/loop_state_<tag>.json (env FOUR37_CHAMPION_TAG, default evoA).
"""
from __future__ import annotations

import hashlib
import json
import os
import queue
import sys
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# live demo runs are sent to Raindrop when a write key is configured (learning runs are not)
from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / ".env")
if os.getenv("RAINDROP_WRITE_KEY"):
    os.environ.setdefault("FOUR37_RAINDROP", "1")

import uvicorn  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from harness import ercot_live  # noqa: E402
from harness.evolve import BUILD_PRESETS  # noqa: E402
from harness.live import judge_storm, run_live  # noqa: E402
from harness.schema import Harness, v1  # noqa: E402
from sim.export_replay import build_replay  # noqa: E402

CACHE = ROOT / "data" / "live_cache"
CACHE.mkdir(parents=True, exist_ok=True)
TAG = os.getenv("FOUR37_CHAMPION_TAG", "evoA")
app = FastAPI(title="59.4 live")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
RUNS: dict = {}
_ercot = {"t": 0.0, "d": None}


class StormReq(BaseModel):
    colder_c: float = 4.0
    longer_x: float = 1.5
    where: str = "statewide"
    surge: float = 0.0
    freezing_rain: bool = False
    base: str = "feb2011"
    use_llm: bool = True


def manuals() -> dict:
    st = ROOT / "data" / f"loop_state_{TAG}.json"
    day1 = v1()
    out = {}
    if st.exists():
        d = json.loads(st.read_text())
        if d.get("track") == "A":
            day1.build = dict(d.get("fixed_build") or BUILD_PRESETS["map"])
        out["champion"] = (Harness.from_json(d["h"]), d.get("pages", []))
    out = {"day1": (day1.validate(), []), **out}
    return out


# ------------------------------------------------------------------ pick a storm, pick two notebooks, run live
def storm_catalog() -> list:
    from sim.scenarios import GATE_IDS, HELDOUT_IDS, TRAIN_IDS, get
    groups = (("unseen", "Unseen storm", HELDOUT_IDS), ("practice", "Practice storm", TRAIN_IDS),
              ("calm", "Real calm cold day", GATE_IDS))
    out = []
    for kind, label, ids in groups:
        for k, sid in enumerate(ids, 1):
            s = get(sid)
            out.append({"id": sid, "kind": kind, "label": f"{label} #{k}", "description": s.description,
                        "source_year": int(str(s.start)[:4]), "real_unmodified": not s.transforms})
    return out


_VERS: dict = {"t": 0.0, "v": None}


def _versions() -> dict:
    """Cached: the loops are frozen, and reading every event from Atlas over a slow link takes ~20 s."""
    if _VERS["v"] is None or time.time() - _VERS["t"] > 600:
        _VERS["v"], _VERS["t"] = _load_versions(), time.time()
    return _VERS["v"]


def _load_versions() -> dict:
    """Every notebook version: each track's champions (in order) + Day 1 + Claude's zero-shot notebook."""
    from harness.coach import decode_ops
    from harness.store import LocalStore, get_store
    st = get_store()
    try:
        pages = st.all("manual_pages")
        _VERS["store"] = {"mongo": "atlas", "local": "local"}.get(getattr(st, "kind", ""), "atlas")
    except Exception:                 # Atlas unreachable from this network: same records, local copy
        st, _VERS["store"] = LocalStore(), "local (Atlas unreachable)"
        pages = st.all("manual_pages")
    vers = {}
    starts: dict = {}                 # (tag, generation) -> last day start: drops the first attempt of a redone night
    for e in st.all("events"):
        if e.get("type") == "gen_start":
            k = (e.get("tag"), e.get("generation"))
            starts[k] = max(starts.get(k, 0), e.get("_ts", 0))
    pages = [p for p in pages if p.get("_ts", 0) >= starts.get((p.get("tag"), p.get("generation")), 0)]
    for v in sorted(st.all("harness_versions"), key=lambda d: d.get("_ts", 0)):
        tag = v.get("tag")
        if tag not in ("evoA", "evoB"):
            continue
        night = v.get("night") or 0
        if night and v.get("_ts", 0) < starts.get((tag, night), 0):
            continue
        h = Harness.from_json(v)
        pg = [p for p in pages if p.get("tag") == tag and (p.get("generation") or 0) <= night and night > 0]
        label = ("Day 1 notebook" if not v.get("parent_id") else f"After night {night - 1}" if night > 1 else "After night 0 (Claude's zero-shot)")
        vers[h.id] = {"id": h.id, "track": v.get("track"), "night": night, "label": f"Track {v.get('track')} · {label}",
                      "counts": h.counts(), "hash": h.hash(), "_h": h, "_pages": pg}
    for t in ("A", "B"):
        f = ROOT / "data" / f"zero_shot_{t}.json"
        if f.exists():
            base = v1()
            if t == "A":
                base.build = dict(BUILD_PRESETS["map"])
            p = json.loads(f.read_text())["proposals"][0]
            h = base.apply_ops(decode_ops(p["ops"]), f"zero_shot_{t}", "night0")
            vers[h.id] = {"id": h.id, "track": t, "night": 0, "label": f"Track {t} · Claude's own best guess (no learning)",
                          "counts": h.counts(), "hash": h.hash(), "_h": h, "_pages": []}
    return vers


@app.get("/api/catalog")
def catalog():
    vers = _versions()
    # BREAK THE GRID draws from storms the coach never trained on: the 8 unseen storms plus the judge-storm presets
    # that scripts/postfreeze.py already ran once (so the stage's fast mode starts instantly).
    pool = [{"storm_id": s["id"], "label": s["label"]} for s in storm_catalog() if s["kind"] == "unseen"]
    pf = ROOT / "data" / "postfreeze.json"
    if pf.exists():
        for p in json.loads(pf.read_text()).get("presets") or []:
            pool.append({"custom": {"colder_c": p["colder_c"], "longer_x": p["longer_x"], "where": "statewide",
                                    "surge": 0.0, "freezing_rain": False, "base": "feb2011"},
                         "label": f"Judge storm: {p['colder_c']:g} C colder, {p['longer_x']:g}x as long"})
    frozen = {}
    fz = ROOT / "data" / "frozen.json"
    if fz.exists():
        fzd = json.loads(fz.read_text())
        frozen = {t: {"id": v["harness"]["id"], "hash": v["hash"], "generations": v.get("generations_run")}
                  for t, v in fzd.get("tracks", {}).items()}
    return {"storms": storm_catalog(), "hidden_pool": pool, "frozen": frozen, "store": _VERS.get("store"),
            "notebooks": [{k: v for k, v in x.items() if not k.startswith("_")} for x in vers.values()],
            "judge_storm": {"colder_c": [0, 9], "longer_x": [1, 3], "where": ["statewide", "west", "coast", "north"],
                            "surge": [0, 0.1], "freezing_rain": [False, True]}}


class CompareReq(BaseModel):
    storm_id: str | None = None          # a catalog storm, or ...
    custom: StormReq | None = None       # ... a judge-made storm
    left: str                            # notebook ids from /api/catalog
    right: str
    seed: int = 0
    fresh: bool = True                   # always ask the AI live (False reuses identical earlier answers: faster)


@app.post("/api/compare")
def compare(req: CompareReq):
    vers = _versions()
    if req.left not in vers or req.right not in vers:
        raise HTTPException(404, "unknown notebook")
    if req.custom is not None:
        c = req.custom
        scn = judge_storm(c.colder_c, c.longer_x, c.where, c.surge, c.freezing_rain, c.base)
        storm = {"id": scn.id, "label": "Judge's storm", "description": scn.description}
    elif req.storm_id:
        scn = req.storm_id
        storm = next((s for s in storm_catalog() if s["id"] == scn), None)
        if storm is None:
            raise HTTPException(404, "unknown storm")
    else:
        raise HTTPException(400, "pick a storm")
    mans = {"left": (vers[req.left]["_h"], vers[req.left]["_pages"]), "right": (vers[req.right]["_h"], vers[req.right]["_pages"])}
    run_id = uuid.uuid4().hex[:10]
    q: queue.Queue = queue.Queue()
    RUNS[run_id] = q
    # fast mode replays an identical earlier comparison (same storm, both notebook hashes, seed); fresh always runs
    key = hashlib.sha1(json.dumps([getattr(scn, "id", scn), mans["left"][0].hash(), mans["right"][0].hash(), req.seed]
                                  ).encode()).hexdigest()[:16]
    cached = CACHE / f"cmprun_{key}.json"
    reuse = not req.fresh and cached.exists()
    hours: list = []

    def on_hour(m):
        m = {"type": "hour", **{k: v for k, v in m.items() if k != "events"},
             "events": [{"type": e["type"], "actor": e["actor"], "text": e["text_plain"]} for e in m["events"]]}
        hours.append(m)
        q.put(m)

    def work():
        if reuse:
            d = json.loads(cached.read_text())
            for m in d["hours"]:
                q.put(m)
            q.put({"type": "done", **d["done"], "replayed": True})
            q.put(None)
            return
        try:
            res = run_live(scn, mans, on_hour, seed=req.seed, fresh=req.fresh)
            done = {"storm": storm, "seed": req.seed, "results": {}}
            for side, (r, pol) in res.items():
                rp = build_replay(r, label=vers[getattr(req, side)]["label"], scenario_public=storm["label"],
                                  harness={"id": mans[side][0].id, "hash": mans[side][0].hash()},
                                  model={"operator": "Qwen3-30B-A3B-Instruct-2507", "weights_frozen": True, "fine_tune_runs": 0})
                name = f"cmp_{run_id}_{side}_replay.json"
                (CACHE / name).write_text(json.dumps(rp))
                done["results"][side] = {"notebook": getattr(req, side), "passed": bool(r.passed), "verdict": r.verdict_plain,
                                         "collapsed": bool(r.collapsed), "homes_dark_hours": float(r.homes_dark_hours),
                                         "peak_shed_frac": float(r.peak_shed_frac), "min_freq": float(r.min_freq),
                                         "replay": name, "ai_calls": pol.ai_calls}
            cached.write_text(json.dumps({"hours": hours, "done": done}, default=float))
            q.put({"type": "done", **done})
        except Exception as e:  # surface the error on stage instead of hanging
            q.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
        q.put(None)

    threading.Thread(target=work, daemon=True).start()
    return {"run_id": run_id, "storm": storm, "left": vers[req.left]["label"], "right": vers[req.right]["label"],
            "replayed": reuse}


# ---------------------------------------------------------------------------------------------- record inspector
RECORD_COLLS = {"mutations", "events", "harness_versions", "manual_pages", "coach_metrics", "evolver_strategies",
                "scoreboard"}
_mongo: dict = {"c": None}


def _atlas():
    """The agent's own database user (harness_rw): it can read simdb and is denied the exam vault."""
    if _mongo["c"] is None:
        from pymongo import MongoClient
        _mongo["c"] = MongoClient(os.environ["MONGODB_URI_HARNESS"], serverSelectionTimeoutMS=25000, readPreference="primaryPreferred",
                                  appname="59.4-inspector")
    return _mongo["c"]


def _local_record(coll: str, rid: str):
    from harness.store import LocalStore
    for d in LocalStore().all(coll):
        body = {k: v for k, v in d.items() if k != "embedding"}
        if hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest() == rid:
            return d
    return None


@app.get("/api/record/{coll}/{rid}")
def record(coll: str, rid: str):
    """One stored record straight from Atlas by its _id; /api/record/vault/test_runs shows the vault refusing the AI."""
    t0 = time.time()
    if coll == "vault":
        from pymongo.errors import OperationFailure
        try:
            _atlas()["vault"]["test_runs"].find_one({}, {"_id": 1})
            return {"ok": True, "denied": False, "ms": round((time.time() - t0) * 1000)}
        except OperationFailure as e:
            return {"ok": False, "denied": True, "code": e.code, "user": "harness_rw", "db": "vault", "coll": "test_runs",
                    "error": (e.details or {}).get("errmsg", str(e)), "ms": round((time.time() - t0) * 1000)}
        except Exception as e:
            return {"ok": False, "denied": None, "error": type(e).__name__, "ms": round((time.time() - t0) * 1000)}
    if coll not in RECORD_COLLS:
        raise HTTPException(404, "unknown collection")
    try:
        d = _atlas()["simdb"][coll].find_one({"_id": rid}, {"embedding": 0})
    except Exception as e:            # say so, and show the identical local copy (same sha1 _id) instead
        return {"ok": False, "error": f"Atlas unreachable from this network ({type(e).__name__})",
                "local": _local_record(coll, rid), "ms": round((time.time() - t0) * 1000)}
    if d is None:
        return {"ok": False, "error": "not found in Atlas", "ms": round((time.time() - t0) * 1000)}
    return {"ok": True, "doc": json.loads(json.dumps(d, default=str)), "source": "atlas", "db": "simdb", "coll": coll,
            "ms": round((time.time() - t0) * 1000)}


@app.get("/api/ercot")
def ercot():
    if time.time() - _ercot["t"] > 30 or _ercot["d"] is None:
        _ercot["d"], _ercot["t"] = ercot_live.fetch(), time.time()
    return _ercot["d"]


@app.get("/api/manuals")
def list_manuals():
    return {k: {"id": h.id, "hash": h.hash(), "counts": h.counts(), "pages": len(p)} for k, (h, p) in manuals().items()}


@app.post("/api/storm")
def storm(req: StormReq):
    scn = judge_storm(req.colder_c, req.longer_x, req.where, req.surge, req.freezing_rain, req.base)
    mans = manuals()
    key = scn.id + "_" + "_".join(h.hash().split(":")[1][:8] for h, _ in mans.values()) + f"_{int(req.use_llm)}"
    run_id = uuid.uuid4().hex[:10]
    q: queue.Queue = queue.Queue()
    RUNS[run_id] = q
    cached = CACHE / f"{key}.json"

    def work():
        if cached.exists():                       # replay a storm that was already run (instant)
            d = json.loads(cached.read_text())
            for msg in d["hours"]:
                q.put(msg)
                time.sleep(0.02)
            q.put({"type": "done", **d["done"]})
            q.put(None)
            return
        hours = []

        def on_hour(m):
            m = {"type": "hour", **{k: v for k, v in m.items() if k != "events"},
                 "events": [{"type": e["type"], "actor": e["actor"], "text": e["text_plain"]} for e in m["events"]]}
            hours.append(m)
            q.put(m)

        try:
            res = run_live(scn, mans, on_hour, use_llm=req.use_llm)
            done = {"storm": {"id": scn.id, "description": scn.description}, "results": {}}
            for label, (r, pol) in res.items():
                rp = build_replay(r, label=label, scenario_public="Judge's storm", harness={"id": mans[label][0].id})
                rp_path = CACHE / f"{key}_{label}_replay.json"
                rp_path.write_text(json.dumps(rp))
                done["results"][label] = {"passed": bool(r.passed), "verdict": r.verdict_plain, "collapsed": bool(r.collapsed),
                                          "homes_dark_hours": float(r.homes_dark_hours), "peak_shed_frac": float(r.peak_shed_frac),
                                          "min_freq": float(r.min_freq), "replay": rp_path.name, "ai_calls": pol.ai_calls}
            cached.write_text(json.dumps({"hours": hours, "done": done}))
            q.put({"type": "done", **done})
        except Exception as e:  # surface the error on stage instead of hanging
            q.put({"type": "error", "error": f"{type(e).__name__}: {e}"})
        q.put(None)

    threading.Thread(target=work, daemon=True).start()
    return {"run_id": run_id, "storm": {"id": scn.id, "description": scn.description}, "cached": cached.exists()}


@app.get("/api/replay/{name}")
def replay(name: str):
    f = CACHE / Path(name).name
    if not f.exists() or not f.name.endswith("_replay.json"):
        raise HTTPException(404, "unknown replay")
    return json.loads(f.read_text())


@app.get("/api/stream/{run_id}")
def stream(run_id: str):
    q = RUNS.get(run_id)
    if q is None:
        raise HTTPException(404, "unknown run")

    def gen():
        while True:
            try:
                m = q.get(timeout=15)
            except queue.Empty:
                yield ": keep-alive\n\n"
                continue
            if m is None:
                RUNS.pop(run_id, None)
                return
            yield f"data: {json.dumps(m, default=float)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


if __name__ == "__main__":
    threading.Thread(target=_versions, daemon=True).start()      # warm the cache before the first screen asks
    uvicorn.run(app, host="0.0.0.0", port=8594, log_level="warning")
