import * as THREE from 'three';
import { CFG } from '../../config.js';
import { ps1ify, canvasTex } from '../../ps1.js';
import * as K from '../kit.js';
import { ROADS, WALKS, POOL, CIRCLES, MALL, lineDist, inPool, rng } from '../plan.js';

// Every surface that is not lawn: streets, walks, the two circles, the pool and the Grant Memorial, the Mall's mown
// panels and the paved city blocks outside the ring of streets. Four draw calls:
//   two flat sheets (everything east of z = SPLIT, and the Mall west of it, so the Mall is culled when you face the
//   Capitol), one mesh of stonework and bronze, and the water.
// The sheets are painted like a PS1 floor: no depth writes, triangles in layer order (ground, walks, asphalt, paint),
// so where streets cross nothing can flicker however far away it is. They lie at y = 0.015: a decal another module
// lays on a street or walk should sit at y = 0.1 or more (kit.decal), or be drawn after them (renderOrder 3 or more).
const SPLIT = 210, EDGE = MALL.z1, SW = 3, GRAIN = 5, Y = 0.015;   // chunk boundary, end of the map, sidewalk width, metres per grain tile, height of the sheets
const BASE = 0, WALK = 1, ROAD = 2, PAINT = 3;
const C = {
  lawn: 0x4e783e, lawnDark: 0x426a36, lawnLight: 0x5a8747, stripeA: 0x548241, stripeB: 0x48723a, worn: 0x7b6944, dirt: 0x705436,
  asphalt: 0x47494d, tar: [0x393b3f, 0x393b3f, 0x56585c], sidewalk: 0xbcb8ac, kerb: 0xd4d0c4, gravel: 0xc4aa7a, stone: [0xcdc7b8, 0xc2bbab, 0xd7d2c5], border: 0xa9a394, glass: 0x4f6c7c,
  city: 0x9c9991, lots: [0x8e8c85, 0x74767a, 0x8e8c85, 0x5c7c4c, 0xb4b1a8], yellow: 0xe6cf5a, white: 0xeeeeea, bike: 0x3f9a5c,
  marble: 0xf2efe6, granite: 0xa9a59b, bronze: 0x42503f, bronzeLit: 0x566650,
};
const hyp = Math.hypot;

