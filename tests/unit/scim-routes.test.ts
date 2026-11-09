import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';

/** `/scim/v2` as a client meets it (RFC 7644, D68): the token gate, discovery, the resource round trip and the error resource. */
function app() {
  const store = memoryProvisionStore();
  let seq = 0;
  const scim = scimUsecases({
    store,
    clock: () => new Date('2026-11-09T06:00:00.000Z'),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  store.state.provisioners.set('digest:good-token', { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' });
  // The sub-app alone: `hono` is not resolvable from the repository root, and the base address is derived, not mounted.
  const hono = scimRoutes(scim);
  const call = (method: string, path: string, body?: unknown, token = 'good-token') =>
    hono.request('https://clew.test' + path, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/scim+json' } : {}),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { call, store };
}
const anna = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: 'mk-1',
  userName: 'annber',
  displayName: 'Anna Berg',
  emails: [{ value: 'anna.berg@sundsvall.se', type: 'work' }],
};
describe('/scim/v2', () => {
  test('without a provisioner token every address answers 401 with the SCIM error resource and a challenge', async () => {
    const { call } = app();
    for (const [method, path] of [
      ['GET', '/ServiceProviderConfig'],
      ['GET', '/Users'],
      ['POST', '/Users'],
    ] as const) {
      const response = await call(method, path, method === 'POST' ? anna : undefined, '');
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer realm="scim"');
      expect(response.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
      expect(await response.json()).toEqual({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '401',
        detail: 'A bearer token issued to a provisioner is required.',
      });
    }
    expect((await call('GET', '/Users', undefined, 'wrong')).status).toBe(401);
  });
  test('discovery describes the server: patch and filter on, bulk off, two resource types, two schemas', async () => {
    const { call } = app();
    const config = await (await call('GET', '/ServiceProviderConfig')).json();
    expect(config).toMatchObject({
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true, maxResults: 200 },
      etag: { supported: false },
    });
    expect(config.meta.location).toBe('https://clew.test/scim/v2/ServiceProviderConfig');
    const types = await (await call('GET', '/ResourceTypes')).json();
    expect(types.Resources.map((r: { id: string }) => r.id)).toEqual(['User', 'Group']);
    expect((await call('GET', '/ResourceTypes/Group')).status).toBe(200);
    expect((await call('GET', '/ResourceTypes/Device')).status).toBe(404);
    const schemas = await (await call('GET', '/Schemas')).json();
    expect(schemas.totalResults).toBe(2);
    expect((await call('GET', '/Schemas/urn:ietf:params:scim:schemas:core:2.0:User')).status).toBe(200);
  });
  test('a user is created, read, listed by filter, patched and deactivated over HTTP', async () => {
    const { call, store } = app();
    const created = await call('POST', '/Users', anna);
    expect(created.status).toBe(201);
    expect(created.headers.get('location')).toBe('https://clew.test/scim/v2/Users/id-1');
    expect(created.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
    expect(created.headers.get('cache-control')).toBe('no-store, private');
    const user = await created.json();
    expect(user).toMatchObject({ id: 'id-1', userName: 'annber', active: true });
    expect((await (await call('GET', '/Users/id-1')).json()).userName).toBe('annber');
    const listed = await (
      await call('GET', '/Users?filter=' + encodeURIComponent('userName eq "annber"') + '&count=10')
    ).json();
    expect(listed).toMatchObject({ totalResults: 1, itemsPerPage: 1, Resources: [{ id: 'id-1' }] });
    const patched = await call('PATCH', '/Users/id-1', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', value: { active: false } }],
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).active).toBe(false);
    const group = await call('POST', '/Groups', {
      displayName: 'Skola',
      externalId: 'unit:skola',
      members: [{ value: 'id-1' }],
    });
    expect(group.status).toBe(201);
    expect(store.state.grants.get('id-1')).toMatchObject({ unitId: 'skola' });
    expect((await call('DELETE', '/Users/id-1')).status).toBe(204);
    expect(store.state.users.get('id-1')?.enabled).toBe(false);
    expect((await call('DELETE', '/Groups/id-2')).status).toBe(204);
    expect(store.state.grants.get('id-1')).toBeUndefined();
  });
  test('a unique index that fires in a race answers the same 409 as the check, naming the attribute when Postgres names the index', async () => {
    const violation = (constraint?: string, wrapped = false) => {
      const raw = Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
        ...(constraint ? { constraint_name: constraint } : {}),
      });
      return wrapped ? Object.assign(new Error('Failed query'), { cause: raw }) : raw;
    };
    const store = memoryProvisionStore();
    store.state.provisioners.set('digest:t', { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' });
    const scim = scimUsecases({ store, clock: () => new Date(), ids: () => 'x', digest: t => 'digest:' + t });
    const throwing = (error: Error) =>
      scimRoutes({ ...scim, createUser: async () => Promise.reject(error) }).request('https://clew.test/Users', {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/scim+json' },
        body: JSON.stringify(anna),
      });
    const named = await throwing(violation('auth_person_user_name'));
    expect(named.status).toBe(409);
    expect(await named.json()).toMatchObject({
      status: '409',
      scimType: 'uniqueness',
      detail: 'A resource with this userName already exists.',
    });
    expect(await (await throwing(violation('auth_group_external_id', true))).json()).toMatchObject({
      status: '409',
      detail: 'A resource with this externalId already exists.',
    });
    expect(await (await throwing(violation())).json()).toMatchObject({
      status: '409',
      detail: 'A resource with this userName or externalId already exists.',
    });
    expect((await throwing(new Error('something else'))).status).toBe(500);
  });
  test('mistakes come back as the error resource: not JSON, wrong shape, unknown id, conflict, unknown address', async () => {
    const { call } = app();
    expect(await (await call('POST', '/Users', '{not json')).json()).toMatchObject({
      status: '400',
      scimType: 'invalidSyntax',
      detail: 'The request body is not JSON.',
    });
    expect(await (await call('POST', '/Users', { userName: 1 })).json()).toMatchObject({
      status: '400',
      scimType: 'invalidSyntax',
    });
    expect(await (await call('POST', '/Users', { ...anna, externalId: undefined })).json()).toMatchObject({
      status: '400',
      scimType: 'invalidValue',
    });
    expect((await call('GET', '/Users/nobody')).status).toBe(404);
    await call('POST', '/Users', anna);
    expect(await (await call('POST', '/Users', anna)).json()).toMatchObject({ status: '409', scimType: 'uniqueness' });
    expect(await (await call('GET', '/Me')).json()).toMatchObject({ status: '404', detail: 'No such SCIM resource.' });
    expect((await call('GET', '/Users?filter=' + encodeURIComponent('userName co "a"'))).status).toBe(400);
  });
});
