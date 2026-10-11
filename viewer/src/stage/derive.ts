// Pure derivations for the Stage: storm phases, agent interventions, observations, the verified checks.
// Everything here is computed from simulator frames (GridFrame) and the simulator's own final result.
import type { AreaKey } from "../grid3d/areas";
import { TOTAL_HOMES } from "../grid3d/adapters";
import { gridStrain } from "../grid3d/model";
import type { GridFrame } from "../grid3d/types";
import type { LiveResult } from "../mission/live";

export type Phase = "calm" | "approaching" | "struggling" | "critical" | "acting" | "recovery" | "stable";

export const PHASE_INFO: Record<Phase, { label: string; tone: string }> = {
  calm: { label: "Before the storm", tone: "calm" },
  approaching: { label: "Storm approaching", tone: "cold" },
  struggling: { label: "Grid struggling", tone: "warn" },
  critical: { label: "Critical", tone: "bad" },
  acting: { label: "Agent intervenes", tone: "good" },
  recovery: { label: "Recovery", tone: "good" },
  stable: { label: "Stable", tone: "calm" },
};

/** Timeline legend order. */
export const PHASE_ORDER: Phase[] = ["approaching", "struggling", "critical", "acting", "recovery", "stable"];

export interface StageStep {
  h: number;
  type: string;
  text: string;
}

export interface Marker {
  h: number;
  kind: "ai" | "habit" | "limit" | "alarm" | "memory";
  text: string;
}

const freqLow = (f: GridFrame) => Math.min(f.freqHz, f.freqMinHz ?? f.freqHz);
export const isCrit = (f: GridFrame) => f.collapsed || f.shedFrac > 0.002 || f.countdownS != null || freqLow(f) < 59.6;
// dynamic trouble only (plants out for planned maintenance are not "struggling" by themselves)
const isStrain = (f: GridFrame) => f.reserveMw < 5000 || gridStrain(f) > 0.35 || freqLow(f) < 59.85 || f.gasSupply < 0.95 || (f.windOk ?? 1) < 0.7;

