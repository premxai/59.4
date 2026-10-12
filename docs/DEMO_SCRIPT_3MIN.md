# 59.4: 3-minute live demo with judges

**Open these tabs first, in this order:**
1. Evidence site: `localhost:5173/?mode=site`
2. Live lab: `localhost:5173/?mode=mission`
3. Raindrop Workshop: `localhost:5899/runs/e47f4560bb834f938a0a9877d4a698dd`

| Time | Do | Say |
|---|---|---|
| 0:00–0:20 | Tab 1, top of the page | "In 2021 a winter storm almost blacked out all of Texas: below 59.4 hertz for nine minutes and the whole grid goes dark. We asked: can a frozen AI learn to run the grid better without ever being retrained? Our AI never changes. Only its notebook does." |
| 0:20–0:40 | Scroll to **How it works** | "By day, the frozen AI runs storms on a locked simulator built from real pre-2021 data. At night a coach, Claude, reads what went wrong and writes small edits to the notebook. Every edit is tested, and it's kept only if it really helps. Cheats get rejected." |
| 0:40–1:25 | Tab 2. Ask a judge to **pick any unseen storm**. Keep **v1 · Day 1** vs **v7 · final**, click **Run side by side**, press **F**, click **8×** | "Pick any storm the AI has never seen. Same AI on both sides. Left is the Day-1 notebook, right is the learned one. *(play)* Watch the left city: neighborhoods go dark. The right one stays lit." *(the result line appears)* "That's this storm: far fewer homes in the dark." |
| 1:25–1:50 | **F** to exit. Tab 1, the **8 storms it never saw** chart | "Across all eight unseen storms, three runs each: zero passes on day one, eight out of eight at its best. We report the final notebook, six of eight, because picking the best after seeing the test would be cheating. 93% fewer homes in the dark." |
| 1:50–2:10 | **Night by night**: a rejected "kept homes dark on a calm day" row. Then **Coach**: an adopted self-review card | "The coach tried to cheat seven times, for example by keeping homes dark on a calm day to look safe, and the test rejected it. Every two nights the coach grades its own coaching and A/B-tests the rewrite. That's the recursive part." |
| 2:10–2:30 | Click a **record** button, then **Fetch live from Atlas**. Then **Integrity**, then **Try reading the exam vault as the AI** | "Every version, idea and test lives in MongoDB Atlas. This is the real document, fetched live. And the final exam sits in a vault: when the AI's own login tries to read it, Atlas refuses: not authorized." |
| 2:30–2:45 | Tab 3: point at the **⚠ FLAG** rows, then the AI's answer on the right | "Raindrop records every decision the AI makes. Here it kept 18,500 megawatts of homes dark with 6% spare power, and Raindrop flagged it. For one night the coach read these flags as its evidence." |
| 2:45–3:00 | Tab 1, **2021 exam** section, then the **other model** rows | "Final exam, the real 2021 storm, run once: nobody passes, but the learned notebook never let the grid collapse and cut darkness 89%. We even gave the notebook to a different AI, Gemma: 87% less darkness. Same model. Same storm. Different harness." |

**If asked:**
- **"Is it live?"** Yes. The comparison runs on this laptop's server. A pair that ran before replays its identical earlier run (same notebooks, same storm, same seed), and the screen says so. "Ask the AI fresh" makes new AI calls and is slower.
- **"Did the Raindrop night improve it?"** No. Both fixes were tested and rejected for not helping enough. The flags pointed at the right weakness, and the test held the bar.
- **"Can Gemma run live?"** No. Gemma ran once, in the locked exam; the live lab uses the frozen Qwen operator.
- **If Atlas drops:** the screens switch to the identical local copy and say so.
- **If the laptop dies:** 59-4.vercel.app has the Evidence site and the Stage replay.
