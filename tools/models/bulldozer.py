"""Bulldozer. Vehicle frame: metres, Z up, front faces -Y, on the ground z=0, centred on x=0.
Parts: Body (root), Track_L, Track_R, Blade, Ripper, Seat (marker), ram halves Lift_L/R and Rip (_Barrel/_Rod).
Clip: dig."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('bulldozer')
Y = (0.92, 0.66, 0.08)
pal.color('yellow', Y, grime=0.25)
pal.color('yellow_d', (0.72, 0.50, 0.06), grime=0.45)
pal.color('steel', (0.20, 0.21, 0.23), noise=0.1)
pal.color('edge', (0.55, 0.56, 0.58), noise=0.12, grime=0.4)
pal.color('rubber', (0.07, 0.07, 0.08), noise=0.15)
pal.color('seat', (0.16, 0.14, 0.13), noise=0.1)
pal.color('rust', (0.42, 0.22, 0.10), noise=0.2, grime=0.4)
pal.color('blade_face', (0.80, 0.60, 0.12), noise=0.14, grime=0.75)
pal.stripes('tread', (0.10, 0.10, 0.11), (0.30, 0.29, 0.27), width=1, diagonal=False, noise=0.1)
pal.color('frame', (0.36, 0.36, 0.38), noise=0.1, grime=0.5)
pal.color('lamp', (0.98, 0.95, 0.75), noise=0.03)
pal.stripes('grille', (0.06, 0.06, 0.07), (0.30, 0.30, 0.32), width=2, diagonal=False)
pal.stripes('hazard', (0.95, 0.75, 0.05), (0.06, 0.06, 0.06), width=4)


def _hub(x, y):
    d = math.hypot(x - 7.5, y - 7.5)
    if d < 2.5:
        return (0.75, 0.55, 0.08)
    if d < 6 and (int(math.degrees(math.atan2(y - 7.5, x - 7.5)) + 180) // 45) % 2 == 0:
        return (0.12, 0.12, 0.13)
    return (0.30, 0.30, 0.32)


def _rollers(x, y):
    if y < 6 and (x % 4) in (1, 2) and 1 <= y <= 4:
        return (0.42, 0.42, 0.44)
    if y >= 12:
        return (0.14, 0.14, 0.15)
    return (0.22, 0.22, 0.24)


def _panel(x, y):  # yellow panel with dark seam and rivets
    if x in (0, 15) or y in (0, 15):
        return (0.55, 0.38, 0.05)
    if (x in (2, 13)) and (y in (2, 13)):
        return (0.35, 0.25, 0.05)
    k = 1.0 - 0.02 * (15 - y)
    return (Y[0] * k, Y[1] * k, Y[2] * k)


pal.pattern('hub', _hub)
pal.pattern('rollers', _rollers)
pal.pattern('panel', _panel)

body = Part('Body', (0, 0, 0))
SEAT = (0, 0.55, 1.55)
seat = Part('Seat', SEAT, parent=body)

# ---------------------------------------------------------------- body
chassis_col = lambda f: 'yellow_d' if abs(f.normal.x) > 0.7 else 'steel'
box(body, pal, chassis_col, (1.9, 4.25, 0.85), (0, -0.025, 0.875))                       # chassis between tracks
hood_col = lambda f: 'grille' if f.normal.y < -0.7 else ('yellow' if f.normal.z > 0.7 else 'panel')
box(body, pal, hood_col, (1.35, 1.65, 0.95), (0, -1.325, 1.775), taper=(0.88, 1))    # engine hood
box(body, pal, 'rust', (1.5, 0.12, 0.5), (0, -2.2, 1.0))                             # radiator guard / bumper
cyl(body, pal, 'steel', 0.075, 0.85, (0.32, -1.5, 2.65), segs=6, cap_color='rubber') # exhaust stack
cyl(body, pal, 'steel', 0.14, 0.3, (-0.32, -1.05, 2.4), segs=6, radius2=0.10)        # air pre-cleaner
box(body, pal, 'yellow_d', (1.8, 1.5, 0.25), (0, 0.25, 1.425))                       # cab floor (top = Seat z)
box(body, pal, 'panel', (1.1, 0.25, 0.8), (0, -0.375, 1.95))                         # dash
tank_col = lambda f: 'hazard' if f.normal.y > 0.7 else 'panel'
box(body, pal, tank_col, (1.8, 1.1, 0.75), (0, 1.55, 1.675))                         # fuel tank behind seat
box(body, pal, 'seat', (0.55, 0.5, 0.45), (0, 0.60, 1.775))                          # cushion, top 0.45 above Seat
box(body, pal, 'seat', (0.55, 0.14, 0.85), (0, 0.93, 2.325))                         # backrest
for sx in (-1, 1):
    box(body, pal, 'yellow_d', (0.36, 0.9, 0.42), (sx * 0.70, 0.55, 1.76))           # side consoles / armrests
    box(body, pal, 'steel', (0.12, 0.12, 1.63), (sx * 0.84, -0.42, 2.365))           # front post
    box(body, pal, 'steel', (0.12, 0.12, 1.13), (sx * 0.84, 1.95, 2.615))            # rear post
    box(body, pal, 'yellow_d', (0.66, 1.3, 0.08), (sx * 1.23, 1.45, 1.74))           # fender over the track
    lamp_col = lambda f: 'lamp' if f.normal.y < -0.7 else 'steel'
    box(body, pal, lamp_col, (0.26, 0.16, 0.18), (sx * 0.68, -0.5, 3.09))            # work light under roof front
roof_col = lambda f: 'yellow' if abs(f.normal.z) > 0.7 else 'hazard'
box(body, pal, roof_col, (1.95, 2.65, 0.12), (0, 0.77, 3.24))                        # roof on posts

# ---------------------------------------------------------------- tracks
BELT = [(-1.85, 0), (1.85, 0), (2.2, 0.3), (2.15, 0.62), (0.85, 1.62), (0.4, 1.68), (0.1, 1.5),
        (-2.05, 0.72), (-2.25, 0.42), (-2.15, 0.12)]
FRAME = [(-1.9, 0.14), (1.85, 0.14), (2.05, 0.45), (0.8, 1.47), (0.42, 1.53), (0.15, 1.36), (-2.08, 0.5)]
for name, sx in (('Track_L', 1), ('Track_R', -1)):
    x = sx * 1.25
    t = Part(name, (x, 0, 0.8), parent=body)
    profile(t, pal, 'tread', BELT, 0.6, loc=(x, 0, 0), side_color='rubber')
    profile(t, pal, 'steel', FRAME, 0.64, loc=(x, 0, 0), side_color='frame')
    cyl(t, pal, 'steel', 0.40, 0.70, (x, 0.47, 1.2), axis='X', segs=8, cap_color='hub')    # high drive sprocket
    cyl(t, pal, 'steel', 0.30, 0.68, (x, -1.85, 0.42), axis='X', segs=6, cap_color='hub')  # front idler
    cyl(t, pal, 'steel', 0.28, 0.68, (x, 1.82, 0.40), axis='X', segs=6, cap_color='hub')   # rear idler
    rf_col = lambda f: 'rollers' if abs(f.normal.x) > 0.7 else 'yellow_d'
    box(t, pal, rf_col, (0.70, 2.9, 0.34), (x, -0.02, 0.36))                               # roller frame

# ---------------------------------------------------------------- blade
HINGE = (0, -0.3, 0.55)
blade = Part('Blade', HINGE, parent=body)
BL = [(-3.15, 0.0), (-2.92, 0.3), (-2.84, 0.75), (-2.9, 1.15), (-3.08, 1.5),
      (-2.96, 1.5), (-2.76, 1.15), (-2.7, 0.75), (-2.76, 0.3), (-3.0, 0.0)]


def blade_col(f):
    c = f.calc_center_median()
    if abs(f.normal.x) > 0.9:
        return 'yellow_d'
    if f.normal.y < 0:
        return 'edge' if c.z < 0.2 else 'blade_face'
    return 'yellow_d'


profile(blade, pal, blade_col, BL, 3.7)
for sx in (-1, 1):
    profile(blade, pal, 'yellow', [(-3.17, 0), (-3.12, 1.52), (-2.9, 1.52), (-2.72, 0.6), (-2.8, 0)], 0.08,
            loc=(sx * 1.86, 0, 0), side_color='yellow_d')                                  # end plates
    box(blade, pal, 'yellow', (0.16, 2.6, 0.26), (sx * 1.70, -1.55, 0.45), rot=(4.6, 0, 0))  # push arm
    box(blade, pal, 'steel', (0.10, 1.5, 0.10), (sx * 1.70, -2.2, 0.86), rot=(-31, 0, 0))    # tilt brace
    cyl(blade, pal, 'steel', 0.17, 0.24, (sx * 1.68, -0.3, 0.55), axis='X', segs=6, cap_color='hub')  # trunnion

# ---------------------------------------------------------------- ripper
RH = (0, 2.12, 0.95)
rip = Part('Ripper', RH, parent=body)
box(rip, pal, 'yellow', (1.8, 0.32, 0.36), (0, 2.82, 0.98))                               # tool beam
for sx in (-1, 1):
    box(rip, pal, 'yellow_d', (0.16, 0.85, 0.2), (sx * 0.5, 2.42, 0.95))                  # hinge arms
SH = [(2.72, 1.3), (2.96, 1.3), (3.22, 0.75), (3.05, 0.28), (2.5, 0.03), (2.88, 0.42), (2.96, 0.75)]
for sx in (-0.72, 0, 0.72):
    profile(rip, pal, 'steel', SH, 0.14, loc=(sx, 0, 0), side_color='rust')               # shanks / claws

RIP_BARREL, RIP_UP, RIP_DROP = 0.72, 22, -0.25

# ---------------------------------------------------------------- Rams (telescoping, stay attached in clips)
for sx, tag in ((-1, 'R'), (1, 'L')):
    # blade lift: hood side down and out to the push arm just behind the blade (passes in front of the track)
    box(body, pal, 'steel', (0.16, 0.22, 0.22), (sx * 0.66, -1.95, 1.85))                 # ram mounting bracket on the hood
    ram(pal, 'Lift_' + tag, body, (sx * 0.66, -1.95, 1.85), blade, (sx * 1.66, -2.62, 0.50), 'steel', 'edge',
        radius=0.07, barrel=0.6)
# ripper: back of the fuel tank down to the tool beam
ram(pal, 'Rip', body, (0, 2.10, 1.95), rip, (0, 2.80, 1.16), 'steel', 'edge', radius=0.08, barrel=RIP_BARREL)

# ---------------------------------------------------------------- Clips
# dig: blade bites and the machine lunges 1.2 m nose-down (ripper carried high), blade heaves its load up and back,
# ripper drops into the ground and drags while the machine backs up nose-high, then everything settles to rest.
# The Body pivot is on the ground at mid-length, so every pitch key also lifts the body by 1.85 * sin(pitch):
# the machine rocks on the end of its tracks instead of sinking them into the ground.
# The ripper tip sits almost under its hinge, so the bite comes from lowering the whole ripper (loc) as it swings.
def _body(t, dy, pitch):
    return (t, {'loc': (0, dy, 1.85 * abs(math.sin(math.radians(pitch)))), 'rot': (pitch, 0, 0)})


animate('dig', 4.0, {
    'Body':   [_body(0.00, 0, 0), _body(0.07, 0.06, 1.5), _body(0.36, -1.20, 4.0), _body(0.43, -1.20, 0),
               _body(0.50, -1.20, -2.0), _body(0.58, -1.20, -3.5), _body(0.90, 0, -3.5), _body(1.00, 0, 0)],
    'Blade':  [(0.00, {'rot': (0, 0, 0)}), (0.07, {'rot': (3, 0, 0)}), (0.36, {'rot': (3, 0, 0)}),
               (0.48, {'rot': (-24, 0, 0)}), (0.84, {'rot': (-24, 0, 0)}), (0.97, {'rot': (0, 0, 0)})],
    'Ripper': [(0.00, {'rot': (0, 0, 0), 'loc': (0, 0, 0)}), (0.12, {'rot': (RIP_UP, 0, 0), 'loc': (0, 0, 0)}),
               (0.46, {'rot': (RIP_UP, 0, 0), 'loc': (0, 0, 0)}), (0.58, {'rot': (-14, 0, 0), 'loc': (0, 0, RIP_DROP)}),
               (0.88, {'rot': (-14, 0, 0), 'loc': (0, 0, RIP_DROP)}), (1.00, {'rot': (0, 0, 0), 'loc': (0, 0, 0)})],
})

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/bulldozer.glb'),
                  os.path.join(ROOT, 'previews/bulldozer.png'))
