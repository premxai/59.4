// The notebook drawn as organ clusters. Each kept/stacked idea is a solid node on its organ
// ("Night n · lesson"); rejected ideas appear, then dissolve into faint ghosts with a reason tag.
// Nodes appear in sync with the night playback / day scrubbing.
import { notebookNow, revealEdit } from "./derive";
import { ORGANS, isKept, nightNumber, organSummary, reasonTag } from "./plain";
import { useCursor, useMission, useTrack } from "./store";
import { Empty } from "./ui";

export function ManualMap() {
  const t = useTrack();
  const cur = useCursor();
  const open = useMission((s) => s.openInspect);
  if (!t) return null;
  const nb = notebookNow(t, cur);
  const hasBuild = t.key === "B" || t.edits.some((e) => e.organ === "build");
  const organs = ORGANS.filter((o) => o.key !== "build" || hasBuild);
  const extra = [...new Set(t.edits.map((e) => e.organ))].filter((k) => !ORGANS.some((o) => o.key === k));
  if (!t.edits.length) return <Empty>No ideas yet: the coach's first night has not been logged.</Empty>;
  return (
    <div className="mc-map">
      {[...organs, ...extra.map((k) => ({ key: k, label: k, icon: "📄", color: "#9fb0d8", blurb: "" }))].map((o) => {
        const nodes = t.edits.filter((e) => e.organ === o.key).map((e) => ({ e, r: revealEdit(t, e, cur) }));
        const shown = nodes.filter((n) => n.r.visible);
        const keptN = shown.filter((n) => n.r.decided && isKept(n.e)).length;
        return (
          <div key={o.key} className="mc-cluster" style={{ ["--organ" as string]: o.color }}>
            <div className="mc-cluster-head">
              <span className="mc-cluster-icon">{o.icon}</span>
              <span className="mc-cluster-name">{o.label}</span>
              <span className="mc-cluster-count">{organSummary(o.key, nb.counts)}</span>
            </div>
            <div className="mc-cluster-blurb">
              {o.blurb}
              {keptN > 0 && <span className="mc-good"> · {keptN} idea{keptN > 1 ? "s" : ""} kept</span>}
            </div>
            <div className="mc-cluster-nodes">
              {shown.length === 0 && <span className="mc-dim mc-cluster-none">no ideas yet</span>}
              {shown.map(({ e, r }, i) => {
                const kept = isKept(e);
                const cls = !r.decided ? "mc-node-testing" : kept ? "mc-node-kept" : "mc-node-rejected";
                return (
                  <button key={`${e.generation}-${e.child_id ?? i}`} className={`mc-node ${cls}`} onClick={() => open({ kind: "edit", track: t.key, edit: e })} title={e.title}>
                    <span className="mc-node-dot" />
                    <span className="mc-node-text">
                      <span className="mc-node-night">Night {nightNumber(t, e.generation)}</span> · {e.lesson || e.title}
                    </span>
                    {r.decided && !kept && <span className={`mc-node-why ${e.redteam ? "mc-node-why-red" : ""}`}>{e.redteam ? `red-team test · ${reasonTag(e)}` : reasonTag(e)}</span>}
                    {!r.decided && <span className="mc-node-why mc-pulse">testing…</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
