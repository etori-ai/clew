import { expect, spyOn, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src';
import { Registry, openGovernance, type ScanObservation } from '../../packages/connectors/src';
import {
  SOURCE_DEADLINE_MS,
  scanSources,
  type CalendarScan,
} from '../../apps/server/src/threads/usecases/scan-sources';

/**
 * Which sources a person's scan reads and how (`threads/usecases/scan-sources.ts`), as `composition/refresh.ts` and
 * `tests/refresh-scan.ts` both bind it: the connectors the person sees whose scan is on, the calendar among them, the
 * calendar's own part (the planner's card, the invitations read back without waiting), the token of the session that
 * asked, and the deadline of one source.
 */
const persona = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  role: 'manager',
  unitId: 'unit',
  unitLabel: 'Enheten',
  authorizationVersion: 'v1',
  async authorize() {},
} as unknown as AuthenticatedContext;
const observed: ScanObservation = { drafts: [] };

function world(calendar: Partial<CalendarScan> = {}, deadlineMs?: number) {
  const registry = new Registry()
    .register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] })
    .register({
      id: 'finance',
      kind: 'passthrough',
      source: 'Ekonomisystemet',
      areas: [],
      capabilities: [],
      scan: async () => [],
    })
    .register({ id: 'phonebook', kind: 'passthrough', source: 'Telefonboken', areas: [], capabilities: [] })
    .govern('calendar', openGovernance())
    .govern('finance', openGovernance())
    .govern('phonebook', openGovernance());
  const calls = {
    refreshed: 0,
    scanned: [] as Array<{ id: string; context: unknown }>,
    planned: [] as string[],
    followed: [] as string[],
  };
  const lines: Array<{ scope: string; message: string; details: unknown[] }> = [];
  let scanOne: (id: string) => Promise<ScanObservation> = async () => observed;
  const sources = scanSources({
    registry: {
      listFor: actor => registry.listFor(actor),
      governance: id => registry.governance(id),
      connector: id => registry.connector(id),
      refreshGovernance: async () => {
        calls.refreshed++;
      },
      scanOne: async (_actor, id, context) => {
        calls.scanned.push({ id, context });
        return scanOne(id);
      },
    },
    calendar: {
      ensureProposalThread: async p => {
        calls.planned.push(p.id);
      },
      follow: async p => {
        calls.followed.push(p.id);
        return 0;
      },
      ...calendar,
    },
    log: (scope, message, ...details) => lines.push({ scope, message, details }),
    ...(deadlineMs ? { deadlineMs } : {}),
  });
  return {
    registry,
    sources,
    calls,
    lines,
    answer: (fn: typeof scanOne) => {
      scanOne = fn;
    },
  };
}

test('the sources are the connectors the person sees whose scan is on, the calendar among them, read after the administrator’s decisions', async () => {
  const w = world();
  expect(await w.sources.sources(persona)).toEqual(['calendar', 'finance']);
  expect(w.calls.refreshed).toBe(1);
  // The calendar's scan switched off: it is no source, so its planner is never called.
  w.registry.govern('calendar', { ...openGovernance(), scanEnabled: false });
  w.registry.govern('finance', { ...openGovernance(), scanEnabled: false });
  expect(await w.sources.sources(persona)).toEqual([]);
  w.registry.govern('finance', { ...openGovernance(), state: 'disabled' });
  w.registry.govern('calendar', openGovernance());
  expect(await w.sources.sources(persona)).toEqual(['calendar']);
  expect(w.calls.planned).toEqual([]);
  expect(w.sources.system('finance')).toBe('Ekonomisystemet');
  expect(w.sources.system('gone')).toBe('gone');
});

test('the calendar’s scan keeps the planner’s card in step once, returns no drafts, and reads the invitations back without waiting', async () => {
  let release!: () => void;
  const w = world({
    follow: async p => {
      w.calls.followed.push(p.id);
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return 1;
    },
  });
  // The reading back never answers: the scan still ends, at once.
  expect(await w.sources.scan(persona, 'calendar')).toEqual({ drafts: [] });
  expect(w.calls.planned).toEqual(['hillevi']);
  expect(w.calls.followed).toEqual(['hillevi']);
  expect(w.calls.scanned).toEqual([]);
  release();
  expect(w.lines).toEqual([]);
});

test('a reading back that fails is logged in the calendar’s scope, and the scan has answered already', async () => {
  const failure = new Error('CalDAV unavailable');
  const w = world({ follow: async () => Promise.reject(failure) });
  expect(await w.sources.scan(persona, 'calendar')).toEqual({ drafts: [] });
  await Bun.sleep(0);
  expect(w.lines).toEqual([{ scope: 'calendar', message: 'invitations could not be read back', details: [failure] }]);
});

test('a planner that fails fails the calendar’s scan, and nothing is read back', async () => {
  const w = world({
    ensureProposalThread: async () => {
      throw new Error('round unreadable');
    },
  });
  await expect(w.sources.scan(persona, 'calendar')).rejects.toThrow('round unreadable');
  expect(w.calls.followed).toEqual([]);
});

test('a connector is scanned through the registry with the token of the session that asked, and without one when none did', async () => {
  const w = world();
  const delegate = async () => 'token';
  expect(await w.sources.scan({ ...persona, delegate } as AuthenticatedContext, 'finance')).toBe(observed);
  expect(await w.sources.scan(persona, 'finance')).toBe(observed);
  expect(w.calls.scanned).toEqual([
    { id: 'finance', context: { delegate } },
    { id: 'finance', context: {} },
  ]);
  expect(w.calls.planned).toEqual([]);
});

test('a source that does not answer within its deadline counts as not answering', async () => {
  const w = world({}, 20);
  w.answer(() => new Promise<never>(() => {}));
  await expect(w.sources.scan(persona, 'finance')).rejects.toThrow('Source deadline exceeded');
  // The calendar's planner is held to the same deadline.
  const slow = world({ ensureProposalThread: () => new Promise<never>(() => {}) }, 20);
  await expect(slow.sources.scan(persona, 'calendar')).rejects.toThrow('Source deadline exceeded');
});

test('the deadline is ten seconds unless a test shortens it, and an answer before it leaves no timer behind', async () => {
  expect(SOURCE_DEADLINE_MS).toBe(10_000);
  const timers = spyOn(globalThis, 'setTimeout');
  const cleared = spyOn(globalThis, 'clearTimeout');
  try {
    const w = world();
    await w.sources.scan(persona, 'finance');
    expect(timers.mock.calls.map(c => c[1])).toEqual([SOURCE_DEADLINE_MS]);
    expect(cleared).toHaveBeenCalledTimes(1);
  } finally {
    timers.mockRestore();
    cleared.mockRestore();
  }
});
