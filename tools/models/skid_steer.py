"""Skid-steer loader. Front is -Y, ground z=0, centred on x=0. Arms lowered, bucket resting on the ground."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('skid_steer')
Y, YD, K = (0.93, 0.68, 0.08), (0.70, 0.48, 0.05), (0.10, 0.10, 0.11)
pal.color('yellow', Y, grime=0.35)
pal.color('yellow_top', Y, noise=0.05)
pal.color('steel', (0.24, 0.25, 0.27), noise=0.1, grime=0.3)
pal.color('cage', (0.13, 0.13, 0.15))
pal.color('seat', (0.08, 0.08, 0.09), noise=0.15)
pal.color('floor', (0.30, 0.27, 0.22), noise=0.15)
pal.color('chrome', (0.72, 0.74, 0.76))
pal.color('bucket', (0.30, 0.29, 0.28), noise=0.14, grime=0.5)
pal.color('dirt', (0.36, 0.25, 0.15), noise=0.2)
pal.color('rust', (0.45, 0.24, 0.12), noise=0.2, grime=0.4)
pal.color('lamp', (1.0, 0.95, 0.7), noise=0.02)
pal.color('tail', (0.85, 0.10, 0.08), noise=0.03)
pal.stripes('tread', (0.07, 0.07, 0.08), (0.17, 0.17, 0.18), width=2, diagonal=False)
pal.stripes('hazard', (0.95, 0.75, 0.05), (0.08, 0.08, 0.08), width=4)
pal.stripes('grille', (0.06, 0.06, 0.07), (0.30, 0.30, 0.32), width=2, diagonal=False)


def hub(x, y):
    d = math.hypot(x - 7.5, y - 7.5)
    if d < 1.6:
        return (0.15, 0.15, 0.16)
    if d < 4.6:
        return YD if (int(math.atan2(y - 7.5, x - 7.5) / math.pi * 3 + 6) % 2) else Y
    return (0.08, 0.08, 0.09)


def side_panel(x, y):   # yellow panel with dark lower band and a black pinstripe
    if y < 3:
        return (0.12, 0.12, 0.13)
    if y in (9, 10):
        return K
    return Y if y > 5 else YD


def arm_tex(x, y):
    if y in (0, 15):
        return YD
    return K if (x in (2, 13) and 5 < y < 10) else Y


pal.pattern('hub', hub)
pal.pattern('panel', side_panel)
pal.pattern('arm', arm_tex)
pal.color('edge', (0.62, 0.63, 0.64), noise=0.05)
pal.pattern('bucket_in', lambda x, y: (0.36, 0.25, 0.15) if y < 4 + (x * 5 % 4) else
            (0.20, 0.20, 0.21) if (x + y) % 5 else (0.27, 0.26, 0.25))

# ---------------------------------------------------------------- Body
SEAT = (0, 0.20, 0.42)
body = Part('Body', (0, 0, 0))
Part('Seat', SEAT, parent=body)

# belly tub; its top (z=0.42) is the cab floor
box(body, pal, lambda f: 'floor' if f.normal.z > 0.9 else 'steel', (1.10, 2.25, 0.22), (0, 0.175, 0.31))
# side walls of the cab / chain cases
for sx in (-1, 1):
    profile(body, pal, 'yellow_top', [(-0.95, 0.42), (-0.95, 0.70), (-0.60, 0.90), (0.55, 0.90), (0.55, 0.42)],
            0.18, loc=(sx * 0.46, 0, 0), side_color='panel')
# engine housing behind the seat (sloped tail, grille on the back)
profile(body, pal, lambda f: 'panel' if abs(f.normal.x) > 0.9 else 'grille' if f.normal.y > 0.5 else 'yellow_top',
        [(0.55, 0.42), (0.55, 1.28), (1.02, 1.28), (1.30, 1.00), (1.30, 0.42)], 1.10)
# rear bumper / counterweight with hazard tape, tail lamps
box(body, pal, lambda f: 'hazard' if f.normal.y > 0.9 else 'steel', (1.30, 0.10, 0.24), (0, 1.35, 0.36))
for sx in (-1, 1):
    box(body, pal, 'tail', (0.12, 0.04, 0.10), (sx * 0.42, 1.31, 0.92))
# rear towers that carry the arm hinge
for sx in (-1, 1):
    profile(body, pal, 'yellow_top', [(0.78, 0.86), (0.90, 1.56), (1.20, 1.56), (1.30, 1.00), (1.30, 0.86)],
            0.12, loc=(sx * 0.605, 0, 0), side_color='yellow')
    cyl(body, pal, 'steel', 0.07, 0.30, (sx * 0.68, 1.05, 1.40), axis='X', segs=6)   # hinge pin
# exhaust stack
cyl(body, pal, 'rust', 0.045, 0.40, (0.30, 0.95, 1.46), segs=5)
# seat cushion (top 0.45 above Seat) and backrest
box(body, pal, 'seat', (0.50, 0.50, 0.45), (0, 0.22, 0.645))
box(body, pal, 'seat', (0.50, 0.09, 0.55), (0, 0.505, 1.145))
# open roll cage: four posts and a roof, with work lamps
for sx in (-1, 1):
    box(body, pal, 'cage', (0.09, 0.09, 1.15), (sx * 0.46, -0.52, 1.37), shear=(0, 0.14))
    box(body, pal, 'cage', (0.09, 0.09, 1.05), (sx * 0.46, 0.50, 1.42))
    box(body, pal, 'lamp', (0.14, 0.05, 0.09), (sx * 0.36, -0.60, 1.895))
box(body, pal, lambda f: 'yellow_top' if f.normal.z > 0.9 else 'cage', (1.10, 1.20, 0.07), (0, 0.05, 1.965))

# ---------------------------------------------------------------- Wheels
R = 0.42
for name, sx, wy in (('Wheel_FL', 1, -0.45), ('Wheel_FR', -1, -0.45), ('Wheel_RL', 1, 0.65), ('Wheel_RR', -1, 0.65)):
    w = Part(name, (sx * 0.725, wy, R), parent=body)
    cyl(w, pal, 'tread', R, 0.35, (sx * 0.725, wy, R), axis='X', segs=10, cap_color='hub')

# ---------------------------------------------------------------- Arms
HINGE = (0, 1.05, 1.40)
arms = Part('Arms', HINGE, parent=body)
ARM = [(1.22, 1.50), (-0.80, 1.14), (-1.14, 0.50), (-1.14, 0.16), (-0.96, 0.16), (-0.96, 0.44), (-0.70, 0.96),
       (1.22, 1.30)]
for sx in (-1, 1):
    profile(arms, pal, 'yellow_top', ARM, 0.14, loc=(sx * 0.80, 0, 0), side_color='arm')
    # tilt cylinder from the arm knee down to the bucket back
    # (leans back so its top is buried in the arm's inner face, its foot in the cross member)
# cross member joining the arms across the front
box(arms, pal, 'steel', (1.50, 0.16, 0.20), (0, -1.05, 0.30))

# ---------------------------------------------------------------- Bucket
bucket = Part('Bucket', (0, -1.10, 0.26), parent=arms)
profile(bucket, pal, lambda f: 'bucket' if abs(f.normal.x) > 0.9 else
        'edge' if f.normal.y < -0.3 and f.normal.z > 0.3 and f.calc_center_median().z < 0.05 else
        'dirt' if f.normal.z > 0.5 and f.normal.y < 0.1 else 'bucket_in' if f.normal.y < -0.6 else 'bucket',
        [(-1.14, 0.0), (-1.95, 0.0), (-1.93, 0.04), (-1.36, 0.10), (-1.26, 0.56), (-1.40, 0.68), (-1.14, 0.68)],
        1.70)
for sx in (-1, 1):
    profile(bucket, pal, 'rust', [(-1.14, 0.0), (-1.95, 0.0), (-1.40, 0.68), (-1.14, 0.68)], 0.05,
            loc=(sx * 0.875, 0, 0), side_color='bucket')

# ---------------------------------------------------------------- Rams (telescoping, stay attached in clips)
for sx, tag in ((-1, 'R'), (1, 'L')):
    ram(pal, 'Lift_' + tag, body, (sx * 0.66, 0.70, 0.62), arms, (sx * 0.72, -0.15, 1.10), 'steel', 'chrome', radius=0.06, barrel=0.8)
    ram(pal, 'Tilt_' + tag, arms, (sx * 0.70, -0.84, 0.86), bucket, (sx * 0.70, -1.22, 0.52), 'steel', 'chrome', radius=0.045, barrel=0.75)

# ---------------------------------------------------------------- Clips
# dig: drive the bucket into the pile, curl it back, lift, tip it out, come back down.
animate('dig', 4.0, {
    'Body':   [(0.00, {'loc': (0, 0, 0)}), (0.14, {'loc': (0, -0.35, 0)}), (0.30, {'loc': (0, -0.35, 0)}),
               (0.50, {'loc': (0, 0, 0)}), (1.00, {'loc': (0, 0, 0)})],
    'Arms':   [(0.00, {'rot': (0, 0, 0)}), (0.20, {'rot': (0, 0, 0)}), (0.50, {'rot': (-36, 0, 0)}),
               (0.74, {'rot': (-36, 0, 0)}), (0.94, {'rot': (0, 0, 0)})],
    'Bucket': [(0.00, {'rot': (0, 0, 0)}), (0.14, {'rot': (0, 0, 0)}), (0.26, {'rot': (-28, 0, 0)}),
               (0.52, {'rot': (-12, 0, 0)}), (0.62, {'rot': (48, 0, 0)}), (0.74, {'rot': (48, 0, 0)}),
               (0.94, {'rot': (0, 0, 0)})],
})

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/skid_steer.glb'),
                  os.path.join(ROOT, 'previews/skid_steer.png'))
