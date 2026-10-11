// All custom materials for the grid city. Everything is unlit-ish / hand-lit GLSL (no three lights,
// no shadows): one hemisphere + one "moon" term, procedural windows, emissive HDR values for bloom.
// Every material of one city shares the same uniform objects (U), so one update drives them all.
import * as THREE from "three";
import { CITY, DT_GRID, LINE_COUNT, N_LIGHTS, ROAD_HALF } from "./layout";

/** Must match SHADOW_EXT in geometry.ts (kept literal here to avoid an import cycle). */
const SHADOW_EXT = 26;
import type { GridLook } from "./types";

export type Shared = ReturnType<typeof makeShared>;

/** Clouds whose soft shadows the gridleaf ground receives (uCloud: x, z, radius, strength). */
export const N_CLOUDS = 10;

/** Material defines for a look ("gridleaf" compiles the LOOK_LEAF branches; "night" is unchanged). */
const lookDefs = (look: GridLook | undefined): Record<string, string> => (look === "gridleaf" ? { LOOK_LEAF: "" } : {});

export function makeShared() {
  return {
    uTime: { value: 0 },
    uLight: { value: new Float32Array(N_LIGHTS) },
    uLightPre: { value: new Float32Array(N_LIGHTS) },
    uWave: { value: new THREE.Vector4(0, -9, 0, 0) },
    uFrost: { value: 0 },
    uSnow: { value: 0.25 },
    uDay: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.4, 0.8, 0.35).normalize() },
    uSunCol: { value: new THREE.Color(0.16, 0.2, 0.32) },
    uSkyCol: { value: new THREE.Color(0.1, 0.12, 0.2) },
    uGndCol: { value: new THREE.Color(0.03, 0.035, 0.06) },
    uViewH: { value: 1000 },
    // gridleaf look only (unused by the night shaders)
    uFogCol: { value: new THREE.Color(0.8, 0.85, 0.78) },
    uFog: { value: new THREE.Vector2(21, 52) },
    uStorm: { value: 0 },
    uSolar: { value: 0 },
    uCloud: { value: Array.from({ length: N_CLOUDS }, () => new THREE.Vector4(0, 0, 1, 0)) },
  };
}

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uFrost;
uniform float uSnow;
uniform float uDay;
uniform vec4 uWave;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGndCol;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
vec3 litC(vec3 albedo, vec3 n) {
#ifdef LOOK_LEAF
  float d = clamp(dot(n, uSunDir) * 0.75 + 0.25, 0.0, 1.0);
#else
  float d = max(dot(n, uSunDir), 0.0);
#endif
  vec3 hemi = mix(uGndCol, uSkyCol, n.y * 0.5 + 0.5);
  return albedo * (hemi + uSunCol * d);
}
#ifdef LOOK_LEAF
uniform vec3 uFogCol;
uniform vec2 uFog;
uniform float uStorm;
uniform float uSolar;
uniform vec4 uCloud[${N_CLOUDS}];
float cloudShade(vec2 p) {
  float s = 0.0;
  for (int i = 0; i < ${N_CLOUDS}; i++) {
    vec4 c = uCloud[i];
    vec2 d = (p - c.xy) / max(c.z, 0.001);
    s = max(s, c.w * (1.0 - smoothstep(0.2, 1.0, dot(d, d))));
  }
  return s;
}
/** Lit colour with the soft cloud shadows taken out of the sun term. */
vec3 litW(vec3 albedo, vec3 n, vec2 xz) {
  float d = clamp(dot(n, uSunDir) * 0.75 + 0.25, 0.0, 1.0);
  vec3 hemi = mix(uGndCol, uSkyCol, n.y * 0.5 + 0.5);
  return albedo * (hemi + uSunCol * d * (1.0 - 0.55 * cloudShade(xz)));
}
vec3 leafFog(vec3 col, vec3 w) {
  return mix(col, uFogCol, smoothstep(uFog.x, uFog.y, length(w.xz)));
}
#endif
float waveDark(vec2 xz) {
  if (uWave.w <= 0.0) return 0.0;
  float d = distance(xz, uWave.xy);
  return uWave.w * (1.0 - smoothstep(uWave.z - 1.4, uWave.z, d));
}
vec3 winter(vec3 col, vec3 n, vec2 xz, float snowBias) {
  float up = smoothstep(0.55 - snowBias, 0.95 - snowBias, n.y);
  float nz = vnoise(xz * 6.0);
#ifdef LOOK_LEAF
  col = mix(col, vec3(0.86, 0.9, 0.96), clamp(uSnow * up * (0.65 + 0.35 * nz), 0.0, 1.0));
  float lum = max(max(col.r, col.g), col.b);
  col = mix(col, vec3(0.72, 0.84, 0.98) * lum, uFrost * 0.22);
#else
  col = mix(col, vec3(0.84, 0.88, 0.97), clamp(uSnow * up * (0.7 + 0.3 * nz), 0.0, 1.0));
  float lum = max(max(col.r, col.g), col.b);
  col = mix(col, vec3(0.7, 0.86, 1.0) * lum, uFrost * 0.28);
#endif
  return col;
}
`;

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ------------------------------------------------------------------ lit (props, buildings, roofs, jacks, rotors)
const LIT_VERT = /* glsl */ `
#ifdef USE_ZONE
attribute float aZone;
attribute float aSeed;
attribute float aKind;
uniform float uLight[${N_LIGHTS}];
uniform float uLightPre[${N_LIGHTS}];
varying float vLight;
varying float vLightPre;
varying float vSeed;
varying float vKind;
varying vec3 vLocal;
varying vec3 vObjN;
varying vec3 vScale;
#endif
varying vec3 vW;
varying vec3 vN;
varying vec3 vCol;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec3 sc = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(m) * (normal / (sc * sc)));
  vCol = vec3(1.0);
