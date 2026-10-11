import { useMemo, useState } from "react";
import { areaPath, linear, logScale, logTicks, niceTicks, stepPath, Tip, Ticks, useWidth, type Scale } from "./charts";
import { fmtHH, fmtSignedPct, pctChange, stormName, useSite, useTrackX, versionWhen, type TrackX, type Version } from "./data";
import { Section, SectionHead, Seg, scrollToId } from "./ui";

const M = { l: 64, r: 168, t: 18 };
const H_TOP = 190;
const GAP = 44;
const H_BOT = 230;

const inEffect = (t: TrackX, night: number): Version | undefined => [...t.versions].filter((v) => v.score && v.night <= night).pop();
const endNight = (t: TrackX) => Math.max(t.final?.night ?? 0, t.frozen?.generationsRun ?? 0, ...t.versions.map((v) => v.night));

export function LearningCurve() {
  const data = useSite((s) => s.data)!;
  const t = useTrackX()!;
  const [shown, setShown] = useState<Record<string, boolean>>({ A: true, B: true });
  const [scale, setScale] = useState<"log" | "linear">("log");
  const [showBase, setShowBase] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useWidth<HTMLDivElement>(1000);

  const tracks = data.trackKeys.filter((k) => shown[k] || k === t.key).map((k) => data.tracks[k]);
  const primary = t;
  // x runs to the primary track's end (and the last version of any shown track); a longer plateau is clipped and labelled
  const maxNight = Math.max(1, endNight(primary), ...tracks.flatMap((tr) => tr.versions.map((v) => v.night)));
  const narrow = W < 640; // phones: no right-hand labels, the legend below names the baselines
  const innerW = Math.max(160, W - M.l - (narrow ? 12 : M.r));
  const x = linear([0, maxNight], [M.l, M.l + innerW]);
  const yTop = linear([0, 8], [M.t + H_TOP, M.t]);
  const bot0 = M.t + H_TOP + GAP;

  const allHH = tracks.flatMap((tr) => [
    ...tr.versions.flatMap((v) => [v.score?.hhMin, v.score?.hhMax, v.score?.hhMedian]),
    showBase ? tr.zeroShot?.hhMedian : null,
  ]).filter((v): v is number => v != null && v > 0);
  const hhLo = Math.min(...allHH);
  const hhHi = Math.max(...allHH);
  const yBot: Scale =
    scale === "log" ? logScale([hhLo * 0.8, hhHi * 1.15], [bot0 + H_BOT, bot0]) : linear([0, hhHi * 1.05], [bot0 + H_BOT, bot0]);
  const botTicks = scale === "log" ? logTicks(hhLo * 0.8, hhHi * 1.15) : niceTicks(0, hhHi * 1.05, 5);
  const totalH = bot0 + H_BOT + 44;

  const color = (k: string) => (k === "B" ? "var(--accent)" : "var(--trackA)");
  const nights = Array.from({ length: maxNight + 1 }, (_, i) => i);
  const hv = hover != null ? inEffect(primary, hover) : undefined;

  const series = useMemo(
    () =>
      tracks.map((tr) => {
        const vs = tr.versions.filter((v) => v.score);
        const end = Math.min(endNight(tr), maxNight);
        const realEnd = endNight(tr);
        const ext = (pts: [number, number][]) => (pts.length && end > (vs[vs.length - 1]?.night ?? 0) ? [...pts, [x(end), pts[pts.length - 1][1]] as [number, number]] : pts);
        const top = ext(vs.map((v) => [x(v.night), yTop(v.score!.majority)]));
        const med = ext(vs.map((v) => [x(v.night), yBot(v.score!.hhMedian ?? 1)]));
        const hi = ext(vs.map((v) => [x(v.night), yBot(v.score!.hhMax ?? v.score!.hhMedian ?? 1)]));
        const lo = ext(vs.map((v) => [x(v.night), yBot(v.score!.hhMin ?? v.score!.hhMedian ?? 1)]));
        return { tr, vs, end, realEnd, top, med, hi, lo };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks.map((tr) => tr.key).join(), W, scale, showBase, data],
  );

  const stepArea = (hi: [number, number][], lo: [number, number][]) => {
    const toStep = (p: [number, number][]) => p.flatMap((pt, i) => (i ? [[pt[0], p[i - 1][1]] as [number, number], pt] : [pt]));
    return areaPath(toStep(hi), toStep(lo));
  };

  const fin = primary.final?.score;
  const v1 = primary.v1?.score;
  const best = primary.best;
  const zs = primary.zeroShot;
  const hvT = hover != null ? [...tracks].sort((a, b) => (b.key === primary.key ? 1 : 0) - (a.key === primary.key ? 1 : 0)).map((tr) => ({ tr, v: inEffect(tr, hover) })) : [];

  const select = (night: number) => {
    const v = inEffect(primary, night);
    if (!v) return;
    useSite.getState().setVersion(v.id);
    useSite.getState().setDiff(false);
    scrollToId("versions");
  };

  return (
    <Section id="curve">
      <SectionHead id="curve" n="01" kicker="Learning curve" title="Storms it never saw, version by version">
        Track {primary.key}: {v1?.majority ?? "–"} of 8 unseen storms passed on Day 1, {best?.score?.majority ?? "–"} of 8 at best ({best?.label}, {best ? versionWhen(best) : "–"}),{" "}
        {fin?.majority ?? "–"} of 8 for the final frozen notebook ({primary.final?.label}, {primary.final ? versionWhen(primary.final) : "–"}). Home-hours in the dark {fmtSignedPct(pctChange(v1?.hhMedian, fin?.hhMedian))} from Day 1 to final.
      </SectionHead>

      <div className="s-toolbar">
        <div className="s-legend">
          {data.trackKeys.map((k) => (
            <label key={k} className={`s-check ${k === primary.key ? "s-check-primary" : ""}`}>
              <input type="checkbox" checked={k === primary.key || !!shown[k]} disabled={k === primary.key} onChange={(e) => setShown({ ...shown, [k]: e.target.checked })} />
              <i style={{ background: color(k) }} />
              Track {k}
              <span className="s-dim">{k === "A" ? "in-storm only" : "everything"}</span>
            </label>
          ))}
          <label className="s-check">
            <input type="checkbox" checked={showBase} onChange={(e) => setShowBase(e.target.checked)} />
            <i className="s-dash" />
            Baselines
          </label>
        </div>
        <Seg label="Darkness scale" value={scale} onChange={setScale} options={[{ v: "log", label: "Log" }, { v: "linear", label: "Linear" }]} />
      </div>

      <div className="s-chart" ref={wrapRef} onMouseLeave={() => setHover(null)}>
        <svg width={W} height={totalH} role="img" aria-label={`Learning curve for Track ${primary.key}`}>
          {/* ---- top panel: storms passed */}
          <text className="s-ax-title" x={M.l} y={M.t - 6}>
            {narrow ? "Unseen storms passed (of 8)" : "Unseen storms passed (of 8, majority of 3 seeds)"}
          </text>
          {[0, 2, 4, 6, 8].map((v) => (
            <g key={v}>
              <line className="s-grid" x1={M.l} x2={M.l + innerW} y1={yTop(v)} y2={yTop(v)} />
              <text className="s-ax" x={M.l - 10} y={yTop(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {/* ---- bottom panel: darkness */}
          <text className="s-ax-title" x={M.l} y={bot0 - 8}>
            {narrow ? "Home-hours dark (median, min–max)" : "Home-hours in the dark (median of 3 seeds; band = min–max)"}
            {scale === "log" ? " · log" : ""}
          </text>
          {botTicks.map((v) => (
            <g key={v}>
              <line className="s-grid" x1={M.l} x2={M.l + innerW} y1={yBot(v)} y2={yBot(v)} />
              <text className="s-ax" x={M.l - 10} y={yBot(v) + 4} textAnchor="end">
                {fmtHH(v)}
              </text>
            </g>
          ))}
          {/* x axis */}
          {nights.map((nn) => (
            <text key={nn} className="s-ax" x={x(nn)} y={bot0 + H_BOT + 18} textAnchor="middle">
              {nn === 0 ? "Day 1" : nn - 1}
            </text>
          ))}
          <text className="s-ax-title" x={M.l} y={bot0 + H_BOT + 38}>
            {narrow ? "Night written (0 = first draft)" : "Night the version was written (Night 0 = the coach's first draft, before it learned from any failure)"}
          </text>

          {/* hover column */}
          {hover != null && <rect className="s-hovercol" x={x(hover) - innerW / maxNight / 2} width={innerW / maxNight} y={M.t} height={bot0 + H_BOT - M.t} />}

          {/* baselines (labels dodged so they never overlap) */}
          {showBase &&
            (() => {
              const lines = tracks.flatMap((tr) => {
                const out: { key: string; y: number; text: string; cls: string; c: string; op: number }[] = [];
                const pre = tracks.length > 1 ? `${tr.key} · ` : "";
                const op = tr.key === primary.key ? 1 : 0.5;
                if (tr.zeroShot?.hhMedian != null) out.push({ key: `z${tr.key}`, y: yBot(tr.zeroShot.hhMedian), text: `${pre}Claude's best guess`, cls: "s-base", c: color(tr.key), op });
                if (tr.v1?.score?.hhMedian != null) out.push({ key: `d${tr.key}`, y: yBot(tr.v1.score.hhMedian), text: `${pre}Day 1`, cls: "s-base s-base-d1", c: color(tr.key), op });
                return out;
              });
              const sorted = [...lines].sort((a, b) => a.y - b.y);
              const ly: Record<string, number> = {};
              let prev = -Infinity;
              for (const l of sorted) {
                const yy = Math.max(l.y + 4, prev + 13);
                ly[l.key] = yy;
                prev = yy;
              }
              return lines.map((l) => (
                <g key={l.key} opacity={l.op}>
                  <line className={l.cls} x1={M.l} x2={M.l + innerW} y1={l.y} y2={l.y} style={{ stroke: l.c }} />
                  <text className="s-base-label" x={M.l + innerW + 8} y={ly[l.key]} display={narrow ? "none" : undefined}>
                    {l.text}
                  </text>
                </g>
              ));
            })()}
          {showBase && (
            <text className="s-base-label" x={M.l + innerW + 8} y={yTop(0) + 4} display={narrow ? "none" : undefined}>
              Day 1 and best guess: {[...new Set(tracks.map((tr) => `${tr.v1?.score?.majority ?? "–"}`))].join("/")} of 8
            </text>
          )}

          {/* series */}
          {series
            .sort((a, b) => (a.tr.key === primary.key ? 1 : 0) - (b.tr.key === primary.key ? 1 : 0))
            .map(({ tr, vs, end, realEnd, top, med, hi, lo }) => {
              const isP = tr.key === primary.key;
              const c = color(tr.key);
              const lastV = vs[vs.length - 1];
              return (
                <g key={tr.key} className={`s-series ${isP ? "s-series-p" : "s-series-s"}`}>
                  <path d={stepArea(hi, lo)} fill={c} opacity={isP ? 0.13 : 0.07} />
                  <path d={stepPath(top)} fill="none" stroke={c} strokeWidth={isP ? 2 : 1.4} />
                  <path d={stepPath(med)} fill="none" stroke={c} strokeWidth={isP ? 2 : 1.4} />
                  {lastV && realEnd > lastV.night && (
                    <text className="s-ax" x={x(end)} y={yBot(lastV.score!.hhMedian ?? 1) - 8} textAnchor="end">
                      {tracks.length > 1 ? `Track ${tr.key}: ` : ""}no further change kept; frozen after Night {realEnd - 1}
                      {realEnd > end ? " →" : ""}
                    </text>
                  )}
                  {vs.map((v) => {
                    const on = hv?.id === v.id;
                    return (
                      <g key={v.id}>
                        {isP &&
                          Object.entries(v.score!.bySeed).map(([seed, s]) =>
                            s.passed != null ? <circle key={seed} className="s-seeddot" cx={x(v.night)} cy={yTop(s.passed)} r={2.6} style={{ stroke: c }} /> : null,
                          )}
                        {isP && v.isBest && <circle cx={x(v.night)} cy={yTop(v.score!.majority)} r={10} fill="none" stroke={c} strokeWidth={1.2} opacity={0.6} />}
                        {isP && v.isBest && <circle cx={x(v.night)} cy={yBot(v.score!.hhMedian ?? 1)} r={10} fill="none" stroke={c} strokeWidth={1.2} opacity={0.6} />}
                        <circle cx={x(v.night)} cy={yTop(v.score!.majority)} r={on ? 6 : isP ? 4.5 : 3.5} fill={v.isFinal ? "var(--surface)" : c} stroke={c} strokeWidth={2} />
                        <circle cx={x(v.night)} cy={yBot(v.score!.hhMedian ?? 1)} r={on ? 6 : isP ? 4.5 : 3.5} fill={v.isFinal ? "var(--surface)" : c} stroke={c} strokeWidth={2} />
                        {isP && (
                          <text className={`s-vlabel ${on ? "on" : ""} ${v.isBest || v.isFinal ? "s-vlabel-key" : ""}`} x={x(v.night)} y={yTop(v.score!.majority) - (v.isBest ? 16 : 12)} textAnchor="middle">
                            {v.label}
                            {v.isFinal ? " final" : v.isBest ? " best" : ""}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}

          {/* hit zones: one per night, selects the version in effect that night */}
          {nights.map((nn) => {
            const v = inEffect(primary, nn);
            if (!v) return null;
            return (
              <rect
                key={nn}
                className="s-hit"
                x={x(nn) - innerW / maxNight / 2}
                width={innerW / maxNight}
                y={M.t}
                height={bot0 + H_BOT - M.t}
                tabIndex={v.night === nn ? 0 : -1}
                role="button"
                aria-label={`${v.label}, ${versionWhen(v)}: ${v.score?.majority} of 8 storms passed, ${fmtHH(v.score?.hhMedian)} home-hours dark. Open this version.`}
                onMouseEnter={() => setHover(nn)}
                onFocus={() => setHover(nn)}
                onBlur={() => setHover(null)}
                onClick={() => select(nn)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(nn))}
              />
            );
          })}
        </svg>
        {hover != null && hv && (
          <Tip x={x(hover)} y={M.t + 20} width={W} show>
            {hvT.map(({ tr, v }) =>
              v ? (
                <div key={tr.key} className={`s-tip-block ${tr.key === primary.key ? "" : "s-tip-sec"}`}>
                  <div className="s-tip-h">
                    <i style={{ background: color(tr.key) }} />
                    Track {tr.key} · {v.label}
                    {v.isFinal && <em>final frozen</em>}
                    {v.isBest && !v.isFinal && <em>best</em>}
                  </div>
                  <div className="s-tip-sub">
                    {v.index === 0 ? "Day-1 notebook" : `written ${versionWhen(v)}`} · {v.id}
                    {v.night !== hover ? ` · still in effect at Night ${hover - 1}` : ""}
                  </div>
                  <div className="s-tip-row">
                    <span>Storms passed</span>
                    <b>{v.score!.majority} / 8</b>
                  </div>
                  <div className="s-tip-row">
                    <span>Per seed</span>
                    <b>
                      {Object.entries(v.score!.bySeed)
                        .map(([s, b]) => `s${s} ${b.passed ?? "–"}`)
                        .join(" · ")}
                    </b>
                  </div>
                  <div className="s-tip-row">
                    <span>Home-hours dark</span>
                    <b>{fmtHH(v.score!.hhMedian)}</b>
                  </div>
                  {tr.key === primary.key && (
                    <>
                      <div className="s-tip-storms">
                        {data.heldout.map((sid, i) => {
                          const k = [...v.score!.ticks][i];
                          return (
                            <div key={sid} className="s-tip-storm">
                              <i className={`s-tick s-tick-${k === "✓" ? "pass" : "fail"}`} />
                              {stormName(sid)}
                            </div>
                          );
                        })}
                      </div>
                      {v.edit && <div className="s-tip-edit">Kept idea: {v.edit.title}</div>}
                      <div className="s-tip-foot">Click to open {v.label} in Harness versions</div>
                    </>
                  )}
                </div>
              ) : null,
            )}
          </Tip>
        )}
      </div>

      <div className="s-markers-key">
        <span>
          <i className="s-mkey s-mkey-v" /> notebook version
        </span>
        <span>
          <i className="s-mkey s-mkey-best" /> best on the unseen storms ({best?.label}, {best?.score?.majority}/8)
        </span>
        <span>
          <i className="s-mkey s-mkey-final" /> final frozen ({primary.final?.label}, {fin?.majority}/8)
        </span>
        <span>
          <i className="s-mkey s-mkey-seed" /> one seed
        </span>
      </div>
      <p className="s-note s-note-key">
        We report the final, not the best: picking the best version after seeing the unseen-storm results would be cheating. The final frozen notebook is simply
        the one the loop ended with.
      </p>
      <div className="s-caption">
        <p>
          Every version in the lineage is plotted at the night it was written, re-scored after the loop froze on the same 8 unseen storms, 3 seeds each (24 runs
          per version). Passed = passed on at least 2 of 3 seeds. Band = min–max over the 3 seeds.
          {zs ? ` "Claude's best guess" = the model's own notebook written with no learning (${zs.majority ?? 0} of 8, ${fmtHH(zs.hhMedian)} home-hours).` : ""}
        </p>
        {data.tracks.A && (
          <p>
            Track A (in-storm habits only) cut home-hours in the dark {fmtSignedPct(pctChange(data.tracks.A.v1?.score?.hhMedian, data.tracks.A.final?.score?.hhMedian))} but
            never cleared the pass line on an unseen storm ({data.tracks.A.final?.score?.majority ?? 0} of 8).
          </p>
        )}
      </div>
      <div className="s-version-strip" role="list" aria-label="Versions">
        {primary.versions.map((v) => (
          <button key={v.id} role="listitem" className="s-vchip" onClick={() => select(v.night)} onMouseEnter={() => setHover(v.night)} onMouseLeave={() => setHover(null)}>
            <span className="s-vchip-l">
              {v.label} <span className="s-dim">· {versionWhen(v)}</span>
              {v.isFinal ? <em> final</em> : v.isBest ? <em> best</em> : null}
            </span>
            <Ticks ticks={v.score?.ticks} names={data.heldout.map(stormName)} size="sm" />
            <span className="s-vchip-n">{fmtHH(v.score?.hhMedian)}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}
