# Feasibility check: results (Sat 2026-10-10, 11:15 → 13:30 PT)

**Verdict: GO**, with four simulator v1 changes (bottom of this file).

## Gates

| Gate | Result | Evidence |
|---|---|---|
| **G1 Data** | ✅ PASS | Real hourly ERCOT load (2007–2024), 15-min fuel mix aggregated to hourly (2007–2024, covers Feb 2011), ERA5 weather for 8 Texas points (2007–2024 plus 1989), EIA-860 plants with lat/lon (974 plants). See `data/DATA_REPORT.md`. Sourced event facts, tagged calibration-safe vs test-only: `data/facts/EVENTS.md` |
| **G2 Calibration** | ✅ PASS (v0), refined in v1 | Demand model RMSE 2.6 GW. Predicted 2011 winter peak 57,235 vs 57,284 MW observed; Jan 2018 66.1k vs 65.8k. Best v0 fit: **2011 sim peak shed 4,956 MW vs 4,948 MW actual**, 8 h vs 7.4 h, coal loss 4.6 vs 5.2 GW, quiet winters 1 false hour. Adding Dec 1989 as a second extreme-cold point showed the single-curve trip model can't fit both events → v1 change #1 |
| **G3 Difficulty** | ✅ PASS | **v1 LLM operator collapses the grid** (both runs, below). Scripted good strategy (2011-report lessons: winterization, critical-load map, anticipation) beats the scripted pre-2021 ERCOT procedure ("status quo") by **2×** (135M vs 266M customer-hours) |
| **G4 Validity** (informational, never tuned) | ✅ in range | Status quo in sim: 266M customer-hours, 35 GW peak shed. Real 2021: ~222M customer-hours (14 GW avg × 70.5 h × 225/MW), 20 GW peak. Same order of magnitude. Earlier v0 variants ranged 177M–643M, so model uncertainty is about ±50% |
| **G5 Recognition** | ✅ PASS for the operator | Anonymized Feb 2021 daily table → **Qwen3-30B (operator): 0/5** (confidently "UK, Big Freeze 2010"); with real labels 5/5. **DeepSeek-V4-Pro: 5/5 even anonymized.** Frontier models can recognize it, which is why runs B and D exist |
| **G6 Run B** | ✅ PASS | Same frozen Qwen3-30B, v1 harness: **A (anonymized) → collapse**; it refused to shed load at −4 to −11 GW reserves ("import and precommit to stabilize"). **B (told "ERCOT, Winter Storm Uri, Feb 2021, use everything you know") → collapse**; it shed too little, too late and erratically (10 GW → 18 GW → 1 GW). Knowing history ≠ having instruments |

## Calibration-safe inputs used (all pre-2021, from data/facts/EVENTS.md)
- 2011: 4,948 MW max shed over 7 h 24 min; 12,413 MW scheduled outages; gas-supply outages ~1,282 MW; demand without shedding ~59,000 MW.
- 1989: ~54 GW fleet; 11,809 MW net / 16,805 MW gross lost; 1,710 MW shed; peak 38,300 MW.
- Under-frequency load shedding 5/15/25% at 59.3/58.9/58.5 Hz; generator trip after 9 min at ≤ 59.4 Hz; responsive reserve 2,300 MW.
- Electric–gas feedback upper bound derived from 2011 (4.9 GW shed ↔ ~1.3 GW gas outages) → 0.06 per unit shed fraction.

## Known limitations found
1. A single temperature-hazard curve can't fit both 2011 (moderate cold, many frozen sensing lines) and 1989 (extreme cold).
2. Supply changes too smoothly from hour to hour, so frequency never dips for scripted policies. Real grids lose 500–1,300 MW units abruptly.
3. In the 2021 window the sim shows tight hours already on Feb 9–10 (reality: Feb 14–15). Test data, so not tuned; noted for G4.
4. 1989 fleet split by fuel is approximated.

## Simulator v1 changes (tonight, before the calibration lock)
1. **Vulnerable-fraction unit model:** each thermal unit is winterized or not; non-winterized units fail at their own threshold temperature (distribution calibrated on 2011 + 1989 + Jan 2014's 9,355 MW / no-shed). Winterization (a build lever) shrinks the vulnerable pool.
2. **Unit-level lumpy trips** at random minutes within the hour (seeded) → real frequency excursions. Calibrate frequency sensitivity on 2011's 59.576 Hz and 1989's 59.65 Hz minimums.
3. Seasonal planned outages (higher from February, matching the 2011 report).
4. Multi-seed evaluation (deterministic per seed) for gates and scores.

Then **lock**: commit the simulator plus calibrated params, record the hash in PLAN.md, and only then start evolution.

## Files
`sim_v0.py` (simulator) · `run_feasibility.py` (fit, calibration, 2021 tests) · `recognition_probe.py` · `llm_runs.py` · `model_smoke.py` · `check_keys.py` · `out/` (reports, hourly CSVs, LLM decision logs)
