import { afterAll, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '../../packages/db/src';
import { postgresRefreshStore } from '../../apps/server/src/threads/adapters/refresh-postgres';
import { postgresThreadStore } from '../../apps/server/src/threads/adapters/postgres';
import { postgresAttention } from '../../apps/server/src/threads/adapters/attention-postgres';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import { durableJobs } from '../../apps/server/src/scheduler/adapters/durable-postgres';
import { scheduledJobRunner } from '../../apps/server/src/scheduler/usecases';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { Registry, openGovernance, type ScanObservation } from '../../packages/connectors/src';
import { threadAccess } from '../../apps/server/src/threads/access';
import { draft } from '../store-contract';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';

process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const sealer = { seal: sealSecret, open: openSecret };

const people: string[] = [],
  subjects: string[] = [],
  jobIds: string[] = [];
afterAll(async () => {
  if (subjects.length) await database().delete(schema.audit).where(inArray(schema.audit.subject, subjects));
  if (jobIds.length) await database().delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
  if (people.length) {
    const deliveries = await database()
      .select()
      .from(schema.deliveries)
      .where(inArray(schema.deliveries.personId, people));
    if (deliveries.length)
      await database()
        .delete(schema.jobs)
        .where(
          inArray(
            schema.jobs.id,
            deliveries.map(d => 'attention:' + d.batch),
          ),
        );
    await database().delete(schema.threads).where(inArray(schema.threads.personId, people));
    await database().delete(schema.people).where(inArray(schema.people.id, people));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});
/**
 * The step of a job's `scheduledJob` workflow (D86) as the engine runs it at `at`: the job claimed by id, an attention
 * batch released, the execution completed. Any other kind is a failure here.
 */
const jobStepAt = (attention: ReturnType<typeof postgresAttention>, at: string) =>
  scheduledJobRunner({
    executions: durableJobs,
    release: batch => attention.release(batch, at),
    run: async job => {
      throw new Error('Not an attention job: ' + job.kind);
    },
    clock: () => new Date(at),
  });
const auditActions = async (subject: string) =>
  (await database().select().from(schema.audit).where(eq(schema.audit.subject, subject))).map(a => a.action).sort();
async function person() {
  const id = 'refresh-test-' + crypto.randomUUID();
  people.push(id);
  await database().insert(schema.people).values({ id, organisationId: 'test', name: 'Synthetic refresh test' });
  return {
    id,
    name: 'Test',
    role: 'manager',
    unitId: 'test',
    authorizationVersion: 'v1',
    principal: { id: 'person:' + id },
    authorize: async () => ({ version: 'v1' }),
  } as AuthenticatedContext;
}
test('postgres refresh coalesces, preserves dismissal, fences stale scans and only resolves complete observations', async () => {
  const actor = await person(),
    store = postgresRefreshStore({ durable: testDurable, sealer }, actor.id),
    threads = postgresThreadStore({ durable: testDurable });
  let time = Date.parse('2098-11-05T09:00:00.000Z');
  const clock = () => new Date(time),
    key = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const uc = refreshUsecases({
    store,
    clock,
    key,
    ids: () => crypto.randomUUID(),
    current: async () => actor,
    sources: async () => ['reference'],
    system: () => 'Referenssystemet',
    scan: async () => ({ drafts: [] }),
  });
  await Promise.all([uc.request(actor), uc.request(actor)]);
  const requests = await store.statuses(actor.id);
  expect(requests).toHaveLength(1);
  subjects.push('refresh:' + requests[0]!.id);
  const observation = (
    revision: string,
    completeness: 'complete' | 'partial' = 'complete',
    empty = false,
  ): ScanObservation => ({
    observation: {
      scope: 'test:manager',
      observedAt: clock().toISOString(),
      version: revision,
      completeness,
      exhausted: true,
    },
    drafts: empty
      ? []
      : [
          {
            topic: 'work',
            title: 'Test work',
            summary: revision,
            area: 'test',
            reason: 'Source',
            actions: [],
            occurrences: [{ key: 'case1', period: 'once', revision }],
          },
        ],
  });
  const claim = async () => (await store.claim(clock().toISOString(), new Date(time + 30000).toISOString()))!;
  const first = await claim();
  expect(first.personId).toBe(actor.id);
  expect(await store.claim(clock().toISOString(), clock().toISOString())).toBeUndefined();
  await uc.finish(first, {}, observation('1'));
  const card = (await threads.listThreads(actor.id, clock().toISOString()))[0]!;
  subjects.push('thread:' + card.id);
  await threads.transaction(async tx => {
    await tx.updateThread(card.id, { state: 'dismissed' });
    await tx.writeAudit({
      actor: actor.id,
      action: 'thread.dismissed',
      subject: 'thread:' + card.id,
      at: clock().toISOString(),
    });
  });
  expect(
    (await database().select().from(schema.workOccurrences).where(eq(schema.workOccurrences.threadId, card.id)))[0]
      ?.disposition,
  ).toBe('dismissed');
  time += 60001;
  const unchanged = await claim();
  await uc.finish(unchanged, await store.baseline(unchanged), observation('1'));
  expect((await threads.readThread(actor.id, card.id))?.state).toBe('dismissed');
  time += 60001;
  const stale = await claim(),
    baseline = await store.baseline(stale);
  await threads.transaction(tx =>
    tx.updateThread(card.id, {
      state: 'handled',
      receipt: { at: clock().toISOString(), headline: 'Evidence', rows: [], undoUntil: null, undoCapability: null },
    }),
  );
  await uc.finish(stale, baseline, observation('2'));
  expect((await threads.readThread(actor.id, card.id))?.receipt?.headline).toBe('Evidence');
  time += 60001;
  const partial = await claim();
  await uc.finish(partial, await store.baseline(partial), observation('3', 'partial', true));
  expect(
    (await database().select().from(schema.workOccurrences).where(eq(schema.workOccurrences.threadId, card.id)))[0]
      ?.sourceState,
  ).toBe('open');
  time += 60001;
  const complete = await claim();
  await uc.finish(complete, await store.baseline(complete), observation('4', 'complete', true));
  const occurrence = (
    await database().select().from(schema.workOccurrences).where(eq(schema.workOccurrences.threadId, card.id))
  )[0]!;
  subjects.push('occurrence:' + occurrence.id);
  expect(occurrence.sourceState).toBe('resolved');
});
test('attention budget, concurrent tabs, explicit reminders and delayed release share durable records', async () => {
  const actor = await person(),
    store = postgresThreadStore({ durable: testDurable }),
    attention = postgresAttention(),
    card = draft(actor.id);
  subjects.push('thread:' + card.id);
  await store.transaction(tx => tx.insertThread(card));
  for (let n = 0; n < 4; n++)
    await store.transaction(async tx => {
      await tx.admitDelivery({
        id: actor.id + ':' + n,
        personId: actor.id,
        threadId: card.id,
        kind: 'automatic',
        at: `2098-11-05T${String(8 + n).padStart(2, '0')}:20:00.000Z`,
      });
      await tx.writeAudit({
        actor: 'test',
        action: 'work.discovered',
        subject: 'thread:' + card.id,
        at: '2098-11-05T08:20:00.000Z',
      });
    });
  const rows = await database().select().from(schema.deliveries).where(eq(schema.deliveries.personId, actor.id));
  expect(rows.filter(d => d.state === 'ready')).toHaveLength(3);
  const bundled = rows.find(d => d.state === 'waiting')!;
  expect(bundled).toBeDefined();
  const first = rows.find(row => row.state === 'ready')!;
  subjects.push('delivery:' + first.id);
  expect(
    (
      await Promise.all([
        attention.claim(actor.id, first.id, [card.id], '2098-11-06T08:00:00.000Z'),
        attention.claim(actor.id, first.id, [card.id], '2098-11-06T08:00:00.000Z'),
      ])
    ).filter(Boolean),
  ).toHaveLength(1);
  expect(await attention.claim(actor.id, first.id, [card.id], '2098-11-06T08:00:00.000Z')).toBe(false);
  expect(await attention.claim(actor.id + ':other', first.id, [card.id], '2098-11-06T08:00:00.000Z')).toBe(false);
  await store.transaction(tx =>
    tx.admitDelivery({
      id: actor.id + ':reminder',
      personId: actor.id,
      threadId: card.id,
      kind: 'reminder',
      at: '2098-11-05T11:21:00.000Z',
    }),
  );
  expect((await attention.pending(actor.id, '2098-11-05T11:21:00.000Z')).some(d => d.kind === 'reminder')).toBe(true);
  // The fourth delivery of the day waits for the 16:00 bundle; its release job's workflow committed with it (D86).
  const job = 'attention:' + bundled.batch,
    due = bundled.dueAt.toISOString();
  subjects.push('job:' + job, 'delivery:' + bundled.batch);
  expect(due).toBe('2098-11-05T15:00:00.000Z');
  expect((await enqueuedWorkflows('job:' + job)).map(w => [w.workflow, w.status, w.input])).toEqual([
    ['scheduledJob', 'ENQUEUED', { id: job, dueAt: due }],
  ]);
  expect((await attention.pending(actor.id, due)).some(d => d.id === bundled.id)).toBe(false);
  // The workflow's step before the bundle is told to come back; at the bundle it releases the batch.
  expect(await jobStepAt(attention, '2098-11-05T14:59:59.999Z')(job)).toBe('busy');
  expect(await jobStepAt(attention, due)(job)).toBe('done');
  expect((await attention.pending(actor.id, due)).some(d => d.id === bundled.id)).toBe(true);
  expect(await auditActions('delivery:' + bundled.batch)).toEqual(['attention.released']);
  expect(await auditActions('job:' + job)).toEqual(['job.completed', 'job.scheduled']);
});
test('a delivery deferred by quiet hours waits with its release job and workflow, and its job makes it ready at its due time, with any delivery its batch gains after the release', async () => {
  const actor = await person(),
    store = postgresThreadStore({ durable: testDurable }),
    attention = postgresAttention(),
    card = draft(actor.id);
  subjects.push('thread:' + card.id);
  await store.transaction(tx => tx.insertThread(card));
  const admit = (suffix: string, at: string) =>
    store.transaction(tx =>
      tx.admitDelivery({ id: actor.id + suffix, personId: actor.id, threadId: card.id, kind: 'automatic', at }),
    );
  const mine = () => database().select().from(schema.deliveries).where(eq(schema.deliveries.personId, actor.id));
  // The delivery, its job and the job's workflow are one commit: a rollback leaves none of them.
  await expect(
    store.transaction(async tx => {
      await tx.admitDelivery({
        id: actor.id + ':rolled-back',
        personId: actor.id,
        threadId: card.id,
        kind: 'automatic',
        at: '2098-11-05T20:00:00.000Z',
      });
      throw new Error('rolled back');
    }),
  ).rejects.toThrow('rolled back');
  expect(await mine()).toEqual([]);
  expect(await enqueuedWorkflows('job:attention:automatic:' + actor.id)).toEqual([]);
  // 21:00 in Stockholm is quiet hours: the delivery waits for 06:00.
  await admit(':evening', '2098-11-05T20:00:00.000Z');
  const [evening] = await mine();
  expect(evening).toMatchObject({ state: 'waiting', dueAt: new Date('2098-11-06T05:00:00.000Z') });
  const job = 'attention:' + evening!.batch,
    due = '2098-11-06T05:00:00.000Z';
  subjects.push('job:' + job, 'delivery:' + evening!.batch);
  expect(
    await database()
      .select({
        kind: schema.jobs.kind,
        status: schema.jobs.status,
        runAt: schema.jobs.runAt,
        payload: schema.jobs.payload,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, job)),
  ).toEqual([
    { kind: 'attention-release', status: 'temporal', runAt: new Date(due), payload: { batch: evening!.batch } },
  ]);
  expect((await enqueuedWorkflows('job:' + job)).map(w => [w.id, w.workflow, w.status, w.input])).toEqual([
    ['job:' + job, 'scheduledJob', 'ENQUEUED', { id: job, dueAt: due }],
  ]);
  expect(await attention.pending(actor.id, due)).toEqual([]);
  expect(await jobStepAt(attention, '2098-11-06T04:59:59.999Z')(job)).toBe('busy');
  expect((await mine())[0]?.state).toBe('waiting');
  expect(await jobStepAt(attention, due)(job)).toBe('done');
  expect(await attention.pending(actor.id, due)).toEqual([
    { id: actor.id + ':evening', threadId: card.id, kind: 'automatic' },
  ]);
  expect(await auditActions('job:' + job)).toEqual(['job.completed', 'job.scheduled']);
  // A transaction that began at 05:59 and commits after the release joins the released batch: it is written ready,
  // shown from the batch's due time, and its job is not scheduled again.
  await admit(':late', '2098-11-06T04:59:00.000Z');
  expect((await mine()).find(d => d.id === actor.id + ':late')).toMatchObject({
    state: 'ready',
    batch: evening!.batch,
    dueAt: new Date(due),
  });
  expect((await attention.pending(actor.id, '2098-11-06T04:59:30.000Z')).map(d => d.id)).toEqual([]);
  expect((await attention.pending(actor.id, due)).map(d => d.id).sort()).toEqual(
    [actor.id + ':evening', actor.id + ':late'].sort(),
  );
  expect(await auditActions('job:' + job)).toEqual(['job.completed', 'job.scheduled']);
  expect(await enqueuedWorkflows('job:' + job)).toHaveLength(1);
});
test('new jobs cannot be claimed by the legacy owner and stale acknowledgements cannot replace completion', async () => {
  const id = 'job-test-' + crypto.randomUUID();
  jobIds.push(id);
  subjects.push('job:' + id);
  await database()
    .insert(schema.jobs)
    .values({ id, kind: 'receipt-final', status: 'due', runAt: new Date('2098-11-05T08:00:00Z') });
  expect((await database().select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]?.status).toBe('temporal');
  const results = await Promise.all([
    durableJobs.claimExecution(id, '2098-11-05T09:00:00.000Z'),
    durableJobs.claimExecution(id, '2098-11-05T09:00:00.000Z'),
  ]);
  expect(results.filter(r => r === 'busy')).toHaveLength(1);
  const claim = results.find(r => r && r !== 'busy')!;
  if (claim === 'busy') throw new Error('No claim');
  await durableJobs.completed(id, claim.attempt, '2098-11-05T09:00:01.000Z');
  expect((await database().select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0]?.status).toBe('done');
});

test('postgres source snapshots reject transferred and renewed authority without retagging history', async () => {
  let current = await person(),
    time = Date.parse('2098-11-05T09:00:00.000Z');
  const clock = () => new Date(time),
    store = postgresRefreshStore({ durable: testDurable, sealer }, current.id),
    threads = postgresThreadStore({ durable: testDurable });
  const registry = new Registry()
    .register({ id: 'reference', kind: 'passthrough', source: 'Reference', areas: [], capabilities: [] })
    .govern('reference', openGovernance());
  const uc = refreshUsecases({
    store,
    clock,
    key: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    ids: () => crypto.randomUUID(),
    current: async () => current,
    sources: async () => ['reference'],
    system: () => 'Reference',
    scan: async actor => ({
      drafts: [
        {
          topic: 'work',
          title: 'Current work',
          summary: `Source content for ${actor.authorizationVersion}`,
          area: 'test',
          reason: 'Source',
          actions: [],
          occurrences: [{ key: 'case', period: 'once', revision: '1' }],
        },
      ],
      observation: {
        scope: actor.unitId + ':' + actor.role,
        observedAt: clock().toISOString(),
        version: String(time),
        completeness: 'complete',
        exhausted: true,
      },
    }),
  });
  const access = threadAccess(threads, registry),
    previous: string[] = [];
  for (const [unitId, authorizationVersion] of [
    ['test', 'v1'],
    ['other', 'v2'],
    ['other', 'v3'],
  ] as const) {
    current = { ...current, unitId, authorizationVersion, authorize: async () => ({ version: authorizationVersion }) };
    for (const id of previous) expect(await access.read(current, id)).toBeUndefined();
    await uc.request(current);
    subjects.push(...(await store.statuses(current.id)).map(r => 'refresh:' + r.id));
    await uc.tick();
    const cards = await access.list(current, clock().toISOString());
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    subjects.push('thread:' + card.id);
    expect(card.sourceAuthorization).toBe(authorizationVersion);
    expect(card.messages.map(m => m.body)).toEqual([`Source content for ${authorizationVersion}`]);
    expect(previous).not.toContain(card.id);
    previous.push(card.id);
    time++;
  }
  expect((await threads.readThread(current.id, previous[0]!))?.sourceAuthorization).toBe('v1');
  expect(await threads.listThreads(current.id, clock().toISOString())).toHaveLength(3);
});
