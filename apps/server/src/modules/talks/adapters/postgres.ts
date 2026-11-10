import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '@clew/db';
import type { CommitmentRecord, RoundRecord, Sealer, TalkRecord, TalkStore, TalkTx, WorkItemTx } from '../model';

const { talkRounds: rounds, talks, talkCommitments: commitments, people, audit } = schema;
type RoundRow = typeof rounds.$inferSelect;
type TalkRow = typeof talks.$inferSelect;
type CommitmentRow = typeof commitments.$inferSelect;
const iso = (at: Date | null) => (at === null ? null : at.toISOString());
const date = (at: string | null) => (at === null ? null : new Date(at));
/** The purpose an action point's text is sealed under (D96 item 6): bound to its id, so a sealed text cannot be moved. */
const purpose = (id: string) => 'talk:commitment:' + id;

const roundOf = (r: RoundRow): RoundRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  closedAt: iso(r.closedAt),
});
const talkOf = (r: TalkRow): TalkRecord => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/**
 * The talks tables (D96) on one Postgres transaction. Composition opens the transaction itself, with the thread store's
 * `withThreadTx`, and passes the `WorkItemTx` it builds over the same transaction, so an action point and its owner's
 * card commit or roll back as one. The text of an action point is sealed with `sealer` and opened only where a read
 * returns it; reads that a write follows take a row lock.
 */
