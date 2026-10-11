// Gauge tiles for one side of the comparison, read from that side's frame at the playhead:
// frequency (59.4 red line + countdown), demand, spare power, homes dark (vs the other side).
import { useClock } from "../lib/clock";
import type { Replay } from "../lib/replay";
import { countdownAt, fmtClock, fmtHomes, frameIndex, isCollapsedAt } from "../lib/replay";
import { useHourInt } from "../ui/Hud";
import { fmtPct } from "./plain";

const WINDOW_H = 48;

function Spark({ r, h, lo, hi, line, get }: { r: Replay; h: number; lo: number; hi: number; line?: number; get: (i: number) => number | null | undefined }) {
  const W = 120;
  const H = 30;
  const from = Math.max(0, h - WINDOW_H);
  const pts: string[] = [];
  for (let i = from; i <= Math.min(h, r.frames.length - 1); i++) {
    const v = get(i);
    if (v == null) continue;
    const x = ((i - from) / WINDOW_H) * W;
    const y = H - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * H;
    pts.push(`${pts.length ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  const ly = line != null ? H - ((line - lo) / (hi - lo)) * H : null;
  return (
    <svg className="mc-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {ly != null && <line x1="0" x2={W} y1={ly} y2={ly} className="mc-spark-red" />}
      <path d={pts.join("")} className="mc-spark-b" />
    </svg>
  );
}

export function SideGauges({ replay, other, otherLabel, idle }: { replay: Replay; other?: Replay; otherLabel?: string; idle: boolean }) {
  const h = useHourInt();
  const cd = useClock((s) => (replay.frames.length ? countdownAt(replay, s.hour) : null));
  if (idle || !replay.frames.length) {
    return (
      <div className="mc-gauges mc-gauges-idle">
        {["Frequency", "Demand", "Spare power", "Homes dark"].map((k) => (
          <div key={k} className="mc-gauge">
            <div className="mc-gauge-k">{k}</div>
            <div className="mc-gauge-v mc-dim">–</div>
          </div>
        ))}
      </div>
    );
  }
  const i = frameIndex(replay, h);
  const f = replay.frames[i];
  const down = isCollapsedAt(replay, h);
  const freq = down ? 0 : (f.freq_min_hz ?? f.freq_hz ?? 60);
  const thin = f.demand_mw > 0 && f.reserve_mw / f.demand_mw < 0.06;
  const pct = down ? 100 : Math.round((f.shed_frac ?? 0) * 100);
  let soFar = 0;
  for (let k = 0; k <= i; k++) soFar += replay.frames[k]?.homes_dark ?? 0;
  let otherSoFar: number | null = null;
  let otherNow: number | null = null;
  if (other && other.frames.length) {
    const j = Math.min(i, other.frames.length - 1);
    otherSoFar = 0;
    for (let k = 0; k <= j; k++) otherSoFar += other.frames[k]?.homes_dark ?? 0;
    otherNow = other.frames[j]?.homes_dark ?? 0;
  }
  const change = otherSoFar && otherSoFar > 0 ? ((soFar - otherSoFar) / otherSoFar) * 100 : null;
  return (
    <div className="mc-gauges">
      <div className={`mc-gauge ${down ? "mc-gauge-down" : cd != null ? "mc-gauge-alarm" : freq < 59.7 ? "mc-gauge-warn" : ""}`}>
        <div className="mc-gauge-k">Frequency</div>
        <div className="mc-gauge-v">
          {down ? "Grid down" : freq.toFixed(2)}
          {!down && <small> Hz</small>}
        </div>
        <div className="mc-gauge-sub">{cd != null ? <span className="mc-bad">⏱ {fmtClock(cd)} until the grid trips</span> : down ? <span className="mc-bad">below 59.4 too long</span> : "red line 59.4 Hz"}</div>
        <Spark r={replay} h={i} lo={59.0} hi={60.1} line={59.4} get={(k) => (isCollapsedAt(replay, k) ? 59.0 : (replay.frames[k].freq_min_hz ?? replay.frames[k].freq_hz))} />
      </div>
      <div className="mc-gauge">
        <div className="mc-gauge-k">Demand</div>
        <div className="mc-gauge-v">
          {(f.demand_mw / 1000).toFixed(1)}
          <small> GW</small>
        </div>
        <div className="mc-gauge-sub">supply {(f.supply_mw / 1000).toFixed(1)} GW</div>
        <Spark r={replay} h={i} lo={30000} hi={80000} get={(k) => replay.frames[k].demand_mw} />
      </div>
      <div className={`mc-gauge ${thin || down ? "mc-gauge-warn" : ""}`}>
        <div className="mc-gauge-k">Spare power</div>
        <div className="mc-gauge-v">
          {(f.reserve_mw / 1000).toFixed(1)}
          <small> GW</small>
        </div>
        <div className="mc-gauge-sub">{thin ? <span className="mc-warn">running thin</span> : "headroom left"}</div>
        <Spark r={replay} h={i} lo={-2000} hi={20000} get={(k) => replay.frames[k].reserve_mw} />
      </div>
      <div className={`mc-gauge ${f.homes_dark > 0 ? "mc-gauge-dark" : ""}`}>
        <div className="mc-gauge-k">Homes dark</div>
        <div className="mc-gauge-v">
          {f.homes_dark > 0 ? fmtHomes(f.homes_dark) : "Lights on"}
          {f.homes_dark > 0 && <small> · {pct}%</small>}
        </div>
        <div className="mc-gauge-sub">
          {other && otherNow != null ? (
            <>
              {otherLabel ?? "other side"} now: {otherNow > 0 ? fmtHomes(otherNow) : "lights on"}
              {change != null && (
                <>
                  {" "}
                  · so far <b className={change < 0 ? "mc-good" : change > 0 ? "mc-bad" : ""}>{fmtPct(change)}</b>
                </>
              )}
            </>
          ) : (
            <>so far {fmtHomes(soFar)} home-hours</>
          )}
        </div>
      </div>
    </div>
  );
}
