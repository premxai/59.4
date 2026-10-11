// DOM overlay inside one city view: label, frequency dial + 59.4 Hz countdown, supply vs demand,
// homes dark, gas to power plants, collapse banner. Large type, readable from the back of a room.
import { fmtClock, fmtHomes, fmtLocal } from "../lib/replay";
import { TOTAL_HOMES } from "./adapters";
import { darkCount } from "./model";
import type { GridFrame } from "./types";

const F_MIN = 59.0;
const F_MAX = 60.2;
const A0 = Math.PI * 1.1; // dial sweep (radians, from the left)
const A1 = -Math.PI * 0.1;

function angleOf(hz: number) {
  const t = Math.max(0, Math.min(1, (hz - F_MIN) / (F_MAX - F_MIN)));
  return A0 + (A1 - A0) * t;
}

function arc(r: number, a: number, b: number) {
  const p = (ang: number) => `${(50 + r * Math.cos(ang)).toFixed(2)} ${(52 - r * Math.sin(ang)).toFixed(2)}`;
  const large = Math.abs(b - a) > Math.PI ? 1 : 0;
  return `M ${p(a)} A ${r} ${r} 0 ${large} 1 ${p(b)}`;
}

export function FreqDial({ hz, collapsed }: { hz: number; collapsed: boolean }) {
  const shown = collapsed ? 0 : hz;
  const a = angleOf(collapsed ? F_MIN - 1 : hz);
  const tone = collapsed || hz < 59.4 ? "bad" : hz < 59.8 ? "warn" : "ok";
  const ticks = [59.0, 59.4, 59.8, 60.0, 60.2];
  return (
    <div className={`g3-dial g3-dial-${tone}`}>
      <svg viewBox="0 0 100 66" aria-label={`Grid frequency ${shown.toFixed(2)} Hz`}>
        <path d={arc(40, A0, angleOf(59.4))} className="g3-dial-red" />
        <path d={arc(40, angleOf(59.4), angleOf(59.8))} className="g3-dial-amber" />
        <path d={arc(40, angleOf(59.8), A1)} className="g3-dial-green" />
        {ticks.map((t) => {
          const ang = angleOf(t);
          const r1 = t === 59.4 ? 31 : 35;
          return (
            <line
              key={t}
              x1={50 + r1 * Math.cos(ang)}
              y1={52 - r1 * Math.sin(ang)}
              x2={50 + 45 * Math.cos(ang)}
              y2={52 - 45 * Math.sin(ang)}
              className={t === 59.4 ? "g3-dial-redline" : "g3-dial-tick"}
            />
          );
        })}
        <text x={50 + 27 * Math.cos(angleOf(59.4))} y={52 - 27 * Math.sin(angleOf(59.4)) + 2} className="g3-dial-redlabel">
          59.4
        </text>
        <line x1={50} y1={52} x2={50 + 37 * Math.cos(a)} y2={52 - 37 * Math.sin(a)} className="g3-dial-needle" />
        <circle cx={50} cy={52} r={3.2} className="g3-dial-hub" />
      </svg>
      <div className="g3-dial-num">
        <b>{collapsed ? "0" : shown.toFixed(2)}</b>
        <span>Hz</span>
      </div>
      <div className="g3-dial-cap">grid frequency</div>
    </div>
  );
}

function gwText(mw: number) {
  return `${(mw / 1000).toFixed(mw >= 10000 ? 0 : 1)} GW`;
}

