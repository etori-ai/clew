import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import {
  aboutWords,
  addressChipRefs,
  addressEntity,
  askAboutWords,
  askPersonPlaceholder,
  entitySubject,
  paneTabHref,
  sentWords,
  storedAbout,
  suggestedWords,
  talkingTo,
  withWords,
  withoutSubject,
} from '../src/conversation-about';

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
  test('a conversation never handed over is with the assistant', () => {
    expect(talkingTo({ messages: [question(), answer()] })).toBeNull();
    expect(withWords(null)).toBe('assistenten');
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
    // The system is always named: an assistant's own name can read like Clew's.
    expect(sentWords({ name: 'HR-assistenten', source: 'Eneo' })).toBe('Skickat till HR-assistenten i Eneo');
  });
  test('a question the person brought to Clew from the panel says where it came from', () => {
    expect(sentWords({ name: 'HR-assistenten', source: 'Eneo', fromSide: true })).toBe(
      'Från sidofältet · HR-assistenten kunde inte svara',
    );
  });
  test('the suggestion becomes one line', () => {
    expect(suggestedWords({ name: 'HR-assistenten', source: 'Eneo' })).toBe(
      'Assistenten föreslog HR-assistenten i Eneo · du valde att fråga den',
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

describe('one conversation per person, not one per tab (the product owner, 2026-11-14)', () => {
  test('"Fråga assistenten" on two of a person’s tabs is one subject, with a different first tab in the pane', () => {
    const fromAbsence = entitySubject('person', 'johan', 'hr.person');
    const fromEquipment = entitySubject('person', 'johan', 'servicedesk.person');
    expect(fromAbsence.key).toBe('person:johan');
    expect(fromEquipment.key).toBe(fromAbsence.key);
    // Nothing about the person goes with a question as a chip (D97 item 7), from any tab.
    expect(fromAbsence.chips).toEqual([]);
    expect(fromEquipment.chips).toEqual([]);
    expect(fromAbsence.search).toBe('?person=johan&section=hr.person');
    expect(fromEquipment.search).toBe('?person=johan&section=servicedesk.person');
    expect(addressEntity(fromAbsence.search)).toEqual({ kind: 'person', key: 'johan', tab: 'hr.person' });
    expect(addressEntity(fromEquipment.search)).toEqual({ kind: 'person', key: 'johan', tab: 'servicedesk.person' });
    // From Översikt the pane opens on Översikt.
    expect(entitySubject('person', 'johan').search).toBe('?person=johan');
    expect(addressEntity('?person=johan')).toEqual({ kind: 'person', key: 'johan', tab: null });
  });
  test('a unit is one subject too, and a key is written safely into the address', () => {
    expect(entitySubject('unit', 'unit-skola', 'needs-you')).toMatchObject({
      key: 'unit:unit-skola',
      search: '?unit=unit-skola&section=needs-you',
    });
    expect(entitySubject('person', 'a b&c').search).toBe('?person=a%20b%26c');
    expect(addressEntity('?person=a%20b%26c')).toEqual({ kind: 'person', key: 'a b&c', tab: null });
  });
  test('an address from before (`?person=&section=`) reads as the person, the section as the pane’s first tab', () => {
    expect(addressEntity('?person=johan&section=hr.person')).toEqual({
      kind: 'person',
      key: 'johan',
      tab: 'hr.person',
    });
    // A work item or a view in the address is what stands beside the transcript instead.
    expect(addressEntity('?card=t1&person=johan')).toBeNull();
    expect(addressEntity('?open=calendar.week')).toBeNull();
    expect(addressEntity('?lens=hr.presence')).toBeNull();
  });
  test('the pane’s tab changes only `section`; ✕ lets go of the person and keeps the conversation', () => {
    expect(paneTabHref('/conversations/new', '?person=johan&section=hr.person', 'servicedesk.person')).toBe(
      '/conversations/new?person=johan&section=servicedesk.person',
    );
    expect(paneTabHref('/conversations/k1', '?person=johan&section=hr.person', null)).toBe(
      '/conversations/k1?person=johan',
    );
    expect(withoutSubject('/conversations/k1', '?person=johan&section=hr.person')).toBe('/conversations/k1');
    expect(withoutSubject('/conversations/new', '?unit=u1')).toBe('/conversations/new');
  });
  test('the page says what it is before anything is written', () => {
    expect(askAboutWords('Johan Byström')).toBe('Fråga om Johan Byström');
    expect(askPersonPlaceholder('Johan Byström')).toBe('Fråga om Johan');
    expect(aboutWords('Johan Byström')).toBe('om Johan Byström');
  });
});

describe('what a stored conversation keeps about its subject', () => {
  test('the chips its first question went with, each once; a person or a unit is kept by nothing', () => {
    const chip = { ref: 'thread:fakturor', kind: 'thread', label: 'Attestera 3 fakturor' } as const;
    expect(storedAbout({ messages: [question({ chips: [chip, chip] }), answer()] })).toEqual(['Attestera 3 fakturor']);
    expect(storedAbout({ messages: [question(), answer(), question({ chips: [chip] })] })).toEqual([]);
    expect(storedAbout({ messages: [] })).toEqual([]);
  });
});
