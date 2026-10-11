// OVERVIEW tab (live first): pick a storm + two notebooks → both cities run side by side hour by hour
// from the live stream, each with its own gauges and its own "what the AI saw and did" feed. The
// right column keeps the agent visibly working: the right notebook's genome, the current idea and
// the coach's night. The recorded showcase is only an offline fallback, labeled "offline replay".
import { useEffect, useMemo, useState } from "react";
import { useClock } from "../lib/clock";
import type { Replay } from "../lib/replay";
import { fmtHomes } from "../lib/replay";
import { CityView, HAS_GRID3D, type CityEngine } from "./CityView";
import { CompareBar } from "./CompareBar";
import { CurrentIdea } from "./CurrentIdea";
import { countsOf, showcaseFor, winterForNotebook } from "./derive";
import { SideGauges } from "./Gauges";
import { Genome } from "./Genome";
import { idleReplay, useCompare, type LiveResult, type LiveStep } from "./live";
import { StormBar, useOfflineReplays, type CityMode } from "./MissionCity";
import { fmtBig } from "./plain";
import { SideSteps } from "./SideSteps";
import { StepsFeed } from "./StepsFeed";
import { useMission } from "./store";
import type { Counts } from "./types";
import { ErrorBoundary, Panel } from "./ui";

type ViewMode = "idle" | "live" | "final" | "offline";

interface View {
  mode: ViewMode;
  left: Replay;
  right: Replay;
  leftSteps: LiveStep[];
  rightSteps: LiveStep[];
  leftRaw?: Record<string, unknown>[];
  rightRaw?: Record<string, unknown>[];
  leftAction?: string | null;
  rightAction?: string | null;
  title: string;
  leftId?: string;
  rightId?: string;
  results?: Partial<Record<"left" | "right", LiveResult>>;
}

const peakDark = (r: Replay) => r.meta.totals?.peak_homes_dark ?? Math.max(0, ...r.frames.map((f) => f.homes_dark ?? 0));
const totalDark = (r: Replay) => r.meta.totals?.homes_dark_hours ?? r.frames.reduce((a, f) => a + (f.homes_dark ?? 0), 0);

function ResultBanner({ v }: { v: View }) {
  const res = v.results;
  if (!res || (!res.left && !res.right)) return null;
  const side = (k: "left" | "right", r: Replay) => {
    const x = res[k];
    if (!x) return null;
    const worst = x.peak_shed_frac != null ? Math.round(x.peak_shed_frac * 100) : null;
    return (
      <div className={`mc-result ${x.passed ? "mc-result-pass" : "mc-result-fail"}`}>
        <div className="mc-result-head">
          <b>{x.passed ? "✓ Passed" : "✗ Failed"}</b> · {r.meta.label}
        </div>
        <div className="mc-result-sub">
          {x.collapsed ? "total blackout" : worst != null ? `worst moment ${worst}% of homes dark` : (x.verdict ?? "")} · {fmtBig(x.homes_dark_hours ?? totalDark(r))} home-hours dark
        </div>
      </div>
    );
  };
  const dPeak = peakDark(v.left) - peakDark(v.right);
  const lh = res.left?.homes_dark_hours ?? totalDark(v.left);
  const rh = res.right?.homes_dark_hours ?? totalDark(v.right);
  const better = dPeak > 0 ? v.right.meta.label : dPeak < 0 ? v.left.meta.label : null;
  return (
    <div className="mc-results">
      {side("left", v.left)}
      <div className="mc-result-diff">
        {better ? (
          <>
            <b>{better}</b> kept <b className="mc-good">{fmtHomes(Math.abs(dPeak))}</b> more homes powered at the worst hour
            {lh > 0 && rh >= 0 && <span className="mc-dim"> · {Math.round((Math.abs(lh - rh) / Math.max(lh, rh)) * 100)}% {rh < lh ? "fewer" : "more"} home-hours dark</span>}
          </>
        ) : (
          <span className="mc-dim">Same worst hour on both sides</span>
        )}
      </div>
      {side("right", v.right)}
    </div>
  );
}

