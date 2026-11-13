import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
export * as schema from './schema';

let client: ReturnType<typeof postgres> | undefined;
let instance: ReturnType<typeof drizzle> | undefined;
export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Start the development environment.');
  // Postgres NOTICE messages ("schema already exists, skipping" during migrations) are noise, not errors.
  client ??= postgres(url, { max: 5, idle_timeout: 10, onnotice: () => undefined });
  return (instance ??= drizzle(client));
}
export type Database = ReturnType<typeof database>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/**
 * Whether the database answers a trivial query within `ms` milliseconds, for `/api/ready` (L1 of the 2026-11-12 users
 * review): when every connection of the pool is held, the query waits for one as every request would, and it is
 * cancelled, never sent, when the time is up.
 */
export async function databaseAnswers(ms: number) {
  try {
    database();
    await client!`select 1`.signal(AbortSignal.timeout(ms));
    return true;
  } catch {
    return false;
  }
}
export async function closeDatabase() {
  await client?.end();
  client = undefined;
  instance = undefined;
}
