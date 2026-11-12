import { DurableObject } from 'cloudflare:workers';
import { CFG, tierFor, validName, randomName, moundSpots, CODE_ALPHABET, validCode } from '../shared/config.js';
import { DirtGrid } from '../shared/grid.js';
import { worldName, shardName } from './era.js';

const N = CFG.net;
const MOUNDS = moundSpots();
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const refuse = (code, why) => { const [c, s] = Object.values(new WebSocketPair()); s.accept(); s.close(code, why); return new Response(null, { status: 101, webSocket: c }); };

// Up to ~80 players who can see each other. It relays their positions twice a second and passes their digs on
// to the World once a second. It stays awake only while someone is connected.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.world = this.worldStub();
    // '?' from a browser is answered '!' by the runtime itself: a free "are you still there" that never reaches our code
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('?', '!'));
    this.players = new Map();          // WebSocket -> player
    this.nextSid = 1;
    this.name = '';
    this.cm = CFG.giants.map((g, i) => new DirtGrid(g, i + 1).toCm());   // our mirror of the piles, for people who join
    this.fresh = this.cm.map((a) => a.slice());   // the untouched piles, to rebuild a mirror from after a dirt bomb
    this.gen = null;                              // the World's fill generation of each pile, as of our mirror
    this.since = 0; this.epoch = null; this.ops = []; this.hits = []; this.busy = false;
    this.mounds = null; this.pace = null; this.online = 0; this.timer = null; this.ticks = 0;
    this.perIp = N.perIp; this.fl = null; this.bornAt = Date.now(); this.foldAt = 0;
    this.calls = 0; this.callers = new Map();   // phone calls to pass on to the World; code -> { at, n } for the hourly limit
    // If we were restarted with sockets still attached, pick the players back up from what was pinned to each socket.
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a) { ws.close(1011, 'restart'); continue; }
      this.name = a.room;
      const p = this.makePlayer(a.sid, a.code, a.name, a.char, a.dug, a.ip);
      if (typeof a.x === 'number') { p.x = a.x; p.z = a.z; }
      this.players.set(ws, p);
      this.nextSid = Math.max(this.nextSid, a.sid + 1);
    }
    if (this.players.size) this.start();
  }

  makePlayer(sid, code, name, char, dug, ip) {
    const now = Date.now();
    return { sid, code, name, char, ip, dug, saved: dug, tier: tierFor(dug), x: CFG.spawn.x, z: CFG.spawn.z, yaw: 3.14, flags: 0, moved: true,
      budget: 0, joined: now, last: now, lastMsg: now, msgs: 0, savedAt: now, left: false };
  }

  worldStub() { return this.env.WORLD.get(this.env.WORLD.idFromName(worldName)); }
  shard(code) { return this.env.PLAYERS.get(this.env.PLAYERS.idFromName(shardName(code))); }

  async fetch(req) {
    const url = new URL(req.url), ip = req.headers.get('x-ip') || '';
    this.name = req.headers.get('x-room') || this.name || 'r1';
    const turnAway = (code, why) => { this.ctx.waitUntil(this.world.release(this.name).catch(() => {})); return refuse(code, why); };   // and give the seat back
    if (this.players.size >= N.roomSize + 20) return turnAway(4503, 'full');   // the World over-filled us in a rush
    let same = 0;
    for (const q of this.players.values()) if (ip && q.ip === ip) same++;
    if (same >= this.perIp) return turnAway(4429, 'too many connections from one place');
    let code = url.searchParams.get('code'), known = null;
    if (validCode(code)) known = await this.shard(code).load(code); else code = newCode();
    // "try" is a code typed in by hand: if nobody has ever saved under it, say so instead of quietly starting a new player
    if (url.searchParams.get('try') === '1' && !known) return turnAway(4404, 'no such code');
    // one seat per code in a room: a newer connection takes over, and inherits what the old one had dug
    let carry = null;
    for (const [ws, q] of this.players) if (q.code === code) { carry = q; try { ws.close(4001, 'opened elsewhere'); } catch (e) { /* gone */ } this.drop(ws); }
    // The start screen's pick wins when the player actually chose it (set=1) or is new; otherwise the saved look comes back.
    const askedName = url.searchParams.get('name'), askedChar = url.searchParams.get('char');
    const chose = url.searchParams.get('set') === '1' || !known;
    const prevName = carry?.name || known?.name, prevChar = carry?.char || known?.char;
    const name = chose && validName(askedName) ? askedName : validName(prevName) ? prevName : validName(askedName) ? askedName : randomName();
    const char = chose && CFG.people.includes(askedChar) ? askedChar : CFG.people.includes(prevChar) ? prevChar : CFG.people.includes(askedChar) ? askedChar : CFG.people[0];
    // the first player in needs the current pace and deadlines, which only the World knows
    if (!this.pace) await (this.first ||= this.syncWorld(false, 1).finally(() => { this.first = null; }));   // everyone arriving in a cold room waits for the same first answer
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const p = this.makePlayer(this.nextSid++, code, name, char, Math.max(known?.dug || 0, carry?.dug || 0), ip);
    // A brand-new player who warmed up on a private pile while the dig was full keeps a little of it: at most the first
    // upgrade's worth, so there is nothing to cheat for. It is left unsaved here, so the next save writes it.
    if (carry) { p.budget = carry.budget; p.last = carry.last; }   // a takeover inherits the old seat's swing allowance; a fresh connection earns its own from zero
    if (!known && !carry) { p.dug = num(Number(url.searchParams.get('warm')), 0, CFG.tools[1].need) || 0; p.tier = tierFor(p.dug); }
    this.players.set(server, p);
    this.pin(server, p);
    if (known && (name !== known.name || char !== known.char)) this.ctx.waitUntil(this.shard(code).add(code, 0, char, name));
    server.send(JSON.stringify({ t: 'hi', sid: p.sid, code, known: !!known, dug: p.dug, name, char, room: this.name, online: Math.max(this.online, this.players.size),
      mounds: this.mounds, ...(this.pace || {}), players: [...this.players.values()].filter((q) => q !== p).map((q) => [q.sid, q.name, q.char, q.tier, q.x, q.z, q.yaw, q.flags]) }));
    this.cm.forEach((cm, i) => { const f = new Uint16Array(cm.length + 2); f[0] = 1; f[1] = i; f.set(cm, 2); server.send(f.buffer); });
    this.cast(JSON.stringify({ t: 'j', p: [p.sid, p.name, p.char, p.tier, p.x, p.z, p.yaw, p.flags] }), server);
    this.start();
    return new Response(null, { status: 101, webSocket: client });
  }

  pin(ws, p) { try { ws.serializeAttachment({ room: this.name, sid: p.sid, code: p.code, name: p.name, char: p.char, dug: p.saved, ip: p.ip, x: p.x, z: p.z }); } catch (e) { /* closed */ } }
  cast(msg, except) { for (const ws of this.players.keys()) if (ws !== except) { try { ws.send(msg); } catch (e) { /* closing */ } } }
  kick(ws, code, why) { try { ws.close(code, why); } catch (e) { /* gone */ } this.drop(ws); }

  // Write what a player has dug since their last save. The shard adds it to the stored total and tells us the total,
  // which can be higher than ours if another connection on the same code saved in the meantime.
  persist(ws, p) {
    const delta = p.dug - p.saved, sent = p.dug;
    p.saved = sent; p.savedAt = Date.now();
    const done = this.shard(p.code).add(p.code, delta, p.char, p.name).then((total) => {
      if (total > sent + 0.05 && !p.left) {
        const extra = total - sent;
        p.dug += extra; p.saved += extra;
        if (tierFor(p.dug) !== p.tier) { p.tier = tierFor(p.dug); p.moved = true; }
        if (ws) { this.pin(ws, p); try { ws.send(JSON.stringify({ t: 'c', dug: Math.round(p.dug * 10) / 10 })); } catch (e) { /* closing */ } }
      } else if (ws && !p.left) this.pin(ws, p);
    }).catch(() => { p.saved -= delta; });   // not written: count it as unsaved again
    this.ctx.waitUntil(done);
    return done;
  }

  webSocketMessage(ws, raw) {
    const p = this.players.get(ws);
    if (!p) return;
    if (typeof raw !== 'string' || raw.length > 1500) return this.kick(ws, 1008, 'bad message');   // an honest browser never sends these
    const n = ++p.msgs;
    if (n > 40) return this.kick(ws, 1008, 'slow down');   // forty in half a second is a flood, not a game
    if (n > 8) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    let real = false;
    if (Array.isArray(m.p)) {
      const x = num(m.p[0], -400, 400), z = num(m.p[1], -400, 400), yaw = num(m.p[2], -10, 10);
      if (x !== null && z !== null && yaw !== null) { p.x = x; p.z = z; p.yaw = yaw; p.flags = (m.p[3] | 0) & 255; p.moved = true; real = true; }
    }
    // m.b: the player is under a Wall Street buyout, so they are digging with the tool one step down
    const ti = m.b === 1 && p.tier > 0 ? p.tier - 1 : p.tier, tool = CFG.tools[ti];
    // You can only swing as fast as your tool does. The budget is one pot of seconds for dirt and mounds alike, so a bite
    // costs its own tool's time whichever tool the message claims; a few seconds may bank up, so a phone that stalls and
    // then delivers a burst loses nothing, and the long-run rate is unchanged.
    if (Array.isArray(m.d) || Array.isArray(m.h)) { p.budget = Math.min(Math.max(4 * tool.period, 4), p.budget + (now - p.last) / 1000); p.last = now; }
    if (Array.isArray(m.d)) {
      // ...and only within reach of where you say you are. The honest strengths are 1, 0.5 and 0.25; a bite of next to nothing is not a bite.
      for (const d of m.d.slice(0, 12)) {
        if (p.budget < tool.period || !Array.isArray(d)) break;
        const x = num(d[0], -400, 400), z = num(d[1], -400, 400), k = num(d[2], 0, 1);
        if (x === null || z === null || k === null || k < 0.2 || Math.hypot(x - p.x, z - p.z) > Math.abs(tool.reach) + 6) continue;
        p.budget -= tool.period; real = true;
        this.ops.push([x, z, tool.r, tool.depth * k, p, ti]);
      }
    }
    if (Array.isArray(m.h)) {
      // mounds too: only one you are standing next to
      const far = Math.abs(tool.reach) + Math.max(tool.r, 2.6) + 4.5 + 6;
      for (const i of m.h.slice(0, 4)) {
        if (p.budget < tool.period) break;
        if (!Number.isInteger(i) || i < 0 || i >= MOUNDS.length || Math.hypot(MOUNDS[i].x - p.x, MOUNDS[i].z - p.z) > far) continue;
        p.budget -= tool.period; real = true;
        this.hits.push([i, tool.dmg]);
        // battering an open mound pays the same as a full bite of dirt with that tool (the browser shows the same), so nest-hunting never costs anyone their next tool
        if (this.mounds?.[i] > 0) { p.dug += Math.PI * tool.r * tool.r * tool.depth / 2; p.credit = true; }
      }
    }
    if (Number.isInteger(m.c) && m.c >= 1 && m.c <= 3) {
      // Phone calls to Congress, on the player's word. At most six an hour count toward the national total, kept per
      // network address (a code is free with every connection, an address is not), and only from someone who is really here.
      const who = p.ip || p.code;
      let log = this.callers.get(who);
      if (!log || now - log.at > 3600000) this.callers.set(who, log = { at: now, n: 0 });
      const ok = now - p.joined > 20000 || p.dug > 0 ? Math.min(m.c, 6 - log.n) : 0;
      if (ok > 0) { log.n += ok; this.calls += ok; real = true; }
    }
    if (real) p.lastMsg = now;   // only real play keeps a seat; junk does not hold a room awake
  }

  webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ } this.drop(ws); }   // answer the browser's close, or its socket hangs half-shut for seconds
  webSocketError(ws) { this.drop(ws); }

  drop(ws) {
    const p = this.players.get(ws);
    if (!p) return;
    this.players.delete(ws);
    this.cast(JSON.stringify({ t: 'l', sid: p.sid }));
    if (p.dug > p.saved) this.persist(null, p);
    p.left = true;
    if (!this.players.size) { this.stop(); this.ctx.waitUntil(this.syncWorld(true)); }
  }

  start() { if (!this.timer) this.timer = setInterval(() => this.tickOnce(), N.sendMs); }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tickOnce() {
    const now = Date.now();
    this.ticks++;
    const ps = [];
    for (const [ws, p] of this.players) {
      p.msgs = 0;
      if (p.moved) { p.moved = false; ps.push([p.sid, p.x, p.z, p.yaw, p.flags, p.tier]); }
      if (now - p.lastMsg > N.idleKickSec * 1000) { this.kick(ws, 4000, 'idle'); continue; }
      // save every minute (N.saveEverySec), or sooner once a fifth more has been dug than is safely stored
      const unsaved = p.dug - p.saved;
      if (unsaved > 0 && (now - p.savedAt > N.saveEverySec * 1000 || (unsaved > Math.max(6, 0.2 * p.saved) && now - p.savedAt > 10000))) this.persist(ws, p);
    }
    if (ps.length) this.cast(JSON.stringify({ t: 'p', ps }));
    if (this.ticks % 1200 === 0) for (const [code, log] of this.callers) if (now - log.at > 3600000) this.callers.delete(code);
    if (this.ticks % Math.max(1, Math.round(N.syncMs / N.sendMs)) === 0 && !this.busy && this.players.size) this.syncWorld(false);
  }

  async syncWorld(leaving, joining = 0) {
    if (this.busy && !leaving) return;
    this.busy = true;
    const list = this.ops.splice(0), hits = this.hits.splice(0), calls = this.calls, count = this.players.size + joining;
    this.calls = 0;
    let sent = false;
    try {
      let res = await this.world.sync(this.name, count, this.since, list.map((o) => [o[0], o[1], o[2], o[3], o[5]]), hits, calls);
      sent = true;
      const gone = new Set();
      res.vols.forEach((v, i) => { if (v > 0) { const p = list[i][4]; p.dug += v; p.credit = true; if (p.left) gone.add(p); } });
      for (const p of gone) this.persist(null, p);   // someone who left while their last bites were on the way: one save, not one per bite
      const restarted = !!this.epoch && res.epoch !== this.epoch;
      let whole = false;
      if (restarted) {
        // The World restarted and may have lost its last few seconds. Give it our copy of the piles (lower wins, and
        // only for a pile no dirt bomb has refilled since), then ask again from the beginning so nothing is missed.
        await this.world.heal(this.cm, this.gen);
        res = await this.world.sync(this.name, count, 0, [], [], 0);
        whole = true;
      }
      // A dirt bomb put dirt back on a pile: our mirror of it is rebuilt from the World's whole copy, not merged.
      const regrown = CFG.giants.map((g, i) => !!this.gen && Array.isArray(res.gen) && res.gen[i] !== this.gen[i]);
      if (regrown.some(Boolean) && !whole) res = await this.world.sync(this.name, count, 0, [], [], 0);
      if (Array.isArray(res.gen)) this.gen = res.gen.slice();
      this.epoch = res.epoch;
      this.since = res.tick;
      for (const [ws, p] of this.players) {
        if (!p.credit) continue;
        p.credit = false;
        const t = tierFor(p.dug);
        if (t !== p.tier) { p.tier = t; p.moved = true; this.persist(ws, p); }   // a new tool is the one thing nobody should lose, and the room hears of it at once
        try { ws.send(JSON.stringify({ t: 'c', dug: Math.round(p.dug * 10) / 10 })); } catch (e) { /* closing */ }
      }
      res.cells.forEach((pairs, i) => {
        if (regrown[i]) {
          // everyone's browser replaces its pile with this one (frame kind 3: [3, giant, generation, ...every cell])
          const cm = this.cm[i] = this.fresh[i].slice();
          for (let j = 0; j < pairs.length; j += 2) cm[pairs[j]] = pairs[j + 1];
          const f = new Uint16Array(cm.length + 3); f[0] = 3; f[1] = i; f[2] = this.gen[i]; f.set(cm, 3);
          this.cast(f.buffer);
          return;
        }
        if (!pairs.length) return;
        for (let j = 0; j < pairs.length; j += 2) this.cm[i][pairs[j]] = Math.min(this.cm[i][pairs[j]], pairs[j + 1]);
        const f = new Uint16Array(pairs.length + 2); f[0] = 2; f[1] = i; f.set(pairs, 2);
        this.cast(f.buffer);
      });
      // tot / dg / calls: the numbers that grow with the crowd (everything ever dug, people on each pile, calls to Congress)
      const pace = { rate: res.rate, q: res.q, au: res.au, pm: res.pm, dn: res.dn, st: res.st, dl: res.dl, notice: res.notice, tot: res.tot, dg: res.dg, calls: res.calls,
        gen: res.gen, bombs: res.bombs, bomb: res.bomb }, key = JSON.stringify([res.mounds, res.online, pace]);
      if (key !== this.worldKey) { this.worldKey = key; this.mounds = res.mounds; this.online = res.online; this.pace = pace; this.cast(JSON.stringify({ t: 'w', mounds: res.mounds, online: res.online, ...pace })); }
      if (res.perIp > 0) this.perIp = res.perIp;
      // the "save everyone now" lever on the switch, pulled before a deploy
      if (this.fl !== null && res.fl > this.fl) for (const [ws, p] of this.players) if (p.dug > p.saved) this.persist(ws, p);
      this.fl = res.fl;
      // The World says fuller rooms have space for all of us: close up, and everyone's browser redials at once and lands
      // in one of them. Not while anything is unsettled (a join or leave in hand, a World or room that just started), and
      // not twice in half a minute.
      const now = Date.now();
      if (res.fold && !leaving && !joining && !restarted && now - this.bornAt > 60000 && now - this.foldAt > 30000) {
        this.foldAt = now;
        // everyone's digging is written down first, so the room each of them lands in a second later reads the right total
        await Promise.all([...this.players].filter(([, p]) => p.dug > p.saved).map(([ws, p]) => this.persist(ws, p)));
        for (const ws of [...this.players.keys()]) this.kick(ws, 4302, 'folding into a fuller room');
      }
    } catch (e) {
      console.log('world sync failed', e && e.message);
      this.world = this.worldStub();   // a stub that has thrown can stay broken for good; a new one costs nothing
      // The World never got this batch: send it again next second (dirt only goes down, so a repeat is harmless). Not
      // without limit, and not if it said it is overloaded: then it needs less from us, not more.
      if (!sent && !(e && e.overloaded) && this.ops.length + list.length <= 4000) { this.ops.unshift(...list); this.hits.unshift(...hits.slice(-400)); this.calls += calls; }
    } finally { this.busy = false; }
  }
}
