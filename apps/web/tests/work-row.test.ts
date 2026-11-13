import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { rowFacts, rowLine, whyOf } from '../src/work-items';

const NOW = '2026-11-10T09:00:00.000Z';
const TODAY = '2026-11-10';
/** A work item as the server sends it: an event without a day or a button, so its state is "Till kännedom". */
const thread = (values: Partial<Thread> = {}): Thread => ({
  id: 'a',
  title: 'a',
  kind: 'pushed',
  topic: 'a',
  state: 'open',
  trigger: { reason: 'Ansökan kom 10 november kl. 16:40.', source: 'HR', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'hr',
  area: 'leave',
  summary: '',
  items: [],
  actions: [],
  waitingOn: null,
  deadline: null,
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
  ...values,
});
const line = (values: Partial<Thread>) => rowLine(rowFacts(thread(values), NOW, TODAY));

describe("a work item's row says its state in words (WCAG 1.4.1)", () => {
  test('the state begins the supporting line, held to its separator by a no-break space, then why the item is here', () => {
    expect(
      rowLine({
        state: { variant: 'error', label: 'Ska göras i dag' },
        due: null,
        why: 'Ansökan kom 10 november kl. 16:40',
      }),
    ).toBe('Ska göras i dag\u00a0· Ansökan kom 10 november kl. 16:40');
    // Two states that differed by the dot's colour alone now differ in words.
    expect(
      rowLine({ state: { variant: 'warning', label: 'Ska göras' }, due: null, why: 'Ansökan väntar på beslut' }),
    ).toBe('Ska göras\u00a0· Ansökan väntar på beslut');
  });
  test('an item that waits on someone says so once, with whom', () => {
    expect(
      rowLine({ state: { variant: 'neutral', label: 'Väntar på andra' }, due: null, why: 'Väntar på skyddsombudet' }),
    ).toBe('Väntar på skyddsombudet');
    // Set aside, it waits on nobody: the state and when it comes back are two things.
    expect(rowLine({ state: { variant: 'neutral', label: 'Inte nu' }, due: null, why: 'Tillbaka i morgon' })).toBe(
      'Inte nu\u00a0· Tillbaka i morgon',
    );
  });
  test('without a reason the state stands alone', () => {
    expect(rowLine({ state: { variant: 'success', label: 'Klart' }, due: null, why: '' })).toBe('Klart');
  });
  test('from the thread itself, an item that waits says what it waits on once: someone, or its source', () => {
    expect(line({ waitingOn: 'skyddsombudet' })).toBe('Väntar på skyddsombudet');
    // A decision that was approved and waits for its source, with the words the server's projection writes.
    expect(
      line({
        waitingOn: 'källans besked',
        execution: {
          id: 'e',
          decisionId: 'd',
          operation: 'hr.approve',
          state: 'pending',
          reason: null,
          compensates: null,
        },
      }),
    ).toBe('Väntar på källans besked');
  });
  test('an item reminded today that has no day says Påminnelse once: the state, and no badge that repeats it', () => {
    const reminded = rowFacts(thread({ remindedAt: NOW }), NOW, TODAY);
    expect(reminded.state.label).toBe('Påminnelse');
    expect(reminded.due).toBeNull();
    // With a day the badge says something the state does not, and stays.
    expect(rowFacts(thread({ remindedAt: NOW, deadline: TODAY }), NOW, TODAY).due).toEqual({
      variant: 'error',
      label: 'I dag',
    });
  });
  test('a reason of only spaces, or none where a reminder waits to be scheduled, leaves no separator alone', () => {
    const queued: Thread['timers'] = [{ kind: 'reminder', dueAt: '2026-11-11T09:00:00.000Z', state: 'queued' }];
    const blank = thread({ trigger: { reason: '   ', source: 'HR', at: NOW } });
    expect(whyOf(blank, NOW)).toBe('');
    expect(rowLine(rowFacts(blank, NOW, TODAY))).toBe('Till kännedom');
    const none = thread({ trigger: { reason: '', source: 'HR', at: NOW }, timers: queued });
    expect(whyOf(none, NOW)).toBe('påminnelsen väntar på schemaläggning');
    expect(rowLine(rowFacts(none, NOW, TODAY))).toBe('Till kännedom\u00a0· påminnelsen väntar på schemaläggning');
    // With a reason the two are joined as before.
    expect(line({ timers: queued })).toBe(
      'Till kännedom\u00a0· Ansökan kom 10 november kl. 16:40 · påminnelsen väntar på schemaläggning',
    );
  });
});
