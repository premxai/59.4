// Live lab helpers: notebook options, number formatting and the calm decision feed.
// The feed is a pure function of the streamed hour messages up to the playback hour, so scrubbing works.
import type { Catalog, CatalogNotebook, CatalogStorm } from "../live";

export type Raw = Record<string, unknown> | undefined;

const num = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);

// ------------------------------------------------------------------ formatting
export function fmtHH(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 1 : 2)} B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)} M`;
  if (a >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")} K`;
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(frac: number | null | undefined): string {
  if (frac == null || !Number.isFinite(frac)) return "–";
  if (frac >= 0.995) return "100%";
  if (frac > 0 && frac < 0.005) return "<1%";
  return `${Math.round(frac * 100)}%`;
}

export function fmtHz(hz: number | null | undefined, collapsed = false): string {
  if (collapsed || hz == null || !Number.isFinite(hz) || hz <= 1) return "collapsed";
  return `${hz.toFixed(2)} Hz`;
}

export const gw = (mw: number) => `${(mw / 1000).toFixed(1)} GW`;

export function cleanVerdict(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/(\d+(?:\.\d+)?)% of homes dark/g, (m, p) => (Number(p) >= 100 ? "all homes dark" : m))
    .replace(/\(hour (\d+)\)/g, "(h$1)")
    .replace(/\bhour (\d+)\b/g, "h$1");
}

export const shortHash = (h?: string) => (h ? h.replace(/^sha256:/, "").slice(0, 7) : "");

