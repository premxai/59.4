// Level 2: the coach improving at improving. Predicted vs measured scatter (diagonal = perfect,
// color = playbook version), prediction error per night, and the coach's A/B tests of its own rewrites.
import { stepsOf, trackGens } from "./derive";
import { fmtPct, nightNumber } from "./plain";
import { useTrack } from "./store";
import { Empty } from "./ui";

const VERSION_COLORS = ["#8fd0ff", "#ffb35c", "#7dffb2", "#c9a6ff", "#ff7a6b", "#ffd86b"];

function Scatter() {
  const t = useTrack();
  if (!t) return null;
  const pts = t.calibration;
  if (!pts.length) return <Empty>No predictions measured yet.</Empty>;
  const lo = Math.min(-100, ...pts.flatMap((p) => [p.predicted_pct, p.actual_pct]));
  const hi = Math.max(20, ...pts.flatMap((p) => [p.predicted_pct, p.actual_pct]));
  const W = 220;
  const P = 26;
  const sx = (v: number) => P + ((v - lo) / (hi - lo)) * (W - P - 6);
  const sy = (v: number) => W - P - ((v - lo) / (hi - lo)) * (W - P - 6);
  const versions = [...new Set(pts.map((p) => p.strategy_version ?? 0))].sort((a, b) => a - b);
  return (
    <div className="mc-scatter">
      <svg viewBox={`0 0 ${W} ${W}`}>
        <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} className="mc-diag" />
        <line x1={sx(0)} x2={sx(0)} y1={sy(lo)} y2={sy(hi)} className="mc-axis0" />
        <line y1={sy(0)} y2={sy(0)} x1={sx(lo)} x2={sx(hi)} className="mc-axis0" />
        <text x={sx(hi) - 2} y={sy(hi) + 12} className="mc-svg-note" textAnchor="end">
          perfect guess
        </text>
        {pts.map((p, i) => {
          const c = VERSION_COLORS[(p.strategy_version ?? 0) % VERSION_COLORS.length];
          const kept = p.status === "accepted" || p.status === "stacked";
          return (
            <circle key={i} cx={sx(p.predicted_pct)} cy={sy(Math.min(hi, p.actual_pct))} r="5" fill={kept ? c : "transparent"} stroke={c} strokeWidth="2">
              <title>{`Night ${nightNumber(t, p.generation)} · ${p.organ ?? ""}: predicted ${fmtPct(p.predicted_pct)}, measured ${fmtPct(p.actual_pct)} (${p.status ?? ""})`}</title>
            </circle>
          );
        })}
        <text x={W / 2 + 10} y={W - 4} className="mc-svg-axis" textAnchor="middle">
          predicted change in homes dark
        </text>
        <text x={10} y={W / 2 - 10} className="mc-svg-axis" textAnchor="middle" transform={`rotate(-90 10 ${W / 2 - 10})`}>
          measured
        </text>
      </svg>
      <div className="mc-scatter-legend">
        {versions.map((v) => (
          <span key={v}>
            <i style={{ background: VERSION_COLORS[v % VERSION_COLORS.length] }} /> playbook v{v + 1}
          </span>
        ))}
        <span>● kept ○ rejected</span>
      </div>
    </div>
  );
}

function MaeLine() {
  const t = useTrack();
  if (!t) return null;
  const ms = t.coach_metrics.filter((m) => m.mae_pct != null);
  if (!ms.length) return null;
  const W = 260;
  const H = 90;
  const max = Math.max(10, ...ms.map((m) => m.mae_pct ?? 0));
  const x = (i: number) => (ms.length === 1 ? W / 2 : 16 + (i / (ms.length - 1)) * (W - 32));
  const y = (v: number) => H - 18 - (v / max) * (H - 34);
  return (
    <div className="mc-mae">
      <div className="mc-mini-title">Prediction error per night (lower = better guesses)</div>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <path d={ms.map((m, i) => `${i ? "L" : "M"}${x(i)} ${y(m.mae_pct ?? 0)}`).join("")} className="mc-mae-path" />
        {ms.map((m, i) => {
          const ab = t.l2.find((l) => l.generation === m.generation);
          return (
            <g key={m.generation}>
              <circle cx={x(i)} cy={y(m.mae_pct ?? 0)} r="4" className="mc-mae-dot" />
              <text x={x(i)} y={y(m.mae_pct ?? 0) - 8} textAnchor="middle" className="mc-svg-val">
                ±{(m.mae_pct ?? 0).toFixed(0)}%
              </text>
              <text x={x(i)} y={H - 4} textAnchor="middle" className="mc-svg-axis">
                N{nightNumber(t, m.generation)}
                {ab ? (ab.adopted ? " ⚖️✓" : " ↩") : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AbCards() {
  const t = useTrack();
  if (!t) return null;
  const cards = t.l2.map((l) => ({
    key: `l2-${l.generation}`,
    night: nightNumber(t, l.generation),
    adopted: !!(l.adopted ?? l.ab?.adopt),
    insight: l.insight,
    ab: l.ab,
  }));
  const pending = trackGens(t)
    .map((g) => ({ g, s: stepsOf(t, g).find((x) => x.type === "deep_sleep") }))
    .filter((x) => x.s && !t.l2.some((l) => l.generation === x.g));
  if (!cards.length && !pending.length) return <div className="mc-dim mc-ab-none">The coach reviews its own track record every 2 nights; no review yet.</div>;
  return (
    <div className="mc-ab">
      {cards.map((c) => (
        <div key={c.key} className={`mc-ab-card ${c.adopted ? "mc-ab-yes" : "mc-ab-no"}`}>
          <div className="mc-ab-k">
            After Night {c.night} · {c.adopted ? "⚖️ the coach's rewrite passed its own test" : "↩ the coach rejected its own rewrite"}
          </div>
          {c.ab && (c.ab.old_mae != null || c.ab.new_mae != null) && (
            <div className="mc-ab-v">
              prediction error ±{c.ab.old_mae?.toFixed(0) ?? "?"}% → ±{c.ab.new_mae?.toFixed(0) ?? "?"}%
              {c.ab.night_replayed != null && <span className="mc-dim"> (replaying night {c.ab.night_replayed})</span>}
            </div>
          )}
          {c.insight && <div className="mc-ab-q">“{c.insight}”</div>}
        </div>
      ))}
      {pending.map(({ g, s }) => {
        const q = /[“"]([^"”]{8,})[”"]/.exec(s!.text)?.[1];
        return (
          <div key={`p-${g}`} className="mc-ab-card mc-ab-pending">
            <div className="mc-ab-k">After Night {nightNumber(t, g)} · 🌌 self-review (A/B test result not in the data yet)</div>
            {q && <div className="mc-ab-q">“{q}”</div>}
          </div>
        );
      })}
    </div>
  );
}

export function CoachL2() {
  return (
    <div className="mc-l2">
      <div className="mc-l2-honest">trend, few data points</div>
      <div className="mc-l2-charts">
        <Scatter />
        <MaeLine />
      </div>
      <AbCards />
    </div>
  );
}
