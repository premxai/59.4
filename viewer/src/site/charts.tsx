// Small hand-rolled SVG chart toolkit for the Evidence site (no chart library).
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ticksOf } from "./data";

export function useWidth<T extends HTMLElement>(fallback = 800): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number]; invert: (px: number) => number };

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as Scale;
  f.domain = domain;
  f.range = range;
  f.invert = (px: number) => (k ? d0 + (px - r0) / k : d0);
  return f;
}

export function logScale(domain: [number, number], range: [number, number]): Scale {
  const l0 = Math.log10(Math.max(1, domain[0]));
  const l1 = Math.log10(Math.max(1, domain[1]));
  const lin = linear([l0, l1], range);
  const f = ((v: number) => lin(Math.log10(Math.max(1, v)))) as Scale;
  f.domain = domain;
  f.range = range;
  f.invert = (px: number) => 10 ** lin.invert(px);
  return f;
}

/** "Nice" ticks for a linear domain. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo];
  const span = hi - lo;
  const step0 = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Decade ticks (1, 2, 5 × 10^n) for a log domain. */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(Math.max(1, lo))); e <= Math.ceil(Math.log10(Math.max(1, hi))); e++)
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  return out;
}

export function linePath(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

export function stepPath(pts: [number, number][]): string {
  let d = "";
  pts.forEach(([x, y], i) => {
    if (!i) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
    else d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
  });
  return d;
}

export function areaPath(top: [number, number][], bottom: [number, number][]): string {
  if (!top.length) return "";
  return `${linePath(top)}L${[...bottom]
    .reverse()
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join("L")}Z`;
}

/** Floating tooltip positioned inside a relative container; flips to stay in bounds. */
export function Tip({ x, y, width, children, show }: { x: number; y: number; width: number; children: ReactNode; show: boolean }) {
  const tipW = 340;
  const left = x + 16 + tipW > width ? Math.max(0, x - 16 - tipW) : x + 16;
  return (
    <div className={`s-tip ${show ? "s-tip-on" : ""}`} style={{ left, top: Math.max(0, y - 12), width: tipW }} role="tooltip">
      {children}
    </div>
  );
}

/** Per-storm pass/fail ticks as small squares. */
export function Ticks({ ticks, names, size = "md" }: { ticks: string | null | undefined; names?: string[]; size?: "sm" | "md" }) {
  const t = ticksOf(ticks);
  if (!t.length) return <span className="s-dim">–</span>;
  return (
    <span className={`s-ticks s-ticks-${size}`} aria-label={`${t.filter((x) => x === "pass").length} of ${t.length} passed`}>
      {t.map((k, i) => (
        <i key={i} className={`s-tick s-tick-${k}`} title={names?.[i] ? `${names[i]}: ${k === "pass" ? "passed" : k === "fail" ? "failed" : "n/a"}` : undefined} />
      ))}
    </span>
  );
}
