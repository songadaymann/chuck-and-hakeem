"""Hand-authored tool animations for the 22-bone Rocketbox rig, solved per frame in Blender.

Every clip drives a root-level "Tool" bone and makes the hands follow grip points on it,
so the game only has to parent a tool mesh to the Tool bone (handle end at the bone origin,
working end along +Y). Poses are written in character space for a 1.8 m person
(x = character's right, y = forward, z = up, metres) and scaled to each body.
"""
import bpy, math
from mathutils import Vector, Matrix, Quaternion

D = math.radians


def unit(v):
    return v.normalized() if v.length > 1e-9 else Vector((0, 0, 1))


class Rig:
    def __init__(self, arm, height):
        self.arm = arm
        self.W = arm.matrix_world.copy()
        self.Wi = self.W.inverted()
        self.sc = self.W.to_scale()[0]
        self.pb = {b.name: b for b in arm.pose.bones}
        for b in arm.pose.bones:
            b.rotation_mode = 'QUATERNION'
        self.rest = {n: self.W @ arm.data.bones[n].matrix_local for n in self.pb}
        self.s = height / 1.8
        self.side = 1.0 if self.rest['R UpperArm'].translation.x > 0 else -1.0
        self.fwd = 1.0 if (self.rest['L Toe0'].translation - self.rest['L Foot'].translation).y > 0 else -1.0
        rp = self.rest
        self.len = {}
        for sd in 'LR':
            self.len[sd + 'arm'] = ((rp[sd + ' Forearm'].translation - rp[sd + ' UpperArm'].translation).length,
                                    (rp[sd + ' Hand'].translation - rp[sd + ' Forearm'].translation).length)
            self.len[sd + 'leg'] = ((rp[sd + ' Calf'].translation - rp[sd + ' Thigh'].translation).length,
                                    (rp[sd + ' Foot'].translation - rp[sd + ' Calf'].translation).length)
        self.prevq = {}

    # character space -> world
    def d(self, v):
        return Vector((self.side * v[0], self.fwd * v[1], v[2]))

    def p(self, v):
        return self.d(v) * self.s

    def upd(self):
        bpy.context.view_layer.update()

    def wm(self, n):
        return self.W @ self.pb[n].matrix

    def set_world(self, n, M):
        self.pb[n].matrix = self.Wi @ M
        self.upd()

    def reset(self):
        for b in self.pb.values():
            b.location = (0, 0, 0)
            b.rotation_quaternion = (1, 0, 0, 0)
            b.scale = (1, 1, 1)
        self.upd()

    def bend(self, a):  # lean forward by a radians
        R = Matrix.Rotation(a, 3, self.d((1, 0, 0)))
        if (R @ Vector((0, 0, 1))).dot(self.d((0, 1, 0))) * a < 0:
            R = Matrix.Rotation(-a, 3, self.d((1, 0, 0)))
        return R

    def twist(self, a):  # turn toward the character's right by a radians
        R = Matrix.Rotation(a, 3, Vector((0, 0, 1)))
        if (R @ self.d((0, 1, 0))).dot(self.d((1, 0, 0))) * a < 0:
            R = Matrix.Rotation(-a, 3, Vector((0, 0, 1)))
        return R

    def delta(self, n, R, pos=None):
        M = self.wm(n)
        m = (R @ M.to_3x3()).to_4x4()
        m.translation = M.translation if pos is None else pos
        self.set_world(n, m)

    def aim(self, n, child, target):
        M = self.wm(n)
        head = M.translation
        cur = unit(self.wm(child).translation - head)
        q = cur.rotation_difference(unit(target - head))
        m = (q.to_matrix() @ M.to_3x3()).to_4x4()
        m.translation = head
        self.set_world(n, m)

    def limb(self, upper, lower, end, target, lens, hint):
        S = self.wm(upper).translation
        l1, l2 = lens
        v = target - S
        dist = max(abs(l1 - l2) + 1e-4, min(v.length, (l1 + l2) * 0.999))
        n = unit(v)
        a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        h = math.sqrt(max(l1 * l1 - a * a, 0.0))
        pole = unit(hint - n * hint.dot(n))
        E = S + n * a + pole * h
        self.aim(upper, lower, E)
        self.aim(lower, end, S + n * dist)
        return v.length - (l1 + l2)  # > 0 means the target was out of reach

    def set_tool(self, B, y, xhint=None, zhint=None):
        y = unit(y)
        if xhint is not None:
            x = unit(xhint - y * xhint.dot(y))
        else:
            x = unit(y.cross(zhint))
        z = x.cross(y)
        m = (Matrix((x, y, z)).transposed() * self.sc).to_4x4()
        m.translation = B
        self.set_world('Tool', m)
        return x, y, z

    def key(self, f, names=None):
        for n, b in self.pb.items():
            if names and n not in names:
                continue
            q = b.rotation_quaternion.copy()
            pq = self.prevq.get(n)
            if pq is not None and q.dot(pq) < 0:
                q.negate()
                b.rotation_quaternion = q
            self.prevq[n] = q
            b.keyframe_insert('rotation_quaternion', frame=f)
            if n in ('Pelvis', 'Tool'):
                b.keyframe_insert('location', frame=f)


