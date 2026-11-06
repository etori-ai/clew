import { describe, expect, test } from 'bun:test';
import { Registry, menuEligible, openGovernance, viewProblem, type Actor } from '../../packages/connectors/src/index';
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
  calendarConnector({ readToday: never, weekView: never, samtalStatus: never }, { dayView: never, listRooms: never });

describe('the calendar connector declares what the fixtures declare', () => {
  test('every read has an output schema with properties, and only the rooms declare a view', () => {
    const reads = connector().capabilities.filter(c => c.kind === 'read');
    expect(reads.map(c => c.name)).toEqual(['calendar.today', 'calendar.week', 'calendar.day', 'calendar.rooms']);
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
});
