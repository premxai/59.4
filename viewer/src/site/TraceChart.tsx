// Compact per-hour trace of one (or several overlaid) storm runs: frequency with the 59.4 Hz line,
// homes in the dark, supply vs demand, and the operator's real steps as markers.
import { areaPath, linePath, linear, niceTicks, useWidth } from "./charts";
import { fmtHomes, stepKind, type StepGroup } from "./data";
import type { LitePoint } from "./replays";

export interface TraceSeries {
  key: string;
  label: string;
  color: string;
  points: LitePoint[];
}

export interface TraceScales {
  maxH: number;
  maxHomes: number;
  powerLo: number;
  powerHi: number;
}

export function traceScales(all: LitePoint[][]): TraceScales {
  const pts = all.flat();
  const maxH = Math.max(1, ...all.map((p) => (p.length ? p[p.length - 1].h : 0)));
  const maxHomes = Math.max(1, ...pts.map((p) => p.homesDark));
  const pw = pts.flatMap((p) => [p.supply, p.demand]).filter((v) => v > 0);
  return { maxH, maxHomes, powerLo: pw.length ? Math.min(...pw) * 0.92 : 0, powerHi: pw.length ? Math.max(...pw) * 1.04 : 1 };
}

const ML = 52;
const MR = 12;
const F_LO = 58.8;
const F_HI = 60.1;

