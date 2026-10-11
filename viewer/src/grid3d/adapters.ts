// Adapters: recorded replays (`437-replay/1`) and live SSE "hour" messages -> GridFrame,
// plus interpolation between hourly frames.
import type { Frame, Replay } from "../lib/replay";
import { zonesFromShed } from "../lib/replay";
import type { FuelAvail, GridEvent, GridFrame } from "./types";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Default gas fleet size (MW) when a replay has no gas_feedback event to derive it from. */
export const DEFAULT_GAS_FLEET_MW = 52_000;
/** Homes in the simulated grid (the replays cap peak_homes_dark at 11 million). */
export const TOTAL_HOMES = 11_000_000;

function localHourOf(local: string | undefined): number {
  const m = /[ T](\d{2}):(\d{2})/.exec(local ?? "");
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

function fuelOf(src: Partial<Record<string, number>> | undefined): FuelAvail {
  return {
    gas: clamp01(num(src?.gas, 1)),
    coal: clamp01(num(src?.coal, 1)),
    nuclear: clamp01(num(src?.nuclear, 1)),
    wind: clamp01(num(src?.wind, 0)),
    solar: clamp01(num(src?.solar, 0)),
  };
}

// ------------------------------------------------------------------ replay (437-replay/1)

/**
 * Running state for sequential replay conversion. The replay has no direct "well production"
 * or "turbines iced" series, so both are APPROXIMATED from events:
 *  - gasProduction = 1 - (latest `freeze_off` production_loss), held while it is cold, easing back
 *    slowly (0.4 %/h) when frost_amount < 0.15.
 *  - windOk = 1 - (latest `icing` share_stopped), held while frost_amount >= 0.3, else easing back.
 * gasSupply is exact (gas_supply_frac).
 */
export interface ReplayCtx {
  prodLoss: number;
  iced: number;
  collapsed: boolean;
  collapseHour: number | null;
  gasFleetMw: number;
}

export function newReplayCtx(r?: Replay): ReplayCtx {
  let fleet = DEFAULT_GAS_FLEET_MW;
  if (r) {
    for (const f of r.frames) {
      for (const e of f.events ?? []) {
        const d = e.data as { mw?: number; gas_fleet_share?: number } | undefined;
        if (e.type === "gas_feedback" && d?.mw && d.gas_fleet_share && d.gas_fleet_share > 0.002) {
          fleet = d.mw / d.gas_fleet_share;
          break;
        }
      }
      if (fleet !== DEFAULT_GAS_FLEET_MW) break;
    }
  }
  return { prodLoss: 0, iced: 0, collapsed: false, collapseHour: r?.meta.collapse_hour ?? null, gasFleetMw: fleet };
}

/**
 * One replay frame -> GridFrame. Pass the same `ctx` for consecutive frames (see gridFramesFromReplay)
 * so the event-derived series (well production, iced turbines, collapse) carry over.
 */
export function frameFromReplay(f: Frame, ctx: ReplayCtx = newReplayCtx()): GridFrame {
  const events: GridEvent[] = (f.events ?? []).map((e) => ({ type: String(e.type), text: e.text ?? "" }));
  const frost = clamp01(num(f.frost_amount, 0));
  for (const e of f.events ?? []) {
    const d = (e.data ?? {}) as Record<string, number>;
    if (e.type === "freeze_off" && typeof d.production_loss === "number") ctx.prodLoss = clamp01(d.production_loss);
    if (e.type === "icing" && typeof d.share_stopped === "number") ctx.iced = clamp01(d.share_stopped);
    if (e.type === "collapse") ctx.collapsed = true;
  }
  if (!events.some((e) => e.type === "freeze_off") && frost < 0.15) ctx.prodLoss = Math.max(0, ctx.prodLoss - 0.004);
  if (!events.some((e) => e.type === "icing") && frost < 0.3) ctx.iced = Math.max(0, ctx.iced - 0.03);
  if (ctx.collapseHour != null && f.h >= ctx.collapseHour) ctx.collapsed = true;
  const collapsed = ctx.collapsed;
  const zones = { ...(f.zones ?? zonesFromShed(f, collapsed)) };
  const temps = Object.values(f.regions ?? {}).map((r) => r.temp_c);
  const tempC = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 0;
  return {
    h: f.h,
    localHour: localHourOf(f.local),
    localTime: f.local,
    tempC,
    snow: clamp01(num(f.snow_amount, 0)),
    frost,
    freqHz: num(f.freq_hz, collapsed ? 0 : 60),
    freqMinHz: f.freq_min_hz ?? undefined,
    countdownS: f.countdown_s ?? null,
    demandMw: num(f.demand_mw, 0),
    supplyMw: num(f.supply_mw, 0),
    reserveMw: num(f.reserve_mw, 0),
    shedFrac: clamp01(num(f.shed_frac, 0)),
    homesDark: num(f.homes_dark, 0),
    zones,
    fuel: fuelOf(f.fuel_avail_frac),
    gasProduction: clamp01(1 - ctx.prodLoss),
    gasSupply: clamp01(num(f.gas_supply_frac, 1)),
    // The replay has no explicit flag; zone_gas follows it (dark only when outages hit unprotected gas facilities).
    protectGas: (zones.zone_gas ?? 1) >= 0.5,
    collapsed,
    events,
    windOk: clamp01(1 - ctx.iced),
    gasFleetMw: ctx.gasFleetMw,
  };
}

/** Whole replay -> GridFrame per hour (index = hour). */
export function gridFramesFromReplay(r: Replay): GridFrame[] {
  const ctx = newReplayCtx(r);
  return r.frames.map((f) => frameFromReplay(f, ctx));
}

// ------------------------------------------------------------------ live SSE (scripts/live_server.py)

export interface LiveHourMsg {
  type: "hour";
  label: string;
  h: number;
  stamp?: string;
  local_hour?: number;
  shed_frac: number;
  gas_avail_frac?: number | null;
  protect_gas?: boolean;
  fuel_avail?: Partial<Record<string, number>>;
  outages_by_fuel_mw?: Record<string, number>;
  gas_production_frac?: number;
  snow_cm?: number;
  wind_ms?: number;
  wind_ok_frac?: number;
  demand_mw: number;
  supply_mw: number;
  reserve_mw: number;
  shed_mw?: number;
  freq_min_hz?: number;
  below_59_4_min?: number;
  countdown_s?: number | null;
  homes_dark?: number | null;
  temp_c?: number;
  action?: string;
  events?: { type: string; actor?: string; text?: string }[];
}

/** Running state for one live side (snow accumulation, collapse latch). */
export interface LiveCtx {
  snowAcc: number;
  collapsed: boolean;
}

export const newLiveCtx = (): LiveCtx => ({ snowAcc: 0, collapsed: false });

function liveLocalTime(stamp: string | undefined, localHour: number | undefined): string | undefined {
  if (!stamp) return undefined;
  const iso = /Z|[+-]\d\d:?\d\d$/.test(stamp) ? stamp.replace(" ", "T") : `${stamp.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  const lh = localHour ?? d.getUTCHours();
  const offset = ((d.getUTCHours() - Math.floor(lh)) % 24 + 24) % 24; // hours behind UTC
  const ld = new Date(t - offset * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ld.getUTCFullYear()}-${p(ld.getUTCMonth() + 1)}-${p(ld.getUTCDate())} ${p(ld.getUTCHours())}:00 CT`;
}

/**
 * One live "hour" message -> GridFrame. Keep one `ctx` per side (label) across messages.
 * Approximations (the full replay fetched after "done" has the exact values):
 *  - zones: round(shed_frac x 16) districts dark, rotating every 2 hours (same rule as the replays);
 *    zone_gas lit when protect_gas or no outages.
 *  - gasSupply ~ gas_production_frac x (compressor powered ? 1 : 0.6).
 *  - freqHz = freq_min_hz (the stream only carries the lowest frequency of the hour).
 */
export function frameFromLive(msg: LiveHourMsg, ctx: LiveCtx = newLiveCtx()): GridFrame {
  const events: GridEvent[] = (msg.events ?? []).map((e) => ({ type: e.type, text: e.text ?? "" }));
  if (events.some((e) => e.type === "collapse")) ctx.collapsed = true;
  const collapsed = ctx.collapsed;
  const shed = clamp01(num(msg.shed_frac, 0));
  const tempC = num(msg.temp_c, 0);
  ctx.snowAcc = Math.max(0, ctx.snowAcc + num(msg.snow_cm, 0) - (tempC > 1 ? 0.25 * Math.min(4, tempC) : 0.01));
  const zones = zonesFromShed({ h: msg.h, shed_frac: shed } as unknown as Frame, collapsed);
  const gasPowered = !collapsed && (!!msg.protect_gas || shed <= 0);
  zones.zone_gas = gasPowered ? 1 : 0;
  const prod = clamp01(num(msg.gas_production_frac, 1));
  const freqMin = num(msg.freq_min_hz, collapsed ? 0 : 60);
  return {
    h: msg.h,
    localHour: num(msg.local_hour, 0),
    localTime: liveLocalTime(msg.stamp, msg.local_hour),
    tempC,
    snow: clamp01(ctx.snowAcc / 10),
    frost: clamp01(-tempC / 10),
    freqHz: collapsed ? 0 : freqMin,
    freqMinHz: freqMin,
    countdownS: msg.countdown_s ?? null,
    demandMw: num(msg.demand_mw, 0),
    supplyMw: num(msg.supply_mw, 0),
    reserveMw: num(msg.reserve_mw, 0),
    shedFrac: shed,
    homesDark: num(msg.homes_dark, shed * TOTAL_HOMES),
    zones,
    fuel: fuelOf(msg.fuel_avail),
    gasProduction: prod,
    gasSupply: clamp01(prod * (gasPowered ? 1 : 0.6)), // approximate
    protectGas: !!msg.protect_gas,
    outagesMw: msg.outages_by_fuel_mw,
    collapsed,
    events,
    windOk: msg.wind_ok_frac != null ? clamp01(msg.wind_ok_frac) : undefined,
    gasFleetMw: DEFAULT_GAS_FLEET_MW,
  };
}

// ------------------------------------------------------------------ interpolation

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame between two hourly frames (t in 0..1). Discrete fields (zones, events, flags) come from `a`. */
export function lerpGridFrame(a: GridFrame, b: GridFrame, t: number): GridFrame {
  if (t <= 0 || a === b) return a;
  const tt = Math.min(1, t);
  let freq = lerp(a.freqHz, b.freqHz, tt);
  if (b.collapsed && !a.collapsed) freq = lerp(a.freqHz, Math.min(a.freqHz, 58.6), tt);
  else if (b.freqMinHz != null && b.freqMinHz < freq && !b.collapsed) freq -= (freq - b.freqMinHz) * Math.pow(Math.sin(Math.PI * tt), 1.5);
  let countdown: number | null = null;
  if (a.countdownS != null) {
    const next = b.countdownS ?? (b.collapsed ? 0 : a.countdownS);
    countdown = Math.max(0, lerp(a.countdownS, next, tt));
  }
  let dh = b.localHour - a.localHour;
  if (dh < -12) dh += 24;
  if (dh > 12) dh -= 24;
  return {
    ...a,
    h: a.h + tt,
    localHour: (a.localHour + dh * tt + 24) % 24,
    tempC: lerp(a.tempC, b.tempC, tt),
    snow: lerp(a.snow, b.snow, tt),
    frost: lerp(a.frost, b.frost, tt),
    freqHz: freq,
    countdownS: countdown,
    demandMw: lerp(a.demandMw, b.demandMw, tt),
    supplyMw: lerp(a.supplyMw, b.supplyMw, tt),
    reserveMw: lerp(a.reserveMw, b.reserveMw, tt),
    homesDark: lerp(a.homesDark, b.homesDark, tt),
    fuel: {
      gas: lerp(a.fuel.gas, b.fuel.gas, tt),
      coal: lerp(a.fuel.coal, b.fuel.coal, tt),
      nuclear: lerp(a.fuel.nuclear, b.fuel.nuclear, tt),
      wind: lerp(a.fuel.wind, b.fuel.wind, tt),
      solar: lerp(a.fuel.solar, b.fuel.solar, tt),
    },
    gasProduction: lerp(a.gasProduction, b.gasProduction, tt),
    gasSupply: lerp(a.gasSupply, b.gasSupply, tt),
    windOk: a.windOk != null && b.windOk != null ? lerp(a.windOk, b.windOk, tt) : a.windOk,
  };
}

/** Smoothly sample hourly frames (index = hour) at a fractional hour. */
export function sampleGridFrames(frames: GridFrame[], hour: number): GridFrame | null {
  if (!frames.length) return null;
  const hMax = frames.length - 1;
  const hh = Math.max(0, Math.min(hMax, hour));
  const i = Math.floor(hh);
  const j = Math.min(hMax, i + 1);
  return lerpGridFrame(frames[i], frames[j], hh - i);
}
