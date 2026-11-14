import { describe, expect, test } from 'bun:test';
import type { Area, AreaFigure } from '@clew/contracts';
import { LAGE_ON_HEM, hasValue, lageOnHem } from '../src/lage-figures';

/** An area as `/api/areas` gives it, with the figure its connector answered (or none). */
const area = (id: string, figure: Partial<AreaFigure> | null): Area => ({
  id,
  title: id,
  connector: id,
  source: id,
  figure: figure ? { label: id, tone: 'none', ...figure } : null,
  needsYou: 0,
  waiting: 0,
  urgency: null,
  standing: [],
  schedules: [],
});
const ids = (areas: readonly Area[]) => areas.map(a => a.id);

describe('Läget on Hem (D126)', () => {
  test('only a figure with a value from a source that answered is shown', () => {
    expect(hasValue(area('a', { value: '6,2 %', tone: 'warn' }))).toBe(true);
    expect(hasValue(area('b', { label: 'Inget nytt sedan i går' }))).toBe(false);
    expect(hasValue(area('c', { value: '3', unavailable: true }))).toBe(false);
    expect(hasValue(area('d', null))).toBe(false);
  });

  test('worst status first, the areas’ own order within a status', () => {
    const { shown } = lageOnHem([
      area('lugn1', { value: '1', tone: 'ok' }),
      area('bevaka1', { value: '2', tone: 'warn' }),
      area('ingen', { value: '3', tone: 'none' }),
      area('behover', { value: '4', tone: 'alert' }),
      area('bevaka2', { value: '5', tone: 'warn' }),
    ]);
    expect(ids(shown)).toEqual(['behover', 'bevaka1', 'bevaka2', 'lugn1']);
  });

  test('at most four in one row, and the total counts every figure the unit’s page lists', () => {
    const areas = [
      ...['a', 'b', 'c', 'd', 'e'].map(id => area(id, { value: '1', tone: 'ok' })),
      area('tom', { label: 'Inga pass i dag' }),
      area('tyst', { value: '2', tone: 'alert', unavailable: true }),
      area('ingen-siffra', null),
    ];
    const { shown, total } = lageOnHem(areas);
    expect(LAGE_ON_HEM).toBe(4);
    expect(ids(shown)).toEqual(['a', 'b', 'c', 'd']);
    // The empty and the silent figure are on the unit's page; an area that answered no figure is not.
    expect(total).toBe(7);
  });

  test('fewer figures than the row holds are all shown, and none gives an empty row', () => {
    expect(ids(lageOnHem([area('a', { value: '1', tone: 'warn' })]).shown)).toEqual(['a']);
    expect(lageOnHem([area('tom', { label: 'Inget nytt' })])).toEqual({ shown: [], total: 1 });
    expect(lageOnHem([])).toEqual({ shown: [], total: 0 });
  });
});
