"""Build the viewer's geo web assets from approved raw downloads.

Run from anywhere (isolated mode recommended):
    D:\\dev\\MongoDB\\.venv\\Scripts\\python.exe -I viewer/scripts/geo/build_geo.py

Inputs (raw, untrusted data, parsed only):
    data/raw/geo_boundary/gz_2010_us_040_00_500k.json   (US Census cartographic boundary, via eric.clst.org)
    data/raw/geo_terrain/z7/{x}_{y}.png                  (AWS Terrain Tiles, terrarium encoding; downloaded here if missing)
    data/raw/geo_blackmarble/BlackMarble_2016_A1_geo_gray.tif  (NASA Black Marble 2016, 15 arcsec, tile A1)
    data/raw/geo_permian/extracted/PermianBasin_Extent_201712.shp  (EIA)

Outputs (viewer/public/geo/):
    geo.json        bbox + Texas outline (simplified) + Permian outline
    terrain.png     RGB: R,G = (elev_m + 1000) as 16-bit big-endian, B = Texas mask (antialiased)
    lights.png      8-bit grayscale night lights cropped to bbox (pre-2021 composite)

All rasters share one equirectangular lon/lat grid over BBOX (north row first).
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np
import requests
import shapefile  # pyshp
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "viewer" / "public" / "geo"

# lon_min, lat_min, lon_max, lat_max
BBOX = (-107.0, 25.5, -93.0, 37.0)
TERRAIN_W = 1024
LIGHTS_W = 2048
ZOOM = 7


def grid_hw(width: int) -> tuple[int, int]:
    lon_min, lat_min, lon_max, lat_max = BBOX
    h = int(round(width * (lat_max - lat_min) / (lon_max - lon_min)))
    return width, h


# ---------------------------------------------------------------- boundary
def load_texas() -> list[list[tuple[float, float]]]:
    src = RAW / "geo_boundary" / "gz_2010_us_040_00_500k.json"
    data = json.loads(src.read_text(encoding="latin-1"))
    feats = [f for f in data["features"] if f["properties"].get("NAME") == "Texas"]
    assert len(feats) == 1, "Texas not found"
    geom = feats[0]["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings = []
    for poly in polys:
        outer = poly[0]
        rings.append([(float(x), float(y)) for x, y in outer])
    rings.sort(key=len, reverse=True)
    return rings


def dp_simplify(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas-Peucker (iterative). Closed rings are split at the farthest vertex."""
    if len(pts) < 3:
        return pts
    if pts[0] == pts[-1]:
        a0 = np.asarray(pts)
        m = int(np.argmax(np.hypot(*(a0 - a0[0]).T)))
        left = _dp(pts[: m + 1], tol)
        right = _dp(pts[m:], tol)
        return left[:-1] + right
    return _dp(pts, tol)


def _dp(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    a = np.asarray(pts)
    keep = np.zeros(len(a), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = a[i], a[j]
        seg = q - p
        seg_len = np.hypot(*seg) or 1e-12
        rel = a[i + 1 : j] - p
        d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / seg_len
        k = int(np.argmax(d))
        if d[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack.append((i, m))
            stack.append((m, j))
    return [tuple(map(float, x)) for x in a[keep]]


def lonlat_to_px(lon: float, lat: float, w: int, h: int) -> tuple[float, float]:
    lon_min, lat_min, lon_max, lat_max = BBOX
    return ((lon - lon_min) / (lon_max - lon_min) * w, (lat_max - lat) / (lat_max - lat_min) * h)


def texas_mask(rings, w: int, h: int, ss: int = 4) -> np.ndarray:
    big = Image.new("L", (w * ss, h * ss), 0)
    dr = ImageDraw.Draw(big)
    for ring in rings:
        dr.polygon([lonlat_to_px(x, y, w * ss, h * ss) for x, y in ring], fill=255)
    return np.asarray(big.resize((w, h), Image.BOX), dtype=np.uint8)


# ---------------------------------------------------------------- terrain
def tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    lr = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lr)) / math.pi) / 2.0 * n
    return x, y


def fetch_tiles() -> dict[tuple[int, int], Path]:
    lon_min, lat_min, lon_max, lat_max = BBOX
    x0, y0 = tile_xy(lon_min, lat_max, ZOOM)
    x1, y1 = tile_xy(lon_max, lat_min, ZOOM)
    d = RAW / "geo_terrain" / f"z{ZOOM}"
    d.mkdir(parents=True, exist_ok=True)
    out = {}
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            p = d / f"{x}_{y}.png"
            if not p.exists():
                url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png"
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                p.write_bytes(r.content)
                time.sleep(0.05)
            out[(x, y)] = p
    return out


