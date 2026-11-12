// All tunable numbers live here. Distances in metres, +Y up, the Capitol's front faces +Z (the Mall).
// Shared by the browser (src/) and the server (worker/).
export const CFG = {
  worldRadius: 330,
  spawn: { x: 0, z: 95 },
  capitol: { halfX: 70, halfZ: 22, centerHalfX: 30, wingRoof: 21, centerRoof: 25,
             terraceHalfX: 74, terraceHalfZ: 26, terraceH: 3, berm: 6, stairsHalfX: 15, stairsZ1: 40,
             notchHalfX: 13, notchBackZ: -3 },
  giants: [
    // Each man has his own clock. Chuck: Senate Democrats' closed-door leadership vote, reported for "early December" 2026 with no date announced yet:
    // Dec 1, noon ET, stands in until one is (change it here, or live in /admin.html).
    // Hakeem: the House Democratic Caucus leadership vote (Nov 18 2026; time of day not confirmed, 9am ET assumed).
    { id: 'chuck', name: 'CHUCK', title: 'Senate side', x: -50, z: 10, deadline: '2026-12-01T12:00:00-05:00', until: 'until Senate Democrats vote' },
    { id: 'hakeem', name: 'HAKEEM', title: 'House side', x: 50, z: 10, deadline: '2026-11-18T09:00:00-05:00', until: 'until House Democrats vote' },
  ],
  giant: { baseY: 3, height: 36, shoulderY: 24, torsoRX: 11, torsoRZ: 4.5, headR: 4.5 },
  dirt: { size: 64, cells: 48, peak: 31, radius: 30, doneAt: 0.97 },
  // The Capitol Reflecting Pool, in front of the west lawn.
  pool: { x: 0, z: 150, halfX: 35, halfZ: 23 },
  // need = cubic metres you personally must dig to unlock. period = seconds per dig cycle, bite = when in the cycle dirt comes out.
  // `need` is the full-strength cubic metres you must have dug to earn each tool. Paced for solid digging: the first
  // upgrade inside a minute and a half (most visitors stay a few minutes and should see one), the jackhammer by five,
  // a vehicle in about half an hour, the top machine after about eleven hours. Every step earns more per second than the last.
  tools: [
    { id: 'shovel', name: 'Shovel', kind: 'hand', clip: 'dig', need: 0, r: 1.6, depth: 0.5, period: 1.6, bite: 0.35, reach: 1.2, speed: 6, dmg: 1, cam: 6 },
    { id: 'pickaxe', name: 'Pickaxe', kind: 'hand', clip: 'swing', need: 100, r: 1.9, depth: 0.7, period: 1.2, bite: 0.7, reach: 1.3, speed: 6, dmg: 2, cam: 6 },
    { id: 'jackhammer', name: 'Jackhammer', kind: 'hand', clip: 'jackhammer', need: 700, r: 1.6, depth: 0.42, period: 0.4, bite: 0.5, reach: 0.8, speed: 6, dmg: 1, cam: 6 },
    { id: 'trencher', name: 'Trencher', kind: 'hand', clip: 'push', need: 2400, r: 1.8, depth: 0.45, period: 0.35, bite: 0.5, reach: 1.6, speed: 5, dmg: 2, cam: 7, moveDig: true },
    { id: 'skid_steer', name: 'Skid Steer', kind: 'vehicle', need: 9000, r: 3, depth: 1.9, period: 2.5, bite: 0.15, reach: 2.6, speed: 9, dmg: 6, cam: 11, turn: 2.4 },
    { id: 'backhoe_loader', name: 'Backhoe', kind: 'vehicle', need: 31000, r: 3.6, depth: 2, period: 3.1, bite: 0.3, reach: -5.5, speed: 8, dmg: 10, cam: 15, turn: 2 },
    { id: 'excavator', name: 'Excavator', kind: 'vehicle', need: 78000, r: 4.5, depth: 2.5, period: 3.75, bite: 0.2, reach: 7, speed: 6, dmg: 16, cam: 19, turn: 1.6 },
    { id: 'bulldozer', name: 'Bulldozer', kind: 'vehicle', need: 190000, r: 6, depth: 1.6, period: 2.7, bite: 0.25, reach: 4, speed: 6, dmg: 25, cam: 17, turn: 1.6, moveDig: true },
    { id: 'mining_shovel', name: 'Mining Shovel', kind: 'vehicle', need: 490000, r: 8, depth: 3.5, period: 4.4, bite: 0.3, reach: 11, speed: 5, dmg: 50, cam: 36, turn: 1.2 },
    { id: 'bucket_wheel_excavator', name: 'Bucket-Wheel Excavator', kind: 'vehicle', need: 1600000, r: 10, depth: 1.0, period: 0.5, bite: 0.5, reach: 36, speed: 4, dmg: 40, cam: 85, turn: 0.8, moveDig: true, loopClip: true },
  ],
  // shuffle = how fast you can edge sideways while digging with a hand tool (share of walking speed); grace = seconds nothing can hit you after a respawn
  player: { hp: 100, runMul: 1.5, regenDelay: 3, regen: 4, respawn: 3, shuffle: 0.4, grace: 4 },
  // How digging looks. The shared pile is paced to last until the vote, so one bite takes a sliver off it; the rest of
  // the bite is a dent only your browser draws, which slumps back over `slump` seconds. dentMax = deepest it gets (m).
  feel: { dentMax: 3, slump: 18, slumpAfter: 2.5, fresh: 0.62 },
  // Each lobby: mounds dotted around the grounds, lobbyists with their own attack.
  lobbies: [
    { id: 'aipac', name: 'AIPAC', color: '#3a6fd8', shot: 'TALKING POINT', effect: 'hasbara', secs: 5 },
    { id: 'insurance', name: 'HEALTH INSURANCE', color: '#2a9d5c', shot: 'DEDUCTIBLE', effect: 'deductible', secs: 0 },
    { id: 'pharma', name: 'BIG PHARMA', color: '#c0398f', shot: 'PRICE HIKE', effect: 'pricehike', secs: 5 },
    { id: 'oil', name: 'BIG OIL', color: '#222222', shot: 'OIL', effect: 'slick', secs: 5 },
    { id: 'wallst', name: 'WALL STREET', color: '#8a6d1c', shot: 'BUYOUT', effect: 'buyout', secs: 8 },
    { id: 'tech', name: 'BIG TECH', color: '#d9541e', shot: 'TERMS', effect: 'tos', secs: 4 },
  ],
  // Mounds stay shut until the dig alarms that lobby: one opens at firstAt of the combined progress, then one more
  // every openEvery, at most maxOpen at a time. moundHp is in tool damage: each hit counts hitMul times, shared out once more than perMound people are online.
  // stand = how close a lobbyist walks before stopping: inside meleeR, so holding DIG swats them. They throw once on the way in (range).
  // tosEvery = at most one terms-of-service pop-up per this many seconds. quietSec = the lobbies never stay away longer than this:
  // with nothing open for that long (and somebody digging), the next mound opens whatever the progress.
  lobby: { moundsEach: 3, moundHp: 300, spawnEvery: 20, maxPerMound: 3, lobbyistHp: 2, speed: 3.2, range: 14, stand: 2.8, cooldown: 4, shotSpeed: 13, dmg: 4, deductibleDigs: 2, tosEvery: 20, quietSec: 180,
           firstAt: 0.001, openEvery: 0.01, maxOpen: 2, meleeR: 3.4, whack: 0.38, hitMul: 4, perMound: 6 },
  // Pacing. Every dig is multiplied by a rate the server keeps re-tuning so each pile falls at the speed needed to
  // finish just before its deadline, given how much digging has been arriving lately (averaged over tau seconds).
  // burst = how many times faster than that the pile may go while people are actually playing; min/max bound the rate.
  // All of these can be changed live from /admin.html. superRate applies when a man is marked "out in real life".
  pace: { min: 1e-7, max: 4, burst: 4, target: 3, lead: 0.06, floor: 0.1, boost: 1.28, finishBy: 0.97, tuneSec: 5, superRate: 25, solo: 1 },
  // Dirt bombs: the lobbies' answer to a crowd that is winning too easily. Once a pile is more than `at` of itself ahead
  // of schedule, the next lobby in line airdrops a sack of dirt on it, filling it back to `to` ahead (never more than
  // `most` of the pile in one go). Everything stops for it: from the warning to `stormSec` later nobody can dig.
  // gapSec = the least time between two bombs, anywhere. `at` can be changed live from /admin.html (0 = no bombs).
  bomb: { at: 0.05, to: 0, most: 0.05, gapSec: 14400, warnSec: 7, stormSec: 13 },
  // Shared-world server settings (see worker/). Costs scale with rooms kept awake and messages sent, so both are capped here.
  net: { roomSize: 80, maxPlayers: 4000, perIp: 40, sendMs: 500, syncMs: 1000, shown: 24, shownTouch: 12, saveEverySec: 60, idleKickSec: 300 },
  // Names are built from these lists, never typed, so there is nothing to moderate.
  nameA: ['Fed-Up', 'Tired', 'Hopeful', 'Stubborn', 'Sleepy', 'Furious', 'Polite', 'Loud', 'Patient', 'Caffeinated', 'Unbought', 'Determined', 'Muddy', 'Restless', 'Local', 'Ordinary'],
  nameB: ['Voter', 'Digger', 'Constituent', 'Taxpayer', 'Neighbor', 'Citizen', 'Volunteer', 'Canvasser', 'Shoveler', 'Organizer', 'Renter', 'Nurse', 'Teacher', 'Retiree', 'Barista', 'Commuter'],
  people: ['Male_Adult_01', 'Female_Adult_01', 'Male_Adult_10', 'Female_Adult_04', 'Construction_Male_01', 'Female_Adult_09', 'Male_Adult_05',
    'Chef_Female_01', 'Male_Adult_02', 'Female_Adult_12', 'Delivery_Male_01', 'Medical_Female_01', 'Male_Adult_08', 'Female_Adult_02',
    'Gardener_Male_01', 'Female_Adult_15', 'Male_Adult_12', 'Construction_Female_01', 'Medical_Male_02', 'Female_Adult_06', 'Male_Adult_03',
    'Male_Adult_15', 'Female_Child_01', 'Male_Child_01'],
  suits: ['Business_Male_01', 'Business_Female_02', 'Business_Male_02', 'Business_Female_01', 'Business_Male_03', 'Business_Female_03', 'Business_Male_05'],
};

