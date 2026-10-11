// Focusable areas of the diorama: click-to-focus targets, the area switcher and the camera glide.
// Positions come from layout.ts (world units, x = east, z = south).
import { CITY, COAL, COMPRESSOR, GAS_PLANTS, HOSPITAL, NUCLEAR, SOLAR_RECT, SUBSTATIONS, TURBINES, terrainH } from "./layout";

export type AreaKey = "wind" | "solar" | "field" | "compressor" | "plants" | "gasplants" | "coal" | "nuclear" | "substation" | "town" | "hospital";

export interface Area {
  key: AreaKey;
  name: string;
  /** camera look-at point */
  target: [number, number, number];
  /** camera distance when focused */
  dist: number;
  /** ring centre (x, z) and radius */
  ring: [number, number, number];
  /** click radius around each hit centre */
  hits: [number, number, number][];
  /** label height above the ring centre */
  labelY: number;
}

const tc = (x: number, z: number, y = 0.4): [number, number, number] => [x, terrainH(x, z) + y, z];
const windC: [number, number] = [
  TURBINES.reduce((a, t) => a + t[0], 0) / TURBINES.length,
  TURBINES.reduce((a, t) => a + t[1], 0) / TURBINES.length,
];
const solarC: [number, number] = [(SOLAR_RECT.x0 + SOLAR_RECT.x1) / 2, (SOLAR_RECT.z0 + SOLAR_RECT.z1) / 2];

export const AREAS: Record<AreaKey, Area> = {
  wind: { key: "wind", name: "Wind ridge", target: tc(windC[0], windC[1], 1.1), dist: 19.5, ring: [windC[0], windC[1], 2.7], hits: [[windC[0], windC[1], 3.1]], labelY: 3.2 },
  solar: { key: "solar", name: "Solar field", target: tc(solarC[0], solarC[1], 0.2), dist: 14.3, ring: [solarC[0], solarC[1], 1.9], hits: [[solarC[0], solarC[1], 1.7]], labelY: 1.2 },
  field: { key: "field", name: "Gas field", target: tc(-8.6, 2.6, 0.3), dist: 21, ring: [-8.7, 3.6, 4.6], hits: [[-8.8, 1.6, 3.3], [-8.8, 6.6, 3.3], [-8.8, 10.0, 2.4]], labelY: 3.2 },
  compressor: { key: "compressor", name: "Gas compressor", target: tc(COMPRESSOR[0], COMPRESSOR[1], 0.4), dist: 11.1, ring: [COMPRESSOR[0], COMPRESSOR[1], 1.25], hits: [[COMPRESSOR[0], COMPRESSOR[1], 1.1]], labelY: 1.4 },
  plants: { key: "plants", name: "Power plants", target: tc(-2.6, -9.3, 0.8), dist: 28.6, ring: [-2.6, -9.4, 7.6], hits: [], labelY: 3.0 },
  gasplants: { key: "gasplants", name: "Gas power plants", target: tc(GAS_PLANTS[1][0], GAS_PLANTS[1][1], 0.8), dist: 15.6, ring: [GAS_PLANTS[1][0], GAS_PLANTS[1][1], 3.0], hits: GAS_PLANTS.map(([x, z]) => [x, z - 0.2, 1.4] as [number, number, number]), labelY: 2.6 },
  coal: { key: "coal", name: "Coal plant", target: tc(COAL[0], COAL[1], 0.9), dist: 12.3, ring: [COAL[0], COAL[1], 1.7], hits: [[COAL[0], COAL[1], 1.5]], labelY: 2.9 },
  nuclear: { key: "nuclear", name: "Nuclear plant", target: tc(NUCLEAR[0] + 0.3, NUCLEAR[1] - 0.6, 0.8), dist: 13.0, ring: [NUCLEAR[0] + 0.3, NUCLEAR[1] - 0.6, 2.0], hits: [[NUCLEAR[0] + 0.3, NUCLEAR[1] - 0.6, 1.8]], labelY: 2.6 },
  substation: { key: "substation", name: "Substations", target: tc(SUBSTATIONS[1][0], SUBSTATIONS[1][1], 0.3), dist: 18.2, ring: [SUBSTATIONS[1][0], SUBSTATIONS[1][1], 1.2], hits: SUBSTATIONS.map(([x, z]) => [x, z, 1.0] as [number, number, number]), labelY: 1.3 },
  town: { key: "town", name: "Town", target: tc(CITY.cx, CITY.cz, 0.3), dist: 26.0, ring: [CITY.cx, CITY.cz, CITY.r2 + 0.3], hits: [[CITY.cx, CITY.cz, CITY.r2]], labelY: 3.4 },
  hospital: { key: "hospital", name: "Hospital", target: tc(HOSPITAL[0] + 0.2, HOSPITAL[1], 0.4), dist: 10.4, ring: [HOSPITAL[0] + 0.2, HOSPITAL[1], 1.3], hits: [[HOSPITAL[0] + 0.2, HOSPITAL[1], 1.2]], labelY: 1.6 },
};

/** Small areas first, so the compressor wins over the gas field and the hospital over the town. */
const PICK_ORDER: AreaKey[] = ["hospital", "compressor", "substation", "coal", "nuclear", "gasplants", "solar", "wind", "field", "town"];

/** Area under a ground point, or null. */
export function areaAt(x: number, z: number): AreaKey | null {
  for (const k of PICK_ORDER) {
    for (const [hx, hz, r] of AREAS[k].hits) if (Math.hypot(x - hx, z - hz) <= r) return k;
  }
  return null;
}
