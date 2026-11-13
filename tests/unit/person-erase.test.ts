import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import { ERASED, IDENTIFIERS_ABOUT } from '../../apps/server/src/modules/people/domain';
import { PERSON_ERASED, personErasureUsecases, scimUsecases } from '../../apps/server/src/modules/people/usecases';

/**
 * An operator's erasure of a deactivated person (D117, Q7 of the 2026-11-12 users review) on the memory adapter: the
 * person pushed through the SCIM use cases as a source pushes them, the sign-in's rows written as `@clew/db/auth`
 * writes them (a unit test cannot run it), and the erasure's refusals, its one transaction and its audit row. The same
 * on PostgreSQL, the sign-in's own writes included, is `tests/db/person-erase.test.ts`.
 */
const BASE = 'https://clew.test/scim/v2';
const OPERATOR = 'operator:cli';
const ISSUER = 'https://idp.sundsvall.test',
  OTHER_ISSUER = 'https://idp2.sundsvall.test';
const user = (externalId: string, userName: string, displayName: string, email: string) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId,
  userName,
  displayName,
  emails: [{ value: email, type: 'work', primary: true }],
  active: true,
});
const group = (externalId: string, displayName: string, members: string[]) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
  externalId,
  displayName,
  members: members.map(value => ({ value })),
});
const patch = (...Operations: Array<{ op: string; path?: string; value?: unknown }>) => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
  Operations,
});
function harness() {
  const store = memoryProvisionStore();
  let tick = 0,
    seq = 0;
  const clock = () => new Date(Date.UTC(2026, 10, 13, 6, 0, tick++));
  const scim = scimUsecases({ store, clock, ids: () => 'id-' + ++seq, digest: token => 'digest:' + token });
  const p = { id: 'metakatalogen', organisationId: 'sundsvall', label: 'Metakatalogen' };
  store.state.provisioners.set('digest:secret', p);
  return { store, scim, p, erasure: personErasureUsecases({ store, clock }) };
}
/**
 * Anna as a source leaves her: pushed, renamed and given a new source key, given a title, phone numbers and an
 * employment, placed on a unit and in a plain group; bound under two issuers with two sessions, refused twice and
 * rebound once, and claimed by sign-ins that bound nobody. Bo is a colleague on the same unit, whose sign-in was refused
 * because it brought the subject Anna held.
 */
