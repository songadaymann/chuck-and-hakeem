"""Mining shovel: giant electric rope shovel. Front is -Y, ground z=0, centred on x=0.
Parts: Tracks (root) > Upper > Boom > Stick > Bucket > Door, plus Seat marker under Upper,
Saddle (the saddle block on the shipper shaft, under Boom) and the Hoist_L / Hoist_R rope rams (Boom to Bucket).
Clip 'dig': tuck, crowd and hoist through the bank, swing, trip the door, swing back, lower."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('mining_shovel')

YEL = (0.88, 0.66, 0.10)
YEL_D = (0.62, 0.45, 0.08)
DARK = (0.17, 0.18, 0.21)
MID = (0.36, 0.37, 0.40)
DIRT = (0.36, 0.27, 0.17)
BLACK = (0.07, 0.07, 0.08)

pal.color('yellow', YEL, grime=0.25)
pal.color('yellow_d', YEL_D, grime=0.3)
pal.color('steel', DARK, noise=0.1)
pal.color('steel_l', MID, noise=0.1, grime=0.3)
pal.color('rope', BLACK, noise=0.02)
pal.color('bucket', (0.40, 0.30, 0.24), noise=0.14, grime=0.5)
pal.color('cavity', (0.20, 0.15, 0.12), noise=0.18, grime=0.5)
pal.color('tooth', (0.74, 0.74, 0.70), noise=0.08, grime=0.3)
pal.color('seat', (0.55, 0.12, 0.10))
pal.color('dirt', DIRT, noise=0.12, grime=0.3)
pal.stripes('tread', (0.10, 0.10, 0.11), (0.30, 0.27, 0.24), width=2, diagonal=False)
pal.stripes('hazard', (0.92, 0.72, 0.08), (0.08, 0.08, 0.08), width=4)
pal.stripes('steps', (0.55, 0.56, 0.58), (0.16, 0.16, 0.18), width=2, diagonal=False)


def track_side(x, y):
    if y <= 1 or y >= 14:
        return (0.10, 0.10, 0.11) if x % 2 else (0.27, 0.25, 0.22)
    if x <= 1 or x >= 14:            # tumbler / idler ends
        return DARK if (y in (2, 13)) else MID
    if y in (2, 3):                  # lower rollers
        return DARK if x % 3 else DIRT
    if y == 13:
        return DARK if x % 4 else MID
    if 6 <= y <= 9:
        return YEL_D if y in (6, 9) else YEL
    return DIRT if y < 6 else (0.25, 0.25, 0.27)


def house_side(x, y):
    if y <= 1:
        return (0.42, 0.32, 0.12) if x % 2 else (0.30, 0.24, 0.12)
    if y >= 14:
        return YEL_D
    if y == 13:
        return DARK
    if x in (7, 8) and 2 <= y <= 6:           # access door
        return (0.30, 0.31, 0.34) if not (x == 8 and y == 4) else (0.8, 0.8, 0.8)
    if (2 <= x <= 5 or 10 <= x <= 13) and 7 <= y <= 11:   # louvred vents
        return DARK if y % 2 else MID
    if (2 <= x <= 5 or 10 <= x <= 13) and 3 <= y <= 5:    # panel
        return YEL_D if y == 3 else YEL
    if x in (0, 15) or y == 6:
        return YEL_D
    return YEL


def house_front(x, y):
    if y <= 1:
        return (0.30, 0.24, 0.12)
    if 6 <= x <= 9 and 3 <= y <= 14:         # rope / boom opening
        return (0.06, 0.06, 0.07)
    if x in (5, 10) and 3 <= y <= 14:
        return DARK
    if y >= 14:
        return YEL_D
    if (1 <= x <= 3) and 8 <= y <= 11:        # vent on the right side of the front wall
        return DARK if y % 2 else MID
    return YEL


def roof(x, y):
    base = (0.42, 0.42, 0.40) if (x + y) % 2 else (0.38, 0.38, 0.37)
    if x in (0, 15) or y in (0, 15):
        return YEL
    if (x % 5 == 2) and (y % 5 == 2):
        return DARK
    if x % 5 == 0 or y % 5 == 0:
        return (0.28, 0.28, 0.29)
    return base


def lattice(x, y):
    # plated box girder: flanges, stiffener ribs, recessed web panels with a rivet row
    if y <= 1 or y >= 14:
        return YEL_D if y in (1, 14) else YEL
    if x % 4 == 0:
        return (0.45, 0.32, 0.06)
    if y in (3, 12) and x % 4 == 2:
        return DARK
    if 5 <= y <= 10 and x % 8 in (5, 6, 7):
        return (0.74, 0.54, 0.08)
    return YEL


def stick_tex(x, y):
    if y <= 3:                        # rack teeth along the underside
        return DARK if x % 2 else MID
    if y >= 14:
        return YEL_D
    return YEL


def ring(x, y):
    if y in (0, 15):
        return DARK
    return MID if x % 2 else BLACK


def bucket_side(x, y):
    if y >= 13:                       # wear lip
        return (0.62, 0.62, 0.58) if x % 4 else (0.40, 0.40, 0.40)
    if y in (11, 12):
        return DARK
    if x % 5 == 0:
        return (0.24, 0.18, 0.15)
    if y <= 3:
        return DIRT if (x + y) % 3 else (0.28, 0.21, 0.14)
    return (0.46, 0.33, 0.24) if (x * 7 + y * 3) % 5 else (0.52, 0.30, 0.18)


def cab_panel(x, y):
    if y >= 13:
        return DARK
    if y <= 2:
        return (0.08, 0.08, 0.08) if (x + y) % 8 < 4 else (0.92, 0.72, 0.08)
    return YEL


pal.pattern('track_side', track_side)
pal.pattern('house_side', house_side)
pal.pattern('house_front', house_front)
pal.pattern('roof', roof)
pal.pattern('lattice', lattice)
pal.pattern('stick', stick_tex)
pal.pattern('ring', ring)
pal.pattern('cab_panel', cab_panel)
pal.pattern('bucket_side', bucket_side)


# ---------------------------------------------------------------- helpers
class Frame:
    """Local frame rotated about X by `ang` degrees at `pivot`. Author axis-aligned, then put()."""

    def __init__(self, pivot, ang):
        self.M = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(ang), 4, 'X')

    def put(self, ob):
        ob.data.transform(self.M)
        return ob

    def pt(self, x, y, z):
        return self.M @ Vector((x, y, z))


def rope(part, color, p0, p1, t=0.12, tx=None):
    """Thin square bar between two points that share the same x."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ang = math.degrees(math.atan2(d.z, d.y))
    return box(part, pal, color, (tx or t, d.length, t), (p0 + p1) / 2, rot=(ang, 0, 0))


