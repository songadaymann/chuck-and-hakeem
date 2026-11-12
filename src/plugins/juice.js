import './juice.css';
import * as THREE from 'three';
import { CFG } from '../config.js';
import { ps1ify } from '../ps1.js';
import { roadAt, inPool, POOL, CIRCLES } from '../scenery/plan.js';

// Juice: everything YOU do answers back. Weight on every bite, a word for a bite that found nothing, streaks, small
// goals and things turned up in the dirt, the new-tool ceremony, getting hit and going down, machines that shudder
// and pitch, and small secrets around the grounds. Listens to the bus (src/EVENTS.md); touches no core file.
// Sound belongs to the audio add-on (we only ask it for a few by name), the two men and the crowd to other add-ons.

// ====================================================================================================================
// EVERY WORD THIS ADD-ON PUTS ON SCREEN. Edit the wording here and nowhere else.
// Captions are short placards at a spot in the world (keep them under about 80 characters). Lines with "\n" in them go to
// the big centre line: the part after "\n" is its second row, and about 30 characters a row fit on a phone.
// ====================================================================================================================
const COPY = {
  // ---- a bite that found no dirt, by what it hit (one every few seconds, in order)
  lawn: ['THAT IS THE LAWN.', 'WRONG DIRT.', 'THE DIRT IS UP BY THE BUILDING.', 'THE ARCHITECT OF THE CAPITOL HAS BEEN NOTIFIED.', 'STILL THE LAWN.', 'NOBODY IS BURIED HERE. WE CHECKED.'],
  stone: ['THAT IS MARBLE. IT WAS HERE FIRST.', 'THE BUILDING STAYS. THE LEADERSHIP GOES.', 'PLEASE DO NOT DIG THE CAPITOL.'],
  road: ['THAT IS A STREET. D.C. HAS ENOUGH POTHOLES.', 'THE DISTRICT WILL BILL YOU FOR THAT.'],
  water: ['THAT IS WATER. IT DOES NOT DIG.', 'YOU CANNOT SHOVEL A POOL. PEOPLE HAVE TRIED.'],
  bare: ['NOTHING LEFT RIGHT HERE. TRY THE TALL PART.', 'THAT IS THE FLOOR. THE DIRT IS UPHILL.'],
  him: ['THAT IS HIM. DIG AROUND HIM.', 'HE DID NOT FEEL THAT. DIG THE DIRT.'],
  outDug: 'HE IS ALREADY OUT.', outLost: 'TOO LATE FOR THIS ONE. HE STAYED.', outOther: ' THE OTHER ONE IS STILL IN THERE.',

  // ---- streaks: every 8th bite in a row (every 20th with the fast tools) the "+m³" gets a word, in this order
  streak: ['HEAVE', 'AGAIN', 'HO', 'AND AGAIN', 'KEEP GOING', 'FOR THE REPUBLIC', 'ONE MORE', 'STILL GOING', 'NO UNION BREAK', 'RELENTLESS', 'THEY FELT THAT', 'OUT. OUT. OUT.'],

  // ---- your own total passing real-world sizes: [cubic metres, second row]. First row is sizeHead.
  sizeHead: '{n} m³ DUG',
  sizes: [
    [10, 'about one dump truck'],
    [33, 'one shipping container, full'],
    [60, 'a backyard swimming pool'],
    [170, 'roughly one subway car'],
    [250, 'one house, filled to the ceiling'],
    [400, 'a hotel pool. no lifeguard on duty'],
    [535, 'a cubic metre per member of Congress'],
    [1000, 'a million litres of not leaving'],
    [1300, 'half an Olympic pool. the shallow half'],
    [1776, 'the founders wanted a bigger shovel'],
    [2500, 'one Olympic swimming pool'],
    [4000, 'one large hot-air balloon, if it were dirt'],
    [5740, 'one blimp, by volume'],
    [12500, 'five Olympic pools. the IOC has questions'],
    [25500, 'the big Reflecting Pool, drained'],
    [37000, 'about one Capitol Rotunda, floor to dome'],
    [54000, "both piles' worth. they are still there"],
    [100000, 'forty Olympic pools. please hydrate'],
    [200000, 'one Hindenburg'],
    [1040000, 'the Empire State Building, by volume'],
    [2600000, 'the Great Pyramid. pharaohs stayed too'],
  ],

  // ---- things a bite turns up now and then. The collection is kept on this device.
  foundHead: 'FOUND', foundCount: '{n} of {N} found', foundAgain: 'another one', foundAll: 'COLLECTION COMPLETE\nthe Smithsonian has not called',
  finds: [
    'A 1998 PAGER', 'UNOPENED CONSTITUENT MAIL', 'A DONOR ROLODEX', 'FOSSILISED TALKING POINT', 'A STRONGLY WORDED LETTER, UNSENT', 'THE PUBLIC OPTION',
    'A TERM LIMIT (EXPIRED)', '40 YEARS OF FUNDRAISING EMAILS', 'POLITICAL COURAGE, STILL IN THE WRAPPER', 'A FAX MACHINE (WARM)', 'A "DEEPLY CONCERNED" RUBBER STAMP',
    'ONE (1) BOLD IDEA, UNOPENED', 'A BLACKBERRY, STILL BUZZING', 'THE 2009 SUPERMAJORITY', 'A FRAMEWORK FOR A FRAMEWORK', 'A COMMITTEE TO STUDY THE HOLE', 'SEVENTEEN LANYARDS',
    'A CABLE NEWS GREEN ROOM PASS', 'A FOCUS-GROUPED SLOGAN', 'THE YOUTH VOTE (MISPLACED)', 'A "NOW IS NOT THE TIME" DESK SIGN', 'A SUPER PAC BUSINESS CARD', "A LOBBYIST'S EXPENSE REPORT",
    'AN UNUSED SUBPOENA', 'A GAVEL (CEREMONIAL)', 'A CONCESSION SPEECH (BLANK)', 'A RETIREMENT PARTY INVITATION, NEVER SENT', 'A SUCCESSION PLAN (ONE PAGE, EMPTY)',
    'A PARKING SPOT, RESERVED SINCE 1999', 'A TOWN HALL SIGN-IN SHEET (EMPTY)', 'A CONTINUING RESOLUTION', 'A MOTION TO TABLE THE SHOVEL', 'A CAMPAIGN PROMISE, LIGHTLY USED',
    'A GALA TABLE FOR TEN ($50,000)', 'A PRESS RELEASE ABOUT A LETTER ABOUT A MEETING', 'THE MOMENT (UNMET)', 'A FLIP PHONE WITH 9,000 VOICEMAILS', 'DRY POWDER, KEPT DRY',
    'A FUNDRAISING TEXT MARKED "FINAL NOTICE (1 OF 400)"', 'A NORM', 'A POLL FROM 2006', 'A BOX OF "FIGHT" SIGNS, NEVER OPENED',
  ],

  // ---- the new-tool ceremony: the line under each tool's name (the shovel's shows when you start)
  toolHead: 'NEW TOOL',
  taglines: {
    shovel: "THE PEOPLE'S IMPLEMENT", pickaxe: 'NOW WITH A POINTY END', jackhammer: 'NOISE COMPLAINTS: YES', trencher: 'WALK-BEHIND DEMOCRACY',
    skid_steer: 'YOU MAY NOW SIT DOWN', backhoe_loader: 'TWO ENDS, BOTH USEFUL', excavator: 'PERMIT PENDING', bulldozer: 'SUBTLETY HAS LEFT THE GROUNDS',
    mining_shovel: 'BORROWED FROM A COAL MINE. NO QUESTIONS ASKED', bucket_wheel_excavator: '71 METRES OF CONSTITUENT FEEDBACK',
  },

  // ---- getting hit
  hikes: ['-$4', '-$40', '-$400', '-$4,000', '-$40,000', '-$400,000'],   // one a second while a price hike lasts
  // the second button on the Terms pop-up. It never declines: each press shows the next excuse (they carry on from one
  // pop-up to the next), and after the last excuse it reads declineGiveUp, which agrees.
  declineBtn: 'DECLINE',
  decline: ['DECLINE IS LOADING...', 'NOT AVAILABLE IN YOUR REGION', 'ARE YOU SURE?', 'PLEASE HOLD', 'DECLINE (PREMIUM ONLY)', 'TRY AGAIN IN 30 DAYS', 'YOUR DECLINE IS IMPORTANT TO US', 'DECLINED. JUST KIDDING',
    'HAVE YOU TRIED AGREEING?', 'A REPRESENTATIVE WILL BE WITH YOU SHORTLY', 'ERROR 451', 'DECLINING REQUIRES AN ACCOUNT'],
  declineGiveUp: 'FINE. I AGREE',
  terms: [
    'By holding this shovel you grant us a perpetual licence to the hole.',
    'We care about your privacy. Tap I AGREE to learn how much.',
    'Digging now requires an account. Digging Plus removes ads from the dirt.',
    'We have added 14 new partners who would like to know where you dig.',
    'Your free trial of the ground has ended.',
    'This pop-up uses cookies to remember that you hate this pop-up.',
  ],
  // going down: first row by what got you, second row for all of them
  downs: { aipac: 'TALKED INTO THE GROUND', insurance: 'COVERAGE LAPSED', pharma: 'SIDE EFFECTS MAY INCLUDE THIS', oil: 'SLIPPED AWAY', wallst: 'ACQUIRED', tech: 'ACCOUNT SUSPENDED', pricehike: 'PRICED OUT', other: 'LOBBIED' },
  downSub: 'back on shift in a moment',
  back: 'BACK ON SHIFT',

  // ---- idle and edges
  recess: 'YOU ARE NOW IN RECESS\nthe dirt is not',
  session: 'BACK IN SESSION',
  edge: ['THE PROTEST PERMIT ENDS HERE\nthe dig is behind you', 'PERMIT BOUNDARY\npast this line it is just Washington', 'NO DIGGING PAST THIS LINE\nthe paperwork was very clear'],
  welcome: 'WELCOME BACK', welcomeDug: '{away} away. the dig went on:\n{dug}', welcomeNone: 'the pile missed you. it did not say so',
  awayDays: '{n} days', awayHours: '{n} hours', awayHour: 'an hour',

  // ---- secrets: each once per visit
  ding: 'DING', order: 'ORDER! ORDER!\nthe chair recognises the shovel',
  apology: 'APOLOGY ACCEPTED', coffee: '+1 COFFEE', sorry: 'SORRY', unbought: 'NOT FOR SALE',
  secrets: {
    wade1: 'NO WADING.', wade2: 'FINE. A LITTLE WADING.',
    steps: 'YOU ARE NOW CLOSER TO YOUR REPRESENTATIVES THAN THEIR LAST TOWN HALL GOT YOU.',
    mall: 'THE WASHINGTON MONUMENT. FINISHED IN 1884. HAS NEVER ONCE BEEN ASKED TO STEP ASIDE.',
    peace: 'PEACE CIRCLE. BUILT 1878. PEACE: PENDING.',
    garfield: 'GARFIELD CIRCLE. THE STATUE DOES NOT TAKE CALLS EITHER.',
    grant: 'ULYSSES S. GRANT. ALSO HARD TO MOVE. BUT HE IS BRONZE.',
    east: 'NO DIRT BACK HERE. THIS IS WHERE THE DONORS PARK.',
    tv: 'YOU ARE ON LIVE TELEVISION. SAY SOMETHING ABOUT THE DIRT.', tv2: 'GOOD. THAT WILL BE THE CLIP.',
    cart: 'HALF-SMOKES. THE ONE THING IN THIS TOWN THAT DELIVERS.',
    loos: 'THE ONLY SEATS IN WASHINGTON THAT TURN OVER.',
    tent: 'FREE WATER. THE LOBBYISTS BROUGHT THEIR OWN.',
    rack: 'SPARE SHOVELS. TAKE ONE. BRING A FRIEND.',
    summit: 'TOP OF THE PILE. NICE VIEW. NOW RUIN IT.',
    road: 'YOU ARE BLOCKING {street}. THIS IS CALLED A FILIBUSTER.',
    lawn: 'GROUNDSKEEPING WOULD LIKE A WORD.',
    morale: 'THAT IS ENOUGH MORALE.',
    pigeons: 'THE PIGEONS HAVE NO COMMENT.',
    honk: 'THEY ARE HONKING IN SUPPORT. PROBABLY.',
  },
};
// ====================================================================================================================

