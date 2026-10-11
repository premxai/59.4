"""§8 control test: keyframes ONLY SIM_CONTROL properties, renders CAM_Wide frames 1-300 (10 s @ 30 fps).
The .blend is not saved, so the delivered file keeps an un-animated SIM_CONTROL.

blender -b blender/4_37_city.blend --python blender/scripts/render_test_controls.py -- <frames_dir> [--draft]
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir, draft = argv[0], "--draft" in argv
sc = bpy.context.scene
sim = bpy.data.objects["SIM_CONTROL"]
bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'


def f(t):  # seconds -> frame
    return round(1 + t * 30)


def key(prop, pairs):
    for t, v in pairs:
        sim[prop] = float(v)
        sim.keyframe_insert(f'["{prop}"]', frame=f(t) if isinstance(t, (int, float)) else t[0])


def step(prop, t, a, b):   # switch a -> b at time t (one-frame transition)
    key(prop, [((f(t) - 1,), a), ((f(t),), b)])


# start state: dusk, dry, everything powered
for p, v in (("sky_time", 0.5), ("snow_amount", 0), ("frost_amount", 0), ("snowfall", 0.2), ("turbines_running", 1),
             ("gas_plant_on", 1), ("line_glow", 1), ("battery_glow", 1), ("aviation_lights", 1),
             ("zone_crit", 1), ("zone_gas", 1), *[(f"zone_{i:02d}", 1) for i in range(1, 17)]):
    sim[p] = float(v)
    sim.keyframe_insert(f'["{p}"]', frame=1)

key("sky_time", [(0, 0.5), (2, 1.0)])                 # 0-2 s: dusk -> deep night
key("snow_amount", [(0, 0.0), (2, 1.0)])              #        snow builds
key("frost_amount", [(0, 0.0), (2, 1.0)])
key("snowfall", [(0, 0.2), (2, 0.7)])
for i in range(1, 17):                                # 2-8 s: zones 01 -> 16 switch off
    step(f"zone_{i:02d}", 2 + (i - 1) * 6 / 16, 1, 0)
key("turbines_running", [(6, 1.0), (8, 0.0)])         # from 6 s: turbines stop (fixed order)
step("zone_gas", 7, 1, 0)                             # 7 s: gas field loses power ...
key("gas_plant_on", [(7, 1.0), (8, 0.0)])             #      ... plant loses fuel over 1 s
step("zone_crit", 8, 1, 0.3)                          # 8 s: hospital on backup generators
step("zone_crit", 9, 0.3, 0)                          # 9 s: city fully dark

sc.frame_start, sc.frame_end = 1, 300
sc.camera = bpy.data.objects["CAM_Wide"]
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.view_settings.view_transform, sc.view_settings.look = 'AgX', 'AgX - Medium High Contrast'
sc.render.use_compositing = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_depth = '8'
sc.render.dither_intensity = 1.0
if draft:
    sc.eevee.taa_render_samples = 16
    sc.eevee.volumetric_samples = 32
sc.render.filepath = os.path.join(out_dir, "frame_")
bpy.ops.render.render(animation=True)
print("TEST FRAMES DONE", out_dir)
