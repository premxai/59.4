// OPERATOR GENOME: the frozen base model at the root, the notebook's real organs as branches with
// live counts, and the kept ideas (on that notebook's lineage path) as leaves. Shows the RIGHT
// notebook of the comparison; branches that grew versus the LEFT notebook light up with "+n".
import { keptPath, trackOfNotebook } from "./derive";
import { ORGANS, nightNumber, organSize, organSummary } from "./plain";
import { useMission } from "./store";
import type { Counts } from "./types";
import { MODEL_SHORT } from "./ui";

export interface GenomeProps {
  notebookId?: string;
  label?: string;
  counts?: Counts;
  compareCounts?: Counts;
  compareLabel?: string;
  track?: string;
}

export function Genome({ notebookId, label, counts, compareCounts, compareLabel, track }: GenomeProps) {
  const m = useMission((s) => s.mission);
  const open = useMission((s) => s.openInspect);
  const t = trackOfNotebook(m, notebookId);
  const trackKey = track ?? t?.key ?? "?";
  const c: Counts = counts ?? {};
  const kept = t && notebookId ? keptPath(t, notebookId) : [];
  const hasBuild = trackKey === "B" || (c.build_items ?? 0) > 1 || kept.some((e) => e.organ === "build");
  const organs = ORGANS.filter((o) => o.key !== "build" || hasBuild);
  const sizes = organs.map((o) => organSize(o.key, c));
  const max = Math.max(1, ...sizes, ...(compareCounts ? organs.map((o) => organSize(o.key, compareCounts)) : []));
  if (!counts) return <div className="mc-empty">Pick a notebook to see its organs.</div>;
  return (
    <div className="mc-genome">
      <button className="mc-genome-root" onClick={() => notebookId && t && open({ kind: "notebook", track: t.key, id: notebookId })} title="Open this notebook version">
        <span className="mc-genome-lock">🔒</span>
        <span>
          Base model · <b>{MODEL_SHORT}</b> · unchanged
        </span>
        {label && <span className="mc-genome-ver">{label}</span>}
      </button>
      <div className="mc-genome-branches">
        {organs.map((o, i) => {
          const size = sizes[i];
          const prev = compareCounts ? organSize(o.key, compareCounts) : size;
          const grew = size - prev;
          const leaves = kept.filter((e) => e.organ === o.key);
          return (
            <div key={o.key + ":" + (notebookId ?? "")} className={`mc-branch ${grew > 0 ? "mc-branch-lit" : ""}`} style={{ ["--organ" as string]: o.color }}>
              <div className="mc-branch-head">
                <span className="mc-branch-icon">{o.icon}</span>
                <span className="mc-branch-name">{o.label}</span>
                <span className="mc-branch-count">{organSummary(o.key, c)}</span>
                {grew !== 0 && compareCounts && (
                  <span className={`mc-grow ${grew < 0 ? "mc-grow-neg" : ""}`} title={`versus ${compareLabel ?? "the other notebook"}`}>
                    {grew > 0 ? "+" : ""}
                    {grew}
                  </span>
                )}
              </div>
              <div className="mc-branch-bar">
                {compareCounts && <div className="mc-branch-bar-prev" style={{ width: `${(prev / max) * 100}%` }} />}
                <div className="mc-branch-bar-now" style={{ width: `${(size / max) * 100}%` }} />
              </div>
              {leaves.length > 0 && t && (
                <div className="mc-leaves">
                  {leaves.map((e, j) => (
                    <button key={j} className="mc-leaf" onClick={() => open({ kind: "edit", track: t.key, edit: e })} title={e.title}>
                      <span className="mc-leaf-night">N{nightNumber(t, e.generation)}</span> {e.lesson || e.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!hasBuild && (
          <div className="mc-branch mc-branch-fixed">
            <div className="mc-branch-head">
              <span className="mc-branch-icon">🧰</span>
              <span className="mc-branch-name">Winter prep</span>
              <span className="mc-branch-count">fixed in Track {trackKey} (equipment can't change)</span>
            </div>
          </div>
        )}
      </div>
      {compareLabel && <div className="mc-genome-foot">faint bar = {compareLabel} · +n = grew since then</div>}
    </div>
  );
}
