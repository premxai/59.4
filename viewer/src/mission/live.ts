// Live stage server (scripts/live_server.py, default http://localhost:8594, CORS open).
//   GET  /api/catalog          storms + notebook versions (grow overnight)
//   POST /api/compare          {storm_id | custom, left, right, seed, fresh} -> {run_id, storm, left, right}
//   GET  /api/stream/{run_id}  SSE: {"type":"hour", label:"left"|"right", ...} …, then "done" | "error"
//   GET  /api/replay/{name}    full 437-replay/1 per side after "done"
//   GET  /api/ercot            real public ERCOT reading (read-only)
// Everything degrades gracefully: offline = clear message + the recorded "offline replay".
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useClock } from "../lib/clock";
import type { Frame, Replay, ReplayEvent } from "../lib/replay";
import { loadReplay, zonesFromShed } from "../lib/replay";

const params = new URLSearchParams(location.search);
export const API_BASE = (params.get("api") ?? `http://${location.hostname || "localhost"}:8594`).replace(/\/$/, "");
const MODEL = { operator: "Qwen3-30B-A3B-Instruct-2507", weights_frozen: true, fine_tune_runs: 0 };

async function getJson<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init, signal: ctl.signal });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? "";
      } catch {
        /* no body */
      }
      throw new Error(`server answered HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(to);
  }
}

// ------------------------------------------------------------------ ERCOT "Texas right now"
export interface ErcotReading {
  frequency_hz?: number;
  demand_mw?: number;
  capacity_mw?: number;
  wind_mw?: number;
  solar_mw?: number;
  updated?: string;
  stale?: boolean;
}

export function useErcot(pollMs = 30_000): ErcotReading | null {
  const [r, setR] = useState<ErcotReading | null>(null);
  useEffect(() => {
    let alive = true;
    const get = async () => {
      try {
        const j = await getJson<ErcotReading>("/api/ercot", undefined, 6000);
        if (alive) setR(typeof j.frequency_hz === "number" ? j : null);
      } catch {
        if (alive) setR(null);
      }
    };
    get();
    const id = setInterval(get, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);
  return r;
}

// ------------------------------------------------------------------ catalog
export interface CatalogStorm {
  id: string;
  kind: "unseen" | "practice" | "calm" | string;
  split?: string;
  label: string;
  description?: string;
  source_year?: number;
  real_unmodified?: boolean;
}

export interface CatalogNotebook {
  id: string;
  track: string;
  night: number;
  label: string;
  counts: Record<string, number>;
  hash?: string;
}

export interface CatalogPoolEntry {
  storm_id?: string;
  custom?: Record<string, unknown>;
  label?: string;
}

export interface Catalog {
  storms: CatalogStorm[];
  notebooks: CatalogNotebook[];
  judge_storm?: Record<string, unknown>;
  /** The unseen storms (by id) plus judge-storm presets (custom). */
  hidden_pool?: CatalogPoolEntry[];
  /** The frozen (final) notebook per track. */
  frozen?: Record<string, { id: string; hash?: string; generations?: number }>;
}

export type Where = "statewide" | "west" | "coast" | "north";

export interface StormParams {
  colder_c: number;
  longer_x: number;
  where: Where;
  surge: number;
  freezing_rain: boolean;
}

export const isBestGuess = (n: CatalogNotebook) => /best guess|zero.?shot_|^zero_shot/i.test(n.label + " " + n.id) && !/after night/i.test(n.label);

export function defaultNotebooks(c: Catalog, track: string): { left?: string; right?: string } {
  const mine = c.notebooks.filter((n) => n.track === track && !isBestGuess(n));
  const pool = mine.length ? mine : c.notebooks.filter((n) => !isBestGuess(n));
  const day1 = pool.find((n) => /day 1/i.test(n.label)) ?? [...pool].sort((a, b) => a.night - b.night)[0];
  const latest = [...pool].sort((a, b) => b.night - a.night)[0];
  return { left: day1?.id, right: latest?.id };
}

// ------------------------------------------------------------------ live sides
export interface LiveStep {
  h: number;
  type: string;
  actor?: string;
  text: string;
}

export interface LiveResult {
  notebook?: string;
  passed?: boolean;
  verdict?: string;
  collapsed?: boolean;
  homes_dark_hours?: number;
  peak_shed_frac?: number;
  min_freq?: number;
  replay?: string;
  ai_calls?: number;
}

export type Side = "left" | "right";

export interface LiveSide {
  /** Mutable replay that grows one frame per hour message (stable identity for the compositor). */
  replay: Replay;
  steps: LiveStep[];
  action: string | null;
  maxSupply: number;
  /** Raw SSE hour messages by hour (fed to the 3D grid city's frameFromLive adapter). */
  raw: Record<string, unknown>[];
}

function skyTime(localHour: number): number {
  const h = ((localHour % 24) + 24) % 24;
  if (h >= 8 && h <= 16) return 0;
  if (h > 16 && h < 18) return (0.5 * (h - 16)) / 2;
  if (h >= 18 && h < 21) return 0.5 + (0.5 * (h - 18)) / 3;
  if (h >= 21 || h <= 5) return 1;
  return 1 - (h - 5) / 3;
}

function parseStamp(s: unknown, h: number): Date {
  if (typeof s === "string" && s && s !== "None") {
    let t = s.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
    if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(t)) t += "Z";
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.UTC(2021, 1, 10) + h * 3600e3);
}

const pad = (n: number) => String(n).padStart(2, "0");

function makeReplay(label: string, scenario: string, notebook: string | undefined, runId: string): Replay {
  return {
    format: "437-replay/1",
    meta: {
      run_id: runId,
      label,
      scenario_public: scenario,
      harness: notebook ? { id: notebook, generation: 0 } : undefined,
      model: MODEL,
      fleet_year: 2020,
      start_utc: "",
      hours: 0,
      regions: [{ id: "statewide", name: "Texas", lat: 31, lon: -99 }],
      collapsed: false,
      collapse_hour: null,
    },
    frames: [],
    snowDepth: { statewide: [] },
    file: `live:${runId}:${label}`,
  };
}

const n = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);

function pushHour(side: LiveSide, m: Record<string, unknown>) {
  const r = side.replay;
  const h = Math.max(0, Math.round(n(m.h, r.frames.length)));
  const events: ReplayEvent[] = Array.isArray(m.events)
    ? (m.events as Record<string, unknown>[]).map((e) => ({ type: String(e?.type ?? ""), text: String(e?.text ?? ""), actor: typeof e?.actor === "string" ? e.actor : undefined }))
    : [];
  const collapseNow = events.some((e) => e.type === "collapse");
  if (collapseNow && r.meta.collapse_hour == null) {
    r.meta.collapse_hour = h;
    r.meta.collapsed = true;
  }
  const collapsed = r.meta.collapse_hour != null && h >= r.meta.collapse_hour;
  const d = parseStamp(m.stamp, h);
  const loc = new Date(d.getTime() - 6 * 3600e3);
  const localHour = typeof m.local_hour === "number" ? m.local_hour : loc.getUTCHours();
  const demand = n(m.demand_mw);
  const supply = n(m.supply_mw);
  side.maxSupply = Math.max(side.maxSupply, supply, 1);
  const shedFrac = Math.max(0, Math.min(1, n(m.shed_frac, demand > 0 ? n(m.shed_mw) / demand : 0)));
  const gas = typeof m.gas_avail_frac === "number" ? Math.max(0, Math.min(1, m.gas_avail_frac)) : 1;
  const temp = n(m.temp_c, 0);
  const freqMin = collapsed ? 0 : n(m.freq_min_hz, 60);
  const f: Frame = {
    h,
    t: d.toISOString(),
    local: `${loc.getUTCFullYear()}-${pad(loc.getUTCMonth() + 1)}-${pad(loc.getUTCDate())} ${pad(Math.floor(localHour))}:00 CST`,
    freq_hz: freqMin,
    freq_min_hz: freqMin,
    countdown_s: collapsed ? (collapseNow ? 0 : null) : typeof m.countdown_s === "number" ? m.countdown_s : null,
    demand_mw: demand,
    supply_mw: supply,
    reserve_mw: n(m.reserve_mw, supply - demand),
    shed_mw: n(m.shed_mw),
    shed_frac: collapsed ? 1 : shedFrac,
    homes_dark: n(m.homes_dark),
    fuel_avail_frac: { gas },
    gas_supply_frac: collapsed ? 0 : gas,
    regions: { statewide: { temp_c: temp, snow_cm: temp < 1 ? 0.3 : 0, wind_ms: 6 } },
    turbines_running: collapsed ? 0 : 1,
    gas_plant_on: collapsed ? 0 : gas,
    line_glow: collapsed ? 0 : Math.max(0, Math.min(1, supply / side.maxSupply)),
    snow_amount: 1,
    frost_amount: Math.max(0, Math.min(1, -temp / 10)),
    sky_time: skyTime(localHour),
    events,
  };
  const z = zonesFromShed(f, collapsed);
  if (!collapsed) {
    z.zone_crit = 1; // critical services stay on during rolling outages
    z.zone_gas = m.protect_gas === true || shedFrac <= 0 ? 1 : 0;
  }
  f.zones = z;
  // keep frames indexed by hour (fill any gap with the previous frame)
  while (r.frames.length < h) r.frames.push({ ...(r.frames[r.frames.length - 1] ?? f), h: r.frames.length, events: [] });
  r.frames[h] = f;
  side.raw[h] = m;
  if (!r.meta.start_utc) r.meta.start_utc = f.t;
  r.meta.hours = r.frames.length;
  const snow = r.snowDepth.statewide;
  while (snow.length < r.frames.length) snow.push(Math.min(30, (snow[snow.length - 1] ?? 0) + (temp < 1 ? 0.3 : -0.2)));
  for (const e of events) if (e.text) side.steps.push({ h, type: e.type, actor: e.actor as string | undefined, text: e.text });
  if (typeof m.action === "string" && m.action) side.action = m.action;
}

/** A calm, lit city for the idle state (nothing has run yet). Not data: the HUD is hidden while idle. */
export function idleReplay(label: string): Replay {
  const side: LiveSide = { replay: makeReplay(label, "Ready", undefined, "idle"), steps: [], action: null, maxSupply: 1, raw: [] };
  pushHour(side, { h: 0, stamp: "2021-02-15T00:00:00Z", local_hour: 18.5, shed_frac: 0, demand_mw: 0, supply_mw: 1, reserve_mw: 0, freq_min_hz: 60, homes_dark: 0, temp_c: -5, events: [] });
  side.replay.frames[0].sky_time = 0.55;
  return side.replay;
}

// ------------------------------------------------------------------ compare store
export type RunStatus = "idle" | "starting" | "streaming" | "loading_replays" | "done" | "error";
export type CatalogStatus = "loading" | "ok" | "offline";

export interface Selection {
  storm: string; // catalog id or "custom"
  custom: StormParams;
  left: string;
  right: string;
  seed: number;
  fast: boolean;
}

interface CompareState {
  catalog: Catalog | null;
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  sel: Selection;
  userPicked: boolean;
  status: RunStatus;
  error: string | null;
  runId: string | null;
  storm: { id?: string; label?: string; description?: string } | null;
  labels: Record<Side, string>;
  sides: Record<Side, LiveSide> | null;
  results: Partial<Record<Side, LiveResult>> | null;
  finals: Partial<Record<Side, Replay>>;
  version: number;
  startedAt: number | null;
  finishedAt: number | null;
  showOffline: boolean;
  /** True when the server streamed back an identical earlier run (fresh: false whole-run cache). */
  replayed: boolean;
  /** Where the server reads its records from (catalog `store`), e.g. "local (Atlas unreachable)". */
  store: string | null;
  fetchCatalog: () => Promise<void>;
  setSel: (p: Partial<Selection>, byUser?: boolean) => void;
  applyDefaults: (track: string, preferStorm?: string) => void;
  start: () => Promise<void>;
  stop: () => void;
  setShowOffline: (v: boolean) => void;
}

let es: EventSource | null = null;
let flushTimer: number | null = null;
let pending: Record<string, unknown>[] = [];

export const useCompare = create<CompareState>((set, get) => {
  const followClock = () => {
    const s = get().sides;
    if (!s) return;
    const edge = Math.min(s.left.replay.frames.length, s.right.replay.frames.length) - 1;
    if (edge < 0) return;
    const c = useClock.getState();
    c.setMax(edge);
    c.setSpeed(edge - c.hour > 10 ? 8 : 3);
    if (c.hour < edge && !c.playing) c.setPlaying(true);
  };
  const flush = () => {
    flushTimer = null;
    const s = get().sides;
    if (!s || !pending.length) return;
    for (const m of pending) {
      const side = m.label === "right" ? s.right : m.label === "left" ? s.left : null;
      if (side) pushHour(side, m);
    }
    pending = [];
    set({ version: get().version + 1 });
    followClock();
  };
  const close = () => {
    es?.close();
    es = null;
    if (flushTimer != null) clearTimeout(flushTimer);
    flush();
  };
  return {
    catalog: null,
    catalogStatus: "loading",
    catalogError: null,
    sel: { storm: "", custom: { colder_c: 4, longer_x: 1.5, where: "statewide", surge: 0, freezing_rain: false }, left: "", right: "", seed: 0, fast: false },
    userPicked: false,
    status: "idle",
    error: null,
    runId: null,
    storm: null,
    labels: { left: "Left notebook", right: "Right notebook" },
    sides: null,
    results: null,
    finals: {},
    version: 0,
    startedAt: null,
    finishedAt: null,
    showOffline: false,
    replayed: false,
    store: null,

    fetchCatalog: async () => {
      try {
        const c = await getJson<Catalog & { store?: unknown }>("/api/catalog");
        const cat: Catalog = {
          storms: Array.isArray(c.storms) ? c.storms : [],
          notebooks: Array.isArray(c.notebooks) ? c.notebooks : [],
          judge_storm: c.judge_storm,
          hidden_pool: Array.isArray(c.hidden_pool) ? c.hidden_pool : undefined,
          frozen: c.frozen && typeof c.frozen === "object" ? c.frozen : undefined,
        };
        set({ catalog: cat, catalogStatus: "ok", catalogError: null, store: typeof c.store === "string" ? c.store : null });
      } catch (e) {
        const offline = e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError");
        set({ catalogStatus: get().catalog ? "ok" : "offline", catalogError: offline ? "live server offline" : e instanceof Error ? e.message : String(e) });
      }
    },

    setSel: (p, byUser = true) => set({ sel: { ...get().sel, ...p }, userPicked: get().userPicked || byUser }),

    applyDefaults: (track, preferStorm) => {
      const c = get().catalog;
      if (!c) return;
      const sel = { ...get().sel };
      const nb = defaultNotebooks(c, track);
      if (nb.left) sel.left = nb.left;
      if (nb.right) sel.right = nb.right;
      if (!sel.storm || (sel.storm !== "custom" && !c.storms.some((s) => s.id === sel.storm))) {
        const unseen = c.storms.filter((s) => s.kind === "unseen");
        sel.storm = (preferStorm && c.storms.some((s) => s.id === preferStorm) ? preferStorm : undefined) ?? unseen[0]?.id ?? c.storms[0]?.id ?? "custom";
      }
      set({ sel });
    },

    setShowOffline: (v) => set({ showOffline: v }),

    stop: () => {
      close();
      const st = get().status;
      if (st === "streaming" || st === "starting") set({ status: "idle", sides: null });
    },

    start: async () => {
      close();
      pending = [];
      const { sel, catalog } = get();
      const label = (id: string) => catalog?.notebooks.find((x) => x.id === id)?.label ?? id;
      const body: Record<string, unknown> = { left: sel.left, right: sel.right, seed: sel.seed, fresh: !sel.fast };
      if (sel.storm === "custom") body.custom = { ...sel.custom, base: "feb2011" };
      else body.storm_id = sel.storm;
      set({ status: "starting", error: null, results: null, finals: {}, sides: null, runId: null, showOffline: false, startedAt: Date.now(), finishedAt: null, replayed: false });
      let run: { run_id?: string; storm?: CompareState["storm"]; left?: string; right?: string; replayed?: boolean };
      try {
        run = await getJson("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 30000);
      } catch (e) {
        const offline = e instanceof TypeError;
        set({ status: "error", error: offline ? "The live server is offline (start: .venv\\Scripts\\python scripts\\live_server.py)" : e instanceof Error ? e.message : String(e), catalogStatus: offline ? "offline" : get().catalogStatus });
        return;
      }
      if (!run.run_id) return set({ status: "error", error: "the server did not return a run id" });
      const labels = { left: run.left ?? label(sel.left), right: run.right ?? label(sel.right) };
      const stormLabel = run.storm?.label ?? "Storm";
      const sides: Record<Side, LiveSide> = {
        left: { replay: makeReplay(labels.left, stormLabel, sel.left, run.run_id), steps: [], action: null, maxSupply: 1, raw: [] },
        right: { replay: makeReplay(labels.right, stormLabel, sel.right, run.run_id), steps: [], action: null, maxSupply: 1, raw: [] },
      };
      const c = useClock.getState();
      c.setPlaying(false);
      c.setMax(0);
      c.setHour(0);
      set({ status: "streaming", runId: run.run_id, storm: run.storm ?? null, labels, sides, startedAt: Date.now(), version: get().version + 1, replayed: run.replayed === true });
      es = new EventSource(`${API_BASE}/api/stream/${run.run_id}`);
      es.onmessage = (ev) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (m.type === "hour") {
          pending.push(m);
          if (flushTimer == null) flushTimer = window.setTimeout(flush, 150);
        } else if (m.type === "done") {
          close();
          const results = (m.results && typeof m.results === "object" ? m.results : {}) as Partial<Record<Side, LiveResult>>;
          set({ status: "loading_replays", results, storm: (m.storm as CompareState["storm"]) ?? get().storm, finishedAt: Date.now(), replayed: get().replayed || m.replayed === true });
          (async () => {
            const finals: Partial<Record<Side, Replay>> = {};
            for (const side of ["left", "right"] as Side[]) {
              const name = results[side]?.replay;
              if (!name) continue;
              try {
                const r = await loadReplay(`${API_BASE}/api/replay/${encodeURIComponent(name)}`);
                finals[side] = { ...r, meta: { ...r.meta, label: get().labels[side], model: r.meta.model ?? MODEL } };
              } catch {
                /* keep the live frames */
              }
            }
            set({ status: "done", finals });
            const L = finals.left ?? get().sides?.left.replay;
            const R = finals.right ?? get().sides?.right.replay;
            if (L && R) {
              const clk = useClock.getState();
              clk.setMax(Math.max(L.frames.length, R.frames.length) - 1);
              clk.setSpeed(6);
            }
          })();
        } else if (m.type === "error") {
          close();
          set({ status: "error", error: String(m.error ?? "the run failed") });
        }
      };
      es.onerror = () => {
        if (get().status === "streaming") {
          close();
          set({ status: "error", error: "lost the connection to the live server" });
        }
      };
    },
  };
});
