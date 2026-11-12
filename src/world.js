import * as THREE from 'three';
import { CFG } from './config.js';
import { ps1ify, noiseTex } from './ps1.js';
import { model } from './assets.js';
import { worldH } from '../shared/terrain.js';
import { SKY } from './scenery/plan.js';

const C = CFG.capitol;
export { worldH };

export async function buildWorld(scene) {
  scene.background = new THREE.Color(SKY.horizon);
  scene.fog = new THREE.Fog(SKY.horizon, SKY.fogNear, SKY.fogFar);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.5);
  sun.position.set(...SKY.sunDir);
  scene.add(sun);

  // lawn, subdivided so vertex snapping wobbles it like a PS1 floor
  const R = CFG.worldRadius;
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.4, R * 2.4, 48, 48),
    ps1ify(new THREE.MeshLambertMaterial({ map: noiseTex([78, 120, 62], 0.22, 180, 3) })));
  lawn.rotation.x = -Math.PI / 2;
  scene.add(lawn);
  const cap = await model('/models/world/capitol.glb');
  if (cap) scene.add(cap.root);
  else {  // stand-in blocks with the same footprint
    const mat = ps1ify(new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }));
    const blk = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); scene.add(m); };
    blk(C.terraceHalfX * 2, C.terraceH, C.terraceHalfZ * 2, 0, 0, 0);
    blk(60, C.centerRoof - 3, 44, 0, 3, 0); blk(14, 22, 44, -63.5, 3, 0); blk(14, 22, 44, 63.5, 3, 0);
    blk(40, 18, 19, -50, 3, -12.5); blk(40, 18, 19, 50, 3, -12.5);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.scale.y = 2; dome.position.y = 25; scene.add(dome);
  }

  // everything else you see (roads, trees, the city, traffic, people) is built by src/scenery
  return {};
}