export function GridHud({ frame: f, label, sublabel, showTime }: { frame: GridFrame; label?: string; sublabel?: string; showTime?: boolean }) {
  const dark = darkCount(f);
  const short = f.demandMw - f.supplyMw;
  const max = Math.max(f.demandMw, f.supplyMw, 1) * 1.08;
  const supplyPct = (f.supplyMw / max) * 100;
  const demandPct = (f.demandMw / max) * 100;
  const gasPct = Math.round(f.gasSupply * 100);
  const lt = showTime && f.localTime ? fmtLocal(f.localTime) : null;
  const homesOk = f.homesDark < 1000 && !f.collapsed;
  return (
    <div className="g3-hud">
      <div className="g3-hud-tl">
        {label && <div className="g3-label">{label}</div>}
        {sublabel && <div className="g3-sublabel">{sublabel}</div>}
        {lt && (
          <div className="g3-time">
            <b>{lt.time}</b> <span>{lt.date}</span>
          </div>
        )}
      </div>
      <div className="g3-hud-tr">
        <FreqDial hz={f.freqHz} collapsed={f.collapsed} />
        {f.countdownS != null && !f.collapsed && (
          <div className="g3-countdown">
            <b>{fmtClock(f.countdownS)}</b>
            <span>until total blackout</span>
          </div>
        )}
      </div>
      <div className="g3-hud-bl">
        <div className={`g3-homes${homesOk ? " g3-homes-ok" : ""}`}>
          {homesOk ? (
            <>
              <b>Every home has power</b>
            </>
          ) : (
            <>
              <b>{fmtHomes(f.collapsed ? Math.max(f.homesDark, TOTAL_HOMES) : f.homesDark)}</b>
              <span>homes dark{!f.collapsed && dark > 0 ? ` · ${dark} of 16 neighborhoods` : ""}</span>
            </>
          )}
        </div>
      </div>
      <div className="g3-hud-br">
        <div className="g3-meter">
          <div className="g3-meter-head">
            <span>POWER</span>
            <b className={short > 0 ? "g3-bad" : "g3-ok"}>{short > 0 ? `short ${gwText(short)}` : `spare ${gwText(-short)}`}</b>
          </div>
          <div className="g3-sd">
            <i className="g3-sd-supply" style={{ width: `${supplyPct}%` }} />
            <i className="g3-sd-demand" style={{ left: `${demandPct}%` }} />
          </div>
          <div className="g3-meter-foot">
            <span>
              <i className="g3-dot g3-dot-supply" /> available {gwText(f.supplyMw)}
            </span>
            <span>
              <i className="g3-dot g3-dot-demand" /> needed {gwText(f.demandMw)}
            </span>
          </div>
        </div>
        <div className="g3-meter">
          <div className="g3-meter-head">
            <span>GAS TO POWER PLANTS</span>
            <b className={gasPct >= 90 ? "g3-ok" : gasPct >= 60 ? "g3-warn" : "g3-bad"}>{gasPct}%</b>
          </div>
          <div className="g3-gasbar">
            <i style={{ width: `${gasPct}%` }} />
          </div>
        </div>
      </div>
      {f.collapsed && (
        <div className="g3-banner">
          <b>TOTAL BLACKOUT</b>
          <span>frequency stayed below 59.4 Hz too long</span>
        </div>
      )}
    </div>
  );
}

function homesShort(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("en-US")}k`;
  return Math.round(n).toLocaleString("en-US");
}

/** Quiet HUD for side-by-side comparisons: small label, small frequency dial, one status line. */
export function GridHudMinimal({ frame: f, label, sublabel }: { frame: GridFrame; label?: string; sublabel?: string }) {
  const lit = f.homesDark < 1000 && !f.collapsed;
  const pct = Math.min(100, Math.round(f.shedFrac * 100));
  const tone = f.collapsed || f.shedFrac >= 0.5 ? "bad" : lit ? "ok" : "warn";
  const text = f.collapsed ? "Grid collapsed" : lit ? "All homes lit" : `${homesShort(f.homesDark)} homes dark (${pct < 1 ? "<1" : pct}%)`;
  return (
    <div className="g3-hud g3-hud-minimal">
      {(label || sublabel) && (
        <div className="g3-mini-tl">
          {label && <div className="g3-mini-label">{label}</div>}
          {sublabel && <div className="g3-mini-sub">{sublabel}</div>}
        </div>
      )}
      <div className="g3-mini-tr">
        <FreqDial hz={f.freqHz} collapsed={f.collapsed} />
      </div>
      <div className="g3-mini-bl">
        <i className={`g3-mini-dot g3-mini-${tone}`} />
        {text}
      </div>
    </div>
  );
}
