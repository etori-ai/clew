import { describe, expect, test } from 'bun:test';
import type { Area, MessageMeta } from '../../packages/contracts/src/index';
import { answerCard, figureBelongs, rowsSummary } from '../../apps/web/src/answer-card';

/**
 * The card under an answer in the transcript (D38), decided from what the turn recorded and nothing read: the latest
 * answer's card is open, an older answer's stays folded in its place with its title, system and count, and a card that
 * would show rows the answer is not about is its button. A figure line belongs to its own read alone (D54).
 */
const view = {
  capability: 'competence.attention',
  input: {},
  title: 'Kompetenser att åtgärda',
  source: 'Kompetens',
  declared: true,
};
const meta = (extra: Partial<MessageMeta> = {}): MessageMeta => ({ view, ...extra });

describe('the card each answer keeps', () => {
  test('the latest answer’s card is open, with the rows the turn recorded', () => {
    const rows = { count: 4, show: 'named' as const, marks: ['0123456789abcdef'] };
    expect(answerCard(meta({ viewRows: rows }), true)).toEqual({ kind: 'open', view, rows });
  });
  test('an older answer keeps its card folded, saying its title, system and count without reading', () => {
    expect(answerCard(meta({ viewRows: { count: 22, show: 'all' } }), false)).toEqual({
      kind: 'folded',
      view,
      rows: { count: 22, show: 'all' },
      summary: 'Kompetens · 22 rader',
    });
    expect(
      answerCard(
        meta({ viewRows: { count: 22, show: 'named', marks: ['0123456789abcdef', 'fedcba9876543210'] } }),
        false,
      ),
    ).toMatchObject({ kind: 'folded', summary: 'Kompetens · 2 av 22 rader' });
    // A view that is not a list (a record, a detail) has no count to say.
    expect(answerCard(meta(), false)).toMatchObject({ kind: 'folded', summary: 'Kompetens' });
    expect(rowsSummary({ count: 1, show: 'all' })).toBe('1 rad');
  });
  test('a card that would show rows the answer is not about, and an undeclared view, are the button to the whole read', () => {
    expect(answerCard(meta({ viewRows: { count: 22, show: 'none' } }), true)).toEqual({ kind: 'button', view });
    expect(answerCard(meta({ viewRows: { count: 22, show: 'none' } }), false)).toEqual({ kind: 'button', view });
    const { declared: _declared, ...undeclared } = view;
    expect(answerCard({ view: undeclared }, true)).toEqual({ kind: 'button', view: undeclared });
    expect(answerCard({ source: 'Assistenten' }, true)).toBeUndefined();
    expect(answerCard(undefined, false)).toBeUndefined();
  });
});

describe('a figure line under a card', () => {
  const area = (capability: string): Area => ({
    id: 'competence',
    title: 'Kompetens',
    connector: 'competence',
    source: 'Kompetens',
    figure: {
      label: 'Kompetenser som har gått ut eller saknas',
      value: '19',
      tone: 'alert',
      opens: { capability, title: 'x' },
    },
    needsYou: 0,
    waiting: 0,
    urgency: null,
    standing: [
      { capability: 'competence.attention', label: 'Kompetenser att åtgärda', kind: 'read' },
      { capability: 'competence.holdings', label: 'Mina kompetenser', kind: 'read' },
    ],
    schedules: [],
  });
  test('is drawn only where the figure opens the read the card is, and the card is that read as a whole', () => {
    const own = figureBelongs(view, { count: 3, show: 'all' })!;
    expect(own(area('competence.attention'))).toBe(true);
    // The area offers both reads, but its figure is the read of what needs doing: never under one's own holdings.
    const holdings = figureBelongs({ ...view, capability: 'competence.holdings' }, { count: 9, show: 'all' })!;
    expect(holdings(area('competence.attention'))).toBe(false);
    // A card of the rows an answer names is not about the totals.
    expect(figureBelongs(view, { count: 3, show: 'named', marks: ['0123456789abcdef'] })).toBeUndefined();
    expect(figureBelongs(view, undefined)!(area('competence.attention'))).toBe(true);
  });
});
