import { useEffect, useRef } from "react";
import { SPEEDS, useClock } from "../lib/clock";
import { useQuality } from "../lib/quality";

/** space = play/pause · ←/→ = scrub 1 h (shift: 6 h) · 1–9 = speed · Home = restart */
export function useKeyboard(extra?: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = useClock.getState();
      if (e.code === "Space") {
        e.preventDefault();
        c.toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        c.step(e.shiftKey ? 6 : 1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        c.step(e.shiftKey ? -6 : -1);
      } else if (e.code === "Home") {
        c.setHour(0);
      } else if (e.code === "End") {
        c.setHour(c.maxHour);
      } else if (/^Digit[1-9]$/.test(e.code)) {
        c.setSpeed(SPEEDS[Number(e.code.slice(5)) - 1]);
      }
      extra?.(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [extra]);
}

export function Timeline() {
  const hour = useClock((s) => s.hour);
  const max = useClock((s) => s.maxHour);
  const playing = useClock((s) => s.playing);
  const speed = useClock((s) => s.speed);
  const bar = useRef<HTMLDivElement>(null);
  const scrub = (clientX: number) => {
    const el = bar.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    useClock.getState().setHour(((clientX - r.left) / r.width) * max);
  };
  return (
    <div className="timeline">
      <div className="tl-state">{playing ? "❚❚" : "▶"}</div>
      <div
        className="tl-bar"
        ref={bar}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          scrub(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) scrub(e.clientX);
        }}
      >
        <div className="tl-fill" style={{ width: `${max ? (hour / max) * 100 : 0}%` }} />
      </div>
      <div className="tl-info">
        hour {Math.floor(hour)} / {max} · {speed} h/s
      </div>
      <div className="tl-keys">space play · ←/→ scrub · 1–9 speed</div>
    </div>
  );
}

/** Dev-only (or ?fps=1) readout of the adaptive quality tier. */
export function QualityReadout() {
  const tier = useQuality((s) => s.tier);
  const auto = useQuality((s) => s.auto);
  const fps = useQuality((s) => s.fps);
  const show = import.meta.env.DEV || new URLSearchParams(location.search).get("fps") === "1";
  if (!show) return null;
  return (
    <div className="quality-readout">
      {tier} · {fps || "…"} fps{auto ? " · auto" : " · fixed"}
    </div>
  );
}
