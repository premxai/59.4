// Geometry builders. Built once per page (module-level cache) and shared by every GridCity instance:
// static props are merged into ONE vertex-coloured mesh, everything repeated is instanced.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CITY, CITY_FEEDS, COAL, COMPRESSOR, COOLING, GAS_PLANTS, HALF, HOSPITAL, L_COAL, L_CRIT, L_GAS, L_GAS1, L_GRID,
  L_NUC, LAKE, LAKE_Y, LINES, NUCLEAR, PLANT_SLOTS, RIVER_HALF, ROTOR_R, SOLAR_RECT, SUBSTATIONS, TURBINES, TURBINE_H, WATER,
  inLake, makeJacks, makePipes, onRoad, outerH, pylonPoints, riverX, rng, terrainCore, terrainH, zoneAt, type Jack, type V2,
} from "./layout";
import type { GridLook } from "./types";

const SINK = 0.15;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ------------------------------------------------------------------ unit geometries
const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const unitCyl = (seg = 10) => new THREE.CylinderGeometry(1, 1, 1, seg).translate(0, 0.5, 0);
const unitCone = (seg = 7) => new THREE.ConeGeometry(1, 1, seg).translate(0, 0.5, 0);

function coolingTower(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = 0.5 + 0.5 * Math.pow(Math.abs(t - 0.68) / 0.68, 1.7) * (t < 0.68 ? 1 : 0.35);
    pts.push(new THREE.Vector2(r, t));
  }
  return new THREE.LatheGeometry(pts, 18);
}

