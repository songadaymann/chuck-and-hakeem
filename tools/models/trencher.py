"""Walk-behind trencher (push tool). Authored upright: ground z=0, front -Y, handlebar centred at PUSH_HANDLE
along X. to_tool_frame() then moves it into the animated Tool bone's frame (set TRENCHER_UPRIGHT=1 to skip
that while judging the model)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('trencher')
YEL, YEL_D = (0.93, 0.66, 0.08), (0.62, 0.42, 0.06)
STEEL, DARK, BLACK = (0.42, 0.43, 0.45), (0.17, 0.18, 0.20), (0.07, 0.07, 0.08)
RUST = (0.50, 0.24, 0.10)

pal.color('yellow', YEL, grime=0.45)
pal.color('yellow_top', YEL, noise=0.05)
pal.color('dark', DARK, noise=0.12, grime=0.3)
pal.color('steel', STEEL, noise=0.12, grime=0.4)
pal.color('rubber', BLACK, noise=0.25)
pal.color('tank', (0.62, 0.17, 0.07), grime=0.3)
pal.color('chain', (0.25, 0.22, 0.20), noise=0.3)
pal.color('teeth', (0.60, 0.50, 0.42), noise=0.25, grime=0.5)
pal.stripes('tread', BLACK, (0.22, 0.22, 0.23), width=4, diagonal=False, noise=0.15)
pal.stripes('grille', DARK, (0.05, 0.05, 0.05), width=2, diagonal=False)
pal.stripes('hazard', YEL, BLACK, width=4)


def hub(x, y):
    r = math.hypot(x - 7.5, y - 7.5)
    if r > 5.5:
        return BLACK
    if r > 4.5:
        return DARK
    if r < 1.6:
        return DARK
    return YEL_D if (x + y) % 5 == 0 else YEL


def recoil(x, y):
    r = math.hypot(x - 7.5, y - 7.5)
    if r > 6.5:
        return DARK
    if r < 2:
        return BLACK
    return (0.08, 0.08, 0.09) if (int(math.degrees(math.atan2(y - 7.5, x - 7.5))) // 30) % 2 else STEEL


def boomside(x, y):  # yellow boom with a dirty wear strip and rivets
    if y in (0, 1, 14, 15):
        return YEL_D
    if 6 <= y <= 9:
        return RUST if x % 4 else DARK
    return YEL


pal.pattern('hub', hub)
pal.pattern('recoil', recoil)
pal.pattern('boomside', boomside)

AXLE_Y, AXLE_Z, WR = -0.55, 0.26, 0.26
WX = 0.325
PIV = (-1.10, 0.42)      # upper sprocket (y, z)
END = (-1.505, -0.04)     # lower sprocket centre (y, z)

t = Part('Trencher', PUSH_HANDLE)
wl = Part('Wheel_L', (WX, AXLE_Y, AXLE_Z), t)
wr = Part('Wheel_R', (-WX, AXLE_Y, AXLE_Z), t)
ch = Part('Chain', (0, PIV[0], PIV[1]), t)

# --- handlebar and arms
cyl(t, pal, 'rubber', 0.022, 0.54, (0, 0, 1.12), axis='X', segs=5)
for sx in (1, -1):
    box(t, pal, 'steel', (0.04, 0.04, 0.80), (sx * 0.20, -0.38, 0.72), shear=(sx * 0.04, 0.38))
box(t, pal, 'steel', (0.46, 0.03, 0.03), (0, -0.105, 0.90))
box(t, pal, 'hazard', (0.20, 0.07, 0.09), (0, -0.115, 0.93))          # control box on the cross brace

# --- chassis, engine, tank
box(t, pal, 'dark', (0.44, 0.72, 0.12), (0, -0.64, 0.27))
box(t, pal, 'steel', (0.52, 0.05, 0.05), (0, AXLE_Y, AXLE_Z))        # axle
box(t, pal, lambda f: 'grille' if abs(f.normal.y) > 0.9 else 'dark', (0.32, 0.36, 0.30), (0, -0.52, 0.48))
cyl(t, pal, 'dark', 0.11, 0.05, (0.185, -0.52, 0.48), axis='X', segs=6, cap_color='recoil')
box(t, pal, 'tank', (0.30, 0.30, 0.13), (0, -0.50, 0.695), taper=(0.8, 0.8))
box(t, pal, 'rubber', (0.07, 0.07, 0.03), (0.05, -0.50, 0.775))      # fuel cap
box(t, pal, 'steel', (0.07, 0.20, 0.09), (-0.19, -0.56, 0.60))      # muffler
# --- yellow chain housing / gearbox at the front
profile(t, pal, 'yellow', [(-0.70, 0.33), (-1.00, 0.33), (-1.00, 0.52), (-0.90, 0.66), (-0.70, 0.66)], 0.36,
        side_color='yellow')
box(t, pal, 'hazard', (0.30, 0.02, 0.15), (0, -0.954, 0.593), rot=(-35.5, 0, 0))

# yoke plates carrying the boom pivot clear of the housing, so the boom can swing
for sx in (1, -1):
    box(t, pal, 'steel', (0.03, 0.24, 0.15), (sx * 0.10, -1.04, 0.42))

# --- wheels
for p, sx in ((wl, 1), (wr, -1)):
    cyl(p, pal, 'tread', WR, 0.17, (sx * WX, AXLE_Y, AXLE_Z), axis='X', segs=8, cap_color='hub')

# --- digging boom + toothed chain
dy, dz = END[0] - PIV[0], END[1] - PIV[1]
L = math.hypot(dy, dz)
dy, dz = dy / L, dz / L
ny, nz = dz, -dy                      # perpendicular (towards upper/front side)


def uv(u, v):
    return (PIV[0] + u * dy + v * ny, PIV[1] + u * dz + v * nz)


H, T, N = 0.085, 0.06, 5
s = L / N
pts = []
for i in range(N):                    # one run, teeth raked forward
    pts += [(i * s, H), (i * s + 0.65 * s, H + T)]
pts += [(L, H), (L + 0.7 * H, 0.7 * H), (L + H + T, 0.0), (L + 0.7 * H, -0.7 * H)]
for i in range(N):                    # return run
    pts += [(L - i * s, -H), (L - i * s - 0.65 * s, -H - T)]
pts += [(0, -H), (-0.7 * H, -0.7 * H), (-H, 0), (-0.7 * H, 0.7 * H)]
profile(ch, pal, 'teeth', [uv(u, v) for u, v in pts], 0.11, side_color='chain')
ang = math.degrees(math.atan2(dz, dy))
mid = uv(L / 2, 0)
box(ch, pal, lambda f: 'boomside' if abs(f.normal.x) > 0.9 else 'yellow', (0.15, L + 0.02, 0.09),
    (0, mid[0], mid[1]), rot=(ang, 0, 0))
cyl(ch, pal, 'dark', 0.065, 0.22, (0, PIV[0], PIV[1]), axis='X', segs=6, cap_color='steel')
cyl(ch, pal, 'dark', 0.055, 0.17, (0, END[0], END[1]), axis='X', segs=6, cap_color='steel')

if not os.environ.get('TRENCHER_UPRIGHT'):
    to_tool_frame(Part.all)
finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/trencher.glb'),
                  os.path.join(ROOT, 'previews/trencher.png'), scale_figure=False)
