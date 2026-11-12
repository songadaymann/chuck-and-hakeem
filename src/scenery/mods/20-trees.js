import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ps1ify } from '../../ps1.js';
import { ROADS, WALKS, POOL, CIRCLES, MALL, blocked, nearMound, inGrounds, rng } from '../plan.js';
import { place, card, instances, mesh, decal, paintBoth, glowFar, hazed } from '../kit.js';

// The urban forest in mid-November: elms in gold down the Mall, a different tree on every street, Olmsted's clumps
// on the Capitol lawns, cherries and willows round the pool, clipped hedges, a canopy over the city blocks and a
// band of woods on the horizon. Every tree is stamped out of a small template (three sizes of detail by how close
// a player can get) into one mesh per district, so a district out of view costs nothing.
const TAU = Math.PI * 2, GRASS = 0x4e783e;
const A = new THREE.Color(), B = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();

// trunk [radius, height, bark]; rings [radius, height] foot to tip: the crown turned on a lathe with `n` sides;
// lo / hi: leaf colour at the foot and top of the crown; limbs, lumps (blobs of leaf) and weep (hanging strands) only on
// the full-detail tree; gap: room it wants; litter: colour of the leaves it has dropped; flex: how far it sways.
const KIND = {
  elm:        { trunk: [0.62, 9.5, 0x473d36], rings: [[1.2, 9], [6.8, 15.5], [8.3, 19.5], [6.2, 23], [0, 24.8]], n: 7, lo: 0xb5861e, hi: 0xecc63c, gap: 6.5, litter: 0xcda22e },
  willowOak:  { trunk: [0.6, 6, 0x4f4238], rings: [[1.6, 5.5], [6.6, 9], [7.4, 13.5], [4.8, 18], [0, 20.5]], n: 7, lo: 0x94702a, hi: 0xcfa544, lumps: 2, lump: [0x8d8436, 0xbcaa48], gap: 6, litter: 0xa07f36 },
  redOak:     { trunk: [0.8, 4.8, 0x3f342c], rings: [[2, 4.5], [9, 7.5], [9.6, 11.5], [5.6, 15.5], [0, 17.5]], n: 8, lo: 0x7a3519, hi: 0xb5562b, limbs: 3, lumps: 1, lump: [0x80542a, 0xad7a34], gap: 7.5, litter: 0x85502a },
  redMaple:   { trunk: [0.36, 3.6, 0x5a4b42], rings: [[1, 3.4], [4, 6.5], [4.3, 10], [2.3, 13], [0, 14.6]], n: 6, lo: 0xb41c1e, hi: 0xf2421f, lumps: 1, lump: [0xd8301c, 0xff5e2a], gap: 3.8, litter: 0xbf3d26 },
  sugarMaple: { trunk: [0.46, 4, 0x54463c], rings: [[1.2, 3.8], [5.6, 7.4], [6.1, 11.5], [3.6, 15], [0, 17]], n: 7, lo: 0xd8581a, hi: 0xf89c1e, lumps: 2, lump: [0xee8a1c, 0xfcc630], gap: 5, litter: 0xdd7d2a },
  ginkgo:     { trunk: [0.3, 3.6, 0x6b6054], rings: [[0.8, 3.4], [2.7, 6.6], [2.9, 10.2], [1.8, 13.8], [0, 17]], n: 5, lo: 0xe0b918, hi: 0xffe840, gap: 2.8, litter: 0xf4d52c, carpet: 1.9 },
  cherry:     { trunk: [0.36, 2.4, 0x3a2e2b], rings: [[1.8, 3.2], [4.4, 4.7], [3.8, 6.2], [0, 7.2]], n: 6, lo: 0xf2a6c4, hi: 0xffe6ef, limbs: 2, lumps: 3, lump: [0xf4b0cb, 0xfff0f5], gap: 4, litter: 0xf4c8d7 },
  willow:     { trunk: [0.6, 7.6, 0x4a4034], rings: [[5, 3], [6.2, 8.6], [4.4, 11.4], [0, 13]], n: 9, lo: 0x7c8830, hi: 0xc9c552, limbs: 2, weep: 12, gap: 6, litter: 0xaaa646, flex: 1.6 },
  magnolia:   { trunk: [0.4, 1.4, 0x4a4038], rings: [[3.3, 0.8], [4.3, 3.2], [3, 7.2], [1.5, 10.6], [0, 12.6]], n: 7, lo: 0x163a21, hi: 0x30703c, lumps: 1, lump: [0x4e3f22, 0x2e6b3a], gap: 4, pad: 4, flex: 0.5 },
  pine:       { trunk: [0.42, 20.5, 0x4c3b30], rings: [[0.6, 5], [4.6, 7.5], [2.6, 14], [0, 22.5]], n: 5, lo: 0x1c4436, hi: 0x3d735a, tiers: { n: 5, y: 6.5, step: 3.1, r: 5, shrink: 0.82, droop: -0.3 }, gap: 3.8, flex: 0.6 },
  cedar:      { trunk: [0.5, 16, 0x4c3b30], rings: [[4.8, 1.2], [5.4, 3.2], [2.6, 10], [0, 18.5]], n: 6, lo: 0x315649, hi: 0x71957f, tiers: { n: 4, y: 1.6, step: 4, r: 6, shrink: 0.72, droop: 1 }, gap: 4.6, pad: 4.5, flex: 0.6 },
  holly:      { trunk: [0.2, 0.6, 0x4a4038], rings: [[2, 0.4], [1.7, 2.4], [0, 5.2]], n: 6, lo: 0x143a20, hi: 0x275e31, berries: 0xd61f1f, gap: 2, pad: 2.2, flex: 0.3 },
  boxwood:    { rings: [[0.95, 0], [1.15, 0.65], [0.7, 1.3], [0, 1.5]], n: 6, lo: 0x2c5a2c, hi: 0x5c8c3e, gap: 1, pad: 1, low: true, flex: 0 },
  hedge:      { lo: 0x25492a, hi: 0x44763f, low: true, flex: 0 },
  bare:       { trunk: [0.5, 6.5, 0x4b3f37], gap: 4, litter: 0x7d5c36, still: true, flex: 0.7 },
};
for (const k of Object.values(KIND)) if (k.rings) k.spread = Math.max(...k.rings.map((r) => r[0]));
KIND.bare.spread = 5;
const STREET = { 'first-w': 'ginkgo', 'third-w': 'sugarMaple', 'first-e': 'redMaple', constitution: 'willowOak', independence: 'redOak', pennsylvania: 'willowOak', maryland: 'redMaple', 'east-capitol': 'elm', madison: 'elm', jefferson: 'elm' };
const LAWN = ['willowOak', 'willowOak', 'redOak', 'redOak', 'elm', 'sugarMaple', 'sugarMaple', 'redMaple', 'redMaple', 'ginkgo', 'pine', 'cedar', 'magnolia', 'magnolia', 'bare', 'cherry', 'holly'];
const CITY = ['willowOak', 'willowOak', 'redOak', 'elm', 'sugarMaple', 'redMaple', 'pine', 'ginkgo', 'bare'];

