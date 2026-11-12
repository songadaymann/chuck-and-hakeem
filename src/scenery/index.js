// Everything in the world that is only there to be looked at: ground, trees, the city in the distance, traffic,
// people, site dressing. Each file in mods/ exports `async build(game)` and may return `{ update(dt, game) }`.
// A module that fails to load or build is skipped with a warning, so one broken piece never takes the game down.
//   ?mods=trees,sky  loads only those (names are the file names without the number prefix); ?mods=none loads nothing.
const mods = import.meta.glob('./mods/*.js');
const nameOf = (path) => path.replace(/^.*\//, '').replace(/^\d+-/, '').replace(/\.js$/, '');

export async function buildScenery(game) {
  const only = new URLSearchParams(location.search).get('mods'), want = only ? only.split(',') : null, live = [];
  await Promise.all(Object.keys(mods).sort().map(async (path) => {
    const name = nameOf(path);
    if (want && !want.includes(name)) return;
    try { const m = await mods[path](); const r = await m.build(game); if (r && r.update) live.push({ name, update: r.update }); game.sceneryMods[name] = r || {}; }   // other add-ons can find e.g. game.sceneryMods.traffic.vehicles
    catch (e) { console.warn('scenery module failed:', name, e); }
  }));
  return { update(dt) { for (const m of live) { try { m.update(dt, game); } catch (e) { console.warn('scenery update failed:', m.name, e); m.update = () => {}; } } } };
}
