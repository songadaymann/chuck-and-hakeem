// The two men, alive. They watch you cross the lawn, flinch when a tool lands by the head, fidget harder as the dirt
// drops (arms past half way, a real wobble past three quarters), shed dirt off their shoulders, peek at their own
// clocks, and talk: one speech bubble at a time, hung under the chin, or docked at the top of the screen with his name
// on it when he is out of the picture. All of it is for show, in this browser only; nothing here touches the dig.
// Other add-ons may call game.plugins.giants.say(i, text) and .react(i, context, fill); each bubble is announced on the
// bus as 'giantSay' { i, giant, text, secs }.
import './giants.css';
import { PerspectiveCamera, Vector3 } from 'three';
import { CFG } from '../config.js';

// ---- COPY: every word either man says is in this block. All of it is PARODY written for this game: jokes about a
// man refusing to leave a pile of dirt, never anything he said, never about anyone's body, age, health, religion or
// ethnicity. {N} = people digging right now, {TOOL} = your new tool, {LOBBY} = the lobby whose nest opened or fell
// (any of the six: keep lines that name one neutral, so the joke stays about lobbying and never about who).
// Chuck: folksy procedural stalling. Letters, committees, the next cycle, glasses down the nose.
const CHUCK = {
  idle: [
    'I WILL STEP ASIDE RIGHT AFTER THE NEXT CYCLE. AND THE ONE AFTER.',
    'HAVE YOU TRIED A STRONGLY WORDED LETTER TO THE DIRT?',
    'LOOK. FOLKS. I HEAR YOU. I AM ALSO STAYING.',
    'I AM DRAFTING A LETTER ABOUT YOU. IT IS VERY STRONGLY WORDED.',
    'THIS IS NOT THE MOMENT. THE MOMENT IS NEXT CYCLE.',
    'I WOULD HOLD A PRESS CONFERENCE BUT THE PODIUM IS UNDER HERE SOMEWHERE.',
    'I LIKE IT IN HERE. GOOD VIEW OF THE DONORS.',
    'LET US NOT RUSH. WE ONLY STARTED DISCUSSING THIS LAST CYCLE.',
    'MY FLIP PHONE IS DOWN HERE SOMEWHERE. NOBODY DIG NEAR THE FLIP PHONE.',
    'I AM PEERING AT YOU OVER MY GLASSES. THAT IS A FORMAL WARNING.',
    'WE WILL REVISIT THE SHOVEL QUESTION IN COMMITTEE.',
  ],
  early: [   // barely dug: he is not worried
    "THAT'S ADORABLE. KEEP GOING. I'LL WAIT.",
    'A SHOVEL. AGAINST ALL THIS. I ADMIRE THE PAPERWORK YOU ARE ABOUT TO NEED.',
    'AT THIS RATE I AM OUT BY NEVER. PENCIL IT IN.',
    'I HAVE SAT THROUGH FILIBUSTERS LONGER THAN THIS PILE.',
    'YOU MOVED A CLOD. I HAVE REFERRED IT TO THE RULES COMMITTEE.',
    'THE DIRT AND I HAVE A LONG-STANDING WORKING RELATIONSHIP.',
  ],
  mid: [   // getting worried
    'I FEEL A DRAFT. I OPPOSE THE DRAFT.',
    "OKAY. FOLKS. LET'S NOT DO ANYTHING HASTY, LIKE WHAT YOU ARE DOING.",
    'I AM DEEPLY CONCERNED ABOUT THAT SHOVEL.',
    'WHO APPROVED THIS MUCH DIGGING? I WANT IT IN WRITING.',
    'I PROPOSE A BIPARTISAN PAUSE ON THE DIGGING.',
    'THE PILE IS GETTING SHORTER. I WILL BE WRITING TO THE PILE.',
  ],
  late: [   // nearly out
    'LET US FORM A COMMITTEE TO STUDY HOW OUT I AM.',
    'I CAN SEE MY OWN LAPELS. THIS HAS GONE TOO FAR.',
    'FINE. ONE MORE CYCLE AND THEN I PROMISE TO CONSIDER THINKING ABOUT IT.',
    'PUT SOME BACK. I WILL CO-SPONSOR PUTTING SOME BACK.',
    'I AM WOBBLING IN A DELIBERATE AND PROCEDURAL MANNER.',
  ],
  flinch: [   // a tool landed right by his head
    'HEY! MIND THE GLASSES. THE GLASSES ARE LOAD-BEARING.',
    'THAT ONE WAS CLOSE. I FELT IT IN MY DONOR LIST.',
    'EASY! THAT IS SENATE DIRT.',
    'I WILL REMEMBER THAT CLOD AT THE NEXT MARKUP.',
  ],
  milestone: [
    'A MILESTONE? I DO NOT RECOGNIZE THE MILESTONE.',
    'NOTED. I WILL RESPOND TO THIS PROGRESS WITH A LETTER.',
    'LET THE RECORD SHOW I DID NOT AGREE TO THAT MUCH.',
  ],
  moundOpen: [   // relief: help has arrived
    'OH GOOD. MY FRIENDS FROM {LOBBY} ARE HERE.',
    'FINALLY. SOME ADULTS WITH BRIEFCASES.',
    'THE CAVALRY. AND THEY BROUGHT BROCHURES.',
  ],
  moundDown: [   // dismay
    'THAT WAS MY FAVORITE LOBBY. WHO WILL TELL ME WHAT I THINK?',
    'NOT {LOBBY}! WE HAD A LUNCH ON THE CALENDAR.',
    'THAT WAS A PERFECTLY GOOD NEST. I HAD MEETINGS IN THERE.',
  ],
  toolUp: [   // you earned a bigger tool
    'A {TOOL}? IS THAT PERMITTED? SOMEBODY CHECK IF THAT IS PERMITTED.',
    'WHO GAVE THE VOTER A {TOOL}?',
    'I WOULD LIKE TO SEE THE PERMIT FOR THAT {TOOL}. IN TRIPLICATE.',
  ],
  dead: [   // the lobbyists knocked you down: smug
    'SEE? THE SYSTEM WORKS.',
    'TAKE A REST. I DID. I AM STILL TAKING IT.',
    'THAT IS WHAT WE CALL CONSTITUENT SERVICES.',
  ],
  called: [   // you phoned Congress: alarm
    'ARE YOU CALLING MY OFFICE? DO NOT CALL MY OFFICE.',
    'NOT THE PHONES. LETTERS I CAN IGNORE.',
    'WHO GAVE THEM THE SWITCHBOARD NUMBER?',
  ],
  few: ['ONLY {N} OF YOU? I HAVE HAD BIGGER SUNDAY PRESS CONFERENCES.', '{N} DIGGERS. I HAVE MORE COMMITTEES THAN THAT.'],
  crowd: ['{N} PEOPLE DIGGING. THAT IS A LOT OF LETTERS TO NOT ANSWER.', '{N} OF YOU? DOES NOBODY HAVE A FUNDRAISER TO GET TO?'],
  horde: ['{N} OF YOU. HAS ANYONE CONSIDERED A SMALLER, MORE MANAGEABLE MOVEMENT?'],
  day: ['ONE DAY LEFT. I CAN STALL FOR ONE DAY WITHOUT NOTES.', 'LESS THAN A DAY. I HAVE HAD QUORUM CALLS LONGER THAN THAT.'],
  hour: ['ONE HOUR. I HAVE GIVEN LONGER OPENING REMARKS.', 'UNDER AN HOUR. NOBODY LOOK AT THE SIGN.'],
  ten: ['TEN MINUTES. I AM NOT LOOKING AT THE SIGN. YOU ARE LOOKING AT THE SIGN.'],
  rest: ['TIRED? GOOD. TIRED IS HOW THIS USUALLY ENDS.', 'PUTTING THE SHOVEL DOWN IS THE RESPONSIBLE CHOICE.'],   // you stopped digging
  swat: ["HE HAD A FOUR O'CLOCK WITH ME.", 'THAT WAS A VALUED STAKEHOLDER.'],   // you flattened a lobbyist
  cheer: ['PLEASE HOLD YOUR APPLAUSE UNTIL I HAVE NOT LEFT.'],
  otherOut: ['HAKEEM? HAKEEM! HE DID NOT EVEN FILE A MOTION.'],   // the other man was dug out
  otherIn: ['HAKEEM HELD ON. THAT IS LEADERSHIP. NOBODY MOVE.'],   // the other man ran out his clock
  dug: ['THIS IS NOT GOODBYE. I AM MERELY YIELDING THE REMAINDER OF MY TIME.', 'I WILL BE SENDING A STRONGLY WORDED LETTER FROM UP HERE.'],   // his last line, floating off
  lost: ['WELL. THE PROCESS HAS SPOKEN. THANK YOU ALL FOR YOUR INTEREST IN DIGGING.', 'NO HARD FEELINGS. SAME TIME NEXT CYCLE?'],   // his clock ran out: gracious winner
  won: ['STILL HERE. FUNNY HOW THAT WORKS.', 'YOU MAY KEEP THE SHOVEL AS A SOUVENIR.', 'I DID SAY NEXT CYCLE.'],   // and afterwards
};
// Hakeem: measured, alliterative, on message. Statements about statements.
const HAKEEM = {
  idle: [
    'LET ME BE CLEAR: I AM NOT CLEAR OF THIS PILE.',
    'DIGGING. DELVING. DISRUPTIVE. DISAPPOINTING.',
    'WE WILL MEET THIS MOMENT AT A LATER MOMENT.',
    'THE PILE AND I ARE IN CONVERSATION.',
    'I HAVE NO ANNOUNCEMENT ABOUT ANNOUNCING AN ANNOUNCEMENT.',
    'STEADY. STABLE. STATIONARY. THAT IS THE STRATEGY.',
    'THAT IS A QUESTION FOR ANOTHER DAY. SO IS THE NEXT ONE.',
    'WE ARE GOING TO CONTINUE TO CONTINUE.',
    'I WANT TO THANK THE DIRT FOR ITS PARTNERSHIP.',
    'LEAVING IS NOT ON THE AGENDA. THE AGENDA IS UNDER THE DIRT.',
    'PATIENT. PRINCIPLED. PARKED.',
  ],
  early: [
    'A SHOVEL. HOW SPIRITED. WE WELCOME YOUR ENERGY AND DECLINE YOUR PREMISE.',
    'MINIMAL. MARGINAL. MANAGEABLE.',
    'I HAVE SEEN THE NUMBERS. THE NUMBERS HAVE FIVE DECIMAL PLACES.',
    'WE HAVE REVIEWED YOUR PROGRESS AND FOUND IT PRELIMINARY.',
    'TAKE YOUR TIME. WE CERTAINLY INTEND TO.',
    'THE PILE REMAINS UNIFIED.',
  ],
  mid: [
    'THIS IS FINE. I PREFER IT HALF BURIED.',
    'LET ME BE CLEAR: I CAN SEE DAYLIGHT AND I DO NOT ENDORSE IT.',
    'CONCERNING. CONSEQUENTIAL. COLDER THAN IT WAS.',
    'WE ARE MONITORING THE SHOVEL SITUATION CLOSELY.',
    'THE PILE IS EVOLVING. OUR POSITION IS NOT.',
    'I WOULD CHARACTERIZE THIS AS A TEMPORARY EXCAVATION.',
  ],
  late: [
    'BUT WHO KEEPS MY PARKING SPOT?',
    'EXPOSED. EXCAVATED. EXTREMELY NOT LEAVING.',
    'AT THE APPROPRIATE TIME I WILL SAY THE APPROPRIATE TIME HAS NOT COME.',
    'LET ME BE CLEAR: THIS WOBBLE IS A PIVOT.',
    'WE ARE ONE CONVERSATION AWAY FROM ANOTHER CONVERSATION.',
  ],
  flinch: [
    'CAREFUL. CAUTIOUS. CLOSER THAN I WOULD LIKE.',
    'THAT WAS A SHOVEL. I WILL NOT BE TAKING QUESTIONS ON THE SHOVEL.',
    'NOTED. NOT APPRECIATED. NOTED.',
    'LET ME BE CLEAR: OW.',
  ],
  milestone: [
    'PROGRESS? I WOULD CALL IT A PROCESS.',
    'WE ACKNOWLEDGE THE MILESTONE AND MOVE NO FURTHER.',
    'MEASURABLE. MEMORABLE. MILDLY ALARMING.',
  ],
  moundOpen: [
    'REINFORCEMENTS. RESOURCES. RECEIPTS.',
    'AH. {LOBBY} HAS JOINED THE CONVERSATION.',
    'HELP HAS ARRIVED, AND IT IS WEARING A SUIT.',
  ],
  moundDown: [
    '{LOBBY} HAS LEFT THE CONVERSATION. WE WERE MID-SENTENCE.',
    'A VALUED PARTNER IS DOWN. WE ARE HEARTBROKEN AND UNDERFUNDED.',
    'DISMANTLED. DEFUNDED. DEEPLY INCONVENIENT.',
  ],
  toolUp: [
    'A {TOOL}. BOLD. BRASH. BADLY TIMED.',
    'WE ARE NOT GOING TO COMMENT ON THE {TOOL}.',
    'LET ME BE CLEAR: THAT {TOOL} WAS NOT IN THE TALKING POINTS.',
  ],
  dead: [
    'REST. RECOVER. RECONSIDER.',
    'WE THANK THE LOBBYIST FOR HIS SERVICE.',
    'A TEACHABLE MOMENT. THE LESSON IS STOP.',
  ],
  called: [
    'CALLS? COORDINATED? TO CONGRESS? CONCERNING.',
    'PLEASE HOLD. YOUR CALL IS IMPORTANT TO SOMEONE.',
    'THE PHONES ARE RINGING. NOBODY RECOGNIZE THE NUMBER.',
  ],
  few: ['{N} DIGGERS. A SMALL BUT VOCAL MINORITY OF EVERYONE.', '{N} OF YOU. WE WELCOME ALL {N} VOICES TO THE CONVERSATION WE ARE NOT HAVING.'],
  crowd: ['{N} PEOPLE WITH SHOVELS. WE HEAR YOU. WE ARE NOT MOVING, BUT WE HEAR YOU.', '{N} DIGGERS. DEDICATED. DETERMINED. DULY NOTED.'],
  horde: ['{N}. NUMEROUS. NOISY. NOTED.'],
  day: ['ONE DAY. DISCIPLINED. DETERMINED. DUG IN.', 'LESS THAN A DAY. WE REMAIN CONFIDENT AND UNDERGROUND.'],
  hour: ['ONE HOUR UNTIL THE VOTE. NOBODY TOUCH ANYTHING.', 'UNDER AN HOUR. CALM. COLLECTED. COUNTING.'],
  ten: ['TEN MINUTES. LET ME BE BRIEF: NO.'],
  rest: ['A PAUSE. PRUDENT. PLEASE EXTEND IT.', 'WE WELCOME THIS PERIOD OF REFLECTION AND NO DIGGING.'],
  swat: ['THAT WAS A STAKEHOLDER. HE HELD A STAKE.', 'WE CONDEMN THE SWATTING IN THE STRONGEST POSSIBLE BROCHURE.'],
  cheer: ['CHEERING. CHANTING. NOT CHANGING ANYTHING.'],
  otherOut: ['CHUCK? THE SENATE SIDE WILL BE ISSUING NO STATEMENT.'],
  otherIn: ['CHUCK STAYED. STEADFAST. STUBBORN. SAME.'],
  dug: ['UP. UP. AND UNAVAILABLE FOR COMMENT.', 'LET ME BE CLEAR: THIS IS A LATERAL MOVE. UPWARD.'],
  lost: ['A HARD-FOUGHT DIG. GRACIOUS. GRATEFUL. GOING NOWHERE.', 'WE THANK THE DIGGERS FOR THEIR INPUT. THE INPUT HAS BEEN FILED.'],
  won: ['STILL HERE. STILL CLEAR.', 'THE DIRT HAS BEEN RE-ELECTED.', 'WE LOOK FORWARD TO NOT REVISITING THIS.'],
};
// Across the building, to each other: [who, line], spoken in turn.
const DUETS = [
  [['chuck', 'HAKEEM! THEY STILL DIGGING OVER THERE?'], ['hakeem', 'DILIGENTLY. DISTRESSINGLY.']],
  [['hakeem', 'CHUCK. DO WE HAVE A PLAN?'], ['chuck', 'WE HAVE A LETTER. IT IS IN DRAFT.']],
  [['chuck', 'HAKEEM, YOU LEAVING?'], ['hakeem', 'NOT AT THIS TIME. YOU?'], ['chuck', 'NEXT CYCLE.']],
  [['hakeem', 'SENATE SIDE: STATUS?'], ['chuck', 'BURIED. COMFORTABLE. YOURS?'], ['hakeem', 'ON MESSAGE.']],
  [['chuck', 'I AM THINKING WE ISSUE A JOINT STATEMENT.'], ['hakeem', 'SAYING WHAT?'], ['chuck', 'NOTHING. BUT JOINTLY.']],
  [['hakeem', 'CHUCK, THEY HAVE SHOVELS.'], ['chuck', 'WE HAVE SENIORITY.']],
];
const VOICE = { chuck: CHUCK, hakeem: HAKEEM }, BOTH = { voice: { duet: DUETS } };
// ---- end of COPY

