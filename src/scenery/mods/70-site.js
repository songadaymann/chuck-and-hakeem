import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from '../../config.js';
import { model } from '../../assets.js';
import { ps1ify, canvasTex, snap, FONT } from '../../ps1.js';
import { ROADS, CIRCLES, lineDist, nearMound } from '../plan.js';
import * as K from '../kit.js';

// The things standing around: the two dig sites' fences, cones, trailers and signs, the volunteers' corner by the
// spawn, and the street furniture (lamps, signals, name signs, a bus shelter, bikes, parked TV and food trucks).
// Draw calls: seven merged painted chunks, one mesh for everything that carries the sign atlas (signs and the orange
// mesh fence), one for the flags (they wave in the vertex shader), one of unlit lamp glass, one of traffic lights and
// one of Christmas lights (each swapped between a few prebuilt meshes), and two parked machines baked from the tool models.
const ORANGE = 0xf2701c, WHITE = 0xf1eee4, STEEL = 0x9aa0a6, DARK = 0x2c3036, YEL = 0xf0bd22, BLUE = 0x2f6fd0, WOOD = 0xa9763f, DIRT = 0x6f5334,
  RED = 0xcc2a1e, IRON = 0x1f2d27, GLASS = 0x27323d, TYRE = 0x1d1d20, STONE = 0xcfc9ba, SIGNGREEN = 0x14532d;
const FAR = 450;                 // no street furniture farther than this from the dome: it would be a dot in the fog
// Traffic lights: streets running along x (First, Third, First NE) show green for GO seconds of every CYCLE, then
// amber, then the cross streets get their turn. Driven by game.time % CYCLE: the traffic module stops its cars by the
// same clock, so change the two together.
const CYCLE = 24, GO = 10, AMBER = 2;
const TRUCKS = [-26, -37.5, 27.5, 39];   // x of the two TV trucks and the two food trucks at First St's east kerb

