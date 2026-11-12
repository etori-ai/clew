/**
 * Erase one person from the talks domain (D96 item 10): their talks and every action point about them, the cards of
 * those and of the ones they owned, and their id on other people's records. Runs inside the app container with the
 * server's local settings (DATABASE_URL); no route and no `package.json` entry. Audited (`talks.person_erased`, counts
 * only) with the actor `operator:cli`. It cannot be undone, so it needs `--confirm`.
 *
 *   bun scripts/talks-erase.ts --person <person id> --confirm
 *
 * A person is named by their id, never by a user name: an id the people table does not hold is refused, and nothing is
 * erased or audited. A person with nothing in the domain is still audited, with zero counts, and the script says so.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { talks } from '../apps/server/src/composition/talks';
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
  console.error('Usage: bun scripts/talks-erase.ts --person <person id> --confirm');
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Erasing person "${personId}" from the talks domain removes their talks, every action point about them and the cards of those and of the ones they own, and cannot be undone. Run again with --confirm to erase.`,
  );
  process.exit(2);
}
try {
  const erased = await talks.erasePerson(OPERATOR, personId);
  if (!erased) {
    console.error(
      `No person has the id "${personId}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`,
    );
    process.exitCode = 1;
  } else if (!erased.talks && !erased.commitments && !erased.cleared && !erased.cards)
    console.log(
      `Person "${personId}" has nothing in the talks domain: nothing was changed. Audited as person:${personId}.`,
    );
  else
    console.log(
      `Erased person "${personId}" from the talks domain: ${erased.talks} talks and ${erased.commitments} action points removed, ${erased.cleared} other records cleared, ${erased.cards} cards removed. Audited as person:${personId}.`,
    );
} catch (error) {
  console.error(`Could not erase: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
