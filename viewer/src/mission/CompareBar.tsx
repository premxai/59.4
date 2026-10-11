// Control bar above the city: pick a storm (or make one), pick two notebooks, pick a seed, run live.
import { useEffect, useRef, useState } from "react";
import { API_BASE, isBestGuess, useCompare, type CatalogNotebook, type Where } from "./live";

const KIND_GROUPS: { kind: string; label: string }[] = [
  { kind: "unseen", label: "Unseen storms (the coach never saw these)" },
  { kind: "practice", label: "Practice storms (the coach learned from these)" },
  { kind: "calm", label: "Real calm cold days (no outages needed)" },
];

function useTicker(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function NotebookSelect({ value, onChange, notebooks, onOpen, label }: { value: string; onChange: (v: string) => void; notebooks: CatalogNotebook[]; onOpen: () => void; label: string }) {
  const tracks = [...new Set(notebooks.map((n) => n.track))].sort();
  return (
    <label className="mc-ctl">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} onMouseDown={onOpen} onFocus={onOpen}>
        {!notebooks.some((n) => n.id === value) && <option value={value}>{value || "pick a notebook"}</option>}
        {tracks.map((t) => (
          <optgroup key={t} label={`Track ${t}${t === "A" ? " · in-storm skill only" : t === "B" ? " · incl. winter prep" : ""}`}>
            {notebooks
              .filter((n) => n.track === t)
              .sort((a, b) => Number(isBestGuess(a)) - Number(isBestGuess(b)) || a.night - b.night)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label.replace(/^Track \w+ · /, "")}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function CompareBar() {
  const catalog = useCompare((s) => s.catalog);
  const catalogStatus = useCompare((s) => s.catalogStatus);
  const fetchCatalog = useCompare((s) => s.fetchCatalog);
  const sel = useCompare((s) => s.sel);
  const setSel = useCompare((s) => s.setSel);
  const status = useCompare((s) => s.status);
  const error = useCompare((s) => s.error);
  const start = useCompare((s) => s.start);
  const stop = useCompare((s) => s.stop);
  const startedAt = useCompare((s) => s.startedAt);
  const finishedAt = useCompare((s) => s.finishedAt);
  const storm = useCompare((s) => s.storm);
  const sides = useCompare((s) => s.sides);
  const showOffline = useCompare((s) => s.showOffline);
  const setShowOffline = useCompare((s) => s.setShowOffline);
  useCompare((s) => s.version);
  const running = status === "starting" || status === "streaming";
  useTicker(running);
  const lastFetch = useRef(0);
  const refresh = () => {
    if (Date.now() - lastFetch.current < 10_000) return;
    lastFetch.current = Date.now();
    fetchCatalog();
  };

  if (catalogStatus === "offline") {
    return (
      <div className="mc-cbar mc-cbar-offline">
        <span className="mc-cbar-warn">⚠ Live server offline</span>
        <span className="mc-dim">
          ({API_BASE}) · showing the <b>offline replay</b> recorded earlier. Start it with <code>.venv\Scripts\python scripts\live_server.py</code>
        </span>
        <button className="mc-btn" onClick={() => fetchCatalog()}>
          Retry
        </button>
      </div>
    );
  }
  if (!catalog) return <div className="mc-cbar mc-dim">Connecting to the live server…</div>;

  const s = catalog.storms.find((x) => x.id === sel.storm);
  const edge = sides ? Math.min(sides.left.replay.frames.length, sides.right.replay.frames.length) : 0;
  const c = sel.custom;
  const setC = (p: Partial<typeof c>) => setSel({ custom: { ...c, ...p } });
  return (
    <div className="mc-cbar-wrap">
      <div className="mc-cbar">
        <label className="mc-ctl mc-ctl-storm">
          <span>Storm</span>
          <select value={sel.storm} onChange={(e) => setSel({ storm: e.target.value })} onMouseDown={refresh} onFocus={refresh} disabled={running}>
            {!sel.storm && <option value="">pick a storm</option>}
            {KIND_GROUPS.map((g) => {
              const xs = catalog.storms.filter((x) => x.kind === g.kind);
              return xs.length ? (
                <optgroup key={g.kind} label={g.label}>
                  {xs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                      {x.source_year ? ` · ${x.source_year}` : ""}
                      {x.real_unmodified ? " · real" : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
            {catalog.storms.some((x) => !KIND_GROUPS.some((g) => g.kind === x.kind)) && (
              <optgroup label="Other">
                {catalog.storms
                  .filter((x) => !KIND_GROUPS.some((g) => g.kind === x.kind))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
              </optgroup>
            )}
            <option value="custom">⛈ Make your own storm…</option>
          </select>
        </label>
        <NotebookSelect label="Left notebook" value={sel.left} onChange={(v) => setSel({ left: v })} notebooks={catalog.notebooks} onOpen={refresh} />
        <span className="mc-vs">vs</span>
        <NotebookSelect label="Right notebook" value={sel.right} onChange={(v) => setSel({ right: v })} notebooks={catalog.notebooks} onOpen={refresh} />
        <div className="mc-ctl">
          <span>Seed</span>
          <div className="mc-seg">
            {[0, 1, 2].map((x) => (
              <button key={x} className={`mc-seg-btn ${sel.seed === x ? "mc-seg-on" : ""}`} onClick={() => setSel({ seed: x })} disabled={running} title="Which of the 3 random versions of the storm">
                {x}
              </button>
            ))}
          </div>
        </div>
        <label className="mc-check" title="Identical questions get identical answers (the AI runs at temperature 0), so earlier answers can be reused">
          <input type="checkbox" checked={sel.fast} onChange={(e) => setSel({ fast: e.target.checked })} disabled={running} /> fast
        </label>
        {running ? (
          <button className="mc-run mc-run-stop" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="mc-run" onClick={() => start()} disabled={!sel.storm || !sel.left || !sel.right || status === "loading_replays"}>
            {status === "loading_replays" ? "Loading replays…" : "▶ Run live"}
          </button>
        )}
        <div className="mc-cbar-status">
          {status === "starting" && <span className="mc-pulse">Starting…</span>}
          {status === "streaming" && (
            <span>
              <span className="mc-live-dot" /> LIVE · hour {Math.max(0, edge - 1)} · {startedAt ? fmtElapsed(Date.now() - startedAt) : ""}
              <span className="mc-dim"> · {sel.fast ? "reusing identical answers" : "AI asked live every hour"}</span>
            </span>
          )}
          {status === "done" && <span className="mc-good">Finished{startedAt && finishedAt ? ` in ${fmtElapsed(finishedAt - startedAt)}` : ""} · scrub below</span>}
          {status === "error" && <span className="mc-bad">{error}</span>}
          {status === "idle" && !showOffline && <span className="mc-dim">Pick a storm and two notebooks, then run them side by side.</span>}
          {!running && (
            <button className="mc-linkbtn" onClick={() => setShowOffline(!showOffline)}>
              {showOffline ? "back to live" : "offline replay"}
            </button>
          )}
        </div>
      </div>
      {sel.storm === "custom" ? (
        <div className="mc-custom">
          <span className="mc-custom-k">Your storm (based on Feb 2011):</span>
          <label>
            colder by <b>{c.colder_c}°C</b>
            <input type="range" min={0} max={9} step={0.5} value={c.colder_c} onChange={(e) => setC({ colder_c: Number(e.target.value) })} disabled={running} />
          </label>
          <label>
            lasts <b>{c.longer_x}×</b>
            <input type="range" min={1} max={3} step={0.25} value={c.longer_x} onChange={(e) => setC({ longer_x: Number(e.target.value) })} disabled={running} />
          </label>
          <label>
            where
            <select value={c.where} onChange={(e) => setC({ where: e.target.value as Where })} disabled={running}>
              {(["statewide", "west", "coast", "north"] as Where[]).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label>
            extra demand <b>+{Math.round(c.surge * 100)}%</b>
            <input type="range" min={0} max={0.1} step={0.01} value={c.surge} onChange={(e) => setC({ surge: Number(e.target.value) })} disabled={running} />
          </label>
          <label className="mc-check">
            <input type="checkbox" checked={c.freezing_rain} onChange={(e) => setC({ freezing_rain: e.target.checked })} disabled={running} /> freezing rain
          </label>
        </div>
      ) : (
        <div className="mc-cbar-desc">
          {(running || status === "done") && storm?.label ? <b>{storm.label}: </b> : s ? <b>{s.label}: </b> : null}
          {(running || status === "done") && storm?.description ? storm.description : s?.description}
          {s?.kind === "unseen" && <span className="mc-tag">never shown to the coach</span>}
          {s?.real_unmodified && <span className="mc-tag">real, unmodified weather</span>}
        </div>
      )}
    </div>
  );
}
