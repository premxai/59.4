// Adaptive quality. One global tier shared by every canvas (split screen measures the whole page).
//   ?quality=high|medium|low  -> fixed tier
//   default (auto)            -> start from a GPU guess, measure fps over ~2 s windows, step down
//                                while fps < 30. Never steps back up (avoids oscillation).
import { create } from "zustand";

export type Tier = "high" | "medium" | "low";

export interface TierSettings {
  dpr: number | [number, number];
  /** EffectComposer MSAA samples. */
  msaa: number;
  /** "full" = mipmap bloom (8 levels) · "lite" = 5 levels · "none" = no composer, renderer tone maps. */
  bloom: "full" | "lite" | "none";
  snow: number;
  pumpjacks: number;
  turbinesPerPlant: number;
  gasMinMw: number;
  plumePer: number;
  terrainStride: number;
  /** Cheaper terrain fragment shader (square outage cells, no noise/sparkle). */
  cheapShader: boolean;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { dpr: [1, 1.5], msaa: 4, bloom: "full", snow: 4500, pumpjacks: 150, turbinesPerPlant: 3, gasMinMw: 60, plumePer: 7, terrainStride: 2, cheapShader: false },
  medium: { dpr: 1, msaa: 0, bloom: "lite", snow: 1500, pumpjacks: 70, turbinesPerPlant: 2, gasMinMw: 150, plumePer: 4, terrainStride: 3, cheapShader: false },
  low: { dpr: 0.75, msaa: 0, bloom: "none", snow: 400, pumpjacks: 30, turbinesPerPlant: 1, gasMinMw: 300, plumePer: 0, terrainStride: 4, cheapShader: true },
};

const ORDER: Tier[] = ["high", "medium", "low"];

interface QualityState {
  tier: Tier;
  auto: boolean;
  fps: number;
  gpu: string;
  setTier: (t: Tier) => void;
}

function detectGpu(): string {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    if (!gl) return "none";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return String(r ?? "");
  } catch {
    return "unknown";
  }
}

function initialTier(gpu: string): { tier: Tier; auto: boolean } {
  const q = new URLSearchParams(location.search).get("quality");
  if (q === "high" || q === "medium" || q === "low") return { tier: q, auto: false };
  if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) return { tier: "low", auto: true };
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (mobile || /Intel|Mali|Adreno|PowerVR|Apple GPU|Iris/i.test(gpu)) return { tier: "medium", auto: true };
  return { tier: "high", auto: true };
}

const GPU = detectGpu();
const init = initialTier(GPU);

export const useQuality = create<QualityState>((set) => ({
  tier: init.tier,
  auto: init.auto,
  fps: 0,
  gpu: GPU,
  setTier: (t) => set({ tier: t }),
}));

export function useTierSettings(): TierSettings {
  return TIERS[useQuality((s) => s.tier)];
}

// ---------------------------------------------------------------- fps monitor
const WINDOW_S = 2.0;
const COOLDOWN_S = 2.5; // shader recompiles / geometry rebuilds after a change cause a hitch
let frames = 0;
let winStart = 0;
let cooldownUntil = 0;
let armed = false;

/** Start judging fps (call once the scene has loaded). */
export function armQualityMonitor(): void {
  if (armed) return;
  armed = true;
  frames = 0;
  winStart = performance.now();
  cooldownUntil = winStart + 1000; // let the first frames (texture uploads, compiles) settle
}

/** Called from the global rAF loop with the frame gap in ms. */
export function qualityTick(now: number, gapMs: number): void {
  if (!armed) return;
  if (gapMs > 500) {
    // tab hidden / debugger / huge hitch: don't judge this window
    frames = 0;
    winStart = now;
    return;
  }
  frames++;
  const el = (now - winStart) / 1000;
  if (el < WINDOW_S) return;
  const fps = frames / el;
  frames = 0;
  winStart = now;
  const s = useQuality.getState();
  useQuality.setState({ fps: Math.round(fps) });
  if (import.meta.env.DEV) Object.assign(window, { __fps: Math.round(fps), __tier: s.tier });
  if (!s.auto || now < cooldownUntil || fps >= 30) return;
  const i = ORDER.indexOf(s.tier);
  if (i >= ORDER.length - 1) return;
  const next = fps < 14 ? "low" : ORDER[i + 1];
  s.setTier(next);
  cooldownUntil = now + COOLDOWN_S * 1000;
}
