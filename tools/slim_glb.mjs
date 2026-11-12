// Make a character GLB smaller and cheaper to animate without changing how it looks.
// The converter keys every bone's position, rotation and scale on every frame of every clip, but most of those never
// move: a channel whose every key equals the bone's rest value is dropped (the bone simply stays at rest), and what is
// left is repacked. Lossless to within `EPS`.   node tools/slim_glb.mjs [--check] file.glb ...   (--check: report only)
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const EPS = 1e-4, check = process.argv.includes('--check');
// --trim cheer=6,idle=4 keeps only the first so-many seconds of those clips (the game loops them back and forth)
const trimArg = process.argv.find((a) => a.startsWith('--trim=')), TRIM = Object.fromEntries((trimArg ? trimArg.slice(7).split(',') : []).map((t) => t.split('=')).map(([k, v]) => [k, Number(v)]));
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const REST = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
let before = 0, after = 0;

for (const file of files) {
  const buf = readFileSync(file), jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
  const bin = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + buf.readUInt32LE(20 + jsonLen));
  const floats = (ai) => { const a = json.accessors[ai], v = json.bufferViews[a.bufferView]; return new Float32Array(bin.buffer.slice(bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0) + a.count * NUM[a.type] * 4)); };
  let dropped = 0, kept = 0;
  for (const an of json.animations || []) {
    an.channels = an.channels.filter((c) => {
      const s = an.samplers[c.sampler], path = c.target.path, rest = json.nodes[c.target.node][path] || REST[path];
      if (!REST[path] || json.accessors[s.output].componentType !== 5126) { kept++; return true; }
      const out = floats(s.output), n = rest.length;
      // a rotation and its negative are the same turn
      const same = (sign) => { for (let i = 0; i < out.length; i++) if (Math.abs(out[i] * sign - rest[i % n]) > EPS) return false; return true; };
      if (same(1) || (path === 'rotation' && same(-1))) { dropped++; return false; }
      kept++; return true;
    });
    // keep only the samplers still in use, renumbered
    const used = [...new Set(an.channels.map((c) => c.sampler))], map = new Map(used.map((s, i) => [s, i]));
    an.samplers = used.map((s) => an.samplers[s]);
    for (const c of an.channels) c.sampler = map.get(c.sampler);
  }
  // cut long clips short: fewer keys on every channel of that clip (times are floats; values keep their layout)
  for (const an of json.animations || []) {
    const secs = TRIM[an.name];
    if (!secs) continue;
    const keep = new Map(), cut = new Set();   // time accessor -> keys kept; value accessors already shortened
    for (const sm of an.samplers) {
      if (!keep.has(sm.input)) {
        const inA = json.accessors[sm.input], t = floats(sm.input);
        let n = 0; while (n < t.length && t[n] <= secs + 1e-6) n++;
        keep.set(sm.input, n >= 2 && n < t.length ? n : 0);
        if (keep.get(sm.input)) { inA.count = n; inA.max = [t[n - 1]]; inA.min = [t[0]]; }
      }
      const n = keep.get(sm.input);
      if (n && !cut.has(sm.output)) { cut.add(sm.output); const outA = json.accessors[sm.output]; outA.count = n; delete outA.min; delete outA.max; }
    }
  }
  // repack: keep only the accessors something still points at, each in its own tight view; rotations become 16-bit
  const useA = new Set(), rot = new Set();
  for (const m of json.meshes || []) for (const p of m.primitives) { for (const v of Object.values(p.attributes)) useA.add(v); if (p.indices !== undefined) useA.add(p.indices); for (const t of p.targets || []) for (const v of Object.values(t)) useA.add(v); }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) useA.add(s.inverseBindMatrices);
  for (const an of json.animations || []) { for (const s of an.samplers) { useA.add(s.input); useA.add(s.output); } for (const c of an.channels) if (c.target.path === 'rotation' && an.samplers[c.sampler].interpolation !== 'CUBICSPLINE') rot.add(an.samplers[c.sampler].output); }
  const order = [...useA].sort((a, b) => a - b), aMap = new Map(order.map((a, i) => [a, i]));
  const chunks = [], views = [], accessors = []; let off = 0;
  const push = (bytes, extra) => { const pad = (4 - (bytes.length % 4)) % 4; chunks.push(bytes, Buffer.alloc(pad)); views.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...extra }); off += bytes.length + pad; return views.length - 1; };
  for (const ai of order) {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
    if (v.byteStride) throw new Error('interleaved buffers are not handled');
    const start = (v.byteOffset || 0) + (a.byteOffset || 0), len = a.count * NUM[a.type] * COMP[a.componentType];
    let bytes = bin.subarray(start, start + len), na = { ...a, byteOffset: undefined };
    if (rot.has(ai) && a.componentType === 5126 && a.type === 'VEC4') {
      const f = floats(ai), q = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
      bytes = Buffer.from(q.buffer); na = { ...na, componentType: 5122, normalized: true, min: undefined, max: undefined };
    }
    na.bufferView = push(bytes, v.target ? { target: v.target } : {});
    accessors.push(JSON.parse(JSON.stringify(na)));
  }
  for (const im of json.images || []) if (im.bufferView !== undefined) { const v = json.bufferViews[im.bufferView]; im.bufferView = push(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength), {}); }
  const fix = (a) => aMap.get(a);
  for (const m of json.meshes || []) for (const p of m.primitives) { for (const k of Object.keys(p.attributes)) p.attributes[k] = fix(p.attributes[k]); if (p.indices !== undefined) p.indices = fix(p.indices); for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = fix(t[k]); }
  for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = fix(s.inverseBindMatrices);
  for (const an of json.animations || []) for (const s of an.samplers) { s.input = fix(s.input); s.output = fix(s.output); }
  json.accessors = accessors;
  json.bufferViews = views;
  json.buffers = [{ byteLength: off }];
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const body = Buffer.concat(chunks), head = Buffer.alloc(12), h1 = Buffer.alloc(8), h2 = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
  h1.writeUInt32LE(js.length, 0); h1.writeUInt32LE(0x4e4f534a, 4); h2.writeUInt32LE(body.length, 0); h2.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([head, h1, js, h2, body]);
  before += buf.length; after += out.length;
  console.log(`${file}: ${(buf.length / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB, channels ${dropped + kept} -> ${kept}`);
  if (!check && out.length < buf.length) { writeFileSync(file + '.tmp', out); renameSync(file + '.tmp', file); }
}
console.log(`total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
