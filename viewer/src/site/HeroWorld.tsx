// The calm 3D diorama in the hero (loaded on demand; three.js stays out of the site's first chunk).
import { GridCity } from "../grid3d/GridCity";
import type { GridFrame } from "../grid3d/types";

/** A calm, sunny, fully powered frame: decoration only, no data is shown over it. */
const CALM: GridFrame = {
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

export default function HeroWorld() {
  return <GridCity frame={CALM} look="gridleaf" hud={false} labels={false} orbit={false} showFps={false} quality="low" className="s-hero-city" />;
}
