import { describe, expect, test } from 'bun:test';
import type { ThreadMessage } from '@clew/contracts';
import { DOT } from '../src/dot';
import { answerEyebrow, namedItems, newestExchange, readWords } from '../src/start-answer';

const AT = '2026-11-19T08:00:00.000Z';
type Meta = ThreadMessage['meta'];
const asked = (id: string, body: string, meta?: Meta): ThreadMessage =>
  ({ id, role: 'user', body, createdAt: AT, ...(meta ? { meta } : {}) }) as ThreadMessage;
const answered = (id: string, body: string, meta?: Meta): ThreadMessage =>
  ({ id, role: 'assistant', body, createdAt: AT, ...(meta ? { meta } : {}) }) as ThreadMessage;
const TITLES: Record<string, string> = { 'clew.threads': 'Att göra', 'calendar.today': 'Kalender' };
const titleOf = (capability: string) => TITLES[capability];
const eneo = { assistant: 'eneo:hr', name: 'HR-assistenten', source: 'Eneo', session: 's1' };

describe('the newest exchange under Hem’s line (D133 item 9)', () => {
  test('is the last question and the answer written to it; the earlier ones stay in the conversation', () => {
    const messages = [asked('q1', 'Första'), answered('a1', 'Ett'), asked('q2', 'Andra'), answered('a2', 'Två')];
    expect(newestExchange(messages)).toEqual({ question: messages[2]!, answer: messages[3]! });
  });
  test('a question not answered yet stands alone', () => {
    const messages = [asked('q1', 'Första'), answered('a1', 'Ett'), asked('q2', 'Andra')];
    expect(newestExchange(messages)).toEqual({ question: messages[2]!, answer: null });
  });
  test('what was said in the panel of another system’s assistant is never the newest exchange', () => {
    const messages = [
      asked('q1', 'Första'),
      answered('a1', 'Ett'),
      asked('q2', 'I sidofältet', { handed: { ...eneo, side: true } }),
      answered('a2', 'Från Eneo', { handover: { ...eneo, side: true } }),
    ];
    expect(newestExchange(messages)).toEqual({ question: messages[0]!, answer: messages[1]! });
  });
  test('a conversation with no question has no exchange', () => {
    expect(newestExchange([])).toBeNull();
  });
});

describe('what the answer read, over the question', () => {
  test('the reads that answered, by the transcript’s titles, each once and joined as a sentence joins them', () => {
    const meta = {
      reads: [{ capability: 'clew.threads' }, { capability: 'calendar.today' }, { capability: 'clew.threads' }],
    };
    expect(readWords(meta, titleOf)).toBe('Att göra och Kalender');
    expect(answerEyebrow(answered('a', 'Svar', meta), titleOf)).toBe(`Svar${DOT}Att göra och Kalender`);
  });
  test('a read that failed is said as one that could not be read', () => {
    const meta = { reads: [{ capability: 'clew.threads' }, { capability: 'calendar.today', failed: true as const }] };
    expect(readWords(meta, titleOf)).toBe(`Att göra${DOT}kunde inte läsa Kalender`);
  });
  test('a read with no title is not named, and a turn from before the reads were kept names its view', () => {
    expect(readWords({ reads: [{ capability: 'hr.unknown' }] }, titleOf)).toBe('');
    expect(answerEyebrow(answered('a', 'Svar', { reads: [{ capability: 'hr.unknown' }] }), titleOf)).toBe('Svar');
    const view = { capability: 'phonebook.search', title: 'Telefonboken', input: {}, source: 'Telefonboken' };
    expect(readWords({ view } as Meta, titleOf)).toBe('Telefonboken');
  });
  test('while the answer is on its way the line says only that it is an answer', () => {
    expect(answerEyebrow(null, titleOf)).toBe('Svar');
  });
  test('an answer another system’s assistant wrote names that assistant; one that failed is Clew’s', () => {
    expect(answerEyebrow(answered('a', 'Svar', { handover: eneo }), titleOf)).toBe('Svar från HR-assistenten i Eneo');
    expect(answerEyebrow(answered('a', 'Svar', { handover: { ...eneo, failed: true } }), titleOf)).toBe('Svar');
  });
});

describe('the work items an answer names', () => {
  test('the items it is about, the work items among the rows it names, the item its action is filled in on, and the item a proposal made, each once', () => {
    const meta = {
      cards: ['t1', 't2'],
      viewItems: ['t4', 't1'],
      draft: { kind: 'action' as const, threadId: 't2', actionId: 'approve' },
    };
    expect(namedItems(meta, 'forslag')).toEqual(['t1', 't2', 't4', 'forslag']);
    expect(namedItems({ draft: { kind: 'select', threadId: 't3' } })).toEqual(['t3']);
  });
  test('an answer that names none draws no rows', () => {
    expect(namedItems(undefined)).toEqual([]);
    expect(namedItems({ cards: [] }, null)).toEqual([]);
  });
});
