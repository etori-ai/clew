import { and, desc, eq, inArray } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import { readThread, type ProposalRow } from '@clew/db/threads';
import { scheduleJob } from '@clew/db/jobs';
import type { DurableQueue } from '@clew/db/durable';
import type { InvitationsTx, ProposalPatch, ProposalRecord, ProposalStore, ProposalThread, ProposalTx } from '../model';

/** The proposal store the server runs (D25): the `ProposalStore` port over Drizzle and Postgres. */
const { threads, threadMessages, proposals, audit } = schema;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);
const toRecord = (r: ProposalRow): ProposalRecord => ({
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
  confirmedAt: iso(r.confirmedAt),
  undoUntil: iso(r.undoUntil),
  reminders: r.reminders,
  remindedAt: iso(r.remindedAt),
});
const toProposalRow = (patch: ProposalPatch) => {
  const { confirmedAt, undoUntil, remindedAt, start, end, ...rest } = patch;
  return {
    ...rest,
    ...(confirmedAt !== undefined ? { confirmedAt: date(confirmedAt) } : {}),
    ...(undoUntil !== undefined ? { undoUntil: date(undoUntil) } : {}),
    ...(remindedAt !== undefined ? { remindedAt: date(remindedAt) } : {}),
    ...(start !== undefined ? { start: date(start)! } : {}),
    ...(end !== undefined ? { end: date(end)! } : {}),
  };
};
/**
 * The store holds the calendar's threads only (DE-L6): every card of every connector is a row of the same table, and a
 * replan handed another connector's card would rewrite it as a proposal thread. Every read and every write names the
 * calendar, so a write addressed to another connector's card changes nothing (an update) or is refused (a message or a
 * proposal, which would otherwise be added to it). Proposals are this store's alone, so a write by proposal id reaches
 * only a calendar card's. The calendar's own cards that are not planning cards (a follow-up, an obligation, a calendar
 * decision's) are the store's too, since a calendar decision is read through it, so the replan itself takes only the
 * planning card.
 */
