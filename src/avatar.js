import * as THREE from 'three';
import { CFG } from './config.js';
import { ps1ify, canvasTex, crisp, FONT } from './ps1.js';
import { person, model, attach } from './assets.js';

const MEASURE = document.createElement('canvas').getContext('2d');
const ARMS = ['L_UpperArm', 'R_UpperArm'], UP_Z = new THREE.Vector3(0, 0, 1);
// Paint jobs (CFG.paints) go on these parts of the Bucket-Wheel: the body and its booms, not the tracks or the wheel.
const PAINTED = new Set(['Upper', 'CounterBoom', 'DischargeBoom', 'WheelBoom']);
// A grey copy of a texture, so a paint colour multiplied over it keeps the panel lines and grime. One per texture.
const GREY = new Map();
function greyOf(tex) {
  if (!tex?.image) return null;
  if (GREY.has(tex)) return GREY.get(tex);
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const l = Math.min(255, (0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]) * 1.4); a[i] = a[i + 1] = a[i + 2] = l; }
  g.putImageData(d, 0, 0);
  const t = crisp(new THREE.CanvasTexture(c));
  t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  GREY.set(tex, t);
  return t;
}
const WHEEL = { ring: new THREE.TorusGeometry(0.19, 0.02, 4, 10), bar: new THREE.BoxGeometry(0.38, 0.03, 0.03), mat: ps1ify(new THREE.MeshLambertMaterial({ color: 0x2b2b2b })) };

// What a player looks like: a body, whatever tool or vehicle their tier gives them, and a name tag.
// Used for you and for everyone else in your room.
export class Avatar {
  constructor(scene) {
    this.scene = scene;
    this.body = null; this.tool = null; this.vehicle = null; this.tag = null;
    this.tier = -1; this.char = null; this.charLoad = 0; this.toolLoad = 0; this.visible = true; this.cheerT = 0; this.tagW = 2.28; this.tagH = 0.285;
    this.paint = 0; this.painted = null; this.hue = Math.random();   // stars earned past the top machine (CFG.paints), and the parts wearing them
  }

  async setChar(name) {
    const ticket = ++this.charLoad;
    const p = await person(name) || await person('Male_Adult_01');
    if (!p || ticket !== this.charLoad || this.gone) return;   // a later pick won, or we were removed meanwhile
    this.dropBody();
    this.body = p; this.char = name;
    p.root.visible = this.visible;
    this.scene.add(p.root);
    const t = this.tier; this.tier = -1;
    if (t >= 0) this.setTier(t);
  }

  // Swap the thing in the hands (or under the seat) when the tier changes.
  async setTier(idx) {
    if (idx === this.tier) return;
    this.tier = idx;
    if (!this.body) return;
    const cfg = CFG.tools[idx], ticket = ++this.toolLoad;
    const m = await model(`/models/tools/${cfg.id}.glb`);
    if (ticket !== this.toolLoad || !this.body || this.gone) return;
    this.dropTool();
    const bone = this.body.bone('Tool');
    if (cfg.kind === 'hand') {
      if (m && bone) { this.tool = m.root; attach(bone, m.root); }
    } else {
      const wheel = new THREE.Group();
      const ring = new THREE.Mesh(WHEEL.ring, WHEEL.mat); ring.rotation.x = Math.PI / 2;
      wheel.add(ring, new THREE.Mesh(WHEEL.bar, WHEEL.mat));
      if (bone) { this.tool = wheel; attach(bone, wheel); }
      if (m) {
        const mixer = new THREE.AnimationMixer(m.root), clip = m.clips.find((c) => c.name === 'dig');
        this.vehicle = { root: m.root, mixer, clip, action: clip ? mixer.clipAction(clip) : null, seat: m.root.getObjectByName('Seat') };
        if (this.vehicle.action) { this.vehicle.action.play(); this.vehicle.action.paused = true; }
        this.applyPaint();
        m.root.visible = this.visible;
        this.scene.add(m.root);
      }
    }
  }

