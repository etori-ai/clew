import { describe, expect, test } from 'bun:test';
import type { AboutResult, View } from '@clew/contracts';
import { marksFor, unanswered } from '../src/about';

/** What the sources say about the people on a list (D97 items 2 and 5): which rows get a mark and what it opens. */
const view: View = {
  kind: 'list',
  title: 'status',
  fields: [
    { key: 'status', label: 'Status', format: 'status', tones: { expired: 'alert', expiring: 'warn' } },
    { key: 'expired', label: 'Har gått ut', format: 'number' },
  ],
  open: { capability: 'competence.holdings', title: 'Kompetenser', params: { person: 'person' } },
};
const section = (extra: Partial<AboutResult['sections'][number]> = {}): AboutResult['sections'][number] => ({
  connector: 'competence',
  source: 'Kompetens',
  capability: 'competence.standing',
  title: 'Kompetens',
  view,
  status: 'ok',
  rows: [
    { key: 'anna', person: 'anna.lindqvist', status: 'expired', expired: 1 },
    { key: 'erik', person: 'erik.nystrom', status: 'expiring', expired: 0 },
    { key: 'lena', person: 'lena.berg', status: 'valid', expired: 0 },
  ],
  ...extra,
});
const result = (...sections: AboutResult['sections']): AboutResult => ({ kind: 'person', sections });

describe('marks on a row (D97 item 2)', () => {
  test('a status the source gives a tone is a mark with its word, and opens the source’s view of that person', () => {
    expect(marksFor(result(section()), 'anna')).toEqual([
      {
        id: 'competence.standing:status',
        title: 'Kompetens',
        word: 'utgånget',
        tone: 'alert',
        view: {
          capability: 'competence.holdings',
          input: { person: 'anna.lindqvist' },
          title: 'Kompetenser',
          source: 'Kompetens',
        },
      },
    ]);
    expect(marksFor(result(section()), 'erik').map(m => [m.word, m.tone])).toEqual([['går ut snart', 'warn']]);
  });
  test('a status without a tone, a person without a row and a person nobody answered about have no mark', () => {
    expect(marksFor(result(section()), 'lena')).toEqual([]);
    expect(marksFor(result(section()), 'omar')).toEqual([]);
    expect(marksFor(result(), 'anna')).toEqual([]);
  });
  test('a source that did not answer gives no mark and is named once', () => {
    const r = result(section({ status: 'timeout', rows: [] }), section({ status: 'unavailable', rows: [] }), section());
    expect(marksFor(r, 'anna')).toHaveLength(1);
    expect(unanswered(r)).toEqual(['Kompetens']);
    expect(unanswered(result(section()))).toEqual([]);
  });
  test('a source without a fuller view gives a mark that opens nothing', () => {
    const { open: _open, ...plain } = view as Extract<View, { kind: 'list' }>;
    expect(marksFor(result(section({ view: plain as View })), 'anna')).toEqual([
      { id: 'competence.standing:status', title: 'Kompetens', word: 'utgånget', tone: 'alert' },
    ]);
  });
  test('no answer, a refusal or another shape is no mark and no failure', () => {
    expect(marksFor(null, 'anna')).toEqual([]);
    expect(marksFor(undefined, 'anna')).toEqual([]);
    expect(marksFor({ rows: [] } as never, 'anna')).toEqual([]);
    expect(unanswered({ rows: [] } as never)).toEqual([]);
  });
});
