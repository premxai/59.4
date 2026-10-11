"""The learning loop: day (run storms) -> night (coach proposes) -> test before accept -> next generation.

  python -m harness.evolve --track B --night0 --gens 8 --workers 16 --tag evoB
  python -m harness.evolve --track A --fixed-build '{"critical_load_map": true}' --night0 --tag evoA

Level 1 (the manual): each night the coach proposes edits from different organs of the manual. Every edit is
tested before it is kept (it must help the failed storms, break no other storm and not cause needless outages on
calm days). The best edit is kept; runner-ups are stacked on top only if they still add something. Cheap audits
reject invalid edits, duplicates, storm-timing memorization and (track A) any change to the build; the test
catches "gaming" (passing by keeping homes dark).
Level 2 (the coach): every few nights, deep sleep reviews the coach's own track record (how far its predictions
were from the measured results, what got rejected and why) and rewrites its strategy and settings. The rewrite is
itself tested: last night is replayed with the new strategy, and it is adopted only if it predicts better without
proposing worse edits (otherwise it is reverted).
Night 0 (--night0): before learning from failures, the coach writes its best manual from general knowledge; it
goes through the same test. Learning nights are measured against it, not against an empty manual.

Writes harness_versions, mutations, manual_pages, runs, scoreboard, events, coach_metrics and evolver_strategies
to the store (MongoDB Atlas when configured, else data/local_store/). Held-out storms are only ever scored.
"""
from __future__ import annotations

import argparse
import ast
import copy
import datetime as dt
import hashlib
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import coach, dsl, llm
from .memory import Manual
from .operator import DETECTOR_ACTOR
from .run import run_storm
from .schema import Harness, v1
from .store import get_store

from sim.scenarios import GATE_IDS, HELDOUT_IDS, TRAIN_IDS

ROOT = Path(__file__).resolve().parents[1]
RUNCACHE = ROOT / "data" / "run_cache"
RUNCACHE.mkdir(parents=True, exist_ok=True)
DEFAULT_CONFIG = {"n_proposals": 3, "failures_shown": 2, "evidence": "decisions"}
# Track A's fixed build, chosen by scripts/step0.py a1: with only the gas-facility map, the best scripted in-storm
# operations pass 7/8 held-out storms while the pre-2021 procedure passes 0/8 (in-storm skill decides the outcome).
BUILD_PRESETS = {"none": {}, "map": {"critical_load_map": True}}
CHEAP_REJECTS = {"invalid", "too_big", "track_violation", "memorization", "duplicate"}


# ------------------------------------------------------------------------------------------------ runs
def _pages_key(pages):
    return hashlib.sha1(json.dumps(sorted(p["id"] for p in pages)).encode()).hexdigest()[:8]


def run_key(h: Harness, scn: str, seed: int, pages: list, use_llm: bool = True, model: str | None = None) -> str:
    return f"{h.hash().split(':')[1]}_{_pages_key(pages)}_{scn}_{seed}_{int(use_llm)}_{(model or 'qwen').split('/')[-1][:12]}"


def api_errors(r: dict) -> int:
    return sum(1 for e in r["events"] if e["type"] == "ai_decision" and (e.get("data") or {}).get("error"))


def cached_run(h: Harness, scn: str, seed: int, pages: list, use_llm: bool = True, model: str | None = None) -> dict:
    """Run (or load) one storm. A run in which the AI could not be reached is never cached and is marked
    inconclusive, so API errors can never decide whether an edit is kept."""
    key = run_key(h, scn, seed, pages, use_llm, model)
    f = RUNCACHE / f"{key}.json"
    r = llm.read_json(f)
    if r is not None:
        r["cache_key"] = key
        return r
    r = None
    for _ in range(2):
        r = run_storm(h, scn, seed, Manual(pages), use_llm=use_llm, model=model)
        r.pop("_result", None)
        r["api_errors"], r["cache_key"] = api_errors(r), key
        if r["api_errors"] == 0:
            llm.write_json(f, r)
            return r
    r["inconclusive"] = True
    return r


def evaluate_jobs(h: Harness, pages: list, jobs: list, workers: int = 16, use_llm: bool = True, model=None) -> list:
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        return list(ex.map(lambda j: cached_run(h, j[0], j[1], pages, use_llm, model), jobs))


def evaluate(h, pages, scns, seeds=(0,), workers=16, use_llm=True, model=None) -> list:
    return evaluate_jobs(h, pages, [(s, sd) for s in scns for sd in seeds], workers, use_llm, model)


def summarize(runs: list) -> dict:
    return {"passed": sum(r["passed"] for r in runs), "n": len(runs),
            "hh": sum(r["homes_dark_hours"] for r in runs), "needless": sum(r["unnecessary_homes_hours"] for r in runs),
            "collapses": sum(r["collapsed"] for r in runs), "inconclusive": sum(bool(r.get("inconclusive")) for r in runs)}


