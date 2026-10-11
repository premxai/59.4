// Procedural, stylized plant models (no external assets). Unit-sized; scaled per instance.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type T = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number };
function part(g: THREE.BufferGeometry, t: T = {}): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  // Normalize attribute sets so mergeGeometries accepts mixed primitives.
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p : p)), false)!;
  g.computeBoundingSphere();
  return g;
}

/** Tower + nacelle, height 1 (hub at y = 1, rotor faces +z). */
export function turbineTowerGeo() {
  return merge([
    part(new THREE.CylinderGeometry(0.012, 0.026, 1, 7), { y: 0.5 }),
    part(new THREE.BoxGeometry(0.045, 0.04, 0.1), { y: 1.0, z: -0.015 }),
  ]);
}
/** Three blades around the origin in the XY plane. */
export function turbineRotorGeo() {
  const blade = () => {
    const g = new THREE.BoxGeometry(0.022, 0.44, 0.006);
    g.translate(0.006, 0.23, 0);
    return g;
  };
  return merge([
    part(new THREE.SphereGeometry(0.022, 8, 6)),
    part(blade(), { rz: 0 }),
    part(blade(), { rz: (2 * Math.PI) / 3 }),
    part(blade(), { rz: (4 * Math.PI) / 3 }),
  ]);
}

/** Combined-cycle style: turbine hall, HRSG, one stack (top at y = 0.95, x = 0.38). */
export function gasPlantGeo() {
  return merge([
    part(new THREE.BoxGeometry(0.5, 0.22, 0.3), { y: 0.11 }),
    part(new THREE.BoxGeometry(0.22, 0.34, 0.22), { x: 0.3, y: 0.17 }),
    part(new THREE.CylinderGeometry(0.035, 0.05, 0.95, 10), { x: 0.38, y: 0.475 }),
  ]);
}
export const GAS_STACK_TOP = new THREE.Vector3(0.38, 0.97, 0);

/** Coal: boiler house + tall stack (top at y = 1.8). */
export function coalPlantGeo() {
  return merge([
    part(new THREE.BoxGeometry(0.45, 0.55, 0.35), { y: 0.275 }),
    part(new THREE.BoxGeometry(0.3, 0.2, 0.5), { x: -0.32, y: 0.1 }),
    part(new THREE.CylinderGeometry(0.045, 0.085, 1.8, 10), { x: 0.42, y: 0.9 }),
  ]);
}
export const COAL_STACK_TOP = new THREE.Vector3(0.42, 1.82, 0);

/** Hyperboloid cooling tower (LatheGeometry), height 1. */
export function coolingTowerGeo() {
  const pts: THREE.Vector2[] = [];
  const a = 0.17;
  const y0 = 0.72;
  const c = 0.36;
  for (let i = 0; i <= 16; i++) {
    const y = i / 16;
    pts.push(new THREE.Vector2(a * Math.sqrt(1 + ((y - y0) / c) ** 2), y));
  }
  return new THREE.LatheGeometry(pts, 24);
}
export function reactorGeo() {
  return merge([
    part(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 16), { y: 0.11 }),
    part(new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), { y: 0.22 }),
    part(new THREE.BoxGeometry(0.35, 0.14, 0.2), { x: 0.28, y: 0.07 }),
  ]);
}

/** Pumpjack base: skid, samson post, gearbox. Beam pivot at (0, 0.58, 0). */
export function pumpjackBaseGeo() {
  return merge([
    part(new THREE.BoxGeometry(0.7, 0.05, 0.18), { y: 0.025 }),
    part(new THREE.BoxGeometry(0.035, 0.6, 0.035), { x: -0.04, y: 0.3, z: 0.06, rz: -0.12 }),
    part(new THREE.BoxGeometry(0.035, 0.6, 0.035), { x: -0.04, y: 0.3, z: -0.06, rz: -0.12 }),
    part(new THREE.BoxGeometry(0.035, 0.6, 0.035), { x: 0.06, y: 0.29, z: 0, rz: 0.2 }),
    part(new THREE.BoxGeometry(0.14, 0.16, 0.14), { x: -0.25, y: 0.13 }),
  ]);
}
export const PUMPJACK_PIVOT_Y = 0.58;
/** Walking beam + horsehead + counterweight, around the pivot. */
export function pumpjackBeamGeo() {
  return merge([
    part(new THREE.BoxGeometry(0.72, 0.04, 0.05), { x: 0.04 }),
    part(new THREE.BoxGeometry(0.06, 0.2, 0.07), { x: 0.41, y: -0.05 }),
    part(new THREE.BoxGeometry(0.1, 0.08, 0.07), { x: -0.29, y: -0.04 }),
  ]);
}
