// Types + sampling for the `437-replay/1` format (docs/REPLAY_FORMAT.md).
// Every visual state in the viewer is derived from these frames.

export type FuelKey = "gas" | "coal" | "nuclear" | "wind" | "solar";

export interface RegionMeta {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RegionState {
  temp_c: number;
  snow_cm: number;
  wind_ms: number;
}

export type EventType =
  | "trip"
  | "shed_start"
  | "shed_end"
  | "ufls"
  | "collapse"
  | "llm_call"
  | "recall"
  | "sensor_alert"
  | "false_all_clear"
  | "build"
  | string;

export interface ReplayEvent {
  type: EventType;
  text?: string;
  ref?: string;
  [k: string]: unknown;
}

export interface Frame {
  h: number;
  t: string;
  local: string;
  freq_hz: number | null;
  freq_min_hz: number | null;
  countdown_s: number | null;
  demand_mw: number;
  supply_mw: number;
  reserve_mw: number;
  shed_mw: number;
  shed_frac: number;
  homes_dark: number;
  fuel_avail_frac: Partial<Record<FuelKey, number>>;
  gas_supply_frac: number;
  regions: Record<string, RegionState>;
  zones?: Record<string, number>;
  turbines_running: number;
  gas_plant_on: number;
  line_glow: number;
  snow_amount: number;
  frost_amount: number;
  sky_time: number;
  events?: ReplayEvent[];
}

export interface ReplayMeta {
  run_id: string;
  label: string;
  scenario_id?: string;
  scenario_public?: string;
  is_locked_test?: boolean;
  harness?: { id: string; generation: number; hash?: string };
  model?: { operator: string; weights_frozen?: boolean; fine_tune_runs?: number };
  seed?: number;
  fleet_year: number;
  start_utc: string;
  hours: number;
  regions: RegionMeta[];
  collapsed: boolean;
  collapse_hour: number | null;
  totals?: Record<string, number>;
  mock?: boolean;
}

export interface Replay {
  format: string;
  meta: ReplayMeta;
  frames: Frame[];
  /** Derived on load: accumulated snow depth (cm) per region per frame (melts above 0 °C). */
  snowDepth: Record<string, number[]>;
  /** File name it was loaded from. */
  file: string;
}

export const ZONE_IDS = Array.from({ length: 16 }, (_, i) => `zone_${String(i + 1).padStart(2, "0")}`);

const ZONE_ORDER = [3, 11, 7, 15, 1, 9, 5, 13, 2, 10, 6, 14, 4, 12, 8, 16];

/** Fallback when a frame has no `zones`: the REPLAY_FORMAT rotating rule. */
export function zonesFromShed(f: Frame, collapsed: boolean): Record<string, number> {
  const z: Record<string, number> = {};
  for (const id of ZONE_IDS) z[id] = 1;
  if (collapsed) {
    for (const id of ZONE_IDS) z[id] = 0;
    z.zone_crit = 0.3;
    z.zone_gas = 0;
    return z;
  }
  const nDark = Math.round(f.shed_frac * 16);
  const off = Math.floor(f.h / 2);
  for (let i = 0; i < nDark; i++) z[`zone_${String(ZONE_ORDER[(off + i) % 16]).padStart(2, "0")}`] = 0;
  z.zone_crit = 1;
  z.zone_gas = f.shed_frac > 0 ? 0 : 1;
  return z;
}

export async function loadReplay(file: string): Promise<Replay> {
  const url = file.includes("/") ? file : `${import.meta.env.BASE_URL}replays/${file}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Replay ${file}: HTTP ${res.status}`);
  const doc = (await res.json()) as Omit<Replay, "snowDepth" | "file">;
  if (!doc.format?.startsWith("437-replay/")) throw new Error(`Replay ${file}: unexpected format ${doc.format}`);
  if (!doc.frames?.length) throw new Error(`Replay ${file}: no frames`);
  const snowDepth: Record<string, number[]> = {};
  for (const r of doc.meta.regions) {
    let acc = 0;
    snowDepth[r.id] = doc.frames.map((f) => {
      const s = f.regions[r.id];
      if (!s) return acc;
      acc = Math.max(0, acc + (s.snow_cm || 0) - (s.temp_c > 1 ? 0.25 * Math.min(4, s.temp_c) : 0.01));
      return acc;
    });
  }
  return { ...doc, snowDepth, file };
}

