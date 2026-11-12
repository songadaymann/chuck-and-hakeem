# Chuck & Hakeem Won't Leave

Chuck Schumer and Hakeem Jeffries have buried themselves at the Capitol and will not step aside. The whole country digs the same two piles, live, before their leadership votes. A low-poly, PS1-looking multiplayer satire by Jonathan Mann (Song A Day).

**Play:** https://mann.cool/leave/

## How it works

- **Client:** three.js, built with Vite (`index.html`, `src/`). Scenery is built in code (`src/scenery/`); add-ons hang off an event bus (`src/plugins/`, see `src/EVENTS.md`).
- **Server:** one Cloudflare Worker (`worker/`) with three Durable Objects: `World` (the two dirt piles, pacing, lobby mounds, national counters), `Room` (up to 80 players relayed over a WebSocket) and `Players` (each player's lifetime total, keyed by their progress code). `shared/` holds the rules both sides use.
- **mann.cool:** under `mann.cool/leave/` the Worker adds mann.cool's shared shell (home, tip, menu, the "Dirt moved" leaderboard). `src/board.js` posts a player's server-confirmed total to that leaderboard.
- **Models:** the tools, machines and Capitol are made by Blender scripts in `tools/models/`; the people are Microsoft Rocketbox avatars cut down by `tools/convert_rocketbox.py`.

## Run it locally

Needs Node 20 or newer.

```sh
npm install
cp .env.example .dev.vars        # then set ADMIN_KEY to any long random string
npm run serve                    # builds, then runs the Worker and game at http://localhost:8787/leave/
npm run dev                      # the client alone (Vite), which plays solo when no server answers
```

The two giants' heads are not in this repository (see [ASSETS.md](ASSETS.md)). `npm run dev` and `npm run build` put same-size placeholders in their place, so everything still runs.

Other tools: `node tools/simweek.mjs` (a crowd simulator for the pacing), `npm run loadtest` (bots against a local server), `tools/SHOTS.md` (the trailer shot recorder).

## Deploy

`npm run deploy` builds and deploys the Worker `dig-them-out` (routes `mann.cool/leave*`). It needs the real head files and the `ADMIN_KEY` secret (`wrangler secret put ADMIN_KEY`).

## License

Code: [MIT](LICENSE). Art, music and models: see [ASSETS.md](ASSETS.md) (ours are CC BY 4.0; Rocketbox people are MIT; Rubik Dirt is OFL).

This is satire. The lobbyists, their lines and the two giants' speech bubbles are parody, not quotations.
