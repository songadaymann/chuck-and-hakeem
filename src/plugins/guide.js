import './guide.css';
import { CFG } from '../config.js';

// The guide: tells a first-time visitor what to do next, one small line at a time, and points from the edge of the
// screen at whatever is out of sight (the dirt, the lobby nests). It only listens and reads. Each lesson shows once
// per device and ends on the real event, so somebody who already knows is never told twice.

// ====================================================================================================================
// EVERY WORD THE GUIDE SAYS. Edit the wording here and nowhere else.
// A pair [phone, keyboard] where the two differ. {d} metres, {n} a number, {s} seconds, {tool} {name} {other} names.
// A chip is [big line, small line]: on an upright phone about 36 and 46 characters fit before a line wraps.
// A toast is one string with "\n" between its two lines: about 32 characters a line on that phone.
// ====================================================================================================================
const COPY = {
  // ---- the first minute (chips)
  go: ['RUN TO THE DIRT: {d}\u00a0m', ['left thumb moves you. push it far to run', 'W A S D moves · SHIFT runs · mouse looks']],
  dig: [['HOLD DIG', 'HOLD SPACE OR CLICK'], 'keep it held. it is a large pile'],
  bite: ['IT SLUMPS BACK. EVERY BITE COUNTS', 'the pile is paced to last. watch the % climb'],
  biteSolid: ['EVERY BITE COUNTS', 'watch the % under his face'],
  tool: ['{n} m³ TO THE {tool}', 'the striped bar is your next tool'],
  // ---- lobbyists, nests, machines (chips)
  swat: [['LOBBYIST. HOLD DIG TO SWAT', 'LOBBYIST. HOLD SPACE TO SWAT'], 'let them walk up. a shovel takes two swats'],
  nest: ['FOLLOW THE BEACON', 'they keep coming until the nest is dug flat'],
  vehicle: ['IT TURNS, THEN IT GOES', ['aim the stick. it does not stop for lobbyists', 'W A S D aims it. it does not stop for lobbyists']],
  dead: ['THE RED BAR RAN OUT', 'back in a moment. swat them sooner'],
  // ---- the first time each lobby's effect lands on you (chips)
  fx: {
    hasbara: ['TALKING POINTS: HALF STRENGTH', 'it wears off in {s} seconds. they do not'],
    deductible: ['DEDUCTIBLE: NEXT {n} BITES ARE DENIED', 'keep swinging. coverage resumes after that'],
    pricehike: ['PRICE HIKE: YOUR RED BAR DRAINS', 'for {s} seconds. there is no generic'],
    slick: ['OIL: YOU SKATE FOR {s} SECONDS', 'steer gently. the lawn will not recover'],
    buyout: ['BUYOUT: ONE TOOL DOWN', 'back in {s} seconds. they call that a recovery'],
    buyoutShovel: ['BUYOUT: HALF A SHOVEL', 'back in {s} seconds. they call that a recovery'],
    tos: [['TERMS UPDATED: TAP I AGREE', 'TERMS UPDATED: CLICK I AGREE'], 'no digging until you do. nobody has read them'],
  },
  // ---- digging where there is nothing to dig (toasts)
  far: 'NO DIRT HERE\nit is all on {other}, {d} m away',
  near: 'NOTHING TO DIG RIGHT HERE\nthe dirt starts a few steps on',
  nearBack: 'THE BACKHOE DIGS BEHIND IT\nturn round and back up to the dirt',
  out: '{name} IS ALREADY OUT\n{other} is still buried: {d} m',
  late: 'TOO LATE FOR {name}\n{other} is still buried: {d} m',
  nests: 'THEY ARE BOTH OUT\nthe nests are not. find a beacon',
  // ---- the connection, said out loud (toasts)
  wait: 'CONNECTING TO THE SHARED DIG\nkeep walking: it will catch up',
  in: 'YOU ARE IN\n{n} digging right now',
  inAlone: 'YOU ARE IN\nyou are first. someone has to be',
  full: 'THE DIG IS FULL\nwarm up here until a spot opens',
  seat: 'A SPOT OPENED: YOU ARE IN\nfrom here on it counts',
  lost: 'CONNECTION LOST\nno dig counts until it is back',
  back: 'BACK IN THE DIG\nyour digs count again',
  dozed: ['YOU DOZED OFF\ntap to rejoin the dig', 'YOU DOZED OFF\nclick the game to rejoin the dig'],
  moved: ['THIS DIG MOVED TO ANOTHER WINDOW\ntap to play in this one', 'THIS DIG MOVED TO ANOTHER WINDOW\nclick the game to play in this one'],
  // ---- arrow labels
  dirtTag: 'DIRT', hereTag: 'DIG HERE', nestTag: 'NEST', metres: '{d} m',
};
// ====================================================================================================================

