import * as THREE from 'three';
import { CFG, tierFor, starsFor, rankFor, validCode } from './config.js';
import { Avatar } from './avatar.js';
import { at } from './base.js';
import { reportTotal, reportStats } from './board.js';

const N = CFG.net;
const CODE_KEY = 'dig-them-out-code';
const TOUCH = matchMedia('(pointer: coarse)').matches;
// What a player's flags byte says: bit 0 moving, 1 digging, 2 down, 3 swatting, bits 4-6 which lobby effect they are
// under (index into FX, 0 = none), bit 7 cheering.
export const FX = ['', 'hasbara', 'deductible', 'pricehike', 'slick', 'buyout', 'tos'];

// The shared world. One WebSocket to a room of up to 80 players; the room relays positions and feeds every
// dig into the single world copy of the dirt. If the server is unreachable the game simply runs solo.
export class Net {
  constructor(game) {
    this.game = game;
    this.ws = null; this.online = false; this.everOnline = false; this.full = false; this.asleep = false;
    this.sid = 0; this.count = 0; this.room = '';
    this.digs = []; this.hits = []; this.calls = 0;
    this.ls = []; this.lk = [];   // lobbyists we sent after ourselves, and ones we swatted, for the room (see Lobby)
    this.remotes = new Map();
    this.lastPos = ''; this.sendAcc = 0; this.pickAcc = 0; this.retryIn = 0; this.backoff = 2; this.waitT = 0; this.offT = 0;
    this.code = null; this.pendingCode = null; this.replaced = false; this.notice = ''; this.chose = false; this.bought = false;
    try { this.code = localStorage.getItem(CODE_KEY); } catch (e) { /* private window */ }
    game.bus.on('called', () => { this.calls++; });   // a phone call to a real office, counted for the whole country
  }

  setCode(code) { this.code = code; try { localStorage.setItem(CODE_KEY, code); } catch (e) { /* ignore */ } }