def lerp(a, b, t):
    if isinstance(a, (tuple, list)):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


def sample(keys, t):
    """keys: [(time 0..1, {param: value})], looping; smoothstep between neighbours."""
    ks = sorted(keys, key=lambda k: k[0])
    if ks[-1][0] < 1.0:
        ks.append((1.0, ks[0][1]))
    for (t0, a), (t1, b) in zip(ks, ks[1:]):
        if t0 <= t <= t1:
            u = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            u = u * u * (3 - 2 * u)
            return {k: lerp(a[k], b[k], u) for k in a}
    return ks[-1][1]


def K(B, tip, bend=0, twist=0, drop=0, roll=0):
    return {'B': B, 'tip': tip, 'bend': bend, 'twist': twist, 'drop': drop, 'roll': roll}


CLIPS = {
    # shovel: handle end in the right hand, left hand down the shaft
    'dig': dict(frames=48, step=2, gripR=(0, 0.10, 0), gripL=(0, 0.52, 0), zhint=(0, 0, 1),
                feet={'L': (-0.05, 0.22, 0), 'R': (0.06, -0.10, 0)},
                keys=[(0.00, K((0.22, 0.05, 1.15), (0.00, 0.80, 0.30), 25, 0, 0.05)),
                      (0.22, K((0.20, 0.20, 1.10), (0.00, 0.85, 0.00), 60, 0, 0.22)),
                      (0.34, K((0.20, 0.26, 1.04), (0.00, 0.85, -0.08), 64, 0, 0.25)),
                      (0.52, K((0.25, 0.02, 1.10), (-0.05, 0.80, 0.60), 32, -5, 0.10)),
                      (0.70, K((0.30, -0.06, 1.12), (-0.60, 0.50, 1.25), 10, -35, 0.03)),
                      (0.84, K((0.30, -0.02, 1.14), (-0.66, 0.55, 1.12), 12, -28, 0.03))]),
    # pickaxe / sledgehammer: both hands near the handle end, overhead swing
    'swing': dict(frames=36, step=2, gripL=(0, 0.05, 0), gripR=(0, 0.30, 0), xhint=(1, 0, 0),
                  feet={'L': (-0.06, 0.16, 0), 'R': (0.06, -0.08, 0)},
                  keys=[(0.00, K((0.05, 0.36, 1.00), (0.00, 1.00, 0.65), 20, 0, 0.05)),
                        (0.42, K((0.10, 0.10, 1.55), (0.14, -0.35, 2.20), -8, 0, 0.00)),
                        (0.55, K((0.10, 0.12, 1.58), (0.14, -0.30, 2.25), -10, 0, 0.00)),
                        (0.68, K((0.05, 0.45, 0.95), (0.00, 1.05, 0.15), 50, 0, 0.20)),
                        (0.80, K((0.05, 0.45, 0.93), (0.00, 1.05, 0.13), 52, 0, 0.21))]),
    # jackhammer: T-handle, pointing down, fast shake
    'jackhammer': dict(frames=6, step=1, gripR=(0.20, 0, 0), gripL=(-0.20, 0, 0), xhint=(1, 0, 0),
                       feet={'L': (-0.07, 0.05, 0), 'R': (0.07, 0.0, 0)},
                       keys=[(0.00, K((0, 0.42, 1.02), (0, 0.47, 0.0), 22, 0, 0.06)),
                             (0.17, K((0, 0.42, 1.045), (0, 0.47, 0.0), 20, 0, 0.05)),
                             (0.33, K((0, 0.42, 1.015), (0, 0.47, 0.0), 23, 0, 0.065)),
                             (0.50, K((0, 0.42, 1.05), (0, 0.47, 0.0), 20.5, 0, 0.05)),
                             (0.67, K((0, 0.42, 1.02), (0, 0.47, 0.0), 22.5, 0, 0.06)),
                             (0.83, K((0, 0.42, 1.04), (0, 0.47, 0.0), 21, 0, 0.055))]),
    # walk-behind machine (trencher, tiller): the walk clip with both hands on a handlebar
    'push': dict(base='walk', step=2, gripR=(0.24, 0, 0), gripL=(-0.24, 0, 0), xhint=(1, 0, 0),
                 keys=[(0.00, K((0, 0.36, 1.12), (0, 1.10, 0.40))),
                       (0.25, K((0, 0.36, 1.135), (0, 1.10, 0.40))),
                       (0.50, K((0, 0.36, 1.12), (0, 1.10, 0.40))),
                       (0.75, K((0, 0.36, 1.135), (0, 1.10, 0.40)))]),
    # seated, hands on a wheel: for every vehicle from the skid steer up
    'drive': dict(frames=60, step=3, gripR=(0.19, 0, 0), gripL=(-0.19, 0, 0), xhint=(1, 0, 0), seated=True,
                  feet_abs={'L': (-0.15, 0.44, 0.12), 'R': (0.15, 0.44, 0.12)},
                  keys=[(0.00, K((0, 0.40, 0.93), (0, 0.60, 1.25), 6, 0, 0.40, 0)),
                        (0.25, K((0, 0.40, 0.93), (0, 0.60, 1.25), 7, 3, 0.40, 22)),
                        (0.50, K((0, 0.40, 0.93), (0, 0.60, 1.25), 6, 0, 0.405, 0)),
                        (0.75, K((0, 0.40, 0.93), (0, 0.60, 1.25), 7, -3, 0.40, -22))]),
}


