# 4:37 simulator v1 (`sim/`)

Unit-level ERCOT winter grid model, run hour by hour, with minute-level frequency in stressed hours. It is calibrated on
**pre-2021 data only** (`params_v1.json`, report in `out/calibration_report.json`). `sim/data.py` refuses to load anything
dated 2021-01-01 or later (`HonestyError`).

```python
from sim import api, policies
from sim.scenarios import TRAIN_IDS, HELDOUT_IDS, GATE_IDS

r = api.run("heldout_flash_2014", policies.GoodScriptedPolicy(), seed=0)
r.passed, r.verdict_plain          # True, "Passed: worst moment 10% of homes dark, no blackout"
r.cause_summary                    # physics-computed causal chain (never the LLM)
r.events[:3]                       # [{h, type, text_plain, data}, ...] for the UI
r.frame()                          # hourly pandas DataFrame

m = api.run_many("heldout_flash_2014", policies.StatusQuoPolicy())   # seeds [0, 1, 2]
m["passed_seeds"], m["storm_passed"], m["mean"]["peak_shed_frac"]
```

Python: `D:\dev\MongoDB\.venv\Scripts\python.exe`. Tools: `python -m sim.g3` (difficulty table, writes `out/g3_final.json`),
`python -m sim.bench` (timing, `out/bench.json`), `python -m sim.export_replay` (dev replays), `python -m sim.calibrate`
(re-fit the calibration; **do not run after the lock**).

## Pass / fail (the scoreboard)

**A storm run is PASSED if the grid never totally collapses AND at the worst hour at least 80% of homes still have
power**, meaning peak shed is at most 20% of that hour's demand. `Result.peak_shed_frac` is the maximum over hours (before any collapse) of
`shed_mw / demand`. Shed includes rolling outages, automatic under-frequency shedding and real-time desk shedding.

`Result.verdict_plain` is one line for the UI:
- `Passed: worst moment 12% of homes dark, no blackout` (or `Passed: no homes lost power, no blackout`)
- `Failed: total blackout at hour 61`
- `Failed: 34% of homes dark at the worst hour (hour 86)`

A **storm** counts as passed for a policy when a majority of its seeds pass (2 of 3), as in `run_many()["storm_passed"]`
and `g3.py`.

## Entry points (`sim.api`)

| call | returns |
|---|---|
| `run(scenario, policy, seed=0, params=None, capital_budget=None)` | `Result`. `scenario` is an id string or a `Scenario`. Deterministic per seed. All policies on the same seed see the same weather, thresholds, trip minutes and repair times (common random numbers). |
| `run_many(scenario, policy, seeds=None, ...)` | `{"scenario_id", "policy", "seeds", "results": [Result], "mean": {homes_dark_hours, peak_shed_mw, peak_shed_frac, min_freq, unnecessary_homes_hours, collapse_rate, pass_rate, score, cost_usd}, "passed_seeds", "storm_passed"}` |

Worlds (the seed-independent weather, demand and accumulator arrays) are cached per scenario and params, so extra seeds and
policies only pay the simulation time.

## Policy protocol (frozen)

```python
class MyPolicy:
    name = "my_policy"
    def build(self, season_info: dict) -> BuildPlan | dict: ...   # once, before the storm (pre-season investments)
    def act(self, obs: dict) -> dict: ...                          # every hour; returns hourly actions (keys below)
    def reset(self): ...                                           # optional; called before each run (after build)
```

`season_info` = `{fleet_year, capacity_mw: {gas, coal, nuclear, other, wind, solar}, units: {gas, coal, nuclear, other},
storage_mw, capital_budget_usd (default 1e9), scenario_hours, levers}`. Reference policies are in `sim.policies`:
`NaivePolicy` (sheds only the deficit it sees now), `StatusQuoPolicy` (the pre-2021 ERCOT emergency procedure, also used by
calibration; do not edit) and `GoodScriptedPolicy` (an operator who read the 2011 report).

## `obs`: what the operator sees at the top of hour `i`

These are state readings at the end of the previous hour plus the current demand. Nothing in `obs` is future truth. The
harness must anonymize `ts`, region and fuel names before showing them to an LLM (PLAN.md section 4.6).

