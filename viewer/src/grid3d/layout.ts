// Deterministic layout of the diorama (same every load). World units: the ground plate is 24 x 24,
// x = east, z = south (north is -z), y = up. Camera looks from the south-south-east.
//
//   NW: 3 gas plants          N: coal, nuclear           NE: wind farm, solar
//   W : compressor, gas field | river |   substations S1 S2 S3
//   SW: gas field (pumpjacks)  hospital + water plant      city (16 districts) centre-east

export const HALF = 12;

/** Light-slot indices (uniform array uLight[24]): 0..15 = zone_01..16. */
export const L_CRIT = 16;
export const L_GAS = 17; // compressor (zone_gas)
export const L_GAS1 = 18; // gas plants 18..20
export const L_COAL = 21;
export const L_NUC = 22;
export const L_GRID = 23; // substations
export const N_LIGHTS = 24;

export const CITY = { cx: 4.0, cz: 4.4, r0: 2.2, r1: 4.3, r2: 6.7 };
export const ROAD_HALF = 0.085;
export const RIVER_HALF = 0.45;
export const riverX = (z: number) => -3.6 - 0.9 * (z / 12) + 0.6 * Math.sin(z * 0.42 + 0.6);

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Plate height without the drop at the plate border (the "gridleaf" look continues the land outward). */
export function terrainCore(x: number, z: number): number {
  let h = 0;
  const west = smooth(-3.6, -9.5, x);
  h += west * (0.16 + 0.14 * Math.sin(x * 0.9 + 1.3) * Math.sin(z * 0.7 + 0.4) + 0.07 * Math.sin(z * 1.7 + x * 0.6));
  const ne = smooth(6.5, 10.5, x) * smooth(-5.5, -10, z);
  h += ne * (0.22 + 0.06 * Math.sin(x * 1.3 + z));
  const d = Math.abs(x - riverX(z));
  return h * smooth(0.5, 1.8, d) - 0.2 * (1 - smooth(RIVER_HALF * 0.5, RIVER_HALF + 0.4, d));
}

export function terrainH(x: number, z: number): number {
  const h = terrainCore(x, z);
  const e = Math.max(Math.abs(x), Math.abs(z));
  const b = smooth(11.55, 12.0, e);
  return h * (1 - b) - 0.32 * b;
}

// ------------------------------------------------------------------ "gridleaf" countryside around the plate
/** Small lake east of the plate (gridleaf look only). */
export const LAKE = { x: 16.6, z: 3.2, rx: 3.1, rz: 2.2 };
export const LAKE_Y = -0.16;
const lakeD = (x: number, z: number) => Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz) + 0.12 * Math.sin(Math.atan2(z - LAKE.z, x - LAKE.x) * 3 + 0.7);

/** True inside the lake shoreline. */
export function inLake(x: number, z: number, pad = 0): boolean {
  return lakeD(x, z) < 1 + pad;
}

/** Rolling hills outside the plate; equals terrainCore at the plate border so the seam is invisible. */
export function outerH(x: number, z: number): number {
  const e = Math.max(Math.abs(x), Math.abs(z));
  const core = terrainCore(Math.max(-12, Math.min(12, x)), Math.max(-12, Math.min(12, z)));
  if (e <= 12) return core;
  const k = smooth(12, 17, e);
  let hill = 0.55 + 0.45 * Math.sin(x * 0.21 + 0.8) * Math.sin(z * 0.17 - 0.3) + 0.35 * Math.sin(x * 0.07 - z * 0.11 + 2.0);
  hill = Math.max(0, hill) * (0.9 + 1.6 * smooth(18, 34, e));
  // keep the river valley and the lake basin low
  const dr = Math.abs(x - riverX(z));
  hill *= smooth(0.8, 4.0, dr);
  const ld = lakeD(x, z);
  hill *= smooth(1.0, 2.2, ld);
  let h = core * (1 - k) + hill * k;
  if (ld < 1.25) h = Math.min(h, LAKE_Y - 0.12 + (ld - 1) * 0.6);
  const rd = 1 - smooth(RIVER_HALF * 0.5, RIVER_HALF + 0.4, dr);
  return h - 0.2 * rd * k;
}

