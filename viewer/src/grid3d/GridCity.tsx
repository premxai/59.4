// <GridCity frame={GridFrame} label? quality? />: one self-contained 3D power-grid city.
// Light enough to mount twice side by side: instancing everywhere, no shadows, one bloom pass,
// DPR capped at 1.5, adaptive quality (drei PerformanceMonitor steps the tier down when fps drops).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { useQuality } from "../lib/quality";
import { createCity, disposeCity } from "./city";
import { getWorld } from "./geometry";
import { GridHud, GridHudMinimal } from "./Hud";
import { createStore, LabelLayer, LabelProjector, labelPoints, type LabelState } from "./Labels";
import { CalloutMemory, deriveCallouts, plantModel } from "./model";
import type { AreaKey } from "./areas";
import { FocusProjector, GridScene, type ViewInset } from "./Scene";
import type { GridFrame, GridLook, GridQuality } from "./types";
import "./grid3d.css";

export interface GridCityProps {
  /** Current (ideally interpolated) frame. null = still loading. */
  frame: GridFrame | null;
  /** Big title in the top-left corner, e.g. "Day 1 notebook". */
  label?: string;
  /** Small caps line under the label. */
  sublabel?: string;
  /** Fixed quality tier; omit for automatic (starts from a GPU guess, steps down when fps drops). */
  quality?: GridQuality;
  /** Show the DOM HUD (dial, homes dark, meters). Default true; "minimal" = label, small dial, one status line. */
  hud?: boolean | "minimal";
  /** Show 3D-anchored callouts, plant badges and the gas gauge. Default true. */
  labels?: boolean;
  /** Show the local time under the label (GridSplit shows one shared clock instead). Default false. */
  showTime?: boolean;
  /** Let the user orbit / zoom with the mouse. Default true. */
  orbit?: boolean;
  /** Gentle idle camera drift. Default true; false = a fixed camera. */
  drift?: boolean;
  /** Tiny fps readout in the corner. Default true. */
  showFps?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Called about twice a second with the measured fps. */
  onFps?: (fps: number, tier: GridQuality) => void;
  /** Visual style. Default "night" (Mission Control); "gridleaf" = daylight clay diorama with hills, lake, clouds. */
  look?: GridLook;
  /**
   * Stage mode: the focused area (camera glides there, a ring marks it); null = overview.
   * Leave undefined for the original fixed framing.
   */
  focus?: AreaKey | null;
  /** Click-to-focus: called with the area under a click (enables picking + hover rings). */
  onPick?: (area: AreaKey | null) => void;
  /** DOM content anchored above the focused area (e.g. its name). */
  focusLabel?: ReactNode;
  /** Screen area (px) covered by overlay panels; the camera frames the diorama inside the rest. */
  inset?: ViewInset;
}

interface TierCfg {
  dpr: number;
  bloom: boolean;
  levels: number;
  msaa: number;
  snow: number;
  plume: number;
}

const TIERS: Record<GridQuality, TierCfg> = {
  high: { dpr: 1.5, bloom: true, levels: 6, msaa: 2, snow: 2200, plume: 40 },
  medium: { dpr: 1, bloom: true, levels: 4, msaa: 0, snow: 1200, plume: 26 },
  low: { dpr: 0.8, bloom: false, levels: 0, msaa: 0, snow: 500, plume: 12 },
};
const ORDER: GridQuality[] = ["high", "medium", "low"];

/** URL overrides for tuning on the stage machine: ?msaa=0..8&dpr=0.5..2&bloom=0|1 */
function withOverrides(c: TierCfg): TierCfg {
  const q = new URLSearchParams(location.search);
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  const msaa = num("msaa");
  const dpr = num("dpr");
  const bloom = q.get("bloom");
  return {
    ...c,
    msaa: msaa ?? c.msaa,
    dpr: dpr != null ? Math.max(0.4, Math.min(2, dpr)) : c.dpr,
    bloom: bloom === "0" ? false : bloom === "1" ? true : c.bloom,
    levels: c.levels || 4,
  };
}

