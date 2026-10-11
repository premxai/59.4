import { useEffect, useState } from "react";
import type { Replay } from "../lib/replay";
import { fmtHomes } from "../lib/replay";

/**
 * public/reference.json. `mode` picks the column metric (taller = better for the lit_* modes):
 *   lit_worst  share of homes and businesses WITH power at the worst moment   (default)
 *   lit_avg    average share with power over the replay
 *   dark_peak  homes and businesses without power at the worst moment (old metric, taller = worse)
 *   dark_hours homes-without-power x hours (taller = worse)
 * `values[mode]` is the middle ("what really happened") column. Shares are 0..1.
 */
export type FinaleMode = "lit_worst" | "lit_avg" | "dark_peak" | "dark_hours";
export interface Reference {
  mode?: FinaleMode;
  label?: string;
  sub?: string;
  total_homes?: number;
  values?: Partial<Record<FinaleMode, number | null>>;
  units?: Partial<Record<FinaleMode, string>>;
  placeholder?: boolean;
  /** legacy (first version): metric = meta.totals key, value = count */
  metric?: string;
  value?: number;
  unit?: string;
}

export interface WhatChanged {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string; ok?: boolean }[];
  placeholder?: boolean;
}

export function useJson<T>(path: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}${path}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setV(j))
      .catch(() => alive && setV(null));
    return () => {
      alive = false;
    };
  }, [path]);
  return v;
}

/** Totals from meta.totals, or derived from frames if the exporter left them out. */
export function metricOf(r: Replay, metric: string): number {
  const t = r.meta.totals?.[metric];
  if (typeof t === "number") return t;
  if (metric === "peak_homes_dark") return Math.max(...r.frames.map((f) => f.homes_dark ?? 0));
  if (metric === "homes_dark_hours") return r.frames.reduce((a, f) => a + (f.homes_dark ?? 0), 0);
  return 0;
}

/**
 * Homes and businesses on the grid. Priority: explicit meta field, then a collapsed run's peak
 * (the simulator sets homes_dark = total customers on collapse), then reference.total_homes,
 * then 11,000,000 (sim/params.py total_customers).
 */
export function totalHomes(rs: Replay[], ref: Reference | null): number {
  for (const r of rs) {
    const m = r.meta as unknown as { total_customers?: number; totals?: Record<string, number> };
    const v = m.totals?.total_customers ?? m.total_customers;
    if (typeof v === "number" && v > 0) return v;
  }
  for (const r of rs) if (r.meta.collapsed) return Math.max(...r.frames.map((f) => f.homes_dark ?? 0));
  return ref?.total_homes ?? 11_000_000;
}

const DEFAULT_UNITS: Record<FinaleMode, string> = {
  lit_worst: "share of homes and businesses that kept power at the worst moment",
  lit_avg: "average share of homes and businesses with power during the storm",
  dark_peak: "homes and businesses without power at the worst moment",
  dark_hours: "homes without power × hours",
};

interface Col {
  label: string;
  sub: string;
  value: number; // share (lit modes) or count (dark modes)
  ref: boolean;
}

function resolveMode(ref: Reference | null): FinaleMode {
  if (ref?.mode) return ref.mode;
  if (ref?.metric === "homes_dark_hours") return "dark_hours";
  if (ref?.metric) return "dark_peak";
  return "lit_worst";
}

function runValue(r: Replay, mode: FinaleMode, total: number): number {
  switch (mode) {
    case "lit_worst":
      return Math.max(0, Math.min(1, 1 - metricOf(r, "peak_homes_dark") / total));
    case "lit_avg":
      return Math.max(0, Math.min(1, 1 - metricOf(r, "homes_dark_hours") / (total * r.frames.length)));
    case "dark_peak":
      return metricOf(r, "peak_homes_dark");
    case "dark_hours":
      return metricOf(r, "homes_dark_hours");
  }
}

export function WhatChangedCard({ data }: { data: WhatChanged | null }) {
  if (!data) return null;
  return (
    <div className="what-changed">
      <div className="wc-title">{data.title}</div>
      {data.subtitle && <div className="wc-sub">{data.subtitle}</div>}
      {data.rows.map((r, i) => (
        <div className="wc-row" key={i}>
          <span className="wc-label">{r.label}</span>
          <span className={`wc-value ${r.ok ? "wc-ok" : ""}`}>{r.value}</span>
        </div>
      ))}
      {data.placeholder && <div className="wc-placeholder">placeholder text</div>}
    </div>
  );
}

/** Three columns of light: left / reference / right. lit_* modes: taller = more homes kept power. */
export function Finale({ left, right, reference, changed }: { left: Replay; right: Replay; reference: Reference | null; changed: WhatChanged | null }) {
  const mode = resolveMode(reference);
  const lit = mode === "lit_worst" || mode === "lit_avg";
  const total = totalHomes([left, right], reference);
  const refValue = reference?.values?.[mode] ?? (mode === "dark_peak" ? reference?.value : undefined) ?? (lit ? 1 - 4_500_000 / total : 4_500_000);
  const unit = reference?.units?.[mode] ?? (mode === "dark_peak" ? reference?.unit : undefined) ?? DEFAULT_UNITS[mode];
  const cols: Col[] = [
    { label: left.meta.label, value: runValue(left, mode, total), sub: "in simulation", ref: false },
    { label: reference?.label ?? "what really happened (placeholder)", value: refValue, sub: reference?.sub ?? "real event", ref: true },
    { label: right.meta.label, value: runValue(right, mode, total), sub: "in simulation", ref: false },
  ];
  const max = lit ? 1 : Math.max(1, ...cols.map((c) => c.value));
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="finale">
      <div className="finale-cols">
        {cols.map((c, i) => (
          <div className="fcol" key={i}>
            <div className="fcol-value" style={{ opacity: shown ? 1 : 0, transitionDelay: `${0.9 + i * 0.45}s` }}>
              {lit ? `${Math.round(c.value * 100)}%` : fmtHomes(c.value)}
              {lit && <div className="fcol-count">{fmtHomes(c.value * total)} homes</div>}
            </div>
            <div className="fcol-track">
              <div
                className={`fcol-light ${c.ref ? "fcol-ref" : ""}`}
                style={{ height: shown ? `${Math.max(1.5, (c.value / max) * 100)}%` : "0%", transitionDelay: `${i * 0.45}s` }}
              />
            </div>
            <div className="fcol-labels">
              <div className="fcol-label">{c.label}</div>
              <div className="fcol-sub">{c.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="finale-unit">{unit}</div>
      <WhatChangedCard data={changed} />
    </div>
  );
}
