"""Pickaxe. Hand-tool frame: handle end at the origin, shaft along +Z, head at z=0.88 lying along Y
(long pick point toward +Y, short flat chisel toward -Y)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('pickaxe')
pal.color('wood', (0.58, 0.40, 0.20), grime=0.3)
pal.stripes('grip', (0.16, 0.15, 0.14), (0.26, 0.24, 0.22), width=2, diagonal=False)
pal.color('steel', (0.44, 0.46, 0.52), noise=0.12, grime=0.35)
pal.color('eye', (0.27, 0.28, 0.33), noise=0.1)
pal.color('edge', (0.74, 0.76, 0.78), noise=0.08)

p = Part('Pickaxe', (0, 0, 0))

# shaft: slightly flared toward the head, with a butt knob and two wrapped grip bands where the hands go
cyl(p, pal, 'wood', 0.023, 0.90, (0, 0, 0.45), segs=6, radius2=0.030)
# grips share the shaft's 6 sides and sit proud of it, so the shaft never pokes through a grip face
cyl(p, pal, 'grip', 0.033, 0.11, (0, 0, 0.055), segs=6)
cyl(p, pal, 'grip', 0.032, 0.10, (0, 0, 0.30), segs=6)

# head: rectangular cross-sections along Y, drooping toward the handle at both ends
# (y, z centre, half width x, half height z)
secs = [(-0.13, 0.866, 0.038, 0.014),
        (-0.055, 0.884, 0.040, 0.040),
        (0.055, 0.884, 0.040, 0.040),
        (0.13, 0.874, 0.029, 0.029),
        (0.22, 0.848, 0.018, 0.018)]
verts, faces = [], []
for y, zc, wx, hz in secs:
    verts += [(-wx, y, zc - hz), (wx, y, zc - hz), (wx, y, zc + hz), (-wx, y, zc + hz)]
for i in range(len(secs) - 1):
    a, b = i * 4, i * 4 + 4
    for k in range(4):
        faces.append((a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k))
# pick point
tip = len(verts); verts.append((0, 0.30, 0.805))
last = (len(secs) - 1) * 4
for k in range(4):
    faces.append((last + k, last + (k + 1) % 4, tip))
# chisel edge (a flat blade edge running along X)
c0 = len(verts); verts += [(-0.048, -0.22, 0.832), (0.048, -0.22, 0.832)]
faces += [(0, 1, c0 + 1, c0), (3, 2, c0 + 1, c0), (1, 2, c0 + 1), (0, 3, c0)]


def head_col(f):
    cy = f.calc_center_median().y
    if cy > 0.22 or cy < -0.16:
        return 'edge'
    if abs(cy) < 0.06:
        return 'eye'
    return 'steel'


poly(p, pal, head_col, verts, faces)
# shaft stub poking through the top of the eye
box(p, pal, 'wood', (0.046, 0.056, 0.022), (0, 0, 0.933))

finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/pickaxe.glb'), os.path.join(ROOT, 'previews/pickaxe.png'), scale_figure=False)
