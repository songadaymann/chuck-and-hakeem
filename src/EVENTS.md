# What the game announces, and what add-ons may call

Add-ons live in `src/plugins/<name>.js` (`export function init(game)`, may return `{ update(dt) }`) and in
`src/scenery/mods/` (`export async function build(game)`). They listen on the bus and call the small API below; they
never edit the core files. `game.bus.on(type, fn)` returns an unsubscribe function. Listeners must be cheap and must
not throw. Positions are world metres (+Y up). The Capitol's west front faces +Z; north is -X (Senate, Chuck).

## Events

| event | data | when |
| --- | --- | --- |
| `start` | | Play was pressed (check `game.started` too: an add-on may load after it) |
| `bite` | `x, z, tier, tool` | your tool came down at this spot, whether or not it found dirt |
| `dig` | `x, y, z, r, vol, tier, tool` | that bite removed dirt; `vol` is the full-strength cubic metres credited |
| `denied` | `x, z, left` | a bite was refused by the health-insurance deductible |
| `toolUp` | `tier, tool, quiet` | a new tool was unlocked (`quiet`: restored on load, not earned just now) |
| `hurt` | `lobby, effect, hp` | a lobbyist's shot hit you (`effect`: hasbara, deductible, pricehike, slick, buyout, tos) |
| `dead` / `respawn` | `why, lobby?` | you went down (`why`: lobbied or pricehike) / you are back, at the foot of your pile |
| `cheer` | `x, y, z, self?` | someone threw their arms up: you (key E, `self`) or bystanders in the scenery |
| `shot` | `agent, lobby, x, y, z` | a lobbyist threw something |
| `whack` | `agent, x, y, z, down` | you swatted a lobbyist (`down`: that finished them) |
| `splat` | `agent, x, y, z` | you drove over one |
| `agentSpawn` / `agentDown` | `agent, lobby` (+ `mound` / `x, y, z`) | a lobbyist walked out of a mound / was removed; `agent.pos` is where |
| `moundOpen` / `moundHit` / `moundDown` | `mound, quiet?, hp?, was?` | `mound` has `x, z, lobby, hp, root`. The game calls an open mound a lobby's "nest" in its messages |
| `milestone` | `giant, at, msg` | a pile passed 10 / 25 / 50 / 75 / 90 % |
| `giant` | `i, giant, status, was` | one of the men changed state: `status` is `dug` (out: he floats away) or `lost` (his clock ran out) |
| `clock` | `i, giant, secs` | a man's clock passed 24 h, 1 h or 10 min to go |
| `toast` | `msg, secs, pri` | the big centre-screen line changed |
| `cells` | `giant, field, pairs` | the server sent dirt other people dug: `pairs` is `[cell, cm, cell, cm, ...]`; cell `k` is at `field.x0 + (k % field.n) * field.cell`, `field.z0 + floor(k / field.n) * field.cell` |
| `dirtBomb` | `id, i, lobby, start, hit, end, late` | a lobby is airdropping dirt onto pile `i` (times are this browser's `Date.now()`; `late`: we joined after the warning). Nobody digs from `start` to `end` (see `game.storming()`) |
| `regrow` | `giant, field` | a dirt bomb landed: the pile is swelling back up to the server's new copy |
| `online` | `count, room, back` | connected to the shared dig (`back`: this is a reconnect) |
| `join` / `leave` | `sid, name` | someone entered / left your room |
| `remoteDig` | `x, y, z, tier, tool, near` | another player's bite landed (`near`: they are drawn with a full body) |
| `remoteTool` | `remote, sid, name, tier, tool` | another player in your room earned a tool |
| `remoteDown` | `remote, sid, name` | another player was knocked out by lobbyists |
| `remoteCheer` | `remote, sid` | another player cheered |
| `remoteFx` | `remote, sid, effect` | another player came under (or out of: `effect` is `''`) a lobby effect |
| `called` | `chamber, party, state` | you logged a phone call to a member of Congress (emitted by the reps add-on; the core sends it to the server) |
| `honk` | `x, y, z, kind` | a vehicle in the street honked or rang at you (emitted by the traffic scenery) |
| `pigeons` | `x, y, z` | the pigeon flock took off (emitted by the people scenery) |
| `ding` | `x, y, z, kind?` | a bell: a bicycle in the traffic scenery, or a flagpole struck (emitted by the juice add-on) |
| `giantSay` | `i, giant, text, secs` | one of the men said something (emitted by the giants add-on) |
| `over` | `won, out, status` | the end screen came up |

## State you may read

`game.player` (`pos`, `yaw`, `camYaw`, `vel`, `tier`, `toolIndex`, `toolCfg`, `digging`, `fighting`, `moving`, `inVehicle`, `hp`, `fx`, `deductible`, `dead`, `safe`, `dug`, `name`, `avatar`),
`game.fields[i]` (`progress`, `giant`, `heightAt(x, z)`, `floorAt(x, z)`, `inside(x, z)`), `game.giants[i]` (`root`, `head`, `cfg`, `sign`, `was`),
`game.lobby` (`mounds`, `agents`, `moundsLeft`), `game.net` (`online`, `everOnline`, `full`, `count`, `remotes`: Map of `{ sid, name, char, tier, flags, pos, yaw, avatar }`),
`game.surface(x, z)`, `game.status(i)` (`buried` / `dug` / `lost`), `game.supercharged(i)`, `game.clock(i)`, `game.deadlines[i]`, `game.time` (seconds of game time), `game.started`, `game.over`, `game.solo`,
`game.tot` (cubic metres everyone has dug, ever), `game.dg[i]` (people digging each pile right now), `game.calls` (calls to Congress logged by all players),
`game.bomb` (the dirt bomb in progress or null), `game.bombs` (how many have been dropped), `game.storming()` (true while one is on: nobody digs),
`game.lastVisit` (`{ seen, pct }` from the previous session on this device, or null), `game.sceneryMods.<name>` (what each scenery module returned, e.g. `traffic.vehicles`, `sky.flyers`), `game.plugins.<name>`.

## Things you may call

- `game.hud.toast(msg, secs, pri)`: the big line. pri 0 status effects, 1 lobby news, 2 milestones, 3 new tool, 4 a man out. A lower pri never overwrites a higher one still showing.
- `game.hud.pop(text, x, y, z, cls)`: a small word that floats up from a world position. cls: `''`, `'dim'` (quiet, for other people's things), `'loud'`.
- `game.hud.say(text, x, y, z, secs, cls)`: a speech bubble pinned to a world position (follows the camera). cls `'lobby'` for the dark variant. Returns the element.
- `game.hud.feed(text)`: a line in the small crowd-news list (top right, 4 lines, 6 s each).
- `game.hud.stamp(text)`: the red rubber stamp. `game.hud.later(el, secs)`: remove an element after game-time seconds (use this, not setTimeout, so recordings stay in step).
- `game.puff(x, y, z, n, spread, color)`: n flying clods; `color` optional (a hex number or an array of them) for water, paper, confetti. They live until they land.
- `game.shake = Math.max(game.shake, metres)`: camera shake, dies away by itself. Keep it small (0.05 to 0.4; over 1 only for the biggest moments).
- `avatar.cheer(secs)`: arms up (`game.player.avatar`, or a remote's `r.avatar`). People in vehicles keep driving.
- `game.giants[i].turn` / `.nod`: extra head yaw / pitch in radians added to the giant's idle sway each frame (set them every frame you want them; reset to 0 when done).
- `game.plugins.audio?.play(name, { x, y, z, vol, pan })` (names: the keys of MIX at the top of src/plugins/audio.js; unknown names are ignored); `game.plugins.giants?.say(i, text)`.
- Sound has two switches, both remembered on the device (the SOUND tab opens them; key M is all off / back again). `game.plugins.audio.muted`: the sound effects are off (everything the synthesiser makes: effects, the ambient bed, engines); `play` then does nothing. `game.plugins.audio.music`: the song, `{ on, playing, time, level, el, title, by }`. `on` is the player's switch; `playing` is whether it is sounding right now (it is not before Start, for `MUSIC_START` seconds after it, in the `MUSIC_GAP` between two plays, or in a hidden tab); `time` is seconds into the song, `level` its gain now (`MUSIC_LEVEL` once faded in), `el` the one `<audio>` element or null. Both `muted` and `music.on` may be set. Under `?capture` there is no sound at all: `muted` is true, `music.on` false, and nothing is created.
- `game.hud.says`: the live list of speech bubbles (`{ el, x, y, z, t }`); move a bubble by changing its x, y, z.
- `game.cam = { pos, look, fov? }` (free camera; null to give it back), `game.view = [fx, fy]` then `game.resize()` (slide the picture), `game.solids` (push `{ x0, x1, z0, z1 }`), `game.share(buttonEl)`.

Your own DOM goes inside `#hud` (children are `position: fixed; pointer-events: none` unless you set otherwise) or `document.body`; your own CSS in `src/plugins/<name>.css`, imported from your JS.
Use the look in `src/style.css`: `var(--px)` pixel font, `var(--big)` display font, `var(--yellow)`, `var(--ink)`, `var(--card)`, `var(--red)`, hard 3px borders and offset shadows, no rounded corners, no gradients except hazard stripes.
`?capture` in the URL means a recording is being stepped frame by frame: never use wall-clock timers for anything visible.
