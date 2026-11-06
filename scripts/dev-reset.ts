/**
 * Retire Clew's old fixture work before source storage is erased. fixtures-reset.sh owns service shutdown and reset.
 * Historical receipts are retained, uncertain outcomes stay unknown, and old decisions cannot run against fresh data.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { assertFixtureServerStopped, retireFixtureWork } from './fixture-maintenance';
try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
try {
  await assertFixtureServerStopped();
  if (!process.argv.includes('--check')) {
    if (!process.argv.includes('--sources-stopped'))
      throw new Error('Use bun run fixtures:reset so fixture services stop before their old work is retired.');
    console.log('Retired fixture work:', await retireFixtureWork());
  }
} finally {
  await closeDatabase();
}
