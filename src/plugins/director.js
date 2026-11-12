import { CFG } from '../config.js';
import { load } from '../assets.js';
import { at } from '../base.js';
import { rng } from '../scenery/plan.js';

// The camera director: stages and frames every shot of the launch video, and can fake a busy server.
//   ?solo&autostart&shot=NAME   stage that shot and play it (&guide draws the framing guide, &hud=full|clean, &card=0)
//   ?director                   a list of every shot, to click through
//   ?crowd=N                    N simulated players digging both piles, in any mode (bodies stay capped by CFG.net.shown)
// The video is upright (1080 x 1920) and the author stands in front of its bottom quarter, so every shot keeps its
// subject in the top 60% of the frame and leaves only ground at the bottom (game.view lifts the picture).
// tools/shots.mjs records the shots one exact frame at a time (?capture); tools/SHOTS.md is the list.
// Staging goes through the game's own code: the player's tool and input, real dirt, real mounds and lobbyists, and
// remote players fed in the way the server reports them. Nothing here reads the wall clock.
const q = new URLSearchParams(location.search), PI = Math.PI, G = CFG.giants, TOOLS = CFG.tools, L = CFG.lobby;
const NOW = Date.parse('2026-11-12T12:00:00-05:00');   // the moment every shot pretends it is: under six days on Hakeem's clock
const HERO = { char: q.get('char') || 'Construction_Female_01', name: q.get('name') || 'Fed-Up Digger 26' };
const ZIP = /^\d{5}$/.test(q.get('zip') || '') ? q.get('zip') : '11239';   // typed into the reps panel (Brooklyn: Jeffries' own district)
const $ = (id) => document.getElementById(id);
const SETTLE = 6;   // seconds the game runs before a shot is staged, so whatever greets a new arrival has been and gone
// The centre-screen lines that tell the story (new tool, a lobby mobilising, a nest flattened, a milestone, a man out,
// a lobby's effect landing). Everything else (coaching, statistics) stays off the screen during a shot.
const STORY = /^NEW TOOL|IS MOBILISING|NEST FLATTENED|^(CHUCK|HAKEEM)( IS OUT|: )|^[A-Z ]+! /;
const mix = (a, b, u) => a + (b - a) * u;
const sat = (u) => Math.max(0, Math.min(1, u));
const ease = (u) => { u = sat(u); return u * u * (3 - 2 * u); };
const due = (S, key, T, when) => T >= when && !S[key] && (S[key] = true);   // true once, the first frame at or after `when`
const seedOf = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 2147483646; return h + 1; };
// let finished downloads land between frames, without a timer (the recorder runs timers on game time)
const breathe = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

// ---- camera: every helper fills the same object, so a shot costs nothing per frame
const CAM = { pos: [0, 0, 0], look: [0, 0, 0], fov: 55 };
// A 16:9 window shows far more to either side at the same lens, so every staged lens is tightened there to keep the subject as big.
const LENS = innerWidth > innerHeight ? 0.78 : 1;
function view(px, py, pz, lx, ly, lz, fov = 55) { const p = CAM.pos, l = CAM.look; p[0] = px; p[1] = py; p[2] = pz; l[0] = lx; l[1] = ly; l[2] = lz; CAM.fov = fov * LENS; return CAM; }
// Look at a point from `r` metres away at height `h`. `a` is the compass bearing the camera stands on: 0 = west of the
// point (the Mall side), positive = round toward the south (the House side).
const orbit = (x, y, z, r, h, a, fov) => view(x + Math.sin(a) * r, h, z + Math.cos(a) * r, x, y, z, fov);
// A straight move between two set-ups [camX, camY, camZ, lookX, lookY, lookZ, fov], at a steady speed so it cuts anywhere.
const glide = (A, B, u) => view(mix(A[0], B[0], u), mix(A[1], B[1], u), mix(A[2], B[2], u), mix(A[3], B[3], u), mix(A[4], B[4], u), mix(A[5], B[5], u), mix(A[6] || 55, B[6] || 55, u));
// Ride with the player: `back` metres behind and `side` beside the heading `yaw`, `up` above their feet, looking at a
// point `ahead` of them and `lift` above their feet. Never under the dirt.
function chase(g, yaw, back, side, up, ahead, lift, fov) {
  const p = g.player.pos, s = Math.sin(yaw), c = Math.cos(yaw), x = p.x - s * back + c * side, z = p.z - c * back - s * side;
  return view(x, Math.max(p.y + up, g.surface(x, z) + 0.7), z, p.x + s * ahead, p.y + lift, p.z + c * ahead, fov);
}

// ---- staging
function put(g, x, z, yaw, tier = 0) {
  const p = g.player;
  p.tier = tier; p.dug = TOOLS[tier].need;   // exactly this tool's threshold, so the tool sticks
  p.pos.set(x, g.surface(x, z), z); p.vel.set(0, 0, 0); p.vy = 0; p.yaw = p.camYaw = yaw; p.phase = 0; p.camDist = TOOLS[tier].cam;
}
// Dig a pile down to `frac` of the way out with scattered bites, as a crowd would have left it.
function wear(f, frac, R) { for (let n = 0; n < 4000 && f.progress < frac; n++) { const a = R() * 2 * PI, d = Math.sqrt(R()) * 31; f.dig(f.giant.x + Math.sin(a) * d, f.giant.z + Math.cos(a) * d, 6, 2.2); } }
// Cut a working face into the west foot of a pile, so machines stand on the lawn against a wall of dirt.
function bench(f, x) { for (let k = -16; k <= 16; k += 4) f.dig(x + k, f.giant.z + 37, 10, 60); }
// The mound a shot uses for a lobby: its first, unless the view of that one is blocked (a cherry tree, at Big Tech's).
const NTH = { tech: 1 };
const finger = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
const moundOf = (g, id) => g.lobby.mounds.filter((m) => m.lobby.id === id)[NTH[id] || 0];
// One more lobbyist out of this mound, stood at (x, z) instead of in its doorway. `cd` = seconds until they may throw.
async function suit(g, m, x, z, cd = 99) {
  const n = g.lobby.agents.length;
  window.__capture?.begin(2 + n);   // the same face says the same line in every take
  await g.lobby.spawn(m);
  const a = g.lobby.agents[n];
  if (a) { a.pos.set(x, g.surface(x, z), z); a.cd = cd; }
  return a;
}

