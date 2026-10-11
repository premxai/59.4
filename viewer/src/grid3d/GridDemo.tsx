// Demo route `?mode=grid`: two recorded replays side by side with a timeline, or a live run.
//   ?mode=grid                                   default B-track replays (Day 1 vs learned notebook)
//   &left=mission/x.json&right=replays/y.json    any replay under public/ (bare names = public/replays/)
//   &t=100  start hour · &speed=4  sim-hours per second · &autoplay=0 · &quality=low|medium|high
//   &single=1                                    one city only (the left replay)
//   &live=<run_id>[&api=http://host:8594]        consume the live server's SSE stream, then the exact replays
import { useEffect, useMemo, useRef, useState } from "react";
import { useClock } from "../lib/clock";
import { loadReplay, type Replay } from "../lib/replay";
import { frameFromLive, gridFramesFromReplay, newLiveCtx, sampleGridFrames, type LiveCtx, type LiveHourMsg } from "./adapters";
import { GridCity } from "./GridCity";
import { GridSplit } from "./GridSplit";
import type { GridFrame } from "./types";

const params = new URLSearchParams(location.search);
const DEFAULT_LEFT = "/mission/replay_B_heldout_west_gas_2018_0_day1.json";
const DEFAULT_RIGHT = "/mission/replay_B_heldout_west_gas_2018_0_final.json";
const API = (params.get("api") ?? `http://${location.hostname || "localhost"}:8594`).replace(/\/$/, "");
const SPEEDS = [1, 2, 4, 8];

