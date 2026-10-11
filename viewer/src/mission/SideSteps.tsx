// What one side's AI saw and did, hour by hour: alarms, habits that fired, hard limits, memory
// recalls from MongoDB, the AI's decisions, and what the storm did.
import { useEffect, useMemo, useRef } from "react";
import { useHourInt } from "../ui/Hud";
import type { LiveStep } from "./live";
import { hourStepIcon, hourStepText } from "./plain";

export function SideSteps({ steps, followLive, action, label, empty }: { steps: LiveStep[]; followLive: boolean; action?: string | null; label: string; empty: string }) {
  const h = useHourInt();
  const box = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const out: { s: LiveStep; n: number }[] = [];
    for (const s of steps) {
      if (!followLive && s.h > h) break;
      const last = out[out.length - 1];
      if (last && last.s.type === s.type && last.s.text === s.text) last.n++;
      else out.push({ s, n: 1 });
    }
    return out.slice(-60);
  }, [steps, h, followLive, steps.length]);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [rows.length]);
  return (
    <section className="mc-sidesteps">
      <header className="mc-sidesteps-head">
        <span className="mc-sidesteps-label">{label}</span>
        <span className="mc-dim">what the AI saw and did</span>
      </header>
      {action && followLive && (
        <div className="mc-sidesteps-now">
          <span className="mc-step-icon">🤖</span> <b>Now:</b> {action}
        </div>
      )}
      <div className="mc-sidesteps-list" ref={box}>
        {rows.length === 0 && <div className="mc-feed-empty">{empty}</div>}
        {rows.map(({ s, n }, i) => (
          <div key={i} className={`mc-hstep mc-hstep-${s.actor ?? "sim"} mc-hstep-${s.type}`}>
            <span className="mc-step-icon">{hourStepIcon(s.type)}</span>
            <span className="mc-hstep-h">h{s.h}</span>
            <span className="mc-hstep-text">
              {hourStepText(s.type, s.actor, s.text)}
              {n > 1 && <span className="mc-dim"> ×{n}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
