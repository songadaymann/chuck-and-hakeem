"""Convert Microsoft Rocketbox avatars (FBX + 2048px TGA) into small PS1-style GLBs.

Run inside Blender:
  Blender -b --factory-startup -P tools/convert_rocketbox.py -- <src_dir> <out_dir> [target_tris] [body_px]

For each avatar folder in <src_dir> (a folder holding <name>.fbx and *_color.tga):
  - strips the face and finger bones (22 bones remain) and renames them without the Bip0x prefix
  - merges the body / head / hair textures into one small atlas, quantised to 15-bit colour
  - decimates the mesh to about target_tris triangles
  - retargets every clip in <src_dir>/anim onto the avatar and removes root drift
  - writes <out_dir>/<name>.glb and a manifest.json
"""
import bpy, sys, os, json, re
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proc_clips

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
TARGET_TRIS = int(argv[2]) if len(argv) > 2 else 1200
BODY_PX = int(argv[3]) if len(argv) > 3 else 128
ONLY = argv[4].split(',') if len(argv) > 4 else None
STEP = 2  # keyframe every 2nd source frame (15 fps)

KEEP = ['Pelvis', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']
for s in ('L', 'R'):
    KEEP += [f'{s} Clavicle', f'{s} UpperArm', f'{s} Forearm', f'{s} Hand',
             f'{s} Thigh', f'{s} Calf', f'{s} Foot', f'{s} Toe0']

CLIPS = {  # output clip name -> source file stem (male set is used for everyone)
    'idle': 'm_idle_neutral_01', 'walk': 'm_walk_neutral', 'run': 'm_run_neutral',
    'cheer': 'm_cheer_01',
}


def short(name):
    return re.sub(r'^Bip\d+ ', '', name)


def import_fbx(path):
    before = set(bpy.data.objects)
    acts = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]


def activate(obj, mode='OBJECT'):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if mode != 'OBJECT':
        bpy.ops.object.mode_set(mode=mode)


def base_image(mat):
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            l = n.inputs['Base Color'].links
            if l and l[0].from_node.type == 'TEX_IMAGE':
                return l[0].from_node.image
    return None


def shrink(img, px):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    fx, fy = w // px, h // px
    if fx >= 1 and fy >= 1 and w % px == 0 and h % px == 0:
        return a.reshape(px, fy, px, fx, 4).mean(axis=(1, 3))
    ys = (np.arange(px) + 0.5) * h / px
    xs = (np.arange(px) + 0.5) * w / px
    return a[ys.astype(int)][:, xs.astype(int)]


