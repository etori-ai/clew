import { describe, expect, test } from 'bun:test';
import { Registry, menuEligible, openGovernance, viewProblem, type Actor } from '../../packages/connectors/src/index';
import { checkContract } from '../../packages/contracts/src/index';
import { calendarConnector } from '../../apps/server/src/modules/calendar/connector';
import { roomsView } from '../../apps/server/src/modules/calendar/views';

/**
 * The calendar as a connector on par with the fixtures (D69, amended): its reads carry the browser's contracts as
 * output schemas, the rooms declare a view that keeps the rules of D38 and can be a tool in the menu (D40), and the
 * registry hands both over as it does for a vendor's connector. Today, the week and a day declare no view on purpose,
 * since the calendar family draws them (D32).
 */
const mikael: Actor = { id: 'mikael', name: 'Mikael Lund', unitId: 'unit-it', unitLabel: 'IT', role: 'employee' };
const never = () => Promise.reject(new Error('not called'));
const connector = () =>
  calendarConnector({ readToday: never, weekView: never }, { dayView: never, listRooms: never, freeTimes: never });

describe('the calendar connector declares what the fixtures declare', () => {
  test('two areas, neither with a figure: talks held is the talks module’s figure, and the planner’s area keeps its id under its own title (D96)', () => {
    const areas = connector().areas;
    expect(areas.map(a => [a.id, a.title])).toEqual([
      ['calendar', 'Kalender'],
      ['utvecklingssamtal', 'Boka utvecklingssamtal'],
    ]);
    expect(areas.filter(a => a.figure)).toEqual([]);
  });
  test('every read has an output schema with properties, and only the rooms declare a view', () => {
    const reads = connector().capabilities.filter(c => c.kind === 'read');
    expect(reads.map(c => c.name)).toEqual([
      'calendar.today',
      'calendar.week',
      'calendar.day',
      'calendar.freeTimes',
      'calendar.rooms',
    ]);
    for (const read of reads)
      expect(Object.keys((read.output as { properties?: object }).properties ?? {}).length, read.name).toBeGreaterThan(
        0,
      );
    expect(reads.filter(c => c.view).map(c => c.name)).toEqual(['calendar.rooms']);
  });
  test('the rooms view keeps the rules, can be a tool, and the registry takes the connector', () => {
    const all = connector().capabilities;
    const rooms = all.find(c => c.name === 'calendar.rooms')!;
    expect(rooms.view).toBe(roomsView);
    expect(viewProblem(rooms, all)).toBeUndefined();
    expect(menuEligible(rooms)).toBe(true);
    expect(rooms.menu).toEqual({ label: 'Mötesrum', icon: 'people' });
    expect(() => new Registry().register(connector())).not.toThrow();
  });
  test('the registry hands the browser the rooms view with its source, and the row once an administrator has chosen it', () => {
    const registry = new Registry().register(connector());
    registry.govern('calendar', openGovernance());
    expect(registry.viewFor(mikael, 'calendar.rooms')).toEqual({
      ...roomsView,
      capability: 'calendar.rooms',
      connector: 'calendar',
      source: 'Kalendern',
      chip: false,
      // The calendar's rows live in the calendar (`passthrough`, D3): the view says nothing of them is stored in Clew.
      external: true,
    });
    expect(registry.viewFor(mikael, 'calendar.today')).toBeUndefined();
    expect(registry.menu(mikael)).toEqual([]);
    registry.govern('calendar', { ...openGovernance(), capabilities: { 'calendar.rooms': { menu: true } } });
    expect(registry.menu(mikael)).toEqual([
      {
        connector: 'calendar',
        source: 'Kalendern',
        capability: 'calendar.rooms',
        title: 'Mötesrum',
        label: 'Mötesrum',
        icon: 'people',
      },
    ]);
  });
  test("today, a week and a day take the source's own event handles, however long (D112 item 10's day)", () => {
    // The registry checks every answer against the read's declared output; a handle over that output's limit made each
    // of the three refuse a real day ("Källans svar kunde inte verifieras"). As the Nextcloud adapter names an
    // occurrence: the base64 of its CalDAV path, and the recurrence after a colon.
    const path = '/remote.php/dav/calendars/hillevi/personal/clew-fixture-2026-11-12-0-' + 'x'.repeat(60) + '.ics';
    const ref = 'nextcloud:' + Buffer.from(path).toString('base64url');
    const event = {
      id: ref + ':20261112T090000Z',
      title: 'Morgonmöte ledningsgrupp',
      start: '2026-11-12T07:15:00.000Z',
      end: '2026-11-12T07:45:00.000Z',
      allDay: false,
      mine: true,
      room: '',
      participants: [],
      ref,
      revision: '"891cf843c48d346ebb597f6e054518eb"',
      canCancel: true,
      recurring: true,
      organizer: 'Hillevi Berg',
    };
    expect(event.id.length).toBeGreaterThan(150);
    const output = (name: string) =>
      connector().capabilities.find(c => c.name === name)!.output as Parameters<typeof checkContract>[0];
    expect(checkContract(output('calendar.day'), { from: '2026-11-12', events: [event], proposals: [] })).toBe(true);
    expect(checkContract(output('calendar.week'), { from: '2026-11-09', events: [event] })).toBe(true);
    expect(checkContract(output('calendar.today'), { date: '2026-11-12', events: [event], gaps: [] })).toBe(true);
    // Not an open door: an empty handle is still refused.
    expect(
      checkContract(output('calendar.day'), { from: '2026-11-12', events: [{ ...event, id: '' }], proposals: [] }),
    ).toBe(false);
  });
});