// ------------------------------------------------------------------ merged static props
/** "gridleaf" look: daylight clay palette for the props (night colour -> leaf colour). */
const LEAF_PALETTE: Record<string, string> = {
  "#3b404b": "#d9d3c6", "#8b909b": "#dedbd4", "#a83a30": "#e0664f", "#7f848f": "#d8d4cc", "#16161b": "#57524b",
  "#4a4f5a": "#bdb7ab", "#c7cad1": "#f1eee8", "#cfd2d8": "#f7f5f0", "#a9adb6": "#e9e5dd", "#6b7280": "#a7bcc5",
  "#343944": "#d2ccbf", "#7d8592": "#93a6ae", "#9aa3b0": "#bcc3ca", "#3a3f49": "#ddd7cb", "#d9534f": "#e45c4f",
  "#c9d1dc": "#eef2f4", "#22405e": "#5fb0c8", "#d9dde4": "#fafaf8", "#e3e6eb": "#fdfdfc", "#1b3768": "#2f5b9f",
  "#5a606b": "#a2a7ad", "#2b2622": "#b3a189", "#3a3f4a": "#8a8680", "#5d6472": "#959aa2", "#2f6f8f": "#3f93b5",
  "#9a6b3c": "#c48d52", "#8792a6": "#a8b0bc", "#1d3a2f": "#5fa060", "#24443a": "#4e8c57", "#2a2d33": "#62656b",
  "#3b3f47": "#72767d", "#e9ecf1": "#ffffff", "#eef1f5": "#ffffff", "#d29a1e": "#e0a62a",
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class PropBuilder {
  parts: THREE.BufferGeometry[] = [];
  /** leaf: palette remap + flat (low-poly) normals + baked contact shadow near the ground */
  constructor(
    private leaf = false,
    private ao = leaf,
  ) {}
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    if (this.leaf) g.computeVertexNormals();
    const c = new THREE.Color(this.leaf && typeof color === "string" ? (LEAF_PALETTE[color.toLowerCase()] ?? color) : color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      let k = 1;
      if (this.ao) {
        const above = pos.getY(i) - outerH(pos.getX(i), pos.getZ(i));
        k = 0.66 + 0.34 * smoothstep(-0.02, 0.32, above);
      }
      arr[i * 3] = c.r * k;
      arr[i * 3 + 1] = c.g * k;
      arr[i * 3 + 2] = c.b * k;
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    return g ?? new THREE.BufferGeometry();
  }
}

// ------------------------------------------------------------------ instanced buildings
export interface BuildingSet {
  matrices: Float32Array;
  zone: Float32Array;
  seed: Float32Array;
  kind: Float32Array;
  count: number;
}

class BuildingBuilder {
  m: number[] = [];
  zone: number[] = [];
  seed: number[] = [];
  kind: number[] = [];
  add(x: number, z: number, w: number, h: number, d: number, rot: number, zone: number, kind: number, seed: number, y0?: number) {
    const y = (y0 ?? terrainH(x, z)) - SINK;
    this.m.push(...mat(x, y, z, rot, w, h + SINK, d).elements);
    this.zone.push(zone);
    this.kind.push(kind);
    this.seed.push(seed);
  }
  build(): BuildingSet {
    return {
      matrices: new Float32Array(this.m),
      zone: new Float32Array(this.zone),
      seed: new Float32Array(this.seed),
      kind: new Float32Array(this.kind),
      count: this.zone.length,
    };
  }
}

/** Coarse occupancy grid so trees / houses don't overlap structures. */
class Occ {
  cells = new Set<string>();
  key = (x: number, z: number) => `${Math.floor(x / 0.25)},${Math.floor(z / 0.25)}`;
  mark(x: number, z: number, rx: number, rz: number) {
    for (let a = x - rx; a <= x + rx + 1e-6; a += 0.25) for (let b = z - rz; b <= z + rz + 1e-6; b += 0.25) this.cells.add(this.key(a, b));
  }
  free(x: number, z: number) {
    return !this.cells.has(this.key(x, z));
  }
}

// ------------------------------------------------------------------ the whole static world
export interface StreetLights {
  matrices: Float32Array;
  zone: Float32Array;
  count: number;
}

export interface Lamps {
  matrices: Float32Array;
  blink: Float32Array;
  count: number;
}

export interface World {
  terrain: THREE.BufferGeometry;
  river: THREE.BufferGeometry;
  props: THREE.BufferGeometry;
  buildings: BuildingSet;
  roofs: BuildingSet;
  streetLights: StreetLights;
  lamps: Lamps;
  pipes: THREE.BufferGeometry;
  lines: THREE.BufferGeometry;
  jacks: Jack[];
  jackBeam: THREE.BufferGeometry;
  rotor: THREE.BufferGeometry;
  /** steam emitters: gas plant stacks (6), coal stack, nuclear cooling towers (2) */
  emitters: { pos: THREE.Vector3; scale: number; plant: number }[];
  /** bar base positions (x, y, z) per plant slot */
  bars: THREE.Vector3[];
  stats: { buildings: number; roofs: number; lights: number; props: number };
  look: GridLook;
  /** gridleaf only: rolling countryside around the plate (same ground material) */
  outer?: THREE.BufferGeometry;
  /** gridleaf only: the lake (water material) */
  lake?: THREE.BufferGeometry;
  /** gridleaf only: baked soft cast shadows + contact occlusion on the ground (R8, covers +-SHADOW_EXT) */
  shadow?: THREE.DataTexture;
}

/** Half-size (world units) of the area covered by the baked ground shadow texture. */
export const SHADOW_EXT = 26;
/** Fixed gridleaf sun direction (the shadows are baked for it). */
export const LEAF_SUN = new THREE.Vector3(-0.45, 0.78, 0.45).normalize();

interface Caster {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  h: number;
  round?: boolean;
}

/** One-time CPU bake: footprints swept away from the sun, blurred -> soft shadows (no realtime shadow maps). */
function bakeShadows(casters: Caster[]): THREE.DataTexture {
  const N = 640;
  const cell = (SHADOW_EXT * 2) / N;
  const g = new Float32Array(N * N);
  const ox = -LEAF_SUN.x / LEAF_SUN.y;
  const oz = -LEAF_SUN.z / LEAF_SUN.y;
  const stamp = (c: Caster, sx: number, sz: number, v: number) => {
    const cx = c.x + sx;
    const cz = c.z + sz;
    const r = Math.hypot(c.w, c.d) / 2 + cell;
    const i0 = Math.max(0, Math.floor((cx - r + SHADOW_EXT) / cell));
    const i1 = Math.min(N - 1, Math.ceil((cx + r + SHADOW_EXT) / cell));
    const j0 = Math.max(0, Math.floor((cz - r + SHADOW_EXT) / cell));
    const j1 = Math.min(N - 1, Math.ceil((cz + r + SHADOW_EXT) / cell));
    const co = Math.cos(c.rot);
    const si = Math.sin(c.rot);
    for (let j = j0; j <= j1; j++) {
      const pz = (j + 0.5) * cell - SHADOW_EXT - cz;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * cell - SHADOW_EXT - cx;
        let inside: boolean;
        if (c.round) inside = px * px + pz * pz <= (c.w / 2) * (c.w / 2);
        else {
          const lx = px * co - pz * si;
          const lz = px * si + pz * co;
          inside = Math.abs(lx) <= c.w / 2 && Math.abs(lz) <= c.d / 2;
        }
        if (inside) {
          const k = j * N + i;
          if (g[k] < v) g[k] = v;
        }
      }
    }
  };
  for (const c of casters) {
    if (Math.abs(c.x) > SHADOW_EXT || Math.abs(c.z) > SHADOW_EXT) continue;
    const len = Math.min(2.2, c.h * 0.7);
    const steps = Math.max(1, Math.ceil((len * Math.hypot(ox, oz)) / cell));
    for (let k = 0; k <= steps; k++) {
      const t = (k / steps) * len;
      stamp(c, ox * t, oz * t, 1 - 0.45 * (k / steps));
    }
    // contact occlusion: a slightly larger, faint footprint
    stamp({ ...c, w: c.w + 0.12, d: c.d + 0.12 }, 0, 0, 0.55);
  }
  // separable box blur, 2 passes
  const tmp = new Float32Array(N * N);
  const R = 2;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < N; j++) {
      let acc = 0;
      for (let i = -R; i <= R; i++) acc += g[j * N + Math.min(N - 1, Math.max(0, i))];
      for (let i = 0; i < N; i++) {
        tmp[j * N + i] = acc / (2 * R + 1);
        acc += g[j * N + Math.min(N - 1, i + R + 1)] - g[j * N + Math.max(0, i - R)];
      }
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -R; j <= R; j++) acc += tmp[Math.min(N - 1, Math.max(0, j)) * N + i];
      for (let j = 0; j < N; j++) {
        g[j * N + i] = acc / (2 * R + 1);
        acc += tmp[Math.min(N - 1, j + R + 1) * N + i] - tmp[Math.max(0, j - R) * N + i];
      }
    }
  }
  const data = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) data[k] = Math.min(255, Math.round(g[k] * 255));
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const cached: Partial<Record<GridLook, World>> = {};

