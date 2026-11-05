import { createHash, randomUUID } from 'node:crypto';
import { refreshUsecases } from '../threads/usecases/refresh';
import { postgresRefreshStore } from '../threads/adapters/refresh-postgres';
import { registry } from '../connectors/registry';
import { systemContext } from '../system-context';
import { calendar } from './calendar';
import { clock } from './ambient';

export const refresh = refreshUsecases({ store: postgresRefreshStore(), clock, ids: randomUUID, key: x => createHash('sha256').update(JSON.stringify(x)).digest('hex'),
  current: id => systemContext(id, 'system:refresh'),
  sources: async p => { await registry.refreshGovernance(); return registry.listFor(p).filter(c => (c.scan || c.id === 'calendar') && registry.governance(c.id).scanEnabled).map(c => c.id); },
  scan: async (p, id) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        id === 'calendar' ? calendar.ensureProposalThread(p).then(() => ({ drafts: [] })) : registry.scanOne(p, id),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Source deadline exceeded')), 10_000); timer.unref(); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  },
});
export function startRefresh() {
  const busy = [false, false, false, false];
  const tick = () => busy.forEach((running, i) => {
    if (running) return; busy[i] = true;
    void refresh.tick().catch(() => console.error('refresh store unavailable')).finally(() => { busy[i] = false; });
  });
  tick(); const timer = setInterval(tick, 2000); timer.unref(); return () => clearInterval(timer);
}
