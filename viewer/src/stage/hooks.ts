// Memoised per-run derivations shared by the panels (phases, markers, verdict).
import { useMemo } from "react";
import { markersOf, phasesOf, segmentsOf, verdictOf, type Marker, type Phase, type Segment, type Verdict } from "./derive";
import { useStage } from "./store";

export interface Derived {
  phases: Phase[];
  segments: Segment[];
  markers: Marker[];
}

export function useDerived(): Derived {
  const frames = useStage((s) => s.right.frames);
  const steps = useStage((s) => s.right.steps);
  const n = steps.length;
  return useMemo(() => {
    const markers = markersOf(steps);
    const phases = phasesOf(frames, markers);
    return { phases, segments: segmentsOf(phases), markers };
    // steps is mutated in place while streaming: its length is the change signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, n]);
}

export function usePhaseNow(): Phase | null {
  const { phases } = useDerived();
  const h = useStage((s) => Math.floor(s.hour));
  const idle = useStage((s) => s.status === "idle" || s.intro != null);
  if (idle || !phases.length) return null;
  return phases[Math.min(phases.length - 1, h)] ?? null;
}

export function useVerdict(): Verdict | null {
  const ended = useStage((s) => s.ended);
  const right = useStage((s) => s.right);
  const left = useStage((s) => s.left);
  const simHash = useStage((s) => s.simHash);
  return useMemo(() => {
    if (!ended || !right.frames.length) return null;
    const lt = left.replay?.meta.totals as { peak_homes_dark?: number } | undefined;
    const op = right.replay?.meta.model?.operator ?? "Qwen3-30B";
    return verdictOf({
      right: right.frames,
      left: left.frames,
      rightRes: right.result,
      leftRes: left.result,
      leftPeakHomes: lt?.peak_homes_dark ?? null,
      simHash,
      model: op.replace(/^.*\//, "").replace(/-A\d+B.*$/i, "").replace(/-Instruct.*$/i, ""),
    });
  }, [ended, right, left, simHash]);
}
