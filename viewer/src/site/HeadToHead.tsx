import { useEffect, useMemo, useState } from "react";
import { API_BASE, useCompare } from "../mission/live";
import type { HeldoutRun } from "../mission/types";
import { Ticks } from "./charts";
import { cleanVerdict, fmtHH, fmtSignedPct, pctChange, stormName, useSite, useTrackX, versionWhen, type TrackX, type Version } from "./data";
import type { LitePoint } from "./replays";
import { TraceChart, traceScales } from "./TraceChart";
import { Section, SectionHead } from "./ui";

function med(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Per-storm × per-seed runs for a version, from a learning day that scored it on 3 seeds. */
function detailOf(t: TrackX, v: Version | undefined): HeldoutRun[] | null {
  if (!v) return null;
  const g = [...t.base.generations].reverse().find((x) => x.harness_id === v.id && x.held_seeds.length >= 3);
  return g ? g.heldout : null;
}

function SeedCells({ runs }: { runs: HeldoutRun[] }) {
  return (
    <span className="s-ticks s-ticks-md">
      {[...runs]
        .sort((a, b) => a.seed - b.seed)
        .map((r) => (
          <i key={r.seed} className={`s-tick s-tick-${r.passed ? "pass" : "fail"}`} title={`seed ${r.seed}: ${cleanVerdict(r.verdict) || (r.passed ? "passed" : "failed")} · ${fmtHH(r.homes_dark_hours)} home-hours`} />
        ))}
    </span>
  );
}

function VersionSelect({ t, value, onChange, label }: { t: TrackX; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {t.versions.map((v) => (
        <option key={v.id} value={v.id}>
          {v.label} · {versionWhen(v)}
          {v.isFinal ? " · final" : v.isBest ? " · best" : ""}
          {detailOf(t, v) ? "" : " (majority only)"}
        </option>
      ))}
    </select>
  );
}

// ------------------------------------------------------------------ live compare (optional)
type LiveFrame = { h: number; freq_min_hz: number | null; freq_hz: number | null; demand_mw: number; supply_mw: number; reserve_mw: number; shed_frac: number; homes_dark: number; gas_supply_frac: number };
const toLite = (fr: LiveFrame[]): LitePoint[] =>
  fr.map((f) => ({ h: f.h, freq: f.freq_min_hz ?? f.freq_hz, demand: f.demand_mw, supply: f.supply_mw, reserve: f.reserve_mw, shedFrac: f.shed_frac, homesDark: f.homes_dark, gas: f.gas_supply_frac }));

function LiveCompare({ t }: { t: TrackX }) {
  const catalog = useCompare((s) => s.catalog);
  const cs = useCompare((s) => s.catalogStatus);
  const sel = useCompare((s) => s.sel);
  const status = useCompare((s) => s.status);
  const error = useCompare((s) => s.error);
  const sides = useCompare((s) => s.sides);
  const results = useCompare((s) => s.results);
  const labels = useCompare((s) => s.labels);
  useCompare((s) => s.version); // re-render as hours stream in
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    useCompare.getState().fetchCatalog();
  }, []);
  useEffect(() => {
    if (catalog && !useCompare.getState().userPicked) useCompare.getState().applyDefaults(t.key);
  }, [catalog, t.key]);

  const L = sides ? toLite(sides.left.replay.frames as unknown as LiveFrame[]) : [];
  const R = sides ? toLite(sides.right.replay.frames as unknown as LiveFrame[]) : [];
  const scales = traceScales([L, R]);
  const busy = status === "starting" || status === "streaming" || status === "loading_replays";
  const storms = catalog?.storms ?? [];
  const nbs = (catalog?.notebooks ?? []).filter((n) => n.track === t.key || !n.track);

  return (
    <div className="s-live">
      <div className="s-live-h">
        <h3 className="s-h3">Run it live</h3>
        <span className={`s-pill ${cs === "ok" ? "s-pill-ok" : cs === "loading" ? "" : "s-pill-off"}`}>
          <i />
          {cs === "ok" ? "live server connected" : cs === "loading" ? "connecting…" : "live server offline"}
        </span>
      </div>
      {cs !== "ok" ? (
        <p className="s-note">
          The live simulator server is not reachable at <code>{API_BASE}</code>. Start it with <code>.venv\Scripts\python scripts\live_server.py</code> to re-run any storm
          with any two notebook versions here; the table above is the recorded result.{" "}
          <button className="s-link" onClick={() => useCompare.getState().fetchCatalog()}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <div className="s-live-form">
            <label>
              <span>Storm</span>
              <select value={sel.storm} onChange={(e) => useCompare.getState().setSel({ storm: e.target.value })} disabled={busy}>
                {storms.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} {s.kind ? `· ${s.kind}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Left</span>
              <select value={sel.left} onChange={(e) => useCompare.getState().setSel({ left: e.target.value })} disabled={busy}>
                {nbs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Right</span>
              <select value={sel.right} onChange={(e) => useCompare.getState().setSel({ right: e.target.value })} disabled={busy}>
                {nbs.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Seed</span>
              <select value={sel.seed} onChange={(e) => useCompare.getState().setSel({ seed: Number(e.target.value) })} disabled={busy}>
                {[0, 1, 2].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="s-check">
              <input type="checkbox" checked={!sel.fast} onChange={(e) => useCompare.getState().setSel({ fast: !e.target.checked })} disabled={busy} />
              Ask the AI live for every decision (slower)
            </label>
            {busy ? (
              <button className="s-btn" onClick={() => useCompare.getState().stop()}>
                Stop
              </button>
            ) : (
              <button className="s-btn s-btn-primary" onClick={() => useCompare.getState().start()} disabled={!sel.storm || !sel.left || !sel.right}>
                Run both
              </button>
            )}
          </div>
          {status === "error" && error && <p className="s-note s-bad-t">{error}</p>}
          {sides && (
            <div className="s-sides">
              {(["left", "right"] as const).map((k) => {
                const pts = k === "left" ? L : R;
                const res = results?.[k];
                return (
                  <div key={k} className="s-side">
                    <div className="s-side-h">
                      <div className="s-kicker">{k === "left" ? "Left" : "Right"}</div>
                      <div className="s-side-title">{labels[k]}</div>
                      {res ? (
                        <div className={`s-verdict ${res.passed ? "s-ok" : "s-bad"}`}>
                          <span className="s-verdict-dot" />
                          {cleanVerdict(res.verdict) || (res.passed ? "Passed" : "Failed")} · {fmtHH(res.homes_dark_hours)} home-hours
                        </div>
                      ) : (
                        <div className="s-side-meta">
                          {status === "streaming" ? `streaming · hour ${pts.length ? pts[pts.length - 1].h : 0}` : status}
                        </div>
                      )}
                    </div>
                    <TraceChart series={[{ key: k, label: k, color: k === "left" ? "var(--bad)" : "var(--accent)", points: pts }]} scales={scales} hover={hover} onHover={setHover} ariaLabel={`Live ${k} run`} showPower={false} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ section
export function HeadToHead() {
  const t = useTrackX()!;
  const data = useSite((s) => s.data)!;
  const [lId, setL] = useState<string | null>(null);
  const [rId, setR] = useState<string | null>(null);
  useEffect(() => {
    setL(null);
    setR(null);
  }, [t.key]);
  const left = t.versions.find((v) => v.id === lId) ?? t.v1!;
  const right = t.versions.find((v) => v.id === rId) ?? t.final!;
  const dl = detailOf(t, left);
  const dr = detailOf(t, right);

  const rows = useMemo(
    () =>
      data.heldout.map((sid, i) => {
        const lr = dl?.filter((r) => r.scenario_id === sid) ?? null;
        const rr = dr?.filter((r) => r.scenario_id === sid) ?? null;
        const lm = lr ? med(lr.map((r) => r.homes_dark_hours ?? 0)) : null;
        const rm = rr ? med(rr.map((r) => r.homes_dark_hours ?? 0)) : null;
        return { sid, i, lr, rr, lm, rm, lt: [...(left.score?.ticks ?? "")][i], rt: [...(right.score?.ticks ?? "")][i] };
      }),
    [data.heldout, dl, dr, left, right],
  );
  const seedTotal = (v: Version) => Object.values(v.score?.bySeed ?? {}).reduce((a, b) => a + (b.passed ?? 0), 0);

  return (
    <Section id="h2h">
      <SectionHead id="h2h" n="05" kicker="v1 vs final" title="Head to head, storm by storm">
        The 8 unseen storms, 3 seeds each. A storm counts as passed when at least 2 of its 3 seeds pass. Pick any two versions.
      </SectionHead>
      <div className="s-toolbar">
        <div className="s-diffpick">
          <VersionSelect t={t} value={left.id} onChange={setL} label="Left version" />
          <span className="s-dim">vs</span>
          <VersionSelect t={t} value={right.id} onChange={setR} label="Right version" />
        </div>
        <div className="s-dim s-small">
          Hover a square for that seed's verdict. {(!dl || !dr) && "Versions marked “majority only” were re-scored on all 3 seeds, but only per-storm majorities were exported."}
        </div>
      </div>
      <table className="s-table s-h2h">
        <thead>
          <tr>
            <th>Unseen storm</th>
            <th>
              {left.label} <span className="s-dim">seeds 0 1 2</span>
            </th>
            <th className="r">{left.label} home-hours</th>
            <th>
              {right.label} <span className="s-dim">seeds 0 1 2</span>
            </th>
            <th className="r">{right.label} home-hours</th>
            <th className="r">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ch = pctChange(r.lm, r.rm);
            return (
              <tr key={r.sid}>
                <td>
                  {stormName(r.sid)}
                  <span className={`s-maj ${r.lt === "✓" ? "pass" : ""}`} title={`${left.label}: ${r.lt === "✓" ? "passed" : "failed"} (majority)`} />
                  <span className="s-dim"> → </span>
                  <span className={`s-maj ${r.rt === "✓" ? "pass" : ""}`} title={`${right.label}: ${r.rt === "✓" ? "passed" : "failed"} (majority)`} />
                </td>
                <td>{r.lr ? <SeedCells runs={r.lr} /> : <Ticks ticks={r.lt} />}</td>
                <td className="r num">{fmtHH(r.lm)}</td>
                <td>{r.rr ? <SeedCells runs={r.rr} /> : <Ticks ticks={r.rt} />}</td>
                <td className="r num">{fmtHH(r.rm)}</td>
                <td className={`r num ${ch != null && ch < 0 ? "s-acc-t" : ch != null && ch > 0 ? "s-bad-t" : ""}`}>{fmtSignedPct(ch)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Storms passed (majority)</td>
            <td colSpan={2} className="num">
              <b>{left.score?.majority ?? "–"} / 8</b> <span className="s-dim">· {seedTotal(left)} of 24 seed runs</span>
            </td>
            <td colSpan={2} className="num">
              <b>{right.score?.majority ?? "–"} / 8</b> <span className="s-dim">· {seedTotal(right)} of 24 seed runs</span>
            </td>
            <td className="r num">{fmtSignedPct(pctChange(left.score?.hhMedian, right.score?.hhMedian))}</td>
          </tr>
        </tfoot>
      </table>
      <p className="s-caption">
        Per-storm home-hours = median over the 3 seeds. Change in the footer = median total home-hours over all 8 storms ({fmtHH(left.score?.hhMedian)} → {fmtHH(right.score?.hhMedian)}).
      </p>
      <LiveCompare t={t} />
    </Section>
  );
}
