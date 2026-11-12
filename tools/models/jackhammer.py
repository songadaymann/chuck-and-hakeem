"""Jackhammer (hand tool). Hand-tool frame: T-handle along X through the origin, body hangs along +Z,
chisel tip at z=1.02. Hose stub leaves the back (+Y), exhaust block on the front (-Y)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('jackhammer')

YEL, DARK, BLK, STEEL = (0.92, 0.68, 0.08), (0.27, 0.28, 0.31), (0.07, 0.07, 0.08), (0.62, 0.64, 0.68)


def _n(x, y, k=0.10):
    h = ((x * 73 + y * 151 + x * y * 31) % 17) / 17.0 - 0.5
    return 1 + h * k


def _mul(c, f):
    return tuple(min(1, max(0, v * f)) for v in c)


def body_fn(x, y):      # y=0 is the handle end, y=15 the nose end
    if y in (0, 1, 14):
        return _mul(DARK, _n(x, y))
    if 9 <= y <= 12:    # hazard band
        return _mul(BLK if ((x + y) // 3) % 2 else YEL, _n(x, y, 0.05))
    if y == 15 or y == 13:
        return _mul((0.42, 0.25, 0.10), _n(x, y, 0.3))   # rust / dirt near the nose
    if y == 5 and x % 5 == 2:
        return _mul(DARK, 1.0)                           # rivets
    return _mul(YEL, _n(x, y) * (1.0 - 0.02 * y))


def bar_fn(x, y):       # black rubber grips at both ends, steel bar between
    if x < 4 or x > 11:
        return _mul(BLK, _n(x, y, 0.3) * (1.5 if x % 2 else 1.0))
    return _mul(STEEL, _n(x, y))


def nose_fn(x, y):
    if y % 5 == 0:
        return _mul(BLK, 1.0)
    return _mul(DARK, _n(x, y, 0.2) * (1.0 + 0.03 * (15 - y)))


def grille_fn(x, y):
    if 2 <= x <= 13 and 3 <= y <= 12 and y % 3 != 0:
        return BLK
    return _mul(DARK, _n(x, y) * 1.3)


pal.pattern('body', body_fn)
pal.pattern('bar', bar_fn)
pal.pattern('nose', nose_fn)
pal.pattern('grille', grille_fn)
pal.color('yellow', YEL, grime=0.25)
pal.color('dark', DARK, noise=0.1)
pal.color('rubber', BLK, noise=0.15)
pal.stripes('hose', (0.10, 0.10, 0.11), (0.03, 0.03, 0.03), width=2, diagonal=True)
pal.color('steel', STEEL, noise=0.1, grime=0.3)
pal.color('tip', (0.74, 0.76, 0.80), noise=0.08, grime=0.0)
pal.color('red', (0.80, 0.12, 0.08))
pal.color('brass', (0.70, 0.52, 0.18))

j = Part('Jackhammer', (0, 0, 0))

# T-handle: one chunky bar through the origin, 0.46 wide, grips painted on (hands at x=+-0.20)
cyl(j, pal, 'bar', 0.027, 0.46, (0, 0, 0), axis='X', segs=5, cap_color='rubber')
# handle head / valve housing joining bar to body (narrow, so the steel bar shows beside it)
box(j, pal, 'yellow', (0.13, 0.10, 0.085), (0, 0, 0.0025))
# trigger lever over the right-hand grip, hinged at the head (inner end buried in the housing)
box(j, pal, 'red', (0.19, 0.04, 0.016), (0.135, 0, -0.045), rot=(0, 8, 0))
# top flange
box(j, pal, 'dark', (0.23, 0.21, 0.04), (0, 0, 0.06))
# main cylinder body, z=0.04 .. 0.50
cyl(j, pal, 'body', 0.105, 0.46, (0, 0, 0.27), segs=6, cap_color='dark')
# tapered nose / front head, z=0.50 .. 0.62
cyl(j, pal, 'nose', 0.090, 0.12, (0, 0, 0.56), segs=6, radius2=0.048, cap_color='dark')
# exhaust block on the front
box(j, pal, lambda f: 'grille' if f.normal.y < -0.9 else 'dark', (0.12, 0.07, 0.14), (0, -0.105, 0.20))
# air hose: brass fitting on the back, fat rubber stub angling up past the handle
box(j, pal, 'brass', (0.07, 0.07, 0.07), (0, 0.11, 0.15))
cyl(j, pal, 'hose', 0.034, 0.20, (0, 0.215, 0.105), axis='Y', segs=4, rot=(-25, 0, 0), cap_color='rubber')
# bit retainer collar
box(j, pal, 'yellow', (0.105, 0.105, 0.045), (0, 0, 0.635))
# chisel bit: square shank (turned 45 deg), forged collar, then a flat wedge to the ground at z=1.02
cyl(j, pal, 'steel', 0.030, 0.20, (0, 0, 0.75), segs=4)
box(j, pal, 'dark', (0.075, 0.075, 0.03), (0, 0, 0.70))
box(j, pal, 'tip', (0.075, 0.05, 0.18), (0, 0, 0.93), taper=(0.75, 0.06))

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/jackhammer.glb'),
                  os.path.join(ROOT, 'previews/jackhammer.png'), scale_figure=False)