// ---- the sign atlas ----------------------------------------------------------------------------------------------
// One 512 px canvas holds every sign, both flags and the strip of orange mesh fence. uv[name] = [u0, v0, u1, v1, w / h].
function atlas() {
  const SZ = 512, uv = {};
  let x = 0, y = 0, row = 0;
  const tex = canvasTex(SZ, SZ, (g) => {
    const fill = (c, a, b, w, h) => { g.fillStyle = c; g.fillRect(a, b, w, h); };
    const say = (t, cx, cy, size, c, maxW, font = FONT.px, wt = 'bold') => {
      g.fillStyle = c; g.textAlign = 'center'; g.textBaseline = 'middle';
      let s = size; do g.font = `${wt} ${s}px ${font}`; while (g.measureText(t).width > maxW && --s > 5);
      g.fillText(t, cx, cy + 1);
    };
    const tile = (name, w, h, draw) => {
      if (x + w > SZ) { x = 0; y += row + 1; row = 0; }
      uv[name] = [(x + 0.2) / SZ, 1 - (y + h - 0.2) / SZ, (x + w - 0.2) / SZ, 1 - (y + 0.2) / SZ, w / h];
      g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(w, h); g.restore();
      x += w + 1; row = Math.max(row, h);
    };
    // A framed plate of centred lines: [text, size, colour?].
    const lines = (list, w, h, fg, top = 0) => { let ty = top + (h - top - list.reduce((s, l) => s + l[1] + 3, 0)) / 2; for (const [t, s, c] of list) { say(t, w / 2, ty + (s + 3) / 2, s, c || fg, w - 10); ty += s + 3; } };
    const plate = (name, w, h, bg, fg, list, edge = fg) => tile(name, w, h, () => { fill(edge, 0, 0, w, h); fill(bg, 2, 2, w - 4, h - 4); lines(list, w, h, fg); });

    tile('fence', SZ, 16, (w, h) => { fill('#f2701c', 0, 0, w, h); for (let j = 3; j < h - 3; j += 3) for (let i = (j % 2) * 2; i < w; i += 4) g.clearRect(i, j, 2, 2); });
    tile('welcome', 160, 96, (w, h) => {
      fill('#d9b57a', 0, 0, w, h); for (let j = 5; j < h; j += 9) fill('#c9a368', 0, j, w, 1);
      fill('#7a5a34', 0, 0, w, 2); fill('#7a5a34', 0, h - 2, w, 2);
      say('WELCOME, DIGGERS', w / 2, 14, 17, '#3a2413', w - 12, FONT.big, '');
      fill('#3a2413', 8, 27, w - 16, 2); fill('#3a2413', w / 2 - 1, 34, 2, h - 42);
      const arrow = (c, cx, dir) => { g.fillStyle = c; g.beginPath(); g.moveTo(cx + dir * 30, 44); g.lineTo(cx + dir * 12, 33); g.lineTo(cx + dir * 12, 40); g.lineTo(cx - dir * 28, 40); g.lineTo(cx - dir * 28, 48); g.lineTo(cx + dir * 12, 48); g.lineTo(cx + dir * 12, 55); g.fill(); };
      arrow('#1f4fb0', 40, -1); say('CHUCK', 40, 68, 22, '#1f4fb0', 70, FONT.big, ''); say('SENATE SIDE', 40, 86, 8, '#3a2413', 72);
      arrow('#bf3020', 120, 1); say('HAKEEM', 120, 68, 22, '#bf3020', 70, FONT.big, ''); say('HOUSE SIDE', 120, 86, 8, '#3a2413', 72);
    });
    tile('project', 128, 80, (w, h) => {
      fill('#f4f1e6', 0, 0, w, h); fill('#1d3f8f', 0, 0, w, 16); say('PROJECT:', w / 2, 8, 12, '#fff', w - 10);
      lines([['NEW LEADERSHIP', 16, '#1d3f8f'], ['EST. COMPLETION:', 8], ['BEFORE THE VOTE', 12, '#c02a1c'], ['CONTRACTOR: YOU', 8]], w, h, '#222', 16);
    });
    plate('dig', 128, 64, '#f6c81f', '#141414', [['DIG SITE', 22], ['NO INCUMBENTS', 12], ['BEYOND THIS POINT', 9]]);
    tile('busad', 48, 64, (w, h) => { fill('#e8e2d2', 0, 0, w, h); fill('#c02a1c', 0, 0, w, 3); fill('#c02a1c', 0, h - 3, w, 3); lines([['THIS', 10], ['SPACE', 10], ['FOR SALE', 8, '#c02a1c'], ['ASK ANY', 8], ['SENATOR', 8]], w, h, '#222'); });
    tile('days', 128, 64, (w, h) => {
      fill('#f4f1e6', 0, 0, w, h); fill('#1f7a3d', 2, 2, w - 4, h - 4); fill('#f4f1e6', 8, 9, 38, 46);
      say('0', 27, 31, 40, '#141414', 34);
      for (const [i, t] of ['DAYS SINCE', 'LAST', 'TALKING', 'POINT'].entries()) say(t, 86, 12 + i * 13.5, 12, '#fff', 70);
    });
    tile('danger', 96, 64, (w, h) => { fill('#141414', 0, 0, w, h); fill('#f4f1e6', 2, 2, w - 4, h - 4); fill('#c8201a', 6, 6, w - 12, 22); say('DANGER', w / 2, 17, 18, '#fff', w - 20); lines([['ENTRENCHED', 12], ['INTERESTS', 12]], w, h - 2, '#141414', 28); });
    plate('feed', 96, 64, '#5b3a20', '#f3e6c4', [['PLEASE', 9], ['DO NOT FEED', 13], ['THE LOBBYISTS', 12]]);
    tile('hardhat', 64, 64, (w, h) => {
      fill('#f4f1e6', 0, 0, w, h); fill('#1b4fa8', 2, 2, w - 4, h - 4);
      g.fillStyle = '#f6c81f'; g.beginPath(); g.arc(w / 2, 26, 13, Math.PI, 0); g.fill(); fill('#f6c81f', w / 2 - 17, 25, 34, 4);
      say('HARD HATS', w / 2, 40, 9, '#fff', w - 8); say('& THICK SKIN', w / 2, 52, 8, '#fff', w - 8);
    });
    plate('xmas', 96, 56, '#17603a', '#f4f1e6', [['CAPITOL', 11], ['XMAS TREE', 14, '#ffd23c'], ['SOME ASSEMBLY', 9], ['REQUIRED', 9]], '#c02a1c');
    plate('smokes', 144, 40, '#f6c81f', '#b3221a', [['HALF-SMOKES', 20], ['CHILI - CHEESE - MUMBO', 8, '#3a2413']], '#b3221a');
    plate('tacos', 144, 40, '#15807a', '#fff', [['FILIBUSTER TACOS', 16], ['WE NEVER STOP TALKING', 8, '#ffe27a']], '#ffe27a');
    plate('tv1', 96, 32, '#f4f1e6', '#1d3f8f', [['C-SPIN', 16], ['LIVE. STILL LIVE.', 8, '#c02a1c']]);
    plate('tv2', 96, 32, '#16233f', '#fff', [['NEWS NOW', 14], ['BREAKING: STILL THERE', 8, '#ffd23c']], '#c02a1c');
    plate('office', 96, 32, '#f4f1e6', '#141414', [['SITE OFFICE', 13], ['NOW HIRING: SPINES', 8, '#c02a1c']]);
    plate('shovel', 96, 48, '#e3c489', '#3a2413', [['TAKE A', 14], ['SHOVEL', 18, '#b3221a']]);
    plate('check', 96, 32, '#f4f1e6', '#141414', [['CHECKPOINT', 13], ['SHOVELS OK', 9, '#1f7a3d']]);
    plate('water', 128, 32, '#f4f1e6', '#1b4fa8', [['FREE WATER', 15], ['FOR DIGGERS', 10]]);
    plate('skip', 64, 24, '#f6c81f', '#141414', [['OLD TALKING', 8], ['POINTS ONLY', 8]]);
    plate('cloak', 96, 20, '#1b4fa8', '#fff', [['CLOAKROOM', 12]], '#1b4fa8');
    plate('caucus', 96, 20, '#1b4fa8', '#fff', [['CAUCUS ROOM', 12]], '#1b4fa8');
    plate('bike', 32, 48, '#c8201a', '#fff', [['BIKE', 9], ['SHARE', 8]], '#c8201a');
    plate('bus', 24, 24, '#1b4fa8', '#fff', [['BUS', 9]], '#fff');
    [['DIG!', '', '#f6c81f', '#141414'], ["TIME'S", 'UP', '#f4f1e6', '#c02a1c'], ['RETIRE', 'ALREADY', '#1b4fa8', '#fff'], ['PASS THE', 'TORCH', '#f4f1e6', '#141414'], ['CALL', 'YOUR REPS', '#c02a1c', '#fff'],
      ['NEW', 'BLOOD', '#141414', '#f6c81f'], ['MOVE', 'OVER', '#f2701c', '#141414'], ['WE DIG', 'CHANGE', '#1f7a3d', '#fff']]
      .forEach(([a, b, bg, fg], i) => plate('p' + i, 48, 40, bg, fg, b ? [[a, 11], [b, 11]] : [[a, 18]], bg));
    for (const name of new Set(ROADS.map((r) => r.name))) {
      const t = name.toUpperCase(), k = t.lastIndexOf(' ');
      plate(name, 96, 28, '#14663a', '#fff', t.length > 10 ? [[t.slice(0, k), 12], [t.slice(k + 1), 8]] : [[t, 14]]);
    }
    tile('us', 44, 26, (w, h) => { for (let i = 0; i < 13; i++) fill(i % 2 ? '#f4f1e6' : '#c8201a', 0, i * 2, w, 2); fill('#22398a', 0, 0, 19, 14); for (let j = 0; j < 4; j++) for (let i = 0; i < 5 - (j % 2); i++) fill('#fff', 2 + i * 4 + (j % 2) * 2, 2 + j * 3, 1, 1); });
    tile('dc', 44, 26, (w, h) => { fill('#f4f1e6', 0, 0, w, h); fill('#c8201a', 0, 10, w, 5); fill('#c8201a', 0, 18, w, 5); for (const i of [11, 22, 33]) { fill('#c8201a', i - 2, 3, 5, 3); fill('#c8201a', i - 1, 2, 3, 5); } });
  });
  return { tex, uv };
}

