/**
 * Erase one person or unit from every card (D97): the `subject` of each card row that names it and the card's own, with
 * the index from entity to cards, in every person's stream. Clew names a person on its cards by the person's id (D116),
 * so one erasure reaches every card about them, whatever user names they have held, and never the cards of someone who
 * holds one of those names now. The rows' text stays as the source wrote it, and a source that still names the entity
 * names it again on its next scan, so erase it in the source too. Runs inside the app container with the server's local
 * settings (DATABASE_URL); no route and no `package.json` entry. Audited (`thread.subject_erased`, counts only) with the
 * actor `operator:cli`, about `person:<person id>` or `unit:<unit id>`. The erasure writes no user name, but it does not
 * reach the rest of the audit trail: every `scim.user.*` row about the person still holds the `userName` and
 * `externalId` it was written with, until `scripts/person-erase.ts` erases the person last (D117). It cannot be undone,
 * so it needs `--confirm`.
 *
 *   bun scripts/subject-erase.ts person <person id> --confirm
 *   bun scripts/subject-erase.ts unit <unit id> --confirm
 *
 * A person is named by their id, never by a user name. Refused, writing nothing and no audit row, for an id the people
 * table does not hold and for a person who is still active: the source deactivates a person first (D68 item 1). A unit
 * is erased by any id, since a removed unit may still be named on cards. When no card names the entity the script says
 * so. Run `bun scripts/talks-erase.ts` and `bun scripts/competence-erase.ts` as well to erase a person from those
 * domains.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { isEntityKind } from '@clew/contracts';
import { subjects } from '../apps/server/src/composition/subjects';

/** The actor an operator's script writes, as `scripts/talk-round.ts` names it. */
const OPERATOR = 'operator:cli';
const USAGE = 'Usage: bun scripts/subject-erase.ts <person|unit> <person id|unit id> --confirm';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const [entity, key] = positional;
if (
  !entity ||
  !isEntityKind(entity) ||
  !key ||
  positional.length !== 2 ||
  args.some(a => a.startsWith('--') && a !== '--confirm')
) {
  console.error(USAGE);
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Erasing ${entity} "${key}" from every card removes it from the rows and cards that name it, in every person's stream, and cannot be undone. Run again with --confirm to erase.`,
  );
  process.exit(2);
}
try {
  const erased = await subjects.eraseSubject(OPERATOR, { entity, key });
  if ('refused' in erased) {
    console.error(
      erased.refused === 'unknown'
        ? `No person has the id "${key}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`
        : `Person "${key}" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`,
    );
    process.exitCode = 1;
  } else if (!erased.cards)
    console.log(`No card names ${entity} "${key}": nothing was changed. Audited as ${entity}:${key}.`);
  else
    console.log(
      `Erased ${entity} "${key}" from ${erased.cards} cards: ${erased.rows} rows and ${erased.cardSubjects} card subjects no longer name it. Audited as ${entity}:${key}.`,
    );
} catch (error) {
  console.error(`Could not erase: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
