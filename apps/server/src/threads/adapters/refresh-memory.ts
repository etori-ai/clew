import { projectionVersion, type Occurrence, type RefreshRequest, type RefreshStore } from '../refresh-model';
import { memoryThreadStore } from './memory';

export function memoryRefreshStore(threads = memoryThreadStore()) {
  let requests = new Map<string, RefreshRequest>(), occurrences = new Map<string, Occurrence>();
  const copy = <T>(x: T): T => structuredClone(x);
  const store: RefreshStore = {
    async request(r) { await threads.transaction(async tx => {
      const old = requests.get(r.id);
      if (!old || ['complete', 'failed', 'blocked'].includes(old.state) && old.nextAt <= r.requestedAt) {
        await tx.writeAudit({ actor: `person:${r.personId}`, action: 'refresh.requested', subject: `refresh:${r.id}`, at: r.requestedAt, details: { connector: r.connector, assignment: r.assignment } });
        requests.set(r.id, old ? { ...old, state: 'pending', requestedAt: r.requestedAt, nextAt: r.nextAt } : copy(r));
      }
    }); },
    async claim(at, until) { return threads.transaction(async () => {
      const r = [...requests.values()].sort((a,b) => a.nextAt.localeCompare(b.nextAt)).find(r => ['pending', 'complete', 'failed', 'running'].includes(r.state) && r.nextAt <= at && (!r.leaseUntil || r.leaseUntil <= at));
      if (!r) return undefined; const claimed = { ...r, state: 'running', attempt: r.attempt + 1, leaseUntil: until }; requests.set(r.id, claimed); return copy(claimed);
    }); },
    async baseline(r) { return Object.fromEntries(threads.dump().filter(x => x.personId === r.personId && x.thread.connector === r.connector).map(x => [x.thread.id, projectionVersion(x.thread)])); },
    async statuses(personId) { return copy([...requests.values()].filter(r => r.personId === personId)); },
    transaction: fn => threads.transaction(async tx => {
      const r = copy(requests), o = copy(occurrences);
      const result = await fn({ ...tx,
        async lockRequest(id) { return copy(r.get(id)); }, async saveRequest(value) { r.set(value.id, copy(value)); },
        async occurrences(job) { return copy([...o.values()].filter(x => x.personId === job.personId && x.connector === job.connector && x.assignment === job.assignment)); },
        async saveOccurrence(value) { o.set(value.id, copy(value)); },
        async findTopic(personId, connector, topic) { return threads.dump().filter(x => x.personId === personId && x.thread.connector === connector && x.thread.topic === topic).sort((a,b) => b.thread.createdAt.localeCompare(a.thread.createdAt))[0]?.thread; },
      }); requests = r; occurrences = o; return result;
    }),
  };
  return Object.assign(store, { threads, dump: () => copy([...occurrences.values()]) });
}
