import type { RecordAction, RecordDraft, Thread } from '@clew/contracts';
import { executionStatus } from './execution-status';

/**
 * Actions about a record (D132), the pure part: a record is its read and the input its page made it with, and the
 * browser names it by both wherever it is kept, so the record's page and an assistant's draft about the same record
 * share one list of actions. No React, no I/O.
 */

/** A value with its objects' keys in order, so the same input is written the same way whoever holds it. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(k => [k, ordered((value as Record<string, unknown>)[k])]),
  );
}
/**
 * A record's input as one string: its JSON with the keys in order. The page's address and a stored draft may hold the
 * same input with its keys in another order (a database keeps them its own way); both name the record the same.
 */
export const recordInputJson = (input: Record<string, unknown>): string => JSON.stringify(ordered(input));
/** The record as one key: its read and its input. */
export const recordSubjectKey = (read: string, input: Record<string, unknown>): string =>
  `${read}?${recordInputJson(input)}`;
/** Whether two inputs name the same record of a read. */
export const sameRecord = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  recordInputJson(a) === recordInputJson(b);

type DraftRef = Pick<RecordDraft, 'capability' | 'record'>;
/** Whether two drafts fill in the same action about the same record: a later one replaces an earlier one. */
export const sameDraft = (a: DraftRef, b: DraftRef): boolean =>
  a.capability === b.capability &&
  a.record.capability === b.record.capability &&
  sameRecord(a.record.input, b.record.input);

/**
 * The action an assistant's draft about a record fills in, as the person may take it now: from the record's actions as
 * the server lists them for the reader, else, before that list has come, the one the answer carried when it was written
 * (`fresh`, `ConversationResponse.recordDraft`). A stored draft carries no action, and an action the record no longer
 * offers the reader is none: nothing is drawn for it.
 */
export function draftedAction(
  draft: DraftRef,
  listed: readonly RecordAction[] | undefined,
  fresh?: (DraftRef & { action: RecordAction }) | null,
): RecordAction | undefined {
  if (listed) return listed.find(a => a.capability === draft.capability);
  return fresh && sameDraft(fresh, draft) ? fresh.action : undefined;
}

/**
 * The conversation's message that keeps the draft (D132): the transcript hands its card the draft as the message keeps
 * it (`MessageMeta.recordDraft`), so it is that very object. Undefined when no message holds it, and the send then names
 * no draft.
 */
export const draftMessage = <M extends { id: string; meta?: { recordDraft?: RecordDraft | undefined } | undefined }>(
  messages: readonly M[],
  draft: RecordDraft,
): M | undefined => messages.find(m => m.meta?.recordDraft === draft);

/**
 * Where an assistant's draft about a record stands (D132). `sent`: the person sent it, as the work item it became, which
 * the server wrote on the draft in that work item's own transaction; `seen` is the same message as the conversation is
 * read again after a send, which knows it before the transcript does. `replaced`: a later draft of the same action about
 * the same record stands under it. Else `fillable`: it offers "Granska och skicka". Sent comes first: a draft that was
 * sent says so whatever came after it.
 */
export type RecordDraftPhase = { phase: 'fillable' } | { phase: 'replaced' } | { phase: 'sent'; threadId: string };
export function recordDraftPhase(draft: RecordDraft, replaced: boolean, seen?: RecordDraft | null): RecordDraftPhase {
  const sent = draft.sent ?? seen?.sent;
  if (sent) return { phase: 'sent', threadId: sent.threadId };
  return replaced ? { phase: 'replaced' } : { phase: 'fillable' };
}

/**
 * What a sent draft says in its button's place, in the words a work item's sent draft says it in (the transcript's
 * `ActionDraftCard`): the work item's receipt read back is "Skickat" with its headline; a decision on its way is
 * "Skickat, väntar på källan" with where it stands; otherwise, also before the work item has been read, "Skickat".
 * A work item that is still open with no decision in it was made and never sent: a propose, which only starts the item,
 * or a decision that failed after the item was made. It says "Väntar på dig", as a conversation's row does
 * (`conversationState`), and the link beside it leads to the item where the decision is made.
 */
export function sentState(item: Pick<Thread, 'receipt' | 'execution' | 'state' | 'waitingOn'> | undefined): {
  variant: 'success' | 'warning';
  label: string;
  detail: string | null;
} {
  if (item?.receipt) return { variant: 'success', label: 'Skickat', detail: item.receipt.headline };
  const waiting = executionStatus(item?.execution);
  if (waiting) return { variant: 'warning', label: 'Skickat, väntar på källan', detail: waiting };
  if (item && !item.execution && item.state === 'open' && !item.waitingOn)
    return { variant: 'warning', label: 'Väntar på dig', detail: null };
  return { variant: 'success', label: 'Skickat', detail: null };
}
