"""§7 stills for the web app: base images, zone/infra light layers, zone ID maps, previews.

blender -b blender/4_37_city.blend --python blender/scripts/render_layers.py -- <renders_dir> [--only base,zones,infra,overlay,id,preview,ref] [--cams CAM_Wide,CAM_Split]

Light layers and bases: View Transform Standard, Look None, exposure 0, no compositor/bloom,
identical samples, PNG RGB 16-bit, frame 1 (blinkers on), falling snow off.
Zone ID maps: flat emission in the exact legend colour, no anti-aliasing, PNG RGB 8-bit.
The .blend is never saved by this script.
"""
import bpy, sys, os, json, time

argv = sys.argv[sys.argv.index("--") + 1:]
root = argv[0]
only = set(argv[argv.index("--only") + 1].split(",")) if "--only" in argv else {"base", "zones", "infra", "overlay", "id", "preview", "ref"}
layer_cams = argv[argv.index("--cams") + 1].split(",") if "--cams" in argv else ["CAM_Wide", "CAM_Split"]
id_cams = ["CAM_Wide", "CAM_Split", "CAM_Aerial"]
preview_cams = ["CAM_Wide", "CAM_Split", "CAM_Street", "CAM_Aerial"]

sc = bpy.context.scene
sim = bpy.data.objects["SIM_CONTROL"]
world_mute = sc.world.node_tree.nodes["LAYER_MUTE"].outputs[0]
lamps = [bpy.data.objects["Sun"], bpy.data.objects["Moon"]]
ZONES = [f"{i:02d}" for i in range(1, 17)] + ["crit", "gas"]
ALL_OFF = {**{f"zone_{z}": 0.0 for z in ZONES}, "gas_plant_on": 0.0, "line_glow": 0.0,
           "battery_glow": 0.0, "aviation_lights": 0.0, "winterized": 0.0}
SAMPLES = 64
sc.frame_set(1)


def set_props(d):
    for k, v in d.items():
        sim[k] = float(v)


def use_cam(name):
    cam = bpy.data.objects[name]
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = int(cam["res_x"]), int(cam["res_y"])
    sc.render.resolution_percentage = 100


def linear_settings():
    vs = sc.view_settings
    vs.view_transform, vs.look, vs.exposure, vs.gamma = 'Standard', 'None', 0.0, 1.0
    sc.render.use_compositing = False
    sc.render.film_transparent = False
    sc.render.dither_intensity = 0.0
    im = sc.render.image_settings
    im.file_format, im.color_mode, im.color_depth = 'PNG', 'RGB', '16'
    sc.eevee.taa_render_samples = SAMPLES
    sim["snowfall"] = 0.0


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"WROTE {path} ({time.time() - t0:.1f}s)")


def world(on):
    world_mute.default_value = 1.0 if on else 0.0
    for l in lamps:
        l.hide_render = not on


cam_log = {}
for cam in set(layer_cams + id_cams + preview_cams):
    cam_log[cam] = [list(r) for r in bpy.data.objects[cam].matrix_world]

# ------------------------------------------------------------ bases + layers
for cam in layer_cams:
    use_cam(cam)
    d = os.path.join(root, "stills", cam)
    linear_settings()
    if "base" in only:
        world(True)
        for sky, sky_tag in ((0.0, "0"), (0.5, "05"), (1.0, "1")):
            for snow in (0, 1):
                set_props({**ALL_OFF, "sky_time": sky, "snow_amount": snow, "frost_amount": snow})
                render(os.path.join(d, f"{cam}__base__sky{sky_tag}__snow{snow}.png"))
    world(False)
    common = {**ALL_OFF, "sky_time": 0.5, "snow_amount": 1.0, "frost_amount": 1.0}
    if "zones" in only:
        for z in ZONES:
            set_props({**common, f"zone_{z}": 1.0})
            render(os.path.join(d, f"{cam}__zone_{z}.png"))
    if "infra" in only:
        for tag, prop in (("gasplant", "gas_plant_on"), ("lines", "line_glow"), ("turbines", "aviation_lights"), ("battery", "battery_glow"), ("winterized", "winterized")):
            set_props({**common, prop: 1.0})
            render(os.path.join(d, f"{cam}__infra_{tag}.png"))
    if "ref" in only:   # spot-check reference: everything on, same linear settings (not a deliverable)
        world(True)
        set_props({**{k: 1.0 for k in ALL_OFF}, "sky_time": 0.5, "snow_amount": 1.0, "frost_amount": 1.0})
        render(os.path.join(root, "..", "..", ".voyager", "tmp", "ref", f"{cam}__allon_standard.png"))
    world(True)

