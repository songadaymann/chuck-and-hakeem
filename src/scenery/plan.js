import { CFG, moundSpots } from '../config.js';
import { worldH } from '../../shared/terrain.js';

// The map everything decorative agrees on, so roads, trees, traffic and people never land on top of each other.
// Compass: the Capitol's west front faces +Z (down the Mall to the Washington Monument). North is -X (Senate side,
// Chuck), south is +X (House side, Hakeem), east is -Z (behind the building: Supreme Court, Library of Congress).
// Players can walk anywhere inside CFG.worldRadius (330 m) of the origin. All of this is for looks only: nothing
// here changes where you can walk, except rectangles pushed onto game.solids.
export const COMPASS = { west: [0, 1], east: [0, -1], north: [-1, 0], south: [1, 0] };

// Streets cars drive on: centre line as [x, z] points, full width in metres. Two-way, one lane each way.
export const ROADS = [
  { id: 'first-w', name: 'First St', w: 12, pts: [[-420, 114], [420, 114]] },                 // between the west lawn and the pool
  { id: 'third-w', name: 'Third St', w: 12, pts: [[-420, 196], [420, 196]] },                 // far side of the pool; the Mall starts here
  { id: 'first-e', name: 'First St NE', w: 12, pts: [[-420, -150], [420, -150]] },            // behind the Capitol
  { id: 'constitution', name: 'Constitution Ave', w: 14, pts: [[-205, -460], [-205, 700]] },  // north edge of the grounds and the Mall
  { id: 'independence', name: 'Independence Ave', w: 14, pts: [[205, -460], [205, 700]] },    // south edge
  { id: 'pennsylvania', name: 'Pennsylvania Ave', w: 14, pts: [[-120, 114], [-205, 352], [-300, 620]] },   // off to the White House
  { id: 'maryland', name: 'Maryland Ave', w: 12, pts: [[120, 114], [205, 352]] },
  { id: 'east-capitol', name: 'East Capitol St', w: 12, pts: [[0, -150], [0, -520]] },
  { id: 'madison', name: 'Madison Dr', w: 9, pts: [[-112, 196], [-112, 700]] },               // the two drives down the sides of the Mall
  { id: 'jefferson', name: 'Jefferson Dr', w: 9, pts: [[112, 196], [112, 700]] },
];

// Gravel and paved walks: people and bicycles, no cars.
export const WALKS = [
  { id: 'centre', w: 30, pts: [[0, 40], [0, 108]] },                         // from the west steps down to First St
  { id: 'pool-n', w: 6, pts: [[-41, 122], [-41, 190]] }, { id: 'pool-s', w: 6, pts: [[41, 122], [41, 190]] },
  { id: 'pool-e', w: 6, pts: [[-41, 122], [41, 122]] }, { id: 'pool-w', w: 6, pts: [[-41, 179], [41, 179]] },
  { id: 'lawn-n', w: 5, pts: [[-70, 44], [-96, 80], [-116, 106]] },          // curved walks from the terrace corners to the circles
  { id: 'lawn-s', w: 5, pts: [[70, 44], [96, 80], [116, 106]] },
  { id: 'mall-n', w: 8, pts: [[-48, 204], [-48, 700]] }, { id: 'mall-s', w: 8, pts: [[48, 204], [48, 700]] },
  { id: 'east-plaza', w: 60, pts: [[0, -34], [0, -142]] },                   // the paved plaza behind the building
];

export const POOL = CFG.pool;                                                // the Capitol Reflecting Pool
export const CIRCLES = [{ id: 'peace', name: 'Peace Circle', x: -120, z: 114, r: 15 }, { id: 'garfield', name: 'Garfield Circle', x: 120, z: 114, r: 15 }];
// The Mall proper, from Third St westward: open grass down the middle, four rows of elms each side between the walks and the drives.
export const MALL = { z0: 204, z1: 700, grassHalfX: 42, elmRows: [60, 72, 86, 98] };
export const MOUNDS = moundSpots();

const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
export const lineDist = (x, z, pts) => { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };

// Which street / walk is under this point (within `pad` metres of its edge), or null.
export const roadAt = (x, z, pad = 0) => ROADS.find((r) => lineDist(x, z, r.pts) < r.w / 2 + pad) || CIRCLES.find((c) => Math.hypot(x - c.x, z - c.z) < c.r + 6 + pad) || null;
export const walkAt = (x, z, pad = 0) => WALKS.find((r) => lineDist(x, z, r.pts) < r.w / 2 + pad) || null;
export const inPool = (x, z, pad = 0) => Math.abs(x - POOL.x) < POOL.halfX + pad && Math.abs(z - POOL.z) < POOL.halfZ + pad;
// The building, its terrace and grass bank, and the two dig sites in front of the wings.
export const inCapitol = (x, z, pad = 0) => (Math.abs(x) < 82 + pad && Math.abs(z) < 34 + pad) || CFG.giants.some((g) => Math.abs(x - g.x) < 36 + pad && z > -24 - pad && z < 46 + pad);
export const nearMound = (x, z, pad = 0) => MOUNDS.some((m) => Math.hypot(x - m.x, z - m.z) < 8 + pad);
// The grounds players actually use: inside the ring of streets (roughly the Capitol lawns plus the pool block).
export const inGrounds = (x, z) => Math.abs(x) < 198 && z > -144 && z < 190;

// Should a tree, bench, parked van or standing person keep off this spot? True on streets, walks, water, the building,
// the dig sites, the mounds, the open ground in front of the steps and the place new players appear.
export function blocked(x, z, pad = 0) {
  return !!roadAt(x, z, pad) || !!walkAt(x, z, pad) || inPool(x, z, pad + 2) || inCapitol(x, z, pad) || nearMound(x, z, pad)
    || (Math.abs(x) < 44 + pad && z > 20 && z < 66 + pad) || Math.hypot(x - CFG.spawn.x, z - CFG.spawn.z) < 12 + pad || worldH(x, z) > 0.01;
}

// The air. Fog fades the playable grounds into the horizon colour; anything drawn beyond the fog must be painted
// already faded (kit.hazed) with fog switched off. A clear, bright late-autumn afternoon.
export const SKY = { horizon: 0xa9c6de, zenith: 0x3f7fc4, fogNear: 150, fogFar: 560, hazeFull: 1500, sunDir: [60, 120, 90] };

// Same numbers every visit, so the world looks identical to everyone.
export function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }
