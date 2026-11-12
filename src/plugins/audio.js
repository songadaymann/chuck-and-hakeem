// Every sound in the game. The effects are made on the spot with WebAudio: no audio files, nothing to download. They
// listen on the bus (src/EVENTS.md); other add-ons can ask for one by name: game.plugins.audio?.play('bonk', { x, y, z, vol }).
// The one file is the song, played quietly under it all once you have pressed Start (see "the song" in init).
// Nothing here runs under ?capture (recordings are stepped frame by frame) or where there is no AudioContext.
import './audio.css';
import { at as address } from '../base.js';
import { roadAt, walkAt, inPool } from '../scenery/plan.js';

const KEY = 'dig-them-out-mute', MAX = 10;   // at most this many sounds at once (the bed and engines are extra)
// The song: "Chuck And Hakeem Won't Leave", written and performed by Jonathan Mann (his Song A Day about this game).
// public/audio/ holds a 96 kbps MP3 of it at -16 LUFS; tools/song.sh has the exact ffmpeg command that makes it.
const SONG = '/audio/chuck-and-hakeem-wont-leave.mp3', SONG_TITLE = "Chuck And Hakeem Won't Leave", SONG_BY = 'Jonathan Mann';
// How loud the song is, as a plain multiplier on that file: low in the mix, clearly under the effects. Measured against
// effects rendered through the game's own graph (loudest 100 ms, RMS): the song is typically at -35 dBFS, a shovel bite
// at -28, the first NEW TOOL fanfare at -18, a man coming out at -12; the wind-and-city bed lies at -41. Its highest
// peak (-19 dBFS) stays under one bite's (-15). Twice the number is 6 dB more.
const MUSIC_LEVEL = 0.16;
const MUSIC_START = 3, MUSIC_GAP = 20, MUSIC_FADE = 1.5;   // seconds: after Start before it begins, of quiet between two plays, of fade-in
const KEY_MUSIC = 'dig-them-out-music', KEY_WAS = 'dig-them-out-sound-was';   // KEY is the older one: '1' there means the effects are off
const hz = (m) => 440 * 2 ** ((m - 69) / 12);                            // MIDI note number to frequency
const rnd = (a, b) => a + Math.random() * (b - a);
const vary = (x, k = 0.04) => x * (1 + (Math.random() - 0.5) * 2 * k);   // never quite the same twice

// name: [level, least seconds between two of them, how many may sound at once]. The levels were set by measuring each
// recipe (bites about a third as loud as a new tool, a man coming out the loudest of all), not by eye.
const MIX = {
  shovel: [0.19, 0.1, 2], pickaxe: [0.22, 0.1, 2], jackhammer: [0.1, 0.2, 2], trencher: [0.12, 0.2, 2], skid_steer: [0.14, 0.3, 2], backhoe_loader: [0.13, 0.3, 2],
  excavator: [0.13, 0.3, 2], bulldozer: [0.16, 0.3, 2], mining_shovel: [0.13, 0.3, 2], bucket_wheel_excavator: [0.1, 0.25, 2],
  thunk: [0.16, 0.25, 1], denied: [0.26, 0.2, 1], streak: [0.09, 0.3, 2], step: [0.3, 0.12, 2], splash: [0.19, 0.25, 2],
  hasbara: [0.19, 0.6, 1], deductible: [0.25, 0.6, 1], pricehike: [0.38, 0.6, 1], slick: [0.22, 0.6, 1], buyout: [0.42, 0.6, 1], tos: [0.22, 0.6, 1],
  lobbyist: [0.12, 1.5, 1], shot: [0.27, 0.15, 2], bonk: [0.3, 0.06, 2], splat: [0.29, 0.1, 2], paper: [0.2, 0.2, 1],
  klaxon: [0.18, 3, 1], thump: [0.22, 0.18, 2], moundDown: [0.24, 1, 1],
  toolUp: [0.32, 0.5, 1], milestone: [0.5, 2, 1], out: [0.55, 5, 1], late: [0.28, 5, 1], toll: [0.2, 3, 1], tick: [0.18, 0.4, 1],
  dead: [0.26, 1, 1], respawn: [0.33, 1, 1], woo: [0.3, 0.8, 1], hey: [0.24, 0.25, 2], mumble: [0.5, 3, 1],
  far: [0.11, 0.09, 3], blip: [0.13, 0.5, 1], pop: [0.13, 0.4, 1], back: [0.22, 2, 1], ring: [0.21, 2, 1],
  honk: [0.11, 0.5, 1], bell: [0.16, 0.5, 1], siren: [0.05, 9, 1], pigeons: [0.36, 2, 1], whoosh: [0.18, 0.4, 2], goose: [0.22, 0.3, 2], bird: [0.07, 1, 1],
  click: [0.24, 0.04, 2], slam: [0.2, 0.3, 1], shift: [0.12, 2, 1],
};
// each machine's engine: pitch (Hz), chugs a second, how dull, how much rattle, how loud
const ENGINES = { skid_steer: [62, 15, 560, 0.3, 0.1], backhoe_loader: [52, 12, 480, 0.35, 0.11], excavator: [45, 10, 420, 0.4, 0.12], bulldozer: [38, 8, 360, 0.6, 0.14],
  mining_shovel: [33, 6.5, 320, 0.6, 0.16], bucket_wheel_excavator: [27.5, 4.4, 280, 0.8, 0.2] };
// aircraft from the sky scenery: how far they carry (m), how loud
const FLYERS = { airliner: [520, 0.22], helicopter: [170, 0.2], banner: [150, 0.14], geese: [130, 1] };

