// Data contract for the 3D power-grid city (src/grid3d). One GridFrame = one simulated hour
// (or an interpolated moment between two hours). Adapters in ./adapters.ts build these from the
// recorded replays (`437-replay/1`) and from the live server's SSE "hour" messages.

export type FuelAvail = { gas: number; coal: number; nuclear: number; wind: number; solar: number };

export type GridEvent = { type: string; text: string };

export type GridFrame = {
  h: number;
  localHour: number;
  tempC: number;
  /** 0..1 snowfall / snow cover */
  snow: number;
  /** 0..1 how cold it is (frost tint) */
  frost: number;
  freqHz: number;
  countdownS: number | null;
  demandMw: number;
  supplyMw: number;
  reserveMw: number;
  shedFrac: number;
  homesDark: number;
  /** zone_01..zone_16, zone_crit, zone_gas: 0..1 (zone_crit 0.3 = hospital on backup generators) */
  zones: Record<string, number>;
  /** availability 0..1 */
  fuel: FuelAvail;
  /** 0..1 how much gas the wells produce */
  gasProduction: number;
  /** 0..1 share of the gas plants that get fuel */
  gasSupply: number;
  protectGas: boolean;
  outagesMw?: Record<string, number>;
  collapsed: boolean;
  events: GridEvent[];

  // ---- optional extras (adapters fill them when the source has them)
  /** Lowest frequency within the hour; the dial dips to it between frames. */
  freqMinHz?: number;
  /** Share of wind turbines not stopped by ice (0..1). */
  windOk?: number;
  /** Local clock text, e.g. "2018-01-16 22:00 CST". */
  localTime?: string;
  /** Size of the gas fleet (MW), used for the "-X GW" callout. */
  gasFleetMw?: number;
};

export type GridQuality = "low" | "medium" | "high";

/** "night": the original dark winter-night look (Mission Control). "gridleaf": daylight clay diorama (Stage). */
export type GridLook = "night" | "gridleaf";

export const CITY_ZONES = Array.from({ length: 16 }, (_, i) => `zone_${String(i + 1).padStart(2, "0")}`);
