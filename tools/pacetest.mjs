import WebSocket from 'ws';
import fs from 'fs';
const key = fs.readFileSync('.dev.vars', 'utf8').match(/ADMIN_KEY=(.*)/)[1].trim().replace(/^"|"$/g, '');
const NB = Number(process.argv[2] || 1), SECS = Number(process.argv[3] || 120);
const admin = async () => (await fetch('http://localhost:8787/api/admin', { headers: { authorization: 'Bearer ' + key } })).json();
const bots = [];
for (let i = 0; i < NB; i++) {
  const b = { dug: 0, x: 50 + (Math.random() - 0.5) * 16, z: 10 + (Math.random() - 0.5) * 10 };
  const ws = new WebSocket('ws://localhost:8787/ws?name=' + encodeURIComponent('Tired Voter 42') + '&char=Male_Adult_01');
  ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d.toString()); if (m.t === 'hi') b.dug = m.dug; if (m.t === 'c') b.dug = m.dug; });
  ws.on('error', () => {});
  b.t = setInterval(() => { if (ws.readyState !== 1) return; b.x += (Math.random() - 0.5) * 3; b.z += (Math.random() - 0.5) * 3; b.x = Math.max(38, Math.min(62, b.x)); b.z = Math.max(2, Math.min(18, b.z)); ws.send(JSON.stringify({ p: [+b.x.toFixed(1), +b.z.toFixed(1), 3.1, 3], d: [[+b.x.toFixed(2), +(b.z - 1.2).toFixed(2), 1]] })); }, 300);
  b.ws = ws; bots.push(b);
}
let a0 = await admin(), last = a0.left[1];
console.log('start', JSON.stringify({ need: a0.needPerSec, speed: a0.speed, ahead: a0.ahead, prog: a0.giants.map(g => g.progress) }));
for (let t = 10; t <= SECS; t += 10) {
  await new Promise(r => setTimeout(r, 10000));
  const a = await admin(), p = a.left[1];
  console.log(t + 's', 'bot0 dug', bots[0].dug.toFixed(0), 'pile lost', ((last - p) / 10).toFixed(3) + ' m3/s', 'diggers', a.diggers[1].toFixed(2), 'shovelMul', a.shovelMul[1].toPrecision(3), 'ahead', (a.ahead[1] * 100).toFixed(4) + '%');
  last = p;
}
for (const b of bots) { clearInterval(b.t); b.ws.close(); }
setTimeout(() => process.exit(0), 500);