const G = CFG.giant, DONE = CFG.dirt.doneAt;
const SEE = 105;      // he watches you inside this many metres (the spawn point is 99 m from either man)...
const FRONT = 1.3;    // ...while you are within this angle of straight ahead of him (radians); NECK = how far the head turns
const NECK = 1.05, HEAR = 115, FAR = 170;   // he talks with you inside HEAR; beyond FAR he is left alone entirely
const OUCH = 13;      // a bite this close to the middle of his head makes him flinch
const GAP = [12, 25]; // seconds of quiet between two bubbles
// CHIN: the highest a bubble hangs (his nose: with him buried to the eyes that is the dirt in front of his face).
// JAW: the underside of his chin on the models, where it hangs once the dirt is below it (see chinY).
const CHIN = G.baseY + 27.5, JAW = G.baseY + 22.5, EYE = G.baseY + 33, SIDES = [-1, 1];
// bubble states: where it sits (0 under his chin, 1 docked and he is up ahead, 2 docked: he is to the left, 3: to the right) x hidden behind a toast
const CLS = ['', ' gdock', ' gdock gl', ' gdock gr'].flatMap((c) => ['say gsay' + c, 'say gsay' + c + ' ghush']);
const rnd = (a, b) => a + Math.random() * (b - a), unit = (x) => Math.max(0, Math.min(1, x));

