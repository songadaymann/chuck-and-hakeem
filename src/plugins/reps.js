import './reps.css';

// "CALL YOUR REPS": type a ZIP, get your member of the House and your two senators, tap to ring their Washington office.
// The phone book is our own static files (public/data/reps, built by tools/build_reps.mjs; sources in tools/REPS-DATA.md).
// The ZIP never leaves this device: the only request it causes is for zip<first digit>.json from this site.

// ====================================================================================================================
// EVERY WORD THE CALLER SEES. Edit the wording here and nowhere else.
// {who} = "Representative Clarke" / "Senator Gillibrand", {zip} = the ZIP typed in, {n} = a number, {place} = a state,
// {start} = the first three digits of the ZIP.
// ====================================================================================================================
const COPY = {
  button: 'CALL YOUR REPS',
  startLine: 'Digging is half of it. The other half is a phone call:',
  keyHint: ' · C call your reps',
  title: 'Call your reps',
  intro: 'They work for you. Type your ZIP, ring the office, say two sentences. Offices keep a tally of what callers ask for.',
  zipLabel: 'Your ZIP',
  zipHint: 'Your ZIP stays on this device.',
  looking: 'looking it up...',
  // what to read aloud. D = an office that sits with the Democrats, R = any other office, self = the man himself.
  script: {
    house: {
      D: 'Hi, I am a constituent in ZIP {zip}. I am asking {who} to vote for new House Democratic leadership instead of Hakeem Jeffries.',
      R: 'Hi, I am a constituent in ZIP {zip}. I know {who} has no vote in the Democratic caucus, but please note that I want House Democrats to choose new leadership in place of Hakeem Jeffries.',
      self: 'Hi, I am a constituent in ZIP {zip}. I am asking Leader Jeffries to step aside and let House Democrats choose new leadership.',
    },
    senate: {
      D: 'Hi, I am a constituent in ZIP {zip}. I am asking {who} to vote for a new Senate Democratic leader instead of Chuck Schumer.',
      R: 'Hi, I am a constituent in ZIP {zip}. I know {who} has no vote in the Democratic caucus, but please note that I want Senate Democrats to choose a new leader in place of Chuck Schumer.',
      self: 'Hi, I am a constituent in ZIP {zip}. I am asking Leader Schumer to step aside and let Senate Democrats choose a new leader.',
    },
  },
  sayThis: 'Say this:',
  call: 'CALL {n}',
  called: 'I CALLED',
  calledDone: 'CALLED',
  count: 'calls made: {n}', countAll: ' · everyone: {n}',
  house: 'Your House member', senate: 'Your senators',
  split: 'ZIP {zip} is split between {n} House districts. Yours is one of these:',
  share: 'about {n}% of this ZIP', shareTiny: 'under 1% of this ZIP', shareMost: 'nearly all of this ZIP',
  twoStates: 'This ZIP crosses a state line, so here are the senators for both sides.',
  vacant: '{place}: this seat is empty right now. Nobody to call until it is filled.',
  noSenators: '{place}: no senators, no vote in the Senate. That is not a glitch in the game.',
  delegate: 'non-voting: no vote on the House floor',
  viaBoard: 'no direct line on file: this is the Capitol switchboard, ask for the office by name',
  atLarge: 'at large', district: 'district {n}', senator: 'senator',
  party: { D: 'Democrat', R: 'Republican', I: 'Independent' },
  sitsWith: { D: 'sits with the Democrats', R: 'sits with the Republicans' },
  notFound: 'ZIP {zip} is not in our phone book (ZIPs that are only PO boxes are missing). Try the ZIP where you live, or ring the switchboard and ask for your member by name.',
  // a ZIP the phone book lacks, in a run of ZIPs that all lie in one state: enough for the senators, not for a House district
  nearby: 'ZIP {zip} is not in our phone book (PO-box ZIPs are not). Every ZIP we do have that starts {start} is in one place: {place}. If that is where you live:',
  nearbyHouse: 'A ZIP we do not have cannot tell us your House district. Look up your street address at',
  noBook: 'Our phone book did not load. The Capitol switchboard will put you through to any office.',
  switchboard: 'Capitol switchboard, any office:',
  wrongRep: 'ZIP codes do not follow district lines exactly. Not who you expected? Check your street address at',
  finderLink: 'house.gov/representatives/find-your-representative',
  current: 'These are the people in office today. The Congress elected on November 3 does not start until January 3.',
  source: 'Phone book: Clerk of the House, senate.gov, Census Bureau. Built {n}.',
  close: 'close',
  // the big centre-screen line after I CALLED, picked in turn
  thanks: ['CALL LOGGED.\nSOMEWHERE A STAFFER SIGHED', 'ONE MORE TALLY MARK\nON A LEGAL PAD', 'THE PHONES ARE RINGING.\nKEEP DIGGING', 'DEMOCRACY,\nNOW WITH HOLD MUSIC'],
};

