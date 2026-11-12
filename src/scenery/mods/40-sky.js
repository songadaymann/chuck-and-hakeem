import * as THREE from 'three';
import { ps1ify, canvasTex } from '../../ps1.js';
import { SKY, rng } from '../plan.js';
import { tint, place, merge, mesh, hazed, glowFar } from '../kit.js';

// Everything above the horizon: a banded sky with a low sun, two shells of clouds turning slowly round the camera,
// and things flying on looping timetables (geese, a flock round the dome, airliners into National, a helicopter and,
// rarely, a banner plane). The timetables run off the time of day, so everyone online sees roughly the same sky;
// ?skyt=SECONDS starts the clock at a chosen moment instead, for filming: the low traffic repeats every 360 s (helicopter
// crossing from 8; banner plane 80 to 200, behind the Capitol near 108 and back along the Mall near 173; helicopter
// circling the dome from 250).
const TAU = Math.PI * 2;
const BANNERS = ['DIG THEM OUT', 'CALL YOUR REPS', 'NEW LEADERSHIP NOW', 'PASS THE SHOVEL', 'RETIRE ALREADY', 'KEEP DIGGING'];
// A 5-row pixel face for the banner: each letter is five rows of bits, written in base 36 (M, N and W are wider than three).
const GLYPHS = 'A25755B65656C34443D65556E74647F74644G34553H55755I72227J11152K55655L44447MhrlhhN9db99O75557P65644Q75571R65655S34216T72222U55557V55522WhhlrhX55255Y55222Z71247';
const hash = (n) => { const x = Math.sin(n * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };

// The sun the picture shows sits lower than the light the world is lit by: late afternoon, in frame when you look down the Mall.
const SUN = new THREE.Vector3(SKY.sunDir[0], SKY.sunDir[1] * 0.28, SKY.sunDir[2]).normalize();
// Opposite it, a pale day moon already up in the east, over the House side of the dome. Its lit edge is the one nearer the sun.
const MOON = new THREE.Vector3(0.26, 0.58, -0.77).normalize(), MOON_X = SUN.clone().addScaledVector(MOON, -SUN.dot(MOON)).normalize(), MOON_Y = MOON.clone().cross(MOON_X);
const WHITE = new THREE.Color(0xffffff);
// What the dome paints at this height (radians above the horizon), before banding.
const skyAt = (el) => new THREE.Color(SKY.horizon).lerp(new THREE.Color(SKY.zenith), Math.sqrt(Math.max(0, (Math.sin(el) - 0.04) / 0.96)));

function skyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    uniforms: { uHor: { value: new THREE.Color(SKY.horizon) }, uZen: { value: new THREE.Color(SKY.zenith) }, uSun: { value: SUN }, uSunCol: { value: new THREE.Color(0xfffbe6) }, uGlow: { value: new THREE.Color(0xffedc0) },
      uMoon: { value: MOON }, uMoonX: { value: MOON_X }, uMoonY: { value: MOON_Y } },
    // the box rides on the camera: only the camera's turn is applied, never its position
    vertexShader: 'varying vec3 vDir;\nvoid main() { vDir = position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); }',
    fragmentShader: `uniform vec3 uHor, uZen, uSun, uSunCol, uGlow, uMoon, uMoonX, uMoonY; varying vec3 vDir;
      float b2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
      float b4(vec2 a) { return b2(.5 * a) * .25 + b2(a); }
      void main() {
        vec3 d = normalize(vDir);
        float n = b4(gl_FragCoord.xy) - .47;                                 // ordered dither, one cell per rendered pixel
        float t = sqrt(clamp((d.y - .04) / .96, 0., 1.));                    // exactly the horizon colour for the first few degrees
        vec3 c = mix(uHor, uZen, clamp(floor(t * 10. + n * .5), 0., 10.) / 10.);
        vec3 v = d - uSun;
        float g = clamp(1. - length(v * vec3(.75, 1., .75)) / .5, 0., 1.);
        g = clamp(floor(g * g * 6. + .5 + n * .9), 0., 6.) / 6.;             // the glow comes in steps too
        c = mix(c, uGlow, g * .62 * smoothstep(0., .1, d.y));
        if (dot(v, v) < .0013) c = uSunCol;
        vec2 m = vec2(dot(d - uMoon, uMoonX), dot(d - uMoon, uMoonY));       // gibbous: a disc with a slice off the far side, and two grey seas
        if (dot(m, m) < .0009 && m.x > -.45 * sqrt(.0009 - m.y * m.y)) c = mix(c, vec3(.97, .98, 1.), length(m - vec2(.005, .011)) < .012 || length(m + vec2(.012, .01)) < .006 ? .45 : .85);
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200), mat);
  m.frustumCulled = false; m.renderOrder = -1000; m.matrixAutoUpdate = false;
  return m;
}

// ---- clouds
// A faceted blob with a flat underside, sitting on y = 0.
function puff(rand, r, sy) {
  const cut = 0.3, g = new THREE.IcosahedronGeometry(1, 0).rotateX(rand() * TAU).rotateY(rand() * TAU), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(p.getY(i), -cut) + cut);
  return g.scale(r, r * sy, r);
}
// Put a cloud (built round its own origin: x across the view, z away from it) on the shell at this bearing and height,
// drop the faces turned away from the middle (nobody ever sees them) and paint the rest by which way they point.
function cloudAt(parts, az, el, R, tones) {
  const g = merge(parts).translate(0, R * Math.sin(el), R * Math.cos(el)).rotateY(az), p = g.attributes.position.array;
  const haze = Math.max(0.1, 0.6 - el * 1.5) * SKY.hazeFull, cols = tones.map((c) => new THREE.Color(hazed(c, haze, 1))), pos = [], col = [];
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az2 = p[i + 2], ux = p[i + 3] - ax, uy = p[i + 4] - ay, uz = p[i + 5] - az2, vx = p[i + 6] - ax, vy = p[i + 7] - ay, vz = p[i + 8] - az2;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
    if ((nx * ax + ny * ay + nz * az2) / (nl * Math.hypot(ax, ay, az2)) > 0.02) continue;
    const c = cols[ny / nl > 0.45 ? 0 : ny / nl < -0.5 ? 2 : 1];
    for (let k = 0; k < 9; k++) pos.push(p[i + k]);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}
// Flat slivers pinned to the shell and facing the middle: drawn in x (across, the way the shell turns) and y (up) round the spot.
const pinned = (parts, az, el, R, roll) => merge(parts).rotateZ(roll).translate(0, 0, R).rotateX(-el).rotateY(az);
function cloudShell(geos, turn) {
  const m = mesh(geos, glowFar);
  m.frustumCulled = false; m.renderOrder = -900; m.userData.turn = turn;
  m.onBeforeRender = (r, s, cam) => { m.matrixWorld.copy(m.matrix).setPosition(cam.position); };   // a backdrop: always the same distance away
  return m;
}
function clouds(rand) {
  const low = [], high = [], CUMULUS = [0xfffaf0, 0xe4ebf4, 0xa3b4cc];
  const heap = (r0, n) => {
    const parts = [];
    for (let j = 0; j < n; j++) {
      const r = r0 * (0.55 + 0.5 * Math.sin(Math.PI * (j + 0.5) / n)) * (0.85 + rand() * 0.3);
      parts.push(puff(rand, r, 0.7 + rand() * 0.3).translate((j - (n - 1) / 2) * r0 * 0.95, 0, (rand() - 0.5) * r0 * 0.6));
    }
    if (n > 3) parts.push(puff(rand, r0 * 0.75, 0.9).translate((rand() - 0.5) * r0 * 1.2, r0 * 0.45, 0));   // a tower on the bigger ones
    return parts;
  };
  // fair-weather cumulus sitting just above the roofline all the way round
  for (let i = 0, N = 21; i < N; i++) low.push(cloudAt(heap(38 + rand() * 44, 3 + Math.floor(rand() * 4)), (i + rand() * 0.7) / N * TAU, 0.09 + rand() * 0.15, 1240, CUMULUS));
  // a few more riding higher, seen from underneath, so an upright phone has something above the dome
  for (let i = 0, N = 9; i < N; i++) low.push(cloudAt(heap(34 + rand() * 30, 3 + Math.floor(rand() * 2)), (i + 0.2 + rand() * 0.6) / N * TAU, 0.28 + rand() * 0.4, 1240, CUMULUS));
  // higher, flatter, paler: long lumpy bars, drifting more slowly behind the first lot
  for (let i = 0, N = 20; i < N; i++) {
    const r0 = 20 + rand() * 18, n = 3 + Math.floor(rand() * 4), parts = [];
    for (let j = 0; j < n; j++) parts.push(puff(rand, r0 * (0.75 + rand() * 0.5), 0.42).translate((j - (n - 1) / 2) * r0 * 1.3, rand() * r0 * 0.12, (rand() - 0.5) * r0));
    high.push(cloudAt(parts, (i + rand() * 0.8) / N * TAU, 0.2 + Math.pow(rand(), 1.5) * 0.8, 1330, [0xffffff, 0xf0f4fa, 0xd2ddeb]));
  }
  // mares' tails far overhead
  for (let i = 0; i < 7; i++) {
    const el = 0.6 + rand() * 0.7, col = skyAt(el).lerp(WHITE, 0.55).getHex(), parts = [];
    for (let j = 0, n = 2 + Math.floor(rand() * 3); j < n; j++) {
      const L = 110 + rand() * 130, w = 12 + rand() * 10, x = j * 60 + rand() * 40, y = j * 26;
      parts.push(poly(col, [[x - L / 2, y, 0], [x + L * 0.15, y + w / 2, 0], [x + L / 2, y + w * 0.2, 0], [x - L * 0.1, y - w / 2, 0]]));
    }
    high.push(pinned(parts, rand() * TAU, el, 1330, (rand() - 0.5) * 0.7));
  }
  // and the trail of something too high to hear, fading out behind it
  const trail = [0.95, 0.7, 0.42].map((k, j) => poly(skyAt(0.5).lerp(WHITE, k).getHex(), [[-j * 130, 4 + j * 1.5, 0], [-j * 130 - 130, 5.5 + j * 1.5, 0], [-j * 130 - 130, -5.5 - j * 1.5, 0], [-j * 130, -4 - j * 1.5, 0]]));
  high.push(pinned([...trail, poly(0xe9eef4, [[12, 0, 0], [24, 4, 0], [32, 0, 0], [24, -4, 0]])], 2.2, 0.5, 1330, 0));
  return [cloudShell(low, 0.0042), cloudShell(high, 0.0019)];
}

// ---- things that fly
// Unlit paint that fades into the horizon over kilometres instead of the lawn's few hundred metres: a gentler haze
// than kit.hazed, so a white aircraft still shows against a pale sky.
// Given a clock (uT) it also ripples whatever it paints, more the further back along -z: the banner.
function farPaint(o, uT) {
  const m = ps1ify(new THREE.MeshBasicMaterial(o)), snapTo = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    snapTo(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG\n gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, min(vFogDepth / ${(SKY.hazeFull * 1.5).toFixed(1)}, 0.7));\n#endif`);
    if (!uT) return;
    sh.uniforms.uT = uT;
    sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n float fl = min(1., -position.z * 5.);\n transformed.y += fl * .9 * sin(uT * 5. + position.z * 12.);\n transformed.x += fl * 1.6 * sin(uT * 3.1 + position.z * 7.);');
  };
  m.customProgramCacheKey = () => (uT ? 'sky-flag' : 'sky-far');
  return m;
}
// Paint for birds: wings beat and each bird strays a little, all in the vertex shader. aFlap = (beat metres, phase, beats rad/s, stray metres).
function birdPaint(uT) {
  const m = ps1ify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })), snapTo = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    snapTo(sh); sh.uniforms.uT = uT;
    sh.vertexShader = 'uniform float uT; attribute vec4 aFlap;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n transformed.y += aFlap.x * sin(uT * aFlap.z + aFlap.y);\n transformed += aFlap.w * vec3(sin(uT * .83 + aFlap.y * 3.1), .5 * sin(uT * 1.07 + aFlap.y * 5.3), sin(uT * .71 + aFlap.y * 7.7));');
  };
  m.customProgramCacheKey = () => 'sky-bird';
  return m;
}
// A flat polygon (a fan round its first point), by default painted on both faces.
function poly(color, pts, both = true) {
  const v = [];
  for (let i = 1; i + 1 < pts.length; i++) { v.push(...pts[0], ...pts[i], ...pts[i + 1]); if (both) v.push(...pts[0], ...pts[i + 1], ...pts[i]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return tint(g, color);
}
const tube = (r0, r1, len, sides, color, o) => place(tint(new THREE.CylinderGeometry(r0, r1, len, sides, 1, true).rotateX(Math.PI / 2), color), o);   // along z, r0 at the front
const block = (w, h, d, color, o) => place(tint(new THREE.BoxGeometry(w, h, d), color), o);
const gem = (r, color, o) => place(tint(new THREE.OctahedronGeometry(r, 0), color), o);
// Aircraft are unlit, so darken by hand whatever faces down. Lights are added afterwards so they stay full strength.
function craft(parts, lights = []) {
  const g = merge(parts), c = g.attributes.color, n = g.attributes.normal;
  for (let i = 0; i < c.count; i++) { const k = 0.8 + 0.2 * n.getY(i); c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k); }
  return lights.length ? merge([g, ...lights]) : g;
}
// Birds: one mesh per flock. Nose toward +z; two wings that beat and an upright sliver of body so it never vanishes edge-on.
function flock(list, mat) {
  const P = [], C = [], F = [], c = new THREE.Color(), tip = new THREE.Color();
  const v = (b, x, y, z, col, beat) => { P.push(b.x + x, b.y + y, b.z + z); C.push(col.r, col.g, col.b); F.push(beat, b.phase, b.rate, b.stray); };
  for (const b of list) {
    const h = b.span / 2, l = b.len;
    c.set(b.color); tip.set(b.tip ?? b.color);
    for (const s of [-1, 1]) { v(b, 0, 0, l * 0.14, c, 0); v(b, 0, 0, -l * 0.22, c, 0); v(b, s * h, 0, -l * 0.12, tip, b.beat); }
    v(b, 0, 0.02, l * (b.neck ? 0.66 : 0.5), tip, 0); v(b, 0, 0.02, -l * 0.42, c, 0); v(b, 0, -l * 0.15, 0, c, 0);
    if (b.neck) { v(b, 0, 0, l * 0.66, tip, 0); v(b, -l * 0.1, 0, -l * 0.42, c, 0); v(b, l * 0.1, 0, -l * 0.42, c, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aFlap', new THREE.Float32BufferAttribute(F, 4));
  g.computeVertexNormals(); g.computeBoundingSphere(); g.boundingSphere.radius += 8;   // room for the beating and straying
  const m = new THREE.Mesh(g, mat);
  m.matrixAutoUpdate = false;
  return m;
}

function airliner(mat) {
  const W = 0xf2f4f6, NAVY = 0x1d3a6e, GREY = 0x9aa3ad, wing = (s) => [poly(GREY, [[s * 3, -1, 6], [s * 29, 0.6, -9], [s * 29, 0.6, -13], [s * 3, -1, -7]]), tube(1.9, 1.7, 8, 5, NAVY, { x: s * 11, y: -3, z: 0 })];
  const body = craft([
    tube(3.2, 3.2, 44, 6, W, { z: -1 }), place(tint(new THREE.ConeGeometry(3.2, 8, 6, 1, true).rotateX(Math.PI / 2), W), { z: 25 }), tube(3.2, 0.9, 12, 6, W, { y: 1.1, z: -29 }),
    block(6.6, 1.2, 40, 0xb9c2cc, { y: -2.4, z: -1 }), wing(1), wing(-1),
    poly(NAVY, [[0, 2.5, -22], [0, 13, -33], [0, 13, -36], [0, 2.5, -34]]), poly(GREY, [[0, 2, -27], [11, 2.6, -34], [11, 2.6, -36.5], [0, 2, -34]]), poly(GREY, [[0, 2, -27], [-11, 2.6, -34], [-11, 2.6, -36.5], [0, 2, -34]]),
  ], [gem(2.2, 0xff2a1e, { x: 29, y: 0.6, z: -11 }), gem(2.2, 0x1eff4a, { x: -29, y: 0.6, z: -11 }), gem(2.4, 0xfffff0, { y: -3.4, z: 14 })]);   // red to port, green to starboard, a landing light
  const m = mesh(body, mat), strobe = mesh([gem(3, 0xffffff, { x: 29, y: 0.6, z: -13 }), gem(3, 0xffffff, { x: -29, y: 0.6, z: -13 }), gem(3, 0xffffff, { y: 13, z: -36 })], mat);
  m.add(strobe); m.userData.strobe = strobe;
  return m;
}
// Olive with a white top: the kind of helicopter this town is used to.
function helicopter(mat) {
  const G = 0x3d5133, T = 0xeef0ea, DARK = 0x20262c;
  const m = mesh(craft([
    place(tint(new THREE.IcosahedronGeometry(1, 0), G), { sx: 2.5, sy: 2.4, sz: 6 }), block(3.4, 1.3, 7, T, { y: 2, z: -0.5 }), block(4.2, 1.5, 2.4, DARK, { y: 0.5, z: 4 }),
    tube(1.3, 0.5, 11, 4, G, { y: 1.1, z: -9.5 }), poly(G, [[0, 0.8, -13], [0, 5.2, -16.4], [0, 5.2, -14.6], [0, 1.6, -11.5]]), block(0.5, 3.6, 3.6, DARK, { x: 0.7, y: 4.6, z: -15.4 }),
    block(0.6, 0.6, 8, DARK, { x: 2.2, y: -3.1, z: 0.5 }), block(0.6, 0.6, 8, DARK, { x: -2.2, y: -3.1, z: 0.5 }), block(0.8, 1.2, 0.8, DARK, { y: 3.2 }),
  ]), mat);
  const rotor = mesh(craft([poly(DARK, [[-0.6, 0, -9.5], [0.6, 0, -9.5], [0.6, 0, 9.5], [-0.6, 0, 9.5]]), poly(DARK, [[-9.5, 0, -0.6], [-9.5, 0, 0.6], [9.5, 0, 0.6], [9.5, 0, -0.6]])]), mat);
  rotor.position.y = 3.9; m.add(rotor); m.userData.rotor = rotor;
  return m;
}
// A yellow high-wing tug, a tow line, and the banner itself: two strips back to back so it reads from both sides, cut
// into pieces so it can ripple. It is one unit long and stretched to fit the words.
function bannerPlane(mat, uT) {
  const Y = 0xf2c318, DARK = 0x1c1c1c, H = 14, TOW = 16, ROWS = 7, N = 10;
  const m = mesh(craft([
    block(2.2, 2.4, 7, Y, { z: 1 }), tube(1.4, 0.4, 7.5, 4, Y, { y: 0.3, z: -6.2 }), block(2.4, 2, 1.6, DARK, { y: -0.1, z: 5.2 }), block(22, 0.5, 3.6, Y, { y: 1.5, z: 1.6 }),
    poly(Y, [[0, 0.4, -7.5], [0, 3.8, -10], [0, 3.8, -8.6], [0, 1, -6]]), poly(Y, [[-4, 0.6, -9.6], [4, 0.6, -9.6], [4, 0.6, -7.6], [-4, 0.6, -7.6]]), block(0.3, 5.4, 0.5, DARK, { z: 6.2 }),
    block(0.4, 0.4, TOW, DARK, { y: -1.5, z: -10 - TOW / 2 }), block(0.7, H + 1, 0.7, DARK, { y: -1.5, z: -10 - TOW }),
  ]), mat);
  let ctx;
  const tex = canvasTex(96, ROWS, (g) => { ctx = g; }), g = new THREE.BufferGeometry(), P = [], U = [];
  for (let i = 0; i < N; i++) for (const back of [0, 1]) {
    const a = i / N, b = (i + 1) / N, q = back ? [a, 1, b, 0, a, 0, a, 1, b, 1, b, 0] : [a, 1, a, 0, b, 0, a, 1, b, 0, b, 1];
    for (let k = 0; k < 12; k += 2) { P.push(0, (q[k + 1] - 0.5) * H, -q[k]); U.push(back ? 1 - q[k] : q[k], q[k + 1]); }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  const flag = new THREE.Mesh(g, farPaint({ map: tex }, uT));
  flag.position.set(0, -1.5, -10 - TOW); flag.matrixAutoUpdate = false; m.add(flag);
  m.userData.say = (text) => {
    ctx.fillStyle = '#f6f2e4'; ctx.fillRect(0, 0, 96, ROWS); ctx.fillStyle = '#c4122b';
    let x = 3;
    for (const ch of text) {
      const at = GLYPHS.indexOf(ch);
      if (at < 0) { x += 2; continue; }
      const rows = [1, 2, 3, 4, 5].map((r) => parseInt(GLYPHS[at + r], 36)), w = Math.max(...rows) > 15 ? 5 : Math.max(...rows) > 7 ? 4 : 3;
      rows.forEach((bits, r) => { for (let c = 0; c < w; c++) if ((bits >> (w - 1 - c)) & 1) ctx.fillRect(x + c, 1 + r, 1, 1); });
      x += w + 1;
    }
    tex.repeat.x = (x + 2) / 96; tex.needsUpdate = true;
    flag.scale.z = (x + 2) * H / ROWS; flag.updateMatrix();
  };
  return m;
}

export async function build(game) {
  const rand = rng(4040), uT = { value: 0 }, far = farPaint({ vertexColors: true }), feathers = birdPaint(uT);
  const skyt = new URLSearchParams(location.search).get('skyt');
  let T = skyt !== null ? Number(skyt) || 0 : (Date.now() / 1000) % 86400, said = -1;

  const shells = clouds(rand);
  // nine Canada geese in a lopsided V, and a loose flock of starlings with a few pigeons mixed in
  const vee = [];
  for (let i = 0; i < 9; i++) { const k = Math.ceil(i / 2), s = i % 2 ? 1 : -1; vee.push({ x: s * k * 4.4, y: (rand() - 0.5) * 0.8, z: -k * 5.6 - (s > 0 ? 0 : 2), span: 5.4, len: 4, color: 0x4b3d2f, tip: 0x17140f, neck: true, beat: 1.3, phase: rand() * TAU, rate: 8 + rand(), stray: 0.5 }); }
  const birds = [];
  for (let i = 0; i < 36; i++) { const a = rand() * TAU, d = Math.sqrt(rand()) * 18; birds.push({ x: Math.cos(a) * d, y: (rand() - 0.5) * 9, z: Math.sin(a) * d, span: 3.2, len: 2, color: rand() < 0.25 ? 0x6d727c : 0x1b1a22, beat: 1.1, phase: rand() * TAU, rate: 15 + rand() * 4, stray: 3 + rand() * 3 }); }
  const geese = flock(vee, feathers), starlings = flock(birds, feathers), jet = airliner(far), heli = helicopter(far), tug = bannerPlane(far, uT);
  game.scene.add(skyDome(), ...shells, geese, starlings, jet, heli, tug);
  for (const o of [jet, tug]) game.renderer.compile(o, game.camera, game.scene);   // build their shaders now, not when they first fly past

  const flyer = (kind, o) => ({ kind, pos: o.position, active: false, o, bank: 0 });
  const F = { geese: flyer('geese', geese), starlings: flyer('starlings', starlings), jet: flyer('airliner', jet), heli: flyer('helicopter', heli), tug: flyer('banner', tug) }, flyers = Object.values(F);
  // Show a flyer here, or hide it. `s` shrinks it to nothing where it joins and leaves the sky, far away.
  const put = (f, on, x, y, z, yaw, pitch, bank, s = 1) => {
    f.active = f.o.visible = on;
    if (!on) return;
    f.o.position.set(x, y, z); f.o.rotation.set(pitch, yaw, bank, 'YXZ'); f.o.scale.setScalar(Math.max(0.001, Math.min(1, s))); f.o.updateMatrix();
  };
  // A pass that flies in straight, turns `turn` radians round (cx, cz) at radius R (negative: to the left), and flies out
  // straight. `s` is metres flown; false once it is over.
  const pass = (f, dt, s, y, cx, cz, R, a0, turn, lead, pitch, lean) => {
    const arc = Math.abs(turn) * R, sg = Math.sign(turn), total = lead * 2 + arc, on = s >= 0 && s < total;
    if (on) {
      const turning = s > lead && s < lead + arc, a = a0 + sg * Math.max(0, Math.min(arc, s - lead)) / R, off = s < lead ? s - lead : Math.max(0, s - lead - arc), tx = -Math.sin(a) * sg, tz = Math.cos(a) * sg;
      f.bank += ((turning ? sg * lean : 0) - f.bank) * Math.min(1, dt * 1.2);
      put(f, true, cx + Math.cos(a) * R + tx * off, y, cz + Math.sin(a) * R + tz * off, Math.atan2(tx, tz), pitch, f.bank, Math.min(s, total - s) / 150);
    } else put(f, false);
    return on;
  };

  function update(dt) {
    T += dt; uT.value += dt;
    for (let i = 0; i < 2; i++) { const c = shells[i]; c.rotation.y = (T * c.userData.turn) % TAU; c.updateMatrix(); }

    // starlings: always out, round and round the dome, the flock breathing in and out
    const a = 0.3 * T + 0.9 * Math.sin(0.11 * T), r = 1 + 0.35 * Math.sin(0.23 * T);
    put(F.starlings, true, Math.cos(a) * 78 * r, 84 + 16 * Math.sin(0.17 * T), 6 + Math.sin(a) * 62 * r, -a, 0, 0.25, 0.82 + 0.18 * Math.sin(0.37 * T));

    // geese: every three minutes or so a V comes down from the north, a different line each time: over the west lawn,
    // or behind the Capitol where the people facing it can watch them cross
    const kg = Math.floor(T / 190), ug = (T - kg * 190) / 92, ag = (hash(kg) - 0.5) * 0.7, dg = ug * 1840 - 920, east = hash(kg + 0.7) < 0.45;
    put(F.geese, ug < 1, Math.cos(ag) * dg, (east ? 78 : 60) + hash(kg + 0.2) * 26 + Math.sin(T * 0.5) * 1.5, (east ? -150 + hash(kg + 0.5) * 70 : 60 + hash(kg + 0.5) * 200) + Math.sin(ag) * dg, Math.PI / 2 - ag, 0, 0);

    // airliners: down the river from the north-west, round the far end of the Mall, sinking away to the south
    const ka = Math.floor(T / 96), u = (T - ka * 96) / 46, v = 1 - u, bz = 1010 + (hash(ka) - 0.5) * 110, lift = hash(ka + 0.4) * 50;
    const vx = v * 700 + u * 860, vy = v * -110 + u * -140, vz = v * (bz - 700) + u * (560 - bz);
    put(F.jet, u < 1, v * v * -760 + 2 * u * v * -60 + u * u * 800, v * v * 310 + 2 * u * v * 200 + u * u * 60 + lift * v, v * v * 700 + 2 * u * v * bz + u * u * 560,
      Math.atan2(vx, vz), -Math.atan2(vy, Math.hypot(vx, vz)) - 0.06, -0.12, Math.min(u, v) / 0.07);
    const blink = T % 1.4;
    jet.userData.strobe.visible = blink < 0.08 || (blink > 0.22 && blink < 0.3);

    // one low slot, six minutes round: a helicopter crossing, then the banner plane, then the helicopter circling the dome
    const ks = Math.floor(T / 360), ts = T - ks * 360, sg = hash(ks + 0.3) < 0.5 ? -1 : 1, bob = Math.sin(T * 0.9) * 1.2;
    let chop;
    if (ts < 200) { const b = hash(ks + 0.1) * TAU; chop = pass(F.heli, dt, (ts - 8) * 34, 104 + bob, Math.cos(b) * 190, 10 + Math.sin(b) * 190, 260, b + Math.PI - sg * 0.35, sg * 0.7, 800, 0.09, 0.3); }
    else chop = pass(F.heli, dt, (ts - 250) * 34, 98 + bob, 0, 5, 135, hash(ks + 0.6) * TAU, sg * TAU * 1.6, 800, 0.09, 0.3);
    if (chop) { const ro = heli.userData.rotor; ro.rotation.y = (T * 13) % TAU; ro.updateMatrix(); }
    // the banner goes by side-on twice: along the back of the Capitol, a wide turn out in the haze, then back along the head of the Mall
    if (pass(F.tug, dt, (ts - 80) * 21, 96 + bob, sg * 420, 60, 170, -Math.PI / 2, sg * Math.PI, 1000, -0.07, 0.22) && said !== ks) { said = ks; tug.userData.say(BANNERS[ks % BANNERS.length]); }
  }
  update(0);
  return { update, flyers };
}
