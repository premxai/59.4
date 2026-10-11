// The Blender city in Mission Control, always on the CAM_Wide hero angle. Two halves side by side
// (left notebook | right notebook) fed by the live stream, the finished full replays, or, only when
// the live server is offline, the recorded showcase ("offline replay").
import { useEffect, useRef, useState } from "react";
import { CityPane, LayerErrorBoundary } from "../city/CityApp";
import { useClock } from "../lib/clock";
import type { Replay } from "../lib/replay";
import { frameIndex, loadReplay } from "../lib/replay";
import { LocalTime } from "../ui/Hud";
import { showcaseFor } from "./derive";
import type { LiveStep } from "./live";
import { stormLabel } from "./plain";
import { missionUrl, useMission } from "./store";
import type { ShowcaseRun } from "./types";

export interface OfflineSource {
  key: string;
  left: Replay;
  right: Replay;
  title: string;
  leftSteps: LiveStep[];
  rightSteps: LiveStep[];
  leftRun?: ShowcaseRun;
  rightRun?: ShowcaseRun;
  scripted: boolean;
}

const DEV_FALLBACK = ["dev_heldout_flash_2014_naive.json", "dev_heldout_flash_2014_good.json"];

function relabel(r: Replay, label: string, scenario?: string): Replay {
  return { ...r, meta: { ...r.meta, label, scenario_public: scenario ?? r.meta.scenario_public } };
}

/** The recorded showcase for the selected track (only loaded when `enabled`). */
export function useOfflineReplays(enabled: boolean): { offline: OfflineSource | null; error: string | null } {
  const mission = useMission((s) => s.mission);
  const trackKey = useMission((s) => s.track);
  const [offline, setOffline] = useState<OfflineSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sc = showcaseFor(mission, trackKey);
  const day1 = sc?.runs.day1;
  const fin = sc?.runs.final;
  const key = sc && day1?.replay && fin?.replay ? `sc:${day1.replay}|${fin.replay}` : "dev";
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        let next: OfflineSource | null = null;
        if (sc && day1?.replay && fin?.replay) {
          try {
            const [l, r] = await Promise.all([loadReplay(missionUrl(day1.replay)), loadReplay(missionUrl(fin.replay))]);
            const storm = sc.scenario_id ? `${stormLabel(sc.scenario_id)} · offline replay` : "offline replay";
            next = {
              key,
              left: relabel(l, l.meta.label && l.meta.label !== "day1" ? l.meta.label : "Day 1 notebook", storm),
              right: relabel(r, r.meta.label && r.meta.label !== "final" ? r.meta.label : "Learned notebook", storm),
              title: `Offline replay (recorded earlier) · ${sc.scenario_id ? stormLabel(sc.scenario_id) : "unseen storm"}`,
              leftSteps: day1.steps,
              rightSteps: fin.steps,
              leftRun: day1,
              rightRun: fin,
              scripted: false,
            };
          } catch (e) {
            console.warn("[mission] showcase replays not loadable", e);
          }
        }
        if (!next) {
          const [l, r] = await Promise.all(DEV_FALLBACK.map((f) => loadReplay(f)));
          next = {
            key: "dev",
            left: relabel(l, "Example: naive operator", "Offline demo replay (scripted, no AI)"),
            right: relabel(r, "Example: good operator"),
            title: "Offline demo replay (scripted, no AI)",
            leftSteps: [],
            rightSteps: [],
            scripted: true,
          };
        }
        if (!alive) return;
        const c = useClock.getState();
        c.setMax(Math.max(next.left.frames.length, next.right.frames.length) - 1);
        c.setHour(0);
        c.setSpeed(6);
        c.setPlaying(true);
        setOffline(next);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { offline: enabled ? offline : null, error };
}

export type CityMode = "split" | "left" | "right";

