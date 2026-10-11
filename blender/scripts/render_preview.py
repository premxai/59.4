"""Render AgX previews (everything on, bloom) for the given cameras at frame 1.
blender -b blender/4_37_city.blend --python blender/scripts/render_preview.py -- <outdir> <CAM> [<CAM>...] [--set prop=value ...] [--suffix name]
"""
import bpy, sys, os, time
argv = sys.argv[sys.argv.index("--") + 1:]
outdir = argv.pop(0)
sets, suffix, cams = {}, "preview", []
while argv:
    a = argv.pop(0)
    if a == "--set":
        k, v = argv.pop(0).split("="); sets[k] = float(v)
    elif a == "--suffix":
        suffix = argv.pop(0)
    else:
        cams.append(a)
sc = bpy.context.scene
sim = bpy.data.objects["SIM_CONTROL"]
for k, v in sets.items():
    sim[k] = v
sc.frame_set(1)
sc.view_settings.view_transform, sc.view_settings.look = 'AgX', 'AgX - Medium High Contrast'
sc.render.use_compositing = True
# previews are 8-bit + dithered so smooth skies don't band in ordinary viewers
sc.render.image_settings.color_depth = '8'
sc.render.dither_intensity = 1.0
os.makedirs(outdir, exist_ok=True)
for c in cams:
    cam = bpy.data.objects[c]
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = int(cam["res_x"]), int(cam["res_y"])
    sc.render.filepath = os.path.join(outdir, f"{c}__{suffix}.png")
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"WROTE {sc.render.filepath} in {time.time() - t0:.1f}s")