#ifdef USE_COLOR
  vCol = color;
#endif
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
#ifdef USE_ZONE
  int zi = int(aZone + 0.5);
  vLight = uLight[zi];
  vLightPre = uLightPre[zi];
  vSeed = aSeed;
  vKind = aKind;
  vScale = sc;
  vLocal = position * sc;
  vObjN = normal;
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const LIT_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uColor;
uniform float uSnowBias;
varying vec3 vW;
varying vec3 vN;
varying vec3 vCol;
#ifdef USE_ZONE
varying float vLight;
varying float vLightPre;
varying float vSeed;
varying float vKind;
varying vec3 vLocal;
varying vec3 vObjN;
varying vec3 vScale;

float windowMask(vec2 uv, vec2 cell, vec4 box, float seed, float ratio, out float litOut) {
  vec2 g = uv / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float inside = step(box.x, f.x) * step(f.x, box.y) * step(box.z, f.y) * step(f.y, box.w);
  litOut = step(hash12(id + seed * 37.0), ratio);
  return inside;
}
#endif
void main() {
  vec3 n = normalize(vN);
  vec3 albedo = uColor * vCol;
  vec3 emis = vec3(0.0);
  float snowBias = uSnowBias;
#ifdef USE_ZONE
  float wd = waveDark(vW.xz);
  float light = max(vLight, vLightPre * (1.0 - wd));
  int kind = int(vKind + 0.5);
  float sink = 0.15;
  float v = vLocal.y - sink;
  float hgt = vScale.y - sink;
  bool side = abs(vObjN.y) < 0.5;
  float u = abs(vObjN.x) > 0.5 ? vLocal.z : vLocal.x;
  float face = dot(vObjN, vec3(1.0, 0.0, 2.0));
  float s = vSeed + face * 0.173;
  float nightK = 1.0 - 0.45 * uDay;
  float lit = 0.0;
#ifdef LOOK_LEAF
  // daylight clay town: cream walls, terracotta / teal roofs; powered windows glow warm (stronger under
  // the storm's overcast), blacked-out districts turn cold, grey and dark
  float glowK = 0.7 + 1.2 * uStorm;
  vec3 warm = vec3(1.0, 0.72, 0.36);
  vec3 glassDark = vec3(0.16, 0.22, 0.3);
  float m = 0.0;
  if (kind == 0) {
    albedo = mix(vec3(0.62, 0.7, 0.78), vec3(0.76, 0.79, 0.82), hash11(vSeed * 91.0));
    if (side && v > 0.05 && v < hgt - 0.04) m = windowMask(vec2(u, v), vec2(0.095, 0.115), vec4(0.14, 0.86, 0.22, 0.82), s, 0.7, lit);
  } else if (kind == 1) {
    float pk = hash11(vSeed * 53.0);
    albedo = pk < 0.5 ? vec3(0.86, 0.76, 0.6) : vec3(0.9, 0.66, 0.52);
    if (side && v > 0.06 && v < hgt - 0.04) m = windowMask(vec2(u, v), vec2(0.12, 0.135), vec4(0.24, 0.76, 0.28, 0.72), s, 0.65, lit);
  } else if (kind == 2) {
    float pick = hash11(vSeed * 17.0);
    albedo = pick < 0.33 ? vec3(0.92, 0.86, 0.74) : pick < 0.66 ? vec3(0.95, 0.93, 0.88) : vec3(0.93, 0.83, 0.62);
    if (side && v > 0.04 && v < hgt - 0.02) m = windowMask(vec2(u + 0.03, v), vec2(0.1, 0.2), vec4(0.3, 0.7, 0.3, 0.68), s, 0.7, lit);
  } else if (kind == 3) {
    albedo = vec3(0.8, 0.81, 0.82);
    if (side) {
      float strip = step(hgt - 0.13, v) * step(v, hgt - 0.07);
      emis += vec3(0.25, 0.9, 0.5) * strip * light * 1.1;
      albedo = mix(albedo, vec3(0.2, 0.62, 0.38), strip * 0.6);
      m = windowMask(vec2(u, v), vec2(0.16, 0.16), vec4(0.3, 0.7, 0.3, 0.65), s, 0.5, lit) * step(v, hgt - 0.16) * step(0.05, v);
    }
  } else if (kind == 4) {
    albedo = vec3(0.95, 0.95, 0.94);
    if (side) {
      float band = step(hgt - 0.12, v) * step(v, hgt - 0.05);
      albedo = mix(albedo, vec3(0.85, 0.22, 0.18), band);
      emis += vec3(1.2, 0.12, 0.1) * band * max(light, 0.25) * 0.6;
      if (v > 0.06 && v < hgt - 0.16) m = windowMask(vec2(u, v), vec2(0.1, 0.12), vec4(0.2, 0.8, 0.25, 0.75), s, 0.9, lit);
    }
  } else {
    float pr = hash11(vSeed * 29.0);
    albedo = pr < 0.45 ? vec3(0.78, 0.33, 0.22) : pr < 0.75 ? vec3(0.3, 0.48, 0.52) : vec3(0.46, 0.58, 0.36);
    snowBias = 0.35;
  }
  float on = lit * clamp(light, 0.0, 1.0);
  albedo = mix(albedo, mix(glassDark, warm * 0.9, on), m);
  emis += warm * m * on * glowK;
  albedo *= 0.62 + 0.38 * smoothstep(0.0, 0.3, v + (kind == 5 ? 1.0 : 0.0));
  float off = 1.0 - clamp(light, 0.0, 1.0);
  float lumB = dot(albedo, vec3(0.3, 0.59, 0.11));
  albedo = mix(albedo, vec3(0.3, 0.37, 0.52) * lumB * 1.15, off * 0.8) * mix(1.0, 0.55, off);
#else
  if (kind == 0) {            // downtown tower
    albedo = mix(vec3(0.16, 0.2, 0.28), vec3(0.26, 0.3, 0.38), hash11(vSeed * 91.0));
    if (side && v > 0.05 && v < hgt - 0.04) {
      float m = windowMask(vec2(u, v), vec2(0.095, 0.115), vec4(0.14, 0.86, 0.22, 0.82), s, 0.66, lit);
      vec3 wc = mix(vec3(1.0, 0.72, 0.42), vec3(0.78, 0.88, 1.0), step(0.72, hash12(floor(vec2(u, v) / vec2(0.095, 0.115)) + s)));
      emis += wc * m * lit * light * 2.3 * nightK;
      albedo *= 1.0 - m * 0.4;
    }
  } else if (kind == 1) {     // inner-ring mid-rise
    albedo = mix(vec3(0.34, 0.29, 0.27), vec3(0.4, 0.38, 0.36), hash11(vSeed * 53.0));
    if (side && v > 0.06 && v < hgt - 0.04) {
      float m = windowMask(vec2(u, v), vec2(0.12, 0.135), vec4(0.24, 0.76, 0.28, 0.72), s, 0.6, lit);
      emis += vec3(1.0, 0.68, 0.36) * m * lit * light * 2.1 * nightK;
      albedo *= 1.0 - m * 0.35;
    }
  } else if (kind == 2) {     // suburban house
    float pick = hash11(vSeed * 17.0);
    albedo = pick < 0.33 ? vec3(0.62, 0.56, 0.46) : pick < 0.66 ? vec3(0.45, 0.52, 0.6) : vec3(0.5, 0.56, 0.47);
    if (side && v > 0.04 && v < hgt - 0.02) {
      float m = windowMask(vec2(u + 0.03, v), vec2(0.1, 0.2), vec4(0.3, 0.7, 0.3, 0.68), s, 0.62, lit);
      emis += vec3(1.0, 0.66, 0.34) * m * lit * light * 2.0 * nightK;
      albedo *= 1.0 - m * 0.3;
    }
  } else if (kind == 3) {     // industrial: light strip under the roof + a few windows
    albedo = vec3(0.4, 0.42, 0.47);
    if (side) {
      float strip = step(hgt - 0.13, v) * step(v, hgt - 0.07);
      emis += vec3(0.55, 0.85, 1.0) * strip * light * 1.7;
      float m = windowMask(vec2(u, v), vec2(0.16, 0.16), vec4(0.3, 0.7, 0.3, 0.65), s, 0.4, lit);
      emis += vec3(1.0, 0.75, 0.45) * m * lit * light * 1.3 * step(v, hgt - 0.16) * step(0.05, v);
    }
  } else if (kind == 4) {     // hospital
    albedo = vec3(0.82, 0.84, 0.87);
    if (side) {
      float band = step(hgt - 0.12, v) * step(v, hgt - 0.05);
      emis += vec3(1.8, 0.16, 0.12) * band * max(light, 0.18);
      if (v > 0.06 && v < hgt - 0.16) {
        float m = windowMask(vec2(u, v), vec2(0.1, 0.12), vec4(0.2, 0.8, 0.25, 0.75), s, 0.86, lit);
        emis += vec3(0.85, 0.95, 1.0) * m * lit * light * 2.0;
        albedo *= 1.0 - m * 0.4;
      }
    }
  } else {                    // pitched roof
    albedo = mix(vec3(0.24, 0.19, 0.18), vec3(0.2, 0.22, 0.26), hash11(vSeed * 29.0));
    snowBias = 0.35;
  }
  albedo *= 0.55 + 0.45 * smoothstep(0.0, 0.3, v + (kind == 5 ? 1.0 : 0.0));
  // blacked-out blocks read as dark silhouettes, day or night
  albedo *= mix(0.42, 1.0, clamp(light, 0.0, 1.0));
  // warm street-level bounce from lit districts, cold when dark
  emis += albedo * vec3(1.0, 0.6, 0.3) * light * 0.22 * (1.0 - smoothstep(0.0, 1.4, v)) * nightK;
#endif
#endif
#ifdef LOOK_LEAF
#ifndef USE_ZONE
  // solar panels (the only strongly blue props): dull when the field produces little, sky sheen when it runs
  float isPanel = step(2.4 * albedo.g, albedo.b) * step(3.0 * albedo.r, albedo.b) * step(0.05, albedo.b);
  albedo = mix(albedo, albedo * (0.55 + 0.6 * uSolar) + vec3(0.06, 0.12, 0.2) * uSolar, isPanel);
  emis += vec3(0.25, 0.45, 0.8) * isPanel * uSolar * 0.18;
#endif
  vec3 col = litW(winter(albedo, n, vW.xz, snowBias), n, vW.xz) + emis;
  col = leafFog(col, vW);
#else
  vec3 col = litC(winter(albedo, n, vW.xz, snowBias), n) + emis;
#endif
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

export function makeLit(U: Shared, opts: { zone?: boolean; vertexColors?: boolean; color?: THREE.ColorRepresentation; snowBias?: number; look?: GridLook } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(opts.color ?? 0xffffff) }, uSnowBias: { value: opts.snowBias ?? 0 } },
    vertexShader: LIT_VERT,
    fragmentShader: LIT_FRAG,
    vertexColors: !!opts.vertexColors,
    defines: { ...(opts.zone ? { USE_ZONE: "" } : {}), ...lookDefs(opts.look) },
  });
}

