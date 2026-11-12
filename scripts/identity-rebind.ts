/**
 * Rebind a person to a new sign-in account (D68 item 6 as amended, Q8 of the 2026-11-12 users review): the person's
 * binding under the issuer moves to the new subject, the ID token's `sub` of the account the person signs in with now.
 * For an account the identity provider replaced or deleted and recreated, a new app registration, a source id that
 * changed after the person signed in, or a binding made while an account name moved between two people. The refused
 * sign-in's `identity.conflict` audit row names the claimed person, the refused subject (`subject`) and whoever holds
 * it (`holder`). Runs inside the app container with the server's local settings (DATABASE_URL, and OIDC_ISSUER unless
 * `--issuer` names the issuer); no route and no `package.json` entry, never automatic and never on a page.
 *
 *   bun scripts/identity-rebind.ts --person <person id> --subject <new subject> --operator "<your name>" [--issuer <issuer>]
 *
 * Refused, writing nothing, for a person id the people table does not hold and for a subject already bound to another
 * person: rebind that person first. In one transaction it writes the binding and one audit row in the audit table,
 * `identity.rebound` with the actor `operator:cli`, about `person:<person id>`, with the issuer, the old subject, the
 * new subject and the operator's name. The person's sessions under the old subject end at their next request. Undone by
 * running it again with the old subject, which the audit row keeps.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { rebindIdentity } from '@clew/db/auth';

/** The actor an operator's script writes, as `scripts/talk-round.ts` names it. */
const OPERATOR = 'operator:cli';
const USAGE =
  'Usage: bun scripts/identity-rebind.ts --person <person id> --subject <new subject> --operator "<your name>" [--issuer <issuer>]';

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
const personId = option('person'),
  subject = option('subject'),
  operator = option('operator')?.trim(),
  issuer = option('issuer') ?? process.env.OIDC_ISSUER;
const named = new Set(['--person', '--subject', '--operator', '--issuer']);
const stray = args.filter((a, i) => !named.has(a) && !named.has(args[i - 1] ?? ''));
if (
  !personId ||
  !subject ||
  !operator ||
  [personId, subject, operator, issuer].some(value => value?.startsWith('--')) ||
  stray.length
) {
  console.error(USAGE);
  process.exit(2);
}
if (!issuer) {
  console.error('No issuer: set OIDC_ISSUER as the server has it, or name it with --issuer.');
  process.exit(2);
}
// An OpenID Connect subject is at most 255 ASCII characters (OpenID Connect Core 1.0, section 2); one with space around
// it was copied with more than the value.
if (subject !== subject.trim() || subject.length > 255 || /[^\x21-\x7e]/.test(subject)) {
  console.error('The subject is the ID token\'s "sub": printable ASCII without spaces, at most 255 characters.');
  process.exit(2);
}
if (operator.length > 200 || /\p{Cc}/u.test(operator)) {
  console.error('The operator is your name as the audit row should keep it: one line, at most 200 characters.');
  process.exit(2);
}
try {
  const rebound = await rebindIdentity(OPERATOR, { issuer, personId, subject, operator });
  console.log(
    rebound.changed
      ? `Person "${personId}" now signs in as subject "${subject}" under ${issuer}` +
          (rebound.oldSubject ? `, no longer as "${rebound.oldSubject}"` : ', where they had no binding before') +
          `. Audited as identity.rebound about person:${personId}.`
      : `Person "${personId}" is already bound to subject "${subject}" under ${issuer}; nothing changed.`,
  );
} catch (error) {
  // A refusal (`RebindRefused`) or a failure: the transaction wrote nothing either way.
  console.error(`Could not rebind: ${(error as Error).message}. Nothing was written.`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
