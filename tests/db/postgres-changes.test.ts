import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { changesFor } from '../../apps/server/src/composition/changes';

test('change revisions commit with the business mutation, survive rollback and distinguish authority changes', async () => {
  const id = 'changes-test-' + randomUUID(), thread = id + '-thread', at = new Date();
  await database().insert(schema.people).values({ id, name: 'Synthetic change test', organisationId: 'test' });
  try {
    await database().insert(schema.threads).values({ id: thread, personId: id, kind: 'pushed', topic: thread, title: 'Synthetic', connector: 'reference', area: 'reference', trigger: { reason: 'Test', source: 'Test', at: at.toISOString() } });
    const before = await changesFor(id);
    await expect(database().transaction(async tx => { await tx.update(schema.threads).set({ title: 'Rolled back' }).where(eq(schema.threads.id, thread)); throw new Error('rollback'); })).rejects.toThrow();
    expect(await changesFor(id)).toEqual(before);
    await database().update(schema.threads).set({ title: 'Committed' }).where(eq(schema.threads.id, thread));
    const changed = await changesFor(id);
    expect(Number(changed.revision)).toBe(Number(before.revision) + 1); expect(changed.policy).toBe(before.policy);
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, id));
    expect((await changesFor(id)).policy).not.toBe(before.policy);
    // A second business mutation must not lock the shared revision before it
    // reaches a card already locked by the first transaction.
    let firstLocked!: () => void, secondWritten!: () => void;
    const locked = new Promise<void>(resolve => { firstLocked = resolve; });
    const written = new Promise<void>(resolve => { secondWritten = resolve; });
    await Promise.all([
      database().transaction(async tx => {
        await tx.select().from(schema.threads).where(eq(schema.threads.id, thread)).for('update');
        firstLocked(); await written;
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
