import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Geo } from "../lib/geo";
import { hash01, lonLatToXZ, pointInRing } from "../lib/geo";
import type { Plant } from "../lib/plants";
import type { TierSettings } from "../lib/quality";
import { FUEL_COLOR } from "./palette";
import {
  COAL_STACK_TOP,
  GAS_STACK_TOP,
  PUMPJACK_PIVOT_Y,
  coalPlantGeo,
  coolingTowerGeo,
  gasPlantGeo,
  pumpjackBaseGeo,
  pumpjackBeamGeo,
  reactorGeo,
  turbineRotorGeo,
  turbineTowerGeo,
} from "./plantModels";
import { idw, useWorld, waveLit, type WorldState } from "./worldState";

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** Deterministic outage order: a plant runs while its rank < its fuel's availability. */
const rank = (id: number) => hash01(id, 11);

// ------------------------------------------------------------------ wind
interface TurbineInst {
  pos: THREE.Vector3;
  yaw: number;
  scale: number;
  rank: number;
  angle: number;
  speed: number;
  frost: number;
}

function Turbines({ geo, plants, perPlant }: { geo: Geo; plants: Plant[]; perPlant: number }) {
  const world = useWorld();
  const tower = useRef<THREE.InstancedMesh>(null);
  const rotor = useRef<THREE.InstancedMesh>(null);
  const towerGeo = useMemo(turbineTowerGeo, []);
  const rotorGeo = useMemo(turbineRotorGeo, []);

  const inst = useMemo(() => {
    const out: TurbineInst[] = [];
    for (const p of plants) {
      const n = Math.max(1, Math.min(perPlant, Math.round(p.mw / 140)));
      for (let k = 0; k < n; k++) {
        const ang = hash01(p.id, 20 + k) * Math.PI * 2;
        const r = k === 0 ? 0 : 0.5 + hash01(p.id, 30 + k) * 0.5;
        const dLon = (Math.cos(ang) * r) / 9.5;
        const dLat = (Math.sin(ang) * r) / 11.1;
        const lon = p.lon + dLon;
        const lat = p.lat + dLat;
        out.push({
          pos: new THREE.Vector3(...geo.toWorld(lon, lat, 0)),
          yaw: Math.PI + (hash01(p.id, 40 + k) - 0.5) * 0.4, // face the north wind
          scale: 1.25 + hash01(p.id, 50 + k) * 0.35,
          rank: hash01(p.id * 7 + k, 12),
          angle: hash01(p.id, 60 + k) * 6.28,
          speed: 0,
          frost: 0,
        });
      }
    }
    return out;
  }, [geo, plants, perPlant]);

  useLayoutEffect(() => {
    const t = tower.current;
    if (!t) return;
    inst.forEach((it, i) => {
      tmpQ.setFromAxisAngle(Y, it.yaw);
      tmpM.compose(it.pos, tmpQ, tmpS.setScalar(it.scale));
      t.setMatrixAt(i, tmpM);
      t.setColorAt(i, tmpC.setRGB(0.4, 0.45, 0.55));
    });
    t.instanceMatrix.needsUpdate = true;
    if (t.instanceColor) t.instanceColor.needsUpdate = true;
  }, [inst]);

  useFrame((_, dt) => {
    const t = tower.current;
    const r = rotor.current;
    if (!t || !r) return;
    const running = world.turbinesRunning;
    for (let i = 0; i < inst.length; i++) {
      const it = inst[i];
      const on = it.rank < running && waveLit(world, it.pos.x, it.pos.z) > 0.5;
      const target = on ? 2.2 + 1.2 * (1 - it.rank) : 0;
      it.speed += (target - it.speed) * (1 - Math.exp(-dt / (on ? 1.2 : 2.5)));
      it.angle += it.speed * dt;
      // stopped (iced) rotors tint frost-white
      const frostTarget = on ? 0 : 1;
      it.frost += (frostTarget - it.frost) * (1 - Math.exp(-dt / 1.5));
      tmpQ.setFromAxisAngle(Y, it.yaw);
      tmpQ2.setFromAxisAngle(Z, it.angle);
      tmpQ.multiply(tmpQ2);
      tmpV.set(0, it.scale * 1.0, it.scale * 0.04).applyAxisAngle(Y, it.yaw).add(it.pos);
      tmpM.compose(tmpV, tmpQ, tmpS.setScalar(it.scale));
      r.setMatrixAt(i, tmpM);
      const f = it.frost;
      tmpC.setRGB(0.55 + f * 1.25, 0.6 + f * 1.35, 0.7 + f * 1.45);
      r.setColorAt(i, tmpC);
      t.setColorAt(i, tmpC.setRGB(0.4 + f * 0.7, 0.45 + f * 0.8, 0.55 + f * 0.9));
    }
    r.instanceMatrix.needsUpdate = true;
    if (r.instanceColor) r.instanceColor.needsUpdate = true;
    if (t.instanceColor) t.instanceColor.needsUpdate = true;
  });

  if (!inst.length) return null;
  return (
    <group>
      <instancedMesh ref={tower} args={[towerGeo, undefined, inst.length]} frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={rotor} args={[rotorGeo, undefined, inst.length]} frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

// ------------------------------------------------------------------ thermal (gas, coal, nuclear)
interface Emitter {
  pos: THREE.Vector3; // stack top (world)
  fuel: "gas" | "coal" | "nuclear";
  rank: number;
  size: number;
  on: number; // eased 0..1
}

function placeThermal(geo: Geo, plants: Plant[], gasMinMw: number) {
  const gas: { m: THREE.Matrix4; p: Plant }[] = [];
  const coal: { m: THREE.Matrix4; p: Plant }[] = [];
  const towers: { m: THREE.Matrix4; p: Plant }[] = [];
  const reactors: { m: THREE.Matrix4; p: Plant }[] = [];
  const emitters: Emitter[] = [];
  for (const p of plants) {
    const base = new THREE.Vector3(...geo.toWorld(p.lon, p.lat, 0));
    const yaw = hash01(p.id, 3) * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
    if (p.fuel === "gas") {
      if (p.mw < gasMinMw) continue;
      const s = Math.min(2.6, 0.9 + Math.sqrt(p.mw) / 30);
      const m = new THREE.Matrix4().compose(base, q, new THREE.Vector3(s, s, s));
      gas.push({ m, p });
      emitters.push({ pos: GAS_STACK_TOP.clone().applyMatrix4(m), fuel: "gas", rank: rank(p.id), size: s, on: 1 });
    } else if (p.fuel === "coal") {
      const s = Math.min(2.4, 1.0 + Math.sqrt(p.mw) / 40);
      const m = new THREE.Matrix4().compose(base, q, new THREE.Vector3(s, s, s));
      coal.push({ m, p });
      emitters.push({ pos: COAL_STACK_TOP.clone().applyMatrix4(m), fuel: "coal", rank: rank(p.id), size: s, on: 1 });
    } else if (p.fuel === "nuclear") {
      const s = 2.2;
      for (const off of [-0.55, 0.55]) {
        const pos = base.clone().add(new THREE.Vector3(off * s, 0, 0).applyQuaternion(q));
        const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s));
        towers.push({ m, p });
        emitters.push({ pos: pos.clone().add(new THREE.Vector3(0, s * 1.0, 0)), fuel: "nuclear", rank: rank(p.id), size: s * 1.6, on: 1 });
      }
      const rpos = base.clone().add(new THREE.Vector3(0, 0, 0.9 * s).applyQuaternion(q));
      reactors.push({ m: new THREE.Matrix4().compose(rpos, q, new THREE.Vector3(s, s, s)), p });
    }
  }
  return { gas, coal, towers, reactors, emitters };
}

