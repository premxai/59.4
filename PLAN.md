# 4:37: Build Plan

> *"In February 2021, Texas came 4 minutes 37 seconds from a total blackout. In 2011 it got the warning. We froze an AI model and let it run a simulated Texas grid through winter after winter. Every blackout wrote a page of its operator's manual. Then we locked the manual and gave it the 2021 storm. Anonymized. Never seen."*

**Tagline:** Same model. Eleven blackouts. One operator's manual.
**Event:** MongoDB Harness Engineering & Model Wrangling Hackathon, Shack15 SF. Submissions due **Sun 2026-10-11 5:00 PM PT** (target 4:45).
**Team:** ___ (roles: ___)
**Status:** Feasibility **GO** (Sat 13:30), first commit `e195d45`. Now building simulator v1. See §12.

---

## 0. The one winning moment (everything serves this)

**Split screen on the anonymized 2021 storm the harness never saw:**
- Gen 1 harness: Texas goes dark.
- Evolved harness, **same frozen model**: the lights stay on.

Then **three columns of light**: v1 / what really happened / evolved, all labeled "in simulation."

**Rule for every second on stage:** does this help them believe the lights stayed on? If not, it goes to Q&A or the README.

---

## 1. What we're building, in one picture

```
                    ┌──────────────────────────── MongoDB Atlas ────────────────────────────┐
                    │ simdb: runs · events · episodes · manual_pages (vector) · ticks (live) │
                    │        harness_versions (lineage) · mutations · evolver_strategies     │
                    │        telemetry (time series, showcase runs only) · llm_calls         │
                    │ vault: locked_tests · test_runs (append-only)   ← harness user: no access│
                    └────▲──────────────▲───────────────────▲──────────────────▲────────────┘
                         │              │ change stream     │                  │ change stream (ticks)
 ┌───────────────┐  hourly state  ┌─────┴─────────┐   ┌─────┴──────────┐   ┌───┴──────────────┐
 │ GRID SIMULATOR│◄──actions────►│ L0 OPERATOR    │   │ L1 SLEEP       │   │ 3D WORLD VIEWER  │
 │ (Python, real │               │ rulebook/hour  │   │ EVOLVER (Opus) │   │ (R3F, plays      │
 │ data, pre-2021│──cause chain─►│ + frozen Qwen  │   │ mutates harness│   │ exported replays;│
 │ calibration,  │               │ on alerts      │   ├────────────────┤   │ live = bonus)    │
 │ hash-locked)  │               └───────┬────────┘   │ L2 META-       │   └──────────────────┘
 └───────────────┘                       │ traces     │ EVOLVER (Opus) │
                                         ▼            │ improves L1    │◄── Raindrop signals
                                     Raindrop ────────┴────────────────┘    (polled, Query API)
```

Three levels of self-improvement:
- **L0, Operator:** frozen Qwen3-30B plus the harness. The harness is made of sensors, a rulebook, guardrails, a context policy, a memory policy and a build policy.
- **L1, Sleep evolver:** Claude Opus 5.5. After every failed winter it reads the simulator-computed cause chain plus Raindrop signals and mutates the harness. A mutation is kept only if it improves the score and passes a no-regression gate.
- **L2, Meta-evolver:** Claude Opus 5.5. Every few generations it rewrites *how L1 evolves*, based on which mutations paid off. "It got better at getting better."

---

## 2. Problem statement fit

| Statement | Where 4:37 delivers it |
|---|---|
| **1. Recursive Harnessing** | **Rules:** the rulebook. **Context policy:** what the operator sees per alert. **Guardrails:** hard limits, e.g. "never shed gas facilities." **Tool access:** sensors the harness *invents* (`freeze_correlated_supply_risk`), and how much authority the live model gets. **Recursion:** L2 rewrites L1's strategy |
| **2. Long Horizon Engineering** | Each winter is about 2,900 hourly steps; training covers many winters × generations. **Memory pyramid:** telemetry → events → episodes → lessons → procedures → active context. **Hard signals:** frequency, MW shortfall, homes without power. Raindrop's preset "Forgetting" signal drives memory-policy mutations. Measured honestly: stored telemetry vs context per decision |