/** District index 0..15 (zone_01..zone_16) at a ground point, or -1 outside the city. */
export function zoneAt(x: number, z: number): number {
  const dx = x - CITY.cx;
  const dz = z - CITY.cz;
  const r = Math.hypot(dx, dz);
  if (r < CITY.r0) return dz < 0 ? (dx >= 0 ? 0 : 1) : dx < 0 ? 2 : 3;
  const a = Math.atan2(dz, dx) + Math.PI; // 0..2pi
  if (r < CITY.r1) return 4 + (Math.floor((a / (Math.PI * 2)) * 6) % 6);
  if (r < CITY.r2) return 10 + (Math.floor(((a + Math.PI / 6) / (Math.PI * 2)) * 6) % 6);
  return -1;
}

export const DT_GRID = 0.9; // downtown street spacing

/** True when the point is on a city road (ring roads, radial roads, downtown grid). */
export function onRoad(x: number, z: number, pad = 0): boolean {
  const w = ROAD_HALF + pad;
  const dx = x - CITY.cx;
  const dz = z - CITY.cz;
  const r = Math.hypot(dx, dz);
  if (r > CITY.r2 + w) return false;
  if (Math.abs(r - CITY.r0) < w || Math.abs(r - CITY.r1) < w || Math.abs(r - CITY.r2) < w) return true;
  const a = Math.atan2(dz, dx) + Math.PI;
  const step = Math.PI / 3;
  if (r < CITY.r0) {
    const gx = Math.abs(((dx / DT_GRID + 0.5) % 1 + 1) % 1 - 0.5) * DT_GRID;
    const gz = Math.abs(((dz / DT_GRID + 0.5) % 1 + 1) % 1 - 0.5) * DT_GRID;
    return gx < w || gz < w;
  }
  const off = r < CITY.r1 ? 0 : Math.PI / 6;
  const k = Math.round((a + off) / step);
  const da = a + off - k * step;
  return Math.abs(Math.sin(da)) * r < w;
}

// ------------------------------------------------------------------ seeded random
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ structures
export type V2 = [number, number];

export const GAS_PLANTS: V2[] = [
  [-10.0, -9.2],
  [-7.7, -9.5],
  [-5.4, -9.2],
];
export const COAL: V2 = [1.2, -9.5];
export const NUCLEAR: V2 = [4.6, -9.0];
export const COOLING: V2[] = [
  [3.7, -10.5],
  [5.5, -10.6],
];
export const COMPRESSOR: V2 = [-8.6, -4.4];
export const HOSPITAL: V2 = [-1.3, 10.0];
export const WATER: V2[] = [
  [-2.85, 8.3],
  [-2.75, 7.4],
];
export const SUBSTATIONS: V2[] = [
  [-0.8, -5.4],
  [3.5, -5.9],
  [7.4, -4.4],
];
export const TURBINES: V2[] = [
  [7.9, -11.0], [9.4, -11.0], [10.9, -11.0],
  [8.65, -9.6], [10.15, -9.6],
  [7.9, -8.2], [9.4, -8.2], [10.9, -8.2],
  [8.65, -6.8], [10.15, -6.8],
];
export const TURBINE_H = 2.0;
export const ROTOR_R = 0.72;
export const SOLAR_RECT = { x0: 8.3, x1: 11.4, z0: -5.3, z1: -2.9 };
export const TRUNK_X = -8.6;
export const MANIFOLD_Z = -7.5;

/** Anchors for labels / callouts (world xyz). */
export const ANCHORS = {
  field: [-8.9, 1.6, 3.6] as [number, number, number],
  compressor: [COMPRESSOR[0] + 0.55, 0.75, COMPRESSOR[1]] as [number, number, number],
  gasplants: [-7.7, 3.3, -9.6] as [number, number, number],
  city: [CITY.cx, 4.0, CITY.cz] as [number, number, number],
  hospital: [HOSPITAL[0], 1.5, HOSPITAL[1]] as [number, number, number],
  wind: [7.4, 2.2, -9.0] as [number, number, number],
  gauge: [TRUNK_X + 1.6, 1.0, -1.2] as [number, number, number],
};

