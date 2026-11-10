import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { changesFor } from '../../apps/server/src/composition/changes';

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
    const before = await changesFor(id);
    await expect(
      database().transaction(async tx => {
        await tx.update(schema.threads).set({ title: 'Rolled back' }).where(eq(schema.threads.id, thread));
        throw new Error('rollback');
      }),
    ).rejects.toThrow();
    expect(await changesFor(id)).toEqual(before);
    await database().update(schema.threads).set({ title: 'Committed' }).where(eq(schema.threads.id, thread));
    const changed = await changesFor(id);
    expect(Number(changed.revision)).toBe(Number(before.revision) + 1);
    expect(changed.policy).toBe(before.policy);
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, id));
    expect((await changesFor(id)).policy).not.toBe(before.policy);
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
    round = base + '-round',
    talk = base + '-talk',
    commitment = base + '-commitment',
    people = [employee, manager, other];
  const revision = async (id: string) => Number((await changesFor(id)).revision);
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
