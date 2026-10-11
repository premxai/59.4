// Top bar: brand + tabs + honesty + ERCOT pill (row 1); status line + night transport + loop strip + track switch (row 2).
import { genOf, stepsOf, trackGens } from "./derive";
import { useCompare, useErcot, type ErcotReading } from "./live";
import { STAGES, notebookVersion, stageOf, type StageKey } from "./plain";
import { TABS, useMission, useTrack } from "./store";

function ErcotPill({ r }: { r: ErcotReading }) {
  return (
    <div className={`mc-ercot ${r.stale ? "mc-ercot-stale" : ""}`} title="Real public ERCOT data, read-only. The simulation never uses it.">
      <span className="mc-ercot-dot" />
      Texas right now: <b>{r.frequency_hz!.toFixed(2)} Hz</b>
      {typeof r.demand_mw === "number" && (
        <>
          {" "}
          · <b>{(r.demand_mw / 1000).toFixed(1)} GW</b>
        </>
      )}
      {r.stale && <span className="mc-ercot-note"> · last reading</span>}
    </div>
  );
}

function Honesty() {
  const h = useMission((s) => s.mission?.honesty);
  const hash = h?.sim_lock?.sim_hash?.replace(/^sha256:/, "").slice(0, 8);
  const exam = h?.locked_2021;
  return (
    <div className="mc-honesty">
      {hash && (
        <span title={`Simulator code fingerprint (sha256 of ${h?.sim_lock?.files?.length ?? "the"} simulator files): the coach cannot change the physics.`}>
          🔏 Simulator locked · <code>{hash}</code>
        </span>
      )}
      <span title="The real February 2021 storm is held back: it runs once, after the notebook is frozen.">
        Locked 2021 exam: <b>{exam?.run ? (exam.passed ? "passed" : "run · see Final exam") : "not yet run"}</b>
      </span>
    </div>
  );
}

export function LoopStrip() {
  const t = useTrack();
  const gen = useMission((s) => s.gen);
  const step = useMission((s) => s.step);
  const steps = stepsOf(t, gen);
  const cur = steps[step];
  const active: StageKey | null = cur ? stageOf(cur.type) : null;
  const done = new Set(steps.slice(0, Math.max(0, step)).map((s) => stageOf(s.type)));
  const hasReview = steps.some((s) => ["deep_sleep", "ab_test", "strategy_adopted", "strategy_reverted"].includes(s.type));
  return (
    <div className="mc-loop" aria-label="The nightly learning loop">
      {STAGES.map((st, i) => {
        const state = st.key === active ? "active" : done.has(st.key) ? "done" : st.every2 && !hasReview ? "skip" : "idle";
        return (
          <div key={st.key} className={`mc-stage mc-stage-${state} ${st.every2 ? "mc-stage-every2" : ""} ${i === 5 ? "mc-stage-first2" : ""}`}>
            {i === 5 && <span className="mc-stage-every">every 2 nights</span>}
            <span className="mc-stage-label">{st.label}</span>
            {i < STAGES.length - 1 && <span className="mc-stage-arrow">›</span>}
          </div>
        );
      })}
    </div>
  );
}

const NO_KEYS: string[] = [];

export function TopBar() {
  const tab = useMission((s) => s.tab);
  const setTab = useMission((s) => s.setTab);
  const trackKey = useMission((s) => s.track);
  const keys = useMission((s) => s.mission?.trackKeys ?? NO_KEYS);
  const setTrack = useMission((s) => s.setTrack);
  const gen = useMission((s) => s.gen);
  const playing = useMission((s) => s.playing);
  const togglePlay = useMission((s) => s.togglePlay);
  const goDay = useMission((s) => s.goDay);
  const goGen = useMission((s) => s.goGen);
  const restart = useMission((s) => s.restart);
  const load = useMission((s) => s.load);
  const loading = useMission((s) => s.loading);
  const error = useMission((s) => s.error);
  const generatedAt = useMission((s) => s.mission?.generated_at);
  const t = useTrack();
  const liveStatus = useCompare((s) => s.status);
  const ercot = useErcot();
  const gens = trackGens(t);
  const g = genOf(t, gen);
  const version = notebookVersion(t, g?.harness_id ?? (gen === gens[0] ? t?.lineage[0]?.id : undefined));
  const running = liveStatus === "streaming" || liveStatus === "starting";
  return (
    <header className="mc-top">
      <div className="mc-top-row">
        <div className="mc-brand">
          <span className="mc-logo">59.4</span>
          <span className="mc-brand-sub">
            a frozen AI learns to keep Texas lit
            <br />
            <span className="mc-brand-sub2">below 59.4 Hz for 9 minutes = the whole grid trips</span>
          </span>
        </div>
        <nav className="mc-tabs">
          {TABS.map((x) => (
            <button key={x.key} className={`mc-tab ${tab === x.key ? "mc-tab-on" : ""}`} onClick={() => setTab(x.key)}>
              {x.label}
            </button>
          ))}
        </nav>
        <div className="mc-top-right">
          <Honesty />
          {ercot && <ErcotPill r={ercot} />}
          <a className="mc-btn mc-stage-link" href="?mode=site" title="Open the Evidence site: every chart from the real traces">
            Evidence →
          </a>
          <a className="mc-btn mc-stage-link" href="?mode=stage" title="Open the Stage: break the grid with a hidden storm">
            Stage →
          </a>
          <button className="mc-btn mc-reload" onClick={() => load()} disabled={loading} title={`Reload the data file${generatedAt ? ` (exported ${generatedAt})` : ""}`}>
            {loading ? "Loading…" : "↻ Reload data"}
          </button>
        </div>
      </div>
      <div className="mc-top-row mc-status-row">
        <div className="mc-status">
          <span className={`mc-dot ${running ? "mc-dot-run" : playing ? "mc-dot-play" : ""}`} />
          <span className="mc-status-mode">{running ? "RUNNING" : "EVOLUTION REPLAY"}</span>
          <span className="mc-status-where">
            Track {trackKey} · Day {gen} · Notebook {version}
          </span>
        </div>
        <div className="mc-transport">
          <button className="mc-icon-btn" onClick={restart} title="Replay from Day 1">
            ⟲
          </button>
          <button className="mc-icon-btn" onClick={() => goDay(-1)} title="Previous day (shift+←)">
            ⏮
          </button>
          <button className={`mc-icon-btn mc-play ${playing ? "mc-play-on" : ""}`} onClick={togglePlay} title="Play the nights step by step (space)">
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="mc-icon-btn" onClick={() => goDay(1)} title="Next day (shift+→)">
            ⏭
          </button>
          <div className="mc-days">
            {gens.map((x) => (
              <button key={x} className={`mc-day ${x === gen ? "mc-day-on" : ""} ${x < gen ? "mc-day-past" : ""}`} onClick={() => goGen(x)} title={`Day ${x}`}>
                {x}
              </button>
            ))}
          </div>
        </div>
        <LoopStrip />
        <div className="mc-trackswitch" role="tablist">
          {keys.map((k) => (
            <button key={k} className={`mc-trackbtn ${k === trackKey ? "mc-trackbtn-on" : ""}`} onClick={() => setTrack(k)} title={k === "A" ? "Track A: in-storm skill only (equipment fixed)" : k === "B" ? "Track B: everything, including winter prep" : `Track ${k}`}>
              <b>{k}</b>
              <span>{k === "A" ? "in-storm skill" : k === "B" ? "+ winter prep" : ""}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <div className="mc-toast">Could not reload: {error}</div>}
    </header>
  );
}
