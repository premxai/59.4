// Evidence site data layer: loads viewer/public/mission/594_mission.json (format "594-mission/1"),
// reuses Mission Control's defensive normalize() for the shared fields, and parses the post-freeze
// extras (final_scores, lineage notebooks, ablation, tear-outs, frozen hashes, locked exam) itself.
// Every number the site shows comes from here; nothing is invented.
import { create } from "zustand";
import { arr, normalize, num, numOrNull, obj, str } from "../mission/normalize";
import { stormLabel } from "../mission/plain";
import type { Counts, Edit, Mission, ShowcaseStep, Track } from "../mission/types";

const params = new URLSearchParams(location.search);
const BUNDLE = params.get("bundle") ?? "594_mission.json";
export const missionUrl = (file: string) => `${import.meta.env.BASE_URL}mission/${file}`;

// ------------------------------------------------------------------ extra types
export interface SeedScore {
  passed: number | null; // storms passed on this seed (of 8)
  hh: number | null; // home-hours in the dark, summed over the 8 storms
}

export interface FinalScore {
  id: string;
  night: number;
  counts: Counts;
  majority: number; // storms passed on >= 2 of 3 seeds
  ticks: string;
  bySeed: Record<string, SeedScore>;
  hhMedian: number | null;
  hhMin: number | null;
  hhMax: number | null;
  /** true when derived from a learning day instead of the post-freeze re-score */
  derived?: boolean;
}

export interface NbSensor {
  name: string;
  expr: string;
  description?: string;
  born_from?: string;
}
export interface NbRule {
  id: string;
  if: string;
  then: string[];
  priority?: number;
  description?: string;
  born_from?: string;
}
export interface NbGuardrail {
  id: string;
  when: string;
  enforce: string[];
  description?: string;
  born_from?: string;
}
export interface NbAlert {
  when: string;
  description?: string;
}
export interface Notebook {
  sensors: NbSensor[];
  rules: NbRule[];
  guardrails: NbGuardrail[];
  alerts: NbAlert[];
  context: { show: string[]; show_forecast?: boolean; memory_top_k?: number; recent_hours?: number };
  authority: { llm_decides: string[]; call_every_h?: number };
  build: Record<string, unknown>;
  memory_policy: Record<string, unknown>;
}

export interface Version {
  id: string;
  parentId: string | null;
  night: number;
  index: number; // 0-based position in the champion lineage
  label: string; // v1, v2, …
  counts: Counts;
  hash?: string;
  bornFrom?: string | null;
  notebook: Notebook | null;
  edit?: Edit; // the idea that produced this version
  page?: { id: string; title: string; text: string; scenario_id?: string | null };
  score?: FinalScore;
  isFinal: boolean;
  isBest: boolean;
}

export interface TearOut {
  key: string;
  label: string;
  organ?: string;
  id?: string;
  desc?: string;
  majority: number | null;
  ticks?: string;
  hhMedian: number | null;
  bySeed: Record<string, SeedScore>;
  full: boolean;
}

export interface AblationRow {
  organ: string;
  id: string;
  desc: string;
  majority: number | null;
  hhMedian: number | null;
  xDarker: number | null;
}

export interface Ablation {
  unplugged: FinalScore | null;
  removed: AblationRow[];
}

export interface LockedSeed {
  seed: number;
  passed: boolean | null;
  collapsed: boolean | null;
  collapseHour: number | null;
  peakShed: number | null;
  hh: number | null;
  minFreq: number | null;
  maxBelowMin: number | null;
  aiCalls: number | null;
}

export interface LockedRow {
  key: string;
  label: string;
  passed: boolean | null;
  passedSeeds: number | null;
  collapses: number | null;
  peakShed: number | null;
  hh: number | null;
  below594s: number | null;
  collapsed: boolean | null;
  apiErrors: number | null;
  seeds: LockedSeed[];
}

export interface TrackX {
  key: string;
  base: Track;
  versions: Version[];
  scores: FinalScore[];
  final?: Version;
  best?: Version;
  v1?: Version;
  tearouts: TearOut[];
  ablation: Ablation | null;
  zeroShot?: TearOut;
  frozen?: { hash?: string; counts: Counts; generationsRun?: number; tag?: string };
  nightsLearned: number;
}

