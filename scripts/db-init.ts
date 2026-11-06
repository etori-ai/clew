import { database, closeDatabase } from '@clew/db';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
try {
  await migrate(database(), { migrationsFolder: resolve(import.meta.dir, '../packages/db/migrations') });
  console.log('Migrations applied.');
} finally {
  await closeDatabase();
}
