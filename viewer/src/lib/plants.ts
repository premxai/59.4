// Plant + city data. Plants are filtered to the replay's fleet (meta.fleet_year / start_utc),
// never the 2025 fleet.
import type { ReplayMeta } from "./replay";

export interface Plant {
  id: number;
  name: string;
  lat: number;
  lon: number;
  fuel: string;
  fuelDetail: string;
  mw: number;
  opYm: number | null;
  retYm: number | null;
}

export interface City {
  name: string;
  lat: number;
  lon: number;
  population: number;
}

let plantsP: Promise<Plant[]> | null = null;
let citiesP: Promise<City[]> | null = null;

export function loadPlants(): Promise<Plant[]> {
  if (!plantsP)
    plantsP = fetch(`${import.meta.env.BASE_URL}geo/plants.json`)
      .then((r) => r.json())
      .then((doc: { rows: [number, string, number, number, string, string, number, number | null, number | null][] }) =>
        doc.rows.map(([id, name, lat, lon, fuel, fuelDetail, mw, opYm, retYm]) => ({
          id,
          name,
          lat,
          lon,
          fuel,
          fuelDetail,
          mw,
          opYm,
          retYm,
        })),
      );
  return plantsP;
}

export function loadCities(): Promise<City[]> {
  if (!citiesP) citiesP = fetch(`${import.meta.env.BASE_URL}geo/cities.json`).then((r) => r.json());
  return citiesP;
}

/** Plants online at the replay's start: first unit online by then, not fully retired. */
export function fleetFor(plants: Plant[], meta: ReplayMeta): Plant[] {
  const start = new Date(meta.start_utc);
  const year = meta.fleet_year ?? start.getUTCFullYear();
  const ym = Number.isFinite(start.getTime()) && start.getUTCFullYear() === year ? year * 12 + start.getUTCMonth() : year * 12 + 11;
  return plants.filter((p) => (p.opYm == null || p.opYm <= ym) && (p.retYm == null || p.retYm > ym));
}
