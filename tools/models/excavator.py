"""Tracked hydraulic excavator. Front is -Y, ground z=0, centred on x=0. Cab on the left (+X).
Parts: Tracks (root) > Upper (swing) > Boom > Stick > Bucket, plus Seat marker under Upper."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('excavator')

YEL = (0.93, 0.68, 0.08)
YEL_D = (0.70, 0.48, 0.05)
STEEL = (0.20, 0.21, 0.23)
BLACK = (0.07, 0.07, 0.08)
RUST = (0.42, 0.22, 0.10)
DIRT = (0.36, 0.27, 0.17)

pal.color('yellow', YEL, grime=0.35)
pal.color('yellow_top', YEL, noise=0.05)
pal.color('steel', STEEL, noise=0.1, grime=0.3)
pal.color('rubber', BLACK, noise=0.12)
pal.color('chrome', (0.72, 0.74, 0.78), noise=0.04)
pal.color('rust', RUST, noise=0.15, grime=0.4)
pal.color('seat', (0.16, 0.14, 0.13), noise=0.1)
pal.stripes('tread', (0.10, 0.10, 0.11), (0.27, 0.25, 0.23), width=1, diagonal=False)
pal.stripes('hazard', (0.95, 0.75, 0.05), (0.08, 0.08, 0.08), width=3)
pal.color('bucket', (0.30, 0.29, 0.28), noise=0.14, grime=0.5)
pal.color('tooth', (0.80, 0.78, 0.72), noise=0.08, grime=0.2)


def _panel(x, y):  # yellow engine panel: vent slats, door seam, dirty sill
    if 3 <= x <= 12 and 6 <= y <= 12:
        return (0.10, 0.10, 0.11) if y % 2 == 0 else YEL_D
    if x in (1, 14) and 2 <= y <= 13:
        return YEL_D
    if y < 2:
        return DIRT
    return YEL
pal.pattern('panel', _panel)


def _tank(x, y):  # side tank / toolbox: seam lines, a filler cap, dirt
    if y < 2:
        return DIRT
    if y == 9 or x == 8:
        return YEL_D
    if 11 <= x <= 13 and 11 <= y <= 13:
        return STEEL
    return YEL
pal.pattern('tank', _tank)


def _trackside(x, y):  # crawler side: black pads round the edge, rollers inside
    if y in (0, 1, 14, 15) or x in (0, 15):
        return (0.09, 0.09, 0.10) if (x + y) % 2 else (0.20, 0.19, 0.18)
    if y in (3, 4) and x % 3 != 0:
        return (0.34, 0.33, 0.32)
    if y in (11, 12) and x % 5 in (1, 2):
        return (0.34, 0.33, 0.32)
    return (0.13, 0.12, 0.12)
pal.pattern('trackside', _trackside)


def _frame(x, y):  # track frame rail: yellow with rust streaks and bolt heads
    if y < 3:
        return RUST
    if y == 8 and x % 4 == 1:
        return STEEL
    return YEL_D if (x * 7 + y * 3) % 11 == 0 else YEL
pal.pattern('frame', _frame)


def _hub(x, y):  # sprocket / idler face
    d = math.hypot(x - 7.5, y - 7.5)
    if d < 2.2:
        return YEL
    if d < 5.5:
        return (0.30, 0.30, 0.31) if (x + y) % 3 else RUST
    return (0.12, 0.12, 0.13)
pal.pattern('hub', _hub)


def _boom(x, y):  # boom / stick side plate: weld seam, scuffs, darker edges
    if y in (0, 15):
        return YEL_D
    if y in (1, 14) and x % 4 == 0:
        return STEEL
    if (x * 5 + y * 7) % 41 == 0:
        return RUST
    return YEL
pal.pattern('boomside', _boom)


# ---------------------------------------------------------------- helpers
def beam(part, color, p0, p1, w, t, x=0.0):
    """Box running from p0 to p1 (both (y, z)) at lateral position x; w across X, t thick."""
    dy, dz = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dy, dz)
    return box(part, pal, color, (w, L, t), (x, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2),
               rot=(math.degrees(math.atan2(dz, dy)), 0, 0))


def limb(pts):
    """Outline of a plate following centreline pts [(y, z, half_thickness)]."""
    ns = []
    for i in range(len(pts) - 1):
        dy, dz = pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]
        L = math.hypot(dy, dz)
        ns.append((-dz / L, dy / L))
    up, lo = [], []
    for i, (y, z, h) in enumerate(pts):
        if i == 0:
            n = ns[0]
        elif i == len(pts) - 1:
            n = ns[-1]
        else:
            ny, nz = ns[i - 1][0] + ns[i][0], ns[i - 1][1] + ns[i][1]
            L = math.hypot(ny, nz)
            n = (ny / L, nz / L)
        up.append((y + n[0] * h, z + n[1] * h))
        lo.append((y - n[0] * h, z - n[1] * h))
    return up + lo[::-1]


def sides(side_key, other_key, axis=0):
    return lambda f: side_key if abs(f.normal[axis]) > 0.9 else other_key


# ---------------------------------------------------------------- Tracks (root)
tracks = Part('Tracks', (0, 0, 0))
TRACK = [(-1.90, 0.0), (1.90, 0.0), (2.25, 0.30), (2.25, 0.62), (1.95, 0.92),
         (-1.95, 0.92), (-2.25, 0.62), (-2.25, 0.30)]
for sx in (-1, 1):
    profile(tracks, pal, 'tread', TRACK, 0.62, loc=(sx * 1.19, 0, 0), side_color='trackside')
    # sprocket (rear) and idler (front) hubs standing proud of the outer face
    for y in (-1.80, 1.80):
        cyl(tracks, pal, 'steel', 0.36, 0.10, (sx * 1.53, y, 0.46), axis='X', segs=6, cap_color='hub')
    # outer track frame rail
    box(tracks, pal, 'frame', (0.08, 2.9, 0.30), (sx * 1.52, 0, 0.46))
    for y in (-0.9, 0.0, 0.9):
        cyl(tracks, pal, 'steel', 0.17, 0.06, (sx * 1.53, y, 0.17), axis='X', segs=5, cap_color='hub')
# centre frame (X-shaped carbody reads as one dark block) and slew ring
box(tracks, pal, 'steel', (1.80, 2.2, 0.50), (0, 0, 0.55), taper=(1.0, 0.7))
cyl(tracks, pal, 'steel', 0.85, 0.22, (0, 0, 0.89), segs=8)

# ---------------------------------------------------------------- Upper (rotating house)
upper = Part('Upper', (0, 0, 1.0), parent=tracks)
DECK = 1.25
# deck plate
box(upper, pal, sides('steel', 'steel'), (2.8, 3.9, 0.25), (0, 0.35, 1.125))
# engine cover across the back
box(upper, pal, lambda f: 'yellow_top' if f.normal.z > 0.9 else 'panel',
    (2.8, 2.0, 1.0), (0, 1.25, 1.75), taper=(0.94, 0.95))
# counterweight
box(upper, pal, lambda f: 'hazard' if f.normal.y > 0.7 else 'steel',
    (2.8, 0.55, 1.20), (0, 2.50, 1.60), taper=(0.92, 0.75), shear=(0, -0.06))
# right-hand tank / toolbox beside the boom
box(upper, pal, lambda f: 'yellow_top' if f.normal.z > 0.9 else 'tank',
    (0.95, 1.75, 0.70), (-0.925, -0.70, 1.60), taper=(1.0, 0.88), shear=(0, 0.10))
# exhaust stack
cyl(upper, pal, 'rust', 0.08, 0.75, (-0.85, 1.35, 2.60), segs=5)
# boom foot brackets
for sx in (-1, 1):
    profile(upper, pal, 'steel', [(-1.55, DECK), (-0.80, DECK), (-1.05, 1.72), (-1.35, 1.72)], 0.10,
            loc=(sx * 0.41, 0, 0))

# open cab on the left (+X): floor is the deck, four posts and a roof
SEAT = (0.90, -0.60, DECK)
seat = Part('Seat', SEAT, parent=upper)
CX0, CX1, CY0, CY1 = 0.47, 1.33, -1.52, 0.10
for x in (CX0 + 0.055, CX1 - 0.055):
    for y in (CY0 + 0.055, CY1 - 0.055):
        box(upper, pal, 'yellow', (0.11, 0.11, 1.62), (x, y, DECK + 0.81))
box(upper, pal, lambda f: 'yellow_top' if abs(f.normal.z) > 0.9 else 'yellow',
    (1.06, 1.96, 0.15), (0.90, -0.79, 2.925))
# seat: pedestal, cushion (top 0.45 above Seat), backrest behind the driver volume
box(upper, pal, 'steel', (0.36, 0.36, 0.33), (0.90, -0.52, DECK + 0.165))
box(upper, pal, 'seat', (0.50, 0.50, 0.12), (0.90, -0.52, DECK + 0.39))
box(upper, pal, 'seat', (0.50, 0.10, 0.75), (0.90, -0.24, DECK + 0.70), shear=(0, 0.06))
# low dash console ahead of the driver volume
box(upper, pal, 'steel', (0.50, 0.14, 0.55), (0.90, -1.37, DECK + 0.275))
# low sill panels (below seat-top height, outside the driver volume) so the cab has body at low res
box(upper, pal, 'tank', (0.05, 1.40, 0.50), (CX1 + 0.035, -0.71, DECK + 0.25))
box(upper, pal, 'hazard', (0.86, 0.05, 0.50), (0.90, CY0 - 0.005, DECK + 0.25))

# work lights on the roof front, grab rail on the tank side
for x in (0.62, 1.18):
    box(upper, pal, lambda f: 'chrome' if f.normal.y < -0.9 else 'steel', (0.16, 0.10, 0.12), (x, -1.50, 3.05))
for y in (-1.45, 0.05):
    box(upper, pal, 'steel', (0.05, 0.05, 0.40), (-1.33, y + 0.0, 2.13))
box(upper, pal, 'steel', (0.05, 1.55, 0.05), (-1.33, -0.70, 2.33))

# ---------------------------------------------------------------- Boom
B0, KNEE, ELBOW = (-1.20, 1.50), (-3.20, 3.95), (-5.00, 3.60)
boom = Part('Boom', (0, B0[0], B0[1]), parent=upper)
profile(boom, pal, 'yellow', limb([(B0[0], B0[1], 0.20), (KNEE[0], KNEE[1], 0.40), (ELBOW[0], ELBOW[1], 0.20)]),
        0.72, side_color='boomside')
# stick ram along the top of the boom to the stick tail
STICK_D = ((-6.00 - ELBOW[0]), (1.25 - ELBOW[1]))
_L = math.hypot(*STICK_D)
SD = (STICK_D[0] / _L, STICK_D[1] / _L)          # unit vector down the stick
SN = (SD[1], -SD[0])                             # unit normal pointing forward/outward
TAIL = (ELBOW[0] - SD[0] * 0.65, ELBOW[1] - SD[1] * 0.65)
box(boom, pal, 'steel', (0.20, 0.30, 0.22), (0, -3.25, 4.33))

# ---------------------------------------------------------------- Stick
TIP = (-6.00, 1.25)
stick = Part('Stick', (0, ELBOW[0], ELBOW[1]), parent=boom)
profile(stick, pal, 'yellow', limb([(TAIL[0], TAIL[1], 0.13), (ELBOW[0], ELBOW[1], 0.32), (TIP[0], TIP[1], 0.15)]),
        0.52, side_color='boomside')
# elbow pin
cyl(stick, pal, 'steel', 0.15, 0.86, (0, ELBOW[0], ELBOW[1]), axis='X', segs=6)
# bucket ram down the front face of the stick
R0 = (ELBOW[0] + SN[0] * 0.38 + SD[0] * 0.25, ELBOW[1] + SN[1] * 0.38 + SD[1] * 0.25)

# ---------------------------------------------------------------- Bucket
bucket = Part('Bucket', (0, TIP[0], TIP[1]), parent=stick)
OUTER = [(-5.90, 1.40), (-6.55, 1.17), (-6.80, 0.68), (-6.52, 0.24), (-5.85, 0.12)]
INNER = [(-5.85, 0.20), (-6.46, 0.33), (-6.68, 0.68), (-6.48, 1.07), (-5.90, 1.30)]
BS = 1.1
OUTER = [(TIP[0] + (y - TIP[0]) * BS, TIP[1] + (z - TIP[1]) * BS) for y, z in OUTER]
INNER = [(TIP[0] + (y - TIP[0]) * BS, TIP[1] + (z - TIP[1]) * BS) for y, z in INNER]
BW = 1.20
profile(bucket, pal, 'bucket', OUTER + INNER, BW)
for sx in (-1, 1):
    profile(bucket, pal, 'bucket', OUTER, 0.05, loc=(sx * BW / 2, 0, 0), side_color='rust')
# teeth along the cutting lip, pointing back toward the machine
for i in range(5):
    cyl(bucket, pal, 'tooth', 0.085, 0.40, (-0.50 + i * 0.25, -5.66, 0.09), axis='Y', segs=4, radius2=0.02,
        rot=(4, 0, 0))
# hinge ears and the link from the ram to the back of the bucket
for sx in (-1, 1):
    box(bucket, pal, 'steel', (0.06, 0.34, 0.26), (sx * 0.30, -6.02, 1.34))

# ---------------------------------------------------------------- Rams (telescoping, stay attached in clips)
# twin boom rams from the house front up to the boom flanks
for sx, tag in ((-1, 'R'), (1, 'L')):
    ram(pal, 'BoomRam_' + tag, upper, (sx * 0.44, -1.62, 1.36), boom, (sx * 0.44, -2.75, 3.15), 'steel', 'chrome',
        radius=0.08, barrel=0.62)
# stick ram along the top of the boom to the stick tail
ram(pal, 'StickRam', boom, (0, -3.25, 4.38), stick, (0, TAIL[0], TAIL[1]), 'steel', 'chrome', radius=0.095, barrel=0.70)
# bucket ram down the front face of the stick, straight onto the back of the bucket
BUCKET_PIN = (-6.52, 1.24)
ram(pal, 'BucketRam', stick, (0, R0[0], R0[1]), bucket, (0, BUCKET_PIN[0], BUCKET_PIN[1]), 'steel', 'chrome',
    radius=0.085, barrel=0.62)

# ---------------------------------------------------------------- Clips
# dig (6 s). Starts and ends in the rest pose (bucket set down on the ground), so the exported rest pose is untouched.
# Reach out and open, drop and bite, drag the stick in while curling, lift, swing 70 degrees to the cab side,
# throw the stick out and open the bucket to dump, swing back while lowering, set the bucket down.
# Stick-out is capped at -34 (reach) and -30 (dump): further out the stick ram lies down into the boom's top plate.
# Boom: + is down. Stick: + is in toward the machine. Bucket: + is curl, - is open. Upper rz: + swings to +X;
# the small Upper rx is the house nodding under load.
animate('dig', 6.0, {
    'Upper':  [(0.00, {'rot': (0, 0, 0)}), (0.11, {'rot': (0, 0, 0)}), (0.17, {'rot': (2, 0, 0)}),
               (0.33, {'rot': (2, 0, 0)}), (0.42, {'rot': (-1.5, 0, 0)}), (0.59, {'rot': (0, 0, 70)}),
               (0.74, {'rot': (0, 0, 70)}), (0.92, {'rot': (0, 0, 0)})],
    'Boom':   [(0.00, {'rot': (0, 0, 0)}), (0.10, {'rot': (0, 0, 0)}), (0.17, {'rot': (12, 0, 0)}),
               (0.20, {'rot': (12, 0, 0)}), (0.28, {'rot': (2.5, 0, 0)}), (0.36, {'rot': (-5, 0, 0)}),
               (0.47, {'rot': (-30, 0, 0)}), (0.76, {'rot': (-30, 0, 0)}), (0.97, {'rot': (0, 0, 0)})],
    'Stick':  [(0.00, {'rot': (0, 0, 0)}), (0.10, {'rot': (-34, 0, 0)}), (0.20, {'rot': (-34, 0, 0)}),
               (0.28, {'rot': (-10, 0, 0)}), (0.36, {'rot': (22, 0, 0)}), (0.47, {'rot': (28, 0, 0)}),
               (0.60, {'rot': (28, 0, 0)}), (0.67, {'rot': (-30, 0, 0)}), (0.76, {'rot': (-30, 0, 0)}),
               (0.97, {'rot': (0, 0, 0)})],
    'Bucket': [(0.00, {'rot': (0, 0, 0)}), (0.10, {'rot': (-50, 0, 0)}), (0.17, {'rot': (-42, 0, 0)}),
               (0.20, {'rot': (-42, 0, 0)}), (0.28, {'rot': (-5, 0, 0)}), (0.36, {'rot': (35, 0, 0)}),
               (0.47, {'rot': (38, 0, 0)}), (0.61, {'rot': (38, 0, 0)}), (0.68, {'rot': (-55, 0, 0)}),
               (0.78, {'rot': (-55, 0, 0)}), (0.97, {'rot': (0, 0, 0)})],
})

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/excavator.glb'),
                  os.path.join(ROOT, 'previews/excavator.png'))
