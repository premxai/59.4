// R3F scene for one grid city. All meshes are built imperatively once (useMemo) and animated in
// useFrame from the per-city state (city.ts); React never re-renders this tree during playback.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { AREAS, areaAt, type AreaKey } from "./areas";
import { updateCity, type City } from "./city";
import type { BuildingSet, World } from "./geometry";
import { mat } from "./geometry";
import { BAR_H, COMPRESSOR, HALF, TURBINES, TURBINE_H, terrainH } from "./layout";
import { makeRing } from "./materials";

/** Screen-space safe area (px) not covered by overlay panels; the camera frames the plate inside it. */
export interface ViewInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const CityCtx = createContext<City | null>(null);
const useCity = () => useContext(CityCtx)!;

// ------------------------------------------------------------------ shared instanced geometries (per world)
const geoCache = new WeakMap<object, THREE.BufferGeometry>();
function instancedGeo(key: object, make: () => THREE.BufferGeometry, attrs: Record<string, Float32Array>): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(v, 1));
    geoCache.set(key, g);
  }
  return g;
}

function prismGeo(): THREE.BufferGeometry {
  const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

function staticInstanced(geo: THREE.BufferGeometry, material: THREE.Material, set: { matrices: Float32Array; count: number }) {
  const m = new THREE.InstancedMesh(geo, material, set.count);
  m.instanceMatrix = new THREE.InstancedBufferAttribute(set.matrices, 16);
  m.frustumCulled = false;
  return m;
}

const buildingKeys = new WeakMap<BuildingSet, object>();
const keyOf = (s: BuildingSet) => {
  let k = buildingKeys.get(s);
  if (!k) buildingKeys.set(s, (k = {}));
  return k;
};

// ------------------------------------------------------------------ driver
function Driver() {
  const c = useCity();
  useFrame((state, dt) => {
    updateCity(c, Math.min(dt, 0.1), state.size.height * state.viewport.dpr);
  }, -1);
  return null;
}

// ------------------------------------------------------------------ static world
function StaticWorld({ world }: { world: World }) {
  const c = useCity();
  const objects = useMemo(() => {
    const o: THREE.Object3D[] = [];
    const add = (x: THREE.Object3D) => {
      x.frustumCulled = false;
      o.push(x);
      return x;
    };
    const back = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), c.mats.backdrop));
    back.renderOrder = -10;
    add(new THREE.Mesh(world.terrain, c.mats.ground));
    if (world.outer) add(new THREE.Mesh(world.outer, c.mats.ground));
    add(new THREE.Mesh(world.river, c.mats.river));
    if (world.lake) add(new THREE.Mesh(world.lake, c.mats.river));
    add(new THREE.Mesh(world.props, c.mats.props));
    add(new THREE.Mesh(world.pipes, c.mats.pipes));
    add(new THREE.Mesh(world.lines, c.mats.lines));
    const b = world.buildings;
    add(staticInstanced(instancedGeo(keyOf(b), () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), { aZone: b.zone, aSeed: b.seed, aKind: b.kind }), c.mats.buildings, b));
    const r = world.roofs;
    add(staticInstanced(instancedGeo(keyOf(r), prismGeo, { aZone: r.zone, aSeed: r.seed, aKind: r.kind }), c.mats.buildings, r));
    const sl = world.streetLights;
    add(staticInstanced(instancedGeo(sl, () => new THREE.BoxGeometry(1, 1, 1), { aZone: sl.zone }), c.mats.streetLights, sl));
    const lp = world.lamps;
    add(staticInstanced(instancedGeo(lp, () => new THREE.SphereGeometry(1, 6, 4), { aBlink: lp.blink }), c.mats.lamps, lp));
    return o;
  }, [c, world]);
  useEffect(() => () => {
    // per-city meshes only; geometries are shared and cached
    const back = objects[0] as THREE.Mesh;
    back.geometry.dispose();
  }, [objects]);
  return (
    <>
      {objects.map((x) => (
        <primitive key={x.uuid} object={x} />
      ))}
    </>
  );
}

