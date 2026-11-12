"""The real busts: public/models/world/chuck.glb and hakeem.glb, made from two Meshy scans.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/models/busts.py -- [options]

    --only chuck|hakeem   build one man (default: both)
    --no-arms             leave out Arm_L / Arm_R (src/plugins/giants.js copes without them)
    --tex 256             side of the square texture in pixels (256; 512 is the most the look allows)
    --tris-head N / --tris-torso N   override the triangle budgets in MEN below
    --src-chuck PATH / --src-hakeem PATH   the scans (default: assets-src/meshy/<man>_source.glb)
    --out DIR             where the GLBs go (default: public/models/world)
    --debug DIR           also write the texture atlas as <man>_atlas.png and a few numbers there
    --set key=number      try another value for one of the numbers in MEN (repeatable), e.g. --set head_scale=1.3

Sources (git-ignored): assets-src/meshy/chuck_source.glb  = "Meshy_AI_Capitol_Address"  (1.47 M triangles, microphone)
                       assets-src/meshy/hakeem_source.glb = "Meshy_AI_Statesman_in_Blue" (377 k triangles)
The old box-built placeholders are still made by tools/models/giants.py, which now writes to assets-src/placeholder/.

WHAT COMES OUT (the contract with the game: shared/config.js `giant`, shared/grid.js floorAt, src/main.js, src/plugins/giants.js)
  glTF, metres, Y up, front faces +Z, standing on y=0, 36 m to the top of the head.
  Root node 'Chuck' / 'Hakeem' = torso mesh. Children: 'Head' (origin at the base of the neck, on the root's vertical axis:
  the game turns and nods it), 'Arm_L' (+X) and 'Arm_R' (-X) (origin at the ELBOW: the game swings them about X, so the
  forearms paddle; the upper arms are the scan's own, or the jacket's sides).
  The server lets players stand on a circle r 4.5 at y=35.5 (the head) and an ellipse 11 x 4.5 at y=24 (the shoulders),
  so the head is laid out about 10 m wide with its crown at exactly 36, and the shoulders 22 m across with their ridge
  just over 24. The build prints a map of how the mesh sits against those surfaces.
  One 8-bit palette PNG, one material (metal 0, rough 1, single sided), no normal or metal maps; about 4,200 triangles
  and 160 KB a man. The game swaps the material for a Lambert one with nearest-neighbour filtering (src/ps1.js).

HOW (everything runs in the scan's own space until `layout`; Blender axes: X = his left, -Y = front, Z = up)
  1 load      import, weld, drop loose shells (Chuck's microphone is a separate shell: deleting it leaves a clean tie).
  2 mid       collapse to ~100 k triangles once (cached in assets-src/meshy/cache/) so the cutting is quick.
  3 split     cut the head off along a tilted plane just above the shirt collar; drop the scan's flat underside.
  4 low       wrap the head in one clean skin (`envelope`: spectacle frames and stray hair become ridges on it), iron
              the hair flat, then collapse head and torso to their budgets with a vertex weight that keeps triangles
              on the face and on the collar, tie and lapels.
  5 seal      the neck goes on down inside the collar as a funnel to a point under the pivot (so the head can turn a
              full radian and tip back 0.6 with no gap and no edge showing); holes are capped.
  6 layout    to game metres. The head, neck and shirt collar are scaled up together about the neck (head_scale) and
              blend into shoulders of natural size. The body far from the collar is squared to the front, squashed a
              little front to back, and slid so the shoulders' ridge sits on y=24 under the root's axis (in effect he
              shrugs and stands straighter). The skull is brought over the neck; its dome keeps its own shape except
              where it falls more than stand_gap under the server's flat standing circle (see layout).
  7 extend    the scan stops at the chest or waist: its bottom rim is extruded to y=0 as a tapering jacket.
  8 arms      forearm, cuff and fist per side, hinged at the elbow.
  9 unwrap    fresh UVs (minimum-stretch): head front, head back, torso front, torso back, the rest; the face gets
              most of the pixels.
 10 bake      every texel is traced back to the ORIGINAL scan (through the position it had before step 6) and takes the
              scan's base colour there; made-up surfaces are smeared from the nearest rim of the scan (the jacket:
              with the shirt's V closed and the tie brought to a point) or painted (neck, arms, caps, Chuck's eyes).
 11 write     palette PNG + GLB by hand (no exporter involved), then the report. Normals are written to suit the game's
              light, which has almost nothing coming from below: the head is smooth with nothing pointing far down,
              and the neck's funnel and the hole it stands in are shaded as the neck's wall.

AFTER A REBUILD raise the ?v= number on the model's address in src/main.js (the files are cached for a day), and look at
him in the game: buried, dug out, head turned and tipped back (the build prints how the neck holds at the extremes).
"""
import bpy, bmesh, sys, os, math, json, struct, zlib, time
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC_DIR = os.path.join(ROOT, 'assets-src', 'meshy')
OUT_DIR = os.path.join(ROOT, 'public', 'models', 'world')

# The game's numbers (shared/config.js `giant`). Do not change them here: the live server uses the same ones.
G = dict(height=36.0, shoulderY=24.0, torsoRX=11.0, torsoRZ=4.5, headR=4.5)
HEAD_CREASE = 180  # degrees: edges on the head sharper than this are shaded as creases. 180 = none: the folds beside the nostrils, shaded hard, drew a black gash under the nose
RIDGE_OVER = 0.5   # the shoulders' ridge is put this far above y=24: shoulders slope, so the ridge sinks players to the ankle and the slopes float them less

# Per man. Lengths marked (scan) are in the scan's own units (the busts are about 1.9 wide); the rest are game metres.
MEN = {
    'chuck': dict(
        node='Chuck', drop_loose=True, mid_tris=120000,
        envelope=True,            # his glasses stand clear of his face: wrap the head in one skin before cutting it down
        neck_p=(0.05, 0.0, 0.0), neck_n=(0.0, -0.49, 1.0),   # (scan) the cut: a point on it and its normal (tilted: collars sit higher at the back)
        tris_head=2600, tris_torso=1000,
        head_scale=1.36,          # head + neck + collar against the shoulders
        blend=(0.30, 0.80),       # (scan) distance from the neck over which the scaled-up collar fades into the natural body
        depth=0.86,               # front-to-back squash of the body (the server's shoulders are only 9 m deep)
        shoulder_at=0.6,          # metres behind the root's axis where the shoulders' ridge is put
        flat_top=0.0, stand_gap=1.5,   # the top of the head against the server's flat standing circle (see layout): natural dome, low spots lifted to within 1.5 m
        shoulder_band=(0.48, 0.80),   # (scan, |x| from the body's middle) the stretch of shoulder that must sit at y=24
        jacket=[(0.50, 0.95, 0.96), (0.0, 0.84, 0.90)],   # rings below the scan's rim: (height as a fraction of the rim's, x scale, depth scale)
        vee=0.42, tie_tip=0.50,   # where the shirt's V closes and where the tie ends, as fractions of the rim's height
        elbow=(8.9, 0.3, 12.6),   # metres: (x, depth (+ = back), height) of the left elbow
        hair_at=(0.07, 0.1, 0.62),   # (scan) a point in his hair
        lenses=[(-0.068, 0.172, 0.066, 0.040), (0.172, 0.172, 0.054, 0.040)],   # (scan: x, height, half width, half height) the inside of each lens of his glasses
        eyes=[(-0.066, 0.192), (0.180, 0.192)],                                # (scan: x, height) where to paint his eyes behind them
        skin_at=(0.07, -0.47, 0.42), suit_at=(0.55, -0.2, -0.45), shirt_at=(-0.12, -0.3, -0.35),   # (scan) where to sample colours for the made-up parts
    ),
    'hakeem': dict(
        node='Hakeem', drop_loose=False, mid_tris=90000,
        envelope=True,            # no glasses, but the wrapped head cuts down cleaner (no folded slivers on the forehead)
        neck_p=(0.0, -0.3, 0.035), neck_n=(0.0, -0.78, 1.0),
        tris_head=2400, tris_torso=1200,
        head_scale=1.2,
        blend=(0.30, 0.80),
        depth=0.86,
        shoulder_at=0.6,
        flat_top=0.0, stand_gap=1.5,
        shoulder_band=(0.48, 0.80),
        jacket=[(0.50, 0.97, 0.97), (0.0, 0.88, 0.92)],
        vee=None, tie_tip=None,
        elbow=(8.9, 0.3, 12.6),
        skin_at=(0.0, -0.5, 0.78), suit_at=(0.55, -0.25, -0.4), shirt_at=(0.10, -0.30, -0.08),   # shirt: beside the tie (a point above the collar reads his neck, and the cuffs come out brown)
    ),
}

SCAN, STUB, EXT, DARK, SLEEVE, CUFF, HAND, THROAT = range(8)                    # what a triangle is, for the texture
R_HEAD_F, R_HEAD_B, R_STUB, R_TORSO_F, R_TORSO_B, R_CAP, R_EXT, R_BOTTOM, R_ARM = range(9)   # which UV chart it belongs to
# How many pixels each chart gets, relative to the face (linear).
TEXEL = {R_HEAD_F: 1.0, R_HEAD_B: 0.5, R_STUB: 0.12, R_TORSO_F: 0.5, R_TORSO_B: 0.26, R_CAP: 0.06, R_EXT: 0.2, R_BOTTOM: 0.05, R_ARM: 0.28}

T0 = time.time()


def log(*a):
    print('[busts %6.1fs]' % (time.time() - T0), *a, flush=True)


