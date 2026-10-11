"""Export a simulator Result to the `437-replay/1` JSON format (docs/REPLAY_FORMAT.md).

    .venv/Scripts/python.exe -m sim.export_replay            # writes the dev replays
    from sim.export_replay import export_replay; export_replay(result, path, label="Gen 1 manual")

Mapping rules implemented exactly as specified:
  zones       round(shed_frac x 16) of 16 city zones dark, chosen in a rotating order that advances
              every 2 hours; zone_crit stays 1 during rolling outages and drops to 0.3 only on collapse;
              zone_gas is dark whenever shedding is on unless critical gas load is protected; on collapse
              every city zone and zone_gas are 0
  gas_plant_on    = gas_supply_frac
  turbines_running = wind availability relative to the run's normal (no-icing) wind CF
  line_glow   = supply_mw / max(supply_mw over run)
  snow_amount = clip(region-mean accumulated snow_cm / 10, 0, 1); frost_amount = clip((0 - mean temp)/10, 0, 1)
  sky_time    0 for 08-16, 0.5 at 18, 1 for 21-05, linear ramps in between (local hour)
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np

from . import data as D

FORMAT = "437-replay/1"
ROOT = D.ROOT
REPLAY_DIR = os.path.join(ROOT, "viewer", "public", "replays")
N_ZONES = 16


def sky_time(local_hour: float) -> float:
    h = local_hour % 24
    if 8 <= h <= 16:
        return 0.0
    if 16 < h < 18:
        return 0.5 * (h - 16) / 2.0
    if 18 <= h < 21:
        return 0.5 + 0.5 * (h - 18) / 3.0
    if h >= 21 or h <= 5:
        return 1.0
    return 1.0 - (h - 5) / 3.0  # 05 -> 08 ramps 1 -> 0


def _r(x, nd=1):
    return None if x is None else round(float(x), nd)


def build_replay(res, label: str | None = None, scenario_public: str | None = None, harness: dict | None = None,
                 model: dict | None = None, run_id: str | None = None) -> dict:
    w = res.world
    if w is None:
        raise ValueError("Result has no world attached (run with keep_world=True)")
    H = res.hourly
    n = w.n
    fl = w.fleet
    capf = fl.cap_by_fuel()
    ts = w.ts
    local = ts.tz_convert("US/Central")
    supply = np.array(H["supply"], dtype=float)
    if res.collapsed:
        supply[res.collapse_hour + 1:] = 0.0
    smax = float(max(supply.max(), 1.0))
    wcap = capf["wind"]
    normal_cf = float(np.mean(w.wind_cf)) if wcap > 0 else 1.0
    temp, wind, snow = w.wx["temp"], w.wx["wind"], w.wx["snow"]
    protect_map = bool(res.build.get("critical_load_map"))
    ev_by_h: dict = {}
    for e in res.events:
        lst = ev_by_h.setdefault(int(e["h"]), [])
        if e["type"] == "trip" and sum(1 for x in lst if x["type"] == "trip") >= 3:
            continue
        ev = {"type": e["type"], "text": e.get("text_plain") or e.get("text", "")}
        if e.get("data"):
            ev["data"] = e["data"]
        lst.append(ev)
    frames = []
    pointer, last_block = 0, -1
    snow_acc = 0.0
    for i in range(n):
        dead = res.collapsed and i > res.collapse_hour
        at_collapse = res.collapsed and i >= res.collapse_hour
        demand = float(H["demand"][i])
        shed = float(H["shed_mw"][i]) if not at_collapse else demand
        shed_frac = min(1.0, shed / demand) if demand > 0 else 0.0
        if at_collapse:
            shed_frac = 1.0
        # zones: rotating order advancing every 2 hours
        k_dark = int(round(shed_frac * N_ZONES))
        block = i // 2
        if block != last_block:
            if last_block >= 0:
                pointer = (pointer + max(1, frames[-1]["_k"] if frames else 1)) % N_ZONES
            last_block = block
        dark = {(pointer + j) % N_ZONES for j in range(k_dark)}
        zones = {f"zone_{z + 1:02d}": (0 if (z in dark or at_collapse) else 1) for z in range(N_ZONES)}
        protected = protect_map and H["protect_gas"][i] > 0
        zones["zone_crit"] = 0.3 if at_collapse else 1
        zones["zone_gas"] = 0 if (at_collapse or (shed > 1.0 and not protected)) else 1
        gas_frac = 0.0 if at_collapse else 1.0 - float(H["gas_short"][i])
        if dead:
            fa = {"gas": 0.0, "coal": 0.0, "nuclear": 0.0, "wind": 0.0, "solar": 0.0}
        else:
            fa = {"gas": H["avail_gas"][i] / max(capf["gas"], 1), "coal": H["avail_coal"][i] / max(capf["coal"], 1),
                  "nuclear": H["avail_nuclear"][i] / max(capf["nuclear"], 1),
                  "wind": H["avail_wind"][i] / wcap if wcap > 0 else 0.0,
                  "solar": H["avail_solar"][i] / capf["solar"] if capf["solar"] > 0 else 0.0}
        tmean = float(temp[i].mean())
        snow_acc = max(0.0, snow_acc + float(snow[i].mean()) - (0.2 if tmean > 1.0 else 0.0))
        below = int(H["below_min"][i])
        countdown = None if (below <= 0 or dead) else max(0, int((9 - below) * 60))
        freq_end = 0.0 if dead else float(H["freq_end"][i])
        freq_min = 0.0 if dead else float(H["freq_min"][i])
        if res.collapsed and i == res.collapse_hour:
            freq_end, countdown = min(freq_min, 59.4), 0
        frame = {
            "h": i,
            "t": ts[i].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "local": local[i].strftime("%Y-%m-%d %H:%M ") + local[i].tzname(),
            "freq_hz": round(freq_end, 3), "freq_min_hz": round(freq_min, 3), "countdown_s": countdown,
            "demand_mw": round(demand), "supply_mw": round(float(supply[i])),
            "reserve_mw": round(float(H["reserve"][i])) if not dead else round(-demand),
            "shed_mw": round(shed), "shed_frac": round(shed_frac, 4),
            "homes_dark": round(float(H["homes_dark"][i])),
            "fuel_avail_frac": {k: round(float(min(1.0, max(0.0, v))), 3) for k, v in fa.items()},
            "gas_supply_frac": round(gas_frac, 3),
            "regions": {rid: {"temp_c": _r(temp[i, k]), "snow_cm": _r(snow[i, k], 2), "wind_ms": _r(wind[i, k])}
                        for k, rid in enumerate(D.REGION_IDS)},
            "zones": zones,
            "turbines_running": 0.0 if (dead or wcap <= 0) else round(float(min(1.0, (H["avail_wind"][i] / wcap) / max(normal_cf, 1e-6))), 3),
            "gas_plant_on": round(gas_frac, 3),
            "line_glow": round(float(supply[i]) / smax, 3),
            "snow_amount": round(min(1.0, max(0.0, snow_acc / 10.0)), 3),
            "frost_amount": round(min(1.0, max(0.0, -tmean / 10.0)), 3),
            "sky_time": round(sky_time(local[i].hour + local[i].minute / 60.0), 3),
            "events": ev_by_h.get(i, []),
            "_k": k_dark,
        }
        frames.append(frame)
    for f in frames:
        f.pop("_k")
    hh = res.homes_dark_hours
    pid = res.policy
    harness = harness or {"id": f"scripted_{pid}", "generation": 0,
                          "hash": "sha256:" + hashlib.sha256(pid.encode()).hexdigest()}
    model = model or {"operator": f"scripted:{pid}", "weights_frozen": True, "fine_tune_runs": 0}
    meta = {
        "run_id": run_id or f"r_dev_{res.scenario_id}_{pid}_s{res.seed}",
        "label": label or pid,
        "scenario_id": res.scenario_id,
        "scenario_public": scenario_public or w.public,
        "is_locked_test": False,
        "harness": harness,
        "model": model,
        "seed": res.seed,
        "fleet_year": int(fl.year),
        "start_utc": ts[0].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": n,
        "regions": [{"id": r[0], "name": r[1], "lat": r[2], "lon": r[3]} for r in D.REGIONS],
        "collapsed": bool(res.collapsed),
        "collapse_hour": res.collapse_hour,
        "totals": {"homes_dark_hours": float(f"{hh:.4g}"), "peak_homes_dark": round(res.peak_homes_dark),
                   "min_freq_hz": round(res.min_freq, 3)},
        "passed": bool(res.passed),
        "verdict_plain": res.verdict_plain,
        "peak_shed_frac": round(float(res.peak_shed_frac), 4),
        "cause_summary": res.cause_summary,
        "sim_version": "sim-v1",
    }
    return {"format": FORMAT, "meta": meta, "frames": frames}


def export_replay(res, path: str, **kw) -> str:
    rep = build_replay(res, **kw)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(rep, fh, separators=(",", ":"))
    return path


DEV_STORM = "heldout_flash_2014"   # chosen after the G3 check (g3_final.json): naive collapses on seed 2 (h60),
DEV_2011_SEED = 2
DEV_SEED = 2                        # good scripted passes all 3 seeds (seed 2: worst hour 18% of homes dark)


def main(argv=None):
    from . import run
    from .policies import GoodScriptedPolicy, NaivePolicy, StatusQuoPolicy
    argv = argv or sys.argv[1:]
    storm = argv[0] if argv else DEV_STORM
    seed = int(argv[1]) if len(argv) > 1 else DEV_SEED
    out = []
    # seed 2 of the calibration seeds (0-2): the one nearest the reported Feb 2011 event (4,948 MW peak shed, 7.4 h)
    r = run("hist_2011_feb", StatusQuoPolicy(), seed=DEV_2011_SEED)
    out.append(export_replay(r, os.path.join(REPLAY_DIR, "dev_2011_statusquo.json"),
                             label="Status quo (pre-2021 procedure)", scenario_public="February 2011 freeze"))
    short = storm.split("_", 1)[1] if storm.startswith(("heldout_", "train_", "syn_")) else storm
    prefix = "dev_heldout" if storm.startswith("heldout_") else "dev_syn"
    for pol, tag, label in [(NaivePolicy(), "naive", "Naive operator (scripted)"),
                            (GoodScriptedPolicy(), "good", "Good operator (scripted)")]:
        r = run(storm, pol, seed=seed)
        out.append(export_replay(r, os.path.join(REPLAY_DIR, f"{prefix}_{short}_{tag}.json"), label=label))
        print(tag, r.verdict_plain, "|", r.cause_summary)
    for p in out:
        print(f"wrote {p} ({os.path.getsize(p) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
