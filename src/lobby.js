import * as THREE from 'three';
import { CFG, moundSpots, wavesWanted, lobbyHeat, lobbyAt, lobbyStep, hivesOpen, crowdShare } from './config.js';
import { ps1ify, textTex } from './ps1.js';
import { person, model, attach } from './assets.js';
import { worldH } from './world.js';

const L = CFG.lobby;
const TOUCH = matchMedia('(pointer: coarse)').matches;
const BEAM = new THREE.BoxGeometry(1.6, 150, 1.6);
const BONK = ['BONK', 'THWACK', 'NO COMMENT', 'DECLINED', 'POW', 'I WILL CIRCLE BACK', 'PER MY LAST EMAIL', 'BILLABLE!'];
// What each lobby's people say as they walk out of the mound. Parody one-liners, nobody's real words.
const BARKS = {
  aipac: ['HAVE YOU CONSIDERED A FACT-FINDING TRIP?', 'WE JUST WANT TO TALK', 'THIS DIG IS VERY COMPLICATED'],
  insurance: ['THAT SHOVEL IS OUT OF NETWORK', 'HAVE YOU MET YOUR DEDUCTIBLE?', 'DIGGING IS A PRE-EXISTING CONDITION'],
  pharma: ['ASK YOUR DOCTOR IF DIGGING IS RIGHT FOR YOU', 'SIDE EFFECTS MAY INCLUDE NEW LEADERSHIP', 'THE PRICE OF DIRT JUST WENT UP'],
  oil: ['THIS DIG NEEDS A PIPELINE', 'WE PREFER THE TERM "ENERGY MOUND"', 'DRILL, DO NOT DIG'],
  wallst: ['WE WOULD LIKE TO ACQUIRE YOUR HOLE', 'YOUR SHOVEL IS UNDERPERFORMING', 'THE MARKET HATES UNCERTAINTY'],
  tech: ['WE VALUE YOUR PRIVACY (APPRAISED AT $4)', 'PLEASE ACCEPT ALL COOKIES', 'DIGGING IS NOW A SUBSCRIPTION'],
};
const PAPER = [0xffffff, 0xe8e0c8, 0xd9d2bb];
const glowMat = {};

// Lobby mounds are dotted around the grounds but stay shut until the dig alarms them. An open mound keeps sending
// lobbyists at you until it is flattened. Mound health is shared; the lobbyists themselves are yours alone.
// They come thicker and faster the lower the pile nearest you is and the more people are digging (CFG.lobby.steps),
// and thicker still, throwing from further off, the bigger your machine; they walk faster and throw more often with heat.
export class Lobby {
  constructor(game) {
    this.game = game;
    this.mounds = []; this.agents = []; this.shots = [];
    this.spawning = 0; this.waves = 0; this.waveT = 0;
    this.heat = 0; this.heatT = 1; this.now = lobbyAt(0);   // now = the lobby numbers at the current heat
    this.hives = L.steps[0][1]; this.per = L.steps[0][2]; this.perMound = this.per; this.every = L.steps[0][3]; this.range = L.range;
  }

