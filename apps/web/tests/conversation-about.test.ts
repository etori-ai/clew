import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { addressChipRefs, sentWords, suggestedWords, talkingTo, withWords } from '../src/conversation-about';

const AT = '2026-11-14T10:00:00.000Z';
const handover = { assistant: 'eneo:hr', name: 'HR-assistenten', source: 'Eneo', session: 's1' };
const question = (meta?: Thread['messages'][number]['meta']) =>
  ({
    id: 'q',
    role: 'user',
    body: 'Har en vikarie rätt till föräldraledighet?',
    createdAt: AT,
    ...(meta ? { meta } : {}),
  }) as const;
const answer = (meta?: Thread['messages'][number]['meta']) =>
  ({ id: 'a', role: 'assistant', body: 'Ja.', createdAt: AT, ...(meta ? { meta } : {}) }) as const;
const who = { assistant: handover.assistant, name: handover.name, source: handover.source };

describe('whom a conversation is with (D125, D126)', () => {
  test('a conversation never handed over is with Clew', () => {
    expect(talkingTo({ messages: [question(), answer()] })).toBeNull();
    expect(withWords(null)).toBe('Clew');
  });
  test('a conversation handed to another system’s assistant is with it, named with its system', () => {
    const with_ = talkingTo({ handover, messages: [question({ handed: who }), answer({ handover: who })] });
    expect(with_).toEqual({ id: 'eneo:hr', name: 'HR-assistenten', source: 'Eneo' });
    expect(withWords(with_)).toBe('HR-assistenten i Eneo');
  });
  test('an assistant that handed the last question back, or answered and returned it, leaves it with Clew (item 12)', () => {
    expect(
      talkingTo({
        handover,
        messages: [question({ handed: { ...who, declined: true } }), answer({ handedBack: who })],
      }),
    ).toBeNull();
    expect(
      talkingTo({ handover, messages: [question({ handed: who }), answer({ handover: { ...who, returned: true } })] }),
    ).toBeNull();
  });
});

describe('a question handed on stands once (D126 item 6)', () => {
  test('sent on at Clew’s suggestion, or sent to an assistant the person picked', () => {
    expect(sentWords({ name: 'HR-assistenten', source: 'Eneo', routed: true })).toBe(
      'Skickad vidare till HR-assistenten i Eneo',
    );
    expect(sentWords({ name: 'HR-assistenten', source: 'Eneo' })).toBe('Skickat till HR-assistenten');
  });
  test('the suggestion becomes one line', () => {
    expect(suggestedWords({ name: 'HR-assistenten', source: 'Eneo' })).toBe(
      'Clew föreslog HR-assistenten i Eneo · du valde att fråga den',
    );
  });
});

describe('what a conversation’s page is about, by its address (D126 rule 2)', () => {
  test('the work item and the view beside the transcript are its chips', () => {
    expect(addressChipRefs('?card=t1')).toEqual(['thread:t1']);
    expect(addressChipRefs('?open=calendar.week&open-title=Vecka&open-input=%7B%7D')).toEqual([
      'capability:calendar.week',
    ]);
    expect(addressChipRefs(new URLSearchParams('person=anna'))).toEqual([]);
    expect(addressChipRefs('')).toEqual([]);
  });
});