/** Category set of an AI decision ("rolling outages 1,500 MW; keep gas…" -> "rolling outages|keep gas facilities powered"). */
function decisionKey(text: string): string {
  return text
    .replace(/^AI decides:\s*/i, "")
    .split(";")
    .map((c) => c.trim().replace(/\(.*?\)/g, "").replace(/[\d,.]+\s*(MW|k|GW)?/gi, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

/** Intervention markers for the timeline: habits, hard limits, alarms and AI decisions that change course. */
export function markersOf(steps: StageStep[]): Marker[] {
  const out: Marker[] = [];
  let lastKey = "";
  const seenH = new Set<string>();
  for (const s of steps) {
    let kind: Marker["kind"] | null = null;
    if (s.type === "ai_decision") {
      const k = decisionKey(s.text);
      if (k === lastKey || /no action needed/i.test(s.text)) continue;
      lastKey = k;
      kind = "ai";
    } else if (s.type === "rule_fired") kind = "habit";
    else if (s.type === "guardrail") kind = "limit";
    else if (s.type === "sensor_alert" || s.type === "false_all_clear") kind = "alarm";
    if (!kind) continue;
    const id = `${s.h}|${kind}`;
    if (seenH.has(id)) continue;
    seenH.add(id);
    out.push({ h: s.h, kind, text: plainStep(s).text });
  }
  return out;
}

/** Phase per hour (index = hour) for one side's frames. */
export function phasesOf(frames: GridFrame[], markers: Marker[]): Phase[] {
  const n = frames.length;
  if (!n) return [];
  const crit = frames.map(isCrit);
  const strain = frames.map(isStrain);
  const firstCrit = crit.indexOf(true);
  const lastCrit = crit.lastIndexOf(true);
  const firstStrain = strain.indexOf(true);
  // the storm "starts" at the first strain / outage (or deep cold); it is "approaching" for ~30 h before
  const deep = frames.findIndex((f) => f.tempC < -3 || f.snow > 0.1);
  const starts = [firstStrain, firstCrit, deep].filter((x) => x >= 0);
  const stormStart = starts.length ? Math.min(...starts) : -1;
  const acted = new Set<number>();
  for (const m of markers) if (m.kind !== "alarm" && m.kind !== "memory") for (let k = 0; k < 3; k++) acted.add(m.h + k);
  const out: Phase[] = new Array(n);
  for (let h = 0; h < n; h++) {
    const f = frames[h];
    if (f.collapsed) out[h] = "critical";
    else if (firstCrit >= 0 && h >= firstCrit && h <= lastCrit) {
      if (crit[h]) out[h] = acted.has(h) ? "acting" : "critical";
      else out[h] = strain[h] ? "struggling" : "recovery";
    } else if (firstCrit >= 0 && h > lastCrit) {
      out[h] = h - lastCrit <= 18 ? "recovery" : strain[h] ? "struggling" : "stable";
    } else if (stormStart >= 0 && h >= stormStart) {
      const lastStrain = strain.lastIndexOf(true);
      out[h] = strain[h] || (firstStrain >= 0 && h > firstStrain && h < lastStrain) ? "struggling" : firstStrain < 0 || h < firstStrain ? "approaching" : "stable";
    } else if (stormStart >= 0 && h >= stormStart - 30) out[h] = "approaching";
    else out[h] = "calm";
  }
  return out;
}

export interface Segment {
  phase: Phase;
  h0: number;
  h1: number;
}

export function segmentsOf(phases: Phase[]): Segment[] {
  const out: Segment[] = [];
  phases.forEach((p, h) => {
    const last = out[out.length - 1];
    if (last && last.phase === p) last.h1 = h + 1;
    else out.push({ phase: p, h0: h, h1: h + 1 });
  });
  return out;
}

// ------------------------------------------------------------------ plain words for the agent feed
export interface PlainStep {
  icon: string;
  kind: string;
  tone: "ai" | "habit" | "limit" | "alarm" | "memory" | "bad";
  text: string;
}

export function plainStep(s: StageStep): PlainStep {
  const t = s.text.trim();
  switch (s.type) {
    case "ai_decision":
      return { icon: "◆", kind: "AI decided", tone: "ai", text: shortAction(t.replace(/^AI decides:\s*/i, "")) };
    case "rule_fired":
      return { icon: "✎", kind: "Habit from its notebook", tone: "habit", text: t.replace(/^Manual habit:\s*/i, "") };
    case "guardrail":
      return { icon: "⛨", kind: "Hard limit", tone: "limit", text: t.replace(/^Hard limit:\s*/i, "") };
    case "memory_recall": {
      const m = /"([^"]+)"/.exec(t);
      return { icon: "❖", kind: "Lesson from MongoDB", tone: "memory", text: m ? `“${m[1]}”` : t.replace(/^Remembers:\s*/i, "") };
    }
    case "sensor_alert":
      return { icon: "!", kind: "Alarm", tone: "alarm", text: t.replace(/^Alarm:\s*/i, "") };
    case "false_all_clear":
      return { icon: "✕", kind: "Alarm", tone: "bad", text: "Said all clear while power was running out" };
    default:
      return { icon: "·", kind: s.type.replace(/_/g, " "), tone: "habit", text: t };
  }
}

/** "rolling outages 4,784 MW (about 1,076k homes take turns); keep gas…" -> shorter clauses. */
export function shortAction(a: string): string {
  return a
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) =>
      c
        .replace(/rolling outages ([\d,]+) MW \(about ([\d,]+)k homes take turns\)/i, (_, mw: string, k: string) => `rolling outages ${gw(num(mw))} (${homesK(num(k))} homes take turns)`)
        .replace(/bring ([\d,]+) MW of homes back/i, (_, mw: string) => `bring ${gw(num(mw))} of homes back`)
        .replace(/let the control room cut load fast if needed/i, "control room may cut load fast"),
    )
    .join("; ");
}