// The synthesiser. Give it an AudioContext (a live one, or an OfflineAudioContext to measure levels) and it returns
// play(name, opts) plus the few sounds that keep going. Everything is scheduled on the audio clock.
export function engine(ac, game) {
  const offline = !!ac.startRendering;
  const master = ac.createGain(), comp = ac.createDynamicsCompressor(), post = ac.createGain();
  // one sound at a time passes nearly untouched; the compressor is there for the pile-ups, and can put out no more than 0.8
  comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 12; comp.attack.value = 0.003; comp.release.value = 0.25;
  post.gain.value = 0.9;
  master.connect(comp).connect(post).connect(ac.destination);
  const NOISE = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), voices = [], last = {};
  { const d = NOISE.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  // ---- building blocks. A voice `v` is one sound: v.t is when it starts, v.out is where its parts go.
  // (shut until its moment: a source and its envelope can start a sample apart, and one sample of noise at full gain is a click)
  const env = (g, t, vol, a, dur, hold = 0) => { g.value = 0; g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + a); if (hold) g.setValueAtTime(vol, t + a + hold); g.exponentialRampToValueAtTime(0.0001, t + dur); };
  // a note: `to` slides the pitch; o = { a: attack, hold, bend: share of the note the slide takes, into: another node }
  const tone = (v, t, f, dur, vol, type = 'sine', to = 0, o = {}) => {
    const t0 = v.t + t, osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur * (o.bend || 1));
    env(g.gain, t0, vol, o.a || 0.006, dur, o.hold);
    osc.connect(g).connect(o.into || v.out); osc.start(t0); osc.stop(t0 + dur + 0.02);
    v.end = Math.max(v.end, t0 + dur + 0.02);
    return osc;
  };
  // a burst of filtered noise: `to` sweeps the filter; o as for tone, plus q
  const hiss = (v, t, f, dur, vol, type = 'lowpass', to = 0, o = {}) => {
    const t0 = v.t + t, src = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = NOISE; src.loop = true; flt.type = type; flt.Q.value = o.q || 0.7; flt.frequency.setValueAtTime(f, t0);
    if (to) flt.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    env(g.gain, t0, vol, o.a || 0.004, dur, o.hold);
    src.connect(flt).connect(g).connect(o.into || v.out); src.start(t0, Math.random() * 1.9); src.stop(t0 + dur + 0.02);
    v.end = Math.max(v.end, t0 + dur + 0.02);
  };
  const filt = (v, f, type = 'lowpass', q = 0.7) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(v.out); return n; };
  // tremolo: a stage that dips `depth` of the way to silence `rate` times a second
  const chop = (v, dur, rate, depth, type = 'sine', into = v.out) => {
    const g = ac.createGain(), o = ac.createOscillator(), d = ac.createGain();
    g.gain.value = 1 - depth / 2; o.type = type; o.frequency.value = rate; d.gain.value = depth / 2;
    o.connect(d).connect(g.gain); g.connect(into); o.start(v.t); o.stop(v.t + dur + 0.05);
    return g;
  };
  const vib = (v, osc, t, dur, rate, depth) => { const o = ac.createOscillator(), d = ac.createGain(); o.frequency.value = rate; d.gain.value = depth; o.connect(d).connect(osc.frequency); o.start(v.t + t); o.stop(v.t + t + dur); };
  const run = (v, t, notes, step, dur, vol, type) => notes.forEach((m, i) => tone(v, t + i * step, hz(m), dur, vol, type));
  const thud = (v, t, f, dur, vol) => { tone(v, t, f, dur, vol, 'sine', f * 0.5); hiss(v, t, f * 7, dur * 0.7, vol * 0.6); };
  // a heavy one, with enough above 200 Hz to be heard on a phone
  const heavy = (v, t, f, dur, vol = 1) => { tone(v, t, f, dur, vol, 'sine', f * 0.5); tone(v, t, f * 2, dur * 0.7, vol * 0.4, 'triangle', f); hiss(v, t, f * 9, dur, vol * 0.7, 'lowpass', f * 3); };
  // hydraulics: a saw through a narrow band, shuddering as it slides from f0 to f1
  const groan = (v, t, f0, f1, dur, vol = 0.45) => {
    const bp = filt(v, f0 * 4, 'bandpass', 2.5);
    bp.frequency.setValueAtTime(f0 * 4, v.t + t); bp.frequency.exponentialRampToValueAtTime(f1 * 4, v.t + t + dur);
    vib(v, tone(v, t, f0, dur, vol, 'sawtooth', f1, { into: bp, a: dur * 0.25, hold: dur * 0.4 }), t, dur, 23, f0 * 0.04);
  };
  const clank = (v, t, f, vol = 0.3) => { tone(v, t, f, 0.22, vol, 'square'); tone(v, t, f * 1.48, 0.16, vol * 0.6, 'square'); tone(v, t, f * 2.76, 0.1, vol * 0.5); };
  // the dirt you threw coming back down
  const patter = (v, t, n, f = 900, spread = 0.5) => { for (let i = 0; i < n; i++) hiss(v, t + Math.random() * spread, vary(f, 0.3), 0.045, rnd(0.08, 0.2)); };
  const bell = (v, t, f, vol = 1) => [[1, 1, 1.8], [2, 0.5, 1.3], [2.4, 0.35, 1], [3, 0.2, 0.8], [4.5, 0.12, 0.5]].forEach(([k, a, d]) => tone(v, t, f * k, d, vol * a * 0.5));
  // a crowd: two bands of noise that swell and flutter
  const crowd = (v, t, dur, vol) => {
    const am = chop(v, t + dur, rnd(6, 8), 0.4);
    hiss(v, t, 800, dur, vol, 'bandpass', 1300, { into: am, a: dur * 0.3, hold: dur * 0.3, q: 0.8 });
    hiss(v, t, 3200, dur, vol * 0.4, 'highpass', 0, { into: am, a: dur * 0.35, hold: dur * 0.3 });
  };
  const brass = (v, t, notes, dur, vol, lp) => { for (const m of notes) tone(v, t, hz(m), dur, vol, 'sawtooth', 0, { into: lp, a: 0.03, hold: dur * 0.55 }); };
  const ouch = (v) => tone(v, 0, 170, 0.09, 0.5, 'sine', 80);   // under every lobby sting: the thing hitting you

  // ---- the recipes
  const S = {
    // your ten tools
    shovel(v) { hiss(v, 0, vary(2600), 0.12, 0.45, 'bandpass', 800, { a: 0.03, q: 1.2 }); thud(v, 0.07, vary(105), 0.16, 0.9); patter(v, 0.5, 4); },
    pickaxe(v) { const f = vary(1750, 0.06); tone(v, 0, f, 0.09, 0.45, 'triangle'); tone(v, 0, f * 1.51, 0.06, 0.25); hiss(v, 0, 5000, 0.03, 0.3, 'highpass'); thud(v, 0.02, vary(120), 0.11, 0.7); patter(v, 0.45, 3); },
    jackhammer(v) { const am = chop(v, 0.4, vary(17, 0.08), 1, 'square', filt(v, 1700)); tone(v, 0, vary(88), 0.36, 0.55, 'square', 0, { into: am, hold: 0.28 }); hiss(v, 0, 2600, 0.36, 0.5, 'bandpass', 0, { into: am, hold: 0.28 }); },
    trencher(v) {
      const am = chop(v, 0.4, vary(38), 0.7, 'sawtooth', filt(v, 1100)), f = vary(74);
      tone(v, 0, f, 0.34, 0.55, 'sawtooth', 0, { into: am, a: 0.05, hold: 0.2 }); tone(v, 0, f * 1.5, 0.34, 0.25, 'square', 0, { into: am, a: 0.05, hold: 0.2 });
      hiss(v, 0, 1500, 0.34, 0.3, 'bandpass', 0, { a: 0.05, hold: 0.2 });
    },
    skid_steer(v) { heavy(v, 0, vary(84), 0.28); groan(v, 0.12, vary(210), 300, 0.4, 0.4); patter(v, 0.6, 5, 700); },
    backhoe_loader(v) { heavy(v, 0, vary(74), 0.34); groan(v, 0.1, vary(170), 120, 0.3, 0.4); groan(v, 0.45, 150, 230, 0.4, 0.4); patter(v, 0.8, 5, 700); },
    excavator(v) { heavy(v, 0, vary(64), 0.42); hiss(v, 0, 1800, 0.3, 0.3, 'bandpass', 600); groan(v, 0.2, vary(140), 220, 0.7); patter(v, 0.9, 6, 600, 0.7); },
    bulldozer(v) {
      hiss(v, 0, 260, 0.9, 0.9, 'lowpass', 150, { a: 0.1, hold: 0.5 }); heavy(v, 0.05, vary(56), 0.5, 0.8); groan(v, 0.3, 95, 80, 0.5, 0.3);
      for (let i = 0; i < 5; i++) tone(v, 0.1 + i * 0.11, vary(900, 0.1), 0.03, 0.12, 'square');   // track plates
    },
    mining_shovel(v) { heavy(v, 0, vary(46), 0.9); heavy(v, 0.06, 92, 0.4, 0.5); clank(v, 0.02, vary(330)); groan(v, 0.3, vary(105), 70, 0.5); groan(v, 0.9, 80, 150, 1); patter(v, 1.2, 8, 500, 0.9); },
    bucket_wheel_excavator(v) { heavy(v, 0, vary(50, 0.08), 0.4, 0.9); clank(v, 0, vary(410, 0.12), 0.2); hiss(v, 0.05, 500, 0.4, 0.4, 'lowpass', 200); patter(v, 0.3, 3, 500, 0.3); },
    // a bite that found only lawn, and one the insurers refused
    thunk(v, o) { const f = vary(190 - (o.tier || 0) * 12); tone(v, 0, f, 0.09, 0.8, 'triangle', f * 0.6); hiss(v, 0, 500, 0.06, 0.4); },
    denied(v) { hiss(v, 0, 320, 0.07, 1); tone(v, 0, 90, 0.14, 1, 'sine', 55); hiss(v, 0.01, 2500, 0.03, 0.25, 'bandpass'); const lp = filt(v, 900); for (const t of [0.12, 0.27]) tone(v, t, 150, 0.11, 0.22, 'square', 0, { into: lp, hold: 0.07 }); },
    streak(v, o) { const f = hz(o.note || 72); tone(v, 0, f, 0.24, 0.8); tone(v, 0, f * 4, 0.05, 0.15); },
    step(v, o) {
      const k = o.foot ? 1.08 : 1;
      if (o.kind === 'stone') { hiss(v, 0, vary(1900 * k, 0.15), 0.035, 0.7, 'bandpass', 0, { q: 2 }); tone(v, 0, vary(260 * k, 0.1), 0.03, 0.3, 'triangle'); }
      else if (o.kind === 'dirt') { hiss(v, 0, vary(430 * k, 0.2), 0.08, 0.6, 'bandpass', 0, { a: 0.012, q: 0.8 }); hiss(v, 0.02, 3000, 0.04, 0.1, 'highpass'); }
      else hiss(v, 0, vary(1100 * k, 0.2), 0.07, 0.6, 'bandpass', 0, { a: 0.015 });
    },
    // the six lobbies landing one on you
    hasbara(v) {   // a muted trombone: wah-wah
      ouch(v);
      for (const [m, t, d] of [[58, 0.05, 0.3], [57, 0.37, 0.55]]) {
        const lp = filt(v, 350, 'lowpass', 4), t0 = v.t + t;
        lp.frequency.setValueAtTime(350, t0); lp.frequency.linearRampToValueAtTime(1300, t0 + d * 0.35); lp.frequency.linearRampToValueAtTime(380, t0 + d * 0.9);
        tone(v, t, hz(m), d, 0.7, 'sawtooth', hz(m) * 0.97, { into: lp, a: 0.04, hold: d * 0.5 });
      }
    },
    deductible(v) { ouch(v); hiss(v, 0.03, 1500, 0.09, 0.5, 'bandpass', 500); tone(v, 0.11, 150, 0.1, 0.8, 'sine', 90); tone(v, 0.13, 2093, 0.5, 0.4); tone(v, 0.13, 3140, 0.3, 0.2); },   // a cash drawer
    pricehike(v) { ouch(v); run(v, 0.03, [84, 86, 88, 91, 93, 96], 0.055, 0.09, 0.35, 'triangle'); tone(v, 0.38, hz(100), 0.5, 0.35); tone(v, 0.38, hz(107), 0.3, 0.15); },   // the till, going up
    slick(v) { ouch(v); [0.04, 0.17, 0.34].forEach((t, i) => tone(v, t, vary(160 + i * 40, 0.1), 0.11, 0.8, 'sine', 420 + i * 90, { a: 0.02 })); tone(v, 0, 300, 0.5, 0.35, 'sine', 80, { a: 0.05 }); hiss(v, 0, 400, 0.5, 0.3, 'lowpass', 150, { a: 0.1 }); },
    buyout(v) { ouch(v); run(v, 0.03, [79, 76, 72, 67], 0.13, 0.2, 0.45, 'triangle'); for (const t of [0.6, 0.72]) { hiss(v, t, 900, 0.06, 0.9, 'bandpass', 0, { q: 8 }); tone(v, t, 220, 0.05, 0.5); } },   // going, going, sold
    tos(v) { ouch(v); [0.03, 0.22].forEach((t, i) => { for (const m of [69, 70, 76]) tone(v, t, hz(m - i * 2), 0.17, 0.3, 'triangle', 0, { a: 0.01, hold: 0.08 }); }); },   // the computer says no
    // lobbyists and their nests
    lobbyist(v) { const lp = filt(v, 1500); tone(v, 0, hz(64), 0.16, 0.5, 'square', 0, { into: lp, a: 0.02, hold: 0.1 }); vib(v, tone(v, 0.17, hz(67) * 0.94, 0.5, 0.5, 'square', hz(70), { into: lp, a: 0.03, hold: 0.3, bend: 0.3 }), 0.3, 0.4, 6.5, 9); },
    shot(v) { hiss(v, 0, 900, 0.14, 0.6, 'bandpass', 3200, { a: 0.03, q: 1.5 }); tone(v, 0, vary(520), 0.12, 0.25, 'sine', 950); },
    bonk(v, o) { const f = vary(410, 0.08); hiss(v, 0, f * 2, 0.07, 1, 'bandpass', 0, { q: 9 }); tone(v, 0, f, 0.09, 0.9, 'sine', f * 0.85); tone(v, 0, f * 2.4, 0.04, 0.3, 'triangle'); if (o.down) tone(v, 0.06, 700, 0.3, 0.25, 'sine', 1800, { a: 0.03 }); },
    splat(v) { hiss(v, 0, 1400, 0.2, 1, 'lowpass', 180); tone(v, 0, 170, 0.18, 0.8, 'sine', 55); tone(v, 0.05, 240, 0.09, 0.3, 'sine', 520); tone(v, 0.13, 200, 0.08, 0.25, 'sine', 420); },
    paper(v) { for (let i = 0; i < 5; i++) hiss(v, i * 0.05 + Math.random() * 0.03, vary(4500, 0.2), 0.04, 0.5, 'highpass', 0, { a: 0.01 }); },
    klaxon(v) { const lp = filt(v, 950); for (const t of [0, 0.5]) { tone(v, t, 150, 0.42, 0.5, 'sawtooth', 196, { into: lp, a: 0.03, hold: 0.3, bend: 0.25 }); tone(v, t, 226, 0.42, 0.3, 'square', 294, { into: lp, a: 0.03, hold: 0.3, bend: 0.25 }); } },
    thump(v) { const f = vary(125, 0.06); tone(v, 0, f, 0.16, 1, 'sine', f * 0.6); hiss(v, 0, 320, 0.12, 0.9, 'bandpass', 0, { q: 6 }); tone(v, 0, f * 2.5, 0.05, 0.2, 'triangle'); },
    moundDown(v) {
      hiss(v, 0, 500, 1.5, 1, 'lowpass', 70, { a: 0.1, hold: 0.7 }); tone(v, 0, 60, 1.3, 0.6, 'sine', 32, { a: 0.1, hold: 0.6 }); tone(v, 0, 120, 1.1, 0.25, 'triangle', 60, { a: 0.1, hold: 0.5 });
      const lp = filt(v, 1700); [67, 72].forEach((m, i) => brass(v, 1 + i * 0.13, [m], 0.14, 0.3, lp)); brass(v, 1.26, [64, 72, 76], 0.6, 0.22, lp);
    },
    // news
    toolUp(v, o) {   // the higher the tool, the more of the band turns up
      const n = o.tier || 1, lead = [72, 76, 79, 84, 88, 91, 96].slice(0, 4 + Math.min(3, n >> 1)), s = 0.085, end = (lead.length - 1) * s, long = 0.5 + n * 0.12, lp = filt(v, 1500 + n * 120), vol = Math.max(0.45, 0.9 - n * 0.12);
      lead.forEach((m, i) => { const fin = i === lead.length - 1; tone(v, i * s, hz(m), fin ? long : 0.18, vol, 'triangle'); tone(v, i * s, hz(m + 12), fin ? long * 0.6 : 0.1, vol / 4); });
      if (n >= 2) brass(v, end, n >= 6 ? [48, 55, 60, 64, 67] : [55, 60, 64], long, 0.15, lp);
      if (n >= 4) { hiss(v, end, 7000, 0.9, 0.25, 'highpass'); heavy(v, end, 65, 0.5, 0.6); for (const k of [1, 1.26]) tone(v, end + long * 0.5, 220 * k, 0.45, 0.16, 'square', 0, { into: lp, a: 0.02, hold: 0.33 }); }   // a machine: cymbal, drum and its own horn
      if (n >= 8) { for (let i = 0; i < 6; i++) heavy(v, i * 0.07, 72, 0.12, 0.25 + i * 0.07); crowd(v, end, 2.6, 0.35); brass(v, end + 0.3, [72, 76, 79], long, 0.1, lp); }
    },
    milestone(v) { crowd(v, 0, 1.7, 0.6); run(v, 0.1, [67, 72], 0.16, 0.5, 0.35, 'triangle'); },
    out(v) {   // the biggest sound in the game: a man comes out
      crowd(v, 0, 5.5, 0.8); crowd(v, 0.5, 4.5, 0.5);
      const lp = filt(v, 1900);
      for (const t of [0, 0.17, 0.34]) { brass(v, t, [55, 60, 64], 0.14, 0.2, lp); heavy(v, t, 98, 0.14, 0.35); }
      brass(v, 0.52, [48, 60, 64, 67, 72, 76], 2.6, 0.17, lp); heavy(v, 0.52, 65, 0.9, 0.8); hiss(v, 0.52, 6000, 1.8, 0.3, 'highpass');
      run(v, 0.62, [84, 88, 91, 96, 100], 0.09, 0.5, 0.16, 'triangle');
    },
    late(v) {   // and the other ending: a sad brass line, going down
      const lp = filt(v, 1000);
      [[58, 0, 0.42], [57, 0.45, 0.42], [56, 0.9, 0.42], [55, 1.35, 1.4]].forEach(([m, t, d], i) => {
        const a = tone(v, t, hz(m), d, 0.6, 'sawtooth', i === 3 ? hz(m) * 0.92 : 0, { into: lp, a: 0.05, hold: d * 0.5 });
        tone(v, t, hz(m - 12), d, 0.3, 'sawtooth', 0, { into: lp, a: 0.05, hold: d * 0.5 });
        if (i === 3) vib(v, a, t + 0.2, d, 5.5, 6);
      });
    },
    toll(v, o) { const n = o.secs > 80000 ? 1 : o.secs > 3000 ? 2 : 3; for (let i = 0; i < n; i++) bell(v, i * 0.9, 196); },   // one bell for a day left, two for an hour, three for ten minutes
    tick(v, o) { tone(v, 0, o.tock ? 900 : 1200, 0.035, 0.6, 'triangle'); hiss(v, 0, 2500, 0.02, 0.4, 'bandpass', 0, { q: 3 }); },
    dead(v) { run(v, 0, [67, 63, 60, 55], 0.14, 0.22, 0.45, 'triangle'); tone(v, 0.5, 196, 0.7, 0.35, 'sawtooth', 49, { into: filt(v, 700), a: 0.03 }); thud(v, 0, 90, 0.2, 0.7); },
    respawn(v) { run(v, 0, [60, 67, 72], 0.09, 0.2, 0.45, 'triangle'); hiss(v, 0, 2000, 0.4, 0.15, 'bandpass', 6000, { a: 0.1 }); },
    // people
    woo(v) {   // you, arms up
      for (const k of [1, 1.26, 0.84]) {
        const bp = filt(v, 600, 'bandpass', 3), t = rnd(0, 0.06);
        bp.frequency.setValueAtTime(600, v.t + t); bp.frequency.exponentialRampToValueAtTime(1150, v.t + t + 0.25);
        tone(v, t, vary(330 * k, 0.05), 0.5, 0.6, 'sawtooth', 620 * k, { into: bp, a: 0.05, hold: 0.25, bend: 0.5 });
      }
    },
    hey(v) { const bp = filt(v, 750, 'bandpass', 4), f = vary(300, 0.2); bp.frequency.setValueAtTime(750, v.t); bp.frequency.exponentialRampToValueAtTime(2100, v.t + 0.16); tone(v, 0, f, 0.2, 0.9, 'sawtooth', f * 0.8, { into: bp, a: 0.015, hold: 0.08 }); },
    mumble(v, o) {   // one of the two men has something to say: a few muffled syllables from inside the pile
      const f = vary(o.i ? 78 : 92, 0.06), n = Math.max(2, Math.min(5, Math.round((o.len || 20) / 9)));
      for (let i = 0, t = 0; i < n; i++) {
        const d = rnd(0.11, 0.2), k = rnd(0.9, 1.12), bp = filt(v, 360, 'bandpass', 3), t0 = v.t + t;
        bp.frequency.setValueAtTime(rnd(300, 420), t0); bp.frequency.linearRampToValueAtTime(rnd(520, 760), t0 + d * 0.4); bp.frequency.linearRampToValueAtTime(rnd(300, 420), t0 + d);
        tone(v, t, f * k, d, 0.8, 'sawtooth', f * k * rnd(0.92, 1.05), { into: bp, a: 0.03, hold: d * 0.5 });
        t += d + rnd(0.02, 0.07);
      }
    },
    far(v, o) { const k = o.tier || 0, f = vary(150 - k * 9, 0.1); tone(v, 0, f, 0.1 + k * 0.02, 0.8, 'sine', f * 0.55); hiss(v, 0, 1400 - k * 90, 0.07 + k * 0.02, 0.6, k < 4 ? 'bandpass' : 'lowpass'); },   // somebody else's bite
    blip(v) { run(v, 0, [76, 83], 0.08, 0.14, 0.5); },
    pop(v) { tone(v, 0, vary(700, 0.2), 0.05, 0.6, 'sine', 1300); },
    back(v) { run(v, 0, [72, 79], 0.1, 0.15, 0.4, 'triangle'); },
    ring(v) {   // an old telephone, then the receiver going down
      const am = chop(v, 1, 22, 1, 'square');
      for (const t of [0, 0.5]) { tone(v, t, 1397, 0.4, 0.35, 'sine', 0, { into: am, hold: 0.3 }); tone(v, t, 1760, 0.4, 0.3, 'sine', 0, { into: am, hold: 0.3 }); }
      hiss(v, 1.02, 2000, 0.02, 0.5, 'bandpass'); tone(v, 1.02, 180, 0.05, 0.5);
    },
    // the world
    honk(v, o) { const low = /bus|truck|van/.test(o.kind), f = vary(low ? 250 : 400, 0.05), d = low ? 0.5 : 0.28, lp = filt(v, 2400); for (const k of [1, 1.26]) tone(v, 0, f * k, d, 0.4, 'square', 0, { into: lp, a: 0.015, hold: d * 0.7 }); },
    bell(v) { for (const t of [0, 0.16]) { tone(v, t, 2350, 0.35, 0.5); tone(v, t, 6350, 0.15, 0.2); } },
    siren(v) { const lp = filt(v, 1800); for (const t of [0, 0.38]) tone(v, t, 620, 0.34, 0.5, 'square', 1350, { into: lp, a: 0.02, hold: 0.25 }); },
    pigeons(v) { for (let i = 0; i < 14; i++) hiss(v, i * 0.07 * rnd(0.7, 1.2), vary(1800, 0.3), 0.05, rnd(0.3, 0.8), 'bandpass', 0, { a: 0.015 }); },
    whoosh(v, o) {
      if (o.bike) { for (let i = 0; i < 7; i++) tone(v, i * 0.06, 2600, 0.012, 0.4, 'square'); return; }   // a freewheel ticking by
      hiss(v, 0, 450, 1, 0.8, 'bandpass', 1100, { a: 0.4 }); tone(v, 0, 96, 1, 0.25, 'sawtooth', 80, { into: filt(v, 400), a: 0.4 });
    },
    goose(v) { const bp = filt(v, 1100, 'bandpass', 5), f = vary(370, 0.1); tone(v, 0, f, 0.2, 0.8, 'sawtooth', f * 1.25, { into: bp, a: 0.02, hold: 0.1, bend: 0.3 }); },
    bird(v) {
      const f = rnd(2600, 4200), k = Math.floor(Math.random() * 3);
      if (k === 0) for (let i = 0; i < 3; i++) tone(v, i * 0.11, f, 0.07, 0.6, 'sine', f * 1.35, { a: 0.01 });
      else if (k === 1) for (let i = 0; i < 7; i++) tone(v, i * 0.045, f * 1.2, 0.035, 0.5, 'sine', f, { a: 0.008 });
      else { tone(v, 0, f, 0.22, 0.6, 'sine', f * 0.97, { a: 0.03, hold: 0.1 }); tone(v, 0.3, f * 0.8, 0.3, 0.6, 'sine', f * 0.78, { a: 0.03, hold: 0.15 }); }
    },
    splash(v) { hiss(v, 0, vary(1000, 0.2), 0.18, 0.7, 'bandpass', 3000, { a: 0.02 }); tone(v, 0.01, vary(280, 0.15), 0.08, 0.3, 'sine', 580); },   // wading in the pool
    // the screen itself
    click(v) { tone(v, 0, 1100, 0.03, 0.5, 'triangle', 700); hiss(v, 0, 3000, 0.015, 0.3, 'bandpass'); },
    slam(v) { hiss(v, 0, 400, 0.2, 0.7, 'bandpass', 2600, { a: 0.14, q: 1.2 }); thud(v, 0.2, 120, 0.14, 0.9); },
    shift(v) { for (const f of [780, 990]) tone(v, 0, f, 0.55, 0.4, 'sine', f * 1.03, { a: 0.04, hold: 0.35 }); hiss(v, 0, 3000, 0.55, 0.12, 'bandpass', 0, { a: 0.04, hold: 0.35 }); },   // the site whistle
  };

  // How loud and how far left or right a thing at this spot is, heard from the camera. A machine's camera hangs a long
  // way back, so its distance does not count.
  const hear = (x, y = 1, z, ref = 22) => {
    const c = game.camera, e = c.matrixWorldInverse.elements, d = Math.max(0, Math.hypot(x - c.position.x, y - c.position.y, z - c.position.z) - (game.player?.camDist || 6));
    return [1 / (1 + (d / ref) ** 2), Math.max(-0.8, Math.min(0.8, (e[0] * x + e[4] * y + e[8] * z + e[12]) / (10 + d)))];
  };
  const cut = (v, now) => { v.cut = true; v.out.gain.setTargetAtTime(0, now, 0.012); v.end = Math.min(v.end, now + 0.08); };

  // o: x, y, z (where it is: quieter with distance, panned by where it is on screen), ref (metres to half loudness),
  // vol (a multiplier), pan, and whatever the recipe reads (tier, kind...).
  function play(name, o = {}) {
    const make = S[name], mix = MIX[name];
    if (!make || (ac.state !== 'running' && !offline)) return;
    const now = ac.currentTime;
    if (now - (last[name] ?? -9) < mix[1]) return;   // 80 neighbours must not become a wall of noise
    let vol = mix[0] * (o.vol ?? 1), pan = o.pan || 0;
    if (o.x !== undefined) { const [k, p] = hear(o.x, o.y, o.z, o.ref); vol *= k; pan = p; }
    if (vol < 0.004) return;
    // room for it? finished voices leave; over the limit, the quietest (then the oldest) gives way, or this one does
    let live = 0, same = 0, weak = null, twin = null;
    for (let i = voices.length - 1; i >= 0; i--) {
      const v = voices[i];
      if (now > v.end) { v.tail.disconnect(); voices.splice(i, 1); continue; }
      if (v.cut) continue;
      live++; if (!weak || v.vol <= weak.vol) weak = v;
      if (v.name === name) { same++; if (!twin || v.vol <= twin.vol) twin = v; }
    }
    const loser = same >= mix[2] ? twin : live >= MAX ? weak : null;
    if (loser) { if (loser.vol > vol) return; cut(loser, now); }
    last[name] = now;
    const out = ac.createGain(), p = pan && ac.createStereoPanner ? ac.createStereoPanner() : null;
    out.gain.value = vol; if (p) { p.pan.value = pan; out.connect(p); }
    (p || out).connect(master);
    const v = { name, out, tail: p || out, vol, t: now + 0.01, end: now };
    make(v, o); voices.push(v);
  }

  // ---- sounds that keep going: the ambient bed, your engine, aircraft. Each is built once and then steered.
  const drone = (build) => {
    const out = ac.createGain(), pan = ac.createStereoPanner?.(), src = [];
    out.gain.value = 0; (pan ? out.connect(pan) : out).connect(master);
    const d = { out, src,
      set(vol, p = 0, tau = 0.25) { out.gain.setTargetAtTime(vol, ac.currentTime, tau); pan?.pan.setTargetAtTime(p, ac.currentTime, tau); },
      stop() { const t = ac.currentTime; out.gain.setTargetAtTime(0, t, 0.08); src[0].onended = () => (pan || out).disconnect(); for (const s of src) s.stop(t + 0.5); } };
    build(d);
    return d;
  };
  const dOsc = (d, type, f, into = d.out, vol = 1) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; g.gain.value = vol; o.connect(g).connect(into); o.start(); d.src.push(o); return o; };
  const dNoise = (d, type, f, q, into = d.out, vol = 1) => {
    const s = ac.createBufferSource(), flt = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = NOISE; s.loop = true; flt.type = type; flt.frequency.value = f; flt.Q.value = q; g.gain.value = vol;
    s.connect(flt).connect(g).connect(into); s.start(0, Math.random() * 1.9); d.src.push(s);
    return flt;
  };
  const dAm = (d, rate, depth, type = 'sine', into = d.out) => { const g = ac.createGain(); g.gain.value = 1 - depth / 2; g.rate = dOsc(d, type, rate, g.gain, depth / 2).frequency; g.connect(into); return g; };

  // Wind that gusts, a far-off city, and the murmur of everyone else who is digging: crowd(0..1) sets how much.
  const bed = () => drone((d) => {
    dOsc(d, 'sine', 0.07, dNoise(d, 'bandpass', 520, 0.6, dAm(d, 0.11, 0.6), 0.09).frequency, 220);   // high enough for a phone's speaker
    dNoise(d, 'lowpass', 130, 0.7, d.out, 0.1);
    const all = ac.createGain(), am = dAm(d, 1.7, 0.3, 'sine', dAm(d, 0.23, 0.5, 'sine', all));
    all.gain.value = 0; all.connect(d.out);
    dNoise(d, 'bandpass', 520, 1.1, am, 0.22); dNoise(d, 'bandpass', 1250, 1.5, am, 0.12);
    d.crowd = (k) => all.gain.setTargetAtTime(k, ac.currentTime, 2);
    d.set(1, 0, 1.5);
  });
  // rev(k, vol): k = 1 idling, more as it works
  const motor = (id) => drone((d) => {
    const [f, chug, dull, rattle] = ENGINES[id], lp = ac.createBiquadFilter(), am = dAm(d, chug, 0.7, 'sawtooth');
    lp.frequency.value = dull; lp.connect(am);
    const osc = [[1, 'sawtooth', 0.5], [1.5, 'square', 0.2], [2.02, 'sawtooth', 0.25]].map(([k, type, vol]) => { const o = dOsc(d, type, f * k, lp, vol); o.f0 = f * k; return o; });
    dNoise(d, 'bandpass', dull * 2.2, 0.8, am, rattle);
    if (id === 'bucket_wheel_excavator') {   // 71 metres of it: a deep rumble under everything, and the wheel creaking round
      dNoise(d, 'lowpass', 150, 0.7, d.out, 1.6);
      dOsc(d, 'sine', 0.23, dNoise(d, 'bandpass', 340, 9, d.out, 1.2).frequency, 120);
    }
    d.rev = (k, vol) => { const t = ac.currentTime; for (const o of osc) o.frequency.setTargetAtTime(o.f0 * k, t, 0.12); am.rate.setTargetAtTime(chug * k, t, 0.12); d.set(vol, 0, 0.15); };
  });
  const flyer = (kind) => drone((d) => {
    if (kind === 'airliner') { dNoise(d, 'lowpass', 260, 0.7); dNoise(d, 'bandpass', 1500, 2, d.out, 0.1); }
    else if (kind === 'helicopter') { const am = dAm(d, 11.5, 1, 'sawtooth'), lp = ac.createBiquadFilter(); lp.frequency.value = 300; lp.connect(am); dNoise(d, 'lowpass', 450, 0.8, am); dOsc(d, 'sawtooth', 68, lp, 0.4); }
    else { const am = dAm(d, 46, 0.8), lp = ac.createBiquadFilter(); lp.frequency.value = 700; lp.connect(am); dOsc(d, 'sawtooth', 92, lp, 0.5); dOsc(d, 'square', 138.5, lp, 0.25); }   // a small propeller plane
  });

  return { ac, play, hear, bed, motor, flyer,
    live() { const now = ac.currentTime; return voices.filter((v) => !v.cut && now <= v.end).length; },
    quiet() { for (const v of voices) v.tail.disconnect(); voices.length = 0; },   // every effect stops now; the context runs on (the song may be playing)
    hush() { this.quiet(); ac.suspend(); } };
}

