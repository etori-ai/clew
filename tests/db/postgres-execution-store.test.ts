import { afterAll, expect, test } from 'bun:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresExecutionStore } from '../../apps/server/src/modules/executions/adapters/postgres';
import { sealSecret, openSecret } from '../../apps/server/src/auth-crypto';
import { executionRecord, executionStoreContract, jobRecord } from '../execution-store-contract';
import { projectExecution } from '../../apps/server/src/composition/execution-projection';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const people: string[] = [];
const make = async () => {
  const personId = 'exec-test-' + randomUUID(); people.push(personId);
  await database().insert(schema.people).values({ id: personId, organisationId: 'test', name: 'Synthetic execution test' });
  const store = postgresExecutionStore({ seal: sealSecret, open: openSecret });
  return { personId, store, auditCount: async (action = 'execution.approved') => (await database().select().from(schema.audit).where(and(eq(schema.audit.actor, 'person:' + personId), eq(schema.audit.action, action)))).length };
};
executionStoreContract('postgres', make);
test('approved input and source evidence are sealed and survive a new adapter instance', async () => {
  const w = await make(), e = executionRecord(w.personId, w.personId + '-sealed');
  e.result = { headline: 'Sensitive synthetic evidence', rows: [{ ref: 'private-ref', label: 'Sensitive label', detail: 'Sensitive detail', outcome: 'done' }] };
  await w.store.transaction(tx => tx.insert(e));
  const [raw] = await database().select().from(schema.executions).where(eq(schema.executions.id, e.id));
  expect(raw!.payload).not.toContain('reference:item:1'); expect(raw!.result).not.toContain('Sensitive');
  const restarted = postgresExecutionStore({ seal: sealSecret, open: openSecret });
  expect(await restarted.read(e.id)).toEqual(e);
});
test('a job\'s steps are sealed and survive a new adapter instance', async () => {
  const w = await make(), e = executionRecord(w.personId, w.personId + '-job-step'), job = jobRecord(w.personId, w.personId + '-sealed-job', [e]);
  await w.store.transaction(async tx => { await tx.insert(e); await tx.insertJob(job); });
  const [raw] = await database().select().from(schema.executionJobs).where(eq(schema.executionJobs.id, job.id));
  expect(raw!.steps).not.toContain('hr:emp:1004'); expect(raw!.steps).not.toContain('registered');
  expect(await postgresExecutionStore({ seal: sealSecret, open: openSecret }).readJob(job.id)).toEqual(job);
});
test('approval, card state and outcome are atomic; an uncertain undo preserves the original receipt', async () => {
  const w = await make(), at = '2099-11-05T10:00:00.000Z', threadId = w.personId + '-card';
  await database().insert(schema.threads).values({ id: threadId, personId: w.personId, kind: 'pushed', topic: threadId, title: 'Synthetic card', connector: 'reference', area: 'reference', trigger: { reason: 'Test', source: 'Test', at }, createdAt: new Date(at), updatedAt: new Date(at) });
  const store = postgresExecutionStore({ seal: sealSecret, open: openSecret }, projectExecution);
  const persona: AuthenticatedContext = { id: w.personId, name: 'Test', unitId: 'test', unitLabel: 'Test', role: 'manager', organisationId: 'test', principal: { id: 'person:' + w.personId, kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2100-01-01', authorize: async () => ({ version: 'v1' }) };
  const uc = executionUsecases({ store, clock: () => new Date(at), ids: randomUUID, digest: JSON.stringify, source: {
    authorize: async () => ({ connector: 'reference', safety: { strategy: 'manual' }, needsSession: false }), current: async () => persona,
    execute: async (_, e) => { if (e.compensates) throw new Error('lost undo response'); return { headline: 'Confirmed', rows: [{ ref: 'item:1', label: 'Synthetic item', outcome: 'done', detail: 'Read back' }], undoCapability: 'reference.undo', undoMinutes: 10 }; },
    lookup: async () => undefined,
  } });
  const input = { decisionId: 'card:' + threadId, operation: 'reference.complete', payload: { refs: ['item:1'] }, presentation: { threadId, actionId: 'complete', version: at } };
  await expect(uc.approve(persona, { ...input, presentation: { ...input.presentation, version: '2000-01-01T00:00:00Z' } })).rejects.toThrow('Kortet har ändrats');
  expect((await database().select().from(schema.executions).where(eq(schema.executions.personId, w.personId))).length).toBe(0);
  const approved = await uc.approve(persona, input);
  const card = async () => (await database().select().from(schema.threads).where(eq(schema.threads.id, threadId)))[0]!;
  expect((await card()).execution?.id).toBe(approved.id); expect((await card()).receipt).toBeNull();
  await uc.progress(approved.id);
  const original = (await card()).receipt;
  expect(original?.rows[0]?.outcome).toBe('done'); expect((await card()).state).toBe('handled');
  const undo = await uc.approve(persona, { ...input, decisionId: 'undo:' + approved.id, operation: 'reference.undo', compensates: approved.id });
  await uc.progress(undo.id);
  expect((await card()).execution?.state).toBe('unknown'); expect((await card()).receipt).toEqual(original); expect((await card()).state).toBe('handled');
  expect((await store.read(approved.id))?.state).toBe('succeeded');
  await database().delete(schema.audit).where(eq(schema.audit.subject, 'thread:' + threadId));
  await database().delete(schema.threads).where(eq(schema.threads.id, threadId));
});
afterAll(async () => {
  const records = await database().select().from(schema.executions).where(inArray(schema.executions.personId, people));
  const ids = records.map(e => e.id);
  if (ids.length) {
    await database().delete(schema.dispatchOutbox).where(inArray(schema.dispatchOutbox.executionId, ids));
    await database().delete(schema.audit).where(inArray(schema.audit.subject, ids.map(id => 'execution:' + id)));
    await database().delete(schema.executions).where(inArray(schema.executions.id, ids));
  }
  await database().delete(schema.audit).where(inArray(schema.audit.subject, (await database().select().from(schema.executionJobs).where(inArray(schema.executionJobs.personId, people))).map(j => 'job:' + j.id)));
  await database().delete(schema.executionJobs).where(inArray(schema.executionJobs.personId, people));
  await database().delete(schema.threads).where(inArray(schema.threads.personId, people));
  await database().delete(schema.people).where(inArray(schema.people.id, people));
});
