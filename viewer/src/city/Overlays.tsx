// HTML/SVG overlays for the city view: frequency ring + countdown, anchored cards, Texas inset.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useClock } from "../lib/clock";
import type { Replay } from "../lib/replay";
import { countdownAt, fmtClock, frameIndex, isCollapsedAt, regionTemp } from "../lib/replay";
import { freqColor } from "../scene/palette";
import { CardView, useHourInt, type Card } from "../ui/Hud";
import { coverFit, type Anchors, type CamManifest } from "./layers";

export function useBoxSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

// ------------------------------------------------------------------ frequency ring
const RING_FULL_S = 540; // the 9-minute rule

export function FreqRing2D({ replay, size = 92 }: { replay: Replay; size?: number }) {
  const h = useHourInt();
  const f = replay.frames[frameIndex(replay, h)];
  const collapsed = isCollapsedAt(replay, h);
  const cd = useClock((s) => countdownAt(replay, s.hour));
  const fm = collapsed ? 0 : (f.freq_min_hz ?? 60);
  const [r, g, b] = freqColor(fm);
  const col = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  const status = collapsed
    ? "Grid down"
    : cd != null
      ? "Grid failing"
      : fm < 59.7
        ? "Grid in danger"
        : fm < 59.9
          ? "Grid strained"
          : "Grid steady";
  const danger = collapsed ? 0 : Math.max(0, Math.min(1, (60 - fm) / 0.6));
  const R = 40;
  const C = 2 * Math.PI * R;
  const frac = cd != null ? Math.max(0, Math.min(1, cd / RING_FULL_S)) : 1;
  return (
    <div className={`fring ${cd != null ? "fring-counting" : ""} ${collapsed ? "fring-down" : ""}`} style={{ width: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ filter: `drop-shadow(0 0 ${6 + danger * 10}px ${col})` }}>
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(140,165,230,0.18)" strokeWidth="3" />
        <circle
          className="fring-arc"
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={col}
          strokeWidth={cd != null ? 5 : 3.5}
          strokeLinecap="round"
          strokeDasharray={`${C * frac} ${C}`}
          transform="rotate(-90 50 50)"
          style={{ animationDuration: `${Math.max(0.35, 2.4 - danger * 2)}s`, opacity: collapsed ? 0.35 : 1 }}
        />
        {cd != null ? (
          <text x="50" y="57" textAnchor="middle" className="fring-cd">
            {fmtClock(cd)}
          </text>
        ) : (
          <circle cx="50" cy="50" r={collapsed ? 3 : 4} fill={col} opacity={collapsed ? 0.4 : 0.9} />
        )}
      </svg>
      <div className="fring-label" style={{ color: collapsed || cd != null ? col : undefined }}>
        {status}
      </div>
      {cd != null && <div className="fring-sub">until the whole grid shuts down</div>}
    </div>
  );
}