export function Overview() {
  const mission = useMission((s) => s.mission);
  const trackKey = useMission((s) => s.track);
  const catalog = useCompare((s) => s.catalog);
  const catalogStatus = useCompare((s) => s.catalogStatus);
  const fetchCatalog = useCompare((s) => s.fetchCatalog);
  const applyDefaults = useCompare((s) => s.applyDefaults);
  const sel = useCompare((s) => s.sel);
  const status = useCompare((s) => s.status);
  const sides = useCompare((s) => s.sides);
  const finals = useCompare((s) => s.finals);
  const results = useCompare((s) => s.results);
  const labels = useCompare((s) => s.labels);
  const showOffline = useCompare((s) => s.showOffline);
  const start = useCompare((s) => s.start);
  useCompare((s) => s.version); // re-render as live frames arrive
  const [mode, setMode] = useState<CityMode>("split");
  const [engine, setEngine] = useState<CityEngine>(HAS_GRID3D ? "grid" : "cinematic");

  useEffect(() => {
    fetchCatalog();
    const id = setInterval(() => useCompare.getState().status === "idle" && fetchCatalog(), 60_000);
    return () => clearInterval(id);
  }, [fetchCatalog]);
  const preferStorm = showcaseFor(mission, trackKey)?.scenario_id;
  useEffect(() => {
    if (catalog) applyDefaults(trackKey, preferStorm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog != null, trackKey]);

  const running = status === "starting" || status === "streaming";
  const hasRun = !!sides && status !== "idle" && status !== "starting";
  const wantOffline = !running && (catalogStatus === "offline" || showOffline);
  const { offline, error: offlineError } = useOfflineReplays(wantOffline);

  const labelOf = (id: string) => catalog?.notebooks.find((n) => n.id === id)?.label ?? (id || "notebook");
  const idleL = useMemo(() => idleReplay(labelOf(sel.left)), [sel.left, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const idleR = useMemo(() => idleReplay(labelOf(sel.right)), [sel.right, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const waitL = useMemo(() => idleReplay(labels.left), [labels.left]);
  const waitR = useMemo(() => idleReplay(labels.right), [labels.right]);
  const runId = useCompare((s) => s.runId);

  let v: View;
  if (wantOffline && offline) {
    v = {
      mode: "offline",
      left: offline.left,
      right: offline.right,
      leftSteps: offline.leftSteps,
      rightSteps: offline.rightSteps,
      title: offline.title,
      leftId: offline.left.meta.harness?.id,
      rightId: offline.right.meta.harness?.id,
      results:
        offline.leftRun || offline.rightRun
          ? {
              left: offline.leftRun ? { passed: offline.leftRun.passed, verdict: offline.leftRun.verdict, homes_dark_hours: offline.leftRun.homes_dark_hours ?? undefined } : undefined,
              right: offline.rightRun ? { passed: offline.rightRun.passed, verdict: offline.rightRun.verdict, homes_dark_hours: offline.rightRun.homes_dark_hours ?? undefined } : undefined,
            }
          : undefined,
    };
  } else if (hasRun && sides && !((finals.left ?? sides.left.replay).frames.length && (finals.right ?? sides.right.replay).frames.length)) {
    // streaming, but a side has no hour yet: keep the calm city until both sides have data
    v = { mode: "idle", left: waitL, right: waitR, leftSteps: sides.left.steps, rightSteps: sides.right.steps, title: "Running live · waiting for the first hour…", leftId: sel.left, rightId: sel.right };
  } else if (hasRun && sides) {
    const done = status === "done";
    v = {
      mode: done ? "final" : "live",
      left: finals.left ?? sides.left.replay,
      right: finals.right ?? sides.right.replay,
      leftSteps: sides.left.steps,
      rightSteps: sides.right.steps,
      leftRaw: finals.left ? undefined : sides.left.raw,
      rightRaw: finals.right ? undefined : sides.right.raw,
      leftAction: sides.left.action,
      rightAction: sides.right.action,
      title: `${sides.left.replay.meta.scenario_public ?? "Storm"} · ${done ? "finished run (scrub to replay)" : "running live"}`,
      leftId: results?.left?.notebook ?? sel.left,
      rightId: results?.right?.notebook ?? sel.right,
      results: done ? (results ?? undefined) : undefined,
    };
  } else {
    v = { mode: "idle", left: idleL, right: idleR, leftSteps: [], rightSteps: [], title: "Ready: pick a storm and two notebooks", leftId: sel.left, rightId: sel.right };
  }

  // idle = a still, calm city (no clock); offline/final loop, live follows the stream edge
  useEffect(() => {
    if (v.mode !== "idle") return;
    const c = useClock.getState();
    c.setPlaying(false);
    c.setMax(0);
    c.setHour(0);
  }, [v.mode]);

  const nb = (id?: string) => catalog?.notebooks.find((n) => n.id === id);
  const countsFor = (id?: string): Counts | undefined => (nb(id)?.counts as Counts | undefined) ?? countsOf(mission, id);
  const rightCounts = countsFor(v.rightId);
  const leftCounts = countsFor(v.leftId);
  const winterL = winterForNotebook(mission, v.leftId, leftCounts?.build_items);
  const winterR = winterForNotebook(mission, v.rightId, rightCounts?.build_items);
  const leftLabel = v.mode === "live" || v.mode === "final" ? labels.left : v.left.meta.label;
  const rightLabel = v.mode === "live" || v.mode === "final" ? labels.right : v.right.meta.label;
  const short = (s: string) => s.replace(/^Track \w+ · /, "");

  return (
    <div className="mc-overview">
      <div className="mc-ov-left">
        <CompareBar />
        <div className="mc-city-wrap">
          <ErrorBoundary label="The city" key={`${v.mode}:${runId ?? "none"}:${v.left.file}`}>
            <CityView
              engine={engine}
              left={v.left}
              right={v.right}
              leftRaw={v.leftRaw}
              rightRaw={v.rightRaw}
              mode={mode}
              idle={v.mode === "idle"}
              loop={v.mode === "offline" || v.mode === "final"}
              winterLeft={winterL}
              winterRight={winterR}
            />
          </ErrorBoundary>
          {v.mode === "offline" && <div className="mc-offline-badge">OFFLINE REPLAY · recorded earlier</div>}
          {wantOffline && !offline && <div className="mc-idle-cta mc-dim">{offlineError ? `Offline replay could not load: ${offlineError}` : "Loading the offline replay…"}</div>}
          {v.mode === "idle" && (status === "starting" || status === "streaming") && (
            <div className="mc-idle-cta">
              <div className="mc-idle-vs">
                <span>{short(labels.left)}</span>
                <i>vs</i>
                <span>{short(labels.right)}</span>
              </div>
              <div className="mc-pulse">Starting the AI on both notebooks… the first hour is on its way</div>
            </div>
          )}
          {v.mode === "idle" && status !== "starting" && status !== "streaming" && !wantOffline && catalog && (
            <div className="mc-idle-cta">
              <div className="mc-idle-vs">
                <span>{short(labelOf(sel.left))}</span>
                <i>vs</i>
                <span>{short(labelOf(sel.right))}</span>
              </div>
              <button className="mc-run mc-run-big" onClick={() => start()} disabled={!sel.storm || !sel.left || !sel.right}>
                ▶ Run live
              </button>
              <div className="mc-dim">same storm, same frozen AI, two different notebooks</div>
            </div>
          )}
          {HAS_GRID3D && (
            <div className="mc-engine mc-seg">
              <button className={`mc-seg-btn ${engine === "grid" ? "mc-seg-on" : ""}`} onClick={() => setEngine("grid")}>
                3D grid
              </button>
              <button className={`mc-seg-btn ${engine === "cinematic" ? "mc-seg-on" : ""}`} onClick={() => setEngine("cinematic")}>
                Cinematic
              </button>
            </div>
          )}
        </div>
        <StormBar title={v.title} replay={v.mode === "idle" ? null : v.right} mode={mode} setMode={setMode} live={v.mode === "live"} />
        <ResultBanner v={v} />
        <div className="mc-sides">
          {(["left", "right"] as const).map((k) => {
            const r = k === "left" ? v.left : v.right;
            return (
              <div className="mc-side" key={k}>
                <ErrorBoundary label="Gauges">
                  <SideGauges replay={r} other={k === "right" ? v.left : undefined} otherLabel={short(leftLabel)} idle={v.mode === "idle"} />
                </ErrorBoundary>
                <SideSteps
                  steps={k === "left" ? v.leftSteps : v.rightSteps}
                  followLive={v.mode === "live"}
                  action={k === "left" ? v.leftAction : v.rightAction}
                  label={short(k === "left" ? leftLabel : rightLabel)}
                  empty={
                    v.mode === "idle"
                      ? running
                        ? "Waiting for the first hours…"
                        : "Waiting for ▶ Run live."
                      : v.mode === "live"
                        ? "Waiting for the first hours…"
                        : (k === "left" ? v.leftSteps : v.rightSteps).length
                          ? "Steps appear as the replay plays…"
                          : "No steps recorded for this run."
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mc-ov-right">
        <Panel title="Operator genome" className="mc-genome-panel" right={<span className="mc-dim">{short(rightLabel)}</span>}>
          <ErrorBoundary label="Genome">
            <Genome notebookId={v.rightId} label={short(rightLabel)} counts={rightCounts} compareCounts={leftCounts} compareLabel={short(leftLabel)} track={nb(v.rightId)?.track} />
          </ErrorBoundary>
        </Panel>
        <ErrorBoundary label="Current idea">
          <CurrentIdea />
        </ErrorBoundary>
        <ErrorBoundary label="Coach's night">
          <StepsFeed />
        </ErrorBoundary>
      </div>
    </div>
  );
}
