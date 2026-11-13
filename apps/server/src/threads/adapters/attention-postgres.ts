import { and, eq, inArray, lte } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { scheduleJob } from '@clew/db/jobs';
import type { DurableQueue } from '@clew/db/durable';
import { stockholmDate } from '@clew/contracts';
import { admitAttention } from '../attention-domain';
import type { ThreadTx } from '../model';
const days = schema.attentionDays,
  deliveries = schema.deliveries;
/**
 * A delivery is admitted in the transaction that brings its card (D47). One that quiet hours or the day's budget
 * defers waits for its batch's `attention-release` job, which is scheduled in the same transaction and starts its
 * `scheduledJob` workflow with it (D86); the workflow makes the batch ready at its due time. A batch whose job has
 * already been claimed has been released without this row, so the row is written ready, and is shown from the same
 * due time as the rest of its batch.
 */
export const attentionTx = (tx: Transaction, durable: DurableQueue): Pick<ThreadTx, 'admitDelivery'> => ({
  async admitDelivery(input) {
    if ((await tx.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.id, input.id))).length) return;
    let dueAt = input.at;
    if (input.kind === 'automatic') {
      const id = input.personId + ':' + stockholmDate(input.at);
      await tx
        .insert(days)
        .values({ id, personId: input.personId, used: 0, bucket: '', dueAt: new Date(input.at) })
        .onConflictDoNothing();
      const [d] = await tx.select().from(days).where(eq(days.id, id)).for('update');
      // Another transaction may have admitted this identity while we waited for the day lock.
      if ((await tx.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.id, input.id))).length) return;
      const next = admitAttention(d ? { ...d, dueAt: d.dueAt.toISOString() } : undefined, input.personId, input.at);
      dueAt = next.dueAt;
      await tx
        .update(days)
        .set({ ...next, dueAt: new Date(next.dueAt) })
        .where(eq(days.id, id));
    }
    const batch = input.kind === 'reminder' ? input.id : `automatic:${input.personId}:${dueAt}`;
    let state: 'ready' | 'waiting' = 'ready';
    if (dueAt > input.at) {
      const job = `attention:${batch}`;
      await scheduleJob(
        { id: job, kind: 'attention-release', runAt: new Date(dueAt), payload: { batch } },
        durable,
        tx,
      );
      // Held until this commit: the job cannot be claimed before this row is there for it to release.
      const [row] = await tx
        .select({ status: schema.jobs.status })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job))
        .for('share');
      if (row?.status === 'temporal') state = 'waiting';
    }
    await tx
      .insert(deliveries)
      .values({
        id: input.id,
        personId: input.personId,
        threadId: input.threadId,
        kind: input.kind,
        batch,
        dueAt: new Date(dueAt),
        state,
        createdAt: new Date(input.at),
      })
      .onConflictDoNothing();
  },
});
export function postgresAttention() {
  return {
    async pending(personId: string, at: string) {
      return database()
        .select({ id: deliveries.id, threadId: deliveries.threadId, kind: deliveries.kind })
        .from(deliveries)
        .where(
          and(eq(deliveries.personId, personId), eq(deliveries.state, 'ready'), lte(deliveries.dueAt, new Date(at))),
        );
    },
    async day(personId: string, at: string) {
      const [d] = await database()
        .select()
        .from(days)
        .where(eq(days.id, personId + ':' + stockholmDate(at)));
      return d
        ? { used: d.used, bundledUntil: d.dueAt.toISOString() > at ? d.dueAt.toISOString() : null }
        : { used: 0, bundledUntil: null };
    },
    async claim(personId: string, id: string, visibleIds: string[], at: string) {
      return database().transaction(async tx => {
        const [candidate] = await tx
          .select()
          .from(deliveries)
          .where(and(eq(deliveries.id, id), eq(deliveries.personId, personId)));
        if (!candidate) return false;
        const batch = await tx
          .select()
          .from(deliveries)
          .where(and(eq(deliveries.personId, personId), eq(deliveries.batch, candidate.batch)))
          .orderBy(deliveries.id)
          .for('update');
        const d = batch.find(r => r.id === id);
        if (!d || d.state !== 'ready' || d.dueAt.toISOString() > at || !visibleIds.includes(d.threadId)) return false;
        await tx
          .update(deliveries)
          .set({ state: 'claimed', claimedAt: new Date(at) })
          .where(
            and(
              eq(deliveries.personId, personId),
              eq(deliveries.batch, d.batch),
              inArray(deliveries.threadId, visibleIds),
              eq(deliveries.state, 'ready'),
            ),
          );
        await tx.insert(schema.audit).values({
          actor: `person:${personId}`,
          action: 'attention.claimed',
          subject: `delivery:${id}`,
          createdAt: new Date(at),
          details: { batch: d.batch },
        });
        return true;
      });
    },
    async release(batch: string, at: string) {
      await database().transaction(async tx => {
        const changed = await tx
          .update(deliveries)
          .set({ state: 'ready' })
          .where(and(eq(deliveries.batch, batch), eq(deliveries.state, 'waiting'), lte(deliveries.dueAt, new Date(at))))
          .returning({ id: deliveries.id });
        if (changed.length)
          await tx.insert(schema.audit).values({
            actor: 'system:attention',
            action: 'attention.released',
            subject: `delivery:${batch}`,
            createdAt: new Date(at),
            details: { count: changed.length },
          });
      });
    },
  };
}