def smooth(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ Blender <-> numpy
def mesh_arrays(me):
    me.calc_loop_triangles()
    v = np.empty(len(me.vertices) * 3, np.float64); me.vertices.foreach_get('co', v)
    t = np.empty(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('vertices', t)
    return v.reshape(-1, 3), t.reshape(-1, 3)


def make_mesh(v, t, name='m'):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v)); me.vertices.foreach_set('co', np.asarray(v, np.float32).ravel())
    me.loops.add(len(t) * 3); me.loops.foreach_set('vertex_index', np.asarray(t, np.int32).ravel())
    me.polygons.add(len(t)); me.polygons.foreach_set('loop_start', np.arange(len(t), dtype=np.int32) * 3)
    me.update(calc_edges=True)
    return me


def make_object(v, t, name='m'):
    ob = bpy.data.objects.new(name, make_mesh(v, t, name))
    bpy.context.scene.collection.objects.link(ob)
    return ob


def decimate(v, t, target, weights=None, factor=0.0):
    """Edge-collapse to about `target` triangles. weights: per vertex, 0 = keep detail here .. 1 = spend nothing here
    (Blender locks a vertex of weight 0 outright, so the scale is squeezed into 0.05..1; factor 0.02 moves about a fifth
    of the triangles toward the kept places, 0.2 starves the rest)."""
    if len(t) <= target:
        return v, t
    ob = make_object(v, t, 'dec')
    m = ob.modifiers.new('d', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = target / len(t); m.use_collapse_triangulate = True
    if weights is not None and factor > 0:
        vg = ob.vertex_groups.new(name='w')
        q = np.round((0.05 + 0.95 * np.clip(weights, 0, 1)) * 20).astype(int)
        for k in range(21):
            idx = np.nonzero(q == k)[0]
            if len(idx): vg.add(idx.tolist(), k / 20, 'REPLACE')
        m.vertex_group = 'w'; m.vertex_group_factor = factor
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = bpy.data.meshes.new_from_object(ev)
    out = mesh_arrays(me)
    bpy.data.meshes.remove(me); me0 = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me0)
    return out


def compact(v, t, *per_vertex):
    used = np.unique(t)
    remap = -np.ones(len(v), np.int64); remap[used] = np.arange(len(used))
    return (v[used], remap[t].astype(np.int32)) + tuple(a[used] for a in per_vertex)


def components(t, nv):
    """Label triangles by connected piece (shared vertices)."""
    parent = np.arange(nv)
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b, c in t:
        ra, rb, rc = find(a), find(b), find(c)
        if rb != ra: parent[rb] = ra
        if rc != ra: parent[find(rc)] = ra
    roots = np.array([find(a) for a in t[:, 0]])
    _, lab = np.unique(roots, return_inverse=True)
    return lab


def drop_crumbs(v, t, keep=24):
    lab = components(t, len(v))
    n = np.bincount(lab)
    return compact(v, t[n[lab] >= min(keep, n.max())])


def boundary_loops(t):
    """Open edges chained into loops of vertex indices, each in the direction the faces run along it."""
    e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
    seen = {}
    for a, b in e.tolist():
        seen[(a, b)] = seen.get((a, b), 0) + 1
    nxt = {}
    for (a, b) in seen:
        if (b, a) not in seen:
            nxt.setdefault(a, []).append(b)
    loops = []
    while nxt:
        a0 = next(iter(nxt)); loop = [a0]; a = a0
        while True:
            outs = nxt.get(a)
            if not outs: break
            b = outs.pop()
            if not outs: del nxt[a]
            if b == a0: break
            loop.append(b); a = b
        if len(loop) >= 3: loops.append(loop)
    return loops


def vertex_normals(v, t):
    fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    n = np.zeros_like(v)
    for k in range(3): np.add.at(n, t[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


class Mesh:
    """Triangles in numpy. v = where the points are now; src / srcn = where on the scan each point takes its colour from."""

    def __init__(self, v, t, kind=SCAN, region=0):
        self.v = np.array(v, np.float64); self.t = np.array(t, np.int32).reshape(-1, 3)
        self.src = self.v.copy(); self.srcn = vertex_normals(self.v, self.t) if len(self.t) else np.zeros_like(self.v)
        self.kind = np.full(len(self.t), kind, np.int32); self.region = np.full(len(self.t), region, np.int32)
        self.seam = set()   # extra UV seams, as (vertex, vertex) pairs

    def add(self, v, t, kind, region, src=None, srcn=None):
        """Append points and triangles (t indexes old points below len(self.v), new ones from there on). Returns the index of the first new point."""
        n0 = len(self.v); v = np.asarray(v, np.float64).reshape(-1, 3)
        self.v = np.vstack([self.v, v])
        self.src = np.vstack([self.src, v if src is None else np.asarray(src, np.float64).reshape(-1, 3)])
        self.srcn = np.vstack([self.srcn, np.zeros_like(v) if srcn is None else np.asarray(srcn, np.float64).reshape(-1, 3)])
        t = np.asarray(t, np.int32).reshape(-1, 3)
        self.t = np.vstack([self.t, t]); self.kind = np.concatenate([self.kind, np.full(len(t), kind, np.int32)])
        self.region = np.concatenate([self.region, np.full(len(t), region, np.int32)])
        return n0

    def cap(self, loop, kind, region, src=None, sink=0.0):
        """Close a hole with a fan (its middle pushed `sink` down, so it is a shallow funnel and not a lid)."""
        c = self.v[loop].mean(0) - np.array([0, 0, sink])
        k = self.add([c], [], kind, region, src=None if src is None else [src], srcn=[self.srcn[loop].mean(0)])
        self.add([], [(b, a, k) for a, b in zip(loop, loop[1:] + loop[:1])], kind, region)


def tidy(m, a, b, least=60):
    """Charts a and b were split by a rule per triangle: hand any stray patch smaller than `least` triangles to the other."""
    t = m.t; edge = {}
    for f in range(len(t)):
        for k in range(3):
            edge.setdefault((min(t[f, k], t[f, (k + 1) % 3]), max(t[f, k], t[f, (k + 1) % 3])), []).append(f)
    nb = [[] for _ in range(len(t))]
    for fs in edge.values():
        if len(fs) == 2: nb[fs[0]].append(fs[1]); nb[fs[1]].append(fs[0])
    for _ in range(3):
        seen = np.zeros(len(t), bool)
        for f0 in range(len(t)):
            if seen[f0] or m.region[f0] not in (a, b): continue
            comp = [f0]; seen[f0] = True; i = 0
            while i < len(comp):
                for g in nb[comp[i]]:
                    if not seen[g] and m.region[g] == m.region[f0]: seen[g] = True; comp.append(g)
                i += 1
            if len(comp) < least: m.region[comp] = b if m.region[f0] == a else a


def thin(m, loop, count):
    """Positions in a loop of `count` points spread evenly along its length."""
    p = m.v[loop]; seg = np.linalg.norm(np.roll(p, -1, 0) - p, axis=1); at = np.concatenate([[0], np.cumsum(seg)[:-1]])
    return sorted(set(int(np.argmin(np.abs(at - x))) for x in np.linspace(0, seg.sum(), count, endpoint=False)))


def zipper(m, fine, where, coarse, kind, region):
    """Join a loop of many points to a ring of few. coarse[k] hangs under fine[where[k]]."""
    L = len(fine); M = len(coarse); tri = []
    for k in range(M):
        j0 = where[k]; n = (where[(k + 1) % M] - j0) % L or L; s = (n + 1) // 2
        for e in range(n):
            tri.append((fine[(j0 + e + 1) % L], fine[(j0 + e) % L], coarse[k] if e < s else coarse[(k + 1) % M]))
        tri.append((fine[(j0 + s) % L], coarse[k], coarse[(k + 1) % M]))
    m.add([], tri, kind, region)


# ------------------------------------------------------------------ 1 load
class Scan:
    def __init__(self, path, drop_loose):
        bpy.ops.import_scene.gltf(filepath=path)
        obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        for o in obs: o.select_set(True)
        ob = obs[0]; bpy.context.view_layer.objects.active = ob
        if len(obs) > 1: bpy.ops.object.join()
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-6)
        if drop_loose: bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        parts = sorted([o for o in bpy.context.scene.objects if o.type == 'MESH'], key=lambda o: -len(o.data.polygons))
        for o in parts[1:]:
            log('  dropped a loose shell of', len(o.data.polygons), 'triangles (the microphone)')
            bpy.data.objects.remove(o)
        self.ob = ob = parts[0]; me = ob.data
        img = None
        for nd in me.materials[0].node_tree.nodes:
            if nd.type == 'BSDF_PRINCIPLED' and nd.inputs['Base Color'].links: img = nd.inputs['Base Color'].links[0].from_node.image
        w, h = img.size
        px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)[..., :3]
        while px.shape[0] > 1024:   # the atlas we bake to is far smaller: average 2x2 so each sample sees a fair patch
            px = (px[0::2, 0::2] + px[1::2, 0::2] + px[0::2, 1::2] + px[1::2, 1::2]) * 0.25
        self.px = px
        self.v, _ = mesh_arrays(me)
        n = len(me.polygons)
        ls = np.empty(n, np.int32); me.polygons.foreach_get('loop_start', ls)
        lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lv)
        uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        idx = ls[:, None] + np.arange(3)[None]
        self.t = lv[idx]; self.uv = uv[idx]
        bpy.context.view_layer.update()
        log('  scan:', len(self.t), 'triangles, texture', img.size[:], 'bbox', np.round(self.v.min(0), 3), np.round(self.v.max(0), 3))

    def colour_at(self, face, loc):
        """Base colour (sRGB 0..1) at points `loc` lying on triangles `face`."""
        a, b, c = (self.v[self.t[face, k]] for k in range(3))
        v0, v1, v2 = b - a, c - a, loc - a
        d00 = (v0 * v0).sum(1); d01 = (v0 * v1).sum(1); d11 = (v1 * v1).sum(1); d20 = (v2 * v0).sum(1); d21 = (v2 * v1).sum(1)
        den = np.maximum(d00 * d11 - d01 * d01, 1e-20)
        bv = np.clip((d11 * d20 - d01 * d21) / den, 0, 1); bw = np.clip((d00 * d21 - d01 * d20) / den, 0, 1)
        uv = self.uv[face, 0] * (1 - bv - bw)[:, None] + self.uv[face, 1] * bv[:, None] + self.uv[face, 2] * bw[:, None]
        h, w = self.px.shape[:2]
        x = np.clip(uv[:, 0] * w - 0.5, 0, w - 1.001); y = np.clip(uv[:, 1] * h - 0.5, 0, h - 1.001)
        x0 = x.astype(int); y0 = y.astype(int); fx = (x - x0)[:, None]; fy = (y - y0)[:, None]
        p = self.px
        return (p[y0, x0] * (1 - fx) + p[y0, x0 + 1] * fx) * (1 - fy) + (p[y0 + 1, x0] * (1 - fx) + p[y0 + 1, x0 + 1] * fx) * fy

    def sample(self, pos, nrm, out=0.03, back=0.05):
        """Colour of the scan seen from each point: look in along the normal from just outside; where that finds nothing
        near (or something much farther than the nearest surface: another part of him in the way), take the nearest surface."""
        n = len(pos); face = np.zeros(n, np.int64); loc = np.zeros((n, 3))
        ray, near = self.ob.ray_cast, self.ob.closest_point_on_mesh
        for k in range(n):
            p = Vector(pos[k]); d = Vector(nrm[k])
            ok2, l2, _, f2 = near(p)
            use = False
            if d.length_squared > 0.25:
                ok, l1, _, f1 = ray(p + d * out, -d, distance=out + back)
                if ok and (l1 - p).length <= max(2.5 * (l2 - p).length, 0.012): use = True
            if use: face[k] = f1; loc[k] = l1
            else: face[k] = f2; loc[k] = l2
        return self.colour_at(face, loc)

    def swatch(self, at, r=0.02):
        """Median colour of the scan's surface around a point."""
        rng = np.random.default_rng(1)
        pts = np.asarray(at)[None] + rng.normal(0, r, (60, 3))
        return np.median(self.sample(pts, np.zeros_like(pts)), axis=0)