  async build(saved) {
    const proto = await model('/models/world/lobby_mound.glb');
    for (const { i, lobby, x, z } of moundSpots()) {
      const root = new THREE.Group();
      root.position.set(x, worldH(x, z), z);
      root.rotation.y = Math.atan2(-x, 30 - z);
      if (proto) root.add(proto.root.clone());
      else { const m = new THREE.Mesh(new THREE.ConeGeometry(4.5, 5, 7), ps1ify(new THREE.MeshLambertMaterial({ color: 0x6b4f2e }))); m.position.y = 2.5; root.add(m); }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.45), ps1ify(new THREE.MeshLambertMaterial({ map: textTex(lobby.name, lobby.color) })));
      const mark = root.getObjectByName('Sign');
      if (mark) { mark.getWorldPosition(sign.position); root.worldToLocal(sign.position); } else sign.position.set(0, 7.2, -0.5);
      sign.position.z += 0.12;
      root.add(sign);
      // a tall pillar of the lobby's colour over an open mound, drawn through the fog, so "find their nest" is possible from either pile
      const col = lobby.color === '#222222' ? '#777777' : lobby.color;
      const beam = new THREE.Mesh(BEAM, glowMat[col] ||= new THREE.MeshBasicMaterial({ color: col, fog: false, transparent: true, opacity: 0.45, depthWrite: false }));
      beam.position.y = 80;
      root.add(beam);
      this.mounds.push({ i, lobby, x, z, hp: 0, root, timer: 3, alive: 0, y: root.position.y, sink: 0, hitT: 0 });
    }
    if (saved && Array.isArray(saved.hp)) { this.apply(saved.hp, true); this.waves = saved.waves | 0; }
    this.briefcase = await model('/models/world/briefcase.glb');
  }

  get moundsLeft() { return this.mounds.filter((m) => m.hp > 0).length; }

  // Set one mound's health. Going from nothing to something is the lobby mobilising; reaching nothing flattens it.
  set(m, hp, quiet) {
    const g = this.game, was = m.hp;
    hp = Math.max(0, hp);
    if (hp === was) return;
    m.hp = hp;
    m.root.scale.setScalar(0.6 + 0.4 * Math.min(1, hp / L.moundHp));
    if (was <= 0) {
      g.scene.add(m.root); m.timer = 3; m.sink = 0; m.root.position.y = m.y; m.root.rotation.z = 0;
      person(CFG.suits[m.i % CFG.suits.length]);   // have its first lobbyist's file on the way before the door opens
      if (!quiet) g.hud.toast(`${m.lobby.name} IS MOBILISING\nfind their nest and flatten it`, 4);
      g.bus.emit('moundOpen', { mound: m, quiet: !!quiet });
    } else if (hp <= 0) {
      if (quiet) g.scene.remove(m.root); else m.sink = 1.4;   // it shudders into the ground (see update)
      g.puff(m.x, m.root.position.y + 2, m.z, 22, 4);
      if (!quiet) g.hud.toast(`${m.lobby.name} NEST FLATTENED`, 3);
      g.bus.emit('moundDown', { mound: m, quiet: !!quiet });
    } else if (hp < was && !quiet) { m.hitT = 0.25; g.puff(m.x, m.root.position.y + 2, m.z, 6, 2); g.bus.emit('moundHit', { mound: m, hp, was }); }
  }
  // The server's word on every mound (or a practice save).
  apply(list, quiet) { if (list) for (const m of this.mounds) this.set(m, list[m.i] || 0, quiet); }

  async spawn(m) {
    if (this.spawning > 3) return;
    this.spawning++;
    const who = CFG.suits[(m.i + (m.alive % 2) * 3) % CFG.suits.length];   // two faces per mound, so their files are soon cached
    const p = await person(who) || await person('Male_Adult_01');
    this.spawning--;
    if (!p || m.hp <= 0) return;
    const hand = p.bone('L_Hand');
    if (hand && this.briefcase) attach(hand, this.briefcase.root.clone());
    const a = { p, m, lobby: m.lobby, hp: L.lobbyistHp, cd: 1 + Math.random() * 2, kb: new THREE.Vector3(),
      pos: new THREE.Vector3(m.x + Math.sin(m.root.rotation.y) * 5.5, 0, m.z + Math.cos(m.root.rotation.y) * 5.5), yaw: m.root.rotation.y };
    a.pos.y = this.game.surface(a.pos.x, a.pos.z);
    m.alive++;
    this.game.scene.add(p.root);
    this.agents.push(a);
    const lines = BARKS[m.lobby.id];
    if (lines && a.pos.distanceTo(this.game.player.pos) < 45) this.game.hud.say(lines[Math.floor(Math.random() * lines.length)], a.pos.x, a.pos.y + 2.6, a.pos.z, 3.5, 'lobby');
    this.game.puff(a.pos.x, a.pos.y + 0.5, a.pos.z, 6, 1.5);
    this.game.bus.emit('agentSpawn', { agent: a, mound: m, lobby: m.lobby });
  }

  // The player's tool landed here. Anyone in a suit under it is done for; mounds in reach take the tool's damage.
  strike(x, z, r, dmg, bought) {
    const g = this.game, t = g.player.toolCfg;
    for (const a of this.agents) if (a.hp > 0 && Math.hypot(a.pos.x - x, a.pos.z - z) < r + 0.6) { a.hp = 0; a.flash = 0.15; a.kb.set(a.pos.x - x, 0, a.pos.z - z).setLength(6); }
    for (const m of this.mounds) {
      if (m.hp <= 0 || Math.hypot(m.x - x, m.z - z) > r + 4.5) continue;
      g.puff(m.x, m.root.position.y + 2, m.z, 6, 2);
      // battering a mound pays the same as a bite of dirt (the server credits it too), so nest-hunting never costs you your next tool
      const v = Math.PI * t.r * t.r * t.depth / 2;
      g.player.credit(v); m.hitT = 0.25;
      g.hud.pop(`+${v < 10 ? v.toFixed(1) : Math.round(v)} m³`, m.x, m.root.position.y + 6, m.z);
      if (g.net?.online) g.net.hitMound(m.i, bought);   // the server keeps the score and tells everyone
      else { this.set(m, m.hp - dmg * L.hitMul, false); g.dirty = true; }
    }
  }

  nearest(pos, R) {
    let best = null, bd = R;
    for (const a of this.agents) { const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z); if (a.hp > 0 && d < bd) { bd = d; best = a; } }
    return best;
  }

  // A quick swat at whoever is in front of you: no wind-up, two with a shovel, one with anything better.
  whack(pl) {
    const g = this.game, fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    for (const a of this.agents) {
      const dx = a.pos.x - pl.pos.x, dz = a.pos.z - pl.pos.z, d = Math.hypot(dx, dz);
      if (a.hp <= 0 || d > L.meleeR + 0.4 || (d > 1 && (dx * fx + dz * fz) / d < -0.2)) continue;
      a.hp -= pl.tier >= 1 ? L.lobbyistHp : 1;
      a.flash = 0.2; a.cd = Math.max(a.cd, 1.2);
      a.kb.set(dx / (d || 1) * 9, 0, dz / (d || 1) * 9);
      g.shake = Math.max(g.shake, 0.12);
      g.hud.pop(BONK[Math.floor(Math.random() * BONK.length)], a.pos.x, a.pos.y + 2.2, a.pos.z);
      g.bus.emit('whack', { agent: a, x: a.pos.x, y: a.pos.y, z: a.pos.z, down: a.hp <= 0 });
    }
  }

  // Share of the two piles gone (0..1), the same sum the server does.
  progress() { const f = this.game.fields; return f.reduce((s, x) => s + Math.min(1, x.progress / CFG.dirt.doneAt), 0) / f.length; }

  // Offline practice has no server to open mounds, so do the same sum here.
  practiceWaves() {
    const g = this.game;
    if (!g.giants.some((_, i) => g.status(i) === 'buried')) return;
    const prog = this.progress(), n = this.mounds.length;
    let want = wavesWanted(prog);
    if (want - this.waves > 3) this.waves = want - 3;
    // ...and the lobbies never stay away for long: with nothing open for quietSec, the next one opens anyway (the server does the same)
    if (this.moundsLeft) this.quietT = 0; else if ((this.quietT = (this.quietT || 0) + 0.5) > L.quietSec && want <= this.waves) want = this.waves + 1;
    while (this.waves < want && this.moundsLeft < this.hives) {
      let i = this.waves % n, tries = 0;
      while (this.mounds[i].hp > 0 && tries++ < n) i = (i + 1) % n;
      this.set(this.mounds[i], L.moundHp, false); this.waves++; this.quietT = 0;
    }
  }

  remove(a, i) {
    const g = this.game;
    g.puff(a.pos.x, a.pos.y + 1, a.pos.z, 8, 1.2, PAPER);   // a flurry of paperwork
    g.bus.emit('agentDown', { agent: a, lobby: a.lobby, x: a.pos.x, y: a.pos.y, z: a.pos.z });
    a.p.root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    g.scene.remove(a.p.root); a.m.alive--; this.agents.splice(i, 1);
  }

  update(dt) {
    const g = this.game, pl = g.player, target = pl.pos, hitR = pl.inVehicle ? 3.5 : 1.3;
    if ((this.heatT += dt) > 0.5) {   // on your own (practice, or cut off) you count as the one digger
      this.heatT = 0;
      const diggers = !g.solo && g.net?.online ? g.dg.reduce((s, n) => s + (n || 0), 0) : 1;
      this.now = lobbyAt(this.heat = lobbyHeat(this.progress(), diggers));
      // how thick they come around you: the pile you are nearest, your machine, the crowd, your device
      const near = g.fields.reduce((b, f) => (!b || Math.hypot(target.x - f.giant.x, target.z - f.giant.z) < Math.hypot(target.x - b.giant.x, target.z - b.giant.z) ? f : b), null);
      const step = lobbyStep(near ? near.progress / CFG.dirt.doneAt : 0), T = L.tools, t = Math.min(pl.toolIndex | 0, T.n.length - 1);
      const open = Math.max(1, this.moundsLeft);
      this.per = Math.max(1, Math.round(Math.min(L.most, step.per * T.n[t]) * (TOUCH ? L.touch : 1)));
      this.perMound = Math.ceil(this.per / open);
      this.every = step.every / T.n[t] / (1 + L.crowdFast * crowdShare(diggers));
      this.range = L.range * T.range[t];
      this.hives = hivesOpen(Math.max(...g.fields.map((f) => Math.min(1, f.progress / CFG.dirt.doneAt))), g.net?.count || 1);
    }
    if ((g.solo || !g.net?.everOnline) && (this.waveT += dt) > 0.5) { this.waveT = 0; this.practiceWaves(); }
    for (const m of this.mounds) {
      if (m.hitT > 0) { m.hitT -= dt; m.root.rotation.z = m.hitT > 0 ? Math.sin(m.hitT * 60) * 0.05 : 0; }
      if (m.sink > 0) {   // flattened: shudder down into the lawn
        m.sink -= dt; m.root.position.y = m.y - (1.4 - m.sink) * 6; m.root.rotation.z = Math.sin(m.sink * 50) * 0.06;
        if (Math.random() < dt * 14) g.puff(m.x + (Math.random() - 0.5) * 8, m.y + 1, m.z + (Math.random() - 0.5) * 8, 4, 3);
        if (m.sink <= 0) { g.scene.remove(m.root); m.root.position.y = m.y; m.root.rotation.z = 0; }
      }
      if (m.hp <= 0) continue;
      m.timer -= dt;
      if (m.timer <= 0) { m.timer = this.every; if (m.alive < this.perMound && this.agents.length < this.per) this.spawn(m); }
    }
    // a machine on the move flattens anyone it touches
    const runR = pl.inVehicle && pl.vel.length() > 1.5 ? Math.min(6, 1.6 + pl.toolCfg.r * 0.35) : 0;
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      if (a.m.hp <= 0 && a.fly === undefined) { this.remove(a, i); continue; }   // when the mound goes, so do its people
      if (a.hp <= 0) {   // swatted, dug or run over: up and away, spinning, then gone in a flurry of paper
        if (a.fly === undefined) { a.fly = 0.75; a.vy = 9; a.p.play('idle'); }
        a.pos.x += a.kb.x * dt; a.pos.z += a.kb.z * dt; a.pos.y += a.vy * dt; a.vy -= 26 * dt;
        a.p.root.position.copy(a.pos); a.p.root.rotation.x += dt * 13; a.p.root.visible = true;
        if ((a.fly -= dt) <= 0) this.remove(a, i);
        continue;
      }
      const dx = target.x - a.pos.x, dz = target.z - a.pos.z, dist = Math.hypot(dx, dz);
      if (runR && dist < runR && pl.dead <= 0) { g.hud.pop('SPLAT', a.pos.x, a.pos.y + 2.2, a.pos.z, 'loud'); g.bus.emit('splat', { agent: a, x: a.pos.x, y: a.pos.y, z: a.pos.z }); a.hp = 0; a.kb.set(dx, 0, dz).setLength(-12); g.shake = Math.max(g.shake, 0.2); }
      a.yaw = Math.atan2(dx, dz);
      a.cd -= dt;
      const ok = (x, z, step) => g.surface(x, z) - a.pos.y < 0.5 + step * 2.5;
      if (a.kb.lengthSq() > 0.05) {   // knocked back by a swat
        const sx = a.kb.x * dt, sz = a.kb.z * dt;
        if (ok(a.pos.x + sx, a.pos.z + sz, Math.hypot(sx, sz))) { a.pos.x += sx; a.pos.z += sz; }
        a.kb.multiplyScalar(Math.max(0, 1 - dt * 7));
        a.p.play('idle');
      } else if (a.throwT > 0) { a.throwT -= dt; a.p.play('swing', { speed: 2.2, fade: 0.05 });
      } else if (pl.dead > 0 && dist < 7) { a.p.play('cheer', { speed: 1.5 });   // gloating over you while you are down
      } else if (dist > L.stand || pl.dead > 0) {   // they walk right up to you (inside swatting distance), throwing on the way in
        const step = this.now.speed * dt, sx = dx / (dist || 1) * step, sz = dz / (dist || 1) * step;
        if (ok(a.pos.x + sx, a.pos.z + sz, step)) { a.pos.x += sx; a.pos.z += sz; }
        else if (ok(a.pos.x + Math.sign(sx) * step, a.pos.z, step)) a.pos.x += Math.sign(sx) * step;
        else if (ok(a.pos.x, a.pos.z + step, step)) a.pos.z += step;   // blocked by the building: slide toward its open front
        else a.pos.x += (a.pos.x < 0 ? -1 : 1) * step;   // boxed in against a wall: shuffle outward along it
        a.p.play('walk', { speed: 2.1 });
      } else a.p.play('idle');
      if (dist < this.range && a.cd <= 0 && pl.dead <= 0) { a.cd = this.now.cooldown + Math.random(); this.throwAt(a, target, dist); }
      a.pos.y = g.surface(a.pos.x, a.pos.z);
      a.p.root.position.copy(a.pos); a.p.root.rotation.y = a.yaw;
      a.p.root.visible = !(a.flash > 0 && (a.flash -= dt) > 0 && Math.floor(a.flash * 40) % 2);
      a.p.mixer.update(dt);
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.vel.y -= 6 * dt; s.sprite.position.addScaledVector(s.vel, dt); s.life -= dt;
      const p = s.sprite.position;
      const hit = pl.dead <= 0 && Math.hypot(p.x - target.x, p.z - target.z) < hitR && Math.abs(p.y - (target.y + 1.2)) < hitR + 1;
      if (hit) pl.hit(s.lobby);
      if (hit || s.life <= 0 || p.y < g.surface(p.x, p.z)) { g.scene.remove(s.sprite); this.shots.splice(i, 1); }
    }
  }

  throwAt(a, target, dist) {
    const tex = (this.tex ||= {})[a.lobby.id] ||= textTex(a.lobby.shot, a.lobby.color, '#fff', 96, 32);
    const mat = (this.mat ||= {})[a.lobby.id] ||= new THREE.SpriteMaterial({ map: tex });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.8, 1);
    sprite.position.set(a.pos.x, a.pos.y + 1.7, a.pos.z);
    const t = dist / L.shotSpeed;
    const vel = new THREE.Vector3((target.x - a.pos.x) / t, (target.y + 1.2 - sprite.position.y) / t + 3 * t, (target.z - a.pos.z) / t);
    this.game.scene.add(sprite);
    a.throwT = 0.45;
    this.shots.push({ sprite, vel, lobby: a.lobby, life: 4 });
    this.game.bus.emit('shot', { agent: a, lobby: a.lobby, x: a.pos.x, y: a.pos.y + 1.7, z: a.pos.z });
  }

  save() { return { hp: this.mounds.map((m) => m.hp), waves: this.waves }; }
}
