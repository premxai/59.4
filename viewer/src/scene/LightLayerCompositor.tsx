// LightLayerCompositor: the main stage view. Every pixel comes from Blender light layers
// weighted by the replay frame:
//   linear(base: crossfade sky_time x snow_amount)
//   + Σ zone_i · linear(zone_i)                     (frame.zones, eased; collapse = 1.5 s wave)
//   + gasplant·gas_plant_on + lines·line_glow + turbines·1 + battery·1
//   then the steam overlay (straight alpha) at opacity gas_plant_on, then bloom + AgX tone map.
// Sources are 8-bit sRGB WebP (scripts/layers/build_layers.py), decoded to linear on the GPU.
// Draw calls stay under 16 texture units: quad A = bases + zones 1..9, quad B (additive) =
// remaining zones + infra, quad C (alpha) = steam, then a 2D snow layer.
import { Suspense, use, useEffect, useMemo } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { useClock } from "../lib/clock";
import { TIERS, armQualityMonitor, useQuality, useTierSettings } from "../lib/quality";
import type { Replay } from "../lib/replay";
import { ZONE_IDS, isCollapsedAt, lerpField, zonesAt } from "../lib/replay";
import { coverFit, layerUrl, loadCam, type CamManifest, type Rect } from "../city/layers";

const params = new URLSearchParams(location.search);
/** Gain on the base images (sky + unlit city) and on the light layers. */
const BASE_GAIN = Number(params.get("exposure")) > 0 ? Number(params.get("exposure")) : 1.0;
const LIGHT_GAIN = Number(params.get("lights")) > 0 ? Number(params.get("lights")) : 1.6;
const EXPOSURE = 1.0;
/** neutral (default): keeps the Blender colors below ~0.8 and only rolls off highlights. */
const TONE_NAME = params.get("tone") ?? "neutral";
const TONE = TONE_NAME === "aces" ? ToneMappingMode.ACES_FILMIC : TONE_NAME === "agx" ? ToneMappingMode.AGX : ToneMappingMode.NEUTRAL;
const RENDERER_TONE = TONE_NAME === "aces" ? THREE.ACESFilmicToneMapping : TONE_NAME === "agx" ? THREE.AgXToneMapping : THREE.NeutralToneMapping;

const ZKEYS = [...ZONE_IDS, "zone_crit", "zone_gas"];
/** Collapse: downtown (01–04) → inner ring (05–10) → suburbs (11–16) → gas field → hospital (to backup). */
const COLLAPSE_ORDER = [...ZONE_IDS, "zone_gas", "zone_crit"];
export const COLLAPSE_WAVE_S = 1.5;
/** winterized = heat-trace glow on winterized plants/wells (on when the notebook's build winterizes anything). */
const INFRA_KEYS = ["gasplant", "lines", "turbines", "battery", "winterized"] as const;
const SKY_KEYS = ["sky0", "sky05", "sky1"] as const;

interface Slot {
  key: string; // weight key
  url: string;
  rect: Rect;
}

