// Evolution timeline: one column per day. Notebook lineage (v1 → v2 → …) with tonight's ideas
// (✓ kept, ✕ rejected side branches), the unseen-storm ✓/✗ per day, homes in the dark
// (median + min–max over the 3 versions) and the coach's prediction error per night.
import { dayColumns, revealEdit, scoreboard, type DayColumn, type ScoreRow } from "./derive";
import { fmtBig, fmtPct, isKept, reasonTag } from "./plain";
import { useCursor, useMission, useTrack } from "./store";
import { DarkBar, Empty, StormCells } from "./ui";

function ScoreCell({ r, scale, day1 }: { r?: ScoreRow | null; scale: number; day1?: ScoreRow }) {
  if (!r) return <div className="mc-tl-cell mc-dim">not scored yet</div>;
  const d = day1 && day1.key !== r.key && day1.hh && r.hh != null ? ((r.hh - day1.hh) / day1.hh) * 100 : null;
  return (
    <>
      <div className="mc-tl-cell mc-tl-score">
        <StormCells cells={r.cells} size="s" />
        <span className="mc-tl-x">
          <b>{r.passed}</b>/{r.total}
        </span>
        {r.provisional && <span className="mc-tag">{r.seeds} of 3 versions</span>}
      </div>
      <div className="mc-tl-cell mc-tl-dark">
        <DarkBar value={r.hh} min={r.hhMin} max={r.hhMax} scale={scale} tone={r.kind === "baseline" ? "base" : "dark"} />
        {d != null && <span className={`mc-tl-delta ${d < 0 ? "mc-good" : "mc-bad"}`}>{fmtPct(d)} vs Day 1</span>}
      </div>
    </>
  );
}

function NightCell({ c, revealUpTo }: { c: DayColumn; revealUpTo: (e: DayColumn["kept"][number]) => { visible: boolean; decided: boolean } }) {
  const t = useTrack();
  const open = useMission((s) => s.openInspect);
  if (!t) return null;
  const ideas = [...c.kept, ...c.rejected].map((e) => ({ e, r: revealUpTo(e) })).filter((x) => x.r.visible);
  if (!ideas.length) return <div className="mc-tl-cell mc-tl-ideas mc-dim">{c.kept.length + c.rejected.length ? "…" : "no ideas logged"}</div>;
  return (
    <div className="mc-tl-cell mc-tl-ideas">
      {ideas.map(({ e, r }, i) => {
        const kept = isKept(e);
        const cls = !r.decided ? "mc-idea-chip-testing" : kept ? "mc-idea-chip-kept" : "mc-idea-chip-rejected";
        return (
          <button key={i} className={`mc-idea-chip ${cls}`} onClick={() => open({ kind: "edit", track: t.key, edit: e })} title={e.title}>
            <span className="mc-idea-chip-mark">{!r.decided ? "🧪" : kept ? "✓" : "✕"}</span>
            <span className="mc-idea-chip-text">{e.lesson || e.title}</span>
            {r.decided && !kept && <span className="mc-idea-chip-why">{reasonTag(e)}</span>}
            {r.decided && kept && <span className="mc-idea-chip-why mc-good">{fmtPct(e.actual_pct)} dark</span>}
          </button>
        );
      })}
    </div>
  );
}

export function EvolutionTimeline() {
  const m = useMission((s) => s.mission);
  const t = useTrack();
  const cur = useCursor();
  const open = useMission((s) => s.openInspect);
  const goGen = useMission((s) => s.goGen);
  if (!m || !t) return null;
  const cols = dayColumns(m, t);
  if (!cols.length) return <Empty>No days in the data for Track {t.key} yet.</Empty>;
  const sb = scoreboard(m, t);
  const all = [...sb.rows, ...(sb.baseline ? [sb.baseline] : [])];
  const scale = Math.max(1, ...all.map((r) => r.hhMax ?? r.hh ?? 0));
  const day1 = sb.rows[0];
  const maxMae = Math.max(1, ...cols.map((c) => c.metric?.mae_pct ?? 0));
  return (
    <div className="mc-tl" style={{ gridTemplateColumns: `9.5em 12em repeat(${cols.length}, minmax(13em, 1fr))` }}>
      {/* header row */}
      <div className="mc-tl-h" />
      <div className="mc-tl-h mc-tl-base">
        <div className="mc-tl-day">Reference</div>
        <div className="mc-tl-ver mc-dim">Claude's own best guess</div>
      </div>
      {cols.map((c, i) => {
        const future = c.gen > cur.gen;
        return (
          <div key={c.gen} className={`mc-tl-h ${c.gen === cur.gen ? "mc-tl-now" : ""} ${future ? "mc-tl-future" : ""}`}>
            <button className="mc-tl-day" onClick={() => goGen(c.gen)}>
              Day {c.gen}
            </button>
            <button className="mc-tl-ver" onClick={() => c.notebookId && open({ kind: "notebook", track: t.key, id: c.notebookId })}>
              {i > 0 && <span className="mc-tl-arrow">→</span>} notebook <b>{c.version}</b>
            </button>
          </div>
        );
      })}

      <div className="mc-tl-label">
        Unseen storms
        <span>✓ = 2 of 3 versions survived</span>
      </div>
      <div className="mc-tl-base-col mc-tl-span2">{sb.baseline ? <ScoreCell r={sb.baseline} scale={scale} /> : <div className="mc-tl-cell mc-dim">not in the data</div>}</div>
      {cols.map((c) => (
        <div key={c.gen} className={`mc-tl-span2 ${c.gen > cur.gen ? "mc-tl-future" : ""}`}>
          <ScoreCell r={c.row} scale={scale} day1={day1} />
        </div>
      ))}

      <div className="mc-tl-label">
        That night
        <span>✓ kept · ✕ rejected (side branch)</span>
      </div>
      <div className="mc-tl-cell mc-dim mc-tl-base-col">no learning</div>
      {cols.map((c) => (
        <div key={c.gen} className={c.gen > cur.gen ? "mc-tl-future" : ""}>
          <NightCell c={c} revealUpTo={(e) => revealEdit(t, e, cur)} />
        </div>
      ))}

      <div className="mc-tl-label">
        Coach prediction error
        <span>how far its guesses were off · trend, few data points</span>
      </div>
      <div className="mc-tl-cell mc-dim mc-tl-base-col">–</div>
      {cols.map((c) => {
        const mae = c.metric?.mae_pct;
        const visible = c.gen <= cur.gen;
        return (
          <div key={c.gen} className={`mc-tl-cell mc-tl-mae ${visible ? "" : "mc-tl-future"}`}>
            {mae != null ? (
              <>
                <div className="mc-mae-bar">
                  <div style={{ width: `${(mae / maxMae) * 100}%` }} />
                </div>
                <span className="mc-mae-v">±{mae.toFixed(0)}%</span>
                {c.metric?.night0 && <span className="mc-tag">night 0</span>}
              </>
            ) : (
              <span className="mc-dim">–</span>
            )}
            {c.deepSleep && <span className="mc-tag mc-tag-violet">🌌 self-review</span>}
            {c.l2.map((x, j) => (
              <span key={j} className={`mc-tag ${x.adopted ? "mc-tag-green" : "mc-tag-red"}`}>
                {x.adopted ? "⚖️ rewrite adopted" : "↩ rewrite reverted"}
              </span>
            ))}
          </div>
        );
      })}
      <div className="mc-tl-foot">
        Homes in the dark = total home-hours without power across the unseen storms (bar = median of 3 versions, line = lowest–highest). Scale: {fmtBig(scale)}.
      </div>
    </div>
  );
}
