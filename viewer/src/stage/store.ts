// Stage state: catalog, the hidden storm, the buffered SSE stream (both notebooks), and a dramatic
// playback clock independent of the stream speed (fast mode can deliver 312 hours in ~2 seconds).
import { create } from "zustand";
import type { AreaKey } from "../grid3d/areas";
import { frameFromLive, gridFramesFromReplay, newLiveCtx, type LiveCtx, type LiveHourMsg } from "../grid3d/adapters";
import type { GridFrame } from "../grid3d/types";
import { loadReplay, type Replay } from "../lib/replay";
import { API_BASE, type Catalog, type CatalogNotebook, type LiveResult } from "../mission/live";
import { areaHint, markersOf, phasesOf, type Phase, type StageStep } from "./derive";

export type Side = "left" | "right";

export interface PoolEntry {
  storm_id?: string;
  custom?: Record<string, unknown>;
  label: string;
}

export interface StageCatalog extends Catalog {
  hidden_pool?: PoolEntry[];
  frozen?: Record<string, { id: string; hash?: string; generations?: number }>;
}

export interface SideData {
  frames: GridFrame[];
  steps: StageStep[];
  /** the operator's action text per hour */
  actions: (string | null)[];
  replay: Replay | null;
  result: LiveResult | null;
  ctx: LiveCtx;
}

export interface StormInfo {
  id?: string;
  label?: string;
  description?: string;
  source_year?: number;
}

export type Online = "checking" | "online" | "offline";
export type RunStatus = "idle" | "starting" | "streaming" | "done" | "error";

const TRACK = "B";
const URLP = new URLSearchParams(location.search);
/** Rehearsal / kiosk: ?storm=<id> forces the hidden storm, ?at=<hour> pauses there once loaded. */
const FORCE_STORM = URLP.get("storm");
const PAUSE_AT = URLP.has("at") ? Number(URLP.get("at")) : null;
const OFFLINE_LEFT = "/mission/replay_B_heldout_west_gas_2018_0_day1.json";
const OFFLINE_RIGHT = "/mission/replay_B_heldout_west_gas_2018_0_final.json";
export const SPEEDS = [3, 6, 12, 24];

/** Auto-pace: quiet stretches play faster, the crisis plays slower (multiplies the chosen speed). */
const PACE: Record<Phase, number> = { calm: 2.6, approaching: 1.5, struggling: 1.0, critical: 0.7, acting: 0.7, recovery: 1.4, stable: 2.6 };
let paceOf: Float32Array = new Float32Array(0);
function updatePace(frames: GridFrame[], steps: StageStep[]) {
  const ph = phasesOf(frames, markersOf(steps));
  const out = new Float32Array(ph.length);
  ph.forEach((p, i) => (out[i] = PACE[p]));
  // smooth so the speed eases between phases
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < out.length - 1; i++) out[i] = (out[i - 1] + out[i] * 2 + out[i + 1]) / 4;
  paceOf = out;
}

const emptySide = (): SideData => ({ frames: [], steps: [], actions: [], replay: null, result: null, ctx: newLiveCtx() });

interface StageState {
  online: Online;
  catalog: StageCatalog | null;
  agentId: string | null;
  day1Id: string | null;
  version: string;
  nights: number;
  simHash: string;
  fresh: boolean;
  /** intro overlay step: 0 selecting · 1 injected · 2 the AI can't see · null = none */
  intro: number | null;
  status: RunStatus;
  offline: boolean;
  error: string | null;
  storm: StormInfo | null;
  /** affected area for the intro camera glide */
  hint: AreaKey | null;
  left: SideData;
  right: SideData;
  streamDone: boolean;
  /** bumps whenever buffered data changes */
  rev: number;
  hour: number;
  playing: boolean;
  speed: number;
  /** quiet stretches faster, the crisis slower */
  autoPace: boolean;
  ended: boolean;
  runs: number;
  init: () => Promise<void>;
  breakGrid: () => Promise<void>;
  setFresh: (v: boolean) => void;
  setSpeed: (s: number) => void;
  setAutoPace: (v: boolean) => void;
  togglePlay: () => void;
  seek: (h: number) => void;
  replayRun: () => void;
}

async function getJson<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(path.startsWith("http") || path.startsWith("/mission") ? path : `${API_BASE}${path}`, { cache: "no-store", ...init, signal: ctl.signal });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? "";
      } catch {
        /* no body */
      }
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(to);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function versionOf(id: string | null): string {
  const m = /h0*(\d+)$/.exec(id ?? "");
  return m ? `v${m[1]}` : "";
}

