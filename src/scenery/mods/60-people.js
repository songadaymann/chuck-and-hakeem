import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from '../../config.js';
import { person } from '../../assets.js';
import { ps1ify, canvasTex, FONT } from '../../ps1.js';
import * as K from '../kit.js';
import { ROADS, WALKS, POOL, CIRCLES, lineDist, inPool, inCapitol, nearMound, blocked, rng } from '../plan.js';

// The grounds, visited: walkers, joggers, tourists and a school group on the walks and sidewalks, a standing protest
// beside the centre walk, a TV crew, a half-smoke cart, and pigeons, squirrels, ducks and one dog.
// Nobody here is a player or a lobbyist. The budget is MAXP rigged people DRAWN at any moment. A few more than that
// exist around the camera (the ones behind you cost nothing), so wherever you turn there is somebody; when more than
// MAXP would be in the picture the nearest are drawn.
const TOUCH = matchMedia('(pointer: coarse)').matches, MAXP = TOUCH ? 8 : 16;
const FAR = 170, NEAR = 70, STEP = 4, TICK = 0.25;   // hidden beyond FAR; animated within NEAR; metres between path points; seconds between slow checks
const TAU = Math.PI * 2, rand = Math.random, hyp = Math.hypot;
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
// Move one instance: yaw, then nose-down pitch, with its own scale on each axis.
const put = (mesh, i, x, y, z, ry, rx, sx, sy = sx, sz = sx) => { mesh.setMatrixAt(i, M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, 0, 'YXZ')), S.set(sx, sy, sz))); mesh.instanceMatrix.needsUpdate = true; };

// Who plays what. Every different face is another download, so the walkers past the first few are twins of the cast.
const CAST = {
  protest: ['Medical_Female_01', 'Construction_Male_01', 'Male_Adult_05', 'Female_Adult_09', 'Gardener_Male_01'].slice(0, TOUCH ? 3 : 5),
  crew: ['Female_Adult_04', 'Delivery_Male_01'], vendor: ['Chef_Female_01'],
  // a phone gets the first fourteen, which add only four faces to the six standing about
  roam: ['Female_Adult_12', 'Male_Adult_10', 'Female_Child_01', 'Male_Child_01', 'Female_Adult_04', 'Male_Adult_05', 'Delivery_Male_01', 'Female_Adult_12', 'Medical_Female_01', 'Male_Adult_10',
    'Female_Child_01', 'Construction_Male_01', 'Female_Adult_04', 'Male_Adult_05', 'Female_Adult_02', 'Male_Adult_03', 'Female_Adult_09', 'Gardener_Male_01'].slice(0, TOUCH ? 14 : 18),
};
// Placards: paper, ink, then the lines. The first five are carried (three on a phone, the other two staked beside them), the next two are planted in the lawn, the last is the cart's.
const SIGNS = [['#f4efe2', '#14110d', 'DIG THEM', 'OUT'], ['#ffc21a', '#14110d', 'NEW', 'LEADERS', 'NOW'], ['#d8402f', '#ffffff', 'PASS THE', 'SHOVEL'], ['#f4efe2', '#b3261a', 'TERM LIMITS', 'FOR MOUNDS'],
  ['#2f6fd0', '#ffffff', 'HONK IF', 'YOU DIG'], ['#14110d', '#ffc21a', "THEY WON'T", 'LEAVE'], ['#f4efe2', '#14110d', 'DIG', 'DEEPER'], ['#b3261a', '#ffe9a8', 'HALF', 'SMOKES']];
const TILE = 64, SHEET = TILE * SIGNS.length + 8;

// ---- where people walk --------------------------------------------------------------------------------------------
// A lane is a run of points STEP apart along a walk or a sidewalk, with the sideways normal at each point, how far
// either side of the line feet may stray, and the places you can turn off onto another lane.
function buildLanes() {
  const lanes = [], onRoad = (x, z, but) => ROADS.some((r) => r !== but && lineDist(x, z, r.pts) < r.w / 2);
  const usable = (x, z) => Math.abs(x) < 345 && z > -345 && z < 520 && !inPool(x, z, 1.5) && !inCapitol(x, z, 1) && !nearMound(x, z, 3) && !CIRCLES.some((c) => hyp(x - c.x, z - c.z) < c.r + 7);
  const lane = (s, half, weight) => lanes.push({ n: s.length, half, weight: weight * s.length, link: new Array(s.length), p: Float32Array.from(s.flatMap((q) => [q.x, q.z])), nx: Float32Array.from(s, (q) => q.nx), nz: Float32Array.from(s, (q) => q.nz),
    road: Uint8Array.from(s, (q) => +onRoad(q.x, q.z)),   // out on the asphalt: look before stepping onto these
    // a good place to stop and photograph a giant: in front of the building, close enough to fill a phone
    view: Uint8Array.from(s, (q) => +(q.z > 42 && CFG.giants.some((g) => { const d = hyp(q.x - g.x, q.z - g.z); return d > 30 && d < 150; }))) });
  const sample = (pts, off, road) => {
    const s = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = hyp(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      for (let d = 0; d <= len; d += STEP) {
        const x = ax + ux * d - uz * off; let z = az + uz * d + ux * off;
        if (road && road.id === 'first-w' && off < 0 && Math.abs(x) < 16) z -= 1.3;   // a row of bollards stands down the middle of this sidewalk where the centre walk meets it: pass behind them
        s.push({ x, z, nx: -uz, nz: ux, bad: !usable(x, z), cross: onRoad(x, z, road) });
      }
    }
    return s;
  };
  const add = (pts, off, half, weight, road) => {
    const s = sample(pts, off, road);
    // a few steps over someone else's street is a crossing; a long stretch is walking down the road
    for (let i = 0, run = 0; i <= s.length; i++) { if (i < s.length && s[i].cross) run++; else { if (run > 5) for (let k = i - run; k < i; k++) s[k].bad = true; run = 0; } }
    for (let i = 0, from = 0; i <= s.length; i++) {
      if (i < s.length && !s[i].bad) continue;
      let a = from, b = i;
      while (a < b && s[a].cross) a++;
      while (b > a && s[b - 1].cross) b--;
      if (b - a >= 7) lane(s.slice(a, b), half, weight);
      from = i + 1;
    }
  };
  for (const w of WALKS) {
    const mall = w.id.startsWith('mall');
    if (w.id === 'centre') add([[9, 42], [9, 106]], 0, 4.5, 12, null);   // the south half only: a welcome board stands in the middle, and the north half is the TV crew's, the cart's and the pigeons'
    else add(w.pts, 0, Math.min(22, w.w / 2 - (mall ? 0.6 : 1.2)), mall || w.id === 'east-plaza' ? 2 : 4, null);
  }
  // the trodden tracks from the centre walk to the foot of each pile (drawn by the ground module), and a way across the walk behind the welcome board
  for (const s of [-1, 1]) for (const pts of [[[15, 63.5], [22, 59], [32, 50], [38, 44.5]], [[15, 85], [27, 72], [41, 58]]]) add(pts.map(([x, z]) => [x * s, z]), 0, 0.8, 6, null);
  add([[-15, 70.3], [13, 70.3]], 0, 0.5, 1, null);
  for (const r of ROADS) for (const side of [-1, 1]) add(r.pts, side * (r.w / 2 + 1.9), 0.6, 1, r);   // the far half of the 3 m sidewalk: the lamp posts stand along the kerb
  // the painted crossings: the centre walk over First St, the pool walks over Third St (nobody starts out on these)
  for (const [x, z0, z1, half] of [[0, 107, 123, 4], [-45, 189, 205, 2], [45, 189, 205, 2]]) lane(sample([[x, z0], [x, z1]], 0, null), half, 0);

  // turn-offs: from the end of a lane onto whatever passes close by, and back again
  for (const A of lanes) for (const i of [0, A.n - 1]) {
    const ax = A.p[i * 2], az = A.p[i * 2 + 1];
    for (const B of lanes) {
      if (B === A) continue;
      let j = -1, best = 20;
      for (let k = 0; k < B.n; k++) { const d = hyp(B.p[k * 2] - ax, B.p[k * 2 + 1] - az); if (d < best) { best = d; j = k; } }
      if (j < 0) continue;
      const bx = B.p[j * 2], bz = B.p[j * 2 + 1];
      if (best > 5 && [0.25, 0.5, 0.75].some((t) => !usable(ax + (bx - ax) * t, az + (bz - az) * t) || onRoad(ax + (bx - ax) * t, az + (bz - az) * t))) continue;   // over grass, never over a street or through water
      (A.link[i] ||= []).push({ lane: B, j });
      (B.link[j] ||= []).push({ lane: A, j: i });
    }
  }
  return lanes;
}

