import { Suspense, use, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { useClock } from "../lib/clock";
import { loadGeo } from "../lib/geo";
import { TIERS, armQualityMonitor, useQuality, useTierSettings } from "../lib/quality";
import { fleetFor, loadCities, loadPlants } from "../lib/plants";
import type { Replay } from "../lib/replay";
import { CameraRig, CityGlows, FreqRing, Snow } from "./Atmos";
import { Gulf, Outlines, Sky } from "./Environment";
import { Plants } from "./Plants";
import { Terrain } from "./Terrain";
import { BG_COLOR, FOG_COLOR, FOG_DENSITY } from "./palette";
import { WorldCtx, createWorldState, updateWorldState, type WorldState } from "./worldState";

function StateUpdater({ world }: { world: WorldState }) {
  useEffect(() => armQualityMonitor(), []);
  useFrame((_, dt) => {
    updateWorldState(world, useClock.getState().hour, performance.now() / 1000, dt);
    if (import.meta.env.DEV) (window as unknown as { __world: WorldState }).__world = world;
  }, -1);
  return null;
}

const FOCUS_PARAM = (() => {
  const f = new URLSearchParams(location.search).get("focus");
  const v = f?.split(",").map(Number);
  return v && v.length >= 2 && v.every(Number.isFinite) ? ([v[0], v[1], v[2] ?? 12] as [number, number, number]) : null;
})();

function Scene({ replay, orbit }: { replay: Replay; orbit: "sway" | "full" | "off" }) {
  const geo = use(loadGeo());
  const plants = use(loadPlants());
  const cities = use(loadCities());
  const world = useMemo(() => createWorldState(replay), [replay]);
  const fleet = useMemo(() => fleetFor(plants, replay.meta), [plants, replay]);
  const q = useTierSettings();
  return (
    <WorldCtx.Provider value={world}>
      <StateUpdater world={world} />
      <color attach="background" args={[BG_COLOR]} />
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />
      <hemisphereLight args={[new THREE.Color("#5b6fa8"), new THREE.Color("#0a0d18"), 1.1]} />
      <directionalLight position={[-60, 90, 40]} intensity={0.9} color="#9fb4ff" />
      <Sky />
      <Terrain geo={geo} stride={q.terrainStride} cheap={q.cheapShader} />
      <Gulf />
      <Outlines geo={geo} />
      <CityGlows geo={geo} cities={cities} />
      <Plants geo={geo} fleet={fleet} q={q} />
      {q.snow > 0 && <Snow count={q.snow} />}
      <FreqRing />
      <CameraRig orbit={orbit} focus={FOCUS_PARAM} />
    </WorldCtx.Provider>
  );
}

function Post() {
  const q = useTierSettings();
  if (q.bloom === "none") return null; // renderer tone maps directly (see Canvas gl.toneMapping)
  return (
    <EffectComposer key={q.bloom + q.msaa} multisampling={q.msaa}>
      <Bloom mipmapBlur levels={q.bloom === "full" ? 8 : 5} intensity={1.15} luminanceThreshold={0.9} luminanceSmoothing={0.25} radius={0.72} />
      <Vignette offset={0.28} darkness={0.62} />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}

export function WorldCanvas({ replay, orbit = "sway" }: { replay: Replay; orbit?: "sway" | "full" | "off" }) {
  const tier = useQuality((s) => s.tier);
  const q = TIERS[tier];
  return (
    <Canvas
      flat
      dpr={q.dpr}
      gl={{
        antialias: false,
        powerPreference: "high-performance",
        // With the composer, tone mapping happens in its AgX pass; without it (low tier) the renderer does it.
        toneMapping: q.bloom === "none" ? THREE.AgXToneMapping : THREE.NoToneMapping,
      }}
      camera={{ fov: 38, near: 0.5, far: 3000, position: [0, 90, 110] }}
    >
      <Suspense fallback={null}>
        <Scene replay={replay} orbit={orbit} />
        <Post />
      </Suspense>
    </Canvas>
  );
}
