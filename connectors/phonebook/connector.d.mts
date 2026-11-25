export interface Person {
  id: string;
  name: string;
  title: string;
  unit: string;
  unitId: string;
  phone?: string;
  mobile?: string;
  email?: string;
  room?: string;
  manager?: string;
  link?: string;
}
export interface Directory {
  search(query: string, options?: { unit?: string; limit?: number }): Promise<Person[]>;
  person(id: string): Promise<Person | null>;
}
export declare const manifest: unknown;
/**
 * The adapter `PHONEBOOK_ADAPTER` names. Throws when none is named, the name is unknown, or `fixture` is named beside
 * `PHONEBOOK_URL` or `PHONEBOOK_API_KEY`.
 */
export declare function adapterOf(env: Record<string, string | undefined>): 'http' | 'fixture';
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  directory?: Directory;
  unitMap?: Record<string, string>;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
