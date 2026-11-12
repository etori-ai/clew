-- From D86 until this change the attention admission (D47) inserted a deferred delivery's release job without starting
-- its `scheduledJob` workflow, so the delivery stayed `waiting` and was never announced. The admission now schedules
-- the job through `scheduleJob`. Start, once, the workflow of every release job the engine owns that has none, as the
-- stores do inside their transactions (`packages/db/src/durable.ts`, `jobStart` in `packages/db/src/jobs.ts`): under
-- the application the server launches as and its ledger queue (`clew`, `clew.ledger`), with a `job.scheduled` audit
-- row each. A database without the engine's schema yet (a new one, the recovery rehearsal's) is left as it is.
DO $$
DECLARE
  j record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'dbos' AND p.proname = 'enqueue_workflow') THEN
    RETURN;
  END IF;
  FOR j IN
    SELECT job.id, job.kind, to_char(job.run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS due_at
    FROM job
    WHERE job.kind = 'attention-release' AND job.status NOT IN ('done', 'due', 'running', 'legacy-running')
      AND NOT EXISTS (SELECT 1 FROM dbos.workflow_status s WHERE s.workflow_uuid = 'job:' || job.id)
  LOOP
    PERFORM dbos.enqueue_workflow(
      workflow_name => 'scheduledJob',
      queue_name => 'clew.ledger',
      positional_args => ARRAY[json_build_object('id', j.id, 'dueAt', j.due_at)],
      workflow_id => 'job:' || j.id,
      application_name => 'clew'
    );
    INSERT INTO audit (actor, action, subject, details)
    VALUES ('system:migration', 'job.scheduled', 'job:' || j.id,
            jsonb_build_object('kind', j.kind, 'runAt', j.due_at, 'reason', 'workflow-missing'));
  END LOOP;
END $$;
