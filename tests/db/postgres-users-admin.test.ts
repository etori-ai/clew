import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, like } from 'drizzle-orm';
import type { AuthenticatedContext } from '@clew/contracts';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import {
  organisationUsecases,
  provisionerKeyUsecases,
  usersAdminUsecases,
} from '../../apps/server/src/modules/people/usecases';
import { provisionerKeyRoutes } from '../../apps/server/src/routes/provisioner-keys';
import { groupRow, userRow } from '../scim-store-contract';

/**
 * Administration › Användare and Organisation on PostgreSQL, where the memory store cannot show it: a NUL, which
 * PostgreSQL refuses to compare or store, answers as naming nothing or as a malformed request and never as 503 (K3 of
 * the 2026-11-12 review), and the operator's script writes the audit rows the page writes, the cut-off of a second
 * rotation included (K5). Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-uadm-' + randomUUID().slice(0, 8),
  org = prefix + '-org',
  store = postgresProvisionStore();
afterAll(async () => {
  const db = database();
  await db.delete(schema.audit).where(like(schema.audit.subject, 'provisioner:' + prefix + '%'));
  await db.delete(schema.audit).where(like(schema.audit.subject, 'group:' + prefix + '%'));
  await db.delete(schema.provisioners).where(like(schema.provisioners.id, prefix + '%'));
  await db.delete(schema.groupCapabilities).where(eq(schema.groupCapabilities.organisationId, org));
  const groups = (
    await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(like(schema.groups.id, prefix + '%'))
  ).map(g => g.id);
  if (groups.length) {
    await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.groupId, groups));
    await db.delete(schema.groups).where(inArray(schema.groups.id, groups));
  }
  await db.delete(schema.people).where(like(schema.people.id, prefix + '%'));
});
const admin: AuthenticatedContext = {
  id: prefix + '-admin',
  name: 'Admin',
  unitId: prefix + '-u1',
  unitLabel: 'Enhet 1',
  role: 'employee',
  organisationId: org,
  principal: { id: 'person:' + prefix + '-admin', kind: 'person' },
  capabilities: ['admin.users'],
  authorizationVersion: 'v',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v' }),
};
let tokens = 0;
const keys = {
  store,
  clock: () => new Date('2026-11-12T06:00:00.000Z'),
  token: () => prefix + '-token-' + ++tokens,
  digest: (token: string) => 'digest:' + token,
};
const usersAdmin = usersAdminUsecases(keys),
  organisation = organisationUsecases({ store }),
  operator = provisionerKeyUsecases(keys);
describe('Administration › Användare and Organisation on PostgreSQL', () => {
  test("a NUL in a unit id, a search, a group, a provisioner's id or its label is refused or names nothing, and never answers 503 (K3)", async () => {
    await store.transaction(async tx => {
      await tx.insertUser(userRow(prefix + '-admin', org, { name: 'Admin' }));
      await tx.insertGroup(groupRow(prefix + '-g1', org, { externalId: 'unit:' + prefix + '-u1', label: 'Enhet 1' }));
    });
    // What the guards stand in front of: PostgreSQL refuses to compare a NUL, which the server answers with 503.
    await expect(store.transaction(tx => tx.findGroup('externalId', 'unit:' + prefix + '\u0000'))).rejects.toThrow();
    // The key routes as the administration mounts them, with the server's mapping of errors, and beside them the
    // use cases the administration's other routes call, under the same mapping.
    const app = provisionerKeyRoutes(usersAdmin, async (c, next) => {
      c.set('session', { context: admin } as never);
      await next();
    });
    app.get('/units/:id', async c => c.json(await organisation.unit(admin, c.req.param('id'))));
    app.post('/search', async c => c.json(await usersAdmin.people(admin, await c.req.json())));
    app.post('/groups/search', async c => c.json(await usersAdmin.searchGroups(admin, (await c.req.json()).text)));
    app.post('/group-capabilities', async c => c.json(await usersAdmin.addGroupCapability(admin, await c.req.json())));
    app.post('/group-capabilities/remove', async c =>
      c.json(await usersAdmin.removeGroupCapability(admin, await c.req.json())),
    );
    const call = (path: string, body?: unknown) =>
      app.request(
        'http://internal.test' + path,
        body === undefined
          ? { method: path.startsWith('/units/') ? 'GET' : 'POST' }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      );
    const answered = async (response: Response, status: number) => {
      expect(response.status).toBe(status);
      return response.json();
    };
    expect(await answered(await call('/units/' + prefix + '-u1'), 200)).toMatchObject({ unitLabel: 'Enhet 1' });
    expect(await answered(await call('/units/' + prefix + '-u1%00'), 400)).toEqual({ error: 'Enheten finns inte.' });
    await expect(organisation.unit(admin, prefix + '-u1\u0000')).rejects.toThrow('Enheten finns inte.');
    const nobody = { rows: [], total: 0, all: 1, page: 1, pageSize: 25 };
    expect(await answered(await call('/search', { unitId: prefix + '-u1\u0000' }), 200)).toEqual(nobody);
    expect(await answered(await call('/search', { text: 'admin\u0000' }), 200)).toEqual(nobody);
    expect(await answered(await call('/search', { text: 'admin' }), 200)).toMatchObject({ total: 1 });
    expect(await answered(await call('/groups/search', { text: 'enhet\u0000' }), 200)).toEqual({ groups: [] });
    expect(await answered(await call('/groups/search', { text: 'enhet' }), 200)).toEqual({
      groups: [{ id: 'unit:' + prefix + '-u1', label: 'Enhet 1' }],
    });
    const nul = { groupExternalId: 'unit:' + prefix + '-u1\u0000', capability: 'admin.connectors' };
    expect(await answered(await call('/group-capabilities', nul), 400)).toEqual({
      error: 'Gruppen finns inte bland de provisionerade grupperna.',
    });
    expect(await answered(await call('/group-capabilities/remove', nul), 200)).toMatchObject({
      groupCapabilities: [],
    });
    for (const action of ['rotate', 'revoke'])
      expect(await answered(await call(`/${prefix}-key%00/${action}`, { graceHours: 0 }), 400)).toEqual({
        error: 'Katalogen finns inte.',
      });
    // A provisioner's label is one line without a control character: PostgreSQL cannot hold a NUL in one, and the
    // route refuses it before the store is asked.
    const nulLabel = {
      id: prefix + '-nul',
      organisationId: org,
      label: 'Meta\u0000katalogen',
      tokenDigest: 'digest:' + prefix + '-nul',
      createdBy: 'person:' + prefix + '-admin',
      createdAt: '2026-11-12T06:00:00.000Z',
    };
    await expect(store.transaction(tx => tx.issueProvisioner(nulLabel))).rejects.toThrow();
    expect(await answered(await call('/', { id: prefix + '-nul', label: 'Meta\u0000katalogen' }), 400)).toEqual({
      error: 'Ogiltig förfrågan.',
    });
    expect(
      await database()
        .select({ id: schema.provisioners.id })
        .from(schema.provisioners)
        .where(eq(schema.provisioners.id, prefix + '-nul')),
    ).toEqual([]);
  });
  test("the operator's rotate and revoke run through the use cases, with the page's audit rows and the cut-off a second rotation used (K5)", async () => {
    const id = prefix + '-key';
    await usersAdmin.issueProvisioner(admin, { id, label: 'Metakatalogen' });
    expect(await operator.rotate('bootstrap:cli', id, 24)).toEqual({
      token: prefix + '-token-2',
      previousValidUntil: '2026-11-13T06:00:00.000Z',
      endedEarlier: null,
    });
    expect(await operator.rotate('bootstrap:cli', id, 0)).toEqual({
      token: prefix + '-token-3',
      previousValidUntil: null,
      endedEarlier: '2026-11-13T06:00:00.000Z',
    });
    expect(await operator.revoke('bootstrap:cli', id)).toEqual({ id });
    expect(await operator.revoke('bootstrap:cli', id)).toBeUndefined();
    expect(await operator.rotate('bootstrap:cli', id, 24)).toBeUndefined();
    const rows = await database()
      .select({ actor: schema.audit.actor, action: schema.audit.action, details: schema.audit.details })
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'provisioner:' + id))
      .orderBy(asc(schema.audit.id));
    expect(rows).toEqual([
      {
        actor: 'person:' + prefix + '-admin',
        action: 'provisioner.added',
        details: { organisationId: org, label: 'Metakatalogen' },
      },
      {
        actor: 'bootstrap:cli',
        action: 'provisioner.rotated',
        details: { graceHours: 24, previousValidUntil: '2026-11-13T06:00:00.000Z' },
      },
      {
        actor: 'bootstrap:cli',
        action: 'provisioner.rotated',
        details: { graceHours: 0, previousValidUntil: null, endedEarlier: '2026-11-13T06:00:00.000Z' },
      },
      { actor: 'bootstrap:cli', action: 'provisioner.revoked', details: {} },
    ]);
    const [held] = await database()
      .select({ revokedAt: schema.provisioners.revokedAt, previous: schema.provisioners.previousTokenDigest })
      .from(schema.provisioners)
      .where(eq(schema.provisioners.id, id));
    expect(held).toEqual({ revokedAt: new Date('2026-11-12T06:00:00.000Z'), previous: null });
  });
});