function guessTier(): GridQuality {
  const q = new URLSearchParams(location.search).get("quality");
  if (q === "high" || q === "medium" || q === "low") return q;
  const gpu = useQuality.getState().gpu;
  if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) return "low";
  if (/Intel|Iris|UHD|Mali|Adreno|PowerVR|Apple GPU/i.test(gpu) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return "medium";
  return "high";
}

function ToneMode({ bloom, look }: { bloom: boolean; look: GridLook }) {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const leaf = look === "gridleaf";
    gl.toneMapping = bloom ? THREE.NoToneMapping : leaf ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.setClearColor(leaf ? "#dfe8da" : "#03060f");
  }, [gl, bloom, look]);
  return null;
}

/**
 * Dev-only benchmark that works even when rAF is throttled (hidden pane): dispatch `g3-bench` on window,
 * then read document.body.dataset.g3bench = per-canvas ms per frame (full render incl. bloom + GPU sync).
 */
function DevBench() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const run = () => {
      const state = get();
      const gl = state.gl.getContext();
      const px = new Uint8Array(4);
      const N = 30;
      state.advance(performance.now());
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < N; i++) state.advance(performance.now());
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // one sync: throughput, not latency
      const ms = (performance.now() - t0) / N;
      const r = state.gl.info.render;
      const line = `${ms.toFixed(1)}ms ${state.gl.domElement.width}x${state.gl.domElement.height} calls=${r.calls} tris=${r.triangles}`;
      document.body.dataset.g3bench = (document.body.dataset.g3bench ? document.body.dataset.g3bench + " | " : "") + line;
    };
    window.addEventListener("g3-bench", run);
    return () => window.removeEventListener("g3-bench", run);
  }, [get]);
  return null;
}

function FpsMeter({
  el,
  tier,
  last,
  onFps,
}: {
  el: RefObject<HTMLDivElement | null>;
  tier: GridQuality;
  last: RefObject<number>;
  onFps?: (fps: number, tier: GridQuality) => void;
}) {
  const acc = useRef({ n: 0, t: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.n++;
    a.t += dt;
    if (a.t >= 0.5) {
      const fps = Math.round(a.n / a.t);
      a.n = 0;
      a.t = 0;
      last.current = fps;
      if (el.current) el.current.textContent = `${fps} fps · ${tier}`;
      onFps?.(fps, tier);
    }
  });
  return null;
}

