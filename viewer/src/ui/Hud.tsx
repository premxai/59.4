import { useEffect, useRef, useState } from "react";
import { useClock } from "../lib/clock";
import type { Replay, ReplayEvent } from "../lib/replay";
import { countdownAt, fmtClock, fmtHomes, fmtLocal, frameIndex, isCollapsedAt, modelBadge } from "../lib/replay";

export function useHourInt(): number {
  return useClock((s) => Math.floor(s.hour));
}

export function Badge({ replay }: { replay: Replay }) {
  return <div className="badge">{modelBadge(replay.meta)}</div>;
}

export function RunLabel({ replay, showScenario = true }: { replay: Replay; showScenario?: boolean }) {
  const m = replay.meta;
  return (
    <div className="run-label">
      <div className="run-name">{m.label}</div>
      {showScenario && m.scenario_public && (
        <div className="run-scenario">
          {m.scenario_public}
          {m.mock ? " · MOCK DATA" : ""}
        </div>
      )}
    </div>
  );
}

export function LocalTime({ replay }: { replay: Replay }) {
  const h = useHourInt();
  const f = replay.frames[frameIndex(replay, h)];
  const { time, date, tz } = fmtLocal(f.local);
  return (
    <div className="local-time">
      <div className="lt-time">
        {time} <span className="lt-tz">{tz}</span>
      </div>
      <div className="lt-date">{date}</div>
    </div>
  );
}

export function HomesDark({ replay }: { replay: Replay }) {
  const h = useHourInt();
  const f = replay.frames[frameIndex(replay, h)];
  const n = f.homes_dark ?? 0;
  const collapsed = isCollapsedAt(replay, h);
  return (
    <div className={`homes ${n > 0 ? "homes-dark" : ""} ${collapsed ? "homes-collapsed" : ""}`}>
      {n > 0 ? (
        <>
          <div className="homes-num">{fmtHomes(n)}</div>
          <div className="homes-label">homes and businesses without power</div>
        </>
      ) : (
        <>
          <div className="homes-num homes-ok">Lights on</div>
          <div className="homes-label">every home has power</div>
        </>
      )}
    </div>
  );
}

export function Countdown({ replay, compact = false }: { replay: Replay; compact?: boolean }) {
  const cd = useClock((s) => countdownAt(replay, s.hour));
  if (cd == null) return null;
  return (
    <div className={`countdown ${compact ? "countdown-compact" : ""}`}>
      <div className="cd-num">{fmtClock(cd)}</div>
      <div className="cd-label">until the whole grid shuts down</div>
    </div>
  );
}

// ------------------------------------------------------------------ event cards
export interface Card {
  id: number;
  type: string;
  kicker: string;
  text: string;
  born: number;
  ttl: number;
  anchor?: string;
}

const stripJargon = (s: string) =>
  s
    .replace(/\s*\(?\b\d+(\.\d+)?\s*hz\b\)?/gi, "")
    .replace(/\s*:?\s*\(?[\d,.]+\s*(MW|GW|MWh)\)?/g, "")
    .replace(/\bUFLS\b/g, "automatic outages")
    .replace(/\bEEA\s*\d?\b/g, "emergency")
    .replace(/\s{2,}/g, " ")
    .trim();

function toCard(ev: ReplayEvent, h: number, homesDark = 0): Omit<Card, "id" | "born" | "anchor"> | null {
  const t = stripJargon(String(ev.text ?? ""));
  switch (ev.type) {
    case "recall":
      return { type: "recall", kicker: "Operator memory", text: /^recalled from mongodb/i.test(t) ? t : `Recalled from MongoDB: ${t}`, ttl: 8000 };
    case "false_all_clear":
      // Only an event raised by Raindrop itself may be credited to Raindrop (not integrated yet).
      return {
        type: "raindrop",
        kicker: ev.actor === "raindrop" ? "Raindrop flag · false all-clear" : "Alarm · said all clear while power was running out",
        text: t || "The operator said everything was fine. It wasn't.",
        ttl: 8000,
      };
    case "sensor_alert":
      return { type: "sensor", kicker: "Sensor alert", text: t || "A sensor warned of trouble ahead", ttl: 7000 };
    case "collapse":
      return { type: "collapse", kicker: "", text: `Texas dark · hour ${h}`, ttl: 1e9 };
    case "shed_start":
      return {
        type: "info",
        kicker: "Rolling outages",
        text: homesDark > 0 ? `Rolling outages begin · ${fmtHomes(homesDark)} homes and businesses dark` : t || "Rolling outages begin",
        ttl: 5000,
      };
    case "shed_end":
      return { type: "good", kicker: "Rolling outages", text: t || "Rolling outages end", ttl: 5000 };
    case "ufls":
      return { type: "warn", kicker: "Emergency", text: "Automatic emergency outages switch on", ttl: 5000 };
    case "trip":
      return { type: "info", kicker: "Power plants", text: t || "A power plant shut down", ttl: 4500 };
    case "build":
      return { type: "info", kicker: "Before the season", text: t || "Pre-season upgrades", ttl: 5000 };
    case "llm_call":
      return t ? { type: "quiet", kicker: "Operator", text: t, ttl: 3500 } : null;
    default:
      return t ? { type: "info", kicker: "", text: t, ttl: 4500 } : null;
  }
}

