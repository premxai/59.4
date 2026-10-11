# 59.4: a frozen AI learns to keep Texas lit by rewriting its own operating manual

> In February 2021 the Texas grid's frequency stayed below **59.4 Hz** for 4 minutes 23 seconds. At nine minutes,
> generators trip and the whole state goes dark. It came within 4 minutes 37 seconds of that.

**59.4** is a self-improving harness. The model never changes: a frozen open-weights operator (Qwen3-30B, never
fine-tuned) runs a simulated Texas grid through winter storms. Every night a coach (Claude) reads why the grid failed,
writes small edits to the operator's **notebook** (its harness), and **tests each edit before keeping it**. Every two
nights the coach reviews its own coaching, and that rewrite is A/B-tested too.

Built for the MongoDB *Harness Engineering & Model Wrangling* hackathon (SF Tech Week, 2026-10-11).

**Live site: https://59-4.vercel.app** (the Evidence site: every notebook version, night, trace and record; live runs
need the AI and simulator on the demo laptop, see *Run it*).

| Same AI, never retrained | Unseen storms passed (each storm = 3 random versions; ✓ when 2 of 3 survive) | Homes in the dark |
|---|---|---|
| Day 1 notebook | ✗✗✗✗✗✗✗✗ **0/8** | 4.9 B home-hours |
| Claude's own best guess (no learning) | ✗✗✗✗✗✗✗✗ **0/8** | 0.6 B |
| After Night 3 | ✓✓✓✓✗✓✓✓ **7/8** | 0.32 B |
| After Night 5 (best) | ✓✓✓✓✓✓✓✓ **8/8** | 0.29 B |
| After Night 6: final frozen notebook (what we report) | ✓✓✓✓✗✓✗✓ **6/8** | 0.32 B (−93%) |

## The problem statement, word for word
*"A self-improving harness that evolves its own rules, context policies, guardrails, tool access."*

| Statement | The notebook organ that evolves |
|---|---|
| rules | **Habits**: `if <condition> then <actions>` every hour, e.g. *bring homes back in steps once reserves recover* |
| context policies | **What the AI sees and remembers**: which readings and forecast are in its briefing, and how many lesson pages it recalls from MongoDB |
| guardrails | **Hard limits**, enforced after the AI decides, e.g. *keep gas facilities powered while cutting load* |
| tool access | **What the AI decides**: which levers are the AI's own call, and how often it is asked |
| (plus) | **Gauges & alarms** (new sensors, when to wake the AI) and **winter prep** (Track B only) |

Long-horizon: Night 0 plus 15 learning nights for Track A, Night 0 plus 6 for Track B (its storms run slower; Night 7 hit the morning deadline), memory in MongoDB, optimized against a hard metric from a locked simulator.

## How it works
```
DAY    the frozen operator runs 9 practice storms x 2 seeds (+ 8 unseen storms x 3 seeds, scored only)
NIGHT  coach (Claude Opus 5.5) reads the physics cause chain + the AI's own decisions and reasons
       -> 3 ideas, each from a different organ, each with a predicted effect
TEST   each idea becomes a notebook version and reruns the failed storms + passing storms + 3 real calm days
       kept only if: failed storms improve (a pass, or >=15% fewer homes dark), nothing else gets worse,
       and calm days stay calm. Runner-ups are stacked on top only if they still add >=10%.
AUDITS rejected outright: memorizing storm timing (`day`), changing equipment in Track A, oversized edits,
       duplicates; after testing: "won by keeping homes dark on a calm day" / "passed the 20% line by keeping
       more homes dark for longer"
DEEP SLEEP (every 2 nights, the recursive part): the coach gets its own report card (prediction error, what got
       rejected and why) and rewrites its strategy + settings. The rewrite is A/B tested by replaying the last night;
       adopted only if it predicts better without proposing worse edits, else reverted.
```
- **Night 0**: before learning from any failure, Claude writes its best manual from general knowledge. It goes through
  the same test, so every learning night is measured against Claude's prior knowledge, not an empty notebook.
- **Two tracks**: **A** may only change what the operator does during the storm (equipment fixed to a gas-facility map);
  **B** may also change before-winter preparation.