// C major pentatonic from middle C: ten bites climb it, and after that a held dig plays a little round at the top.
const PENTA = [0, 2, 4, 7, 9], ROUND = [10, 8, 9, 7, 10, 9, 11, 8, 10, 12, 11, 9];
const streakNote = (n) => { const k = n < 10 ? n : ROUND[(n - 10) % ROUND.length]; return 60 + 12 * Math.floor(k / 5) + PENTA[k % 5]; };

export function init(game) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || new URLSearchParams(location.search).has('capture')) return { play() {}, muted: true, music: { on: false, playing: false, time: 0, level: 0, el: null } };
  // Two switches, each remembered: `muted` is the effects (everything the synthesiser makes: effects, the bed, engines),
  // `music` is the song. `was` is what key M brings back: 'ms', 'm' or 's'.
  let E = null, muted = false, music = true, was = 'ms', broken = false;
  try {
    muted = localStorage.getItem(KEY) === '1';
    const m = localStorage.getItem(KEY_MUSIC);
    music = m === null ? !muted : m === '1';   // new here: the song is on. Whoever had switched the sound off before there was a song keeps their silence
    was = localStorage.getItem(KEY_WAS) || 'ms';
  } catch (e) { /* private window */ }
  const play = (name, o) => { if (E && !muted) E.play(name, o); };
  const tune = { el: null, gain: null, due: Infinity, timer: 0, pos: 0, retry: 0, fails: 0, bad: false };   // the song: see below
  // Browsers only let sound start from a tap or a key press, and a phone can take it away again (a call, the lock
  // screen), so ask at every one. With both switches off, no context is ever made.
  const unlock = () => {
    if ((muted && !music) || broken || document.hidden) return;
    if (!E) {
      try { E = engine(new AC(), game); } catch (e) { broken = true; return; }
      try { navigator.audioSession.type = 'ambient'; } catch (e) { /* iOS only: play along with their own music, obey the silent switch */ }
    }
    if (E.ac.state !== 'running') E.ac.resume().catch(() => {});
    if (music && performance.now() >= tune.due && (!tune.el || tune.el.paused || tune.bad)) tuneSync();   // the song was refused, or lost: this press may start it
  };
  // for a sound asked for by the very tap that switches the sound on
  const soon = (name) => { unlock(); if (E && !muted) E.ac.resume().then(() => play(name)).catch(() => {}); };
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) addEventListener(type, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { tuneSync(); E?.ac.suspend(); } else if (E) { unlock(); tuneSync(); } });   // silent in a background tab

  // ---- the song. One <audio> element streams it (never the whole file decoded in memory), and nothing is fetched until
  // Start has been pressed with the music on. It goes through a gain of its own straight to the output, beside the
  // effects' compressor rather than through it, so a loud effect cannot duck it and it takes none of their headroom;
  // and the level is ours on every browser (an iPhone ignores element.volume). It starts MUSIC_START seconds after
  // Start, fades in, and when it ends comes round again after MUSIC_GAP seconds of quiet, for as long as the game is open.
  const tuneFade = (to, secs = 0) => {
    const g = tune.gain?.gain;
    if (!g) { if (tune.el) tune.el.volume = to; return; }   // not routed through the graph (see tuneEl): the element's own volume
    const t = E.ac.currentTime, from = g.value;
    g.cancelScheduledValues(t);
    if (secs) { g.setValueAtTime(from, t); g.linearRampToValueAtTime(to, t + secs); } else g.value = to;
  };
  const tuneEl = () => {
    if (tune.el || !E) return tune.el;
    const el = tune.el = new Audio();
    el.preload = 'none';
    try { tune.gain = E.ac.createGain(); tune.gain.gain.value = 0; E.ac.createMediaElementSource(el).connect(tune.gain).connect(E.ac.destination); }
    catch (e) { tune.gain = null; el.volume = 0; }
    // what the computer's own media keys and "now playing" box say and do: its pause is our music switch, not a pause we would undo at the next press
    try { const ms = navigator.mediaSession; ms.metadata = new MediaMetadata({ title: SONG_TITLE, artist: SONG_BY }); ms.setActionHandler('pause', () => apply(!muted, false)); ms.setActionHandler('play', () => apply(!muted, true)); } catch (e) { /* not on this browser */ }
    el.addEventListener('loadedmetadata', () => { if (tune.pos > 0) { try { el.currentTime = tune.pos; } catch (e) { /* from the top, then */ } } });   // picked up where it left off
    el.addEventListener('playing', () => { tune.fails = 0; tune.pos = 0; if (!el.paused) tuneFade(MUSIC_LEVEL, MUSIC_FADE); });
    el.addEventListener('ended', () => { tune.pos = 0; tune.due = performance.now() + MUSIC_GAP * 1000; tuneSync(); });
    // The file would not load, or the line dropped: say nothing, and try again at a later press (not at every one).
    el.addEventListener('error', () => { tune.bad = true; if (el.currentTime > 0) tune.pos = el.currentTime; tune.retry = performance.now() + Math.min(300, 8 * 2 ** tune.fails++) * 1000; });
    return el;
  };
  // The one place that decides whether the song should be sounding right now, and makes it so. Called whenever
  // anything it depends on changes: Start, a switch, the tab going away or coming back, the song ending, a press.
  function tuneSync() {
    clearTimeout(tune.timer);
    const el = tune.el, now = performance.now();
    if (!music || document.hidden) {
      if (el && !el.paused) { el.pause(); tuneFade(0); }   // a hidden tab: paused where it is (the context is suspended as well)
      if (!music && el?.hasAttribute('src')) { tune.pos = el.ended ? 0 : el.currentTime || tune.pos; el.removeAttribute('src'); el.load(); }   // switched off: stop fetching it too, and remember the place
      return;
    }
    if (now < tune.due) { if (tune.due < Infinity) tune.timer = setTimeout(tuneSync, tune.due - now + 30); return; }   // not yet: before Start, the first seconds, or the quiet between two plays
    if (now < tune.retry) return;
    const a = tuneEl();   // none while there is no context yet (nothing has been pressed): unlock comes back here
    if (!a || (!a.paused && !tune.bad)) return;
    if (tune.bad || !a.hasAttribute('src')) { tune.bad = false; a.src = address(SONG); } else if (a.ended) a.currentTime = 0;
    tuneFade(0);   // 'playing' brings it up
    if (E.ac.state !== 'running') E.ac.resume().catch(() => {});
    // refused (no tap yet, as when the page starts itself): the next press asks again, from unlock
    a.play()?.catch((e) => { if (e?.name === 'NotAllowedError') tune.retry = performance.now() + 300; });
  }
  // Start was pressed. Safari lets an element play later by itself only if a tap has played it once, so on that tap
  // it is played and paused at once; the real start comes MUSIC_START seconds on.
  const tuneStart = (tap) => {
    tune.due = performance.now() + MUSIC_START * 1000;
    const a = tap && music ? tuneEl() : null;
    if (a) { if (!a.hasAttribute('src')) a.src = address(SONG); a.play()?.catch(() => {}); a.pause(); }
    tuneSync();
  };

  // ---- the switches: the small SOUND tab under MENU (on an upright phone, above CHEER) opens a placard with one for
  // the music and one for the sounds; key M switches everything off, or back to what was on.
  const btn = document.createElement('button'), card = document.createElement('div');
  btn.id = 'sndbtn'; btn.textContent = 'SOUND'; btn.setAttribute('aria-label', 'sound: music and sound effects'); btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-controls', 'sndcard');
  card.id = 'sndcard'; card.hidden = true; card.setAttribute('role', 'group'); card.setAttribute('aria-label', 'sound');
  card.innerHTML = '<button role="switch" data-k="music" aria-label="music"><span>Music</span><i></i></button><button role="switch" data-k="sfx" aria-label="sound effects"><span>Sounds</span><i></i></button><small><b></b><span></span></small>';
  card.querySelector('small b').textContent = SONG_TITLE; card.querySelector('small span').textContent = 'by ' + SONG_BY;
  const sw = [...card.querySelectorAll('button')];
  const paint = () => {
    btn.classList.toggle('off', muted && !music);   // struck through only when there is nothing to hear at all
    sw[0].setAttribute('aria-checked', String(music)); sw[1].setAttribute('aria-checked', String(!muted));
  };
  const apply = (sfxOn, musicOn) => {
    const had = !muted;
    if (!sfxOn && !musicOn && (had || music)) was = (music ? 'm' : '') + (had ? 's' : '');
    muted = !sfxOn; music = !!musicOn; paint();
    try { localStorage.setItem(KEY, muted ? '1' : '0'); localStorage.setItem(KEY_MUSIC, music ? '1' : '0'); localStorage.setItem(KEY_WAS, was); } catch (e) { /* private window */ }
    if (had && muted) { stopDrones(); E?.quiet(); }
    if (!muted || music) unlock();
    tuneSync();
    if (muted && !music) E?.ac.suspend();   // nothing left to hear
    if (!had && !muted) soon('click');
  };
  const toggleAll = () => (muted && !music ? apply(was !== 'm', was !== 's') : apply(false, false));
  // Where the placard goes: under the tab if there is room, otherwise over it or beside it; never off the screen and
  // never under mann.cool's buttons (game.shellRects, when its shell is on the page).
  const place = () => {
    if (card.hidden) return;
    // (offsets, not getBoundingClientRect: a tab being pressed is drawn 2 px down and across)
    const box = (el) => (el?.offsetWidth ? { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight } : null);
    const b = box(btn);
    if (!b) return;
    // MENU and CHEER, where they are stacked with the tab, count as part of it: the placard goes clear of all three
    for (const id of ['menubtn', 'cheerbtn', 'menubtn']) {
      const r = box(document.getElementById(id));
      if (r && r.left < b.right && r.right > b.left && r.top < b.bottom + 14 && r.bottom > b.top - 14) { b.left = Math.min(b.left, r.left); b.top = Math.min(b.top, r.top); b.right = Math.max(b.right, r.right); b.bottom = Math.max(b.bottom, r.bottom); }
    }
    const w = card.offsetWidth, h = card.offsetHeight, cs = getComputedStyle(card), gap = 6, shadow = 4;
    const safe = (side) => Math.max(8, parseFloat(cs['scrollMargin' + side]) || 0);   // audio.css puts the safe-area insets there
    const x0 = safe('Left'), y0 = safe('Top'), x1 = innerWidth - safe('Right') - shadow - w, y1 = innerHeight - safe('Bottom') - shadow - h;
    const shell = game.shellRects?.() || [];
    let best = null;
    const flush = b.right - w - 2;   // right edges in line, shadows included (a tab's is 2 px, the placard's 4)
    const under = [[b.left, b.bottom + gap], [flush, b.bottom + gap]], over = [[b.left, b.top - gap - h], [flush, b.top - gap - h]];
    const first = b.top + b.bottom < innerHeight ? [...under, ...over] : [...over, ...under];   // away from the nearer edge (down there the map is underneath)
    for (const [x, y] of [...first, [b.right + gap, b.top], [b.left - gap - w, b.top], [b.right + gap, b.bottom - h], [b.left - gap - w, b.bottom - h]]) {
      const cx = Math.max(x0, Math.min(x1, x)), cy = Math.max(y0, Math.min(y1, y));
      let bad = Math.abs(cx - x) + Math.abs(cy - y);   // how far it had to be pushed to fit
      if (cx < b.right && cx + w > b.left && cy < b.bottom && cy + h > b.top) bad += 1000;   // pushed onto the tab itself
      for (const r of shell) if (cx < r.right && cx + w + shadow > r.left && cy < r.bottom && cy + h + shadow > r.top) bad += 10000;
      if (!best || bad < best.bad) best = { x: cx, y: cy, bad };
    }
    card.style.left = Math.round(best.x) + 'px'; card.style.top = Math.round(best.y) + 'px';
  };
  const open = (byKey) => {
    card.hidden = false; btn.setAttribute('aria-expanded', 'true');
    document.exitPointerLock?.(); game.clearInput?.();   // as the game's own MENU does: the mouse comes free and nothing stays held down
    place();
    if (byKey) sw[0].focus();
  };
  const close = () => {
    if (card.hidden) return;
    if (card.contains(document.activeElement) || document.activeElement === btn) document.activeElement.blur();   // or Space, held to dig, would press it
    card.hidden = true; btn.setAttribute('aria-expanded', 'false');
  };
  paint(); btn.setAttribute('aria-expanded', 'false');
  // not a click: phones send none while the other thumb is still down on the stick. (A click with no press behind it is the keyboard.)
  const press = (el, fn) => {
    el.addEventListener('pointerdown', (e) => { if (e.button) return; e.preventDefault(); fn(false); });
    el.addEventListener('click', (e) => { if (e.detail === 0) fn(true); else el.blur(); });
  };
  press(btn, (byKey) => (card.hidden ? open(byKey) : close()));
  press(sw[0], () => apply(!muted, !music));
  press(sw[1], () => apply(muted, music));
  card.addEventListener('mousedown', (e) => e.stopPropagation());   // a right-button press here is not the start of a look around
  card.addEventListener('contextmenu', (e) => e.preventDefault());
  document.getElementById('hud').append(btn, card);
  addEventListener('pointerdown', (e) => { if (!card.hidden) { if (e.target !== btn && !card.contains(e.target)) close(); else requestAnimationFrame(place); } }, true);   // a press anywhere else puts it away
  addEventListener('resize', place);
  addEventListener('keydown', (e) => {
    if (card.hidden) return;
    if (e.code === 'Escape') { e.stopPropagation(); close(); return; }
    // on a switch, these keys work the switch and do not reach the game (Space would dig); every other key does what it does while MENU is open
    const i = sw.indexOf(document.activeElement), arrow = e.code === 'ArrowDown' || e.code === 'ArrowUp';
    if (i < 0 || !(arrow || e.code === 'Space' || e.code === 'Enter')) return;
    e.stopPropagation();
    if (arrow) { e.preventDefault(); sw[1 - i].focus(); }
  }, true);
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !game.typing?.()) toggleAll(); });
  // every button on the placards clicks (DIG is not a button in that sense)
  document.addEventListener('pointerdown', (e) => { const b = e.target.closest?.('button'); if (b && b.id !== 'digbtn' && !b.disabled) soon('click'); }, true);

  // ---- what happens in the game
  const on = game.bus.on, at = (p, more) => ({ x: p.x, y: p.y + 1, z: p.z, ...more });
  let bit = null, upTier = 0, run = 0, digT = -9, blipT = -9, grace = 2.6, farT = 0;
  const thumped = new Map();   // mound -> when you last heard yourself hit it
  on('start', () => { soon('shift'); tuneStart(true); });
  on('over', close);
  on('bite', (e) => { bit = e; });   // what it hit is known by the end of the frame: see update
  on('dig', (e) => {
    bit = null; play(e.tool.id);
    digT = game.time; grace = Math.max(2.6, e.tool.period * 1.6);
    if (game.time - blipT > 0.7) { blipT = game.time; play('streak', { note: streakNote(Math.floor(run)) }); run++; }   // a rising note for as long as you keep at it
  });
  on('denied', () => { bit = null; play('denied'); });
  on('toolUp', (e) => { if (!e.quiet) upTier = Math.max(upTier, e.tier); });   // several at once: one fanfare, for the best of them (see update)
  on('hurt', (e) => play(e.effect));
  on('dead', () => play('dead'));
  on('respawn', () => play('respawn'));
  on('cheer', (e) => (e.self ? play('woo') : play('hey', e)));
  on('remoteCheer', (e) => play('hey', at(e.remote.pos)));
  on('shot', (e) => play('shot', e));
  on('whack', (e) => play('bonk', e));
  on('splat', (e) => play('splat', e));
  on('agentSpawn', (e) => play('lobbyist', at(e.agent.pos, { ref: 60 })));
  on('agentDown', (e) => play('paper', e));
  on('moundOpen', (e) => { if (!e.quiet) play('klaxon'); });
  on('moundHit', (e) => { bit = null; if (game.time - (thumped.get(e.mound) ?? -9) > 1.6) play('thump', { x: e.mound.x, y: 3, z: e.mound.z }); });   // the server's echo of your own hit stays silent
  on('moundDown', (e) => { bit = null; if (!e.quiet) play('moundDown', { x: e.mound.x, y: 3, z: e.mound.z, ref: 120 }); });
  on('milestone', () => play('milestone'));
  on('giant', (e) => { if (e.status !== 'buried') play(e.status === 'dug' ? 'out' : 'late'); });
  on('clock', (e) => play('toll', e));
  on('toast', (e) => { if (e.pri >= 3) play('slam'); });
  on('online', (e) => { if (e.back) play('back'); });
  on('join', () => play('pop'));
  on('remoteDig', (e) => {   // the nearest few (those drawn with a body), a few a second, never on a beat
    if (game.time < farT || !(e.near || Math.random() < 0.3)) return;
    farT = game.time + rnd(0.1, 0.35); play('far', e);
  });
  on('remoteDown', (e) => play('dead', at(e.remote.pos, { vol: 0.5 })));
  on('remoteTool', (e) => play('blip', at(e.remote.pos)));
  on('giantSay', (e) => play('mumble', { x: e.giant.x, y: 30, z: e.giant.z, ref: 70, i: e.i, len: e.text?.length }));   // from the giants add-on, when it is there
  on('called', () => play('ring'));
  on('honk', (e) => play('honk', e));
  on('ding', (e) => play('bell', e));   // a bicycle, or anything else that rings
  on('pigeons', (e) => play('pigeons', e));

  let bedOn = null, crowd = -1, eng = null, engId = '', acc = 0, stepT = 0, foot = false, birdT = 3, gooseT = 0;
  const air = new Map(), passing = new WeakSet(), ticked = [];   // air: aircraft -> its drone, while it is in earshot
  // the sounds were switched off: the bed, your engine and the aircraft go too (update builds them again when they come back)
  const stopDrones = () => { eng?.stop(); eng = null; engId = ''; bedOn?.stop(); bedOn = null; crowd = -1; for (const d of air.values()) d.stop(); air.clear(); };
  // what is underfoot: a pile is dirt, the terrace and steps are stone; streets, walks and the pool are only there once the ground scenery is
  const ground = (x, z) => {
    for (const f of game.fields) if (f.inside(x, z) && f.heightAt(x, z) - f.floorAt(x, z) > 0.05) return 'dirt';
    const laid = !!game.sceneryMods.ground;
    return laid && inPool(x, z) ? 'water' : game.surface(x, z) > 0.4 || (laid && (roadAt(x, z) || walkAt(x, z))) ? 'stone' : 'grass';
  };
  function update(dt) {
    const b = bit, up = upTier, p = game.player;
    bit = null; upTier = 0;
    if (!E || muted || E.ac.state !== 'running') return;
    if (up) play('toolUp', { tier: up });
    // A bite that found no dirt: it hit a nest (say so at once; the server's count comes later), or a lobbyist, or the lawn.
    if (b && !(game.net.everOnline && !game.net.online)) {
      const m = game.lobby.mounds.find((o) => o.hp > 0 && Math.hypot(o.x - b.x, o.z - b.z) <= Math.max(b.tool.r, 2.6) + 4.5);
      if (m) { thumped.set(m, game.time); play('thump'); }
      else if (game.lobby.agents.some((a) => a.hp <= 0 && a.fly > 0.74 - dt)) play('bonk', { down: true });   // sent flying this very frame
      else play('thunk', { tier: b.tier });
    }
    if (game.time - digT > grace) run = Math.max(0, run - dt * 3);   // stop, and the streak slides back down
    const active = game.started && (!game.over || game.looking) && p.dead <= 0;   // after the end you may still walk the grounds
    if (active && !p.inVehicle && p.moving) {
      if ((stepT -= dt * Math.max(0.5, p.vel.length() / 6)) <= 0) { const kind = ground(p.pos.x, p.pos.z); stepT = 0.31; foot = !foot; play(kind === 'water' ? 'splash' : 'step', { kind, foot }); }
    } else stepT = 0.1;
    // the last minute of a clock ticks
    for (let i = 0, now = Date.now(); i < game.deadlines.length; i++) {
      const s = Math.ceil((game.deadlines[i] - now) / 1000);
      if (s > 0 && s <= 60 && s !== ticked[i] && game.status(i) === 'buried' && !game.supercharged(i)) { ticked[i] = s; play('tick', { tock: s % 2, vol: s <= 10 ? 1.6 : 1 }); }
    }
    if ((acc += dt) < 0.1) return;
    acc = 0;
    // the machine under you: pitch and loudness follow how hard it is working
    const id = active && p.inVehicle ? p.toolCfg.id : '';
    if (id !== engId) { eng?.stop(); eng = id ? E.motor(id) : null; engId = id; }
    if (eng) { const k = Math.max(Math.min(1, p.vel.length() / p.toolCfg.speed), p.digging ? 0.6 : 0); eng.rev(1 + 0.5 * k, ENGINES[id][4] * (0.45 + 0.55 * k)); }
    // the bed, and the murmur of the crowd: more people online, more murmur
    bedOn ||= E.bed();
    const c = game.net.online ? Math.min(1, Math.log10(1 + game.net.count) / 3.3) : 0;
    if (c !== crowd) bedOn.crowd(crowd = c);
    if ((birdT -= 0.1) <= 0) { birdT = rnd(3, 11); play('bird', { pan: rnd(-0.7, 0.7), vol: rnd(0.5, 1) }); }
    for (const f of game.sceneryMods.sky?.flyers || []) {
      const spec = FLYERS[f.kind];
      if (!spec) continue;
      const h = f.active ? E.hear(f.pos.x, f.pos.y, f.pos.z, spec[0]) : null, k = h ? h[0] : 0, pan = h ? h[1] : 0;
      let d = air.get(f);
      if (f.kind === 'geese') { if (k > 0.02 && (gooseT -= 0.1) <= 0) { gooseT = rnd(0.35, 1.3); play('goose', { vol: k, pan }); } }
      else if (k * spec[1] > 0.004) { if (!d) air.set(f, d = E.flyer(f.kind)); d.set(k * spec[1], pan, 0.4); }
      else if (d) { d.stop(); air.delete(f); }
    }
    for (const v of game.sceneryMods.traffic?.vehicles || []) {
      if (!v.active) continue;
      const d = Math.hypot(v.x - p.pos.x, v.z - p.pos.z);
      if (d > 40) passing.delete(v);
      else if (d < 26 && v.speed > 4 && !passing.has(v)) { passing.add(v); play('whoosh', { x: v.x, y: 1, z: v.z, bike: v.bike, vol: Math.min(1, v.speed / 11) }); }
      if (v.flash && d < 150) play('siren', { x: v.x, y: 1.5, z: v.z, ref: 60 });
    }
  }
  if (game.started) tuneStart(false);   // loaded after Start was pressed
  // what other add-ons get as game.plugins.audio: play(name, opts) with any name in MIX; muted (the effects are off);
  // music (the song: on, playing, and for tests time, level, el); voices (how many effects are sounding, for tests)
  const songApi = { title: SONG_TITLE, by: SONG_BY, get on() { return music; }, set on(v) { apply(!muted, !!v); },
    get playing() { const a = tune.el; return !!a && !a.paused && !a.ended && a.readyState > 2; }, get time() { return tune.el?.currentTime || tune.pos; },
    get level() { return tune.gain ? tune.gain.gain.value : tune.el?.volume || 0; }, get el() { return tune.el; } };
  return { play, update, get muted() { return muted; }, set muted(m) { apply(!m, music); }, get music() { return songApi; }, get voices() { return E ? E.live() : 0; } };
}
