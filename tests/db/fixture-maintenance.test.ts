import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { sealSecret, openSecret } from '../../apps/server/src/auth-crypto';
import { postgresExecutionStore } from '../../apps/server/src/modules/executions/adapters/postgres';
import { executionRecord, jobRecord, watchIntentRecord } from '../execution-store-contract';
import { retireFixtureWork } from '../../scripts/fixture-maintenance';
import { registerConnector } from '../../scripts/connector-registry';
import { bindFollower } from '../../scripts/job-bindings';

process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const personId = 'fixture-maintenance-' + randomUUID();
const connectorId = 'fixture-' + randomUUID().slice(0, 24);
const capability = connectorId + '.follow';
const ids = ['pending', 'unknown', 'succeeded', 'untouched'].map(s => personId + '-' + s);
const jobId = personId + '-job';
const store = postgresExecutionStore({ seal: sealSecret, open: openSecret });

afterAll(async () => {
  const resets = await database()
    .select()
    .from(schema.audit)
    .where(and(eq(schema.audit.action, 'fixtures.reset'), eq(schema.audit.subject, 'connectors')));
  const auditIds = resets.filter(r => (r.details as { personId?: string })?.personId === personId).map(r => r.id);
  if (auditIds.length) await database().delete(schema.audit).where(inArray(schema.audit.id, auditIds));
  await database()
    .delete(schema.audit)
    .where(
      inArray(schema.audit.subject, [
        ...ids.map(id => 'execution:' + id),
        'job:' + jobId,
        'connector:' + connectorId,
        'timer:' + personId + '-timer',
      ]),
    );
  const bindings = await database()
    .select()
    .from(schema.followBindings)
    .where(eq(schema.followBindings.capability, capability));
  for (const b of bindings)
    await database()
      .delete(schema.audit)
      .where(eq(schema.audit.subject, 'binding:' + b.id));
  await database().delete(schema.followBindings).where(eq(schema.followBindings.capability, capability));
  await database().delete(schema.connectors).where(eq(schema.connectors.id, connectorId));
  await database().delete(schema.dispatchOutbox).where(inArray(schema.dispatchOutbox.executionId, ids));
  await database().delete(schema.watchIntents).where(eq(schema.watchIntents.jobId, jobId));
  await database().delete(schema.executionJobs).where(eq(schema.executionJobs.id, jobId));
  await database().delete(schema.timerIntents).where(eq(schema.timerIntents.personId, personId));
  await database().delete(schema.threads).where(eq(schema.threads.personId, personId));
  await database().delete(schema.executions).where(eq(schema.executions.personId, personId));
  await database().delete(schema.people).where(eq(schema.people.id, personId));
});

