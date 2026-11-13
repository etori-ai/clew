/**
 * Erase a deactivated person's identity record (D123, Q7 of the 2026-11-12 users review), when the organisation's own
 * retention decision says that the record goes. For one person it runs last: after `subject-erase.ts`, `talks-erase.ts`
 * and `competence-erase.ts`, which find the person by the same id, and only once the source has stopped sending the
 * person, or its next run creates them again. Runs inside the app container with the server's local settings
 * (DATABASE_URL); no route and no `package.json` entry, never automatic and never on a page. It cannot be undone, so it
 * needs `--confirm`.
 *
 *   bun scripts/person-erase.ts --person <person id> --confirm
 *
 * A person is named by their id, never by a user name. A deactivated person has no page, and Administration › Användare
 * shows their user name, so the id comes from the provisioner, which addresses the person by it (`/Users/<id>`), from
 * a SCIM `GET /scim/v2/Users?filter=externalId eq "<source key>"` with its key, which answers a deactivated person
 * too, or from `auth_person` by the source key. Refused, writing nothing and no audit row, for an id the people table
 * does not hold and for a person who is still active: the source deactivates a person first (D68 item 1). An option
 * given twice is refused too. In one transaction it takes the person out of their groups, removes their placements,
 * grant, sign-in bindings under every issuer and sessions, clears the name, e-mail address, phone numbers, employments
 * and title, and takes the user name and the source key away: the record then reads as its id, as one without a user
 * name does, the source can push the same name and key again as a new person, and no name resolves to the erased
 * person, so a card started about them can no longer be decided. In the audit trail it replaces the user names, source
 * keys, claims and sign-in subjects that name the person with "[erased]" and keeps every event, and it writes one
 * `person.erased` row (actor `operator:cli`, about `person:<person id>`, counts only). The row, its id, its
 * organisation and its deactivation stay, so every record that points at the id stays valid. Run again, it finds
 * nothing more to erase.
 */
import { resolve } from 'node:path';
import { parsePersonErasureArgs } from './person-erasure-args';
import { closeDatabase } from '@clew/db';
import { personErasure } from '../apps/server/src/composition/people';

/** The actor an operator's script writes, as `scripts/talk-round.ts` names it. */
const OPERATOR = 'operator:cli';
const USAGE = 'Usage: bun scripts/person-erase.ts --person <person id> --confirm';

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
    `Erasing person "${personId}" clears their name, e-mail address, phone numbers, employments, title, user name and source key, removes their groups, placements, grant, sign-in bindings and sessions, and replaces their identifiers in the audit trail, and cannot be undone. Run again with --confirm to erase.`,
  );
  console.error(USAGE);
  process.exit(2);
}
try {
  const result = await personErasure.erasePerson(OPERATOR, personId);
  if ('refused' in result) {
    console.error(
      result.refused === 'unknown'
        ? `No person has the id "${personId}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`
        : `Person "${personId}" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`,
    );
    process.exitCode = 1;
  } else {
    const e = result.erased;
    console.log(
      Object.values(e).some(count => count > 0)
        ? `Erased person "${personId}": ${e.fields} personal fields cleared; ${e.memberships} memberships, ${e.assignments} placements, ${e.grants} grants, ${e.bindings} sign-in bindings and ${e.sessions} sessions removed; ${e.auditRows} audit rows and ${e.signInRows} sign-in log rows cleared of their identifiers. Audited as person:${personId}.`
        : `Person "${personId}" holds nothing more to erase: nothing was changed. Audited as person:${personId}.`,
    );
  }
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
