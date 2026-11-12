// Headless screenshot of the running game, for checking a change by eye.
//   node tools/snap.mjs out.png [--url '/?solo&autostart'] [--w 960 --h 540] [--dpr 1] [--wait 2500]
//                               [--cam 'x,y,z,lookX,lookY,lookZ'] [--eval 'js run in the page first'] [--steps 60] [--hold 800] [--port 8791]
// --cam places a free camera (game.cam); --steps advances game time by that many 1/30 s frames before the picture;
// --hold waits that many real milliseconds after --eval (CSS animations and the game's own loop run in real time).
import { chromium } from 'playwright-core';

const a = process.argv.slice(2), out = a[0] && !a[0].startsWith('--') ? a[0] : 'snap.png';
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const port = opt('port', '8791'), url = opt('url', '/?solo&autostart');
const w = +opt('w', 960), h = +opt('h', 540);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +opt('dpr', 1) });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(`http://localhost:${port}${url}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.player && window.__game.player.body && window.__game.ready, null, { timeout: 30000 }).catch(() => errors.push('game never became ready'));
await page.waitForTimeout(+opt('wait', 2500));
const cam = opt('cam', '');
const info = await page.evaluate(async ({ cam, js, steps }) => {
  const g = window.__game;
  if (js) await (0, eval)(`(async () => { ${js} })()`);
  if (cam) { const v = cam.split(',').map(Number); g.cam = { pos: v.slice(0, 3), look: v.slice(3, 6) }; }
  for (let i = 0; i < steps; i++) g.frame(1 / 30);
  g.frame(0);
  const r = g.renderer.info;
  return { calls: r.render.calls, tris: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures };
}, { cam, js: opt('eval', ''), steps: +opt('steps', 0) }).catch((e) => ({ error: e.message }));
if (+opt('hold', 0)) await page.waitForTimeout(+opt('hold', 0));
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, ...info, errors: errors.slice(0, 12) }));
await browser.close();