export interface SiteData {
  mission: Mission;
  raindrop: unknown; // the Raindrop night (data/raindrop_night.json), or null before it ran
  generatedAt?: string;
  heldout: string[]; // storm ids in tick order
  tracks: Record<string, TrackX>;
  trackKeys: string[];
  honesty: {
    simHash?: string;
    simFiles: string[];
    atlas: { status: string; check: string; detail: string }[];
    atlasAt?: string;
    frozenAt?: string;
    locked: { run: boolean; ranAt?: string; registration?: string; rows: LockedRow[] };
  };
  model?: { operator: string; weights_frozen?: boolean; fine_tune_runs?: number };
}

// ------------------------------------------------------------------ parsing helpers
const counts = (x: unknown): Counts => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(x))) {
    const n = num(v);
    if (n != null) out[k] = n;
  }
  return out as Counts;
};

const strArr = (x: unknown) => arr(x).map(str).filter((s): s is string => s != null);

function bySeed(x: unknown): Record<string, SeedScore> {
  const out: Record<string, SeedScore> = {};
  for (const [k, v] of Object.entries(obj(x))) {
    const o = obj(v);
    out[k] = { passed: numOrNull(o.passed), hh: numOrNull(o.homes_dark_hours) };
  }
  return out;
}

function finalScore(x: unknown): FinalScore | null {
  const o = obj(x);
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    night: num(o.night) ?? 0,
    counts: counts(o.counts),
    majority: num(o.majority_passed) ?? 0,
    ticks: str(o.ticks) ?? "",
    bySeed: bySeed(o.by_seed),
    hhMedian: numOrNull(o.hh_median),
    hhMin: numOrNull(o.hh_min),
    hhMax: numOrNull(o.hh_max),
  };
}

