import { describe, expect, test } from 'bun:test';
import type { RecordAction } from '@clew/contracts';
import { askDraftKey, subjectKey } from '../src/entity-actions';
import {
  draftMessage,
  draftedAction,
  recordDraftPhase,
  recordInputJson,
  recordSubjectKey,
  sameDraft,
  sameRecord,
  sentState,
} from '../src/record-actions';

/**
 * Actions about a record (D137) as the browser names them: a record is its read and the input its page made it with,
 * whoever holds it, so the record's page and an assistant's draft about it share one list of actions, and a stored
 * draft, which carries no action, finds its own in that list or draws nothing.
 */
const comment: RecordAction = {
  capability: 'servicedesk.comment',
  connector: 'servicedesk',
  source: 'IT-servicedesken',
  title: 'Lägg till en kommentar',
  kind: 'execute',
  path: {
    asks: [{ kind: 'long-text', property: 'text', label: 'Kommentar', required: true }],
    effect: true,
    description: 'Lägger till din kommentar.',
  },
};
const read = 'servicedesk.request';
const draft = { capability: comment.capability, record: { capability: read, input: { ref: 'SD-1', desk: 'it' } } };

describe('a record by its read and its input', () => {
  test('the same input names the same record whatever the order of its keys, also inside it', () => {
    expect(recordInputJson({ b: 1, a: { d: 2, c: [{ f: 1, e: 0 }] } })).toBe('{"a":{"c":[{"e":0,"f":1}],"d":2},"b":1}');
    expect(sameRecord({ ref: 'SD-1', desk: 'it' }, { desk: 'it', ref: 'SD-1' })).toBe(true);
    expect(sameRecord({ ref: 'SD-1' }, { ref: 'SD-2' })).toBe(false);
    expect(recordSubjectKey(read, { ref: 'SD-1', desk: 'it' })).toBe('servicedesk.request?{"desk":"it","ref":"SD-1"}');
  });

  test('the dialog keeps what was typed per record and action, apart from any person’s or unit’s', () => {
    const subject = { kind: 'record' as const, read, input: { ref: 'SD-1' }, name: 'Ny skärm' };
    expect(subjectKey(subject)).toEqual({ kind: 'record', key: 'servicedesk.request?{"ref":"SD-1"}' });
    expect(askDraftKey(comment, subject)).toBe('record:servicedesk.request?{"ref":"SD-1"}:servicedesk.comment');
    // An assistant's values start their own draft, as a plan's row does (D124).
    expect(askDraftKey(comment, subject, { text: 'Tack' })).toBe(
      'record:servicedesk.request?{"ref":"SD-1"}:servicedesk.comment?[["text","Tack"]]',
    );
    expect(subjectKey({ key: 'anna', name: 'Anna' })).toEqual({ kind: 'person', key: 'anna' });
  });
});

describe('the action a draft about a record fills in', () => {
  const other: RecordAction = { ...comment, capability: 'servicedesk.close', title: 'Stäng' };

  test('is the record’s own as the server lists it for the person now', () => {
    expect(draftedAction(draft, [other, comment])).toBe(comment);
  });

  test('one the record no longer offers the person is none, whatever the answer carried', () => {
    const fresh = { ...draft, values: { text: 'Tack' }, action: comment };
    expect(draftedAction(draft, [other], fresh)).toBeUndefined();
    // A refused list (the record cannot be read, or the read is not the person's) is passed as an empty one.
    expect(draftedAction(draft, [], fresh)).toBeUndefined();
  });

  test('until the list has come, the one the latest answer carried, when it is the same draft', () => {
    const fresh = {
      capability: comment.capability,
      record: { capability: read, input: { desk: 'it', ref: 'SD-1' } },
      values: { text: 'Tack' },
      action: comment,
    };
    expect(draftedAction(draft, undefined, fresh)).toBe(comment);
    expect(draftedAction(draft, undefined, { ...fresh, record: { capability: read, input: { ref: 'SD-2' } } })).toBe(
      undefined,
    );
    expect(draftedAction(draft, undefined, null)).toBeUndefined();
  });

  test('a later draft of the same action about the same record replaces an earlier one; another record’s does not', () => {
    expect(sameDraft(draft, { ...draft, record: { capability: read, input: { desk: 'it', ref: 'SD-1' } } })).toBe(true);
    expect(sameDraft(draft, { ...draft, record: { capability: read, input: { ref: 'SD-2' } } })).toBe(false);
    expect(sameDraft(draft, { ...draft, capability: 'servicedesk.close' })).toBe(false);
  });
});

