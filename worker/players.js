import { DurableObject } from 'cloudflare:workers';

// Saved progress, keyed by the player's code. There are many of these objects (one per first two characters of
// the code), each a tiny SQLite table, so no single one is ever busy.
export class Players extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS p (code TEXT PRIMARY KEY, dug REAL NOT NULL, char TEXT, name TEXT, seen INTEGER)');
  }
  load(code) {
    const rows = this.ctx.storage.sql.exec('SELECT dug, char, name FROM p WHERE code = ?', code).toArray();
    return rows[0] || null;
  }
  // How many codes are saved here, and how many of them have dug at least a cubic metre (for the admin page's count).
  count() {
    const r = this.ctx.storage.sql.exec('SELECT COUNT(*) AS n, COALESCE(SUM(dug >= 1), 0) AS d FROM p').toArray()[0];
    return { codes: r.n, digging: r.d };
  }
  // Adds what was dug since the last save and returns the new total. Adding (rather than overwriting) means two
  // connections on one code, or a reconnect that raced a stale one, can never erase each other's digging.
  add(code, delta, char, name) {
    const d = Number.isFinite(delta) && delta > 0 ? delta : 0;
    const rows = this.ctx.storage.sql.exec(
      'INSERT INTO p (code, dug, char, name, seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET dug = dug + excluded.dug, char = excluded.char, name = excluded.name, seen = excluded.seen RETURNING dug',
      code, d, char, name, Date.now()).toArray();
    return rows[0] ? rows[0].dug : d;
  }
}