# ------------------------------------------------------------------ 2 mid
def mid_mesh(scan, src_path, target, cache_dir):
    st = os.stat(src_path)
    f = os.path.join(cache_dir, '%s_mid_%d_%d_%d.npz' % (os.path.splitext(os.path.basename(src_path))[0], st.st_size, int(st.st_mtime), target))
    if os.path.exists(f):
        d = np.load(f); return d['v'], d['t']
    v, t = decimate(scan.v, scan.t, target)
    os.makedirs(cache_dir, exist_ok=True)
    np.savez(f, v=v, t=t)
    return v, t


# ------------------------------------------------------------------ 3 split
def split(v, t, P, N):
    """Cut along the neck plane. Returns (head v, t), (torso v, t); the torso comes back without the scan's flat underside."""
    me = make_mesh(v, t)
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7, plane_co=Vector(P), plane_no=Vector(N), clear_inner=False, clear_outer=False)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table(); bm.faces.index_update(); bm.verts.index_update()
    Pv, Nv = Vector(P), Vector(N)
    above = [(f.calc_center_median() - Pv).dot(Nv) > 0 for f in bm.faces]
    start = max((f for f in bm.faces if above[f.index]), key=lambda f: f.calc_center_median().z)
    head = {start.index}; todo = [start]
    while todo:
        f = todo.pop()
        for e in f.edges:
            for g in e.link_faces:
                if above[g.index] and g.index not in head:
                    head.add(g.index); todo.append(g)
    vv = np.array([p.co[:] for p in bm.verts]); tt = np.array([[p.index for p in f.verts] for f in bm.faces], np.int32)
    bm.free()
    is_head = np.zeros(len(tt), bool); is_head[list(head)] = True
    zmin = vv[:, 2].min()
    fn = np.cross(vv[tt[:, 1]] - vv[tt[:, 0]], vv[tt[:, 2]] - vv[tt[:, 0]]); fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-20)
    flat = (vv[tt][:, :, 2].max(1) < zmin + 0.03) & (fn[:, 2] < -0.7)      # the scan's flat underside: the jacket goes on from its rim instead
    return compact(vv, tt[is_head]), compact(vv, tt[~is_head & ~flat])


# ------------------------------------------------------------------ 4, 5 low + seal
def envelope(v, t, level=6):
    """Shrink-wrap: a fine sphere pulled in onto the head from outside, toward its middle. What comes back is the head's
    outer skin in one clean piece: free-standing spectacle frames and loose strands of hair become ridges ON the head,
    which is the only form in which they survive being cut down to a few thousand triangles. The neck stays open
    (looking up through it you see the inside of the skull, and that is thrown away)."""
    ob = make_object(v, t, 'env'); bpy.context.view_layer.update()
    C = Vector((v.min(0) + v.max(0)) / 2); R = float(np.linalg.norm(v.max(0) - v.min(0)))
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=level, radius=1.0)
    bm.verts.index_update()
    d = [p.co.normalized() for p in bm.verts]; f = np.array([[p.index for p in q.verts] for q in bm.faces], np.int32)
    bm.free()
    out = np.zeros((len(d), 3)); ok = np.zeros(len(d), bool)
    for i, di in enumerate(d):
        hit, loc, nrm, _ = ob.ray_cast(C + di * R, -di, distance=R)
        if hit and nrm.dot(di) >= 0: out[i] = loc; ok[i] = True
    me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return drop_crumbs(*compact(out, f[ok[f].all(1)]))


def calm(v, t, strength, rounds=12):
    """Smooth the surface where strength (per point, 0..1) says so: averages each point with its neighbours."""
    e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]]); e = np.concatenate([e, e[:, ::-1]])
    cnt = np.bincount(e[:, 0], minlength=len(v)).astype(np.float64)[:, None]
    s = strength[:, None]
    for _ in range(rounds):
        acc = np.zeros_like(v); np.add.at(acc, e[:, 0], v[e[:, 1]])
        v = v + s * (acc / np.maximum(cnt, 1) - v)
    return v


def build_head(v, t, cfg, P, N, scan):
    if cfg.get('envelope'):
        v, t = envelope(v, t)
        if cfg.get('hair_at'):
            # strands of hair cost triangles the face needs: iron the hair flat first (hair = the colour found at hair_at)
            col = scan.sample(v, np.zeros_like(v)); hair = scan.swatch(cfg['hair_at'])
            v = calm(v, t, 1 - smooth(0.08, 0.16, np.linalg.norm(col - hair, axis=1)))
    c = (v.min(0) + v.max(0)) / 2
    d = v - c; d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    w = 1 - smooth(-0.25, 0.35, -d[:, 1])                       # the face keeps its triangles, the back of the head pays
    v, t = decimate(v, t, cfg['tris_head'], w, cfg.get('face_bias', 0.02))
    v, t = drop_crumbs(v, t)
    m = Mesh(v, t, SCAN, R_HEAD_F)
    c = (v.min(0) + v.max(0)) / 2
    fc = v[t].mean(1)
    m.region[:] = np.where(fc[:, 1] < c[1] + cfg.get('ear_line', 0.03), R_HEAD_F, R_HEAD_B)
    tidy(m, R_HEAD_F, R_HEAD_B)
    h = (m.v - P) @ N
    loops = sorted(boundary_loops(m.t), key=len, reverse=True)
    for li, loop in enumerate(loops):
        log('    head hole:', len(loop), 'points, off the neck plane', np.round(np.abs(h[loop]).max(), 3))
        ring = li == 0 and np.abs(h[loop]).max() < 0.06 and len(loop) >= 6
        if not ring:
            m.cap(loop, SCAN, m.region[0]); continue
        # the neck goes on down inside the collar as a funnel: from the cut to a small ring under the pivot. The game
        # throws the head back half a radian (the look up at his sign) and turns it a full radian: a stub as wide as
        # the neck swings its bottom edge out over the shirt; a funnel has no edge to show, only more neck.
        ctr = m.v[loop].mean(0)
        # the cut clips the top of the shirt's collar here and there: those scraps of collar on the head's lowest edge are
        # pulled in toward the neck (they hide inside the body's collar) and are painted as skin in the bake
        low = np.nonzero(h < 0.05)[0]
        c_low = scan.sample(m.v[low], m.srcn[low]); skin = scan.swatch(cfg['skin_at']); shirt = scan.swatch(cfg['shirt_at'])
        scrap = low[np.linalg.norm(c_low - shirt, axis=1) < np.linalg.norm(c_low - skin, axis=1)]
        m.v[scrap, :2] = ctr[:2] + (m.v[scrap, :2] - ctr[:2]) * cfg.get('collar_tuck', 0.86)
        log('    tucked', len(scrap), 'collar-coloured points on the edge of the head in toward the neck')
        rv = m.v[loop]
        zpiv = P[2] + (-(N[0] * (ctr[0] - P[0]) + N[1] * (ctr[1] - P[1])) / N[2])      # the cut plane's height at the ring's middle = the pivot
        zend = zpiv - cfg.get('stub', 0.14); sr = cfg.get('stub_r', 0.15); yb = ctr[1] + cfg.get('stub_back', 0.05)   # a little behind the axis: it swings forward when he looks up
        up = m.v[loop] + N * 0.012
        hn = m.srcn[loop].copy(); hn[:, 2] = 0; hn /= np.maximum(np.linalg.norm(hn, axis=1, keepdims=True), 1e-9)
        where = thin(m, loop, 12); L = len(where)
        low = np.column_stack([ctr[0] + (rv[where, 0] - ctr[0]) * sr, yb + (rv[where, 1] - ctr[1]) * sr, np.full(L, zend)])
        n0 = m.add(low, [], STUB, R_STUB, src=up[where], srcn=hn[where])
        zipper(m, loop, where, [n0 + i for i in range(L)], STUB, R_STUB)
        k = m.add([[ctr[0], yb, zend]], [], STUB, R_STUB, src=[up.mean(0)], srcn=[[0, 0, 0]])
        m.add([], [(n0 + (i + 1) % L, n0 + i, k) for i in range(L)], STUB, R_STUB)
        m.stub_tip = k; m.stub_low = list(range(n0, n0 + L)) + [k]
        m.pivot_src = np.array([ctr[0], ctr[1], zpiv])
        m.src[loop] = up     # the rim itself sits in the crease: take its colour from a hair higher too
    return m


