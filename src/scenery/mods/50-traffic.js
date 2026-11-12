import * as THREE from 'three';
import { ps1ify } from '../../ps1.js';
import { box, cone, card, patch, place, tint, merge, instances, glow, mesh as fixed } from '../kit.js';
import { walkAt, rng } from '../plan.js';

// Traffic: cars, buses, trucks and a motorcade on the streets in plan.ROADS, cyclists and scooters on the Pennsylvania
// Ave bike lane and the walks. Every lane on the map belongs to exactly one one-way route, so nothing ever merges:
// vehicles only follow the one in front, stop at lights where routes cross (and wait for the junction to empty), and
// brake for people standing in the road. At a route's far end (out in the fog) a vehicle shrinks away and joins the
// start of whichever route is emptiest.

// One material for every vehicle. Each vertex says what colours it (`mask`): 0 its own paint, 1 the instance's body
// colour, 2 the instance's trim colour (a taxi's swoosh, a cruiser's stripe and light bar); trim.r < 0 hides those parts.
const paint = ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true }));
const snapTo = paint.onBeforeCompile;
paint.onBeforeCompile = (sh) => {
  snapTo(sh);
  sh.vertexShader = 'attribute float mask;\nattribute vec3 trim;\n' + sh.vertexShader
    .replace('#include <color_vertex>', 'vColor = color;\n#ifdef USE_INSTANCING_COLOR\n if (mask > 1.5) vColor *= trim; else if (mask > 0.5) vColor *= instanceColor;\n#endif')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n if (mask > 1.5 && trim.r < 0.0) transformed = vec3(0.0);');
};

