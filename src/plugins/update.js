// A tab left open across a deploy keeps running the old code: it misses anything new the server starts doing (a dirt
// bomb it cannot show, say). Every build writes its name into the game (__BUILD__) and beside it as version.json; this
// asks for that file whenever a deploy is likely to have just happened (the shared dig dropped us and took us back),
// when the tab comes back into view, and every few minutes. A different name puts up a banner; a tap on it reloads.
// Nothing reloads by itself: the player may be mid-dig. Progress is saved on the way out (main.js, pagehide).
import './update.css';
import { at } from '../base.js';

const EVERY = 5 * 60 * 1000, QUIET = 20 * 1000;

export function init(game) {
  if (typeof __BUILD__ === 'undefined' || new URLSearchParams(location.search).has('capture')) return {};
  let last = 0, shown = false, bar = null;

  const show = () => {
    if (shown) return;
    shown = true;
    bar = document.createElement('button');
    bar.id = 'newbuild'; bar.type = 'button';
    bar.innerHTML = '<b>NEW VERSION</b><span>tap to reload</span>';
    bar.setAttribute('aria-label', 'A new version of the game is out. Reload');
    // as the sound card does: a press here is not the start of a dig, a look around or a walk
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) bar.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    bar.addEventListener('click', () => { if (game.started) game.save?.(); location.reload(); });
    document.body.appendChild(bar);
    game.bus.emit('newBuild', {});
  };

  const check = async (force) => {
    const now = Date.now();
    if (shown || (!force && now - last < QUIET)) return;
    last = now;
    try {
      const r = await fetch(at('/version.json') + '?t=' + now, { cache: 'no-store' });
      if (!r.ok) return;   // the dev server has none
      const v = await r.json();
      if (v && typeof v.build === 'string' && v.build !== __BUILD__) show();
    } catch (e) { /* offline: try again later */ }
  };

  // After a deploy every socket is dropped and comes back within seconds; by then the new files are being served.
  game.bus.on('online', (e) => { if (e.back) check(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(false); });
  setInterval(() => { if (document.visibilityState === 'visible') check(false); }, EVERY);
  check(true);   // a page the browser kept from before the deploy
  return { get stale() { return shown; } };
}