/**
 * Where a draft about a record stands (D137): sent once the person sent it, which the server wrote on the draft with the
 * work item it became, else replaced by a later draft of the same action about the same record, else to fill in and
 * send. A sent draft says so in the words a work item's sent draft uses, and offers no second send.
 */
describe('a draft about a record: to send, sent or replaced', () => {
  const values = { text: 'Felkoden är E07.' };
  const kept = { ...draft, values };
  const sent = { ...kept, sent: { threadId: 'work-1' } };

  test('to fill in and send until it is sent or replaced', () => {
    expect(recordDraftPhase(kept, false)).toEqual({ phase: 'fillable' });
    expect(recordDraftPhase(kept, false, kept)).toEqual({ phase: 'fillable' });
    expect(recordDraftPhase(kept, true)).toEqual({ phase: 'replaced' });
  });

  test('sent, as the work item it became, whatever came after it; known from the conversation read again too', () => {
    expect(recordDraftPhase(sent, false)).toEqual({ phase: 'sent', threadId: 'work-1' });
    expect(recordDraftPhase(sent, true)).toEqual({ phase: 'sent', threadId: 'work-1' });
    // The transcript still holds the draft as it was before the send; the conversation read again after it says sent.
    expect(recordDraftPhase(kept, false, sent)).toEqual({ phase: 'sent', threadId: 'work-1' });
    expect(recordDraftPhase(kept, true, sent)).toEqual({ phase: 'sent', threadId: 'work-1' });
  });

  test('what a sent draft says: the receipt, the decision on its way, or "Skickat" before the work item is read', () => {
    const receipt = {
      at: '2026-11-20T09:00:00.000Z',
      headline: 'Kommentaren är tillagd i IT-servicedesken.',
      rows: [],
      undoUntil: null,
      undoCapability: null,
    };
    expect(sentState({ receipt, execution: null, state: 'handled', waitingOn: null })).toEqual({
      variant: 'success',
      label: 'Skickat',
      detail: 'Kommentaren är tillagd i IT-servicedesken.',
    });
    const execution = {
      id: 'execution-1',
      decisionId: 'd-1',
      operation: 'servicedesk.comment',
      state: 'pending' as const,
      reason: null,
      compensates: null,
    };
    expect(sentState({ receipt: null, execution, state: 'open', waitingOn: null })).toEqual({
      variant: 'warning',
      label: 'Skickat, väntar på källan',
      detail: 'Ditt beslut är sparat och väntar på källan.',
    });
    expect(sentState(undefined)).toEqual({ variant: 'success', label: 'Skickat', detail: null });
    expect(sentState({ receipt: null, execution: null, state: 'handled', waitingOn: null })).toEqual({
      variant: 'success',
      label: 'Skickat',
      detail: null,
    });
    // The item was made and nothing was decided in it (a propose, or a decision that failed after the start).
    expect(sentState({ receipt: null, execution: null, state: 'open', waitingOn: null })).toEqual({
      variant: 'warning',
      label: 'Väntar på dig',
      detail: null,
    });
  });

  test('the send names the message that keeps the draft: the very draft the transcript hands the card, else none', () => {
    const first = { id: 'm-1', meta: { recordDraft: { ...kept } } };
    const second = { id: 'm-2', meta: { recordDraft: { ...kept } } };
    const messages = [{ id: 'm-0' }, first, second];
    expect(draftMessage(messages, second.meta.recordDraft)).toBe(second);
    expect(draftMessage(messages, first.meta.recordDraft)).toBe(first);
    // A draft no message holds names none, and the action is then sent as from the record's page.
    expect(draftMessage(messages, { ...kept })).toBeUndefined();
  });
});
