import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { retro } from './ps1.js';
import { at } from './base.js';

const loader = new GLTFLoader();
const cache = new Map();

// Load once, share. Resolves to null when the file is missing so callers can fall back.
// At most three files download at once, in the order they were asked for, so the first people you need appear in
// a second or two instead of everyone arriving together at the end.
let busy = 0;
const waiting = [];
const gate = (job) => new Promise((done) => {
  const run = () => { busy++; job().then(done, () => done(null)).finally(() => { busy--; waiting.shift()?.(); }); };
  if (busy < 3) run(); else waiting.push(run);
});
export function load(url, opts) {
  if (!cache.has(url)) cache.set(url, gate(() => Promise.race([loader.loadAsync(at(url)), new Promise((_, no) => setTimeout(no, 25000))]).then((g) => { retro(g.scene, opts); return g; })));   // a download that stalls gives way to the stand-in after 25 s
  return cache.get(url);
}

export async function person(name) {
  const g = await load(`/models/${name}.glb`, { alpha: true });
  if (!g) return null;
  const root = SkeletonUtils.clone(g.scene);
  const mixer = new THREE.AnimationMixer(root);
  // an action is made the first time its clip is asked for: most bodies only ever use two or three of the nine
  const clips = Object.fromEntries(g.animations.map((c) => [c.name, c]));
  // idle and cheer are stored as their first few seconds only and played back and forth, which has no seam
  const make = (n) => { const a = mixer.clipAction(clips[n]); if (n === 'idle' || n === 'cheer') a.setLoop(THREE.LoopPingPong, Infinity); return a; };
  const actions = new Proxy({}, { get: (t, n) => (t[n] ||= clips[n] ? make(n) : undefined) });
  let cur = null;
  const play = (n, { speed = 1, fade = 0.15 } = {}) => {
    const a = actions[n]; if (!a) return null;
    a.timeScale = speed;
    if (cur === a) return a;
    if (cur) cur.fadeOut(fade);
    a.reset().fadeIn(fade).play(); cur = a;
    return a;
  };
  return { root, mixer, actions, play, bone: (n) => root.getObjectByName(n), get current() { return cur; } };
}

export async function model(path) {
  const g = await load(path);
  if (!g) return null;
  const root = SkeletonUtils.clone(g.scene);
  return { root, clips: g.animations };
}

// Parent a prop to a bone of a character whose skeleton is scaled (the Rocketbox rigs are 0.01).
export function attach(bone, prop) {
  bone.updateWorldMatrix(true, false);
  const s = new THREE.Vector3();
  bone.getWorldScale(s);
  prop.scale.setScalar(1 / s.x);
  bone.add(prop);
}