---

## 3. Components to build

| # | Component | Language | Notes |
|---|---|---|---|
| A | Grid simulator v1 | Python | Deterministic per seed. Calibrated **pre-2021 only**. Hash-locked before evolution |
| B | Harness schema + DSL interpreter | Python | Sensors and rules as data. No generated code ever runs |
| C | L0 operator | Python + OpenAI SDK (Nebius) | Rulebook every hour; Qwen on alerts. Responses cached by state hash |
| D | L1 Sleep evolver + gates | Python + Anthropic SDK | Structured mutations, replay evaluation, no-regression gate |
| E | L2 Meta-evolver | Python + Anthropic SDK | Rewrites the evolver strategy doc |
| F | Memory layer | Python + Atlas | Pyramid; vector recall; helpful/harmful counters on rules |
| G | Eval suite + contamination controls | Python | Synthetic stress storms, gate set, locked suite, runs A/B/C/D, transplant, recognition probe |
| H | 3D world viewer | TypeScript (Vite, React, R3F) | Plays exported replay JSON; live mode is a bonus |
| I | Replay API (Node, on Modelence) + local relay | Node / Python | Modelence hosts viewer + Node replay API; Python runs locally |
| J | Integrations | — | Raindrop (tracing + one custom signal + Query API), Modelence deploy, MongoDB MCP for dev |

**Team mapping:**
- 1 person: A–G, then H minimal.
- 2 people: P1 does A–G; P2 does H–J **starting now**.
- 3–4 people: A+G / B–F / H / I+J+demo.

---

## 4. Simulator v1 (A)

### 4.1 World (v0 features carried over)
- **Weather:** real hourly ERA5 temperature, wind, precipitation and snow at 8 Texas points. It drives demand, plant trips, gas freeze-offs, wind icing and solar.
- **Demand:** regression on population-weighted temperature (heating and cooling), hour, weekday and trend. **Fit on 2010–2020.** The extreme-cold slope is calibrated to ERCOT's 2011 estimate of ~59,000 MW demand without shedding (a pre-2021 fact). Quadratic terms extend linearly beyond the training range (rule fixed before any 2021 test).
- **Fleet:** per-season capacity by fuel from `ercot_plants.csv` / EIA-860, filtered by operating and retirement years. **This file is the single source for both simulator and viewer.**
- **Gas fuel:** saturating freeze-off loss in freezing degree-hours at the basin. Electric–gas feedback is **0.06 per unit unprotected shed fraction**, an upper bound derived from 2011 (4.9 GW shed ↔ ~1.3 GW gas outages).
- **Wind:** CF curve fit on 2016–2020 output, plus icing. **Solar:** daylight × clearness × snow.
- **Frequency:** minute sub-steps in stressed hours. Real ERCOT rules: under-frequency shedding 5/15/25% at 59.3/58.9/58.5 Hz; collapse after 9 cumulative minutes at ≤ 59.4 Hz; responsive reserve 2,300 MW.

### 4.2 v1 changes (from feasibility findings, decided on pre-2021 evidence)
1. **Vulnerable-fraction unit model.** Each thermal unit is winterized or not. Non-winterized units fail at their own threshold temperature. Calibrated on 2011 (moderate cold, many frozen sensing lines) + Dec 1989 (extreme cold) + Jan 2014 (9,355 MW lost, no shed). Motivation: a single hazard curve **cannot fit 2011 and 1989 together**, a pre-2021 finding. Winterizing (a build lever) shrinks the vulnerable pool.
2. **Lumpy unit trips** (500–1,300 MW) at random minutes, seeded. This gives real frequency dips and the 9:00 countdown. Frequency sensitivity is calibrated to 2011's 59.576 Hz and 1989's 59.65 Hz minimums.
3. **Seasonal planned outages:** ~16% of non-nuclear thermal in early February (2011: 12,413 MW scheduled).
4. **Multi-seed scoring:** deterministic per seed; gates average over seeds.

