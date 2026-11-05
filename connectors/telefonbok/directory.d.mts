import type { Directory, Person } from './connector.mjs';
export declare class DirectoryUnavailable extends Error {}
export declare function toPerson(raw: unknown, baseUrl?: string): Person | null;
export declare function createHttpDirectory(options: { url?: string; apiKey?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response>; timeoutMs?: number }): Directory;
export declare function createFixtureDirectory(records?: unknown[], baseUrl?: string): Directory;