def build_terrain(tiles, mask: np.ndarray, w: int, h: int) -> np.ndarray:
    xs = sorted({k[0] for k in tiles})
    ys = sorted({k[1] for k in tiles})
    mos = np.zeros((len(ys) * 256, len(xs) * 256), dtype=np.float32)
    for (x, y), p in tiles.items():
        im = np.asarray(Image.open(p).convert("RGB"), dtype=np.float32)
        elev = im[..., 0] * 256.0 + im[..., 1] + im[..., 2] / 256.0 - 32768.0
        r, c = ys.index(y), xs.index(x)
        mos[r * 256 : (r + 1) * 256, c * 256 : (c + 1) * 256] = elev
    lon_min, lat_min, lon_max, lat_max = BBOX
    lons = lon_min + (np.arange(w) + 0.5) / w * (lon_max - lon_min)
    lats = lat_max - (np.arange(h) + 0.5) / h * (lat_max - lat_min)
    n = 2**ZOOM
    px = ((lons + 180.0) / 360.0 * n - xs[0]) * 256.0 - 0.5
    lr = np.radians(lats)
    py = ((1.0 - np.arcsinh(np.tan(lr)) / np.pi) / 2.0 * n - ys[0]) * 256.0 - 0.5
    PX, PY = np.meshgrid(px, py)
    x0 = np.clip(np.floor(PX).astype(int), 0, mos.shape[1] - 2)
    y0 = np.clip(np.floor(PY).astype(int), 0, mos.shape[0] - 2)
    fx = np.clip(PX - x0, 0, 1)
    fy = np.clip(PY - y0, 0, 1)
    e = (
        mos[y0, x0] * (1 - fx) * (1 - fy)
        + mos[y0, x0 + 1] * fx * (1 - fy)
        + mos[y0 + 1, x0] * (1 - fx) * fy
        + mos[y0 + 1, x0 + 1] * fx * fy
    )
    v = np.clip(np.round(e + 1000.0), 0, 65535).astype(np.uint16)
    rgb = np.zeros((h, w, 3), dtype=np.uint8)
    rgb[..., 0] = (v >> 8).astype(np.uint8)
    rgb[..., 1] = (v & 255).astype(np.uint8)
    rgb[..., 2] = mask
    Image.fromarray(rgb, "RGB").save(OUT / "terrain.png", optimize=True)
    return e


# ---------------------------------------------------------------- lights
def build_lights(w: int, h: int) -> np.ndarray:
    src = RAW / "geo_blackmarble" / "BlackMarble_2016_A1_geo_gray.tif"
    Image.MAX_IMAGE_PIXELS = None  # 21600 x 21600 NASA tile (approved source)
    im = Image.open(src)
    # Tile A1: lon -180..-90, lat 90..0, 21600 px each way (15 arcsec)
    res = 90.0 / im.width
    lon_min, lat_min, lon_max, lat_max = BBOX
    box = (
        int(round((lon_min + 180.0) / res)),
        int(round((90.0 - lat_max) / res)),
        int(round((lon_max + 180.0) / res)),
        int(round((90.0 - lat_min) / res)),
    )
    crop = im.crop(box).convert("L")
    crop = crop.resize((w, h), Image.LANCZOS)
    a = np.asarray(crop, dtype=np.float32)
    print("lights raw percentiles", np.percentile(a, [5, 50, 90, 99, 99.9]).round(1))
    # Remove the faint moonlit-ground floor so only artificial light remains.
    floor = float(np.percentile(a, 55))
    a = np.clip((a - floor) / (255.0 - floor), 0, 1)
    out = (np.clip(a, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    Image.fromarray(out, "L").save(OUT / "lights.png", optimize=True)
    return out


# ---------------------------------------------------------------- permian
def load_permian() -> list[list[tuple[float, float]]]:
    shp = RAW / "geo_permian" / "extracted" / "PermianBasin_Extent_201712.shp"
    r = shapefile.Reader(str(shp))
    rings = []
    for s in r.shapes():
        pts = s.points
        parts = list(s.parts) + [len(pts)]
        for i in range(len(parts) - 1):
            ring = [(float(x), float(y)) for x, y in pts[parts[i] : parts[i + 1]]]
            rings.append(ring)
    rings.sort(key=len, reverse=True)
    return rings


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tw, th = grid_hw(TERRAIN_W)
    lw, lh = grid_hw(LIGHTS_W)

    rings = load_texas()
    tx_simpl = [dp_simplify(r, 0.004) for r in rings]
    tx_simpl = [r for r in tx_simpl if len(r) >= 4]
    print("texas rings", len(rings), "->", len(tx_simpl), "points", sum(map(len, tx_simpl)))
    mask = texas_mask(rings, tw, th)

    tiles = fetch_tiles()
    print("terrain tiles", len(tiles))
    elev = build_terrain(tiles, mask, tw, th)
    inside = mask > 127
    print("elev texas min/max", float(elev[inside].min()), float(elev[inside].max()))

    build_lights(lw, lh)

    perm = load_permian()
    perm_s = [dp_simplify(r, 0.01) for r in perm]
    print("permian rings", len(perm), "points", sum(map(len, perm_s)))

    geo = {
        "bbox": list(BBOX),
        "terrain": {"file": "terrain.png", "w": tw, "h": th, "encoding": "R*256+G-1000 = meters; B = Texas mask"},
        "lights": {"file": "lights.png", "w": lw, "h": lh, "source": "NASA Black Marble 2016 (grayscale), floor-subtracted"},
        "texas": [[[round(x, 4), round(y, 4)] for x, y in r] for r in tx_simpl],
        "permian": [[[round(x, 4), round(y, 4)] for x, y in r] for r in perm_s],
    }
    (OUT / "geo.json").write_text(json.dumps(geo, separators=(",", ":")), encoding="utf-8")
    for f in ("geo.json", "terrain.png", "lights.png"):
        print(f, os.path.getsize(OUT / f))


if __name__ == "__main__":
    sys.exit(main())
