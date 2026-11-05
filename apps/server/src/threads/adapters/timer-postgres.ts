import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import type { ThreadTx, TimerDelivery, TimerIntent } from '../model';

const table = schema.timerIntents;
export const timerOf = (r: typeof table.$inferSelect): TimerIntent => ({ ...r, kind: r.kind as TimerIntent['kind'], state: r.state as TimerIntent['state'], dueAt: r.dueAt.toISOString(), requestedAt: r.requestedAt.toISOString(), nextAt: r.nextAt.toISOString(), leaseUntil: r.leaseUntil?.toISOString() ?? null });
const rowOf = (r: TimerIntent) => ({ ...r, dueAt: new Date(r.dueAt), requestedAt: new Date(r.requestedAt), nextAt: new Date(r.nextAt), leaseUntil: r.leaseUntil ? new Date(r.leaseUntil) : null });
export async function readTimer(id: string) {
  const [r] = await database().select().from(table).where(eq(table.id, id)); return r ? timerOf(r) : undefined;
}
export const timerTx = (tx: Transaction): Pick<ThreadTx, 'readTimer' | 'scheduleTimer' | 'cancelTimer' | 'updateTimer'> => ({
  async readTimer(id) { const [r] = await tx.select().from(table).where(eq(table.id, id)).for('update'); return r ? timerOf(r) : undefined; },
  async scheduleTimer(input) {
    const values = { ...input, dueAt: new Date(input.dueAt), requestedAt: new Date(input.requestedAt), state: 'active', reason: null, generation: 1, deliveredGeneration: null, deliveredState: null, attempt: 0, leaseUntil: null, nextAt: new Date(input.requestedAt) };
    const [r] = await tx.insert(table).values(values).onConflictDoUpdate({ target: table.id, set: { ...values, generation: sql`${table.generation} + 1` } }).returning();
    return timerOf(r!);
  },
  async cancelTimer(id, at, generation) {
    const rows = await tx.update(table).set({ state: 'cancelled', reason: null, nextAt: new Date(at), leaseUntil: null, attempt: 0 })
      .where(and(eq(table.id, id), inArray(table.state, ['active', 'blocked']), generation === undefined ? undefined : eq(table.generation, generation))).returning({ id: table.id });
    return rows.length > 0;
  },
  async updateTimer(timer) { await tx.update(table).set(rowOf(timer)).where(and(eq(table.id, timer.id), eq(table.generation, timer.generation))); },
});
export function postgresTimerDelivery(personId?: string): TimerDelivery {
  return {
    claimTimer: (now, until) => database().transaction(async tx => {
      const [r] = await tx.select().from(table).where(and(personId ? eq(table.personId, personId) : undefined, inArray(table.state, ['active', 'cancelled']),
        or(isNull(table.deliveredGeneration), sql`${table.deliveredGeneration} <> ${table.generation}`, sql`${table.deliveredState} IS DISTINCT FROM ${table.state}`),
        lte(table.nextAt, new Date(now)), or(isNull(table.leaseUntil), lte(table.leaseUntil, new Date(now))))).orderBy(table.nextAt).limit(1).for('update', { skipLocked: true });
      if (!r) return undefined;
      const [claimed] = await tx.update(table).set({ attempt: r.attempt + 1, leaseUntil: new Date(until) }).where(eq(table.id, r.id)).returning();
      return timerOf(claimed!);
    }),
    async finishTimer(t, retryAt, error) {
      await database().update(table).set({ leaseUntil: null, nextAt: new Date(retryAt), reason: error ?? null,
        ...(!error ? { deliveredGeneration: t.generation, deliveredState: t.state } : {}) })
        .where(and(eq(table.id, t.id), eq(table.generation, t.generation), eq(table.state, t.state), eq(table.attempt, t.attempt)));
    },
  };
}
