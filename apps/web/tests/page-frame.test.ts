import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { asksBeside, pageOnly, panelSearch, withAsk, withEntry, withoutAsk } from '../src/panel-address';
import { shiftQuery } from '../src/components/shell/page-frame-context';
import { groupThreads, onlyBeside } from '../src/stream';
import { listedAbout } from '../src/conversation-about';

describe('the assistant’s pane is in the address (D141 rule 2)', () => {
  test('opening it keeps the page’s own address and takes the place of an entry', () => {
    expect(withAsk('/tools/clew.requests', '?input=%7B%7D&from=%2F')).toBe(
      '/tools/clew.requests?input=%7B%7D&from=%2F&ask=1',
    );
    expect(withAsk('/calendar', '?date=2026-11-02&view=week&entry=v1')).toBe(
      '/calendar?date=2026-11-02&view=week&ask=1',
    );
    expect(withAsk('/tools/clew.requests', '?ask=1')).toBe('/tools/clew.requests?ask=1');
  });
  test('closing it keeps everything else, and an entry opened takes its place', () => {
    expect(withoutAsk('/calendar', '?date=2026-11-02&ask=1&view=week')).toBe('/calendar?date=2026-11-02&view=week');
    expect(withoutAsk('/tools/clew.requests', '?ask=1')).toBe('/tools/clew.requests');
    expect(withEntry('/calendar', '?date=2026-11-02&ask=1', 'v1')).toBe('/calendar?date=2026-11-02&entry=v1');
  });
  test('only ask=1 opens it', () => {
    expect(asksBeside('?ask=1')).toBe(true);
    expect(asksBeside(new URLSearchParams('date=2026-11-02&ask=1'))).toBe(true);
    expect(asksBeside('?ask=0')).toBe(false);
    expect(asksBeside('')).toBe(false);
  });
  test('a way back and the conversation’s page take nothing of it with them', () => {
    expect(pageOnly('/tools/clew.requests', '?ask=1&input=%7B%7D')).toBe('/tools/clew.requests?input=%7B%7D');
    expect(panelSearch('?ask=1')).toBe('');
  });
});

describe('a breakpoint of the column follows the pane’s width (D141 rule 11, D138 item 4)', () => {
  test('min-width and max-width move by the pane, anything else stays', () => {
    expect(shiftQuery('(min-width: 1280px)', 400)).toBe('(min-width: 1680px)');
    expect(shiftQuery('(max-width: 1024px)', 400)).toBe('(max-width: 1424px)');
    expect(shiftQuery('(min-width: 768px) and (max-height: 480px)', 400)).toBe(
      '(min-width: 1168px) and (max-height: 480px)',
    );
    expect(shiftQuery('(min-width:1010px)', 400)).toBe('(min-width: 1410px)');
  });
  test('with the pane closed the query is the window’s', () => {
    expect(shiftQuery('(min-width: 1280px)', 0)).toBe('(min-width: 1280px)');
    expect(shiftQuery('(min-width: 1280px)', 0, 1280)).toBe('(min-width: 1280px)');
  });
  test('in the shell’s column a width past the column is never reached, however wide the window', () => {
    // The column is 1280 px at most: with 420 px of pane, a page that needs 1010 px of window never gets it.
    expect(shiftQuery('(min-width: 1010px)', 420, 1280)).toBe('(max-width: 0px)');
    expect(shiftQuery('(max-width: 1024px)', 420, 1280)).toBe('(min-width: 0px)');
    // Below the column's width the window still decides.
    expect(shiftQuery('(min-width: 768px)', 420, 1280)).toBe('(min-width: 1188px)');
    expect(shiftQuery('(max-width: 767px)', 420, 1280)).toBe('(max-width: 1187px)');
    expect(shiftQuery('(min-width: 860px)', 420, 1280)).toBe('(min-width: 1280px)');
    expect(shiftQuery('(max-width: 860px)', 420, 1280)).toBe('(min-width: 0px)');
  });
});

describe('a conversation asked beside a page is among Ny fråga’s latest once opened (D141 rule 6, D138 item 10)', () => {
  const NOW = '2026-11-18T10:00:00.000Z';
  const question = (id: string, updatedAt: string, askedBeside?: Thread['askedBeside']): Thread =>
    ({
      id,
      kind: 'question',
      state: 'open',
      title: id,
      updatedAt,
      createdAt: updatedAt,
      messages: [],
      ...(askedBeside ? { askedBeside } : {}),
    }) as unknown as Thread;
  const beside = (openedAt: string | null) => ({ subject: 'view:clew.requests', label: 'Om Beställningar', openedAt });
  const plain = question('vanligt', '2026-11-18T08:00:00.000Z');
  const unopened = question('bredvid', '2026-11-18T09:00:00.000Z', beside(null));
  const opened = question('oppnat', '2026-11-18T07:00:00.000Z', beside('2026-11-18T09:30:00.000Z'));
  test('the latest leave out one never opened; Alla samtal and the search keep every one, newest first', () => {
    const g = groupThreads([plain, unopened, opened], NOW, NOW.slice(0, 10));
    expect(g.questions.map(t => t.id)).toEqual(['vanligt', 'oppnat']);
    expect(g.allQuestions.map(t => t.id)).toEqual(['bredvid', 'vanligt', 'oppnat']);
  });
  test('only a conversation asked beside a page and not opened is left out', () => {
    expect(onlyBeside(unopened)).toBe(true);
    expect(onlyBeside(opened)).toBe(false);
    expect(onlyBeside(plain)).toBe(false);
  });
  test('Alla samtal says what it is about in the page’s words, else what its first question went with', () => {
    expect(listedAbout({ askedBeside: beside(null), messages: [] })).toBe('Beställningar');
    expect(
      listedAbout({
        askedBeside: { subject: 'event:v1', label: 'Om mötet Morgonmöte', openedAt: null },
        messages: [],
      }),
    ).toBe('mötet Morgonmöte');
    expect(listedAbout({ messages: [] })).toBeNull();
  });
});
