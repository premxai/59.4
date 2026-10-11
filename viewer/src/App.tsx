import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { startClock, useClock } from "./lib/clock";
import type { Replay } from "./lib/replay";
import { listReplays, loadReplay } from "./lib/replay";
import { CitySingle, CitySplit } from "./city/CityApp";
import { WorldCanvas } from "./scene/World";
import { QualityReadout, Timeline, useKeyboard } from "./ui/Controls";
import { Finale, WhatChangedCard, useJson, type Reference, type WhatChanged } from "./ui/Finale";
import { Badge, Countdown, EventCards, HomesDark, LocalTime, RunLabel } from "./ui/Hud";
import { MissionApp } from "./mission/MissionApp";
import { HOSTED } from "./mission/live";

const params = new URLSearchParams(location.search);
// ?mode=grid: the live 3D power-grid city (src/grid3d), loaded on demand.
const GridDemo = lazy(() => import("./grid3d/GridDemo"));
// ?mode=stage: the hero demo screen (src/stage), loaded on demand.
const StageApp = lazy(() => import("./stage/StageApp"));
// ?mode=site: the Evidence site (src/site), loaded on demand.
const SiteApp = lazy(() => import("./site/SiteApp"));
const KIOSK = params.get("kiosk") === "1";
const ORBIT = (params.get("orbit") as "sway" | "full" | "off" | null) ?? "sway";

async function pickDefault(): Promise<string> {
  const files = await listReplays();
  return files.find((f) => f.startsWith("dev_")) ?? files.find((f) => f === "mock_gen1.json") ?? files[0] ?? "mock_gen1.json";
}

function useReplays(names: (string | null)[]): { replays: Replay[] | null; error: string | null } {
  const [replays, setReplays] = useState<Replay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = names.join("|");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const resolved = await Promise.all(names.map(async (n) => n ?? (await pickDefault())));
        const rs = await Promise.all(resolved.map(loadReplay));
        if (!alive) return;
        const c = useClock.getState();
        const end = Number(params.get("end"));
        const last = Math.max(...rs.map((r) => r.frames.length - 1));
        c.setMax(end > 0 ? Math.min(end, last) : last);
        const t = Number(params.get("t") ?? 0);
        c.setHour(Number.isFinite(t) ? t : 0);
        const sp = Number(params.get("speed"));
        if (sp > 0) c.setSpeed(sp);
        c.setPlaying(params.get("autoplay") !== "0");
        setReplays(rs);
      } catch (e) {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { replays, error };
}

function Loading({ error }: { error: string | null }) {
  return <div className="loading">{error ? `Could not load: ${error}` : "4:37"}</div>;
}

function useFinaleReady(): boolean {
  const atEnd = useClock((s) => s.maxHour > 0 && s.hour >= s.maxHour);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!atEnd) {
      setReady(false);
      return;
    }
    const id = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(id);
  }, [atEnd]);
  return ready;
}

function Single({ name }: { name: string | null }) {
  const { replays, error } = useReplays([name]);
  const [showChanged, setShowChanged] = useState(false);
  const changed = useJson<WhatChanged>("what_changed.json");
  useKeyboard(useMemo(() => (e: KeyboardEvent) => e.code === "KeyW" && setShowChanged((v) => !v), []));
  if (!replays) return <Loading error={error} />;
  const r = replays[0];
  return (
    <div className="stage">
      <WorldCanvas replay={r} orbit={ORBIT} />
      <div className="hud">
        <div className="hud-tl">
          <RunLabel replay={r} />
          <Badge replay={r} />
        </div>
        <div className="hud-tr">
          <LocalTime replay={r} />
        </div>
        <div className="hud-bl">
          <HomesDark replay={r} />
        </div>
        <EventCards replay={r} />
        <Countdown replay={r} />
        {showChanged && (
          <div className="hud-center-bottom">
            <WhatChangedCard data={changed} />
          </div>
        )}
        <div className="credit">Night lights: NASA Black Marble 2016</div>
      </div>
      {!KIOSK && <Timeline />}
      <QualityReadout />
    </div>
  );
}

