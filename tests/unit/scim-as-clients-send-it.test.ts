import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { scimRoutes } from '../../apps/server/src/routes/scim';

/**
 * `/scim/v2` as the directories send to it, over HTTP on the memory adapter. Every case here is a request that a
 * conforming or a common client sends (RFC 7643, RFC 7644; Microsoft Entra ID, Okta, a serializer that writes nulls)
 * and that the server once answered wrongly: it stored something else, said yes and did nothing, or answered 500.
 * They were found by the review of 2026-11-11 (`docs/reviews/2026-11-11-scim-full-review.md`).
 */
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group',
  UNIT = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group',
  PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
function app(authenticate?: () => never) {
  const store = memoryProvisionStore();
  let seq = 0,
    tick = 0;
  const scim = scimUsecases({
    store,
    // A second on for every reading, so that a change has a later time than what it changed.
    clock: () => new Date(Date.UTC(2026, 10, 9, 6, 0, tick++)),
    ids: () => 'id-' + ++seq,
    digest: token => 'digest:' + token,
  });
  store.state.provisioners.set('digest:tok', { id: 'mk', organisationId: 'org', label: 'Metakatalogen' });
  const logged: string[] = [];
  const hono = scimRoutes(authenticate ? { ...scim, authenticate } : scim, message => void logged.push(message));
  const call = (method: string, path: string, body?: unknown, authorization = 'Bearer tok') =>
    hono.request('https://clew.test' + path, {
      method,
      headers: { authorization, ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const json = async (method: string, path: string, body?: unknown) => {
    const response = await call(method, path, body);
    return { status: response.status, body: response.status === 204 ? undefined : await response.json() };
  };
  const person = (n: number, extra: Record<string, unknown> = {}) => ({
    schemas: [USER],
    externalId: 'e-' + n,
    userName: 'user' + n,
    displayName: 'User ' + n,
    emails: [{ value: `user${n}@x.se`, type: 'work', primary: true }],
    active: true,
    ...extra,
  });
  const create = async (n: number, extra: Record<string, unknown> = {}) =>
    (await json('POST', '/Users', person(n, extra))).body.id as string;
  const patch = (path: string, ...Operations: unknown[]) => json('PATCH', path, { schemas: [PATCH], Operations });
  const group = async (body: Record<string, unknown>) =>
    (await json('POST', '/Groups', { schemas: [GROUP], ...body })).body.id as string;
  return { call, json, store, person, create, patch, group, logged };
}
describe('a deactivation is never refused for what stands beside it (D113)', () => {
  test('a patch that deactivates goes through although it takes a required attribute away, sets one wrongly or names a path Clew cannot read', async () => {
    const { create, patch, store } = app();
    const id = await create(1);
    const beside: unknown[][] = [
      // Entra, when the mailbox of a leaver is emptied with the account.
      [{ op: 'Remove', path: 'emails[type eq "work"].value' }],
      [{ op: 'replace', path: 'displayName', value: '' }],
      [{ op: 'replace', path: 'emails', value: [{ value: 'private@home.se', type: 'home' }] }],
      [{ op: 'replace', path: 'emails[value eq "user1@x.se"].value', value: 'other@x.se' }],
      [{ op: 'replace', value: { displayName: null, userName: 7 } }],
    ];
    for (const operations of beside) {
      store.state.users.get(id)!.enabled = true;
      const first = await patch('/Users/' + id, { op: 'Replace', path: 'active', value: 'False' }, ...operations);
      expect(first).toMatchObject({ status: 200, body: { active: false, displayName: 'User 1', userName: 'user1' } });
      expect(first.body.emails).toEqual([{ value: 'user1@x.se', type: 'work', primary: true }]);
      // In either order.
      store.state.users.get(id)!.enabled = true;
      expect(
        (await patch('/Users/' + id, ...operations, { op: 'replace', path: 'active', value: false })).body.active,
      ).toBe(false);
    }
    expect(store.state.audit.at(-1)).toMatchObject({
      action: 'scim.user.deactivated',
      details: { changed: ['enabled'], via: 'scim.user.patched' },
    });
    // The same mistakes without a deactivation are refused, and name the attribute.
    store.state.users.get(id)!.enabled = true;
    expect(await patch('/Users/' + id, { op: 'remove', path: 'emails[type eq "work"].value' })).toMatchObject({
      status: 400,
      body: { scimType: 'mutability' },
    });
    expect(await patch('/Users/' + id, { op: 'replace', path: 'displayName', value: '' })).toMatchObject({
      status: 400,
      body: { scimType: 'invalidValue' },
    });
    // A person who is already deactivated gets no such leave: only a request that says `active: false` does.
    store.state.users.get(id)!.enabled = false;
    expect((await patch('/Users/' + id, { op: 'replace', path: 'displayName', value: '' })).status).toBe(400);
    // And what is wrong about the request itself is refused whatever it does to the person.
    expect(
      await patch(
        '/Users/' + id,
        { op: 'replace', path: 'active', value: false },
        { op: 'replace', path: 'id', value: 'x' },
      ),
    ).toMatchObject({ status: 400, body: { scimType: 'mutability' } });
  });
  test('a PUT that deactivates keeps what it does not carry or gets wrong, and a PUT without externalId keeps the stored one', async () => {
    const { create, json, person } = app();
    const id = await create(1, { title: 'Rektor' });
    // The reconciliation of a leaver whose address is gone in the source: the person is deactivated.
    const left = await json('PUT', '/Users/' + id, { ...person(1), emails: [], displayName: '   ', active: false });
    expect(left).toMatchObject({ status: 200, body: { active: false, displayName: 'User 1' } });
    expect(left.body.emails[0].value).toBe('user1@x.se');
    // The same body for a person who stays is refused: nobody is left active without an address.
    expect(await json('PUT', '/Users/' + id, { ...person(1), emails: [] })).toMatchObject({
      status: 400,
      body: { detail: "Attribute 'emails' is required." },
    });
    // Okta's update, as its guide draws it: no `externalId` and no `displayName`, a name in parts.
    const okta = {
      schemas: [USER],
      id,
      userName: 'user1',
      name: { givenName: 'Ny', middleName: 'Mellan', familyName: 'Person' },
      emails: [{ primary: true, value: 'ny@x.se', type: 'work', display: 'ny@x.se' }],
      active: true,
      groups: [],
      meta: { resourceType: 'User' },
    };
    expect(await json('PUT', '/Users/' + id, okta)).toMatchObject({
      status: 200,
      body: { externalId: 'e-1', displayName: 'Ny Person', active: true, emails: [{ value: 'ny@x.se' }] },
    });
    // A new person still needs one.
    expect((await json('POST', '/Users', { ...okta, userName: 'other' })).body.detail).toBe(
      "Attribute 'externalId' is required.",
    );
  });
});
describe('null is the same as absent (RFC 7643 §2.5)', () => {
  test('a body that writes every empty attribute as null is read as one that leaves them out', async () => {
    const { json, person, create } = app();
    const nulls = person(1, {
      title: null,
      name: null,
      nickName: null,
      addresses: null,
      emails: [{ value: 'user1@x.se', type: null, primary: null, display: null }, null],
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': null,
    });
    const created = await json('POST', '/Users', nulls);
    expect(created).toMatchObject({ status: 201, body: { displayName: 'User 1', emails: [{ value: 'user1@x.se' }] } });
    const id = created.body.id;
    expect(
      (
        await json('PUT', '/Users/' + id, {
          ...nulls,
          displayName: null,
          name: { formatted: 'Från namn', givenName: null },
        })
      ).body.displayName,
    ).toBe('Från namn');
    // An empty `formatted` is no name, so the parts are read.
    expect(
      (
        await json('PUT', '/Users/' + id, {
          ...person(1),
          displayName: undefined,
          name: { formatted: '', givenName: 'A', familyName: 'B' },
        })
      ).body.displayName,
    ).toBe('A B');
    // `active: null` is absent, which enables as a body without it does.
    expect((await json('PUT', '/Users/' + id, { ...person(1), active: null })).body.active).toBe(true);
    const member = await create(2);
    const group = await json('POST', '/Groups', {
      schemas: [GROUP],
      externalId: null,
      displayName: 'Plain',
      members: [{ value: member, display: null, $ref: null }, null],
      [UNIT]: null,
    });
    expect(group).toMatchObject({ status: 201, body: { displayName: 'Plain', members: [{ value: member }] } });
    expect((await json('POST', '/Groups', { displayName: 'Empty', members: null })).status).toBe(201);
  });
  test('in a patch, null takes the attribute away: a title is cleared, a required one is refused, and a path of null is no path', async () => {
    const { create, patch, group } = app();
    const id = await create(1, { title: 'Rektor' });
    expect(
      (await patch('/Users/' + id, { op: 'replace', path: null, value: { title: null } })).body,
    ).not.toHaveProperty('title');
    for (const value of [null, [null], undefined])
      expect(await patch('/Users/' + id, { op: 'replace', path: 'emails', value })).toMatchObject({
        status: 400,
        body: { detail: expect.stringContaining('emails') },
      });
    expect((await patch('/Users/' + id, { op: 'replace', value: { displayName: null } })).status).toBe(400);
    expect(
      (await patch('/Users/' + id, { op: 'replace', path: null, value: { active: false, name: null } })).body.active,
    ).toBe(false);
    const g = await group({ externalId: 'ad:x', displayName: 'X', members: [{ value: id }] });
    expect((await patch('/Groups/' + g, { op: 'replace', value: { externalId: null } })).body).not.toHaveProperty(
      'externalId',
    );
    expect((await patch('/Groups/' + g, { op: 'remove', path: 'members', value: null })).body.members).toEqual([]);
  });
});
describe('names without regard to case, everywhere (RFC 7643 §2.1)', () => {
  test('the PatchOp envelope, a member object, the unit extension and a SearchRequest', async () => {
    const { create, json, group } = app();
    const [a, b] = [await create(1), await create(2)];
    const g = await group({
      externalId: 'unit-manager:u',
      displayName: 'Chefer',
      members: [{ value: a }, { value: b }],
    });
    // `Value` read as no value once emptied the group.
    const removed = await json('PATCH', '/Groups/' + g, {
      Schemas: [PATCH],
      operations: [{ Op: 'Remove', Path: 'Members', Value: [{ Value: a }] }],
    });
    expect(removed).toMatchObject({ status: 200, body: { members: [{ value: b }] } });
    expect(
      (
        await json('PATCH', '/Groups/' + g, {
          schemas: [PATCH],
          Operations: [{ op: 'add', path: 'members', value: [{ VALUE: a }] }],
        })
      ).body.members,
    ).toHaveLength(2);
    // `Parent` read as no parent once made a unit a root, with a 200.
    await group({ externalId: 'unit:root', displayName: 'Rot' });
    const leaf = await json('POST', '/Groups', {
      externalId: 'unit:leaf',
      displayName: 'Löv',
      [UNIT]: { Parent: 'unit:root' },
    });
    expect(leaf.body[UNIT]).toEqual({ parent: 'unit:root' });
    const kept = await json('PUT', '/Groups/' + leaf.body.id, {
      externalId: 'unit:leaf',
      displayName: 'Löv',
      [UNIT.toUpperCase()]: { PARENT: 'unit:root' },
    });
    expect(kept.body[UNIT]).toEqual({ parent: 'unit:root' });
    expect(
      (
        await json('PATCH', '/Groups/' + leaf.body.id, {
          schemas: [PATCH],
          Operations: [{ op: 'replace', value: { [UNIT]: { Parent: 'unit:root' } } }],
        })
      ).body[UNIT],
    ).toEqual({ parent: 'unit:root' });
    // `Filter` read as no filter once answered every user to a client that asked whether one existed.
    const found = await json('POST', '/Users/.search', { Filter: 'userName eq "nobody"', Count: 1, StartIndex: 1 });
    expect(found.body).toMatchObject({ totalResults: 0, Resources: [] });
    expect(
      (await json('POST', '/Users/.search', { FILTER: 'userName eq "user2"', Attributes: ['userName'] })).body
        .Resources,
    ).toEqual([{ schemas: [USER], id: b, userName: 'user2' }]);
  });
});
describe('a path this server cannot evaluate is refused, not accepted and ignored', () => {
  test('under members: only the list and the one filter are read, and add or replace says who', async () => {
    const { create, patch, group, store } = app();
    const [a, b] = [await create(1), await create(2)];
    const g = await group({
      externalId: 'unit-manager:u',
      displayName: 'Chefer',
      members: [{ value: a }, { value: b }],
    });
    for (const path of [
      `members[value eq "${a}" or value eq "${b}"]`,
      `members[type eq "User" and value eq "${a}"]`,
      'members[display eq "User 1"]',
      `members[value eq "${a}"].value`,
      `members[value eq '${a}']`,
      `members[value co "${a}"]`,
      'members.value',
    ])
      expect(await patch('/Groups/' + g, { op: 'remove', path, value: [{ value: a }] })).toMatchObject({
        status: 400,
        body: { scimType: 'invalidPath' },
      });
    for (const operation of [
      { op: 'replace', path: 'members' },
      { op: 'replace', path: 'members', value: null },
      { op: 'add', path: 'members' },
    ])
      expect(await patch('/Groups/' + g, operation)).toMatchObject({ status: 400, body: { scimType: 'invalidValue' } });
    // Nobody left the group, so both still hold the manager's grant.
    expect([a, b].map(id => store.state.grants.get(id)?.role)).toEqual(['manager', 'manager']);
    // What is read: a list, the filter, an explicit empty list, and a remove of everyone.
    expect((await patch('/Groups/' + g, { op: 'remove', path: `Members[Value EQ "${a}"]` })).body.members).toEqual([
      expect.objectContaining({ value: b }),
    ]);
    // A path-less add with the attribute under its URN adds; it once replaced everyone.
    expect(
      (await patch('/Groups/' + g, { op: 'add', value: { [GROUP + ':members']: [{ value: a }] } })).body.members,
    ).toHaveLength(2);
    expect(
      (await patch('/Groups/' + g, { op: 'add', value: { [GROUP]: { displayName: 'Nya chefer' } } })).body.displayName,
    ).toBe('Nya chefer');
    expect((await patch('/Groups/' + g, { op: 'replace', path: 'members', value: [] })).body.members).toEqual([]);
  });
  test('under emails: the work address by its filter, another type left alone, and nothing private stored as the work address', async () => {
    const { create, patch } = app();
    const id = await create(1);
    const email = async (...operations: unknown[]) => {
      const answer = await patch('/Users/' + id, ...operations);
      return answer.status === 200 ? answer.body.emails[0].value : answer.body.scimType;
    };
    // A filter that is not exactly the work address once stored a private address as it.
    for (const path of [
      'emails[type eq "home" and primary eq true].value',
      'emails[type eq "home"].value',
      'emails[type eq "other"]',
    ])
      expect(await email({ op: 'replace', path, value: 'private@home.se' })).toBe('user1@x.se');
    for (const path of [
      'emails[type ne "work"].value',
      'emails[value eq "user1@x.se"].value',
      'emails[type eq "work" or type eq "home"].value',
    ])
      expect(await email({ op: 'replace', path, value: 'private@home.se' })).toBe('invalidPath');
    expect(await email({ op: 'replace', path: 'emails[type eq "work"].value', value: 'a@x.se' })).toBe('a@x.se');
    expect(
      await email({ op: 'replace', path: 'Emails[Type EQ "Work" and Primary eq True].Value', value: 'b@x.se' }),
    ).toBe('b@x.se');
    expect(await email({ op: 'replace', path: 'emails[primary eq true].value', value: 'c@x.se' })).toBe('c@x.se');
    // A filtered address with the sub-attributes in the value (RFC 7644 §3.5.2.3) once answered 200 and changed nothing.
    expect(
      await email({ op: 'replace', path: 'emails[type eq "work"]', value: { value: 'd@x.se', type: 'work' } }),
    ).toBe('d@x.se');
    expect(await email({ op: 'replace', path: 'emails[type eq "work"].display', value: 'Shown' })).toBe('d@x.se');
    // `add` appends: a home address beside the work one is an address Clew does not hold, and changes nothing.
    expect(await email({ op: 'add', path: 'emails', value: [{ value: 'h@home.se', type: 'home' }] })).toBe('d@x.se');
    expect(await email({ op: 'replace', path: 'emails', value: [{ value: 'h@home.se', type: 'home' }] })).toBe(
      'invalidValue',
    );
    // What a list carries is checked as a body's is: no literal "null", no number, no empty address, no 500.
    for (const value of [
      42,
      [{ value: '' }],
      [{ value: 'x'.repeat(513) + '@x.se' }],
      [{ value: 5 }],
      'not\u0000ok@x.se',
    ])
      expect(await email({ op: 'replace', path: 'emails', value })).toBe('invalidValue');
    expect(await email({ op: 'replace', path: 'emails', value: [{ value: 'e@x.se', type: 5 }] })).toBe('e@x.se');
    expect(await email({ op: 'replace', value: { [USER]: { emails: 'f@x.se' } } })).toBe('f@x.se');
  });
});
describe('filters, pages and what a write answers', () => {
  test("a group is found by its name without regard to case, as the served schema says, and a filter's attribute may carry its URN", async () => {
    const { json, group, create } = app();
    await create(1);
    await group({ externalId: 'ad:larare', displayName: 'Lärare' });
    const names = async (filter: string) =>
      (await json('GET', '/Groups?filter=' + encodeURIComponent(filter))).body.Resources?.map(
        (g: { displayName: string }) => g.displayName,
      );
    expect(await names('displayName eq "LÄRARE"')).toEqual(['Lärare']);
    expect(await names('externalId eq "AD:larare"')).toEqual([]);
    expect(await names(`${GROUP}:displayName eq "lärare"`)).toEqual(['Lärare']);
    const users = async (filter: string) => (await json('GET', '/Users?filter=' + encodeURIComponent(filter))).body;
    expect((await users(`${USER}:userName eq "user1"`)).totalResults).toBe(1);
    // The value is a JSON string: `u` is `u`.
    expect((await users('userName eq "\\u0075ser1"')).totalResults).toBe(1);
    expect((await users('userName eq "user1\\q"')).scimType).toBe('invalidFilter');
    // A page that starts past anything PostgreSQL takes as an offset is an empty page, not a failure.
    expect(await json('GET', '/Users?startIndex=99999999999999999999999')).toMatchObject({
      status: 200,
      body: { totalResults: 1, startIndex: 2147483647, Resources: [] },
    });
  });
  test('attributes and excludedAttributes hold for POST, PUT and PATCH, and a projected extension leaves the schemas', async () => {
    const { create, json, patch, group, call } = app();
    const a = await create(1);
    const created = await call('POST', '/Users?attributes=userName', {
      schemas: [USER],
      externalId: 'e-9',
      userName: 'user9',
      displayName: 'User 9',
      emails: [{ value: 'u9@x.se' }],
    });
    expect(created.headers.get('location')).toMatch(/\/scim\/v2\/Users\/id-\d+$/);
    expect(Object.keys(await created.json())).toEqual(['schemas', 'id', 'userName']);
    await group({ externalId: 'unit:root', displayName: 'Rot' });
    const g = await group({
      externalId: 'unit:u',
      displayName: 'Enhet',
      members: [{ value: a }],
      [UNIT]: { parent: 'unit:root' },
    });
    const added = await json('PATCH', `/Groups/${g}?excludedAttributes=members`, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Enheten' }],
    });
    expect(added.body).not.toHaveProperty('members');
    expect(added.body.displayName).toBe('Enheten');
    expect(
      (await json('PUT', `/Users/${a}?attributes=active`, { ...(await json('GET', '/Users/' + a)).body })).body,
    ).toEqual({
      schemas: [USER],
      id: a,
      active: true,
    });
    const named = (await json('GET', `/Groups/${g}?attributes=displayName`)).body;
    expect(named).toEqual({ schemas: [GROUP], id: g, displayName: 'Enheten' });
    expect((await patch('/Groups/' + g, { op: 'add', path: 'members', value: [] })).body.schemas).toEqual([
      GROUP,
      UNIT,
    ]);
  });
  test('the schemas describe what is read and returned', async () => {
    const { json } = app();
    const schemas = (await json('GET', '/Schemas')).body.Resources as Array<{ id: string; attributes: any[] }>;
    const attribute = (schema: string, name: string) =>
      schemas.find(s => s.id === schema)!.attributes.find(a => a.name === name);
    expect(attribute(USER, 'name').subAttributes.map((a: { name: string }) => a.name)).toEqual([
      'formatted',
      'givenName',
      'familyName',
    ]);
    expect(attribute(USER, 'groups').subAttributes.find((a: { name: string }) => a.name === '$ref')).toMatchObject({
      referenceTypes: ['Group'],
      mutability: 'readOnly',
    });
    expect(
      attribute(GROUP, 'members').subAttributes.find((a: { name: string }) => a.name === '$ref').referenceTypes,
    ).toEqual(['User']);
    expect(attribute(GROUP, 'displayName').caseExact).toBe(false);
  });
});
describe('what an outside review of the merged server found (2026-11-12)', () => {
  test("a group's time of change is the same in the answer to the change and in the next read, and a repeat leaves it", async () => {
    const { create, json, patch, group } = app();
    const [a, b] = [await create(1), await create(2)];
    const g = await group({ externalId: 'ad:g', displayName: 'G' });
    const created = (await json('GET', '/Groups/' + g)).body.meta.lastModified;
    const changed = await patch('/Groups/' + g, { op: 'add', path: 'members', value: [{ value: a }] });
    // It once answered the new time here and the old one on the next read, with the new member.
    expect(changed.body.meta.lastModified > created).toBe(true);
    const read = (await json('GET', '/Groups/' + g)).body;
    expect([read.meta.lastModified, read.members.length]).toEqual([changed.body.meta.lastModified, 1]);
    // The same change again is no change.
    const repeated = await patch('/Groups/' + g, { op: 'add', path: 'members', value: [{ value: a }] });
    expect(repeated.body.meta.lastModified).toBe(read.meta.lastModified);
    const replaced = await json('PUT', '/Groups/' + g, {
      externalId: 'ad:g',
      displayName: 'G',
      members: [{ value: b }],
    });
    expect(replaced.body.meta.lastModified > read.meta.lastModified).toBe(true);
    expect((await json('GET', '/Groups/' + g)).body.meta.lastModified).toBe(replaced.body.meta.lastModified);
  });
  test('a value that says home under a path that says work is not stored as the work address', async () => {
    const { create, patch } = app();
    const id = await create(1);
    const home = await patch('/Users/' + id, {
      op: 'replace',
      path: 'emails[type eq "work"]',
      value: { value: 'private@home.se', type: 'home' },
    });
    expect(home).toMatchObject({
      status: 400,
      body: {
        scimType: 'invalidValue',
        detail: expect.stringContaining('names the work address, and the value says it is of another type'),
      },
    });
    const kept = await patch('/Users/' + id, {
      op: 'replace',
      path: 'emails[primary eq true]',
      value: [{ value: 'p@home.se', type: 'Home' }],
    });
    expect(kept.status).toBe(400);
    // A value without a type, or one that says work, is the work address the path names.
    for (const value of [
      { value: 'a@x.se' },
      { value: 'b@x.se', type: 'Work' },
      [
        { value: 'h@home.se', type: 'home' },
        { value: 'c@x.se', type: 'work' },
      ],
    ]) {
      const taken = await patch('/Users/' + id, { op: 'replace', path: 'emails[type eq "work"]', value });
      expect(taken.body.emails[0].value).toBe(Array.isArray(value) ? 'c@x.se' : value.value);
    }
    // Beside a deactivation it is passed over, as every wrong value is (D113).
    const left = await patch(
      '/Users/' + id,
      { op: 'replace', path: 'emails[type eq "work"]', value: { value: 'private@home.se', type: 'home' } },
      { op: 'replace', path: 'active', value: false },
    );
    expect(left.body).toMatchObject({ active: false, emails: [{ value: 'c@x.se' }] });
  });
});
describe('the edges of the HTTP layer', () => {
  test('the scheme without regard to case, a store that does not answer, a method an address does not take, and a body too deep or too large', async () => {
    const { call, json, person } = app();
    expect((await call('GET', '/Users', undefined, 'bearer tok')).status).toBe(200);
    expect((await call('GET', '/Users', undefined, 'BEARER   tok')).status).toBe(200);
    expect((await call('GET', '/Users', undefined, 'Basic tok')).status).toBe(401);
    for (const [method, path, allow] of [
      ['PUT', '/Users', 'GET, POST'],
      ['DELETE', '/Groups', 'GET, POST'],
      ['POST', '/Users/id-1', 'GET, PUT, PATCH, DELETE'],
      ['GET', '/Groups/.search', 'POST'],
    ] as const) {
      const response = await call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {});
      expect([response.status, response.headers.get('allow')]).toEqual([405, allow]);
      expect((await response.json()).schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    }
    // Nested past anything a resource is: a refusal, not a stack that runs out.
    const deep = (depth: number): unknown => (depth ? [deep(depth - 1)] : 'x');
    expect(await json('POST', '/Users', person(1, { emails: deep(40) }))).toMatchObject({
      status: 400,
      body: { scimType: 'invalidSyntax', detail: 'The request body is nested too deeply.' },
    });
    expect((await json('POST', '/Users', '['.repeat(200_000))).status).toBe(400);
    // A body that declares no length is stopped at the limit as it is read.
    const big = new ReadableStream({
      start(controller) {
        const piece = new TextEncoder().encode('x'.repeat(1024 * 1024));
        for (let i = 0; i < 5; i++) controller.enqueue(piece);
        controller.close();
      },
    });
    const { call: raw } = app();
    void raw;
    const hono = scimRoutes(
      scimUsecases({
        store: (() => {
          const s = memoryProvisionStore();
          s.state.provisioners.set('digest:tok', { id: 'mk', organisationId: 'org', label: 'M' });
          return s;
        })(),
        clock: () => new Date(),
        ids: () => 'x',
        digest: t => 'digest:' + t,
      }),
      () => {},
    );
    const tooLarge = await hono.request('https://clew.test/Users', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: big,
      // @ts-expect-error a streamed request body needs this in Node and Bun
      duplex: 'half',
    });
    expect(tooLarge.status).toBe(413);
  });
  test('a token that cannot be checked is the SCIM error with a time to try again, and is logged', async () => {
    const { call, logged } = app(() => {
      throw new Error('the store is down');
    });
    const response = await call('GET', '/Users');
    expect([response.status, response.headers.get('retry-after'), response.headers.get('content-type')]).toEqual([
      503,
      '5',
      'application/scim+json; charset=utf-8',
    ]);
    expect(await response.json()).toMatchObject({
      status: '503',
      detail: 'The service cannot check the token now. Retry shortly.',
    });
    expect(logged).toEqual(['scim: a token could not be checked']);
  });
  test('a boolean is read the same in a body and in a patch, and a patch says how many operations it takes', async () => {
    const { create, json, patch, person } = app();
    const id = await create(1);
    for (const word of ['False', 'FALSE', 'false', ' false '])
      expect((await json('PUT', '/Users/' + id, person(1, { active: word }))).body.active).toBe(false);
    expect((await patch('/Users/' + id, { op: 'replace', path: 'active', value: 'TRUE' })).body.active).toBe(true);
    expect((await json('PUT', '/Users/' + id, person(1, { active: 0 }))).body).toMatchObject({
      scimType: 'invalidValue',
      detail: "Attribute 'active' needs a boolean.",
    });
    const many = Array.from({ length: 501 }, () => ({ op: 'replace', path: 'title', value: 'x' }));
    expect((await patch('/Users/' + id, ...many)).body).toMatchObject({
      scimType: 'invalidSyntax',
      detail: 'A PatchOp body carries between 1 and 500 Operations.',
    });
    expect((await patch('/Users/' + id)).status).toBe(400);
    // Only space is no value for a required attribute.
    expect((await json('POST', '/Users', person(2, { userName: '   ' }))).body.scimType).toBe('invalidValue');
  });
});
