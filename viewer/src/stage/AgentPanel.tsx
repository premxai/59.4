// The operator, in plain words: what it sees, what it is doing now, and its latest steps
// (AI decisions, notebook habits, hard limits, lessons recalled from MongoDB, alarms).
import { useMemo } from "react";
import { actionClauses, observations, plainStep, type StageStep } from "./derive";
import { useStage } from "./store";

interface FeedItem {
  key: string;
  h: number;
  type: string;
  count: number;
  step: ReturnType<typeof plainStep>;
}

function feedOf(steps: StageStep[], hour: number, max = 7): FeedItem[] {
  // newest first; AI decisions only when they change course; repeated lessons/habits collapse
  const out: FeedItem[] = [];
  const seen = new Map<string, FeedItem>();
  let lastDecision = "";
  const visible: StageStep[] = [];
  for (const s of steps) {
    if (s.h > hour) break;
    visible.push(s);
  }
  const chosen: StageStep[] = [];
  for (const s of visible) {
    if (s.type === "ai_decision") {
      // the AI is asked every hour; only show it when it changes its mind
      if (s.text === lastDecision) continue;
      lastDecision = s.text;
      if (/no action needed/i.test(s.text)) continue;
    }
    chosen.push(s);
  }
  let memories = 0;
  for (let i = chosen.length - 1; i >= 0 && out.length < max; i--) {
    const s = chosen[i];
    const key = `${s.type}|${s.text}`;
    // lessons are recalled with every AI call: show the latest one, not a wall of them
    if (s.type === "memory_recall" && !seen.has(key) && ++memories > 1) continue;
    const prev = seen.get(key);
    if (prev) {
      prev.count++;
      continue;
    }
    const it: FeedItem = { key: `${key}|${s.h}`, h: s.h, type: s.type, count: 1, step: plainStep(s) };
    seen.set(key, it);
    out.push(it);
  }
  return out;
}

export function AgentPanel() {
  const hour = useStage((s) => Math.floor(s.hour));
  const status = useStage((s) => s.status);
  const intro = useStage((s) => s.intro);
  const right = useStage((s) => s.right);
  const version = useStage((s) => s.version);
  const offline = useStage((s) => s.offline);
  const n = right.steps.length;
  const feed = useMemo(() => feedOf(right.steps, hour), [right.steps, hour, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const obs = useMemo(() => observations(right.frames, hour), [right.frames, hour]);
  const idle = status === "idle" || intro != null || !right.frames.length;
  const action = right.actions[Math.min(right.actions.length - 1, hour)] ?? null;
  const clauses = actionClauses(action);
  const decidedNow = right.steps.some((s) => s.h === hour && s.type === "ai_decision");
  const mode = idle ? "Waiting for a storm" : decidedNow ? "Deciding…" : clauses.length ? "Acting" : "Observing…";
  return (
    <aside className="st-agent st-glass">
      <div className="st-agent-head">
        <span className="st-agent-title">AGENT</span>
        <span className={`st-agent-mode ${decidedNow ? "st-agent-mode-hot" : ""}`}>
          <i />
          {mode}
        </span>
      </div>
      <div className="st-agent-sub">
        Frozen AI · notebook {version}
        {offline ? " · offline replay" : ""}
      </div>
      {idle ? (
        <div className="st-agent-idle">
          <p>The operator is a frozen open-source AI. It never sees the storm&apos;s name, date or place: only the gauges in its notebook.</p>
          <p>Press <b>Break the grid</b> to hand it a storm it has never seen.</p>
        </div>
      ) : (
        <>
          <div className="st-agent-sec">Sees</div>
          <ul className="st-obs">
            {obs.map((o) => (
              <li key={o.text} className={`st-obs-${o.tone}`}>
                {o.text}
              </li>
            ))}
          </ul>
          <div className="st-agent-sec">Doing now</div>
          <div className="st-action">
            {clauses.length ? (
              clauses.slice(0, 4).map((c) => (
                <span key={c.text} className={`st-chip ${c.key ? "st-chip-key" : ""}`}>
                  {c.text}
                </span>
              ))
            ) : (
              <span className="st-chip st-chip-quiet">No action needed</span>
            )}
            {clauses.length > 4 && <span className="st-chip st-chip-quiet">+{clauses.length - 4} more</span>}
          </div>
          <div className="st-agent-sec">Latest steps</div>
          <ol className="st-feed">
            {feed.map((it) => (
              <li key={it.key} className={`st-step st-step-${it.step.tone}`}>
                <span className="st-step-icon">{it.step.icon}</span>
                <span className="st-step-body">
                  <span className="st-step-kind">
                    {it.step.kind}
                    <em>hour {it.h}</em>
                    {it.count > 1 && <em>×{it.count}</em>}
                  </span>
                  <span className="st-step-text">{it.step.text}</span>
                </span>
              </li>
            ))}
            {!feed.length && <li className="st-step st-step-quiet">Watching the gauges. Nothing to do yet.</li>}
          </ol>
        </>
      )}
    </aside>
  );
}