export function getWorld(look: GridLook = "night"): World {
  return (cached[look] ??= buildWorld(look));
}

function buildWorld(look: GridLook): World {
  const leaf = look === "gridleaf";
  const casters: Caster[] = [];
  const R = rng(4242);
  const P = new PropBuilder(leaf);
  const B = new BuildingBuilder();
  const roofs = new BuildingBuilder();
  const occ = new Occ();
  const box = unitBox();
  const cyl = unitCyl();
  const cone = unitCone();
  const cone4 = new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0);
  const hemi = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const tower = coolingTower();
  const T = terrainH;

  // ---- base slab (the gridleaf look continues the land outward instead)
  if (!leaf) {
    P.add(box, "#121a2c", mat(0, -1.52, 0, 0, HALF * 2, 1.2, HALF * 2));
    P.add(box, "#1f2a42", mat(0, -0.42, 0, 0, HALF * 2 + 0.06, 0.1, HALF * 2 + 0.06));
  }

  const pad = (x: number, z: number, w: number, d: number, color = "#3b404b") => {
    P.add(box, color, mat(x, T(x, z) - 0.2, z, 0, w, 0.24, d));
    occ.mark(x, z, w / 2 + 0.1, d / 2 + 0.1);
  };

  // ---- gas plants
  GAS_PLANTS.forEach(([x, z], k) => {
    pad(x + 0.1, z, 2.2, 1.7);
    B.add(x - 0.15, z, 1.1, 0.62, 0.78, 0, L_GAS1 + k, 3, R());
    B.add(x + 0.72, z + 0.12, 0.62, 0.42, 0.56, 0, L_GAS1 + k, 3, R());
    for (const sx of [-0.45, 0.05]) {
      const y = T(x + sx, z - 0.55);
      P.add(cyl, "#8b909b", mat(x + sx, y - 0.1, z - 0.55, 0, 0.085, 1.55, 0.085));
      P.add(cyl, "#a83a30", mat(x + sx, y + 1.22, z - 0.55, 0, 0.09, 0.09, 0.09));
    }
  });

  // ---- coal
  {
    const [x, z] = COAL;
    pad(x - 0.1, z - 0.1, 2.9, 2.3);
    B.add(x, z - 0.1, 0.9, 1.15, 0.8, 0, L_COAL, 3, R());
    B.add(x + 0.2, z + 0.62, 1.05, 0.55, 0.55, 0, L_COAL, 3, R());
    const sy = T(x + 0.8, z - 0.65);
    P.add(cyl, "#7f848f", mat(x + 0.8, sy - 0.1, z - 0.65, 0, 0.13, 2.4, 0.13));
    P.add(cyl, "#a83a30", mat(x + 0.8, sy + 2.0, z - 0.65, 0, 0.135, 0.1, 0.135));
    P.add(cone, "#16161b", mat(x - 1.0, T(x - 1.0, z - 0.85) - 0.05, z - 0.85, 0, 0.62, 0.34, 0.55));
    P.add(box, "#4a4f5a", mat(x - 0.55, T(x, z) + 0.2, z - 0.5, -0.5, 0.75, 0.05, 0.08, 0, 0.35));
  }

  // ---- nuclear
  {
    const [x, z] = NUCLEAR;
    pad(x + 0.3, z - 0.6, 3.6, 3.2);
    const y = T(x, z);
    P.add(cyl, "#c7cad1", mat(x, y - 0.1, z, 0, 0.44, 0.55, 0.44));
    P.add(hemi, "#cfd2d8", mat(x, y + 0.45, z, 0, 0.44, 0.44, 0.44));
    B.add(x + 0.95, z + 0.15, 1.1, 0.5, 0.62, 0, L_NUC, 3, R());
    B.add(x - 0.15, z + 0.72, 0.55, 0.35, 0.45, 0, L_NUC, 3, R());
    COOLING.forEach(([cx, cz], i) => {
      const s = i === 0 ? 0.72 : 0.62;
      P.add(tower, "#a9adb6", mat(cx, T(cx, cz) - 0.05, cz, 0, s, 1.75 * s / 0.72, s));
    });
  }

  // ---- compressor station
  {
    const [x, z] = COMPRESSOR;
    pad(x, z, 1.9, 1.5);
    B.add(x + 0.05, z, 1.0, 0.5, 0.64, 0, L_GAS, 3, R());
    P.add(box, "#6b7280", mat(x - 0.55, T(x, z), z + 0.45, 0, 0.32, 0.18, 0.3));
    P.add(box, "#6b7280", mat(x + 0.55, T(x, z), z + 0.45, 0, 0.32, 0.18, 0.3));
    P.add(cyl, "#8b909b", mat(x + 0.35, T(x, z), z - 0.12, 0, 0.05, 0.85, 0.05));
    P.add(cyl, "#8b909b", mat(x - 0.25, T(x, z), z - 0.12, 0, 0.05, 0.85, 0.05));
  }

  // ---- substations (+ small city substations at the feed ends)
  SUBSTATIONS.forEach(([x, z]) => {
    pad(x, z, 1.15, 0.95, "#343944");
    B.add(x + 0.32, z + 0.25, 0.3, 0.22, 0.26, 0, L_GRID, 3, R());
    for (const dx of [-0.35, -0.1, 0.15]) P.add(box, "#7d8592", mat(x + dx, T(x, z), z - 0.2, 0, 0.16, 0.22, 0.16));
    for (const dx of [-0.45, 0.45]) P.add(box, "#9aa3b0", mat(x + dx, T(x, z), z - 0.35, 0, 0.025, 0.55, 0.025));
    P.add(box, "#9aa3b0", mat(x, T(x, z) + 0.53, z - 0.35, 0, 0.92, 0.025, 0.025));
  });
  CITY_FEEDS.forEach(([x, z]) => {
    P.add(box, "#7d8592", mat(x, T(x, z), z, 0, 0.18, 0.2, 0.18));
    occ.mark(x, z, 0.2, 0.2);
  });

  // ---- hospital + water plant (zone_crit)
  {
    const [x, z] = HOSPITAL;
    pad(x + 0.2, z, 2.3, 1.6, "#3a3f49");
    B.add(x, z, 1.25, 0.85, 0.75, 0, L_CRIT, 4, R());
    B.add(x + 0.85, z + 0.25, 0.7, 0.5, 0.55, 0, L_CRIT, 4, R());
    P.add(cyl, "#d9534f", mat(x - 0.2, T(x, z) + 0.86, z, 0, 0.18, 0.012, 0.18));
    for (const [wx, wz] of WATER) {
      P.add(cyl, "#c9d1dc", mat(wx, T(wx, wz) - 0.05, wz, 0, 0.32, 0.4, 0.32));
      occ.mark(wx, wz, 0.4, 0.4);
    }
    P.add(cyl, "#22405e", mat(-1.95, T(-1.95, 8.95) - 0.02, 8.95, 0, 0.42, 0.06, 0.42));
    occ.mark(-1.95, 8.95, 0.45, 0.45);
    B.add(-2.05, 7.75, 0.42, 0.25, 0.32, 0.3, L_CRIT, 3, R());
  }

  // ---- wind farm towers + nacelles (rotors are instanced/animated)
  for (const [x, z] of TURBINES) {
    const y = T(x, z);
    P.add(new THREE.CylinderGeometry(0.028, 0.06, 1, 8).translate(0, 0.5, 0), "#d9dde4", mat(x, y - 0.05, z, 0, 1, TURBINE_H + 0.05, 1));
    P.add(box, "#e3e6eb", mat(x, y + TURBINE_H - 0.04, z - 0.04, 0, 0.09, 0.09, 0.24));
    occ.mark(x, z, 0.3, 0.3);
  }

  // ---- solar field (snow-covered by the shader when it snows)
  {
    const { x0, x1, z0, z1 } = SOLAR_RECT;
    for (let z = z0; z <= z1; z += 0.42) {
      for (let x = x0; x <= x1; x += 0.52) {
        P.add(box, "#1b3768", mat(x, T(x, z) + 0.12, z, 0, 0.46, 0.025, 0.3, -0.45));
        P.add(box, "#5a606b", mat(x, T(x, z) - 0.05, z, 0, 0.03, 0.17, 0.03));
      }
    }
    occ.mark((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 0.3, (z1 - z0) / 2 + 0.3);
  }

  // ---- pumpjacks: skid, samson post, motor, wellhead (beam is animated separately)
  const jacks = makeJacks();
  for (const j of jacks) {
    const at = (lx: number, lz: number): [number, number] => [j.x + Math.cos(j.rot) * lx + Math.sin(j.rot) * lz, j.z - Math.sin(j.rot) * lx + Math.cos(j.rot) * lz];
    P.add(box, "#2b2622", mat(j.x, j.y - 0.18, j.z, j.rot, 0.95, 0.2, 0.55));
    P.add(box, "#3a3f4a", mat(j.x, j.y, j.z, j.rot, 0.62, 0.05, 0.17));
    for (const lz of [-0.055, 0.055]) {
      const [px, pz] = at(-0.02, lz);
      P.add(box, "#5d6472", mat(px, j.y, pz, j.rot, 0.035, 0.42, 0.03, 0, lz > 0 ? -0.06 : 0.06));
    }
    const [mx, mz] = at(-0.24, 0);
    P.add(box, "#2f6f8f", mat(mx, j.y + 0.04, mz, j.rot, 0.13, 0.11, 0.12));
    const [wx, wz] = at(0.32, 0);
    P.add(cyl, "#9a6b3c", mat(wx, j.y, wz, 0, 0.03, 0.14, 0.03));
    occ.mark(j.x, j.z, 0.45, 0.45);
  }

  // ---- pylons along every line
  for (const line of LINES) {
    const pts = pylonPoints(line);
    pts.forEach(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) + Math.PI / 2;
      const y = T(x, z);
      P.add(cone4, "#8792a6", mat(x, y - 0.05, z, ang + Math.PI / 4, 0.09, 0.85, 0.09));
      P.add(box, "#8792a6", mat(x, y + 0.68, z, ang, 0.36, 0.025, 0.025));
      occ.mark(x, z, 0.15, 0.15);
    });
  }

  // ---- city: downtown towers, inner-ring mid-rises, suburban houses + roofs
  const placeOk = (x: number, z: number, w: number, d: number, rot: number, zone: number) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) {
      const px = x + lx * c + lz * s;
      const pz = z - lx * s + lz * c;
      if (zoneAt(px, pz) !== zone || onRoad(px, pz, 0.04)) return false;
      if (Math.abs(px - riverX(pz)) < RIVER_HALF + 0.5 || !occ.free(px, pz)) return false;
      if (Math.abs(px) > HALF - 0.5 || Math.abs(pz) > HALF - 0.5) return false;
    }
    return true;
  };
  const span = CITY.r2 + 0.2;
  // downtown
  for (let gx = -span; gx < span; gx += 0.45) {
    for (let gz = -span; gz < span; gz += 0.45) {
      const x = CITY.cx + gx + 0.225;
      const z = CITY.cz + gz + 0.225;
      const zone = zoneAt(x, z);
      if (zone < 0 || zone > 3) continue;
      const r = Math.hypot(x - CITY.cx, z - CITY.cz) / CITY.r0;
      const w = 0.3 + R() * 0.08;
      if (!placeOk(x, z, w, w, 0, zone)) continue;
      const h = 0.7 + 2.5 * Math.pow(1 - r, 1.3) * (0.55 + 0.45 * R());
      B.add(x, z, w, h, w * (0.85 + R() * 0.3), 0, zone, 0, R());
      occ.mark(x, z, w / 2, w / 2);
    }
  }
  // inner ring
  for (let gx = -span; gx < span; gx += 0.52) {
    for (let gz = -span; gz < span; gz += 0.52) {
      const x = CITY.cx + gx + (R() - 0.5) * 0.12;
      const z = CITY.cz + gz + (R() - 0.5) * 0.12;
      const zone = zoneAt(x, z);
      if (zone < 4 || zone > 9) continue;
      const rot = -Math.atan2(z - CITY.cz, x - CITY.cx);
      const w = 0.3 + R() * 0.14;
      const d = 0.26 + R() * 0.1;
      if (!placeOk(x, z, w, d, rot, zone)) continue;
      const r = (Math.hypot(x - CITY.cx, z - CITY.cz) - CITY.r0) / (CITY.r1 - CITY.r0);
      B.add(x, z, w, 0.32 + (1 - r) * 0.6 * (0.5 + R() * 0.5), d, rot, zone, 1, R());
      occ.mark(x, z, w / 2, w / 2);
    }
  }
  // suburbs
  for (let gx = -span; gx < span; gx += 0.4) {
    for (let gz = -span; gz < span; gz += 0.4) {
      const x = CITY.cx + gx + (R() - 0.5) * 0.1;
      const z = CITY.cz + gz + (R() - 0.5) * 0.1;
      const zone = zoneAt(x, z);
      if (zone < 10) continue;
      if (R() < 0.18) continue;
      const rot = -Math.atan2(z - CITY.cz, x - CITY.cx) + Math.PI / 2;
      const w = 0.22 + R() * 0.05;
      const d = 0.18 + R() * 0.04;
      if (!placeOk(x, z, w, d, rot, zone)) continue;
      const h = 0.13 + R() * 0.05;
      const seed = R();
      B.add(x, z, w, h, d, rot, zone, 2, seed);
      roofs.add(x, z, w * 1.12, 0.1 + R() * 0.03, d * 1.18, rot, zone, 5, seed, T(x, z) + h + SINK);
      occ.mark(x, z, 0.14, 0.14);
    }
  }

  // ---- trees (suburbs gaps + countryside), merged into props
  {
    const tr = rng(77);
    let placed = 0;
    // forest patches (low-frequency noise) outside the city, sparse trees in the suburbs
    const patch = (x: number, z: number) => Math.sin(x * 0.55 + 1.7) * Math.sin(z * 0.62 - 0.4) + 0.5 * Math.sin(x * 1.3 - z * 0.9);
    for (let i = 0; i < 8000 && placed < 230; i++) {
      const x = (tr() - 0.5) * (HALF * 2 - 1.2);
      const z = (tr() - 0.5) * (HALF * 2 - 1.2);
      const zone = zoneAt(x, z);
      const inCity = zone >= 0;
      if (inCity && zone < 10) continue;
      if (inCity && tr() < 0.45) continue;
      if (!inCity && patch(x, z) < 0.55) continue;
      if (onRoad(x, z, 0.06) || !occ.free(x, z)) continue;
      if (Math.abs(x - riverX(z)) < RIVER_HALF + 0.35) continue;
      if (Math.abs(x - -8.6) < 0.3 && z > -8 && z < 11) continue; // pipeline trunk
      if (x > 7 && z < -2.5) continue; // wind + solar
      if (z < -7.8 && x < 7) continue; // plant row
      const s = 0.13 + tr() * 0.1;
      const y = T(x, z);
      const g = tr() < 0.5 ? "#1d3a2f" : "#24443a";
      if (leaf) {
        casters.push({ x, z, w: s * 1.7, d: s * 1.7, rot: 0, h: s * 3.6, round: true });
        P.add(cyl, "#8a6a4a", mat(x, y - 0.03, z, 0, s * 0.18, s * 0.9, s * 0.18));
        P.add(cone, g, mat(x, y + s * 0.45, z, tr() * 6, s, s * 2.3, s));
        P.add(cone, g, mat(x, y + s * 1.5, z, tr() * 6, s * 0.72, s * 1.8, s * 0.72));
      } else {
        P.add(cone, g, mat(x, y - 0.03, z, tr() * 6, s, s * 2.6, s));
        P.add(cone, g, mat(x, y + s * 1.2, z, tr() * 6, s * 0.75, s * 2.0, s * 0.75));
      }
      occ.mark(x, z, 0.12, 0.12);
      placed++;
    }
  }

  // ---- street lights along city roads (glow, per zone)
  const sl: number[] = [];
  const slZone: number[] = [];
  const addLight = (x: number, z: number) => {
    const zone = zoneAt(x, z);
    if (zone < 0) return;
    if (Math.abs(x - riverX(z)) < RIVER_HALF + 0.3 || Math.abs(x) > HALF - 0.4 || Math.abs(z) > HALF - 0.4) return;
    sl.push(...mat(x, T(x, z) + 0.15, z, 0, 0.035, 0.035, 0.035).elements);
    slZone.push(zone);
  };
  for (const [r, step] of [[CITY.r0, 0.42], [CITY.r1, 0.42], [CITY.r2, 0.45]] as const) {
    const n = Math.round((Math.PI * 2 * r) / step);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r + (i % 2 ? 0.13 : -0.13);
      addLight(CITY.cx + Math.cos(a) * rr, CITY.cz + Math.sin(a) * rr);
    }
  }
  for (let k = 0; k < 6; k++) {
    for (const [r0, r1, off] of [[CITY.r0, CITY.r1, 0], [CITY.r1, CITY.r2, -Math.PI / 6]] as const) {
      const a = -Math.PI + (k * Math.PI) / 3 + off;
      for (let r = r0 + 0.3; r < r1 - 0.2; r += 0.42) {
        const side = (Math.round(r / 0.42) % 2 ? 1 : -1) * 0.13;
        addLight(CITY.cx + Math.cos(a) * r - Math.sin(a) * side, CITY.cz + Math.sin(a) * r + Math.cos(a) * side);
      }
    }
  }
  for (let g = -2; g <= 2; g++) {
    for (let t = -CITY.r0 + 0.2; t < CITY.r0 - 0.2; t += 0.45) {
      addLight(CITY.cx + g * 0.9 + 0.12, CITY.cz + t);
      addLight(CITY.cx + t, CITY.cz + g * 0.9 + 0.12);
    }
  }

  // ---- aviation / tower-top lamps (blinking red)
  const lampM: number[] = [];
  const lampB: number[] = [];
  const lamp = (x: number, y: number, z: number, blink: number, s = 0.045) => {
    lampM.push(...mat(x, y, z, 0, s, s, s).elements);
    lampB.push(blink);
  };
  for (const [x, z] of TURBINES) lamp(x, T(x, z) + TURBINE_H + 0.08, z - 0.04, 0.1 + R());
  lamp(COAL[0] + 0.8, T(COAL[0] + 0.8, COAL[1] - 0.65) + 2.36, COAL[1] - 0.65, 0.37, 0.06);
  for (const [x, z] of GAS_PLANTS) lamp(x - 0.45, T(x - 0.45, z - 0.55) + 1.48, z - 0.55, 0.2 + R(), 0.04);
  {
    // tallest downtown towers
    const tall: { i: number; h: number }[] = [];
    const bs = B.build();
    for (let i = 0; i < bs.count; i++) if (bs.kind[i] === 0) tall.push({ i, h: bs.matrices[i * 16 + 5] });
    tall.sort((a, b) => b.h - a.h);
    for (const { i } of tall.slice(0, 6)) {
      const e = bs.matrices.subarray(i * 16, i * 16 + 16);
      lamp(e[12], e[13] + e[5] + 0.03, e[14], 0.5 + R(), 0.035);
    }
  }

  // ---- river ribbon
  const river = (() => {
    const pos: number[] = [];
    const idx: number[] = [];
    let row = 0;
    const zr = leaf ? 46 : HALF - 0.42;
    for (let z = -zr; z <= zr + 1e-6; z += leaf && Math.abs(z) > HALF ? 0.6 : 0.2) {
      const x = riverX(z);
      const y = leaf && Math.abs(z) > HALF ? Math.min(-0.075, outerH(x, z) + 0.12) : -0.075;
      pos.push(x - RIVER_HALF * 1.3, y, z, x + RIVER_HALF * 1.3, y, z);
      if (row > 0) {
        const a = (row - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      row++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    return g;
  })();

  // ---- terrain
  const terrain = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 120, 120);
  terrain.rotateX(-Math.PI / 2);
  {
    const p = terrain.attributes.position as THREE.BufferAttribute;
    const H = leaf ? terrainCore : T;
    for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
    terrain.deleteAttribute("uv");
    terrain.computeVertexNormals();
  }

  // ---- pipes + lines
  const pipes = buildPipes(jacks);
  const lines = buildLines();

  // ---- animated parts
  const jackBeam = (() => {
    const pb = new PropBuilder(leaf, false);
    const bx = new THREE.BoxGeometry(1, 1, 1);
    pb.add(bx, "#d29a1e", mat(0, 0, 0, 0, 0.66, 0.05, 0.05));
    pb.add(bx, "#2a2d33", mat(0.34, -0.06, 0, 0, 0.07, 0.16, 0.06));
    pb.add(bx, "#3b3f47", mat(-0.3, -0.05, 0, 0, 0.11, 0.12, 0.08));
    return pb.build();
  })();
  const rotor = (() => {
    const pb = new PropBuilder(leaf, false);
    const bx = new THREE.BoxGeometry(1, 1, 1);
    pb.add(bx, "#e9ecf1", mat(0, 0, 0, 0, 0.07, 0.07, 0.07));
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      pb.add(bx, "#eef1f5", mat(Math.cos(a + Math.PI / 2) * ROTOR_R * 0.5, Math.sin(a + Math.PI / 2) * ROTOR_R * 0.5, 0, 0, 0.045, ROTOR_R, 0.012, 0, a));
    }
    return pb.build();
  })();

  // ---- steam emitters: 2 stacks per gas plant, coal stack, 2 cooling towers (= 9)
  const emitters: World["emitters"] = [];
  GAS_PLANTS.forEach(([x, z], k) => {
    for (const sx of [-0.45, 0.05]) emitters.push({ pos: new THREE.Vector3(x + sx, T(x + sx, z - 0.55) + 1.45, z - 0.55), scale: 0.8, plant: k });
  });
  emitters.push({ pos: new THREE.Vector3(COAL[0] + 0.8, T(COAL[0] + 0.8, COAL[1] - 0.65) + 2.3, COAL[1] - 0.65), scale: 1.1, plant: 3 });
  COOLING.forEach(([cx, cz], i) => {
    const s = i === 0 ? 0.72 : 0.62;
    emitters.push({ pos: new THREE.Vector3(cx, T(cx, cz) + (1.7 * s) / 0.72, cz), scale: (2.0 * s) / 0.72, plant: 4 });
  });

  const bars = PLANT_SLOTS.map((s) => new THREE.Vector3(s.bar[0], T(s.bar[0], s.bar[1]), s.bar[1]));

  // ---- gridleaf countryside: rolling hills, a lake, forest patches (own RNG: the night world is unchanged)
  let outer: THREE.BufferGeometry | undefined;
  let lake: THREE.BufferGeometry | undefined;
  if (leaf) {
    const OUT = 48;
    const og = new THREE.PlaneGeometry(OUT * 2, OUT * 2, 64, 64);
    og.rotateX(-Math.PI / 2);
    const p = og.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const e = Math.max(Math.abs(x), Math.abs(z));
      p.setY(i, e < HALF - 1e-3 ? outerH(x, z) - 0.6 : outerH(x, z));
    }
    og.deleteAttribute("uv");
    outer = og.toNonIndexed();
    og.dispose();
    outer.computeVertexNormals();

    // lake: a wobbly disc a little larger than the shoreline (the basin dips under it)
    const lp: number[] = [LAKE.x, LAKE_Y, LAKE.z];
    const N = 56;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const t = (1.22 - 0.12 * Math.sin(th * 3 + 0.7)) / Math.hypot(Math.cos(th) / LAKE.rx, Math.sin(th) / LAKE.rz);
      lp.push(LAKE.x + Math.cos(th) * t, LAKE_Y, LAKE.z + Math.sin(th) * t);
    }
    const li: number[] = [];
    for (let i = 1; i <= N; i++) li.push(0, i + 1, i);
    lake = new THREE.BufferGeometry();
    lake.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    lake.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(lp.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    lake.setIndex(li);

    // forest patches + scattered round trees + a few rocks
    const fr = rng(991);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const pine = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const greens = ["#6aa765", "#5c9a5c", "#78b06a", "#4f8d58"];
    const patch = (x: number, z: number) => Math.sin(x * 0.19 + 0.4) * Math.sin(z * 0.23 + 1.1) + 0.45 * Math.sin(x * 0.5 - z * 0.37);
    let placed = 0;
    for (let i = 0; i < 20000 && placed < 640; i++) {
      const x = (fr() - 0.5) * 2 * 40;
      const z = (fr() - 0.5) * 2 * 34;
      const e = Math.max(Math.abs(x), Math.abs(z));
      if (e < HALF + 0.5) continue;
      if (inLake(x, z, 0.35) || Math.abs(x - riverX(z)) < 1.3) continue;
      const dense = patch(x, z) > 0.35;
      if (!dense && fr() > 0.12) continue;
      const y = outerH(x, z);
      const s = (0.22 + fr() * 0.2) * (e > 26 ? 1.5 : 1);
      const g = greens[Math.floor(fr() * greens.length)];
      casters.push({ x, z, w: s * 1.6, d: s * 1.6, rot: 0, h: s * 2.4, round: true });
      if (fr() < 0.55) {
        P.add(cyl, "#8a6a4a", mat(x, y - 0.05, z, 0, s * 0.16, s * 1.0, s * 0.16));
        P.add(ico, g, mat(x, y + s * 1.25, z, fr() * 6, s * 0.85, s * 0.95, s * 0.85));
      } else {
        P.add(pine, g, mat(x, y - 0.03, z, fr() * 6, s * 0.75, s * 2.6, s * 0.75));
      }
      placed++;
    }
    for (let i = 0; i < 40; i++) {
      const x = (fr() - 0.5) * 2 * 30;
      const z = (fr() - 0.5) * 2 * 26;
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 0.8 || inLake(x, z, 0.2)) continue;
      const s = 0.12 + fr() * 0.22;
      P.add(rock, "#b9b4aa", mat(x, outerH(x, z) + s * 0.25, z, fr() * 6, s * 1.3, s * 0.8, s));
    }
    // reeds / bushes around the lake shore
    for (let i = 0; i < 26; i++) {
      const th = fr() * Math.PI * 2;
      const t = 1.3 + fr() * 0.35;
      const x = LAKE.x + Math.cos(th) * LAKE.rx * t;
      const z = LAKE.z + Math.sin(th) * LAKE.rz * t;
      const s = 0.14 + fr() * 0.1;
      P.add(ico, "#7fb36c", mat(x, outerH(x, z) + s * 0.4, z, fr() * 6, s, s * 0.7, s));
    }
    [ico, pine, rock].forEach((g) => g.dispose());
  }

  const buildings = B.build();
  const roofSet = roofs.build();
  const props = P.build();
  let shadow: THREE.DataTexture | undefined;
  if (leaf) {
    const e = buildings.matrices;
    for (let i = 0; i < buildings.count; i++) {
      const o = i * 16;
      const sx = Math.hypot(e[o], e[o + 1], e[o + 2]);
      const sy = Math.hypot(e[o + 4], e[o + 5], e[o + 6]);
      const sz = Math.hypot(e[o + 8], e[o + 9], e[o + 10]);
      const rot = Math.atan2(-e[o + 2], e[o]);
      casters.push({ x: e[o + 12], z: e[o + 14], w: sx, d: sz, rot, h: sy - SINK + (buildings.kind[i] === 2 ? 0.1 : 0) });
    }
    // round structures: cooling towers, reactor dome, stacks, turbines
    COOLING.forEach(([cx, cz], i) => casters.push({ x: cx, z: cz, w: i === 0 ? 1.3 : 1.1, d: 0, rot: 0, h: 1.6, round: true }));
    casters.push({ x: NUCLEAR[0], z: NUCLEAR[1], w: 0.9, d: 0, rot: 0, h: 0.9, round: true });
    for (const [x, z] of TURBINES) casters.push({ x, z, w: 0.12, d: 0, rot: 0, h: TURBINE_H, round: true });
    GAS_PLANTS.forEach(([x, z]) => {
      for (const sx of [-0.45, 0.05]) casters.push({ x: x + sx, z: z - 0.55, w: 0.17, d: 0, rot: 0, h: 1.5, round: true });
    });
    shadow = bakeShadows(casters);
  }
  [box, cyl, cone, cone4, hemi, tower].forEach((g) => g.dispose());
  return {
    terrain,
    river,
    props,
    buildings,
    roofs: roofSet,
    streetLights: { matrices: new Float32Array(sl), zone: new Float32Array(slZone), count: slZone.length },
    lamps: { matrices: new Float32Array(lampM), blink: new Float32Array(lampB), count: lampB.length },
    pipes,
    lines,
    jacks,
    jackBeam,
    rotor,
    emitters,
    bars,
    stats: { buildings: buildings.count, roofs: roofSet.count, lights: slZone.length, props: props.attributes.position.count },
    look,
    outer,
    lake,
    shadow,
  };
}