// ---- flat sheets -------------------------------------------------------------------------------------------------
function sheets(gain) {
  const buf = [0, 1].map(() => [0, 1, 2, 3].map(() => ({ p: [], c: [] }))), col = new THREE.Color();
  const put = (b, x, z, color) => { b.p.push(x, Y, z); col.set(color); b.c.push(col.r * gain, col.g * gain, col.b * gain); };
  // One triangle, wound face-up whatever order the corners come in. A colour per corner gives soft edges.
  // It goes in the Mall sheet if it lies in the Mall's box (which takes in Pennsylvania Avenue's far leg), else the main one.
  function tri(layer, ax, az, bx, bz, cx, cz, ca, cb = ca, cc = ca) {
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3, b = buf[mz > SPLIT && mz < EDGE && mx > -330 && mx < 216 ? 1 : 0][layer];
    put(b, ax, az, ca);
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0) { put(b, bx, bz, cb); put(b, cx, cz, cc); } else { put(b, cx, cz, cc); put(b, bx, bz, cb); }
  }
  const quad = (layer, ax, az, bx, bz, cx, cz, dx, dz, ca, cb = ca, cc = ca, cd = ca) => { tri(layer, ax, az, bx, bz, cx, cz, ca, cb, cc); tri(layer, ax, az, cx, cz, dx, dz, ca, cc, cd); };
  // Axis-aligned rectangle, cut where it crosses a chunk boundary.
  function rect(layer, x0, z0, x1, z1, color) {
    for (const cut of [SPLIT, EDGE]) if (z0 < cut && z1 > cut) { rect(layer, x0, z0, x1, cut, color); rect(layer, x0, cut, x1, z1, color); return; }
    quad(layer, x0, z0, x1, z0, x1, z1, x0, z1, color);
  }
  // A rectangle `len` long in direction (tx, tz) and `w` across, centred on (x, z).
  function bar(layer, x, z, tx, tz, len, w, color) {
    const lx = tx * len / 2, lz = tz * len / 2, wx = -tz * w / 2, wz = tx * w / 2;
    quad(layer, x - lx - wx, z - lz - wz, x + lx - wx, z + lz - wz, x + lx + wx, z + lz + wz, x - lx + wx, z - lz + wz, color);
  }
  // A band along a line of stations between two sideways offsets (positive = right of the direction of travel).
  function strip(layer, st, o0, o1, c0, c1 = c0) {
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      quad(layer, a.x + a.nx * o0, a.z + a.nz * o0, a.x + a.nx * o1, a.z + a.nz * o1, b.x + b.nx * o1, b.z + b.nz * o1, b.x + b.nx * o0, b.z + b.nz * o0, c0, c1, c1, c0);
    }
  }
  function disc(layer, x, z, r, color, rim = color, n = 20) {
    for (let i = 0; i < n; i++) { const a = i / n * 6.2832, b = (i + 1) / n * 6.2832; tri(layer, x, z, x + Math.cos(a) * r, z + Math.sin(a) * r, x + Math.cos(b) * r, z + Math.sin(b) * r, color, rim, rim); }
  }
  // Zebra crossing over a street running in direction (tx, tz): bars `len` long lying along the traffic, spread across `w`.
  function zebra(x, z, tx, tz, w, len = 3) {
    const n = Math.floor(w / 2), gap = w / n;
    for (let i = 0; i < n; i++) { const o = (i + 0.5) * gap - w / 2; bar(PAINT, x - tz * o, z + tx * o, tx, tz, len, 1, C.white); }
  }
  function meshes(tex) {
    const mat = ps1ify(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    return buf.map((layers, i) => {
      const p = layers.flatMap((l) => l.p), n = p.length / 3, uv = new Float32Array(n * 2), up = new Float32Array(n * 3), g = new THREE.BufferGeometry();
      for (let k = 0; k < n; k++) { uv[k * 2] = p[k * 3] / GRAIN; uv[k * 2 + 1] = p[k * 3 + 2] / GRAIN; up[k * 3 + 1] = 1; }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(layers.flatMap((l) => l.c), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(up, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 1 + i; m.matrixAutoUpdate = false; m.updateMatrix();
      return m;
    });
  }
  return { tri, quad, rect, bar, strip, disc, zebra, meshes };
}

// Points along a line every `step` metres with a mitred sideways normal, plus one exactly on the chunk boundary.
function stations(pts, step = 60) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = hyp(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len, n = Math.max(1, Math.ceil(len / step)), ts = [];
    for (let j = i ? 1 : 0; j <= n; j++) ts.push(j / n);
    if ((az - SPLIT) * (bz - SPLIT) < 0) ts.push((SPLIT - az) / (bz - az));
    if (i) { const p = out[out.length - 1], mx = p.nx + nx, mz = p.nz + nz, d = mx * nx + mz * nz; p.nx = mx / d; p.nz = mz / d; }   // mitre the corner
    for (const t of ts.sort((a, b) => a - b)) out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, nx, nz });
  }
  return out;
}
// A street that runs off the edge of the map carries on into the haze instead of stopping dead.
function runOn(pts, by = 300) {
  const out = pts.map((p) => [...p]), end = (a, b) => { const d = hyp(a[0] - b[0], a[1] - b[1]); return [a[0] + (a[0] - b[0]) / d * by, a[1] + (a[1] - b[1]) / d * by]; };
  if (hyp(...pts[0]) > 420) out.unshift(end(pts[0], pts[1]));
  if (hyp(...pts.at(-1)) > 420) out.push(end(pts.at(-1), pts.at(-2)));
  return out;
}

function grainTex() {
  let sum = 0;
  const rnd = rng(7), tex = canvasTex(32, 32, (g) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const v = 214 + Math.floor(rnd() * 38); sum += (v / 255) ** 2.2; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1); }
  }, 1);
  return { tex, gain: 1024 / sum };   // gain: paint the colours this much brighter so the grain does not darken them
}

