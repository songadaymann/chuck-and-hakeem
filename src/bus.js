// A tiny event bus. The core game announces what happens (see EVENTS.md next to this file); sound, effects and
// other add-ons listen, so they never need to reach into the core files.
export function makeBus() {
  const subs = new Map();
  return {
    on(type, fn) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); return () => { const a = subs.get(type), i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; },
    emit(type, data) { const a = subs.get(type); if (a) for (const fn of a.slice()) { try { fn(data || {}); } catch (e) { console.warn('listener for', type, e); } } },
  };
}