// ---- the simulated crowd: remote players, joined and reported exactly as the server would
const MIX = [0, 1, 0, 2, 1, 4, 0, 3, 1, 5, 0, 2, 6, 1, 0, 7, 3, 0, 1, 8];   // mostly hand tools, a few machines
function makeCrowd(game, n, o = {}) {
  const R = rng(o.seed || 77), net = game.net, piles = o.piles || [0, 1], list = [], msg = { t: 'p', ps: [] }, every = CFG.net.sendMs / 1000;
  let acc = 0, check = 0;
  const thick = (f, x, z) => (f.inside(x, z) ? f.heightAt(x, z) - f.floorAt(x, z) : 0);
  const room = (c) => (c.kind === 'hand' ? 0.9 : c.cam * 0.33);   // elbow room, by the size of the thing they drive
  // Somewhere new to dig: on the hillside for hand tools, at the foot of the pile for machines.
  function pick(a) {
    const f = game.fields[a.pile], g = f.giant, c = a.cfg, hand = c.kind === 'hand', lim = hand ? 1.35 : 0.95;
    for (let tries = 0; tries < 12; tries++) {
      const th = Math.max(-lim, Math.min(lim, a.th + (R() * 2 - 1) * (tries < 4 ? 0.4 : 1.4))), sx = Math.sin(th), cz = Math.cos(th);
      let d = 42; while (d > 3 && thick(f, g.x + sx * d, g.z + cz * d) < 0.5) d -= 1.5;   // walk in from the lawn until there is dirt underfoot
      if (d <= 3) continue;
      const at = hand ? d - 0.5 - R() * (d - 6) * 0.9 : d + Math.abs(c.reach) - 1.5, x = g.x + sx * at, z = g.z + cz * at;
      if (hand ? thick(f, x, z) < 0.3 : game.surface(x, z) > 1.2) continue;
      if (list.some((b) => b !== a && Math.hypot(b.gx - x, b.gz - z) < room(c) + room(b.cfg))) continue;
      a.th = th; a.gx = x; a.gz = z; a.gyaw = Math.atan2(g.x - x, g.z - z) + (c.reach < 0 ? PI : 0); a.idle = false;
      return;
    }
    a.gx = a.x; a.gz = a.z; a.gyaw = a.yaw; a.idle = true;   // nothing left to dig within reach: stand and watch
  }
  const burst = (a) => (a.cfg.kind === 'hand' ? 3 + R() * 5 : 8 + R() * 10);
  const join = (a) => { net.addRemote([a.sid, a.name, a.char, a.tier, a.x, a.z, a.yaw, a.row[4]]); a.r = net.remotes.get(a.sid); };
  for (let i = 0; i < n; i++) {
    const tier = o.tiers ? o.tiers[i % o.tiers.length] : i % 40 === 29 ? 9 : MIX[i % MIX.length];
    const a = { sid: 900000 + i, name: `${CFG.nameA[Math.floor(R() * CFG.nameA.length)]} ${CFG.nameB[Math.floor(R() * CFG.nameB.length)]} ${10 + Math.floor(R() * 90)}`,
      char: CFG.people[Math.floor(R() * CFG.people.length)], tier, cfg: TOOLS[tier], pile: piles[i % piles.length], th: (R() * 2 - 1) * 1.2,
      x: 0, z: 0, yaw: 0, gx: 1e9, gz: 1e9, gyaw: 0, idle: false, walking: false, t: 0, wait: 0, r: null, row: null };
    a.row = [a.sid, 0, 0, 0, 0, tier];   // this player's line in a position report, reused
    list.push(a);
    if (o.from === 'spawn') {   // arriving: standing about where new players appear, setting off a few at a time
      a.x = a.gx = CFG.spawn.x + (R() - 0.5) * 36; a.z = a.gz = CFG.spawn.z - 5 + R() * 15; a.yaw = PI; a.wait = R() * (o.stagger ?? 4); a.walking = true;
    } else {
      const g = game.fields[a.pile].giant; a.x = g.x + Math.sin(a.th) * 48; a.z = g.z + Math.cos(a.th) * 48; a.yaw = a.th + PI;   // on the lawn, if there is nowhere to dig
      pick(a); a.x = a.gx; a.z = a.gz; a.yaw = a.gyaw; a.t = R() * burst(a); a.row[4] = a.idle ? 0 : 2;
    }
    join(a);
  }
  if (o.from === 'spawn') for (const a of list) pick(a);
  if (o.lower) game.bus.on('remoteDig', (e) => { for (const f of game.fields) if (f.inside(e.x, e.z)) f.dig(e.x, e.z, e.tool.r, e.tool.depth * o.lower); });
  return {
    list,
    update(dt) {
      net.offT = 0;   // this server never goes quiet (without a socket, the game clears the lawn after a long silence)
      for (const a of list) {
        if (a.wait > 0) { a.wait -= dt; continue; }
        if (a.walking) {
          const dx = a.gx - a.x, dz = a.gz - a.z, d = Math.hypot(dx, dz), step = a.cfg.speed * (a.cfg.kind === 'hand' ? CFG.player.runMul : 1) * dt;
          if (d <= step) { a.x = a.gx; a.z = a.gz; a.yaw = a.gyaw; a.walking = false; a.t = burst(a); }
          else { a.x += dx / d * step; a.z += dz / d * step; a.yaw = Math.atan2(dx, dz); }
        } else if ((a.t -= dt) <= 0) { pick(a); a.walking = !a.idle; a.t = 2; }
      }
      if ((acc += dt) < every) return;
      acc %= every; msg.ps.length = 0;
      for (const a of list) {
        const row = a.row, flags = a.walking && a.wait <= 0 ? 1 : a.idle || a.wait > 0 ? 0 : 2;
        if (row[1] === a.x && row[2] === a.z && row[3] === a.yaw && row[4] === flags) continue;   // standing still costs nothing, as on the wire
        row[1] = a.x; row[2] = a.z; row[3] = a.yaw; row[4] = flags; msg.ps.push(row);
      }
      if (msg.ps.length) net.onJson(msg);
      if ((check += every) > 3) { check = 0; for (const a of list) if (!net.remotes.has(a.sid)) join(a); }   // a reconnect cleared the lawn
    },
  };
}

