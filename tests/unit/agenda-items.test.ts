import { describe, expect, test } from 'bun:test';
import type { CalendarEvent, Proposal } from '../../packages/contracts/src/index';
import { CHOSEN_ID, LONGEST_GAP, PROPOSAL_MARK, agendaItems, duration } from '../../packages/ui/src/agenda-items';

/**
 * The calendar family's one mapping (D32) as artboard 6 of D71 draws it: a meeting is neutral with its length and
 * place, a drawn proposal carries the assistant's ✦, and I dag's free gaps are rows with the longest one's promise.
 */
const event = (id: string, title: string, start: string, end: string, room = ''): CalendarEvent => ({
  id,
  title,
  start,
  end,
  allDay: false,
  mine: true,
  room,
  participants: [],
  ref: `ref-${id}`,
  revision: '1',
  canCancel: true,
  recurring: false,
  organizer: 'Hillevi',
});
const proposal = (id: string, status: Proposal['status'], start: string, end: string): Proposal => ({
  id,
  threadId: 'samtal',
  status,
  start,
  end,
  participant: { name: 'Hassan Ali', email: 'hassan@clew.test' },
  eventRef: null,
  undoUntil: null,
  reminders: 0,
  remindedAt: null,
});

describe('agendaItems', () => {
  test('a meeting is a neutral entry whose meta line is its length and its place', () => {
    const [item] = agendaItems(
      [event('e1', 'Morgonmöte ledningsgrupp', '2026-11-03T07:15:00Z', '2026-11-03T07:45:00Z', 'Personalrummet')],
      [],
    );
    expect(item).toMatchObject({ kind: 'event', place: 'Personalrummet', meta: '30 min\u00a0· Personalrummet' });
    expect(item!.marker).toBeUndefined();
  });
  test('a drawn proposal carries the assistant mark; a confirmed one is a booked meeting without it', () => {
    const items = agendaItems(
      [],
      [
        proposal('p1', 'proposed', '2026-11-10T09:00:00Z', '2026-11-10T10:00:00Z'),
        proposal('p2', 'confirmed', '2026-11-12T10:00:00Z', '2026-11-12T11:00:00Z'),
      ],
    );
    expect(items[0]).toMatchObject({ kind: 'proposal', marker: PROPOSAL_MARK, meta: '1 tim\u00a0· Hassan Ali' });
    expect(items[1]).toMatchObject({ kind: 'booked' });
    expect(items[1]!.marker).toBeUndefined();
    expect(PROPOSAL_MARK).toBe('✦');
  });
  test('the day’s gaps are rows, and only the longest says that nothing is booked there without asking', () => {
    const items = agendaItems(
      [],
      [],
      [
        { start: '2026-11-04T07:45:00Z', end: '2026-11-04T08:30:00Z' },
        { start: '2026-11-04T10:00:00Z', end: '2026-11-04T16:00:00Z' },
      ],
    );
    expect(items.map(i => i.kind)).toEqual(['gap', 'gap']);
    expect(items[0]).toMatchObject({ title: 'Ledigt till 09:30' });
    expect(items[0]!.meta).toBeUndefined();
    expect(items[1]).toMatchObject({ title: 'Ledigt till 17:00', meta: LONGEST_GAP });
  });
  test('the time a person is choosing in the action dialog is their proposal, without the assistant mark (D112)', () => {
    const items = agendaItems([event('e1', 'APT', '2026-11-05T14:00:00Z', '2026-11-05T15:30:00Z')], [], [], {
      start: '2026-11-05T12:15:00Z',
      end: '2026-11-05T13:00:00Z',
      title: 'Vald tid',
    });
    expect(items.map(i => i.kind)).toEqual(['event', 'proposal']);
    expect(items[1]).toMatchObject({ id: CHOSEN_ID, title: 'Vald tid', meta: '45 min', allDay: false });
    expect(items[1]!.marker).toBeUndefined();
  });
  test('no gaps unless they are given: the grid and the week agenda draw none', () => {
    expect(agendaItems([event('e1', 'Möte', '2026-11-04T08:00:00Z', '2026-11-04T09:00:00Z')], [])).toHaveLength(1);
  });
  test('the length is written as the rows write it', () => {
    const at = (m: number) => ({
      start: '2026-11-04T08:00:00Z',
      end: new Date(Date.parse('2026-11-04T08:00:00Z') + m * 60000).toISOString(),
    });
    expect([30, 60, 90].map(m => duration(at(m)))).toEqual(['30 min', '1 tim', '1,5 tim']);
  });
});
