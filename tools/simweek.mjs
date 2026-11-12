// A pretend crowd digging for days, in fast-forward, with no server: the same pacing sums as worker/world.js, run on
// plain numbers. Use it to see how fast the piles fall with different turnouts and settings.
//
//   node tools/simweek.mjs                      three ready-made turnouts: quiet, moderate, viral
//   node tools/simweek.mjs --avg 40 --trend launch --days 7
//   node tools/simweek.mjs --scenario viral --burst 10 --lead 0.05 --boost 1.4
//
// Turnout:  --avg N       average people online at once        --trend flat | launch | viral
//           --return 0.5  chance an arrival is someone coming back (they keep their tool)
//           --session 8   typical session length in minutes    --duty 0.6  share of a session spent actually digging
// Pacing:   --burst --lead --boost --finishBy --floor --max --min   (defaults are the game's own, from shared/config.js)
//           --bombAt 0.05 --bombGap 1800 --bombTo 0.01   dirt bombs (see CFG.bomb; --bombAt 0 = none)
//           --target N   how many shovels' worth of digging, around the clock, a pile needs to finish on time (0 = no limit)
// Other:    --days N (default: until the last deadline)   --progress 0.003,0   how far out each man is at the start
//           --start 2026-11-11T12:00:00Z   --seed 1   --every 1 (days between report rows)
import { CFG, tierFor, digMul } from '../shared/config.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? '1' : process.argv[++i]; }
const num = (k, d) => (args[k] !== undefined && Number.isFinite(Number(args[k])) ? Number(args[k]) : d);
const P = CFG.pace, D = CFG.dirt, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SCENARIOS = { quiet: { avg: 2, trend: 'flat' }, moderate: { avg: 25, trend: 'launch' }, viral: { avg: 150, trend: 'viral' } };
const STEP = 60;   // seconds of game time per step
const TOTAL = 27300;   // cubic metres in one pile (both are the same shape); 97% of it is what has to go

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function run(name, o) {
  const rand = rng(num('seed', 1)), gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const poisson = (m) => { if (m > 30) return Math.max(0, Math.round(m + Math.sqrt(m) * gauss())); let k = 0, p = Math.exp(-m), s = p; const u = rand(); while (u > s) { k++; p *= m / k; s += p; } return k; };
  const c = { bombAt: num('bombAt', CFG.bomb.at), bombGap: num('bombGap', CFG.bomb.gapSec), bombTo: num('bombTo', CFG.bomb.to), burst: num('burst', P.burst), lead: num('lead', P.lead), boost: num('boost', P.boost), finishBy: num('finishBy', P.finishBy), floor: num('floor', P.floor), target: num('target', P.target), min: num('min', P.min), max: num('max', P.max) };
  const pm = [c.min, c.max, c.boost], duty = num('duty', 0.6), back = num('return', 0.5), median = num('session', 8) * 60, sigma = 1;
  const meanSession = median * Math.exp(sigma * sigma / 2), cap = CFG.net.maxPlayers || 1e9;
  const start = args.start ? Date.parse(args.start) : Date.now(), prog0 = (args.progress || '0.0032,0').split(',').map(Number);
  const piles = CFG.giants.map((g, i) => { const whole = TOTAL * D.doneAt, base = clamp((prog0[i] || 0) / D.doneAt, 0, 1); return { name: g.name, deadline: Date.parse(g.deadline), whole, rem: whole * (1 - base), base, result: null, mulSum: 0, n: 0, bombs: 0 }; });
  const end = start + num('days', Math.ceil((Math.max(...piles.map((p) => p.deadline)) - start) / 86400e3)) * 86400e3, every = num('every', 1);
  // how busy it is: a daily wave that peaks at 9pm Eastern, times a trend over the days
  const turnout = (t) => {
    const hourET = ((t / 3600e3 - 5) % 24 + 24) % 24, day = (t - start) / 86400e3;
    const daily = 1 + 0.75 * Math.cos(2 * Math.PI * (hourET - 21) / 24);
    const trend = o.trend === 'launch' ? 0.6 + 2.4 * Math.exp(-day / 1.5) : o.trend === 'viral' ? 0.3 + (day > 3 ? 12 * Math.pow(0.5, day - 3) : 0) : 1;
    return Math.min(cap, o.avg * daily * trend);
  };
  const need = (p, t) => { const finishAt = p.deadline - (1 - c.finishBy) * (p.deadline - start); return p.rem / Math.max(P.tuneSec, (finishAt - t) / 1000); };
  const ahead = (p, t) => { const finishAt = p.deadline - (1 - c.finishBy) * (p.deadline - start); return (1 - p.rem / p.whole) - (p.base + (1 - p.base) * clamp((t - start) / Math.max(1, finishAt - start), 0, 1)); };
  const plan = (p) => p.whole * (1 - p.base) / ((p.deadline - (1 - c.finishBy) * (p.deadline - start) - start) / 1000);   // the steady speed the schedule was drawn at
  const speed = (p, t) => need(p, t) * Math.max(c.floor, c.burst * clamp(2 * (1 - ahead(p, t) / c.lead), 0, 1));
  const full = CFG.tools.map((tl) => Math.PI * tl.r * tl.r * tl.depth / 2 / tl.period);   // cubic metres a second at full strength

  const known = [], here = [];   // everyone who has ever played (their total dug), and who is on right now
  let lastBomb = -Infinity, sumOn = 0, peakOn = 0, steps = 0, nextRow = start + every * 86400e3;
  console.log(`\n=== ${name}: about ${o.avg} online on average, ${o.trend} trend | target ${c.target}, burst ${c.burst}, lead ${c.lead}, boost ${c.boost}, finishBy ${c.finishBy} ===`);
  console.log('day  date        online avg/peak   ' + piles.map((p) => `${p.name.padEnd(7)} dug   vs schedule  lone shovel bite`).join('   '));
  for (let t = start; t < end; t += STEP * 1000) {
    const open = piles.filter((p) => !p.result);
    for (const p of open) if (t >= p.deadline) { p.result = `TOO LATE with ${(Math.floor(1000 * (1 - p.rem / p.whole)) / 10).toFixed(1)}% dug`; }
    const live = piles.filter((p) => !p.result);
    // people leave, people arrive
    for (let i = here.length - 1; i >= 0; i--) if (t >= here[i].until || !live.length) here.splice(i, 1);
    if (live.length) for (let k = poisson(turnout(t) / meanSession * STEP); k > 0 && here.length < cap; k--) {
      let who;
      if (known.length && rand() < back) { who = known[Math.floor(rand() * known.length)]; if (who.on) continue; } else { who = { dug: 0, on: false }; known.push(who); }
      here.push({ who, until: t + median * Math.exp(sigma * gauss()) * 1000, pile: live[Math.floor(rand() * live.length)] });
    }
    for (const h of here) { h.who.on = true; if (h.pile.result) h.pile = live[Math.floor(rand() * live.length)] || h.pile; }
    // one step of digging on each pile: the allowed speed, shared between the people on it, times each one's tool
    for (const p of live) {
      const on = here.filter((h) => h.pile === p), q = Math.min(speed(p, t) / Math.max(1, on.length * duty), c.target > 0 ? plan(p) / c.target : Infinity);
      p.mulSum += digMul(q, 0, pm); p.n++;
      let out = 0;
      for (const h of on) { const tier = tierFor(h.who.dug); out += duty * digMul(q, tier, pm) * full[tier] * STEP; h.who.dug += duty * full[tier] * STEP; }
      p.rem = Math.max(0, p.rem - out);
      // a dirt bomb: the lobbies fill it back to CFG.bomb.to ahead (never more than CFG.bomb.most of it at once)
      if (c.bombAt > 0 && on.length && t - lastBomb >= c.bombGap * 1000 && ahead(p, t) > c.bombAt) { p.rem = Math.min(p.whole, p.rem + Math.min(CFG.bomb.most, ahead(p, t) - c.bombTo) * p.whole); p.bombs++; lastBomb = t; }
      if (p.rem <= 0.5) p.result = `DUG OUT on day ${((t - start) / 86400e3).toFixed(1)}, ${((p.deadline - t) / 86400e3).toFixed(1)} days early`;
    }
    for (const h of here) h.who.on = false;
    sumOn += here.length; peakOn = Math.max(peakOn, here.length); steps++;
    if (t + STEP * 1000 >= nextRow || t + STEP * 1000 >= end) {
      const day = Math.round((t - start) / 86400e3);
      console.log(`${String(day).padStart(3)}  ${new Date(t).toISOString().slice(0, 10)}  ${(sumOn / steps).toFixed(1).padStart(7)} /${String(peakOn).padStart(5)}   ` + piles.map((p) => {
        const dug = `${(100 * (1 - p.rem / p.whole)).toFixed(2)}%`.padStart(11);
        if (p.result && !p.n) return `${dug}   ${p.result.split(' ').slice(0, 2).join(' ').padEnd(28)}`;
        const a = ahead(p, t) * 100, m = p.n ? p.mulSum / p.n : 0;
        const row = `${dug}   ${(Math.abs(a).toFixed(2) + (a < 0 ? '% behind' : '% ahead')).padEnd(13)} x${m.toPrecision(2).padEnd(13)}`;
        p.mulSum = p.n = 0; return row;
      }).join('   '));
      sumOn = peakOn = steps = 0; nextRow += every * 86400e3;
    }
  }
  const tiers = known.map((k) => tierFor(k.dug)).sort((a, b) => a - b);
  for (const p of piles) console.log(`${p.name}: ${p.result || `still going at ${(100 * (1 - p.rem / p.whole)).toFixed(1)}% dug`}; ${p.bombs} dirt bomb${p.bombs === 1 ? '' : 's'}`);
  console.log(`${known.length} different people played; typical tool reached: ${CFG.tools[tiers[tiers.length >> 1] || 0].name}; best: ${CFG.tools[tiers[tiers.length - 1] || 0].name}`);
}

if (args.avg || args.trend) run('custom', { avg: num('avg', 10), trend: args.trend || 'flat' });
else for (const [name, o] of Object.entries(SCENARIOS)) if (!args.scenario || args.scenario === name) run(name, o);
