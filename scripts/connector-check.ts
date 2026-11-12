/**
 * Conformance check for a Clew connector service (D21, D23, D44). Uses the installation signing authority and
 * exercises the connector as a manager and an employee, handed to the registry with the whole context, provisioned
 * groups included, as the refresh and a connector's callback hand a person (a request hands the published actor with
 * the groups). Either way only the published actor reaches the service, as in production. The same check runs behind
 * "Testa anslutning" on the admin page (`packages/connectors/src/check.ts`).
 *
 *   bun scripts/connector-check.ts http://127.0.0.1:4010 --secret <shared secret> [--id hello] [--keys anna,erik,maria]
 *   bun scripts/connector-check.ts <url> --secret <shared secret> --id <registered connector> --keys <keys> --as <user name>
 *
 * A read about an entity (D97) is asked with keys: `--keys` are the user names (or unit ids) to ask in one batch. Without
 * `--as` the batch is signed as the check's own manager on a unit no installation has, for whom every real key is out of
 * scope; without `--keys` the rows are not checked, while an unknown key and another unit still are.
 *
 * `--as <user name>` signs the batch, and the unknown key asked after it, as that person of this installation, someone
 * who may see the keys: Clew's installation key signs their identity as Clew signs it (id, name, unit, role and user name
 * from their current grant), valid for two minutes, on every read about an entity the check makes, and, when the
 * manifest declares `uses`, a callback grant for the connector `--id` names. The service and the system behind it
 * cannot tell these reads from the person's own and record them as that person's, in whatever access log they keep. Use
 * a test installation or a test account, never a real colleague. `--as` requires `--id`, a connector registered in this
 * installation, so the service cannot choose the audience or the connector a callback is for, and before the first
 * signed request the script writes one audit row: `connector.checked_as`, actor `operator:cli`, about
 * `person:<their id>`, with the connector's id and counts only (`scripts/connector-check-as.ts`).
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SignJWT } from 'jose';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { AuthenticatedContext } from '@clew/contracts';
import { closeDatabase, database, schema } from '@clew/db';
import { readConnector } from '@clew/db/connectors';
import { writeAudit } from '@clew/db/threads';
import { signingAuthority } from '../apps/server/src/connectors/signing';
import { systemContext } from '../apps/server/src/system-context';
import type { Actor } from '../packages/connectors/src/index';
import { checkConnector } from '../packages/connectors/src/check';
import { asProblem, checkAs, type CheckAsDeps } from './connector-check-as';

const args = process.argv.slice(2);
try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* operator environment */
}
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const VALUED = ['secret', 'id', 'keys', 'as'];
const url = args
  .find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2) ?? ''))
  ?.replace(/\/+$/, '');
const secret = option('secret') ?? process.env.CLEW_CONNECTOR_SECRET;
if (!url || !secret) {
  console.error(
    'Usage: bun scripts/connector-check.ts <url> --secret <shared secret> [--id <connector id>] [--keys a,b,c] [--as <user name> with --id]',
  );
  process.exit(2);
}
const id = option('id');
const keys = (option('keys') ?? '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);
const asUser = args.includes('--as') ? (option('as') ?? '') : undefined;
// Refused before anything is fetched or signed: `--as` signs a real person, so it is bound to a registered connector.
const problem = asProblem({ as: asUser, id });
if (problem) {
  console.error(problem);
  process.exit(2);
}
const ajv = addFormats(new Ajv({ strict: false }));

// The audience must be the manifest's id; without --id it is learnt from the manifest, so the signer is built after a first fetch.
const { fetchManifest } = await import('../packages/connectors/src/remote');
const manifest = await fetchManifest(url, id).catch(error => {
  console.log('FAIL manifest: ' + (error as Error).message);
  process.exit(1);
});
const audience = manifest.id;
const signer = (key: string) => (actor: Actor) =>
  new SignJWT({ actor })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('clew')
    .setAudience(audience)
    .setSubject(actor.id)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(key));
/** This installation's side of `--as`: the registered connector, the person by user name, the audit row. */
const liveCheckAs: CheckAsDeps = {
  registered: async id => !!(await readConnector(id)),
  async person(userName) {
    // Compared as a sign-in compares a user name: NFC-normalised, then lower-cased under the ICU root collation.
    const found = await database()
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(
        sql`lower(${schema.people.userName} COLLATE "und-x-icu") = lower(${userName.normalize('NFC')}::text COLLATE "und-x-icu")`,
      );
    return found.length === 1 ? systemContext(found[0]!.id, 'operator:connector-check') : undefined;
  },
  audit: entry => database().transaction(tx => writeAudit(tx, entry)),
};
// The person `--as` names, with their whole context, as the refresh and a connector's callback hand a person to the
// registry. The audit row is written here, before the check signs its first request.
let as: AuthenticatedContext | undefined;
try {
  as = asUser
    ? await checkAs(
        {
          id: audience,
          userName: asUser,
          keys: keys.length,
          reads: manifest.capabilities.filter(c => c.kind === 'read' && c.about).length,
        },
        liveCheckAs,
      )
    : undefined;
} catch (error) {
  console.error((error as Error).message);
  await closeDatabase();
  process.exit(2);
}
const authority = await signingAuthority();
const report = await checkConnector({
  url,
  id: audience,
  key: secret,
  assert: actor => authority.assert(audience, actor, manifest.uses),
  assertForeign: signer('wrong-secret-wrong-secret'),
  acceptsEmptyInput: schema => !!ajv.compile(schema)({}),
  about: { keys, ...(as ? { as } : {}) },
});
console.log(`Connector "${manifest.id}" (${manifest.source}), protocol ${manifest.protocol}`);
for (const f of report.findings)
  console.log(`  ${f.level === 'ok' ? 'ok  ' : f.level === 'warn' ? 'warn' : 'FAIL'} ${f.text}`);
const failures = report.findings.filter(f => f.level === 'fail').length;
console.log(failures ? `\n${failures} failure(s).` : '\nAll checks passed.');
await closeDatabase();
process.exit(failures ? 1 : 0);