function flats(S) {
  const rnd = rng(1791);
  const inRing = (x, z) => Math.abs(x) < 216 && z > -160;   // the grounds and the Mall: everything else is city

  // -- variety inside the grounds: big soft patches of darker and lighter grass (first, so the city paving trims any that spill out)
  for (let i = 0; i < 16; i++) {
    const x = (rnd() - 0.5) * 380, z = -135 + rnd() * 320, r = 16 + rnd() * 24, c = i % 2 ? C.lawnDark : C.lawnLight, n = 9, ring = [];
    if (inPool(x, z, r * 1.2)) continue;   // nothing under the water
    for (let k = 0; k < n; k++) { const a = k / n * 6.2832, q = r * (0.7 + rnd() * 0.5); ring.push([x + Math.cos(a) * q, z + Math.sin(a) * q * 0.8]); }
    for (let k = 0; k < n; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % n], h = 0.55, ix = x + (ax - x) * h, iz = z + (az - z) * h, jx = x + (bx - x) * h, jz = z + (bz - z) * h;
      S.tri(BASE, x, z, ix, iz, jx, jz, c); S.quad(BASE, ix, iz, jx, jz, bx, bz, ax, az, c, c, C.lawn, C.lawn);
    }
  }
  // -- the city blocks outside the ring of streets, and the Mall carried on to the horizon
  S.rect(BASE, -800, -800, -205, 1000, C.city); S.rect(BASE, 205, -800, 800, 1000, C.city); S.rect(BASE, -205, -800, 205, -150, C.city);
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * 1300, z = -650 + rnd() * 1500, w = 20 + rnd() * 50, d = 20 + rnd() * 50, c = C.lots[Math.floor(rnd() * C.lots.length)];
    if (!inRing(x - w, z - d) && !inRing(x + w, z - d) && !inRing(x - w, z + d) && !inRing(x + w, z + d)) S.rect(BASE, x - w, z - d, x + w, z + d, c);
  }
  S.rect(BASE, -200, 200, 200, 1000, C.lawn);
  const sw = (MALL.grassHalfX + 2) * 2 / 11;   // mown stripes running away down the Mall
  for (let i = 0; i < 11; i++) S.rect(BASE, -MALL.grassHalfX - 2 + i * sw, MALL.z0, -MALL.grassHalfX - 2 + (i + 1) * sw, 1000, i % 2 ? C.stripeA : C.stripeB);

  // -- where everyone has been trudging with shovels: a trampled skirt round the front of each pile and tracks to it
  for (const g of CFG.giants) {
    const s = Math.sign(g.x), R = CFG.dirt.radius, arc = [];
    for (let a = 30; a <= 150; a += 12) { const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180), w = 5 + rnd() * 5; arc.push([ca, sa, w]); }
    for (let k = 0; k + 1 < arc.length; k++) {
      const pt = ([ca, sa, w], r) => [g.x + ca * (r + (r > R ? w : 0)), Math.max(33, g.z + sa * (r + (r > R ? w : 0)))], a0 = pt(arc[k], R - 4), b0 = pt(arc[k + 1], R - 4), a1 = pt(arc[k], R + 1), b1 = pt(arc[k + 1], R + 1), a2 = pt(arc[k], R + 4), b2 = pt(arc[k + 1], R + 4);
      S.quad(BASE, ...a0, ...b0, ...b1, ...a1, C.dirt); S.quad(BASE, ...a1, ...b1, ...b2, ...a2, C.dirt, C.dirt, C.lawn, C.lawn);
    }
    for (const pts of [[[14, 64], [22, 59], [32, 50], [40, 42]], [[14, 86], [27, 72], [43, 56], [56, 44]], [[14, 46], [22, 43], [30, 41]], [[92, 76], [80, 60], [70, 46]]]) {
      const st = stations(pts.map(([x, z]) => [x * s, z]));
      S.strip(BASE, st, -3, -0.9, C.lawn, C.worn); S.strip(BASE, st, -0.9, 0.9, C.worn); S.strip(BASE, st, 0.9, 3, C.worn, C.lawn);
    }
  }

  // -- walks: gravel on the lawns and down the Mall, stone slabs on the centre walk and the east plaza
  for (const w of WALKS) {
    const [[ax, az], [bx, bz]] = w.pts;
    if (w.id !== 'centre' && w.id !== 'east-plaza') { S.strip(WALK, stations(w.id.startsWith('mall') ? runOn(w.pts) : w.pts), -w.w / 2, w.w / 2, C.gravel); continue; }
    const z0 = Math.min(az, bz), z1 = Math.max(az, bz), nx = Math.round(w.w / 5), nz = Math.round((z1 - z0) / 5), dx = (w.w - 2) / nx, dz = (z1 - z0) / nz;
    S.rect(WALK, ax - w.w / 2, z0, ax + w.w / 2, z1, C.border);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) S.rect(WALK, ax - w.w / 2 + 1 + i * dx, z0 + j * dz, ax - w.w / 2 + 1 + (i + 1) * dx, z0 + (j + 1) * dz, C.stone[Math.floor(rnd() * 3)]);
  }
  for (const s of [-19, 19]) { S.rect(WALK, s - 5, -101, s + 5, -75, C.border); S.rect(WALK, s - 4, -100, s + 4, -76, C.glass); }   // the visitor centre's two skylights
  for (let z = MALL.z0 + 126; z < EDGE; z += 130) S.rect(WALK, -MALL.grassHalfX - 2, z - 4, MALL.grassHalfX + 2, z + 4, C.gravel);   // cross paths between the grass panels

  // -- streets: sidewalk under asphalt, so wherever two cross the junction fills itself in
  const roads = ROADS.map((r) => ({ ...r, st: stations(runOn(r.pts)), bike: r.id === 'pennsylvania' }));
  const busy = (x, z, self, pad) => ROADS.some((r) => r.id !== self.id && lineDist(x, z, r.pts) < r.w / 2 + pad) || CIRCLES.some((c) => hyp(x - c.x, z - c.z) < c.r + 6 + pad);
  for (const r of roads) S.strip(WALK, r.st, -r.w / 2 - SW, r.w / 2 + SW, C.sidewalk);
  for (const c of CIRCLES) S.disc(WALK, c.x, c.z, c.r + 6 + SW, C.sidewalk);
  for (const r of roads) S.strip(ROAD, r.st, -r.w / 2, r.w / 2, C.asphalt);
  for (const c of CIRCLES) S.disc(ROAD, c.x, c.z, c.r + 6, C.asphalt);
  for (const r of roads) for (let i = 0; i + 1 < r.pts.length; i++) {   // years of patched tarmac
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = hyp(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
    for (let s = 15 + rnd() * 30; s < len - 10; s += 30 + rnd() * 50) {
      const o = (rnd() - 0.5) * (r.w - 5), x = ax + tx * s - tz * o, z = az + tz * s + tx * o, l = 4 + rnd() * 7, w = 2 + rnd() * 1.5, c = C.tar[Math.floor(rnd() * 3)];
      if (hyp(x, z) < 560 && !busy(x, z, r, 4)) S.bar(ROAD, x, z, tx, tz, l, w, c);
    }
  }

  // -- paint: centre dashes, Pennsylvania Avenue's bike lane, zebra crossings and stop lines
  for (const r of roads) {
    if (r.bike) {
      const [[ax, az], [bx, bz]] = r.pts, d = hyp(bx - ax, bz - az), k = (CIRCLES[0].r + 6 + SW + 4) / d;
      const st = stations([[ax + (bx - ax) * k, az + (bz - az) * k], ...r.pts.slice(1)]);
      S.strip(PAINT, st, -2.1, 2.1, C.white); S.strip(PAINT, st, -1.6, 1.6, C.bike);
      continue;
    }
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = hyp(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
      for (let s = 4; s + 4 < len; s += 12) { const x = ax + tx * (s + 2), z = az + tz * (s + 2); if (!busy(x, z, r, 6) && hyp(x, z) < 640) S.bar(PAINT, x, z, tx, tz, 4, 0.6, C.yellow); }
    }
  }
  for (const r of roads) for (let i = 0; i + 1 < r.pts.length; i++) for (const o of ROADS) if (o.id !== r.id) for (let j = 0; j + 1 < o.pts.length; j++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], [cx, cz] = o.pts[j], [dx, dz] = o.pts[j + 1];
    const rx = bx - ax, rz = bz - az, ox = dx - cx, oz = dz - cz, den = rx * oz - rz * ox, lr = hyp(rx, rz), lo = hyp(ox, oz), sin = Math.abs(den) / (lr * lo);
    if (sin < 0.5) continue;   // the two avenues meet their neighbours at too shallow an angle for a tidy crossing
    const t = ((cx - ax) * oz - (cz - az) * ox) / den * lr, u = ((cx - ax) * rz - (cz - az) * rx) / den * lo;
    if (t < -1 || t > lr + 1 || u < -1 || u > lo + 1) continue;
    const tx = rx / lr, tz = rz / lr, px = ax + tx * t, pz = az + tz * t, off = (o.w / 2 + 2.2) / sin, lane = r.bike ? 2.3 : 0.4;
    if (CIRCLES.some((c) => hyp(px - c.x, pz - c.z) < c.r + 12)) continue;
    for (const dir of [1, -1]) {
      if ((dir > 0 ? lr - t : t) < off + 12) continue;   // no arm this way
      S.zebra(px + tx * off * dir, pz + tz * off * dir, tx, tz, r.w);
      const m = (lane + r.w / 2) / 2 * dir, q = (off + 3.4) * dir;   // stop line across the lane that drives in (keep right)
      S.bar(PAINT, px + tx * q + tz * m, pz + tz * q - tx * m, -tz, tx, r.w / 2 - lane, 0.7, C.white);
    }
  }
  S.zebra(0, 114, 1, 0, 12, 12);                                      // centre walk over First St
  for (const x of [-45, 45]) S.zebra(x, 196, 1, 0, 12, 7);            // pool walks over Third St to the Mall walks
  for (const c of CIRCLES) {
    for (const r of ROADS) for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = hyp(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
      if (lineDist(c.x, c.z, [r.pts[i], r.pts[i + 1]]) > 1) continue;
      for (const dir of [1, -1]) if (hyp((dir > 0 ? bx : ax) - c.x, (dir > 0 ? bz : az) - c.z) > 40) S.zebra(c.x + tx * dir * (c.r + 10.5), c.z + tz * dir * (c.r + 10.5), tx, tz, r.w);
    }
    for (const w of WALKS) {   // a lawn walk that ends at the circle crosses the ring to the island
      const [ax, az] = w.pts.at(-2), [bx, bz] = w.pts.at(-1), len = hyp(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      if (hyp(bx - c.x, bz - c.z) < c.r) S.zebra(c.x - ux * (c.r + 3), c.z - uz * (c.r + 3), -uz, ux, 6, 4);
    }
    S.disc(PAINT, c.x, c.z, c.r, C.kerb); S.disc(PAINT, c.x, c.z, c.r - 0.8, C.lawn); S.disc(PAINT, c.x, c.z, 8.5, C.stone[0], C.stone[1], 12);
  }
}

