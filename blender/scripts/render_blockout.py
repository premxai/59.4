"""Workbench blockout renders: zones in their ID colours, one PNG per camera."""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
outdir, cams = argv[0], argv[1:]
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sh = sc.display.shading
sh.light, sh.color_type = 'STUDIO', 'OBJECT'
sh.show_shadows, sh.show_cavity = True, True
sh.background_type = 'VIEWPORT' if hasattr(sh, 'background_type') else None
sc.display.shadow_focus = 0.5
sc.render.film_transparent = False
sc.world = sc.world or bpy.data.worlds.new("W")
sc.world.color = (0.02, 0.025, 0.04)
sc.view_settings.view_transform = 'Standard'
for c in cams:
    sh.light = 'FLAT' if c == 'CAM_Aerial' else 'STUDIO'
    sc.camera = bpy.data.objects[c]
    sc.render.filepath = os.path.join(outdir, f"{c}__blockout.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", sc.render.filepath)
