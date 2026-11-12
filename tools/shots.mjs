// Record the launch-video shots staged by src/plugins/director.js: upright 1080 x 1920 clips, one exact frame at a time.
//   node tools/shots.mjs [--only a,b,c] [--list] [--rh 480] [--fps 30] [--out shots] [--concurrency 2] [--hud on|off|both]
//                        [--seconds N] [--at T] [--guide] [--cards off] [--dpr 3] [--port 8791] [--now ISO] [--query 'mods=..&plugins=..']
// Needs the dev server (npm run dev -- --port 8791) and ffmpeg. Each shot is written as OUT/NAME.mp4 (H.264, yuv420p,
// crf 14, no smoothing anywhere) plus OUT/NAME.jpg (a frame from the middle); one JSON line per shot is printed.
//   --only     comma-separated shot names; a trailing * matches a family (tool-*, mound-*). Default: every shot.
//   --rh       the game's internal picture height: 480 is an exact 4x upscale to 1920, 320 is 6x (chunkier, faster)
//   --hud      on = the phone HUD in every shot, off = none, both = NAME.hud.mp4 and NAME.clean.mp4. Default: each shot's own choice.
//   --seconds  record this long instead of each shot's own length
//   --at T     no video: only NAME.jpg, T seconds in. --at 0,2,4 writes NAME@0.jpg, NAME@2.jpg, NAME@4.jpg (framing checks)
//   --wide     16:9 instead: 1920 x 1080 clips into shots/wide, the subject in the left two thirds (presenter bottom right)
//   --guide    burn in the framing guide (top-60% line, presenter box);  --dpr 1 gives small 360 x 640 pictures for a quick look
// The page's clock is game time: Date, performance.now, timers, Math.random and every CSS animation advance only when
// a frame is stepped, so two runs of a shot give the same frames.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const a = process.argv.slice(2), has = (k) => a.includes('--' + k), opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const FFMPEG = process.env.FFMPEG || 'ffmpeg';   // set FFMPEG to a full path if ffmpeg is not on PATH
// --wide: 1920 x 1080 for a 16:9 cut. The page is a 960 x 540 window drawn at 2x, the game's own picture
// is 360 rows (an exact 3x), and the director slides each shot's subject into the left two thirds (see WIDE there).
const wide = has('wide'), VW = wide ? 960 : 360, VH = wide ? 540 : 640;
const port = opt('port', '8791'), rh = +opt('rh', wide ? 360 : 480), fps = +opt('fps', 30), out = opt('out', wide ? 'shots/wide' : 'shots'), dpr = +opt('dpr', wide ? 2 : 3);
const base = Date.parse(opt('now', '2026-11-12T12:00:00-05:00')), at = has('at') ? opt('at').split(',').map(Number).sort((x, y) => x - y) : null, secsFlag = has('seconds') ? +opt('seconds') : null;
const hudFlag = opt('hud', ''), extra = [has('guide') && 'guide', opt('cards', '') === 'off' && 'card=0', opt('query', '')].filter(Boolean).map((s) => '&' + s).join('');
const url = (shot, hud) => `http://localhost:${port}/?solo&autostart&capture&rh=${rh}&shot=${encodeURIComponent(shot)}${hud ? '&hud=' + hud : ''}${extra}`;

// Runs in the page before anything else: the wall clock becomes game time, and randomness becomes repeatable.
function shim({ base }) {
  const now = () => base + Math.round((window.__game?.time || 0) * 1000), Real = Date;
  window.Date = class extends Real { constructor(...v) { if (v.length) super(...v); else super(now()); } static now() { return now(); } };
  performance.now = () => now() - base;
  let seed = 1; Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  delete Element.prototype.requestPointerLock; delete Document.prototype.exitPointerLock;   // a phone has no mouse to capture
  window.WebSocket = class { addEventListener() {} removeEventListener() {} send() {} close() {} };   // solo needs no socket, and the dev server must not hot-reload a page mid-take
  // once the shot is staged, timers wait for game time too
  const timers = new Map(), seen = new WeakMap(), st = setTimeout, si = setInterval, ct = clearTimeout, ci = clearInterval;
  let vt = 0, frozen = false, id = 1e9, seed0 = 1, frame = 0;
  const add = (fn, ms, every, args) => { timers.set(++id, { at: vt + Math.max(0, +ms || 0), every, fn, args }); return id; };
  window.setTimeout = (fn, ms, ...v) => (frozen && typeof fn === 'function' ? add(fn, ms, 0, v) : st(fn, ms, ...v));
  window.setInterval = (fn, ms, ...v) => (frozen && typeof fn === 'function' ? add(fn, ms, Math.max(1, +ms || 0), v) : si(fn, ms, ...v));
  window.clearTimeout = (i) => { if (!timers.delete(i)) ct(i); };
  window.clearInterval = (i) => { if (!timers.delete(i)) ci(i); };
  window.__capture = {
    start(n) { seed0 = n; frozen = true; },
    // Every frame draws its random numbers from its own seed (shot + frame number), so a download that lands a moment
    // earlier or later between two frames cannot shift the dice for the rest of the take. The director asks again
    // half way through the frame (part 1), so what the scenery rolled does not move what the HUD rolls after it.
    begin(part = 0) { if (!part) frame++; seed = (seed0 + frame * 2654435761 + part * 1013904223) % 2147483646 + 1; Math.random(); Math.random(); },
    // one frame: due timers fire, and every CSS animation and transition moves on by exactly this much
    tick(ms) {
      vt += ms;
      for (const [i, t] of [...timers]) if (t.at <= vt && timers.has(i)) { if (t.every) t.at += t.every; else timers.delete(i); try { t.fn(...t.args); } catch (e) { console.error(e); } }
      for (const an of document.getAnimations()) {
        let t = seen.get(an);
        if (t === undefined) { an.pause(); t = 0; } else t += ms;
        seen.set(an, t);
        const end = an.effect?.getComputedTiming().endTime;
        if (Number.isFinite(end) && t >= end) an.finish(); else an.currentTime = t;
      }
    },
  };
}

