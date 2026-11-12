import './dirtbomb.css';
import * as THREE from 'three';
import { CFG } from '../config.js';
import { ps1ify, FONT } from '../ps1.js';

// The dirt bomb: when a pile gets too far ahead of its schedule, the server has the next lobby in line airdrop a sack of
// dirt back onto it (CFG.bomb, worker/world.js). This add-on is the show. Everything stops: a siren, a hazard banner
// counting down, a cargo plane in the lobby's colours trailing a banner, a sack on a parachute that gives up halfway,
// a whistle, KA-THUMP, the pile swelling back up, dirt (and the lobby's own junk) raining down, anyone on the pile buried
// and popping back out. Listens to 'dirtBomb' and 'regrow' on the bus; the dirt itself is done by the core.
// game.plugins.dirtbomb.test(i, lobby) runs one in this browser only (no server needed), for a look.

// ====================================================================================================================
// EVERY WORD THIS ADD-ON PUTS ON SCREEN. {pile} is CHUCK or HAKEEM.
// ====================================================================================================================
const COPY = {
  banner: 'DIRT STRIKE INBOUND',
  bannerT: 'IMPACT IN {n}',
  bannerLanded: 'TAKE COVER',
  splat: 'KA-THUMP',
  buried: 'BURIED!',
  pop: 'POP!',
  dugOut: 'YOU DUG YOURSELF OUT',
  scared: 'YOU SCARED THEM',
  after: 'KEEP DIGGING\ndirt bombs survived: {n}',
  late: 'A DIRT BOMB HIT {pile}\nwhile you were on your way in',
  // per lobby: the big line, the banner the plane tows, what the man under it says, and what comes down with the dirt
  lobbies: {
    aipac: { toast: 'AIPAC IS AIRLIFTING IN\nfresh dirt for {pile}', tow: 'STAND WITH INCUMBENTS', says: 'Every grain of this was donated.', rain: [0xffffff, 0x3a6fd8, 0x6f5334] },
    insurance: { toast: 'HEALTH INSURANCE\nhas pre-authorized more dirt for {pile}', tow: 'YOUR DIG IS OUT OF NETWORK', says: 'This dirt is covered. You are not.', rain: [0xe23b3b, 0xffffff, 0x6f5334], stamp: 'CLAIM DENIED' },
    pharma: { toast: 'BIG PHARMA IS DROPPING\nextra-strength dirt on {pile}', tow: 'NOW WITH 400% MORE DIRT', says: 'Side effects may include staying.', rain: [0xc0398f, 0xffffff, 0xf2c3e0] },
    oil: { toast: 'BIG OIL IS DRILLING\ndirt BACK INTO {pile}', tow: 'DRILL, BURY, DRILL', says: 'Ah. Crude.', rain: [0x111111, 0x2a2a2a, 0x4f3a24] },
    wallst: { toast: 'WALL STREET\nis bailing out {pile}', tow: 'TOO BIG TO DIG', says: 'A golden parachute. For the dirt.', rain: [0xf2c21a, 0xd9a400, 0x8a6d1c] },
    tech: { toast: 'BIG TECH IS PUSHING\na dirt update to {pile}', tow: 'DIRT AS A SERVICE', says: 'You agreed to this in the terms.', rain: [0xd9541e, 0x2e7fd9, 0xffffff], stamp: 'UPDATING DIRT 37%' },
  },
};

// The timeline, in seconds after the warning (impact is at CFG.bomb.warnSec, digging resumes at CFG.bomb.stormSec).
const PLANE_IN = 0.4, RELEASE = 3.8, CHUTE_FAILS = 1.0;   // CHUTE_FAILS: seconds before impact the parachute gives up
const ALT = 82, SPEED = 75;                                // the plane's height and speed (m, m/s)

