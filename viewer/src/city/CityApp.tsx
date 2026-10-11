// The main stage view: Blender city light layers driven by the replay, plus HTML overlays.
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { useClock } from "../lib/clock";
import type { Replay } from "../lib/replay";
import { LightLayerCompositor } from "../scene/LightLayerCompositor";
import { QualityReadout, Timeline, useKeyboard } from "../ui/Controls";
import { Finale, WhatChangedCard, useJson, type Reference, type WhatChanged } from "../ui/Finale";
import { Badge, CardView, CollapseCard, HomesDark, LocalTime, RunLabel, useEventCardList } from "../ui/Hud";
import { loadCam, type Anchors, type CamManifest } from "./layers";
import { AnchoredCards, FreqRing2D, TexasInset, useRefBox } from "./Overlays";

const params = new URLSearchParams(location.search);
const KIOSK = params.get("kiosk") === "1";
const INSET = params.get("inset");

export class LayerErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error)
      return (
        <div className="loading" style={{ letterSpacing: 0, fontSize: 15, padding: 24, textAlign: "center" }}>
          {this.state.error}
          <br />
          <a href={`?mode=texas${location.search.replace("?", "&")}`} style={{ color: "#8fd0ff" }}>
            open the 3D Texas fallback
          </a>
        </div>
      );
    return this.props.children;
  }
}

function useCam(cam: string) {
  const [v, setV] = useState<{ man: CamManifest; anchors: Anchors } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadCam(cam).then(setV, (e) => setErr(String(e instanceof Error ? e.message : e)));
  }, [cam]);
  if (err) throw new Error(err);
  return v;
}

/**
 * One view of the city for one replay (full screen in single mode, a half in split mode).
 * Also used by Mission Control (src/mission): `showBadge=false` hides the per-pane model badge,
 * `winterized` drives the heat-trace layer, `children` are extra overlays inside the HUD.
 */
export function CityPane({
  replay,
  cam,
  split,
  showScenario,
  inset,
  showBadge = true,
  winterized = 0,
  children,
}: {
  replay: Replay;
  cam: string;
  split: boolean;
  showScenario: boolean;
  inset: boolean;
  showBadge?: boolean;
  winterized?: number;
  children?: ReactNode;
}) {
  const camData = useCam(cam);
  const [ref, box] = useRefBox<HTMLDivElement>();
  const cards = useEventCardList(replay, split ? 4 : 5, true);
  const stack = cards.filter((c) => !c.anchor && c.type !== "collapse");
  return (
    <div className="pane" ref={ref}>
      <LightLayerCompositor replay={replay} cam={cam} winterized={winterized} />
      <div className="hud">
        <div className="hud-tl">
          <RunLabel replay={replay} showScenario={showScenario} />
          {showBadge && <Badge replay={replay} />}
        </div>
        <div className={split ? "hud-ring-split" : "hud-ring"}>
          <FreqRing2D replay={replay} size={split ? 78 : 96} />
        </div>
        {!split && (
          <div className="hud-tr">
            <LocalTime replay={replay} />
          </div>
        )}
        <div className="hud-bl">
          <HomesDark replay={replay} />
        </div>
        {camData && <AnchoredCards cards={cards} man={camData.man} anchors={camData.anchors} box={box} />}
        <div className="cards city-cards">
          {stack.slice(-3).map((c) => (
            <CardView key={c.id} c={c} />
          ))}
        </div>
        <CollapseCard cards={cards} />
        {inset && (
          <div className="hud-br">
            <TexasInset replay={replay} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
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

export function CitySingle({ replay }: { replay: Replay }) {
  const changed = useJson<WhatChanged>("what_changed.json");
  const [showChanged, setShowChanged] = useState(false);
  useKeyboard(useMemo(() => (e: KeyboardEvent) => e.code === "KeyW" && setShowChanged((v) => !v), []));
  return (
    <LayerErrorBoundary>
      <div className="stage city">
        <CityPane replay={replay} cam="CAM_Wide" split={false} showScenario inset={INSET !== "0"} />
        {showChanged && (
          <div className="hud-center-bottom">
            <WhatChangedCard data={changed} />
          </div>
        )}
        {!KIOSK && <Timeline />}
        <QualityReadout />
      </div>
    </LayerErrorBoundary>
  );
}

export function CitySplit({ left, right }: { left: Replay; right: Replay }) {
  const reference = useJson<Reference>("reference.json");
  const changed = useJson<WhatChanged>("what_changed.json");
  const finale = useFinaleReady();
  const [showChanged, setShowChanged] = useState(false);
  useKeyboard(useMemo(() => (e: KeyboardEvent) => e.code === "KeyW" && setShowChanged((v) => !v), []));
  return (
    <LayerErrorBoundary>
      <div className="stage split city">
        {[left, right].map((r, i) => (
          <div className={`half half-${i ? "right" : "left"}`} key={r.file + i}>
            <CityPane replay={r} cam="CAM_Wide" split showScenario={i === 0} inset={INSET === "1"} />
          </div>
        ))}
        <div className="split-divider" />
        {!finale && (
          <div className="hud-top-center">
            <LocalTime replay={left.frames.length >= right.frames.length ? left : right} />
          </div>
        )}
        {showChanged && !finale && (
          <div className="hud-center-bottom">
            <WhatChangedCard data={changed} />
          </div>
        )}
        {finale && <Finale left={left} right={right} reference={reference} changed={changed} />}
        {!KIOSK && <Timeline />}
        <QualityReadout />
      </div>
    </LayerErrorBoundary>
  );
}