const KEY = 'dig-them-out-finds', TICK = 0.25, N = 64;
const DUST = 0xa58a62, SMOKE = [0x3a3a3a, 0x5a5a5a], SLICK = 0x111111, GRASS = [0x4e783e, 0x6a8f4c, 0x6f5334], STONE = [0xd8d2c4, 0xb9b3a4], WATER = [0x5fa8d8, 0x9fd0f0, 0xffffff],
  CONFETTI = [0xffc21a, 0xe2392f, 0x3fae5a, 0x3a6fd8, 0xffffff, 0xc0398f], SPARK = [0xffc21a, 0xffffff];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, m) => Math.max(-m, Math.min(m, v));
const by = (px, pz, r) => (x, z) => Math.hypot(x - px, z - pz) < r;
// Places with something to say: hit(x, z, y) is asked a few times a second; `need` = the scenery module that draws the thing.
const PLACES = [
  { id: 'steps', hit: (x, z, y) => Math.abs(x) < 15 && z > 22 && z < 29 && y > 2.4 },                    // top of the west steps
  { id: 'mall', need: 'ground', hit: (x, z) => z > 288 && Math.abs(x) < 70 },                             // far end of the Mall walks
  { id: 'peace', need: 'ground', hit: by(CIRCLES[0].x, CIRCLES[0].z, 13) },
  { id: 'garfield', need: 'ground', hit: by(CIRCLES[1].x, CIRCLES[1].z, 13) },
  { id: 'grant', need: 'ground', hit: (x, z) => Math.abs(x - POOL.x) < 31 && z > POOL.z - POOL.halfZ - 8 && z < POOL.z - POOL.halfZ },   // in front of the memorial
  { id: 'east', hit: (x, z) => z < -40 && Math.abs(x) < 80 },                                             // behind the Capitol
  { id: 'tv', need: 'people', hit: by(-10.4, 65, 4) },                                                    // between the reporter and her camera
  { id: 'cart', need: 'people', hit: by(-12.6, 101, 4) },
  { id: 'loos', need: 'site', hit: (x, z) => Math.hypot(Math.abs(x) - 76.6, z - 66.4) < 4.5 },
  { id: 'tent', need: 'site', hit: by(23, 90.5, 4.5) },
  { id: 'rack', need: 'site', hit: by(-22, 90.5, 4.5) },
  { id: 'summit', hit: (x, z, y) => y > 27.5 },                                                           // higher than any roof: only a pile gets you here
];

