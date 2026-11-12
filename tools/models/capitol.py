"""United States Capitol with a breach in each wing. World frame: metres, Z up, west front faces -Y, ground z=0.
Parts: Capitol (root, all geometry), markers ChuckSpot (-50, -10, 3) and HakeemSpot (50, -10, 3).
Layout: terrace top z=3 (x +-74, y +-26), stair 30 m wide from y=-26 down to y=-40, central block x +-30 (top z=25),
dome at (0, 0) up to z=60, Senate wing x -70..-30, House wing x 30..70 (top z=21).
Breach in each wing: x 37..63 (abs), y -22..3 is empty down to the terrace top."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *
from lowpoly import poly as kit_poly

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('capitol')

M = (0.91, 0.90, 0.86)    # marble (wings, dome trim)
S = (0.90, 0.86, 0.76)    # painted sandstone (central block)
GLASS = (0.15, 0.19, 0.27)


def k(c, f):
    return tuple(min(1.0, v * f) for v in c)


pal.color('marble', M, noise=0.025)
pal.color('marble_d', k(M, 0.8), noise=0.03)
pal.color('plaza', (0.74, 0.73, 0.69), noise=0.02)
pal.color('grass', (0.27, 0.47, 0.20), noise=0.05)
pal.color('roof', (0.30, 0.34, 0.35), noise=0.03)
pal.color('roof_c', (0.36, 0.33, 0.31), noise=0.03)
pal.color('tread', k(M, 0.97), noise=0.02)
pal.color('riser', k(M, 0.62), noise=0.02)
pal.color('rubble', k(M, 0.86), noise=0.09, grime=0.35)
pal.color('bronze', (0.22, 0.30, 0.25), noise=0.08)
pal.color('domecap', (0.86, 0.87, 0.88), noise=0.02)


def win(base):
    def fn(x, y):
        if 5 <= x <= 10 and (2 <= y <= 6 or 9 <= y <= 13):
            return k(GLASS, 1.5) if y in (6, 13) else GLASS
        if 4 <= x <= 11 and y in (1, 7, 8, 14):
            return k(base, 0.72)
        if x in (4, 11) and (2 <= y <= 6 or 9 <= y <= 13):
            return k(base, 0.8)
        if x in (0, 15):
            return k(base, 0.74)
        if x in (1, 2, 13, 14):
            return k(base, 1.05)
        return k(base, 0.95)
    return fn


def basefn(base):
    def fn(x, y):
        if (6 <= x <= 9 and 2 <= y <= 9) or (7 <= x <= 8 and y == 10):
            return GLASS
        if y % 4 == 0 or (x + (y // 4) * 4) % 8 == 0:
            return k(base, 0.68)
        return k(base, 0.88)
    return fn


def cornfn(base):
    def fn(x, y):
        if y >= 14:
            return k(base, 1.06)
        if y == 13:
            return k(base, 0.55)
        if 10 <= y <= 12:
            return k(base, 1.0 if x % 2 == 0 else 0.66)
        if y == 9:
            return k(base, 0.6)
        if y <= 1:
            return k(base, 0.72)
        return k(base, 0.96)
    return fn


FL = [0.55, 0.8, 1.0, 0.86, 1.05, 0.86, 1.02, 0.84, 1.0, 0.84, 1.0, 0.86, 0.96, 0.8, 0.68, 0.52]


def colfn(x, y):
    if y >= 14 or y <= 0:
        return k(M, 1.06 if 1 <= x <= 14 else 0.75)
    if y in (13, 1):
        return k(M, 0.6)
    return k(M, FL[x])


def domefn(x, y):
    if x in (0, 1, 14, 15):
        return (1.0, 1.0, 0.98)
    if x in (2, 13):
        return (0.56, 0.59, 0.64)
    if y in (0, 15):
        return (0.66, 0.69, 0.73)
    return (0.84, 0.86, 0.88)


def drumfn(x, y):
    if (x % 8) in (2, 3, 4, 5) and 2 <= y <= 12:
        return GLASS if y < 12 else k(GLASS, 1.6)
    if y >= 14:
        return k(M, 0.9)
    return k(M, 0.66)


def atticfn(x, y):
    if y >= 14:
        return k(M, 1.05)
    if y == 13 or y == 0:
        return k(M, 0.6)
    if (x % 4) in (1, 2) and 4 <= y <= 10:
        return GLASS
    if x % 4 == 3:
        return k(M, 0.78)
    return k(M, 0.97)


def lanternfn(x, y):
    if y >= 14 or y <= 1:
        return k(M, 1.0)
    return k(M, 1.05) if x % 4 in (0, 1) else (0.16, 0.18, 0.22)


def interiorfn(x, y):
    h = (x * 7 + y * 13 + (x * y) % 5) % 7
    if y % 8 == 7:
        return (0.70, 0.68, 0.63) if h else (0.48, 0.46, 0.42)
    if y % 8 == 6:
        return (0.12, 0.10, 0.10)
    if x == 8 and h > 1:
        return (0.46, 0.43, 0.40)
    if h == 0:
        return (0.40, 0.30, 0.25)
    return (0.20 + 0.012 * h, 0.17 + 0.01 * h, 0.17 + 0.008 * h)


def tympfn(x, y):
    edge = 16 * (1 - abs(x - 7.5) / 8.0)
    if y <= 1:
        return k(M, 1.04)
    if y < edge - 3.2:
        if 3 <= y <= 3 + (edge - 7) * 0.5 and x % 3 == 1:
            return k(M, 0.98)
        return k(M, 0.6)
    return k(M, 1.04)


def doorfn(x, y):
    if 5 <= x <= 10 and y <= 11:
        return (0.28, 0.2, 0.13) if x not in (7, 8) or y > 9 else (0.2, 0.14, 0.09)
    if 4 <= x <= 11 and y <= 13:
        return k(S, 0.7)
    return k(S, 0.9)


pal.pattern('win_c', win(S))
pal.pattern('win_w', win(M))
pal.pattern('base_c', basefn(S))
pal.pattern('base_w', basefn(M))
pal.pattern('corn_c', cornfn(S))
pal.pattern('corn_w', cornfn(M))
pal.pattern('column', colfn)
pal.pattern('dome', domefn)
pal.pattern('drum', drumfn)
pal.pattern('attic', atticfn)
pal.pattern('lantern', lanternfn)
pal.pattern('interior', interiorfn)
pal.pattern('tymp', tympfn)
pal.pattern('door', doorfn)

root = Part('Capitol', (0, 0, 0))
Part('ChuckSpot', (-50, -10, 3), parent=root)
Part('HakeemSpot', (50, -10, 3), parent=root)


FIT = {'dome'}


class Builder:
    """Collects faces with authoritative winding (counter-clockwise seen from outside) and a swatch each."""

    def __init__(self, mirror=False):
        self.v, self.f, self.keys, self.n = [], [], [], []
        self.mirror = mirror

    def face(self, pts, key):
        pts = [Vector(p) for p in pts]
        if self.mirror:
            pts = [Vector((-p.x, p.y, p.z)) for p in reversed(pts)]
        nrm = Vector((0, 0, 0))
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            nrm += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
        i0 = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(list(range(i0, i0 + len(pts))))
        self.keys.append(key)
        self.n.append(nrm)

    def emit(self, part):
        it = iter(self.keys)
        ob = kit_poly(part, pal, lambda f: next(it), self.v, self.f)
        assert len(ob.data.polygons) == len(self.n)
        for p, nd in zip(ob.data.polygons, self.n):
            if p.normal.dot(nd) < 0:
                p.flip()
        ob.data.update()
        # facets listed in FIT get their four corners pinned to the swatch corners, so ribs follow the taper
        uvd = ob.data.uv_layers.active.data
        for p, key in zip(ob.data.polygons, self.keys):
            if key not in FIT:
                continue
            u0, v0, u1, v1 = pal.rect(key)
            cs = [ob.data.vertices[vi].co for vi in p.vertices]
            cx, cy = sum(c.x for c in cs) / len(cs), sum(c.y for c in cs) / len(cs)
            zmid = (min(c.z for c in cs) + max(c.z for c in cs)) / 2
            for li, c in zip(p.loop_indices, cs):
                uvd[li].uv = (u1 if cx * c.y - cy * c.x > 0 else u0, v1 if c.z > zmid else v0)
        return ob

    # ---- helpers
    def wall(self, p0, p1, bands, pw=5.0):
        """Vertical wall from p0 to p1 (x, y); outside is on the right of travel. bands = [(z0, z1, key)]."""
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        n = max(1, round(L / pw))
        for z0, z1, key in bands:
            for i in range(n):
                a = (p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n)
                c = (p0[0] + (p1[0] - p0[0]) * (i + 1) / n, p0[1] + (p1[1] - p0[1]) * (i + 1) / n)
                self.face([(a[0], a[1], z0), (c[0], c[1], z0), (c[0], c[1], z1), (a[0], a[1], z1)], key)

    def tube(self, cx, cy, z0, z1, r0, r1, segs, key, phase=0.0):
        for i in range(segs):
            a0 = math.radians(phase + 360.0 * i / segs)
            a1 = math.radians(phase + 360.0 * (i + 1) / segs)
            c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
            pts = [(cx + r0 * c0, cy + r0 * s0, z0), (cx + r0 * c1, cy + r0 * s1, z0)]
            if r1 > 1e-6:
                pts += [(cx + r1 * c1, cy + r1 * s1, z1), (cx + r1 * c0, cy + r1 * s0, z1)]
            else:
                pts += [(cx, cy, z1)]
            self.face(pts, key)

    def disk(self, cx, cy, z, r, segs, key, phase=0.0, up=True):
        pts = [(cx + r * math.cos(math.radians(phase + 360.0 * i / segs)),
                cy + r * math.sin(math.radians(phase + 360.0 * i / segs)), z) for i in range(segs)]
        self.face(pts if up else pts[::-1], key)

    def column(self, x, y, z0, z1, r, segs=6, cap=False, key='column'):
        self.tube(x, y, z0, z1, r, r * 0.88, segs, key, phase=90.0 / segs)
        if cap:
            self.disk(x, y, z1, r * 0.88, segs, 'marble_d', phase=90.0 / segs)

    def slab(self, lo, hi, side, top=None, bottom=None):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        self.wall((x0, y0), (x1, y0), [(z0, z1, side)], pw=1e9)
        self.wall((x1, y0), (x1, y1), [(z0, z1, side)], pw=1e9)
        self.wall((x1, y1), (x0, y1), [(z0, z1, side)], pw=1e9)
        self.wall((x0, y1), (x0, y0), [(z0, z1, side)], pw=1e9)
        if top:
            self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top)
        if bottom:
            self.face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], bottom)

    def spike(self, x, y, z, r, h, key, lean=(0, 0)):
        self.tube(x, y, z, z + h, r, 0, 3, key, phase=30 + x * 37)
        if lean != (0, 0):  # move the apex we just wrote
            for fi in range(-3, 0):
                vi = self.f[fi][-1 if not self.mirror else 0]
                vx, vy, vz = self.v[vi]
                self.v[vi] = (vx + (-lean[0] if self.mirror else lean[0]), vy + lean[1], vz)


# =============================================================== terrace + stairs
b = Builder()
TX, TY, SL = 74, 26, 6
top = [(-TX, -TY, 3), (TX, -TY, 3), (TX, TY, 3), (-TX, TY, 3)]
bot = [(-TX - SL, -TY - SL, 0), (TX + SL, -TY - SL, 0), (TX + SL, TY + SL, 0), (-TX - SL, TY + SL, 0)]
b.face(top, 'plaza')
for i in range(4):
    j = (i + 1) % 4
    # split each grass slope into strips so the swatch is not smeared over 150 m
    n = 6 if i % 2 == 0 else 2
    for s in range(n):
        f0, f1 = s / n, (s + 1) / n
        lerp = lambda a, c, t: tuple(a[q] + (c[q] - a[q]) * t for q in range(3))
        b.face([lerp(bot[i], bot[j], f0), lerp(bot[i], bot[j], f1), lerp(top[i], top[j], f1), lerp(top[i], top[j], f0)], 'grass')
b.emit(root)

STEPS = 7
pts = [(-40, 0)]
for i in range(STEPS):
    pts += [(-40 + 2 * i, 3.0 * (i + 1) / STEPS), (-40 + 2 * (i + 1), 3.0 * (i + 1) / STEPS)]
pts += [(-26, 0)]
stair_col = lambda f: 'tread' if f.normal.z > 0.7 else ('riser' if f.normal.y < -0.7 else 'marble_d')
profile(root, pal, stair_col, pts, 30.0, plane='YZ')
for sx in (-1, 1):  # cheek walls
    profile(root, pal, 'marble', [(-40.0, 0), (-40.0, 1.2), (-38.6, 1.2), (-27.5, 4.0), (-25.5, 4.0), (-25.5, 0)], 1.8,
            loc=(sx * 15.9, 0, 0), plane='YZ', side_color='marble_d')

# =============================================================== central block
b = Builder()
CB = [(3, 8, 'base_c'), (8, 21.5, 'win_c'), (21.5, 25, 'corn_c')]
b.wall((-30, -22), (30, -22), CB)
b.wall((30, -22), (30, 22), CB, pw=5.5)
b.wall((30, 22), (-30, 22), CB)
b.wall((-30, 22), (-30, -22), CB, pw=5.5)
b.face([(-30, -22, 25), (30, -22, 25), (30, 22, 25), (-30, 22, 25)], 'roof_c')
# doors behind the porticos
for ys in (-1, 1):
    for x in (-5.2, 0, 5.2):
        q = [(x - 2, ys * 22.15, 3.35), (x + 2, ys * 22.15, 3.35), (x + 2, ys * 22.15, 11), (x - 2, ys * 22.15, 11)]
        b.face(q if ys < 0 else q[::-1], 'door')


def portico_y(b, ys, xs, ycol, z0, z1, r, hw, y_out, ent_h):
    """Portico on a wall facing -Y (ys=-1) or +Y (ys=1): podium, columns, entablature."""
    ya, yb = sorted((ys * 22.0, ys * y_out))
    b.slab((-hw, ya, 3), (hw, yb, z0), 'marble_d', top='tread')
    for x in xs:
        b.column(x, ys * ycol, z0, z1, r)
    b.slab((-hw, ya, z1), (hw, yb, z1 + ent_h), 'corn_c', bottom='marble_d')


XS = [-12.25 + 3.5 * i for i in range(8)]
portico_y(b, -1, XS, 24.6, 3.35, 19.0, 0.95, 14.2, 25.8, 2.5)
portico_y(b, 1, XS, 24.6, 3.35, 19.0, 0.95, 14.2, 25.8, 2.5)
b.emit(root)
ped_col = lambda f: 'tymp' if abs(f.normal.y) > 0.9 else ('roof_c' if f.normal.z > 0.2 else 'marble_d')
for ys in (-1, 1):
    profile(root, pal, ped_col, [(-15.0, 21.5), (15.0, 21.5), (0, 27.2)], 8.6, loc=(0, ys * 22.0, 0), plane='XZ')

# =============================================================== dome
b = Builder()
PH = -90 - 18   # a flat facet faces the front
b.tube(0, 0, 25, 28, 14.2, 14.2, 10, 'base_w', PH)
b.disk(0, 0, 28, 14.2, 10, 'marble_d', PH)
b.tube(0, 0, 28, 35, 10.6, 10.6, 10, 'drum', PH)
for i in range(20):
    a = math.radians(-90 + 18 * i + 9)
    b.column(12.3 * math.cos(a), 12.3 * math.sin(a), 28, 35, 0.75, segs=4)
b.disk(0, 0, 35, 13.4, 10, 'marble_d', PH, up=False)
b.tube(0, 0, 35, 36.4, 13.4, 13.4, 10, 'corn_w', PH)
b.disk(0, 0, 36.4, 13.4, 10, 'marble', PH)
b.tube(0, 0, 36.4, 38.6, 11.6, 11.4, 10, 'attic', PH)
RINGS = [(38.6, 11.3), (43.0, 10.4), (47.0, 8.3), (50.0, 5.6), (52.0, 3.4)]
for (za, ra), (zb, rb) in zip(RINGS, RINGS[1:]):
    b.tube(0, 0, za, zb, ra, rb, 10, 'dome', PH)
b.disk(0, 0, 52.0, 3.4, 10, 'domecap', PH)
b.tube(0, 0, 52.0, 53.0, 2.9, 2.9, 8, 'marble', 22.5)
b.disk(0, 0, 53.0, 2.9, 8, 'marble_d', 22.5)
b.tube(0, 0, 53.0, 55.5, 2.2, 2.2, 8, 'lantern', 22.5)
b.disk(0, 0, 55.5, 2.8, 8, 'marble_d', 22.5, up=False)
b.tube(0, 0, 55.5, 55.9, 2.8, 2.8, 8, 'marble', 22.5)
b.tube(0, 0, 55.9, 57.0, 2.8, 0.7, 8, 'domecap', 22.5)
b.disk(0, 0, 57.0, 0.7, 8, 'marble_d', 22.5)
b.emit(root)
# statue
box(root, pal, 'bronze', (0.9, 0.9, 0.6), (0, 0, 57.3))
box(root, pal, 'bronze', (1.0, 0.7, 1.8), (0, 0, 58.5), taper=(0.65, 0.8))
box(root, pal, 'bronze', (0.5, 0.5, 0.6), (0, 0, 59.7), taper=(0.7, 0.7))

# =============================================================== wings
WB = [(3, 8, 'base_w'), (8, 18, 'win_w'), (18, 21, 'corn_w')]
# notch outlines in House-wing coordinates (x 30..70). The clear zone is x 37..63, y -22..3; every point is outside it.
A = [(37.0, -22), (36.2, -17), (37.0, -12), (35.9, -6.5), (36.8, -1), (36.4, 3.7), (42, 3.2), (47, 4.5), (52, 3.1),
     (57, 4.3), (63.3, 3.4), (64.3, -2), (63.1, -8), (64.2, -13), (63.2, -18), (63.0, -22)]
B = [(35.4, -22), (34.8, -16), (35.6, -10.5), (34.8, -5), (35.5, 1), (35.0, 6.2), (41, 5.4), (46, 7.2), (51, 5.5),
     (56, 7.0), (65.0, 6.0), (66.3, -1), (65.0, -7), (66.4, -12.5), (65.3, -17.5), (66.0, -22)]
H_HOUSE = [8, 10.5, 13, 9.5, 13.5, 11, 12.5, 9, 14, 10, 12, 13.5, 9.5, 12.5, 10.5, 8]
H_SENATE = [8, 12.5, 9.5, 13.5, 10, 12, 9.5, 13.5, 10.5, 14, 11, 9, 13, 10, 12, 8]


def wing(mirror, H, seed):
    b = Builder(mirror=mirror)
    sx = -1 if mirror else 1
    # connector to the central block (low, recessed)
    CN = [(3, 8, 'base_w'), (8, 15.5, 'win_w'), (15.5, 18, 'corn_w')]
    b.wall((30, -19), (34, -19), CN)
    b.wall((34, 19), (30, 19), CN)
    b.face([(30, -19, 18), (34, -19, 18), (34, 19, 18), (30, 19, 18)], 'roof')
    # exterior walls
    b.wall((34, -22), (37, -22), [(3, 8, 'base_w')])
    b.wall((34, -22), (35.4, -22), [(8, 18, 'marble'), (18, 21, 'corn_w')])
    b.wall((63, -22), (70, -22), [(3, 8, 'base_w')])
    b.wall((66, -22), (70, -22), WB[1:])
    b.wall((70, -22), (70, 22), WB, pw=5.5)
    b.wall((70, 22), (34, 22), WB, pw=5.2)
    b.wall((34, 22), (34, -22), [(3, 21, 'marble_d')], pw=1e9)
    # breach: lower tier walls, broken floor ledge, upper tier walls
    for i in range(len(A) - 1):
        a0, a1, b0, b1, h0, h1 = A[i], A[i + 1], B[i], B[i + 1], H[i], H[i + 1]
        b.face([(a0[0], a0[1], 3), (a1[0], a1[1], 3), (a1[0], a1[1], h1), (a0[0], a0[1], h0)], 'interior')
        b.face([(a0[0], a0[1], h0), (a1[0], a1[1], h1), (b1[0], b1[1], h1), (b0[0], b0[1], h0)], 'rubble')
        b.face([(b0[0], b0[1], h0), (b1[0], b1[1], h1), (b1[0], b1[1], 21), (b0[0], b0[1], 21)], 'interior')
    # roof
    b.face([(34, -22, 21)] + [(p[0], p[1], 21) for p in B] + [(70, -22, 21), (70, 22, 21), (34, 22, 21)], 'roof')
    # jagged teeth standing on the broken edges
    rng = __import__('random').Random(seed)
    for i in (1, 3, 4, 6, 8, 10, 12, 14):
        p = A[i]
        q = B[i]
        t = rng.uniform(0.3, 0.7)
        b.spike(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, H[i] - 0.3, rng.uniform(0.9, 1.5), rng.uniform(2.5, 5.0),
                'marble_d', lean=(rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8)))
    for i in (2, 5, 7, 9, 11, 13):
        q = B[i]
        cx, cy = 50.0, -9.0
        d = math.hypot(q[0] - cx, q[1] - cy)
        ox, oy = (q[0] - cx) / d, (q[1] - cy) / d
        b.spike(q[0] + ox * 1.0, q[1] + oy * 1.0, 20.8, rng.uniform(1.0, 1.6), rng.uniform(1.8, 3.6), 'marble',
                lean=(-ox * 1.2, -oy * 1.2))
    # front portico, torn apart: the outer end still stands, the rest is stumps
    for x in (64.6, 67.1, 69.6):
        b.column(x, -24.5, 3, 16.5, 0.8)
    b.column(35.6, -24.5, 3, 13.0, 0.8, cap=True)
    b.column(39.0, -24.6, 3, 6.5, 0.8, cap=True)
    b.column(60.8, -24.6, 3, 5.0, 0.8, cap=True)
    b.slab((63.4, -25.7, 16.5), (70.6, -22, 18.5), 'corn_w', bottom='marble_d')
    # end portico (intact) on the outer face
    b.slab((70, -10.5, 3), (73.6, 10.5, 3.6), 'marble_d', top='tread')
    for i in range(6):
        b.column(72.5, -8.75 + 3.5 * i, 3.6, 16.5, 0.8)
    b.slab((70, -10.5, 16.5), (73.6, 10.5, 18.5), 'corn_w', bottom='marble_d')
    b.emit(root)
    pc = lambda f: 'tymp' if abs(f.normal.x) > 0.9 else ('roof' if f.normal.z > 0.2 else 'marble_d')
    profile(root, pal, pc, [(-10.9, 18.5), (10.9, 18.5), (0, 22.4)], 3.8, loc=(sx * 71.9, 0, 0), plane='YZ')
    # broken half pediment over the standing front columns
    hp = [(70.6, 18.5), (70.6, 18.9), (66.2, 20.6), (65.3, 19.7), (64.4, 20.9), (63.4, 20.2), (63.4, 18.5)]
    pc2 = lambda f: 'marble' if abs(f.normal.y) > 0.9 else ('roof' if f.normal.z > 0.2 else 'marble_d')
    profile(root, pal, pc2, [(sx * x, z) for x, z in hp], 3.7, loc=(0, -23.85, 0), plane='XZ')
    # fallen blocks, all outside the clear zone
    blocks = [((41.5, -24.6, 3.85), (2.6, 1.9, 1.8), (8, 6, 20)), ((47, -25.0, 3.55), (1.7, 1.4, 1.2), (0, 12, 40)),
              ((55, -24.7, 3.9), (3.0, 2.0, 1.9), (-9, 7, -25)), ((59.2, -27.5, 2.6), (1.6, 1.3, 1.2), (24, 0, 10)),
              ((44, -29.5, 1.7), (2.6, 2.0, 1.7), (26, 8, 30)), ((57.5, -31.5, 1.35), (2.2, 1.7, 1.5), (-18, 14, 60)),
              ((50, -35.5, 1.25), (2.0, 1.6, 1.4), (6, 18, 15)), ((33.0, -25.0, 3.6), (1.5, 1.3, 1.3), (5, 10, -35)),
              ((46.5, 9.5, 21.5), (2.2, 1.6, 1.2), (10, 5, 25))]
    for (x, y, z), size, rot in blocks:
        j = rng.uniform(-0.8, 0.8)
        if y > -24 and y < 3:
            j = 0
        box(root, pal, 'rubble', size, (sx * (x + j), y - abs(j) * 0.6, z), rot=(rot[0], rot[1] * sx, rot[2] * sx + j * 20),
            taper=(rng.uniform(0.7, 1.0), rng.uniform(0.7, 1.0)))
    # fallen column drums
    cyl(root, pal, 'column', 0.8, 4.2, (sx * (51.5 + rng.uniform(-2, 2)), -28.8, 2.3), axis='X', segs=6, cap_color='marble_d',
        rot=(0, 0, sx * rng.uniform(10, 35)))
    cyl(root, pal, 'column', 0.8, 3.0, (sx * (38.5 + rng.uniform(-1, 1)), -33.5, 0.8), axis='X', segs=6, cap_color='marble_d',
        rot=(0, 0, sx * rng.uniform(-50, -20)))


wing(False, H_HOUSE, 3)
wing(True, H_SENATE, 11)

info = finish_and_export(pal, None, os.path.join(ROOT, 'public/models/world/capitol.glb'),
                         os.path.join(ROOT, 'previews/capitol.png'))

# optional close-up renders for checking the model by eye (not part of the build)
dbg = os.environ.get('CAPITOL_DEBUG')
if dbg:
    import bpy
    sc = bpy.context.scene
    cam = sc.camera
    sc.render.resolution_x, sc.render.resolution_y = 1500, 800
    sc.display.shading.show_backface_culling = True
    for name, target, v, scale in (('front', (0, 0, 26), (0.0, -1.0, 0.18), 175), ('hakeem', (50, -8, 12), (0.25, -1.0, 0.45), 62),
                                   ('chuck', (-50, -8, 12), (-0.6, -1.0, 0.7), 62), ('dome', (0, 0, 38), (0.3, -1.0, 0.25), 62),
                                   ('back', (0, 0, 22), (0.5, 1.0, 0.5), 185), ('top', (0, 0, 22), (0.0, -0.05, 1.0), 185),
                                   ('low', (0, 0, 22), (-0.5, -1.0, -0.02), 185)):
        c = Vector(target)
        cam.data.ortho_scale = scale
        cam.location = c + Vector(v).normalized() * 400
        cam.data.clip_end = 2000
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(dbg, 'capitol_' + name + '.png')
        bpy.ops.render.render(write_still=True)