  connect() {
    if (this.ws || this.game.solo) return;
    const p = this.game.player, q = new URLSearchParams({ name: p.name || '', char: p.char || '' });
    this.replaced = false; this.waitT = 0; this.heard = 0; this.pingT = 0;
    if (this.pendingCode) { q.set('code', this.pendingCode); q.set('try', '1'); } else if (validCode(this.code)) q.set('code', this.code);
    else if (p.dug > 1) q.set('warm', String(Math.floor(Math.min(p.dug, CFG.tools[1].need))));   // a newcomer who warmed up while the dig was full keeps a little of it
    if (this.chose) q.set('set', '1');   // the look on the start screen was picked on purpose this time
    let ws;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${at('/ws')}?${q}`); } catch (e) { return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (e) => { this.heard = 0; if (e.data === '!') return; if (typeof e.data === 'string') this.onJson(JSON.parse(e.data)); else this.onCells(new Uint16Array(e.data)); };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null; this.online = false;
      this.full = e.code === 4503;
      if (e.code === 4001) { this.replaced = true; this.notice = 'you are playing in another window: click here to play in this one'; }
      if (e.code === 4000) { this.replaced = true; this.notice = 'you dozed off: tap to rejoin the dig'; }
      if (e.code === 4404) { this.pendingCode = null; this.notice = 'nobody has dug with that code: carrying on as you were'; this.game.hud.toast('NOBODY HAS DUG WITH THAT CODE\ncarrying on as you were. MENU to try it again', 7, 3); this.retryIn = 0.5; this.backoff = 2; return; }
      if (e.code === 4429) this.notice = 'too many players from your network at once';
      if (e.code === 4302) { this.retryIn = 0.5 + Math.random() * 1.5; this.backoff = 2; return; }   // our room is being folded into a fuller one
      // Everyone dropped at once (a deploy, a hiccup) must not all knock again at the same instant: spread out, more so in a big crowd.
      this.retryIn = this.backoff * (0.5 + Math.random()) + Math.random() * Math.min(30, this.count / 150);
      this.backoff = Math.min(60, this.backoff * 2);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  // A tab in the background gives up its seat; coming back takes one again.
  sleep() { if (this.ws) { this.asleep = true; this.hangUp(); } }
  // Let go of the socket now, without waiting for the server to agree: the next connect() starts clean.
  hangUp() { const ws = this.ws; if (!ws) return; this.ws = null; this.online = false; this.full = false; ws.onclose = null; try { ws.close(); } catch (e) { /* gone */ } }
  // Connect again at once (a code typed in from the menu, a new look or name).
  redial() { this.hangUp(); this.replaced = false; this.retryIn = 0; this.backoff = 2; this.connect(); }
  wake() { if (this.asleep) { this.asleep = false; this.retryIn = 0; this.backoff = 2; } }

  clearRemotes() { for (const r of this.remotes.values()) r.avatar?.dispose(); this.remotes.clear(); this.game.lobby?.dropMirrors(); }

  onJson(m) {
    const g = this.game, p = g.player;
    if (m.t === 'hi') {
      const was = this.everOnline;
      this.online = this.everOnline = true; this.backoff = 2; this.notice = ''; this.offT = 0;
      this.pendingCode = null; this.chose = false;
      this.sid = m.sid; this.room = m.room; this.count = m.online;
      this.lastPos = ''; this.sendAcc = N.sendMs / 1000;   // tell the room where we really are straight away
      // Reconnecting with the same code: never go backwards. Otherwise (first arrival, or a different code) the server's
      // total is the truth, and anything dug before it answered was only a warm-up on a private pile.
      const same = was && m.code === this.code;
      this.setCode(m.code);
      p.serverDug = Math.max(m.dug, 0);
      p.dug = same ? Math.max(p.dug, p.serverDug) : p.serverDug;
      p.tier = same ? Math.max(p.tier, tierFor(p.serverDug)) : tierFor(p.serverDug);
      p.setStars(starsFor(p.serverDug));   // quietly: what you had already earned is not news
      if (Array.isArray(m.stats)) { p.stats = m.stats.slice(); g.bus.emit('stats', { st: p.stats, prev: null }); }
      // a pile a dirt bomb refilled while we were away: our copy is lower than the truth, so start it over (the snapshot follows)
      if (was && Array.isArray(m.gen)) g.fields.forEach((f, i) => { if (f.gen !== undefined && f.gen !== m.gen[i]) f.reset(); });
      if (Array.isArray(m.gen)) g.fields.forEach((f, i) => { f.gen = m.gen[i]; });
      if (!was) {   // the shared piles replace the warm-up ones (the snapshot frames follow this message), and each man's state is news from here on, not a change to announce
        for (const f of g.fields) f.reset();
        for (const gi of g.giants) gi.was = gi.left = undefined;
      }
      g.world(m, true);
      {   // the server has settled which look and name this code carries
        if (m.name) p.name = m.name;
        p.refreshTag();
        if (m.char && m.char !== p.char) p.setCharacter(m.char);
      }
      reportTotal(m.code, p.name, p.serverDug);
      if (p.stats) reportStats(m.code, p.name, p.stats);
      this.clearRemotes();
      for (const r of m.players) this.addRemote(r);
      g.onIdentity?.();
      g.bus.emit('online', { count: this.count, room: this.room, back: was });
    } else if (m.t === 'p') {
      const now = performance.now();
      for (const [sid, x, z, yaw, flags, tier, stars] of m.ps) {
        const r = this.remotes.get(sid);
        if (!r) continue;
        // glide from where they are drawn now to the new spot over about the time between two reports
        r.span = now - r.at > 900 ? 0.5 : Math.min(1.1, Math.max(0.4, (now - r.at) / 1000)); r.at = now;
        r.fx0 = r.pos.x; r.fz0 = r.pos.z; r.u = 0; r.tx = x; r.tz = z; r.tyaw = yaw;
        if (tier > r.tier) g.bus.emit('remoteTool', { remote: r, sid, name: r.name, tier, tool: CFG.tools[tier] });
        if ((flags & 4) && !(r.flags & 4)) g.bus.emit('remoteDown', { remote: r, sid, name: r.name });
        if ((flags & 128) && !(r.flags & 128)) { r.avatar?.cheer(2.5); g.bus.emit('remoteCheer', { remote: r, sid }); }
        if (((flags >> 4) & 7) !== ((r.flags >> 4) & 7)) g.bus.emit('remoteFx', { remote: r, sid, effect: FX[(flags >> 4) & 7] || '' });
        r.flags = flags; r.tier = tier; if (Number.isInteger(stars)) r.stars = stars;
      }
      // the shared swarm: [sid, id, mound, suit] sent after player sid; [owner, id, by] swatted by player by
      if (Array.isArray(m.ls)) for (const [sid, id, mi, suit] of m.ls) g.lobby.mirror(sid, id, mi, suit);
      if (Array.isArray(m.lk)) for (const [owner, id, by] of m.lk) g.lobby.netKill(owner, id, by);
    } else if (m.t === 'j') { this.addRemote(m.p); g.bus.emit('join', { sid: m.p[0], name: m.p[1] }); }
    else if (m.t === 'l') { g.lobby.dropMirrors(m.sid); const r = this.remotes.get(m.sid); if (r) { r.avatar?.dispose(); this.remotes.delete(m.sid); g.bus.emit('leave', { sid: m.sid, name: r.name }); } }
    else if (m.t === 'c') { p.serverDug = m.dug; p.dug = Math.max(m.dug, Math.min(p.dug, m.dug + 80)); p.checkTier(); reportTotal(this.code, p.name, m.dug); }   // our own running count may lead the server's by a few bites, never by much
    else if (m.t === 's' && Array.isArray(m.stats)) { const prev = p.stats; p.stats = m.stats.slice(); reportStats(this.code, p.name, p.stats); g.bus.emit('stats', { st: p.stats, prev }); }   // lobbyists stopped, nests, saves (CFG.badges)
    else if (m.t === 'w') { this.count = m.online; g.world(m, false); }
  }

  // Binary frames: [kind, giant, ...]. kind 1 = every cell's dirt thickness in cm, kind 2 = (cell, cm) pairs,
  // kind 3 = [3, giant, fill generation, ...every cell]: a dirt bomb refilled the pile, so this replaces ours outright.
  onCells(a) {
    const f = this.game.fields[a[1]];
    if (!f) return;
    if (a[0] === 3) { f.gen = a[2]; f.regrow(a.subarray(3)); this.game.bus.emit('regrow', { giant: a[1], field: f }); return; }   // a dirt bomb: replace, do not merge
    if (a[0] === 1) { f.applySnapshot(a.subarray(2)); f.shown = f.progress; } else if (a[0] === 2) { f.applyCells(a.subarray(2)); this.game.bus.emit('cells', { giant: a[1], field: f, pairs: a.subarray(2) }); }
  }

  addRemote([sid, name, char, tier, x, z, yaw, flags, stars]) {
    if (sid === this.sid || this.remotes.has(sid)) return;
    this.remotes.set(sid, { sid, name, char, tier, flags, stars: stars | 0, look: '', yaw, tx: x, tz: z, tyaw: yaw, fx0: x, fz0: z, u: 1, span: 0.5, at: 0, gap: 0, pos: new THREE.Vector3(x, 0, z), avatar: null });
  }

  dig(x, z, k, bought) { if (this.online) { this.digs.push([+x.toFixed(2), +z.toFixed(2), +k.toFixed(2)]); if (bought) this.bought = true; } }
  spawned(id, mound, suit) { if (this.online) { this.ls.push([id, mound, suit]); if (this.ls.length > 24) this.ls.shift(); } }
  killed(owner, id) { if (this.online && owner) { this.lk.push([owner, id]); if (this.lk.length > 48) this.lk.shift(); } }
  hitMound(i, bought) { if (this.online) { this.hits.push(i); if (bought) this.bought = true; } }
  // Take this window's seat back after another window took it, or after dozing off.
  reclaim() { if (this.replaced) { this.replaced = false; this.notice = ''; this.retryIn = 0; this.backoff = 2; this.connect(); } }

  update(dt) {
    const g = this.game, p = g.player;
    if (!this.ws && !this.replaced && !this.asleep && g.started && g.over !== 'won' && (this.retryIn -= dt) <= 0) { this.retryIn = this.backoff; this.connect(); }
    // a connection that opened but never got its greeting is not a connection: hang up and try again
    if (this.ws && !this.online && (this.waitT += dt) > 12) { this.waitT = 0; this.hangUp(); this.retryIn = this.backoff * (0.5 + Math.random()); this.backoff = Math.min(60, this.backoff * 2); }
    // A phone between Wi-Fi and cellular can hold a dead socket open for minutes while you dig into the void. Ask the
    // server '?' every few seconds (it answers '!' without waking the room) and hang up if nothing at all comes back.
    if (this.online) {
      if ((this.pingT += dt) > 5 && this.ws.readyState === 1) { this.pingT = 0; this.ws.send('?'); }
      if ((this.heard += dt) > 14) { this.hangUp(); this.retryIn = 0.5; }
    }
    // a blip freezes the crowd where it stood; only a long silence clears the lawn
    if (!this.online && this.remotes.size && (this.offT += dt) > 12) this.clearRemotes();
    if (this.online && this.ws.readyState === 1 && (this.sendAcc += dt) >= N.sendMs / 1000) {
      this.sendAcc %= N.sendMs / 1000;
      const fx = p.fx.hasbara > 0 ? 1 : p.deductible > 0 ? 2 : p.fx.pricehike > 0 ? 3 : p.fx.slick > 0 ? 4 : p.fx.buyout > 0 ? 5 : p.fx.tos > 0 ? 6 : 0;
      const flags = (p.moving ? 1 : 0) | (p.digging ? 2 : 0) | (p.dead > 0 ? 4 : 0) | (p.fighting ? 8 : 0) | (fx << 4) | (p.avatar.cheerT > 0 ? 128 : 0);
      const pos = [+p.pos.x.toFixed(1), +p.pos.z.toFixed(1), +p.yaw.toFixed(2), flags];
      const key = pos.join(), m = {};
      if (key !== this.lastPos) { m.p = pos; this.lastPos = key; }   // standing still costs nothing
      if (this.digs.length) { m.d = this.digs.splice(0, 12); }
      if (this.hits.length) { m.h = this.hits.splice(0, 4); }
      if (this.bought && (m.d || m.h)) m.b = 1;
      if (this.calls) { m.c = Math.min(3, this.calls); this.calls = 0; }
      if (this.ls.length) m.s = this.ls.splice(0, 6);
      if (this.lk.length) m.k = this.lk.splice(0, 12);
      this.bought = false;
      if (m.p || m.d || m.h || m.c || m.s || m.k) this.ws.send(JSON.stringify(m));
    }
    // everyone else: only the nearest few get a full body (fewer on a phone). Bodies arrive a couple at a time, nearest
    // first, and one is kept until its owner is clearly out of range so two people swapping places do not flicker.
    if ((this.pickAcc += dt) > 0.3) {
      this.pickAcc = 0;
      const shown = TOUCH ? N.shownTouch : N.shown;
      const near = [...this.remotes.values()].sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos));
      let fresh = 0;
      near.forEach((r, i) => {
        if (i < shown && !r.avatar && fresh < 2) { fresh++; const a = r.avatar = new Avatar(g.scene); a.setTier(r.tier); a.setChar(r.char); r.look = ''; }
        if (i >= shown + 6 && r.avatar) { r.avatar.dispose(); r.avatar = null; }
      });
    }
    const k = Math.min(1, dt * 6), cam = g.camera.position;
    for (const r of this.remotes.values()) {
      // straight-line glide between the last two reports, at a steady speed
      r.u = Math.min(1, r.u + dt / r.span);
      r.gap = Math.hypot(r.tx - r.fx0, r.tz - r.fz0);
      if (r.gap > 30) r.u = 1;   // respawned or teleported: do not slide across the lawn
      r.pos.x = r.fx0 + (r.tx - r.fx0) * r.u; r.pos.z = r.fz0 + (r.tz - r.fz0) * r.u;
      r.yaw += Math.atan2(Math.sin(r.tyaw - r.yaw), Math.cos(r.tyaw - r.yaw)) * k;
      r.pos.y = g.surface(r.pos.x, r.pos.z);
      // their digging lands on the beat of their tool, like yours does
      const tool = CFG.tools[r.tier];
      if ((r.flags & 2) && !(r.flags & 12) && tool) { if ((r.beat = (r.beat ?? Math.random()) + dt / tool.period) >= 1) { r.beat -= 1; g.remoteBite(r, tool); } }
      if (!r.avatar) continue;
      if (r.look !== r.tier + ':' + r.stars) { r.look = r.tier + ':' + r.stars; r.avatar.setName(r.name, rankFor(r.tier, r.stars)); r.avatar.setPaint(r.stars); }   // their rank and paint job
      const fxi = (r.flags >> 4) & 7;
      r.avatar.setVisible(!(r.flags & 4));
      r.avatar.setTier(Math.max(0, r.tier - (fxi === 5 ? 1 : 0)));   // bought out: one tool down, like the owner sees
      r.avatar.update(dt, { pos: r.pos, yaw: r.yaw, moving: !!(r.flags & 1) && r.u < 1, digging: !!(r.flags & 2), speed: r.gap / r.span || tool?.speed || 6,
        clip: r.flags & 8 ? 'swing' : null, period: CFG.lobby.whack, far: Math.hypot(r.pos.x - cam.x, r.pos.z - cam.z) });
    }
  }
}
