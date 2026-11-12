import { SCIM_EMPLOYMENT_SCHEMA } from '@clew/contracts';
import { describe, expect, test } from 'bun:test';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases, staffUsecases } from '../../apps/server/src/modules/people/usecases';
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
  const json = async (method: string, path: string, body?: unknown, authorization?: string) => {
    const response = await call(method, path, body, authorization);
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
describe('phone numbers on a SCIM user', () => {
  const work = { type: 'work', value: '010-100 00 01' };
  const mobile = { type: 'mobile', value: '070-100 00 02' };
  test('discovery, create, read and full replacement preserve every category and several numbers of one type', async () => {
    const { json, person } = app();
    const schema = (await json('GET', '/Schemas/' + USER)).body;
    expect(schema.attributes).toContainEqual(
      expect.objectContaining({ name: 'phoneNumbers', multiValued: true, required: false }),
    );
    const created = await json(
      'POST',
      '/Users',
      person(1, {
        PhoneNumbers: [
          { Type: 'HOME', Value: 'private' },
          { value: 'untyped' },
          { Type: 'MOBILE', Value: mobile.value },
          work,
          { type: 'work', value: 'second' },
        ],
      }),
    );
    const all = [
      { type: 'home', value: 'private' },
      { type: 'other', value: 'untyped' },
      mobile,
      work,
      { type: 'work', value: 'second' },
    ];
    expect(created).toMatchObject({ status: 201, body: { phoneNumbers: all } });
    const path = '/Users/' + created.body.id;
    expect((await json('GET', path)).body.phoneNumbers).toEqual(all);
    expect((await json('GET', '/Users?attributes=phoneNumbers.value')).body.Resources[0].phoneNumbers).toEqual(
      all.map(({ value }) => ({ value })),
    );
    expect((await json('PUT', path, person(1, { phoneNumbers: [mobile] }))).body.phoneNumbers).toEqual([mobile]);
    expect((await json('PUT', path, person(1))).body).not.toHaveProperty('phoneNumbers');
    expect((await json('GET', path)).body).not.toHaveProperty('phoneNumbers');
  });
  test('patches can update one type, append to the list, replace it, or clear it', async () => {
    const { create, patch, json, store } = app();
    const id = await create(1, { phoneNumbers: [work] }),
      path = '/Users/' + id;
    const added = await patch(path, { op: 'Add', value: { phoneNumbers: [mobile] } });
    expect(added.body.phoneNumbers).toEqual([work, mobile]);
    expect(store.state.audit.at(-1)?.details).toEqual({
      changed: ['phoneNumbers'],
      userName: 'user1',
      externalId: 'e-1',
    });
    const audited = store.state.audit.length;
    await patch(
      path,
      { op: 'add', path: 'phoneNumbers', value: [mobile] },
      { op: 'remove', path: 'phoneNumbers[type eq "pager"]' },
    );
    expect(store.state.audit.length).toBe(audited);
    const changed = await patch(path, {
      op: 'replace',
      path: USER + ':PhoneNumbers[Type eq "Mobile"].Value',
      value: '070-100 00 03',
    });
    expect(changed.body.phoneNumbers).toEqual([work, { type: 'mobile', value: '070-100 00 03' }]);
    const removed = await patch(path, { op: 'remove', path: 'phoneNumbers[type eq "work"]' });
    expect(removed.body.phoneNumbers).toEqual([{ type: 'mobile', value: '070-100 00 03' }]);
    expect((await patch(path, { op: 'replace', value: { phoneNumbers: [work] } })).body.phoneNumbers).toEqual([work]);
    expect(
      (await patch(path, { op: 'replace', path: 'phoneNumbers[type eq "work"].value', value: null })).body,
    ).not.toHaveProperty('phoneNumbers');
    await patch(path, { op: 'add', path: 'phoneNumbers[type eq "mobile"]', value: { Value: mobile.value } });
    await patch(path, { op: 'remove', path: 'phoneNumbers' });
    expect((await json('GET', path)).body).not.toHaveProperty('phoneNumbers');
  });
  test('two numbers with the same category can be managed independently and reused in another category', async () => {
    const { patch, create, json } = app();
    const second = { type: 'work', value: '010-100 00 03' };
    const duty = { type: 'Jour', value: work.value };
    const path = '/Users/' + (await create(1, { phoneNumbers: [work, second, duty] }));
    await patch(path, { op: 'add', path: 'phoneNumbers', value: [second, mobile] });
    const result = await patch(path, { op: 'remove', path: `phoneNumbers[value eq "${second.value}"]` });
    expect(result.body.phoneNumbers).toEqual([work, duty, mobile]);
    await patch(path, { op: 'remove', path: 'phoneNumbers[type eq "jour"]' });
    expect((await json('GET', path)).body.phoneNumbers).toEqual([work, mobile]);
  });
  test('a number Clew cannot read is left out and refuses nobody, and one that is emptied is taken away', async () => {
    const { patch, json, person } = app();
    // The fields of a directory that holds no number for somebody: empty, null, a number, only space, far too long.
    const none = [
      { type: 'mobile', value: '' },
      { type: 'mobile', value: null },
      { type: 'work', value: 46701000002 },
      { value: '   ' },
      { type: 'work', value: '1'.repeat(513) },
      null,
      7,
    ];
    const created = await json('POST', '/Users', person(1, { phoneNumbers: [...none, mobile] }));
    expect(created).toMatchObject({ status: 201, body: { phoneNumbers: [mobile] } });
    const path = '/Users/' + created.body.id;
    expect(await json('PUT', path, person(1, { displayName: 'Renamed', phoneNumbers: none }))).toMatchObject({
      status: 200,
      body: { displayName: 'Renamed' },
    });
    expect((await json('GET', path)).body).not.toHaveProperty('phoneNumbers');
    // A number is kept as sent, less the space around it; a type that cannot be read is the one for those without.
    const read = await json(
      'PUT',
      path,
      person(1, {
        phoneNumbers: [
          { type: ' Mobile ', value: ' 070-100\t00 02 ' },
          { type: 5, value: '1' },
          { type: 'x'.repeat(80), value: '2' },
          { type: 'mobile', value: '070-100 00 02' },
        ],
      }),
    );
    expect(read.body.phoneNumbers).toEqual([
      mobile,
      { type: 'other', value: '1' },
      { type: 'x'.repeat(64), value: '2' },
    ]);
    // Emptied in the source: the number is taken away, by its type or by its value.
    await json('PUT', path, person(1, { phoneNumbers: [work, mobile] }));
    expect(
      (await patch(path, { op: 'replace', path: 'phoneNumbers[type eq "mobile"].value', value: '' })).body.phoneNumbers,
    ).toEqual([work]);
    expect(
      (await patch(path, { op: 'replace', path: `phoneNumbers[value eq "${work.value}"].value`, value: '  ' })).body,
    ).not.toHaveProperty('phoneNumbers');
    // Entra sends a person's first number of a type by its filter.
    expect(
      (await patch(path, { op: 'Add', path: 'phoneNumbers[type eq "mobile"].value', value: mobile.value })).body
        .phoneNumbers,
    ).toEqual([mobile]);
    // Clew holds a type and a value. A client can include a primary predicate when only one number matches.
    expect(
      (await patch(path, { op: 'replace', path: 'phoneNumbers[type eq "mobile"].display', value: 'Shown' })).body
        .phoneNumbers,
    ).toEqual([mobile]);
    expect(
      (
        await patch(path, {
          op: 'replace',
          path: 'phoneNumbers[type eq "mobile" and primary eq true].value',
          value: '070-9',
        })
      ).body.phoneNumbers,
    ).toEqual([{ type: 'mobile', value: '070-9' }]);
    expect(
      (await patch(path, { op: 'replace', path: 'phoneNumbers[type eq "mobile"].type', value: 'Jour' })).body
        .phoneNumbers,
    ).toEqual([{ type: 'Jour', value: '070-9' }]);
  });
  test('a primary predicate cannot choose among repeated types or shared values', async () => {
    const { create, json, patch } = app();
    const second = { ...mobile, value: '070-100 00 03' };
    const shared = { ...work, value: mobile.value };
    const phoneNumbers = [mobile, second, shared];
    const path = '/Users/' + (await create(1, { phoneNumbers }));
    const byType = 'phoneNumbers[type eq "mobile" and primary eq true]';
    for (const operation of [
      { op: 'replace', path: byType + '.value', value: '070-100 00 04' },
      { op: 'add', path: byType + '.value', value: '070-100 00 04' },
      { op: 'add', path: byType, value: { value: '070-100 00 04' } },
      { op: 'replace', path: byType + '.type', value: 'work' },
      { op: 'remove', path: `phoneNumbers[value eq "${mobile.value}" and primary eq false]` },
    ]) {
      expect(await patch(path, operation)).toMatchObject({ status: 400, body: { scimType: 'invalidPath' } });
      expect((await json('GET', path)).body.phoneNumbers).toEqual(phoneNumbers);
    }
    const corrected = [mobile, { ...second, value: '070-100 00 04' }, shared];
    await patch(path, { op: 'replace', path: 'phoneNumbers', value: corrected });
    expect((await json('GET', path)).body.phoneNumbers).toEqual(corrected);
    expect(
      await patch(path, { op: 'remove', path: byType }, { op: 'replace', path: 'active', value: false }),
    ).toMatchObject({ status: 200 });
    expect((await json('GET', path)).body).toMatchObject({ active: false, phoneNumbers: corrected });
    await patch(path, { op: 'replace', path: 'phoneNumbers[type eq "mobile"].value', value: second.value });
    expect((await json('GET', path)).body.phoneNumbers).toEqual([second, shared]);
  });
  test('what a request gets wrong about the numbers is refused by name, and never beside a deactivation', async () => {
    const { create, patch, json, person } = app();
    const path = '/Users/' + (await create(1, { phoneNumbers: [mobile] }));
    const many = Array.from({ length: 51 }, (_, n) => ({ type: 'work', value: 'n' + n }));
    const wrong: Array<[unknown, string, RegExp]> = [
      [
        { op: 'replace', path: 'phoneNumbers[unsupported eq "x"].value', value: '123' },
        'invalidPath',
        /^Path 'phoneNumbers\[unsupported eq "x"\]\.value' is not supported: use 'phoneNumbers'/,
      ],
      [{ op: 'replace', path: 'phoneNumbers.value', value: '123' }, 'invalidPath', /is not supported/],
      [
        { op: 'replace', path: 'phoneNumbers[value eq "nobody"].value', value: '123' },
        'noTarget',
        /^No phone number matches the filter of /,
      ],
      [
        { op: 'add', path: 'phoneNumbers[type eq "mobile"]', value: { type: 'work', value: '1' } },
        'invalidValue',
        /^The number's type 'work' is not the one the path names, 'mobile'\.$/,
      ],
      [
        { op: 'add', path: 'phoneNumbers', value: many },
        'invalidValue',
        /^Attribute 'phoneNumbers' carries at most 50 entries\.$/,
      ],
    ];
    for (const [operation, scimType, detail] of wrong) {
      const refused = await patch(path, operation);
      expect(refused).toMatchObject({ status: 400, body: { scimType } });
      expect(refused.body.detail).toMatch(detail);
      expect((await json('GET', path)).body.phoneNumbers).toEqual([mobile]);
      // In either order, the person is deactivated and the numbers are as they were (D113).
      expect(await patch(path, operation, { op: 'replace', path: 'active', value: false })).toMatchObject({
        status: 200,
        body: { active: false, phoneNumbers: [mobile] },
      });
      await patch(path, { op: 'replace', path: 'active', value: true });
    }
    expect(await json('PUT', path, person(1, { phoneNumbers: many }))).toMatchObject({
      status: 400,
      body: { detail: "Attribute 'phoneNumbers' carries at most 50 entries." },
    });
    expect(await json('PUT', path, person(1, { active: false, phoneNumbers: many }))).toMatchObject({
      status: 200,
      body: { active: false, phoneNumbers: [mobile] },
    });
  });
});
describe('current employments on a SCIM user', () => {
  const urn = SCIM_EMPLOYMENT_SCHEMA,
    field = urn + ':employments';
  const jobs = [
    { unitId: 'school', title: 'Lärare' },
    { unitId: 'school', title: 'Samordnare' },
  ];
  /** The two units the employments of these tests are on: a unit is sent before an employment names it. */
  const units = async (group: ReturnType<typeof app>['group']) => ({
    school: await group({ externalId: 'unit:school', displayName: 'Skolan' }),
    office: await group({ externalId: 'unit:office', displayName: 'Kansliet' }),
  });
  test('an add or replace without a value is refused on every user path and path-less, with one scimType, and waits beside a deactivation (Q1)', async () => {
    const { create, group, json, patch, person, store } = app();
    await units(group);
    const phoneNumbers = [{ type: 'work', value: '010-100 00 01' }];
    const stored = { title: 'Pedagog', phoneNumbers, [urn]: { employments: jobs } };
    const id = await create(1, stored),
      path = '/Users/' + id;
    const held = async () => (await json('GET', path)).body;
    const before = await held(),
      audited = store.state.audit.length;
    // Each list in every form it is named by, the title, what Clew requires, and an attribute Clew does not hold.
    const missing: Array<[Record<string, unknown>, string]> = [];
    for (const op of ['add', 'replace'])
      for (const attribute of [
        'phoneNumbers',
        USER + ':phoneNumbers',
        'phoneNumbers[type eq "work"]',
        'phoneNumbers[type eq "work"].value',
        'phoneNumbers[value eq "010-100 00 01"]',
        urn,
        field,
        'title',
        'displayName',
        'userName',
        'emails',
        'active',
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
      ])
        missing.push([{ op, path: attribute }, `Operation '${op}' on '${attribute}' requires a value.`]);
    for (const op of ['add', 'replace']) {
      missing.push([{ op }, `Operation '${op}' without a path requires a value.`]);
      // The extension's object says which of its attributes it sets; one that names none has no value for the list.
      missing.push([{ op, path: urn, value: {} }, `Operation '${op}' on '${urn}' requires a value for 'employments'.`]);
      missing.push([
        { op, value: { [urn]: { other: 1 } } },
        `Operation '${op}' on '${urn}' requires a value for 'employments'.`,
      ]);
    }
    missing.push([{ op: 'replace', value: 'Changed' }, 'A patch without a path needs an object value.']);
    for (const [operation, detail] of missing) {
      const answer = await patch(path, { op: 'replace', path: 'displayName', value: 'Changed' }, operation);
      expect([answer.status, answer.body.scimType, answer.body.detail]).toEqual([400, 'invalidValue', detail]);
      expect(await held()).toEqual(before);
    }
    expect(store.state.audit).toHaveLength(audited);
    // Beside a deactivation each waits: the person is deactivated, in either order and in Okta's path-less form, and
    // what the operation named is as it was.
    for (const [operation] of missing)
      for (const operations of [
        [operation, { op: 'replace', path: 'active', value: false }],
        [{ op: 'replace', value: { active: false } }, operation],
      ]) {
        const left = await patch(path, ...operations);
        expect(left).toMatchObject({ status: 200, body: { ...stored, active: false, displayName: 'User 1' } });
        await patch(path, { op: 'replace', path: 'active', value: true });
      }
    // An explicit null takes a list away, by its path and in the extension's object; so does a remove. (The URN holds
    // a dot, so the answer is read by key and not by a property path.)
    for (const [operation, gone] of [
      [{ op: 'add', path: 'phoneNumbers', value: null }, 'phoneNumbers'],
      [{ op: 'replace', path: urn, value: { Employments: null } }, urn],
      [{ op: 'add', value: { [urn]: { employments: null } } }, urn],
      [{ op: 'replace', path: field, value: null }, urn],
      [{ op: 'remove', path: 'phoneNumbers' }, 'phoneNumbers'],
      [{ op: 'remove', path: urn }, urn],
    ] as const) {
      await json('PUT', path, person(1, stored));
      const taken = await patch(path, operation);
      expect([taken.status, taken.body[gone]]).toEqual([200, undefined]);
      expect(taken.body[gone === urn ? 'phoneNumbers' : urn]).toBeDefined();
    }
  });
  test('a remove of a whole list that carries a value is refused and says how to take one entry away, and waits beside a deactivation (S6)', async () => {
    const { create, group, json, patch, store } = app();
    await units(group);
    const phoneNumbers = [
      { type: 'work', value: '010-100 00 01' },
      { type: 'mobile', value: '070-100 00 02' },
    ];
    const stored = { phoneNumbers, [urn]: { employments: jobs } };
    const path = '/Users/' + (await create(1, stored));
    const audited = store.state.audit.length;
    const phones =
        /takes no value: it takes away every number\. To take away one number, remove phoneNumbers\[value eq "<number>"\]; to set the list, replace 'phoneNumbers'\.$/,
      employments = new RegExp(
        `takes no value: it takes away every employment\\. To change the list, replace '${field}' with the employments that remain\\.$`,
      );
    for (const [operation, detail] of [
      [{ op: 'remove', path: 'phoneNumbers', value: [phoneNumbers[0]] }, phones],
      [{ op: 'Remove', path: USER + ':PhoneNumbers', value: phoneNumbers[0] }, phones],
      [{ op: 'remove', path: 'phoneNumbers', value: [] }, phones],
      [{ op: 'remove', path: urn, value: { employments: [jobs[0]] } }, employments],
      [{ op: 'remove', path: field, value: [jobs[0]] }, employments],
    ] as const) {
      const refused = await patch(path, operation);
      expect([refused.status, refused.body.scimType]).toEqual([400, 'invalidValue']);
      expect(refused.body.detail).toStartWith(`Operation 'remove' on '${operation.path}' takes no value`);
      expect(refused.body.detail).toMatch(detail);
      expect((await json('GET', path)).body).toMatchObject(stored);
      // Beside a deactivation the person is deactivated and the list stays.
      expect(await patch(path, operation, { op: 'replace', path: 'active', value: false })).toMatchObject({
        status: 200,
        body: { ...stored, active: false },
      });
      await patch(path, { op: 'replace', path: 'active', value: true });
    }
    expect(store.state.audit.slice(audited).map(row => row.action)).toEqual(
      Array(5).fill(['scim.user.deactivated', 'scim.user.reactivated']).flat(),
    );
    // A filtered remove takes what its filter names; a remove with no value, or a value of null, takes the list.
    expect((await patch(path, { op: 'remove', path: 'phoneNumbers[type eq "mobile"]' })).body.phoneNumbers).toEqual([
      phoneNumbers[0],
    ]);
    expect((await patch(path, { op: 'remove', path: 'phoneNumbers', value: null })).body).not.toHaveProperty(
      'phoneNumbers',
    );
    expect((await patch(path, { op: 'remove', path: field })).body[urn]).toBeUndefined();
  });
  test('employment type and start date belong to each job and can be withdrawn independently', async () => {
    const { create, group, json, patch, person } = app();
    await units(group);
    const base = { unitId: 'school', title: 'Lärare' };
    const first = { ...base, employmentType: 'Tillsvidare', startDate: '2024-02-29' };
    const id = await create(1, {
      [urn]: { employments: [{ ...base, EmploymentType: 'Tillsvidare', StartDate: first.startDate }] },
    });
    const path = '/Users/' + id;
    const otherType = { ...first, employmentType: 'Vikariat' };
    const otherDate = { ...first, startDate: '2025-02-28' };
    const add = { op: 'add', path: field, value: [otherType, otherDate] };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await patch(path, add)).body[urn].employments).toEqual([first, otherType, otherDate]);
    }
    expect((await json('GET', path + '?attributes=' + field + '.startDate')).body[urn].employments).toEqual(
      [first, otherType, otherDate].map(({ startDate }) => ({ startDate })),
    );
    const schema = (await json('GET', '/Schemas/' + urn)).body;
    for (const name of ['employmentType', 'startDate']) {
      expect(schema.attributes[0].subAttributes).toContainEqual(
        expect.objectContaining({ name, type: 'string', required: false }),
      );
    }
    const typeOnly = { ...base, employmentType: 'Vikariat' };
    const dateOnly = { ...base, startDate: first.startDate };
    const changed = await patch(path, {
      op: 'replace',
      path: field,
      value: [
        { ...typeOnly, startDate: '2025-02-29' },
        { ...dateOnly, employmentType: null },
      ],
    });
    expect(changed.body[urn].employments).toEqual([typeOnly, dateOnly]);
    expect((await json('PUT', path, person(1, { [urn]: { employments: [base] } }))).body[urn].employments).toEqual([
      base,
    ]);
  });
  test('each employment carries its own optional percentage of full time', async () => {
    const { create, group, json, patch, person } = app();
    await units(group);
    const job = { unitId: 'school', title: 'Lärare' };
    const first = { ...job, employmentPercentage: 60 };
    const second = { ...job, employmentPercentage: 40 };
    const id = await create(1, { [urn]: { employments: [{ ...job, EmploymentPercentage: 60 }, second] } });
    const path = '/Users/' + id;
    expect((await json('GET', path)).body[urn].employments).toEqual([first, second]);
    expect((await json('GET', path + '?attributes=' + field + '.employmentPercentage')).body[urn].employments).toEqual([
      { employmentPercentage: 60 },
      { employmentPercentage: 40 },
    ]);
    expect((await json('GET', '/Schemas/' + urn)).body.attributes[0].subAttributes).toContainEqual(
      expect.objectContaining({ name: 'employmentPercentage', type: 'decimal', required: false }),
    );
    const changed = [{ ...job, employmentPercentage: 62.5 }, second];
    expect((await patch(path, { op: 'replace', path: field, value: changed })).body[urn].employments).toEqual(changed);
    expect((await patch(path, { op: 'add', path: field, value: second })).body[urn].employments).toEqual(changed);
    const percentages = [0, 0.5, 50, 100].map(employmentPercentage => ({ ...job, employmentPercentage }));
    const employments = [...percentages, job];
    const replaced = await json('PUT', path, person(1, { [urn]: { employments } }));
    expect(replaced.body[urn].employments).toEqual(employments);
    for (const invalid of [-1, 101, '50', '50%', '60 %', null]) {
      const result = await patch(path, {
        op: 'replace',
        path: field,
        value: [{ ...job, employmentPercentage: invalid }],
      });
      expect(result.body[urn].employments).toEqual([job]);
    }
  });
  test('each title stays with its unit through create, projection, patch, retry and full replacement', async () => {
    const { json, create, patch, person, store, group } = app();
    await units(group);
    const id = await create(1, { [urn]: { employments: jobs }, title: 'Katalogtitel' });
    const path = '/Users/' + id;
    expect((await json('GET', path)).body).toMatchObject({ schemas: [USER, urn], [urn]: { employments: jobs } });
    expect((await json('GET', path + '?attributes=' + urn + ':employments.title')).body[urn]).toEqual({
      employments: jobs.map(({ title }) => ({ title })),
    });
    expect((await json('GET', '/ResourceTypes/User')).body.schemaExtensions).toContainEqual({
      schema: urn,
      required: false,
    });
    expect((await json('GET', '/Schemas/' + urn)).body.id).toBe(urn);
    // Two entries that say the same are one, in a body and in a patch: an entry has no id to tell them apart by.
    const twins = await create(2, { [urn]: { employments: [jobs[0], jobs[0]] } });
    const kept = await patch('/Users/' + twins, { op: 'add', path: field, value: [jobs[1], jobs[1]] });
    expect(kept.body[urn].employments).toEqual(jobs);
    const job = { unitId: 'office' };
    const change = { op: 'add', path: field, value: [job] };
    expect((await patch(path, change)).body[urn].employments).toEqual([...jobs, job]);
    const count = store.state.audit.length;
    await patch(path, change);
    expect(store.state.audit).toHaveLength(count);
    // One entry by itself is a list of one, as it is for every multi-valued attribute.
    expect((await patch(path, { op: 'replace', path: field, value: job })).body[urn].employments).toEqual([job]);
    expect((await patch(path, { op: 'remove', path: field })).body.schemas).toEqual([USER]);
    await patch(path, { op: 'replace', value: { [urn]: { Employments: jobs } } });
    expect((await json('PUT', path, person(1))).body[urn]).toBeUndefined();
  });
  test('an entry with nothing in it is left out; one that names no unit, or a unit Clew does not hold, is refused with the reason', async () => {
    const { json, create, patch, person, group, store } = app();
    await units(group);
    // A serializer's empty rows say nothing, and refuse nobody.
    const empty = [{}, { unitId: null, title: null }, { unitId: '', title: '  ' }, null];
    const id = await create(1, { [urn]: { employments: [...empty, jobs[0]] } });
    const path = '/Users/' + id;
    expect((await json('GET', path)).body[urn].employments).toEqual([jobs[0]]);
    const refusals: Array<[unknown[], string, RegExp]> = [
      // A title with no unit says something Clew cannot place.
      [[{ title: 'Lärare' }], 'invalidValue', /^An employment needs a 'unitId': .* is sent as the user's 'title'\.$/],
      [
        [{ unitId: 'nowhere', title: 'Lärare' }],
        'invalidValue',
        /^An employment names 'nowhere', which is no unit of this organisation\. 'unitId' is what follows 'unit:' .*\(D114\)\. The user was not stored\.$/,
      ],
      // Written as the key is, not as the group's externalId.
      [
        [jobs[0], { unitId: 'unit:school' }, { unitId: 'School' }],
        'invalidValue',
        /^Employments name 'unit:school', 'School', which are no units of this organisation\./,
      ],
      [
        Array.from({ length: 51 }, (_, n) => ({ unitId: 'school', title: 'T' + n })),
        'invalidValue',
        /carries at most 50 entries\.$/,
      ],
    ];
    for (const [employments, scimType, detail] of refusals) {
      for (const refused of [
        await json('POST', '/Users', person(9, { [urn]: { employments } })),
        await json('PUT', path, person(1, { [urn]: { employments } })),
        await patch(path, { op: 'replace', path: field, value: employments }),
      ]) {
        expect(refused).toMatchObject({ status: 400, body: { scimType } });
        expect(refused.body.detail).toMatch(detail);
      }
      // Beside a deactivation the list is left as it was (D113), by a patch and by a full replacement.
      for (const left of [
        await patch(
          path,
          { op: 'replace', path: field, value: employments },
          { op: 'replace', path: 'active', value: false },
        ),
        await json('PUT', path, person(1, { active: false, [urn]: { employments } })),
      ]) {
        expect(left).toMatchObject({ status: 200, body: { active: false, [urn]: { employments: [jobs[0]] } } });
        await json('PUT', path, person(1, { [urn]: { employments: [jobs[0]] } }));
      }
    }
    expect((await json('GET', '/Users?filter=' + encodeURIComponent('externalId eq "e-9"'))).body.totalResults).toBe(0);
    // Another organisation's unit is no unit of this one.
    store.state.provisioners.set('digest:other', { id: 'other', organisationId: 'other-org', label: 'Other' });
    await json(
      'POST',
      '/Groups',
      { schemas: [GROUP], externalId: 'unit:theirs', displayName: 'Theirs' },
      'Bearer other',
    );
    expect((await patch(path, { op: 'add', path: field, value: [{ unitId: 'theirs' }] })).body.detail).toMatch(
      /^An employment names 'theirs', which is no unit of this organisation\./,
    );
  });
  test("'employments' without the extension's URN is refused and says how it is written, where it once answered 200 and stored nothing", async () => {
    const { json, create, patch, person, group } = app();
    await units(group);
    const path = '/Users/' + (await create(1, { [urn]: { employments: [jobs[0]] } }));
    const detail = `Use '${field}' for a person's employments.`;
    for (const refused of [
      await json('POST', '/Users', person(2, { employments: jobs })),
      await json('PUT', path, person(1, { Employments: jobs })),
      await patch(path, { op: 'replace', path: 'employments', value: jobs }),
      await patch(path, { op: 'replace', path: 'employments[unitId eq "school"].title', value: 'Rektor' }),
      await patch(path, { op: 'remove', path: 'employments' }),
      await patch(path, { op: 'add', value: { employments: jobs } }),
    ])
      expect(refused).toMatchObject({ status: 400, body: { scimType: 'invalidPath', detail } });
    // An entry cannot be picked: the list is sent whole.
    expect(
      await patch(path, { op: 'replace', path: field + '[unitId eq "school"].title', value: 'Rektor' }),
    ).toMatchObject({
      status: 400,
      body: {
        scimType: 'invalidPath',
        detail: expect.stringContaining(`send the whole list of employments to '${field}'`),
      },
    });
    expect((await json('GET', path)).body[urn].employments).toEqual([jobs[0]]);
    expect(
      await patch(
        path,
        { op: 'replace', path: 'employments', value: jobs },
        { op: 'replace', path: 'active', value: false },
      ),
    ).toMatchObject({
      status: 200,
      body: { active: false },
    });
  });
  test('a unit removed afterwards does not stop the person’s other changes, and the profile shows the title without it', async () => {
    const { json, create, patch, person, group, store } = app();
    const { office } = await units(group);
    const employments = [
      jobs[0],
      { unitId: 'office', title: 'Registrator' },
      { unitId: 'office', employmentPercentage: 0 },
      { unitId: 'office' },
    ];
    const path = '/Users/' + (await create(1, { title: 'Katalogtitel', [urn]: { employments } }));
    await create(2);
    expect((await json('DELETE', '/Groups/' + office)).status).toBe(204);
    // The list did not change, so it is not asked about again: a rename goes through, and so does the daily PUT.
    expect((await patch(path, { op: 'replace', path: 'displayName', value: 'Renamed' })).status).toBe(200);
    expect((await json('PUT', path, person(1, { title: 'Katalogtitel', [urn]: { employments } }))).status).toBe(200);
    const reader = {
      id: 'id-4',
      organisationId: 'org',
      userName: 'user2',
      name: 'User 2',
    } as Parameters<ReturnType<typeof staffUsecases>['person']>[0];
    const seen = await staffUsecases({ store }).person(reader, 'user1', true);
    // The employments carry the titles, so the core one is not shown beside them.
    expect(seen?.profile).toMatchObject({
      title: null,
      employments: [
        { ...jobs[0], unitLabel: 'Skolan' },
        { unitId: 'office', title: 'Registrator' },
        { unitId: 'office', employmentPercentage: 0 },
      ],
    });
  });
});
describe('a deactivation is never refused for what stands beside it (D113)', () => {
  test('a patch that deactivates goes through although it takes a required attribute away, sets one wrongly or names a path Clew cannot read', async () => {
    const { create, patch, store } = app();
    const id = await create(1);
    const beside: unknown[][] = [
      // Entra, when the mailbox of a leaver is emptied with the account.
      [{ op: 'Remove', path: 'emails[type eq "work"].value' }],
      [{ op: 'replace', path: 'displayName', value: '' }],
      [{ op: 'replace', path: 'emails', value: [] }],
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
describe('an add or replace without a value on a group (Q1)', () => {
  test("is refused before anything reads it, so a unit keeps its key, its parent and its people's grants; null and remove still take them away", async () => {
    const { create, json, patch, group, store } = app();
    const person = await create(1);
    await group({ externalId: 'unit:ksk', displayName: 'Kommunstyrelsekontoret' });
    const school = await group({
      externalId: 'unit:skola',
      displayName: 'Skolan',
      members: [{ value: person }],
      [UNIT]: { parent: 'unit:ksk' },
    });
    const path = '/Groups/' + school,
      held = async () => (await json('GET', path)).body,
      before = await held(),
      audited = store.state.audit.length;
    expect(store.state.grants.get(person)).toMatchObject({ unitId: 'skola' });
    const missing: Array<[Record<string, unknown>, string]> = [];
    for (const op of ['add', 'replace']) {
      for (const attribute of ['externalId', GROUP + ':externalId', UNIT + ':parent', UNIT, 'members', 'displayName'])
        missing.push([{ op, path: attribute }, `Operation '${op}' on '${attribute}' requires a value.`]);
      missing.push([{ op }, `Operation '${op}' without a path requires a value.`]);
      // The extension's object that leaves `parent` out has no value for it, by the extension's path or path-less.
      missing.push([{ op, path: UNIT, value: {} }, `Operation '${op}' on '${UNIT}' requires a value for 'parent'.`]);
      missing.push([
        { op, value: { [UNIT]: { other: 'x' } } },
        `Operation '${op}' on '${UNIT}' requires a value for 'parent'.`,
      ]);
    }
    for (const [operation, detail] of missing) {
      const answer = await patch(path, { op: 'replace', path: 'displayName', value: 'Ny skola' }, operation);
      expect([answer.status, answer.body.scimType, answer.body.detail]).toEqual([400, 'invalidValue', detail]);
      expect(await held()).toEqual(before);
    }
    expect(store.state.audit).toHaveLength(audited);
    expect(store.state.grants.get(person)).toMatchObject({ unitId: 'skola' });
    // An explicit null is the way to make a unit a root, and to take a key away; the unit's people lose its grant then.
    expect((await patch(path, { op: 'replace', path: UNIT + ':parent', value: null })).body[UNIT]).toBeUndefined();
    await patch(path, { op: 'add', path: UNIT, value: { parent: 'unit:ksk' } });
    expect((await patch(path, { op: 'replace', value: { [UNIT]: { Parent: null } } })).body[UNIT]).toBeUndefined();
    const keyless = await patch(path, { op: 'replace', path: 'externalId', value: null });
    expect(keyless).toMatchObject({ status: 200, body: { displayName: 'Skolan' } });
    expect(keyless.body).not.toHaveProperty('externalId');
    expect(store.state.grants.get(person)).toBeUndefined();
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
  test('under emails: the one address by its filter, another type beside it left alone, and a list that replaces it taken as sent', async () => {
    const { create, patch } = app();
    const id = await create(1);
    const email = async (...operations: unknown[]) => {
      const answer = await patch('/Users/' + id, ...operations);
      return answer.status === 200 ? answer.body.emails[0].value : answer.body.scimType;
    };
    // A filter that names another type than the one address Clew holds once replaced that address.
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
    // `replace` gives the whole list, and what its one address is called is the source's to answer for (D114).
    expect(await email({ op: 'replace', path: 'emails', value: [{ value: 'h@home.se', type: 'home' }] })).toBe(
      'h@home.se',
    );
    expect(await email({ op: 'replace', path: 'emails[type eq "work"].value', value: 'd@x.se' })).toBe('d@x.se');
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
  test('a fallback address reads back as the published work address described by discovery', async () => {
    const { create, json } = app();
    const id = await create(1, {
      emails: [
        { value: 'first@example.org', type: 'home' },
        { value: 'selected@example.org', type: 'home', primary: true },
      ],
    });
    expect((await json('GET', '/Users/' + id)).body.emails).toEqual([
      { value: 'selected@example.org', type: 'work', primary: true },
    ]);
    const schema = await json('GET', '/Schemas/' + USER);
    expect(schema.body.attributes).toContainEqual(
      expect.objectContaining({
        name: 'emails',
        description: expect.stringContaining('returned with type "work" and primary true'),
      }),
    );
  });
  test('email lists use the same work and primary preference for filtered and unfiltered PATCH paths', async () => {
    const { create, patch } = app();
    const id = await create(1);
    const untyped = [{ value: 'first@x.se' }, { value: 'primary@x.se', primary: true }];
    for (const path of ['emails', 'emails[type eq "work"]', 'emails[primary eq true]']) {
      const write = (value: Array<{ value: string; type?: string; primary?: boolean }>) =>
        patch('/Users/' + id, { op: 'replace', path, value });
      expect((await write([...untyped, { value: 'work@x.se', type: 'Work' }])).body.emails[0].value).toBe('work@x.se');
      expect((await write(untyped)).body.emails[0].value).toBe('primary@x.se');
    }
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