// ------------------------------------------------------------------ clouds (gridleaf): soft clay puffs, instanced
const CLOUD_FRAG = /* glsl */ `
${COMMON}
uniform float uOpacity;
varying vec3 vW;
varying vec3 vN;
varying vec3 vCol;
void main() {
  vec3 n = normalize(vN);
  float d = clamp(dot(n, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  vec3 hemi = mix(uGndCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 col = vCol * (hemi * 1.15 + uSunCol * d);
#ifdef LOOK_LEAF
  col = leafFog(col, vW);
#endif
  gl_FragColor = vec4(col, uOpacity);
  ${OUT}
}
`;

export function makeCloud(U: Shared, look?: GridLook) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uOpacity: { value: 0.94 } },
    vertexShader: LIT_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    defines: lookDefs(look),
  });
}

// ------------------------------------------------------------------ focus ring (click-to-focus), drawn over everything
const RING_VERT = /* glsl */ `
varying float vR;
void main() {
  vR = length(position.xz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uFill;
varying float vR;
void main() {
  float ring = smoothstep(0.93, 0.955, vR) * (1.0 - smoothstep(0.975, 1.0, vR));
  float sweep = 0.5 + 0.5 * sin(uTime * 2.6 - vR * 6.0);
  float a = ring * (0.5 + 0.2 * sweep) + uFill * (0.03 + 0.025 * sweep) * smoothstep(0.3, 0.93, vR) * (1.0 - smoothstep(0.92, 0.95, vR));
  gl_FragColor = vec4(uColor, a * uOpacity);
  ${OUT}
}
`;

