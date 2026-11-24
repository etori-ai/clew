import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { changeSignals, signalColumns, unsignalledTables } from '../../packages/db/src/schema';
import { changesFor } from '../../apps/server/src/composition/changes';
import { SHARED_COUNTERS, counterSequence } from '../../apps/server/src/shared-content';

/** A person's own content counter: the first part of the revision, before the installation-wide counters they see. */
const own = (revision: string) => Number(revision.split(':')[0]);
/** An installation-wide content counter as it stands: its sequence's last value, 0 before it first moved. */
const counter = async (id: string) => {
  const [row] = await database().execute<{ n: string }>(
    sql`select case when is_called then last_value else 0 end as n from ${sql.identifier(counterSequence(id))}`,
  );
  return Number(row!.n);
};

test('change revisions commit with the business mutation, survive rollback and distinguish authority changes', async () => {
  const id = 'changes-test-' + randomUUID(),
    thread = id + '-thread',
    at = new Date();
  await database().insert(schema.people).values({ id, name: 'Synthetic change test', organisationId: 'test' });
  try {
    await database()
      .insert(schema.threads)
      .values({
        id: thread,
        personId: id,
        kind: 'pushed',
        topic: thread,
        title: 'Synthetic',
        connector: 'reference',
        area: 'reference',
        trigger: { reason: 'Test', source: 'Test', at: at.toISOString() },
      });
    const before = await changesFor({ id, capabilities: [] });
    await expect(
      database().transaction(async tx => {
        await tx.update(schema.threads).set({ title: 'Rolled back' }).where(eq(schema.threads.id, thread));
        throw new Error('rollback');
      }),
    ).rejects.toThrow();
    expect(await changesFor({ id, capabilities: [] })).toEqual(before);
    await database().update(schema.threads).set({ title: 'Committed' }).where(eq(schema.threads.id, thread));
    const changed = await changesFor({ id, capabilities: [] });
    expect(own(changed.revision)).toBe(own(before.revision) + 1);
    expect(changed.policy).toBe(before.policy);
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, id));
    expect((await changesFor({ id, capabilities: [] })).policy).not.toBe(before.policy);
    // A second business mutation must not lock the shared revision before it
    // reaches a card already locked by the first transaction.
    let firstLocked!: () => void, secondWritten!: () => void;
    const locked = new Promise<void>(resolve => {
      firstLocked = resolve;
    });
    const written = new Promise<void>(resolve => {
      secondWritten = resolve;
    });
    await Promise.all([
      database().transaction(async tx => {
        await tx.select().from(schema.threads).where(eq(schema.threads.id, thread)).for('update');
        firstLocked();
        await written;
        await tx.update(schema.threads).set({ title: 'First writer' }).where(eq(schema.threads.id, thread));
      }),
      database().transaction(async tx => {
        await locked;
        await tx.update(schema.people).set({ name: 'Concurrent writer' }).where(eq(schema.people.id, id));
        secondWritten();
        await tx.update(schema.threads).set({ title: 'Second writer' }).where(eq(schema.threads.id, thread));
      }),
    ]);
    const [row] = await database().select().from(schema.threads).where(eq(schema.threads.id, thread));
    expect(row?.title).toBe('Second writer');
  } finally {
    await database().delete(schema.threads).where(eq(schema.threads.id, thread));
    await database().delete(schema.people).where(eq(schema.people.id, id));
    await database().delete(schema.personChanges).where(eq(schema.personChanges.personId, id));
  }
});

