# Replay format `437-replay/1`

One JSON file per simulated run. Written by the simulator exporter. Read by the 3D viewer (live demo) and the Blender driver script (video). **Every visual state comes from these files**, never hand-set.

```jsonc
{
  "format": "437-replay/1",
  "meta": {
    "run_id": "r_20261010_0412",
    "label": "Gen 1 manual",                    // shown on screen
    "scenario_id": "syn_freeze_long_03",         // internal id
    "scenario_public": "Practice storm #3",      // what the AUDIENCE sees (the agent saw an anonymized view)
    "is_locked_test": false,
    "harness": {"id": "h_001", "generation": 1, "hash": "sha256:…"},
    "model": {"operator": "Qwen/Qwen3-30B-A3B-Instruct-2507", "weights_frozen": true, "fine_tune_runs": 0},
    "seed": 7,
    "fleet_year": 2011,
    "start_utc": "2011-02-01T00:00:00Z",
    "hours": 192,
    "regions": [{"id": "houston", "name": "Houston", "lat": 29.76, "lon": -95.37}],   // the 8 weather points
    "collapsed": false,
    "collapse_hour": null,
    "totals": {"homes_dark_hours": 1.2e7, "peak_homes_dark": 1.1e6, "min_freq_hz": 59.58}
  },
  "frames": [
    {
      "h": 0,
      "t": "2011-02-01T00:00:00Z",
      "local": "2011-01-31 18:00 CST",
      "freq_hz": 60.0,               // end-of-hour frequency
      "freq_min_hz": 59.97,          // minimum within the hour
      "countdown_s": null,           // seconds left on the 9-minute ≤59.4 Hz rule; null when not counting
      "demand_mw": 52000, "supply_mw": 55000, "reserve_mw": 3000,
      "shed_mw": 0, "shed_frac": 0.0, "homes_dark": 0,
      "fuel_avail_frac": {"gas": 0.92, "coal": 0.95, "nuclear": 1.0, "wind": 0.31, "solar": 0.0},
      "gas_supply_frac": 1.0,        // share of the gas fleet that has fuel
      "regions": {"houston": {"temp_c": 3.1, "snow_cm": 0.0, "wind_ms": 4.2}},
      "zones": {"zone_01": 1, "zone_16": 1, "zone_crit": 1, "zone_gas": 1},    // 0/1 (zone_crit may be 0.3 = backup power)
      "turbines_running": 0.8,
      "gas_plant_on": 1.0,
      "line_glow": 1.0,
      "snow_amount": 0.0,
      "frost_amount": 0.0,
      "sky_time": 0.5,               // 0 afternoon · 0.5 dusk · 1 night (from local hour)
      "events": [
        {"type": "shed_start", "text": "Rolling outages begin: 3,000 MW"},
        {"type": "recall", "text": "Recalled from MongoDB: season 1 freeze lesson", "ref": "page_007"}
      ]
    }
  ]
}
```

**Event types:**
- `trip`
- `shed_start`
- `shed_end`
- `ufls` (automatic under-frequency shedding)
- `collapse`
- `llm_call`
- `recall`
- `sensor_alert`
- `false_all_clear`
- `build` (pre-season investment)

## Mapping rules (simulator → visual controls)

- **Zones:** `round(shed_frac × 16)` of the 16 city zones are dark, chosen in a rotating order that advances every 2 hours, so neighborhoods take turns.
  - `zone_crit` stays at 1 during rolling outages, and drops to 0.3 (backup generators) only on collapse.
  - `zone_gas` goes dark whenever shedding is on **unless** the harness protects critical gas load.
  - On collapse, all city zones are 0 and `zone_gas` is 0.
- **gas_plant_on** = `gas_supply_frac`.
- **turbines_running** = `fuel_avail_frac.wind` relative to that season's normal (icing stops rotors).
- **line_glow** = `supply_mw / max(supply_mw over run)`.
- **snow_amount** = clip(region-mean `snow_cm` accumulated / 10, 0, 1). **frost_amount** = clip((0 − region-mean temp_c) / 10, 0, 1).
- **sky_time** from local hour: 0 for 08–16, 0.5 at 18, 1 for 21–05, linear ramps in between.

Files: `viewer/public/replays/*.json`. A run's frames can be thinned to 1 per hour (already hourly). Keep files under ~2 MB.
