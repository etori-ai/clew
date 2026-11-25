import { describe, expect, test } from 'bun:test';
import type { CardAction, ThreadItem } from '@clew/contracts';
import {
  fromClewItself,
  noticeOf,
  paragraphsOf,
  receiptAction,
  rowsSaySomething,
  sourcesNotice,
  todoFromHem,
  todoHref,
} from '../src/work-items';

const ack: CardAction = {
  id: 'ack',
  label: 'Jag har läst',
  capability: 'communication.acknowledge',
  kind: 'execute',
  role: 'primary',
  usesItems: true,
  acknowledgement: { publishedAt: '2026-11-11T06:30:00+01:00' },
};
const out: CardAction = {
  id: 'open',
  label: 'Läs hela nyheten',
  capability: 'communication.open',
  kind: 'read',
  role: 'secondary',
  target: 'link',
  input: { ref: 'communication:notice:1' },
};
const row = (over: Partial<ThreadItem> = {}): ThreadItem => ({
  ref: 'communication:notice:1',
  label: 'Ny rutin vid hot och våld',
  detail: '',
  selectable: false,
  selected: true,
  ...over,
});

describe('Hem’s addresses from before Att göra (D112, amended 2026-11-12)', () => {
  test('a work item alone is Hem’s own, beside it in the panel', () => {
    expect(todoFromHem('')).toBeNull();
    expect(todoFromHem('?card=fakturor')).toBeNull();
    expect(todoFromHem('?card=fakturor&open-card=fakturor&open-action=pattern')).toBeNull();
  });
  test('Hem’s old tabs and area are Att göra’s, with the card that came with them as its item', () => {
    expect(todoFromHem('?tab=waiting')).toBe('/todo?tab=waiting');
    expect(todoFromHem('?tab=snoozed')).toBe('/todo?tab=waiting');
    expect(todoFromHem('?tab=done&card=attest')).toBe('/todo?tab=done&item=attest');
    expect(todoFromHem('?area=personal&card=omtanke&review=omtanke')).toBe(
      '/todo?area=personal&item=omtanke&review=omtanke',
    );
  });
});

describe('a notice (D112, amended 2026-11-12)', () => {
  test('a text is its paragraphs: a blank line ends one, a single line break is a space', () => {
    expect(paragraphsOf('Ett.\n\nTvå\nrader.\n \n\nTre.')).toEqual(['Ett.', 'Två rader.', 'Tre.']);
    expect(paragraphsOf('  En mening.  ')).toEqual(['En mening.']);
    expect(paragraphsOf('')).toEqual([]);
  });
  test('an item with a read receipt is a notice, led by its text, with its first link out after it', () => {
    const summary = 'Från den 1 december gäller en ny rutin.\n\nLäs den och bekräfta.';
    expect(receiptAction({ actions: [out, ack] })).toBe(ack);
    expect(noticeOf({ summary, actions: [ack, out] })).toEqual({
      paragraphs: ['Från den 1 december gäller en ny rutin.', 'Läs den och bekräfta.'],
      out,
    });
    expect(noticeOf({ summary, actions: [ack] })).toEqual({ paragraphs: expect.any(Array), out: undefined });
  });
  test('an item without a read receipt is not a notice, whatever its reads', () => {
    const { acknowledgement: _, ...plain } = ack;
    expect(noticeOf({ summary: 'Text.', actions: [plain, out] })).toBeNull();
    expect(noticeOf({ summary: 'Text.', actions: [] })).toBeNull();
  });
});

