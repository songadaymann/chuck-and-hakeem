#!/usr/bin/env node
// assets.mjs 1.3.0
// Keeps licensed and third-party media out of public repos while every file keeps its normal path.
// Spec: open-source-kit/design/ASSET-SEPARATION.md. Single file, ESM, Node >= 20, zero dependencies.
// Canonical copy: open-source-kit/tools/assets/assets.mjs. Every repo vendors a byte-identical copy at
// scripts/assets.mjs (`node <kit>/tools/assets/assets.mjs vendor`). Run `node scripts/assets.mjs help`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = '1.3.0';
const MARK = 'assets.mjs-' + 'placeholder v1'; // split so this source file never carries the marker itself
const DEFAULT_MANIFEST = 'private-assets.json';
const STAMP_NAME = 'asset-stamp.json';
const DROP_DIR = 'private-assets';
const STATE_REL = `${DROP_DIR}/.state.json`;
const MD_BEGIN = '<!-- assets.mjs:begin (generated from private-assets.json by `node scripts/assets.mjs docs`; edit the manifest, not this block) -->';
const MD_END = '<!-- assets.mjs:end -->';
const IGNORE_BEGIN = '# >>> assets.mjs: generated from private-assets.json by `node scripts/assets.mjs docs`; do not edit by hand >>>';
const IGNORE_END = '# <<< assets.mjs <<<';
// Media: images, image sources, GPU textures, audio, soundfonts and tracker/ripped music, video, 3D, fonts, and the archives
// packs arrive in (a committed pack zip is the whole pack). Any other binary file is held to the same coverage rule.
const MEDIA_EXT = new Set([
  'png jpg jpeg gif webp avif bmp ico svg psd aseprite ase tga tif tiff dds ktx ktx2 basis kra xcf',
  'wav mp3 ogg m4a flac aif aiff opus aac caf wma mid midi sf2 sf3 sfz spc nsf nsfe xm mod it s3m brr',
  'mp4 webm mov mkv m4v avi',
  'glb gltf fbx obj vrm blend hdr exr dae 3ds usdz stl ply',
  'ttf otf woff woff2',
  'zip rar 7z tar gz tgz bz2 xz unitypackage pck',
].join(' ').split(' '));
const IMAGE_EXT = new Set('png jpg jpeg gif webp avif bmp'.split(' ')); // can take a PNG placeholder (browsers sniff content)
const AUDIO_EXT = new Set('wav ogg m4a mp3 opus flac'.split(' '));
const RESTRICTIONS = new Set(['no-redistribution', 'no-modified-redistribution', 'no-resale', 'no-standalone-nft', 'no-ai-input', 'no-ai-training', 'no-user-export', 'credit-required', 'credit-link-required']);
const DECISIONS = new Set(['replace', 'hide', 'retire', 'hold']);
const SHIPS = new Set(['always', 'build-only', 'never']);
const KINDS = new Set(['auto', 'checker', 'tile-grid', 'atlas-frame', 'atlas-texture', 'silent-wav', 'silent', 'copy', 'none']);
const CATCH_ALLS = new Set(['public/', 'public/assets/', 'assets/', 'src/', 'static/', './', '/', '**', '*', '**/*', '**/', 'public/**', 'public/assets/**', 'assets/**', 'src/**', 'static/**']);
// Folders so generic that "everything under them" is a catch-all (with `**`, or with a wildcard-only remainder).
const GENERIC_ROOTS = new Set(['', 'public/', 'public/assets/', 'assets/', 'src/', 'src/assets/', 'static/', 'res/', 'game/', 'www/', 'web/', 'dist/', 'build/']);
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WHO_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_OR_DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
// Same key shapes as skills/start-open-project/scripts/oss-check.sh. Values are never printed.
const SECRET_RE = /((?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}|(?<![A-Za-z0-9])sk-(proj-)?[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|r8_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----$|(PRIVATE_KEY|private_key|privateKey|SIGNER_KEY)["' ]*[:=]["' ]*(0x)?[0-9a-fA-F]{64}|(SECRET|API_KEY|AUTH_TOKEN|ACCESS_TOKEN)[A-Z_]*["' ]*[:=]["' ]*0x4[A-Za-z0-9_-]{30,}|sk_live_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,})/m;
// Secret-type file names: ONE list, shared verbatim with oss-check.sh's SECRET_FILES/SECRET_EXCEPT (a test keeps them equal).
// Written so the same string is a valid JavaScript RegExp and a POSIX ERE (grep -iE); both match case-insensitively.
export const SECRET_FILE_PATTERN = '(^|/)(\\.env(\\.[^/]*)?|\\.dev\\.vars(\\.[^/]*)?|[^/]*\\.pem|[^/]*\\.p8|[^/]*\\.key|secrets?\\.[^/]*|credentials[^/]*\\.json|[^/]*oauth[^/]*token[^/]*\\.json|service-account[^/]*\\.json)$';
export const SECRET_FILE_EXCEPT = '\\.(example|sample|template)$';
const SECRET_FILE_RE = new RegExp(SECRET_FILE_PATTERN, 'i'), SECRET_EXCEPT_RE = new RegExp(SECRET_FILE_EXCEPT, 'i');
export const isSecretFileName = (p) => SECRET_FILE_RE.test(p) && !SECRET_EXCEPT_RE.test(p);
// Storage, CDN, file-sharing and attachment hosts: their links are files or capabilities, never a store page.
const STORAGE_HOST_RE = /(cloudflarestorage\.com$|\.r2\.dev$|amazonaws|cloudfront\.net$|dropboxusercontent|(^|\.)dropbox\.com$|googleusercontent|usercontent\.google\.com$|(^|\.)drive\.google\.com$|(^|\.)discordapp\.(com|net)$|(^|\.)discord\.com$|hwcdn\.net$|itch\.zone$|backblazeb2|(^|\.)wetransfer\.com$|(^|\.)we\.tl$|(^|\.)mega\.nz$|(^|\.)mediafire\.com$|(^|\.)box\.com$|(^|\.)1drv\.ms$|sharepoint\.com$|onedrive\.live\.com$)/i;
const ITCH_HOST_RE = /(^|\.)itch\.io$/i;
// Store pages kMDItemWhereFroms may name, with the item path each needs. Anything else: ask Jonathan (never guess).
const STORE_PAGES = [
  [/^[a-z0-9-]+\.itch\.io$/i, /^\/[^/]+/],
  [/^itch\.io$/i, /^\/b\/\d+\/[^/]+/],
  [/^(www\.)?craftpix\.net$/i, /^\/(product|freebies|sets|packs)\/[^/]+/],
  [/^(assetstore|marketplace)\.unity\.com$/i, /^\/packages\/.+/],
  [/^elements\.envato\.com$/i, /^\/[^/]+-[A-Z0-9]{5,}/],
  [/^(www\.)?(fab|unrealengine)\.com$/i, /^\/(listings|marketplace\/[^/]+\/product)\/[^/]+/],
  [/^(www\.)?sketchfab\.com$/i, /^\/3d-models\/[^/]+/],
  [/^(www\.)?cgtrader\.com$/i, /^\/(3d-models|free-3d-models)\/.+/],
  [/^(www\.)?opengameart\.org$/i, /^\/content\/[^/]+/],
  [/^(www\.)?kenney\.nl$/i, /^\/assets\/[^/]+/],
  [/^(www\.)?gamedevmarket\.net$/i, /^\/asset\/[^/]+/],
  [/^([a-z0-9-]+\.)?gumroad\.com$/i, /^\/l\/[^/]+/],
  [/^(www\.)?(spriters|sounds|models|textures)-resource\.com$/i, /^\/.+\/\d+/],
  [/^fonts\.google\.com$/i, /^\/specimen\/[^/]+/],
  [/^(www\.)?fontstruct\.com$/i, /^\/fontstructions\/show\/\d+/],
  [/^(www\.)?dafont\.com$/i, /^\/[^/]+\.font$/],
  [/^(www\.)?freesound\.org$/i, /^\/people\/[^/]+\/sounds\/\d+/],
  [/^github\.com$/i, /^\/[^/]+\/[^/]+/],
];

class Exit extends Error { constructor(code, message) { super(message); this.code = code; } }
const usageError = (msg) => { throw new Exit(2, msg); };
const envError = (msg) => { throw new Exit(3, msg); };
const problem = (msg) => { throw new Exit(1, msg); };

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------
const toPosix = (p) => p.split(path.sep).join('/');
/** Repo paths are compared in NFC, as git does on macOS (core.precomposeunicode); zips from old Macs carry NFD names. */
const nfc = (p) => p.normalize('NFC');
const extOf = (p) => { const b = path.posix.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const isMedia = (p) => MEDIA_EXT.has(extOf(p));
const isLockfile = (p) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|[^/]*\.lockb?)$/.test(p);
/** Binary content (a NUL byte in the first 8 KB), the same test git uses. */
const isBinaryHead = (buf) => !!buf && buf.length > 0 && buf.subarray(0, 8000).includes(0);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const gitBlobId = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
export const isPlaceholder = (buf) => !!buf && buf.subarray(0, 4096).includes(MARK);
/**
 * The calendar date (YYYY-MM-DD) where Jonathan is, not in UTC: at 8 pm on the US East Coast, UTC is already tomorrow.
 * ASSETS_TZ (an IANA zone such as America/New_York) overrides the machine's zone; ASSETS_TODAY pins "today" in tests.
 */
export function localDay(env = process.env, d = new Date()) {
  if (env.ASSETS_TZ) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: env.ASSETS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch { /* unknown zone: the machine's own */ } }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayOf = (env) => env.ASSETS_TODAY || localDay(env);
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const semverCmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shq = (s) => (/^[A-Za-z0-9_./@:=,+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function readIf(abs) { try { return fs.readFileSync(abs); } catch { return null; } }
function readHead(abs, n = 4096) {
  let fd; try { fd = fs.openSync(abs, 'r'); const b = Buffer.alloc(n); const got = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, got); } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function writeAtomic(abs, buf) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, abs);
}
function writeIfChanged(abs, text) { const cur = readIf(abs); if (cur && cur.toString('utf8') === text) return false; writeAtomic(abs, text); return true; }
/** Is this a repo-relative POSIX path the tool may write: no absolute path, no "." / ".." / empty segment, nothing in .git? */
function relPathProblem(rel) {
  if (typeof rel !== 'string' || !rel) return 'is empty';
  if (rel.startsWith('/') || rel.includes('\\') || /^[A-Za-z]:/.test(rel)) return 'is not a repo-relative POSIX path';
  const segs = rel.split('/');
  if (segs.some((s) => s === '..' || s === '.' || s === '')) return 'has a ".", "..", or empty segment';
  if (segs.some((s) => s.toLowerCase() === '.git')) return 'is inside .git';
  return null;
}
/** Does `rel` exist under exactly this spelling (not just case-insensitively, as on a default macOS disk)? */
function existsExact(root, rel) {
  const dir = path.join(root, path.posix.dirname(rel)), base = path.posix.basename(rel);
  try { return fs.readdirSync(dir).some((n) => n === base || n.normalize('NFC') === base); } catch { return false; }
}
/**
 * Where it is safe to write `rel`: inside the repo, never in .git, and with no symlink between the repo root and the leaf
 * (a symlinked folder would make sync write into another folder or repo). Returns {abs} or {why}.
 */
function safeTarget(root, rel) {
  const bad = relPathProblem(rel); if (bad) return { why: `${rel} ${bad}` };
  let realRoot; try { realRoot = fs.realpathSync(root); } catch { return { why: `${root} does not exist` }; }
  const segs = rel.split('/'); let cur = root;
  for (let i = 0; i < segs.length; i++) {
    cur = path.join(cur, segs[i]);
    let st; try { st = fs.lstatSync(cur); } catch { break; } // the rest does not exist yet: writeAtomic creates real folders
    if (st.isSymbolicLink()) return { why: `${segs.slice(0, i + 1).join('/')} is a symlink${i < segs.length - 1 ? ' (a symlinked folder)' : ''}` };
    if (i < segs.length - 1 && !st.isDirectory()) return { why: `${segs.slice(0, i + 1).join('/')} is not a folder` };
  }
  const abs = path.join(root, ...segs);
  let parentReal = null; for (let d = path.dirname(abs); ; d = path.dirname(d)) { try { parentReal = fs.realpathSync(d); break; } catch { if (d === path.dirname(d)) break; } }
  if (!parentReal || (parentReal !== realRoot && !parentReal.startsWith(realRoot + path.sep))) return { why: `${rel} resolves outside the repository` };
  return { abs };
}
function walkFiles(absDir, skip = new Set(['.git', 'node_modules'])) {
  const out = [];
  const visit = (d) => {
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (skip.has(e.name) || e.name === '.DS_Store') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p); else if (e.isFile()) out.push(p);
    }
  };
  visit(absDir);
  return out.sort(cmp);
}
/**
 * Every file a deploy would upload from a build folder, following symlinks (wrangler and Pages uploads follow them),
 * with cycle protection. Returns [{rel, abs, via, size}] where `via` names the symlink a file was reached through, if any.
 */
function walkBuild(absDir) {
  const out = [], seen = new Set();
  const visit = (d, relDir, via) => {
    let real; try { real = fs.realpathSync(d); } catch { return; }
    if (seen.has(real)) return; seen.add(real);
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name === '.git' || e.name === '.DS_Store') continue;
      const p = path.join(d, e.name), rel = relDir ? `${relDir}/${e.name}` : e.name;
      const link = e.isSymbolicLink() ? rel : via;
      let st; try { st = fs.statSync(p); } catch { continue; } // a dangling link uploads nothing
      if (st.isDirectory()) visit(p, rel, link); else if (st.isFile()) out.push({ rel, abs: p, via: link, size: st.size });
    }
  };
  visit(absDir, '', null);
  return out.sort((a, b) => cmp(a.rel, b.rel));
}

// ---------------------------------------------------------------------------------------------
// globs ("*", "**", "?", "{a,b}", and "dir/" for a whole folder)
// ---------------------------------------------------------------------------------------------
function splitTopLevel(s) {
  const parts = []; let depth = 0, cur = '';
  for (const c of s) { if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; } if (c === '{') depth++; if (c === '}') depth--; cur += c; }
  parts.push(cur); return parts;
}
function globSource(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if ((i === 0 || g[i - 1] === '/') && g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      let depth = 0, j = i;
      for (; j < g.length; j++) { if (g[j] === '{') depth++; else if (g[j] === '}' && --depth === 0) break; }
      if (j >= g.length) { re += '\\{'; continue; }
      re += `(?:${splitTopLevel(g.slice(i + 1, j)).map(globSource).join('|')})`;
      i = j;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return re;
}
export function globToRegExp(glob) { return new RegExp(`^${globSource(glob)}${glob.endsWith('/') ? '.*' : ''}$`); }
const hasGlob = (s) => /[*?{]/.test(s);
export function expandBraces(g) {
  const i = g.indexOf('{'); if (i < 0) return [g];
  let depth = 0, j = i; for (; j < g.length; j++) { if (g[j] === '{') depth++; else if (g[j] === '}' && --depth === 0) break; }
  if (j >= g.length) return [g];
  return splitTopLevel(g.slice(i + 1, j)).flatMap((alt) => expandBraces(g.slice(0, i) + alt + g.slice(j + 1)));
}
const compile = (globs) => (globs ?? []).map((g) => ({ glob: g, re: globToRegExp(g) }));
// A pattern also matches the path it spells literally, so a file named `brace{1}.png` or `q?.png` can still be named.
const matchesAny = (compiled, p) => compiled.some((c) => c.glob === p || c.re.test(p));

// ---------------------------------------------------------------------------------------------
// images: dimensions, PNG decode/encode, pixel hash
// ---------------------------------------------------------------------------------------------
export function imageSize(buf) {
  try { return imageSizeOf(buf); } catch { return null; } // a truncated header (a short WebP or JPEG) has no size, never a crash
}
function imageSizeOf(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encode an 8-bit PNG. colorType 6 takes RGBA pixels; colorType 3 takes palette indices plus `palette` [[r,g,b,a?],…]. */
export function encodePng({ w, h, colorType = 6, pixels, palette, text, level = 9 }) {
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const rowLen = w * bpp, raw = Buffer.alloc((rowLen + 1) * h);
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const parts = [PNG_SIG, pngChunk('IHDR', ihdr)];
  if (text) parts.push(pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')));
  if (colorType === 3) {
    parts.push(pngChunk('PLTE', Buffer.from(palette.flatMap((c) => c.slice(0, 3)))));
    if (palette.some((c) => c.length > 3 && c[3] !== 255)) parts.push(pngChunk('tRNS', Buffer.from(palette.map((c) => (c.length > 3 ? c[3] : 255)))));
  }
  parts.push(pngChunk('IDAT', zlib.deflateSync(raw, { level })), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// Adam7 passes as [x0, y0, dx, dy]: each pass is a reduced image with its own filtered rows.
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
/**
 * Decode a PNG (any bit depth and colour type, interlaced or not) to RGBA8. Returns null if it is not a PNG, and
 * {skipped, w, h} for an invalid colour type, bit depth, or interlace method. Interlaced (Adam7) files decode to the
 * same pixels as their non-interlaced re-save, so a lossless interlaced copy of a licensed PNG has the same pixel hash.
 */
export function decodePng(buf) {
  if (!buf || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let w, h, depth, ct, interlace, palette = null, trns = null; const idat = [];
  for (let o = 8; o + 8 <= buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ct = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!w || !h) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!channels) return { skipped: `colour type ${ct}`, w, h };
  if (!PNG_DEPTHS[ct].includes(depth)) return { skipped: `bit depth ${depth} for colour type ${ct}`, w, h };
  if (interlace !== 0 && interlace !== 1) return { skipped: `interlace method ${interlace}`, w, h };
  if (ct === 3 && !palette) return { skipped: 'palette image without PLTE', w, h };
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth, bpp = Math.max(1, bitsPerPixel >> 3), maxv = (1 << depth) - 1;
  const rgba = Buffer.alloc(w * h * 4);
  const sample = (row, idx) => { // idx-th sample in the row, raw value at the image bit depth
    if (depth === 8) return row[idx];
    if (depth === 16) return row.readUInt16BE(idx * 2);
    const bit = idx * depth, byte = row[bit >> 3], shift = 8 - depth - (bit & 7);
    return (byte >> shift) & maxv;
  };
  const to8 = (v) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / maxv));
  const tr = trns && (ct === 0 ? [trns.readUInt16BE(0)] : ct === 2 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null);
  /** Write the n pixels of one unfiltered (reduced) row to image row y, at x0, x0+dx, … */
  const putRow = (row, y, x0, dx, n) => {
    for (let i = 0; i < n; i++) {
      const o = (y * w + x0 + i * dx) * 4; let r, g, b, a = 255;
      if (ct === 3) { const k = sample(row, i); r = palette[k * 3] ?? 0; g = palette[k * 3 + 1] ?? 0; b = palette[k * 3 + 2] ?? 0; if (trns && k < trns.length) a = trns[k]; }
      else if (ct === 0) { const v = sample(row, i); r = g = b = to8(v); if (tr && v === tr[0]) a = 0; }
      else if (ct === 4) { r = g = b = to8(sample(row, i * 2)); a = to8(sample(row, i * 2 + 1)); }
      else if (ct === 2) { const s = [sample(row, i * 3), sample(row, i * 3 + 1), sample(row, i * 3 + 2)]; [r, g, b] = s.map(to8); if (tr && s[0] === tr[0] && s[1] === tr[1] && s[2] === tr[2]) a = 0; }
      else { r = to8(sample(row, i * 4)); g = to8(sample(row, i * 4 + 1)); b = to8(sample(row, i * 4 + 2)); a = to8(sample(row, i * 4 + 3)); }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  };
  let at = 0;
  for (const [x0, y0, dx, dy] of interlace ? ADAM7 : [[0, 0, 1, 1]]) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue; // an empty pass has no rows, not even filter bytes
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride); // the "previous row" starts at zero in every pass
    for (let y = 0; y < ph; y++, at += stride + 1) {
      const f = raw[at] ?? 0;
      for (let i = 0; i < stride; i++) {
        let v = raw[at + 1 + i]; if (v === undefined) { cur[i] = 0; continue; } // truncated data reads as 0 (as 1.1.0 did)
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        cur[i] = v & 0xff;
      }
      putRow(cur, y0 + y * dy, x0, dx, pw);
      [prev, cur] = [cur, prev];
    }
  }
  return { w, h, rgba };
}

/** sha256 of "w,h" + RGBA8 with fully transparent pixels zeroed: equal for losslessly recompressed copies. */
export function pixelHash(buf) { return pixelFacts(buf)?.hash ?? null; }
/** {hash, uniform}: `uniform` is true when every pixel is the same (a blank or flat image, never evidence of a copy). */
export function pixelFacts(buf) {
  let img; try { img = decodePng(buf); } catch { return null; }
  if (!img || !img.rgba) return null;
  return rgbaFacts(img.w, img.h, img.rgba);
}
/** pixelFacts of raw RGBA8 pixels (what a PNG decodes to), so a placeholder's pixel hash needs no PNG encode and decode. */
function rgbaFacts(w, h, rgba) {
  const px = Buffer.from(rgba);
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 0) px[i] = px[i + 1] = px[i + 2] = 0;
  let uniform = true; for (let i = 4; i < px.length && uniform; i += 4) if (px.readUInt32BE(i) !== px.readUInt32BE(0)) uniform = false;
  return { hash: crypto.createHash('sha256').update(`${w},${h}`).update(px).digest('hex'), uniform };
}
const isPngBytes = (buf) => !!buf && buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG);

function fileFacts(buf, relPath) {
  const e = { sha256: sha256(buf), blob: gitBlobId(buf), bytes: buf.length };
  if (IMAGE_EXT.has(extOf(relPath)) || extOf(relPath) === 'ico') { const d = imageSize(buf); if (d) { e.w = d.w; e.h = d.h; } }
  if (extOf(relPath) === 'png') { const ph = pixelHash(buf); if (ph) e.pixel = ph; }
  return e;
}

// ---------------------------------------------------------------------------------------------
// placeholders
// ---------------------------------------------------------------------------------------------
export function hueRgb(hex) {
  const n = parseInt(hex.slice(0, 6), 16), h = (n % 360) / 60, x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r * 200 + 40, g * 200 + 40, b * 200 + 40].map(Math.round);
}
const markText = (label) => `${MARK} ${label}`;
function fillRect(px, w, x0, y0, rw, rh, [r, g, b], a = 255) {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) { const o = (y * w + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a; }
}
// Each image placeholder is built as pixels first (…Pixels), then encoded (…Png). isOwnPlaceholder compares pixel
// hashes of the pixels directly, so recognising a placeholder whose marker was stripped needs no PNG encode.
function checkerPixels(w, h, label, grid = [16, 16]) {
  const base = hueRgb(sha256(label)), light = base.map((v) => Math.round(v + (255 - v) * 0.35)), dark = base.map((v) => Math.round(v * 0.72));
  const [gw, gh] = grid, idx = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx[y * w + x] = x % gw === 0 || y % gh === 0 || x === w - 1 || y === h - 1 ? 2 : ((x >> 3) + (y >> 3)) & 1;
  return { idx, palette: [light, dark, [30, 30, 36]] };
}
export function checkerPng(w, h, label, grid = [16, 16]) {
  const { idx, palette } = checkerPixels(w, h, label, grid);
  return encodePng({ w, h, colorType: 3, pixels: idx, palette, text: markText(label) });
}
function tileGridPixels(w, h, label, tile = 16) {
  const px = Buffer.alloc(w * h * 4);
  for (let ty = 0; ty * tile < h; ty++) for (let tx = 0; tx * tile < w; tx++) {
    const x0 = tx * tile, y0 = ty * tile, tw = Math.min(tile, w - x0), th = Math.min(tile, h - y0);
    fillRect(px, w, x0, y0, tw, th, hueRgb(sha256(`${label}:${tx}:${ty}`)));
    fillRect(px, w, x0, y0, tw, 1, [24, 24, 28]); fillRect(px, w, x0, y0, 1, th, [24, 24, 28]);
    fillRect(px, w, x0, y0 + th - 1, tw, 1, [24, 24, 28]); fillRect(px, w, x0 + tw - 1, y0, 1, th, [24, 24, 28]);
  }
  return px;
}
export function tileGridPng(w, h, label, tile = 16) { return encodePng({ w, h, pixels: tileGridPixels(w, h, label, tile), text: markText(label) }); }
function atlasFrames(json) {
  const fr = json?.frames;
  if (Array.isArray(fr)) return fr.map((f) => [f.filename, f]);
  if (fr && typeof fr === 'object') return Object.entries(fr);
  throw new Error('atlas JSON has no "frames"');
}
function atlasFramePixels(w, h, atlasJson, frameId) {
  const f = atlasFrames(atlasJson).find(([id]) => id === frameId)?.[1];
  if (!f) throw new Error(`frame "${frameId}" is not in the atlas`);
  if (f.rotated) throw new Error(`frame "${frameId}" is rotated; atlas placeholders need unrotated frames`);
  const r = f.spriteSourceSize ?? { x: 0, y: 0, w: f.frame.w, h: f.frame.h };
  if (r.x + r.w > w || r.y + r.h > h) throw new Error(`frame "${frameId}" does not fit ${w}x${h}`);
  const px = Buffer.alloc(w * h * 4);
  fillRect(px, w, r.x, r.y, r.w, r.h, hueRgb(sha256(frameId)));
  return px;
}
export function atlasFramePng(w, h, label, atlasJson, frameId) { return encodePng({ w, h, pixels: atlasFramePixels(w, h, atlasJson, frameId), text: markText(label) }); }
function atlasTexturePixels(w, h, atlasJson) {
  const size = atlasJson?.meta?.size; if (size && (size.w !== w || size.h !== h)) throw new Error(`atlas meta.size ${size.w}x${size.h} differs from the image ${w}x${h}`);
  const px = Buffer.alloc(w * h * 4);
  for (const [id, f] of atlasFrames(atlasJson)) {
    if (f.rotated) throw new Error(`frame "${id}" is rotated; atlas placeholders need unrotated frames`);
    fillRect(px, w, f.frame.x, f.frame.y, f.frame.w, f.frame.h, hueRgb(sha256(id)));
  }
  return px;
}
export function atlasTexturePng(w, h, label, atlasJson) { return encodePng({ w, h, pixels: atlasTexturePixels(w, h, atlasJson), text: markText(label) }); }