### 4.3 Levers (action space): **frozen before any locked run; never changed after seeing a locked result**
**Build (pre-season, capital budget):**
- winterize wellheads
- winterize plants (per fuel)
- firm/dual fuel
- batteries
- demand-response contracts
- critical-load mapping (protect gas facilities)
- extra reserves

**Operate (rulebook hourly; LLM on alerts):**
- conservation appeal
- demand response
- batteries
- pre-commit units
- imports (DC ties ~1.2 GW)
- emergency levels
- controlled rotating shed (MW, rotation, protected loads)
- restoration timing

### 4.4 Score
- **Primary:** homes × hours without power. Collapse adds a catastrophic penalty.
- **Secondary:** build + operating cost; **unnecessary shedding**.
- **Hero display:** dark or lit; peak homes dark.

### 4.5 Cause chain, computed by the simulator (never the LLM)
`Far West below −8 °C for 30 h → gas wells froze (−45% fuel) → 18 GW gas plants without fuel → not enough electricity at h61 → automatic shedding insufficient → 9 min below 59.4 Hz → TEXAS DARK`

### 4.6 Anonymization (agent's view only; the audience sees the real Texas)
- Regions "A–H"; fuels "F1–F6".
- Time is "season s, day d, hour h".
- Demand is scaled by a hidden factor per season.
- Observed temperatures carry sensor noise.

---

## 5. The harness (B), meaning what evolves

```jsonc
{
  "_id": "h_011", "parent_id": "h_010", "generation": 11, "hash": "sha256…",
  "sensors": [ {"name": "freeze_correlated_supply_risk",
                "expr": "mul(cum_below(temp.B, 0, 48), share(gen.F1))", "born_from": "run_r_0412"} ],
  "rules": [ {"id": "r7", "if": "gt(freeze_correlated_supply_risk, 0.6)", "then": "precommit(F1, 0.9)",
              "priority": 2, "helpful": 14, "harmful": 1, "born_from": "page_007"} ],
  "guardrails": ["never_shed(critical_gas)", "reserve_floor_mw(3000, when=forecast_min_temp<-5)"],
  "operator_authority": {"max_shed_change_mw_per_h": 6000, "llm_decides": ["shed_amount", "rotation", "restore_timing", "early_reserves"]},
  "context_policy": {"sensors": ["reserve", "freq", "freeze_correlated_supply_risk"], "memory_top_k": 4, "forecast_hours": 72},
  "memory_policy": {"promote_episode_to_lesson_if": "impact_mwh>500", "max_active_pages": 12},
  "build_policy":  {"winterize_wells": 0.4, "winterize_plants": {"F1": 0.5}, "critical_load_map": true},
  "alerts": [{"when": "lt(reserve_margin, 0.08)", "call_operator": true}]
}
```

- **DSL primitives:** `value`, `delta`, `slope`, `mean`, `min`, `max`, `ratio`, `share`, `forecast`, `cum_below`, `cum_above`, `gt`/`lt`, `mul`/`add`.
- **v1 starting sensors:** temperature now, demand now, reserve margin, frequency, available capacity by fuel. v1 has **no** gas-supply or freeze-risk sensor; it has to learn that it's blind.
- **The live agent matters.** The rulebook handles routine hours. The L0 model's alert-time calls decide **how much to shed, rotation, restoration timing and early reserve deployment**, using recalled manual pages. `operator_authority` is itself evolvable: if the model hurts, the harness can learn to limit it.

---

## 6. Models

Both keys are verified. Every model is pinned and frozen for the whole event.

