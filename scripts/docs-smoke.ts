/** Runnable documentation: a real connector handler, ephemeral RS256 authority, no live services or network. */
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { connectorAuthority } from '../apps/server/src/connectors/authority';
import { checkConnector } from '../packages/connectors/src/check';
import { parseManifest, remoteConnector } from '../packages/connectors/src/remote';
import { Registry, openGovernance, type Actor } from '../packages/connectors/src/index';
import { createConnector, manifest as document } from '../connectors/telefonbok/connector.mjs';

const manifest = parseManifest(document, 'telefonbok');
const keys = await generateKeyPair('RS256', { extractable: true });
const authority = await connectorAuthority(await exportPKCS8(keys.privateKey), 'docs-ephemeral');
const secret = 'documentation-fixture-transport-key';
const connector = createConnector({ secret, jwks: authority.jwks });
// This transport runs the same handler as server.mjs, without binding a port or contacting a source.
const fetchConnector = (url: string, init?: RequestInit) => connector.handle(new Request(url, init));
const ajv = addFormats(new Ajv({ strict: false }));
const report = await checkConnector({
  url: 'http://fixture',
  id: manifest.id,
  key: secret,
  fetch: fetchConnector,
  assert: actor => authority.assert(manifest.id, actor),
  assertForeign: async () => 'not-a-signed-assertion',
  acceptsEmptyInput: schema => !!ajv.compile(schema)({}),
});
assert.equal(report.ok, true, JSON.stringify(report.findings.filter(f => f.level === 'fail')));

const actor: Actor = {
  id: 'docs-person',
  name: 'Dokumentation',
  unitId: 'unit-skola',
  unitLabel: 'Skolan',
  role: 'manager',
};
const registry = new Registry();
registry.register(
  remoteConnector(manifest, {
    url: 'http://fixture',
    key: secret,
    assert: person => authority.assert(manifest.id, person),
    fetch: fetchConnector,
  }),
);
registry.govern(manifest.id, openGovernance());
const result = await registry.run<{ rows: Array<{ ref: string; name: string }> }>(actor, 'telefonbok.directory', {});
assert.ok(result.rows.length > 0, 'The fixture should contain visible records');
const first = result.rows[0]!;
const person = await registry.run<{ ref: string }>(actor, 'telefonbok.person', { ref: first.ref });
assert.equal(person.ref, first.ref);

const token = await authority.assert(manifest.id, actor);
async function callTeam(bearer: string, key: string, bodyActor: Actor) {
  return connector.handle(
    new Request('http://fixture/clew/capabilities/telefonbok.team', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'x-clew-connector-key': key },
      body: JSON.stringify({ actor: bodyActor, input: {} }),
    }),
  );
}
const honest = await callTeam(token, secret, actor);
const forgedBody = await callTeam(token, secret, { ...actor, id: 'someone-else', unitId: 'another-unit' });
assert.equal(honest.status, 200);
assert.equal(forgedBody.status, 200);
const honestBody = (await honest.json()) as { output: { rows: unknown[] } };
assert.ok(honestBody.output.rows.length > 0, 'The actor fixture must exercise a nonempty team');
assert.deepEqual(await forgedBody.json(), honestBody, 'Body identity must not override signed claims');
assert.equal((await callTeam(token, 'incorrect-transport-key', actor)).status, 401);
assert.equal((await callTeam('forged-token', secret, actor)).status, 401);
assert.equal((await callTeam(await authority.assert('another-connector', actor), secret, actor)).status, 401);
console.log(
  `Validated ${manifest.id}: ${manifest.capabilities.length} capabilities, signed reads, required-input detail, actor binding and credential rejection.`,
);
console.log('Documentation smoke passed.');