// ---- shot families
// Where the hand-held and machine shots are staged: the inner (Capitol steps) side of Hakeem's west slope, on the open
// ground in front of the steps, clear of the site compound on the far side.
const WX = G[1].x - 14, WZ = G[1].z + 27.5;
// The one framing every tool shares, scaled by the size of the tool (its own camera distance in the game).
const toolCam = (d, z, T) => orbit(WX, 0.3 + d * 0.14, (z + WZ) / 2, d * 1.2, 0.8 + d * 0.25, 0.72 + T * 0.02);
const toolShot = (i) => {
  const c = TOOLS[i], z0 = WZ + Math.abs(c.reach);
  return { name: 'tool-' + c.id, beat: 4, secs: 3, pre: 1.5, fy: 0.2, top: `the ${c.name.toLowerCase()} biting into a wall of dirt at Hakeem's pile (same framing for all ten)`,
    setup(g) { bench(g.fields[1], WX); put(g, WX, z0, c.reach < 0 ? 0 : PI, i); },
    act(T, g, S) { S.input.dig = T >= 0; },
    cam: (T) => toolCam(c.cam, z0, T) };
};
const faceShot = (i) => ({ name: G[i].id + '-face', beat: 2, secs: 4, fy: 0.22, park: true, top: `${G[i].name}'s head sticking out of the top of his pile, looking about (tight: his sign is out of frame)`,
  cam: (T) => orbit(G[i].x, 33, G[i].z, 54, 30, (i ? -1 : 1) * (0.5 - T * 0.05), 30) });
const clockShot = (i) => ({ name: 'clock-' + G[i].id, beat: 10, secs: 4, fy: 0.2, park: true, top: `${G[i].name}'s countdown sign, readable, over his head`,
  cam: (T) => orbit(G[i].x, 38, G[i].z, 70, 21, (i ? -1 : 1) * (0.42 - T * 0.03), 55) });
// One open mound with its sign readable, seen by whoever its people are coming for: three lobbyists walk out at the
// lens with their briefcases, stop and throw. You stand just in front of the camera, unseen, and nothing lands.
const DOOR = [-2.6, 2.8, 0];   // where each of the three steps out, metres to the side of the doorway
const moundShot = (lobby) => ({ name: 'mound-' + lobby.id, beat: 8, secs: 4.5, pre: 2.4, fy: 0.2, toasts: /^$/,   // no "IS MOBILISING" line: the edit puts its own name card on the nest, and the two collided
  top: `the ${lobby.name} mound, its sign readable, lobbyists walking out with briefcases and throwing "${lobby.shot}" at the lens`,
  setup(g, S) {
    const m = S.m = moundOf(g, lobby.id), fx = S.fx = Math.sin(m.root.rotation.y), fz = S.fz = Math.cos(m.root.rotation.y);   // the way its door faces
    S.k = fx < 0 ? 1 : -1;   // the camera stands a little to the Mall side of the door line (the grounds are a mirror image, north and south)
    put(g, m.x + fx * 13 + fz * 2 * S.k, m.z + fz * 13 - fx * 2 * S.k, m.root.rotation.y + PI, 0); g.player.avatar.setVisible(false);
    g.lobby.set(m, L.moundHp, false); m.timer = 99;   // the director sends them out, one each side of the door, then one down the middle
  },
  act(T, g, S) {
    const m = S.m, n = due(S, 'a', T, -0.5) ? 0 : due(S, 'b', T, 0.4) ? 1 : due(S, 'c', T, 1.5) ? 2 : -1, side = DOOR[n];
    g.player.safe = 1;
    if (n >= 0) suit(g, m, m.x + S.fx * 5.5 + S.fz * side, m.z + S.fz * 5.5 - S.fx * side, 0.4);   // they throw as they come out...
    for (const a of g.lobby.agents) if (a.cd > 2) a.cd = 2;   // ...and keep at it, a little faster than in play
  },
  cam(T, g, S) { const m = S.m, d = 20 - T * 0.4; return view(m.x + S.fx * d + S.fz * 3 * S.k, 2.1, m.z + S.fz * d - S.fx * 3 * S.k, m.x, 4.4, m.z, 50); } });