test('a talk and an action point bump the change revision of every person they concern, at commit', async () => {
  const base = 'talk-changes-' + randomUUID(),
    employee = base + '-employee',
    manager = base + '-manager',
    other = base + '-other',
    booker = base + '-booker',
    round = base + '-round',
    talk = base + '-talk',
    commitment = base + '-commitment',
    people = [employee, manager, other, booker];
  const revision = async (id: string) => own((await changesFor({ id, capabilities: [] })).revision);
  const revisions = async () => Object.fromEntries(await Promise.all(people.map(async p => [p, await revision(p)])));
  const bumped = async (before: Record<string, number>, expected: string[]) => {
    const after = await revisions();
    for (const p of people) expect([p, after[p]! > before[p]!]).toEqual([p, expected.includes(p)]);
  };
  await database()
    .insert(schema.people)
    .values(people.map(id => ({ id, name: 'Synthetic talk change test', organisationId: 'test' })));
  try {
    await database().insert(schema.talkRounds).values({
      id: round,
      organisationId: base,
      kind: 'development',
      label: 'Utvecklingssamtal 2026',
      opensOn: '2026-11-01',
      dueOn: '2026-11-28',
      createdBy: 'operator:test',
    });
    // A talk: the employee on insert; the employee and the manager who marks it held; both again when it is removed.
    let before = await revisions();
    await database().insert(schema.talks).values({ id: talk, roundId: round, employeeId: employee });
    await bumped(before, [employee]);
    before = await revisions();
    await database()
      .update(schema.talks)
      .set({ heldOn: '2026-11-10', heldBy: manager })
      .where(eq(schema.talks.id, talk));
    await bumped(before, [employee, manager]);
    // The manager who books it sees the booking, and sees it go when it is taken off (DE-L10: 0043 named no booker).
    before = await revisions();
    const start = new Date('2026-11-20T09:00:00Z');
    await database()
      .update(schema.talks)
      .set({ bookedStart: start, bookedEnd: new Date(start.getTime() + 3_600_000), bookedAt: start, bookedBy: booker })
      .where(eq(schema.talks.id, talk));
    await bumped(before, [employee, manager, booker]);
    before = await revisions();
    await database()
      .update(schema.talks)
      .set({ bookedStart: null, bookedEnd: null, bookedAt: null, bookedBy: null })
      .where(eq(schema.talks.id, talk));
    await bumped(before, [employee, manager, booker]);
    before = await revisions();
    await database().delete(schema.talks).where(eq(schema.talks.id, talk));
    await bumped(before, [employee, manager]);

    // An action point: the employee, the owner and who added it; a change of owner reaches the old and the new one.
    before = await revisions();
    await database().insert(schema.talkCommitments).values({
      id: commitment,
      roundId: round,
      employeeId: employee,
      ownerRole: 'manager',
      ownerId: manager,
      textSealed: 'sealed',
      dueOn: '2026-12-01',
      createdBy: manager,
    });
    await bumped(before, [employee, manager]);
    before = await revisions();
    await database()
      .update(schema.talkCommitments)
      .set({ ownerRole: 'employee', ownerId: employee, createdBy: null })
      .where(eq(schema.talkCommitments.id, commitment));
    await bumped(before, [employee, manager]);
    before = await revisions();
    await database()
      .update(schema.talkCommitments)
      .set({ doneAt: new Date(), doneBy: other })
      .where(eq(schema.talkCommitments.id, commitment));
    await bumped(before, [employee, other]);
    // Rolled back, nothing moves.
    before = await revisions();
    await expect(
      database().transaction(async tx => {
        await tx
          .update(schema.talkCommitments)
          .set({ ownerId: manager })
          .where(eq(schema.talkCommitments.id, commitment));
        throw new Error('rollback');
      }),
    ).rejects.toThrow();
    await bumped(before, []);
    before = await revisions();
    await database().delete(schema.talkCommitments).where(eq(schema.talkCommitments.id, commitment));
    await bumped(before, [employee, other]);
  } finally {
    await database().delete(schema.talkCommitments).where(eq(schema.talkCommitments.roundId, round));
    await database().delete(schema.talks).where(eq(schema.talks.roundId, round));
    await database().delete(schema.talkRounds).where(eq(schema.talkRounds.id, round));
    for (const id of people) {
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await database().delete(schema.personChanges).where(eq(schema.personChanges.personId, id));
    }
  }
});

