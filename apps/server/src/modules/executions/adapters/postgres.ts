import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import type { Execution, DispatchIntent, ExecutionStore } from '../model';

export interface ExecutionSealer { seal(value: string, purpose: string): string; open(value: string, purpose: string): string }
const { executions: table, dispatchOutbox: outbox, audit } = schema;
type Row = typeof table.$inferSelect;
const date = (at: string | null) => at === null ? null : new Date(at);
const intent = (row: typeof outbox.$inferSelect): DispatchIntent => ({ ...row, nextAt: row.nextAt.toISOString(), leaseUntil: row.leaseUntil?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null });
export function postgresExecutionStore(sealer: ExecutionSealer, project?: (tx: Transaction, execution: Execution, stage: 'approval' | 'update') => Promise<void>): ExecutionStore {
  const fromRow = (r: Row): Execution => ({ ...r, ...(r.presentation ? { presentation: r.presentation } : { presentation: undefined }), state: r.state as Execution['state'], safety: r.safety as Execution['safety'],
    payload: JSON.parse(sealer.open(r.payload, 'execution:input:' + r.id)), result: r.result ? JSON.parse(sealer.open(r.result, 'execution:result:' + r.id)) : null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), expiresAt: r.expiresAt.toISOString(), dispatchedAt: r.dispatchedAt?.toISOString() ?? null, leaseUntil: r.leaseUntil?.toISOString() ?? null });
  const toRow = (e: Execution): typeof table.$inferInsert => ({ ...e, payload: sealer.seal(JSON.stringify(e.payload), 'execution:input:' + e.id), result: e.result ? sealer.seal(JSON.stringify(e.result), 'execution:result:' + e.id) : null,
    createdAt: new Date(e.createdAt), updatedAt: new Date(e.updatedAt), expiresAt: new Date(e.expiresAt), dispatchedAt: date(e.dispatchedAt), leaseUntil: date(e.leaseUntil) });
  return {
    async read(id) { const [r] = await database().select().from(table).where(eq(table.id, id)); return r ? fromRow(r) : undefined; },
    transaction: fn => database().transaction(tx => fn({
      async insert(e) {
        const inserted = await tx.insert(table).values(toRow(e)).onConflictDoNothing({ target: [table.personId, table.decisionId] }).returning();
        if (inserted[0]) { await project?.(tx, e, 'approval'); return { inserted: true, execution: fromRow(inserted[0]) }; }
        const [existing] = await tx.select().from(table).where(and(eq(table.personId, e.personId), eq(table.decisionId, e.decisionId))).for('update');
        if (!existing) throw new Error('Execution decision disappeared');
        return { inserted: false, execution: fromRow(existing) };
      },
      async lock(id) { const [r] = await tx.select().from(table).where(eq(table.id, id)).for('update'); return r ? fromRow(r) : undefined; },
      async update(e) { await tx.update(table).set(toRow(e)).where(eq(table.id, e.id)); await project?.(tx, e, 'update'); },
      async enqueue(i) { await tx.insert(outbox).values({ ...i, nextAt: new Date(i.nextAt), leaseUntil: date(i.leaseUntil), deliveredAt: date(i.deliveredAt) }).onConflictDoNothing(); },
      async audit(e) { await tx.insert(audit).values({ actor: e.actor, action: e.action, subject: e.subject, createdAt: new Date(e.at), details: e.details ?? {} }); },
    })),
    claimDispatch: (now, until) => database().transaction(async tx => {
      const [row] = await tx.select().from(outbox).where(and(isNull(outbox.deliveredAt), lte(outbox.nextAt, new Date(now)), or(isNull(outbox.leaseUntil), lte(outbox.leaseUntil, new Date(now))))).orderBy(outbox.nextAt).for('update', { skipLocked: true }).limit(1);
      if (!row) return undefined;
      const [claimed] = await tx.update(outbox).set({ attempt: row.attempt + 1, leaseUntil: new Date(until) }).where(eq(outbox.id, row.id)).returning();
      return intent(claimed!);
    }),
    async finishDispatch(id, attempt, now, retryAt, error) {
      await database().update(outbox).set({ deliveredAt: error ? null : new Date(now), nextAt: new Date(retryAt), leaseUntil: null, lastError: error ?? null }).where(and(eq(outbox.id, id), eq(outbox.attempt, attempt)));
    },
  };
}
