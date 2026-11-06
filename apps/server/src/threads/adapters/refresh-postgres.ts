import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { readThread } from '@clew/db/threads';
import { threadTx } from './postgres';
import { projectionVersion, type Occurrence, type RefreshRequest, type RefreshStore } from '../refresh-model';

const jobs = schema.refreshRequests,
  occurrences = schema.workOccurrences;
const requestOf = (r: typeof jobs.$inferSelect): RefreshRequest => ({
  ...r,
  requestedAt: r.requestedAt.toISOString(),
  nextAt: r.nextAt.toISOString(),
  leaseUntil: r.leaseUntil?.toISOString() ?? null,
  lastSuccess: r.lastSuccess?.toISOString() ?? null,
  observedAt: r.observedAt?.toISOString() ?? null,
});
const rowOf = (r: RefreshRequest) => ({
  ...r,
  requestedAt: new Date(r.requestedAt),
  nextAt: new Date(r.nextAt),
  leaseUntil: r.leaseUntil ? new Date(r.leaseUntil) : null,
  lastSuccess: r.lastSuccess ? new Date(r.lastSuccess) : null,
  observedAt: r.observedAt ? new Date(r.observedAt) : null,
});
export function postgresRefreshStore(personId?: string): RefreshStore {
  return {
    async request(r) {
      await database().transaction(async tx => {
        const inserted = await tx.insert(jobs).values(rowOf(r)).onConflictDoNothing().returning();
        const changed = inserted.length
          ? inserted
          : await tx
              .update(jobs)
              .set({ state: 'pending', requestedAt: new Date(r.requestedAt), nextAt: new Date(r.nextAt) })
              .where(
                and(
                  eq(jobs.id, r.id),
                  inArray(jobs.state, ['complete', 'failed', 'blocked']),
                  lte(jobs.nextAt, new Date(r.requestedAt)),
                ),
              )
              .returning();
        if (changed.length)
          await tx.insert(schema.audit).values({
            actor: `person:${r.personId}`,
            action: 'refresh.requested',
            subject: `refresh:${r.id}`,
            createdAt: new Date(r.requestedAt),
            details: { connector: r.connector, assignment: r.assignment },
          });
      });
    },
    claim: (at, until) =>
      database().transaction(async tx => {
        const [r] = await tx
          .select()
          .from(jobs)
          .where(
            and(
              personId ? eq(jobs.personId, personId) : undefined,
              inArray(jobs.state, ['pending', 'complete', 'failed', 'running']),
              lte(jobs.nextAt, new Date(at)),
              or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, new Date(at))),
            ),
          )
          .orderBy(jobs.nextAt)
          .for('update', { skipLocked: true })
          .limit(1);
        if (!r) return undefined;
        const [claimed] = await tx
          .update(jobs)
          .set({ state: 'running', attempt: r.attempt + 1, leaseUntil: new Date(until) })
          .where(eq(jobs.id, r.id))
          .returning();
        return requestOf(claimed!);
      }),
    async baseline(r) {
      const rows = await database()
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(and(eq(schema.threads.personId, r.personId), eq(schema.threads.connector, r.connector)));
      const result: Record<string, string> = {};
      for (const row of rows) {
        const t = await readThread(r.personId, row.id);
        if (t) result[row.id] = projectionVersion(t.thread);
      }
      return result;
    },
    async statuses(personId) {
      return (await database().select().from(jobs).where(eq(jobs.personId, personId))).map(requestOf);
    },
    transaction: fn =>
      database().transaction(tx =>
        fn({
          ...threadTx(tx),
          async lockRequest(id) {
            const [r] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
            return r ? requestOf(r) : undefined;
          },
          async saveRequest(r) {
            await tx.update(jobs).set(rowOf(r)).where(eq(jobs.id, r.id));
          },
          async occurrences(r) {
            return (
              await tx
                .select()
                .from(occurrences)
                .where(
                  and(
                    eq(occurrences.personId, r.personId),
                    eq(occurrences.connector, r.connector),
                    eq(occurrences.assignment, r.assignment),
                  ),
                )
                .orderBy(occurrences.id)
                .for('update')
            ).map(o => ({
              ...o,
              sourceState: o.sourceState as Occurrence['sourceState'],
              disposition: o.disposition as Occurrence['disposition'],
              observedAt: o.observedAt.toISOString(),
            }));
          },
          async saveOccurrence(o) {
            const row = { ...o, observedAt: new Date(o.observedAt) };
            await tx.insert(occurrences).values(row).onConflictDoUpdate({ target: occurrences.id, set: row });
          },
          async findTopic(personId, connector, topic) {
            const [t] = await tx
              .select({ id: schema.threads.id })
              .from(schema.threads)
              .where(
                and(
                  eq(schema.threads.personId, personId),
                  eq(schema.threads.connector, connector),
                  eq(schema.threads.topic, topic),
                ),
              )
              .orderBy(desc(schema.threads.createdAt))
              .limit(1)
              .for('update');
            return t ? (await readThread(personId, t.id, tx))?.thread : undefined;
          },
        }),
      ),
  };
}
