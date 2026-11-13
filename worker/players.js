import { DurableObject } from 'cloudflare:workers';

// Saved progress, keyed by the player's code. There are many of these objects (one per first two characters of
// the code), each a tiny SQLite table, so no single one is ever busy.
export class Players extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS p (code TEXT PRIMARY KEY, dug REAL NOT NULL, char TEXT, name TEXT, seen INTEGER)');
    // the player's other counts (CFG.badges), added 2026-11-13 to tables that may already hold players
    const have = new Set(sql.exec('PRAGMA table_info(p)').toArray().map((c) => c.name));
    for (const c of ['kills', 'nests', 'saves']) if (!have.has(c)) sql.exec(`ALTER TABLE p ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`);
  }
  load(code) {
    const rows = this.ctx.storage.sql.exec('SELECT dug, char, name, kills, nests, saves FROM p WHERE code = ?', code).toArray();
    return rows[0] || null;
  }
  // How many codes are saved here, and how many of them have dug at least a cubic metre (for the admin page's count).
  count() {
    const r = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n, COALESCE(SUM(dug >= 1), 0) AS d FROM p').toArray()[0];
    return { codes: r.n, digging: r.d };
  }
  // Adds what was dug since the last save and returns the new total. Adding (rather than overwriting) means two
  // connections on one code, or a reconnect that raced a stale one, can never erase each other's digging.
  // st: what was added to the other counts since the last save, [kills, nests, saves]. Returns every total.
  add(code, delta, char, name, st) {
    const d = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const [k, n, s] = [0, 1, 2].map((i) => (Array.isArray(st) && Number.isInteger(st[i]) && st[i] > 0 ? st[i] : 0));
    const rows = this.ctx.storage.sql.exec(
      'INSERT INTO p (code, dug, char, name, seen, kills, nests, saves) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET dug = dug + excluded.dug, char = excluded.char, name = excluded.name, seen = excluded.seen, kills = kills + excluded.kills, nests = nests + excluded.nests, saves = saves + excluded.saves RETURNING dug, kills, nests, saves',
      code, d, char, name, Date.now(), k, n, s).toArray();
    return rows[0] || { dug: d, kills: k, nests: n, saves: s };
  }
}
