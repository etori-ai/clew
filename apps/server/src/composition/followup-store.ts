import { and, eq } from 'drizzle-orm';
import { schema, type Transaction } from '@clew/db';
import { readThread } from '@clew/db/threads';
import type { ThreadTx } from '../threads/model';
import { reminderStart } from '../threads/domain';
import { withThreadTx, type ThreadStoreOptions } from '../threads/adapters/postgres';
import type { FollowupSnapshot, FollowupStore, FollowupTx } from '../modules/calendar/usecases/followups';
import { reminderCard, returnedCard } from '../modules/calendar/usecases/obligation';

/**
 * Cross-module local delivery uses the same physical transaction as its ordinal and policy. The obligation timer's
 * workflow starts with the timer row (D86) and a stopped timer's wait is cancelled after the commit, through the
 * thread store's own transaction wrapper.
 */
const adapter = (tx: Transaction, timers: ThreadTx): FollowupTx => ({
  async load(threadId) {
    const [thread] = await tx.select().from(schema.threads).where(eq(schema.threads.id, threadId)).for('update');
    if (!thread) return undefined;
    const [p] = await tx
      .select()
      .from(schema.followupPolicies)
      .where(eq(schema.followupPolicies.threadId, threadId))
      .for('update');
    const timer = await timers.readTimer(`obligation:${threadId}`);
    const current = (await readThread(thread.personId, threadId, tx))!;
    return {
      thread: current.thread,
      ...(p ? { policy: { ...p, expiresAt: p.expiresAt.toISOString() } } : {}),
      timer,
      proposals: current.proposalRows.map(r => ({
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
        eventIcalUid: r.eventIcalUid,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        undoUntil: r.undoUntil?.toISOString() ?? null,
        reminders: r.reminders,
        remindedAt: r.remindedAt?.toISOString() ?? null,
      })),
    } satisfies FollowupSnapshot;
  },
  async save(p) {
    const row = { ...p, expiresAt: new Date(p.expiresAt) };
    await tx
      .insert(schema.followupPolicies)
      .values(row)
      .onConflictDoUpdate({ target: schema.followupPolicies.threadId, set: row });
  },
  async schedule(p, dueAt, at) {
    const timer = await timers.scheduleTimer({
      id: `obligation:${p.threadId}`,
      threadId: p.threadId,
      personId: p.personId,
      unitId: p.unitId,
      authorizationVersion: p.authorizationVersion,
      kind: 'obligation',
      requestedAt: at,
      dueAt,
    });
    await timers.enqueue(reminderStart(timer));
  },
  async stop(threadId, at) {
    await timers.cancelTimer(`obligation:${threadId}`, at);
  },
  async deliver(personId, p, ordinal, sender, at) {
    const card = reminderCard(p.id, ordinal, sender, at);
    const inserted = await tx
      .insert(schema.threads)
      .values({
        id: card.id,
        personId,
        kind: 'pushed',
        topic: card.id,
        title: card.title,
        state: 'open',
        connector: 'calendar',
        area: 'calendar',
        summary: card.summary,
        trigger: card.trigger,
        createdAt: new Date(at),
        updatedAt: new Date(at),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await timers.admitDelivery({ id: `delivery:${card.id}`, personId, threadId: card.id, kind: 'automatic', at });
      await tx.insert(schema.threadMessages).values({
        id: `message:${card.id}`,
        threadId: card.id,
        role: 'assistant',
        body: card.summary,
        createdAt: new Date(at),
      });
      await tx.insert(schema.audit).values({
        actor: 'assistant:obligation',
        action: 'thread.pushed',
        subject: `thread:${card.id}`,
        createdAt: new Date(at),
        details: { proposal: p.id, ordinal, owner: personId },
      });
    }
  },
  async recordReminder(p, at) {
    await tx
      .update(schema.proposals)
      .set({ reminders: p.reminders + 1, remindedAt: new Date(at) })
      .where(and(eq(schema.proposals.id, p.id), eq(schema.proposals.reminders, p.reminders)));
  },
  async returnThread(threadId, at, reason) {
    const { handledAt, updatedAt, ...card } = returnedCard(reason, at);
    await tx
      .update(schema.threads)
      .set({ ...card, handledAt: handledAt === null ? null : new Date(handledAt), updatedAt: new Date(updatedAt) })
      .where(eq(schema.threads.id, threadId));
  },
  async audit(e) {
    await tx.insert(schema.audit).values({
      actor: e.actor,
      action: e.action,
      subject: e.subject,
      createdAt: new Date(e.at),
      details: e.details ?? {},
    });
  },
});
export function postgresFollowupStore(options: ThreadStoreOptions): FollowupStore {
  return {
    read: id => withThreadTx(options, (tx, timers) => adapter(tx, timers).load(id)),
    transaction: fn => withThreadTx(options, (tx, timers) => fn(adapter(tx, timers))),
  };
}
