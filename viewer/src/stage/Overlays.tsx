// Moments: the small storm-start notes, the RESPONSE VERIFIED / FAILED card, notices.
import { useEffect, useState } from "react";
import { API_BASE } from "../mission/live";
import { useVerdict } from "./hooks";
import { useStage } from "./store";

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const code = (i: number) => Array.from({ length: 4 }, (_, k) => GLYPHS[(i * 7 + k * 13 + ((i * (k + 3)) % 11)) % GLYPHS.length]).join("");

export function Intro() {
  const intro = useStage((s) => s.intro);
  const nights = useStage((s) => s.nights);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (intro !== 0) return;
    const id = setInterval(() => setI((x) => x + 1), 90);
    return () => clearInterval(id);
  }, [intro]);
  if (intro == null) return null;
  return (
    <div className="st-intro">
      {intro === 0 && (
        <div className="st-intro-line st-intro-select" key="a">
          <small>Drawing an unseen storm</small>
          <b>
            Storm <span className="st-intro-slot">{code(i)}</span> from the hidden pool
          </b>
          <i className="st-intro-bar" />
        </div>
      )}
      {intro === 1 && <div className="st-flash" key="flash" />}
      {intro === 1 && (
        <div className="st-intro-line st-intro-inject" key="b">
          <small>Storm started</small>
          <b>The frozen AI is now running the grid</b>
        </div>
      )}
      {intro === 2 && (
        <div className="st-intro-line st-intro-blind" key="c">
          <small>Blind test</small>
          <b>No storm name, date or place: only gauges and its notebook.</b>
          <small>Notebook refined over {nights} nights · model never retrained</small>
        </div>
      )}
    </div>
  );
}

export function VerdictCard() {
  const v = useVerdict();
  const storm = useStage((s) => s.storm);
  const offline = useStage((s) => s.offline);
  const runs = useStage((s) => s.runs);
  const [shown, setShown] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    setShown(0);
    setClosed(false);
  }, [v, runs]);
  useEffect(() => {
    if (!v || shown > v.checks.length + 1) return;
    const id = setTimeout(() => setShown((x) => x + 1), shown === 0 ? 700 : 650);
    return () => clearTimeout(id);
  }, [v, shown]);
  if (!v || closed) return null;
  const n = v.checks.length;
  const all = shown > n;
  return (
    <div className="st-verdict-wrap">
      <div className={`st-verdict st-glass ${all ? (v.verified ? "st-verdict-ok" : "st-verdict-bad") : ""}`}>
        <div className="st-verdict-head">
          <span className="st-verdict-kicker">Checking the response against the simulator</span>
          <b className={`st-verdict-title ${all ? "st-verdict-title-in" : ""}`}>{all ? (v.verified ? "RESPONSE VERIFIED" : "RESPONSE FAILED") : "VERIFYING…"}</b>
        </div>
        <ul className="st-checks">
          {v.checks.map((c, i) => (
            <li key={c.text} className={`st-check ${i < shown ? "st-check-in" : ""} ${c.ok ? "st-check-ok" : "st-check-bad"}`}>
              <span className="st-check-box">{i < shown ? (c.ok ? "✓" : "✕") : ""}</span>
              <span>
                <b>{c.text}</b>
                {c.sub && <small>{c.sub}</small>}
              </span>
            </li>
          ))}
        </ul>
        {all && v.compare && <div className="st-compare">{v.compare}</div>}
        {all && storm && (
          <div className="st-reveal">
            It was: <b>{storm.label ?? "an unseen storm"}</b>
            {storm.source_year ? ` · ${storm.source_year}` : ""}, never shown to the coach{offline ? " (offline replay)" : ""}.
            {storm.description && <small>{storm.description}</small>}
          </div>
        )}
        {all && (
          <div className="st-verdict-actions">
            <button className="st-btn" onClick={() => useStage.getState().replayRun()}>
              ⟲ Watch again
            </button>
            <button className="st-btn st-btn-primary" onClick={() => useStage.getState().breakGrid()}>
              ⚡ Break it again
            </button>
            <button className="st-btn st-btn-quiet" onClick={() => setClosed(true)}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Notice() {
  const online = useStage((s) => s.online);
  const status = useStage((s) => s.status);
  const error = useStage((s) => s.error);
  const offline = useStage((s) => s.offline);
  if (status === "error" && error)
    return (
      <div className="st-notice st-notice-bad">
        {error}{" "}
        <button className="st-btn st-btn-small" onClick={() => useStage.getState().breakGrid()}>
          Try again
        </button>
      </div>
    );
  if (online === "offline" && (status === "idle" || offline))
    return <div className="st-notice">Live server offline ({API_BASE}). Break the grid plays a recorded offline replay of an unseen storm.</div>;
  return null;
}