// ---- stonework and bronze ----------------------------------------------------------------------------------------
// A horse and rider about 3 m long and 4 m tall, facing +Z, hooves on y = 0.
function rider(hat) {
  const b = C.bronze, l = C.bronzeLit;
  return K.merge([
    K.box(0.9, 1.1, 2.6, b, { y: 1.3 }), K.box(0.7, 1.4, 0.5, b, { z: 0.95 }), K.box(0.7, 1.4, 0.5, b, { z: -0.95 }),   // barrel, legs a pair at a time
    K.box(0.55, 1.5, 0.7, b, { y: 1.9, z: 1.2, rx: 0.5 }), K.box(0.45, 0.55, 1.1, l, { y: 2.9, z: 1.9, rx: 0.4 }),       // neck, head
    K.box(0.25, 1.2, 0.25, b, { y: 1.2, z: -1.4, rx: -0.35 }),                                                            // tail
    K.box(0.8, 1.3, 0.55, l, { y: 2.3, z: -0.1 }), K.box(0.45, 0.5, 0.45, l, { y: 3.6, z: -0.1 }),                         // the man
    hat && K.box(0.95, 0.12, 0.95, b, { y: 4.0, z: -0.1 }),
  ]);
}
// A standing or seated robed figure: a tapered body with a head on it.
const figure = (h, color, o) => K.place(K.merge([K.cyl(h * 0.11, h * 0.2, h * 0.72, 6, color, {}, 0.25), K.ball(h * 0.13, color, { y: h * 0.7 })]), o);

