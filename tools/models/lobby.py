"""Lobby set: lobby_mound.glb (lobbyist nest, parts Mound / Sign / Door) and briefcase.glb (hand prop).
World frame: metres, Z up, front faces -Y, ground z=0, centred on x=0."""
import sys, os, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public/models/world')
PRE = os.path.join(ROOT, 'previews')


def lump(part, pal, color, cx, cy, rings, apex, segs, seed, jit=0.12, phase=0.5):
    """Open-bottomed lumpy cone: rings = [(z, radius)], apex = (dx, dy, z)."""
    rnd = random.Random(seed)
    verts, faces = [], []
    for z, r in rings:
        for i in range(segs):
            a = math.radians((i + phase) * 360 / segs - 90)
            rr = r * (1 + rnd.uniform(-jit, jit))
            verts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr, z + (rnd.uniform(-0.15, 0.15) if z > 0 else 0)))
    for k in range(len(rings) - 1):
        for i in range(segs):
            a, b = k * segs + i, k * segs + (i + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    top = len(verts)
    verts.append((cx + apex[0], cy + apex[1], apex[2]))
    base = (len(rings) - 1) * segs
    for i in range(segs):
        faces.append((base + i, base + (i + 1) % segs, top))
    return poly(part, pal, color, verts, faces)


# =============================================================== (1) lobby mound
reset()
pal = Palette('lobby_mound')
pal.color('dirt_a', (0.36, 0.23, 0.12), noise=0.16, grime=0.5)
pal.color('dirt_b', (0.47, 0.31, 0.16), noise=0.16, grime=0.35)
pal.color('dirt_c', (0.58, 0.40, 0.22), noise=0.14, grime=0.2)
pal.color('dirt_d', (0.29, 0.18, 0.10), noise=0.18, grime=0.3)
pal.color('dark', (0.04, 0.03, 0.04), noise=0.1)
pal.color('brass', (0.80, 0.62, 0.18), noise=0.08)
pal.color('gold', (0.98, 0.80, 0.12), noise=0.06)
pal.color('gold_d', (0.78, 0.56, 0.06), noise=0.08)
pal.color('white', (0.96, 0.96, 0.94), noise=0.0)
pal.color('frame', (0.10, 0.10, 0.12), noise=0.08)
pal.color('pole', (0.30, 0.31, 0.34), noise=0.08, grime=0.3)
pal.color('sack', (0.78, 0.70, 0.50), noise=0.08, grime=0.3)
pal.color('tie', (0.45, 0.25, 0.10), noise=0.1)


def _win(x, y):  # dirt with a small lit office window
    if 5 <= x <= 10 and 5 <= y <= 11:
        if x in (5, 10) or y in (5, 11):
            return (0.22, 0.14, 0.08)
        if x == 7 or y == 8:
            return (0.35, 0.28, 0.12)
        return (1.0, 0.86, 0.40)
    k = 0.9 + 0.1 * ((x * 7 + y * 13) % 5) / 4
    return (0.47 * k, 0.31 * k, 0.16 * k)


def _door(x, y):  # glass door leaf: brass frame, blue glass, push bar
    if x in (0, 15) or y in (0, 1, 14, 15):
        return (0.80, 0.62, 0.18)
    if x in (1, 14):
        return (0.50, 0.38, 0.10)
    if y in (7, 8) and 3 <= x <= 12:
        return (0.85, 0.70, 0.25)
    k = 0.75 + 0.25 * ((x + y) % 16) / 15
    if (x - y) in (2, 3, -6):
        return (0.85, 0.95, 1.0)
    return (0.35 * k, 0.62 * k, 0.80 * k)


def _plaque(x, y):  # brass plaque with engraved lines (no real text)
    if x in (0, 15) or y in (0, 15):
        return (0.45, 0.32, 0.06)
    if y in (4, 7, 10) and 3 <= x <= (12 if y != 4 else 9):
        return (0.30, 0.20, 0.04)
    if y == 12 and 4 <= x <= 11:
        return (0.30, 0.20, 0.04)
    return (0.90, 0.72, 0.22)


def _dollar(x, y):  # sack cloth with a green dollar sign
    S = ["................",
         "................",
         ".......##.......",
         ".....######.....",
         "....##.##.##....",
         "....##.##.......",
         ".....#####......",
         "......#####.....",
         ".......##.##....",
         "....##.##.##....",
         ".....######.....",
         ".......##.......",
         "................",
         "................",
         "................",
         "................"]
    if S[15 - y][x] == '#':
        return (0.10, 0.42, 0.14)
    k = 1.0 - 0.02 * (15 - y)
    return (0.78 * k, 0.70 * k, 0.50 * k)


def _coin(x, y):
    d = math.hypot(x - 7.5, y - 7.5)
    if d > 7.2:
        return (0.70, 0.50, 0.05)
    if 4.2 < d < 5.6:
        return (0.80, 0.58, 0.06)
    if abs(x - 7.5) < 1 and abs(y - 7.5) < 3:
        return (0.75, 0.52, 0.05)
    return (1.0, 0.84, 0.18)


def _paper(x, y):
    if x in (0, 15) or y in (0, 15):
        return (0.78, 0.78, 0.74)
    if y in (3, 5, 7, 9, 12) and 3 <= x <= (12 if y != 9 else 8):
        return (0.35, 0.36, 0.42)
    return (0.97, 0.97, 0.93)


pal.pattern('win', _win)
pal.pattern('door', _door)
pal.pattern('plaque', _plaque)
pal.pattern('dollar', _dollar)
pal.pattern('coin', _coin)
pal.pattern('paper', _paper)
pal.stripes('strata', (0.40, 0.26, 0.13), (0.30, 0.19, 0.10), width=3, diagonal=False, noise=0.14)

mound = Part('Mound', (0, 0, 0))
Part('Sign', (0, 0.5, 7.2), parent=mound)
Part('Door', (0, -4.2, 0), parent=mound)

_rc = random.Random(3)


def mound_col(f):
    c = f.calc_center_median()
    r = _rc.random()
    if c.z < 1.0:
        return 'strata' if r < 0.5 else 'dirt_a'
    if c.z < 2.6:
        if r < 0.4 and c.y < 1.0 and abs(c.x) > 1.6:
            return 'win'
        return 'dirt_b' if r < 0.7 else 'dirt_a'
    if c.z < 4.0:
        if r < 0.2 and c.y < 0:
            return 'win'
        return 'dirt_b' if r < 0.5 else 'dirt_c'
    return 'dirt_c' if r < 0.7 else 'dirt_b'


# main mound, 9 m across, 5 m tall
# (centred a little behind the origin so the doorway face can sit at the Door marker, y = -4.2)
lump(mound, pal, mound_col, 0, 0.6, [(0, 4.25), (1.4, 3.9), (2.8, 2.9), (4.0, 1.6)], (0.2, -1.1, 5.0), 10, seed=11, jit=0.10)
# satellite spires and bulges (termite-mound silhouette)
lump(mound, pal, mound_col, -2.7, 1.5, [(0, 1.8), (1.6, 1.4)], (0.2, 0.0, 3.6), 6, seed=5)
lump(mound, pal, mound_col, 2.8, 0.6, [(0, 1.7), (1.3, 1.3)], (-0.2, 0.1, 3.0), 6, seed=8)
lump(mound, pal, mound_col, 1.0, 3.6, [(0, 1.8), (1.8, 1.2)], (0.0, -0.2, 3.9), 6, seed=2)
lump(mound, pal, mound_col, -1.9, -1.6, [(2.0, 1.3)], (0.3, 0.2, 4.3), 5, seed=4)

# entrance: dirt porch with a dark arched mouth
ARCH = [(-1.8, 0), (1.8, 0), (1.8, 1.9), (1.15, 2.8), (0, 3.1), (-1.15, 2.8), (-1.8, 1.9)]
profile(mound, pal, 'dirt_d', ARCH, 1.9, loc=(0, -2.8, 0), plane='XZ', side_color='dirt_a')      # front face at y = -3.75
MOUTH = [(-1.05, 0), (1.05, 0), (1.05, 1.75), (0.65, 2.4), (0, 2.62), (-0.65, 2.4), (-1.05, 1.75)]
profile(mound, pal, 'dark', MOUTH, 0.1, loc=(0, -3.78, 0), plane='XZ')
# revolving door drum: glass leaves in a brass-capped cylinder; its front reaches the Door marker (y = -4.2)
cyl(mound, pal, 'door', 0.68, 2.05, (0, -3.54, 1.025), segs=6, cap_color='brass')
box(mound, pal, 'brass', (1.7, 0.4, 0.16), (0, -3.98, 2.13))                       # brass canopy bar over the door
# brass plaque flat on the porch front, beside the door
box(mound, pal, lambda f: 'plaque' if f.normal.y < -0.7 else 'brass', (0.56, 0.08, 0.7), (1.42, -3.77, 1.5))

# ---- loot spilling around the entrance


def bag(cx, cy, s, tilt=0):
    v, fs = [], []
    rings = [(0.0, 0.30), (0.28, 0.42), (0.62, 0.13), (0.78, 0.22)]
    for z, r in rings:
        for i in range(4):
            a = math.radians(i * 90 + 45)
            v.append((math.cos(a) * r * s, math.sin(a) * r * s, z * s))
    for k in range(3):
        for i in range(4):
            a, b = k * 4 + i, k * 4 + (i + 1) % 4
            fs.append((a, b, b + 4, a + 4))
    fs.append((12, 13, 14, 15))

    def col(f):
        c = f.calc_center_median()
        if c.z > 0.6 * s:
            return 'tie'
        return 'dollar' if c.z > 0.2 * s else 'sack'
    poly(mound, pal, col, v, fs, loc=(cx, cy, 0), rot=(tilt, 0, 0))


bag(-2.2, -4.3, 1.25)
bag(-3.0, -3.7, 1.0)
bag(2.4, -4.4, 1.15)


def coin(cx, cy, z, r=0.26, h=0.07, rot=(0, 0, 0)):
    cyl(mound, pal, 'gold_d', r, h, (cx, cy, z), segs=5, cap_color='coin', rot=rot)


coin(-1.3, -4.8, 0.035)
coin(-0.9, -5.2, 0.035)
coin(1.4, -4.9, 0.035)
coin(3.2, -3.9, 0.26, rot=(75, 0, 30))                                                # coin standing on edge
cyl(mound, pal, 'gold_d', 0.26, 0.42, (1.95, -5.1, 0.21), segs=5, cap_color='coin')  # coin stack
cyl(mound, pal, 'gold_d', 0.26, 0.24, (-3.3, -4.6, 0.12), segs=5, cap_color='coin')   # short stack


def paper(cx, cy, ang, z=0.03, s=1.0):
    w, h = 0.36 * s, 0.5 * s
    ob = poly(mound, pal, 'paper', [(-w, -h, 0), (w, -h, 0), (w, h, 0), (-w, h, 0)], [(0, 1, 2, 3)], loc=(cx, cy, z), rot=(0, 0, ang))
    if ob.data.polygons[0].normal.z < 0:   # make sure the sheet faces up even if the engine culls back faces
        ob.data.flip_normals()


paper(0.6, -5.3, 20)
paper(-0.5, -5.6, -35)
paper(2.9, -5.1, 60)
paper(-2.2, -5.3, 10)
paper(1.3, -5.7, -10)
paper(-3.9, -3.7, 75)

# ---- billboard on a tall pole behind the peak (face left plain white for the game's text)
box(mound, pal, 'pole', (0.34, 0.3, 5.6), (0, 0.86, 4.6))
box(mound, pal, 'frame', (4.72, 0.18, 1.92), (0, 0.61, 7.2))                         # dark frame, y 0.52..0.70
box(mound, pal, 'white', (4.4, 0.14, 1.6), (0, 0.57, 7.2))                           # white face at y = 0.50

finish_and_export(pal, None, os.path.join(OUT, 'lobby_mound.glb'), os.path.join(PRE, 'lobby_mound.png'))

# =============================================================== (2) briefcase
reset()
pal = Palette('briefcase')
L = (0.56, 0.32, 0.14)


def _case(x, y):  # big face: leather, lid seam, two brass clasps, brass corners
    if (x < 2 or x > 13) and (y < 2 or y > 13):
        return (0.85, 0.66, 0.20)
    if x in (0, 15) or y in (0, 15):
        return (0.24, 0.13, 0.06)
    if y == 11:
        return (0.20, 0.11, 0.05)
    if x in (3, 4, 11, 12) and 10 <= y <= 13:
        return (0.92, 0.74, 0.24) if y != 10 else (0.60, 0.44, 0.10)
    if x in (7, 8) and y in (12, 13):
        return (0.70, 0.52, 0.14)
    k = 0.88 + 0.12 * ((x * 5 + y * 3) % 7) / 6
    return (L[0] * k, L[1] * k, L[2] * k)


def _edge(x, y):  # narrow faces: darker leather with a centre seam
    if 7 <= x <= 8 or 7 <= y <= 8:
        return (0.22, 0.12, 0.05)
    return (0.44, 0.25, 0.11)


pal.pattern('case', _case)
pal.pattern('edge', _edge)
pal.color('handle', (0.16, 0.09, 0.05), noise=0.1)
pal.color('brass', (0.85, 0.66, 0.20), noise=0.06)

bc = Part('Briefcase', (0, 0, 0))
box(bc, pal, lambda f: 'case' if abs(f.normal.x) > 0.7 else 'edge', (0.10, 0.45, 0.32), (0, 0, -0.215))
H = [(-0.085, -0.055), (-0.085, 0.018), (0.085, 0.018), (0.085, -0.055),
     (0.055, -0.055), (0.055, -0.014), (-0.055, -0.014), (-0.055, -0.055)]
profile(bc, pal, 'handle', H, 0.03, plane='YZ')
finish_and_export(pal, None, os.path.join(OUT, 'briefcase.glb'), os.path.join(PRE, 'briefcase.png'), scale_figure=False)