/** Clauses of an action, the important ones first. */
export function actionClauses(a: string | null | undefined): { text: string; key: boolean }[] {
  if (!a || /no action needed/i.test(a)) return [];
  const cl = shortAction(a)
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean);
  const rank = (c: string) => (/rolling outages|bring .* back/i.test(c) ? 0 : /keep gas facilities/i.test(c) ? 1 : 2);
  return cl.sort((x, y) => rank(x) - rank(y)).map((c) => ({ text: c, key: rank(c) < 2 }));
}

const num = (s: string) => Number(s.replace(/,/g, ""));
export const gw = (mw: number) => (mw >= 1000 ? `${(mw / 1000).toFixed(mw >= 10000 ? 0 : 1)} GW` : `${Math.round(mw)} MW`);
const homesK = (k: number) => (k >= 1000 ? `${(k / 1000).toFixed(1)} M` : `${Math.round(k)}k`);

export function fmtHomesShort(n: number): string {
  n = Math.min(n, TOTAL_HOMES); // the sim's home count can overshoot the city at total blackout
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${Math.round(n)}`;
}

// ------------------------------------------------------------------ observations (what the agent is looking at)
export interface Observation {
  text: string;
  tone: "ok" | "warn" | "bad" | "cold";
}

export function observations(frames: GridFrame[], h: number): Observation[] {
  const f = frames[Math.min(frames.length - 1, Math.max(0, Math.floor(h)))];
  if (!f) return [];
  const out: Observation[] = [];
  const back = frames[Math.max(0, Math.floor(h) - 6)];
  if (back && back.supplyMw > 0) {
    const d = (f.supplyMw - back.supplyMw) / back.supplyMw;
    if (Math.abs(d) >= 0.03) out.push({ text: `Power available ${d < 0 ? "↓" : "↑"} ${Math.round(Math.abs(d) * 100)}% in 6 h`, tone: d < 0 ? "warn" : "ok" });
  }
  const spare = f.demandMw > 0 ? (f.supplyMw - f.demandMw) / f.demandMw : 0;
  out.push({ text: spare >= 0 ? `Spare power ${Math.round(spare * 100)}%` : `Short ${gw(f.demandMw - f.supplyMw)}`, tone: spare < 0 ? "bad" : spare < 0.08 ? "warn" : "ok" });
  // forecast low over the next 48 h (the simulator's weather is the forecast the notebook reads)
  let lo = f.tempC;
  for (let k = Math.floor(h); k < Math.min(frames.length, Math.floor(h) + 48); k++) lo = Math.min(lo, frames[k].tempC);
  if (lo < f.tempC - 2 && lo < 2) out.push({ text: `Cold ahead: ${Math.round(lo)} °C within 48 h`, tone: "cold" });
  else out.push({ text: `Temperature ${Math.round(f.tempC)} °C`, tone: f.tempC < -5 ? "cold" : "ok" });
  if (f.gasSupply < 0.97) out.push({ text: `Gas reaching plants ${Math.round(f.gasSupply * 100)}%`, tone: f.gasSupply < 0.8 ? "bad" : "warn" });
  const lostMw = Object.values(f.outagesMw ?? {}).reduce((a, b) => a + (b || 0), 0);
  if (lostMw > 3000) out.push({ text: `${gw(lostMw)} of plants frozen or broken`, tone: lostMw > 12000 ? "bad" : "warn" });
  if ((f.windOk ?? 1) < 0.8) out.push({ text: `${Math.round((1 - (f.windOk ?? 1)) * 100)}% of wind turbines iced`, tone: "cold" });
  return out.slice(0, 4);
}

// ------------------------------------------------------------------ KPIs
export function homesPoweredPct(f: GridFrame): number {
  if (f.collapsed) return 0;
  const byHomes = 1 - Math.min(1, f.homesDark / TOTAL_HOMES);
  return Math.max(0, Math.min(1, Math.min(byHomes, 1 - f.shedFrac))) * 100;
}

export const sparePct = (f: GridFrame) => (f.demandMw > 0 ? ((f.supplyMw - f.demandMw) / f.demandMw) * 100 : 0);

// ------------------------------------------------------------------ verified checks
export interface Check {
  ok: boolean;
  text: string;
  sub?: string;
}

export interface Verdict {
  verified: boolean;
  checks: Check[];
  compare: string | null;
}

/** Hours with homes dark although there was more than 1.5 GW of power to spare. */
export function needlessDarkHours(frames: GridFrame[]): number {
  return frames.filter((f) => !f.collapsed && f.shedFrac > 0.03 && f.supplyMw - f.demandMw > 1500).length;
}

export function verdictOf(opts: {
  right: GridFrame[];
  left: GridFrame[];
  rightRes: LiveResult | null;
  leftRes: LiveResult | null;
  leftPeakHomes: number | null;
  simHash: string;
  model: string;
}): Verdict {
  const { right, left, rightRes, leftRes } = opts;
  const collapsed = rightRes?.collapsed ?? right.some((f) => f.collapsed);
  const peak = rightRes?.peak_shed_frac ?? Math.max(0, ...right.map((f) => f.shedFrac));
  const outage = right.filter((f) => f.shedFrac > 0.002 && !f.collapsed);
  const kept = outage.filter((f) => f.protectGas || (f.zones.zone_gas ?? 0) >= 0.5);
  const nR = needlessDarkHours(right);
  const nL = needlessDarkHours(left);
  const homesBack = !collapsed && (nR <= 12 || nR <= 0.1 * nL);
  const checks: Check[] = [
    { ok: !collapsed, text: collapsed ? "The grid collapsed (frequency stayed below 59.4 Hz for 9 minutes)" : "Grid never collapsed", sub: "frequency never stayed below 59.4 Hz for 9 minutes" },
    { ok: peak <= 0.2, text: `Worst hour: ${Math.round(Math.min(1, peak) * 100)}% of homes dark`, sub: "the limit is 20%" },
    outage.length
      ? { ok: kept.length === outage.length, text: "Gas facilities kept powered during outages", sub: `${kept.length} of ${outage.length} outage hours` }
      : { ok: true, text: "Gas facilities never at risk", sub: "no rolling outages were needed" },
    {
      ok: homesBack,
      text: homesBack ? "Homes brought back once power returned" : "Homes left dark while power was available",
      sub: `dark with power to spare: ${nR} h${left.length ? ` · Day-1 notebook: ${nL} h` : ""}`,
    },
    { ok: true, text: "Checked by the locked simulator", sub: `fingerprint ${opts.simHash}` },
    { ok: true, text: `Same frozen AI · ${opts.model} · never retrained`, sub: "only its notebook changed" },
  ];
  const verified = checks.every((c) => c.ok) && (rightRes?.passed ?? true);
  let compare: string | null = null;
  if (leftRes || left.length) {
    const failed = leftRes ? !leftRes.passed : left.some((f) => f.collapsed) || Math.max(0, ...left.map((f) => f.shedFrac)) > 0.2;
    const peakHomes = opts.leftPeakHomes ?? Math.max(0, ...left.map((f) => f.homesDark));
    const lc = leftRes?.collapsed ?? left.some((f) => f.collapsed);
    compare = `Day-1 notebook on the same storm: ${failed ? "FAILED" : "passed"} · ${lc ? "total blackout" : `${fmtHomesShort(peakHomes)} homes dark at the worst hour`}`;
  }
  return { verified, checks, compare };
}

// ------------------------------------------------------------------ where the storm hits first (camera intro)
export function areaHint(desc: string): AreaKey {
  const d = desc.toLowerCase();
  if (/gas|well|permian|basin|compressor/.test(d)) return "field";
  if (/wind|ice storm|icing|drizzle/.test(d)) return "wind";
  if (/maintenance|plants/.test(d)) return "plants";
  if (/houston|dallas|cities|demand|surge|austin|san antonio/.test(d)) return "town";
  return "plants";
}

if (import.meta.env.DEV) Object.assign(window, { __derive: { phasesOf, markersOf, segmentsOf, verdictOf, isCrit } });
