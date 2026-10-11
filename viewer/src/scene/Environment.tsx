import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Geo } from "../lib/geo";
import { lonLatToXZ } from "../lib/geo";
import { FOG_COLOR, FOG_DENSITY } from "./palette";
import { useWorld } from "./worldState";

const gulfVert = /* glsl */ `
varying vec3 vWorld; varying float vViewDist;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vViewDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const gulfFrag = /* glsl */ `
uniform float uTime; uniform vec3 uFogColor; uniform float uFogDensity;
varying vec3 vWorld; varying float vViewDist;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
void main() {
  vec2 p = vWorld.xz;
  float ripple = n(p * 0.9 + vec2(uTime * 0.15, uTime * 0.05)) * 0.6 + n(p * 2.3 - uTime * 0.2) * 0.4;
  vec3 col = vec3(0.004, 0.009, 0.022) + vec3(0.006, 0.012, 0.03) * ripple;
  // faint moon glint band
  float glint = pow(ripple, 8.0) * 0.08;
  col += vec3(0.25, 0.35, 0.6) * glint;
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
  gl_FragColor = vec4(mix(col, uFogColor, fogF), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function Gulf() {
  const world = useWorld();
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uFogColor: { value: new THREE.Color(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY } }),
    [],
  );
  useFrame(() => {
    uniforms.uTime.value = world.now;
  });
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: gulfVert, fragmentShader: gulfFrag, uniforms }), [uniforms]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} material={material}>
      <planeGeometry args={[600, 600]} />
    </mesh>
  );
}

const skyFrag = /* glsl */ `
uniform float uSky; uniform float uTime;
varying vec3 vDir;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 night = mix(vec3(0.030, 0.048, 0.095), vec3(0.006, 0.010, 0.026), pow(up, 0.6));
  vec3 day = mix(vec3(0.10, 0.12, 0.16), vec3(0.05, 0.06, 0.09), pow(up, 0.6));
  vec3 col = mix(day, night, clamp(uSky, 0.0, 1.0));
  // storm clouds
  vec2 q = d.xz / max(0.15, d.y) * 1.5 + vec2(uTime * 0.01, 0.0);
  float c = n(q) * 0.6 + n(q * 2.7) * 0.4;
  col *= 0.8 + 0.35 * c;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const skyVert = /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;

export function Sky() {
  const world = useWorld();
  const uniforms = useMemo(() => ({ uSky: { value: 1 }, uTime: { value: 0 } }), []);
  useFrame(() => {
    uniforms.uSky.value = world.skyTime;
    uniforms.uTime.value = world.now;
  });
  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms, side: THREE.BackSide, depthWrite: false }),
    [uniforms],
  );
  return (
    <mesh scale={900} renderOrder={-10} material={material}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}

/** Texas outline + Permian Basin outline draped on the terrain. */
export function Outlines({ geo }: { geo: Geo }) {
  const tx = useMemo(
    () =>
      geo.texas
        .filter((r) => r.length > 30)
        .map((ring) => ring.map(([lon, lat]) => new THREE.Vector3(...geo.toWorld(lon, lat, 0.08)))),
    [geo],
  );
  const perm = useMemo(
    () => geo.permian.map((ring) => ring.map(([lon, lat]) => new THREE.Vector3(...geo.toWorld(lon, lat, 0.1)))),
    [geo],
  );
  return (
    <group>
      {tx.map((pts, i) => (
        <Line key={i} points={pts} color={new THREE.Color(0.35, 0.5, 0.95).multiplyScalar(1.1)} lineWidth={1.4} transparent opacity={0.85} toneMapped={false} />
      ))}
      {perm.map((pts, i) => (
        <Line key={`p${i}`} points={pts} color={new THREE.Color(0.4, 0.55, 0.8)} lineWidth={1} dashed dashSize={0.8} gapSize={0.6} transparent opacity={0.35} />
      ))}
    </group>
  );
}

export { lonLatToXZ };
