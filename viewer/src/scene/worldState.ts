// Per-view mutable state, recomputed once per rendered frame from (replay, clock hour).
// Scene components read it inside useFrame; nothing here is hand-set.
import { createContext, useContext } from "react";
import type { Replay } from "../lib/replay";
import {
  ZONE_IDS,
  frameIndex,
  fuelAvail,
  isCollapsedAt,
  lerpField,
  regionSnowDepth,
  regionSnowing,
  regionTemp,
  zonesAt,
} from "../lib/replay";
import { lonLatToXZ } from "../lib/geo";

export const MAX_REGIONS = 8;
/** Where the collapse wave starts (the I-35 corridor, the grid's load center). */
export const WAVE_ORIGIN = lonLatToXZ(-97.2, 31.3);
export const WAVE_SECONDS = 2.0;
export const WAVE_MAX_R = 95;

export interface WorldState {
  replay: Replay;
  hour: number;
  fi: number;
  /** Real seconds since start (shared across views via performance.now). */
  now: number;
  collapsed: boolean;
  collapseStart: number | null;
  /** Wave radius in world units (0 = not collapsing; >= WAVE_MAX_R = done). */
  waveR: number;
  /** 0..17: zone_01..zone_16, zone_crit, zone_gas — eased toward data for soft blinks. */
  zones: Float32Array;
  /** Zone values frozen at the moment of collapse (lights the wave has not reached yet). */
  preCollapseZones: Float32Array;
  regionCount: number;
  regionXZ: Float32Array; // 2 per region
  temps: Float32Array;
  snowing: Float32Array;
  snowDepth: Float32Array;
  wind: Float32Array;
  fuel: { gas: number; coal: number; nuclear: number; wind: number; solar: number };
  turbinesRunning: number;
  gasPlantOn: number;
  gasSupply: number;
  freqMin: number | null;
  skyTime: number;
  frost: number;
  /** Real time of the most recent sensor_alert reached by the playhead. */
  sensorAt: number;
}

export function createWorldState(replay: Replay): WorldState {
  const n = Math.min(MAX_REGIONS, replay.meta.regions.length);
  const regionXZ = new Float32Array(MAX_REGIONS * 2);
  replay.meta.regions.slice(0, n).forEach((r, i) => {
    const [x, z] = lonLatToXZ(r.lon, r.lat);
    regionXZ[i * 2] = x;
    regionXZ[i * 2 + 1] = z;
  });
  const zones = new Float32Array(18).fill(1);
  return {
    replay,
    hour: 0,
    fi: 0,
    now: 0,
    collapsed: false,
    collapseStart: null,
    waveR: 0,
    zones,
    preCollapseZones: new Float32Array(18).fill(1),
    regionCount: n,
    regionXZ,
    temps: new Float32Array(MAX_REGIONS),
    snowing: new Float32Array(MAX_REGIONS),
    snowDepth: new Float32Array(MAX_REGIONS),
    wind: new Float32Array(MAX_REGIONS),
    fuel: { gas: 1, coal: 1, nuclear: 1, wind: 1, solar: 0 },
    turbinesRunning: 1,
    gasPlantOn: 1,
    gasSupply: 1,
    freqMin: 60,
    skyTime: 1,
    frost: 0,
    sensorAt: -1e9,
  };
}

const ZKEYS = [...ZONE_IDS, "zone_crit", "zone_gas"];

export function updateWorldState(s: WorldState, hour: number, nowSec: number, dt: number): void {
  const r = s.replay;
  const prevFi = s.fi;
  s.hour = Math.min(hour, r.frames.length - 1);
  s.fi = frameIndex(r, s.hour);
  s.now = nowSec;
  const f = r.frames[s.fi];

  // Collapse + wave (real-time, ~2 s), re-armed if the playhead moves back before collapse.
  const collapsed = isCollapsedAt(r, s.hour);
  if (collapsed && !s.collapsed) {
    s.collapseStart = nowSec;
    s.preCollapseZones.set(s.zones);
  }
  if (!collapsed) s.collapseStart = null;
  s.collapsed = collapsed;
  s.waveR = s.collapseStart == null ? 0 : Math.min(WAVE_MAX_R * 1.2, ((nowSec - s.collapseStart) / WAVE_SECONDS) * WAVE_MAX_R);

  // Zones: ease toward data (fast, so rolling outages read as blinks).
  const z = zonesAt(r, s.hour);
  const k = 1 - Math.exp(-dt / 0.18);
  for (let i = 0; i < 18; i++) {
    const target = z[ZKEYS[i]] ?? 1;
    s.zones[i] += (target - s.zones[i]) * k;
  }

  for (let i = 0; i < s.regionCount; i++) {
    const id = r.meta.regions[i].id;
    s.temps[i] = regionTemp(r, s.hour, id);
    s.snowing[i] = regionSnowing(r, s.hour, id);
    s.snowDepth[i] = regionSnowDepth(r, s.hour, id);
    s.wind[i] = lerpField(r, s.hour, (fr) => fr.regions[id]?.wind_ms);
  }
  s.fuel.gas = fuelAvail(r, s.hour, "gas");
  s.fuel.coal = fuelAvail(r, s.hour, "coal");
  s.fuel.nuclear = fuelAvail(r, s.hour, "nuclear");
  s.fuel.wind = fuelAvail(r, s.hour, "wind");
  s.fuel.solar = fuelAvail(r, s.hour, "solar");
  s.turbinesRunning = lerpField(r, s.hour, (fr) => fr.turbines_running);
  s.gasPlantOn = lerpField(r, s.hour, (fr) => fr.gas_plant_on);
  s.gasSupply = lerpField(r, s.hour, (fr) => fr.gas_supply_frac);
  s.freqMin = f.freq_min_hz;
  s.skyTime = lerpField(r, s.hour, (fr) => fr.sky_time);
  s.frost = lerpField(r, s.hour, (fr) => fr.frost_amount);

  // Sensor alert pulse (only when the playhead moves forward through it).
  if (s.fi !== prevFi && s.fi > prevFi && s.fi - prevFi <= 3) {
    for (let i = prevFi + 1; i <= s.fi; i++) {
      if (r.frames[i].events?.some((e) => e.type === "sensor_alert")) s.sensorAt = nowSec;
    }
  }
}

/** CPU inverse-distance temperature at world (x, z) — same formula as the terrain shader. */
export function idw(s: WorldState, x: number, z: number, values: Float32Array): number {
  let wsum = 0;
  let vsum = 0;
  for (let i = 0; i < s.regionCount; i++) {
    const dx = x - s.regionXZ[i * 2];
    const dz = z - s.regionXZ[i * 2 + 1];
    const w = 1 / (dx * dx + dz * dz + 25);
    wsum += w;
    vsum += w * values[i];
  }
  return wsum > 0 ? vsum / wsum : 0;
}

/** 1 = lights on, 0 = the collapse wave has passed this point. */
export function waveLit(s: WorldState, x: number, z: number): number {
  if (s.waveR <= 0) return 1;
  const d = Math.hypot(x - WAVE_ORIGIN[0], z - WAVE_ORIGIN[1]);
  return Math.min(1, Math.max(0, (d - s.waveR + 4) / 4));
}

export const WorldCtx = createContext<WorldState | null>(null);
export function useWorld(): WorldState {
  const w = useContext(WorldCtx);
  if (!w) throw new Error("WorldCtx missing");
  return w;
}