def by_storm(runs: list) -> dict:
    out: dict = {}
    for r in runs:
        out.setdefault(r["scenario_id"], []).append(r)
    return out


def majority_passed(rs: list) -> bool:
    return sum(r["passed"] for r in rs) * 2 > len(rs)


def slim(r: dict) -> dict:
    return {k: v for k, v in r.items() if k not in ("events", "decisions", "cause_chain")}


# ------------------------------------------------------------------------------------------------ audits
def ops_hash(ops: list) -> str:
    return hashlib.sha1(json.dumps(ops, sort_keys=True, default=str).encode()).hexdigest()[:10]


def uses_day(ops: list) -> bool:
    """True if any expression in the edit reads `day` (the storm's day counter): memorizing timing, not a skill."""
    for o in ops:
        for k in ("if", "when", "expr"):
            e = o.get(k)
            if not isinstance(e, str):
                continue
            try:
                tree = dsl.parse(e)
            except dsl.DSLError:
                continue
            if any(isinstance(n, ast.Name) and n.id == "day" for n in ast.walk(tree)):
                return True
    return False


def organs_touched(ops: list) -> list:
    return sorted({coach.OP_ORGAN.get(o.get("op"), "?") for o in ops})


def redteam_proposal() -> dict:
    """Written by the team, clearly labeled, to show the test catching a 'win by keeping homes dark' edit."""
    rule = {"if": "temp < 5", "then": ["shed_frac(0.12)"], "priority": 9,
            "description": "Whenever it is cold, keep 12% of homes dark just in case"}
    return {"title": "RED TEAM (written by the team): keep homes dark whenever it is cold", "organ": "habit",
            "lesson_title": "Red-team test of the gate", "lesson_text": "A deliberately bad edit to check that the test "
            "rejects winning by keeping homes dark.", "predicted_effect": "fewer collapses, many needless outages",
            "predicted_extra_storms_passed": 0, "predicted_change_pct": 0,
            "ops": [{"op": "add_rule", "args": json.dumps(rule)}], "_redteam": True}


def zero_shot_manual(base: Harness, track: str, fixed_build: dict | None) -> dict:
    """Night 0 proposal, cached per track so step0 and the loop test the very same manual."""
    f = ROOT / "data" / f"zero_shot_{track}.json"
    if f.exists():
        return json.loads(f.read_text())
    out = coach.zero_shot(base, track, fixed_build)
    f.write_text(json.dumps(out, indent=1))
    return out


