"""Shovel (tool 1). Hand-tool frame: handle end at the origin, shaft along +Z, blade is wide along X and thin along Y."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))
reset()
pal = Palette('shovel')
pal.color('wood', (0.55, 0.38, 0.20), grime=0.25)
pal.color('grip', (0.75, 0.15, 0.10))
pal.color('steel', (0.62, 0.64, 0.67), noise=0.1, grime=0.5)
pal.color('socket', (0.30, 0.31, 0.33))

s = Part('Shovel', (0, 0, 0))
# D-grip at the handle end
box(s, pal, 'grip', (0.14, 0.035, 0.035), (0, 0, 0.0))
box(s, pal, 'grip', (0.03, 0.03, 0.10), (-0.055, 0, 0.05), shear=(0.045, 0))
box(s, pal, 'grip', (0.03, 0.03, 0.10), (0.055, 0, 0.05), shear=(-0.045, 0))
cyl(s, pal, 'wood', 0.02, 0.98, (0, 0, 0.59), segs=5)
cyl(s, pal, 'socket', 0.028, 0.16, (0, 0, 1.10), segs=5, radius2=0.04)
# blade: shoulders, then a taper to a point
box(s, pal, 'steel', (0.24, 0.02, 0.20), (0, 0.012, 1.26), taper=(1.0, 1))
box(s, pal, 'steel', (0.24, 0.02, 0.12), (0, 0.012, 1.42), taper=(0.25, 1))
finish_and_export(pal, None, os.path.join(ROOT, 'public/models/tools/shovel.glb'), os.path.join(ROOT, 'previews/shovel.png'), scale_figure=False)
