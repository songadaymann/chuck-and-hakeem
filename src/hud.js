import * as THREE from 'three';
import { CFG } from './config.js';

const $ = (id) => document.getElementById(id);
const PHRASES = ["IT'S COMPLICATED", 'UNWAVERING SUPPORT', 'NOW IS NOT THE TIME', 'HAVE YOU SEEN OUR BROCHURE?', 'FREE TRIP FOR YOUR CONGRESSMAN', 'WE JUST WANT TO TALK', 'THINK OF YOUR DONORS'];
const TOS = ['We have updated our terms. By continuing to dig you agree to binding arbitration.', 'Your shovel now collects usage data to improve your experience.', 'This lawn is a premium feature. Start your free trial?'];
// Five decimals: one shovel bite on a pile built to last weeks is about a hundred-thousandth of a percent, and you should see it land.
export const pctText = (p) => p.toFixed(5) + '%';

export class Hud {
  constructor(game) {
    this.game = game; this.toastT = 0; this.toastPri = 0; this.acc = 0; this.bubbleT = 0; this.dying = []; this.says = []; this.moundsHtml = '';
    // one placard per man: his face, how far out he is. His clock and bar float over his real head.
    $('giants').innerHTML = CFG.giants.map((g) => `<div class="man" id="man-${g.id}"><canvas class="face" id="face-${g.id}" width="96" height="96"></canvas><b id="pct-${g.id}"></b><span>${g.name}</span><em id="tag-${g.id}"></em></div>`).join('');
    this.v = new THREE.Vector3();
    const agree = () => { game.player.fx.tos = 0; if (!game.over) game.lock(); };
    $('tosbtn').onclick = agree;
    // phones send no click while another thumb is still down on the stick
    $('tosbtn').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); agree(); } });
  }

  face(id) { return $('face-' + id); }

  // Take an element off the screen after this many seconds of game time (not wall time, so recordings stay in step).
  later(el, secs) { this.dying.push({ el, t: secs }); }

  // The big line in the middle of the screen. pri: 0 status effects, 1 lobby news, 2 milestones, 3 a new tool, 4 one of
  // the men coming out (or not). Something lesser never talks over something bigger that is still showing.
  toast(msg, secs = 2.5, pri = 1) {
    const el = $('toast');
    if (msg && this.toastT > 0 && pri < this.toastPri) return;
    el.textContent = msg; this.toastT = secs; this.toastPri = pri;
    el.className = pri >= 3 ? 'big' : ''; void el.offsetWidth; if (msg) el.classList.add('in');
    if (msg) this.game.bus?.emit('toast', { msg, secs, pri });
  }

  // A speech bubble pinned to a point in the world (a giant's head, a lobbyist) for a few seconds.
  say(text, x, y, z, secs = 3, cls = '') {
    const el = document.createElement('div'); el.className = 'say ' + cls; el.textContent = text;
    $('pops').append(el); this.says.push({ el, x, y, z, t: secs });
    this.place(this.says[this.says.length - 1]);
    return el;
  }
  place(s) {
    const v = this.v.set(s.x, s.y, s.z).project(this.game.camera), on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    s.el.style.display = on ? '' : 'none';
    const half = on ? (s.el.offsetWidth / 2 + 6) / innerWidth * 100 : 0;   // keep the whole bubble on screen
    if (!on) return;
    const left = Math.max(half, Math.min(100 - half, (v.x + 1) * 50)); let top = Math.max(8, Math.min(80, (1 - v.y) * 50));
    // under mann.cool's shell the top corners are its buttons: a bubble that would sit behind one hangs below it instead
    const taken = this.game.shellRects?.();
    if (taken && taken.length) {
      const w = s.el.offsetWidth / 2, h = s.el.offsetHeight, x = left / 100 * innerWidth, y = top / 100 * innerHeight;
      for (const r of taken) if (x + w > r.left && x - w < r.right && y > r.top && y - h < r.bottom) top = Math.max(top, (r.bottom + h + 6) / innerHeight * 100);
    }
    s.el.style.left = left + '%'; s.el.style.top = top + '%';
  }

  // Small news from the crowd, stacked under the lobby list: who got a tool, who arrived, what fell.
  feed(text) {
    const box = $('feed'), el = document.createElement('div'); el.textContent = text;
    box.append(el); while (box.children.length > 4) box.firstChild.remove();
    this.later(el, 6);
  }

  // A little number that floats up from where the dirt came out.
  pop(text, x, y, z, cls = '') {
    const g = this.game, v = this.v.set(x, y, z).project(g.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return;
    const el = document.createElement('span');
    el.textContent = text; if (cls) el.className = cls;
    el.style.left = (v.x + 1) * 50 + '%'; el.style.top = (1 - v.y) * 50 + '%';
    $('pops').append(el); this.later(el, 0.9);
  }

  stamp(text) {
    const el = document.createElement('div'); el.className = 'stamp'; el.textContent = text;
    $('fx').append(el); this.later(el, 0.7);
  }

  effectStarted(lobby, player) {
    const say = { hasbara: 'TALKING POINTS! digging at half strength', deductible: `DEDUCTIBLE! your next ${player.deductible} digs are denied`, pricehike: 'PRICE HIKE! it hurts for a while',
      slick: 'OIL SLICK! slippery', buyout: player.tier === 0 ? 'LEVERAGED BUYOUT! shovel weakened' : 'LEVERAGED BUYOUT! tool downgraded', tos: '' }[lobby.effect];
    if (say) this.toast(say, 2, 0);
    // the pop-up takes the mouse (clicking it away is the joke) but leaves a phone player's thumbs where they are
    if (lobby.effect === 'tos') { $('tostext').textContent = TOS[Math.floor(Math.random() * TOS.length)]; document.exitPointerLock?.(); }
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) { $('toast').textContent = ''; this.toastPri = 0; }
    this.totShown = (this.totShown || 0) + (g.tot - (this.totShown || 0)) * Math.min(1, dt * 1.5);   // the national total spins up like an odometer
    for (let i = this.says.length - 1; i >= 0; i--) { const s = this.says[i]; if ((s.t -= dt) <= 0) { s.el.remove(); this.says.splice(i, 1); } else this.place(s); }
    for (let i = this.dying.length - 1; i >= 0; i--) if ((this.dying[i].t -= dt) <= 0) { this.dying[i].el.remove(); this.dying.splice(i, 1); }
    const tosOn = p.fx.tos > 0;
    if (this.tosWas && !tosOn && g.started && !g.over && document.pointerLockElement !== $('c')) g.lock();
    this.tosWas = tosOn; $('tos').hidden = !tosOn;
    // talking points drift across the screen while the effect lasts
    if (p.fx.hasbara > 0 && (this.bubbleT -= dt) <= 0) {
      this.bubbleT = 0.35;
      const el = document.createElement('div'); el.className = 'bubble'; el.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
      el.style.left = Math.random() * 70 + '%'; el.style.top = 10 + Math.random() * 65 + '%';
      $('fx').append(el); this.later(el, 1.4);
    }
    let slick = document.querySelector('#fx .slick');
    if (p.fx.slick > 0 && !slick) { slick = document.createElement('div'); slick.className = 'slick'; $('fx').append(slick); }
    if (p.fx.slick <= 0 && slick) slick.remove();

    if ((this.acc += dt) < 0.2) return;
    this.acc = 0;
    const n = g.net;
    const slim = innerWidth < 1000 || innerHeight < 500;   // anything but a wide screen gets the short form, on one line
    const line = n?.notice || (n?.online ? `${n.count.toLocaleString()} digging${slim ? '' : ' right now'}` + (g.tot > 0 ? ` · ${Math.round(this.totShown).toLocaleString()} m³${slim ? '' : ' dug together'}` : '') + (g.calls > 0 ? ` · ${g.calls.toLocaleString()} calls${slim ? '' : ' made'}` : '')
      : n?.full ? (n.everOnline ? `the dig is full right now: you are back in when a spot opens (retry in ${Math.max(0, Math.ceil(n.retryIn))}s)` : `the dig is full: warm up here, you join the real one when a spot opens (retry in ${Math.max(0, Math.ceil(n.retryIn))}s)`) : n?.everOnline ? 'reconnecting...' : g.solo ? 'practice dig: not shared' : g.started ? 'connecting to the shared dig...' : '');
    $('timer').textContent = g.notice ? `${g.notice}\n${line}` : line;
    g.giants.forEach((gi, i) => {
      const f = g.fields[i], id = gi.cfg.id, pct = Math.min(100, f.progress / CFG.dirt.doneAt * 100), st = g.status(i), sup = g.supercharged(i);
      $('pct-' + id).textContent = st === 'dug' ? 'OUT' : pctText(pct);
      $('man-' + id).className = 'man ' + (sup ? 'super' : st);
      $('tag-' + id).textContent = st === 'dug' ? 'dug out in time' : st === 'lost' ? 'too late: he is in' : sup ? 'out in real life: finish it' : n?.online && g.dg[i] > 0 ? `${g.dg[i].toLocaleString()} digging` : '';
    });
    const open = g.lobby.mounds.filter((m) => m.hp > 0);
    const html = open.map((m) => `<div style="--c:${m.lobby.color === '#222222' ? '#777' : m.lobby.color}"><span>${m.lobby.name}</span><div class="bar"><i style="width:${Math.round(Math.min(100, m.hp / CFG.lobby.moundHp * 100))}%"></i></div></div>`).join('');
    if (html !== this.moundsHtml || !this.feedPlaced) { this.feedPlaced = true; $('mounds').innerHTML = this.moundsHtml = html; $('feed').style.top = Math.round(Math.max($('mounds').getBoundingClientRect().bottom, $('menubtn').getBoundingClientRect().bottom) + 6) + 'px'; }   // crowd news sits under the lobby list, however tall that is
    const cfg = p.toolCfg, next = CFG.tools[p.tier + 1], cur = CFG.tools[p.tier];
    $('tool').textContent = cfg.name;
    $('next').textContent = next ? `next: ${next.name} at ${next.need} m³` : 'top machine';
    $('toolbar').style.width = (next ? Math.min(1, (p.dug - cur.need) / (next.need - cur.need)) * 100 : 100) + '%';
    $('hpbar').style.width = Math.max(0, p.hp) / CFG.player.hp * 100 + '%';
    const on = [];
    if (p.fx.hasbara > 0) on.push('talking points'); if (p.deductible > 0) on.push(`deductible ${p.deductible}`);
    if (p.fx.pricehike > 0) on.push('price hike'); if (p.fx.slick > 0) on.push('oil slick'); if (p.fx.buyout > 0) on.push('bought out');
    $('effects').textContent = on.join(' · ');
    $('digbtn').textContent = p.fighting ? 'SWAT' : 'DIG';
    $('dug').textContent = `you have dug ${Math.floor(p.dug)} m³`;
    this.map();
  }

  map() {
    const g = this.game, c = $('map'), x = c.getContext('2d'), S = c.width, k = S / 450;
    // Drawn the way you first see it from the lawn: the Capitol at the top, the Mall below, Hakeem's side on the right.
    const at = (wx, wz) => [S / 2 + wx * k, S / 2 + (wz - 40) * k];
    x.clearRect(0, 0, S, S);
    x.fillStyle = '#ead9b0'; let [a, b] = at(-70, -22); x.fillRect(a, b, 140 * k, 44 * k);
    for (const f of g.fields) { [a, b] = at(f.giant.x, f.giant.z); x.fillStyle = f.done ? '#3fae5a' : '#8a5a2c'; x.beginPath(); x.arc(a, b, 5, 0, 7); x.fill(); }
    for (const m of g.lobby.mounds) if (m.hp > 0) { [a, b] = at(m.x, m.z); x.fillStyle = '#000'; x.fillRect(a - 4, b - 4, 9, 9); x.fillStyle = m.lobby.color === '#222222' ? '#777' : m.lobby.color; x.fillRect(a - 3, b - 3, 7, 7); }
    x.fillStyle = '#fff'; for (const r of g.net.remotes.values()) if (!(r.flags & 4)) { [a, b] = at(r.pos.x, r.pos.z); x.fillRect(a - 1, b - 1, 2, 2); }   // everyone else in your room
    x.fillStyle = '#f33'; for (const ag of g.lobby.agents) { [a, b] = at(ag.pos.x, ag.pos.z); x.fillRect(a - 1, b - 1, 3, 3); }
    [a, b] = at(g.player.pos.x, g.player.pos.z); x.fillStyle = x.strokeStyle = '#ffc21a'; x.beginPath(); x.arc(a, b, 3, 0, 7); x.fill();
    x.lineWidth = 2; x.beginPath(); x.moveTo(a, b); x.lineTo(a + Math.sin(g.player.camYaw) * 9, b + Math.cos(g.player.camYaw) * 9); x.stroke();   // which way you are looking
  }
}