export function makeRing(U: Shared, color: THREE.ColorRepresentation, fill: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uFill: { value: fill } },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

// ------------------------------------------------------------------ ground / terrain
const GROUND_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GROUND_FRAG = /* glsl */ `
${COMMON}
#define PI 3.14159265
uniform float uLight[${N_LIGHTS}];
uniform float uLightPre[${N_LIGHTS}];
#ifdef LOOK_LEAF
uniform sampler2D uShadow;
#endif
varying vec3 vW;
varying vec3 vN;
const vec2 C = vec2(${CITY.cx.toFixed(3)}, ${CITY.cz.toFixed(3)});
const float R0 = ${CITY.r0.toFixed(3)};
const float R1 = ${CITY.r1.toFixed(3)};
const float R2 = ${CITY.r2.toFixed(3)};
const float DT = ${DT_GRID.toFixed(3)};
const float RH = ${ROAD_HALF.toFixed(3)};
int zoneAt(vec2 p) {
  vec2 d = p - C;
  float r = length(d);
  if (r < R0) return d.y < 0.0 ? (d.x >= 0.0 ? 0 : 1) : (d.x < 0.0 ? 2 : 3);
  float a = atan(d.y, d.x) + PI;
  if (r < R1) return 4 + int(mod(floor(a / (2.0 * PI) * 6.0), 6.0));
  if (r < R2) return 10 + int(mod(floor((a + PI / 6.0) / (2.0 * PI) * 6.0), 6.0));
  return -1;
}
float roadDist(vec2 p) {
  vec2 d = p - C;
  float r = length(d);
  float rd = min(min(abs(r - R0), abs(r - R1)), abs(r - R2));
  float a = atan(d.y, d.x) + PI;
  if (r < R0) {
    vec2 g = abs(fract(d / DT + 0.5) - 0.5) * DT;
    rd = min(rd, min(g.x, g.y));
  } else {
    float off = r < R1 ? 0.0 : PI / 6.0;
    float st = PI / 3.0;
    float k = floor((a + off) / st + 0.5);
    rd = min(rd, abs(sin(a + off - k * st)) * r);
  }
  return rd;
}
void main() {
  vec3 n = normalize(vN);
  vec2 p = vW.xz;
  float nz = vnoise(p * 1.3) * 0.6 + vnoise(p * 4.1) * 0.4;
#ifdef LOOK_LEAF
  // ---------------- gridleaf: sage-green clay land, patchwork fields outside the plate
  float inPlate = 1.0 - smoothstep(11.6, 12.4, max(abs(p.x), abs(p.y)));
  vec3 albedo = mix(vec3(0.17, 0.36, 0.1), vec3(0.27, 0.49, 0.15), nz);
  if (inPlate < 0.999) {
    vec2 q = mat2(0.92, 0.38, -0.38, 0.92) * p / 3.4;
    vec2 cid = floor(q);
    vec2 cf = fract(q);
    float hh = hash12(cid);
    vec3 tint = hh < 0.25 ? vec3(0.4, 0.53, 0.16) : hh < 0.5 ? vec3(0.2, 0.4, 0.12) : hh < 0.62 ? vec3(0.62, 0.5, 0.22) : albedo;
    float edge = smoothstep(0.0, 0.04, min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)));
    tint *= mix(0.8, 1.0, edge);
    float far = smoothstep(14.0, 20.0, max(abs(p.x), abs(p.y)));
    albedo = mix(albedo, tint, (1.0 - inPlate) * 0.85 * far);
  }
  float field = smoothstep(-5.6, -7.2, p.x) * smoothstep(-2.6, -1.4, p.y) * inPlate;
  float dirt = smoothstep(0.45, 0.7, vnoise(p * 0.85 + 3.0)) * field;
  albedo = mix(albedo, vec3(0.58, 0.44, 0.26), dirt * (1.0 - uSnow * 0.5));
  albedo = mix(albedo, vec3(0.7, 0.62, 0.44), smoothstep(-0.07, -0.15, vW.y));
  vec3 emis = vec3(0.0);
  int z = zoneAt(p);
  float wd = waveDark(p);
  if (z >= 0) {
    float l = max(uLight[z], uLightPre[z] * (1.0 - wd));
    float rd = roadDist(p);
    float road = 1.0 - smoothstep(RH * 0.55, RH, rd);
    albedo = mix(albedo, vec3(0.3, 0.5, 0.2), 0.5);
    albedo = mix(albedo, vec3(0.6, 0.58, 0.53), road);
    float street = exp(-rd * rd / 0.012);
    emis += vec3(1.0, 0.62, 0.3) * l * street * (0.08 + 0.35 * uStorm);
    float off = 1.0 - l;
    float lumG = dot(albedo, vec3(0.3, 0.59, 0.11));
    albedo = mix(albedo, vec3(0.3, 0.36, 0.5) * lumG * 1.2, off * 0.75) * mix(1.0, 0.58, off);
  }
  if (uWave.w > 0.0) {
    float d = distance(p, uWave.xy);
    float ring = exp(-pow((d - uWave.z) / 0.45, 2.0));
    emis += vec3(0.45, 0.7, 1.2) * ring * uWave.w * (1.0 - smoothstep(12.0, 30.0, uWave.z)) * 1.6;
  }
  vec2 sc = floor(p * 38.0);
  float sp = step(0.986, hash12(sc)) * uFrost * (0.5 + 0.5 * sin(uTime * 2.5 + hash12(sc + 7.0) * 40.0));
  emis += vec3(0.75, 0.88, 1.0) * sp * 0.6;
  // baked soft shadows: the cast part fades under the storm's overcast, the contact part stays
  float sh = texture2D(uShadow, (p + ${SHADOW_EXT.toFixed(1)}) / ${(SHADOW_EXT * 2).toFixed(1)}).r;
  vec3 base = winter(albedo, n, p, 0.0);
  float dsun = clamp(dot(n, uSunDir) * 0.75 + 0.25, 0.0, 1.0);
  vec3 hemi = mix(uGndCol, uSkyCol, n.y * 0.5 + 0.5);
  vec3 col = base * (hemi * (1.0 - 0.28 * sh) + uSunCol * dsun * (1.0 - 0.55 * cloudShade(p)) * (1.0 - 0.62 * sh)) + emis;
  col = leafFog(col, vW);
  gl_FragColor = vec4(col, 1.0);
#else
  vec3 albedo = vec3(0.52, 0.56, 0.65) * (0.84 + 0.16 * nz);
  // gas field: bare dirt + well-pad tracks in the west
  float field = smoothstep(-5.6, -7.2, p.x) * smoothstep(-2.6, -1.4, p.y);
  float dirt = smoothstep(0.52, 0.72, vnoise(p * 0.85 + 3.0)) * field;
  albedo = mix(albedo, vec3(0.26, 0.21, 0.17), dirt * (1.0 - uSnow * 0.55));
  vec3 emis = vec3(0.0);
  int z = zoneAt(p);
  float wd = waveDark(p);
  float nightK = 1.0 - 0.55 * uDay;
  if (z >= 0) {
    float l = max(uLight[z], uLightPre[z] * (1.0 - wd));
    float rd = roadDist(p);
    float road = 1.0 - smoothstep(RH * 0.55, RH, rd);
    albedo = mix(albedo * 0.92, vec3(0.13, 0.14, 0.17), road);
    float street = exp(-rd * rd / 0.012);
    float yard = 0.1 + 0.08 * vnoise(p * 3.0);
    emis += vec3(1.0, 0.56, 0.24) * l * (yard + 0.75 * street) * nightK;
    // dark districts read cold and dark (snow under a blacked-out neighborhood)
    albedo *= mix(mix(0.34, 0.5, uDay), 1.0, l);
  }
  // collapse: a bright cold ring at the wave front
  if (uWave.w > 0.0) {
    float d = distance(p, uWave.xy);
    float ring = exp(-pow((d - uWave.z) / 0.45, 2.0));
    emis += vec3(0.45, 0.7, 1.2) * ring * uWave.w * (1.0 - smoothstep(12.0, 30.0, uWave.z)) * 1.6;
  }
  // frost sparkle
  vec2 sc = floor(p * 38.0);
  float sp = step(0.986, hash12(sc)) * uFrost * (0.5 + 0.5 * sin(uTime * 2.5 + hash12(sc + 7.0) * 40.0));
  emis += vec3(0.75, 0.88, 1.0) * sp * 0.9;
  vec3 col = litC(winter(albedo, n, p, 0.0), n) + emis;
  gl_FragColor = vec4(col, 1.0);
#endif
  ${OUT}
}
`;