test('a competence source read moves the revision of those who may see Källor, and a renewed lease moves nothing (WD-L8)', async () => {
  const connector = 'changes-source-' + randomUUID(),
    admin = { id: 'changes-admin-' + randomUUID(), capabilities: ['admin.competence'] },
    other = { id: 'changes-other-' + randomUUID(), capabilities: ['admin.users'] },
    at = Date.now();
  const where = eq(schema.competenceSources.connectorId, connector);
  await database()
    .insert(schema.connectors)
    .values({ id: connector, bundled: true, createdBy: 'test', updatedBy: 'test' });
  try {
    const before = { admin: await changesFor(admin), other: await changesFor(other) };
    // A read claims the source: the page draws it as under way.
    await database()
      .insert(schema.competenceSources)
      .values({
        connectorId: connector,
        source: 'Kompetenskällan',
        run: 'run-1',
        claimedAt: new Date(at),
        leaseUntil: new Date(at + 60_000),
      });
    const claimed = await changesFor(admin);
    expect(claimed.revision).not.toBe(before.admin.revision);
    expect(claimed.policy).toBe(before.admin.policy);
    expect((await changesFor(other)).revision).toBe(before.other.revision);
    // The lease renewed between pages: nothing the page draws has changed.
    await database()
      .update(schema.competenceSources)
      .set({ leaseUntil: new Date(at + 120_000) })
      .where(where);
    expect((await changesFor(admin)).revision).toBe(claimed.revision);
    // The read ends.
    await database()
      .update(schema.competenceSources)
      .set({
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: new Date(at),
        finishedAt: new Date(at + 90_000),
        outcome: 'complete',
        counts: { total: 0 },
      })
      .where(where);
    expect((await changesFor(admin)).revision).not.toBe(claimed.revision);
    expect((await changesFor(other)).revision).toBe(before.other.revision);
  } finally {
    await database().delete(schema.competenceSources).where(where);
    await database().delete(schema.connectors).where(eq(schema.connectors.id, connector));
  }
});

