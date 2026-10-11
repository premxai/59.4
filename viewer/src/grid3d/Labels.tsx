// Labels anchored in 3D: plant badges, story callouts, the floating gas gauge.
// Plain DOM in the main React tree (no drei <Html> roots: under React 19 StrictMode those race on
// mount/unmount). One in-canvas projector moves every label each frame by writing its transform.
import { useRef, useSyncExternalStore, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ANCHORS, BAR_H, GAS_PLANTS, PLANT_SLOTS, terrainH } from "./layout";
import { PLANT_BADGE, type Anchor, type Callout, type PlantState } from "./model";
import type { World } from "./geometry";

export interface LabelState {
  badges: PlantState[];
  callouts: Callout[];
  gasPct: number;
  show: boolean;
}

export interface Store<T> {
  get: () => T;
  set: (v: T) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createStore<T>(init: T): Store<T> {
  let v = init;
  let key = JSON.stringify(init);
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => {
      const k = JSON.stringify(n);
      if (k === key) return;
      key = k;
      v = n;
      subs.forEach((s) => s());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

type Dir = "up" | "right" | "left";
const CALLOUT_AT: Record<Anchor, { pos: [number, number, number]; dir: Dir }> = {
  field: { pos: ANCHORS.field, dir: "up" },
  compressor: { pos: ANCHORS.compressor, dir: "right" },
  gasplants: { pos: ANCHORS.gasplants, dir: "up" },
  city: { pos: ANCHORS.city, dir: "up" },
  hospital: { pos: ANCHORS.hospital, dir: "up" },
  wind: { pos: ANCHORS.wind, dir: "left" },
};
const ANCHOR_LIST = Object.keys(CALLOUT_AT) as Anchor[];

/** Fixed anchor slots: 0 gas badge · 1..4 coal/nuclear/wind/solar badges · 5 gauge · 6.. callouts */
export function labelPoints(world: World): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  pts.push(new THREE.Vector3(GAS_PLANTS[1][0] - 0.2, terrainH(GAS_PLANTS[1][0], GAS_PLANTS[1][1]) + 1.95, GAS_PLANTS[1][1] - 0.2));
  for (let i = 3; i < PLANT_SLOTS.length; i++) {
    const b = world.bars[i];
    pts.push(new THREE.Vector3(b.x, b.y + BAR_H + 0.12, b.z));
  }
  pts.push(new THREE.Vector3(...ANCHORS.gauge));
  for (const a of ANCHOR_LIST) pts.push(new THREE.Vector3(...CALLOUT_AT[a].pos));
  return pts;
}

// ------------------------------------------------------------------ projector (inside <Canvas>)
const _v = new THREE.Vector3();

export function LabelProjector({ layer, points }: { layer: RefObject<HTMLDivElement | null>; points: THREE.Vector3[] }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const last = useRef<Float32Array>(new Float32Array(points.length * 2).fill(-1e6));
  useFrame(() => {
    const el = layer.current;
    if (!el) return;
    const kids = el.children;
    const n = Math.min(kids.length, points.length);
    for (let i = 0; i < n; i++) {
      _v.copy(points[i]).project(camera);
      const k = kids[i] as HTMLElement;
      if (_v.z > 1) {
        k.style.visibility = "hidden";
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * size.width;
      const y = (-_v.y * 0.5 + 0.5) * size.height;
      const L = last.current;
      if (Math.abs(L[i * 2] - x) < 0.25 && Math.abs(L[i * 2 + 1] - y) < 0.25) continue;
      L[i * 2] = x;
      L[i * 2 + 1] = y;
      k.style.visibility = "";
      k.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  });
  return null;
}

// ------------------------------------------------------------------ DOM layer (outside <Canvas>)
function CalloutBox({ c, dir }: { c: Callout | undefined; dir: Dir }) {
  if (!c) return null;
  return (
    <div key={c.id} className={`g3-callout g3-dir-${dir} g3-tone-${c.tone}${c.id === "collapse" ? " g3-callout-big" : ""}`}>
      <span className="g3-callout-icon">{c.icon}</span>
      <span className="g3-callout-text">
        <b>{c.text}</b>
        {c.sub && <small>{c.sub}</small>}
      </span>
    </div>
  );
}

export function LabelLayer({ store, layer }: { store: Store<LabelState>; layer: RefObject<HTMLDivElement | null> }) {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const show = s.show;
  const gasTone = s.gasPct >= 90 ? "ok" : s.gasPct >= 60 ? "warn" : "bad";
  return (
    <div className="g3-labels" ref={layer} style={{ display: show ? undefined : "none" }}>
      {/* slot 0: the three gas plants share one badge */}
      <div className="g3-anchor">
        <div className="g3-badge g3-badge-gas">
          <span className="g3-badge-name">Gas plants</span>
          {[0, 1, 2].map((k) => {
            const b = PLANT_BADGE[s.badges[k] ?? "ok"];
            return (
              <span key={k} className={`g3-badge-state g3-pill-${b.tone}`}>
                {b.text}
              </span>
            );
          })}
        </div>
      </div>
      {/* slots 1..4 */}
      {PLANT_SLOTS.slice(3).map((slot, j) => {
        const badge = PLANT_BADGE[s.badges[j + 3] ?? "ok"];
        return (
          <div key={slot.id} className="g3-anchor">
            <div className={`g3-badge g3-tone-${badge.tone}`}>
              <span className="g3-badge-name">{slot.name}</span>
              <span className={`g3-badge-state g3-pill-${badge.tone}`}>{badge.text}</span>
            </div>
          </div>
        );
      })}
      {/* slot 5 */}
      <div className="g3-anchor">
        <div className={`g3-gauge g3-gauge-${gasTone}`}>
          <div className="g3-gauge-top">
            <span>GAS SUPPLY</span>
            <b>{s.gasPct}%</b>
          </div>
          <div className="g3-gauge-bar">
            <i style={{ width: `${s.gasPct}%` }} />
          </div>
        </div>
      </div>
      {/* slots 6.. */}
      {ANCHOR_LIST.map((a) => (
        <div key={a} className="g3-anchor">
          <CalloutBox c={s.callouts.find((c) => c.anchor === a)} dir={CALLOUT_AT[a].dir} />
        </div>
      ))}
    </div>
  );
}