/** Last hour both sides have. */
export function edgeOf(s: Pick<StageState, "left" | "right">): number {
  return Math.min(s.left.frames.length, s.right.frames.length) - 1;
}

let es: EventSource | null = null;
let pending: Record<string, unknown>[] = [];
let flushTimer: number | null = null;
let raf = 0;
let lastPick = "";
let runToken = 0;
let showcase: { day1?: { steps?: StageStep[] }; final?: { steps?: StageStep[] } } | null = null;

function closeStream() {
  es?.close();
  es = null;
  if (flushTimer != null) clearTimeout(flushTimer);
  flushTimer = null;
}

export const useStage = create<StageState>((set, get) => {
  // ---------------------------------------------------------------- playback clock
  let last = 0;
  const loop = (now: number) => {
    raf = 0;
    const s = get();
    if (!s.playing) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    const edge = edgeOf(s);
    if (edge >= 0) {
      const pace = s.autoPace ? (paceOf[Math.floor(s.hour)] ?? 1) : 1;
      const h = Math.min(edge, s.hour + dt * s.speed * pace);
      if (h >= edge && s.streamDone && edge > 0) {
        set({ hour: edge, playing: false, ended: true });
        return;
      }
      if (h !== s.hour) set({ hour: h });
    }
    raf = requestAnimationFrame(loop);
  };
  const startLoop = () => {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  };

  // ---------------------------------------------------------------- stream buffering
  const pushHour = (side: SideData, m: Record<string, unknown>) => {
    const msg = m as unknown as LiveHourMsg;
    const h = Math.max(0, Math.round(msg.h ?? side.frames.length));
    // frames must be converted in order (the adapter accumulates snow and latches a collapse)
    while (side.frames.length < h) {
      const prev = side.frames[side.frames.length - 1];
      if (!prev) break;
      side.frames.push({ ...prev, h: side.frames.length, events: [] });
      side.actions.push(side.actions[side.actions.length - 1] ?? null);
    }
    const f = frameFromLive(msg, side.ctx);
    side.frames[h] = f;
    side.actions[h] = typeof msg.action === "string" ? msg.action : null;
    for (const e of msg.events ?? []) if (e.text) side.steps.push({ h, type: e.type, text: e.text });
  };
  const flush = () => {
    flushTimer = null;
    if (!pending.length) return;
    const s = get();
    const left = { ...s.left };
    const right = { ...s.right };
    for (const m of pending) {
      if (m.label === "left") pushHour(left, m);
      else if (m.label === "right") pushHour(right, m);
    }
    pending = [];
    left.frames = [...left.frames];
    right.frames = [...right.frames];
    updatePace(right.frames, right.steps);
    set({ left, right, rev: s.rev + 1 });
  };

  /** After "done": swap in the exact replays (zones, gas to plants, frequency, sim events) hour by hour. */
  const mergeReplay = (side: SideData, r: Replay): SideData => {
    const rf = gridFramesFromReplay(r);
    const frames = side.frames.length
      ? side.frames.map((f, h) => {
          const x = rf[h];
          if (!x) return f;
          return {
            ...f,
            zones: x.zones,
            gasSupply: x.gasSupply,
            freqHz: x.freqHz,
            freqMinHz: x.freqMinHz,
            countdownS: x.countdownS,
            homesDark: x.homesDark,
            collapsed: x.collapsed,
            localTime: x.localTime ?? f.localTime,
            gasFleetMw: x.gasFleetMw,
            events: [...x.events, ...f.events],
          };
        })
      : rf;
    return { ...side, frames, replay: r };
  };

  return {
    online: "checking",
    catalog: null,
    agentId: null,
    day1Id: null,
    version: "v17",
    nights: 7,
    simHash: "sha256:e2033976…",
    fresh: false,
    intro: null,
    status: "idle",
    offline: false,
    error: null,
    storm: null,
    hint: null,
    left: emptySide(),
    right: emptySide(),
    streamDone: false,
    rev: 0,
    hour: 0,
    playing: false,
    speed: 6,
    autoPace: true,
    ended: false,
    runs: 0,

    init: async () => {
      // simulator fingerprint + offline showcase steps (local file, always there)
      getJson<{ honesty?: { sim_lock?: { sim_hash?: string } }; showcase?: { track: string; runs: typeof showcase }[] }>("/mission/594_mission.json", undefined, 15000)
        .then((m) => {
          const h = m.honesty?.sim_lock?.sim_hash;
          if (h) set({ simHash: `${h.slice(0, 15)}…` });
          showcase = m.showcase?.find((x) => x.track === TRACK)?.runs ?? null;
        })
        .catch(() => undefined);
      try {
        const c = await getJson<StageCatalog>("/api/catalog");
        const frozen = c.frozen?.[TRACK];
        const nbs: CatalogNotebook[] = Array.isArray(c.notebooks) ? c.notebooks : [];
        const day1 = nbs.find((n) => n.track === TRACK && /day 1/i.test(n.label)) ?? nbs.find((n) => n.id === "evoB-h001");
        const agent = frozen?.id ?? [...nbs].filter((n) => n.track === TRACK).sort((a, b) => b.night - a.night)[0]?.id ?? null;
        set({
          online: "online",
          catalog: c,
          agentId: agent,
          day1Id: day1?.id ?? "evoB-h001",
          version: versionOf(agent) || get().version,
          nights: frozen?.generations ?? get().nights,
        });
      } catch {
        set({ online: "offline" });
      }
    },

    setFresh: (v) => set({ fresh: v }),
    setSpeed: (sp) => set({ speed: sp }),
    setAutoPace: (v) => set({ autoPace: v }),
    togglePlay: () => {
      const s = get();
      if (s.intro != null || s.status === "idle") return;
      if (!s.playing && s.ended) {
        set({ hour: 0, ended: false, playing: true });
      } else set({ playing: !s.playing });
      if (get().playing) startLoop();
    },
    seek: (h) => {
      const s = get();
      const edge = edgeOf(s);
      if (edge < 0) return;
      const hh = Math.max(0, Math.min(edge, h));
      set({ hour: hh, ended: s.streamDone && hh >= edge && s.ended });
    },
    replayRun: () => {
      if (get().status === "idle") return;
      set({ hour: 0, ended: false, playing: true });
      startLoop();
    },

    breakGrid: async () => {
      const s0 = get();
      if (s0.intro != null || s0.status === "starting") return;
      closeStream();
      pending = [];
      paceOf = new Float32Array(0);
      const token = ++runToken;
      const alive = () => token === runToken;
      set({
        intro: 0,
        status: "starting",
        error: null,
        storm: null,
        hint: null,
        left: emptySide(),
        right: emptySide(),
        streamDone: false,
        hour: 0,
        playing: false,
        ended: false,
        rev: get().rev + 1,
        runs: s0.runs + 1,
      });
      const t0 = performance.now();
      let online = get().online;
      if (online !== "online") {
        await get().init();
        online = get().online;
      }
      const c = get().catalog;
      if (online === "online" && c) {
        // ------------------------------------------------ live: a random storm from the hidden pool
        const pool = (c.hidden_pool?.length ? c.hidden_pool : c.storms.filter((x) => x.kind === "unseen").map((x) => ({ storm_id: x.id, label: x.label }))) as PoolEntry[];
        const choices = pool.length > 1 ? pool.filter((p) => (p.storm_id ?? p.label) !== lastPick) : pool;
        const forced = FORCE_STORM && get().runs <= 1 ? (pool.find((p) => p.storm_id === FORCE_STORM) ?? (c.storms.some((x) => x.id === FORCE_STORM) ? { storm_id: FORCE_STORM, label: FORCE_STORM } : undefined)) : undefined;
        const pick = forced ?? choices[Math.floor(Math.random() * choices.length)];
        if (!pick) {
          set({ intro: null, status: "error", error: "The server has no hidden storms to pick from." });
          return;
        }
        lastPick = pick.storm_id ?? pick.label;
        const desc = pick.storm_id ? (c.storms.find((x) => x.id === pick.storm_id)?.description ?? "") : JSON.stringify(pick.custom ?? {});
        const custom = pick.custom as { where?: string; freezing_rain?: boolean; surge?: number } | undefined;
        const hint = custom ? (custom.where === "west" ? "field" : custom.freezing_rain ? "wind" : (custom.surge ?? 0) > 0 ? "town" : "plants") : areaHint(desc);
        const body: Record<string, unknown> = { left: get().day1Id, right: get().agentId, seed: 0, fresh: get().fresh };
        if (pick.storm_id) body.storm_id = pick.storm_id;
        else body.custom = pick.custom;
        let run: { run_id?: string; storm?: StormInfo };
        try {
          run = await getJson("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 30000);
        } catch (e) {
          if (!alive()) return;
          set({ intro: null, status: "error", error: e instanceof TypeError ? "The live server went offline." : `The server refused the run (${e instanceof Error ? e.message : String(e)}).` });
          return;
        }
        if (!alive()) return;
        if (!run.run_id) {
          set({ intro: null, status: "error", error: "The server did not return a run id." });
          return;
        }
        const stormInfo: StormInfo = run.storm ?? { label: pick.label };
        // the storm is kept for the reveal at the end; the screen never shows it during the run
        set({ status: "streaming", hint, offline: false, storm: stormInfo });
        es = new EventSource(`${API_BASE}/api/stream/${run.run_id}`);
        es.onmessage = (ev) => {
          if (!alive()) return;
          let m: Record<string, unknown>;
          try {
            m = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (m.type === "hour") {
            pending.push(m);
            if (flushTimer == null) flushTimer = window.setTimeout(flush, 120);
          } else if (m.type === "done") {
            closeStream();
            flush();
            const results = (m.results ?? {}) as Partial<Record<Side, LiveResult>>;
            const st = get();
            set({
              status: "done",
              streamDone: true,
              storm: (m.storm as StormInfo) ?? stormInfo,
              left: { ...st.left, result: results.left ?? null },
              right: { ...st.right, result: results.right ?? null },
              rev: st.rev + 1,
            });
            for (const side of ["left", "right"] as Side[]) {
              const name = results[side]?.replay;
              if (!name) continue;
              loadReplay(`${API_BASE}/api/replay/${encodeURIComponent(name)}`)
                .then((r) => {
                  if (!alive()) return;
                  const cur = get();
                  const merged = mergeReplay(cur[side], r);
                  if (side === "right") updatePace(merged.frames, merged.steps);
                  set({ [side]: merged, rev: cur.rev + 1 } as Partial<StageState>);
                })
                .catch(() => undefined);
            }
          } else if (m.type === "error") {
            closeStream();
            flush();
            set({ status: "error", error: String(m.error ?? "The run failed on the server.") });
          }
        };
        es.onerror = () => {
          if (!alive() || get().status !== "streaming") return;
          closeStream();
          flush();
          set({ status: "error", error: "Lost the connection to the live server." });
        };
      } else {
        // ------------------------------------------------ offline: the recorded replay of the same kind of night
        try {
          const [l, r] = await Promise.all([loadReplay(OFFLINE_LEFT), loadReplay(OFFLINE_RIGHT)]);
          if (!alive()) return;
          const toSide = (rep: Replay, steps: StageStep[] | undefined): SideData => {
            const frames = gridFramesFromReplay(rep);
            const st = (steps ?? []).filter((x) => x.text);
            const actions: (string | null)[] = frames.map(() => null);
            let cur: string | null = null;
            const byH = new Map<number, string>();
            for (const x of st) if (x.type === "ai_decision") byH.set(x.h, x.text.replace(/^AI decides:\s*/i, ""));
            for (let h = 0; h < frames.length; h++) {
              if (byH.has(h)) cur = byH.get(h)!;
              actions[h] = cur;
            }
            const m = rep.meta as Replay["meta"] & { passed?: boolean; verdict_plain?: string; peak_shed_frac?: number };
            return {
              frames,
              steps: st,
              actions,
              replay: rep,
              ctx: newLiveCtx(),
              result: { passed: m.passed, verdict: m.verdict_plain, collapsed: m.collapsed, peak_shed_frac: m.peak_shed_frac, homes_dark_hours: m.totals?.homes_dark_hours },
            };
          };
          const rightSide = toSide(r, showcase?.final?.steps);
          updatePace(rightSide.frames, rightSide.steps);
          set({
            offline: true,
            status: "done",
            streamDone: true,
            hint: "field",
            left: toSide(l, showcase?.day1?.steps),
            right: rightSide,
            rev: get().rev + 1,
            storm: { label: `${r.meta.scenario_public ?? "Unseen storm #6"}`, source_year: 2018, id: r.meta.scenario_id },
          });
        } catch (e) {
          set({ intro: null, status: "error", error: `The live server is offline and the offline replay could not load (${e instanceof Error ? e.message : String(e)}).` });
          return;
        }
      }
      // ------------------------------------------------ the overlay sequence, then the run starts
      const wait = Math.max(0, 1500 - (performance.now() - t0));
      await sleep(wait);
      if (!alive()) return;
      set({ intro: 1 });
      await sleep(1300);
      if (!alive()) return;
      set({ intro: 2 });
      await sleep(2600);
      if (!alive()) return;
      if (PAUSE_AT != null && Number.isFinite(PAUSE_AT) && get().runs <= 1) {
        // rehearsal: wait for the data, then park the playhead at the requested hour
        const until = performance.now() + 60000;
        while (alive() && edgeOf(get()) < PAUSE_AT && !get().streamDone && performance.now() < until) await sleep(200);
        if (!alive()) return;
        set({ intro: null, playing: false, hour: Math.max(0, Math.min(edgeOf(get()), PAUSE_AT)) });
        return;
      }
      set({ intro: null, playing: true, hour: 0 });
      startLoop();
    },
  };
});


if (import.meta.env.DEV) Object.assign(window, { __stage: useStage });
