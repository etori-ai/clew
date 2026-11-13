import { Hono } from 'hono';

/** How long `/ready` waits for the database to answer. */
export const READY_WITHIN_MS = 1000;
/**
 * The probes. `/health` says the process answers. `/ready` says it can serve: startup has finished, and the database
 * answers a trivial query within a second through the server's own pool (L1 of the 2026-11-12 users review), so a pool
 * whose every connection is held turns it red instead of leaving it green while every request waits for a connection.
 */
export function healthRoutes(deps: { started: () => boolean; databaseAnswers: (ms: number) => Promise<boolean> }) {
  return new Hono()
    .get('/health', c => c.json({ ok: true }))
    .get('/ready', async c => {
      const ready = deps.started() && (await deps.databaseAnswers(READY_WITHIN_MS));
      return c.json({ ready }, ready ? 200 : 503);
    });
}
