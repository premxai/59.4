// Pure derivations from a GridFrame: plant states (bars + badges), story callouts, HUD numbers.
import { CITY_ZONES, type GridFrame } from "./types";
import { DEFAULT_GAS_FLEET_MW } from "./adapters";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export type PlantState = "ok" | "frozen" | "nofuel" | "iced" | "night" | "snow" | "off";

export interface PlantInfo {
  /** available share of this plant's capacity (0..1) */
  avail: number;
  /** share lost to freezing / breakdowns */
  frozen: number;
  /** share lost because no gas reaches it */
  nofuel: number;
  /** how hard it runs (plume size, window light) */
  output: number;
  state: PlantState;
}

/**
 * Order: gas1, gas2, gas3, coal, nuclear, wind, solar.
 * Gas: fuel.gas is the available gas capacity, gasSupply the share that gets fuel. The fuel shortfall
 * (1 - gasSupply) is drawn from gas plant 3 backwards, the rest of the lost capacity ("frozen" / broken)
 * from gas plant 1 forwards, so the three plants read as one fleet split in thirds.
 */
export function plantModel(f: GridFrame): PlantInfo[] {
  const off = f.collapsed;
  const noFuel = clamp01(1 - f.gasSupply);
  const frozenGas = clamp01(1 - f.fuel.gas - noFuel);
  const out: PlantInfo[] = [];
  for (let k = 0; k < 3; k++) {
    const nofuel = clamp01(noFuel * 3 - (2 - k));
    const frozen = Math.min(1 - nofuel, clamp01(frozenGas * 3 - k));
    const avail = off ? 0 : clamp01(1 - nofuel - frozen);
    const state: PlantState = off ? "off" : avail >= 0.7 ? "ok" : nofuel >= frozen ? "nofuel" : "frozen";
    out.push({ avail, frozen, nofuel, output: avail, state });
  }
  const simple = (a: number): PlantInfo => {
    const avail = off ? 0 : clamp01(a);
    return { avail, frozen: off ? 0 : 1 - avail, nofuel: 0, output: avail, state: off ? "off" : avail >= 0.7 ? "ok" : "frozen" };
  };
  out.push(simple(f.fuel.coal));
  out.push(simple(f.fuel.nuclear));
  const iced = clamp01(1 - (f.windOk ?? 1));
  const wind = off ? 0 : clamp01(f.fuel.wind);
  out.push({
    avail: wind,
    frozen: off ? 0 : Math.min(1 - wind, iced),
    nofuel: 0,
    output: wind,
    state: off ? "off" : iced >= 0.3 ? "iced" : "ok",
  });
  const solar = off ? 0 : clamp01(f.fuel.solar);
  const night = f.localHour < 7.5 || f.localHour > 17.5;
  out.push({
    avail: solar,
    frozen: 0,
    nofuel: 0,
    output: solar,
    state: off ? "off" : f.snow > 0.3 ? "snow" : night && solar < 0.05 ? "night" : "ok",
  });
  return out;
}

export const PLANT_BADGE: Record<PlantState, { text: string; tone: string }> = {
  ok: { text: "OK", tone: "ok" },
  frozen: { text: "FROZEN", tone: "ice" },
  nofuel: { text: "NO FUEL", tone: "gas" },
  iced: { text: "ICED", tone: "ice" },
  night: { text: "NIGHT", tone: "dim" },
  snow: { text: "SNOWED IN", tone: "ice" },
  off: { text: "TRIPPED", tone: "bad" },
};

export const darkCount = (f: GridFrame) => CITY_ZONES.reduce((n, id) => n + ((f.zones[id] ?? 1) < 0.5 ? 1 : 0), 0);
export const compressorPowered = (f: GridFrame) => !f.collapsed && (f.zones.zone_gas ?? 1) >= 0.5;

// ------------------------------------------------------------------ callouts
export type Anchor = "field" | "compressor" | "gasplants" | "city" | "hospital" | "wind";
export type Tone = "bad" | "warn" | "gas" | "ice" | "good";

export interface Callout {
  id: string;
  anchor: Anchor;
  tone: Tone;
  icon: string;
  text: string;
  sub?: string;
}

/** Remembers recent events so short-lived moments ("power restored") stay on screen a few hours. */
export class CalloutMemory {
  lastH = -1;
  shedEndH = -1e9;
  buildH = -1e9;

