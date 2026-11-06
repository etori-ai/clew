/**
 * Conformance check for a Clew connector service (D21, D23, D44). Uses the installation signing authority and
 * exercises the connector as a manager and an employee. The same
 * check runs behind "Testa anslutning" on the admin page (`packages/connectors/src/check.ts`).
 *
 *   bun scripts/connector-check.ts http://127.0.0.1:4010 --secret <shared secret> [--id hello]
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SignJWT } from 'jose';
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { signingAuthority } from '../apps/server/src/connectors/signing';
import type { Actor } from '../packages/connectors/src/index';
import { checkConnector } from '../packages/connectors/src/check';

const args = process.argv.slice(2);
try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* operator environment */
}
const url = args.find(a => !a.startsWith('--'))?.replace(/\/+$/, '');
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const secret = option('secret') ?? process.env.CLEW_CONNECTOR_SECRET;
if (!url || !secret) {
  console.error('Usage: bun scripts/connector-check.ts <url> --secret <shared secret> [--id <connector id>]');
  process.exit(2);
}
const id = option('id');
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
const authority = await signingAuthority();
const report = await checkConnector({
  url,
  id: audience,
  key: secret,
  assert: actor => authority.assert(audience, actor, manifest.uses),
  assertForeign: signer('wrong-secret-wrong-secret'),
  acceptsEmptyInput: schema => !!ajv.compile(schema)({}),
});
console.log(`Connector "${manifest.id}" (${manifest.source}), protocol ${manifest.protocol}`);
for (const f of report.findings)
  console.log(`  ${f.level === 'ok' ? 'ok  ' : f.level === 'warn' ? 'warn' : 'FAIL'} ${f.text}`);
const failures = report.findings.filter(f => f.level === 'fail').length;
console.log(failures ? `\n${failures} failure(s).` : '\nAll checks passed.');
await closeDatabase();
process.exit(failures ? 1 : 0);
