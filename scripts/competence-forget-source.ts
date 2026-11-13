/**
 * Remove everything one connector put in the competence register (D108 item 9): the rows copied from it, its mappings
 * to the catalogue and the record of its reads. The database does the same when an administrator removes the connector
 * under Anslutna system (the tables refer to the connector's row with `ON DELETE CASCADE`); this is the operator's way
 * for a connector that stays registered but should no longer be copied, and the next read copies it again unless it is
 * switched off. Audited (`competence.source_forgotten`, counts only) with the actor `operator:cli`. It cannot be undone,
 * so it needs `--confirm`. Runs inside the app container with the server's local settings (DATABASE_URL).
 *
 *   bun scripts/competence-forget-source.ts --connector <id> --confirm
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { competence } from '../apps/server/src/composition/competence';
import { OPERATOR } from './competence-seed';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const at = args.indexOf('--connector');
const connectorId = at >= 0 ? args[at + 1] : undefined;
if (!connectorId || connectorId.startsWith('--')) {
  console.error('Usage: bun scripts/competence-forget-source.ts --connector <id> --confirm');
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Forgetting "${connectorId}" removes every holding copied from it and its mappings, and cannot be undone. Run again with --confirm.`,
  );
  process.exit(2);
}
try {
  const forgotten = await competence.forgetSource(OPERATOR, connectorId);
  console.log(
    `Forgot "${connectorId}" in the competence register: ${forgotten.holdings} copied holdings and ${forgotten.mappings} mappings removed.`,
  );
} catch (error) {
  console.error(`Could not forget: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
