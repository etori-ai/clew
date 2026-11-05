import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { toThread } from '@clew/db/threads';
import { scheduleJob } from '@clew/db/jobs';
import type { ThreadPatch, ThreadStore, ThreadTx } from '../model';

/** The store the server runs (D25): the `ThreadStore` port over Drizzle and Postgres. Held to the memory adapter's behaviour by `tests/store-contract.ts`. */
const { threads, threadMessages, proposals, audit } = schema;
const date = (value: string | null | undefined) => value === undefined ? undefined : value === null ? null : new Date(value);
const toRow = (patch: ThreadPatch) => {
  const { handledAt, updatedAt, remindedAt, snoozedUntil, ...rest } = patch;
  return { ...rest, ...(handledAt !== undefined ? { handledAt: date(handledAt) } : {}), ...(updatedAt !== undefined ? { updatedAt: date(updatedAt)! } : {}),
    ...(remindedAt !== undefined ? { remindedAt: date(remindedAt) } : {}), ...(snoozedUntil !== undefined ? { snoozedUntil: date(snoozedUntil) } : {}) };
};
async function read(db: Transaction | ReturnType<typeof database>, where: ReturnType<typeof and>) {
  const [row] = await db.select().from(threads).where(where);
  if (!row) return undefined;
  const [messages, proposalRows] = await Promise.all([
    db.select().from(threadMessages).where(eq(threadMessages.threadId, row.id)).orderBy(threadMessages.createdAt),
    db.select().from(proposals).where(eq(proposals.threadId, row.id)).orderBy(proposals.start),
  ]);
  return toThread(row, messages, proposalRows);
}
const txOf = (tx: Transaction): ThreadTx => ({
  async lockThread(personId, id) {
    const [row] = await tx.select().from(threads).where(and(eq(threads.id, id), eq(threads.personId, personId))).for('update');
    if (!row) return undefined;
    const [messages, proposalRows] = await Promise.all([
      tx.select().from(threadMessages).where(eq(threadMessages.threadId, id)).orderBy(threadMessages.createdAt),
      tx.select().from(proposals).where(eq(proposals.threadId, id)).orderBy(proposals.start),
    ]);
    return toThread(row, messages, proposalRows);
  },
  async insertThread(thread) {
    const { personId, ...t } = thread;
    const inserted = await tx.insert(threads).values({ id: t.id, personId, kind: t.kind, topic: t.topic, title: t.title, state: t.state, week: t.week, connector: t.connector, area: t.area,
      summary: t.summary, items: t.items, actions: t.actions, waitingOn: t.waitingOn, deadline: t.deadline, trigger: t.trigger, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) })
      .onConflictDoNothing().returning({ id: threads.id });
    return inserted.length > 0;
  },
  async updateThread(id, patch) { await tx.update(threads).set(toRow(patch)).where(eq(threads.id, id)); },
  async addMessage(threadId, message) {
    await tx.insert(threadMessages).values({ id: crypto.randomUUID(), threadId, role: message.role, body: message.body, meta: message.meta ?? null, createdAt: new Date(message.at) });
    await tx.update(threads).set({ updatedAt: new Date(message.at) }).where(eq(threads.id, threadId));
  },
  async writeAudit(entry) { await tx.insert(audit).values({ actor: entry.actor, action: entry.action, subject: entry.subject, details: entry.details ?? {}, createdAt: new Date(entry.at) }); },
  async scheduleJob(job) { await scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }, tx); },
});
export function postgresThreadStore(): ThreadStore {
  return {
    async listThreads(personId, now) {
      const since = new Date(Date.parse(now) - 7 * 86400_000);
      const rows = await database().select().from(threads).where(and(eq(threads.personId, personId), or(eq(threads.state, 'open'), gte(threads.updatedAt, since)))).orderBy(desc(threads.createdAt)).limit(50);
      if (!rows.length) return [];
      const ids = rows.map(r => r.id);
      const [messages, proposalRows] = await Promise.all([
        database().select().from(threadMessages).where(inArray(threadMessages.threadId, ids)).orderBy(threadMessages.createdAt),
        database().select().from(proposals).where(inArray(proposals.threadId, ids)).orderBy(proposals.start),
      ]);
      return rows.map(row => toThread(row, messages.filter(m => m.threadId === row.id), proposalRows.filter(p => p.threadId === row.id)));
    },
    readThread: (personId, id) => read(database(), and(eq(threads.id, id), eq(threads.personId, personId))),
    readThreadById: id => read(database(), eq(threads.id, id)),
    async openThread(personId, topic) { return read(database(), and(eq(threads.personId, personId), eq(threads.topic, topic), eq(threads.state, 'open'))); },
    transaction: fn => database().transaction(tx => fn(txOf(tx))),
  };
}
