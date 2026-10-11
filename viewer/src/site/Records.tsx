// Record inspector: any item that comes from a stored record (MongoDB Atlas or the run-cache files)
// gets a small "record" button; the drawer shows the exact exported JSON and can fetch the live document.
import { useEffect, useState, type ReactNode } from "react";
import { API_BASE } from "../mission/live";
import { rawRecord, recordSrc, useSite, type RecordSrc } from "./data";

const params = new URLSearchParams(location.search);
/** ?records=all shows the button even before the exporter writes `_src` (for checking the drawer). */
const SHOW_ALL = params.get("records") === "all";

export function hasRecord(o: object | null | undefined): boolean {
  const raw = rawRecord(o);
  return raw !== undefined && (SHOW_ALL || !!recordSrc(o));
}

/** Open the drawer for an object when it has a stored record (used by chart hit areas). */
export function openIfRecord(o: object | null | undefined, title: string) {
  if (!hasRecord(o)) return;
  useSite.getState().openRecord(title, rawRecord(o), recordSrc(o));
}

/** Small "record" affordance. Pass the normalized object(s); hidden unless the raw record carries `_src`. */
export function RecordButton({ of, title, className }: { of: object | object[] | null | undefined; title: string; className?: string }) {
  const objs = (Array.isArray(of) ? of : of ? [of] : []).filter(Boolean);
  const withRaw = objs.filter((o) => rawRecord(o) !== undefined);
  const raws = withRaw.map((o) => rawRecord(o));
  if (!raws.length) return null;
  const src = recordSrc(withRaw[0]);
  if (!src && !SHOW_ALL) return null;
  return (
    <button
      type="button"
      className={`s-rec ${className ?? ""}`}
      title={src ? `${src.db === "file" ? "Run cache file" : `MongoDB Atlas · ${src.db}.${src.coll}`} · ${src.id}` : "Exported record"}
      aria-label={`Open the stored record: ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        useSite.getState().openRecord(title, raws.length === 1 ? raws[0] : raws, src);
      }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
        <path d="M4 1.5C2.8 1.5 2.5 2.2 2.5 3v1.6c0 .7-.4 1.1-1 1.4.6.3 1 .7 1 1.4V9c0 .8.3 1.5 1.5 1.5M8 1.5c1.2 0 1.5.7 1.5 1.5v1.6c0 .7.4 1.1 1 1.4-.6.3-1 .7-1 1.4V9c0 .8-.3 1.5-1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      record
    </button>
  );
}

// ------------------------------------------------------------------ JSON view
function JsonNode({ k, v, depth }: { k?: string; v: unknown; depth: number }) {
  const isArr = Array.isArray(v);
  const isObj = v !== null && typeof v === "object";
  const n = isArr ? (v as unknown[]).length : isObj ? Object.keys(v as object).length : 0;
  const [open, setOpen] = useState(!(isArr && n > 6) && depth < 4);
  const key = k !== undefined ? <span className="s-j-k">{JSON.stringify(k)}: </span> : null;
  if (!isObj) {
    const cls = typeof v === "string" ? "s-j-s" : typeof v === "number" ? "s-j-n" : "s-j-b";
    return (
      <div className="s-j-row">
        {key}
        <span className={cls}>{JSON.stringify(v)}</span>
      </div>
    );
  }
  const entries: [string | undefined, unknown][] = isArr ? (v as unknown[]).map((x) => [undefined, x]) : Object.entries(v as object);
  return (
    <div className="s-j-row">
      <button type="button" className="s-j-t" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "▾" : "▸"}
      </button>
      {key}
      <span className="s-j-p">{isArr ? "[" : "{"}</span>
      {!open ? (
        <>
          <button type="button" className="s-j-more" onClick={() => setOpen(true)}>
            {n} {isArr ? (n === 1 ? "item" : "items") : n === 1 ? "key" : "keys"}
          </button>
          <span className="s-j-p">{isArr ? "]" : "}"}</span>
        </>
      ) : (
        <>
          <div className="s-j-kids">
            {entries.map(([kk, vv], i) => (
              <JsonNode key={i} k={kk} v={vv} depth={depth + 1} />
            ))}
          </div>
          <span className="s-j-p">{isArr ? "]" : "}"}</span>
        </>
      )}
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return (
    <div className="s-json">
      <JsonNode v={value} depth={0} />
    </div>
  );
}

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function srcHeader(src: RecordSrc | null): ReactNode {
  if (!src) return <>Exported bundle · no stored-record id yet</>;
  if (src.db === "file") return <>Run cache file · {src.coll} · key {src.id}</>;
  return (
    <>
      MongoDB Atlas · {src.db}.{src.coll} · _id {shortId(src.id)}
    </>
  );
}

type Live = { state: "idle" | "loading" | "done" | "local" | "error"; ms?: number; doc?: unknown; error?: string; raw?: unknown };

async function fetchRecord(path: string): Promise<{ status: number; body: unknown; ms: number }> {
  const t0 = performance.now();
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 32000); // the server can take ~25 s when Atlas does not answer
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal: ctl.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, ms: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(to);
  }
}

export function RecordDrawer() {
  const rec = useSite((s) => s.record);
  const [live, setLive] = useState<Live>({ state: "idle" });
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setLive({ state: "idle" });
    setCopied(false);
    if (!rec) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useSite.getState().closeRecord();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rec]);
  if (!rec) return null;
  const src = rec.src;
  const canFetch = !!src && src.db !== "file";
  const fetchLive = async () => {
    if (!src) return;
    setLive({ state: "loading" });
    try {
      const r = await fetchRecord(`/api/record/${encodeURIComponent(src.coll)}/${encodeURIComponent(src.id)}`);
      const b = (r.body ?? {}) as { ok?: boolean; doc?: unknown; error?: string; ms?: number; local?: unknown };
      if (b.ok) setLive({ state: "done", doc: b.doc, ms: b.ms ?? r.ms, raw: b });
      else if (b.local != null) setLive({ state: "local", doc: b.local, error: b.error, ms: b.ms ?? r.ms, raw: b });
      else setLive({ state: "error", error: b.error ?? `HTTP ${r.status}`, raw: b });
    } catch (e) {
      setLive({ state: "error", error: e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError") ? `live server not reachable at ${API_BASE}` : String(e) });
    }
  };
  return (
    <>
      <div className="s-drawer-scrim" onClick={() => useSite.getState().closeRecord()} />
      <aside className="s-drawer" role="dialog" aria-modal="true" aria-label="Stored record">
        <div className="s-drawer-h">
          <div className="s-drawer-src">
            <span className={`s-src-dot ${src?.db === "file" ? "file" : src ? "atlas" : ""}`} />
            {srcHeader(src)}
            {src && (
              <button
                type="button"
                className="s-copy"
                onClick={() => {
                  navigator.clipboard?.writeText(src.id).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
                title={`Copy ${src.id}`}
              >
                {copied ? "copied" : "copy id"}
              </button>
            )}
          </div>
          <button type="button" className="s-icon-btn" onClick={() => useSite.getState().closeRecord()} aria-label="Close (Esc)">
            ×
          </button>
        </div>
        <div className="s-drawer-title">{rec.title}</div>
        <div className="s-drawer-body">
          <div className="s-kicker">{src?.db === "file" ? "From the run cache file, as exported" : "As exported in the bundle"}</div>
          <JsonView value={rec.raw} />
          {canFetch && (
            <div className="s-live-rec">
              <button type="button" className="s-btn" onClick={fetchLive} disabled={live.state === "loading"}>
                {live.state === "loading" ? (
                  <>
                    <span className="s-spin" aria-hidden /> Asking Atlas… (up to ~25 s)
                  </>
                ) : (
                  "Fetch live from Atlas"
                )}
              </button>
              {live.state === "done" && (
                <>
                  <div className="s-kicker s-mt-s">
                    Live from Atlas · {live.ms} ms
                  </div>
                  <JsonView value={live.doc} />
                </>
              )}
              {live.state === "local" && (
                <>
                  <p className="s-note">
                    Atlas didn't answer from this network · showing the identical local copy (same _id){live.ms != null ? ` · ${live.ms} ms` : ""}.
                    {live.error ? <span className="s-dim"> Server said: {live.error}</span> : null}
                  </p>
                  <JsonView value={live.doc} />
                </>
              )}
              {live.state === "error" && (
                <>
                  <p className="s-note s-bad-t">{live.error}</p>
                  {live.raw !== undefined && <JsonView value={live.raw} />}
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** Integrity: ask the live server to read the exam vault with the AI's database user. */
export function VaultProbe() {
  const atlas = useSite((st) => st.data?.honesty.atlas);
  const atlasAt = useSite((st) => st.data?.honesty.atlasAt);
  const [r, setR] = useState<{ state: "idle" | "loading" | "done" | "offline"; status?: number; body?: unknown; ms?: number }>({ state: "idle" });
  const run = async () => {
    setR({ state: "loading" });
    try {
      const x = await fetchRecord("/api/record/vault/test_runs");
      setR({ state: "done", status: x.status, body: x.body, ms: x.ms });
    } catch {
      setR({ state: "offline" });
    }
  };
  const b = (r.body ?? {}) as { ok?: boolean; denied?: boolean | null; code?: number; user?: string; error?: string; ms?: number };
  const recorded = (atlas ?? []).filter((x) => /harness_rw.*vault/i.test(x.check));
  const fallback = (
    <div className="s-vault-r">
      <div className="s-kicker">Recorded proof · Atlas permission check{atlasAt ? `, ${atlasAt.replace("T", " ")}` : ""}</div>
      <JsonView value={recorded} />
    </div>
  );
  return (
    <div className="s-vault">
      <div className="s-vault-h">
        <button type="button" className="s-btn" onClick={run} disabled={r.state === "loading"}>
          {r.state === "loading" ? (
            <>
              <span className="s-spin" aria-hidden /> Asking Atlas… (up to ~25 s)
            </>
          ) : (
            "Try reading the exam vault as the AI"
          )}
        </button>
        <span className="s-small s-dim">
          GET <code>/api/record/vault/test_runs</code>, sent now, as the learning loop's database user
        </span>
      </div>
      {r.state === "offline" && (
        <>
          <p className="s-note">The live server is not reachable at {API_BASE}. Showing what Atlas answered when the check was recorded.</p>
          {fallback}
        </>
      )}
      {r.state === "done" && b.denied === true && (
        <div className="s-vault-r">
          <div className="s-kicker s-bad-t">
            Live answer from Atlas · refused · not authorized (code {b.code ?? 13}) · user {b.user ?? "harness_rw"} · {b.ms ?? r.ms} ms
          </div>
          <JsonView value={r.body} />
        </div>
      )}
      {r.state === "done" && b.denied !== true && (
        <>
          <p className="s-note">
            {b.ok ? "The read was allowed: this should never happen." : "Atlas didn't answer from this network, so there is no live verdict."}
            {b.error ? <span className="s-dim"> Server said: {b.error}</span> : null}
          </p>
          <JsonView value={r.body} />
          {!b.ok && fallback}
        </>
      )}
    </div>
  );
}
