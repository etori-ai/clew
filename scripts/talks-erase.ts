/**
 * Erase one person from the talks domain (D96 item 10): their talks and every action point about them, the cards of
 * those and of the ones they owned, and their id on other people's records. Runs inside the app container with the
 * server's local settings (DATABASE_URL); no route and no `package.json` entry. Audited (`talks.person_erased`, counts
 * only) with the actor `operator:cli`. It cannot be undone, so it needs `--confirm`.
 *
 *   bun scripts/talks-erase.ts --person <person id> --confirm
 *
 * A person is named by their id, never by a user name. Refused, writing nothing and no audit row, for an id the people
 * table does not hold and for a person who is still active: the source deactivates a person first (D68 item 1). An
 * option given twice, or any other argument, is refused too, before the database is asked. A person with nothing in
 * the domain is still audited, with zero counts, and the script says so. It cancels no workflow, since a script never
 * starts the durable engine: a removed card's `due` timer goes with the card, and its workflow wakes at its time, finds
 * no timer and ends without a write (D86).
 */
import { resolve } from 'node:path';
import { parsePersonErasureArgs } from './person-erasure-args';
import { closeDatabase } from '@clew/db';
import { talksForScripts } from '../apps/server/src/composition/talks';
import { OPERATOR } from './talk-round';

const USAGE = 'Usage: bun scripts/talks-erase.ts --person <person id> --confirm';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = parsePersonErasureArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}
const { personId, confirmed } = args;
if (!confirmed) {
  console.error(
    `Erasing person "${personId}" from the talks domain removes their talks, every action point about them and the cards of those and of the ones they own, and cannot be undone. Run again with --confirm to erase.`,
  );
  console.error(USAGE);
  process.exit(2);
}
try {
  const erased = await talksForScripts.erasePerson(OPERATOR, personId);
  if ('refused' in erased) {
    console.error(
      erased.refused === 'unknown'
        ? `No person has the id "${personId}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`
        : `Person "${personId}" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`,
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
  // The transaction wrote nothing. A query's own error is its cause; the wrapper's message repeats the statement.
  const cause = (error as { cause?: unknown }).cause;
  console.error(
    `Could not erase: ${(cause instanceof Error ? cause : (error as Error)).message}. Nothing was written.`,
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
