// Top bar, storm phase banner, area switcher + live stats card, and the KPI strip.
import type { ReactNode } from "react";
import { AREAS, type AreaKey } from "../grid3d/areas";
import { compressorPowered, darkCount, plantModel, PLANT_BADGE } from "../grid3d/model";
import type { GridFrame } from "../grid3d/types";
import { fmtClock } from "../lib/replay";
import { fmtHomesShort, gw, homesPoweredPct, PHASE_INFO, sparePct, type Phase } from "./derive";
import { usePhaseNow } from "./hooks";
import { useStage } from "./store";
import { useFrameAt } from "./World";

// ------------------------------------------------------------------ top bar
export function TopBar() {
  const version = useStage((s) => s.version);
  const nights = useStage((s) => s.nights);
  const online = useStage((s) => s.online);
  const status = useStage((s) => s.status);
  const intro = useStage((s) => s.intro);
  const offline = useStage((s) => s.offline);
  const fresh = useStage((s) => s.fresh);
  const playing = useStage((s) => s.playing);
  const ended = useStage((s) => s.ended);
  const busy = intro != null || status === "starting";
  const running = status !== "idle" && status !== "error" && !ended && intro == null;
  const live = online === "online" && !offline;
  return (
    <header className="st-top st-glass">
      <div className="st-brand">
        <span className="st-logo">
          59.4<i>Hz</i>
        </span>
        <span className="st-notebook">
          NOTEBOOK <b>{version}</b> · {nights} nights learned
        </span>
      </div>
      <div className="st-cta">
        <button className={`st-break ${busy ? "st-break-busy" : ""}`} onClick={() => useStage.getState().breakGrid()} disabled={busy} title="Pick a hidden storm and run it (B)">
          <span className="st-bolt">⚡</span>
          {busy ? "INJECTING STORM…" : running ? "BREAK IT AGAIN" : status === "idle" ? "BREAK THE GRID" : "BREAK IT AGAIN"}
        </button>
        <label className="st-fresh" title="Fast mode reuses the frozen AI's identical earlier answers (it runs at temperature 0); any new situation still asks the AI live. Tick to ask the AI live for every decision.">
          <input type="checkbox" checked={fresh} onChange={(e) => useStage.getState().setFresh(e.target.checked)} disabled={busy || online !== "online"} />
          Ask the AI live (slower)
        </label>
      </div>
      <div className="st-top-right">
        <span className={`st-live ${live ? (playing || status === "streaming" ? "st-live-on" : "st-live-idle") : online === "checking" ? "st-live-idle" : "st-live-off"}`}>
          <i />
          {online === "checking" ? "CONNECTING" : live ? "LIVE" : "OFFLINE REPLAY"}
        </span>
        <a className="st-link" href="?mode=site" title="Open the Evidence site">
          Evidence →
        </a>
        <a className="st-link" href="?mode=mission" title="Open Mission Control (M)">
          Mission Control →
        </a>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ phase banner + countdown (top centre)
const PHASE_SUB: Record<Phase, (f: GridFrame) => string> = {
  calm: () => "Every home has power",
  approaching: (f) => `Temperature ${Math.round(f.tempC)} °C and falling${f.snow > 0.05 ? " · snow" : ""}`,
  struggling: (f) => (f.gasSupply < 0.95 ? "Gas running short · plants freezing" : "Plants freezing · spare power thin"),
  critical: (f) => (f.collapsed ? "Total blackout" : f.shedFrac > 0.002 ? `${darkCount(f)} of 16 neighborhoods dark` : "Frequency sagging"),
  acting: (f) => (f.protectGas ? "Gas facilities kept powered" : "Rolling outages rotate between neighborhoods"),
  recovery: () => "Power flowing back · lights returning",
  stable: () => "Every home has power",
};

export function PhaseBanner() {
  const phase = usePhaseNow();
  const f = useFrameAt("right", 0.25);
  const status = useStage((s) => s.status);
  const intro = useStage((s) => s.intro);
  const nights = useStage((s) => s.nights);
  const waiting = useStage((s) => s.status === "streaming" && s.playing === true && Math.floor(s.hour) >= Math.min(s.left.frames.length, s.right.frames.length) - 1);
  if (status === "idle" || status === "error") {
    return (
      <div className="st-hero">
        This AI learned for {nights} nights. Let&apos;s give it a storm it has never seen.
      </div>
    );
  }
  if (intro == null && status === "streaming" && !phase)
    return (
      <div className="st-phase-wrap">
        <div className="st-waiting">The AI is working through the first hours of the storm…</div>
      </div>
    );
  if (intro != null || !phase || !f) return null;
  const info = PHASE_INFO[phase];
  return (
    <div className="st-phase-wrap">
      <div className={`st-phase st-glass st-tone-${info.tone}`} key={phase}>
        <span className="st-phase-dot" />
        <b>{info.label}</b>
        <span className="st-phase-sub">{PHASE_SUB[phase](f)}</span>
      </div>
      {f.countdownS != null && !f.collapsed && (
        <div className="st-countdown">
          <b>{fmtClock(f.countdownS)}</b>
          <span>until total blackout</span>
        </div>
      )}
      {waiting && <div className="st-waiting">The AI is thinking…</div>}
    </div>
  );
}

// ------------------------------------------------------------------ area switcher + live stats
const SWITCH: { key: AreaKey | null; label: string; k: string }[] = [
  { key: null, label: "Overview", k: "0" },
  { key: "wind", label: "Wind ridge", k: "1" },
  { key: "field", label: "Gas field", k: "2" },
  { key: "plants", label: "Power plants", k: "3" },
  { key: "substation", label: "Substation", k: "4" },
  { key: "town", label: "Town", k: "5" },
];
export const SWITCH_KEYS = SWITCH;

export function AreaSwitcher({ focus, setFocus, auto, setAuto }: { focus: AreaKey | null; setFocus: (a: AreaKey | null) => void; auto: boolean; setAuto: (v: boolean) => void }) {
  const group = (k: AreaKey | null): AreaKey | null => {
    if (k === "solar") return "wind";
    if (k === "compressor") return "field";
    if (k === "gasplants" || k === "coal" || k === "nuclear") return "plants";
    if (k === "hospital") return "town";
    return k;
  };
  const g = group(focus);
  return (
    <nav className="st-areas st-glass" aria-label="Areas">
      {SWITCH.map((a) => (
        <button key={a.label} className={`st-area ${g === a.key ? "st-area-on" : ""}`} onClick={() => setFocus(a.key)} title={`${a.label} (${a.k})`}>
          {a.label}
        </button>
      ))}
      <label className="st-auto" title="Let the camera follow the storm">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Follow the storm
      </label>
    </nav>
  );
}

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="st-row">
      <span>{k}</span>
      <b className={tone ? `st-${tone}` : undefined}>{v}</b>
    </div>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const tone3 = (x: number, ok = 0.9, warn = 0.6) => (x >= ok ? "ok" : x >= warn ? "warn" : "bad");

function areaRows(a: AreaKey, f: GridFrame): { rows: ReactNode; note: string } {
  const pm = plantModel(f);
  const out = f.outagesMw ?? {};
  switch (a) {
    case "wind":
    case "solar":
      return {
        rows: (
          <>
            <Row k="Wind power available" v={pct(f.fuel.wind)} tone={tone3(f.fuel.wind, 0.3, 0.12)} />
            <Row k="Turbines iced" v={pct(1 - (f.windOk ?? 1))} tone={(f.windOk ?? 1) < 0.7 ? "bad" : (f.windOk ?? 1) < 0.95 ? "warn" : "ok"} />
            <Row k="Solar output" v={pct(f.fuel.solar)} tone={f.fuel.solar > 0.05 ? "ok" : undefined} />
            <Row k="Status" v={PLANT_BADGE[pm[5].state].text} tone={pm[5].state === "ok" ? "ok" : "warn"} />
          </>
        ),
        note: "Rotor speed follows the wind power the simulator says is available.",
      };
    case "field":
    case "compressor": {
      const comp = compressorPowered(f);
      return {
        rows: (
          <>
            <Row k="Gas wells producing" v={pct(f.gasProduction)} tone={tone3(f.gasProduction)} />
            <Row k="Gas reaching plants" v={pct(f.gasSupply)} tone={tone3(f.gasSupply)} />
            <Row k="Compressor" v={comp ? "powered" : "NO POWER"} tone={comp ? "ok" : "bad"} />
            <Row k="Kept on during outages" v={f.shedFrac > 0.002 ? (f.protectGas ? "yes" : "no") : "no outages"} tone={f.shedFrac > 0.002 ? (f.protectGas ? "ok" : "bad") : undefined} />
          </>
        ),
        note: "If outages cut the compressor, gas stops reaching the power plants.",
      };
    }
    case "plants":
    case "gasplants":
    case "coal":
    case "nuclear": {
      const badge = (i: number) => PLANT_BADGE[pm[i].state];
      return {
        rows: (
          <>
            <Row k="Gas plants" v={`${pct(f.fuel.gas)} · ${badge(0).text === "OK" && badge(2).text === "OK" ? "OK" : [0, 1, 2].map((i) => badge(i).text).find((t) => t !== "OK")}`} tone={tone3(f.fuel.gas * f.gasSupply, 0.85, 0.6)} />
            <Row k="Coal" v={`${pct(f.fuel.coal)} · ${badge(3).text}`} tone={tone3(f.fuel.coal, 0.85, 0.6)} />
            <Row k="Nuclear" v={`${pct(f.fuel.nuclear)} · ${badge(4).text}`} tone={tone3(f.fuel.nuclear, 0.85, 0.6)} />
            <Row k="Frozen or broken" v={gw(Object.values(out).reduce((x, y) => x + (y || 0), 0))} />
          </>
        ),
        note: "Bars beside each plant: green available, blue frozen, orange no fuel.",
      };
    }
    case "substation":
      return {
        rows: (
          <>
            <Row k="Power available" v={gw(f.supplyMw)} />
            <Row k="Power needed" v={gw(f.demandMw)} />
            <Row k="Spare power" v={`${Math.round(sparePct(f))}%`} tone={sparePct(f) < 0 ? "bad" : sparePct(f) < 8 ? "warn" : "ok"} />
            <Row k="Frequency" v={`${(f.collapsed ? 0 : f.freqHz).toFixed(2)} Hz`} tone={f.freqHz < 59.4 || f.collapsed ? "bad" : f.freqHz < 59.8 ? "warn" : "ok"} />
          </>
        ),
        note: "Pulses on the lines speed up and brighten with the power flowing.",
      };
    case "town":
    case "hospital": {
      const d = darkCount(f);
      const crit = (f.zones.zone_crit ?? 1) >= 0.95;
      return {
        rows: (
          <>
            <Row k="Homes powered" v={`${homesPoweredPct(f).toFixed(1)}%`} tone={tone3(homesPoweredPct(f) / 100, 0.98, 0.85)} />
            <Row k="Homes dark" v={f.homesDark > 1000 ? fmtHomesShort(f.homesDark) : "none"} tone={f.homesDark > 1000 ? "bad" : "ok"} />
            <Row k="Neighborhoods dark" v={`${d} of 16`} tone={d ? "warn" : "ok"} />
            <Row k="Hospital" v={crit ? "on the grid" : "backup power"} tone={crit ? "ok" : "warn"} />
          </>
        ),
        note: `Outside: ${Math.round(f.tempC)} °C. Rolling outages rotate between neighborhoods.`,
      };
    }
  }
}

export function AreaCard({ focus, onClose }: { focus: AreaKey | null; onClose: () => void }) {
  const f = useFrameAt("right", 0.5);
  if (!focus || !f) return null;
  const { rows, note } = areaRows(focus, f);
  return (
    <div className="st-card st-glass" key={focus}>
      <div className="st-card-head">
        <b>{AREAS[focus].name}</b>
        <button className="st-x" onClick={onClose} title="Back to the overview (Esc)">
          ×
        </button>
      </div>
      <div className="st-card-live">live from the simulator</div>
      {rows}
      <div className="st-card-note">{note}</div>
    </div>
  );
}

// ------------------------------------------------------------------ KPI strip
const F_MIN = 59.0;
const F_MAX = 60.2;
const A0 = Math.PI;
const A1 = 0;
const ang = (hz: number) => A0 + (A1 - A0) * Math.max(0, Math.min(1, (hz - F_MIN) / (F_MAX - F_MIN)));
const P = (r: number, a: number) => `${(40 + r * Math.cos(a)).toFixed(2)} ${(40 - r * Math.sin(a)).toFixed(2)}`;
const arc = (r: number, a: number, b: number) => `M ${P(r, a)} A ${r} ${r} 0 0 1 ${P(r, b)}`;

function MiniDial({ hz, collapsed }: { hz: number; collapsed: boolean }) {
  const a = ang(collapsed ? F_MIN : hz);
  const red = ang(59.4);
  return (
    <svg className="st-dial" viewBox="0 0 80 46" aria-hidden>
      <path d={arc(32, A0, red)} className="st-dial-red" />
      <path d={arc(32, red, ang(59.8))} className="st-dial-amber" />
      <path d={arc(32, ang(59.8), A1)} className="st-dial-green" />
      <line x1={40 + 22 * Math.cos(red)} y1={40 - 22 * Math.sin(red)} x2={40 + 38 * Math.cos(red)} y2={40 - 38 * Math.sin(red)} className="st-dial-redline" />
      <text x={40 + 17 * Math.cos(red)} y={40 - 17 * Math.sin(red) + 3} className="st-dial-redtxt">
        59.4
      </text>
      <line x1={40} y1={40} x2={40 + 28 * Math.cos(a)} y2={40 - 28 * Math.sin(a)} className="st-dial-needle" />
      <circle cx={40} cy={40} r={3} className="st-dial-hub" />
    </svg>
  );
}

export function Kpis() {
  const f = useFrameAt("right", 0.25);
  const idle = useStage((s) => s.status === "idle");
  if (!f) return null;
  const hz = f.collapsed ? 0 : f.freqHz;
  const homes = homesPoweredPct(f);
  const spare = sparePct(f);
  const gas = f.gasSupply * 100;
  const tFreq = f.collapsed || hz < 59.4 ? "bad" : hz < 59.8 ? "warn" : "ok";
  return (
    <div className={`st-kpis ${idle ? "st-kpis-idle" : ""}`}>
      <div className={`st-kpi st-kpi-freq st-k-${tFreq}`}>
        <MiniDial hz={hz} collapsed={f.collapsed} />
        <div>
          <span className="st-kpi-label">Frequency</span>
          <b className="st-kpi-num">
            {hz.toFixed(2)}
            <small> Hz</small>
          </b>
          <span className="st-kpi-sub">{f.countdownS != null && !f.collapsed ? `blackout in ${fmtClock(f.countdownS)}` : "below 59.4 for 9 min = blackout"}</span>
        </div>
      </div>
      <Kpi label="Homes powered" value={`${homes.toFixed(1)}%`} sub={f.homesDark > 1000 ? `${fmtHomesShort(f.homesDark)} homes dark` : "every home lit"} tone={homes >= 99.5 ? "ok" : homes >= 85 ? "warn" : "bad"} bar={homes / 100} />
      <Kpi label="Spare power" value={`${Math.round(spare)}%`} sub={spare < 0 ? `short ${gw(f.demandMw - f.supplyMw)}` : `${gw(f.supplyMw - f.demandMw)} to spare`} tone={spare < 0 ? "bad" : spare < 8 ? "warn" : "ok"} bar={Math.max(0, Math.min(1, spare / 40))} />
      <Kpi label="Gas to plants" value={`${Math.round(gas)}%`} sub={compressorPowered(f) ? "compressor powered" : "compressor has no power"} tone={gas >= 90 ? "ok" : gas >= 60 ? "warn" : "bad"} bar={gas / 100} />
    </div>
  );
}

function Kpi({ label, value, sub, tone, bar }: { label: string; value: string; sub: string; tone: string; bar: number }) {
  return (
    <div className={`st-kpi st-k-${tone}`}>
      <span className="st-kpi-label">{label}</span>
      <b className="st-kpi-num">{value}</b>
      <span className="st-kpi-sub">{sub}</span>
      <i className="st-kpi-bar">
        <i style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} />
      </i>
    </div>
  );
}
