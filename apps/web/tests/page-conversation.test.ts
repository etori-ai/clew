import { describe, expect, test } from 'bun:test';
import type { Chip, Thread } from '@clew/contracts';
import { conversationFor, listSubject } from '../src/components/page-conversation';

type Message = Thread['messages'][number];
const asked = (chips: Chip[], id = 'q'): Message => ({
  id,
  role: 'user',
  body: 'Vad står på agendan?',
  createdAt: '2026-11-18T09:00:00.000Z',
  meta: { chips },
});
const answer: Message = { id: 'a', role: 'assistant', body: 'Tio personer.', createdAt: '2026-11-18T09:00:01.000Z' };
const thread = (
  id: string,
  updatedAt: string,
  messages: Message[],
  kind: Thread['kind'] = 'question',
  askedBeside?: Thread['askedBeside'],
): Thread =>
  ({ id, kind, title: id, updatedAt, messages, ...(askedBeside ? { askedBeside } : {}) }) as unknown as Thread;
const beside = (subject: string, openedAt: string | null = null): Thread['askedBeside'] => ({
  subject,
  label: 'Om Beställningar och felanmälningar',
  openedAt,
});

const meeting: Chip = { ref: 'event:v1', kind: 'event', label: 'Morgonmöte ledningsgrupp' };
const week45: Chip = { ref: 'capability:calendar.week', kind: 'capability', label: 'Vecka 45' };
const week46: Chip = { ref: 'capability:calendar.week', kind: 'capability', label: 'Vecka 46' };

describe('the conversation beside a page is the person’s newest about its subject (D130 rule 6)', () => {
  test('a question asked with the subject’s chip makes the conversation about it, and the newest one wins', () => {
    const older = thread('om-1', '2026-11-17T10:00:00.000Z', [asked([meeting]), answer]);
    const newer = thread('om-2', '2026-11-18T10:00:00.000Z', [asked([meeting]), answer]);
    expect(conversationFor([older, newer], { key: 'event:v1', chips: [meeting] })?.id).toBe('om-2');
    expect(conversationFor([newer, older], { key: 'event:v1', chips: [meeting] })?.id).toBe('om-2');
  });
  test('a later question with the chip counts as much as the first; an answer naming it does not', () => {
    const later = thread('om-3', '2026-11-18T10:00:00.000Z', [asked([]), answer, asked([meeting], 'q2')]);
    expect(conversationFor([later], { key: 'event:v1', chips: [meeting] })?.id).toBe('om-3');
    const answered = thread('om-4', '2026-11-18T10:00:00.000Z', [
      asked([]),
      { ...answer, meta: { key: 'event:v1', chips: [meeting] } } as Message,
    ]);
    expect(conversationFor([answered], { key: 'event:v1', chips: [meeting] })).toBeNull();
  });
  test('only conversations count, not a work item that carries the chip', () => {
    const item = thread('item-1', '2026-11-18T10:00:00.000Z', [asked([meeting])], 'pushed');
    expect(conversationFor([item], { key: 'event:v1', chips: [meeting] })).toBeNull();
  });
  test('a range read is told apart by the week or day it was asked about, its label', () => {
    const w45 = thread('om-w45', '2026-11-17T10:00:00.000Z', [asked([week45]), answer]);
    const w46 = thread('om-w46', '2026-11-18T10:00:00.000Z', [asked([week46]), answer]);
    expect(conversationFor([w45, w46], { key: 'range:week:2026-11-02', chips: [week45] })?.id).toBe('om-w45');
    expect(conversationFor([w45, w46], { key: 'range:week:2026-11-09', chips: [week46] })?.id).toBe('om-w46');
  });
  test('a subject without a chip, or with no conversation about it yet, has none', () => {
    const other = thread('om-x', '2026-11-18T10:00:00.000Z', [asked([{ ...meeting, ref: 'event:v2' }]), answer]);
    expect(conversationFor([other], { key: 'event:v1', chips: [meeting] })).toBeNull();
    expect(conversationFor([other], { key: 'event:v1', chips: [] })).toBeNull();
    expect(conversationFor([], { key: 'event:v1', chips: [meeting] })).toBeNull();
  });
});

describe('the subject a conversation was asked beside finds it on any device (D130 rule 6)', () => {
  const requests: Chip = { ref: 'capability:clew.requests', kind: 'capability', label: 'Beställningar' };
  const subject = { key: 'view:clew.requests', chips: [requests] };
  test('the subject kept on the conversation finds it, without the chip on any question', () => {
    const kept = thread('om-a', '2026-11-18T10:00:00.000Z', [asked([]), answer], 'question', beside(subject.key));
    expect(conversationFor([kept], subject)?.id).toBe('om-a');
  });
  test('it comes before a newer conversation that is only found by its chip, and the newest of them wins', () => {
    const older = thread('om-b', '2026-11-16T10:00:00.000Z', [asked([]), answer], 'question', beside(subject.key));
    const newer = thread('om-c', '2026-11-17T10:00:00.000Z', [asked([]), answer], 'question', beside(subject.key));
    const chipped = thread('om-d', '2026-11-18T10:00:00.000Z', [asked([requests]), answer]);
    expect(conversationFor([older, chipped, newer], subject)?.id).toBe('om-c');
  });
  test('a conversation asked before the subject was kept is still found by its chip', () => {
    const before = thread('om-e', '2026-11-18T10:00:00.000Z', [asked([requests]), answer]);
    expect(conversationFor([before], subject)?.id).toBe('om-e');
  });
  test('another subject’s conversation is not this one’s, whether opened or not', () => {
    const other = thread('om-f', '2026-11-18T10:00:00.000Z', [asked([]), answer], 'question', beside('view:hr.staff'));
    const opened = thread(
      'om-g',
      '2026-11-18T10:00:00.000Z',
      [asked([]), answer],
      'question',
      beside('view:hr.staff', '2026-11-18T11:00:00.000Z'),
    );
    expect(conversationFor([other, opened], subject)).toBeNull();
  });
});

describe('a list’s subject in the words of the pane (D130 rules 4 and 10)', () => {
  const read = {
    key: 'view:clew.requests',
    label: 'beställningar och felanmälningar',
    chips: [
      { ref: 'capability:clew.requests', kind: 'capability' as const, label: 'Beställningar och felanmälningar' },
    ],
    search: '',
  };
  test('what the pane is about keeps the title; the box asks with its first letter lowered', () => {
    const subject = listSubject(read, 'Beställningar och felanmälningar');
    expect(subject.about).toBe('Om Beställningar och felanmälningar');
    expect(subject.placeholder).toBe('Fråga om beställningar och felanmälningar');
    expect(subject.label).toBe('beställningar och felanmälningar');
    expect(subject.key).toBe('view:clew.requests');
    expect(subject.chips).toEqual(read.chips);
  });
  test('a name in the title and a word in capitals read as written', () => {
    expect(listSubject(read, 'Kompetenser för Anna Lindqvist').placeholder).toBe(
      'Fråga om kompetenser för Anna Lindqvist',
    );
    expect(listSubject(read, 'IT-ärenden').placeholder).toBe('Fråga om IT-ärenden');
  });
});