// Leaves and bark: flat-faced from welded corners (far fewer vertices than splitting every face), and a slow sway
// done in the vertex shader, weighted by how high up the tree a corner is, so it costs nothing on the CPU.
const wind = { value: 0 };
const leafy = ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
const snapOnly = leafy.onBeforeCompile;
leafy.onBeforeCompile = (sh) => {
  snapOnly(sh);
  sh.uniforms.uWind = wind;
  sh.vertexShader = 'uniform float uWind;\nattribute float sway;\n' + sh.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\n float gust = uWind + position.x * 0.06 + position.z * 0.05; transformed.xz += sway * vec2(sin(gust), cos(gust * 0.8)) * 0.6;');
  // leaves let light through: the underside of a crown glows a little instead of going black
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.22;');
};

// Paint a shape from one colour at its foot to another at its top.
function dye(geo, lo, hi = lo) {
  const p = geo.attributes.position, a = new Float32Array(p.count * 3);
  geo.computeBoundingBox();
  const y0 = geo.boundingBox.min.y, h = geo.boundingBox.max.y - y0 || 1;
  A.set(lo); B.set(hi);
  for (let i = 0; i < p.count; i++) { const t = (p.getY(i) - y0) / h; a[i * 3] = A.r + (B.r - A.r) * t; a[i * 3 + 1] = A.g + (B.g - A.g) * t; a[i * 3 + 2] = A.b + (B.b - A.b) * t; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
  return geo;
}
// An open pole from radius r0 at the foot to r1 at the top; a branch from a to b; a faceted blob of leaves; a small gem.
const tube = (r0, r1, h, n, color, o) => place(dye(new THREE.CylinderGeometry(r1, r0, h, n, 1, true).translate(0, h / 2, 0), color), o);
function limb(a, b, r, color) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  return tube(r, r * 0.4, len, 3, color, { x: a[0], y: a[1], z: a[2], ry: Math.atan2(dx, dz), rx: Math.acos(dy / len) });
}
const blob = (x, y, z, rx, ry, rz, lo, hi, turn) => place(dye(new THREE.IcosahedronGeometry(1, 0), lo, hi), { x, y, z, sx: rx, sy: ry, sz: rz, ry: turn });
const gem = (x, y, z, r, color) => place(dye(new THREE.OctahedronGeometry(r, 0), color), { x, y, z });
// A crown turned on a lathe: rings [radius, height] from the foot up, each one wobbled and turned half a side from the
// last so no two faces match. A zero radius closes that end to a point.
function lathe(rings, n, lo, hi, r, wob = 0.16) {
  const turn = r() * TAU, v = [];
  const pts = rings.map(([rad, y], k) => (rad ? Array.from({ length: n }, (_, i) => {
    const a = turn + (i + k * 0.5) / n * TAU, q = rad * (1 + (r() - 0.5) * 2 * wob);
    return [Math.cos(a) * q, y + (k ? (r() - 0.5) * wob * rad : 0), Math.sin(a) * q];
  }) : [[0, y, 0]]));
  for (let k = 0; k + 1 < pts.length; k++) for (let i = 0, L = pts[k], U = pts[k + 1]; i < n; i++) {
    const j = (i + 1) % n;
    if (L.length > 1) v.push(...L[i], ...U[i % U.length], ...L[j]);
    if (U.length > 1) v.push(...L[j % L.length], ...U[i], ...U[j]);
  }
  return dye(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3)), lo, hi);
}