| Role | Model | Provider / SDK | Notes |
|---|---|---|---|
| **L0 operator (frozen)** | **`Qwen/Qwen3-30B-A3B-Instruct-2507`** | Nebius (OpenAI-compatible, `https://api.tokenfactory.nebius.com/v1/`) | Open weights. Valid JSON in 2.0 s. Temperature 0, `json_object`. Responses cached by state hash |
| **Transplant model** | `google/gemma-3-27b-it` | Nebius | Valid JSON in 3.1 s. Used for the transplant test (§8) |
| **L1 evolver / L2 meta** | **`claude-opus-5-5`**, effort `high` | Anthropic Python SDK | Structured outputs; server-side refusal `fallbacks` enabled; prompt caching |
| Recognition probe | Qwen3-30B + gemma-3-27b + DeepSeek-V4-Pro (+ Opus) | Nebius / Anthropic | N ≥ 20 per model (§8) |
| Embeddings fallback | `Qwen/Qwen3-Embedding-8B` | Nebius | If the Atlas query-embedding cap bites |

**Cost:** the L0 operator on Nebius costs a few dollars for thousands of calls. L1 + L2 on Opus cost about $20–40.

---

## 7. Self-improvement loop (D, E)

```
for gen in 1..G:
  run harness H_gen over the training curriculum (pre-2021 winters + historical events + synthetic stress storms)
  if no failures: escalate the curriculum (harsher synthetic storms)
  pick failure(s) ← per evolver strategy (L2 controls this)
  poll Raindrop signals for this generation's runs (Query API; no webhooks)
  L1 gets: cause chain, telemetry digest, harness, manual, Raindrop + own detector flags, mutation history
     → K mutations {type, diff, rationale, predicted_gain, evidence_refs}
  evaluate candidates: replay failing season(s) + gate set, multi-seed, in parallel, LLM cached by state hash
  accept best if target improves AND gate regression ≤ ε (gate includes "don't over-shed" checks, §8)
  write a manual page ("Gas wells froze. I couldn't see it coming."); log predicted vs actual
  every M=3 gens → L2: acceptance by type, calibration error, gain per $ → evolver strategy v+1, A/B on a failure snapshot
```

**Curriculum breadth.** Synthetic storms force qualitatively different failure modes, so the manual lineage shows breadth, not just "winterize gas":
- gas freeze-offs
- frozen sensing lines on thermal units
- wind icing
- demand surge
- the gas-compressor feedback when shedding hits gas facilities
- flash freeze vs long freeze

**Metrics:**
- score per generation
- **mutation acceptance rate** (~20% → ~60%)
- prediction calibration
- **false-all-clear rate per generation, measured by Raindrop**

---

## 8. Data splits and honesty protocol (G)

| Split | Content | Used for |
|---|---|---|
| **Train** | Winters 2007/08 → 2016/17 (incl. Feb 2011), Dec 1989, and **synthetic stress storms** built from pre-2021 weather (2011/1989 temperatures shifted 5–9 °C colder, 2–3× longer, different geography) | Evolution and **difficulty checks (G3)** |
| **Gate** | Winters 2017/18 → 2019/20, plus no-shed checks: **Jan 6, 2014** polar vortex (emergency level 2, no firm shed), **Jan 17, 2018** (65.9 GW, no shed), **Feb 10, 2011** (57.9 GW, no shed) | No-regression and **"don't over-shed"** |
| **Locked test** | Feb 2021 (Uri), Dec 2022 (Elliott), *stretch:* Aug 2023 heat | Final evaluation only |

**Protocol**
1. **Lock the simulator:** code + calibrated params committed and hashed before any evolution. Calibration uses pre-2021 data only.
2. **Lock the action space** before any locked run. Never adjust levers after seeing a locked result.
3. Locked scenarios live in the `vault` database; the harness DB user has no access. `test_runs` is append-only (custom role: insert + find).
4. Freeze and hash the final harness before any locked test. **One logged run per version.**
5. **G4** (real 2021 actions in the locked simulator) runs **once after the lock**. Logged, never tuned on.
6. **Contamination runs on Uri, same frozen model:**

