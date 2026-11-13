/**
 * Erase one person from the follow-up dialogue (D118): their id on every assessment and activity (author, owner, added
 * by, done by) and the cards of the activities they owned. The records about the units stay. Runs inside the app
 * container with the server's local settings (DATABASE_URL); no route and no `package.json` entry. Audited
 * (`dialogue.person_erased`, counts only) with the actor `operator:cli`. It cannot be undone, so it needs `--confirm`.
 *
 *   bun scripts/dialogue-erase.ts --person <person id> --confirm
 */
import { resolve } from 'node:path';
import { parsePersonErasureArgs } from './person-erasure-args';
import { closeDatabase } from '@clew/db';
import { dialogueForScripts } from '../apps/server/src/composition/dialogue';
import { OPERATOR } from './talk-round';

const USAGE = 'Usage: bun scripts/dialogue-erase.ts --person <person id> --confirm';

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
    `Erasing person "${personId}" from the follow-up dialogue removes them from every assessment and activity and removes the cards of the activities they own, and cannot be undone. Run again with --confirm to erase.`,
  );
  console.error(USAGE);
  process.exit(2);
}
try {
  const erased = await dialogueForScripts.erasePerson(OPERATOR, personId);
  if ('refused' in erased) {
    console.error(
      erased.refused === 'unknown'
        ? `No person has the id "${personId}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`
        : `Person "${personId}" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`,
    );
    process.exitCode = 1;
  } else if (!erased.cleared && !erased.cards)
    console.log(
      `Person "${personId}" has nothing in the follow-up dialogue: nothing was changed. Audited as person:${personId}.`,
    );
  else
    console.log(
      `Erased person "${personId}" from the follow-up dialogue: ${erased.cleared} records cleared, ${erased.cards} cards removed. Audited as person:${personId}.`,
    );
} catch (error) {
  const cause = (error as { cause?: unknown }).cause;
  console.error(
    `Could not erase: ${(cause instanceof Error ? cause : (error as Error)).message}. Nothing was written.`,
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
