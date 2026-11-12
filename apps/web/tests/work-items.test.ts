import { describe, expect, test } from 'bun:test';
import type { CardAction, ThreadItem } from '@clew/contracts';
import { noticeOf, paragraphsOf, receiptAction, rowsSaySomething, sourcesNotice, todoFromHem } from '../src/work-items';

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
  test('one row that is the item itself only repeats its title', () => {
    expect(rowsSaySomething({ title, items: [row()] })).toBe(false);
    expect(rowsSaySomething({ title, items: [row({ label: ' ny rutin vid  hot och våld ' })] })).toBe(false);
  });
  test('a row with a fact of its own is drawn: a detail, a person or unit, a choice, another label', () => {
    expect(rowsSaySomething({ title, items: [row({ detail: 'kräver läskvitto' })] })).toBe(true);
    expect(rowsSaySomething({ title, items: [row({ subject: { entity: 'person', key: 'anna' } })] })).toBe(true);
    expect(rowsSaySomething({ title, items: [row({ selectable: true })] })).toBe(true);
    expect(rowsSaySomething({ title, items: [row({ label: 'Bilaga 1' })] })).toBe(true);
  });
  test('two rows or more are drawn, no rows are not', () => {
    expect(rowsSaySomething({ title, items: [row(), row({ ref: 'communication:notice:2' })] })).toBe(true);
    expect(rowsSaySomething({ title, items: [] })).toBe(false);
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