export function talkTx(tx: Transaction, options: { sealer: Sealer; workItems: WorkItemTx }): TalkTx {
  const { sealer } = options;
  const commitmentOf = (r: CommitmentRow): CommitmentRecord => ({
    id: r.id,
    roundId: r.roundId,
    employeeId: r.employeeId,
    ownerRole: r.ownerRole,
    ownerId: r.ownerId,
    text: sealer.open(r.textSealed, purpose(r.id)),
    dueOn: r.dueOn,
    doneAt: iso(r.doneAt),
    doneBy: r.doneBy,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    threadId: r.threadId,
  });
  /** Every action point added in `roundId` and every open one from any round; with `roundId` null, the open ones. */
  const shown = (roundId: string | null) =>
    roundId === null ? isNull(commitments.doneAt) : or(isNull(commitments.doneAt), eq(commitments.roundId, roundId));
  return {
    async currentRound(organisationId, kind = 'development') {
      const [r] = await tx
        .select()
        .from(rounds)
        .where(and(eq(rounds.organisationId, organisationId), eq(rounds.kind, kind), isNull(rounds.closedAt)))
        .for('update');
      return r ? roundOf(r) : undefined;
    },
    async insertRound(round) {
      await tx
        .insert(rounds)
        .values({ ...round, createdAt: new Date(round.createdAt), closedAt: date(round.closedAt) });
    },
    async closeRound(id, at) {
      await tx
        .update(rounds)
        .set({ closedAt: new Date(at) })
        .where(eq(rounds.id, id));
    },
    async talks(roundId, employeeIds) {
      if (!employeeIds.length) return [];
      const rows = await tx
        .select()
        .from(talks)
        .where(and(eq(talks.roundId, roundId), inArray(talks.employeeId, [...employeeIds])))
        .orderBy(asc(talks.createdAt), asc(talks.id));
      return rows.map(talkOf);
    },
    async talk(roundId, employeeId) {
      const [r] = await tx
        .select()
        .from(talks)
        .where(and(eq(talks.roundId, roundId), eq(talks.employeeId, employeeId)))
        .for('update');
      return r ? talkOf(r) : undefined;
    },
    async saveTalk(t) {
      await tx
        .insert(talks)
        .values({ ...t, createdAt: new Date(t.createdAt), updatedAt: new Date(t.updatedAt) })
        .onConflictDoUpdate({
          target: [talks.roundId, talks.employeeId],
          set: { heldOn: t.heldOn, heldBy: t.heldBy, updatedAt: new Date(t.updatedAt) },
        });
    },
    async commitmentsAbout(employeeIds, roundId) {
      if (!employeeIds.length) return [];
      const rows = await tx
        .select()
        .from(commitments)
        .where(and(inArray(commitments.employeeId, [...employeeIds]), shown(roundId)))
        .orderBy(asc(commitments.createdAt), asc(commitments.id));
      return rows.map(commitmentOf);
    },
    async commitmentsOwnedBy(ownerId, roundId) {
      const rows = await tx
        .select()
        .from(commitments)
        .where(and(eq(commitments.ownerId, ownerId), shown(roundId)))
        .orderBy(asc(commitments.createdAt), asc(commitments.id));
      return rows.map(commitmentOf);
    },
    async openCounts(employeeIds) {
      if (!employeeIds.length) return new Map();
      // Counted in the database: nothing here is unsealed.
      const rows = await tx
        .select({ employeeId: commitments.employeeId, open: sql<number>`count(*)::int` })
        .from(commitments)
        .where(and(inArray(commitments.employeeId, [...employeeIds]), isNull(commitments.doneAt)))
        .groupBy(commitments.employeeId);
      return new Map(rows.map(r => [r.employeeId, Number(r.open)]));
    },
    async commitment(id) {
      const [r] = await tx.select().from(commitments).where(eq(commitments.id, id)).for('update');
      return r ? commitmentOf(r) : undefined;
    },
    async commitmentByThread(threadId) {
      const [r] = await tx.select().from(commitments).where(eq(commitments.threadId, threadId)).for('update');
      return r ? commitmentOf(r) : undefined;
    },
    async insertCommitment(c) {
      await tx.insert(commitments).values({
        id: c.id,
        roundId: c.roundId,
        employeeId: c.employeeId,
        ownerRole: c.ownerRole,
        ownerId: c.ownerId,
        textSealed: sealer.seal(c.text, purpose(c.id)),
        dueOn: c.dueOn,
        doneAt: date(c.doneAt),
        doneBy: c.doneBy,
        createdBy: c.createdBy,
        createdAt: new Date(c.createdAt),
        threadId: c.threadId,
      });
    },
    async updateCommitment(id, patch) {
      const set: Partial<typeof commitments.$inferInsert> = {};
      if ('doneAt' in patch) set.doneAt = date(patch.doneAt ?? null);
      if ('doneBy' in patch) set.doneBy = patch.doneBy ?? null;
      if (!Object.keys(set).length) return;
      await tx.update(commitments).set(set).where(eq(commitments.id, id));
    },
    async persons(ids) {
      if (!ids.length) return [];
      return tx
        .select({ id: people.id, organisationId: people.organisationId, name: people.name, userName: people.userName })
        .from(people)
        .where(inArray(people.id, [...ids]));
    },
    async erasePerson(personId) {
      const threadIds = new Set<string>(),
        cleared = new Set<string>();
      const removedTalks = await tx.delete(talks).where(eq(talks.employeeId, personId)).returning({ id: talks.id });
      for (const r of await tx
        .update(talks)
        .set({ heldBy: null })
        .where(eq(talks.heldBy, personId))
        .returning({ id: talks.id }))
        cleared.add('talk:' + r.id);
      const removed = await tx
        .delete(commitments)
        .where(eq(commitments.employeeId, personId))
        .returning({ id: commitments.id, threadId: commitments.threadId });
      for (const r of removed) if (r.threadId) threadIds.add(r.threadId);
      // The cards of the ones they owned go too; read before the pointer is nulled.
      const owned = await tx
        .select({ id: commitments.id, threadId: commitments.threadId })
        .from(commitments)
        .where(eq(commitments.ownerId, personId))
        .for('update');
      for (const r of owned) if (r.threadId) threadIds.add(r.threadId);
      for (const r of await tx
        .update(commitments)
        .set({ ownerId: null, threadId: null })
        .where(eq(commitments.ownerId, personId))
        .returning({ id: commitments.id }))
        cleared.add('commitment:' + r.id);
      for (const column of ['createdBy', 'doneBy'] as const)
        for (const r of await tx
          .update(commitments)
          .set({ [column]: null })
          .where(eq(commitments[column], personId))
          .returning({ id: commitments.id }))
          cleared.add('commitment:' + r.id);
      return {
        talks: removedTalks.length,
        commitments: removed.length,
        cleared: cleared.size,
        threadIds: [...threadIds].sort(),
      };
    },
    async exportOrganisation(organisationId) {
      const roundRows = await tx
        .select()
        .from(rounds)
        .where(eq(rounds.organisationId, organisationId))
        .orderBy(asc(rounds.createdAt), asc(rounds.id));
      const ids = roundRows.map(r => r.id);
      if (!ids.length) return { rounds: [], talks: [], commitments: [] };
      const talkRows = await tx
        .select()
        .from(talks)
        .where(inArray(talks.roundId, ids))
        .orderBy(asc(talks.createdAt), asc(talks.id));
      const commitmentRows = await tx
        .select()
        .from(commitments)
        .where(inArray(commitments.roundId, ids))
        .orderBy(asc(commitments.createdAt), asc(commitments.id));
      return {
        rounds: roundRows.map(roundOf),
        talks: talkRows.map(talkOf),
        commitments: commitmentRows.map(commitmentOf),
      };
    },
    async audit(e) {
      await tx.insert(audit).values({
        actor: e.actor,
        action: e.action,
        subject: e.subject,
        createdAt: new Date(e.at),
        details: e.details ?? {},
      });
    },
    workItems: options.workItems,
  };
}
/**
 * The talks store over its own `database().transaction`, for a caller that does not share the transaction with the
 * thread store: `workItems` builds the card port over the same transaction.
 */
export function postgresTalkStore(options: { sealer: Sealer; workItems: (tx: Transaction) => WorkItemTx }): TalkStore {
  return {
    transaction: fn =>
      database().transaction(tx => fn(talkTx(tx, { sealer: options.sealer, workItems: options.workItems(tx) }))),
  };
}