def build_atlas(mesh, name):
    """One atlas: body in the left square, head top-right, hair (alpha) bottom-right."""
    B, Hh = BODY_PX, BODY_PX // 2
    atlas = np.zeros((B, B + Hh, 4), dtype=np.float32)
    atlas[..., 3] = 1.0
    cells = {}  # material index -> (u0, v0, scale_u, scale_v)
    W, H = B + Hh, B
    notes = []
    for i, mat in enumerate(mesh.data.materials):
        img = base_image(mat)
        kind = 'head' if mat.name.endswith('_head') else 'opacity' if 'opacity' in mat.name else 'body'
        if kind == 'body':
            x, y, px = 0, 0, B
        elif kind == 'head':
            x, y, px = B, Hh, Hh
        else:
            x, y, px = B, 0, Hh
        if img is None or img.size[0] == 0:
            notes.append(f'no texture for {mat.name}')
        else:
            t = shrink(img, px)
            if kind != 'opacity':
                t[..., 3] = 1.0
            atlas[y:y + px, x:x + px] = t
        cells[i] = (x / W, y / H, px / W, px / H)
    atlas[..., :3] = np.round(atlas[..., :3] * 31) / 31  # 15-bit colour
    atlas[..., 3] = (atlas[..., 3] > 0.5).astype(np.float32)  # 1-bit alpha

    uv = mesh.data.uv_layers.active.data
    out_of_range = 0
    for poly in mesh.data.polygons:
        u0, v0, su, sv = cells[poly.material_index]
        for li in poly.loop_indices:
            u, v = uv[li].uv
            if u < 0 or u > 1 or v < 0 or v > 1:
                out_of_range += 1
                u, v = u % 1.0, v % 1.0
            uv[li].uv = (u0 + u * su, v0 + v * sv)
    if out_of_range:
        notes.append(f'{out_of_range} UVs wrapped')

    img = bpy.data.images.new(name + '_atlas', W, H, alpha=True)
    img.pixels.foreach_set(atlas.reshape(-1))
    img.filepath_raw = os.path.join(OUT, name + '_atlas.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    mesh.data.materials.clear()
    mesh.data.materials.append(mat)
    for poly in mesh.data.polygons:
        poly.material_index = 0
    return notes


def strip_bones(arm, mesh):
    for b in arm.data.bones:
        b.name = short(b.name)
    parent_of = {}
    for b in arm.data.bones:
        if b.name not in KEEP:
            p = b.parent
            while p and p.name not in KEEP:
                p = p.parent
            parent_of[b.name] = p.name if p else 'Pelvis'
    gi = {g.index: g.name for g in mesh.vertex_groups}
    moves = []
    for v in mesh.data.vertices:
        for g in v.groups:
            n = gi[g.group]
            if n in parent_of and g.weight > 0:
                moves.append((v.index, parent_of[n], g.weight))
    for vi, tgt, w in moves:
        (mesh.vertex_groups.get(tgt) or mesh.vertex_groups.new(name=tgt)).add([vi], w, 'ADD')
    for n in parent_of:
        g = mesh.vertex_groups.get(n)
        if g:
            mesh.vertex_groups.remove(g)
    activate(arm, 'EDIT')
    for n in parent_of:
        eb = arm.data.edit_bones.get(n)
        if eb:
            arm.data.edit_bones.remove(eb)
    tool = arm.data.edit_bones.new('Tool')  # root-level bone that tool meshes attach to
    tool.head, tool.tail = (0, 0, 0), (0, 10, 0)
    bpy.ops.object.mode_set(mode='OBJECT')


def leg_len(arm, find):
    t, f = find(arm, 'Thigh'), find(arm, 'Foot')
    return (arm.matrix_world @ t.head_local - arm.matrix_world @ f.head_local).length


def retarget(arm, clip, src_path, rig):
    new, acts = import_fbx(src_path)
    src = next(o for o in new if o.type == 'ARMATURE')
    sact = src.animation_data.action
    f0, f1 = (int(round(x)) for x in sact.frame_range)

    def find(a, part):
        return next(b for b in a.data.bones if short(b.name) == 'L ' + part)
    src.scale = src.scale * (leg_len(arm, find) / leg_len(src, find))
    src_names = {short(b.name): b.name for b in src.data.bones}

    activate(arm, 'POSE')
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        if pb.name == 'Tool':
            continue
        c = pb.constraints.new('COPY_ROTATION')
        c.target, c.subtarget = src, src_names[pb.name]
        if pb.name == 'Pelvis':
            c = pb.constraints.new('COPY_LOCATION')
            c.target, c.subtarget = src, src_names[pb.name]
        try:
            pb.select = True
        except AttributeError:
            pb.bone.select = True
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = f0, f1
    arm.animation_data_create()
    arm.animation_data.action = None
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=STEP, only_selected=False, visual_keying=True,
                     clear_constraints=True, use_current_action=False, bake_types={'POSE'})
    act = arm.animation_data.action
    act.name = clip
    bpy.ops.object.mode_set(mode='OBJECT')

    # remove root drift so walk / run loop in place
    drift = 0.0
    fcs = [fc for fc in iter_fcurves(act) if fc.data_path == 'pose.bones["Pelvis"].location']
    for fc in fcs:
        k = fc.keyframe_points
        a, b = k[0].co[1], k[-1].co[1]
        x0, x1 = k[0].co[0], k[-1].co[0]
        drift = max(drift, abs(b - a))
    if drift * arm.scale[0] > 0.25:
        for fc in fcs:
            k = fc.keyframe_points
            a, b, x0, x1 = k[0].co[1], k[-1].co[1], k[0].co[0], k[-1].co[0]
            for p in k:
                d = (b - a) * (p.co[0] - x0) / (x1 - x0)
                p.co[1] -= d
                p.handle_left[1] -= d
                p.handle_right[1] -= d
    # drop scale curves, keep rotation everywhere and location on the pelvis only
    for fc in list(iter_fcurves(act)):
        if fc.data_path.endswith('.scale') or (fc.data_path.endswith('.location') and '"Pelvis"' not in fc.data_path and '"Tool"' not in fc.data_path):
            remove_fcurve(act, fc)

    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in acts:
        bpy.data.actions.remove(a)
    proc_clips.key_carry(rig, act, f0, f1, STEP)
    return act, (f0, f1), drift * arm.scale[0]