// --- silent audio, same container where feasible (WAV, MP3, Ogg Opus, FLAC, M4A/AAC) ---------
export function silentWav(label) {
  let text = Buffer.from(`${markText(label)}\0`, 'utf8'); if (text.length % 2) text = Buffer.concat([text, Buffer.alloc(1)]);
  const icmt = Buffer.concat([Buffer.from('ICMT'), u32le(text.length), text]);
  const list = Buffer.concat([Buffer.from('LIST'), u32le(4 + icmt.length), Buffer.from('INFO'), icmt]);
  const fmt = Buffer.concat([Buffer.from('fmt '), u32le(16), u16le(1), u16le(1), u32le(8000), u32le(8000), u16le(1), u16le(8)]);
  const data = Buffer.concat([Buffer.from('data'), u32le(800), Buffer.alloc(800, 128)]); // 0.1 s, 8 kHz mono 8-bit
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, data]);
  return Buffer.concat([Buffer.from('RIFF'), u32le(body.length), body]);
}
function silentMp3(label) {
  const text = Buffer.from(markText(label), 'utf8');
  const comm = Buffer.concat([Buffer.from([3]), Buffer.from('eng'), Buffer.from([0]), text]); // UTF-8 (v2.4), empty description
  const frame = Buffer.concat([Buffer.from('COMM'), syncsafe(comm.length), Buffer.from([0, 0]), comm]);
  const tag = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncsafe(frame.length), frame]);
  const mpeg = Buffer.alloc(104); mpeg.set([0xff, 0xfb, 0x10, 0xc0]); // MPEG-1 Layer III, 32 kbps, 44.1 kHz, mono; zero side info = silence
  return Buffer.concat([tag, ...Array(6).fill(mpeg)]);
}
function syncsafe(n) { return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]); }
const OGG_CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; t[i] = r >>> 0; } return t; })();
function oggPage(serial, seq, flags, granule, packets) {
  const lacing = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0, 'latin1'); head[4] = 0; head[5] = flags; head.writeBigUInt64LE(BigInt(granule), 6);
  head.writeUInt32LE(serial, 14); head.writeUInt32LE(seq, 18); head[26] = lacing.length; Buffer.from(lacing).copy(head, 27);
  const page = Buffer.concat([head, ...packets]); let crc = 0;
  for (const b of page) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  page.writeUInt32LE(crc, 22); return page;
}
function silentOggOpus(label) {
  const serial = 0x61737374, frames = 5;
  const head = Buffer.concat([Buffer.from('OpusHead'), Buffer.from([1, 1]), u16le(312), u32le(48000), u16le(0), Buffer.from([0])]);
  const vendor = Buffer.from('assets.mjs'), comment = Buffer.from(`COMMENT=${markText(label)}`, 'utf8');
  const tags = Buffer.concat([Buffer.from('OpusTags'), u32le(vendor.length), vendor, u32le(1), u32le(comment.length), comment]);
  const packet = Buffer.from([0xf8, 0xff, 0xfe]); // CELT fullband 20 ms mono: digital silence
  return Buffer.concat([oggPage(serial, 0, 2, 0, [head]), oggPage(serial, 1, 0, 0, [tags]), oggPage(serial, 2, 4, 312 + frames * 960, Array(frames).fill(packet))]);
}
function crc8(buf) { let c = 0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; }
function crc16(buf) { let c = 0; for (const b of buf) { c ^= b << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; } return c; }
function silentFlac(label) {
  const n = 800; // 0.1 s at 8 kHz, mono, 8-bit
  const si = Buffer.alloc(34); si.writeUInt16BE(n, 0); si.writeUInt16BE(n, 2); // min/max block size; frame sizes left 0 (unknown)
  si.writeBigUInt64BE((8000n << 44n) | (0n << 41n) | (7n << 36n) | BigInt(n), 10);
  crypto.createHash('md5').update(Buffer.alloc(n)).digest().copy(si, 18);
  const vendor = Buffer.from('assets.mjs'), comment = Buffer.from(`COMMENT=${markText(label)}`, 'utf8');
  const vc = Buffer.concat([u32le(vendor.length), vendor, u32le(1), u32le(comment.length), comment]);
  const blockHead = (last, type, len) => Buffer.from([(last ? 0x80 : 0) | type, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  const fh = Buffer.from([0xff, 0xf8, 0x74, 0x02, 0x00, (n - 1) >> 8, (n - 1) & 0xff]); // fixed blocking, 16-bit block size, 8 kHz, mono, 8 bps, frame 0
  const frameNoCrc = Buffer.concat([fh, Buffer.from([crc8(fh)]), Buffer.from([0x00, 0x00])]); // CONSTANT subframe, value 0
  const frame = Buffer.concat([frameNoCrc, u16be(crc16(frameNoCrc))]);
  return Buffer.concat([Buffer.from('fLaC'), blockHead(false, 0, 34), si, blockHead(true, 4, vc.length), vc, frame]);
}
function box(type, ...parts) { const body = Buffer.concat(parts); return Buffer.concat([u32be(8 + body.length), Buffer.from(type, 'latin1'), body]); }
const fullBox = (type, version, flags, ...parts) => box(type, Buffer.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
function silentM4a(label) {
  const frames = 5, rate = 44100, frame = Buffer.from([0x01, 0x18, 0x20, 0x07]); // AAC-LC mono raw_data_block with no spectral data
  const dur = frames * 1024, matrix = Buffer.concat([u32be(0x10000), u32be(0), u32be(0), u32be(0), u32be(0x10000), u32be(0), u32be(0), u32be(0), u32be(0x40000000)]);
  const desc = (tag, body) => Buffer.concat([Buffer.from([tag, body.length]), body]);
  const asc = Buffer.from([0x12, 0x08]); // AAC LC, 44.1 kHz, mono
  const dcd = desc(0x04, Buffer.concat([Buffer.from([0x40, 0x15, 0, 0x06, 0]), u32be(64000), u32be(32000), desc(0x05, asc)]));
  const esds = fullBox('esds', 0, 0, desc(0x03, Buffer.concat([u16be(1), Buffer.from([0]), dcd, desc(0x06, Buffer.from([2]))])));
  const mp4a = box('mp4a', Buffer.alloc(6), u16be(1), Buffer.alloc(8), u16be(1), u16be(16), u16be(0), u16be(0), u32be(rate * 65536), esds);
  const ftyp = box('ftyp', Buffer.from('M4A '), u32be(0), Buffer.from('M4A isomiso2mp41'));
  const free = box('free', Buffer.from(markText(label), 'utf8'));
  const build = (chunkOffset) => box('moov',
    fullBox('mvhd', 0, 0, u32be(0), u32be(0), u32be(1000), u32be(Math.round((dur / rate) * 1000)), u32be(0x10000), u16be(0x100), Buffer.alloc(10), matrix, Buffer.alloc(24), u32be(2)),
    box('trak',
      fullBox('tkhd', 0, 3, u32be(0), u32be(0), u32be(1), u32be(0), u32be(Math.round((dur / rate) * 1000)), Buffer.alloc(8), u16be(0), u16be(0), u16be(0x100), u16be(0), matrix, u32be(0), u32be(0)),
      box('mdia',
        fullBox('mdhd', 0, 0, u32be(0), u32be(0), u32be(rate), u32be(dur), u16be(0x55c4), u16be(0)),
        fullBox('hdlr', 0, 0, u32be(0), Buffer.from('soun'), Buffer.alloc(12), Buffer.from('SoundHandler\0')),
        box('minf',
          fullBox('smhd', 0, 0, u16be(0), u16be(0)),
          box('dinf', fullBox('dref', 0, 0, u32be(1), fullBox('url ', 0, 1))),
          box('stbl',
            fullBox('stsd', 0, 0, u32be(1), mp4a),
            fullBox('stts', 0, 0, u32be(1), u32be(frames), u32be(1024)),
            fullBox('stsc', 0, 0, u32be(1), u32be(1), u32be(frames), u32be(1)),
            fullBox('stsz', 0, 0, u32be(0), u32be(frames), ...Array(frames).fill(u32be(frame.length))),
            fullBox('stco', 0, 0, u32be(1), u32be(chunkOffset)))))));
  const moovLen = build(0).length, offset = ftyp.length + free.length + moovLen + 8;
  return Buffer.concat([ftyp, free, build(offset), box('mdat', ...Array(frames).fill(frame))]);
}
/** A short silent file in the same container as `relPath` (WAV fallback for anything else). */
export function silentAudio(relPath, label = relPath) {
  const ext = extOf(relPath);
  if (ext === 'mp3') return silentMp3(label);
  if (ext === 'ogg' || ext === 'opus') return silentOggOpus(label);
  if (ext === 'flac') return silentFlac(label);
  if (ext === 'm4a') return silentM4a(label);
  return silentWav(label);
}

/** Normalise a placeholder spec (string or object) to {kind, …}. Throws on invalid input. */
export function parsePlaceholder(spec) {
  if (spec === undefined || spec === null) return { kind: 'auto' };
  if (typeof spec === 'string') {
    const s = spec.trim();
    if (s.startsWith('{')) return parsePlaceholder(JSON.parse(s));
    if (s.startsWith('copy:')) { const p = s.slice(5); if (!p) throw new Error('copy: needs a repo path'); const bad = relPathProblem(p); if (bad) throw new Error(`copy: stand-in ${p} ${bad}`); return { kind: 'copy', path: p }; }
    if (!KINDS.has(s) || s === 'copy') throw new Error(`unknown placeholder kind "${s}"`);
    if (s === 'atlas-frame' || s === 'atlas-texture') throw new Error(`${s} needs a JSON spec with "atlas"${s === 'atlas-frame' ? ' and "frame"' : ''}`);
    return { kind: s };
  }
  if (typeof spec !== 'object' || spec === null || !KINDS.has(spec.kind)) throw new Error(`invalid placeholder ${JSON.stringify(spec)}`);
  const allowed = { checker: ['grid'], 'tile-grid': ['tile'], 'atlas-frame': ['atlas', 'frame'], 'atlas-texture': ['atlas'], copy: ['path'] }[spec.kind] ?? [];
  const extra = Object.keys(spec).filter((k) => k !== 'kind' && !allowed.includes(k));
  if (extra.length) throw new Error(`placeholder ${spec.kind} has unknown field${extra.length > 1 ? 's' : ''} ${extra.map((k) => `"${k}"`).join(', ')}`);
  if (spec.kind === 'atlas-frame' && (typeof spec.atlas !== 'string' || typeof spec.frame !== 'string')) throw new Error('atlas-frame needs "atlas" and "frame"');
  if (spec.kind === 'atlas-texture' && typeof spec.atlas !== 'string') throw new Error('atlas-texture needs "atlas"');
  if (spec.kind === 'copy' && typeof spec.path !== 'string') throw new Error('copy needs "path"');
  if (spec.kind === 'copy') { const bad = relPathProblem(spec.path); if (bad) throw new Error(`copy stand-in ${spec.path} ${bad}`); }
  if ((spec.kind === 'atlas-frame' || spec.kind === 'atlas-texture') && spec.atlas.split('/').some((s) => s === '..' || s.toLowerCase() === '.git')) throw new Error(`atlas ${spec.atlas} must stay inside the repository`);
  if (spec.kind === 'checker' && spec.grid !== undefined && !(Array.isArray(spec.grid) && spec.grid.length === 2 && spec.grid.every((n) => Number.isInteger(n) && n > 0))) throw new Error('checker "grid" must be [w, h]');
  if (spec.kind === 'tile-grid' && spec.tile !== undefined && !(Number.isInteger(spec.tile) && spec.tile > 0)) throw new Error('tile-grid "tile" must be a positive integer');
  return { ...spec };
}
function resolvePlaceholder(entry, pack, relPath) {
  let spec = parsePlaceholder(entry.placeholder ?? pack?.placeholder ?? 'auto');
  if (spec.kind === 'auto') {
    const ext = extOf(relPath);
    if (IMAGE_EXT.has(ext) && entry.w && entry.h) spec = relPath.includes('/tilesets/') ? { kind: 'tile-grid' } : { kind: 'checker' };
    else if (AUDIO_EXT.has(ext)) spec = { kind: 'silent' };
    else spec = { kind: 'none' };
  }
  return spec;
}
/** Resolve an atlas reference (path or glob) against a list of known repo paths: exactly one match. */
function resolveAtlas(ref, knownPaths) {
  if (!hasGlob(ref)) { if (!knownPaths.has(ref)) throw new Error(`atlas ${ref} does not exist`); return ref; }
  const re = globToRegExp(ref), hits = [...knownPaths].filter((p) => re.test(p));
  if (hits.length !== 1) throw new Error(`atlas glob ${ref} must match exactly one file, matched ${hits.length}${hits.length ? `: ${hits.slice(0, 3).join(', ')}` : ''}`);
  return hits[0];
}
const expandDirName = (tpl, relPath) => tpl.replaceAll('{dir}', path.posix.dirname(relPath)).replaceAll('{name}', path.posix.basename(relPath).replace(/\.[^.]+$/, ''));
function renderPlaceholder(spec, relPath, entry, io) {
  const need = () => { if (!entry.w || !entry.h) throw new Error(`no w/h recorded for ${relPath}`); };
  switch (spec.kind) {
    case 'none': return null;
    case 'checker': need(); return checkerPng(entry.w, entry.h, relPath, spec.grid);
    case 'tile-grid': need(); return tileGridPng(entry.w, entry.h, relPath, spec.tile ?? 16);
    case 'atlas-frame': need(); { const a = resolveAtlas(expandDirName(spec.atlas, relPath), io.knownPaths()); return atlasFramePng(entry.w, entry.h, relPath, JSON.parse(io.read(a)), spec.frame); }
    case 'atlas-texture': need(); { const a = resolveAtlas(expandDirName(spec.atlas, relPath), io.knownPaths()); return atlasTexturePng(entry.w, entry.h, relPath, JSON.parse(io.read(a))); }
    case 'silent-wav': return silentWav(relPath);
    case 'silent': return silentAudio(relPath);
    case 'copy': { const b = io.read(spec.path); if (!b) throw new Error(`copy: stand-in ${spec.path} not found`); return b; }
    default: throw new Error(`unknown placeholder kind ${spec.kind}`);
  }
}
/** The RGBA pixels of an image placeholder kind as {w, h, rgba}, or null for the other kinds (audio, copy:, none). */
function placeholderImage(spec, relPath, entry, io) {
  const need = () => { if (!entry.w || !entry.h) throw new Error(`no w/h recorded for ${relPath}`); };
  const { w, h } = entry;
  switch (spec.kind) {
    case 'checker': {
      need(); const { idx, palette } = checkerPixels(w, h, relPath, spec.grid), rgba = Buffer.alloc(w * h * 4);
      for (let i = 0; i < idx.length; i++) { const c = palette[idx[i]]; rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255; }
      return { w, h, rgba };
    }
    case 'tile-grid': need(); return { w, h, rgba: tileGridPixels(w, h, relPath, spec.tile ?? 16) };
    case 'atlas-frame': need(); { const a = resolveAtlas(expandDirName(spec.atlas, relPath), io.knownPaths()); return { w, h, rgba: atlasFramePixels(w, h, JSON.parse(io.read(a)), spec.frame) }; }
    case 'atlas-texture': need(); { const a = resolveAtlas(expandDirName(spec.atlas, relPath), io.knownPaths()); return { w, h, rgba: atlasTexturePixels(w, h, JSON.parse(io.read(a))) }; }
    default: return null;
  }
}
/** The pixel hash of `relPath`'s image placeholder (as pixelHash would compute it from the PNG), or null. */
export function placeholderPixelHash(spec, relPath, entry, io) {
  let img; try { img = placeholderImage(spec, relPath, entry, io); } catch { return null; }
  return img ? rgbaFacts(img.w, img.h, img.rgba).hash : null;
}
/**
 * Is `buf` this tool's placeholder for `relPath`? The marker says so; without it (an optimizer such as WAMP's
 * optimize_png_assets.mjs keeps only colour chunks, so tEXt goes) the deterministic placeholder for this path is
 * rebuilt and compared: an image placeholder by pixels (a PNG at any name; nothing is encoded), anything else by bytes
 * (and by pixels when it is a PNG). `pixel` is the caller's pixel hash of `buf`, when it already has one.
 */
function isOwnPlaceholder(buf, spec, relPath, entry, io, { pixel } = {}) {
  if (!buf) return false;
  if (isPlaceholder(buf)) return true;
  if (!spec || spec.kind === 'none') return false;
  const got = () => pixel ?? (isPngBytes(buf) ? pixelHash(buf) : null);
  if (['checker', 'tile-grid', 'atlas-frame', 'atlas-texture'].includes(spec.kind)) { const want = placeholderPixelHash(spec, relPath, entry, io); return !!want && got() === want; }
  let ph; try { ph = renderPlaceholder(spec, relPath, entry, io); } catch { return false; }
  if (!ph || !ph.length) return false;
  if (ph.equals(buf)) return true;
  const want = isPngBytes(ph) ? pixelHash(ph) : null; return !!want && got() === want;
}
/** How `buf` matches a manifest entry: 'exact' (same sha256), 'pixels' (a PNG with the same pixels), or null. */
export function matchKind(e, buf) {
  if (!buf || !e) return null;
  if (buf.length === e.bytes && sha256(buf) === e.sha256) return 'exact';
  if (e.pixel) { const px = pixelHash(buf); if (px && px === e.pixel) return 'pixels'; }
  return null;
}

// ---------------------------------------------------------------------------------------------
// zip reading (store + deflate; zip64 unsupported), sources for scan/import
// ---------------------------------------------------------------------------------------------
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 archives are not supported');
  const entries = [];
  for (let o = cdOffset, i = 0; i < count; i++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(o + 10), csize = buf.readUInt32LE(o + 20), nameLen = buf.readUInt16LE(o + 28), extraLen = buf.readUInt16LE(o + 30), commentLen = buf.readUInt16LE(o + 32), local = buf.readUInt32LE(o + 42);
    const flags = buf.readUInt16LE(o + 8), name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', o + 46, o + 46 + nameLen);
    if (csize === 0xffffffff || local === 0xffffffff) throw new Error('zip64 archives are not supported');
    o += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({ name, method, read: () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`zip method ${method} not supported (${name})`);
    } });
  }
  return entries;
}
/** Every file in a zip or folder as {name, read()}. */
function sourceFiles(absSrc) {
  const st = fs.statSync(absSrc);
  if (st.isDirectory()) return walkFiles(absSrc, new Set(['.git', 'node_modules', '__MACOSX'])).map((f) => ({ name: toPosix(path.relative(absSrc, f)), read: () => fs.readFileSync(f) }));
  return readZip(fs.readFileSync(absSrc)).filter((e) => !e.name.startsWith('__MACOSX/') && !path.posix.basename(e.name).startsWith('._'));
}