export function init(game) {
  const { bus, hud } = game, p = game.player, v = new Vector3(), eye = new PerspectiveCamera(), who = {}, bags = new Map(), cool = {}, todo = [];
  const S = game.giants.map((gi, i) => {
    const L = gi.root.getObjectByName('Arm_L') || null, R = gi.root.getObjectByName('Arm_R') || null;   // the models will be swapped: nothing here needs these to exist
    return who[gi.cfg.id] = { i, gi, f: game.fields[i], voice: VOICE[gi.cfg.id] || null, L, R, lx: L ? L.rotation.x : 0, rx: R ? R.rotation.x : 0, tx: gi.root.rotation.x, tz: gi.root.rotation.z,
      d: Infinity, live: false, arms: false, tilt: false, att: 0, yaw: 0, pitch: 0, up: 0, glance: 0, peek: 0, flinch: 0, jolt: 0, crumbT: -9, ph: Math.random() * 6, wp: 0, band: -1 };
  });
  const cur = { on: false, s: null, el: null, t: 0, w: 0, h: 0, x: 0, y: 0, mode: 0, state: -1, dockY: 0, low: false };   // the one bubble
  let toastT = 0, bigT = 0, idleAt = Infinity, gapAt = 0, tick = 0, lastBite = -1e9, duet = null, bye = null, sx = 0, sy = 0, W = innerWidth, H = innerHeight;
  addEventListener('resize', () => { W = innerWidth; H = innerHeight; });

  // ---- the body
  // Back exactly as the model was made: head straight, arms down, bust upright.
  function rest(s) {
    s.gi.turn = s.gi.nod = 0; s.live = s.arms = false; s.att = s.flinch = s.jolt = s.up = 0;
    if (s.L) s.L.rotation.x = s.lx;
    if (s.R) s.R.rotation.x = s.rx;
    if (s.tilt) { s.gi.root.rotation.x = s.tx; s.gi.root.rotation.z = s.tz; s.tilt = false; }
  }
  function body(s, dt) {
    const gi = s.gi, c = gi.cfg, root = gi.root, dx = p.pos.x - c.x, dz = p.pos.z - c.z, d = s.d = Math.hypot(dx, dz), aloft = gi.was === 'dug';
    if (!root.visible || (d > FAR && !aloft)) { if (s.live) rest(s); return; }
    s.live = true;
    // how rattled he is: 0 buried and comfortable .. 1 nearly out. A man whose clock ran out has nothing left to worry about.
    const a = aloft ? 1 : gi.was === 'lost' ? 0 : unit(s.f.progress / DONE);
    // He watches you while you are in front of him; the core's own idle sway is what he does otherwise.
    const want = Math.atan2(dx, dz), sees = !aloft && d < SEE && Math.abs(want) < FRONT && p.dead <= 0 && s.glance <= 0;
    s.att += ((sees ? 1 : 0) - s.att) * Math.min(1, dt * 2.5);
    if (sees) {
      s.yaw += (Math.max(-NECK, Math.min(NECK, want)) - s.yaw) * Math.min(1, dt * 4);
      s.pitch += (Math.min(0.22, Math.atan2(EYE - p.pos.y, Math.max(8, d)) * 0.45) - s.pitch) * Math.min(1, dt * 4);   // and down at you, a little: his chin is in the dirt
    }
    s.ph += dt * (0.9 + a * 2.8);   // the fidget: faster and wider as the dirt drops
    s.glance -= dt; s.up += ((s.glance > 0 ? -0.5 : 0) - s.up) * Math.min(1, dt * 7);   // a look up at the sign over his head
    const k = Math.max(0, 1 - dt * 5); s.flinch *= k; s.jolt *= k;
    gi.turn = (s.yaw - Math.sin(game.time * 0.35 + c.x) * 0.35) * s.att * 0.9 + Math.sin(s.ph) * 0.3 * a * (1 - s.att * 0.5) + s.jolt;
    gi.nod = s.pitch * s.att + s.up + s.flinch + Math.sin(s.ph * 1.7) * 0.06 * a + (cur.on && cur.s === s ? Math.sin(game.time * 13) * 0.035 : 0);   // and he nods along to his own words
    // past half way the arms come free and start paddling (and they wave all the way up when he floats off)
    const ak = aloft ? 1 : unit((a - 0.5) / 0.25);
    if (ak > 0 || s.arms) {
      s.arms = ak > 0;
      if (s.L) s.L.rotation.x = s.lx - ak * (0.4 + 0.4 * Math.sin(s.ph * 1.9));
      if (s.R) s.R.rotation.x = s.rx - ak * (0.4 + 0.4 * Math.sin(s.ph * 1.9 + 2.6));
    }
    // past three quarters the whole bust rocks in its hole. Upright again, exactly, before the core floats him away.
    const wk = aloft ? 0 : unit((a - 0.75) / 0.2);
    if (wk > 0 || s.tilt) {
      s.tilt = wk > 0; s.wp += dt * (2.2 + wk * 2.4);
      root.rotation.z = s.tz + Math.sin(s.wp) * 0.035 * wk; root.rotation.x = s.tx + Math.sin(s.wp * 0.73 + 1) * 0.02 * wk;
    }
  }
  // Dirt slides off his shoulders.
  function shed(s) {
    const c = s.gi.cfg;
    for (const side of SIDES) { const x = c.x + side * 9.3, z = c.z + 1; game.puff(x, Math.max(G.baseY + G.shoulderY, game.surface(x, z)) + 0.5, z, 7, 3); }
  }
  function flinchAt(x, z, kick, mine) {
    for (const s of S) {
      const c = s.gi.cfg, dx = x - c.x, dz = z - c.z;
      if (!s.live || s.gi.was === 'dug' || dx * dx + dz * dz > OUCH * OUCH) continue;
      s.flinch = -kick; s.jolt = (dx > 0 ? -0.8 : 0.8) * kick;   // the head snaps back and away from the blow
      if (game.time - s.crumbT > 1.5) { s.crumbT = game.time; game.puff(c.x, G.baseY + G.height, c.z + 1, 4, 5); }   // and loses a few crumbs
      if (mine && Math.random() < 0.5 && ok('flinch', 30)) react('flinch', s, 2, 5);
    }
  }
  function slowly() {
    for (const s of S) {
      if (!s.live || s.gi.was !== 'buried') continue;
      const band = Math.floor(unit(s.f.progress / DONE) * 20);   // every twentieth of the pile, a little slides off (a jump is the server catching us up: no show)
      if (s.band >= 0 && band === s.band + 1) shed(s);
      s.band = band;
      // on his last day he keeps checking his own clock; in the last hour, when it flashes, he cannot stop
      const left = game.deadlines[s.i] - Date.now();
      if (left < 86400e3 && !game.supercharged(s.i) && (s.peek -= 0.25) <= 0) { s.glance = 0.9; s.peek = left < 3600e3 ? rnd(4, 7) : rnd(16, 30); }
    }
  }

  // ---- the talking
  const able = (s) => !!s && !!s.voice && s.gi.root.visible && s.gi.was !== 'dug';
  const ok = (ctx, secs) => (game.time < (cool[ctx] || 0) ? false : ((cool[ctx] = game.time + secs), true));
  function nearest() { let best = null; for (const s of S) if (able(s) && s.d < HEAR && (!best || s.d < best.d)) best = s; return best; }
  // The next line from one of his lists, working through the list in a shuffled order so nothing repeats until all are used.
  function line(s, ctx) {
    const pool = s.voice[ctx];
    if (!pool || !pool.length) return '';
    let b = bags.get(pool);
    if (!b) bags.set(pool, b = { order: pool.map((_, k) => k), k: pool.length, last: -1 });
    if (b.k >= b.order.length) {
      for (let k = b.order.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)), o = b.order[k]; b.order[k] = b.order[j]; b.order[j] = o; }
      if (b.order.length > 1 && b.order[0] === b.last) { b.order[0] = b.order[1]; b.order[1] = b.last; }
      b.k = 0;
    }
    return pool[b.last = b.order[b.k++]];
  }
  function drop() { if (cur.on) { cur.el.remove(); cur.on = false; } }
  // Where his bubble hangs from: the dirt line in front of his face, between his nose and the underside of his chin, so
  // that it never sits over his mouth once he is dug out (and rises with him when he floats off).
  const chinY = (s) => { const c = s.gi.cfg; return Math.max(JAW, Math.min(CHIN, game.surface(c.x, c.z + 7))) + s.gi.root.position.y - G.baseY; };
  // The camera this frame will be drawn with. The core applies a free camera (game.cam) after the add-ons have run,
  // and its own camera's matrices are a step behind until the picture is drawn.
  function view() {
    const c = game.cam, cam = game.camera;
    if (!c) { cam.updateMatrixWorld(); return cam; }
    eye.position.set(c.pos[0], c.pos[1], c.pos[2]); eye.lookAt(c.look[0], c.look[1], c.look[2]); eye.updateMatrixWorld();
    eye.projectionMatrix.copy(cam.projectionMatrix);
    return eye;
  }
  // One bubble. It hangs under his chin (his sign is over his head and has to stay readable). When that spot is off the
  // screen, under the HUD or too near an edge, the bubble docks at the top instead, with a tail toward where he is.
  // The HUD gives the bubble its lifetime (game time); where it sits is decided here (see giants.css).
  function say(s, text) {
    const c = s.gi.cfg, secs = Math.max(3.2, Math.min(6.5, 2 + text.length * 0.055));
    drop();
    const el = hud.say?.(text, c.x, chinY(s), c.z + 5, secs, 'gsay gdock');
    if (!el) return;
    el.dataset.who = c.name;
    // docked: under the notice line (which grows and shrinks), clear of the placards
    cur.dockY = Math.max(H <= 500 ? 44 : W <= 700 ? 216 : 52, (document.getElementById('timer')?.getBoundingClientRect().bottom || 0) + 21);
    // Under mann.cool's shell MENU, SOUND and the two men hang a row lower (style.css), and on a phone on its side the
    // notice line is at the bottom of the screen, which put the dock below it and out of sight: there it docks under
    // whatever of ours the centred bubble would cross (131: half the widest bubble and a little).
    const shell = !!game.shellRects?.().length, box = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && r.width && r.height ? r : null; };
    if (shell) {
      const t = box('#timer');
      cur.dockY = Math.max(H <= 500 ? 44 : W <= 700 ? 216 : 52, t && t.top < H / 2 ? t.bottom + 21 : 0);
      for (const sel of H <= 500 ? ['#guidechip > div', '#sndbtn', '#menubtn'] : W > 700 ? ['#sndbtn', '#menubtn', '#giants'] : []) { const r = box(sel); if (r && r.right > W / 2 - 131 && r.left < W / 2 + 131) cur.dockY = Math.max(cur.dockY, r.bottom + 21); }
    }
    el.style.setProperty('--gy', cur.dockY + 'px');
    cur.on = true; cur.s = s; cur.el = el; cur.t = secs; cur.mode = 0; cur.state = cur.x = cur.y = -1;
    cur.w = el.offsetWidth; cur.h = el.offsetHeight;
    // ... and on a short upright phone the row its buttons take pushes the dock down onto CALL YOUR REPS: nothing is shown there
    const reps = shell && W <= 700 && H >= W ? box('#repsbtn') : null;
    cur.low = !!reps && cur.dockY + cur.h > reps.top && W / 2 + cur.w / 2 > reps.left;
    idleAt = game.time + secs + rnd(GAP[0], GAP[1]) * (s.gi.was === 'lost' ? 2 : 1);
    track();
    bus.emit('giantSay', { i: s.i, giant: c, text, secs });
  }
  // Where a bubble of this size can go for him: 0 = under his chin (at sx, sy), 1-3 = docked.
  function spot(s, w, h) {
    const c = s.gi.cfg, narrow = W <= 700 && H > 500, half = w / 2;
    v.set(c.x, chinY(s), c.z + 5).project(view());
    const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    sx = Math.round((v.x + 1) * 0.5 * W); sy = Math.round((1 - v.y) * 0.5 * H) + 14;
    const under = game.shellRects?.().length ? 56 : 0;   // under mann.cool's shell the placards and the list hang that much lower (style.css)
    const clear = narrow ? 222 + under : sx - half < 290 || sx + half > W - 250 ? 180 + under : 44;   // the placards, the lobby list and the news run along the top
    return on && sx - half > 6 && sx + half < W - 6 && sy > clear && sy + h < H * (narrow ? 0.64 : 0.78) ? 0 : on ? 1 : (v.z > 1 ? -v.x : v.x) < 0 ? 2 : 3;
  }
  const toastY = () => (H <= 500 ? 140 : W <= 700 ? Math.max(H * 0.3, 232) : H * 0.2);   // where the core's big line sits (style.css)
  function track() {
    if (cur.mode === 0 && (cur.mode = spot(cur.s, cur.w, cur.h)) === 0) {   // once docked it stays docked: no hopping about as you look round
      if (sx !== cur.x) cur.el.style.setProperty('--gx', (cur.x = sx) + 'px');
      if (sy !== cur.y) cur.el.style.setProperty('--gt', (cur.y = sy) + 'px');
    }
    // never over a new tool or a man coming out; and a docked bubble steps aside for any big line it would sit on
    const hush = bigT > 0 || (cur.mode > 0 && (cur.low || (toastT > 0 && cur.dockY + cur.h + 8 > toastY())));
    const state = cur.mode * 2 + (hush ? 1 : 0);
    if (state !== cur.state) cur.el.className = CLS[cur.state = state];
  }
  // Something happened that he has a view on: he says so when he next gets a word in, if it is still news by then.
  function react(ctx, s, pri, shelf = 12, fill = null, wait = 0.7) {
    if (!game.started || !s || !s.voice || !s.voice[ctx]) return;
    if (todo.length >= 4) todo.shift();
    todo.push({ ctx, s, pri, fill, at: game.time + wait, until: game.time + wait + shelf });
  }
  const put = (text, fill) => (fill == null ? text : text.replace(/\{[A-Z]+\}/g, fill));
  function startDuet() {
    if (S.length < 2 || !S.every((s) => able(s) && s.gi.was === 'buried')) return false;
    const lines = line(BOTH, 'duet');
    if (lines) duet = { lines, n: 0 };
    return !!lines;
  }
  // The ordinary chatter, every so often: how the dig is going for him, the crowd, his clock, or the other man.
  function chat(t) {
    let s = nearest();
    if (!s) { idleAt = t + 4; return; }
    if (Math.random() < 0.45) { const o = S[(s.i + 1 + Math.floor(Math.random() * (S.length - 1))) % S.length]; if (o !== s && able(o) && o.d < HEAR) s = o; }
    const st = s.gi.was, left = game.deadlines[s.i] - Date.now(), hot = st === 'buried' && !game.supercharged(s.i) && left < 86400e3;
    const n = game.net?.online ? game.net.count : 0, a = s.f.progress / DONE, idle = t - lastBite, maybe = (k) => Math.random() < k;
    let ctx = maybe(0.5) ? 'idle' : a < 0.1 ? 'early' : a < 0.6 ? 'mid' : 'late';
    if (st === 'lost') ctx = 'won';
    else if (hot && maybe(0.3)) ctx = left < 3600e3 ? 'hour' : 'day';
    else if (maybe(0.12) && startDuet()) return;
    else if (idle > 25 && idle < 150 && maybe(0.4)) ctx = 'rest';
    else if (n >= 2 && maybe(0.2)) ctx = n < 25 ? 'few' : n < 1000 ? 'crowd' : 'horde';
    const text = line(s, ctx) || line(s, 'idle');
    if (text) say(s, put(text, n ? n.toLocaleString() : null)); else idleAt = t + 10;
  }
  function talk(dt) {
    const t = game.time;
    if (toastT > 0) toastT -= dt;
    if (bigT > 0) bigT -= dt;
    if (cur.on) { if ((cur.t -= dt) <= 0) { cur.on = false; gapAt = t + (duet ? 0.5 : 2.5); } else track(); }
    if ((tick += dt) < 0.25) return;
    tick = 0; slowly();
    // His last line, on the way up, once the big news of his going has had the screen to itself. Nobody talks before it.
    if (bye) {
      const s = bye, gone = !s.gi.root.visible;
      if (gone || toastT <= 0) { bye = null; const text = gone ? '' : line(s, 'dug'); if (text) say(s, text); }
      return;
    }
    if (cur.on || t < gapAt || toastT > 0 || (game.over && !game.looking)) return;
    if (duet) {   // the answer from across the building
      const [id, text] = duet.lines[duet.n], s = who[id];
      if (!able(s) || s.gi.was !== 'buried') duet = null;
      else { say(s, text); if (++duet.n >= duet.lines.length) duet = null; }
      return;
    }
    let best = null;
    for (let k = todo.length - 1; k >= 0; k--) if (t > todo[k].until || !able(todo[k].s)) todo.splice(k, 1);
    for (const q of todo) if (t >= q.at && q.s.d < HEAR && (q.pri > 2 || t >= gapAt + 4) && (!best || q.pri > best.pri)) best = q;   // small remarks leave a longer pause
    if (best) { todo.splice(todo.indexOf(best), 1); const text = line(best.s, best.ctx); if (text) say(best.s, put(text, best.fill)); return; }
    if (t >= idleAt) chat(t);
  }

  // ---- what he hears about
  const mine = () => nearest() || S[0];
  bus.on('start', () => { idleAt = game.time + rnd(5, 8); });
  bus.on('toast', (e) => { toastT = e.secs; if (e.pri >= 3) bigT = e.secs; });
  bus.on('bite', () => { lastBite = game.time; });
  bus.on('dig', (e) => flinchAt(e.x, e.z, 0.16 + Math.min(0.2, e.r * 0.03), true));
  bus.on('remoteDig', (e) => { if (e.near) flinchAt(e.x, e.z, 0.1, false); });
  bus.on('milestone', (e) => { const s = who[e.giant?.id]; if (!s || !s.live) return; s.glance = 1.2; shed(s); react('milestone', s, 6); });
  // The lobby lines are generic jokes about lobbies (lunches, donors, being told what to think). Said about AIPAC in
  // particular, "who will tell me what I think" stops being a joke about lobbying and reads as an old slur, so the men
  // say nothing when that nest opens or falls. The author can write lines for it deliberately if he wants them.
  const plain = (e) => !e.quiet && e.mound?.lobby?.id !== 'aipac';
  bus.on('moundOpen', (e) => { if (plain(e)) react('moundOpen', mine(), 5, 12, e.mound.lobby.name); });
  bus.on('moundDown', (e) => { if (plain(e)) react('moundDown', mine(), 5, 12, e.mound.lobby.name); });
  bus.on('toolUp', (e) => { if (!e.quiet && e.tool) react('toolUp', mine(), 5, 14, e.tool.name.toUpperCase()); });
  bus.on('dead', () => { if (ok('dead', 45)) react('dead', mine(), 4, 6); });
  bus.on('agentDown', () => { if (Math.random() < 0.3 && ok('swat', 40)) react('swat', mine(), 2, 5); });
  bus.on('cheer', (e) => { if (e.self && ok('cheer', 40)) react('cheer', mine(), 2, 5); });
  bus.on('called', (e) => { if (ok('called', 20)) react('called', who[e.chamber === 'senate' ? 'chuck' : 'hakeem'] || mine(), 4, 10); });
  bus.on('clock', (e) => { const s = S[e.i]; if (!s) return; s.glance = 1.4; react(e.secs <= 600 ? 'ten' : e.secs <= 3600 ? 'hour' : 'day', s, 7, 20); });
  bus.on('giant', (e) => {
    const s = S[e.i], dug = e.status === 'dug';
    if (!s || (!dug && e.status !== 'lost')) return;   // (a man can also be reopened: nothing to say about that)
    if (cur.on && cur.s === s) drop();
    duet = null;
    if (dug) bye = s; else react('lost', s, 9, 40, null, 1);
    for (const o of S) if (o !== s) react(dug ? 'otherOut' : 'otherIn', o, 8, 60, null, 10);
  });
  if (game.started) idleAt = game.time + rnd(5, 8);

  return {
    update(dt) {
      if (!game.started) return;
      for (const s of S) body(s, dt);
      talk(dt);
    },
    say(i, text) { if (S[i] && text) say(S[i], String(text)); },
    react(i, ctx, fill = null) { react(ctx, S[i], 9, 12, fill); },   // fill: what goes in the line's {N} / {TOOL} / {LOBBY}, if it has one
  };
}
