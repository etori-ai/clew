import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate as apply } from 'drizzle-orm/postgres-js/migrator';
import { database } from '../../packages/db/src/index';

/** The repository's migrations, as `bun run db:init` applies them. */
export const MIGRATIONS = resolve(import.meta.dir, '../../packages/db/migrations');
/**
 * An entry of Drizzle's journal. Drizzle's migrator (drizzle-orm 0.45.4) reads the latest `created_at` it recorded and
 * runs, in one transaction, every entry whose `when` is later; it records the hash of each file it runs and never
 * compares one.
 */
export interface Entry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
/** The repository's journal entries, oldest first. */
export const journal = async () =>
  (JSON.parse(await readFile(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: Entry[] }).entries;
/** Where the repository's migration `<number>_<name>` stands in `entries`. */
export function position(entries: Entry[], name: string) {
  const at = entries.findIndex(e => e.tag.endsWith('_' + name));
  if (at < 0) throw new Error(`The migration ${name} is not in the journal.`);
  return at;
}
const connect = (url: string) => drizzle({ connection: { url, max: 2, onnotice: () => undefined } });
/** A database of a test's own to upgrade, and the way to remove it. */
export interface UpgradeDatabase {
  db: ReturnType<typeof connect>;
  /**
   * Migrate it with the repository's folder, as `bun run db:init` does, or with a folder of `entries` copied from it in
   * which a tag that `extra` names holds that text instead.
   */
  migrate(entries?: Entry[], extra?: Record<string, string>): Promise<void>;
  /** Close its connections, drop it and remove the folders written for it. */
  drop(): Promise<void>;
}
/**
 * An empty database created beside the suite's, on the same server, to be migrated step by step and upgraded with rows
 * in it, or migrated at once to hold rows whose statistics a test controls. The caller drops it when its tests end.
 */
export async function upgradeDatabase(): Promise<UpgradeDatabase> {
  const name = 'clew_test_upgrade_' + randomUUID().replaceAll('-', '').slice(0, 12),
    url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/' + name;
  await database().execute(sql.raw(`create database ${name}`));
  const db = connect(url.toString()),
    folders: string[] = [];
  return {
    db,
    async migrate(entries, extra = {}) {
      if (!entries) return apply(db, { migrationsFolder: MIGRATIONS });
      const dir = await mkdtemp(join(tmpdir(), 'clew-upgrade-'));
      folders.push(dir);
      await mkdir(join(dir, 'meta'));
      const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
      await writeFile(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries)
        if (extra[entry.tag] !== undefined) await writeFile(join(dir, entry.tag + '.sql'), extra[entry.tag]!);
        else await copyFile(join(MIGRATIONS, entry.tag + '.sql'), join(dir, entry.tag + '.sql'));
      await apply(db, { migrationsFolder: dir });
    },
    async drop() {
      await db.$client.end();
      await database().execute(sql.raw(`drop database if exists ${name} with (force)`));
      for (const dir of folders) await rm(dir, { recursive: true, force: true });
    },
  };
}