// You, digging at the foot of Hakeem's pile with the full HUD, seen from beside you, while that lobby's people walk up
// along the pile throwing their attack: the Capitol steps and Chuck's pile are behind them.
const hitShot = (lobby) => {
  // camera and look-at relative to you, and where the three lobbyists start: on foot at the edge of the dirt, or in an excavator on the lawn
  const veh = lobby.effect === 'buyout', x = WX + 4, z = veh ? WZ + TOOLS[6].reach : G[1].z + 29.6;
  const C = veh ? [16.5, 6, -1.2, -9, 4.5, 3.3] : [4.8, 2, 2.9, -3, 1.5, -0.6], FROM = veh ? [[-15, 3], [-18, 7], [-21, 5]] : [[-13, -3.6], [-16, -6.5], [-19, -5.5]];
  return { name: 'hit-' + lobby.id, beat: 8, secs: 5.5, pre: 1.5, hud: 'full', fy: 0.14, top: `${lobby.name} lobbyists hit you with "${lobby.shot}" and its effect shows on screen (${lobby.effect})`,
    async setup(g, S) {
      const m = S.m = moundOf(g, lobby.id);
      wear(g.fields[1], 0.1, S.R); if (veh) bench(g.fields[1], WX);
      put(g, x, z, PI, veh ? 6 : 1);
      g.lobby.set(m, L.moundHp, true); m.timer = 99;   // open, but it sends nobody else during the shot
      for (const [dx, dz] of FROM) await suit(g, m, x + dx, z + dz);
    },
    act(T, g, S) {
      if (due(S, 'go', T, 0)) g.lobby.agents.forEach((a, n) => { a.cd = 0.15 + n * 1.3; });
      S.input.dig = true;
      // an oil slick is only funny on the move
      if (lobby.effect === 'slick' && g.player.fx.slick > 0) { S.input.dig = false; S.input.z = 1; g.player.camYaw += 0.05; }
    },
    cam(T, g) { const p = g.player.pos; return view(p.x + C[0], p.y + C[1], p.z + C[2], p.x + C[3], p.y + C[4], p.z + C[5], 62); } };
};
// A corner of the world for cutaways. These lean on the scenery modules, so check them again when the world changes.
const broll = (name, top, A, B, secs = 5) => ({ name: 'broll-' + name, beat: 'b-roll', secs, fy: 0.16, top, park: true, path: [A, B] });

