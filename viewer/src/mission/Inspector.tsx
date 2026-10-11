// Inspector drawer: the technical detail behind anything clicked (idea, step, notebook, day, page).
// The main screen stays plain; ids, expressions and raw data live here.
import { useEffect, type ReactNode } from "react";
import { genOf, keptPath, notebookVersion, stepsOf } from "./derive";
import { obj } from "./normalize";
import {
  darkPhrase,
  fmtBig,
  fmtPct,
  isKept,
  nightNumber,
  nightStepView,
  notebookName,
  opPlain,
  opTech,
  organMeta,
  organSummary,
  ORGANS,
  reasonTag,
  statusWord,
  stormLabel,
  storms,
} from "./plain";
import { useMission, type Inspect } from "./store";
import type { Edit, Track } from "./types";
import { Ticks } from "./ui";

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mc-insp-sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function PredBar({ label, v, scale }: { label: string; v: number | null | undefined; scale: number }) {
  if (v == null) return null;
  const w = Math.min(100, (Math.abs(v) / scale) * 100);
  return (
    <div className="mc-pred">
      <span className="mc-pred-k">{label}</span>
      <div className="mc-pred-track">
        <div className={`mc-pred-bar ${v < 0 ? "mc-pred-good" : "mc-pred-bad"}`} style={{ width: `${w}%` }} />
      </div>
      <span className="mc-pred-v">{fmtPct(v, 1)}</span>
    </div>
  );
}

function bornFrom(t: Track, e: Edit): string {
  const page = t.pages.find((p) => p.harness_id === e.child_id || p.id === `page_${e.child_id}`);
  if (page?.scenario_id) return stormLabel(page.scenario_id);
  if (e.night0) return "general knowledge (Night 0: no failures yet)";
  const rep = stepsOf(t, e.generation).find((s) => s.type === "replay");
  const m = rep ? /Replay of ([a-z0-9_]+)/i.exec(rep.text) : null;
  return m ? `${stormLabel(m[1])} (the storm the coach replayed that night)` : "that night's failed storms";
}

function EditView({ t, e }: { t: Track; e: Edit }) {
  const o = organMeta(e.organ);
  const page = t.pages.find((p) => p.harness_id === e.child_id || p.id === `page_${e.child_id}`);
  const scale = Math.max(50, Math.abs(e.predicted_pct ?? 0), Math.abs(e.actual_pct ?? 0));
  const kept = isKept(e);
  return (
    <>
      <div className="mc-insp-kicker">
        Night {nightNumber(t, e.generation)} · idea for <span style={{ color: o.color }}>{o.icon} {o.label}</span>
        {e.redteam && <span className="mc-tag mc-tag-red">red-team test (written by the team)</span>}
      </div>
      <h3 className="mc-insp-title">{e.title}</h3>
      <div className={`mc-insp-status ${kept ? "mc-good" : "mc-bad"}`}>
        {statusWord(e)}
        {!kept && `: ${reasonTag(e)}`}
      </div>
      {e.reason && !kept && <div className="mc-insp-reason">{e.reason}</div>}
      {(page || e.lesson) && (
        <Sec title="Lesson page">
          <div className="mc-insp-page">
            <b>{page?.title ?? e.lesson}</b>
            {page?.text && <p>{page.text}</p>}
          </div>
        </Sec>
      )}
      <Sec title="What it changes in the notebook">
        <ul className="mc-insp-ops">
          {e.ops.map((op, i) => (
            <li key={i}>{opPlain(op)}</li>
          ))}
          {!e.ops.length && <li className="mc-dim">no edits recorded</li>}
        </ul>
        {e.organs_touched.length > 1 && (
          <div className="mc-insp-organs">
            touches:{" "}
            {e.organs_touched.map((k) => (
              <span key={k} className="mc-chip" style={{ borderColor: organMeta(k).color, color: organMeta(k).color }}>
                {organMeta(k).icon} {organMeta(k).label}
              </span>
            ))}
          </div>
        )}
      </Sec>
      <Sec title="Predicted vs measured (homes dark on the failed storms)">
        <PredBar label="coach predicted" v={e.predicted_pct} scale={scale} />
        <PredBar label="test measured" v={e.actual_pct} scale={scale} />
        <div className="mc-insp-line">
          storms: predicted {storms(e.predicted ?? 0)}, measured {storms(e.actual ?? 0)}
        </div>
        {e.ticks && (
          <div className="mc-insp-line">
            test runs <Ticks s={e.ticks} size="m" />
          </div>
        )}
      </Sec>
      <Sec title="Born from">
        <div className="mc-insp-line">{bornFrom(t, e)}</div>
      </Sec>
      <Sec title="Technical">
        <dl className="mc-insp-dl">
          <dt>MongoDB doc</dt>
          <dd>
            <code>harness_versions/{e.child_id ?? "–"}</code>
            {e.stacked_id && (
              <>
                {" "}
                · stacked as <code>{e.stacked_id}</code>
              </>
            )}
          </dd>
          {page && (
            <>
              <dt>Lesson page</dt>
              <dd>
                <code>manual_pages/{page.id}</code>
              </dd>
            </>
          )}
          <dt>Parent notebook</dt>
          <dd>
            <code>{e.parent_id ?? "–"}</code> ({notebookVersion(t, e.parent_id)})
          </dd>
          <dt>Coach playbook</dt>
          <dd>v{(e.strategy_version ?? 0) + 1}</dd>
          <dt>Status</dt>
          <dd>
            {e.status}
            {e.reason_kind ? ` (${e.reason_kind})` : ""}
          </dd>
        </dl>
        <pre className="mc-insp-pre">{e.ops.map(opTech).join("\n")}</pre>
      </Sec>
    </>
  );
}