def iter_fcurves(act):
    if hasattr(act, 'layers') and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    yield from list(cb.fcurves)
    else:
        yield from list(act.fcurves)


def remove_fcurve(act, fc):
    if hasattr(act, 'layers') and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    if fc in list(cb.fcurves):
                        cb.fcurves.remove(fc)
                        return
    else:
        act.fcurves.remove(fc)


def convert(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = os.path.join(SRC, name)
    new, acts = import_fbx(os.path.join(folder, name + '.fbx'))
    arm = next(o for o in new if o.type == 'ARMATURE')
    mesh = next(o for o in new if o.type == 'MESH')
    for o in new:
        if o not in (arm, mesh):
            bpy.data.objects.remove(o, do_unlink=True)
    arm.animation_data_clear()
    for a in acts:
        bpy.data.actions.remove(a)
    arm.name, mesh.name = name + '_rig', name

    mesh.data.calc_loop_triangles()
    src_tris = len(mesh.data.loop_triangles)
    notes = build_atlas(mesh, name)
    strip_bones(arm, mesh)

    activate(mesh)
    m = mesh.modifiers.new('dec', 'DECIMATE')
    m.ratio = min(1.0, TARGET_TRIS / src_tris)
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    mesh.data.calc_loop_triangles()
    tris = len(mesh.data.loop_triangles)
    for p in mesh.data.polygons:
        p.use_smooth = True

    height = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)
    rig = proc_clips.Rig(arm, height)
    clips = {}
    baked = []
    for clip, stem in CLIPS.items():
        p = os.path.join(SRC, 'anim', stem + '.max.fbx')
        if not os.path.exists(p):
            continue
        act, rng, drift = retarget(arm, clip, p, rig)
        baked.append((clip, act, rng))
        clips[clip] = {'frames': rng[1] - rng[0] + 1, 'drift_m': round(drift, 2)}
    lib = {c: a for c, a, r in baked}
    for clip, spec in proc_clips.CLIPS.items():
        if 'base' in spec and spec['base'] not in lib:
            continue
        act, rng, miss = proc_clips.make_clip(rig, clip, lib.get(spec.get('base')))
        baked.append((clip, act, rng))
        clips[clip] = {'frames': rng[1] - rng[0] + 1, 'reach_miss_m': round(max(miss, 0), 3)}
    arm.animation_data.action = None
    for clip, act, rng in baked:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = clip
        st = tr.strips.new(clip, rng[0], act)
        st.name = clip

    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    out = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                              export_animations=True, export_animation_mode='NLA_TRACKS',
                              export_skins=True, export_yup=True, export_tangents=False,
                              export_morph=False)
    os.remove(os.path.join(OUT, name + '_atlas.png'))
    h = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)
    return {'name': name, 'file': name + '.glb', 'kb': round(os.path.getsize(out) / 1024),
            'source_tris': src_tris, 'tris': tris, 'bones': len(arm.data.bones),
            'height_m': round(h, 2), 'clips': clips, 'notes': notes}


os.makedirs(OUT, exist_ok=True)
names = sorted(d for d in os.listdir(SRC)
               if os.path.exists(os.path.join(SRC, d, d + '.fbx')) and (not ONLY or d in ONLY))
manifest = []
for n in names:
    r = convert(n)
    print('CONVERTED', json.dumps(r))
    manifest.append(r)
mp = os.path.join(OUT, 'manifest.json')
if ONLY and os.path.exists(mp):
    old = [m for m in json.load(open(mp)) if m['name'] not in ONLY]
    manifest = sorted(old + manifest, key=lambda m: m['name'])
json.dump(manifest, open(mp, 'w'), indent=1)
