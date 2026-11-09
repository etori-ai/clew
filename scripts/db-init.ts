import { database, closeDatabase } from '@clew/db';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { migrateDurable } from '../apps/server/src/dbos/runtime';
import { resolve } from 'node:path';
/**
 * Clew's schema, then the durable engine's (D85, D86): the engine checkpoints to the `dbos` schema of the same
 * database, and the store adapters call its `dbos.enqueue_workflow` inside their transactions, so the schema must exist
 * before the first write, not only once the engine has launched.
 */
try {
  await migrate(database(), { migrationsFolder: resolve(import.meta.dir, '../packages/db/migrations') });
  console.log('Migrations applied.');
  await migrateDurable(process.env.DATABASE_URL!);
  console.log('Durable engine schema (dbos) ready.');
} finally {
  await closeDatabase();
}