// ---- the shot list. beat = which line of the script it covers (tools/SHOTS.md has the script).
// hud: 'clean' (default: only what floats in the world, toasts and pop-ups) or 'full' (the phone HUD). fy lifts the picture.
// pre = seconds the scene runs before the first frame. crowd = { n, piles, tiers, from, lead, lower } simulated players.
// setup(game, S) stages it; act(T, game, S, dt) runs every frame (T < 0 during the pre-roll); cam(T, game, S), or
// path: [from, to] for a straight move, or follow: true for the real player camera. park: the player is out of sight.
const SHOTS = [
  { name: 'title', beat: 1, secs: 5, fy: 0.18, card: 'title', park: true, top: 'the title placard over the Capitol with both piles and both heads',
    path: [[0, 9, 236, 0, 34, 0, 64], [0, 13, 214, 0, 34, 0, 64]] },
  { name: 'heads-wide', beat: 2, secs: 5, fy: 0.2, park: true, top: "both buried giants in one frame: Chuck's head near, Hakeem's beyond, the dome between",
    path: [[-132, 36, 96, -20, 29, 10, 60], [-124, 40, 106, -20, 29, 10, 60]] },
  faceShot(0), faceShot(1),
  { name: 'shovel-walk', beat: 3, secs: 4.5, fy: 0.2, top: "you, with a shovel, running across the lawn at Hakeem's pile and starting to dig: the pile, his head and his clock tower over you",
    setup(g) { put(g, 42, G[1].z + 55, PI - 0.12, 0); },
    act(T, g, S) { const go = T >= 0 && g.surface(g.player.pos.x, g.player.pos.z) < 0.6; S.input.z = go ? 1 : 0; S.input.run = true; S.input.dig = T >= 0 && !go; },
    path: [[41, 2.2, G[1].z + 64, G[1].x - 1, 21, G[1].z, 62], [41.5, 2.8, G[1].z + 60, G[1].x - 1, 21, G[1].z, 62]] },
  { name: 'shovel-dig', beat: 3, secs: 5, fy: 0.14, top: "over your shoulder: you digging into the foot of Hakeem's pile with the shovel, dirt flying",
    setup(g) { put(g, WX + 4, G[1].z + 30, PI - 0.3, 0); },
    act(T, g, S) { S.input.dig = T >= -0.4; },
    cam: (T, g) => chase(g, PI - 0.3, 5.5 - T * 0.1, 2, 2.6, 3, 1, 62) },
  ...TOOLS.map((c, i) => toolShot(i)),
  { name: 'new-tool', beat: 4, secs: 4.5, hud: 'full', fy: 0.12, top: 'the NEW TOOL moment: the shovel bar fills, the toast lands, a pickaxe appears in your hands',
    setup(g) { put(g, WX + 4, G[1].z + 30, PI - 0.3, 0); g.player.dug = TOOLS[1].need - 3.2; },
    act(T, g, S) { S.input.dig = T >= -1.2; },
    cam: (T, g) => chase(g, PI - 0.3, 6, 2.2, 2.8, 3, 1.2, 62) },
  { name: 'tool-ladder', beat: 4, secs: 10.5, pre: 1.5, fy: 0.2, toasts: /^$/,   // a tool a second: the NEW TOOL lines could never keep up
    top: 'the whole ladder in one take: a new tool every second, shovel to bucket-wheel excavator, the camera craning back as they grow',
    setup(g, S) { bench(g.fields[1], WX); put(g, WX, WZ + TOOLS[0].reach, PI, 0); S.d = TOOLS[0].cam; S.z = g.player.pos.z; },
    act(T, g, S, dt) {
      const p = g.player, next = TOOLS[p.tier + 1];
      S.input.dig = true;
      if (next && T >= p.tier + 0.8) {   // earned the way the game does it: your total reaches the next tool's price
        p.credit(next.need - p.dug); p.pos.z = WZ + Math.abs(next.reach); p.yaw = p.camYaw = next.reach < 0 ? 0 : PI;
      }
      const k = Math.min(1, dt * 3.5); S.d += (TOOLS[p.tier].cam - S.d) * k; S.z += (p.pos.z - S.z) * k;
    },
    cam: (T, g, S) => toolCam(S.d, S.z, T) },
  { name: 'play-phone', beat: 5, secs: 6, hud: 'full', touch: true, follow: true, fy: 0.12, top: "the real phone screen: thumb stick, DIG button, HUD, and you running up to Hakeem's pile and digging",
    setup(g, S) { put(g, WX - 3, G[1].z + 49, PI - 0.25, 1); g.player.camPitch = -0.12; S.sx = innerWidth * 0.25; S.sy = innerHeight * 0.8; },
    act(T, g, S) {
      // real touches on the real controls: push the stick all the way (a run), let go, then hold DIG
      const c = $('c');
      g.testInput = null;
      if (due(S, 'down', T, 0.3)) { finger(c, 'pointerdown', 11, S.sx, S.sy); finger(c, 'pointermove', 11, S.sx, S.sy - 60); }
      if (due(S, 'up', T, 2.2)) finger(c, 'pointerup', 11, S.sx, S.sy - 60);
      if (due(S, 'dig', T, 2.5)) { const b = $('digbtn').getBoundingClientRect(); finger($('digbtn'), 'pointerdown', 12, b.left + b.width / 2, b.top + b.height / 2); }
    } },
  { name: 'url-card', beat: 5, secs: 4, fy: 0.2, card: 'url', crowd: { n: 30, piles: [1], lower: 0.5 }, park: true, top: "the mann.cool/leave placard over a busy dig at Hakeem's pile",
    cam: (T) => orbit(G[1].x - 4, 15, G[1].z + 6, 88, 13 + T, -0.42 + T * 0.03, 62) },
  { name: 'crowd-swarm', beat: 6, secs: 6, fy: 0.16, crowd: { n: 44, piles: [1], lower: 0.5 }, top: "dozens of players with name tags and every kind of tool swarming Hakeem's pile, seen from among them",
    setup(g) { put(g, WX + 5, G[1].z + 30, PI - 0.3, 2); },
    act(T, g, S) { S.input.dig = true; },
    path: [[WX - 14, 2.6, G[1].z + 56, G[1].x - 2, 16, G[1].z + 6, 66], [WX - 4, 4.5, G[1].z + 50, G[1].x - 2, 16, G[1].z + 6, 66]] },
  { name: 'crowd-aerial', beat: 6, secs: 7, fy: 0.14, crowd: { n: 56, piles: [0], lower: 0.5 }, top: "from the air: Chuck's pile crawling with diggers and machines, dirt flying everywhere",
    setup(g) { put(g, G[0].x + 9, G[0].z + 30, PI + 0.3, 3); },
    act(T, g, S) { S.input.dig = true; },
    cam: (T) => orbit(G[0].x, 15, G[0].z, 64 - T, 22 + T * 0.5, 0.45 - T * 0.05, 62) },
  { name: 'crowd-join', beat: 6, secs: 6, fy: 0.16, crowd: { n: 40, piles: [0], from: 'spawn', lead: 3, stagger: 6, tiers: [0, 1, 0, 2, 1, 3, 0, 1], lower: 0.5 }, top: "a stream of new players setting off from where they arrive, across the lawn to Chuck's pile",
    setup(g) { put(g, CFG.spawn.x - 6, CFG.spawn.z - 6, PI + 0.6, 0); },
    act(T, g, S) { S.input.z = T >= -1 ? 1 : 0; S.input.run = true; g.player.camYaw = Math.atan2(G[0].x + 14 - g.player.pos.x, G[0].z + 30 - g.player.pos.z); },
    path: [[14, 4.5, CFG.spawn.z + 20, -34, 13, 40, 60], [6, 7.5, CFG.spawn.z + 14, -34, 13, 40, 60]] },
  { name: 'reps-panel', beat: 7, secs: 7, hud: 'full', follow: true, fy: 0.12, sheetTop: true, top: 'the CALL YOUR REPS panel: a ZIP is typed and the House member and senators come up with their numbers',
    async setup(g, S) {
      if (!g.plugins.reps?.open || !$('repsbtn') || !$('repszip')) return 'the reps plugin is not loaded';
      await Promise.all(['members.json', `zip${ZIP[0]}.json`].map((f) => fetch(at(`/data/reps/${f}`)).catch(() => null)));   // warm, so the lookup lands at once
      put(g, WX + 4, G[1].z + 30, PI - 0.3, 1); g.player.camPitch = -0.1; S.typed = 0;
    },
    act(T, g, S) {
      S.input.dig = T < 0.8;
      if (due(S, 'open', T, 0.8)) $('repsbtn').click();
      const n = Math.min(5, Math.floor((T - 1.4) / 0.3) + 1), zip = $('repszip');
      if (n > S.typed) { S.typed = n; zip.value = ZIP.slice(0, n); zip.dispatchEvent(new Event('input', { bubbles: true })); }
    } },
  ...CFG.lobbies.map(moundShot),
  ...CFG.lobbies.map(hitShot),
  { name: 'bonk', beat: 9, secs: 4.5, pre: 1.5, fy: 0.14, top: "you swatting lobbyists with the shovel in front of Chuck's pile: BONK, and they fly off in a flurry of paper",
    async setup(g, S) {
      const m = moundOf(g, 'insurance'), yaw = S.yaw = Math.atan2(G[0].x + 16, G[0].z - 58), s = Math.sin(yaw), c = Math.cos(yaw);
      put(g, -16, 58, yaw, 0);
      g.lobby.set(m, L.moundHp, true); m.timer = 99;
      for (let k = 0; k < 6; k++) { const d = 7 + k * 4.5, w = [1.2, -1.8, 2, -0.8, 1.5, -1.2][k]; await suit(g, m, -16 + s * d + c * w, 58 + c * d - s * w); }
    },
    act(T, g, S) {
      const p = g.player, a = g.lobby.nearest(p.pos, 60), d = a ? Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) : 0;
      if (a) p.camYaw = Math.atan2(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      S.input.z = a && T >= 0 && d > 2.4 ? 1 : 0; S.input.dig = !!a && T >= 0 && d < L.meleeR;
    },
    cam: (T, g, S) => chase(g, S.yaw, 6, -2.6, 3.2, 5, 1.2, 60) },
  { name: 'splat', beat: 9, secs: 5.5, pre: 2, fy: 0.15, top: 'you driving a bulldozer up the centre walk through a line of lobbyists: SPLAT, SPLAT, SPLAT, the Capitol ahead',
    async setup(g, S) {
      const m = moundOf(g, 'oil');
      put(g, -8, 97, PI, 7);
      g.lobby.set(m, L.moundHp, true); m.timer = 99;
      for (let k = 0; k < 6; k++) await suit(g, m, -8 + [1.6, -1.4, 0.6, -2, 2, -0.5][k], 83 - k * 5.5);
    },
    act(T, g, S) { S.input.z = T >= 0 ? 1 : 0; },
    cam: (T, g) => chase(g, PI, 11, 4, 5.5, 8, 1.5, 58) },
  { name: 'mound-smash', beat: 9, secs: 6.5, pre: 1.5, hud: 'full', fy: 0.16, top: 'an excavator battering the Big Pharma mound until it shudders into the ground: MOUND FLATTENED',
    setup(g, S) {
      const m = S.m = moundOf(g, 'pharma'), fx = S.fx = Math.sin(m.root.rotation.y), fz = S.fz = Math.cos(m.root.rotation.y);
      put(g, m.x + fx * 12, m.z + fz * 12, m.root.rotation.y + PI, 6);
      g.lobby.set(m, TOOLS[6].dmg * L.hitMul * 2, true); m.timer = 99;   // two bucketfuls from flat
    },
    act(T, g, S) { S.input.dig = T >= 0; },
    cam(T, g, S) { const m = S.m, a = m.root.rotation.y - 0.55 - T * 0.02; return orbit(m.x + S.fx * 5, 4.5, m.z + S.fz * 5, 26, 6.5, a, 50); } },   // from the open lawn north-west of it
  { name: 'clocks', beat: 10, secs: 5, fy: 0.2, park: true, top: "both countdown signs: Hakeem's (days left) near, Chuck's beyond",
    path: [[152, 42, 64, 22, 40, 10, 50], [148, 44, 78, 22, 40, 10, 50]] },
  clockShot(1), clockShot(0),
  { name: 'closing-wide', beat: 11, secs: 8, fy: 0.15, crowd: { n: 60, lower: 0.5 }, park: true, top: 'the big closing wide from behind the dome: both piles, the crowd, the lawn, the Mall and the Washington Monument',
    path: [[0, 78, -190, 0, 34, 20, 62], [0, 104, -158, 0, 30, 40, 62]] },
  { name: 'capitol-front', beat: 11, secs: 6, fy: 0.18, crowd: { n: 50, tiers: MIX, lower: 0.5 }, park: true, top: 'the west front head on: dome, both piles and heads, crowds on both',
    path: [[-14, 7, 226, 0, 33, 0, 64], [14, 11, 214, 0, 33, 0, 64]] },
  { name: 'timelapse', beat: 11, secs: 9, fy: 0.2, crowd: { n: 34, piles: [1] }, park: true, top: "time-lapse: Hakeem's pile drops away around him until the whole bust stands clear",
    act(T, g, S) {
      const f = g.fields[1], level = 34 * (1 - ease(T / 7.5)) + 0.4;   // a falling waterline: everything above it goes
      for (let k = 0; k < 60 && T >= 0 && f.progress < 0.955; k++) {
        const x = f.x0 + S.R() * CFG.dirt.size, z = f.z0 + S.R() * CFG.dirt.size, h = f.heightAt(x, z);
        if (h > level + 0.3 && f.dig(x, z, 3.6, (h - level) * 0.8) > 2 && k % 12 === 0) g.puff(x, level + 0.5, z, 5, 3);
      }
    },
    cam: (T) => orbit(G[1].x, 25, G[1].z, 92 - T * 1.2, 26 + T * 0.6, -0.5 + T * 0.035, 56) },
  { name: 'win', beat: 11, secs: 9, pre: 2, fy: 0.2, crowd: { n: 40 }, park: true, top: 'the win: the dug-out giants lift off and float away like parade balloons, one after the other',
    setup(g, S) { for (const f of g.fields) wear(f, 0.9, S.R); },
    act(T, g, S) {
      if (due(S, 'h', T, 0.6)) g.fields[1].dig(G[1].x, G[1].z, 80, 99);
      if (due(S, 'c', T, 3.4)) g.fields[0].dig(G[0].x, G[0].z, 80, 99);
    },
    cam: (T) => view(0, 28, 205, 0, 34 + ease(T / 9) * 44, 10, 74) },
  broll('street', 'First Street in front of the lawn: traffic passing, the dome and a pile behind', [-84, 2.6, 116, 30, 13, 92, 55], [-74, 3, 116, 30, 13, 92, 55]),
  broll('cyclists', 'the path beside the reflecting pool: people and bicycles, the Capitol beyond', [-44.5, 2, 192, -38, 9, 100, 50], [-43, 2.4, 182, -38, 9, 100, 50]),
  broll('mall', 'down the Mall: the elms, the drives and the Washington Monument', [0, 5, 204, 0, 30, 640, 50], [0, 9, 232, 0, 30, 640, 50]),
  broll('pool', 'low over the reflecting pool looking back at the Capitol and both piles', [-6, 1.6, 181, 0, 27, 0, 62], [6, 2.2, 176, 0, 27, 0, 62]),
  broll('people', 'the centre walk up to the west steps: the welcome board, people on the lawn, the dome ahead', [9, 2, 106, -2, 16, 30, 58], [5, 2.3, 92, -2, 16, 30, 58]),
  broll('skyline', "from the top of Chuck's pile: the lawn, the pool, the Mall and the city to the west", [-50, 37, 22, -10, 16, 400, 60], [-44, 38, 26, 10, 16, 400, 60], 6),
  broll('penn', 'Pennsylvania Avenue running off from Peace Circle toward the White House', [-138, 9, 160, -200, 8, 340, 52], [-144, 12, 176, -200, 8, 340, 52]),
  broll('east', 'the east front: the plaza behind the Capitol and the streets beyond it', [18, 5, -128, 0, 30, 0, 62], [-18, 7, -122, 0, 30, 0, 62]),
];

