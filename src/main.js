import '@fontsource/silkscreen/latin-400.css';
import '@fontsource/silkscreen/latin-700.css';
import * as THREE from 'three';
import { CFG, randomName, validName, validCode, digMul } from './config.js';
import { snap, ps1ify, FONT } from './ps1.js';
import { model, load } from './assets.js';
import { buildWorld, worldH } from './world.js';
import { DirtField } from './dirt.js';
import { DirtGrid } from '../shared/grid.js';
import { Player } from './player.js';
import { Lobby } from './lobby.js';
import { Hud, pctText } from './hud.js';
import { Net } from './net.js';
import { Touch } from './touch.js';
import { makeBus } from './bus.js';
import { at } from './base.js';
import { buildScenery } from './scenery/index.js';
import { loadPlugins } from './plugins/index.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const SAVE = 'dig-them-out-v2';
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 1500);
const pad = (n) => String(n).padStart(2, '0');
const MILESTONES = [[0.1, 'A TENTH OF THE WAY'], [0.25, 'A QUARTER DUG'], [0.5, 'HALFWAY OUT'], [0.75, 'THREE QUARTERS: HE IS WOBBLING'], [0.9, 'NEARLY OUT']];

const game = {
  solo: q.has('solo'),   // ?solo keeps everything in this browser and never connects
  scene, camera, renderer, fields: [], giants: [], started: false, over: null, time: 0,
  bus: makeBus(), plugins: {}, sceneryMods: {},   // what happens is announced on the bus (src/EVENTS.md); add-ons in src/plugins listen
  cam: null,      // { pos: [x, y, z], look: [x, y, z], fov? } takes the camera away from the player (trailers, tests)
  shake: 0,       // metres of camera shake right now; set it with Math.max and it dies away by itself
  view: null,     // [fx, fy]: slide the picture by this fraction of the screen (fy > 0 lifts the subject toward the top)
  solids: [],     // buildings the player cannot walk into: { x0, x1, z0, z1 }
  ready: false,
  // ?deadline=<seconds> gives both men that long from now (Hakeem half of it), for testing
  deadlines: CFG.giants.map((g, i) => (q.get('deadline') ? Date.now() + Number(q.get('deadline')) * 1000 * (i ? 0.5 : 1) : Date.parse(g.deadline))),
  // What the server says about each man: 'play' (clock running), 'in' (elected: frozen) or 'out' (gone in real life,
  // so everyone's tools are supercharged until the game catches up). rate = how much each dig counts for right now.
  state: CFG.giants.map(() => 'play'), rate: CFG.giants.map(() => CFG.pace.solo), q: [], au: [], pm: [CFG.pace.min, CFG.pace.max, CFG.pace.boost], dn: [], told: [], notice: '',
  // the numbers that grow with the crowd: cubic metres everyone has dug in total, people on each pile right now, calls made to Congress
  tot: 0, dg: [], calls: 0,
  // the lobbies' dirt bomb in progress, if any: { id, i, lobby, start, hit, end } in this browser's Date.now() (see CFG.bomb);
  // bombs = how many have been dropped in all. While one is on, nobody digs: everything stops for the dirt storm.
  bomb: null, bombs: 0,
  storming() { const b = this.bomb, now = Date.now(); return !!b && now >= b.start && now < b.end; },
  // practice pile / testing: a bomb that only this browser sees (the dirtbomb add-on runs the show; this does the dirt)
  fakeBomb(i = 1, lobby = null) {
    const now = Date.now(), B = CFG.bomb, id = -now;
    this.bomb = { id, i, lobby: lobby || CFG.lobbies[this.bombs % CFG.lobbies.length].id, start: now, hit: now + B.warnSec * 1000, end: now + B.stormSec * 1000, fake: true };
    this.bombs++;
    this.bus.emit('dirtBomb', { ...this.bomb, late: false });
    setTimeout(() => { const f = this.fields[i]; if (this.bomb?.id !== id) return; const g = new DirtGrid(f.giant, i + 1); g.h.set(f.h); g.refill(f.total * B.most); f.regrow(g.toCm()); this.bus.emit('regrow', { giant: i, field: f }); }, B.warnSec * 1000);
  },
  out(i) { return this.fields[i].done || !!this.dn[i]; },   // the server has the last word on "done", and keeps it through a dropped connection: dirt never goes back up
  // buried / dug (out in time) / lost (his clock ran out first, or he was elected)
  status(i) { return this.out(i) ? 'dug' : this.state[i] === 'out' ? 'buried' : this.state[i] === 'in' || Date.now() >= this.deadlines[i] ? 'lost' : 'buried'; },
  supercharged(i) { return this.state[i] === 'out' && !this.out(i); },
  // News from the server: pace, each man's state and deadline, and every mound's health.
  world(m, first) {
    if (Array.isArray(m.rate)) this.rate = m.rate;
    if (Array.isArray(m.q)) this.q = m.q;
    if (Array.isArray(m.au)) this.au = m.au;
    if (Array.isArray(m.pm) && m.pm.length === 3) this.pm = m.pm;
    if (Array.isArray(m.dn)) this.dn = m.dn;
    if (Array.isArray(m.st)) this.state = m.st;
    if (Array.isArray(m.dl) && !q.get('deadline')) this.deadlines = m.dl;
    if (Number.isFinite(m.tot)) this.tot = m.tot;
    if (Array.isArray(m.dg)) this.dg = m.dg;
    if (Number.isFinite(m.calls)) this.calls = m.calls;
    if (Number.isFinite(m.bombs)) this.bombs = m.bombs;
    // a bomb is news once, when its id is new; the times come as "milliseconds from now" so clocks need not agree
    if (m.bomb && m.bomb.id !== this.bomb?.id && CFG.giants[m.bomb.i]) {
      const now = Date.now(), b = m.bomb;
      this.bomb = { id: b.id, i: b.i, lobby: b.lobby, hit: now + b.hit, end: now + b.end, start: now + b.hit - CFG.bomb.warnSec * 1000 };
      this.bus.emit('dirtBomb', { ...this.bomb, late: b.hit < CFG.bomb.warnSec * 1000 - 1500 });
    } else if ('bomb' in m && !m.bomb && this.bomb && !this.bomb.fake) this.bomb = null;
    this.notice = typeof m.notice === 'string' ? m.notice : '';
    if (m.mounds) this.lobby.apply(m.mounds, first);
  },
  clock(i) {
    const s = Math.max(0, Math.floor((this.deadlines[i] - Date.now()) / 1000));
    return `${Math.floor(s / 86400)}d ${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  },
  // height of whatever you would stand on at a point: dirt if there is a pile there, else lawn / terrace / roof
  surface(x, z) { for (const f of this.fields) if (f.inside(x, z)) return f.heightAt(x, z); return worldH(x, z); },
  // k < 1 is a weakened dig (status effects); the server applies the same factor. The pile itself drops by the dig
  // times the current rate, but what comes back (and counts toward your next tool) is the full-strength volume.
  digAt(x, z, r, depth, k = 1, bought = false) {
    let vol = 0;
    this.fields.forEach((f, i) => { if (f.inside(x, z) && this.status(i) === 'buried') {
      // same sum as the server: your share of the pile's allowed speed, multiplied up by your tool
      const rate = this.au[i] && this.net.online ? digMul(this.q[i] || 0, this.player.toolIndex, this.pm) : this.rate[i] || 1;
      vol += f.dig(x, z, r, depth * rate) / rate;
      if (rate < 1) f.scuff(x, z, r, depth * (1 - rate));   // the rest of the bite, for show (CFG.feel)
    } });
    if (vol > 0) { const y = this.surface(x, z); this.puff(x, y + 0.3, z, Math.min(22, 8 + r * 3), r); this.dirty = true; this.net.dig(x, z, k, bought); this.bus.emit('dig', { x, y, z, r, vol, tier: this.player.toolIndex, tool: CFG.tools[this.player.toolIndex] }); }
    return vol;
  },
  // Somebody else's bite, as seen from here: the same show (a dent, flying dirt) and none of the sums.
  remoteBite(r, tool) {
    if (this.storming()) return;
    const x = r.pos.x + Math.sin(r.yaw) * tool.reach, z = r.pos.z + Math.cos(r.yaw) * tool.reach;
    this.fields.forEach((f, i) => {
      if (!f.inside(x, z) || this.status(i) !== 'buried' || f.heightAt(x, z) - f.floorAt(x, z) < 0.2) return;
      f.scuff(x, z, tool.r, tool.depth * 0.8);
      const y = this.surface(x, z);
      if (r.avatar) this.puff(x, y + 0.3, z, Math.min(10, 4 + tool.r), tool.r);
      this.bus.emit('remoteDig', { x, y, z, tier: r.tier, tool, near: !!r.avatar });
    });
  },
  // A burst of n clods. `color` (optional) tints them: water, paper, confetti.
  puff(x, y, z, n, spread = 1, color = null) {
    for (let i = 0; i < n; i++) {
      const k = clodI++ % CLODS, c = clods[k];
      c.p.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
      c.v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 6, (Math.random() - 0.5) * 6).multiplyScalar(0.6 + spread * 0.25);
      c.sx = Math.random() * 8; c.sz = Math.random() * 8;
      c.s = (0.5 + Math.random() * 0.9) * (0.6 + spread * 0.3); c.life = 5;
      clodMesh.setColorAt(k, color == null ? BROWNS[k % 3] : clodTint.set(Array.isArray(color) ? color[k % color.length] : color));
    }
    clodMesh.instanceColor.needsUpdate = true; clodsLive = 1;
  },
  // Online, the server keeps the dirt, the mounds and your total; the browser only remembers who you are.
  save() {
    if (this.over || !this.player) return;
    const p = this.player, d = { v: 2, char: p.char, name: p.name, seen: Date.now(), pct: this.fields.map((f) => f.progress) };
    if (this.solo) { d.dug = p.dug; d.dirt = {}; d.mounds = this.lobby.save(); for (const f of this.fields) d.dirt[f.giant.id] = f.save(); }
    try { localStorage.setItem(SAVE, JSON.stringify(d)); } catch (e) { /* private window */ }
  },
};
window.__game = game;

// Flying dirt clods: one instanced mesh for all of them, each alive until it lands.
const CLODS = 180, BROWNS = [0x6f5334, 0x8a6a45, 0x4f3a24].map((c) => new THREE.Color(c));
const clodMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), ps1ify(new THREE.MeshLambertMaterial()), CLODS);
const clods = Array.from({ length: CLODS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), rx: 0, rz: 0, sx: 0, sz: 0, s: 1, life: 0 }));
const clodDummy = new THREE.Object3D(), clodTint = new THREE.Color(), NOWHERE = new THREE.Matrix4().makeScale(0, 0, 0);
let clodI = 0, clodsLive = 0;
for (let i = 0; i < CLODS; i++) { clodMesh.setMatrixAt(i, NOWHERE); clodMesh.setColorAt(i, BROWNS[i % 3]); }
clodMesh.frustumCulled = false;
scene.add(clodMesh);
function stepClods(dt) {
  if (!clodsLive) return;
  clodsLive = 0;
  for (let i = 0; i < CLODS; i++) {
    const c = clods[i];
    if (c.life <= 0) continue;
    c.v.y -= 20 * dt; c.p.addScaledVector(c.v, dt); c.rx += c.sx * dt; c.rz += c.sz * dt;
    if ((c.life -= dt) <= 0 || (c.v.y < 0 && c.p.y < game.surface(c.p.x, c.p.z))) { c.life = 0; clodMesh.setMatrixAt(i, NOWHERE); continue; }
    clodDummy.position.copy(c.p); clodDummy.rotation.set(c.rx, 0, c.rz); clodDummy.scale.setScalar(c.s); clodDummy.updateMatrix();
    clodMesh.setMatrixAt(i, clodDummy.matrix); clodsLive++;
  }
  clodMesh.instanceMatrix.needsUpdate = true;
}

let saved = null;
try { saved = JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch (e) { /* ignore */ }
if (saved && (saved.v !== 2 || Array.isArray(saved.mounds))) saved = null;   // older practice saves do not fit
game.lastVisit = saved && saved.seen ? { seen: saved.seen, pct: saved.pct || [] } : null;   // for a welcome back

// Start every download now, all at once; the awaits further down find them already on their way.
const roster = CFG.people.slice();
let who = roster.indexOf(saved?.char);
if (who < 0) who = Math.floor(Math.random() * roster.length);
const bustUrl = (id) => `/models/world/${id}.glb?v=2`;   // v: raise it whenever tools/models/busts.py output changes (the files are cached for a day under the same name)
for (const f of ['world/capitol', 'world/lobby_mound', 'world/briefcase', 'tools/shovel']) load(`/models/${f}.glb`);
for (const g of CFG.giants) load(bustUrl(g.id));
load(`/models/${roster[who]}.glb`, { alpha: true });
// signs are drawn with these; a font that stalls is not worth waiting more than a few seconds for
const fontsReady = Promise.race([Promise.all(['20px "Rubik Dirt"', '20px Silkscreen', 'bold 20px Silkscreen'].map((f) => document.fonts.load(f))).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
const LOADING = ['trucking in 54,000 cubic metres of dirt...', 'burying the leadership...', 'briefing the lobbyists...', 'sharpening one (1) shovel...', 'asking them nicely one last time...'];
let loadI = 0;
const loadTimer = setInterval(() => { $('loading').textContent = LOADING[loadI++ % LOADING.length]; }, 900);

function resize() {
  // 300 pixels along the short side: a phone held upright gets as many pixels as a desktop (?rh= forces an exact height)
  const w = innerWidth, h = innerHeight, tall = w < h;
  const rh = Math.max(120, Math.min(1080, Number(q.get('rh')) || (tall ? Math.round(300 * h / w) : 300))), rw = Math.round(rh * w / h);
  renderer.setSize(rw, rh, false);
  camera.aspect = w / h;
  camera.fov = game.cam?.fov || (tall ? 72 : 55);   // upright screens see a wider slice, or the two men never fit
  // on the start screen the panel takes the left (or, on a narrow screen, the bottom), so slide the view over to keep you in the clear
  if (game.view) camera.setViewOffset(rw, rh, Math.round(rw * game.view[0]), Math.round(rh * game.view[1]), rw, rh);
  else if (game.started) camera.clearViewOffset(); else if (w < 700) camera.setViewOffset(rw, rh, 0, Math.round(rh * 0.24), rw, rh); else camera.setViewOffset(rw, rh, -Math.round(rw * 0.2), 0, rw, rh);
  camera.updateProjectionMatrix();
  snap.value.set(rw / 2, rh / 2);
}
addEventListener('resize', resize); resize();
game.resize = resize;

// ---- input
const keys = {}; let mouseDig = false, rightDrag = false;
// Is the keyboard busy somewhere else: a field of ours, or one inside mann.cool's shell (its panels live in a shadow
// tree, which document.activeElement does not look into), or the shell's own menu or a panel of its being open.
const typing = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return (!!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) || shellBusy(); };
const clearInput = () => { for (const k in keys) keys[k] = false; mouseDig = false; rightDrag = false; touch.clear(); };
const lock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch (e) { /* not allowed here */ } };
game.lock = lock; game.clearInput = clearInput; game.typing = typing;
addEventListener('keydown', (e) => {
  if (typing()) return;
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyE' && !e.repeat && game.started && game.player?.dead <= 0) { game.player.avatar.cheer(2.5); game.bus.emit('cheer', { x: game.player.pos.x, y: game.player.pos.y, z: game.player.pos.z, self: true }); }   // E: throw your arms up; everyone near you sees it
  if (q.has('debug')) debugKey(e.code);
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'MetaLeft' || e.code === 'MetaRight') clearInput(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const touch = game.touch = new Touch(canvas, game);

// ---- mann.cool's shell. Under mann.cool/leave/ the site lays its own controls over the game: the way back to
// mann.cool at the top left, tip and menu buttons at the top right (worker/index.js adds its script to the page). The
// stylesheets move the HUD out from under them, on seeing its <mann-cool-game-shell> element; this is the rest: where
// its buttons are, for whatever places itself by sums, and who has the keyboard. On the game's own address there is
// no shell and none of this ever runs.
let shellRoot = null, shellBoxes = [];
game.shellRects = () => shellBoxes;   // its buttons (and its menu while open) as screen boxes, hard shadows included
function shellBusy() { return !!shellRoot && !!(shellRoot.querySelector('.backdrop:not([hidden])') || (shellRoot.activeElement && shellRoot.querySelector('.menu:not([hidden])'))); }
customElements.whenDefined('mann-cool-game-shell').then(() => {
  const root = document.querySelector('mann-cool-game-shell')?.shadowRoot;
  if (!root) return;
  shellRoot = root;
  const measure = () => {
    shellBoxes = [];
    for (const [sel, shadow] of [['.home', 4], ['.action', 4], ['.menu', 6]]) for (const el of root.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) shellBoxes.push({ left: r.left, top: r.top, right: r.right + shadow, bottom: r.bottom + shadow });
    }
    const home = root.querySelector('.home')?.getBoundingClientRect();
    if (home?.width) document.documentElement.style.setProperty('--mc-home', Math.ceil(home.right) + 12 + 'px');   // where MENU and SOUND start when they sit beside it (a phone on its side)
  };
  let wasOpen = false;
  const changed = () => {
    measure();
    const open = !!root.querySelector('.menu:not([hidden]), .backdrop:not([hidden])');
    if (open && !wasOpen) clearInput();   // nothing stays held down under its menu
    if (!open && wasOpen) root.activeElement?.blur();   // put away again: the keyboard is the game's, and Space does not press its button
    wasOpen = open;
  };
  new MutationObserver(changed).observe(root, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  const sized = new ResizeObserver(measure);
  for (const el of root.querySelectorAll('.home, .actions')) sized.observe(el);
  addEventListener('resize', measure);
  // a press on the game, or on any button of the game's, puts its menu away (a press on the shell itself arrives here as a press on its element)
  addEventListener('pointerdown', (e) => { if (e.target !== root.host) root.querySelector('.menu-button[aria-expanded="true"]')?.click(); }, true);
  changed();
});
// a second mouse button pressed while one is held arrives as a move, not a press, so listen to both
const mouseDown = (e) => { if (e.pointerType !== 'mouse' || !game.started || (game.over && !game.looking) || e.button !== 0 || !(e.buttons & 1)) return; game.net?.reclaim(); if (document.pointerLockElement !== canvas) lock(); mouseDig = true; };
canvas.addEventListener('pointerdown', mouseDown); canvas.addEventListener('pointermove', mouseDown);
addEventListener('mousedown', (e) => { if (e.button === 2) rightDrag = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDig = false; if (e.button === 2) rightDrag = false; });
addEventListener('blur', clearInput);
// A tab left in the background gives its seat up after half a minute and takes one again when you come back.
let hideT = 0;
document.addEventListener('visibilitychange', () => {
  clearTimeout(hideT);
  if (document.hidden) { clearInput(); hideT = setTimeout(() => game.net?.sleep(), 30000); } else game.net?.wake();
});
addEventListener('pagehide', () => { if (game.started) game.save(); });
// Esc frees the mouse; say how to get it back
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && game.started && !game.over && game.player?.fx.tos <= 0 && $('start').hidden && !document.querySelector('.modal-open')) game.hud?.toast('CLICK THE GAME TO LOOK AROUND', 2.5, 0); });
addEventListener('mousemove', (e) => {
  if ((document.pointerLockElement !== canvas && !rightDrag) || !game.player) return;   // right-drag looks around when the pointer cannot be captured
  game.player.camYaw -= e.movementX * 0.003;
  game.player.camPitch = Math.max(-0.2, Math.min(1.3, game.player.camPitch + e.movementY * 0.003));
});
function debugKey(code) {
  const p = game.player;
  if (code === 'KeyG') { const n = CFG.tools[p.tier + 1]; if (n) p.credit(n.need - p.dug); }
  if (code === 'KeyK') game.lobby.strike(p.pos.x, p.pos.z, 9999, 9999);
  if (code === 'KeyM') { const m = game.lobby.mounds.find((o) => o.hp <= 0); if (m) game.lobby.set(m, CFG.lobby.moundHp, false); }
  if (code === 'KeyJ') for (const f of game.fields) { f.dig(f.giant.x, f.giant.z, 60, 9); }
}

// ---- build everything
const hud = game.hud = new Hud(game);
const net = game.net = new Net(game);
await buildWorld(scene);
let scenery = null;
const sceneryDone = buildScenery(game).then((s) => { scenery = s; });   // dressing arrives when it is ready; the game does not wait for it
// Over a man, a pile's floor is where the server lets you stand on him (shared/grid.js: a cylinder for the head, an
// ellipse for the shoulders), and both are wider than he is. The pile draws a bare cell just under its floor, which
// over him made a brown lid with skirts round his head, neck and chest. Those cells are drawn just under the dirt next
// to them instead, or at the ground once none is left there, so the sheet runs on through him out of sight.
// Only what is drawn changes: where you can stand is untouched.
function tuckUnderGiant(f) {
  const n = f.n, over = [], ground = [], draw = f.refresh;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const k = j * n + i, w = worldH(f.x0 + i * f.cell, f.z0 + j * f.cell);
    if (f.floor[k] > w + 1) { over.push(k); ground.push(w - 0.4); }
  }
  const near = [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1];
  f.refresh = function () {
    draw.call(this);
    const p = this.mesh.geometry.attributes.position; let any = false;
    for (let a = 0; a < over.length; a++) {
      const k = over[a];
      if (this.h[k] - this.floor[k] >= 0.05) continue;
      let y = Infinity;
      for (const d of near) if (this.h[k + d] - this.floor[k + d] >= 0.05) y = Math.min(y, this.top(k + d) - 0.3);
      p.setY(k, y === Infinity ? ground[a] : Math.min(y, this.floor[k] - 0.4)); any = true;
    }
    if (any) this.mesh.geometry.computeVertexNormals();
  };
  f.refresh();
}
CFG.giants.forEach((g, i) => { const f = new DirtField(g, i + 1); tuckUnderGiant(f); if (game.solo && saved?.dirt) f.restore(saved.dirt[g.id]); f.shown = f.progress; game.fields.push(f); scene.add(f.mesh); });
for (const [i, g] of CFG.giants.entries()) {
  const m = await model(bustUrl(g.id));
  let root;
  if (m) root = m.root;
  else { root = new THREE.Mesh(new THREE.BoxGeometry(22, CFG.giant.height, 9), ps1ify(new THREE.MeshLambertMaterial({ color: 0x223355 }))); root.geometry.translate(0, CFG.giant.height / 2, 0); }
  root.position.set(g.x, CFG.giant.baseY, g.z);
  scene.add(root);
  // his own sign, floating over his head: name, how far out he is, and his clock
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false }));
  sign.scale.set(36, 13.5, 1); sign.position.set(g.x, CFG.giant.baseY + CFG.giant.height + 11, g.z);
  scene.add(sign);
  const gi = { cfg: g, root, head: root.getObjectByName('Head'), sign, cv, tex, last: '' };
  game.giants.push(gi);
  portrait(gi, hud.face(g.id));
}
// His face for the HUD, photographed off the real model so it changes when the model does.
function portrait(gi, cv) {
  const S = cv.width, rt = new THREE.WebGLRenderTarget(S, S), tmp = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 1, 400);
  gi.root.updateMatrixWorld(true);
  const parent = gi.root.parent, box = new THREE.Box3().setFromObject(gi.head || gi.root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  if (!gi.head) { c.y = box.max.y - 5; size.set(9, 9, 9); }
  tmp.background = new THREE.Color(0x4f7fb5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.5, 0.6, 1);
  tmp.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.5), sun, gi.root);
  cam.position.set(c.x, c.y + size.y * 0.05, c.z + size.z / 2 + Math.max(size.x, size.y) * 0.62 / Math.tan(15 * Math.PI / 180));
  cam.lookAt(c);
  const keep = snap.value.clone(), px = new Uint8Array(S * S * 4);
  snap.value.set(S / 2, S / 2);
  renderer.setRenderTarget(rt); renderer.render(tmp, cam); renderer.readRenderTargetPixels(rt, 0, 0, S, S, px); renderer.setRenderTarget(null);
  snap.value.copy(keep); parent.add(gi.root); rt.dispose();
  const x = cv.getContext('2d'), img = x.createImageData(S, S);
  for (let row = 0; row < S; row++) for (let k = 0; k < S * 4; k++) {   // flip upright, and from linear light to screen colour
    const v = px[(S - 1 - row) * S * 4 + k];
    img.data[row * S * 4 + k] = k % 4 === 3 ? 255 : Math.round(255 * Math.pow(v / 255, 1 / 2.2));
  }
  x.putImageData(img, 0, 0);
}
function drawSigns() {
  game.giants.forEach((gi, i) => {
    const st = game.status(i), pct = Math.min(100, game.fields[i].progress / CFG.dirt.doneAt * 100);
    const text = st === 'dug' ? 'DUG OUT' : st === 'lost' ? 'TOO LATE' : game.supercharged(i) ? "HE'S OUT! DIG!" : game.clock(i);
    // the last day runs red, the last hour flashes
    const left = game.deadlines[i] - Date.now(), hot = st === 'buried' && !game.supercharged(i) && left < 86400e3, flash = hot && left < 3600e3 && Math.floor(game.time * 2) % 2 === 0;
    const key = text + pctText(pct) + hot + flash;
    if (key === gi.last) return;
    gi.last = key;
    const c = gi.cv.getContext('2d'), W = 256, col = st === 'dug' ? '#5fd07a' : st === 'lost' ? '#ff5a4f' : flash ? '#ffffff' : hot ? '#ff5a4f' : '#ffc21a';
    c.clearRect(0, 0, W, 96);
    c.fillStyle = '#14110d'; c.fillRect(0, 0, W, 96);
    c.fillStyle = col; c.fillRect(0, 0, W, 4); c.fillRect(0, 92, W, 4);
    c.textBaseline = 'middle';
    c.fillStyle = '#ead9b0'; c.font = `24px ${FONT.big}`; c.textAlign = 'left'; c.fillText(gi.cfg.name, 12, 20);
    c.fillStyle = col; c.font = `bold 16px ${FONT.px}`; c.textAlign = 'right'; c.fillText(st === 'dug' ? '100%' : pctText(pct), W - 12, 20);
    // the bar: hazard stripes for what has been dug away
    c.fillStyle = '#ead9b0'; c.fillRect(10, 34, W - 20, 16);
    c.fillStyle = '#3a2a18'; c.fillRect(12, 36, W - 24, 12);
    const fill = Math.round((W - 24) * pct / 100);
    if (fill > 0) {
      c.save(); c.beginPath(); c.rect(12, 36, Math.max(2, fill), 12); c.clip();
      c.fillStyle = col; c.fillRect(12, 36, W, 12);
      c.fillStyle = '#14110d'; for (let x = 0; x < W + 20; x += 12) { c.beginPath(); c.moveTo(x, 36); c.lineTo(x + 5, 36); c.lineTo(x - 7, 48); c.lineTo(x - 12, 48); c.fill(); }
      c.restore();
    }
    let px = 28;
    do { c.font = `bold ${px}px ${FONT.px}`; } while (c.measureText(text).width > W - 16 && (px -= 2) > 14);
    c.fillStyle = col; c.textAlign = 'center'; c.fillText(text, W / 2, 72);
    gi.tex.needsUpdate = true;
  });
}
await fontsReady;
const lobby = game.lobby = new Lobby(game);
await lobby.build(game.solo ? saved?.mounds : null);
const player = game.player = new Player(game);
const plugins = await loadPlugins(game);

// ---- start screen: who you are
if (game.solo && saved?.dug) { player.dug = saved.dug; player.checkTier(); hud.toast('', 0); }
{ let t = player.toolIndex; while (CFG.tools[t].kind !== 'hand') t--; player.avatar.setTier(t); }   // the start screen shows you on foot, tool in hand
player.camPitch = 0.1;
const setName = (n) => { player.name = n; $('name').textContent = n; player.refreshTag(); };
const pick = async (i) => { who = (i + roster.length) % roster.length; $('who').textContent = `${who + 1} of ${roster.length}`; await player.setCharacter(roster[who]); };
setName(validName(saved?.name) ? saved.name : randomName());
await pick(who);
$('prev').onclick = () => { net.chose = true; pick(who - 1); };
$('nextchar').onclick = () => { net.chose = true; pick(who + 1); };
$('rand').onclick = () => { net.chose = true; pick(Math.floor(Math.random() * roster.length)); };
$('rename').onclick = () => { net.chose = true; setName(randomName()); };
$('reset').onclick = () => { if (!confirm('Forget your code and your progress on this device?')) return; localStorage.removeItem(SAVE); localStorage.removeItem('dig-them-out-code'); location.reload(); };
const fmtCode = (c) => (c ? c.match(/.{1,4}/g).join('-') : '');
const showCode = () => { $('codeline').hidden = !net.code || q.has('capture'); $('code').textContent = fmtCode(net.code); };   // the code is a key to your progress: never in a recording
game.onIdentity = () => { showCode(); who = Math.max(0, roster.indexOf(player.char)); $('who').textContent = `${who + 1} of ${roster.length}`; $('name').textContent = player.name; };
$('usecode').onclick = () => {
  const c = $('codein').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!validCode(c)) { $('loading').textContent = 'that does not look like a code (12 characters, never I, L, O, 0 or 1)'; return; }
  // nothing is replaced until the server confirms that code exists
  net.pendingCode = c; net.chose = false; $('loading').textContent = game.started ? 'press KEEP DIGGING to load that code' : 'press START to load that code';
};
showCode();
$('copycode').onclick = () => navigator.clipboard?.writeText(fmtCode(net.code)).then(() => { $('copycode').textContent = 'copied'; }).catch(() => {});
// Pass it on: the phone's own share sheet where there is one, the clipboard otherwise.
const share = (btn) => {
  const url = location.origin + location.pathname, text = player.dug >= 1 ? `I have dug ${Math.floor(player.dug).toLocaleString()} cubic metres to get Chuck and Hakeem out. Grab a shovel.` : 'Chuck and Hakeem are buried at the Capitol and will not leave. Grab a shovel.';
  if (navigator.share) navigator.share({ title: document.title, text, url }).catch(() => {});
  else navigator.clipboard?.writeText(`${text} ${url}`).then(() => { btn.textContent = 'link copied'; }).catch(() => {});
};
game.share = share;
$('sharestart').onclick = () => share($('sharestart'));
$('shareend').onclick = () => share($('shareend'));
$('lookaround').onclick = () => { $('end').hidden = true; game.looking = true; lock(); };   // the dig is settled, but you may still walk the grounds
$('menubtn').onclick = () => { document.exitPointerLock?.(); clearInput(); $('play').textContent = 'Keep digging'; $('start').hidden = false; };
// the server's word on each man, before the socket is even open (the start screen no longer prints it)
const crowdLine = () => fetch(at('/api/status')).then((r) => r.json()).then((s) => {
  if (!(s.online >= 0)) return;
  // the server's word on each man, before the socket is even open, so the placard never shows a clock for someone already out
  if (Array.isArray(s.giants) && s.giants.length === CFG.giants.length && !game.net.everOnline) { game.dn = s.giants.map((x) => !!x.done); game.state = s.giants.map((x) => x.state); if (!q.get('deadline')) game.deadlines = s.giants.map((x) => Date.parse(x.deadline)); }
}).catch(() => {});
if (!game.solo) { crowdLine(); const iv = setInterval(() => (game.started ? clearInterval(iv) : crowdLine()), 10000); }
clearInterval(loadTimer);
$('loading').textContent = '';
$('play').disabled = false; $('play').textContent = 'Start digging';
$('play').onclick = () => {
  if (game.started) {   // back from the menu: a typed code, or a new look or name, takes effect now
    $('start').hidden = true; $('loading').textContent = ''; lock();
    if (!game.solo && (net.pendingCode || net.chose)) net.redial();
    return;
  }
  game.started = true; $('start').hidden = true; $('hud').hidden = false; resize();
  // newcomers do not all stand on one spot, and you start out facing the man whose clock runs out first
  player.pos.x += (Math.random() - 0.5) * 30; player.pos.z += (Math.random() - 0.5) * 10;
  const open = CFG.giants.map((g, i) => i).filter((i) => game.status(i) === 'buried').sort((a, b) => game.deadlines[a] - game.deadlines[b])[0] ?? 1, to = CFG.giants[open];
  player.camYaw = player.yaw = Math.atan2(to.x - player.pos.x, to.z - player.pos.z); player.camPitch = innerWidth > innerHeight ? -0.08 : 0.12;   // low enough that his head and clock are in the first frame
  game.save(); if (!game.solo) net.connect(); lock(); game.bus.emit('start');
};
if (q.has('autostart')) $('play').onclick();

function finish() {
  const st = game.giants.map((_, i) => game.status(i)), out = st.filter((s) => s === 'dug').length;
  const won = out === st.length && lobby.moundsLeft === 0;
  game.over = won ? 'won' : 'lost';
  for (const k in player.fx) player.fx[k] = 0;
  player.deductible = 0;
  document.exitPointerLock?.();
  $('end').hidden = false;
  $('endstat').textContent = `You moved ${Math.floor(player.dug).toLocaleString()} cubic metres, finishing on the ${player.toolCfg.name.toLowerCase()}.`;
  $('endtitle').textContent = won ? 'DUG OUT' : out ? 'ONE OUT, ONE IN' : 'TOO LATE';
  $('endtext').textContent = won ? 'Every mound is gone and both of them are out. New leadership it is.'
    : out ? `${CFG.giants[st.indexOf('dug')].name} was dug out in time. ${CFG.giants[st.indexOf('lost')]?.name || 'The lobbies'} held on.`
      : 'Time ran out. They are still stuck in there, and now it is official.';
  if (won) localStorage.removeItem(SAVE);
  game.bus.emit('over', { won, out, status: st });
}
// The switch can reopen a man after "too late" was called (his date moved, or he is out in real life).
function resume() { game.over = null; game.looking = false; $('end').hidden = true; }

// ---- loop
const clock = new THREE.Clock();
let saveT = 0, slowT = 0, clockT = 0;
function frame(dt) {
  game.time += dt;
  if (game.started && (!game.over || game.looking)) {
    const input = game.testInput || { x: (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) + touch.x, z: (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.z,
      run: keys.ShiftLeft || keys.ShiftRight || touch.run, dig: keys.Space || mouseDig || touch.dig };
    player.update(dt, input);
    if (!game.storming()) lobby.update(dt);   // in a dirt storm even the lobbyists stop to watch
    if ((saveT += dt) > 10) { saveT = 0; if (game.dirty) { game.dirty = false; game.save(); } }
    if ((slowT += dt) > 0.5) {
      slowT = 0;
      // shared milestones, so the whole crowd sees the pile going down
      game.fields.forEach((f) => { for (const [at, msg] of MILESTONES) if (f.shown < at && f.progress >= at) { hud.toast(`${f.giant.name}: ${msg}`, 4); game.bus.emit('milestone', { giant: f.giant, at, msg }); } f.shown = f.progress; });
      game.giants.forEach((gi, i) => { const sup = game.supercharged(i); if (sup && !game.told[i]) hud.toast(`${gi.cfg.name} IS OUT IN REAL LIFE\nsupercharged tools: finish the job`, 6); game.told[i] = sup; });
      const st = game.giants.map((_, i) => game.status(i));
      game.giants.forEach((gi, i) => {
        // the moment one of them comes out, or his clock runs out, is the biggest thing that happens here: say so
        const name = gi.cfg.name, other = game.giants[1 - i], left = (game.deadlines[i] - Date.now()) / 1000;
        if (gi.was && st[i] !== gi.was) {
          if (st[i] === 'dug') {
            hud.toast(`${name} IS OUT\nthe country dug him out`, 8, 4);
            for (let k = 0; k < 6; k++) game.puff(gi.cfg.x + Math.cos(k) * 16, game.surface(gi.cfg.x, gi.cfg.z + 20) + 2, gi.cfg.z + 14 + Math.sin(k) * 10, 20, 6);
            game.shake = Math.max(game.shake, 1.2); player.avatar.cheer(4);
          } else if (st[i] === 'lost') hud.toast(`TOO LATE: ${name} IS IN` + (other && game.status(1 - i) === 'buried' ? `\n${other.cfg.name} is still buried. keep digging.` : ''), 8, 4);
          game.bus.emit('giant', { i, giant: gi.cfg, status: st[i], was: gi.was });
        } else if (!gi.was && st[i] === 'dug') gi.root.visible = false;   // he was already gone when you arrived
        if (st[i] === 'buried' && !game.supercharged(i)) for (const [secs, word] of [[86400, '24 HOURS'], [3600, 'ONE HOUR'], [600, 'TEN MINUTES']]) {
          if (gi.left > secs && left <= secs) { hud.toast(`${name}: ${word} LEFT\ncall someone`, 6, 2); game.bus.emit('clock', { i, giant: gi.cfg, secs }); }
        }
        gi.was = st[i]; gi.left = left;
      });
      // over when nobody is left to dig for: all out and the mounds gone, or every clock has been settled
      if (!game.over && (st.every((s) => s === 'dug') ? lobby.moundsLeft === 0 : st.every((s) => s !== 'buried'))) finish();
    }
  } else if (player.body) { player.avatar.update(dt, { pos: player.pos, yaw: player.yaw, moving: false, digging: false, speed: 0, far: 5 }); if (!game.started) player.camYaw += dt * 0.25; }
  if ((clockT += dt) > 0.5) { clockT = 0; drawSigns(); if (game.over === 'lost' && game.giants.some((_, i) => game.status(i) === 'buried')) resume(); }
  net.update(dt);
  for (const f of game.fields) { f.growStep(dt); f.slump(dt); f.refreshIfStale(); }
  stepClods(dt);
  for (const g of game.giants) {
    if (g.head) g.head.rotation.y = Math.sin(game.time * 0.35 + g.cfg.x) * 0.35 + (g.turn || 0);   // g.turn / g.nod: add-ons make him look round or flinch
    if (g.head) g.head.rotation.x = g.nod || 0;
    // a man who has been dug out floats off like a parade balloon
    if (g.was === 'dug' && g.root.visible) { g.root.position.y += dt * (g.root.position.y < CFG.giant.baseY + 28 ? 2.5 : 9); g.root.rotation.y += dt * 0.8; if (g.root.position.y > 420) g.root.visible = false; }   // slowly at first, so you can turn and look
  }
  if (player.body) { if (!game.started) player.pos.y = game.surface(player.pos.x, player.pos.z); player.placeCamera(camera, game.started ? 0 : 5.2); }
  scenery?.update(dt);
  plugins.update(dt);
  if (game.cam) { const c = game.cam; camera.position.set(c.pos[0], c.pos[1], c.pos[2]); camera.lookAt(c.look[0], c.look[1], c.look[2]); if (c.fov && c.fov !== camera.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); } }
  camera.updateMatrixWorld();   // so anything pinned to the world this frame (bubbles, pops, labels) is projected with the camera as it is now
  if (game.shake > 0.002) { const k = game.shake; camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k; camera.position.z += (Math.random() - 0.5) * k; game.shake *= Math.max(0, 1 - dt * 9); } else game.shake = 0;
  hud.update(dt);
  renderer.render(scene, camera);
}
game.frame = frame;   // tests can drive time by hand: game.testInput = {...}; game.frame(1 / 30)
drawSigns();
// ?capture: nothing moves unless a script calls game.frame(dt), so a recording can be stepped one exact frame at a time
// Never more than 60 frames a second (a 120 Hz phone would do twice the work for nothing), and a slow phone digs at the same speed as a fast one.
let lastT = 0;
if (!q.has('capture')) renderer.setAnimationLoop((t) => { if (t - lastT < 14) return; lastT = t; frame(Math.min(0.1, clock.getDelta())); });
sceneryDone.then(() => { game.ready = true; });