function notebook(x: unknown): Notebook | null {
  if (!x || typeof x !== "object") return null;
  const o = obj(x);
  const ctx = obj(o.context);
  const au = obj(o.authority);
  return {
    sensors: arr(o.sensors)
      .map(obj)
      .map((s) => ({ name: str(s.name) ?? "?", expr: str(s.expr) ?? "", description: str(s.description), born_from: str(s.born_from) })),
    rules: arr(o.rules)
      .map(obj)
      .map((r) => ({ id: str(r.id) ?? "?", if: str(r.if) ?? "", then: strArr(r.then), priority: num(r.priority), description: str(r.description), born_from: str(r.born_from) })),
    guardrails: arr(o.guardrails)
      .map(obj)
      .map((g) => ({ id: str(g.id) ?? "?", when: str(g.when) ?? "", enforce: strArr(g.enforce), description: str(g.description), born_from: str(g.born_from) })),
    alerts: arr(o.alerts)
      .map(obj)
      .map((a) => ({ when: str(a.when) ?? "", description: str(a.description) })),
    context: { show: strArr(ctx.show), show_forecast: typeof ctx.show_forecast === "boolean" ? ctx.show_forecast : undefined, memory_top_k: num(ctx.memory_top_k), recent_hours: num(ctx.recent_hours) },
    authority: { llm_decides: strArr(au.llm_decides), call_every_h: num(au.call_every_h) },
    build: obj(o.build),
    memory_policy: obj(o.memory_policy),
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Fallback when final_scores is missing: a learning day that scored the version on 3 seeds. */
function scoresFromGenerations(t: Track, heldout: string[]): FinalScore[] {
  const out: FinalScore[] = [];
  const seen = new Set<string>();
  for (const g of [...t.generations].reverse()) {
    if (!g.harness_id || seen.has(g.harness_id) || g.held_seeds.length < 3) continue;
    seen.add(g.harness_id);
    const ticks = heldout
      .map((s) => {
        const runs = g.heldout.filter((h) => h.scenario_id === s);
        return runs.filter((r) => r.passed).length * 2 > runs.length ? "✓" : "✗";
      })
      .join("");
    const bs: Record<string, SeedScore> = {};
    g.held_seeds.forEach((seed, i) => {
      const runs = g.heldout.filter((h) => h.seed === seed);
      bs[String(seed)] = { passed: g.heldout_seed_passes[i] ?? runs.filter((r) => r.passed).length, hh: g.heldout_hh_by_seed[i] ?? null };
    });
    const hhs = Object.values(bs)
      .map((b) => b.hh)
      .filter((v): v is number => v != null);
    const node = t.lineage.find((l) => l.id === g.harness_id);
    out.push({
      id: g.harness_id,
      night: node?.night ?? g.generation - 1,
      counts: g.counts,
      majority: g.heldout_majority ?? 0,
      ticks,
      bySeed: bs,
      hhMedian: g.heldout_hh_median ?? median(hhs),
      hhMin: hhs.length ? Math.min(...hhs) : null,
      hhMax: hhs.length ? Math.max(...hhs) : null,
      derived: true,
    });
  }
  return out.reverse();
}

function tearOut(key: string, x: unknown): TearOut {
  const o = obj(x);
  const label = key.replace(/^post[AB]:/, "").replace(/^a\d:/, "");
  const bs = bySeed(o.by_seed);
  const hhs = Object.values(bs)
    .map((b) => b.hh)
    .filter((v): v is number => v != null);
  return {
    key,
    label,
    organ: str(o.organ),
    id: str(o.id),
    desc: str(o.desc),
    majority: numOrNull(o.majority_passed),
    ticks: str(o.ticks),
    hhMedian: numOrNull(o.hh_median) ?? median(hhs),
    bySeed: bs,
    full: /\(full\)/.test(key),
  };
}

function parseTrack(key: string, base: Track, rawTrack: Record<string, unknown>, raw: Record<string, unknown>, heldout: string[]): TrackX {
  const fsRaw = arr(rawTrack.final_scores).map(finalScore).filter((f): f is FinalScore => f != null);
  const scores = fsRaw.length ? fsRaw : scoresFromGenerations(base, heldout);
  const lineRaw = arr(rawTrack.lineage).map(obj);
  const frozenTracks = obj(obj(obj(raw.honesty).frozen).tracks);
  const fz = obj(frozenTracks[key]);
  const frozenHash = str(fz.hash);

  const versions: Version[] = base.lineage.map((l, i) => {
    const r = lineRaw.find((x) => x.id === l.id) ?? {};
    const edit = base.edits.find((e) => (e.child_id === l.id || e.stacked_id === l.id) && (e.status === "accepted" || e.status === "stacked"));
    const page = base.pages.find((p) => p.harness_id === l.id);
    return {
      id: l.id,
      parentId: l.parent_id,
      night: l.night ?? i,
      index: i,
      label: `v${i + 1}`,
      counts: l.counts,
      hash: l.hash,
      bornFrom: l.born_from,
      notebook: notebook(r.notebook),
      edit,
      page: page ? { id: page.id, title: page.title, text: page.text, scenario_id: page.scenario_id } : undefined,
      score: scores.find((s) => s.id === l.id),
      isFinal: false,
      isBest: false,
    };
  });
  // versions scored but missing from the lineage (should not happen) are appended so the curve stays complete
  for (const s of scores)
    if (!versions.some((v) => v.id === s.id))
      versions.push({ id: s.id, parentId: null, night: s.night, index: versions.length, label: `v${versions.length + 1}`, counts: s.counts, notebook: null, score: s, isFinal: false, isBest: false });
  versions.sort((a, b) => a.night - b.night || a.index - b.index);
  versions.forEach((v, i) => {
    v.index = i;
    v.label = `v${i + 1}`;
  });
  const final = (frozenHash && versions.find((v) => v.hash && frozenHash.startsWith(v.hash.slice(0, 16)))) || versions[versions.length - 1];
  if (final) final.isFinal = true;
  const scored = versions.filter((v) => v.score);
  const best = [...scored].sort((a, b) => b.score!.majority - a.score!.majority || (a.score!.hhMedian ?? Infinity) - (b.score!.hhMedian ?? Infinity))[0];
  if (best) best.isBest = true;

  const llm = obj(obj(raw.baselines).llm);
  const tearouts = Object.entries(llm)
    .filter(([k]) => k.startsWith(`post${key}:`))
    .map(([k, v]) => tearOut(k, v));
  const zsKey = Object.keys(llm).find((k) => new RegExp(`zero-shot ${key}$`, "i").test(k));
  const ab = obj(rawTrack.ablation);
  const ablation: Ablation | null = Object.keys(ab).length
    ? {
        unplugged: finalScore({ id: "unplugged", ...obj(ab.full_ai_unplugged) }),
        removed: arr(ab.removed)
          .map(obj)
          .map((r) => ({ organ: str(r.organ) ?? "", id: str(r.id) ?? "", desc: str(r.desc) ?? "", majority: numOrNull(r.majority_passed), hhMedian: numOrNull(r.hh_median), xDarker: numOrNull(r.x_darker) })),
      }
    : null;

  const nightsLearned = num(fz.generations_run) ?? Math.max(0, ...base.coach_metrics.map((c) => c.generation));
  return {
    key,
    base,
    versions,
    scores,
    final,
    best,
    v1: versions[0],
    tearouts,
    ablation,
    zeroShot: zsKey ? tearOut(zsKey, llm[zsKey]) : undefined,
    frozen: Object.keys(fz).length ? { hash: frozenHash, counts: counts(fz.counts), generationsRun: num(fz.generations_run), tag: str(fz.tag) } : undefined,
    nightsLearned,
  };
}

export const LOCKED_ORDER = ["A", "B", "T0", "C_A", "C_B", "D_A", "D_B", "T"];

function lockedRows(x: unknown): LockedRow[] {
  const rows = obj(x);
  // "C" and "D" are aliases of C_B / D_B: keep the explicit keys when both exist
  const keys = Object.keys(rows).filter((k) => !((k === "C" && rows.C_B) || (k === "D" && rows.D_B)));
  const rank = (k: string) => {
    const i = LOCKED_ORDER.indexOf(k === "C" ? "C_B" : k === "D" ? "D_B" : k);
    return i < 0 ? 99 : i;
  };
  keys.sort((a, b) => rank(a) - rank(b));
  return keys.map((k) => {
    const o = obj(rows[k]);
    return {
      key: k === "C" ? "C_B" : k === "D" ? "D_B" : k,
      label: str(o.label) ?? k,
      passed: typeof o.passed === "boolean" ? o.passed : null,
      passedSeeds: numOrNull(o.passed_seeds),
      collapses: numOrNull(o.collapses),
      peakShed: numOrNull(o.peak_shed_frac),
      hh: numOrNull(o.homes_dark_hours),
      below594s: numOrNull(o.below_59_4_s),
      collapsed: typeof o.collapsed === "boolean" ? o.collapsed : null,
      apiErrors: numOrNull(o.api_errors),
      seeds: arr(o.seeds)
        .map(obj)
        .map((sd, i) => ({
          seed: num(sd.seed) ?? i,
          passed: typeof sd.passed === "boolean" ? sd.passed : null,
          collapsed: typeof sd.collapsed === "boolean" ? sd.collapsed : null,
          collapseHour: numOrNull(sd.collapse_hour),
          peakShed: numOrNull(sd.peak_shed_frac),
          hh: numOrNull(sd.homes_dark_hours),
          minFreq: numOrNull(sd.min_freq),
          maxBelowMin: numOrNull(sd.max_below_59_4_min),
          aiCalls: numOrNull(sd.ai_calls),
        })),
    };
  });
}

// ------------------------------------------------------------------ stored records
// Every normalized object that came from a stored record maps back to its exact exported JSON
// (which carries `_src: {db, coll, id}` once the exporter writes it).
export interface RecordSrc {
  db: string;
  coll: string;
  id: string;
}
const rawOf = new WeakMap<object, unknown>();
const srcFor = new WeakMap<object, RecordSrc>();
export const rawRecord = (o: object | null | undefined): unknown => (o ? rawOf.get(o) : undefined);
/** Where an object's stored record lives: its own `_src`, or the run it belongs to (showcase steps). */
export const recordSrc = (o: object | null | undefined): RecordSrc | null => (o ? (srcFor.get(o) ?? srcOf(rawOf.get(o))) : null);
export function srcOf(raw: unknown): RecordSrc | null {
  const s = obj(obj(raw)._src);
  const db = str(s.db);
  const coll = str(s.coll);
  const id = str(s.id);
  return db && coll && id ? { db, coll, id } : null;
}

function zip<T extends object>(norm: T[], raws: unknown[]) {
  norm.forEach((n, i) => raws[i] !== undefined && rawOf.set(n, raws[i]));
}
const byGen = (a: unknown, b: unknown) => (num(obj(a).generation) ?? 0) - (num(obj(b).generation) ?? 0);

function linkRecords(mission: Mission, r: Record<string, unknown>) {
  const rawTracks = obj(r.tracks);
  for (const k of mission.trackKeys) {
    const t = mission.tracks[k];
    const rt = obj(rawTracks[k]);
    zip(t.edits, arr(rt.edits).filter((e) => num(obj(e).generation) != null));
    zip(t.pages, arr(rt.pages).filter((p) => str(obj(p).id) != null));
    zip(t.coach_metrics, [...arr(rt.coach_metrics).filter((c) => num(obj(c).generation) != null)].sort(byGen));
    zip(t.l2, [...arr(rt.l2).filter((c) => num(obj(c).generation) != null)].sort(byGen));
    for (const l of t.lineage) {
      const x = arr(rt.lineage).find((y) => obj(y).id === l.id);
      if (x) rawOf.set(l, x);
    }
    const rn = obj(rt.nights);
    for (const [g, steps] of Object.entries(t.nights)) zip(steps, arr(rn[g]).filter((x) => typeof obj(x).type === "string"));
  }
  const rawShow = arr(r.showcase).map(obj);
  for (const sc of mission.showcase) {
    const rs = rawShow.find((x) => str(x.track) === sc.track && str(x.scenario_id) === sc.scenario_id && (num(x.seed) ?? 0) === (sc.seed ?? 0));
    if (!rs) continue;
    for (const [key, run] of Object.entries(sc.runs)) {
      if (!run) continue;
      const rr = obj(obj(rs.runs)[key]);
      const runSrc = srcOf(rr);
      const rawSteps = arr(rr.steps).filter((x) => typeof obj(x).type === "string");
      // each step carries `raw`: the full stored event from the run cache; show that
      run.steps.forEach((st, i) => {
        const x = obj(rawSteps[i]);
        if (rawSteps[i] === undefined) return;
        rawOf.set(st, x.raw !== undefined ? x.raw : rawSteps[i]);
        if (runSrc) srcFor.set(st, runSrc);
      });
    }
  }
}

export function buildSite(raw: unknown): SiteData {
  const mission = normalize(raw);
  const r = obj(raw);
  linkRecords(mission, r);
  const rawTracks = obj(r.tracks);
  // storm order of the ticks: the order of a learning day's held-out runs (the exporter's HELDOUT order)
  const heldout: string[] = [];
  for (const t of Object.values(mission.tracks))
    for (const g of t.generations)
      for (const h of g.heldout) if (!heldout.includes(h.scenario_id) && /^heldout_/.test(h.scenario_id)) heldout.push(h.scenario_id);
  const tracks: Record<string, TrackX> = {};
  for (const k of mission.trackKeys) tracks[k] = parseTrack(k, mission.tracks[k], obj(rawTracks[k]), r, heldout);
  const h = obj(r.honesty);
  const atlas = obj(h.atlas_check);
  const lock = obj(h.locked_2021);
  return {
    mission,
    raindrop: r.raindrop_night ?? null,
    generatedAt: mission.generated_at,
    heldout,
    tracks,
    trackKeys: mission.trackKeys,
    honesty: {
      simHash: str(obj(h.sim_lock).sim_hash),
      simFiles: strArr(obj(h.sim_lock).files),
      atlas: arr(atlas.results)
        .map(obj)
        .map((x) => ({ status: str(x.status) ?? "", check: str(x.check) ?? "", detail: str(x.detail) ?? "" })),
      atlasAt: str(atlas.checked_at),
      frozenAt: str(obj(h.frozen).frozen_at),
      locked: { run: lock.run === true, ranAt: str(lock.ran_at), registration: str(lock.registration), rows: lockedRows(lock.rows) },
    },
  };
}

// ------------------------------------------------------------------ store
export type Theme = "light" | "dark";

interface SiteState {
  data: SiteData | null;
  error: string | null;
  loadedAt: number | null;
  track: string;
  version: string | null; // selected version id in "Harness versions"
  diff: boolean;
  diffLeft: string | null;
  diffRight: string | null;
  theme: Theme;
  focusEdit: string | null; // child_id of an idea to highlight in "What it learned"
  record: { title: string; raw: unknown; src: RecordSrc | null } | null;
  openRecord: (title: string, raw: unknown, src?: RecordSrc | null) => void;
  closeRecord: () => void;
  load: (quiet?: boolean) => Promise<void>;
  setTrack: (t: string) => void;
  setVersion: (id: string | null) => void;
  setDiff: (on: boolean, left?: string | null, right?: string | null) => void;
  setTheme: (t: Theme) => void;
  setFocusEdit: (id: string | null) => void;
}

function initialTheme(): Theme {
  const p = params.get("theme");
  if (p === "dark" || p === "light") return p;
  try {
    const s = localStorage.getItem("site-theme");
    if (s === "dark" || s === "light") return s;
  } catch {
    /* storage blocked */
  }
  return "light";
}

export const useSite = create<SiteState>((set, get) => ({
  data: null,
  error: null,
  loadedAt: null,
  track: params.get("track") ?? "B",
  version: null,
  diff: false,
  diffLeft: null,
  diffRight: null,
  theme: initialTheme(),
  focusEdit: null,
  record: null,
  openRecord: (title, raw, src) => set({ record: { title, raw, src: src !== undefined ? src : srcOf(Array.isArray(raw) ? raw[0] : raw) } }),
  closeRecord: () => set({ record: null }),
  load: async (quiet = false) => {
    try {
      const res = await fetch(missionUrl(BUNDLE), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const cur = get().data;
      if (quiet && cur && cur.generatedAt === obj(raw).generated_at) return;
      const data = buildSite(raw);
      const track = data.tracks[get().track] ? get().track : (data.trackKeys.includes("B") ? "B" : data.trackKeys[0]);
      set({ data, error: null, loadedAt: Date.now(), track });
    } catch (e) {
      if (!quiet || !get().data) set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  setTrack: (t) => set({ track: t, version: null, diffLeft: null, diffRight: null, focusEdit: null }),
  setVersion: (id) => set({ version: id }),
  setDiff: (on, left, right) => set({ diff: on, diffLeft: left === undefined ? get().diffLeft : left, diffRight: right === undefined ? get().diffRight : right }),
  setTheme: (t) => {
    try {
      localStorage.setItem("site-theme", t);
    } catch {
      /* storage blocked */
    }
    set({ theme: t });
  },
  setFocusEdit: (id) => set({ focusEdit: id }),
}));

export function useTrackX(): TrackX | null {
  const data = useSite((s) => s.data);
  const track = useSite((s) => s.track);
  return data?.tracks[track] ?? null;
}

// ------------------------------------------------------------------ night numbering
// lineage[].night, final_scores[].night and edits[].generation are generation numbers; the README and the
// coach's own night events call generation g "Night g−1" (Night 0 = the coach's zero-shot manual).
export const nightOfGen = (gen: number) => gen - 1;
export const nightLabel = (gen: number) => `Night ${gen - 1}`;
/** Display name of when a version was written: "Day 1" for the starting notebook, else "Night n". */
export const versionWhen = (v: { index: number; night: number }) => (v.index === 0 || v.night <= 0 ? "Day 1" : nightLabel(v.night));

// ------------------------------------------------------------------ formatting
const MINUS = "−";

/** Home-hours in the dark: 4.86e9 -> "4.86 B", 3.17e8 -> "317 M". */
export function fmtHH(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 1 : 2)} B`;
  if (a >= 1e6) return `${Math.round(n / 1e6).toLocaleString("en-US")} M`;
  if (a >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")} K`;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtHomes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")} K`;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtSignedPct(p: number | null | undefined, digits = 0): string {
  if (p == null || !Number.isFinite(p)) return "–";
  const v = Number(p.toFixed(digits));
  if (v === 0) return "0%";
  return `${v < 0 ? MINUS : "+"}${Math.abs(v).toFixed(digits)}%`;
}

export function fmtMw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  return `${(n / 1000).toFixed(1)} GW`;
}

export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !from) return null;
  return ((to - from) / from) * 100;
}

