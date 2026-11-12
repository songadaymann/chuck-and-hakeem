"""Giants: chuck.glb and hakeem.glb. PLACEHOLDER caricature busts, waist up, stuck in the Capitol.
The game's real busts (public/models/world/chuck.glb, hakeem.glb) are made from the Meshy scans by tools/models/busts.py.
This script no longer writes there: its GLBs go to assets-src/placeholder/ (git-ignored), so running it cannot overwrite them.
It is kept as the reference for the layout both sets of busts share (sizes, part names).
Frame: metres, Z up, front faces -Y, waist at z=0, centred on x=0. 36 m tall, shoulders x -11..11.
Parts: root 'Chuck' / 'Hakeem' (torso), 'Head' (pivot at the base of the neck), 'Arm_L' (+X), 'Arm_R' (-X)."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from lowpoly import *

ROOT = os.path.dirname(os.path.dirname(HERE))


def art(rows, legend):
    """16 strings of 16 chars (top row first) -> pattern function."""
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), [len(r) for r in rows]
    return lambda x, y: legend[rows[15 - y][x]]


def mul(c, k):
    return tuple(min(1.0, v * k) for v in c)


def build(name, skin, suit, tie_a, tie_b, hair, glasses, beard, bald):
    reset()
    pal = Palette(name.lower())
    skin_d = mul(skin, 0.80)
    skin_l = mul(skin, 1.08)
    white = (0.95, 0.95, 0.93)
    pupil = (0.08, 0.06, 0.06)
    lip = (0.40, 0.20, 0.17) if beard else (0.68, 0.40, 0.36)
    brow = mul(hair, 0.72)
    mcol = (0.10, 0.08, 0.07)                                   # moustache / goatee: near black
    bcol = tuple(a * 0.42 + b * 0.58 for a, b in zip(skin, mcol))  # short beard: stubble, skin shows through

    pal.color('skin', skin, noise=0.03)
    pal.color('skin_d', skin_d, noise=0.03)
    pal.color('suit', suit, noise=0.06)
    pal.color('suit_l', mul(suit, 2.0), noise=0.06)
    pal.color('shirt', white, noise=0.02)
    pal.stripes('tie', tie_a, tie_b, width=3)
    pal.color('tie_knot', tie_a, noise=0.04)
    pal.color('hair', hair, noise=0.10)
    pal.color('frame', (0.06, 0.06, 0.07), noise=0.02)
    pal.color('lens', (0.72, 0.86, 0.95), noise=0.03)

    S, D, W, P, L, B, H = skin, skin_d, white, pupil, lip, brow, hair
    lg = {'.': S, 'd': D, 'w': W, 'p': P, 'l': L, 'g': B, 'h': H, 'b': bcol, 'm': mcol, 'c': skin_l}
    if not beard:   # Chuck: bald forehead, heavy lids, grey brows, smirk
        upper = ['................',
                 '................',
                 '................',
                 '....dddddddd....',
                 '................',
                 '..ggg......ggg..',
                 '.ggggggg.ggggggg' [0:16],
                 '................',
                 '..dddd....dddd..',
                 '..wppw....wppw..',
                 '..wppw....wppw..',
                 '..dddd....dddd..',
                 '................',
                 '................',
                 '................',
                 '................']
        lower = ['................',
                 '................',
                 '................',
                 '................',
                 '..d..........d..',
                 '...d........d...',
                 '...d.........l..',
                 '............ll..',
                 '....lllllllll...',
                 '................',
                 '......dddd......',
                 '................',
                 '................',
                 '.....dddddd.....',
                 '................',
                 '................']
        side_lo = ['................'] * 16
        side_up = ['................'] * 16
    else:           # Hakeem: sharp hairline, strong brows, moustache and short beard
        upper = ['hhhhhhhhhhhhhhhh',
                 'hhhhhhhhhhhhhhhh',
                 'hhhhhhhhhhhhhhhh',
                 'hh............hh',
                 'hh............hh',
                 'hh............hh',
                 '................',
                 '................',
                 '................',
                 '.wwwww....wwwww.',
                 '.wwppw....wppww.',
                 '.wwppw....wppww.',
                 '................',
                 '................',
                 '................',
                 '................']
        lower = ['................',
                 '................',
                 '................',
                 '................',
                 '................',
                 '....mmmmmmmm....',
                 '...mmmmmmmmmm...',
                 'b..mm......lm..b',
                 'b..m.lllllll.m.b',
                 'bb.m........m.bb',
                 'bb.mm..mm..mm.bb',
                 'bbb.mmmmmmmm.bbb',
                 'bbbbbmmmmmmbbbbb',
                 'bbbbbbbbbbbbbbbb',
                 'bbbbbbbbbbbbbbbb',
                 'bbbbbbbbbbbbbbbb']
        # side faces: front of the head is the LEFT edge of the swatch on both sides
        side_up = ['hhhhhhhhhhhhhhhh'] * 6 + ['..hhhhhhhhhhhhhh'] * 3 + ['.....hhhhhhhhhhh'] * 3 + ['.......hhhhhhhhh'] * 4
        side_lo = ['......bb........'] * 7 + ['b.....bb........'] * 3 + ['bbb...bbb.......'] * 2 + ['bbbbbbbbbb......'] * 4
    pal.pattern('face_up', art(upper, lg))
    pal.pattern('face_lo', art(lower, lg))
    pal.pattern('side_lo', art(side_lo, lg))
    pal.pattern('side_up', art(side_up, lg))

    R, K = (0.80, 0.10, 0.10), (0.15, 0.15, 0.35)
    sticker = ['rrrrrrrrrrrrrrrr',
               'rrrrrrrrrrrrrrrr',
               'rw.w.ww.w.w.wwwr',
               'rwww.w..w.w.w.wr',
               'rw.w.ww.ww.wwwwr'[0:16],
               'rrrrrrrrrrrrrrrr',
               'r..............r',
               'r...kkk.kk.k...r',
               'r..............r',
               'r..k...k..k....r',
               'r.k.k.k.kk.k.k.r',
               'r.k..k..k...k..r',
               'r..............r',
               'r..............r',
               'rrrrrrrrrrrrrrrr',
               'rrrrrrrrrrrrrrrr']
    pal.pattern('sticker', art(sticker, {'r': R, 'w': white, '.': white, 'k': K}))
    SU, SD, BT = suit, mul(suit, 0.6), (0.55, 0.55, 0.58)
    front = ['ssssssssssssssss'] * 1 + ['sswwwsssssssssss', 'ss...sssssssssss'] + ['ssssssssssssssss'] * 4 + \
            ['sssssssddsssssss'] * 2 + ['sssssssdOsssssss', 'sssssssddsssssss', 'sssssssddsssssss',
                                        'sssssssdOsssssss', 'sssssssddsssssss', 'sssssssddsssssss', 'sssssssddsssssss']
    pal.pattern('suit_front', art(front, {'s': SU, '.': SD, 'w': white, 'd': SD, 'O': BT}))
    pal.pattern('knuckles', art(['................'] * 4 + ['ddd.ddd..ddd.ddd'] + ['................'] * 11, lg))

    # ------------------------------------------------------------ torso (root)
    torso = Part(name, (0, 0, 0))
    tcol = lambda f: 'suit_front' if f.normal.y < -0.7 else 'suit'
    box(torso, pal, tcol, (15.2, 9.0, 19.6), (0, 0, 9.8))
    box(torso, pal, 'suit', (22.0, 9.0, 3.2), (0, 0, 21.2), taper=(0.40, 0.75))          # shoulder yoke
    box(torso, pal, 'shirt', (6.6, 6.4, 1.3), (0, -0.4, 23.0), taper=(0.9, 0.9))        # collar
    profile(torso, pal, 'shirt', [(-3.0, 22.6), (3.0, 22.6), (0, 11.5)], 0.5, loc=(0, -4.5, 0), plane='XZ')
    for sx in (-1, 1):                                                                   # lapels
        profile(torso, pal, 'suit_l', [(sx * 2.9, 22.7), (sx * 4.8, 19.0), (sx * 0.3, 11.2)], 0.9,
                loc=(0, -4.5, 0), plane='XZ')
    box(torso, pal, 'tie', (2.6, 0.5, 8.6), (0, -4.85, 16.6), taper=(0.55, 1))          # tie blade
    box(torso, pal, 'tie_knot', (1.5, 0.9, 1.7), (0, -4.7, 21.6), taper=(1.5, 1))       # knot
    scol = lambda f: 'sticker' if f.normal.y < -0.7 else 'shirt'
    box(torso, pal, scol, (3.8, 0.4, 3.6), (5.55, -4.6, 17.6), rot=(0, -5, 0))           # name sticker (their left)

    # ------------------------------------------------------------ head
    head = Part('Head', (0, 0, 23.0), parent=torso)
    HY = -0.4
    top = 36.0 if bald else 35.3
    box(head, pal, 'skin_d', (4.8, 4.8, 3.4), (0, 0.2, 24.5))                            # neck
    lo_col = lambda f: 'face_lo' if f.normal.y < -0.7 else ('side_lo' if abs(f.normal.x) > 0.7 else 'skin')
    jaw_w = 6.6 if beard else 6.0
    box(head, pal, lo_col, (jaw_w, 6.6, 5.0), (0, HY + 0.1, 27.5), taper=(8.5 / jaw_w, 8.0 / 6.6), shear=(0, -0.1))
    back = 'skin' if bald else 'hair'
    up_col = lambda f: 'face_up' if f.normal.y < -0.7 else ('side_up' if abs(f.normal.x) > 0.7 else
                                                            (back if f.normal.y > 0.7 or f.normal.z > 0.7 else 'skin'))
    box(head, pal, up_col, (8.5, 8.0, top - 30.0), (0, HY, (top + 30.0) / 2), taper=(0.84, 0.86) if bald else (0.94, 0.94))
    FY = HY - 4.0                                                                        # face plane y
    if beard:   # Hakeem: broader, shorter nose
        profile(head, pal, 'skin_d', [(FY + 0.1, 31.5), (FY - 1.6, 29.5), (FY - 1.3, 28.9), (FY + 0.1, 28.8)], 2.3, side_color='skin')
    else:       # Chuck: long prominent nose
        profile(head, pal, 'skin_d', [(FY + 0.1, 32.6), (FY - 3.0, 29.2), (FY - 2.5, 28.5), (FY + 0.1, 28.3)], 2.1,
                side_color='skin')
    for sx in (-1, 1):                                                                   # ears
        box(head, pal, 'skin_d', (0.9, 1.5, 3.0 if not beard else 2.5), (sx * 4.6, HY + 0.4, 30.8), taper=(1, 1.3))
    if bald:    # grey hair round the sides and back, bald dome
        for sx in (-1, 1):
            box(head, pal, 'hair', (1.7, 6.6, 4.0), (sx * 4.2, HY + 1.2, 33.3), taper=(0.6, 0.85), shear=(-sx * 0.55, 0))
        box(head, pal, 'hair', (8.6, 1.2, 5.6), (0, HY + 3.9, 31.9), taper=(0.85, 0.6), shear=(0, -0.5))
    else:       # cropped dark cap with a square hairline
        box(head, pal, 'hair', (8.3, 7.9, 0.9), (0, HY, 35.55), taper=(0.9, 0.9))
        for sx in (-1, 1):
            box(head, pal, 'hair', (2.9, 0.5, 0.6), (sx * 2.05, FY - 0.15, 33.25), rot=(0, sx * 5, 0))  # brows
    if glasses:  # half-moon readers far down the nose
        GY, GZ0, GZ1 = FY - 2.2, 28.95, 30.45
        t = 0.28
        box(head, pal, 'frame', (9.1, t, t), (0, GY, GZ1))                               # top bar + bridge
        for sx in (-1, 1):
            box(head, pal, 'frame', (3.0, t, t), (sx * 2.45, GY, GZ0))                   # bottom rim
            box(head, pal, 'frame', (t, t, GZ1 - GZ0), (sx * 0.95, GY, (GZ0 + GZ1) / 2))
            box(head, pal, 'frame', (t, t, GZ1 - GZ0), (sx * 3.95, GY, (GZ0 + GZ1) / 2))
            x0, x1 = sorted((sx * 0.95, sx * 3.95))
            poly(head, pal, 'lens', [(x0, GY, GZ0), (x1, GY, GZ0), (x1, GY, GZ1), (x0, GY, GZ1)], [(0, 1, 2, 3)])
            ey, ez = HY + 0.6, 31.9                                                      # temple arm, hooked over the ear
            profile(head, pal, 'frame', [(GY - t / 2, GZ1 - t / 2), (GY - t / 2, GZ1 + t / 2), (ey, ez + t / 2), (ey, ez - t / 2)],
                    t, loc=(sx * 4.48, 0, 0))

    # ------------------------------------------------------------ arms
    for tag, sx in (('Arm_L', 1), ('Arm_R', -1)):
        a = Part(tag, (sx * 9.3, 0.5, 19.6), parent=torso)
        box(a, pal, 'suit', (3.4, 4.6, 8.6), (sx * 9.3, 0.9, 15.9))   # upper arm
        box(a, pal, 'suit', (3.3, 9.6, 3.3), (sx * 9.2, -3.2, 13.3), rot=(-8, 0, 0))     # forearm
        box(a, pal, 'shirt', (3.5, 1.0, 3.5), (sx * 9.1, -7.9, 14.0), rot=(-8, 0, 0))    # cuff
        hx = sx * 8.7
        pcol = lambda f: 'knuckles' if f.normal.z > 0.7 else 'skin'
        box(a, pal, pcol, (4.6, 3.6, 2.2), (hx, -9.6, 14.2))                             # palm, flat on the desk edge
        for i in range(4):                                                               # fingers curled over the edge
            box(a, pal, 'skin_d' if i % 2 else 'skin', (1.05, 1.5, 3.3), (hx + (i - 1.5) * 1.16, -11.9, 13.4))
        box(a, pal, 'skin_d', (1.3, 2.8, 1.4), (hx - sx * 2.75, -10.0, 13.5), rot=(0, 0, sx * 12))  # thumb

    os.makedirs(os.path.join(ROOT, 'assets-src/placeholder'), exist_ok=True)
    info = finish_and_export(pal, None, os.path.join(ROOT, 'assets-src/placeholder/%s.glb' % name.lower()),   # NOT public/models/world: see the top of this file
                             os.path.join(ROOT, 'previews/%s.png' % name.lower()), scale_figure=True)
    dbg = os.environ.get('GIANTS_DEBUG')
    if dbg:  # extra close-ups for checking the face while authoring (not part of the deliverables)
        import bpy
        sc = bpy.context.scene
        cam = sc.camera
        for tag, c, v, scale in (('front', (0, 0, 19), (0, -1, 0.0), 40), ('face', (0, 0, 30), (0.35, -1, 0.1), 16),
                                 ('far', (0, 0, 18), (0.5, -1, 0.3), 150), ('hands', (0, -6, 14), (-0.5, -1, 0.5), 30), ('hf', (-7, 0, 14), (0, -1, 0), 10),
                                 ('side', (0, 0, 30), (-1, -0.3, 0.1), 16)):
            c = Vector(c)
            cam.data.ortho_scale = scale
            cam.location = c + Vector(v).normalized() * 200
            cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.resolution_x = sc.render.resolution_y = 160 if tag == 'far' else 480
            sc.render.filepath = os.path.join(dbg, '%s_%s.png' % (name.lower(), tag))
            bpy.ops.render.render(write_still=True)
    return info


build('Chuck', skin=(0.95, 0.76, 0.66), suit=(0.10, 0.12, 0.22), tie_a=(0.15, 0.35, 0.85), tie_b=(0.08, 0.20, 0.55),
      hair=(0.84, 0.84, 0.86), glasses=True, beard=False, bald=True)
build('Hakeem', skin=(0.50, 0.33, 0.22), suit=(0.12, 0.12, 0.14), tie_a=(0.82, 0.10, 0.10), tie_b=(0.55, 0.05, 0.07),
      hair=(0.09, 0.07, 0.06), glasses=False, beard=True, bald=False)