// Where each lobby mound sits, in the order they open: on the lawns round the Capitol, 60 to 150 m from a pile, kept
// off the streets, walks, pool and dig sites (src/scenery/plan.js). They alternate between the House (+x) and Senate
// (-x) sides so whichever pile you are on, one opens near you. Lobby i % 6 owns mound i.
const SPOTS = [[118, 30], [-62, 84], [150, 78], [-118, 30], [62, 84], [-150, 78], [-84, 152], [84, 152], [-165, -40],
  [165, -40], [-120, -95], [120, -95], [170, 150], [-170, 150], [132, 52], [-132, 52], [64, -84], [-64, -84]];
export function moundSpots() { return SPOTS.map(([x, z], i) => ({ i, lobby: CFG.lobbies[i % CFG.lobbies.length], x, z })); }
// How many mounds should have opened by the time this much of the two piles (0..1, averaged) is gone.
export const wavesWanted = (p) => (p < CFG.lobby.firstAt ? 0 : 1 + Math.floor((p - CFG.lobby.firstAt) / CFG.lobby.openEvery));
export const tierFor = (dug) => { let t = 0; while (t + 1 < CFG.tools.length && dug >= CFG.tools[t + 1].need) t++; return t; };
export const randomName = () => `${CFG.nameA[Math.floor(Math.random() * CFG.nameA.length)]} ${CFG.nameB[Math.floor(Math.random() * CFG.nameB.length)]} ${10 + Math.floor(Math.random() * 90)}`;
export const validName = (n) => { const m = /^(\S+) (\S+) (\d\d)$/.exec(n || ''); return !!m && CFG.nameA.includes(m[1]) && CFG.nameB.includes(m[2]); };
// Progress codes: 12 characters, no I, L, O, 0 or 1, so they are easy to read back and type.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const validCode = (c) => typeof c === 'string' && c.length === 12 && [...c].every((ch) => CODE_ALPHABET.includes(ch));

// How deep one bite of this tool goes, as a multiple of the tool's normal depth, when one digger-second is worth
// `q` cubic metres of real dirt. Each tool up the ladder is worth `boost` times the one before, so a better tool
// always moves more of the real pile, whatever its size on screen.
export const toolShare = (tier, boost) => { const t = CFG.tools[tier]; return t.period * boost ** tier / (Math.PI * t.r * t.r * t.depth / 2); };
export const digMul = (q, tier, [min, max, boost]) => Math.max(min, Math.min(max, q * toolShare(tier, boost)));