// ------------------------------------------------------------------ animated: pumpjacks, frost rings, rotors, bars, status lamp
const ICE = new THREE.Color(0.72, 0.9, 1.3);
const WHITE = new THREE.Color(1, 1, 1);
const BAR_COL = {
  bg: new THREE.Color(0.05, 0.07, 0.12),
  ok: new THREE.Color(0.3, 1.35, 0.85),
  frozen: new THREE.Color(0.35, 0.7, 1.7),
  nofuel: new THREE.Color(1.8, 0.62, 0.1),
};
const _col = new THREE.Color();
const _mtx = new THREE.Matrix4();
const _rz = new THREE.Matrix4();

function Animated({ world }: { world: World }) {
  const c = useCity();
  const parts = useMemo(() => {
    const nJ = world.jacks.length;
    const beams = new THREE.InstancedMesh(world.jackBeam, c.mats.jacks, nJ);
    beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nJ * 3).fill(1), 3);
    const ringGeo = new THREE.RingGeometry(0.34, 0.44, 24).rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ringGeo, c.mats.rings, nJ);
    rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nJ * 3), 3);
    for (let i = 0; i < nJ; i++) rings.setColorAt(i, new THREE.Color(0.45, 0.95, 1.9));
    const rotors = new THREE.InstancedMesh(world.rotor, c.mats.rotors, TURBINES.length);
    rotors.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TURBINES.length * 3).fill(1), 3);
    const barGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const bars = new THREE.InstancedMesh(barGeo, c.mats.bars, world.bars.length * 4);
    bars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(world.bars.length * 12), 3);
    const lampGeo = new THREE.SphereGeometry(0.09, 10, 8);
    const status = new THREE.Mesh(lampGeo, c.mats.status);
    status.position.set(COMPRESSOR[0] + 0.05, terrainH(COMPRESSOR[0], COMPRESSOR[1]) + 0.72, COMPRESSOR[1] + 0.05);
    for (const m of [beams, rings, rotors, bars, status]) m.frustumCulled = false;
    return { beams, rings, rotors, bars, status, ringGeo, barGeo, lampGeo };
  }, [c, world]);
  useEffect(
    () => () => {
      parts.ringGeo.dispose();
      parts.barGeo.dispose();
      parts.lampGeo.dispose();
    },
    [parts],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const v = c.vis;
    const f = v.frame;
    if (!f) return;
    // ---- pumpjacks: N frozen (in a fixed order), the rest nod at a speed set by production
    const nJ = world.jacks.length;
    const frozenN = Math.round(Math.min(1, (1 - v.gasProd) * 1.6) * nJ);
    const speed = 2.6 * (0.45 + 0.55 * v.gasProd);
    for (let r = 0; r < nJ; r++) {
      const i = c.jackOrder[r];
      const j = world.jacks[i];
      const fz = (v.jackFrozen[i] += ((r < frozenN ? 1 : 0) - v.jackFrozen[i]) * (1 - Math.exp(-dt / 0.35)));
      v.jackPhase[i] += dt * speed * (1 - fz);
      const ang = 0.3 * Math.sin(v.jackPhase[i]) * (1 - fz) + 0.18 * fz;
      _mtx.copy(mat(j.x, j.y + 0.42, j.z, j.rot));
      _rz.makeRotationZ(ang);
      _mtx.multiply(_rz);
      parts.beams.setMatrixAt(i, _mtx);
      _col.copy(WHITE).lerp(ICE, fz);
      parts.beams.setColorAt(i, _col);
      const s = fz < 0.02 ? 0.0001 : fz * (1 + 0.08 * Math.sin(c.U.uTime.value * 3 + i));
      parts.rings.setMatrixAt(i, mat(j.x, j.y + 0.035, j.z, 0, s, 1, s));
    }
    parts.beams.instanceMatrix.needsUpdate = true;
    parts.beams.instanceColor!.needsUpdate = true;
    parts.rings.instanceMatrix.needsUpdate = true;

    // ---- wind turbines: iced ones stop and frost over
    const iced = Math.round((1 - v.windOk) * TURBINES.length);
    const rs = (0.5 + 3.2 * v.wind) * (f.collapsed ? 0.3 : 1);
    for (let r = 0; r < TURBINES.length; r++) {
      const i = c.rotorOrder[r];
      const ic = (v.rotorIced[i] += ((r < iced ? 1 : 0) - v.rotorIced[i]) * (1 - Math.exp(-dt / 0.6)));
      v.rotorAngle[i] += dt * rs * (1 - ic);
      const [x, z] = TURBINES[i];
      _mtx.copy(mat(x, terrainH(x, z) + TURBINE_H - 0.0, z + 0.1, 0.35));
      _rz.makeRotationZ(v.rotorAngle[i]);
      _mtx.multiply(_rz);
      parts.rotors.setMatrixAt(i, _mtx);
      parts.rotors.setColorAt(i, _col.copy(WHITE).lerp(ICE, ic));
    }
    parts.rotors.instanceMatrix.needsUpdate = true;
    parts.rotors.instanceColor!.needsUpdate = true;

    // ---- capacity bars: available (mint) / frozen (blue) / no fuel (orange) stacked to full height
    world.bars.forEach((b, p) => {
      const P = v.plants[p];
      const k = p * 4;
      parts.bars.setMatrixAt(k, mat(b.x, b.y - 0.05, b.z, 0, 0.12, BAR_H + 0.05, 0.12));
      parts.bars.setColorAt(k, BAR_COL.bg);
      let y = b.y;
      const seg = (idx: number, frac: number, col: THREE.Color) => {
        const h = Math.max(0.0001, frac * BAR_H);
        parts.bars.setMatrixAt(k + idx, mat(b.x, y, b.z, 0, frac > 0.004 ? 0.17 : 0.0001, h, frac > 0.004 ? 0.17 : 0.0001));
        parts.bars.setColorAt(k + idx, col);
        y += frac * BAR_H;
      };
      seg(1, P.avail, BAR_COL.ok);
      seg(2, Math.min(P.frozen, 1 - P.avail), BAR_COL.frozen);
      seg(3, Math.min(P.nofuel, Math.max(0, 1 - P.avail - P.frozen)), BAR_COL.nofuel);
    });
    parts.bars.instanceMatrix.needsUpdate = true;
    parts.bars.instanceColor!.needsUpdate = true;

    // ---- compressor status lamp: green when powered, blinking red when not
    const u = c.mats.status.uniforms.uColor.value as THREE.Color;
    if (v.comp > 0.5) u.setRGB(0.25, 1.7, 0.55);
    else u.setRGB(2.8, 0.18, 0.1).multiplyScalar(Math.sin(c.U.uTime.value * 7) > 0 ? 1 : 0.12);
  });

  return (
    <>
      <primitive object={parts.beams} />
      <primitive object={parts.rings} />
      <primitive object={parts.rotors} />
      <primitive object={parts.bars} />
      <primitive object={parts.status} />
    </>
  );
}

