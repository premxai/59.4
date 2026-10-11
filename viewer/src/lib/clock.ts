// One global playback clock shared by every view (split screen stays synced by hour).
import { Timer } from "three";
import { create } from "zustand";
import { qualityTick } from "./quality";

export const SPEEDS = [0.5, 1, 2, 3, 4, 6, 8, 12, 24]; // simulated hours per real second (keys 1..9)

interface ClockState {
  hour: number; // fractional simulated hour
  maxHour: number; // last frame index
  playing: boolean;
  speed: number;
  /** Real-time stamp (performance.now) of the last scrub, used to avoid event floods. */
  lastScrub: number;
  setMax: (m: number) => void;
  setHour: (h: number, scrub?: boolean) => void;
  step: (dh: number) => void;
  toggle: () => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  tick: (dtSeconds: number) => void;
}

export const useClock = create<ClockState>((set, get) => ({
  hour: 0,
  maxHour: 0,
  playing: true,
  speed: 3,
  lastScrub: 0,
  setMax: (m) => set({ maxHour: Math.max(0, m) }),
  setHour: (h, scrub = true) =>
    set({ hour: Math.max(0, Math.min(get().maxHour, h)), ...(scrub ? { lastScrub: performance.now() } : {}) }),
  step: (dh) => {
    const h = Math.round(get().hour) + dh;
    set({ hour: Math.max(0, Math.min(get().maxHour, h)), lastScrub: performance.now() });
  },
  toggle: () => {
    const s = get();
    if (!s.playing && s.hour >= s.maxHour) set({ hour: 0, playing: true, lastScrub: performance.now() });
    else set({ playing: !s.playing });
  },
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),
  tick: (dt) => {
    const s = get();
    if (!s.playing || s.maxHour <= 0) return;
    const h = s.hour + dt * s.speed;
    if (h >= s.maxHour) set({ hour: s.maxHour, playing: false });
    else set({ hour: h });
  },
}));

if (import.meta.env.DEV) Object.assign(window, { __clock: useClock });

let started = false;
/** Drives the clock from requestAnimationFrame, independent of any canvas. */
export function startClock(): void {
  if (started) return;
  started = true;
  // THREE.Timer (not the deprecated THREE.Clock); connected to the Page Visibility API so a
  // hidden tab doesn't produce one giant step when it comes back.
  const timer = new Timer();
  timer.connect(document);
  let last = performance.now();
  const loop = (now: number) => {
    timer.update(now);
    const dt = Math.min(0.1, timer.getDelta());
    qualityTick(now, now - last);
    last = now;
    useClock.getState().tick(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
