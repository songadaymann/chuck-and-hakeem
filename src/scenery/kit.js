import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ps1ify } from '../ps1.js';
import { SKY } from './plan.js';

// A small low-poly kit shared by every scenery module, so the whole world is drawn with a handful of materials.
// Shapes are painted with vertex colours (no textures), flat-faced, and meant to be merged into one mesh per
// module or drawn as instances. Every shape sits ON y = 0 at the given position unless noted.
const lambert = (o) => ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true, ...o }));
export const paint = lambert({});                                    // the default: lit, fogged, one-sided
export const paintBoth = lambert({ side: THREE.DoubleSide });         // thin things seen from both sides (leaves, flags, signs)
export const paintFar = lambert({ fog: false });                      // beyond the fog: bake the haze in with hazed()
export const glow = ps1ify(new THREE.MeshBasicMaterial({ vertexColors: true }));              // unlit: lamps, windows at dusk, screens
export const glowFar = ps1ify(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
// Flat decals lying on the lawn (roads, paint, puddles): pulled toward the camera so they never flicker against the grass.
export const decal = lambert({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

const C = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();

// Paint a whole geometry one colour. `shade` (0..1) darkens the bottom for a cheap baked-light look.
export function tint(geo, color, shade = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, a = new Float32Array(p.count * 3);
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, h = g.boundingBox.max.y - y0 || 1;
  C.set(color);
  for (let i = 0; i < p.count; i++) { const k = 1 - shade * (1 - (p.getY(i) - y0) / h); a[i * 3] = C.r * k; a[i * 3 + 1] = C.g * k; a[i * 3 + 2] = C.b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}
// Move / turn / scale a geometry in place. o = { x, y, z, rx, ry, rz, s, sx, sy, sz }.
export function place(geo, o = {}) {
  E.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
  M.compose(V.set(o.x || 0, o.y || 0, o.z || 0), Q.setFromEuler(E), S.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1));
  return geo.applyMatrix4(M);
}
// Basic shapes, bottom on y = 0. Pass a placement as the last argument: box(2, 1, 4, 0x884422, { x: 3, ry: 0.5 }).
export const box = (w, h, d, color, o, shade = 0) => place(tint(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, shade), o);
export const cyl = (rTop, rBottom, h, sides, color, o, shade = 0) => place(tint(new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1).translate(0, h / 2, 0), color, shade), o);
export const cone = (r, h, sides, color, o, shade = 0) => place(tint(new THREE.ConeGeometry(r, h, sides, 1).translate(0, h / 2, 0), color, shade), o);
export const ball = (r, color, o, detail = 0, shade = 0) => place(tint(new THREE.IcosahedronGeometry(r, detail).translate(0, r, 0), color, shade), o);   // faceted blob (tree crowns, bushes, domes)
export const dome = (r, color, o, sides = 8, rings = 4) => place(tint(new THREE.SphereGeometry(r, sides, rings, 0, Math.PI * 2, 0, Math.PI / 2), color), o);
// A flat patch lying on the ground, w along x and d along z, cut into `seg` pieces so vertex snapping bends it gently.
export const patch = (w, d, color, o, seg = 1) => place(tint(new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 12 * seg)), Math.max(1, Math.round(d / 12 * seg))).rotateX(-Math.PI / 2), color), o);
// An upright card facing +Z (signs, billboards), bottom edge on y = 0.
export const card = (w, h, color, o) => place(tint(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), color), o);
// A ribbon along a line of [x, z] points (roads, paths, kerbs, painted lines): width w, lying at height y.
export function ribbon(pts, w, color, y = 0.04, step = 10) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
    const g = new THREE.PlaneGeometry(w, len, 1, n).rotateX(-Math.PI / 2);
    out.push(place(tint(g, color), { x: (ax + bx) / 2, y, z: (az + bz) / 2, ry: Math.atan2(bx - ax, bz - az) }));
  }
  return out.length === 1 ? out[0] : merge(out);
}

// Many painted shapes -> one geometry (one draw call).
export function merge(geos) {
  const list = geos.flat(Infinity).filter(Boolean).map((g) => { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.normal) n.computeVertexNormals(); n.deleteAttribute('uv'); return n; });
  const g = mergeGeometries(list, false);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
export function mesh(geos, material = paint) { const m = new THREE.Mesh(Array.isArray(geos) ? merge(geos) : geos, material); m.matrixAutoUpdate = false; m.updateMatrix(); return m; }

// One shape drawn many times in one call. list items: { x, y, z, ry, s, sx, sy, sz, color } (color multiplies the paint).
export function instances(geo, list, material = paint) {
  const m = new THREE.InstancedMesh(Array.isArray(geo) ? merge(geo) : geo, material, list.length);
  list.forEach((o, i) => {
    E.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    m.setMatrixAt(i, M.compose(V.set(o.x || 0, o.y || 0, o.z || 0), Q.setFromEuler(E), S.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1)));
    if (o.color !== undefined) m.setColorAt(i, C.set(o.color));
  });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.computeBoundingSphere(); m.computeBoundingBox();
  m.matrixAutoUpdate = false; m.updateMatrix();
  return m;
}

// Things past the fog are drawn without fog, so fade their colour into the sky by hand: 0 m = itself, `SKY.hazeFull` m = sky.
export function hazed(color, dist, max = 0.92) { return C.set(color).lerp(new THREE.Color(SKY.horizon), Math.min(max, Math.max(0, dist / SKY.hazeFull))).getHex(); }
