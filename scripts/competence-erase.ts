/**
 * Erase one person from the competence domain (D107 item 14): their holdings, and their id on the holdings they
 * registered or revoked for others. Runs inside the app container with the server's local settings (DATABASE_URL); no
 * route and no `package.json` entry. Audited (`competence.person_erased`, counts only) with the actor `operator:cli`.
 * It cannot be undone, so it needs `--confirm`.
 *
 *   bun scripts/competence-erase.ts --person <person id> --confirm
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
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const personId = option('person');
if (!personId || personId.startsWith('--')) {
  console.error('Usage: bun scripts/competence-erase.ts --person <person id> --confirm');
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Erasing person "${personId}" from the competence domain removes every holding they have and cannot be undone. Run again with --confirm to erase.`,
  );
  process.exit(2);
}
try {
  const erased = await competence.erasePerson(OPERATOR, personId);
  console.log(
    `Erased person "${personId}" from the competence domain: ${erased.holdings} holdings removed, ${erased.cleared} other holdings cleared of their id.`,
  );
} catch (error) {
  console.error(`Could not erase: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
