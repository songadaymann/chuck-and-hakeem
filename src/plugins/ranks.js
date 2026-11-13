import './ranks.css';
import { CFG, rankFor } from '../config.js';

// Things to work for besides the next tool: your rank (one per tool), stars and Bucket-Wheel paint jobs past the top
// machine (CFG.paints), and badges for lobbyists stopped, nests flattened and saves (CFG.badges). The room counts and
// saves the numbers; this shows them on the start screen ("Your progress") and cheers when a badge is earned.
const NAMES = { kills: ['lobbyist stopped', 'lobbyists stopped'], nests: ['nest flattened', 'nests flattened'], saves: ['save', 'saves'] };
const BADGE = { kills: 'LOBBYISTS STOPPED', nests: 'NESTS FLATTENED', saves: 'SAVES' };
const KEYS = ['kills', 'nests', 'saves'];
const n = (v) => Math.floor(v).toLocaleString();

export function init(game) {
  const { bus, hud, player: p } = game, box = document.getElementById('record');
  if (!box) return;

  function draw() {
    const st = p.stats, net = game.net;
    if (!st && !net?.online) { box.hidden = true; return; }
    box.hidden = false;
    const rows = [`<div class="rank">${rankFor(p.tier, p.stars)}</div>`];
    if (st) {
      rows.push(`<div class="counts">${KEYS.map((k, i) => `<span><b>${n(st[i])}</b> ${NAMES[k][st[i] === 1 ? 0 : 1]}</span>`).join('')}</div>`);
      const got = KEYS.flatMap((k, i) => CFG.badges[k].filter((t) => st[i] >= t).map((t) => `<span class="badge">${n(t)} ${NAMES[k][t === 1 ? 0 : 1]}</span>`));
      if (got.length) rows.push(`<div class="badges">${got.join('')}</div>`);
      const next = KEYS.map((k, i) => { const t = CFG.badges[k].find((x) => st[i] < x); return t ? [(t - st[i]) / t, `${n(t)} ${NAMES[k][1]}`] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0])[0];
      if (next) rows.push(`<div class="next">next badge: ${next[1]}</div>`);
    }
    // the way ahead: the next tool, or past the top one, the next paint job
    const dug = net?.online ? p.serverDug : p.dug, tool = CFG.tools[p.tier + 1], paint = CFG.paints[p.stars];
    if (tool) rows.push(`<div class="next">next rank: ${CFG.ranks[p.tier + 1]}, with the ${tool.name} at ${n(tool.need)} m³</div>`);
    else if (paint) rows.push(`<div class="next">${p.stars ? `Bucket-Wheel paint: ${CFG.paints[p.stars - 1].name}. ` : ''}next: ${paint.name} at ${n(paint.at)} m³ (${n(Math.max(0, paint.at - dug))} to go)</div>`);
    else rows.push('<div class="next">every paint job earned. you are a legend</div>');
    box.innerHTML = rows.join('');
  }

  bus.on('stats', ({ st, prev }) => {
    if (prev) KEYS.forEach((k, i) => {
      const t = CFG.badges[k].filter((x) => prev[i] < x && st[i] >= x).pop();
      if (t) { hud.toast(t === 1 ? `BADGE: FIRST ${NAMES[k][0].toUpperCase()}` : `BADGE: ${n(t)} ${BADGE[k]}`, 4, 2); p.avatar.cheer(2); bus.emit('badge', { stat: k, at: t }); }
    });
    draw();
  });
  for (const e of ['toolUp', 'paintUp', 'online']) bus.on(e, draw);
  draw();
  let t = 0;
  return { update(dt) { if ((t += dt) > 5) { t = 0; if (!document.getElementById('start')?.hidden) draw(); } } };   // the "to go" figure, while the menu is open
}
