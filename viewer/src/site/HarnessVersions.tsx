import { useMemo, useState, type ReactNode } from "react";
import { plainLever, plainVar } from "../mission/plain";
import { Ticks } from "./charts";
import { fmtHH, fmtSignedPct, organLabel, organShort, stormKind, stormName, useSite, useTrackX, versionWhen, type Notebook, type TrackX, type Version } from "./data";
import { Section, SectionHead, Seg } from "./ui";
import { RecordButton } from "./Records";

// ------------------------------------------------------------------ notebook -> comparable items
interface Item {
  organ: string;
  key: string;
  title: string;
  raw: string;
  meta?: string;
  list?: string[]; // for set-like items (briefing variables, AI levers) the diff shows added/removed members
}

const ORGANS = ["habit", "hard_limit", "gauge_alarm", "briefing_memory", "authority", "build"] as const;
const ORGAN_BLURB: Record<string, string> = {
  habit: "what to do when trouble starts",
  hard_limit: "lines the AI may never cross",
  gauge_alarm: "what it measures, when it wakes the AI",
  briefing_memory: "its briefing and the lesson pages it recalls",
  authority: "which levers are the AI's own call",
  build: "equipment readied before winter",
};

const pct = (x: unknown) => (typeof x === "number" ? `${Math.round(x * 100)}%` : String(x));
const expr = (s: string) => s.replace(/->/g, "→").replace(/\s+/g, " ").trim();

function buildItems(build: Record<string, unknown>): Item[] {
  const out: Item[] = [];
  for (const [k, v] of Object.entries(build)) {
    if (k === "battery_mwh") continue;
    let title = k.replace(/_/g, " ");
    let raw = `${k} = ${JSON.stringify(v)}`;
    if (k === "winterize_plants" && v && typeof v === "object") {
      const parts = Object.entries(v as Record<string, unknown>).map(([f, x]) => `${pct(x)} of ${f}`);
      title = `Winterize power plants: ${parts.join(", ")}`;
      raw = `winterize_plants = { ${Object.entries(v as Record<string, unknown>).map(([f, x]) => `${f}: ${x}`).join(", ")} }`;
    } else if (k === "winterize_wells") title = `Winterize ${pct(v)} of gas wells`;
    else if (k === "firm_fuel") title = `Firm (backup) fuel contracts for ${pct(v)} of gas plants`;
    else if (k === "critical_load_map") title = v ? "Map gas facilities so rolling outages skip them" : "No critical-load map";
    else if (k === "battery_mw") {
      title = typeof v === "number" && v > 0 ? `Battery yard: ${v.toLocaleString("en-US")} MW / ${Number(build.battery_mwh ?? 0).toLocaleString("en-US")} MWh` : "No battery yard";
      raw = `battery_mw = ${v}, battery_mwh = ${build.battery_mwh ?? 0}`;
    }
    out.push({ organ: "build", key: `build:${k}`, title, raw });
  }
  return out;
}

