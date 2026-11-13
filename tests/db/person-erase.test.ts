import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { rebindIdentity, signIn } from '../../packages/db/src/auth';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { talkStoreWithCards } from '../../apps/server/src/composition/talks';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { SCIM } from '../../apps/server/src/modules/people/contracts';
import { postgresProvisionStore, postgresUserReads } from '../../apps/server/src/modules/people/adapters/postgres';
import type { ProvisionStore } from '../../apps/server/src/modules/people/ports';
import { personErasureUsecases, scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { talkUsecases } from '../../apps/server/src/modules/talks/usecases';
import { postgresThreadStore } from '../../apps/server/src/threads/adapters/postgres';
import { subjectErasure } from '../../apps/server/src/threads/usecases/subjects';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * An operator's erasure of a deactivated person on PostgreSQL (D120, Q7 of the 2026-11-12 users review): the person is
 * pushed through the SCIM use cases and signs in through `@clew/db/auth`, so every table and audit row the erasure must
 * reach is written by the code that writes it in production; then every one of them is read back, the audit trail and
 * the authentication log searched for every value that named the person. The source can push the freed name and key
 * again as a new person, the erasures of cards, talks and competence still find the person by id, and the script
 * answers as the runbook says. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const prefix = 'test-erase-' + randomUUID().slice(0, 8),
  org = prefix + '-org',
  provisioner = { id: prefix + '-mk', organisationId: org, label: 'Metakatalogen' },
  [issuerA, issuerB, issuerC] = [
    'https://idp-a.test/' + prefix,
    'https://idp-b.test/' + prefix,
    'https://idp-c.test/' + prefix,
  ],
  claim = 'preferred_username',
  OPERATOR = 'operator:cli',
  BASE = 'https://clew.test/scim/v2',
  // Every name carries the prefix, so that nothing another test or the development data holds can match it.
  first = { userName: 'Åsa.Berg.' + prefix, externalId: 'mk-' + prefix },
  renamed = { userName: 'asa.lind.' + prefix, externalId: 'hr-' + prefix },
  email = 'asa.berg.' + prefix + '@sundsvall.test',
  phones = ['060-' + prefix, '070-' + prefix],
  title = 'Lärare ' + prefix,
  subjects = ['sub-asa-', 'sub-asa-2-', 'sub-asa-3-', 'sub-asa-b-', 'sub-asa-c-'].map(name => name + prefix),
  boName = 'bo.ek.' + prefix;
// The source pushes at one instant and the operator erases at a later one, so a time of change shows which moved it.
const at = new Date('2026-11-13T08:00:00.000Z'),
  erasedAt = new Date('2026-11-13T09:00:00.000Z');
let seq = 0;
const ids = () => prefix + '-' + ++seq,
  clock = () => at,
  store = postgresProvisionStore(),
  scim = scimUsecases({ store, clock, ids, digest: token => 'digest:' + token }),
  erasure = personErasureUsecases({ store, clock: () => erasedAt }),
  db = database();
const user = (fields: { userName: string; externalId: string }, displayName: string, mail: string) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  ...fields,
  displayName,
  emails: [{ value: mail, type: 'work', primary: true }],
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
/** The authentication log's rows of this test: the claims it made, by the names it uses, and its people's own rows. */
const signInRows: number[] = [];
const signInLog = async () =>
  db
    .select({ id: schema.authenticationAudit.id, actor: schema.authenticationAudit.actor })
    .from(schema.authenticationAudit)
    .where(
      or(
        sql`lower(${schema.authenticationAudit.actor}) like ${'%' + prefix + '%'}`,
        inArray(schema.authenticationAudit.id, signInRows.length ? signInRows : [-1]),
      ),
    )
    .orderBy(schema.authenticationAudit.id);
const auditTrail = async () =>
  db
    .select({
      actor: schema.audit.actor,
      action: schema.audit.action,
      subject: schema.audit.subject,
      details: schema.audit.details,
    })
    .from(schema.audit)
    .where(
      or(
        like(schema.audit.subject, 'person:' + prefix + '%'),
        like(schema.audit.subject, 'group:' + prefix + '%'),
        sql`${schema.audit.details}::text like ${'%' + prefix + '%'}`,
      ),
    )
    .orderBy(schema.audit.id);
const openSession = (personId: string, digest: string) => {
  const until = new Date(Date.now() + 60 * 60_000);
  return db.insert(schema.sessions).values({
    digest: prefix + '-' + digest,
    personId,
    issuer: issuerA,
    subject: 'sub-' + digest,
    clientId: 'clew',
    csrf: 'csrf',
    tokens: 'sealed',
    tokenExpiresAt: until,
    idleExpiresAt: until,
    expiresAt: until,
  });
};
/** What the erasure may not write: the tables it reaches, as rows of this test. */
const snapshot = async () => ({
  people: await db
    .select()
    .from(schema.people)
    .where(like(schema.people.id, prefix + '%'))
    .orderBy(schema.people.id),
  groups: await db
    .select()
    .from(schema.groups)
    .where(like(schema.groups.id, prefix + '%'))
    .orderBy(schema.groups.id),
  members: await db
    .select()
    .from(schema.groupMembers)
    .where(like(schema.groupMembers.personId, prefix + '%'))
    .orderBy(schema.groupMembers.groupId, schema.groupMembers.personId),
  assignments: await db
    .select()
    .from(schema.assignments)
    .where(like(schema.assignments.personId, prefix + '%')),
  grants: await db
    .select()
    .from(schema.accessGrants)
    .where(like(schema.accessGrants.personId, prefix + '%')),
  bindings: await db
    .select()
    .from(schema.identityBindings)
    .where(like(schema.identityBindings.personId, prefix + '%'))
    .orderBy(schema.identityBindings.issuer, schema.identityBindings.subject),
  sessions: await db
    .select({ digest: schema.sessions.digest, personId: schema.sessions.personId })
    .from(schema.sessions)
    .where(like(schema.sessions.personId, prefix + '%'))
    .orderBy(schema.sessions.digest),
  audit: await auditTrail(),
  signIns: await signInLog(),
});

afterAll(async () => {
  const people = (
    await db
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(like(schema.people.id, prefix + '%'))
  ).map(r => r.id);
  const log = (await signInLog()).map(r => r.id);
  if (log.length) await db.delete(schema.authenticationAudit).where(inArray(schema.authenticationAudit.id, log));
  await db
    .delete(schema.audit)
    .where(
      or(like(schema.audit.subject, 'person:' + prefix + '%'), like(schema.audit.subject, 'group:' + prefix + '%')),
    );
  if (people.length) {
    await db.delete(schema.identityBindings).where(inArray(schema.identityBindings.personId, people));
    await db.delete(schema.sessions).where(inArray(schema.sessions.personId, people));
    await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.personId, people));
    await db.delete(schema.assignments).where(inArray(schema.assignments.personId, people));
    await db.delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, people));
  }
  await db.delete(schema.groups).where(like(schema.groups.id, prefix + '%'));
  await db.delete(schema.units).where(like(schema.units.id, prefix + '%'));
  if (people.length) await db.delete(schema.people).where(inArray(schema.people.id, people));
  await forgetTestWorkflows();
  await closeDatabase();
});

