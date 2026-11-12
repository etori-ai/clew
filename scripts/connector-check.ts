/**
 * Conformance check for a Clew connector service (D21, D23, D44). Uses the installation signing authority and
 * exercises the connector as a manager and an employee. The same
 * check runs behind "Testa anslutning" on the admin page (`packages/connectors/src/check.ts`).
 *
 *   bun scripts/connector-check.ts http://127.0.0.1:4010 --secret <shared secret> [--id hello]
 *       [--keys anna,erik,maria] [--as hillevi]
 *
 * A read about an entity (D97) is asked with keys: `--keys` are the user names (or unit ids) to ask in one batch, and
 * `--as` the user name of the person in this installation's directory to sign that batch as, someone who may see them.
 * Without `--as` the batch is signed as the check's own manager on a unit no installation has, for whom every real key
 * is out of scope; without `--keys` the rows are not checked, while an unknown key and another unit still are.
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SignJWT } from 'jose';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';
import { signingAuthority } from '../apps/server/src/connectors/signing';
import { systemContext } from '../apps/server/src/system-context';
import { actorOf, type Actor } from '../packages/connectors/src/index';
import { checkConnector } from '../packages/connectors/src/check';

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
    'Usage: bun scripts/connector-check.ts <url> --secret <shared secret> [--id <connector id>] [--keys a,b,c] [--as <user name>]',
  );
  process.exit(2);
}
const id = option('id');
const keys = (option('keys') ?? '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);
const asUser = option('as');
const ajv = addFormats(new Ajv({ strict: false }));

/** The person `--as` names, as Clew signs them: their current grant, found by user name without regard to case. */
async function personByUserName(userName: string): Promise<Actor> {
  const found = await database()
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(sql`lower(${schema.people.userName}) = lower(${userName})`);
  const persona = found.length === 1 ? await systemContext(found[0]!.id, 'operator:connector-check') : undefined;
  if (!persona) throw new Error(`--as ${userName}: no person with that user name and a grant in this installation.`);
  return actorOf(persona);
}

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
const authority = await signingAuthority();
let as: Actor | undefined;
try {
  as = asUser ? await personByUserName(asUser) : undefined;
} catch (error) {
  console.error((error as Error).message);
  await closeDatabase();
  process.exit(2);
}
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