// ------------------------------------------------------------------ plants (bars + badges)
export interface PlantSlot {
  id: string;
  name: string;
  /** where the capacity bar stands */
  bar: V2;
  /** label anchor height */
  labelY: number;
}
export const PLANT_SLOTS: PlantSlot[] = [
  { id: "gas1", name: "Gas 1", bar: [GAS_PLANTS[0][0] - 0.95, GAS_PLANTS[0][1] + 0.35], labelY: 1.9 },
  { id: "gas2", name: "Gas 2", bar: [GAS_PLANTS[1][0] - 0.95, GAS_PLANTS[1][1] + 0.35], labelY: 1.9 },
  { id: "gas3", name: "Gas 3", bar: [GAS_PLANTS[2][0] - 0.95, GAS_PLANTS[2][1] + 0.35], labelY: 1.9 },
  { id: "coal", name: "Coal", bar: [COAL[0] - 1.0, COAL[1] + 0.6], labelY: 2.6 },
  { id: "nuclear", name: "Nuclear", bar: [NUCLEAR[0] - 0.95, NUCLEAR[1] + 0.55], labelY: 2.3 },
  { id: "wind", name: "Wind", bar: [7.3, -7.4], labelY: 2.9 },
  { id: "solar", name: "Solar", bar: [8.0, -3.0], labelY: 1.2 },
];
export const BAR_H = 1.1;

// ------------------------------------------------------------------ gas field
export interface Jack {
  x: number;
  z: number;
  y: number;
  rot: number;
  phase: number;
}

export function makeJacks(): Jack[] {
  const r = rng(11);
  const out: Jack[] = [];
  let guard = 0;
  while (out.length < 12 && guard++ < 4000) {
    const x = -11.2 + r() * 4.8;
    const z = -1.4 + r() * 12.0;
    if (x > riverX(z) - 1.1) continue;
    if (Math.abs(x - TRUNK_X) < 0.55) continue;
    if (out.some((j) => Math.hypot(j.x - x, j.z - z) < 1.15)) continue;
    out.push({ x, z, y: terrainH(x, z), rot: r() * Math.PI * 2, phase: r() * Math.PI * 2 });
  }
  return out;
}

// ------------------------------------------------------------------ transmission
export interface LineDef {
  id: number;
  pts: V2[];
}
const S = SUBSTATIONS;
const gOut = (k: number): V2 => [GAS_PLANTS[k][0] + 0.55, -10.5];
const cityEdge = (deg: number, r: number): V2 => [
  CITY.cx + Math.cos((deg * Math.PI) / 180) * r,
  CITY.cz + Math.sin((deg * Math.PI) / 180) * r,
];
export const LINES: LineDef[] = [
  { id: 0, pts: [gOut(0), gOut(1)] },
  { id: 1, pts: [gOut(1), gOut(2)] },
  { id: 2, pts: [gOut(2), [-2.2, -10.5], [-1.1, -7.6], [S[0][0] - 0.1, S[0][1] - 0.35]] },
  { id: 3, pts: [[COAL[0] + 0.7, -8.75], [2.8, -7.4], [S[1][0] - 0.2, S[1][1] - 0.3]] },
  { id: 4, pts: [[NUCLEAR[0] + 0.9, -8.35], [4.4, -7.2], [S[1][0] + 0.2, S[1][1] - 0.3]] },
  { id: 5, pts: [[8.0, -6.1], [S[2][0] + 0.2, S[2][1] - 0.3]] },
  { id: 6, pts: [[8.2, -3.9], [S[2][0] + 0.35, S[2][1] + 0.1]] },
  { id: 7, pts: [[S[0][0] + 0.4, S[0][1] - 0.1], [1.4, -5.9], [S[1][0] - 0.4, S[1][1]]] },
  { id: 8, pts: [[S[1][0] + 0.4, S[1][1]], [5.6, -5.4], [S[2][0] - 0.4, S[2][1]]] },
  { id: 9, pts: [[S[0][0], S[0][1] + 0.4], [-1.6, -1.6], cityEdge(-150, CITY.r2 + 0.5), cityEdge(-150, CITY.r1 + 0.25)] },
  { id: 10, pts: [[S[1][0], S[1][1] + 0.4], cityEdge(-90, CITY.r2 + 0.4), cityEdge(-90, CITY.r1 + 0.25)] },
  { id: 11, pts: [[S[2][0], S[2][1] + 0.4], [9.0, -2.0], cityEdge(-30, CITY.r2 + 0.5), cityEdge(-30, CITY.r1 + 0.25)] },
  { id: 12, pts: [[S[0][0] - 0.45, S[0][1]], [-3.2, -4.7], [-5.8, -4.5], [COMPRESSOR[0] + 0.75, COMPRESSOR[1]]] },
];
export const LINE_COUNT = 13;
export const CITY_FEEDS: V2[] = [cityEdge(-150, CITY.r1 + 0.25), cityEdge(-90, CITY.r1 + 0.25), cityEdge(-30, CITY.r1 + 0.25)];

