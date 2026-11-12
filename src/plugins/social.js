import * as THREE from 'three';
import { CFG } from '../config.js';
import { ps1ify } from '../ps1.js';
import { FX } from '../net.js';
import { box, merge } from '../scenery/kit.js';
import './social.css';

// The crowd, made visible. Everyone in your room who has no full body gets a blocky stand-in; the people digging each
// pile from OTHER rooms stand on it as pale figures (as many as the server counts, at made-up spots); the nearest few
// get a name you can actually read; and what happens to the people around you is shown and told.
// All the figures are one instanced mesh: a frame costs matrix writes only, everything else runs four times a second.

const ROOM = CFG.net.roomSize, GHOSTS = 60, MAX = ROOM + GHOSTS * CFG.giants.length, LABELS = 6;
const SHIRTS = [0xffc21a, 0xe8622a, 0x3a6ea8, 0xb3261a, 0x3f8f5a, 0xe9e2d0, 0x6d6f78, 0x7a4fa0, 0x2a8c8c, 0x8a5a2c].map((c) => new THREE.Color(c));
const SPARKS = [0xffc21a, 0xead9b0, 0xffffff];
// what a lobby is doing to someone else, held over their head while it lasts
const EFFECT = { hasbara: 'TALKING POINTS', deductible: 'CLAIM DENIED', pricehike: 'PRICE HIKE', slick: 'OIL SLICK', buyout: 'BOUGHT OUT', tos: 'TERMS UPDATED' };
const lobbyOf = (effect) => CFG.lobbies.find((l) => l.effect === effect);
// Crowd news of one kind is held back and counted, so a filling room reads "+6 diggers arrived", not six lines.
// [seconds to wait for more, least seconds between two lines of this kind, the line for several]
const NEWS = {
  join: [3, 6, (n) => `+${n} diggers arrived`],
  tool: [0.4, 4, (n) => `${n} diggers got new tools`],
  down: [0.4, 5, (n) => `${n} diggers got LOBBIED`],
  cheer: [1, 8, (n) => `${n} people cheering near you`],
};
const FLAT = ['no comment', 'thoughts and prayers', 'send flowers to K Street', 'the donors have been notified'];
// the second line when the number of people digging passes a round number
const CROWD = { 10: 'enough for a subcommittee', 25: 'more than most hearings draw', 50: 'the lobbyists have noticed', 100: 'K Street is ordering lunch in',
  250: 'someone is drafting a statement', 500: 'the statement expresses concern', 1000: 'the statement has been walked back',
  2500: 'the lobbyists are updating their resumes', 5000: 'the donors would like a word', 10000: 'this is what a mandate looks like' };
// the next round number above n: steps x 10^k, starting at `from`
const above = (n, steps, from) => { for (let s = from; ; s *= 10) for (const m of steps) if (m * s > n) return m * s; };
const hex = (css) => parseInt(css.slice(1), 16);

// One blocky person, feet on the ground, facing +Z, hands out on a shovel handle. `part` says how each box is coloured:
// 0 as painted, 1 the shirt (the instance colour), 2 skin (a tone picked from the instance colour).
function figure() {
  const as = (g, p) => g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(p), 1));
  const leg = (x) => as(box(0.2, 0.82, 0.24, 0x2c3140, { x }), 0), arm = (x) => as(box(0.13, 0.14, 0.5, 0xffffff, { x, y: 1.14, z: 0.2 }, 0.2), 1);
  const g = merge([leg(-0.13), leg(0.13), arm(-0.31), arm(0.31),
    as(box(0.5, 0.6, 0.28, 0xffffff, { y: 0.82 }, 0.3), 1),
    as(box(0.28, 0.28, 0.28, 0xffffff, { y: 1.44 }, 0.15), 2),
    as(box(0.3, 0.08, 0.3, 0x2a1d14, { y: 1.72 }), 0),
    as(box(0.06, 1.3, 0.06, 0x8a6a45, { z: 0.95, rx: -0.42 }), 0)]);
  // nobody sees the undersides: draw only the faces that do not point at the ground
  const n = g.attributes.normal, seen = [];
  for (let i = 0; i < n.count; i += 3) if (n.getY(i) > -0.9) seen.push(i, i + 1, i + 2);
  return g.setIndex(seen);
}
// The site's vertex-snapped paint, plus: shirt and skin from the instance colour, and `pale` figures (people in other
// rooms) washed out towards the sky, so they read as people who are here and not here.
function paint() {
  const mat = ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true })), snap = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    snap(sh);
    sh.vertexShader = 'attribute float part;\nattribute float pale;\n' + sh.vertexShader.replace('#include <color_vertex>', `vColor = color;
      if (part > 1.5) vColor *= mix(vec3(0.9, 0.62, 0.45), vec3(0.2, 0.11, 0.07), fract(dot(instanceColor, vec3(12.99, 78.23, 37.72)) * 43.76));
      else if (part > 0.5) vColor *= instanceColor;
      vColor = mix(vColor, vec3(0.74, 0.86, 1.0), pale * 0.55);`);
  };
  return mat;
}

