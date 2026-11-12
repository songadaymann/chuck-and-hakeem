// Simulated players against a running server.
//   node tools/loadtest.mjs [players] [seconds] [ws://host] [--storm] [--nodig] [--calls] [--nokey]
// --storm  after the run, hang up every bot at once, redial them all 2 s later (retrying with a browser's back-off)
//          and report how many were turned away and how long it took until everyone was back in
// --nodig  positions only: for a run against the live game, where digging would move the real piles and mounds
// --calls  also log phone calls to Congress. Always on against localhost; elsewhere they would add to the real count
// --nokey  do not send the admin key. By default the key in .dev.vars goes along as a header (never in the URL), so
//          the server lets one machine past its per-network cap. It is only ever sent to localhost or over wss.
import WebSocket from 'ws';
import fs from 'fs';
import { CFG, moundSpots } from '../shared/config.js';

const args = process.argv.slice(2), flag = (k) => args.includes('--' + k), pos = args.filter((a) => !a.startsWith('--'));
const N = Number(pos[0] || 200), SECS = Number(pos[1] || 20), BASE = pos[2] || 'ws://localhost:8787';
const http = BASE.replace(/^ws/, 'http'), LOCAL = /^ws:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
const DIG = !flag('nodig'), CALLS = DIG && (LOCAL || flag('calls')), MOUNDS = moundSpots(), WARM = CFG.tools[1].need;
let KEY = '';
if (!flag('nokey') && (LOCAL || BASE.startsWith('wss:'))) try { KEY = fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/ADMIN_KEY=(.*)/)[1].trim().replace(/^"|"$/g, ''); } catch (e) { /* no key: the cap applies */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => (a.length ? Math.round([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]) : null);
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const status = async () => (await fetch(http + '/api/status')).json();
const stat = { open: 0, errors: 0, hi: 0, posMsgs: 0, cellFrames: 0, cellBytes: 0, credits: 0, sent: 0, rooms: new Set(), maxSeen: 0,
  codes: {}, dialToHi: [], openToHi: [], pings: 0, pongs: 0, wideFlags: 0, tierNews: 0, warmAsked: 0, warmGiven: 0, callsSent: 0 };
const bots = [];
const before = await status();

// Open (or reopen) a bot's connection. b.onhi / b.onclose let the storm watch what becomes of it.
function dial(b) {
  const q = new URLSearchParams({ name: 'Tired Voter 42', char: 'Male_Adult_01' });
  if (b.code) q.set('code', b.code); else if (b.warm) { q.set('warm', String(b.warm)); stat.warmAsked++; }
  const ws = b.ws = new WebSocket(`${BASE}/ws?${q}`, KEY ? { headers: { authorization: 'Bearer ' + KEY } } : undefined), dialAt = performance.now();
  let openAt = 0;
  b.hangup = false; b.in = false;
  ws.binaryType = 'arraybuffer';
  ws.on('open', () => { stat.open++; openAt = performance.now(); });
  ws.on('error', () => { stat.errors++; });
  ws.on('close', (code) => { if (b.ws !== ws) return; b.in = false; if (!b.hangup) bump(stat.codes, code); b.onclose?.(code); });
  ws.on('message', (data, isBinary) => {
    if (isBinary) { stat.cellFrames++; stat.cellBytes += data.byteLength; if (new Uint16Array(data.slice(0, 2))[0] === 1) b.snap++; return; }
    const text = data.toString();
    if (text === '!') { stat.pongs++; return; }
    const m = JSON.parse(text);
    if (m.t === 'hi') {
      const now = performance.now();
      stat.hi++; stat.dialToHi.push(now - dialAt); stat.openToHi.push(now - openAt);
      if (!b.code && b.warm && m.dug === WARM) stat.warmGiven++;
      b.in = true; b.code = m.code; b.dug = m.dug; b.known = m.known; b.hp = m.mounds; b.world = m;
      stat.rooms.add(m.room);
      for (const p of m.players) b.seen.add(p[0]);
      b.onhi?.();
    } else if (m.t === 'p') { stat.posMsgs++; for (const p of m.ps) { if (p[4] > 15) stat.wideFlags++; if (p[5] > 0) stat.tierNews++; } }
    else if (m.t === 'j') b.seen.add(m.p[0]);
    else if (m.t === 'c') { stat.credits++; b.dug = m.dug; }
    else if (m.t === 'w') { b.hp = m.mounds; b.world = m; }
    stat.maxSeen = Math.max(stat.maxSeen, b.seen.size);
  });
}

// One in twenty batters an open lobby mound instead of the pile, one in ten arrives with a warm-up to keep (it asks for
// more than the first tool costs and should be given exactly that much, so it shows up holding a pickaxe), one in
// twenty-five logs phone calls (eight, of which the server should accept six), and everyone asks '?' every five seconds.
function bot(i, code) {
  const b = { i, code, dug: 0, seen: new Set(), x: -50 + (Math.random() - 0.5) * 30, z: 30 + Math.random() * 10, snap: 0, n: 0, calls: 0,
    warm: !code && i % 10 === 3 ? WARM + 150 : 0, hitter: DIG && i % 20 === 7, caller: CALLS && i % 25 === 4 };
  dial(b);
  b.t = setInterval(() => {
    const ws = b.ws;
    if (ws.readyState !== 1 || !b.in) return;
    if (++b.n % 10 === 0) { ws.send('?'); stat.pings++; }
    const mi = b.hitter && b.hp ? b.hp.findIndex((h) => h > 0) : -1, m = {};
    if (mi >= 0) { b.x = MOUNDS[mi].x + 3; b.z = MOUNDS[mi].z + 3; m.h = [mi]; b.hits = (b.hits || 0) + 1; }
    else { b.x += (Math.random() - 0.5) * 2; b.z += (Math.random() - 0.5) * 2; if (DIG) m.d = [[+b.x.toFixed(2), +(b.z - 1.2).toFixed(2), 1]]; }
    // all eight bits of the flags byte: moving and digging, a lobby effect (bits 4-6) on some, a cheer (bit 7) now and then
    m.p = [+b.x.toFixed(1), +b.z.toFixed(1), 3.1, 3 | (i % 4 === 0 ? ((i % 6) + 1) << 4 : 0) | (b.n % 16 === 0 ? 128 : 0)];
    if (b.caller && b.calls < 8 && b.n % 2 === 0) { m.c = 1; b.calls++; stat.callsSent++; }
    ws.send(JSON.stringify(m));
    stat.sent++;
  }, 500);
  return b;
}

const t0 = Date.now();
for (let i = 0; i < N; i++) { bots.push(bot(i)); if (i % 25 === 24) await sleep(100); }
await sleep(SECS * 1000);
const mid = await status();
const run = { dialToHi: [...stat.dialToHi], openToHi: [...stat.openToHi], sent: stat.sent, codes: { ...stat.codes }, hi: stat.hi, open: stat.open, errors: stat.errors };

// The storm: what a deploy or a hiccup does. Everyone is cut off in the same instant and knocks again together.
let storm = null;
if (flag('storm')) {
  const refused = {}, times = [];
  let back = 0;
  for (const b of bots) { b.hangup = true; b.ws.close(); }
  await sleep(2000);
  const at = performance.now();
  await new Promise((done) => {
    const giveUp = setTimeout(done, 120000);
    for (const b of bots) {
      let wait = 2;
      const knock = () => {
        b.onhi = () => { b.onhi = b.onclose = null; times.push(performance.now() - at); if (++back === bots.length) { clearTimeout(giveUp); done(); } };
        b.onclose = (code) => { bump(refused, code); setTimeout(knock, wait * (0.5 + Math.random()) * 1000); wait = Math.min(60, wait * 2); };
        dial(b);
      };
      knock();
    }
  });
  for (const b of bots) b.onhi = b.onclose = null;
  await sleep(1500);
  const after = await status();
  storm = { bots: bots.length, backIn: back, neverBack: bots.length - back, turnedAway: refused, turnedAwayTotal: Object.values(refused).reduce((s, n) => s + n, 0),
    msUntilAllBack: back === bots.length ? Math.round(Math.max(...times)) : null, msMedian: pct(times, 0.5), ms95th: pct(times, 0.95), serverOnline: after.online, serverRooms: after.rooms };
}

// someone who joins late must receive the pile as it is now, and a returning code must get its progress back
const digger = bots.find((b) => b.dug > 0 && b.in) || bots[0];
digger.hangup = true; digger.ws.close();
await sleep(1500);
const back = bot(-1, digger.code);
await sleep(4500);   // /api/status is answered from memory for five seconds: wait it out so the last reading is a fresh one
const end = await status(), hitters = bots.filter((b) => b.hits > 0), callers = bots.filter((b) => b.caller);
const report = {
  players: N, seconds: SECS, opened: run.open, welcomed: run.hi, errors: run.errors, closeCodes: run.codes,
  msDialToWelcome: { median: pct(run.dialToHi, 0.5), p95: pct(run.dialToHi, 0.95), max: pct(run.dialToHi, 1) }, msOpenToWelcome: { median: pct(run.openToHi, 0.5), p95: pct(run.openToHi, 0.95) },
  rooms: [...stat.rooms].sort(), mostOthersSeenByOneBot: stat.maxSeen,
  sentPerSec: Math.round(run.sent / SECS), positionBroadcastsReceived: stat.posMsgs, cellFramesReceived: stat.cellFrames, cellKBPerBotPerSec: +(stat.cellBytes / 1024 / N / SECS).toFixed(2),
  botsCredited: bots.filter((b) => b.dug > 0).length, totalCredited: Math.round(bots.reduce((s, b) => s + b.dug, 0)),
  progressBefore: before.giants.map((g) => g.progress), progressAfter: mid.giants.map((g) => g.progress), serverOnline: mid.online, serverRooms: mid.rooms,
  // the new paths: '?' answered '!', all eight flag bits relayed, a newcomer's warm-up kept, mound hits paid, calls counted (six an hour each at most)
  pings: { sent: stat.pings, answered: stat.pongs }, relayedWithHighFlagBits: stat.wideFlags, relayedWithATool: stat.tierNews,
  warmUps: { asked: stat.warmAsked, given: stat.warmGiven },
  mounds: { botsHitting: hitters.length, ofThemCredited: hitters.filter((b) => b.dug > 0).length, openBefore: before.moundsOpen, openAfter: end.moundsOpen },
  calls: { bots: callers.length, sent: stat.callsSent, shouldCount: callers.reduce((s, b) => s + Math.min(6, b.calls), 0), countedByServer: (end.calls ?? 0) - (before.calls ?? 0) },
  everDugBefore: before.tot, everDugAfter: end.tot, diggingEachPile: mid.dg,
  storm,
  returning: { code: digger.code, dugWhenLeft: digger.dug, dugOnReturn: back.dug, recognised: back.known, snapshotsOnJoin: back.snap },
  wallSeconds: +((Date.now() - t0) / 1000).toFixed(1),
};
console.log(JSON.stringify(report, null, 1));
process.exit(0);
