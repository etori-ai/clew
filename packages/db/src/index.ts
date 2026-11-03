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
  return instance ??= drizzle(client);
}
export type Database = ReturnType<typeof database>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function closeDatabase() { await client?.end(); client = undefined; instance = undefined; }