async function anna() {
  const h = harness(),
    { store, scim, p } = h;
  const unit = await scim.createGroup(p, group('unit:skola', 'Bergsåkers skola', []), BASE);
  const id = (await scim.createUser(p, user('mk-anna', 'annber', 'Anna Berg', 'anna.berg@sundsvall.se'), BASE)).id;
  const bo = (await scim.createUser(p, user('mk-bo', 'bo.ek', 'Bo Ek', 'bo.ek@sundsvall.se'), BASE)).id;
  await scim.patchUser(
    p,
    id,
    patch(
      { op: 'replace', path: 'userName', value: 'anna.berg' },
      { op: 'replace', path: 'externalId', value: 'hr-anna' },
    ),
    BASE,
  );
  await scim.replaceUser(
    p,
    id,
    {
      ...user('hr-anna', 'anna.berg', 'Anna Berg', 'anna.berg@sundsvall.se'),
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', SCIM.employment],
      title: 'Lärare',
      phoneNumbers: [
        { type: 'work', value: '060-19 10 00' },
        { type: 'mobile', value: '070-123 45 67' },
      ],
      [SCIM.employment]: { employments: [{ unitId: 'skola', title: 'Lärare i svenska' }] },
    },
    BASE,
  );
  await scim.patchGroup(p, unit.id, patch({ op: 'add', path: 'members', value: [{ value: id }, { value: bo }] }), BASE);
  const choir = await scim.createGroup(p, group('kor', 'Kören', [id]), BASE);
  store.state.bindings.push(
    { issuer: ISSUER, subject: 'sub-anna-3', personId: id },
    { issuer: OTHER_ISSUER, subject: 'sub-anna-b', personId: id },
    { issuer: ISSUER, subject: 'sub-bo', personId: bo },
  );
  store.state.sessions.push(
    { digest: 'd1', personId: id },
    { digest: 'd2', personId: id },
    { digest: 'd3', personId: bo },
  );
  store.state.authenticationAudit.push(
    { actor: 'claim:annber', action: 'identity-unmatched' },
    { actor: 'claim:ANNA.BERG', action: 'identity-unmatched' },
    { actor: 'claim:Anna.Berg@Sundsvall.se', action: 'identity-unmatched' },
    { actor: 'claim:bo.ek', action: 'identity-unmatched' },
    { actor: 'person:' + id, action: 'identity-bound' },
    { actor: null, action: 'login-denied' },
  );
  const claim = { issuer: ISSUER, claim: 'preferred_username' };
  store.state.audit.push(
    { actor: 'person:' + id, action: 'identity.bound', subject: 'person:' + id, details: claim },
    {
      actor: 'person:' + bo,
      action: 'identity.conflict',
      subject: 'person:' + bo,
      details: { ...claim, value: 'bo.ek', subject: 'sub-anna', holder: 'person:' + id },
    },
    {
      actor: 'person:' + id,
      action: 'identity.conflict',
      subject: 'person:' + id,
      details: { ...claim, value: 'anna.berg', subject: 'sub-anna-2' },
    },
    {
      actor: OPERATOR,
      action: 'identity.rebound',
      subject: 'person:' + id,
      details: { issuer: ISSUER, oldSubject: 'sub-anna', newSubject: 'sub-anna-3', operator: 'Synthetic Operator' },
    },
  );
  return { ...h, id, bo, unit, choir };
}
/** Every value that named Anna, as each store holds it. */
const HER_VALUES = [
  'annber',
  'anna.berg',
  'mk-anna',
  'hr-anna',
  'Anna Berg',
  '060-19 10 00',
  '070-123 45 67',
  'Lärare',
  'sub-anna',
];

