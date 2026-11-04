# Scheduled work: the Postgres scheduler now, Temporal later

What runs on a timer in Clew, how the v1 scheduler works, what it cannot do, and the conditions under
which Temporal replaces it. Decided 2026-11-03 (D15). Written 2026-11-04 against the code as it is.

## What runs on a schedule today

| Job kind | When | What it does | Scheduled by |
|---|---|---|---|
| `scan-utvecklingssamtal` | Every day 06:00 Europe/Stockholm | For every person with a grant: build a system context from the grant, run every module's `scan`, push one open thread per topic, refresh untouched open cards from their source. Then schedules itself for tomorrow | The server at start and by itself after each run |
| `undo-expiry` | Ten minutes after a proposal confirmation | Closes the undo window on a calendar confirmation | The planner, in the same transaction as the confirmation |
| `receipt-final` | When a receipt's undo window ends | Clears `undoUntil` and `undoCapability` on the receipt so the card shows the final state | The card action, in the same transaction as the receipt |
| `reminder` (Temporal workflow) | When the person asks, "Påminn mig …" on a card; the card is parked under "Pågår utan dig" meanwhile | Waits the requested time (cancellable by signal, `…/remind/cancel`), then the `surfaceReminder` activity brings the same card back: reopens it if dismissed, clears the parking, sets `remindedAt` (red "Påminnelse" badge), rewrites the trigger ("Du bad 09:44 om en påminnelse · …"). The page announces it with a persistent toast with "Visa"; the card keeps its place by deadline. Never a second card | `POST /api/threads/:id/remind`, audited as `reminder.set` and `reminder.cancelled`; the firing as `thread.reminded` |

The first three run on the Postgres `job` table (D15). The fourth runs on Temporal (D17, 2026-11-04):
the worker lives in the BFF process (`apps/server/src/temporal/`), the server and UI are in the
devcontainer, and the UI on port 3023 shows every reminder as a workflow. Moving the three job kinds to
Temporal is the next step; they work as they are until then.

The nightly scan is the push engine of v1: modules decide what needs a person (deterministic, no model,
idempotent by `topic`), and the scheduler is what makes that happen without anyone opening the page.
The first visit of the day runs the same scan on demand.

## How the scheduler works

`apps/server/src/scheduler.ts` and `packages/db/src/jobs.ts`, on one table, `job`:

- **A job is a row** with a natural id, a kind, a JSON payload, `run_at` and a status (`due`, `running`,
  `done`, `failed`), plus attempts, last error and timestamps.
- **Scheduling is idempotent.** The id is a natural key (`scan:2026-11-05`,
  `undo-expiry:<thread>:<time>`); inserting it twice is a no-op. A job that belongs to a mutation is
  inserted in that mutation's transaction, so a confirmed proposal always has its undo timer and never
  has one without the confirmation.
- **Claiming is a row lock.** Every 15 seconds each server process claims one due job at a time with
  `SELECT … FOR UPDATE SKIP LOCKED`, marks it `running`, runs it, marks it `done` or `failed`. Two
  processes never run the same job; a second process is safe.
- **The scan runs as the person, not as a service account.** The system context is built from the
  person's current grant (`sessionBinding: 'system:scan'`), so every capability a scan calls is scoped
  exactly as if the person had clicked. Audit rows name `assistant:scan` as the actor.
- **No queue outside Postgres.** No broker, no Redis, no worker image. The scheduler runs inside the BFF
  process; `apps/worker` does not exist.

## What it deliberately does not do

These are the limits that define "v1". Each is acceptable for one nightly scan and two short timers, and
each is a reason Temporal exists.

- **No retry policy.** A failed job stays `failed` with its error. Nobody re-runs it; the next nightly scan
  covers a failed scan, and a failed undo timer leaves an undo window open until the receipt is read.
- **No timeout or heartbeat.** A job whose process died mid-run stays `running` forever. Nothing reclaims
  it.
- **No state between steps.** A job is one function. A sequence that spans days (send invitations, wait
  for the answers, remind on Thursday, close on Friday) has to be written as separate jobs that find their
  own state in the thread, which works for one use case and becomes brittle at three.
- **No signals.** Nothing outside can wake a waiting job ("the employee answered"). The scan has to notice
  on its next run.
- **No visibility.** There is no view of what is scheduled, running or stuck beyond the table.
- **Fifteen-second granularity**, one process polling. Fine for timers measured in minutes and days.

## When Temporal comes in

Temporal (MIT, self-hosted, Temporal server plus the TypeScript SDK) is a durable workflow engine:
workflow code that survives process restarts, timers of any length, retries with policy, signals from
outside, queries into a running workflow, and a UI that shows every running instance. The decision is
that it replaces the Postgres scheduler when the push engine grows past what one function per job can
carry. The concrete triggers, any one of which is enough:

1. **Watches with conditions.** A person or a module sets "tell me when the sick-leave rate in my unit
   passes 8 %" or "when Anna's certificate is in Heroma". A watch is a long-lived instance that
   re-evaluates on a schedule or on a signal and fires once. That is a workflow, not a job.
