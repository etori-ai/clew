/** Runnable documentation: a real connector handler, ephemeral RS256 authority, no live services or network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { connectorAuthority } from '../apps/server/src/connectors/authority';
import { checkConnector } from '../packages/connectors/src/check';
import { parseManifest, remoteConnector } from '../packages/connectors/src/remote';
import { Registry, openGovernance, type Actor } from '../packages/connectors/src/index';
import { createConnector, manifest as document } from '../connectors/phonebook/connector.mjs';

const manifest = parseManifest(document, 'phonebook');
const keys = await generateKeyPair('RS256', { extractable: true });
const authority = await connectorAuthority(await exportPKCS8(keys.privateKey), 'docs-ephemeral');
const secret = 'documentation-fixture-transport-key';
const connector = createConnector({ secret, jwks: authority.jwks });
// This transport runs the same handler as server.mjs, without binding a port or contacting a source.
const fetchConnector = (url: string, init?: RequestInit) => connector.handle(new Request(url, init));
const ajv = addFormats(new Ajv({ strict: false }));
// The quickstart's copyable manifest and response must keep matching the real contract.
const quickstart = readFileSync(new URL('../docs/guides/creating-a-connector.md', import.meta.url), 'utf8');
function quickstartJson(marker: string) {
  const section = quickstart.split('<!-- ' + marker + ' -->')[1];
  const block = section?.match(/^\s*```json\n([\s\S]*?)\n```/);
  assert.ok(block, 'Missing quickstart JSON example: ' + marker);
  return JSON.parse(block[1]!);
}
const minimal = parseManifest(quickstartJson('minimal-connector-manifest'), 'directory');
const minimalResponse = quickstartJson('minimal-connector-response');
const validateMinimalOutput = ajv.compile(minimal.capabilities[0]!.output);
assert.ok(validateMinimalOutput(minimalResponse.output), JSON.stringify(validateMinimalOutput.errors));
const report = await checkConnector({
  url: 'http://fixture',
  id: manifest.id,
  key: secret,
  fetch: fetchConnector,
  assert: (actor, chain, binding) => authority.assert(manifest.id, actor, [], chain, binding),
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
    assert: (person, chain, binding) => authority.assert(manifest.id, person, [], chain, binding),
    fetch: fetchConnector,
  }),
);
registry.govern(manifest.id, openGovernance());
const result = await registry.run<{ rows: Array<{ ref: string; name: string }> }>(actor, 'phonebook.directory', {});
assert.ok(result.rows.length > 0, 'The fixture should contain visible records');
const first = result.rows[0]!;
const person = await registry.run<{ ref: string }>(actor, 'phonebook.person', { ref: first.ref });
assert.equal(person.ref, first.ref);

// The assertion is bound to the exact body it is sent with and to the capability of the route (D117).
const bodyOf = (bodyActor: Actor) => JSON.stringify({ actor: bodyActor, input: {} });
const bound = (body: string, audience = manifest.id) =>
  authority.assert(audience, actor, [], [], { body, capability: 'phonebook.team' });
async function callTeam(bearer: string, key: string, body: string) {
  return connector.handle(
    new Request('http://fixture/clew/capabilities/phonebook.team', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'x-clew-connector-key': key },
      body,
    }),
  );
}
const honestText = bodyOf(actor);
const honest = await callTeam(await bound(honestText), secret, honestText);
assert.equal(honest.status, 200);
const honestBody = (await honest.json()) as { output: { rows: unknown[] } };
assert.ok(honestBody.output.rows.length > 0, 'The actor fixture must exercise a nonempty team');
// A body forged under a valid assertion is refused: the assertion names another body.
const forgedText = bodyOf({ ...actor, id: 'someone-else', unitId: 'another-unit' });
assert.equal(
  (await callTeam(await bound(honestText), secret, forgedText)).status,
  401,
  'A forged body must be refused',
);
// Signed for the forged body, the actor is still the assertion's: body identity never overrides signed claims.
const signedForged = await callTeam(await bound(forgedText), secret, forgedText);
assert.equal(signedForged.status, 200);
assert.deepEqual(await signedForged.json(), honestBody, 'Body identity must not override signed claims');
assert.equal((await callTeam(await bound(honestText), 'incorrect-transport-key', honestText)).status, 401);
assert.equal((await callTeam('forged-token', secret, honestText)).status, 401);
assert.equal((await callTeam(await bound(honestText, 'another-connector'), secret, honestText)).status, 401);
assert.equal((await callTeam(await authority.assert(manifest.id, actor), secret, honestText)).status, 401);
console.log(
  `Validated ${manifest.id}: ${manifest.capabilities.length} capabilities, signed reads, required-input detail, actor and body binding and credential rejection.`,
);
console.log('Documentation smoke passed.');