def build_torso(v, t, cfg, P, N):
    n = vertex_normals(v, t)
    cx = (v[:, 0].min() + v[:, 0].max()) / 2
    # where the shoulders' tops are on the scan: the highest points along the stretch players walk on, both sides
    a, b = cfg['shoulder_band']; ax = np.abs(v[:, 0] - cx); tops = {-1: [], 1: []}
    for lo in np.linspace(a, b, 9)[:-1]:
        for side in (-1, 1):
            sel = np.nonzero((ax >= lo) & (ax < lo + (b - a) / 8) & (np.sign(v[:, 0] - cx) == side))[0]
            if len(sel): tops[side].append(v[sel[np.argmax(v[sel, 2])]])
    ridge = {k: np.mean(q, axis=0) for k, q in tops.items()}     # middle of each shoulder's ridge
    w = 1 - smooth(0.2, 0.7, -n[:, 1]) * (1 - smooth(0.35, 0.6, np.abs(v[:, 0] - cx)))   # collar, tie and lapels keep theirs
    v, t = decimate(v, t, cfg['tris_torso'], w, cfg.get('chest_bias', 0.02))
    v, t = drop_crumbs(v, t)
    m = Mesh(v, t, SCAN, R_TORSO_F)
    fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    m.region[:] = np.where(fn[:, 1] < 0, R_TORSO_F, R_TORSO_B)
    tidy(m, R_TORSO_F, R_TORSO_B)
    zmin = v[:, 2].min(); h = (m.v - P) @ N
    m.rim = None; m.ridge = ridge; m.cx = cx
    for loop in sorted(boundary_loops(m.t), key=len, reverse=True):
        log('    torso hole:', len(loop), 'points, z', np.round(m.v[loop][:, 2].min(), 3), np.round(m.v[loop][:, 2].max(), 3), 'off the neck plane', np.round(np.abs(h[loop]).max(), 3))
        if m.rim is None and m.v[loop][:, 2].max() < zmin + 0.08: m.rim = loop
        elif np.abs(h[loop]).max() < 0.03: m.cap(loop, THROAT, R_CAP, sink=0.12)   # the hole the neck stands in: shadowed skin, well below the collar's edge
        else: m.cap(loop, SCAN, R_TORSO_B)
    return m


# ------------------------------------------------------------------ 6 layout
def layout(head, torso, cfg):
    """Scan space -> game metres (still Blender axes: x, depth (front negative), height). Returns the head's pivot."""
    P = head.pivot_src; S = cfg['head_scale']; r0, r1 = cfg['blend']; kz = cfg['depth']
    tv = torso.v
    U = 2 * G['torsoRX'] / (tv[:, 0].max() - tv[:, 0].min()); cx = torso.cx
    # the head: crown on 36, neck on the root's axis, and the dome of the skull brought over that axis too (a slight
    # straightening of the neck): the server's standing circle is centred there, and a dome that is centred on the
    # pivot still covers it when the head turns
    hv = (head.v - P) * (S * U)
    top = hv[:, 2].max()
    dome = hv[hv[:, 2] > top - 3.0]
    off = -(dome[:, :2].min(0) + dome[:, :2].max(0)) / 2
    hv[:, :2] += off * smooth(0.12 * top, 0.55 * top, hv[:, 2])[:, None]
    piv = np.array([0.0, 0.0, G['height'] - top])
    head.v = hv + piv; head.pivot = piv
    # the body far from the collar: shoulders squared to the front, their ridge at y=24 and at `shoulder_at` behind the axis
    L, R = torso.ridge[-1], torso.ridge[1]
    twist = math.atan2(R[1] - L[1], R[0] - L[0]) * cfg.get('untwist', 1.0)
    mid = (L + R) / 2
    c, s_ = math.cos(-twist), math.sin(-twist)
    dx, dy = tv[:, 0] - cx, tv[:, 1] - mid[1]
    far = np.column_stack([(dx * c - dy * s_) * U, (dx * s_ + dy * c) * kz * U + cfg['shoulder_at'], (tv[:, 2] - mid[2]) * U + G['shoulderY'] + RIDGE_OVER])
    # the collar: scaled with the head about the neck, and it goes where the head goes
    v = tv - P
    near = v * (S * U) + piv
    w = (1 - smooth(r0, r1, np.linalg.norm(v, axis=1)))[:, None]
    torso.v = w * near + (1 - w) * far
    torso.U = U
    slide = (np.array([P[0] - cx, (P[1] - mid[1]) * kz, P[2] - mid[2]]) * U + np.array([0, cfg['shoulder_at'], G['shoulderY'] + RIDGE_OVER])) - piv
    # the top of the head: the server's standing circle is flat (y=35.5 out to 4.5 m) and a skull is a dome, so players
    # near the circle's edge stand in the air over the scalp. Two knobs, both judged by eye in the game:
    #   stand_gap  lift the scalp only where it is more than this many metres under a shallow lid over the circle
    #              (the crown and the hairline keep their own shape; only the low shoulders of the dome come up)
    #   flat_top   0..1: lift the whole dome that far toward the lid. It closes the gap best, but past about 0.3 the head
    #              is a block seen from the front and the hair is foreshortened to a rim: both men read as bald.
    k = cfg.get('flat_top', 0.0); gap = cfg.get('stand_gap')
    if k > 0 or gap is not None:
        hn = vertex_normals(head.v, head.t)
        r = np.hypot(head.v[:, 0], head.v[:, 1]); z = head.v[:, 2]
        lid = np.where(r < 4.75, 35.25 + 0.75 * (1 - (r / 4.75) ** 2), 0.0)
        up = smooth(0.0, 0.5, hn[:, 2]) * smooth(31.0, 33.0, z) * (1 - smooth(4.75, 5.2, r))
        z = z + k * up * np.maximum(0, lid - z)
        if gap is not None: z = z + up * np.maximum(0, lid - gap - z)
        head.v[:, 2] = np.minimum(G['height'], z)
    return piv, dict(U=U, slide=slide, pivot=piv, twist=math.degrees(twist), straighten=off)


# ------------------------------------------------------------------ 7 extend
def extend(torso, cfg):
    """Jacket from the scan's bottom rim down to z=0. Coloured by smearing the rim's colours straight down."""
    loop = torso.rim; L = len(loop)
    rv = torso.v[loop]; zr = float(rv[:, 2].mean())
    cx, cy = (rv[:, 0].min() + rv[:, 0].max()) / 2, (rv[:, 1].min() + rv[:, 1].max()) / 2
    src = torso.src[loop] + np.array([0, 0, 0.03]); sn = torso.srcn[loop].copy(); sn[:, 2] = 0
    sn /= np.maximum(np.linalg.norm(sn, axis=1, keepdims=True), 1e-9)
    torso.src[loop] = src
    where = thin(torso, loop, cfg.get('jacket_sides', 24)); M = len(where)
    seams = (int(np.argmin(rv[where, 0])), int(np.argmax(rv[where, 0])))   # UV seams down both sides: a front and a back panel pack better than one long strip
    prev = None
    for (f, sx, sy) in cfg['jacket']:
        ring = np.column_stack([cx + (rv[where, 0] - cx) * sx, cy + (rv[where, 1] - cy) * sy, np.full(M, zr * f)])
        n0 = torso.add(ring, [], EXT, R_EXT, src=src[where], srcn=sn[where])
        cur = [n0 + i for i in range(M)]
        if prev is None:
            zipper(torso, loop, where, cur, EXT, R_EXT)
            for q in seams: torso.seam.add((loop[where[q]], cur[q]))
        else:
            tri = []
            for i in range(M):
                a, b, a2, b2 = prev[i], prev[(i + 1) % M], cur[i], cur[(i + 1) % M]
                tri += [(b, a, a2), (b, a2, b2)]
            torso.add([], tri, EXT, R_EXT)
            for q in seams: torso.seam.add((prev[q], cur[q]))
        prev = cur
    torso.cap(prev, DARK, R_BOTTOM)
    torso.rim_z = zr; torso.rim_c = (cx, cy)