2. **Multi-step obligations with waits.** The second use case that needs send, wait for others, remind,
   escalate, close, with the state of the obligation living in the engine rather than reconstructed from
   thread rows on every scan.
3. **Reconciliation of unknown outcomes.** An `execute` that returned `unknown` (RPA-backed Heroma,
   a lost reply) needs a retrying check with backoff until the source confirms. One such adapter is enough.
4. **Notifications beyond the page.** Push for same-day deadlines and e-mail digests at bundle times are
   timers per person per day with delivery retries; the attention budget is state across them.
5. **A person's own timers.** "Påminn mig om tio minuter om det här", "bevaka den här fakturan tills
   den är attesterad", "säg till när Anna har svarat". These are set from the conversation (a Clew-side
   action confirmed in the overlay, D12), are many and short-lived, carry a ref to an object, and are
   cancelled or moved as casually as they are set. That is a different shape from three fixed job kinds:
   thousands of small, user-owned, editable timers whose state the person expects to see and change.

The fifth trigger is the one the product is heading for. The scheduler is not housekeeping in Clew; it
is what makes the page come back to a person at the right moment, and user-set reminders and watches
are the same mechanism as the module scans, owned by the person instead of a module. That is why the
scheduler is treated as a crucial part of the system and why the engine choice is made on fitness, not
on the size of what runs today.

Until one of these is real, Temporal is a second process, a second schema and a second thing to run for
every municipality that installs Clew, for three job kinds. That is why it is "later".

## What does not change when it does

- Modules still declare capabilities; `scan` still returns thread drafts. Temporal schedules and
  sequences; it never decides what a person needs.
- Every mutation still goes through a capability with scope, validation and an audit row in the same
  transaction. A workflow activity calls `runCapability` as the person, like a job does today.
- The human decision endpoint stays outside the engine: a workflow may wait for a decision, never make
  one. `execute` is never called by a timer except for Clew's own housekeeping (closing an undo window).
- The model is not involved. Scheduled work is deterministic with or without Temporal (D8).
- Job ids stay natural keys; workflow ids will be the same strings, so idempotency carries over.

The migration is bounded: three job kinds become three workflows, `scheduleJob` becomes a start-or-signal
call, and the `job` table is kept for the audit trail or dropped. Nothing in `packages/modules` notices.

## Is Temporal a good fit? (assessed 2026-11-04)

Yes. Temporal fits the problem class exactly: durable timers over weeks, signals from outside, retries
with policy, queries into a running instance and a UI that shows every workflow are what watches and
multi-step obligations need. Two objections were raised and dismissed the same day:

- **Runtime.** Temporal's TypeScript worker officially supports Node 20, 22 and 24 and depends on
  Node-API native modules and `worker_threads`; Bun is not tested. Clew's server runtime is Bun (D7).
  This is not a blocker: when Temporal arrives, Clew moves the server to Node, or runs the worker as a
  Node process beside the BFF. Hono and the AI SDK are web-standard and run on both; the switch is
  known to be cheap in both directions. D7 is narrowed or superseded at that point.
- **Operational weight.** Temporal is its own server with schemas and a UI. That was first counted
  against it because municipalities would have to run it. They will not: most municipalities have no IT
  department and will buy Clew as a hosted service, operated by a provider for whom one more well-known
  component is routine. Self-hosting stays possible under the open-source rule, and Temporal is MIT, but
  the container count of a self-hosted install is not a design criterion (`docs/vision.md`).

What remains is timing. Three job kinds and one nightly scan do not need a workflow engine, and adding
one before the first real trigger means designing workflows against imagined use cases. So:

| Step | What | When |
|---|---|---|
| 1 | Harden the `job` table: retry with backoff and attempt limit, a timeout that reclaims a stale `running` row, a heartbeat for long jobs, an admin view | Now; about a day of work. Keeps v1 honest until step 2 |
| 2 | Temporal: new timers are workflows from the start; the three job kinds become workflows, `scheduleJob` becomes start-or-signal, the `job` table is kept for the audit trail or dropped | Done for the first trigger on 2026-11-04 (D17): user-set reminders run on Temporal in the devcontainer, the runtime is Node (D16). The three job kinds are still on the `job` table |

Lighter engines were looked at and are not the plan. DBOS Transact (MIT core, durable execution
in-process on Postgres, no server) would avoid a second service, but with hosting operated by a provider
that saving buys little, and Temporal brings what DBOS does not: the UI, signals and queries as first-class
operations, and workers in other languages, so a dept44 Java service could run an activity directly.
pg-boss (MIT, Postgres, retries and cron) adds little over a hardened `job` table.

Sources: [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript/) (supported runtimes),
[DBOS Transact for TypeScript](https://github.com/dbos-inc/dbos-transact-ts),
[pg-boss](https://github.com/timgit/pg-boss).

## Startsidan background

Startsidan did not adopt Temporal either and used Postgres for its event log and consumers (doc 33), with
NATS for transport. Its data-model review (doc 40) noted the trade-off that applies here: durable event
history supports recovery and timers, but activity execution still needs idempotent effects. Clew keeps
that discipline in the capability layer, which is what makes the later move cheap.
