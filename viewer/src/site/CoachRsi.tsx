import { useState } from "react";
import { linePath, linear, niceTicks, Tip, useWidth } from "./charts";
import { fmtSignedPct, nightLabel, organShort, useTrackX } from "./data";
import { Section, SectionHead } from "./ui";
import { hasRecord, openIfRecord, RecordButton } from "./Records";

function MaeChart() {
  const t = useTrackX()!;
  const [ref, W] = useWidth<HTMLDivElement>(700);
  const [hover, setHover] = useState<number | null>(null);
  const cm = t.base.coach_metrics.filter((c) => c.mae_pct != null);
  const l2 = t.base.l2;
  if (!cm.length) return <p className="s-note">No coach metrics in this export.</p>;
  const ML = 52;
  const MR = 16;
  const top = 26;
  const ph = 220;
  const rowY = top + ph + 34;
  const H = rowY + 46;
  const gMax = Math.max(...cm.map((c) => c.generation));
  const gMin = Math.min(...cm.map((c) => c.generation));
  const x = linear([gMin - 0.5, gMax + 0.5], [ML, W - MR]);
  const yMax = Math.max(10, ...cm.map((c) => c.mae_pct!)) * 1.1;
  const y = linear([0, yMax], [top + ph, top]);
  // strategy-version bands
  const bands: { v: number; g0: number; g1: number }[] = [];
  for (const c of cm) {
    const v = c.strategy_version ?? 0;
    const last = bands[bands.length - 1];
    if (last && last.v === v) last.g1 = c.generation;
    else bands.push({ v, g0: c.generation, g1: c.generation });
  }
  const pts = cm.map((c, i) => ({ c, i, px: x(c.generation) + (cm.filter((d, j) => d.generation === c.generation && j < i).length ? 8 : 0), py: y(c.mae_pct!) }));
  const hp = hover != null ? pts[hover] : null;
  return (
    <div className="s-chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} role="img" aria-label="Coach prediction error per night">
        {bands.map((b, i) => (
          <g key={i}>
            <rect className={i % 2 ? "s-band-alt" : "s-band"} x={x(b.g0 - 0.5)} width={x(b.g1 + 0.5) - x(b.g0 - 0.5)} y={top} height={ph} />
            <text className="s-ax" x={x(b.g0 - 0.5) + 6} y={top + 14}>
              strategy v{b.v}
            </text>
          </g>
        ))}
        <text className="s-ax-title" x={ML} y={top - 10}>
          {W < 640 ? "Prediction error per night (pts)" : "Coach's prediction error per night (mean absolute error, percentage points of homes dark) · x = night"}
        </text>
        {niceTicks(0, yMax, 4).map((v) => (
          <g key={v}>
            <line className="s-grid" x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} />
            <text className="s-ax" x={ML - 8} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <path d={linePath(pts.map((p) => [p.px, p.py]))} fill="none" stroke="var(--ink2)" strokeWidth={1.4} />
        {l2.map((e) => {
          const gx = x(e.generation + 0.5);
          return (
            <g key={e.generation}>
              <line className={e.adopted ? "s-l2-ad" : "s-l2-rev"} x1={gx} x2={gx} y1={top} y2={top + ph} />
              <text className={`s-ax ${e.adopted ? "s-acc-t" : "s-bad-t"}`} x={gx > W - MR - 60 ? gx - 4 : gx + 4} y={top + ph - 6} textAnchor={gx > W - MR - 60 ? "end" : "start"}>
                {e.adopted ? "adopted" : "reverted"}
              </text>
            </g>
          );
        })}
        {pts.map((p) => (
          <circle key={p.i} cx={p.px} cy={p.py} r={hover === p.i ? 6 : 4} className={(p.c.gaming ?? 0) > 0 ? "s-dot-bad" : "s-dot"} />
        ))}
        {/* kept / tested row */}
        <text className="s-ax" x={ML - 8} y={rowY + 4} textAnchor="end">
          kept
        </text>
        <text className="s-ax" x={ML - 8} y={rowY + 22} textAnchor="end">
          gaming
        </text>
        {pts.map((p) => (
          <g key={`r${p.i}`}>
            <text className="s-ax s-num" x={p.px} y={rowY + 4} textAnchor="middle">
              {p.c.kept ?? 0}/{p.c.tested ?? 0}
            </text>
            <text className={`s-ax s-num ${(p.c.gaming ?? 0) > 0 ? "s-bad-t" : ""}`} x={p.px} y={rowY + 22} textAnchor="middle">
              {p.c.gaming ?? 0}
            </text>
            <text className="s-ax" x={p.px} y={top + ph + 16} textAnchor="middle">
              {p.c.generation - 1}
            </text>
          </g>
        ))}
        {pts.map((p) => (
          <rect key={`h${p.i}`} className="s-hit" x={p.px - 12} width={24} y={top} height={ph} tabIndex={0} aria-label={`${nightLabel(p.c.generation)}: error ${p.c.mae_pct} points`} onMouseEnter={() => setHover(p.i)} onFocus={() => setHover(p.i)} onBlur={() => setHover(null)} onClick={() => openIfRecord(p.c, `Coach metrics, ${nightLabel(p.c.generation)}`)} onKeyDown={(ev) => ev.key === "Enter" && openIfRecord(p.c, `Coach metrics, ${nightLabel(p.c.generation)}`)} />
        ))}
      </svg>
      {hp && (
        <Tip x={hp.px} y={hp.py - 20} width={W} show>
          <div className="s-tip-h">{nightLabel(hp.c.generation)}</div>
          <div className="s-tip-row">
            <span>Prediction error</span>
            <b>{hp.c.mae_pct} pts</b>
          </div>
          <div className="s-tip-row">
            <span>Direction right</span>
            <b>{hp.c.sign_acc != null ? `${Math.round(hp.c.sign_acc * 100)}%` : "–"}</b>
          </div>
          <div className="s-tip-row">
            <span>Ideas kept / tested</span>
            <b>
              {hp.c.kept ?? 0} / {hp.c.tested ?? 0}
            </b>
          </div>
          <div className="s-tip-row">
            <span>Caught gaming</span>
            <b>{hp.c.gaming ?? 0}</b>
          </div>
          <div className="s-tip-row">
            <span>Coaching strategy</span>
            <b>v{hp.c.strategy_version ?? 0}</b>
          </div>
          {hp.c.night0 && <div className="s-tip-sub">Night 0: the coach's zero-shot manual, before any failure</div>}
          {hasRecord(hp.c) && <div className="s-tip-foot">Click for the stored record</div>}
        </Tip>
      )}
    </div>
  );
}

function Calibration() {
  const t = useTrackX()!;
  const [ref, W0] = useWidth<HTMLDivElement>(420);
  const [hover, setHover] = useState<number | null>(null);
  const pts = t.base.calibration;
  if (!pts.length) return null;
  const W = Math.min(W0, 460);
  const M = 44;
  const lim = Math.ceil(Math.max(20, ...pts.flatMap((p) => [Math.abs(p.predicted_pct), Math.abs(p.actual_pct)])) / 10) * 10;
  const x = linear([-lim, lim], [M, W - 12]);
  const y = linear([-lim, lim], [W - M + 12, 12]);
  const ticks = niceTicks(-lim, lim, 4);
  const editOf = (i: number) => {
    const p = pts[i];
    return t.base.edits.find((e) => e.generation === p.generation && e.predicted_pct === p.predicted_pct && e.actual_pct === p.actual_pct);
  };
  const hp = hover != null ? pts[hover] : null;
  const he = hover != null ? editOf(hover) : undefined;
  const gamingKinds = /gaming|memor/;
  return (
    <div className="s-chart s-calib" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={W + 8} role="img" aria-label="Predicted vs measured effect of each tested idea">
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? "s-grid0" : "s-grid"} x1={x(v)} x2={x(v)} y1={12} y2={W - M + 12} />
            <line className={v === 0 ? "s-grid0" : "s-grid"} x1={M} x2={W - 12} y1={y(v)} y2={y(v)} />
            <text className="s-ax" x={x(v)} y={W - M + 28} textAnchor="middle">
              {v}
            </text>
            <text className="s-ax" x={M - 6} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <line className="s-diag" x1={x(-lim)} y1={y(-lim)} x2={x(lim)} y2={y(lim)} />
        <text className="s-ax" x={x(lim) - 4} y={y(lim) + 14} textAnchor="end">
          perfect prediction
        </text>
        <text className="s-ax-title" x={(M + W) / 2} y={W + 4} textAnchor="middle">
          Predicted change in homes dark (%)
        </text>
        <text className="s-ax-title" transform={`translate(12 ${(W - M) / 2 + 12}) rotate(-90)`} textAnchor="middle">
          Measured (%)
        </text>
        {pts.map((p, i) => {
          const e = editOf(i);
          const gaming = gamingKinds.test(e?.reason_kind ?? "");
          const cls = p.status === "accepted" || p.status === "stacked" ? "s-cal-keep" : gaming ? "s-cal-game" : "s-cal-rej";
          return (
            <circle
              key={i}
              cx={x(Math.max(-lim, Math.min(lim, p.predicted_pct)))}
              cy={y(Math.max(-lim, Math.min(lim, p.actual_pct)))}
              r={hover === i ? 6.5 : 4.5}
              className={cls}
              tabIndex={0}
              aria-label={`${nightLabel(p.generation)}: predicted ${p.predicted_pct}%, measured ${p.actual_pct}%`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hp && (
        <Tip x={x(hp.predicted_pct)} y={y(hp.actual_pct)} width={W} show>
          <div className="s-tip-h">{he?.title ?? "Idea"}</div>
          <div className="s-tip-sub">
            {nightLabel(hp.generation)} · {organShort(hp.organ)} · {hp.status}
            {he?.reason ? ` · ${he.reason}` : ""}
          </div>
          <div className="s-tip-row">
            <span>Predicted</span>
            <b>{fmtSignedPct(hp.predicted_pct)}</b>
          </div>
          <div className="s-tip-row">
            <span>Measured</span>
            <b>{fmtSignedPct(hp.actual_pct, 1)}</b>
          </div>
        </Tip>
      )}
      <div className="s-legend s-legend-sm">
        <span className="s-lg">
          <i className="s-cal-sw s-cal-keep" /> kept
        </span>
        <span className="s-lg">
          <i className="s-cal-sw s-cal-rej" /> rejected
        </span>
        <span className="s-lg">
          <i className="s-cal-sw s-cal-game" /> rejected for gaming
        </span>
      </div>
    </div>
  );
}

export function CoachRsi() {
  const t = useTrackX()!;
  const l2 = t.base.l2;
  const cm = t.base.coach_metrics.filter((c) => c.mae_pct != null);
  const adopted = l2.filter((e) => e.adopted).length;
  const first = cm[0];
  const last = cm[cm.length - 1];
  return (
    <Section id="coach">
      <SectionHead id="coach" n="06" kicker="The coach improving itself" title="A coach that grades its own predictions">
        Every second night the coach reviews how well it predicted its ideas' effects, rewrites its coaching strategy, and A/B-tests the rewrite by replaying the same
        night. Track {t.key}: {l2.length} rewrites proposed, {adopted} adopted, {l2.length - adopted} reverted by its own test.
        {first && last ? ` Prediction error was ${first.mae_pct} points on ${nightLabel(first.generation)} and ${last.mae_pct} on ${nightLabel(last.generation)}.` : ""}
      </SectionHead>
      <MaeChart />
      <p className="s-caption">
        Trend over few data points: {cm.length} nights, {Math.min(...cm.map((c) => c.tested ?? 0))}–{Math.max(...cm.map((c) => c.tested ?? 0))} ideas tested per night. Red dots =
        nights where at least one idea was caught gaming the test. Vertical lines = the coach's self-review after that night.
      </p>

      <div className="s-coach-grid">
        <div>
          <h3 className="s-h3">Strategy rewrites, with the coach's own words</h3>
          <ol className="s-l2">
            {l2.map((e) => (
              <li key={e.generation} className={e.adopted ? "ad" : "rev"}>
                <div className="s-l2-top">
                  <span className={`s-tag ${e.adopted ? "s-tag-added" : "s-tag-removed"}`}>{e.adopted ? "adopted" : "reverted"}</span>
                  <span className="s-dim">after {nightLabel(e.generation)}</span>
                  {e.strategy_version != null && <span className="s-dim">· strategy v{e.strategy_version}</span>}
                  <RecordButton of={e} title={`Coaching-strategy rewrite after ${nightLabel(e.generation)}`} />
                </div>
                {e.insight && <blockquote className="s-insight">“{e.insight}”</blockquote>}
                {e.ab && (
                  <div className="s-ab">
                    <div>
                      <span>Prediction error</span>
                      <b>
                        {e.ab.old_mae ?? "–"} → {e.ab.new_mae ?? "–"} pts
                      </b>
                    </div>
                    <div>
                      <span>Best idea's effect</span>
                      <b>
                        {fmtSignedPct(e.ab.old_best, 1)} → {fmtSignedPct(e.ab.new_best, 1)}
                      </b>
                    </div>
                    <div className="s-dim">A/B on a replay of {nightLabel(e.ab.night_replayed ?? e.generation)}</div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="s-h3">Predicted vs measured, every tested idea</h3>
          <Calibration />
          <p className="s-caption">
            {t.base.calibration.length} ideas on Track {t.key}. Points below the diagonal did better than predicted; above it, worse. Points in the upper left were
            predicted to help and measured to keep more homes dark.
          </p>
        </div>
      </div>
    </Section>
  );
}
