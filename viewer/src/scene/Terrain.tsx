import { useEffect, useMemo } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import type { Geo } from "../lib/geo";
import { KX, KY, LAND_BASE, LAT0, LON0, SEA_FLOOR, VSCALE } from "../lib/geo";
import { NON_ERCOT_BOXES } from "../lib/grid";
import { GLSL_COMMON } from "./glsl";
import { MAX_REGIONS, WAVE_MAX_R, WAVE_ORIGIN, useWorld } from "./worldState";
import { FOG_COLOR, FOG_DENSITY } from "./palette";

function buildGeometry(geo: Geo, STRIDE: number): THREE.BufferGeometry {
  const [lonMin, latMin, lonMax, latMax] = geo.bbox;
  const w = Math.floor((geo.hw - 1) / STRIDE) + 1;
  const h = Math.floor((geo.hh - 1) / STRIDE) + 1;
  const pos = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    const py = Math.min(geo.hh - 1, j * STRIDE);
    const lat = latMax - ((py + 0.5) / geo.hh) * (latMax - latMin);
    for (let i = 0; i < w; i++) {
      const px = Math.min(geo.hw - 1, i * STRIDE);
      const lon = lonMin + ((px + 0.5) / geo.hw) * (lonMax - lonMin);
      const m = geo.heights[py * geo.hw + px];
      const k = (j * w + i) * 3;
      pos[k] = (lon - LON0) * KX;
      pos[k + 1] = m > 0 ? LAND_BASE + m * VSCALE : SEA_FLOOR;
      pos[k + 2] = -(lat - LAT0) * KY;
    }
  }
  const idx = new Uint32Array((w - 1) * (h - 1) * 6);
  let n = 0;
  for (let j = 0; j < h - 1; j++)
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** R = Permian Basin (gas fields), G = not on the ERCOT grid (see lib/grid.ts), soft-edged. */
function maskTexture(geo: Geo): THREE.CanvasTexture {
  const W = 512;
  const H = Math.round((W * geo.hh) / geo.hw);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const [lonMin, latMin, lonMax, latMax] = geo.bbox;
  ctx.fillStyle = "#f00";
  for (const ring of geo.permian) {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => {
      const x = ((lon - lonMin) / (lonMax - lonMin)) * W;
      const y = ((latMax - lat) / (latMax - latMin)) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = "blur(3px)";
  ctx.fillStyle = "#0f0";
  for (const b of NON_ERCOT_BOXES) {
    const x0 = ((b.lonMin - lonMin) / (lonMax - lonMin)) * W;
    const x1 = ((b.lonMax - lonMin) / (lonMax - lonMin)) * W;
    const y0 = ((latMax - b.latMax) / (latMax - latMin)) * H;
    const y1 = ((latMax - b.latMin) / (latMax - latMin)) * H;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.filter = "none";
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const vert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vViewDist;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vViewDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uLights;
uniform sampler2D uTerrain;
uniform sampler2D uMasks;
uniform vec4 uBBox;
uniform vec4 uProj;
uniform float uZones[18];
uniform float uPreZones[18];
uniform float uCollapsed;
uniform float uWaveR;
uniform vec2 uWaveCenter;
uniform float uTime;
uniform float uSky;
uniform float uSensor;
uniform vec3 uMoonDir;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vViewDist;

float zoneValue(int zi, bool crit, bool gas, bool pre) {
  if (pre) return crit ? uPreZones[16] : (gas ? uPreZones[17] : uPreZones[zi]);
  return crit ? uZones[16] : (gas ? uZones[17] : uZones[zi]);
}

void main() {
  float lon = vWorld.x / uProj.z + uProj.x;
  float lat = -vWorld.z / uProj.w + uProj.y;
  vec2 uv = vec2((lon - uBBox.x) / (uBBox.z - uBBox.x), (lat - uBBox.y) / (uBBox.w - uBBox.y));
  float tx = texture2D(uTerrain, uv).b;
  float inTx = smoothstep(0.35, 0.65, tx);
  vec2 masks = texture2D(uMasks, uv).rg;
  float offGrid = masks.g * inTx; // Texas but not ERCOT: steady, dimmer, slightly grey
  vec3 n = normalize(vNormalW);
  float moon = max(dot(n, normalize(uMoonDir)), 0.0);
  float slope = 1.0 - n.y;

  // --- ground: navy night, moonlit relief
  vec3 ground = vec3(0.005, 0.009, 0.022) + moon * vec3(0.011, 0.019, 0.042);
  ground += slope * vec3(0.006, 0.009, 0.02);
  ground *= mix(0.42, 1.0, inTx);
  ground = mix(ground, vec3(dot(ground, vec3(0.333))) * 1.2, offGrid * 0.65);

  // --- cold: interpolated region temperatures, frost below 0 °C, snow cover, front edge
  vec3 w = idw3(vWorld.xz);
  float T = w.x;
  float frost = clamp(-T / 10.0, 0.0, 1.0);
#ifdef CHEAP
  float sparkle = 0.0;
#else
  float sparkle = step(0.985, hash12(floor(vWorld.xz * 9.0))) * frost * smoothstep(40.0, 90.0, vViewDist);
#endif
  vec3 frostCol = vec3(0.010, 0.021, 0.048) * (0.4 + 1.0 * moon);
  ground = mix(ground, frostCol, frost * 0.8 * mix(0.35, 1.0, inTx));
  ground += sparkle * vec3(0.06, 0.10, 0.16) * inTx;
#ifdef CHEAP
  float snowCover = smoothstep(0.2, 5.0, w.y) * 0.85;
#else
  float snowCover = smoothstep(0.2, 5.0, w.y) * (0.7 + 0.3 * vnoise(vWorld.xz * 0.6));
#endif
  vec3 snowCol = vec3(0.022, 0.030, 0.052) * (0.4 + 1.1 * moon);
  ground = mix(ground, snowCol, snowCover * 0.85 * mix(0.4, 1.0, inTx));
  float fw = max(fwidth(T), 1e-4);
  float edge = 1.0 - smoothstep(0.0, 1.2 * fw + 0.05, abs(T));
  float band = exp(-abs(T) * 1.4) * step(T, 0.0) * 0.10;
  vec3 frontCol = vec3(0.45, 0.78, 1.0) * (edge * 1.3 + band) * mix(0.3, 1.0, inTx);

  // --- night lights (NASA Black Marble 2016), driven by zones
  float L = texture2D(uLights, uv).r;
  float lin = pow(L, 1.9);
#ifdef CHEAP
  vec2 cell = floor(vec2(lon, lat) / 0.21);
#else
  vec2 cell = worleyCell(vec2(lon, lat) / 0.21);
#endif
  int zi = int(floor(hash12(cell + 17.0) * 16.0));
  bool crit = hash12(cell + 91.0) < 0.07;
  bool gas = masks.r > 0.5 && hash12(cell + 5.0) < 0.6;
  float zv = zoneValue(zi, crit, gas, false);
  float lit = zv;
  float flash = 0.0;
  if (uCollapsed > 0.5) {
    float d = distance(vWorld.xz, uWaveCenter);
    float before = clamp((d - uWaveR + 4.0) / 4.0, 0.0, 1.0); // 1 = wave not here yet
    float pre = zoneValue(zi, crit, gas, true);
    lit = mix(zv, pre, before);
    flash = exp(-pow((d - uWaveR) / 2.2, 2.0)) * step(uWaveR, ${WAVE_MAX_R.toFixed(1)});
  }
  float dayDim = mix(0.6, 1.0, uSky);
  vec3 amber = mix(vec3(1.0, 0.55, 0.20), vec3(1.0, 0.86, 0.66), smoothstep(0.55, 1.0, L));
  vec3 lightsTx = amber * lin * (lit * 4.2 + flash * 9.0) * dayDim;
  vec3 lightsOffGrid = vec3(0.78, 0.66, 0.52) * lin * 1.6 * dayDim; // not on this grid: never rotates or collapses
  lightsTx = mix(lightsTx, lightsOffGrid, smoothstep(0.3, 0.7, masks.g));
  vec3 lightsOut = vec3(0.9, 0.55, 0.28) * lin * 0.55 * dayDim;
  vec3 emit = mix(lightsOut, lightsTx, inTx);

  // sensor pulse over the gas fields
  float pulse = uSensor * (0.6 + 0.4 * sin(uTime * 5.0));
#ifdef CHEAP
  emit += masks.r * pulse * vec3(0.25, 0.65, 1.0) * 0.5;
#else
  emit += masks.r * pulse * vec3(0.25, 0.65, 1.0) * 0.6 * (0.6 + 0.4 * vnoise(vWorld.xz * 0.8 + uTime));
#endif

  emit += frontCol;

  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
  // fade the map's rectangular edges into the night
  float edgeFade = smoothstep(0.0, 0.12, uv.x) * (1.0 - smoothstep(0.88, 1.0, uv.x)) * smoothstep(0.0, 0.12, uv.y) * (1.0 - smoothstep(0.88, 1.0, uv.y));
  edgeFade = max(edgeFade, inTx);
  fogF = mix(1.0, fogF, edgeFade);
  vec3 col = mix(ground, uFogColor, fogF) + emit * (1.0 - 0.7 * fogF) * mix(0.0, 1.0, edgeFade);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function Terrain({ geo, stride = 2, cheap = false }: { geo: Geo; stride?: number; cheap?: boolean }) {
  const world = useWorld();
  const geometry = useMemo(() => buildGeometry(geo, stride), [geo, stride]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const base = import.meta.env.BASE_URL;
  const [lightsTex, terrainTex] = useLoader(THREE.TextureLoader, [`${base}geo/${geo.lights.file}`, `${base}geo/${geo.terrain.file}`]);
  const maskTex = useMemo(() => maskTexture(geo), [geo]);

  const uniforms = useMemo(() => {
    lightsTex.colorSpace = THREE.NoColorSpace;
    lightsTex.anisotropy = 4;
    terrainTex.colorSpace = THREE.NoColorSpace;
    return {
      uLights: { value: lightsTex },
      uTerrain: { value: terrainTex },
      uMasks: { value: maskTex },
      uBBox: { value: new THREE.Vector4(...geo.bbox) },
      uProj: { value: new THREE.Vector4(LON0, LAT0, KX, KY) },
      uZones: { value: Array.from(world.zones) },
      uPreZones: { value: Array.from(world.preCollapseZones) },
      uCollapsed: { value: 0 },
      uWaveR: { value: 0 },
      uWaveCenter: { value: new THREE.Vector2(WAVE_ORIGIN[0], WAVE_ORIGIN[1]) },
      uTime: { value: 0 },
      uSky: { value: 1 },
      uSensor: { value: 0 },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.75, 0.35) },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uRegionXZ: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector2()) },
      uRegionT: { value: new Array(MAX_REGIONS).fill(10) },
      uRegionSnow: { value: new Array(MAX_REGIONS).fill(0) },
      uRegionSnowing: { value: new Array(MAX_REGIONS).fill(0) },
      uRegionCount: { value: 0 },
    };
  }, [geo, lightsTex, terrainTex, maskTex, world]);

  // NB: R3F shallow-copies a JSX `uniforms` prop, so scalar updates would be lost; build it imperatively.
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, defines: cheap ? { CHEAP: "" } : {} }),
    [uniforms, cheap],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const u = uniforms;
    for (let i = 0; i < 18; i++) {
      u.uZones.value[i] = world.zones[i];
      u.uPreZones.value[i] = world.preCollapseZones[i];
    }
    u.uCollapsed.value = world.collapsed ? 1 : 0;
    u.uWaveR.value = world.waveR;
    u.uTime.value = world.now;
    u.uSky.value = world.skyTime;
    u.uSensor.value = Math.max(0, 1 - (world.now - world.sensorAt) / 6);
    u.uRegionCount.value = world.regionCount;
    for (let i = 0; i < MAX_REGIONS; i++) {
      u.uRegionXZ.value[i].set(world.regionXZ[i * 2], world.regionXZ[i * 2 + 1]);
      u.uRegionT.value[i] = world.temps[i];
      u.uRegionSnow.value[i] = world.snowDepth[i];
      u.uRegionSnowing.value[i] = world.snowing[i];
    }
  });

  return (
    <mesh geometry={geometry} material={material} frustumCulled={false} />
  );
}