# ------------------------------------------------------------ steam overlay (plume only, transparent, straight alpha)
if "overlay" in only:
    steam = [o for o in bpy.data.objects if o.name.startswith("Steam_")]
    saved = {o.name: o.is_holdout for o in bpy.data.objects}
    for o in bpy.data.objects:
        if o.type in ('MESH', 'CURVE') and o not in steam:
            o.is_holdout = True              # everything else masks the plume
    fx = {n: bpy.data.objects[n].hide_render for n in ("GroundFog", "Snowfall")}
    for n in fx:
        bpy.data.objects[n].hide_render = True
    linear_settings()
    world(True)
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    for cam in layer_cams:
        use_cam(cam)
        for sky, sky_tag in ((0.0, "0"), (0.5, "05"), (1.0, "1")):
            set_props({**ALL_OFF, "gas_plant_on": 1.0, "sky_time": sky, "snow_amount": 1.0, "frost_amount": 1.0})
            render(os.path.join(root, "stills", cam, f"{cam}__overlay_steam__sky{sky_tag}.png"))
    for o in bpy.data.objects:
        o.is_holdout = saved[o.name]
    for n, v in fx.items():
        bpy.data.objects[n].hide_render = v
    sc.render.film_transparent = False
    sc.render.image_settings.color_mode = 'RGB'

# ------------------------------------------------------------ previews (AgX, everything on)
if "preview" in only:
    set_props({**{k: 1.0 for k in ALL_OFF}, "sky_time": 0.5, "snow_amount": 1.0, "frost_amount": 1.0, "snowfall": 0.5})
    world(True)
    vs = sc.view_settings
    vs.view_transform, vs.look = 'AgX', 'AgX - Medium High Contrast'
    sc.render.use_compositing = True
    sc.render.dither_intensity = 1.0
    sc.render.image_settings.color_depth = '8'
    for cam in preview_cams:
        use_cam(cam)
        render(os.path.join(root, "previews", f"{cam}__preview.png"))

# ------------------------------------------------------------ zone ID maps
if "id" in only:
    hexes = dict(sc["zone_hex"])
    def lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    def emit_mat(name, rgb):
        m = bpy.data.materials.new(name)
        try: m.use_nodes = True
        except Exception: pass
        nt = m.node_tree; nt.nodes.clear()
        e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*rgb, 1); e.inputs['Strength'].default_value = 1.0
        o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs['Surface'])
        return m
    black = emit_mat("MAT_ID_Black", (0, 0, 0))
    zone_of_obj = {}
    for zname in hexes:
        for ob in bpy.data.collections[zname].all_objects:
            zone_of_obj[ob.name] = zname
    id_mats = {z: emit_mat(f"MAT_ID_{z}", tuple(lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))) for z, h in hexes.items()}
    for ob in bpy.data.objects:
        if ob.type in ('MESH', 'CURVE') and ob.data and hasattr(ob.data, "materials"):
            m = id_mats[zone_of_obj[ob.name]] if ob.name in zone_of_obj else black
            if len(ob.data.materials) == 0:
                ob.data.materials.append(m)
            for i in range(len(ob.data.materials)):
                ob.data.materials[i] = m
    for n in ("GroundFog", "Snowfall"):
        bpy.data.objects[n].hide_render = True
    world(False)
    vs = sc.view_settings
    vs.view_transform, vs.look, vs.exposure = 'Standard', 'None', 0.0
    sc.render.use_compositing = False
    sc.render.dither_intensity = 0.0
    sc.render.filter_size = 0.0
    sc.eevee.taa_render_samples = 1
    im = sc.render.image_settings
    im.file_format, im.color_mode, im.color_depth = 'PNG', 'RGB', '8'
    for cam in id_cams:
        use_cam(cam)
        render(os.path.join(root, "stills", cam, f"{cam}__zone_id.png"))
    with open(os.path.join(root, "zone_id_legend.json"), "w") as f:
        json.dump({z: hexes[z] for z in sorted(hexes, key=lambda z: (len(z), z))}, f, indent=2)
    print("WROTE legend")

# camera transforms after rendering (must equal the ones before)
moved = [c for c in cam_log if [list(r) for r in bpy.data.objects[c].matrix_world] != cam_log[c]]
with open(os.path.join(root, "camera_transforms.json"), "w") as f:
    json.dump(cam_log, f, indent=1)
print("CAMERAS MOVED:", moved or "none")
