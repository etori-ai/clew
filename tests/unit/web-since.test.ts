import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { NAMED, sinceSentences, some } from '../../apps/web/src/since';

const NOW = '2026-11-06T12:00:00.000Z';
const thread = (values: Partial<Thread> & Pick<Thread, 'id' | 'title'>): Thread => ({
  kind: 'pushed',
  topic: values.id,
  state: 'handled',
  trigger: { reason: 'Test', source: 'Ekonomisystemet', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: NOW,
  messages: [],
  proposals: [],
  week: null,
  connector: 'finance',
  area: 'budget',
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
/** Closed `minutes` before noon UTC, so the newest sorts first. */
const closed = (id: string, title: string, minutes: number, values: Partial<Thread> = {}) =>
  thread({ id, title, handledAt: new Date(Date.parse(NOW) - minutes * 60_000).toISOString(), ...values });

describe('Sedan i går names a few cards and sums the rest (D65)', () => {
  test('up to four distinct cards are all named, as the artboard joins them', () => {
    expect(some(['a'])).toBe('a');
    expect(some(['a', 'b'])).toBe('a och b');
    expect(some(['a', 'b', 'c', 'd'])).toBe('a, b, c och d');
  });
  test('five or more name the first three and count the rest', () => {
    expect(NAMED).toBe(3);
    expect(some(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c och 2 till');
    expect(some(Array.from({ length: 34 }, (_, i) => 'k' + i))).toBe('k0, k1, k2 och 31 till');
  });
  test('a card that closed more than once is named once while the count stays the number of cards', () => {
    expect(some(['a', 'a', 'b', 'c'])).toBe('a, b, c och 1 till');
    expect(some(['a', 'a', 'a', 'a', 'a', 'a'])).toBe('a och 5 till');
  });
  test('the done sentence, newest first, with the receipt where the source read it back', () => {
    const { doneLine } = sinceSentences({
      now: NOW,
      waiting: [],
      handled: [
        closed('a', 'Attestera 3 fakturor, 37 050 kr', 60),
        closed('b', 'Ny rutin vid hot och våld', 30, {
          receipt: { at: NOW, headline: 'Läst', undoUntil: null, undoCapability: null, rows: [] },
          trigger: { reason: 'Test', source: 'Kommunikation', at: NOW },
        }),
        closed('c', 'Tillbud 2026-1182, halkolycka i duschen', 90, { state: 'dismissed' }),
      ],
    });
    expect(doneLine).toBe(
      '3 klara: ny rutin vid hot och våld, kvitto läst från Kommunikation 13:00, attestera 3 fakturor, 37 050 kr 12:00 och tillbud 2026-1182, halkolycka i duschen, avfärdad 11:30.',
    );
  });
  test("Hillevi's day: thirty-four closed cards read as one short sentence", () => {
    const titles = [
      'Lönesystemet har inte visat det som bevakades',
      'Ny rutin vid hot och våld',
      'Attestera 3 fakturor, 37 050 kr',
      'Godkänn en ledighetsansökan, 22 dec. till 26 dec.',
    ];
    const handled = Array.from({ length: 34 }, (_, i) => closed('t' + i, titles[i % titles.length]!, i < 6 ? 0 : i));
    const { doneLine, waitingLine, reviewLine } = sinceSentences({ now: NOW, waiting: [], handled });
    expect(doneLine).toBe(
      '34 klara: lönesystemet har inte visat det som bevakades 13:00, ny rutin vid hot och våld 13:00, attestera 3 fakturor, 37 050 kr 13:00 och 31 till.',
    );
    expect(waitingLine).toBeNull();
    expect(reviewLine).toStartWith('Nästa genomgång ');
  });
  test('the waiting sentence is summed the same way', () => {
    const waiting = Array.from({ length: 6 }, (_, i) => thread({ id: 'w' + i, title: 'Väntar ' + i, state: 'open' }));
    expect(sinceSentences({ now: NOW, waiting, handled: [] }).waitingLine).toBe(
      '6 väntar på andra: väntar 0, väntar 1, väntar 2 och 3 till.',
    );
  });
});
