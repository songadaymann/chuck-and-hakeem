import * as THREE from 'three';
import { CFG } from './config.js';
import { ps1ify, noiseTex } from './ps1.js';
import { DirtGrid } from '../shared/grid.js';

const D = CFG.dirt, F = CFG.feel;
let dirtTex = null;

// The browser's view of a pile: the shared grid plus the mesh you see and walk on.
export class DirtField extends DirtGrid {
  constructor(giant, seed) {
    super(giant, seed);
    const n = this.n;
    const geo = new THREE.PlaneGeometry(D.size, D.size, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(giant.x, 0, giant.z);
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 16, uv.getY(k) * 16);
    dirtTex ||= noiseTex([112, 84, 54], 0.35, 1, 9);
    dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
    // dent: how far each cell is scooped out for show (see CFG.feel); freshly dug dirt is drawn darker
    this.dent = new Float32Array(n * n); this.dented = false; this.rest = 0; this.slumpT = 0;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3).fill(1), 3));
    this.mesh = new THREE.Mesh(geo, ps1ify(new THREE.MeshLambertMaterial({ map: dirtTex, vertexColors: true })));
    this.mesh.frustumCulled = false;
    this.stale = false;
    this.refresh();
  }

  dig(x, z, r, depth) {
    const removed = super.dig(x, z, r, depth);
    if (removed > 0) this.stale = true;
    return removed;
  }

  top(k) { const t = this.h[k] - this.floor[k]; return Math.max(this.floor[k] + Math.min(t, 0.1), this.h[k] - this.dent[k]); }

  // A hole for show: the part of a bite the shared pile did not take. It never reaches the floor and never counts.
  scuff(x, z, r, depth) {
    const n = this.n, c = this.cell;
    const i0 = Math.max(1, Math.floor((x - r - this.x0) / c)), i1 = Math.min(n - 2, Math.ceil((x + r - this.x0) / c));
    const j0 = Math.max(1, Math.floor((z - r - this.z0) / c)), j1 = Math.min(n - 2, Math.ceil((z + r - this.z0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(this.x0 + i * c - x, this.z0 + j * c - z);
      if (d >= r) continue;
      const k = j * n + i, most = Math.min(F.dentMax, this.h[k] - this.floor[k] - 0.15);
      if (most > this.dent[k]) { this.dent[k] = Math.min(most, this.dent[k] + depth * (1 - (d / r) ** 2)); this.dented = this.stale = true; }
    }
    this.rest = 0;
  }
  // The dents slump back once nobody has dug here for a moment.
  slump(dt) {
    if (!this.dented || (this.rest += dt) < F.slumpAfter || (this.slumpT += dt) < 0.05) return;
    const k = Math.exp(-this.slumpT / F.slump * 4.6), drop = this.slumpT * 0.02; let any = false;   // 4.6 = ln(100): 1% left after `slump` seconds
    this.slumpT = 0;
    for (let i = 0; i < this.dent.length; i++) if (this.dent[i] > 0) { const v = this.dent[i] * k - drop; this.dent[i] = v > 0 ? v : 0; any ||= v > 0; }
    this.dented = any; this.stale = true;
  }

  // Server data: a full snapshot or a list of changed cells. Lower value wins, so our own fresh digs are never undone.
  applyCells(pairs) {
    if (this.grow) { const to = this.grow.to; for (let i = 0; i < pairs.length; i += 2) to[pairs[i]] = Math.min(to[pairs[i]], this.floor[pairs[i]] + pairs[i + 1] / 100); return; }   // mid-swell: aim lower instead
    let changed = false;
    for (let i = 0; i < pairs.length; i += 2) if (this.mergeCm(pairs[i], pairs[i + 1])) changed = true;
    if (changed) { this.recount(); this.stale = true; }
  }
  applySnapshot(cm) {
    let changed = false;
    for (let k = 0; k < cm.length && k < this.h.length; k++) if (this.mergeCm(k, cm[k])) changed = true;
    if (changed) { this.recount(); this.stale = true; }
  }

  reset() { this.grow = null; this.resetHeights(); this.dent.fill(0); this.dented = false; this.stale = true; }

  // A dirt bomb landed: the server's whole pile replaces ours (it is higher now, so it cannot be merged). It swells up
  // over `secs` rather than popping, with a wobble on the way, like a soufflé that has been lobbied.
  regrow(cm, secs = 2.6) {
    const to = new Float64Array(this.h.length);
    for (let k = 0; k < to.length; k++) to[k] = this.floor[k] + (k < cm.length ? cm[k] : 0) / 100;
    this.grow = { from: Float64Array.from(this.h), to, t: 0, secs };
    this.dent.fill(0); this.dented = false;
  }
  growStep(dt) {
    const gr = this.grow;
    if (!gr) return;
    const x = Math.min(1, (gr.t += dt) / gr.secs), u = 1 - (1 - x) ** 3 + 0.14 * Math.sin(x * Math.PI * 3) * (1 - x);
    for (let k = 0; k < this.h.length; k++) this.h[k] = Math.min(this.h0[k], Math.max(this.floor[k], gr.from[k] + (gr.to[k] - gr.from[k]) * u));   // the wobble never pokes above the untouched pile
    if (x >= 1) { this.h.set(gr.to); this.grow = null; }
    this.recount(); this.stale = true;
  }

  // Rebuild the visible sheet at most once a frame, however many digs landed.
  refreshIfStale() { if (this.stale) { this.stale = false; this.refresh(); } }
  refresh() {
    const p = this.mesh.geometry.attributes.position;
    // where no dirt is left, tuck the sheet just under whatever it was covering
    const col = this.mesh.geometry.attributes.color;
    for (let k = 0; k < this.h.length; k++) {
      p.setY(k, this.h[k] - this.floor[k] < 0.05 ? this.floor[k] - 0.4 : this.top(k));
      const v = 1 - (1 - F.fresh) * Math.min(1, this.dent[k] / 1.2); col.setXYZ(k, v, v, v);
    }
    p.needsUpdate = col.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  save() { return Array.from(this.toCm()); }
  restore(a) { if (Array.isArray(a) && a.length === this.h.length) this.applySnapshot(a); }
}