// ------------------------------------------------------------------ particles: steam + snow
function Particles({ plumePer, snowCount }: { plumePer: number; snowCount: number }) {
  const c = useCity();
  const { plumes, snow } = useMemo(() => {
    const r = mulberry(99);
    const nE = c.world.emitters.length;
    const n = nE * plumePer;
    const emit = new Float32Array(n);
    const rnd = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      emit[i] = i % nE;
      rnd[i * 3] = r();
      rnd[i * 3 + 1] = r();
      rnd[i * 3 + 2] = r();
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute("aEmit", new THREE.BufferAttribute(emit, 1));
    pg.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 3));
    const plumes = new THREE.Points(pg, c.mats.plumes);
    plumes.frustumCulled = false;
    plumes.renderOrder = 2;
    const sr = new Float32Array(snowCount * 4);
    for (let i = 0; i < sr.length; i++) sr[i] = r();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(snowCount * 3), 3));
    sg.setAttribute("aRnd", new THREE.BufferAttribute(sr, 4));
    const snow = new THREE.Points(sg, c.mats.snow);
    snow.frustumCulled = false;
    snow.renderOrder = 3;
    return { plumes, snow };
  }, [c, plumePer, snowCount]);
  useEffect(
    () => () => {
      plumes.geometry.dispose();
      snow.geometry.dispose();
    },
    [plumes, snow],
  );
  return (
    <>
      {plumePer > 0 && <primitive object={plumes} />}
      {snowCount > 0 && <primitive object={snow} />}
    </>
  );
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ clouds (gridleaf): drifting low-poly puffs
const PUFFS: [number, number, number, number][] = [
  [0, 0, 0, 1.0],
  [0.95, -0.18, 0.12, 0.74],
  [-0.9, -0.22, -0.06, 0.7],
  [0.38, 0.28, -0.38, 0.66],
  [-0.32, 0.18, 0.42, 0.6],
];
const _cm = new THREE.Matrix4();
const _cq = new THREE.Quaternion();
const _cp = new THREE.Vector3();
const _cs = new THREE.Vector3();

