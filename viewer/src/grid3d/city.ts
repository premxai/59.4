// Per-instance runtime: materials (sharing one uniform set), smoothed visual state, and the
// per-frame driver that turns the latest GridFrame into uniforms / animation phases.
import * as THREE from "three";
import { compressorPowered, gridStrain, plantModel, type PlantInfo } from "./model";
import { CITY_ZONES, type GridFrame, type GridLook } from "./types";
import { L_COAL, L_CRIT, L_GAS, L_GAS1, L_GRID, L_NUC, LINE_COUNT, N_LIGHTS, rng } from "./layout";
import { makeBackdrop, makeCloud, makeGlow, makeGround, makeLines, makeLit, makePipes, makePlumes, makeRiver, makeShared, makeSnow, MAX_EMITTERS, N_CLOUDS } from "./materials";
import { LEAF_SUN, type World } from "./geometry";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const damp = (cur: number, target: number, tau: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
const toward = (cur: number, target: number, step: number) => (cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));

export type City = ReturnType<typeof createCity>;

/** One drifting clay cloud (gridleaf look). */
export interface CloudState {
  x: number;
  z: number;
  y: number;
  scale: number;
  speed: number;
  /** 0..1 how visible (clouds fade in as the storm builds) */
  vis: number;
  /** the order in which clouds appear as cover grows */
  rank: number;
}

export function createCity(world: World, look: GridLook = "night") {
  const U = makeShared();
  const mats = {
    ground: makeGround(U, look, world.shadow),
    river: makeRiver(U, look),
    props: makeLit(U, { vertexColors: true, look }),
    buildings: makeLit(U, { zone: true, look }),
    jacks: makeLit(U, { vertexColors: true, look }),
    rotors: makeLit(U, { vertexColors: true, look }),
    lines: makeLines(U, look),
    pipes: makePipes(U, look),
    streetLights: makeGlow(U, { zone: true, color: new THREE.Color(2.6, 1.45, 0.6) }),
    lamps: makeGlow(U, { blink: true, color: new THREE.Color(3.2, 0.25, 0.15) }),
    bars: makeGlow(U, {}),
    rings: makeGlow(U, {}),
    status: makeGlow(U, {}),
    plumes: makePlumes(U, look),
    snow: makeSnow(U),
    backdrop: makeBackdrop(look),
    clouds: makeCloud(U, look),
  };
  const cr = rng(5150);
  const clouds: CloudState[] = Array.from({ length: N_CLOUDS }, (_, i) => ({
    x: -26 + (52 * (i + cr() * 0.6)) / N_CLOUDS,
    z: -15 + cr() * 28,
    y: 4.4 + cr() * 1.0,
    scale: 0.75 + cr() * 0.6,
    speed: 0.8 + cr() * 0.4,
    vis: 0,
    rank: 0,
  }));
  clouds.map((_, i) => ({ i, k: cr() })).sort((a, b) => a.k - b.k).forEach((o, r) => (clouds[o.i].rank = r));
  const nJ = world.jacks.length;
  const nT = 10;
  // fixed "which ones fail first" orders (deterministic, spread out)
  const jackOrder = world.jacks.map((j, i) => ({ i, k: Math.sin(j.x * 12.9898 + j.z * 78.233) })).sort((a, b) => a.k - b.k).map((o) => o.i);
  const rotorOrder = [3, 7, 0, 9, 5, 1, 8, 2, 6, 4];
  const vis = {
    frame: null as GridFrame | null,
    prevCollapsed: null as boolean | null,
    waveR: 0,
    waveOn: 0,
    plants: Array.from({ length: 7 }, (): PlantInfo => ({ avail: 1, frozen: 0, nofuel: 0, output: 1, state: "ok" })),
    gasProd: 1,
    gasSupply: 1,
    comp: 1,
    strain: 0,
    frost: 0,
    snowfall: 0,
    windOk: 1,
    wind: 0.3,
    day: 0,
    jackFrozen: new Float32Array(nJ),
    jackPhase: world.jacks.map((j) => j.phase),
    rotorIced: new Float32Array(nT),
    rotorAngle: Array.from({ length: nT }, (_, i) => i * 0.7),
    linePhase: 0,
    pipePhaseA: 0,
    pipePhaseB: 0,
    emit: new Float32Array(MAX_EMITTERS),
    initialized: false,
    // gridleaf look
    storm: 0,
    solar: 0,
    clouds,
    cloudCol: new THREE.Color(1, 1, 1),
  };
  // emitter positions are static
  const ep = mats.plumes.uniforms.uEmitPos.value as THREE.Vector3[];
  const epar = mats.plumes.uniforms.uEmitParam.value as THREE.Vector2[];
  world.emitters.forEach((e, i) => {
    ep[i].copy(e.pos);
    epar[i].set(0, e.scale);
  });
  return { U, mats, vis, world, jackOrder, rotorOrder, look };
}

