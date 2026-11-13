import { describe, expect, test } from 'bun:test';
import type { AreaFigure } from '../../packages/contracts/src/index';
import { figureItems, retryWhen, worstWord, type FigureMark } from '../../packages/ui/src/figure-items';

// 09:00 in Stockholm: the day's review has run, the next bundle is at 12:00.
const NOW = '2026-11-04T08:00:00.000Z';
const personal: FigureMark = { title: 'Personal', icon: 'people', ordinal: 1, source: 'Personalsystemet' };
const absence: AreaFigure = {
  label: 'Sjukfrånvaro',
  value: '4,2 %',
  comparison: 'mål ≤ 4,0 % · +0,3 sedan oktober',
  tone: 'warn',
  opens: { capability: 'hr.absenceOverview', title: 'Frånvaro per person' },
  observedAt: '2026-11-04T05:00:00.000Z',
};

describe('figureItems (D54, artboard 3)', () => {
  test('a figure with a value: the tile with the tone in Clew’s words and its link, the line with the source and time, the word', () => {
    const { tile, line, word } = figureItems(absence, personal, { now: NOW });
    expect(tile).toEqual({
      kind: 'value',
      mark: personal,
      tone: { variant: 'warning', word: 'Bevaka' },
      alert: false,
      label: 'Sjukfrånvaro',
      value: '4,2 %',
      comparison: 'mål ≤ 4,0 % · +0,3 sedan oktober',
      opens: { capability: 'hr.absenceOverview', title: 'Frånvaro per person' },
      name: 'Personal: Sjukfrånvaro 4,2 %, bevaka. Öppnar Frånvaro per person',
    });
    expect(line).toEqual({
      icon: 'people',
      label: 'Sjukfrånvaro',
      value: '4,2 %',
      tone: { variant: 'warning', word: 'Bevaka' },
      // The source follows what the source sent after a dot whose space does not break (D121 item 8).
      rest: 'mål ≤ 4,0 % · +0,3 sedan oktober\u00a0· Personalsystemet 06:00',
    });
    expect(word).toEqual({ variant: 'warning', word: 'Bevaka' });
  });
  test('ok is Lugnt, alert is Behöver dig with the red tile, none has no tone at all', () => {
    expect(figureItems({ ...absence, tone: 'ok' }, personal, { now: NOW }).tile.tone?.word).toBe('Lugnt');
    const alert = figureItems({ ...absence, tone: 'alert' }, personal, { now: NOW }).tile;
    expect(alert).toMatchObject({ alert: true, tone: { variant: 'error', word: 'Behöver dig' } });
    expect(alert.name).toBe('Personal: Sjukfrånvaro 4,2 %, behöver dig. Öppnar Frånvaro per person');
    const none = figureItems({ label: 'Utvecklingssamtal bokade', value: '14 av 23', tone: 'none' }, personal, {
      now: NOW,
    });
    expect(none.tile).toMatchObject({ tone: null, alert: false, name: 'Personal: Utvecklingssamtal bokade 14 av 23' });
    expect(none.word).toBeNull();
  });
  test('progress is a bar in place of the comparison, named with both', () => {
    const { tile } = figureItems(
      {
        label: 'Förbrukat av ramen',
        value: '98 %',
        comparison: 'av periodens ram',
        progress: { value: 98, max: 100 },
        tone: 'ok',
      },
      personal,
      { now: NOW },
    );
    expect(tile.progress).toEqual({ value: 98, max: 100, label: 'Förbrukat av ramen: 98 %, av periodens ram' });
    expect(tile.comparison).toBeUndefined();
  });
  test('a figure without a value is a sentence and never a link', () => {
    const { tile } = figureItems(
      { label: 'Inget nytt sedan i går.', tone: 'none', opens: absence.opens },
      { ...personal, title: 'Viktigt nu' },
      { now: NOW },
    );
    expect(tile).toEqual({
      kind: 'sentence',
      mark: { ...personal, title: 'Viktigt nu' },
      tone: null,
      alert: false,
      label: 'Inget nytt sedan i går.',
      name: 'Viktigt nu: Inget nytt sedan i går.',
    });
  });
  test('a silent source is the warning tile: when it was last read and when Clew tries again', () => {
    const silent: AreaFigure = { label: 'Personalsystemet svarar inte.', tone: 'warn', unavailable: true };
    const { tile, word } = figureItems(silent, personal, { now: NOW, lastRead: '2026-11-04T05:00:00.000Z' });
    expect(tile).toMatchObject({
      kind: 'silent',
      tone: null,
      label: 'Personalsystemet svarar inte.',
      comparison: 'Senast läst 06:00\u00a0· försöker igen 12:00',
      name: 'Personal: Personalsystemet svarar inte',
    });
    expect(tile.opens).toBeUndefined();
    expect(word?.word).toBe('Bevaka');
    expect(figureItems(silent, personal, { now: NOW }).tile.comparison).toBe('Försöker igen 12:00');
    // After the last bundle the next try is tomorrow's review.
    expect(retryWhen('2026-11-04T17:00:00.000Z')).toBe('i morgon 06:00');
  });
  test('the rail’s word is the worst tone among the figures, lower case; none or no figure is no word', () => {
    expect(worstWord([null, { label: 'a', tone: 'none' }])).toBeNull();
    expect(worstWord([{ label: 'a', value: '1', tone: 'ok' }, null])).toEqual({ variant: 'success', word: 'lugnt' });
    expect(
      worstWord([
        { label: 'a', tone: 'ok' },
        { label: 'b', tone: 'warn', unavailable: true },
      ]),
    ).toEqual({
      variant: 'warning',
      word: 'bevaka',
    });
    expect(
      worstWord([
        { label: 'a', tone: 'warn' },
        { label: 'b', tone: 'alert' },
      ]),
    ).toEqual({
      variant: 'error',
      word: 'behöver dig',
    });
  });
});