# ------------------------------------------------------------------ 8 arms
def prism(m, rings, kind, cap_first=True, cap_last=True):
    """Loft a tube through rings of points (each (n,3), same n, wound anticlockwise seen from the last ring looking back)."""
    idx = []
    for r in rings:
        n0 = m.add(r, [], kind, R_ARM); idx.append([n0 + i for i in range(len(r))])
    n = len(rings[0])
    for A, B in zip(idx, idx[1:]):
        tri = []
        for i in range(n):
            a, b, a2, b2 = A[i], A[(i + 1) % n], B[i], B[(i + 1) % n]
            tri += [(a, b, b2), (a, b2, a2)]
        m.add([], tri, kind, R_ARM)
    if cap_first: m.add([], [(idx[0][0], idx[0][i + 1], idx[0][i]) for i in range(1, n - 1)], kind, R_ARM)
    if cap_last: m.add([], [(idx[-1][0], idx[-1][i], idx[-1][i + 1]) for i in range(1, n - 1)], kind, R_ARM)


def ngon(c, rx, rz, n=6, rot=0.0):
    """Ring in the X-Z plane at depth c[1], facing -Y (forward)."""
    a = rot + np.arange(n) * 2 * math.pi / n
    return np.column_stack([c[0] - np.cos(a) * rx, np.full(n, c[1]), c[2] + np.sin(a) * rz])


def build_arm(side, cfg):
    """Forearm reaching forward from the elbow, shirt cuff, fist. side = +1 for his left (+X)."""
    ex, ey, ez = cfg['elbow']; ex *= side
    m = Mesh(np.zeros((0, 3)), np.zeros((0, 3), np.int32))
    drop = -0.12                                         # the forearm slopes down a little toward the hand
    at = lambda d, dx=0.0, dz=0.0: (ex + dx, ey - d, ez + d * drop + dz)
    rot = math.pi / 6
    prism(m, [ngon(at(-2.2), 1.9, 2.0, rot=rot), ngon(at(1.5), 1.85, 1.95, rot=rot), ngon(at(7.6), 1.45, 1.5, rot=rot)], SLEEVE, cap_last=False)
    prism(m, [ngon(at(7.3), 1.62, 1.68, rot=rot), ngon(at(8.5), 1.62, 1.68, rot=rot)], CUFF)
    # fist: a chamfered block, knuckles forward, thumb on the inside
    hx, hz = 2.0, 1.5
    ring = lambda d, k: np.array([at(d, -hx * k * 0.8, hz * k), at(d, -hx * k, hz * k * 0.5), at(d, -hx * k, -hz * k * 0.6), at(d, -hx * k * 0.75, -hz * k),
                                  at(d, hx * k * 0.75, -hz * k), at(d, hx * k, -hz * k * 0.6), at(d, hx * k, hz * k * 0.5), at(d, hx * k * 0.8, hz * k)])
    prism(m, [ring(8.4, 0.72), ring(9.0, 0.98), ring(11.2, 1.0), ring(11.9, 0.8)], HAND)
    tx = -side * (hx + 0.35)
    tr = lambda d, k: np.array([at(d, tx - 0.6 * k, 0.9 * k - 0.1), at(d, tx - 0.6 * k, -0.7 * k - 0.1), at(d, tx + 0.6 * k, -0.7 * k - 0.1), at(d, tx + 0.6 * k, 0.9 * k - 0.1)])
    prism(m, [tr(9.0, 0.9), tr(10.6, 1.0), tr(11.5, 0.7)], HAND)
    # make every face look outwards whichever side this is
    c = m.v.mean(0); fc = m.v[m.t].mean(1)
    fn = np.cross(m.v[m.t[:, 1]] - m.v[m.t[:, 0]], m.v[m.t[:, 2]] - m.v[m.t[:, 0]])
    axis = np.column_stack([fc[:, 0] - ex, np.zeros(len(fc)), fc[:, 2] - (ez + (ey - fc[:, 1]) * drop)])
    lead = fc[:, 1:2] * 0 + np.column_stack([np.zeros(len(fc)), -np.sign(ey - 4.0 - fc[:, 1]), np.zeros(len(fc))])
    out = np.where((np.abs(fn[:, 1]) > 3 * np.hypot(fn[:, 0], fn[:, 2]))[:, None], lead, axis)
    flip = (fn * out).sum(1) < 0
    m.t[flip] = m.t[flip][:, ::-1]
    m.src = m.v.copy(); m.srcn = vertex_normals(m.v, m.t)
    return m, np.array([ex, ey, ez])


# ------------------------------------------------------------------ 9 unwrap
def unwrap(parts):
    """One UV set for all parts. Returns per-part (triangles, 3, 2) arrays, Blender's convention (v up)."""
    V = []; T = []; region = []; off = 0; seams = set(); owner = []
    for pi, m in enumerate(parts):
        V.append(m.v); T.append(m.t + off); region.append(m.region); owner += [pi] * len(m.t)
        seams |= {(a + off, b + off) for a, b in m.seam} | {(b + off, a + off) for a, b in m.seam}
        off += len(m.v)
    V = np.vstack(V); T = np.vstack(T); region = np.concatenate(region); owner = np.array(owner)
    ob = make_object(V, T, 'uv'); me = ob.data
    me.uv_layers.new(name='UVMap')
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    for e in bm.edges:
        fs = e.link_faces
        e.seam = bool(len(fs) != 2 or region[fs[0].index] != region[fs[1].index] or owner[fs[0].index] != owner[fs[1].index] or (e.verts[0].index, e.verts[1].index) in seams)
    odd = np.bincount([owner[e.link_faces[0].index] for e in bm.edges if len(e.link_faces) > 2], minlength=len(parts))
    if odd.any(): log('    edges shared by more than two triangles, per part:', odd.tolist())
    bm.to_mesh(me); bm.free()
    for o in bpy.context.scene.objects: o.select_set(False)
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    arm = region == R_ARM
    def select(mask):
        bpy.ops.object.mode_set(mode='OBJECT')
        me.polygons.foreach_set('select', mask.astype(bool)); me.update()
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_mode(type='FACE')
    select(~arm)
    bpy.ops.uv.unwrap(method='MINIMUM_STRETCH', fill_holes=True, correct_aspect=True, margin=0.0)   # the one that keeps area as well as angle: the middle of the face is not squeezed
    # a chart the unwrapper could not flatten comes back with no area: those, and the arms, are projected from a few sides instead
    bpy.ops.object.mode_set(mode='OBJECT')
    uv = np.empty(len(me.loops) * 2, np.float64); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 3, 2)
    e1 = uv[:, 1] - uv[:, 0]; e2 = uv[:, 2] - uv[:, 0]; area = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    bad = arm | (area < 1e-12)
    for r in np.unique(region[bad & ~arm]): log('    chart', int(r), ':', int((bad & ~arm & (region == r)).sum()), 'of', int((region == r).sum()), 'triangles would not unwrap flat: projected instead')
    if bad.any():
        select(bad)
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
    select(np.ones(len(T), bool))
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    uv = np.empty(len(me.loops) * 2, np.float64); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 3, 2)
    # islands (faces joined through a shared point with the same UV), then each scaled by what its chart is worth
    key = {}; parent = np.arange(len(T))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    q = np.round(uv * 1e5).astype(np.int64)
    for f in range(len(T)):
        for k in range(3):
            kk = (int(T[f, k]), int(q[f, k, 0]), int(q[f, k, 1]))
            if kk in key: parent[find(f)] = find(key[kk])
            else: key[kk] = f
    isl = np.array([find(f) for f in range(len(T))])
    for i in np.unique(isl):
        sel = isl == i
        c = uv[sel].reshape(-1, 2).mean(0)
        uv[sel] = c + (uv[sel] - c) * TEXEL[int(region[sel][0])]
    # pack. How tightly Blender packs swings widely with tiny changes to the islands (40% to 75% of the square used),
    # so pack a few ways and keep the tightest.
    loose = uv.copy(); best = None
    for shape, turn, gap in [(a, b, c) for c in (0.012, 0.010, 0.014) for a in ('CONCAVE', 'CONVEX') for b in ('CARDINAL', 'ANY')]:
        me.uv_layers[0].data.foreach_set('uv', loose.ravel()); me.update()
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, rotate_method=turn, shape_method=shape, margin=gap)
        bpy.ops.object.mode_set(mode='OBJECT')
        uv = np.empty(len(me.loops) * 2, np.float64); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 3, 2)
        e1 = uv[:, 1] - uv[:, 0]; e2 = uv[:, 2] - uv[:, 0]; used = float(np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]).sum() / 2)
        if uv.min() < -1e-6 or uv.max() > 1 + 1e-6: continue
        if best is None or used > best[0]: best = (used, uv, shape, turn)
    used, uv, shape, turn = best
    # the packer fills the square one way and often leaves a strip empty the other: stretch the lot to fill both
    lo = uv.reshape(-1, 2).min(0); hi = uv.reshape(-1, 2).max(0); edge = 0.004
    uv = edge + (uv - lo) / (hi - lo) * (1 - 2 * edge)
    log('  packed (%s, %s): %.0f%% of the square, stretched %.2f x %.2f to fill it' % (shape.lower(), turn.lower(), used * 100, 1 / (hi[0] - lo[0]), 1 / (hi[1] - lo[1])))
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    out = []; a = 0
    for m in parts:
        out.append(uv[a:a + len(m.t)].copy()); a += len(m.t)
    log('  unwrapped:', len(np.unique(isl)), 'islands')
    return out


