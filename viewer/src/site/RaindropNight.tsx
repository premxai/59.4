// "Raindrop in the loop": one learning night whose evidence was read back out of Raindrop Workshop
// (data/raindrop_night.json, exported as raindrop_night). Shown only when that night has run.
import { useSite } from "./data";
import { Section, SectionHead } from "./ui";

interface Idea {
  title?: string;
  organ?: string;
  predicted_pct?: number | null;
  actual_pct?: number | null;
  status?: string;
  kind?: string | null;
  reason?: string | null;
  ticks?: string | null;
  vid?: string;
}
interface RaindropNightData {
  ran_at?: string;
  minutes?: number;
  notebook?: string;
  practice_passed?: number;
  practice_storms?: number;
  workshop?: { traced_decisions?: number; flagged?: number; flags_by_kind?: Record<string, number> };
  evidence?: string;
  diagnosis?: string;
  ideas?: Idea[];
  kept?: string[];
  champion_after?: string;
}

const KIND_LABEL: Record<string, string> = {
  false_all_clear: "said all clear while power was running out",
  homes_dark_with_spare_power: "kept homes dark with spare power",
};
const pct = (x?: number | null) => (x == null ? "–" : `${x > 0 ? "+" : ""}${Math.round(x)}%`);

export function RaindropNight() {
  const rd = useSite((s) => (s.data?.raindrop ?? null) as RaindropNightData | null);
  if (!rd || !rd.workshop) return null;
  const ws = rd.workshop;
  const ideas = rd.ideas ?? [];
  const kept = ideas.filter((i) => i.status === "accepted");
  return (
    <Section id="raindrop">
      <SectionHead id="raindrop" n="06b" kicker="Raindrop in the loop" title="One night where the coach learned from Raindrop's flags">
        Every decision the frozen AI made on the practice storms was traced in Raindrop Workshop, and two detectors flagged
        decisions there. The coach's evidence that night was read back out of Raindrop, and its ideas went through the
        same keep-or-reject test as every other night.
      </SectionHead>
      <div className="rd-flow">
        <div className="rd-step">
          <span className="rd-n">1</span>
          <b>{(ws.traced_decisions ?? 0).toLocaleString()}</b>
          <span>AI decisions traced in Raindrop Workshop ({rd.notebook}, {rd.practice_storms} practice storms × 2 seeds)</span>
        </div>
        <div className="rd-step">
          <span className="rd-n">2</span>
          <b>{(ws.flagged ?? 0).toLocaleString()}</b>
          <span>
            flagged as issues:{" "}
            {Object.entries(ws.flags_by_kind ?? {})
              .map(([k, n]) => `${n.toLocaleString()} ${KIND_LABEL[k] ?? k}`)
              .join(" · ") || "none"}
          </span>
        </div>
        <div className="rd-step">
          <span className="rd-n">3</span>
          <b>{ideas.length}</b>
          <span>ideas from the coach, read from that evidence, then tested</span>
        </div>
        <div className="rd-step">
          <span className="rd-n">4</span>
          <b className={kept.length ? "rd-ok" : ""}>{kept.length ? "kept" : "none kept"}</b>
          <span>{kept.length ? `${kept.map((k) => k.title).join(", ")}` : "every idea failed the same test as every other night"}</span>
        </div>
      </div>
      {rd.diagnosis && (
        <p className="rd-diag">
          <span className="s-dim">Coach's diagnosis · </span>
          {rd.diagnosis}
        </p>
      )}
      {ideas.length > 0 && (
        <table className="s-table rd-table">
          <thead>
            <tr>
              <th>Idea</th>
              <th>Part</th>
              <th>Predicted</th>
              <th>Measured</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {ideas.map((i) => (
              <tr key={i.vid ?? i.title}>
                <td>{i.title}</td>
                <td className="s-dim">{i.organ}</td>
                <td className="rd-num">{pct(i.predicted_pct)}</td>
                <td className="rd-num">{pct(i.actual_pct)}</td>
                <td>
                  <span className={i.status === "accepted" ? "rd-ok" : "rd-bad"}>{i.status === "accepted" ? "kept" : "rejected"}</span>
                  {i.reason && <small className="rd-reason">{i.reason}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rd.evidence && (
        <details className="rd-ev">
          <summary>What the coach read from Raindrop</summary>
          <pre className="s-raw">{rd.evidence}</pre>
        </details>
      )}
      <p className="s-note">
        Raindrop Workshop runs on this laptop (localhost:5899); traces are read back through its own API. This night is a
        separate run (tag rdA) on top of Track A's frozen notebook: the frozen notebooks and the 2021 exam are unchanged.
        {rd.ran_at ? ` Ran ${rd.ran_at.replace("T", " ")} · ${rd.minutes} min.` : ""}
      </p>
    </Section>
  );
}