## Results (honest)
- **Track B**: 0/8 → 7/8 → 8/8 at its best, final frozen notebook 6/8 on unseen storms (3 seeds each). Practice 9/9.
  Kept: *spend winter money where freezing hurts*, *big outages with big reserves unwind* ("darkness without a power
  shortage is a failure, not safety"), *freeze-proof the plants that froze*, *fund freeze-proofing before backup fuel*,
  *protect wind turbines from icing*. **Tear-out**: remove the learned winter prep → 6/8 → 0/8, 3x more homes dark.
  Most of Track B's gain is preparation; Track A isolates in-storm skill.
- **Track A** (in-storm only): 0/8 passes throughout, but homes in the dark fell **4.9 B → 0.79 B (−84%)**.
  Tear-out surprise: removing one learned habit gives 5/8 passes but 1.7x more darkness. The test rewarded total
  darkness while "pass" is the single worst hour; we report the trade-off rather than hide it.
- **Cheating caught**: 7 of the coach's own ideas rejected as gaming (6 "kept homes dark on a calm day", 1 "passed
  the 20% line by keeping more homes dark longer"), plus one labelled red-team edit.
- **The coach improving the coach**: 9 deep sleeps, 6 rewrites adopted, 3 reverted by their own A/B test.
  Prediction error 39.2 → 6.5 pts (B), 20.4 → 1.8 and 6.6 → 1.1 pts (A). A trend on few data points, not a proof.
- **Locked 2021 exam** (real Feb 2021 weather, anonymized, unmodified; pre-registered `9d4928916c7a9b9e`, run once
  after freezing, 3 seeds each, 0 API errors, rows in the vault and `data/locked_results.json`):

  | Config (median of 3 seeds) | Passed | Collapses | Home-hours dark | Worst hour dark |
  |---|---|---|---|---|
  | Day-1 notebook | 0/3 | 1 (10 min below 59.4 Hz) | 1.25 B | 100% |
  | Day-1, AI told "this is Uri, Feb 2021" | 0/3 | 0 | 1.21 B | 98% |
  | Track A frozen notebook | 0/3 | 0 | 0.26 B (−79%) | 41% |
  | Track A notebook, AI unplugged | 0/3 | 0 | 0.27 B | 41% |
  | **Track B frozen notebook** | 0/3 | 0 | **0.135 B (−89%)** | 30% |
  | Track B notebook, AI unplugged | 0/3 | 0 | 0.205 B | 31% |
  | Gemma-3-27B, Day-1 notebook | 0/3 | 0 | 1.23 B | 99% |
  | Gemma-3-27B, Track B notebook (transplant) | 0/3 | 0 | 0.16 B (−87%) | 31% |

  **No configuration passes 2021** (worst hour under 20% dark). What holds: the learned notebooks never collapse and
  cut darkness by 79–89%; telling the AI it's Uri does not help (memory from training is no substitute); in Track B
  the frozen AI adds a third on top of the notebook's rules (0.205 → 0.135 B), in Track A the rules are the knowledge;
  and the notebook transplants to a different model (Gemma: 1.23 → 0.16 B).

## Raindrop in the loop
Every decision the frozen operator makes can be traced in **Raindrop**: the exact briefing it read and the exact
answer it gave (`harness/raindrop_bridge.py`). Live demo runs go to Raindrop Cloud when `RAINDROP_WRITE_KEY` is set;
learning runs go to the local **Raindrop Workshop** (`raindrop workshop start`, no event quota). Two detectors flag
decisions on those traces: *said all clear while power was running out* and *kept homes dark with spare power*.

**The Raindrop night** (`scripts/raindrop_night.py`, `data/raindrop_night.json`, tag `rdA`) makes Raindrop part of the
learning loop: the coach's evidence is read back **out of Workshop's API**.
- Traced: 432 decisions of Track A's frozen notebook on the practice storms. Flagged: 31 (30 *homes dark with spare
  power*, 1 *false all clear*).
- The coach's diagnosis quoted them: *"Thirty of tonight's 31 flags are 'homes dark with spare power'. The AI keeps
  1,000–28,000 MW of homes dark at 6–11% margin."*
- Its 2 ideas went through the normal test: *release held cuts when the cushion is clearly back* (+4% darkness) and
  *show more of its own lessons at decision time* (−2%, under the 15% bar). **Both rejected**; the notebook is unchanged.
- Honest notes: the traced replay was stopped early for time (432 of ~1,300 decisions); the list of failed storms
  came from the cached day of the same notebook. The flags pointed at the same weakness the Track A tear-out found
  (needless darkness), and the gate held the same bar it held for Track A's 8-night plateau.

