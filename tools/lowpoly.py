"""Tiny kit for building PS1-style low-poly props in Blender from a script.

Conventions (Blender space): metres, Z up, FRONT of a vehicle faces -Y, the character's right is -X.
All geometry is authored in world coordinates. Parts are pivots: every primitive belongs to a Part,
and finish() joins each Part's primitives into one mesh whose origin is the Part's pivot, parented
like the Part tree, so the game can rotate "Boom", "Wheel_FL" and so on around the right point.

    from lowpoly import *
    reset()
    pal = Palette('shovel')
    pal.color('wood', (0.55, 0.38, 0.2)); pal.color('steel', (0.6, 0.62, 0.65))
    root = Part('Shovel', (0, 0, 0))
    cyl(root, pal, 'wood', radius=0.02, length=1.1, axis='Z', loc=(0, 0, 0.55), segs=5)
    finish_and_export(pal, [root], out_glb, preview_png)
"""
import bpy, bmesh, os, math
import numpy as np
from mathutils import Vector, Matrix, Euler

__all__ = ['reset', 'Palette', 'Part', 'box', 'cyl', 'profile', 'poly', 'finish_and_export', 'to_tool_frame', 'animate', 'ram',
           'PUSH_HANDLE', 'Vector', 'Matrix', 'Euler', 'math']

CELL, GRID = 16, 8


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    Part.all.clear()
    ANIMS.clear()
    RAMS.clear()


FPS = 15
ANIMS = {}
RAMS = []


def animate(clip, seconds, keys, linear=()):
    """Register a looping clip that is baked into the GLB. Call before finish_and_export.

    keys = {part_name: [(t, {'rot': (rx, ry, rz), 'loc': (dx, dy, dz)}), ...]} with t from 0 to 1.
    rot is in degrees about the WORLD axes through the part's pivot, relative to the rest pose and to its
    parent (children follow their parent automatically). loc is a metre offset from rest. Either may be omitted.
    The pose at t=0 is repeated at t=1 unless you give a t=1 key. Motion eases between keys; part names
    listed in `linear` use straight interpolation instead (use it for continuous spins: 0 -> 360).
    Right-hand rule about +X: a part reaching forward (-Y) swings DOWN for positive rx, a part reaching
    back (+Y) swings UP. Positive rz turns the front toward +X.
    """
    ANIMS[clip] = (seconds, keys, set(linear))


def ram(pal, name, base_part, base_point, tip_part, tip_point, color, rod_color, radius=0.07, segs=5, barrel=0.62):
    """Telescoping hydraulic ram between a point on one part and a point on another (world coords, rest pose).
    Makes '<name>_Barrel' hinged at base_point on base_part and '<name>_Rod' hinged at tip_point on tip_part;
    in every clip both are re-aimed at each other each frame, so the ram stays attached while it extends.
    Each half is `barrel` x the rest length, so keep the animated length between about 0.7 and 1.2 of rest."""
    A, B = Vector(base_point), Vector(tip_point)
    L = (B - A).length
    pb = Part(name + '_Barrel', A, base_part)
    pr = Part(name + '_Rod', B, tip_part)
    for part, start, d, r, col in ((pb, A, (B - A).normalized(), radius, color), (pr, B, (A - B).normalized(), radius * 0.55, rod_color)):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=L * barrel)
        M = Matrix.Translation(start + d * (L * barrel / 2)) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        _emit(part, pal, col, bm, M)
    RAMS.append((pb, A, pr, B))
    return pb, pr


