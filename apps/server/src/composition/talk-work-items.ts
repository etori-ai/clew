import { and, eq, inArray } from 'drizzle-orm';
import { dayRhythm, shiftDate, stockholmInstant, type ThreadAction } from '@clew/contracts';
import { TALKS_CONNECTOR } from '@clew/connectors';
import { schema, type Transaction } from '@clew/db';
import type { ThreadTx } from '../threads/model';
import { reminderStart } from '../threads/domain';
import { authorizationVersion } from '../auth-crypto';
import type { WorkItemTx } from '../modules/talks/model';
import { removeCards } from './card-removal';

/**
 * The owner's card of an action point (D96 items 5 and 6): the talks module's `WorkItemTx`, implemented over the thread
 * store's transaction the way `followup-store.ts` implements `FollowupTx`. The card, its delivery, message, audit row and
 * `due` timer (with its workflow start, D86) commit or roll back with the action point they belong to, because the
 * talks transaction and this one share one physical database transaction. Usage in composition:
 *
 *   transaction: fn =>
 *     withThreadTx(options, (tx, thread) =>
 *       fn(talkTx(tx, { workItems: talkWorkItems(tx, thread, { clock }) })),
 *     ),
 *
 * where `talkTx` is the talks module's Postgres `TalkTx` over the same `tx`. A fired `due` timer reaches `fire` through
 * the same wrapper: `withThreadTx(options, (tx, thread) => talkWorkItems(tx, thread, { clock }).fire(id, generation, at))`,
 * or through the talks use case that checks the action point is still open first.
 *
 * The card carries no action-point text and no other person's name in its title, summary, trigger or messages, since
 * those are what the assistant reads; the audit rows carry ids only. The employee of the talk is the card's own
 * `subjects` (D97 item 6), a key that is never drawn on the card and never read by the assistant, so the card shows under
 * "Behöver dig" on that person for its owner. The card is `core` (the `talks` connector) and has
 * no `sourceAuthorization`, so it stays with its owner when they change unit; the timer records the owner's unit and
 * authorisation version as every timer does, but nothing blocks a `due` timer on them (D96).
 */