/** Simulator accounting can report more than 100% of homes dark; clamp and say "all homes dark". */
export function cleanVerdict(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/(\d+(?:\.\d+)?)% of homes dark/g, (m, p) => (Number(p) >= 100 ? "all homes dark" : m)).replace(/\bhour (\d+)\b/g, "h$1");
}

export function clampPct(frac: number | null | undefined): string {
  if (frac == null || !Number.isFinite(frac)) return "–";
  if (frac >= 1) return "all homes";
  return `${Math.round(frac * 100)}%`;
}

export function stormName(id: string | null | undefined): string {
  if (!id) return "storm";
  return stormLabel(id);
}

export function stormKind(id: string | null | undefined): string {
  if (!id) return "";
  if (id.startsWith("heldout_")) return "unseen";
  if (id.startsWith("train_")) return "training";
  if (id.startsWith("syn_")) return "synthetic";
  return "";
}

export function ticksOf(s: string | null | undefined): ("pass" | "fail" | "na")[] {
  if (!s) return [];
  return [...s].map((c) => (c === "✓" || c === "✔" ? "pass" : c === "✗" || c === "✘" ? "fail" : "na"));
}

export const ORGAN_LABEL: Record<string, string> = {
  habit: "Habits",
  hard_limit: "Hard limits",
  gauge_alarm: "Gauges & alarms",
  briefing_memory: "What the AI sees & remembers",
  authority: "What the AI decides",
  build: "Winter prep",
};

