// Two grid cities side by side (same storm, two notebooks) with one shared clock.
import type { ReactNode } from "react";
import { fmtLocal } from "../lib/replay";
import { GridCity } from "./GridCity";
import type { GridFrame, GridQuality } from "./types";

export interface GridSplitProps {
  left: GridFrame | null;
  right: GridFrame | null;
  leftLabel?: string;
  rightLabel?: string;
  leftSublabel?: string;
  rightSublabel?: string;
  quality?: GridQuality;
  /** Replace the default shared clock bar (local time + hour); pass null to hide the bar. */
  clock?: ReactNode;
  /** Total hours, shown as "hour X of N" under the clock. */
  hours?: number;
  /** Storm name shown under the clock, e.g. "Unseen storm". */
  scenario?: string;
  className?: string;
}

export function SharedClock({ frame, hours, scenario }: { frame: GridFrame | null; hours?: number; scenario?: string }) {
  if (!frame) return null;
  const lt = frame.localTime ? fmtLocal(frame.localTime) : null;
  const h = Math.floor(frame.h);
  return (
    <div className="g3-clock">
      <b>{lt ? lt.time : `${String(Math.floor(frame.localHour)).padStart(2, "0")}:00`}</b>
      {lt && <span>{lt.date}</span>}
      <small>
        {scenario ? `${scenario} · ` : ""}same storm, same AI · hour {h}
        {hours ? ` of ${hours}` : ""}
      </small>
    </div>
  );
}

export function GridSplit({
  left,
  right,
  leftLabel = "Day 1 notebook",
  rightLabel = "Learned notebook",
  leftSublabel,
  rightSublabel,
  quality,
  clock,
  hours,
  scenario,
  className,
}: GridSplitProps) {
  return (
    <div className={`g3-split${className ? ` ${className}` : ""}`}>
      {clock !== null && <div className="g3-topbar">{clock ?? <SharedClock frame={left ?? right} hours={hours} scenario={scenario} />}</div>}
      <div className="g3-halves">
        <div className="g3-half">
          <GridCity frame={left} label={leftLabel} sublabel={leftSublabel} quality={quality} />
        </div>
        <div className="g3-half">
          <GridCity frame={right} label={rightLabel} sublabel={rightSublabel} quality={quality} />
        </div>
        <div className="g3-split-divider" />
      </div>
    </div>
  );
}

export default GridSplit;