function Split({ left, right }: { left: string; right: string }) {
  const { replays, error } = useReplays([left, right]);
  const reference = useJson<Reference>("reference.json");
  const changed = useJson<WhatChanged>("what_changed.json");
  const finale = useFinaleReady();
  const [showChanged, setShowChanged] = useState(false);
  useKeyboard(useMemo(() => (e: KeyboardEvent) => e.code === "KeyW" && setShowChanged((v) => !v), []));
  if (!replays) return <Loading error={error} />;
  const [L, R] = replays;
  return (
    <div className="stage split">
      {[L, R].map((r, i) => (
        <div className={`half half-${i ? "right" : "left"}`} key={r.file + i}>
          <WorldCanvas replay={r} orbit={ORBIT} />
          <div className="hud">
            <div className="hud-tl">
              <RunLabel replay={r} showScenario={i === 0} />
              <Badge replay={r} />
            </div>
            <div className="hud-bl">
              <HomesDark replay={r} />
            </div>
            <EventCards replay={r} max={3} />
            <Countdown replay={r} compact />
          </div>
        </div>
      ))}
      <div className="split-divider" />
      {!finale && (
        <div className="hud-top-center">
          <LocalTime replay={L.frames.length >= R.frames.length ? L : R} />
        </div>
      )}
      {showChanged && !finale && (
        <div className="hud-center-bottom">
          <WhatChangedCard data={changed} />
        </div>
      )}
      {finale && <Finale left={L} right={R} reference={reference} changed={changed} />}
      <div className="credit">Night lights: NASA Black Marble 2016</div>
      {!KIOSK && <Timeline />}
      <QualityReadout />
    </div>
  );
}

/** Link from the stage views to Mission Control (?mode=mission); also the M key. Hidden in kiosk mode. */
function MissionLink() {
  // own listener (not useKeyboard: that also binds space/arrows, which the stage view already handles)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && !e.ctrlKey && !e.metaKey && !e.altKey) location.search = "?mode=mission";
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (KIOSK) return null;
  return (
    <a className="mission-link" href="?mode=mission" title="Open Mission Control (M)">
      Mission Control →
    </a>
  );
}

function CityRoute({ names }: { names: (string | null)[] }) {
  const { replays, error } = useReplays(names);
  if (!replays) return <Loading error={error} />;
  return (
    <>
      {replays.length === 2 ? <CitySplit left={replays[0]} right={replays[1]} /> : <CitySingle replay={replays[0]} />}
      <MissionLink />
    </>
  );
}

export default function App() {
  useEffect(() => startClock(), []);
  useEffect(() => {
    if (KIOSK) document.body.classList.add("kiosk");
  }, []);
  const mode = params.get("mode") ?? (HOSTED ? "site" : null); // a hosted copy opens on the Evidence site
  if (mode === "mission") return <MissionApp />;
  if (mode === "site")
    return (
      <Suspense fallback={<Loading error={null} />}>
        <SiteApp />
      </Suspense>
    );
  if (mode === "stage")
    return (
      <Suspense fallback={<Loading error={null} />}>
        <StageApp />
      </Suspense>
    );
  if (mode === "grid")
    return (
      <Suspense fallback={<Loading error={null} />}>
        <GridDemo />
      </Suspense>
    );
  const split = params.get("split") === "1";
  const left = params.get("left") ?? (split ? "mock_gen1.json" : null);
  const right = params.get("right") ?? (split ? "mock_gen11.json" : null);
  if (mode === "texas") {
    // Fallback: the 3D Texas map.
    if (left && right) return <Split left={left} right={right} />;
    return <Single name={params.get("replay")} />;
  }
  // Main stage view: the Blender city (LightLayerCompositor).
  if (left && right) return <CityRoute names={[left, right]} />;
  return <CityRoute names={[params.get("replay")]} />;
}