// ---------------------------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------------------------
const TOP_KEYS = ['$schema', 'schema', 'tool', 'project', 'mode', 'mirror', 'build', 'exclude', 'forbidden', 'retired', 'privateGlobs', 'credits', 'packs', 'files'];
/** The first tool version that understands each newer manifest field; a writer raises "tool" when it writes one. */
const FIELD_SINCE = { retired: '1.2.0' };
function needTool(m, field) { const v = FIELD_SINCE[field]; if (v && !(typeof m.tool === 'string' && SEMVER_RE.test(m.tool) && semverCmp(m.tool, v) >= 0)) m.tool = v; }
const PACK_KEYS = ['section', 'title', 'author', 'url', 'license', 'terms', 'paid', 'acquired', 'privateBecause', 'restrictions', 'credit', 'snapshot', 'why', 'decision', 'decidedBy', 'reviewBy', 'replacement', 'placeholder', 'ship'];
const FILE_KEYS = ['pack', 'sha256', 'blob', 'bytes', 'w', 'h', 'pixel', 'placeholder', 'ship'];
function ordered(obj, keys) { const o = {}; for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k]; for (const k of Object.keys(obj).sort(cmp)) if (!(k in o) && obj[k] !== undefined) o[k] = obj[k]; return o; }
const J = (v) => JSON.stringify(v);
const jsonLine = (v) => J(v).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "');
/** Canonical form: fixed key order, one `files` and one `forbidden.blobs` entry per line, sorted. */
export function serializeManifest(m) {
  const top = ordered(m, TOP_KEYS), keys = Object.keys(top), lines = ['{'];
  keys.forEach((k, i) => {
    const v = top[k], comma = i < keys.length - 1 ? ',' : '';
    let body;
    if (k === 'files' || k === 'packs') {
      const ids = Object.keys(v ?? {}).sort(cmp);
      if (!ids.length) body = '{}';
      else if (k === 'files') body = `{\n${ids.map((p, j) => `    ${J(p)}: ${J(ordered(v[p], FILE_KEYS))}${j < ids.length - 1 ? ',' : ''}`).join('\n')}\n  }`;
      else body = `{\n${ids.map((id, j) => { const p = ordered(v[id], PACK_KEYS), pk = Object.keys(p); return `    ${J(id)}: {\n${pk.map((f, n) => `      ${J(f)}: ${jsonLine(p[f])}${n < pk.length - 1 ? ',' : ''}`).join('\n')}\n    }${j < ids.length - 1 ? ',' : ''}`; }).join('\n')}\n  }`;
    } else if (k === 'forbidden') {
      const f = ordered(v ?? {}, ['paths', 'blobs']), parts = [];
      if (f.paths) parts.push(`    "paths": ${f.paths.length ? `[\n${f.paths.map((p) => `      ${J(p)}`).join(',\n')}\n    ]` : '[]'}`);
      if (f.blobs) { const ids = Object.keys(f.blobs).sort(cmp); parts.push(`    "blobs": ${ids.length ? `{\n${ids.map((id) => `      ${J(id)}: ${J(f.blobs[id])}`).join(',\n')}\n    }` : '{}'}`); }
      for (const extra of Object.keys(f).filter((x) => x !== 'paths' && x !== 'blobs')) parts.push(`    ${J(extra)}: ${J(f[extra])}`);
      body = parts.length ? `{\n${parts.join(',\n')}\n  }` : '{}';
    } else if (Array.isArray(v)) body = v.length ? `[\n${v.map((x) => `    ${jsonLine(x)}`).join(',\n')}\n  ]` : '[]';
    else body = jsonLine(v);
    lines.push(`  ${J(k)}: ${body}${comma}`);
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function validatePackUrl(url) {
  let u; try { u = new URL(url); } catch { return 'is not a valid URL'; }
  if (!/^https?:$/.test(u.protocol)) return 'must be http(s)';
  if (STORAGE_HOST_RE.test(u.hostname)) return 'is a storage, CDN, or file-sharing link, not the store page';
  if ([...u.searchParams.keys()].some((k) => /^(x-amz-|x-goog-|googleaccessid|signature|sig$|expires|token|key|access_token|download_key)/i.test(k))) return 'is a signed link, not the store page';
  if (ITCH_HOST_RE.test(u.hostname) && /\/(download|purchase)(\/|$)/.test(u.pathname)) return 'is an itch download/purchase link; use the game page';
  if (u.pathname === '' || u.pathname === '/') return "is a site's front page; use the item's own page";
  return null;
}
/** Validate a manifest. Returns {errors, warnings}: arrays of {rule, msg, fix?}. */
export function validateManifest(m, { today = localDay() } = {}) {
  const errors = [], warnings = [];
  const E = (msg, fix) => errors.push({ rule: 'manifest', msg, fix }), W = (msg, fix) => warnings.push({ rule: 'manifest', msg, fix });
  if (m.schema !== 1) E('"schema" must be 1');
  if (typeof m.tool !== 'string' || !SEMVER_RE.test(m.tool)) E('"tool" must be a semver string such as "1.0.0"');
  if (typeof m.project !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(m.project)) E('"project" must be "owner/name"');
  if (!['overlay', 'mirror', 'published-mirror'].includes(m.mode)) E('"mode" must be overlay, mirror, or published-mirror');
  if (m.mode === 'mirror') {
    if (!m.mirror?.public || !/^[\w.-]+\/[\w.-]+$/.test(m.mirror.public)) E('"mirror.public" (owner/name) is required in mirror mode');
    else if (m.mirror.public.toLowerCase() === String(m.project).toLowerCase()) E('"mirror.public" must differ from "project": a public repo under the dev name would receive private history from old clones');
  }
  if (m.exclude !== undefined) {
    if (!Array.isArray(m.exclude) || !m.exclude.every((g) => typeof g === 'string')) E('"exclude" must be an array of globs');
    else if (m.exclude.length && m.mode === 'overlay') E('"exclude" is only allowed in mirror mode (in overlay mode, use forbidden.paths or add)');
  }
  const unknownKeys = (obj, keys, where) => { if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const k of Object.keys(obj)) if (!keys.includes(k)) E(`${where}: unknown field "${k}" (allowed: ${keys.join(', ')})`); };
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (m.mirror !== undefined) { if (!isObj(m.mirror)) E('"mirror" must be an object'); else unknownKeys(m.mirror, ['public'], 'mirror'); }
  if (m.build !== undefined) {
    if (!isObj(m.build)) E('"build" must be an object');
    else {
      unknownKeys(m.build, ['publicDir', 'out', 'credits'], 'build');
      for (const k of ['publicDir', 'out', 'credits']) if (m.build[k] !== undefined && (typeof m.build[k] !== 'string' || !m.build[k] || m.build[k].startsWith('/') || m.build[k].includes('\\') || m.build[k].split('/').some((s) => s === '..' || s.toLowerCase() === '.git'))) E(`"build.${k}" must be a repo-relative POSIX path (no backslash) outside .git`);
    }
  }
  const fb = m.forbidden ?? {};
  if (m.forbidden !== undefined && !isObj(m.forbidden)) E('"forbidden" must be an object');
  unknownKeys(fb, ['paths', 'blobs'], 'forbidden');
  if (fb.paths !== undefined && (!Array.isArray(fb.paths) || !fb.paths.every((g) => typeof g === 'string' && g))) E('"forbidden.paths" must be an array of globs');
  if (fb.blobs !== undefined && !isObj(fb.blobs)) E('"forbidden.blobs" must be an object {blob id: note}');
  for (const [id, note] of Object.entries(isObj(fb.blobs) ? fb.blobs : {})) { if (!/^[0-9a-f]{40}$/.test(id)) E(`forbidden.blobs key ${id} is not a 40-hex git blob id`); if (typeof note !== 'string') E(`forbidden.blobs ${id}: the note must be a string`); }
  if (m.retired !== undefined) {
    if (!Array.isArray(m.retired)) E('"retired" must be an array of repo paths');
    else {
      for (const r of m.retired) { const bad = typeof r === 'string' ? relPathProblem(r) : 'is not a string'; if (bad) E(`retired: ${JSON.stringify(r)} ${bad}`); }
      if (new Set(m.retired).size !== m.retired.length) E('"retired" lists a path twice');
      if (typeof m.tool === 'string' && SEMVER_RE.test(m.tool) && semverCmp(m.tool, FIELD_SINCE.retired) < 0) E(`"retired" needs "tool": "${FIELD_SINCE.retired}" or newer (older tools would not keep those paths ignored)`);
    }
  }
  const packs = m.packs ?? {}, files = m.files ?? {};
  if (!isObj(m.packs)) E('"packs" is required');
  if (!isObj(m.files)) E('"files" is required');
  if (m.privateGlobs !== undefined && !Array.isArray(m.privateGlobs)) E('"privateGlobs" must be an array');
  for (const [i, g] of (Array.isArray(m.privateGlobs) ? m.privateGlobs : []).entries()) {
    if (typeof g?.glob !== 'string' || !g.glob) { E(`privateGlobs[${i}] needs "glob"`); continue; }
    const G = (msg) => E(`privateGlobs[${i}] (${g.glob}): ${msg}`);
    unknownKeys(g, ['glob', 'pack', 'placeholder', 'rebuild'], `privateGlobs[${i}]`);
    if (g.glob.startsWith('/') || g.glob.split('/').some((s) => s === '..' || s.toLowerCase() === '.git')) G('globs are repo-relative and stay outside .git');
    if (!packs[g.pack]) G(`pack "${g.pack}" is not in "packs"`);
    if (g.placeholder !== undefined) try { parsePlaceholder(g.placeholder); } catch (e) { G(e.message); }
    if (g.rebuild !== undefined) { const bad = rebuildProblem(g.rebuild); if (bad) G(`"rebuild" ${bad}`); }
  }
  if (m.credits !== undefined && !Array.isArray(m.credits)) E('"credits" must be an array');
  for (const [i, c] of (Array.isArray(m.credits) ? m.credits : []).entries()) {
    if (typeof c?.text !== 'string' || !c.text || typeof c.required !== 'boolean') E(`credits[${i}] needs "text" and a boolean "required"`);
    unknownKeys(c, ['text', 'url', 'required'], `credits[${i}]`);
    if (c?.url !== undefined) { let u = null; try { u = new URL(c.url); } catch { /* invalid */ } if (!u || !/^https?:$/.test(u.protocol)) E(`credits[${i}]: "url" must be an http(s) URL`); }
  }
  for (const [id, p] of Object.entries(packs)) {
    const P = (msg) => E(`pack ${id}: ${msg}`);
    if (!ID_RE.test(id)) P('ids are lowercase kebab-case');
    if (!isObj(p)) { P('must be an object'); continue; }
    unknownKeys(p, PACK_KEYS, `pack ${id}`);
    if (p.section !== 3 && p.section !== 4) { P('"section" must be 3 or 4'); continue; }
    if (p.snapshot !== undefined && p.snapshot !== null && !(isObj(p.snapshot) && DATE_RE.test(p.snapshot.on ?? '') && /^[0-9a-f]{64}$/.test(p.snapshot.sha256 ?? '') && Object.keys(p.snapshot).every((k) => k === 'on' || k === 'sha256'))) P('"snapshot" must be null or {on: YYYY-MM-DD, sha256}');
    for (const k of ['title', 'author', 'license', 'terms', 'credit', 'why', 'replacement']) if (p[k] !== undefined && typeof p[k] !== 'string') P(`"${k}" must be a string`);
    if (typeof p.title !== 'string' || !p.title) P('"title" is required');
    if (p.restrictions !== undefined && !Array.isArray(p.restrictions)) P('"restrictions" must be an array');
    else if (p.restrictions) {
      for (const r of p.restrictions) if (!RESTRICTIONS.has(r)) P(`unknown restriction ${JSON.stringify(r)} (allowed: ${[...RESTRICTIONS].join(', ')})`);
      if (new Set(p.restrictions).size !== p.restrictions.length) P('"restrictions" lists a restriction twice');
    }
    if (p.url !== undefined) { const bad = validatePackUrl(p.url); if (bad) P(`url ${bad}`); }
    if (p.placeholder !== undefined) try { parsePlaceholder(p.placeholder); } catch (e) { P(e.message); }
    if (p.ship !== undefined && !SHIPS.has(p.ship)) P('"ship" must be always, build-only, or never');
    if (p.section === 3) {
      for (const k of ['author', 'url', 'license', 'terms']) if (typeof p[k] !== 'string' || !p[k]) P(`"${k}" is required for section 3`);
      if (typeof p.paid !== 'boolean') P('"paid" (true/false) is required for section 3');
      if (!MONTH_OR_DATE_RE.test(p.acquired ?? '')) P('"acquired" (YYYY-MM-DD or YYYY-MM) is required for section 3');
      if (!['license', 'policy', 'unknown-terms'].includes(p.privateBecause)) P('"privateBecause" must be license, policy, or unknown-terms');
      if (Array.isArray(p.restrictions) && p.restrictions.some((r) => typeof r === 'string' && r.startsWith('credit-')) && !p.credit) P('a credit-required pack needs "credit"');
    } else {
      if (typeof p.why !== 'string' || !p.why) P('"why" is required for section 4');
      if (!DECISIONS.has(p.decision)) P('"decision" must be replace, hide, retire, or hold');
      if (typeof p.decidedBy !== 'string' || !WHO_RE.test(p.decidedBy)) P('"decidedBy" must name who decided ("jonathan", or "agent" for a proposal awaiting him)');
      else if (p.decision === 'hide' && p.decidedBy !== 'jonathan') P('"hide" is Jonathan\'s decision only: "decidedBy" must be "jonathan" (agents never decide hide)');
      if (['replace', 'hide', 'hold'].includes(p.decision) && !DATE_RE.test(p.reviewBy ?? '')) P(`"reviewBy" (YYYY-MM-DD) is required for decision ${p.decision}`);
      if (p.acquired !== undefined && !MONTH_OR_DATE_RE.test(p.acquired)) P('"acquired" must be YYYY-MM-DD or YYYY-MM');
    }
    if (p.reviewBy && DATE_RE.test(p.reviewBy) && p.reviewBy < today) W(`OVERDUE: pack ${id} (${p.decision ?? 'section 3'}) was due for review by ${p.reviewBy}`);
  }
  for (const [p, f] of Object.entries(files)) {
    const F = (msg) => E(`${p}: ${msg}`);
    const bad = relPathProblem(p); if (bad) F(`paths are repo-relative POSIX paths outside .git (this one ${bad})`);
    if (!isObj(f)) { F('must be an object'); continue; }
    unknownKeys(f, FILE_KEYS, p);
    if (!packs[f.pack]) F(`pack "${f.pack}" is not in "packs"`);
    if (!/^[0-9a-f]{64}$/.test(f.sha256 ?? '')) F('"sha256" must be 64 hex');
    if (!/^[0-9a-f]{40}$/.test(f.blob ?? '')) F('"blob" must be a 40-hex git blob id');
    if (!Number.isInteger(f.bytes) || f.bytes < 0) F('"bytes" must be an integer');
    for (const k of ['w', 'h']) if (f[k] !== undefined && !(Number.isInteger(f[k]) && f[k] > 0)) F(`"${k}" must be a positive integer`);
    if (f.pixel !== undefined && !/^[0-9a-f]{64}$/.test(f.pixel)) F('"pixel" must be 64 hex');
    if (f.placeholder !== undefined) try { parsePlaceholder(f.placeholder); } catch (e) { F(e.message); }
    if (f.ship !== undefined && !SHIPS.has(f.ship)) F('"ship" must be always, build-only, or never');
  }
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) E(`unknown top-level field "${k}" (a newer tool's field needs a newer "tool"; otherwise a typo)`);
  return { errors, warnings };
}
/** `privateGlobs[].rebuild`: ["node", "<repo script>", …args]. Runs without a shell, from the repo root. */
function rebuildProblem(r) {
  if (!Array.isArray(r) || r.length < 2 || !r.every((a) => typeof a === 'string' && a)) return 'must be ["node", "<repo-relative script>", …args]';
  if (r[0] !== 'node') return 'must start with "node" (it runs with this Node, without a shell)';
  const bad = relPathProblem(r[1]); if (bad) return `script ${r[1]} ${bad}`;
  if (!/\.(mjs|cjs|js)$/.test(r[1])) return `script ${r[1]} must be a .mjs/.cjs/.js file in the repository`;
  return null;
}
const shipOf = (m, p) => m.files[p].ship ?? m.packs[m.files[p].pack]?.ship ?? 'always';
/** A pack's restrictions, or [] (also when an invalid manifest holds something other than an array). */
const restrictionsOf = (p) => (Array.isArray(p?.restrictions) ? p.restrictions.filter((r) => typeof r === 'string') : []);

// ---------------------------------------------------------------------------------------------
// generated blocks: ASSETS.md §3/§4, credits.json, .gitignore
// ---------------------------------------------------------------------------------------------
/**
 * Exactly these paths, as backticked brace globs: `dir/{a,b}.png`, `dir/{x,y}.{mp3,wav}`, sibling folders that hold the
 * same names merged as `dir/{p,q}/{a,b}.png`, and one-file folders under one parent as `dir/{p/a,q/b}.png`. Never a
 * bare folder, so a reader can tell which files are meant, and every token is a valid §1/§2 row glob (release prints it).
 * Files at the repo root come out as `./name`, because a bare file name covers nothing.
 */
export function describePaths(paths) {
  const special = /[,{}*?`]/, loose = [], byDir = new Map();
  for (const p of [...new Set(paths)].sort(cmp)) {
    const d = path.posix.dirname(p), b = path.posix.basename(p);
    if (special.test(p)) { loose.push(p.includes('/') ? p : `./${p}`); continue; }
    if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(b);
  }
  const split = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : [n, '']; };
  const brace = (xs) => (xs.length === 1 ? xs[0] : `{${xs.join(',')}}`);
  /** One folder's names as patterns: stems that share the same extensions are grouped. */
  const patterns = (names) => {
    const exts = new Map(); for (const n of names) { const [stem, ext] = split(n); if (!exts.has(stem)) exts.set(stem, []); exts.get(stem).push(ext); }
    const byExts = new Map(); for (const [stem, list] of exts) { const k = list.sort(cmp).join(','); if (!byExts.has(k)) byExts.set(k, []); byExts.get(k).push(stem); }
    return [...byExts].map(([k, stems]) => { const e = k.split(','); return e.includes('') ? brace(stems.flatMap((st) => e.map((x) => (x ? `${st}.${x}` : st)))) : `${brace(stems)}.${brace(e)}`; });
  };
  const groups = new Map(); // parent + pattern -> sibling folder names
  for (const [d, list] of byDir) for (const pat of patterns(list)) {
    const parent = d === '.' ? null : path.posix.dirname(d), key = `${parent}\0${pat}`;
    if (!groups.has(key)) groups.set(key, { parent, pat, dirs: [] });
    if (d !== '.') groups.get(key).dirs.push(path.posix.basename(d));
  }
  const tokens = [], singles = new Map(); // parent + extension -> ["dir/stem"] for one-file folders
  for (const { parent, pat, dirs } of groups.values()) {
    if (parent === null) { tokens.push(`./${pat}`); continue; } // a bare name covers nothing; `./name` is a root file
    const pre = parent === '.' ? '' : `${parent}/`;
    if (dirs.length === 1 && !/[{}]/.test(pat)) { const [stem, ext] = split(pat), k = `${pre}\0${ext}`; if (!singles.has(k)) singles.set(k, []); singles.get(k).push(`${dirs[0]}/${stem}`); continue; }
    tokens.push(`${pre}${brace(dirs)}/${pat}`);
  }
  for (const [k, list] of singles) { const [pre, ext] = k.split('\0'); tokens.push(`${pre}${brace(list)}${ext ? `.${ext}` : ''}`); }
  return [...tokens, ...loose].sort(cmp).map((t) => `\`${t}\``).join(', ');
}
const rebuildText = (g) => (g.rebuild ? `generated by \`${g.rebuild.join(' ')}\` from the pack's files; \`node scripts/assets.mjs sync\` runs it once they are real` : 'generated');
export function renderAssetsBlock(m) {
  const byPack = new Map();
  for (const p of Object.keys(m.files ?? {}).sort(cmp)) { const id = m.files[p].pack; if (!byPack.has(id)) byPack.set(id, []); byPack.get(id).push(p); }
  const globRe = (m.privateGlobs ?? []).map((g) => ({ ...g, re: globToRegExp(g.glob) }));
  const globsBy = (id) => globRe.filter((g) => g.pack === id).map((g) => `\`${g.glob}\` (${rebuildText(g)})`);
  const ids = Object.keys(m.packs ?? {}).sort(cmp), s3 = ids.filter((id) => m.packs[id].section === 3), s4 = ids.filter((id) => m.packs[id].section === 4);
  // A published mirror lists each generated file; show those under their pattern, not one by one.
  const where = (id) => { const files = (byPack.get(id) ?? []).filter((p) => !globRe.some((g) => g.pack === id && g.re.test(p))); return [files.length ? `${describePaths(files)} (${plural(files.length, 'file')})` : '', ...globsBy(id)].filter(Boolean).join('; ') || '(no files yet)'; };
  const out = [MD_BEGIN, '', '## 3. Licensed (paid or restricted): not included', '',
    'These files keep their normal paths, but their bytes are not in the public repository. A public checkout gets same-size placeholders from `node scripts/assets.mjs sync`, so it still builds and runs. To build the full version, get your own copy of each pack, then run `node scripts/assets.mjs import <download>` and `node scripts/assets.mjs sync`. Files Jonathan edited (recolours, crops, recompressions) stay placeholders unless you place your own copies by hand.', ''];
  if (!s3.length) out.push('None.', '');
  else {
    out.push('| Expected path | What it is | Where to get it | Terms |', '| --- | --- | --- | --- |');
    for (const id of s3) {
      const p = m.packs[id];
      const terms = [p.license, p.terms, restrictionsOf(p).length ? `Restrictions: ${restrictionsOf(p).join(', ')}.` : '', p.credit ? `Credit: "${p.credit}".` : ''].filter(Boolean).join(' ');
      out.push(`| ${cell(where(id))} | ${cell(p.title)} (${p.paid ? 'paid' : 'free'}${p.acquired ? `, acquired ${p.acquired}` : ''}; pack \`${id}\`) | ${cell(p.url ? `[${p.url}](${p.url})` : '')}${p.author ? ` by ${cell(p.author)}` : ''} | ${cell(terms)} |`);
    }
    out.push('');
  }
  out.push('## 4. Not ours and not licensed: never in the repo', '', 'Each one is listed so nobody wonders why it is missing. The public build gets a placeholder at the same path, so ids and saved data keep working.', '');
  if (!s4.length) out.push('None.', '');
  else {
    out.push('| What | Why it is excluded | Decision |', '| --- | --- | --- |');
    for (const id of s4) {
      const p = m.packs[id];
      const decision = `${p.decision}${p.reviewBy ? ` (review by ${p.reviewBy})` : ''}${p.replacement ? `: ${p.replacement}` : ''}`;
      out.push(`| ${cell(p.title)} (pack \`${id}\`): ${cell(where(id))} | ${cell(p.why)} | ${cell(decision)} |`);
    }
    out.push('');
  }
  out.push(MD_END);
  return out.join('\n');
}
/**
 * Hand-written `## 3.` / `## 4.` sections outside the generated block (from an interim ASSETS.md, or an earlier draft):
 * [{start, end, line, heading}], as character offsets. The generated block replaces them.
 */
export function strayMdSections(text) {
  const out = [], lines = (text ?? '').split('\n'); let off = 0, inBlock = false, cur = null;
  const close = (end) => { if (cur) { cur.end = end; out.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], start = off; off += l.length + 1;
    if (l.startsWith(MD_BEGIN.slice(0, 22))) { close(start); inBlock = true; continue; }
    if (inBlock) { if (l.startsWith(MD_END)) inBlock = false; continue; }
    if (/^## /.test(l)) { close(start); if (/^## +[34]\b/.test(l)) cur = { start, line: i + 1, heading: l.trim() }; }
  }
  close(Math.min(off, (text ?? '').length));
  return out;
}
function upsertMdBlock(text, block) {
  const stray = strayMdSections(text); let t = text;
  for (const s of [...stray].reverse()) t = t.slice(0, s.start) + t.slice(s.end);
  const b = t.indexOf(MD_BEGIN.slice(0, 22)), e = t.indexOf(MD_END);
  if (b >= 0 && e > b) return t.slice(0, b) + block + t.slice(e + MD_END.length);
  if (stray.length) { // in place of the first hand-written section
    const at = stray[0].start, rest = t.slice(at);
    return rest.trim() ? `${t.slice(0, at)}${block}\n\n${rest}` : `${t.slice(0, at).replace(/\n*$/, '\n')}\n${block}\n`;
  }
  const anchor = t.search(/^## (Runtime content|Never commit)/m);
  if (anchor >= 0) return `${t.slice(0, anchor)}${block}\n\n${t.slice(anchor)}`;
  return `${t.replace(/\n*$/, '\n')}\n${block}\n`;
}
const strayNote = (stray) => stray.map((x) => `line ${x.line} "${x.heading.slice(0, 60)}"`).join(', ');
export function renderCredits(m) {
  const credits = [];
  for (const c of m.credits ?? []) credits.push({ text: c.text, ...(c.url ? { url: c.url } : {}), required: !!c.required });
  for (const id of Object.keys(m.packs ?? {}).sort(cmp)) {
    const p = m.packs[id]; if (!p.credit) continue;
    credits.push({ text: p.credit, ...(p.url ? { url: p.url } : {}), required: restrictionsOf(p).some((r) => r.startsWith('credit-')), pack: id });
  }
  return credits.length ? `${JSON.stringify({ generatedBy: `assets.mjs from private-assets.json (run \`node scripts/assets.mjs docs\`)`, credits }, null, 2)}\n` : null;
}
function creditsRel(m, hasSrc) { return m.build?.credits ?? (hasSrc ? 'src/generated/credits.json' : 'credits.json'); }
const hasSrcDir = (root) => fs.existsSync(path.join(root, 'src'));
const escIgnore = (p) => p.replace(/[\\*?[\]]/g, '\\$&').replace(/ $/, '\\ ');
const escIgnoreGlob = (g) => g.replace(/[\\[\]]/g, '\\$&').replace(/ $/, '\\ ');
export function renderIgnoreBlock(m) {
  const pub = (m.build?.publicDir ?? 'public').replace(/\/+$/, '');
  const lines = [IGNORE_BEGIN, `/${escIgnore(pub === '.' || pub === '' ? STAMP_NAME : `${pub}/${STAMP_NAME}`)}`, `/${DROP_DIR}/`];
  if (m.mode !== 'mirror') {
    for (const g of m.privateGlobs ?? []) for (const e of expandBraces(g.glob)) lines.push(`/${escIgnoreGlob(e)}`);
    for (const p of Object.keys(m.files ?? {}).sort(cmp)) lines.push(`/${escIgnore(p)}`);
    const retired = (Array.isArray(m.retired) ? m.retired : []).filter((p) => typeof p === 'string' && !(m.files ?? {})[p]).sort(cmp);
    if (retired.length) lines.push('# retired: dropped from the manifest, still ignored so no other checkout commits its copy', ...retired.map((p) => `/${escIgnore(p)}`));
  }
  lines.push(IGNORE_END);
  return lines.join('\n');
}
function upsertIgnoreBlock(text, block) {
  const b = text.indexOf(IGNORE_BEGIN.slice(0, 16)), e = text.indexOf(IGNORE_END);
  if (b >= 0 && e > b) return text.slice(0, b) + block + text.slice(e + IGNORE_END.length);
  return `${text ? `${text.replace(/\n*$/, '\n')}\n` : ''}${block}\n`;
}

// ---------------------------------------------------------------------------------------------
// ASSETS.md coverage (sections 1 and 2)
// ---------------------------------------------------------------------------------------------
// A row token that would cover "everything": no literal folder before the first wildcard ("*", "**", "*.png", "*" + "/"),
// or a generic root (public/, assets/, src/ …) followed by "**" or only wildcards ("public/**" + "/*", "src/**" + "/*.svg").
export function isCatchAll(token) {
  const t = token.replace(/^\.\//, '');
  if (!t || t === '/' || CATCH_ALLS.has(t)) return true;
  if (/[*?]/.test(t.split('/')[0])) return true;
  const wild = t.search(/[*?{]/);
  if (wild < 0) return false;
  const prefix = t.slice(0, wild).replace(/[^/]*$/, ''), rest = t.slice(prefix.length);
  return GENERIC_ROOTS.has(prefix) && (rest.includes('**') || /^[*?/]*$/.test(rest));
}
/** The first cell of a markdown table row, or null for a non-row, the header separator, or an empty cell. */
function firstCell(line) {
  const s = line.trim(); if (!s.startsWith('|')) return null;
  let cellText = '';
  for (let i = 1; i < s.length; i++) { if (s[i] === '\\' && s[i + 1] === '|') { cellText += '|'; i++; continue; } if (s[i] === '|') break; cellText += s[i]; }
  return /^[\s:-]*$/.test(cellText) ? null : cellText;
}
/**
 * ASSETS.md §1/§2 coverage. Only backticked tokens in the FIRST column of the tables under `## 1.` and `## 2.` count
 * (prose and other columns never do). A token must name a full path, a `folder/`, or a glob; bare filenames,
 * template placeholders (`<…>`, "Example"), and catch-alls cover nothing.
 */
export function coverage(assetsMd) {
  const text = (assetsMd ?? '').replace(new RegExp(`${MD_BEGIN.slice(0, 22).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MD_END}`), '');
  const rows = [], ignored = [];
  for (const chunk of text.split(/^(?=## )/m)) {
    const sec = chunk.match(/^## +([12])\b/)?.[1]; if (!sec) continue;
    for (const line of chunk.split('\n')) {
      const c = firstCell(line); if (c === null) continue;
      for (const [, raw] of c.matchAll(/`([^`\n]+)`/g)) {
        const t = nfc(raw.trim());
        if (!t.includes('/') || /^[a-z]+:\/\//i.test(t) || /^(node|git|npm|npx|gh|zsh|sh) /.test(t) || / --/.test(t)) continue;
        if (t.includes('<') || /Example/.test(t)) continue; // a template placeholder, not a path
        if (isCatchAll(t)) { ignored.push(t); continue; }
        const tok = t.replace(/^\.\//, '');
        rows.push({ token: tok, section: Number(sec), re: hasGlob(tok) || tok.endsWith('/') ? globToRegExp(tok) : null });
      }
    }
  }
  const hit = (r, p) => r.token === p || (!!r.re && r.re.test(p));
  const covers = (p) => rows.some((r) => hit(r, p));
  const coveringRows = (p, section) => [...new Set(rows.filter((r) => (!section || r.section === section) && hit(r, p)).map((r) => r.token))];
  /** Rows that match none of the given paths (media or not). */
  const unused = (paths) => [...new Set(rows.filter((r) => !paths.some((p) => hit(r, p))).map((r) => r.token))];
  return { rows, ignored, covers, coveringRows, unused, hit };
}

// ---------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------
function git(ctx, args, { input, cwd, buffer = false, allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: cwd ?? ctx.root, input, encoding: buffer ? undefined : 'utf8', maxBuffer: 1 << 30, env: ctx.env });
  if (r.error) gitSpawnError(r.error, args);
  if (r.status !== 0 && !allowFail) envError(`git ${args.join(' ').slice(0, 80)} failed: ${String(r.stderr).trim().split('\n')[0]}`);
  return allowFail ? r : r.stdout;
}
function gitSpawnError(err, args) {
  if (err.code === 'ENOENT') envError('git is not available (ENOENT: install git, or put it on PATH)');
  envError(`git ${args.join(' ').slice(0, 60)} failed (${err.code ?? err.message})${err.code === 'ENOBUFS' ? ': its output is larger than the 1 GiB buffer' : ''}`);
}
function indexEntries(ctx) {
  const map = new Map();
  for (const rec of git(ctx, ['ls-files', '-s', '-z']).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t'), [mode, blob, stage] = rec.slice(0, tab).split(' '), raw = rec.slice(tab + 1), p = nfc(raw);
    if (stage !== '0' && map.has(p)) continue;
    map.set(p, { mode, blob, path: p, raw });
  }
  return map;
}
/** Untracked files that are not ignored: exactly what `git add -A` would add. Nested repositories (dir/) are skipped. */
function untrackedFiles(ctx) { return git(ctx, ['ls-files', '-o', '--exclude-standard', '-z']).split('\0').filter((p) => p && !p.endsWith('/')); }
/** Tracked files whose working-tree bytes differ from the index (what `git add -A` would stage on top). */
function worktreeChanged(ctx) { return git(ctx, ['diff', '--name-only', '--no-renames', '--diff-filter=AMT', '-z']).split('\0').filter(Boolean); }
const isShallow = (ctx) => git(ctx, ['rev-parse', '--is-shallow-repository'], { allowFail: true }).stdout?.trim() === 'true';
/**
 * Which of `rels` git ignores. Without noIndex, tracked paths are never reported as ignored; with it, only the ignore
 * rules count (nested .gitignore files and "!" rules included), as if the paths were untracked.
 */
function ignoredSet(ctx, rels, { noIndex = false } = {}) {
  if (!rels.length) return new Set();
  const r = git(ctx, ['check-ignore', ...(noIndex ? ['--no-index'] : []), '--stdin', '-z'], { input: `${rels.join('\0')}\0`, allowFail: true });
  if (r.status !== 0 && r.status !== 1) envError(`git check-ignore failed: ${String(r.stderr).trim().split('\n')[0]}`);
  return new Set(String(r.stdout).split('\0').filter(Boolean).map(nfc));
}
/**
 * Stream blobs from one `git cat-file --batch` process, parsing its output incrementally, so no blob (or tree) has to fit
 * in one buffer. `sinkFor(id, size, type)` returns {data(chunk), end()} to receive that object's bytes, or null to skip
 * them. Chunks are views into the stream: a sink that keeps them must copy.
 */
async function catFileBatch(ctx, ids, sinkFor) {
  const uniq = [...new Set(ids)]; if (!uniq.length) return;
  const child = spawn('git', ['cat-file', '--batch'], { cwd: ctx.root, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let spawnErr = null, stderr = '';
  const closed = new Promise((resolve) => { child.on('error', (e) => { spawnErr = e; resolve(null); }); child.on('close', (code) => resolve(code)); });
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdin.on('error', () => { /* git exited early; reported below */ });
  child.stdin.end(`${uniq.join('\n')}\n`);
  let head = Buffer.alloc(0), cur = null; // cur: {sink, left} while inside an object's bytes (+ its trailing LF)
  try {
    for await (const chunk of child.stdout) {
      let off = 0;
      while (off < chunk.length) {
        if (!cur) {
          const nl = chunk.indexOf(10, off);
          if (nl < 0) { head = Buffer.concat([head, chunk.subarray(off)]); break; }
          const line = Buffer.concat([head, chunk.subarray(off, nl)]).toString('latin1'); head = Buffer.alloc(0); off = nl + 1;
          const [id, type, size] = line.split(' ');
          if (type === 'missing' || size === undefined) continue;
          cur = { sink: sinkFor(id, Number(size), type), left: Number(size) + 1 };
          continue;
        }
        const take = Math.min(cur.left, chunk.length - off), data = Math.min(take, cur.left - 1);
        if (data > 0 && cur.sink) cur.sink.data(chunk.subarray(off, off + data));
        cur.left -= take; off += take;
        if (cur.left === 0) { cur.sink?.end?.(); cur = null; }
      }
    }
  } catch (e) { if (!spawnErr) throw e; }
  const code = await closed;
  if (spawnErr) gitSpawnError(spawnErr, ['cat-file', '--batch']);
  if (code !== 0) envError(`git cat-file --batch failed: ${stderr.trim().split('\n')[0]}`);
}
/** A PNG larger than this is not decoded for its pixel hash (only its first bytes are read). */
const PNG_FULL_MAX = 256 * 1024 * 1024;
/**
 * Read blob prefixes: {id -> {buf, size}}, keeping only `wants.get(id)` bytes of each (Infinity: all of it, up to
 * PNG_FULL_MAX; above that, the first 8 KB). Streams, so a repo of large media never sits in memory at once.
 */
async function readBlobPrefixes(ctx, wants) {
  const out = new Map();
  await catFileBatch(ctx, [...wants.keys()], (id, size, type) => {
    if (type !== 'blob') return null;
    const want = wants.get(id), keep = Math.min(size, want === Infinity && size > PNG_FULL_MAX ? 8192 : want);
    const buf = Buffer.alloc(keep); let got = 0;
    return { data: (c) => { if (got < keep) { const n = Math.min(c.length, keep - got); c.copy(buf, got, 0, n); got += n; } }, end: () => out.set(id, { buf, size }) };
  });
  return out;
}
/** Tracked plus untracked-but-not-ignored paths (where atlas JSON and copy: stand-ins are found). */
function repoPaths(ctx) { return git(ctx, ["ls-files", "-co", "--exclude-standard", "-z"]).split("\0").filter(Boolean).map(nfc); }
function headCommit(ctx) {
  for (const k of ['GITHUB_SHA', 'CF_PAGES_COMMIT_SHA', 'WORKERS_CI_COMMIT_SHA', 'VERCEL_GIT_COMMIT_SHA']) if (ctx.env[k]) return ctx.env[k];
  const r = git(ctx, ['rev-parse', 'HEAD'], { allowFail: true }); return r.status === 0 ? r.stdout.trim() : null;
}

// ---------------------------------------------------------------------------------------------
// stores: content-addressed local folder (Dropbox) or S3-compatible bucket (R2)
// ---------------------------------------------------------------------------------------------
const objRel = (sha) => `objects/sha256/${sha.slice(0, 2)}/${sha}`;
/**
 * Copy a file without a link: an APFS clone on macOS (`cp -c` uses clonefile(2), so no data blocks are duplicated;
 * Node's COPYFILE_FICLONE does not clone on macOS), a reflink where Linux filesystems support one, else a plain copy.
 * Returns 'clone' or 'copy'.
 */
export function cloneFile(src, dst) {
  if (process.platform === 'darwin') {
    const r = spawnSync('/bin/cp', ['-c', '--', src, dst], { encoding: 'utf8' });
    if (r.status === 0) return 'clone';
    fs.rmSync(dst, { force: true }); // another volume, or not APFS: copy instead
  }
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
  return 'copy';
}
/** sha256 of a file, read in chunks (a download over 2 GiB never sits in memory). */
function sha256File(abs) {
  const h = crypto.createHash('sha256'), fd = fs.openSync(abs, 'r'), chunk = Buffer.alloc(1 << 20);
  try { for (let got; (got = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) h.update(chunk.subarray(0, got)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
class LocalStore {
  constructor(root) { this.root = root; this.label = root; this.kind = 'local'; }
  exists() { try { return fs.statSync(this.root).isDirectory(); } catch { return false; } }
  abs(rel) { return path.join(this.root, ...rel.split('/')); }
  async objectInfo(sha) { try { const st = fs.statSync(this.abs(objRel(sha))); return { bytes: st.size }; } catch { return null; } }
  async readObject(sha) { const b = readIf(this.abs(objRel(sha))); return b && sha256(b) === sha ? b : null; }
  /** Copy object `sha` to `tmpAbs` (a temp path the caller renames into place) and re-hash it in chunks. Throws on I/O errors. */
  async materialize(sha, tmpAbs) {
    const src = this.abs(objRel(sha)); if (!fs.existsSync(src)) return { ok: false };
    fs.mkdirSync(path.dirname(tmpAbs), { recursive: true }); fs.rmSync(tmpAbs, { force: true });
    const how = cloneFile(src, tmpAbs);
    if (sha256File(tmpAbs) !== sha) { const empty = fs.statSync(tmpAbs).size === 0; fs.rmSync(tmpAbs, { force: true }); return { ok: false, reason: empty ? 'stub' : 'hash' }; }
    return { ok: true, sha, how };
  }
  /** Store `buf` as an object (and its sidecar). Returns {sha, wrote}: wrote is false when the object was already there. */
  async writeObject(buf, sidecar) {
    const sha = sha256(buf), abs = this.abs(objRel(sha));
    let present = false; try { present = fs.statSync(abs).size === buf.length && sha256File(abs) === sha; } catch { /* absent */ }
    if (!present) writeAtomic(abs, buf);
    if (!fs.existsSync(`${abs}.json`)) writeAtomic(`${abs}.json`, `${JSON.stringify(sidecar)}\n`);
    return { sha, wrote: !present };
  }
  /** writeObject for a file on disk of any size (`sha` already computed), copied without reading it into memory. */
  async writeObjectFile(srcAbs, sha, size, sidecar) {
    const abs = this.abs(objRel(sha));
    let present = false; try { present = fs.statSync(abs).size === size && sha256File(abs) === sha; } catch { /* absent */ }
    if (!present) { const tmp = `${abs}.tmp-${process.pid}`; fs.mkdirSync(path.dirname(abs), { recursive: true }); cloneFile(srcAbs, tmp); fs.renameSync(tmp, abs); }
    if (!fs.existsSync(`${abs}.json`)) writeAtomic(`${abs}.json`, `${JSON.stringify(sidecar)}\n`);
    return { sha, wrote: !present };
  }
  async sidecars() {
    const out = [], dir = this.abs('objects/sha256');
    for (const f of walkFiles(dir)) if (f.endsWith('.json') && /\/[0-9a-f]{64}\.json$/.test(toPosix(f))) { try { out.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* ignore conflicted or partial copies */ } }
    return out;
  }
  async objectIds() { return walkFiles(this.abs('objects/sha256')).map((f) => path.basename(f)).filter((n) => /^[0-9a-f]{64}$/.test(n)); }
  async readText(rel) { const b = readIf(this.abs(rel)); return b ? b.toString('utf8') : null; }
  async writeFile(rel, buf) { writeAtomic(this.abs(rel), buf); }
  /** Copy a (possibly huge) local file into the store without reading it into memory. */
  async copyFileIn(rel, srcAbs) { const abs = this.abs(rel), tmp = `${abs}.tmp-${process.pid}`; fs.mkdirSync(path.dirname(abs), { recursive: true }); cloneFile(srcAbs, tmp); fs.renameSync(tmp, abs); return true; }
}

function rfc3986(s) { return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }
/** AWS Signature Version 4 (used for S3 and Cloudflare R2's S3 API). Returns the Authorization header and signed headers. */
export function sigV4({ method, host, canonicalPath, query = {}, headers = {}, payloadHash, region, service = 's3', accessKeyId, secretAccessKey, amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const h = { host, 'x-amz-date': amzDate };
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const names = Object.keys(h).sort(cmp);
  const canonicalQuery = Object.keys(query).sort(cmp).map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');
  const creq = [method, canonicalPath, canonicalQuery, names.map((n) => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(creq).digest('hex')].join('\n');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(sts).digest('hex');
  return { authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`, headers: h, canonicalQuery };
}
class S3Store {
  constructor(spec, env) {
    const m = spec.match(/^(s3|r2):\/\/([^/]+)\/?(.*)$/); if (!m) usageError(`bad store URL ${spec} (use s3://bucket/prefix or r2://bucket/prefix)`);
    this.kind = m[1]; this.bucket = m[2]; this.prefix = m[3].replace(/\/+$/, ''); this.label = `${m[1]}://${m[2]}/${this.prefix}`;
    const account = env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
    this.endpoint = (env.ASSETS_S3_ENDPOINT || (this.kind === 'r2' && account ? `https://${account}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, '');
    if (!this.endpoint) envError(`${this.label}: set ASSETS_S3_ENDPOINT${this.kind === 'r2' ? ' or R2_ACCOUNT_ID / CLOUDFLARE_ACCOUNT_ID' : ''}`);
    this.accessKeyId = env.ASSETS_S3_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
    this.secret = env.ASSETS_S3_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
    this.token = env.ASSETS_S3_SESSION_TOKEN || env.AWS_SESSION_TOKEN;
    if (!this.accessKeyId || !this.secret) envError(`${this.label}: set ASSETS_S3_ACCESS_KEY_ID and ASSETS_S3_SECRET_ACCESS_KEY (or R2_* / AWS_* equivalents) in the environment`);
    this.region = env.ASSETS_S3_REGION || (this.kind === 'r2' ? 'auto' : env.AWS_REGION || 'us-east-1');
    this.now = env.ASSETS_S3_DATE; // tests only
  }
  exists() { return true; }
  key(rel) { return this.prefix ? `${this.prefix}/${rel}` : rel; }
  async request(method, rel, { body, query = {} } = {}) {
    const url = new URL(this.endpoint), canonicalPath = `${url.pathname.replace(/\/+$/, '')}/${rfc3986(this.bucket)}${rel === null ? '' : `/${this.key(rel).split('/').map(rfc3986).join('/')}`}`;
    const payloadHash = crypto.createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex');
    const amzDate = this.now || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const extra = { 'x-amz-content-sha256': payloadHash, ...(this.token ? { 'x-amz-security-token': this.token } : {}) };
    const s = sigV4({ method, host: url.host, canonicalPath, query, headers: extra, payloadHash, region: this.region, accessKeyId: this.accessKeyId, secretAccessKey: this.secret, amzDate });
    const target = `${url.protocol}//${url.host}${canonicalPath}${s.canonicalQuery ? `?${s.canonicalQuery}` : ''}`;
    const headers = { ...s.headers, authorization: s.authorization }; delete headers.host;
    let res;
    try { res = await fetch(target, { method, headers, body, signal: AbortSignal.timeout(60000) }); } catch (e) { envError(`${this.label}: ${method} ${rel ?? ''} failed (${e.cause?.code ?? e.message})`); }
    return res;
  }
  async get(rel) { const r = await this.request('GET', rel); if (r.status === 404) return null; if (!r.ok) envError(`${this.label}: GET ${rel} returned HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
  async put(rel, buf) { const r = await this.request('PUT', rel, { body: buf }); if (!r.ok) envError(`${this.label}: PUT ${rel} returned HTTP ${r.status}`); }
  async list(relPrefix) {
    const keys = []; let token;
    do {
      const query = { 'list-type': '2', prefix: this.key(relPrefix), ...(token ? { 'continuation-token': token } : {}) };
      const r = await this.request('GET', null, { query }); if (!r.ok) envError(`${this.label}: list returned HTTP ${r.status}`);
      const xml = await r.text();
      for (const [, k] of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(k.replace(/&amp;/g, '&').slice(this.prefix ? this.prefix.length + 1 : 0));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)</)?.[1] : null;
    } while (token);
    return keys;
  }
  async objectInfo(sha) { return this.head(objRel(sha)); }
  async readObject(sha) { const b = await this.get(objRel(sha)); return b && sha256(b) === sha ? b : null; }
  async materialize(sha, tmpAbs) {
    const b = await this.get(objRel(sha)); if (!b) return { ok: false };
    if (sha256(b) !== sha) return { ok: false, reason: b.length ? 'hash' : 'stub' };
    fs.mkdirSync(path.dirname(tmpAbs), { recursive: true }); fs.writeFileSync(tmpAbs, b); return { ok: true, sha, how: 'download' };
  }
  async head(rel) { const r = await this.request('HEAD', rel); return r.ok ? { bytes: Number(r.headers.get('content-length') ?? -1) } : null; }
  async writeObject(buf, sidecar) {
    const sha = sha256(buf), present = !!(await this.head(objRel(sha)));
    if (!present) await this.put(objRel(sha), buf);
    if (!(await this.head(`${objRel(sha)}.json`))) await this.put(`${objRel(sha)}.json`, Buffer.from(`${JSON.stringify(sidecar)}\n`));
    return { sha, wrote: !present };
  }
  /** One PUT holds the whole body, so a file over 1 GiB is not uploaded ({skipped}; the caller warns). */
  async writeObjectFile(srcAbs, sha, size, sidecar) {
    if (await this.head(objRel(sha))) return { sha, wrote: false };
    if (size > 1 << 30) return { sha, wrote: false, skipped: `over 1 GiB, too large for one upload to ${this.label}` };
    return this.writeObject(fs.readFileSync(srcAbs), sidecar);
  }
  async sidecars() { const out = []; for (const k of await this.list('objects/sha256/')) if (k.endsWith('.json')) { const b = await this.get(k); try { out.push(JSON.parse(b.toString('utf8'))); } catch { /* skip */ } } return out; }
  async objectIds() { return (await this.list('objects/sha256/')).map((k) => k.split('/').pop()).filter((n) => /^[0-9a-f]{64}$/.test(n)); }
  async readText(rel) { const b = await this.get(rel); return b ? b.toString('utf8') : null; }
  async writeFile(rel, buf) { await this.put(rel, buf); }
  /** One PUT holds the whole body, so files over 1 GiB are not uploaded (returns false; the caller warns). */
  async copyFileIn(rel, srcAbs) { if (fs.statSync(srcAbs).size > 1 << 30) return false; await this.put(rel, fs.readFileSync(srcAbs)); return true; }
}
/**
 * Why a local store folder may not be used, or null. A store inside a git work tree would put its pack records (price,
 * order id, raw download URLs, local paths) and copies of paid license files at committable paths.
 */
function storeLocationProblem(ctx, absStore) {
  let probe = absStore; while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  try { if (!fs.statSync(probe).isDirectory()) probe = path.dirname(probe); } catch { return null; }
  let real, rootReal = null; try { real = fs.realpathSync(probe); } catch { return null; }
  try { rootReal = fs.realpathSync(ctx.root); } catch { /* no repo root */ }
  if (rootReal && (real === rootReal || real.startsWith(rootReal + path.sep))) return `it is inside this repository (${ctx.root})`;
  const env = Object.fromEntries(Object.entries(ctx.env ?? {}).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|CEILING_DIRECTORIES)$/.test(k)));
  const r = spawnSync('git', ['-C', probe, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env });
  if (r.status === 0 && r.stdout.trim()) return `it is inside the git work tree ${r.stdout.trim()}`;
  return null;
}
function checkedLocalStore(ctx, abs) {
  const why = storeLocationProblem(ctx, abs);
  if (why) envError(`private store ${abs} refused: ${why}. A store's pack records (prices, order ids, download URLs) and copies of paid license files must never sit at a committable path. Keep it outside every git repository, e.g. ${defaultStorePath(ctx)}, and point PRIVATE_ASSET_STORE (or --store) there.`);
  return new LocalStore(abs);
}
function openStore(spec, ctx) { return /^(s3|r2):\/\//.test(spec) ? new S3Store(spec, ctx.env) : checkedLocalStore(ctx, path.resolve(ctx.cwd, spec)); }
const homeOf = (ctx) => ctx.env.HOME || os.homedir();
const defaultStorePath = (ctx) => path.join(homeOf(ctx), 'SongADAO Dropbox', 'Jonathan Mann', 'private-asset-store');
/** The configured store: --store / $PRIVATE_ASSET_STORE, else the Dropbox store if it exists. Only writers create an explicit local store. */
function findStore(ctx, opts = {}, { create = false } = {}) {
  const spec = opts.store || ctx.env.PRIVATE_ASSET_STORE;
  if (spec) { const s = openStore(spec, ctx); if (s.kind === 'local' && !s.exists()) { if (!create) return null; fs.mkdirSync(s.root, { recursive: true }); } return s; }
  const d = new LocalStore(defaultStorePath(ctx)); return d.exists() ? checkedLocalStore(ctx, d.root) : null;
}
async function readPackRecord(store, id) { const t = store && (await store.readText(`packs/${id}/pack.json`)); try { return t ? JSON.parse(t) : null; } catch { return null; } }

// ---------------------------------------------------------------------------------------------
// Dropbox and download metadata (macOS)
// ---------------------------------------------------------------------------------------------
function dropboxRoots(ctx) {
  const roots = (ctx.env.ASSETS_DROPBOX_ROOTS ?? '').split(path.delimiter).filter(Boolean);
  try { const info = JSON.parse(fs.readFileSync(path.join(homeOf(ctx), '.dropbox', 'info.json'), 'utf8')); for (const v of Object.values(info)) if (v?.path) roots.push(v.path); } catch { /* no Dropbox */ }
  return roots.map((r) => path.resolve(r));
}
function insideDropbox(abs, roots) {
  if (roots.length) return roots.some((r) => abs.startsWith(r + path.sep));
  return abs.split(path.sep).some((seg) => seg === 'Dropbox' || / Dropbox$/.test(seg));
}
function markDropboxIgnored(ctx, absFiles) {
  if (!absFiles.length) return;
  const roots = dropboxRoots(ctx), targets = absFiles.filter((f) => insideDropbox(f, roots));
  for (let i = 0; i < targets.length; i += 200) {
    const batch = targets.slice(i, i + 200);
    const r = process.platform === 'darwin' ? spawnSync('xattr', ['-w', 'com.dropbox.ignored', '1', ...batch], { encoding: 'utf8' })
      : spawnSync('setfattr', ['-n', 'user.com.dropbox.ignored', '-v', '1', ...batch], { encoding: 'utf8' });
    if (r.error || r.status !== 0) { ctx.warn(`could not mark ${batch.length} file(s) as Dropbox-ignored (${r.error?.code ?? String(r.stderr).trim().split('\n')[0]})`); break; }
  }
}
/**
 * Clean kMDItemWhereFroms ([file URL, referring page]) into a store page URL, or null (then add stops and asks Jonathan).
 * Only the referring page counts, never the file URL itself; it must be a known store with an item path (an origin-only
 * page, a file-sharing or attachment link, or an unknown host gives null). Query and fragment are dropped, and itch
 * /download/<key> and /purchase… suffixes are stripped. It never guesses.
 */
export function cleanWhereFroms(list) {
  const candidates = (list ?? []).filter((x) => typeof x === 'string' && x);
  if (candidates.length < 2) return null; // no referring page: the only URL is the file itself (a CDN link or an attachment)
  let u; try { u = new URL(candidates[candidates.length - 1]); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || STORAGE_HOST_RE.test(u.hostname)) return null;
  u.search = ''; u.hash = ''; u.username = ''; u.password = '';
  if (ITCH_HOST_RE.test(u.hostname)) { if (/\/(download|purchase)(\/|$)/.test(u.pathname) && /^itch\.io$/i.test(u.hostname)) return null; u.pathname = u.pathname.replace(/\/(download|purchase)(\/.*)?$/, ''); }
  if (u.pathname === '' || u.pathname === '/') return null;
  if (!STORE_PAGES.some(([host, item]) => host.test(u.hostname) && item.test(u.pathname))) return null;
  return u.toString().replace(/\/$/, '');
}
function readWhereFroms(abs) {
  if (process.platform !== 'darwin') return [];
  const md = spawnSync('mdls', ['-raw', '-name', 'kMDItemWhereFroms', abs], { encoding: 'utf8' });
  const urls = md.status === 0 ? [...md.stdout.matchAll(/"((?:https?|ftp):[^"]+)"/g)].map((x) => x[1]) : [];
  if (urls.length) return urls;
  const hex = spawnSync('xattr', ['-px', 'com.apple.metadata:kMDItemWhereFroms', abs], { encoding: 'utf8' });
  if (hex.status !== 0) return [];
  const tmp = path.join(os.tmpdir(), `assets-wherefroms-${process.pid}.plist`);
  try {
    fs.writeFileSync(tmp, Buffer.from(hex.stdout.replace(/\s+/g, ''), 'hex'));
    const j = spawnSync('plutil', ['-convert', 'json', '-o', '-', tmp], { encoding: 'utf8' });
    const v = j.status === 0 ? JSON.parse(j.stdout) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; } finally { fs.rmSync(tmp, { force: true }); }
}

// ---------------------------------------------------------------------------------------------
// context, args, output
// ---------------------------------------------------------------------------------------------
const GLOBAL_BOOL = ['quiet', 'json', 'help'], GLOBAL_VALUE = ['root', 'manifest'];
const COMMANDS = {
  init: { value: ['mode', 'project', 'public-repo', 'public-dir', 'out'] },
  vendor: { bool: ['check'] },
  sync: { bool: ['require', 'placeholders', 'trust-store'], value: ['only', 'store'] },
  check: { bool: ['staged', 'strict'] },
  add: { bool: ['paid', 'free', 'no-snapshot', 'confirm-real'], value: ['pack', 'section', 'title', 'author', 'url', 'license', 'terms', 'price', 'acquired', 'download', 'why', 'decision', 'decided-by', 'review-by', 'replacement', 'restrict', 'credit', 'placeholder', 'ship', 'store'] },
  update: { bool: ['drop', 'delete', 'public', 'confirm-real'], value: ['placeholder', 'ship', 'store'] },
  release: { value: ['to-section'] },
  forbid: { bool: ['from-history', 'blobs-only', 'include-current'], value: ['why'] },
  docs: { bool: ['check'], value: ['credits'] },
  export: { bool: ['dry-run'], value: ['out'] },
  'verify-build': { bool: ['require-real', 'when-required'] },
  run: { value: ['needs'], rest: true },
  status: { bool: ['remote'], value: ['restriction', 'store'] },
  scan: { bool: ['record', 'store'], value: ['pack'], passthrough: true },
  import: {},
  store: { value: ['store'] },
  leakscan: { bool: ['store'], multi: ['extra'] },
  help: {},
};
function parseArgs(argv) {
  const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const spec = COMMANDS[cmd]; if (!spec) usageError(`unknown command "${cmd}" (run: node scripts/assets.mjs help)`);
  const bools = new Set([...GLOBAL_BOOL, ...(spec.bool ?? [])]), values = new Set([...GLOBAL_VALUE, ...(spec.value ?? [])]), multi = new Set(spec.multi ?? []);
  const opts = { _: [], rest: [] }, rest = argv.slice(argv[0] === cmd ? 1 : 0);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { opts.rest = rest.slice(i + 1); break; }
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    let [name, inline] = a.slice(2).split(/=(.*)/s);
    if (bools.has(name)) { opts[name] = true; continue; }
    if (multi.has(name)) {
      opts[name] ??= [];
      if (inline !== undefined) opts[name].push(inline); else while (rest[i + 1] && !rest[i + 1].startsWith('--')) opts[name].push(rest[++i]);
      continue;
    }
    if (!values.has(name)) { if (spec.passthrough && (COMMANDS.add.bool.includes(name) || COMMANDS.add.value.includes(name))) { if (COMMANDS.add.bool.includes(name)) opts[name] = true; else opts[name] = inline ?? rest[++i]; continue; } usageError(`unknown flag --${name} for ${cmd}`); }
    const v = inline ?? rest[++i]; if (v === undefined) usageError(`--${name} needs a value`);
    opts[name] = v;
  }
  return { cmd, opts };
}
function makeCtx(opts, { env = process.env, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const ctx = { env, cwd, quiet: !!opts.quiet, json: !!opts.json, manifestRel: opts.manifest ?? DEFAULT_MANIFEST };
  ctx.log = (s) => { if (!ctx.quiet && !ctx.json) stdout.write(`${s}\n`); };
  ctx.print = (s) => stdout.write(`${s}\n`);
  ctx.warn = (s) => { if (!ctx.json) stderr.write(`warning: ${s}\n`); };
  ctx.error = (s) => stderr.write(`${s}\n`);
  if (opts.root) ctx.root = path.resolve(cwd, opts.root);
  else {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', env });
    if (r.error) envError('git is not available');
    if (r.status !== 0) envError(`not inside a git repository: ${cwd} (use --root <dir>)`);
    ctx.root = r.stdout.trim();
  }
  return ctx;
}
/**
 * Load private-assets.json. Every command but `check` and `docs --check` refuses an invalid manifest (validate).
 * fromIndex: the staged copy (check --staged), which is what the commit will carry.
 */
function loadManifest(ctx, { required = true, validate = true, fromIndex = false } = {}) {
  const abs = path.join(ctx.root, ctx.manifestRel);
  let text;
  if (fromIndex) {
    const r = git(ctx, ['cat-file', 'blob', `:${ctx.manifestRel}`], { allowFail: true });
    if (r.status !== 0) {
      if (fs.existsSync(abs)) problem(`${ctx.manifestRel} is not staged, so this commit would not carry it (and CI would check the files it lists against nothing). Stage it: git add ${shq(ctx.manifestRel)}`);
      if (!required) return null; envError(`${ctx.manifestRel} not found in ${ctx.root}. Run: node scripts/assets.mjs init --mode overlay --project <owner/name>`);
    }
    text = r.stdout;
  } else {
    if (!fs.existsSync(abs)) { if (!required) return null; envError(`${ctx.manifestRel} not found in ${ctx.root}. Run: node scripts/assets.mjs init --mode overlay --project <owner/name>`); }
    text = fs.readFileSync(abs, 'utf8');
  }
  let m;
  try { m = JSON.parse(text); } catch (e) { envError(`${ctx.manifestRel} is not valid JSON: ${e.message}`); }
  if (typeof m !== 'object' || m === null) envError(`${ctx.manifestRel} is not a JSON object`);
  if (typeof m.schema === 'number' && m.schema > 1) envError(`${ctx.manifestRel} uses schema ${m.schema}; this assets.mjs ${VERSION} understands schema 1. Update scripts/assets.mjs from the kit (node <kit>/tools/assets/assets.mjs vendor).`);
  if (typeof m.tool === 'string' && SEMVER_RE.test(m.tool) && semverCmp(m.tool, VERSION) > 0) envError(`${ctx.manifestRel} needs assets.mjs ${m.tool} or newer; this is ${VERSION}. Update scripts/assets.mjs from the kit (node <kit>/tools/assets/assets.mjs vendor).`);
  normalizeManifest(m);
  if (validate) {
    const { errors } = validateManifest(m, { today: todayOf(ctx.env) });
    if (errors.length) problem(`${ctx.manifestRel} is invalid, so nothing was done (${plural(errors.length, 'error')}):\n${errors.slice(0, 12).map((e) => `  ${e.msg}`).join('\n')}${errors.length > 12 ? `\n  ... ${errors.length - 12} more` : ''}\nFix the file (node scripts/assets.mjs check lists everything), then run this again.`);
  }
  return { m, text, sha: sha256(Buffer.from(text)) };
}
/** Defaults, and every path in NFC (manifest keys and globs), so NFD names from old zips compare and ignore correctly. */
function normalizeManifest(m) {
  if (m.packs === undefined || m.packs === null) m.packs = {};
  if (m.files === undefined || m.files === null) m.files = {};
  if (m.files && typeof m.files === 'object' && !Array.isArray(m.files)) m.files = Object.fromEntries(Object.entries(m.files).map(([k, v]) => [nfc(k), v]));
  for (const g of Array.isArray(m.privateGlobs) ? m.privateGlobs : []) if (typeof g?.glob === 'string') g.glob = nfc(g.glob);
  if (Array.isArray(m.exclude)) m.exclude = m.exclude.map((g) => (typeof g === 'string' ? nfc(g) : g));
  if (Array.isArray(m.forbidden?.paths)) m.forbidden.paths = m.forbidden.paths.map((g) => (typeof g === 'string' ? nfc(g) : g));
  return m;
}
function saveManifest(ctx, m) { writeIfChanged(path.join(ctx.root, ctx.manifestRel), serializeManifest(m)); }
const publicDirOf = (m) => ((m.build?.publicDir ?? 'public').replace(/\/+$/, '') || '.');
const outDirOf = (m) => (m.build?.out ?? 'dist').replace(/\/+$/, '');
const stampRelOf = (m) => (publicDirOf(m) === '.' ? STAMP_NAME : `${publicDirOf(m)}/${STAMP_NAME}`);
function requiresReal(env) {
  if (env.ASSETS_REQUIRE === 'real') return true;
  if (env.ASSETS_REQUIRE === 'none') return false;
  return env.CF_PAGES === '1' || env.VERCEL === '1' || env.WORKERS_CI === '1';
}
function refuseInPublishedMirror(m, what) { if (m.mode === 'published-mirror') usageError(`${what} refuses to run in a published mirror: make this change in ${m.project}`); }
function kitRoot(ctx) {
  if (ctx.env.ASSETS_KIT) return path.resolve(ctx.env.ASSETS_KIT);
  const self = fileURLToPath(import.meta.url);
  if (toPosix(self).endsWith('/tools/assets/assets.mjs')) return path.resolve(path.dirname(self), '..', '..');
  return path.join(homeOf(ctx), 'SongADAO Dropbox', 'Jonathan Mann', 'projects', 'open-source-kit');
}
function versionOfFile(abs) { const head = readHead(abs, 300); const m = head && head.toString('utf8').match(/\/\/ assets\.mjs (\d+\.\d+\.\d+)/); return m ? m[1] : null; }

const isGeneratedCredits = (text) => { try { return /assets\.mjs/.test(JSON.parse(text)?.generatedBy ?? ''); } catch { return false; } };
/**
 * Generated outputs (ASSETS.md block, credits.json, .gitignore block) as {rel: expectedText | null} given current file
 * contents. null means "must not exist": a credits.json this tool generated, after the last credit left the manifest.
 */
function expectedOutputs(m, hasSrc, current) {
  const out = {};
  const md = current('ASSETS.md');
  out['ASSETS.md'] = upsertMdBlock(md ?? '# Assets\n\nThe code in this repository is covered by [LICENSE](LICENSE). This file covers everything that is not code.\n\n## 1. Ours: included and open\n\n## 2. Free third-party: included under their own licenses\n', renderAssetsBlock(m));
  const credits = renderCredits(m), cRel = creditsRel(m, hasSrc);
  if (credits) out[cRel] = credits;
  else { const cur = current(cRel); if (cur !== null && cur !== undefined && isGeneratedCredits(cur)) out[cRel] = null; }
  out['.gitignore'] = upsertIgnoreBlock(current('.gitignore') ?? '', renderIgnoreBlock(m));
  return out;
}

// A store object (or its sidecar) at a repo path: group 1 is the store folder.
const STORE_OBJECT_RE = /^(|.*\/)objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}(\.json)?$/;
function isStorePackRecord(buf) { try { const j = JSON.parse(buf.toString('utf8')); return !!j && typeof j === 'object' && Array.isArray(j.repos) && 'public' in j; } catch { return false; } }

// ---------------------------------------------------------------------------------------------
// the guard: shared by `check` (git index) and `export` (in-memory exported tree)
// ---------------------------------------------------------------------------------------------
/**
 * @param m manifest
 * @param tree Map path -> {blob, mode, read(n): Buffer|null, full(): Buffer|null, target?}: the git index (check) or the exported tree.
 * @param pending Map path -> same + {how: 'untracked'|'worktree'}: what `git add -A` would add on top of the index.
 * @param read(rel): Buffer|null for the control files (ASSETS.md, .gitignore, credits, atlas JSON): the working tree, or
 *   with --staged the index, so a pre-commit check sees what the commit will hold.
 * @param worktree(rel): a diskFile of a listed file's working-tree bytes (dev mirror rules), or null with --staged.
 * publicTree: true for overlay / published-mirror rules. staged: Set of paths to limit per-file rules to.
 * exporting: the tree is about to be published (export), so symlinks that point outside it fail instead of warning.
 */
function runGuard(m, { tree, pending = new Map(), read, worktree = null, hasSrc, publicTree, staged = null, today, manifestText, checkDocs = true, strict = false, exporting = false }) {
  const problems = [], warnings = [], seen = new Set();
  const P = (rule, msg, fix, p) => { const k = `${rule}\0${p ?? msg}`; if (seen.has(k)) return; seen.add(k); problems.push({ rule, path: p, msg, fix }); };
  const { errors, warnings: mw } = validateManifest(m, { today });
  problems.push(...errors); warnings.push(...mw);
  if (manifestText !== undefined && manifestText !== serializeManifest(m)) warnings.push({ rule: 'canonical', msg: 'private-assets.json is not in canonical form (run any writing command, e.g. `node scripts/assets.mjs docs`)' });
  const files = (m.files && typeof m.files === 'object') ? m.files : {}, listed = new Set(Object.keys(files)), devMirror = m.mode === 'mirror' && !publicTree;
  const blobToListed = new Map(), pixelToListed = new Map();
  for (const [p, e] of Object.entries(files)) {
    if (e?.blob && e.blob !== EMPTY_BLOB && !blobToListed.has(e.blob)) blobToListed.set(e.blob, p);
    if (e?.pixel && !pixelToListed.has(e.pixel)) pixelToListed.set(e.pixel, p);
  }
  const forbidden = compile(m.forbidden?.paths), forbiddenBlobs = m.forbidden?.blobs ?? {}, privGlobs = compile((m.privateGlobs ?? []).map((g) => g.glob)), excluded = compile(m.exclude);
  const known = new Set(tree.keys());
  let stampRel = null; try { stampRel = stampRelOf(m).toLowerCase(); } catch { /* an invalid build field: reported by validateManifest */ }
  // Re-rendering a placeholder reads its atlas JSON: from the tree (the index or the export), else through `read`.
  const guardIo = { knownPaths: () => known, read: (rel) => { const t = tree.get(rel); return t?.full?.() ?? t?.read?.(4_000_000) ?? read(rel); } };
  /** Is `buf` at private path p this tool's placeholder, marker stripped or not (listed: its entry; globbed: its glob's spec)? */
  const ownPh = (p, buf, isListed) => {
    if (!buf) return false;
    if (isListed) { const e = files[p]; let spec = null; try { spec = resolvePlaceholder(e, m.packs[e.pack], p); } catch { /* reported elsewhere */ } return isOwnPlaceholder(buf, spec, p, e, guardIo); }
    const g = globbedPaths(m, [p])[0]?.g; if (!g) return false;
    const entry = dimsEntry(buf); return isOwnPlaceholder(buf, globSpecOf(m, g, p, entry), p, entry, guardIo);
  };
  /** A symlink whose target is absolute or leaves the repository: committed, it points nowhere for anyone else. */
  const symlinkRule = (p, t, how, tag) => {
    const target = t.target ?? t.read?.(4096)?.toString('utf8') ?? null; if (target === null) return;
    let why = null;
    if (/^([\\/]|[A-Za-z]:)/.test(target)) why = 'an absolute path';
    else { const r = path.posix.normalize(path.posix.join(path.posix.dirname(p), target)); if (r === '..' || r.startsWith('../')) why = 'a path outside the repository'; }
    if (!why) return;
    const msg = `${p} is a symlink to ${why} (${JSON.stringify(target)})${tag}: committed, it points nowhere in any other checkout or in a public copy, and an absolute target names a folder on this machine`;
    const fix = how === 'untracked' ? `add it to .gitignore (a worktree's node_modules link: write \`node_modules\` without the trailing slash, which also matches a symlink)` : `git rm --cached ${shq(p)}`;
    if (strict || exporting) P('symlink', msg, fix, p); else warnings.push({ rule: 'symlink', path: p, msg: `${msg}. Fix: ${fix} (check --strict fails on this)` });
  };
  // atlas references
  for (const [p, e] of Object.entries(files)) {
    let spec; try { spec = resolvePlaceholder(e, m.packs[e.pack], p); } catch { continue; }
    if (spec.kind === 'atlas-frame') try { resolveAtlas(expandDirName(spec.atlas, p), known); } catch (err) { P('atlas', `${p}: ${err.message}`, 'fix the placeholder "atlas" path or glob in private-assets.json', p); }
    if (spec.kind === 'copy' && !known.has(spec.path)) P('copy', `${p}: copy: stand-in ${spec.path} is not tracked`, `commit ${spec.path} (a CC0 stand-in)`, p);
  }
  if (devMirror) for (const g of m.privateGlobs ?? []) {
    let spec = null; try { spec = g.placeholder ? parsePlaceholder(g.placeholder) : null; } catch { /* reported by validateManifest */ }
    if (!spec || spec.kind !== 'atlas-texture') continue;
    const re = globToRegExp(g.glob);
    for (const p of known) if (re.test(p)) try { resolveAtlas(expandDirName(spec.atlas, p), known); } catch (err) { P('atlas', `${p}: ${err.message}`, 'fix privateGlobs[].placeholder.atlas', p); }
  }
  // generated blocks
  let exp = null;
  if (checkDocs) try { exp = expectedOutputs(m, hasSrc, (rel) => read(rel)?.toString('utf8') ?? null); } catch (err) { P('docs', `the generated ASSETS.md block, credits and .gitignore block could not be checked (${err.message}); fix the manifest errors first`); }
  if (exp) {
    for (const [rel, text] of Object.entries(exp)) {
      if (text === null) { P('docs', `${rel} is a stale generated credits file: no pack or credit needs it any more`, 'node scripts/assets.mjs docs  (deletes it)'); continue; }
      if (rel === '.gitignore') { const cur = read(rel)?.toString('utf8') ?? ''; if (cur !== text) P('gitignore', `.gitignore ${cur.includes(IGNORE_BEGIN.slice(0, 16)) ? 'assets.mjs block is stale' : 'has no assets.mjs block'}`, 'node scripts/assets.mjs docs'); continue; }
      const cur = read(rel)?.toString('utf8');
      const stray = rel === 'ASSETS.md' && cur ? strayMdSections(cur) : [];
      if (cur === undefined || cur === null) P('docs', `${rel} is missing`, 'node scripts/assets.mjs docs');
      else if (stray.length) P('docs', `ASSETS.md has hand-written §3/§4 sections outside the generated block (${strayNote(stray)}), so it shows two contradicting section 3s or 4s`, 'move anything worth keeping into private-assets.json (title, terms, why; via add), then: node scripts/assets.mjs docs  (puts the generated block in their place)');
      else if (cur !== text) P('docs', `${rel} ${rel === 'ASSETS.md' && !cur.includes(MD_END) ? 'has no generated §3/§4 block' : 'generated content is stale'}`, 'node scripts/assets.mjs docs');
    }
  }
  const cov = coverage(read('ASSETS.md')?.toString('utf8') ?? '');
  for (const t of cov.ignored) warnings.push({ rule: 'coverage', msg: `ASSETS.md row \`${t}\` is a catch-all and covers nothing; name a folder, file, or glob` });
  // A §1/§2 row that also matches private files would pass any later file from the same pack at such a path.
  const privatePaths = [...new Set([...listed, ...[...known].filter((p) => matchesAny(privGlobs, p))])].sort(cmp);
  for (const r of cov.rows) {
    const hits = privatePaths.filter((p) => cov.hit(r, p)); if (!hits.length) continue;
    P('coverage', `ASSETS.md §1/§2 row \`${r.token}\` also covers ${plural(hits.length, 'private file')} (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''}), so a new file from those packs at such a path would pass as public`, `narrow the row to exact paths or brace globs that name only public files, e.g. \`${path.posix.dirname(hits[0])}/{a,b}.png\``);
  }
  // Folder and wildcard rows accept files nobody has looked at: copy detection knows only exact bytes and PNG pixels.
  const allPaths = [...new Set([...known, ...pending.keys()])].sort(cmp);
  if (!staged || strict) for (const r of cov.rows) {
    if (!r.token.endsWith('/') && !/[*?]/.test(r.token)) continue; // full paths and brace lists name exact files
    const hits = allPaths.filter((p) => isMedia(p) && !listed.has(p) && cov.hit(r, p)); if (!hits.length) continue;
    const msg = `ASSETS.md §${r.section} row \`${r.token}\` is a ${r.token.endsWith('/') ? 'folder' : 'wildcard'} row: a file added under it later passes check unseen, because check recognises licensed files only by their exact bytes or, for PNGs, their pixels (a transcoded sound, a WebP conversion, or an edited sprite would pass)`;
    const fix = `name the ${plural(hits.length, 'file')} it covers now instead: ${describePaths(hits)}`;
    if (strict) P('open-row', msg, fix); else warnings.push({ rule: 'open-row', msg: `${msg}. ${fix[0].toUpperCase()}${fix.slice(1)}` });
  }
  // case collisions (macOS vs Linux), of whole paths and of folders: on a Mac \`Docs\` (a symlink) and \`docs/a.md\` are
  // one name, so a checkout or an export would write a.md through the symlink.
  const lower = new Map(), dirSpell = new Map(), allNames = new Set([...listed, ...known, ...pending.keys()]);
  const fold = (x) => x.normalize('NFC').toLowerCase();
  for (const p of allNames) {
    const k = fold(p); if (!lower.has(k)) lower.set(k, new Set()); lower.get(k).add(p);
    const segs = p.split('/');
    for (let i = 1; i < segs.length; i++) { const d = segs.slice(0, i).join('/'), dk = fold(d); if (!dirSpell.has(dk)) dirSpell.set(dk, new Set()); dirSpell.get(dk).add(d); }
  }
  for (const set of lower.values()) if (set.size > 1) P('case', `paths differ only by case: ${[...set].join(' | ')}`, 'rename one of them; Linux CI treats them as different files');
  for (const [dk, set] of dirSpell) {
    if (set.size > 1) P('case', `folders differ only by case: ${[...set].join(' | ')}`, 'rename one of them; on a Mac they are the same folder');
    const asFile = lower.get(dk);
    if (asFile) P('case', `${[...asFile][0]} is a file${tree.get([...asFile][0])?.mode === '120000' ? ' (a symlink)' : ''}, but ignoring case it is also the folder ${[...set][0]}/ of other files, so a Mac would write those files through it`, 'rename one of them');
  }
  // per-file rules, for the index (or exported tree) and for what `git add -A` would add
  const TAG = { untracked: ' (untracked: `git add -A` would commit it)', worktree: ' (changed in the working tree but not staged: `git add -A` would commit it)' };
  const perFile = (p, t, how) => {
    const tag = how ? TAG[how] : '', rmFix = how === 'untracked' ? `rm ${shq(p)}  (or add it to .gitignore)` : `git rm --cached ${shq(p)}`;
    if (stampRel && p.toLowerCase() === stampRel) return P('stamp', `${p} is the build stamp sync writes${how === 'untracked' ? ', and .gitignore does not ignore it' : ', and git tracks it'}${tag}: a committed stamp goes stale (it may say "real" for other files), and sync never writes a tracked path`, how === 'untracked' ? 'node scripts/assets.mjs docs  (the generated .gitignore block ignores it)' : `git rm --cached ${shq(p)}`, p);
    const tmpOf = p.match(/^(.+)\.tmp-\d+$/)?.[1];
    if (tmpOf && (listed.has(tmpOf) || matchesAny(privGlobs, tmpOf))) return P('tmp', `${p} is a leftover temporary copy of the licensed ${tmpOf} (an interrupted sync)${tag}`, how === 'untracked' ? `rm ${shq(p)}` : `git rm --cached ${shq(p)} && rm ${shq(p)}`, p);
    const storeAt = p.match(STORE_OBJECT_RE)?.[1] ?? (/(^|\/)packs\/[a-z0-9]+(-[a-z0-9]+)*\/pack\.json$/.test(p) && isStorePackRecord(t.read(65536)) ? p.replace(/packs\/[^/]+\/pack\.json$/, '') : null);
    if (storeAt !== null && storeAt !== undefined) return P('store', `${p} belongs to a private asset store inside the repository${tag}`, `move the store folder ${shq(storeAt || './')} out of the repository (a store must live outside every git repository), point PRIVATE_ASSET_STORE at its new place, and never commit it`, p);
    if (matchesAny(forbidden, p)) return P('forbidden', `${p} is forbidden (forbidden.paths)${tag}`, how === 'untracked' ? rmFix : `git rm --cached ${shq(p)} && rm ${shq(p)}`, p);
    if (t.blob && forbiddenBlobs[t.blob]) return P('forbidden', `${p} has forbidden blob ${t.blob.slice(0, 12)} (${forbiddenBlobs[t.blob]})${tag}`, rmFix, p);
    const isListed = listed.has(p), isGlobbed = matchesAny(privGlobs, p);
    if ((isListed || isGlobbed) && !devMirror) {
      if (how === 'untracked') return P('ignore', `${p} is ${isListed ? 'listed in private-assets.json' : 'matched by privateGlobs'} but .gitignore does not ignore it${tag}`, 'node scripts/assets.mjs docs  (regenerates the .gitignore block)', p);
      return P('tracked', `${p} ${isListed ? 'is listed in private-assets.json' : 'matches a privateGlobs entry'} but tracked by git${tag}`, `git rm --cached ${shq(p)}`, p);
    }
    if (t.mode === '120000') return symlinkRule(p, t, how, tag);
    if (t.mode === '160000') return;
    const copyFix = (src) => (m.mode === 'published-mirror' ? `remove it: ${rmFix}` : `list it: node scripts/assets.mjs add ${shq(p)} --pack ${files[src].pack}  (or remove it: ${rmFix})`);
    if (!isListed && !isGlobbed && t.blob && blobToListed.has(t.blob)) { const src = blobToListed.get(t.blob); return P('copy', `${p} is a copy of private ${src}${tag}`, copyFix(src), p); }
    const media = isMedia(p);
    let head; const getHead = () => (head ??= t.read(8192) ?? Buffer.alloc(0));
    const binary = !media && !isLockfile(p) && isBinaryHead(getHead());
    if ((media || binary || isListed || isGlobbed) && isPlaceholder(getHead())) return P('placeholder', `${p} is a generated placeholder, and placeholders are never content${tag}`, devMirror && (isListed || isGlobbed) ? `a placeholder replaced licensed art: git checkout <good ref> -- ${shq(p)} (or put the real file back)` : rmFix, p);
    if (devMirror && (isListed || isGlobbed)) {
      // A placeholder whose marker an optimizer stripped (WAMP's optimize_png_assets.mjs keeps only colour chunks), here
      // or committed. A listed file is re-rendered only when its bytes differ from the record; a generated (privateGlobs)
      // file has no record, so it always is (WAMP: 11 small atlases).
      if ((isGlobbed || t.blob !== files[p]?.blob) && ownPh(p, t.full(), isListed)) return P('placeholder', `${p} is ${isListed ? 'a placeholder' : 'a placeholder of a generated (privateGlobs) file'} with its marker stripped, not the ${isListed ? 'licensed' : 'generated'} art${tag}`, how === 'worktree' ? `git restore ${shq(p)}  (or put the real file back)` : `put the real file back: git checkout <good ref> -- ${shq(p)}`, p);
      return;
    }
    if (extOf(p) === 'png' && pixelToListed.size) {
      const whole = t.full();
      if (!whole) warnings.push({ rule: 'pixel', path: p, msg: `${p} is larger than ${PNG_FULL_MAX >> 20} MB, so it was not compared with the private PNGs by pixels` });
      else {
        const px = pixelFacts(whole);
        if (!px && whole.subarray(0, 8).equals(PNG_SIG)) return P('undecodable', `${p} is a PNG this tool cannot decode, so it cannot be compared with the private PNGs by pixels${tag}`, `re-save it as a standard PNG (or remove it: ${rmFix})`, p);
        if (px && !px.uniform && pixelToListed.has(px.hash)) { const src = pixelToListed.get(px.hash); return P('copy', `${p} is a copy of private ${src} (same pixels, different bytes)${tag}`, copyFix(src), p); }
      }
    }
    if ((media || binary) && !cov.covers(p) && !(devMirror && matchesAny(excluded, p))) {
      return P('unclassified', `${p} is ${media ? 'media' : 'a binary file'} that is neither listed in private-assets.json nor covered by an ASSETS.md §1/§2 row${tag}`, `add a §1/§2 row naming it (its full path, \`./${p}\` for a file at the repo root, or a brace glob such as \`dir/{a,b}.png\`), or: node scripts/assets.mjs add ${shq(p)} --pack <id> --section 3 --title "…" --author "…" --url <store page> --license "…" --terms "…" --paid|--free --acquired YYYY-MM-DD${how === 'untracked' ? ', or add it to .gitignore' : ''}`, p);
    }
    if (publicTree && !media) {
      if (isSecretFileName(p)) return P('secret', `${p} is a secret-type file${tag}`, how === 'untracked' ? `add it to .gitignore; keep secrets in .env/.dev.vars, never in git` : `git rm --cached ${shq(p)}; keep it in .env/.dev.vars and rotate anything it held`, p);
      if (isLockfile(p) || binary) return;
      const buf = t.read(2_000_000);
      if (buf && !isBinaryHead(buf) && SECRET_RE.test(buf.toString('latin1'))) P('secret', `${p} looks like it contains a secret (value not shown)${tag}`, 'move it to .env/.dev.vars, rotate it, and remove it from the file', p);
    }
  };
  for (const [p, t] of tree) if (!staged || staged.has(p)) perFile(p, t, null);
  for (const [p, t] of pending) if (!(devMirror && listed.has(p))) perFile(p, t, t.how);
  // mirror (dev) rules on listed files
  if (devMirror) {
    const lowerKnown = new Map([...known].map((k) => [k.toLowerCase(), k])), blobAt = new Map();
    for (const [k, t] of tree) if (!listed.has(k) && t.blob && !blobAt.has(t.blob)) blobAt.set(t.blob, k);
    for (const [p, e] of Object.entries(files)) {
      if (staged && !staged.has(p)) continue;
      const t = tree.get(p);
      if (!t) {
        const ci = lowerKnown.get(p.toLowerCase()), moved = (ci && ci !== p ? ci : null) ?? blobAt.get(e.blob) ?? null;
        if (moved) { P('missing', `${p} is listed, but git now has it as ${moved} (${moved.toLowerCase() === p.toLowerCase() ? 'a case-only rename' : 'renamed or copied'}); the licensed bytes are still tracked`, `re-list it under its new name: node scripts/assets.mjs add ${shq(moved)} --pack ${e.pack}, then node scripts/assets.mjs update --drop ${shq(p)}`, p); continue; }
        const disk = worktree?.(p);
        if (disk && !isPlaceholder(disk.head) && !ownPh(p, disk.buf, true)) P('missing', `${p} is listed but not committed yet`, `git add ${shq(p)}`, p);
        else P('missing', `${p} is listed but not in git`, `if deleted on purpose: node scripts/assets.mjs update --drop ${shq(p)}`, p);
        continue;
      }
      // The working tree (what `git add -A` would stage). With --staged only the index counts: perFile checked it.
      const wt = worktree?.(p) ?? null, wtBlob = wt && wt.blob();
      if (wt && (isPlaceholder(wt.head) || (wtBlob !== e.blob && ownPh(p, wt.buf, true)))) { P('placeholder', `${p} in the working tree is a placeholder${isPlaceholder(wt.head) ? '' : ' (its marker stripped)'}: a placeholder replaced licensed art`, `restore it from git (git restore ${shq(p)}) or put the real file back; never record it with update`, p); continue; }
      if (wtBlob && wtBlob !== e.blob) { P('drift', `${p} was edited but private-assets.json still records the old bytes`, `node scripts/assets.mjs update ${shq(p)}  (in the same commit as the edit)`, p); continue; }
      if (seen.has(`placeholder\0${p}`)) continue;
      if (t.blob !== e.blob) {
        if (wtBlob === e.blob) warnings.push({ rule: 'drift', path: p, msg: `${p}: the update is recorded but the file is not staged (git add ${shq(p)})` });
        else P('drift', `${p} changed in git but private-assets.json still records the old bytes`, `node scripts/assets.mjs update ${shq(p)}`, p);
      }
    }
  }
  if (!staged) for (const t of cov.unused([...known, ...pending.keys()])) warnings.push({ rule: 'coverage', msg: `ASSETS.md §1/§2 row \`${t}\` matches no tracked file` });
  return { problems, warnings };
}
function reportGuard(ctx, label, { problems, warnings }, extra = {}) {
  if (ctx.json) { ctx.print(JSON.stringify({ ok: problems.length === 0, problems, warnings, ...extra }, null, 2)); return problems.length ? 1 : 0; }
  for (const w of warnings) ctx.warn(w.msg);
  const shown = problems.slice(0, 60);
  for (const p of shown) ctx.error(`problem: ${p.msg}${p.fix ? `\n  fix: ${p.fix}` : ''}`);
  if (problems.length > shown.length) ctx.error(`... ${problems.length - shown.length} more (use --json for all)`);
  if (problems.length) { ctx.error(`${label}: ${plural(problems.length, 'problem')}`); return 1; }
  ctx.log(`${label}: ok${extra.summary ? ` (${extra.summary})` : ''}`);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------------------------
/** A guard entry for blob `id` read by readBlobPrefixes: read(n) gives its first n bytes; full() all of it, or null if only a prefix was read. */
const blobEntry = (id, mode, blobs) => ({ blob: id, mode, read: (n) => blobs.get(id)?.buf.subarray(0, n) ?? null, full: () => { const b = blobs.get(id); return b && b.buf.length === b.size ? b.buf : null; } });
/** How many bytes of a file the guard needs: all of a PNG (pixel hash), the head of other media, 2 MB of text (secrets). */
const guardWant = (p) => (extOf(p) === 'png' ? Infinity : isMedia(p) ? 8192 : 2_000_000);
/** The git blob id of a file on disk, hashed in chunks (a large video never sits in memory). */
function fileBlobId(abs, size) {
  const h = crypto.createHash('sha1').update(`blob ${size}\0`), fd = fs.openSync(abs, 'r'), chunk = Buffer.alloc(1 << 20);
  try { for (let got; (got = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) h.update(chunk.subarray(0, got)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
/** A guard entry for a file on disk (untracked, or changed since staging), or null if it is gone or not a file. */
function diskEntry(abs, p, how) {
  let st; try { st = fs.lstatSync(abs); } catch { return null; }
  if (st.isSymbolicLink()) { let target = ''; try { target = fs.readlinkSync(abs); } catch { /* unreadable */ } return { blob: gitBlobId(Buffer.from(target)), mode: '120000', target, read: () => null, full: () => null, how }; }
  if (!st.isFile()) return null;
  const want = guardWant(p), whole = st.size <= 64 * 1024 * 1024 ? readIf(abs) : null;
  const blob = whole ? gitBlobId(whole) : fileBlobId(abs, st.size);
  const kept = whole && (want === Infinity || whole.length <= want ? whole : Buffer.from(whole.subarray(0, want))); // keep only what the rules read
  return { blob, mode: st.mode & 0o111 ? '100755' : '100644', read: (n) => (kept && n <= kept.length ? kept.subarray(0, n) : readHead(abs, n)), full: () => (st.size > PNG_FULL_MAX ? null : want === Infinity && kept ? kept : readIf(abs)), how };
}
async function cmdCheck(ctx, opts) {
  // --staged (the pre-commit form) checks what the commit will hold: the manifest, ASSETS.md, .gitignore and credits
  // come from the index too, so a row or ignore block left unstaged cannot make a commit pass that fails in CI.
  const { m, text } = loadManifest(ctx, { validate: false, fromIndex: !!opts.staged }); // check reports manifest errors itself, with the rest
  const index = indexEntries(ctx);
  const fromIndex = new Map();
  const read = opts.staged
    ? (rel) => { const p = nfc(rel); if (!fromIndex.has(p)) { const ix = index.get(p), r = ix && /^1006[0-9]{2}$/.test(ix.mode) ? git(ctx, ['cat-file', 'blob', ix.blob], { buffer: true, allowFail: true }) : null; fromIndex.set(p, r?.status === 0 ? r.stdout : null); } return fromIndex.get(p); }
    : (rel) => readIf(path.join(ctx.root, rel));
  let staged = null;
  // AMT: a symlink replaced by a file (a type change) is checked like any added or modified file
  if (opts.staged) staged = new Set(git(ctx, ['diff', '--cached', '--no-renames', '--diff-filter=AMT', '--name-only', '-z']).split('\0').filter(Boolean).map(nfc));
  // Content comes from the index (what `git commit` records), never from the working tree.
  const wants = new Map();
  for (const [p, e] of index) if ((!staged || staged.has(p)) && (e.mode === '100644' || e.mode === '100755' || e.mode === '120000')) wants.set(e.blob, Math.max(wants.get(e.blob) ?? 0, e.mode === '120000' ? 4096 : guardWant(p)));
  const blobs = await readBlobPrefixes(ctx, wants);
  const tree = new Map([...index].map(([p, e]) => [p, blobEntry(e.blob, e.mode, blobs)]));
  // What `git add -A` would add on top: untracked files that are not ignored, and unstaged edits (not with --staged).
  const pending = new Map();
  if (!staged) {
    for (const raw of untrackedFiles(ctx)) { const t = diskEntry(path.join(ctx.root, raw), nfc(raw), 'untracked'); if (t) pending.set(nfc(raw), t); }
    for (const raw of worktreeChanged(ctx)) {
      const p = nfc(raw), ix = index.get(p); if (!ix || ix.mode === '160000') continue;
      const t = diskEntry(path.join(ctx.root, raw), p, 'worktree'); if (t && t.blob !== ix.blob) pending.set(p, t);
    }
  }
  const hasSrc = staged ? [...index.keys()].some((p) => p.startsWith('src/')) : hasSrcDir(ctx.root);
  const worktree = staged ? null : (rel) => diskFile(path.join(ctx.root, rel));
  const result = runGuard(m, { tree, pending, read, worktree, hasSrc, publicTree: m.mode !== 'mirror', staged, today: todayOf(ctx.env), manifestText: text, strict: !!opts.strict });
  const vend = path.join(ctx.root, 'scripts', 'assets.mjs'), kitV = versionOfFile(path.join(kitRoot(ctx), 'tools', 'assets', 'assets.mjs')), repoV = versionOfFile(vend);
  if (kitV && repoV && semverCmp(repoV, kitV) < 0) result.warnings.push({ rule: 'vendor', msg: `scripts/assets.mjs is ${repoV}; the kit has ${kitV} (run: node <kit>/tools/assets/assets.mjs vendor)` });
  const untracked = [...pending.values()].filter((t) => t.how === 'untracked').length;
  return reportGuard(ctx, 'assets check', result, { summary: `${plural(index.size, 'tracked file')}${staged ? ` (${staged.size} staged checked)` : `, ${plural(untracked, 'untracked file')} git add -A would add`}, ${plural(Object.keys(m.files).length, 'private file')} listed, mode ${m.mode}` });
}

async function cmdDocs(ctx, opts) {
  const { m, text } = loadManifest(ctx, { validate: !opts.check });
  if (opts.credits) { const bad = relPathProblem(opts.credits); if (bad) usageError(`--credits ${opts.credits} ${bad}`); m.build ??= {}; if (m.build.credits !== opts.credits) { m.build.credits = opts.credits; if (!opts.check) saveManifest(ctx, m); } }
  const exp = expectedOutputs(m, hasSrcDir(ctx.root), (rel) => readIf(path.join(ctx.root, rel))?.toString('utf8') ?? null);
  const stale = Object.entries(exp).filter(([rel, t]) => (readIf(path.join(ctx.root, rel))?.toString('utf8') ?? null) !== t).map(([rel]) => rel);
  if (opts.check) {
    if (text !== serializeManifest(m)) ctx.warn('private-assets.json is not in canonical form');
    if (stale.length) { const stray = strayMdSections(readIf(path.join(ctx.root, 'ASSETS.md'))?.toString('utf8') ?? ''); ctx.error(`stale: ${stale.map((rel) => (exp[rel] === null ? `${rel} (should be deleted)` : rel === 'ASSETS.md' && stray.length ? `ASSETS.md (hand-written §3/§4 outside the generated block: ${strayNote(stray)})` : rel)).join(', ')} (run: node scripts/assets.mjs docs)`); return 1; }
    ctx.log('assets docs: current'); return 0;
  }
  warnStray(ctx, exp, stale);
  writeOutputs(ctx, exp, stale);
  if (text !== serializeManifest(m)) saveManifest(ctx, m);
  ctx.log(stale.length ? `assets docs: ${stale.map((rel) => (exp[rel] === null ? `deleted ${rel}` : `wrote ${rel}`)).join(', ')}` : 'assets docs: already current');
  return 0;
}
/** Write (or, for null, delete) generated outputs. Returns the paths it deleted. */
function writeOutputs(ctx, exp, rels = Object.keys(exp)) {
  const removed = [];
  for (const rel of rels) {
    const abs = path.join(ctx.root, rel);
    if (exp[rel] === null) { fs.rmSync(abs, { force: true }); removed.push(rel); } else writeIfChanged(abs, exp[rel]);
  }
  return removed;
}
/** Before docs replaces hand-written §3/§4 sections, say so: their text survives only in git. */
function warnStray(ctx, exp, rels) {
  if (!rels.includes('ASSETS.md')) return;
  const stray = strayMdSections(readIf(path.join(ctx.root, 'ASSETS.md'))?.toString('utf8') ?? '');
  if (stray.length) ctx.warn(`ASSETS.md: replaced the hand-written ${stray.length === 1 ? 'section' : 'sections'} ${strayNote(stray)} with the generated §3/§4 block (private-assets.json is their source now). The old text: git diff ASSETS.md. Move anything worth keeping into the manifest (add --terms/--why) or a §1/§2 row.`);
}
function regenerate(ctx, m) {
  const exp = expectedOutputs(m, hasSrcDir(ctx.root), (rel) => readIf(path.join(ctx.root, rel))?.toString('utf8') ?? null);
  warnStray(ctx, exp, Object.keys(exp).filter((rel) => (readIf(path.join(ctx.root, rel))?.toString('utf8') ?? null) !== exp[rel]));
  const removed = writeOutputs(ctx, exp);
  for (const rel of removed) ctx.log(`removed ${rel}: no pack or credit needs the generated credits any more`);
}

/** The privateGlobs entry with a `rebuild` command that generates `p`, if any. */
function derivedGlobOf(m, p) { return (m.privateGlobs ?? []).find((g) => g.rebuild && globToRegExp(g.glob).test(p)) ?? null; }
/**
 * Run a privateGlobs `rebuild` command (["node", script, …args]) from the repo root, without a shell. sync never writes
 * tracked paths, so any tracked file the command changes is restored from the index afterwards.
 */
function runRebuild(ctx, g) {
  const script = safeTarget(ctx.root, g.rebuild[1]);
  if (script.why || !fs.existsSync(script.abs)) { ctx.warn(`privateGlobs ${g.glob}: rebuild script ${g.rebuild[1]} ${script.why ?? 'does not exist'}; not rebuilt`); return false; }
  const dirty = () => new Set(git(ctx, ['diff', '--name-only', '-z']).split('\0').filter(Boolean));
  const before = dirty();
  const r = spawnSync(process.execPath, g.rebuild.slice(1), { cwd: ctx.root, env: ctx.env, encoding: 'utf8', maxBuffer: 1 << 26 });
  const touched = [...dirty()].filter((p) => !before.has(p));
  if (touched.length) {
    for (let i = 0; i < touched.length; i += 200) git(ctx, ['checkout', '--', ...touched.slice(i, i + 200)]);
    ctx.warn(`${g.rebuild.join(' ')} changed ${plural(touched.length, 'tracked file')} (${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ', …' : ''}); restored, because sync never writes tracked paths`);
  }
  if (r.error || r.status !== 0) { ctx.warn(`${g.rebuild.join(' ')} failed (${r.error?.code ?? `exit ${r.status}`}): ${String(r.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}`); return false; }
  return true;
}

/** Is process `pid` alive? A temp folder of a live sync is never removed. */
function pidAlive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; if (pid === process.pid) return true; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
/**
 * Where sync puts licensed bytes before they reach their listed path: private-assets/.tmp/<pid>-<random>/ inside the
 * repo. The generated .gitignore block always ignores private-assets/, the folder is on the repo's own volume (so the
 * final rename is atomic), and it is marked Dropbox-ignored before any data is written. So a killed sync leaves its
 * temps at an ignored, unsynced path, never next to the target. Files move into place in batches, each one marked
 * Dropbox-ignored first, so nothing licensed syncs to Dropbox even for a moment.
 */
class Stager {
  constructor(ctx, moved) { this.ctx = ctx; this.moved = moved; this.pending = []; this.n = 0; this.dir = null; }
  folder() {
    if (this.dir) return this.dir;
    const base = safeTarget(this.ctx.root, `${DROP_DIR}/.tmp`);
    if (base.why) problem(`sync cannot stage files: ${base.why}. ${DROP_DIR}/ must be a real folder in the repository: sync stages licensed files in ${DROP_DIR}/.tmp/, which the generated .gitignore block ignores`);
    fs.mkdirSync(base.abs, { recursive: true });
    markDropboxIgnored(this.ctx, [base.abs]);
    this.dir = fs.mkdtempSync(path.join(base.abs, `${process.pid}-`));
    return this.dir;
  }
  tmp() { return path.join(this.folder(), String(++this.n)); }
  add(tmp, abs) { this.pending.push({ tmp, abs }); if (this.pending.length >= 200) this.flush(); }
  write(abs, buf) { const t = this.tmp(); fs.writeFileSync(t, buf); this.add(t, abs); }
  flush() {
    if (!this.pending.length) return;
    const batch = this.pending; this.pending = [];
    markDropboxIgnored(this.ctx, batch.map((x) => x.tmp));
    for (const { tmp, abs } of batch) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      try { fs.renameSync(tmp, abs); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(tmp, abs); fs.rmSync(tmp, { force: true }); }
      this.moved.push(abs);
    }
  }
  cleanup() { if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true }); }
}
/** Remove temps an interrupted sync left: private-assets/.tmp/<dead pid>-*, and 1.1.0's `<listed path>.tmp-<pid>`. */
function cleanStaleTemps(ctx, listedPaths, tracked, notes) {
  const base = safeTarget(ctx.root, `${DROP_DIR}/.tmp`);
  if (base.abs) {
    let list = []; try { list = fs.readdirSync(base.abs); } catch { /* none */ }
    for (const d of list) { if (pidAlive(Number(d.split('-')[0]))) continue; fs.rmSync(path.join(base.abs, d), { recursive: true, force: true }); notes.push(`removed ${DROP_DIR}/.tmp/${d}: temps of an interrupted sync`); }
  }
  const byDir = new Map(); for (const p of listedPaths) { const d = path.posix.dirname(p); if (!byDir.has(d)) byDir.set(d, new Set()); byDir.get(d).add(path.posix.basename(p)); }
  for (const [d, bases] of byDir) {
    const t = d === '.' ? { abs: ctx.root } : safeTarget(ctx.root, d); if (!t.abs) continue;
    let names; try { names = fs.readdirSync(t.abs); } catch { continue; }
    for (const n of names) {
      const hit = n.match(/^(.+)\.tmp-(\d+)$/); if (!hit || !bases.has(nfc(hit[1])) || pidAlive(Number(hit[2]))) continue;
      const rel = nfc(d === '.' ? n : `${d}/${n}`); if (tracked.has(rel)) continue;
      const tt = safeTarget(ctx.root, rel); if (!tt.abs) continue;
      fs.rmSync(tt.abs, { force: true }); notes.push(`removed ${rel}: a partial copy an interrupted sync left next to its target`);
    }
  }
}
/** How a file on disk matches its manifest entry ('exact' | 'pixels' | null), hashing large files in chunks. */
function fileMatches(abs, e) {
  let st; try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || isPlaceholder(readHead(abs))) return null;
  if (st.size === e.bytes && sha256File(abs) === e.sha256) return 'exact';
  if (e.pixel && st.size <= PNG_FULL_MAX) { const b = readIf(abs); if (b && pixelHash(b) === e.pixel) return 'pixels'; }
  return null;
}
/**
 * A regular file on disk, safe at any size (Node cannot read a file over 2 GiB into one Buffer): {size, buf, head,
 * sha(), blob()}. `buf` is the whole file up to PNG_FULL_MAX and null above it; larger files are hashed in chunks and
 * never decoded. Null when the path is absent or not a regular file (`follow: false`: a symlink is not followed).
 */
function diskFile(abs, { follow = true } = {}) {
  let st; try { st = follow ? fs.statSync(abs) : fs.lstatSync(abs); } catch { return null; }
  if (!st.isFile()) return null;
  const buf = st.size <= PNG_FULL_MAX ? readIf(abs) : null;
  if (!buf && st.size <= PNG_FULL_MAX) return null;
  let sha = null, blob = null;
  return {
    abs, size: st.size, buf, head: buf ? buf.subarray(0, 4096) : (readHead(abs) ?? Buffer.alloc(0)),
    sha: () => (sha ??= buf ? sha256(buf) : sha256File(abs)),
    blob: () => (blob ??= buf ? gitBlobId(buf) : fileBlobId(abs, st.size)),
  };
}
/** matchKind for a diskFile: above PNG_FULL_MAX a file matches by its streamed sha256 only. */
function matchFile(e, f) {
  if (!f || !e) return null;
  if (f.buf) return matchKind(e, f.buf);
  return f.size === e.bytes && f.sha() === e.sha256 ? 'exact' : null;
}
/** The facts fileFacts records, for a diskFile of any size (no pixel hash above PNG_FULL_MAX). */
function diskFacts(f, relPath) {
  if (f.buf) return fileFacts(f.buf, relPath);
  const e = { sha256: f.sha(), blob: f.blob(), bytes: f.size };
  if (IMAGE_EXT.has(extOf(relPath)) || extOf(relPath) === 'ico') { const d = imageSize(readHead(f.abs, 256 * 1024)); if (d) { e.w = d.w; e.h = d.h; } }
  return e;
}
/** Store a diskFile's bytes as an object: from memory, or (over PNG_FULL_MAX) copied from disk. Returns {wrote, skipped}. */
async function storeDiskFile(store, f, sidecar) { return f.buf ? store.writeObject(f.buf, sidecar) : store.writeObjectFile(f.abs, f.sha(), f.size, sidecar); }
/** privateGlobs matches among `paths`, as [{p, g}] (the first glob that matches each). */
function globbedPaths(m, paths) {
  const gs = (m.privateGlobs ?? []).filter((g) => typeof g?.glob === 'string').map((g) => ({ g, re: globToRegExp(g.glob) })), out = [];
  for (const p of paths) { const hit = gs.find((x) => x.re.test(p)); if (hit) out.push({ p, g: hit.g }); }
  return out;
}
/** The placeholder spec of a privateGlobs file: its glob's `placeholder`, else the default for its type and size. */
function globSpecOf(m, g, p, entry) { try { return g.placeholder !== undefined ? parsePlaceholder(g.placeholder) : resolvePlaceholder(entry, m.packs[g.pack], p); } catch { return null; } }
/** {w, h} of an image's bytes as a placeholder entry ({} when not an image), for privateGlobs files that have no entry. */
const dimsEntry = (buf) => { const d = buf && imageSize(buf); return d ? { w: d.w, h: d.h } : {}; };
/**
 * git's tracked paths, and a lookup that also finds a tracked path differing only by case (or Unicode form) where that is
 * the same file: a case-insensitive disk (core.ignorecase), or the same inode. sync must never write either spelling.
 */
function trackedLookup(ctx, index) {
  const exact = new Set(index.keys()), fold = new Map();
  for (const p of exact) { const k = p.normalize('NFC').toLowerCase(); if (!fold.has(k)) fold.set(k, p); }
  let ci = null;
  const caseInsensitive = () => (ci ??= git(ctx, ['config', '--bool', 'core.ignorecase'], { allowFail: true }).stdout?.trim() === 'true');
  const sameFile = (a, b) => { try { const x = fs.lstatSync(path.join(ctx.root, a)), y = fs.lstatSync(path.join(ctx.root, b)); return x.dev === y.dev && x.ino === y.ino; } catch { return false; } };
  /** The tracked path that is `p` on this disk (p itself, or a spelling that differs only by case), or null. */
  const twin = (p) => {
    if (exact.has(p)) return p;
    const q = fold.get(p.normalize('NFC').toLowerCase());
    return q && (caseInsensitive() || sameFile(p, q)) ? q : null;
  };
  return { has: (p) => twin(p) !== null, twin, exact };
}
/** private-assets/.state.json (what sync wrote where), or {written: {}}. */
function readSyncState(ctx) {
  const t = safeTarget(ctx.root, STATE_REL);
  let state; try { state = JSON.parse((t.abs && readIf(t.abs)?.toString('utf8')) || '{}'); } catch { state = {}; }
  if (!state.written || typeof state.written !== 'object') state.written = {};
  return state;
}
/**
 * Why the bytes `f` at path `p` must not be recorded as licensed art (add, update), or null, as {msg, edited}. They are
 * this tool's placeholder (the marker, or the placeholder rebuilt and compared: an optimizer strips the marker); or
 * (edited: true) sync last wrote its placeholder at `p` and these bytes are neither the listed file nor what sync
 * wrote, so they are most likely an edited placeholder (an agent "fixing" the checkerboard drops the marker too).
 * `entries` are the recorded entry and/or the new facts (their w/h and spec); `listed` is the recorded entry, if any.
 */
function placeholderOrigin(m, p, f, entries, { io, state, listed = null, packOf = (e) => m.packs[e.pack] }) {
  for (const e of entries) {
    let spec = null; try { spec = resolvePlaceholder(e, packOf(e), p); } catch { /* reported by check */ }
    if (isPlaceholder(f.head) || (f.buf && isOwnPlaceholder(f.buf, spec, p, e, io))) return { msg: 'is a placeholder (sync writes these where the licensed file is missing; an optimizer may have stripped its marker), not the licensed file', edited: false };
    const w = state?.written?.[p];
    if (!w || !spec || w === f.sha() || (listed && (w === listed.sha256 || matchFile(listed, f)))) continue;
    let ph = null; try { ph = renderPlaceholder(spec, p, e, io); } catch { /* none */ }
    if (ph && sha256(ph) === w) return { msg: `started as the placeholder sync wrote there (${STATE_REL}) and is not the listed file: an edited placeholder is not the licensed art`, edited: true };
  }
  return null;
}
/** The refusal add and update print for placeholderOrigin hits. */
const placeholderRefusal = (cmd, refused) => `${cmd} refused ${plural(refused.length, 'file')}, because a placeholder is never the licensed file:\n  ${refused.slice(0, 10).join('\n  ')}${refused.length > 10 ? `\n  ... ${refused.length - 10} more` : ''}\nPut the real file there (sync with the store, or import the pack), then run ${cmd} again. Only if a person replaced the placeholder with an edited copy of the real licensed file by hand (an agent never does), pass --confirm-real; it never overrides a placeholder's own pixels.`;

async function cmdSync(ctx, opts) {
  const { m, sha: manifestSha } = loadManifest(ctx);
  const required = !!opts.require || requiresReal(ctx.env);
  const forcePh = !!opts.placeholders || ctx.env.ASSETS_MODE === 'placeholder';
  if (required && forcePh) usageError('placeholders were requested, but this environment requires real assets (ASSETS_REQUIRE / CF_PAGES / VERCEL / WORKERS_CI)');
  const index = indexEntries(ctx), only = opts.only ? new Set(opts.only.split(',')) : null;
  const tracked = trackedLookup(ctx, index); // also finds a tracked spelling that differs only by case (one file on a Mac)
  const paths = Object.keys(m.files).sort(cmp).filter((p) => shipOf(m, p) !== 'never');
  // real: the listed bytes, or a PNG with the listed pixels (drift counts those). unknown: present, but neither the
  // listed file nor this tool's placeholder (an edit, a stale copy, a --trust-store file); it never counts as real.
  const counts = { files: paths.length, real: 0, placeholders: 0, absent: 0, unknown: 0, drift: 0 };
  const missing = [], notes = [], errors = [];
  let unignored = [];
  const known = new Set([...repoPaths(ctx), ...Object.keys(m.files)]), jsonCache = new Map();
  const readSafe = (rel) => { const t = safeTarget(ctx.root, rel); return t.abs ? readIf(t.abs) : null; };
  const io = { knownPaths: () => known, read: (rel) => { if (!jsonCache.has(rel)) jsonCache.set(rel, readSafe(rel)); return jsonCache.get(rel); } };
  const specOf = (p) => { try { return resolvePlaceholder(m.files[p], m.packs[m.files[p].pack], p); } catch { return null; } };
  /** What the file `f` (a diskFile) at listed path p is: 'exact', 'pixels', 'placeholder' (this tool's, marker or not), 'unknown', 'absent'. */
  const classify = (p, f) => (!f ? 'absent' : isPlaceholder(f.head) ? 'placeholder' : matchFile(m.files[p], f) ?? (f.buf && isOwnPlaceholder(f.buf, specOf(p), p, m.files[p], io) ? 'placeholder' : 'unknown'));
  const fileAt = (p) => diskFile(path.join(ctx.root, p));
  /** Count one file once; under --require anything not real is missing. Returns true if it is real. */
  const tally = (p, kind, why) => {
    if (kind === 'exact' || kind === 'pixels') { counts.real++; if (kind === 'pixels') counts.drift++; return true; }
    if (kind === 'placeholder') counts.placeholders++; else if (kind === 'absent') counts.absent++; else counts.unknown++;
    if (required) missing.push(`${p}${why ? ` (${why})` : kind === 'unknown' ? ' (not the listed bytes)' : kind === 'placeholder' ? ' (placeholder)' : ''}`);
    return false;
  };
  // A committed stamp is a tracked file sync must not write, and a stale "real" one could reach a build that skipped sync.
  const stampRel = stampRelOf(m), stampTracked = tracked.twin(stampRel);
  let failure = null;
  try {
    if (m.mode === 'mirror') {
      for (const p of paths) {
        const f = fileAt(p), kind = classify(p, f);
        if (kind === 'unknown' || kind === 'pixels') ctx.warn(`${p} differs from private-assets.json${kind === 'pixels' ? ' (same pixels, other bytes)' : ''} (run: node scripts/assets.mjs update ${shq(p)})`);
        if (kind === 'placeholder') ctx.warn(`${p} is a placeholder, not the licensed file: restore it from git (git restore ${shq(p)})`);
        tally(p, kind);
        if (f && !index.has(p)) ctx.warn(`${p} is listed but not tracked by git`);
      }
      // Tracked privateGlobs files (WAMP's content-hashed tree atlases) ship too. Their reference is the committed blob,
      // and a re-rendered placeholder (marker stripped by an optimizer) never counts as real, even if it was committed.
      const globbed = globbedPaths(m, [...index.keys()].filter((p) => !m.files[p] && index.get(p).mode !== '160000' && index.get(p).mode !== '120000')).filter(({ g }) => (m.packs[g.pack]?.ship ?? 'always') !== 'never');
      counts.files += globbed.length;
      for (const { p, g } of globbed) {
        const f = fileAt(p), entry = dimsEntry(f?.buf ?? f?.head);
        let kind = 'absent';
        if (f) kind = isPlaceholder(f.head) || (f.buf && isOwnPlaceholder(f.buf, globSpecOf(m, g, p, entry), p, entry, io)) ? 'placeholder' : f.blob() === index.get(p).blob ? 'exact' : 'unknown';
        if (kind === 'placeholder') ctx.warn(`${p} is a placeholder (privateGlobs ${g.glob}), not the generated art: restore it (git restore ${shq(p)}, or git checkout <good ref> -- ${shq(p)} if a placeholder was committed)`);
        else if (kind === 'unknown') ctx.warn(`${p} (privateGlobs ${g.glob}) differs from the committed file: commit the rebuild, or git restore ${shq(p)}`);
        tally(p, kind, kind === 'absent' ? 'tracked by git, but missing from disk' : kind === 'unknown' ? 'not the committed bytes' : null);
      }
    } else {
      const explicit = opts.store || ctx.env.PRIVATE_ASSET_STORE ? openStore(opts.store || ctx.env.PRIVATE_ASSET_STORE, ctx) : null;
      const dfltLocal = new LocalStore(defaultStorePath(ctx));
      const stores = [explicit, dfltLocal.exists() && (!explicit || explicit.label !== dfltLocal.label) ? checkedLocalStore(ctx, dfltLocal.root) : null].filter(Boolean);
      const stateT = safeTarget(ctx.root, STATE_REL);
      const state = readSyncState(ctx);
      const written = {}, done = new Set(), moved = [], laterMark = [];
      const stager = new Stager(ctx, moved);
      const stubs = [], realNow = new Set(), deferred = [];
      try {
        cleanStaleTemps(ctx, Object.keys(m.files), tracked, notes);
        // Where sync may write: inside the repo with no symlinked folder on the way, and only where git ignores the path
        // (a stale .gitignore block would otherwise put licensed bytes where the next `git add -A` stages them).
        const target = new Map(), skipped = new Map();
        for (const p of paths) { if (tracked.has(p)) continue; const t = safeTarget(ctx.root, p); if (t.why) skipped.set(p, t.why); else target.set(p, t.abs); }
        const ign = ignoredSet(ctx, [...target.keys()]);
        unignored = [...target.keys()].filter((p) => !ign.has(p));
        for (const p of unignored) { target.delete(p); skipped.set(p, '.gitignore does not ignore it'); }
        const unignoredSet = new Set(unignored);
        /** One source attempt. An unreadable object (a Dropbox file read offline, a permission problem) is an unavailable source. */
        const fromStore = async (s, p, e) => {
          const tmp = stager.tmp();
          try { const r = await s.materialize(e.sha256, tmp); if (r.ok) return { ...r, tmp }; if (r.reason === 'stub') stubs.push(p); }
          catch (err) { if (err instanceof Exit) { fs.rmSync(tmp, { force: true }); throw err; } errors.push(`${p}: ${s.label} could not be read (${err.code ?? err.message}); trying the next source`); } // an S3 error (credentials, endpoint) stays an environment error
          fs.rmSync(tmp, { force: true });
          return null;
        };
        const noSource = (p, e, abs, cur, curKind) => { // no source has the listed bytes: keep sync's own older copy, or a placeholder
          if (cur && curKind !== 'placeholder' && !forcePh) { written[p] = cur.sha(); ctx.warn(`${p}: no source has the listed bytes; keeping the older copy sync wrote earlier (it is not the listed file)`); tally(p, curKind, 'only an older version is available'); return; }
          if (required) { tally(p, cur ? 'placeholder' : 'absent'); return; }
          let ph = null;
          try { ph = renderPlaceholder(resolvePlaceholder(e, m.packs[e.pack], p), p, e, io); } catch (err) { notes.push(`${p}: placeholder not written: ${err.message}`); }
          if (!ph) { if (curKind === 'placeholder') fs.rmSync(abs, { force: true }); tally(p, 'absent'); return; }
          const phSha = sha256(ph);
          if (!cur || cur.sha() !== phSha) stager.write(abs, ph);
          written[p] = phSha; tally(p, 'placeholder');
        };
        for (const p of paths) {
          done.add(p);
          const e = m.files[p];
          if (tracked.has(p)) {
            const twin = tracked.twin(p), kind = classify(p, fileAt(p));
            if (tally(p, kind, kind === 'absent' ? 'tracked by git, but missing from disk' : kind === 'placeholder' ? 'a placeholder tracked by git' : 'tracked by git, and not the listed bytes')) realNow.add(p);
            if (twin === p) notes.push(`${p} is tracked by git; left alone (check will fail: git rm --cached it)`);
            else ctx.warn(`${p} is the tracked file ${twin} on this disk (names that differ only by case are one file here), so sync left it alone; never delete ${twin} to make room. Rename one of them (check reports the case collision).`);
            continue;
          }
          const abs = target.get(p);
          if (!abs) { // never written; whatever already sits there (through a symlink, say) still counts if it is the listed file
            const kind = classify(p, fileAt(p));
            if (tally(p, kind, `not written: ${skipped.get(p)}`)) realNow.add(p);
            if (!unignoredSet.has(p)) notes.push(`${p}: not written: ${skipped.get(p)}; sync never writes through a symlink or outside the repository`);
            continue;
          }
          let st = null; try { st = fs.lstatSync(abs); } catch { /* absent */ }
          if (st && !st.isFile()) { notes.push(`${p} is not a regular file (symlink?); left alone`); tally(p, 'absent', 'not a regular file'); continue; }
          const cur = st ? diskFile(abs, { follow: false }) : null, curKind = classify(p, cur);
          const curIsPh = curKind === 'placeholder', curReal = curKind === 'exact' || curKind === 'pixels';
          if (only && !only.has(e.pack)) { if (tally(p, curKind)) realNow.add(p); if (state.written[p]) written[p] = state.written[p]; continue; }
          const ours = !!cur && state.written[p] === cur.sha(); // bytes this tool wrote and nobody touched since
          if (cur && !curIsPh && !forcePh) {
            if (curReal) { tally(p, curKind); realNow.add(p); if (ours) written[p] = cur.sha(); continue; }
            if (!ours) {
              // Keep the record of what sync wrote here: if it was a placeholder, add and update refuse these bytes.
              if (state.written[p]) written[p] = state.written[p];
              ctx.warn(`${p} is not the listed file (bytes and pixels differ from private-assets.json): if you edited the real file on purpose run \`node scripts/assets.mjs update ${shq(p)}\`; if it is an edited placeholder, delete it and sync again (never record a placeholder)`);
              tally(p, 'unknown'); continue;
            }
            // an older version this tool wrote: replace it with the listed bytes if a source has them
          }
          if (cur && !curIsPh && forcePh && !ours) {
            let recoverable = false;
            if (curKind === 'exact') for (const s of stores) { try { if (await s.objectInfo(e.sha256)) { recoverable = true; break; } } catch { /* unreachable store */ } }
            if (!recoverable) { if (state.written[p]) written[p] = state.written[p]; if (tally(p, curKind)) realNow.add(p); ctx.warn(`${p} kept: it is not a placeholder and no store holds a copy, so replacing it with a placeholder could lose it`); continue; }
          }
          if (!forcePh) {
            let got = null;
            if (explicit) got = await fromStore(explicit, p, e);
            if (!got) {
              const dt = safeTarget(ctx.root, `${DROP_DIR}/${p}`), drop = dt.abs ? diskFile(dt.abs) : null;
              if (drop && (isPlaceholder(drop.head) || (drop.buf && isOwnPlaceholder(drop.buf, specOf(p), p, e, io)))) notes.push(`${DROP_DIR}/${p} is a placeholder, not the licensed file; not used (not even with --trust-store)`);
              else if (drop) {
                const k = matchFile(e, drop);
                if (k || opts['trust-store']) { const t = stager.tmp(); fs.copyFileSync(drop.abs, t); got = { tmp: t, sha: drop.sha(), kind: k }; }
                else notes.push(`${DROP_DIR}/${p} differs from private-assets.json; not used (pass --trust-store to use it anyway)`);
              }
            }
            if (!got) for (const s of stores.filter((x) => x !== explicit)) { got = await fromStore(s, p, e); if (got) break; }
            if (got) {
              stager.add(got.tmp, abs); written[p] = got.sha;
              const k = got.kind !== undefined ? got.kind : 'exact'; // a store object is verified against the listed sha256
              if (tally(p, k ?? 'unknown', k ? null : 'a --trust-store file that is not the listed bytes')) realNow.add(p);
              continue;
            }
          }
          if (!forcePh && derivedGlobOf(m, p)) { deferred.push({ p, e, abs, cur, curKind }); continue; }
          noSource(p, e, abs, cur, curKind);
        }
        stager.flush(); // a rebuild reads the pack's files at their listed paths
        // Generated derivatives (privateGlobs with `rebuild`, e.g. content-hashed atlases): no pack download contains them,
        // so build them from the pack's own files once those are real here.
        const byGlob = new Map(); for (const d of deferred) { const g = derivedGlobOf(m, d.p); if (!byGlob.has(g)) byGlob.set(g, []); byGlob.get(g).push(d); }
        for (const [g, list] of byGlob) {
          const sources = paths.filter((q) => m.files[q].pack === g.pack && !derivedGlobOf(m, q)), notReal = sources.filter((q) => !realNow.has(q));
          const blocked = list.some((d) => !target.has(d.p));
          let ran = false;
          if (!sources.length || notReal.length || blocked) notes.push(`${g.glob}: not rebuilt (${blocked ? 'a generated path is not safely writable' : `${notReal.length} of the pack's ${sources.length} files are not real here`})`);
          else if ((ran = runRebuild(ctx, g))) notes.push(`rebuilt ${g.glob} with ${g.rebuild.join(' ')}`);
          for (const d of list) {
            const b = ran ? diskFile(d.abs, { follow: false }) : d.cur, kind = ran ? classify(d.p, b) : d.curKind;
            if (ran && b && kind !== 'placeholder') {
              written[d.p] = b.sha(); laterMark.push(d.abs);
              if (kind === 'unknown') ctx.warn(`${d.p}: the rebuild wrote other pixels than private-assets.json records`);
              if (tally(d.p, kind, 'the rebuild wrote other pixels')) realNow.add(d.p);
              continue;
            }
            noSource(d.p, d.e, d.abs, b, kind);
          }
        }
        // Remove files this tool wrote earlier that are no longer listed (only if untouched since). A path git no longer
        // ignores was made public on purpose (update --drop --public: listed by mistake), so its file stays.
        const stale = Object.entries(state.written).filter(([p]) => !(m.files[p] && shipOf(m, p) !== 'never' && !tracked.has(p)));
        for (const [p] of stale) done.add(p);
        const staleFiles = stale.filter(([p]) => !tracked.has(p)).map(([p, oldSha]) => { const t = safeTarget(ctx.root, p); const f = t.abs ? diskFile(t.abs, { follow: false }) : null; return f ? { p, oldSha, f, abs: t.abs } : null; }).filter(Boolean);
        const staleIgnored = ignoredSet(ctx, staleFiles.map((x) => x.p));
        for (const { p, oldSha, f, abs } of staleFiles) {
          if (isPlaceholder(f.head)) { fs.rmSync(abs, { force: true }); notes.push(`removed ${p} (a placeholder; no longer listed)`); continue; }
          if (f.sha() !== oldSha) { ctx.warn(`${p} is no longer listed and was changed since sync wrote it; left in place`); continue; }
          if (!staleIgnored.has(p)) { notes.push(`${p} is no longer listed and git no longer ignores it (made public with update --drop --public?); left in place: commit it, or delete it`); continue; }
          fs.rmSync(abs, { force: true }); notes.push(`removed ${p} (no longer listed)`);
        }
        // Retired paths (dropped from the manifest; still ignored): a copy whose bytes are now forbidden is removed once a
        // store holds it, whoever put it there (sync, or the file add took over).
        for (const p of (Array.isArray(m.retired) ? m.retired : []).filter((x) => !m.files[x] && !tracked.has(x))) {
          const t = safeTarget(ctx.root, p); if (!t.abs) continue;
          const b = diskFile(t.abs, { follow: false }); if (!b) continue;
          if (isPlaceholder(b.head)) { fs.rmSync(t.abs, { force: true }); notes.push(`removed ${p}: a placeholder at a retired path`); continue; }
          if (!m.forbidden?.blobs?.[b.blob()]) { notes.push(`${p} is a retired path, so git ignores it; to commit a new file there, use git add -f`); continue; }
          let inStore = false; for (const s of stores) { try { if (await s.objectInfo(b.sha())) { inStore = true; break; } } catch { /* unreachable store */ } }
          if (inStore) { fs.rmSync(t.abs, { force: true }); notes.push(`removed ${p}: dropped from the manifest, its bytes are forbidden, and the store keeps a copy`); }
          else ctx.warn(`${p} was dropped from the manifest and its bytes are forbidden, but no reachable store holds a copy, so it was kept (git still ignores it); move it out of the repository`);
        }
      } finally {
        try { stager.flush(); } catch (err) { errors.push(`could not move staged files into place (${err.code ?? err.message})`); }
        stager.cleanup();
        markDropboxIgnored(ctx, laterMark);
        if (stubs.length) ctx.warn(`${plural(stubs.length, 'store object')} read as 0 bytes or wrong hash (Dropbox online-only stubs?): mark private-asset-store "Available offline"`);
        // what this run wrote, plus older records for paths it never reached (an interrupted run forgets nothing)
        const carry = Object.entries(state.written).filter(([p]) => !done.has(p));
        const all = { ...Object.fromEntries(carry), ...written };
        if (stateT.abs) writeIfChanged(stateT.abs, `${JSON.stringify({ tool: VERSION, mode: m.mode, manifestSha256: manifestSha, written: Object.fromEntries(Object.entries(all).sort(([a], [b]) => cmp(a, b))) }, null, 2)}\n`);
        else ctx.warn(`${STATE_REL} not written: ${stateT.why}`);
      }
    }
  } catch (err) { failure = err; }
  // The stamp is written even after a failure, so an interrupted run never leaves an older "real" stamp behind.
  const mode = !failure && counts.real === counts.files ? 'real' : counts.real === 0 ? 'placeholder' : 'partial';
  const stamp = { schema: 1, tool: VERSION, project: m.project, mode, manifestSha256: manifestSha, commit: headCommit(ctx), ...counts };
  const stampT = safeTarget(ctx.root, stampRel);
  if (stampTracked) ctx.error(`assets sync: ${stampTracked} is tracked by git, so sync did not write it (sync never writes a tracked path), and a build would ship the committed stamp, which may say "real" for other files. Fix: git rm --cached ${shq(stampTracked)}  (the generated .gitignore block ignores it), then sync again.`);
  else if (stampT.abs) writeIfChanged(stampT.abs, `${JSON.stringify(stamp, null, 2)}\n`); else ctx.warn(`${stampRel} not written: ${stampT.why}`);
  for (const e of errors.slice(0, 10)) ctx.warn(e);
  if (errors.length > 10) ctx.warn(`... ${errors.length - 10} more unreadable sources`);
  if (failure) throw failure;
  for (const n of notes.slice(0, 20)) ctx.log(`  ${n}`);
  if (notes.length > 20) ctx.log(`  ... ${notes.length - 20} more notes`);
  let code = stampTracked ? 1 : 0;
  if (unignored.length) {
    ctx.error(`assets sync: ${plural(unignored.length, 'listed file')} ${unignored.length === 1 ? 'is' : 'are'} not ignored by .gitignore, so sync wrote nothing there (licensed bytes at a committable path would be staged by the next \`git add -A\`):`);
    for (const p of unignored.slice(0, 20)) ctx.error(`  ${p}`);
    if (unignored.length > 20) ctx.error(`  ... ${unignored.length - 20} more`);
    ctx.error('Run: node scripts/assets.mjs docs   (regenerates the .gitignore block from private-assets.json), then sync again.');
    code = 1;
  }
  if (required && missing.length) {
    ctx.error(`assets sync: real assets are required, but ${plural(missing.length, 'file')} ${missing.length === 1 ? 'is' : 'are'} missing, placeholders, or not the listed bytes:`);
    for (const p of missing.slice(0, 20)) ctx.error(`  ${p}`);
    if (missing.length > 20) ctx.error(`  ... ${missing.length - 20} more`);
    ctx.error(m.mode === 'mirror' ? 'Restore them from git (git restore <path>), or record an intended edit with node scripts/assets.mjs update <path>.' : 'Deploy from a Mac with the private store (or set PRIVATE_ASSET_STORE), or set ASSETS_REQUIRE=none to deploy placeholders deliberately.');
    return 1;
  }
  if (code) return code;
  ctx.log(`assets sync (${m.mode}): ${mode}: ${counts.real} real, ${counts.placeholders} placeholders, ${counts.absent} absent, ${counts.unknown} not the listed bytes, ${counts.drift} drift; stamp ${stampRel}`);
  if (mode !== 'real' && !ctx.quiet) ctx.log('Placeholder art means the licensed files are not installed here. See ASSETS.md section 3. Never redraw or re-add them.');
  return 0;
}

async function cmdVerifyBuild(ctx, opts) {
  const { m, sha: manifestSha } = loadManifest(ctx);
  const dirRel = opts._[0] ?? outDirOf(m), dir = path.resolve(ctx.root, dirRel);
  const enforce = opts['when-required'] ? requiresReal(ctx.env) : true;
  const problems = [], warnings = [], E = (s) => problems.push(s);
  const stamp = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, STAMP_NAME), 'utf8')); } catch { return null; } })();
  if (!fs.existsSync(dir)) E(`${dirRel} does not exist`);
  else if (!stamp) E(`${dirRel}/${STAMP_NAME} is missing (run node scripts/assets.mjs sync before building)`);
  else {
    if (stamp.mode !== 'real') E(`build stamp mode is "${stamp.mode}" (${stamp.placeholders ?? '?'} placeholders, ${stamp.absent ?? '?'} absent${stamp.unknown ? `, ${stamp.unknown} not the listed bytes` : ''})`);
    if (stamp.manifestSha256 !== manifestSha) E('build stamp was written for a different private-assets.json (run sync, then rebuild)');
  }
  const pub = publicDirOf(m), mapOut = (p) => (pub === '.' ? p : p.startsWith(`${pub}/`) ? p.slice(pub.length + 1) : null);
  const standIns = new Set();
  for (const [p, e] of Object.entries(m.files)) { try { const s = resolvePlaceholder(e, m.packs[e.pack], p); if (s.kind === 'copy') { const b = readIf(path.join(ctx.root, s.path)); if (b) standIns.add(sha256(b)); } } catch { /* reported by check */ } }
  // Private files by their build path: every listed file, and in a dev mirror also the tracked privateGlobs files
  // (generated derivatives such as WAMP's content-hashed tree atlases), whose reference is their committed blob.
  const privateOut = new Map(); // build path -> {p, e, ship, spec()}
  for (const [p, e] of Object.entries(m.files)) { const o = mapOut(p); if (o !== null) privateOut.set(o, { p, e, ship: shipOf(m, p), spec: () => resolvePlaceholder(e, m.packs[e.pack], p) }); }
  if (m.mode === 'mirror' && fs.existsSync(dir)) {
    const index = indexEntries(ctx);
    const gl = globbedPaths(m, [...index.keys()].filter((p) => !m.files[p] && /^1006[0-9]{2}$/.test(index.get(p).mode)));
    const facts = await blobFacts(ctx, gl.map(({ p }) => ({ id: index.get(p).blob, path: p })));
    for (const { p, g } of gl) {
      const o = mapOut(p), e = facts.get(p); if (o === null || !e) continue;
      privateOut.set(o, { p, e: { pack: g.pack, ...e }, ship: m.packs[g.pack]?.ship ?? 'always', spec: () => globSpecOf(m, g, p, e) });
    }
  }
  // ship:never (store-only) bytes must not ship under any name; other listed bytes elsewhere are reported, not refused
  // (a bundler may copy an imported asset under a hashed name).
  const shippable = new Set(Object.entries(m.files).filter(([p]) => shipOf(m, p) !== 'never').map(([, e]) => e.sha256));
  const neverBySha = new Map(), listedBySha = new Map(), sizes = new Set();
  for (const [p, e] of Object.entries(m.files)) {
    if (!e?.sha256 || e.bytes === 0) continue;
    sizes.add(e.bytes);
    if (shipOf(m, p) === 'never' && !shippable.has(e.sha256)) neverBySha.set(e.sha256, p); else if (!listedBySha.has(e.sha256)) listedBySha.set(e.sha256, p);
  }
  let known = null; const io = { knownPaths: () => (known ??= new Set([...repoPaths(ctx), ...Object.keys(m.files)])), read: (rel) => readIf(path.join(ctx.root, rel)) };
  const s4 = new Map(), elsewhere = [];
  if (fs.existsSync(dir)) {
    for (const { rel: r, abs, via, size } of walkBuild(dir)) {
      const rel = nfc(r), hit = privateOut.get(rel), shown = `${dirRel}/${rel}${!via ? '' : via === r ? ' (a symlink)' : ` (through the symlink ${dirRel}/${via})`}`;
      if (rel.split('/').includes(DROP_DIR)) { E(`${shown} is inside a ${DROP_DIR}/ folder (sync's state and temps, or a buyer's imported copies), which never ships; keep it out of the build`); continue; }
      const head = readHead(abs) ?? Buffer.alloc(0);
      if (isPlaceholder(head)) { E(`${shown} is a placeholder`); continue; }
      const buf = (hit || sizes.has(size)) && size <= PNG_FULL_MAX ? readIf(abs) : null;
      let sha = null; const shaOf = () => (sha ??= buf ? sha256(buf) : sha256File(abs));
      if (sizes.has(size)) {
        const never = neverBySha.get(shaOf());
        if (never && never !== hit?.p) { E(`${shown} is a copy of ${never}, which is ship:never (store-only), under another name`); continue; }
        const other = listedBySha.get(shaOf());
        if (other && !hit) { elsewhere.push(`${rel} (${other})`); const pk = m.packs[m.files[other].pack]; if (pk?.section === 4) s4.set(m.files[other].pack, (s4.get(m.files[other].pack) ?? 0) + 1); }
      }
      if (!hit) continue;
      const { e } = hit;
      if (hit.ship === 'never') { E(`${shown} is ship:never (store-only) but is in the build`); continue; }
      if (standIns.has(shaOf())) { E(`${shown} is a copy: stand-in, not the licensed file`); continue; }
      const exact = size === e.bytes && shaOf() === e.sha256;
      const px = !exact && e.pixel && buf ? pixelHash(buf) : null;
      // A placeholder whose marker was stripped, even one private-assets.json recorded as the licensed bytes (an
      // `update` of a stripped placeholder) or that was committed (a dev mirror's generated atlases).
      let spec = null; try { spec = hit.spec(); } catch { /* reported by check */ }
      if (buf && isOwnPlaceholder(buf, spec, hit.p, e, io, { pixel: exact && e.pixel ? e.pixel : px ?? undefined })) { E(`${shown} is a placeholder of ${hit.p} (its marker was stripped), not the licensed file`); continue; }
      if (!exact && !(px && px === e.pixel)) E(`${shown} does not match the licensed bytes ${hit.p} (${m.files[hit.p] ? 'private-assets.json; run update if it was edited on purpose' : 'its committed blob'})`);
      const pk = m.packs[e.pack]; if (pk?.section === 4) s4.set(e.pack, (s4.get(e.pack) ?? 0) + 1);
    }
    for (const [o, { p, ship }] of privateOut) if (ship === 'always' && !fs.existsSync(path.join(dir, o))) warnings.push(`${p} (ship: always) is not in ${dirRel}`);
  }
  const today = todayOf(ctx.env);
  if (s4.size) ctx.log(`shipping ${[...s4.values()].reduce((a, b) => a + b, 0)} files under §4: ${[...s4].map(([id, n]) => { const p = m.packs[id]; return `${id} ${p.decision}${p.reviewBy ? ` by ${p.reviewBy}${p.reviewBy < today ? ' OVERDUE' : ''}` : ''} (${n})`; }).join('; ')}`);
  if (elsewhere.length) ctx.log(`${plural(elsewhere.length, 'listed file')} also in the build under another name (a bundler's copy?): ${elsewhere.slice(0, 3).join(', ')}${elsewhere.length > 3 ? ', …' : ''}`);
  for (const w of warnings.slice(0, 10)) ctx.warn(w);
  if (warnings.length > 10) ctx.warn(`... ${warnings.length - 10} more missing ship:always files`);
  if (!problems.length) { ctx.log(`assets verify-build: ${dirRel} is a real build`); return 0; }
  if (!enforce) { ctx.log('placeholder build; not for production'); return 0; }
  for (const p of problems.slice(0, 40)) ctx.error(`problem: ${p}`);
  if (problems.length > 40) ctx.error(`... ${problems.length - 40} more`);
  ctx.error(`assets verify-build: ${plural(problems.length, 'problem')}; this build must not be deployed`);
  return 1;
}

async function cmdRun(ctx, opts) {
  const want = String(opts.needs ?? '').match(/^real(?::(.+))?$/s);
  if (!want) usageError('run needs --needs real[:<pack id|glob>,…] -- <command…>');
  if (!opts.rest.length) usageError('run needs a command after --');
  const { m } = loadManifest(ctx);
  let selected = Object.keys(m.files).filter((p) => shipOf(m, p) !== 'never');
  if (want[1]) { // only some packs or paths: a check that needs one pack runs once that pack is real
    const items = splitTopLevel(want[1]).map((x) => x.trim()).filter(Boolean);
    const packs = new Set(items.filter((x) => ID_RE.test(x))), globs = compile(items.filter((x) => !ID_RE.test(x)).map((g) => nfc(g.replace(/^\.\//, ''))));
    for (const id of packs) if (!m.packs[id]) usageError(`--needs real:${id}: pack ${id} is not in private-assets.json`);
    selected = selected.filter((p) => packs.has(m.files[p].pack) || matchesAny(globs, p));
    if (!selected.length) usageError(`--needs ${opts.needs} matches no listed file`);
  }
  // Real means the listed bytes (or a PNG's listed pixels), checked now: not merely "no placeholder marker".
  const notReal = selected.filter((p) => { const t = safeTarget(ctx.root, p); return !t.abs || !fileMatches(t.abs, m.files[p]); });
  if (notReal.length) { ctx.print(`skipped (licensed art not present): ${opts.rest.join(' ')}  [${notReal.length} of ${plural(selected.length, 'listed file')} are not the listed bytes, e.g. ${notReal[0]}]`); return 0; }
  const r = spawnSync(opts.rest[0], opts.rest.slice(1), { cwd: ctx.cwd, stdio: 'inherit', env: ctx.env });
  if (r.error) envError(`could not run ${opts.rest[0]}: ${r.error.code ?? r.error.message}`);
  return r.status ?? 1;
}

/** A --placeholder flag value as stored in the manifest: a kind string, "copy:path", or a parsed JSON object. */
function placeholderFlag(v) {
  try { parsePlaceholder(v); } catch (e) { usageError(`--placeholder: ${e.message}`); }
  return v.trim().startsWith('{') ? JSON.parse(v) : v.trim();
}
/**
 * A quoted glob from the command line as a repo-relative glob: like a literal path, it is relative to the current folder
 * (`add '*.png'` in public/assets/foes means public/assets/foes/*.png). Refuses globs that leave the repository or enter .git.
 */
function repoGlob(ctx, input) {
  const g = nfc(input.replace(/^\.\//, '')), here = toPosix(path.relative(ctx.root, ctx.cwd));
  const rel = here && here !== '.' && !here.startsWith('../') && here !== '..' && !path.isAbsolute(here) && !g.startsWith('/') ? path.posix.normalize(`${here}/${g}`) : g;
  if (rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s.toLowerCase() === '.git')) usageError(`${input}: globs are relative to this folder and stay inside the repository, outside .git`);
  return rel;
}
/** Repo paths (NFC) for add's inputs: files, folders (media only), and quoted globs, never through a symlink or out of the repo. */
function resolveInputs(ctx, inputs, { mediaOnly = true } = {}) {
  const out = new Set();
  const mustBeSafe = (rel, input) => { if (!rel) return; const t = safeTarget(ctx.root, rel); if (t.why) usageError(`${input}: ${t.why}. Record files in the repository that really holds them, by their real path`); };
  for (const input of inputs) {
    // A real file or folder by that name wins over the glob reading, so `brace{1}.png` or `q?.png` can be recorded.
    const literal = (() => { try { fs.lstatSync(path.resolve(ctx.cwd, input)); return true; } catch { return false; } })();
    if (hasGlob(input) && !literal) {
      const g = repoGlob(ctx, input);
      const re = globToRegExp(g), staticPrefix = g.slice(0, g.search(/[*?{]/)).replace(/[^/]*$/, '');
      mustBeSafe(staticPrefix.replace(/\/$/, ''), input);
      for (const abs of walkFiles(path.join(ctx.root, staticPrefix))) { const rel = nfc(toPosix(path.relative(ctx.root, abs))); if (re.test(rel) && (!mediaOnly || isMedia(rel))) out.add(rel); }
      continue;
    }
    const abs = path.resolve(ctx.cwd, input), rel = nfc(toPosix(path.relative(ctx.root, abs)));
    if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) usageError(`${input} is outside the repository`);
    mustBeSafe(rel, input);
    let st; try { st = fs.statSync(abs); } catch { usageError(`${input} does not exist`); }
    if (st.isDirectory()) { for (const f of walkFiles(abs)) { const r = nfc(toPosix(path.relative(ctx.root, f))); if (!mediaOnly || isMedia(r)) out.add(r); } }
    else out.add(rel);
  }
  const paths = [...out].filter((p) => !p.startsWith(`${DROP_DIR}/`)).sort(cmp);
  for (const p of paths) {
    // .gitignore has no way to write a newline, and a backtick ends the ASSETS.md code span that names the file
    if (/[\n\r]/.test(p)) usageError(`${JSON.stringify(p)} has a line break in its name, which no .gitignore line can match, so it could never be ignored. Rename it (git mv), then add it.`);
    if (p.includes('`')) usageError(`${JSON.stringify(p)} has a backtick in its name, which breaks the ASSETS.md row naming it. Rename it (git mv), then add it.`);
  }
  return paths;
}
async function snapshotPage(ctx, store, id, url, name) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': `assets.mjs/${VERSION} (terms snapshot)` } });
    if (!r.ok) { ctx.warn(`terms snapshot of ${url} failed: HTTP ${r.status}`); return null; }
    const buf = Buffer.from(await r.arrayBuffer()), day = todayOf(ctx.env);
    await store.writeFile(`packs/${id}/terms/${day}-${name}.html`, buf);
    return { on: day, sha256: sha256(buf) };
  } catch (e) { ctx.warn(`terms snapshot of ${url} failed (${e.cause?.code ?? e.name}); recorded as offline`); return null; }
}
/** Files on disk that a glob matches (ignored ones too), as NFC repo paths. */
function globFiles(ctx, glob) {
  const re = globToRegExp(glob), prefix = glob.slice(0, Math.max(0, glob.search(/[*?{]/))).replace(/[^/]*$/, '');
  if (prefix && safeTarget(ctx.root, prefix.replace(/\/$/, '')).why) return [];
  return walkFiles(path.join(ctx.root, prefix)).map((abs) => nfc(toPosix(path.relative(ctx.root, abs)))).filter((p) => re.test(p));
}
/**
 * Copy generated derivatives (privateGlobs matches, e.g. content-hashed atlases) into the store. `add` only stores the
 * paths it records, so without this a sync from the store could never reach `real` in a published mirror.
 */
async function storeGlobbed(ctx, m, store, filter = () => true, files = null) {
  const res = { stored: 0, present: 0, placeholders: [] };
  // Files read from disk may be placeholders whose marker was stripped: never store those (export refuses them itself).
  const known = files ? null : new Set([...repoPaths(ctx), ...Object.keys(m.files)]), io = { knownPaths: () => known, read: (rel) => readIf(path.join(ctx.root, rel)) };
  for (const g of (m.privateGlobs ?? []).filter(filter)) {
    const list = files ? [...files].filter(([p]) => globToRegExp(g.glob).test(p)) : globFiles(ctx, g.glob).map((p) => [p, readIf(path.join(ctx.root, p))]);
    for (const [p, buf] of list) {
      if (!buf || isPlaceholder(buf)) continue;
      if (!files) { const entry = dimsEntry(buf); if (isOwnPlaceholder(buf, globSpecOf(m, g, p, entry), p, entry, io)) { res.placeholders.push(p); continue; } }
      const f = fileFacts(buf, p);
      const r = await store.writeObject(buf, { sha256: f.sha256, blob: f.blob, pixel: f.pixel ?? null, bytes: f.bytes, w: f.w ?? null, h: f.h ?? null, pack: g.pack, firstPath: p, repo: m.project });
      if (r.wrote) res.stored++; else res.present++;
    }
  }
  if (res.placeholders.length) ctx.warn(`not stored: ${plural(res.placeholders.length, 'generated (privateGlobs) file')} ${res.placeholders.length === 1 ? 'is a placeholder' : 'are placeholders'} with the marker stripped (${res.placeholders.slice(0, 3).join(', ')}${res.placeholders.length > 3 ? ', …' : ''}); put the real files back`);
  return res;
}
async function cmdAdd(ctx, opts) {
  const { m } = loadManifest(ctx); refuseInPublishedMirror(m, 'add');
  const id = opts.pack ?? usageError('add needs --pack <id>');
  if (!ID_RE.test(id)) usageError(`pack id "${id}" must be lowercase kebab-case`);
  if (!opts._.length) usageError('add needs paths, folders, or quoted globs');
  const store = findStore(ctx, opts, { create: true });
  if (m.mode !== 'mirror' && !store) envError(`no private store: create ${defaultStorePath(ctx)} (and mark it Available offline) or set PRIVATE_ASSET_STORE`);
  const storeRec = await readPackRecord(store, id);
  const existed = !!m.packs[id];
  const pack = { ...(storeRec?.public ?? {}), ...(m.packs[id] ?? {}) };
  if (!existed && storeRec?.public) ctx.log(`pack ${id}: reusing the terms recorded in the store`);
  const set = (k, v) => { if (v !== undefined) pack[k] = v; };
  if (opts.section !== undefined) { const s = Number(opts.section); if (s !== 3 && s !== 4) usageError('--section must be 3 or 4'); pack.section = s; }
  pack.section ??= 3;
  set('title', opts.title); set('author', opts.author); set('license', opts.license); set('terms', opts.terms); set('credit', opts.credit);
  set('why', opts.why); set('decision', opts.decision); set('replacement', opts.replacement);
  if (opts['review-by']) pack.reviewBy = opts['review-by'];
  if (opts.paid && opts.free) usageError('pass --paid or --free, not both');
  if (opts.paid) pack.paid = true; if (opts.free) pack.paid = false;
  if (opts.restrict) pack.restrictions = [...new Set(opts.restrict.split(',').map((s) => s.trim()).filter(Boolean))];
  if (opts.ship) { if (!SHIPS.has(opts.ship)) usageError('--ship must be always, build-only, or never'); }
  const fileSpec = opts.placeholder ? placeholderFlag(opts.placeholder) : undefined;
  // source URL from download metadata (never guessed)
  let whereFroms = [], download = null;
  if (opts.download) {
    download = path.resolve(ctx.cwd, opts.download.replace(/^~(?=\/)/, homeOf(ctx)));
    if (!fs.existsSync(download)) usageError(`--download ${opts.download} does not exist`);
    whereFroms = readWhereFroms(download);
    const clean = cleanWhereFroms(whereFroms);
    if (!opts.url && clean) { pack.url = clean; ctx.log(`pack ${id}: source page from download metadata: ${clean}`); }
    if (!pack.acquired && !opts.acquired) { try { pack.acquired = localDay(ctx.env, fs.statSync(download).birthtime); } catch { /* none */ } }
  }
  set('url', opts.url); set('acquired', opts.acquired);
  if (pack.section === 4) {
    // Who decided. `hide` (keep shipping it) is Jonathan's call alone: an agent may only record it after he said so.
    const who = opts['decided-by'];
    if (who !== undefined && !WHO_RE.test(who)) usageError('--decided-by takes a lowercase name, e.g. jonathan');
    if (pack.decision === 'hide' && who !== 'jonathan' && !(m.packs[id]?.decision === 'hide' && m.packs[id]?.decidedBy === 'jonathan' && opts.decision === undefined)) usageError('--decision hide is Jonathan\'s decision only. Ask him; once he has said so, pass --decided-by jonathan. Until then use --decision hold.');
    if (who !== undefined) pack.decidedBy = who;
    else if (opts.decision !== undefined && opts.decision !== m.packs[id]?.decision) pack.decidedBy = 'agent';
    else pack.decidedBy ??= 'agent';
    if (opts.paid === undefined && opts.free === undefined) delete pack.paid;
  }
  if (pack.restrictions && !pack.restrictions.length && pack.section === 4) delete pack.restrictions;
  if (pack.section === 3 && !pack.privateBecause) pack.privateBecause = (pack.restrictions ?? []).includes('no-redistribution') ? 'license' : /\bCC0\b|CC BY|Creative Commons/i.test(pack.license ?? '') ? 'policy' : 'unknown-terms';
  // refuse incomplete records, with the exact question
  const missing = [];
  if (pack.section === 3) {
    if (!pack.url) missing.push(download ? `--url (no usable store page in the download's metadata; ask Jonathan: "Where did you get ${path.basename(download)}? Please send the store page link.")` : '--url <store page> (or --download <original zip>)');
    for (const [k, flag] of [['terms', '--terms "<what we may and may not do>"'], ['title', '--title'], ['author', '--author'], ['license', '--license "<name (URL)>"']]) if (!pack[k]) missing.push(flag);
    if (typeof pack.paid !== 'boolean') missing.push('--paid or --free');
    if (!pack.acquired) missing.push('--acquired YYYY-MM-DD');
    if ((pack.restrictions ?? []).some((r) => r.startsWith('credit-')) && !pack.credit) missing.push('--credit "<credit line>"');
  } else {
    if (!pack.title) missing.push('--title'); if (!pack.why) missing.push('--why "<whose IP and why it cannot be public>"');
    if (!DECISIONS.has(pack.decision)) missing.push('--decision replace|hide|retire|hold');
    if (['replace', 'hide', 'hold'].includes(pack.decision) && !pack.reviewBy) missing.push('--review-by YYYY-MM-DD');
  }
  if (missing.length) problem(`pack ${id} is incomplete; record its source now (nearly impossible to reconstruct later). Missing: ${missing.join('; ')}`);
  const url = pack.url && validatePackUrl(pack.url); if (url) problem(`pack ${id}: url ${url}`);
  for (const r of pack.restrictions ?? []) if (!RESTRICTIONS.has(r)) usageError(`unknown restriction "${r}"`);
  // files
  const paths = resolveInputs(ctx, opts._);
  if (!paths.length) problem('no files matched');
  const index = indexEntries(ctx), knownPaths = new Set([...repoPaths(ctx), ...Object.keys(m.files)]);
  const io = { knownPaths: () => knownPaths, read: (rel) => readIf(path.join(ctx.root, rel)) }, state = readSyncState(ctx);
  const entries = {}, refused = [];
  for (const p of paths) {
    const prev = m.files[p];
    if (prev && prev.pack !== id) problem(`${p} is already listed under pack ${prev.pack} (drop it first: node scripts/assets.mjs update --drop ${shq(p)})`);
    const f = diskFile(path.join(ctx.root, p)) ?? problem(`${p} is not a regular file`);
    const e = { pack: id, ...diskFacts(f, p) };
    const ph = fileSpec ?? prev?.placeholder; if (ph !== undefined) e.placeholder = ph;
    const ship = opts.ship ?? prev?.ship; if (ship !== undefined && ship !== 'always') e.ship = ship;
    // Never record a placeholder as the licensed bytes: with its marker, stripped (re-rendered and compared), or edited
    // after sync wrote it.
    const why = placeholderOrigin(m, p, f, [prev, e].filter(Boolean), { io, state, listed: prev ?? null, packOf: (x) => (x === e ? pack : m.packs[x.pack]) });
    if (why) { if (why.edited && opts['confirm-real']) ctx.warn(`${p} ${why.msg}; recorded anyway (--confirm-real)`); else { refused.push(`${p} ${why.msg}`); continue; } }
    try { const spec = resolvePlaceholder(e, pack, p); if (spec.kind === 'atlas-frame' || spec.kind === 'atlas-texture') renderPlaceholder(spec, p, e, io); }
    catch (err) { problem(`${p}: ${err.message}`); }
    entries[p] = { e, f };
  }
  if (refused.length) problem(placeholderRefusal('add', refused));
  // store side
  const day = todayOf(ctx.env);
  if (store) {
    for (const [p, { e, f }] of Object.entries(entries)) { const r = await storeDiskFile(store, f, { sha256: e.sha256, blob: e.blob, pixel: e.pixel ?? null, bytes: e.bytes, w: e.w ?? null, h: e.h ?? null, pack: id, firstPath: p, repo: m.project }); if (r.skipped) ctx.warn(`${p} not stored: ${r.skipped}; keep a copy in the Dropbox store`); }
    await storeGlobbed(ctx, m, store, (g) => g.pack === id);
    if (!opts['no-snapshot'] && pack.section === 3 && pack.url && !(storeRec && pack.snapshot)) {
      pack.snapshot = await snapshotPage(ctx, store, id, pack.url, 'store-page');
      const licUrl = (pack.license ?? '').match(/https?:\/\/[^\s)]+/)?.[0]; if (licUrl && licUrl !== pack.url) await snapshotPage(ctx, store, id, licUrl, 'license-page');
    } else if (opts['no-snapshot'] && pack.section === 3 && pack.snapshot === undefined) { pack.snapshot = null; ctx.warn(`pack ${id}: no terms snapshot taken (--no-snapshot)`); }
    const rec = storeRec ?? { id, repos: [], downloads: [], whereFroms: [] };
    rec.public = ordered(pack, PACK_KEYS); rec.updated = day;
    if (!rec.repos.includes(m.project)) rec.repos.push(m.project);
    if (opts.price) rec.price = opts.price;
    for (const w of whereFroms) if (!rec.whereFroms.includes(w)) rec.whereFroms.push(w); // private record only
    if (download) {
      // Hash and copy in chunks: a sound library can be several GB, more than one Buffer holds.
      const dst = fs.statSync(download), isZip = dst.isFile(); let copied = null; const dsha = isZip ? sha256File(download) : null;
      if (isZip && path.resolve(download).startsWith(path.join(homeOf(ctx), 'Downloads') + path.sep)) {
        const rel = `original/${path.basename(download)}`;
        if (await store.copyFileIn(`packs/${id}/${rel}`, download)) copied = rel; else ctx.warn(`${path.basename(download)} is over 1 GiB, too large to upload to ${store.label} in one request; keep the original download somewhere safe yourself`);
      }
      if (!rec.downloads.some((d) => d.path === download && d.sha256 === dsha)) rec.downloads.push({ path: download, sha256: dsha, copied });
      let n = 0;
      if (isZip && dst.size > 1 << 30) ctx.warn(`license files not extracted: ${path.basename(download)} is over 1 GiB. Copy its license and readme into packs/${id}/terms/ in the store by hand.`);
      else try { for (const f of sourceFiles(download)) { const base = path.posix.basename(f.name); if (/^(licen[cs]e|readme)/i.test(base) || /\.txt$/i.test(base)) { if (++n > 40) break; await store.writeFile(`packs/${id}/terms/${f.name.replace(/\//g, '__')}`, f.read()); } } }
      catch (err) { ctx.warn(`could not read license files from ${download}: ${err.message}`); }
    }
    await store.writeFile(`packs/${id}/pack.json`, Buffer.from(`${JSON.stringify(rec, null, 2)}\n`));
  } else if (pack.section === 3 && pack.snapshot === undefined) { pack.snapshot = null; ctx.warn(`pack ${id}: no private store reachable, so no terms snapshot was stored`); }
  m.packs[id] = ordered(pack, PACK_KEYS);
  for (const [p, { e }] of Object.entries(entries)) {
    m.files[p] = e;
    // listed again: no longer retired, and bytes an earlier drop forbade are private again rather than forbidden
    if (Array.isArray(m.retired) && m.retired.includes(p)) { m.retired = m.retired.filter((x) => x !== p); if (!m.retired.length) delete m.retired; }
    if (m.forbidden?.blobs?.[e.blob]?.startsWith('dropped ')) { delete m.forbidden.blobs[e.blob]; ctx.log(`${p}: its bytes were forbidden by an earlier drop; listed again, they are private instead`); }
  }
  // Order matters if anything below fails: first the .gitignore block (so the files can't be staged), then the
  // manifest, and only then untrack them. A failed `git rm --cached` then leaves a consistent, safe state.
  regenerate(ctx, m);
  saveManifest(ctx, m);
  if (m.mode !== 'mirror') {
    // Every path must be ignored once untracked. Ask the ignore rules alone (--no-index: tracked files too), before
    // `git rm --cached`, so a nested .gitignore or a later "!" rule that re-includes a file stops add while it is still
    // tracked, instead of leaving it untracked and un-ignored for the next `git add -A`.
    const ign = ignoredSet(ctx, paths, { noIndex: true }), leaks = paths.filter((p) => !ign.has(p));
    if (leaks.length) problem(`.gitignore still does not ignore ${plural(leaks.length, 'file')} after the update (${leaks.slice(0, 3).join(', ')}${leaks.length > 3 ? ', …' : ''}), so nothing was untracked. Look for a later "!" rule, or a .gitignore in a subfolder, that re-includes them (git check-ignore -v --no-index ${shq(leaks[0])} names the file); remove it, then run node scripts/assets.mjs docs and add again`);
    const trackedNow = paths.filter((p) => index.has(p));
    try { for (let i = 0; i < trackedNow.length; i += 200) git(ctx, ['rm', '--cached', '--quiet', '--', ...trackedNow.slice(i, i + 200).map((p) => index.get(p).raw)]); }
    catch (err) { envError(`${err.message}\nThe files are listed and ignored, but some are still tracked. Fix the index (for example: git restore --staged <file>, or wait for the other git process), then run: git rm --cached <paths>. node scripts/assets.mjs check lists them.`); }
    markDropboxIgnored(ctx, paths.map((p) => path.join(ctx.root, p)));
    if (trackedNow.length) ctx.log(`untracked ${plural(trackedNow.length, 'file')} (they stay on disk, ignored)`);
  } else { const untracked = paths.filter((p) => !index.has(p)); if (untracked.length) ctx.log(`mirror mode: remember to git add ${plural(untracked.length, 'new file')}`); }
  ctx.log(`assets add: ${plural(paths.length, 'file')} recorded under pack ${id} (section ${pack.section})${store ? `; objects in ${store.label}` : ''}. Commit the media change, private-assets.json, ASSETS.md, .gitignore${renderCredits(m) ? ', and credits' : ''} together.`);
  return 0;
}

async function cmdUpdate(ctx, opts) {
  const { m } = loadManifest(ctx); refuseInPublishedMirror(m, 'update');
  if (!opts._.length) usageError('update needs paths');
  const listed = Object.keys(m.files);
  const sel = new Set();
  for (const input of opts._) {
    // the listed path spelled literally first (a name may contain glob characters), then the glob reading
    const rel = nfc(toPosix(path.relative(ctx.root, path.resolve(ctx.cwd, input))));
    let hits = listed.filter((p) => p === rel || p.startsWith(`${rel}/`));
    if (!hits.length && hasGlob(input)) { const re = globToRegExp(repoGlob(ctx, input)); hits = listed.filter((p) => re.test(p)); }
    if (!hits.length) problem(`${input} is not listed in private-assets.json (use add)`);
    hits.forEach((h) => sel.add(h));
  }
  const paths = [...sel].sort(cmp);
  if (opts.drop) {
    // Dropping an entry makes its path (and its bytes, under any name) ordinary public content. Refuse while the
    // licensed bytes are still there: tracked at an unlisted path, or (overlay) still on disk at the listed path.
    const index = indexEntries(ctx), remaining = new Set(listed.filter((p) => !sel.has(p))), refusals = [];
    for (const p of opts.public ? [] : paths) { // --public: listed by mistake; its bytes may stay where they are
      const e = m.files[p];
      const still = [...index].filter(([q, ix]) => ix.blob === e.blob && !remaining.has(q) && !(opts.delete && q === p)).map(([q]) => q);
      if (still.length) refusals.push(`${p}: its licensed bytes are still tracked at ${still.slice(0, 3).join(', ')}${still.length > 3 ? ', …' : ''}. ${still.includes(p) ? `Delete it in the same commit (pass --delete, or git rm ${shq(p)}), or use release if the pack became public.` : `List that path first (node scripts/assets.mjs add ${shq(still[0])} --pack ${e.pack}) or remove it (git rm --cached ${shq(still[0])}).`}`);
      if (m.mode !== 'mirror' && !opts.delete && !index.has(p)) { const b = existsExact(ctx.root, p) && diskFile(path.join(ctx.root, p)); if (b && !isPlaceholder(b.head)) refusals.push(`${p} is still on disk as the real file; once dropped it is no longer ignored, so \`git add -A\` would publish it. Pass --delete to delete it as well (the store keeps a copy), or move it out of the repository first.`); }
    }
    if (refusals.length) problem(`update --drop refused:\n  ${refusals.join('\n  ')}`);
    const day = todayOf(ctx.env); let forbade = 0;
    for (const p of paths) {
      const e = m.files[p];
      delete m.files[p];
      // Other checkouts still hold these bytes, untracked. Unless the file was listed by mistake (--public): forbid its
      // bytes everywhere (check fails with an rm fix in every checkout), and keep the path ignored (retired; overlay).
      if (!opts.public) {
        if (e.blob !== EMPTY_BLOB && !Object.values(m.files).some((x) => x.blob === e.blob)) { m.forbidden ??= {}; m.forbidden.blobs ??= {}; if (!m.forbidden.blobs[e.blob]) { m.forbidden.blobs[e.blob] = `dropped ${day}: ${p} (pack ${e.pack}); never commit these bytes, under any name`; forbade++; } }
        if (m.mode !== 'mirror') { m.retired = [...new Set([...(Array.isArray(m.retired) ? m.retired : []), p])].sort(cmp); needTool(m, 'retired'); }
      }
      const abs = path.join(ctx.root, p), b = existsExact(ctx.root, p) ? diskFile(abs, { follow: false }) : null; // never another file on a case-insensitive disk
      if (opts.delete && index.has(p)) git(ctx, ['rm', '-q', '--', index.get(p).raw]);
      else if (b && (isPlaceholder(b.head) || opts.delete)) { const t = safeTarget(ctx.root, p); if (t.abs) fs.rmSync(t.abs, { force: true }); }
    }
    // --public: the file stays as ordinary content, so sync must not treat it as its own stale copy and delete it.
    if (opts.public && m.mode !== 'mirror') {
      const st = safeTarget(ctx.root, STATE_REL), state = readSyncState(ctx);
      if (st.abs && paths.some((p) => state.written[p])) { for (const p of paths) delete state.written[p]; writeIfChanged(st.abs, `${JSON.stringify(state, null, 2)}\n`); }
    }
    regenerate(ctx, m); saveManifest(ctx, m);
    ctx.log(`assets update: dropped ${plural(paths.length, 'entry')}${opts.delete ? ' and deleted the files' : ''}${opts.public ? ' (--public: bytes not forbidden, paths not kept ignored)' : `; ${plural(forbade, 'blob')} forbidden${m.mode !== 'mirror' ? ', and the paths stay ignored (retired), so no other checkout commits its copy' : ''}`}`);
    return 0;
  }
  const ph = opts.placeholder ? placeholderFlag(opts.placeholder) : undefined;
  if (opts.ship && !SHIPS.has(opts.ship)) usageError('--ship must be always, build-only, or never');
  const store = findStore(ctx, opts, { create: true });
  const known = new Set([...repoPaths(ctx), ...listed]), io = { knownPaths: () => known, read: (rel) => readIf(path.join(ctx.root, rel)) }, state = readSyncState(ctx);
  const fieldsOnly = ph !== undefined || !!opts.ship, refused = [];
  let changed = 0;
  for (const p of paths) {
    const e = m.files[p], abs = path.join(ctx.root, p), f = diskFile(abs);
    if (ph !== undefined) { if (ph === 'auto') delete e.placeholder; else e.placeholder = ph; }
    if (opts.ship) { if (opts.ship === 'always') delete e.ship; else e.ship = opts.ship; }
    if (!f) { if (!fieldsOnly) problem(`${p} is ${fs.existsSync(abs) ? 'not a regular file' : 'missing'}; restore it, or drop it with --drop`); continue; }
    if (matchFile(e, f) === 'exact') continue;
    // Never record a placeholder as the licensed bytes: marker stripped, re-rendered, or edited after sync wrote it.
    const why = placeholderOrigin(m, p, f, [e], { io, state, listed: e });
    if (why && !(why.edited && opts['confirm-real'])) { if (!fieldsOnly) refused.push(`${p} ${why.msg}`); continue; }
    if (why) ctx.warn(`${p} ${why.msg}; recorded anyway (--confirm-real)`);
    const facts = diskFacts(f, p);
    delete e.w; delete e.h; delete e.pixel; Object.assign(e, facts); m.files[p] = ordered(e, FILE_KEYS); changed++;
    if (store) { const r = await storeDiskFile(store, f, { sha256: facts.sha256, blob: facts.blob, pixel: facts.pixel ?? null, bytes: facts.bytes, w: facts.w ?? null, h: facts.h ?? null, pack: e.pack, firstPath: p, repo: m.project }); if (r.skipped) ctx.warn(`${p} not stored: ${r.skipped}; keep a copy in the Dropbox store`); }
    else if (m.mode !== 'mirror') ctx.warn(`no private store reachable: the new bytes of ${p} exist only on this disk`);
  }
  if (refused.length) problem(placeholderRefusal('update', refused));
  saveManifest(ctx, m); regenerate(ctx, m);
  ctx.log(`assets update: ${plural(changed, 'file')} re-recorded${ph !== undefined || opts.ship ? ', fields updated' : ''}. Commit with the edit.`);
  return 0;
}

async function cmdRelease(ctx, opts) {
  const { m } = loadManifest(ctx); refuseInPublishedMirror(m, 'release');
  const id = opts._[0] ?? usageError('release needs a pack id'); const pk = m.packs[id] ?? problem(`pack ${id} is not in private-assets.json`);
  const to = Number(opts['to-section'] ?? 2); if (to !== 1 && to !== 2) usageError('--to-section must be 1 or 2');
  const paths = Object.keys(m.files).filter((p) => m.files[p].pack === id).sort(cmp);
  // Real means the listed bytes or, for a PNG, the listed pixels, and never a placeholder (marker stripped or not):
  // release commits these files as the public copies (overlay: git add -f).
  const known = new Set([...repoPaths(ctx), ...Object.keys(m.files)]), io = { knownPaths: () => known, read: (rel) => readIf(path.join(ctx.root, rel)) };
  const notReal = paths.filter((p) => {
    const e = m.files[p], f = diskFile(path.join(ctx.root, p)); if (!f || !matchFile(e, f)) return true;
    let spec = null; try { spec = resolvePlaceholder(e, m.packs[e.pack], p); } catch { /* reported by check */ }
    return !!f.buf && isOwnPlaceholder(f.buf, spec, p, e, io);
  });
  if (notReal.length) problem(`release needs every file of ${id} to be real here (the listed bytes or pixels); not real: ${notReal.slice(0, 10).join(', ')}${notReal.length > 10 ? ' …' : ''}. Run sync with the store (or import the pack), then release again.`);
  for (const p of paths) delete m.files[p];
  if (Array.isArray(m.retired)) { m.retired = m.retired.filter((x) => !paths.includes(x)); if (!m.retired.length) delete m.retired; }
  if (!(m.privateGlobs ?? []).some((g) => g.pack === id)) delete m.packs[id]; else ctx.warn(`pack ${id} stays: privateGlobs still reference it`);
  saveManifest(ctx, m); regenerate(ctx, m);
  if (m.mode !== 'mirror') for (let i = 0; i < paths.length; i += 200) git(ctx, ['add', '-f', '--', ...paths.slice(i, i + 200)]);
  const where = describePaths(paths);
  ctx.print(`Released ${plural(paths.length, 'file')} of ${id}. Paste this row into ASSETS.md section ${to}:`);
  ctx.print(to === 2 ? `| ${where} | [${cell(pk.title)}](${pk.url ?? ''}) | ${cell(pk.author ?? '')} | ${cell(pk.license ?? '')} |` : `| ${where} | ${cell(pk.title)} | ${cell(pk.author ?? 'Jonathan Mann')} | CC BY 4.0 |`);
  return 0;
}

async function cmdForbid(ctx, opts) {
  const { m } = loadManifest(ctx); refuseInPublishedMirror(m, 'forbid');
  if (!opts.why) usageError('forbid needs --why "…"');
  if (!opts._.length) usageError('forbid needs paths or globs');
  m.forbidden ??= {};
  const globs = opts._.map((g) => nfc(g.replace(/^\.\//, '')));
  if (!opts['blobs-only']) { m.forbidden.paths = [...new Set([...(m.forbidden.paths ?? []), ...globs])]; }
  let added = 0;
  if (opts['from-history'] || opts['blobs-only']) {
    if (isShallow(ctx)) envError("this is a shallow clone, so its history is incomplete and old blobs would be missed silently. Run: git fetch --unshallow --tags origin '+refs/heads/*:refs/remotes/origin/*' (or clone without --depth), then run forbid again.");
    const res = compile(globs), keep = new Set(Object.values(m.files).map((e) => e.blob));
    // --blobs-only means the path is still in use with other bytes: the bytes it holds now (index and HEAD) are not
    // history, and forbidding them would fail check at once. --include-current forbids them anyway.
    const current = new Map();
    if (opts['blobs-only'] && !opts['include-current']) {
      for (const [p, e] of indexEntries(ctx)) if (matchesAny(res, p)) current.set(e.blob, p);
      const head = git(ctx, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], { allowFail: true });
      if (head.status === 0) for (const r of String(head.stdout).split('\0')) { if (!r) continue; const tab = r.indexOf('\t'), [, type, bid] = r.slice(0, tab).split(' '), p = nfc(r.slice(tab + 1)); if (type === 'blob' && matchesAny(res, p)) current.set(bid, p); }
    }
    const skippedCurrent = new Map(), seenPairs = [];
    // Every (path, blob) any commit's diff names, merges included: `-m` diffs a merge against each parent, so bytes that
    // exist only in a merge commit (a conflict resolved with new bytes, on any of WAMP's ~386 branches) are recorded.
    const log = git(ctx, ['log', '--all', '-m', '--no-renames', '--raw', '--no-abbrev', '--format=', '-z']);
    const toks = log.split('\0');
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i].replace(/^\n+/, ''); if (!t.startsWith(':')) continue;
      const [, , oldId, newId] = t.slice(1).split(' '), raw = toks[++i], p = raw && nfc(raw);
      if (p) seenPairs.push([oldId, p], [newId, p]);
    }
    // Plus every blob reachable from any ref, under the path rev-list names it by: what no diff shows (a root commit
    // or a grafted history) is still recorded. cat-file keeps blobs (trees have paths too) and passes the path through.
    const objs = git(ctx, ['rev-list', '--objects', '--all']);
    if (objs.trim()) for (const line of git(ctx, ['cat-file', '--batch-check=%(objecttype) %(objectname) %(rest)'], { input: objs }).split('\n')) {
      const m1 = line.match(/^blob ([0-9a-f]{40}) (.+)$/); if (m1) seenPairs.push([m1[1], nfc(m1[2])]);
    }
    m.forbidden.blobs ??= {};
    for (const [b, p] of seenPairs) {
      if (!res.some((r) => r.re.test(p))) continue;
      if (!/^[0-9a-f]{40}$/.test(b) || /^0+$/.test(b) || keep.has(b) || m.forbidden.blobs[b]) continue;
      if (current.has(b)) { skippedCurrent.set(b, current.get(b)); continue; }
      m.forbidden.blobs[b] = `${p}: ${opts.why}`; added++;
    }
    for (const [b, p] of skippedCurrent) ctx.log(`skipped blob ${b.slice(0, 12)}: it is in use now at ${p} (pass --include-current to forbid it anyway)`);
  }
  saveManifest(ctx, m); regenerate(ctx, m);
  const trackedNow = [...indexEntries(ctx).keys()].filter((p) => matchesAny(compile(globs), p));
  ctx.log(`assets forbid: ${opts['blobs-only'] ? '' : `${plural(globs.length, 'glob')} forbidden; `}${plural(added, 'historical blob')} recorded`);
  if (!opts['blobs-only'] && trackedNow.length) ctx.warn(`still tracked (remove them): ${trackedNow.slice(0, 10).join(', ')}`);
  return 0;
}

/**
 * The facts `fileFacts` records (sha256, blob, bytes, w/h, pixel) for blobs, streamed: sha256 incrementally, the first
 * 256 KB for image dimensions, and the whole blob only for a PNG's pixel hash (up to PNG_FULL_MAX).
 */
async function blobFacts(ctx, items, heads = null) {
  const pathsOf = new Map(); for (const { id, path: p } of items) { if (!pathsOf.has(id)) pathsOf.set(id, []); pathsOf.get(id).push(p); }
  const out = new Map();
  await catFileBatch(ctx, [...pathsOf.keys()], (id, size, type) => {
    if (type !== 'blob') return null;
    const png = pathsOf.get(id).some((p) => extOf(p) === 'png') && size <= PNG_FULL_MAX, keep = png ? size : Math.min(size, 256 * 1024);
    const h = crypto.createHash('sha256'), buf = Buffer.alloc(keep); let got = 0;
    return {
      data: (c) => { h.update(c); if (got < keep) { const n = Math.min(c.length, keep - got); c.copy(buf, got, 0, n); got += n; } },
      end: () => out.set(id, { sha: h.digest('hex'), head: buf, size, png }),
    };
  });
  const facts = new Map();
  for (const { id, path: p } of items) {
    const b = out.get(id); if (!b) continue;
    const e = { sha256: b.sha, blob: id, bytes: b.size };
    if (heads) heads.set(p, b.head.subarray(0, 4096));
    if (IMAGE_EXT.has(extOf(p)) || extOf(p) === 'ico') { const d = imageSize(b.head); if (d) { e.w = d.w; e.h = d.h; } }
    if (extOf(p) === 'png' && b.png) { const ph = pixelHash(b.head); if (ph) e.pixel = ph; }
    facts.set(p, e);
  }
  return facts;
}
/** A file path under the export folder, creating real folders on the way and refusing to go through a symlink or file. */
function exportTarget(out, rel) {
  const segs = rel.split('/'); let cur = out;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = path.join(cur, segs[i]);
    let st = null; try { st = fs.lstatSync(cur); } catch { /* not there yet */ }
    if (!st) fs.mkdirSync(cur);
    else if (st.isSymbolicLink() || !st.isDirectory()) problem(`export stopped: ${segs.slice(0, i + 1).join('/')} is ${st.isSymbolicLink() ? 'a symlink' : 'a file'} in the export, so ${rel} would be written through it (names that differ only by case?)`);
  }
  const abs = path.join(cur, segs[segs.length - 1]);
  let exists = false; try { fs.lstatSync(abs); exists = true; } catch { /* free */ }
  if (exists) problem(`export stopped: ${rel} already exists in the export (two names that differ only by case?)`);
  return abs;
}
async function cmdExport(ctx, opts) {
  const { m: work } = loadManifest(ctx);
  if (work.mode !== 'mirror') usageError('export runs only in a mirror-mode dev repo');
  if (!opts.out) usageError('export needs --out <dir>');
  const out = path.resolve(ctx.cwd, opts.out);
  if (!opts['dry-run'] && fs.existsSync(out) && fs.readdirSync(out).length) usageError(`${opts.out} is not empty; export writes into an empty folder`);
  // HEAD's tree with sizes, never the working tree. Blobs are streamed, and only those the export (or a rule) needs.
  const rows = git(ctx, ['ls-tree', '-r', '-z', '-l', '--full-tree', 'HEAD']).split('\0').filter(Boolean).map((r) => {
    const tab = r.indexOf('\t'), [mode, type, id, size] = r.slice(0, tab).split(/ +/);
    return { mode, type, id, size: Number(size) || 0, path: nfc(r.slice(tab + 1)) };
  });
  const byPath = new Map(), problems = [];
  for (const r of rows) { if (byPath.has(r.path)) problems.push({ rule: 'path', msg: `${r.path} is in HEAD twice (as NFC and NFD names); an export would keep only one`, fix: 'rename one of them' }); byPath.set(r.path, r); }
  const whole = async (rels) => { const want = new Map(); for (const rel of rels) { const r = byPath.get(rel); if (r?.type === 'blob') want.set(r.id, Infinity); } return readBlobPrefixes(ctx, want); };
  const manifestRow = byPath.get(ctx.manifestRel) ?? envError(`${ctx.manifestRel} is not committed at HEAD`);
  const mText = (await whole([ctx.manifestRel])).get(manifestRow.id)?.buf.toString('utf8') ?? envError(`${ctx.manifestRel} is not committed at HEAD`);
  let m; try { m = normalizeManifest(JSON.parse(mText)); } catch (e) { envError(`${ctx.manifestRel} at HEAD is not valid JSON: ${e.message}`); }
  if (m.mode !== 'mirror') usageError('the committed manifest is not in mirror mode');
  const headHasSrc = rows.some((r) => r.path.startsWith('src/'));
  const controlRels = [...new Set(['ASSETS.md', '.gitignore', creditsRel(m, headHasSrc), 'credits.json', 'src/generated/credits.json'])];
  const control = await whole(controlRels);
  const headFile = (p) => { const r = byPath.get(p); if (!r) return null; if (p === ctx.manifestRel) return Buffer.from(mText); return control.get(r.id)?.buf ?? null; };
  for (const r of rows) { const bad = relPathProblem(r.path); if (bad) problems.push({ rule: 'path', msg: `${r.path} ${bad}; it cannot be exported`, fix: `git rm --cached ${shq(r.path)}` }); }
  // the dev tree's generated blocks must already be current (fail closed on a stale block)
  const devExp = expectedOutputs(m, headHasSrc, (rel) => headFile(rel)?.toString('utf8') ?? null);
  for (const [rel, t] of Object.entries(devExp)) if ((headFile(rel)?.toString('utf8') ?? null) !== t) problems.push({ rule: 'docs', msg: `${rel} at HEAD is stale`, fix: 'node scripts/assets.mjs docs, then commit' });
  const listed = new Set(Object.keys(m.files)), globs = (m.privateGlobs ?? []).map((g) => ({ ...g, re: globToRegExp(g.glob) }));
  const excluded = compile(m.exclude), forbidden = compile(m.forbidden?.paths), fblobs = m.forbidden?.blobs ?? {};
  const pub = JSON.parse(JSON.stringify(m)); pub.mode = 'published-mirror'; delete pub.exclude;
  const kept = new Map(), globbed = [], counts = { private: 0, globbed: 0, excluded: 0, forbidden: 0, submodules: 0 };
  for (const r of rows) {
    if (r.type !== 'blob') { counts.submodules++; ctx.warn(`${r.path}: submodule not exported`); continue; }
    if (listed.has(r.path)) { counts.private++; continue; } // never read: the blob id is enough to leave it out
    const g = globs.find((x) => x.re.test(r.path));
    if (g) { counts.globbed++; globbed.push({ r, g }); continue; }
    if (matchesAny(excluded, r.path)) { counts.excluded++; continue; }
    if (matchesAny(forbidden, r.path) || fblobs[r.id]) { counts.forbidden++; continue; }
    kept.set(r.path, r);
  }
  const gHeads = new Map(), gFacts = await blobFacts(ctx, globbed.map(({ r }) => ({ id: r.id, path: r.path })), gHeads);
  // A generated file's facts come from HEAD, so a committed placeholder (marker stripped by an optimizer) would be recorded
  // as the real file and every published-mirror sync would call it real. Refuse it (fails closed).
  const atlasRels = new Set(), gSpec = new Map();
  for (const { r, g } of globbed) {
    const entry = dimsEntry(gHeads.get(r.path)), spec = globSpecOf(m, g, r.path, entry); gSpec.set(r.path, { spec, entry });
    if (spec?.atlas) try { atlasRels.add(resolveAtlas(expandDirName(spec.atlas, r.path), new Set(byPath.keys()))); } catch { /* reported as a problem below */ }
  }
  const atlasText = await whole([...atlasRels]);
  const headIo = { knownPaths: () => new Set(byPath.keys()), read: (rel) => atlasText.get(byPath.get(rel)?.id)?.buf ?? null };
  for (const { r, g } of globbed) {
    const { spec, entry } = gSpec.get(r.path), head = gHeads.get(r.path) ?? null;
    if (head && isOwnPlaceholder(head, spec, r.path, { ...entry, ...gFacts.get(r.path) }, headIo, { pixel: gFacts.get(r.path)?.pixel ?? null })) problems.push({ rule: 'placeholder', path: r.path, msg: `${r.path} at HEAD is a placeholder (privateGlobs ${g.glob}${isPlaceholder(head) ? '' : ', marker stripped'}), not the generated art; the export would record its bytes as the real file`, fix: `put the real file back (git checkout <good ref> -- ${shq(r.path)}, or rebuild it from the pack's files) and commit` });
  }
  for (const { r, g } of globbed) {
    const e = { pack: g.pack, ...gFacts.get(r.path) };
    if (g.placeholder) { const spec = parsePlaceholder(g.placeholder); e.placeholder = spec.atlas ? { ...spec, atlas: expandDirName(spec.atlas, r.path) } : g.placeholder; }
    pub.files[r.path] = e;
  }
  // What the rules read of each exported file: a prefix (all of a PNG, and of a symlink's target).
  const wants = new Map(); for (const [p, r] of kept) wants.set(r.id, Math.max(wants.get(r.id) ?? 0, r.mode === '120000' ? Infinity : guardWant(p)));
  const blobs = await readBlobPrefixes(ctx, wants);
  const pubText = serializeManifest(pub), overrides = new Map([[ctx.manifestRel, Buffer.from(pubText)]]);
  const current = (rel) => (overrides.has(rel) ? overrides.get(rel) : kept.has(rel) ? headFile(rel) : null);
  const exp = expectedOutputs(pub, headHasSrc, (rel) => current(rel)?.toString('utf8') ?? null);
  const dropped = new Set();
  for (const [rel, t] of Object.entries(exp)) { if (t === null) dropped.add(rel); else overrides.set(rel, Buffer.from(t)); }
  const files = new Map(); // path -> {mode, row} (streamed from git) or {mode, buf} (generated here)
  for (const [p, r] of kept) if (!overrides.has(p) && !dropped.has(p)) files.set(p, { mode: r.mode, row: r });
  for (const [p, buf] of overrides) files.set(p, { mode: kept.get(p)?.mode ?? '100644', buf });
  const tree = new Map([...files].map(([p, f]) => [p, f.buf ? { blob: gitBlobId(f.buf), mode: f.mode, read: (n) => f.buf.subarray(0, n), full: () => f.buf } : blobEntry(f.row.id, f.mode, blobs)]));
  const guard = runGuard(JSON.parse(pubText), { tree, read: (rel) => files.get(rel)?.buf ?? null, hasSrc: headHasSrc, publicTree: true, today: todayOf(ctx.env), checkDocs: false, exporting: true });
  guard.problems.unshift(...problems);
  const summary = `${files.size} files; omitted ${counts.private} listed, ${counts.globbed} privateGlobs, ${counts.excluded} excluded, ${counts.forbidden} forbidden`;
  if (guard.problems.length) { ctx.error('assets export: refusing to export (fails closed); nothing was written'); return reportGuard(ctx, 'assets export', guard); }
  // Files the dev repo tracks although its .gitignore ignores them (WAMP's progress.md): they are exported, and the
  // mirror workflow must commit them with `git add -A --force` or the mirror silently differs from the export.
  const ignoredTracked = git(ctx, ['ls-files', '-ci', '--exclude-standard', '-z']).split('\0').filter(Boolean).map(nfc).filter((p) => files.has(p));
  if (ignoredTracked.length) guard.warnings.push({ rule: 'ignored', msg: `${plural(ignoredTracked.length, 'exported file')} match .gitignore although tracked (${ignoredTracked.slice(0, 3).join(', ')}${ignoredTracked.length > 3 ? ', …' : ''}): commit the export with \`git add -A --force\` (publish-mirror.yml does), or untrack them` });
  if (opts['dry-run']) return reportGuard(ctx, 'assets export (dry run)', guard, { summary });
  // Generated derivatives (privateGlobs) live nowhere but git: keep a copy in the store, when one is reachable.
  try {
    const store = findStore(ctx);
    if (store && globbed.length) {
      let n = 0, present = 0, batch = [], total = 0;
      const flush = async () => { if (!batch.length) return; const got = await readBlobPrefixes(ctx, new Map(batch.map(({ r }) => [r.id, Infinity]))); const res = await storeGlobbed(ctx, m, store, () => true, batch.map(({ r }) => [r.path, got.get(r.id)?.buf ?? null])); n += res.stored; present += res.present; batch = []; total = 0; };
      for (const x of globbed) { batch.push(x); total += x.r.size; if (total > 128 * 1024 * 1024) await flush(); }
      await flush();
      if (n) ctx.log(`stored ${plural(n, 'generated file')} (privateGlobs) in ${store.label}${present ? `; ${present} already there` : ''}`);
    }
  } catch (e) { ctx.warn(`could not copy generated files (privateGlobs) to the store: ${e.message}`); }
  // Write: regular files streamed from git, then generated files, then symlinks last, never through a symlinked folder.
  fs.mkdirSync(out, { recursive: true });
  const ordered = [...files].sort(([a], [b]) => cmp(a, b));
  const streamed = new Map(); for (const [p, f] of ordered) if (f.row && f.mode !== '120000') { if (!streamed.has(f.row.id)) streamed.set(f.row.id, []); streamed.get(f.row.id).push(p); }
  await catFileBatch(ctx, [...streamed.keys()], (id) => {
    const fds = (streamed.get(id) ?? []).map((p) => fs.openSync(exportTarget(out, p), 'wx'));
    return { data: (c) => { for (const fd of fds) fs.writeSync(fd, c); }, end: () => { for (const fd of fds) fs.closeSync(fd); } };
  });
  for (const [p, f] of ordered) if (f.buf && f.mode !== '120000') fs.writeFileSync(exportTarget(out, p), f.buf, { flag: 'wx' });
  for (const [p, f] of ordered) if (f.mode === '100755') fs.chmodSync(path.join(out, ...p.split('/')), 0o755);
  for (const [p, f] of ordered) if (f.mode === '120000') fs.symlinkSync((f.buf ?? blobs.get(f.row.id)?.buf ?? Buffer.alloc(0)).toString('utf8'), exportTarget(out, p));
  return reportGuard(ctx, `assets export -> ${opts.out}`, guard, { summary });
}

/**
 * `store push`: copy every listed file that is real here (its exact listed bytes) into the store, with its sidecar, plus
 * the privateGlobs derivatives and a pack record for packs the store has never seen. A manifest seeded elsewhere (or a
 * new R2 bucket) starts with an empty store; this fills it without re-running `add` for every pack.
 */
async function cmdStore(ctx, opts) {
  if (opts._[0] !== 'push' || opts._.length > 1) usageError('usage: node scripts/assets.mjs store push [--store <dir|s3://…|r2://…>]');
  const { m } = loadManifest(ctx);
  const store = findStore(ctx, opts, { create: true }) ?? envError(`no private store: create ${defaultStorePath(ctx)} (and mark it Available offline), or set PRIVATE_ASSET_STORE / --store`);
  let stored = 0, present = 0; const notReal = [];
  for (const p of Object.keys(m.files).sort(cmp)) {
    const e = m.files[p], info = await store.objectInfo(e.sha256);
    if (info && info.bytes === e.bytes) { present++; continue; }
    const t = safeTarget(ctx.root, p), f = t.abs ? diskFile(t.abs) : null; // any size: hashed and copied in chunks
    if (!f || f.size !== e.bytes || f.sha() !== e.sha256) { notReal.push(p); continue; }
    const r = await storeDiskFile(store, f, { sha256: e.sha256, blob: e.blob, pixel: e.pixel ?? null, bytes: e.bytes, w: e.w ?? null, h: e.h ?? null, pack: e.pack, firstPath: p, repo: m.project });
    if (r.skipped) { ctx.warn(`${p} not stored: ${r.skipped}`); continue; }
    stored++;
  }
  const globbed = m.mode === 'published-mirror' ? { stored: 0, present: 0 } : await storeGlobbed(ctx, m, store);
  let records = 0; const day = todayOf(ctx.env);
  for (const id of Object.keys(m.packs).sort(cmp)) {
    const rec = await readPackRecord(store, id);
    if (rec && (rec.repos ?? []).includes(m.project)) continue;
    const next = rec ?? { id, repos: [], downloads: [], whereFroms: [] };
    next.repos = [...new Set([...(next.repos ?? []), m.project])]; next.public ??= ordered(m.packs[id], PACK_KEYS); next.updated = day;
    await store.writeFile(`packs/${id}/pack.json`, Buffer.from(`${JSON.stringify(next, null, 2)}\n`)); records++;
  }
  ctx.log(`assets store push -> ${store.label}: ${plural(stored, 'object')} stored, ${present} already there${globbed.stored + globbed.present ? `; generated files (privateGlobs): ${globbed.stored} stored, ${globbed.present} already there` : ''}; ${plural(records, 'pack record')} written`);
  if (!notReal.length) return 0;
  ctx.error(`${plural(notReal.length, 'listed file')} ${notReal.length === 1 ? 'is' : 'are'} not the listed bytes here (placeholders, absent, or edited), so ${notReal.length === 1 ? 'it was' : 'they were'} not stored:`);
  for (const p of notReal.slice(0, 20)) ctx.error(`  ${p}`);
  if (notReal.length > 20) ctx.error(`  ... ${notReal.length - 20} more`);
  ctx.error('Run store push where they are real (the dev checkout, or the original downloads after import and sync).');
  return 1;
}

async function cmdStatus(ctx, opts) {
  const { m } = loadManifest(ctx), today = todayOf(ctx.env);
  const counts = { real: 0, placeholder: 0, absent: 0, unknown: 0, drift: 0, never: 0 };
  const known = new Set([...repoPaths(ctx), ...Object.keys(m.files)]), io = { knownPaths: () => known, read: (rel) => readIf(path.join(ctx.root, rel)) };
  for (const [p, e] of Object.entries(m.files)) {
    if (shipOf(m, p) === 'never') { counts.never++; continue; }
    const f = diskFile(path.join(ctx.root, p)), k = f && !isPlaceholder(f.head) ? matchFile(e, f) : null;
    if (!f) counts.absent++;
    else if (k) { counts.real++; if (k === 'pixels') counts.drift++; }
    else { let spec = null; try { spec = resolvePlaceholder(e, m.packs[e.pack], p); } catch { /* reported by check */ } if (isPlaceholder(f.head) || (f.buf && isOwnPlaceholder(f.buf, spec, p, e, io))) counts.placeholder++; else counts.unknown++; }
  }
  if (m.mode === 'mirror') { // tracked privateGlobs files, as sync counts them: real means the committed bytes
    const index = indexEntries(ctx);
    for (const { p, g } of globbedPaths(m, [...index.keys()].filter((q) => !m.files[q] && /^1006[0-9]{2}$/.test(index.get(q).mode)))) {
      if ((m.packs[g.pack]?.ship ?? 'always') === 'never') { counts.never++; continue; }
      const f = diskFile(path.join(ctx.root, p)), entry = dimsEntry(f?.buf ?? f?.head);
      if (!f) counts.absent++;
      else if (isPlaceholder(f.head) || (f.buf && isOwnPlaceholder(f.buf, globSpecOf(m, g, p, entry), p, entry, io))) counts.placeholder++;
      else if (f.blob() === index.get(p).blob) counts.real++; else counts.unknown++;
    }
  }
  const store = (() => { try { return findStore(ctx, opts); } catch { return null; } })();
  const health = { store: store?.label ?? null, objects: 0, missing: 0, empty: 0 };
  if (store) for (const e of Object.values(m.files)) { const info = await store.objectInfo(e.sha256); if (!info) health.missing++; else if (info.bytes === 0) health.empty++; else health.objects++; }
  const overdue = Object.entries(m.packs).filter(([, p]) => p.reviewBy && p.reviewBy < today).map(([id, p]) => ({ pack: id, decision: p.decision ?? null, reviewBy: p.reviewBy }));
  const kitV = versionOfFile(path.join(kitRoot(ctx), 'tools', 'assets', 'assets.mjs'));
  const res = { mode: m.mode, project: m.project, counts, store: health, overdue, tool: VERSION, kit: kitV };
  if (opts.restriction) res.restricted = Object.keys(m.files).filter((p) => restrictionsOf(m.packs[m.files[p].pack]).includes(opts.restriction)).sort(cmp);
  if (opts.remote) {
    if (m.mode !== 'mirror') ctx.warn('--remote is for mirror mode'); else {
      const gh = (args) => { const r = spawnSync('gh', args, { encoding: 'utf8', env: ctx.env }); return r.status === 0 ? r.stdout.trim() : null; };
      res.remote = { repo: m.mirror.public, lastExport: gh(['api', `repos/${m.mirror.public}/commits/HEAD`, '--jq', '.commit.committer.date + " " + .sha[0:12]']),
        lastQuality: gh(['run', 'list', '--repo', m.mirror.public, '--workflow', 'quality.yml', '--limit', '1', '--json', 'conclusion,status,createdAt', '--jq', '.[0] | "\\(.status) \\(.conclusion) \\(.createdAt)"']) };
    }
  }
  if (ctx.json) { ctx.print(JSON.stringify(res, null, 2)); return 0; }
  ctx.print(`mode ${m.mode} (${m.project}); files: ${counts.real} real, ${counts.placeholder} placeholder, ${counts.absent} absent, ${counts.unknown} not the listed bytes, ${counts.drift} drift${counts.never ? `, ${counts.never} store-only` : ''}`);
  ctx.print(store ? `store ${store.label}: ${health.objects} present, ${health.missing} missing, ${health.empty} empty${health.empty ? ' (Dropbox online-only stubs? mark the store Available offline)' : ''}` : 'store: none reachable (set PRIVATE_ASSET_STORE or create the Dropbox store)');
  if (store && health.missing) ctx.print(`  fix: node scripts/assets.mjs store push${opts.store ? ` --store ${shq(opts.store)}` : ''}   (copies every listed file that is real here into the store; run it where the files are real, e.g. the dev checkout)`);
  for (const o of overdue) ctx.print(`OVERDUE: ${o.pack} ${o.decision ?? ''} review by ${o.reviewBy}`);
  ctx.print(`assets.mjs ${VERSION}${kitV ? `; kit ${kitV}${semverCmp(VERSION, kitV) < 0 ? ' (newer: run vendor)' : ''}` : ''}`);
  if (res.restricted) { ctx.print(`files under ${opts.restriction}: ${res.restricted.length}`); for (const p of res.restricted) ctx.print(`  ${p}`); }
  if (res.remote) ctx.print(`mirror ${res.remote.repo}: last export ${res.remote.lastExport ?? 'unknown'}; last Quality run ${res.remote.lastQuality ?? 'unknown'}`);
  return 0;
}

function hashSources(inputs, ctx) {
  const bySha = new Map(), byPixel = new Map(); let n = 0;
  for (const input of inputs) {
    const abs = path.resolve(ctx.cwd, input.replace(/^~(?=\/)/, homeOf(ctx)));
    let list; try { list = sourceFiles(abs); } catch (e) { problem(`${input}: ${e.message}`); }
    for (const f of list) {
      if (!isMedia(f.name)) continue;
      const buf = f.read(), label = `${path.basename(abs)}:${f.name}`; n++;
      bySha.set(sha256(buf), { label, buf });
      if (extOf(f.name) === 'png') { const ph = pixelHash(buf); if (ph && !byPixel.has(ph)) byPixel.set(ph, { label, buf }); }
    }
  }
  return { bySha, byPixel, n };
}
async function cmdScan(ctx, opts) {
  const { m } = loadManifest(ctx);
  const repoFiles = new Set(git(ctx, ['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter((p) => p && isMedia(p) && !p.startsWith(`${DROP_DIR}/`)));
  for (const p of Object.keys(m.files)) if (fs.existsSync(path.join(ctx.root, p))) repoFiles.add(p);
  const repo = [...repoFiles].sort(cmp).map((p) => { const buf = readIf(path.join(ctx.root, p)); return buf && !isPlaceholder(buf) ? { p, sha: sha256(buf), pixel: extOf(p) === 'png' ? pixelHash(buf) : null } : null; }).filter(Boolean);
  const matches = [];
  if (opts.store) {
    const store = findStore(ctx) ?? envError('no private store reachable');
    const bySha = new Map(), byPixel = new Map();
    for (const s of await store.sidecars()) { bySha.set(s.sha256, s); if (s.pixel) byPixel.set(s.pixel, s); }
    for (const r of repo) { const s = bySha.get(r.sha) ?? (r.pixel && byPixel.get(r.pixel)); if (s) matches.push({ path: r.p, how: bySha.has(r.sha) ? 'bytes' : 'pixels', source: `store ${s.pack} (${s.repo}: ${s.firstPath})`, pack: s.pack, listed: m.files[r.p]?.pack ?? null }); }
  } else {
    if (!opts._.length) usageError('scan needs <zip|dir>… (or --store)');
    const src = hashSources(opts._, ctx);
    for (const r of repo) { const s = src.bySha.get(r.sha) ?? (r.pixel && src.byPixel.get(r.pixel)); if (s) matches.push({ path: r.p, how: src.bySha.has(r.sha) ? 'bytes' : 'pixels', source: s.label, listed: m.files[r.p]?.pack ?? null }); }
    ctx.log(`scanned ${plural(src.n, 'media file')} in ${opts._.join(', ')}`);
  }
  const unlisted = matches.filter((x) => !x.listed);
  if (ctx.json) ctx.print(JSON.stringify({ matches, unlisted: unlisted.map((x) => x.path) }, null, 2));
  else { for (const x of matches) ctx.print(`${x.how === 'bytes' ? 'bytes ' : 'pixels'}  ${x.path}  <- ${x.source}  [${x.listed ? `listed: ${x.listed}` : 'NOT LISTED'}]`); ctx.print(`${plural(matches.length, 'repo file')} match; ${unlisted.length} not yet in private-assets.json`); }
  if (opts.record && unlisted.length) {
    const pack = opts.pack ?? usageError('--record needs --pack <id>');
    const addOpts = { ...opts, _: unlisted.map((x) => x.path), pack };
    for (const k of ['record', 'store']) delete addOpts[k];
    return cmdAdd({ ...ctx, cwd: ctx.root }, addOpts);
  }
  return 0;
}

async function cmdImport(ctx, opts) {
  const { m } = loadManifest(ctx);
  if (!opts._.length) usageError('import needs <zip|dir>…');
  const src = hashSources(opts._, ctx); let n = 0;
  // What is still missing, by what a buyer can do about it: §3 packs (buyable) by pack, then what nobody can supply.
  const byPack = new Map(), cannot = { s4: 0, generated: 0 }; let never = 0;
  for (const [p, e] of Object.entries(m.files).sort(([a], [b]) => cmp(a, b))) {
    if (shipOf(m, p) === 'never') { never++; continue; } // store-only: never shipped, so never placed
    const s = src.bySha.get(e.sha256) ?? (e.pixel && src.byPixel.get(e.pixel));
    const t = s && safeTarget(ctx.root, `${DROP_DIR}/${p}`);
    if (s && !t.why) { writeAtomic(t.abs, s.buf); n++; continue; }
    if (s) ctx.warn(`${DROP_DIR}/${p} not written: ${t.why}`);
    if (m.packs[e.pack]?.section === 4) cannot.s4++;
    else if ((m.privateGlobs ?? []).some((g) => g.pack === e.pack && globToRegExp(g.glob).test(p))) cannot.generated++;
    else { if (!byPack.has(e.pack)) byPack.set(e.pack, []); byPack.get(e.pack).push(p); }
  }
  const buyable = [...byPack.values()].reduce((a, l) => a + l.length, 0);
  ctx.log(`assets import: ${plural(n, 'file')} placed in ${DROP_DIR}/ from ${plural(src.n, 'media file')}; ${buyable} files of licensed packs still unmatched`);
  let shown = 0;
  for (const [id, list] of [...byPack].sort(([a, x], [b, y]) => y.length - x.length || cmp(a, b))) {
    const pk = m.packs[id] ?? {};
    ctx.log(`  pack ${id}: ${pk.title ?? id}${pk.url ? ` (${pk.url})` : ''}: ${plural(list.length, 'file')} unmatched`);
    const k = Math.max(0, Math.min(5, 30 - shown)); shown += k;
    for (const p of list.slice(0, k)) ctx.log(`    unmatched: ${p}`);
    if (list.length > k) ctx.log(`    ... ${list.length - k} more`);
  }
  if (buyable) ctx.log('  Files Jonathan edited (recolours, crops, composites) match no download; they stay placeholders unless you place your own copies.');
  if (cannot.generated) ctx.log(`  ${plural(cannot.generated, 'generated file')} (privateGlobs) are rebuilt by sync once their pack's files are real.`);
  if (cannot.s4) ctx.log(`  ${plural(cannot.s4, 'file')} under ASSETS.md §4 (not ours and not licensed) stay placeholders: no download can supply them.`);
  if (never) ctx.log(`  ${plural(never, 'store-only file')} (ship: never) skipped.`);
  ctx.log('Now run: node scripts/assets.mjs sync');
  return 0;
}

async function cmdLeakscan(ctx, opts) {
  const { m } = loadManifest(ctx);
  // A shallow clone (actions/checkout's default depth 1) holds only part of the history: a scan of it proves nothing.
  if (isShallow(ctx)) envError("this is a shallow clone, so leakscan would check only part of the history and under-report. Fetch everything first: git fetch --unshallow --tags origin '+refs/*:refs/remotes/all/*' (in CI: actions/checkout with fetch-depth: 0), then run leakscan again.");
  const ids = new Map(); const add = (id, label, kind) => { if (/^[0-9a-f]{40}$/.test(id) && id !== EMPTY_BLOB && !ids.has(id)) ids.set(id, { label, kind }); };
  for (const [p, e] of Object.entries(m.files)) add(e.blob, `listed ${p} (${e.pack})`, 'listed');
  for (const [b, note] of Object.entries(m.forbidden?.blobs ?? {})) add(b, `forbidden: ${note}`, 'forbidden');
  if (opts.store) {
    const store = findStore(ctx) ?? envError('no private store reachable');
    const side = new Map((await store.sidecars()).map((s) => [s.sha256, s]));
    for (const sha of await store.objectIds()) { const s = side.get(sha); if (s?.blob) add(s.blob, `store object ${sha.slice(0, 12)} (${s.pack}: ${s.firstPath})`, 'store'); else { const b = await store.readObject(sha); if (b) add(gitBlobId(b), `store object ${sha.slice(0, 12)}`, 'store'); } }
  }
  let skippedEmpty = 0;
  for (const dir of opts.extra ?? []) {
    const abs = path.resolve(ctx.cwd, dir.replace(/^~(?=\/)/, homeOf(ctx)));
    for (const f of walkFiles(abs)) { const b = fs.readFileSync(f); if (!b.length) { skippedEmpty++; continue; } add(gitBlobId(b), `extra ${toPosix(path.relative(abs, f))}`, 'extra'); }
  }
  const list = [...ids.keys()];
  const res = list.length ? git(ctx, ['cat-file', '--batch-check'], { input: `${list.join('\n')}\n` }) : '';
  const present = res.split('\n').filter((l) => l && !l.endsWith(' missing')).map((l) => l.split(' ')[0]);
  // Where each found blob lives: tracked paths now, else the first path history names it under.
  const pathsOf = new Map(), reachable = new Set();
  if (present.length) {
    const want = new Set(present);
    for (const [p, e] of indexEntries(ctx)) if (want.has(e.blob)) { if (!pathsOf.has(e.blob)) pathsOf.set(e.blob, new Set()); pathsOf.get(e.blob).add(p); }
    for (const line of git(ctx, ['rev-list', '--objects', '--all']).split('\n')) {
      const sp = line.indexOf(' '), id = sp < 0 ? line : line.slice(0, sp); if (!id) continue;
      reachable.add(id);
      if (want.has(id) && sp > 0 && !pathsOf.has(id)) pathsOf.set(id, new Set([nfc(line.slice(sp + 1))]));
    }
  }
  // A library file (--extra) that is byte-identical to a public file is not a leak: a §1/§2 row covers it (a CC0
  // pack), or it is not media (frame-data JSON, a readme). Those are reported apart and do not count.
  const cov = coverage(readIf(path.join(ctx.root, 'ASSETS.md'))?.toString('utf8') ?? '');
  const found = [], publicCopies = [];
  for (const id of present) {
    const { label, kind } = ids.get(id), where = [...(pathsOf.get(id) ?? [])].sort(cmp);
    const rec = { id, label, kind, paths: where, reachable: reachable.has(id) };
    if (kind === 'extra' && where.length && where.every((p) => !isMedia(p) || cov.coveringRows(p, 2).length)) { rec.why = where.map((p) => (isMedia(p) ? `${p} is free third-party, covered by ASSETS.md §2 row \`${cov.coveringRows(p, 2)[0]}\`` : `${p} is not media`)).join('; '); publicCopies.push(rec); }
    else {
      const ours = kind === 'extra' ? where.filter((p) => isMedia(p) && cov.coveringRows(p, 1).length) : [];
      if (ours.length) rec.note = `${ours[0]} is claimed as ours by §1 row \`${cov.coveringRows(ours[0], 1)[0]}\`, yet a library file is byte-identical: move it to a §2 row if it is third-party, or tell Jonathan`;
      found.push(rec);
    }
  }
  if (ctx.json) ctx.print(JSON.stringify({ checked: list.length, skippedEmpty, found, publicCopies }, null, 2));
  else {
    for (const f of found) ctx.print(`FOUND ${f.id} ${f.label}${f.paths.length ? ` at ${f.paths.join(', ')}` : ''}${f.reachable ? '' : ' (unreachable: run git gc --prune=now)'}${f.note ? `\n  ${f.note}` : ''}`);
    for (const f of publicCopies) ctx.log(`public ${f.id} ${f.label}: ${f.why} (not counted)`);
  }
  ctx.log(`assets leakscan: checked ${plural(list.length, 'blob id')} against every object in this clone (fetch every ref first; refs/pull/* is not cloned by default); found ${found.length}${publicCopies.length ? `; ${publicCopies.length} library files match public files and are not counted` : ''}${skippedEmpty ? `; ${skippedEmpty} empty files skipped` : ''}`);
  return found.length ? 1 : 0;
}

// --- init / vendor and templates --------------------------------------------------------------
/**
 * Install steps for the stranger build, by the lockfile the repo has: `npm ci` refuses to run without package-lock.json,
 * and setup-node's `cache: npm` fails without one, so a lockfile-less repo installs with plain `npm install`.
 */
const INSTALL_STEPS = {
  npm: { cache: 'npm', steps: ['npm ci --ignore-scripts'] },
  pnpm: { cache: null, steps: ['corepack enable', 'pnpm install --frozen-lockfile --ignore-scripts'] },
  yarn: { cache: 'yarn', steps: ['yarn install --frozen-lockfile --ignore-scripts'] },
  'yarn-berry': { cache: null, steps: ['corepack enable', 'yarn install --immutable --mode=skip-build'] },
  bun: { cache: null, setup: 'oven-sh/setup-bun@v2', steps: ['bun install --frozen-lockfile --ignore-scripts'] },
  none: { cache: null, steps: ['npm install --ignore-scripts --no-audit --no-fund'] },
};
/** Which INSTALL_STEPS entry fits the repo at `root` (by lockfile; package.json's packageManager tells yarn 1 from 2+). */
export function packageManagerOf(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) return 'npm';
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) { let pm = ''; try { pm = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager ?? ''; } catch { /* none */ } return /^yarn@(?!1\.)/.test(pm) ? 'yarn-berry' : 'yarn'; }
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'none';
}
export function assetsWorkflow({ stranger = true, pm = 'npm' } = {}) {
  const inst = INSTALL_STEPS[pm] ?? INSTALL_STEPS.none;
  return `name: Assets

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

# Public CI is always placeholder mode: never fetch the private store, never actions/cache
# private files or build output, never upload dist/ or private files as artifacts.

jobs:
  guard:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node scripts/assets.mjs check
${stranger ? `
  # \`init\` includes this job only when package.json has a build or test script, and picks the install step from the
  # lockfile (npm ci needs package-lock.json; without a lockfile it is plain npm install, with no cache).
  stranger-build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22${inst.cache ? `
          cache: ${inst.cache}` : ''}${inst.setup ? `
      - uses: ${inst.setup}` : ''}
${inst.steps.map((x) => `      - run: ${x}`).join('\n')}
      - run: node scripts/assets.mjs sync
      - run: npm run test --if-present
      - run: npm run build --if-present
` : ''}`;
}
export function publishMirrorWorkflow(project = '{{PROJECT}}', publicRepo = '{{PUBLIC_REPO}}') {
  const name = publicRepo.split('/')[1];
  return `name: Publish public mirror

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: publish-mirror
  cancel-in-progress: false

jobs:
  publish:
    # Only main is published: \`gh workflow run --ref <branch>\` must never push an unreviewed branch to the mirror.
    if: github.repository == '${project}' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Guard the dev tree
        run: node scripts/assets.mjs check
      - name: Export the public tree (fails closed)
        run: node scripts/assets.mjs export --out "$RUNNER_TEMP/public"
      - name: Commit the snapshot to the public mirror
        env:
          MIRROR_KEY: \${{ secrets.PUBLIC_MIRROR_DEPLOY_KEY }}
          MIRROR_REPO: ${publicRepo}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\\n' "$MIRROR_KEY" > ~/.ssh/mirror && chmod 600 ~/.ssh/mirror
          export GIT_SSH_COMMAND="ssh -i ~/.ssh/mirror -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
          git clone --depth 1 "git@github.com:\${MIRROR_REPO}.git" "$RUNNER_TEMP/mirror"
          rsync -a --delete --exclude .git "$RUNNER_TEMP/public/" "$RUNNER_TEMP/mirror/"
          cd "$RUNNER_TEMP/mirror"
          # --force: the export holds only exported files, and some are tracked in dev although .gitignore matches them.
          git add -A --force
          if git diff --cached --quiet; then echo "mirror already current"; exit 0; fi
          # A fixed identity and a fixed message: contributors' private or work emails, and dev commit subjects (branch
          # names, order numbers, people's names, a pasted key), never reach the public repo. Neither export nor the
          # secret scan ever sees a commit message.
          git -c user.name="${name ?? 'public'} mirror" -c user.email="mirror@users.noreply.github.com" \\
            commit -q -m "Export of \${GITHUB_SHA::12}" \\
                      -m "Exported from the private development repo by assets.mjs export."
          git push origin HEAD:main
`;
}
const TEMPLATE_MANIFEST = { schema: 1, tool: VERSION, project: '', mode: 'overlay', packs: {}, files: {} };
function packageScripts(mode, out) {
  const s = { 'assets:sync': 'node scripts/assets.mjs sync', 'assets:check': 'node scripts/assets.mjs check', 'assets:add': 'node scripts/assets.mjs add', 'assets:update': 'node scripts/assets.mjs update', 'assets:status': 'node scripts/assets.mjs status' };
  const hooks = mode === 'mirror'
    ? { predev: 'node scripts/assets.mjs sync --quiet', pretest: 'node scripts/assets.mjs sync --quiet', prebuild: 'node scripts/assets.mjs sync --quiet', postbuild: `node scripts/assets.mjs verify-build ${out} --when-required` }
    : { predev: 'node scripts/assets.mjs sync --quiet', pretest: 'node scripts/assets.mjs sync --quiet && node scripts/assets.mjs check', prebuild: 'node scripts/assets.mjs sync --quiet', postbuild: `node scripts/assets.mjs verify-build ${out} --when-required` };
  return { s, hooks };
}
async function cmdInit(ctx, opts) {
  const mode = opts.mode ?? usageError('init needs --mode overlay|mirror');
  if (mode !== 'overlay' && mode !== 'mirror') usageError('--mode must be overlay or mirror');
  const project = opts.project ?? usageError('init needs --project owner/name');
  if (mode === 'mirror' && !opts['public-repo']) usageError('mirror mode needs --public-repo owner/name');
  if (opts['public-repo'] && opts['public-repo'].toLowerCase() === project.toLowerCase()) usageError('--public-repo must differ from --project');
  const abs = path.join(ctx.root, ctx.manifestRel);
  if (fs.existsSync(abs)) usageError(`${ctx.manifestRel} already exists`);
  const publicDir = opts['public-dir'] ?? (fs.existsSync(path.join(ctx.root, 'public')) ? 'public' : '.'), out = opts.out ?? 'dist';
  const m = { ...TEMPLATE_MANIFEST, project, mode, ...(mode === 'mirror' ? { mirror: { public: opts['public-repo'] } } : {}), build: { publicDir, out }, ...(mode === 'mirror' ? { exclude: ['.github/workflows/publish-mirror.yml'] } : {}), packs: {}, files: {} };
  const { errors } = validateManifest(m); if (errors.length) usageError(errors.map((e) => e.msg).join('; '));
  saveManifest(ctx, m);
  const kitTpl = readIf(path.join(kitRoot(ctx), 'skills', 'start-open-project', 'templates', 'ASSETS.md'));
  if (!fs.existsSync(path.join(ctx.root, 'ASSETS.md')) && kitTpl) fs.writeFileSync(path.join(ctx.root, 'ASSETS.md'), kitTpl);
  regenerate(ctx, m);
  // vendor the tool
  const self = fileURLToPath(import.meta.url), dest = path.join(ctx.root, 'scripts', 'assets.mjs');
  if (path.resolve(self) !== path.resolve(dest)) { writeAtomic(dest, fs.readFileSync(self)); fs.chmodSync(dest, 0o755); }
  // workflow
  const pkgAbs = path.join(ctx.root, 'package.json'), pkgText = readIf(pkgAbs)?.toString('utf8'); let pkg = null;
  if (pkgText) try { pkg = JSON.parse(pkgText); } catch { ctx.warn('package.json is not valid JSON; scripts not added'); }
  const wfRel = mode === 'mirror' ? '.github/workflows/publish-mirror.yml' : '.github/workflows/assets.yml', wfAbs = path.join(ctx.root, wfRel);
  if (!fs.existsSync(wfAbs)) writeAtomic(wfAbs, mode === 'mirror' ? publishMirrorWorkflow(project, opts['public-repo']) : assetsWorkflow({ stranger: !!(pkg?.scripts?.build || pkg?.scripts?.test), pm: packageManagerOf(ctx.root) }));
  else ctx.warn(`${wfRel} exists; left unchanged`);
  // package scripts, chained, never overwritten
  if (pkg) {
    pkg.scripts ??= {}; const before = { ...pkg.scripts }, { s, hooks } = packageScripts(mode, out);
    for (const [k, v] of Object.entries(s)) if (!(k in pkg.scripts)) pkg.scripts[k] = v;
    for (const [k, v] of Object.entries(hooks)) {
      const cur = pkg.scripts[k];
      if (!cur) pkg.scripts[k] = v;
      else if (!cur.includes('assets.mjs')) pkg.scripts[k] = k.startsWith('post') ? `${cur} && ${v}` : `${v} && ${cur}`;
    }
    const indent = pkgText.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
    fs.writeFileSync(pkgAbs, `${JSON.stringify(pkg, null, indent)}${pkgText.endsWith('\n') ? '\n' : ''}`);
    for (const k of Object.keys(pkg.scripts)) if (before[k] !== pkg.scripts[k]) ctx.print(`${before[k] === undefined ? '+' : '~'} scripts.${k}: ${pkg.scripts[k]}${before[k] !== undefined ? `\n    (was: ${before[k]})` : ''}`);
  }
  ctx.log(`assets init: ${mode} mode for ${project}; wrote ${ctx.manifestRel}, ASSETS.md block, .gitignore block, scripts/assets.mjs, ${wfRel}`);
  if (mode === 'mirror') ctx.log('Mirror mode also needs the public repo, a deploy key, and the PUBLIC_MIRROR_DEPLOY_KEY secret (design/ASSET-SEPARATION.md §10.4).');
  return 0;
}
async function cmdVendor(ctx, opts) {
  const self = fileURLToPath(import.meta.url), kitCopy = path.join(kitRoot(ctx), 'tools', 'assets', 'assets.mjs');
  const src = toPosix(self).endsWith('/tools/assets/assets.mjs') ? self : kitCopy;
  const srcBuf = readIf(src) ?? envError(`kit copy not found at ${src} (set ASSETS_KIT)`);
  const dest = path.join(ctx.root, 'scripts', 'assets.mjs'), cur = readIf(dest);
  if (opts.check) {
    if (cur && cur.equals(srcBuf)) { ctx.log(`scripts/assets.mjs matches the kit (${versionOfFile(src)})`); return 0; }
    ctx.error(`scripts/assets.mjs ${cur ? `(${versionOfFile(dest) ?? 'unknown version'}) differs from` : 'is missing; kit has'} the kit (${versionOfFile(src)}): run node <kit>/tools/assets/assets.mjs vendor`);
    return 1;
  }
  if (path.resolve(src) === path.resolve(dest)) { ctx.log('this is the kit copy; nothing to vendor'); return 0; }
  writeAtomic(dest, srcBuf); fs.chmodSync(dest, 0o755);
  ctx.log(`vendored assets.mjs ${versionOfFile(src)} to scripts/assets.mjs`);
  return 0;
}

const HELP = `assets.mjs ${VERSION}: keep licensed and third-party files out of public repos (design/ASSET-SEPARATION.md)

usage: node scripts/assets.mjs <command> [flags]     global: --root <dir> --manifest <path> --quiet --json

  init --mode overlay|mirror --project owner/name [--public-repo owner/name] [--public-dir public] [--out dist]
  vendor [--check]                       copy the kit's assets.mjs to scripts/assets.mjs
  sync [--require] [--placeholders] [--trust-store] [--only a,b] [--store <dir|s3://…|r2://…>]
  check [--staged] [--strict]            the guard: the index plus what "git add -A" would add (--staged: staged files only;
                                         --strict: folder and wildcard §1/§2 rows fail instead of warning)
  add <paths|dirs|'globs'>… --pack <id> [--section 3|4] [--title] [--author] [--url] [--license] [--terms]
      [--paid|--free] [--price] [--acquired YYYY-MM-DD] [--download <zip|dir>] [--why] [--decision replace|hide|retire|hold]
      [--decided-by jonathan] [--review-by YYYY-MM-DD] [--replacement] [--restrict a,b] [--credit "…"] [--placeholder <kind|json|copy:path|none>]
      [--ship always|build-only|never] [--no-snapshot] [--confirm-real]
  update <paths>… [--drop [--delete] [--public]] [--placeholder <spec>] [--ship …] [--confirm-real]
                                         add and update refuse placeholders, also with the marker stripped or edited;
                                         --confirm-real (a person only) overrides "edited after sync wrote a placeholder"
  release <pack> [--to-section 1|2]
  forbid <paths|globs>… --why "…" [--from-history] [--blobs-only [--include-current]]
  docs [--check] [--credits <out.json>]
  export --out <dir> [--dry-run]         mirror mode: write the public tree from HEAD (fails closed)
  verify-build [dir] [--require-real | --when-required]
  run --needs real[:<pack|glob>,…] -- <cmd…>   runs only if those listed files are the listed bytes
  status [--json] [--remote] [--restriction <name>]
  scan <zip|dir>… [--pack <id>] [--record] | scan --store
  import <zip|dir>…                      for people who bought the packs: fill private-assets/<path>
  store push [--store …]                 copy every listed file that is real here into the store
  leakscan [--store] [--extra <dir>…]   needs full history (refuses a shallow clone)

exit codes: 0 ok, 1 problems found, 2 usage error, 3 environment error
env: ASSETS_REQUIRE=real|none, ASSETS_MODE=placeholder, PRIVATE_ASSET_STORE=<dir|s3://bucket/prefix|r2://bucket/prefix>,
     ASSETS_KIT, ASSETS_S3_ENDPOINT, ASSETS_S3_ACCESS_KEY_ID, ASSETS_S3_SECRET_ACCESS_KEY (or R2_*/AWS_*), R2_ACCOUNT_ID,
     ASSETS_TZ (IANA zone for dates; default: this machine's)`;

const HANDLERS = { init: cmdInit, vendor: cmdVendor, sync: cmdSync, check: cmdCheck, add: cmdAdd, update: cmdUpdate, release: cmdRelease, forbid: cmdForbid, docs: cmdDocs, export: cmdExport, 'verify-build': cmdVerifyBuild, run: cmdRun, status: cmdStatus, scan: cmdScan, import: cmdImport, store: cmdStore, leakscan: cmdLeakscan };

/** Run one command. Returns the exit code; never calls process.exit. */
export async function main(argv, io = {}) {
  const stderr = io.stderr ?? process.stderr, stdout = io.stdout ?? process.stdout;
  try {
    const { cmd, opts } = parseArgs(argv);
    if (cmd === 'help' || opts.help) { stdout.write(`${HELP}\n`); return 0; }
    const ctx = makeCtx(opts, io);
    return await HANDLERS[cmd](ctx, opts);
  } catch (e) {
    if (e instanceof Exit) { stderr.write(`assets.mjs: ${e.message}\n`); return e.code; }
    stderr.write(`assets.mjs: internal error: ${e.stack ?? e}\n`); return 3;
  }
}

const invokedDirectly = (() => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invokedDirectly) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500).unref(); // don't let idle keep-alive sockets hold the process open
}
