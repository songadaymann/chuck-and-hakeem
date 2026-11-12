import * as THREE from 'three';
import { CFG } from '../../config.js';
import { SKY, MOUNDS, ROADS, rng, lineDist } from '../plan.js';
import { box, cyl, cone, dome, ball, place, merge, mesh, paint, glowFar } from '../kit.js';

// Washington round and beyond the grounds, in three depths:
//   near  - the big neighbours across the streets (Supreme Court, Library of Congress, the Senate and House office
//           buildings, the Botanic Garden, the first museums on the Mall) and the first city blocks: lit and fogged like
//           everything else, six meshes by compass direction, and solid to walk into;
//   far   - museum row, Union Station, the monuments and the rest of the city out to the wooded ridge: six unlit,
//           unfogged wedges with the afternoon light and the haze painted into their colours once (bake);
//   lamps - the red aircraft lights on the Monument, the masts and the cranes, which blink (one mesh).
// Compass: north is -x, west is +z. Every building is flat coloured quads; windows are bands of colour, not textures.
// White stone is painted brighter than white paint can be, or the game's soft light turns marble to putty.
const lift = (hex, k = 1.55) => new THREE.Color(hex).multiplyScalar(k);
const MARBLE = lift(0xe9e6dd), LIME = lift(0xd8d0bc, 1.2), GRANITE = 0xb7b4aa, PINK = lift(0xe4d3ca, 1.5), SHADE = 0x5f666d, COPPER = 0x74b096, GOLD = 0xe2b53a,
  SLATE = 0x4c5058, TILE = 0xa8503a, SAND = 0x8e4634, LEAD = 0xb4bab6, RED = 0xff2a1a, CRANE = 0xe2a52a;
const OFFICE = [{ wall: 0xcfc5b0, glass: 0x3a4a57, row: 3.8 }, { wall: 0xc4b294, glass: 0x34424e, row: 3.8 }, { wall: 0xaeb2b4, glass: 0x2e3f4d, row: 3.8 }, { wall: 0xe2dfd6, glass: 0x4a5f70, bay: 4 },
  { wall: 0x9a7a62, glass: 0x2f3a44, row: 3.8 }, { wall: 0x86a3b5, glass: 0x456479, row: 3.8 }, { wall: 0xb9b0a0, glass: 0x4f4338, bay: 3.4 }, { wall: 0xd6d2c6, glass: 0x33434f, row: 3.8 }];
const HOUSE = [0xb5523c, 0xa8473a, 0xd9c7a1, 0x7fa3b8, 0xc98f4e, 0x8d9a6b, 0xe6e1d3, 0x9e5b6e, 0x5f7a8c, 0xd8b84a, 0xc46a4a, 0x7c8f76];
const LEAVES = [0x8a5a24, 0xb07a22, 0x6e3a1c, 0x3d5a34, 0xa8402a, 0x5c4a30];

const HZ = new THREE.Color(SKY.horizon), K = new THREE.Color(), SUN = new THREE.Vector3(...SKY.sunDir).normalize();
const A = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), TAU = Math.PI * 2;
const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// The land climbs toward the north-west (the Cathedral's ridge); the city beyond the fog stands on that slope so each row shows over the last.
const rise = (x, z) => 25 + 55 * Math.max(0, Math.cos(Math.atan2(z, x) - 2.5));
const elev = (x, z) => rise(x, z) * 0.6 * sstep(480, 960, Math.hypot(x, z));

// How far a colour has faded into the sky at `d` metres from the Capitol: picks up where the fog leaves the near city.
const hazeAt = (d) => Math.min(0.9, 0.36 + Math.max(0, d - 400) / 1250);
// Far scenery is drawn unlit and unfogged, so paint the light (the same sun and sky as world.js) and the haze into it:
// each flat face by the way it points, each corner by its distance and, low down, a little ground mist. `pop` < 1 keeps a landmark clearer than its surroundings.
function bake(g, pop = 1) {
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i += 3) {
    A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1).sub(A); N.fromBufferAttribute(p, i + 2).sub(A); N.crossVectors(B, N).normalize();
    const sky = N.y * 0.5 + 0.5, sun = Math.max(0, N.dot(SUN)) * 1.5;
    const lr = ((0.09 + 0.91 * sky) * 1.5 + sun) / Math.PI, lg = ((0.133 + 0.867 * sky) * 1.5 + sun * 0.89) / Math.PI, lb = ((0.058 + 0.942 * sky) * 1.5 + sun * 0.72) / Math.PI;
    for (let j = i; j < i + 3; j++) {
      const d = Math.hypot(p.getX(j), p.getZ(j)), mist = 0.5 * sstep(450, 750, d) * Math.min(1, Math.max(0, 1 - p.getY(j) / 30)), h = 1 - (1 - hazeAt(d) * pop) * (1 - mist);
      c.setXYZ(j, c.getX(j) * lr * (1 - h) + HZ.r * h, c.getY(j) * lg * (1 - h) + HZ.g * h, c.getZ(j) * lb * (1 - h) + HZ.b * h);
    }
  }
  return g;
}

