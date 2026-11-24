export declare const manifest: unknown;
/**
 * The synthetic durability source: `path` is the persistent SQLite file, `fault` one of the faults after a commit that
 * README.md lists. `close` closes the database.
 */
export declare function createConnector(options: {
  path: string;
  secret?: string;
  clewUrl?: string;
  jwks?: object | (() => Promise<object>);
  fault?: string;
}): { handle(request: Request): Promise<Response>; close(): void };
