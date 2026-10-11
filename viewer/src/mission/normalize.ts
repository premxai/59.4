// Defensive parsing of the overnight bundle: any missing / null / wrongly-typed field degrades to an
// empty value instead of crashing the screen.
import type {
  CalibrationPoint,
  CoachMetric,
  Counts,
  Edit,
  EditOp,
  FinalManual,
  Generation,
  HeldoutRun,
  Honesty,
  L2Entry,
  LineageNode,
  LlmBaseline,
  ManualPage,
  Mission,
  NightStep,
  Showcase,
  ShowcaseRun,
  ShowcaseStep,
  Track,
} from "./types";

type Obj = Record<string, unknown>;

export const obj = (x: unknown): Obj => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
export const numOrNull = (x: unknown): number | null => num(x) ?? null;
export const str = (x: unknown): string | undefined => (typeof x === "string" ? x : typeof x === "number" ? String(x) : undefined);
const bool = (x: unknown): boolean | undefined => (typeof x === "boolean" ? x : typeof x === "number" ? x !== 0 : undefined);
const strArr = (x: unknown): string[] => arr(x).map(str).filter((s): s is string => s != null);
const numArr = (x: unknown): number[] => arr(x).map(num).filter((n): n is number => n != null);

function counts(x: unknown): Counts {
  const o = obj(x);
  const out: Counts = {};
  for (const [k, v] of Object.entries(o)) {
    const n = num(v);
    if (n != null) (out as Record<string, number>)[k] = n;
  }
  return out;
}

function heldout(x: unknown): HeldoutRun | null {
  const o = obj(x);
  const scenario_id = str(o.scenario_id);
  if (!scenario_id) return null;
  return {
    scenario_id,
    seed: num(o.seed) ?? 0,
    passed: bool(o.passed) ?? false,
    homes_dark_hours: numOrNull(o.homes_dark_hours),
    verdict: str(o.verdict),
    inconclusive: bool(o.inconclusive) ?? false,
  };
}

function generation(x: unknown): Generation | null {
  const o = obj(x);
  const g = num(o.generation);
  if (g == null) return null;
  return {
    generation: g,
    harness_id: str(o.harness_id),
    hash: str(o.hash),
    counts: counts(o.counts),
    pages: num(o.pages),
    train_majority: num(o.train_majority),
    heldout_majority: num(o.heldout_majority),
    heldout_hh_median: numOrNull(o.heldout_hh_median),
    heldout_hh_by_seed: numArr(o.heldout_hh_by_seed),
    held_seeds: numArr(o.held_seeds),
    heldout_seed_passes: numArr(o.heldout_seed_passes),
    heldout: arr(o.heldout).map(heldout).filter((h): h is HeldoutRun => h != null),
    inconclusive: num(o.inconclusive),
  };
}

function lineage(x: unknown): LineageNode | null {
  const o = obj(x);
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    parent_id: str(o.parent_id) ?? null,
    night: num(o.night),
    status: str(o.status),
    counts: counts(o.counts),
    kept: strArr(o.kept),
    born_from: str(o.born_from) ?? null,
    hash: str(o.hash),
  };
}

function edit(x: unknown): Edit | null {
  const o = obj(x);
  const g = num(o.generation);
  if (g == null) return null;
  return {
    generation: g,
    title: str(o.title) ?? "(untitled idea)",
    organ: str(o.organ) ?? "habit",
    organs_touched: strArr(o.organs_touched),
    status: str(o.status) ?? "inconclusive",
    reason: str(o.reason) ?? null,
    reason_kind: str(o.reason_kind) ?? null,
    ops: arr(o.ops)
      .map(obj)
      .filter((op) => typeof op.op === "string")
      .map((op) => op as EditOp),
    predicted: numOrNull(o.predicted),
    predicted_pct: numOrNull(o.predicted_pct),
    actual: numOrNull(o.actual),
    actual_pct: numOrNull(o.actual_pct),
    ticks: str(o.ticks),
    lesson: str(o.lesson),
    child_id: str(o.child_id) ?? null,
    stacked_id: str(o.stacked_id) ?? null,
    parent_id: str(o.parent_id) ?? null,
    strategy_version: num(o.strategy_version),
    night0: bool(o.night0) ?? false,
    redteam: bool(o.redteam) ?? false,
  };
}

function nights(x: unknown): Record<number, NightStep[]> {
  const out: Record<number, NightStep[]> = {};
  for (const [k, v] of Object.entries(obj(x))) {
    const g = Number(k);
    if (!Number.isFinite(g)) continue;
    out[g] = arr(v)
      .map(obj)
      .filter((s) => typeof s.type === "string")
      .map((s) => ({ type: String(s.type), actor: str(s.actor), text: str(s.text) ?? "", data: obj(s.data) }));
  }
  return out;
}

function coachMetric(x: unknown): CoachMetric | null {
  const o = obj(x);
  const g = num(o.generation);
  if (g == null) return null;
  return {
    generation: g,
    night0: bool(o.night0),
    strategy_version: num(o.strategy_version),
    config: obj(o.config),
    n: num(o.n),
    invalid: num(o.invalid),
    memorization: num(o.memorization),
    duplicate: num(o.duplicate),
    gaming: num(o.gaming),
    kept: num(o.kept),
    stacked: num(o.stacked),
    tested: num(o.tested),
    mae_pct: numOrNull(o.mae_pct),
    sign_acc: numOrNull(o.sign_acc),
    best_actual_pct: numOrNull(o.best_actual_pct),
    organs: strArr(o.organs),
  };
}

