// Stage (?mode=stage): the hero demo screen. One clay diorama of the grid driven by the simulator,
// the frozen AI at work on the right, a Day-1 picture-in-picture, KPIs + storm timeline below.
//   keys: B = break the grid · space = play/pause · ←/→ = ±6 h · 0–5 = areas · Esc = overview · M = Mission Control
import { useCallback, useEffect, useRef, useState } from "react";
import type { AreaKey } from "../grid3d/areas";
import type { ViewInset } from "../grid3d/Scene";
import { AgentPanel } from "./AgentPanel";
import { usePhaseNow } from "./hooks";
import { Intro, Notice, VerdictCard } from "./Overlays";
import { AreaCard, AreaSwitcher, Kpis, PhaseBanner, SWITCH_KEYS, TopBar } from "./Panels";
import { useStage } from "./store";
import { Timeline } from "./Timeline";
import { MainWorld, Pip } from "./World";
import type { Phase } from "./derive";
import "./stage.css";

function useViewport() {
  const [s, setS] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setS({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return s;
}

/** Where the camera goes for each storm phase when "Follow the storm" is on. */
function directorTarget(phase: Phase, hint: AreaKey | null, action: string | null): AreaKey | null {
  switch (phase) {
    case "approaching":
      return null;
    case "struggling":
      return hint === "wind" ? "wind" : hint === "field" ? "field" : "plants";
    case "critical":
      return "town";
    case "acting":
      return action && /keep gas facilities/i.test(action) && !/bring .* back/i.test(action) ? "compressor" : "town";
    case "recovery":
      return "town";
    default:
      return null;
  }
}

export default function StageApp() {
  const vp = useViewport();
  const [focus, setFocusState] = useState<AreaKey | null>(null);
  const [auto, setAuto] = useState(() => new URLSearchParams(location.search).get("follow") !== "0");
  const userAt = useRef(-1e9);
  const autoAt = useRef(-1e9);
  const intro = useStage((s) => s.intro);
  const hint = useStage((s) => s.hint);
  const runs = useStage((s) => s.runs);
  const status = useStage((s) => s.status);
  const phase = usePhaseNow();
  const [noblur, setNoblur] = useState(() => new URLSearchParams(location.search).get("glass") === "0");

  useEffect(() => {
    document.title = "59.4 · Stage";
    const q = new URLSearchParams(location.search);
    useStage
      .getState()
      .init()
      .then(() => {
        if (q.get("autostart") === "1" && useStage.getState().status === "idle") useStage.getState().breakGrid();
      });
    const id = setInterval(() => {
      const s = useStage.getState();
      if (s.online !== "online" && s.status === "idle") s.init();
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const setFocus = useCallback((a: AreaKey | null) => {
    userAt.current = performance.now();
    setFocusState(a);
  }, []);

  // intro: once the overlay lifts, glide into the affected area, then let the director take over
  useEffect(() => {
    if (intro != null || status === "idle" || !hint) return;
    setFocusState(hint);
    autoAt.current = performance.now() + 2500;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro, runs]);
  useEffect(() => {
    if (intro === 0) setFocusState(null);
  }, [intro]);

  // director: follow the storm phase (never fights a recent user click)
  useEffect(() => {
    if (!auto || !phase || intro != null) return;
    const now = performance.now();
    if (now - userAt.current < 15000) return;
    const s = useStage.getState();
    const h = Math.floor(s.hour);
    const target = directorTarget(phase, s.hint, s.right.actions[h] ?? null);
    const wait = Math.max(0, 6500 - (now - autoAt.current));
    const id = setTimeout(() => {
      if (performance.now() - userAt.current < 15000) return;
      autoAt.current = performance.now();
      setFocusState(target);
    }, wait);
    return () => clearTimeout(id);
  }, [phase, auto, intro]);
  // the end: pull back to the overview for the verdict
  const ended = useStage((s) => s.ended);
  useEffect(() => {
    if (ended) setFocusState(null);
  }, [ended]);

  // keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = useStage.getState();
      if (e.code === "Space") {
        e.preventDefault();
        (e.target as HTMLElement | null)?.blur?.();
        s.togglePlay();
      } else if (e.code === "KeyB") s.breakGrid();
      else if (e.code === "ArrowRight") s.seek(s.hour + 6);
      else if (e.code === "ArrowLeft") s.seek(s.hour - 6);
      else if (e.code === "Escape") setFocus(null);
      else if (e.code === "KeyM") location.search = "?mode=mission";
      else if (/^Digit[0-5]$/.test(e.code)) setFocus(SWITCH_KEYS[Number(e.code.slice(5))]?.key ?? null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus]);

  // panels sit over the 3D view; the camera frames the diorama in the space between them
  const compact = vp.w < 1500;
  const inset: ViewInset = {
    top: compact ? 118 : 138,
    right: compact ? 330 : 400,
    bottom: compact ? 170 : 196,
    left: compact ? 150 : 190,
  };

  const slow = useRef(0);
  const onFps = useCallback((fps: number) => {
    // backdrop blur over a WebGL canvas is the costliest thing on an iGPU: drop it when the frame rate sags
    // for ~2 s (a throttled background window reports ~1 fps: that is not the GPU, ignore it)
    if (fps >= 8 && fps < 32 && !document.hidden) slow.current++;
    else slow.current = 0;
    if (slow.current >= 4) setNoblur(true);
  }, []);

  return (
    <div className={`st ${compact ? "st-compact" : ""} ${noblur ? "st-noblur" : ""}`}>
      <MainWorld focus={focus} onPick={setFocus} inset={inset} onFps={onFps} />
      <TopBar />
      <PhaseBanner />
      <div className="st-left">
        <AreaSwitcher focus={focus} setFocus={setFocus} auto={auto} setAuto={setAuto} />
        <AreaCard focus={focus} onClose={() => setFocus(null)} />
      </div>
      <div className="st-right">
        <Pip />
        <AgentPanel />
      </div>
      <div className="st-bottom">
        <Kpis />
        <Timeline />
      </div>
      <Notice />
      <Intro />
      <VerdictCard />
    </div>
  );
}