def hexa(part, color, x0, x1, q, side_color=None):
    """Prism with a quad YZ cross-section q=[(y,z)x4] from x0 to x1 (all quads, so swatches map cleanly)."""
    verts = [(x0, y, z) for y, z in q] + [(x1, y, z) for y, z in q]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4)] + [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
    col = color
    if side_color:
        col = lambda f: side_color if abs(f.normal.x) > 0.9 else color
    return poly(part, pal, col, verts, faces)


# ---------------------------------------------------------------- Tracks (root)
tracks = Part('Tracks', (0, 0, 0))
TP = [(-4.2, 0.55), (-3.7, 0.0), (3.7, 0.0), (4.2, 0.55), (4.2, 1.45), (3.8, 1.9), (-3.8, 1.9), (-4.2, 1.45)]
for sx in (-1, 1):
    profile(tracks, pal, 'tread', TP, 1.7, loc=(sx * 3.3, 0, 0))
    box(tracks, pal, lambda f: 'track_side' if abs(f.normal.x) > 0.9 else 'steel',
        (0.12, 7.9, 1.5), (sx * 4.17, 0, 0.95))
    # crawler side frame joining it to the carbody
    box(tracks, pal, 'yellow_d', (0.5, 5.0, 0.9), (sx * 2.35, 0, 1.05))
box(tracks, pal, lambda f: 'steel_l' if abs(f.normal.z) > 0.9 else 'yellow_d', (4.4, 4.8, 1.3), (0, 0, 1.2))
for sx in (-1, 1):       # drive tumbler / idler hubs on the outer faces
    for sy in (-1, 1):
        cyl(tracks, pal, 'steel', 0.62, 0.3, (sx * 4.3, sy * 3.55, 0.95), axis='X', segs=6, cap_color='steel_l')
cyl(tracks, pal, 'ring', 2.3, 0.5, (0, 0, 2.05), segs=10, cap_color='steel')

# ---------------------------------------------------------------- Upper
upper = Part('Upper', (0, 0, 2.3), parent=tracks)
# deck / walkway slab
box(upper, pal, lambda f: 'steel_l' if abs(f.normal.z) > 0.9 else 'hazard', (9.0, 7.0, 0.35), (0, 0.5, 2.475))
# machinery house
HY0, HY1, HZ0, HZ1 = -2.0, 4.0, 2.65, 7.65


def house_col(f):
    n = f.normal
    if n.z > 0.9:
        return 'roof'
    if n.y < -0.9:
        return 'house_front'
    return 'house_side'


box(upper, pal, house_col, (7.8, HY1 - HY0, HZ1 - HZ0), (0, (HY0 + HY1) / 2, (HZ0 + HZ1) / 2))
# counterweight slab on the back
box(upper, pal, lambda f: 'hazard' if f.normal.y > 0.9 else 'steel', (8.4, 0.6, 1.9), (0, 4.3, 3.25))
# roof vents / fan housings
box(upper, pal, lambda f: 'steel' if f.normal.z > 0.9 else 'steel_l', (1.8, 1.6, 0.5), (-2.6, 1.2, HZ1 + 0.25))
box(upper, pal, lambda f: 'steel' if f.normal.z > 0.9 else 'steel_l', (1.4, 1.4, 0.7), (2.6, 2.6, HZ1 + 0.35))
# walkway railings (top rail + posts) down both sides
for sx in (-1, 1):
    x = sx * 4.4
    box(upper, pal, 'steel', (0.08, 6.9, 0.08), (x, 0.5, 3.7))
    for y in (-2.9, -0.6, 1.7, 3.9):
        box(upper, pal, 'steel', (0.08, 0.08, 1.05), (x, y, 3.17))
# roof handrail: right side, rear, and the left side behind the stair head
RZ = HZ1 + 0.95
box(upper, pal, 'steel', (0.08, 6.0, 0.08), (-3.85, 1.0, RZ))
box(upper, pal, 'steel', (7.7, 0.08, 0.08), (0, 3.95, RZ))
box(upper, pal, 'steel', (0.08, 3.6, 0.08), (3.85, 2.2, RZ))
for x, y in ((-3.85, -1.95), (-3.85, 1.0), (-3.85, 3.95), (0, 3.95), (3.85, 3.95), (3.85, 0.4)):
    box(upper, pal, 'steel', (0.08, 0.08, 0.95), (x, y, HZ1 + 0.475))
# boarding ladder hanging off the back of the counterweight
box(upper, pal, 'steps', (0.6, 0.08, 2.2), (-3.3, 4.64, 3.1))
# floodlights on the cab roof
for x in (2.5, 3.6):
    box(upper, pal, lambda f: 'tooth' if f.normal.y < -0.9 else 'steel', (0.35, 0.25, 0.25), (x, -3.9, 7.25))
# stair up the left side of the house, deck to roof
rope(upper, 'steps', (4.15, 3.6, 2.7), (4.15, -1.0, HZ1 - 0.05), t=0.14, tx=0.5)
# boom foot lugs
for sx in (-1, 1):
    box(upper, pal, 'steel', (0.8, 0.9, 0.75), (sx * 1.0, -2.45, 3.0))
# gantry (A-frame) on the roof
GT = (1.2, 10.8)
for sx in (-1, 1):
    rope(upper, 'yellow', (sx * 1.0, -1.6, HZ1 - 0.05), (sx * 1.0, GT[0], GT[1]), t=0.34)
    rope(upper, 'yellow', (sx * 1.0, 3.7, HZ1 - 0.05), (sx * 1.0, GT[0], GT[1]), t=0.34)
box(upper, pal, 'steel', (2.6, 0.4, 0.4), (0, GT[0], GT[1]))

# operator cab, high on the front left corner (left = +X), open fronted
SX, SY, SZ = 3.05, -3.0, 5.4
seat = Part('Seat', (SX, SY, SZ), parent=upper)
CX0, CX1, CY0 = 2.2, 3.9, -4.05
# pedestal tower under the rear of the cab + cantilever floor
box(upper, pal, lambda f: 'steel_l' if f.normal.z > 0.9 else 'yellow_d', (CX1 - CX0, 1.0, SZ - 0.2 - 2.65),
    ((CX0 + CX1) / 2, -2.5, (SZ - 0.2 + 2.65) / 2))
box(upper, pal, lambda f: 'steel_l' if f.normal.z > 0.9 else 'yellow_d', (CX1 - CX0, HY0 - CY0, 0.2),
    ((CX0 + CX1) / 2, (HY0 + CY0) / 2, SZ - 0.1))
# diagonal brace under the cantilever
rope(upper, 'steel', (SX, -3.9, SZ - 0.2), (SX, -3.0, 4.0), t=0.2)
# roof
box(upper, pal, lambda f: 'yellow' if abs(f.normal.z) > 0.9 else 'steel', (CX1 - CX0 + 0.2, HY0 - CY0 + 0.15, 0.18),
    ((CX0 + CX1) / 2, (HY0 + CY0) / 2 - 0.075, SZ + 1.64))
# front corner posts
for x in (CX0 + 0.07, CX1 - 0.07):
    box(upper, pal, 'steel', (0.14, 0.14, 1.55), (x, CY0 + 0.07, SZ + 0.775))
# low side panels and front kick panel
for x in (CX0 + 0.04, CX1 - 0.04):
    box(upper, pal, 'cab_panel', (0.08, HY0 - CY0, 0.55), (x, (HY0 + CY0) / 2, SZ + 0.275))
box(upper, pal, 'cab_panel', (CX1 - CX0, 0.08, 0.4), ((CX0 + CX1) / 2, CY0 + 0.04, SZ + 0.2))
# seat cushion (top 0.45 above Seat) and backrest
box(upper, pal, 'seat', (0.6, 0.55, 0.45), (SX, SY + 0.03, SZ + 0.225), taper=(1, 1))
box(upper, pal, 'seat', (0.6, 0.14, 0.75), (SX, SY + 0.38, SZ + 0.8))
box(upper, pal, 'steel', (0.5, 0.5, 0.45), (SX, SY + 0.6, SZ + 0.225))

# ---------------------------------------------------------------- Boom
FOOT = Vector((0, -2.4, 3.0))
TIP = Vector((0, -10.4, 13.0))
bd = TIP - FOOT
BL = bd.length
B_ANG = math.degrees(math.atan2(-bd.z, -bd.y))        # local -Y runs along the boom
boom = Part('Boom', FOOT, parent=upper)
BF = Frame(FOOT, B_ANG)
SAD = 5.6                                             # saddle block distance along the boom
for sx in (-1, 1):
    x0, x1 = sx * 1.1 - 0.35, sx * 1.1 + 0.35
    BF.put(hexa(boom, 'yellow', x0, x1, [(0.0, -0.45), (0.0, 0.45), (-SAD, 1.1), (-SAD, -1.1)], side_color='lattice'))
    BF.put(hexa(boom, 'yellow', x0, x1, [(-SAD, -1.1), (-SAD, 1.1), (-BL - 0.5, 0.5), (-BL - 0.5, -0.5)],
                side_color='lattice'))
# cross members
BF.put(box(boom, pal, 'yellow_d', (1.6, 0.8, 0.6), (0, -1.6, 0)))
BF.put(box(boom, pal, 'yellow_d', (1.6, 0.6, 0.5), (0, -10.3, -0.2)))
# shipper shaft at the saddle, tip sheaves and their axle
SADDLE = BF.pt(0, -SAD, 0)
cyl(boom, pal, 'steel', 0.5, 3.4, SADDLE, axis='X', segs=6, cap_color='steel_l')
for sx in (-1, 1):
    cyl(boom, pal, 'steel', 0.85, 0.4, TIP + Vector((sx * 0.45, 0, 0)), axis='X', segs=8, cap_color='steel_l')
cyl(boom, pal, 'steel_l', 0.2, 3.1, TIP, axis='X', segs=5)

# ---------------------------------------------------------------- Stick
JOINT = Vector((0, -8.8, 2.9))
sd = JOINT - SADDLE
SL = sd.length
S_ANG = math.degrees(math.atan2(-sd.z, -sd.y))
stick = Part('Stick', SADDLE, parent=boom)
SF = Frame(SADDLE, S_ANG)
TAIL = 1.3
SF.put(box(stick, pal, lambda f: 'stick' if abs(f.normal.x) > 0.9 else ('steel' if f.normal.z < -0.9 else 'yellow'),
           (1.0, SL + TAIL, 1.0), (0, (TAIL - SL) / 2, 0)))
# saddle block: pivots on the shipper shaft with the stick, but the stick slides (crowds) through it
saddle = Part('Saddle', SADDLE, parent=boom)
SF.put(box(saddle, pal, 'steel', (1.4, 1.7, 1.5), (0, 0, 0)))

# ---------------------------------------------------------------- Bucket (dipper)
bucket = Part('Bucket', JOINT, parent=stick)
KF = Frame(JOINT, S_ANG)
BC = Vector((0, -1.3, 0.75))


def bcol(f):
    v = BC - f.calc_center_median()
    if v.length > 0 and f.normal.dot(v.normalized()) > 0.5:
        return 'cavity'
    return 'bucket_side' if abs(f.normal.z) < 0.5 else 'bucket'


KF.put(box(bucket, pal, bcol, (3.0, 0.25, 2.3), (0, -0.125, 0.55)))        # wall on the handle side
# door / back: hinged along the handle-side edge, trips open to dump
door = Part('Door', KF.pt(0, 0, -0.475), parent=bucket)
KF.put(box(door, pal, bcol, (3.0, 2.6, 0.25), (0, -1.3, -0.475)))
for sx in (-1, 1):
    KF.put(box(bucket, pal, bcol, (0.25, 2.6, 2.5), (sx * 1.375, -1.3, 0.65)))
KF.put(box(bucket, pal, bcol, (3.0, 0.25, 2.7), (0, -2.475, 0.75)))        # lip wall
for i in range(5):
    KF.put(box(bucket, pal, 'tooth', (0.46, 0.4, 1.1), (-1.2 + i * 0.6, -2.5, 2.6), taper=(0.3, 0.35)))
# bail
for sx in (-1, 1):
    KF.put(box(bucket, pal, 'steel', (0.2, 0.32, 1.7), (sx * 1.6, -1.3, 1.95)))
KF.put(box(bucket, pal, 'steel', (3.4, 0.28, 0.28), (0, -1.3, 2.75)))
BAIL = KF.pt(0, -1.3, 2.75)

# ---------------------------------------------------------------- ropes
HOIST_R = 0.075
for sx, tag in ((-1, 'R'), (1, 'L')):
    x = sx * 0.45
    # back from the tip sheave to the house (static, part of Boom)
    rope(boom, 'rope', (x, TIP.y + 0.2, TIP.z + 0.8), (x, HY0 + 0.05, 6.3), t=0.13)
    # suspension strands from the boom tip back to the gantry (static, part of Boom)
    p = BF.pt(sx * 1.0, -BL + 0.4, 0.5)
    rope(boom, 'rope', p, (sx * 1.0, GT[0], GT[1]), t=0.13)
    # hoist: from the front of the tip sheave down to the bail. A telescoping pair used as a rope, so it
    # follows the dipper; both halves are the same colour and overlap along the middle.
    P0, P1 = Vector((x, TIP.y - 0.83, TIP.z)), Vector((x, BAIL.y, BAIL.z))
    pb, pr = ram(pal, 'Hoist_' + tag, boom, P0, bucket, P1, 'rope', 'rope', radius=HOIST_R, segs=4, barrel=0.59)
    # ram() makes the rod half thinner; fatten it back to the barrel's gauge so the rope is one thickness
    R = (P0 - P1).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    k = 1 / 0.55
    pr.objs[-1].data.transform(Matrix.Translation(P1) @ R @ Matrix.Diagonal((k, k, 1, 1)) @ R.inverted()
                               @ Matrix.Translation(-P1))

# ---------------------------------------------------------------- Clips
SWING = 80        # degrees, toward the cab side (+X)
DUMP = 78         # door swing


def sk(t, a, c):
    """Stick key: a = degrees about the shipper shaft (negative hoists), c = metres of crowd along the handle."""
    ph = math.radians(S_ANG + a)
    return (t, {'rot': (a, 0, 0), 'loc': (0, -c * math.cos(ph), -c * math.sin(ph))})


# tuck (short hold) > crowd into the toe of the bank > hoist and crowd up through it > hold while the house swings
# and the door trips > lower while swinging back. The tuck is limited by the handle tail, which must stay under
# the static back ropes; the top is limited by the hoist rope rams (2:1 length range).
STICK = [(0.00, 0, 0.0), (0.08, 22, -0.4), (0.10, 22, -0.4), (0.15, 9, 0.2), (0.20, -5, 1.0), (0.31, -44, 1.7),
         (0.66, -44, 1.7), (0.81, -20, 0.8), (0.94, 0, 0.0), (1.00, 0, 0.0)]
animate('dig', 8.0, {
    'Stick':  [sk(*k) for k in STICK],
    'Saddle': [(t, {'rot': (a, 0, 0)}) for t, a, c in STICK],
    'Upper':  [(0.00, {'rot': (0, 0, 0)}), (0.31, {'rot': (0, 0, 0)}), (0.47, {'rot': (0, 0, SWING)}),
               (0.63, {'rot': (0, 0, SWING)}), (0.85, {'rot': (0, 0, 0)}), (1.00, {'rot': (0, 0, 0)})],
    'Door':   [(0.00, {'rot': (0, 0, 0)}), (0.47, {'rot': (0, 0, 0)}), (0.50, {'rot': (DUMP, 0, 0)}),
               (0.66, {'rot': (DUMP, 0, 0)}), (0.80, {'rot': (0, 0, 0)}), (1.00, {'rot': (0, 0, 0)})],
})

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/mining_shovel.glb'),
                  os.path.join(ROOT, 'previews/mining_shovel.png'))