const GLASS = 0x2a3846, TYRE = 0x17171a, HEAD = 0xfff0b8, TAIL = 0xc41c1c, STEEL = 0x80858b, DIRT = 0x705436;
const C = new THREE.Color(), M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), BM = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// ---------- shapes (all facing +Z, wheels on y = 0) ----------
const part = (g, m) => { g.setAttribute('mask', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(m), 1)); return g; };
const figure = (...parts) => merge(parts.map((g) => (g.attributes.mask ? g : part(g, 0))));
// A vehicle: the same, less every face that points straight down (nobody sees under a car).
function shape(...parts) {
  const g = figure(...parts), n = g.attributes.normal, keep = [];
  for (let i = 0; i < n.count; i += 3) if (n.getY(i) > -0.99) keep.push(i, i + 1, i + 2);
  for (const k of Object.keys(g.attributes)) { const a = g.attributes[k], w = a.itemSize, out = new Float32Array(keep.length * w); keep.forEach((v, j) => { for (let c = 0; c < w; c++) out[j * w + c] = a.array[v * w + c]; }); g.setAttribute(k, new THREE.BufferAttribute(out, w)); }
  return g;
}
// A box whose top face is squeezed (fx, fz) and slid (dz): cabins, windscreens, a dump bed. `roof` paints the top: 1 body colour, 0 white.
function wedge(w, h, d, color, o, fx, fz, dz = 0, roof = -1) {
  const g = box(w, h, d, color), p = g.attributes.position, c = g.attributes.color, n = g.attributes.normal, m = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    if (roof >= 0 && n.getY(i) > 0.9) { m[i] = roof; c.setXYZ(i, 1, 1, 1); }
    if (p.getY(i) > h / 2) p.setXYZ(i, p.getX(i) * fx, h, p.getZ(i) * fz + dz);
  }
  g.computeVertexNormals();
  g.setAttribute('mask', new THREE.BufferAttribute(m, 1));
  return place(g, o);
}
// A square rod from a to b: bicycle tubes, arms, legs.
function bar(a, b, t, color) {
  V.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = V.length(), g = tint(new THREE.BoxGeometry(t, t, len), color);
  g.applyQuaternion(Q.setFromUnitVectors(ZA, V.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
// Both wheels of an axle as one six-sided drum, w across. Cars leave off the top half of the tread, which the body hides.
function axle(r, w, z, full) {
  const p = [], rim = (k, side) => p.push(side * w / 2, r + Math.sin(k * Math.PI / 3) * r, z + Math.cos(k * Math.PI / 3) * r);
  for (let k = 1; k < 5; k++) { rim(0, 1); rim(k + 1, 1); rim(k, 1); rim(0, -1); rim(k, -1); rim(k + 1, -1); }
  for (let k = full ? 0 : 3; k < 6; k++) { rim(k, 1); rim(k + 1, 1); rim(k + 1, -1); rim(k, 1); rim(k + 1, -1); rim(k, -1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
  g.computeVertexNormals();
  return tint(g, TYRE);
}
const lights = (w, y, z) => [card(w, 0.17, HEAD, { y, z }), card(w, 0.15, TAIL, { y: y + 0.04, z: -z, ry: Math.PI })];
const stripes = (len, x, y) => [part(card(len, 0.22, 0xffffff, { x, y, ry: Math.PI / 2 }), 2), part(card(len, 0.22, 0xffffff, { x: -x, y, ry: -Math.PI / 2 }), 2)];

const SHAPES = {
  sedan: () => shape(part(box(1.8, 0.54, 4.4, 0xffffff, { y: 0.28 }, 0.3), 1), wedge(1.72, 0.5, 2.5, GLASS, { y: 0.82, z: -0.3 }, 0.8, 0.6, -0.12, 1),
    axle(0.33, 1.86, 1.38), axle(0.33, 1.86, -1.38), ...lights(1.5, 0.54, 2.21), ...stripes(3.3, 0.91, 0.42), part(box(1.0, 0.15, 0.3, 0xffffff, { y: 1.32, z: -0.4 }), 2)),
  suv: () => shape(part(box(1.95, 0.72, 4.7, 0xffffff, { y: 0.32 }, 0.3), 1), wedge(1.86, 0.7, 3.2, GLASS, { y: 1.04, z: -0.6 }, 0.86, 0.86, -0.12, 1),
    axle(0.4, 2.0, 1.5), axle(0.4, 2.0, -1.5), ...lights(1.6, 0.68, 2.36), ...stripes(3.6, 0.985, 0.56), part(box(1.1, 0.16, 0.32, 0xffffff, { y: 1.74, z: -0.3 }), 2)),
  pickup: () => shape(part(box(1.95, 0.64, 5.3, 0xffffff, { y: 0.36 }, 0.3), 1), wedge(1.86, 0.68, 1.9, GLASS, { y: 1.0, z: 0.5 }, 0.86, 0.8, -0.1, 1),
    patch(1.6, 2.1, 0x1c1d20, { y: 1.03, z: -1.5 }), axle(0.42, 2.0, 1.75), axle(0.42, 2.0, -1.7), ...lights(1.6, 0.7, 2.66)),
  truck: () => shape(box(2.1, 0.4, 6.6, 0x1b1b1e, { y: 0.45 }), box(2.25, 0.8, 1.7, 0xeeeeea, { y: 0.6, z: 2.5 }, 0.2), wedge(2.2, 0.85, 1.6, GLASS, { y: 1.4, z: 2.5 }, 0.94, 0.78, -0.12, 0),
    part(box(2.45, 2.45, 4.75, 0xffffff, { y: 0.8, z: -0.95 }, 0.22), 1), axle(0.46, 2.4, 2.4, true), axle(0.46, 2.4, -2.1, true), ...lights(1.9, 0.75, 3.36)),
  dump: () => shape(box(2.2, 0.45, 7.2, 0x1b1b1e, { y: 0.55 }), part(box(2.45, 0.95, 1.9, 0xffffff, { y: 0.8, z: 2.6 }, 0.2), 1), wedge(2.4, 0.8, 1.8, GLASS, { y: 1.75, z: 2.6 }, 0.94, 0.8, -0.1, 1),
    wedge(2.25, 1.45, 4.7, STEEL, { y: 1.0, z: -1.1 }, 1.18, 1.05, 0), box(2.6, 0.12, 1.3, STEEL, { y: 2.6, z: 1.9 }),
    cone(1.3, 1.25, 6, DIRT, { y: 2.3, z: -1.3, sz: 1.5 }, 0.25), cone(0.9, 0.9, 5, 0x5e452c, { x: 0.25, y: 2.3, z: 0.3 }),
    axle(0.52, 2.6, 2.6, true), axle(0.52, 2.6, -1.5, true), axle(0.52, 2.6, -2.75, true), ...lights(2.0, 0.95, 3.56)),
  bus: () => shape(box(2.55, 1.3, 12, 0xc9ced3, { y: 0.4 }, 0.25), box(2.5, 0.85, 11.9, GLASS, { y: 1.7 }), box(2.55, 0.5, 12, 0xc8102e, { y: 2.55 }),
    card(2.56, 1.3, 0xc8102e, { y: 0.4, z: 6.01 }), card(1.8, 0.36, 0xffa51e, { y: 2.6, z: 6.02 }), box(1.6, 0.28, 2.6, 0xaeb3b8, { y: 3.05, z: -3 }),
    axle(0.5, 2.6, 4), axle(0.5, 2.6, -3.6), ...lights(2.0, 0.7, 6.03)),
  // The open-top tour bus carries its sightseers: blocks of anorak with heads, looking at the dig.
  tour: () => {
    const r = rng(77), people = [];
    for (let i = 0; i < 9; i++) { const x = (i % 2 ? 0.62 : -0.62), z = 3.4 - Math.floor(i / 2) * 1.75 - (i % 2) * 0.5; people.push(box(0.46, 0.55, 0.34, [0xd9482b, 0x2f6fb5, 0xe8c832, 0x3c8a57, 0xe9e9e4][Math.floor(r() * 5)], { x, y: 3.32, z }), box(0.24, 0.25, 0.25, [0xe0b08a, 0x8d5a3a, 0xc68d62][i % 3], { x, y: 3.87, z }));
    }
    return shape(part(box(2.55, 1.45, 11, 0xffffff, { y: 0.4 }, 0.25), 1), box(2.5, 0.72, 10.9, GLASS, { y: 1.85 }), part(box(2.55, 0.78, 11, 0xffffff, { y: 2.57 }), 1),
      patch(2.25, 10.6, 0x24262b, { y: 3.37 }), box(2.4, 0.7, 0.12, GLASS, { y: 3.3, z: 5.3 }), card(2.56, 0.3, 0xf2d21e, { y: 2.2, z: 5.51 }), ...people,
      axle(0.5, 2.6, 3.6), axle(0.5, 2.6, -3.4), ...lights(2.0, 0.7, 5.52));
  },
  lamp: () => tint(new THREE.BoxGeometry(0.36, 0.2, 0.3).translate(0, 0.1, 0), 0xffffff),
  bike: () => shape(axle(0.34, 0.07, 0.53, true), axle(0.34, 0.07, -0.53, true),
    part(bar([0, 0.3, 0.02], [0, 0.86, 0.4], 0.1, 0xffffff), 1), part(bar([0, 0.34, -0.5], [0, 0.92, -0.2], 0.09, 0xffffff), 1), bar([0, 0.34, 0.53], [0, 1.0, 0.36], 0.07, 0x25262a),
    box(0.5, 0.06, 0.07, 0x25262a, { y: 0.97, z: 0.36 }), box(0.15, 0.07, 0.28, 0x25262a, { y: 0.9, z: -0.24 })),
  scooter: () => shape(box(0.18, 0.07, 0.86, 0x26272b, { y: 0.11, z: -0.02 }), part(bar([0, 0.12, 0.42], [0, 1.2, 0.32], 0.08, 0xffffff), 1), box(0.46, 0.06, 0.06, 0x26272b, { y: 1.17, z: 0.32 }),
    box(0.07, 0.22, 0.22, TYRE, { z: 0.46 }), box(0.07, 0.22, 0.22, TYRE, { z: -0.44 })),
  // A rider from the hips up, hips at the origin: shirt (body colour), head and forearms (trim = skin), helmet.
  rider: () => figure(part(box(0.36, 0.52, 0.2, 0xffffff, {}, 0.25), 1), part(box(0.2, 0.22, 0.22, 0xffffff, { y: 0.55, z: 0.02 }), 2), box(0.25, 0.12, 0.29, 0xe6e6e2, { y: 0.74, z: 0.02 }),
    ...[-1, 1].flatMap((k) => [part(bar([0.22 * k, 0.47, 0], [0.22 * k, 0.2, 0.17], 0.1, 0xffffff), 1), part(bar([0.22 * k, 0.2, 0.17], [0.19 * k, 0.24, 0.5], 0.085, 0xffffff), 2)])),
  // One leg hanging from the hip with the knee forward; LEG is how far the foot is from the hip.
  leg: () => figure(part(bar([0, 0, 0], [0, -0.36, 0.2], 0.13, 0xffffff), 1), part(bar([0, -0.36, 0.2], [0, -0.74, 0.02], 0.11, 0xffffff), 1), box(0.11, 0.08, 0.25, 0x1c1c1e, { y: -0.82, z: 0.07 })),
};
const LEG = 0.76, LIGHTS = [0xff2a22, 0xffb422, 0x2fe35a];
const CYCLE = 24, AMBER = 2;   // the traffic lights' clock, the same as the mast-arm signals in 70-site.js (which change with game.time % CYCLE)
const SIZE = { sedan: [4.5, 1.8], suv: [4.8, 1.95], pickup: [5.4, 1.95], truck: [7.1, 2.45], dump: [7.7, 2.6], bus: [12.1, 2.55], tour: [11.1, 2.55], bike: [1.8, 0.6], scooter: [1.1, 0.5] };   // length, width

const GREYS = [0xe9e9e4, 0xe9e9e4, 0xcfd3d6, 0xcfd3d6, 0x9a9fa5, 0x8d9299, 0x34373c, 0x1d1e21, 0x1d1e21];
const CAR = [...GREYS, 0x8c1d22, 0x1e3f7c, 0x2e5b4c, 0xb9ae8c, 0x6a7f97, 0xc2552d, 0x5b3b2b, 0x3f6fb5, 0xd8b93a];
const ROADS_ONLY = 'abcdefgklmn';   // not down the narrow Mall drives
// kind, shape, how many, scale [x, y, z], body colours, trim colour (-1 none), slowest, fastest (m/s), routes it may use ('' any)
const FLEET = [
  ['sedan', 'sedan', 30, [1, 1, 1], CAR, -1, 9, 13, ''],
  ['taxi', 'sedan', 8, [1, 1, 1], [0xc2222a], 0xb4b8bc, 9, 12.5, ''],
  ['police', 'sedan', 4, [1, 1, 1], [0xf2f2ee], 0x1c4da6, 8, 11, ''],
  ['suv', 'suv', 20, [1, 1, 1], CAR, -1, 9, 13, ''],
  ['hatch', 'suv', 18, [0.9, 0.78, 0.8], CAR, -1, 9, 13, ''],
  ['pickup', 'pickup', 8, [1, 1, 1], CAR, -1, 8.5, 12, ''],
  ['truck', 'truck', 4, [1, 1, 1], [0xf0f0ec, 0xe8c832, 0xf0f0ec, 0xd9672b], -1, 7, 10, ROADS_ONLY],
  ['van', 'truck', 4, [0.82, 0.74, 0.7], [0x5a3d24, 0xf0f0ec, 0x2b4f8f], -1, 7.5, 11, ROADS_ONLY],
  ['dumptruck', 'dump', 5, [1, 1, 1], [0xe2a81e, 0xd8d8d2, 0xc9572a], -1, 7, 9, 'bcd'],          // First St only: this is where the dirt goes
  ['bus', 'bus', 4, [1, 1, 1], [0xffffff], -1, 7, 9.5, 'acdefgkl'],
  ['tourbus', 'tour', 2, [1, 1, 1], [0xc0202a, 0x1f55a8], -1, 7, 8.5, 'dhijk'],
];
const SHIRTS = [0xd9482b, 0x2f6fb5, 0xe8c832, 0x3c8a57, 0xe9e9e4, 0x25262a, 0xe07fb0, 0x7a4fb0, 0xf28c28], SKINS = [0xe0b08a, 0xc68d62, 0x8d5a3a, 0x5f3d28, 0xf0c8a4], LEGS = [0x25303f, 0x1c1c1e, 0x3d4f6e, 0x8a7a5c, 0x4a4a4e];

// ---------- routes ----------
// A line of [x, z] points moved d metres to its right-hand side for the way it runs.
function offset(pts, d, loop) {
  const n = pts.length, dir = (a, b) => { const x = b[0] - a[0], z = b[1] - a[1], l = Math.hypot(x, z); return [x / l, z / l]; };
  return pts.map((b, i) => {
    const u = !loop && i === 0 ? dir(b, pts[1]) : dir(pts[(i + n - 1) % n], b), v = !loop && i === n - 1 ? u : dir(b, pts[(i + 1) % n]);
    const nx = -(u[1] + v[1]), nz = u[0] + v[0], nl = Math.hypot(nx, nz), k = d / Math.max(0.3, (nx * -u[1] + nz * u[0]) / nl) / nl;
    return [b[0] + nx * k, b[1] + nz * k];
  });
}
// Round every corner: cut back up to d metres each side and swing through.
function fillet(pts, d, loop) {
  const n = pts.length, out = [];
  pts.forEach((b, i) => {
    if (!loop && (i === 0 || i === n - 1)) return out.push(b);
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n], la = Math.hypot(a[0] - b[0], a[1] - b[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const turn = Math.abs(angDiff(Math.atan2(c[0] - b[0], c[1] - b[1]), Math.atan2(b[0] - a[0], b[1] - a[1])));
    if (turn < 0.1) return out.push(b);
    const t = Math.min(d, la * 0.45, lc * 0.45), k = Math.max(2, Math.ceil(turn / 0.26));
    const p0 = [b[0] + (a[0] - b[0]) / la * t, b[1] + (a[1] - b[1]) / la * t], p2 = [b[0] + (c[0] - b[0]) / lc * t, b[1] + (c[1] - b[1]) / lc * t];
    for (let j = 0; j <= k; j++) { const u = j / k, w0 = (1 - u) ** 2, w1 = 2 * u * (1 - u), w2 = u * u; out.push([p0[0] * w0 + b[0] * w1 + p2[0] * w2, p0[1] * w0 + b[1] * w1 + p2[1] * w2]); }
  });
  return out;
}
// A one-way route: points, distance along at each, the direction of each stretch, and how fast each bend may be taken
// (the limit reaches back up the road so vehicles brake before the bend, not in it).
function route(id, want, pts, o = {}) {
  const p = fillet(pts, o.bike ? 3 : 7, o.loop);
  if (o.loop) p.push(p[0]);
  const n = p.length, x = new Float32Array(n), z = new Float32Array(n), cum = new Float32Array(n), ux = new Float32Array(n), uz = new Float32Array(n), cap = new Float32Array(n).fill(99);
  p.forEach((q, i) => { x[i] = q[0]; z[i] = q[1]; if (i) { const l = Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]); cum[i] = cum[i - 1] + l; ux[i - 1] = (x[i] - x[i - 1]) / l; uz[i - 1] = (z[i] - z[i - 1]) / l; } });
  for (let i = 1; i < n - 1; i++) { const turn = Math.acos(Math.min(1, ux[i - 1] * ux[i] + uz[i - 1] * uz[i])), r = Math.min(cum[i] - cum[i - 1], cum[i + 1] - cum[i]) / Math.max(turn, 1e-3); cap[i] = Math.max(2.4, Math.min(99, Math.sqrt(2.6 * r))); }
  for (let i = n - 2; i >= 0; i--) cap[i] = Math.min(cap[i], Math.sqrt(cap[i + 1] ** 2 + 4.4 * (cum[i + 1] - cum[i])));
  return { id, x, z, cum, ux, uz, cap, len: cum[n - 1], want: want * cum[n - 1], q: [], stops: [], loop: false, bike: false, ...o };
}
// The point s metres along a route, left in PX, PZ. `i` is the stretch to start looking from; returns the stretch found.
let PX = 0, PZ = 0;
function at(R, s, i) {
  const c = R.cum, n = c.length - 2;
  if (R.loop) s = ((s % R.len) + R.len) % R.len;
  if (i > n) i = n;
  while (i > 0 && c[i] > s) i--;
  while (i < n && c[i + 1] < s) i++;
  PX = R.x[i] + R.ux[i] * (s - c[i]); PZ = R.z[i] + R.uz[i] * (s - c[i]);
  return i;
}
// Where route A crosses route B: [{ a, sa, b, sb, x, z }].
function crossings(A, B, out) {
  for (let i = 0; i + 1 < A.x.length; i++) {
    const ax = A.x[i], az = A.z[i], dx = A.x[i + 1] - ax, dz = A.z[i + 1] - az;
    for (let j = 0; j + 1 < B.x.length; j++) {
      const bx = B.x[j], bz = B.z[j], ex = B.x[j + 1] - bx, ez = B.z[j + 1] - bz, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((bx - ax) * ez - (bz - az) * ex) / den, u = ((bx - ax) * dz - (bz - az) * dx) / den;
      if (t >= 0 && t < 1 && u >= 0 && u < 1) out.push({ a: A, sa: A.cum[i] + t * (A.cum[i + 1] - A.cum[i]), b: B, sb: B.cum[j] + u * (B.cum[j + 1] - B.cum[j]), x: ax + dx * t, z: az + dz * t });
    }
  }
}

function network() {
  const o = 2.8, a = 3.6, p = 4.3, mo = 1.2, mi = 2.2, RING = 18;   // lane centres, metres right of the centre line: 12 m streets, 14 m avenues, Pennsylvania (bike lane down its middle), the 9 m Mall drives (cars park along their outer kerb, so the outer lane sits closer in)
  const PEACE = [-120, 114], GARFIELD = [120, 114], PENN = 109.65, MARYLAND = 70.35;   // the two avenues leave the circles at these bearings (degrees, from +X toward +Z)
  const penn = [[-120, 114], [-205, 352], [-300, 620]], pOut = offset(penn, p), pIn = offset(penn.slice().reverse(), p);
  const mOut = offset([[120, 114], [205, 352]], o)[1], mIn = offset([[205, 352], [120, 114]], o)[0], X = 205 + a;   // where Maryland's two lanes meet Independence
  // Round a circle (keeping it on the left) from the lane coming in along one arm to the lane going out along another.
  // Everyone takes the first exit, so the three arcs of each circle never overlap.
  const round = (c, degIn, dIn, degOut, dOut) => {
    const rad = Math.PI / 180, arm = (deg, d, k) => { const A = deg * rad, r = Math.sqrt((RING + 7) ** 2 - d * d); return [c[0] + Math.cos(A) * r + k * Math.sin(A) * d, c[1] + Math.sin(A) * r - k * Math.cos(A) * d]; };
    const t0 = degIn - Math.asin(dIn / RING) / rad - 14, out = [arm(degIn, dIn, 1)];
    let t1 = degOut + Math.asin(dOut / RING) / rad + 14;
    while (t1 > t0) t1 -= 360;
    for (let n = Math.max(1, Math.round((t0 - t1) / 15)), i = 0; i <= n; i++) { const A = (t0 + (t1 - t0) * i / n) * rad; out.push([c[0] + Math.cos(A) * RING, c[1] + Math.sin(A) * RING]); }
    return [...out, arm(degOut, dOut, -1)];
  };
  const cars = [
    route('a', 1.4, [[-420, 114 + o], ...round(PEACE, 180, o, PENN, p), pOut[1], pOut[2]]),                                    // First St from the north, off up Pennsylvania
    route('b', 1.5, [pIn[0], pIn[1], ...round(PEACE, PENN, p, 0, o), ...round(GARFIELD, 180, o, MARYLAND, o),                 // down Pennsylvania, across the front, out Maryland,
      [mOut[0] - 2.2, mOut[1] - 6.2], [201.4, 356], [205.8, 357], [X, 344], [X, -460]]),                                            // round onto Independence and away east
    route('c', 1.2, [[X, 700], [X, mIn[1] + (X - mIn[0]) * 2.8], ...round(GARFIELD, MARYLAND, o, 0, o), [420, 114 + o]]),
    route('d', 2.4, [[420, 114 - o], ...round(GARFIELD, 0, o, 180, o), ...round(PEACE, 0, o, 180, o), [-420, 114 - o]]),      // First St, south to north, the whole way
    route('e', 0.6, [[205 - a, -460], [205 - a, 700]]),
    route('f', 0.6, [[-205 - a, -460], [-205 - a, 700]]),
    route('g', 0.6, [[-205 + a, 700], [-205 + a, -460]]),                                                                        // Constitution Ave, eastbound: the motorcade's way
    route('h', 0.8, [[-420, 196 + o], [-112 - mo, 196 + o], [-112 - mo, 700]]),
    route('i', 0.45, [[-112 + mi, 700], [-112 + mi, 196 + o], [112 - mi, 196 + o], [112 - mi, 700]]),
    route('j', 0.8, [[112 + mo, 700], [112 + mo, 196 + o], [420, 196 + o]]),
    route('k', 0.8, [[420, 196 - o], [-420, 196 - o]]),
    route('l', 0.8, [[-420, -150 + o], [420, -150 + o]]),
    route('m', 0.6, [[420, -150 - o], [o, -150 - o], [o, -520]]),
    route('n', 0.6, [[-o, -520], [-o, -150 - o], [-420, -150 - o]]),
  ];
  const lane = [[-131.8, 147], [-205, 352], [-296, 610]], mall = [[-48, 204], [-48, 690], [48, 690], [48, 204], [41, 190], [41, 122], [-41, 122], [-41, 190]];
  const bikes = [
    route('penn', 1, [...offset(lane, 0.8), ...offset(lane.slice().reverse(), 0.8)], { loop: true, bike: true, n: 9 }),      // out and back along the centre lane
    route('mall', 1, offset(mall, 1.4, true), { loop: true, bike: true, n: 7 }),                                              // round the pool and down the Mall walks, both ways
    route('llam', 1, offset(mall.slice().reverse(), 1.4, true), { loop: true, bike: true, n: 7 }),
    route('pool', 1, offset([[-41, 122], [41, 122], [41, 179], [-41, 179]], 0.3, true), { loop: true, bike: true, n: 4 }),
  ];

  // Junctions: wherever routes cross (bicycles against bicycles do not count), crossings close together counting as
  // one. Streams that cross get different colours and take turns at the lights: 0 goes with the streets along x, 1
  // with the cross streets. Where two plain streets cross at right angles the site module hangs mast-arm signals
  // (`masts`), and its clock is the one kept here.
  const hits = [], J = [];
  const all = [...cars, ...bikes];
  // How far along R the nearest point to (x, z) is; ND is how far off that leaves it.
  let ND = 0;
  const nearest = (R, x, z) => { let best = 0; ND = Infinity; for (let i = 0; i + 1 < R.x.length; i++) { const t = Math.max(0, Math.min(R.cum[i + 1] - R.cum[i], (x - R.x[i]) * R.ux[i] + (z - R.z[i]) * R.uz[i])), e = Math.hypot(R.x[i] + R.ux[i] * t - x, R.z[i] + R.uz[i] * t - z); if (e < ND) { ND = e; best = R.cum[i] + t; } } return best; };
  const junction = () => { const j = { x: 0, z: 0, masts: false, hits: [], heads: [], n: 2, g: 0, sig: -1, pre: 0, preT: -1, off: 0, demand: -1, want: false, t0: -99, busy: [-9, -9, -9, -9] }; J.push(j); return j; };
  all.forEach((A, i) => all.slice(i + 1).forEach((B) => { if (!(A.bike && B.bike)) crossings(A, B, hits); }));
  for (const h of hits) {
    const near = J.filter((j) => j.hits.some((k) => Math.hypot(k.x - h.x, k.z - h.z) < 26)), j = near[0] || junction();
    for (const o of near.slice(1)) { j.hits.push(...o.hits); J.splice(J.indexOf(o), 1); }
    j.hits.push(h);
  }
  J.forEach((j, n) => {
    for (const h of j.hits) { j.x += h.x / j.hits.length; j.z += h.z / j.hits.length; }
    j.masts = Math.abs(Math.abs(j.x) - 205) < 16 && [114, 196, -150].some((k) => Math.abs(j.z - k) < 16);
    if (!j.masts) j.off = n * 7.3;
    const col = new Map(), todo = [], sOf = (h, R) => (h.a === R ? h.sa : h.b === R ? h.sb : -1);
    for (const h of j.hits) for (const R0 of [h.a, h.b]) {
      if (col.has(R0)) continue;
      const i = at(R0, sOf(h, R0), 0);
      col.set(R0, Math.abs(R0.ux[i]) > Math.abs(R0.uz[i]) ? 0 : 1); todo.push(R0);
      while (todo.length) {                                                 // then outward, each route taking the lowest colour none of its crossers has
        const R = todo.shift();
        for (const k of j.hits) { const o = k.a === R ? k.b : k.b === R ? k.a : null; if (!o || col.has(o)) continue; let c = 0; while (j.hits.some((q) => (q.a === o && col.get(q.b) === c) || (q.b === o && col.get(q.a) === c))) c++; col.set(o, c); todo.push(o); }
      }
    }
    // A stop line before each pass through (a bicycle loop comes back the other way) and the end of the box after it,
    // both far enough out that whoever waits or has just left is clear of the lanes that cross, however shallow the angle.
    const room = (R, s) => { at(R, s, 0); const x = PX, z = PZ; let d = 99; for (const h of j.hits) { const o = h.a === R ? h.b : h.b === R ? h.a : null; if (o) { nearest(o, x, z); d = Math.min(d, ND); } } return d; };
    for (const [R, c] of col) {
      const ss = j.hits.map((h) => sOf(h, R)).filter((s) => s >= 0).sort((a, b) => a - b), clear = R.bike ? 2.4 : 3.4;
      j.n = Math.max(j.n, c + 1);
      for (let k = 0, m; k < ss.length; k = m) {
        for (m = k + 1; m < ss.length && ss[m] - ss[m - 1] < 40;) m++;
        let s0 = ss[k] - (R.bike ? 4.5 : j.masts ? 9.5 : 7), s1 = ss[m - 1] + 5;
        for (let n = 0; n < 30 && room(R, s0) < clear; n++) s0--;
        for (let n = 0; n < 30 && room(R, s1) < clear; n++) s1++;
        R.stops.push({ s: s0, end: s1, j, c });
      }
    }
    if (j.n === 2) for (const c of [0, 1]) if ([...col].every(([R, k]) => k !== c || R.bike)) j.demand = c;   // only bicycles cross here: the cars keep their green until one turns up
  });
  // The site module's other signals, where nothing crosses but people: the foot of the centre walk and the three T-junctions.
  for (const [ids, x, z, back] of [['bd', 0, 114, 8.5], ['k', -112, 196, 10.6], ['k', 112, 196, 10.6], ['l', 0, -150, 12.1]]) {
    const j = junction();
    j.x = x; j.z = z; j.masts = true;
    for (const R of cars) if (ids.includes(R.id)) { const s = nearest(R, x, z); R.stops.push({ s: s - back, end: s + back, j, c: 0 }); }
  }
  for (const R of all) R.stops.sort((s, t) => s.s - t.s);
  return { cars, bikes, J };
}

export async function build(game) {
  const rnd = rng(5050), pick = (list) => list[Math.floor(rnd() * list.length)], span = (lo, hi) => lo + rnd() * (hi - lo);
  const { cars, bikes, J } = network(), vipWay = cars.find((R) => R.id === 'g');

  // ---- parked cars: runs along some kerbs, clear of junctions, circles, crossings and the plaza
  const parked = [], clear = [...J, { x: 0, z: -150 }, { x: -112, z: 196 }, { x: 112, z: 196 }, { x: -205, z: 352 }, { x: 205, z: 352 }];
  for (const [ax, az, bx, bz, d] of [[-400, -150, 400, -150, 5.15], [400, -150, -400, -150, 5.15], [-400, 196, 400, 196, 5.15], [0, -172, 0, -480, 5.15], [0, -480, 0, -172, 5.15],
    [-112, 216, -112, 520, 3.6], [112, 520, 112, 216, 3.6], [205, 92, 205, -420, 6], [-205, -420, -205, 92, 6], [140, 170, 196, 327, 5.15]]) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let s = 4, run = 0, full = false; s < len; s += 6.3) {
      if (run-- <= 0) { full = !full; run = Math.floor(span(1, full ? 6 : 5)); }          // a run of cars, then a run of empty kerb
      const x = ax + ux * s - uz * d, z = az + uz * s + ux * d;
      if (!full || Math.hypot(x, z - 60) > 310 || clear.some((j) => Math.hypot(j.x - x, j.z - z) < 24) || walkAt(x, z, 3)) continue;
      const hatch = rnd() < 0.4, sc = hatch ? [0.9, 0.78, 0.8] : [1, 1, 1];
      parked.push({ type: rnd() < 0.5 ? 'sedan' : 'suv', x: x + span(-0.15, 0.15), y: 0.05, z, ry: Math.atan2(ux, uz) + span(-0.03, 0.03), sx: sc[0], sy: sc[1], sz: sc[2], color: pick(CAR) });
    }
  }

  // ---- traffic lights: a post beside each stop line, its lamp an instance that moves between red, amber and green
  const heads = [];
  for (const R of cars) for (const st of R.stops) if (!st.j.masts) { const i = at(R, st.s + 0.5, 0), h = { c: st.c, x: PX - R.uz[i] * 3.9, z: PZ + R.ux[i] * 3.9, lamp: 0 }; heads.push(h); st.j.heads.push(h); }
  game.scene.add(fixed(heads.flatMap((h) => [box(0.24, 4.3, 0.24, 0x2c2e33, { x: h.x, z: h.z }), box(0.5, 1.55, 0.5, 0x1b1c1f, { x: h.x, y: 4.3, z: h.z })])));

  // ---- meshes: one per shape, every instance hidden until its vehicle comes within sight
  const fleet = (name, n, material = paint) => {
    const here = parked.filter((c) => c.type === name), m = instances(SHAPES[name](), [...Array.from({ length: n }, () => ({ s: 0, color: 0xffffff })), ...here], material);
    m.frustumCulled = false; m.userData.dirty = false;
    if (material === paint) m.geometry.setAttribute('trim', new THREE.InstancedBufferAttribute(new Float32Array((n + here.length) * 3).fill(-1), 3));
    game.scene.add(m);
    return m;
  };
  const riders = bikes.reduce((n, R) => n + R.n, 0), scooters = Math.round(riders * 0.3), count = (shape) => FLEET.reduce((n, f) => n + (f[1] === shape ? f[2] : 0), 0);
  const mesh = {};
  for (const name of ['sedan', 'pickup', 'truck', 'dump', 'bus', 'tour']) mesh[name] = fleet(name, count(name));
  mesh.suv = fleet('suv', count('suv') + 4);                         // four more for the motorcade
  mesh.lamp = fleet('lamp', (FLEET.find((f) => f[0] === 'police')[2] + 1) * 2 + heads.length, glow);   // two flashers for each cruiser and the motorcade's lead car, one lamp for each traffic light
  mesh.bike = fleet('bike', riders - scooters); mesh.scooter = fleet('scooter', scooters); mesh.rider = fleet('rider', riders); mesh.leg = fleet('leg', riders * 2);
  const used = { rider: 0, scooter: 0 }, slot = (name) => (used[name] = (used[name] || 0) + 1) - 1, meshes = Object.values(mesh);
  const dye = (m, i, body, trim = -1) => { m.setColorAt(i, C.set(body)); m.instanceColor.needsUpdate = true; const t = m.geometry.attributes.trim; if (t) { if (trim < 0) t.setXYZ(i, -1, 0, 0); else { C.set(trim); t.setXYZ(i, C.r, C.g, C.b); } t.needsUpdate = true; } };

  // ---- the vehicles
  const vehicles = [], pending = [];
  const make = (kind, shape, sc, body, trim, v0) => {
    const m = mesh[shape], i = slot(shape), v = { kind, x: 0, z: 0, speed: v0, active: false, flash: false, shape, mesh: m, slot: i, sc, len: SIZE[shape][0] * sc[2], wid: SIZE[shape][1] * sc[0], v0, acc: SIZE[shape][0] > 6 ? 1.6 : 2.6,
      gap: 2.4, head: 0.7, routes: '', route: null, s: 0, i: 0, k: 0, yaw: 0, shown: false, honk: 0, lamp: -1, flashT: 0, vip: false, bike: false, box: null, left: 0, held: 0 };
    dye(m, i, body, trim);
    vehicles.push(v);
    return v;
  };
  const flashers = (v) => { v.lamp = slot('lamp'); slot('lamp'); mesh.lamp.setColorAt(v.lamp, C.set(0xff2a22)); mesh.lamp.setColorAt(v.lamp + 1, C.set(0x2f6bff)); };
  for (const h of heads) h.lamp = slot('lamp');
  for (const [kind, shape, n, sc, colours, trim, lo, hi, routes] of FLEET) for (let i = 0; i < n; i++) {
    const v = make(kind, shape, sc, pick(colours), trim, span(lo, hi));
    v.routes = routes;
    if (kind === 'police') { flashers(v); v.flashT = span(5, 40); }
  }
  const convoy = [make('motorcade', 'suv', [1, 1, 1], 0xf2f2ee, 0x1c4da6, 12.5), ...[0, 1, 2].map(() => make('motorcade', 'suv', [1, 1, 1], 0x101113, -1, 12.5))];
  convoy.forEach((v) => { v.vip = true; v.gap = 1.3; v.head = 0.04; v.acc = 3; });
  flashers(convoy[0]); convoy[0].flash = true;

  // everyone else starts spread along the routes, most on the busiest
  const fill = (R) => (R.q.length + 0.5) / R.want, best = (v) => { let b = null; for (const R of cars) if ((!v.routes || v.routes.includes(R.id)) && (!b || fill(R) < fill(b))) b = R; return b; };
  const normal = vehicles.filter((v) => !v.vip);
  for (let i = normal.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [normal[i], normal[j]] = [normal[j], normal[i]]; }
  for (const v of normal) { v.route = best(v); v.route.q.push(v); v.active = true; }
  const nextStop = (v) => { const st = v.route.stops; v.k = 0; while (v.k < st.length && st[v.k].s < v.s + v.len / 2) v.k++; if (v.route.loop && v.k === st.length) v.k = 0; };
  for (const R of cars) R.q.forEach((v, k) => { v.s = R.len * (1 - (k + span(0.3, 0.7)) / R.q.length); nextStop(v); });
  for (const R of bikes) for (let i = 0; i < R.n; i++) {
    const scoot = rnd() < (scooters - used.scooter) / (riders - used.rider), share = rnd() < 0.6;
    const v = make(scoot ? 'scooter' : 'bike', scoot ? 'scooter' : 'bike', [1, 1, 1], scoot ? pick([0x9be22d, 0xf2f2ee, 0xf28c28, 0x2fb7c4]) : share ? 0xd02a2a : pick(CAR), -1, scoot ? span(4.5, 6.2) : share ? span(4.3, 6) : span(6, 8.5));
    v.bike = true; v.acc = 1.6; v.rider = slot('rider'); v.pedal = span(0, 6); v.lat = span(-0.45, 0.45); v.swerve = 0; v.route = R; v.s = span(0, R.len); v.active = true;
    dye(mesh.rider, v.rider, pick(SHIRTS), pick(SKINS)); const legs = pick(LEGS); dye(mesh.leg, v.rider * 2, legs); dye(mesh.leg, v.rider * 2 + 1, legs);
    nextStop(v); R.q.push(v);
  }

  // ---- people standing about: x, z, how wide a berth. The player first, then whoever else is in the room.
  const who = new Float32Array(64 * 3);
  let nWho = 0, honked = 0, convoyT = 30, convoyIn = 0, convoyWaits = 0;
  const addOther = (r) => { if (nWho < 64) { who[nWho * 3] = r.pos.x; who[nWho * 3 + 1] = r.pos.z; who[nWho * 3 + 2] = 0.7; nWho++; } };

  function drive(v, lead, dt, time) {
    const R = v.route, half = v.len / 2;
    let lim = Math.min(v.v0, Math.sqrt(R.cap[v.i + 1] ** 2 + 4.4 * Math.max(0, R.cum[v.i + 1] - v.s))), max = Infinity;
    if (lead) {                                                             // keep off the one in front
      const g = lead.s - lead.len / 2 - v.s - half - v.gap;
      lim = Math.min(lim, g > 0 ? Math.sqrt(lead.speed ** 2 + 7 * Math.max(0, g - v.head * v.speed)) : Math.max(0, lead.speed + g * 2));
      max = lead.s - lead.len / 2 - half - 0.5;
    }
    const st = R.stops[v.k];
    if (st) {                                                               // the next light
      const j = st.j;
      let d = st.s - v.s - half, go = j.g === st.c;
      if (R.loop) { d = ((d % R.len) + R.len) % R.len; if (d > R.len - 40) d -= R.len; }
      if (j.demand === st.c && d > 0 && d < 30) j.want = true;             // a bicycle coming up to a crossing asks for the light
      if (go && lead && lead.speed < 1.5 && lead.s - lead.len / 2 > st.s && lead.s - lead.len / 2 < st.end + v.len + 2) go = false;   // no room on the far side: do not block the junction
      if (go && v.held < 45) for (let c = 0; c < j.n; c++) if (c !== st.c && time - j.busy[c] < 0.25) go = false;                   // somebody from the other street is still crossing
      if (v.vip) { go = true; if (d < 90) { j.pre = st.c; j.preT = time + 3; } }                                                     // the motorcade gets its lights turned for it
      if (d >= -1 && !go && (v.speed < 1 || d > v.speed * v.speed / 12 - 0.5)) { lim = Math.min(lim, Math.sqrt(7 * Math.max(0, d - 0.3))); if (j.g === st.c && v.speed < 0.5) v.held += dt; }
      else if (d < -1 || !go) { v.box = st; v.left = d + st.end - st.s + v.len; v.held = 0; v.k = R.loop ? (v.k + 1) % R.stops.length : v.k + 1; }   // over the line (or too late to stop): in the box until the tail is out
    }
    if (v.left > 0) v.box.j.busy[v.box.c] = time;
    let dodge = 0;
    for (let n = 0; n < nWho; n++) {                                        // people in the way
      const dx = who[n * 3] - v.px, dz = who[n * 3 + 1] - v.pz;
      if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
      const ahead = dx * R.ux[v.i] + dz * R.uz[v.i] - half, side = dz * R.ux[v.i] - dx * R.uz[v.i], pad = who[n * 3 + 2];
      if (v.bike) {                                                         // bicycles go round, with a ring of the bell
        const off = side - v.lat;
        if (ahead > -1 && ahead < 11 && Math.abs(off) < 0.9 + pad) {
          dodge = off + (off > 0 ? -1 : 1) * (0.9 + pad);
          if (!n && v.honk <= 0 && ahead > 1) { v.honk = 4; game.hud.pop('DING', v.x, 1.9, v.z); game.bus.emit('ding', { x: v.x, y: 1, z: v.z, kind: v.kind }); }
        }
      } else if (ahead > -1 && ahead < 14 && Math.abs(side) < v.wid / 2 + pad) {
        const stop = Math.sqrt(7 * Math.max(0, ahead - 1.6));
        if (stop >= lim) continue;                                          // already held up by the car in front or a light
        lim = stop;
        if (!n && v.speed < 0.6 && v.honk <= 0 && time > honked) { v.honk = span(4, 7); honked = time + 3.5; game.hud.pop('HONK', v.x, 2.4, v.z); game.bus.emit('honk', { x: v.x, y: 1.2, z: v.z, kind: v.kind }); }
      }
    }
    v.honk -= dt;
    v.speed += Math.max(-9 * dt, Math.min(v.acc * dt, lim - v.speed));
    const s = Math.min(v.s + v.speed * dt, max);
    if (s > v.s) { v.left -= s - v.s; v.s = s; } else v.speed = 0;
    if (R.loop && v.s >= R.len) { v.s -= R.len; v.i = 0; }
    v.i = at(R, v.s, v.i); v.px = PX; v.pz = PZ;
    if (v.bike) { v.swerve += (dodge - v.swerve) * Math.min(1, dt * 4); const o = v.lat + v.swerve; v.x = PX - R.uz[v.i] * o; v.z = PZ + R.ux[v.i] * o; v.pedal += v.speed * dt * 1.3; } else { v.x = PX; v.z = PZ; }
    if (v.kind === 'police' && (v.flashT -= dt) < 0) { v.flash = !v.flash; v.flashT = v.flash ? span(6, 12) : span(25, 60); }
  }

  const put = (m, i, mat) => { m.setMatrixAt(i, mat); m.userData.dirty = true; };
  function hide(v) {
    v.shown = false; put(v.mesh, v.slot, ZERO);
    if (v.lamp >= 0) { put(mesh.lamp, v.lamp, ZERO); put(mesh.lamp, v.lamp + 1, ZERO); }
    if (v.bike) { put(mesh.rider, v.rider, ZERO); put(mesh.leg, v.rider * 2, ZERO); put(mesh.leg, v.rider * 2 + 1, ZERO); }
  }
  function show(v, time) {
    const R = v.route, half = v.len / 2;
    const i = at(R, v.s - half * 0.6, v.i), rx = PX, rz = PZ;               // steer by where the back and front axles are on the road
    at(R, v.s + half * 0.6, i);
    const yaw = Math.atan2(PX - rx, PZ - rz), grow = R.loop ? 1 : Math.max(0.001, Math.min(1, (v.s + half) / 10, (R.len - v.s + half) / 10));   // shrink away at the two ends of the road
    const ox = v.x - v.px, oz = v.z - v.pz, x = (PX + rx) / 2 + ox, z = (PZ + rz) / 2 + oz;
    v.shown = true; v.yaw = yaw;
    BM.compose(V.set(x, 0.05, z), Q.setFromAxisAngle(UP, yaw), S.set(v.sc[0] * grow, v.sc[1] * grow, v.sc[2] * grow));
    put(v.mesh, v.slot, BM);
    if (v.lamp >= 0) {                                                      // two roof flashers taking turns
      const on = v.flash ? Math.floor(time * 5) % 2 : -1, y = v.shape === 'suv' ? 1.9 : 1.47, lz = v.shape === 'suv' ? -0.3 : -0.4;
      for (let k = 0; k < 2; k++) put(mesh.lamp, v.lamp + k, on === k ? M2.multiplyMatrices(BM, M.compose(V.set(k ? 0.3 : -0.3, y, lz), Q.identity(), ONE)) : ZERO);
    }
    if (v.bike) {
      const scoot = v.kind === 'scooter', hy = scoot ? 1.0 : 0.97, hz = scoot ? -0.16 : -0.22;
      put(mesh.rider, v.rider, M2.multiplyMatrices(BM, M.compose(V.set(0, hy, hz), Q.setFromAxisAngle(XA, scoot ? 0.12 : 0.6), ONE)));
      for (let k = 0; k < 2; k++) {                                         // each leg reaches from the hip to its pedal (or its place on the deck)
        const a = v.pedal + k * Math.PI, fy = scoot ? 0.24 : 0.36 + Math.cos(a) * 0.16, fz = scoot ? (k ? 0.14 : -0.2) : 0.02 + Math.sin(a) * 0.16, dy = fy - hy, dz = fz - hz;
        put(mesh.leg, v.rider * 2 + k, M2.multiplyMatrices(BM, M.compose(V.set(k ? 0.1 : -0.1, hy, hz), Q.setFromAxisAngle(XA, Math.atan2(-dz, -dy)), S.set(1, Math.hypot(dy, dz) / LEG, 1))));
      }
    }
  }

  const FAR2 = 460 * 460;
  function update(dt) {
    const time = game.time, P = game.player, cam = game.cam ? game.cam.pos : null, cx = cam ? cam[0] : game.camera.position.x, cz = cam ? cam[2] : game.camera.position.z;
    for (const j of J) {
      let sig;                                                              // what the lamps show: colour * 2 (+ 1 on amber), or 9 for red all round
      if (j.demand >= 0) {                                                  // a crossing only bicycles use: stop the cars for nine seconds when one asks
        if (j.want && time - j.t0 > 23) j.t0 = time;
        j.want = false;
        const u = time - j.t0, car = 1 - j.demand;
        j.g = u < 4 ? -1 : u < 9 ? j.demand : u < 13 ? -1 : car;
        sig = u < 2.5 ? car * 2 + 1 : u < 13 ? 9 : car * 2;
      } else {                                                              // each colour in turn: green, then two seconds of amber; nobody sets off across in the last moments of a green
        const turn = j.n > 2 ? 15 : CYCLE / 2, u = (time + j.off) % (turn * j.n), c = Math.floor(u / turn), left = turn - AMBER - u % turn;   // a three-way junction is nobody else's business, and needs longer turns
        j.g = time < j.preT ? j.pre : left > 1.5 ? c : -1;
        sig = time < j.preT ? j.pre * 2 : c * 2 + (left > 0 ? 0 : 1);
      }
      if (sig !== j.sig) { j.sig = sig; for (const h of j.heads) { const col = sig === 9 || sig >> 1 !== h.c ? 0 : sig & 1 ? 1 : 2; put(mesh.lamp, h.lamp, M.compose(V.set(h.x, 5.3 - col * 0.5, h.z), Q.identity(), S.set(1.6, 2.1, 1.9))); mesh.lamp.setColorAt(h.lamp, C.set(LIGHTS[col])); mesh.lamp.instanceColor.needsUpdate = true; } }
    }
    nWho = 0;
    if (P && P.pos) { who[0] = P.pos.x; who[1] = P.pos.z; who[2] = P.inVehicle ? 3 : 0.7; nWho = 1; game.net?.remotes?.forEach(addOther); }
    if (dt > 0) {
      for (const R of cars) {
        for (let k = 0; k < R.q.length; k++) drive(R.q[k], k ? R.q[k - 1] : null, dt, time);
        while (R.q.length && R.q[0].s - R.q[0].len / 2 > R.len) { const v = R.q.shift(); v.route = null; v.active = false; if (v.shown) hide(v); if (v.vip) convoyIn--; else pending.push(v); }
      }
      for (const R of bikes) for (const v of R.q) drive(v, null, dt, time);
      // the motorcade: every few minutes, the lead car and three black SUVs come down Constitution nose to tail
      if (convoyIn <= 0 && (convoyT -= dt) < 0) { convoyT = span(150, 240); convoyIn = convoyWaits = convoy.length; for (const v of convoy) pending.push(v); }
      for (let n = 0, held = false; n < pending.length; n++) {
        const v = pending[n], R = v.vip ? vipWay : best(v), tail = R.q[R.q.length - 1];
        if (v.vip ? held || (held = !!tail && tail.s - tail.len / 2 < 1.4) : (R === vipWay && convoyWaits > 0) || (tail && tail.s - tail.len / 2 < 9)) continue;
        if (v.vip) convoyWaits--;
        v.route = R; v.s = -v.len / 2; v.i = 0; v.k = 0; v.left = 0; v.held = 0; v.speed = tail ? Math.min(v.v0, tail.speed + 1) : v.v0; v.active = true; R.q.push(v);
        v.i = at(R, v.s, 0); v.px = v.x = PX; v.pz = v.z = PZ;
        pending.splice(n--, 1);
      }
    }
    for (const v of vehicles) {
      if (!v.route) continue;
      const dx = v.x - cx, dz = v.z - cz;
      if (dx * dx + dz * dz < FAR2) show(v, time); else if (v.shown) hide(v);
    }
    for (const m of meshes) if (m.userData.dirty) { m.instanceMatrix.needsUpdate = true; m.userData.dirty = false; }
  }

  for (const R of [...cars, ...bikes]) for (const v of R.q) { v.i = at(R, v.s, 0); v.px = v.x = PX; v.pz = v.z = PZ; }
  return { update, vehicles, motorcade() { convoyT = 0; } };   // motorcade(): send the next one now (for filming)
}
