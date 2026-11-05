import { afterAll } from 'bun:test';
import { inArray, eq } from 'drizzle-orm';
import { database, schema, closeDatabase } from '../../packages/db/src';
import { postgresProposalStore } from '../../apps/server/src/modules/calendar/adapters/postgres';
import { postgresFollowupStore } from '../../apps/server/src/composition/followup-store';
import { followupContract, followupFixture, followupAt } from '../followup-contract';
const created: string[] = [];
afterAll(async () => {
  if (created.length) {
    await database().delete(schema.audit).where(inArray(schema.audit.subject, created.flatMap(id => [`thread:${id}`, `thread:followup:${id}:proposal:1`, `thread:followup:${id}:proposal:2`])));
    await database().delete(schema.threads).where(inArray(schema.threads.personId, created.flatMap(id => [id, id + ':invitee'])));
    await database().delete(schema.people).where(inArray(schema.people.id, created.flatMap(id => [id, id + ':invitee'])));
  }
  await closeDatabase();
});
followupContract('postgres follow-up', async () => {
  const id = 'followup-test-' + crypto.randomUUID(), fixture = followupFixture(id); created.push(id);
  await database().insert(schema.people).values([id, id + ':invitee'].map(id => ({ id, name: 'Synthetic test', organisationId: 'test' })));
  await postgresProposalStore().transaction(async tx => {
    await tx.insertThread({ id, personId: id, topic: id, title: 'Test', week: '2026-11-02', area: 'kalender', summary: '', trigger: fixture.thread.trigger, createdAt: followupAt, updatedAt: followupAt });
    await tx.insertProposals(fixture.proposals);
  });
  const store = postgresFollowupStore();
  await store.transaction(async tx => { await tx.save(fixture.policy!); await tx.schedule(fixture.policy!, followupAt, followupAt); });
  return { id, store, deliveries: async () => (await database().select().from(schema.threads).where(eq(schema.threads.personId, id + ':invitee'))).length,
    audits: async () => (await database().select().from(schema.audit).where(eq(schema.audit.subject, 'thread:' + id))).map(a => a.action) };
});
