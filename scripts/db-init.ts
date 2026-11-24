import { database, closeDatabase } from '@clew/db';
import { migrationGaps } from '@clew/db/migrations';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrateDurable } from '../apps/server/src/dbos/runtime';
import { resolve } from 'node:path';
/**
 * Clew's schema, then the durable engine's (D85, D86): the engine checkpoints to the `dbos` schema of the same
 * database, and the store adapters call its `dbos.enqueue_workflow` inside their transactions, so the schema must exist
 * before the first write, not only once the engine has launched. Drizzle runs only the migrations newer than the newest
 * it has recorded, so before anything runs, every migration of the journal at or below that one is looked for among
 * the recorded ones (DE-L13): a database that lacks one is refused, by name, and nothing is migrated, so no later
 * migration is applied over the gap. A recorded migration the journal lacks, another branch's on a database branches
 * share, is named in a warning and left as it is.
 */
const migrationsFolder = resolve(import.meta.dir, '../packages/db/migrations');
async function initialize() {
  const { missingBaseline, skipped, unknown } = await migrationGaps(database(), migrationsFolder);
  if (missingBaseline) {
    console.error(
      'This database has a different migration baseline. Keep the existing database and its backup. ' +
        'Point DATABASE_URL at a fresh database and run db:init there. Nothing was migrated.',
    );
    process.exitCode = 1;
    return;
  }
  for (const at of unknown)
    console.warn(
      `This database has applied a migration that this checkout's journal does not have (recorded with created_at ` +
        `${at}, ${new Date(at).toISOString()}), probably another branch's. It is left as it is.`,
    );
  if (skipped.length) {
    const one = skipped.length === 1;
    console.error(
      `This database has not applied ${one ? 'the migration' : 'the migrations'} ${skipped.join(', ')}, ` +
        'though it has applied a later one, so Drizzle will never run ' +
        (one ? 'it' : 'them') +
        ' (it runs only migrations newer than the newest it has recorded). This happens when a branch with a later ' +
        'migration was applied to this database first. Recreate the database, or apply the missing SQL from ' +
        'packages/db/migrations by hand and record each migration in drizzle.__drizzle_migrations with its `when` ' +
        'from packages/db/migrations/meta/_journal.json as created_at, then run db:init again. Nothing was migrated.',
    );
    process.exitCode = 1;
  } else {
    await migrate(database(), { migrationsFolder });
    console.log('Migrations applied.');
    await migrateDurable(process.env.DATABASE_URL!);
    console.log('Durable engine schema (dbos) ready.');
  }
}
try {
  await initialize();
} finally {
  await closeDatabase();
}