// ------------------------------------------------------------------ tubes with a distance attribute
function tube(points: THREE.Vector3[], radius: number, radial: number, attrs: Record<string, number>, t0: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const len = curve.getLength();
  const segs = Math.max(2, Math.ceil(len / 0.12));
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = uv.count;
  const at = new Float32Array(n);
  for (let i = 0; i < n; i++) at[i] = t0 + uv.getX(i) * len;
  g.setAttribute("aT", new THREE.BufferAttribute(at, 1));
  for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
  g.deleteAttribute("uv");
  return g;
}

function buildPipes(jacks: Jack[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const p of makePipes(jacks)) {
    const pts: THREE.Vector3[] = [];
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, az] = p.pts[i - 1];
      const [bx, bz] = p.pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.3));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        pts.push(new THREE.Vector3(x, Math.max(terrainH(x, z), -0.05) + 0.1 + p.radius, z));
      }
    }
    parts.push(tube(pts, p.radius, 6, { aSeg: p.seg }, p.t0));
  }
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

function buildLines(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const line of LINES) {
    const pyl: V2[] = pylonPoints(line);
    const pts: THREE.Vector3[] = [];
    for (let i = 1; i < pyl.length; i++) {
      const [ax, az] = pyl[i - 1];
      const [bx, bz] = pyl[i];
      const ya = terrainH(ax, az) + 0.7;
      const yb = terrainH(bx, bz) + 0.7;
      const span = Math.hypot(bx - ax, bz - az);
      const sag = 0.05 + span * 0.05;
      for (let k = i === 1 ? 0 : 1; k <= 8; k++) {
        const t = k / 8;
        pts.push(new THREE.Vector3(ax + (bx - ax) * t, ya + (yb - ya) * t - sag * 4 * t * (1 - t), az + (bz - az) * t));
      }
    }
    parts.push(tube(pts, 0.04, 4, { aLine: line.id }, 0));
  }
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}
