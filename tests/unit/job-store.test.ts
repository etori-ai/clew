import { memoryJobTable } from '../../apps/server/src/scheduler/adapters/memory';
import { jobStoreContract } from '../job-store-contract';

/** The job table's contract on the memory adapter; `tests/db/postgres-job-store.test.ts` runs it on Postgres. */
jobStoreContract('memory', async () => {
  const table = memoryJobTable();
  return {
    executions: table,
    unfinished: table.unfinished,
    prefix: 'memory-job',
    async seed(row) {
      table.rows.push({ payload: {}, status: 'temporal', attempts: 0, ...row });
    },
    async row(id) {
      const row = table.rows.find(r => r.id === id);
      return row && { status: row.status, attempts: row.attempts, leaseUntil: row.leaseUntil ?? null };
    },
    async audit(id) {
      return table.audit.filter(a => a.subject === 'job:' + id).map(a => ({ action: a.action, details: a.details }));
    },
  };
});
