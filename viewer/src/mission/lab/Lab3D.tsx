// Optional 3D view for the Live lab: two night/snow cities side by side (quiet minimal HUD), fed from the same buffered hour
// messages at the same playback hour as the charts, KPIs and feed. Lazy-loaded; unmounted in Charts mode.
import { useRef } from "react";
import { GridCity } from "../../grid3d/GridCity";
import { frameFromLive, newLiveCtx, type LiveCtx, type LiveHourMsg } from "../../grid3d/adapters";
import type { GridFrame, GridQuality } from "../../grid3d/types";
import type { Side } from "../live";
import type { Raw } from "./labData";

// Same URL option as the Stage (?quality=low|medium|high); high by default (DPR up to 1.5, bloom).
const Q = new URLSearchParams(location.search).get("quality");
const QUALITY: GridQuality = Q === "low" || Q === "medium" ? Q : "high";
// A steady night sky keeps the lit streets and homes readable and avoids a day/night flicker at 8x.
// Everything the runs decide (dark districts, gas, frozen plants, frequency) stays data-driven.
// ?sky=real uses the storm's real time of day instead.
const NIGHT_HOUR: number | null = new URLSearchParams(location.search).get("sky") === "real" ? null : 21;

/** Frames derived once per streamed hour (incrementally), so a playback tick only picks an index. */
function useLiveFrames(raw: Raw[]): (GridFrame | undefined)[] {
  const st = useRef<{ raw: Raw[] | null; frames: (GridFrame | undefined)[]; ctx: LiveCtx }>({ raw: null, frames: [], ctx: newLiveCtx() });
  const s = st.current;
  if (s.raw !== raw) {
    s.raw = raw;
    s.frames = [];
    s.ctx = newLiveCtx();
  }
  while (s.frames.length < raw.length) {
    const m = raw[s.frames.length];
    const f = m ? frameFromLive(m as unknown as LiveHourMsg, s.ctx) : s.frames[s.frames.length - 1];
    if (f && m && NIGHT_HOUR != null) f.localHour = NIGHT_HOUR;
    s.frames.push(f);
  }
  return s.frames;
}

export interface Lab3DProps {
  raw: Record<Side, Raw[]>;
  done?: boolean;
  ph: number;
  labels: Record<Side, { title: string; sub?: string }>;
}

function Half({ raw, ph, title, sub }: { raw: Raw[]; ph: number; title: string; sub?: string }) {
  const frames = useLiveFrames(raw);
  const frame = frames.length ? (frames[Math.max(0, Math.min(ph, frames.length - 1))] ?? null) : null;
  return (
    <div className="lab-3d-half">
      <GridCity frame={frame} label={title} sublabel={sub} hud="minimal" labels={false} orbit={false} drift={false} showFps={false} quality={QUALITY} className="lab-3d-city" />
    </div>
  );
}

export default function Lab3D({ raw, ph, labels, done }: Lab3DProps) {
  return (
    <div className={`lab-3d${done ? " lab-3d-done" : ""}`}>
      <Half raw={raw.left} ph={ph} title={labels.left.title} sub={labels.left.sub} />
      <Half raw={raw.right} ph={ph} title={labels.right.title} sub={labels.right.sub} />
    </div>
  );
}
