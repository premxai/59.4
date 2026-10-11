// The hero diorama (frozen notebook) and the small Day-1 picture-in-picture, both fed from the
// buffered frames at the dramatic playback hour.
import { useMemo } from "react";
import { sampleGridFrames } from "../grid3d/adapters";
import { AREAS, type AreaKey } from "../grid3d/areas";
import { GridCity } from "../grid3d/GridCity";
import type { ViewInset } from "../grid3d/Scene";
import type { GridFrame, GridQuality } from "../grid3d/types";
import { fmtHomesShort } from "./derive";
import { useStage } from "./store";

const params = new URLSearchParams(location.search);
const QUALITY = (["low", "medium", "high"] as const).find((q) => q === params.get("quality")) as GridQuality | undefined;
const SHOW_FPS = params.get("fps") === "1";

/** A calm, sunny, fully powered frame for the idle screen (nothing has run yet). Not data. */
export const IDLE_FRAME: GridFrame = {
  h: 0,
  localHour: 13,
  tempC: 12,
  snow: 0,
  frost: 0,
  freqHz: 60,
  countdownS: null,
  demandMw: 42000,
  supplyMw: 68000,
  reserveMw: 26000,
  shedFrac: 0,
  homesDark: 0,
  zones: { zone_crit: 1, zone_gas: 1 },
  fuel: { gas: 0.95, coal: 0.95, nuclear: 1, wind: 0.55, solar: 0.7 },
  gasProduction: 1,
  gasSupply: 1,
  protectGas: true,
  collapsed: false,
  events: [],
  windOk: 1,
};

export function useFrameAt(side: "left" | "right", step = 0): GridFrame | null {
  const frames = useStage((s) => s[side].frames);
  const hour = useStage((s) => (step ? Math.round(s.hour / step) * step : s.hour));
  const idle = useStage((s) => s.status === "idle" || (s.intro != null && s.intro < 2) || s[side].frames.length === 0);
  return useMemo(() => (idle ? IDLE_FRAME : sampleGridFrames(frames, hour)), [idle, frames, hour]);
}

export function MainWorld({ focus, onPick, inset, onFps }: { focus: AreaKey | null; onPick: (a: AreaKey | null) => void; inset: ViewInset; onFps?: (fps: number) => void }) {
  const frame = useFrameAt("right");
  const label = focus ? (
    <div className="st-focus-label">
      <span className="st-focus-dot" />
      {AREAS[focus].name}
    </div>
  ) : null;
  return (
    <GridCity
      frame={frame}
      look="gridleaf"
      hud={false}
      labels
      orbit
      showFps={SHOW_FPS}
      quality={QUALITY}
      focus={focus}
      onPick={onPick}
      focusLabel={label}
      inset={inset}
      className="st-world"
      onFps={onFps}
    />
  );
}

export function Pip() {
  const frame = useFrameAt("left", 0.25);
  const running = useStage((s) => s.status !== "idle" && s.intro == null);
  const res = useStage((s) => s.left.result);
  const ended = useStage((s) => s.ended);
  const dark = frame && running ? (frame.collapsed ? null : frame.homesDark) : 0;
  return (
    <div className="st-pip st-glass">
      <div className="st-pip-view">
        <GridCity frame={frame} look="gridleaf" hud={false} labels={false} orbit={false} showFps={false} quality="low" className="st-pip-city" />
      </div>
      <div className="st-pip-cap">
        <div className="st-pip-title">Same storm · Day-1 notebook</div>
        <div className="st-pip-sub">no learning</div>
      </div>
      <div className={`st-pip-num ${dark && dark > 1000 ? "st-bad" : ""}`}>
        {frame?.collapsed ? (
          <b>Total blackout</b>
        ) : (
          <>
            <b>{dark && dark > 1000 ? fmtHomesShort(dark) : "0"}</b> <span>homes dark</span>
          </>
        )}
        {ended && res && <i className={`st-pip-verdict ${res.passed ? "st-ok" : "st-bad"}`}>{res.passed ? "PASSED" : "FAILED"}</i>}
      </div>
    </div>
  );
}
