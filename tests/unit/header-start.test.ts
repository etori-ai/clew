import { describe, expect, test } from 'bun:test';
import { clewsStart, withClewsStart } from '../../apps/server/src/connectors/header-start';

/**
 * Start and the row under it are Clew's (D116): the rail's top places, Personal for a manager, first among the header
 * connector's places, and the connector's own Start left out with its pages.
 */
describe("Clew's Start in the shared header", () => {
  test("the row under Start is the rail's top places, Personal and Dialogstöd for a manager only", () => {
    expect(clewsStart('employee')).toEqual({
      id: 'start',
      label: 'Start',
      href: '/',
      children: [
        { id: 'hem', label: 'Hem', href: '/' },
        { id: 'att-gora', label: 'Att göra', href: '/todo' },
        { id: 'kalender', label: 'Kalender', href: '/calendar' },
      ],
    });
    // Dialogstöd is `/units`, the units a manager follows up side by side (D117); an employee has none.
    expect(clewsStart('manager').children?.map(c => [c.label, c.href])).toEqual([
      ['Hem', '/'],
      ['Att göra', '/todo'],
      ['Kalender', '/calendar'],
      ['Personal', '/staff'],
      ['Dialogstöd', '/units'],
    ]);
    expect(clewsStart('employee').children?.map(c => c.id)).not.toContain('dialogstod');
  });

  test("Clew's Start comes first, and the connector's own Start, by its id or Clew's root, is left out with its pages", () => {
    const places = [
      {
        id: 'start',
        label: 'Start',
        href: '/',
        children: [{ id: 'nytt', label: 'Nytt utvecklingsärende', href: '/intranat/flode/utvecklingsarende' }],
      },
      { id: 'hem', label: 'Hem', href: '/' },
      { id: 'organisation', label: 'Organisation', href: 'https://intranat.example.se/organisation' },
      { id: 'service', label: 'Service', href: '/intranat/service' },
    ];
    const items = withClewsStart(places, clewsStart('employee'));
    expect(items.map(i => i.id)).toEqual(['start', 'organisation', 'service']);
    expect(items[0]).toEqual(clewsStart('employee'));
    // A connector without a Start of its own gets Clew's first all the same.
    expect(withClewsStart(places.slice(2), clewsStart('manager')).map(i => i.id)).toEqual([
      'start',
      'organisation',
      'service',
    ]);
  });
});
