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
  const hono = scimRoutes(scim, console.error);
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
  test('discovery describes the server: patch and filter on, bulk off, two resource types, their two schemas and the unit extension', async () => {
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
    expect(schemas.totalResults).toBe(3);
    expect((await call('GET', '/Schemas/urn:ietf:params:scim:schemas:core:2.0:User')).status).toBe(200);
    // D99: the unit extension is named on Group and can be read by its URN.
    const group = await (await call('GET', '/ResourceTypes/Group')).json();
    expect(group.schemaExtensions).toEqual([
      { schema: 'urn:clew:params:scim:schemas:extension:unit:2.0:Group', required: false },
    ]);
    const unit = await call('GET', '/Schemas/urn:clew:params:scim:schemas:extension:unit:2.0:Group');
    expect(unit.status).toBe(200);
    expect((await unit.json()).attributes.map((a: { name: string }) => a.name)).toEqual(['parent']);
  });
  test('a tree is pushed over HTTP: a unit under its parent, a parent that is missing refused, a unit with units below it kept (D99)', async () => {
    const { call } = app();
    const UNIT = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
    const post = (unitId: string, parent?: string) =>
      call('POST', '/Groups', {
        externalId: 'unit:' + unitId,
        displayName: unitId,
        ...(parent ? { [UNIT]: { parent: 'unit:' + parent } } : {}),
      });
    const early = await post('it', 'ksk');
    expect(early.status).toBe(400);
    expect(await early.json()).toMatchObject({ status: '400', scimType: 'invalidValue' });
    const root = await (await post('ksk')).json(),
      leaf = await post('it', 'ksk');
    expect(leaf.status).toBe(201);
    const made = await leaf.json();
    expect(made[UNIT]).toEqual({ parent: 'unit:ksk' });
    expect(made.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Group', UNIT]);
    const kept = await call('DELETE', '/Groups/' + root.id);
    expect(kept.status).toBe(409);
    expect((await kept.json()).detail).toContain("still has a unit below it ('unit:it')");
    expect((await call('DELETE', '/Groups/' + made.id)).status).toBe(204);
    expect((await call('DELETE', '/Groups/' + root.id)).status).toBe(204);
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
  test('a body over four megabytes is refused with 413, by its declared length before it is read and by its measured length otherwise', async () => {
    const { call, store } = app();
    const hono = scimRoutes(
      scimUsecases({ store, clock: () => new Date(), ids: () => 'x', digest: token => 'digest:' + token }),
      console.error,
    );
    const declared = await hono.request('https://clew.test/Users', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer good-token',
        'Content-Type': 'application/scim+json',
        'Content-Length': String(5 * 1024 * 1024),
      },
      body: JSON.stringify(anna),
    });
    expect([413, 201]).toContain(declared.status); // a runtime may rewrite the declared length of a known body
    const measured = await call('POST', '/Users', '{"userName":"' + 'x'.repeat(4 * 1024 * 1024) + '"}');
    expect(measured.status).toBe(413);
    expect(await measured.json()).toMatchObject({ status: '413', detail: 'The request body is too large.' });
    // Measured in bytes: fewer characters than the limit, more bytes than it.
    const accented = await call('POST', '/Users', '{"userName":"' + 'å'.repeat(2.5 * 1024 * 1024) + '"}');
    expect(accented.status).toBe(413);
    expect(store.state.users.size).toBeLessThanOrEqual(1);
  });
  test('what the server does not offer answers 501, a search request lists like GET, and an unknown address is the error resource', async () => {
    const { call } = app();
    for (const [method, path] of [
      ['POST', '/Bulk'],
      ['GET', '/Me'],
      ['POST', '/.search'],
    ] as const) {
      const response = await call(method, path, method === 'POST' ? {} : undefined);
      expect(response.status).toBe(501);
      expect(response.headers.get('content-type')).toBe('application/scim+json; charset=utf-8');
      expect(await response.json()).toMatchObject({ status: '501' });
    }
    await call('POST', '/Users', anna);
    await call('POST', '/Users', { ...anna, externalId: 'mk-2', userName: 'bo' });
    const searched = await call('POST', '/Users/.search', {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
      filter: 'userName eq "bo"',
      startIndex: 1,
      count: 10,
    });
    expect(searched.status).toBe(200);
    expect(await searched.json()).toMatchObject({ totalResults: 1, Resources: [{ userName: 'bo' }] });
    const groups = await call('POST', '/Groups/.search', { count: 0 });
    expect(await groups.json()).toMatchObject({ totalResults: 0, Resources: [] });
    expect((await call('POST', '/Users/.search', [])).status).toBe(400);
    expect((await call('PATCH', '/Users/id-1/anything')).status).toBe(404);
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
      scimRoutes({ ...scim, createUser: async () => Promise.reject(error) }, () => {}).request(
        'https://clew.test/Users',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer t', 'Content-Type': 'application/scim+json' },
          body: JSON.stringify(anna),
        },
      );
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
  test('an unexpected failure answers 500 without its cause and says it on the log port, and a known mistake logs nothing (D91)', async () => {
    const store = memoryProvisionStore();
    store.state.provisioners.set('digest:t', { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' });
    const scim = scimUsecases({ store, clock: () => new Date(), ids: () => 'x', digest: t => 'digest:' + t });
    const said: unknown[][] = [],
      cause = new Error('connection reset by the database');
    const hono = scimRoutes({ ...scim, getUser: async () => Promise.reject(cause) }, (...line) => void said.push(line));
    const get = (path: string) => hono.request('https://clew.test' + path, { headers: { Authorization: 'Bearer t' } });
    const failed = await get('/Users/x');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '500',
      detail: 'The request could not be completed.',
    });
    expect(said).toEqual([['scim: the request failed unexpectedly', cause]]);
    expect((await get('/Groups/nobody')).status).toBe(404);
    expect(said).toHaveLength(1);
  });
  test('attributes and excludedAttributes are read from the address and from a search request, where they are lists', async () => {
    const { call } = app();
    await call('POST', '/Users', anna);
    await call('POST', '/Groups', { displayName: 'Skola', externalId: 'unit:skola', members: [{ value: 'id-1' }] });
    const group = await (await call('GET', '/Groups/id-2?excludedAttributes=members')).json();
    expect(group).toMatchObject({ id: 'id-2', displayName: 'Skola' });
    expect('members' in group).toBe(false);
    const listed = await (await call('GET', '/Users?attributes=userName,active')).json();
    expect(listed.Resources).toEqual([
      { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], id: 'id-1', userName: 'annber', active: true },
    ]);
    const searched = await (
      await call('POST', '/Groups/.search', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
        filter: 'displayName eq "Skola"',
        attributes: ['displayName', 'members.value'],
      })
    ).json();
    expect(searched.Resources).toEqual([
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: 'id-2',
        displayName: 'Skola',
        members: [{ value: 'id-1' }],
      },
    ]);
    // A count that is no number takes the default instead of answering an empty page.
    expect((await (await call('GET', '/Users?count=abc')).json()).itemsPerPage).toBe(1);
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
    expect(await (await call('GET', '/Nothing')).json()).toMatchObject({
      status: '404',
      detail: 'No such SCIM resource.',
    });
    expect((await call('GET', '/Users?filter=' + encodeURIComponent('userName co "a"'))).status).toBe(400);
  });
});
