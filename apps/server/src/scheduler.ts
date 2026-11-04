import { Temporal } from 'temporal-polyfill';
import { database, schema } from '@clew/db';
import { claimJob, scheduleJob, type JobRow } from '@clew/db/jobs';
import { timeZone } from '@clew/calendar/dates';
import { systemContext } from './system-context';
import { calendar, threads } from './composition';

/**
 * Postgres-backed scheduler for v1. One nightly scan per manager and one timer per undo window. Jobs are claimed
 * with a row lock, so a second server process is safe. Temporal replaces this when the push engine grows.
 */
const POLL_MS = 15_000;
let timer: ReturnType<typeof setInterval> | undefined;

async function run(job: JobRow) {
  if (job.kind === 'scan-utvecklingssamtal') {
    const people = await database().select({ id: schema.accessGrants.personId }).from(schema.accessGrants);
    for (const p of people) { const persona = await systemContext(p.id); if (persona) await threads.ensureThreads(persona).catch(error => console.error('scan', p.id, error)); }
    await scheduleNightly();
  } else if (job.kind === 'undo-expiry') {
    const threadId = typeof job.payload.threadId === 'string' ? job.payload.threadId : undefined;
    if (threadId) await calendar.closeUndoWindow(threadId);
  } else if (job.kind === 'receipt-final') {
    const threadId = typeof job.payload.threadId === 'string' ? job.payload.threadId : undefined;
    if (threadId) await threads.closeReceiptWindow(threadId);
  }
}
export async function scheduleNightly() {
  const next = Temporal.Now.zonedDateTimeISO(timeZone).add({ days: 1 }).with({ hour: 6, minute: 0, second: 0, millisecond: 0 });
  await scheduleJob({ id: `scan:${next.toPlainDate().toString()}`, kind: 'scan-utvecklingssamtal', runAt: new Date(next.epochMilliseconds) });
}
async function tick() {
  for (let i = 0; i < 10; i++) {
    const job = await claimJob();
    if (!job) return;
    try { await run(job); await (await import('@clew/db/jobs')).finishJob(job.id); }
    catch (error) { await (await import('@clew/db/jobs')).finishJob(job.id, error instanceof Error ? error.message : String(error)); }
  }
}
export function startScheduler() {
  void scheduleNightly();
  void tick();
  timer ??= setInterval(() => void tick().catch(error => console.error('scheduler', error)), POLL_MS);
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = undefined; }