# ------------------------------------------------------------------ 10 bake
def rasterise(uv, W):
    """Which triangle owns each texel (row 0 = v 0) and where in it. uv: (F,3,2)."""
    fid = -np.ones((W, W), np.int32); bary = np.zeros((W, W, 3), np.float32)
    p = uv * W
    for f in range(len(p)):
        (ax, ay), (bx, by), (cx, cy) = p[f]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12: continue
        x0 = max(0, int(math.floor(min(ax, bx, cx) - 0.5))); x1 = min(W - 1, int(math.ceil(max(ax, bx, cx) - 0.5)))
        y0 = max(0, int(math.floor(min(ay, by, cy) - 0.5))); y1 = min(W - 1, int(math.ceil(max(ay, by, cy) - 0.5)))
        if x1 < x0 or y1 < y0: continue
        xs = np.arange(x0, x1 + 1) + 0.5; ys = np.arange(y0, y1 + 1) + 0.5
        X, Y = np.meshgrid(xs, ys)
        l0 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den
        l1 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-4) & (l1 >= -1e-4) & (l2 >= -1e-4)
        if not inside.any(): continue
        sub = fid[y0:y1 + 1, x0:x1 + 1]; sb = bary[y0:y1 + 1, x0:x1 + 1]
        sub[inside] = f; sb[inside] = np.stack([l0, l1, l2], -1)[inside]
    return fid, bary


def spread(img, mask, rounds):
    """Grow colours outwards into unowned texels so nearest-neighbour sampling never lands on nothing."""
    img = img.copy(); mask = mask.copy()
    for _ in range(rounds):
        if mask.all(): break
        acc = np.zeros_like(img); cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            sm = np.roll(mask, (dy, dx), (0, 1)); si = np.roll(img, (dy, dx), (0, 1))
            if dy == 1: sm[0] = False
            if dy == -1: sm[-1] = False
            if dx == 1: sm[:, 0] = False
            if dx == -1: sm[:, -1] = False
            acc += si * sm[..., None]; cnt += sm
        new = ~mask & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]; mask |= new
    return img, mask


def bake(scan, parts, uvs, cfg, W, name, debug):
    """Colour every texel. Returns (W, W, 3) sRGB floats, row 0 = top (PNG order)."""
    SS = 2; WB = W * SS
    V = np.vstack([m.v for m in parts]); SRC = np.vstack([m.src for m in parts]); SN = np.vstack([m.srcn for m in parts])
    off = np.cumsum([0] + [len(m.v) for m in parts])
    T = np.vstack([m.t + off[i] for i, m in enumerate(parts)]); kind = np.concatenate([m.kind for m in parts])
    owner = np.concatenate([np.full(len(m.t), i) for i, m in enumerate(parts)])
    uv = np.vstack(uvs)
    fid, bary = rasterise(uv, WB)
    ys, xs = np.nonzero(fid >= 0); f = fid[ys, xs]; b = bary[ys, xs].astype(np.float64)
    pos = (V[T[f]] * b[:, :, None]).sum(1); src = (SRC[T[f]] * b[:, :, None]).sum(1); sn = (SN[T[f]] * b[:, :, None]).sum(1)
    ln = np.linalg.norm(sn, axis=1, keepdims=True); sn = np.where(ln > 1e-6, sn / np.maximum(ln, 1e-9), 0)
    k = kind[f]
    col = np.zeros((len(f), 3))
    rng = np.random.default_rng(7)
    skin, suit, shirt = scan.swatch(cfg['skin_at']), scan.swatch(cfg['suit_at']), scan.swatch(cfg['shirt_at'])
    log('  colours: skin', np.round(skin, 2), 'suit', np.round(suit, 2), 'shirt', np.round(shirt, 2))
    if np.linalg.norm(shirt - skin) < 0.15: log('  WARNING: the shirt swatch is skin-coloured: move shirt_at onto the shirt (it colours the cuffs)')
    traced = (k == SCAN) | (k == STUB) | (k == EXT)
    col[traced] = scan.sample(src[traced], sn[traced])
    log('  traced', int(traced.sum()), 'texels back to the scan')
    # the neck inside the collar: one plain tone, the middle colour of the skin round the cut, a little darker the
    # deeper it goes (smearing the cut's own colours down it drew the crease under the chin and the hairline as dark
    # stripes, which show when the head turns or tips back)
    st = k == STUB; neck = skin * 0.9
    if st.any():
        like = st & (np.linalg.norm(col - skin, axis=1) < 0.25)
        if like.sum() > 50: neck = np.median(col[like], axis=0)
        head = parts[1]; d = np.clip((head.pivot[2] + 1.0 - pos[st, 2]) / 4.0, 0, 1)[:, None]
        col[st] = neck * (1.0 - 0.14 * d)
        # and the lowest edge of the head itself, where the cut clipped the top of the shirt's collar: skin, not shirt
        P = np.array(cfg['neck_p'], np.float64); N = np.array(cfg['neck_n'], np.float64); N /= np.linalg.norm(N)
        edge = (owner[f] == 1) & (k == SCAN) & ((src - P) @ N < 0.04) & (np.linalg.norm(col - shirt, axis=1) < np.linalg.norm(col - neck, axis=1))
        col[edge] = neck
        # the body keeps a strip of his neck too (the scan's skin just under the cut, below the chin, deep in shadow
        # in the scan): the same plain tone, so that it is one neck with the funnel when the head tips back
        like = (col * skin).sum(1) / np.maximum(np.linalg.norm(col, axis=1) * np.linalg.norm(skin), 1e-6)       # same hue as his skin, however dark
        d = src - P; strip = (owner[f] == 0) & (k == SCAN) & (d @ N > -0.10) & (np.linalg.norm(d, axis=1) < 0.36) & (like > 0.985)
        col[strip] = neck * 0.96
        log('  neck strip on the body:', int(strip.sum()), 'texels')
    log('  neck', np.round(neck, 2))
    # small repairs to the face, at the size the game shows it (places are the scan's own, seen from the front: x, height)
    face = (owner[f] == 1) & (k == SCAN) & (sn[:, 1] < -0.2); lum = col.mean(1)
    for ex, ez, rx, rz in cfg.get('lenses', []):   # spectacle lenses: the scan's are a mottle of reflections; calm them toward plain skin (the frames are left alone)
        glass = face & (((src[:, 0] - ex) / rx) ** 2 + ((src[:, 2] - ez) / rz) ** 2 < 1) & (lum > 0.36)
        col[glass] = 0.4 * col[glass] + 0.6 * skin * 0.92
    for ex, ez in cfg.get('eyes', []):             # and no eyes show behind them: paint a simple pair
        dx = src[:, 0] - ex; dz = src[:, 2] - ez; clear = face & (lum > 0.36)
        col[clear & ((dx / 0.036) ** 2 + (dz / 0.016) ** 2 < 1)] = skin * 0.4 + 0.5
        col[clear & (dx ** 2 + dz ** 2 < 0.015 ** 2)] = np.array([0.17, 0.12, 0.10])
    grain = lambda n, s: 1 + rng.normal(0, s, (n, 1))
    # the jacket below the scan: the rim's colours run straight down; the shirt's V closes and the tie comes to a point
    e = k == EXT
    if e.any():
        torso = parts[0]; zr = torso.rim_z
        ce = col[e]; ze = pos[e, 2]; xe = src[e, 0]; front = sn[e, 1] < -0.2
        lum = ce.mean(1); d_suit = np.linalg.norm(ce - suit, axis=1); d_shirt = np.linalg.norm(ce - shirt, axis=1)
        cloth = d_suit < d_shirt * 0.9
        plain = suit * grain(len(ce), 0.035)
        if cfg.get('vee') is not None:
            opening = ~cloth & front
            if opening.any():
                xo = xe[opening]; x_l, x_r = np.percentile(xo, 2), np.percentile(xo, 98); x_c = (x_l + x_r) / 2; half = (x_r - x_l) / 2
                zv = zr * cfg['vee']
                t_ = np.clip((zr - ze) / (zr - zv), 0, 1.5)
                inside_v = np.abs(xe - x_c) < half * (1 - t_)
                is_tie = opening & (np.linalg.norm(ce - shirt, axis=1) > 0.22)
                if is_tie.any():
                    xt = xe[is_tie]; t_l, t_r = np.percentile(xt, 3), np.percentile(xt, 97); t_c = (t_l + t_r) / 2; t_h = (t_r - t_l) / 2
                    zt = zr * cfg['tie_tip']
                    tip = np.clip((ze - zt) / (zr * 0.07), 0, 1)       # the last stretch narrows to a point
                    on_tie = (np.abs(xe - t_c) < t_h * tip) & (ze > zt)
                    ce = np.where((is_tie & ~on_tie)[:, None], shirt * grain(len(ce), 0.015), ce)
                edge = np.abs(np.abs(xe - x_c) - half * (1 - t_)) < half * 0.05
                ce = np.where((~inside_v & front)[:, None], plain, ce)
                ce = np.where((edge & front & (t_ < 1))[:, None], suit * 0.72, ce)
                # one button under the V, and the jacket's front edge below it
                zb = zv - zr * 0.07
                ce = np.where((front & (np.abs(xe - x_c) < half * 0.035) & (ze < zv))[:, None], suit * 0.72, ce)
                ce = np.where((front & (np.hypot((xe - x_c - half * 0.16) * torso.U, ze - zb) < 0.55))[:, None], suit * 0.45, ce)
        ce = np.where((~front & ~cloth)[:, None], plain, ce)
        col[e] = ce
    # underneath (seen from the ground when he floats off): it faces straight down, where the game's light is dim and has
    # little blue in it, so the suit's own colour comes out black there. Paint it much lighter than the suit.
    col[k == DARK] = np.clip(suit * (0.75 / max(float(suit.max()), 1e-3)), 0, 1) * grain(int((k == DARK).sum()), 0.03)
    col[k == THROAT] = neck * 0.86    # the hole the neck stands in: it shows under the neck's funnel when the head tips back, and must read as more neck
    col[k == SLEEVE] = suit * grain(int((k == SLEEVE).sum()), 0.045)
    col[k == CUFF] = shirt * grain(int((k == CUFF).sum()), 0.015)
    hmask = k == HAND
    if hmask.any():
        # finger grooves across the front of the fist
        ex = abs(cfg['elbow'][0]); hx = np.abs(pos[hmask, 0]) - ex; d = cfg['elbow'][1] - pos[hmask, 1]
        groove = (d > 10.6) & (np.abs(((hx + 2.0) / 1.0) % 1.0 - 0.5) > 0.4) & (np.abs(hx) < 1.9)
        col[hmask] = np.where(groove[:, None], skin * 0.7, skin * grain(int(hmask.sum()), 0.02))
    big = np.zeros((WB, WB, 3)); big[ys, xs] = np.clip(col, 0, 1)
    own = fid >= 0
    # 2x2 box down to the final size, counting only owned samples
    a = big.reshape(W, SS, W, SS, 3).sum((1, 3)); c = own.reshape(W, SS, W, SS).sum((1, 3))
    img = a / np.maximum(c, 1)[..., None]; mask = c > 0
    img, _ = spread(img, mask, 64)
    cover = mask.mean()
    if debug:   # which chart owns each texel (one flat colour per chart; black = nothing)
        hue = np.array([[230, 60, 60], [60, 200, 60], [250, 220, 40], [60, 100, 240], [240, 130, 30], [160, 60, 200], [60, 200, 220], [240, 120, 190], [150, 150, 150]], np.uint8)
        region = np.concatenate([m.region for m in parts]); chart = np.where(fid >= 0, region[np.maximum(fid, 0)], -1)[::SS, ::SS][::-1]
        idx = (chart + 1).astype(np.uint8); pal = np.vstack([np.zeros((1, 3), np.uint8), hue])
        open(os.path.join(debug, name + '_charts.png'), 'wb').write(png(idx, pal))
    log('  atlas %dx%d, %.0f%% used' % (W, W, cover * 100))
    if cover < 0.55: log('  WARNING: the texture packed badly (under 55% used): nudge a number (stub, stub_r, flat_top) and build again')
    return img[::-1].copy(), dict(cover=float(cover))


