import type { ProvisionStore, ProvisionTx } from '../apps/server/src/modules/people/ports';

/**
 * The provisioning store as PostgreSQL treats a NUL: a call of the transaction that is handed a string holding one,
 * anywhere in its arguments, fails, as PostgreSQL refuses to compare one. Over the memory store it shows that a use
 * case answers such a value as naming nothing and never hands it on; `tests/db/postgres-users-admin.test.ts` shows
 * the same on PostgreSQL.
 */
export function refusingNul(store: ProvisionStore): ProvisionStore {
  const holdsNul = (value: unknown): boolean =>
    typeof value === 'string'
      ? value.includes('\u0000')
      : Array.isArray(value)
        ? value.some(holdsNul)
        : typeof value === 'object' && value !== null && Object.values(value).some(holdsNul);
  return {
    transaction: fn =>
      store.transaction(tx =>
        fn(
          new Proxy(tx, {
            get(target, key) {
              const member: unknown = Reflect.get(target, key);
              if (typeof member !== 'function') return member;
              return (...args: unknown[]) => {
                if (args.some(holdsNul)) throw new Error('invalid byte sequence for encoding "UTF8": 0x00');
                return (member as (...values: unknown[]) => unknown).apply(target, args);
              };
            },
          }) as ProvisionTx,
        ),
      ),
  };
}
