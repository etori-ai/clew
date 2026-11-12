import { describe, expect, test } from 'bun:test';
import {
  Registry,
  fieldTone,
  markFields,
  openGovernance,
  placesOf,
  type Actor,
} from '../../packages/connectors/src/index';
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
import { trustingRelations } from '../registry';

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
// The development stack's person ids are generated; the fixture knows Anna by the user name Clew signs in (D97).
const anna: Actor = {
  id: '6f1c2a9e-0000-4000-8000-000000000001',
  name: 'Anna Lindqvist',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
  userName: 'anna',
};
// Another person with the same name (the directory has two Anna Lindqvist): never taken for her.
const namesake: Actor = { ...anna, id: '6f1c2a9e-0000-4000-8000-000000000002', userName: 'anna.lindqvist2' };
// Hillevi as Clew signs her in the development stack: a generated id and her user name, in another case.
const hilleviSigned: Actor = { ...hillevi, id: '6f1c2a9e-0000-4000-8000-000000000003', userName: 'Hillevi' };
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
  // What this suite tests is the system's own narrowing, so the core lets every key through (D117): the rule itself is
  // tested in asked-about.test.ts.
  const registry = new Registry({ relations: trustingRelations });
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
      ['appraisals.person', 'read', false],
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
      ['maria', 'missing'],
      ['erik', 'booked'],
      ['johan', 'booked'],
      ['anna', 'held'],
      ['karin', 'held'],
    ]);
    expect(new Set(output.rows.map(r => r.userName))).toEqual(new Set(PEOPLE.map(p => p.userName)));
    const byUser = Object.fromEntries(output.rows.map(r => [r.userName, r]));
    expect(byUser['maria']!.at).toBeUndefined();
    expect(byUser['erik']!.at).toBe('2026-11-13T09:00:00+01:00');
    expect(byUser['anna']!.at).toBe('2026-10-29');
    expect(byUser['anna']!.openCommitments).toBe(2);
    expect(byUser['erik']!.openCommitments).toBe(1);
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

  test('without person the caller gets the action points they own and those about them; with person, that employee’s for their manager', async () => {
    const { registry } = stack();
    const own = await commitments(registry, hillevi);
    expect(checkContract(CommitmentsOutputSchema, own)).toBe(true);
    expect(own.rows.every(r => r.owner === 'manager' && r.mine)).toBe(true);
    expect(own.rows.map(r => r.ref)).toEqual([
      'commitment:appraisals:ap-102',
      'commitment:appraisals:ap-202',
      'commitment:appraisals:ap-204',
    ]);

    const annas = await commitments(registry, hillevi, { person: 'anna' });
    expect(checkContract(CommitmentsOutputSchema, annas)).toBe(true);
    expect(annas.rows.length).toBeGreaterThan(0);
    expect(annas.rows.every(r => r.userName === 'anna')).toBe(true);
    expect(annas.rows.map(r => [r.ref, r.owner, r.mine])).toEqual([
      ['commitment:appraisals:ap-202', 'manager', true],
      ['commitment:appraisals:ap-201', 'employee', false],
      ['commitment:appraisals:ap-103', 'employee', false],
    ]);
    expect(annas.rows.find(r => r.done)?.doneAt).toBeString();

    // The employee sees the ones they own and the one their manager took on in her talk, her own first, each once;
    // another manager sees nothing of hers.
    const hers = await commitments(registry, anna);
    expect(checkContract(CommitmentsOutputSchema, hers)).toBe(true);
    expect(hers.rows.map(r => [r.ref, r.owner, r.mine, r.done])).toEqual([
      ['commitment:appraisals:ap-201', 'employee', true, false],
      ['commitment:appraisals:ap-202', 'manager', false, false],
      ['commitment:appraisals:ap-103', 'employee', true, true],
    ]);
    expect((await commitments(registry, lone, { person: 'anna' })).rows).toEqual([]);
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
    const eriks = await commitments(registry, hillevi, { person: 'erik' });
    expect(eriks.rows[0]!.carried).toBe(true);
    const links = [...(await talks(registry, hillevi)).rows.map(r => r.link), ...all.map(r => r.link)];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(new URL(link!).protocol).toBe('https:');
  });

  test('the caller is the signed user name first, then the operator map; never the name', async () => {
    const { registry } = stack({ personMap: { 'clew-person-7': 'hillevi', [namesake.id]: 'anna' } });
    // The user name in the assertion, compared without regard to case.
    expect((await talks(registry, hilleviSigned)).rows).toHaveLength(5);
    // A person Clew knows without a user name is found by the operator's map.
    const mapped: Actor = { ...hillevi, id: 'clew-person-7', name: 'Någon Annan' };
    expect((await talks(registry, mapped)).rows).toHaveLength(5);
    // The signed user name wins over the map: the namesake is not Anna, whatever the map says about her id.
    expect((await commitments(registry, namesake)).rows).toEqual([]);
    // Without a user name or a map, a matching name is no one here.
    const byName: Actor = { ...anna, id: 'clew-person-8' };
    delete byName.userName;
    expect((await commitments(registry, byName)).rows).toEqual([]);
    expect((await commitments(stack().registry, anna)).rows).toHaveLength(3);
  });

  test('appraisals.person says it is about a person (D97): one row per key asked, the key as asked, anyone else no row', async () => {
    const declared = parseManifest(appraisalsManifest, 'appraisals').capabilities.find(
      c => c.name === 'appraisals.person',
    )!;
    expect(declared.about).toEqual({ entity: 'person' });
    expect(placesOf(declared)).toEqual(['lens', 'mark', 'section']);
    expect(markFields(declared.view).map(f => f.key)).toEqual(['state']);
    const state = declared.view?.kind === 'list' ? declared.view.fields[0]! : undefined;
    expect([fieldTone(state!, 'Saknas'), fieldTone(state!, 'Bokat'), fieldTone(state!, 'Hållet')]).toEqual([
      'warn',
      'none',
      'none',
    ]);
    const { registry } = stack();
    // Never offered to the model (D97 item 7).
    expect(registry.tools(hillevi).map(t => t.name)).not.toContain('appraisals.person');
    const person = (actor: Actor, keys: string[]) =>
      registry.run<{ rows: Array<Record<string, unknown>> }>(actor, 'appraisals.person', { keys });
    const asked = ['Maria', 'erik', 'anna', 'karin', 'johan', 'erik', 'nobody', 'anna.lindqvist2'];
    expect((await person(hilleviSigned, asked)).rows).toEqual([
      { key: 'Maria', state: 'Saknas', overdue: 0 },
      { key: 'erik', state: 'Bokat', at: '2026-11-13T09:00:00+01:00', overdue: 1 },
      { key: 'anna', state: 'Hållet', at: '2026-10-29', overdue: 0 },
      { key: 'karin', state: 'Hållet', at: '2026-11-06', overdue: 0 },
      { key: 'johan', state: 'Bokat', at: '2026-11-18T13:30:00+01:00', overdue: 1 },
    ]);
    // A manager of another unit gets no row for Hillevi's people, and an employee is refused by the scope.
    expect((await person(lone, asked)).rows).toEqual([]);
    await expect(person(anna, ['anna'])).rejects.toThrow('Du saknar behörighet för åtgärden.');
    // A row opens that person's action points by its key as asked.
    expect((await commitments(registry, hilleviSigned, { person: 'Maria' })).rows).toEqual([]);
    expect((await commitments(registry, hilleviSigned, { person: 'ERIK' })).rows.map(r => r.ref)).toEqual([
      'commitment:appraisals:ap-101',
    ]);
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
    // The assertion is bound to the request it was issued for (D117): this body, this capability.
    const body = JSON.stringify({ input: {} });
    const valid = await assertionFor('appraisals', secret)(hillevi, [], { body, capability: 'appraisals.talks' });
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer ' + valid })).status).toBe(200);
    for (const other of [
      await assertionFor('appraisals', secret)(hillevi),
      await assertionFor('appraisals', secret)(hillevi, [], {
        body: JSON.stringify({ input: { x: 1 } }),
        capability: 'appraisals.talks',
      }),
      await assertionFor('appraisals', secret)(hillevi, [], { body, capability: 'appraisals.round' }),
      await assertionFor('appraisals', secret)(hillevi, [], { body }),
    ])
      expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer ' + other })).status).toBe(401);
  });

  test('the conformance check passes, and asks appraisals.person as Clew would (D97)', async () => {
    const { connectorFetch } = stack();
    const check = (about?: { keys?: string[]; as?: Actor }) =>
      checkConnector({
        key: secret,
        url: 'http://appraisals',
        id: 'appraisals',
        assert: assertionFor('appraisals', secret),
        assertForeign: assertionFor('appraisals', 'another-secret-entirely'),
        fetch: connectorFetch,
        ...(about ? { about } : {}),
      });
    const about = (report: Awaited<ReturnType<typeof check>>) =>
      report.findings.filter(f => f.text.startsWith('appraisals.person about')).map(f => `${f.level} ${f.text}`);
    // Without keys the rows are not checked; the unknown key and the role scope are.
    const bare = await check();
    expect(bare.ok).toBe(true);
    expect(about(bare)).toEqual([
      'warn appraisals.person about person, batch: no keys given; pass --keys (and --as a person who may see them) to check the rows',
      'ok appraisals.person about person, unknown key: no row, no error',
      "ok appraisals.person about person, out of scope: asked by the check's manager on unit-check (no keys given, so the key is synthetic): no row, no error",
    ]);
    expect(bare.findings).toContainEqual({ level: 'ok', text: 'appraisals.person: employee refused by scope' });
    // With the five people's keys, signed as their manager.
    const full = await check({ keys: ['anna', 'erik', 'maria', 'johan', 'karin'], as: hilleviSigned });
    expect(full.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(full.ok).toBe(true);
    expect(about(full).map(t => t.replace(/\d+ ms \(/, 'n ms ('))).toEqual([
      'ok appraisals.person about person, batch: 5 keys asked, 5 rows, n ms (budget 1500 ms)',
      'ok appraisals.person about person, key: every row carries a key it was asked with',
      'ok appraisals.person about person, one row per key',
      'ok appraisals.person about person, unknown key: no row, no error',
      "ok appraisals.person about person, out of scope: the 5 keys asked by the check's manager on unit-check: no row, no error",
    ]);
    // The administrator's row says the same without a single answer in it.
    expect(full.items.find(i => i.capability === 'appraisals.person')).toEqual({
      level: 'ok',
      group: 'capabilities',
      label: 'Utvecklingssamtal',
      description:
        'Svarar för chef, medarbetare nekas som väntat. 5 nycklar gav 5 rader. Visas som lista med 3 fält. En okänd nyckel ger ingen rad. En person utanför behörigheten ger ingen rad. Clew frågar bara om den inloggades medarbetare.',
      capability: 'appraisals.person',
    });
    // What each read admits (D117) is checked from the declaration: the section's read and the read its row opens.
    expect(full.findings).toContainEqual({
      level: 'ok',
      text: 'appraisals.person names a person in keys: Clew sends only managed (person.admits)',
    });
    expect(full.findings).toContainEqual({
      level: 'ok',
      text: 'appraisals.commitments names a person in person: Clew sends only self, managed (person.admits)',
    });
    expect(full.items).toContainEqual({
      level: 'ok',
      group: 'surfaces',
      label: 'Om personer',
      description:
        'Utvecklingssamtal kan visas som lins över listan, som markering på raden, som avsnitt när en person öppnas.',
    });
  });
});
