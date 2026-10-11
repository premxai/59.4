"""Build the "4:37" winter-storm city from scratch (deterministic).

Run:  blender -b --factory-startup --python blender/scripts/build_city.py -- --out blender/4_37_city.blend

Coordinates: metres, +X east, +Y north, city centre at the origin.
Every random choice uses fixed seeds, so rebuilding reproduces the same city,
the same window pattern and the same (locked) camera transforms.
Materials, sky, fog, snowfall and SIM_CONTROL drivers live in looks.py.
"""
import bpy, math, random, sys, os
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import looks

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGV[ARGV.index("--out") + 1] if "--out" in ARGV else "blender/4_37_city.blend"

# ---------------------------------------------------------------- layout
R_DT = 280.0      # downtown radius (Zone_01-04 quadrants)
R_RING = 300.0    # inner ring road radius
R_IN = 720.0      # inner-ring sectors (Zone_05-10)
R_CITY = 1330.0   # mean suburb edge (Zone_11-16); the real edge is irregular, see r_edge()
R_MAX = 1650.0
GRID = 80.0       # street grid spacing

WIND_C = Vector((-2050, 1600))
GAS_C = Vector((2350, 250))
PUMP_C = Vector((-1800, -1260))
COMPRESSOR = Vector((-1250, -830))
SUB = {1: Vector((-1080, 1010)), 2: Vector((1500, 200)), 3: Vector((-360, -1480))}
BATTERY = Vector((-1245, 885))
HOSPITAL = Vector((390, 360))
WATERPLANT = Vector((-430, -505))
CITY_FEED = Vector((690, 95))          # end pylon of the Sub_02 feeder into the city

HIGHWAYS = {
    "East": [Vector((300, -30)), Vector((1350, -260)), Vector((3300, -700)), Vector((9000, -1600))],
    "NorthWest": [Vector((-120, 276)), Vector((-560, 1350)), Vector((-1500, 4200)), Vector((-2600, 9000))],
}

ZONE_NAMES = [f"Zone_{i:02d}" for i in range(1, 17)] + ["Zone_CRIT", "Zone_GAS"]
ZONE_HEX = {  # also the zone-ID map palette
    "Zone_01": "#e6194b", "Zone_02": "#3cb44b", "Zone_03": "#ffe119", "Zone_04": "#4363d8",
    "Zone_05": "#f58231", "Zone_06": "#911eb4", "Zone_07": "#42d4f4", "Zone_08": "#f032e6",
    "Zone_09": "#bfef45", "Zone_10": "#fabed4", "Zone_11": "#469990", "Zone_12": "#dcbeff",
    "Zone_13": "#9a6324", "Zone_14": "#fffac8", "Zone_15": "#800000", "Zone_16": "#aaffc3",
    "Zone_CRIT": "#00ff00", "Zone_GAS": "#808000",
}

# face "btype" codes read by the city shader (looks.py)
HOUSE, MIDRISE, TOWER, INDUSTRIAL, ROAD, LAMP, FACILITY, PLAIN, BEACON, ROOFEDGE = range(10)


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


def river_y(x):
    return -560 + 70 * math.sin(x / 320.0) + 25 * math.sin(x / 97.0)


def r_edge(a):
    """Irregular city edge radius for angle a (radians)."""
    return R_CITY + 130 * math.sin(3 * a + 0.7) + 80 * math.sin(5 * a + 2.1) + 45 * math.sin(11 * a + 0.3)


def zone_of(x, y):
    r = math.hypot(x, y)
    a = math.atan2(y, x)
    d = math.degrees(a) % 360
    if r < R_DT:
        return f"Zone_{int(d // 90) + 1:02d}"
    if r < R_IN:
        return f"Zone_{int(d // 60) + 5:02d}"
    if r < r_edge(a) + 420:   # includes the sprawl along the highways
        return f"Zone_{int(d // 60) + 11:02d}"
    return None


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


EXCLUDE = [(HOSPITAL, 80), (WATERPLANT, 95), (COMPRESSOR, 120), (BATTERY, 120)] + [(p, 90) for p in SUB.values()]


def near_highway(p, d):
    return any(seg_dist(p, a, b) < d for pts in HIGHWAYS.values() for a, b in zip(pts, pts[1:]))


def excluded(x, y, pad=0.0):
    if abs(y - river_y(x)) < 42 + pad:
        return True
    p = Vector((x, y))
    if any((p - c).length < r + pad for c, r in EXCLUDE):
        return True
    return near_highway(p, 22 + pad)


