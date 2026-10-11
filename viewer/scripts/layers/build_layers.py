"""Convert Blender light-layer stills into compact web assets for the LightLayerCompositor.

    D:\\dev\\MongoDB\\.venv\\Scripts\\python.exe -I viewer/scripts/layers/build_layers.py [--force]

Re-runnable: it skips outputs that are newer than their source unless --force is given.

Input   blender/renders/stills/{CAM}/  (naming from docs/VOYAGER_BLENDER_BRIEF.md §7):
          {CAM}__base__sky{0|05|1}__snow{0|1}.png    bases (sky included), Standard view transform
          {CAM}__zone_{01..16|crit|gas}.png          light layers, black background
          {CAM}__infra_{gasplant|lines|turbines|battery}.png
          {CAM}__overlay_steam__sky{0|05|1}.png      RGBA, straight alpha
          {CAM}__zone_id.png                         flat zone colors (anchors only, not shipped)
        blender/renders/zone_id_legend.json
Output  viewer/public/layers/{CAM}/*.webp + manifest.json
        viewer/public/layers/manifest.json           { "cams": [...] }

Light layers are cropped to the bounding box of their lit pixels. The crop rectangle is stored in
the manifest as normalized [x, y, w, h] (y down), so the browser holds only the lit part.
Anchors for pointer cards (hospital, pumpjacks, gas plant, wind farm, downtown) are derived
from the zone-id map and the infra layers, and written to manifest["anchors_auto"]. A hand-made
{CAM}/anchors.json, if present, overrides them in the viewer and is never touched here.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
STILLS = ROOT / "blender" / "renders" / "stills"
LEGEND = ROOT / "blender" / "renders" / "zone_id_legend.json"
OUT = ROOT / "viewer" / "public" / "layers"

PAT = re.compile(
    r"^(?P<cam>CAM_[A-Za-z]+)__(?:"
    r"base__sky(?P<bsky>0|05|1)__snow(?P<bsnow>0|1)"
    r"|zone_(?P<zone>\d\d|crit|gas)"
    r"|infra_(?P<infra>[a-z]+)"
    r"|overlay_steam__sky(?P<ssky>0|05|1)"
    r"|(?P<zid>zone_id)"
    r")\.png$"
)
BASE_Q = 88
LAYER_Q = 90
THRESH = 2  # 8-bit value below which a pixel counts as black


def load_rgb(p: Path) -> np.ndarray:
    im = Image.open(p)
    if im.mode in ("I;16", "I;16B", "I"):
        a = np.asarray(im, dtype=np.float32) / 257.0
        return np.repeat(a[..., None], 3, axis=2).clip(0, 255).astype(np.uint8)
    return np.asarray(im.convert("RGB"), dtype=np.uint8)


def bbox(mask: np.ndarray, pad: int = 3):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    h, w = mask.shape
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + 1 + pad)
    return int(x0), int(y0), int(x1), int(y1)


def fresh(src: Path, dst: Path, force: bool) -> bool:
    return (not force) and dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime


def centroid(weight: np.ndarray):
    s = float(weight.sum())
    if s <= 0:
        return None
    ys, xs = np.indices(weight.shape)
    return [round(float((xs * weight).sum() / s), 1), round(float((ys * weight).sum() / s), 1)]


def convert_cam(cam_dir: Path, legend: dict, force: bool) -> dict | None:
    files = {}
    for p in sorted(cam_dir.glob("*.png")):
        m = PAT.match(p.name)
        if m:
            files[p.name] = (p, m)
    if not files:
        return None
    cam = next(iter(files.values()))[1]["cam"]
    out = OUT / cam
    out.mkdir(parents=True, exist_ok=True)
    man: dict = {"cam": cam, "bases": {}, "zones": {}, "infra": {}, "steam": {}, "anchors_auto": {}}
    size = None
    zid_path = None
    infra_weights: dict[str, np.ndarray] = {}

    for name, (p, m) in files.items():
        if m["zid"]:
            zid_path = p
            continue
        if m["bsky"] is not None:
            key = f"sky{m['bsky']}_snow{m['bsnow']}"
            dst = out / f"base__sky{m['bsky']}__snow{m['bsnow']}.webp"
            im = Image.open(p)
            size = size or im.size
            if not fresh(p, dst, force):
                Image.fromarray(load_rgb(p)).save(dst, "WEBP", quality=BASE_Q, method=6)
            man["bases"][key] = dst.name
            continue
        if m["ssky"] is not None:
            key = f"sky{m['ssky']}"
            dst = out / f"steam__sky{m['ssky']}.webp"
            im = Image.open(p).convert("RGBA")
            size = size or im.size
            a = np.asarray(im)
            bb = bbox(a[..., 3] > THRESH)
            if bb is None:
                continue
            if not fresh(p, dst, force):
                im.crop(bb).save(dst, "WEBP", quality=LAYER_Q, method=6, exact=True)
            W, H = im.size
            man["steam"][key] = {"file": dst.name, "rect": [bb[0] / W, bb[1] / H, (bb[2] - bb[0]) / W, (bb[3] - bb[1]) / H]}
            continue
        # light layer (zone or infra)
        if m["zone"] is not None:
            key, group, stem = f"zone_{m['zone']}", "zones", f"zone_{m['zone']}"
        else:
            key, group, stem = m["infra"], "infra", f"infra_{m['infra']}"
        rgb = load_rgb(p)
        H, W = rgb.shape[:2]
        size = size or (W, H)
        bb = bbox(rgb.max(axis=2) > THRESH)
        if group == "infra":
            infra_weights[key] = rgb.astype(np.float32).mean(axis=2)
        if bb is None:
            man[group][key] = None
            continue
        dst = out / f"{stem}.webp"
        if not fresh(p, dst, force):
            Image.fromarray(rgb[bb[1] : bb[3], bb[0] : bb[2]]).save(dst, "WEBP", quality=LAYER_Q, method=6)
        man[group][key] = {"file": dst.name, "rect": [bb[0] / W, bb[1] / H, (bb[2] - bb[0]) / W, (bb[3] - bb[1]) / H]}

    man["width"], man["height"] = (size or (1920, 1080))

    # ---- anchors (image pixels, y down)
    anchors = man["anchors_auto"]
    if zid_path is not None and legend:
        zid = load_rgb(zid_path).astype(np.int16)

        def zone_mask(name: str) -> np.ndarray:
            hexc = legend.get(name, "").lstrip("#")
            if len(hexc) != 6:
                return np.zeros(zid.shape[:2], bool)
            c = np.array([int(hexc[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.int16)
            return np.abs(zid - c).sum(axis=2) < 24

        for anchor, names in (("hospital", ["Zone_CRIT"]), ("pumpjacks", ["Zone_GAS"]), ("downtown", ["Zone_01", "Zone_02", "Zone_03", "Zone_04"])):
            mk = np.zeros(zid.shape[:2], bool)
            for n in names:
                mk |= zone_mask(n)
            c = centroid(mk.astype(np.float32))
            if c:
                anchors[anchor] = c
    for anchor, key in (("gas_plant", "gasplant"), ("wind_farm", "turbines"), ("battery", "battery")):
        if key in infra_weights:
            c = centroid(infra_weights[key])
            if c:
                anchors[anchor] = c

    man["source"] = f"blender/renders/stills/{cam}"
    man["generated_utc"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (out / "manifest.json").write_text(json.dumps(man, indent=1), encoding="utf-8")
    total = sum(f.stat().st_size for f in out.glob("*.webp"))
    print(f"{cam}: {len(man['bases'])} bases, {sum(1 for v in man['zones'].values() if v)} zones, "
          f"{sum(1 for v in man['infra'].values() if v)} infra, {len(man['steam'])} steam, "
          f"anchors {sorted(anchors)}  -> {total / 1e6:.2f} MB")
    return man


def main() -> None:
    force = "--force" in sys.argv
    legend = json.loads(LEGEND.read_text()) if LEGEND.exists() else {}
    cams = []
    if STILLS.exists():
        for d in sorted(STILLS.iterdir()):
            if d.is_dir():
                man = convert_cam(d, legend, force)
                if man and man["bases"]:
                    cams.append(man["cam"])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps({"cams": cams}, indent=1), encoding="utf-8")
    print("cams:", cams)


if __name__ == "__main__":
    main()
