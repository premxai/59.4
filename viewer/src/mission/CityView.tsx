// The city slot of the Overview, behind a switch:
//   "grid"      the live 3D grid city from src/grid3d (built separately; used by default once it exists)
//   "cinematic" the Blender light-layer compositor (MissionCity)
// src/grid3d is optional and discovered with import.meta.glob, so this file builds with or without
// it. Used exports: GridCity({frame, label, quality}) from index.ts(x) / GridCity.tsx, and from
// adapters.ts: gridFramesFromReplay + sampleGridFrames (recorded/finished replays) and
// newLiveCtx + frameFromLive (live SSE hour messages, one ctx per side, converted in order).
import { Component, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useClock } from "../lib/clock";
import { useQuality } from "../lib/quality";
import type { Replay } from "../lib/replay";
import { MissionCity, type CityMode } from "./MissionCity";

interface GridModule {
  GridCity?: ComponentType<Record<string, unknown>>;
  gridFramesFromReplay?: (r: Replay) => unknown[];
  sampleGridFrames?: (frames: unknown[], hour: number) => unknown;
  frameFromLive?: (msg: unknown, ctx?: unknown) => unknown;
  newLiveCtx?: () => unknown;
}

const components = import.meta.glob<GridModule>(["../grid3d/index.ts", "../grid3d/index.tsx", "../grid3d/GridCity.tsx"]);
const adapters = import.meta.glob<GridModule>(["../grid3d/adapters.ts"]);
export const HAS_GRID3D = Object.keys(components).length > 0;

let gridPromise: Promise<GridModule | null> | null = null;
function loadGrid(): Promise<GridModule | null> {
  if (!gridPromise)
    gridPromise = Promise.all([...Object.values(components), ...Object.values(adapters)].map((f) => f().catch(() => ({}) as GridModule)))
      .then((mods) => {
        const merged: GridModule = Object.assign({}, ...mods);
        return merged.GridCity ? merged : null;
      })
      .catch((e) => {
        console.warn("[mission] src/grid3d failed to load", e);
        return null;
      });
  return gridPromise;
}

function useGridModule(): GridModule | null {
  const [mod, setMod] = useState<GridModule | null>(null);
  useEffect(() => {
    if (!HAS_GRID3D) return;
    let alive = true;
    loadGrid().then((m) => alive && setMod(m));
    return () => {
      alive = false;
    };
  }, []);
  return mod;
}

export type CityEngine = "grid" | "cinematic";

class GridBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[mission] 3D grid city crashed, showing the cinematic city", e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Grid frames for one side: converted from the live messages in order, or from the full replay. */
function useGridFrames(mod: GridModule, replay: Replay, raw?: Record<string, unknown>[]): unknown[] {
  const live = useRef<{ key: unknown; ctx: unknown; frames: unknown[] }>({ key: null, ctx: null, frames: [] });
  const n = raw?.length ?? 0;
  const fromReplay = useMemo(() => (!raw && mod.gridFramesFromReplay ? mod.gridFramesFromReplay(replay) : null), [mod, replay, raw, replay.frames.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (fromReplay) return fromReplay;
  if (!raw || !mod.frameFromLive) return [];
  const st = live.current;
  if (st.key !== raw) {
    st.key = raw;
    st.ctx = mod.newLiveCtx?.();
    st.frames = [];
  }
  for (let h = st.frames.length; h < n; h++) {
    const m = raw[h] ?? raw[h - 1];
    if (m) st.frames.push(mod.frameFromLive(m, st.ctx));
  }
  return st.frames;
}

function GridPane({ mod, replay, raw, label }: { mod: GridModule; replay: Replay; raw?: Record<string, unknown>[]; label: string }) {
  const hour = useClock((s) => Math.round(s.hour * 4) / 4);
  const tier = useQuality((s) => s.tier);
  const frames = useGridFrames(mod, replay, raw);
  const frame = frames.length ? (mod.sampleGridFrames ? mod.sampleGridFrames(frames, hour) : frames[Math.min(frames.length - 1, Math.floor(hour))]) : null;
  const Grid = mod.GridCity!;
  return (
    <div className="mc-grid-pane">
      {frame != null && <Grid frame={frame} label={label} quality={tier} />}
      {frame == null && <div className="mc-grid-label">{label}</div>}
    </div>
  );
}

export interface CityViewProps {
  engine: CityEngine;
  left: Replay;
  right: Replay;
  leftRaw?: Record<string, unknown>[];
  rightRaw?: Record<string, unknown>[];
  mode: CityMode;
  idle: boolean;
  loop: boolean;
  winterLeft: number;
  winterRight: number;
}

export function CityView(p: CityViewProps) {
  const mod = useGridModule();
  const cinematic = <MissionCity left={p.left} right={p.right} mode={p.mode} idle={p.idle} loop={p.loop} winterLeft={p.winterLeft} winterRight={p.winterRight} />;
  if (p.engine !== "grid" || !mod?.GridCity) return cinematic;
  const panes = p.mode === "split" ? (["left", "right"] as const) : p.mode === "left" ? (["left"] as const) : (["right"] as const);
  return (
    <GridBoundary fallback={cinematic}>
      <div className={`mc-grid ${panes.length === 2 ? "mc-grid-split" : ""} ${p.idle ? "mc-idle" : ""}`}>
        {panes.map((side) => (
          <GridPane key={side} mod={mod} replay={side === "left" ? p.left : p.right} raw={side === "left" ? p.leftRaw : p.rightRaw} label={(side === "left" ? p.left : p.right).meta.label} />
        ))}
      </div>
    </GridBoundary>
  );
}
