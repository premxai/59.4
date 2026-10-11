import { useEffect, useMemo } from "react";
import { isKept } from "../mission/plain";
import { Ticks } from "./charts";
import { fmtHH, fmtSignedPct, nightLabel, organShort, stormKind, stormName, useSite, useTrackX, type TrackX } from "./data";
import { NightByNight, reasonOf } from "./Nights";
import { Section, SectionHead } from "./ui";
import { RecordButton } from "./Records";



/** Predicted vs measured change in homes dark on the idea's own test storms (negative = fewer homes dark). */
function PredBar({ p, a, max }: { p: number | null | undefined; a: number | null | undefined; max: number }) {
  const w = (v: number) => `${Math.min(50, (Math.abs(v) / max) * 50)}%`;
  const bar = (v: number | null | undefined, cls: string) =>
    v == null ? null : <i className={`s-pb ${cls} ${v < 0 ? "neg" : "pos"}`} style={{ width: w(v), [v < 0 ? "right" : "left"]: "50%" }} />;
  return (
    <div className="s-predbar" aria-label={`predicted ${fmtSignedPct(p)}, measured ${fmtSignedPct(a, 1)}`}>
      <div className="s-predbar-row">
        <span>predicted</span>
        <div className="s-pb-track">
          <b className="s-pb-zero" />
          {bar(p, "s-pb-pred")}
        </div>
        <em>{fmtSignedPct(p)}</em>
      </div>
      <div className="s-predbar-row">
        <span>measured</span>
        <div className="s-pb-track">
          <b className="s-pb-zero" />
          {bar(a, "s-pb-act")}
        </div>
        <em>{fmtSignedPct(a, 1)}</em>
      </div>
    </div>
  );
}