export function makeGround(U: Shared, look?: GridLook, shadow?: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, ...(look === "gridleaf" ? { uShadow: { value: shadow ?? null } } : {}) },
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    defines: lookDefs(look),
  });
}

// ------------------------------------------------------------------ river
const RIVER_FRAG = /* glsl */ `
${COMMON}
varying vec3 vW;
varying vec3 vN;
void main() {
  vec2 p = vW.xz;
  float flowN = vnoise(vec2(p.x * 3.0, p.y * 1.2 - uTime * 0.25));
#ifdef LOOK_LEAF
  vec3 water = mix(vec3(0.1, 0.34, 0.46), vec3(0.2, 0.5, 0.6), flowN) * (1.0 - 0.35 * uStorm);
  float ice = smoothstep(0.55, 0.62, vnoise(p * 2.2 + vec2(0.0, uTime * 0.04))) * smoothstep(0.2, 0.8, uFrost);
  vec3 col = mix(water, litC(vec3(0.82, 0.9, 0.96), vec3(0.0, 1.0, 0.0)), ice);
  col += vec3(0.5, 0.65, 0.7) * pow(flowN, 5.0) * (1.0 - ice) * 0.5;
  col = leafFog(col, vW);
#else
  vec3 water = mix(vec3(0.02, 0.05, 0.09), vec3(0.05, 0.1, 0.16), flowN) * (1.0 + uDay * 2.5);
  float ice = smoothstep(0.55, 0.62, vnoise(p * 2.2 + vec2(0.0, uTime * 0.04))) * smoothstep(0.2, 0.8, uFrost);
  vec3 col = mix(water, litC(vec3(0.7, 0.8, 0.9), vec3(0.0, 1.0, 0.0)), ice);
  col += vec3(0.25, 0.32, 0.45) * pow(flowN, 6.0) * (1.0 - ice) * 0.6;
#endif
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

export function makeRiver(U: Shared, look?: GridLook) {
  return new THREE.ShaderMaterial({ uniforms: { ...U }, vertexShader: GROUND_VERT, fragmentShader: RIVER_FRAG, defines: lookDefs(look) });
}

// ------------------------------------------------------------------ transmission lines (energy pulses)
const LINE_VERT = /* glsl */ `
attribute float aT;
attribute float aLine;
uniform float uFlow[${LINE_COUNT}];
varying float vT;
varying float vFlow;
varying float vLine;
varying vec3 vW;
void main() {
  vT = aT;
  vLine = aLine;
  vFlow = uFlow[int(aLine + 0.5)];
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const LINE_FRAG = /* glsl */ `
${COMMON}
uniform float uPhase;
uniform float uStrain;
varying float vT;
varying float vFlow;
varying float vLine;
varying vec3 vW;
void main() {
  float flow = vFlow * (1.0 - waveDark(vW.xz));
  float dash = fract(vT * 0.7 - uPhase);
  float pulse = smoothstep(0.0, 0.06, dash) * (1.0 - smoothstep(0.06, 0.3, dash));
  float flick = step(0.42, hash11(floor(uTime * 9.0) + vLine * 7.31));
#ifdef LOOK_LEAF
  // fresh green energy pulses (#3DBE6E); amber flicker when the grid strains; grey when dead
  vec3 c = mix(vec3(0.07, 0.95, 0.3), vec3(1.6, 0.5, 0.05), uStrain * (0.5 + 0.5 * flick));
  float amp = 1.0 - uStrain * 0.55 * (1.0 - flick);
  vec3 col = vec3(0.16, 0.18, 0.2) * (1.0 - 0.4 * flow) + c * flow * (0.35 + pulse * 2.6) * amp;
  col = leafFog(col, vW);
#else
  vec3 c = mix(vec3(0.25, 0.85, 1.3), vec3(1.5, 0.66, 0.12), uStrain * (0.5 + 0.5 * flick));
  float amp = 1.0 - uStrain * 0.55 * (1.0 - flick);
  vec3 col = vec3(0.05, 0.055, 0.07) + c * flow * (0.3 + pulse * 2.8) * amp;
#endif
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

export function makeLines(U: Shared, look?: GridLook) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uFlow: { value: new Float32Array(LINE_COUNT) }, uPhase: { value: 0 }, uStrain: { value: 0 } },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    defines: lookDefs(look),
  });
}

// ------------------------------------------------------------------ gas pipeline (orange flow)
const PIPE_VERT = /* glsl */ `
attribute float aT;
attribute float aSeg;
uniform float uSegFlow[5];
varying float vT;
varying float vSeg;
varying float vFlow;
varying vec3 vW;
varying vec3 vN;
void main() {
  vT = aT;
  vSeg = aSeg;
  vFlow = uSegFlow[int(aSeg + 0.5)];
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const PIPE_FRAG = /* glsl */ `
${COMMON}
uniform float uPhaseA;
uniform float uPhaseB;
varying float vT;
varying float vSeg;
varying float vFlow;
varying vec3 vW;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  float flow = vFlow;
  float ph = vSeg < 0.5 ? uPhaseA : uPhaseB;
  float dash = fract(vT * 1.5 - ph);
  float duty = 0.12 + 0.38 * flow;
  float pulse = smoothstep(0.0, 0.04, dash) * (1.0 - smoothstep(duty - 0.04, duty, dash));
#ifdef LOOK_LEAF
  vec3 steel = litW(winter(vec3(0.62, 0.62, 0.6), n, vW.xz, 0.0), n, vW.xz);
#else
  vec3 steel = litC(winter(vec3(0.36, 0.37, 0.4), n, vW.xz, 0.0), n);
#endif
  vec3 orange = vec3(1.7, 0.62, 0.1);
  float on = smoothstep(0.02, 0.15, flow);
  vec3 col = steel * (1.0 - 0.35 * on) + orange * on * (0.1 + 0.25 * flow + pulse * 1.7 * (0.35 + 0.65 * flow));
#ifdef LOOK_LEAF
  col = leafFog(col, vW);
#endif
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

export function makePipes(U: Shared, look?: GridLook) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uSegFlow: { value: new Float32Array(5) }, uPhaseA: { value: 0 }, uPhaseB: { value: 0 } },
    vertexShader: PIPE_VERT,
    fragmentShader: PIPE_FRAG,
    defines: lookDefs(look),
  });
}

// ------------------------------------------------------------------ unlit glow (street lights, lamps, bars, rings)
const GLOW_VERT = /* glsl */ `
#ifdef USE_ZONE
attribute float aZone;
uniform float uLight[${N_LIGHTS}];
uniform float uLightPre[${N_LIGHTS}];
#endif
#ifdef USE_BLINK
attribute float aBlink;
#endif
uniform float uTime;
uniform vec4 uWave;
varying vec3 vCol;
float wDark(vec2 xz) {
  if (uWave.w <= 0.0) return 0.0;
  return uWave.w * (1.0 - smoothstep(uWave.z - 1.4, uWave.z, distance(xz, uWave.xy)));
}
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 w = m * vec4(position, 1.0);
  vCol = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#endif
#ifdef USE_ZONE
  int zi = int(aZone + 0.5);
  vCol *= max(uLight[zi], uLightPre[zi] * (1.0 - wDark(w.xz)));
#endif
#ifdef USE_BLINK
  vCol *= mix(1.0, step(0.55, fract(uTime * 0.7 + aBlink)), step(0.001, aBlink));
#endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vCol;
void main() {
  gl_FragColor = vec4(uColor * vCol, 1.0);
  ${OUT}
}
`;

export function makeGlow(U: Shared, opts: { zone?: boolean; blink?: boolean; color?: THREE.ColorRepresentation } = {}) {
  const defines: Record<string, string> = {};
  if (opts.zone) defines.USE_ZONE = "";
  if (opts.blink) defines.USE_BLINK = "";
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(opts.color ?? 0xffffff) } },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    defines,
  });
}

// ------------------------------------------------------------------ steam plumes (points)
export const MAX_EMITTERS = 9;
const PLUME_VERT = /* glsl */ `
attribute float aEmit;
attribute vec3 aRnd;
uniform float uTime;
uniform float uViewH;
uniform vec3 uEmitPos[${MAX_EMITTERS}];
uniform vec2 uEmitParam[${MAX_EMITTERS}];
uniform vec2 uWind;
varying float vAlpha;
varying float vLife;
void main() {
  int ei = int(aEmit + 0.5);
  vec3 o = uEmitPos[ei];
  float str = uEmitParam[ei].x;
  float sc = uEmitParam[ei].y;
  float life = fract(uTime * (0.09 + 0.05 * aRnd.x) + aRnd.y);
  vec3 p = o + vec3((aRnd.z - 0.5) * 0.18 * sc, 0.0, (aRnd.x - 0.5) * 0.18 * sc);
  p.y += life * (0.9 + 0.9 * str) * sc;
  p.xz += uWind * life * life * 1.5 * sc;
  p.xz += vec2(sin(life * 6.0 + aRnd.y * 20.0), cos(life * 5.0 + aRnd.z * 20.0)) * 0.1 * life * sc;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (0.16 + life * 0.7) * sc * (0.35 + 0.65 * str);
  gl_PointSize = size * uViewH * 0.5 * projectionMatrix[1][1] / -mv.z;
  vAlpha = str * smoothstep(0.0, 0.12, life) * (1.0 - life) * 0.5;
  vLife = life;
}
`;
const PLUME_FRAG = /* glsl */ `
uniform float uDay;
varying float vAlpha;
varying float vLife;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, r) * vAlpha;
  if (a < 0.004) discard;
#ifdef LOOK_LEAF
  vec3 col = vec3(0.93, 0.94, 0.96);
  a = min(1.0, a * 1.3);
#else
  vec3 col = mix(vec3(0.36, 0.38, 0.46), vec3(0.85, 0.88, 0.94), uDay) + vec3(0.35, 0.16, 0.05) * (1.0 - vLife) * (1.0 - uDay) * 0.6;
#endif
  gl_FragColor = vec4(col, a);
  ${OUT}
}
`;

export function makePlumes(U: Shared, look?: GridLook) {
  const pos: THREE.Vector3[] = [];
  const par: THREE.Vector2[] = [];
  for (let i = 0; i < MAX_EMITTERS; i++) {
    pos.push(new THREE.Vector3());
    par.push(new THREE.Vector2());
  }
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uEmitPos: { value: pos }, uEmitParam: { value: par }, uWind: { value: new THREE.Vector2(0.35, 0.2) } },
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    defines: lookDefs(look),
  });
}

// ------------------------------------------------------------------ snowfall (points)
const SNOW_VERT = /* glsl */ `
attribute vec4 aRnd;
uniform float uTime;
uniform float uViewH;
uniform float uAmount;
varying float vA;
void main() {
  float fall = 0.55 + aRnd.y * 0.5;
  vec3 p;
  p.y = mod(aRnd.y * 9.0 - uTime * fall, 9.0);
  p.x = (aRnd.x - 0.5) * 26.0 + sin(uTime * 0.7 + aRnd.z * 30.0) * 0.25 + (9.0 - p.y) * 0.18;
  p.z = (aRnd.z - 0.5) * 26.0 + cos(uTime * 0.6 + aRnd.x * 30.0) * 0.25;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.035 + aRnd.w * 0.035) * uViewH * 0.5 * projectionMatrix[1][1] / -mv.z;
  vA = step(aRnd.w, uAmount) * smoothstep(9.0, 7.5, p.y) * smoothstep(-0.2, 0.6, p.y);
}
`;
const SNOW_FRAG = /* glsl */ `
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.2, r) * vA * 0.85;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.9, 0.94, 1.0), a);
  ${OUT}
}
`;

export function makeSnow(U: Shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uAmount: { value: 0 } },
    vertexShader: SNOW_VERT,
    fragmentShader: SNOW_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

// ------------------------------------------------------------------ backdrop (screen-space sky gradient)
const BACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}
`;
const BACK_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBot;
uniform float uStars;
varying vec2 vUv;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 col = mix(uBot, uTop, smoothstep(0.0, 1.0, vUv.y));
  float vig = smoothstep(1.25, 0.35, length((vUv - vec2(0.5, 0.55)) * vec2(1.2, 1.0)));
#ifdef LOOK_LEAF
  col *= 0.94 + 0.06 * vig;
#else
  col *= 0.55 + 0.45 * vig;
#endif
  vec2 g = floor(gl_FragCoord.xy / 3.0);
  float st = step(0.9965, h12(g)) * smoothstep(0.55, 1.0, vUv.y) * uStars;
  col += vec3(0.8, 0.85, 1.0) * st * 0.6;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}
`;

export function makeBackdrop(look?: GridLook) {
  return new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uStars: { value: 1 } },
    vertexShader: BACK_VERT,
    fragmentShader: BACK_FRAG,
    depthWrite: false,
    depthTest: false,
    defines: lookDefs(look),
  });
}
