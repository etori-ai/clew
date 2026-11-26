export interface FixtureState {
  get<T = unknown>(key: string, fallback?: T): T;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  keys(prefix: string): string[];
  transaction<T>(fn: () => T): T;
  close(): void;
}
export declare function memoryState(): FixtureState;
export declare function sqliteState(path: string): Promise<FixtureState>;