function skyWeights(st: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, st));
  return t <= 0.5 ? [1 - t / 0.5, t / 0.5, 0] : [0, 1 - (t - 0.5) / 0.5, (t - 0.5) / 0.5];
}

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function makeMaterial(slots: Slot[], textures: THREE.Texture[], mode: "opaque" | "add" | "alpha"): THREE.ShaderMaterial {
  const decl: string[] = [];
  const body: string[] = [];
  const uniforms: Record<string, THREE.IUniform> = {
    uFit: { value: new THREE.Vector4(1, 1, 0, 0) },
    uExposure: { value: EXPOSURE },
    uOpacity: { value: 1 },
  };
  slots.forEach((s, i) => {
    decl.push(`uniform sampler2D t${i}; uniform vec4 r${i}; uniform float w${i};`);
    uniforms[`t${i}`] = { value: textures[i] };
    uniforms[`r${i}`] = { value: new THREE.Vector4(...s.rect) };
    uniforms[`w${i}`] = { value: 0 };
    if (mode === "alpha") body.push(`{ vec4 s = S(t${i}, r${i}, iuv); pm += w${i} * s.rgb * s.a; a += w${i} * s.a; }`);
    else body.push(`if (w${i} > 0.001) c += w${i} * S(t${i}, r${i}, iuv).rgb;`);
  });
  const out =
    mode === "alpha"
      ? `c = a > 1e-4 ? pm / a : vec3(0.0); gl_FragColor = vec4(c * uExposure, a * uOpacity);`
      : `gl_FragColor = vec4(c * uExposure, 1.0);`;
  const frag = /* glsl */ `
uniform vec4 uFit;
uniform float uExposure;
uniform float uOpacity;
varying vec2 vUv;
${decl.join("\n")}
vec4 S(sampler2D t, vec4 r, vec2 iuv) {
  vec2 l = (iuv - r.xy) / r.zw;
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) return vec4(0.0);
  return texture2D(t, vec2(l.x, 1.0 - l.y));
}
void main() {
  vec2 iuv = vec2(vUv.x * uFit.x + uFit.z, (1.0 - vUv.y) * uFit.y + uFit.w);
  vec3 c = vec3(0.0); vec3 pm = vec3(0.0); float a = 0.0;
  ${body.join("\n  ")}
  ${out}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    transparent: mode !== "opaque",
    blending: mode === "add" ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function buildSlots(cam: string, man: CamManifest) {
  const full: Rect = [0, 0, 1, 1];
  const bases: Slot[] = [];
  for (const sky of SKY_KEYS)
    for (const snow of [0, 1]) {
      const f = man.bases[`${sky}_snow${snow}`];
      if (f) bases.push({ key: `${sky}_snow${snow}`, url: layerUrl(cam, f), rect: full });
    }
  const zones: Slot[] = [];
  for (const k of ZKEYS) {
    const l = man.zones[k];
    if (l) zones.push({ key: k, url: layerUrl(cam, l.file), rect: l.rect });
  }
  const infra: Slot[] = [];
  for (const k of INFRA_KEYS) {
    const l = man.infra[k];
    if (l) infra.push({ key: `infra_${k}`, url: layerUrl(cam, l.file), rect: l.rect });
  }
  const steam: Slot[] = [];
  for (const k of SKY_KEYS) {
    const l = man.steam[k];
    if (l) steam.push({ key: `steam_${k}`, url: layerUrl(cam, l.file), rect: l.rect });
  }
  // texture-unit budget: ≤ 15 per draw
  const nA = Math.max(0, 15 - bases.length);
  const quadA = [...bases, ...zones.slice(0, nA)];
  const quadB = [...zones.slice(nA), ...infra];
  return { quadA, quadB, steam };
}

/** Per-view state: eased weights for every layer key, recomputed each frame from the replay. */
function useWeights(replay: Replay) {
  return useMemo(() => {
    const w: Record<string, number> = {};
    for (const k of ZKEYS) w[k] = 1;
    return { w, pre: { ...w } as Record<string, number>, collapsed: false, collapseAt: null as number | null };
  }, [replay]);
}

function Composite({ replay, cam, winterized = 0 }: { replay: Replay; cam: string; winterized?: number }) {
  const { man } = use(loadCam(cam));
  const { quadA, quadB, steam } = useMemo(() => buildSlots(cam, man), [cam, man]);
  const all = useMemo(() => [...quadA, ...quadB, ...steam], [quadA, quadB, steam]);
  const textures = useLoader(THREE.TextureLoader, all.map((s) => s.url));
  useMemo(() => {
    for (const t of textures) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 1;
      t.needsUpdate = true;
    }
  }, [textures]);
  const mats = useMemo(() => {
    const a = makeMaterial(quadA, textures.slice(0, quadA.length), "opaque");
    const b = quadB.length ? makeMaterial(quadB, textures.slice(quadA.length, quadA.length + quadB.length), "add") : null;
    const c = steam.length ? makeMaterial(steam, textures.slice(quadA.length + quadB.length), "alpha") : null;
    return [
      { m: a, slots: quadA },
      ...(b ? [{ m: b, slots: quadB }] : []),
      ...(c ? [{ m: c, slots: steam }] : []),
    ];
  }, [quadA, quadB, steam, textures]);
  useEffect(() => () => mats.forEach(({ m }) => m.dispose()), [mats]);
  useEffect(() => armQualityMonitor(), []);

  const st = useWeights(replay);
  const { size } = useThree();

  useFrame((_, dt) => {
    const hour = Math.min(useClock.getState().hour, replay.frames.length - 1);
    const now = performance.now() / 1000;
    const collapsed = isCollapsedAt(replay, hour);
    if (collapsed && !st.collapsed) {
      st.collapseAt = now;
      st.pre = { ...st.w };
    }
    if (!collapsed) st.collapseAt = null;
    st.collapsed = collapsed;
    const z = zonesAt(replay, hour);
    const kNorm = 1 - Math.exp(-dt / 0.18);
    const kFast = 1 - Math.exp(-dt / 0.08);
    for (const key of ZKEYS) {
      let tgt = z[key] ?? 1;
      if (st.collapseAt != null) {
        const order = COLLAPSE_ORDER.indexOf(key);
        const tOff = (order / (COLLAPSE_ORDER.length - 1)) * COLLAPSE_WAVE_S;
        if (now - st.collapseAt < tOff) tgt = st.pre[key] ?? 1; // the wave hasn't reached this zone yet
      }
      st.w[key] += (tgt - st.w[key]) * (st.collapseAt != null ? kFast : kNorm);
    }
    const sky = skyWeights(lerpField(replay, hour, (f) => f.sky_time));
    const snow = Math.max(0, Math.min(1, lerpField(replay, hour, (f) => f.snow_amount)));
    for (let i = 0; i < 3; i++) {
      st.w[`${SKY_KEYS[i]}_snow0`] = sky[i] * (1 - snow) * BASE_GAIN;
      st.w[`${SKY_KEYS[i]}_snow1`] = sky[i] * snow * BASE_GAIN;
      st.w[`steam_${SKY_KEYS[i]}`] = sky[i];
    }
    const gasOn = Math.max(0, Math.min(1, lerpField(replay, hour, (f) => f.gas_plant_on)));
    st.w.infra_gasplant = gasOn;
    st.w.infra_lines = Math.max(0, Math.min(1, lerpField(replay, hour, (f) => f.line_glow)));
    st.w.infra_turbines = 1; // aviation lights stay on (battery-backed)
    st.w.infra_battery = 1;
    // per-frame `winterized` (if the exporter writes it) wins over the notebook-level prop
    const wf = replay.frames[Math.floor(hour)] as { winterized?: unknown } | undefined;
    st.w.infra_winterized = Math.max(0, Math.min(1, typeof wf?.winterized === "number" ? wf.winterized : winterized));

    const { s, ox, oy } = coverFit(size.width, size.height, man.width, man.height);
    const iw = man.width * s;
    const ih = man.height * s;
    for (const { m, slots } of mats) {
      m.uniforms.uFit.value.set(size.width / iw, size.height / ih, -ox / iw, -oy / ih);
      m.uniforms.uOpacity.value = gasOn;
      slots.forEach((sl, i) => {
        const isLight = sl.key.startsWith("zone_") || sl.key.startsWith("infra_");
        m.uniforms[`w${i}`].value = (st.w[sl.key] ?? 0) * (isLight ? LIGHT_GAIN : 1);
      });
    }
  });

  return (
    <>
      {mats.map(({ m }, i) => (
        <mesh key={i} material={m} frustumCulled={false} renderOrder={i}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      ))}
    </>
  );
}

/** Subtle 2D falling snow while any region reports snowfall. */
function SnowOverlay({ replay, count }: { replay: Replay; count: number }) {
  const geom = useMemo(() => {
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      seed[i * 3] = Math.random();
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(seed, 3));
    return g;
  }, [count]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uPx: { value: 1 }, uWind: { value: 0.05 } },
        vertexShader: /* glsl */ `
          uniform float uTime; uniform float uPx; uniform float uWind; varying float vA; uniform float uAmount;
          void main() {
            vec3 s = position;
            float speed = 0.06 + 0.08 * s.z;
            float y = 1.1 - mod(s.y * 2.2 + uTime * speed, 2.2);
            float x = -1.1 + mod(s.x * 2.2 + uTime * uWind * (0.5 + s.z) + 0.02 * sin(uTime * (0.6 + s.z) + s.y * 40.0), 2.2);
            gl_Position = vec4(x, y, 0.0, 1.0);
            gl_PointSize = uPx * (1.2 + 2.2 * s.z);
            vA = uAmount * (0.25 + 0.45 * s.z);
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            float r = length(gl_PointCoord - 0.5) * 2.0;
            float a = (1.0 - smoothstep(0.3, 1.0, r)) * vA;
            if (a < 0.01) discard;
            gl_FragColor = vec4(0.85, 0.9, 1.0, a);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useFrame(({ gl }) => {
    const hour = Math.min(useClock.getState().hour, replay.frames.length - 1);
    const n = replay.meta.regions.length || 1;
    const snowing = lerpField(replay, hour, (f) => Object.values(f.regions).reduce((a, r) => a + (r.snow_cm || 0), 0) / n);
    const wind = lerpField(replay, hour, (f) => Object.values(f.regions).reduce((a, r) => a + (r.wind_ms || 0), 0) / n);
    const target = Math.max(0, Math.min(1, snowing / 0.4));
    mat.uniforms.uAmount.value += (target - mat.uniforms.uAmount.value) * 0.05;
    mat.uniforms.uTime.value = performance.now() / 1000;
    mat.uniforms.uWind.value = 0.02 + wind * 0.008;
    mat.uniforms.uPx.value = gl.getPixelRatio();
  });
  return <points geometry={geom} material={mat} frustumCulled={false} renderOrder={10} />;
}

function Post() {
  const q = useTierSettings();
  if (q.bloom === "none") return null;
  return (
    <EffectComposer key={q.bloom} multisampling={0}>
      <Bloom mipmapBlur levels={q.bloom === "full" ? 7 : 5} intensity={0.85} luminanceThreshold={0.62} luminanceSmoothing={0.3} radius={0.62} />
      <ToneMapping mode={TONE} />
    </EffectComposer>
  );
}

export function LightLayerCompositor({ replay, cam = "CAM_Wide", winterized = 0 }: { replay: Replay; cam?: string; winterized?: number }) {
  const tier = useQuality((s) => s.tier);
  const q = TIERS[tier];
  return (
    <Canvas
      flat
      dpr={q.dpr}
      gl={{ antialias: false, powerPreference: "high-performance", toneMapping: q.bloom === "none" ? RENDERER_TONE : THREE.NoToneMapping }}
      orthographic
      camera={{ position: [0, 0, 1] }}
    >
      <color attach="background" args={["#000"]} />
      <Suspense fallback={null}>
        <Composite replay={replay} cam={cam} winterized={winterized} />
        {q.snow > 0 && <SnowOverlay replay={replay} count={Math.round(q.snow / 6)} />}
        <Post />
      </Suspense>
    </Canvas>
  );
}
