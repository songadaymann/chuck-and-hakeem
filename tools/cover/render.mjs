// Renders single things from the running dev game (npm run dev, port 8791) as cut-out PNGs for the mann.cool
// cartridge cover: everything else is hidden, the background is a flat key colour, and the key becomes transparency.
//   node tools/cover/render.mjs            all parts into tools/cover/parts/
//   node tools/cover/render.mjs chuck      just one
// The game draws at a low height and scales up without smoothing, so edges are hard and the key comes out clean.
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, 'parts');
mkdirSync(OUT, { recursive: true });
const KEY = [255, 0, 255];

// Each part: page size (CSS px), render height (the game's own pixel rows; the page is an exact multiple of it),
// a camera, and which objects stay visible.
const X = [-50, 50], Z = 10;   // where the two men stand (shared/config.js)
const head = (i, yaw) => ({ w: 1200, h: 1200, rh: 300, show: `giant:${i}`, pose: { i, yaw, nod: 0.02 },
  cam: { pos: [X[i] + 2 * (i ? -1 : 1), 3 + 31, Z + 46], look: [X[i], 3 + 29.5, Z], fov: 24 } });
const PARTS = {
  chuck: head(0, 0.12),
  hakeem: head(1, -0.12),
  capitol: { w: 1600, h: 1200, rh: 300, show: 'world', cam: { pos: [0, 30, 150], look: [0, 34, 0], fov: 30 } },
  shovel: { w: 600, h: 1200, rh: 300, show: 'shovel', cam: { pos: [0.5, 300.75, 3.6], look: [0, 300.75, 0], fov: 26 } },
  digger: { w: 1000, h: 1200, rh: 300, show: 'digger', char: 'Male_Adult_05', steps: 9, cam: { pos: [3.4, 301.3, 4.8], look: [0, 300.8, 0], fov: 30 } },
  digger2: { w: 1000, h: 1200, rh: 300, show: 'digger', char: 'Female_Adult_04', steps: 16, cam: { pos: [-3.6, 301.3, 4.6], look: [0, 300.8, 0], fov: 30 } },
  dirt: { w: 1200, h: 1200, rh: 300, show: 'dirt', cam: { pos: [-50, 60, 70], look: [-50, 20, 22], fov: 16 } },
};

const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio'] });
for (const [name, p] of Object.entries(PARTS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
  if (p.char) await page.addInitScript((c) => { try { localStorage.setItem('dig-them-out-v2', JSON.stringify({ v: 2, char: c, name: 'Fed-Up Digger 26' })); } catch (e) {} }, p.char);
  await page.goto(`http://localhost:8791/?solo&autostart&capture&plugins=none&mods=none&rh=${p.rh}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready && window.__game.player?.body && window.__game.giants.length === 2, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(async ({ show, pose, key, steps }) => {
    const g = window.__game, [kind, arg] = show.split(':');
    document.getElementById('hud').hidden = true;
    for (const el of document.querySelectorAll('body > *:not(canvas)')) el.style.display = 'none';
    const Color = g.scene.background.constructor;
    g.scene.background = new Color(key[0] / 255, key[1] / 255, key[2] / 255); g.scene.background.convertSRGBToLinear?.();
    g.scene.fog = null;
    const keep = new Set();
    if (kind === 'giant') g.giants[+arg].root.traverse((o) => keep.add(o));
    if (kind === 'shovel') { const t = g.player.avatar.tool; g.scene.add(t); t.position.set(0, 300, 0); t.rotation.set(0, 0, 0); t.scale.set(1, 1, 1); t.traverse((o) => keep.add(o)); }
    if (kind === 'digger') {   // the player, lifted clear of everything, swinging the shovel
      g.player.pos.set(0, 300, 0); g.player.yaw = 0; g.surface = () => 300; g.testInput = { x: 0, z: 0, run: false, dig: true };
      g.player.avatar.body.root.traverse((o) => keep.add(o));
    }
    if (kind === 'dirt') keep.add(g.fields[0].mesh);
    g.scene.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) o.visible = keep.has(o); });
    if (kind === 'world') {   // the Capitol: everything the world builder added, without piles, men, people or signs
      const hide = new Set(); for (const gi of g.giants) { gi.root.traverse((o) => hide.add(o)); hide.add(gi.sign); }
      for (const f of g.fields) hide.add(f.mesh);
      g.player.avatar.root?.traverse?.((o) => hide.add(o));
      g.scene.traverse((o) => { if (o.isMesh) o.visible = !hide.has(o); });
    }
    window.__pose = pose || null; window.__steps = steps || 3;
  }, { show: p.show, pose: p.pose, key: KEY, steps: p.steps });
  const cam = await page.evaluate((c) => { window.__game.cam = c; return c; }, p.cam);
  await page.evaluate(() => {
    const g = window.__game, p = window.__pose; g.resize();
    for (let i = 0; i < (window.__steps || 3); i++) g.frame(1 / 30);
    const tag = g.player.avatar.tag; if (tag) { tag.material.transparent = true; tag.material.opacity = 0; }   // no name tag in a cut-out
    if (p) { const gi = g.giants[p.i]; gi.turn = p.yaw - Math.sin(g.time * 0.35 + gi.cfg.x) * 0.35; gi.nod = p.nod; }   // cancel his idle sway: the core adds turn to it
    g.frame(0);
  });
  await page.waitForTimeout(150);
  const shot = await page.locator('canvas').first().screenshot({ type: 'png' });
  // key -> alpha, then trim to the thing itself
  const { data, info } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - KEY[0]) < 12 && data[i + 1] < 12 && Math.abs(data[i + 2] - KEY[2]) < 12) data[i + 3] = 0;
  const file = join(OUT, name + '.png');
  await sharp(data, { raw: info }).trim({ threshold: 1 }).png().toFile(file);
  const m = await sharp(file).metadata();
  console.log(name, m.width + 'x' + m.height, JSON.stringify(cam));
  await page.close();
}
await browser.close();
