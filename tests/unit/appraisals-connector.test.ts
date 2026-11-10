import { describe, expect, test } from 'bun:test';
import { Registry, openGovernance, type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import {
  CommitmentsOutputSchema,
  TalksOutputSchema,
  checkContract,
  type CommitmentsOutput,
  type TalksOutput,
} from '@clew/contracts';
import { PEOPLE, createConnector, manifest as appraisalsManifest } from '../../connectors/appraisals/connector.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The appraisals fixture (D96 items 8 and 9): a system other than Clew's own module answers the talks profile, keyed on
 * the provisioned user name, in exactly the shapes Clew's pages read. Run over the protocol against the fixture.
 */
const secret = 'test-secret-test-secret';
const TODAY = '2026-11-10';
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'manager',
};
// The development stack's person ids are generated; the fixture finds Anna by her name.
const anna: Actor = {
  id: '6f1c2a9e-0000-4000-8000-000000000001',
  name: 'Anna Lindqvist',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
};
const lone: Actor = {
  id: 'nobody-manages',
  name: 'Ingen Chef',
  unitId: 'unit-it',
  unitLabel: 'IT och digitalisering',
  role: 'manager',
};

function stack(options: { personMap?: Record<string, string> } = {}) {
  const service = createConnector({ jwks: testJwks, secret, today: () => TODAY, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(appraisalsManifest, 'appraisals'), {
      url: 'http://appraisals',
      key: secret,
      assert: assertionFor('appraisals', secret),
      fetch: connectorFetch,
    }),
  );
  // Registered and enabled for everyone: the built-in module is not in this registry, so this connector answers (D96 item 9).
  registry.govern('appraisals', openGovernance());
  return { registry, connectorFetch };
}
const talks = (registry: Registry, actor: Actor) => registry.run<TalksOutput>(actor, 'appraisals.talks', {});
const commitments = (registry: Registry, actor: Actor, input: { person?: string } = {}) =>
  registry.run<CommitmentsOutput>(actor, 'appraisals.commitments', input);

