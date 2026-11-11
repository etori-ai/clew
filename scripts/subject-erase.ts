/**
 * Erase one person or unit from every card (D97): the `subject` of each card row that names it and the card's own, with
 * the index from entity to cards, in every person's stream. The rows' text stays as the source wrote it, and a source
 * that still names the entity names it again on its next scan, so erase it in the source too. Runs inside the app
 * container with the server's local settings (DATABASE_URL); no route and no `package.json` entry. Audited
 * (`thread.subject_erased`, counts only) with the actor `operator:cli`, about `person:<Clew's id>` as
 * `talks.person_erased` is, or `unit:<id>`: the user name itself is never written to the audit trail. It cannot be undone,
 * so it needs `--confirm`.
 *
 *   bun scripts/subject-erase.ts person <user name> --confirm
 *   bun scripts/subject-erase.ts person <user name> --person <person id> --confirm   a user name the directory no longer has
 *   bun scripts/subject-erase.ts unit <unit id> --confirm
 *
 * A person's user name is compared without regard to case. Run `bun scripts/talks-erase.ts` as well to erase a person
 * from the talks domain.
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';
import { isEntityKind } from '@clew/contracts';
import { subjects } from '../apps/server/src/composition/subjects';

/** The actor an operator's script writes, as `scripts/talk-round.ts` names it. */
const OPERATOR = 'operator:cli';
const USAGE = 'Usage: bun scripts/subject-erase.ts <person|unit> <key> [--person <person id>] --confirm';

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
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--person');
const [entity, key] = positional;
const personOption = option('person');
if (!entity || !isEntityKind(entity) || !key || positional.length !== 2 || personOption?.startsWith('--')) {
  console.error(USAGE);
  process.exit(2);
}
if (entity === 'unit' && personOption) {
  console.error('--person names the person a user name belonged to; a unit is erased by its id alone.');
  process.exit(2);
}
if (!args.includes('--confirm')) {
  console.error(
    `Erasing ${entity} "${key}" from every card removes it from the rows and cards that name it, in every person's stream, and cannot be undone. Run again with --confirm to erase.`,
  );
  process.exit(2);
}
try {
  let recordedAs = `unit:${key}`;
  if (entity === 'person') {
    // The audit row is about the person by Clew's id, never by the user name being erased.
    const found = await database()
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(sql`lower(${schema.people.userName}) = lower(${key})`);
    const id = found[0]?.id;
    if (id && personOption && personOption !== id)
      throw new Error(`the user name belongs to person "${id}", not to "${personOption}"`);
    if (!id && !personOption)
      throw new Error(
        'no person in the directory has that user name; name the person it belonged to with --person <person id>',
      );
    recordedAs = `person:${id ?? personOption}`;
  }
  const erased = await subjects.eraseSubject(OPERATOR, { entity, key }, recordedAs);
  console.log(
    `Erased ${entity} "${key}" from ${erased.cards} cards: ${erased.rows} rows and ${erased.cardSubjects} card subjects no longer name it. Audited as ${recordedAs}.`,
  );
} catch (error) {
  console.error(`Could not erase: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