function l2(x: unknown): L2Entry | null {
  const o = obj(x);
  const g = num(o.generation);
  if (g == null) return null;
  const ab = o.ab && typeof o.ab === "object" ? obj(o.ab) : null;
  return {
    generation: g,
    insight: str(o.insight),
    adopted: bool(o.adopted),
    ab: ab
      ? {
          night_replayed: num(ab.night_replayed),
          old_mae: numOrNull(ab.old_mae),
          new_mae: numOrNull(ab.new_mae),
          old_best: numOrNull(ab.old_best),
          new_best: numOrNull(ab.new_best),
          adopt: bool(ab.adopt),
          new_proposals: arr(ab.new_proposals),
        }
      : null,
    acceptance_rate: numOrNull(o.acceptance_rate),
    proposed_config: o.proposed_config ? obj(o.proposed_config) : null,
    previous_config: o.previous_config ? obj(o.previous_config) : null,
    strategy_version: num(o.strategy_version),
  };
}

function calibration(x: unknown): CalibrationPoint | null {
  const o = obj(x);
  const p = num(o.predicted_pct);
  const a = num(o.actual_pct);
  if (p == null || a == null) return null;
  return { generation: num(o.generation) ?? 0, organ: str(o.organ), predicted_pct: p, actual_pct: a, strategy_version: num(o.strategy_version), status: str(o.status) };
}

function page(x: unknown): ManualPage | null {
  const o = obj(x);
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    title: str(o.title) ?? id,
    text: str(o.text) ?? "",
    generation: num(o.generation),
    organ: str(o.organ),
    harness_id: str(o.harness_id),
    scenario_id: str(o.scenario_id) ?? null,
  };
}

function track(key: string, x: unknown): Track {
  const o = obj(x);
  return {
    key,
    tag: str(o.tag),
    track: str(o.track),
    fixed_build: obj(o.fixed_build),
    generations: arr(o.generations)
      .map(generation)
      .filter((g): g is Generation => g != null)
      .sort((a, b) => a.generation - b.generation),
    lineage: arr(o.lineage).map(lineage).filter((l): l is LineageNode => l != null),
    edits: arr(o.edits).map(edit).filter((e): e is Edit => e != null),
    nights: nights(o.nights),
    coach_metrics: arr(o.coach_metrics)
      .map(coachMetric)
      .filter((m): m is CoachMetric => m != null)
      .sort((a, b) => a.generation - b.generation),
    l2: arr(o.l2)
      .map(l2)
      .filter((m): m is L2Entry => m != null)
      .sort((a, b) => a.generation - b.generation),
    calibration: arr(o.calibration).map(calibration).filter((c): c is CalibrationPoint => c != null),
    manual: obj(o.manual) as FinalManual,
    pages: arr(o.pages).map(page).filter((p): p is ManualPage => p != null),
  };
}

function llmBaselines(x: unknown): Record<string, LlmBaseline> {
  const out: Record<string, LlmBaseline> = {};
  for (const [key, v] of Object.entries(obj(x))) {
    const o = obj(v);
    const by_seed: LlmBaseline["by_seed"] = {};
    for (const [seed, s] of Object.entries(obj(o.by_seed))) {
      const so = obj(s);
      by_seed[seed] = { passed: num(so.passed), homes_dark_hours: numOrNull(so.homes_dark_hours) };
    }
    out[key] = { key, majority_passed: num(o.majority_passed), ticks: str(o.ticks), by_seed, title: str(o.title) ?? null };
  }
  return out;
}

function showcaseRun(x: unknown): ShowcaseRun | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = obj(x);
  return {
    replay: str(o.replay),
    passed: bool(o.passed),
    verdict: str(o.verdict),
    homes_dark_hours: numOrNull(o.homes_dark_hours),
    api_errors: num(o.api_errors),
    steps: arr(o.steps)
      .map(obj)
      .filter((s) => typeof s.type === "string")
      .map((s): ShowcaseStep => ({ h: num(s.h) ?? 0, type: String(s.type), actor: str(s.actor), text: str(s.text) ?? "" })),
  };
}

function showcase(x: unknown): Showcase | null {
  const o = obj(x);
  const runsIn = obj(o.runs);
  const runs: Showcase["runs"] = {};
  for (const [k, v] of Object.entries(runsIn)) {
    const r = showcaseRun(v);
    if (r) runs[k] = r;
  }
  if (!Object.keys(runs).length) return null;
  return { track: str(o.track) ?? "A", scenario_id: str(o.scenario_id), seed: num(o.seed), runs };
}

export function normalize(raw: unknown): Mission {
  const o = obj(raw);
  const tracksIn = obj(o.tracks);
  const tracks: Record<string, Track> = {};
  for (const [k, v] of Object.entries(tracksIn)) tracks[k] = track(k, v);
  const trackKeys = Object.keys(tracks).sort();
  const b = obj(o.baselines);
  return {
    format: str(o.format) ?? "unknown",
    generated_at: str(o.generated_at),
    tracks,
    trackKeys,
    baselines: { llm: llmBaselines(b.llm), track_a_rule: str(b.track_a_rule), scripted: b.scripted },
    honesty: obj(o.honesty) as Honesty,
    showcase: arr(o.showcase).map(showcase).filter((s): s is Showcase => s != null),
  };
}

export function emptyTrack(key: string): Track {
  return track(key, {});
}