function TearOuts({ t }: { t: TrackX }) {
  const full = t.tearouts.find((x) => x.full);
  const minus = t.tearouts.filter((x) => !x.full);
  const ab = t.ablation;
  if (!full && !ab) return null;
  const rows: { key: string; label: string; m: number | null; hh: number | null; x: number | null; base?: boolean; mixed?: boolean }[] = [];
  if (full) rows.push({ key: "full", label: `Final frozen notebook, with the AI`, m: full.majority, hh: full.hhMedian, x: 1, base: true });
  for (const r of minus) {
    const x = full?.hhMedian && r.hhMedian ? r.hhMedian / full.hhMedian : null;
    const mixed = full != null && (r.majority ?? 0) > (full.majority ?? 0) && (x ?? 0) > 1.05;
    rows.push({ key: r.key, label: `Remove ${organShort(r.organ).toLowerCase()} ${r.id && r.id !== "build" ? r.id : ""}: ${r.desc ?? r.label}`, m: r.majority, hh: r.hhMedian, x, mixed });
  }
  const maxHH = Math.max(...rows.map((r) => r.hh ?? 0), ab?.unplugged?.hhMedian ?? 0, ...(ab?.removed ?? []).map((r) => r.hhMedian ?? 0));
  const mixed = rows.filter((r) => r.mixed);
  const unp = ab?.unplugged;
  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <div className={`s-to-row ${r.base ? "base" : ""}`}>
      <div className="s-to-l">{r.label}</div>
      <div className="s-to-m">{r.m ?? "–"}/8</div>
      <div className="s-to-bar">
        <i style={{ width: `${((r.hh ?? 0) / maxHH) * 100}%` }} className={r.base ? "base" : (r.x ?? 1) > 1.05 ? "worse" : ""} />
      </div>
      <div className="s-to-hh">{fmtHH(r.hh)}</div>
      <div className="s-to-x">{r.base ? "" : r.x != null ? `${r.x.toFixed(1)}×` : ""}</div>
    </div>
  );
  return (
    <div className="s-tearout">
      <h3 className="s-h3">Tear-outs: remove one learned part, re-run the 8 unseen storms × 3 seeds</h3>
      <div className="s-to-head">
        <span />
        <span>passed</span>
        <span>home-hours in the dark (median)</span>
        <span />
        <span>vs full</span>
      </div>
      {rows.map((r) => (
        <Row key={r.key} r={r} />
      ))}
      {mixed.map((r) => (
        <p key={r.key} className="s-note">
          Mixed result, shown as measured: removing {r.label.replace(/^Remove /, "")} raises storms passed ({full?.majority} → {r.m} of 8) and also raises home-hours in the
          dark ({fmtHH(full?.hhMedian)} → {fmtHH(r.hh)}, {r.x?.toFixed(1)}×). Passing is judged on the worst hour; home-hours count the whole storm.
        </p>
      ))}
      {unp && (
        <>
          <h3 className="s-h3 s-mt">AI unplugged: the notebook's rules alone, no model calls</h3>
          <div className="s-to-row base">
            <div className="s-to-l">Notebook rules only (AI unplugged)</div>
            <div className="s-to-m">{unp.majority}/8</div>
            <div className="s-to-bar">
              <i className="base" style={{ width: `${((unp.hhMedian ?? 0) / maxHH) * 100}%` }} />
            </div>
            <div className="s-to-hh">{fmtHH(unp.hhMedian)}</div>
            <div className="s-to-x">{full?.hhMedian && unp.hhMedian ? `${(unp.hhMedian / full.hhMedian).toFixed(1)}× vs with AI` : ""}</div>
          </div>
          {ab!.removed.slice(0, 4).map((r) => (
            <div key={r.organ + r.id} className="s-to-row">
              <div className="s-to-l">
                Rules only, minus {organShort(r.organ).toLowerCase()} {r.id !== "build" ? r.id : ""}: {r.desc}
              </div>
              <div className="s-to-m">{r.majority ?? "–"}/8</div>
              <div className="s-to-bar">
                <i className={(r.xDarker ?? 1) > 1.05 ? "worse" : ""} style={{ width: `${((r.hhMedian ?? 0) / maxHH) * 100}%` }} />
              </div>
              <div className="s-to-hh">{fmtHH(r.hhMedian)}</div>
              <div className="s-to-x">{r.xDarker != null ? `${r.xDarker.toFixed(1)}×` : ""}</div>
            </div>
          ))}
          {full && unp.hhMedian != null && full.hhMedian != null && (
            <p className="s-note">
              With the AI unplugged the rules pass {unp.majority} of 8 (with the AI: {full.majority} of 8) and leave {(unp.hhMedian / full.hhMedian).toFixed(1)}× the home-hours
              in the dark. Rows ranked by how much darker each removal makes the rules-only run; {ab!.removed.length} parts tested.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function Learned() {
  const t = useTrackX()!;
  const focus = useSite((s) => s.focusEdit);
  const kept = t.base.edits.filter(isKept);
  const rejected = t.base.edits.filter((e) => !isKept(e));
  const versionOf = (id: string | null | undefined) => t.versions.find((v) => v.id === id);
  const maxAbs = useMemo(() => Math.max(20, ...t.base.edits.flatMap((e) => [Math.abs(e.predicted_pct ?? 0), Math.abs(e.actual_pct ?? 0)])), [t]);
  const gamingN = rejected.filter((e) => reasonOf(e).gaming).length;

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(`edit-${focus}`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const id = setTimeout(() => useSite.getState().setFocusEdit(null), 2400);
    return () => clearTimeout(id);
  }, [focus]);

  return (
    <Section id="learned">
      <SectionHead id="learned" n="04" kicker="What it learned" title="Ideas kept, ideas rejected">
        The coach proposed {t.base.edits.length} ideas on Track {t.key}. {kept.length} passed the test and were kept; {rejected.length} were rejected
        {gamingN ? `, ${gamingN} of them for gaming the test` : ""}. Each kept idea wrote a lesson page to MongoDB that the AI can recall.
      </SectionHead>

      <div className="s-kept">
        {kept.map((e) => {
          const v = versionOf(e.child_id ?? e.stacked_id);
          const page = t.base.pages.find((p) => p.harness_id === (e.child_id ?? e.stacked_id));
          const storm = page?.scenario_id;
          const id = e.child_id ?? e.stacked_id ?? `${e.generation}-${e.title}`;
          return (
            <article key={id} id={`edit-${id}`} className={`s-idea ${focus === id ? "s-flash" : ""}`}>
              <div className="s-idea-top">
                <span className="s-idea-night">{nightLabel(e.generation)}</span>
                <span className="s-idea-organ">{organShort(e.organ)}</span>
                {v && <span className="s-idea-v">→ {v.label}</span>}
                {e.status === "stacked" && <span className="s-tag">stacked</span>}
              </div>
              <h3 className="s-idea-title">{e.title}</h3>
              {page ? (
                <blockquote className="s-quote">
                  <b>{page.title}.</b> {page.text} <RecordButton of={page} title={`Lesson page: ${page.title}`} />
                </blockquote>
              ) : e.lesson ? (
                <blockquote className="s-quote">
                  <b>{e.lesson}.</b>
                </blockquote>
              ) : null}
              <PredBar p={e.predicted_pct} a={e.actual_pct} max={maxAbs} />
              <div className="s-idea-foot">
                <span>
                  Test storms <Ticks ticks={e.ticks} size="sm" />
                </span>
                {storm && (
                  <span className="s-dim">
                    from {stormName(storm)}
                    {stormKind(storm) ? ` (${stormKind(storm)})` : ""}
                  </span>
                )}
                {e.night0 && <span className="s-dim">the coach's Night 0 draft, before any failure</span>}
                <RecordButton of={e} title={`Idea: ${e.title}`} />
                {v && (
                  <button
                    className="s-link"
                    onClick={() => {
                      useSite.getState().setVersion(v.id);
                      useSite.getState().setDiff(false);
                      document.getElementById("versions")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Open {v.label}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="s-caption">
        Predicted and measured = change in homes in the dark on the idea's own test runs (that night's failed training storms plus check storms), against the
        notebook it would replace. Ideas are also rejected when they make another storm worse or game the test.
      </p>

      <NightByNight t={t} />

      <TearOuts t={t} />
    </Section>
  );
}