export interface TalkWorkItemOptions {
  /** Composition's clock: the instant written where the port gives none (erasure). */
  clock: () => Date;
}
const ACTOR = 'talks:commitment';
const TITLE = 'Åtgärdspunkt från utvecklingssamtal';
const SOURCE = 'Utvecklingssamtal';
const ACTION: ThreadAction = {
  id: 'commitments',
  label: 'Visa åtgärdspunkter',
  capability: TALKS_CONNECTOR + '.commitments',
  kind: 'read',
  role: 'primary',
  target: 'panel',
};
export const dueTimerId = (threadId: string) => `due:${threadId}`;
/** "12 mars" for a `YYYY-MM-DD` calendar day: the day is Swedish already, so it is formatted at noon UTC. */
export const swedishDay = (date: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(
    new Date(date + 'T12:00:00Z'),
  );
/** The morning after the due date, at the day's review (06:00 Europe/Stockholm, daylight saving included); never before `at`. */
export function dueAtFor(dueOn: string, at: string) {
  const morning = stockholmInstant(shiftDate(dueOn, 1), dayRhythm.review);
  return Date.parse(morning) > Date.parse(at) ? morning : at;
}
const summaryFor = (dueOn: string) => `En åtgärdspunkt ska vara klar senast ${swedishDay(dueOn)}.`;

export function talkWorkItems(tx: Transaction, thread: ThreadTx, options: TalkWorkItemOptions): WorkItemTx {
  /** The owner's unit and authorisation version as of this transaction; empty when they have no grant (nothing reads it to block a `due` timer). */
  async function authority(personId: string) {
    const [access] = await tx
      .select({ person: schema.people, grant: schema.accessGrants })
      .from(schema.people)
      .innerJoin(schema.accessGrants, eq(schema.accessGrants.personId, schema.people.id))
      .where(eq(schema.people.id, personId));
    return access
      ? { unitId: access.grant.unitId, authorizationVersion: authorizationVersion(access) }
      : { unitId: '', authorizationVersion: '' };
  }
  /** The caller holds the thread lock (or has just inserted the thread). A replaced generation's wait is cancelled after commit. */
  async function schedule(threadId: string, personId: string, dueOn: string, at: string) {
    const timer = await thread.scheduleTimer({
      id: dueTimerId(threadId),
      personId,
      threadId,
      kind: 'due',
      ...(await authority(personId)),
      dueAt: dueAtFor(dueOn, at),
      requestedAt: at,
    });
    await thread.enqueue(reminderStart(timer));
    return timer;
  }
  /** The card's row, locked for the rest of the transaction; undefined when it no longer exists. */
  async function lock(threadId: string) {
    const [row] = await tx.select().from(schema.threads).where(eq(schema.threads.id, threadId)).for('update');
    return row;
  }
  /** The person's own snooze and reminder end with the card's state: they would otherwise reopen it as "Du bad …". */
  async function endOwnTimers(threadId: string, at: string) {
    await thread.cancelTimer(`snooze:${threadId}`, at);
    await thread.cancelTimer(`reminder:${threadId}`, at);
  }
  return {
    async open({ threadId, personId, commitmentId, dueOn, at, subject }) {
      const summary = summaryFor(dueOn);
      const inserted = await thread.insertThread({
        id: threadId,
        personId,
        kind: 'pushed',
        topic: `${TALKS_CONNECTOR}:commitment:${commitmentId}`,
        title: TITLE,
        state: 'open',
        week: null,
        connector: TALKS_CONNECTOR,
        area: TALKS_CONNECTOR,
        summary,
        items: [],
        // The employee of the talk, by Clew's key (D122), on the thread and never on a row (D96 item 6, D97 item 6).
        subjects: [subject],
        actions: [ACTION],
        waitingOn: null,
        deadline: dueOn,
        trigger: { reason: 'Lades till efter ditt utvecklingssamtal', source: SOURCE, at },
        createdAt: at,
        updatedAt: at,
      });
      if (!inserted) throw new Error(`The action point card ${threadId} already exists.`);
      await thread.admitDelivery({ id: `delivery:${threadId}`, personId, threadId, kind: 'automatic', at });
      await thread.addMessage(threadId, { role: 'assistant', body: summary, at });
      const timer = await schedule(threadId, personId, dueOn, at);
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.pushed',
        subject: `thread:${threadId}`,
        at,
        details: { commitment: commitmentId, owner: personId, timer: timer.id, generation: timer.generation },
      });
    },
    async close(threadId, at) {
      const card = await lock(threadId);
      if (!card) return;
      const cancelled = await thread.cancelTimer(dueTimerId(threadId), at);
      await endOwnTimers(threadId, at);
      if (card.state === 'handled' && !cancelled) return;
      await thread.updateThread(threadId, {
        state: 'handled',
        handledAt: at,
        waitingOn: null,
        snoozedUntil: null,
        updatedAt: at,
      });
      await thread.addMessage(threadId, { role: 'assistant', body: 'Åtgärdspunkten är klar.', at });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.handled',
        subject: `thread:${threadId}`,
        at,
        details: { owner: card.personId, timer: dueTimerId(threadId), cancelled },
      });
    },
    async reopen(threadId, dueOn, at) {
      const card = await lock(threadId);
      if (!card) return;
      const personId = card.personId;
      const summary = summaryFor(dueOn);
      await thread.updateThread(threadId, {
        state: 'open',
        handledAt: null,
        snoozedUntil: null,
        deadline: dueOn,
        summary,
        updatedAt: at,
      });
      await thread.addMessage(threadId, { role: 'assistant', body: `Åtgärdspunkten är öppen igen. ${summary}`, at });
      const timer = await schedule(threadId, personId, dueOn, at);
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.reopened',
        subject: `thread:${threadId}`,
        at,
        details: { owner: personId, timer: timer.id, generation: timer.generation },
      });
    },
    async fire(threadId, generation, at) {
      const card = await lock(threadId);
      if (!card) return false;
      const timer = await thread.readTimer(dueTimerId(threadId));
      if (
        !timer ||
        timer.kind !== 'due' ||
        timer.generation !== generation ||
        timer.state !== 'active' ||
        Date.parse(timer.dueAt) > Date.parse(at)
      )
        return false;
      await thread.updateTimer({ ...timer, state: 'fired', reason: null, leaseUntil: null });
      if (card.snoozedUntil) await thread.cancelTimer(`snooze:${threadId}`, at);
      const day = card.deadline ? swedishDay(card.deadline) : undefined;
      await thread.updateThread(threadId, {
        state: 'open',
        handledAt: null,
        waitingOn: null,
        snoozedUntil: null,
        remindedAt: at,
        updatedAt: at,
        trigger: {
          reason: day ? `Skulle vara klar ${day}` : 'Förfallodagen har passerat',
          source: SOURCE,
          at,
        },
      });
      await thread.addMessage(threadId, {
        role: 'assistant',
        body: day ? `Åtgärdspunkten skulle vara klar ${day}.` : 'Åtgärdspunkten skulle vara klar.',
        at,
      });
      await thread.admitDelivery({
        id: `due:${threadId}:${generation}`,
        personId: timer.personId,
        threadId,
        kind: 'reminder',
        at,
      });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'timer.fired',
        subject: `timer:${timer.id}`,
        at,
        details: { generation, owner: timer.personId },
      });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.reminded',
        subject: `thread:${threadId}`,
        at,
        details: { reason: 'due', generation, wasState: card.state, owner: timer.personId },
      });
      return true;
    },
    async remove(threadIds) {
      if (!threadIds.length) return;
      // Only the talks module's own cards: an id of any other card is left alone.
      await removeCards(
        tx,
        thread,
        and(inArray(schema.threads.id, [...threadIds]), eq(schema.threads.connector, TALKS_CONNECTOR)),
        ACTOR,
        options.clock().toISOString(),
      );
    },
  };
}
