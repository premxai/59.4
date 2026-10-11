// Derived views of the bundle: playback reveal state, scoreboard rows, lineage columns, notebooks.
import { obj } from "./normalize";
import { isKept, nightNumber, notebookVersion } from "./plain";
export { notebookVersion };
import type { CoachMetric, Counts, Edit, Generation, L2Entry, LlmBaseline, Mission, NightStep, Showcase, Track } from "./types";

// ------------------------------------------------------------------ generations / playback cursor
export interface Cursor {
  gen: number;
  /** index of the last revealed step in nights[gen]; -1 = nothing yet */
  step: number;
}

export function trackGens(t: Track | null | undefined): number[] {
  if (!t) return [];
  const s = new Set<number>();
  t.generations.forEach((g) => s.add(g.generation));
  Object.keys(t.nights).forEach((k) => s.add(Number(k)));
  t.edits.forEach((e) => s.add(e.generation));
  return [...s].filter(Number.isFinite).sort((a, b) => a - b);
}

export const stepsOf = (t: Track | null | undefined, g: number): NightStep[] => t?.nights[g] ?? [];

export function genOf(t: Track | null | undefined, g: number): Generation | undefined {
  return t?.generations.find((x) => x.generation === g);
}

function stepIndex(t: Track, e: Edit, types: string[]): number {
  const steps = stepsOf(t, e.generation);
  const ids = [e.child_id, e.stacked_id].filter((x): x is string => !!x);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!types.includes(s.type)) continue;
    const vid = s.data.vid ?? s.data.harness_id;
    if (typeof vid === "string" && ids.includes(vid)) return i;
  }
  for (let i = 0; i < steps.length; i++) if (types.includes(steps[i].type) && steps[i].text.includes(e.title)) return i;
  return -1;
}

export interface Reveal {
  visible: boolean;
  tested: boolean;
  decided: boolean;
}

const ALL: Reveal = { visible: true, tested: true, decided: true };
const NONE: Reveal = { visible: false, tested: false, decided: false };

/** How much of an idea the night playback has revealed so far. */
export function revealEdit(t: Track, e: Edit, cur: Cursor): Reveal {
  if (e.generation < cur.gen) return ALL;
  if (e.generation > cur.gen) return NONE;
  const end = stepsOf(t, e.generation).length - 1;
  const p = stepIndex(t, e, ["proposal"]);
  const d = stepIndex(t, e, isKept(e) ? ["accept", "stacked"] : ["reject", "reject_gaming", "reject_memorization"]);
  const te = stepIndex(t, e, ["test"]);
  const di = d >= 0 ? d : end;
  const pi = p >= 0 ? p : di;
  const ti = te >= 0 ? te : di;
  return { visible: cur.step >= pi, tested: cur.step >= ti, decided: cur.step >= di };
}

export function decidedKept(t: Track, cur: Cursor): Edit[] {
  return t.edits.filter((e) => isKept(e) && e.generation <= cur.gen && revealEdit(t, e, cur).decided);
}

export interface NotebookNow {
  id?: string;
  version: string;
  counts: Counts;
  /** counts before the most recent change (to light up branches that grew) */
  prev: Counts;
  /** the idea(s) that produced this notebook */
  from: Edit[];
}

/** The notebook "as of" the playback cursor: switches to the new version the moment a keep is revealed. */
export function notebookNow(t: Track, cur: Cursor): NotebookNow {
  const g = genOf(t, cur.gen);
  const baseId = g?.harness_id ?? t.lineage[0]?.id;
  const base = g?.counts ?? t.lineage.find((l) => l.id === baseId)?.counts ?? {};
  const keptTonight = t.edits.filter((e) => e.generation === cur.gen && isKept(e) && revealEdit(t, e, cur).decided);
  if (keptTonight.length) {
    const last = keptTonight[keptTonight.length - 1];
    const id = last.stacked_id ?? last.child_id ?? undefined;
    const counts = t.lineage.find((l) => l.id === id)?.counts ?? genOf(t, cur.gen + 1)?.counts ?? base;
    return { id, version: notebookVersion(t, id), counts, prev: base, from: keptTonight };
  }
  const gens = trackGens(t);
  const prevGen = gens[gens.indexOf(cur.gen) - 1];
  const prev = prevGen != null ? (genOf(t, prevGen)?.counts ?? base) : base;
  const from = prevGen != null ? t.edits.filter((e) => e.generation === prevGen && isKept(e)) : [];
  return { id: baseId, version: notebookVersion(t, baseId), counts: base, prev, from };
}

// ------------------------------------------------------------------ scoreboard
export type CellState = "pass" | "fail" | "inconclusive" | "missing";

export interface Cell {
  scenario_id: string;
  state: CellState;
  passedSeeds: number;
  seeds: number;
}

export interface ScoreRow {
  key: string;
  kind: "baseline" | "gen";
  label: string;
  sub?: string;
  gen?: number;
  harnessId?: string;
  cells: Cell[];
  passed: number;
  total: number;
  hh: number | null;
  hhMin: number | null;
  hhMax: number | null;
  seeds: number;
  provisional: boolean;
}