// One tree as a list of painted shapes. lod 2: seen from under its branches; 1: across a street; 0: far off.
function tree(k, lod, r, v) {
  const full = lod > 1, parts = [];
  if (k === KIND.hedge) return [dye(new THREE.BoxGeometry(1.5, 1.2, 1).translate(0, 0.6, 0), k.lo, k.hi)];
  if (!k.rings) {   // already bare: a trunk, a fan of limbs and a twig on each. Every other one is a white-barked sycamore.
    const bark = v % 2 ? 0xcbc3b2 : k.trunk[2], n = full ? 5 : 3;
    parts.push(tube(k.trunk[0], k.trunk[0] * 0.6, k.trunk[1], full ? 5 : 3, bark));
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + r() * 0.9, d = 2.5 + r() * 3, y = 10.5 + r() * 5, tip = [Math.cos(a) * d, y, Math.sin(a) * d];
      parts.push(limb([0, 5 + r() * 1.4, 0], tip, 0.26, bark));
      if (full) parts.push(limb([tip[0] * 0.55, 5.6 + (y - 5.6) * 0.55, tip[2] * 0.55], [tip[0] * 0.5 + (r() - 0.5) * 5, y + r() * 2.5, tip[2] * 0.5 + (r() - 0.5) * 5], 0.14, bark));
    }
    return parts;
  }
  const wide = k.rings.reduce((a, b) => (b[0] > a[0] ? b : a)), [R, yR] = wide;
  if (k.trunk) parts.push(tube(k.trunk[0], k.trunk[0] * (k.tiers ? 0.25 : 0.6), k.trunk[1] + (k.tiers ? 0 : 1.2), full ? (k.trunk[0] > 0.45 ? 5 : 4) : 3, k.trunk[2]));
  if (full && k.tiers) {   // conifers: shelves of needles up a bare pole
    const T = k.tiers;
    for (let i = 0, y = T.y, rad = T.r; i < T.n; i++, y += T.step, rad *= T.shrink) {
      parts.push(place(lathe([[0, y + T.droop], [rad * (0.85 + r() * 0.3), y], [0, y + T.step * 1.3]], k.n, k.lo, k.hi, r, 0.22), { x: (r() - 0.5) * rad * 0.3, z: (r() - 0.5) * rad * 0.3 }));
    }
    return parts;
  }
  const tip = k.rings.at(-1);   // far off, a broad crown gets a flatter top so it does not read as a diamond on a stick
  const rings = full ? k.rings : lod ? [...new Set([k.rings[0], wide, k.rings.at(-2), tip])] : [k.rings[0], wide, R > 4 ? [0, yR + (tip[1] - yR) * 0.6] : tip];
  parts.push(lathe(full && k.weep ? [[0, yR - 0.4], ...rings.slice(1)] : rings, full ? k.n : 5 + lod, k.lo, k.hi, r));
  if (!full) return parts;
  for (let i = 0; i < (k.weep || 0); i++) {   // a willow's curtain: long spindles hanging from under the crown, a few more inside
    const a = i / k.weep * TAU + r() * 0.4, d = i % 3 > 1 ? 2.6 : R * (0.8 + r() * 0.15), foot = 1.4 + r() * 2.6;
    parts.push(place(lathe([[0, foot], [1.1 + r() * 0.5, yR - 1], [0, yR + 1.2]], 4, k.lo, k.hi, r, 0.2), { x: Math.cos(a) * d, z: Math.sin(a) * d }));
  }
  for (let i = 0; i < (k.limbs || 0); i++) { const a = i / k.limbs * TAU + r(), d = R * (0.5 + r() * 0.2); parts.push(limb([0, k.trunk[1] * 0.8, 0], [Math.cos(a) * d, yR + r() * 2, Math.sin(a) * d], k.trunk[0] * 0.55, k.trunk[2])); }
  for (let i = 0; i < (k.lumps || 0); i++) {
    const a = r() * TAU, d = R * (0.5 + r() * 0.3), q = R * (0.42 + r() * 0.14);
    parts.push(blob(Math.cos(a) * d, yR + (r() - 0.3) * R * 0.5, Math.sin(a) * d, q, q * 0.72, q, ...(k.lump || [k.lo, k.hi]), r() * 3));
  }
  if (k.berries) for (let i = 0; i < 5; i++) { const a = r() * TAU, h = 0.9 + r() * 2.8, d = h < 2.4 ? 2.1 : 1.8 * (5.2 - h) / 2.8; parts.push(gem(Math.cos(a) * d, h, Math.sin(a) * d, 0.32, k.berries)); }
  return parts;
}
// Weld a tree into a template: corners, colours, triangles, and how tall it stands.
function template(parts, flex) {
  const g = mergeVertices(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))));
  const pos = g.attributes.position.array;
  let top = 0.1; for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  return { pos, col: g.attributes.color.array, idx: g.index.array, top, flex };
}
// Every stamp of every template in one district -> one mesh.
function bake(list) {
  let nv = 0, ni = 0;
  for (const s of list) { nv += s.t.pos.length / 3; ni += s.t.idx.length; }
  const pos = new Float32Array(nv * 3), col = new Uint8Array(nv * 3), sway = new Uint8Array(nv), idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  let v = 0, at = 0;
  for (const s of list) {
    const { pos: p, col: c, idx: ix, top, flex } = s.t, cs = Math.cos(s.ry) * s.s, sn = Math.sin(s.ry) * s.s, n = p.length / 3;
    for (let i = 0, o = v * 3; i < n; i++, o += 3) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2] * s.sl;
      pos[o] = s.x + x * cs + z * sn; pos[o + 1] = y * s.s * s.sy; pos[o + 2] = s.z - x * sn + z * cs;
      col[o] = Math.min(255, c[i * 3] * s.r * 255); col[o + 1] = Math.min(255, c[i * 3 + 1] * s.g * 255); col[o + 2] = Math.min(255, c[i * 3 + 2] * s.b * 255);
      sway[v + i] = Math.min(255, flex * (y / top) ** 2 * s.s * 110);
    }
    for (let i = 0; i < ix.length; i++) idx[at++] = ix[i] + v;
    v += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3, true)); g.setAttribute('sway', new THREE.BufferAttribute(sway, 1, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return mesh(g, leafy);
}

// Dropped leaves: a ragged patch under each tree, its colour running out into the grass at the edge.
function carpet(list, r) {
  const pos = [], col = [], idx = [];
  for (const [x, z, rad, color] of list) {
    const c = pos.length / 3, turn = r() * TAU;
    A.set(color); B.set(GRASS).lerp(A, 0.45);
    pos.push(x, 0.12, z); col.push(A.r, A.g, A.b);
    for (let i = 0; i < 6; i++) { const a = turn + i / 6 * TAU, q = rad * (0.7 + r() * 0.5); pos.push(x + Math.cos(a) * q, 0.12, z + Math.sin(a) * q); col.push(B.r, B.g, B.b); idx.push(c, c + 1 + (i + 1) % 6, c + 1 + i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return mesh(g, decal);
}

// Woods on the horizon, past the fog: two ragged walls of autumn colour all the way round, painted already hazed.
function treeLine() {
  const r = rng(404), pos = [], col = [], TONES = [0x7a5a2c, 0x8a6a2e, 0x6e4426, 0x5a5a34, 0x84502a, 0x4f5636, 0x94742e];
  for (const [R, h, n] of [[900, 12, 300], [1020, 20, 260]]) {
    const tops = Array.from({ length: n }, () => h * (0.7 + r() * 0.6));
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, b = (i + 1) / n * TAU, ax = Math.cos(a) * R, az = Math.sin(a) * R, bx = Math.cos(b) * R, bz = Math.sin(b) * R, ta = tops[i], tb = tops[(i + 1) % n];
      pos.push(ax, -3, az, bx, -3, bz, ax, ta, az, bx, -3, bz, bx, tb, bz, ax, ta, az);
      A.set(hazed(TONES[Math.floor(r() * TONES.length)], R - 300));
      for (let k = 0; k < 6; k++) col.push(A.r, A.g, A.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return mesh(g, glowFar);
}

// Tall things stay out of the long views: from where players appear to both dirt piles and the dome, and the open
// axis from the west front down the pool and the Mall.
const vista = (x, z) => { const ax = Math.abs(x); return z > 34 && ax < (z < 95 ? 22 + (95 - z) * 1.25 : z < 126 ? 58 : 46); };
// Ground the site module has dressed: the contractor's yard off each end of the building, and the Christmas tree going
// up on the north lawn. Hedges may edge the yard; nothing is planted in it.
const yard = (x, z) => (Math.abs(Math.abs(x) - 99) < 13 && z > -24 && z < 50) || Math.hypot(x + 92, z - 92) < 11;
const district = (x, z) => (x < -198 ? (z < 150 ? 'north-e' : 'north-w') : x > 198 ? (z < 150 ? 'south-e' : 'south-w') : z < -144 ? 'east'
  : z > 190 ? (z < 430 ? 'mall-near' : 'mall-far') : z > 40 ? (x < 0 ? 'lawn-n' : 'lawn-s') : (x < 0 ? 'back-n' : 'back-s'));
const cell = (x, z, size) => Math.floor(x / size) * 4096 + Math.floor(z / size);

export async function build(game) {
  const rnd = rng(1791), districts = {}, templates = new Map(), taken = new Map(), groves = new Map(), carpets = [[], []];
  const tpl = (kind, lod, v) => {
    const key = kind + lod + v;
    if (!templates.has(key)) templates.set(key, template(tree(KIND[kind], lod, rng([...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 99991, 7)), v), KIND[kind].flex ?? 1));
    return templates.get(key);
  };
  const crowded = (x, z, gap) => { for (let i = -1; i < 2; i++) for (let j = -1; j < 2; j++) for (const t of taken.get(cell(x + i * 16, z + j * 16, 16)) || []) if (Math.hypot(x - t[0], z - t[1]) < gap + t[2]) return true; return false; };
  const claim = (x, z, gap) => { const c = cell(x, z, 16); if (!taken.has(c)) taken.set(c, []); taken.get(c).push([x, z, gap]); };
  // the city module says where its buildings stand; without it the trees simply have the blocks to themselves
  const built = await import('./30-skyline.js').then((m) => m.footprints()).catch(() => []);
  const solid = (x, z, pad) => built.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);
  const stamp = (t, x, z, ry, s, sy, sl, k) => (districts[district(x, z)] ||= []).push({ t, x, z, ry, s, sy, sl, r: k * (0.93 + rnd() * 0.14), g: k * (0.93 + rnd() * 0.14), b: k });

  // Put one tree in the ground if the spot is free. o: { s: size, gap: room, lod: most detail it may have }.
  function plant(kind, x, z, o = {}) {
    const k = KIND[kind], d = Math.hypot(x, z), gap = o.gap ?? k.gap;
    if (blocked(x, z, k.pad ?? 1.6) || nearMound(x, z, gap + 2) || yard(x, z) || (!k.low && vista(x, z)) || crowded(x, z, gap) || solid(x, z, gap * 0.6)) return false;
    const lod = Math.min(o.lod ?? 2, d < 350 ? 2 : d < 420 ? 1 : 0), s = (o.s ?? 1) * (0.84 + rnd() * 0.34);
    claim(x, z, gap);
    stamp(tpl(kind, lod, Math.floor(rnd() * (lod > 1 ? 3 : 2))), x, z, rnd() * TAU, s, 0.92 + rnd() * 0.22, 1, 0.86 + rnd() * 0.26);
    if (k.litter && d < 365) {
      carpets[z > 196 ? 1 : 0].push([x, z, k.spread * s * (k.carpet || 0.95), k.litter]);
      const c = cell(x, z, 24);
      if (!k.still) { if (!groves.has(c)) groves.set(c, []); groves.get(c).push([x, z, k.rings.at(-1)[1] * s, k.spread * s, k.litter]); }
    }
    return true;
  }
  // Walk a line of [x, z] points calling fn(x, z) every `step` metres on both sides, `off` metres out from the middle.
  function along(pts, step, off, fn) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let d = step / 2; d < len; d += step) for (const side of [-1, 1]) { const j = d + (rnd() - 0.5) * step * 0.2; fn(ax + ux * j + uz * off * side, az + uz * j - ux * off * side); }
    }
  }
  // A clipped hedge from a to b, in pieces about four metres long, broken wherever a path or street crosses.
  function hedge(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 4));
    for (let i = 0; i < n; i++) {
      const x = ax + (bx - ax) * (i + 0.5) / n, z = az + (bz - az) * (i + 0.5) / n;
      if (blocked(x, z, 0.7)) continue;
      claim(x, z, 1.2);
      stamp(tpl('hedge', 2, 0), x, z, Math.atan2(bx - ax, bz - az), 1, 0.9 + rnd() * 0.2, len / n, 0.88 + rnd() * 0.24);
    }
  }

  // The Mall: four straight rows of elms each side, with the odd gap, dead tree and young replacement.
  for (const side of [-1, 1]) for (const row of MALL.elmRows) for (let z = MALL.z0 + 6; z < MALL.z1; z += 13) {
    const q = rnd();
    if (q > 0.05) plant(q < 0.08 ? 'bare' : 'elm', side * row + rnd() - 0.5, z + rnd() * 2 - 1, { gap: 4, s: q > 0.94 ? 0.5 : 1 });
  }
  // The reflecting pool: a willow at each corner, Yoshino cherries in two loose rows down the long sides, low hedges inside them.
  for (const side of [-1, 1]) {
    const x = POOL.x + side * (POOL.halfX + 16);
    for (const end of [-1, 1]) {
      plant('willow', x, POOL.z + end * (POOL.halfZ - 1));
      hedge(x - side * 4.6, POOL.z + end * 5, x - side * 4.6, POOL.z + end * 19);
      plant('boxwood', x - side * 4.6, POOL.z + end * 3.4); plant('boxwood', x - side * 4.6, POOL.z + end * 20.6);
    }
    for (let i = -1; i < 2; i++) plant('cherry', x + side, POOL.z + i * 11, { gap: 3 });
    for (let i = -2; i < 2; i++) plant('cherry', x + side * 11, POOL.z + (i + 0.5) * 11.5, { gap: 3 });
  }
  // Cherries along the two curved walks down the lawn.
  for (const w of WALKS) if (w.id.startsWith('lawn')) along(w.pts, 11, w.w / 2 + 4.5, (x, z) => plant('cherry', x, z, { s: 0.9, gap: 3 }));
  // Formal planting round the building: a clipped hedge on three sides of the yard at each end, magnolias outside it, a
  // hedge and a holly at each east corner of the terrace, hedges and magnolias down the sides of the east plaza.
  for (const side of [-1, 1]) {
    hedge(side * 91, -22, side * 112, -22); hedge(side * 91, 22, side * 112, 22); hedge(side * 112, -22, side * 112, -5); hedge(side * 112, 5, side * 112, 22);
    for (const end of [-1, 1]) { plant('boxwood', side * 113.2, end * 3.6); plant('boxwood', side * 113.2, end * 23.2); plant('magnolia', side * 119, end * 12.5); }
    hedge(side * 84, -37.5, side * 100, -37.5); plant('boxwood', side * 83, -37.5); plant('boxwood', side * 101, -37.5); plant('holly', side * 92, -41); plant('holly', side * 116.5, -21);
    for (let z = -40; z > -124; z -= 30) { hedge(side * 33.5, z, side * 33.5, z - 24); plant('boxwood', side * 33.5, z + 1.6); plant('boxwood', side * 33.5, z - 25.6); }
    plant('magnolia', side * 42, -42); plant('magnolia', side * 44, -100);
  }
  // A low hedge round the lawn side of each traffic circle.
  for (const c of CIRCLES) for (let i = 0; i < 30; i++) {
    const a = i / 30 * TAU, b = (i + 1) / 30 * TAU, rad = c.r + 8.4;
    if (Math.sin(a) < -0.05) hedge(c.x + Math.cos(a) * rad, c.z + Math.sin(a) * rad, c.x + Math.cos(b) * rad, c.z + Math.sin(b) * rad);
  }
  // Street trees: a line down both sides of every street, one species per street.
  for (const r of ROADS) along(r.pts, 18, r.w / 2 + 3.6, (x, z) => {
    const q = rnd();
    if (q > 0.04) plant(q < 0.08 ? 'bare' : STREET[r.id], x, z, { s: 0.8, gap: 3.5, lod: Math.hypot(x, z) < 215 ? 2 : 1 });
  });
  // The Capitol lawns the way Olmsted laid them out: open in the middle, clumps and single big trees thickening toward the edges.
  for (let i = 0, made = 0; i < 1200 && made < 185; i++) {
    const x = (rnd() * 2 - 1) * 194, z = -140 + rnd() * 328, kind = LAWN[Math.floor(rnd() * LAWN.length)], n = rnd() < 0.4 ? 1 : 2 + Math.floor(rnd() * 4);
    if (rnd() > Math.max(0.12, Math.min(1, (Math.abs(x) - 24) / 110))) continue;
    for (let j = 0; j < n; j++) {
      const a = rnd() * TAU, d = j ? KIND[kind].gap * (1.6 + rnd() * 1.4) : 0;
      if (plant(j && rnd() < 0.2 ? LAWN[Math.floor(rnd() * LAWN.length)] : kind, x + Math.cos(a) * d, z + Math.sin(a) * d)) made++;
    }
    if (rnd() < 0.3) for (let j = 0; j < 3; j++) plant('boxwood', x + (rnd() - 0.5) * 9, z + (rnd() - 0.5) * 9);
  }
  // The city beyond the streets: a canopy thinning with distance, so no view ends in bare ground.
  for (let gx = -468; gx <= 468; gx += 26) for (let gz = -520; gz <= 760; gz += 26) {
    const x = gx + (rnd() - 0.5) * 20, z = gz + (rnd() - 0.5) * 20, d = Math.hypot(x, z), q = rnd(), kind = CITY[Math.floor(rnd() * CITY.length)];
    if (inGrounds(x, z) || (Math.abs(x) < 104 && z > 0) || q > (d < 430 ? 0.4 : d < 600 ? 0.26 : 0.14)) continue;
    plant(kind, x, z, { lod: 1 });
  }

  for (const list of Object.values(districts)) game.scene.add(bake(list));
  for (const list of carpets) game.scene.add(carpet(list, rnd));
  game.scene.add(treeLine());

  // Falling leaves: forty of them, let go by whichever trees stand near a spot ten metres in front of the camera, and
  // reused when they land. No tree nearby, no leaves.
  const N = 40, fall = new Float32Array(N * 6).fill(-1), lr = rng(77);
  const leaves = instances(card(0.46, 0.32, 0xffffff), Array.from({ length: N }, () => ({ s: 0, color: 0xffffff })), paintBoth);
  leaves.frustumCulled = false;
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < N; i++) fall[i * 6 + 5] = 0.2 + lr() * 6;   // x, y, z, turn, speed, seconds until it lets go
  game.scene.add(leaves);

  return {
    update(dt) {
      wind.value = game.time * 1.1 % (TAU * 5);   // one whole cycle of both waves, so it never grows large
      const c = game.cam, e = game.camera.matrixWorld.elements;   // a free camera is placed after this runs, so read where it will be
      let fx = c ? c.pos[0] : e[12], fz = c ? c.pos[2] : e[14], dx = c ? c.look[0] - fx : -e[8], dz = c ? c.look[2] - fz : -e[10];
      const far = 10 / (Math.hypot(dx, dz) || 1);
      fx += dx * far; fz += dz * far;
      let recolour = false;
      for (let i = 0, o = 0; i < N; i++, o += 6) {
        if (fall[o + 5] > 0) {
          if ((fall[o + 5] -= dt) > 0) continue;
          const near = groves.get(cell(fx + (lr() * 2 - 1) * 24, fz + (lr() * 2 - 1) * 24, 24));
          if (!near) { fall[o + 5] = 0.3 + lr(); continue; }
          const t = near[Math.floor(lr() * near.length)], a = lr() * TAU, d = Math.sqrt(lr()) * t[3];
          fall[o] = t[0] + Math.cos(a) * d; fall[o + 1] = t[2] * (0.3 + lr() * 0.3); fall[o + 2] = t[1] + Math.sin(a) * d; fall[o + 3] = lr() * TAU; fall[o + 4] = 0.9 + lr() * 0.9;
          leaves.setColorAt(i, A.set(t[4]).multiplyScalar(1.7)); recolour = true;   // brighter than the tree, so a leaf catches the eye as it turns
        }
        const turn = (fall[o + 3] += dt * 2.4);
        fall[o] += (0.5 + Math.sin(turn) * 0.9) * dt; fall[o + 1] -= fall[o + 4] * dt; fall[o + 2] += (0.3 + Math.cos(turn * 0.7) * 0.7) * dt;
        const down = fall[o + 1] < 0.1;
        if (down) fall[o + 5] = 0.05 + lr() * 2;
        leaves.setMatrixAt(i, M.compose(V.set(fall[o], fall[o + 1], fall[o + 2]), Q.setFromEuler(E.set(turn, turn * 1.7, 0)), S.setScalar(down ? 0 : 1)));
      }
      leaves.instanceMatrix.needsUpdate = true;
      if (recolour) leaves.instanceColor.needsUpdate = true;
    },
  };
}
