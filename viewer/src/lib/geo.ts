// Geographic assets + the one projection every layer uses.
// Equirectangular, scaled by cos(LAT0): 1 world unit ~ 10 km horizontally.

export const LAT0 = 31.25;
export const LON0 = -100.0;
export const KY = 11.132; // units per degree latitude (111.32 km / 10 km)
export const KX = KY * Math.cos((LAT0 * Math.PI) / 180);
/** Vertical exaggeration: units per meter of elevation (true scale would be 0.0001). */
export const VSCALE = 0.0016;
/** Land sits on a thin slab above the Gulf plane (y = 0) so the coast reads crisply. */
export const LAND_BASE = 0.06;
export const SEA_FLOOR = -0.6;
/** Center of attention (between the Permian and the I-35 corridor). */
export const FOCUS = { lon: -99.2, lat: 31.0 };

export type Ring = [number, number][];

export interface GeoDoc {
  bbox: [number, number, number, number];
  terrain: { file: string; w: number; h: number };
  lights: { file: string; w: number; h: number };
  texas: Ring[];
  permian: Ring[];
}

export interface Geo extends GeoDoc {
  heights: Float32Array; // meters, signed (<= 0 = sea), row 0 = north
  mask: Uint8Array; // Texas mask 0..255
  hw: number;
  hh: number;
  heightAt: (lon: number, lat: number) => number; // world units
  insideTexas: (lon: number, lat: number) => boolean;
  toWorld: (lon: number, lat: number, lift?: number) => [number, number, number];
}

export function lonLatToXZ(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * KX, -(lat - LAT0) * KY];
}

export function xzToLonLat(x: number, z: number): [number, number] {
  return [x / KX + LON0, -z / KY + LAT0];
}

const base = () => import.meta.env.BASE_URL;

async function decodePng(url: string): Promise<ImageData> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

let geoPromise: Promise<Geo> | null = null;

export function loadGeo(): Promise<Geo> {
  if (geoPromise) return geoPromise;
  geoPromise = (async () => {
    const doc = (await (await fetch(`${base()}geo/geo.json`)).json()) as GeoDoc;
    const img = await decodePng(`${base()}geo/${doc.terrain.file}`);
    const w = img.width;
    const h = img.height;
    const heights = new Float32Array(w * h);
    const mask = new Uint8Array(w * h);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      const m = d[i * 4] * 256 + d[i * 4 + 1] - 1000;
      heights[i] = m;
      mask[i] = d[i * 4 + 2];
    }
    const [lonMin, latMin, lonMax, latMax] = doc.bbox;
    const sample = (arr: ArrayLike<number>, lon: number, lat: number) => {
      const fx = ((lon - lonMin) / (lonMax - lonMin)) * w - 0.5;
      const fy = ((latMax - lat) / (latMax - latMin)) * h - 0.5;
      const x0 = Math.max(0, Math.min(w - 2, Math.floor(fx)));
      const y0 = Math.max(0, Math.min(h - 2, Math.floor(fy)));
      const tx = Math.max(0, Math.min(1, fx - x0));
      const ty = Math.max(0, Math.min(1, fy - y0));
      const i = y0 * w + x0;
      return (
        arr[i] * (1 - tx) * (1 - ty) + arr[i + 1] * tx * (1 - ty) + arr[i + w] * (1 - tx) * ty + arr[i + w + 1] * tx * ty
      );
    };
    const heightAt = (lon: number, lat: number) => {
      const m = sample(heights, lon, lat);
      return m > 0 ? LAND_BASE + m * VSCALE : LAND_BASE * 0.5;
    };
    const insideTexas = (lon: number, lat: number) => sample(mask, lon, lat) > 127;
    const toWorld = (lon: number, lat: number, lift = 0): [number, number, number] => {
      const [x, z] = lonLatToXZ(lon, lat);
      return [x, heightAt(lon, lat) + lift, z];
    };
    return { ...doc, heights, mask, hw: w, hh: h, heightAt, insideTexas, toWorld };
  })();
  return geoPromise;
}

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic hash -> [0, 1). Used for per-plant outage order and layout jitter. */
export function hash01(n: number, salt = 0): number {
  let x = (n * 374761393 + salt * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