// A bag of flat coloured quads: the cheapest way to draw hundreds of plain buildings. A wall from a to b faces the
// right-hand side of that walk; `block` and `roof` take x0 < x1, z0 < z1.
function quads() {
  const P = [], Q = [];
  const v = (p) => { P.push(p[0], p[1], p[2]); Q.push(K.r, K.g, K.b); };
  const b = {
    quad(p, q, r, s, color) { K.set(color); v(p); v(q); v(r); v(p); v(r); v(s); },
    tri(p, q, r, color) { K.set(color); v(p); v(q); v(r); },
    wall(ax, az, bx, bz, y0, y1, color) { b.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], color); },
    top(x0, x1, z0, z1, y, color) { b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color); },
    // One wall dressed by o: a plain `plinth`, then storeys of windows every `row` metres or upright slots every `bay` metres, then a plain `cap`.
    face(ax, az, bx, bz, y0, y1, o) {
      const lo = y0 + (o.plinth || 0), hi = y1 - (o.cap || 0);
      if (!(o.row || o.bay) || hi - lo < 2) return b.wall(ax, az, bx, bz, y0, y1, o.wall);
      if (lo > y0) b.wall(ax, az, bx, bz, y0, lo, o.base ?? o.wall);
      if (hi < y1) b.wall(ax, az, bx, bz, hi, y1, o.wall);
      if (o.row) {
        const n = Math.max(1, Math.round((hi - lo) / o.row)), h = (hi - lo) / n;
        for (let i = 0; i < n; i++) { b.wall(ax, az, bx, bz, lo + i * h, lo + (i + 0.42) * h, o.wall); b.wall(ax, az, bx, bz, lo + (i + 0.42) * h, lo + (i + 1) * h, o.glass); }
      } else {
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / o.bay)) * 2 + 1, dx = (bx - ax) / n, dz = (bz - az) / n;
        for (let i = 0; i < n; i++) b.wall(ax + dx * i, az + dz * i, ax + dx * (i + 1), az + dz * (i + 1), lo, hi, i % 2 ? o.glass : o.wall);
      }
    },
    // A box of four dressed walls and (given o.roof) a flat roof. o.hide drops walls nobody can see: 1 +z, 2 -z, 4 +x, 8 -x;
    // o.far drops the ones turned away from everywhere a player or camera can stand.
    block(x0, x1, z0, z1, y0, y1, o) {
      const f = o.far ? 430 : Infinity, h = o.hide || 0;
      if (z1 < f && !(h & 1)) b.face(x0, z1, x1, z1, y0, y1, o);
      if (-z0 < f && !(h & 2)) b.face(x1, z0, x0, z0, y0, y1, o);
      if (x1 < f && !(h & 4)) b.face(x1, z1, x1, z0, y0, y1, o);
      if (-x0 < f && !(h & 8)) b.face(x0, z0, x0, z1, y0, y1, o);
      if (o.roof !== undefined) b.top(x0, x1, z0, z1, y1, o.roof);
    },
    pier(x, z, w, y0, y1, color) { b.block(x - w / 2, x + w / 2, z - w / 2, z + w / 2, y0, y1, { wall: color }); },
    // A pitched roof with its ridge along `along` ('x' or 'z'; the longer side if not given). hip 0 = gables (painted `end`), 1 = hipped all round.
    roof(x0, x1, z0, z1, y, h, color, hip = 0, along, end = color) {
      const t = y + h, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
      if ((along || (x1 - x0 >= z1 - z0 ? 'x' : 'z')) === 'x') {
        const i = Math.min((x1 - x0) / 2, (z1 - z0) / 2 * hip), a = x0 + i, c = x1 - i;
        b.quad([x0, y, z1], [x1, y, z1], [c, t, zm], [a, t, zm], color); b.quad([x1, y, z0], [x0, y, z0], [a, t, zm], [c, t, zm], color);
        b.tri([x1, y, z1], [x1, y, z0], [c, t, zm], hip ? color : end); b.tri([x0, y, z0], [x0, y, z1], [a, t, zm], hip ? color : end);
      } else {
        const i = Math.min((z1 - z0) / 2, (x1 - x0) / 2 * hip), a = z0 + i, c = z1 - i;
        b.quad([x1, y, z1], [x1, y, z0], [xm, t, a], [xm, t, c], color); b.quad([x0, y, z0], [x0, y, z1], [xm, t, c], [xm, t, a], color);
        b.tri([x0, y, z1], [x1, y, z1], [xm, t, c], hip ? color : end); b.tri([x1, y, z0], [x0, y, z0], [xm, t, a], hip ? color : end);
      }
    },
    // A round-headed opening painted on a wall that faces +z.
    arch(x, z, w, h, color, y0 = 0) {
      const s = h - w / 2, m = h - w * 0.16;
      b.wall(x - w / 2, z, x + w / 2, z, y0, s, color);
      b.quad([x - w / 2, s, z], [x + w / 2, s, z], [x + w * 0.36, m, z], [x - w * 0.36, m, z], color); b.quad([x - w * 0.36, m, z], [x + w * 0.36, m, z], [x + w * 0.14, h, z], [x - w * 0.14, h, z], color);
    },
    // A mast or spire through rings [x, y, z, radius, colour of the length above]; four sides with turn = 45 degrees is square to the axes.
    tube(pts, sides = 4, turn = Math.PI / 4) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay, az, ar, color] = pts[i], [bx, by, bz, br] = pts[i + 1];
        for (let s = 0; s < sides; s++) {
          const c0 = Math.cos(turn + s / sides * TAU), s0 = Math.sin(turn + s / sides * TAU), c1 = Math.cos(turn + (s + 1) / sides * TAU), s1 = Math.sin(turn + (s + 1) / sides * TAU);
          b.quad([ax + c1 * ar, ay, az + s1 * ar], [ax + c0 * ar, ay, az + s0 * ar], [bx + c0 * br, by, bz + s0 * br], [bx + c1 * br, by, bz + s1 * br], color);
        }
      }
    },
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Q, 3));
      g.computeVertexNormals();
      return g;
    },
    get empty() { return !P.length; },
  };
  return b;
}

// A temple front facing +z from z0: podium, a row of square columns before a shadowed wall, entablature, pediment and steps.
function portico(b, cx, z0, w, base, col, n, deep, stone, steps = 0, lead = LEAD) {
  const x0 = cx - w / 2, x1 = cx + w / 2, top = base + col * 1.2;
  b.block(x0, x1, z0 - 1, z0 + deep, 0, base, { wall: stone, roof: stone });
  b.wall(x0 + 1, z0 + 0.3, x1 - 1, z0 + 0.3, base, base + col, SHADE);
  for (let i = 0; i < n; i++) b.pier(x0 + 1.6 + i * (w - 3.2) / (n - 1), z0 + deep - 1.6, w / n * 0.42, base, base + col, stone);
  b.block(x0, x1, z0 - 1, z0 + deep, base + col, top, { wall: stone });
  b.roof(x0 - 0.5, x1 + 0.5, z0 - 1, z0 + deep + 0.5, top, w * 0.19, lead, 0, 'z', stone);
  for (let i = 0; i < steps; i++) b.block(cx - w * 0.4, cx + w * 0.4, z0 + deep + i * 2.5, z0 + deep + (i + 1) * 2.5, 0, base * (1 - (i + 1) / (steps + 1)), { wall: stone, roof: stone });
}
// A flagpole with the flag flying toward +x.
const flag = (x, z, h, s = 1) => [box(0.7 * s, h, 0.7 * s, 0xd9d9d9, { x, z }), box(6 * s, 3.6 * s, 0.4, 0xc23a3a, { x: x + 3.4 * s, y: h - 3.8 * s, z }), box(2.6 * s, 2 * s, 0.5, 0x2c3f8f, { x: x + 1.7 * s, y: h - 2.2 * s, z })];
// A tower crane: mast, jib swung to `a`, counterweight.
const crane = (x, z, h, a) => [box(4, h, 4, CRANE, { x, z }), box(66, 2.6, 2.6, CRANE, { x: x + Math.cos(a) * 17, y: h, z: z - Math.sin(a) * 17, ry: a }),
  box(6, 6, 5, 0x8c8c8c, { x: x - Math.cos(a) * 13, y: h - 5.5, z: z + Math.sin(a) * 13, ry: a }), box(1.6, 9, 1.6, CRANE, { x, y: h + 2.6, z })];