function stonework() {
  const P = POOL, m = C.marble, g = C.granite, b = C.bronze, out = [];
  // pool coping
  for (const s of [-1, 1]) out.push(K.box(1.4, 0.5, P.halfZ * 2 + 2.8, g, { x: P.x + s * (P.halfX + 0.7), z: P.z }, 0.2), K.box(P.halfX * 2, 0.5, 1.4, g, { x: P.x, z: P.z + s * (P.halfZ + 0.7) }, 0.2));
  // Ulysses S. Grant Memorial: a long marble terrace across the pool's east end, Grant in the middle looking down the Mall
  const z = P.z - P.halfZ + 1.4;
  out.push(K.box(61, 0.45, 8.2, g, { x: P.x, z }), K.box(58, 1, 6.4, m, { x: P.x, z }, 0.15));
  out.push(K.box(4.6, 0.8, 6.2, m, { x: P.x, y: 1, z }), K.box(3.4, 4.6, 5, m, { x: P.x, y: 1.8, z }, 0.2), K.box(4, 0.5, 5.6, m, { x: P.x, y: 6.4, z }));
  out.push(K.place(rider(true), { x: P.x, y: 6.9, z: z - 0.3, s: 1.35 }));
  for (const x of [-8.2, -4.8, 4.8, 8.2]) out.push(K.box(1.6, 1.3, 3, m, { x: P.x + x, y: 1, z }, 0.15), K.box(0.9, 0.8, 2.2, b, { x: P.x + x, y: 2.3, z }), K.box(0.8, 0.9, 0.8, C.bronzeLit, { x: P.x + x, y: 2.7, z: z + 0.9 }));   // the four lions
  for (const s of [-1, 1]) {
    const x = P.x + s * 23;
    out.push(K.box(9, 2.2, 5, m, { x, y: 1, z }, 0.2));
    if (s < 0) {   // the cavalry charge, with its guidon
      for (const [dx, dz, rx] of [[2.4, -1.1, -0.18], [0, 0.2, -0.06], [-2.6, 1.2, -0.25]]) out.push(K.place(rider(false), { x: x + dx, y: 3.2, z: z + dz, ry: -Math.PI / 2, rx }));
      out.push(K.box(0.14, 3.4, 0.14, b, { x: x + 0.4, y: 5.6, z: z + 0.2 }), K.box(1.3, 0.8, 0.1, C.bronzeLit, { x: x + 1.1, y: 8.1, z: z + 0.2 }));
    } else {       // the artillery: a team hauling a gun
      for (const dz of [-1, 1]) out.push(K.place(rider(false), { x: x - 2.2, y: 3.2, z: z + dz, ry: -Math.PI / 2 }));
      out.push(K.box(1.8, 0.9, 1.7, b, { x: x + 1.6, y: 3.9, z }), K.cyl(0.2, 0.3, 2.6, 6, C.bronzeLit, { x: x + 2.4, y: 4.6, z, rz: -1.1 }));
      for (const dz of [-1.1, 1.1]) out.push(K.cyl(1, 1, 0.25, 8, b, { x: x + 1.6, y: 4.2, z: z + dz, rx: Math.PI / 2 }));
    }
  }
  // Peace Monument: white marble, two mourning figures on a tall pedestal over a granite basin
  const pc = CIRCLES[0], gc = CIRCLES[1];
  out.push(K.cyl(6, 6.4, 0.7, 10, g, { x: pc.x, z: pc.z }), K.box(5.4, 1.4, 5.4, m, { x: pc.x, y: 0.7, z: pc.z }, 0.15), K.box(3.6, 4.2, 3.6, m, { x: pc.x, y: 2.1, z: pc.z }, 0.15),
    K.box(4.6, 0.5, 4.6, m, { x: pc.x, y: 6.3, z: pc.z }), K.box(2.4, 3.2, 2.4, m, { x: pc.x, y: 6.8, z: pc.z }, 0.1), K.box(3.8, 0.4, 3, m, { x: pc.x, y: 10, z: pc.z }),
    figure(3.6, m, { x: pc.x - 0.95, y: 10.4, z: pc.z, rz: -0.1 }), figure(3.2, m, { x: pc.x + 0.95, y: 10.4, z: pc.z, rz: 0.26 }),
    figure(2.8, m, { x: pc.x, y: 6.8, z: pc.z + 1.75 }), figure(2.8, m, { x: pc.x, y: 6.8, z: pc.z - 1.75 }));
  // Garfield Monument: a bronze man on a round stone pedestal, three bronze figures seated round its foot
  out.push(K.cyl(4.6, 5, 0.7, 10, g, { x: gc.x, z: gc.z }), K.cyl(3, 3.3, 1.9, 10, g, { x: gc.x, y: 0.7, z: gc.z }, 0.15), K.cyl(1.5, 2.1, 5.4, 8, g, { x: gc.x, y: 2.6, z: gc.z }, 0.2),
    K.cyl(2, 1.6, 0.6, 8, g, { x: gc.x, y: 8, z: gc.z }), K.box(0.9, 1.5, 0.7, b, { x: gc.x, y: 8.6, z: gc.z }), K.cyl(0.45, 0.75, 1.9, 5, C.bronzeLit, { x: gc.x, y: 10, z: gc.z }),
    K.ball(0.42, C.bronzeLit, { x: gc.x, y: 11.8, z: gc.z }));
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * 2.0944; out.push(figure(2.4, b, { x: gc.x + Math.cos(a) * 3.1, y: 2.6, z: gc.z + Math.sin(a) * 3.1 })); }
  return K.mesh(out);
}