// ---- signs --------------------------------------------------------------------------------------------------------
// One small sheet holds every sign, so all the placards share a material. The strip along the bottom is bare wood.
function signKit() {
  const tex = canvasTex(128, SHEET, (g) => {
    g.fillStyle = '#8a6a45'; g.fillRect(0, 0, 128, SHEET);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    SIGNS.forEach(([paper, ink, ...lines], i) => {
      const y = i * TILE;
      g.fillStyle = ink; g.fillRect(0, y, 128, TILE);
      g.fillStyle = paper; g.fillRect(3, y + 3, 122, TILE - 6);
      g.fillStyle = ink;
      // every line as big as the board allows, like a sign somebody lettered by hand
      const fit = lines.map((l) => { let px = 44; do g.font = `${px}px ${FONT.big}`; while (g.measureText(l).width > 112 && --px > 6); return px * 0.9; }), k = Math.min(1, (TILE - 10) / fit.reduce((a, b) => a + b));
      let top = y + (TILE - fit.reduce((a, b) => a + b) * k) / 2;
      lines.forEach((l, n) => { g.font = `${fit[n] * k / 0.9}px ${FONT.big}`; g.fillText(l, 64, top + fit[n] * k * 0.54); top += fit[n] * k; });
    });
  });
  const span = (geo, v0, v1) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + (v1 - v0) * uv.getY(i)); return geo; };
  // a board readable from both sides, its middle at height y
  const board = (i, w, h, y) => [0, Math.PI].map((ry) => span(new THREE.PlaneGeometry(w, h).translate(0, 0, 0.05).rotateY(ry).translate(0, y, 0), 1 - (i + 1) * TILE / SHEET, 1 - i * TILE / SHEET));
  const stick = (len) => span(new THREE.BoxGeometry(0.1, len, 0.1).translate(0, len / 2, 0), 0, 4 / SHEET);
  return { mat: ps1ify(new THREE.MeshLambertMaterial({ map: tex })), board, placard: (i) => mergeGeometries([stick(2.4), ...board(i, i === 3 ? 2.6 : 2, 1.4, 2.9)]) };
}

// Paint a round shape in alternating wedges (the cart's umbrella).
function wedges(geo, n, a, b) {
  const p = geo.attributes.position, c = geo.attributes.color, col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const k = Math.floor((Math.atan2(p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2), p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / TAU + 1) * n) % 2;
    col.set(k ? a : b);
    for (let v = i; v < i + 3; v++) c.setXYZ(v, col.r, col.g, col.b);
  }
  return geo;
}