const KEY = 'chuck-hakeem-guide';
const TICK = 0.25;      // seconds between looks at how things stand
const NEAR = 25;        // metres: with no dirt nearer than this, the pile gets an arrow
const STICK = 20;       // metres: the other pile must be this much nearer before the arrow changes its mind
const SEES = 16;        // metres: a lobbyist this close is worth a word
const BOX = 26, EDGE = 30, PAD = 6, SLIDE = 96, CLEAR = 110;   // pixels: half an arrow's box, how far in from the screen edge it sits, room left round the rest of the HUD, how far it may slide along the edge, how close to you it may come
const PANELS = '#start:not([hidden]), #end:not([hidden]), #reps:not([hidden]), .modal-open, [aria-modal="true"]:not([hidden])';
const ARROW = '<svg viewBox="0 0 24 24" shape-rendering="crispEdges"><path d="M12 1 22 22 12 17 2 22Z"/></svg><span></span>';
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const tint = (lobby) => (lobby.color === '#222222' ? '#777' : lobby.color);

export function init(game) {
  const hud = document.getElementById('hud'), timer = document.getElementById('timer'), p = game.player, net = game.net, lobby = game.lobby, bus = game.bus, G = CFG.giants;
  const phone = () => document.body.classList.contains('touch');
  const pick = (c) => (Array.isArray(c) ? c[phone() ? 0 : 1] : c);
  // The big line. Something bigger already up there wins and ours is dropped without a word, so this says whether it was shown.
  let heard = false;
  bus.on('toast', () => { heard = true; });
  const toast = (c, v, secs = 4, pri = 1) => { heard = false; game.hud.toast(fill(pick(c), v || {}), secs, pri); return heard; };

  // ---- which lessons this device has had
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* private window */ }
  if (!game.lastVisit || typeof seen !== 'object') seen = {};   // nothing saved here: a first visit, or "start over"
  const mark = (id) => { if (seen[id]) return; seen[id] = 1; try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { /* private window */ } };
  const fresh = !seen.bite;   // the count-down to the first tool is for the visit in which you learn to dig, not for coming back

  // ---- the chip: the step you are on, or for a few seconds a lesson that just came up
  const chip = el('div'), card = el('div'), big = el('b'), small = el('small'), arrows = el('div');
  chip.id = 'guidechip'; chip.hidden = true; card.append(big, small); chip.append(card); arrows.id = 'guidearrows';
  hud.append(arrows, chip);
  const vars = { d: 0, n: 0, tool: '' };
  let flash = null, step = '', shown = '', panel = false, toolT = 0;
  const teach = (id, c, secs, v, color) => { flash = { id, c, v: v || vars, t: secs, color }; };
  function drawChip() {
    const cur = flash || (step ? { id: step, c: COPY[step], v: vars } : null), on = !!cur && game.started && !game.over && !panel && !game.cam;
    if (chip.hidden === on) chip.hidden = !on;
    if (!on) { shown = ''; return; }
    const a = fill(pick(cur.c[0]), cur.v), b = cur.id === 'tool' && toolT > 15 ? '' : fill(pick(cur.c[1]), cur.v);   // the count-down slims to one line once it has been read
    if (big.textContent !== a) big.textContent = a;
    if (small.textContent !== b) small.textContent = b;
    if (cur.id === shown) return;
    shown = cur.id;
    if (cur.color) card.style.setProperty('--c', cur.color); else card.style.removeProperty('--c');
    chip.classList.remove('in'); void chip.offsetWidth; chip.classList.add('in');
  }

  // ---- where the dirt is: the nearest spot that still has some, on a pile whose man can still be dug out.
  // A coarse look (every 5 m; every 2 m once he is nearly out) at one pile per tick.
  const found = game.fields.map((f, i) => ({ i, x: 0, z: 0, d: 0, ok: false }));
  const thick = (f, x, z) => f.heightAt(x, z) - f.floorAt(x, z) > 0.12;
  let scanI = 0, dirt = null, goal = -1;
  function scan(i) {
    const f = game.fields[i], o = found[i], S = CFG.dirt.size, N = f.progress > 0.85 ? 32 : 12;
    o.ok = false;
    if (game.status(i) !== 'buried') return;
    let best = Infinity;
    for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
      const x = f.giant.x - S / 2 + S * a / N, z = f.giant.z - S / 2 + S * b / N, d = Math.hypot(x - p.pos.x, z - p.pos.z);
      if (d < best && thick(f, x, z)) { best = d; o.x = x; o.z = z; o.ok = true; }
    }
  }
  // standing on it, or it is under where the tool comes down
  function onDirt() {
    const t = p.toolCfg, bx = p.pos.x + Math.sin(p.yaw) * t.reach, bz = p.pos.z + Math.cos(p.yaw) * t.reach;
    return game.fields.some((f, i) => game.status(i) === 'buried' && ((f.inside(p.pos.x, p.pos.z) && thick(f, p.pos.x, p.pos.z)) || (f.inside(bx, bz) && thick(f, bx, bz))));
  }

  // ---- lessons that hang on something happening
  let digs = 0, lastDig = -99, miss = null, missAt = -999, missGap = 6, nudge = 0, swatT = 0, nestT = 0, began = false;
  const nestHint = (l) => { mark('nest'); teach('nest', COPY.nest, 10, null, tint(l)); };
  bus.on('bite', (e) => { miss = e; });
  bus.on('denied', () => { miss = null; });
  bus.on('dig', () => {
    miss = null; lastDig = game.time; nudge = 0;
    // the second bite, so the first one is yours to look at. A dent is only drawn when the shared pile took less than the whole bite.
    if (++digs === 2 && !seen.bite) { mark('bite'); teach('bite', game.fields.some((f) => f.dented) ? COPY.bite : COPY.biteSolid, 8); }
  });
  bus.on('toolUp', ({ tool, quiet }) => {
    if (quiet) return;
    mark('bite'); mark('tool');
    if (tool.kind === 'vehicle' && !seen.vehicle) { mark('vehicle'); teach('vehicle', COPY.vehicle, 12); }
  });
  bus.on('whack', () => mark('swat'));
  bus.on('splat', () => mark('swat'));
  bus.on('agentDown', ({ agent, lobby: l }) => {
    if (agent.hp <= 0) mark('swat');   // flattened under a bite counts as knowing how
    if (!seen.nest && game.started && lobby.moundsLeft) nestHint(l);
  });
  bus.on('hurt', ({ lobby: l, effect }) => {
    if (!seen.swat || seen['fx-' + effect] || !COPY.fx[effect]) return;   // one lesson at a time, and how to swat comes first
    mark('fx-' + effect);
    teach(effect, COPY.fx[effect === 'buyout' && p.tier === 0 ? 'buyoutShovel' : effect], 7, { s: l.secs, n: CFG.lobby.deductibleDigs }, tint(l));
  });
  bus.on('dead', () => { if (!seen.dead) { mark('dead'); teach('dead', COPY.dead, CFG.player.respawn + 4); } });

  // A bite that found nothing: say where the dirt is. Not while you are plainly at the dirt already (an edge, a bare
  // patch), not when what it hit was a nest or a lobbyist, and not in the middle of a fight.
  function missed({ x, z, tool }) {
    if (game.time - missAt > 120) missGap = 6;   // two quiet minutes and the next one is news again
    if (game.over || (net.everOnline && !net.online) || game.time - lastDig < 4 || game.time - missAt < missGap) return;
    const r = Math.max(tool.r, 2.6);
    if (lobby.mounds.some((m) => m.hp > 0 && Math.hypot(m.x - x, m.z - z) < r + 4.5)) return;
    if (lobby.agents.some((a) => Math.hypot(a.pos.x - x, a.pos.z - z) < r + 1.5 || Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < SEES / 2)) return;
    const i = game.fields.findIndex((f) => f.inside(x, z)), st = i < 0 ? 'buried' : game.status(i);
    let said;
    if (!dirt) { if (!lobby.moundsLeft || game.fields.some((f, k) => game.status(k) !== 'dug')) return; said = toast(COPY.nests, null, 3.5, 0); }
    else {
      const v = { d: Math.round(dirt.d), other: G[dirt.i].name, name: i < 0 ? '' : G[i].name };
      said = st !== 'buried' ? toast(st === 'dug' ? COPY.out : COPY.late, v, 3.5, 0) : toast(dirt.d > 8 ? COPY.far : game.player.toolCfg.reach < 0 ? COPY.nearBack : COPY.near, v, 2.5, 0);
      nudge = game.time + 6;   // and show the way for a moment
    }
    if (said) { missAt = game.time; missGap = Math.min(60, missGap * 2); }   // less often each time; a line that lost to bigger news gets another go
  }

  // ---- the connection: one line each time it changes. A blip is not news, so "lost" and "connecting" wait a moment.
  let link = '', linkT = 0, told = '';
  function connection() {
    if (game.solo) return;
    const s = net.online ? 'on' : net.replaced ? (/another window/.test(net.notice) ? 'moved' : 'dozed') : net.full ? 'full' : net.everOnline ? 'lost' : 'wait';
    if (s !== link) { link = s; linkT = 0; } else linkT += TICK;
    if (s === told || linkT < (s === 'wait' ? 3 : s === 'lost' ? 2 : 0)) return;
    if (s !== 'on') toast(COPY[s]);
    else toast(told === 'full' ? COPY.seat : told && told !== 'wait' ? COPY.back : net.count > 1 ? COPY.in : COPY.inAlone, { n: net.count.toLocaleString() }, 3);
    told = s;
  }

  // ---- arrows: one for the dirt, one for each open nest
  const marks = new Map(), list = [], rects = [], at = { x: 0, y: 0 };
  let W = 1, H = 1, ox = 0, oy = 0, measureT = 1, hudN = 0, showing = false, gb = '', gt = '';
  function aim(key, x, y, z, d, word, pin, tall, cls, color) {
    let a = marks.get(key);
    if (!a) {
      const e = el('div', 'garrow ' + cls); e.innerHTML = ARROW; e.hidden = true; if (color) e.style.setProperty('--c', color);
      arrows.append(e);
      marks.set(key, a = { el: e, svg: e.firstChild, tag: e.lastChild, on: false, sx: 0, sy: 0, px: -1, py: -1, rot: -1, text: '' });
      list.push(a);
    }
    a.want = true; a.x = x; a.y = y; a.z = z; a.word = word; a.pin = pin; a.tall = tall; a.dist = fill(COPY.metres, { d: Math.max(1, Math.round(d)) });
  }
  // Everything else on the HUD, as boxes an arrow must keep off. Read a couple of times a second, and only while there is something to show.
  function measure() {
    // where the chip goes on a phone (only those layouts read these): upright, on top of the status line; lying down, under it
    const t = timer.getBoundingClientRect(), up = Math.round(innerHeight - (t.height ? t.top : 212) + 2) + 'px', dn = t.height && t.top < 60 ? Math.round(t.bottom + 6) + 'px' : '';
    if (up !== gb) chip.style.setProperty('--gb', gb = up);
    if (dn !== gt) chip.style.setProperty('--gt', gt = dn);
    const b = arrows.getBoundingClientRect();
    ox = b.left; oy = b.top; W = b.width; H = b.height; rects.length = 0;
    for (const e of hud.children) {
      if (e === arrows || e.id === 'pops' || e.id === 'fx' || e.id === 'toast') continue;
      const r = e.getBoundingClientRect(), x = e === chip ? r.left + card.offsetLeft : r.left, w = e === chip ? card.offsetWidth : r.width;   // the chip's own card, where it comes to rest (not mid slide-in)
      if (w < 2 || r.height < 2 || w * r.height > W * H * 0.4) continue;   // hidden, empty, or a layer over the whole screen
      rects.push(x - ox - PAD, r.top - oy - PAD, x + w - ox + PAD, r.bottom - oy + PAD);
    }
    for (const r of game.shellRects?.() || []) rects.push(r.left - ox - PAD, r.top - oy - PAD, r.right - ox + PAD, r.bottom - oy + PAD);   // mann.cool's own buttons, when the game is under its shell
    hudN = rects.length;
  }
  const blocked = (x, y, b = BOX) => { for (let i = 0; i < rects.length; i += 4) if (x + b > rects[i] && x - b < rects[i + 2] && y + b > rects[i + 1] && y - b < rects[i + 3]) return true; return false; };
  // a point on the border an arrow may sit on, `s` pixels clockwise from its top left corner; true if that point is free
  function border(s) {
    const w = W - 2 * EDGE, h = H - 2 * EDGE, per = 2 * (w + h);
    s = ((s % per) + per) % per;
    if (s < w) { at.x = EDGE + s; at.y = EDGE; } else if (s < w + h) { at.x = W - EDGE; at.y = EDGE + s - w; } else if (s < 2 * w + h) { at.x = W - EDGE - (s - w - h); at.y = H - EDGE; } else { at.x = EDGE; at.y = H - EDGE - (s - 2 * w - h); }
    return !blocked(at.x, at.y);
  }
  // Where an arrow pointing (ux, uy) from you goes: the edge of the screen that way; if the HUD is there, a little
  // along the edge; failing that, in toward you; failing that, the nearest free stretch of edge on that side. The answer lands in `at`.
  function spot(ux, uy, cx, cy) {
    const w = W - 2 * EDGE, h = H - 2 * EDGE;
    const t = Math.min((ux > 0 ? W - EDGE - cx : cx - EDGE) / Math.abs(ux || 1e-6), (uy > 0 ? H - EDGE - cy : cy - EDGE) / Math.abs(uy || 1e-6));
    const ex = cx + ux * t, ey = cy + uy * t;
    const s0 = Math.abs(ey - EDGE) < 1 ? ex - EDGE : Math.abs(ex - (W - EDGE)) < 1 ? w + ey - EDGE : Math.abs(ey - (H - EDGE)) < 1 ? w + h + (W - EDGE - ex) : 2 * w + h + (H - EDGE - ey);
    if (border(s0)) return;
    for (let k = 6; k <= SLIDE; k += 6) if (border(s0 + k) || border(s0 - k)) return;
    for (let s = t - 8; s > CLEAR; s -= 8) { at.x = cx + ux * s; at.y = cy + uy * s; if (!blocked(at.x, at.y)) return; }
    for (let k = SLIDE + 12; k < w + h; k += 12) for (let q = -1; q <= 1; q += 2) if (border(s0 + q * k) && (at.x - cx) * ux + (at.y - cy) * uy > 0) return;   // never the far side of the screen
    at.x = ex; at.y = ey;
  }
  function place(dt) {
    const m = game.camera.matrixWorldInverse.elements, e = game.camera.projectionMatrix.elements, vw = innerWidth / 2, vh = innerHeight / 2, cx = vw - ox, cy = vh - oy, k = Math.min(1, dt * 14);
    rects.length = hudN;
    for (let j = 0; j < list.length; j++) {
      const a = list[j];
      if (!a.want) continue;
      const vx = m[0] * a.x + m[4] * a.y + m[8] * a.z + m[12], vy = m[1] * a.x + m[5] * a.y + m[9] * a.z + m[13], vz = m[2] * a.x + m[6] * a.y + m[10] * a.z + m[14];
      // behind the camera the picture comes out mirrored; dividing by |z| un-mirrors it, which leaves the way to turn
      const w = Math.max(0.01, Math.abs(vz)), nx = e[0] * vx / w - e[8], ny = e[5] * vy / w - e[9], lim = a.on ? 0.97 : 0.88;
      a.on = vz < 0 && Math.abs(nx) < lim && (a.tall || Math.abs(ny) < lim);
      let ok = true, rot = 180;
      if (a.on) {   // in view: nothing, or (while you are being shown the way) a marker bobbing over the spot, a little higher if the HUD is in the way
        const sy = cy - ny * vh;
        at.x = cx + nx * vw; ok = false;
        if (a.pin) for (let d = 28; d <= 76 && !ok; d += 6) { at.y = sy - d; ok = at.y > BOX && !blocked(at.x, at.y, BOX - 4); }
      } else {
        let ux = nx * vw, uy = -ny * vh; const l = Math.hypot(ux, uy);
        if (l < 1) { ux = 0; uy = 1; } else { ux /= l; uy /= l; }
        spot(ux, uy, cx, cy);
        rot = (Math.round(Math.atan2(ux, -uy) * 60 / Math.PI) * 3 + 360) % 360;
      }
      if (a.el.hidden === ok) { a.el.hidden = !ok; a.sx = at.x; a.sy = at.y; }   // just appeared: no gliding in from wherever it last was
      if (!ok) continue;
      rects.push(at.x - BOX, at.y - BOX, at.x + BOX, at.y + BOX);   // the next arrow keeps off this one
      a.sx += (at.x - a.sx) * k; a.sy += (at.y - a.sy) * k;
      const px = Math.round(a.sx), py = Math.round(a.sy + (a.on ? Math.sin(game.time * 6) * 3 : 0)), text = a.on ? COPY.hereTag : a.word;
      if (px !== a.px || py !== a.py) { a.px = px; a.py = py; a.el.style.transform = `translate(${px}px,${py}px)`; }
      if (text !== a.text || a.dist !== a.said) { a.text = text; a.said = a.dist; a.tag.textContent = text + '\n' + a.dist; }
      if (rot !== a.rot) { a.rot = rot; a.svg.style.transform = `rotate(${rot}deg)`; a.el.classList.toggle('dn', rot > 100 && rot < 260); }
    }
  }

  function tick() {
    for (const a of list) a.want = false;
    showing = false;
    panel = !!document.querySelector(PANELS);
    if (game.started && !game.over) {
      // Play points you at the man whose clock is shortest, so that is the pile the first arrow means
      if (!began) { began = true; goal = G.map((g, i) => i).filter((i) => game.status(i) === 'buried').sort((a, b) => game.deadlines[a] - game.deadlines[b])[0] ?? -1; for (const o of found) scan(o.i); } else scan(scanI++ % found.length);
      dirt = null;
      let best = Infinity;
      for (const o of found) if (o.ok) { o.d = Math.hypot(o.x - p.pos.x, o.z - p.pos.z); const s = o.d - (o.i === goal ? STICK : 0); if (s < best) { best = s; dirt = o; } }
      if (dirt) goal = dirt.i;
      connection();
      // someone who arrives with a tool, or a fair bit dug, has had the first minute already
      if (p.tier > 0 || !fresh) { mark('bite'); mark('tool'); } else if (p.dug >= 20) mark('bite');
      const next = CFG.tools[p.tier + 1], there = !!dirt && !seen.bite && onDirt();
      step = !dirt || seen.tool || !next ? '' : seen.bite ? 'tool' : there ? 'dig' : 'go';
      if (step === 'tool' && !flash) toolT += TICK;
      vars.d = dirt ? Math.max(1, Math.round(dirt.d)) : 0;
      if (next) { vars.n = Math.max(1, Math.ceil(next.need - p.dug)); vars.tool = next.name.toUpperCase(); }
      // a lobbyist in sight and you have never swatted one: the word stays up while they are near, until you do
      if (!seen.swat && !p.inVehicle && p.dead <= 0 && (!flash || flash.id === 'swat') && lobby.agents.some((a) => a.hp > 0 && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < SEES)) {
        teach('swat', COPY.swat, 2 * TICK);
        if ((swatT += TICK) > 25) mark('swat');
      }
      // what to point at
      let nest = null;
      if (!panel && !game.cam && p.dead <= 0) {
        const pin = step === 'go' || game.time < nudge;
        if (dirt && (pin || dirt.d > NEAR + Math.abs(p.toolCfg.reach))) aim('dirt', dirt.x, game.surface(dirt.x, dirt.z) + 1.5, dirt.z, dirt.d, COPY.dirtTag, pin, false, 'dirt');
        for (const mo of lobby.mounds) {
          if (mo.hp <= 0) continue;
          const d = Math.hypot(mo.x - p.pos.x, mo.z - p.pos.z);
          nest ||= mo;
          if (d > 12) aim(mo.i, mo.x, game.surface(mo.x, mo.z) + 5, mo.z, d, COPY.nestTag, false, true, '', tint(mo.lobby));   // nearer than that you are at it
        }
      }
      if (!seen.nest && nest && !flash && (nestT += TICK) > 40) nestHint(nest.lobby);
    } else step = '';
    for (const a of list) { if (a.want) showing = true; else if (!a.el.hidden) a.el.hidden = true; }
    drawChip();
    showing ||= !chip.hidden;
  }

  let acc = TICK;
  return { update(dt) {
    if (flash && (flash.t -= dt) <= 0) flash = null;
    if (miss) { const e = miss; miss = null; missed(e); }
    if ((acc += dt) >= TICK) { acc = 0; tick(); }
    if (!showing) return;
    if ((measureT += dt) > 0.5) { measureT = 0; measure(); }
    place(dt);
  } };
}
