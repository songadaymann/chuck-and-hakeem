// Builds the data behind "CALL YOUR REPS" (src/plugins/reps.js): who sits in Congress today, their Washington office
// phones, and which congressional district(s) each ZIP code touches. Sources, licences and caveats: tools/REPS-DATA.md.
//   node tools/build_reps.mjs              download the five source files into assets-src/reps/ and rebuild public/data/reps/
//   node tools/build_reps.mjs --offline    rebuild from the copies already in assets-src/reps/
//   node tools/build_reps.mjs --check [zip,zip,...]   compare the built files with house.gov's own ZIP lookup (default: a fixed list)
// Node 22, no dependencies. Run it again whenever a seat changes hands, and after the next Congress is seated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets-src/reps'), OUT = path.join(ROOT, 'public/data/reps');
const CONGRESS = 119;
const SOURCES = {
  'MemberData.xml': 'https://clerk.house.gov/xml/lists/MemberData.xml',                           // Clerk of the House: every seat, vacancies included
  'senators_cfm.xml': 'https://www.senate.gov/general/contact_information/senators_cfm.xml',      // Secretary of the Senate
  'legislators-current.json': 'https://unitedstates.github.io/congress-legislators/legislators-current.json',   // second opinion on every phone; who caucuses with whom
  'tab20_cd11920_zcta520_natl.txt': 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt',   // Census: 2020 ZCTAs x 119th districts
  'state.txt': 'https://www2.census.gov/geo/docs/reference/state.txt',                            // Census: FIPS code -> postal code, name
};
const args = process.argv.slice(2);
const read = (f) => fs.readFileSync(path.join(RAW, f), 'utf8').replace(/^﻿/, '');
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}(?: [^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").replace(/\s+/g, ' ').trim() : ''; };
const digits = (p) => (p || '').replace(/\D/g, '');
// Only a number that looks like a Capitol Hill line is ever published; anything else falls back to the switchboard.
const phone = (p) => { const d = digits(p); return /^20222[456]\d{4}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : ''; };
const warn = [];

if (args.includes('--check')) { await check(args[args.indexOf('--check') + 1]); process.exit(0); }

fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const fetched = {};
if (!args.includes('--offline')) for (const [file, url] of Object.entries(SOURCES)) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (build_reps.mjs)' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(path.join(RAW, file), Buffer.from(await r.arrayBuffer()));
  fetched[file] = r.headers.get('last-modified') || '';
  console.log('downloaded', file, fetched[file] && `(last modified ${fetched[file]})`);
}

// ---- states
const fips = {}, states = {};
for (const l of read('state.txt').trim().split('\n').slice(1)) { const [code, usps, name] = l.split('|'); fips[code] = usps; states[usps] = name; }

// ---- the second opinion: congress-legislators, by Bioguide id
const second = new Map(JSON.parse(read('legislators-current.json')).map((p) => [p.id.bioguide, p.terms.at(-1)]));
const letter = (party) => ({ Democrat: 'D', Republican: 'R', Independent: 'I' }[party] || '');
function crossCheck(who, id, ph) {
  const t = second.get(id);
  if (!t) { warn.push(`${who} (${id}) is not in legislators-current: phone taken from the official list alone`); return ph; }
  if (digits(t.phone) !== digits(ph)) { warn.push(`${who} (${id}): phone differs between sources (${ph} / ${t.phone}): NOT published, the switchboard is offered instead`); return ''; }
  return ph;
}

// ---- House: one entry per seat, keyed like "NY08" ("AK00" at large, "DC00" delegate)
const xml = read('MemberData.xml'), house = {};
const published = (xml.match(/publish-date="([^"]+)"/) || [])[1] || '';
if (tag(xml, 'congress-num') !== String(CONGRESS)) throw new Error('the Clerk file is for another Congress: update CONGRESS and the Census file together');
for (const m of xml.split('<member>').slice(1)) {
  const st = (m.match(/postal-code="([A-Z]{2})"/) || [])[1], sd = tag(m, 'statedistrict'), id = tag(m, 'bioguideID'), kind = tag(m, 'district');
  const key = (st || sd.slice(0, 2)) + sd.slice(2);
  if (!/^[A-Z]{2}\d\d$/.test(key)) throw new Error('unreadable House seat: ' + sd);
  if (!id) { house[key] = { vacant: 1 }; continue; }
  const name = tag(m, 'official-name'), ph = crossCheck(name, id, phone(tag(m, 'phone')));
  if (!ph) warn.push(`${name} (${key}) has no usable phone`);
  house[key] = { n: name, l: tag(m, 'lastname'), p: tag(m, 'party'), c: tag(m, 'caucus') || tag(m, 'party'), ph, id };
  if (/Delegate|Commissioner/.test(kind)) house[key].t = kind;   // sits and speaks, no vote on the House floor
}

// ---- Senate: two per state, senior first
const senate = {};
for (const m of read('senators_cfm.xml').split('<member>').slice(1)) {
  const st = tag(m, 'state'), id = tag(m, 'bioguide_id'), t = second.get(id), party = tag(m, 'party');
  // senate.gov files a suffix under the first name: "Angus S., Jr." + "King"
  const [first, suffix] = tag(m, 'first_name').split(/,\s*/), name = `${first} ${tag(m, 'last_name')}${suffix ? ', ' + suffix : ''}`;
  const ph = crossCheck(name, id, phone(tag(m, 'phone')));
  if (!ph) warn.push(`${name} (${st}) has no usable phone`);
  (senate[st] ||= []).push({ n: name, l: tag(m, 'last_name'), p: party, c: letter(t?.caucus) || party, ph, id, junior: t?.state_rank === 'junior' ? 1 : 0 });
}
for (const st in senate) { senate[st].sort((a, b) => a.junior - b.junior || a.n.localeCompare(b.n)); for (const s of senate[st]) delete s.junior; if (senate[st].length !== 2) warn.push(`${st} has ${senate[st].length} senator(s) listed`); }
for (const [id, t] of second) if (!Object.values(house).some((h) => h.id === id) && !Object.values(senate).flat().some((s) => s.id === id)) warn.push(`${id} (${t.state} ${t.type}) is in legislators-current but not in the official lists`);

// ---- ZIP -> district(s). The Census file has one line per ZCTA x district overlap; "ZZ" is water outside every district.
const zips = new Map();
for (const l of read('tab20_cd11920_zcta520_natl.txt').trim().split('\n').slice(1)) {
  const c = l.split('|'), geo = c[1], zip = c[8], land = Number(c[15]);
  if (!zip || geo.endsWith('ZZ')) continue;
  const st = fips[geo.slice(0, 2)], d = geo.slice(2), key = st + (d === '98' ? '00' : d);
  if (!st || !house[key]) throw new Error(`ZIP ${zip}: district ${geo} has no seat in the Clerk's list`);
  if (!zips.has(zip)) zips.set(zip, []);
  zips.get(zip).push({ key, land });
}
const files = Array.from({ length: 10 }, () => ({}));
let split = 0;
for (const [zip, parts] of zips) {
  // an overlap with no land in it is open water: nobody votes from there. (If that is all there is, keep it.)
  const dry = parts.filter((p) => p.land > 0), keep = (dry.length ? dry : parts).sort((a, b) => b.land - a.land), total = keep.reduce((s, p) => s + p.land, 0);
  // one district: "NY12". Several: "CA32:62,CA36:38,CA30:0" = each with its share of the ZIP's land, biggest first.
  files[zip[0]][zip] = keep.length === 1 ? keep[0].key : keep.map((p) => `${p.key}:${total ? Math.round(p.land / total * 100) : 0}`).join(',');
  if (keep.length > 1) split++;
}
// ZIPs the Census does not draw (PO boxes, single buildings) still start like their neighbours. "008": "VI" means every
// drawn ZIP that starts 008 lies wholly in one state: enough to name the senators, never a House district.
const starts = {};
for (const [zip, parts] of zips) for (const p of parts) (starts[zip.slice(0, 3)] ||= new Set()).add(p.key.slice(0, 2));
const oneState = Object.entries(starts).filter(([, set]) => set.size === 1);
for (const [start, set] of oneState) files[start[0]][start] = [...set][0];

// ---- write
const members = { built: new Date().toLocaleDateString('en-CA'), congress: CONGRESS, clerkPublished: published, states, house, senate };
for (const f of fs.readdirSync(OUT)) if (/^(zip\d|members)\.json$/.test(f)) fs.rmSync(path.join(OUT, f));
fs.writeFileSync(path.join(OUT, 'members.json'), JSON.stringify(members));
files.forEach((o, d) => fs.writeFileSync(path.join(OUT, `zip${d}.json`), JSON.stringify(Object.fromEntries(Object.entries(o).sort()))));

const seats = Object.values(house), size = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + ' KB';
console.log(`House: ${seats.filter((h) => h.id).length} members, ${seats.filter((h) => h.vacant).length} vacant (${Object.keys(house).filter((k) => house[k].vacant).join(', ') || 'none'}); Clerk file published ${published}`);
console.log(`Senate: ${Object.values(senate).flat().length} senators in ${Object.keys(senate).length} states`);
console.log(`ZIPs: ${zips.size} (${split} touch more than one district); ${oneState.length} of ${Object.keys(starts).length} three-digit starts lie in one state`);
console.log(`members.json ${size('members.json')}; ` + files.map((_, d) => `zip${d} ${size(`zip${d}.json`)}`).join(', '));
console.log(warn.length ? `\n${warn.length} WARNING(S):\n  ` + warn.join('\n  ') : 'both member sources agree on every phone number');

// ---- --check: ask house.gov's "find your representative" about some ZIPs and compare the names it gives with ours.
// "random:N" picks N ZIPs from the built files. house.gov is one more opinion, not the truth: see tools/REPS-DATA.md.
async function check(list) {
  const mem = JSON.parse(fs.readFileSync(path.join(OUT, 'members.json'), 'utf8')), all = {};
  for (let d = 0; d < 10; d++) Object.assign(all, JSON.parse(fs.readFileSync(path.join(OUT, `zip${d}.json`), 'utf8')));
  let want = (list && !list.startsWith('--') ? list : '10001,11216,90210,60614,33139,78701,99501,82001,05401,20001,00901,96910,96799,00802,96950,30303,59601,73301,10004,80202').split(',');
  if (want[0].startsWith('random:')) { const keys = Object.keys(all).filter((k) => k.length === 5); want = Array.from({ length: Number(want[0].slice(7)) }, () => keys[Math.floor(Math.random() * keys.length)]); }
  // names only: accents, punctuation and "Jr." differ between the two sites
  const plain = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
  const tally = { same: 0, weListMore: 0, theyListMore: 0, other: 0, notOnFile: 0 };
  for (const zip of want) {
    const ours = (all[zip] || '').split(',').filter(Boolean).map((s) => s.split(':')[0]).filter((k) => mem.house[k].n);
    const html = await (await fetch('https://ziplook.house.gov/htbin/findrep_house?ZIP=' + zip, { headers: { 'user-agent': 'Mozilla/5.0 (build_reps.mjs --check)' } })).text();
    const theirs = [...(html.split('id="PossibleReps"')[1] || '').matchAll(/<a href="[^"]*">([^<\d]+?)\s*<\/a>/g)].map((m) => m[1]);
    const a = new Set(ours.map((k) => plain(mem.house[k].n))), b = new Set(theirs.map(plain));
    const aInB = [...a].every((n) => b.has(n)), bInA = [...b].every((n) => a.has(n));
    const verdict = !all[zip] ? 'notOnFile' : aInB && bInA ? 'same' : bInA ? 'weListMore' : aInB ? 'theyListMore' : 'other';
    tally[verdict]++;
    console.log(`${verdict.padEnd(12)} ${zip}  ours: ${ours.map((k) => `${k} ${mem.house[k].n}`).join(' | ') || (all[zip] ? '(vacant seat)' : '(not on file)')}   house.gov: ${theirs.join(' | ') || '(none)'}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(JSON.stringify(tally));
}
