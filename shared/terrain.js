import { CFG } from './config.js';

const C = CFG.capitol;

// Height of everything solid that is not dirt: lawn, terrace, stairs, roofs. Walls are just cliffs in this map.
// Pure maths, shared by the browser and the server.
export function worldH(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= C.halfX && az <= C.halfZ) {
    for (const g of CFG.giants) if (Math.abs(x - g.x) <= C.notchHalfX && z >= C.notchBackZ) return C.terraceH;
    return ax <= C.centerHalfX ? C.centerRoof : C.wingRoof;
  }
  const dx = Math.max(0, ax - C.terraceHalfX), dz = Math.max(0, az - C.terraceHalfZ);
  let h = C.terraceH * Math.max(0, 1 - Math.hypot(dx, dz) / C.berm);
  if (ax <= C.stairsHalfX && z > C.terraceHalfZ && z < C.stairsZ1) h = Math.max(h, C.terraceH * (1 - (z - C.terraceHalfZ) / (C.stairsZ1 - C.terraceHalfZ)));
  return h;
}