export async function build(game) {
  // The few things too big to walk through: the site offices, the four trucks, the guard booth.
  for (const x of [-65, 65]) game.solids.push({ x0: x - 4.3, x1: x + 4.3, z0: 59.7, z1: 62.3 });
  for (const x of TRUCKS) game.solids.push({ x0: x - 3.4, x1: x + 3.6, z0: 107.5, z1: 109.7 });
  game.solids.push({ x0: 17.4, x1: 19.4, z0: 102.2, z1: 104.2 });
  await Promise.race([Promise.all(['16px "Rubik Dirt"', '16px Silkscreen', 'bold 16px Silkscreen'].map((f) => document.fonts.load(f))).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  const { tex, uv } = atlas();
  // Painted chunks (each one draw call, culled as a whole), then the lists that become the special meshes.
  const P = { north: [], south: [], centre: [], kerb: [], east: [], mid: [], west: [] }, signs = [], glass = [], sig = [[], [], [], []], bulbs = [[], []], flags = [];
  const street = (x, z) => (z < -60 ? P.east : z >= 150 ? P.west : P.mid);
  let L = P.centre;
  // Everything is built in a local frame (front toward +Z) inside at({ x, z, ry }, ...), which may nest.
  const T = [];
  const add = (g, list = L) => { for (let i = T.length - 1; i >= 0; i--) K.place(g, T[i]); list.push(g); return g; };
  const at = (o, fn) => { T.push(o); fn(); T.pop(); };
  const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
  const box = (w, h, d, c, o, sh) => add(K.box(w, h, d, c, o, sh));
  const cone = (r, h, n, c, o, sh) => add(K.cone(r, h, n, c, o, sh));
  const tube = (r1, r0, h, n, c, o, sh) => add(K.place(K.tint(new THREE.CylinderGeometry(r1, r0, h, n, 1, true).translate(0, h / 2, 0), c, sh), o));   // a cylinder without caps
  // A box whose top is scaled by kx, kz: skips, barriers, truck beds, roofs.
  const taper = (w, h, d, kx, kz, c, o, sh) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > h / 2) p.setXYZ(i, p.getX(i) * kx, h, p.getZ(i) * kz);
    g.deleteAttribute('normal');
    return add(K.place(K.tint(g, c, sh), o));
  };
  const roll = (r, len, n, c, o, open) => add(K.place(K.tint(new THREE.CylinderGeometry(r, r, len, n, 1, !!open).rotateX(Math.PI / 2).translate(0, r, 0), c), o));   // lying along z: axles, pipes
  const lit = (w, h, c, o, list = glass) => add(K.card(w, h, c, o), list);
  // A sign from the atlas, `w` metres wide, standing `off` in front of whatever it is fixed to; `two` puts it on the back as well.
  function sign(name, w, o = {}, two = false, off = 0.08) {
    const [u0, v0, u1, v1, asp] = uv[name], h = w / asp;
    for (const turn of two ? [0, Math.PI] : [0]) {
      const g = new THREE.PlaneGeometry(w, h).translate(0, h / 2, off).toNonIndexed(), a = g.attributes.uv;
      for (let i = 0; i < a.count; i++) a.setXY(i, u0 + a.getX(i) * (u1 - u0), v0 + a.getY(i) * (v1 - v0));
      add(K.place(g, { ...o, ry: (o.ry || 0) + turn }), signs);
    }
    return h;
  }
  // A sign on a backing board on two posts, bottom edge `y` up.
  const board = (name, w, y, two = true, post = WOOD) => { const h = w / uv[name][4]; box(w + 0.3, h + 0.3, 0.12, 0x555a5f, { y: y - 0.15 }); for (const k of [-1, 1]) box(0.22, y, 0.22, post, { x: k * (w / 2 - 0.6) }); sign(name, w, { y }, two); };
  // Is this spot (in the frame being built) clear of the lobby mounds?
  const free = (x, z, pad = 2) => {
    for (let i = T.length - 1; i >= 0; i--) { const o = T[i], c = Math.cos(o.ry || 0), s = Math.sin(o.ry || 0); [x, z] = [(o.x || 0) + x * c + z * s, (o.z || 0) - x * s + z * c]; }
    return !nearMound(x, z, pad);
  };

  // ---- small props ----
  const tcone = (x, z) => free(x, z, 0) && at({ x, z }, () => { box(0.6, 0.06, 0.6, ORANGE); tube(0.06, 0.24, 0.9, 5, ORANGE); tube(0.14, 0.19, 0.24, 5, WHITE, { y: 0.32 }); });
  const barrier = (x, z, ry, i) => free(x, z, 0) && at({ x, z, ry }, () => taper(2, 1, 0.65, 0.97, 0.45, i % 2 ? WHITE : ORANGE, {}, 0.15));
  // A run of orange mesh fence between two points, a post every three metres or so.
  function fence(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3.2)), [u0, v0, , v1] = uv.fence;
    at({ x: (ax + bx) / 2, z: (az + bz) / 2, ry: Math.atan2(az - bz, bx - ax) }, () => {
      const g = new THREE.PlaneGeometry(len, 1.25).translate(0, 0.75, 0).toNonIndexed(), a = g.attributes.uv;
      for (let i = 0; i < a.count; i++) a.setXY(i, u0 + a.getX(i) * len * 8 / 512, v0 + a.getY(i) * (v1 - v0));
      add(g, signs);
      for (let i = 0; i <= n; i++) tube(0.07, 0.07, 1.5, 3, DARK, { x: -len / 2 + len * i / n });
    });
  }
  const heap = (x, z, r, h) => free(x, z, r) && at({ x, z }, () => { cone(r, h, 7, DIRT, { ry: x }, 0.4); cone(r * 0.6, h * 0.7, 6, 0x7d5f3d, { x: r * 0.55, z: r * 0.3, ry: z }, 0.4); });
  const pallet = (x, z, ry, c, n = 1) => free(x, z) && at({ x, z, ry }, () => { box(1.3, 0.16, 1.3, WOOD); for (let i = 0; i < n; i++) box(1.15 - i * 0.2, 0.7, 1.15 - i * 0.1, c, { y: 0.16 + i * 0.7, ry: i * 0.2 }, 0.2); });
  const barrow = (x, z, ry) => free(x, z) && at({ x, z, ry }, () => {
    taper(0.75, 0.38, 1.05, 1.3, 1.3, 0x3f8f4e, { y: 0.4 }); taper(0.9, 0.22, 1.25, 0.5, 0.5, DIRT, { y: 0.78 });
    roll(0.22, 0.14, 6, TYRE, { z: 0.72, ry: Math.PI / 2 }); box(0.75, 0.07, 1, WOOD, { y: 0.56, z: -0.95 }); box(0.6, 0.4, 0.07, DARK, { z: -0.45 });
  });
  const loo = (x) => { box(1.25, 2.25, 1.25, 0x2f7bd6, { x }, 0.2); taper(1.35, 0.3, 1.35, 0.7, 0.7, WHITE, { x, y: 2.25 }); box(0.8, 1.75, 0.06, 0x7db4f2, { x, y: 0.12, z: 0.63 }); };
  // A floodlight tower on its little trailer, lamps toward +Z.
  const flood = (x, z, ry) => free(x, z) && at({ x, z, ry }, () => {
    box(1.5, 0.75, 2.4, YEL, { y: 0.4 }, 0.15); roll(0.4, 1.9, 6, TYRE, { ry: Math.PI / 2 }); box(2.8, 0.14, 0.16, DARK, { y: 0.2, z: 0.9 }); box(2.8, 0.14, 0.16, DARK, { y: 0.2, z: -0.9 });
    tube(0.1, 0.14, 8, 4, STEEL, { y: 1.1 }); box(2.9, 0.16, 0.16, DARK, { y: 9 });
    for (const i of [-0.75, 0.75]) { box(1.25, 0.8, 0.4, DARK, { x: i, y: 8.3 }); lit(1.05, 0.6, 0xfff3c0, { x: i, y: 8.4, z: 0.21 }); }
  });
  // The site office, door toward +Z; k = which end (-1 or 1) carries the hard-hat notice.
  const trailer = (x, z, k) => at({ x, z }, () => {
    box(9, 2.7, 3, 0xe9e4d6, { y: 0.6 }, 0.15); box(9.04, 0.5, 3.04, BLUE, { y: 1.3 }); box(9.4, 0.18, 3.4, 0x7d838a, { y: 3.3 });
    for (const i of [-3.4, 3.4]) box(0.6, 0.6, 2.2, DARK, { x: i });
    box(1.05, 2.05, 0.1, 0x5b6b7a, { x: 1.3, y: 0.75, z: 1.5 }); box(1.5, 0.7, 1, STEEL, { x: 1.3, z: 2 });
    for (const i of [-3.1, -0.9, 3.3]) box(1.25, 0.95, 0.1, GLASS, { x: i, y: 1.95, z: 1.5 });
    box(1.1, 0.7, 0.8, STEEL, { x: 3.4, y: 3.48 });
    box(5.5, 1.95, 0.14, DARK, { x: -1.4, y: 3.42, z: 1.4 }); sign('office', 5.2, { x: -1.4, y: 3.52, z: 1.4 }, true);
    sign('hardhat', 1.9, { x: k * 4.5, y: 0.9, ry: k * Math.PI / 2 }, false, 0.06);
  });
  // A tipper truck with a load on, nose toward +X.
  const tipper = (x, z, ry) => free(x, z, 4) && at({ x, z, ry }, () => {
    box(7.2, 0.45, 2.2, DARK, { y: 0.6 }); for (const i of [2.5, -1.3, -2.7]) roll(0.62, 2.5, 6, TYRE, { x: i });
    box(1.9, 2, 2.4, YEL, { x: 2.6, y: 1.05 }, 0.15); box(0.08, 0.85, 2.05, GLASS, { x: 3.56, y: 2 }); box(1.2, 0.8, 2.44, GLASS, { x: 2.7, y: 2 });
    taper(4.7, 1.6, 2.5, 1.05, 1.1, 0xe7b21c, { x: -1.15, y: 1.05 }, 0.2); taper(4.5, 0.8, 2.3, 0.55, 0.5, DIRT, { x: -1.15, y: 2.65 }); box(0.25, 0.6, 2.6, YEL, { x: 1.3, y: 2.65 });
  });
  const skip = (x, z, ry) => free(x, z, 3) && at({ x, z, ry }, () => {
    taper(3.8, 1.45, 1.9, 1.18, 1.1, 0x2f8050, {}, 0.25); taper(3.9, 0.5, 1.7, 0.6, 0.6, DIRT, { y: 1.45 });
    box(0.7, 1.2, 0.5, 0x8a5a2b, { x: 0.9, y: 1.4, rz: 0.5 }); box(0.9, 0.5, 0.7, WHITE, { x: -1, y: 1.5, ry: 0.5 });   // a lectern and a box of binders on top
    sign('skip', 2.5, { y: 0.35, z: 0.98 }, true, 0.1);
  });

  // ---- the two dig sites ----
  // Fences, signs and plant stand outside the pile's square, clear of the way in from the centre walk and the lawn walk.
  function site(gi) {
    const gx = CFG.giants[gi].x, s = Math.sign(gx), X = (a) => s * a, gz = CFG.giants[gi].z;
    const out = s < 0 ? -Math.PI / 2 : Math.PI / 2;               // facing away from the pile, on its far flank
    L = gi ? P.south : P.north;
    // west front: a hoarding at the open end, then fence either side of the lawn walk
    at({ x: X(61), z: 49.5, ry: face(X(61), 49.5, 0, 100) }, () => board('dig', 7.4, 1.3));
    fence(X(65.5), 47.6, X(69), 47.6); fence(X(77), 47.6, X(87.5), 47.6);
    at({ x: X(82.3), z: 47.9 }, () => board('danger', 4.4, 1.5, true, DARK));
    for (const [a, z] of [[69.8, 48.6], [76.2, 48.6], [54.3, 55], [52.6, 57.3], [48.9, 62.3], [47.3, 64.6]]) tcone(X(a), z);
    barrier(X(56.2), 52.4, s * 0.62, 0); barrier(X(50.7), 59.8, s * 0.62, 1);
    // far flank: fence with a vehicle gate and a foot gap
    fence(X(87.5), 47.6, X(87.5), 32); fence(X(87.5), 21, X(87.5), 0); fence(X(87.5), -6, X(87.5), -22);
    at({ x: X(87.8), z: 40, ry: out }, () => board('feed', 4.2, 1.5, true, DARK));
    at({ x: X(87.8), z: 10.5, ry: out }, () => board('days', 6.4, 1.5, true, DARK));
    at({ x: X(87.7), z: -14, ry: out }, () => { box(2.5, 2.5, 0.1, 0x555a5f, { y: 1.4 }); sign('hardhat', 2.3, { y: 1.5 }, true); box(0.16, 1.5, 0.16, DARK); });
    barrier(X(88.6), 30.6, 0.5, 0); barrier(X(90.2), 29, s * 1.2, 1); barrier(X(88.4), 22.3, -0.4, 0);
    for (const [a, z] of [[88, 27.5], [88, 24.6], [87.5, -1.5], [87.5, -4.5]]) tcone(X(a), z);
    flood(X(89.6), 49.6, face(X(89.6), 49.6, gx, gz)); flood(X(89.4), -23.4, face(X(89.4), -23.4, gx, gz)); flood(X(58.6), 55.6, face(X(58.6), 55.6, gx, gz));
    // the compound beside the way in
    trailer(X(65), 61, -s);
    at({ x: X(76.6), z: 66.4 }, () => { for (const i of [-1.4, 0, 1.4]) loo(i); box(4.2, 0.12, 0.12, DARK, { y: 2.62, z: 0.6 }); box(4.2, 0.95, 0.1, DARK, { y: 2.7, z: 0.6 }); sign(gi ? 'caucus' : 'cloak', 4.1, { y: 2.75, z: 0.6 }, true); });
    at({ x: X(51.5), z: 68, ry: face(X(51.5), 68, 0, 100) }, () => board('project', 7.6, 1.4));
    barrow(X(62.6), 65.6, 0.7); barrow(X(55.6), 61, -1.2 * s);
    if (gi) { tipper(X(60.5), 69.5, s > 0 ? 0.35 : Math.PI - 0.35); pallet(X(70), 70.5, 0.3, 0xc9c5ba, 2); }
    else { pallet(X(58.2), 64.4, 0.2, 0xc9c5ba, 2); pallet(X(59.9), 65.2, 0.5, 0x3f6fb8); pallet(X(57.3), 66.3, -0.3, 0xd9d2bc, 2); barrow(X(72), 70, 2.2); }
    // the yard on the far flank (the trees module keeps x = 86..112, z = -24..50 clear for it, inside its hedges): spoil, a skip, pipes
    heap(X(97), -6, 4.6, 2.7); heap(X(104), 1, 3.2, 1.9); heap(X(95.5), 38.5, 3.6, 2.1); barrow(X(92.4), -1.5, 1.9 * s);
    skip(X(94), 5, Math.PI / 2 + 0.1);
    at({ x: X(101.5), z: 27, ry: 0.3 }, () => { for (const [dx, y] of [[-0.45, 0], [0.45, 0], [0, 0.72]]) roll(0.42, 5.5, 6, 0xb9b5aa, { x: dx, y }, true); });
    if (!gi) tipper(X(101), -16, -Math.PI / 2 + 0.2);
    pallet(X(92), 14.5, 0.1, 0x3f6fb8, 2); pallet(X(92.3), 16.4, -0.2, 0xc9c5ba);
  }
  site(0); site(1);

  // ---- the Capitol Christmas tree going up on the north-west lawn (the trees module keeps 11 m round it clear) ----
  L = P.north;
  at({ x: -92, z: 92 }, () => {
    box(2.6, 0.7, 2.6, RED, {}, 0.2); add(K.cyl(0.5, 0.6, 2.4, 6, 0x5a4028, { y: 0.5 }));
    const tiers = [[5.6, 7.4, 1.9], [4.4, 6.4, 6.3], [3.2, 5.4, 10.2], [2, 4.6, 13.9]];
    for (const [r, h, y] of tiers) cone(r, h, 8, 0x1f5a36, { y, ry: y }, 0.35);
    // lights strung over the bottom half only
    const hues = [0xff4030, 0xffd23c, 0x40a0ff, 0x50e070, 0xffffff];
    for (let i = 0; i < 20; i++) { const t = tiers[i < 12 ? 0 : 1], y = i < 12 ? 2.3 + i * 0.4 : 6.9 + (i - 12) * 0.45, r = t[0] * (1 - (y - t[2]) / t[1]) + 0.15, a = i * 0.9; add(K.box(0.4, 0.4, 0.4, hues[i % 5], { x: Math.cos(a) * r, y, z: Math.sin(a) * r }), bulbs[i % 2]); }
    // a boom lift with the basket up, crates of lights and the star waiting its turn
    at({ x: 6.3, z: 2.2, ry: 0.3 }, () => {
      box(3.6, 0.8, 1.9, ORANGE, { y: 0.45 }, 0.2); for (const i of [-1.2, 1.2]) roll(0.5, 2.2, 6, TYRE, { x: i }); box(1.3, 0.9, 1.5, 0xd9d4c6, { x: 0.6, y: 1.25 });
      box(0.36, 10, 0.36, 0xd9d4c6, { x: 0.6, y: 1.9, rz: 0.42 }); box(1.5, 1.1, 1.1, ORANGE, { x: -3.6, y: 10.6 });
    });
    const st = []; for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, r = i % 2 ? 0.45 : 1.1; st.push(Math.sin(a) * r, Math.cos(a) * r); }
    const sp = []; for (const zz of [0.22, -0.22]) for (let i = 0; i < 10; i++) { const j = (i + 1) % 10, a = zz > 0 ? i : j, b = zz > 0 ? j : i; sp.push(0, 0, zz, st[b * 2], st[b * 2 + 1], 0, st[a * 2], st[a * 2 + 1], 0); }
    const star = new THREE.BufferGeometry(); star.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    at({ x: 5, z: -7, ry: 1.3 }, () => { box(1.3, 0.9, 1.3, WOOD); box(1.1, 0.8, 1.1, WOOD, { x: 1.6, z: 0.3, ry: 0.4 }); add(K.place(K.tint(star, 0xffc928), { y: 1.05, z: 0.95, rx: -0.35 })); });
    at({ x: 9, z: 5, ry: face(-83, 97, 0, 96) }, () => board('xmas', 5, 1.2));
    for (let i = 0; i < 7; i++) tcone(Math.cos(i * 0.9 - 0.4) * 8.5, Math.sin(i * 0.9 - 0.4) * 8.5);
  });

  // ---- the volunteers' corner by the spawn ----
  L = P.centre;
  at({ x: 0, z: 74 }, () => {   // the welcome board stands in the middle of the walk, low enough to see the dome over
    box(6.9, 4.3, 0.14, 0x8a6a40, { y: 0.75 }); for (const k of [-2.9, 2.9]) { box(0.22, 5, 0.22, WOOD, { x: k, z: -0.2 }); box(0.2, 0.2, 2.6, WOOD, { x: k, z: -1.1 }); box(0.18, 3.2, 0.18, WOOD, { x: k, z: -2.1, rx: 0.6 }); }
    sign('welcome', 6.6, { y: 0.9 });
  });
  at({ x: -22, z: 90.5, ry: face(-22, 90.5, 0, 95) }, () => {   // the rack of spare shovels
    for (const k of [-2.4, 2.4]) { box(0.2, 2.2, 0.2, WOOD, { x: k }); box(0.2, 0.2, 1.4, WOOD, { x: k }); }
    box(5, 0.16, 0.2, WOOD, { y: 1.45 }); box(5, 0.16, 0.2, WOOD, { y: 0.35, z: 0.45 });
    for (let i = 0; i < 7; i++) { const x = -1.95 + i * 0.65; box(0.1, 1.75, 0.1, 0xd9ad6c, { x, y: 0.5, z: 0.45, rx: -0.28 }); box(0.44, 0.6, 0.08, 0xc3c9cf, { x, y: 0.02, z: 0.5, rx: -0.28 }); }
    box(4.6, 2.5, 0.12, 0x8a6a40, { y: 2.15 }); sign('shovel', 4.4, { y: 2.3 }, true);
  });
  at({ x: 23, z: 90.5, ry: face(23, 90.5, 0, 95) }, () => {      // the water tent
    for (const [a, b] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) tube(0.07, 0.07, 2.6, 3, STEEL, { x: a, z: b });
    box(5.2, 1.3, 5.2, BLUE, { y: 2.4 }); cone(3.75, 1.5, 4, WHITE, { y: 3.7, ry: Math.PI / 4 });
    sign('water', 5, { y: 2.43, z: 2.6 }, false, 0.05); sign('water', 5, { y: 2.43, z: -2.6, ry: Math.PI }, false, 0.05);
    box(3.6, 0.1, 0.9, WHITE, { y: 0.85, z: 1 }); for (const k of [-1.5, 1.5]) box(0.08, 0.85, 0.7, STEEL, { x: k, z: 1 });
    for (const k of [-1.1, -0.4]) { add(K.cyl(0.26, 0.3, 0.6, 5, 0x6fb4e8, { x: k, y: 0.95, z: 1 })); cone(0.26, 0.2, 5, WHITE, { x: k, y: 1.55, z: 1 }); }
    box(0.9, 0.45, 0.6, 0x9fd0ee, { x: 0.9, y: 0.95, z: 1 }); box(1.2, 0.9, 0.9, 0x9fd0ee, { x: -1.4, z: -1.2 }); box(1.2, 0.45, 0.9, 0x9fd0ee, { x: -0.1, z: -1.3, ry: 0.3 });
  });
  // protest placards planted in the lawn either side of the walk, clear of the tracks trodden to the piles
  [[-19, 69.5], [-22.5, 67.5], [-27.5, 63.5], [-26, 81], [-31.5, 76.5], [-28, 84], [-36.5, 71.5], [19.5, 70.5], [24, 67.8], [31.5, 75.5], [26.5, 80.5], [34.5, 71.5], [28.5, 83], [37, 75]].forEach(([x, z], i) => free(x, z) &&
    at({ x, z, ry: face(x, z, 0, 99) + Math.sin(i * 7) * 0.35 }, () => at({ rz: Math.sin(i * 3) * 0.09 }, () => { tube(0.05, 0.05, 2, 3, WOOD); box(1.7, 1.42, 0.06, WHITE, { y: 1.55 }); sign('p' + (i % 8), 1.6, { y: 1.6 }, true, 0.05); })));

  // ---- lamps, benches, bins, bollards ----
  // The Washington globe: a fluted iron post with an urn-shaped white globe. Far ones get a simpler globe.
  function lamp(x, z, list) {
    L = list || street(x, z);
    const near = Math.hypot(x, z - 40) < 230;
    at({ x, z }, () => {
      tube(0.2, 0.3, 0.9, 5, IRON); tube(0.09, 0.15, 3.3, 4, IRON, { y: 0.9 });
      add(K.place(K.tint(near ? new THREE.IcosahedronGeometry(0.4, 0) : new THREE.OctahedronGeometry(0.44, 0), 0xfff6dc), { y: 4.7, sy: 1.35 }), glass);
      cone(0.24, 0.3, 4, IRON, { y: 5.3 });
    });
  }
  const bench = (x, z, ry) => at({ x, z, ry }, () => { box(1.9, 0.1, 0.55, WOOD, { y: 0.45 }); box(1.9, 0.5, 0.09, WOOD, { y: 0.62, z: -0.27 }); for (const k of [-0.8, 0.8]) box(0.1, 0.45, 0.5, IRON, { x: k }); });
  const bin = (x, z) => at({ x, z }, () => { tube(0.4, 0.34, 1, 6, 0x2a4a37); cone(0.44, 0.22, 6, DARK, { y: 1 }); });
  for (const s of [-1, 1]) {
    for (const z of [46, 73, 100]) lamp(s * 16.6, z, P.centre);
    L = P.centre; bench(s * 16.8, 96.6, -s * Math.PI / 2); bin(s * 16.8, 94.3);
    // round the pool: benches looking at the water, lamps at the corners
    for (const z of [129, 171]) lamp(s * 45.3, z, P.kerb);
    lamp(s * 26, 183.3, P.kerb);
    L = P.kerb; for (const z of [137, 150, 163]) bench(s * 45.1, z, -s * Math.PI / 2);
    bench(s * 14, 183.1, Math.PI); bin(s * 45.2, 143.5); bin(s * 45.2, 156.5); bin(s * 20, 183.1);
    for (let z = 222; z < FAR; z += 42) lamp(s * 53, z);     // down the Mall's gravel walks
  }
  L = P.kerb; bench(0, 183.1, Math.PI);
  for (let x = -13.5; x < 14; x += 3) at({ x, z: 106.4 }, () => { tube(0.17, 0.21, 0.95, 5, 0x3a4047); cone(0.19, 0.14, 5, 0x3a4047, { y: 0.95 }); });
  // Street lamps every 30 m on alternating sides, a metre behind the kerb, skipping junctions and the stretch of
  // First St where the trucks park.
  for (const r of ROADS) {
    let d = 15, k = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len;
      for (; d < len; d += 30, k++) {
        const side = k % 2 ? 1 : -1, x = ax + tx * d - tz * side * (r.w / 2 + 1), z = az + tz * d + tx * side * (r.w / 2 + 1);
        if (Math.hypot(x, z) > FAR || (r.id === 'first-w' && Math.abs(x) < (z < 114 ? 50 : 9))) continue;
        if (ROADS.some((o) => o !== r && lineDist(x, z, o.pts) < o.w / 2 + 2.5) || CIRCLES.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 8.5)) continue;
        lamp(x, z);
      }
      d -= len;
    }
  }

  // ---- traffic signals and street names ----
  // A mast arm on the far right-hand corner of each approach, as in the US: the pole stands at (x, z), the heads face
  // the way given by ry and the arm reaches `len` to the driver's left. grp 0 = a street along x, 1 = a cross street.
  function signal(x, z, ry, len, name, grp) {
    if (Math.hypot(x, z) > FAR) return;
    L = street(x, z);
    at({ x, z, ry }, () => {
      tube(0.13, 0.2, 7.3, 4, DARK); box(len, 0.18, 0.18, DARK, { x: -len / 2, y: 6.8 });
      for (const hx of [-len + 0.4, -len / 2 - 0.4]) {
        box(0.6, 1.7, 0.4, 0xd9a514, { x: hx, y: 5.3 });
        (grp ? 'rrga' : 'garr').split('').forEach((c, ph) => lit(0.42, 0.42, c === 'r' ? 0xff3020 : c === 'a' ? 0xffb020 : 0x30ff70, { x: hx, y: c === 'r' ? 6.45 : c === 'a' ? 5.94 : 5.43, z: 0.22 }, sig[ph]));
      }
      if (name) { box(4.9, 1.6, 0.1, SIGNGREEN, { x: -2.9, y: 7 }); sign(name, 4.7, { x: -2.9, y: 7.1 }, false, 0.07); }
    });
  }
  const road = (id) => ROADS.find((r) => r.id === id);
  // arms: a = for traffic heading -x, b = +x, c = +z, d = -z
  function junction(jx, jz, rx, rz, arms = 'abcd') {
    const hx = rx.w / 2 + 1.2, hz = rz.w / 2 + 1.2;
    if (arms.includes('a')) signal(jx - hz, jz - hx, Math.PI / 2, hx, rz.name, 0);
    if (arms.includes('b')) signal(jx + hz, jz + hx, -Math.PI / 2, hx, rz.name, 0);
    if (arms.includes('c')) signal(jx - hz, jz + hx, Math.PI, hz, rx.name, 1);
    if (arms.includes('d')) signal(jx + hz, jz - hx, 0, hz, rx.name, 1);
  }
  for (const [x, zr] of [['first-w', 'constitution'], ['first-w', 'independence'], ['third-w', 'constitution'], ['third-w', 'independence'], ['first-e', 'constitution'], ['first-e', 'independence']]) junction(road(zr).pts[0][0], road(x).pts[0][1], road(x), road(zr));
  junction(0, -150, road('first-e'), road('east-capitol'), 'abc');
  junction(-112, 196, road('third-w'), road('madison'), 'abd'); junction(112, 196, road('third-w'), road('jefferson'), 'abd');
  junction(0, 114, road('first-w'), { w: 31 }, 'ab');           // the crossing at the foot of the centre walk
  // Name blades on a post: where the walks meet First St, and at the two circles.
  function blades(x, z, ry, a, b) {
    L = street(x, z);
    at({ x, z, ry }, () => {
      tube(0.08, 0.1, 4.2, 4, STEEL);
      [[a, 0, 4.2], [b, Math.PI / 2, 5.25]].forEach(([name, turn, y]) => name && at({ ry: turn }, () => { box(3.5, 1.02, 0.08, SIGNGREEN, { y }); sign(name, 3.5, { y }, true, 0.06); }));
    });
  }
  blades(-19, 105.4, 0, 'First St'); blades(19, 122.4, 0, 'First St');
  blades(-99.5, 105.5, 0, 'First St', 'Pennsylvania Ave'); blades(99.5, 105.5, 0, 'First St', 'Maryland Ave');
  blades(-52, 203.5, 0, 'Third St'); blades(52, 203.5, 0, 'Third St');

  // ---- First St, either side of the centre walk ----
  L = P.kerb;
  // Two TV trucks, masts up, dishes on the bird. Their lawn side is local -Z.
  [['tv1', WHITE, BLUE], ['tv2', 0xd9dde2, RED]].forEach(([logo, body, stripe], i) => at({ x: TRUCKS[i], z: 108.6 }, () => {
    box(4.9, 2.5, 2.4, body, { x: -0.9, y: 0.6 }, 0.12); box(4.94, 0.4, 2.44, stripe, { x: -0.9, y: 0.75 }); box(1.9, 1.75, 2.3, body, { x: 2.5, y: 0.6 }, 0.12); box(0.08, 0.75, 2, GLASS, { x: 3.46, y: 1.45 }); box(1.1, 0.7, 2.34, GLASS, { x: 2.6, y: 1.5 });
    for (const k of [2.4, -2.1]) roll(0.5, 2.5, 6, TYRE, { x: k });
    sign(logo, 4.3, { x: -0.9, y: 1.4, z: 1.2 }, false, 0.03); sign(logo, 4.3, { x: -0.9, y: 1.4, z: -1.2, ry: Math.PI }, false, 0.03);
    box(3.2, 0.25, 1.7, STEEL, { x: -0.9, y: 3.1 }); tube(0.07, 0.11, 9 - i * 2, 4, STEEL, { x: -2.6, y: 3.3 });
    at({ x: -2.6, y: 12.2 - i * 2, ry: 0.6 + i }, () => { cone(1.15, 0.45, 8, 0xe9ecef, { rx: 2.25 }); box(0.12, 0.12, 0.9, DARK, { y: -0.1, rx: -0.9 }); });
    if (i) { add(K.dome(0.95, 0xe9ecef, { x: 0.2, y: 3.35 }, 6, 2)); lit(1.3, 0.8, 0x6fc8ff, { x: -1.9, y: 1.5, z: -1.24, ry: Math.PI }); }
    // a camera on a tripod and a light stand, aimed at the dome
    at({ x: -1 + i * 2.5, z: -4.2, ry: 2.9 }, () => { for (const a of [0, 2.1, 4.2]) tube(0.03, 0.03, 1.6, 3, DARK, { y: 1.5, ry: a, rx: Math.PI - 0.3 }); box(0.3, 0.3, 0.7, DARK, { y: 1.45 }); box(0.5, 0.5, 0.08, STEEL, { x: 1.4, y: 2.2 }); tube(0.03, 0.03, 2.2, 3, STEEL, { x: 1.4 }); });
  }));
  // Two food trucks, hatches open to the lawn.
  [['smokes', 0xf0bd22, 0xb3221a], ['tacos', 0x1c938c, 0xffe27a]].forEach(([logo, body, trim], i) => at({ x: TRUCKS[i + 2], z: 108.6 }, () => {
    box(5.6, 2.6, 2.4, body, { x: -0.7, y: 0.55 }, 0.12); box(1.6, 1.8, 2.3, body, { x: 2.8, y: 0.55 }, 0.12); box(0.08, 0.8, 2, GLASS, { x: 3.61, y: 1.4 }); box(1, 0.7, 2.34, GLASS, { x: 2.9, y: 1.5 });
    for (const k of [2.6, -2.2]) roll(0.5, 2.5, 6, TYRE, { x: k });
    box(2.9, 1.05, 0.1, GLASS, { x: -0.9, y: 1.75, z: -1.2 }); box(3.1, 0.1, 0.5, STEEL, { x: -0.9, y: 1.66, z: -1.45 }); box(3.3, 0.1, 1.3, trim, { x: -0.9, y: 2.95, z: -1.8, rx: 0.2 });
    sign(logo, 3.9, { x: -0.7, y: 0.6, z: -1.2, ry: Math.PI }, false, 0.03); sign(logo, 5.2, { x: -0.7, y: 1.2, z: 1.2 }, false, 0.03);
    if (i) { box(5.3, 1.75, 0.14, DARK, { x: -0.7, y: 3.2 }); sign(logo, 5.1, { x: -0.7, y: 3.35 }, true); }
    else at({ x: -0.7, y: 3.15 }, () => {   // a half-smoke the size of a canoe on the roof
      taper(4.2, 0.55, 1.2, 1, 1.35, 0xdba75c, {}, 0.2); add(K.place(K.tint(new THREE.CylinderGeometry(0.42, 0.42, 4.8, 6).rotateZ(Math.PI / 2), 0x9a3520), { y: 0.72 }));
      for (let k = -3; k <= 3; k++) box(0.5, 0.1, 0.16, 0xffd23c, { x: k * 0.6, y: 1.12, ry: k % 2 ? 0.7 : -0.7 });
    });
    at({ x: -3.6, z: -3, ry: Math.PI - 0.4 }, () => { box(0.9, 1.3, 0.08, DARK, { rx: -0.2 }); lit(0.7, 0.9, i ? 0xffe27a : 0xf6c81f, { y: 0.2, z: 0.06, rx: -0.2 }); });   // a sandwich board
  }));
  at({ x: 18.4, z: 103.2 }, () => {   // the guard booth where the walk meets the street
    box(2.3, 2.5, 2.3, WHITE, {}, 0.12); box(2.38, 0.8, 1.5, GLASS, { y: 1.25 }); box(1.5, 0.8, 2.38, GLASS, { y: 1.25 }); box(3, 0.2, 3, 0x2a4a37, { y: 2.5 });
    box(3, 1, 0.14, 0x2a4a37, { y: 2.7 }); sign('check', 2.9, { y: 2.72 }, true);
  });
  // north of the trucks: a hydrant, newspaper boxes, the bus shelter
  const hydrant = (x, z) => { L = street(x, z); at({ x, z }, () => { tube(0.17, 0.21, 0.6, 5, RED); cone(0.21, 0.22, 5, RED, { y: 0.6 }); box(0.62, 0.17, 0.17, 0xe9ecef, { y: 0.35 }); }); };
  [[-46.5, 107.4], [47.5, 107.4], [-150, 107.4], [150, 107.4], [-70, 202.6], [70, 202.6], [-40, -156.6], [60, -156.6]].forEach(([x, z]) => hydrant(x, z));
  L = P.kerb;
  [0x2f6fd0, 0xcc2a1e, 0xf0bd22, 0x2f8050].forEach((c, i) => at({ x: -50.5 - i * 0.75, z: 106.2 }, () => { box(0.3, 0.3, 0.3, DARK); box(0.6, 1, 0.5, c, { y: 0.3 }, 0.15); box(0.44, 0.4, 0.04, GLASS, { y: 0.8, z: -0.26 }); }));
  at({ x: -63, z: 106.2 }, () => {
    box(6.4, 0.16, 2.4, 0x3c4650, { y: 2.55 }); box(6, 2, 0.08, 0xa9cbdc, { y: 0.45, z: -1 }); box(0.08, 2, 1.7, 0xa9cbdc, { x: -3, y: 0.45, z: -0.15 });
    for (const [a, b] of [[-3, -1], [3, -1], [-3, 0.9], [3, 0.9]]) tube(0.06, 0.06, 2.55, 3, DARK, { x: a, z: b });
    box(0.3, 2.2, 1.6, DARK, { x: 3, y: 0.25, z: -0.1 }); for (const k of [-1, 1]) sign('busad', 1.4, { x: 3, y: 0.42, z: -0.1, ry: k * Math.PI / 2 }, false, 0.17);
    box(4, 0.1, 0.5, WOOD, { y: 0.5, z: -0.6 }); box(0.1, 0.5, 0.4, DARK, { x: -1.6, z: -0.6 }); box(0.1, 0.5, 0.4, DARK, { x: 1.6, z: -0.6 });
    tube(0.06, 0.06, 3.2, 3, STEEL, { x: 4.6, z: 0.9 }); box(0.95, 0.95, 0.08, DARK, { x: 4.6, y: 2.4, z: 0.9, ry: Math.PI / 2 }); sign('bus', 0.9, { x: 4.6, y: 2.42, z: 0.9, ry: Math.PI / 2 }, true, 0.06);
  });
  bin(-68.5, 106.3); bin(44.5, 105.6);
  // south of the trucks: a bikeshare dock and its row of red bikes (two are out)
  at({ x: 58, z: 105.6 }, () => {
    box(13.5, 0.1, 1, 0x3c4046, { z: 0.6 });
    for (let i = 0; i < 10; i++) {
      const x = -6 + i * 1.3;
      box(0.3, 0.95, 0.35, DARK, { x, z: 0.95 }); box(0.32, 0.12, 0.37, RED, { x, y: 0.95, z: 0.95 });
      if (i === 3 || i === 8) continue;
      for (const z of [0.3, -0.85]) for (const turn of [1, -1]) add(K.place(K.tint(new THREE.CircleGeometry(0.4, 6).rotateY(turn * Math.PI / 2), TYRE), { x: x + turn * 0.03, y: 0.4, z }));
      box(0.14, 0.32, 1.2, RED, { x, y: 0.45, z: -0.28 }); box(0.6, 0.5, 0.1, RED, { x, y: 0.7, z: 0.35 }); box(0.24, 0.5, 0.3, DARK, { x, y: 0.75, z: -0.6 });
    }
    box(1.1, 2.5, 0.4, DARK, { x: 7.8, z: 0.6 }); sign('bike', 0.95, { x: 7.8, y: 0.95, z: 0.6 }, true, 0.21); box(1.4, 0.08, 0.9, 0x1c2c58, { x: 7.8, y: 2.55, z: 0.6, rx: 0.25 });
  });

  // ---- flags: two tall poles at the foot of the west steps, a row each side on the open lawn by First St ----
  // Each flag is a strip of quads; `fly` carries how far along the cloth a corner is and its phase in the wind.
  function flag(x, z, h, w, name, list) {
    L = list;
    at({ x, z }, () => { add(K.cyl(h * 0.045, h * 0.06, 0.5, 6, STONE)); tube(h * 0.006, h * 0.013, h, 5, 0xe3e6ea); add(K.place(K.tint(new THREE.OctahedronGeometry(h * 0.016), 0xe8c048), { y: h })); });
    const [u0, v0, u1, v1, asp] = uv[name], fh = w / asp, g = new THREE.PlaneGeometry(w, fh, 6, 1).translate(w / 2, -fh / 2, 0).toNonIndexed(), p = g.attributes.position, a = g.attributes.uv, fly = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { const t = p.getX(i) / w; fly[i * 2] = t * w * 0.11; fly[i * 2 + 1] = t * 5 + x; a.setXY(i, u0 + a.getX(i) * (u1 - u0), v0 + a.getY(i) * (v1 - v0)); }
    g.setAttribute('fly', new THREE.BufferAttribute(fly, 2));
    flags.push(g.translate(x + h * 0.01, h - 0.15, z));
  }
  flag(-24, 44, 16, 5.6, 'us', P.centre); flag(24, 44, 16, 5.6, 'us', P.centre);
  [46, 51.5, 57].forEach((a, i) => { flag(-a, 100.8, 9.5, 3.3, i % 2 ? 'dc' : 'us', P.kerb); flag(a, 100.8, 9.5, 3.3, i % 2 ? 'us' : 'dc', P.kerb); });

  // ---- into the scene ----
  for (const list of Object.values(P)) if (list.length) game.scene.add(K.mesh(list));
  const merged = (list) => { const g = mergeGeometries(list, false); g.computeBoundingSphere(); return g; };
  const still = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.updateMatrix(); game.scene.add(m); return m; };
  still(merged(signs), ps1ify(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 })));
  still(K.merge(glass), K.glow);
  const wind = { value: 0 }, cloth = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  cloth.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = snap; sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform vec2 uSnap; uniform float uWind; attribute vec2 fly;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normal * sin(uWind * 4.5 - fly.y) * fly.x; transformed.y -= fly.x * (1.3 + sin(uWind * 1.3 + fly.y * 0.4));')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vec2 sp = gl_Position.xy / gl_Position.w; sp = floor(sp * uSnap + 0.5) / uSnap; gl_Position.xy = sp * gl_Position.w;');
  };
  still(merged(flags), cloth);
  const lights = sig.map((l, i) => { const m = still(K.merge(l), K.glow); m.visible = !i; return m; });
  const twinkle = bulbs.map((l, i) => { const m = still(K.merge(l), K.glow); m.visible = !i; return m; });

  // Parked machines: a tool model flattened into one mesh, so an idle excavator costs one draw call, not thirteen.
  async function park(file, x, z, ry) {
    const m = await model(`/models/tools/${file}.glb`), parts = [];
    if (!m || nearMound(x, z, 5)) return;
    m.root.updateMatrixWorld(true);
    let mat = null;
    m.root.traverse((o) => { if (!o.isMesh) return; const g = new THREE.BufferGeometry(), src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, src.attributes[k].clone()); parts.push(g.applyMatrix4(o.matrixWorld)); mat = o.material; });
    still(K.place(merged(parts), { x, z, ry }), mat).geometry.computeBoundingSphere();
  }
  await Promise.all([park('excavator', -100, 16, Math.PI / 2 - 0.25), park('bulldozer', 99.5, 15, -Math.PI / 2 + 0.3)]);

  let phase = 0, blink = 0;
  return { update(dt, g) {
    wind.value = g.time;
    const t = g.time % CYCLE, ph = t < GO ? 0 : t < GO + AMBER ? 1 : t < CYCLE - AMBER ? 2 : 3, b = Math.floor(g.time * 1.7) & 1;
    if (ph !== phase) { lights[phase].visible = false; lights[phase = ph].visible = true; }
    if (b !== blink) { twinkle[blink].visible = false; twinkle[blink = b].visible = true; }
  } };
}