export function MissionCity({
  left,
  right,
  mode,
  idle,
  loop,
  winterLeft,
  winterRight,
}: {
  left: Replay;
  right: Replay;
  mode: CityMode;
  idle: boolean;
  loop: boolean;
  winterLeft: number;
  winterRight: number;
}) {
  // finished / offline replays loop: 4 s after the end, start again
  const atEnd = useClock((s) => s.maxHour > 0 && s.hour >= s.maxHour);
  useEffect(() => {
    if (!atEnd || !loop) return;
    const id = setTimeout(() => {
      const c = useClock.getState();
      c.setHour(0);
      c.setPlaying(true);
    }, 4000);
    return () => clearTimeout(id);
  }, [atEnd, loop]);
  const panes =
    mode === "split"
      ? [
          { r: left, w: winterLeft },
          { r: right, w: winterRight },
        ]
      : mode === "left"
        ? [{ r: left, w: winterLeft }]
        : [{ r: right, w: winterRight }];
  const split = panes.length === 2;
  return (
    <LayerErrorBoundary>
      <div className={`mc-city ${split ? "split" : ""} city ${idle ? "mc-idle" : ""}`}>
        {panes.map((p, i) => (
          <div className={split ? `half half-${i ? "right" : "left"}` : "mc-city-single"} key={p.r.file + i + mode}>
            <CityPane replay={p.r} cam="CAM_Wide" split={split} showScenario={i === 0} inset={false} winterized={p.w} />
          </div>
        ))}
        {split && <div className="split-divider" />}
        {split && !idle && (
          <div className="hud-top-center">
            <LocalTime replay={left.frames.length >= right.frames.length ? left : right} />
          </div>
        )}
      </div>
    </LayerErrorBoundary>
  );
}

/** Compact storm timeline under the city: play/pause, scrub, hour, speed, view mode. */
export function StormBar({ title, replay, mode, setMode, live }: { title: string; replay: Replay | null; mode: CityMode; setMode: (m: CityMode) => void; live: boolean }) {
  const hour = useClock((s) => s.hour);
  const max = useClock((s) => s.maxHour);
  const playing = useClock((s) => s.playing);
  const speed = useClock((s) => s.speed);
  const bar = useRef<HTMLDivElement>(null);
  const scrub = (x: number) => {
    const el = bar.current;
    if (!el || live) return;
    const r = el.getBoundingClientRect();
    useClock.getState().setHour(((x - r.left) / r.width) * max);
  };
  const f = replay && replay.frames.length ? replay.frames[frameIndex(replay, hour)] : null;
  return (
    <div className="mc-stormbar">
      <div className="mc-stormbar-title">{title}</div>
      {!live && (
        <button className="mc-icon-btn" onClick={() => useClock.getState().toggle()} title="Play / pause the storm (K)">
          {playing ? "❚❚" : "▶"}
        </button>
      )}
      <div
        className={`mc-scrub ${live ? "mc-scrub-live" : ""}`}
        ref={bar}
        onPointerDown={(e) => {
          if (live) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          scrub(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && scrub(e.clientX)}
      >
        <div className="mc-scrub-fill" style={{ width: `${max ? (hour / max) * 100 : 0}%` }} />
      </div>
      <div className="mc-stormbar-hour">
        {live ? "live · " : ""}hour {Math.floor(hour)}
        {!live && ` / ${max}`}
        {f && <span className="mc-dim"> · {f.local?.slice(5, 16)}</span>}
      </div>
      {!live && (
        <div className="mc-seg">
          {[3, 6, 12].map((s) => (
            <button key={s} className={`mc-seg-btn ${speed === s ? "mc-seg-on" : ""}`} onClick={() => useClock.getState().setSpeed(s)}>
              {s}h/s
            </button>
          ))}
        </div>
      )}
      <div className="mc-seg">
        {(
          [
            ["split", "Side by side"],
            ["left", "Left only"],
            ["right", "Right only"],
          ] as [CityMode, string][]
        ).map(([k, l]) => (
          <button key={k} className={`mc-seg-btn ${mode === k ? "mc-seg-on" : ""}`} onClick={() => setMode(k)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