export function init(game) {
  const B = CFG.bomb, IMPACT = B.warnSec, END = B.stormSec, scene = game.scene, hud = game.hud;
  const sfx = (name, o) => game.plugins.audio?.play?.(name, o);
  const lam = (color, o = {}) => ps1ify(new THREE.MeshLambertMaterial({ color, ...o }));
  let show = null;   // the bomb on screen right now

  // ---- the screen layer: a brown haze, and a hazard-striped banner with the countdown
  const haze = document.createElement('div'); haze.id = 'dbhaze';
  const strip = document.createElement('div'); strip.id = 'dbstrip'; strip.innerHTML = '<b></b><i></i>';
  document.body.append(haze, strip);

  // a canvas texture: text on a coloured card
  function card(text, w, h, bg, fg, font) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.fillRect(0, 0, w, 6); c.fillRect(0, h - 6, w, 6);
    c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = fg; c.fillText(text, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---- the props, built fresh for each bomb in the lobby's colours and thrown away after
  function build(lobby, copy) {
    const col = new THREE.Color(lobby.color).getHex(), root = new THREE.Group();
    // a cargo plane: fat body, high wing, four fat engines, a tail, all blocky
    const plane = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 4.2, 4.2), lam(col)); plane.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3.4), lam(0xdddddd)); nose.position.set(12, -0.3, 0); plane.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 34), lam(0xe8e2d0)); wing.position.set(1, 1.9, 0); plane.add(wing);
    for (const z of [-11, -5.5, 5.5, 11]) { const e = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 1.6), lam(0x333333)); e.position.set(2.5, 0.9, z); plane.add(e); }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.6), lam(col)); fin.position.set(-9.5, 4, 0); plane.add(fin);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.5, 12), lam(0xe8e2d0)); tail.position.set(-9.5, 1.5, 0); plane.add(tail);
    // the banner it tows, on a rope
    const tow = new THREE.Mesh(new THREE.PlaneGeometry(34, 6), new THREE.MeshBasicMaterial({ map: card(copy.tow, 512, 90, '#f4ecd6', lobby.color, `bold 44px ${FONT.big}`), side: THREE.DoubleSide }));
    tow.position.set(-36, -1, 0); plane.add(tow);
    const rope = new THREE.Mesh(new THREE.BoxGeometry(18, 0.15, 0.15), lam(0x222222)); rope.position.set(-12 - 8, -0.6, 0); plane.add(rope);
    plane.scale.setScalar(2); root.add(plane);
    // the sack: lumpy burlap with a band and a big tag in the lobby's colours, on a parachute
    const sack = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 1), lam(0x9a7b4f, { flatShading: true })); bag.scale.set(1, 1.15, 1); sack.add(bag);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 1, 10), lam(col)); band.position.y = 0.6; sack.add(band);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 1.4, 6), lam(0x7d6240)); neck.position.y = 4; sack.add(neck);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: card(lobby.name, 256, 64, lobby.color, '#ffffff', `bold 30px ${FONT.big}`), depthTest: false }));
    tag.scale.set(10, 2.5, 1); tag.position.y = 7; tag.renderOrder = 5; sack.add(tag);
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), lam(col, { side: THREE.DoubleSide, flatShading: true })); canopy.scale.y = 0.55; chute.add(canopy);
    for (const a of [0, 1.57, 3.14, 4.71]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 9, 0.08), lam(0xffffff)); l.position.set(Math.cos(a) * 3.2, -4.5, Math.sin(a) * 3.2); l.rotation.z = Math.cos(a) * 0.35; l.rotation.x = -Math.sin(a) * 0.35; chute.add(l); }
    chute.position.y = 13; sack.add(chute);
    sack.scale.setScalar(1.8); sack.visible = false; root.add(sack);
    // the mushroom: a dirt cloud and a shock ring, grown at impact
    const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x7a5c3a, transparent: true, opacity: 0.85, flatShading: true }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.18, 4, 24), new THREE.MeshBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2; cloud.visible = ring.visible = false; root.add(cloud, ring);
    scene.add(root);
    return { root, plane, sack, chute, cloud, ring };
  }
  function dispose(s) {
    s.props.root.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    scene.remove(s.props.root);
  }

  const put = (t, s) => t.replace('{pile}', CFG.giants[s.i].name).replace('{n}', game.bombs);
  const topOf = (s) => Math.max(CFG.giant.baseY + CFG.giant.height + 1, game.fields[s.i].heightAt(s.gx, s.gz + 6));
  const onPile = (s) => game.fields[s.i].inside(game.player.pos.x, game.player.pos.z);

  function start(b) {
    if (show) end(show);
    const lobby = CFG.lobbies.find((l) => l.id === b.lobby) || CFG.lobbies[0], copy = COPY.lobbies[lobby.id] || COPY.lobbies.aipac, g = CFG.giants[b.i];
    const s = show = { ...b, lobby, copy, gx: g.x, gz: g.z, props: build(lobby, copy), did: {}, t: (Date.now() - b.start) / 1000, cam: false, buried: 0 };
    // arrived mid-storm: skip the parts already over (so no countdown for a bomb that has landed)
    if (b.late) for (const k of ['warn', 'release', 'whistle', 'fail', 'impact', 'say']) if (s.t > { warn: 1, release: RELEASE, whistle: RELEASE, fail: IMPACT - CHUTE_FAILS, impact: IMPACT, say: IMPACT + 1.5 }[k]) s.did[k] = true;
    if (b.late && s.t > IMPACT) hud.toast(put(COPY.late, s), 3, 3);
    document.body.classList.add('dbstorm');
    haze.style.setProperty('--db', lobby.color); strip.style.setProperty('--db', lobby.color);
  }

  function end(s) {
    dispose(s);
    if (s.cam && game.cam?.dirtbomb) game.cam = null;
    if (s.buried) game.player.avatar.setVisible(true);
    document.body.classList.remove('dbstorm', 'dbflash');
    show = null;
  }

  // the camera: from beside the pile, low, looking up at the falling sack and then at the impact. Only when nobody else
  // (the trailer director, a test) has the camera, and only for players near enough to see it anyway.
  function shot(s, y) {
    if (game.cam && !game.cam.dirtbomb) return;
    const side = Math.sign(s.gx) || 1, pos = [s.gx + side * 38, 18, s.gz + 78];
    game.cam = { dirtbomb: true, pos, look: [s.gx, Math.max(30, y * 0.7 + 12), s.gz] };
    s.cam = true;
  }

  function step(s, dt) {
    const t = s.t = (Date.now() - s.start) / 1000, P = s.props, once = (k) => (s.did[k] ? false : (s.did[k] = true));
    const top = topOf(s);
    // ---- the warning
    if (once('warn')) {
      sfx('klaxon'); setTimeout(() => sfx('siren'), 900);
      hud.toast(put(s.copy.toast, s), 4, 3);
      game.plugins.giants?.say?.(s.i, 'Help is on the way.');
    }
    // the banner: a countdown until impact, then TAKE COVER until digging resumes
    strip.firstChild.textContent = COPY.banner;
    strip.lastChild.textContent = t < IMPACT ? COPY.bannerT.replace('{n}', Math.max(1, Math.ceil(IMPACT - t))) : COPY.bannerLanded;
    // ---- the plane crosses, right over the pile at RELEASE
    const px = s.gx + (t - RELEASE) * SPEED * (s.gx > 0 ? -1 : 1);
    P.plane.visible = t > PLANE_IN && Math.abs(px - s.gx) < 420;
    P.plane.position.set(px, ALT + Math.sin(t * 1.3) * 1.5, s.gz + 22);
    P.plane.rotation.set(Math.sin(t * 1.7) * 0.06, s.gx > 0 ? Math.PI : 0, 0);
    if (P.plane.visible && once('drone')) sfx('whoosh', { vol: 1.4 });
    // ---- the sack: out of the hatch, floats down swaying, the chute gives up, it drops like a stone
    if (t >= RELEASE && t < IMPACT) {
      if (once('release')) { P.sack.visible = true; sfx('blip'); }
      const fail = IMPACT - CHUTE_FAILS, y1 = top + 26;
      let y;
      if (t < fail) { const u = (t - RELEASE) / (fail - RELEASE); y = ALT - 10 + (y1 - (ALT - 10)) * u; P.sack.rotation.z = Math.sin(t * 3.2) * 0.35; P.chute.position.y = 13; }
      else {
        if (once('fail')) { hud.pop('CHUTE FAILED', s.gx, y1 + 10, s.gz, 'loud'); sfx('whistle', { dur: CHUTE_FAILS + 0.1 }); }
        const u = (t - fail) / CHUTE_FAILS; y = y1 + (top - y1) * u * u; P.sack.rotation.z *= 0.9; P.sack.rotation.y += dt * 9;
        P.chute.position.y += dt * 30; P.chute.rotation.z += dt * 2;   // off it goes, on its own
      }
      P.sack.position.set(s.gx + Math.sin(t * 1.1) * 2, y + 6, s.gz + 12 - 6 * Math.min(1, Math.max(0, (t - RELEASE) / (IMPACT - RELEASE))));
      shot(s, y);
    }
    // ---- impact
    if (t >= IMPACT && once('impact')) {
      P.sack.visible = false;
      sfx('kaboom');
      game.shake = Math.max(game.shake, 3.2);
      document.body.classList.add('dbflash'); setTimeout(() => document.body.classList.remove('dbflash'), 180);
      for (let k = 0; k < 4; k++) game.puff(s.gx + (Math.random() - 0.5) * 14, top, s.gz + 6 + (Math.random() - 0.5) * 14, 40, 5, s.copy.rain);
      hud.pop(COPY.splat, s.gx, top + 14, s.gz + 6, 'loud dbsplat');
      if (s.copy.stamp) stampLong(s.copy.stamp, 1.6);
      P.cloud.visible = P.ring.visible = true; P.cloud.position.set(s.gx, top, s.gz + 6); P.ring.position.set(s.gx, top - 2, s.gz + 6);
      // standing on it: buried, and out again a moment later with a pop
      if (onPile(s) && !game.player.dead) { s.buried = 1.3; game.player.avatar.setVisible(false); hud.toast(COPY.buried, 1.2, 2); }
    }
    if (t >= IMPACT) {
      const u = Math.min(1, (t - IMPACT) / 1.6);
      P.cloud.scale.set(4 + 30 * u, 3 + 22 * u, 4 + 30 * u); P.cloud.position.y = top + 16 * u; P.cloud.material.opacity = 0.85 * (1 - u);
      P.ring.scale.setScalar(2 + 60 * u); P.ring.material.opacity = 0.9 * (1 - u);
      P.cloud.visible = P.ring.visible = u < 1;
      // the rain: dirt and the lobby's junk, coming down over the pile for a few seconds
      if (t < IMPACT + 4 && (s.rainT = (s.rainT || 0) + dt) > 0.12) { s.rainT = 0; game.puff(s.gx + (Math.random() - 0.5) * 50, top + 26, s.gz + (Math.random() - 0.5) * 50, 5, 3, s.copy.rain); }
      if (once('say')) game.plugins.giants?.say?.(s.i, s.copy.says);
      if (s.cam && t > IMPACT + 3 && game.cam?.dirtbomb) { game.cam = null; s.cam = false; }
    }
    if (s.buried > 0 && (s.buried -= dt) <= 0) {
      const p = game.player;
      p.avatar.setVisible(!p.dead); p.pos.y = game.surface(p.pos.x, p.pos.z) + 0.1; p.vy = 13;
      game.puff(p.pos.x, p.pos.y, p.pos.z, 24, 2);
      hud.pop(COPY.pop, p.pos.x, p.pos.y + 2.5, p.pos.z, 'loud'); hud.toast(COPY.dugOut, 1.6, 2);
      sfx('pop'); p.avatar.cheer?.(2);
    }
    // ---- the all-clear
    if (t >= END - 1.2 && once('clear')) document.body.classList.remove('dbstorm');
    if (t >= END) {
      stampLong(COPY.scared, 1.8);
      hud.toast(put(COPY.after, s), 3.5, 3);
      sfx('milestone');
      end(s);
    }
  }

  // the HUD's own stamp lasts 0.7 s; these stay up long enough to read
  function stampLong(text, secs) {
    const el = document.createElement('div'); el.className = 'stamp dbstamp'; el.textContent = text;
    document.getElementById('fx')?.append(el); hud.later(el, secs);
  }

  game.bus.on('dirtBomb', (b) => start(b));

  return {
    update(dt) { if (show) step(show, dt); },
    // a look at one in this browser only: game.plugins.dirtbomb.test(1, 'oil')
    test(i = 1, lobby = null) { game.fakeBomb(i, lobby); },
    get active() { return !!show; },
  };
}