export function notebookItems(nb: Notebook, fixedBuild?: Record<string, unknown>): Item[] {
  const items: Item[] = [];
  for (const r of nb.rules)
    items.push({ organ: "habit", key: `rule:${r.id}`, title: r.description || r.id, raw: `if ${expr(r.if)} → ${r.then.join(", ")}`, meta: `${r.id}${r.priority != null ? ` · priority ${r.priority}` : ""}` });
  for (const g of nb.guardrails)
    items.push({ organ: "hard_limit", key: `guard:${g.id}`, title: g.description || g.id, raw: `when ${expr(g.when)} → enforce ${g.enforce.join(", ")}`, meta: g.id });
  for (const s of nb.sensors) items.push({ organ: "gauge_alarm", key: `sensor:${s.name}`, title: `Gauge “${plainVar(s.name)}”${s.description ? `: ${s.description}` : ""}`, raw: `${s.name} = ${s.expr}`, meta: "gauge" });
  for (const a of nb.alerts) items.push({ organ: "gauge_alarm", key: `alert:${expr(a.when)}`, title: a.description || "Wake the AI", raw: `alarm when ${expr(a.when)}`, meta: "alarm" });
  const c = nb.context;
  items.push({ organ: "briefing_memory", key: "ctx:show", title: `Briefing shows ${c.show.length} readings: ${c.show.map(plainVar).join(", ")}`, raw: `show = [${c.show.join(", ")}]`, list: c.show });
  items.push({ organ: "briefing_memory", key: "ctx:forecast", title: c.show_forecast ? "Weather forecast is in the briefing" : "No weather forecast in the briefing", raw: `show_forecast = ${!!c.show_forecast}` });
  items.push({ organ: "briefing_memory", key: "ctx:memory", title: c.memory_top_k ? `Recalls the ${c.memory_top_k} most relevant lesson pages from MongoDB` : "Recalls no lesson pages", raw: `memory_top_k = ${c.memory_top_k ?? 0}` });
  if (c.recent_hours != null) items.push({ organ: "briefing_memory", key: "ctx:recent", title: `Remembers the last ${c.recent_hours} hours of the storm`, raw: `recent_hours = ${c.recent_hours}` });
  if (typeof nb.memory_policy.max_active_pages === "number")
    items.push({ organ: "briefing_memory", key: "mem:max", title: `Keeps at most ${nb.memory_policy.max_active_pages} lesson pages active`, raw: `max_active_pages = ${nb.memory_policy.max_active_pages}` });
  const l = nb.authority.llm_decides;
  items.push({ organ: "authority", key: "auth:levers", title: `The AI decides ${l.length} levers: ${l.map(plainLever).join(", ")}`, raw: `llm_decides = [${l.join(", ")}]`, list: l });
  items.push({ organ: "authority", key: "auth:every", title: `The AI is asked every ${nb.authority.call_every_h ?? 1} h (and whenever an alarm fires)`, raw: `call_every_h = ${nb.authority.call_every_h ?? 1}` });
  items.push(...buildItems({ ...(fixedBuild ?? {}), ...nb.build }));
  if (!Object.keys({ ...(fixedBuild ?? {}), ...nb.build }).length) items.push({ organ: "build", key: "build:none", title: "No winter preparation", raw: "build = {}" });
  return items;
}

// ------------------------------------------------------------------ provenance
interface Origin {
  version: Version;
}

function originOf(t: TrackX, upto: Version, item: Item, itemsByVersion: Map<string, Item[]>): Origin | null {
  // the first version (walking forward to `upto`) since which this exact item exists unchanged
  let since: Version | null = null;
  for (const v of t.versions) {
    if (v.index > upto.index) break;
    const it = itemsByVersion.get(v.id)?.find((x) => x.key === item.key);
    if (it && it.raw === item.raw) since = since ?? v;
    else since = null;
  }
  return since ? { version: since } : null;
}

