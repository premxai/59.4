"""Materials, sky, fog, falling snow and the SIM_CONTROL wiring for the 4:37 city.

Every visual state is reached through custom properties on the SIM_CONTROL empty.
Drivers read them in three places:
  * NG_Globals (shared shader node group): snow, frost, sky, line/battery glow, gas plant,
    aviation lights, blink and time. One driver per property serves every material.
  * One "power" value per zone material (MAT_Zone_XX, MAT_GasLights).
  * Object transforms: rotors, pumpjack beams, sun and moon lamps, and the snowfall modifier.
Window patterns are a pure function of world position and a fixed per-building seed,
so they are identical in every render and every animation frame.
"""
import bpy, math

ZONES16 = [f"Zone_{i:02d}" for i in range(1, 17)]

PROPS = [  # name, default, description
    *[(f"zone_{i:02d}", 1.0, f"Power in Zone_{i:02d} (multiplies its emission)") for i in range(1, 17)],
    ("zone_crit", 1.0, "Power for hospital + water plant (0.3 = backup generators)"),
    ("zone_gas", 1.0, "Power for the gas compressor station + pumpjack field"),
    ("snow_amount", 1.0, "Snow cover on ground and roofs (0 dry winter ground, 1 full snow)"),
    ("frost_amount", 1.0, "White-blue frost on wellheads, turbines, lines, substations"),
    ("snowfall", 0.5, "Density of falling snow"),
    ("sky_time", 0.5, "0 late afternoon, 0.5 dusk, 1 deep night (moonlight only)"),
    ("turbines_running", 1.0, "Fraction of turbines spinning, in fixed Rotor order"),
    ("gas_plant_on", 1.0, "Gas plant steam plumes + site lights"),
    ("line_glow", 1.0, "Transmission-line glow (power flowing)"),
    ("battery_glow", 1.0, "Battery-yard status lights"),
    ("aviation_lights", 1.0, "Red turbine aviation blinkers (independent of turbines_running)"),
    ("winterized", 0.0, "Orange heat-trace glow on wellheads, compressor and gas-plant pipes"),
]
N_TURBINES = 30

SNOW = (0.60, 0.72, 0.92)
RIME = (0.50, 0.60, 0.72)
AMBER = (1.0, 0.40, 0.09)      # ~2200 K street light
COOL = (0.78, 0.87, 1.0)       # downtown office windows
WARM = (1.0, 0.56, 0.24)       # houses
SODIUM = (1.0, 0.50, 0.16)

SIM = None


# ---------------------------------------------------------------- drivers
def driver(struct, path, expr, props, index=-1):
    fc = struct.driver_add(path) if index < 0 else struct.driver_add(path, index)
    d = fc.driver
    d.type = 'SCRIPTED'
    for var, prop in props.items():
        v = d.variables.new()
        v.name, v.type = var, 'SINGLE_PROP'
        v.targets[0].id_type = 'OBJECT'
        v.targets[0].id = SIM
        v.targets[0].data_path = f'["{prop}"]'
    d.expression = expr
    return fc


def make_control(sc):
    global SIM
    ob = bpy.data.objects.new("SIM_CONTROL", None)
    ob.empty_display_type, ob.empty_display_size = 'PLAIN_AXES', 60
    ob.location = (0, 0, 400)
    sc.collection.objects.link(ob)
    for name, default, desc in PROPS:
        ob[name] = float(default)
        ob.id_properties_ui(name).update(min=0.0, max=1.0, soft_min=0.0, soft_max=1.0,
                                         default=float(default), description=desc)
    SIM = ob
    return ob