// (202) 224-3121 is the one switchboard for both chambers: read off senate.gov/general/contacting.htm and house.gov/contact on 2026-11-11.
const SWITCHBOARD = '202-224-3121';
const FINDER = 'https://www.house.gov/representatives/find-your-representative';
const SELF = { J000294: 1, S000148: 1 };   // Bioguide ids of Jeffries and Schumer: their own offices get the "step aside" script
const KEY = 'chuck-hakeem-reps';
const CONFETTI = [0xffc21a, 0x3fae5a, 0xe2392f, 0xead9b0];
const DATA = import.meta.env.BASE_URL + 'data/reps/';

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const tel = (ph) => 'tel:+1' + ph.replace(/\D/g, '');

export function init(game) {
  // called: Bioguide id -> the day of the last call logged (one a day per member); n: calls logged, ever
  let mem = { zip: '', called: {}, n: 0 };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.called && typeof s.called === 'object') mem = { zip: /^\d{5}$/.test(s.zip) ? s.zip : '', called: s.called, n: s.n >= 0 ? Math.floor(s.n) : Object.keys(s.called).length }; } catch (e) { /* private window */ }
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* private window */ } };
  const made = () => mem.n, today = () => new Date().toLocaleDateString('en-CA');

  // ---- the files, fetched once each and only when somebody asks
  const cache = {};
  const file = (name) => (cache[name] ||= fetch(DATA + name).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { if (!j) delete cache[name]; return j; }));

  // ---- the placard
  const root = el('div'); root.id = 'reps'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', COPY.title);
  const box = el('div', 'box'), x = el('button', 'alt x', 'X'), zip = el('input'), out = el('div', 'out'), tally = el('p', 'tally'), shut = el('button', 'alt', COPY.close);
  x.setAttribute('aria-label', COPY.close);
  Object.assign(zip, { id: 'repszip', type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 5, autocomplete: 'postal-code', placeholder: '00000' });
  const row = el('label', 'ziprow', COPY.zipLabel); row.append(zip, el('small', '', COPY.zipHint));
  const foot = el('div', 'foot'); foot.append(tally, shut);
  box.append(x, el('h2', '', COPY.title), el('p', 'intro', COPY.intro), row, out, foot);
  root.append(box); document.body.append(root);

  // ---- the two ways in: a HUD button (C on a keyboard) and a line on the start screen
  const btn = el('button', '', COPY.button), badge = el('i'); btn.id = 'repsbtn'; btn.append(badge);
  document.getElementById('hud').append(btn);
  const line = el('p', 'repsline', COPY.startLine + ' '), startBtn = el('button', 'alt', COPY.button);
  line.append(startBtn);
  { const sec = el('section', 'sec'), h = el('h2', '', 'Call your reps'); sec.append(h, line); (document.getElementById('you') || document.getElementById('loading'))?.after(sec); }
  document.querySelector('#start .keys.kb')?.append(COPY.keyHint);

  const showTally = () => { const n = made(), all = Math.max(game.calls || 0, n); tally.textContent = fill(COPY.count, { n }) + (all > n ? fill(COPY.countAll, { n: all.toLocaleString() }) : ''); badge.textContent = n || ''; };

  let openedAt = 0, held = false, logged = false;
  function open() {
    if (!root.hidden) return;
    root.classList.add('modal-open');   // the core's word for "a panel is up": no "click the game" hint when the mouse comes free
    document.exitPointerLock?.(); game.touch?.clear();
    dispatchEvent(new Event('blur'));   // the core lets go of every held key and button when the window loses focus: say it did, so nobody walks or digs on behind the placard
    root.hidden = false; btn.classList.add('seen'); box.scrollTop = 0; openedAt = performance.now();
    zip.value = mem.zip; showTally();
    if (mem.zip) lookup(mem.zip); else { out.replaceChildren(); if (!document.body.classList.contains('touch')) zip.focus(); }
  }
  function close() {
    if (root.hidden) return;
    root.hidden = true; root.classList.remove('modal-open'); zip.blur(); root.querySelector('.cheer')?.remove();
    if (game.started && !game.over && document.getElementById('start').hidden && !document.body.classList.contains('touch')) game.lock();
    // back from the phone: arms up and a handful of confetti, where everybody near you can see it
    const p = game.player;
    if (logged && game.started && p.dead <= 0) { p.avatar.cheer(2.5); game.bus.emit('cheer', { x: p.pos.x, y: p.pos.y, z: p.pos.z, self: true }); game.puff(p.pos.x, p.pos.y + 2.2, p.pos.z, 14, 0.3, CONFETTI); }
    logged = false;
  }

  // One member's card: who, the number as a tel: link, what to say, and the button that owns up to it.
  function card(m, chamber, state, where, book, note) {
    const c = el('div', 'rep ' + (m.c === 'D' ? 'd' : m.c === 'R' ? 'r' : 'i')), who = el('div', 'who');
    const party = COPY.party[m.p] || m.p, sits = m.p !== m.c && COPY.sitsWith[m.c] ? ` (${COPY.sitsWith[m.c]})` : '';
    who.append(el('b', '', m.n), el('span', '', `${party}${sits} · ${book.states[state] || state} · ${where}`));
    for (const n of [note, !m.ph && COPY.viaBoard]) if (n) who.append(el('em', '', n));
    c.append(who);
    const a = el('a', 'call', fill(COPY.call, { n: m.ph || SWITCHBOARD })); a.href = tel(m.ph || SWITCHBOARD);
    const title = chamber === 'senate' ? 'Senator' : m.t || 'Representative';
    const say = el('blockquote', '', fill(COPY.script[chamber][SELF[m.id] ? 'self' : m.c === 'D' ? 'D' : 'R'], { zip: mem.zip, who: `${title} ${m.l}` }));
    const done = el('button', 'did');
    const mark = () => { const yes = mem.called[m.id] === today(); done.textContent = yes ? COPY.calledDone : COPY.called; done.classList.toggle('yes', yes); c.classList.toggle('done', yes); };
    done.onclick = () => {
      if (mem.called[m.id] === today()) return;
      mem.called[m.id] = today(); mem.n++; logged = true; remember(); mark(); showTally(); c.classList.add('pop');
      game.bus.emit('called', { chamber, party: m.p, state });
      // the game's own toast (other add-ons hear it), and the same line on top of the placard, which hides the toast
      const msg = COPY.thanks[(made() - 1) % COPY.thanks.length], cheer = el('div', 'cheer', msg);
      game.hud.toast(msg, 4);
      root.querySelector('.cheer')?.remove(); root.append(cheer); cheer.onanimationend = () => cheer.remove();
    };
    mark();
    c.append(a, el('small', 'say', COPY.sayThis), say, done);
    return c;
  }

  const finder = (cls, why) => { const p = el('p', cls, why + ' '), a = el('a', '', COPY.finderLink); Object.assign(a, { href: FINDER, target: '_blank', rel: 'noopener noreferrer' }); p.append(a); return p; };
  const switchboard = (why) => { const p = el('p', 'board', why + ' '), a = el('a', 'call', fill(COPY.call, { n: SWITCHBOARD })); a.href = tel(SWITCHBOARD); p.append(a); return p; };

  async function lookup(z) {
    out.replaceChildren(el('p', 'note', COPY.looking));
    const [book, zips] = await Promise.all([file('members.json'), file(`zip${z[0]}.json`)]);
    if (zip.value !== z) return;   // they typed on while it loaded
    mem.zip = z; remember();
    if (!book || !zips) { out.replaceChildren(switchboard(COPY.noBook)); return; }
    // "NY12", or "CA32:62,CA36:38,CA30:0" when the ZIP touches several districts (each with its share of the ZIP's land)
    let parts = (zips[z] || '').split(',').filter(Boolean).map((s) => { const [key, share] = s.split(':'); return { key, share: share && Number(share), state: key.slice(0, 2), seat: book.house[key] }; }).filter((p) => p.seat);
    // not on file, but "008": "VI" says every ZIP we do have with that start is in one state
    const near = !parts.length && book.states[zips[z.slice(0, 3)]] ? zips[z.slice(0, 3)] : '';
    if (!parts.length && !near) { out.replaceChildren(switchboard(fill(COPY.notFound, { zip: z }))); return; }
    const kids = [];
    if (near) {
      kids.push(el('p', 'note', fill(COPY.nearby, { zip: z, start: z.slice(0, 3), place: book.states[near] })));
      const seat = book.house[near + '00'];   // a state with one seat has no districts to tell apart
      if (seat) parts = [{ key: near + '00', state: near, seat }];
    }
    kids.push(el('h3', '', COPY.house));
    if (!parts.length) kids.push(finder('note', COPY.nearbyHouse));
    if (parts.length > 1) kids.push(el('p', 'note', fill(COPY.split, { zip: z, n: parts.length })));
    for (const p of parts) {
      const n = Number(p.key.slice(2)), where = p.seat.t ? p.seat.t.toLowerCase() : n ? fill(COPY.district, { n }) : COPY.atLarge;
      const share = p.share == null ? '' : p.share < 1 ? COPY.shareTiny : p.share > 99 ? COPY.shareMost : fill(COPY.share, { n: p.share });
      if (p.seat.vacant) kids.push(el('p', 'note', fill(COPY.vacant, { place: `${book.states[p.state] || p.state}, ${where}` }) + (share ? ` (${share})` : '')));
      else kids.push(card(p.seat, 'house', p.state, where, book, [p.seat.t && COPY.delegate, share].filter(Boolean).join(' · ')));
    }
    const states = near ? [near] : [...new Set(parts.map((p) => p.state))];
    kids.push(el('h3', '', COPY.senate));
    if (states.length > 1) kids.push(el('p', 'note', COPY.twoStates));
    for (const st of states) {
      const pair = book.senate[st] || [];
      if (!pair.length) kids.push(el('p', 'note', fill(COPY.noSenators, { place: book.states[st] || st })));
      for (const s of pair) kids.push(card(s, 'senate', st, COPY.senator, book));
    }
    kids.push(switchboard(COPY.switchboard), finder('fine', COPY.wrongRep), el('p', 'fine', COPY.current), el('p', 'fine', fill(COPY.source, { n: book.built })));
    out.replaceChildren(...kids);
    if (document.body.classList.contains('touch')) zip.blur();   // put the phone's keyboard away so the numbers show
  }

  zip.addEventListener('input', () => {
    const z = zip.value.replace(/\D/g, '').slice(0, 5);
    if (z !== zip.value) zip.value = z;
    if (z.length === 5) lookup(z); else out.replaceChildren();
  });
  // phones send no click while another thumb is still down on the stick
  const tap = (b, fn) => { b.onclick = fn; b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); held = root.hidden; fn(); } }); };
  tap(btn, open); startBtn.onclick = open; x.onclick = shut.onclick = close;
  // The tap that opens the placard also lands, as a click, on whatever the placard put under the thumb: never let that
  // be a phone number, however long the thumb stays down. (And the dark surround closes on the click, not the press, so
  // nothing behind it gets one.)
  const lift = () => { if (held) { held = false; openedAt = performance.now(); } };
  addEventListener('pointerup', lift, true); addEventListener('pointercancel', lift, true);
  root.addEventListener('click', (e) => { if (held || performance.now() - openedAt < 450) { e.preventDefault(); e.stopImmediatePropagation(); } else if (e.target === root) close(); }, true);
  // While the placard is up no key reaches the game (so nobody digs by accident); Esc closes, C opens.
  addEventListener('keydown', (e) => {
    if (!root.hidden) { e.stopPropagation(); if (e.code === 'Escape') close(); return; }
    if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey && !e.altKey && document.activeElement?.tagName !== 'INPUT' && !game.typing?.()) open();
  }, true);

  showTally();
  // nobody gets lobbied while they are on the phone to Congress
  return { open, close, lookup: (z) => { zip.value = z; return lookup(z); }, update() { if (!root.hidden && game.player.safe < 1) game.player.safe = 1; } };
}