// The whole city, worked out once: geometry by chunk, the footprints of everything standing, and which of those are in reach.
let made = null;
function city() {
  if (made) return made;
  const rnd = rng(1800), span = (a, b) => a + rnd() * (b - a), pick = (a) => a[Math.floor(rnd() * a.length)];
  const chunks = {}, fills = {}, claims = [], solids = [], lampsA = quads(), lampsB = quads();
  // chunks small enough to be culled when you look the other way: far ones are 60 degree wedges (F1 is the view down the Mall)
  const nearKey = (x, z) => (z < -155 ? (x < 0 ? 'ne' : 'se') : z > 110 ? (x < 0 ? 'nw' : 'sw') : x < 0 ? 'n' : 's');
  const farKey = (x, z) => 'F' + Math.floor((Math.atan2(z, x) + TAU) % TAU / (TAU / 6));
  const add = (key, g) => (chunks[key] ||= []).push(g);
  const near = (geos, o) => add(nearKey(o.x, o.z), place(merge(geos), o));
  const far = (geos, o, pop = 1) => add(farKey(o.x, o.z), bake(place(merge(geos), o), pop));
  const fill = (key, pop = 1) => (fills[key + pop] ||= Object.assign(quads(), { key, pop }));
  // Take a footprint: nothing else is built there, and (unless it is open ground) nobody walks through it.
  const claim = (x0, x1, z0, z1, open) => {
    const c = { x0, x1, z0, z1 };
    (open ? [claims] : [claims, footprints]).forEach((l) => l.push(c));
    if (!open && Math.hypot(Math.max(x0, -x1, 0), Math.max(z0, -z1, 0)) < CFG.worldRadius + 12) solids.push(c);
  };
  const footprints = [];
  const lamp = (b, x, y, z, s) => b.block(x - s, x + s, z - s, z + s, y, y + s * 2, { wall: RED, roof: RED });
  const DIAG = [...ROADS.filter((r) => r.id === 'pennsylvania' || r.id === 'maryland').map((r) => r.pts), [[-300, 620], [-372, 825]], [[205, 352], [372, 820]]];   // the avenues that cut across the grid, carried on to what closes their views: the White House, the Jefferson Memorial
  const free = (x0, x1, z0, z1) => {
    if (claims.some((c) => x0 < c.x1 + 4 && x1 > c.x0 - 4 && z0 < c.z1 + 4 && z1 > c.z0 - 4)) return false;
    if (MOUNDS.some((m) => m.x > x0 - 14 && m.x < x1 + 14 && m.z > z0 - 14 && m.z < z1 + 14)) return false;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (DIAG.some((p) => lineDist(x0 + (x1 - x0) * i / 5, z0 + (z1 - z0) * j / 5, p) < 14)) return false;
    return true;
  };

  // ---- east of First St: the Supreme Court and the Library of Congress either side of East Capitol St -----------------
  {
    const b = quads();
    b.block(-52, 52, -40, 18, 0, 17, { wall: MARBLE, glass: 0x8d949b, bay: 5.5, plinth: 4, cap: 3, roof: 0xcfd2d0 });
    b.block(-22, 22, -46, 30, 0, 28, { wall: MARBLE });
    b.roof(-23, 23, -46, 30, 28, 8, LEAD, 0, 'z', MARBLE);
    portico(b, 0, 30, 46, 8, 15, 8, 10, MARBLE, 4);
    for (const s of [-1, 1]) b.block(s * 22 - 3, s * 22 + 3, 40, 50, 0, 9.5, { wall: MARBLE, roof: MARBLE });
    near([b.geo(), flag(-38, 40, 17), flag(38, 40, 17)], { x: -84, z: -217 });
    claim(-136, -32, -263, -177); claim(-110, -58, -177, -167);
  }
  {
    const b = quads(), w = { wall: GRANITE, base: 0xa29f96, glass: 0x4a525a, bay: 4.4, plinth: 6, cap: 3, roof: 0x93a89c };
    b.block(-52, 52, -45, 30, 0, 21, w);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.block(sx * 46 - 9, sx * 46 + 9, sz > 0 ? 15 : -48, sz > 0 ? 33 : -30, 0, 25, w);
    b.block(-18, 18, 28, 36, 0, 27, { wall: GRANITE, roof: 0x93a89c });
    portico(b, 0, 36, 34, 9, 12, 6, 5, GRANITE, 3, 0x93a89c);
    near([b.geo(), cyl(15, 16, 9, 8, GRANITE, { y: 21, z: -6 }), dome(14.5, COPPER, { y: 30, z: -6, sy: 0.85 }), cyl(3, 3.4, 5, 6, 0xdad6c8, { y: 42, z: -6 }), cone(2.2, 5.5, 5, GOLD, { y: 47, z: -6 })], { x: 88, z: -215 });
    claim(33, 143, -263, -179); claim(66, 110, -179, -166);
  }

  // ---- the office buildings: Senate to the north of Constitution Ave, House to the south of Independence ---------------
  const temple = { wall: MARBLE, base: lift(0xd3cfc4), glass: SHADE, bay: 3.6, plinth: 7, cap: 5, roof: 0xb9bcb8 };
  const site = (key, x0, x1, z0, z1, h, o) => { fill(key).block(x0, x1, z0, z1, 0, h, o); claim(x0, x1, z0, z1); };
  site('n', -300, -222, -142, -32, 24, temple);                                                                             // Russell
  site('ne', -296, -222, -250, -164, 26, { ...temple, glass: 0x4d4a44, bay: 2.6, plinth: 5, cap: 2.5 });                      // Dirksen
  site('ne', -292, -222, -338, -258, 30, { wall: lift(0xecebe6), glass: 0x26323c, row: 3.6, plinth: 1.2, cap: 1.5, roof: 0xb9bcb8 });   // Hart, the modern one
  site('s', 222, 300, -142, -62, 24, temple);                                                                               // Cannon
  site('s', 226, 292, -52, 18, 25, { ...temple, bay: 3 });                                                                  // Longworth
  site('s', 222, 290, 28, 104, 32, { ...temple, plinth: 10, cap: 4, bay: 4.2 });                                            // Rayburn
  site('se', 222, 300, -256, -164, 28, { wall: MARBLE, glass: 0x3d4850, bay: 3, plinth: 6, cap: 6, roof: 0xb9bcb8 });         // the Library's Madison Building
  for (const s of [-1, 1]) near([cyl(8, 8, 26, 8, MARBLE), dome(7.5, 0xc9ccc8, { y: 26, sy: 0.6 })], { x: s * 227, z: s < 0 ? -37 : -67 });   // Russell's and Cannon's corner rotundas
  { const b = quads(); portico(b, 0, 0, 34, 7, 14, 8, 4, MARBLE, 2); near([b.geo()], { x: 226, z: -17, ry: -Math.PI / 2 }); }

  // ---- the Botanic Garden conservatory: a stone arcade under glass, the Palm House standing up out of the middle --------
  {
    const b = fill('sw'), GL = 0xa9d6d2;
    b.block(222, 262, 126, 186, 0, 8, { wall: LIME, glass: 0x6fa9a6, bay: 3.2, plinth: 1.5, cap: 1.5 });
    b.roof(223, 261, 127, 185, 8, 8, GL, 0.5, 'z');
    b.block(230, 254, 144, 168, 8, 23, { wall: 0xeef2ee, glass: 0x8fc9c4, bay: 2, cap: 1 });
    b.roof(229, 255, 143, 169, 23, 7, GL, 1);
    claim(222, 262, 126, 186);
  }

  // ---- museum row, north side: the National Gallery's East and West Buildings, Natural History, American History -------
  {
    const b = fill('nw'), P = [[-166, 292], [-124, 292], [-124, 216], [-166, 276]];   // the East Building: a knife edge pointing at the Capitol
    P.forEach((p, i) => { const q = P[(i + 1) % 4]; b.wall(p[0], p[1], q[0], q[1], 0, 23, PINK); });
    b.quad([P[0][0], 23, P[0][1]], [P[1][0], 23, P[1][1]], [P[2][0], 23, P[2][1]], [P[3][0], 23, P[3][1]], 0xc9c0b8);
    b.block(-166, -154, 280, 293, 0, 31, { wall: PINK, roof: 0xc9c0b8 }); b.block(-134, -123, 280, 293, 0, 31, { wall: PINK, roof: 0xc9c0b8 }); b.block(-135, -123, 222, 240, 0, 29, { wall: PINK, roof: 0xc9c0b8 });
    b.wall(-153, 292.3, -135, 292.3, 0, 13, SHADE); b.wall(-123.7, 276, -123.7, 244, 14, 17, SHADE); b.wall(-123.7, 264, -123.7, 256, 0, 6, SHADE);   // glass set back between the towers; a strip window and the door on the Mall side
    near([cone(6, 5, 4, 0x9cc4d6, { x: -6, z: 4 }), cone(4.5, 4, 4, 0x9cc4d6, { x: 3, z: -5 }), cone(4.5, 4, 4, 0x9cc4d6, { x: 5, z: 6 })], { x: -140, y: 23, z: 262 });
    claim(-142, -124, 218, 292); claim(-154, -142, 244, 292); claim(-166, -154, 264, 292);
  }
  {
    const b = quads();
    b.block(-68, 68, -30, 30, 0, 22, { wall: PINK, glass: 0xc4b3ab, bay: 9, plinth: 5, cap: 4, roof: LEAD });
    b.block(-20, 20, -32, 32, 0, 27, { wall: PINK, roof: LEAD });
    for (const s of [-1, 1]) b.block(s * 44 - 17, s * 44 + 17, -7, 7, 22, 24.5, { wall: 0x9db8c4, roof: 0xb7ccd4 });
    portico(b, 0, 32, 34, 6, 14, 8, 6, PINK, 3);
    near([b.geo(), cyl(17, 18, 5, 10, PINK, { y: 27 }), dome(16, LEAD, { y: 32, sy: 0.5 }, 10, 3)], { x: -162, z: 380, ry: Math.PI / 2 });
    claim(-194, -116, 312, 448);
  }
  {
    const b = quads(), st = 0xd9d6cc;
    b.block(-58, 58, -28, 28, 0, 24, { wall: st, glass: 0x4f565d, bay: 3.2, plinth: 6, cap: 4, roof: LEAD });
    portico(b, 0, 28, 36, 7, 14, 6, 8, st, 3);
    far([b.geo(), cyl(16, 17, 8, 8, st, { y: 24 }), dome(15.5, 0x7fa590, { y: 32, sy: 0.9 })], { x: -160, z: 545, ry: Math.PI / 2 }, 0.9);
    claim(-190, -120, 485, 605);
  }
  {
    const b = quads(), st = 0xe6dcd3;
    b.block(-56, 56, -30, 30, 0, 20, { wall: st, glass: 0xb5a79d, bay: 7, plinth: 4, cap: 1 });
    b.block(-48, 48, -22, 22, 20, 25, { wall: 0x3c4a55 }); b.block(-52, 52, -26, 26, 25, 27, { wall: st, roof: 0xc9c6bd });
    b.top(-56, 56, -30, 30, 20, 0xc9c6bd);
    far([b.geo(), flag(0, 0, 40, 1.8)], { x: -160, z: 700, ry: Math.PI / 2 }, 0.9);
    claim(-192, -128, 644, 756);
  }

  // ---- museum row, south side: American Indian, Air and Space, the Hirshhorn, the Castle, Agriculture ------------------
  near([cyl(34, 36, 7, 9, 0xd6b67c, { sz: 0.85 }), cyl(33, 33, 1.5, 9, 0x3a3a36, { y: 7, sz: 0.85 }), cyl(35, 34, 7, 9, 0xd6b67c, { y: 8.5, ry: 0.3, sz: 0.85 }), cyl(31, 31, 1.5, 9, 0x3a3a36, { y: 15.5, ry: 0.3, sz: 0.85 }),
    cyl(31, 33, 7, 9, 0xd6b67c, { y: 17, ry: 0.7, sz: 0.85 }), dome(12, 0xc9a96e, { y: 24, sy: 0.4 })], { x: 141, z: 272, sx: 0.6, sz: 0.95 });   // squeezed into the wedge between Jefferson Drive and Maryland Avenue
  claim(121, 157, 246, 298);
  {
    const b = fill('sw');   // Air and Space: marble blocks with dark glass halls between them
    for (let i = 0; i < 4; i++) {
      const z = 310 + i * 42;
      b.block(124, 182, z, z + 26, 0, 25, { wall: lift(0xe8e2d6, 1.4), roof: 0xc9c6bd });
      if (i < 3) b.block(126, 180, z + 26, z + 42, 0, 20, { wall: 0x7f97a6, glass: 0x24343f, bay: 2, cap: 1, roof: 0x4f6f86, hide: 3 });
    }
    claim(124, 182, 310, 462);
  }
  far([cyl(34, 34, 20, 12, 0xcabfad, { y: 6 }), cyl(17, 17, 0.6, 12, 0x5a5650, { y: 26 }), box(1.2, 3.4, 20, 0x45474a, { x: -33.6, y: 17 }),
    ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([i, j]) => box(9, 6, 9, 0xcabfad, { x: i * 19, z: j * 19 }))], { x: 160, z: 500 }, 0.9);
  claim(124, 196, 464, 536);
  {
    const b = quads(), dark = 0x4d4a4e, w = { wall: SAND, glass: 0x4a2a24, bay: 3, plinth: 3, cap: 2 };   // the Castle: red sandstone, no two towers alike
    b.block(-62, 62, -7, 7, 0, 10, w); b.roof(-62, 62, -7, 7, 10, 5, dark, 0, 'x', SAND);
    b.block(-36, 36, -10, 10, 0, 15, w); b.roof(-36, 36, -10, 10, 15, 7, dark, 0, 'x', SAND);
    b.block(-62, -46, -12, 12, 0, 14, w); b.roof(-62, -46, -12, 12, 14, 7, dark, 0, 'z', SAND);
    b.block(46, 62, -11, 11, 0, 13, w); b.roof(46, 62, -11, 11, 13, 6, dark, 0, 'z', SAND);
    for (const [x0, x1, z0, z1, h, r] of [[4, 12, 9, 17, 38, 11], [34, 39, 8, 13, 31, 7], [-7, 7, -19, -9, 27, 3], [51, 56, -15, -10, 24, 5]]) { b.block(x0, x1, z0, z1, 0, h, { wall: SAND }); b.roof(x0 - 0.6, x1 + 0.6, z0 - 0.6, z1 + 0.6, h, r, dark, 1); }
    far([b.geo(), cyl(3.8, 3.8, 29, 8, SAND, { x: -8, z: 13 }), cone(4.6, 10, 8, dark, { x: -8, y: 29, z: 13 }), cyl(2.6, 2.6, 22, 6, SAND, { x: -54, z: 13 }), cone(3.2, 7, 6, dark, { x: -54, y: 22, z: 13 })], { x: 160, z: 600, ry: -Math.PI / 2 }, 0.85);
    claim(138, 182, 536, 664);
  }
  {
    const b = quads();
    b.block(-75, 75, -28, 28, 0, 24, { wall: MARBLE, glass: SHADE, bay: 3.4, plinth: 6, cap: 4, roof: LEAD });
    for (const s of [-1, 1]) b.block(s * 66 - 10, s * 66 + 10, -30, 31, 0, 27, { wall: MARBLE, roof: LEAD });
    portico(b, 0, 28, 44, 6, 14, 8, 6, MARBLE, 3);
    far([b.geo()], { x: 164, z: 745, ry: -Math.PI / 2 });
    claim(130, 196, 668, 822);
  }

  // ---- Union Station to the north, seen across Upper Senate Park: three great arches, wings of arcades, flags on Columbus Circle
  {
    const b = quads(), st = 0xe6e3da, hole = 0x3c4248;
    b.block(-30, 30, -22, 24, 0, 29, { wall: st }); b.roof(-30, 30, -22, 24, 29, 9, 0x9aa39b, 0.35, 'x');
    for (const x of [-19, 0, 19]) b.arch(x, 24.3, 12, 21, hole);
    for (const x of [-28.5, -9.5, 9.5, 28.5]) b.pier(x, 25.6, 2.6, 0, 22, st);
    b.block(-31, 31, 23, 27, 22, 25, { wall: st, roof: st });
    for (const s of [-1, 1]) {
      b.block(s > 0 ? 30 : -88, s > 0 ? 88 : -30, -14, 20, 0, 17, { wall: st, glass: SHADE, bay: 4.2, plinth: 2, cap: 4, roof: 0xa9b0a8 });
      b.block(s * 94 - 7, s * 94 + 7, -16, 22, 0, 22, { wall: st, roof: 0xa9b0a8 }); b.arch(s * 94, 22.3, 9, 16, hole);
    }
    far([b.geo(), flag(-24, 52, 26, 1.6), flag(0, 52, 26, 1.6), flag(24, 52, 26, 1.6)], { x: -455, z: -40, ry: Math.PI / 2 }, 0.75);
    claim(-480, -433, -142, 62); claim(-433, -330, -142, 62, true);
  }
  claim(-330, -220, -24, 112, true);   // Upper Senate Park stays open, so the station shows from the grounds

  // ---- down the Mall: the Monument on its knoll inside a ring of flags, the Lincoln Memorial, Rosslyn over the river ---
  {
    const b = quads(), lo = new THREE.Color(1.5, 1.44, 1.3), hi = new THREE.Color(1.3, 1.25, 1.14), r2 = Math.SQRT2;   // brighter than stone: the one thing that must read from anywhere
    b.tube([[0, 5, 0, 10 * r2, lo], [0, 50, 0, 8.9 * r2, hi], [0, 137, 0, 6.4 * r2, hi], [0, 155, 0, 0]]);
    const ring = []; for (let i = 0; i < 12; i++) ring.push(flag(Math.cos(i / 12 * TAU) * 40, Math.sin(i / 12 * TAU) * 40, 17, 1.3));
    far([b.geo(), cyl(50, 140, 7, 12, 0x5d8a4c), ...ring], { x: 0, z: 800 }, 0.6);
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lamp(lampsA, i * 6.6, 137, 800 + j * 6.6, 1.9);
    claim(-140, 140, 660, 940, true);
  }
  {
    const b = quads();
    b.block(-48, 48, -30, 30, 0, 6, { wall: MARBLE, roof: MARBLE });
    b.block(-40, 40, -23, 23, 6, 31, { wall: MARBLE, glass: 0x747a80, bay: 9.4, cap: 5, roof: MARBLE });
    b.block(-34, 34, -18, 18, 31, 39, { wall: MARBLE, roof: 0xd4d2ca });
    far([b.geo()], { x: 0, z: 950 }, 0.8);
  }
  {
    const b = fill('F1');
    for (const [x, z, w, h, c] of [[-330, 965, 34, 92, 0], [-292, 990, 28, 124, 1], [-262, 960, 30, 102, 2], [-232, 995, 26, 148, 0], [-204, 968, 32, 112, 1], [-172, 992, 28, 132, 2], [-142, 962, 30, 96, 0], [-108, 985, 26, 118, 1], [-76, 1000, 30, 84, 2]]) {
      b.block(x - w / 2, x + w / 2, z - 13, z + 13, 0, h, { wall: [0x8fa3b5, 0x6f8ba3, 0xa7b3bd][c], glass: [0x4f6f8c, 0x3f5f7c, 0x5f7d96][c], row: h / 6, cap: 4, roof: 0x7f8f9c, hide: 1 });
      if (h > 110) { b.block(x - w / 4, x + w / 4, z - 6, z + 6, h, h + 10, { wall: 0x7f8f9c, roof: 0x7f8f9c, hide: 1 }); lamp(lampsB, x, h + 10, z, 2); }
    }
  }

  // ---- off the axis: the Jefferson Memorial and the Air Force Memorial to the south-west; up Pennsylvania Avenue the
  //      Archives, the Old Post Office tower and, closing the view, the Treasury and the White House ---------------------
  {
    const b = quads(), ring = [];
    for (let i = 0; i < 12; i++) ring.push(box(3.4, 17, 3.4, MARBLE, { x: Math.cos(i / 12 * TAU) * 31, y: 6, z: Math.sin(i / 12 * TAU) * 31, ry: -i / 12 * TAU }));
    portico(b, 0, 0, 30, 6, 17, 4, 9, MARBLE, 0, MARBLE);
    far([cyl(60, 120, 8, 12, 0x5d8a4c, { y: -8 }), cyl(40, 46, 6, 12, MARBLE), cyl(26, 26, 17, 12, 0x868b90, { y: 6 }), ...ring, cyl(34, 34, 4.5, 12, MARBLE, { y: 23 }), dome(28, 0xf0eee8, { y: 27.5, sy: 0.72 }, 10, 4), place(b.geo(), { x: -30, ry: -Math.PI / 2 })], { x: 385, y: 6, z: 858, s: 1.35 }, 0.5);
    claim(315, 455, 790, 930, true);
  }
  {
    const b = quads(), steel = 0xdfe4e8;   // three steel spires peeling apart like a bomb burst
    for (const [a, h, lean] of [[0.4, 118, 26], [2.5, 100, 34], [4.6, 86, 40]]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4, out = 7 + lean * t * t; pts.push([Math.cos(a) * out, h * t, Math.sin(a) * out, 4.2 * (1 - t) + 0.5, steel]); }
      b.tube(pts, 3, a);
    }
    far([b.geo()], { x: 590, z: 780 }, 0.66);
  }
  {
    const b = quads();
    b.block(-30, 30, -17, 17, 0, 21, { wall: LIME, glass: SHADE, bay: 3.6, plinth: 5, cap: 4, roof: LIME });
    b.block(-22, 22, -11, 11, 21, 29, { wall: LIME, roof: 0xc4bca8 });
    portico(b, 0, 17, 30, 5, 13, 6, 6, LIME, 2, LIME);
    far([b.geo()], { x: -234, z: 532, ry: Math.PI / 2 }, 0.9);
    claim(-256, -214, 500, 564);
  }
  {
    const b = fill('F1', 0.78), st = 0xa7a299, x0 = -278, z0 = 604;   // the Old Post Office: a clock tower over the avenue
    b.block(-284, -226, 584, 640, 0, 30, { wall: st, glass: 0x45484b, row: 5, plinth: 5, cap: 2, far: 1 }); b.roof(-285, -225, 583, 641, 30, 9, SLATE, 1);
    b.block(x0, x0 + 17, z0, z0 + 17, 0, 86, { wall: st, glass: 0x45484b, bay: 3.4, plinth: 66, cap: 8 }); b.roof(x0 - 1, x0 + 18, z0 - 1, z0 + 18, 86, 20, SLATE, 1);
    b.wall(x0 + 13.5, z0 - 0.4, x0 + 3.5, z0 - 0.4, 55, 65, 0xf4f1e6); b.wall(x0 + 17.4, z0 + 13.5, x0 + 17.4, z0 + 3.5, 55, 65, 0xf4f1e6); b.wall(x0 - 0.4, z0 + 3.5, x0 - 0.4, z0 + 13.5, 55, 65, 0xf4f1e6);
    claim(-286, -224, 582, 642);
  }
  {
    const b = quads(), w = 0xf3f1eb;   // the White House, bigger than life so it reads at this distance
    b.block(-28, 28, -9, 9, 0, 17, { wall: w, glass: SHADE, bay: 3.6, plinth: 5, cap: 2.5, roof: 0xc9ccc8 });
    for (const s of [-1, 1]) b.block(s * 42 - 14, s * 42 + 14, -5, 5, 0, 7, { wall: w, roof: 0xc9ccc8 });
    portico(b, 0, 9, 20, 5, 10, 5, 6, w, 0, w);
    far([b.geo(), flag(0, 0, 27, 1.3), cyl(30, 90, 8, 10, 0x5d8a4c, { y: -8 })], { x: -378, y: 8, z: 850, ry: 2.8, s: 1.5 }, 0.7);
    claim(-440, -320, 800, 900, true);
  }
  {
    const b = quads();
    b.block(-48, 48, -14, 14, 0, 23, { wall: 0xd9d4c6, glass: SHADE, bay: 4.4, plinth: 5, cap: 3, roof: LEAD });
    portico(b, 0, 14, 34, 5, 15, 6, 6, 0xd9d4c6);
    far([b.geo()], { x: -466, z: 800, ry: 2.8 }, 0.8);
    claim(-530, -410, 745, 855);
  }

  // ---- on the ridge: the Cathedral's three towers, the Shrine's blue dome and campanile, and the television masts -----
  {
    const b = quads(), st = 0xcfc8b6, dark = 0x8d8a82;
    b.block(-45, 45, -9, 9, 0, 30, { wall: st, glass: dark, bay: 5, plinth: 12, cap: 3 }); b.roof(-45, 45, -9, 9, 30, 10, dark, 0, 'x', st);
    b.block(-10, 10, -26, 26, 0, 30, { wall: st }); b.roof(-10, 10, -26, 26, 30, 10, dark, 0, 'z', st);
    for (const [x, z, w, h] of [[0, 0, 9, 78], [43, -11, 6, 58], [43, 11, 6, 58]]) {
      b.block(x - w, x + w, z - w, z + w, 0, h, { wall: st, glass: dark, bay: w * 0.66, plinth: h - 22, cap: 4, roof: st });
      for (const i of [-1, 1]) for (const j of [-1, 1]) b.tube([[x + i * (w - 1.5), h, z + j * (w - 1.5), 2.2, st], [x + i * (w - 1.5), h + 11, z + j * (w - 1.5), 0]]);
    }
    far([b.geo()], { x: -618, y: rise(-618, 741) * 0.55 + 14, z: 741, ry: -Math.PI / 2, s: 1.25 }, 0.74);
  }
  {
    const b = quads(), st = 0xd8c9a8, blue = 0x3f6fa8;
    b.block(-34, 34, -18, 18, 0, 24, { wall: st, glass: 0x8a7f6a, bay: 6, plinth: 6, cap: 4 }); b.roof(-34, 34, -18, 18, 24, 7, 0xb5a98c, 0, 'x', st);
    b.block(-48, -38, -5, 5, 0, 92, { wall: st, glass: 0x8a7f6a, bay: 3.3, plinth: 74, cap: 6 }); b.roof(-49, -37, -6, 6, 92, 16, blue, 1);
    far([b.geo(), cyl(15, 15, 12, 10, st, { x: 8, y: 24 }), cyl(15.6, 15.6, 2.5, 10, GOLD, { x: 8, y: 36 }), dome(15, blue, { x: 8, y: 38.5 }, 10, 4)], { x: -930, y: rise(-930, -250) * 0.55 + 12, z: -250, ry: 0.3, s: 1.2 }, 0.76);
  }
  for (const [x, z, h] of [[-720, 640, 215], [-880, 400, 190], [520, -800, 175]]) {
    const b = fill(farKey(x, z), 0.7), y0 = rise(x, z) * 0.5, pts = [];
    for (let k = 0; k <= 8; k++) pts.push([x, y0 + h * k / 8 - (k ? 0 : y0 + 4), z, 3.4 - k * 0.2, k % 2 ? 0xe8e4de : 0xc8402e]);
    b.tube(pts, 3, 0.5);
    lamp(lampsB, x, y0 + h, z, 2.4); lamp(lampsB, x, y0 + h * 0.5, z, 2.8);
  }

  // ---- the Capitol Power Plant's two stacks to the south, and a block going up on Constitution Avenue ----------------
  far([box(50, 22, 36, 0x94664e), cyl(3.4, 4.6, 72, 8, 0xd8d4c8, { x: -12, z: 4 }), cyl(3.4, 4.6, 64, 8, 0xd8d4c8, { x: 10, z: -6 }), cyl(3.6, 3.6, 5, 8, 0x4a4a4a, { x: -12, y: 72, z: 4 }), cyl(3.6, 3.6, 5, 8, 0x4a4a4a, { x: 10, y: 64, z: -6 })], { x: 450, z: -44 }, 0.9);
  claim(420, 480, -66, -22);
  fill('nw').block(-296, -226, 212, 286, 0, 26, { wall: 0xb5b0a4, glass: 0x34383d, row: 4.3, plinth: 0.4, roof: 0x9d988c });
  near([crane(0, 0, 62, 0.9), box(26, 12, 0.6, 0xe2742a, { x: 35.3, y: 9, ry: Math.PI / 2 })], { x: -261, z: 249 });
  lamp(lampsB, -261, 73.6, 249, 1.6);
  claim(-296, -226, 212, 286);

  // ---- everything else: a street grid of city blocks out to the hills ------------------------------------------------
  // Offices fill their lots to the height limit, flat-topped, with a plant room on the roof.
  const office = (x0, x1, z0, z1, kind) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, isFar = Math.hypot(cx, cz) > 400, y0 = elev(cx, cz), k = isFar ? 2.4 : 1, b = isFar ? fill(farKey(cx, cz)) : fill(nearKey(cx, cz));
    const w = x1 - x0, d = z1 - z0, two = Math.max(w, d) > 56 && rnd() < 0.6, t = span(0.42, 0.58), hs = [0, 1].map(() => y0 + (kind === 'fed' ? span(27, 31) : rnd() < 0.15 ? span(25, 32) : span(38, 46)));
    const lots = !two ? [[x0, x1, z0, z1, 0]] : w > d ? [[x0, x0 + w * t, z0, z1, 4], [x0 + w * t, x1, z0, z1, 8]] : [[x0, x1, z0, z0 + d * t, 1], [x0, x1, z0 + d * t, z1, 2]];
    lots.forEach(([a, c, e, f, inner], i) => {
      const st = kind === 'fed' ? { wall: LIME, glass: SHADE, bay: 3.4 } : pick(OFFICE), h = hs[i];
      b.block(a, c, e, f, 0, h, { wall: st.wall, glass: st.glass, row: st.row && st.row * k, bay: st.bay && st.bay * k, plinth: y0 + (isFar ? 0 : 4.6), cap: 1.6, roof: 0x8c8f8e, far: isFar, hide: two && h <= hs[1 - i] ? inner : 0 });
      if (kind === 'fed') b.roof(a - 0.5, c + 0.5, e - 0.5, f + 0.5, h, 6, TILE, 1);
      else if (rnd() < 0.65) { const px = a + (c - a) * span(0.15, 0.4), pz = e + (f - e) * span(0.15, 0.4); b.block(px, px + (c - a) * 0.4, pz, pz + (f - e) * 0.4, h, h + 4.5, { wall: 0x9a9d9c, roof: 0x7d807f, far: isFar }); }
    });
    if (isFar && rnd() < 0.05) { far([crane(0, 0, hs[0] + 26, span(0, TAU))], { x: x0 + 6, z: z0 + 6 }, 0.8); lamp(lampsB, x0 + 6, hs[0] + 37.6, z0 + 6, 1.4); }
    claim(x0, x1, z0, z1);
  };
  // One terrace of Capitol Hill row houses along `axis`, fronts facing the side s of the strip c0..c1.
  const terrace = (b, axis, a0, a1, c0, c1, s) => {
    const cf = s > 0 ? c1 : c0, cb = s > 0 ? c0 : c1;
    // a wall along the row at depth c facing side f, and a wall across it at u facing along the row
    const F = (u0, u1, c, f, y0, y1, col) => (axis === 'x' ? (f > 0 ? b.wall(u0, c, u1, c, y0, y1, col) : b.wall(u1, c, u0, c, y0, y1, col)) : f > 0 ? b.wall(c, u1, c, u0, y0, y1, col) : b.wall(c, u0, c, u1, y0, y1, col));
    const X = (u, f, y0, y1, col, ca = c0, cc = c1) => (axis === 'x' ? (f > 0 ? b.wall(u, cc, u, ca, y0, y1, col) : b.wall(u, ca, u, cc, y0, y1, col)) : f > 0 ? b.wall(ca, u, cc, u, y0, y1, col) : b.wall(cc, u, ca, u, y0, y1, col));
    let u = a0, was = 0;
    while (u < a1 - 0.1) {
      const w = a1 - u < 13 ? a1 - u : span(6.4, 9), n = rnd() < 0.3 ? 2 : 3, h = n * 3.3 + span(1.6, 2.6), col = pick(HOUSE), trim = rnd() < 0.5 ? 0xe9e4d8 : 0x3b3f44, v = u + w;
      F(u, v, cf, s, 0, h, col); F(u, v, cb, -s, 0, h, 0x8f7f72);
      if (was !== h) X(u, h > was ? -1 : 1, Math.min(was, h), Math.max(was, h), 0x8f7f72);
      F(u + 0.7, u + 2, cf + s * 0.15, s, 0, 2.5, trim);
      if (rnd() < 0.4) {   // a bay front, the Capitol Hill signature
        const p = cf + s * 1.4, u0 = u + w * 0.42, u1 = v - 0.5, lo = Math.min(cf, p), hi = Math.max(cf, p);
        F(u0, u1, p, s, 0, h + 0.5, col); X(u0, -1, 0, h + 0.5, col, lo, hi); X(u1, 1, 0, h + 0.5, col, lo, hi);
        if (axis === 'x') b.top(u0, u1, lo, hi, h + 0.5, 0x5c5f63); else b.top(lo, hi, u0, u1, h + 0.5, 0x5c5f63);
        for (let i = 0; i < n; i++) F(u0 + 0.6, u1 - 0.6, p + s * 0.15, s, i * 3.3 + 1.1, i * 3.3 + 2.9, 0x39424b);
      } else for (let i = 0; i < n; i++) F(u + (i ? 0.9 : 2.9), v - 0.9, cf + s * 0.15, s, i * 3.3 + 1.1, i * 3.3 + 2.9, 0x39424b);
      const [x0, x1, z0, z1] = axis === 'x' ? [u, v, c0, c1] : [c0, c1, u, v];
      if (rnd() < 0.25) b.roof(x0, x1, z0, z1, h, 2.6, pick([SLATE, 0x7d3a30, 0x5c5f63]), 0, axis, 0x8f7f72); else b.top(x0, x1, z0, z1, h, 0x5c5f63);
      u = v; was = h;
    }
    X(a1, 1, 0, was, 0x8f7f72);
    if (axis === 'x') claim(a0, a1, c0, c1); else claim(c0, c1, a0, a1);
  };
  const houses = (x0, x1, z0, z1) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(cx, cz);
    if (r < 400) {
      const b = fill(nearKey(cx, cz));
      terrace(b, 'z', z0, z1, x0, x0 + 11, -1); terrace(b, 'z', z0, z1, x1 - 11, x1, 1);
      terrace(b, 'x', x0 + 15, x1 - 15, z1 - 11, z1, 1); terrace(b, 'x', x0 + 15, x1 - 15, z0, z0 + 11, -1);
      return;
    }
    const b = fill(farKey(cx, cz), 0.62);   // further off: whole runs of houses as single coloured boxes
    for (const [a, c] of [[x0, x0 + 11], [x1 - 11, x1]]) for (let z = z0; z < z1 - 1;) { const d = Math.min(z1 - z, span(16, 28)); b.block(a, c, z, z + d, 0, span(8, 13), { wall: pick(HOUSE), roof: 0x5c5f63, far: 1 }); z += d; }
    if (rnd() < 0.12) {   // a church: gabled nave and a steeple
      const st = pick([0xb9b0a0, 0x9a5a48, 0xd8d0bc]), x = x0 + 26, z = cz;
      b.block(x, x + 34, z - 9, z + 9, 0, 13, { wall: st }); b.roof(x, x + 34, z - 9, z + 9, 13, 8, SLATE, 0, 'x', st);
      b.tube([[x - 4, 0, z, 5, st], [x - 4, 24, z, 5, SLATE], [x - 4, 46, z, 0]]);
    } else add(farKey(cx, cz), bake(ball(span(16, 24), pick(LEAVES), { x: cx, y: -4, z: cz, sy: 0.55 }), 0.62));
    claim(x0, x1, z0, z1);
  };
  // Try a lot; where an avenue or a landmark is in the way, try its halves.
  const lot = (x0, x1, z0, z1, fn, depth = 2) => {
    if (free(x0, x1, z0, z1)) return fn(x0, x1, z0, z1);
    if (!depth || Math.max(x1 - x0, z1 - z0) < 44) return;
    if (x1 - x0 > z1 - z0) { const m = (x0 + x1) / 2; lot(x0, m - 3, z0, z1, fn, depth - 1); lot(m + 3, x1, z0, z1, fn, depth - 1); }
    else { const m = (z0 + z1) / 2; lot(x0, x1, z0, m - 3, fn, depth - 1); lot(x0, x1, m + 3, z1, fn, depth - 1); }
  };
  // The grid: streets fall on the ones plan.js draws, with room for the trees along them.
  const xs = [[-190, -111], [-99, -18], [18, 99], [111, 190]], zs = [[128, 182], [12, 100], [-66, -12], [-140, -80]];
  for (let k = 0; k < 8; k++) { xs.push([220 + 104 * k, 304 + 104 * k], [-304 - 104 * k, -220 - 104 * k]); zs.push([210 + 104 * k, 294 + 104 * k], [-248 - 104 * k, -164 - 104 * k]); }
  for (const [x0, x1] of xs) for (const [z0, z1] of zs) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.hypot(cx, cz);
    if (r > 900 || cz > 880 || (Math.abs(cx) < 205 && cz > -150)) continue;                    // the hills, the river, the grounds and the Mall
    const woods = cx > 205 && cz > 640 || rnd() < (r - 600) / 380;                              // parks by the Tidal Basin; leafy streets further out
    if (woods) { if (free(x0, x1, z0, z1)) add(farKey(cx, cz), bake(ball(span(30, 44), pick(LEAVES), { x: cx, y: elev(cx, cz) - 8, z: cz, sy: 0.5 }))); continue; }
    if (cz < -150 && (Math.abs(cx) < 420 || r > 640)) lot(x0, x1, z0, z1, houses, 0);
    else lot(x0, x1, z0, z1, (a, c, e, f) => office(a, c, e, f, cx > -310 && cx < -205 && cz > 330 ? 'fed' : 'office'));
  }

  // ---- the horizon: two wooded ridges, the nearer one lower and broken by the river to the west ----------------------
  for (const [r0, r1, k, color, gap] of [[950, 1000, 0.6, 0x6b6a44, 1], [1005, 1055, 1, 0x5d6648, 0]]) {
    const n = 96, tops = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; tops.push((16 + rise(Math.cos(a), Math.sin(a)) * k + rnd() * 20) * (gap ? sstep(0.3, 0.6, Math.abs(a - Math.PI / 2)) : 1)); }
    for (let i = 0; i < n; i++) {
      const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, h0 = tops[i], h1 = tops[(i + 1) % n];
      if (h0 + h1 > 4) fill(farKey(Math.cos(a0 + 0.01), Math.sin(a0 + 0.01))).quad([Math.cos(a0) * r0, -6, Math.sin(a0) * r0], [Math.cos(a1) * r0, -6, Math.sin(a1) * r0], [Math.cos(a1) * r1, h1, Math.sin(a1) * r1], [Math.cos(a0) * r1, h0, Math.sin(a0) * r1], color);
    }
  }

  for (const b of Object.values(fills)) if (!b.empty) add(b.key, b.key[0] === 'F' ? bake(b.geo(), b.pop) : b.geo());
  return (made = { chunks, solids, footprints, lamps: [lampsA.geo(), lampsB.geo()] });
}

// Where buildings stand ({ x0, x1, z0, z1 }), for anything that should keep out of them.
export const footprints = () => city().footprints;

export async function build(game) {
  const c = city(), lamps = mesh(c.lamps, glowFar), nA = c.lamps[0].attributes.position.count, nB = c.lamps[1].attributes.position.count;
  for (const [key, geos] of Object.entries(c.chunks)) {
    const far = key[0] === 'F', m = mesh(geos, far ? glowFar : paint);
    if (far) m.geometry.deleteAttribute('normal');   // unlit: the light is already in the paint
    game.scene.add(m);
  }
  lamps.geometry.deleteAttribute('normal');
  c.chunks = {};   // merged now: let the loose pieces go
  game.scene.add(lamps);
  game.solids.push(...c.solids);
  // The Monument's lights (first in the mesh) flash together; the masts and cranes keep their own slower time.
  return { update(dt, g) {
    const a = g.time % 1.6 < 0.8, b = (g.time + 0.5) % 2.3 < 1.1;
    lamps.visible = a || b; lamps.geometry.setDrawRange(a ? 0 : nA, (a ? nA : 0) + (b ? nB : 0));
  } };
}