test('reset retires pending work, preserves unknown effects and receipts, blocks watches, and frees old topics', async () => {
  await database().insert(schema.people).values({ id: personId, organisationId: 'test', name: 'Fixture reset test' });
  const records = ids.map((id, i) => ({
    ...executionRecord(personId, id),
    decisionId: id,
    ...(i < 3 ? { connector: 'hr', operation: 'hr.reportAbsence' } : {}),
  }));
  records[1]!.state = 'unknown';
  records[1]!.dispatchedAt = records[1]!.createdAt;
  records[2]!.state = 'succeeded';
  records[2]!.dispatchedAt = records[2]!.createdAt;
  records[2]!.result = {
    headline: 'Bekräftat',
    rows: [{ ref: 'hr:emp:1005', label: 'Frånvaro', outcome: 'done', detail: 'Registrerad' }],
  };
  const job = jobRecord(personId, jobId, records.slice(0, 3));
  await store.transaction(async tx => {
    for (const e of records) await tx.insert(e);
    await tx.insertJob(job);
    await tx.enqueueWatch(watchIntentRecord(job));
    await tx.enqueue({
      id: personId + '-dispatch',
      executionId: ids[0]!,
      attempt: 0,
      nextAt: records[0]!.createdAt,
      leaseUntil: null,
      deliveredAt: null,
      lastError: null,
    });
  });
  const receipt = { ...records[2]!.result!, at: records[2]!.createdAt, undoUntil: null, undoCapability: null };
  await database()
    .insert(schema.threads)
    .values({
      id: personId + '-thread',
      personId,
      kind: 'pushed',
      connector: 'hr',
      area: 'employees',
      topic: 'hr:leave:test',
      title: 'Historik',
      state: 'dismissed',
      trigger: { reason: 'Test', source: 'HR', at: records[0]!.createdAt },
      receipt,
    });
  await database()
    .insert(schema.timerIntents)
    .values({
      id: personId + '-timer',
      threadId: personId + '-thread',
      personId,
      kind: 'reminder',
      generation: 1,
      unitId: 'test',
      authorizationVersion: 'test',
      dueAt: new Date('2099-12-01'),
      requestedAt: new Date(),
      state: 'active',
      nextAt: new Date(),
    });
  const at = new Date('2099-11-05T11:00:00.000Z');
  expect(await retireFixtureWork({ personId, at })).toEqual({ retired: 3, blocked: 1, archived: 1, cancelled: 1 });
  expect(await store.read(ids[0]!)).toMatchObject({ state: 'failed', reason: 'source-reset' });
  expect(await store.read(ids[1]!)).toMatchObject({ state: 'unknown', reason: 'source-reset' });
  expect(await store.read(ids[2]!)).toMatchObject({
    state: 'succeeded',
    reason: 'source-reset',
    result: records[2]!.result,
  });
  expect(await store.read(ids[3]!)).toEqual(records[3]!);
  expect((await store.readJob(jobId))!.steps.at(-1)).toMatchObject({ state: 'blocked', reason: 'source-reset' });
  const [delivery] = await database()
    .select()
    .from(schema.dispatchOutbox)
    .where(eq(schema.dispatchOutbox.executionId, ids[0]!));
  expect(delivery!.deliveredAt).toEqual(at);
  const [thread] = await database()
    .select()
    .from(schema.threads)
    .where(eq(schema.threads.id, personId + '-thread'));
  expect(thread!.topic).toStartWith('hr:leave:test:fixture-reset:');
  expect(thread!.receipt).toEqual(receipt);
  expect(thread!.actions).toEqual([]);
  const [timer] = await database()
    .select()
    .from(schema.timerIntents)
    .where(eq(schema.timerIntents.id, personId + '-timer'));
  expect(timer).toMatchObject({ state: 'cancelled', reason: 'source-reset', generation: 2 });
  const audits = await database()
    .select()
    .from(schema.audit)
    .where(
      inArray(
        schema.audit.subject,
        ids.slice(0, 3).map(id => 'execution:' + id),
      ),
    );
  expect(audits.filter(a => a.action === 'execution.source_reset')).toHaveLength(3);
  expect(await retireFixtureWork({ personId, at })).toEqual({ retired: 0, blocked: 0, archived: 0, cancelled: 0 });
});

test('bootstrap leaves an existing disabled connector and disabled scoped binding unchanged', async () => {
  const manifest = {
    protocol: 2,
    id: connectorId,
    kind: 'passthrough',
    source: 'Test',
    scan: false,
    areas: [],
    capabilities: [],
  };
  await database()
    .insert(schema.connectors)
    .values({
      id: connectorId,
      url: 'http://original.invalid',
      secret: 'preserve-this-seal',
      state: 'disabled',
      audience: { mode: 'selected', units: ['private-unit'] },
      manifest,
      createdBy: 'test',
      updatedBy: 'test',
    });
  const [before] = await database().select().from(schema.connectors).where(eq(schema.connectors.id, connectorId));
  const result = await registerConnector({
    id: connectorId,
    url: 'http://127.0.0.1:1',
    secret: 'replacement-not-used',
    enable: true,
    ifMissing: true,
  });
  expect(result.state).toBe('disabled');
  expect((await database().select().from(schema.connectors).where(eq(schema.connectors.id, connectorId)))[0]).toEqual(
    before!,
  );
  const original = await bindFollower(
    { kind: 'fixture-test:event', capability, audience: { mode: 'selected', units: ['private-unit'] }, within: 'PT9M' },
    false,
  );
  const preserved = await bindFollower(
    { kind: 'fixture-test:event', capability, audience: { mode: 'all' }, within: 'PT1M' },
    true,
    true,
  );
  expect(preserved.binding).toEqual(original.binding);
});
