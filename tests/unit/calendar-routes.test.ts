import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryCalendar, occurrence } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { calendarRoutes } from '../../apps/server/src/routes/calendar';

/**
 * Kalender's week as the API serves it (`GET /api/calendar`), over the calendar module's own use case on memory
 * adapters: a date that is not a day of the calendar is refused with the words the page shows, never read as another
 * day (the review of batch 14, item 16).
 */
const hillevi: AuthenticatedContext = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
  organisationId: 'sundsvall',
  principal: { id: 'person:hillevi', kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
};
const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };

function stack() {
  const calendar = memoryCalendar(account, [
    occurrence(
      {
        uid: 'rektorsmote',
        title: 'Rektorsmöte',
        start: localInstant('2026-11-05T10:00'),
        end: localInstant('2026-11-05T11:00'),
      },
      account,
    ),
  ]);
  let listed = 0;
  const list = calendar.list.bind(calendar);
  calendar.list = (from, to) => {
    listed++;
    return list(from, to);
  };
  let n = 0;
  const { weekOverview } = calendarUsecases({
    store: memoryProposalStore(),
    bind: () => ({ provider: calendar }),
    team: async () => [],
    round: async () => null,
    clock: () => new Date('2026-11-04T07:00:00.000Z'),
    ids: () => `id-${++n}`,
    people: { personaFor: async () => hillevi },
    notify: async () => undefined,
    obligations: memoryObligations(),
  });
  const routes = calendarRoutes({
    weekOverview,
    guard: async (c, next) => {
      c.set('session', { context: hillevi } as never);
      await next();
    },
  });
  return { ask: (query: string) => routes.request('http://clew.test/' + query), listed: () => listed };
}

describe('Kalender’s week, `GET /api/calendar`', () => {
  test('answers the week that holds the date asked for', async () => {
    const { ask } = stack();
    const response = await ask('?from=2026-11-05');
    expect(response.status).toBe(200);
    const week = await response.json();
    expect(week.from).toBe('2026-11-02');
    expect(week.events.map((e: { title: string }) => e.title)).toEqual(['Rektorsmöte']);
  });

  test('a date that is not a day of the calendar is refused in Swedish, and no calendar is read for it', async () => {
    const { ask, listed } = stack();
    for (const from of ['2026-02-30', '2026-13-01', 'igår']) {
      const response = await ask('?from=' + from);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Ogiltigt datum.' });
    }
    expect(listed()).toBe(0);
  });
});
