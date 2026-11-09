import { and, eq, inArray, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import type { ThreadTx, TimerIntent } from '../model';
import { reminderWorkflowId } from '../domain';

const table = schema.timerIntents;
export const timerOf = (r: typeof table.$inferSelect): TimerIntent => ({
  ...r,
  kind: r.kind as TimerIntent['kind'],
  state: r.state as TimerIntent['state'],
  dueAt: r.dueAt.toISOString(),
  requestedAt: r.requestedAt.toISOString(),
  nextAt: r.nextAt.toISOString(),
  leaseUntil: r.leaseUntil?.toISOString() ?? null,
});
const rowOf = (r: TimerIntent) => ({
  ...r,
  dueAt: new Date(r.dueAt),
  requestedAt: new Date(r.requestedAt),
  nextAt: new Date(r.nextAt),
  leaseUntil: r.leaseUntil ? new Date(r.leaseUntil) : null,
});
export async function readTimer(id: string) {
  const [r] = await database().select().from(table).where(eq(table.id, id));
  return r ? timerOf(r) : undefined;
}
/**
 * The timer rows of one transaction. `ended` collects the workflow ids whose durable wait this transaction ends (a
 * cancelled timer, a replaced generation); the store cancels them after the commit, best effort (D86). Without a
 * collector the fence alone covers them: the old workflow fires into the ledger and is refused by generation.
 */
export const timerTx = (
  tx: Transaction,
  ended?: string[],
): Pick<ThreadTx, 'readTimer' | 'scheduleTimer' | 'cancelTimer' | 'updateTimer'> => ({
  async readTimer(id) {
    const [r] = await tx.select().from(table).where(eq(table.id, id)).for('update');
    return r ? timerOf(r) : undefined;
  },
  async scheduleTimer(input) {
    const values = {
      ...input,
      dueAt: new Date(input.dueAt),
      requestedAt: new Date(input.requestedAt),
      state: 'active',
      reason: null,
      generation: 1,
      deliveredGeneration: null,
      deliveredState: null,
      attempt: 0,
      leaseUntil: null,
      nextAt: new Date(input.requestedAt),
    };
    const [r] = await tx
      .insert(table)
      .values(values)
      .onConflictDoUpdate({ target: table.id, set: { ...values, generation: sql`${table.generation} + 1` } })
      .returning();
    const timer = timerOf(r!);
    if (timer.generation > 1) ended?.push(reminderWorkflowId({ id: timer.id, generation: timer.generation - 1 }));
    return timer;
  },
  async cancelTimer(id, at, generation) {
    const rows = await tx
      .update(table)
      .set({ state: 'cancelled', reason: null, nextAt: new Date(at), leaseUntil: null, attempt: 0 })
      .where(
        and(
          eq(table.id, id),
          inArray(table.state, ['active', 'blocked']),
          generation === undefined ? undefined : eq(table.generation, generation),
        ),
      )
      .returning({ id: table.id, generation: table.generation });
    for (const row of rows) ended?.push(reminderWorkflowId(row));
    return rows.length > 0;
  },
  async updateTimer(timer) {
    await tx
      .update(table)
      .set(rowOf(timer))
      .where(and(eq(table.id, timer.id), eq(table.generation, timer.generation)));
  },
});