export function GridCity({
  frame,
  label,
  sublabel,
  quality,
  hud = true,
  labels = true,
  showTime = false,
  orbit = true,
  drift = true,
  showFps = true,
  className,
  style,
  onFps,
  look = "night",
  focus,
  onPick,
  focusLabel,
  inset,
}: GridCityProps) {
  const world = getWorld(look);
  const city = useMemo(() => createCity(world, look), [world, look]);
  useEffect(() => () => disposeCity(city), [city]);
  city.vis.frame = frame;

  // ---- adaptive tier
  const [autoTier, setAutoTier] = useState<GridQuality>(() => guessTier());
  const tier = quality ?? autoTier;
  const cfg = useMemo(() => withOverrides(TIERS[tier]), [tier]);
  const fixed = quality != null || new URLSearchParams(location.search).has("quality");

  // ---- labels store (only re-renders the 3D labels when something visible changes)
  const store = useMemo(() => createStore<LabelState>({ badges: [], callouts: [], gasPct: 100, show: false }), []);
  const mem = useMemo(() => new CalloutMemory(), []);
  useEffect(() => {
    if (!frame) return;
    mem.update(frame);
    store.set({
      badges: plantModel(frame).map((p) => p.state),
      // with the HUD on, the collapse is the big centre banner, not a 3D callout
      callouts: deriveCallouts(frame, mem).filter((c) => !(hud && c.id === "collapse")),
      gasPct: Math.round(frame.gasSupply * 100),
      show: labels,
    });
  }, [frame, labels, mem, store, hud]);

  // ---- scale HUD type with the view width
  const rootRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const points = useMemo(() => labelPoints(world), [world]);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const s = Math.max(0.55, Math.min(1.25, Math.min(w / 900, h / 820)));
      el.style.setProperty("--s", s.toFixed(3));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onFpsRef = useRef(onFps);
  onFpsRef.current = onFps;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const focusElRef = useRef<HTMLDivElement>(null);
  const leaf = look === "gridleaf";
  const insetKey = inset ? `${inset.top}|${inset.right}|${inset.bottom}|${inset.left}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const insetMemo = useMemo(() => inset, [insetKey]);
  const pickable = !!onPick;
  // A hidden / background page throttles requestAnimationFrame to ~1 fps: that is not the GPU being slow,
  // so the adaptive tier ignores declines while the measured rate is that low.
  const lastFps = useRef(60);

  const canvas = useMemo(
    () => (
      <Canvas
        dpr={Math.min(cfg.dpr, window.devicePixelRatio || 1)}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false, alpha: false }}
        camera={{ fov: 28, near: 0.5, far: 300, position: [8, 24, 26] }}
        style={{ position: "absolute", inset: 0 }}
      >
        <ToneMode bloom={cfg.bloom} look={look} />
        <DevBench />
        {!fixed && (
          <PerformanceMonitor
            flipflops={2}
            onDecline={() => {
              if (lastFps.current < 6 || document.hidden) return;
              setAutoTier((t) => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(t) + 1)]);
            }}
          />
        )}
        <GridScene
          city={city}
          world={world}
          plumePer={cfg.plume}
          snowCount={cfg.snow}
          orbit={orbit}
          drift={drift}
          focus={focus}
          inset={insetMemo}
          onPick={pickable ? onPickRef : undefined}
        />
        <LabelProjector layer={layerRef} points={points} />
        {focus !== undefined && <FocusProjector focus={focus} el={focusElRef} />}
        {cfg.bloom && (
          <EffectComposer multisampling={cfg.msaa}>
            {leaf ? (
              <Bloom mipmapBlur levels={cfg.levels} intensity={0.7} luminanceThreshold={1.0} luminanceSmoothing={0.25} radius={0.6} />
            ) : (
              <Bloom mipmapBlur levels={cfg.levels} intensity={0.85} luminanceThreshold={0.82} luminanceSmoothing={0.22} radius={0.68} />
            )}
            <ToneMapping mode={leaf ? ToneMappingMode.NEUTRAL : ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
        {<FpsMeter el={fpsRef} tier={tier} last={lastFps} onFps={(f, t) => onFpsRef.current?.(f, t)} />}
      </Canvas>
    ),
    [cfg, city, world, orbit, drift, points, tier, showFps, fixed, look, leaf, focus, insetMemo, pickable],
  );

  return (
    <div ref={rootRef} className={`g3-city g3-look-${look}${className ? ` ${className}` : ""}`} style={style}>
      {canvas}
      <LabelLayer store={store} layer={layerRef} />
      {focus !== undefined && (
        <div className="g3-focus-layer">
          <div className="g3-focus-anchor" ref={focusElRef}>
            {focus && focusLabel}
          </div>
        </div>
      )}
      {hud === "minimal" && frame && <GridHudMinimal frame={frame} label={label} sublabel={sublabel} />}
      {hud === true && frame && <GridHud frame={frame} label={label} sublabel={sublabel} showTime={showTime} />}
      {!hud && label && (
        <div className="g3-hud">
          <div className="g3-hud-tl">
            <div className="g3-label">{label}</div>
          </div>
        </div>
      )}
      {showFps && <div className="g3-fps" ref={fpsRef} />}
    </div>
  );
}

export default GridCity;
