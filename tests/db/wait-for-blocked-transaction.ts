import { sql } from 'drizzle-orm';
import type { Transaction } from '../../packages/db/src/index';

/** Let the holder commit only after PostgreSQL sees another transaction waiting for one of its locks. */
export async function waitForBlockedTransaction(holder: Transaction) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const [lock] = await holder.execute<{ waiting: boolean }>(sql`
      select exists (select 1 from pg_locks where not granted and pg_backend_pid() = any(pg_blocking_pids(pid))) as waiting`);
    if (lock?.waiting) return;
    await Bun.sleep(10);
  }
  throw new Error('The concurrent transaction did not reach the held lock.');
}
