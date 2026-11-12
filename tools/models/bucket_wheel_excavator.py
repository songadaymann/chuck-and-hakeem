"""Bucket-wheel excavator (final upgrade). Front is -Y, ground z=0, slew axis at x=0,y=0.
Parts: Tracks (root) > Upper > WheelBoom > BucketWheel, Seat ; Upper > CounterBoom, DischargeBoom."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('bucket_wheel_excavator')

YEL = (0.93, 0.68, 0.08)
DARK = (0.11, 0.12, 0.14)
STEEL = (0.30, 0.31, 0.34)
WHITE = (0.85, 0.85, 0.80)
RUST = (0.45, 0.24, 0.12)

pal.color('yellow', YEL, grime=0.35)
pal.color('yellow_clean', YEL, noise=0.04)
pal.color('steel', STEEL, noise=0.1, grime=0.4)
pal.color('dark', DARK, noise=0.1)
pal.color('cable', (0.16, 0.16, 0.18), noise=0.05)
pal.color('rust', RUST, noise=0.15, grime=0.4)
pal.color('concrete', (0.55, 0.54, 0.50), noise=0.1, grime=0.45)
pal.color('roof', (0.42, 0.44, 0.46), noise=0.08)
pal.color('seat', (0.55, 0.12, 0.08), noise=0.06)
pal.color('rubber', (0.07, 0.07, 0.08), noise=0.15)
pal.stripes('tread', (0.10, 0.10, 0.11), (0.27, 0.25, 0.23), width=2, diagonal=False)
pal.stripes('hazard', (0.95, 0.75, 0.05), (0.08, 0.08, 0.08), width=4)
pal.stripes('stairs', (0.50, 0.52, 0.55), (0.14, 0.14, 0.16), width=2, diagonal=False)
pal.stripes('ringteeth', (0.20, 0.21, 0.23), (0.40, 0.41, 0.44), width=2, diagonal=True)


def _truss(col):
    def fn(x, y):
        if y <= 1 or y >= 14 or x == 0 or x == 15:
            return col
        if abs(x - y) <= 1 or abs(x - (15 - y)) <= 1:
            return col
        return DARK
    return fn


pal.pattern('truss', _truss(YEL))
pal.pattern('truss_w', _truss(WHITE))


def _belt(x, y):
    if x <= 2 or x >= 13:
        return YEL
    if y % 4 == 0:
        return (0.22, 0.22, 0.24)
    return (0.08, 0.08, 0.09)


pal.pattern('belt', _belt)


def _beltflat(x, y):
    return (0.24, 0.24, 0.26) if (x + y) % 5 == 0 else (0.09, 0.09, 0.10)


pal.pattern('beltflat', _beltflat)


def _bogies(x, y):
    if y >= 13 or y <= 1:
        return (0.10, 0.10, 0.11)
    cx = (x % 5) - 2
    if cx * cx + (y - 5) * (y - 5) <= 5:
        return (0.42, 0.42, 0.45)
    if 9 <= y <= 11:
        return YEL
    return (0.17, 0.17, 0.19)


pal.pattern('bogies', _bogies)


def _house(x, y):
    if 9 <= y <= 12 and x % 4 in (1, 2):
        return (0.08, 0.12, 0.18)
    if 2 <= y <= 6 and x % 2 == 0 and x >= 8:
        return (0.15, 0.15, 0.17)
    if y <= 7 and 2 <= x <= 5:
        return (0.25, 0.26, 0.29)
    if y >= 15:
        return (0.3, 0.3, 0.32)
    k = 0.75 + 0.25 * min(1, y / 6)
    return (YEL[0] * k, YEL[1] * k, YEL[2] * k)


pal.pattern('house', _house)


def _rail(x, y):
    if y >= 14 or y in (7, 8) or x % 5 == 0:
        return YEL
    if y <= 1:
        return STEEL
    return DARK


pal.pattern('rail', _rail)


def _deck(x, y):
    if y >= 12:
        return (0.9, 0.9, 0.85) if x % 4 < 2 else (0.75, 0.1, 0.08)
    if y <= 2:
        return (0.2, 0.2, 0.22)
    return YEL if (x % 8) else (0.7, 0.5, 0.06)


pal.pattern('deck', _deck)


def _spokes(x, y):
    dx, dy = x - 7.5, y - 7.5
    r = math.hypot(dx, dy)
    if r < 2.2:
        return STEEL
    if r > 6.2:
        return YEL
    ax, ay = abs(dx), abs(dy)
    if ax < 1 or ay < 1 or abs(ax - ay) < 0.8:
        return YEL
    return DARK


pal.pattern('spokes', _spokes)


def _bucket(x, y):
    if y >= 13:
        return (0.75, 0.76, 0.78) if x % 4 < 2 else (0.2, 0.2, 0.22)
    if (x * 7 + y * 3) % 11 == 0:
        return RUST
    return (0.36, 0.33, 0.30)


pal.pattern('bucket', _bucket)


def _grate(x, y):
    return (0.3, 0.31, 0.33) if (x % 4 == 0 or y % 4 == 0) else (0.16, 0.16, 0.18)


pal.pattern('grate', _grate)


# ---------------------------------------------------------------- helpers
def truss(part, a, b, w0, h0, w1=None, h1=None, n=1, side='truss', top=None, bot=None):
    """Segmented box beam from a to b. w is horizontal width, h is the 'up' depth. One swatch per segment face."""
    a, b = Vector(a), Vector(b)
    w1 = w0 if w1 is None else w1
    h1 = h0 if h1 is None else h1
    d = (b - a).normalized()
    s = d.cross(Vector((0, 0, 1)))
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    u = s.cross(d).normalized()
    verts = []
    for i in range(n + 1):
        t = i / n
        c = a.lerp(b, t)
        w = (w0 + (w1 - w0) * t) / 2
        h = (h0 + (h1 - h0) * t) / 2
        verts += [c - s * w - u * h, c + s * w - u * h, c + s * w + u * h, c - s * w + u * h]
    faces = [(0, 1, 2, 3), tuple(n * 4 + k for k in range(4))]
    for i in range(n):
        for k in range(4):
            faces.append((i * 4 + k, i * 4 + (k + 1) % 4, (i + 1) * 4 + (k + 1) % 4, (i + 1) * 4 + k))

    def col(f):
        dd = f.normal.dot(u)
        if top and dd > 0.7:
            return top
        if bot and dd < -0.7:
            return bot
        return side
    return poly(part, pal, col, [tuple(v) for v in verts], faces)


def cable(part, a, b, t=0.35):
    return truss(part, a, b, t, t, side='cable')


def zcol(top, side):
    return lambda f: top if f.normal.z > 0.7 else side


# ---------------------------------------------------------------- Tracks (root)
tracks = Part('Tracks', (0, 0, 0))


def crawler(x, yc, L=12.0, W=2.2, H=3.0):
    h = L / 2
    pts = [(-h + 1.3, 0), (h - 1.3, 0), (h, 1.0), (h, 2.2), (h - 0.8, H), (-h + 0.8, H), (-h, 2.2), (-h, 1.0)]
    profile(tracks, pal, 'tread', pts, W, loc=(x, yc, 0), side_color='rubber')
    box(tracks, pal, 'bogies', (W + 0.3, L - 2.4, 2.2), (x, yc, 1.5))


for x in (-8.8, -6.2, 6.2, 8.8):
    crawler(x, -3.0)
for x in (-1.4, 1.4):
    crawler(x, 12.0)
# saddles over each pair
box(tracks, pal, 'steel', (5.2, 4.0, 0.9), (-7.5, -3.0, 3.15))
box(tracks, pal, 'steel', (5.2, 4.0, 0.9), (7.5, -3.0, 3.15))
box(tracks, pal, 'steel', (5.2, 4.0, 0.9), (0, 12.0, 3.15))
# undercarriage frame
box(tracks, pal, zcol('roof', 'yellow'), (15.0, 14.0, 1.8), (0, 1.0, 4.3))
box(tracks, pal, zcol('roof', 'yellow'), (6.4, 7.0, 1.8), (0, 11.5, 4.3))
# slew ring
cyl(tracks, pal, 'ringteeth', 5.6, 1.3, (0, 0, 5.85), segs=10, cap_color='steel')
# access stairs up to the frame
truss(tracks, (6.6, 15.0, 0.25), (6.6, 7.8, 5.0), 1.5, 0.5, n=2, side='yellow_clean', top='stairs', bot='steel')

# ---------------------------------------------------------------- Upper
upper = Part('Upper', (0, 0, 6.5), tracks)
box(upper, pal, zcol('roof', 'deck'), (13.0, 18.0, 2.0), (0, 1.0, 7.5))
# machinery houses either side of the tower
box(upper, pal, zcol('roof', 'house'), (3.5, 11.0, 4.0), (4.75, 2.5, 10.5))
box(upper, pal, zcol('roof', 'house'), (3.5, 6.0, 4.0), (-4.75, 0.0, 10.5))
box(upper, pal, 'steel', (1.2, 1.2, 1.6), (4.75, 5.5, 13.3))       # exhaust stack
# deck railings
box(upper, pal, 'rail', (0.15, 18.0, 1.2), (6.42, 1.0, 9.1))
box(upper, pal, 'rail', (0.15, 18.0, 1.2), (-6.42, 1.0, 9.1))
# A-frame tower
TOP = 31.0
truss(upper, (0, -4.0, 8.5), (0, -1.0, TOP), 4.0, 2.6, 2.6, 1.8, n=6, side='truss_w')
truss(upper, (0, 7.0, 8.5), (0, 1.0, TOP), 4.0, 2.6, 2.6, 1.8, n=6, side='truss_w')
truss(upper, (0, -2.6, 19.0), (0, 4.2, 19.0), 2.6, 1.6, n=2, side='truss_w')
box(upper, pal, zcol('roof', 'yellow_clean'), (4.0, 4.4, 1.5), (0, 0, 31.5))    # sheave house
box(upper, pal, 'hazard', (0.5, 0.5, 1.0), (0, 0, 32.7))                         # mast light
# hinge cheeks for the two booms
for sx in (-1, 1):
    box(upper, pal, 'steel', (0.6, 3.6, 4.6), (sx * 2.95, -6.2, 10.8))
    box(upper, pal, 'steel', (0.6, 3.6, 4.6), (sx * 2.75, 8.6, 10.8))
# discharge boom turret
cyl(upper, pal, 'steel', 1.4, 1.0, (-4.5, 5.5, 9.0), segs=8, cap_color='dark')

# ---------------------------------------------------------------- WheelBoom
HINGE = Vector((0, -6.0, 11.0))
TIP = Vector((0, -25.6, 7.6))
HUB = Vector((0, -33.0, 6.75))
wboom = Part('WheelBoom', HINGE, upper)
truss(wboom, HINGE, TIP, 5.0, 3.5, 4.2, 2.6, n=6, side='truss', top='belt')
cyl(wboom, pal, 'dark', 0.7, 6.6, HINGE, axis='X', segs=6)                      # hinge pin
for sx in (-1, 1):
    truss(wboom, (sx * 1.78, -24.6, 7.7), (sx * 1.78, -34.0, 6.55), 0.6, 2.0, 0.6, 1.4, n=2, side='yellow', top='steel')
box(wboom, pal, 'steel', (1.0, 2.4, 2.4), (-2.55, -33.0, 6.75))                   # wheel drive gearbox
box(wboom, pal, 'rust', (2.6, 1.6, 1.4), (0, -25.0, 9.4), taper=(0.7, 0.6))       # transfer chute on top
# (the luffing stays from the tower top to this boom are telescoping ram() pairs, see "Stays" below)

# operator cabin hanging on the +X side of the boom, near the wheel
SEAT = Vector((3.6, -21.5, 7.0))
seat = Part('Seat', SEAT, wboom)
cx, cy, cz = SEAT
box(wboom, pal, zcol('grate', 'yellow_clean'), (2.5, 2.7, 0.15), (cx, cy - 0.2, cz - 0.075))
for dy in (-1.3, 0.9):
    box(wboom, pal, 'steel', (3.1, 0.3, 0.35), (cx - 0.35, cy + dy, cz - 0.32))
for dx in (-1.15, 1.15):
    for dy in (-1.45, 1.05):
        box(wboom, pal, 'yellow_clean', (0.16, 0.16, 2.2), (cx + dx, cy + dy, cz + 1.1))
box(wboom, pal, zcol('roof', 'hazard'), (3.2, 2.9, 0.25), (cx - 0.25, cy - 0.2, cz + 2.32))
box(wboom, pal, 'steel', (0.5, 0.45, 0.33), (cx, cy + 0.05, cz + 0.165))
box(wboom, pal, 'seat', (0.6, 0.55, 0.12), (cx, cy + 0.02, cz + 0.39))
box(wboom, pal, 'seat', (0.6, 0.12, 0.75), (cx, cy + 0.37, cz + 0.825))
box(wboom, pal, 'dark', (0.9, 0.3, 0.8), (cx, cy - 1.0, cz + 0.4))               # console
box(wboom, pal, 'rail', (0.08, 2.5, 0.5), (cx + 1.15, cy - 0.2, cz + 0.25))       # outboard guard rail

# ---------------------------------------------------------------- BucketWheel
wheel = Part('BucketWheel', HUB, wboom)
cyl(wheel, pal, 'yellow', 5.3, 1.2, HUB, axis='X', segs=12, cap_color='spokes')
cyl(wheel, pal, 'dark', 0.55, 4.2, HUB, axis='X', segs=6)
NB = 12
for k in range(NB):
    th = 2 * math.pi * k / NB
    rv = Vector((0, -math.sin(th), math.cos(th)))
    tv = Vector((0, math.cos(th), math.sin(th)))

    def bcol(f, rv=rv, tv=tv):
        if f.normal.dot(tv) > 0.6:
            return 'dark'
        if f.normal.dot(rv) > 0.6:
            return 'steel'
        return 'bucket'
    box(wheel, pal, bcol, (2.4, 2.0, 1.6), HUB + rv * 5.95, rot=(math.degrees(th), 0, 0),
        taper=(0.85, 0.8), shear=(0, 0.5))

# ---------------------------------------------------------------- CounterBoom
CH = Vector((0, 8.5, 11.2))
cboom = Part('CounterBoom', CH, upper)
truss(cboom, CH, (0, 25.0, 12.5), 4.6, 3.0, 4.6, 3.0, n=5, side='truss', top='grate')
cyl(cboom, pal, 'dark', 0.7, 6.2, CH, axis='X', segs=6)
box(cboom, pal, zcol('roof', 'concrete'), (7.4, 7.0, 5.2), (0, 28.0, 11.4))
box(cboom, pal, 'hazard', (7.6, 7.2, 0.9), (0, 28.0, 9.6))
box(cboom, pal, zcol('roof', 'house'), (3.0, 4.0, 2.4), (0, 20.0, 14.75))          # winch house on the boom
truss(cboom, (0, 11.0, 12.8), (0, 15.5, 25.0), 3.2, 1.8, 2.2, 1.4, n=4, side='truss_w')   # rear mast
box(cboom, pal, 'steel', (2.8, 1.8, 1.0), (0, 15.6, 25.3))
for sx in (-1, 1):
    cable(cboom, (sx * 1.2, 1.4, 30.9), (sx * 1.0, 15.6, 25.3))
    cable(cboom, (sx * 1.0, 15.6, 25.3), (sx * 2.6, 26.5, 14.0))

# ---------------------------------------------------------------- DischargeBoom
DP = Vector((-4.5, 5.5, 9.5))
DE = Vector((-12.0, 27.5, 13.5))
dboom = Part('DischargeBoom', DP, upper)
truss(dboom, DP + Vector((0, 0, 0.75)), DE, 2.0, 1.5, 1.6, 1.2, n=9, side='truss', top='beltflat')
box(dboom, pal, 'steel', (2.4, 2.4, 0.5), DP + Vector((0, 0, 0.25)))
dd = (DE - DP).normalized()
box(dboom, pal, 'rust', (1.8, 1.8, 2.6), DE + dd * 0.5 + Vector((0, 0, -0.9)), taper=(0.6, 0.6))
for t in (0.45, 0.85):
    p = (DP + Vector((0, 0, 0.75))).lerp(DE, t) + Vector((0, 0, 0.6))
    cable(dboom, (-1.4, 3.4, 22.0), p, 0.3)

# ---------------------------------------------------------------- Stays (telescoping, stay attached in clips)
# Luffing cables from the sheave house on the tower (Upper) down to the WheelBoom. Both halves are cable
# coloured; 4 segments at radius 0.24 gives the same 0.35 m square section as cable().
# Stay length runs 0.95 .. 1.01 of rest over the dig clip (boom luffed up 8 deg .. down 2 deg). The barrel
# fraction sits just under that minimum so the thinner lower half only shows for the last ~7 percent.
STAY_BARREL = 0.93
for sx, tag in ((-1, 'R'), (1, 'L')):
    ram(pal, 'StayTip_' + tag, upper, (sx * 1.3, -1.6, 30.9), wboom, (sx * 1.9, -24.2, 9.0), 'cable', 'cable',
        radius=0.24, segs=4, barrel=STAY_BARREL)
    ram(pal, 'StayMid_' + tag, upper, (sx * 1.3, -1.6, 30.9), wboom, (sx * 2.1, -15.0, 10.8), 'cable', 'cable',
        radius=0.24, segs=4, barrel=STAY_BARREL)

# ---------------------------------------------------------------- Clips
# The wheel turns so the bucket mouths (the dark faces) lead: up the front face, over the top toward the
# machine. 12 buckets, so any multiple of 30 degrees loops seamlessly. Flip SPIN to reverse it.
SPIN = -1
SLEW = 14      # degrees left / right
BITE = 2       # boom luffed down into the face (wheel rim about 1 m below grade)
LIFT = -8      # boom luffed up clear of the face (wheel about 3.7 m up)
# NOTE on order and loop points: the kit leaves every part at the last pose it evaluated ('dig' at t=1,
# because it is registered last), and that becomes the exported rest pose. So 'dig' must stay registered
# last and must start and end exactly on the rest pose (wheel on a whole number of turns).
# idle: only the wheel turns, slowly.
animate('idle', 4.0, {
    'BucketWheel': [(0.0, {'rot': (0, 0, 0)}), (1.0, {'rot': (SPIN * 180, 0, 0)})],
}, linear=('BucketWheel',))
# dig: plunge at centre, cut sweeping right, lift clear, swing across raised, plunge on the left,
# cut sweeping back to centre, ease up to grade.
animate('dig', 8.0, {
    'BucketWheel': [(0.0, {'rot': (0, 0, 0)}), (1.0, {'rot': (SPIN * 720, 0, 0)})],
    'Upper':       [(0.00, {'rot': (0, 0, 0)}), (0.07, {'rot': (0, 0, 0)}), (0.30, {'rot': (0, 0, SLEW)}),
                    (0.37, {'rot': (0, 0, SLEW)}), (0.60, {'rot': (0, 0, -SLEW)}), (0.67, {'rot': (0, 0, -SLEW)}),
                    (0.93, {'rot': (0, 0, 0)}), (1.00, {'rot': (0, 0, 0)})],
    'WheelBoom':   [(0.00, {'rot': (0, 0, 0)}), (0.07, {'rot': (BITE, 0, 0)}), (0.30, {'rot': (BITE, 0, 0)}),
                    (0.37, {'rot': (LIFT, 0, 0)}), (0.60, {'rot': (LIFT, 0, 0)}), (0.67, {'rot': (BITE, 0, 0)}),
                    (0.93, {'rot': (BITE, 0, 0)}), (1.00, {'rot': (0, 0, 0)})],
}, linear=('BucketWheel',))

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/bucket_wheel_excavator.glb'),
                  os.path.join(ROOT, 'previews/bucket_wheel_excavator.png'))
