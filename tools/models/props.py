"""Scenery props, one GLB each, origin at the base centre on the ground (metres, Z up, front faces -Y).
tree_oak, tree_cherry ('Tree'), lamp ('Lamp'), bench ('Bench'), barrier ('Barrier'), monument ('Monument'),
flagpole ('Flagpole' with child 'Flag' pivoting at the pole)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *
import numpy as np

ROOT = os.path.dirname(os.path.dirname(HERE))


def out(name, pal, scale_figure=True):
    return finish_and_export(pal, None, os.path.join(ROOT, 'public/models/world', name + '.glb'),
                             os.path.join(ROOT, 'previews', name + '.png'), scale_figure=scale_figure)


def stack(part, pal, color, rings, at=(0, 0), rotz=0, bottom=False, top=False, apex=None):
    """Four-sided lofted shell through rings [(z, size_x, size_y, (off_x, off_y))], turned rotz about `at`.
    8 tris per ring pair, 2 per cap, 4 for an apex (z, off_x, off_y). Open ends cost nothing."""
    verts, faces = [], []
    for r in rings:
        z, a, b = r[0], r[1], r[2]
        ox, oy = r[3] if len(r) > 3 else (0, 0)
        verts += [(ox - a / 2, oy - b / 2, z), (ox + a / 2, oy - b / 2, z), (ox + a / 2, oy + b / 2, z), (ox - a / 2, oy + b / 2, z)]
    n = len(rings)
    for i in range(n - 1):
        for k in range(4):
            faces.append((4 * i + k, 4 * i + (k + 1) % 4, 4 * i + 4 + (k + 1) % 4, 4 * i + 4 + k))
    if bottom:
        faces.append((3, 2, 1, 0))
    if top:
        faces.append(tuple(4 * (n - 1) + k for k in range(4)))
    if apex:
        verts.append((apex[1], apex[2], apex[0]))
        for k in range(4):
            faces.append((4 * (n - 1) + k, 4 * (n - 1) + (k + 1) % 4, len(verts) - 1))
    return poly(part, pal, color, verts, faces, loc=(at[0], at[1], 0), rot=(0, 0, rotz))


def speckle(base, spots, seed, lines=None):
    """Swatch fn: base colour with random darker / lighter pixels; spots = [(rgb, probability)]."""
    rng = np.random.default_rng(seed)
    grid = rng.random((16, 16))
    shade = rng.normal(1, 0.05, (16, 16))

    def fn(x, y):
        c = base
        acc = 0
        for rgb, p in spots:
            acc += p
            if grid[y, x] < acc:
                c = rgb
                break
        if lines and lines(x, y):
            c = tuple(v * 0.72 for v in c)
        k = shade[y, x] * (0.82 + 0.18 * y / 15)
        return tuple(min(1, v * k) for v in c)
    return fn


def bark(pal, key, rgb, seed):
    pal.pattern(key, speckle(rgb, [(tuple(v * 0.7 for v in rgb), 0.2)], seed, lines=lambda x, y: x % 4 == 1))


# ================================================================ tree_oak (budget 70)
reset()
pal = Palette('tree_oak')
bark(pal, 'bark', (0.36, 0.26, 0.17), 1)
G = (0.20, 0.42, 0.14)
pal.pattern('leaf', speckle(G, [((0.13, 0.30, 0.10), 0.28), ((0.34, 0.55, 0.17), 0.16)], 2))
pal.pattern('leaf_top', speckle((0.30, 0.52, 0.17), [((0.20, 0.42, 0.14), 0.25), ((0.42, 0.62, 0.20), 0.15)], 3))
pal.pattern('leaf_under', speckle((0.10, 0.24, 0.09), [((0.07, 0.17, 0.07), 0.3)], 4))
leaf = lambda f: 'leaf_under' if f.normal.z < -0.3 else ('leaf_top' if f.normal.z > 0.45 else 'leaf')
t = Part('Tree', (0, 0, 0))
stack(t, pal, 'bark', [(0, 1.8, 1.8), (1.1, 1.2, 1.2), (4.6, 0.85, 0.85)])                                    # trunk with root flare
stack(t, pal, leaf, [(3.5, 4.6, 4.2), (5.3, 9.2, 8.2), (7.4, 5.6, 5.2)], rotz=14, bottom=True, top=True)       # main mass
stack(t, pal, leaf, [(6.3, 4.2, 4.0), (8.0, 6.6, 6.0), (10.0, 2.8, 2.6)], at=(0.5, 0.3), rotz=42, bottom=True, top=True)
box(t, pal, leaf, (4.2, 3.8, 2.6), (-3.3, -1.3, 4.5), rot=(0, 0, 28), taper=(0.65, 0.65))                     # low side clump
out('tree_oak', pal)

# ================================================================ tree_cherry (budget 60)
reset()
pal = Palette('tree_cherry')
bark(pal, 'bark', (0.20, 0.13, 0.11), 5)
P = (0.96, 0.62, 0.76)
pal.pattern('blossom', speckle(P, [((0.86, 0.42, 0.60), 0.25), ((1.0, 0.86, 0.92), 0.2)], 6))
pal.pattern('blossom_top', speckle((1.0, 0.76, 0.86), [((0.96, 0.60, 0.75), 0.22), ((1.0, 0.95, 0.97), 0.2)], 7))
pal.pattern('blossom_under', speckle((0.70, 0.36, 0.52), [((0.50, 0.24, 0.36), 0.3), ((0.20, 0.13, 0.11), 0.08)], 8))
bl = lambda f: 'blossom_under' if f.normal.z < -0.3 else ('blossom_top' if f.normal.z > 0.45 else 'blossom')
t = Part('Tree', (0, 0, 0))
stack(t, pal, 'bark', [(0, 0.55, 0.55), (1.5, 0.36, 0.36, (0.08, 0))])                                         # short trunk
stack(t, pal, 'bark', [(1.3, 0.30, 0.30, (0.08, 0)), (2.9, 0.2, 0.2, (-1.25, 0.35))])                          # forked limbs
stack(t, pal, 'bark', [(1.3, 0.30, 0.30, (0.08, 0)), (3.1, 0.2, 0.2, (1.25, -0.35))])
stack(t, pal, bl, [(2.2, 1.8, 1.6), (3.1, 4.0, 3.6)], at=(-0.75, 0.25), rotz=18, bottom=True, apex=(4.0, 0.3, 0))             # low lobe
stack(t, pal, bl, [(2.8, 1.6, 1.6), (3.9, 3.6, 3.2), (5.0, 2.0, 1.8)], at=(0.75, -0.3), rotz=50, bottom=True, top=True)        # high lobe
out('tree_cherry', pal)

# ================================================================ lamp (budget 50)
reset()
pal = Palette('lamp')
GR = (0.08, 0.22, 0.15)
pal.pattern('post', speckle(GR, [((0.05, 0.15, 0.10), 0.15)], 9, lines=lambda x, y: x % 3 == 0))               # fluted shaft
pal.pattern('base', speckle(GR, [((0.05, 0.15, 0.10), 0.2)], 10, lines=lambda x, y: y in (4, 11) or x in (0, 15)))
pal.color('iron', (0.06, 0.17, 0.12), noise=0.1)
pal.pattern('globe', lambda x, y: (1.0, 0.99, 0.90) if 3 <= x <= 12 else (0.86, 0.87, 0.82))
pal.pattern('globe_lo', lambda x, y: (0.93, 0.93, 0.86) if 3 <= x <= 12 else (0.78, 0.80, 0.76))
lp = Part('Lamp', (0, 0, 0))
stack(lp, pal, lambda f: 'base' if f.calc_center_median().z < 0.9 else 'post',
      [(0, 0.62, 0.62), (0.9, 0.26, 0.26), (3.35, 0.15, 0.15)])                                                # pedestal + shaft
stack(lp, pal, 'iron', [(3.35, 0.14, 0.14), (3.55, 0.42, 0.42)], rotz=45)                                      # capital
stack(lp, pal, lambda f: 'globe_lo' if f.normal.z < 0 else 'globe',
      [(3.55, 0.40, 0.40), (3.84, 0.76, 0.76), (4.34, 0.30, 0.30)], rotz=45)                                   # acorn globe
stack(lp, pal, 'iron', [(4.34, 0.32, 0.32)], rotz=45, apex=(4.52, 0, 0))                                       # cap
out('lamp', pal)

# ================================================================ bench (budget 40)
reset()
pal = Palette('bench')
W = (0.50, 0.30, 0.14)


def slats(x, y):
    if y % 4 == 3:
        return (0.10, 0.07, 0.05)
    k = 0.85 + 0.15 * ((y % 4) / 2) + 0.05 * ((x * 7 + y * 3) % 3 - 1)
    return tuple(min(1, v * k) for v in W)


pal.pattern('slats', slats)
pal.color('wood_end', (0.36, 0.21, 0.10), noise=0.1)
pal.color('iron', (0.09, 0.10, 0.10), noise=0.12)
b = Part('Bench', (0, 0, 0))
wood = lambda f: 'wood_end' if abs(f.normal.x) > 0.7 else 'slats'
stack(b, pal, wood, [(0.38, 1.8, 0.50, (0, -0.02)), (0.46, 1.8, 0.50, (0, -0.02))], top=True)                  # seat
stack(b, pal, wood, [(0.46, 1.8, 0.09, (0, 0.20)), (0.92, 1.8, 0.09, (0, 0.30))], top=True)                    # raked back
for sx in (-1, 1):
    stack(b, pal, 'iron', [(0, 0.09, 0.62, (sx * 0.72, 0.03)), (0.44, 0.09, 0.42, (sx * 0.72, 0.0))])           # cast-iron end frames
out('bench', pal)

# ================================================================ barrier (budget 40)
reset()
pal = Palette('barrier')
C = (0.66, 0.65, 0.61)


def concrete(x, y):
    k = 0.72 + 0.28 * min(1, y / 6) + 0.04 * ((x * 5 + y * 11) % 5 - 2) / 2
    if y == 6:
        k *= 0.86
    if x in (0, 15):
        k *= 0.8
    return tuple(min(1, v * k) for v in C)


def fence(x, y):
    if y >= 14 or y <= 0 or x in (0, 15):
        return (0.07, 0.08, 0.09)
    if x % 2 == 0 or y == 7:
        return (0.10, 0.11, 0.12)
    return (0.34, 0.39, 0.44)


pal.pattern('concrete', concrete)
pal.color('concrete_end', (0.56, 0.55, 0.52), noise=0.08, grime=0.3)
pal.pattern('fence', fence)
pal.color('steel', (0.07, 0.08, 0.09), noise=0.1)
br = Part('Barrier', (0, 0, 0))
PR = [(-0.30, 0), (-0.13, 0.30), (-0.09, 0.85), (0.09, 0.85), (0.13, 0.30), (0.30, 0)]
verts = [(-1.5, y, z) for y, z in PR] + [(1.5, y, z) for y, z in PR]
faces = [(i, i + 1, i + 7, i + 6) for i in range(5)] + [tuple(range(5, -1, -1)), tuple(range(6, 12))]
poly(br, pal, lambda f: 'concrete_end' if abs(f.normal.x) > 0.7 else 'concrete', verts, faces)
Z0, Z1, T = 0.85, 2.2, 0.03
poly(br, pal, 'fence',                                                                                         # mesh panel: front, back
     [(-1.42, -T, Z0), (1.42, -T, Z0), (1.42, -T, Z1), (-1.42, -T, Z1), (-1.42, T, Z1), (1.42, T, Z1), (1.42, T, Z0), (-1.42, T, Z0)],
     [(0, 1, 2, 3), (4, 5, 6, 7)])
poly(br, pal, 'steel', [(-1.48, -0.06, Z1), (1.48, -0.06, Z1), (1.48, 0.06, Z1), (-1.48, 0.06, Z1)], [(0, 1, 2, 3)])   # top rail closes panel and posts
for sx in (-1, 1):                                                                                             # end posts: front, outer, back
    xi, xo, h = sx * 1.38, sx * 1.48, 0.06
    poly(br, pal, 'steel', [(xi, -h, Z0), (xo, -h, Z0), (xo, h, Z0), (xi, h, Z0), (xi, -h, 2.2), (xo, -h, 2.2), (xo, h, 2.2), (xi, h, 2.2)],
         [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6)])
out('barrier', pal)

# ================================================================ monument (budget 24)
reset()
pal = Palette('monument')


def stone(rgb, seed):
    rng = np.random.default_rng(seed)
    n = rng.normal(1, 0.02, (16, 16))

    def fn(x, y):
        k = n[y, x] * (0.96 if y % 4 == 0 else 1.0)
        return tuple(min(1, v * k) for v in rgb)
    return fn


pal.pattern('lower', stone((0.87, 0.85, 0.79), 11))
pal.pattern('upper', stone((0.81, 0.79, 0.74), 12))
pal.color('cap', (0.84, 0.83, 0.79), noise=0.02)
m = Part('Monument', (0, 0, 0))
W46 = 17 - (17 - 10.5) * 46 / 152
stack(m, pal, lambda f: (lambda z: 'lower' if z < 46 else ('upper' if z < 152 else 'cap'))(f.calc_center_median().z),
      [(0, 17, 17), (46, W46, W46), (152, 10.5, 10.5)], apex=(169, 0, 0))
out('monument', pal, scale_figure=False)

# ================================================================ flagpole (budget 40)
reset()
pal = Palette('flagpole')
RED, WHT, BLU = (0.78, 0.10, 0.14), (0.95, 0.95, 0.93), (0.10, 0.16, 0.48)


def flag(canton):
    def fn(x, y):
        if canton and x <= 11 and y >= 7:
            return WHT if (x % 2 == 1 and y % 2 == 0 and 0 < x < 11 and 8 <= y < 15) else BLU
        return RED if (y * 7 // 16) % 2 == 0 else WHT
    return fn


pal.pattern('flag_hoist', flag(True))
pal.pattern('flag_fly', flag(False))
pal.color('pole', (0.80, 0.81, 0.83), noise=0.04)
pal.color('gold', (0.92, 0.72, 0.18), noise=0.05)
pal.color('plinth', (0.62, 0.61, 0.57), noise=0.08, grime=0.35)
fp = Part('Flagpole', (0, 0, 0))
stack(fp, pal, 'plinth', [(0, 0.9, 0.9), (0.6, 0.2, 0.2)])
stack(fp, pal, 'pole', [(0.6, 0.2, 0.2), (11.75, 0.11, 0.11)])
poly(fp, pal, 'gold', [(0.16, 0, 11.85), (-0.08, 0.14, 11.85), (-0.08, -0.14, 11.85), (0, 0, 12.0), (0, 0, 11.7)],
     [(0, 1, 3), (1, 2, 3), (2, 0, 3), (1, 0, 4), (2, 1, 4), (0, 2, 4)])                                          # finial
ZT, ZB = 11.6, 9.75
fl = Part('Flag', (0, 0, (ZT + ZB) / 2), parent=fp)
XS, YS, TH = [0.06, 1.05, 2.0, 2.95], [0.0, 0.34, -0.22, 0.26], 0.015
DROOP = [0, -0.06, -0.14, -0.2]
verts = []
for x, y, d in zip(XS, YS, DROOP):
    verts += [(x, y - TH, ZB + d), (x, y - TH, ZT + d), (x, y + TH, ZT + d), (x, y + TH, ZB + d)]
faces = []
for i in range(3):
    a, c = 4 * i, 4 * i + 4
    faces += [(a, c, c + 1, a + 1), (c + 3, a + 3, a + 2, c + 2)]
faces += [(3, 0, 1, 2), (12, 15, 14, 13)]


def flag_col(f):
    return 'flag_hoist' if f.calc_center_median().x < 1.0 and abs(f.normal.x) < 0.9 else 'flag_fly'


poly(fl, pal, flag_col, verts, faces)
out('flagpole', pal)