export const ORGAN_SINGULAR: Record<string, string> = {
  habit: "Habit",
  hard_limit: "Hard limit",
  gauge_alarm: "Gauge / alarm",
  briefing_memory: "Briefing & memory",
  authority: "Authority",
  build: "Winter prep",
};

export const organLabel = (k: string | null | undefined) => (k ? ORGAN_LABEL[k] ?? k.replace(/_/g, " ") : "");
export const organShort = (k: string | null | undefined) => (k ? ORGAN_SINGULAR[k] ?? k.replace(/_/g, " ") : "");

export const TRACK_BLURB: Record<string, string> = {
  A: "in-storm only",
  B: "everything, incl. winter prep",
};

// ------------------------------------------------------------------ trace steps
export interface StepGroup {
  h0: number;
  h1: number;
  type: string;
  actor?: string;
  text: string;
  n: number;
  steps: ShowcaseStep[];
}

/** Merge consecutive steps with the same type + text (e.g. the same AI decision repeated hourly). */
export function groupSteps(steps: ShowcaseStep[]): StepGroup[] {
  const out: StepGroup[] = [];
  const lastByType = new Map<string, StepGroup>();
  for (const s of [...steps].sort((a, b) => a.h - b.h)) {
    const prev = lastByType.get(s.type);
    if (prev && prev.text === s.text && s.h - prev.h1 <= 3) {
      prev.h1 = s.h;
      prev.n++;
      prev.steps.push(s);
      continue;
    }
    const g: StepGroup = { h0: s.h, h1: s.h, type: s.type, actor: s.actor, text: s.text, n: 1, steps: [s] };
    out.push(g);
    lastByType.set(s.type, g);
  }
  return out;
}

