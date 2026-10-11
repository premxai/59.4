// CURRENT IDEA: the idea the night playback is on right now: proposed → testing ✓✗… → kept / rejected.
import { revealEdit, stepsOf } from "./derive";
import { darkPhrase, editForStep, isKept, nightNumber, organMeta, reasonTag, stageOf, storms } from "./plain";
import { useCursor, useMission, useTrack } from "./store";
import { Ticks } from "./ui";

const STAGE_IDLE: Record<string, string> = {
  day: "The AI is running today's storms with its notebook…",
  read: "The coach is reading why the storms failed…",
  review: "The coach is reviewing its own track record…",
  ab: "The coach is A/B testing its rewritten playbook…",
  adopt: "The coach decides whether to keep its own rewrite…",
  decide: "Tonight's verdicts are in.",
  ideas: "The coach is writing ideas…",
  test: "Testing ideas on storms…",
};

export function CurrentIdea() {
  const t = useTrack();
  const cur = useCursor();
  const open = useMission((s) => s.openInspect);
  if (!t) return null;
  const steps = stepsOf(t, cur.gen);
  let edit = undefined as ReturnType<typeof editForStep>;
  for (let i = Math.min(cur.step, steps.length - 1); i >= 0 && !edit; i--) edit = editForStep(t, steps[i], cur.gen);
  const stage = steps[cur.step] ? stageOf(steps[cur.step].type) : "day";
  const night = nightNumber(t, cur.gen);
  const ideas = t.edits.filter((e) => e.generation === cur.gen);
  if (!edit) {
    return (
      <div className="mc-idea mc-idea-idle">
        <div className="mc-idea-k">Current idea · Night {night}</div>
        <div className="mc-idea-idle-text">{steps.length ? STAGE_IDLE[stage] : "No night log for this day yet."}</div>
      </div>
    );
  }
  const r = revealEdit(t, edit, cur);
  const o = organMeta(edit.organ);
  const kept = isKept(edit);
  const k = ideas.indexOf(edit) + 1;
  return (
    <button className={`mc-idea ${r.decided ? (kept ? "mc-idea-kept" : "mc-idea-rejected") : "mc-idea-testing"}`} onClick={() => open({ kind: "edit", track: t.key, edit })} style={{ ["--organ" as string]: o.color }}>
      <div className="mc-idea-k">
        Current idea · Night {night}
        {k > 0 && ideas.length > 1 ? ` · ${k} of ${ideas.length}` : ""}
        {edit.redteam && <span className="mc-tag mc-tag-red">red-team test</span>}
      </div>
      <div className="mc-idea-title">
        <span className="mc-idea-plus">+</span> {edit.title}
      </div>
      <div className="mc-idea-meta">
        <span className="mc-chip" style={{ borderColor: o.color, color: o.color }}>
          {o.icon} {o.label}
        </span>
        <span>
          predicted <b>{darkPhrase(edit.predicted_pct)}</b>
          {edit.predicted ? ` · ${storms(edit.predicted)}` : ""}
        </span>
      </div>
      <div className="mc-idea-test">
        {r.tested ? (
          <>
            <span className="mc-dim">tested </span>
            <Ticks s={edit.ticks} stagger size="m" key={`${cur.gen}-${edit.child_id}`} />
          </>
        ) : (
          <span className="mc-pulse">testing on storms…</span>
        )}
      </div>
      {r.decided && (
        <div className={`mc-idea-outcome ${kept ? "mc-good" : "mc-bad"}`}>
          {kept ? `→ kept · ${darkPhrase(edit.actual_pct)}${edit.actual ? ` · ${storms(edit.actual)}` : ""}` : `→ rejected: ${reasonTag(edit)}`}
        </div>
      )}
    </button>
  );
}
