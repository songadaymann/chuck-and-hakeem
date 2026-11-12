import * as THREE from 'three';
import { CFG } from './config.js';
import { Avatar } from './avatar.js';

const P = CFG.player, L = CFG.lobby;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const DENIED = ['CLAIM DENIED', 'OUT OF NETWORK', 'PRIOR AUTHORIZATION REQUIRED', 'NOT A COVERED DIG'];

// You: movement, digging, health and status effects. What you look like lives in Avatar.
export class Player {
  constructor(game) {
    this.game = game;
    this.avatar = new Avatar(game.scene);
    this.pos = new THREE.Vector3(CFG.spawn.x, 0, CFG.spawn.z);
    this.vel = new THREE.Vector3(); this.want = new THREE.Vector3(); this.aim = new THREE.Vector3(); this.vy = 0;
    this.yaw = Math.PI; this.camYaw = Math.PI; this.camPitch = 0.35;
    this.hp = P.hp; this.dug = 0; this.tier = 0;
    this.serverDug = 0;   // what the server has confirmed; tools unlock on this while connected
    this.fx = { hasbara: 0, pricehike: 0, slick: 0, buyout: 0, tos: 0 };
    this.deductible = 0; this.sinceHit = 99; this.dead = 0; this.safe = 0; this.tosFree = 0; this.camDist = CFG.tools[0].cam;
    this.digging = false; this.fighting = false; this.phase = 0; this.moving = false;
    this.char = null; this.name = '';
  }

  get body() { return this.avatar.body; }
  get toolIndex() { return Math.max(0, this.tier - (this.fx.buyout > 0 ? 1 : 0)); }
  get toolCfg() { return CFG.tools[this.toolIndex]; }
  get inVehicle() { return this.toolCfg.kind === 'vehicle' && !!this.avatar.vehicle; }

  async setCharacter(name) { this.char = name; await this.avatar.setChar(name); }

  credit(vol) {
    this.dug += vol;
    this.checkTier();
  }
  checkTier() {
    const next = CFG.tools[this.tier + 1], basis = this.game.net?.online ? this.serverDug : this.dug;
    if (next && basis >= next.need) { this.tier++; this.game.hud.toast(`NEW TOOL\n${next.name.toUpperCase()}`, 3); this.game.bus?.emit('toolUp', { tier: this.tier, tool: next, quiet: !this.game.started }); this.checkTier(); }
  }