/** Pylon positions along every line (vertices + intermediate points, spacing <= maxSpan). */
export function pylonPoints(line: LineDef, maxSpan = 1.7): V2[] {
  const out: V2[] = [line.pts[0]];
  for (let i = 1; i < line.pts.length; i++) {
    const [ax, az] = line.pts[i - 1];
    const [bx, bz] = line.pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxSpan));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// ------------------------------------------------------------------ pipeline
export interface PipeDef {
  /** 0 = wells -> compressor (production), 1 = compressor -> manifold (supply), 2..4 = branch to gas plant k */
  seg: number;
  pts: V2[];
  radius: number;
  /** distance offset so dashes flow continuously from upstream pipes */
  t0: number;
}

export function makePipes(jacks: Jack[]): PipeDef[] {
  const pipes: PipeDef[] = [];
  const zMax = Math.max(...jacks.map((j) => j.z)) + 0.3;
  pipes.push({ seg: 0, pts: [[TRUNK_X, zMax], [TRUNK_X, COMPRESSOR[1] + 0.4]], radius: 0.075, t0: 0 });
  for (const j of jacks) {
    const hx = j.x + Math.cos(j.rot) * 0.32;
    const hz = j.z - Math.sin(j.rot) * 0.32;
    pipes.push({ seg: 0, pts: [[hx, hz], [TRUNK_X, hz]], radius: 0.03, t0: -Math.abs(TRUNK_X - hx) });
  }
  const tTrunk = zMax - (COMPRESSOR[1] + 0.4);
  pipes.push({ seg: 1, pts: [[TRUNK_X, COMPRESSOR[1] - 0.4], [TRUNK_X, MANIFOLD_Z]], radius: 0.075, t0: tTrunk + 0.8 });
  const t1 = tTrunk + 0.8 + (COMPRESSOR[1] - 0.4 - MANIFOLD_Z);
  pipes.push({ seg: 1, pts: [[TRUNK_X, MANIFOLD_Z], [GAS_PLANTS[0][0], MANIFOLD_Z]], radius: 0.06, t0: t1 });
  pipes.push({ seg: 1, pts: [[TRUNK_X, MANIFOLD_Z], [GAS_PLANTS[2][0], MANIFOLD_Z]], radius: 0.06, t0: t1 });
  GAS_PLANTS.forEach(([px, pz], k) => {
    const dx = Math.abs(px - TRUNK_X);
    pipes.push({ seg: 2 + k, pts: [[px, MANIFOLD_Z], [px, pz + 0.42]], radius: 0.045, t0: t1 + dx });
  });
  return pipes;
}