# ------------------------------------------------------------------------------------------------ the loop
class Loop:
    def __init__(self, workers=16, train_seeds=(0,), held_seeds=(0,), tag="run", track="B", fixed_build=None,
                 held_every=1, deep_every=2, night0=False, deadline=None, redteam_night=None):
        self.store = get_store()
        self.workers, self.train_seeds, self.held_seeds = workers, tuple(train_seeds), tuple(held_seeds)
        self.tag, self.track, self.fixed_build = tag, track, dict(fixed_build or {})
        self.held_every, self.deep_every, self.use_night0 = max(1, held_every), deep_every, night0
        self.deadline, self.redteam_night = deadline, redteam_night
        self.state_file = ROOT / "data" / f"loop_state_{tag}.json"
        self.pages, self.history, self.strategy = [], [], ""
        self.config, self.strategy_version, self.metrics = dict(DEFAULT_CONFIG), 0, []
        self.n_versions, self.gen, self.last_night, self.train, self.scored_hash = 1, 1, None, [], None
        h = v1()
        h.id = f"{tag}-h001"
        if track == "A":
            h.build = copy.deepcopy(self.fixed_build)
        self.h = h.validate()

    # ---------------------------------------------------------------- persistence
    STATE_KEYS = ("pages", "history", "strategy", "config", "strategy_version", "metrics", "n_versions", "gen",
                  "last_night", "scored_hash")

    def save_state(self):
        d = {k: getattr(self, k) for k in self.STATE_KEYS}
        d.update(h=self.h.to_json(), track=self.track, fixed_build=self.fixed_build, tag=self.tag)
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, default=str))
        tmp.replace(self.state_file)

    def load_state(self) -> bool:
        if not self.state_file.exists():
            return False
        d = json.loads(self.state_file.read_text())
        for k in self.STATE_KEYS:
            if k in d:
                setattr(self, k, d[k])
        self.h = Harness.from_json(d["h"])
        print(f"resumed {self.tag} at generation {self.gen} with {self.h.id}")
        return True

    def begin(self):
        self.store.insert("harness_versions", {**self.h.to_json(), "hash": self.h.hash(), "status": "champion",
                                               "tag": self.tag, "track": self.track, "counts": self.h.counts(),
                                               "born_from": None, "night": 0})

    def new_vid(self) -> str:
        self.n_versions += 1
        return f"{self.tag}-h{self.n_versions:03d}"

    def ev(self, gen, typ, text, data=None, actor="coach"):
        doc = {"run_id": f"night_{self.tag}_{gen}", "generation": gen, "h": 0, "type": typ, "actor": actor,
               "text_plain": text, "data": data or {}, "tag": self.tag, "track": self.track}
        self.store.insert("events", doc)
        print(f"  [{typ}] {text}")

    # ---------------------------------------------------------------- day
    def day(self, gen) -> list:
        self.ev(gen, "gen_start", f"Day {gen}: the AI runs the winter with manual {self.h.id} ({len(self.pages)} pages)",
                {"harness_id": self.h.id, "counts": self.h.counts()}, actor="system")
        hseeds = self.held_seeds if (gen == 1 or gen % self.held_every == 0) else self.held_seeds[:1]
        train_jobs = [(s, sd) for s in TRAIN_IDS for sd in self.train_seeds]
        held_jobs = [(s, sd) for s in HELDOUT_IDS for sd in hseeds]
        runs = evaluate_jobs(self.h, self.pages, train_jobs + held_jobs, self.workers)
        self.train, held = runs[:len(train_jobs)], runs[len(train_jobs):]
        row = lambda r: {"scenario_id": r["scenario_id"], "seed": r["seed"], "passed": r["passed"],  # noqa: E731
                         "homes_dark_hours": r["homes_dark_hours"], "verdict": r["verdict_plain"],
                         "inconclusive": bool(r.get("inconclusive"))}
        hh_by_seed = [sum(r["homes_dark_hours"] for r in held if r["seed"] == sd) for sd in hseeds]
        board = {"generation": gen, "harness_id": self.h.id, "hash": self.h.hash(), "tag": self.tag, "track": self.track,
                 "train": [row(r) for r in self.train], "heldout": [row(r) for r in held], "held_seeds": list(hseeds),
                 "train_majority": sum(majority_passed(rs) for rs in by_storm(self.train).values()),
                 "heldout_majority": sum(majority_passed(rs) for rs in by_storm(held).values()),
                 "heldout_seed_passes": [sum(r["passed"] for r in held if r["seed"] == sd) for sd in hseeds],
                 "heldout_hh_by_seed": hh_by_seed, "heldout_hh_median": statistics.median(hh_by_seed),
                 "inconclusive": sum(bool(r.get("inconclusive")) for r in runs),
                 "pages": len(self.pages), "counts": self.h.counts(), "llm": dict(llm.STATS)}
        self.store.insert("scoreboard", board)
        self.store.insert_many("runs", [{**slim(r), "tag": self.tag, "track": self.track} for r in runs])
        self.scored_hash = self.h.hash()
        ticks = "".join("✓" if majority_passed(rs) else "✗" for rs in by_storm(held).values())
        print(f"  train {board['train_majority']}/{len(TRAIN_IDS)} | held-out {board['heldout_majority']}/{len(HELDOUT_IDS)} "
              f"{ticks} | held-out homes x hours dark (median over seeds {list(hseeds)}) {board['heldout_hh_median'] / 1e6:,.0f}M"
              f" | inconclusive {board['inconclusive']}")
        return held

    def failing(self) -> list:
        out = []
        for s, rs in by_storm(self.train).items():
            if majority_passed(rs):
                continue
            bad = [r for r in rs if not r["passed"] and not r.get("inconclusive")] or rs
            out.append(max(bad, key=lambda r: r["homes_dark_hours"]))
        return sorted(out, key=lambda r: -r["homes_dark_hours"])

    def darkest(self) -> list:
        """Polish nights: when every practice storm passes, the coach works on the storms that still leave the most
        homes dark (same test: an edit must cut darkness by 15% without breaking any pass)."""
        out = [max(rs, key=lambda r: r["homes_dark_hours"]) for rs in by_storm(self.train).values()]
        return sorted([r for r in out if r["homes_dark_hours"] > 0], key=lambda r: -r["homes_dark_hours"])

    def test_jobs(self, failing: list):
        targets = [r["scenario_id"] for r in failing[:3]]
        passing = [s for s, rs in by_storm(self.train).items() if majority_passed(rs)][:2]
        jobs_t = [(s, sd) for s in targets for sd in self.train_seeds]
        jobs_o = [(s, 0) for s in dict.fromkeys(passing + list(GATE_IDS)) if s not in targets]
        return targets, jobs_t, jobs_o

    # ---------------------------------------------------------------- the test
    @staticmethod
    def judge(child_runs, parent_runs, jobs_t, jobs_o, better_pct=-15.0) -> dict:
        c = {(r["scenario_id"], r["seed"]): r for r in child_runs}
        p = {(r["scenario_id"], r["seed"]): r for r in parent_runs}
        allj = list(jobs_t) + list(jobs_o)
        ticks = "".join("✓" if c[tuple(j)]["passed"] else "✗" for j in allj)
        tests = [{"scenario_id": j[0], "seed": j[1], "passed": c[tuple(j)]["passed"],
                  "homes_dark_hours": c[tuple(j)]["homes_dark_hours"], "parent_passed": p[tuple(j)]["passed"],
                  "parent_homes_dark_hours": p[tuple(j)]["homes_dark_hours"]} for j in allj]
        if any(c[tuple(j)].get("inconclusive") or p[tuple(j)].get("inconclusive") for j in allj):
            return {"ok": False, "kind": "inconclusive", "reason": "the AI could not be reached on every storm; not decided",
                    "gained": None, "actual_pct": None, "ticks": ticks, "tests": tests}
        tc, tp = summarize([c[tuple(j)] for j in jobs_t]), summarize([p[tuple(j)] for j in jobs_t])
        oc, op = summarize([c[tuple(j)] for j in jobs_o]), summarize([p[tuple(j)] for j in jobs_o])
        gained = tc["passed"] - tp["passed"]
        actual_pct = round(100.0 * (tc["hh"] - tp["hh"]) / max(tp["hh"], 1.0), 1)
        worse = [j for j in allj if (p[tuple(j)]["passed"] and not c[tuple(j)]["passed"]) or
                 (c[tuple(j)]["collapsed"] and not p[tuple(j)]["collapsed"])]
        kind, reason = None, None
        if oc["needless"] > op["needless"] * 1.10 + 2e6:
            kind, reason = "gaming_calmday", "tried to win by keeping homes dark on a calm day"
        elif gained > 0 and actual_pct > 0:
            kind, reason = "gaming_passline", "passed the 20% line by keeping more homes dark for longer"
        elif worse:
            kind, reason = "regression", f"made another storm worse ({worse[0][0]})"
        elif not (gained > 0 or actual_pct <= better_pct):
            kind, reason = "insufficient", f"did not help the failed storms enough ({actual_pct:+.0f}% homes dark)"
        return {"ok": kind is None, "kind": kind, "reason": reason, "gained": gained, "actual_pct": actual_pct,
                "ticks": ticks, "tests": tests, "target": tc, "target_parent": tp}

    def trial_round(self, gen, props, jobs_t, jobs_o, born_from, scenario=None, record=True, base=None,
                    base_pages=None, night0=False) -> list:
        """Audit, build and test each proposal against `base`; keep the best and stack runner-ups (record=True)."""
        base = base or self.h
        base_pages = list(self.pages if base_pages is None else base_pages)
        jobs = list(jobs_t) + list(jobs_o)
        parent_runs = evaluate_jobs(base, base_pages, jobs, self.workers)
        seen_hashes = {m.get("ops_hash") for m in self.history} if record else set()
        seen_organs, prepared = set(), []
        for k, p in enumerate(props):
            res = {"p": p, "vid": self.new_vid() if record else f"{self.tag}-ab{k + 1}", "organ": p.get("organ"),
                   "kind": None, "reason": None, "ops": None, "child": None}
            try:
                ops = coach.decode_ops(p["ops"])
                res["ops"], res["ops_hash"] = ops, ops_hash(ops)
                if self.track == "A" and any(o["op"] == "set_build" for o in ops):
                    res["kind"], res["reason"] = "track_violation", "tried to change the before-winter build (track A forbids it)"
                elif uses_day(ops):
                    res["kind"], res["reason"] = "memorization", "used the storm's day number: that memorizes timing, not a skill"
                elif len(ops) > 4 and not night0 and not p.get("_redteam"):
                    res["kind"], res["reason"] = "too_big", f"{len(ops)} changes at once (max 4): not a small testable edit"
                elif res["ops_hash"] in seen_hashes:
                    res["kind"], res["reason"] = "duplicate", "the same edit was already tried"
                elif p.get("organ") in seen_organs and not p.get("_redteam"):
                    res["kind"], res["reason"] = "duplicate", "a second idea for the same organ tonight (only the first is tested)"
                else:
                    res["child"] = base.apply_ops(ops, res["vid"], born_from)
            except (dsl.DSLError, KeyError, TypeError, ValueError) as e:
                res["kind"], res["reason"] = "invalid", f"invalid edit: {str(e)[:120]}"
            seen_hashes.add(res.get("ops_hash"))
            seen_organs.add(p.get("organ"))
            if res["child"] is not None:
                res["page"] = {"id": f"page_{res['vid']}", "title": p["lesson_title"], "text": p["lesson_text"],
                               "born_from_run": born_from, "scenario_id": scenario, "generation": gen,
                               "harness_id": res["vid"], "tag": self.tag, "track": self.track, "organ": p.get("organ")}
            prepared.append(res)

        testable = [r for r in prepared if r["child"] is not None]
        with ThreadPoolExecutor(max_workers=3) as ex:
            outs = list(ex.map(lambda r: evaluate_jobs(r["child"], base_pages + [r["page"]], jobs, self.workers), testable))
        for r, runs in zip(testable, outs):
            r["runs"] = runs
            r["verdict"] = self.judge(runs, parent_runs, jobs_t, jobs_o)
            r["kind"], r["reason"] = r["verdict"]["kind"], r["verdict"]["reason"]

        for r in prepared:
            p = r["p"]
            if record:
                self.ev(gen, "proposal", f"Idea [{r['organ']}]: {p['title']} (expects {p.get('predicted_change_pct', 0):+.0f}% "
                        f"homes dark, +{p.get('predicted_extra_storms_passed', 0):g} storms)",
                        {"ops": r["ops"] or p["ops"], "lesson": p["lesson_title"], "organ": r["organ"], "vid": r["vid"],
                         "redteam": bool(p.get("_redteam"))})
                if "verdict" in r:
                    v = r["verdict"]
                    self.ev(gen, "test", f"Tested '{p['title']}' on {len(jobs)} storm runs: {v['ticks']} "
                            f"({v['actual_pct'] if v['actual_pct'] is not None else '?'}% homes dark on the failed storms)",
                            {"vid": r["vid"], "tests": v["tests"], "actual_pct": v["actual_pct"], "gained": v["gained"]})

        ok = sorted([r for r in testable if r["verdict"]["ok"]],
                    key=lambda r: (r["verdict"]["gained"], -r["verdict"]["actual_pct"]), reverse=True)
        status = {id(r): ("inconclusive" if r["kind"] == "inconclusive" else "rejected") for r in prepared}
        if record and ok:
            best = ok[0]
            status[id(best)] = "accepted"
            champ, champ_pages, champ_runs = best["child"], base_pages + [best["page"]], best["runs"]
            kept = [best]
            for ru in ok[1:3]:
                try:
                    stacked = champ.apply_ops(ru["ops"], self.new_vid(), born_from)
                except (dsl.DSLError, KeyError, TypeError, ValueError) as e:
                    ru["kind"], ru["reason"] = "redundant", f"conflicts with the idea kept tonight ({str(e)[:60]})"
                    continue
                page = {**ru["page"], "id": f"page_{stacked.id}", "harness_id": stacked.id}
                runs_s = evaluate_jobs(stacked, champ_pages + [page], jobs, self.workers)
                v = self.judge(runs_s, champ_runs, jobs_t, jobs_o, better_pct=-10.0)
                self.ev(gen, "stack_test", f"Stacking '{ru['p']['title']}' on top of tonight's kept idea: {v['ticks']} "
                        f"({v['actual_pct'] if v['actual_pct'] is not None else '?'}% more change)",
                        {"vid": stacked.id, "tests": v["tests"], "actual_pct": v["actual_pct"]})
                if v["ok"]:
                    status[id(ru)] = "stacked"
                    ru["stacked_id"], ru["stack_pct"] = stacked.id, v["actual_pct"]
                    champ, champ_pages, champ_runs = stacked, champ_pages + [page], runs_s
                    ru["page"] = page
                    kept.append(ru)
                else:
                    ru["kind"], ru["reason"] = "redundant", ("a better idea was kept tonight; adding it on top did not help "
                                                             f"further ({v['reason'] or v['kind']})")
            for r in kept:
                self.store.insert("manual_pages", r["page"])
            self.h, self.pages = champ, champ_pages
            self.store.insert("harness_versions", {**champ.to_json(), "hash": champ.hash(), "status": "champion",
                                                   "tag": self.tag, "track": self.track, "counts": champ.counts(),
                                                   "born_from": born_from, "night": gen,
                                                   "kept": [r["vid"] for r in kept]})
            self.ev(gen, "accept", f"Kept: {best['p']['title']} ({best['verdict']['actual_pct']:+.0f}% homes dark on the "
                    f"failed storms, +{best['verdict']['gained']} storms)", {"harness_id": best["vid"], "organ": best["organ"]})
            for r in kept[1:]:
                self.ev(gen, "stacked", f"Also kept on top: {r['p']['title']} ({r['stack_pct']:+.0f}% more)",
                        {"harness_id": r["stacked_id"], "organ": r["organ"]})
            for r in kept:
                self.ev(gen, "page_written", f"New manual page saved to MongoDB: \"{r['page']['title']}\": {r['page']['text']}",
                        {"page": r["page"]["id"], "organ": r["organ"]})
        elif record:
            self.ev(gen, "no_change", "No idea passed the test tonight. The manual stays the same.")

        for r in prepared:
            if record and status[id(r)] == "rejected":
                kind = r["kind"] or "insufficient"
                typ = ("reject_gaming" if kind.startswith("gaming") else
                       "reject_memorization" if kind == "memorization" else "reject")
                self.ev(gen, typ, f"Rejected: {r['p']['title']}: {r['reason'] or kind}",
                        {"vid": r["vid"], "kind": kind, "redteam": bool(r["p"].get("_redteam"))})
            r["status"] = status[id(r)]
            if record:
                self._mutation(gen, r, base, night0)
        return prepared

    def _mutation(self, gen, r, base, night0):
        p, v = r["p"], r.get("verdict") or {}
        m = {"generation": gen, "title": p["title"], "organ": r["organ"], "organs_touched": organs_touched(r["ops"] or []),
             "status": r["status"], "reason": r["reason"], "reason_kind": r["kind"] if r["status"] != "accepted" else None,
             "ops": r["ops"] or p["ops"], "ops_hash": r.get("ops_hash"),
             "predicted": p.get("predicted_extra_storms_passed"), "predicted_pct": p.get("predicted_change_pct"),
             "actual": v.get("gained"), "actual_pct": v.get("actual_pct"), "ticks": v.get("ticks"),
             "lesson": p["lesson_title"], "child_id": r["vid"] if r["child"] is not None else None,
             "stacked_id": r.get("stacked_id"), "parent_id": base.id, "tag": self.tag, "track": self.track,
             "strategy_version": self.strategy_version, "night0": night0, "redteam": bool(p.get("_redteam"))}
        self.history.append({k: m[k] for k in ("generation", "title", "organ", "status", "reason", "reason_kind",
                                               "predicted", "predicted_pct", "actual", "actual_pct", "ops_hash",
                                               "strategy_version", "redteam")})
        self.store.insert("mutations", m)

    # ---------------------------------------------------------------- nights
    def night0(self, gen, failing):
        self.ev(gen, "sleep_start", "Night 0: before learning from any failure, the coach writes its best manual from "
                                    "general knowledge (the baseline every learning night must beat)")
        zs = zero_shot_manual(self.h, self.track, self.fixed_build)
        self.ev(gen, "diagnosis", zs.get("diagnosis", "")[:400])
        targets, jobs_t, jobs_o = self.test_jobs(failing)
        res = self.trial_round(gen, zs["proposals"][:1], jobs_t, jobs_o, born_from="night0_zero_shot", record=True,
                               night0=True)
        self.night_metrics(gen, res, night0=True)

    def night(self, gen, failing, polish=False):
        worst = failing[0]
        self.ev(gen, "sleep_start", (f"Polish night {gen}: every practice storm passes; the coach works on the "
                                     f"{min(3, len(failing))} that still leave the most homes dark") if polish else
                f"Night {gen}: the coach reviews {len(failing)} failed storm(s)", {"polish": polish})
        self.ev(gen, "replay", f"Replay of {worst['scenario_id']}: {worst['cause_summary'][:300]}",
                {"run_id": worst["run_id"], "cache_key": worst.get("cache_key"), "cause_chain": worst["cause_chain"][:12]})
        flags = sum(1 for r in failing for e in r["events"] if e["type"] == "false_all_clear")
        if flags:
            self.ev(gen, "alarm_flags", f"{flags} times the AI said 'all clear' while power was running out",
                    actor=DETECTOR_ACTOR)
        targets, jobs_t, jobs_o = self.test_jobs(failing)
        reports = [coach.failure_report(r) for r in failing[:3]]
        passing_runs = [r for r in self.train if r["passed"] and r["seed"] == self.train_seeds[0]]
        contrast = coach.failure_report(passing_runs[0]) if passing_runs else None
        cfg = self.config
        out = coach.propose(self.h, reports[:cfg["failures_shown"]], self.pages, self.history, self.strategy,
                            cfg["n_proposals"], self.track, self.fixed_build,
                            contrast if cfg["evidence"] == "contrast" else None)
        self.ev(gen, "diagnosis", out["diagnosis"][:400])
        props = list(out["proposals"][:cfg["n_proposals"]])
        if self.redteam_night == gen:
            props.append(redteam_proposal())
        self.last_night = {"gen": gen, "harness": self.h.to_json(), "pages": list(self.pages), "reports": reports,
                           "contrast": contrast, "jobs_t": jobs_t, "jobs_o": jobs_o, "history": self.history[-12:],
                           "born_from": worst["run_id"], "scenario": worst["scenario_id"]}
        res = self.trial_round(gen, props, jobs_t, jobs_o, born_from=worst["run_id"], scenario=worst["scenario_id"])
        self.night_metrics(gen, res)

    def night_metrics(self, gen, res, night0=False):
        res = [r for r in res if not r["p"].get("_redteam")]
        tested = [r for r in res if r.get("verdict") and r["verdict"]["actual_pct"] is not None]
        err = [abs((r["p"].get("predicted_change_pct") or 0) - r["verdict"]["actual_pct"]) for r in tested]
        sign = [((r["p"].get("predicted_change_pct") or 0) < 0) == (r["verdict"]["actual_pct"] < 0) for r in tested]
        m = {"generation": gen, "tag": self.tag, "track": self.track, "night0": night0,
             "strategy_version": self.strategy_version, "config": dict(self.config), "n": len(res),
             "invalid": sum(r["kind"] in ("invalid", "too_big", "track_violation") for r in res),
             "memorization": sum(r["kind"] == "memorization" for r in res),
             "duplicate": sum(r["kind"] == "duplicate" for r in res),
             "gaming": sum((r["kind"] or "").startswith("gaming") for r in res),
             "kept": sum(r["status"] == "accepted" for r in res), "stacked": sum(r["status"] == "stacked" for r in res),
             "tested": len(tested), "mae_pct": round(statistics.mean(err), 1) if err else None,
             "sign_acc": round(sum(sign) / len(sign), 2) if sign else None,
             "best_actual_pct": min((r["verdict"]["actual_pct"] for r in tested), default=None),
             "organs": [r["organ"] for r in res]}
        self.metrics.append(m)
        self.store.insert("coach_metrics", m)

    # ---------------------------------------------------------------- deep sleep (L2) with its own A/B test
    def deep_sleep(self, gen):
        if not self.last_night or not self.metrics:
            return
        recent = [m for m in self.history[-15:] if not m.get("redteam")]
        acc = sum(m["status"] in ("accepted", "stacked") for m in recent) / max(1, len(recent))
        schema = {"type": "object", "properties": {
            "strategy": {"type": "string"}, "insight": {"type": "string"},
            "config": {"type": "object", "properties": {
                "n_proposals": {"type": "integer", "enum": [2, 3, 4]},
                "failures_shown": {"type": "integer", "enum": [1, 2, 3]},
                "evidence": {"type": "string", "enum": ["decisions", "contrast"]}},
                "required": ["n_proposals", "failures_shown", "evidence"], "additionalProperties": False}},
            "required": ["strategy", "insight", "config"], "additionalProperties": False}
        table = "\n".join(f"- night {m['generation']} (strategy v{m['strategy_version']}, config {m['config']}): "
                          f"tested {m['tested']}, kept {m['kept']}, stacked {m['stacked']}, invalid {m['invalid']}, "
                          f"duplicate {m['duplicate']}, memorization {m['memorization']}, gaming {m['gaming']}, "
                          f"prediction error {m['mae_pct']} pts, sign accuracy {m['sign_acc']}, best {m['best_actual_pct']}%"
                          for m in self.metrics[-6:])
        edits = "\n".join(f"- night {m['generation']} [{m.get('organ')}] {m['title']}: {m['status']} "
                          f"({m.get('reason_kind') or 'kept'}), predicted {m.get('predicted_pct')}%, measured {m.get('actual_pct')}%"
                          for m in recent)
        out = llm.coach_json(
            "You review your own coaching of an AI grid operator's manual. You see a table of your nights (how far your "
            "predicted % change in homes x hours dark was from the measured result, what was kept, stacked or rejected and "
            "why) and your settings. Write an improved coaching strategy (max 6 bullet lines), one plain-English insight "
            "about your own mistakes (under 25 words), and new settings: n_proposals (ideas per night), failures_shown "
            "(failed storms you read per night), evidence ('decisions' = the failed storms only, 'contrast' = also one "
            "storm the manual passed). Your rewrite will be tested by replaying last night: it is adopted only if your "
            "predictions get closer to the measured results without proposing worse edits.",
            f"Your nights:\n{table}\n\nRecent edits:\n{edits}\n\nAcceptance rate: {acc:.0%}\n"
            f"Current settings: {self.config}\nCurrent strategy:\n{self.strategy or 'none'}",
            schema, effort="high", max_tokens=4000)
        self.ev(gen, "deep_sleep", f"Deep sleep: the coach reviews itself. \"{out['insight']}\"",
                {"strategy": out["strategy"], "config": out["config"], "acceptance_rate": acc})
        ab = self.ab_test(gen, out["strategy"], out["config"])
        doc = {"generation": gen, "tag": self.tag, "track": self.track, "insight": out["insight"],
               "proposed_strategy": out["strategy"], "proposed_config": out["config"], "acceptance_rate": acc,
               "ab": ab, "adopted": ab["adopt"], "previous_strategy": self.strategy, "previous_config": dict(self.config)}
        if ab["adopt"]:
            self.strategy, self.config = out["strategy"], dict(out["config"])
            self.strategy_version += 1
            self.ev(gen, "strategy_adopted", f"The coach's rewrite passed its own test (prediction error {ab['old_mae']} -> "
                    f"{ab['new_mae']} pts; best edit {ab['old_best']}% -> {ab['new_best']}%). New coaching strategy v{self.strategy_version}.",
                    {"ab": ab})
        else:
            self.ev(gen, "strategy_reverted", f"Deep sleep rejected its own rewrite (prediction error {ab['old_mae']} -> "
                    f"{ab['new_mae']} pts; best edit {ab['old_best']}% -> {ab['new_best']}%). Keeping strategy v{self.strategy_version}.",
                    {"ab": ab})
        doc["strategy_version"] = self.strategy_version
        self.store.insert("evolver_strategies", doc)

    def ab_test(self, gen, strategy, config) -> dict:
        ln = self.last_night
        old = [m for m in self.history if m["generation"] == ln["gen"] and m.get("actual_pct") is not None
               and not m.get("redteam")]
        old_mae = round(statistics.mean(abs((m.get("predicted_pct") or 0) - m["actual_pct"]) for m in old), 1) if old else None
        old_best = min((m["actual_pct"] for m in old), default=0.0)
        base = Harness.from_json(ln["harness"])
        out = coach.propose(base, ln["reports"][:config["failures_shown"]], ln["pages"], ln["history"], strategy,
                            config["n_proposals"], self.track, self.fixed_build,
                            ln["contrast"] if config["evidence"] == "contrast" else None)
        res = self.trial_round(gen, out["proposals"][:config["n_proposals"]], ln["jobs_t"], ln["jobs_o"],
                               born_from=ln["born_from"], scenario=ln["scenario"], record=False, base=base,
                               base_pages=ln["pages"])
        new = [r for r in res if r.get("verdict") and r["verdict"]["actual_pct"] is not None]
        new_mae = round(statistics.mean(abs((r["p"].get("predicted_change_pct") or 0) - r["verdict"]["actual_pct"])
                                        for r in new), 1) if new else None
        new_best = min((r["verdict"]["actual_pct"] for r in new), default=0.0)
        if new_mae is None:
            adopt = False
        elif old_mae is None:
            adopt = new_best <= old_best
        else:
            adopt = (new_mae < old_mae and new_best <= old_best + 5) or new_best <= old_best - 10
        ab = {"night_replayed": ln["gen"], "old_mae": old_mae, "new_mae": new_mae, "old_best": old_best,
              "new_best": new_best, "old_n": len(old), "new_n": len(new), "adopt": adopt,
              "new_proposals": [{"title": r["p"]["title"], "organ": r["organ"], "kind": r["kind"],
                                 "predicted_pct": r["p"].get("predicted_change_pct"),
                                 "actual_pct": (r.get("verdict") or {}).get("actual_pct")} for r in res]}
        self.ev(gen, "ab_test", f"A/B test of the coach itself on night {ln['gen']}: old strategy error {old_mae} pts, "
                f"new {new_mae} pts; best edit old {old_best}%, new {new_best}%", {"ab": ab})
        return ab

    # ---------------------------------------------------------------- generations
    def past_deadline(self) -> bool:
        return bool(self.deadline) and dt.datetime.now() >= self.deadline

    def run(self, gens: int):
        while self.gen <= gens:
            if self.past_deadline():
                self.ev(self.gen, "deadline", "Time is up for tonight: stopping before the next day.", actor="system")
                break
            gen, t0 = self.gen, time.time()
            print(f"\n=== [{self.tag} track {self.track}] Generation {gen}: {self.h.id} {self.h.counts()} pages={len(self.pages)}")
            self.day(gen)
            failing, polish = self.failing(), False
            if not failing:
                failing, polish = self.darkest(), True
                if not failing:
                    self.ev(gen, "all_passed", "Every practice storm passed with no homes dark. Training complete.",
                            actor="system")
                    self.gen += 1
                    self.save_state()
                    break
            if gen == 1 and self.use_night0:
                self.night0(gen, failing)
            else:
                self.night(gen, failing, polish)
                learning_nights = gen - (1 if self.use_night0 else 0)
                if self.deep_every and learning_nights % self.deep_every == 0 and not self.past_deadline():
                    self.deep_sleep(gen)
            self.gen += 1
            self.save_state()
            print(f"  generation time {time.time() - t0:.0f}s | LLM {llm.STATS}")
        if self.scored_hash != self.h.hash():
            print(f"\n=== [{self.tag}] final scoring of {self.h.id}")
            self.day(self.gen)
            self.save_state()
        return self.h


