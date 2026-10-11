// Small shared pieces for Mission Control.
import { Component, type ReactNode } from "react";
import type { Cell } from "./derive";
import { fmtBig, parseTicks, stormLabel, type Tick } from "./plain";

export const MODEL_SHORT = "Qwen3-30B";

export function SameModelBadge({ big = false }: { big?: boolean }) {
  return (
    <div className={`mc-model ${big ? "mc-model-big" : ""}`} title="The operator AI's weights are frozen: every improvement comes from the notebook it reads.">
      <span className="mc-model-lock">🔒</span>
      <span>
        Same AI · <b>{MODEL_SHORT}</b> · never retrained
      </span>
    </div>
  );
}

export function Panel({ title, right, className = "", children }: { title?: ReactNode; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`mc-panel ${className}`}>
      {(title || right) && (
        <header className="mc-panel-head">
          <div className="mc-panel-title">{title}</div>
          {right && <div className="mc-panel-right">{right}</div>}
        </header>
      )}
      <div className="mc-panel-body">{children}</div>
    </section>
  );
}

const GLYPH: Record<Tick | Cell["state"], string> = { pass: "✓", fail: "✗", unknown: "·", inconclusive: "?", missing: "·" };

/** A tick string ("✗✗✓") as colored glyphs; `stagger` reveals them one by one. */
export function Ticks({ s, stagger = false, size = "m" }: { s?: string | null; stagger?: boolean; size?: "s" | "m" | "l" }) {
  const ts = parseTicks(s);
  if (!ts.length) return null;
  return (
    <span className={`mc-ticks mc-ticks-${size}`}>
      {ts.map((t, i) => (
        <span key={i} className={`mc-tick mc-tick-${t} ${stagger ? "mc-tick-stagger" : ""}`} style={stagger ? { animationDelay: `${i * 0.12}s` } : undefined}>
          {GLYPH[t]}
        </span>
      ))}
    </span>
  );
}

/** One ✓/✗ per unseen storm (majority of 3 versions when available). */
export function StormCells({ cells, size = "m" }: { cells: Cell[]; size?: "s" | "m" | "l" }) {
  return (
    <span className={`mc-ticks mc-ticks-${size}`}>
      {cells.map((c) => (
        <span
          key={c.scenario_id}
          className={`mc-tick mc-tick-${c.state}`}
          title={`${stormLabel(c.scenario_id)}: ${c.state === "pass" ? "survived" : c.state === "fail" ? "failed" : c.state}${c.seeds > 1 ? ` (${c.passedSeeds} of ${c.seeds} versions passed)` : ""}`}
        >
          {GLYPH[c.state]}
        </span>
      ))}
    </span>
  );
}

/** Horizontal "homes in the dark" bar: median length + min–max whisker. */
export function DarkBar({ value, min, max, scale, tone = "dark" }: { value: number | null; min?: number | null; max?: number | null; scale: number; tone?: "dark" | "base" }) {
  if (value == null || !(scale > 0)) return <div className="mc-darkbar mc-darkbar-empty">no result yet</div>;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  return (
    <div className={`mc-darkbar mc-darkbar-${tone}`}>
      <div className="mc-darkbar-fill" style={{ width: pct(value) }} />
      {min != null && max != null && <div className="mc-darkbar-range" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />}
      <div className="mc-darkbar-label">{fmtBig(value)}</div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error(`[mission] ${this.props.label ?? "panel"} crashed`, e);
  }
  render() {
    if (this.state.error)
      return (
        <div className="mc-crash">
          {this.props.label ?? "This panel"} could not render: {this.state.error}
          <button className="mc-btn" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="mc-empty">{children}</div>;
}