export async function build(game) {
  const { scene, camera, bus } = game, eye = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const lanes = buildLanes(), laneW = lanes.reduce((s, l) => s + l.weight, 0), signs = signKit();
  // is somebody standing here in the picture? (a little generous, so nobody pops in at the edge of the screen)
  let tanX = 1, tanY = 0.6;
  const inView = (x, z) => {
    const vx = x - eye.x, vy = 1 - eye.y, vz = z - eye.z, depth = vx * F.x + vy * F.y + vz * F.z;
    return vx * vx + vy * vy + vz * vz < 100 || (depth > 0 && Math.abs(vx * R.x + vy * R.y + vz * R.z) < depth * tanX + 2.5 && Math.abs(vx * U.x + vy * U.y + vz * U.z) < depth * tanY + 3);
  };

  // ---- bodies: fetched one after another so they never crowd out the game's own loading
  let queue = Promise.resolve(), pending = 0, boot = true;
  const body = (name) => ({ name, kid: name.includes('Child'), p: null, asked: false, used: false });
  const fetchBody = (b) => { if (b.asked) return; b.asked = true; pending++; queue = queue.then(() => person(b.name)).then((p) => { b.p = p; pending--; }); };
  const actor = (b, ox, oz, face = 0) => ({ b, g: null, rank: 0, ox, oz, face, x: 0, z: 0, yaw: 0, dx: 0, dz: 0, tx: 0, tz: 0, safe: 0, pose: 'idle', poseT: rand() * 4, clip: '', rate: 0, adt: 0, kick: false, live: false, prop: null, lift: 0, bob: 0 });
  const unlive = (a) => { if (a.live) { scene.remove(a.b.p.root); a.live = false; } a.dx = a.dz = a.tx = a.tz = a.safe = 0; };

  // ---- the three standing scenes. A group's frame: x, z and yaw; each member stands ox metres to its right and oz ahead.
  const station = (kind, x, z, yaw, spots) => { const g = { kind, x, z, yaw, state: 'stand', on: false, actors: spots.map(([ox, oz, face], i) => actor(body(CAST[kind][i]), ox, oz, face)) }; for (const a of g.actors) { a.g = g; a.yaw = yaw + a.face; } return g; };
  // the protest stands on the lawn at the edge of the centre walk, between two of the tracks, facing the people coming up from First St with Hakeem's pile behind
  const LINE = [[0.2, 0.5, 0.1], [-2.9, 0.2, -0.15], [3.2, 0, 0.2], [-5.8, -0.6, 0.25], [1.6, -2, -0.1]];
  const protest = station('protest', 19.5, 51, -0.52, LINE.slice(0, CAST.protest.length));
  const crew = station('crew', -12.5, 62, 0.605, [[0, 0, 0], [0, 7.4, Math.PI]]);   // the reporter looks at the lens; Chuck's pile is over her shoulder
  const vendor = station('vendor', -12.6, 101, Math.PI / 2, [[0, -1.3, 0]]);
  const stations = [protest, crew, vendor];
  for (const g of stations) for (const a of g.actors) fetchBody(a.b);
  protest.actors.forEach((a, i) => { a.prop = new THREE.Mesh(signs.placard(i), signs.mat); a.prop.position.set(i % 2 ? 0.34 : -0.34, 0, 0.3); a.lift = [0.15, 0.7, 0.35, 0.1, 0.9][i]; });

  // ---- things that stand still: the cart, the camera on its tripod and its light, the planted signs
  {
    const frame = (g, list) => list.flat().map((geo) => K.place(geo, { x: g.x, z: g.z, ry: g.yaw }));
    const leg = (a, h, splay, color, o) => K.place(K.place(K.tint(new THREE.BoxGeometry(0.07, h, 0.07).translate(0, -h / 2, 0), color), { rx: splay, ry: a, y: h * Math.cos(splay) }), o);
    const tripod = (h, o) => [0, 1, 2].map((i) => leg(i * TAU / 3 + 0.5, h, 0.3, 0x2c2c30, o));
    const cart = [K.box(2.3, 0.72, 1.1, 0xc9ccd2, { y: 0.3 }, 0.3), K.box(2.36, 0.3, 1.16, 0xd8402f, { y: 0.4 }), K.box(2.4, 0.07, 1.2, 0xe9ebee, { y: 1.02 }),
      K.cyl(0.34, 0.34, 0.14, 8, 0x26262a, { x: -0.8, y: 0.34, z: 0.52, rx: Math.PI / 2 }), K.cyl(0.34, 0.34, 0.14, 8, 0x26262a, { x: 0.8, y: 0.34, z: 0.52, rx: Math.PI / 2 }),
      K.box(0.5, 0.22, 0.4, 0xe8b020, { x: -0.75, y: 1.09, z: 0.1 }), K.box(0.26, 0.3, 0.26, 0xd8402f, { x: 0.85, y: 1.09, z: 0.2 }), K.box(0.7, 0.5, 0.5, 0x2f6fd0, { x: 1.9, z: -0.9 }, 0.2),
      K.cyl(0.05, 0.05, 3, 4, 0x8a8d92, { x: 1.25, z: -0.75 }), K.place(wedges(K.cone(2.3, 0.8, 8, 0xffffff), 8, 0xd8402f, 0xf7e7a6), { x: 0.4, y: 2.85, z: -0.75 })];
    const camAt = { z: 6.3 }, lightAt = { x: -1.9, z: 5.6 };   // the camera points back down -Z at the reporter
    const tv = [tripod(1.5, camAt), K.box(0.42, 0.42, 0.9, 0x3b3f48, { y: 1.42, z: 6.2 }), K.box(0.3, 0.3, 0.36, 0x121214, { y: 1.48, z: 5.6 }), K.box(0.14, 0.2, 0.4, 0x6a6e76, { y: 1.84, z: 6.3 }),
      K.box(0.12, 0.12, 0.12, 0xff2a1a, { y: 1.86, z: 5.85 }), tripod(1.2, lightAt), K.cyl(0.04, 0.04, 1.4, 4, 0x2c2c30, { ...lightAt, y: 1.1 }), K.box(0.9, 0.6, 0.12, 0xfff3c4, { ...lightAt, y: 2.3, ry: 0.3 }),
      K.box(0.5, 0.36, 0.7, 0x3a3d44, { x: 1.2, z: 6.9 }, 0.2)];
    scene.add(K.mesh([frame(vendor, cart), frame(crew, tv)]));
    const planted = [[1.2, -4.2, 0.25, 5], [-4.6, -2.6, -0.3, 6], ...LINE.slice(CAST.protest.length).map(([ox, oz, ry], k) => [ox, oz, ry, CAST.protest.length + k])].map(([ox, oz, ry, i]) => signs.placard(i).rotateY(ry).translate(-ox, -0.5, oz).rotateY(protest.yaw).translate(protest.x, 0, protest.z));
    const fixed = new THREE.Mesh(mergeGeometries([...planted, ...signs.board(7, 1.9, 0.6, 0.66).map((g) => g.translate(0, 0, 0.56).rotateY(vendor.yaw).translate(vendor.x, 0, vendor.z))]), signs.mat);
    fixed.matrixAutoUpdate = false; scene.add(fixed);
  }
  const flag = K.mesh([K.cyl(0.03, 0.03, 2.8, 4, 0xe6e6e0), K.card(0.62, 0.42, 0xff6a1a, { x: 0.33, y: 2.36 })], K.paintBoth);   // the school guide's
  flag.position.set(-0.32, 0, 0.28); flag.updateMatrix();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(8, 8, (g) => { g.fillStyle = '#fff'; g.fillRect(3, 0, 2, 8); g.fillRect(0, 3, 8, 2); g.fillRect(2, 2, 4, 4); }), alphaTest: 0.5, transparent: false, fog: false }));
  flash.scale.set(0.7, 0.7, 1); flash.visible = false; scene.add(flash);
  let flashT = 0;

  // ---- walkers: companies of one to four, re-used around the camera
  const pool = CAST.roam.map(body), roam = [];
  for (const b of pool) fetchBody(b);
  const KIDS = [[-0.45, -1.3], [0.45, -2], [-0.35, -2.8]];
  let dogOwner = null, cheerAt = 0, digX = 0, digZ = 0, digT = -99;
  const cheer = (x, z) => { if (game.time < cheerAt) return; cheerAt = game.time + 4; bus.emit('cheer', { x, y: game.surface(x, z), z }); };
  // Everyone in a company stops, turns to look at (fx, fz) and cheers; on a photo stop the first one holds still and the flash goes off.
  const halt = (g, secs, fx, fz, photo) => { g.state = 'stop'; g.t = secs; g.fx = fx; g.fz = fz; g.rest = 20 + rand() * 30; g.flash = photo ? 1 + rand() : 0; g.actors.forEach((a, i) => { a.pose = photo && (i === 0 || rand() < 0.4) ? 'idle' : 'cheer'; }); };
  function drop(i) {
    const g = roam[i];
    for (const a of g.actors) { unlive(a); a.b.used = false; }
    if (g.kind === 'school') flag.removeFromParent();
    if (g === dogOwner) dogOwner = null;
    roam.splice(i, 1);
  }
  // Start one company on a path near the camera: out of sight or far off, unless `warm` (the camera has just arrived). Returns how many people it used.
  function spawn(room, warm) {
    const adults = pool.filter((b) => b.p && !b.used && !b.kid), kids = pool.filter((b) => b.p && !b.used && b.kid);
    if (!adults.length) return 0;
    for (let tries = 0; tries < 30; tries++) {
      let r = rand() * laneW, L = lanes[0];
      for (const l of lanes) if ((r -= l.weight) < 0) { L = l; break; }
      const i = Math.floor(rand() * L.n), x = L.p[i * 2], z = L.p[i * 2 + 1], d = hyp(x - eye.x, z - eye.z);
      const seen = inView(x, z);   // in the picture they may only appear far off, as a few pixels; out of it, mostly close by
      if (d > 150 || d < (warm ? 12 : 40) || (warm ? d > 110 : seen ? d < 115 : d > 60 + rand() * 90) || roam.some((g) => hyp(g.x - x, g.z - z) < 12)) continue;
      if (!warm && !seen && (x - eye.x) * F.x + (z - eye.z) * F.z < 0 && rand() < 0.6) continue;   // more ahead of you than behind
      const pick = rand(), lead = adults.splice(Math.floor(rand() * adults.length), 1)[0];
      const kind = kids.length > 1 && room > 2 && !roam.some((g) => g.kind === 'school') && rand() < 0.7 ? 'school' : kids.length && room > 1 && rand() < 0.4 ? 'family'
        : pick < 0.2 && !dogOwner ? 'dog' : pick < 0.42 && lead.name.includes('Adult') ? 'jog' : pick < 0.75 && adults.length && room > 1 ? 'pair' : 'solo';
      const actors = kind === 'school' ? [actor(lead, 0, 0), ...kids.slice(0, Math.min(3, room - 1)).map((b, k) => actor(b, KIDS[k][0], KIDS[k][1]))]
        : kind === 'family' ? [actor(lead, 0.35, 0), actor(kids[0], -0.4, -0.15)] : kind === 'pair' ? [actor(lead, -0.45, 0), actor(adults.find((b) => b.name !== lead.name) || adults[0], 0.45, 0)] : [actor(lead, 0, 0)];
      // mostly walk toward the camera, so new arrivals come into the picture instead of leaving it
      const j = Math.min(L.n - 2, i), toward = (L.p[j * 2 + 2] - L.p[j * 2]) * (eye.x - x) + (L.p[j * 2 + 3] - L.p[j * 2 + 1]) * (eye.z - z) > 0;
      const g = { kind, actors, lane: L, i, dir: toward === rand() < 0.75 ? 1 : -1, k: 0.55 + rand() * 0.45, v: kind === 'jog' ? 3.2 + rand() * 0.7 : kind === 'school' ? 1.1 : 1.2 + rand() * 0.4,
        x, z, yaw: 0, state: 'go', t: 0, fx: 0, fz: 0, flash: 0, rest: 4 + rand() * 20, hop: 0, tries: 0, lost: 0, seen: false, d };
      g.x += L.nx[i] * g.dir * g.k * L.half; g.z += L.nz[i] * g.dir * g.k * L.half; g.yaw = Math.atan2(L.nz[i] * g.dir, -L.nx[i] * g.dir);
      for (const a of actors) { a.b.used = true; a.yaw = g.yaw; a.g = g; }
      if (kind === 'school') lead.p.root.add(flag);
      if (kind === 'dog') dogOwner = g;
      roam.push(g);
      return actors.length;
    }
    return 0;
  }
  // Is a car coming past this spot? (parked ones and bicycles do not count)
  const cars = (x, z) => { const all = game.sceneryMods.traffic?.vehicles; if (all) for (let i = 0; i < all.length; i++) { const v = all[i]; if (v.active && !v.bike && v.speed > 1.5 && Math.abs(v.x - x) < 15 && Math.abs(v.z - z) < 15) return true; } return false; };
  // Reached the point it was heading for: take a turn-off, turn back at a dead end, or carry on; wait at a kerb; maybe stop for a photo.
  function arrive(g) {
    const L = g.lane, links = L.link[g.i], end = g.i + g.dir < 0 || g.i + g.dir >= L.n, kerb = !L.road[g.i];
    let turned = false;
    if (g.hop > 0) g.hop--;
    else if (links && rand() < (end ? 0.85 : 0.3)) {
      const to = links[Math.floor(rand() * links.length)];
      g.lane = to.lane; g.i = to.j; g.hop = 3; turned = true;
      g.dir = to.j === 0 ? 1 : to.j === to.lane.n - 1 ? -1 : rand() < 0.5 ? 1 : -1;
    }
    if (!turned) { if (end) g.dir = -g.dir; g.i += g.dir; }
    const N = g.lane;
    if (kerb && N.road[g.i] && cars(N.p[g.i * 2], N.p[g.i * 2 + 1])) { g.state = 'kerb'; g.t = 0.5; g.tries = 16; }   // about to step off the kerb: wait for a gap
    else if (!turned && g.kind !== 'jog' && g.rest <= 0 && N.view[g.i] && rand() < 0.12) {
      let n = CFG.giants[0];
      for (const o of CFG.giants) if (hyp(o.x - g.x, o.z - g.z) < hyp(n.x - g.x, n.z - g.z)) n = o;
      halt(g, 4.5 + rand() * 3, n.x, n.z, true);
    }
  }
  function walk(g, dt) {
    if (g.state === 'go') {
      const L = g.lane, lat = g.dir * g.k * L.half, ddx = L.p[g.i * 2] + L.nx[g.i] * lat - g.x, ddz = L.p[g.i * 2 + 1] + L.nz[g.i] * lat - g.z, d = hyp(ddx, ddz), s = g.v * dt;
      if (d <= s) arrive(g);
      else { g.x += ddx / d * s; g.z += ddz / d * s; g.yaw += Math.max(-3 * dt, Math.min(3 * dt, turn(Math.atan2(ddx, ddz), g.yaw))); }
    } else if (g.state === 'stop') {
      if (g.flash > 0 && (g.flash -= dt) <= 0) { const a = g.actors[0]; flash.position.set(a.x + Math.sin(a.yaw) * 0.4, game.surface(a.x, a.z) + 1.55, a.z + Math.cos(a.yaw) * 0.4); flash.visible = true; flashT = 0.12; }
      if ((g.t -= dt) <= 0) { g.state = 'go'; for (const a of g.actors) a.pose = 'idle'; }
    } else if ((g.t -= dt) <= 0) {   // at the kerb: look again, and after eight seconds go anyway
      if (--g.tries <= 0 || !cars(g.lane.p[g.i * 2], g.lane.p[g.i * 2 + 1])) g.state = 'go'; else g.t = 0.5;
    }
  }

  // ---- one person, one frame: where they stand, which clip, and (every other frame, close up) the animation itself
  function pose(g, a, dt, myTurn) {
    const p = a.b.p;
    if (!p) return;
    const c = Math.cos(g.yaw), s = Math.sin(g.yaw), ex = a.tx - a.dx, ez = a.tz - a.dz, e = hyp(ex, ez);
    let yaw = g.state === 'stop' ? Math.atan2(g.fx - a.x, g.fz - a.z) : g.yaw + a.face, v = g.state === 'go' ? g.v : 0;
    if (e > 0.05) { v = a.safe > 0 ? 5.5 : 1.5; const m = Math.min(e, v * dt); a.dx += ex / e * m; a.dz += ez / e * m; yaw = Math.atan2(ex, ez); }   // getting out of a machine's way, or strolling back
    a.x = g.x - c * a.ox + s * a.oz + a.dx; a.z = g.z + s * a.ox + c * a.oz + a.dz;
    a.yaw += Math.max(-9 * dt, Math.min(9 * dt, turn(yaw, a.yaw)));
    const d = hyp(a.x - eye.x, 1 - eye.y, a.z - eye.z), show = d < FAR && drawn < MAXP && inView(a.x, a.z);
    if (show !== a.live) {   // a body out of the picture is out of the scene: it costs nothing at all
      if (show) { scene.add(p.root); if (a.prop && !a.prop.parent) p.root.add(a.prop); a.kick = true; } else scene.remove(p.root);
      a.live = show;
    }
    if (!show) return;
    drawn++;
    p.root.position.set(a.x, game.surface(a.x, a.z), a.z); p.root.rotation.y = a.yaw;
    if (g.state !== 'stop' && (a.poseT -= dt) <= 0) {   // protesters take turns; anyone else who was cheering settles down
      a.pose = g.kind === 'protest' && a.pose === 'idle' ? 'cheer' : 'idle';
      a.poseT = a.pose === 'cheer' ? 2 + rand() * 3.5 : (game.time - digT < 3 ? 0.4 : 1.5) + rand() * 3;
    }
    const clip = v > 2.6 ? 'run' : v > 0.2 ? 'walk' : a.pose, rate = clip === 'run' ? v / 3.4 : clip === 'walk' ? v / (a.b.kid ? 1.15 : 1.4) : 1;
    if (clip !== a.clip || rate !== a.rate) {
      a.clip = clip; a.rate = rate; a.kick = true; a.adt = 0.3;   // one catch-up step even when far away, so nobody slides about in the wrong pose
      const act = p.play(clip, { speed: rate });
      if (act && clip === 'cheer') act.time = rand() * act.getClip().duration;
    }
    a.adt += dt;
    if (a.kick || (myTurn && d < NEAR)) { p.mixer.update(a.adt); a.adt = 0; a.kick = false; } else if (d >= NEAR) a.adt = 0;
    if (a.prop) {   // the placard pumps up and down with the cheering
      a.bob += ((a.clip === 'cheer' ? 1 : 0) - a.bob) * Math.min(1, dt * 5);
      const w = game.time * 7 + a.ox * 2;
      a.prop.position.y = a.lift + Math.abs(Math.sin(w)) * 0.25 * a.bob; a.prop.rotation.z = Math.sin(w) * 0.1 * a.bob;
    }
  }

  // ---- machines bearing down on people (yours, and other players')
  const veh = Array.from({ length: 6 }, () => ({ x: 0, z: 0, ux: 0, uz: 0, v: 0, r: 0 }));
  let nVeh = 0;
  const machine = (x, z, ux, uz, v, r) => { if (nVeh < veh.length) { const m = veh[nVeh++]; m.x = x; m.z = z; m.ux = ux; m.uz = uz; m.v = v; m.r = r; } };
  function dodge(a) {
    if (a.safe > 0 && (a.safe -= TICK) <= 0) a.tx = a.tz = 0;
    for (let i = 0; i < nVeh; i++) {
      const m = veh[i], rx = a.x - m.x, rz = a.z - m.z, along = rx * m.ux + rz * m.uz, clear = 3 + m.r * 0.5, side = rx * m.uz - rz * m.ux;
      if (along < -3 || along > 7 + m.v * 1.6 || Math.abs(side) > clear) continue;
      let step = (side < 0 ? -clear : clear) - side;   // sideways, off its line, by the shorter way unless that is the pool or a pile
      if (inPool(a.x + m.uz * step, a.z - m.ux * step, 1) || game.surface(a.x + m.uz * step, a.z - m.ux * step) > 0.6) step = (side < 0 ? clear : -clear) - side;
      a.tx = a.dx + m.uz * step; a.tz = a.dz - m.ux * step; a.safe = 1.5;
    }
  }

  // ---- animals: five draw calls
  const NP = TOUCH ? 14 : 22, NS = 5, ND = 7, GROUND = 0.08, WATER = 0.3, FLY = 9;
  const HOMES = [[-5, 84], [-4, 52], [-6, 97], [-1, 64]];   // patches of the centre walk the walkers leave alone
  const rnd = rng(60), grey = [0xffffff, 0xdfe3ea, 0xc4c9d2, 0xf6ecd8, 0xa9afb9];
  const birds = K.instances([K.ball(0.1, 0xaab2be, { y: 0.05, sz: 1.5, sx: 0.9, rx: -0.25 }), K.box(0.08, 0.1, 0.09, 0x66728a, { y: 0.2, z: 0.11 }), K.box(0.1, 0.03, 0.14, 0x565c66, { y: 0.1, z: -0.2 })],
    Array.from({ length: NP }, (_, i) => ({ color: grey[i % grey.length] })));
  const wingGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.14, 0.62, 0.3, -0.02, 0, 0, -0.16, 0, 0, -0.16, -0.62, 0.3, -0.02, 0, 0, 0.14], 3));
  const wings = K.instances([K.tint(wingGeo, 0xc3c8d0)], Array.from({ length: NP }, () => ({ s: 0 })), K.paintBoth);
  const squirrels = K.instances([K.box(0.15, 0.15, 0.32, 0x9a6a3c, { y: 0.03 }), K.box(0.12, 0.11, 0.13, 0xa87646, { y: 0.14, z: 0.2 }), K.box(0.11, 0.34, 0.11, 0xb98850, { y: 0.1, z: -0.22, rx: -0.45 })], Array.from({ length: NS }, () => ({})));
  const ducks = K.instances([K.box(0.26, 0.17, 0.44, 0x8a6f52, { y: -0.05 }), K.box(0.13, 0.09, 0.12, 0xe9e4d6, { y: 0.09, z: -0.25 }), K.box(0.1, 0.22, 0.1, 0x1f6b3a, { y: 0.1, z: 0.18 }), K.box(0.07, 0.04, 0.11, 0xe8b020, { y: 0.21, z: 0.27 })],
    Array.from({ length: ND }, (_, i) => ({ color: i % 3 === 2 ? 0xb89a78 : 0xffffff })));
  const dog = K.instances([K.box(0.24, 0.26, 0.62, 0xb8864a, { y: 0.26 }), K.box(0.2, 0.2, 0.24, 0xb8864a, { y: 0.44, z: 0.4 }), K.box(0.1, 0.09, 0.14, 0x6a4a2a, { y: 0.46, z: 0.56 }), K.box(0.05, 0.22, 0.05, 0xb8864a, { y: 0.45, z: -0.33, rx: -0.5 }),
    ...[[-0.08, 0.22], [0.08, 0.22], [-0.08, -0.22], [0.08, -0.22]].map(([x, z]) => K.box(0.07, 0.28, 0.07, 0x9a6f3c, { x, z })),
    K.box(0.03, 0.03, 1.64, 0xc0392b, { x: 0.25, y: 0.72, z: -0.45, ry: 2.82, rx: -0.278 })], [{ s: 0 }]);   // the lead runs back up to the walker's hand
  birds.boundingSphere.set(V.set(3, 6, 75), 60); wings.boundingSphere.set(V, 60);
  squirrels.boundingSphere.set(V.set(0, 1, 100), 210); ducks.boundingSphere.set(V.set(POOL.x, WATER, POOL.z), 45); dog.boundingSphere.radius = 2.5;
  scene.add(birds, wings, squirrels, ducks, dog);

  const col = (n) => new Float32Array(n);
  const pg = { x: col(NP), z: col(NP), yaw: col(NP), dip: col(NP), t: col(NP), x1: col(NP), z1: col(NP), px: col(NP), pz: col(NP), late: col(NP), a: col(NP), h: col(NP) };
  let home = HOMES[0], next = home, fly = -1, spin = 1, peckT = 0;
  const settle = (x, z, at) => { for (let i = 0; i < NP; i++) { const a = rand() * TAU, r = Math.sqrt(rand()) * 5; x[i] = at[0] + Math.cos(a) * r; z[i] = at[1] + Math.sin(a) * r; } };
  settle(pg.x, pg.z, home);
  for (let i = 0; i < NP; i++) { pg.yaw[i] = rand() * TAU; pg.t[i] = rand() * 2; put(birds, i, pg.x[i], GROUND, pg.z[i], pg.yaw[i], 0, 1.15); }
  function scatter() {
    const pl = game.player.pos, far = HOMES.filter((h) => h !== home && hyp(h[0] - pl.x, h[1] - pl.z) > 20);
    next = far[Math.floor(rand() * far.length)] || home; fly = 0; spin = rand() < 0.5 ? 1 : -1;
    settle(pg.x1, pg.z1, next);
    for (let i = 0; i < NP; i++) { pg.px[i] = pg.x[i]; pg.pz[i] = pg.z[i]; pg.late[i] = rand() * 0.45; pg.a[i] = rand() * TAU; pg.h[i] = rand(); }
    bus.emit('pigeons', { x: home[0], y: 0, z: home[1] });
  }
  // Up in a burst, round in a loose wheel while the whole flock drifts to its next patch, down again.
  function flock(dt) {
    fly = Math.min(FLY, fly + dt);
    const u = fly / FLY, k = smooth(u), cx = home[0] + (next[0] - home[0]) * k, cz = home[1] + (next[1] - home[1]) * k, arc = Math.max(0, Math.sin(Math.PI * u)) ** 0.7, land = smooth((fly - FLY + 2.2) / 2.2);
    for (let i = 0; i < NP; i++) {
      const t = fly - pg.late[i];
      if (t <= 0) continue;
      const a = pg.a[i] + fly * (1 + pg.h[i] * 0.5) * spin, r = 4 + pg.h[i] * 6, up = smooth(t / 1.3);
      let x = pg.x[i] + (cx + Math.cos(a) * r - pg.x[i]) * up, z = pg.z[i] + (cz + Math.sin(a) * r - pg.z[i]) * up;
      x += (pg.x1[i] - x) * land; z += (pg.z1[i] - z) * land;
      const y = GROUND + (5 + pg.h[i] * 7) * arc * Math.min(1, t) + Math.sin(fly * 3 + i) * 0.5 * up * (1 - land), yaw = Math.atan2(x - pg.px[i], z - pg.pz[i]), air = u < 1 ? 1.3 : 0;
      pg.px[i] = x; pg.pz[i] = z;
      put(birds, i, x, y, z, yaw, air ? -0.15 : 0, 1.15);
      put(wings, i, x, y + 0.2, z, yaw, 0, air, air * Math.sin(fly * 26 + i * 2), air);
    }
    if (u >= 1) { fly = -1; home = next; for (let i = 0; i < NP; i++) { pg.x[i] = pg.x1[i]; pg.z[i] = pg.z1[i]; pg.yaw[i] = rand() * TAU; pg.dip[i] = 0; } }
  }
  // On the ground: ten times a second, a bird pecks, or turns and takes a couple of steps.
  function peck() {
    for (let i = 0; i < NP; i++) {
      if ((pg.t[i] -= 0.1) > 0) continue;
      if (pg.dip[i]) { pg.dip[i] = 0; pg.t[i] = 0.3 + rand() * 1.5; }
      else if (rand() < 0.6) { pg.dip[i] = 0.6; pg.t[i] = 0.2; }
      else {
        pg.yaw[i] += (rand() - 0.5) * 2.4; pg.t[i] = 0.2 + rand();
        const x = pg.x[i] + Math.sin(pg.yaw[i]) * 0.35, z = pg.z[i] + Math.cos(pg.yaw[i]) * 0.35;
        if (hyp(x - home[0], z - home[1]) < 6) { pg.x[i] = x; pg.z[i] = z; } else pg.yaw[i] += Math.PI;
      }
      put(birds, i, pg.x[i], GROUND, pg.z[i], pg.yaw[i], pg.dip[i], 1.15);
    }
  }

  // squirrels: each has a few favourite spots on the grass and dashes between them
  const sq = { x: col(NS), z: col(NS), tx: col(NS), tz: col(NS), yaw: col(NS), wait: col(NS), run: col(NS), spots: [] };
  [[-34, 84], [38, 74], [-92, 66], [96, 90], [-74, 150]].forEach(([bx, bz], i) => {
    const spots = [];
    for (let tries = 0; spots.length < 4 && tries < 200; tries++) { const a = rnd() * TAU, r = rnd() * (spots.length ? 28 : 10), x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r; if (!blocked(x, z, 1.5)) spots.push([x, z]); }
    if (!spots.length) spots.push([bx, bz]);
    sq.spots.push(spots); sq.x[i] = spots[0][0]; sq.z[i] = spots[0][1]; sq.wait[i] = 1 + rnd() * 6; sq.yaw[i] = rnd() * TAU;
    put(squirrels, i, sq.x[i], GROUND, sq.z[i], sq.yaw[i], -0.5, 1.4);
  });
  function scurry(dt) {
    for (let i = 0; i < NS; i++) {
      if (!sq.run[i]) {
        if ((sq.wait[i] -= dt) > 0) continue;
        const to = sq.spots[i][Math.floor(rand() * sq.spots[i].length)];
        sq.tx[i] = to[0]; sq.tz[i] = to[1]; sq.run[i] = 0.01; sq.yaw[i] = Math.atan2(to[0] - sq.x[i], to[1] - sq.z[i]);
      }
      const dx = sq.tx[i] - sq.x[i], dz = sq.tz[i] - sq.z[i], d = hyp(dx, dz), s = 7 * dt;
      if (d <= s) { sq.x[i] = sq.tx[i]; sq.z[i] = sq.tz[i]; sq.run[i] = 0; sq.wait[i] = 2 + rand() * 9; put(squirrels, i, sq.x[i], GROUND, sq.z[i], sq.yaw[i] + 2, -0.5, 1.4); continue; }   // sits up and looks about
      sq.x[i] += dx / d * s; sq.z[i] += dz / d * s; sq.run[i] += dt * 13;
      put(squirrels, i, sq.x[i], GROUND + Math.abs(Math.sin(sq.run[i])) * 0.28, sq.z[i], sq.yaw[i], Math.cos(sq.run[i] * 2) * 0.25, 1.4);
    }
  }

  // ducks: drifting about the open water west of the Grant Memorial
  const dk = { x: col(ND), z: col(ND), yaw: col(ND), w: col(ND) };
  for (let i = 0; i < ND; i++) { dk.x[i] = POOL.x + (rnd() - 0.5) * (POOL.halfX * 2 - 14); dk.z[i] = POOL.z - 8 + rnd() * (POOL.halfZ + 2); dk.yaw[i] = rnd() * TAU; }
  function paddle(dt) {
    for (let i = 0; i < ND; i++) {
      const out = Math.abs(dk.x[i] - POOL.x) > POOL.halfX - 5 || dk.z[i] < POOL.z - 11 || dk.z[i] > POOL.z + POOL.halfZ - 4;
      if (out) dk.w[i] = Math.sign(turn(Math.atan2(POOL.x - dk.x[i], POOL.z + 6 - dk.z[i]), dk.yaw[i])) * 0.7;
      else dk.w[i] = Math.max(-0.35, Math.min(0.35, dk.w[i] + (rand() - 0.5) * dt * 1.2));
      dk.yaw[i] += dk.w[i] * dt; dk.x[i] += Math.sin(dk.yaw[i]) * 0.32 * dt; dk.z[i] += Math.cos(dk.yaw[i]) * 0.32 * dt;
      put(ducks, i, dk.x[i], WATER + Math.sin(game.time * 1.7 + i * 2) * 0.02, dk.z[i], dk.yaw[i], Math.sin(game.time * 1.1 + i) * 0.05, 2);
    }
  }

  // ---- the game talks: digging draws cheers; a milestone, a flattened mound or a new tool sets everyone off
  const party = () => {
    const pl = game.player.pos;
    for (const g of [protest, vendor]) for (const a of g.actors) { a.pose = 'cheer'; a.poseT = 4 + rand() * 2; }
    for (const g of roam) if (g.state === 'go' && g.kind !== 'jog' && hyp(g.x - pl.x, g.z - pl.z) < 90) halt(g, 3.5 + rand() * 2, pl.x, pl.z, false);
    cheerAt = 0; cheer(pl.x, pl.z);
  };
  bus.on('dig', (e) => { digX = e.x; digZ = e.z; digT = game.time; });
  bus.on('milestone', party);
  bus.on('moundDown', (e) => { if (!e.quiet) party(); });
  bus.on('toolUp', (e) => { if (!e.quiet) party(); });

  // ---- a few times a second: who is on stage, who has wandered off, who needs to jump out of the way
  const cast = [], byRank = (a, b) => a.rank - b.rank;   // everyone on stage, nearest first
  let lastX = Infinity, lastZ = 0, warmT = 0, tickT = TICK, frame = 0, drawn = 0;
  function slow() {
    const pl = game.player;
    if (hyp(eye.x - lastX, eye.z - lastZ) > 60) warmT = 2;   // the camera jumped (a cut, a respawn): people the new place at once, in plain view if need be
    if (boot) { warmT = 1; boot = pending > 0; }   // and once more when the first bodies have arrived
    lastX = eye.x; lastZ = eye.z; warmT -= TICK;
    let n = 0;
    cast.length = 0;
    for (const g of stations) {
      const d = hyp(g.x - eye.x, g.z - eye.z), on = d < (g.on ? FAR : FAR - 15);
      if (g.on && !on) g.actors.forEach(unlive);
      g.on = on;
      if (on) for (const a of g.actors) { a.rank = d - 25; cast.push(a); }   // a standing scene is drawn whole before walkers at the same distance
    }
    for (let i = roam.length - 1; i >= 0; i--) {
      const g = roam[i];
      // unseen for a while and far off, or left well behind: gone, to start again somewhere more useful
      g.d = hyp(g.x - eye.x, g.z - eye.z); g.seen = g.d < FAR && inView(g.x, g.z); g.rest -= TICK;
      g.lost = g.seen || g.d < ((g.x - eye.x) * F.x + (g.z - eye.z) * F.z > 0 ? 90 : 45) ? 0 : g.lost + TICK;
      if (g.d > FAR || g.lost > 8) drop(i); else n += g.actors.length;
    }
    for (let k = warmT > 0 ? 8 : 1; k > 0 && n < pool.length; k--) n += spawn(pool.length - n, warmT > 0);
    for (const g of roam) for (const a of g.actors) { a.rank = g.d; cast.push(a); }
    cast.sort(byRank);

    nVeh = 0;
    if (pl.inVehicle && pl.dead <= 0) { const v = hyp(pl.vel.x, pl.vel.z); if (v > 1.5) machine(pl.pos.x, pl.pos.z, pl.vel.x / v, pl.vel.z / v, v, pl.toolCfg.r); }
    for (const r of game.net.remotes.values()) if (r.avatar && r.avatar.vehicle && (r.flags & 1)) machine(r.pos.x, r.pos.z, Math.sin(r.yaw), Math.cos(r.yaw), CFG.tools[r.tier].speed, CFG.tools[r.tier].r);
    for (const g of roam) for (const a of g.actors) dodge(a);
    for (const g of stations) if (g.on) for (const a of g.actors) dodge(a);

    if (game.time - digT < 1.5) for (const g of roam) if (g.state === 'go' && g.kind !== 'jog' && g.rest <= 0 && hyp(g.x - digX, g.z - digZ) < 60 && rand() < 0.2) { halt(g, 3 + rand() * 2.5, digX, digZ, false); cheer(g.x, g.z); }

    if (fly < 0) {   // pigeons: anyone hurrying through the flock puts it up
      let rush = pl.dead <= 0 && hyp(pl.pos.x - home[0], pl.pos.z - home[1]) < 8 && hyp(pl.vel.x, pl.vel.z) > 2.5;
      if (!rush) for (const r of game.net.remotes.values()) if ((r.flags & 1) && hyp(r.pos.x - home[0], r.pos.z - home[1]) < 8) { rush = true; break; }
      if (rush) scatter();
    }
  }

  function update(dt) {
    const c = game.cam;
    if (c) { eye.set(c.pos[0], c.pos[1], c.pos[2]); F.set(c.look[0], c.look[1], c.look[2]).sub(eye).normalize(); } else { eye.copy(camera.position); camera.getWorldDirection(F); }
    R.crossVectors(F, UP).normalize(); U.crossVectors(R, F);
    tanY = Math.tan(((c && c.fov) || camera.fov) * Math.PI / 360) * (camera.view && camera.view.enabled ? 1.7 : 1.12); tanX = tanY * camera.aspect;   // wider while the picture is slid aside for a panel
    if ((tickT += dt) >= TICK) { tickT = 0; slow(); }
    for (const g of roam) walk(g, dt);
    drawn = 0; frame++;
    for (let i = 0; i < cast.length; i++) pose(cast[i].g, cast[i], dt, (frame + i) & 1);
    if (flash.visible && (flashT -= dt) <= 0) flash.visible = false;

    if (fly >= 0) flock(dt); else if ((peckT += dt) > 0.1 && hyp(home[0] - eye.x, home[1] - eye.z) < 90) { peckT = 0; peck(); }
    scurry(dt);
    if (frame & 1 && hyp(POOL.x - eye.x, POOL.z - eye.z) < 150) paddle(dt * 2);
    const w = dogOwner && dogOwner.actors[0];
    if (w && w.live) {
      const s = Math.sin(w.yaw), co = Math.cos(w.yaw), x = w.x - co * 0.75 + s * 1.2, z = w.z + s * 0.75 + co * 1.2, trot = w.clip === 'idle' ? 0 : Math.abs(Math.sin(game.time * 11)) * 0.06;
      put(dog, 0, x, game.surface(x, z) + trot, z, w.yaw, 0, 1.15); dog.boundingSphere.center.set(x, 0.5, z); dog.visible = true;
    } else dog.visible = false;
  }
  return { update };
}
