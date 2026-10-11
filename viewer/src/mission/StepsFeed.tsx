// The coach's night, one plain sentence per step, synced to the night playback (top-bar ▶).
import { useEffect, useRef } from "react";
import { stepsOf } from "./derive";
import { nightNumber, nightStepView } from "./plain";
import { useCursor, useMission, useTrack } from "./store";
import { Ticks } from "./ui";

function NightFeed() {
  const t = useTrack();
  const cur = useCursor();
  const open = useMission((s) => s.openInspect);
  const playing = useMission((s) => s.playing);
  const box = useRef<HTMLDivElement>(null);
  const steps = stepsOf(t, cur.gen);
  const shown = steps.slice(0, Math.max(0, cur.step + 1));
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: playing ? "smooth" : "auto" });
  }, [cur.step, cur.gen, playing]);
  if (!t) return null;
  if (!steps.length) return <div className="mc-feed-empty">No steps logged for Day {cur.gen} yet.</div>;
  return (
    <div className="mc-feed-list" ref={box}>
      {shown.map((s, i) => {
        const v = nightStepView(t, s, cur.gen);
        return (
          <button key={`${cur.gen}-${i}`} className={`mc-step mc-step-${v.tone} ${i === cur.step ? "mc-step-now" : ""}`} onClick={() => open({ kind: "step", track: t.key, gen: cur.gen, index: i })}>
            <span className="mc-step-icon">{v.icon}</span>
            <span className="mc-step-body">
              <span className="mc-step-title">{v.title}</span>
              {v.ticks && (
                <span className="mc-step-ticks">
                  <Ticks s={v.ticks} size="s" stagger={i === cur.step} />
                </span>
              )}
              {v.detail && <span className="mc-step-detail">{v.detail}</span>}
              {v.tags && v.tags.length > 0 && (
                <span className="mc-step-tags">
                  {v.tags.map((tg) => (
                    <span key={tg} className={`mc-tag ${/red-team|cheat|calm|memori|worse|game/i.test(tg) ? "mc-tag-red" : ""}`}>
                      {tg}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </button>
        );
      })}
      {cur.step < steps.length - 1 && <div className="mc-step-more">{steps.length - cur.step - 1} more steps tonight…</div>}
    </div>
  );
}

export function StepsFeed() {
  const t = useTrack();
  const gen = useMission((s) => s.gen);
  return (
    <section className="mc-panel mc-feed">
      <header className="mc-panel-head">
        <div className="mc-panel-title">
          Coach's night
          {t && <span className="mc-dim"> · Day {gen} → Night {nightNumber(t, gen)}</span>}
        </div>
        <div className="mc-panel-right mc-dim">▶ in the top bar plays it step by step</div>
      </header>
      <div className="mc-panel-body">
        <NightFeed />
      </div>
    </section>
  );
}