# ------------------------------------------------------------------ 11 write
def quantise(img, colours=256, rounds=10):
    """sRGB floats -> (indices, palette) by k-means, seeded on a coarse histogram."""
    px = np.clip(img.reshape(-1, 3), 0, 1).astype(np.float32)
    q = (px * 31).astype(np.int32); code = q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]
    u, cnt = np.unique(code, return_counts=True)
    top = u[np.argsort(-cnt)[:colours]]
    pal = np.column_stack([top // 1024, (top // 32) % 32, top % 32]).astype(np.float32) / 31
    def nearest(p):
        out = np.empty(len(p), np.int32)
        for i in range(0, len(p), 16384):
            c = p[i:i + 16384]
            out[i:i + 16384] = ((c[:, None, :] - pal[None]) ** 2).sum(2).argmin(1)
        return out
    for _ in range(rounds):
        idx = nearest(px)
        for j in range(len(pal)):
            s = idx == j
            if s.any(): pal[j] = px[s].mean(0)
    idx = nearest(px)
    return idx.reshape(img.shape[:2]).astype(np.uint8), np.clip(np.round(pal * 255), 0, 255).astype(np.uint8)


def png(idx, pal):
    h, w = idx.shape
    raw = b''.join(b'\x00' + idx[r].tobytes() for r in range(h))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 3, 0, 0, 0)) + chunk(b'PLTE', pal.tobytes())
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def corner_normals(v, t, limit=math.radians(62)):
    """Smooth normals, except across edges sharper than `limit`."""
    me = make_mesh(v, t)
    me.polygons.foreach_set('use_smooth', np.ones(len(t), bool))
    me.set_sharp_from_angle(angle=limit)
    me.update()
    n = np.empty(len(me.loops) * 3, np.float32); me.corner_normals.foreach_get('vector', n)
    bpy.data.meshes.remove(me)
    return n.reshape(-1, 3, 3)


def shade_undersides(cn, tris, least=-0.25):
    """Corner normals (triangles, 3, 3; Blender axes) of the chosen triangles that point further down than `least`
    are turned outwards until they point down only that far."""
    sel = cn[tris]; down = sel[:, :, 2] < least
    hz = sel[:, :, :2].copy(); ln = np.linalg.norm(hz, axis=2, keepdims=True)
    hz = np.where(ln > 1e-4, hz / np.maximum(ln, 1e-9), np.array([0.0, -1.0]))      # (straight down: turn it to the front)
    sel[down] = np.concatenate([hz * math.sqrt(1 - least ** 2), np.full(hz.shape[:2] + (1,), least)], axis=2)[down]
    cn[tris] = sel


def write_glb(path, name, parts, names, pivots, uvs, png_bytes):
    """parts[0] is the root's mesh; the others become its children at their pivots. Blender axes in, glTF axes out."""
    to_gl = lambda a: np.column_stack([a[:, 0], a[:, 2], -a[:, 1]])
    bins = []; views = []; accs = []; meshes = []; nodes = []
    def view(data, target=None):
        off = sum(len(b) for b in bins); pad = (-len(data)) % 4
        bins.append(data + b'\x00' * pad)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: v['target'] = target
        views.append(v); return len(views) - 1
    stats = []
    for m, nm, piv, uv in zip(parts, names, pivots, uvs):
        cn = corner_normals(m.v, m.t, math.radians(HEAD_CREASE) if nm == 'Head' else math.radians(62))
        # The game's light has next to nothing coming from below, so whatever faces down goes nearly black: the underside
        # of the nose came out as a black bar, and the strip of neck the body keeps under the cut (the flesh under his
        # chin, which shows when the head tips back) as a dark block on the collar. Normals that point down, on the head
        # and round the neck hole, are bent up to a shallow angle: those places are then in shade, not in the dark.
        if nm == 'Head': shade_undersides(cn, np.ones(len(m.t), bool))
        elif nm == names[0]:
            c = m.v[m.t].mean(1) - pivots[1]
            shade_undersides(cn, (np.hypot(c[:, 0], c[:, 1]) < 6.0) & (c[:, 2] > -4.0) & (m.kind == SCAN))
        th = np.nonzero(m.kind == THROAT)[0]
        if len(th): cn[th] = np.array([0.0, -0.7071, 0.7071])   # the hole the neck stands in is lit like the front of the neck (see the bake)
        if getattr(m, 'stub_tip', None) is not None:
            # the neck's funnel is shaded as the neck's wall (level, outwards), not as an underside: the game lights
            # anything that faces down nearly black, and this is what shows under his chin when he looks up
            st = np.nonzero(m.kind == STUB)[0]; tip = m.v[m.stub_tip]
            o = m.v[m.t[st]] - tip; o[:, :, 2] = 0
            ln = np.linalg.norm(o, axis=2, keepdims=True)
            o = np.where(ln > 1e-6, o / np.maximum(ln, 1e-9), np.array([0.0, -1.0, 0.0])) + np.array([0.0, 0.0, -0.3])   # tipped down a little: the underside of the jaw it meets is in shade
            cn[st] = o / np.linalg.norm(o, axis=2, keepdims=True)
        key = np.column_stack([m.t.reshape(-1, 1).astype(np.float64), np.round(uv.reshape(-1, 2) * 16384), np.round(cn.reshape(-1, 3) * 64)])
        _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
        inv = inv.reshape(-1)
        vi = m.t.reshape(-1)[first]
        pos = to_gl(m.v[vi] - piv).astype(np.float32); nrm = to_gl(cn.reshape(-1, 3)[first]).astype(np.float32)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
        tex = uv.reshape(-1, 2)[first].copy(); tex[:, 1] = 1 - tex[:, 1]; tex = tex.astype(np.float32)
        ind = inv.astype(np.uint16 if len(first) < 65536 else np.uint32)
        a0 = len(accs)
        accs.append({'bufferView': view(pos.tobytes(), 34962), 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': pos.min(0).tolist(), 'max': pos.max(0).tolist()})
        accs.append({'bufferView': view(nrm.tobytes(), 34962), 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'})
        accs.append({'bufferView': view(tex.tobytes(), 34962), 'componentType': 5126, 'count': len(tex), 'type': 'VEC2'})
        accs.append({'bufferView': view(ind.tobytes(), 34963), 'componentType': 5123 if ind.dtype == np.uint16 else 5125, 'count': len(ind), 'type': 'SCALAR'})
        meshes.append({'name': nm, 'primitives': [{'attributes': {'POSITION': a0, 'NORMAL': a0 + 1, 'TEXCOORD_0': a0 + 2}, 'indices': a0 + 3, 'material': 0}]})
        gp = to_gl(np.asarray(piv, np.float64)[None])[0]
        node = {'name': nm, 'mesh': len(meshes) - 1}
        if np.abs(gp).max() > 0: node['translation'] = [round(float(x), 4) for x in gp]
        nodes.append(node)
        stats.append((nm, len(m.t), len(pos)))
    if len(nodes) > 1: nodes[0]['children'] = list(range(1, len(nodes)))
    iv = view(png_bytes)
    gltf = {'asset': {'version': '2.0', 'generator': 'tools/models/busts.py'}, 'scene': 0, 'scenes': [{'name': name, 'nodes': [0]}], 'nodes': nodes, 'meshes': meshes,
            'materials': [{'name': name.lower(), 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}}],
            'textures': [{'sampler': 0, 'source': 0}], 'samplers': [{'magFilter': 9728, 'minFilter': 9728}], 'images': [{'bufferView': iv, 'mimeType': 'image/png'}],
            'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': sum(len(b) for b in bins)}]}
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    bn = b''.join(bins)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn)))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        fh.write(struct.pack('<II', len(bn), 0x004E4942) + bn)
    return stats


