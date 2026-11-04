/** In-memory state for unit tests and the first boot. Same interface as `@clew/db/state`. */
export interface StateStore {
  get<T>(module: string, key: string, fallback: T): Promise<T>;
  set(module: string, key: string, value: unknown): Promise<void>;
}
export function memoryState(): StateStore & { dump(): Record<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    async get<T>(module: string, key: string, fallback: T) { return map.has(module + ':' + key) ? map.get(module + ':' + key) as T : fallback; },
    async set(module, key, value) { map.set(module + ':' + key, value); },
    dump() { return Object.fromEntries(map); },
  };
}