function OriginLine({ o }: { t: TrackX; o: Origin | null }) {
  if (!o) return null;
  const v = o.version;
  if (v.index === 0) return <div className="s-origin">In the Day-1 notebook</div>;
  const e = v.edit;
  const storm = v.page?.scenario_id;
  return (
    <div className="s-origin">
      Since {v.label} ({versionWhen(v)})
      {e && (
        <>
          {" · idea "}
          <button
            className="s-link"
            onClick={() => {
              useSite.getState().setFocusEdit(null);
              requestAnimationFrame(() => useSite.getState().setFocusEdit(v.id));
            }}
          >
            “{e.title}”
          </button>
        </>
      )}
      {v.page && <> · lesson “{v.page.title}”</>}
      {storm ? (
        <>
          {" "}
          · from failed storm {stormName(storm)}
          {stormKind(storm) ? ` (${stormKind(storm)})` : ""}
        </>
      ) : e?.night0 ? (
        <> · the coach's Night 0 draft</>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ cards
function Card({ item, status, before, children }: { item: Item; status?: "added" | "removed" | "changed" | "same"; before?: Item; children?: ReactNode }) {
  const added = status === "changed" && item.list && before?.list ? item.list.filter((x) => !before.list!.includes(x)) : [];
  const removed = status === "changed" && item.list && before?.list ? before.list.filter((x) => !item.list!.includes(x)) : [];
  return (
    <div className={`s-card s-card-${status ?? "plain"}`}>
      <div className="s-card-top">
        {status && status !== "same" && <span className={`s-tag s-tag-${status}`}>{status}</span>}
        <div className="s-card-title">{item.title}</div>
      </div>
      {status === "changed" && before && !item.list && <code className="s-raw s-raw-old">{before.raw}</code>}
      {status === "changed" && item.list ? (
        <div className="s-listdiff">
          {added.map((x) => (
            <span key={x} className="s-chip s-chip-add">
              + {plainVar(x) === x ? x : `${plainVar(x)}`}
            </span>
          ))}
          {removed.map((x) => (
            <span key={x} className="s-chip s-chip-rem">
              − {plainVar(x)}
            </span>
          ))}
        </div>
      ) : (
        <code className={`s-raw ${status === "removed" ? "s-raw-old" : ""}`}>{item.raw}</code>
      )}
      {item.meta && <div className="s-card-meta">{item.meta}</div>}
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ section
type Row = { organ: string; item: Item; before?: Item; status: "added" | "removed" | "changed" | "same" };

function diffItems(L: Item[], R: Item[]): Row[] {
  const rows: Row[] = [];
  for (const r of R) {
    const l = L.find((x) => x.key === r.key);
    rows.push({ organ: r.organ, item: r, before: l, status: !l ? "added" : l.raw !== r.raw ? "changed" : "same" });
  }
  for (const l of L) if (!R.some((x) => x.key === l.key)) rows.push({ organ: l.organ, item: l, status: "removed" });
  return rows;
}

type Mode = "changes" | "full" | "compare";

export function HarnessVersions() {
  const t = useTrackX()!;
  const data = useSite((s) => s.data)!;
  const selId = useSite((s) => s.version);
  const compare = useSite((s) => s.diff);
  const dl = useSite((s) => s.diffLeft);
  const dr = useSite((s) => s.diffRight);
  const [readMode, setReadMode] = useState<"changes" | "full">("changes");
  const [hideSame, setHideSame] = useState(true);
  const sel = t.versions.find((v) => v.id === selId) ?? t.final ?? t.versions[t.versions.length - 1];
  const parent = t.versions.find((v) => v.id === sel.parentId) ?? (sel.index > 0 ? t.versions[sel.index - 1] : undefined);
  const left = t.versions.find((v) => v.id === dl) ?? t.v1!;
  const right = t.versions.find((v) => v.id === dr) ?? t.final!;
  const fixed = t.base.fixed_build as Record<string, unknown> | undefined;
  const mode: Mode = compare ? "compare" : parent ? readMode : "full";

  const itemsByVersion = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const v of t.versions) if (v.notebook) m.set(v.id, notebookItems(v.notebook, fixed));
    return m;
  }, [t, fixed]);
  const hasNotebooks = itemsByVersion.size > 0;

  const dLeft = mode === "compare" ? left : parent;
  const dRight = mode === "compare" ? right : sel;
  const diffRows = useMemo(
    () => (mode === "full" || !dLeft || !dRight ? null : diffItems(itemsByVersion.get(dLeft.id) ?? [], itemsByVersion.get(dRight.id) ?? [])),
    [mode, dLeft, dRight, itemsByVersion],
  );
  const tally = diffRows
    ? { added: diffRows.filter((r) => r.status === "added").length, changed: diffRows.filter((r) => r.status === "changed").length, removed: diffRows.filter((r) => r.status === "removed").length }
    : null;
  const hide = mode === "compare" ? hideSame : true;
  const names = data.heldout.map(stormName);

  const pick = (v: Version) => {
    if (compare) useSite.getState().setDiff(true, left.id, v.id);
    else useSite.getState().setVersion(v.id);
  };

  return (
    <Section id="versions">
      <SectionHead id="versions" n="02" kicker="Harness versions" title="Every version of the notebook">
        The model's weights never change; only this notebook does. Track {t.key} has {t.versions.length} versions in its lineage, one per kept idea, each re-scored
        on the 8 unseen storms × 3 seeds. Click a row to see exactly what changed from its parent.
      </SectionHead>

      <table className="s-table s-vtable">
        <thead>
          <tr>
            <th>Version</th>
            <th>Written</th>
            <th>Idea that created it</th>
            <th>Part</th>
            <th>Unseen storms</th>
            <th className="r">Passed</th>
            <th className="r">Home-hours dark</th>
            <th className="r">Range, 3 seeds</th>
          </tr>
        </thead>
        <tbody>
          {t.versions.map((v) => {
            const on = compare ? v.id === left.id || v.id === right.id : v.id === sel.id;
            return (
              <tr
                key={v.id}
                className={`s-vrow ${on ? "on" : ""}`}
                tabIndex={0}
                aria-selected={on}
                onClick={() => pick(v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(v);
                  }
                }}
              >
                <td className="s-nowrap">
                  <span className="s-vrow-l">{v.label}</span>
                  {v.isFinal && <span className="s-tag s-tag-final">final frozen</span>}
                  {v.isBest && <span className="s-tag s-tag-best">best</span>}
                  <div className="s-vrow-id">
                    {v.id} <RecordButton of={t.base.lineage.find((l) => l.id === v.id)} title={`Notebook version ${v.label} (${v.id})`} />
                  </div>
                </td>
                <td className="s-nowrap">{versionWhen(v)}</td>
                <td>{v.index === 0 ? <span className="s-dim">Day-1 notebook (starting point)</span> : (v.edit?.title ?? <span className="s-dim">no idea recorded</span>)}</td>
                <td className="s-dim s-nowrap">{v.index === 0 ? "" : organShort(v.edit?.organ)}</td>
                <td>
                  <Ticks ticks={v.score?.ticks} names={names} />
                </td>
                <td className="r num">{v.score ? `${v.score.majority}/8` : "–"}</td>
                <td className="r num">{fmtHH(v.score?.hhMedian)}</td>
                <td className="r num s-dim s-nowrap">
                  {fmtHH(v.score?.hhMin)} – {fmtHH(v.score?.hhMax)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="s-caption">
        Home-hours = median over 3 seeds of the total over all 8 unseen storms. Squares follow the storm order {names.join(", ")}. Nights where no idea passed the gate
        add no version; every night, kept or not, is listed under “Night by night” in section 04.
      </p>

      <div className="s-toolbar s-mt">
        <Seg
          label="Mode"
          value={mode}
          onChange={(m) => {
            if (m === "compare") useSite.getState().setDiff(true, left.id, right.id);
            else {
              useSite.getState().setDiff(false);
              setReadMode(m);
            }
          }}
          options={[
            { v: "changes" as Mode, label: parent ? `Changes from ${parent.label}` : "Changes from parent" },
            { v: "full" as Mode, label: `Full notebook ${sel.label}` },
            { v: "compare" as Mode, label: "Compare any two" },
          ]}
        />
        {mode === "compare" && (
          <div className="s-diffpick">
            <select value={left.id} onChange={(e) => useSite.getState().setDiff(true, e.target.value, right.id)} aria-label="Older version">
              {t.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {versionWhen(v)}
                </option>
              ))}
            </select>
            <span className="s-dim">↔</span>
            <select value={right.id} onChange={(e) => useSite.getState().setDiff(true, left.id, e.target.value)} aria-label="Newer version">
              {t.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {versionWhen(v)}
                  {v.isFinal ? " (final)" : ""}
                </option>
              ))}
            </select>
            <label className="s-check">
              <input type="checkbox" checked={hideSame} onChange={(e) => setHideSame(e.target.checked)} />
              Hide unchanged
            </label>
          </div>
        )}
      </div>

      {mode !== "compare" && (
        <div className="s-vhead">
          <div>
            <div className="s-vhead-title">
              {sel.label} <span className="s-dim">· {sel.index === 0 ? "Day-1 notebook" : `written ${versionWhen(sel)}`}</span>
              {sel.isFinal && <span className="s-tag s-tag-final">final frozen</span>}
              {sel.isBest && <span className="s-tag s-tag-best">best on unseen storms</span>}
            </div>
            <div className="s-vhead-meta">
              <code>{sel.id}</code>
              {sel.hash && <code>{sel.hash}</code>}
              {parent && <span>parent {parent.label}</span>}
            </div>
          </div>
          {sel.score && (
            <div className="s-vhead-score">
              <Ticks ticks={sel.score.ticks} names={names} />
              <span>
                <b>{sel.score.majority} of 8</b> unseen storms · <b>{fmtHH(sel.score.hhMedian)}</b> home-hours dark
              </span>
            </div>
          )}
          {sel.edit && (
            <div className="s-vhead-edit">
              <div className="s-kicker">Kept idea that produced {sel.label}</div>
              <div className="s-vhead-edit-t">
                {sel.edit.title} <span className="s-dim">· {organShort(sel.edit.organ)}</span> <RecordButton of={sel.edit} title={`Idea: ${sel.edit.title}`} />
              </div>
              <div className="s-vhead-edit-m">
                Coach predicted {fmtSignedPct(sel.edit.predicted_pct)} homes dark, measured {fmtSignedPct(sel.edit.actual_pct, 1)} on its test runs
                {sel.edit.ticks ? (
                  <>
                    {" "}
                    · <Ticks ticks={sel.edit.ticks} size="sm" />
                  </>
                ) : null}
                {sel.page?.scenario_id
                  ? ` · from failed storm ${stormName(sel.page.scenario_id)} (${stormKind(sel.page.scenario_id)})`
                  : sel.edit.night0
                    ? " · the coach's Night 0 draft, before any failure"
                    : ""}
              </div>
              {sel.page && (
                <blockquote className="s-quote">
                  <b>{sel.page.title}.</b> {sel.page.text} <RecordButton of={t.base.pages.find((p) => p.id === sel.page?.id)} title={`Lesson page: ${sel.page.title}`} />
                </blockquote>
              )}
            </div>
          )}
        </div>
      )}

      {diffRows && tally && dLeft && dRight && (
        <div className="s-diffsum">
          {mode === "compare" ? "Comparing" : "What changed from"} <b>{dLeft.label}</b> ({versionWhen(dLeft)}) {mode === "compare" ? "with" : "to"} <b>{dRight.label}</b> (
          {versionWhen(dRight)}):
          <span className="s-chip s-chip-add">{tally.added} added</span>
          <span className="s-chip s-chip-chg">{tally.changed} changed</span>
          <span className="s-chip s-chip-rem">{tally.removed} removed</span>
        </div>
      )}

      {!hasNotebooks ? (
        <p className="s-note">The notebook contents are not in this export yet (counts only). Reload once the exporter has written the lineage notebooks.</p>
      ) : (
        <div className="s-organs">
          {ORGANS.map((o) => {
            let body: ReactNode;
            let count = 0;
            if (diffRows && dRight) {
              const rows = diffRows.filter((r) => r.organ === o && (!hide || r.status !== "same"));
              count = rows.length;
              body = rows.map((r) => (
                <Card key={r.item.key + r.status} item={r.item} status={r.status} before={r.before}>
                  {r.status !== "removed" && <OriginLine t={t} o={originOf(t, dRight, r.item, itemsByVersion)} />}
                </Card>
              ));
            } else {
              const items = (itemsByVersion.get(sel.id) ?? []).filter((i) => i.organ === o);
              count = items.length;
              body = items.length ? (
                items.map((i) => (
                  <Card key={i.key} item={i}>
                    <OriginLine t={t} o={originOf(t, sel, i, itemsByVersion)} />
                  </Card>
                ))
              ) : (
                <div className="s-empty">None in this version</div>
              );
            }
            if (diffRows && count === 0) return null;
            return (
              <div key={o} className="s-organ">
                <div className="s-organ-h">
                  <div className="s-organ-l">{organLabel(o)}</div>
                  <div className="s-organ-b">{ORGAN_BLURB[o]}</div>
                </div>
                <div className="s-organ-cards">{body}</div>
              </div>
            );
          })}
          {diffRows && tally && tally.added + tally.changed + tally.removed === 0 && <div className="s-empty">No differences.</div>}
        </div>
      )}
    </Section>
  );
}