def standing(parts):
    """How the mesh sits against the server's standing surfaces: the top of the head (y=35.5 inside r 4.5) and the
    shoulders (y=24 inside the ellipse). Returns a one-line summary and a map (rows back to front, one cell per metre:
    the mesh's top minus the server's floor, in metres; '.' = within half a metre, '#' = nothing there at all)."""
    from mathutils.bvhtree import BVHTree
    V = np.vstack([m.v for m in parts[:2]]); off = len(parts[0].v)
    T = np.vstack([parts[0].t, parts[1].t + off])
    bvh = BVHTree.FromPolygons(V.tolist(), T.tolist())
    head = []; sh = []; miss = 0; rows = []
    for y in np.arange(5.5, -5.6, -1.0):
        row = ''
        for x in np.arange(-11.5, 11.6, 1.0):
            inh = x * x + y * y < G['headR'] ** 2; ins = (x / G['torsoRX']) ** 2 + (y / G['torsoRZ']) ** 2 < 1
            hit = bvh.ray_cast(Vector((x, y, 60)), Vector((0, 0, -1)))
            z = hit[0].z if hit[0] is not None else 0.0
            if not (inh or ins): row += ' ' if z < 20 else 'o'; continue
            d = z - (G['height'] - 0.5 if inh else G['shoulderY'])
            (head if inh else sh).append(d); miss += z < 12
            row += '#' if z < 12 else '.' if abs(d) < 0.5 else ('+' if d > 0 else '-') if abs(d) < 1.5 else str(min(9, int(abs(d)))) if d > 0 else chr(ord('a') + min(25, int(abs(d))) - 1)
        rows.append(row)
    head = np.array(head); sh = np.array(sh)
    return ('head top vs 35.5: mean %+.1f, lowest %+.1f | shoulders vs 24: mean %+.1f, lowest %+.1f, highest %+.1f, %d of %d spots have nothing under them'
            % (head.mean(), head.min(), sh.mean(), sh.min(), sh.max(), miss, len(sh) + len(head))), rows


def neck_check(head, torso, piv):
    """The game turns the head about its pivot by up to 1.05 rad and nods it between about -0.6 (the look up at his
    sign, plus a flinch) and +0.3. For each extreme: how many of the points round the bottom of the neck's funnel have
    come out of the body, and how far. Returns one line."""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromPolygons(torso.v.tolist(), torso.t.tolist())
    p = head.v[head.stub_low] - piv
    q = np.column_stack([p[:, 0], p[:, 2], -p[:, 1]])           # the game's axes: x, up, front
    out = []
    for yaw, nod in ((0, 0), (0, -0.6), (0, 0.3), (1.1, 0), (-1.1, 0), (1.1, -0.6), (-1.1, -0.6), (1.1, 0.3), (-1.1, 0.3)):
        cy, sy, cx, sx = math.cos(yaw), math.sin(yaw), math.cos(nod), math.sin(nod)
        a = np.column_stack([q[:, 0] * cy + q[:, 2] * sy, q[:, 1], -q[:, 0] * sy + q[:, 2] * cy])          # three.js: turn (Y) first, then nod (X)
        b = np.column_stack([a[:, 0], a[:, 1] * cx - a[:, 2] * sx, a[:, 1] * sx + a[:, 2] * cx])
        w = np.column_stack([b[:, 0], -b[:, 2], b[:, 1]]) + piv
        n = 0; far = 0.0
        for pt in w:
            loc, nrm, _, dist = bvh.find_nearest(Vector(pt))
            if (Vector(pt) - loc).dot(nrm) > 0: n += 1; far = max(far, dist)
        out.append('%+.1f/%+.1f: %d (%.1f m)' % (yaw, nod, n, far) if n else '%+.1f/%+.1f: 0' % (yaw, nod))
    return 'neck, turn/nod: points of %d outside the body: ' % len(p) + ', '.join(out)


# ------------------------------------------------------------------ one man
def build(man, opts):
    cfg = dict(MEN[man])
    for k in ('tris_head', 'tris_torso'):
        if opts.get(k): cfg[k] = int(opts[k])
    for kv in opts.get('set', []):          # --set head_scale=1.3 : try a number from MEN without editing the file
        k, val = kv.split('='); cfg[k] = float(val)
    src = opts.get('src_' + man) or os.path.join(SRC_DIR, man + '_source.glb')
    log(man.upper(), '<-', src)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scan = Scan(src, cfg['drop_loose'])
    v, t = mid_mesh(scan, src, cfg['mid_tris'], os.path.join(os.path.dirname(src), 'cache'))
    log('  mid:', len(t), 'triangles')
    P = np.array(cfg['neck_p'], np.float64); N = np.array(cfg['neck_n'], np.float64); N /= np.linalg.norm(N)
    (hv, ht), (tv, tt) = split(v, t, P, N)
    log('  split: head', len(ht), 'torso', len(tt))
    if opts.get('debug'): np.savez(os.path.join(opts['debug'], man + '_split.npz'), hv=hv, ht=ht, tv=tv, tt=tt)
    head = build_head(hv, ht, cfg, P, N, scan); torso = build_torso(tv, tt, cfg, P, N)
    if opts.get('debug'): np.savez(os.path.join(opts['debug'], man + '_low.npz'), hv=head.v, ht=head.t, tv=torso.v, tt=torso.t)
    if torso.rim is None: raise SystemExit('no bottom rim found on the torso')
    piv, info = layout(head, torso, cfg)
    extend(torso, cfg)
    parts = [torso, head]; names = [cfg['node'], 'Head']; pivots = [np.zeros(3), piv]
    if not opts.get('no_arms'):
        for nm, side in (('Arm_L', 1), ('Arm_R', -1)):
            m, p = build_arm(side, cfg); parts.append(m); names.append(nm); pivots.append(p)
    log('  layout: 1 scan unit = %.2f m; Head pivot (x, back, up) %s; body turned %+.1f deg and slid (x, back, up) %s m against the collar; skull moved (x, back) %s m over the neck' % (info['U'], np.round(piv, 2), -info['twist'], np.round(info['slide'], 2), np.round(info['straighten'], 2)))
    line, rows = standing(parts)
    log('  ' + line)
    log('  ' + neck_check(head, torso, piv))
    if opts.get('debug'):
        print('\n'.join('      ' + r for r in rows), flush=True)
        for nm, m in zip(names, parts): print('      %-6s x %.1f..%.1f  depth %.1f..%.1f  height %.1f..%.1f' % ((nm,) + tuple(np.round(np.column_stack([m.v.min(0), m.v.max(0)]).ravel(), 1))), flush=True)
    uvs = unwrap(parts)
    W = int(opts.get('tex') or 256)
    img, binfo = bake(scan, parts, uvs, cfg, W, man, opts.get('debug'))
    idx, pal = quantise(img)
    data = png(idx, pal)
    out = os.path.join(opts.get('out') or OUT_DIR, man + '.glb')
    stats = write_glb(out, cfg['node'], parts, names, pivots, uvs, data)
    if opts.get('debug'):
        os.makedirs(opts['debug'], exist_ok=True)
        open(os.path.join(opts['debug'], man + '_atlas.png'), 'wb').write(data)
    total = sum(s[1] for s in stats)
    allv = np.vstack([m.v for m in parts])
    log('  %s: %d triangles (%s), texture %dx%d %d-colour PNG %.1f KB, file %.1f KB' % (os.path.relpath(out, ROOT), total, ', '.join('%s %d' % (s[0], s[1]) for s in stats), W, W, len(pal), len(data) / 1024, os.path.getsize(out) / 1024))
    log('  size (m): x %.1f..%.1f, depth %.1f..%.1f (front is negative), height %.1f..%.1f; head %.1f wide' % (allv[:, 0].min(), allv[:, 0].max(), allv[:, 1].min(), allv[:, 1].max(), allv[:, 2].min(), allv[:, 2].max(), np.ptp(head.v[:, 0])))
    hv = head.v[np.unique(head.t[head.kind == SCAN])]; nose = hv[np.argmin(hv[:, 1])]
    mid = hv[(np.abs(hv[:, 0] - nose[0]) < 1.0) & (hv[:, 1] < nose[1] + 3.5) & (hv[:, 2] < nose[2])]     # the face's middle strip, below the nose
    log('  for src/plugins/giants.js (JAW, CHIN): underside of the chin at y=%.1f, nose tip at y=%.1f (%.1f m in front of the axis)' % (mid[:, 2].min(), nose[2], -nose[1]))
    return out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {}; i = 0
    while i < len(argv):
        k = argv[i].lstrip('-').replace('-', '_')
        if k == 'no_arms': opts[k] = True; i += 1
        elif k == 'set': opts.setdefault('set', []).append(argv[i + 1]); i += 2
        else: opts[k] = argv[i + 1]; i += 2
    for man in ([opts['only']] if opts.get('only') else list(MEN)):
        build(man, opts)


if __name__ == '__main__':   # (so that importing this file to probe a scan does not rebuild the shipped models)
    main()