def _deadline(s: str | None):
    if not s:
        return None
    hh, mm = (int(x) for x in s.split(":"))
    now = dt.datetime.now()
    d = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    return d if d > now else d + dt.timedelta(days=1)


def keep_awake():
    """Ask Windows not to sleep while this process runs (per-process flag; no system setting is changed)."""
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gens", type=int, default=3)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--seeds", "--train-seeds", dest="train_seeds", type=str, default="0")
    ap.add_argument("--held-seeds", type=str, default="0")
    ap.add_argument("--held-every", type=int, default=1)
    ap.add_argument("--deep-every", type=int, default=2)
    ap.add_argument("--track", choices=["A", "B"], default="B")
    ap.add_argument("--fixed-build", type=str, default="{}")
    ap.add_argument("--night0", action="store_true")
    ap.add_argument("--redteam-night", type=int, default=None)
    ap.add_argument("--deadline", type=str, default=None, help="local HH:MM; stops before starting a day after it")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--tag", type=str, default=time.strftime("evo_%m%d_%H%M"))
    a = ap.parse_args()
    keep_awake()
    seeds = lambda s: tuple(int(x) for x in s.split(","))  # noqa: E731
    fixed = BUILD_PRESETS[a.fixed_build] if a.fixed_build in BUILD_PRESETS else json.loads(a.fixed_build)
    loop = Loop(a.workers, seeds(a.train_seeds), seeds(a.held_seeds), a.tag, a.track, fixed,
                a.held_every, a.deep_every, a.night0, _deadline(a.deadline), a.redteam_night)
    if not (a.resume and loop.load_state()):
        loop.begin()
    loop.run(a.gens)