  // The name tag: the name, and under it in gold the rank (see rankFor), if given.
  setName(text, rank) {
    if (text === this.tagText && rank === this.tagRank && (this.tag || !text)) return;
    this.tagText = text; this.tagRank = rank;
    if (this.tag) { this.scene.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); this.tag = null; }
    if (!text) return;
    // as wide as the name (or rank) needs, so neither is cropped
    MEASURE.font = `16px ${FONT.px}`;
    let tw = Math.ceil(MEASURE.measureText(text).width) + 12;
    if (rank) { MEASURE.font = `11px ${FONT.px}`; tw = Math.max(tw, Math.ceil(MEASURE.measureText(rank).width) + 12); }
    const th = rank ? 38 : 24;
    const tex = canvasTex(tw, th, (g, w, h) => {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#000a'; g.fillRect(0, 0, w, h);
      g.font = `16px ${FONT.px}`; g.fillStyle = '#fff'; g.fillText(text, w / 2, 13);
      if (rank) { g.font = `11px ${FONT.px}`; g.fillStyle = '#ffc21a'; g.fillText(rank, w / 2, 29); }
    });
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    this.tagW = 0.285 * tw / 24; this.tagH = 0.285 * th / 24;
    this.tag.scale.set(this.tagW, this.tagH, 1);
    this.tag.visible = this.visible;
    this.scene.add(this.tag);
  }

  setVisible(v) {
    this.visible = v;
    if (this.body) this.body.root.visible = v;
    if (this.vehicle) this.vehicle.root.visible = v;
    if (this.tag) this.tag.visible = v;
  }

  // Throw your arms up for a moment (a new tool, a mound going down). Drivers keep their hands on the wheel.
  cheer(secs = 1.6) { this.cheerT = secs; }

  // Pose for this frame. s = { pos, yaw, moving, digging, speed, clip?, period?, far? } (clip and period override the tool's own, for
  // swatting; far = metres from the camera, which grows the name tag so it stays readable and hides it when hopeless).
  update(dt, s) {
    const b = this.body;
    if (this.tag) {
      const k = Math.min(1.8, Math.max(1, (s.far || 0) / 7));   // a little bigger with distance, but a crowd's worth of big tags is a wall of text
      this.tag.position.set(s.pos.x, s.pos.y + 2.1 + (k - 1) * 0.3 + (this.tagH - 0.285) / 2, s.pos.z); this.tag.scale.set(this.tagW * k, this.tagH * k, 1);
      this.tag.visible = this.visible && (s.far || 0) < 30;
    }
    if (!b || this.tier < 0) return;
    const cfg = CFG.tools[this.tier], veh = cfg.kind === 'vehicle';
    if (this.cheerT > 0) this.cheerT -= dt;
    if (veh) b.play('drive');
    else if (this.cheerT > 0 && !s.clip && b.actions.cheer) b.play('cheer', { speed: 1.4 });
    else if (s.clip && b.actions[s.clip]) { const a = b.play(s.clip, { speed: b.actions[s.clip].getClip().duration / s.period, fade: 0.05 }); if (s.restart && a) a.time = 0; }
    else if (s.digging || (cfg.clip === 'push' && s.moving)) {
      const a = b.actions[cfg.clip];
      if (s.restart && a) a.time = 0;   // swatting and digging can share a clip: start the swing over so the bite lands on time
      b.play(cfg.clip, { speed: a && cfg.clip !== 'push' ? a.getClip().duration / cfg.period : 1.4 });
    } else if (s.moving) b.play(cfg.clip === 'push' ? 'push' : 'run', { speed: Math.max(0.6, s.speed / 4.2) });
    else b.play('idle');
    b.mixer.update(dt);
    // cheering: the library clip is only a clap, which nobody can see at this size, so both arms go up and pump on top of it
    if (this.cheerT > 0 && !veh && !s.clip) { const a = Math.min(1, this.cheerT * 4) * (1.45 + Math.sin(this.cheerT * 13) * 0.28); for (const n of ARMS) b.bone(n)?.rotateOnAxis(UP_Z, n === ARMS[0] ? a : -a); }

    const v = this.vehicle;
    // the last paint job: every part its own colour, all of them slowly going round the rainbow
    if (this.painted && CFG.paints[this.paint - 1]?.rainbow) { this.hue = (this.hue + dt * 0.12) % 1; this.painted.forEach(([o], i) => o.material.color.setHSL((this.hue + i * 0.22) % 1, 0.85, 0.55)); }
    if (veh && v) {
      v.root.position.copy(s.pos); v.root.rotation.y = s.yaw;
      if (v.action) {
        v.action.paused = !s.digging;
        v.action.timeScale = cfg.loopClip ? 1 : v.clip.duration / cfg.period;
        if (!s.digging && !cfg.loopClip) v.action.time = 0;
        v.mixer.update(dt);
      }
      v.root.updateMatrixWorld(true);
      if (v.seat) { v.seat.getWorldPosition(b.root.position); v.seat.getWorldQuaternion(b.root.quaternion); }
      else { b.root.position.copy(s.pos); b.root.rotation.set(0, s.yaw, 0); }
    } else { b.root.position.copy(s.pos); b.root.rotation.set(0, s.yaw, 0); }
    if (this.tag && veh) { this.tag.position.x = b.root.position.x; this.tag.position.y += b.root.position.y - s.pos.y; this.tag.position.z = b.root.position.z; }   // over the driver's seat
  }

  // Stars past the top machine: the Bucket-Wheel wears the paint job of the last one earned (CFG.paints).
  setPaint(n) { n = Math.max(0, Math.min(CFG.paints.length, n | 0)); if (n !== this.paint) { this.paint = n; this.applyPaint(); } }
  applyPaint() {
    const v = this.vehicle;
    if (this.painted) for (const [o, base] of this.painted) { o.material.dispose(); o.material = base; }
    this.painted = null;
    if (!v || !this.paint || CFG.tools[this.tier]?.id !== 'bucket_wheel_excavator') return;
    const job = CFG.paints[this.paint - 1];
    this.painted = [];
    v.root.traverse((o) => {
      if (!o.isMesh || !PAINTED.has(o.name)) return;
      const base = o.material, m = ps1ify(base.clone());
      m.map = greyOf(base.map) || base.map;
      if (!job.rainbow) m.color.set(job.color);
      o.material = m;
      this.painted.push([o, base]);
    });
  }

  dropTool() {
    if (this.painted) { for (const [o, base] of this.painted) { o.material.dispose(); o.material = base; } this.painted = null; }
    if (this.tool) this.tool.removeFromParent();
    if (this.vehicle) { this.vehicle.mixer.stopAllAction(); this.scene.remove(this.vehicle.root); }
    this.tool = this.vehicle = null;
  }
  dropBody() {
    this.dropTool();
    if (this.body) { this.body.mixer.stopAllAction(); this.body.root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); this.scene.remove(this.body.root); }
    this.body = null;
  }
  dispose() { this.gone = true; this.dropBody(); this.setName(null); }
}
