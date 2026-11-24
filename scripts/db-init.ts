import { database, closeDatabase } from '@clew/db';
import { migrationsNotApplied } from '@clew/db/migrations';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrateDurable } from '../apps/server/src/dbos/runtime';
import { resolve } from 'node:path';
/**
 * Clew's schema, then the durable engine's (D85, D86): the engine checkpoints to the `dbos` schema of the same
 * database, and the store adapters call its `dbos.enqueue_workflow` inside their transactions, so the schema must exist
 * before the first write, not only once the engine has launched. Drizzle runs only the migrations newer than the newest
 * it has recorded, so every migration of the journal is then looked for among the recorded ones (DE-L13): a database
 * that lacks one is refused, by name, and nothing further runs.
 */
const migrationsFolder = resolve(import.meta.dir, '../packages/db/migrations');
try {
  await migrate(database(), { migrationsFolder });
  const missing = await migrationsNotApplied(database(), migrationsFolder);
  if (missing.length) {
    console.error(
      `This database has not applied ${missing.length === 1 ? 'the migration' : 'the migrations'} ${missing.join(', ')}, ` +
        'though it has applied a later one, so Drizzle will never run ' +
        (missing.length === 1 ? 'it' : 'them') +
        ' (it runs only migrations newer than the newest it has recorded). This happens when a branch with a later ' +
        'migration was applied to this database first. Recreate the database, or apply the missing SQL from ' +
        'packages/db/migrations by hand and record it in drizzle.__drizzle_migrations. The durable engine was not migrated.',
    );
    process.exitCode = 1;
  } else {
    console.log('Migrations applied.');
    await migrateDurable(process.env.DATABASE_URL!);
    console.log('Durable engine schema (dbos) ready.');
  }
} finally {
  await closeDatabase();
}
