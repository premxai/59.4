import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSite, useTrackX } from "./data";
import { useLite } from "./replays";

const HeroWorld = lazy(() => import("./HeroWorld"));

/** Mount the 3D only while the hero is on screen (and unmount a moment after it leaves). */
function useOnScreen<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let off: number | null = null;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (off != null) clearTimeout(off);
          off = null;
          setOn(true);
        } else if (off == null) off = window.setTimeout(() => setOn(false), 1500);
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (off != null) clearTimeout(off);
    };
  }, []);
  return [ref, on];
}

export function Hero() {
  const t = useTrackX();
  const data = useSite((s) => s.data);
  const [frameRef, onScreen] = useOnScreen<HTMLDivElement>();
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const no3d = new URLSearchParams(location.search).get("hero3d") === "0";
  const first = data?.mission.showcase[0]?.runs.final?.replay ?? data?.mission.showcase[0]?.runs.day1?.replay;
  const { replay } = useLite(first);
  if (!t || !data) return null;
  const model = replay?.meta.model;
  return (
    <section className="s-hero" aria-label="Introduction">
      <div className="s-wrap s-hero-grid">
        <div className="s-hero-text">
          <div className="s-kicker">59.4 · winter storms on the Texas grid</div>
          <h1 className="s-h1 s-thesis">Same frozen AI. It only rewrites its notebook.</h1>
          <p className="s-hero-sub">
            A frozen model runs the grid through winter storms; below 59.4 Hz for nine minutes, the grid trips. Each night a coach edits the notebook the model follows,
            and every chart on this page is drawn from the recorded runs
            {data.generatedAt ? <> (export {data.generatedAt.replace("T", " ")})</> : null}.
          </p>
          {model && (
            <p className="s-hero-model">
              Operator <code>{model.operator}</code> · weights {model.weights_frozen ? "frozen" : "not frozen"} · {model.fine_tune_runs ?? 0} fine-tune runs
            </p>
          )}
          <div className="s-hero-cta">
            <a className="s-btn s-btn-primary" href="?mode=stage">
              Break the grid live →
            </a>
            <a className="s-btn" href="?mode=mission">
              Pick a storm and compare →
            </a>
          </div>
        </div>
        <div className="s-hero-frame" ref={frameRef} aria-hidden>
          {!no3d && !reduce && onScreen ? (
            <Suspense fallback={<div className="s-hero-still" />}>
              <HeroWorld />
            </Suspense>
          ) : (
            <div className="s-hero-still" />
          )}
          <div className="s-hero-cap">Simulated grid, calm day · illustration</div>
        </div>
      </div>
    </section>
  );
}