/** The unseen storms, in the order they first appear in the bundle. */
export function stormIds(t: Track | null | undefined): string[] {
  const out: string[] = [];
  for (const g of t?.generations ?? []) for (const h of g.heldout) if (!out.includes(h.scenario_id)) out.push(h.scenario_id);
  return out;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function genRow(t: Track, g: Generation, storms: string[]): ScoreRow {
  const cells: Cell[] = storms.map((sid) => {
    const runs = g.heldout.filter((h) => h.scenario_id === sid).sort((a, b) => a.seed - b.seed);
    if (!runs.length) return { scenario_id: sid, state: "missing", passedSeeds: 0, seeds: 0 };
    const passedSeeds = runs.filter((r) => r.passed).length;
    let state: CellState;
    if (runs.length >= 3) {
      // a storm counts only if at least 2 of its 3 versions pass
      const decided = runs.filter((r) => !r.inconclusive);
      state = passedSeeds * 2 > runs.length ? "pass" : decided.length < runs.length && (passedSeeds + (runs.length - decided.length)) * 2 > runs.length ? "inconclusive" : "fail";
    } else {
      const r0 = runs.find((r) => r.seed === 0) ?? runs[0];
      state = r0.inconclusive ? "inconclusive" : r0.passed ? "pass" : "fail";
    }
    return { scenario_id: sid, state, passedSeeds, seeds: runs.length };
  });
  const seeds = Math.max(g.held_seeds.length, g.heldout_hh_by_seed.length, 0) || Math.max(0, ...cells.map((c) => c.seeds));
  const bySeed = g.heldout_hh_by_seed;
  const sum0 = g.heldout.filter((h) => h.seed === (g.held_seeds[0] ?? 0)).reduce((a, h) => a + (h.homes_dark_hours ?? 0), 0);
  const hh = g.heldout_hh_median ?? median(bySeed) ?? (g.heldout.length ? sum0 : null);
  return {
    key: `gen${g.generation}`,
    kind: "gen",
    label: `Day ${g.generation}`,
    sub: notebookVersion(t, g.harness_id),
    gen: g.generation,
    harnessId: g.harness_id,
    cells,
    passed: cells.filter((c) => c.state === "pass").length,
    total: storms.length,
    hh,
    hhMin: bySeed.length >= 2 ? Math.min(...bySeed) : null,
    hhMax: bySeed.length >= 2 ? Math.max(...bySeed) : null,
    seeds,
    provisional: seeds > 0 && seeds < 3,
  };
}

export function findBaseline(m: Mission, pattern: RegExp, trackKey?: string): LlmBaseline | undefined {
  const keys = Object.keys(m.baselines.llm).filter((k) => pattern.test(k));
  if (trackKey) {
    const exact = keys.find((k) => new RegExp(`\\b${trackKey}\\b\\s*\\)?$`).test(k.trim()));
    if (exact) return m.baselines.llm[exact];
  }
  return keys.length === 1 || !trackKey ? m.baselines.llm[keys[0]] : undefined;
}

export function baselineRow(b: LlmBaseline | undefined, storms: string[], key: string, label: string, sub: string): ScoreRow | null {
  if (!b) return null;
  const ticks = [...(b.ticks ?? "")];
  const cells: Cell[] = storms.map((sid, i) => ({
    scenario_id: sid,
    state: ticks[i] === "✓" ? "pass" : ticks[i] === "✗" ? "fail" : "missing",
    passedSeeds: 0,
    seeds: 0,
  }));
  const vals = Object.values(b.by_seed)
    .map((s) => s.homes_dark_hours)
    .filter((v): v is number => typeof v === "number");
  return {
    key,
    kind: "baseline",
    label,
    sub,
    cells,
    passed: b.majority_passed ?? cells.filter((c) => c.state === "pass").length,
    total: storms.length || ticks.length,
    hh: median(vals),
    hhMin: vals.length >= 2 ? Math.min(...vals) : null,
    hhMax: vals.length >= 2 ? Math.max(...vals) : null,
    seeds: vals.length,
    provisional: vals.length > 0 && vals.length < 3,
  };
}

export interface Scoreboard {
  storms: string[];
  baseline: ScoreRow | null;
  rows: ScoreRow[];
}

export function scoreboard(m: Mission, t: Track): Scoreboard {
  let storms = stormIds(t);
  const zs = findBaseline(m, /zero.?shot/i, t.key);
  if (!storms.length && zs?.ticks) storms = [...zs.ticks].map((_, i) => `storm_${i + 1}`);
  const baseline = baselineRow(zs, storms, "zeroshot", "Claude's own best guess", "no learning");
  const rows = t.generations.map((g) => genRow(t, g, storms));
  if (!rows.length) {
    // nothing evaluated yet: fall back to the Day-1 baseline numbers if the exporter has them
    const d1 = findBaseline(m, t.key === "A" ? /A day 1/i : /^a4:v1$/i);
    const r = baselineRow(d1, storms, "day1", "Day 1", "v1");
    if (r) rows.push({ ...r, kind: "gen", gen: 1 });
  }
  return { storms, baseline, rows };
}

// ------------------------------------------------------------------ evolution columns
export interface DayColumn {
  gen: number;
  night: number;
  notebookId?: string;
  version: string;
  row?: ScoreRow;
  kept: Edit[];
  rejected: Edit[];
  metric?: CoachMetric;
  l2: L2Entry[];
  deepSleep?: NightStep;
}

export function dayColumns(m: Mission, t: Track): DayColumn[] {
  const sb = scoreboard(m, t);
  return trackGens(t).map((g) => {
    const gen = genOf(t, g);
    const id = gen?.harness_id ?? (g === trackGens(t)[0] ? t.lineage[0]?.id : undefined);
    return {
      gen: g,
      night: nightNumber(t, g),
      notebookId: id,
      version: notebookVersion(t, id),
      row: sb.rows.find((r) => r.gen === g),
      kept: t.edits.filter((e) => e.generation === g && isKept(e)),
      rejected: t.edits.filter((e) => e.generation === g && !isKept(e)),
      metric: t.coach_metrics.find((c) => c.generation === g),
      l2: t.l2.filter((x) => x.generation === g),
      deepSleep: stepsOf(t, g).find((s) => s.type === "deep_sleep"),
    };
  });
}

// ------------------------------------------------------------------ winter prep (drives the heat-trace layer)
export function buildFor(t: Track, harnessId: string | null | undefined): Record<string, unknown> {
  if (!harnessId) return { ...(t.fixed_build ?? {}) };
  if (t.manual.id === harnessId && t.manual.build) return { ...(t.fixed_build ?? {}), ...obj(t.manual.build) };
  const path: string[] = [];
  let cur: string | null | undefined = harnessId;
  for (let guard = 0; cur && guard < 200; guard++) {
    path.unshift(cur);
    const id: string = cur;
    cur = t.lineage.find((l) => l.id === id)?.parent_id ?? t.edits.find((e) => e.child_id === id || e.stacked_id === id)?.parent_id ?? null;
  }
  let b: Record<string, unknown> = { ...(t.fixed_build ?? {}) };
  for (const id of path) {
    const e = t.edits.find((x) => x.child_id === id || x.stacked_id === id);
    for (const op of e?.ops ?? []) {
      if (op.op !== "set_build") continue;
      const { op: _ignored, ...rest } = op;
      void _ignored;
      b = { ...b, ...rest };
    }
  }
  return b;
}

/** 1 when the build winterizes anything (plants or wells), else 0. */
export function winterLevel(b: Record<string, unknown>): number {
  const vals: number[] = [];
  const wp = b.winterize_plants;
  if (wp && typeof wp === "object") for (const v of Object.values(wp as Record<string, unknown>)) if (typeof v === "number") vals.push(v);
  if (typeof b.winterize_wells === "number") vals.push(b.winterize_wells);
  return vals.some((v) => v > 0) ? 1 : 0;
}

export function showcaseFor(m: Mission | null, trackKey: string): Showcase | undefined {
  if (!m) return undefined;
  return m.showcase.find((s) => s.track === trackKey) ?? m.showcase[0];
}

// ------------------------------------------------------------------ notebook lookups (live compare)
/** The bundle track that contains this notebook version (lineage, generations or an edit's child). */
export function trackOfNotebook(m: Mission | null, id: string | null | undefined): Track | undefined {
  if (!m || !id) return undefined;
  return Object.values(m.tracks).find(
    (t) => t.lineage.some((l) => l.id === id) || t.generations.some((g) => g.harness_id === id) || t.edits.some((e) => e.child_id === id || e.stacked_id === id),
  );
}

export function countsOf(m: Mission | null, id: string | null | undefined): Counts | undefined {
  const t = trackOfNotebook(m, id);
  if (!t || !id) return undefined;
  return t.lineage.find((l) => l.id === id)?.counts ?? t.generations.find((g) => g.harness_id === id)?.counts;
}

/** Kept ideas on the lineage path from the Day-1 notebook to this version, oldest first. */
export function keptPath(t: Track, id: string): Edit[] {
  const path = new Set<string>();
  let cur: string | null | undefined = id;
  for (let guard = 0; cur && guard < 200; guard++) {
    path.add(cur);
    const c: string = cur;
    cur = t.lineage.find((l) => l.id === c)?.parent_id ?? t.edits.find((e) => (e.child_id === c || e.stacked_id === c) && isKept(e))?.parent_id ?? null;
  }
  return t.edits.filter((e) => isKept(e) && ((e.child_id && path.has(e.child_id)) || (e.stacked_id && path.has(e.stacked_id)))).sort((a, b) => a.generation - b.generation);
}

/** Heat-trace layer for a notebook: from its build in the bundle, else a proxy from the catalog counts. */
export function winterForNotebook(m: Mission | null, id: string | null | undefined, buildItems?: number): number {
  const t = trackOfNotebook(m, id);
  if (t && id) return winterLevel(buildFor(t, id));
  return (buildItems ?? 0) > 1 ? 1 : 0;
}