function StepView({ t, gen, index }: { t: Track; gen: number; index: number }) {
  const open = useMission((s) => s.openInspect);
  const s = stepsOf(t, gen)[index];
  if (!s) return <div className="mc-dim">This step is no longer in the data.</div>;
  const v = nightStepView(t, s, gen);
  const tests = Array.isArray(s.data.tests) ? (s.data.tests as unknown[]).map(obj) : [];
  return (
    <>
      <div className="mc-insp-kicker">
        Day {gen} → Night {nightNumber(t, gen)} · step {index + 1} · <code>{s.type}</code> · {s.actor ?? ""}
      </div>
      <h3 className="mc-insp-title">
        {v.icon} {v.title}
      </h3>
      <Sec title="Full text">
        <p className="mc-insp-text">{s.text}</p>
      </Sec>
      {tests.length > 0 && (
        <Sec title="Test runs (homes × hours dark: this idea vs the notebook before it)">
          <table className="mc-insp-table">
            <tbody>
              {tests.map((x, i) => (
                <tr key={i}>
                  <td>{stormLabel(String(x.scenario_id ?? ""))}</td>
                  <td className="mc-dim">v{Number(x.seed ?? 0) + 1}</td>
                  <td>{x.passed ? <b className="mc-good">✓</b> : <b className="mc-bad">✗</b>}</td>
                  <td>{fmtBig(typeof x.homes_dark_hours === "number" ? x.homes_dark_hours : null)}</td>
                  <td className="mc-dim">was {fmtBig(typeof x.parent_homes_dark_hours === "number" ? x.parent_homes_dark_hours : null)}</td>
                  <td>
                    {typeof x.homes_dark_hours === "number" && typeof x.parent_homes_dark_hours === "number" && x.parent_homes_dark_hours > 0
                      ? fmtPct(((x.homes_dark_hours - x.parent_homes_dark_hours) / x.parent_homes_dark_hours) * 100)
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sec>
      )}
      {v.edit && (
        <button className="mc-btn" onClick={() => open({ kind: "edit", track: t.key, edit: v.edit! })}>
          Open the idea →
        </button>
      )}
      <Sec title="Raw data">
        <pre className="mc-insp-pre">{JSON.stringify(s.data, null, 1).slice(0, 4000)}</pre>
      </Sec>
    </>
  );
}

function NotebookView({ t, id }: { t: Track; id: string }) {
  const node = t.lineage.find((l) => l.id === id);
  const gen = t.generations.find((g) => g.harness_id === id);
  const counts = node?.counts ?? gen?.counts ?? {};
  const kept = keptPath(t, id);
  const open = useMission((s) => s.openInspect);
  return (
    <>
      <div className="mc-insp-kicker">
        Track {t.key} · notebook {notebookVersion(t, id)}
      </div>
      <h3 className="mc-insp-title">{notebookName(t, id)}</h3>
      <Sec title="What's in it">
        <ul className="mc-insp-ops">
          {ORGANS.filter((o) => o.key !== "build" || t.key === "B").map((o) => (
            <li key={o.key}>
              {o.icon} <b>{o.label}</b>: {organSummary(o.key, counts)}
            </li>
          ))}
        </ul>
      </Sec>
      <Sec title="Ideas that built it">
        {kept.length ? (
          <ul className="mc-insp-ops">
            {kept.map((e, i) => (
              <li key={i}>
                <button className="mc-linkbtn" onClick={() => open({ kind: "edit", track: t.key, edit: e })}>
                  Night {nightNumber(t, e.generation)} · {e.lesson || e.title}
                </button>{" "}
                <span className="mc-dim">{darkPhrase(e.actual_pct)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mc-dim">The starting notebook: nothing learned yet.</div>
        )}
      </Sec>
      {gen && <DayResults t={t} g={gen.generation} />}
      <Sec title="Technical">
        <dl className="mc-insp-dl">
          <dt>MongoDB doc</dt>
          <dd>
            <code>harness_versions/{id}</code>
          </dd>
          <dt>Fingerprint</dt>
          <dd>
            <code>{node?.hash ?? gen?.hash ?? "–"}</code>
          </dd>
          <dt>Parent</dt>
          <dd>
            <code>{node?.parent_id ?? "–"}</code>
          </dd>
          <dt>Born from</dt>
          <dd>{node?.born_from ?? "–"}</dd>
        </dl>
      </Sec>
    </>
  );
}

function DayResults({ t, g }: { t: Track; g: number }) {
  const gen = genOf(t, g);
  if (!gen?.heldout.length) return null;
  const ids = [...new Set(gen.heldout.map((h) => h.scenario_id))];
  return (
    <Sec title={`Day ${g} on the unseen storms (each version)`}>
      <table className="mc-insp-table">
        <tbody>
          {ids.map((sid) =>
            gen.heldout
              .filter((h) => h.scenario_id === sid)
              .map((h, i) => (
                <tr key={sid + h.seed}>
                  <td>{i === 0 ? stormLabel(sid) : ""}</td>
                  <td className="mc-dim">v{h.seed + 1}</td>
                  <td>{h.inconclusive ? "?" : h.passed ? <b className="mc-good">✓</b> : <b className="mc-bad">✗</b>}</td>
                  <td>{fmtBig(h.homes_dark_hours)}</td>
                  <td className="mc-dim">{h.verdict}</td>
                </tr>
              )),
          )}
        </tbody>
      </table>
    </Sec>
  );
}

function Body({ i, t }: { i: Inspect; t: Track }) {
  switch (i.kind) {
    case "edit":
      return <EditView t={t} e={i.edit} />;
    case "step":
      return <StepView t={t} gen={i.gen} index={i.index} />;
    case "notebook":
      return <NotebookView t={t} id={i.id} />;
    case "day": {
      const g = genOf(t, i.gen);
      return g?.harness_id ? <NotebookView t={t} id={g.harness_id} /> : <DayResults t={t} g={i.gen} />;
    }
    case "page": {
      const p = i.page;
      return (
        <>
          <div className="mc-insp-kicker">
            Lesson page · {organMeta(p.organ).icon} {organMeta(p.organ).label}
          </div>
          <h3 className="mc-insp-title">{p.title}</h3>
          <p className="mc-insp-text">{p.text}</p>
          <dl className="mc-insp-dl">
            <dt>Written</dt>
            <dd>{p.generation != null ? `Night ${nightNumber(t, p.generation)}` : "–"}</dd>
            <dt>Learned from</dt>
            <dd>{p.scenario_id ? stormLabel(p.scenario_id) : "general knowledge"}</dd>
            <dt>MongoDB doc</dt>
            <dd>
              <code>manual_pages/{p.id}</code>
            </dd>
            <dt>Notebook</dt>
            <dd>
              <code>{p.harness_id ?? "–"}</code> ({notebookVersion(t, p.harness_id)})
            </dd>
          </dl>
        </>
      );
    }
  }
}

export function Inspector() {
  const i = useMission((s) => s.inspect);
  const close = useMission((s) => s.closeInspect);
  const t = useMission((s) => (i ? (s.mission?.tracks[i.track] ?? null) : null));
  useEffect(() => {
    if (!i) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, close]);
  if (!i || !t) return null;
  return (
    <>
      <div className="mc-insp-scrim" onClick={close} />
      <aside className="mc-insp" role="dialog" aria-label="Inspector">
        <button className="mc-insp-close" onClick={close} title="Close (Esc)">
          ✕
        </button>
        <div className="mc-insp-body">
          <Body i={i} t={t} />
        </div>
      </aside>
    </>
  );
}
