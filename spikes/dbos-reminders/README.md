# Spike: Clew's durable reminder on DBOS Transact

A throwaway package, outside the workspace, that ports `durableReminder` from
`apps/server/src/temporal/workflows.ts` to [DBOS Transact](https://github.com/dbos-inc/dbos-transact-ts)
(MIT, `@dbos-inc/dbos-sdk` 5.4.0) and measures what the decision between Temporal (D17) and DBOS turns on.
Findings and recommendation: `docs/reviews/2026-11-09-dbos-spike-durable-reminders.md`.

What it exercises, against one Postgres database that holds both the spike's tables and DBOS's `dbos` schema:

- the D47 contract: absolute due time, generation fencing, cancel until it fires, never two deliveries;
- starting and cancelling a workflow **inside the same transaction** as the intent row (`dbos.enqueue_workflow`,
  `dbos.send_message`), which is the step Clew's outbox performs today;
- two BFF instances with different executor ids, SIGKILL of the owner, restart under the same id, replacement
  under a new id, and takeover of a dead executor's workflows;
- a code change between runs with the default source-hash version and with a pinned version;
- a queue with a concurrency limit holding sleeping reminders.

Run inside the devcontainer (`DATABASE_URL` is set there; the spike uses database `clew_dbos_spike`):

```sh
docker exec clew-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "create database clew_dbos_spike"'
docker exec -w /workspace/spikes/dbos-reminders clew-app-1 bun install
docker exec -w /workspace/spikes/dbos-reminders clew-app-1 node --import tsx src/experiment.ts            # all scenarios
docker exec -w /workspace/spikes/dbos-reminders clew-app-1 node --import tsx src/experiment.ts recovery   # one of: basic atomic concurrency recovery version
```

`src/app.ts` is one instance (DBOS in-process plus a small HTTP control surface), `src/workflows.ts` the two
reminder variants and the fenced step, `src/experiment.ts` the driver that spawns, kills and inspects instances.
Instance logs land in `.logs/`; `results/` keeps the summary lines of the runs the review quotes.
