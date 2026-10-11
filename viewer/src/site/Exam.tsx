import { Fragment, useMemo, useState } from "react";
import { linear, useWidth } from "./charts";
import { clampPct, fmtHH, fmtSignedPct, pctChange, useSite, type LockedRow } from "./data";
import { useLite } from "./replays";
import { TraceChart, traceScales } from "./TraceChart";
import { Section, SectionHead } from "./ui";

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "No learning", keys: ["A", "B", "T0"] },
  { title: "Learned notebooks", keys: ["C_A", "C_B"] },
  { title: "Same notebooks, AI unplugged", keys: ["D_A", "D_B"] },
  { title: "Notebook moved to another model", keys: ["T"] },
];

function minutes(s: number | null | undefined) {
  if (s == null) return "–";
  return `${Math.round(s / 60)} min`;
}

function DotPlot({ rows, base, open, setOpen }: { rows: LockedRow[]; base: LockedRow | undefined; open: string | null; setOpen: (k: string | null) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>(900);
  const maxHH = Math.max(...rows.flatMap((r) => [r.hh ?? 0, ...r.seeds.map((s) => s.hh ?? 0)])) * 1.05;
  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const groups = [...GROUPS.map((g) => ({ ...g, rows: g.keys.map((k) => rows.find((r) => r.key === k)).filter((r): r is LockedRow => !!r) })), { title: "Other", keys: [], rows: rows.filter((r) => !known.has(r.key)) }].filter((g) => g.rows.length);
  const barW = Math.max(140, Math.min(380, W - 800));
  const x = linear([0, maxHH], [0, barW]);
  return (
    <div className="s-exam" ref={ref} style={{ ["--barw" as string]: `${barW}px` }}>
      <div className="s-exam-head">
        <span>Configuration</span>
        <span>Home-hours in the dark · median, dots = 3 seeds</span>
        <span className="r">Median</span>
        <span className="r">vs Day 1</span>
        <span className="r">Seeds passed</span>
        <span className="r">Collapses</span>
        <span className="r">Worst hour</span>
        <span className="r">Below 59.4 Hz</span>
      </div>
      {groups.map((g) => (
        <div key={g.title} className="s-exam-group">
          <div className="s-exam-gt">{g.title}</div>
          {g.rows.map((r) => {
            const ch = r.key === base?.key ? null : pctChange(base?.hh, r.hh);
            const isOpen = open === r.key;
            return (
              <Fragment key={r.key}>
                <button className={`s-exam-row ${isOpen ? "on" : ""}`} onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen}>
                  <span className="s-exam-l">
                    <code>{r.key}</code>
                    <span>{r.label}</span>
                  </span>
                  <span className="s-exam-bar">
                    <svg width={barW} height={18} aria-hidden>
                      <line x1={0} x2={barW} y1={9} y2={9} className="s-grid" />
                      {base?.hh != null && <line x1={x(base.hh)} x2={x(base.hh)} y1={1} y2={17} className="s-exam-ref" />}
                      <rect x={0} y={5} width={x(r.hh ?? 0)} height={8} rx={1} className={r.key === "A" || r.key === "B" || r.key === "T0" ? "s-exam-b-bad" : "s-exam-b"} />
                      {r.seeds.map((s) => (
                        <circle key={s.seed} cx={x(s.hh ?? 0)} cy={9} r={3} className={s.collapsed ? "s-exam-seed-col" : "s-exam-seed"} />
                      ))}
                    </svg>
                  </span>
                  <span className="r num">{fmtHH(r.hh)}</span>
                  <span className={`r num ${ch != null && ch < 0 ? "s-acc-t" : ""}`}>{ch == null ? "—" : fmtSignedPct(ch)}</span>
                  <span className="r num">
                    {r.passedSeeds ?? 0}/{r.seeds.length || 3}
                  </span>
                  <span className={`r num ${(r.collapses ?? 0) > 0 ? "s-bad-t" : ""}`}>{r.collapses ?? 0}</span>
                  <span className="r num">{clampPct(r.peakShed)}</span>
                  <span className={`r num ${(r.below594s ?? 0) > 0 ? "s-bad-t" : ""}`}>{minutes(r.below594s)}</span>
                </button>
                {isOpen && (
                  <div className="s-exam-seeds">
                    <table className="s-table s-table-sm">
                      <thead>
                        <tr>
                          <th>Seed</th>
                          <th>Result</th>
                          <th className="r">Home-hours dark</th>
                          <th className="r">Worst hour</th>
                          <th className="r">Lowest frequency</th>
                          <th className="r">Longest below 59.4 Hz</th>
                          <th className="r">AI calls</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.seeds.map((s) => (
                          <tr key={s.seed}>
                            <td className="num">{s.seed}</td>
                            <td className={s.collapsed ? "s-bad-t" : ""}>{s.collapsed ? `collapsed at h${s.collapseHour}` : s.passed ? "passed" : "failed"}</td>
                            <td className="r num">{fmtHH(s.hh)}</td>
                            <td className="r num">{clampPct(s.peakShed)}</td>
                            <td className={`r num ${s.minFreq != null && s.minFreq < 59.4 ? "s-bad-t" : ""}`}>{s.minFreq != null ? `${s.minFreq.toFixed(2)} Hz` : "–"}</td>
                            <td className="r num">{s.maxBelowMin ?? 0} min</td>
                            <td className="r num">{s.aiCalls ?? "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ExamTraces() {
  const a = useLite("exam_A.json").replay;
  const ca = useLite("exam_C_A.json").replay;
  const cb = useLite("exam_C_B.json").replay;
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(
    () =>
      [
        a && { key: "A", label: "Day-1 notebook", color: "var(--bad)", points: a.points },
        ca && { key: "C_A", label: "Track A frozen", color: "var(--trackA)", points: ca.points },
        cb && { key: "C_B", label: "Track B frozen", color: "var(--accent)", points: cb.points },
      ].filter((s): s is { key: string; label: string; color: string; points: NonNullable<typeof a>["points"] } => !!s),
    [a, ca, cb],
  );
  if (!series.length) return null;
  const scales = traceScales(series.map((s) => s.points));
  const at = hover != null ? series.map((s) => ({ s, p: s.points.find((p) => p.h === hover) })) : [];
  return (
    <div className="s-exam-trace">
      <h3 className="s-h3">Seed 0, hour by hour</h3>
      <div className="s-legend s-legend-sm">
        {series.map((s) => (
          <span key={s.key} className="s-lg">
            <i className="s-line-sw2" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <TraceChart series={series} scales={scales} hover={hover} onHover={setHover} ariaLabel="Locked exam traces, seed 0" />
      <div className="s-readout" aria-live="polite">
        {hover != null ? (
          <>
            <b>h{hover}</b>
            {at.map(({ s, p }) => (
              <span key={s.key}>
                {s.label}: {p ? `${p.freq != null && p.freq > 0 ? p.freq.toFixed(2) + " Hz" : "grid down"}, ${Math.round(p.homesDark / 1000).toLocaleString("en-US")}K dark` : "–"}
              </span>
            ))}
          </>
        ) : (
          <span className="s-dim">Hover to compare the three runs at one hour.</span>
        )}
      </div>
    </div>
  );
}

export function Exam() {
  const data = useSite((s) => s.data)!;
  const L = data.honesty.locked;
  const [open, setOpen] = useState<string | null>(null);
  const row = (k: string) => L.rows.find((r) => r.key === k);
  const A = row("A");
  const B = row("B");
  const CA = row("C_A");
  const CB = row("C_B");
  const DA = row("D_A");
  const DB = row("D_B");
  const T0 = row("T0");
  const T = row("T");
  const nPass = L.rows.filter((r) => (r.passedSeeds ?? 0) > 0).length;
  const apiErr = L.rows.reduce((s, r) => s + (r.apiErrors ?? 0), 0);
  const bestPeak = [...L.rows].sort((a, b) => (a.peakShed ?? 9) - (b.peakShed ?? 9))[0];

  return (
    <Section id="exam">
      <SectionHead id="exam" n="07" kicker="Locked exam" title="February 2021, run once">
        {L.run ? (
          <>
            The February 2021 storm, kept locked until the notebooks were frozen, then run once per configuration on 3 seeds. The AI sees it anonymised: no name, date
            or place.
          </>
        ) : (
          <>The locked 2021 exam has not been run yet. Results appear here as soon as the exporter writes them; nothing below is a placeholder number.</>
        )}
      </SectionHead>
      {!L.run ? (
        <div className="s-pending">
          <span className="s-pending-dot" /> Pending: the exam is running. This page checks for a new export every minute.
        </div>
      ) : (
        <>
          <ul className="s-findings">
            <li>
              <b>{nPass === 0 ? "Nobody passes." : `${nPass} configuration${nPass === 1 ? "" : "s"} pass.`}</b>{" "}
              {nPass === 0
                ? `Every configuration fails all 3 seeds. The lowest worst-hour is ${clampPct(bestPeak?.peakShed)} of homes dark (${bestPeak?.label}).`
                : ""}
            </li>
            {A && (
              <li>
                <b>Day-1 notebook: {fmtHH(A.hh)} home-hours in the dark.</b> Collapses on {A.collapses ?? 0} of {A.seeds.length || 3} seeds; up to {minutes(A.below594s)} below 59.4 Hz.
              </li>
            )}
            {CB && A && (
              <li>
                <b>
                  Track B frozen notebook: {fmtHH(CB.hh)} ({fmtSignedPct(pctChange(A.hh, CB.hh))}).
                </b>{" "}
                {CB.collapses ? `${CB.collapses} collapses` : "No collapse"}, {minutes(CB.below594s)} below 59.4 Hz
                {(() => {
                  const lo = Math.min(...CB.seeds.map((s) => s.minFreq ?? 60));
                  return lo < 59.4 ? ` (lowest reading ${lo.toFixed(2)} Hz, for under a minute)` : "";
                })()}
                .
              </li>
            )}
            {CA && A && (
              <li>
                <b>
                  Track A frozen notebook: {fmtHH(CA.hh)} ({fmtSignedPct(pctChange(A.hh, CA.hh))}).
                </b>{" "}
                {CA.collapses ? `${CA.collapses} collapses` : "No collapse"}.
              </li>
            )}
            {B && A && (
              <li>
                <b>Telling the AI “this is Uri, February 2021” does not help: {fmtHH(B.hh)}</b> ({fmtSignedPct(pctChange(A.hh, B.hh))} vs Day 1). What the model knows from its
                training data is no substitute for the learned notebook.
              </li>
            )}
            {DB && CB && (
              <li>
                <b>
                  AI unplugged, Track B: {fmtHH(DB.hh)} vs {fmtHH(CB.hh)} with the AI.
                </b>{" "}
                With the frozen AI making decisions, home-hours are {Math.round((1 - (CB.hh ?? 0) / (DB.hh ?? 1)) * 100)}% lower than the notebook's rules alone.
                {DA && CA ? ` Track A: ${fmtHH(DA.hh)} unplugged vs ${fmtHH(CA.hh)} with the AI (${fmtSignedPct(pctChange(DA.hh, CA.hh))}); there the rules carry the knowledge.` : ""}
              </li>
            )}
            {T0 && T && (
              <li>
                <b>
                  The notebook transfers to another model. Gemma-3-27B: {fmtHH(T0.hh)} with the Day-1 notebook, {fmtHH(T.hh)} with the Track B notebook ({fmtSignedPct(pctChange(T0.hh, T.hh))}).
                </b>
              </li>
            )}
          </ul>
          <DotPlot rows={L.rows} base={A} open={open} setOpen={setOpen} />
          <p className="s-caption">
            Medians over 3 seeds; click a row for each seed. Worst hour = largest share of homes dark in any hour, capped at 100% (the simulator can report slightly more at
            total blackout). Open dots = the 3 seeds (a red dot is a seed where the grid collapsed); the vertical tick marks the Day-1 median. Registration <code>{L.registration ?? "–"}</code>
            {L.ranAt ? <>, run {L.ranAt.replace("T", " ")}</> : null}. API errors across all runs: {apiErr}.
          </p>
          <ExamTraces />
        </>
      )}
    </Section>
  );
}