| Run | Setup | Expected (hypothesis, not a target) |
|---|---|---|
| A | v1, anonymized | collapse |
| B | v1, told "this is Winter Storm Uri" | still fails (feasibility v0: **collapsed**) |
| C | evolved harness + live model | best |
| D | evolved harness, **LLM off** (rulebook only) | survives, more homes dark than C |
| T | **Transplant:** evolved harness on gemma-3-27b vs gemma + v1 | survives vs fails. **Test early.** If it fails, the stage trust line falls back to run B |

Hoped-for ordering: A < D < C. D proves the model's memory of 2021 isn't what saved it; C > D proves the live agent adds value. If C ≤ D, report it, and limiting model authority becomes an evolution story.
7. **Recognition probe:** N ≥ 20 per model, several models, including a **raw-numbers-only** version with no narrative. Feasibility (N=5): Qwen 0/5, DeepSeek-V4-Pro 5/5.
8. **Rule provenance:** every rule and sensor links to the training blackout that produced it (`$graphLookup`).
9. **Three columns:** v1 / what really happened (status-quo procedure in the sim, with real reported numbers cited) / evolved. Always "in simulation."

**Disclosure (feasibility, Sat):** simulator **v0** was run on 2021 during the feasibility check (G3/G4/G6 informational). Those results are not the official ones. v1's design changes are justified by pre-2021 evidence (the 2011 vs 1989 misfit; the 2011 report's planned-outage and gas-outage numbers). Official 2021 runs happen only on the locked v1 simulator, after the lock. We say this in the README.

---

## 9. MongoDB Atlas design (F)

