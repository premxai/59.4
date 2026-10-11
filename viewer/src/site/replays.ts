// Minimal loader for the showcase replays (437-replay/1): only the per-hour series the charts need.
import { useEffect, useState } from "react";
import { missionUrl } from "./data";

export interface LitePoint {
  h: number;
  freq: number | null; // minimum frequency within the hour (Hz)
  demand: number;
  supply: number;
  reserve: number;
  shedFrac: number;
  homesDark: number;
  gas: number | null;
}

export interface LiteReplay {
  name: string;
  points: LitePoint[];
  meta: {
    label?: string;
    scenario_id?: string;
    seed?: number;
    hours?: number;
    harness?: { id?: string; hash?: string };
    model?: { operator: string; weights_frozen?: boolean; fine_tune_runs?: number };
    collapsed?: boolean;
    collapse_hour?: number | null;
    totals?: { homes_dark_hours?: number; peak_homes_dark?: number; min_freq_hz?: number };
    passed?: boolean;
    verdict_plain?: string;
    peak_shed_frac?: number;
    start_utc?: string;
  };
}

const cache = new Map<string, Promise<LiteReplay>>();
const n = (x: unknown, d = 0) => (typeof x === "number" && Number.isFinite(x) ? x : d);

export function loadLite(name: string, url = missionUrl(name)): Promise<LiteReplay> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { meta?: LiteReplay["meta"]; frames?: Record<string, unknown>[] }) => ({
        name,
        meta: j.meta ?? {},
        points: (j.frames ?? []).map((f, i) => ({
          h: n(f.h, i),
          freq: typeof f.freq_min_hz === "number" ? f.freq_min_hz : typeof f.freq_hz === "number" ? f.freq_hz : null,
          demand: n(f.demand_mw),
          supply: n(f.supply_mw),
          reserve: n(f.reserve_mw),
          shedFrac: Math.max(0, Math.min(1, n(f.shed_frac))),
          homesDark: Math.max(0, n(f.homes_dark)),
          gas: typeof f.gas_supply_frac === "number" ? f.gas_supply_frac : null,
        })),
      }));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export function useLite(name: string | null | undefined): { replay: LiteReplay | null; error: string | null } {
  const [state, setState] = useState<{ replay: LiteReplay | null; error: string | null; name?: string | null }>({ replay: null, error: null });
  useEffect(() => {
    if (!name) {
      setState({ replay: null, error: null, name });
      return;
    }
    let alive = true;
    loadLite(name).then(
      (r) => alive && setState({ replay: r, error: null, name }),
      (e) => alive && setState({ replay: null, error: e instanceof Error ? e.message : String(e), name }),
    );
    return () => {
      alive = false;
    };
  }, [name]);
  return state.name === name ? state : { replay: null, error: null };
}
