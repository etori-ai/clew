import { createHash, randomUUID } from 'node:crypto';
import { refreshUsecases } from '../threads/usecases/refresh';
import { postgresRefreshStore } from '../threads/adapters/refresh-postgres';
import { registry } from '../connectors/registry';
import { systemContext } from '../system-context';
import { calendar } from './calendar';
import { clock } from './ambient';
import { ledger } from './durable';
import { cancelDurable } from '../dbos/start';
import { logger } from '../logging';
import { standingSession } from '../auth';
import { openSecret, sealSecret } from '../auth-crypto';
import { personKeys } from './person-keys';

export const refresh = refreshUsecases({
  store: postgresRefreshStore({
    durable: ledger,
    cancel: cancelDurable,
    sealer: { seal: sealSecret, open: openSecret },
  }),
  clock,
  ids: randomUUID,
  key: x => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
  current: id => systemContext(id, 'system:refresh'),
  // The person's own session that asked for a refresh, while it is active (D26): what a delegated connector's scan runs with.
  session: standingSession,
  // A row names a person by user name; the card keeps their id (D122).
  people: personKeys,
  sources: async p => {
    await registry.refreshGovernance();
    return registry
      .listFor(p)
      .filter(c => (c.scan || c.id === 'calendar') && registry.governance(c.id).scanEnabled)
      .map(c => c.id);
  },
  system: id => registry.connector(id)?.source ?? id,
  scan: async (p, id) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        id === 'calendar'
          ? calendar.ensureProposalThread(p).then(() => ({ drafts: [] }))
          : registry.scanOne(p, id, p.delegate ? { delegate: p.delegate } : {}),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Source deadline exceeded')), 10_000);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
});
export function startRefresh() {
  const busy = [false, false, false, false];
  const tick = () =>
    busy.forEach((running, i) => {
      if (running) return;
      busy[i] = true;
      void refresh
        .tick()
        .catch(error => logger.error({ scope: 'refresh', error }, 'refresh store unavailable'))
        .finally(() => {
          busy[i] = false;
        });
    });
  tick();
  const timer = setInterval(tick, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