| Collection | DB | Type | Purpose | On stage? |
|---|---|---|---|---|
| `runs` | simdb | regular | (scenario_id, seed, harness_hash) + season summary + score | change stream triggers the evolver |
| `events` | simdb | regular | threshold crossings, actions, cause chain | — |
| `episodes` | simdb | regular | per-cold-event operator notes | — |
| `manual_pages` | simdb | regular + **Vector Search** | lessons + evidence + helpful/harmful counters | **"Recalled from MongoDB" card** |
| `harness_versions` | simdb | regular | full harness, parent_id, hash, predicted/actual gain | **lineage via `$graphLookup`** |
| `mutations`, `evolver_strategies` | simdb | regular | proposals (incl. rejected); L2 versions | RSI chart |
| `telemetry` | simdb | **time series** | full hourly state, **showcase runs only** (champion per gen, locked tests) | feeds replays |
| `ticks` | simdb | regular | live run, 1 doc per sim hour (time series can't change-stream) | live bonus |
| `llm_calls` | simdb | regular | prompt hash, tokens, latency, cache key | — |
| `locked_tests`, `test_runs` | **vault** | restricted / append-only | locked scenarios; audit log | — |

**Storage (assume M0, 512 MB, until the sandbox tier is confirmed):** the simulator is deterministic, so candidate and gate runs store only `(scenario_id, seed, harness_hash)` + summary + events + cause chain. Telemetry is regenerated on demand.

**Other M0 limits:**
- 3 search/vector indexes total
- 100 ops/s, so batch writes
- 5 change streams
- `$graphLookup` fails past 100 MB
- auto-embed queries capped at 3/min without a payment method on the org (add a card; free tokens cover it)

---

## 10. 3D world (H)

**Minimum:**
- Texas map
- city lights
- frequency ring (from the simulator's frequency; fallback: derived from reserve margin)
- split screen
- **same-model badge**
- manual-page and recall cards

**Stretch:**
- build-phase animations
- four small Texases (contamination)
- cinematic camera

| Scene | On screen | Proves |
|---|---|---|
| Setup | Texas at night, city lights | stakes |
| Grid 1 goes dark | Pumpjacks frost → stacks go dark → turbines ice → ring red → the whole state goes dark | failure, in plain language |
| Learning | Manual page; Raindrop "false all-clear" flag; new sensor glows over the gas fields; later grids last longer | Statement 1, Raindrop |
| **HERO split screen** | Same anonymized storm; badge on both sides; left goes dark, right stays lit; **live operator card: "Recalled from MongoDB: 2011 lesson → starts controlled rotation 3 h earlier"**; "what changed" card; three light columns | **the winning moment** |

**Badge (permanent, both sides):** `MODEL: Qwen3-30B-A3B · weights frozen · fine-tuning runs: 0`
**"What changed" card (Gen 1 → Gen 11):** model weights identical ✓ / harness +N sensors, +N rules, +N guardrails, new memory policy.

**Stack (pinned):**
- `three` 0.186.1 (**< 0.187**)
- `@react-three/fiber` 9.8.1
- `@react-three/drei` 10.7.9
- `@react-three/postprocessing` 3.1.3
- `postprocessing` 6.39.5
- React 19.3, Vite 8.3, Node 22
- **No Theatre.js.** Camera via drei `CameraControls` (promise-chained shots) or GSAP timelines.

**Data and assets:**
- **Plants:** `data/processed/ercot_plants.csv` filtered by operating and retirement years per scene. **Not** `ercot_plants.json`, which is the 2025 fleet and anachronistic for 2021.
- **Cities:** `tx_cities.json` (25 cities, lat/lon/pop) for light clusters. Spot-check its origin.
- **Texas boundary:** US Census cartographic boundary (eric.clst.org/tech/usgeojson, `gz_2010_us_040_00_500k.json`, filter TX), public domain. ERCOT outline from HIFLD if the link works.
- **Permian Basin:** EIA shapefile (`PermianBasin_Boundary_Structural_Tectonic.zip`) → GeoJSON via `npx mapshaper` or pyshp.
- **Models:**
  - **Wind turbines from Kenney City Kit Industrial (CC0).** Not poly.pizza `n9lfMIPumB`, which is a sci-fi machine.
  - Transmission tower: poly.pizza `TYK3rPu7E5` (CC0).
  - Battery containers: poly.pizza `dQXRtm5GbO` (verify license).
  - **Procedural cooling tower** (LatheGeometry hyperboloid) and **smokestack** (cylinder).
  - Pumpjack: procedural, or CC-BY "Oil pump" `fZykGFywa5D` with a credits panel.

**Delivery:**
- **The judged demo plays static exported replay JSON;** live mode is a bonus.
- Kiosk full-screen, with a backup video.
- Modelence hosts the viewer + Node replay API (warm it before judging).

---

## 11. Integrations

**Raindrop:**
- Trace only **operator LLM calls**. Use the local Workshop during development.
- **One custom signal** (Hobby has one slot): **"False all-clear"**, where the operator says the grid is safe while reserves are falling.
- Own detectors (`reserve_misread`, `ignored_alert`) are reported via `track_signal` and don't use the slot.
- **The evolver polls signals after each run** (`raindrop-query`), since there are no webhooks.
- The preset "Forgetting" signal feeds memory-policy mutations.
- **Independent metric:** false-all-clear rate per generation. Open the real dashboard in Q&A.
- You're emailing support@raindrop.ai (subject "HACKATHON") for a Pro trial or higher cap.

**Modelence:** Node only. It hosts the viewer and replay API, which read Atlas through a custom secret variable. Ask about the credit at their table.

**Local setup:**
```bash
.venv/Scripts/pip install pymongo pydantic fastapi "uvicorn[standard]" raindrop-ai raindrop-query   # anthropic, openai, dotenv already installed
npm create vite@latest viewer -- --template react-ts && cd viewer && npm i three@0.186.1 @react-three/fiber@9.8.1 @react-three/drei@10.7.9 @react-three/postprocessing@3.1.3 postprocessing@6.39.5
```

**Secrets** (`.env`, gitignored): `NEBIUS_API_KEY` ✓ · `ANTHROPIC_API_KEY` ✓ · `MONGODB_URI_HARNESS` · `MONGODB_URI_EVAL` · `RAINDROP_WRITE_KEY`

**Atlas (from the sandbox invite):**
1. Create the cluster.
2. Create the `simdb` and `vault` databases.
3. Create user `harness_rw` (readWrite on simdb only) and user `evaluator`.
4. Add your IP to the access list.
5. Create the vector index on `manual_pages`.
6. Add a payment method to the org.

**Repo layout:**
- `sim/`
- `harness/`
- `eval/`
- `server/`
- `viewer/`
- `scripts/`
- `data/` (raw gitignored)
- `feasibility/`
- `docs/`

**Git:** commit often with clear messages. The rules require judges to see what was built during the event.

---

## 12. Feasibility check: **GO** (Sat 13:30)

Full write-up in `feasibility/FEASIBILITY.md`.

| Gate | Status |
|---|---|
| G1 Data | ✅ ERCOT load/fuel mix 2007–2024, ERA5 weather (+1989), EIA-860 plants, sourced facts |
| G2 Calibration | ✅ 2011 sim peak shed **4,956 MW vs 4,948 actual** (v0); v1 refines |
| G3 Difficulty | ✅ on v0 (informational). **v1 re-checks on synthetic storms only** |
| G4 Validity | ✅ v0 status quo 266M vs ~222M real homes×hours (±50%). **v1: run once after the lock** |
| G5 Recognition | ✅ Qwen 0/5 (said "UK 2010"); DeepSeek-V4-Pro 5/5. **Redo with N ≥ 20 + raw-numbers version** |
| G6 Run B | ✅ v0: told "this is Uri", **still collapsed** |

---

## 13. Schedule (Sat 13:45 → Sun 17:00 PT)

| When | Sim / harness track | 3D / demo track |
|---|---|---|
| Sat 13:45–17:30 | **Sim v1** (vulnerable-fraction units, lumpy trips, seasonal maintenance, multi-seed) → calibrate pre-2021 → synthetic stress storms → **lock (commit + hash)** | Viewer scaffold: Texas boundary, city lights, plants from csv, ring, play a v0 replay JSON |
| 17:30–21:00 | Harness schema + DSL, Atlas setup (simdb/vault/roles), L0 operator with cache, L1 evolver + gates + manual pages | Grid-goes-dark sequence, badge, cards |
| **21:00** | **Golden-path checkpoint:** sim locked + v1 collapsing on a synthetic storm + static replay rendering in 3D. **If missed, triage scope tonight** | ← |
| 21:00–00:30 | L2, Raindrop signal + Query API polling, contamination harness (A/B/C/D/T); **clock one full generation** (seconds per gen → gens per night); start the overnight run | Split screen, three light columns |
| Sun 09:00–10:30 | Review overnight; final run if needed; **freeze + hash the final harness**; **transplant test** | Polish |
| 10:30–12:30 | **Locked tests + contamination runs + G4 (each run once, logged)**; recognition probe N ≥ 20 | Wire results into replays; live mode (bonus) |
| 12:30–14:30 | Export replays; README ("built during the event" + v0 disclosure) | Scripted camera; credits panel |
| 14:30–15:30 | Modelence deploy (warm); rehearse | Kiosk mode; backup video |
| 15:30–16:30 | 1-minute video (10 s setup · 15 s learning · 30 s split screen · 5 s close) + submission | — |
| **16:45** | **Submit** | — |

**Cut list (in order):** Aug 2023 heat test → build-phase animations → four small Texases → cinematic camera → L2 A/B → Elliott test → Raindrop read-back (keep tracing).
**Never cut:** locked Uri test, split screen, runs A + C, same-model badge.

---

## 14. Stage demo (3 min): 3 beats + close, plain language

| Time | Beat |
|---|---|
| 0:00–0:20 | **Setup.** Texas at night. "In 2021 Texas came 4 minutes 37 seconds from a total blackout. In 2011 it got the warning." |
| 0:20–1:20 | **Learning.** Grid 1 goes dark → manual page: "Gas wells froze. I couldn't see it coming." → Raindrop flags the operator's "false all-clear" → new sensor `freeze_correlated_supply_risk` glows over the gas fields → later grids last longer |
| 1:20–2:40 | **HERO.** Split screen, same-model badge on both sides → live operator card: "Recalled from MongoDB: 2011 lesson → starts controlled rotation 3 h earlier" → "what changed" card → **three light columns** |
| 2:40–3:00 | **Trust + close.** "We moved the manual into a different AI. It survived too." (fallback: run B) + "False all-clears fell X% → Y%, measured by Raindrop, not by us." → "Same model. Eleven blackouts. One operator's manual." → impact sentence |

**Language:** "power plants froze," "not enough electricity," "the whole state goes dark." No Hz or emergency-level jargon except in Q&A.

**Impact sentence:** *The pattern is a frozen operator plus an evolving, audited operator's manual for rare catastrophic events. It transfers to water utilities in drought, wildfire-season power shutoffs and gas pipeline operations.* Never claim real-grid results; always "in simulation."

---

## 15. Verified facts for stage (source of truth: `data/facts/EVENTS.md`)

- **4:37** = margin left: frequency was below 59.4 Hz for 4 min 23 s, against the 9-minute generator trip rule. Lowest 59.302 Hz at about 1:51–1:55 AM, Feb 15.
- **About 4.5 million homes and businesses** lost power. Maximum load shed was **20,000 MW**, part of the **largest controlled load shed in US history** (event-area total 23,418 MW, FERC-NERC).
- **Causes (ERCOT):** "frozen equipment and gas supply caused most outages" (ERCOT: weather 53% of unavailable MW at peak). The 44.2% freezing / 31.4% fuel split covers the **whole event area**, not ERCOT alone.
- **2011:** FERC/NERC recommended winterization. It was **recommended, not required**.
- **Elliott (Dec 2022):** 74,525 MW winter record, no emergency, no load shed. **Sept 6, 2023:** emergency level 2, low 59.769 Hz, no controlled outages.
- **Deaths:** no number in the 3-minute pitch. If needed: "hundreds of people died." Q&A: 246 official (DSHS); ~702 excess-death estimate (426–978).
- **Say "total blackout," not "months-long."** EVENTS.md has no source for "months."

---

## 16. Q&A prep: one sentence + one screen each

| Question | Answer |
|---|---|
| "Does the model just know 2021?" | Run B (told it's Uri, still failed), transplant to a different model, recognition probe N ≥ 20, run D (model off, harness held) |
| "Is it recursive?" | L2 improves L1: acceptance ~20% → ~60%; Raindrop-measured false-all-clear rate falls |
| "How is MongoDB used?" | A change stream starts the evolver; vector recall changes a live decision; `$graphLookup` traces a rule to its blackout; the locked vault DB enforces honest testing |
| "Was the sim tuned to win?" | Pre-2021 calibration, hash-locked; difficulty checks on synthetic storms only; G4 run once and logged; v0 peek disclosed |
| "Why not a genetic algorithm?" | It evolves human-readable operating knowledge that transfers to unseen storms and to other models |
| "What did Raindrop do?" | Caught the false all-clear that led to the new sensor, and independently measures improvement |
| "Toy grid?" | Simplified on purpose. It models the mechanisms that broke (cold trips, gas freeze-offs, gas–electric feedback, frequency). Validated out of sample once (G4) |
| "Did you pick the stage version by test score?" | No. Harness frozen before tests, one logged run per version, append-only `test_runs` |

---

## 17. Open items

1. **Team size and roles.** Who owns the 3D full-time?
2. **Atlas:** cluster from the sandbox invite + payment method on the org.
3. **Raindrop:** your HACKATHON email (Pro trial / higher cap).
4. **Modelence:** credit condition (ask on the day).
5. LLM budget cap for the weekend.