  hit(lobby) {
    if (this.dead > 0 || this.safe > 0) return;
    // one terms-of-service pop-up per encounter: later ones bounce off while you are "under agreement"
    if (lobby.effect === 'tos') { if (this.tosFree > 0) return; this.tosFree = L.tosEvery; }
    this.hp -= L.dmg * (this.inVehicle ? 0.5 : 1); this.sinceHit = 0;
    if (lobby.effect === 'deductible') this.deductible = Math.max(this.deductible, L.deductibleDigs);   // refreshes, never stacks
    else this.fx[lobby.effect] = lobby.secs;
    if (lobby.effect === 'slick') this.vel.set((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16);   // and off you skate
    this.game.hud.effectStarted(lobby, this);
    this.game.bus.emit('hurt', { lobby, effect: lobby.effect, hp: this.hp });
    if (this.hp <= 0) this.die('lobbied', lobby);
  }

  die(why, lobby) {
    const g = this.game;
    this.dead = P.respawn; this.digging = false;
    g.puff(this.pos.x, this.pos.y + 1, this.pos.z, 20, 3);
    g.hud.toast(why === 'pricehike' ? 'PRICED OUT!' : 'LOBBIED!', P.respawn, 2);
    g.bus.emit('dead', { why, lobby });
  }

  update(dt, input) {
    const g = this.game;
    if (!this.body) return;
    for (const k in this.fx) this.fx[k] = Math.max(0, this.fx[k] - dt);
    if (this.fx.pricehike > 0 && this.dead <= 0) { this.hp -= 4 * dt; if (this.hp <= 0) this.die('pricehike'); }
    this.sinceHit += dt; this.safe = Math.max(0, this.safe - dt); this.tosFree = Math.max(0, this.tosFree - dt);
    if (this.sinceHit > P.regenDelay) this.hp = Math.min(P.hp, this.hp + P.regen * dt);
    if (this.dead > 0) {
      this.dead -= dt; this.digging = false;
      this.avatar.setVisible(false);
      if (this.dead <= 0) {   // back on your feet at the foot of the pile you were working, with a moment before anything can hit you
        const gi = CFG.giants[this.pos.x < 0 ? 0 : 1];
        do this.pos.set(gi.x + (Math.random() - 0.5) * 20, 0, gi.z + 48 + Math.random() * 8); while (g.solids.some((b) => this.pos.x > b.x0 && this.pos.x < b.x1 && this.pos.z > b.z0 && this.pos.z < b.z1));
        this.vel.set(0, 0, 0); this.safe = P.grace; this.hp = P.hp; this.deductible = 0; for (const k in this.fx) this.fx[k] = 0; this.avatar.setVisible(true); g.bus.emit('respawn');
      }
      return;
    }
    this.avatar.setTier(this.toolIndex);
    const cfg = this.toolCfg, veh = cfg.kind === 'vehicle';
    this.camDist += (cfg.cam - this.camDist) * Math.min(1, dt * 2.5);

    // --- movement, relative to the camera
    let mx = input.x, mz = input.z;
    this.digging = input.dig && this.fx.tos <= 0;
    // a lobbyist within arm's reach: the same button swats instead of digging, fast, and you can keep moving
    const foe = this.digging && !veh ? g.lobby.nearest(this.pos, L.meleeR) : null;
    if (!!foe !== this.fighting) { this.fighting = !!foe; this.phase = 0; this.restart = true; }
    // Digging plants your feet, but not entirely: hand tools can edge along (so a held dig carves a trench), and a
    // machine that digs on the spot can still swing round to aim.
    const planted = this.digging && !cfg.moveDig && !foe;
    const len = Math.hypot(mx, mz);
    const speed = cfg.speed * (input.run && !veh ? P.runMul : 1) * Math.min(1, len) * (planted ? (veh ? 0 : P.shuffle) : 1);   // a thumb stick pushed part way walks slower
    const want = this.want.set(0, 0, 0);
    if (len > 0.01) {
      const a = this.camYaw + Math.atan2(mx, mz);
      const turn = veh ? cfg.turn : 12;
      this.yaw += Math.max(-turn * dt, Math.min(turn * dt, angDiff(a, this.yaw)));
      // on foot you go where the stick points; a machine goes where it is facing, so it steers instead of sliding
      const go = veh ? this.yaw : a, fwd = veh ? Math.max(0, Math.cos(angDiff(a, this.yaw))) : 1;
      want.set(Math.sin(go) * speed * fwd, 0, Math.cos(go) * speed * fwd);
    }
    if (foe) this.yaw += Math.max(-14 * dt, Math.min(14 * dt, angDiff(Math.atan2(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z), this.yaw)));
    this.vel.lerp(want, Math.min(1, dt * (this.fx.slick > 0 ? 0.9 : 12)));
    this.moving = this.vel.length() > 0.3;
    this.tryMove(this.vel.x * dt, this.vel.z * dt);
    const ground = g.surface(this.pos.x, this.pos.z);
    if (this.pos.y > ground + 0.05) { this.vy -= 30 * dt; this.pos.y = Math.max(ground, this.pos.y + this.vy * dt); } else { this.pos.y = ground; this.vy = 0; }

    // --- digging: dirt comes out once per cycle, at the bite point
    if (this.digging) {
      const before = this.phase, at = foe ? 0.45 : cfg.bite;
      this.phase += dt / (foe ? L.whack : cfg.period);
      if (before < at && this.phase >= at) { if (foe) g.lobby.whack(this); else this.bite(cfg); }
      if (this.phase >= 1) this.phase -= 1;
    } else this.phase = 0;

    this.avatar.update(dt, { pos: this.pos, yaw: this.yaw, moving: this.moving, digging: this.digging, speed: this.vel.length(), clip: foe ? 'swing' : null, period: L.whack, restart: this.restart, far: this.camDist });
    this.restart = false;
    if (this.avatar.tag && g.hud.toastT > 0) this.avatar.tag.visible = false;   // your own name steps aside for the big line
  }

  // Slide along anything too steep to climb (walls are cliffs in the height map).
  tryMove(dx, dz) {
    const g = this.game, d = Math.hypot(dx, dz);
    if (d < 1e-5) return;
    // game.solids: buildings you cannot walk through, as { x0, x1, z0, z1 } (added by the scenery)
    // (a building you are somehow already inside does not hold you: nobody is ever sealed in)
    const px = this.pos.x, pz = this.pos.z;
    const ok = (x, z) => x * x + z * z < CFG.worldRadius ** 2 && g.surface(x, z) - this.pos.y < 0.5 + d * 2.5 && !g.solids.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && !(px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1));
    if (ok(this.pos.x + dx, this.pos.z + dz)) { this.pos.x += dx; this.pos.z += dz; }
    else if (ok(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    else if (ok(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
  }

  bite(cfg) {
    const g = this.game;
    const x = this.pos.x + Math.sin(this.yaw) * cfg.reach, z = this.pos.z + Math.cos(this.yaw) * cfg.reach;
    g.bus.emit('bite', { x, z, tier: this.toolIndex, tool: cfg });   // the tool came down here, whether or not it found dirt
    g.lobby.strike(x, z, Math.max(cfg.r, 2.6), cfg.dmg, this.toolIndex < this.tier);
    if (g.net?.everOnline && !g.net.online) { g.hud.toast(g.net.full ? 'THE DIG IS FULL\nyou are back in when a spot opens' : 'RECONNECTING...\nyour digs count again in a moment', 1.2, 0); return; }   // cut off from the shared dig: nothing counts until we are back
    if (this.deductible > 0) { this.deductible--; g.hud.stamp(DENIED[this.denied = ((this.denied ?? -1) + 1) % DENIED.length]); g.bus.emit('denied', { x, z, left: this.deductible }); return; }
    const weak = (this.fx.hasbara > 0 ? 0.5 : 1) * (this.fx.buyout > 0 && this.tier === 0 ? 0.5 : 1);   // a buyout has no lower tool to drop to at the shovel
    const vol = g.digAt(x, z, cfg.r, cfg.depth * weak, weak, this.toolIndex < this.tier);
    if (vol > 0) { this.credit(vol); g.hud.pop(`+${vol < 10 ? vol.toFixed(1) : Math.round(vol)} m³`, x, g.surface(x, z) + 1.2, z); }
  }

  placeCamera(cam, close) {
    // camDist glides to the tool's distance (see update), so a new machine is a crane-up and a buyout is a sad zoom in
    const cfg = this.toolCfg, dist = close || this.camDist, h = !close && cfg.kind === 'vehicle' ? Math.max(2.5, dist * 0.22) : 1.5;
    const cp = Math.cos(this.camPitch);
    const t = this.aim.set(this.pos.x, this.pos.y + h, this.pos.z);
    // if the ground (a pile behind a big machine) is in the way, come closer before settling for being lifted over it
    for (let d = dist, k = 0; k < 5; k++, d *= 0.72) {
      cam.position.set(t.x - Math.sin(this.camYaw) * cp * d, t.y + Math.sin(this.camPitch) * d, t.z - Math.cos(this.camYaw) * cp * d);
      if (close || cam.position.y >= this.game.surface(cam.position.x, cam.position.z) + 0.6) break;
    }
    const floor = this.game.surface(cam.position.x, cam.position.z) + 0.6;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(t);
  }
}