test('every table has a change signal or a reason it has none, and the database holds the triggers schema.ts declares (DE-L10)', async () => {
  const tables = await database().execute<{ name: string }>(
    sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const signalled = new Set(changeSignals.map(s => s.table));
  const unsignalled = Object.keys(unsignalledTables);
  expect(unsignalled.filter(t => signalled.has(t))).toEqual([]);
  expect(tables.map(t => t.name).sort()).toEqual([...new Set([...signalled, ...unsignalled])].sort());
  const triggers = await database().execute<{
    table: string;
    trigger: string;
    fn: string;
    args: string[];
    deferred: boolean;
    type: number;
  }>(sql`
    select c.relname as table, t.tgname as trigger, p.proname as fn,
      array_remove(string_to_array(encode(t.tgargs, 'escape'), '\\000'), '') as args,
      t.tgdeferrable and t.tginitdeferred as deferred, t.tgtype::int as type
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and n.nspname = 'public' and p.proname like 'clew\\_%changed'`);
  const key = (s: { table: string; trigger: string }) => s.table + '.' + s.trigger;
  expect(
    triggers
      .map(t => ({ table: t.table, trigger: t.trigger, fn: t.fn, args: t.args }))
      .sort((a, b) => key(a).localeCompare(key(b))),
  ).toEqual(
    changeSignals
      .map(s => ({ table: s.table, trigger: s.trigger, fn: s.fn, args: [...(s.args ?? [])] }))
      .sort((a, b) => key(a).localeCompare(key(b))),
  );
  // Every one is deferred to the commit, after each row inserted, changed or removed (tgtype: row 1, insert 4, delete 8, update 16).
  expect(triggers.filter(t => !t.deferred || t.type !== 1 + 4 + 8 + 16).map(key)).toEqual([]);
  // An argument that names a column names one the table has: a person column misspelt would move nobody's counter.
  const columns = await database().execute<{ table: string; column: string }>(
    sql`select table_name as table, column_name as column from information_schema.columns where table_schema = 'public'`,
  );
  const has = new Set(columns.map(c => c.table + '.' + c.column));
  const named = changeSignals.flatMap(s => signalColumns(s).map(column => s.table + '.' + column));
  expect(named.filter(c => !has.has(c))).toEqual([]);
  // Each installation counter is a sequence of its own, and there is no other.
  const sequences = await database().execute<{ name: string }>(
    sql`select sequencename as name from pg_sequences where schemaname = 'public' and sequencename like 'content\_change\_%'`,
  );
  expect(sequences.map(s => s.name).sort()).toEqual(SHARED_COUNTERS.map(counterSequence).sort());
});

test("a connector's rail moves everyone's policy, a check only its administrators' revision (DE-L10)", async () => {
  const connector = 'changes-connector-' + randomUUID(),
    admin = { id: 'changes-admin-' + randomUUID(), capabilities: ['admin.connectors'] },
    person = { id: 'changes-person-' + randomUUID(), capabilities: [] as string[] };
  const where = eq(schema.connectors.id, connector);
  const policy = async () => (await changesFor(person)).policy;
  await database()
    .insert(schema.connectors)
    .values({ id: connector, bundled: true, createdBy: 'test', updatedBy: 'test' });
  try {
    for (const set of [{ areas: { cases: {} } }, { ordinal: 3 }, { headerHolder: true }]) {
      const before = await policy();
      await database().update(schema.connectors).set(set).where(where);
      expect([Object.keys(set)[0], await policy()]).not.toEqual([Object.keys(set)[0], before]);
    }
    const before = { policy: await policy(), admin: await changesFor(admin), person: await changesFor(person) };
    await database()
      .update(schema.connectors)
      .set({ health: { status: 'ok', at: new Date().toISOString() } })
      .where(where);
    expect(await policy()).toBe(before.policy);
    expect((await changesFor(admin)).revision).not.toBe(before.admin.revision);
    expect((await changesFor(person)).revision).toBe(before.person.revision);
  } finally {
    await database().delete(schema.connectors).where(where);
  }
});

test("a talk round moves everyone's revision; a push of the organisation moves its administrators' once (DE-L10)", async () => {
  const base = 'changes-shared-' + randomUUID(),
    users = { id: base + '-users', capabilities: ['admin.users'] },
    person = { id: base + '-person', capabilities: [] as string[] };
  try {
    const before = { users: await changesFor(users), person: await changesFor(person) };
    await database()
      .insert(schema.talkRounds)
      .values({
        id: base + '-round',
        organisationId: base,
        kind: 'development',
        label: 'Utvecklingssamtal 2027',
        opensOn: '2027-11-01',
        dueOn: '2027-11-28',
        createdBy: 'operator:test',
      });
    const rounded = { users: await changesFor(users), person: await changesFor(person) };
    expect(rounded.person.revision).not.toBe(before.person.revision);
    expect(rounded.users.revision).not.toBe(before.users.revision);
    // One push of a unit, three groups and their members: the counter moves once, for those who administer users only.
    const organisation = await counter('organisation');
    await database().transaction(async tx => {
      await tx.insert(schema.units).values({ id: base + '-unit', organisationId: base, label: 'Enhet' });
      await tx.insert(schema.people).values({ id: base + '-member', name: 'Synthetic member', organisationId: base });
      for (const n of [1, 2, 3]) {
        await tx.insert(schema.groups).values({ id: `${base}-group-${n}`, organisationId: base, label: 'Grupp ' + n });
        await tx.insert(schema.groupMembers).values({ groupId: `${base}-group-${n}`, personId: base + '-member' });
      }
    });
    expect(await counter('organisation')).toBe(organisation + 1);
    expect((await changesFor(users)).revision).not.toBe(rounded.users.revision);
    expect((await changesFor(person)).revision).toBe(rounded.person.revision);
    // Touching a group's updated_at alone draws nothing new.
    await database()
      .update(schema.groups)
      .set({ updatedAt: new Date() })
      .where(eq(schema.groups.id, base + '-group-1'));
    expect(await counter('organisation')).toBe(organisation + 1);
  } finally {
    await database().execute(sql`delete from auth_group_member where person_id = ${base + '-member'}`);
    await database().execute(sql`delete from auth_group where organisation_id = ${base}`);
    await database().execute(sql`delete from auth_unit where organisation_id = ${base}`);
    await database().execute(sql`delete from talk_round where organisation_id = ${base}`);
    await database().execute(sql`delete from auth_person where organisation_id = ${base}`);
    await database().execute(sql`delete from person_change where person_id like ${base + '%'}`);
  }
});

test('a boarding item and a competence holding reach the people they name and the plan they belong to (DE-L10)', async () => {
  const base = 'changes-people-' + randomUUID(),
    [newcomer, manager, buddy, owner, assessor] = ['newcomer', 'manager', 'buddy', 'owner', 'assessor'].map(
      p => base + '-' + p,
    ) as [string, string, string, string, string],
    people = [newcomer, manager, buddy, owner, assessor];
  const revisions = async () =>
    Object.fromEntries(
      await Promise.all(people.map(async p => [p, own((await changesFor({ id: p, capabilities: [] })).revision)])),
    );
  const bumped = async (before: Record<string, number>, expected: string[]) => {
    const after = await revisions();
    for (const p of people) expect([p, after[p]! > before[p]!]).toEqual([p, expected.includes(p)]);
  };
  await database()
    .insert(schema.people)
    .values(people.map(id => ({ id, name: 'Synthetic people change test', organisationId: base })));
  try {
    await database()
      .insert(schema.boardingPlans)
      .values({
        id: base + '-plan',
        organisationId: base,
        personId: newcomer,
        event: 'introduction',
        anchorOn: '2026-12-01',
        buddyId: buddy,
        startedBy: manager,
      });
    let before = await revisions();
    await database()
      .insert(schema.boardingItems)
      .values({
        id: base + '-item',
        planId: base + '-plan',
        position: 1,
        title: 'Nycklar',
        kind: 'todo',
        ownerRole: 'manager',
        ownerId: owner,
        dueOn: '2026-12-01',
      });
    await bumped(before, [newcomer, manager, buddy, owner]);
    before = await revisions();
    await database()
      .update(schema.boardingItems)
      .set({ doneAt: new Date(), doneBy: assessor })
      .where(eq(schema.boardingItems.id, base + '-item'));
    await bumped(before, [newcomer, manager, buddy, owner, assessor]);

    await database()
      .insert(schema.competenceTypes)
      .values({
        id: base + '-type',
        organisationId: base,
        name: 'Hjärt-lungräddning',
        area: 'Vård',
        kind: 'certificate',
        createdBy: 'operator:test',
      });
    before = await revisions();
    await database()
      .insert(schema.competenceHoldings)
      .values({
        id: base + '-holding',
        personId: newcomer,
        typeId: base + '-type',
        issuedOn: '2026-01-01',
        evidence: 'manager',
        state: 'valid',
        registeredBy: manager,
      });
    await bumped(before, [newcomer, manager]);
    before = await revisions();
    await database()
      .update(schema.competenceHoldings)
      .set({ state: 'revoked', revokedAt: new Date(), revokedBy: assessor })
      .where(eq(schema.competenceHoldings.id, base + '-holding'));
    await bumped(before, [newcomer, manager, assessor]);
  } finally {
    await database().execute(sql`delete from competence_holding where person_id = ${newcomer}`);
    await database().execute(sql`delete from competence_type where organisation_id = ${base}`);
    await database().execute(sql`delete from boarding_plan where organisation_id = ${base}`);
    await database().execute(sql`delete from auth_person where organisation_id = ${base}`);
    await database().execute(sql`delete from person_change where person_id like ${base + '%'}`);
  }
});

test('two transactions that move one installation counter never wait for each other, each moves it once, and a rollback keeps its move (D46)', async () => {
  const base = 'changes-sequence-' + randomUUID();
  const round = (n: number) => ({
    id: `${base}-round-${n}`,
    organisationId: `${base}-${n}`,
    kind: 'development' as const,
    label: 'Utvecklingssamtal 2028',
    opensOn: '2028-11-01',
    dueOn: '2028-11-28',
    createdBy: 'operator:test',
  });
  try {
    const before = await counter('talk-round');
    let release!: () => void, held!: () => void;
    const ended = new Promise<void>(resolve => (release = resolve)),
      holds = new Promise<void>(resolve => (held = resolve));
    // The first fires its signals as its commit would, holds its transaction open, and then rolls back.
    const first = database()
      .transaction(async tx => {
        await tx.insert(schema.talkRounds).values(round(1));
        await tx.insert(schema.talkRounds).values(round(2));
        await tx.execute(sql`set constraints all immediate`);
        held();
        await ended;
        throw new Error('rolled back');
      })
      .catch((error: Error) => error.message);
    await holds;
    try {
      // The second moves the same counter at its commit. A counter held as a row would make it wait for the first
      // transaction's lock until `lock_timeout` refused it (55P03).
      await database().transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        await tx.insert(schema.talkRounds).values(round(3));
      });
      expect(await counter('talk-round')).toBe(before + 2);
    } finally {
      release();
    }
    expect(await first).toBe('rolled back');
    // The first moved it once for its two rows, and its rollback did not take that back.
    expect(await counter('talk-round')).toBe(before + 2);
    expect(
      (await database().execute<{ id: string }>(sql`select id from talk_round where id like ${base + '%'}`)).map(
        r => r.id,
      ),
    ).toEqual([`${base}-round-3`]);
  } finally {
    await database().execute(sql`delete from talk_round where id like ${base + '%'}`);
  }
});

