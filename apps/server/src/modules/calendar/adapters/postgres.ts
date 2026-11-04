import { and, eq, inArray } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { readThread, type ProposalRow } from '@clew/db/threads';
import { scheduleJob } from '@clew/db/jobs';
import type { ProposalPatch, ProposalRecord, ProposalStore, ProposalThread, ProposalTx } from '../model';

/** The proposal store the server runs (D25): the `ProposalStore` port over Drizzle and Postgres. */
const { threads, threadMessages, proposals, audit } = schema;
const iso = (d: Date | null) => d ? d.toISOString() : null;
const date = (value: string | null | undefined) => value === undefined ? undefined : value === null ? null : new Date(value);
const toRecord = (r: ProposalRow): ProposalRecord => ({ id: r.id, threadId: r.threadId, personId: r.personId, status: r.status, participant: { email: r.participantEmail, name: r.participantName },
  start: r.start.toISOString(), end: r.end.toISOString(), eventUid: r.eventUid, eventRef: r.eventRef, eventRevision: r.eventRevision, confirmedAt: iso(r.confirmedAt), undoUntil: iso(r.undoUntil), reminders: r.reminders, remindedAt: iso(r.remindedAt) });
const toProposalRow = (patch: ProposalPatch) => {
  const { confirmedAt, undoUntil, remindedAt, start, end, ...rest } = patch;
  return { ...rest, ...(confirmedAt !== undefined ? { confirmedAt: date(confirmedAt) } : {}), ...(undoUntil !== undefined ? { undoUntil: date(undoUntil) } : {}),
    ...(remindedAt !== undefined ? { remindedAt: date(remindedAt) } : {}), ...(start !== undefined ? { start: date(start)! } : {}), ...(end !== undefined ? { end: date(end)! } : {}) };
};
async function read(personId: string | undefined, id: string): Promise<ProposalThread | undefined> {
  const owner = personId ?? (await database().select({ personId: threads.personId }).from(threads).where(eq(threads.id, id)))[0]?.personId;
  if (!owner) return undefined;
  const found = await readThread(owner, id);
  return found ? { thread: found.thread, proposals: found.proposalRows.map(toRecord) } : undefined;
}
const txOf = (tx: Transaction): ProposalTx => ({
  async insertThread(t) {
    const inserted = await tx.insert(threads).values({ id: t.id, personId: t.personId, kind: 'pushed', topic: t.topic, title: t.title, state: 'open', week: t.week, connector: 'calendar', area: t.area,
      summary: t.summary, trigger: t.trigger, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) }).onConflictDoNothing().returning({ id: threads.id });
    return inserted.length > 0;
  },
  async updateThread(id, patch) {
    const { handledAt, updatedAt, ...rest } = patch;
    await tx.update(threads).set({ ...rest, ...(handledAt !== undefined ? { handledAt: date(handledAt) } : {}), ...(updatedAt !== undefined ? { updatedAt: date(updatedAt)! } : {}) }).where(eq(threads.id, id));
  },
  async addMessage(threadId, message) {
    await tx.insert(threadMessages).values({ id: crypto.randomUUID(), threadId, role: message.role, body: message.body, createdAt: new Date(message.at) });
    await tx.update(threads).set({ updatedAt: new Date(message.at) }).where(eq(threads.id, threadId));
  },
  async insertProposals(rows) {
    if (!rows.length) return;
    await tx.insert(proposals).values(rows.map(p => ({ id: p.id, threadId: p.threadId, personId: p.personId, status: p.status, participantEmail: p.participant.email, participantName: p.participant.name,
      start: new Date(p.start), end: new Date(p.end), eventUid: p.eventUid, eventRef: p.eventRef, eventRevision: p.eventRevision, confirmedAt: date(p.confirmedAt), undoUntil: date(p.undoUntil), reminders: p.reminders, remindedAt: date(p.remindedAt) })));
  },
  async updateProposals(ids, patch) { if (ids.length) await tx.update(proposals).set(toProposalRow(patch)).where(inArray(proposals.id, ids)); },
  async transition(threadId, from, patch) {
    const rows = await tx.update(proposals).set(toProposalRow(patch)).where(and(eq(proposals.threadId, threadId), eq(proposals.status, from))).returning({ id: proposals.id });
    return rows.map(r => r.id);
  },
  async writeAudit(entry) { await tx.insert(audit).values({ actor: entry.actor, action: entry.action, subject: entry.subject, details: entry.details ?? {}, createdAt: new Date(entry.at) }); },
  async scheduleJob(job) { await scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }, tx); },
});
export function postgresProposalStore(): ProposalStore {
  return {
    readThread: (personId, id) => read(personId, id),
    readThreadById: id => read(undefined, id),
    async openThread(personId, topic) {
      const [row] = await database().select({ id: threads.id }).from(threads).where(and(eq(threads.personId, personId), eq(threads.topic, topic), eq(threads.state, 'open')));
      return row ? read(personId, row.id) : undefined;
    },
    async activeProposals(personId) {
      return (await database().select().from(proposals).where(and(eq(proposals.personId, personId), inArray(proposals.status, ['proposed', 'confirmed', 'final', 'accepted'])))).map(toRecord);
    },
    transaction: fn => database().transaction(tx => fn(txOf(tx))),
  };
}
