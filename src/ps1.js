import * as THREE from 'three';

// Shared PS1 look: vertex snapping to a coarse grid, nearest-neighbour textures, unfiltered low-res output.
// The game's two typefaces: a dirt-caked display face for names and titles, a pixel face for everything else.
export const FONT = { big: '"Rubik Dirt", Impact, sans-serif', px: 'Silkscreen, ui-monospace, monospace' };

export const snap = { value: new THREE.Vector2(240, 150) };

export function ps1ify(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnap = snap;
    sh.vertexShader = 'uniform vec2 uSnap;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n vec2 sp = gl_Position.xy / gl_Position.w; sp = floor(sp * uSnap + 0.5) / uSnap; gl_Position.xy = sp * gl_Position.w;');
  };
  return mat;
}

export function crisp(tex) {
  if (!tex) return tex;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Swap every material in a loaded model for a cheap vertex-lit one.
export function retro(root, { alpha = false } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = !o.isSkinnedMesh;   // skinned bodies move away from their rest-pose bounds; everything else can be culled
    const tex = crisp(o.material.map);
    o.material = ps1ify(new THREE.MeshLambertMaterial({ map: tex, alphaTest: alpha ? 0.5 : 0, side: alpha ? THREE.DoubleSide : THREE.FrontSide }));
  });
  return root;
}

export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return crisp(t);
}

export function noiseTex(base, spread, repeat, seed = 1) {
  return canvasTex(32, 32, (g) => {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const k = 1 + (rnd() - 0.5) * spread;
      g.fillStyle = `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`;
      g.fillRect(x, y, 1, 1);
    }
  }, repeat);
}

// Text on a flat board (signs) or a camera-facing sprite (thrown attacks).
export function textTex(text, bg, fg = '#fff', w = 128, h = 48) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const words = text.split(' ');
    const lines = words.length > 1 && text.length > 9 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text];
    let size = Math.floor(h / lines.length * 0.8);
    g.font = `bold ${size}px ${FONT.px}`;
    while (size > 6 && Math.max(...lines.map((l) => g.measureText(l).width)) > w - 8) { size--; g.font = `bold ${size}px ${FONT.px}`; }
    lines.forEach((l, i) => g.fillText(l, w / 2, h * (i + 0.5) / lines.length + 1));
  });
}