test('erasing a deactivated person leaves their id and every event, and nothing that named them, in any table', async () => {
  const p = provisioner,
    unitId = prefix + '-skola';
  // As a source pushes a person: the unit first, then the person, renamed with a new source key, given a title, phone
  // numbers and an employment, placed on the unit and put in a plain group; a colleague on the same unit.
  const unit = await scim.createGroup(p, group('unit:' + unitId, 'Bergsåkers skola', []), BASE);
  const asa = (await scim.createUser(p, user(first, 'Åsa Berg', email), BASE)).id;
  const bo = (
    await scim.createUser(
      p,
      user({ userName: boName, externalId: 'mk-bo-' + prefix }, 'Bo Ek', 'bo.' + prefix + '@sundsvall.test'),
      BASE,
    )
  ).id;
  await scim.patchUser(
    p,
    asa,
    patch(
      { op: 'replace', path: 'userName', value: renamed.userName },
      { op: 'replace', path: 'externalId', value: renamed.externalId },
    ),
    BASE,
  );
  await scim.replaceUser(
    p,
    asa,
    {
      ...user(renamed, 'Åsa Lind', email),
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', SCIM.employment],
      title,
      phoneNumbers: [
        { type: 'work', value: phones[0] },
        { type: 'mobile', value: phones[1] },
      ],
      [SCIM.employment]: { employments: [{ unitId, title }] },
    },
    BASE,
  );
  await scim.patchGroup(
    p,
    unit.id,
    patch({ op: 'add', path: 'members', value: [{ value: asa }, { value: bo }] }),
    BASE,
  );
  const choir = await scim.createGroup(p, group('kor-' + prefix, 'Kören', [asa]), BASE);

  // As the sign-in writes it: Åsa binds under two issuers and Bo under one; Bo's claim arrives with Åsa's subject and
  // is refused naming her as the holder; a new account of Åsa's is refused; an operator rebinds her, and binds her
  // first and releases her under a third issuer; her old name, after the rename, binds nobody; and after the
  // deactivation her new name, in capitals, binds nobody either.
  const [subject, subject2, subject3, subjectB, subjectC] = subjects as [string, string, string, string, string];
  expect((await signIn(issuerA, subject, claim, renamed.userName)).personId).toBe(asa);
  expect((await signIn(issuerB, subjectB, claim, renamed.userName)).personId).toBe(asa);
  expect((await signIn(issuerA, 'sub-bo-' + prefix, claim, boName)).personId).toBe(bo);
  expect((await signIn(issuerA, subject, claim, boName)).personId).toBe(asa);
  expect((await signIn(issuerA, subject2, claim, renamed.userName)).personId).toBe(asa);
  expect(
    await rebindIdentity(OPERATOR, {
      issuer: issuerA,
      personId: asa,
      subject: subject3,
      operator: 'Synthetic Operator',
    }),
  ).toEqual({ changed: true, oldSubject: subject });
  const rebind = (next: string | null) =>
    rebindIdentity(OPERATOR, { issuer: issuerC, personId: asa, subject: next, operator: 'Synthetic Operator' });
  expect(await rebind(subjectC)).toEqual({ changed: true, oldSubject: null });
  expect(await rebind(null)).toEqual({ changed: true, oldSubject: subjectC });
  expect(await signIn(issuerA, 'sub-x-' + prefix, claim, first.userName)).toEqual({});
  await openSession(asa, 's1');
  await openSession(asa, 's2');
  await openSession(bo, 's3');

  // Still active: refused, and nothing is written.
  const active = await snapshot();
  expect(await erasure.erasePerson(OPERATOR, asa)).toEqual({ refused: 'active' });
  expect(await snapshot()).toEqual(active);

  await scim.deleteUser(p, asa);
  // A deactivated person has no page, so the operator takes her id from the provisioner: a filter on the source key or
  // the user name answers her as inactive, with the id the script is given.
  for (const filter of [`externalId eq "${renamed.externalId}"`, `userName eq "${renamed.userName.toUpperCase()}"`])
    expect((await scim.listUsers(p, { filter }, BASE)).Resources).toEqual([
      expect.objectContaining({ id: asa, userName: renamed.userName, externalId: renamed.externalId, active: false }),
    ]);
  expect(await signIn(issuerA, 'sub-y-' + prefix, claim, renamed.userName.toUpperCase())).toEqual({ personId: asa });
  // A user name in any case, and an id nobody holds, are nobody: refused, and nothing is written.
  const before = await snapshot();
  for (const key of [renamed.userName, first.userName.toUpperCase(), prefix + '-nobody'])
    expect(await erasure.erasePerson(OPERATOR, key)).toEqual({ refused: 'unknown' });
  expect(await snapshot()).toEqual(before);
  const held = before.people.find(row => row.id === asa)!;
  expect(held).toMatchObject({ enabled: false, userName: renamed.userName, title });
  expect(before.signIns.map(row => row.actor)).toEqual(
    expect.arrayContaining(['claim:' + first.userName, 'claim:' + renamed.userName.toUpperCase()]),
  );
  signInRows.push(...before.signIns.map(row => row.id));

  const counts = {
    fields: 7,
    memberships: 2,
    assignments: 1,
    grants: 1,
    bindings: 2,
    sessions: 2,
    // Created, patched, replaced and deactivated; the refusal about her and the three rebinds; Bo's refusal she held.
    auditRows: 9,
    signInRows: 2,
  };
  expect(await erasure.erasePerson(OPERATOR, asa)).toEqual({ erased: counts });
  const after = await snapshot();

  // The row keeps its id, organisation, deactivation and creation; everything else that named her is gone.
  expect(after.people.find(row => row.id === asa)).toEqual({
    ...held,
    name: '',
    email: null,
    phoneNumbers: [],
    employments: [],
    title: null,
    userName: null,
    externalId: null,
    updatedAt: erasedAt,
    // Her name was cleared, which is a new name: the time of the one she took before goes with it.
    nameChangedAt: erasedAt,
  });
  // A provisioner reads her id where the user name was, as for any record without one.
  const resource = await scim.getUser(p, asa, BASE);
  expect(resource).toMatchObject({ id: asa, userName: asa, displayName: '', emails: [], active: false, groups: [] });
  expect(resource).not.toHaveProperty('externalId');
  // No key names her now: neither her id nor a name she held resolves to her, so nothing started about her is sent on.
  const reads = postgresUserReads();
  expect(await reads.userName(asa)).toBeNull();
  expect(await reads.holders(bo, [asa, renamed.userName, first.userName])).toEqual(new Map());
  expect(after.people.find(row => row.id === bo)).toEqual(before.people.find(row => row.id === bo));
  expect(after.members).toEqual([{ groupId: unit.id, personId: bo }]);
  // The groups she left changed, as their members do (S13).
  expect(after.groups.map(g => [g.id, g.updatedAt])).toEqual([
    [unit.id, erasedAt],
    [choir.id, erasedAt],
  ]);
  expect(after.assignments.map(a => a.personId)).toEqual([bo]);
  expect(after.grants.map(g => g.personId)).toEqual([bo]);
  expect(after.bindings.map(b => [b.issuer, b.subject, b.personId])).toEqual([[issuerA, 'sub-bo-' + prefix, bo]]);
  expect(after.sessions).toEqual([{ digest: prefix + '-s3', personId: bo }]);

  // Every event is where it was, with the erasure's row last.
  expect(after.audit.map(row => [row.action, row.subject])).toEqual([
    ...before.audit.map(row => [row.action, row.subject]),
    ['person.erased', 'person:' + asa],
  ]);
  expect(after.audit.at(-1)).toEqual({
    actor: OPERATOR,
    action: 'person.erased',
    subject: 'person:' + asa,
    details: counts,
  });
  const about = (action: string, person = asa) =>
    after.audit.filter(row => row.action === action && row.subject === 'person:' + person).map(row => row.details);
  for (const action of ['scim.user.created', 'scim.user.patched', 'scim.user.replaced', 'scim.user.deactivated'])
    expect(about(action)).toEqual([expect.objectContaining({ userName: '[erased]', externalId: '[erased]' })]);
  expect(about('identity.bound')).toEqual([
    { issuer: issuerA, claim },
    { issuer: issuerB, claim },
  ]);
  expect(about('identity.conflict')).toEqual([{ issuer: issuerA, claim, value: '[erased]', subject: '[erased]' }]);
  // A first binding still has no subject before it, and a release none after it.
  expect(about('identity.rebound')).toEqual([
    { issuer: issuerA, oldSubject: '[erased]', newSubject: '[erased]', operator: 'Synthetic Operator' },
    { issuer: issuerC, oldSubject: null, newSubject: '[erased]', operator: 'Synthetic Operator' },
    { issuer: issuerC, oldSubject: '[erased]', newSubject: null, operator: 'Synthetic Operator' },
  ]);
  // Bo's refused sign-in keeps his name and, by id, who held the subject; the subject was her account.
  expect(about('identity.conflict', bo)).toEqual([
    { issuer: issuerA, claim, value: boName, subject: '[erased]', holder: 'person:' + asa },
  ]);
  expect(after.signIns.map(row => [row.id, row.actor])).toEqual(
    before.signIns.map(row => [
      row.id,
      row.actor === 'claim:' + first.userName || row.actor === 'claim:' + renamed.userName.toUpperCase()
        ? 'claim:[erased]'
        : row.actor,
    ]),
  );
  // The jsonb and the log searched as text, without regard to case, for every value that named her.
  const kept = JSON.stringify([after.people.find(row => row.id === asa), after.audit, after.signIns]).toLowerCase();
  for (const value of [
    first.userName,
    first.externalId,
    renamed.userName,
    renamed.externalId,
    email,
    ...phones,
    title,
    ...subjects,
    'Åsa Berg',
    'Åsa Lind',
  ])
    expect([value, kept.includes(value.toLowerCase())]).toEqual([value, false]);
  // Bo's identifiers are his and stay.
  expect(kept).toContain(boName.toLowerCase());

  // Run again, nothing is left: zero counts, and the row keeps its time of change.
  expect(await erasure.erasePerson(OPERATOR, asa)).toEqual({
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

  // A push the source sent before it stopped sending her lists her in the choir again. A second erasure takes her out,
  // and her resource no longer lists the group, so its time of change is that erasure's, as the choir's is (S13).
  const pushedAt = new Date('2026-11-13T10:00:00.000Z'),
    erasedAgainAt = new Date('2026-11-13T11:00:00.000Z');
  await scimUsecases({ store, clock: () => pushedAt, ids, digest: token => 'digest:' + token }).patchGroup(
    p,
    choir.id,
    patch({ op: 'add', path: 'members', value: [{ value: asa }] }),
    BASE,
  );
  expect((await snapshot()).members.filter(m => m.personId === asa)).toEqual([{ groupId: choir.id, personId: asa }]);
  expect(await personErasureUsecases({ store, clock: () => erasedAgainAt }).erasePerson(OPERATOR, asa)).toEqual({
    erased: {
      fields: 0,
      memberships: 1,
      assignments: 0,
      grants: 0,
      bindings: 0,
      sessions: 0,
      auditRows: 0,
      signInRows: 0,
    },
  });
  const erasedAgain = await snapshot();
  expect(erasedAgain.members.filter(m => m.personId === asa)).toEqual([]);
  expect(erasedAgain.people.find(row => row.id === asa)?.updatedAt).toEqual(erasedAgainAt);
  expect(erasedAgain.groups.find(g => g.id === choir.id)?.updatedAt).toEqual(erasedAgainAt);

  // The source pushes the freed name and key again: a new person, in either spelling of the name, whom it now names.
  const again = await scim.createUser(p, user(renamed, 'Åsa Lind', email), BASE);
  expect(again.id).not.toBe(asa);
  expect(
    (await scim.createUser(p, user({ ...first, userName: first.userName.toLowerCase() }, 'Åsa Berg', email), BASE)).id,
  ).not.toBe(asa);
  expect(await reads.holders(bo, [renamed.userName])).toEqual(new Map([[renamed.userName, again.id]]));
  expect(
    await db
      .select({ userName: schema.people.userName, externalId: schema.people.externalId })
      .from(schema.people)
      .where(eq(schema.people.id, asa)),
  ).toEqual([{ userName: null, externalId: null }]);

  // The erasures of cards, talks and competence, run first by the runbook, still find her by her id.
  const options = { durable: testDurable, cancel: async () => {} };
  const subjectsErasure = subjectErasure({
    store: postgresThreadStore(options),
    clock,
    people: postgresUserReads(),
  });
  const talks = talkUsecases({
    store: talkStoreWithCards(options, { clock }),
    staff: async () => ({ units: [] }),
    manages: async () => false,
    bookings: async () => new Map(),
    clock,
    ids,
  });
  const competence = competenceUsecases({
    store: competenceStoreWithCards(options),
    staff: async () => ({ units: [] }),
    clock,
    ids,
  });
  expect(await subjectsErasure.eraseSubject(OPERATOR, { entity: 'person', key: asa })).toEqual({
    cards: 0,
    rows: 0,
    cardSubjects: 0,
  });
  expect(await talks.erasePerson(OPERATOR, asa)).toEqual({ talks: 0, commitments: 0, cleared: 0, cards: 0 });
  expect(await competence.erasePerson(OPERATOR, asa)).toEqual({ holdings: 0, cleared: 0, cards: 0 });
});

test('overlapping erasures of the claimed person and the holder preserve both redactions on a shared conflict', async () => {
  const claimed = ids(),
    holder = ids(),
    details = {
      issuer: issuerA,
      claim,
      value: 'name-' + claimed,
      subject: 'sub-' + holder,
      holder: 'person:' + holder,
    };
  await db
    .insert(schema.people)
    .values([claimed, holder].map(id => ({ id, organisationId: org, name: id, enabled: false })));
  await db.insert(schema.audit).values({
    actor: 'person:' + claimed,
    subject: 'person:' + claimed,
    action: 'identity.conflict',
    details,
  });
  // The holder has read the original row. Let the claimed person's erasure commit before the holder writes it.
  const holderStore: ProvisionStore = {
    transaction: run =>
      store.transaction(tx =>
        run({
          ...tx,
          async redactAudit(keysByRow) {
            expect(await erasure.erasePerson(OPERATOR, claimed)).toMatchObject({ erased: { auditRows: 1 } });
            return tx.redactAudit(keysByRow);
          },
        }),
      ),
  };
  const holderErasure = personErasureUsecases({ store: holderStore, clock });
  expect(await holderErasure.erasePerson(OPERATOR, holder)).toMatchObject({ erased: { auditRows: 0 } });
  expect(
    (await auditTrail()).find(row => row.action === 'identity.conflict' && row.subject === 'person:' + claimed)
      ?.details,
  ).toEqual({ ...details, value: '[erased]', subject: '[erased]' });
});

// Four runs of the script, each loading the server's composition, which takes seconds apiece on a busy machine.
test('the script refuses an unknown id and an active person, erases a deactivated one and says when nothing is left', async () => {
  const p = provisioner;
  const id = (
    await scim.createUser(
      p,
      user(
        { userName: 'cecilia.' + prefix, externalId: 'mk-c-' + prefix },
        'Cecilia',
        'c.' + prefix + '@sundsvall.test',
      ),
      BASE,
    )
  ).id;
  const script = join(import.meta.dir, '../../scripts/person-erase.ts');
  const run = (person: string) => {
    const result = Bun.spawnSync([process.execPath, script, '--person', person, '--confirm'], {
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { code: result.exitCode, out: result.stdout.toString().trim(), err: result.stderr.toString().trim() };
  };
  expect(run('cecilia.' + prefix)).toEqual({
    code: 1,
    out: '',
    err: `No person has the id "cecilia.${prefix}": nothing was erased and nothing was audited. A person is named by their id, never by a user name.`,
  });
  expect(run(id)).toEqual({
    code: 1,
    out: '',
    err: `Person "${id}" is still active: only a person the source has deactivated is erased (D68 item 1). Nothing was erased and nothing was audited.`,
  });
  expect(
    await db
      .select({ action: schema.audit.action })
      .from(schema.audit)
      .where(eq(schema.audit.subject, 'person:' + id)),
  ).toEqual([{ action: 'scim.user.created' }]);
  await scim.deleteUser(p, id);
  // Someone else's user name that is her id in another case: the index folds it as it would the id, but the erased
  // record holds no user name, so nothing collides.
  const other = (
    await scim.createUser(
      p,
      user({ userName: id.toUpperCase(), externalId: 'mk-x-' + prefix }, 'X', 'x.' + prefix + '@sundsvall.test'),
      BASE,
    )
  ).id;
  expect(run(id)).toEqual({
    code: 0,
    out: `Erased person "${id}": 4 personal fields cleared; 0 memberships, 0 placements, 0 grants, 0 sign-in bindings and 0 sessions removed; 2 audit rows and 0 sign-in log rows cleared of their identifiers. Audited as person:${id}.`,
    err: '',
  });
  const names = await db
    .select({ id: schema.people.id, userName: schema.people.userName })
    .from(schema.people)
    .where(inArray(schema.people.id, [id, other]));
  expect(Object.fromEntries(names.map(row => [row.id, row.userName]))).toEqual({
    [id]: null,
    [other]: id.toUpperCase(),
  });
  expect(run(id)).toEqual({
    code: 0,
    out: `Person "${id}" holds nothing more to erase: nothing was changed. Audited as person:${id}.`,
    err: '',
  });
  expect(
    (
      await db
        .select({ action: schema.audit.action, details: schema.audit.details })
        .from(schema.audit)
        .where(and(eq(schema.audit.subject, 'person:' + id), eq(schema.audit.action, 'person.erased')))
        .orderBy(schema.audit.id)
    ).map(row => row.details.fields),
  ).toEqual([4, 0]);
}, 60_000);
