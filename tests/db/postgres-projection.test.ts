import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { asc, eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresExecutionStore } from '../../apps/server/src/modules/executions/adapters/postgres';
import { postgresThreadStore } from '../../apps/server/src/threads/adapters/postgres';
import { readTimer } from '../../apps/server/src/threads/adapters/timer-postgres';
import type { InvitationCall } from '../../apps/server/src/threads/adapters/projection-memory';
import type { InvitationsTx } from '../../apps/server/src/modules/calendar/model';
import { projectExecution } from '../../apps/server/src/composition/execution-projection';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { projectionAt, projectionContract } from '../projection-contract';
import { executionRecord } from '../execution-store-contract';
import { enqueuedWorkflows, forgetTestWorkflows, testDurable } from './durable';

/** The projection contract on Postgres (D45, DE-M4), bound as composition binds it. Run with `bun run test:db` in the devcontainer. */
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    const people = [p + '-manager', p + '-other-manager'];
    const threads = await db
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(like(schema.threads.id, p + '%'));
    const executions = await db
      .select({ id: schema.executions.id })
      .from(schema.executions)
      .where(inArray(schema.executions.personId, people));
    const subjects = [...threads.map(t => 'thread:' + t.id), ...executions.map(e => 'execution:' + e.id)];
    if (subjects.length) await db.delete(schema.audit).where(inArray(schema.audit.subject, subjects));
    await db.delete(schema.jobs).where(like(schema.jobs.id, '%:' + p + '%'));
    await db.delete(schema.timerIntents).where(like(schema.timerIntents.threadId, p + '%'));
    await db.delete(schema.executions).where(inArray(schema.executions.personId, people));
    await db.delete(schema.threads).where(inArray(schema.threads.personId, people));
    await db.delete(schema.people).where(inArray(schema.people.id, people));
  }
  await forgetTestWorkflows();
});

projectionContract('postgres', async () => {
  const prefix = 'test-projection-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  const personId = prefix + '-manager',
    otherId = prefix + '-other-manager';
  await database()
    .insert(schema.people)
    .values([personId, otherId].map(id => ({ id, organisationId: 'test', name: 'Synthetic projection test' })));
  // What the talks domain is told, recorded in place of the talks module's own port (bound in composition).
  const told: InvitationCall[] = [];
  const recorder: InvitationsTx = {
    established: async notice => void told.push({ kind: 'established', notice }),
    observed: async notice => void told.push({ kind: 'observed', notice }),
    moved: async notice => void told.push({ kind: 'moved', notice }),
    ended: async notice => void told.push({ kind: 'ended', notice }),
  };
  const store = postgresExecutionStore(
    { seal: sealSecret, open: openSecret },
    testDurable,
    projectExecution(testDurable, () => recorder),
  );
  const threads = postgresThreadStore({ durable: testDurable });
  return {
    personId,
    otherId,
    prefix,
    store,
    async seedCard(card) {
      await database()
        .insert(schema.threads)
        .values({
          id: card.id,
          personId: card.personId,
          kind: 'pushed',
          topic: card.id,
          title: 'Synthetic card',
          state: card.state ?? 'open',
          connector: card.connector,
          area: card.connector,
          trigger: { reason: 'Test', source: 'Test', at: projectionAt },
          createdAt: new Date(projectionAt),
          updatedAt: new Date(projectionAt),
        });
    },
    async seedProposal(p, executionId = null) {
      await database()
        .insert(schema.proposals)
        .values({
          id: p.id,
          threadId: p.threadId,
          personId: p.personId,
          status: p.status,
          participantId: p.participant.personId,
          participantEmail: p.participant.email,
          participantName: p.participant.name,
          start: new Date(p.start),
          end: new Date(p.end),
          eventUid: p.eventUid,
          eventRef: p.eventRef,
          eventRevision: p.eventRevision,
          confirmedAt: p.confirmedAt ? new Date(p.confirmedAt) : null,
          undoUntil: p.undoUntil ? new Date(p.undoUntil) : null,
          executionId,
          reminders: p.reminders,
          remindedAt: p.remindedAt ? new Date(p.remindedAt) : null,
        });
    },
    card: id => threads.readThreadById(id),
    async proposal(id) {
      const [r] = await database().select().from(schema.proposals).where(eq(schema.proposals.id, id));
      return (
        r && {
          id: r.id,
          threadId: r.threadId,
          personId: r.personId,
          status: r.status,
          participant: { personId: r.participantId, email: r.participantEmail, name: r.participantName },
          start: r.start.toISOString(),
          end: r.end.toISOString(),
          eventUid: r.eventUid,
          eventRef: r.eventRef,
          eventRevision: r.eventRevision,
          confirmedAt: r.confirmedAt?.toISOString() ?? null,
          undoUntil: r.undoUntil?.toISOString() ?? null,
          reminders: r.reminders,
          remindedAt: r.remindedAt?.toISOString() ?? null,
          executionId: r.executionId,
        }
      );
    },
    async policy(threadId) {
      const [p] = await database()
        .select()
        .from(schema.followupPolicies)
        .where(eq(schema.followupPolicies.threadId, threadId));
      return p && { ...p, expiresAt: p.expiresAt.toISOString() };
    },
    timer: readTimer,
    async jobs(prefix) {
      return (
        await database()
          .select()
          .from(schema.jobs)
          .where(like(schema.jobs.id, prefix + '%'))
          .orderBy(asc(schema.jobs.id))
      ).map(j => ({ id: j.id, kind: j.kind, runAt: j.runAt.toISOString(), payload: j.payload }));
    },
    async audit(subject) {
      return (
        await database()
          .select()
          .from(schema.audit)
          .where(eq(schema.audit.subject, subject))
          .orderBy(asc(schema.audit.id))
      ).map(a => ({ actor: a.actor, action: a.action, details: a.details }));
    },
    told: async () => structuredClone(told),
  };
});

test('a receipt job starts its workflow in the projection’s transaction (D86)', async () => {
  const prefix = 'test-projection-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  const personId = prefix + '-manager';
  await database()
    .insert(schema.people)
    .values({ id: personId, organisationId: 'test', name: 'Synthetic projection test' });
  const card = prefix + '-card';
  await database()
    .insert(schema.threads)
    .values({
      id: card,
      personId,
      kind: 'pushed',
      topic: card,
      title: 'Synthetic card',
      connector: 'reference',
      area: 'reference',
      trigger: { reason: 'Test', source: 'Test', at: projectionAt },
      createdAt: new Date(projectionAt),
      updatedAt: new Date(projectionAt),
    });
  const store = postgresExecutionStore(
    { seal: sealSecret, open: openSecret },
    testDurable,
    projectExecution(testDurable),
  );
  const e = {
    ...executionRecord(personId, prefix + '-e1'),
    createdAt: projectionAt,
    updatedAt: projectionAt,
    presentation: { threadId: card, version: projectionAt, actionId: 'complete' },
  };
  await store.transaction(tx => tx.insert(e));
  await store.transaction(tx =>
    tx.update({
      ...e,
      state: 'succeeded',
      dispatchedAt: projectionAt,
      updatedAt: '2099-11-05T10:01:00.000Z',
      result: {
        headline: 'Klart',
        rows: [{ ref: 'item:1', label: 'Rad', outcome: 'done', detail: 'Läst' }],
        undoCapability: 'reference.undo',
      },
    }),
  );
  expect((await enqueuedWorkflows('job:receipt-final:' + e.id)).map(w => [w.workflow, w.input])).toEqual([
    ['scheduledJob', { id: 'receipt-final:' + e.id, dueAt: '2099-11-05T10:10:00.000Z' }],
  ]);
});
