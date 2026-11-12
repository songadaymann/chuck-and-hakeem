// Which saved world the game uses. Changing ERA starts everything over: both piles full, every mound back, the national
// counters at zero and every player back to a shovel (old codes still work, but start from nothing). The old world is
// not deleted: it stays stored under its old name, so putting the old value back brings it all back.
// '' was the test world (2026-11-11 to 12). 'launch' is the public one, started 2026-11-12.
export const ERA = 'launch';
export const worldName = ERA ? 'world:' + ERA : 'world';
export const shardName = (code) => (ERA ? ERA + ':' : '') + code.slice(0, 2);
