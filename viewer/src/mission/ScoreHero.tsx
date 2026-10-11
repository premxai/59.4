// The hero number on the Overview: unseen-storm passes Day 1 → the scrubbed day, and the drop in
// homes in the dark (which shows progress even while passes stay 0).
import { scoreboard, type ScoreRow } from "./derive";
import { fmtBig, fmtPct } from "./plain";
import { useMission, useTrack } from "./store";
import { SameModelBadge, StormCells } from "./ui";

function RowMini({ r, hi = false }: { r: ScoreRow; hi?: boolean }) {
  return (
    <div className={`mc-hero-row ${hi ? "mc-hero-row-hi" : ""}`}>
      <div className="mc-hero-day">
        {r.label} <span className="mc-dim">· {r.sub}</span>
      </div>
      <StormCells cells={r.cells} size="m" />
      <div className="mc-hero-score">
        <b>{r.passed}</b>/{r.total}
      </div>
      {r.provisional && <div className="mc-hero-prov">{r.seeds} of 3 versions so far</div>}
    </div>
  );
}

export function ScoreHero() {
  const m = useMission((s) => s.mission);
  const gen = useMission((s) => s.gen);
  const t = useTrack();
  if (!m || !t) return <div className="mc-hero" />;
  const sb = scoreboard(m, t);
  const rows = sb.rows;
  const first = rows[0];
  const now = [...rows].reverse().find((r) => (r.gen ?? 0) <= gen) ?? first;
  if (!first) {
    return (
      <div className="mc-hero">
        <div className="mc-hero-label">
          UNSEEN STORMS
          <span>never shown to the coach</span>
        </div>
        <div className="mc-empty">No unseen-storm results in the data yet.</div>
        <SameModelBadge big />
      </div>
    );
  }
  const delta = first.hh && now.hh != null ? ((now.hh - first.hh) / first.hh) * 100 : null;
  return (
    <div className="mc-hero">
      <div className="mc-hero-label">
        {sb.storms.length || first.total} UNSEEN STORMS
        <span>never shown to the coach · ✓ = survived (2 of 3 versions)</span>
      </div>
      <div className="mc-hero-rows">
        <RowMini r={first} />
        {now.key !== first.key && <RowMini r={now} hi />}
      </div>
      <div className="mc-hero-dark">
        <div className="mc-hero-dark-k">Homes in the dark</div>
        <div className="mc-hero-dark-v">
          {now.key === first.key ? (
            <>
              {fmtBig(first.hh)} <small>home-hours</small>
            </>
          ) : (
            <>
              <span className={delta != null && delta < 0 ? "mc-good" : "mc-bad"}>{fmtPct(delta)}</span>
              <small>
                {" "}
                {fmtBig(first.hh)} → {fmtBig(now.hh)} home-hours
              </small>
            </>
          )}
        </div>
        {sb.baseline && (
          <div className="mc-hero-base">
            Claude's own best guess, no learning: <b>{sb.baseline.passed}/{sb.baseline.total}</b> · {fmtBig(sb.baseline.hh)}
          </div>
        )}
      </div>
      <SameModelBadge big />
    </div>
  );
}
