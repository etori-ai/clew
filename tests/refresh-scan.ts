import { createHash } from 'node:crypto';
import type { AuthenticatedContext } from '../packages/contracts/src/index';
import type { Registry } from '../packages/connectors/src/index';
import type { MemoryThreadStore } from '../apps/server/src/threads/adapters/memory';
import { memoryRefreshStore } from '../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../apps/server/src/threads/usecases/refresh';
import { scanSources, type CalendarScan } from '../apps/server/src/threads/usecases/scan-sources';
import type { PersonKeys } from '../apps/server/src/threads/model';

/** A calendar that plans nothing and reads nothing back, for a world whose registry has no calendar to scan. */
const noCalendar: CalendarScan = { ensureProposalThread: async () => undefined, follow: async () => 0 };
/**
 * A person's scan as the server runs it (`composition/refresh.ts`): a refresh request for every source the person sees
 * whose scan is switched on, then every request that is due is run, over the world's own memory thread store. Which
 * sources and how each is read is the server's own factory (`scanSources`), the calendar's part included. The person
 * is read back as they were last asked for, as `systemContext` reads them now. A second scan within a minute of the last
 * is no new request (`requestChange`), so a test that wants the source read again moves its clock on first.
 */
export function refreshScan(deps: {
  store: MemoryThreadStore;
  registry: Pick<Registry, 'listFor' | 'governance' | 'scanOne' | 'connector' | 'refreshGovernance'>;
  clock: () => Date;
  /** Whose a source's key is (D122). */
  people?: PersonKeys;
  /** The calendar's part of the scan, where the world's registry lists the calendar. */
  calendar?: CalendarScan;
}) {
  const { store, registry, clock, people, calendar = noCalendar } = deps;
  const personas = new Map<string, AuthenticatedContext>();
  let n = 0;
  const refresh = refreshUsecases({
    store: memoryRefreshStore(store),
    clock,
    ids: () => `scanned-${++n}`,
    key: x => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
    current: async id => personas.get(id),
    ...scanSources({
      registry,
      calendar,
      log: (scope, message, ...details) => {
        throw new Error(`Unexpected ${scope} failure in a test scan: ${message} ${String(details[0])}`);
      },
    }),
    ...(people ? { people } : {}),
  });
  return async (persona: AuthenticatedContext) => {
    personas.set(persona.id, persona);
    await refresh.request(persona);
    while (await refresh.tick());
  };
}