| key | type, unit | meaning |
|---|---|---|
| `hour` | int | hours since scenario start (0-based) |
| `day_index` | int | 0-based local (US/Central) calendar day of the scenario |
| `ts` | pd.Timestamp (UTC) | real timestamp, **anonymize before showing** |
| `local_hour` | int 0-23 | US/Central hour |
| `weekday` | int 0-6 | Monday = 0 |
| `demand_now` | MW | this hour's demand before conservation, demand response and shedding (includes cold-load pickup) |
| `supply_now` | MW | available supply at end of last hour: thermal available + wind + solar + extra reserve units (excludes imports and battery) |
| `supply_trend_1h` | MW | change in `supply_now` over the previous hour (negative = falling) |
| `reserve_now` | MW | `supply_now - (demand_now - shed_now)` |
| `reserve_target_mw` | MW | 2,300 (responsive reserve minimum) |
| `shed_now` | MW | load currently shed (controlled + automatic + real-time) |
| `homes_dark_now` | homes | `shed_now x 225` |
| `freq_last`, `freq_min_last` | Hz | end-of-hour and minimum frequency of the last hour |
| `below_59_4_min` | min | the generator-relay counter: cumulative minutes at or below 59.4 Hz (collapse when > 9) |
| `countdown_s` | s or None | seconds left before the 9-minute rule trips; None when not counting |
| `eea_last` | 0-3 | emergency level implied by last hour's reserves |
| `avail_by_fuel` | {fuel: MW} | gas, coal, nuclear, other, wind, solar available last hour |
| `capacity_by_fuel` | {fuel: MW} | installed capacity this season |
| `outages_by_fuel` | {fuel: MW} | forced (non-planned) thermal outages: gas, coal, nuclear, other |
| `temps_now` | {region: deg C} | 8 weather points, with sensor noise (sd 0.3 deg C) |
| `temp_now` | deg C | population-weighted temperature (noisy) |
| `wind_speed_now` | {region: m/s} | 10 m wind speed |
| `imports_max` | MW | DC-tie limit (1,200; 220 on the 1989 grid) |
| `battery_soc_mwh`, `battery_mw_max` | MWh, MW | battery state of charge and power limit (0 unless built) |
| `dr_available_mw`, `dr_energy_left_mwh` | MW, MWh | deployable demand response now and its remaining energy budget |
| `lr_mw` | MW | Load Resources that trip automatically at 59.7 Hz |
| `build` | dict | the BuildPlan in effect (after budget fitting) |

**Weather forecast** (computed on first access). A new forecast is issued every 6 h. Its error is a regionally
correlated random walk along lead time, with sd about 0.9 deg C at 1 h, 2.4 at 24 h, 3.2 at 48 h and 3.9 at 72 h (measured on season 2019/20).
**It is never ground truth.** Regions follow `sim.data.REGION_IDS` = houston, dallas, san_antonio, austin, midland,
sweetwater, corpus_christi, lubbock.

| key | type, unit | meaning |
|---|---|---|
| `forecast_min_temp_24h` / `_48h` / `_72h` | deg C | **statewide** (population-weighted) forecast minimum over the next 24/48/72 h |
| `forecast_min_temp_by_region_24h` / `_48h` / `_72h` | {region: deg C} | forecast minimum per region |
| `forecast_coldest_region_min_24h` / `_48h` / `_72h` | deg C | coldest forecast value in any region |
| `forecast` | dict | all of the above: `{"24h": {statewide_min_c, coldest_region_min_c, by_region_min_c}, "48h": ..., "72h": ..., "issued_hours_ago"}` |
| `forecast_issued_hours_ago` | int 0-5 | age of the forecast in use |
| `forecast_temp_72h` | ndarray (72, 8) deg C | hourly forecast by region, hours i+1 .. i+72 |
| `forecast_temp_pw_72h` | ndarray (72,) deg C | population-weighted hourly forecast |
| `forecast_temp_by_region_72h` | {region: [72 x deg C]} | JSON-friendly hourly forecast |
| `demand_forecast_72h` | ndarray (72,) MW | demand implied by the forecast temperatures |

