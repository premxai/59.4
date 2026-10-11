// EVOLUTION, FINAL EXAM and MEMORY tabs.
import { useMemo, useState } from "react";
import { CoachL2 } from "./CoachL2";
import { useCompare } from "./live";
import { ManualMap } from "./ManualMap";
import { obj } from "./normalize";
import { fmtBig, nightNumber, notebookVersion, organMeta, stormLabel } from "./plain";
import { ScoreHero } from "./ScoreHero";
import { useMission, useTrack } from "./store";
import { TearOut } from "./TearOut";
import { EvolutionTimeline } from "./Timeline";
import type { ManualPage, Track } from "./types";
import { Empty, ErrorBoundary, Panel } from "./ui";

// ------------------------------------------------------------------ EVOLUTION
export function Evolution() {
  return (
    <div className="mc-evo">
      <ErrorBoundary label="Scoreboard">
        <ScoreHero />
      </ErrorBoundary>
      <Panel title="Notebook evolution" className="mc-evo-tl" right={<span className="mc-dim">one column per day · ▶ in the top bar replays the nights</span>}>
        <ErrorBoundary label="Timeline">
          <EvolutionTimeline />
        </ErrorBoundary>
      </Panel>
      <div className="mc-evo-bottom">
        <Panel title="Notebook map" className="mc-evo-map" right={<span className="mc-dim">kept ideas stay · rejected ones dissolve</span>}>
          <ErrorBoundary label="Notebook map">
            <ManualMap />
          </ErrorBoundary>
        </Panel>
        <div className="mc-evo-side">
          <ErrorBoundary label="Tear out a page">
            <TearOut />
          </ErrorBoundary>
          <Panel title="The coach improving itself" className="mc-evo-l2" right={<span className="mc-dim">level 2</span>}>
            <ErrorBoundary label="Coach panel">
              <CoachL2 />
            </ErrorBoundary>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ FINAL EXAM
const EXAM_ROWS: { key: string; who: string; note: string }[] = [
  { key: "A", who: "Day-1 notebook", note: "storm anonymized" },
  { key: "B", who: "Day-1 notebook", note: "told it's February 2021" },
  { key: "C", who: "Learned notebook", note: "the frozen final notebook" },
  { key: "D", who: "Learned notebook, AI unplugged", note: "only the notebook's own rules act" },
  { key: "T0", who: "Another AI (Gemma) + Day-1 notebook", note: "does the notebook transfer?" },
  { key: "T", who: "Another AI (Gemma) + learned notebook", note: "same notebook, different AI" },
];

function fmtSecs(s: unknown): string {
  if (typeof s !== "number") return "–";
  const v = Math.round(s);
  return `${Math.floor(v / 60)} min ${String(v % 60).padStart(2, "0")} s`;
}

export function FinalExam() {
  const h = useMission((s) => s.mission?.honesty);
  const setTab = useMission((s) => s.setTab);
  const setSel = useCompare((s) => s.setSel);
  const exam = obj(h?.locked_2021);
  const rows = obj(exam.rows);
  const ran = exam.run === true;
  return (
    <div className="mc-exam">
      <Panel title="Final exam" className="mc-exam-main" right={<span className={ran ? "mc-good" : "mc-dim"}>{ran ? "run" : "not yet run"}</span>}>
        <div className="mc-exam-lead">
          <div className="mc-exam-title">Locked 2021 storm — runs once, after the notebook is frozen</div>
          <div className="mc-exam-sub">
            The real February 2021 storm. Texas stayed below <b>59.4 Hz</b> for <b>4 min 23 s</b>; nine minutes would have tripped the whole grid. The coach never sees this storm; every
            notebook below is frozen before it runs.
            {typeof exam.notebook_hash === "string" && (
              <>
                {" "}
                Frozen notebook: <code>{String(exam.notebook_hash).replace(/^sha256:/, "").slice(0, 12)}</code>
              </>
            )}
          </div>
        </div>
        <table className="mc-exam-table">
          <thead>
            <tr>
              <th />
              <th>Who runs the grid</th>
              <th>Result</th>
              <th>Worst moment</th>
              <th>Homes dark</th>
              <th>Below 59.4 Hz</th>
              <th>Blackout</th>
            </tr>
          </thead>
          <tbody>
            {EXAM_ROWS.map((r) => {
              const x = obj(rows[r.key]);
              const has = Object.keys(x).length > 0;
              return (
                <tr key={r.key} className={has ? "" : "mc-exam-empty"}>
                  <td className="mc-exam-key">{r.key}</td>
                  <td>
                    <div className="mc-exam-who">{r.who}</div>
                    <div className="mc-dim">{r.note}</div>
                  </td>
                  <td>{has ? (x.passed === true ? <b className="mc-good">✓ passed</b> : x.passed === false ? <b className="mc-bad">✗ failed</b> : "–") : <span className="mc-dim">tomorrow</span>}</td>
                  <td>{typeof x.peak_shed_frac === "number" ? `${Math.round(x.peak_shed_frac * 100)}% dark` : typeof x.verdict === "string" ? x.verdict : "–"}</td>
                  <td>{typeof x.homes_dark_hours === "number" ? `${fmtBig(x.homes_dark_hours)} home-hours` : "–"}</td>
                  <td>{fmtSecs(x.below_59_4_s ?? x.seconds_below_59_4)}</td>
                  <td>{x.collapsed === true ? <b className="mc-bad">yes</b> : x.collapsed === false ? "no" : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <Panel title="The judge's storm" className="mc-exam-judge">
        <p>Make your own storm and run it live: the same frozen AI with two notebooks, side by side, hour by hour.</p>
        <button
          className="mc-run mc-run-big"
          onClick={() => {
            setSel({ storm: "custom" });
            setTab("overview");
          }}
        >
          ⛈ Make your own storm
        </button>
        <p className="mc-dim">Opens the Overview with the storm sliders (colder, longer, where, extra demand, freezing rain).</p>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ MEMORY
const quotedTitle = (s: string) => /[“"]([^”"]+)[”"]/.exec(s)?.[1] ?? s.replace(/^Remembers:?\s*/i, "").replace(/\s*\(from MongoDB\)\s*$/i, "");

function PageCard({ t, p }: { t: Track; p: ManualPage }) {
  const open = useMission((s) => s.openInspect);
  const o = organMeta(p.organ);
  const night = p.generation != null ? nightNumber(t, p.generation) : null;
  return (
    <button className="mc-page" onClick={() => open({ kind: "page", track: t.key, page: p })} style={{ ["--organ" as string]: o.color }}>
      <div className="mc-page-title">{p.title}</div>
      <div className="mc-page-text">{p.text}</div>
      <div className="mc-page-meta">
        <span className="mc-chip" style={{ borderColor: o.color, color: o.color }}>
          {o.icon} {o.label}
        </span>
        <span>{night != null ? `written on Night ${night}` : "written by the coach"}</span>
        <span>{p.scenario_id ? `learned from ${stormLabel(p.scenario_id)}` : night === 0 ? "from general knowledge (no failure yet)" : ""}</span>
      </div>
      <div className="mc-page-ids">
        MongoDB <code>manual_pages/{p.id}</code>
        {p.harness_id && (
          <>
            {" "}
            · notebook <code>{p.harness_id}</code> ({notebookVersion(t, p.harness_id)})
          </>
        )}
      </div>
    </button>
  );
}

export function Memory() {
  const m = useMission((s) => s.mission);
  const t = useTrack();
  const sides = useCompare((s) => s.sides);
  const labels = useCompare((s) => s.labels);
  const [all, setAll] = useState(false);
  const recalls = useMemo(() => {
    const runs: { label: string; steps: { h: number; type: string; text: string }[] }[] = [];
    if (sides) {
      runs.push({ label: `Live run · ${labels.left}`, steps: sides.left.steps });
      runs.push({ label: `Live run · ${labels.right}`, steps: sides.right.steps });
    }
    for (const sc of m?.showcase ?? []) for (const [k, r] of Object.entries(sc.runs)) if (r) runs.push({ label: `Offline replay · Track ${sc.track} · ${k === "final" ? "learned notebook" : k === "day1" ? "Day-1 notebook" : k} · ${stormLabel(sc.scenario_id)}`, steps: r.steps });
    return runs
      .map((run) => {
        const by = new Map<string, number[]>();
        for (const s of run.steps) if (s.type === "memory_recall" || s.type === "recall") {
          const k = quotedTitle(s.text);
          by.set(k, [...(by.get(k) ?? []), s.h]);
        }
        return { label: run.label, pages: [...by.entries()].map(([title, hours]) => ({ title, hours })).sort((a, b) => b.hours.length - a.hours.length) };
      })
      .filter((r) => r.pages.length);
  }, [m, sides, labels, sides?.left.steps.length, sides?.right.steps.length]);
  if (!m || !t) return <Empty>Loading the mission data…</Empty>;
  const tracks = all ? m.trackKeys.map((k) => m.tracks[k]) : [t];
  return (
    <div className="mc-memory">
      <Panel
        title="Lesson pages in MongoDB"
        className="mc-mem-pages"
        right={
          <label className="mc-check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all tracks
          </label>
        }
      >
        {tracks.every((x) => !x.pages.length) ? (
          <Empty>No lesson pages written yet.</Empty>
        ) : (
          tracks.map((x) => (
            <div key={x.key} className="mc-mem-track">
              {all && <div className="mc-mem-trackname">Track {x.key}</div>}
              <div className="mc-pages">
                {x.pages.map((p) => (
                  <PageCard key={p.id} t={x} p={p} />
                ))}
              </div>
            </div>
          ))
        )}
      </Panel>
      <Panel title="When the AI recalled them" className="mc-mem-recalls" right={<span className="mc-dim">🧠 memory recalls during storms</span>}>
        {!recalls.length ? (
          <Empty>No memory recalls recorded yet (run a storm on the Overview).</Empty>
        ) : (
          recalls.map((r) => (
            <div key={r.label} className="mc-recall-run">
              <div className="mc-recall-label">{r.label}</div>
              {r.pages.map((p) => {
                const maxH = Math.max(1, ...p.hours);
                return (
                  <div key={p.title} className="mc-recall">
                    <div className="mc-recall-title">
                      🧠 “{p.title}” <span className="mc-dim">· recalled {p.hours.length}× · hours {Math.min(...p.hours)}–{maxH}</span>
                    </div>
                    <div className="mc-recall-strip">
                      {p.hours.map((hh, i) => (
                        <i key={i} style={{ left: `${(hh / Math.max(maxH, 312)) * 100}%` }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}
