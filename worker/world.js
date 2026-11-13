import { DurableObject } from 'cloudflare:workers';
import { CFG, moundSpots, wavesWanted, digMul, lobbyHeat, lobbyAt } from '../shared/config.js';
import { DirtGrid } from '../shared/grid.js';

const N = CFG.net, P = CFG.pace, L = CFG.lobby, D = CFG.dirt, B = CFG.bomb, C = CFG.cost;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);   // the UTC day the spending guard counts in
const STATES = ['play', 'in', 'out'];
// Folding thin rooms after a peak: a room under `under` players that nobody has been sent to for `settleMs` is told to
// close when fuller rooms have room for all of it and `spare` more. One fold every `everyMs`, so the counts catch up between two.
const FOLD = { under: 12, settleMs: 60000, everyMs: 3000, spare: 4, startMs: 90000 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sig = (v) => Number(v.toPrecision(3));
const fin = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// The one true copy of both dirt piles and every lobby mound. Players never talk to it directly: rooms send it
// their players' digs in a batch once a second and get back what changed, so its load grows with the number of
// rooms, not the number of players. It also sets the pace: how much each dig counts for (see CFG.pace).
export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const each = (v) => CFG.giants.map(() => v);
    this.grids = CFG.giants.map((g, i) => new DirtGrid(g, i + 1));
    this.stamp = this.grids.map((g) => new Uint32Array(g.h.length));   // tick at which each cell last changed
    this.sent = this.grids.map((g) => g.toCm());                       // the whole-centimetre value last announced per cell
    // The switch: per man 'play' (clock running), 'in' (he was elected: frozen) or 'out' (gone in real life:
    // supercharged digging, no clock). Deadlines, a fixed rate per man and the pacing numbers can all be changed live.
    // `over` holds only what has been set by hand; everything else follows the code, so a later deploy still counts.
    this.over = { state: each(null), deadline: each(null), fixed: each(null) };
    this.since = each(Date.now());   // when each man's current schedule began (pacing aims at a fixed finish time)
    this.rebuild();
    this.spend = { day: dayOf(Date.now()), usd: 0 };   // today's estimated bill (CFG.cost)
    this.peak = { n: 0, at: 0 };   // the most people ever in the shared dig at once, and when
    this.base = each(0);             // ...and how far out he already was at that moment
    // q: real cubic metres one digger-second is worth on each pile right now. diggers: how many people were at it lately.
    this.q = each(0); this.diggers = each(0); this.work = each(0); this.real = each(0);
    this.lastTune = Date.now();
    // quiet: milliseconds, with somebody online, since a mound was last open. waveAt: when that was last counted.
    this.mounds = moundSpots().map(() => 0); this.waves = 0; this.quiet = 0; this.waveAt = Date.now();
    // tot: full-strength cubic metres everyone has ever dug. calls: phone calls to Congress players have logged.
    this.tot = 0; this.calls = 0;
    // Dirt bombs (CFG.bomb). gen: each pile's fill generation, bumped whenever dirt goes back UP, so rooms and browsers
    // know to replace their copy instead of keeping the lower of two values. bomb: the one in progress, if any.
    this.gen = each(0); this.bomb = null; this.bombs = 0; this.lastBomb = 0;
    this.tick = 1;
    this.epoch = crypto.randomUUID();   // changes whenever this object restarts, so rooms can tell
    this.born = Date.now();
    this.rooms = new Map();             // name -> { count, seen, at: when a seat was last handed out, born, shut: no new seats until then }
    this.flush = 0; this.foldAt = 0;
    this.dirty = false; this.alarmSet = false;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get(['g0', 'g1', 't0', 't1', 'm2', 'over', 'since', 'base', 'for', 'left', 'tot', 'calls', 'bomb', 'spend', 'peak']);
      this.grids.forEach((g, i) => {
        const t = saved.get('t' + i), cm = saved.get('g' + i);
        if (t) {   // thickness in metres, as floats
          const a = new Float32Array(t);
          for (let k = 0; k < a.length && k < g.h.length; k++) { const v = g.floor[k] + Math.max(0, a[k]); if (v < g.h[k]) { g.h[k] = v; this.stamp[i][k] = 1; } }
        } else if (cm) {   // the older format: whole centimetres
          const a = new Uint16Array(cm);
          for (let k = 0; k < a.length && k < g.h.length; k++) if (g.mergeCm(k, a[k])) this.stamp[i][k] = 1;
        }
        g.recount();
        const left = saved.get('left');
        if (Array.isArray(left) && Number.isFinite(left[i])) g.left = Math.min(g.left, left[i]);
        this.sent[i] = g.toCm();
      });
      const m = saved.get('m2');
      if (m && Array.isArray(m.hp)) { m.hp.forEach((hp, i) => { if (i < this.mounds.length) this.mounds[i] = hp; }); this.waves = m.waves | 0; this.quiet = fin(m.quiet, 0, 1e9) ?? 0; }
      this.tot = fin(saved.get('tot'), 0, 1e15) ?? 0; this.calls = fin(saved.get('calls'), 0, 1e12) ?? 0;
      const bm = saved.get('bomb');
      if (bm && typeof bm === 'object') {
        if (Array.isArray(bm.gen)) bm.gen.forEach((v, i) => { if (i < this.gen.length && Number.isInteger(v)) this.gen[i] = v; });
        this.bombs = fin(bm.bombs, 0, 1e9) ?? 0; this.lastBomb = fin(bm.last, 0, 1e14) ?? 0;
      }
      const pk = saved.get('peak');
      if (pk && typeof pk === 'object') this.peak = { n: fin(pk.n, 0, 1e7) ?? 0, at: fin(pk.at, 0, 1e14) ?? 0 };
      const sp = saved.get('spend');
      if (sp && sp.day === this.spend.day) this.spend.usd = fin(sp.usd, 0, 1e9) ?? 0;
      const s = saved.get('since');
      if (Array.isArray(s)) s.forEach((v, i) => { if (i < this.since.length && Number.isFinite(v)) this.since[i] = v; });
      const b = saved.get('base');
      if (Array.isArray(b)) b.forEach((v, i) => { if (i < this.base.length && Number.isFinite(v)) this.base[i] = v; });
      else { this.since = this.since.map(() => Date.now()); this.base = this.grids.map((g, i) => this.prog(i)); }   // first run of this pacing: every schedule starts from where its pile is now
      const o = saved.get('over');
      if (o) { this.applyControl(o, true); this.rebuild(); }
      // a schedule belongs to one deadline: if the date is not the one it was drawn for (a deploy moved it), draw a new one from here
      const f = saved.get('for');
      let redrawn = !Array.isArray(s) || !Array.isArray(b) || !Array.isArray(f);
      this.ctl.deadline.forEach((d, i) => { if (Array.isArray(b) && Array.isArray(f) && f[i] !== d) { this.since[i] = Date.now(); this.base[i] = this.prog(i); redrawn = true; } });
      if (redrawn) await ctx.storage.put({ since: this.since, base: this.base, for: this.ctl.deadline });
      this.tick = 2;
      this.tune(Date.now(), true);
    });
  }

  online() {
    const now = Date.now();
    let n = 0;
    // a room we have never heard from holds only seats we handed out ourselves: if it stays silent they were refused or never arrived
    for (const [name, r] of this.rooms) { if (now - r.seen > (r.heard ? 20000 : 4000)) this.rooms.delete(name); else n += r.count; }
    return n;
  }

  // Which room should a new player join? Fill the fullest room that still has space, so as few rooms as possible stay awake.
  assign() {
    const now = Date.now();
    if (this.online() >= this.ctl.maxPlayers || this.limited(now) > 0) return null;
    this.charge(now, C.join);
    let best = null;
    for (const [name, r] of this.rooms) if (r.count < N.roomSize && now >= r.shut && (!best || r.count > this.rooms.get(best).count)) best = name;
    if (!best) { let i = 1; while (this.rooms.has('r' + i)) i++; best = 'r' + i; this.rooms.set(best, { count: 0, seen: now, at: 0, born: now, shut: 0 }); }
    const r = this.rooms.get(best);
    r.count++; r.at = now;
    return best;
  }

  // A room reports how many it holds. For three seconds after a seat was handed out its own number lags ours (people are
  // still on their way in), so it may not pull the count back down: that is how a new room got filled twice over in a rush.
  report(room, count, now) {
    let r = this.rooms.get(room);
    const held = !!r && now - r.at < 3000;
    if (count <= 0 && !held) { this.rooms.delete(room); return null; }
    if (!r) this.rooms.set(room, r = { count: 0, seen: now, at: 0, born: now, shut: 0 });
    else this.charge(now, clamp((now - r.seen) / 1000, 0, 5) * (C.roomSec + Math.max(0, count) * C.playerSec));
    r.count = held ? Math.max(count, r.count) : count; r.seen = now; r.heard = true;
    return r;
  }

  // A room turned someone away at the door: that seat was never taken, so hand it back. Otherwise refused knocks pile up
  // as phantom players until the game reads as full.
  release(room) {
    const r = this.rooms.get(room);
    if (!r) return;
    r.count = Math.max(0, r.count - 1);
    if (!r.heard && !r.count) this.rooms.delete(room);
  }

  // ---- the spending guard (CFG.cost). Add an estimated cost to today's running total; a new UTC day starts from 0.
  charge(now, usd) {
    const day = dayOf(now);
    if (day !== this.spend.day) this.spend = { day, usd: 0 };
    this.spend.usd += usd;   // written down with the next save of the piles (no extra writes just for this)
  }
  // 0 = within budget; 1 = over it (nobody new is seated); 2 = far over it (every room closes too). Until the next UTC day.
  limited(now) {
    const per = this.ctl.perDay;
    if (!(per > 0) || dayOf(now) !== this.spend.day) return 0;
    return this.spend.usd >= per * C.stopMul ? 2 : this.spend.usd >= per ? 1 : 0;
  }

  // After the peak: should this thin room close, so its people land in fuller ones? Only when we are sure. Never just
  // after we restarted (our list of rooms is still filling in), never a room that is new or still being sent people,
  // never near the cap, and only into rooms that are fuller, heard from lately and have space to spare.
  fold(room, r, now) {
    if (r.count >= FOLD.under || now < r.shut || now - this.born < FOLD.startMs || now - this.foldAt < FOLD.everyMs || now - r.born < FOLD.settleMs || now - r.at < FOLD.settleMs) return false;
    if (this.online() > this.ctl.maxPlayers - 2 * N.roomSize) return false;
    let free = 0;
    for (const [name, o] of this.rooms) if (o !== r && now >= o.shut && now - o.seen < 5000 && (o.count > r.count || (o.count === r.count && name < room))) free += Math.max(0, N.roomSize - o.count);
    if (free < r.count + FOLD.spare) return false;
    this.foldAt = now; r.shut = now + 10000;   // and nobody new is sent there while it empties
    return true;
  }

  // Can this man still be dug at? Not once he is out of the dirt, elected, or (while his clock runs) past his deadline.
  active(i, now) {
    if (this.grids[i].done) return false;
    const s = this.ctl.state[i];
    return s === 'out' || (s === 'play' && now < this.ctl.deadline[i]);
  }

  // Cubic metres a second this pile has to lose from now on to be finished just before his deadline.
  need(i, now) {
    const dl = this.ctl.deadline[i], finishAt = dl - (1 - this.ctl.finishBy) * Math.max(0, dl - this.since[i]);
    return this.rem(i) / Math.max(P.tuneSec, (finishAt - now) / 1000);
  }
  rem(i) { const g = this.grids[i]; return Math.max(0, g.left - g.total * (1 - D.doneAt)); }
  // How much of the diggable pile is gone, 0 to 1.
  prog(i) { const g = this.grids[i]; return 1 - this.rem(i) / (g.total * D.doneAt); }
  // How far the pile is ahead of its schedule (a straight line from where it was to gone at the finish time), as a
  // fraction of the pile. Negative when behind.
  ahead(i, now) {
    const dl = this.ctl.deadline[i], finishAt = dl - (1 - this.ctl.finishBy) * Math.max(0, dl - this.since[i]);
    const due = this.base[i] + (1 - this.base[i]) * clamp((now - this.since[i]) / Math.max(1, finishAt - this.since[i]), 0, 1);
    return this.prog(i) - due;
  }
  // Cubic metres a second a crowd of shovels may take right now: `burst` times what is needed, until the pile is half
  // of `lead` ahead of schedule; from there it fades, so the pile never runs much more than `lead` ahead.
  speed(i, now) { const c = this.ctl; return this.need(i, now) * Math.max(P.floor, c.burst * clamp(2 * (1 - this.ahead(i, now) / c.lead), 0, 1)); }
  // The most one digger-second can ever be worth. With `target` set, a pile needs about that many shovels' worth of
  // digging around the clock to finish on time; a thinner crowd falls behind for good, which is how the game is lost.
  most(i) {
    const c = this.ctl, dl = c.deadline[i], finishAt = dl - (1 - c.finishBy) * Math.max(0, dl - this.since[i]);
    if (!(c.target > 0)) return Infinity;
    return this.grids[i].total * D.doneAt * (1 - this.base[i]) / Math.max(1, (finishAt - this.since[i]) / 1000) / c.target;
  }
  auto(i) { return this.ctl.state[i] === 'play' && this.ctl.fixed[i] == null; }
  // How many times its normal depth one bite of this tool takes out of this pile.
  mul(i, tier) {
    const c = this.ctl;
    if (c.state[i] === 'out') return P.superRate;
    if (c.fixed[i] != null) return c.fixed[i];
    return digMul(this.q[i], tier, [c.min, c.max, c.boost]);
  }

  // Every few seconds: count how many people are digging each pile and share the allowed speed out between them.
  // The count is of people, not of dirt, so a better tool is never cancelled out: it multiplies its owner's share.
  tune(now, force) {
    const dt = (now - this.lastTune) / 1000;
    if (dt >= P.tuneSec) {
      this.lastTune = now;
      this.grids.forEach((g, i) => { this.diggers[i] = this.work[i] / dt; this.work[i] = this.real[i] = 0; });
      if (this.rooms.size) this.charge(now, Math.min(dt, 60) * C.worldSec);
    } else if (!force) return;
    this.grids.forEach((g, i) => { this.q[i] = Math.min(this.speed(i, now) / Math.max(1, this.diggers[i]), this.most(i)); });
  }

  // ops: [x, z, r, depth, tier] already checked against the player's tool by the room. hits: [moundIndex, damage].
  // calls: phone calls to Congress the room's players logged since last time (already rate-limited per player).
  // Returns what each op earned its player (full-strength volume, whatever the pile's rate), and every cell that
  // changed since the room's last call.
  sync(room, count, since, ops, hits, calls = 0) {
    const now = Date.now(), vols = new Array(ops.length).fill(0), c = this.ctl;
    const here = this.report(room, count, now);
    const on = this.online();
    if (on > this.peak.n) { this.peak = { n: on, at: now }; this.dirty = true; }
    if (calls >= 1) { this.calls += Math.min(Math.floor(calls), 3 * N.roomSize); this.dirty = true; }
    this.tune(now);
    this.bombTick(now);
    // a dirt storm: everything stops. Digs and mound hits that arrive during one simply do not land (and earn nothing).
    const storm = !!this.bomb && now < this.bomb.end;
    if (storm) { ops = []; hits = []; }
    if (ops.length || hits.length) this.tick++;
    const live = this.grids.map((g, i) => this.active(i, now));
    ops.forEach(([x, z, r, depth, tier], oi) => {
      if (!CFG.tools[tier]) return;
      this.grids.forEach((g, i) => {
        if (!live[i] || !g.inside(x, z)) return;
        const auto = this.auto(i), st = this.stamp[i], sent = this.sent[i], t = this.tick;
        // a sudden crowd between two counts: once twice the people we shared the speed between have shown up, halve every share on the spot
        if (auto && this.work[i] > 2 * Math.max(1, this.diggers[i]) * P.tuneSec + 3) { this.diggers[i] = 2 * Math.max(1, this.diggers[i]); this.q[i] /= 2; }
        const rate = this.mul(i, tier);
        const v = g.dig(x, z, r, depth * rate, (k) => { const cm = g.cm(k); if (cm !== sent[k]) { sent[k] = cm; st[k] = t; } });
        if (v <= 0) return;
        // a full bite is one tool cycle of somebody's time; a bite that found half the dirt counts as half a person, and a
        // bite that moved next to nothing as next to nobody, so empty digging cannot soak up everyone else's share
        this.work[i] += CFG.tools[tier].period * Math.min(1, v / rate / (Math.PI * r * r * CFG.tools[tier].depth / 2));
        vols[oi] += v / rate; this.tot += v / rate; this.real[i] += v; this.dirty = true;
        if (auto && this.rem(i) < 0.5) g.left = Math.min(g.left, g.total * (1 - D.doneAt));   // the last crumbs: call it done
        if (g.done) live[i] = false;
      });
    });
    // a mound costs each person about the same effort however many are here
    const ms = c.state.some((s, i) => s === 'out' && live[i]) ? P.superRate : L.hitMul / Math.max(1, this.online() / L.perMound);
    for (const [i, dmg] of hits) if (this.mounds[i] > 0) { this.mounds[i] = Math.max(0, this.mounds[i] - dmg * ms); this.dirty = true; }
    this.openWaves(now);
    if (this.dirty && !this.alarmSet) { this.alarmSet = true; this.ctx.storage.setAlarm(now + 5000); }
    const cells = this.grids.map((g, i) => {
      const st = this.stamp[i], out = [];
      for (let k = 0; k < st.length; k++) if (st[k] > since) out.push(k, g.cm(k));
      return new Uint16Array(out);
    });
    // mound health to one decimal, so that in a crowd (where one hit is a sliver) a hit still shows; never 0 while it stands
    return { tick: this.tick, epoch: this.epoch, vols, cells, mounds: this.mounds.map((h) => (h > 0 ? Math.max(0.1, Math.round(h * 10) / 10) : 0)), online: this.online(),
      tot: Math.round(this.tot), dg: this.diggers.map(Math.round), calls: this.calls, perIp: c.perIp, fl: this.flush, fold: !!here && count > 0 && (this.limited(now) > 1 || this.fold(room, here, now)),
      gen: this.gen, bombs: this.bombs, bomb: this.bombNews(now),
      rate: this.grids.map((g, i) => this.mul(i, 0)), q: this.grids.map((g, i) => (this.auto(i) ? sig(this.q[i]) : 0)), au: this.grids.map((g, i) => (this.auto(i) ? 1 : 0)), pm: [c.min, c.max, c.boost], dn: this.grids.map((g) => g.done), st: c.state, dl: c.deadline, notice: c.notice };
  }

  // The lobbies respond to the danger their men are in: mounds open one at a time as the piles go down, and more
  // of them may be open at once the lower the piles are and the more people are digging (lobbyHeat).
  openWaves(now) {
    if (!this.grids.some((g, i) => this.active(i, now))) return;
    const n = this.mounds.length, prog = this.grids.reduce((s, g) => s + Math.min(1, g.progress / D.doneAt), 0) / this.grids.length;
    const cap = lobbyAt(lobbyHeat(prog, this.diggers.reduce((x, y) => x + y, 0))).maxOpen;
    let want = wavesWanted(prog);
    if (want - this.waves > 3) this.waves = want - 3;   // never a long queue of them after a big jump
    // ...and the lobbies never stay away for long: quietSec with somebody online and nothing open, and the next one opens
    // anyway (practice mode in the browser does the same). Time with nobody here does not count.
    const dt = Math.min(5000, now - this.waveAt);
    this.waveAt = now;
    if (this.mounds.some((h) => h > 0)) this.quiet = 0;
    else if (this.online() > 0 && (this.quiet += dt) > L.quietSec * 1000 && want <= this.waves) want = this.waves + 1;
    while (this.waves < want && this.mounds.filter((h) => h > 0).length < cap) {
      let i = this.waves % n, tries = 0;
      while (this.mounds[i] > 0 && tries++ < n) i = (i + 1) % n;
      this.mounds[i] = L.moundHp; this.waves++; this.quiet = 0; this.dirty = true;
    }
  }

  // ---- dirt bombs. Checked on every sync: is a pile so far ahead of its schedule that its lobby panics?
  bombTick(now) {
    const b = this.bomb;
    if (b) {
      if (!b.done && now >= b.hit) { b.done = true; this.refill(b); }
      if (now >= b.end) this.bomb = null;
      return;
    }
    const c = this.ctl;
    if (!(c.bombAt > 0) || now - this.lastBomb < c.bombEvery * 60000 || this.online() === 0) return;
    // the pile furthest ahead of its own schedule gets it (not simply the first in the list: that one would be bombed
    // every other time while the other, as far or further ahead, waited twice as long)
    let pick = -1, most = c.bombAt;
    for (let i = 0; i < this.grids.length; i++) { const a = this.ahead(i, now); if (this.auto(i) && this.active(i, now) && a > most) { pick = i; most = a; } }
    if (pick >= 0) this.startBomb(pick, now, false);
  }
  // The lobbies take turns: whoever is next in CFG.lobbies drops this one. The size is set now, from how far ahead the
  // pile is (a bomb from the switch is always the most a bomb may be).
  startBomb(i, now, byHand) {
    const share = byHand ? B.most : clamp(this.ahead(i, now) - B.to, 0, B.most);
    this.bomb = { id: this.bombs + 1, i, lobby: CFG.lobbies[this.bombs % CFG.lobbies.length].id, hit: now + B.warnSec * 1000, end: now + B.stormSec * 1000,
      vol: share * this.grids[i].total * D.doneAt, done: false };
    this.bombs++; this.lastBomb = now; this.dirty = true;
  }
  // Impact. The dirt goes back on, every changed cell is marked so rooms hear of it, and the generation moves on so they
  // replace their copy rather than merge it. Written to disk at once: a restart must not lose dirt that went back UP.
  refill(b) {
    const g = this.grids[b.i];
    if (g.done) return;
    this.tick++;
    const st = this.stamp[b.i], sent = this.sent[b.i], t = this.tick;
    b.poured = g.refill(b.vol, (k) => { const cm = g.cm(k); if (cm !== sent[k]) { sent[k] = cm; st[k] = t; } });
    this.gen[b.i] = (this.gen[b.i] + 1) % 65536;
    this.dirty = true;
    this.save().catch(() => {});
  }
  // What rooms pass on to browsers: times are milliseconds from now, so nobody's clock has to agree with ours.
  bombNews(now) {
    const b = this.bomb;
    return b && now < b.end ? { id: b.id, i: b.i, lobby: b.lobby, hit: b.hit - now, end: b.end - now } : null;
  }

  // A room's copy of the piles, offered after we restarted: anything it has lower than us was dug before we lost it.
  // Only a copy from the same fill generation: one from before a dirt bomb would dig the bomb's dirt straight back out.
  heal(cms, gens) {
    let any = false;
    this.grids.forEach((g, i) => {
      const a = cms[i], was = g.left;
      let merged = false;
      if (!a || (Array.isArray(gens) && gens[i] !== this.gen[i])) return;
      for (let k = 0; k < a.length && k < g.h.length; k++) if (g.mergeCm(k, a[k])) { merged = true; if (!any) { any = true; this.tick++; } this.stamp[i][k] = this.tick; this.sent[i][k] = g.cm(k); }
      if (merged) { g.recount(); g.left = Math.min(g.left, was); }   // never back up: a pile called finished with crumbs left stays finished
    });
    if (any) { this.dirty = true; if (!this.alarmSet) { this.alarmSet = true; this.ctx.storage.setAlarm(Date.now() + 5000); } }
    return any;
  }

  // Dirt is written to disk at most once every five seconds, however many people are digging.
  async alarm() {
    this.alarmSet = false;
    if (this.dirty) await this.save();
  }
  async save() {
    this.dirty = false;
    try {
      const put = { m2: { hp: this.mounds, waves: this.waves, quiet: this.quiet }, left: this.grids.map((g) => g.left), tot: this.tot, calls: this.calls,
        bomb: { gen: this.gen, bombs: this.bombs, last: this.lastBomb }, spend: this.spend, peak: this.peak };
      this.grids.forEach((g, i) => { put['t' + i] = Float32Array.from(g.h, (v, k) => v - g.floor[k]).buffer; });
      await this.ctx.storage.put(put);
    } catch (e) {
      this.dirty = true;   // the alarm is retried, or the next dig schedules another
      throw e;
    }
  }

  // Today's settings: what the code says, with anything set by hand on top.
  rebuild() {
    const o = this.over;
    this.ctl = { state: o.state.map((s) => s || 'play'), deadline: CFG.giants.map((g, i) => o.deadline[i] ?? Date.parse(g.deadline)), fixed: o.fixed.slice(),
      min: o.min ?? P.min, max: o.max ?? P.max, burst: o.burst ?? P.burst, target: o.target ?? P.target, lead: o.lead ?? P.lead, boost: o.boost ?? P.boost, finishBy: o.finishBy ?? P.finishBy, bombAt: o.bombAt ?? B.at, bombEvery: o.bombEvery ?? B.gapSec / 60, notice: o.notice || '',
      // the two crowd limits: seats in the whole game, and connections one network address may hold in one room
      maxPlayers: Math.floor(o.maxPlayers ?? N.maxPlayers), perIp: Math.floor(o.perIp ?? N.perIp),
      perDay: o.perDay ?? C.perDay };   // the spending guard's daily budget in dollars (0 = none)
    if (this.ctl.min > this.ctl.max) this.ctl.min = this.ctl.max;
  }

  // Take whatever parts of a settings object are valid; ignore the rest. null hands a setting back to the code.
  applyControl(p, loading) {
    const o = this.over;
    if (!p || typeof p !== 'object') return;
    CFG.giants.forEach((g, i) => {
      if (Array.isArray(p.state) && i in p.state) { if (STATES.includes(p.state[i])) o.state[i] = p.state[i]; else if (p.state[i] === null) o.state[i] = null; }
      if (Array.isArray(p.deadline) && i in p.deadline) {
        const d = typeof p.deadline[i] === 'string' ? Date.parse(p.deadline[i]) : p.deadline[i], was = o.deadline[i];
        if (d === null) o.deadline[i] = null; else if (fin(d, 1e12, 1e14) !== null) o.deadline[i] = d;
        if (!loading && o.deadline[i] !== was) { this.since[i] = Date.now(); this.base[i] = this.prog(i); }   // a new date starts a new schedule from where the pile is
      }
      if (Array.isArray(p.fixed) && i in p.fixed) o.fixed[i] = fin(p.fixed[i], 1e-9, 1000);   // anything else clears it
    });
    for (const [k, lo, hi] of [['min', 1e-9, 1000], ['max', 1e-9, 1000], ['burst', 1, 10000], ['target', 0, 100000], ['lead', 0.001, 1], ['boost', 1, 3], ['finishBy', 0.05, 1], ['bombAt', 0, 1], ['bombEvery', 1, 100000], ['maxPlayers', 0, 100000], ['perIp', 1, 1000], ['perDay', 0, 100000]]) {
      if (p[k] === null) delete o[k]; else if (fin(p[k], lo, hi) !== null) o[k] = p[k];
    }
    if (typeof p.notice === 'string') o.notice = p.notice.replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 140);
  }

  // The private switch (see /api/admin). Saved at once; rooms pick it up within a second.
  // flush: true is the lever to pull before a deploy: every room writes its players' unsaved digging, and we write the piles.
  // tot / calls set the two national counters by hand (after a load test, say).
  async control(patch) {
    if (patch) {
      this.applyControl(patch);
      this.rebuild();
      if (fin(patch.tot, 0, 1e15) !== null) this.tot = patch.tot;
      if (fin(patch.calls, 0, 1e12) !== null) this.calls = Math.floor(patch.calls);
      if (patch.flush === true) this.flush = Date.now();
      // "drop one now", from the switch: on pile 0 or 1, whatever the schedule says (but never two at once)
      if (Number.isInteger(patch.bomb) && this.grids[patch.bomb] && !this.bomb && this.active(patch.bomb, Date.now())) this.startBomb(patch.bomb, Date.now(), true);
      await this.ctx.storage.put({ over: this.over, since: this.since, base: this.base, for: this.ctl.deadline });
      await this.save();
      this.tune(Date.now(), true);
    }
    const now = Date.now();
    return { ...this.status(), control: this.ctl, setByHand: this.over, codeDeadline: CFG.giants.map((g) => Date.parse(g.deadline)), flushedAt: this.flush,
      needPerSec: this.grids.map((g, i) => this.need(i, now)), speed: this.grids.map((g, i) => this.speed(i, now)), ahead: this.grids.map((g, i) => this.ahead(i, now)), diggers: this.diggers, left: this.grids.map((g, i) => this.rem(i)),
      shovelMul: this.grids.map((g, i) => this.mul(i, 0)), topMul: this.grids.map((g, i) => this.mul(i, CFG.tools.length - 1)), moundHp: this.mounds, waves: this.waves, defaults: { ...P, bombAt: B.at, bombEvery: B.gapSec / 60, maxPlayers: N.maxPlayers, perIp: N.perIp, perDay: C.perDay },
      spend: { day: this.spend.day, usd: this.spend.usd, limited: this.limited(now), stopAt: this.ctl.perDay * C.stopMul },
      bomb: this.bombNews(now), bombs: this.bombs, lastBomb: this.lastBomb, gen: this.gen };
  }

  status() {
    const now = Date.now();
    this.tune(now);   // so the digger counts fall to nothing when everyone has gone home
    return { online: this.online(), rooms: this.rooms.size, tot: Math.round(this.tot), dg: this.diggers.map(Math.round), calls: this.calls,
      giants: this.grids.map((g, i) => ({ name: g.giant.name, progress: +g.progress.toFixed(4), done: g.done, state: this.ctl.state[i], deadline: new Date(this.ctl.deadline[i]).toISOString(), active: this.active(i, now) })),
      moundsOpen: this.mounds.filter((h) => h > 0).length, limited: this.limited(now), peak: this.peak.n, peakAt: this.peak.at ? new Date(this.peak.at).toISOString() : null };
  }
}