describe('erasing a person (D117)', () => {
  test('refuses a person who is still active and an id the people table does not hold, writing nothing', async () => {
    const { store, erasure, id } = await anna();
    const before = structuredClone(store.state);
    expect(await erasure.erasePerson(OPERATOR, id)).toEqual({ refused: 'active' });
    // A person is named by their id: a user name in any case, an id nobody holds and one no id can be are nobody.
    for (const key of ['anna.berg', 'ANNA.BERG', 'nobody', '', id + '\u0000'])
      expect(await erasure.erasePerson(OPERATOR, key)).toEqual({ refused: 'unknown' });
    expect(store.state).toEqual(before);
  });

  test('clears the record and what names the person, keeps every event and the id, and audits counts only', async () => {
    const { store, scim, p, erasure, id, bo, unit, choir } = await anna();
    await scim.deleteUser(p, id);
    const held = store.state.users.get(id)!,
      events = store.state.audit.map(row => [row.action, row.subject]);
    expect(store.state.assignments.get(id)).toHaveLength(1);
    expect(store.state.grants.has(id)).toBe(true);

    const erased = await erasure.erasePerson(OPERATOR, id);
    const counts = {
      fields: 7,
      memberships: 2,
      assignments: 1,
      grants: 1,
      bindings: 2,
      sessions: 2,
      auditRows: 7,
      signInRows: 3,
    };
    expect(erased).toEqual({ erased: counts });
    const at = store.state.users.get(id)!.updatedAt;
    expect(at > held.updatedAt).toBe(true);
    // The row keeps its id, organisation, deactivation and creation; the user name is the id, and the source key gone.
    expect(store.state.users.get(id)).toEqual({
      ...held,
      name: '',
      email: null,
      phoneNumbers: [],
      employments: [],
      title: null,
      userName: id,
      externalId: null,
      updatedAt: at,
    });
    expect([...store.state.members].filter(key => key.endsWith('\u0000' + id))).toEqual([]);
    expect([...store.state.members].filter(key => key.endsWith('\u0000' + bo))).toHaveLength(1);
    expect([store.state.groups.get(unit.id)!.updatedAt, store.state.groups.get(choir.id)!.updatedAt]).toEqual([at, at]);
    expect(store.state.assignments.get(id) ?? []).toEqual([]);
    expect(store.state.grants.has(id)).toBe(false);
    expect(store.state.grants.has(bo)).toBe(true);
    expect(store.state.bindings).toEqual([{ issuer: ISSUER, subject: 'sub-bo', personId: bo }]);
    expect(store.state.sessions).toEqual([{ digest: 'd3', personId: bo }]);

    // Every event stays where it was, and the erasure's own row comes last.
    expect(store.state.audit.map(row => [row.action, row.subject])).toEqual([
      ...events,
      [PERSON_ERASED, 'person:' + id],
    ]);
    expect(store.state.audit.at(-1)).toEqual({
      actor: OPERATOR,
      action: PERSON_ERASED,
      subject: 'person:' + id,
      details: counts,
    });
    const rows = (action: string, subject = 'person:' + id) =>
      store.state.audit.filter(row => row.action === action && row.subject === subject).map(row => row.details);
    expect(rows('scim.user.created')).toEqual([{ userName: ERASED, externalId: ERASED }]);
    expect(rows('scim.user.patched')).toEqual([
      { changed: ['externalId', 'userName'], userName: ERASED, externalId: ERASED },
    ]);
    expect(rows('scim.user.deactivated')).toEqual([{ userName: ERASED, externalId: ERASED }]);
    expect(rows('identity.bound')).toEqual([{ issuer: ISSUER, claim: 'preferred_username' }]);
    expect(rows('identity.conflict')).toEqual([
      { issuer: ISSUER, claim: 'preferred_username', value: ERASED, subject: ERASED },
    ]);
    expect(rows('identity.rebound')).toEqual([
      { issuer: ISSUER, oldSubject: ERASED, newSubject: ERASED, operator: 'Synthetic Operator' },
    ]);
    // Bo's refused sign-in keeps his name and who held the subject, by id; the subject was Anna's account.
    expect(rows('identity.conflict', 'person:' + bo)).toEqual([
      { issuer: ISSUER, claim: 'preferred_username', value: 'bo.ek', subject: ERASED, holder: 'person:' + id },
    ]);
    expect(store.state.authenticationAudit.map(row => row.actor)).toEqual([
      'claim:' + ERASED,
      'claim:' + ERASED,
      'claim:' + ERASED,
      'claim:bo.ek',
      'person:' + id,
      null,
    ]);
    const kept = JSON.stringify([
      [...store.state.users.values()].filter(u => u.id === id),
      store.state.audit,
      store.state.authenticationAudit,
      store.state.bindings,
    ]).toLowerCase();
    for (const value of HER_VALUES) expect(kept).not.toContain(value.toLowerCase());

    // Run again, nothing is left: it says so with zero counts, and the record keeps its time of change.
    expect(await erasure.erasePerson(OPERATOR, id)).toEqual({
      erased: {
        fields: 0,
        memberships: 0,
        assignments: 0,
        grants: 0,
        bindings: 0,
        sessions: 0,
        auditRows: 0,
        signInRows: 0,
      },
    });
    expect(store.state.users.get(id)!.updatedAt).toBe(at);

    // The name and the key are free: the source pushes them again as a new person, and the old one stays erased.
    const again = await scim.createUser(p, user('hr-anna', 'Anna.Berg', 'Anna Berg', 'anna.berg@sundsvall.se'), BASE);
    expect(again.id).not.toBe(id);
    expect((await scim.createUser(p, user('mk-anna', 'annber', 'Anna Berg', 'a@sundsvall.se'), BASE)).id).not.toBe(id);
    expect(store.state.users.get(id)).toMatchObject({ userName: id, externalId: null, enabled: false });
  });

  test('writes all of it or nothing: a write that fails late leaves everything as it was', async () => {
    const { store, scim, p, erasure, id } = await anna();
    await scim.deleteUser(p, id);
    // Someone else holding the person's id as a user name is what the unique index refuses when the id takes its place.
    await scim.createUser(p, user('mk-x', id, 'X', 'x@sundsvall.se'), BASE);
    const before = structuredClone(store.state);
    await expect(erasure.erasePerson(OPERATOR, id)).rejects.toThrow('duplicate key');
    expect(store.state).toEqual(before);
  });

  test('every SCIM row about a person holds identifiers only where the erasure looks for them', async () => {
    const { store, scim, p } = harness();
    const id = (await scim.createUser(p, user('mk-1', 'cecilia', 'Cecilia', 'c@sundsvall.se'), BASE)).id;
    await scim.patchUser(p, id, patch({ op: 'replace', path: 'userName', value: 'cecilia.l' }), BASE);
    await scim.replaceUser(
      p,
      id,
      { ...user('mk-1', 'cecilia.l', 'Cecilia L', 'c@sundsvall.se'), title: 'Rektor' },
      BASE,
    );
    await scim.patchUser(p, id, patch({ op: 'replace', path: 'active', value: false }), BASE);
    await scim.patchUser(p, id, patch({ op: 'replace', path: 'active', value: true }), BASE);
    await scim.deleteUser(p, id);
    const written = store.state.audit.filter(row => row.action.startsWith('scim.user.'));
    expect(new Set(written.map(row => row.action))).toEqual(
      new Set(Object.keys(IDENTIFIERS_ABOUT).filter(action => action.startsWith('scim.user.'))),
    );
    // `changed` names attributes and `via` the verb; every other key is one the erasure replaces.
    for (const row of written)
      for (const key of Object.keys(row.details))
        expect([row.action, ['changed', 'via', ...IDENTIFIERS_ABOUT[row.action]!].includes(key)]).toEqual([
          row.action,
          true,
        ]);
  });
});

