// Navy night, amber lights; red/green only for status.
export const FOG_COLOR = "#060b1a";
export const FOG_DENSITY = 0.0042;
export const BG_COLOR = "#03060f";

export const FUEL_COLOR: Record<string, [number, number, number]> = {
  gas: [1.0, 0.62, 0.22], // amber
  coal: [0.85, 0.5, 0.32], // ember
  nuclear: [0.55, 0.8, 1.0], // cool white-blue
  wind: [0.85, 0.9, 1.0], // white
  other: [0.7, 0.7, 0.75],
};

export const STATUS = {
  ok: [0.25, 1.0, 0.55] as [number, number, number],
  warn: [1.0, 0.68, 0.15] as [number, number, number],
  bad: [1.0, 0.18, 0.12] as [number, number, number],
};

/** Status color for frequency: green near 60 Hz -> amber -> red at the 59.4 Hz trip line. */
export function freqColor(f: number | null): [number, number, number] {
  if (f == null || f <= 0) return [0.25, 0.04, 0.03];
  const { ok, warn, bad } = STATUS;
  if (f >= 59.9) return ok;
  if (f >= 59.7) {
    const t = (59.9 - f) / 0.2;
    return [ok[0] + (warn[0] - ok[0]) * t, ok[1] + (warn[1] - ok[1]) * t, ok[2] + (warn[2] - ok[2]) * t];
  }
  const t = Math.min(1, (59.7 - f) / 0.3);
  return [warn[0] + (bad[0] - warn[0]) * t, warn[1] + (bad[1] - warn[1]) * t, warn[2] + (bad[2] - warn[2]) * t];
}
