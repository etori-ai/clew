/**
 * Erase one person from the follow-up dialogue (D118): their id on every assessment and activity (author, owner, added
 * by, done by) and the cards of the activities they owned. The records about the units stay. Runs inside the app
 * container with the server's local settings (DATABASE_URL); no route and no `package.json` entry. Audited
 * (`dialogue.person_erased`, counts only) with the actor `operator:cli`. It cannot be undone, so it needs `--confirm`.
 *
 *   bun scripts/dialogue-erase.ts --person <person id> --confirm
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { dialogue } from '../apps/server/src/composition/dialogue';
import { OPERATOR } from './talk-round';

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
  console.error('Usage: bun scripts/dialogue-erase.ts --person <person id> --confirm');
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Erasing person "${personId}" from the follow-up dialogue removes them from every assessment and activity and removes the cards of the activities they own, and cannot be undone. Run again with --confirm to erase.`,
  );
  process.exit(2);
}
try {
  const erased = await dialogue.erasePerson(OPERATOR, personId);
  console.log(
    `Erased person "${personId}" from the follow-up dialogue: ${erased.cleared} records cleared, ${erased.cards} cards removed.`,
  );
} catch (error) {
  console.error(`Could not erase: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