function StaticInstances({ items, geometry, color, side }: { items: { m: THREE.Matrix4 }[]; geometry: THREE.BufferGeometry; color: string; side?: THREE.Side }) {
  // faint navy self-light so structures read as shapes, not holes, on frosted ground
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    items.forEach((it, i) => im.setMatrixAt(i, it.m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]} frustumCulled={false}>
      <meshLambertMaterial color={color} emissive="#0c1328" side={side ?? THREE.FrontSide} />
    </instancedMesh>
  );
}

function emitterOn(world: WorldState, e: Emitter): boolean {
  if (waveLit(world, e.pos.x, e.pos.z) < 0.5) return false;
  const avail = e.fuel === "gas" ? world.fuel.gas : e.fuel === "coal" ? world.fuel.coal : world.fuel.nuclear;
  return e.rank < avail;
}

/** Glow sprite at every stack/tower top: fuel-colored, goes dark with the plant. */
function PlantGlows({ emitters }: { emitters: Emitter[] }) {
  const world = useWorld();
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(emitters.flatMap((e) => [e.pos.x, e.pos.y + 0.05, e.pos.z])), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(emitters.flatMap((e) => FUEL_COLOR[e.fuel])), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(emitters.map((e) => e.size)), 1));
    g.setAttribute("aOn", new THREE.BufferAttribute(new Float32Array(emitters.length).fill(1), 1));
    return g;
  }, [emitters]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aSize; attribute float aOn; attribute vec3 color;
          varying vec3 vColor; varying float vOn; uniform float uPx;
          void main(){
            vColor = color; vOn = aOn;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * (14.0 + 10.0 * aSize) * (60.0 / -mv.z);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor; varying float vOn;
          void main(){
            vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float core = exp(-r * r * 18.0); float halo = exp(-r * r * 4.0) * 0.35;
            float a = (core * 2.6 + halo) * vOn;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vColor * a, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useFrame(({ gl }, dt) => {
    mat.uniforms.uPx.value = gl.getPixelRatio();
    const a = geom.getAttribute("aOn") as THREE.BufferAttribute;
    const k = 1 - Math.exp(-dt / 0.35);
    for (let i = 0; i < emitters.length; i++) {
      const e = emitters[i];
      e.on += ((emitterOn(world, e) ? 1 : 0) - e.on) * k;
      a.setX(i, e.on);
    }
    a.needsUpdate = true;
  });
  if (!emitters.length) return null;
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

/** Steam plumes: rise and drift with the wind; only from running plants. */
function Plumes({ emitters, PER }: { emitters: Emitter[]; PER: number }) {
  const world = useWorld();
  const geom = useMemo(() => {
    const n = emitters.length * PER;
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const size = new Float32Array(n);
    const kind = new Float32Array(n);
    emitters.forEach((e, i) => {
      for (let k = 0; k < PER; k++) {
        const j = i * PER + k;
        pos.set([e.pos.x, e.pos.y, e.pos.z], j * 3);
        phase[j] = k / PER + hash01(i, k) * 0.08;
        size[j] = e.size;
        kind[j] = e.fuel === "coal" ? 1 : 0;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    g.setAttribute("aOn", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    return g;
  }, [emitters, PER]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.3, 0.6) }, uPx: { value: 1 }, uAmount: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aPhase; attribute float aSize; attribute float aKind; attribute float aOn;
          uniform float uTime; uniform vec2 uWind; uniform float uPx; uniform float uAmount;
          varying float vA; varying float vKind; varying float vLife;
          void main(){
            float life = fract(uTime * 0.16 + aPhase);
            vec3 p = position;
            p.y += life * 2.6 * aSize;
            p.xz += uWind * life * life * 3.0 * aSize;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * (10.0 + 46.0 * life) * aSize * (40.0 / -mv.z);
            vA = aOn * uAmount * smoothstep(0.0, 0.12, life) * (1.0 - life);
            vKind = aKind; vLife = life;
          }`,
        fragmentShader: /* glsl */ `
          varying float vA; varying float vKind; varying float vLife;
          void main(){
            vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float a = (1.0 - smoothstep(0.0, 1.0, r)) * vA * 0.32;
            if (a < 0.003) discard;
            vec3 steam = mix(vec3(0.75, 0.62, 0.48), vec3(0.42, 0.48, 0.6), vLife); // lit warm from below
            vec3 smoke = vec3(0.30, 0.29, 0.30);
            gl_FragColor = vec4(mix(steam, smoke, vKind * 0.6) * 0.55, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useFrame(({ gl }) => {
    mat.uniforms.uPx.value = gl.getPixelRatio();
    mat.uniforms.uTime.value = world.now;
    // Wind from the mean of the regions (storm: from the north -> plumes drift south).
    let w = 0;
    for (let i = 0; i < world.regionCount; i++) w += world.wind[i];
    w = world.regionCount ? w / world.regionCount : 3;
    mat.uniforms.uWind.value.set(0.15, 0.12 + w * 0.06);
    mat.uniforms.uAmount.value = 0.5 + 0.5 * world.gasPlantOn;
    const a = geom.getAttribute("aOn") as THREE.BufferAttribute;
    for (let i = 0; i < emitters.length; i++) {
      const v = emitters[i].on;
      for (let k = 0; k < PER; k++) a.setX(i * PER + k, v);
    }
    a.needsUpdate = true;
  });
  if (!emitters.length) return null;
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

function Thermal({ geo, plants, gasMinMw, plumePer }: { geo: Geo; plants: Plant[]; gasMinMw: number; plumePer: number }) {
  const placed = useMemo(() => placeThermal(geo, plants, gasMinMw), [geo, plants, gasMinMw]);
  const gGas = useMemo(gasPlantGeo, []);
  const gCoal = useMemo(coalPlantGeo, []);
  const gTower = useMemo(coolingTowerGeo, []);
  const gReactor = useMemo(reactorGeo, []);
  return (
    <group>
      <StaticInstances items={placed.gas} geometry={gGas} color="#7a8197" />
      <StaticInstances items={placed.coal} geometry={gCoal} color="#6e6866" />
      <StaticInstances items={placed.towers} geometry={gTower} color="#6c7486" side={THREE.DoubleSide} />
      <StaticInstances items={placed.reactors} geometry={gReactor} color="#7a8294" />
      <PlantGlows emitters={placed.emitters} />
      {plumePer > 0 && <Plumes emitters={placed.emitters} PER={plumePer} />}
    </group>
  );
}

// ------------------------------------------------------------------ pumpjacks (Permian)
interface Jack {
  pos: THREE.Vector3;
  yaw: number;
  rank: number;
  phase: number;
  speed: number;
  frost: number;
}

function Pumpjacks({ geo, count = 150 }: { geo: Geo; count?: number }) {
  const world = useWorld();
  const base = useRef<THREE.InstancedMesh>(null);
  const beam = useRef<THREE.InstancedMesh>(null);
  const gBase = useMemo(pumpjackBaseGeo, []);
  const gBeam = useMemo(pumpjackBeamGeo, []);
  const jacks = useMemo(() => {
    const out: Jack[] = [];
    const ring = geo.permian[0];
    if (!ring) return out;
    let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
    for (const [lo, la] of ring) {
      minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo);
      minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
    }
    let seed = 1;
    while (out.length < count && seed < count * 40) {
      const lon = minLon + hash01(seed, 1) * (maxLon - minLon);
      const lat = minLat + hash01(seed, 2) * (maxLat - minLat);
      seed++;
      if (!pointInRing(lon, lat, ring)) continue;
      out.push({
        pos: new THREE.Vector3(...geo.toWorld(lon, lat, 0)),
        yaw: hash01(seed, 3) * Math.PI * 2,
        rank: hash01(seed, 4),
        phase: hash01(seed, 5) * 6.28,
        speed: 2.2,
        frost: 0,
      });
    }
    return out;
  }, [geo, count]);

  useLayoutEffect(() => {
    const b = base.current;
    if (!b) return;
    jacks.forEach((j, i) => {
      tmpQ.setFromAxisAngle(Y, j.yaw);
      b.setMatrixAt(i, tmpM.compose(j.pos, tmpQ, tmpS.setScalar(1.0)));
    });
    b.instanceMatrix.needsUpdate = true;
  }, [jacks]);

  useFrame((_, dt) => {
    const b = base.current;
    const m = beam.current;
    if (!b || !m) return;
    const supply = world.gasSupply;
    for (let i = 0; i < jacks.length; i++) {
      const j = jacks[i];
      const on = j.rank < supply && waveLit(world, j.pos.x, j.pos.z) > 0.5;
      j.speed += ((on ? 2.4 : 0) - j.speed) * (1 - Math.exp(-dt / 0.8));
      j.phase += j.speed * dt;
      // frost from the local interpolated temperature; frozen-off wells frost harder
      const T = idw(world, j.pos.x, j.pos.z, world.temps);
      const ft = Math.min(1, Math.max(0, -T / 9)) * (on ? 0.65 : 1);
      j.frost += (ft - j.frost) * (1 - Math.exp(-dt / 1.0));
      tmpQ.setFromAxisAngle(Y, j.yaw);
      tmpQ2.setFromAxisAngle(Z, Math.sin(j.phase) * 0.3);
      tmpQ.multiply(tmpQ2);
      tmpV.set(0, PUMPJACK_PIVOT_Y, 0).add(j.pos);
      m.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS.setScalar(1.0)));
      const f = j.frost;
      tmpC.setRGB(0.55 + f * 1.1, 0.42 + f * 1.3, 0.3 + f * 1.5);
      m.setColorAt(i, tmpC);
      b.setColorAt(i, tmpC.setRGB(0.4 + f * 0.9, 0.36 + f * 1.05, 0.32 + f * 1.2));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
  });

  if (!jacks.length) return null;
  return (
    <group>
      <instancedMesh ref={base} args={[gBase, undefined, jacks.length]} frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={beam} args={[gBeam, undefined, jacks.length]} frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

export function Plants({ geo, fleet, q }: { geo: Geo; fleet: Plant[]; q: TierSettings }) {
  const wind = useMemo(() => fleet.filter((p) => p.fuel === "wind" && geo.insideTexas(p.lon, p.lat)), [fleet, geo]);
  const thermal = useMemo(() => fleet.filter((p) => p.fuel === "gas" || p.fuel === "coal" || p.fuel === "nuclear"), [fleet]);
  return (
    <group>
      <Turbines key={`t${q.turbinesPerPlant}`} geo={geo} plants={wind} perPlant={q.turbinesPerPlant} />
      <Thermal key={`g${q.gasMinMw}`} geo={geo} plants={thermal} gasMinMw={q.gasMinMw} plumePer={q.plumePer} />
      <Pumpjacks key={`p${q.pumpjacks}`} geo={geo} count={q.pumpjacks} />
    </group>
  );
}

export { lonLatToXZ };