const seedOf = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 2147483646; return h + 1; };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });

async function open(shot, hud) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: dpr }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon|status of 404/.test(m.text())) errors.push(m.type() + ': ' + m.text()); });
  await page.addInitScript(shim, { base });
  await page.goto(url(shot, hud), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.ready && window.__game.player?.body && window.__game.plugins.director, null, { timeout: 60000 });
  return { ctx, page, errors };
}

async function record(shot, hud, file) {
  const t0 = Date.now(), res = { shot };
  let ctx, ff;
  try {
    const o = await open(shot, hud); ctx = o.ctx;
    const { page, errors } = o, cdp = await ctx.newCDPSession(page);
    const meta = await page.evaluate((seed) => { window.__capture.start(seed); return window.__game.plugins.director.stage(); }, seedOf(shot));
    if (meta.skip) return { ...res, skipped: meta.skip };
    if (meta.error) throw new Error(meta.error);
    const secs = secsFlag ?? meta.secs, frames = Math.max(1, Math.round(secs * fps)), mid = Math.floor(frames / 2);
    // the clip's scale is what makes the frame device pixels (1080 x 1920) instead of CSS pixels: the page is drawn again at that size, nothing is stretched
    const clip = { x: 0, y: 0, width: VW, height: VH, scale: dpr }, grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip })).data, 'base64');
    const stepTo = (n) => page.evaluate(async ({ n, dt }) => { const err = await window.__game.plugins.director.run(n, dt); if (err) throw new Error(err); }, { n, dt: 1 / fps });
    const poster = async (tag = '') => { const jpg = join(out, file + tag + '.jpg'); await page.screenshot({ path: jpg, type: 'jpeg', quality: 92 }); res.poster = jpg; };
    if (at) {
      let done = 0;
      for (const t of at) { const n = Math.round(t * fps) + 1; await stepTo(n - done); done = n; await poster(at.length > 1 ? '@' + t : ''); }
      return { ...res, at, hud: meta.hud, ms: Date.now() - t0, errors };
    }
    ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14',
      '-pix_fmt', 'yuv420p', '-sws_flags', 'neighbor', '-movflags', '+faststart', join(out, file + '.mp4')], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = ''; ff.stderr.on('data', (d) => { ffErr += d; });
    const done = new Promise((ok, no) => { ff.on('close', (code) => (code ? no(new Error('ffmpeg: ' + ffErr.trim())) : ok())); ff.on('error', no); ff.stdin.on('error', () => {}); });
    for (let i = 0; i < frames; i++) {
      await stepTo(1);
      const png = await grab();
      if (!i) res.size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;   // what really went into the file
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i === mid) await poster();
    }
    ff.stdin.end(); await done;
    return { ...res, file: join(out, file + '.mp4'), frames, secs: +(frames / fps).toFixed(2), hud: meta.hud, ms: Date.now() - t0, errors };
  } catch (e) {
    if (ff) { ff.stdin.destroy(); ff.kill(); }
    return { ...res, error: String(e?.message || e).split('\n')[0] };
  } finally { await ctx?.close().catch(() => {}); }
}

let all;
{ const o = await open('', ''); all = await o.page.evaluate(() => window.__game.plugins.director.shots); await o.ctx.close(); }
if (has('list')) { for (const s of all) console.log(JSON.stringify(s)); await browser.close(); process.exit(0); }
const only = opt('only', ''), pats = only ? only.split(',') : null;
const names = all.map((s) => s.name).filter((n) => !pats || pats.some((p) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : p === n)));
for (const p of pats || []) if (!names.some((n) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : p === n))) console.log(JSON.stringify({ shot: p, error: 'no such shot' }));
const jobs = names.flatMap((n) => (hudFlag === 'both' ? [[n, 'full', n + '.hud'], [n, 'clean', n + '.clean']] : [[n, { on: 'full', off: 'clean' }[hudFlag] || '', n]]));
mkdirSync(out, { recursive: true });
let failed = 0;
await Promise.all(Array.from({ length: Math.max(1, Math.min(8, +opt('concurrency', 2))) }, async () => {
  for (let job; (job = jobs.shift());) { const r = await record(...job); if (r.error) failed++; console.log(JSON.stringify(r)); }
}));
await browser.close();
process.exit(failed ? 1 : 0);
