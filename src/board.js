// mann.cool's leaderboard for this game: one board, "Dirt moved", ranked by each player's lifetime total (cubic metres,
// the same number the server saves under their code). The board keeps every player's best entry, and a total only
// ever grows, so the newest post is the one that shows.
//
// Only totals the server has confirmed are posted (the 'hi' and 'c' messages), never the client's running count.
// Posts are spaced out so a player adds a few dozen rows in a lifetime, not one a minute: the first once they have
// dug a cubic metre, then each time the total has grown by a tenth, at most once a minute, and once more on leaving.
//
// The player's code is their secret (it restores their progress), so it is never sent: playerId is a hash of it.
// Under mann.cool the post goes to mann.cool's own API; on a preview the Worker answers it without passing it on.

const SLUG = 'leave', VARIANT = 'dirt';
const GROW = 1.1, GAP_MS = 60_000;

let id = null, idFor = null, name = '', best = 0, posted = 0, lastAt = 0, sending = false;

async function hashCode(code) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dig-them-out:' + code));
  return 'leave-' + [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function body(score) {
  return JSON.stringify({ slug: SLUG, variant: VARIANT, name, playerId: id, score, submissionId: `${id}:${score}` });
}

async function post(force) {
  const score = Math.floor(best);
  if (!id || sending || score < 1 || score <= posted) return;
  if (!force && (score < posted * GROW || Date.now() - lastAt < GAP_MS)) return;
  sending = true;
  try {
    const r = await fetch('/api/v1/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(score), keepalive: true });
    if (r.ok) { posted = score; lastAt = Date.now(); }
    else lastAt = Date.now();   // a refusal (rate limit, board not on yet) waits a minute like a success
  } catch (e) { lastAt = Date.now(); } finally { sending = false; }
}

// Called with every total the server confirms.
export async function reportTotal(code, playerName, total) {
  if (!code || !Number.isFinite(total)) return;
  if (code !== idFor) { idFor = code; id = await hashCode(code); posted = 0; lastAt = 0; best = 0; }
  if (playerName) name = String(playerName).slice(0, 30);
  best = Math.max(best, total);
  post(false);
}

// Leaving: send what has not been posted yet, even if it grew by less than a tenth.
addEventListener('pagehide', () => {
  const score = Math.floor(best);
  if (!id || score < 1 || score <= posted) return;
  try { navigator.sendBeacon('/api/v1/leaderboard', new Blob([body(score)], { type: 'application/json' })); posted = score; } catch (e) { /* ignore */ }
});