def solve_frame(rig, c, P, base=None):
    rig.reset()
    if base is not None:
        for n in base:  # parent-first order
            rig.pb[n].matrix = base[n]
            rig.upd()
    else:
        b, tw = D(P['bend']), D(P['twist'])
        M = rig.rest['Pelvis']
        pos = M.translation + rig.p((0, -0.14 * math.sin(b), -P['drop']))
        rig.delta('Pelvis', rig.twist(tw * 0.2) @ rig.bend(b * 0.25), pos)
        for n in ('Spine', 'Spine1', 'Spine2'):
            rig.delta(n, rig.twist(tw * 0.27) @ rig.bend(b * 0.25))
        rig.delta('Head', rig.bend(-b * 0.45))
        for sd in 'LR':
            rest_foot = rig.rest[sd + ' Foot']
            if 'feet_abs' in c:
                A = rig.p(c['feet_abs'][sd])
                hint = rig.d((0.15 if sd == 'R' else -0.15, 0.6, 1.0))
            else:
                A = rest_foot.translation + rig.p(c.get('feet', {}).get(sd, (0, 0, 0)))
                hint = rig.d((0.25 if sd == 'R' else -0.25, 1.0, 0.1))
            rig.limb(sd + ' Thigh', sd + ' Calf', sd + ' Foot', A, rig.len[sd + 'leg'], hint)
            m = rest_foot.to_3x3().to_4x4()  # keep the sole flat
            m.translation = rig.wm(sd + ' Foot').translation
            rig.set_world(sd + ' Foot', m)

    B, tip = rig.p(P['B']), rig.p(P['tip'])
    y = unit(tip - B)
    if 'xhint' in c:
        xh = rig.d(c['xhint'])
        if P.get('roll'):
            xh = Matrix.Rotation(D(P['roll']), 3, y) @ xh
        x, y, z = rig.set_tool(B, y, xhint=xh)
    else:
        x, y, z = rig.set_tool(B, y, zhint=rig.d(c['zhint']))
    miss = 0.0
    for sd in 'LR':
        g = c['grip' + sd]
        target = B + (x * g[0] + y * g[1] + z * g[2]) * rig.s
        hint = rig.d((0.45 if sd == 'R' else -0.45, -0.6, -0.7))
        miss = max(miss, rig.limb(sd + ' UpperArm', sd + ' Forearm', sd + ' Hand', target, rig.len[sd + 'arm'], hint))
    return miss


def make_clip(rig, name, base_action=None):
    """Create the action for one procedural clip; returns (action, (start, end), worst_reach_miss_m)."""
    c = CLIPS[name]
    arm = rig.arm
    sc = bpy.context.scene
    step = c['step']
    order = sorted(rig.pb, key=lambda n: len(arm.data.bones[n].parent_recursive))
    bases = None
    if 'base' in c:
        arm.animation_data.action = base_action
        f0, f1 = (int(round(x)) for x in base_action.frame_range)
        bases = {}
        for f in range(f0, f1 + 1, step):
            sc.frame_set(f)
            bases[f] = {n: rig.pb[n].matrix.copy() for n in order if n != 'Tool'}
        frames = list(range(f0, f1 + 1, step))
    else:
        f0, f1 = 1, 1 + c['frames']
        frames = list(range(f0, f1 + 1, step))
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    rig.prevq = {}
    worst = 0.0
    for f in frames:
        t = (f - f0) / (f1 - f0)
        P = sample(c['keys'], min(t, 1.0))
        worst = max(worst, solve_frame(rig, c, P, bases[f] if bases else None))
        rig.key(f)
    rig.reset()
    return act, (f0, f1), worst


def key_carry(rig, act, f0, f1, step):
    """In a library clip (walk, idle...), make the Tool bone ride in the right hand, held upright."""
    arm = rig.arm
    arm.animation_data.action = act
    sc = bpy.context.scene
    rig.prevq = {}
    y = unit(rig.d((0.0, 0.35, 1.0)))
    for f in range(f0, f1 + 1, step):
        sc.frame_set(f)
        hand = rig.wm('R Hand').translation
        rig.set_tool(hand - y * 0.5 * rig.s, y, xhint=rig.d((1, 0, 0)))
        rig.key(f, names=('Tool',))
