// mann.cool's leaderboards for this game: "Dirt moved", ranked by each player's lifetime total (cubic metres, the
// same number the server saves under their code), and "Lobbyists stopped" and "Nests flattened" (the room's counts).
// A board keeps every player's best entry, and a total only ever grows, so the newest post is the one that shows.
//
// Only totals the server has confirmed are posted (the 'hi' and 'c' messages), never the client's running count.
// Posts are spaced out so a player adds a few dozen rows in a lifetime, not one a minute: the first once they have
// dug a cubic metre, then each time the total has grown by a tenth, at most once a minute, and once more on leaving.
//
// The player's code is their secret (it restores their progress), so it is never sent: playerId is a hash of it.
// Under mann.cool the post goes to mann.cool's own API; on a preview the Worker answers it without passing it on.

const SLUG = 'leave';
// Each board: how much a score must grow before it is posted again, and how long at least between two posts.
// dirt = lifetime m3 dug; lobbyists and nests = the counts the room keeps (CFG.badges), which are posted less often.
const BOARDS = { dirt: { grow: 1.1, gap: 60_000 }, lobbyists: { grow: 1.1, gap: 120_000 }, nests: { grow: 1.1, gap: 120_000 } };

let id = null, idFor = null, name = '';
const state = Object.fromEntries(Object.keys(BOARDS).map((v) => [v, { best: 0, posted: 0, lastAt: 0, sending: false }]));

async function hashCode(code) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dig-them-out:' + code));
  return 'leave-' + [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// the dirt board's submission ids stay as they always were
function body(variant, score) {
  return JSON.stringify({ slug: SLUG, variant, name, playerId: id, score, submissionId: variant === 'dirt' ? `${id}:${score}` : `${id}:${variant}:${score}` });
}

async function post(variant, force) {
  const b = BOARDS[variant], st = state[variant], score = Math.floor(st.best);
  if (!id || st.sending || score < 1 || score <= st.posted) return;
  if (!force && (score < st.posted * b.grow || Date.now() - st.lastAt < b.gap)) return;
  st.sending = true;
  try {
    const r = await fetch('/api/v1/leaderboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(variant, score), keepalive: true });
    if (r.ok) { st.posted = score; st.lastAt = Date.now(); }
    else st.lastAt = Date.now();   // a refusal (rate limit, board not on yet) waits like a success
  } catch (e) { st.lastAt = Date.now(); } finally { st.sending = false; }
}

async function report(code, playerName, variant, total) {
  if (!code || !Number.isFinite(total)) return;
  if (code !== idFor) { idFor = code; id = await hashCode(code); for (const st of Object.values(state)) Object.assign(st, { best: 0, posted: 0, lastAt: 0 }); }
  if (playerName) name = String(playerName).slice(0, 30);
  state[variant].best = Math.max(state[variant].best, total);
  post(variant, false);
}

// Called with every total the server confirms.
export const reportTotal = (code, playerName, total) => report(code, playerName, 'dirt', total);
// ...and with every [kills, nests, saves] it sends.
export async function reportStats(code, playerName, st) {
  if (!Array.isArray(st)) return;
  await report(code, playerName, 'lobbyists', st[0]);
  await report(code, playerName, 'nests', st[1]);
}

// Leaving: send what has not been posted yet, even if it grew by less than the step.
addEventListener('pagehide', () => {
  if (!id) return;
  for (const [variant, st] of Object.entries(state)) {
    const score = Math.floor(st.best);
    if (score < 1 || score <= st.posted) continue;
    try { navigator.sendBeacon('/api/v1/leaderboard', new Blob([body(variant, score)], { type: 'application/json' })); st.posted = score; } catch (e) { /* ignore */ }
  }
});