  update(f: GridFrame) {
    const h = Math.floor(f.h);
    if (h < this.lastH) {
      this.shedEndH = -1e9;
      this.buildH = -1e9;
    }
    if (h !== this.lastH) {
      for (const e of f.events) {
        if (e.type === "shed_end") this.shedEndH = h;
        if (e.type === "build") this.buildH = h;
      }
      this.lastH = h;
    }
  }
}

const gw = (mw: number) => (mw >= 9500 ? `${Math.round(mw / 1000)}` : (mw / 1000).toFixed(1));

export function deriveCallouts(f: GridFrame, mem: CalloutMemory, max = 4): Callout[] {
  const out: Callout[] = [];
  const h = Math.floor(f.h);
  const dark = darkCount(f);
  if (f.collapsed) {
    out.push({ id: "collapse", anchor: "city", tone: "bad", icon: "■", text: "TOTAL BLACKOUT", sub: "Frequency stayed under 59.4 Hz too long" });
  }
  if (!f.collapsed && !compressorPowered(f)) {
    out.push({ id: "comp", anchor: "compressor", tone: "bad", icon: "⚡", text: "Compressor lost power", sub: "gas flow falling" });
  } else if (!f.collapsed && f.shedFrac > 0.005 && f.protectGas) {
    out.push({ id: "comp-ok", anchor: "compressor", tone: "good", icon: "✓", text: "Gas facilities kept powered" });
  }
  if (!f.collapsed && f.gasSupply < 0.97) {
    const mw = (1 - f.gasSupply) * (f.gasFleetMw ?? DEFAULT_GAS_FLEET_MW);
    out.push({ id: "nofuel", anchor: "gasplants", tone: "gas", icon: "🔥", text: `Gas plants out of fuel (−${gw(mw)} GW)` });
  }
  if (f.gasProduction < 0.97) {
    out.push({ id: "wells", anchor: "field", tone: "ice", icon: "❄", text: "Wells freezing", sub: `gas output −${Math.round((1 - f.gasProduction) * 100)}%` });
  }
  if (!f.collapsed && dark > 0) {
    // enough power for every home (available > needed), yet the notebook keeps districts dark
    const spareMw = f.supplyMw - f.demandMw;
    const spare = f.shedFrac > 0.03 && spareMw > 1500;
    out.push({
      id: "rolling",
      anchor: "city",
      tone: "warn",
      icon: "◐",
      text: `Rolling outages: ${dark} of 16 neighborhoods dark`,
      sub: spare ? `${gw(spareMw)} GW to spare, yet homes left dark` : undefined,
    });
  }
  if ((f.zones.zone_crit ?? 1) < 0.95) {
    out.push({ id: "hospital", anchor: "hospital", tone: "warn", icon: "✚", text: "Hospital on backup power" });
  }
  if (!f.collapsed && dark === 0 && h - mem.shedEndH >= 0 && h - mem.shedEndH < 5) {
    out.push({ id: "restored", anchor: "city", tone: "good", icon: "✓", text: "Power restored to every home" });
  }
  if (h - mem.buildH >= 0 && h - mem.buildH < 20) {
    out.push({ id: "build", anchor: "gasplants", tone: "good", icon: "🛠", text: "Prepared before the cold", sub: "plants weatherproofed" });
  }
  if (!f.collapsed && (f.windOk ?? 1) < 0.7) {
    out.push({ id: "iced", anchor: "wind", tone: "ice", icon: "❄", text: `Turbines iced (${Math.round((1 - (f.windOk ?? 1)) * 100)}% stopped)` });
  }
  // one callout per anchor (first = highest priority), then cap
  const seen = new Set<Anchor>();
  return out.filter((c) => (seen.has(c.anchor) ? false : (seen.add(c.anchor), true))).slice(0, max);
}

/** Grid strain 0..1 (amber flicker on the lines). */
export function gridStrain(f: GridFrame): number {
  if (f.collapsed) return 1;
  let s = Math.max(0, Math.min(1, (3000 - f.reserveMw) / 3000));
  if (f.shedFrac > 0.005 && f.reserveMw < 6000) s = Math.max(s, 0.55);
  if (f.freqHz < 59.8) s = Math.max(s, 0.6 + (59.8 - f.freqHz) * 1.5);
  if (f.countdownS != null) s = 1;
  return Math.min(1, s);
}
