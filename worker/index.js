// Entry point on Cloudflare. Static files at the root are served straight from the asset store without running this
// code; only /ws (join the shared dig), /api/* and everything under /leave come through here.
import { worldName } from './era.js';
import SHELL_THEME from '../mann-cool-shell-theme.json';
export { World } from './world.js';
export { Room } from './room.js';
export { Players } from './players.js';

// The game answers at the root of its own address and also under mann.cool/leave/. The browser side uses relative
// addresses throughout, so here the prefix simply comes off before anything is matched.
const MOUNT = '/leave';

// Under /leave the game is one of mann.cool's games, so its page carries the site's shared shell: the way back to
// mann.cool, the tip button and the menu, drawn in this game's colours (mann-cool-shell-theme.json). The shell is a
// script on mann.cool, pinned to the version the site serves now; it counts one play when it loads. The bare
// workers.dev address stays the game alone.
const HOME = 'https://mann.cool';
// One leaderboard board, "Dirt moved": each player's lifetime total (src/board.js posts it; games.json declares it).
const BOARDS = [{ variant: 'dirt', label: 'Dirt moved', metric: 'dirtM3', metricLabel: 'Cubic metres of dirt moved', direction: 'desc', display: 'integer', aggregation: 'player-best', minimumMatches: 1 }];
const SHELL = { slug: 'leave', title: "Chuck & Hakeem Won't Leave", leaderboard: true, version: '20261109-solana-signin1' };
const SHELL_PATH = '/platform/v1/game-shell.js';
const attr = (v) => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const SHELL_TAG = `<script src="${HOME}${SHELL_PATH}?v=${SHELL.version}" data-slug="${attr(SHELL.slug)}" data-title="${attr(SHELL.title)}" data-leaderboard="${SHELL.leaderboard ? 'true' : 'false'}" data-leaderboard-variant="${BOARDS[0].variant}" data-leaderboard-boards="${attr(JSON.stringify(BOARDS))}" data-shell-theme="${attr(JSON.stringify(SHELL_THEME))}" defer></script>`;
// a short name for this exact tag, so a browser's kept copy of the page is not reused once the shell or its theme changes
const SHELL_ID = [...SHELL_TAG].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
// The shell asks the site it is on for these. On mann.cool they are the site's own and never come here.
const PLATFORM = /^\/(?:platform\/config\.json|api\/v1\/(?:plays|wallets|guestbook|leaderboard|player\/.*))$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname === 'www.mann.cool') { url.hostname = 'mann.cool'; return Response.redirect(url, 308); }   // one address for the game
    let path = url.pathname;
    // Anywhere but mann.cool itself is a preview: workers.dev, or wrangler on this computer (which names the route's host
    // in the address it hands over and keeps the real one in a header of its own).
    const preview = url.hostname !== 'mann.cool' || req.headers.has('mf-original-hostname') || /^(::1|127\.0\.0\.1)$/.test(req.headers.get('CF-Connecting-IP') || '');
    if (preview && PLATFORM.test(path)) return platform(req, url);
    // a relative Location, so the redirect stays on whatever host the visitor used; 308 like mann.cool's other games (its checks ask for it)
    if (path === MOUNT) return stamp(new Response(null, { status: 308, headers: { Location: MOUNT + '/' + url.search } }));
    const mounted = path.startsWith(MOUNT + '/');
    if (mounted) path = path.slice(MOUNT.length);
    const tag = (res) => (mounted ? stamp(res) : res);
    const world = env.WORLD.get(env.WORLD.idFromName(worldName));
    if (path === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      const room = await world.assign();
      if (!room) return full();
      const fwd = new Request(req);
      fwd.headers.set('x-room', room);
      // Always overwritten here, so a client cannot choose it. A load test that presents the admin key (as a header,
      // which a browser cannot send on a WebSocket) is not held to the per-network cap.
      const auth = req.headers.get('authorization');
      fwd.headers.set('x-ip', auth && env.ADMIN_KEY && (await sameText(env.ADMIN_KEY, auth.replace(/^Bearer /, ''))) ? '' : clientKey(req));
      fwd.headers.delete('authorization');
      return env.ROOM.get(env.ROOM.idFromName(room)).fetch(fwd);
    }
    if (path === '/api/status') {
      // answered from memory for five seconds at a time, so hammering this URL never reaches the World
      const now = Date.now();
      if (!statusP || now - statusAt > 5000) { statusAt = now; statusP = world.status().catch(() => ({ error: 'unavailable' })); }
      return tag(Response.json(await statusP));
    }
    if (path === '/api/admin') {
      // The private switch. The key is a Worker secret (ADMIN_KEY); without one set, this is simply closed.
      const key = env.ADMIN_KEY, got = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
      if (!key || !(await sameText(key, got))) return tag(new Response('no', { status: 401 }));
      if (req.method === 'GET') return tag(Response.json(await world.control(null)));
      if (req.method !== 'POST') return tag(new Response('no', { status: 405 }));
      let patch;
      try { patch = await req.json(); } catch (e) { return tag(new Response('bad json', { status: 400 })); }
      statusP = null;
      return tag(Response.json(await world.control(patch)));
    }
    const song = path.startsWith('/audio/');   // the one kind of file a browser asks for in pieces: see ranged()
    if (!mounted) return song ? ranged(req, await env.ASSETS.fetch(req)) : env.ASSETS.fetch(req);
    // A static file under the mount: fetch it by its real path. The asset store's own redirects (/admin.html -> /admin)
    // point at the root, so they get the prefix back; and the rules in public/_headers match the address the visitor
    // asked for (/leave/assets/...), not the one we fetch, so the same caching is set here.
    url.pathname = path;
    const ask = new Request(url, req), home = path === '/' && req.method === 'GET';
    // The game's own page, and only that one (not the admin page or the garage), gets the shell. Whether a browser's
    // kept copy of it is still good is settled in page(), so the asset store is always asked for the whole file.
    if (home) { ask.headers.delete('If-None-Match'); ask.headers.delete('If-Modified-Since'); }
    const res = song ? await ranged(req, await env.ASSETS.fetch(ask)) : await env.ASSETS.fetch(ask);
    if (home && res.status === 200 && (res.headers.get('Content-Type') || '').includes('text/html')) return page(req, res, preview);
    const out = stamp(new Response(res.body, res)), to = out.headers.get('Location');
    if (to && to.startsWith('/')) out.headers.set('Location', MOUNT + to);
    if (!res.ok && res.status !== 304 && !(res.status >= 300 && res.status < 400)) out.headers.set('Cache-Control', 'no-store');   // never let a missing file be remembered
    if (res.ok || res.status === 304) {
      if (path.startsWith('/assets/')) out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      else if (path.startsWith('/models/') || path.startsWith('/data/') || path.startsWith('/audio/')) out.headers.set('Cache-Control', 'public, max-age=86400');
    }
    return out;
  },
};

