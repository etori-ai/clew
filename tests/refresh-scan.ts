import { createHash } from 'node:crypto';
import type { AuthenticatedContext } from '../packages/contracts/src/index';
import { audiencedActorOf, type Registry } from '../packages/connectors/src/index';
import type { MemoryThreadStore } from '../apps/server/src/threads/adapters/memory';
import { memoryRefreshStore } from '../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../apps/server/src/threads/usecases/refresh';
import type { PersonKeys } from '../apps/server/src/threads/model';

/**
 * A person's scan as the server runs it (`composition/refresh.ts`): a refresh request for every source the person sees
 * whose scan is switched on, then every request that is due is run, over the world's own memory thread store. The person
 * is read back as they were last asked for, as `systemContext` reads them now. A second scan within a minute of the last
 * is no new request (`requestChange`), so a test that wants the source read again moves its clock on first.
 */
export function refreshScan(deps: {
  store: MemoryThreadStore;
  registry: Pick<Registry, 'listFor' | 'governance' | 'scanOne' | 'connector'>;
  clock: () => Date;
  /** Whose a source's key is (D122). */
  people?: PersonKeys;
}) {
  const { store, registry, clock, people } = deps;
  const personas = new Map<string, AuthenticatedContext>();
  let n = 0;
  const refresh = refreshUsecases({
    store: memoryRefreshStore(store),
    clock,
    ids: () => `scanned-${++n}`,
    key: x => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
    current: async id => personas.get(id),
    sources: async p =>
      registry
        .listFor(audiencedActorOf(p))
        .filter(c => c.scan && registry.governance(c.id).scanEnabled)
        .map(c => c.id),
    system: id => registry.connector(id)?.source ?? id,
    scan: (p, id) => registry.scanOne(audiencedActorOf(p), id),
    ...(people ? { people } : {}),
  });
  return async (persona: AuthenticatedContext) => {
    personas.set(persona.id, persona);
    await refresh.request(persona);
    while (await refresh.tick());
  };
}