export function init(game) {
  const { bus, hud, net } = game, cam = game.camera;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();

  // ---- the figures: your room's bodiless players first, then the ghosts, packed into the front of one instanced mesh
  const geo = figure(), pale = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
  geo.setAttribute('pale', pale);
  const mesh = new THREE.InstancedMesh(geo, paint(), MAX);
  for (let i = 0; i < MAX; i++) mesh.setColorAt(i, SHIRTS[0]);
  mesh.frustumCulled = false; mesh.count = 0; mesh.visible = false;
  game.scene.add(mesh);
  const keys = new Int32Array(MAX);   // who each slot was last coloured as (sid + 1, or minus a ghost's number): colours are only written when that changes
  const put = (i, x, y, z, ry, rx, s) => mesh.setMatrixAt(i, M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, 0, 'YXZ')), S.set(s, s, s)));
  const dress = (i, key, n, ghost) => {
    if (keys[i] === key) return;
    keys[i] = key;
    mesh.setColorAt(i, C.copy(SHIRTS[n % SHIRTS.length]).offsetHSL((n * 0.618 % 1 - 0.5) * 0.05, 0, (n * 0.377 % 1 - 0.5) * 0.12));
    pale.array[i] = ghost;
    mesh.instanceColor.needsUpdate = pale.needsUpdate = true;
  };

  const list = [];   // everyone in the room, as an array, refreshed when someone comes or goes
  const relist = () => { list.length = 0; for (const r of net.remotes.values()) list.push(r); };
  const within = (r, m) => r.pos.distanceToSquared(game.player.pos) < m * m;

  // ---- ghosts: game.dg[i] people dig pile i across every room; the ones who are not in yours stand on it, pale
  const ghosts = [];
  CFG.giants.forEach((_, pile) => { for (let j = 0; j < GHOSTS; j++) ghosts.push({ pile, j, x: 0, y: 0, z: 0, yaw: 0, s: 1, k: 0, ph: Math.random(), per: 3, t: 0, wait: Math.random() * 3 }); });
  const want = CFG.giants.map(() => 0), own = CFG.giants.map(() => 0), close = CFG.giants.map(() => false);
  let live = false, explained = false, clods = 0;
  // A new spot for one ghost, for 15 to 30 seconds: the front of the pile (the lawn side) more often than the back, and
  // never on top of you or anybody else. Two in three work the foot of the pile, where the dirt meets the lawn and
  // where you dig too; the rest are up on it.
  function roll(g) {
    const f = game.fields[g.pile], c = f.giant, p = game.player.pos;
    for (let tries = 0; tries < 4; tries++) {
      const a = (Math.random() < 0.7 ? Math.random() - 0.5 : Math.random() + 0.5) * Math.PI, sx = Math.sin(a), cz = Math.cos(a);
      const dirt = (d) => f.heightAt(c.x + sx * d, c.z + cz * d) - f.floorAt(c.x + sx * d, c.z + cz * d) > 0.6;
      let d = 36;
      if (g.j % 3) { while (d > 4 && !dirt(d)) d--; d++; }
      if (d < 6 || !(g.j % 3)) { d = 6 + Math.sqrt(Math.random()) * 20; if (!dirt(d)) continue; }
      const x = c.x + sx * d, z = c.z + cz * d;
      let free = Math.hypot(x - p.x, z - p.z) > 3;
      for (let i = 0; free && i < ghosts.length; i++) { const o = ghosts[i]; free = o === g || o.k <= 0 || Math.abs(o.x - x) + Math.abs(o.z - z) > 1.8; }
      for (let i = 0; free && i < list.length; i++) free = Math.abs(list[i].pos.x - x) + Math.abs(list[i].pos.z - z) > 1.8;
      if (!free) continue;
      g.x = x; g.z = z; g.y = game.surface(x, z); g.yaw = a + Math.PI + (Math.random() - 0.5) * 0.5;
      g.per = 2.2 + Math.random() * 1.8; g.t = 15 + Math.random() * 15; g.s = 0.94 + Math.random() * 0.12;
      return true;
    }
    return false;
  }

  // ---- names you can read: DOM labels for the nearest few, in place of their name-tag sprite
  const names = document.createElement('div'); names.id = 'names';
  document.getElementById('hud').prepend(names);   // under every other part of the HUD
  const slots = Array.from({ length: LABELS }, () => {
    const el = document.createElement('div'), fx = document.createElement('i'), b = document.createElement('b');
    el.append(fx, b); el.hidden = true; names.append(el);
    return { el, fx, b, r: null, a: null, w: 0, e: -1, x: 0, y: 0, half: 0, tall: 0 };
  });
  const held = new Set(), best = [], bestD = [];
  const release = (s) => { if (s.a) s.a.tagW = s.w; held.delete(s.r); s.r = s.a = null; s.el.hidden = true; };
  function label() {
    const p = game.player.pos, small = innerWidth < 700, most = small ? 4 : LABELS;   // a phone held upright has room for fewer
    let m = 0;
    for (const r of list) {
      if (r.flags & 4) continue;
      // within 30 m; someone under a lobby effect counts as nearer, and whoever has a label keeps it a little longer
      const d = r.pos.distanceToSquared(p) * (held.has(r) ? 0.8 : 1) * ((r.flags >> 4) & 7 ? 0.45 : 1);
      if (d > 900 || (m === most && d >= bestD[m - 1])) continue;
      let k = m < most ? m++ : m - 1;
      for (; k > 0 && bestD[k - 1] > d; k--) { best[k] = best[k - 1]; bestD[k] = bestD[k - 1]; }
      best[k] = r; bestD[k] = d;
    }
    best.length = m;
    for (const s of slots) if (s.r && !best.includes(s.r)) release(s);
    for (const r of best) if (!held.has(r)) { const s = slots.find((o) => !o.r); s.r = r; s.e = -1; s.b.textContent = r.name; held.add(r); }
    for (const s of slots) {
      const r = s.r, a = r?.avatar, e = r ? (r.flags >> 4) & 7 : 0;
      if (!r) continue;
      // avatar.update sizes the sprite from tagW every frame, so a width of nothing hides it for as long as we hold it
      if (a && a.tagW) { s.a = a; s.w = a.tagW; a.tagW = 0; }
      if (e !== s.e) { s.e = e; s.fx.textContent = EFFECT[FX[e]] || ''; const c = lobbyOf(FX[e])?.color; s.fx.style.background = c === '#222222' ? '#555' : c || ''; }
      // its size on screen, near enough, without asking the page to measure it
      s.half = Math.max(r.name.length, s.fx.textContent.length + 1) * (small ? 3.4 : 3.8) + 8; s.tall = s.fx.textContent ? 32 : 16;
    }
  }
  function place() {
    // this frame's view, not the last one's: a free camera is only put in place after the add-ons have run, so do it here first
    const c = game.cam, w = innerWidth / 2, h = innerHeight / 2;
    if (c) { cam.position.set(c.pos[0], c.pos[1], c.pos[2]); cam.lookAt(c.look[0], c.look[1], c.look[2]); }
    cam.updateMatrixWorld();
    for (let i = 0; i < LABELS; i++) {
      const s = slots[i], r = s.r;
      if (!r) continue;
      const a = r.avatar, at = a && a.vehicle && a.body ? a.body.root.position : r.pos;   // drivers: over the seat
      V.set(at.x, at.y + 2.1, at.z).project(cam);
      const on = V.z < 1 && Math.abs(V.x) < 1.05 && Math.abs(V.y) < 1.05 && !(r.flags & 4);
      if (on === s.el.hidden) s.el.hidden = !on;
      if (!on) continue;
      const x = Math.round(Math.max(s.half, Math.min(w * 2 - s.half, (V.x + 1) * w)));   // whole on the screen, even when they are at its edge
      let y = Math.round((1 - V.y) * h);
      // two names on top of each other are no names at all: the later one steps up over the earlier
      for (let j = 0; j < i; j++) { const o = slots[j]; if (o.r && !o.el.hidden && Math.abs(x - o.x) < s.half + o.half && y > o.y - o.tall && y - s.tall < o.y) { y = o.y - o.tall; j = -1; } }
      if (x !== s.x || y !== s.y) { s.x = x; s.y = y; s.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; }
    }
  }

  // ---- the news
  const pend = {};
  const note = (kind, one) => { const c = pend[kind] ||= { n: 0, one: '', due: 0, last: -99 }; if (!c.n++) c.due = Math.max(game.time + NEWS[kind][0], c.last + NEWS[kind][1]); c.one = one; };
  let party = 0, hush = 0, proud = 0, proudT = 0, wooT = 0, flat = 0, countNext = 0, totNext = 0, slowT = 0;
  // A moment everybody shares: you and every body on foot within 80 m throw your arms up, and the blocky ones hop.
  function together(secs) {
    const p = game.player;
    party = secs; hush = game.time + secs + 3;   // everyone's arms go up at once: that is not news
    if (p.dead <= 0) p.avatar.cheer(secs);
    for (const r of list) if (r.avatar && !(r.flags & 4) && within(r, 80)) r.avatar.cheer(secs + Math.random() * 0.6);
  }
  bus.on('join', ({ name }) => { relist(); note('join', `${name} grabbed a shovel`); });
  bus.on('leave', relist);
  bus.on('online', relist);
  bus.on('remoteTool', ({ remote: r, name, tool }) => {
    if (!tool) return;
    const what = tool.name.toUpperCase();
    note('tool', `${name} got the ${what}`);
    r.avatar?.cheer(2); proud = r.sid; proudT = game.time + 5;   // their own arms going up over it is the same news, not more
    if (within(r, 90)) { hud.pop(`${what}!`, r.pos.x, r.pos.y + 2.8, r.pos.z, 'dim'); game.puff(r.pos.x, r.pos.y + 0.4, r.pos.z, 8, 1.5, SPARKS); }
  });
  bus.on('remoteDown', ({ remote: r, name }) => {
    note('down', `${name} got LOBBIED`);
    if (within(r, 90)) { hud.pop('LOBBIED', r.pos.x, r.pos.y + 2.2, r.pos.z, 'dim'); game.puff(r.pos.x, r.pos.y + 1, r.pos.z, 12, 2.5); }
  });
  bus.on('remoteFx', ({ remote: r, effect }) => {
    const l = lobbyOf(effect);
    slowT = 1;   // the label over their head changes now, not at the next look
    if (l && within(r, 60)) game.puff(r.pos.x, r.pos.y + 1.6, r.pos.z, 6, 0.8, hex(l.color));
  });
  bus.on('remoteCheer', ({ remote: r }) => {
    if (game.time < hush || (r.sid === proud && game.time < proudT) || !within(r, 40)) return;
    note('cheer', `${r.name} is cheering`);
    if (game.time >= wooT) { wooT = game.time + 0.3; hud.pop('WOO', r.pos.x, r.pos.y + 2.6, r.pos.z, 'dim'); }
  });
  // their digging throws dirt too, even when all you can see of them is a blocky stand-in
  bus.on('remoteDig', ({ x, y, z, near }) => { if (!near && clods >= 2 && Math.hypot(x - cam.position.x, z - cam.position.z) < 110) { clods -= 2; game.puff(x, y + 0.3, z, 2, 1); } });
  bus.on('moundDown', ({ mound, quiet }) => { if (quiet) return; together(2.5); hud.feed(`${mound.lobby.name} nest flattened. ${FLAT[flat++ % FLAT.length]}`); });
  bus.on('milestone', () => together(2.5));
  bus.on('giant', ({ status }) => { if (status === 'dug') together(4); });

  // ---- CHEER for thumbs: what the E key does
  const btn = document.createElement('button'); btn.id = 'cheerbtn'; btn.textContent = 'CHEER';
  document.getElementById('hud').append(btn);
  btn.addEventListener('pointerdown', (e) => {   // not click: phones send none while another thumb is down on the stick
    const p = game.player;
    e.preventDefault();
    if (!game.started || p.dead > 0) return;
    p.avatar.cheer(2.5); bus.emit('cheer', { x: p.pos.x, y: p.pos.y, z: p.pos.z, self: true });
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  // Four times a second: who is here, how many ghosts each pile is owed, whose name is shown, and what there is to say.
  function slow(dt) {
    const p = game.player, on = net.online && !game.solo;
    relist();
    game.fields.forEach((f, i) => {
      // the server's count is an average over a few seconds, so ours is too, or the last ghost would flicker
      let mine = p.digging && !p.fighting && f.inside(p.pos.x, p.pos.z) ? 1 : 0;
      for (const r of list) if ((r.flags & 14) === 2 && f.inside(r.pos.x, r.pos.z)) mine++;
      own[i] = live ? own[i] + (mine - own[i]) * Math.min(1, dt / 5) : mine;
      want[i] = on && game.status(i) === 'buried' ? Math.max(0, Math.min(GHOSTS, Math.round((game.dg[i] || 0) - own[i]))) : 0;
      close[i] = Math.hypot(cam.position.x - f.giant.x, cam.position.z - f.giant.z) < 130;
      if (want[i] && !explained) { explained = true; hud.feed('pale diggers = real people, other crews'); }
    });
    live = on;
    for (const g of ghosts) {
      if (g.k <= 0) continue;
      const f = game.fields[g.pile], bx = g.x + Math.sin(g.yaw) * 1.2, bz = g.z + Math.cos(g.yaw) * 1.2;
      g.y = game.surface(g.x, g.z);
      if (f.heightAt(bx, bz) - f.floorAt(bx, bz) < 0.15 || Math.hypot(g.x - p.pos.x, g.z - p.pos.z) < 1.5) g.t = 0;   // nothing left in front of them to dig, or you are standing in them: move along
    }
    label();
    for (const k in pend) { const c = pend[k]; if (c.n && game.time >= c.due) { hud.feed(c.n > 1 ? NEWS[k][2](c.n) : c.one); c.n = 0; c.last = game.time; } }
    // the size of the thing, said out loud when it passes a round number (never for the numbers you arrived to)
    if (!on) return;
    if (!countNext) { countNext = above(net.count, [1, 2.5, 5], 10); totNext = above(game.tot, [1, 5], 1e4); }
    let hit = 0;
    while (net.count >= countNext) { hit = countNext; countNext = above(hit, [1, 2.5, 5], 10); }
    if (hit) hud.toast(`${hit.toLocaleString()} PEOPLE DIGGING\n${CROWD[hit] || 'still no comment from under the dirt'}`, 4, 2);
    for (hit = 0; game.tot >= totNext; totNext = above(hit, [1, 5], 1e4)) hit = totNext;
    if (hit) hud.toast(`${hit.toLocaleString()} m³ DUG TOGETHER\n${Math.round(hit / 2500).toLocaleString()} olympic pools of dirt. zero resignations.`, 5, 2);
  }

  function update(dt) {
    if ((slowT += dt) >= 0.25) { slow(slowT); slowT = 0; }
    clods = Math.min(16, clods + dt * 24);   // at most this much dirt a second from stand-ins and ghosts: the clods are shared with your own digging
    if (party > 0) party -= dt;
    const t = game.time;
    let n = 0;
    for (let i = 0; i < list.length && n < ROOM; i++) {
      const r = list[i];
      if ((r.flags & 4) || r.avatar?.body) continue;
      // leaning into each bite on the beat the core keeps for their tool; a hop when they cheer, a bounce in their step
      const b = (r.flags & 10) === 2 ? r.beat || 0 : 0, hop = party > 0 || r.flags & 128 ? Math.abs(Math.sin(t * 9 + r.sid)) * 0.35 : r.flags & 1 ? Math.abs(Math.sin(t * 11 + r.sid)) * 0.1 : 0;
      put(n, r.pos.x, r.pos.y + hop, r.pos.z, r.yaw, b * b * 0.6, 1);
      dress(n++, r.sid + 1, r.sid, 0);
    }
    for (let i = 0; i < ghosts.length; i++) {
      const g = ghosts[i], due = g.j < want[g.pile];
      if (g.k <= 0) {
        if (!due || (g.wait -= dt) > 0) continue;
        if (!roll(g)) { g.wait = 2; continue; }
      }
      g.t -= dt;
      g.k = Math.max(0, Math.min(1, g.k + (due && g.t > 0 ? dt : -dt) * 3));   // they grow out of the dirt and sink back into it
      if (g.k <= 0) continue;
      if ((g.ph += dt / g.per) >= 1) {
        g.ph -= 1;
        if (close[g.pile] && clods >= 2) { const bx = g.x + Math.sin(g.yaw) * 1.2, bz = g.z + Math.cos(g.yaw) * 1.2; clods -= 2; game.puff(bx, game.surface(bx, bz) + 0.3, bz, 2, 1); }
      }
      put(n, g.x, g.y + (party > 0 ? Math.abs(Math.sin(t * 9 + i)) * 0.35 : 0), g.z, g.yaw, g.ph * g.ph * 0.6, g.k * g.s);
      dress(n++, -1 - i, i, 1);
    }
    mesh.count = n; mesh.visible = n > 0;
    if (n) mesh.instanceMatrix.needsUpdate = true;
    if (held.size) place();
  }

  return { update, get figures() { return mesh.count; }, get ghosts() { return want; } };
}
