import { CFG } from './config.js';
import { worldH } from './terrain.js';

const D = CFG.dirt, G = CFG.giant;

function hash(i, j, seed) { const n = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return n - Math.floor(n); }

// One pile of dirt burying one giant: a grid of column heights that digging lowers. No rendering here, so the
// server runs exactly the same code. Dirt only ever goes down, which is what makes syncing simple: any two copies
// agree once each cell holds the lower of the two values.
export class DirtGrid {
  constructor(giant, seed) {
    this.giant = giant;
    const n = this.n = D.cells;
    this.cell = D.size / (n - 1);
    this.x0 = giant.x - D.size / 2;
    this.z0 = giant.z - D.size / 2;
    // doubles: when thousands dig at once each dig is scaled down to a sliver, and those slivers must still add up
    this.floor = new Float64Array(n * n);
    this.h0 = new Float64Array(n * n);
    this.h = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = this.x0 + i * this.cell, z = this.z0 + j * this.cell, k = j * n + i;
      const f = this.floorAt(x, z);
      const s = Math.max(0, 1 - (Math.hypot(x - giant.x, (z - giant.z) * 0.9) / D.radius) ** 2);
      const lump = (hash(i, j, seed) - 0.5) * 1.6 * Math.min(1, s * 4);
      const edge = Math.min(i, j, n - 1 - i, n - 1 - j) === 0;
      this.floor[k] = f;
      // stored thickness is whole centimetres, so every copy of the pile starts from identical numbers
      this.h0[k] = this.h[k] = f + Math.round((edge ? 0 : Math.max(0, D.peak * Math.pow(s, 0.8) + lump - f)) * 100) / 100;
    }
    this.total = this.volume();
    this.left = this.total;
  }

  // What is under the dirt at a point: lawn, terrace or roof, or the giant himself.
  floorAt(x, z) {
    const dx = x - this.giant.x, dz = z - this.giant.z, f = worldH(x, z);
    if (dx * dx + dz * dz < G.headR * G.headR) return Math.max(f, G.baseY + G.height - 0.5);            // you can stand on the head
    if ((dx / G.torsoRX) ** 2 + (dz / G.torsoRZ) ** 2 < 1) return Math.max(f, G.baseY + G.shoulderY);   // and on the shoulders
    return f;
  }

  volume() { let v = 0; for (let k = 0; k < this.h.length; k++) v += this.h[k] - this.floor[k]; return v * this.cell * this.cell; }
  get progress() { return 1 - this.left / this.total; }
  get done() { return this.progress >= D.doneAt; }
  inside(x, z) { return x >= this.x0 && z >= this.z0 && x <= this.x0 + D.size && z <= this.z0 + D.size; }

  // The surface you see and stand on at a cell. The browser's pile lowers this by its own short-lived dents.
  top(k) { return this.h[k]; }

  heightAt(x, z) {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell, n = this.n;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j)), k = j * n + i;
    // Bare corners use the exact floor here, so a dug-out wall is a cliff and not a ramp between grid points.
    const f = this.floorAt(x, z), c = (q) => (this.h[q] - this.floor[q] > 0.05 ? this.top(q) : f);
    return Math.max(f, (c(k) * (1 - u) + c(k + 1) * u) * (1 - v) + (c(k + n) * (1 - u) + c(k + n + 1) * u) * v);
  }

  // Lower the pile inside a circle; returns cubic metres actually removed. `touched(k)` is called for each changed cell.
  dig(x, z, r, depth, touched) {
    const n = this.n, c = this.cell;
    const i0 = Math.max(1, Math.floor((x - r - this.x0) / c)), i1 = Math.min(n - 2, Math.ceil((x + r - this.x0) / c));
    const j0 = Math.max(1, Math.floor((z - r - this.z0) / c)), j1 = Math.min(n - 2, Math.ceil((z + r - this.z0) / c));
    let removed = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(this.x0 + i * c - x, this.z0 + j * c - z);
      if (d >= r) continue;
      const k = j * n + i, nh = Math.max(this.floor[k], this.h[k] - depth * (1 - (d / r) ** 2));
      if (nh < this.h[k]) { removed += this.h[k] - nh; this.h[k] = nh; if (touched) touched(k); }
    }
    removed *= c * c;
    this.left = Math.max(0, this.left - removed);
    return removed;
  }

  // The one way dirt goes back up (a lobby's dirt bomb). Every cell gets back the same share of what it has lost since
  // the start, so the pile keeps its shape. Returns cubic metres poured on. Everyone else's copy has to be replaced,
  // not merged, afterwards: the World bumps its fill generation for that (see worker/world.js).
  refill(vol, touched) {
    let missing = 0;
    for (let k = 0; k < this.h.length; k++) missing += this.h0[k] - this.h[k];
    missing *= this.cell * this.cell;
    if (!(vol > 0) || missing <= 0) return 0;
    const f = Math.min(1, vol / missing);
    for (let k = 0; k < this.h.length; k++) { const add = (this.h0[k] - this.h[k]) * f; if (add > 0) { this.h[k] += add; if (touched) touched(k); } }
    this.recount();
    return f * missing;
  }

  // Thickness of dirt in centimetres per cell: the wire and storage format.
  cm(k) { return Math.max(0, Math.min(65535, Math.round((this.h[k] - this.floor[k]) * 100))); }
  toCm() { const a = new Uint16Array(this.h.length); for (let k = 0; k < a.length; k++) a[k] = this.cm(k); return a; }
  // Take the lower of what we have and what we are told. Returns true if anything changed.
  mergeCm(k, cm) { const v = this.floor[k] + cm / 100; if (v < this.h[k] - 0.004) { this.h[k] = v; return true; } return false; }
  recount() { this.left = this.volume(); }
  // Back to the untouched pile (used when the server's copy is about to replace a practice one).
  resetHeights() { this.h.set(this.h0); this.left = this.total; }
}