const CALENDAR = eq(threads.connector, 'calendar');
async function read(personId: string | undefined, id: string): Promise<ProposalThread | undefined> {
  const owner =
    personId ??
    (await database().select({ personId: threads.personId }).from(threads).where(eq(threads.id, id)))[0]?.personId;
  if (!owner) return undefined;
  const found = await readThread(owner, id);
  return found && found.thread.connector === 'calendar'
    ? { thread: found.thread, proposals: found.proposalRows.map(toRecord) }
    : undefined;
}
/** Told of invitations when the store is built without the port (a test of the store alone): nobody. */
const nobody: InvitationsTx = {
  established: async () => {},
  observed: async () => {},
  moved: async () => {},
  ended: async () => {},
};
const txOf = (tx: Transaction, durable: DurableQueue, invitations: InvitationsTx): ProposalTx => ({
  async lockThread(personId, id) {
    const [r] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, id), eq(threads.personId, personId), CALENDAR))
      .for('update');
    if (!r) return undefined;
    const found = (await readThread(personId, id, tx))!;
    return { thread: found.thread, proposals: found.proposalRows.map(toRecord) };
  },
  async insertThread(t) {
    const inserted = await tx
      .insert(threads)
      .values({
        id: t.id,
        personId: t.personId,
        kind: 'pushed',
        topic: t.topic,
        title: t.title,
        state: 'open',
        week: t.week,
        connector: 'calendar',
        area: t.area,
        summary: t.summary,
        trigger: t.trigger,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      })
      .onConflictDoNothing()
      .returning({ id: threads.id });
    return inserted.length > 0;
  },
  async updateThread(id, patch) {
    const { handledAt, updatedAt, ...rest } = patch;
    await tx
      .update(threads)
      .set({
        ...rest,
        ...(handledAt !== undefined ? { handledAt: date(handledAt) } : {}),
        ...(updatedAt !== undefined ? { updatedAt: date(updatedAt)! } : {}),
      })
      .where(and(eq(threads.id, id), CALENDAR));
  },
  async addMessage(threadId, message) {
    const touched = await tx
      .update(threads)
      .set({ updatedAt: new Date(message.at) })
      .where(and(eq(threads.id, threadId), CALENDAR))
      .returning({ id: threads.id });
    if (!touched.length) throw new Error(`Thread ${threadId} is not a calendar thread.`);
    await tx.insert(threadMessages).values({
      id: crypto.randomUUID(),
      threadId,
      role: message.role,
      body: message.body,
      createdAt: new Date(message.at),
    });
  },
  async insertProposals(rows) {
    if (!rows.length) return;
    const ids = [...new Set(rows.map(p => p.threadId))];
    const own = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(and(inArray(threads.id, ids), CALENDAR));
    if (own.length < ids.length) throw new Error('A proposal names a thread that is not a calendar thread.');
    await tx.insert(proposals).values(
      rows.map(p => ({
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
        confirmedAt: date(p.confirmedAt),
        undoUntil: date(p.undoUntil),
        reminders: p.reminders,
        remindedAt: date(p.remindedAt),
      })),
    );
  },
  async updateProposals(ids, patch) {
    if (ids.length) await tx.update(proposals).set(toProposalRow(patch)).where(inArray(proposals.id, ids));
  },
  async transition(threadId, from, patch) {
    const rows = await tx
      .update(proposals)
      .set(toProposalRow(patch))
      .where(
        and(
          eq(proposals.threadId, threadId),
          eq(proposals.status, from),
          inArray(proposals.threadId, tx.select({ id: threads.id }).from(threads).where(CALENDAR)),
        ),
      )
      .returning({ id: proposals.id });
    return rows.map(r => r.id);
  },
  async writeAudit(entry) {
    await tx.insert(audit).values({
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      details: entry.details ?? {},
      createdAt: new Date(entry.at),
    });
  },
  async scheduleJob(job) {
    await scheduleJob({ id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload }, durable, tx);
  },
  invitations,
});
/**
 * The proposal store in Postgres; `durable` names the engine's application and queue for the jobs it schedules (D86).
 * `invitations` builds, on the store's own transaction, the port the talks domain is told of invitations through
 * (D132 item 3): composition passes the talks module's, so the talk follows the invitation in one commit.
 */
export function postgresProposalStore(
  durable: DurableQueue,
  options: { invitations?: (tx: Transaction) => InvitationsTx } = {},
): ProposalStore {
  return {
    readThread: (personId, id) => read(personId, id),
    readThreadById: id => read(undefined, id),
    async latestThread(personId, topic) {
      const [r] = await database()
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.personId, personId), eq(threads.topic, topic), CALENDAR))
        .orderBy(desc(threads.createdAt))
        .limit(1);
      return r ? read(personId, r.id) : undefined;
    },
    async openThread(personId, topic) {
      const [row] = await database()
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.personId, personId), eq(threads.topic, topic), eq(threads.state, 'open'), CALENDAR));
      return row ? read(personId, row.id) : undefined;
    },
    async activeProposals(personId) {
      return (
        await database()
          .select()
          .from(proposals)
          .where(
            and(
              eq(proposals.personId, personId),
              inArray(proposals.status, ['proposed', 'confirmed', 'final', 'accepted']),
            ),
          )
      ).map(toRecord);
    },
    async bookedProposals(participantIds) {
      if (!participantIds.length) return [];
      return (
        await database()
          .select()
          .from(proposals)
          .where(
            and(
              inArray(proposals.participantId, [...participantIds]),
              inArray(proposals.status, ['confirmed', 'final', 'accepted']),
            ),
          )
      ).map(toRecord);
    },
    transaction: fn => database().transaction(tx => fn(txOf(tx, durable, options.invitations?.(tx) ?? nobody))),
  };
}