export const STEP_KIND: Record<string, { label: string; tone: "sim" | "ai" | "nb" | "bad" | "mem" }> = {
  ai_decision: { label: "AI decision", tone: "ai" },
  llm_call: { label: "AI decision", tone: "ai" },
  rule_fired: { label: "Habit", tone: "nb" },
  guardrail: { label: "Hard limit", tone: "nb" },
  sensor_alert: { label: "Alarm", tone: "nb" },
  memory_recall: { label: "Memory", tone: "mem" },
  recall: { label: "Memory", tone: "mem" },
  false_all_clear: { label: "False all-clear", tone: "bad" },
  freeze_off: { label: "Gas wells", tone: "sim" },
  icing: { label: "Icing", tone: "sim" },
  shed_start: { label: "Outages begin", tone: "sim" },
  shed_end: { label: "Outages end", tone: "sim" },
  gas_feedback: { label: "Gas feedback", tone: "bad" },
  ufls: { label: "Relays tripped", tone: "bad" },
  collapse: { label: "Collapse", tone: "bad" },
  restore: { label: "Plants return", tone: "sim" },
  trip: { label: "Plant trip", tone: "sim" },
  build: { label: "Winter prep", tone: "nb" },
};

export const stepKind = (t: string) => STEP_KIND[t] ?? { label: t.replace(/_/g, " "), tone: "sim" as const };

/** Strip the "AI decides:" prefix etc. so the label column carries the kind. */
export function stepText(type: string, text: string): string {
  let t = text
    .replace(/^AI decides:\s*/i, "")
    .replace(/^Manual habit:\s*/i, "")
    .replace(/^Guardrail:\s*/i, "")
    .replace(/^Hard limit:\s*/i, "")
    .replace(/^Alarm:\s*/i, "")
    .replace(/^Remembers:?\s*/i, "")
    .replace(/\bmanual\b/g, "notebook");
  if (type === "false_all_clear") t = t.replace(/^Raindrop[^:]*:\s*/i, "");
  return cleanVerdict(t);
}