// ------------------------------------------------------------------ anchored cards
export function AnchoredCards({ cards, man, anchors, box }: { cards: Card[]; man: CamManifest; anchors: Anchors; box: { w: number; h: number } }) {
  const latest = new Map<string, Card>();
  for (const c of cards) if (c.anchor && anchors[c.anchor]) latest.set(c.anchor, c);
  if (!box.w || !latest.size) return null;
  const { s, ox, oy } = coverFit(box.w, box.h, man.width, man.height);
  const CW = Math.min(300, box.w * 0.42);
  const CH = 74; // approx card height incl. gap, for overlap avoidance
  const placed: { x: number; y: number }[] = [];
  const items = [...latest.entries()]
    .map(([key, c]) => ({ key, c, ax: ox + anchors[key][0] * s, ay: oy + anchors[key][1] * s }))
    .filter((it) => it.ax >= 0 && it.ay >= 0 && it.ax <= box.w && it.ay <= box.h)
    .sort((a, b) => a.ay - b.ay);
  return (
    <div className="anchors">
      {items.map(({ c, ax, ay }) => {
        const right = ax < box.w * 0.55;
        const cx = Math.max(12, Math.min(box.w - CW - 12, right ? ax + 36 : ax - 36 - CW));
        let cy = Math.max(150, Math.min(box.h - 170, ay - 110));
        // push down until it no longer overlaps an earlier card
        for (let guard = 0; guard < 6 && placed.some((p) => Math.abs(p.x - cx) < CW && Math.abs(p.y - cy) < CH); guard++) cy += CH;
        placed.push({ x: cx, y: cy });
        const lx = right ? cx : cx + CW;
        const ly = cy + 30;
        return (
          <div key={c.id}>
            <svg className="anchor-line" width={box.w} height={box.h}>
              <line x1={ax} y1={ay} x2={lx} y2={ly} />
            </svg>
            <div className="anchor-dot" style={{ left: ax, top: ay }} />
            <div className="anchor-card" style={{ left: cx, top: cy, width: CW }}>
              <CardView c={c} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Texas inset
interface InsetGeo {
  outline: string;
  project: (lon: number, lat: number) => [number, number];
  w: number;
  h: number;
  bbox: [number, number, number, number];
}

let insetP: Promise<InsetGeo> | null = null;
function loadInset(): Promise<InsetGeo> {
  if (!insetP)
    insetP = fetch(`${import.meta.env.BASE_URL}geo/geo.json`)
      .then((r) => r.json())
      .then((doc: { texas: [number, number][][] }) => {
        const ring = doc.texas.reduce((a, b) => (b.length > a.length ? b : a));
        let lonMin = 1e9, lonMax = -1e9, latMin = 1e9, latMax = -1e9;
        for (const [lo, la] of ring) {
          lonMin = Math.min(lonMin, lo); lonMax = Math.max(lonMax, lo);
          latMin = Math.min(latMin, la); latMax = Math.max(latMax, la);
        }
        const k = Math.cos((31 * Math.PI) / 180);
        const W = 100;
        const scale = W / ((lonMax - lonMin) * k);
        const H = (latMax - latMin) * scale;
        const project = (lon: number, lat: number): [number, number] => [(lon - lonMin) * k * scale, (latMax - lat) * scale];
        const outline = ring.map(([lo, la], i) => `${i ? "L" : "M"}${project(lo, la).map((v) => v.toFixed(1)).join(" ")}`).join("") + "Z";
        return { outline, project, w: W, h: H, bbox: [lonMin, latMin, lonMax, latMax] as [number, number, number, number] };
      });
  return insetP;
}

const CITY = new URLSearchParams(location.search).get("city") ?? "Dallas";

/** Small flat Texas: freezing area + 0 °C cold-front line from the 8 region temperatures. */
export function TexasInset({ replay }: { replay: Replay }) {
  const [geo, setGeo] = useState<InsetGeo | null>(null);
  const [city, setCity] = useState<[number, number] | null>(null);
  useEffect(() => {
    loadInset().then(setGeo).catch(() => setGeo(null));
    fetch(`${import.meta.env.BASE_URL}geo/cities.json`)
      .then((r) => r.json())
      .then((cs: { name: string; lat: number; lon: number }[]) => {
        const c = cs.find((x) => x.name.toLowerCase() === CITY.toLowerCase()) ?? cs.find((x) => x.name === "Dallas");
        if (c) setCity([c.lon, c.lat]);
      })
      .catch(() => undefined);
  }, []);
  const h = useHourInt();
  const field = useMemo(() => {
    if (!geo) return null;
    const regs = replay.meta.regions;
    const temps = regs.map((r) => regionTemp(replay, h, r.id));
    const [lonMin, latMin, lonMax, latMax] = geo.bbox;
    const NX = 36, NY = 30;
    const T = (lon: number, lat: number) => {
      let ws = 0, vs = 0;
      regs.forEach((r, i) => {
        const dx = (lon - r.lon) * 0.85;
        const dy = lat - r.lat;
        const w = 1 / (dx * dx + dy * dy + 0.2);
        ws += w;
        vs += w * temps[i];
      });
      return ws ? vs / ws : 10;
    };
    const grid: number[][] = [];
    for (let j = 0; j <= NY; j++) {
      const row: number[] = [];
      for (let i = 0; i <= NX; i++) row.push(T(lonMin + (i / NX) * (lonMax - lonMin), latMax - (j / NY) * (latMax - latMin)));
      grid.push(row);
    }
    const P = (i: number, j: number) => geo.project(lonMin + (i / NX) * (lonMax - lonMin), latMax - (j / NY) * (latMax - latMin));
    // freezing cells (row runs) and the 0 °C contour (marching squares)
    const cells: string[] = [];
    const seg: string[] = [];
    const lerp = (a: number, b: number) => a / (a - b);
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
        if ((a + b + c + d) / 4 < 0) {
          const [x0, y0] = P(i, j);
          const [x1, y1] = P(i + 1, j + 1);
          cells.push(`M${x0.toFixed(1)} ${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`);
        }
        const pts: [number, number][] = [];
        const edge = (v0: number, v1: number, p0: [number, number], p1: [number, number]) => {
          if (v0 < 0 !== v1 < 0) {
            const t = lerp(v0, v1);
            pts.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
          }
        };
        edge(a, b, P(i, j), P(i + 1, j));
        edge(b, c, P(i + 1, j), P(i + 1, j + 1));
        edge(c, d, P(i + 1, j + 1), P(i, j + 1));
        edge(d, a, P(i, j + 1), P(i, j));
        if (pts.length >= 2) seg.push(`M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`);
        if (pts.length === 4) seg.push(`M${pts[2][0].toFixed(1)} ${pts[2][1].toFixed(1)}L${pts[3][0].toFixed(1)} ${pts[3][1].toFixed(1)}`);
      }
    }
    return { cells: cells.join(""), front: seg.join("") };
  }, [geo, replay, h]);
  if (!geo || !field) return null;
  const cp = city ? geo.project(city[0], city[1]) : null;
  return (
    <div className="inset">
      <svg viewBox={`-4 -4 ${geo.w + 8} ${geo.h + 8}`} width="150" height={(150 * (geo.h + 8)) / (geo.w + 8)}>
        <defs>
          <clipPath id="tx-clip">
            <path d={geo.outline} />
          </clipPath>
        </defs>
        <path d={geo.outline} fill="rgba(10,16,36,0.75)" stroke="rgba(150,175,240,0.55)" strokeWidth="0.8" />
        <g clipPath="url(#tx-clip)">
          <path d={field.cells} fill="rgba(140,200,255,0.22)" />
          <path d={field.front} stroke="rgba(170,225,255,0.95)" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        </g>
        {cp && (
          <g>
            <circle cx={cp[0]} cy={cp[1]} r="2.2" fill="#ffd29a" />
            <circle cx={cp[0]} cy={cp[1]} r="4.5" fill="none" stroke="#ffd29a" strokeWidth="0.6" opacity="0.7" />
          </g>
        )}
      </svg>
      <div className="inset-legend">
        <span className="inset-swatch" /> below freezing · <span className="inset-city">●</span> this city
      </div>
    </div>
  );
}

export function useRefBox<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const box = useBoxSize(ref);
  return [ref, box] as const;
}
