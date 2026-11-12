// Add-ons that listen to the game instead of living inside it: sound, effects, the call-your-reps panel, the
// camera director. Each file here (except this one) exports `init(game)` and may return `{ update(dt) }`.
//   ?plugins=audio,juice loads only those; ?plugins=none loads nothing.
const mods = import.meta.glob(['./*.js', '!./index.js']);
const nameOf = (path) => path.replace(/^.*\//, '').replace(/\.js$/, '');

export async function loadPlugins(game) {
  const only = new URLSearchParams(location.search).get('plugins'), want = only ? only.split(',') : null, live = [];
  await Promise.all(Object.keys(mods).sort().map(async (path) => {
    const name = nameOf(path);
    if (want && !want.includes(name)) return;
    try { const m = await mods[path](); const r = await m.init(game); if (r && r.update) live.push({ name, update: r.update }); game.plugins[name] = r || {}; }
    catch (e) { console.warn('plugin failed:', name, e); }
  }));
  return { update(dt) { for (const m of live) { try { m.update(dt); } catch (e) { console.warn('plugin update failed:', m.name, e); m.update = () => {}; } } } };
}
