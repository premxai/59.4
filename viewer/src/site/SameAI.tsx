// "How it works" and the first chart: the same frozen AI with different notebooks, on the 8 unseen storms × 3 seeds.
import { useState } from "react";
import type { HeldoutRun } from "../mission/types";
import { clampPct, cleanVerdict, fmtHH, fmtSignedPct, pctChange, stormName, ticksOf, useSite, useTrackX, versionWhen, type SeedScore, type TrackX } from "./data";
import { Section, scrollToId } from "./ui";

export function HowItWorks() {
  return (
    <section className="s-how-sec" aria-label="How it works">
      <div className="s-wrap">
        <div className="s-kicker">How it works</div>
        <ol className="s-steps">
          <li>
            <span className="s-step-n">1</span>
            <div>
              <b>Day.</b> The frozen AI runs winter storms on a simulated Texas grid, following its notebook.
            </div>
          </li>
          <li>
            <span className="s-step-n">2</span>
            <div>
              <b>Night.</b> A coach reads the failures and proposes edits. Each edit is tested and kept only if the failed practice storms improve and calm days stay
              calm. The unseen storms are never used.
            </div>
          </li>
          <li>
            <span className="s-step-n">3</span>
            <div>
              <b>Every 2 nights.</b> The coach grades its own coaching, and its rewrite is A/B-tested too.
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

interface Cond {
  key: string;
  label: string;
  sub: string;
  ticks: string;
  majority: number | null;
  bySeed: Record<string, SeedScore>;
  hh: number | null;
  runs: HeldoutRun[] | null; // per storm × seed, when exported
  tone: "base" | "learned";
}

function detailRuns(t: TrackX, id: string | undefined): HeldoutRun[] | null {
  if (!id) return null;
  const g = [...t.base.generations].reverse().find((x) => x.harness_id === id && x.held_seeds.length >= 3);
  return g ? g.heldout : null;
}

function conditions(t: TrackX): Cond[] {
  const out: Cond[] = [];
  const v1 = t.v1;
  if (v1?.score) out.push({ key: "day1", label: "Day-1 notebook", sub: `${v1.label} · ${v1.id}`, ticks: v1.score.ticks, majority: v1.score.majority, bySeed: v1.score.bySeed, hh: v1.score.hhMedian, runs: detailRuns(t, v1.id), tone: "base" });
  const z = t.zeroShot;
  if (z) out.push({ key: "zs", label: "Claude's best guess, no learning", sub: "zero-shot notebook written by the model", ticks: z.ticks ?? "", majority: z.majority, bySeed: z.bySeed, hh: z.hhMedian, runs: null, tone: "base" });
  const b = t.best;
  const f = t.final;
  if (b?.score && f && b.id !== f.id)
    out.push({ key: "best", label: `Learned, best (${b.label})`, sub: `${versionWhen(b)} · ${b.id}`, ticks: b.score.ticks, majority: b.score.majority, bySeed: b.score.bySeed, hh: b.score.hhMedian, runs: detailRuns(t, b.id), tone: "learned" });
  if (f?.score)
    out.push({
      key: "final",
      label: `Learned, final frozen (${f.label})${b && b.id === f.id ? ", also the best" : ""}`,
      sub: `${versionWhen(f)} · ${f.id}`,
      ticks: f.score.ticks,
      majority: f.score.majority,
      bySeed: f.score.bySeed,
      hh: f.score.hhMedian,
      runs: detailRuns(t, f.id),
      tone: "learned",
    });
  return out;
}

const seedLine = (bs: Record<string, SeedScore>) =>
  Object.entries(bs)
    .map(([s, v]) => `seed ${s}: ${v.passed ?? "–"}/8`)
    .join(" · ");

export function SameAI() {
  const data = useSite((s) => s.data)!;
  const t = useTrackX()!;
  const [hover, setHover] = useState<{ c: string; i: number } | null>(null);
  const conds = conditions(t);
  const names = data.heldout.map(stormName);
  const L = data.honesty.locked;
  const A = L.rows.find((r) => r.key === "A");
  const C = L.rows.find((r) => r.key === (t.key === "A" ? "C_A" : "C_B"));
  const nPass = L.rows.filter((r) => (r.passedSeeds ?? 0) > 0).length;
  const hc = hover ? conds.find((c) => c.key === hover.c) : null;
  const hRuns = hc && hover ? (hc.runs ?? []).filter((r) => r.scenario_id === data.heldout[hover.i]).sort((a, b) => a.seed - b.seed) : [];

  return (
    <Section id="same" className="s-same">
      <div className="s-same-head">
        <div>
          <div className="s-kicker">
            <span className="s-kicker-n">00</span>Same AI, different notebook
          </div>
          <h2 className="s-h2" id="same-h">
            8 storms it never saw, 3 seeds each
          </h2>
        </div>
        <div className="s-seg" role="group" aria-label="Track">
          {data.trackKeys.map((k) => (
            <button key={k} className={k === t.key ? "on" : ""} aria-pressed={k === t.key} onClick={() => useSite.getState().setTrack(k)}>
              Track {k} <span className="s-dim">{k === "A" ? "in-storm only" : "everything"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="s-bars" onMouseLeave={() => setHover(null)}>
        {conds.map((c) => {
          const tk = ticksOf(c.ticks);
          return (
            <div key={c.key} className={`s-bar-row ${c.tone}`}>
              <div className="s-bar-l">
                <div className="s-bar-name">{c.label}</div>
                <div className="s-bar-sub">{c.sub}</div>
              </div>
              <div className="s-bar-segs" role="list" aria-label={`${c.label}: ${c.majority ?? 0} of 8 storms passed`}>
                {data.heldout.map((sid, i) => {
                  const k = tk[i] ?? "na";
                  const on = hover?.c === c.key && hover.i === i;
                  return (
                    <button
                      key={sid}
                      type="button"
                      role="listitem"
                      className={`s-seg-cell ${k} ${on ? "on" : ""}`}
                      aria-label={`${names[i]}: ${k === "pass" ? "passed" : "failed"}`}
                      onMouseEnter={() => setHover({ c: c.key, i })}
                      onFocus={() => setHover({ c: c.key, i })}
                      onBlur={() => setHover(null)}
                    />
                  );
                })}
              </div>
              <div className="s-bar-n">
                <b>{c.majority ?? "–"}</b>/8
              </div>
              <div className="s-bar-hh">{fmtHH(c.hh)} home-hours</div>
            </div>
          );
        })}
        <div className="s-bar-detail" aria-live="polite">
          {hc && hover ? (
            <>
              <div className="s-bar-detail-h">
                <b>{names[hover.i]}</b> · {hc.label}: {ticksOf(hc.ticks)[hover.i] === "pass" ? "passed" : "failed"} (majority of 3 seeds)
              </div>
              {hRuns.length ? (
                <ul>
                  {hRuns.map((r) => (
                    <li key={r.seed}>
                      <i className={`s-tick s-tick-${r.passed ? "pass" : "fail"}`} /> seed {r.seed}: {cleanVerdict(r.verdict) || (r.passed ? "passed" : "failed")} · {fmtHH(r.homes_dark_hours)} home-hours
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="s-dim">Per-seed results for single storms were not exported for this row; seed totals: {seedLine(hc.bySeed)}.</div>
              )}
            </>
          ) : (
            <span className="s-dim">Hover a segment for that storm's per-seed results. Green = passed on at least 2 of 3 seeds.</span>
          )}
        </div>
      </div>

      <table className="s-table s-same-table">
        <thead>
          <tr>
            <th>Unseen storm</th>
            {conds.map((c) => (
              <th key={c.key}>{c.label.replace(/^Learned, /, "")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.heldout.map((sid, i) => (
            <tr key={sid}>
              <td>{names[i]}</td>
              {conds.map((c) => {
                const k = ticksOf(c.ticks)[i];
                const runs = c.runs?.filter((r) => r.scenario_id === sid) ?? null;
                return (
                  <td key={c.key} className="num">
                    <i className={`s-tick s-tick-${k === "pass" ? "pass" : "fail"}`} /> {k === "pass" ? "pass" : "fail"}
                    {runs && runs.length ? <span className="s-dim"> · {runs.filter((r) => r.passed).length}/{runs.length} seeds</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Passed · per seed</td>
            {conds.map((c) => (
              <td key={c.key} className="num">
                <b>{c.majority ?? "–"}/8</b>
                <div className="s-dim s-small">{Object.values(c.bySeed).map((s) => s.passed ?? "–").join(" · ")}</div>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>

      {L.run && A && C ? (
        <p className="s-exam-line">
          <b>2021 exam</b> (real weather, run once): {nPass === 0 ? "nobody passes" : `${nPass} configurations pass`}; the Track {t.key} learned notebook{" "}
          {(C.collapses ?? 0) === 0 ? "never collapses" : `collapses on ${C.collapses} seeds`} and cuts darkness {fmtSignedPct(pctChange(A.hh, C.hh)).replace("−", "")}{" "}
          (worst hour {clampPct(C.peakShed)} vs {clampPct(A.peakShed)} on Day 1).{" "}
          <button className="s-link" onClick={() => scrollToId("exam")}>
            See the exam →
          </button>
        </p>
      ) : (
        <p className="s-exam-line s-dim">2021 exam: pending.</p>
      )}
    </Section>
  );
}
