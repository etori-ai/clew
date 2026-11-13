/**
 * Erase one person from introduction and leaving (D124): every plan about them with its items and their cards, the
 * cards of the items they own in other people's plans, and their id on other people's plans (buddy, started by, owner,
 * done by). Runs inside the app container with the server's local settings (DATABASE_URL); no route and no
 * `package.json` entry. Audited (`boarding.person_erased`, counts only) with the actor `operator:cli`. It cannot be
 * undone, so it needs `--confirm`.
 *
 *   bun scripts/boarding-erase.ts --person <person id> --confirm
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { boarding } from '../apps/server/src/composition/boarding';
import { OPERATOR } from './boarding-seed';

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
  console.error('Usage: bun scripts/boarding-erase.ts --person <person id> --confirm');
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Erasing person "${personId}" from introduction and leaving removes every plan about them and the cards of its items and of the items they own, and cannot be undone. Run again with --confirm to erase.`,
  );
  process.exit(2);
}
try {
  const erased = await boarding.erasePerson(OPERATOR, personId);
  console.log(
    `Erased person "${personId}" from introduction and leaving: ${erased.plans} plans and ${erased.items} items removed, ${erased.cleared} other records cleared, ${erased.cards} cards removed.`,
  );
} catch (error) {
  console.error(`Could not erase: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
