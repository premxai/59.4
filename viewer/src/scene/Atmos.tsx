// City glows, snow, frequency ring, camera rig.
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Geo } from "../lib/geo";
import { FOCUS, hash01, lonLatToXZ } from "../lib/geo";
import type { City } from "../lib/plants";
import { GLSL_COMMON } from "./glsl";
import { freqColor } from "./palette";
import { isNonErcot } from "../lib/grid";
import { MAX_REGIONS, useWorld, waveLit } from "./worldState";

// ------------------------------------------------------------------ city glows
/** A soft halo over each city. Brightness = mean of the zones its neighborhoods belong to. */
export function CityGlows({ geo, cities }: { geo: Geo; cities: City[] }) {
  const world = useWorld();
  const data = useMemo(
    () =>
      cities.map((c, i) => {
        const nz = c.population > 900_000 ? 5 : c.population > 300_000 ? 3 : 2;
        const zones = Array.from({ length: nz }, (_, k) => Math.floor(hash01(i * 13 + k, 77) * 16));
        const p = geo.toWorld(c.lon, c.lat, 0.6);
        return { p, zones, size: 0.6 + Math.sqrt(c.population / 1e6) * 1.6, lit: 1, offGrid: isNonErcot(c.lon, c.lat) };
      }),
    [geo, cities],
  );
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(data.flatMap((d) => d.p)), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(data.map((d) => d.size)), 1));
    g.setAttribute("aLit", new THREE.BufferAttribute(new Float32Array(data.length).fill(1), 1));
    return g;
  }, [data]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPx: { value: 1 }, uSky: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute float aSize; attribute float aLit; varying float vLit; uniform float uPx;
          void main(){
            vLit = aLit;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * aSize * 90.0 * (60.0 / -mv.z);
          }`,
        fragmentShader: /* glsl */ `
          varying float vLit; uniform float uSky;
          void main(){
            vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float a = exp(-r * r * 5.0) * 0.22 * vLit * mix(0.6, 1.0, uSky);
            if (a < 0.002) discard;
            gl_FragColor = vec4(vec3(1.0, 0.6, 0.28) * a, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useFrame(({ gl }, dt) => {
    mat.uniforms.uPx.value = gl.getPixelRatio();
    mat.uniforms.uSky.value = world.skyTime;
    const a = geom.getAttribute("aLit") as THREE.BufferAttribute;
    const k = 1 - Math.exp(-dt / 0.2);
    data.forEach((d, i) => {
      if (d.offGrid) {
        // not on the ERCOT grid: steady and dimmer, never rotates or collapses
        d.lit = 0.55;
        a.setX(i, d.lit);
        return;
      }
      const src = world.collapsed && waveLit(world, d.p[0], d.p[2]) > 0.5 ? world.preCollapseZones : world.zones;
      let s = 0;
      for (const z of d.zones) s += src[z];
      let target = s / d.zones.length;
      if (world.collapsed && waveLit(world, d.p[0], d.p[2]) <= 0.5) target = world.zones[16] * 0.15;
      d.lit += (target - d.lit) * k;
      a.setX(i, d.lit);
    });
    a.needsUpdate = true;
  });
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

// ------------------------------------------------------------------ snow
export function Snow({ count = 4500 }: { count?: number }) {
  const world = useWorld();
  const geom = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (hash01(i, 1) - 0.5) * 140;
      pos[i * 3 + 1] = hash01(i, 2) * 26;
      pos[i * 3 + 2] = (hash01(i, 3) - 0.5) * 130;
      seed[i] = hash01(i, 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, [count]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPx: { value: 1 },
      uWind: { value: new THREE.Vector2(0.4, 1.2) },
      uRegionXZ: { value: Array.from({ length: MAX_REGIONS }, () => new THREE.Vector2()) },
      uRegionT: { value: new Array(MAX_REGIONS).fill(10) },
      uRegionSnow: { value: new Array(MAX_REGIONS).fill(0) },
      uRegionSnowing: { value: new Array(MAX_REGIONS).fill(0) },
      uRegionCount: { value: 0 },
    }),
    [],
  );
  useFrame(({ gl }) => {
    const u = uniforms;
    u.uPx.value = gl.getPixelRatio();
    u.uTime.value = world.now;
    u.uRegionCount.value = world.regionCount;
    let w = 0;
    for (let i = 0; i < MAX_REGIONS; i++) {
      u.uRegionXZ.value[i].set(world.regionXZ[i * 2], world.regionXZ[i * 2 + 1]);
      u.uRegionT.value[i] = world.temps[i];
      u.uRegionSnow.value[i] = world.snowDepth[i];
      u.uRegionSnowing.value[i] = world.snowing[i];
      if (i < world.regionCount) w += world.wind[i];
    }
    w = world.regionCount ? w / world.regionCount : 3;
    u.uWind.value.set(0.25 * w, 0.18 * w);
  });
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms,
        vertexShader: /* glsl */ `
          ${GLSL_COMMON}
          attribute float aSeed; uniform float uTime; uniform float uPx; uniform vec2 uWind;
          varying float vA;
          void main(){
            vec3 p = position;
            float fall = 2.2 + aSeed * 1.5;
            p.y = mod(p.y - uTime * fall, 26.0);
            p.xz += uWind * (26.0 - p.y) * 0.12 + vec2(sin(uTime * 0.7 + aSeed * 30.0), cos(uTime * 0.5 + aSeed * 20.0)) * 0.4;
            vec3 w = idw3(p.xz);
            vA = smoothstep(0.02, 0.5, w.z) * smoothstep(0.0, 2.0, p.y) * (1.0 - smoothstep(20.0, 26.0, p.y));
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPx * (1.5 + aSeed * 2.5) * (120.0 / -mv.z);
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main(){
            vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
            float a = (1.0 - smoothstep(0.2, 1.0, r)) * vA * 0.6;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(0.78, 0.85, 1.0), a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [uniforms],
  );
  return <points geometry={geom} material={material} frustumCulled={false} />;
}

// ------------------------------------------------------------------ frequency ring
export function FreqRing() {
  const world = useWorld();
  const [cx, cz] = lonLatToXZ(FOCUS.lon, FOCUS.lat);
  const main = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const ticks = useRef<THREE.Group>(null);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    const f = world.freqMin;
    const [r, g, b] = freqColor(world.collapsed ? 0 : f);
    const danger = f == null || world.collapsed ? 0 : Math.max(0, Math.min(1, (60 - f) / 0.6));
    const pulse = 0.75 + 0.25 * Math.sin(world.now * (2 + danger * 10));
    const inten = world.collapsed ? 0.25 + 0.2 * Math.max(0, Math.sin(world.now * 30)) * Math.max(0, 1 - world.waveR / 120) : 1.7 * pulse;
    col.setRGB(r * inten, g * inten, b * inten);
    main.current?.color.copy(col);
    halo.current?.color.copy(col).multiplyScalar(0.18);
    if (ticks.current) ticks.current.rotation.y += dt * (0.05 + danger * 0.6);
  });
  return (
    <group position={[cx, 30, cz - 4]}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[34, 0.12, 8, 256]} />
        <meshBasicMaterial ref={main} toneMapped={false} fog={false} />
      </mesh>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[34, 0.9, 8, 256]} />
        <meshBasicMaterial ref={halo} toneMapped={false} transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} />
      </mesh>
      <group ref={ticks}>
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 35.6, 0, Math.sin(a) * 35.6]} rotation-y={-a}>
              <boxGeometry args={[i % 5 === 0 ? 1.6 : 0.7, 0.08, 0.08]} />
              <meshBasicMaterial color={new THREE.Color(0.35, 0.45, 0.7)} toneMapped={false} fog={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ camera
/** Slow cinematic orbit, driven by real time so split views stay in sync. */
export function CameraRig({ orbit = "sway", focus }: { orbit?: "sway" | "full" | "off"; focus?: [number, number, number] | null }) {
  const world = useWorld();
  const { camera, size } = useThree();
  const [cx, cz] = lonLatToXZ(focus ? focus[0] : FOCUS.lon, focus ? focus[1] : FOCUS.lat);
  const tension = useRef(0);
  useFrame((_, dt) => {
    const aspect = size.width / Math.max(1, size.height);
    const fit = Math.max(1, 1.3 / aspect);
    const counting = world.freqMin != null && world.freqMin < 59.7 && !world.collapsed ? 1 : 0;
    tension.current += (counting - tension.current) * (1 - Math.exp(-dt / 2));
    const t = world.now;
    // From the south (Texas reads upright), slowly swinging; "full" = continuous orbit.
    const a = orbit === "full" ? t * 0.03 : orbit === "sway" ? 0.42 * Math.sin(t * 0.025) : 0;
    if (focus) {
      // close-up: ?focus=lon,lat,dist
      const d = focus[2];
      camera.position.set(cx + Math.sin(a) * d, d * 0.55, cz + Math.cos(a) * d);
      camera.lookAt(cx, 0, cz);
      return;
    }
    const R = (118 - 12 * tension.current) * fit;
    const H = (116 - 10 * tension.current) * fit;
    camera.position.set(cx + Math.sin(a) * R, H, cz + 6 + Math.cos(a) * R);
    camera.lookAt(cx, 0, cz + 6);
  });
  return null;
}