/**
 * The script's arguments: every malformed call is refused with exit code 2 and the usage line before the database is
 * asked anything, an option given twice among them, so that a copied line cannot erase the wrong person. The database
 * it is given cannot be reached, so a call that got that far would end with exit code 1 instead.
 */
const script = join(import.meta.dir, '../../scripts/person-erase.ts');
function run(...args: string[]) {
  const result = Bun.spawnSync([process.execPath, script, ...args], {
    env: { ...process.env, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nothing' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString().trim() };
}
const usage = 'Usage: bun scripts/person-erase.ts --person <person id> --confirm';
describe('scripts/person-erase.ts refuses, asking the database nothing,', () => {
  const malformed: Array<[string, string[]]> = [
    ['no arguments', []],
    ['no person', ['--confirm']],
    ['a person given twice', ['--person', 'p1', '--person', 'p2', '--confirm']],
    ['--confirm given twice', ['--person', 'p1', '--confirm', '--confirm']],
    ['an option where a value belongs', ['--person', '--confirm']],
    ['an empty person id', ['--person', '', '--confirm']],
    ['a stray argument', ['--person', 'p1', 'p2', '--confirm']],
    ['an option it does not take', ['--person', 'p1', '--confirm', '--force']],
  ];
  for (const [name, args] of malformed)
    test(name, () => expect(run(...args)).toEqual({ code: 2, out: '', err: usage }));
  test('a call without --confirm, saying what it would erase', () => {
    expect(run('--person', 'p1')).toEqual({
      code: 2,
      out: '',
      err:
        'Erasing person "p1" clears their name, e-mail address, phone numbers, employments, title, user name and source key, removes their groups, placements, grant, sign-in bindings and sessions, and replaces their identifiers in the audit trail, and cannot be undone. Run again with --confirm to erase.\n' +
        usage,
    });
  });
});