// ---- water -------------------------------------------------------------------------------------------------------
function water() {
  const P = POOL, rnd = rng(42);
  const tex = canvasTex(32, 32, (g) => {
    g.fillStyle = '#4a7f9e'; g.fillRect(0, 0, 32, 32);
    for (const [color, n, len] of [['#3b6b8a', 16, 7], ['#78acc4', 20, 6], ['#b9d9e6', 7, 3]]) { g.fillStyle = color; for (let i = 0; i < n; i++) g.fillRect(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 2 + Math.floor(rnd() * len), 1); }
  }, 1);
  const geo = new THREE.PlaneGeometry(P.halfX * 2, P.halfZ * 2, 10, 6).rotateX(-Math.PI / 2).translate(P.x, 0.3, P.z), p = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - P.x, z = p.getZ(i) - P.z, rim = Math.min(P.halfX - Math.abs(x), P.halfZ - Math.abs(z));
    const k = 0.78 + 0.3 * Math.min(1, rim / 9) + 0.3 * Math.max(0, 1 - Math.abs(x) / 8);   // dark at the coping, the sky (and a pale dome) down the middle
    col.set([k, k, k], i * 3); uv.setXY(i, p.getX(i) / 9, p.getZ(i) / 9);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, ps1ify(new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  m.matrixAutoUpdate = false; m.updateMatrix();
  return { mesh: m, tex };
}

export async function build(game) {
  const { tex, gain } = grainTex(), S = sheets(gain), W = water();
  flats(S);
  const all = [...S.meshes(tex), stonework(), W.mesh];
  for (const m of all) m.name = 'ground';
  game.scene.add(...all);
  return { update(dt, game) { W.tex.offset.set(game.time * 0.012 % 1, Math.sin(game.time * 0.35) * 0.03); } };   // a slow drift and sway: one small uniform a frame
}
