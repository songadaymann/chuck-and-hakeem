import * as THREE from 'three';
import { CFG } from './config.js';
import { ps1ify, canvasTex, FONT } from './ps1.js';
import { person, model, attach } from './assets.js';

const MEASURE = document.createElement('canvas').getContext('2d');
const ARMS = ['L_UpperArm', 'R_UpperArm'], UP_Z = new THREE.Vector3(0, 0, 1);
const WHEEL = { ring: new THREE.TorusGeometry(0.19, 0.02, 4, 10), bar: new THREE.BoxGeometry(0.38, 0.03, 0.03), mat: ps1ify(new THREE.MeshLambertMaterial({ color: 0x2b2b2b })) };

// What a player looks like: a body, whatever tool or vehicle their tier gives them, and a name tag.
// Used for you and for everyone else in your room.
export class Avatar {
  constructor(scene) {
    this.scene = scene;
    this.body = null; this.tool = null; this.vehicle = null; this.tag = null;
    this.tier = -1; this.char = null; this.charLoad = 0; this.toolLoad = 0; this.visible = true; this.cheerT = 0; this.tagW = 2.28;
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
        m.root.visible = this.visible;
        this.scene.add(m.root);
      }
    }
  }

  setName(text) {
    if (this.tag) { this.scene.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); this.tag = null; }
    if (!text) return;
    // as wide as the name needs, so long names are not cropped
    MEASURE.font = `16px ${FONT.px}`;
    const tw = Math.ceil(MEASURE.measureText(text).width) + 12;
    const tex = canvasTex(tw, 24, (g, w, h) => {
      g.font = `16px ${FONT.px}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#000a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.fillText(text, w / 2, h / 2 + 1);
    });
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    this.tagW = 0.285 * tw / 24;
    this.tag.scale.set(this.tagW, 0.285, 1);
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
      this.tag.position.set(s.pos.x, s.pos.y + 2.1 + (k - 1) * 0.3, s.pos.z); this.tag.scale.set(this.tagW * k, 0.285 * k, 1);
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

  dropTool() {
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
