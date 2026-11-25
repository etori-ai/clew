import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { createConnector } from '../../connectors/reference/connector.mjs';
import { assertionFor, signedRequest, testJwks } from '../connector-authority';

/**
 * The synthetic durability source on a SQLite file of its own, called as Clew calls it. Its writes, their replay and
 * their lookup are the durability suite's (`apps/server/tests/execution-runtime.test.ts`); here is what it answers a
 * person and a path (CS-L5): a person it refuses is 403, never the 401 that says Clew's key or assertion was refused, an
 * employee's scan is empty, and only the routes Clew posts to are served.
 */
const secret = 'test-secret-test-secret';
const directory = mkdtempSync(join(tmpdir(), 'clew-reference-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
let files = 0;
const sources: Array<{ close(): void }> = [];
afterAll(() => sources.forEach(source => source.close()));
function service(jwks: object | (() => Promise<object>) = testJwks) {
  const source = createConnector({ path: join(directory, `source-${files++}.sqlite`), secret, jwks });
  sources.push(source);
  return source;
}
const manager: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const employee: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
};
const signed = (path: string, actor: Actor, input?: object) =>
  signedRequest('http://reference' + path, {
    id: 'reference',
    actor,
    key: secret,
    body: input ? { actor, input } : { actor },
  });

describe('the reference source', () => {
  test('passes the conformance check, scanned as an employee too, and refuses another secret', async () => {
    const source = service();
    const report = await checkConnector({
      key: secret,
      url: 'http://reference',
      id: 'reference',
      assert: assertionFor('reference', secret),
      assertForeign: assertionFor('reference', 'another-secret-entirely'),
      fetch: (input, init) => source.handle(new Request(input, init)),
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('an employee has an empty scan and is refused a capability with 403; a call Clew did not sign is 401', async () => {
    const source = service();
    const scan = async (actor: Actor) =>
      (await (await source.handle(await signed('/clew/scan', actor))).json()) as { drafts: unknown[] };
    expect((await scan(employee)).drafts).toEqual([]);
    expect((await scan(manager)).drafts).toHaveLength(1);
    const refused = await source.handle(await signed('/clew/capabilities/reference.items', employee, {}));
    expect([refused.status, await refused.json()]).toEqual([
      403,
      { error: { code: 'denied', message: 'Du saknar behörighet.' } },
    ]);
    const items = await source.handle(await signed('/clew/capabilities/reference.items', manager, {}));
    expect(items.status).toBe(200);
    const unsigned = await source.handle(
      new Request('http://reference/clew/capabilities/reference.items', {
        method: 'POST',
        headers: { 'x-clew-connector-key': secret },
        body: '{}',
      }),
    );
    expect(unsigned.status).toBe(401);
    const unknown = await source.handle(await signed('/clew/capabilities/reference.other', manager, {}));
    expect([unknown.status, ((await unknown.json()) as { error: { code: string } }).error.code]).toEqual([
      404,
      'not-found',
    ]);
  });

  test('serves only the routes Clew posts to: any other is 404 before a key is fetched', async () => {
    let fetched = 0;
    const source = service(async () => {
      fetched++;
      return testJwks();
    });
    for (const [method, path] of [
      ['GET', '/clew/capabilities/reference.items'],
      ['POST', '/aaaaaaaaaaaaaaaaaareference.items'],
      ['POST', '/clew/XXXXXXXXXXXXXreference.items'],
      ['POST', '/clew/figure'],
    ] as const) {
      const response = await source.handle(
        method === 'GET' ? new Request('http://reference' + path) : await signed(path, manager, {}),
      );
      expect([method, path, response.status]).toEqual([method, path, 404]);
    }
    expect(fetched).toBe(0);
    expect((await source.handle(await signed('/clew/capabilities/reference.items', manager, {}))).status).toBe(200);
    expect(fetched).toBe(1);
  });
});