## Why you can trust the numbers
- **Locked simulator**: `sim/` is hashed (`sim/LOCK.json`, sha256 e2033976…) before any learning; calibrated only on
  pre-2021 data (`sim/data.py` refuses 2021+ rows). It reproduces the Feb 2011 freeze's outage duration and lowest
  frequency; it under-predicts that event's peak outage by about half.
- **Unseen storms are never learned from**: real pre-2021 cold waves (1989, 2007, 2014, 2018) made harder; the coach
  never sees them. Practice storms are real cold waves made harder too; the 3 calm days and the 2021 exam are real
  and unmodified.
- **The final notebook is the one the loop ended with**, not the best-scoring day (that would be test-set selection).
- **The AI can't peek at the exam**: the agent's database user `harness_rw` gets *not authorized (code 13)* on the
  `vault` database; only `evaluator` can write exam results (`scripts/atlas_check.py`, `data/atlas_check.json`).
- **The AI never sees names, dates or places**: regions A–H, fuels F1–F6, "day N, hour HH".
- **Disclosed**: during the feasibility check (Saturday) an early v0 simulator was run once on 2021 data
  (`feasibility/`); the locked v1 simulator and the learning never used it. Built Saturday + Sunday with the organizers'
  approval by email.

## MongoDB Atlas
- **`simdb`** (the learner's memory, 1,586 records): `runs`, `events`, `mutations` (every idea, kept or rejected, with
  its reason), `harness_versions` (every notebook version and its parent), `manual_pages` (lessons, with
  Qwen3-Embedding-8B vectors and an Atlas Vector Search index `pages_vec`), `scoreboard`, `coach_metrics`,
  `evolver_strategies` (the coach's self-reviews and A/B results).
- **`vault`** (the exam): `locked_tests` (pre-registration) and `test_runs` (the single 2021 run, written by the
  `evaluator` user). Role-based access: the agent's user `harness_rw` is refused the vault (*not authorized, code
  13*), and `evaluator` cannot write `simdb` (`scripts/atlas_check.py`, 11/11 checks).
- **Stable ids**: every record's `_id` is the sha1 of its content, so migration is idempotent and the Evidence site's
  record inspector fetches the exact document from Atlas by id (`GET /api/record/{coll}/{id}`).
- **Honest notes**: the overnight learning wrote to the local JSONL store (Atlas was set up Sunday morning) and was
  migrated with `scripts/migrate_to_atlas.py`; the 2021 exam was registered and written to the Atlas vault directly.
  Lesson recall computes cosine similarity on the same embeddings in-process; the `pages_vec` index exists on Atlas.
  The live server falls back to the identical local copy when Atlas is unreachable from the venue network.

## Screens
- **Stage** (`viewer/` → `?mode=stage`): a clay-toy 3D grid world (React Three Fiber). Press **BREAK THE GRID**: a
  hidden storm hits, the frozen AI acts (agent panel), and a **RESPONSE VERIFIED** card ticks real checks from the
  simulator. A corner inset shows the Day-1 notebook failing the same storm.
- **Mission Control** (`?mode=mission`): pick a storm and two notebook versions and run them side by side live;
  evolution timeline with every idea kept or rejected (and why), the notebook map, the coach's self-improvement.
- The live public ERCOT feed ("Texas right now") is display-only; nothing touches the real grid.

## Run it
```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # keys in .env (see .env.example)
.venv/Scripts/python scripts/live_server.py                             # :8594 catalog / compare / SSE stream
cd viewer && npm install && npm run dev                                 # http://localhost:5173/?mode=stage
.venv/Scripts/python -m harness.evolve --track B --night0 --gens 8 --tag myrun   # a learning run
```
Key code: `harness/evolve.py` (loop, tests, audits, deep sleep + A/B), `harness/coach.py`, `harness/operator.py`,
`harness/schema.py` (the notebook), `harness/dsl.py` (safe rule language), `harness/locked.py` (locked exam loader),
`sim/` (locked simulator), `scripts/` (step-0 experiments, post-freeze, exam, Atlas, live server).

## Data and credits
ERCOT hourly load and generation by fuel; EIA-860 generator inventory; ERA5 hourly reanalysis (8 Texas points);
FERC/NERC 2011 and 2021 cold-weather reports (facts only). Models: Qwen3-30B-A3B-Instruct and Qwen3-Embedding-8B
(Nebius Token Factory), Gemma-3-27B (transfer test), Claude Opus 5.5 (coach).