describe('the appraisals connector answers the talks profile (D96)', () => {
  test('the manifest declares the two profile reads, never as model tools', () => {
    const manifest = parseManifest(appraisalsManifest, 'appraisals');
    expect(manifest.capabilities.map(c => [c.name, c.kind, c.model])).toEqual([
      ['appraisals.talks', 'read', false],
      ['appraisals.commitments', 'read', false],
      ['appraisals.round', 'read', false],
    ]);
    const { registry } = stack();
    expect(registry.talkSource(hillevi)).toEqual({
      builtIn: false,
      connectorId: 'appraisals',
      source: 'Samtalssystemet',
      talks: 'appraisals.talks',
      commitments: 'appraisals.commitments',
    });
    expect(registry.tools(hillevi)).toEqual([]);
  });

  test('a manager gets the round and one row per person, in the profile shape', async () => {
    const { registry } = stack();
    const output = await talks(registry, hillevi);
    expect(checkContract(TalksOutputSchema, output)).toBe(true);
    expect(output.round).toEqual({ label: 'Utvecklingssamtal 2026', opensOn: '2026-10-11', dueOn: '2026-12-30' });
    expect(output.rows.map(r => [r.userName, r.state])).toEqual([
      ['maria.kallstrom', 'missing'],
      ['erik.sandstrom', 'booked'],
      ['johan.bystrom', 'booked'],
      ['anna.lindqvist', 'held'],
      ['karin.lindqvist', 'held'],
    ]);
    expect(new Set(output.rows.map(r => r.userName))).toEqual(new Set(PEOPLE.map(p => p.userName)));
    const byUser = Object.fromEntries(output.rows.map(r => [r.userName, r]));
    expect(byUser['maria.kallstrom']!.at).toBeUndefined();
    expect(byUser['erik.sandstrom']!.at).toBe('2026-11-13T09:00:00+01:00');
    expect(byUser['anna.lindqvist']!.at).toBe('2026-10-29');
    expect(byUser['anna.lindqvist']!.openCommitments).toBe(2);
    expect(byUser['erik.sandstrom']!.openCommitments).toBe(1);
    expect(new Set(output.rows.map(r => r.link)).size).toBe(output.rows.length);
  });

  test('a caller who manages nobody gets the round and no rows', async () => {
    const { registry } = stack();
    const output = await talks(registry, lone);
    expect(checkContract(TalksOutputSchema, output)).toBe(true);
    expect(output.round).not.toBeNull();
    expect(output.rows).toEqual([]);
    expect((await talks(registry, anna)).rows).toEqual([]);
    expect((await commitments(registry, lone)).rows).toEqual([]);
  });

  test('without person the caller gets their own action points; with person, that employee’s for their manager', async () => {
    const { registry } = stack();
    const own = await commitments(registry, hillevi);
    expect(checkContract(CommitmentsOutputSchema, own)).toBe(true);
    expect(own.rows.every(r => r.owner === 'manager' && r.mine)).toBe(true);
    expect(own.rows.map(r => r.ref)).toEqual([
      'commitment:appraisals:ap-102',
      'commitment:appraisals:ap-202',
      'commitment:appraisals:ap-204',
    ]);

    const annas = await commitments(registry, hillevi, { person: 'anna.lindqvist' });
    expect(checkContract(CommitmentsOutputSchema, annas)).toBe(true);
    expect(annas.rows.length).toBeGreaterThan(0);
    expect(annas.rows.every(r => r.userName === 'anna.lindqvist')).toBe(true);
    expect(annas.rows.map(r => [r.ref, r.owner, r.mine])).toEqual([
      ['commitment:appraisals:ap-202', 'manager', true],
      ['commitment:appraisals:ap-201', 'employee', false],
      ['commitment:appraisals:ap-103', 'employee', false],
    ]);
    expect(annas.rows.find(r => r.done)?.doneAt).toBeString();

    // The employee sees the ones they own; another manager sees nothing of hers.
    const hers = await commitments(registry, anna);
    expect(hers.rows.map(r => [r.ref, r.mine, r.done])).toEqual([
      ['commitment:appraisals:ap-201', true, false],
      ['commitment:appraisals:ap-103', true, true],
    ]);
    expect((await commitments(registry, lone, { person: 'anna.lindqvist' })).rows).toEqual([]);
  });

  test('the fixture has carried and done action points, and every link is https', async () => {
    const { registry } = stack();
    const all = (await Promise.all(PEOPLE.map(p => commitments(registry, hillevi, { person: p.userName })))).flatMap(
      o => o.rows,
    );
    expect(all.some(r => r.carried)).toBe(true);
    expect(all.some(r => r.done)).toBe(true);
    expect(all.filter(r => r.carried).every(r => !r.done)).toBe(true);
    // Carried ones are listed first in a person's list.
    const eriks = await commitments(registry, hillevi, { person: 'erik.sandstrom' });
    expect(eriks.rows[0]!.carried).toBe(true);
    const links = [...(await talks(registry, hillevi)).rows.map(r => r.link), ...all.map(r => r.link)];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(new URL(link!).protocol).toBe('https:');
  });

  test('an operator map names the caller by user name', async () => {
    const { registry } = stack({ personMap: { 'clew-person-7': 'hillevi' } });
    const mapped: Actor = { ...hillevi, id: 'clew-person-7', name: 'Någon Annan' };
    expect((await talks(registry, mapped)).rows).toHaveLength(5);
  });

  test('a request without a valid assertion is refused', async () => {
    const service = createConnector({ jwks: testJwks, secret, today: () => TODAY });
    const call = (headers: Record<string, string>) =>
      service.handle(
        new Request('http://appraisals/clew/capabilities/appraisals.talks', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ input: {} }),
        }),
      );
    expect((await call({})).status).toBe(401);
    expect((await call({ 'x-clew-connector-key': secret })).status).toBe(401);
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer x.y.z' })).status).toBe(401);
    const foreign = await assertionFor('appraisals', 'another-secret-entirely')(hillevi);
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer ' + foreign })).status).toBe(401);
    const valid = await assertionFor('appraisals', secret)(hillevi);
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer ' + valid })).status).toBe(200);
  });

  test('the conformance check passes', async () => {
    const { connectorFetch } = stack();
    const report = await checkConnector({
      key: secret,
      url: 'http://appraisals',
      id: 'appraisals',
      assert: assertionFor('appraisals', secret),
      assertForeign: assertionFor('appraisals', 'another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
