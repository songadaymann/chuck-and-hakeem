// Prints the live pacing numbers from the private control endpoint.  node tools/livecheck.mjs
import fs from 'fs';
const key = fs.readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/ADMIN_KEY=(.*)/)[1].trim().replace(/^"|"$/g, '');
const d = await (await fetch('https://dig-them-out.novox-robot.workers.dev/api/admin', { headers: { authorization: 'Bearer ' + key } })).json();
// maxPlayers, perIp, everDug, calls and onEachPile are undefined until the server that reports them has been deployed
console.log(JSON.stringify({ target: d.control.target, codeDefault: d.defaults.target, setByHand: d.setByHand.target ?? null, shovelBite: d.shovelMul.map((v) => +v.toPrecision(3)), online: d.online, rooms: d.rooms,
  maxPlayers: d.control.maxPlayers, perIp: d.control.perIp, dug: d.giants.map((g) => g.progress), everDug: d.tot, onEachPile: d.dg, calls: d.calls, moundsOpen: d.moundsOpen }));
