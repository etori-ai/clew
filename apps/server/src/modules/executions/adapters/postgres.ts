import { and, eq } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import type { Execution, ExecutionStore, Job, WatchCard, WatchIntent } from '../model';

export interface ExecutionSealer {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
const { executions: table, executionJobs: jobs, watchIntents: watches, audit } = schema;
type Row = typeof table.$inferSelect;
type JobRow = typeof jobs.$inferSelect;
const date = (at: string | null) => (at === null ? null : new Date(at));
/** The composition root's hooks into the same physical transaction: the card projection of an execution (D45) and the card a watch leaves (D55 item 5). */
export interface ExecutionProjection {
  project?: (tx: Transaction, execution: Execution, stage: 'approval' | 'update') => Promise<void>;
  pushCard?: (tx: Transaction, card: WatchCard) => Promise<void>;
}
/**
 * The ledger the server runs (D45): executions, jobs and watch intents sealed in Postgres, their workflows enqueued on
 * the same transaction (D86) into the engine's application and queue named by `durable`.
 */
export function postgresExecutionStore(
  sealer: ExecutionSealer,
  durable: DurableQueue,
  hooks: ExecutionProjection | ExecutionProjection['project'] = {},
): ExecutionStore {
  const { project, pushCard } = typeof hooks === 'function' ? { project: hooks } : hooks;
  // A session binding names one of the person's signed-in sessions (D26): sealed like the payload and bound to its row and
  // role, so the database alone never says which session stands behind which write.
  const sessionPurpose = (id: string, role: 'approving' | 'checking') => `execution:session:${role}:${id}`;
  const openSession = (value: string | null, id: string, role: 'approving' | 'checking') =>
    value ? sealer.open(value, sessionPurpose(id, role)) : null;
  const sealSession = (value: string | null, id: string, role: 'approving' | 'checking') =>
    value ? sealer.seal(value, sessionPurpose(id, role)) : null;
  const fromRow = (r: Row): Execution => ({
    ...r,
    ...(r.presentation ? { presentation: r.presentation } : { presentation: undefined }),
    state: r.state as Execution['state'],
    safety: r.safety as Execution['safety'],
    payload: JSON.parse(sealer.open(r.payload, 'execution:input:' + r.id)),
    result: r.result ? JSON.parse(sealer.open(r.result, 'execution:result:' + r.id)) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    dispatchedAt: r.dispatchedAt?.toISOString() ?? null,
    leaseUntil: r.leaseUntil?.toISOString() ?? null,
    approvingSession: openSession(r.approvingSession, r.id, 'approving'),
    checkingSession: openSession(r.checkingSession, r.id, 'checking'),
  });
  const toRow = (e: Execution): typeof table.$inferInsert => ({
    ...e,
    payload: sealer.seal(JSON.stringify(e.payload), 'execution:input:' + e.id),
    result: e.result ? sealer.seal(JSON.stringify(e.result), 'execution:result:' + e.id) : null,
    createdAt: new Date(e.createdAt),
    updatedAt: new Date(e.updatedAt),
    expiresAt: new Date(e.expiresAt),
    dispatchedAt: date(e.dispatchedAt),
    leaseUntil: date(e.leaseUntil),
    approvingSession: sealSession(e.approvingSession, e.id, 'approving'),
    checkingSession: sealSession(e.checkingSession, e.id, 'checking'),
  });
  // A job's steps carry a watch's read input and expectation, approved content like a payload: sealed as one column.
  const fromJob = (r: JobRow): Job => ({
    ...r,
    steps: JSON.parse(sealer.open(r.steps, 'job:steps:' + r.id)),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  });
  const toJob = (j: Job): typeof jobs.$inferInsert => ({
    ...j,
    steps: sealer.seal(JSON.stringify(j.steps), 'job:steps:' + j.id),
    createdAt: new Date(j.createdAt),
    updatedAt: new Date(j.updatedAt),
  });
  return {
    async readDecision(personId, decisionId) {
      const [r] = await database()
        .select()
        .from(table)
        .where(and(eq(table.personId, personId), eq(table.decisionId, decisionId)));
      return r ? fromRow(r) : undefined;
    },
    async read(id) {
      const [r] = await database().select().from(table).where(eq(table.id, id));
      return r ? fromRow(r) : undefined;
    },
    async readJob(id) {
      const [r] = await database().select().from(jobs).where(eq(jobs.id, id));
      return r ? fromJob(r) : undefined;
    },
    transaction: fn =>
      database().transaction(tx =>
        fn({
          async insert(e) {
            const inserted = await tx
              .insert(table)
              .values(toRow(e))
              .onConflictDoNothing({ target: [table.personId, table.decisionId] })
              .returning();
            if (inserted[0]) {
              await project?.(tx, e, 'approval');
              return { inserted: true, execution: fromRow(inserted[0]) };
            }
            const [existing] = await tx
              .select()
              .from(table)
              .where(and(eq(table.personId, e.personId), eq(table.decisionId, e.decisionId)))
              .for('update');
            if (!existing) throw new Error('Execution decision disappeared');
            return { inserted: false, execution: fromRow(existing) };
          },
          async lock(id) {
            const [r] = await tx.select().from(table).where(eq(table.id, id)).for('update');
            return r ? fromRow(r) : undefined;
          },
          async update(e) {
            await tx.update(table).set(toRow(e)).where(eq(table.id, e.id));
            await project?.(tx, e, 'update');
          },
          async keepCheckingSession(id, binding) {
            await tx
              .update(table)
              .set({ checkingSession: sealSession(binding, id, 'checking') })
              .where(eq(table.id, id));
          },
          enqueue: start => enqueueWorkflow(tx, durable, start),
          async audit(e) {
            await tx.insert(audit).values({
              actor: e.actor,
              action: e.action,
              subject: e.subject,
              createdAt: new Date(e.at),
              details: e.details ?? {},
            });
          },
          async insertJob(j) {
            const inserted = await tx
              .insert(jobs)
              .values(toJob(j))
              .onConflictDoNothing({ target: [jobs.personId, jobs.decisionId] })
              .returning();
            if (inserted[0]) return { inserted: true, job: fromJob(inserted[0]) };
            const [existing] = await tx
              .select()
              .from(jobs)
              .where(and(eq(jobs.personId, j.personId), eq(jobs.decisionId, j.decisionId)))
              .for('update');
            if (!existing) throw new Error('Job decision disappeared');
            return { inserted: false, job: fromJob(existing) };
          },
          async lockJob(id) {
            const [r] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
            return r ? fromJob(r) : undefined;
          },
          async updateJob(j) {
            await tx.update(jobs).set(toJob(j)).where(eq(jobs.id, j.id));
          },
          async enqueueWatch(w) {
            await tx
              .insert(watches)
              .values({
                ...w,
                expiresAt: new Date(w.expiresAt),
                nextAt: new Date(w.nextAt),
                leaseUntil: date(w.leaseUntil),
                deliveredAt: date(w.deliveredAt),
              })
              .onConflictDoNothing();
          },
          async pushCard(card) {
            // The stream is another module: the composition root supplies how a card is stored and admitted. Without it a settled watch must not pass silently.
            if (!pushCard) throw new Error('No card sink for an expired watch');
            await pushCard(tx, card);
          },
        }),
      ),
  };
}