describe('whether the rows say anything (D112, amended 2026-11-12)', () => {
  const title = 'Ny rutin vid hot och våld';
  const undecided = { title, receipt: null, actions: [] };
  const receipt = {
    at: '2026-11-23T10:00:00Z',
    headline: 'Felanmälan är skickad',
    undoCapability: null,
    undoUntil: null,
    rows: [{ ref: 'pob:123', label: title, outcome: 'done' as const, detail: 'Ärende 123 är skapat.' }],
  };
  test('a one-row receipt shows its source detail even when the item had no informative rows', () => {
    expect(rowsSaySomething({ title, items: [], actions: [], receipt })).toBe(true);
    expect(rowsSaySomething({ title, items: [row()], actions: [], receipt })).toBe(true);
    expect(rowsSaySomething({ title, items: [], actions: [], receipt: { ...receipt, rows: [] } })).toBe(false);
  });
  test('a notice’s one receipt row is its read receipt, which the receipt’s notice already says', () => {
    const read = { ...receipt, rows: [{ ...receipt.rows[0]!, ref: row().ref, detail: 'kvitterat 09:41' }] };
    expect(rowsSaySomething({ title, items: [row()], actions: [ack], receipt: read })).toBe(false);
    expect(
      rowsSaySomething({
        title,
        items: [row()],
        actions: [ack],
        receipt: { ...read, rows: [...read.rows, { ...read.rows[0]!, ref: 'communication:notice:2' }] },
      }),
    ).toBe(true);
  });
  test('one row that is the item itself only repeats its title', () => {
    expect(rowsSaySomething({ ...undecided, items: [row()] })).toBe(false);
    expect(rowsSaySomething({ ...undecided, items: [row({ label: ' ny rutin vid  hot och våld ' })] })).toBe(false);
  });
  test('a row with a fact of its own is drawn: a detail, a person or unit, a choice, another label', () => {
    expect(rowsSaySomething({ ...undecided, items: [row({ detail: 'kräver läskvitto' })] })).toBe(true);
    expect(rowsSaySomething({ ...undecided, items: [row({ subject: { entity: 'person', key: 'anna' } })] })).toBe(true);
    expect(rowsSaySomething({ ...undecided, items: [row({ selectable: true })] })).toBe(true);
    expect(rowsSaySomething({ ...undecided, items: [row({ label: 'Bilaga 1' })] })).toBe(true);
  });
  test('two rows or more are drawn, no rows are not', () => {
    expect(rowsSaySomething({ ...undecided, items: [row(), row({ ref: 'communication:notice:2' })] })).toBe(true);
    expect(rowsSaySomething({ ...undecided, items: [] })).toBe(false);
  });
});

describe('the sources over the work (D8; D116, amended 2026-11-12)', () => {
  const at = '2026-11-12T13:32:00.000Z';
  test('a source not read yet is said over the list', () => {
    expect(sourcesNotice([{ lastSuccess: null, error: null }])).toBe(
      'Källorna kontrolleras. Sparade uppgifter visas under tiden.',
    );
  });
  test('a source that does not answer is said on its rows, not in a sentence over them', () => {
    expect(sourcesNotice([{ lastSuccess: at, error: 'unavailable' }])).toBeNull();
    expect(sourcesNotice([{ lastSuccess: null, error: 'unavailable' }])).toBeNull();
    expect(sourcesNotice([{ lastSuccess: at, error: null }])).toBeNull();
    expect(sourcesNotice(undefined)).toBeNull();
  });
});

describe('a work item from Clew itself names no source (D126)', () => {
  const systems = [
    { connector: 'hr', ordinal: 1 },
    { connector: 'boarding', ordinal: null },
  ];
  test('its system is the person’s with no ordinal, as the registry marks Clew’s own', () => {
    expect(fromClewItself({ connector: 'boarding' }, systems)).toBe(true);
    expect(fromClewItself({ connector: 'hr' }, systems)).toBe(false);
  });
  test('a system the person cannot see, or systems not known yet, are never taken for Clew’s own', () => {
    expect(fromClewItself({ connector: 'finance' }, systems)).toBe(false);
    expect(fromClewItself({ connector: 'boarding' }, undefined)).toBe(false);
  });
});

describe('an item opened beside the queue takes the assistant’s place (D141 rule 5)', () => {
  test('opening an item lets go of the assistant’s pane, and closing it leaves the queue as it was', () => {
    expect(todoHref({ item: 'omtanke' }, '?tab=waiting&ask=1')).toBe('/todo?tab=waiting&item=omtanke');
    expect(todoHref({ item: null }, '?item=omtanke&tab=waiting')).toBe('/todo?tab=waiting');
  });
  test('any other change keeps the pane open', () => {
    expect(todoHref({ area: 'hr' }, '?ask=1')).toBe('/todo?ask=1&area=hr');
    expect(todoHref({ tab: 'done', item: null }, '?ask=1')).toBe('/todo?ask=1&tab=done');
  });
});