// ------------------------------------------------------------------ storms
export function unseenStorms(c: Catalog | null): CatalogStorm[] {
  if (!c) return [];
  const exam = (s: CatalogStorm) => /2021|uri|exam/i.test(`${s.id} ${s.label}`);
  const ok = c.storms.filter((s) => (s.kind === "unseen" || s.split === "heldout") && !exam(s));
  const order = (c.hidden_pool ?? []).map((p) => p.storm_id).filter((x): x is string => !!x);
  return ok.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

// ------------------------------------------------------------------ notebooks
export interface Score {
  id: string;
  majority_passed: number;
  hh_median: number;
}

export interface NotebookOpt {
  id: string;
  v: number;
  night: number;
  when: string; // "Day 1" | "after Night 0 (Claude's draft)" | "after Night 3"
  score?: Score;
  final: boolean;
  best: boolean;
  hash?: string;
  option: string; // dropdown text
  short: string; // "v7 (final)"
  title: string; // column header
}

const isBestGuess = (n: CatalogNotebook) => /best guess|^zero_shot/i.test(`${n.label} ${n.id}`) && !/after night/i.test(n.label);

export function notebookOpts(c: Catalog | null, track: string, scores: Record<string, Score[]>): NotebookOpt[] {
  if (!c) return [];
  const mine = c.notebooks.filter((n) => n.track === track && !isBestGuess(n)).sort((a, b) => a.night - b.night);
  const sc = scores[track] ?? [];
  const finalId = c.frozen?.[track]?.id ?? mine[mine.length - 1]?.id;
  const bestPass = Math.max(-1, ...sc.map((s) => s.majority_passed));
  const bestIds = sc.filter((s) => s.majority_passed === bestPass && bestPass > 0).map((s) => s.id);
  return mine.map((n, i) => {
    const v = i + 1;
    const when = n.night <= 0 ? "Day 1" : n.night === 1 ? "after Night 0 (Claude's draft)" : `after Night ${n.night - 1}`;
    const score = sc.find((s) => s.id === n.id);
    const final = n.id === finalId;
    const best = bestIds.length === 1 && bestIds[0] === n.id && !final;
    const tag = final ? " · final" : best ? " · best" : "";
    const scoreTxt = score ? ` · ${score.majority_passed}/8 unseen` : "";
    const whenShort = n.night <= 0 ? "Day 1" : n.night === 1 ? "after Night 0" : `after Night ${n.night - 1}`;
    return {
      id: n.id,
      v,
      night: n.night,
      when,
      score,
      final,
      best,
      hash: n.hash,
      option: `v${v} · ${whenShort}${scoreTxt}${tag}`,
      short: `v${v} (${final ? "final" : n.night <= 0 ? "Day 1" : whenShort})`,
      title: `v${v} · ${when}${final ? " · final frozen" : best ? " · best" : ""}`,
    };
  });
}

// ------------------------------------------------------------------ per-side series up to the playback hour
export interface Kpis {
  worst: number;
  worstH: number;
  homeHours: number;
  lowHz: number;
  collapsed: boolean;
  nowFrac: number;
}

export function kpisUpTo(raw: Raw[], ph: number): Kpis {
  let worst = 0;
  let worstH = 0;
  let homeHours = 0;
  let lowHz = 60;
  let collapsed = false;
  let nowFrac = 0;
  for (let h = 0; h <= ph && h < raw.length; h++) {
    const m = raw[h];
    if (!m) continue;
    const f = num(m.shed_frac);
    if (f > worst) {
      worst = f;
      worstH = h;
    }
    homeHours += num(m.homes_dark);
    const hz = num(m.freq_min_hz, 60);
    if (hz < lowHz) lowHz = hz;
    if (Array.isArray(m.events) && (m.events as { type?: string }[]).some((e) => e?.type === "collapse")) collapsed = true;
    nowFrac = f;
  }
  return { worst: Math.min(1, worst), worstH, homeHours, lowHz, collapsed, nowFrac };
}

// ------------------------------------------------------------------ the calm decision feed
export type FeedKind = "ai" | "cut" | "restore" | "clear" | "gas" | "alarm" | "limit" | "collapse";

export interface FeedItem {
  key: string;
  kind: FeedKind;
  h: number; // storm hour stamp
  text: string;
  sub?: string;
  showAt: number; // playback hour at which the line appears (paced: at most one new line per ~4 storm hours)
}

interface CutItem {
  item: FeedItem;
  from: number;
  to: number;
  peak: number;
  start: boolean; // this burst opened the outage
  lastChange: number;
  holdUntil: number;
  frac: number;
}

const MIN_GAP_H = 4; // ≈ 1 s per new line at the default 4 storm-hours/s
const MAX_DELAY_H = 10;
const CUT_STEP_MW = 500;
const MERGE_H = 4; // changes closer than this merge into one line
const CLEAR_H = 3; // "all homes back on" only after this many hours with no cuts
const GAS_MERGE_H = 12; // gas protection switched back on within this window merges into one line

function cutText(c: CutItem) {
  const held = c.holdUntil - c.lastChange;
  const heldTxt = held >= 3 ? ` · held ${held} h` : "";
  const span = c.lastChange - c.item.h;
  const peakTxt = c.peak > Math.max(c.from, c.to) + CUT_STEP_MW ? `, peak ${gw(c.peak)}` : "";
  if (c.start) {
    if (span === 0) c.item.text = `Rolling outages start · ${gw(c.to)}${heldTxt}`;
    else if (peakTxt) c.item.text = `Rolling outages start · peak ${gw(c.peak)}, eased to ${gw(c.to)}${heldTxt}`;
    else c.item.text = `Rolling outages start · ramped to ${gw(c.to)} over ${span + 1} h${heldTxt}`;
    c.item.kind = "cut";
  } else if (c.to >= c.from) {
    c.item.text = `Cut raised ${(c.from / 1000).toFixed(1)} → ${gw(c.to)}${peakTxt ? ` (${peakTxt.slice(2)})` : ""}${heldTxt}`;
    c.item.kind = "cut";
  } else {
    c.item.text = `Restoring power · cut ${(c.from / 1000).toFixed(1)} → ${gw(c.to)}${peakTxt ? ` (${peakTxt.slice(2)})` : ""}${heldTxt}`;
    c.item.kind = "restore";
  }
  c.item.sub = `about ${fmtPct(c.frac)} of homes taking turns in the dark`;
}

const trimAction = (s: string) => {
  const t = s.replace(/^AI decides:\s*/i, "").trim();
  return t.length > 120 ? `${t.slice(0, 117).replace(/[;,\s]+\S*$/, "")}…` : t;
};

export function buildFeed(raw: Raw[], ph: number): FeedItem[] {
  const items: FeedItem[] = [];
  let lastShow = -Infinity;
  const add = (it: Omit<FeedItem, "showAt" | "key">, createdAt: number): FeedItem => {
    let showAt = Math.max(createdAt, lastShow + MIN_GAP_H);
    if (showAt - createdAt > MAX_DELAY_H) showAt = createdAt;
    lastShow = Math.max(lastShow, showAt);
    const full: FeedItem = { ...it, key: `${it.kind}-${it.h}-${items.length}`, showAt };
    items.push(full);
    return full;
  };

  let firstAi = false;
  let level = 0; // last reported cut (MW)
  let cut: CutItem | null = null;
  let inOutage = false;
  let outageStart = 0;
  let zeroSince: number | null = null;
  let gasOn = false;
  let gasSince = -1;
  let gasOffAt: number | null = null;
  let gasItem: FeedItem | null = null;
  let gasFlips = 0;
  const alarms = new Map<string, { item: FeedItem; count: number; last: number }>();
  const limits = new Set<string>();

  for (let h = 0; h <= ph && h < raw.length; h++) {
    const m = raw[h];
    if (!m) continue;
    const events = Array.isArray(m.events) ? (m.events as { type?: string; text?: string }[]) : [];

    for (const e of events) {
      const text = String(e?.text ?? "");
      if (e?.type === "ai_decision" && !firstAi) {
        firstAi = true;
        add({ kind: "ai", h, text: "First AI decision", sub: trimAction(text) }, h);
      } else if (e?.type === "sensor_alert") {
        const t = text.replace(/^Alarm:\s*/i, "");
        const prev = alarms.get(t);
        if (prev && h - prev.last <= 24) {
          prev.count += 1;
          prev.last = h;
          prev.item.text = `Alarm · ${t}`;
          prev.item.sub = `rang ${prev.count} times, last at h${h}`;
        } else {
          const item = add({ kind: "alarm", h, text: `Alarm · ${t}` }, h);
          alarms.set(t, { item, count: 1, last: h });
        }
      } else if (e?.type === "guardrail") {
        const t = text.replace(/^Hard limit:\s*/i, "");
        if (!limits.has(t)) {
          limits.add(t);
          add({ kind: "limit", h, text: "Hard limit applied", sub: t }, h);
        }
      } else if (e?.type === "collapse") {
        add({ kind: "collapse", h, text: "Grid collapsed", sub: text || "frequency fell below the safe limit" }, h);
      }
    }

    // cut size, restores: one line per burst of changes, one "all clear" per outage
    const shed = Math.max(0, num(m.shed_mw));
    const frac = Math.max(0, Math.min(1, num(m.shed_frac)));
    if (shed < 50) {
      if (inOutage) {
        if (zeroSince == null) zeroSince = h;
        if (h - zeroSince >= CLEAR_H) {
          add({ kind: "clear", h: zeroSince, text: "All homes back on", sub: `after ${Math.max(1, zeroSince - outageStart)} h of rolling outages` }, h);
          inOutage = false;
          cut = null;
          level = 0;
          zeroSince = null;
        }
      }
    } else if (!inOutage) {
      inOutage = true;
      outageStart = h;
      zeroSince = null;
      const item = add({ kind: "cut", h, text: "" }, h);
      cut = { item, from: 0, to: shed, peak: shed, start: true, lastChange: h, holdUntil: h, frac };
      cutText(cut);
      level = shed;
    } else {
      zeroSince = null;
      if (Math.abs(shed - level) >= CUT_STEP_MW) {
        if (cut && h - cut.lastChange <= MERGE_H) {
          cut.to = shed;
          cut.peak = Math.max(cut.peak, shed);
          cut.lastChange = h;
          cut.holdUntil = h;
          cut.frac = frac;
        } else {
          const item = add({ kind: shed > level ? "cut" : "restore", h, text: "" }, h);
          cut = { item, from: level, to: shed, peak: Math.max(level, shed), start: false, lastChange: h, holdUntil: h, frac };
        }
        level = shed;
      } else if (cut) {
        cut.holdUntil = h;
      }
      if (cut) cutText(cut);
    }

    // protect gas facilities (debounced: short flickers merge into one line)
    const pg = m.protect_gas === true;
    if (pg && !gasOn) {
      if (gasItem && gasOffAt != null && h - gasOffAt <= GAS_MERGE_H) {
        gasFlips += 1;
        gasItem.sub = `paused and switched back on ${gasFlips === 1 ? "once" : `${gasFlips}×`}, last at h${h}`;
      } else {
        gasFlips = 0;
        gasItem = add({ kind: "gas", h, text: "Protects gas facilities from the cuts", sub: "keeps fuel flowing to power plants" }, h);
        gasSince = h;
      }
      gasOffAt = null;
    } else if (!pg && gasOn) {
      gasOffAt = h;
    }
    gasOn = pg;
    if (!gasOn && gasOffAt != null && gasItem && h - gasOffAt === GAS_MERGE_H) {
      add({ kind: "gas", h: gasOffAt, text: "Stops protecting gas facilities", sub: `after ${gasOffAt - gasSince} h` }, h);
      gasItem = null;
    }
  }
  return items.filter((i) => i.showAt <= ph).reverse();
}
