# Testing

How Clew is tested so that the number of tests can keep growing while `bun run check` stays fast and needs
nothing but the repository. Implements D25; builds on D20's four kinds of file. Short form in `CLAUDE.md`.

## The shape in one paragraph

Almost everything is a unit test in `tests/unit`, run by `bun test` without external services, against pure domain
functions and use cases built over memory adapters. The one slow test per store is a contract that proves the
memory adapter behaves like the real one; it runs in the devcontainer, not in `bun run check`. Adapters for
external systems are tested against recorded fixtures. The accessibility suite drives a built web app in
Playwright with `/api` mocked. Nothing in `bun run check` needs Postgres, the durable engine, Keycloak, Nextcloud, a browser
or the network, and CI (`.github/workflows/check.yml`) runs it without the stack on purpose.

## Where a new test goes

| What changed | Test kind | Where | Runs in |
|---|---|---|---|
| A pure function (`domain.ts`, `packages/calendar/src/proposals.ts`, `dates.ts`, attention levels, the assistant router) | Example tests, and a property test when the function has an invariant worth stating ("never collides", "always within office hours") | `tests/unit/<topic>.test.ts`, `tests/unit/<topic>.property.test.ts` | `bun run check` |
| A use case (`threads/usecases/*`, `modules/*/usecases`) | A scenario test: real registry, the fixture connectors over the protocol (`tests/fixture-connectors.ts`), memory store, a clock the test owns; asserts the state the store ends up in and the audit rows written | `tests/unit/threads.test.ts` or a sibling per use case folder | `bun run check` |
| A store port (`threads/model.ts`, `modules/calendar/model.ts`, `connectors/model.ts`) or a store adapter | Add a case to that store's contract; it must pass on both adapters | `tests/store-contract.ts`, `tests/proposal-store-contract.ts` and `tests/connector-store-contract.ts`, each run by a `tests/unit/*-store.test.ts` and a `tests/db/postgres-*.test.ts` | `bun run check` (memory) and `bun run test:db` (Postgres) |
| An adapter for an external system (CalDAV, a remote connector's HTTP, Microsoft Graph) | Parse and translate a recorded response; the protocol's edge cases as fixtures | `tests/unit/<adapter>.test.ts` with fixtures in the test file or `tests/fixtures/` | `bun run check` |
| A calendar adapter, or a change to `CalendarProvider` | A case in the adapter contract; it must pass on every adapter (D69) | `tests/calendar-provider-contract.ts`, run by `tests/unit/microsoft365.test.ts` over the local fake of Graph and by `tests/calendar/nextcloud-provider.test.ts` | `bun run check` (fake) and `bun run test:calendar` (Nextcloud) |
| A route | Nothing of its own while it stays thin (parse, validate, call one use case, map errors). Hono's `app.request()` serves a route in process if a test is ever needed | `apps/server/tests/runtime.test.ts` shows the pattern | `bun run test:node` |
| A connector built here (`connectors/<name>`) | Real handler over the remote protocol with deterministic source fixtures; shared conformance probes | `tests/unit/<name>-connector.test.ts`, with HTTP process scenarios in `apps/server/tests/` when needed | `bun run check`; relevant runtime lane |
| A view, route or state in the web app | An accessibility test (axe, keyboard, reflow, announcements) | `tests/a11y/` | `sh scripts/a11y.sh`, CI `a11y.yml` |
| A browser cache helper (`apps/web/src/thread-cache.ts`, `query-policy.ts`, D33) | Example tests against a real `QueryClient` from `@tanstack/query-core`: what is written, what is invalidated, what is retried. No DOM, no React | `tests/unit/web-*.test.ts` | `bun run check` |
| The installation's theme file and appearance (D98) | Example tests of the format, the contrast pairs and the base table against Astryx's resolved tokens; scenario tests of the use cases with their audit rows on the memory store; the store contract on both adapters; the public routes over the memory store | `tests/unit/theme-file.test.ts`, `appearance-admin.test.ts`, `appearance-routes.test.ts`, `tests/appearance-store-contract.ts` | `bun run check`, `bun run test:db` |
| Durable state across the database and worker/source boundary | Real PostgreSQL contracts and Node/DBOS workflows against an independent synthetic fault source; timer cancellation and a killed instance's takeover; workflow starts committed with their intents before the engine launches (D86); a job's watch steps through real `jobWatch` workflows; a night's `scheduledJob`, a failing one included, run through the live `scheduledJobRunner` as `composition/jobs.ts` binds it; deferred attention released by its job's workflow; a live step whose statement fails, retried without its values; `scripts/jobs-check.ts` runs a job on the independent fixture connectors against the dev stack | `tests/db/`, `apps/server/tests/execution-runtime.test.ts`, `apps/server/tests/timer-runtime.test.ts`, `apps/server/tests/watch-runtime.test.ts`, `apps/server/tests/job-runtime.test.ts`, `apps/server/tests/attention-runtime.test.ts`, `apps/server/tests/failed-step-runtime.test.ts` | `bun run test:db`, `bun run test:durability`, CI `reliability.yml` |
| What a failure leaves in a log line, a span or the durable engine's warning (D91) | Example tests of the logger's serializer with a statement built as drizzle builds it; real failing statements on PostgreSQL; a mounted app with a recording tracer; a live step on the engine | `tests/unit/logging.test.ts`, `tests/db/postgres-error-logging.test.ts`, `apps/server/tests/request-spans.test.ts`, `apps/server/tests/failed-step-runtime.test.ts` | `bun run check` (the unit suite and `bun run test:node`), `bun run test:db`, `bun run test:durability` |
| Upgrade and restore | Isolated databases starting at migration 0019, conservative upgrade, repeated migration and evidence comparison after pg_dump/pg_restore; an upgrade through 0054 on a database of its own, created beside the suite's and dropped afterwards: rows seeded at the migration before it, then a probe migration that writes, 0054 and a probe that alters the tables 0054 writes, in the one transaction Drizzle runs them in | `scripts/recovery-rehearsal.ts`, `tests/db/person-keys-upgrade.test.ts` | [operations runbook](../maintainers/reliability-operations.md), CI `reliability.yml`, `bun run test:db` |

## Microsoft 365 without Microsoft

`packages/calendar/src/fake-graph.ts` is a fake of the part of Microsoft Graph the `microsoft365` adapter calls (D69).
It runs as the `graph` service of the base development stack, seeds its own meetings and rooms as it starts, and is
published on loopback at `127.0.0.1:4047`. The synthetic directory binds Mikael to it and Hillevi and Hassan to
Nextcloud, so signing in as `mikael` shows the app on Microsoft 365 with nothing else started. To run every account on
the fake, give the BFF one variable:

```bash
docker exec -e CALENDAR_ADAPTER=microsoft365 -w /workspace clew-app-1 bun run dev:server
```

`sh scripts/graph.sh seed` restarts the fake for a fresh seed from today, since state lives in memory; `stop` and
`status` do what they say. `bun run test:calendar` runs the adapter contract against the running fake over the network
(`tests/calendar/graph-provider.test.ts`) as well as against Nextcloud. A call the fake does not implement answers
`501`; add it to the fake from Microsoft's documentation, with a case in the contract. Passing against the fake is not
proof of how a real tenant behaves, and D69 lists what is still unverified.

## The kinds of test

**Domain examples.** `planWeek`, `freeGaps`, `attentionLevel`, `localInstant`: plain input, plain output, no
fakes. Keep adding examples when a bug is found; the example is the regression test.

**Properties.** `fast-check` (MIT) draws inputs and checks an invariant hundreds of times per run.
`tests/unit/proposals.property.test.ts` states the planner's invariants once: no collision with the manager, the
candidate or another slot, always in office hours, never before `notBefore`, one slot per person, deterministic,
and a candidate is left out only when planning them alone finds nothing either. Write a property when the function
has a rule that holds for every input; write examples when the interesting cases are specific. A failing property
prints the smallest input that breaks it; add that input as an example before fixing.

**Scenario tests of use cases.** The `world()` helper in `tests/unit/threads.test.ts` is the pattern: a
`Registry` with the fixture connectors (`fixtureConnectors()` in `tests/fixture-connectors.ts`: the six services of
`connectors/` in-process on their memory stores, D61), `memoryThreadStore()`, `memoryTimers()`, a `fakeClock()`
that the test moves, and sequential ids. `tests/unit/samtal.test.ts` does the same for the calendar with
`memoryCalendar()` (`@clew/calendar/memory`, the `CalendarProvider` port in memory: seed events, busy time per
member, a `failCreate` switch) and `memoryProposalStore()`, from the nightly draw through confirm, undo and the timer. The use cases under test are the production functions built by
`threadUsecases(deps)`. A scenario reads like the product: first visit pushes cards, the person acts, undoes
within the window, snoozes, asks for a reminder; the assertions are on the thread the store holds and on
`store.audit`. Two things every mutation test asserts: the audit row (actor, action, subject, time) and that a
failure after the audit row leaves nothing behind (wrap `store.transaction` to make one write throw).

**The store contract.** `tests/store-contract.ts` (threads) and `tests/proposal-store-contract.ts` (the calendar's
proposals) are functions that take a harness (a store, two people, a way to read audit rows and jobs) and register
the same tests. The memory adapter runs it in the unit suite; the Postgres
adapter runs it in `tests/db/` against the devcontainer's database, creating two people per test and removing
what they owned afterwards. When the port grows a method, the contract grows a case first. If the contract passes
on both adapters, what the unit tests learned from the memory store holds in production. That is the whole
argument for trusting the fast suite.

A memory store also refuses what a unique index refuses. The memory provisioning store throws PostgreSQL's unique
violation (`23505`, with the index's name) for `auth_person_user_name`, `auth_person_external_id` and
`auth_group_external_id`, so a race that a use case does not catch fails in the unit suite as it does on Postgres.

Some comparisons pass on the suite's database and fail on another. The suite's database has initdb's default locale
(`en_US.utf8`), where a plain `lower` folds å, ä and ö. On a database created with the locale C, which
[D100](../decisions/D100-the-people-list-is-read-a-page-at-a-time-and-narrowed-on-the-server.md) supports, only the
ICU collation folds them. `cLocaleDatabase()` in `tests/db/c-locale.ts` creates such a database from `template0` beside
the suite's, checks that it does not fold `Å` by itself, migrates it, and drops it when the test ends. The SCIM store
contract (`tests/scim-store-contract.ts`) runs on it as a third store, after memory (`tests/unit/scim.test.ts`) and
the suite's database (`tests/db/postgres-provisioning.test.ts`); its case for a word and a value composed or
decomposed (NFC and NFD), in the people list and the group picker, runs on all three.
`tests/db/user-name-form.test.ts` and `tests/db/user-reads.test.ts` use it too, and `tests/db/identity-binding.test.ts`
creates its own; `tests/db/person-keys-upgrade.test.ts` creates a database of its own to upgrade. So the role in
`DATABASE_URL` needs `CREATEDB` for `bun run test:db`; the devcontainer's `clew` is the image's superuser and has it.

A race between two writes is tested twice. In the unit suite the other write runs at the moment the use case takes its
lock, through a store wrapped to run it there, as the K4 cases in `tests/unit/users-admin.test.ts` do for a mapping
change and a SCIM write of its group. On PostgreSQL one transaction is held open while the other runs
(`tests/db/postgres-scim-concurrency.test.ts`). A change to how a card's rows are keyed is tested on both paths that
write them: the refresh worker in `tests/unit/refresh.test.ts` and the in-process scan in
`tests/unit/entities-cards.test.ts`, as the cases for a change in the directory alone are.

**Adapter fixtures.** `tests/unit/nextcloud.test.ts` parses recorded CalDAV responses. The same for any adapter:
record the real answer once, test the translation to the port. Live runs against the system stay in the smoke
script or a manual pass.

**Accessibility.** `tests/a11y` is the browser suite. A new route,
view or state gets a test there (`CLAUDE.md`).

The browser suite has an explicit ESM boundary and an isolated Vite configuration with no installation
environment files. The theme and the logo are answers of the suite's mocked API (D98), so one build serves every
saved appearance; typed fixtures (`tests/a11y/branding-fixtures.ts`) name three. CI runs the suite on Neutral, then
the Sundsvall and custom cases of `branding.spec.ts` sequentially, with one worker. Reports have separate profile
directories.

## Rules the tools enforce

- `dependency-cruiser` (`bun run deps`): `usecases-reach-stores-through-ports` (a use case never imports `@clew/db`,
  Drizzle, Postgres, the durable engine, an adapter or the composition root; an error for every `usecases` folder),
  `unit-tests-stay-fast` (`tests/unit` never imports a live adapter, the composition root,
  `@clew/db` or the durable engine; a type needed from the schema comes from `packages/db/src/schema.ts`, because TypeScript 7
  has no compiler API and the cruiser cannot tell `import type` apart), `domain-is-pure`, `routes-stay-thin`.
- `scripts/purity-check.ts` (`bun run purity`): no `Date.now()`, `new Date()`, `process.env`, `randomUUID()` or
  `Math.random()` in domain files and use cases. The clock and the id source are `deps.clock` and
  `deps.ids`; the composition root reads configuration.
- `bun run check` = the Prettier format check (D57), typecheck, deps, purity, `bun test tests/unit apps/web/tests`, the Node runtime tests and documentation checks. It must never start to
  need the stack; `.github/workflows/check.yml` runs it with `--no-deps`.
- `bun test` does not use `mock.module`. A mocked import hides the dependency the rules are meant to expose; a fake
  behind a port is the same dependency made visible.

## Commands

```sh
docker exec -w /workspace clew-app-1 bun run check          # everything CI runs, no stack needed
docker exec -w /workspace clew-app-1 bun test tests/unit     # the fast suite alone
docker exec -w /workspace clew-app-1 bun run test:db         # the store contract against Postgres
docker exec -w /workspace clew-app-1 bun run test:durability # real Node, PostgreSQL, the DBOS engine and synthetic fault source
sh scripts/a11y.sh                                           # the WCAG suite
```

### Running the WCAG suite

`sh scripts/a11y.sh` builds the web app once, then runs the suite in the pinned Playwright image; everything after the
script name goes to `playwright test`. The full suite runs on one worker and takes several minutes, so it is not the per-edit check ([D51](../decisions/D51-the-wcag-suite-is-cis-gate.md)):

- Per change, run the spec files the change touches: `sh scripts/a11y.sh menu.spec.ts shell.spec.ts`. Add
  `--timeout 15000` so a red run fails in seconds instead of waiting out 30 s per test.
- Every spec file is loaded when a run starts, so one that cannot be loaded stops the whole suite. `tests/package.json`
  marks everything under `tests/` as an ES module for that reason: a spec may import a shared helper there
  (`tests/fixture-connectors.ts`) and a connector's `.mjs` beside it, and Playwright must load both the same way.
- Two runs in one checkout share `test-results/<profile>`, and each run empties it at its start: a second run started
  meanwhile fails the first with `ENOENT` on its trace files. Give the second its own folder,
  `sh scripts/a11y.sh menu.spec.ts --output test-results/second`.
- During the lab phase the whole suite runs by hand: `gh workflow run a11y.yml`, or `sh scripts/a11y.sh`
  ([D59](../decisions/D59-the-wcag-suite-runs-by-hand-until-the-run-up-to-a-release.md)). Nothing waits for it before
  landing on `main`. In the run-up to a release the `push` and `pull_request` triggers in
  `.github/workflows/a11y.yml` come back, and with them D51's gate: the GitHub plan cannot block a merge on a red run,
  so read the WCAG check of the previous landing before landing on `main` again, and fix a red check before new work
  lands.
- A test that passes alone and fails on a slower runner is holding a timer it should hold a promise for (see
  `api.holdAnswer()` and session 41 in `docs/history/session-log.md`).
- Two runs in the same checkout empty each other's `test-results`; give the second `--output=test-results/<name>`.

## What is ported

Business use cases are built over ports (D25), with live and memory adapters wired in `apps/server/src/composition/`. The following are examples; the [backend map](backend-structure.md) includes execution, refresh, jobs, administration and user reads:

| Folder | Factory | Ports (`model.ts` or `ports.ts`) | Scenario tests |
|---|---|---|---|
| `threads/usecases/` | `threadUsecases`, `reminderUsecases` (timer delivery and legacy `surface`) | `ThreadStore`, `ThreadTx` (with `lockThread`), `ReminderTimers` | `tests/unit/threads.test.ts` |
| `modules/calendar/usecases/` | `calendarUsecases` | `ProposalStore`, `CalendarBinder`, `CalendarProvider` (D11) | `tests/unit/samtal.test.ts` |
| `scheduler/` | `createScheduler`, `scheduledJobRunner` (a job's workflow step) | `JobQueue`, `JobExecutions` (live adapter `durableJobs`), `People`, `SignInData` | `tests/unit/scheduler.test.ts`; on PostgreSQL `tests/db/sign-in-cleanup.test.ts` and `tests/db/postgres-refresh-attention.test.ts` |
| `assistant/` | `assistantUsecases` | `ThreadStore`, `ModelProvider` | `tests/unit/conversation.test.ts` |

`dbos/activities.ts` binds the use cases from the composition root to the steps in `dbos/workflows.ts`, each wrapped by `valuelessFailures`, so a failed statement reaches the engine without its values (D91). A runtime test binds its own activities, or binds the live ones with `bindLiveActivities()` as `main.ts` does: `apps/server/tests/failed-step-runtime.test.ts` does that to show what the engine logs when a live step's statement fails. Durable timer generations, execution progress, bounded follow-up and scheduled job ownership are tested separately from recovery: `apps/server/tests/fixtures/durable-child.ts` is a second instance killed while a reminder waits, whose workflow the timer runtime test claims and adopts. `today()` and `isPast()` in `@clew/calendar/dates` are for the browser;
the server derives the date from `clock()` and the purity guard refuses them.

Still outside the pattern, on purpose: `auth.ts`, `system-context.ts` and `connectors/remote.ts` (identity and
connector loading, platform code over `@clew/db` directly) and the connector descriptors `modules/*/connector.ts`
that describe built-in capabilities. Internal `people.*` reads now use a `UserReads` port, composed with a PostgreSQL adapter.

The shared follow-up contract (`tests/followup-contract.ts`) runs on memory and PostgreSQL. Calendar execution projection, refresh/attention and ownership have PostgreSQL scenarios in addition to pure/use-case tests. Runtime tests are required for boundaries memory cannot prove: real transactions, process/protocol response loss and recovery of a pending workflow after process death. Keep these in the separate reliability lane, not the fast suite.

A test removes what it left in the durable engine's tables. `forget()` on `testEngine` (`apps/server/tests/durable.ts`)
removes a runtime test's workflows and its queue, and `forgetTestWorkflows()` (`tests/db/durable.ts`) the workflows a
`tests/db` file enqueued. Both delete the workflows' inputs, outputs and step records with them, because those have no
foreign key to the workflow's row: a workflow id that a later run uses again, such as a night's job, would otherwise
keep the input it was first enqueued with and replay the steps recorded the first time.

The older `scripts/auth-dev-check.ts` assumes synchronous decisions and refresh. It is a historical development smoke script, not a current acceptance gate for the asynchronous lifecycle; do not use its results to claim this roadmap is verified. `scripts/jobs-check.ts` runs the job across systems on the fixture connectors of the development stack (D61). Use the maintained suites above and the [acceptance matrix](../reference/reliability-acceptance.md). A live login/calendar run still needs an updated scenario, authorized synthetic records and explicit source assertions.