export function init(game) {
  const { bus, hud } = game, p = game.player, $ = (id) => document.getElementById(id);
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const shake = (m) => { if (!calm.matches) game.shake = Math.max(game.shake, m); };
  const sfx = (name, at) => { try { game.plugins.audio?.play?.(name, at); } catch (e) { /* no sound today */ } };
  const live = () => game.started && (!game.over || game.looking);
  const seen = {}, once = (id) => (seen[id] ? false : (seen[id] = true));
  const todo = [], after = (t, fn) => todo.push({ t, fn });   // game-time delays (never wall clock)

  // A caption: a placard pinned to a spot in the world for a few seconds.
  const note = (text, x, y, z, secs = 3.5, cls = '') => hud.say(text, x, y, z, secs, 'jn ' + cls);
  const headY = () => p.pos.y + (p.inVehicle ? 2.6 + p.toolCfg.cam * 0.12 : 2.7);
  // One over your own head: it walks with you, and a new one takes the old one's place.
  let mine = null;
  // in a staged trailer shot the player is a prop standing wherever the camera needs them: no asides over their head
  const STAGED = new URLSearchParams(location.search).has('shot');
  const overMe = (text, secs, cls) => {
    if (STAGED) return;
    if (mine) mine.t = 0;
    const el = note(text, p.pos.x, headY(), p.pos.z, secs, cls), last = hud.says?.[hud.says.length - 1];
    mine = last?.el === el ? last : null;   // the hud's own record of it (if this hud keeps one: without it the placard just stays put)
  };

  // The big line is shared with the whole game: wait for it to be free rather than talk over (or be dropped by) bigger news.
  let busyT = 0, busyPri = 0, toolMsg = '';
  const queue = [];
  const ask = (msg, secs, pri) => { if (busyT > 0 && busyPri >= pri) { if (queue.length < 3) queue.push([msg, secs, pri]); } else hud.toast(msg, secs, pri); };
  bus.on('toast', ({ msg, secs, pri }) => {
    busyT = secs; busyPri = pri;
    if (msg !== toolMsg) return;
    // our own new-tool line: the third row is the tagline, set smaller under the name
    const el = $('toast'), l = msg.split('\n'), tag = document.createElement('small');
    if (!l[2]) return;
    tag.className = 'jtag'; tag.textContent = l[2]; el.textContent = l[0] + '\n' + l[1]; el.append(tag);
  });

  // ---- motes: one small instanced pool for dust rings, exhaust and foot dust. They drift, shrink and go.
  const cloud = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), ps1ify(new THREE.MeshLambertMaterial()), N);
  const A = cloud.instanceMatrix.array, tint = new THREE.Color(), M = new Float32Array(N * 9);   // per mote: x y z vx vy vz size life span
  A.fill(0); for (let i = 0; i < N; i++) { A[i * 16 + 15] = 1; cloud.setColorAt(i, tint.set(DUST)); }
  cloud.frustumCulled = false; cloud.visible = false; game.scene.add(cloud);
  let moteI = 0, motesLive = 0;
  function mote(x, y, z, vx, vy, vz, size, secs, color) {
    const i = moteI++ % N, o = i * 9;
    M[o] = x; M[o + 1] = y; M[o + 2] = z; M[o + 3] = vx; M[o + 4] = vy; M[o + 5] = vz; M[o + 6] = size; M[o + 7] = M[o + 8] = secs;
    cloud.setColorAt(i, tint.set(color)); cloud.instanceColor.needsUpdate = true; cloud.visible = true; motesLive = 1;
  }
  function stepMotes(dt) {
    if (!motesLive) return;
    motesLive = 0;
    const drag = Math.max(0, 1 - dt * 2.5);
    for (let i = 0; i < N; i++) {
      const o = i * 9, a = i * 16;
      if (M[o + 7] <= 0) continue;
      if ((M[o + 7] -= dt) <= 0) { A[a] = A[a + 5] = A[a + 10] = 0; continue; }
      M[o + 3] *= drag; M[o + 5] *= drag;
      A[a + 12] = M[o] += M[o + 3] * dt; A[a + 13] = M[o + 1] += M[o + 4] * dt; A[a + 14] = M[o + 2] += M[o + 5] * dt;
      A[a] = A[a + 5] = A[a + 10] = M[o + 6] * (0.35 + 0.65 * M[o + 7] / M[o + 8]);
      motesLive++;
    }
    cloud.instanceMatrix.needsUpdate = true;
    if (!motesLive) cloud.visible = false;
  }
  // A ring of dust rolling outward along the ground from a bite of radius r.
  function ring(x, y, z, r, n, color) {
    const a0 = Math.random() * 6.283, sp = 1.6 + r * 0.9, size = 0.8 + r * 0.35;
    for (let k = 0; k < n; k++) { const a = a0 + k / n * 6.283, c = Math.cos(a), s = Math.sin(a); mote(x + c * r * 0.55, y + 0.15, z + s * r * 0.55, c * sp, 0.5 + Math.random() * 0.8, s * sp, size * (0.7 + Math.random() * 0.6), 0.45 + Math.random() * 0.2, color); }
  }

  // ---- every bite: weight when it lands, a word when it finds nothing
  // 'bite' comes first and 'dig' / 'denied' follow in the same tick only if it counted, so a bite still pending at our update found no dirt.
  const pend = { on: false, x: 0, z: 0, tool: null };
  let streak = 0, lastDig = -99, digs = 0, findT = 10 + Math.random() * 8, missT = -99, lawnN = 0, sorry = false, dings = 0, dingT = -99;
  const turn = {};   // how far down each list of misses we are
  bus.on('bite', ({ x, z, tool }) => {
    pend.on = true; pend.x = x; pend.z = z; pend.tool = tool;
    // the two flagpoles at the foot of the steps ring when struck
    if (!game.sceneryMods.site || Math.abs(z - 44) > 3.2 || Math.abs(Math.abs(x) - 24) > 3.2) return;
    pend.on = false;
    const px = Math.sign(x) * 24, py = game.surface(px, 44) + 3;
    hud.pop(COPY.ding, px, py, 44, 'jword'); bus.emit('ding', { x: px, y: py, z: 44 }); sfx('bell', { x: px, y: py, z: 44 });   // the audio add-on rings it once, whichever way it hears
    dings = game.time - dingT < 4 ? dings + 1 : 1; dingT = game.time;
    if (dings === 5 && once('order')) ask(COPY.order, 4, 1);
  });
  bus.on('denied', () => { pend.on = false; });
  bus.on('dig', ({ x, y, z, r, tool }) => {
    pend.on = false;
    const veh = tool.kind === 'vehicle', fast = tool.period < 0.6, every = fast ? 20 : 8;
    if (!fast) shake(Math.min(0.8, tool.cam * (veh ? 0.02 : 0.012)));   // a pixel or two at that tool's camera distance; the fast tools would never stop shaking
    ring(x, y, z, r, fast ? 3 : veh ? 12 : 7, DUST);
    if (game.time - lastDig > tool.period * 1.5 + 1.5) streak = 0;
    lastDig = game.time; streak++; digs++;
    const found = (findT -= tool.period) <= 0;   // about one a minute of solid digging, whatever the tool
    if (found && !STAGED) { findT = 45 + Math.random() * 45; find(x, y, z); }
    else if (sorry) { sorry = false; hud.pop(COPY.apology, x, y + 2.8, z, 'jword'); }
    else if (streak % every === 0) hud.pop(COPY.streak[(streak / every - 1) % COPY.streak.length], x, y + 2.8, z, 'jword');
    if (digs % 100 === 0 && p.name.startsWith('Caffeinated')) hud.pop(COPY.coffee, p.pos.x, headY(), p.pos.z, 'jword');
  });
  function miss() {
    const { x, z, tool } = pend, n = game.net, r = Math.max(tool.r, 2.6);
    if (n?.everOnline && !n.online) return;   // cut off: the core is already saying so
    for (const m of game.lobby.mounds) if ((m.hp > 0 || m.sink > 0) && Math.hypot(m.x - x, m.z - z) < r + 4.5) return;   // that was a swing at a nest
    for (const a of game.lobby.agents) if (Math.hypot(a.pos.x - x, a.pos.z - z) < r + 1.5) return;                       // or at a lobbyist
    if (document.querySelector('#guidechip:not([hidden])')) { game.puff(x, game.surface(x, z) + 0.2, z, 3, 0.6); return; }   // a first-timer is already being shown the way: one voice at a time
    const y = game.surface(x, z), fi = game.fields.findIndex((f) => f.inside(x, z)), dressed = !!game.sceneryMods.ground;
    let kind = 'lawn', color = GRASS, line = '';
    if (fi >= 0) {
      const st = game.status(fi), other = game.fields.length === 2 && game.status(1 - fi) === 'buried';
      color = null; kind = game.fields[fi].floorAt(x, z) > CFG.giant.baseY + 6 ? 'him' : 'bare';
      if (st !== 'buried') line = (st === 'dug' ? COPY.outDug : COPY.outLost) + (other ? COPY.outOther : '');
    } else if (dressed && inPool(x, z)) { kind = 'water'; color = WATER; }
    else if (y > 0.4) { kind = 'stone'; color = STONE; }
    else if (dressed && roadAt(x, z)) { kind = 'road'; color = STONE; }
    else if (++lawnN === 20 && once('lawn')) { sorry = true; missT = game.time; note(COPY.secrets.lawn, x, y + 1.6, z, 5); }
    game.puff(x, y + 0.2, z, 3, 0.6, color);
    if (game.time - missT < 5) return;
    missT = game.time;
    if (!line) { const i = turn[kind] || 0; turn[kind] = i + 1; line = COPY[kind][i % COPY[kind].length]; }
    note(line, x, y + 1.6, z, 2.8);
  }

  // ---- things in the dirt: a per-device collection
  let got = [];
  try { got = JSON.parse(localStorage.getItem(KEY) || '[]').filter((t) => COPY.finds.includes(t)); } catch (e) { got = []; }
  function find(x, y, z) {
    const fresh = COPY.finds.filter((t) => !got.includes(t)), item = pick(fresh.length ? fresh : COPY.finds);
    if (fresh.length) { got.push(item); try { localStorage.setItem(KEY, JSON.stringify(got)); } catch (e) { /* private window */ } }
    const el = note('', x, y + 1.5, z, 4.2, 'found'), b = document.createElement('b'), i = document.createElement('i');
    b.textContent = COPY.foundHead; i.textContent = fresh.length ? COPY.foundCount.replace('{n}', got.length).replace('{N}', COPY.finds.length) : COPY.foundAgain;
    el.append(b, item, i);
    game.puff(x, y + 0.6, z, 5, 1, SPARK); sfx('blip');
    if (fresh.length === 1) ask(COPY.foundAll, 5, 1);
  }

  // ---- your own total passing real-world sizes. A returning digger starts from where they are, not from zero.
  let sizeI = 0;
  const sizeFrom = () => { sizeI = 0; while (sizeI < COPY.sizes.length && COPY.sizes[sizeI][0] <= p.dug) sizeI++; };
  bus.on('start', () => {
    sizeFrom();
    after(5, () => overMe(`${p.toolCfg.name}: ${COPY.taglines[p.toolCfg.id]}`, 4));
  });

  // ---- NEW TOOL: the biggest personal moment
  bus.on('toolUp', ({ tool, quiet }) => {
    if (quiet || !game.started) return;
    const big = tool.cam / 6;   // a machine is seen from further off, so its party is bigger
    const burst = () => {   // paper from the clod pool, and a fountain of our own straight up through it
      const x = p.pos.x, y = headY() - 0.8, z = p.pos.z;
      game.puff(x, y, z, 26, 1.3 * big, CONFETTI);
      for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283 + Math.random(); mote(x, y, z, Math.cos(a) * 3.5 * big, (2.5 + Math.random() * 3.5) * big, Math.sin(a) * 3.5 * big, 0.8 * big, 0.7 + Math.random() * 0.5, CONFETTI[k % CONFETTI.length]); }
    };
    burst(); after(0.35, burst);
    ring(p.pos.x, p.pos.y, p.pos.z, 2.5, 12, DUST);
    shake(Math.min(0.9, 0.25 + tool.cam * 0.012));
    p.avatar.cheer(3);
    ask(toolMsg = `${COPY.toolHead}\n${tool.name.toUpperCase()}\n${COPY.taglines[tool.id] || ''}`, 4.5, 3);
  });
  bus.on('moundDown', ({ mound, quiet }) => { if (!quiet && live() && Math.hypot(mound.x - p.pos.x, mound.z - p.pos.z) < 30) { p.avatar.cheer(2.2); shake(0.3); } });   // you were there when it went

  // ---- getting hit, going down, coming back
  let hikeI = 0, hikeT = 0;
  bus.on('hurt', ({ lobby, effect }) => {
    if (!calm.matches) {
      const el = document.createElement('div'); el.className = 'jflash'; el.style.setProperty('--c', lobby.color);
      $('fx').append(el); hud.later(el, 0.4);
    }
    shake(0.25);
    try { navigator.vibrate?.(30); } catch (e) { /* not on this phone */ }
    if (effect === 'buyout' && p.name.startsWith('Unbought')) hud.pop(COPY.unbought, p.pos.x, headY(), p.pos.z, 'jword');
    if (effect === 'tos') { giveUp = false; if (decline) decline.textContent = COPY.declineBtn; if (Math.random() < COPY.terms.length / (COPY.terms.length + 3)) $('tostext').textContent = pick(COPY.terms); }
  });
  // The Terms pop-up grows a DECLINE button. It does not decline.
  let declineI = 0, giveUp = false, decline = null, touchAt = -1e9;
  const agree = $('tosbtn');
  if (agree) {
    decline = document.createElement('button'); decline.id = 'jdecline'; decline.className = 'alt'; decline.textContent = COPY.declineBtn;
    agree.after(decline);
    const press = () => {
      if (giveUp) { giveUp = false; decline.textContent = COPY.declineBtn; agree.click(); return; }
      giveUp = declineI === COPY.decline.length;
      decline.textContent = giveUp ? COPY.declineGiveUp : COPY.decline[declineI++];
      if (giveUp) declineI = 0;
    };
    decline.onclick = () => { if (performance.now() - touchAt > 700) press(); };
    // phones send no click while another thumb is still down on the stick (and may send one after this when it is not)
    decline.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); touchAt = performance.now(); press(); } });
  }
  bus.on('dead', ({ why, lobby }) => hud.toast(`${COPY.downs[why === 'pricehike' ? 'pricehike' : lobby?.id] || COPY.downs.other}\n${COPY.downSub}`, CFG.player.respawn, 2));
  // the camera only reaches the new spot later this frame, and a pop needs to be on screen
  bus.on('respawn', () => after(0.15, () => { const q = p.pos; ring(q.x, q.y, q.z, 2.2, 10, DUST); hud.pop(COPY.back, q.x, q.y + 2.4, q.z, 'jword'); p.avatar.cheer(1.6); }));
  bus.on('whack', ({ x, y, z }) => { if (p.name.startsWith('Polite')) hud.pop(COPY.sorry, x, y + 3.1, z, 'dim'); });

  // ---- secrets that answer an event rather than a place
  let cheers = 0, cheerT = -99;
  bus.on('cheer', ({ self }) => {
    if (!self) return;
    if (seen.tv && Math.hypot(p.pos.x + 10.4, p.pos.z - 65) < 8 && once('tv2')) overMe(COPY.secrets.tv2, 4);
    cheers = game.time - cheerT < 12 ? cheers + 1 : 1; cheerT = game.time;
    if (cheers === 5 && once('morale')) overMe(COPY.secrets.morale, 4);
  });
  bus.on('pigeons', ({ x, z }) => { if (live() && Math.hypot(x - p.pos.x, z - p.pos.z) < 25 && once('pigeons')) note(COPY.secrets.pigeons, x, game.surface(x, z) + 2.5, z, 4); });
  bus.on('honk', ({ x, y, z }) => { if (live() && Math.hypot(x - p.pos.x, z - p.pos.z) < 22 && once('honk')) note(COPY.secrets.honk, x, y + 3, z, 4); });

  // ---- welcome back: after the first 'online', once the pile has had a moment to arrive
  let welcomeT = 0, waited = 0;
  bus.on('online', ({ back }) => {
    sizeFrom();
    if (!back && !seen.welcome && game.lastVisit && Date.now() - game.lastVisit.seen > 3600e3) { seen.welcome = true; welcomeT = 2.5; }
  });
  function welcome() {
    const v = game.lastVisit, parts = [], h = (Date.now() - v.seen) / 3600e3;
    game.fields.forEach((f, i) => { const d = (f.progress - (v.pct[i] || 0)) / CFG.dirt.doneAt * 100; if (d >= 0.00005) parts.push(`${f.giant.name} +${d >= 1 ? d.toFixed(1) : d >= 0.01 ? d.toFixed(2) : d.toFixed(4)}%`); });
    const away = h >= 48 ? COPY.awayDays.replace('{n}', Math.round(h / 24)) : h >= 1.5 ? COPY.awayHours.replace('{n}', Math.round(h)) : COPY.awayHour;
    ask(COPY.welcome + '\n' + (parts.length ? COPY.welcomeDug.replace('{away}', away).replace('{dug}', parts.join(' · ')) : COPY.welcomeNone), 6, 2);
  }

  // ---- machines feel alive: wheels turn, the body pitches with the slope, shudders, bobs and smokes
  let rig = null, pitch = 0, roll = 0, tPitch = 0, tRoll = 0, slopeT = 0, smokeT = 0, smokeI = 0, footT = 0, cart = null, onPile = false;
  const wheels = [], cartWheels = [];
  const level = (h, y) => (Math.abs(h - y) > 3.5 ? y : h);   // a wall beside you is not a slope
  function machine(dt) {
    const v = p.avatar.vehicle, cfg = p.toolCfg, body = p.avatar.body, x = p.pos.x, y = p.pos.y, z = p.pos.z;
    if (v.root !== rig) { rig = v.root; rig.rotation.order = 'YXZ'; wheels.length = 0; rig.traverse((o) => { if (o.name.startsWith('Wheel_')) wheels.push(o); }); pitch = roll = 0; }   // a new machine
    const sp = p.vel.length(), s = Math.sin(p.yaw), c = Math.cos(p.yaw), go = Math.min(1, sp / 3);
    if ((slopeT -= dt) <= 0) {
      slopeT = 0.07;
      const L = 1.2 + cfg.cam * 0.12, W = L * 0.6, most = Math.min(0.4, 4.5 / cfg.cam);   // the big ones are long and heavy: they barely nod
      tPitch = clamp(-Math.atan2(level(game.surface(x + s * L, z + c * L), y) - level(game.surface(x - s * L, z - c * L), y), 2 * L), most);
      tRoll = clamp(Math.atan2(level(game.surface(x + c * W, z - s * W), y) - level(game.surface(x - c * W, z + s * W), y), 2 * W), most * 0.75);
    }
    const k = Math.min(1, dt * 5), t = game.time, amp = calm.matches ? 0 : cfg.cam * 0.003;   // about a pixel at this machine's camera distance
    pitch += (tPitch - pitch) * k; roll += (tRoll - roll) * k;
    rig.position.y = y + Math.sin(t * 9) * amp * 2.5 * go + Math.sin(t * 41) * amp * (p.digging ? 2 : 1);
    rig.rotation.x = pitch + (amp ? Math.sin(t * 7.3) * 0.012 * go : 0);
    rig.rotation.z = roll + (amp ? Math.sin(t * 37) * 0.004 : 0);
    for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x += sp * dt / Math.max(0.3, wheels[i].position.y);   // a wheel's hub sits one radius off the ground
    // the avatar seated its driver before we tilted the machine: seat them again
    rig.updateMatrixWorld(true);
    if (v.seat && body) { v.seat.getWorldPosition(body.root.position); v.seat.getWorldQuaternion(body.root.quaternion); }
    if ((smokeT -= dt * (sp > 1 || p.digging ? 2.2 : 1)) <= 0) {
      smokeT = 0.36;
      const back = 0.8 + cfg.cam * 0.06;
      mote(x - s * back + c * 0.4, y + 1.3 + cfg.cam * 0.1, z - c * back - s * 0.4, -s * 0.8 + Math.random() - 0.5, 1.4 + cfg.cam * 0.03 + Math.random() * 0.8, -c * 0.8 + Math.random() - 0.5, 0.8 + cfg.cam * 0.06 + Math.random() * 0.5, 0.6 + Math.random() * 0.4, SMOKE[smokeI++ & 1]);
    }
  }
  function onFoot(dt) {
    const tool = p.avatar.tool, sp = p.vel.length();
    if (tool !== cart) { cart = tool; cartWheels.length = 0; tool?.traverse((o) => { if (o.name.startsWith('Wheel_')) cartWheels.push(o); }); }   // the trencher rolls on two
    for (let i = 0; i < cartWheels.length; i++) cartWheels[i].rotation.x += sp * dt / 0.25;
    // dust at your feet on a pile (more when running), black spray on an oil slick
    if (sp > 1 && (onPile || p.fx.slick > 0) && (footT -= dt * sp / 6) <= 0) {
      footT = 0.16;
      mote(p.pos.x + (Math.random() - 0.5) * 0.5, p.pos.y + 0.1, p.pos.z + (Math.random() - 0.5) * 0.5, -p.vel.x * 0.15, 0.7, -p.vel.z * 0.15, 0.9, 0.4, p.fx.slick > 0 ? SLICK : DUST);
    }
  }

  // ---- a few times a second: goals, idling, edges and places
  let idleT = 0, dots = false, recess = false, lastYaw = 0, edgeT = 0, edgeI = 0, wadeT = 0, roadT = 0;
  const bar = $('toolbar')?.parentElement;
  function slow() {
    const x = p.pos.x, y = p.pos.y, z = p.pos.z;
    if (queue.length && busyT <= 0) { const q = queue.shift(); hud.toast(q[0], q[1], q[2]); }
    if (sizeI < COPY.sizes.length && p.dug >= COPY.sizes[sizeI][0]) {
      while (sizeI + 1 < COPY.sizes.length && p.dug >= COPY.sizes[sizeI + 1][0]) sizeI++;   // several at once (a big machine): only the biggest
      const [n, line] = COPY.sizes[sizeI++];
      ask(COPY.sizeHead.replace('{n}', n.toLocaleString()) + '\n' + line, 3.5, 1);
    }
    const next = CFG.tools[p.tier + 1], cur = CFG.tools[p.tier];
    bar?.classList.toggle('jalmost', !!next && (p.dug - cur.need) / (next.need - cur.need) > 0.9);
    onPile = false;
    for (let i = 0; i < game.fields.length; i++) { const f = game.fields[i]; if (f.inside(x, z) && f.heightAt(x, z) - f.floorAt(x, z) > 0.3) onPile = true; }
    if (welcomeT > 0 && (welcomeT -= TICK) <= 0) { if (waited++ < 40 && !game.fields.some((f) => f.progress > 0)) welcomeT = TICK; else welcome(); }
    if (p.dead > 0 || STAGED) { idleT = 0; return; }

    // standing still
    const busy = p.moving || p.digging || p.fx.tos > 0 || Math.abs(p.camYaw - lastYaw) > 0.01 || (idleT > 20 && !!document.querySelector('.modal-open'));
    lastYaw = p.camYaw;
    if (busy) { if (recess) hud.pop(COPY.session, x, headY(), z, 'jword'); idleT = 0; dots = recess = false; }
    else {
      idleT += TICK;
      const nap = p.name.startsWith('Sleepy') ? 0.5 : 1;
      if (!dots && idleT > 25 * nap) { dots = true; overMe('...', 3, 'think'); }
      if (!recess && idleT > 60 * nap) { recess = true; hud.toast(COPY.recess, 4, 0); }
    }
    // the edge of the world
    if ((edgeT -= TICK) <= 0 && x * x + z * z > (CFG.worldRadius - 5) ** 2) { edgeT = 45; hud.toast(COPY.edge[edgeI++ % COPY.edge.length], 3.5, 0); }
    // places
    for (let i = 0; i < PLACES.length; i++) {
      const s = PLACES[i];
      if (seen[s.id] || (s.need && !game.sceneryMods[s.need]) || !s.hit(x, z, y)) continue;
      seen[s.id] = true; overMe(COPY.secrets[s.id], 5); sfx('pop');
    }
    if (!game.sceneryMods.ground) return;
    if (inPool(x, z)) {   // wading in the reflecting pool
      if (p.moving) game.puff(x, y + 0.1, z, 3, 1, WATER);
      wadeT += TICK;
      if (once('wade1')) overMe(COPY.secrets.wade1, 3); else if (wadeT > 4 && once('wade2')) overMe(COPY.secrets.wade2, 4);
    }
    // standing in a street (they are all out past the lawns, so nobody on a pile pays for this check)
    if (!seen.road && !p.moving && (z > 105 || z < -140 || Math.abs(x) > 195)) {
      const r = roadAt(x, z);
      roadT = r ? roadT + TICK : 0;
      if (roadT > 5) { seen.road = true; overMe(COPY.secrets.road.replace('{street}', r.name.toUpperCase()), 5); }
    } else roadT = 0;
  }

  let acc = 0;
  function update(dt) {
    for (let i = todo.length - 1; i >= 0; i--) if ((todo[i].t -= dt) <= 0) { const f = todo[i].fn; todo.splice(i, 1); f(); }
    if (busyT > 0) busyT -= dt;
    if (mine) { if (mine.t <= 0 || p.dead > 0) { mine.t = 0; mine = null; } else { mine.x = p.pos.x; mine.y = headY(); mine.z = p.pos.z; } }
    if (live()) {
      if (pend.on) { pend.on = false; miss(); }
      if (p.dead <= 0 && p.body) {
        // a price hike costs you by the second
        if (p.fx.pricehike > 0) { if ((hikeT -= dt) <= 0) { hikeT = 1; hud.pop(COPY.hikes[Math.min(hikeI++, COPY.hikes.length - 1)], p.pos.x, headY(), p.pos.z, 'jcost'); } } else hikeI = hikeT = 0;
        if (p.inVehicle) machine(dt); else onFoot(dt);
      }
      if ((acc += dt) >= TICK) { acc = 0; slow(); }
    } else pend.on = false;
    stepMotes(dt);
  }
  return { update };
}
