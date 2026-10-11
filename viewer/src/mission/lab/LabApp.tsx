// Live lab (?mode=mission): pick a storm, pick two notebooks, run them side by side live on the locked
// simulator, watch at a readable pace, get a verified result. The evolution story lives on the Evidence site.
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { LiveResult, Side, Where } from "../live";
import { useCompare, useErcot } from "../live";
import {
  buildFeed,
  cleanVerdict,
  fmtHH,
  fmtHz,
  fmtPct,
  kpisUpTo,
  notebookOpts,
  shortHash,
  unseenStorms,
  type FeedItem,
  type NotebookOpt,
  type Raw,
  type Score,
} from "./labData";
import "./lab.css";

type Theme = "light" | "dark";
type View = "charts" | "3d";
const Lab3D = lazy(() => import("./Lab3D"));

function initialView(): View {
  try {
    return localStorage.getItem("lab-view") === "3d" ? "3d" : "charts";
  } catch {
    return "charts";
  }
}
const SPEEDS = [2, 4, 8, 16];
const SIDES: Side[] = ["left", "right"];

function initialTheme(): Theme {
  const p = new URLSearchParams(location.search).get("theme");
  if (p === "dark" || p === "light") return p;
  try {
    const s = localStorage.getItem("site-theme");
    if (s === "dark" || s === "light") return s;
  } catch {
    /* storage blocked */
  }
  return "light";
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function useScores(): Record<string, Score[]> {
  const [s, setS] = useState<Record<string, Score[]>>({});
  useEffect(() => {
    let alive = true;
    fetch("/mission/594_mission.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { tracks?: Record<string, { final_scores?: Score[] }> } | null) => {
        if (!alive || !j?.tracks) return;
        const out: Record<string, Score[]> = {};
        for (const [t, v] of Object.entries(j.tracks)) out[t] = (v.final_scores ?? []).map((x) => ({ id: x.id, majority_passed: x.majority_passed, hh_median: x.hh_median }));
        setS(out);
      })
      .catch(() => {
        /* scores are optional decoration */
      });
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

// ------------------------------------------------------------------ top bar
function TopBar({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const ercot = useErcot();
  return (
    <header className="lab-top">
      <div className="lab-top-in">
        <a className="lab-word" href="?mode=mission">
          59.4 <span className="lab-word-sub">· Live lab</span>
        </a>
        <nav className="lab-nav">
          <a href="?mode=stage">Stage</a>
          <a href="?mode=site">Evidence</a>
        </nav>
        <div className="lab-top-right">
          {ercot && typeof ercot.frequency_hz === "number" && (
            <span className="lab-ercot" title={`Public ERCOT data${ercot.updated ? ` · ${ercot.updated}` : ""}`}>
              <i className="lab-dot" />
              Texas right now · {ercot.frequency_hz.toFixed(3)} Hz
              {typeof ercot.demand_mw === "number" ? ` · ${(ercot.demand_mw / 1000).toFixed(1)} GW` : ""}
              {ercot.stale ? " · stale" : ""}
            </span>
          )}
          <button className="lab-icon" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Theme">
            {theme === "light" ? "◐" : "◑"}
          </button>
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ setup row
function StormStep({ disabled }: { disabled: boolean }) {
  const catalog = useCompare((s) => s.catalog);
  const sel = useCompare((s) => s.sel);
  const setSel = useCompare((s) => s.setSel);
  const storms = useMemo(() => unseenStorms(catalog), [catalog]);
  const cur = storms.find((s) => s.id === sel.storm);
  const c = sel.custom;
  const setC = (p: Partial<typeof c>) => setSel({ custom: { ...c, ...p } });
  return (
    <section className="lab-step">
      <div className="lab-step-h">
        <span className="lab-step-n">1</span> Storm
      </div>
      <select className="lab-select" value={sel.storm} disabled={disabled} onChange={(e) => setSel({ storm: e.target.value })} aria-label="Storm">
        {storms.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {s.source_year ? ` · ${s.source_year}` : ""}
          </option>
        ))}
        <option value="custom">Build your own storm</option>
      </select>
      {sel.storm !== "custom" ? (
        <p className="lab-step-note">
          {cur ? (
            <>
              <span className="lab-tag">Real {cur.source_year ?? ""} cold wave, made harder</span>
              <span className="lab-desc" title={cur.description}>
                {cur.description}
              </span>
            </>
          ) : (
            <span className="lab-dim">Unseen storms: never used while the notebook was learning.</span>
          )}
        </p>
      ) : (
        <div className="lab-custom">
          <label>
            <span>Colder</span>
            <input type="range" min={0} max={9} step={0.5} value={c.colder_c} disabled={disabled} onChange={(e) => setC({ colder_c: Number(e.target.value) })} />
            <b className="num">{c.colder_c.toFixed(1)} °C</b>
          </label>
          <label>
            <span>Longer</span>
            <input type="range" min={1} max={3} step={0.25} value={c.longer_x} disabled={disabled} onChange={(e) => setC({ longer_x: Number(e.target.value) })} />
            <b className="num">{c.longer_x.toFixed(2)}×</b>
          </label>
          <label title="Demand surge">
            <span>Demand</span>
            <input type="range" min={0} max={0.1} step={0.01} value={c.surge} disabled={disabled} onChange={(e) => setC({ surge: Number(e.target.value) })} />
            <b className="num">+{Math.round(c.surge * 100)}%</b>
          </label>
          <label className="lab-where">
            <span>Where</span>
            <select className="lab-select lab-select-sm" value={c.where} disabled={disabled} onChange={(e) => setC({ where: e.target.value as Where })}>
              <option value="statewide">Statewide</option>
              <option value="west">West Texas</option>
              <option value="coast">Gulf Coast</option>
              <option value="north">North Texas</option>
            </select>
          </label>
          <label className="lab-check">
            <input type="checkbox" checked={c.freezing_rain} disabled={disabled} onChange={(e) => setC({ freezing_rain: e.target.checked })} />
            <span>Freezing rain</span>
          </label>
          <p className="lab-dim lab-custom-note">Built on the real February 2011 cold wave.</p>
        </div>
      )}
    </section>
  );
}

function NotebookStep({ track, setTrack, opts, disabled }: { track: string; setTrack: (t: string) => void; opts: NotebookOpt[]; disabled: boolean }) {
  const sel = useCompare((s) => s.sel);
  const setSel = useCompare((s) => s.setSel);
  const pick = (side: Side) => (
    <label className="lab-nb">
      <span className="lab-nb-side">{side === "left" ? "Left" : "Right"}</span>
      <select className="lab-select" value={sel[side]} disabled={disabled} onChange={(e) => setSel({ [side]: e.target.value })} aria-label={`${side} notebook`}>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.option}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="lab-step">
      <div className="lab-step-h">
        <span className="lab-step-n">2</span> Notebooks
        <div className="lab-seg lab-seg-right" role="group" aria-label="Track">
          {["A", "B"].map((t) => (
            <button key={t} className={track === t ? "on" : ""} disabled={disabled} onClick={() => setTrack(t)} title={t === "A" ? "Track A: may change only in-storm behavior" : "Track B: may also change winter prep"}>
              Track {t}
            </button>
          ))}
        </div>
      </div>
      {pick("left")}
      {pick("right")}
      <p className="lab-step-note lab-dim">{track === "A" ? "Track A changed only in-storm behavior." : "Track B could also change winter prep."} Same frozen AI on both sides.</p>
    </section>
  );
}

function RunStep({ busy, onRun }: { busy: boolean; onRun: () => void }) {
  const sel = useCompare((s) => s.sel);
  const setSel = useCompare((s) => s.setSel);
  const status = useCompare((s) => s.status);
  const stop = useCompare((s) => s.stop);
  const ready = !!sel.left && !!sel.right && !!sel.storm;
  return (
    <section className="lab-step">
      <div className="lab-step-h">
        <span className="lab-step-n">3</span> Run
        <div className="lab-seed" role="group" aria-label="Seed">
          <span className="lab-dim">seed</span>
          {[0, 1, 2].map((s) => (
            <button key={s} className={sel.seed === s ? "on" : ""} disabled={busy} onClick={() => setSel({ seed: s })}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-modes" role="radiogroup" aria-label="AI answers">
        <label className={sel.fast ? "on" : ""}>
          <input type="radio" name="fresh" checked={sel.fast} disabled={busy} onChange={() => setSel({ fast: true })} />
          <span>
            Reuse identical AI answers <span className="lab-dim">(fast)</span>
          </span>
        </label>
        <label className={!sel.fast ? "on" : ""}>
          <input type="radio" name="fresh" checked={!sel.fast} disabled={busy} onChange={() => setSel({ fast: false })} />
          <span>
            Ask the AI fresh <span className="lab-dim">(slow)</span>
          </span>
        </label>
      </div>
      <p className="lab-mode-note lab-dim">
        {sel.fast
          ? "Same answers the AI gave to the exact same question · ~10–20 s, or instant if run before"
          : "Real Qwen3-30B calls, up to ~100 per side · often several minutes"}
      </p>
      <div className="lab-run-row">
        <button className="lab-btn lab-btn-primary" disabled={!ready || busy} onClick={onRun}>
          {status === "starting" ? "Starting…" : busy ? "Running…" : "Run side by side"}
        </button>
        {busy && (
          <button className="lab-link" onClick={stop}>
            Stop
          </button>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ charts
function DarkChart({ raw, ph, domain }: { raw: Raw[]; ph: number; domain: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const H = 150;
  const FH = 40;
  const padL = 36;
  const padR = 8;
  const iw = Math.max(10, w - padL - padR);
  const x = (h: number) => padL + (h / Math.max(1, domain)) * iw;
  const y = (f: number) => 8 + (1 - Math.min(1, Math.max(0, f))) * (H - 26);
  const fy = (hz: number) => {
    const v = Math.min(60.05, Math.max(59.0, hz));
    return 4 + ((60.05 - v) / 1.05) * (FH - 10);
  };
  let line = "";
  let area = "";
  let fline = "";
  let last = -1;
  for (let h = 0; h <= ph && h < raw.length; h++) {
    const m = raw[h];
    if (!m) continue;
    const f = typeof m.shed_frac === "number" ? m.shed_frac : 0;
    const hz = typeof m.freq_min_hz === "number" ? m.freq_min_hz : 60;
    line += `${line ? "L" : "M"}${x(h).toFixed(1)},${y(f).toFixed(1)}`;
    fline += `${fline ? "L" : "M"}${x(h).toFixed(1)},${fy(hz).toFixed(1)}`;
    last = h;
  }
  if (last >= 0) area = `${line}L${x(last).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
  const days: number[] = [];
  for (let d = 24; d < domain; d += 24) days.push(d);
  const lastRaw = last >= 0 ? raw[last] : undefined;
  const curF = typeof lastRaw?.shed_frac === "number" ? lastRaw.shed_frac : 0;
  return (
    <div className="lab-chart" ref={ref}>
      {w > 0 && (
        <>
          <svg width={w} height={H} role="img" aria-label="Percent of homes dark over the storm">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "lab-axis" : "lab-grid"} />
                <text x={padL - 6} y={y(t) + 4} className="lab-tick" textAnchor="end">
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}
            {days.map((d) => (
              <text key={d} x={x(d)} y={H - 4} className="lab-tick" textAnchor="middle">
                day {d / 24 + 1}
              </text>
            ))}
            <text x={x(0)} y={H - 4} className="lab-tick" textAnchor="start">
              h0
            </text>
            {area && <path d={area} className="lab-area" />}
            {line && <path d={line} className="lab-line" />}
            {last >= 0 && (
              <>
                <line x1={x(last)} x2={x(last)} y1={6} y2={y(0)} className="lab-cursor" />
                <circle cx={x(last)} cy={y(curF)} r={3.5} className="lab-dot-bad" />
              </>
            )}
          </svg>
          <svg width={w} height={FH} role="img" aria-label="Lowest grid frequency each hour" className="lab-freq">
            <line x1={padL} x2={w - padR} y1={fy(59.4)} y2={fy(59.4)} className="lab-594" />
            <text x={padL - 6} y={fy(59.4) + 4} className="lab-tick lab-tick-bad" textAnchor="end">
              59.4
            </text>
            <text x={padL - 6} y={fy(60) + 4} className="lab-tick" textAnchor="end">
              60
            </text>
            {fline && <path d={fline} className="lab-fline" />}
            {last >= 0 && <line x1={x(last)} x2={x(last)} y1={2} y2={FH - 2} className="lab-cursor" />}
          </svg>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ feed
const KIND_LABEL: Record<FeedItem["kind"], string> = {
  ai: "AI",
  cut: "Cut",
  restore: "Restore",
  clear: "Restore",
  gas: "Gas",
  alarm: "Alarm",
  limit: "Rule",
  collapse: "Collapse",
};

function Feed({ items }: { items: FeedItem[] }) {
  return (
    <div className="lab-feed" aria-live="polite">
      {items.length === 0 && <p className="lab-feed-empty lab-dim">Decisions appear here as the storm plays: cuts, restores, gas protection, alarms.</p>}
      <ol>
        {items.map((it) => (
          <li key={it.key} className={`lab-fi lab-fi-${it.kind}`}>
            <span className="lab-fi-h num">h{it.h}</span>
            <span className="lab-fi-k">{KIND_LABEL[it.kind]}</span>
            <span className="lab-fi-t">
              {it.text}
              {it.sub && <span className="lab-fi-sub">{it.sub}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ one column
function Column({ side, opt, label, raw, ph, domain, result, revealed, compact }: { side: Side; opt?: NotebookOpt; label: string; raw: Raw[]; ph: number; domain: number; result?: LiveResult; revealed: boolean; compact?: boolean }) {
  const k = useMemo(() => kpisUpTo(raw, ph), [raw, ph, raw.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const feed = useMemo(() => buildFeed(raw, ph), [raw, ph, raw.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <article className={`lab-col lab-col-${side}`}>
      {!compact && (
        <>
      <header className="lab-col-h">
        <div>
          <div className="lab-col-title">{opt?.title ?? label}</div>
          <div className="lab-col-meta lab-dim">
            {side === "left" ? "Left" : "Right"} notebook{opt?.hash ? <> · <code>{shortHash(opt.hash)}</code></> : null}
            {opt?.score ? ` · ${opt.score.majority_passed}/8 unseen storms passed in testing` : ""}
          </div>
        </div>
        <div className="lab-col-now num">
          <b>{fmtPct(k.nowFrac)}</b>
          <span className="lab-dim">dark now</span>
        </div>
      </header>
      <DarkChart raw={raw} ph={ph} domain={domain} />
        </>
      )}
      {revealed && result ? (
        <ResultCard r={result} />
      ) : (
        <div className="lab-kpis">
          <div>
            <span className="lab-kpi-l">Worst hour dark</span>
            <b className="num">{fmtPct(k.worst)}</b>
            <span className="lab-kpi-s lab-dim">{k.worst > 0 ? `at h${k.worstH}` : "so far"}</span>
          </div>
          <div>
            <span className="lab-kpi-l">Home-hours so far</span>
            <b className="num">{fmtHH(k.homeHours)}</b>
            <span className="lab-kpi-s lab-dim">in the dark</span>
          </div>
          <div>
            <span className="lab-kpi-l">Lowest frequency</span>
            <b className={`num ${k.lowHz < 59.4 ? "lab-bad" : ""}`}>{fmtHz(k.lowHz, k.collapsed)}</b>
            <span className="lab-kpi-s lab-dim">{k.lowHz < 59.4 ? "below 59.4 Hz" : "safe limit 59.4 Hz"}</span>
          </div>
        </div>
      )}
      <Feed items={feed} />
    </article>
  );
}

function ResultCard({ r }: { r: LiveResult }) {
  const passed = !!r.passed;
  return (
    <div className={`lab-result ${passed ? "pass" : "fail"}`}>
      <div className="lab-result-v">
        <span className={`lab-pill ${passed ? "pass" : "fail"}`}>{passed ? "Passed" : "Failed"}</span>
        <span className="lab-result-txt">{cleanVerdict(r.verdict).replace(/^(Passed|Failed):\s*/, "")}</span>
      </div>
      <dl>
        <div>
          <dt>Home-hours dark</dt>
          <dd className="num">{fmtHH(r.homes_dark_hours)}</dd>
        </div>
        <div>
          <dt>Worst hour</dt>
          <dd className="num">{fmtPct(r.peak_shed_frac)}</dd>
        </div>
        <div>
          <dt>Lowest Hz</dt>
          <dd className="num">{fmtHz(r.min_freq, r.collapsed)}</dd>
        </div>
        <div>
          <dt>Collapse</dt>
          <dd>{r.collapsed ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>AI calls</dt>
          <dd className="num">{r.ai_calls ?? "–"}</dd>
        </div>
      </dl>
    </div>
  );
}

function comparison(results: Partial<Record<Side, LiveResult>>, names: Record<Side, string>): { text: string; sub: string } | null {
  const L = results.left;
  const R = results.right;
  if (!L || !R) return null;
  const lh = L.homes_dark_hours ?? 0;
  const rh = R.homes_dark_hours ?? 0;
  const passTxt = `${names.left}: ${L.passed ? "passed" : "failed"} · ${names.right}: ${R.passed ? "passed" : "failed"}`;
  if (Math.abs(lh - rh) < 1e-6 * Math.max(1, lh, rh)) return { text: "Both notebooks left the same number of homes in the dark.", sub: passTxt };
  const [win, lose, wh, lhh] = rh < lh ? ([names.right, names.left, rh, lh] as const) : ([names.left, names.right, lh, rh] as const);
  const pct = lhh > 0 ? Math.round(((lhh - wh) / lhh) * 100) : 0;
  return { text: `${win}: ${pct >= 100 ? "no" : `${pct}% fewer`} home-hours in the dark than ${lose}.`, sub: passTxt };
}

// ------------------------------------------------------------------ app
export function LabApp() {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("site-theme", t);
    } catch {
      /* storage blocked */
    }
  };
  const catalog = useCompare((s) => s.catalog);
  const catalogStatus = useCompare((s) => s.catalogStatus);
  const fetchCatalog = useCompare((s) => s.fetchCatalog);
  const sel = useCompare((s) => s.sel);
  const setSel = useCompare((s) => s.setSel);
  const status = useCompare((s) => s.status);
  const error = useCompare((s) => s.error);
  const sides = useCompare((s) => s.sides);
  const results = useCompare((s) => s.results);
  const labels = useCompare((s) => s.labels);
  const storm = useCompare((s) => s.storm);
  const runId = useCompare((s) => s.runId);
  const replayed = useCompare((s) => s.replayed);
  const store = useCompare((s) => s.store);
  useCompare((s) => s.version); // re-render as hours stream in
  const start = useCompare((s) => s.start);
  const scores = useScores();

  const [track, setTrack] = useState("B");
  const [ranWith, setRanWith] = useState<Record<Side, NotebookOpt | undefined>>({ left: undefined, right: undefined });
  const [ranFast, setRanFast] = useState(true);
  const [ranSeed, setRanSeed] = useState(0);
  const opts = useMemo(() => notebookOpts(catalog, track, scores), [catalog, track, scores]);

  useEffect(() => {
    document.title = "59.4 · Live lab";
    fetchCatalog();
    if (!useCompare.getState().sel.fast) setSel({ fast: true }, false);
  }, [fetchCatalog, setSel]);

  // defaults: first unseen storm, Day-1 notebook vs the track's final frozen notebook
  useEffect(() => {
    if (!catalog || !opts.length) return;
    const s = useCompare.getState().sel;
    const storms = unseenStorms(catalog);
    const p: Partial<typeof s> = {};
    if (s.storm !== "custom" && !storms.some((x) => x.id === s.storm)) p.storm = storms[0]?.id ?? "custom";
    if (!opts.some((o) => o.id === s.left)) p.left = opts[0].id;
    if (!opts.some((o) => o.id === s.right)) p.right = (opts.find((o) => o.final) ?? opts[opts.length - 1]).id;
    if (Object.keys(p).length) setSel(p, false);
  }, [catalog, opts, setSel]);

  const changeTrack = (t: string) => {
    setTrack(t);
    const o = notebookOpts(catalog, t, scores);
    if (o.length) setSel({ left: o[0].id, right: (o.find((x) => x.final) ?? o[o.length - 1]).id });
  };

  // ---------------------------------------------------------------- buffered playback
  const streaming = status === "starting" || status === "streaming";
  const streamDone = status === "loading_replays" || status === "done";
  const rawL = sides?.left.raw ?? [];
  const rawR = sides?.right.raw ?? [];
  const computed = sides ? Math.min(rawL.length, rawR.length) : 0; // hours computed on both sides
  const total = sides ? Math.max(rawL.length, rawR.length) : 0;
  const edge = Math.max(0, (streamDone ? total : computed) - 1);
  const domain = Math.max(167, total - 1);

  const [ph, setPh] = useState(0);
  const [speed, setSpeed] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem("lab-view", v);
    } catch {
      /* storage blocked */
    }
  };
  const phRef = useRef(0);
  const edgeRef = useRef(edge);
  edgeRef.current = edge;
  const doneRef = useRef(streamDone);
  doneRef.current = streamDone;

  useEffect(() => {
    phRef.current = 0;
    setPh(0);
    setRevealed(false);
    setPlaying(!!runId);
  }, [runId]);

  useEffect(() => {
    if (!playing) return;
    // a timer (not rAF) so playback keeps its pace even when the tab is briefly hidden
    let t0 = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now();
      const dt = Math.min(1, (t - t0) / 1000);
      t0 = t;
      const next = Math.min(edgeRef.current, phRef.current + dt * speed);
      phRef.current = next;
      const hi = Math.floor(next);
      setPh((p) => (p === hi ? p : hi));
      if (doneRef.current && next >= edgeRef.current) {
        setPlaying(false);
        setRevealed(true);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, [playing, speed]);

  // space = play / pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (e.code === "Space" && sides) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const atEnd = streamDone && ph >= edge;
  const togglePlay = () => {
    if (atEnd) {
      phRef.current = 0;
      setPh(0);
    }
    setPlaying((p) => !p);
  };
  const scrub = (h: number) => {
    phRef.current = h;
    setPh(h);
  };
  const waiting = playing && !streamDone && ph >= computed - 1;

  const colOpt: Record<Side, NotebookOpt | undefined> = { left: ranWith.left, right: ranWith.right };
  const names: Record<Side, string> = { left: colOpt.left?.short ?? "Left", right: colOpt.right?.short ?? "Right" };
  const cmp = results ? comparison(results, names) : null;

  return (
    <div className={`lab lab-${theme}`}>
      <TopBar theme={theme} setTheme={setTheme} />
      <main className="lab-main">
        {catalogStatus === "offline" && !catalog && (
          <div className="lab-banner">
            The live server is not reachable. Start it with <code>.venv\Scripts\python scripts\live_server.py</code>, then{" "}
            <button className="lab-link" onClick={() => fetchCatalog()}>
              retry
            </button>
            .
          </div>
        )}
        <div className="lab-setup">
          <StormStep disabled={streaming} />
          <NotebookStep track={track} setTrack={changeTrack} opts={opts} disabled={streaming} />
          <RunStep
            busy={streaming}
            onRun={() => {
              setRanWith({ left: opts.find((o) => o.id === sel.left), right: opts.find((o) => o.id === sel.right) });
              setRanFast(sel.fast);
              setRanSeed(sel.seed);
              start();
            }}
          />
        </div>

        {error && status === "error" && <div className="lab-banner lab-banner-bad">The run stopped: {error}</div>}

        {sides ? (
          <section className="lab-run">
            <div className="lab-bar">
              <button className="lab-btn lab-btn-sm" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? "Pause" : atEnd ? "Replay" : "Play"}
              </button>
              <div className="lab-seg" role="group" aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)} title={`${s} storm-hours per second`}>
                    {s}×
                  </button>
                ))}
              </div>
              <div className="lab-seg" role="group" aria-label="View">
                <button className={view === "charts" ? "on" : ""} onClick={() => setView("charts")}>
                  Charts
                </button>
                <button className={view === "3d" ? "on" : ""} onClick={() => setView("3d")}>
                  3D
                </button>
              </div>
              <input
                className="lab-scrub"
                type="range"
                min={0}
                max={Math.max(0, edge)}
                value={Math.min(ph, edge)}
                disabled={!streamDone}
                onChange={(e) => {
                  setPlaying(false);
                  scrub(Number(e.target.value));
                }}
                aria-label="Storm hour"
                title={streamDone ? "Scrub the storm" : "Scrubbing unlocks when the run is done"}
              />
              <span className="lab-hour num">
                Storm hour <b>{ph}</b>
                <span className="lab-dim"> / {streamDone ? edge : `${Math.max(0, computed - 1)} computed`}</span>
              </span>
              {streamDone && !revealed && (
                <button className="lab-link" onClick={() => { setPlaying(false); scrub(edge); setRevealed(true); }}>
                  Skip to result
                </button>
              )}
            </div>
            <div className="lab-storm-line">
              <span>
                <b>{storm?.label ?? "Storm"}</b>
                {storm?.description ? <span className="lab-dim"> · {storm.description}</span> : null}
              </span>
              <span className="lab-dim lab-status">
                {status === "starting" && "Starting the run…"}
                {waiting && (
                  <>
                    <i className="lab-pulse" /> Waiting for the AI · hour {Math.max(0, computed - 1)} computed
                  </>
                )}
                {!waiting && status === "streaming" && (replayed ? "Replaying an identical earlier run (same notebooks, same storm, same seed)" : `${ranFast ? "Reusing identical AI answers" : "Asking the AI live"} · ${Math.max(0, computed - 1)} hours computed`)}
                {streamDone && (replayed ? "Identical earlier run (same notebooks, storm, seed), replayed · checked by the locked simulator" : "Run complete · checked by the locked simulator")}
              </span>
            </div>
            {revealed && cmp && (
              <div className="lab-verdict">
                <p className="lab-verdict-t">{cmp.text}</p>
                <p className="lab-verdict-s lab-dim">
                  {cmp.sub} · seed {ranSeed} · checked by the locked simulator
                </p>
              </div>
            )}
            {view === "3d" && (
              <Suspense fallback={<div className="lab-3d lab-3d-loading lab-dim">Loading the 3D view…</div>}>
                <Lab3D
                  raw={{ left: rawL, right: rawR }}
                  ph={ph}
                  done={revealed}
                  labels={{
                    left: { title: colOpt.left?.title ?? labels.left, sub: colOpt.left?.hash ? `Left notebook · ${shortHash(colOpt.left.hash)}` : "Left notebook" },
                    right: { title: colOpt.right?.title ?? labels.right, sub: colOpt.right?.hash ? `Right notebook · ${shortHash(colOpt.right.hash)}` : "Right notebook" },
                  }}
                />
              </Suspense>
            )}
            <div className={`lab-cols${revealed ? " lab-cols-done" : ""}${view === "3d" ? " lab-cols-3d" : ""}`}>
              {SIDES.map((s) => (
                <Column key={s} side={s} opt={colOpt[s]} label={labels[s]} raw={s === "left" ? rawL : rawR} ph={ph} domain={domain} result={results?.[s]} revealed={revealed} compact={view === "3d"} />
              ))}
            </div>
          </section>
        ) : (
          <section className="lab-empty">
            <p className="lab-empty-t">{status === "starting" ? "Starting the run…" : "Pick a storm and two notebooks, then run them side by side."}</p>
            <p className="lab-dim">
              Both sides use the same frozen AI (Qwen3-30B, never retrained) on the same locked simulator. Only the notebook differs. Every hour is computed live and played back at a readable pace.
            </p>
          </section>
        )}
        <footer className="lab-foot">
          <a href="?mode=site" className="lab-link">
            How it learned → Evidence
          </a>
          {store && <span className="lab-dim lab-store">Notebook memory read from: {store}</span>}
        </footer>
      </main>
    </div>
  );
}
