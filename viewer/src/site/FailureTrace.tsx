import { useEffect, useMemo, useState } from "react";
import type { Showcase, ShowcaseRun } from "../mission/types";
import { cleanVerdict, fmtHH, fmtHomes, groupSteps, stepKind, stepText, stormName, useSite, useTrackX, type StepGroup, type TrackX } from "./data";
import { useLite } from "./replays";
import { readout, TraceChart, traceScales } from "./TraceChart";
import { Section, SectionHead, Seg } from "./ui";
import { RecordButton } from "./Records";

const KEY_TYPES = new Set(["freeze_off", "icing", "shed_start", "shed_end", "gas_feedback", "ufls", "collapse", "restore", "trip", "false_all_clear", "guardrail", "rule_fired", "sensor_alert", "ai_decision", "llm_call"]);

function versionLabel(t: TrackX, id: string | undefined): string {
  if (!id) return "";
  return t.versions.find((v) => v.id === id)?.label ?? "";
}

const outageMw = (t: string) => {
  const m = /rolling outages ([\d,]+) MW/i.exec(t);
  return m ? Number(m[1].replace(/,/g, "")) : t.includes("no rolling outages") || t.includes("restore") ? 0 : null;
};

/** The key moments: every storm / feedback / notebook event, the first of each alarm, and AI decisions only when the cut changes materially. */
function keyMoments(groups: StepGroup[]): StepGroup[] {
  const out: StepGroup[] = [];
  const alarms = new Set<string>();
  let lastMw: number | null | undefined;
  let lastAiText = "";
  for (const g of groups) {
    if (!KEY_TYPES.has(g.type)) continue;
    if (g.type === "sensor_alert") {
      if (alarms.has(g.text)) continue;
      alarms.add(g.text);
    } else if (g.type === "ai_decision" || g.type === "llm_call") {
      const mw = outageMw(g.text);
      const first = lastMw === undefined;
      const changed = mw != null && lastMw != null ? Math.abs(mw - lastMw) >= Math.max(1000, 0.25 * Math.max(mw, lastMw)) : mw !== lastMw;
      if (!first && !changed && g.text.split(";")[0] === lastAiText.split(";")[0]) continue;
      if (!first && !changed && mw != null) continue;
      lastMw = mw;
      lastAiText = g.text;
    }
    out.push(g);
  }
  return out;
}

function Narrative({ groups, hover, onPick, max }: { groups: StepGroup[]; hover: number | null; onPick: (h: number) => void; max: number }) {
  const [all, setAll] = useState(false);
  const [mem, setMem] = useState(false);
  const memN = groups.filter((g) => g.type === "memory_recall" || g.type === "recall").reduce((a, g) => a + g.n, 0);
  const key = useMemo(() => keyMoments(groups), [groups]);
  const full = groups.filter((g) => (mem ? true : KEY_TYPES.has(g.type)));
  const shown = all ? full : key;
  const list = all ? shown : shown.slice(0, max);
  return (
    <div className="s-narr">
      <ol>
        {list.map((g, i) => {
          const k = stepKind(g.type);
          const on = hover != null && hover >= g.h0 && hover <= g.h1;
          return (
            <li key={i} className={`s-narr-row s-tone-${k.tone} ${on ? "on" : ""}`}>
              <button onClick={() => onPick(g.h0)} title={g.text}>
                <span className="s-narr-h">{g.h0 === g.h1 ? `h${g.h0}` : `h${g.h0}–${g.h1}`}</span>
                <span className="s-narr-k">{k.label}</span>
                <span className="s-narr-t">
                  {stepText(g.type, g.text)}
                  {g.n > 1 && <em> · ×{g.n}</em>}
                </span>
              </button>
              <RecordButton of={g.steps} title={`Run step at h${g.h0}${g.n > 1 ? ` (${g.n} merged steps)` : ""}`} className="s-rec-abs" />
            </li>
          );
        })}
      </ol>
      <div className="s-narr-foot">
        <span className="s-dim">{all ? `All ${full.length} merged steps` : `${Math.min(max, key.length)} of ${key.length} key moments`}</span>
        <button className="s-link" onClick={() => setAll(!all)}>
          {all ? "Key moments only" : `Show all ${full.length} steps`}
        </button>
        {all && memN > 0 && (
          <button className="s-link" onClick={() => setMem(!mem)}>
            {mem ? "Hide memory recalls" : `Include ${memN.toLocaleString("en-US")} memory recalls`}
          </button>
        )}
      </div>
    </div>
  );
}