const CSS = `
body.dir-clean #hud > :not(#toast):not(#pops):not(#fx), body.dir-clean #end { display: none !important; }
body.dir-lone #timer { display: none !important; }
body.dir-shot #pops .say.gsay.gdock { display: none !important; }   /* a giant's remark docked at the top because he is out of the picture */
body.dir-top #reps { align-items: flex-start; }
#dir-card { position: fixed; z-index: 4; left: 50%; top: 5%; width: min(86vw, 430px); padding-bottom: 8px; transform: translateX(-50%) rotate(-2deg); text-align: center; pointer-events: none; }
#dir-card h1 { margin-bottom: 4px; } #dir-card p { margin: 6px 0 0; font-weight: 700; }
#dir-guide { position: fixed; inset: 0; z-index: 9; pointer-events: none; font: 700 11px var(--px); color: #fff; text-shadow: 1px 1px 0 #000; }
#dir-guide i { position: absolute; left: 0; right: 0; top: 60%; border-top: 2px dashed #ffc21a; }
#dir-guide u { position: absolute; left: 0; right: 0; top: 75%; bottom: 0; background: repeating-linear-gradient(-45deg, #e2392f55 0 10px, #0000 10px 20px); border-top: 2px solid #e2392f; }
#dir-guide b { position: absolute; left: 6px; top: calc(60% + 4px); } #dir-guide s { position: absolute; left: 6px; top: calc(75% + 4px); text-decoration: none; }
#dir-list { position: fixed; z-index: 9; left: 8px; top: 8px; bottom: 8px; width: 230px; overflow: auto; background: #14110dee; padding: 8px; font: 12px/1.5 var(--px); }
#dir-list a { display: block; color: #ead9b0; text-decoration: none; } #dir-list a:hover { color: #ffc21a; }`;

