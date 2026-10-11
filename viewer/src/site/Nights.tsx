// Night by night: every learning night of a track, including the nights where the gate kept nothing.
import { useMemo, useState } from "react";
import { isKept } from "../mission/plain";
import type { Edit } from "../mission/types";
import { Ticks } from "./charts";
import { fmtSignedPct, nightLabel, organShort, useSite, type TrackX } from "./data";
import { RecordButton } from "./Records";

export const REASON: Record<string, { label: string; gaming?: boolean }> = {
  gaming_calmday: { label: "Gaming: dark on a calm day", gaming: true },
  gaming_passline: { label: "Gaming: the pass line", gaming: true },
  memorization: { label: "Memorized storm timing", gaming: true },
  insufficient: { label: "Did not help enough" },
  regression: { label: "Made a storm worse" },
  duplicate: { label: "Duplicate" },
  invalid: { label: "Invalid edit" },
  redundant: { label: "Redundant" },
};
export const reasonOf = (e: Edit) => REASON[e.reason_kind ?? ""] ?? { label: e.status === "inconclusive" ? "Inconclusive" : (e.reason_kind ?? "Rejected") };

type Filter = "all" | "gaming" | "insufficient" | "other";

const matches = (e: Edit, f: Filter) =>
  f === "all" ? true : isKept(e) ? false : f === "gaming" ? !!reasonOf(e).gaming : f === "insufficient" ? e.reason_kind === "insufficient" : !reasonOf(e).gaming && e.reason_kind !== "insufficient";

function firstSentence(s: string): string {
  const m = /^(.{40,260}?[.!?])\s/.exec(s);
  return m ? m[1] : s.length > 260 ? s.slice(0, 257) + "…" : s;
}

function IdeaRow({ t, e }: { t: TrackX; e: Edit }) {
  const kept = isKept(e);
  const r = reasonOf(e);
  const v = kept ? t.versions.find((x) => x.id === (e.child_id ?? e.stacked_id)) : undefined;
  return (
    <div className={`s-nrow ${kept ? "kept" : r.gaming ? "gaming" : ""}`}>
      <div className="s-nrow-st">
        {kept ? <span className="s-tag s-tag-added">kept{v ? ` → ${v.label}` : ""}</span> : <span className={`s-tag ${r.gaming ? "s-tag-removed" : ""}`}>{r.label}</span>}
        {e.redteam && <span className="s-tag s-tag-rt">red team</span>}
      </div>
      <div className="s-nrow-t">
        <div>
          {e.title} <span className="s-dim">· {organShort(e.organ)}</span>
        </div>
        {!kept && e.reason && <div className="s-why">{e.reason}</div>}
      </div>
      <div className="s-nrow-p num">
        <span className="s-dim">{fmtSignedPct(e.predicted_pct)}</span>
        <span className="s-dim"> → </span>
        <b className={(e.actual_pct ?? 0) > 0 ? "s-bad-t" : (e.actual_pct ?? 0) < 0 ? "s-acc-t" : ""}>{fmtSignedPct(e.actual_pct, 1)}</b>
      </div>
      <div className="s-nrow-k">
        <Ticks ticks={e.ticks} size="sm" /> <RecordButton of={e} title={`Idea: ${e.title}`} />
      </div>
    </div>
  );
}