export function TraceChart({
  series,
  scales,
  markers,
  hover,
  onHover,
  onPick,
  ariaLabel,
  showPower = true,
}: {
  series: TraceSeries[];
  scales: TraceScales;
  markers?: StepGroup[];
  hover: number | null;
  onHover: (h: number | null) => void;
  onPick?: (h: number) => void;
  ariaLabel: string;
  showPower?: boolean;
}) {
  const [ref, W] = useWidth<HTMLDivElement>(520);
  const iw = Math.max(120, W - ML - MR);
  const x = linear([0, scales.maxH], [ML, ML + iw]);
  const MK = markers?.length ? 22 : 0;
  const P1 = { t: MK + 18, h: 92 }; // frequency
  const P2 = { t: P1.t + P1.h + 30, h: 78 }; // homes dark
  const P3 = { t: P2.t + P2.h + 30, h: 78 }; // supply/demand
  const H = (showPower ? P3.t + P3.h : P2.t + P2.h) + 26;
  const yF = linear([F_LO, F_HI], [P1.t + P1.h, P1.t]);
  const yD = linear([0, scales.maxHomes], [P2.t + P2.h, P2.t]);
  const yP = linear([scales.powerLo, scales.powerHi], [P3.t + P3.h, P3.t]);
  const xt = niceTicks(0, scales.maxH, Math.max(3, Math.floor(iw / 80)));
  const hd = niceTicks(0, scales.maxHomes, 2);
  const pwT = niceTicks(scales.powerLo, scales.powerHi, 2);
  const single = series.length === 1;

  const move = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const h = Math.round(x.invert(e.clientX - r.left + ML));
    onHover(Math.max(0, Math.min(scales.maxH, h)));
  };

  return (
    <div className="s-trace" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={ariaLabel}>
        {/* markers strip */}
        {markers && MK > 0 && (
          <g>
            <text className="s-ax" x={ML - 8} y={13} textAnchor="end">
              steps
            </text>
            {markers.map((m, i) => {
              const k = stepKind(m.type);
              return (
                <rect
                  key={i}
                  className={`s-mk s-mk-${k.tone}`}
                  x={x(m.h0) - 1}
                  y={k.tone === "ai" ? 2 : k.tone === "bad" ? 2 : 8}
                  width={Math.max(2, x(m.h1) - x(m.h0) + 2)}
                  height={k.tone === "ai" || k.tone === "bad" ? 16 : 10}
                  rx={1}
                />
              );
            })}
          </g>
        )}
        {/* panel titles */}
        <text className="s-ax-title" x={ML} y={P1.t - 6}>
          Frequency, lowest in the hour (Hz)
        </text>
        <text className="s-ax-title" x={ML} y={P2.t - 6}>
          Homes in the dark
        </text>
        {showPower && (
          <text className="s-ax-title" x={ML} y={P3.t - 6}>
            Supply <tspan className="s-dim">vs</tspan> demand (GW)
          </text>
        )}
        {/* frequency */}
        {[59, 59.4, 60].map((v) => (
          <g key={v}>
            <line className={v === 59.4 ? "s-line594" : "s-grid"} x1={ML} x2={ML + iw} y1={yF(v)} y2={yF(v)} />
            <text className={`s-ax ${v === 59.4 ? "s-ax-bad" : ""}`} x={ML - 6} y={yF(v) + 4} textAnchor="end">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = s.points.filter((p) => p.freq != null && p.freq > 0).map((p) => [x(p.h), yF(Math.max(F_LO, Math.min(F_HI, p.freq!)))] as [number, number]);
          return <path key={s.key} d={linePath(pts)} fill="none" stroke={single ? "var(--ink2)" : s.color} strokeWidth={single ? 1.2 : 1.3} />;
        })}
        {/* collapse shading (frequency 0 = grid down) */}
        {series.map((s) => {
          const c = s.points.find((p) => p.freq != null && p.freq <= 0);
          return c ? <rect key={s.key} className="s-collapse" x={x(c.h)} y={P1.t} width={ML + iw - x(c.h)} height={P1.h} /> : null;
        })}
        {/* homes dark */}
        {hd.map((v) => (
          <g key={v}>
            <line className="s-grid" x1={ML} x2={ML + iw} y1={yD(v)} y2={yD(v)} />
            <text className="s-ax" x={ML - 6} y={yD(v) + 4} textAnchor="end">
              {v ? fmtHomes(v).replace(" ", "") : "0"}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const top = s.points.map((p) => [x(p.h), yD(p.homesDark)] as [number, number]);
          const base = s.points.map((p) => [x(p.h), yD(0)] as [number, number]);
          return single ? (
            <path key={s.key} d={areaPath(top, base)} className="s-darkarea" />
          ) : (
            <path key={s.key} d={linePath(top)} fill="none" stroke={s.color} strokeWidth={1.4} />
          );
        })}
        {/* supply / demand */}
        {showPower &&
          pwT.map((v) => (
            <g key={v}>
              <line className="s-grid" x1={ML} x2={ML + iw} y1={yP(v)} y2={yP(v)} />
              <text className="s-ax" x={ML - 6} y={yP(v) + 4} textAnchor="end">
                {Math.round(v / 1000)}
              </text>
            </g>
          ))}
        {showPower &&
          series.map((s) => (
            <g key={s.key}>
              <path d={linePath(s.points.map((p) => [x(p.h), yP(Math.max(scales.powerLo, p.supply))]))} fill="none" stroke={single ? "var(--ink)" : s.color} strokeWidth={1.3} />
              <path d={linePath(s.points.map((p) => [x(p.h), yP(Math.max(scales.powerLo, p.demand))]))} fill="none" stroke={single ? "var(--ink3)" : s.color} strokeWidth={1.1} strokeDasharray="3 3" />
            </g>
          ))}
        {/* x axis */}
        {xt.map((v) => (
          <text key={v} className="s-ax" x={x(v)} y={H - 8} textAnchor="middle">
            h{v}
          </text>
        ))}
        {/* crosshair */}
        {hover != null && <line className="s-cross" x1={x(hover)} x2={x(hover)} y1={MK ? 0 : P1.t} y2={H - 22} />}
        <rect
          className="s-hit"
          x={ML}
          y={0}
          width={iw}
          height={H - 20}
          onMouseMove={move}
          onMouseLeave={() => onHover(null)}
          onClick={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const h = Math.round(x.invert(e.clientX - r.left + ML));
            onPick?.(Math.max(0, Math.min(scales.maxH, h)));
          }}
        />
      </svg>
    </div>
  );
}

export function readout(points: LitePoint[], h: number | null): LitePoint | null {
  if (h == null || !points.length) return null;
  let best = points[0];
  for (const p of points) if (Math.abs(p.h - h) < Math.abs(best.h - h)) best = p;
  return best;
}
