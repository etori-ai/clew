import type { FollowBinding } from '../contracts';
import type { BindingAudit, FollowBindingStore } from '../model';

export function memoryFollowBindingStore() {
  let bindings = new Map<string, FollowBinding>(), audit: BindingAudit[] = [];
  let tail = Promise.resolve();
  const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };
  const store: FollowBindingStore = {
    async list(kind) { return structuredClone([...bindings.values()].filter(b => !kind || b.kind === kind).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))); },
    async read(id) { return structuredClone(bindings.get(id)); },
    transaction: fn => serialized(async () => {
      const b = structuredClone(bindings), a = structuredClone(audit);
      const result = await fn({
        async upsert(binding) { b.set(binding.id, structuredClone(binding)); },
        async remove(id) { b.delete(id); },
        async audit(entry) { a.push(structuredClone(entry)); },
      });
      bindings = b; audit = a; return result;
    }),
  };
  return Object.assign(store, { audit: () => structuredClone(audit) });
}