# ---------------------------------------------------------------- node helpers
class T:
    def __init__(self, tree):
        self.t, self.N, self.L = tree, tree.nodes, tree.links

    def node(self, typ, **kw):
        n = self.N.new(typ)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def put(self, sock, v):
        if v is None:
            return
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = (*v, 1.0) if len(sock.default_value) == 4 and len(v) == 3 else v
        else:
            self.L.new(v, sock)

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.put(n.inputs[0], a); self.put(n.inputs[1], b); self.put(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.math('ADD', a, b)
    def mul(self, a, b, clamp=False): return self.math('MULTIPLY', a, b, clamp=clamp)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)
    def gt(self, a, b): return self.math('GREATER_THAN', a, b)
    def lt(self, a, b): return self.math('LESS_THAN', a, b)
    def eq(self, a, b): return self.math('COMPARE', a, b, 0.5)
    def clamp(self, a): return self.math('ADD', a, 0.0, clamp=True)
    def inv(self, a): return self.math('SUBTRACT', 1.0, a)

    def smooth(self, v, lo, hi):
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.put(n.inputs['Value'], v)
        n.inputs['From Min'].default_value, n.inputs['From Max'].default_value = lo, hi
        return n.outputs['Result']

    def mixf(self, f, a, b):
        n = self.node('ShaderNodeMix', data_type='FLOAT')
        self.put(n.inputs[0], f); self.put(n.inputs[2], a); self.put(n.inputs[3], b)
        return n.outputs[0]

    def mixc(self, f, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self.put(n.inputs[0], f); self.put(n.inputs[6], a); self.put(n.inputs[7], b)
        return n.outputs[2]

    def vscale(self, v, s):
        n = self.node('ShaderNodeVectorMath', operation='SCALE')
        self.put(n.inputs[0], v); self.put(n.inputs['Scale'], s)
        return n.outputs[0]

    def vadd(self, a, b):
        n = self.node('ShaderNodeVectorMath', operation='ADD')
        self.put(n.inputs[0], a); self.put(n.inputs[1], b)
        return n.outputs[0]

    def sep(self, v):
        n = self.node('ShaderNodeSeparateXYZ'); self.put(n.inputs[0], v)
        return n.outputs

    def noise(self, vec, scale, detail=2.0, w=None):
        n = self.node('ShaderNodeTexNoise')
        if w is not None:
            n.noise_dimensions = '4D'; self.put(n.inputs['W'], w)
        self.put(n.inputs['Vector'], vec)
        n.inputs['Scale'].default_value, n.inputs['Detail'].default_value = scale, detail
        return n.outputs['Fac']

    def attr(self, name, kind='GEOMETRY'):
        return self.node('ShaderNodeAttribute', attribute_type=kind, attribute_name=name).outputs['Fac']

    def globals(self):
        return self.node('ShaderNodeGroup', node_tree=bpy.data.node_groups["NG_Globals"]).outputs

    def principled(self, base, rough=0.6, metal=0.0, emis=None, alpha=None):
        p = self.node('ShaderNodeBsdfPrincipled')
        self.put(p.inputs['Base Color'], base)
        self.put(p.inputs['Roughness'], rough)
        self.put(p.inputs['Metallic'], metal)
        if emis is not None:
            self.put(p.inputs['Emission Color'], emis)
            p.inputs['Emission Strength'].default_value = 1.0
        return p.outputs[0]


def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    m.node_tree.nodes.clear()
    t = T(m.node_tree)
    out = t.node('ShaderNodeOutputMaterial')
    return m, t, out


def group_tree(name, inputs=(), outputs=(("Shader", 'NodeSocketShader'),)):
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    for nm, typ in inputs:
        g.interface.new_socket(nm, in_out='INPUT', socket_type=typ)
    for nm, typ in outputs:
        g.interface.new_socket(nm, in_out='OUTPUT', socket_type=typ)
    t = T(g)
    return g, t, t.node('NodeGroupInput'), t.node('NodeGroupOutput')


# ---------------------------------------------------------------- shared groups
GLOBALS = [  # output name, driver expression, {var: prop}
    ("snow", "v", {"v": "snow_amount"}),
    ("frost", "v", {"v": "frost_amount"}),
    ("sky", "v", {"v": "sky_time"}),
    ("gas_on", "v", {"v": "gas_plant_on"}),
    ("line_glow", "v", {"v": "line_glow"}),
    ("battery_glow", "v", {"v": "battery_glow"}),
    ("aviation", "v * min(1, max(0, 10 - fmod(frame, 45)))", {"v": "aviation_lights"}),   # 1.5 s blink, on at frame 1
    ("blink", "min(1, max(0, 10 - fmod(frame, 45)))", {}),
    ("winterized", "v", {"v": "winterized"}),
    ("time", "frame / 30", {}),
]


def make_globals():
    g, t, gi, go = group_tree("NG_Globals", outputs=[(n, 'NodeSocketFloat') for n, _, _ in GLOBALS])
    for name, expr, props in GLOBALS:
        v = t.node('ShaderNodeValue', name=name, label=name)
        driver(v.outputs[0], "default_value", expr, props)
        t.L.new(v.outputs[0], go.inputs[name])
    return g


def make_city_group():
    """Zone shader for buildings, streets and lamps. Inputs: Power (0-1), Crit (1 for Zone_CRIT)."""
    g, t, gi, go = group_tree("NG_City", inputs=[("Power", 'NodeSocketFloat'), ("Crit", 'NodeSocketFloat')])
    G = t.globals()
    power, crit = gi.outputs["Power"], gi.outputs["Crit"]
    bt, bid = t.attr("btype"), t.attr("bid")
    geo = t.node('ShaderNodeNewGeometry')
    px, py, pz = t.sep(geo.outputs['Position'])
    nx, ny, nz = t.sep(geo.outputs['Normal'])
    uvx, uvy, _ = t.sep(t.node('ShaderNodeTexCoord').outputs['UV'])

    is_house, is_tower, is_ind = t.eq(bt, 0), t.eq(bt, 2), t.eq(bt, 3)
    is_road, is_lamp, is_fac, is_plain = t.eq(bt, 4), t.eq(bt, 5), t.eq(bt, 6), t.eq(bt, 7)
    is_beacon, is_edge = t.eq(bt, 8), t.eq(bt, 9)
    is_lamp_like = t.clamp(t.add(t.add(is_lamp, is_beacon), is_edge))
    roof = t.smooth(nz, 0.5, 0.8)
    wall = t.inv(roof)

    # --- window grid in world space (fixed pattern)
    ax = t.gt(t.math('ABSOLUTE', nx), t.math('ABSOLUTE', ny))
    h = t.mixf(ax, px, py)
    ws = t.add(t.add(3.0, t.mul(is_house, 1.6)), t.mul(is_ind, 3.0))
    fh = t.sub(3.5, t.mul(is_house, 0.5))
    cu, cv = t.math('DIVIDE', h, ws), t.math('DIVIDE', pz, fh)
    fu, fv = t.math('FRACT', cu), t.math('FRACT', cv)
    win = t.mul(t.mul(t.gt(fu, 0.3), t.lt(fu, 0.7)), t.mul(t.gt(fv, 0.36), t.lt(fv, 0.74)))
    solid = t.inv(t.clamp(t.add(t.add(is_plain, is_road), is_lamp_like)))
    win = t.mul(t.mul(win, wall), solid)
    win = t.mul(win, t.mixf(is_house, 1.0, t.lt(pz, 3.0)))          # houses: one storey
    cell = t.node('ShaderNodeCombineXYZ')
    t.put(cell.inputs[0], t.math('FLOOR', cu)); t.put(cell.inputs[1], t.math('FLOOR', cv))
    t.put(cell.inputs[2], t.add(t.mul(bid, 1000.0), t.mul(ax, 17.0)))
    wn = t.node('ShaderNodeTexWhiteNoise', noise_dimensions='3D')
    t.L.new(cell.outputs[0], wn.inputs['Vector'])
    rr, r2, _ = t.sep(wn.outputs['Color'])
    litfrac = t.add(0.6, t.mul(0.2, t.math('FRACT', t.mul(bid, 7.31))))       # 60-80 % per building
    # Zone_CRIT on backup power: fewer windows (corridors/ICU) and warmer emergency fixtures
    critfrac = t.mixf(crit, 1.0, t.clamp(t.add(0.12, t.mul(power, 0.88))))
    lit = t.lt(rr, t.mul(litfrac, critfrac))
    winlit = t.mul(t.mul(win, lit), t.add(0.2, t.mul(0.8, t.mul(r2, r2))))
    wcol = t.mixc(is_house, COOL, WARM)
    wcol = t.mixc(is_ind, wcol, SODIUM)
    wcol = t.mixc(t.clamp(t.mul(t.mul(crit, t.inv(power)), 1.6)), wcol, (1.0, 0.62, 0.36))
    e_win = t.vscale(wcol, t.mul(winlit, t.mul(power, 1.0)))

    # --- roads: amber light pools every 34 m, brighter on snow
    pool = t.math('POWER', t.add(0.5, t.mul(0.5, t.math('COSINE', t.mul(uvx, 2 * math.pi / 34)))), 2.0)
    road_e = t.mul(t.mul(t.add(0.10, t.mul(0.32, pool)), t.add(1.0, t.mul(G['snow'], 0.7))), power)
    e_road = t.vscale(AMBER, t.mul(road_e, is_road))
    e_lamp = t.vscale(AMBER, t.mul(t.mul(is_lamp, power), 5.0))
    e_beacon = t.vscale((1.0, 0.03, 0.015), t.mul(t.mul(is_beacon, power), t.mul(G['blink'], 10.0)))
    e_edge = t.vscale((0.85, 0.92, 1.0), t.mul(t.mul(is_edge, power), 1.1))
    emis = t.vadd(t.vadd(t.vadd(e_win, e_road), e_lamp), t.vadd(e_beacon, e_edge))

    # --- surfaces
    n1 = t.noise(geo.outputs['Position'], 0.06, 3.0)
    facade = t.mixc(is_tower, (0.07, 0.066, 0.062), (0.018, 0.022, 0.03))
    facade = t.mixc(is_ind, facade, (0.09, 0.09, 0.09))
    facade = t.mixc(is_fac, facade, (0.15, 0.155, 0.165))
    facade = t.mixc(t.eq(bt, 1), facade, (0.045, 0.045, 0.05))
    facade = t.mixc(0.5, facade, t.mixc(bid, (0.6, 0.6, 0.6), (1.4, 1.4, 1.4)), blend='MULTIPLY')
    base = t.mixc(win, facade, (0.008, 0.01, 0.014))
    snow_roof = t.mul(t.clamp(t.sub(t.mul(G['snow'], 1.35), t.mul(n1, 0.45))), roof)
    base = t.mixc(t.mul(wall, t.mul(G['frost'], 0.12)), base, RIME)
    base = t.mixc(snow_roof, base, SNOW)
    edge = t.mul(t.math('ABSOLUTE', t.sub(uvy, 0.5)), 2.0)
    road_snow = t.mul(G['snow'], t.add(0.18, t.mul(0.6, t.smooth(edge, 0.55, 0.92))))
    road_base = t.mixc(road_snow, (0.016, 0.016, 0.018), (0.5, 0.54, 0.6))
    base = t.mixc(is_road, base, road_base)
    base = t.mixc(is_lamp_like, base, (0.0, 0.0, 0.0))
    rough = t.mixf(win, t.mixf(snow_roof, 0.75, 0.55), 0.12)
    sh = t.principled(base, rough, 0.0, emis)
    t.L.new(sh, go.inputs[0])
    return g


def city_material(name, prop, crit=0.0, fixed_power=None):
    m, t, out = new_mat(name)
    grp = t.node('ShaderNodeGroup', node_tree=bpy.data.node_groups["NG_City"])
    pw = t.node('ShaderNodeValue', name="power", label="power")
    if fixed_power is None:
        driver(pw.outputs[0], "default_value", "v", {"v": prop})
    else:
        pw.outputs[0].default_value = fixed_power
    t.L.new(pw.outputs[0], grp.inputs["Power"])
    grp.inputs["Crit"].default_value = crit
    t.L.new(grp.outputs[0], out.inputs['Surface'])
    return m


def surface_material(name, color, rough=0.6, metal=0.0, snow_k=1.0, frost_k=1.0, rotor=False):
    """Plain surface with snow on up-facing faces and frost everywhere."""
    m, t, out = new_mat(name)
    G = t.globals()
    geo = t.node('ShaderNodeNewGeometry')
    _, _, nz = t.sep(geo.outputs['Normal'])
    frost = t.mul(G['frost'], frost_k)
    if rotor:   # stopped rotors read as iced
        frost = t.math('MAXIMUM', frost, t.mul(t.inv(t.attr("run", 'OBJECT')), 0.9))
    n1 = t.noise(geo.outputs['Position'], 0.3, 2.0)
    base = t.mixc(t.clamp(t.mul(frost, t.add(0.55, t.mul(n1, 0.45)))), color, RIME)
    top = t.mul(t.smooth(nz, 0.6, 0.85), t.clamp(t.sub(t.mul(G['snow'], 1.3), t.mul(n1, 0.4))))
    base = t.mixc(t.mul(top, snow_k), base, SNOW)
    t.L.new(t.principled(base, t.mixf(frost, rough, 0.45), metal), out.inputs['Surface'])
    return m


def emissive_material(name, color, strength, factor):
    """Black housing + emission. factor: NG_Globals output name or ('prop', sim_property)."""
    m, t, out = new_mat(name)
    if isinstance(factor, tuple):
        v = t.node('ShaderNodeValue', name="power", label="power")
        driver(v.outputs[0], "default_value", "v", {"v": factor[1]})
        f = v.outputs[0]
    else:
        f = t.globals()[factor]
    t.L.new(t.principled((0.01, 0.01, 0.01), 0.5, 0.0, t.vscale(color, t.mul(f, strength))), out.inputs['Surface'])
    return m


def pool_material(name, color, strength, factor):
    """Light pool on snowy ground: snow base + radial emission falloff."""
    m, t, out = new_mat(name)
    if isinstance(factor, tuple):
        v = t.node('ShaderNodeValue', name="power", label="power")
        driver(v.outputs[0], "default_value", "v", {"v": factor[1]})
        f = v.outputs[0]
    else:
        f = t.globals()[factor]
    G = t.globals()
    u, _, _ = t.sep(t.node('ShaderNodeTexCoord').outputs['UV'])
    fall = t.math('POWER', t.clamp(t.inv(u)), 2.0)
    base = t.mixc(G['snow'], (0.03, 0.03, 0.03), SNOW)
    t.L.new(t.principled(base, 0.8, 0.0, t.vscale(color, t.mul(t.mul(f, strength), fall))), out.inputs['Surface'])
    return m


def ground_material():
    m, t, out = new_mat("MAT_Ground")
    G = t.globals()
    pos = t.node('ShaderNodeNewGeometry').outputs['Position']
    n1, n2 = t.noise(pos, 0.004, 4.0), t.noise(pos, 0.05, 3.0)
    soil = t.mixc(n1, (0.014, 0.013, 0.011), (0.028, 0.025, 0.02))
    drift = t.add(0.82, t.mul(0.3, t.noise(pos, 0.35, 4.0)))          # wind-packed drifts / ripples
    base = t.mixc(t.mul(G['frost'], 0.55), soil, (0.20, 0.24, 0.30))
    cov = t.clamp(t.sub(t.mul(G['snow'], 1.4), t.add(t.mul(n1, 0.35), t.mul(n2, 0.2))))
    snowc = t.vscale(SNOW, drift)
    vor = t.node('ShaderNodeTexVoronoi'); t.put(vor.inputs['Vector'], pos); vor.inputs['Scale'].default_value = 1.6
    sparkle = t.mul(t.lt(vor.outputs['Distance'], 0.045), cov)                    # sparse glints
    snowc = t.mixc(sparkle, snowc, (1.6, 1.7, 1.9))
    base = t.mixc(cov, base, snowc)
    t.L.new(t.principled(base, t.mixf(sparkle, t.mixf(cov, 0.9, 0.55), 0.08)), out.inputs['Surface'])
    return m


def ice_material():
    m, t, out = new_mat("MAT_RiverIce")
    G = t.globals()
    pos = t.node('ShaderNodeNewGeometry').outputs['Position']
    n1 = t.noise(pos, 0.02, 4.0)
    cov = t.mul(t.clamp(t.sub(t.mul(G['snow'], 1.1), t.mul(n1, 0.6))), 0.85)
    base = t.mixc(cov, (0.06, 0.10, 0.15), SNOW)
    t.L.new(t.principled(base, t.mixf(cov, 0.1, 0.6)), out.inputs['Surface'])
    return m


def line_material():
    m, t, out = new_mat("MAT_PowerLine")
    G = t.globals()
    base = t.mixc(G['frost'], (0.04, 0.04, 0.045), (0.62, 0.72, 0.82))     # ice coat
    emis = t.vscale((0.45, 0.80, 1.0), t.mul(G['line_glow'], 1.0))
    t.L.new(t.principled(base, t.mixf(G['frost'], 0.4, 0.15), 0.5, emis), out.inputs['Surface'])
    return m


def steam_material():
    m, t, out = new_mat("MAT_Steam")
    G = t.globals()
    oc = t.node('ShaderNodeTexCoord').outputs['Object']
    ln = t.node('ShaderNodeVectorMath', operation='LENGTH'); t.put(ln.inputs[0], oc)
    shape = t.smooth(t.inv(ln.outputs['Value']), 0.0, 0.6)
    _, _, oz = t.sep(oc)
    nz = t.noise(t.vadd(oc, (0, 0, 0)), 2.2, 4.0, w=t.mul(G['time'], 0.12))
    dens = t.mul(t.mul(t.smooth(nz, 0.35, 0.75), shape), t.mul(G['gas_on'], 0.05))
    vol = t.node('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.85, 0.88, 0.93, 1)
    t.put(vol.inputs['Density'], dens)
    vol.inputs['Emission Color'].default_value = (1.0, 0.72, 0.45, 1)       # lit from below by site lights
    t.put(vol.inputs['Emission Strength'], t.mul(t.mul(G['gas_on'], 0.06), t.clamp(t.sub(0.4, oz))))
    t.L.new(vol.outputs[0], out.inputs['Volume'])
    return m


def fog_material():
    m, t, out = new_mat("MAT_GroundFog")
    pos = t.node('ShaderNodeNewGeometry').outputs['Position']
    _, _, z = t.sep(pos)
    falloff = t.math('EXPONENT', t.mul(z, -1.0 / 40.0))
    n1 = t.noise(pos, 0.0015, 2.0)
    vol = t.node('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.35, 0.5, 0.78, 1)
    vol.inputs['Anisotropy'].default_value = 0.35
    t.put(vol.inputs['Density'], t.mul(t.mul(falloff, t.add(0.4, n1)), 0.0005))
    t.L.new(vol.outputs[0], out.inputs['Volume'])
    return m


def snowflake_material():
    m, t, out = new_mat("MAT_Snowflake")
    t.L.new(t.principled((0.9, 0.93, 1.0), 0.5, 0.0, (0.035, 0.04, 0.05)), out.inputs['Surface'])
    return m


# ---------------------------------------------------------------- world + lamps
def make_world(sc):
    w = bpy.data.worlds.new("WORLD_4_37")
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    w.node_tree.nodes.clear()
    t = T(w.node_tree)
    G = t.globals()
    gen = t.node('ShaderNodeTexCoord').outputs['Generated']
    _, _, el = t.sep(gen)
    tpos = t.node('ShaderNodeMapRange')
    t.put(tpos.inputs['Value'], el)
    tpos.inputs['From Min'].default_value, tpos.inputs['From Max'].default_value = -0.1, 1.0

    def ramp(stops):
        r = t.node('ShaderNodeValToRGB')
        els = r.color_ramp.elements
        els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
        els[1].position, els[1].color = stops[1][0], (*stops[1][1], 1)
        for p, c in stops[2:]:
            e = els.new(p); e.color = (*c, 1)
        t.L.new(tpos.outputs['Result'], r.inputs['Fac'])
        return r.outputs['Color']

    aft = ramp([(0.0, (0.03, 0.033, 0.04)), (0.09, (0.34, 0.38, 0.45)), (0.25, (0.24, 0.28, 0.36)), (1.0, (0.12, 0.15, 0.22))])
    dusk = ramp([(0.0, (0.012, 0.014, 0.03)), (0.09, (0.13, 0.22, 0.45)), (0.115, (0.30, 0.17, 0.36)),
                 (0.16, (0.24, 0.08, 0.24)), (0.26, (0.08, 0.04, 0.17)), (0.5, (0.025, 0.022, 0.08)), (1.0, (0.008, 0.008, 0.035))])
    night = ramp([(0.0, (0.002, 0.003, 0.006)), (0.09, (0.012, 0.016, 0.032)), (0.3, (0.004, 0.006, 0.016)), (1.0, (0.0015, 0.002, 0.007))])
    sky = G['sky']
    c = t.mixc(t.clamp(t.mul(sky, 2.0)), aft, dusk)
    c = t.mixc(t.clamp(t.sub(t.mul(sky, 2.0), 1.0)), c, night)
    mute = t.node('ShaderNodeValue', name="LAYER_MUTE", label="LAYER_MUTE")   # render scripts set 0 for light layers
    mute.outputs[0].default_value = 1.0
    bg = t.node('ShaderNodeBackground')
    t.put(bg.inputs['Color'], c)
    # the camera sees the sky at full strength; the scene is lit by a much dimmer sky
    cam_ray = t.node('ShaderNodeLightPath').outputs['Is Camera Ray']
    t.put(bg.inputs['Strength'], t.mul(mute.outputs[0], t.mixf(cam_ray, t.mixf(t.clamp(t.mul(sky, 2.0)), 1.0, 1.5), 0.8)))
    out = t.node('ShaderNodeOutputWorld')
    t.L.new(bg.outputs[0], out.inputs['Surface'])


def make_lamps(C):
    fx = C["WINTER_FX"]
    sd = bpy.data.lights.new("Sun", 'SUN')
    sd.color, sd.angle = (1.0, 0.78, 0.66), math.radians(3)
    sun = bpy.data.objects.new("Sun", sd); fx.objects.link(sun)
    sun.rotation_euler = (math.radians(75), 0, math.radians(-45))
    driver(sd, "energy", "2.6*max(0, 1-2*s)*max(0, 1-2*s) + 0.9*max(0, 1-abs(s-0.5)*3.5)", {"s": "sky_time"})
    driver(sun, "rotation_euler", "radians(70 + 14*s)", {"s": "sky_time"}, index=0)
    md = bpy.data.lights.new("Moon", 'SUN')
    md.color, md.angle = (0.55, 0.66, 1.0), math.radians(1)
    moon = bpy.data.objects.new("Moon", md); fx.objects.link(moon)
    moon.rotation_euler = (math.radians(48), 0, math.radians(150))
    driver(md, "energy", "0.12*min(1, max(0, 2.5*s - 0.75))", {"s": "sky_time"})


# ---------------------------------------------------------------- snowfall (geometry nodes)
def make_snowfall(C):
    B, N = 140.0, 160000
    g = bpy.data.node_groups.new("GN_Snowfall", 'GeometryNodeTree')
    g.interface.new_socket("Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
    s_in = g.interface.new_socket("Snowfall", in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket("Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
    t = T(g)
    gi, go = t.node('NodeGroupInput'), t.node('NodeGroupOutput')

    def rnd_vec(lo, hi, seed):
        r = t.node('FunctionNodeRandomValue', data_type='FLOAT_VECTOR')
        ins = [s for s in r.inputs if s.enabled]
        ins[0].default_value, ins[1].default_value = lo, hi
        [s for s in r.inputs if s.name == 'Seed'][0].default_value = seed
        return [s for s in r.outputs if s.enabled][0]

    def rnd_f(seed):
        r = t.node('FunctionNodeRandomValue', data_type='FLOAT')
        [s for s in r.inputs if s.name == 'Seed'][0].default_value = seed
        return [s for s in r.outputs if s.enabled][0]

    def vm(op, a, b=None, c=None):
        n = t.node('ShaderNodeVectorMath', operation=op)
        t.put(n.inputs[0], a); t.put(n.inputs[1], b); t.put(n.inputs[2], c)
        return n.outputs[0]

    pts = t.node('GeometryNodePoints')
    pts.inputs['Count'].default_value = N
    pts.inputs['Radius'].default_value = 0.022
    p0 = rnd_vec((-B / 2,) * 3, (B / 2,) * 3, 1)
    stime = t.node('GeometryNodeInputSceneTime').outputs['Seconds']
    speed = t.node('ShaderNodeMath', operation='MULTIPLY_ADD')
    t.put(speed.inputs[0], rnd_f(2)); speed.inputs[1].default_value = 0.6; speed.inputs[2].default_value = 0.7
    vel = vm('SCALE', (0.9, -0.6, -1.5), None)
    vn = vel.node; t.put(vn.inputs['Scale'], speed.outputs[0])
    drift = vm('SCALE', vel, None); t.put(drift.node.inputs['Scale'], stime)
    world = vm('ADD', p0, drift)
    cam = t.node('GeometryNodeObjectInfo', transform_space='ORIGINAL')
    t.L.new(t.node('GeometryNodeInputActiveCamera').outputs[0], cam.inputs['Object'])
    rot = t.node('FunctionNodeRotateVector')
    rot.inputs['Vector'].default_value = (0, 0, -B * 0.42)
    t.L.new(cam.outputs['Rotation'], rot.inputs['Rotation'])
    center = vm('ADD', cam.outputs['Location'], rot.outputs[0])
    rel = vm('SUBTRACT', world, center)
    wrapped = vm('WRAP', rel, (B / 2,) * 3, (-B / 2,) * 3)
    final = vm('ADD', wrapped, center)
    t.L.new(final, pts.inputs['Position'])
    # keep a snowfall-sized random subset, and nothing below the ground
    keep = t.node('FunctionNodeCompare', data_type='FLOAT', operation='GREATER_THAN')
    t.L.new(rnd_f(3), keep.inputs[0]); t.L.new(gi.outputs['Snowfall'], keep.inputs[1])
    pz = t.node('ShaderNodeSeparateXYZ')
    t.L.new(t.node('GeometryNodeInputPosition').outputs[0], pz.inputs[0])
    below = t.node('FunctionNodeCompare', data_type='FLOAT', operation='LESS_THAN')
    t.L.new(pz.outputs['Z'], below.inputs[0]); below.inputs[1].default_value = 0.05
    orn = t.node('FunctionNodeBooleanMath', operation='OR')
    t.L.new(keep.outputs[0], orn.inputs[0]); t.L.new(below.outputs[0], orn.inputs[1])
    dist = t.node('ShaderNodeVectorMath', operation='DISTANCE')
    t.L.new(t.node('GeometryNodeInputPosition').outputs[0], dist.inputs[0]); t.L.new(cam.outputs['Location'], dist.inputs[1])
    near = t.node('FunctionNodeCompare', data_type='FLOAT', operation='LESS_THAN')
    t.L.new(dist.outputs['Value'], near.inputs[0]); near.inputs[1].default_value = 25.0
    orn2 = t.node('FunctionNodeBooleanMath', operation='OR')
    t.L.new(orn.outputs[0], orn2.inputs[0]); t.L.new(near.outputs[0], orn2.inputs[1])
    orn = orn2
    dele = t.node('GeometryNodeDeleteGeometry', domain='POINT')
    t.L.new(pts.outputs[0], dele.inputs['Geometry']); t.L.new(orn.outputs[0], dele.inputs['Selection'])
    smat = t.node('GeometryNodeSetMaterial')
    smat.inputs['Material'].default_value = bpy.data.materials["MAT_Snowflake"]
    t.L.new(dele.outputs[0], smat.inputs['Geometry'])
    t.L.new(smat.outputs[0], go.inputs['Geometry'])

    me = bpy.data.meshes.new("Snowfall")
    ob = bpy.data.objects.new("Snowfall", me)
    C["WINTER_FX"].objects.link(ob)
    mod = ob.modifiers.new("Snowfall", 'NODES')
    mod.node_group = g
    ins = mod.properties.inputs          # Blender 5.x modifier inputs
    sock = getattr(ins, s_in.identifier)
    sock.value = 0.5
    driver(sock, "value", "v", {"v": "snowfall"})
    return ob


def make_fog(C):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ob = bpy.context.active_object
    ob.name = "GroundFog"
    for c in ob.users_collection: c.objects.unlink(ob)
    C["WINTER_FX"].objects.link(ob)
    ob.scale = (11000, 11000, 170)
    ob.location = (0, 0, 84)
    ob.data.materials.append(bpy.data.materials["MAT_GroundFog"])
    return ob


# ---------------------------------------------------------------- render settings + compositor
def render_settings(sc):
    ee = sc.eevee
    for k, v in (("taa_render_samples", 64), ("taa_samples", 16), ("use_shadows", True),
                 ("volumetric_start", 1.0), ("volumetric_end", 9000.0), ("volumetric_tile_size", '8'),
                 ("volumetric_samples", 64), ("use_volumetric_shadows", False),
                 ("shadow_resolution_scale", 1.0), ("use_raytracing", False)):
        try:
            setattr(ee, k, v)
        except Exception as e:
            print("eevee setting skipped:", k, e)
    sc.view_settings.view_transform, sc.view_settings.look = 'AgX', 'AgX - Medium High Contrast'
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_depth = '16'
    sc.render.image_settings.color_mode = 'RGB'
    # preview / animation compositor: gentle fog-glow bloom (light layers switch compositing off)
    tree = bpy.data.node_groups.new("COMP_Preview", 'CompositorNodeTree')
    tree.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = tree.nodes.new('CompositorNodeRLayers')
    gl = tree.nodes.new('CompositorNodeGlare')
    for nm, v in (("Type", "Fog Glow"), ("Quality", "High"), ("Threshold", 0.6), ("Strength", 0.35), ("Size", 0.6)):
        if nm in gl.inputs:
            try:
                gl.inputs[nm].default_value = v
            except Exception as e:
                print("glare input skipped:", nm, e)
    go = tree.nodes.new('NodeGroupOutput')
    tree.links.new(rl.outputs['Image'], gl.inputs['Image'])
    tree.links.new(gl.outputs['Image'], go.inputs[0])
    sc.compositing_node_group = tree
    sc.render.use_compositing = True


# ---------------------------------------------------------------- object drivers
def drive_rotors(rotors):
    for rob in rotors:
        k, ph = int(rob["order"]) - 1, float(rob["phase"])
        run = f"min(1, max(0, tr*{N_TURBINES} - {k}))"
        rob["run"] = 1.0
        driver(rob, '["run"]', run, {"tr": "turbines_running"})
        # 3-blade symmetry: fmod by 120 deg looks continuous while spinning; stopped rotors park at their phase
        driver(rob, "rotation_euler", f"{ph:.4f} + {run} * fmod(frame*0.2, 2.0944)", {"tr": "turbines_running"}, index=1)


def drive_pumpjacks(beams):
    for b in beams:
        driver(b, "rotation_euler", f"0.26*sin(frame*0.14 + {float(b['phase']):.3f}) * g", {"g": "zone_gas"}, index=1)


# ---------------------------------------------------------------- apply
def setmat(ob, *mats):
    me = ob.data
    idx = [0] * len(me.polygons)
    if idx:
        me.polygons.foreach_get("material_index", idx)
    me.materials.clear()          # clear() resets face material indices, so restore them
    for m in mats:
        me.materials.append(m)
    if idx:
        a = me.attributes.get("material_index") or me.attributes.new("material_index", 'INT', 'FACE')
        a.data.foreach_set("value", idx)


def apply(sc, C, o):
    make_control(sc)
    make_globals()
    make_city_group()
    zm = {z: city_material(f"MAT_{z}", f"zone_{z[5:].lower()}") for z in ZONES16}
    zcrit = city_material("MAT_Zone_CRIT", "zone_crit", crit=1.0)
    unlit = city_material("MAT_City_Unlit", None, fixed_power=0.0)
    for z, obs in o["city"].items():
        for ob in obs:
            setmat(ob, zm[z])
    for ob in o["crit"]:
        setmat(ob, zcrit)

    concrete = surface_material("MAT_Concrete", (0.11, 0.11, 0.115), 0.8, frost_k=0.6)
    metal = surface_material("MAT_Metal", (0.10, 0.105, 0.11), 0.45, 0.7)
    gravel = surface_material("MAT_Gravel", (0.06, 0.058, 0.055), 0.95, frost_k=0.5)
    white = surface_material("MAT_TurbineWhite", (0.55, 0.56, 0.58), 0.4)
    rotor = surface_material("MAT_Rotor", (0.55, 0.56, 0.58), 0.4, snow_k=0.0, rotor=True)
    container = surface_material("MAT_Container", (0.62, 0.63, 0.64), 0.5)
    ground = ground_material()
    ice = ice_material()

    gas_lights = emissive_material("MAT_GasField_Lights", SODIUM, 10.0, ('prop', 'zone_gas'))
    plant_lights = emissive_material("MAT_GasPlant_Lights", SODIUM, 6.0, 'gas_on')
    bat_lights = emissive_material("MAT_Battery_Lights", (0.25, 1.0, 0.65), 6.0, 'battery_glow')
    av_lights = emissive_material("MAT_Aviation_Lights", (1.0, 0.03, 0.015), 12.0, 'aviation')
    heat = emissive_material("MAT_HeatTrace", (1.0, 0.28, 0.03), 9.0, 'winterized')
    line_m = line_material()
    steam_m = steam_material()
    fog_material()
    snowflake_material()

    gnd, river, roads, hills = o["ground"]
    setmat(gnd, ground); setmat(hills, ground); setmat(river, ice); setmat(roads, unlit)
    for ob in o["turbines"]: setmat(ob, white)
    for ob in o["rotors"]: setmat(ob, rotor)
    setmat(o["aviation"], av_lights)
    setmat(o["plant"], concrete, metal, heat)
    for ob in o["stacks"]: setmat(ob, concrete)
    for ob in o["steam"]: setmat(ob, steam_m)
    setmat(o["plant_lights"], metal, plant_lights, pool_material("MAT_GasPlant_Pool", SODIUM, 0.35, 'gas_on'))
    for ob in o["wells"]: setmat(ob, metal, gravel, heat)
    for ob in o["beams"]: setmat(ob, metal)
    setmat(o["compressor"], concrete, gravel, heat)
    setmat(o["field_lights"], metal, gas_lights, pool_material("MAT_GasField_Pool", SODIUM, 0.45, ('prop', 'zone_gas')))
    for ob in o["subs"]: setmat(ob, metal, gravel)
    setmat(o["battery"], container)
    setmat(o["battery_lights"], bat_lights)
    for ob in o["lines"]: ob.data.materials.append(line_m)
    setmat(o["pylons"], metal)

    make_world(sc)
    make_lamps(C)
    make_fog(C)
    make_snowfall(C)
    drive_rotors(o["rotors"])
    drive_pumpjacks(o["beams"])
    render_settings(sc)

    bad = []
    for idb in list(bpy.data.objects) + list(bpy.data.node_groups) + list(bpy.data.materials) + list(bpy.data.lights):
        ad = getattr(idb, "animation_data", None)
        tree = getattr(idb, "node_tree", None)
        for a in [ad, getattr(tree, "animation_data", None)]:
            if a:
                for fc in a.drivers:
                    if not fc.driver.is_valid or not fc.driver.is_simple_expression:
                        bad.append((idb.name, fc.data_path, fc.driver.expression, fc.driver.is_valid))
    print("DRIVER CHECK:", "all simple + valid" if not bad else bad[:10])