let cardSeq = 1;

/** Which object a card points at in the city view (anchors from layers/{CAM}/anchors.json). */
function anchorFor(ev: ReplayEvent): string | undefined {
  const t = String(ev.text ?? "");
  switch (ev.type) {
    case "sensor_alert":
    case "false_all_clear":
      return "pumpjacks";
    case "trip":
      return /wind|turbine/i.test(t) ? "wind_farm" : "gas_plant";
    case "shed_start":
    case "shed_end":
    case "ufls":
      return "downtown";
    default:
      return undefined;
  }
}

/**
 * Event cards reached by the playhead. Forward play adds the events of each crossed hour; a scrub
 * resets (keeping the persistent collapse card). With `withAnchors`, cards carry an `anchor` key and
 * data-driven hospital cards are added (zone_crit stays on during rotation / backup on collapse).
 */
export function useEventCardList(replay: Replay, max = 4, withAnchors = false): Card[] {
  const h = useHourInt();
  const prev = useRef<number>(-1);
  const [cards, setCards] = useState<Card[]>([]);

  useEffect(() => {
    const p = prev.current;
    prev.current = h;
    const now = performance.now();
    const add: Card[] = [];
    const collect = (i: number) => {
      const f = replay.frames[i];
      if (!f?.events) return;
      const trips = f.events.filter((e) => e.type === "trip");
      for (const ev of f.events) {
        if (ev.type === "trip" && trips.length > 1) continue;
        const c = toCard(ev, f.h, f.homes_dark);
        if (c) add.push({ ...c, id: cardSeq++, born: now, anchor: withAnchors ? anchorFor(ev) : undefined });
        if (withAnchors && ev.type === "shed_start" && (f.zones?.zone_crit ?? 1) >= 1)
          add.push({ id: cardSeq++, born: now, type: "info", kicker: "Critical services", text: "Hospital and water plant stay powered", ttl: 6000, anchor: "hospital" });
        if (withAnchors && ev.type === "collapse")
          add.push({ id: cardSeq++, born: now, type: "warn", kicker: "Critical services", text: "Hospital and water plant on backup generators", ttl: 9000, anchor: "hospital" });
      }
      if (trips.length > 1) {
        const names = trips.map((e) => stripJargon(String(e.text ?? ""))).filter(Boolean);
        add.push({
          id: cardSeq++,
          born: now,
          type: "info",
          kicker: `${trips.length} power plants shut down`,
          text: names.slice(0, 2).join(" · ") + (names.length > 2 ? ` · and ${names.length - 2} more` : ""),
          ttl: 4500,
          anchor: withAnchors ? "gas_plant" : undefined,
        });
      }
    };
    if (p >= 0 && h > p && h - p <= 4) {
      for (let i = p + 1; i <= h; i++) collect(i);
      if (add.length) setCards((cs) => [...cs, ...add].slice(-max));
    } else if (p !== h) {
      // Scrubbed: reset, keep only the persistent collapse card if collapsed.
      const ch = replay.meta.collapse_hour;
      const keep: Card[] = [];
      if (ch != null && h >= ch) keep.push({ id: cardSeq++, born: now, type: "collapse", kicker: "", text: `Texas dark · hour ${ch}`, ttl: 1e9 });
      if (h !== ch) collect(h);
      setCards([...keep, ...add].slice(-max));
    }
  }, [h, replay, max, withAnchors]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      setCards((cs) => {
        const next = cs.filter((c) => now - c.born < c.ttl);
        return next.length === cs.length ? cs : next;
      });
    }, 250);
    return () => clearInterval(id);
  }, []);
  return cards;
}

export function CardView({ c }: { c: Card }) {
  return (
    <div className={`card card-${c.type}`}>
      {c.kicker && <div className="card-kicker">{c.kicker}</div>}
      <div className="card-text">{c.text}</div>
    </div>
  );
}

export function CollapseCard({ cards }: { cards: Card[] }) {
  const collapse = cards.find((c) => c.type === "collapse");
  if (!collapse) return null;
  return (
    <div className="collapse-card" key={collapse.id}>
      <div className="collapse-text">{collapse.text}</div>
    </div>
  );
}

export function EventCards({ replay, max = 4 }: { replay: Replay; max?: number }) {
  const cards = useEventCardList(replay, max);
  const collapse = cards.find((c) => c.type === "collapse");
  const rest = cards.filter((c) => c.type !== "collapse");
  return (
    <>
      <div className="cards">
        {rest.map((c) => (
          <div key={c.id} className={`card card-${c.type}`}>
            {c.kicker && <div className="card-kicker">{c.kicker}</div>}
            <div className="card-text">{c.text}</div>
          </div>
        ))}
      </div>
      {collapse && (
        <div className="collapse-card" key={collapse.id}>
          <div className="collapse-text">{collapse.text}</div>
        </div>
      )}
    </>
  );
}
