// Storm timeline: phase segments computed from the frames, intervention markers, scrubber, speed.
import { useRef, useState } from "react";
import { fmtLocal } from "../lib/replay";
import { PHASE_INFO, PHASE_ORDER, type Marker } from "./derive";
import { useDerived } from "./hooks";
import { SPEEDS, useStage } from "./store";

const KIND_LABEL: Record<Marker["kind"], string> = { ai: "AI decision", habit: "Notebook habit", limit: "Hard limit", alarm: "Alarm", memory: "Lesson" };

export function Timeline() {
  const { segments, markers } = useDerived();
  const hour = useStage((s) => Math.round(s.hour * 4) / 4);
  const playing = useStage((s) => s.playing);
  const speed = useStage((s) => s.speed);
  const autoPace = useStage((s) => s.autoPace);
  const status = useStage((s) => s.status);
  const intro = useStage((s) => s.intro);
  const total = useStage((s) => Math.max(s.left.frames.length, s.right.frames.length));
  const local = useStage((s) => s.right.frames[Math.min(s.right.frames.length - 1, Math.floor(s.hour))]?.localTime);
  const done = useStage((s) => s.streamDone);
  const bar = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; m: Marker } | null>(null);
  const idle = status === "idle" || intro != null;
  const max = Math.max(1, done ? total - 1 : Math.max(total - 1, 1));
  const span = Math.max(max, 1);
  const scrub = (x: number) => {
    const el = bar.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    useStage.getState().seek(((x - r.left) / r.width) * span);
  };
  const lt = local ? fmtLocal(local) : null;
  return (
    <div className={`st-timeline st-glass ${idle ? "st-timeline-idle" : ""}`}>
      <div className="st-tl-left">
        <span className="st-tl-title">Storm timeline</span>
        <button className="st-play" onClick={() => useStage.getState().togglePlay()} disabled={idle} title="Play / pause (space)">
          {playing ? "❚❚" : "▶"}
        </button>
      </div>
      <div className="st-tl-main">
        <div className="st-legend">
          {PHASE_ORDER.map((p) => (
            <span key={p} className={`st-leg st-tone-${PHASE_INFO[p].tone}`}>
              <i />
              {PHASE_INFO[p].label}
            </span>
          ))}
          <span className="st-leg st-leg-mark">
            <i />
            agent steps in
          </span>
        </div>
        <div
          className="st-track"
          ref={bar}
          onPointerDown={(e) => {
            if (idle) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            scrub(e.clientX);
          }}
          onPointerMove={(e) => e.buttons && !idle && scrub(e.clientX)}
        >
          <div className="st-segs">
            {segments.map((s) => (
              <i key={`${s.h0}`} className={`st-seg st-tone-${PHASE_INFO[s.phase].tone}`} style={{ left: `${(s.h0 / span) * 100}%`, width: `${((s.h1 - s.h0) / span) * 100}%` }} />
            ))}
          </div>
          <div className="st-marks">
            {markers.map((m) => (
              <i
                key={`${m.h}|${m.kind}`}
                className={`st-mark st-mark-${m.kind} ${m.h <= hour ? "st-mark-past" : ""}`}
                style={{ left: `${(m.h / span) * 100}%` }}
                onPointerEnter={(e) => setTip({ x: (e.currentTarget as HTMLElement).offsetLeft, m })}
                onPointerLeave={() => setTip(null)}
              />
            ))}
          </div>
          {!idle && <div className="st-head" style={{ left: `${(Math.min(hour, span) / span) * 100}%` }} />}
          {tip && (
            <div className="st-tip" style={{ left: tip.x }}>
              <b>
                {KIND_LABEL[tip.m.kind]} · hour {tip.m.h}
              </b>
              <span>{tip.m.text}</span>
            </div>
          )}
        </div>
      </div>
      <div className="st-tl-right">
        <div className="st-clock">
          {idle ? (
            <span className="st-dim">ready</span>
          ) : (
            <>
              <b>day {Math.floor(hour / 24) + 1}</b>
              <span>
                {lt ? lt.time : ""} · hour {Math.floor(hour)}
              </span>
            </>
          )}
        </div>
        <div className="st-speeds" role="group" aria-label="Playback speed">
          <button className={autoPace ? "st-on" : ""} onClick={() => useStage.getState().setAutoPace(!autoPace)} title="Auto pace: quiet hours play faster, the crisis slower">
            auto
          </button>
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? "st-on" : ""} onClick={() => useStage.getState().setSpeed(s)} title={`${s} simulated hours per second`}>
              {s}h/s
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