`obs.keys_all()` lists every key, including the forecast keys that are computed on first access.

## Actions (`sim.levers`, FROZEN)

Hourly `act(obs)` returns a dict. Every key is optional; out-of-range values are clipped.

| key | range | effect |
|---|---|---|
| `conservation` | 0..0.03 | public appeal; demand x (1 - c) |
| `dr_mw` | MW | demand response to deploy (<= available; energy budget 24 h x contracted MW per scenario) |
| `battery_mw` | MW | + discharge / - charge |
| `precommit` | 0..1 | bring that share of offline gas units online now (avoids cold fail-to-start later; costs fuel) |
| `imports_mw` | 0..1,200 | DC-tie imports |
| `shed_mw` | MW | target controlled rolling-outage level; omit to keep the current level |
| `restore_mw` | MW | alternative to `shed_mw`: restore this much shed load |
| `rotation_min` | 10..240 | rotating-block length; long blocks cause cold-load pickup on restore |
| `protect_gas` | bool | keep gas facilities off the shed list (needs `critical_load_map`); stops the gas-compressor feedback |
| `emergency_level` | 0..3 | declared emergency level (logged only) |
| `rt_shed` | bool | let the real-time desk shed inside the hour (5-min lag, 100 MW/min) when supply < load |

Build levers (`build(season_info)` -> `BuildPlan` or dict; capital budget 1e9 USD, an over-budget plan is scaled down):
`winterize_plants {gas, coal, nuclear, other, wind: 0..1}`, `winterize_wells 0..1`, `firm_fuel 0..1`, `battery_mw`,
`battery_mwh`, `dr_mw`, `critical_load_map bool`, `extra_reserve_mw`. Costs and sources are in the `levers.py` docstring.

## `Result`

| field | meaning |
|---|---|
| `passed` (property), `verdict_plain` (property) | scoreboard verdict (see above) |
| `peak_shed_frac`, `worst_hour` | worst-hour shed share of demand, and its hour |
| `collapsed`, `collapse_hour`, `collapse_ts` | total blackout (generator relays: > 9 min at or below 59.4 Hz, or instantly below 58.4 Hz) |
| `homes_dark_hours`, `peak_homes_dark`, `peak_shed_mw`, `shed_hours` | outage size (homes = MW x 225; a collapse darkens all 11 M homes for the rest of the window) |
| `min_freq`, `max_below_59_4_min` | frequency extremes |
| `unnecessary_homes_hours` | homes x hours shed while reserves were above 2,300 MW (over-shedding) |
| `cost` | `{capex_usd, capex_items, capital_annualized_usd, dr_contract_usd, imports_usd, precommit_usd, total_usd}` |
| `score` | `{homes_dark_hours, collapse_penalty, unnecessary_shed, cost_homes_hours_equiv, total}` (lower is better) |
| `cause_chain`, `cause_summary` | physics-computed causes: a list of `{h, t, kind, text}` and a one-line chain ending in "TEXAS DARK" / "survived ..." / "lights stayed on" |
| `events` | UI events (below) |
| `build`, `budget_scale` | the BuildPlan used and the budget scale factor applied |
| `hourly` | dict of arrays: demand, demand_eff, supply, supply_min, reserve, shed_mw, shed_end, controlled_end, ufls_mw, rt_mw, freq_min, freq_end, below_min, eea, avail_{gas,coal,nuclear,other,wind,solar,extra}, out_cold, out_fuel, out_fts, out_bg, out_coal, planned, gas_short, gas_nofuel, prod_loss, feedback, imports, battery, soc, dr, lr, conservation, precommit_mw, clp, homes_dark, unprotected_frac, turbines_running, unnecessary_mw, trips_mw, protect_gas, rotation_min, ts |
| `extra` | `{gross_forced_mw, max_cold_run_h}` |
| `world`, `runtime_s`, `seed`, `policy`, `scenario_id` | bookkeeping. `frame()` gives a DataFrame and `summary()` a compact dict |

### Events (`Result.events`)

