import { and, eq, inArray } from 'drizzle-orm';
import type { ThreadAction } from '@clew/contracts';
import { DIALOGUE_CONNECTOR } from '@clew/connectors';
import { schema, type Transaction } from '@clew/db';
import type { ThreadTx } from '../threads/model';
import { reminderStart } from '../threads/domain';
import { authorizationVersion } from '../auth-crypto';
import type { DialogueWorkItems } from '../modules/dialogue/model';
import { dueAtFor, swedishDay } from './talk-work-items';

/**
 * The owner's card of an activity in the follow-up dialogue (D118 item 4): the dialogue module's `DialogueWorkItems`,
 * implemented over the thread store's transaction as `talk-work-items.ts` implements the talks module's cards. The card,
 * its delivery, message, audit row and, for a dated activity, its `dialogue-due` timer (with its workflow start, D86)
 * commit or roll back with the activity, because both stores share one physical database transaction.
 *
 * The card carries no activity text and no name in its title, summary, trigger or messages, since those are what the
 * assistant reads; the audit rows carry ids only. Its subject is the unit, so it shows under "Behöver dig" on the unit's
 * page for its owner. An undated activity's card has no timer and says it has no date (D49). The card is `core` (the
 * `dialogue` connector) and stays with its owner when they change unit, as an action point's does (D96).
 */
export interface DialogueWorkItemOptions {
  /** Composition's clock: the instant written where the port gives none (removal). */
  clock: () => Date;
}
const ACTOR = 'dialogue:activity';
const TITLE = 'Aktivitet från uppföljningsdialogen';
const SOURCE = 'Uppföljningsdialog';
const ACTION: ThreadAction = {
  id: 'activities',
  label: 'Visa aktiviteter',
  capability: DIALOGUE_CONNECTOR + '.activities',
  kind: 'read',
  role: 'primary',
  target: 'panel',
};
export const dialogueDueTimerId = (threadId: string) => `dialogue-due:${threadId}`;
const summaryFor = (dueOn: string | null) =>
  dueOn ? `En aktivitet ska vara klar senast ${swedishDay(dueOn)}.` : 'En aktivitet utan slutdatum.';

