// Builds the mann.cool cartridge cover for this game: renders tools/cover/label.html and prints it onto the
// catalog's cartridge (the body of an existing cover, label window x 329-676, y 169-739 on the 800x1200 canvas).
//   node tools/cover/build.mjs [--catalog ../mann-cool-leave] [--body sledding.webp] [--out file.webp]
// Writes <catalog>/public/covers/leave.webp plus previews in tools/cover/out/ (label.png, cover.png, compare.jpg).
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)), OUT = join(HERE, 'out');
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const catalog = resolve(opt('catalog', join(HERE, '../../../mann-cool-leave'))), covers = join(catalog, 'public/covers');
const WIN = { x: 329, y: 169, w: 348, h: 571, rTop: 2, rBottom: 7 }, SCALE = 4;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: WIN.w, height: WIN.h }, deviceScaleFactor: SCALE });
await page.goto(pathToFileURL(join(HERE, 'label.html')).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const big = await page.locator('#label').screenshot({ type: 'png' });
await browser.close();
await sharp(big).toFile(join(OUT, 'label.png'));

// the label, at the window's size, with the window's rounded corners and a soft recess along its edges
const { x, y, w, h, rTop: rt, rBottom: rb } = WIN;
const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path fill="#fff" d="M${rt},0 H${w - rt} Q${w},0 ${w},${rt} V${h - rb} Q${w},${h} ${w - rb},${h} H${rb} Q0,${h} 0,${h - rb} V${rt} Q0,0 ${rt},0 Z"/></svg>`);
const recess = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>
  <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".018" stop-color="#000" stop-opacity="0"/></linearGradient>
  <linearGradient id="l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".02" stop-color="#000" stop-opacity="0"/><stop offset=".985" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient>
  </defs><rect width="${w}" height="${h}" fill="url(#t)"/><rect width="${w}" height="${h}" fill="url(#l)"/></svg>`);
const label = await sharp(big).resize(w, h, { kernel: 'lanczos3' }).composite([{ input: recess }, { input: mask, blend: 'dest-in' }]).png().toBuffer();

const body = sharp(join(covers, opt('body', 'sledding.webp')));
const meta = await body.metadata();
if (meta.width !== 800 || meta.height !== 1200) throw new Error('cartridge body must be 800x1200');
const out = opt('out', join(covers, 'leave.webp'));
const cover = await body.composite([{ input: label, left: x, top: y }]).png().toBuffer();
await sharp(cover).webp({ quality: 92, alphaQuality: 100 }).toFile(out);
await sharp(cover).toFile(join(OUT, 'cover.png'));

// previews: the label close up, and the cover at card size beside five current covers
const refs = ['pdoom.png', 'fuckice.webp', 'coldplay-canoodle.webp', 'hell-v2.webp', 'sledding.webp'], cw = 240, ch = 360;
const tiles = await Promise.all([out, ...refs.map((f) => join(covers, f))].map(async (f, i) => ({ input: await sharp(f).resize(cw, ch).flatten({ background: '#1b1b1f' }).png().toBuffer(), left: i * cw, top: 0 })));
await sharp({ create: { width: cw * tiles.length, height: ch, channels: 3, background: '#1b1b1f' } }).composite(tiles).jpeg({ quality: 92 }).toFile(join(OUT, 'compare.jpg'));
await sharp(cover).extract({ left: x - 40, top: y - 40, width: w + 80, height: h + 80 }).flatten({ background: '#1b1b1f' }).resize({ width: 856 }).jpeg({ quality: 92 }).toFile(join(OUT, 'label-on-cart.jpg'));
const m = await sharp(out).metadata();
console.log(out, m.width + 'x' + m.height, 'alpha', m.hasAlpha);