export function disposeCity(c: City) {
  for (const m of Object.values(c.mats)) m.dispose();
}

// ------------------------------------------------------------------ sky by local hour
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const SKY = {
  night: { sun: C(0.15, 0.19, 0.31), sky: C(0.1, 0.12, 0.21), gnd: C(0.03, 0.035, 0.06), top: C(0.035, 0.055, 0.13), bot: C(0.008, 0.012, 0.035), dir: new THREE.Vector3(-0.45, 0.8, 0.4).normalize() },
  dusk: { sun: C(0.36, 0.25, 0.24), sky: C(0.16, 0.14, 0.23), gnd: C(0.045, 0.04, 0.065), top: C(0.15, 0.1, 0.21), bot: C(0.03, 0.025, 0.06), dir: new THREE.Vector3(0.8, 0.35, 0.5).normalize() },
  day: { sun: C(0.24, 0.25, 0.29), sky: C(0.2, 0.23, 0.3), gnd: C(0.08, 0.085, 0.11), top: C(0.17, 0.2, 0.27), bot: C(0.05, 0.065, 0.1), dir: new THREE.Vector3(0.3, 0.85, 0.45).normalize() },
};
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _v = new THREE.Vector3();

function dayWeights(h: number): { day: number; dusk: number } {
  const ramp = (a: number, b: number, x: number) => clamp01((x - a) / (b - a));
  const day = Math.min(ramp(6.5, 8.5, h), 1 - ramp(16.5, 18.5, h));
  const dusk = Math.max(Math.exp(-((h - 7.2) ** 2) / 1.2), Math.exp(-((h - 18.2) ** 2) / 1.6));
  return { day: clamp01(day), dusk: clamp01(dusk) * (1 - clamp01(day) * 0.6) };
}

// gridleaf: a bright clay day that turns into a grey-blue overcast as the storm builds
const LEAF = {
  clear: { sun: C(0.86, 0.77, 0.62), sky: C(0.42, 0.47, 0.55), gnd: C(0.24, 0.25, 0.19), top: C(0.74, 0.82, 0.8), bot: C(0.58, 0.68, 0.55), dir: LEAF_SUN.clone() },
  storm: { sun: C(0.17, 0.19, 0.24), sky: C(0.36, 0.41, 0.5), gnd: C(0.17, 0.18, 0.22), top: C(0.42, 0.47, 0.54), bot: C(0.36, 0.4, 0.45) },
  cloudClear: C(0.98, 0.98, 0.97),
  cloudStorm: C(0.5, 0.53, 0.58),
};
const _sun = new THREE.Vector3();

function updateLeafSky(c: City, f: GridFrame, dt: number, first: boolean) {
  const { U, mats, vis } = c;
  const storm = clamp01(Math.max(f.frost * 0.85, f.snow * 1.5, vis.strain * 0.45, f.collapsed ? 1 : 0));
  vis.storm = first ? storm : damp(vis.storm, storm, 0.9, dt);
  const s = vis.storm;
  const nightK = 0.82 + 0.18 * vis.day; // only a gentle evening dip: the day cycle runs fast at stage speed
  U.uStorm.value = s;
  vis.solar = first ? f.fuel.solar : damp(vis.solar, f.fuel.solar, 0.5, dt);
  U.uSolar.value = vis.solar;
  U.uSunCol.value.copy(LEAF.clear.sun).lerp(LEAF.storm.sun, s).multiplyScalar(nightK);
  U.uSkyCol.value.copy(LEAF.clear.sky).lerp(LEAF.storm.sky, s).multiplyScalar(0.9 + 0.1 * nightK);
  U.uGndCol.value.copy(LEAF.clear.gnd).lerp(LEAF.storm.gnd, s);
  U.uSunDir.value.copy(LEAF.clear.dir);
  const bd = mats.backdrop.uniforms;
  bd.uTop.value.copy(LEAF.clear.top).lerp(LEAF.storm.top, s);
  bd.uBot.value.copy(LEAF.clear.bot).lerp(LEAF.storm.bot, s);
  bd.uStars.value = 0;
  U.uFogCol.value.copy(bd.uBot.value).lerp(bd.uTop.value, 0.15);
  // clouds: cover grows with the storm, they drift faster in the wind
  const cover = 0.28 + 0.72 * s;
  const n = c.vis.clouds.length;
  vis.cloudCol.copy(LEAF.cloudClear).lerp(LEAF.cloudStorm, s * 0.9);
  _sun.copy(U.uSunDir.value);
  const cu = U.uCloud.value as THREE.Vector4[];
  vis.clouds.forEach((cl, i) => {
    const want = cl.rank < cover * n ? 1 : 0;
    cl.vis = first ? want : damp(cl.vis, want, 1.2, dt);
    cl.x += dt * cl.speed * (0.25 + 0.9 * s);
    if (cl.x > 28) cl.x -= 56;
    const sx = cl.x - (_sun.x / _sun.y) * cl.y;
    const sz = cl.z - (_sun.z / _sun.y) * cl.y;
    cu[i].set(sx, sz, 2.2 * cl.scale, cl.vis * (0.55 + 0.4 * s));
  });
  // snow cover: none until the storm brings it (the night look keeps a light dusting)
  U.uSnow.value = clamp01(f.snow * 2.2);
}

