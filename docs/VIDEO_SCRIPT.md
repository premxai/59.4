# 59.4: one-minute video (screen recording + voice)

Record with **Win + G** (Xbox Game Bar → Capture → Record) or OBS, Chrome full screen (F11), 1920×1080 or 1440×900.
Voice in your own words; the lines below are a guide (~140 words = 60 s). Keep the cursor still between shots.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:06 | Evidence site hero (`localhost:5173/?mode=site`): "Same frozen AI. It only rewrites its notebook." | "In 2021 Texas came within minutes of a total blackout. Below 59.4 hertz for nine minutes, the grid goes dark." |
| 0:06–0:20 | Stage (`?mode=stage&storm=heldout_west_gas_2018`): press **Break the grid**. Small notes, storm rolls in, wells freeze; point at the Day-1 inset, then **RESPONSE VERIFIED** ticking | "This AI runs the grid. Its brain is frozen, never retrained. Here's a storm it has never seen. The Day-1 notebook leaves millions of homes dark. The learned notebook keeps gas facilities powered and brings homes back as soon as power returns. Checked by a locked simulator." |
| 0:20–0:30 | Live lab (`?mode=mission`): storm picked, v1 Day 1 vs v7 final, **Run side by side**, 8× then the result line | "Pick any storm and any two notebook versions, and run them side by side. Ninety-eight percent fewer home-hours in the dark." |
| 0:30–0:40 | Evidence → "8 storms it never saw": 0/8, 0/8, 8/8, 6/8; scroll to the learning curve | "On eight storms the coach never saw: zero of eight on day one, eight of eight at best. We report the final notebook, six of eight, because picking the best after the test would be cheating." |
| 0:40–0:50 | Night by night: a rejected "kept homes dark on a calm day" row; Coach section: a rewrite card "adopted"; open one **record** drawer (Atlas _id) | "Every night a coach proposes edits, tests them, and rejects cheats. Every two nights it grades its own coaching and A/B-tests the rewrite. Every record lives in MongoDB." |
| 0:50–1:00 | 2021 exam section, then Integrity "Try reading the exam vault as the AI" | "The real 2021 storm, run once from a vault the AI can't read: nobody passes, but the learned notebook never collapses the grid and cuts darkness eighty-nine percent. Same model. Different harness." |

Before recording:
- `scripts/live_server.py` running (`.venv/Scripts/python scripts/live_server.py`), viewer `npm run dev`.
- Do one dry run of the Stage storm and of the Live lab pair, so both replay instantly (the lab shows "Identical earlier run, replayed").
- Hide the browser bookmarks bar; zoom 100%; dark or light theme, not mixed.
