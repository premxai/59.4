// Light-layer manifests produced by scripts/layers/build_layers.py.
export type Rect = [number, number, number, number]; // normalized x, y, w, h (y down)

export interface LayerRef {
  file: string;
  rect: Rect;
}

export type Anchors = Record<string, [number, number]>; // image pixels, y down

export interface CamManifest {
  cam: string;
  width: number;
  height: number;
  bases: Record<string, string>; // "sky0_snow0" ... "sky1_snow1"
  zones: Record<string, LayerRef | null>;
  infra: Record<string, LayerRef | null>;
  steam: Record<string, LayerRef>; // "sky0" | "sky05" | "sky1"
  anchors_auto?: Anchors;
  placeholder?: boolean;
}

const cache = new Map<string, Promise<{ man: CamManifest; anchors: Anchors }>>();

/** Fallback anchor positions (fractions of the image) when neither anchors.json nor auto anchors exist. */
const DEFAULT_ANCHORS: Record<string, [number, number]> = {
  downtown: [0.5, 0.48],
  hospital: [0.56, 0.52],
  pumpjacks: [0.22, 0.72],
  gas_plant: [0.84, 0.56],
  wind_farm: [0.4, 0.3],
  battery: [0.3, 0.45],
};

export function loadCam(cam: string): Promise<{ man: CamManifest; anchors: Anchors }> {
  let p = cache.get(cam);
  if (!p) {
    p = (async () => {
      const base = `${import.meta.env.BASE_URL}layers/${cam}/`;
      const res = await fetch(`${base}manifest.json`, { cache: "no-store" }).catch(() => null);
      const ok = res?.ok && (res.headers.get("content-type") ?? "").includes("json");
      if (!ok) throw new Error(`No light layers for ${cam}. Run: .venv\\Scripts\\python.exe -I viewer/scripts/layers/build_layers.py`);
      const man = (await res!.json()) as CamManifest;
      let hand: Anchors | null = null;
      try {
        const a = await fetch(`${base}anchors.json`, { cache: "no-store" });
        if (a.ok && (a.headers.get("content-type") ?? "").includes("json")) hand = (await a.json()) as Anchors;
      } catch {
        hand = null;
      }
      const anchors: Anchors = {};
      for (const [k, [fx, fy]] of Object.entries(DEFAULT_ANCHORS)) anchors[k] = [fx * man.width, fy * man.height];
      Object.assign(anchors, man.anchors_auto ?? {}, hand ?? {});
      return { man, anchors };
    })();
    cache.set(cam, p);
  }
  return p;
}

export function layerUrl(cam: string, file: string): string {
  return `${import.meta.env.BASE_URL}layers/${cam}/${file}`;
}

/**
 * "Cover" fit of an image (iw x ih) into a box (cw x ch): scale + offset in box pixels.
 * Used identically by the shader (uFit) and the HTML anchors so cards point at the right pixel.
 */
export function coverFit(cw: number, ch: number, iw: number, ih: number) {
  const s = Math.max(cw / iw, ch / ih);
  return { s, ox: (cw - iw * s) / 2, oy: (ch - ih * s) / 2 };
}
