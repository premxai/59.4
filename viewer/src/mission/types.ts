// Types for the Mission Control bundle `594-mission/1` (viewer/public/mission/594_mission.json).
// The file is regenerated overnight while the loop runs, so after `normalize()` every collection
// is present (possibly empty) and every scalar that the exporter may omit is optional.

export type TrackKey = string; // "A" | "B" (any key the exporter writes is accepted)

export type Organ = "habit" | "hard_limit" | "gauge_alarm" | "briefing_memory" | "authority" | "build" | string;

export type Counts = Partial<
  Record<
    | "gauges"
    | "habits"
    | "hard_limits"
    | "alarms"
    | "build_items"
    | "briefing_items"
    | "forecast"
    | "memory_pages_shown"
    | "ai_decides"
    | "ask_ai_every_h",
    number
  >
>;

export interface HeldoutRun {
  scenario_id: string;
  seed: number;
  passed: boolean;
  homes_dark_hours: number | null;
  verdict?: string;
  inconclusive?: boolean;
}

export interface Generation {
  generation: number;
  harness_id?: string;
  hash?: string;
  counts: Counts;
  pages?: number;
  train_majority?: number;
  heldout_majority?: number;
  heldout_hh_median?: number | null;
  heldout_hh_by_seed: number[];
  held_seeds: number[];
  heldout_seed_passes: number[];
  heldout: HeldoutRun[];
  inconclusive?: number;
}

export interface LineageNode {
  id: string;
  parent_id: string | null;
  night?: number;
  status?: string;
  counts: Counts;
  kept: string[];
  born_from?: string | null;
  hash?: string;
}

export type EditStatus = "accepted" | "stacked" | "rejected" | "inconclusive" | string;

export interface EditOp {
  op: string;
  [k: string]: unknown;
}

export interface Edit {
  generation: number;
  title: string;
  organ: Organ;
  organs_touched: string[];
  status: EditStatus;
  reason?: string | null;
  reason_kind?: string | null;
  ops: EditOp[];
  predicted?: number | null;
  predicted_pct?: number | null;
  actual?: number | null;
  actual_pct?: number | null;
  ticks?: string;
  lesson?: string;
  child_id?: string | null;
  stacked_id?: string | null;
  parent_id?: string | null;
  strategy_version?: number;
  night0?: boolean;
  redteam?: boolean;
}

export interface NightStep {
  type: string;
  actor?: string;
  text: string;
  data: Record<string, unknown>;
}

export interface CoachMetric {
  generation: number;
  night0?: boolean;
  strategy_version?: number;
  config?: Record<string, unknown>;
  n?: number;
  invalid?: number;
  memorization?: number;
  duplicate?: number;
  gaming?: number;
  kept?: number;
  stacked?: number;
  tested?: number;
  mae_pct?: number | null;
  sign_acc?: number | null;
  best_actual_pct?: number | null;
  organs?: string[];
}

export interface L2Entry {
  generation: number;
  insight?: string;
  adopted?: boolean;
  ab?: {
    night_replayed?: number;
    old_mae?: number | null;
    new_mae?: number | null;
    old_best?: number | null;
    new_best?: number | null;
    adopt?: boolean;
    new_proposals?: unknown[];
  } | null;
  acceptance_rate?: number | null;
  proposed_config?: Record<string, unknown> | null;
  previous_config?: Record<string, unknown> | null;
  strategy_version?: number;
}

export interface CalibrationPoint {
  generation: number;
  organ?: string;
  predicted_pct: number;
  actual_pct: number;
  strategy_version?: number;
  status?: string;
}

export interface ManualPage {
  id: string;
  title: string;
  text: string;
  generation?: number;
  organ?: string;
  harness_id?: string;
  scenario_id?: string | null;
}

export interface FinalManual {
  id?: string;
  parent_id?: string;
  generation?: number;
  sensors?: { name?: string; expr?: string; description?: string; born_from?: string }[];
  rules?: { id?: string; if?: string; then?: string[]; priority?: number; description?: string; born_from?: string }[];
  guardrails?: { id?: string; when?: string; enforce?: string[]; description?: string; born_from?: string }[];
  alerts?: { when?: string; description?: string }[];
  context?: { show?: string[]; show_forecast?: boolean; memory_top_k?: number; recent_hours?: number };
  authority?: { llm_decides?: string[]; call_every_h?: number };
  build?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Track {
  key: TrackKey;
  tag?: string;
  track?: string;
  fixed_build?: Record<string, unknown>;
  generations: Generation[];
  lineage: LineageNode[];
  edits: Edit[];
  nights: Record<number, NightStep[]>;
  coach_metrics: CoachMetric[];
  l2: L2Entry[];
  calibration: CalibrationPoint[];
  manual: FinalManual;
  pages: ManualPage[];
}

export interface LlmBaseline {
  key: string;
  majority_passed?: number;
  ticks?: string;
  by_seed: Record<string, { passed?: number; homes_dark_hours?: number | null }>;
  title?: string | null;
}

export interface ShowcaseStep {
  h: number;
  type: string;
  actor?: string;
  text: string;
}

export interface ShowcaseRun {
  replay?: string;
  passed?: boolean;
  verdict?: string;
  homes_dark_hours?: number | null;
  api_errors?: number;
  steps: ShowcaseStep[];
}

export interface Showcase {
  track: TrackKey;
  scenario_id?: string;
  seed?: number;
  runs: Partial<Record<"day1" | "final", ShowcaseRun>> & Record<string, ShowcaseRun | undefined>;
}

export interface Honesty {
  sim_lock?: { sim_hash?: string; files?: string[] } | null;
  atlas_check?: Record<string, unknown> | null;
  /** Optional (not exported yet): the locked 2021 exam. */
  locked_2021?: { run?: boolean; passed?: boolean; verdict?: string; homes_dark_hours?: number } | null;
  [k: string]: unknown;
}

export interface Mission {
  format: string;
  generated_at?: string;
  tracks: Record<TrackKey, Track>;
  trackKeys: TrackKey[];
  baselines: {
    llm: Record<string, LlmBaseline>;
    track_a_rule?: string;
    scripted?: unknown;
  };
  honesty: Honesty;
  showcase: Showcase[];
}
