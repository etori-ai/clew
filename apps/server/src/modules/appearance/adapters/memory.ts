import { EMPTY_APPEARANCE, type AppearanceAuditEntry, type AppearanceRecord, type AppearanceStore } from '../ports';

/**
 * The appearance store in memory (D25, D98): the unit tests' adapter, held to Postgres by
 * `tests/appearance-store-contract.ts`. A transaction is a snapshot; a throw rolls the record and its audit row back.
 */
export interface MemoryAppearanceStore extends AppearanceStore {
  audit: AppearanceAuditEntry[];
}
export function memoryAppearanceStore(): MemoryAppearanceStore {
  let record: AppearanceRecord = EMPTY_APPEARANCE;
  let queue: Promise<unknown> = Promise.resolve();
  const self: MemoryAppearanceStore = {
    audit: [],
    async read() {
      return structuredClone(record);
    },
    transaction(fn) {
      // One at a time, as the row lock gives in Postgres.
      const run = queue.then(async () => {
        const before = { record, audit: self.audit.length };
        try {
          return await fn({
            read: async () => structuredClone(record),
            write: async next => {
              record = structuredClone(next);
            },
            audit: async entry => {
              self.audit.push(structuredClone(entry));
            },
          });
        } catch (error) {
          record = before.record;
          self.audit.length = before.audit;
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return self;
}