export async function init(game) {
  const name = q.get('shot'), crowdN = Math.min(400, Math.max(0, Number(q.get('crowd')) || 0));
  if (name === null && !q.has('director') && !crowdN) return null;
  const el = (tag, id, html) => { const e = document.createElement(tag); e.id = id; if (html) e.innerHTML = html; document.body.append(e); return e; };
  el('style', 'dir-style').textContent = CSS;
  let cur = null, free = null, label = null, only = null;

  if (name !== null) {
    // A shot is always a private practice dig, and it leaves the browser exactly as it found it: no save is written,
    // and anything the game or a plugin stores while it runs is put back when the page goes away.
    game.solo = true; game.save = () => {};
    const toast = game.hud.toast.bind(game.hud);
    game.hud.toast = (msg, secs, pri) => { if (!msg || !only || only.test(msg)) toast(msg, secs, pri); };
    let kept = []; try { kept = Object.entries(localStorage); } catch (e) { /* private window */ }
    addEventListener('pagehide', () => { try { localStorage.clear(); for (const [k, v] of kept) localStorage.setItem(k, v); } catch (e) { /* private window */ } });
  }
  if (q.has('director') && name === null) el('div', 'dir-list', SHOTS.map((s) => `<a href="?solo&autostart&guide&shot=${s.name}">${s.name}</a>`).join(''));

  // One frame of game time. The recorder's clock (CSS animations, timers) moves with it.
  function step(dt) { window.__capture?.begin(); game.frame(dt); window.__capture?.tick(dt * 1000); }
  async function run(n, dt = 1 / 30) { for (let i = 0; i < n && !cur?.error; i++) { step(dt); await breathe(); } return cur?.error || null; }

  async function stage(which = name) {
    const shot = SHOTS.find((s) => s.name === which);
    if (!shot) return { error: `no shot called "${which}"` };
    if (only) return { name: shot.name, error: 'one shot per page: load it again for another' };
    if (!game.started) $('play').click();
    const S = { input: { x: 0, z: 0, run: false, dig: false }, R: rng(seedOf(shot.name)) }, p = game.player, lob = game.lobby;
    only = shot.toasts || STORY;
    try {
      await run(SETTLE * 30);
      // every model the shot can call for, so nothing pops in late and frames do not depend on the network
      await Promise.all([HERO.char, ...(shot.crowd ? CFG.people : []), ...CFG.suits].map((n) => load(`/models/${n}.glb`, { alpha: true }))
        .concat(TOOLS.map((t) => load(`/models/tools/${t.id}.glb`))));
      // a clean slate: full piles, shut mounds that stay shut, nobody about, both clocks set back from NOW
      // (the clocks read Date.now(), so the offset below cancels it: under the recorder the two are the same moment)
      for (const f of game.fields) f.reset();
      for (const m of lob.mounds) lob.set(m, 0, true);
      for (const a of lob.agents) a.hp = 0;
      lob.waves = 1e9;
      game.deadlines = G.map((g) => Date.parse(g.deadline) + Date.now() - NOW);
      p.hp = CFG.player.hp; p.deductible = 0; for (const k in p.fx) p.fx[k] = 0;
      p.name = HERO.name; p.avatar.setName(HERO.name); await p.setCharacter(HERO.char);
      put(game, CFG.spawn.x, CFG.spawn.z, PI, 0);
      game.hud.toast('', 0); game.testInput = S.input;
      const hud = q.get('hud') || shot.hud || 'clean', B = document.body.classList;
      B.add('dir-shot'); B.toggle('dir-clean', hud !== 'full'); B.toggle('dir-lone', !shot.crowd); B.toggle('dir-top', !!shot.sheetTop); B.toggle('touch', !!shot.touch && hud === 'full');
      // Upright, the presenter stands across the bottom, so the picture is lifted (fy). In a 16:9 window (tools/shots.mjs
      // --wide) he sits bottom right instead: the picture slides left (fx) so the subject lands in the left two thirds,
      // and is lifted only a little.
      const WIDE = innerWidth > innerHeight;
      game.cam = null; game.view = WIDE ? [q.has('fx') ? Number(q.get('fx')) || 0 : shot.fx ?? 0.16, (shot.fy ?? 0.18) * 0.3] : [0, shot.fy ?? 0.18]; game.resize();   // &fx=0: a wide take with nobody standing in it, subject centred
      const skip = await shot.setup?.(game, S);
      if (skip) return { name: shot.name, skip };
      if (shot.park) { put(game, 0, -300, 0, 0); p.avatar.setVisible(false); }   // nobody home: behind the Capitol, out of every frame
      if (shot.crowd) {
        CFG.net.shown = CFG.net.shownTouch = Math.max(CFG.net.shown, shot.crowd.n);   // everybody gets a body
        S.crowd = makeCrowd(game, shot.crowd.n, { seed: seedOf(shot.name), ...shot.crowd });
        game.net.notice = `${shot.crowd.n + 1} digging right now`;
      }
      for (const f of game.fields) f.shown = f.progress;   // staging is not a milestone
      if (shot.card && q.get('card') !== '0') el('div', 'dir-card', shot.card === 'title' ? "<h1>Chuck <i>&amp;</i> Hakeem <span>Won't Leave</span></h1>" : '<h1>mann.cool<span>/leave</span></h1><p>play it right now, in your browser</p>').className = 'box';
      if (q.has('guide')) label = el('div', 'dir-guide', '<i></i><u></u><b></b><s>PRESENTER STANDS HERE</s>').querySelector('b');
      // bodies arrive two at a time, so a crowd needs a longer run-up
      cur = { shot, S, T: -Math.max(shot.pre ?? 1, shot.crowd ? shot.crowd.n * 0.16 + 2 : 0), error: null };
      while (cur.T < -1e-6 && !cur.error) await run(1);
    } catch (e) { return { name: shot.name, error: String(e?.message || e) }; }
    return cur.error ? { name: shot.name, error: cur.error } : { name: shot.name, secs: shot.secs, beat: shot.beat, hud: document.body.classList.contains('dir-clean') ? 'clean' : 'full' };
  }

  function update(dt) {
    if (crowdN && !free && !cur && name === null && game.started && game.ready) free = makeCrowd(game, crowdN, { lower: game.solo ? Math.min(0.5, 20 / crowdN) : 0 });   // a practice pile sinks a little; the shared one is the server's
    free?.update(dt);
    if (!cur || cur.error) return;
    const { shot, S } = cur, T = cur.T += dt;
    try {
      shot.act?.(T, game, S, dt);
      if (T >= -(shot.crowd?.lead ?? 1e9)) S.crowd?.update(dt);
      game.cam = shot.follow ? null : shot.path ? glide(shot.path[0], shot.path[1], sat(T / shot.secs)) : shot.cam(Math.max(0, T), game, S);
    } catch (e) { cur.error = String(e?.message || e); }
    if (label) label.textContent = `${shot.name}  ${Math.max(0, T).toFixed(1)} / ${shot.secs}s  top 60% above this line`;
    window.__capture?.begin(1);
  }

  // played by hand: stage it as soon as the world is built (the recorder calls stage() itself)
  if (name !== null && !q.has('capture')) { const wait = setInterval(() => { if (game.ready) { clearInterval(wait); stage().then((r) => { if (r.error || r.skip) { only = /./; game.hud.toast(`${name}: ${r.error || r.skip}`, 8); } }); } }, 100); }

  return { update, stage, run, shots: SHOTS.map(({ name, beat, secs, hud = 'clean', top }) => ({ name, beat, secs, hud, top })), get error() { return cur?.error || null; } };
}
