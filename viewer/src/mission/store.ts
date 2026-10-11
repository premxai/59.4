// Mission Control state: the bundle, the selected track/tab, the night-playback cursor, the inspector.
import { create } from "zustand";
import { stepsOf, trackGens } from "./derive";
import { normalize } from "./normalize";
import type { Edit, Mission, ManualPage, Track } from "./types";

export type Tab = "overview" | "evolution" | "exam" | "memory";
export const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "evolution", label: "Evolution" },
  { key: "exam", label: "Final exam" },
  { key: "memory", label: "Memory" },
];

export type Inspect =
  | { kind: "edit"; track: string; edit: Edit }
  | { kind: "step"; track: string; gen: number; index: number }
  | { kind: "notebook"; track: string; id: string }
  | { kind: "day"; track: string; gen: number }
  | { kind: "page"; track: string; page: ManualPage };

const params = new URLSearchParams(location.search);
const BUNDLE = params.get("bundle") ?? "594_mission.json";
const AUTOPLAY = params.get("autoplay") === "1";
const PARAM_TRACK = params.get("track");
const PARAM_TAB = params.get("tab") as Tab | null;

export const missionUrl = (file: string) => `${import.meta.env.BASE_URL}mission/${file}`;

interface MissionState {
  mission: Mission | null;
  error: string | null;
  loading: boolean;
  loadedAt: number | null;
  tab: Tab;
  track: string;
  gen: number;
  step: number;
  playing: boolean;
  stepMs: number;
  inspect: Inspect | null;
  load: () => Promise<void>;
  setTab: (t: Tab) => void;
  setTrack: (t: string) => void;
  goGen: (g: number) => void;
  goDay: (delta: number) => void;
  stepBy: (delta: number) => void;
  togglePlay: () => void;
  restart: () => void;
  tick: () => void;
  openInspect: (i: Inspect) => void;
  closeInspect: () => void;
}

const endOf = (t: Track | undefined, g: number) => stepsOf(t, g).length - 1;

export const useMission = create<MissionState>((set, get) => ({
  mission: null,
  error: null,
  loading: false,
  loadedAt: null,
  tab: PARAM_TAB && ["overview", "evolution", "exam", "memory"].includes(PARAM_TAB) ? PARAM_TAB : "overview",
  track: PARAM_TRACK ?? "A",
  gen: 1,
  step: -1,
  playing: false,
  stepMs: Number(params.get("stepms")) > 100 ? Number(params.get("stepms")) : 1100,
  inspect: null,

  load: async () => {
    set({ loading: true });
    try {
      const res = await fetch(`${missionUrl(BUNDLE)}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for mission/${BUNDLE}`);
      const text = await res.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("the data file is being rewritten right now (incomplete JSON) — try Reload in a few seconds");
      }
      const m = normalize(raw);
      const s = get();
      const first = !s.mission;
      const keys = m.trackKeys;
      const track = keys.includes(s.track) ? s.track : (keys.find((k) => m.tracks[k].generations.length) ?? keys[0] ?? "A");
      const t = m.tracks[track];
      const gens = trackGens(t);
      const last = gens[gens.length - 1] ?? 1;
      let gen = last;
      let step = endOf(t, last);
      let playing = s.playing;
      if (first && AUTOPLAY && gens.length) {
        gen = gens[0];
        step = 0;
        playing = true;
      } else if (!first && gens.includes(s.gen)) {
        const prevT = s.mission?.tracks[s.track];
        const wasAtEnd = s.step >= endOf(prevT, s.gen);
        gen = s.gen;
        step = wasAtEnd ? endOf(t, gen) : Math.min(s.step, endOf(t, gen));
      }
      set({ mission: m, error: null, loading: false, loadedAt: Date.now(), track, gen, step, playing });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  setTab: (tab) => set({ tab }),

  setTrack: (track) => {
    const t = get().mission?.tracks[track];
    const gens = trackGens(t);
    const gen = gens[gens.length - 1] ?? 1;
    set({ track, gen, step: endOf(t, gen), playing: false, inspect: null });
  },

  goGen: (gen) => {
    const t = get().mission?.tracks[get().track];
    set({ gen, step: endOf(t, gen), playing: false });
  },

  goDay: (delta) => {
    const s = get();
    const t = s.mission?.tracks[s.track];
    const gens = trackGens(t);
    const i = gens.indexOf(s.gen);
    const j = Math.max(0, Math.min(gens.length - 1, (i < 0 ? gens.length - 1 : i) + delta));
    if (gens[j] != null) set({ gen: gens[j], step: endOf(t, gens[j]), playing: false });
  },

  stepBy: (delta) => {
    const s = get();
    const t = s.mission?.tracks[s.track];
    const gens = trackGens(t);
    const end = endOf(t, s.gen);
    const next = s.step + delta;
    if (next >= -1 && next <= end) return set({ step: next, playing: false });
    const i = gens.indexOf(s.gen);
    if (delta > 0 && i >= 0 && i < gens.length - 1) return set({ gen: gens[i + 1], step: 0, playing: false });
    if (delta < 0 && i > 0) return set({ gen: gens[i - 1], step: endOf(t, gens[i - 1]), playing: false });
    set({ playing: false });
  },

  togglePlay: () => {
    const s = get();
    if (s.playing) return set({ playing: false });
    const t = s.mission?.tracks[s.track];
    const gens = trackGens(t);
    if (!gens.length) return;
    const i = gens.indexOf(s.gen);
    const atEnd = s.step >= endOf(t, s.gen);
    if (atEnd && i === gens.length - 1) return set({ gen: gens[0], step: 0, playing: true });
    if (atEnd && i >= 0) return set({ gen: gens[i + 1], step: 0, playing: true });
    set({ playing: true });
  },

  restart: () => {
    const gens = trackGens(get().mission?.tracks[get().track]);
    if (gens.length) set({ gen: gens[0], step: 0, playing: true });
  },

  tick: () => {
    const s = get();
    const t = s.mission?.tracks[s.track];
    if (!t) return set({ playing: false });
    if (s.step < endOf(t, s.gen)) return set({ step: s.step + 1 });
    const gens = trackGens(t);
    const i = gens.indexOf(s.gen);
    if (i >= 0 && i < gens.length - 1) set({ gen: gens[i + 1], step: 0 });
    else set({ playing: false });
  },

  openInspect: (inspect) => set({ inspect }),
  closeInspect: () => set({ inspect: null }),
}));

export function useTrack(): Track | null {
  return useMission((s) => s.mission?.tracks[s.track] ?? null);
}

export function useCursor(): { gen: number; step: number } {
  const gen = useMission((s) => s.gen);
  const step = useMission((s) => s.step);
  return { gen, step };
}
