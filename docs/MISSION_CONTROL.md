# Mission Control: what the screen shows and where the data comes from

Inspired by Ripple (NYC 1st place): show the agent **working**, not just the output.

## Layout
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ LOOP STRIP:  Day: operate → Check → Night: replay → Diagnose → Test edits → Accept → Next day │
├───────────────────────────────────────────────────────────┬──────────────────────────┤
│ CITY VIEW (Blender light-layer compositor)                │ SIDEBAR: steps, live     │
│ - zones dark/lit from the replay frames                   │  👀 Sees …   📘 Habit …   │
│ - gas plant steam, turbines, battery yard                 │  🧠 Remembers … (MongoDB)│
│ - cards anchored to objects (pumpjacks, plant, hospital)  │  🤖 Decides … (+ reason) │
│ - night: blue tint, rewind, cause-chain arrows            │  🚩 Raindrop flag …      │
│ badge: "Same AI: Qwen3-30B · weights frozen · retraining 0"│  🏠 Result …             │
├───────────────────────────────────────────────────────────┴──────────────────────────┤
│ SCOREBOARD: 8 unseen storms per generation ✗✗✗✗✗✗✗✗ → ✓✓✓✓✓✗✓✓ · manual pages 0 → 11      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```
Click any step to open the inspector: the AI's full briefing and answer, the coach's edit (ops), test results, MongoDB doc id.

## Data (all written by `harness/` into MongoDB `simdb`, or `data/local_store/*.jsonl` before Atlas)

| Collection | What the screen uses it for |
|---|---|
| `events` | **The sidebar.** One doc per step: `{run_id, generation, h, type, actor, text_plain, data}` |
| `scoreboard` | The ✓/✗ rows per generation (`heldout[]`, `train[]`), page counts, manual counts |
| `harness_versions` | The "what changed" card (diff of `counts` and ops between Gen 1 and Gen N), lineage |
| `mutations` | "Ideas kept and rejected on purpose" (title, status, reason, predicted vs actual) |
| `manual_pages` | The manual page cards (title + text + `born_from_run`) |
| `evolver_strategies` | The deep-sleep notebook entry and the acceptance-rate trend |
| `runs` | Per storm verdicts (`verdict_plain`), homes dark, collapse hour |
| replay JSON (`docs/REPLAY_FORMAT.md`) | The city animation, hour by hour |

## Event types → sidebar line
| type | actor | icon | example `text_plain` |
|---|---|---|---|
| `gen_start` | system | ☀️ | Day 3: the AI runs the winter with manual h_004 (2 pages) |
| `sensor_alert` | manual | 👀 | Alarm: Reserves getting thin: ask the AI |
| `rule_fired` | manual | 📘 | Manual habit: freeze coming, start extra plants early |
| `memory_recall` | memory | 🧠 | Remembers: "Protect the gas wells" (from MongoDB) |
| `ai_decision` | ai | 🤖 | AI decides: rolling outages 3,000 MW (about 675k homes take turns); keep gas facilities powered |
| `guardrail` | manual | 🛡️ | Hard limit: never let spare power drop below 2,500 MW in a freeze |
| `false_all_clear` | raindrop | 🚩 | Flag: the AI said all clear while power was running out |
| sim: `trip`, `freeze_off`, `icing`, `shed_start`, `shed_end`, `ufls`, `collapse`, `restore`, `gas_feedback`, `demand_surge` | sim | 🏠 | Gas wells froze in the west; 6 GW of gas plants lost fuel |
| `sleep_start` | coach | 🌙 | Night 2: the coach reviews 3 failed storms |
| `replay` | coach | ↺ | Replay: gas wells froze → plants lost fuel → total blackout |
| `diagnosis` | coach | 🩺 | (the coach's plain-English diagnosis) |
| `proposal` | coach | 💡 | Idea: protect gas facilities during outages (expects +2 storms) |
| `test` | coach | 🧪 | Tested on 5 storms: ✓✓✗✓✓ |
| `accept` / `reject` | coach | ✅ / 🗑️ | Kept: … / Rejected: … made a calm day worse |
| `page_written` | coach | ✍️ | New manual page saved to MongoDB: "…" |
| `deep_sleep` | coach | 🌌 | Deep sleep: the coach reviews itself: "…" (acceptance 40%) |

## Modes
- **Replay (stage default):** `viewer/public/mission/<bundle>.json`, exported by `scripts/export_mission.py` (events + replay frames + scoreboard + pages + diffs). Nothing can break on stage.
- **Live (bonus):** a small relay streams new `events` docs from a MongoDB change stream to the browser over WebSocket.

Plain language only on screen. Technical detail lives in the inspector.
