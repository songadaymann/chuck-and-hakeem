# The launch-video shots

Upright clips (1080 x 1920, 30 fps) of the real game, staged by `src/plugins/director.js` and recorded one exact frame
at a time by `tools/shots.mjs`. 54 shots, 271 seconds in all. The table below is printed from the code
(`node tools/shots.mjs --list`); if the two disagree, the code is right.

## The framing rule

The presenter stands in front of the **bottom quarter** of the frame. So in every shot:

- whatever the shot is about sits in the **top 60%** of the frame;
- the bottom 25% is still the game (lawn, dirt, pavement, water), never black and never something you need to see;
- signs and name tags that matter are whole: either all the way in, or all the way out.

The director gets this by sliding the picture up (`game.view = [0, fy]`, each shot's `fy`) rather than by tilting the
camera at the sky. To check a shot by eye, add `--guide` (recorder) or `&guide` (browser): a dashed line marks 60% and
the hatched box is where the presenter stands.

## The 16:9 set

`node tools/shots.mjs --wide` records the same 54 takes as 1920 x 1080 clips into `shots/wide/` (same names, same
frame counts as the upright ones, so a cut made with one set can be swapped to the other clip for clip). In that set
the presenter sits in the **bottom right**, inside the right third of the frame, and each shot's subject is slid into
the left two thirds: the director shifts the picture left by 16% of its width (`fx`, per shot if it needs it), lifts
it only a little, and tightens every staged lens to 0.78 so the subject stays as big. The page is a 960 x 540 window
drawn at 2x, so shots that show the HUD show the desktop layout.

For a cut with nobody standing in it, `node tools/shots.mjs --wide --query 'fx=0' --out shots/wide-centred` records the
same takes with the subject centred (`&fx=` overrides the slide).

## The script and what covers it

1. "So I just made a game called Chuck And Hakeem Won't Leave." `title`
2. "Chuck Schumer and Hakeem Jeffries are giant heads that have buried themselves under huge mounds of dirt at the Capitol Building." `heads-wide`, `chuck-face`, `hakeem-face`
3. "You have a shovel. You have to start digging those stubborn old dudes out of there to make room for new leadership." `shovel-walk`, `shovel-dig`
4. "As you dig, you unlock better tools like ..." `tool-*` (ten clips, one framing, 3 s each: they cut as a montage), `new-tool`, `tool-ladder` (all ten in one take)
5. "This is a real game you can play right now at mann.cool/leave." `play-phone`, `url-card`
6. "But you're not alone. It's an online multiplayer game ..." `crowd-swarm`, `crowd-aerial`, `crowd-join`
7. "While you dig, you can even enter your zip code and call your reps ..." `reps-panel` (skipped, and reported as skipped, if the reps add-on is not loaded)
8. "But be careful! ... all the lobbyists and super PACs will come out of the woodwork ..." `mound-*` (one per lobby: sign, lobbyists, their attack flying at the lens), `hit-*` (one per lobby: you get hit and the effect shows)
9. "The lobbyists will attack and slow down your digging until you find their nest and destroy it." `bonk`, `splat`, `mound-smash`
10. "We have less than a week to dig Jeffries out ..." `clocks`, `clock-hakeem`, `clock-chuck`
11. "You can play right now at mann.cool/leave. So get digging! And call your reps." `closing-wide`, `capitol-front`, `url-card`, and the bonuses `timelapse` and `win`

B-roll of the world: `broll-*`.

## The shots

| name | beat | seconds | in the top of the frame | HUD |
| --- | --- | --- | --- | --- |
| `title` | 1 | 5 | the title placard over the Capitol with both piles and both heads | off |
| `heads-wide` | 2 | 5 | both buried giants in one frame: Chuck's head near, Hakeem's beyond, the dome between | off |
| `chuck-face` | 2 | 4 | CHUCK's head sticking out of the top of his pile, looking about (tight: his sign is out of frame) | off |
| `hakeem-face` | 2 | 4 | HAKEEM's head sticking out of the top of his pile, looking about (tight: his sign is out of frame) | off |
| `shovel-walk` | 3 | 4.5 | you, with a shovel, running across the lawn at Hakeem's pile and starting to dig: the pile, his head and his clock tower over you | off |
| `shovel-dig` | 3 | 5 | over your shoulder: you digging into the foot of Hakeem's pile with the shovel, dirt flying | off |
| `tool-shovel` | 4 | 3 | the shovel biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-pickaxe` | 4 | 3 | the pickaxe biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-jackhammer` | 4 | 3 | the jackhammer biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-trencher` | 4 | 3 | the trencher biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-skid_steer` | 4 | 3 | the skid steer biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-backhoe_loader` | 4 | 3 | the backhoe biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-excavator` | 4 | 3 | the excavator biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-bulldozer` | 4 | 3 | the bulldozer biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-mining_shovel` | 4 | 3 | the mining shovel biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `tool-bucket_wheel_excavator` | 4 | 3 | the bucket-wheel excavator biting into a wall of dirt at Hakeem's pile (same framing for all ten) | off |
| `new-tool` | 4 | 4.5 | the NEW TOOL moment: the shovel bar fills, the toast lands, a pickaxe appears in your hands | on |
| `tool-ladder` | 4 | 10.5 | the whole ladder in one take: a new tool every second, shovel to bucket-wheel excavator, the camera craning back as they grow | off |
| `play-phone` | 5 | 6 | the real phone screen: thumb stick, DIG button, HUD, and you running up to Hakeem's pile and digging | on |
| `url-card` | 5 | 4 | the mann.cool/leave placard over a busy dig at Hakeem's pile | off |
| `crowd-swarm` | 6 | 6 | dozens of players with name tags and every kind of tool swarming Hakeem's pile, seen from among them | off |
| `crowd-aerial` | 6 | 7 | from the air: Chuck's pile crawling with diggers and machines, dirt flying everywhere | off |
| `crowd-join` | 6 | 6 | a stream of new players setting off from where they arrive, across the lawn to Chuck's pile | off |
| `reps-panel` | 7 | 7 | the CALL YOUR REPS panel: a ZIP is typed and the House member and senators come up with their numbers | on |
| `mound-aipac` | 8 | 4.5 | the AIPAC mound, its sign readable, lobbyists walking out with briefcases and throwing "TALKING POINT" at the lens | off |
| `mound-insurance` | 8 | 4.5 | the HEALTH INSURANCE mound, its sign readable, lobbyists walking out with briefcases and throwing "DEDUCTIBLE" at the lens | off |
| `mound-pharma` | 8 | 4.5 | the BIG PHARMA mound, its sign readable, lobbyists walking out with briefcases and throwing "PRICE HIKE" at the lens | off |
| `mound-oil` | 8 | 4.5 | the BIG OIL mound, its sign readable, lobbyists walking out with briefcases and throwing "OIL" at the lens | off |
| `mound-wallst` | 8 | 4.5 | the WALL STREET mound, its sign readable, lobbyists walking out with briefcases and throwing "BUYOUT" at the lens | off |
| `mound-tech` | 8 | 4.5 | the BIG TECH mound, its sign readable, lobbyists walking out with briefcases and throwing "TERMS" at the lens | off |
| `hit-aipac` | 8 | 5.5 | AIPAC lobbyists hit you with "TALKING POINT" and its effect shows on screen (hasbara) | on |
| `hit-insurance` | 8 | 5.5 | HEALTH INSURANCE lobbyists hit you with "DEDUCTIBLE" and its effect shows on screen (deductible) | on |
| `hit-pharma` | 8 | 5.5 | BIG PHARMA lobbyists hit you with "PRICE HIKE" and its effect shows on screen (pricehike) | on |
| `hit-oil` | 8 | 5.5 | BIG OIL lobbyists hit you with "OIL" and its effect shows on screen (slick) | on |
| `hit-wallst` | 8 | 5.5 | WALL STREET lobbyists hit you with "BUYOUT" and its effect shows on screen (buyout) | on |
| `hit-tech` | 8 | 5.5 | BIG TECH lobbyists hit you with "TERMS" and its effect shows on screen (tos) | on |
| `bonk` | 9 | 4.5 | you swatting lobbyists with the shovel in front of Chuck's pile: BONK, and they fly off in a flurry of paper | off |
| `splat` | 9 | 5.5 | you driving a bulldozer up the centre walk through a line of lobbyists: SPLAT, SPLAT, SPLAT, the Capitol ahead | off |
| `mound-smash` | 9 | 6.5 | an excavator battering the Big Pharma mound until it shudders into the ground: MOUND FLATTENED | on |
| `clocks` | 10 | 5 | both countdown signs: Hakeem's (days left) near, Chuck's beyond | off |
| `clock-hakeem` | 10 | 4 | HAKEEM's countdown sign, readable, over his head | off |
| `clock-chuck` | 10 | 4 | CHUCK's countdown sign, readable, over his head | off |
| `closing-wide` | 11 | 8 | the big closing wide from behind the dome: both piles, the crowd, the lawn, the Mall and the Washington Monument | off |
| `capitol-front` | 11 | 6 | the west front head on: dome, both piles and heads, crowds on both | off |
| `timelapse` | 11 | 9 | time-lapse: Hakeem's pile drops away around him until the whole bust stands clear | off |
| `win` | 11 | 9 | the win: the dug-out giants lift off and float away like parade balloons, one after the other | off |
| `broll-street` | b-roll | 5 | First Street in front of the lawn: traffic passing, the dome and a pile behind | off |
| `broll-cyclists` | b-roll | 5 | the path beside the reflecting pool: people and bicycles, the Capitol beyond | off |
| `broll-mall` | b-roll | 5 | down the Mall: the elms, the drives and the Washington Monument | off |
| `broll-pool` | b-roll | 5 | low over the reflecting pool looking back at the Capitol and both piles | off |
| `broll-people` | b-roll | 5 | the centre walk up to the west steps: the welcome board, people on the lawn, the dome ahead | off |
| `broll-skyline` | b-roll | 6 | from the top of Chuck's pile: the lawn, the pool, the Mall and the city to the west | off |
| `broll-penn` | b-roll | 5 | Pennsylvania Avenue running off from Peace Circle toward the White House | off |
| `broll-east` | b-roll | 5 | the east front: the plaza behind the Capitol and the streets beyond it | off |

HUD "off" still shows what floats in the world: name tags, the two countdown signs, "+2.3 m³", BONK, speech bubbles,
and the centre-screen lines that tell the story (NEW TOOL, a lobby mobilising, a nest flattened, a milestone, a man
out, a lobby's effect). Coaching lines and statistics are kept off the screen in every shot. `play-phone` is the one
shot with the thumb stick and the DIG button showing (they sit under the presenter anyway); every other HUD-on shot
uses the phone layout without them.

## Recording

The dev server must be running (`npm run dev -- --port 8791`), and ffmpeg must be on the path (or `FFMPEG=/path/to/ffmpeg`).

```
node tools/shots.mjs                          # every shot, full length, into shots/ (about 200 MB; a few minutes, less with --concurrency 4)
node tools/shots.mjs --only title,tool-*      # some of them (a trailing * matches a family)
node tools/shots.mjs --only hit-* --hud both  # NAME.hud.mp4 and NAME.clean.mp4
node tools/shots.mjs --rh 320                 # chunkier pixels (6x instead of 4x)
node tools/shots.mjs --at 0.5,2,4 --dpr 1 --guide --out /tmp/look   # stills only, small, with the framing guide: for checking framing
node tools/shots.mjs --list                   # the table above, as JSON lines
```

Each shot becomes `shots/NAME.mp4` (H.264, yuv420p, crf 14, no smoothing: every game pixel is an exact 4 x 4 block at
the default `--rh 480`) and `shots/NAME.jpg` (a frame from the middle). One JSON line is printed per shot, with any
page errors or warnings; a shot that fails is reported and the rest carry on. `shots/` is in `.gitignore`.

Other flags: `--fps 30`, `--out DIR`, `--concurrency 2` (pages recording at once), `--seconds N` (cut every shot to N
seconds), `--cards off` (no title / address placards, to add them in the edit), `--now ISO` (the moment the clocks
pretend it is: default 2026-11-12 noon Eastern, under six days on Hakeem's clock), `--query 'mods=..&plugins=..'`.

Recordings are repeatable where it matters: the page's clock is game time (Date, timers and CSS animations advance
only when a frame is stepped, and every frame rolls its dice from its own seed), so the staging, the camera, the
clocks, the dirt, the lobbyists and the HUD come out the same every take. Ambient details that the scenery and other
add-ons decide for themselves while the page loads (a passer-by, a flock of pigeons, which remark a giant makes) can
differ from one take to the next: if one walks through a shot, record that shot again. They also change when the world
changes, so **record again after any change to the scenery or the add-ons**, and look at the stills first.

## Looking at a shot in the browser

- `http://localhost:8791/?solo&autostart&shot=NAME&guide` plays one shot live, with the framing guide.
- `?director` lists every shot as a link.
- `&hud=full` or `&hud=clean` overrides a shot's own choice; `&card=0` drops the placards; `&char=`, `&name=` and `&zip=` change the hero and the ZIP typed into the reps panel.
- `?crowd=40` (any mode, no shot) adds that many simulated players to both piles, to see a busy server. They exist only in your browser; the game still gives a full body only to the nearest 24 of them (12 on a phone).

## Adding or changing a shot

Everything is in the `SHOTS` table in `src/plugins/director.js`: a name, the script beat, seconds, `fy`, an optional
`setup(game, S)` that stages the scene through the game's own code, `act(T, game, S, dt)` for what happens each frame,
and a camera (`cam(T, game, S)`, a straight `path: [from, to]`, or `follow: true` for the real player camera).
Stage with the helpers there (`put`, `wear`, `bench`, `suit`, a `crowd: { n, piles, tiers, from }`), seed anything
random from `S.R`, and never read the wall clock. The lobby mounds are found by lobby id, never by position.