export function NightByNight({ t }: { t: TrackX }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const focus = useSite((s) => s.focusEdit);
  const gens = useMemo(() => {
    const g = new Set<number>([...t.base.edits.map((e) => e.generation), ...Object.keys(t.base.nights).map(Number)]);
    return [...g].filter((x) => x >= 1).sort((a, b) => a - b);
  }, [t]);
  const lastEditGen = Math.max(0, ...t.base.edits.map((e) => e.generation));
  const rejected = t.base.edits.filter((e) => !isKept(e));
  const gamingN = rejected.filter((e) => reasonOf(e).gaming).length;
  const insuffN = rejected.filter((e) => e.reason_kind === "insufficient").length;
  const nightsWithKeeper = gens.filter((g) => t.base.edits.some((e) => e.generation === g && isKept(e))).length;
  const learnedGens = gens.filter((g) => g <= lastEditGen);
  const cutOff = gens.filter((g) => g > lastEditGen);

  return (
    <div className="s-nights">
      <div className="s-rej-h">
        <h3 className="s-h3">Night by night</h3>
        <div className="s-seg" role="group" aria-label="Filter ideas">
          {(
            [
              ["all", "Every night"],
              ["gaming", `Gaming ${gamingN}`],
              ["insufficient", `Not enough ${insuffN}`],
              ["other", `Other ${rejected.length - gamingN - insuffN}`],
            ] as [Filter, string][]
          ).map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <p className="s-small s-dim s-nights-sum">
        Track {t.key}: Night 0 + {Math.max(0, learnedGens.length - 1)} learning nights. An idea passed the gate on {nightsWithKeeper} of {learnedGens.length} nights; on{" "}
        {learnedGens.length - nightsWithKeeper} nights it kept nothing and the notebook stayed the same.
        {cutOff.length ? ` ${cutOff.map(nightLabel).join(", ")} was cut off by the deadline before any idea was tested.` : ""}
      </p>
      <div className="s-nstrip" aria-hidden>
        {gens.map((g) => {
          const k = t.base.edits.some((e) => e.generation === g && isKept(e));
          return (
            <a key={g} href={`#night-${t.key}-${g}`} className={`s-nstrip-c ${g > lastEditGen ? "cut" : k ? "kept" : ""}`} title={`${nightLabel(g)}: ${g > lastEditGen ? "cut off" : k ? "idea kept" : "nothing kept"}`}>
              {g - 1}
            </a>
          );
        })}
      </div>

      <ol className="s-nlist">
        {gens.map((g) => {
          const ideas = t.base.edits.filter((e) => e.generation === g);
          const shown = ideas.filter((e) => matches(e, filter));
          if (filter !== "all" && !shown.length) return null;
          const keptHere = ideas.filter(isKept);
          const steps = t.base.nights[g] ?? [];
          const diag = steps.find((s) => s.type === "diagnosis")?.text;
          const l2 = t.base.l2.find((x) => x.generation === g);
          const cut = g > lastEditGen;
          return (
            <li key={g} id={`night-${t.key}-${g}`} className={`s-night ${focus && keptHere.some((e) => e.child_id === focus) ? "s-flash" : ""}`}>
              <div className="s-night-l">
                <div className="s-night-n">{nightLabel(g)}</div>
                <div className={`s-night-o ${keptHere.length ? "kept" : cut ? "cut" : ""}`}>
                  {keptHere.length ? `${keptHere.length} kept` : cut ? "Cut off by the deadline" : "Nothing kept"}
                </div>
                {g === 1 && <div className="s-night-sub">the coach's zero-shot manual, written before any failure</div>}
              </div>
              <div className="s-night-r">
                {cut && !ideas.length ? (
                  <div className="s-empty">The coach logged its diagnosis, but no idea was tested before the notebooks were frozen.</div>
                ) : (
                  shown.map((e, i) => <IdeaRow key={i} t={t} e={e} />)
                )}
                {l2 && filter === "all" && (
                  <div className="s-night-l2">
                    Coach self-review after this night: rewrite <b className={l2.adopted ? "s-acc-t" : "s-bad-t"}>{l2.adopted ? "adopted" : "reverted"}</b>
                    {l2.ab ? ` (prediction error ${l2.ab.old_mae ?? "–"} → ${l2.ab.new_mae ?? "–"} pts on a replay of this night)` : ""}{" "}
                    <RecordButton of={l2} title={`Coaching-strategy rewrite after ${nightLabel(g)}`} />
                  </div>
                )}
                {diag && filter === "all" && (
                  <div className="s-night-diag">
                    <button className="s-link" onClick={() => setOpen({ ...open, [g]: !open[g] })} aria-expanded={!!open[g]}>
                      {open[g] ? "Hide the coach's diagnosis" : "Coach's diagnosis"}
                    </button>{" "}
                    <RecordButton of={steps.find((s) => s.type === "diagnosis")} title={`Night event: coach's diagnosis, ${nightLabel(g)}`} />
                    {open[g] ? <p>{diag}</p> : <p className="s-dim">{firstSentence(diag)}</p>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
