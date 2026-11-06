import { and, eq } from 'drizzle-orm';
import { database } from './index';
import { moduleState } from './schema';

/** Key-value state for mock integrations. The interface is what modules see; this is the Postgres implementation. */
export interface StateStore {
  get<T>(module: string, key: string, fallback: T): Promise<T>;
  set(module: string, key: string, value: unknown): Promise<void>;
}
export const postgresState: StateStore = {
  async get<T>(module: string, key: string, fallback: T) {
    const [row] = await database()
      .select()
      .from(moduleState)
      .where(and(eq(moduleState.module, module), eq(moduleState.key, key)));
    return row ? (row.value as T) : fallback;
  },
  async set(module, key, value) {
    await database()
      .insert(moduleState)
      .values({ module, key, value })
      .onConflictDoUpdate({ target: [moduleState.module, moduleState.key], set: { value, updatedAt: new Date() } });
  },
};
export async function resetState(module?: string) {
  if (module) await database().delete(moduleState).where(eq(moduleState.module, module));
  else await database().delete(moduleState);
}
