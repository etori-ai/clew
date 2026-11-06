// Where the fixture keeps its own records: a small key-value store of JSON values with one transaction, behind a port.
// `sqliteState` is the service's (node:sqlite, WAL, full synchronous durability, so a restart finds every write);
// `memoryState` is for the unit tests and the documentation smoke, which run under Bun, where node:sqlite does not exist.
// Nothing of this state is in Clew: Clew holds refs, decisions and receipts, the source holds the records (D21).

export function memoryState() {
  const map = new Map();
  return {
    get: (key, fallback) => (map.has(key) ? structuredClone(map.get(key)) : fallback),
    set(key, value) {
      map.set(key, structuredClone(value));
    },
    delete(key) {
      map.delete(key);
    },
    keys: prefix => [...map.keys()].filter(key => key.startsWith(prefix)),
    /** All or nothing, as the SQLite transaction is: a throw restores the store to what it was. */
    transaction(fn) {
      const before = new Map(map);
      try {
        return fn();
      } catch (error) {
        map.clear();
        for (const [key, value] of before) map.set(key, value);
        throw error;
      }
    },
    close() {},
  };
}

export async function sqliteState(path) {
  if (!path) throw new Error('A persistent SQLite path is required (FIXTURE_DB)');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  );
  const read = db.prepare('SELECT value FROM kv WHERE key = ?');
  const write = db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const remove = db.prepare('DELETE FROM kv WHERE key = ?');
  const list = db.prepare('SELECT key FROM kv WHERE key >= ? AND key < ? ORDER BY key');
  let open = false;
  return {
    get(key, fallback) {
      const row = read.get(key);
      return row ? JSON.parse(row.value) : fallback;
    },
    set(key, value) {
      write.run(key, JSON.stringify(value));
    },
    delete(key) {
      remove.run(key);
    },
    keys: prefix => list.all(prefix, prefix + '￿').map(row => row.key),
    transaction(fn) {
      if (open) return fn();
      open = true;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        open = false;
      }
    },
    close() {
      db.close();
    },
  };
}