let statusAt = 0, statusP = null;

// What every answer under /leave carries, the same as mann.cool's other game Workers (the site's checks look for the last).
function stamp(res) {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Mann-Cool-Delivery', 'dedicated-worker');
  return res;
}

// A piece of a file. The asset store answers every request with the whole file, and Safari will not play a song
// unless it is given exactly the bytes it asked for ("Range: bytes=a-b" -> 206). So for /audio/ that is done here:
// one range, cut from the whole file; anything else passes through untouched.
async function ranged(req, res) {
  if (req.method !== 'GET' || res.status !== 200) return res;
  const h = new Headers(res.headers), m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || ''), fresh = req.headers.get('If-Range');
  h.set('Accept-Ranges', 'bytes');
  if (!m || (!m[1] && !m[2]) || (fresh && fresh !== h.get('ETag'))) return new Response(res.body, { status: 200, headers: h });
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const a = m[1] ? +m[1] : Math.max(0, size - +m[2]), b = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;   // "a-b", "a-" or "-last n"
  if (a >= size || a > b) { h.set('Content-Range', `bytes */${size}`); h.delete('Content-Length'); h.set('Cache-Control', 'no-store'); return new Response(null, { status: 416, headers: h }); }
  h.set('Content-Range', `bytes ${a}-${b}/${size}`); h.set('Content-Length', String(b - a + 1));
  return new Response(buf.slice(a, b + 1), { status: 206, headers: h });
}

// The game's page with the shell's script added once, just before </head>. It keeps the asset store's caching (asked
// for again every visit) under a tag of its own, so the answer to "has it changed?" also covers the shell and its theme.
async function page(req, res, preview) {
  const html = await res.text(), h = new Headers(res.headers);
  h.delete('Content-Length'); h.set('Content-Type', 'text/html; charset=utf-8');
  // A preview must not write to the real site: the shell posts its play straight to mann.cool, which this page may not
  // reach from anywhere else. Its own host (and so the proxy below) and the game's socket stay open.
  if (preview) h.set('Content-Security-Policy', "connect-src 'self' ws: wss: blob: data:");
  const etag = /^(?:W\/)?"(.+)"$/.exec(h.get('ETag') || '');
  if (etag) {
    const mine = `"${etag[1]}-${SHELL_ID}"`;
    h.set('ETag', 'W/' + mine);
    if ((req.headers.get('If-None-Match') || '').includes(mine)) return stamp(new Response(null, { status: 304, headers: h }));
  }
  const body = html.includes(SHELL_PATH) ? html : /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => SHELL_TAG + '</head>') : SHELL_TAG + html;
  return stamp(new Response(body, { status: 200, headers: h }));
}

// A preview is not mann.cool, so what the shell asks its own host for is fetched from there: reads only. Anything that
// would write (a play, a guestbook entry, a score, a sign-in) is answered here with nothing and goes no further, so
// testing never adds to the real numbers.
async function platform(req, url) {
  if (req.method !== 'GET') return new Response(null, { status: 204 });
  const headers = new Headers(req.headers);
  for (const k of ['host', 'cf-connecting-ip', 'x-forwarded-for', 'mf-original-hostname', 'cookie', 'authorization']) headers.delete(k);
  try {
    // handed on as plain bytes, whatever packing mann.cool chose for this Worker's own request
    const res = await fetch(HOME + url.pathname + url.search, { headers, redirect: 'manual' }), h = new Headers(res.headers);
    h.delete('Content-Encoding'); h.delete('Content-Length');
    return new Response(res.body, { status: res.status, headers: h });
  } catch (e) { return new Response(null, { status: 502 }); }
}

// Compare two strings without the time taken giving away how much of the key was right.
async function sameText(a, b) {
  const e = new TextEncoder(), [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', e.encode(a)), crypto.subtle.digest('SHA-256', e.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

// One household or office behind one address counts as one place; IPv6 is grouped by its /64. The address may arrive
// shortened ("2001:db8::5"), so the run of zeros is written back out before the first four groups are taken.
function clientKey(req) {
  const ip = (req.headers.get('CF-Connecting-IP') || '').toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);   // plain IPv4, or IPv4 written inside an IPv6 address
  if (ip === '::1' || (v4 && v4[1] === '127.0.0.1')) return '';   // local testing: no cap
  if (v4) return v4[1];
  const [head, tail] = ip.split('::'), a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...new Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

// Accept and immediately close with our own code, so the browser can tell "full" from "broken".
function full() {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(4503, 'full');
  return new Response(null, { status: 101, webSocket: client });
}