function Side({ t, run, which, sc, hover, setHover, scales, onPick }: { t: TrackX; run: ShowcaseRun; which: "day1" | "final"; sc: Showcase; hover: number | null; setHover: (h: number | null) => void; scales: ReturnType<typeof traceScales> | null; onPick: (h: number) => void }) {
  const { replay, error } = useLite(run.replay);
  const groups = useMemo(() => groupSteps(run.steps), [run.steps]);
  const markers = useMemo(() => groups.filter((g) => KEY_TYPES.has(g.type)), [groups]);
  const p = replay ? readout(replay.points, hover) : null;
  const atHour = hover != null ? groups.filter((g) => hover >= g.h0 && hover <= g.h1 && g.type !== "memory_recall") : [];
  const vid = replay?.meta.harness?.id;
  const ok = run.passed === true;
  return (
    <div className="s-side">
      <div className="s-side-h">
        <div className="s-kicker">{which === "day1" ? "Day 1" : "Final frozen notebook"}</div>
        <div className="s-side-title">
          {which === "day1" ? "Day-1 notebook" : "Learned notebook"} <span className="s-dim">· {versionLabel(t, vid) || (which === "day1" ? "v1" : t.final?.label)}</span>
        </div>
        <div className={`s-verdict ${ok ? "s-ok" : "s-bad"}`}>
          <span className="s-verdict-dot" />
          {cleanVerdict(run.verdict) || (ok ? "Passed" : "Failed")}
        </div>
        <div className="s-side-meta">
          {fmtHH(run.homes_dark_hours)} home-hours in the dark · {run.steps.length.toLocaleString("en-US")} logged steps · {stormName(sc.scenario_id)}, seed {sc.seed ?? 0}
        </div>
      </div>
      {error && <p className="s-note">Could not load the trace file {run.replay}: {error}</p>}
      {replay && scales ? (
        <>
          <TraceChart series={[{ key: which, label: which, color: which === "day1" ? "var(--bad)" : "var(--accent)", points: replay.points }]} scales={scales} markers={markers} hover={hover} onHover={setHover} onPick={onPick} ariaLabel={`${which === "day1" ? "Day 1" : "Final"} trace`} />
          <div className="s-readout" aria-live="polite">
            {p ? (
              <>
                <b>h{p.h}</b>
                <span>{p.freq != null && p.freq > 0 ? `${p.freq.toFixed(2)} Hz` : "grid down"}</span>
                <span>{fmtHomes(p.homesDark)} homes dark</span>
                <span>
                  supply {(p.supply / 1000).toFixed(1)} / demand {(p.demand / 1000).toFixed(1)} GW
                </span>
              </>
            ) : (
              <span className="s-dim">Hover the chart or click a step to read an hour.</span>
            )}
          </div>
          {atHour.length > 0 && (
            <ul className="s-athour">
              {atHour.slice(0, 4).map((g, i) => (
                <li key={i} className={`s-tone-${stepKind(g.type).tone}`}>
                  <span className="s-narr-k">{stepKind(g.type).label}</span> {stepText(g.type, g.text)}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        !error && <div className="s-skel" style={{ height: 380 }} />
      )}
      <Narrative groups={groups} hover={hover} onPick={onPick} max={24} />
    </div>
  );
}

export function FailureTrace() {
  const data = useSite((s) => s.data)!;
  const t = useTrackX()!;
  const list = data.mission.showcase.filter((s) => s.track === t.key && s.runs.day1);
  const [pick, setPick] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  useEffect(() => {
    setPick(0);
    setLocked(null);
  }, [t.key]);
  const sc = list[Math.min(pick, list.length - 1)];
  const d1 = useLite(sc?.runs.day1?.replay).replay;
  const fin = useLite(sc?.runs.final?.replay).replay;
  const scales = useMemo(() => (d1 || fin ? traceScales([d1?.points ?? [], fin?.points ?? []]) : null), [d1, fin]);
  const h = hover ?? locked;
  if (!sc) {
    return (
      <Section id="failure">
        <SectionHead id="failure" n="03" kicker="Day-1 failure" title="Why it failed, from the trace">
          No showcase traces for Track {t.key} in this export.
        </SectionHead>
      </Section>
    );
  }
  const day1 = sc.runs.day1!;
  const first = (types: string[]) => day1.steps.find((s) => types.includes(s.type));
  const gas = first(["gas_feedback"]);
  const relays = first(["ufls"]);
  return (
    <Section id="failure">
      <SectionHead id="failure" n="03" kicker="Day-1 failure" title="Why it failed, from the trace">
        The same unseen storm, run once with the Day-1 notebook and once with the final frozen notebook. Every marker and line below is a logged step from the run
        {gas || relays ? (
          <>
            {"; on Day 1 the first "}
            {gas ? <>gas-supply feedback is logged at h{gas.h}</> : null}
            {gas && relays ? " and " : ""}
            {relays ? <>frequency relays trip at h{relays.h}</> : null}
          </>
        ) : null}
        .
      </SectionHead>
      <div className="s-toolbar">
        <Seg
          label="Storm"
          value={String(Math.min(pick, list.length - 1))}
          onChange={(v) => {
            setPick(Number(v));
            setLocked(null);
          }}
          options={list.map((s, i) => ({ v: String(i), label: `${stormName(s.scenario_id)} · seed ${s.seed ?? 0}` }))}
        />
        <div className="s-legend s-legend-sm">
          <span className="s-lg">
            <i className="s-mk-sw s-mk-ai" /> AI decision
          </span>
          <span className="s-lg">
            <i className="s-mk-sw s-mk-nb" /> Notebook (habit, limit, alarm)
          </span>
          <span className="s-lg">
            <i className="s-mk-sw s-mk-bad" /> Feedback, relays, false all-clear
          </span>
          <span className="s-lg">
            <i className="s-mk-sw s-mk-sim" /> Storm events
          </span>
          <span className="s-lg">
            <i className="s-line-sw" /> 59.4 Hz
          </span>
        </div>
      </div>
      <div className="s-sides">
        <Side t={t} run={day1} which="day1" sc={sc} hover={h} setHover={setHover} scales={scales} onPick={setLocked} />
        {sc.runs.final && <Side t={t} run={sc.runs.final} which="final" sc={sc} hover={h} setHover={setHover} scales={scales} onPick={setLocked} />}
      </div>
      <p className="s-caption">
        Both runs use the same storm, seed and scales. Repeated identical steps are merged (×n). Supply is the solid line, demand dashed. Percentages above 100% in raw
        verdicts are a simulator accounting artefact at total blackout and are shown as “all homes dark”.
      </p>
    </Section>
  );
}