# ---------------------------------------------------------------- mesh builder
class MB:
    def __init__(self):
        self.v, self.f, self.bid, self.mat, self.bt, self.uv = [], [], [], [], [], []

    def face(self, idx, bid=0.0, mat=0, bt=PLAIN, uv=None):
        self.f.append(idx); self.bid.append(bid); self.mat.append(mat); self.bt.append(bt)
        self.uv.extend(uv if uv else [(0.0, 0.0)] * len(idx))

    def add_v(self, pts):
        o = len(self.v); self.v.extend(pts); return o

    def box(self, cx, cy, w, d, h, z0=0.0, yaw=0.0, bid=0.0, mat=0, bt=PLAIN, bottom=False):
        c, s = math.cos(yaw), math.sin(yaw)
        pts = []
        for z in (z0, z0 + h):
            for px, py in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
                pts.append((cx + px * c - py * s, cy + px * s + py * c, z))
        o = self.add_v(pts)
        for i in range(4):
            j = (i + 1) % 4
            self.face([o + i, o + j, o + 4 + j, o + 4 + i], bid, mat, bt)
        self.face([o + 4, o + 5, o + 6, o + 7], bid, mat, bt)
        if bottom:
            self.face([o + 3, o + 2, o + 1, o], bid, mat, bt)

    def beam(self, p, q, t, mat=0, bt=PLAIN):
        """Square-section bar from 3D point p to q."""
        p, q = Vector(p), Vector(q)
        d = (q - p).normalized()
        a = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized() * (t / 2)
        b = d.cross(a).normalized() * (t / 2)
        ring = [a + b, -a + b, -a - b, a - b]
        o = self.add_v([tuple(p + r) for r in ring] + [tuple(q + r) for r in ring])
        for i in range(4):
            j = (i + 1) % 4
            self.face([o + i, o + j, o + 4 + j, o + 4 + i], 0, mat, bt)

    def gable(self, cx, cy, w, d, hw, hr, yaw=0.0, bid=0.0, mat=0, bt=HOUSE):
        """House: walls hw high, ridge along local X, ridge height hw+hr."""
        c, s = math.cos(yaw), math.sin(yaw)
        def P(px, py, z): return (cx + px * c - py * s, cy + px * s + py * c, z)
        e = 0.6  # eave overhang
        pts = [P(-w/2, -d/2, 0), P(w/2, -d/2, 0), P(w/2, d/2, 0), P(-w/2, d/2, 0),
               P(-w/2, -d/2, hw), P(w/2, -d/2, hw), P(w/2, d/2, hw), P(-w/2, d/2, hw),
               P(-w/2, 0, hw + hr), P(w/2, 0, hw + hr),
               P(-w/2 - e, -d/2 - e, hw - 0.3), P(w/2 + e, -d/2 - e, hw - 0.3),
               P(w/2 + e, d/2 + e, hw - 0.3), P(-w/2 - e, d/2 + e, hw - 0.3),
               P(-w/2 - e, 0, hw + hr), P(w/2 + e, 0, hw + hr)]
        o = self.add_v(pts)
        self.face([o, o + 1, o + 5, o + 4], bid, mat, bt)
        self.face([o + 2, o + 3, o + 7, o + 6], bid, mat, bt)
        self.face([o + 1, o + 2, o + 6, o + 9, o + 5], bid, mat, bt)
        self.face([o + 3, o, o + 4, o + 8, o + 7], bid, mat, bt)
        self.face([o + 10, o + 11, o + 15, o + 14], bid, mat, bt)
        self.face([o + 12, o + 13, o + 14, o + 15], bid, mat, bt)

    def cyl(self, cx, cy, r, h, z0=0.0, n=12, r2=None, bid=0.0, mat=0, bt=PLAIN, cap=True):
        r2 = r if r2 is None else r2
        pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z0) for i in range(n)]
        pts += [(cx + r2 * math.cos(2 * math.pi * i / n), cy + r2 * math.sin(2 * math.pi * i / n), z0 + h) for i in range(n)]
        o = self.add_v(pts)
        for i in range(n):
            j = (i + 1) % n
            self.face([o + i, o + j, o + n + j, o + n + i], bid, mat, bt)
        if cap:
            self.face([o + n + i for i in range(n)], bid, mat, bt)

    def disc(self, cx, cy, r, z, n=16, mat=0):
        """Flat light pool; uv.x = 0 at the centre, 1 at the rim (radial falloff in the shader)."""
        o = self.add_v([(cx, cy, z)] + [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z) for i in range(n)])
        for i in range(n):
            self.face([o, o + 1 + i, o + 1 + (i + 1) % n], mat=mat, uv=[(0, 0), (1, 0), (1, 0)])

    def strip(self, p, q, w, z, bid=0.0, mat=0, bt=ROAD, u0=0.0):
        d = (q - p); L = d.length
        if L < 1e-6: return
        n = Vector((-d.y, d.x)) / L * (w / 2)
        o = self.add_v([(p.x + n.x, p.y + n.y, z), (p.x - n.x, p.y - n.y, z),
                        (q.x - n.x, q.y - n.y, z), (q.x + n.x, q.y + n.y, z)])
        self.face([o, o + 1, o + 2, o + 3], bid, mat, bt,
                  uv=[(u0, 1.0), (u0, 0.0), (u0 + L, 0.0), (u0 + L, 1.0)])

    def lamps(self, p, q, w, spacing=32.0, both=False, u0=0.0):
        """Street-lamp heads along a road segment (emissive, btype LAMP)."""
        d = (q - p); L = d.length
        if L < 1: return
        t, nrm = d / L, Vector((-d.y, d.x)) / L
        k = math.ceil(u0 / spacing)
        while k * spacing < u0 + L:
            s = k * spacing - u0
            sides = (1, -1) if both else ((1,) if k % 2 == 0 else (-1,))
            for sd in sides:
                c = p + t * s + nrm * sd * (w / 2 + 1.0)
                self.box(c.x, c.y, 1.4, 0.7, 0.35, z0=8.5, yaw=math.atan2(t.y, t.x), bt=LAMP)
            k += 1

    def trace_pipe(self, a, b, z, r, pipe_mat=0, trace_mat=2, ring=1.6):
        """Axis-aligned pipe from 2D a to b at height z (radius r) with a heat-trace cable on top
        and clamp bands every `ring` metres (cable + bands use trace_mat)."""
        a, b = Vector(a), Vector(b)
        along_x = abs(b.x - a.x) >= abs(b.y - a.y)
        L = (b - a).length; m = (a + b) / 2
        w, d = (L, 2 * r) if along_x else (2 * r, L)
        self.box(m.x, m.y, w, d, 2 * r, z0=z - r, mat=pipe_mat)
        cw, cd = (L, 0.14) if along_x else (0.14, L)
        self.box(m.x, m.y, cw, cd, 0.07, z0=z + r, mat=trace_mat)              # cable along the top
        n = max(1, int(L // ring))
        for k in range(n + 1):
            c = a.lerp(b, k / n)
            bw, bd = (0.16, 2 * r + 0.08) if along_x else (2 * r + 0.08, 0.16)
            self.box(c.x, c.y, bw, bd, 2 * r + 0.08, z0=z - r - 0.04, mat=trace_mat)   # clamp band

    def obj(self, name, coll, mats=()):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        if len(me.polygons) == len(self.bid):
            for nm, data in (("bid", self.bid), ("btype", [float(b) for b in self.bt])):
                a = me.attributes.new(nm, 'FLOAT', 'FACE'); a.data.foreach_set("value", data)
            mi = me.attributes.get("material_index") or me.attributes.new("material_index", 'INT', 'FACE')
            mi.data.foreach_set("value", self.mat)
            uvl = me.uv_layers.new(name="UVMap")
            uvl.data.foreach_set("uv", [c for uv in self.uv for c in uv])
        else:
            print("WARN face count changed for", name)
        me.update()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


# ---------------------------------------------------------------- scene setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "4_37"
    sc.unit_settings.system = 'METRIC'
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
    sc.render.fps = 30
    sc.frame_start, sc.frame_end = 1, 600
    sc.render.engine = 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'AgX'
    return sc


def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def set_color(ob, rgb):
    ob.color = (*rgb, 1)


# ---------------------------------------------------------------- city
def build_city(C):
    rng = random.Random(437)
    zone_bldg = {z: MB() for z in ZONE_NAMES[:16]}
    zone_street = {z: MB() for z in ZONE_NAMES[:16]}

    def inside(p, margin=10):
        return p.length < r_edge(math.atan2(p.y, p.x)) - margin

    # --- street grid (segment between neighbouring intersections)
    n = int(R_MAX // GRID) + 1
    def lane_w(k): return 15.0 if k % 5 == 0 else 8.0
    for axis in (0, 1):
        for k in range(-n, n + 1):
            for t in range(-n, n):
                a, b = k * GRID, t * GRID
                p = Vector((a, b)) if axis == 0 else Vector((b, a))
                q = Vector((a, b + GRID)) if axis == 0 else Vector((b + GRID, a))
                if not (inside(p) and inside(q)):
                    continue
                m = (p + q) / 2
                w = lane_w(k)
                if w < 10 and (abs(m.y - river_y(m.x)) < 30 or any((m - c).length < r - 10 for c, r in EXCLUDE)):
                    continue  # local streets stop at the river and campuses
                z = zone_of(m.x, m.y)
                zs = zone_street[z]
                zs.strip(p, q, w, 0.24 if w > 10 else 0.2, bid=rng.random(), u0=b)
                zs.lamps(p, q, w, u0=b, both=w > 10)

    # --- inner ring road
    segs, u = 160, 0.0
    for i in range(segs):
        a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
        p = Vector((math.cos(a0), math.sin(a0))) * R_RING
        q = Vector((math.cos(a1), math.sin(a1))) * R_RING
        m = (p + q) / 2 * 1.02
        zs = zone_street[zone_of(m.x, m.y)]
        zs.strip(p, q, 22, 0.28, bid=0.5, u0=u)
        zs.lamps(p, q, 22, u0=u, both=True)
        u += (q - p).length

    # --- highways: lit inside the city (owned by the zone they cross), unlit outside
    rural = MB()
    for pts in HIGHWAYS.values():
        u = 0.0
        for a, b in zip(pts, pts[1:]):
            L = (b - a).length
            nseg = max(1, int(L // 40))
            for s in range(nseg):
                p, q = a.lerp(b, s / nseg), a.lerp(b, (s + 1) / nseg)
                m = (p + q) / 2
                z = zone_of(m.x, m.y)
                if z:
                    zone_street[z].strip(p, q, 26, 0.32, u0=u)
                    zone_street[z].lamps(p, q, 26, spacing=40, u0=u, both=True)
                else:
                    rural.strip(p, q, 26, 0.32, u0=u)
                u += (q - p).length

    def place(x, y, w, d, kind, h=None, yaw=0.0):
        if excluded(x, y, max(w, d) * 0.5):
            return
        if abs(math.hypot(x, y) - R_RING) < 18 + max(w, d) * 0.6:
            return
        z = zone_of(x, y)
        if z is None:
            return
        bid = rng.random()
        mb = zone_bldg[z]
        if kind == "house":
            mb.gable(x, y, w, d, 3.2, rng.uniform(1.8, 2.8), yaw, bid)
        elif kind == "tower":
            mb.box(x, y, w, d, h, bid=bid, bt=TOWER)
            top, tw, td = h, w, d
            if h > 70 and rng.random() < 0.55:   # stepped crown
                ch = h * rng.uniform(0.12, 0.25)
                mb.box(x, y, w * 0.68, d * 0.68, ch, z0=h, bid=bid, bt=TOWER)
                top, tw, td = h + ch, w * 0.68, d * 0.68
            elif rng.random() < 0.5:              # rooftop plant
                mb.box(x + rng.uniform(-2, 2), y, w * 0.35, d * 0.35, 4, z0=h, bid=bid, bt=PLAIN)
            # rooftop lights (same zone): red beacon on the tallest, lit roof edges on some
            if top > 110:
                mb.box(x, y, 2.6, 2.6, 2.0, z0=top + (4 if top == h else 0), bt=BEACON)
            if top > 55 and rng.random() < 0.4:
                for (ex, ey, ew, ed) in ((0, -td / 2 + 0.45, tw, 0.9), (0, td / 2 - 0.45, tw, 0.9),
                                         (-tw / 2 + 0.45, 0, 0.9, td), (tw / 2 - 0.45, 0, 0.9, td)):
                    mb.box(x + ex, y + ey, ew, ed, 0.5, z0=top, bt=ROOFEDGE)
        elif kind == "industrial":
            mb.box(x, y, w, d, h, bid=bid, bt=INDUSTRIAL)
        else:
            mb.box(x, y, w, d, h, bid=bid, bt=MIDRISE)

    # --- blocks
    for i in range(-n, n):
        for j in range(-n, n):
            x0, y0 = i * GRID, j * GRID
            cx, cy = x0 + GRID / 2, y0 + GRID / 2
            r = math.hypot(cx, cy)
            if not inside(Vector((cx, cy)), 45):
                continue
            ins = [lane_w(i) / 2 + 4, lane_w(i + 1) / 2 + 4, lane_w(j) / 2 + 4, lane_w(j + 1) / 2 + 4]
            bx0, bx1, by0, by1 = x0 + ins[0], x0 + GRID - ins[1], y0 + ins[2], y0 + GRID - ins[3]
            ang = math.degrees(math.atan2(cy, cx)) % 360

            if r < R_DT:
                for li in range(2):
                    for lj in range(2):
                        lx = bx0 + (bx1 - bx0) * (li + 0.5) / 2
                        ly = by0 + (by1 - by0) * (lj + 0.5) / 2
                        if rng.random() < 0.85:
                            w, d = rng.uniform(18, 27), rng.uniform(18, 27)
                            rr = math.hypot(lx, ly)
                            h = 28 + 175 * math.exp(-(rr / 165) ** 2) * rng.uniform(0.45, 1.15) + rng.uniform(0, 25)
                            place(lx, ly, w, d, "tower", h)
            elif r < R_IN:
                if 280 <= ang <= 330 and r > 480:
                    place(cx, cy, bx1 - bx0 - 4, (by1 - by0) * rng.uniform(0.55, 0.9), "industrial", rng.uniform(9, 14))
                    continue
                for li in range(3):
                    for lj in range(3):
                        if li == 1 and lj == 1 and rng.random() < 0.7:
                            continue  # courtyards / parking
                        lx = bx0 + (bx1 - bx0) * (li + 0.5) / 3
                        ly = by0 + (by1 - by0) * (lj + 0.5) / 3
                        if rng.random() < 0.8:
                            hmax = 12 + 38 * max(0, 1 - (r - R_DT) / (R_IN - R_DT))
                            place(lx, ly, rng.uniform(12, 18), rng.uniform(12, 18), "box", rng.uniform(7, hmax))
            else:
                if 285 <= ang <= 335 and r > 900 and rng.random() < 0.8:
                    place(cx, cy, (bx1 - bx0) * rng.uniform(0.6, 0.95), (by1 - by0) * rng.uniform(0.5, 0.9), "industrial", rng.uniform(8, 13))
                    continue
                if rng.random() < 0.04:  # school / strip mall
                    place(cx, cy, 40, 26, "box", 7)
                    continue
                for side in range(4):
                    for k in range(4):
                        t = (k + 0.5) / 4
                        if side == 0:   x, y, yaw = bx0 + (bx1 - bx0) * t, by0 + 7, 0
                        elif side == 1: x, y, yaw = bx0 + (bx1 - bx0) * t, by1 - 7, 0
                        elif side == 2: x, y, yaw = bx0 + 7, by0 + 14 + (by1 - by0 - 28) * t, math.pi / 2
                        else:           x, y, yaw = bx1 - 7, by0 + 14 + (by1 - by0 - 28) * t, math.pi / 2
                        if side >= 2 and k in (0, 3):
                            continue
                        if rng.random() < 0.86:
                            place(x, y, rng.uniform(9, 12), rng.uniform(8, 10), "house", yaw=yaw + rng.uniform(-0.04, 0.04))

    # --- sprawl along the highways just beyond the edge (commercial strips + houses)
    for pts in HIGHWAYS.values():
        for a, b in zip(pts, pts[1:]):
            d = (b - a); L = d.length; t_, nrm = d / L, Vector((-d.y, d.x)) / L
            s = 0.0
            while s < L:
                c = a + t_ * s
                re = r_edge(math.atan2(c.y, c.x))
                if re - 30 < c.length < re + 380:
                    for sd in (1, -1):
                        if rng.random() < 0.75:
                            off = rng.uniform(42, 70)
                            pp = c + nrm * sd * off
                            if rng.random() < 0.45:
                                place(pp.x, pp.y, rng.uniform(24, 40), rng.uniform(16, 26), "box", rng.uniform(5, 8), yaw=math.atan2(t_.y, t_.x))
                            else:
                                for hk in range(3):
                                    hp = pp + nrm * sd * (hk * 18 + 10) + t_ * rng.uniform(-8, 8)
                                    place(hp.x, hp.y, 10, 9, "house", yaw=math.atan2(t_.y, t_.x))
                s += 55

    objs = {}
    for z in ZONE_NAMES[:16]:
        zc = bpy.data.collections[z]
        objs[z] = [zone_bldg[z].obj(f"Bldg_{z}", zc), zone_street[z].obj(f"Streets_{z}", zc)]
    return objs, rural


def build_crit(C):
    zc = bpy.data.collections["Zone_CRIT"]
    h = MB()
    x, y = HOSPITAL
    h.box(x, y, 34, 28, 58, bid=0.11, bt=FACILITY)          # main tower
    h.box(x, y, 26, 20, 6, z0=58, bid=0.1, bt=PLAIN)         # plant room
    h.box(x - 36, y, 22, 64, 24, bid=0.23, bt=FACILITY)     # west wing
    h.box(x + 36, y, 22, 64, 24, bid=0.37, bt=FACILITY)     # east wing
    h.box(x, y - 30, 50, 14, 14, bid=0.41, bt=FACILITY)     # entrance block
    h.cyl(x, y, 9, 0.6, z0=64, n=20, bid=0.5, bt=PLAIN)     # helipad deck (unmarked)
    for k in range(10):                                      # helipad perimeter lights
        a = 2 * math.pi * k / 10
        h.box(x + 9.3 * math.cos(a), y + 9.3 * math.sin(a), 0.5, 0.5, 0.3, z0=64.6, bt=LAMP)
    for k in range(6):                                       # entrance canopy lights
        h.box(x - 20 + k * 8, y - 39, 1.0, 1.0, 0.3, z0=5, bt=LAMP)
    hosp = h.obj("Hospital_01", zc)
    w = MB()
    x, y = WATERPLANT
    w.box(x, y + 40, 44, 20, 11, bid=0.13, bt=MIDRISE)           # pump & filter house
    for k, (dx, dy) in enumerate(((-38, -10), (-8, -10), (22, -10), (52, -10))):
        w.cyl(x + dx, y + dy, 12, 4.5, n=24, bid=0.2 + k * 0.05)    # clarifiers
    for k in range(3):
        w.box(x - 30 + k * 32, y + 12, 28, 14, 3.5, bid=0.4)         # filter basins
    w.cyl(x + 55, y + 42, 7, 22, n=16, bid=0.6)                  # water tower
    for k in range(10):                                          # site lamps
        a = 2 * math.pi * k / 10
        w.box(x + 75 * math.cos(a), y + 55 * math.sin(a) + 10, 1.4, 0.7, 0.35, z0=9, bt=LAMP)
    wp = w.obj("WaterPlant_01", zc)
    s = MB()
    for c in (HOSPITAL, WATERPLANT):
        for k in range(4):
            a = k * math.pi / 2
            q = c + Vector((math.cos(a), math.sin(a))) * 85
            s.strip(c, q, 9, 0.2)
            s.lamps(c, q, 9)
    st = s.obj("Streets_Zone_CRIT", zc)
    return [hosp, wp, st]


def build_ground(C, rural):
    g = MB()
    S = 9000
    g.add_v([(-S, -S, 0), (S, -S, 0), (S, S, 0), (-S, S, 0)])
    g.face([0, 1, 2, 3], uv=[(-S, -S), (S, -S), (S, S), (-S, S)])
    ground = g.obj("Ground", C["CITY"])
    rv = MB()
    xs = [-2600 + 20 * i for i in range(261)]
    for a, b in zip(xs, xs[1:]):
        rv.strip(Vector((a, river_y(a))), Vector((b, river_y(b))), 48, 0.12, bt=PLAIN)
    river = rv.obj("River_Frozen", C["CITY"])
    # unlit service roads to the infrastructure sites
    for p, q in ((Vector((2000, -410)), GAS_C + Vector((-60, -60))),
                 (Vector((-900, -900)), COMPRESSOR),
                 (COMPRESSOR, PUMP_C),
                 (Vector((-640, 1550)), WIND_C + Vector((300, -150)))):
        rural.strip(p, q, 10, 0.2)
    roads = rural.obj("Roads_Rural", C["CITY"])
    hl = MB()
    rng = random.Random(7)
    for k in range(70):
        a = 2 * math.pi * k / 70 + rng.uniform(-0.03, 0.03)
        R = rng.uniform(6500, 8200)
        hl.cyl(R * math.cos(a), R * math.sin(a), rng.uniform(500, 1100), rng.uniform(60, 190), z0=-5, n=10, r2=rng.uniform(80, 250))
    hills = hl.obj("Hills_Horizon", C["CITY"])
    return [ground, river, roads, hills]


# ---------------------------------------------------------------- infrastructure
def build_wind(C):
    wc = coll("WindFarm", C["INFRA"])
    rng = random.Random(11)
    pts = []
    for gx in range(6):
        for gy in range(5):
            pts.append(WIND_C + Vector(((gx - 2.5) * 240 + rng.uniform(-50, 50), (gy - 2) * 230 + rng.uniform(-50, 50))))
    pts.sort(key=lambda p: (round(-p.y / 230), p.x))   # fixed order: front rows first
    yaw = math.radians(45)   # rotors face the north-west wind
    d = Vector((-math.sin(yaw), math.cos(yaw)))
    turbines, rotors = [], []
    for i, p in enumerate(pts, 1):
        t = MB()
        t.cyl(0, 0, 2.6, 85, n=10, r2=1.6)
        t.box(-d.x * 2.5, -d.y * 2.5, 4.2, 12, 4.2, z0=84, yaw=yaw)    # nacelle
        tob = t.obj(f"Turbine_{i:02d}", wc)
        tob.location = (p.x, p.y, 0)
        r = MB()
        r.box(0, 0, 3.0, 4.0, 3.0, z0=-1.5)                             # hub
        for k in range(3):
            a = 2 * math.pi * k / 3
            ca, sa = math.cos(a), math.sin(a)
            for seg in range(4):   # tapered blade from 4 boxes, in the local XZ plane
                L0, L1 = 2 + seg * 10.5, 2 + (seg + 1) * 10.5
                hw, ht, hl = (2.4 - seg * 0.5) / 2, 0.35, (L1 - L0) / 2
                cxb, czb = ca * (L0 + L1) / 2, sa * (L0 + L1) / 2
                corners = []
                for yy in (-ht, ht):
                    for (u, v) in ((-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw)):
                        corners.append((cxb + u * ca - v * sa, yy, czb + u * sa + v * ca))
                o = r.add_v(corners)
                for q in range(4):
                    j = (q + 1) % 4
                    r.face([o + q, o + j, o + 4 + j, o + 4 + q])
                r.face([o, o + 1, o + 2, o + 3]); r.face([o + 7, o + 6, o + 5, o + 4])
        rob = r.obj(f"Rotor_{i:02d}", wc)
        rob.location = (p.x + d.x * 4.5, p.y + d.y * 4.5, 86)
        rob.rotation_euler = (0, 0, yaw)
        rob["order"] = i
        rob["phase"] = rng.uniform(0, 2.0944)
        turbines.append(tob); rotors.append(rob)
    av = MB()
    for p in pts:   # aviation lights on nacelle tops
        av.box(p.x - d.x * 6, p.y - d.y * 6, 1.6, 1.6, 1.2, z0=88.2)
    avo = av.obj("Turbine_AviationLights", wc)
    return turbines, rotors, avo


def build_gasplant(C):
    gc = coll("GasPlant", C["INFRA"])
    x, y = GAS_C
    g = MB()
    g.box(x, y, 95, 34, 24)                    # turbine hall
    for k in range(3):
        g.box(x - 32 + k * 32, y + 36, 16, 30, 32)      # HRSG blocks
    g.box(x - 70, y - 40, 30, 18, 12)          # admin / control
    for k in range(4):
        g.cyl(x + 70 + (k % 2) * 30, y - 40 + (k // 2) * 30, 11, 14, n=18)   # tanks
    g.box(x + 10, y - 80, 90, 40, 1.0)         # switchyard pad
    for k in range(6):
        g.box(x - 25 + k * 14, y - 80, 4, 6, 6)        # transformers
    for k in range(5):
        g.box(x - 120, y - 20 + k * 22, 12, 14, 16)    # cooling cells
    for dy in (-0.6, 0.6):
        g.trace_pipe((x - 190, y - 12 + dy), (x - 48, y - 12 + dy), 3.5, 0.4, pipe_mat=1)   # fuel-gas inlet
        g.trace_pipe((x + 48, y - 26 + dy), (x + 90, y - 26 + dy), 3.5, 0.4, pipe_mat=1)    # tank farm header
    g.trace_pipe((x + 70, y - 26), (x + 70, y - 34), 3.5, 0.4, pipe_mat=1)
    g.trace_pipe((x + 100, y - 26), (x + 100, y - 34), 3.5, 0.4, pipe_mat=1)
    plant = g.obj("GasPlant_01", gc)
    stacks, steam = [], []
    for k in range(3):
        sx, sy = x - 32 + k * 32, y + 58
        s = MB(); s.cyl(0, 0, 4.0, 72, n=16, r2=3.3)
        so = s.obj(f"Stack_{k + 1:02d}", gc); so.location = (sx, sy, 0)
        stacks.append(so)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1)
        st = bpy.context.active_object
        st.name = f"Steam_{k + 1:02d}"
        for c in st.users_collection: c.objects.unlink(st)
        gc.objects.link(st)
        st.location = (sx + 26, sy - 22, 72 + 50)
        st.scale = (30, 20, 58)
        st.rotation_euler = (math.radians(28), 0, math.radians(-135))
        steam.append(st)
    sl = MB()
    for k in range(16):   # site light masts: pole (mat 0) + lamp head (mat 1)
        a = 2 * math.pi * k / 16
        lx, ly = x + 140 * math.cos(a), y + 100 * math.sin(a)
        sl.cyl(lx, ly, 0.3, 16, n=6)
        sl.box(lx, ly, 3.0, 3.0, 0.8, z0=16, mat=1)
    for k in range(3):   # walkway lights on the HRSG blocks
        for zz in (10, 20, 30):
            sl.box(x - 32 + k * 32, y + 20.6, 12, 0.3, 0.4, z0=zz, mat=1)
    for dx, dy, rr in ((-150, 0, 60), (0, 130, 70), (150, 40, 60), (0, -130, 70)):
        sl.disc(x + dx, y + dy, rr, 0.6, n=24, mat=2)
    slo = sl.obj("GasPlant_SiteLights", gc)
    return plant, stacks, steam, slo


def build_gasfield(C):
    zc = bpy.data.collections["Zone_GAS"]
    rng = random.Random(23)
    wells, beams = [], []
    pts = []
    while len(pts) < 18:
        p = PUMP_C + Vector((rng.uniform(-330, 330), rng.uniform(-260, 260)))
        if all((p - q).length > 85 for q in pts) and (p - COMPRESSOR).length > 160:
            pts.append(p)
    pts.sort(key=lambda p: (p.x, p.y))
    for i, p in enumerate(pts, 1):
        yaw = rng.uniform(0, math.pi)
        w = MB()
        w.box(0, 0, 26, 22, 0.25, mat=1)              # gravel well pad
        w.box(0, 0, 9, 2.4, 0.9)                      # skid
        w.box(-0.5, 0, 0.8, 1.8, 5.2, z0=0.9)        # samson post
        w.box(-4.0, 0, 1.6, 1.6, 2.0, z0=0.9)         # gearbox / motor
        w.box(3.6, 0, 1.2, 1.2, 1.0, z0=0.9)          # wellhead / stuffing box
        w.trace_pipe((4.2, 0), (12.5, 0), 0.75, 0.22)  # heat-traced flowline to the pad edge
        w.box(3.6, 0, 1.36, 1.36, 0.14, z0=1.5, mat=2)  # heat-trace band on the wellhead
        wo = w.obj(f"Wellhead_{i:02d}", zc)
        wo.location = (p.x, p.y, 0); wo.rotation_euler = (0, 0, yaw)
        b = MB()
        b.box(0, 0, 9.5, 0.6, 0.8, z0=-0.4)            # walking beam
        b.box(5.0, 0, 1.0, 1.0, 3.0, z0=-2.4)          # horsehead
        b.box(-4.6, 0, 1.6, 1.4, 1.4, z0=-1.4)         # counterweight
        bo = b.obj(f"Wellhead_{i:02d}_Beam", zc)
        bo.parent = wo
        bo.location = (-0.5, 0, 6.3)
        bo["phase"] = rng.uniform(0, 2 * math.pi)
        wells.append(wo); beams.append(bo)
    cmp_ = MB()
    x, y = COMPRESSOR
    cmp_.box(x, y, 100, 76, 0.4, mat=1)                 # gravel pad
    cmp_.box(x, y, 40, 18, 10)
    cmp_.box(x + 30, y - 4, 18, 13, 8)
    for k in range(5):
        cmp_.box(x - 14 + k * 9, y + 20, 6, 6, 4.5)    # gas coolers
    cmp_.box(x, y - 18, 70, 1.4, 1.4, z0=3)            # pipe rack
    for dy in (-0.35, 0.35):
        cmp_.trace_pipe((x - 35, y - 18 + dy), (x + 35, y - 18 + dy), 4.75, 0.3)   # traced process pipes
    cmp_.trace_pipe((x - 20, y - 30), (x - 20, y - 19), 1.2, 0.3)                 # vessel header
    cmp_.cyl(x - 34, y + 12, 1.0, 24, n=8)             # vent stack
    for k in range(3):
        cmp_.cyl(x - 30 + k * 7, y - 30, 2.6, 9, n=12)  # scrubber vessels
        for zb in (2.5, 5.0, 7.5):
            cmp_.cyl(x - 30 + k * 7, y - 30, 2.68, 0.16, z0=zb, n=12, mat=2)   # heat-trace bands
    for zb in range(3, 24, 3):
        cmp_.cyl(x - 34, y + 12, 1.08, 0.16, z0=zb, n=8, mat=2)               # vent-stack trace bands
    co = cmp_.obj("Compressor_01", zc)
    fl = MB()
    for p in pts:   # field lights: one small lamp per pad
        fl.cyl(p.x + 8, p.y + 8, 0.15, 6, n=6)
        fl.box(p.x + 8, p.y + 8, 2.2, 2.2, 0.6, z0=6, mat=1)
    for k in range(10):
        a = 2 * math.pi * k / 10
        lx, ly = x + 55 * math.cos(a), y + 42 * math.sin(a)
        fl.cyl(lx, ly, 0.25, 12, n=6)
        fl.box(lx, ly, 3.2, 3.2, 0.8, z0=12, mat=1)
    for k in range(4):   # lit walkways on the compressor building
        fl.box(x - 15 + k * 10, y - 9.2, 6, 0.3, 0.4, z0=6, mat=1)
    for p in pts:
        fl.disc(p.x + 4, p.y + 4, 22, 0.6, mat=2)
    fl.disc(x - 60, y + 52, 45, 0.6, n=24, mat=2)
    fl.disc(x, y - 55, 40, 0.8, n=24, mat=2)
    flo = fl.obj("GasField_Lights", zc)
    return wells, beams, co, flo


def lattice_pylon(mb, x, y, yaw):
    """Lattice transmission tower; arms along local X (across the line)."""
    c, s = math.cos(yaw), math.sin(yaw)
    def P(px, py, z): return (x + px * c - py * s, y + px * s + py * c, z)
    levels = [(0, 5.0), (8, 3.9), (16, 2.9), (24, 2.0), (30, 1.5), (37, 1.15), (44, 0.8)]
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    for (z0, w0), (z1, w1) in zip(levels, levels[1:]):
        for k, (sx, sy) in enumerate(corners):
            nx, ny = corners[(k + 1) % 4]
            mb.beam(P(sx * w0, sy * w0, z0), P(sx * w1, sy * w1, z1), 0.45)          # leg
            mb.beam(P(sx * w0, sy * w0, z0), P(nx * w1, ny * w1, z1), 0.18)          # X brace
            mb.beam(P(nx * w0, ny * w0, z0), P(sx * w1, sy * w1, z1), 0.18)
            mb.beam(P(sx * w1, sy * w1, z1), P(nx * w1, ny * w1, z1), 0.2)           # horizontal
    for z, L in ((32, 11.5), (40, 7.5)):          # cross arms (chords + insulator strings)
        for sd in (1, -1):
            mb.beam(P(0, 1.0, z + 1.4), P(sd * L, 0.3, z + 0.4), 0.25)
            mb.beam(P(0, -1.0, z + 1.4), P(sd * L, -0.3, z + 0.4), 0.25)
            mb.beam(P(sd * 1.3, 1.3, z), P(sd * L, 0.3, z + 0.4), 0.25)
            mb.beam(P(sd * 1.3, -1.3, z), P(sd * L, -0.3, z + 0.4), 0.25)
            mb.beam(P(sd * (L - 0.3), 0, z + 0.4), P(sd * (L - 0.3), 0, z - 2.2), 0.22)
    mb.beam(P(0, 0, 44), P(0, 0, 49), 0.3)        # earth-wire peak


CONDUCTORS = [(-11.2, 29.8), (11.2, 29.8), (-7.2, 37.8), (7.2, 37.8)]   # (across offset, attach height)


def build_grid_infra(C):
    sc = coll("Substations", C["INFRA"])
    bc = coll("BatteryStorage", C["INFRA"])
    lc = coll("TransmissionLines", C["INFRA"])
    subs = []
    for k, p in SUB.items():
        s = MB()
        s.box(p.x, p.y, 90, 70, 0.4, mat=1)                # gravel pad
        for t in range(4):
            s.box(p.x - 27 + t * 18, p.y - 12, 6, 4.5, 5.5)      # transformers
        for t in range(5):                                  # gantries
            gx = p.x - 36 + t * 18
            s.box(gx, p.y + 18, 0.8, 0.8, 16); s.box(gx, p.y + 30, 0.8, 0.8, 16)
            s.box(gx, p.y + 24, 0.8, 13, 0.8, z0=15.2)
        s.box(p.x + 34, p.y - 20, 10, 8, 4)                 # control house
        for a, b in (((-45, -35), (45, -35)), ((45, -35), (45, 35)), ((45, 35), (-45, 35)), ((-45, 35), (-45, -35))):
            pa, pb = p + Vector(a), p + Vector(b)
            m, dv = (pa + pb) / 2, pb - pa
            s.box(m.x, m.y, dv.length if abs(dv.x) > 0 else 0.15, dv.length if abs(dv.y) > 0 else 0.15, 2.4)
        subs.append(s.obj(f"Substation_{k:02d}", sc))
    b = MB(); bl = MB()
    for row in range(8):
        for col in range(12):
            x = BATTERY.x - 80 + col * 14.5
            y = BATTERY.y - 30 + row * 8.5
            b.box(x, y, 12.2, 2.5, 2.6)
            bl.box(x, y - 1.2, 10.5, 0.18, 0.14, z0=2.6)    # status light strip on the roof edge
    bat = b.obj("BatteryYard_01", bc)
    batl = bl.obj("BatteryYard_01_Lights", bc)

    routes = [
        ("Line_WindFarm_Sub01", [WIND_C + Vector((420, -330)), SUB[1] + Vector((-45, 20))]),
        ("Line_GasPlant_Sub02", [GAS_C + Vector((-130, -80)), SUB[2] + Vector((45, 0))]),
        ("Line_Sub02_City", [SUB[2] + Vector((-45, 0)), CITY_FEED]),
        ("Line_Sub01_Sub03", [SUB[1] + Vector((0, -35)), Vector((-1450, -250)), SUB[3] + Vector((-45, 0))]),
        ("Line_Sub03_Compressor", [SUB[3] + Vector((-45, -10)), COMPRESSOR + Vector((50, -38))]),
    ]
    pyl = MB()
    lines = []
    for name, wps in routes:
        poles = []
        for a, bq in zip(wps, wps[1:]):
            L = (bq - a).length
            nseg = max(1, round(L / 230))
            for s_ in range(nseg + (1 if bq is wps[-1] else 0)):
                poles.append(a.lerp(bq, s_ / nseg))
        cu = bpy.data.curves.new(name, 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = 0.18
        cu.bevel_resolution = 1
        def frame(pi_):
            nb = poles[min(pi_ + 1, len(poles) - 1)] - poles[max(pi_ - 1, 0)]
            nb.normalize()
            return Vector((-nb.y, nb.x))
        for off, hz in CONDUCTORS:
            sp = cu.splines.new('POLY')
            pts3 = []
            for pi_ in range(len(poles) - 1):
                a0 = poles[pi_] + frame(pi_) * off
                a1 = poles[pi_ + 1] + frame(pi_ + 1) * off
                for t_ in range(12):
                    tt = t_ / 12
                    xy = a0.lerp(a1, tt)
                    pts3.append((xy.x, xy.y, hz - 7.0 * (1 - (2 * tt - 1) ** 2)))
            xy = poles[-1] + frame(len(poles) - 1) * off
            pts3.append((xy.x, xy.y, hz))
            sp.points.add(len(pts3) - 1)
            for k, pt in enumerate(pts3):
                sp.points[k].co = (*pt, 1)
        lo = bpy.data.objects.new(name, cu)
        lc.objects.link(lo)
        lines.append(lo)
        for pi_, p in enumerate(poles):
            nrm = frame(pi_)
            lattice_pylon(pyl, p.x, p.y, math.atan2(nrm.y, nrm.x))
    pylons = pyl.obj("Pylons", lc)
    return subs, bat, batl, lines, pylons


# ---------------------------------------------------------------- cameras
def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


CAMS = {
    #           location                 target              lens  resolution
    "CAM_Wide":   ((1180, -1420, 560),   (-520, 230, 0),     26, (1920, 1080)),
    "CAM_Street": ((1820, 150, 2.4),     (0, 40, 260),       36, (1920, 1080)),
    "CAM_Aerial": ((0, -900, 5600),      (0, 260, 0),        27, (1920, 1080)),
    "CAM_Split":  ((3277, -2008, 5734),  (-200, 0, 0),       47, (960, 1080)),
}


def build_cameras(C):
    out = {}
    clip = {"CAM_Wide": 20.0, "CAM_Street": 1.0, "CAM_Aerial": 200.0, "CAM_Split": 200.0}   # near clip sized to each view (depth precision)
    for name, (loc, tgt, lens, res) in CAMS.items():
        cd = bpy.data.cameras.new(name)
        cd.lens = lens
        cd.clip_start, cd.clip_end = clip[name], 30000
        ob = bpy.data.objects.new(name, cd)
        C["CAMERAS"].objects.link(ob)
        ob.location = loc
        look_at(ob, tgt)
        ob["target"] = tgt
        ob["res_x"], ob["res_y"] = res
        ob.lock_location = ob.lock_rotation = (True, True, True)
        ob["LOCKED"] = True
        out[name] = ob
    # animated fly-over, 20 s @ 30 fps, ends in the CAM_Wide framing
    cd = bpy.data.cameras.new("CAM_Fly")
    cd.clip_start, cd.clip_end = 5.0, 30000
    fly = bpy.data.objects.new("CAM_Fly", cd)
    fly["res_x"], fly["res_y"] = 1920, 1080
    C["CAMERAS"].objects.link(fly)
    tgt = bpy.data.objects.new("CAM_Fly_Target", None)
    tgt.empty_display_size = 20
    C["CAMERAS"].objects.link(tgt)
    con = fly.constraints.new('TRACK_TO')
    con.target = tgt
    con.track_axis, con.up_axis = 'TRACK_NEGATIVE_Z', 'UP_Y'
    wl, wt, wlens, _ = CAMS["CAM_Wide"]
    keys = [  # frame, camera location, look target, lens
        (1,   (-1450, 1060, 95),    (-2100, 1650, 95),  28),
        (150, (-1950, 320, 260),    (-1800, -1100, 20), 28),
        (270, (-1300, -800, 170),   (-1750, -1400, 0),  28),
        (420, (-500, -650, 420),    (100, 250, 60),     28),
        (520, (650, -1150, 520),    (-300, 250, 20),    27),
        (600, wl,                   wt,                 wlens),
    ]
    for f, loc, t, lens in keys:
        fly.location = loc; fly.keyframe_insert("location", frame=f)
        tgt.location = t; tgt.keyframe_insert("location", frame=f)
        cd.lens = lens; cd.keyframe_insert("lens", frame=f)
    out["CAM_Fly"] = fly
    bpy.context.scene.camera = out["CAM_Wide"]
    return out


# ---------------------------------------------------------------- viewport colours (zone map)
def viewport_colors():
    for z in ZONE_NAMES:
        for ob in bpy.data.collections[z].all_objects:
            set_color(ob, hex_rgb(ZONE_HEX[z]))
    for ob in bpy.data.collections["INFRA"].all_objects:
        set_color(ob, (0.45, 0.47, 0.52))
    for ob in bpy.data.collections["CITY"].all_objects:
        set_color(ob, (0.012, 0.014, 0.018))
    bpy.data.objects["River_Frozen"].color = (0.35, 0.45, 0.55, 1)
    bpy.data.objects["Roads_Rural"].color = (0.06, 0.06, 0.07, 1)
    for scr in bpy.data.screens:
        for area in scr.areas:
            for sp in area.spaces:
                if sp.type == 'VIEW_3D':
                    sp.shading.color_type = 'OBJECT'
                    sp.clip_end = 30000


def main():
    sc = reset()
    C = {n: coll(n) for n in ("CITY", "ZONES", "INFRA", "WINTER_FX", "CAMERAS")}
    for z in ZONE_NAMES:
        coll(z, C["ZONES"])
    city, rural = build_city(C)
    crit = build_crit(C)
    ground = build_ground(C, rural)
    turbines, rotors, avl = build_wind(C)
    plant, stacks, steam, plant_lights = build_gasplant(C)
    wells, beams, comp, field_lights = build_gasfield(C)
    subs, bat, batl, lines, pylons = build_grid_infra(C)
    build_cameras(C)
    viewport_colors()
    looks.apply(sc, C, dict(
        city=city, crit=crit, ground=ground, turbines=turbines, rotors=rotors, aviation=avl,
        plant=plant, stacks=stacks, steam=steam, plant_lights=plant_lights,
        wells=wells, beams=beams, compressor=comp, field_lights=field_lights,
        subs=subs, battery=bat, battery_lights=batl, lines=lines, pylons=pylons))
    sc["zone_hex"] = ZONE_HEX
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT), compress=True)
    nb = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f"BUILD OK objects={len(bpy.data.objects)} faces={nb} -> {OUT}")


if __name__ == "__main__":
    main()
