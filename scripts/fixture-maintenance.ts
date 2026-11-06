/**
 * Development-only source cutover. Call retirement with the BFF/worker and fixture services stopped.
 * Receipts and approved input stay historical; no old decision may execute or undo against a fresh source.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { openSecret, sealSecret } from '../apps/server/src/auth-crypto';
import type { JobStep } from '../apps/server/src/modules/executions/model';
import { FIXTURE_IDS, requireFixtureDevelopment } from './fixture-development';

export async function assertFixtureCutover() {
  const rows = await database()
    .select({
      id: schema.executions.id,
      safety: schema.executions.safety,
      reason: schema.executions.reason,
    })
    .from(schema.executions)
    .where(inArray(schema.executions.connector, FIXTURE_IDS));
  const legacy = rows.filter(row => {
    const safety = row.safety as { strategy?: string; lookup?: string };
    return (
      row.reason !== 'source-reset' &&
      (safety.strategy === 'manual' || ['hr.absenceLookup', 'timesheet.absenceLookup'].includes(safety.lookup ?? ''))
    );
  });
  if (legacy.length)
    throw new Error(
      legacy.length +
        ' legacy fixture executions still refer to the old source. Stop the Clew server and run fixtures:reset before registering fresh fixtures.',
    );
}

export async function assertFixtureServerStopped() {
  requireFixtureDevelopment();
  try {
    await fetch('http://127.0.0.1:' + (process.env.PORT ?? '3000') + '/api/health', {
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if (['ECONNREFUSED', 'ConnectionRefused'].includes(e.cause?.code ?? e.code ?? '')) return;
    throw new Error(
      'Could not establish that the Clew server is stopped. Stop all BFF/worker processes before resetting fixtures.',
    );
  }
  throw new Error('Stop the Clew server (including its worker) before resetting fixture source state.');
}

/** personId limits database tests to their synthetic actor; the reset CLI always resets all fixture actors. */
export async function retireFixtureWork(options: { personId?: string; at?: Date } = {}) {
  requireFixtureDevelopment();
  const at = options.at ?? new Date();
  const token = randomUUID();
  return database().transaction(async tx => {
    const scoped = (connector: typeof schema.executions.connector, person: typeof schema.executions.personId) =>
      and(inArray(connector, FIXTURE_IDS), options.personId ? eq(person, options.personId) : undefined);
    const executions = await tx
      .select()
      .from(schema.executions)
      .where(scoped(schema.executions.connector, schema.executions.personId))
      .for('update');
    let retired = 0;
    for (const e of executions) {
      if (e.reason === 'source-reset') continue;
      const unfinished = ['pending', 'running', 'unknown'].includes(e.state);
      const state = unfinished ? (e.dispatchedAt ? 'unknown' : 'failed') : e.state;
      await tx
        .update(schema.executions)
        .set({
          state,
          reason: 'source-reset',
          expiresAt: at,
          leaseUntil: null,
          attempt: e.attempt + 1,
          updatedAt: at,
        })
        .where(eq(schema.executions.id, e.id));
      await tx
        .update(schema.dispatchOutbox)
        .set({
          deliveredAt: at,
          leaseUntil: null,
          lastError: 'source-reset',
        })
        .where(and(eq(schema.dispatchOutbox.executionId, e.id), isNull(schema.dispatchOutbox.deliveredAt)));
      await tx.insert(schema.audit).values({
        actor: 'bootstrap:fixtures',
        action: 'execution.source_reset',
        subject: 'execution:' + e.id,
        details: { previousState: e.state, state, dispatched: !!e.dispatchedAt },
        createdAt: at,
      });
      retired++;
    }
    const jobs = await tx
      .select()
      .from(schema.executionJobs)
      .where(options.personId ? eq(schema.executionJobs.personId, options.personId) : undefined)
      .for('update');
    let blocked = 0;
    for (const job of jobs) {
      const steps = JSON.parse(openSecret(job.steps, 'job:steps:' + job.id)) as JobStep[];
      const affected = steps.filter(
        s => s.kind === 'watch' && s.state === 'waiting' && FIXTURE_IDS.includes(s.connector),
      );
      if (!affected.length) continue;
      const ids = new Set(affected.map(s => s.id));
      await tx
        .update(schema.executionJobs)
        .set({
          steps: sealSecret(
            JSON.stringify(
              steps.map(s =>
                ids.has(s.id)
                  ? {
                      ...s,
                      state: 'blocked',
                      reason: 'source-reset',
                    }
                  : s,
              ),
            ),
            'job:steps:' + job.id,
          ),
          updatedAt: at,
        })
        .where(eq(schema.executionJobs.id, job.id));
      await tx
        .update(schema.watchIntents)
        .set({
          deliveredAt: at,
          leaseUntil: null,
          lastError: 'source-reset',
        })
        .where(and(eq(schema.watchIntents.jobId, job.id), inArray(schema.watchIntents.stepId, [...ids])));
      await tx.insert(schema.audit).values({
        actor: 'bootstrap:fixtures',
        action: 'job.source_reset',
        subject: 'job:' + job.id,
        details: { steps: [...ids] },
        createdAt: at,
      });
      blocked += ids.size;
    }
    // Archive grouping keys, not receipts: the next scan must be able to create a new occurrence with its source topic.
    const threads = await tx
      .select()
      .from(schema.threads)
      .where(
        and(
          inArray(schema.threads.connector, FIXTURE_IDS),
          options.personId ? eq(schema.threads.personId, options.personId) : undefined,
        ),
      )
      .for('update');
    let archived = 0;
    let cancelled = 0;
    for (const t of threads) {
      if (t.topic.includes(':fixture-reset:')) continue;
      await tx
        .update(schema.threads)
        .set({
          state: 'handled',
          topic: t.topic + ':fixture-reset:' + token,
          handledAt: at,
          updatedAt: at,
          actions: [],
          snoozedUntil: null,
        })
        .where(eq(schema.threads.id, t.id));
      const timers = await tx
        .select()
        .from(schema.timerIntents)
        .where(and(eq(schema.timerIntents.threadId, t.id), inArray(schema.timerIntents.state, ['active', 'blocked'])))
        .for('update');
      for (const timer of timers) {
        await tx
          .update(schema.timerIntents)
          .set({
            state: 'cancelled',
            reason: 'source-reset',
            generation: timer.generation + 1,
            leaseUntil: null,
            nextAt: at,
          })
          .where(eq(schema.timerIntents.id, timer.id));
        await tx.insert(schema.audit).values({
          actor: 'bootstrap:fixtures',
          action: 'timer.cancelled',
          subject: 'timer:' + timer.id,
          details: { reason: 'source-reset', generation: timer.generation + 1 },
          createdAt: at,
        });
        cancelled++;
      }
      archived++;
    }
    await tx
      .delete(schema.workOccurrences)
      .where(
        and(
          inArray(schema.workOccurrences.connector, FIXTURE_IDS),
          options.personId ? eq(schema.workOccurrences.personId, options.personId) : undefined,
        ),
      );
    await tx
      .delete(schema.refreshRequests)
      .where(
        and(
          inArray(schema.refreshRequests.connector, FIXTURE_IDS),
          options.personId ? eq(schema.refreshRequests.personId, options.personId) : undefined,
        ),
      );
    await tx.insert(schema.audit).values({
      actor: 'bootstrap:fixtures',
      action: 'fixtures.reset',
      subject: 'connectors',
      details: {
        connectors: FIXTURE_IDS,
        retired,
        blocked,
        archived,
        cancelled,
        ...(options.personId ? { personId: options.personId } : {}),
      },
      createdAt: at,
    });
    return { retired, blocked, archived, cancelled };
  });
}
