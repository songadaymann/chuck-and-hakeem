"""Backhoe loader. Front is -Y, ground z=0. Loader bucket on the front, digging arm on the back, open cab.
Rear arm chain: Body > Swing (yaw at the swing post) > Boom > Stick > Bucket, with telescoping rams and a 'dig' clip."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('backhoe_loader')
Y, YD, ST, RB = (1.0, 0.76, 0.08), (0.80, 0.55, 0.06), (0.20, 0.21, 0.23), (0.07, 0.07, 0.08)
pal.color('yellow', Y, grime=0.15)
pal.color('yellow_dk', YD, grime=0.3)
pal.color('steel', ST, noise=0.12, grime=0.3)
pal.color('dirt_steel', (0.36, 0.30, 0.24), noise=0.18, grime=0.5)
pal.color('rust', (0.42, 0.22, 0.12), noise=0.2, grime=0.4)
pal.color('chrome', (0.75, 0.77, 0.80), noise=0.04)
pal.color('seat', (0.10, 0.10, 0.12), noise=0.15)
pal.color('floor', (0.16, 0.16, 0.17), noise=0.25)
pal.color('lamp', (1.0, 0.95, 0.7), noise=0.02)
pal.color('beacon', (1.0, 0.45, 0.05), noise=0.02)
pal.stripes('tread', RB, (0.17, 0.17, 0.18), width=2, diagonal=False)
pal.stripes('hazard', (0.95, 0.75, 0.05), (0.08, 0.08, 0.08), width=4)
pal.stripes('grille', (0.08, 0.08, 0.09), (0.32, 0.33, 0.35), width=2, diagonal=False)


def hub(x, y):
    d = math.hypot(x - 7.5, y - 7.5)
    if d < 1.6:
        return ST
    if d < 4.6:
        return (0.85, 0.60, 0.07) if (int(math.degrees(math.atan2(y - 7.5, x - 7.5)) + 360) // 45) % 2 else Y
    if d < 5.6:
        return (0.03, 0.03, 0.03)
    return RB if int(d) % 2 else (0.11, 0.11, 0.12)
pal.pattern('hub', hub)


def dash(x, y):
    if y > 9 and 2 <= x <= 13:
        return (0.05, 0.05, 0.06) if (x in (4, 5, 9, 10) and y in (11, 12)) is False else (0.8, 0.2, 0.1)
    return YD
pal.pattern('dash', dash)


def nose(x, y):
    if y >= 10 and (2 <= x <= 5 or 10 <= x <= 13) and y <= 13:
        return (1.0, 0.95, 0.7)
    if 1 <= x <= 14 and 1 <= y <= 8:
        return (0.08, 0.08, 0.09) if y % 2 else (0.32, 0.33, 0.35)
    return Y
pal.pattern('nose', nose)


def strip(part, color, pts, thick, width, x=0.0, side_color=None):
    """Extruded beam in the YZ plane following a polyline of (y, z) points with a thickness at each point."""
    n = len(pts)
    left, right = [], []
    for i, (p, t) in enumerate(zip(pts, thick)):
        a = Vector(pts[max(i - 1, 0)])
        b = Vector(pts[min(i + 1, n - 1)])
        d = (b - a).normalized()
        nn = Vector((-d.y, d.x))
        left.append((p[0] + nn.x * t / 2, p[1] + nn.y * t / 2))
        right.append((p[0] - nn.x * t / 2, p[1] - nn.y * t / 2))
    return profile(part, pal, color, left + right[::-1], width, loc=(x, 0, 0), side_color=side_color)


def rod(part, color, p0, p1, radius, x=0.0, segs=5):
    """Cylinder between two (y, z) points in the YZ plane."""
    dy, dz = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dy, dz)
    return cyl(part, pal, color, radius, L, (x, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2), axis='Y', segs=segs,
               rot=(math.degrees(math.atan2(dz, dy)), 0, 0))


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


# ---------------------------------------------------------------- Body
body = Part('Body', (0, 0, 0))
SEAT = (0, 0.45, 1.05)
Part('Seat', SEAT, parent=body)

# chassis rail, axles
box(body, pal, 'steel', (0.9, 4.3, 0.55), (0, -0.2, 0.725))
box(body, pal, 'steel', (1.32, 0.28, 0.28), (0, 1.0, 0.75))
box(body, pal, 'steel', (1.5, 0.18, 0.18), (0, -1.5, 0.45))
# engine hood with grille on the nose
box(body, pal, lambda f: 'nose' if f.normal.y < -0.8 else 'yellow', (0.88, 1.65, 0.8), (0, -1.525, 1.4), taper=(0.9, 1))
box(body, pal, 'hazard', (0.96, 0.12, 0.3), (0, -2.4, 0.8))                      # front counterweight
cyl(body, pal, 'steel', 0.05, 0.6, (0.28, -1.1, 2.1), segs=5, cap_color='seat')  # exhaust stack
# loader towers beside the hood
for sx in (-1, 1):
    box(body, pal, 'yellow_dk', (0.12, 0.34, 0.8), (sx * 0.5, -0.75, 1.38), taper=(1, 0.7))
# dash console
box(body, pal, lambda f: 'dash' if f.normal.y > 0.5 else 'yellow_dk', (0.7, 0.5, 0.85), (0, -0.47, 1.475),
    taper=(1, 0.5), shear=(0, 0.1))
# cab floor, posts, roof
box(body, pal, lambda f: 'floor' if f.normal.z > 0.5 else 'yellow_dk', (1.28, 1.62, 0.1), (0, 0.35, 1.0))
for sx in (-1, 1):
    for py in (-0.4, 1.1):
        box(body, pal, 'steel', (0.08, 0.08, 1.55), (sx * 0.6, py, 1.825))
    # rear fenders
    box(body, pal, 'yellow', (0.52, 1.75, 0.08), (sx * 0.9, 1.0, 1.57))
    box(body, pal, 'yellow', (0.52, 0.08, 0.45), (sx * 0.9, 0.165, 1.31), rot=(-20, 0, 0))
    # roof lamps
    box(body, pal, lambda f: 'lamp' if f.normal.y < -0.8 else 'steel', (0.18, 0.1, 0.12), (sx * 0.5, -0.56, 2.55))
box(body, pal, lambda f: 'yellow' if f.normal.z > 0.5 else 'yellow_dk', (1.46, 1.9, 0.12), (0, 0.35, 2.66), taper=(0.9, 0.92))
cyl(body, pal, 'beacon', 0.07, 0.14, (0.45, 0.9, 2.79), segs=5)
# seat: cushion top 0.45 above Seat, backrest behind
box(body, pal, 'steel', (0.3, 0.3, 0.3), (0, 0.52, 1.2))
box(body, pal, 'seat', (0.5, 0.5, 0.15), (0, 0.5, 1.425))
box(body, pal, 'seat', (0.5, 0.1, 0.6), (0, 0.81, 1.8), shear=(0, 0.06))
# rear frame, stabilisers (the swing post is on Swing, below, so it turns with the boom)
box(body, pal, lambda f: 'hazard' if f.normal.y > 0.8 else 'yellow_dk', (1.7, 0.3, 0.55), (0, 1.95, 0.8))
for sx in (-1, 1):
    box(body, pal, 'yellow_dk', (0.14, 0.2, 0.75), (sx * 0.98, 1.95, 0.5), shear=(sx * -0.14, 0))
    box(body, pal, 'steel', (0.3, 0.42, 0.07), (sx * 1.0, 1.95, 0.1))

# ---------------------------------------------------------------- Wheels
for name, x, y, r, w in (('Wheel_FL', 0.9, -1.5, 0.45, 0.32), ('Wheel_FR', -0.9, -1.5, 0.45, 0.32),
                         ('Wheel_RL', 0.9, 1.0, 0.75, 0.5), ('Wheel_RR', -0.9, 1.0, 0.75, 0.5)):
    wp = Part(name, (x, y, r), parent=body)
    cyl(wp, pal, 'tread', r, w, (x, y, r), axis='X', segs=8, cap_color='hub')

# ---------------------------------------------------------------- Loader arms + bucket
LP, LK, LB = (-0.75, 1.65), (-2.3, 1.15), (-2.6, 0.4)
arms = Part('LoaderArms', (0, LP[0], LP[1]), parent=body)
for sx in (-1, 1):
    strip(arms, 'yellow', [(LP[0] + 0.1, LP[1] + 0.03), LK, (LB[0] - 0.03, LB[1] - 0.1)], [0.22, 0.26, 0.2], 0.12,
          x=sx * 0.62, side_color='yellow_dk')
    rod(arms, 'chrome', (-0.85, 1.08), (-2.05, 1.18), 0.04, x=sx * 0.58)          # lift ram
cyl(arms, pal, 'steel', 0.07, 1.24, (0, -2.5, 0.72), axis='X', segs=5)            # cross tube

lbucket = Part('LoaderBucket', (0, LB[0], LB[1]), parent=arms)
shell_o = [(-3.5, 0.04), (-2.85, 0.04), (-2.7, 0.5), (-2.8, 1.0), (-3.0, 1.05)]
shell_i = [(-2.93, 0.93), (-2.82, 0.5), (-2.93, 0.13), (-3.5, 0.09)]
profile(lbucket, pal, lambda f: 'yellow' if f.normal.y > 0.2 else 'dirt_steel', shell_o + shell_i, 2.2)
for sx in (-1, 1):
    profile(lbucket, pal, 'yellow_dk', shell_o, 0.05, loc=(sx * 1.125, 0, 0))
box(lbucket, pal, 'steel', (2.3, 0.12, 0.03), (0, -3.47, 0.045))                  # cutting edge

# ---------------------------------------------------------------- Rear digging arm
BP, BE, BH = (2.25, 0.85), (3.2, 3.15), (3.8, 1.1)
swing = Part('Swing', (0, BP[0], BP[1]), parent=body)                               # yaw pivot; carries the swing post
box(swing, pal, 'steel', (0.42, 0.3, 0.95), (0, 2.2, 0.9))
boom = Part('Boom', (0, BP[0], BP[1]), parent=swing)
strip(boom, 'yellow', [BP, lerp(BP, BE, 0.5), BE], [0.3, 0.46, 0.3], 0.3, side_color='yellow_dk')
bd = (Vector(BE) - Vector(BP)).normalized()
bn = Vector((-bd.y, bd.x))
sd = (Vector(BH) - Vector(BE)).normalized()
sn = Vector((-sd.y, sd.x))
ST_TAIL = tuple(Vector(BE) - sd * 0.42)
c0 = tuple(Vector(lerp(BP, BE, 0.3)) + bn * 0.28)
c1 = tuple(Vector(ST_TAIL) + bn * 0.02)
l0 = (2.33, 0.5)                                                                   # boom lift ram, post base to boom back
l1 = tuple(Vector(lerp(BP, BE, 0.55)) - bn * 0.2)

stick = Part('Stick', (0, BE[0], BE[1]), parent=boom)
strip(stick, 'yellow', [ST_TAIL, BE, BH], [0.18, 0.36, 0.2], 0.2, side_color='yellow_dk')
k0 = tuple(Vector(BE) + sd * 0.3 + sn * 0.22)
k1 = (BH[0] + 0.184, BH[1] + 0.154)                                                # ram pin on the ears behind the bucket hinge

bucket = Part('Bucket', (0, BH[0], BH[1]), parent=stick)
DY, DZ = BH[0] - 4.05, BH[1] - 1.15
bo = [(y + DY, z + DZ) for y, z in [(3.78, 1.22), (4.15, 1.05), (4.27, 0.62), (4.05, 0.3), (3.6, 0.2)]]
bi = [(y + DY, z + DZ) for y, z in [(4.0, 0.39), (4.16, 0.64), (4.08, 0.95), (3.85, 1.08)]]
profile(bucket, pal, lambda f: 'yellow_dk' if f.normal.y > 0.1 else 'dirt_steel', bo + bi, 0.56)
for sx in (-1, 1):
    profile(bucket, pal, 'yellow_dk', bo, 0.04, loc=(sx * 0.3, 0, 0))
for tx in (-0.22, 0, 0.22):
    box(bucket, pal, 'chrome', (0.07, 0.2, 0.05), (tx, 3.56 + DY, 0.2 + DZ), rot=(12, 0, 0), taper=(0.5, 1))
for sx in (-1, 1):                                                                 # ears the bucket ram pushes on (straddle the stick)
    box(bucket, pal, 'steel', (0.05, 0.14, 0.3), (sx * 0.13, BH[0] + 0.16, BH[1] + 0.06))

# ---------------------------------------------------------------- Rams (telescoping, stay attached in clips)
ram(pal, 'BoomRam', swing, (0, l0[0], l0[1]), boom, (0, l1[0], l1[1]), 'steel', 'chrome', radius=0.07, barrel=0.7)
ram(pal, 'StickRam', boom, (0, c0[0], c0[1]), stick, (0, c1[0], c1[1]), 'steel', 'chrome', radius=0.075, barrel=0.68)
ram(pal, 'BucketRam', stick, (0, k0[0], k0[1]), bucket, (0, k1[0], k1[1]), 'steel', 'chrome', radius=0.065, barrel=0.65)

# ---------------------------------------------------------------- Clips
# dig: reach out behind, plunge, drag the bucket in while curling, lift, swing to the side, dump, swing back and fold.
animate('dig', 5.0, {
    'Swing':  [(0.00, {'rot': (0, 0, 0)}), (0.48, {'rot': (0, 0, 0)}), (0.60, {'rot': (0, 0, -75)}),
               (0.82, {'rot': (0, 0, -75)}), (1.00, {'rot': (0, 0, 0)})],
    'Boom':   [(0.00, {'rot': (0, 0, 0)}), (0.10, {'rot': (-20, 0, 0)}), (0.18, {'rot': (-40, 0, 0)}),
               (0.21, {'rot': (-40, 0, 0)}), (0.27, {'rot': (-34, 0, 0)}), (0.34, {'rot': (-29, 0, 0)}),
               (0.42, {'rot': (-15, 0, 0)}), (0.50, {'rot': (10, 0, 0)}), (0.82, {'rot': (10, 0, 0)}),
               (1.00, {'rot': (0, 0, 0)})],
    'Stick':  [(0.00, {'rot': (0, 0, 0)}), (0.10, {'rot': (80, 0, 0)}), (0.21, {'rot': (80, 0, 0)}),
               (0.27, {'rot': (60, 0, 0)}), (0.34, {'rot': (35, 0, 0)}), (0.42, {'rot': (20, 0, 0)}),
               (0.64, {'rot': (20, 0, 0)}), (0.72, {'rot': (70, 0, 0)}), (0.82, {'rot': (70, 0, 0)}),
               (1.00, {'rot': (0, 0, 0)})],
    'Bucket': [(0.00, {'rot': (0, 0, 0)}), (0.10, {'rot': (-15, 0, 0)}), (0.21, {'rot': (-15, 0, 0)}),
               (0.27, {'rot': (-26, 0, 0)}), (0.34, {'rot': (-42, 0, 0)}), (0.42, {'rot': (-75, 0, 0)}),
               (0.50, {'rot': (-80, 0, 0)}), (0.64, {'rot': (-80, 0, 0)}), (0.72, {'rot': (15, 0, 0)}),
               (0.82, {'rot': (15, 0, 0)}), (1.00, {'rot': (0, 0, 0)})],
})

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/backhoe_loader.glb'),
                  os.path.join(ROOT, 'previews/backhoe_loader.png'))