export async function listReplays(): Promise<string[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}replays/index.json`, { cache: "no-store" });
    if (!res.ok) return [];
    const j = (await res.json()) as { files?: string[] };
    return j.files ?? [];
  } catch {
    return [];
  }
}

export function isCollapsedAt(r: Replay, hour: number): boolean {
  const ch = r.meta.collapse_hour;
  if (ch != null && hour >= ch) return true;
  return false;
}

export function frameIndex(r: Replay, hour: number): number {
  return Math.max(0, Math.min(r.frames.length - 1, Math.floor(hour)));
}

/** Linear interpolation of a numeric frame field at fractional `hour`. */
export function lerpField(r: Replay, hour: number, get: (f: Frame) => number | null | undefined): number {
  const i = frameIndex(r, hour);
  const j = Math.min(r.frames.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, hour - i));
  const a = get(r.frames[i]) ?? 0;
  const b = get(r.frames[j]) ?? a;
  return a + (b - a) * t;
}

export function regionTemp(r: Replay, hour: number, id: string): number {
  return lerpField(r, hour, (f) => f.regions[id]?.temp_c);
}

export function regionSnowing(r: Replay, hour: number, id: string): number {
  return lerpField(r, hour, (f) => f.regions[id]?.snow_cm);
}

export function regionSnowDepth(r: Replay, hour: number, id: string): number {
  const arr = r.snowDepth[id];
  if (!arr) return 0;
  const i = frameIndex(r, hour);
  const j = Math.min(arr.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, hour - i));
  return arr[i] + (arr[j] - arr[i]) * t;
}

export function fuelAvail(r: Replay, hour: number, fuel: FuelKey): number {
  return lerpField(r, hour, (f) => f.fuel_avail_frac?.[fuel]);
}

export function zonesAt(r: Replay, hour: number): Record<string, number> {
  const f = r.frames[frameIndex(r, hour)];
  return f.zones ?? zonesFromShed(f, isCollapsedAt(r, hour));
}

/** Smooth countdown: interpolates toward the next frame (or to 0 at collapse). */
export function countdownAt(r: Replay, hour: number): number | null {
  const i = frameIndex(r, hour);
  const f = r.frames[i];
  if (!f || f.countdown_s == null) return null;   // empty replay (e.g. a live run that has not started yet)
  const n = r.frames[Math.min(r.frames.length - 1, i + 1)];
  const t = Math.max(0, Math.min(1, hour - i));
  const next = n.countdown_s ?? (isCollapsedAt(r, i + 1) ? 0 : f.countdown_s);
  return Math.max(0, f.countdown_s + (next - f.countdown_s) * t);
}

export function fmtHomes(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")},000`;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2021-02-15 01:00 CST" -> { time: "1:00 AM", date: "Mon Feb 15, 2021", tz: "CST" } */
export function fmtLocal(local: string): { time: string; date: string; tz: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\s*(\S+)?/.exec(local ?? "");
  if (!m) return { time: local ?? "", date: "", tz: "" };
  const [, y, mo, d, hh, mm, tz] = m;
  const H = Number(hh);
  const h12 = H % 12 === 0 ? 12 : H % 12;
  const dow = DAYS[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay()];
  return {
    time: `${h12}:${mm} ${H < 12 ? "AM" : "PM"}`,
    date: `${dow} ${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`,
    tz: tz ?? "",
  };
}

/** "Qwen/Qwen3-30B-A3B-Instruct-2507" -> "Qwen3-30B" */
export function shortModelName(operator: string): string {
  return (operator.split("/").pop() ?? operator).replace(/-Instruct.*$/i, "").replace(/-A\d+B$/i, "");
}

export function modelBadge(meta: ReplayMeta): string {
  const op = meta.model?.operator;
  if (!op) return "MODEL: unknown";
  // Simulator dev baselines (sim/export_replay.py) use "scripted:<policy>": no model involved.
  if (op.startsWith("scripted:")) return "SCRIPTED BASELINE (no AI)";
  const short = shortModelName(op);
  const ft = meta.model?.fine_tune_runs ?? 0;
  if (meta.model?.weights_frozen === false || ft > 0) return `MODEL: ${short} · weights NOT frozen · fine-tuning runs: ${ft}`;
  return `Same AI · ${short} · never retrained`;
}