export function dialogueWorkItems(
  tx: Transaction,
  thread: ThreadTx,
  options: DialogueWorkItemOptions,
): DialogueWorkItems {
  /** The owner's unit and authorisation version as of this transaction; empty when they have no grant. */
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
      id: dialogueDueTimerId(threadId),
      personId,
      threadId,
      kind: 'dialogue-due',
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
    async open({ threadId, personId, activityId, dueOn, at, subject }) {
      const summary = summaryFor(dueOn);
      const inserted = await thread.insertThread({
        id: threadId,
        personId,
        kind: 'pushed',
        topic: `${DIALOGUE_CONNECTOR}:activity:${activityId}`,
        title: TITLE,
        state: 'open',
        week: null,
        connector: DIALOGUE_CONNECTOR,
        area: DIALOGUE_CONNECTOR,
        summary,
        items: [],
        // The unit, by key, on the thread and never on a row: the card is about the unit.
        subjects: [subject],
        actions: [ACTION],
        waitingOn: null,
        deadline: dueOn,
        trigger: { reason: 'Lades till i uppföljningsdialogen', source: SOURCE, at },
        createdAt: at,
        updatedAt: at,
      });
      if (!inserted) throw new Error(`The activity card ${threadId} already exists.`);
      await thread.admitDelivery({ id: `delivery:${threadId}`, personId, threadId, kind: 'automatic', at });
      await thread.addMessage(threadId, { role: 'assistant', body: summary, at });
      const timer = dueOn ? await schedule(threadId, personId, dueOn, at) : undefined;
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.pushed',
        subject: `thread:${threadId}`,
        at,
        details: {
          activity: activityId,
          owner: personId,
          ...(timer ? { timer: timer.id, generation: timer.generation } : {}),
        },
      });
    },
    async close(threadId, at) {
      const card = await lock(threadId);
      if (!card) return;
      const cancelled = await thread.cancelTimer(dialogueDueTimerId(threadId), at);
      await endOwnTimers(threadId, at);
      if (card.state === 'handled' && !cancelled) return;
      await thread.updateThread(threadId, {
        state: 'handled',
        handledAt: at,
        waitingOn: null,
        snoozedUntil: null,
        updatedAt: at,
      });
      await thread.addMessage(threadId, { role: 'assistant', body: 'Aktiviteten är klar.', at });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.handled',
        subject: `thread:${threadId}`,
        at,
        details: { owner: card.personId, timer: dialogueDueTimerId(threadId), cancelled },
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
      await thread.addMessage(threadId, { role: 'assistant', body: `Aktiviteten är öppen igen. ${summary}`, at });
      const timer = dueOn ? await schedule(threadId, personId, dueOn, at) : undefined;
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.reopened',
        subject: `thread:${threadId}`,
        at,
        details: { owner: personId, ...(timer ? { timer: timer.id, generation: timer.generation } : {}) },
      });
    },
    async retime(threadId, dueOn, at) {
      const card = await lock(threadId);
      if (!card || card.state === 'handled') return;
      const summary = summaryFor(dueOn);
      await thread.updateThread(threadId, { deadline: dueOn, summary, updatedAt: at });
      await thread.addMessage(threadId, { role: 'assistant', body: `Datumet ändrades. ${summary}`, at });
      const timer = dueOn
        ? await schedule(threadId, card.personId, dueOn, at)
        : (await thread.cancelTimer(dialogueDueTimerId(threadId), at), undefined);
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.retimed',
        subject: `thread:${threadId}`,
        at,
        details: {
          owner: card.personId,
          dated: !!dueOn,
          ...(timer ? { timer: timer.id, generation: timer.generation } : {}),
        },
      });
    },
    async fire(threadId, generation, at) {
      const card = await lock(threadId);
      if (!card) return false;
      const timer = await thread.readTimer(dialogueDueTimerId(threadId));
      if (
        !timer ||
        timer.kind !== 'dialogue-due' ||
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
          reason: day ? `Skulle vara klar ${day}` : 'Slutdatumet har passerat',
          source: SOURCE,
          at,
        },
      });
      await thread.addMessage(threadId, {
        role: 'assistant',
        body: day ? `Aktiviteten skulle vara klar ${day}.` : 'Aktiviteten skulle vara klar.',
        at,
      });
      await thread.admitDelivery({
        id: `dialogue-due:${threadId}:${generation}`,
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
      const at = options.clock().toISOString();
      // Only the dialogue's own cards: an id of any other card is left alone.
      const cards = await tx
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(and(inArray(schema.threads.id, [...threadIds]), eq(schema.threads.connector, DIALOGUE_CONNECTOR)))
        .orderBy(schema.threads.id)
        .for('update');
      if (!cards.length) return;
      const ids = cards.map(c => c.id);
      // Every running wait ends after the commit, as a replaced generation's does; the rows go with the thread.
      const timers = await tx
        .select({ id: schema.timerIntents.id })
        .from(schema.timerIntents)
        .where(inArray(schema.timerIntents.threadId, ids))
        .orderBy(schema.timerIntents.id)
        .for('update');
      for (const timer of timers) await thread.cancelTimer(timer.id, at);
      // Messages, timers and deliveries cascade; an occurrence only loses its pointer, so it goes here.
      await tx.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.threadId, ids));
      await tx.delete(schema.threads).where(inArray(schema.threads.id, ids));
      for (const id of ids)
        await thread.writeAudit({
          actor: ACTOR,
          action: 'thread.removed',
          subject: `thread:${id}`,
          at,
          details: { reason: 'activity-removed' },
        });
    },
  };
}