class Palette:
    """One 128x128 texture of 16px swatches. Colours are sRGB 0..1. Faces stretch a swatch over themselves."""

    def __init__(self, name, seed=7):
        self.name = name
        self.px = np.zeros((CELL * GRID, CELL * GRID, 4), dtype=np.float32)
        self.px[..., 3] = 1
        self.cells = {}
        self.rng = np.random.default_rng(seed)
        self.mat = None

    def _cell(self, key):
        if key in self.cells:
            raise ValueError('duplicate swatch ' + key)
        i = len(self.cells)
        if i >= GRID * GRID:
            raise ValueError('palette full (64 swatches)')
        self.cells[key] = (i % GRID, i // GRID)
        x, y = self.cells[key]
        return self.px[y * CELL:(y + 1) * CELL, x * CELL:(x + 1) * CELL]

    def color(self, key, rgb, noise=0.07, grime=0.0):
        """Flat colour with pixel noise; grime > 0 darkens toward the bottom of the swatch (dirt, wear)."""
        c = self._cell(key)
        n = self.rng.normal(0, noise, (CELL, CELL, 1))
        g = np.linspace(grime, 0, CELL).reshape(CELL, 1, 1) * self.rng.uniform(0.5, 1.0, (CELL, CELL, 1))
        c[..., :3] = np.clip(np.array(rgb) * (1 + n) * (1 - g), 0, 1)
        return key

    def stripes(self, key, rgb_a, rgb_b, width=4, diagonal=True, noise=0.04):
        """Two-colour stripes (hazard tape, grilles, treads). diagonal=False gives horizontal bands."""
        c = self._cell(key)
        yy, xx = np.mgrid[0:CELL, 0:CELL]
        m = (((xx + yy) if diagonal else yy) // width) % 2
        n = self.rng.normal(0, noise, (CELL, CELL, 1))
        c[..., :3] = np.clip(np.where(m[..., None] == 0, np.array(rgb_a), np.array(rgb_b)) * (1 + n), 0, 1)
        return key

    def pattern(self, key, fn):
        """fn(x, y) -> (r, g, b) for x, y in 0..15 (y up). For windows, rivets, logos, dials."""
        c = self._cell(key)
        for y in range(CELL):
            for x in range(CELL):
                c[y, x, :3] = fn(x, y)
        return key

    def rect(self, key):
        x, y = self.cells[key]
        e = 0.5 / (CELL * GRID)
        return x / GRID + e, y / GRID + e, (x + 1) / GRID - e, (y + 1) / GRID - e

    def material(self):
        if self.mat:
            return self.mat
        px = self.px.copy()
        px[..., :3] = np.round(px[..., :3] * 31) / 31  # 15-bit colour
        img = bpy.data.images.new(self.name + '_tex', CELL * GRID, CELL * GRID, alpha=False)
        img.pixels.foreach_set(px.reshape(-1))
        img.filepath_raw = os.path.join(bpy.app.tempdir, self.name + '_tex.png')
        img.file_format = 'PNG'
        img.save()
        img.pack()
        mat = bpy.data.materials.new(self.name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.interpolation = 'Closest'
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 1.0
        self.mat = mat
        return mat


class Part:
    """A pivot. pivot is in world coordinates. A Part with no primitives exports as an empty marker node."""
    all = []

    def __init__(self, name, pivot=(0, 0, 0), parent=None):
        self.name, self.pivot, self.parent = name, Vector(pivot), parent
        self.objs = []
        self.obj = None
        Part.all.append(self)


def _rot(rot):
    return Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()


def _emit(part, pal, color, bm, M):
    """Bake transform, write UVs (each face stretched over its swatch), link the object."""
    bm.transform(M)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        key = color(f) if callable(color) else color
        u0, v0, u1, v1 = pal.rect(key)
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        if ax != 2:  # keep world Z as texture "up" on side faces
            a, b = (a, b) if b == 2 else (b, a)
        cs = [(l.vert.co[a], l.vert.co[b]) for l in f.loops]
        amin, amax = min(c[0] for c in cs), max(c[0] for c in cs)
        bmin, bmax = min(c[1] for c in cs), max(c[1] for c in cs)
        for l, (ca, cb) in zip(f.loops, cs):
            l[uvl].uv = (u0 + (u1 - u0) * ((ca - amin) / (amax - amin) if amax > amin else 0.5),
                         v0 + (v1 - v0) * ((cb - bmin) / (bmax - bmin) if bmax > bmin else 0.5))
    me = bpy.data.meshes.new(part.name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(pal.material())
    ob = bpy.data.objects.new(part.name, me)
    bpy.context.scene.collection.objects.link(ob)
    part.objs.append(ob)
    return ob


def box(part, pal, color, size, loc, rot=(0, 0, 0), taper=(1, 1), shear=(0, 0)):
    """Box centred at loc. taper=(sx, sy) scales the top face; shear=(dx, dy) slides the top face (metres).
    color may be a swatch key or a function(face) -> key."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= sx * (taper[0] if top else 1)
        v.co.y *= sy * (taper[1] if top else 1)
        v.co.z *= sz
        if top:
            v.co.x += shear[0]
            v.co.y += shear[1]
    return _emit(part, pal, color, bm, Matrix.Translation(loc) @ _rot(rot))


def cyl(part, pal, color, radius, length, loc, axis='Z', segs=8, radius2=None, cap_color=None, rot=(0, 0, 0)):
    """Cylinder / cone centred at loc, along axis. radius2 is the far-end radius. Keep segs low (5-10)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=radius,
                          radius2=radius if radius2 is None else radius2, depth=length)
    A = {'Z': Matrix.Identity(4), 'X': Matrix.Rotation(math.radians(90), 4, 'Y'),
         'Y': Matrix.Rotation(math.radians(-90), 4, 'X')}[axis]
    col = color
    if cap_color:
        M3 = (_rot(rot) @ A).to_3x3()
        axis_w = (M3 @ Vector((0, 0, 1))).normalized()
        col = lambda f: cap_color if abs(f.normal.dot(axis_w)) > 0.9 else color
    return _emit(part, pal, col, bm, Matrix.Translation(loc) @ _rot(rot) @ A)


def profile(part, pal, color, pts, width, loc=(0, 0, 0), plane='YZ', rot=(0, 0, 0), side_color=None):
    """Extrude a 2D outline (list of (a, b) points, any winding, convex or not) across `width`, centred.
    plane 'YZ' extrudes along X (side silhouettes: cabs, booms, buckets, blades); 'XZ' along Y; 'XY' along Z."""
    bm = bmesh.new()

    def p3(a, b, w):
        return {'YZ': (w, a, b), 'XZ': (a, w, b), 'XY': (a, b, w)}[plane]
    front = [bm.verts.new(p3(a, b, -width / 2)) for a, b in pts]
    back = [bm.verts.new(p3(a, b, width / 2)) for a, b in pts]
    f1 = bm.faces.new(front)
    f2 = bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        bm.faces.new((front[i], back[i], back[(i + 1) % n], front[(i + 1) % n]))
    bmesh.ops.triangulate(bm, faces=[f1, f2])
    col = color
    if side_color:
        axis_w = _rot(rot).to_3x3() @ Vector({'YZ': (1, 0, 0), 'XZ': (0, 1, 0), 'XY': (0, 0, 1)}[plane])
        col = lambda f: side_color if abs(f.normal.dot(axis_w)) > 0.9 else color
    return _emit(part, pal, col, bm, Matrix.Translation(loc) @ _rot(rot))


def poly(part, pal, color, verts, faces, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Raw mesh from vertex and face lists, for anything the helpers cannot make."""
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    return _emit(part, pal, color, bm, Matrix.Translation(loc) @ _rot(rot))


# The push animation holds a handlebar whose centre is 1.12 m up, with the tool axis pointing
# forward and 44 degrees down. A walk-behind machine authored upright (ground z=0, front -Y,
# handlebar centred at PUSH_HANDLE along X) is moved into the Tool bone's frame with to_tool_frame().
PUSH_HANDLE = Vector((0, 0, 1.12))


def to_tool_frame(parts):
    d = Vector((0, -0.72, -0.70)).normalized()   # authored direction that becomes the tool axis (+Z)
    x = Vector((-1, 0, 0))                       # authored direction that becomes tool +X
    y = d.cross(x)                               # becomes tool +Y
    R = Matrix((x, y, d)).to_4x4()               # rows = new basis
    M = R @ Matrix.Translation(-PUSH_HANDLE)
    for p in parts:
        p.pivot = M @ p.pivot
        for o in p.objs:
            o.data.transform(M)


def _tris(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def finish_and_export(pal, parts=None, out_glb=None, preview_png=None, scale_figure=True):
    """Join each Part into one mesh at its pivot, parent them, export a GLB, render a 3-view preview.
    Returns {'tris': total, 'parts': {name: tris}, 'size': (x, y, z)}."""
    parts = Part.all
    for p in parts:
        if p.objs:
            for o in bpy.context.scene.objects:
                o.select_set(False)
            for o in p.objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = p.objs[0]
            if len(p.objs) > 1:
                bpy.ops.object.join()
            ob = p.objs[0]
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.triangulate(bm, faces=bm.faces)
            bm.to_mesh(ob.data)
            bm.free()
            ob.data.transform(Matrix.Translation(-p.pivot))
            for poly_ in ob.data.polygons:
                poly_.use_smooth = False
        else:
            ob = bpy.data.objects.new(p.name, None)
            ob.empty_display_size = 0.2
            bpy.context.scene.collection.objects.link(ob)
        ob.name = p.name
        if ob.data:
            ob.data.name = p.name
        ob.location = p.pivot
        p.obj = ob
    bpy.context.view_layer.update()
    for p in parts:
        if p.parent:
            p.obj.parent = p.parent.obj
            p.obj.matrix_parent_inverse = p.parent.obj.matrix_world.inverted()
    bpy.context.view_layer.update()

    clips = _bake_anims(parts)
    meshes = [p.obj for p in parts if p.obj.type == 'MESH']
    info = {'tris': sum(_tris(o) for o in meshes), 'parts': {p.name: (_tris(p.obj) if p.obj.type == 'MESH' else 0) for p in parts}}
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    info['size'] = tuple(round(v, 2) for v in (hi - lo))
    info['min'] = tuple(round(v, 2) for v in lo)
    info['max'] = tuple(round(v, 2) for v in hi)
    info['clips'] = clips

    if out_glb:
        os.makedirs(os.path.dirname(out_glb), exist_ok=True)
        for o in bpy.context.scene.objects:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True, export_yup=True,
                                  export_animations=bool(clips), export_animation_mode='NLA_TRACKS',
                                  export_tangents=False)
        info['kb'] = round(os.path.getsize(out_glb) / 1024, 1)
    if preview_png:
        _solo(parts, None)
        bpy.context.scene.frame_set(0)
        _preview(preview_png, lo, hi, scale_figure, parts=parts, clips=clips)
    print('MODEL_INFO', info)
    return info


def _solo(parts, clip):
    """Leave only one clip's NLA tracks active (None = rest pose)."""
    for p in parts:
        ad = p.obj.animation_data
        if ad:
            for tr in ad.nla_tracks:
                tr.mute = tr.name != clip
            p.obj.update_tag(refresh={'OBJECT', 'TIME'})  # muting alone does not re-evaluate
    bpy.context.view_layer.update()


def _key_action(ob, clip, frames_vals, linear=False):
    """frames_vals: [(frame, {'rotation_euler'|'rotation_quaternion'|'location': value})]"""
    ob.animation_data_create()
    act = bpy.data.actions.new(ob.name + '_' + clip)
    ob.animation_data.action = act
    for f, vals in frames_vals:
        for path, v in vals.items():
            setattr(ob, path, v)
            ob.keyframe_insert(path, frame=f)
    if linear:
        for fc in _fcurves(act):
            for k in fc.keyframe_points:
                k.interpolation = 'LINEAR'
    last = max(f for f, _ in frames_vals)
    ob.animation_data.action = None
    tr = ob.animation_data.nla_tracks.new()
    tr.name = clip
    st = tr.strips.new(clip, 0, act)
    st.name = clip
    return last


def _fcurves(act):
    if hasattr(act, 'layers') and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    yield from list(cb.fcurves)
    else:
        yield from list(act.fcurves)


def _bake_anims(parts):
    if not ANIMS:
        return {}
    sc = bpy.context.scene
    sc.render.fps = FPS
    by_name = {p.name: p for p in parts}
    rest_loc = {p.name: p.obj.location.copy() for p in parts}
    ram_parts = {p.name for r in RAMS for p in (r[0], r[2])}
    out = {}
    for clip, (seconds, keys, linear) in ANIMS.items():
        n = max(2, round(seconds * FPS))
        for name, ks in keys.items():
            if name not in by_name:
                raise ValueError(f'animate({clip!r}): no part named {name!r}')
            if name in ram_parts:
                raise ValueError(f'animate({clip!r}): {name!r} is a ram half and is aimed automatically')
            ks = sorted(ks, key=lambda k: k[0])
            if ks[-1][0] < 1.0:
                ks.append((1.0, ks[0][1]))
            ob = by_name[name].obj
            fv = []
            for t, v in ks:
                d = {}
                if 'rot' in v:
                    d['rotation_euler'] = tuple(math.radians(a) for a in v['rot'])
                if 'loc' in v:
                    d['location'] = rest_loc[name] + Vector(v['loc'])
                fv.append((round(t * n), d))
            _key_action(ob, clip, fv, linear=name in linear)
            ob.rotation_euler = (0, 0, 0)
            ob.location = rest_loc[name]
        out[clip] = {'seconds': seconds, 'frames': n, 'parts': sorted(keys)}
    # telescoping rams: aim each half at the other end, every frame of every clip
    stretch = {}
    for clip in ANIMS:
        n = out[clip]['frames']
        _solo(parts, clip)
        rec = {}
        for f in range(n + 1):
            sc.frame_set(f)
            bpy.context.view_layer.update()
            for pb, A0, pr, B0 in RAMS:
                A = pb.obj.matrix_world.translation.copy()
                B = pr.obj.matrix_world.translation.copy()
                d0 = (B0 - A0).normalized()
                d = (B - A).normalized()
                qa = pb.parent.obj.matrix_world.to_quaternion().inverted() @ d0.rotation_difference(d)
                qb = pr.parent.obj.matrix_world.to_quaternion().inverted() @ (-d0).rotation_difference(-d)
                rec.setdefault(pb.name, []).append((f, {'rotation_quaternion': qa}))
                rec.setdefault(pr.name, []).append((f, {'rotation_quaternion': qb}))
                k = (B - A).length / (B0 - A0).length
                key = pb.name[:-7]
                lo_, hi_ = stretch.get(key, (k, k))
                stretch[key] = (min(lo_, k), max(hi_, k))
        for name, fv in rec.items():
            ob = by_name[name].obj
            ob.rotation_mode = 'QUATERNION'
            _key_action(ob, clip, fv, linear=True)
            ob.rotation_quaternion = (1, 0, 0, 0)
    _solo(parts, None)
    sc.frame_set(0)
    if stretch:
        out['ram_stretch'] = {k: (round(a, 2), round(b, 2)) for k, (a, b) in stretch.items()}
    return out


def _preview(path, lo, hi, scale_figure, parts=None, clips=None):
    sc = bpy.context.scene
    if scale_figure:  # grey 1.8 m person beside the model, for scale only (not exported)
        fx = hi.x + 0.6
        fy = (lo.y + hi.y) / 2
        for size, z in (((0.45, 0.25, 1.5), 0.75), ((0.25, 0.25, 0.3), 1.65)):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(fx, fy, z), scale=size)
        hi = Vector((max(hi.x, fx + 0.25), hi.y, max(hi.z, 1.8)))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = r * 2.1
    cam_d.clip_end = r * 20 + 100
    cam = bpy.data.objects.new('cam', cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_shadows = False
    sc.render.resolution_x = sc.render.resolution_y = 420
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.25, 0.3, 0.38)
    views = [Vector((1.0, -1.3, 0.7)), Vector((-1.2, 1.2, 0.6)), Vector((-1.0, 0.0, 0.05)), Vector((0.0, -0.2, 1.0))]
    imgs = []
    for i, v in enumerate(views):
        cam.location = c + v.normalized() * (r * 6 + 10)
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(bpy.app.tempdir, f'view{i}.png')
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(sc.render.filepath)
        a = np.empty(420 * 420 * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(420, 420, 4))
    sheet = np.concatenate(imgs, axis=1)
    rows = [sheet]
    for clip, meta in (clips or {}).items():  # one extra row per clip: 4 moments, three-quarter view
        if clip == 'ram_stretch':
            continue
        _solo(parts, clip)
        strip = []
        for i in range(4):
            sc.frame_set(round(meta['frames'] * i / 4))
            v = views[2] if i % 2 else views[0]
            cam.location = c + v.normalized() * (r * 6 + 10)
            cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(bpy.app.tempdir, f'anim{i}.png')
            bpy.ops.render.render(write_still=True)
            im = bpy.data.images.load(sc.render.filepath)
            a = np.empty(420 * 420 * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            strip.append(a.reshape(420, 420, 4))
        rows.insert(0, np.concatenate(strip, axis=1))  # image rows are bottom-up, so this lands below
        _solo(parts, None)
    sheet = np.concatenate(rows, axis=0)
    out = bpy.data.images.new('sheet', 420 * len(views), 420 * len(rows), alpha=False)
    out.pixels.foreach_set(sheet.reshape(-1))
    out.filepath_raw = path
    out.file_format = 'PNG'
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save()
