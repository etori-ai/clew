import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';
import { scimClient } from '../../scripts/provisioner/client';
import { developmentDirectory, type Directory } from '../../scripts/provisioner/directory';
import { plan, push } from '../../scripts/provisioner/push';

/**
 * The synthetic provisioner against the SCIM routes (D68 item 7): the development directory becomes users, units,
 * roles and capabilities through the standard alone, and a second push changes nothing.
 */
function stack() {
  const store = memoryProvisionStore();
  let seq = 0;
  const scim = scimUsecases({
    store,
    clock: () => new Date('2026-11-09T06:00:00.000Z'),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  store.state.provisioners.set('digest:dev-token', { id: 'dev', organisationId: 'poc', label: 'Development' });
  const app = scimRoutes(scim);
  const client = scimClient('http://clew.local', 'dev-token', (input, init) => app.request(input, init));
  const grantOf = (userName: string) => {
    const user = [...store.state.users.values()].find(u => u.userName === userName);
    return user && store.state.grants.get(user.id);
  };
  return { store, client, grantOf };
}
describe('the synthetic provisioner', () => {
  test('plans D68 groups from departments, manager flags and capabilities', () => {
    const p = plan(developmentDirectory);
    expect(p.users.map(u => u.body.userName)).toEqual(['hillevi', 'hassan', 'mikael']);
    expect(p.groups.map(g => [g.externalId, g.members.length])).toEqual([
      ['capability:admin.connectors', 1],
      ['capability:admin.users', 1],
      ['unit-manager:unit-skola', 1],
      ['unit:unit-it', 1],
      ['unit:unit-omsorg', 1],
      ['unit:unit-skola', 1],
    ]);
    expect(p.groups.find(g => g.externalId === 'unit:unit-skola')).toMatchObject({
      displayName: 'Bergsåkers skola',
      members: ['dev:hillevi'],
    });
    expect(() => plan({ units: [], people: developmentDirectory.people })).toThrow("department 'unit-skola'");
  });
  test('a first push creates everything, grants follow, and a second push is silent', async () => {
    const { store, client, grantOf } = stack();
    const first = await push(client, developmentDirectory);
    expect(first).toEqual({
      created: 3,
      replaced: 0,
      deactivated: 0,
      groupsCreated: 6,
      groupsReplaced: 0,
      groupsRemoved: 0,
    });
    expect(grantOf('hillevi')).toEqual({
      unitId: 'unit-skola',
      unitLabel: 'Bergsåkers skola',
      role: 'manager',
      capabilities: [],
    });
    expect(grantOf('hassan')).toMatchObject({ unitId: 'unit-omsorg', role: 'employee' });
    expect(grantOf('mikael')).toMatchObject({
      unitId: 'unit-it',
      role: 'employee',
      capabilities: ['admin.connectors', 'admin.users'],
    });
    expect([...store.state.units.values()].map(u => u.label).sort()).toEqual([
      'Bergsåkers skola',
      'Hemtjänst Centrum',
      'IT och digitalisering',
    ]);
    const audited = store.state.audit.length;
    const second = await push(client, developmentDirectory);
    expect(second).toEqual({
      created: 0,
      replaced: 3,
      deactivated: 0,
      groupsCreated: 0,
      groupsReplaced: 6,
      groupsRemoved: 0,
    });
    expect(store.state.audit.length).toBe(audited);
  });
  test('a changed directory moves roles, takes capabilities back, deactivates a leaver and removes an empty key group', async () => {
    const { store, client, grantOf } = stack();
    await push(client, developmentDirectory);
    const changed: Directory = {
      units: developmentDirectory.units,
      people: developmentDirectory.people
        .filter(p => p.userName !== 'hassan')
        .map(p => (p.userName === 'hillevi' ? { ...p, manager: false } : { ...p, capabilities: ['admin.connectors'] })),
    };
    const summary = await push(client, changed);
    expect(summary).toMatchObject({ created: 0, replaced: 2, deactivated: 1, groupsRemoved: 2 });
    expect(grantOf('hillevi')?.role).toBe('employee');
    expect(grantOf('mikael')?.capabilities).toEqual(['admin.connectors']);
    const hassan = [...store.state.users.values()].find(u => u.userName === 'hassan')!;
    expect(hassan.enabled).toBe(false);
    // The leaver is deactivated, never erased (D68 item 1); his unit group no longer lists him, so his grant is gone.
    expect(grantOf('hassan')).toBeUndefined();
    expect([...store.state.groups.values()].map(g => g.externalId).sort()).toEqual([
      'capability:admin.connectors',
      'unit:unit-it',
      'unit:unit-omsorg',
      'unit:unit-skola',
    ]);
  });
  test('a group with a foreign key is left alone, and a refused push surfaces the SCIM detail', async () => {
    const { store, client } = stack();
    store.state.groups.set('foreign', {
      id: 'foreign',
      externalId: 'S-1-5-21-ad',
      displayName: 'AD',
      createdAt: 'x',
      updatedAt: 'x',
    });
    await push(client, developmentDirectory);
    expect(store.state.groups.has('foreign')).toBe(true);
    const broken: Directory = { ...developmentDirectory, people: [{ ...developmentDirectory.people[0]!, email: '' }] };
    await expect(push(client, broken)).rejects.toMatchObject({ status: 400, scimType: 'invalidSyntax' });
  });
});