function publicPath(p: string): string {
  if (/^https?:\/\//.test(p) || p.startsWith("/")) return p;
  if (!p.includes("/")) return `/replays/${p}`;
  return `/${p}`;
}

const TICK_TYPES = new Set(["shed_start", "ufls", "collapse", "gas_feedback", "freeze_off"]);

// ------------------------------------------------------------------ timeline
function Timeline({ max, ticks }: { max: number; ticks: { h: number; side: "l" | "r" }[] }) {
  const hour = useClock((s) => s.hour);
  const playing = useClock((s) => s.playing);
  const speed = useClock((s) => s.speed);
  const c = useClock.getState();
  return (
    <div className="g3-timeline">
      <button onClick={() => c.toggle()} title="Play / pause (space)">
        {playing ? "❚❚" : "▶"}
      </button>
      {SPEEDS.map((s) => (
        <button key={s} className={speed === s ? "on" : ""} onClick={() => c.setSpeed(s)} title={`${s} simulated hours per second`}>
          {s}h/s
        </button>
      ))}
      <div className="g3-track">
        {ticks.map((t, i) => (
          <i key={i} className={`g3-tick g3-tick-${t.side}`} style={{ left: `${(t.h / Math.max(1, max)) * 100}%` }} />
        ))}
        <input type="range" min={0} max={max} step={0.01} value={hour} onChange={(e) => c.setHour(Number(e.target.value))} aria-label="Hour" />
      </div>
      <div className="g3-hour">
        hour {Math.floor(hour)} / {max}
      </div>
    </div>
  );
}

function useDemoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.code !== "Space") return;
      const c = useClock.getState();
      if (e.code === "Space") {
        e.preventDefault();
        c.toggle();
      } else if (e.code === "ArrowRight") c.step(e.shiftKey ? 12 : 1);
      else if (e.code === "ArrowLeft") c.step(e.shiftKey ? -12 : -1);
      else if (/^Digit[1-4]$/.test(e.code)) c.setSpeed(SPEEDS[Number(e.code.slice(5)) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ------------------------------------------------------------------ replay mode
function ReplayDemo({ left, right, startHour }: { left: Replay; right: Replay | null; startHour?: number }) {
  const lf = useMemo(() => gridFramesFromReplay(left), [left]);
  const rf = useMemo(() => (right ? gridFramesFromReplay(right) : null), [right]);
  const max = Math.max(lf.length, rf?.length ?? 0) - 1;
  useEffect(() => {
    const c = useClock.getState();
    c.setMax(max);
    const t = startHour ?? Number(params.get("t") ?? 0);
    c.setHour(Number.isFinite(t) ? t : 0);
    const sp = Number(params.get("speed"));
    c.setSpeed(sp > 0 ? sp : 3);
    c.setPlaying(params.get("autoplay") !== "0");
  }, [max, startHour]);
  useDemoKeys();
  const hour = useClock((s) => s.hour);
  const L = sampleGridFrames(lf, hour);
  const R = rf ? sampleGridFrames(rf, hour) : null;
  const ticks = useMemo(() => {
    const out: { h: number; side: "l" | "r" }[] = [];
    const scan = (r: Replay, side: "l" | "r") => r.frames.forEach((f) => (f.events ?? []).some((e) => TICK_TYPES.has(String(e.type))) && out.push({ h: f.h, side }));
    scan(left, "l");
    if (right) scan(right, "r");
    return out;
  }, [left, right]);
  const scenario = left.meta.scenario_public;
  return (
    <div className="g3-demo">
      {R ? (
        <GridSplit
          left={L}
          right={R}
          leftLabel={left.meta.label || "Day 1 notebook"}
          rightLabel={right?.meta.label || "Learned notebook"}
          hours={max}
          scenario={scenario}
        />
      ) : (
        <div className="g3-split">
          <div className="g3-half">
            <GridCity frame={L} label={left.meta.label} sublabel={scenario} showTime />
          </div>
        </div>
      )}
      <Timeline max={max} ticks={ticks} />
    </div>
  );
}

// ------------------------------------------------------------------ live mode (SSE)
interface DoneMsg {
  type: "done";
  results?: Record<string, { replay?: string; verdict?: string }>;
}

function LiveDemo({ runId }: { runId: string }) {
  const frames = useRef<{ left: GridFrame[]; right: GridFrame[] }>({ left: [], right: [] });
  const ctx = useRef<Record<string, LiveCtx>>({ left: newLiveCtx(), right: newLiveCtx() });
  // "left"/"right" (compare runs) map directly; other labels (storm runs name the notebooks) by first appearance
  const sides = useRef<Record<string, "left" | "right">>({});
  const names = useRef<{ left?: string; right?: string }>({});
  const sideOf = (label: string): "left" | "right" => {
    if (label === "left" || label === "right") return label;
    const known = sides.current[label];
    if (known) return known;
    const side = Object.keys(sides.current).length === 0 ? "left" : "right";
    sides.current[label] = side;
    names.current[side] = label;
    return side;
  };
  const [, setVersion] = useState(0);
  const [status, setStatus] = useState<"connecting" | "live" | "done" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [replays, setReplays] = useState<{ left: Replay; right: Replay | null; at: number } | null>(null);
  useEffect(() => {
    const es = new EventSource(`${API}/api/stream/${encodeURIComponent(runId)}`);
    let finished = false;
    let raf = 0;
    const bump = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), setVersion((v) => v + 1)));
    };
    es.onopen = () => setStatus("live");
    es.onmessage = async (ev) => {
      let m: { type: string } & Record<string, unknown>;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.type === "hour") {
        const msg = m as unknown as LiveHourMsg;
        const side = sideOf(String(msg.label ?? "left"));
        const f = frameFromLive(msg, (ctx.current[side] ??= newLiveCtx()));
        frames.current[side][msg.h] = f;
        setStatus("live");
        bump();
      } else if (m.type === "done") {
        finished = true;
        es.close();
        setStatus("done");
        const done = m as unknown as DoneMsg;
        try {
          const labelFor = (side: "left" | "right") => Object.keys(sides.current).find((k) => sides.current[k] === side) ?? side;
          const name = (side: "left" | "right") => done.results?.[side]?.replay ?? done.results?.[labelFor(side)]?.replay;
          const ln = name("left") ?? Object.values(done.results ?? {})[0]?.replay;
          const rn = name("right");
          if (!ln) return;
          const [l, r] = await Promise.all([loadReplay(`${API}/api/replay/${ln}`), rn ? loadReplay(`${API}/api/replay/${rn}`) : Promise.resolve(null)]);
          const at = Math.max(frames.current.left.length, frames.current.right.length) - 1;
          setReplays({ left: l, right: r, at: Math.max(0, at) });
        } catch (e) {
          setError(`Run finished; could not load the full replays (${e instanceof Error ? e.message : e})`);
        }
      } else if (m.type === "error") {
        finished = true;
        es.close();
        setStatus("error");
        setError(String(m.error ?? "server error"));
      }
    };
    es.onerror = () => {
      if (finished) return;
      setStatus("error");
      setError(`Lost the live stream from ${API} (run ${runId}). Is scripts/live_server.py running?`);
      es.close();
    };
    return () => {
      finished = true;
      es.close();
      cancelAnimationFrame(raf);
    };
  }, [runId]);

  if (replays) return <ReplayDemo left={replays.left} right={replays.right} startHour={replays.at} />;
  const last = (a: GridFrame[]) => {
    for (let i = a.length - 1; i >= 0; i--) if (a[i]) return a[i];
    return null;
  };
  const L = last(frames.current.left);
  const R = last(frames.current.right);
  if (!L && !R) return <div className="g3-msg">{error ?? (status === "connecting" ? `Connecting to live run ${runId}…` : "Waiting for the first hour…")}</div>;
  return (
    <div className="g3-demo">
      <GridSplit left={L} right={R} leftLabel={names.current.left ?? "Day 1 notebook"} rightLabel={names.current.right ?? "Learned notebook"} />
      <div className="g3-live">{status === "live" ? "● LIVE" : status === "done" ? "DONE · loading full replay" : (error ?? status)}</div>
    </div>
  );
}

// ------------------------------------------------------------------ route
export default function GridDemo() {
  const live = params.get("live");
  const single = params.get("single") === "1";
  const leftName = publicPath(params.get("left") ?? DEFAULT_LEFT);
  const rightName = publicPath(params.get("right") ?? DEFAULT_RIGHT);
  const [replays, setReplays] = useState<{ left: Replay; right: Replay | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (live) return;
    let alive = true;
    Promise.all([loadReplay(leftName), single ? Promise.resolve(null) : loadReplay(rightName)])
      .then(([l, r]) => alive && setReplays({ left: l, right: r }))
      .catch((e) => alive && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      alive = false;
    };
  }, [live, leftName, rightName, single]);
  if (live) return <LiveDemo runId={live} />;
  if (error) return <div className="g3-msg">Could not load replays: {error}</div>;
  if (!replays) return <div className="g3-msg">Loading the storm…</div>;
  return <ReplayDemo left={replays.left} right={replays.right} />;
}
