import { createHash, randomUUID } from 'node:crypto';
import { refreshUsecases } from '../threads/usecases/refresh';
import { scanSources } from '../threads/usecases/scan-sources';
import { postgresRefreshStore } from '../threads/adapters/refresh-postgres';
import { registry } from '../connectors/registry';
import { systemContext } from '../system-context';
import { calendar, invitations } from './calendar';
import { clock } from './ambient';
import { ledger } from './durable';
import { cancelDurable } from '../dbos/start';
import { logger, logPort } from '../logging';
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
  // Which sources a scan reads and how, the calendar's part with them: the same factory the unit suites bind.
  ...scanSources({
    registry,
    calendar: { ensureProposalThread: p => calendar.ensureProposalThread(p), follow: p => invitations.follow(p) },
    log: (scope, message, ...details) => logPort(scope, 'error')(message, ...details),
  }),
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