test("a requirement of one person reaches that person alone, and a model's administration only those who administer it (DE-L10)", async () => {
  const base = 'changes-aimed-' + randomUUID(),
    employee = base + '-employee',
    other = base + '-other',
    admin = { id: base + '-admin', capabilities: ['admin.connectors'] },
    person = { id: base + '-person', capabilities: [] as string[] },
    provider = base + '-provider',
    model = base + '-model';
  const revision = async (id: string) => own((await changesFor({ id, capabilities: [] })).revision);
  await database()
    .insert(schema.people)
    .values([employee, other].map(id => ({ id, name: 'Synthetic aimed change test', organisationId: base })));
  try {
    await database()
      .insert(schema.competenceTypes)
      .values({
        id: base + '-type',
        organisationId: base,
        name: 'Hjärt-lungräddning',
        area: 'Vård',
        kind: 'course',
        createdBy: 'operator:test',
      });
    const catalogue = await counter('competence-catalogue');
    const was = { employee: await revision(employee), other: await revision(other) };
    // A requirement of one person: that person's counter, old and new, and not everyone's catalogue.
    await database()
      .insert(schema.competenceRequirements)
      .values({
        id: base + '-mine',
        organisationId: base,
        typeId: base + '-type',
        personId: employee,
        createdBy: 'person:' + other,
      });
    expect(await counter('competence-catalogue')).toBe(catalogue);
    expect([await revision(employee), await revision(other)]).toEqual([was.employee + 1, was.other]);
    await database()
      .delete(schema.competenceRequirements)
      .where(eq(schema.competenceRequirements.id, base + '-mine'));
    expect(await counter('competence-catalogue')).toBe(catalogue);
    expect([await revision(employee), await revision(other)]).toEqual([was.employee + 2, was.other]);
    // A requirement of a unit is the catalogue's.
    await database()
      .insert(schema.competenceRequirements)
      .values({
        id: base + '-unit',
        organisationId: base,
        typeId: base + '-type',
        unitId: base + '-unit',
        createdBy: 'operator:test',
      });
    expect(await counter('competence-catalogue')).toBe(catalogue + 1);
    expect(await revision(employee)).toBe(was.employee + 2);

    // A model: what only Administration › Modeller draws moves its administrators' revision, what a person's model
    // menu draws moves everyone's.
    await database().insert(schema.modelProviders).values({
      id: provider,
      title: 'Leverantör',
      baseUrl: 'http://model.test/v1',
      createdBy: 'test',
      updatedBy: 'test',
    });
    await database().insert(schema.models).values({
      id: model,
      providerId: provider,
      model: 'open-model',
      title: 'Modell',
      createdBy: 'test',
      updatedBy: 'test',
    });
    const states = async () => ({
      admin: (await changesFor(admin)).revision,
      person: (await changesFor(person)).revision,
    });
    let before = await states();
    await database()
      .update(schema.models)
      .set({ tools: false, reasoning: 'none', model: 'open-model-2', version: 2, updatedAt: new Date() })
      .where(eq(schema.models.id, model));
    let after = await states();
    expect([after.admin === before.admin, after.person === before.person]).toEqual([false, true]);
    before = after;
    await database()
      .update(schema.modelProviders)
      .set({ health: { status: 'ok', at: new Date().toISOString() }, version: 2, updatedAt: new Date() })
      .where(eq(schema.modelProviders.id, provider));
    after = await states();
    expect([after.admin === before.admin, after.person === before.person]).toEqual([false, true]);
    before = after;
    await database()
      .update(schema.models)
      .set({ title: 'Modell med nytt namn', version: 3, updatedAt: new Date() })
      .where(eq(schema.models.id, model));
    after = await states();
    expect([after.admin === before.admin, after.person === before.person]).toEqual([false, false]);
  } finally {
    await database().execute(sql`delete from model where id = ${model}`);
    await database().execute(sql`delete from model_provider where id = ${provider}`);
    await database().execute(sql`delete from competence_requirement where organisation_id = ${base}`);
    await database().execute(sql`delete from competence_type where organisation_id = ${base}`);
    await database().execute(sql`delete from auth_person where organisation_id = ${base}`);
    await database().execute(sql`delete from person_change where person_id like ${base + '%'}`);
  }
});