function mix3(out: THREE.Color, n: THREE.Color, d: THREE.Color, y: THREE.Color, day: number, dusk: number) {
  _c1.copy(n).lerp(y, day);
  _c2.copy(_c1).lerp(d, dusk);
  return out.copy(_c2);
}

// ------------------------------------------------------------------ per-frame driver
export function updateCity(c: City, dt: number, viewH: number) {
  const { U, mats, vis } = c;
  const f = vis.frame;
  U.uTime.value += dt;
  U.uViewH.value = viewH;
  if (!f) return;
  const first = !vis.initialized;
  vis.initialized = true;
  const step = first ? 1 : dt / 0.5; // 0.5 s fades
  const light = U.uLight.value;
  const pre = U.uLightPre.value;

  // ---- collapse wave
  if (vis.prevCollapsed === null) vis.prevCollapsed = f.collapsed;
  if (f.collapsed && !vis.prevCollapsed) {
    pre.set(light);
    for (let i = 0; i < N_LIGHTS; i++) light[i] = 0;
    vis.waveR = 0;
    vis.waveOn = 1;
  } else if (!f.collapsed && vis.prevCollapsed) {
    pre.fill(0);
    vis.waveOn = 0;
  }
  vis.prevCollapsed = f.collapsed;
  const waving = vis.waveOn > 0 && vis.waveR < 30;
  if (vis.waveOn > 0) {
    vis.waveR += dt * 8.5;
    if (vis.waveR >= 30) {
      pre.fill(0);
      vis.waveOn = Math.max(0, vis.waveOn - dt * 2);
    }
  }
  U.uWave.value.set(-2.0, -10.0, vis.waveR, vis.waveOn);

  // ---- plants
  const pm = plantModel(f);
  const tauP = first ? 0 : 0.3;
  for (let i = 0; i < 7; i++) {
    const p = vis.plants[i];
    const t = pm[i];
    p.avail = damp(p.avail, t.avail, tauP, dt);
    p.frozen = damp(p.frozen, t.frozen, tauP, dt);
    p.nofuel = damp(p.nofuel, t.nofuel, tauP, dt);
    p.output = damp(p.output, t.output, tauP, dt);
    p.state = t.state;
  }

  // ---- lights (zones fade over 0.5 s)
  const target = (i: number) => {
    if (i < 16) return clamp01(f.zones[CITY_ZONES[i]] ?? 1);
    if (i === L_CRIT) return clamp01(f.zones.zone_crit ?? 1);
    if (i === L_GAS) return compressorPowered(f) ? 1 : 0.04;
    if (i >= L_GAS1 && i < L_GAS1 + 3) return f.collapsed ? 0 : 0.08 + 0.92 * pm[i - L_GAS1].avail;
    if (i === L_COAL) return f.collapsed ? 0 : 0.08 + 0.92 * pm[3].avail;
    if (i === L_NUC) return f.collapsed ? 0 : 0.08 + 0.92 * pm[4].avail;
    if (i === L_GRID) return f.collapsed ? 0 : 1;
    return 1;
  };
  for (let i = 0; i < N_LIGHTS; i++) light[i] = toward(light[i], target(i), step);

  // ---- gas
  const comp = compressorPowered(f) ? 1 : 0;
  vis.comp = first ? comp : toward(vis.comp, comp, dt / 0.6);
  vis.gasProd = first ? f.gasProduction : damp(vis.gasProd, f.gasProduction, 0.35, dt);
  vis.gasSupply = first ? f.gasSupply : damp(vis.gasSupply, f.gasSupply, 0.35, dt);
  const seg = mats.pipes.uniforms.uSegFlow.value as Float32Array;
  const trunk = vis.gasProd * (0.7 + 0.3 * vis.comp);
  seg[0] = trunk;
  seg[1] = vis.gasSupply;
  for (let k = 0; k < 3; k++) seg[2 + k] = clamp01(1 - vis.plants[k].nofuel) * Math.min(1, vis.gasSupply * 1.15);
  vis.pipePhaseA += dt * (0.15 + 0.85 * trunk);
  vis.pipePhaseB += dt * (0.15 + 0.85 * vis.gasSupply);
  mats.pipes.uniforms.uPhaseA.value = vis.pipePhaseA;
  mats.pipes.uniforms.uPhaseB.value = vis.pipePhaseB;

  // ---- transmission
  const flows = mats.lines.uniforms.uFlow.value as Float32Array;
  if (!waving) {
    const P = vis.plants;
    const health = f.demandMw > 0 ? clamp01(f.supplyMw / f.demandMw) : 1;
    const served = f.collapsed ? 0 : clamp01(1 - f.shedFrac);
    const tgt = [
      P[0].output,
      (P[0].output + P[1].output) / 2,
      (P[0].output + P[1].output + P[2].output) / 3,
      P[3].output,
      P[4].output,
      Math.max(0.08, P[5].output),
      P[6].output,
      health,
      health,
      served,
      served,
      served,
      vis.comp,
    ];
    for (let i = 0; i < LINE_COUNT; i++) {
      const t = f.collapsed ? 0 : tgt[i];
      flows[i] = first ? t : damp(flows[i], t, 0.3, dt);
    }
  }
  vis.strain = first ? gridStrain(f) : damp(vis.strain, gridStrain(f), 0.3, dt);
  mats.lines.uniforms.uStrain.value = f.collapsed && !waving ? 0 : vis.strain;
  const load = f.supplyMw > 0 ? clamp01((f.demandMw * (1 - f.shedFrac)) / f.supplyMw) : 0;
  vis.linePhase += dt * (0.35 + 1.2 * load);
  mats.lines.uniforms.uPhase.value = vis.linePhase;

  // ---- weather + sky
  vis.frost = first ? f.frost : damp(vis.frost, f.frost, 0.6, dt);
  U.uFrost.value = vis.frost;
  // snowfall: the data's snow, plus a light flurry while it is freezing
  const fall = clamp01(Math.max(f.snow * 1.6, f.frost * 0.14));
  vis.snowfall = first ? fall : damp(vis.snowfall, fall, 0.8, dt);
  mats.snow.uniforms.uAmount.value = vis.snowfall;
  U.uSnow.value = clamp01(0.22 + f.snow * 2.2);
  const { day, dusk } = dayWeights(f.localHour);
  vis.day = first ? day : damp(vis.day, day, c.look === "gridleaf" ? 1.2 : 0.4, dt);
  U.uDay.value = vis.day;
  if (c.look === "gridleaf") {
    updateLeafSky(c, f, dt, first);
  } else {
    mix3(U.uSunCol.value, SKY.night.sun, SKY.dusk.sun, SKY.day.sun, vis.day, dusk);
    mix3(U.uSkyCol.value, SKY.night.sky, SKY.dusk.sky, SKY.day.sky, vis.day, dusk);
    mix3(U.uGndCol.value, SKY.night.gnd, SKY.dusk.gnd, SKY.day.gnd, vis.day, dusk);
    _v.copy(SKY.night.dir).lerp(SKY.day.dir, vis.day).lerp(SKY.dusk.dir, dusk * 0.5).normalize();
    U.uSunDir.value.copy(_v);
    const bd = mats.backdrop.uniforms;
    mix3(bd.uTop.value, SKY.night.top, SKY.dusk.top, SKY.day.top, vis.day, dusk);
    mix3(bd.uBot.value, SKY.night.bot, SKY.dusk.bot, SKY.day.bot, vis.day, dusk);
    bd.uStars.value = (1 - vis.day) * (1 - vis.snowfall * 0.7);
  }

  // ---- steam
  const epar = mats.plumes.uniforms.uEmitParam.value as THREE.Vector2[];
  c.world.emitters.forEach((e, i) => {
    const out = f.collapsed ? 0 : vis.plants[e.plant].output;
    vis.emit[i] = first ? out : damp(vis.emit[i], out, 0.5, dt);
    epar[i].x = vis.emit[i];
  });

  // ---- wind
  vis.windOk = first ? f.windOk ?? 1 : damp(vis.windOk, f.windOk ?? 1, 0.5, dt);
  vis.wind = damp(vis.wind, f.fuel.wind, 0.5, dt);
}
