/**
 * Rebind a person to a new sign-in account, or release their binding (D68 item 6 as amended, Q8 of the 2026-11-12
 * users review). With `--subject`, the person's binding under the issuer moves to the new subject, the ID token's `sub`
 * of the account the person signs in with now. With `--release`, the binding is removed, and the next sign-in whose
 * claim names the person binds them again as a first login does. For an account the identity provider replaced or
 * deleted and recreated, a new app registration, a source id that changed after the person signed in, or a binding made
 * while an account name moved between two people. The refused sign-in's `identity.conflict` audit row names the claimed
 * person, the refused subject (`subject`) and whoever holds it (`holder`). Runs inside the app container with the
 * server's local settings (DATABASE_URL, and OIDC_ISSUER unless `--issuer` names the issuer); no route and no
 * `package.json` entry, never automatic and never on a page.
 *
 *   bun scripts/identity-rebind.ts --person <id> --subject <new subject> --operator "<your name>" [--issuer <issuer>]
 *   bun scripts/identity-rebind.ts --person <id> --release --operator "<your name>" [--issuer <issuer>]
 *
 * Refused, writing nothing, for a person id the people table does not hold and for a subject already bound to another
 * person: release that person first, once the account names agree in the identity provider and in Clew. An option
 * given twice is refused too. In one transaction it writes the binding and one audit row in the audit table,
 * `identity.rebound` with the actor `operator:cli`, about `person:<person id>`, with the issuer, the old subject, the
 * new subject (null for a release) and the operator's name. The person's sessions under the old subject end at their
 * next request. Undone by running it again with the old subject, which the audit row keeps.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { RebindRefused, rebindIdentity } from '@clew/db/auth';

/** The actor an operator's script writes, as `scripts/talk-round.ts` names it. */
const OPERATOR = 'operator:cli';
const USAGE =
  'Usage: bun scripts/identity-rebind.ts --person <person id> (--subject <new subject> | --release) --operator "<your name>" [--issuer <issuer>]';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const VALUED = new Set(['--person', '--subject', '--operator', '--issuer']);
const given = new Map<string, string>();
let wellFormed = true;
for (let i = 0; i < args.length && wellFormed; i++) {
  const arg = args[i]!,
    value = args[i + 1];
  // An option given twice is refused, never read once: a copied line could otherwise rebind the wrong person.
  if (given.has(arg)) wellFormed = false;
  else if (arg === '--release') given.set(arg, '');
  else if (VALUED.has(arg) && value !== undefined && !value.startsWith('--')) given.set(arg, args[++i]!);
  else wellFormed = false;
}
const personId = given.get('--person'),
  subject = given.get('--subject'),
  release = given.has('--release'),
  operator = given.get('--operator')?.trim(),
  issuer = given.get('--issuer') ?? process.env.OIDC_ISSUER;
if (!wellFormed || !personId || !operator || release === (subject !== undefined)) {
  console.error(USAGE);
  process.exit(2);
}
if (!issuer || !URL.canParse(issuer)) {
  console.error('No issuer: set OIDC_ISSUER as the server has it, or name it with --issuer.');
  process.exit(2);
}
// An OpenID Connect subject is at most 255 ASCII characters (OpenID Connect Core 1.0, section 2); one with space around
// it was copied with more than the value.
if (subject !== undefined && !/^[\x21-\x7e]{1,255}$/.test(subject)) {
  console.error('The subject is the ID token\'s "sub": printable ASCII without spaces, at most 255 characters.');
  process.exit(2);
}
if (operator.length > 200 || /\p{Cc}/u.test(operator)) {
  console.error('The operator is your name as the audit row should keep it: one line, at most 200 characters.');
  process.exit(2);
}
try {
  const next = subject ?? null;
  const rebound = await rebindIdentity(OPERATOR, { issuer, personId, subject: next, operator });
  const audited = `Audited as identity.rebound about person:${personId}.`;
  console.log(
    !rebound.changed
      ? next === null
        ? `Person "${personId}" has no binding under ${issuer}; nothing changed.`
        : `Person "${personId}" is already bound to subject "${next}" under ${issuer}; nothing changed.`
      : next === null
        ? `Person "${personId}" no longer signs in as subject "${rebound.oldSubject}" under ${issuer}; the next sign-in whose claim names them binds them again. ${audited}`
        : `Person "${personId}" now signs in as subject "${next}" under ${issuer}` +
          (rebound.oldSubject ? `, no longer as "${rebound.oldSubject}"` : ', where they had no binding before') +
          `. ${audited}`,
  );
} catch (error) {
  // A refusal (`RebindRefused`) or a failure: the transaction wrote nothing either way.
  console.error(`Could not rebind: ${(error as Error).message}. Nothing was written.`);
  if (error instanceof RebindRefused && error.holder)
    console.error(
      `If that binding is wrong, release it first, once the account names agree in the identity provider and in Clew, then run this again: bun scripts/identity-rebind.ts --person ${error.holder} --release --operator "<your name>"`,
    );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