Each event is `{h, type, text_plain, data}`. `text_plain` is plain English for the audience, and `data` holds the numbers.

| type | when | example `text_plain` |
|---|---|---|
| `trip` | a unit of 400 MW or more goes out (up to 6 per hour) | "Power plant W A Parish froze up in the cold (988 MW lost)" (`data.reason`: frozen / no_fuel / failed_start / breakdown) |
| `freeze_off` | gas production loss passes 10 / 25 / 40% | "Gas wells are freezing in the cold: gas production down 25%" |
| `icing` | 25 / 50 / 75% of wind turbines stopped | "Ice and extreme cold are stopping wind turbines: 50% of them are idle" |
| `demand_surge` | demand passes 65 / 70 / 75 / 80 GW, or a synthetic surge starts | "Heating demand surges to 70,038 MW as people crank up heaters" |
| `shed_start` / `shed_end` | rolling outages begin / end | "Rolling blackouts begin: 3,566 MW cut, about 800,000 homes take turns without power" |
| `restore` | 2 GW or more of shed load reconnected, or 3 GW or more of frozen or fuel-starved plants back (rate-limited to one every 6 h) | "Power coming back: about 450,000 homes reconnected" |
| `ufls` | an automatic under-frequency stage fires | "Emergency: the grid's frequency fell dangerously low, so automatic safety switches cut power to 5% of homes" |
| `gas_feedback` | unprotected shedding starves gas plants by 0.5 / 2 / 5 GW or more | "The blackouts also cut power to gas pipeline pumps, so even less gas reaches power plants: 2.0 GW more of them go short of fuel" |
| `collapse` | total blackout | "Total blackout: the grid collapsed and the whole state went dark" |
| `build` | hour 0, if anything was built | "Before the storm: weatherproofed 70% of gas plants; ..." |

The replay exporter (`export_replay.py`, format in `docs/REPLAY_FORMAT.md`) writes these as `{type, text, data}` per frame.

## Scenarios (`sim.scenarios`)

All weather is pre-2021: ERA5 2007-2020, plus the Dec 1989 Open-Meteo JSON. Synthetic storms transform real windows
with `shift` (colder), `stretch` (longer), `geo` (move the cold), `flash` (sudden plunge), `precip` (freezing drizzle,
which ices turbines), `wind` (stronger wind chill), `demand` (surge) and `relabel` (same weather on another pre-2021
calendar date, e.g. in the February maintenance season). Storm severity was tuned **only** against the scripted reference policies. The
calibration was not touched.

- `TRAIN_IDS`: 9 storms used for evolution.
- `HELDOUT_IDS`: 8 storms, the practice exam ("0/8 -> ?/8"). **Never used for evolution.** They come from different source windows
  (Jan 2018, Jan 2014, Mar 2014, Feb 2007), or have a different timing and failure mode (the 1989-based one).
- `GATE_IDS`: real no-shed days used as a no-regression / "don't over-shed" gate: `gate_2011_feb10` (Feb 10, 2011), `gate_2018_jan17`
  (Jan 17, 2018) and `hist_2014_jan` (Jan 6-7, 2014). Also available: `hist_2011_feb` and `hist_1989_dec` (calibration),
  `quiet_*` winters and `season(year)` for year <= 2020.

The difficulty spread (`python -m sim.g3`, 3 seeds, storm passed = 2 of 3 seeds):

| set | naive | status quo | good scripted |
|---|---|---|---|
| train (9) | 0/9 | 0/9 | 9/9 |
| held-out (8) | 0/8 (one collapse on `heldout_flash_2014` seed 2) | 0/8 | 8/8 |
| gate (3) | 3/3 | 3/3 | 3/3 |

Each storm's `failure_modes` and `description` are in `scenarios.py`. Coverage per failure mode is in `out/g3_final.json`.

## Timing (no LLM calls; `out/bench.json`)

One full season (2019/20, 2,904 h) takes about 0.55-0.62 s of simulation plus 0.13 s to build the world (cached). One 168-h storm window takes
about 0.04 s. A G3 sweep (20 scenarios x 3 policies x 3 seeds, single process) takes about 10 s.