function Clouds() {
  const c = useCity();
  const camera = useThree((s) => s.camera);
  const mesh = useMemo(() => {
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const g = ico.toNonIndexed();
    ico.dispose();
    g.computeVertexNormals();
    const n = c.vis.clouds.length * PUFFS.length;
    const m = new THREE.InstancedMesh(g, c.mats.clouds, n);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
    m.frustumCulled = false;
    m.renderOrder = 4;
    return m;
  }, [c]);
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  const ctl = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  useFrame(() => {
    let k = 0;
    for (const cl of c.vis.clouds) {
      const v = cl.vis < 0.01 ? 0.0001 : cl.vis;
      for (const [ox, oy, oz, r] of PUFFS) {
        const sc = cl.scale * r * (0.35 + 0.65 * v);
        _cp.set(cl.x + ox * cl.scale * 1.15, cl.y + oy * cl.scale, cl.z + oz * cl.scale);
        _cs.set(sc * v, sc * 0.72 * v, sc * v);
        _cm.compose(_cp, _cq, _cs);
        mesh.setMatrixAt(k, _cm);
        mesh.setColorAt(k, c.vis.cloudCol);
        k++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    // fade clouds when the camera is close (focused on an area) so they never block the view
    const tgt = ctl?.target;
    const d = tgt ? camera.position.distanceTo(tgt) : 40;
    const fade = THREE.MathUtils.smoothstep(d, 12, 26);
    (c.mats.clouds.uniforms.uOpacity as { value: number }).value = 0.18 + 0.7 * fade;
  });
  return <primitive object={mesh} />;
}

// ------------------------------------------------------------------ focus ring + hover ring (click-to-focus)
function FocusRings({ focus, hover }: { focus: AreaKey | null; hover: AreaKey | null }) {
  const c = useCity();
  const parts = useMemo(() => {
    const geo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    const fm = makeRing(c.U, "#3dbe6e", 1);
    const hm = makeRing(c.U, "#ffffff", 0);
    const f = new THREE.Mesh(geo, fm);
    const h = new THREE.Mesh(geo, hm);
    for (const m of [f, h]) {
      m.frustumCulled = false;
      m.renderOrder = 20;
      m.visible = false;
    }
    return { geo, fm, hm, f, h };
  }, [c]);
  useEffect(
    () => () => {
      parts.geo.dispose();
      parts.fm.dispose();
      parts.hm.dispose();
    },
    [parts],
  );
  const st = useRef({ fa: 0, ha: 0, fKey: null as AreaKey | null, hKey: null as AreaKey | null, grow: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    if (focus) {
      if (focus !== s.fKey) s.grow = 0;
      s.fKey = focus;
    }
    if (hover) s.hKey = hover;
    s.fa += ((focus ? 1 : 0) - s.fa) * (1 - Math.exp(-dt / 0.18));
    s.ha += ((hover && hover !== focus ? 1 : 0) - s.ha) * (1 - Math.exp(-dt / 0.12));
    s.grow += (1 - s.grow) * (1 - Math.exp(-dt / 0.25));
    const place = (m: THREE.Mesh, key: AreaKey | null, a: number, grow: number) => {
      m.visible = !!key && a > 0.01;
      if (!key || !m.visible) return;
      const [x, z, r] = AREAS[key].ring;
      const rr = r * (0.75 + 0.25 * grow);
      m.position.set(x, terrainH(x, z) + 0.06, z);
      m.scale.set(rr, 1, rr);
      ((m.material as THREE.ShaderMaterial).uniforms.uOpacity as { value: number }).value = a;
    };
    place(parts.f, s.fKey, s.fa, s.grow);
    place(parts.h, s.hKey, s.ha * 0.55, 1);
  });
  return (
    <>
      <primitive object={parts.f} />
      <primitive object={parts.h} />
    </>
  );
}

// ------------------------------------------------------------------ camera: fit the plate, gentle drift, user can orbit
const TARGET = new THREE.Vector3(0.4, 0, 0.9);
const BASE_AZ = 0.2;
const BASE_EL = 0.94;
const FOCUS_EL = 0.8;

/** Shift the projection centre into the safe area (canvas px insets). Returns true when an offset is active. */
function applyInset(cam: THREE.PerspectiveCamera, W: number, H: number, inset?: ViewInset): boolean {
  if (!inset || (inset.left === inset.right && inset.top === inset.bottom)) {
    cam.clearViewOffset();
    cam.aspect = W / Math.max(1, H);
    cam.updateProjectionMatrix();
    return false;
  }
  const dx = (inset.left - inset.right) / 2;
  const dy = (inset.top - inset.bottom) / 2;
  const fw = W + 2 * Math.abs(dx);
  const fh = H + 2 * Math.abs(dy);
  cam.aspect = fw / Math.max(1, fh);
  cam.setViewOffset(fw, fh, dx < 0 ? 2 * Math.abs(dx) : 0, dy < 0 ? 2 * Math.abs(dy) : 0, W, H);
  cam.updateProjectionMatrix();
  return true;
}

function fitDistance(cam: THREE.PerspectiveCamera, dir: THREE.Vector3, W: number, H: number, inset?: ViewInset, tight = false): number {
  const pts: THREE.Vector3[] = [];
  // stage framing: the landscape continues past the plate, so frame the built-up part (not the empty corners)
  const hx = tight ? HALF - 1.2 : HALF;
  const zs = tight ? [-HALF + 0.6, HALF - 1.2] : [-HALF, HALF];
  for (const x of [-hx, hx]) for (const z of zs) for (const y of tight ? [0.0] : [-1.0, 0.2]) pts.push(new THREE.Vector3(x, y, z));
  for (const [x, z] of [TURBINES[0], TURBINES[2]]) pts.push(new THREE.Vector3(x, TURBINE_H + 0.9, z));
  pts.push(new THREE.Vector3(-10, 2.2, -9.4)); // gas plant stacks
  const v = new THREE.Vector3();
  const L = inset?.left ?? 0;
  const R = W - (inset?.right ?? 0);
  const T = inset?.top ?? 0;
  const B = H - (inset?.bottom ?? 0);
  const sh = B - T;
  const ok = (d: number) => {
    cam.position.copy(TARGET).addScaledVector(dir, d);
    cam.lookAt(TARGET);
    cam.updateMatrixWorld(true);
    for (const p of pts) {
      v.copy(p).project(cam);
      const px = (v.x * 0.5 + 0.5) * W;
      const py = (-v.y * 0.5 + 0.5) * H;
      if (px < L || px > R || py < T + sh * 0.1 || py > B - sh * 0.015) return false;
    }
    return true;
  };
  let lo = 8;
  let hi = 160;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

interface Glide {
  t0: number;
  dur: number;
  fromT: THREE.Vector3;
  toT: THREE.Vector3;
  from: THREE.Spherical;
  to: THREE.Spherical;
}

function Rig({
  orbit,
  drift = true,
  focus,
  inset,
  pickable,
  onPick,
  onHover,
}: {
  orbit: boolean;
  drift?: boolean;
  focus?: AreaKey | null;
  inset?: ViewInset;
  pickable: boolean;
  onPick?: RefObject<((a: AreaKey | null) => void) | undefined>;
  onHover?: (a: AreaKey | null) => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const ctl = useRef<ComponentRef<typeof OrbitControls>>(null);
  const interacting = useRef(false);
  const endPending = useRef(false);
  const idleSince = useRef(-100);
  const baseDist = useRef(40);
  const glide = useRef<Glide | null>(null);
  const focusRef = useRef<AreaKey | null>(focus ?? null);
  const stage = focus !== undefined;
  const insetKey = inset ? `${inset.top}|${inset.right}|${inset.bottom}|${inset.left}` : "";
  useLayoutEffect(() => {
    // the stage view manages the camera aspect itself (the view offset needs the full-image aspect)
    (camera as THREE.PerspectiveCamera & { manual?: boolean }).manual = !!inset;
    camera.fov = 28;
    camera.near = 0.5;
    camera.far = 300;
    applyInset(camera, size.width, size.height, inset);
    const dir = new THREE.Vector3(Math.sin(BASE_AZ) * Math.cos(BASE_EL), Math.sin(BASE_EL), Math.cos(BASE_AZ) * Math.cos(BASE_EL));
    const d = fitDistance(camera, dir, size.width, size.height, inset, stage);
    baseDist.current = d;
    const c = ctl.current;
    if (!focusRef.current) {
      camera.position.copy(TARGET).addScaledVector(dir, d);
      camera.lookAt(TARGET);
      if (c) c.target.copy(TARGET);
    }
    if (c) {
      c.minDistance = stage ? 4 : d * 0.5;
      c.maxDistance = d * 1.3;
      c.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size.width, size.height, insetKey]);

  // glide to the focused area (or back to the overview)
  useEffect(() => {
    if (!stage) return;
    focusRef.current = focus ?? null;
    const c = ctl.current;
    if (!c) return;
    const a = focus ? AREAS[focus] : null;
    const toT = a ? new THREE.Vector3(...a.target) : TARGET.clone();
    const fromOff = new THREE.Vector3().subVectors(camera.position, c.target);
    const from = new THREE.Spherical().setFromVector3(fromOff);
    const el = a ? FOCUS_EL : BASE_EL;
    const to = new THREE.Spherical(a ? a.dist : baseDist.current, Math.PI / 2 - el, BASE_AZ);
    glide.current = { t0: performance.now(), dur: 1700, fromT: c.target.clone(), toT, from, to };
    idleSince.current = -100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, stage]);

  // click-to-focus + hover picking on the ground plane
  useEffect(() => {
    if (!pickable) return;
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.15);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number; t: number } | null = null;
    let lastHover: AreaKey | null = null;
    const areaFromEvent = (e: MouseEvent): AreaKey | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return areaAt(hit.x, hit.z);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    // "click" (not pointerup) so it works with any input source; a drag (orbit) is not a click
    const onClick = (e: MouseEvent) => {
      const d = down;
      down = null;
      if (e.button !== 0) return;
      if (d && (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700)) return;
      const a = areaFromEvent(e);
      if (a) onPick?.current?.(a);
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const a = areaFromEvent(e);
      if (a !== lastHover) {
        lastHover = a;
        el.style.cursor = a ? "pointer" : "";
        onHover?.(a);
      }
    };
    const onLeave = () => {
      lastHover = null;
      el.style.cursor = "";
      onHover?.(null);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("click", onClick);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("click", onClick);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [pickable, gl, camera, onPick, onHover]);

  const _sph = useMemo(() => new THREE.Spherical(), []);
  useFrame((state) => {
    const c = ctl.current;
    if (!c) return;
    const t = state.clock.elapsedTime;
    const g = glide.current;
    if (g) {
      const k = Math.min(1, (performance.now() - g.t0) / g.dur);
      const e = ease(k);
      c.target.lerpVectors(g.fromT, g.toT, e);
      _sph.set(g.from.radius + (g.to.radius - g.from.radius) * e, g.from.phi + (g.to.phi - g.from.phi) * e, lerpAngle(g.from.theta, g.to.theta, e));
      camera.position.setFromSpherical(_sph).add(c.target);
      camera.lookAt(c.target);
      c.autoRotate = false;
      if (k >= 1) {
        glide.current = null;
        idleSince.current = t;
      }
      c.update();
      return;
    }
    if (endPending.current) {
      endPending.current = false;
      idleSince.current = t;
    }
    // gentle drift around the base angle; pauses while (and 6 s after) the user orbits
    if (drift && !interacting.current && t - idleSince.current > 6) {
      const az = c.getAzimuthalAngle();
      const goal = BASE_AZ + 0.12 * Math.sin(t * 0.1);
      c.autoRotate = true;
      // OrbitControls: positive autoRotateSpeed decreases the azimuth
      c.autoRotateSpeed = Math.max(-0.6, Math.min(0.6, (az - goal) * 5));
    } else c.autoRotate = false;
  });
  return (
    <OrbitControls
      ref={ctl}
      makeDefault
      enabled={orbit}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      minPolarAngle={0.3}
      maxPolarAngle={1.2}
      target={TARGET}
      onStart={() => {
        interacting.current = true;
        glide.current = null;
      }}
      onEnd={() => {
        interacting.current = false;
        endPending.current = true;
      }}
    />
  );
}

// ------------------------------------------------------------------ focus label projector (DOM anchor above the ring)
const _fv = new THREE.Vector3();
export function FocusProjector({ focus, el }: { focus: AreaKey | null; el: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    const d = el.current;
    if (!d) return;
    if (!focus) {
      d.style.visibility = "hidden";
      return;
    }
    const a = AREAS[focus];
    const [x, z] = a.ring;
    _fv.set(x, terrainH(x, z) + a.labelY, z).project(camera);
    if (_fv.z > 1) {
      d.style.visibility = "hidden";
      return;
    }
    d.style.visibility = "";
    d.style.transform = `translate3d(${((_fv.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-_fv.y * 0.5 + 0.5) * size.height).toFixed(1)}px, 0)`;
  });
  return null;
}

// ------------------------------------------------------------------ root
export function GridScene({
  city,
  world,
  plumePer,
  snowCount,
  orbit,
  drift,
  focus,
  inset,
  onPick,
}: {
  city: City;
  world: World;
  plumePer: number;
  snowCount: number;
  orbit: boolean;
  /** Gentle idle camera drift around the base angle. Default true. */
  drift?: boolean;
  /** stage mode: focused area (null = overview); undefined = the original fixed framing */
  focus?: AreaKey | null;
  inset?: ViewInset;
  onPick?: RefObject<((a: AreaKey | null) => void) | undefined>;
}) {
  const [hover, setHover] = useState<AreaKey | null>(null);
  const pickable = !!onPick;
  return (
    <CityCtx.Provider value={city}>
      <Driver />
      <StaticWorld world={world} />
      <Animated world={world} />
      <Particles plumePer={plumePer} snowCount={snowCount} />
      {city.look === "gridleaf" && <Clouds />}
      {focus !== undefined && <FocusRings focus={focus} hover={pickable ? hover : null} />}
      <Rig orbit={orbit} drift={drift} focus={focus} inset={inset} pickable={pickable} onPick={onPick} onHover={pickable ? setHover : undefined} />
    </CityCtx.Provider>
  );
}
