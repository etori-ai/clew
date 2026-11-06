# Testing

How Clew is tested so that the number of tests can keep growing while `bun run check` stays fast and needs
nothing but the repository. Implements D25; builds on D20's four kinds of file. Short form in `CLAUDE.md`.

## The shape in one paragraph

Almost everything is a unit test in `tests/unit`, run by `bun test` in well under a second, against pure domain
functions and use cases built over memory adapters. The one slow test per store is a contract that proves the
memory adapter behaves like the real one; it runs in the devcontainer, not in `bun run check`. Adapters for
external systems are tested against recorded fixtures. The accessibility suite drives a built web app in
Playwright with `/api` mocked. Nothing in `bun run check` needs Postgres, Temporal, Keycloak, Nextcloud, a browser
or the network, and CI (`.github/workflows/check.yml`) runs it without the stack on purpose.

## Where a new test goes

| What changed | Test kind | Where | Runs in |
|---|---|---|---|
| A pure function (`domain.ts`, `packages/calendar/src/proposals.ts`, `dates.ts`, attention levels, the assistant router) | Example tests, and a property test when the function has an invariant worth stating ("never collides", "always within office hours") | `tests/unit/<topic>.test.ts`, `tests/unit/<topic>.property.test.ts` | `bun run check` |
| A use case (`threads/usecases/*`, later `modules/*/usecases`) | A scenario test: real registry, the fixture connectors over the protocol (`tests/fixture-connectors.ts`), memory store, a clock the test owns; asserts the state the store ends up in and the audit rows written | `tests/unit/threads.test.ts` or a sibling per use case folder | `bun run check` |
| A store port (`threads/model.ts`, `modules/calendar/model.ts`, `connectors/model.ts`) or a store adapter | Add a case to that store's contract; it must pass on both adapters | `tests/store-contract.ts`, `tests/proposal-store-contract.ts` and `tests/connector-store-contract.ts`, each run by a `tests/unit/*-store.test.ts` and a `tests/db/postgres-*.test.ts` | `bun run check` (memory) and `bun run test:db` (Postgres) |
| An adapter for an external system (CalDAV, a remote connector's HTTP, Microsoft Graph) | Parse and translate a recorded response; the protocol's edge cases as fixtures | `tests/unit/<adapter>.test.ts` with fixtures in the test file or `tests/fixtures/` | `bun run check` |
| A calendar adapter, or a change to `CalendarProvider` | A case in the adapter contract; it must pass on every adapter (D69) | `tests/calendar-provider-contract.ts`, run by `tests/unit/microsoft365.test.ts` over the local fake of Graph and by `tests/calendar/nextcloud-provider.test.ts` | `bun run check` (fake) and `bun run test:calendar` (Nextcloud) |
| A route | Nothing of its own while it stays thin (parse, validate, call one use case, map errors). Hono's `app.request()` serves a route in process if a test is ever needed | `apps/server/tests/runtime.test.ts` shows the pattern | `bun run test:node` |
| A connector built here (`connectors/<name>`) | Its own tests inside its folder; the conformance checker `bun scripts/connector-check.ts` against it running | `connectors/<name>/` | the connector's own CI |
| A view, route or state in the web app | An accessibility test (axe, keyboard, reflow, announcements) | `tests/a11y/` | `sh scripts/a11y.sh`, CI `a11y.yml` |
| A browser cache helper (`apps/web/src/thread-cache.ts`, `query-policy.ts`, D33) | Example tests against a real `QueryClient` from `@tanstack/query-core`: what is written, what is invalidated, what is retried. No DOM, no React | `tests/unit/web-*.test.ts` | `bun run check` |
| The web build's configuration boundary (D38 branding isolation) | A focused Vite contract that packages only the small browser configuration entry and asserts its exported value under conflicting environment inputs | `apps/web/tests/branding-config.test.ts`, beside the app that owns Vite | `bun run check` |
| Durable state across the database and worker/source boundary | Real PostgreSQL contracts and Node/Temporal workflows against an independent synthetic fault source; timer cancellation/replay; a job's watch steps through the outbox; `scripts/jobs-check.ts` runs a job on the bundled mocks against the dev stack | `tests/db/`, `apps/server/tests/execution-runtime.test.ts`, `apps/server/tests/timer-runtime.test.ts`, `apps/server/tests/watch-runtime.test.ts` | `bun run test:db`, `bun run test:durability`, CI `reliability.yml` |
| Upgrade and restore | Isolated databases starting at migration 0019, conservative upgrade, repeated migration and evidence comparison after pg_dump/pg_restore | `scripts/recovery-rehearsal.ts` | [operations runbook](../maintainers/reliability-operations.md), CI `reliability.yml` |

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

**Adapter fixtures.** `tests/unit/nextcloud.test.ts` parses recorded CalDAV responses. The same for any adapter:
record the real answer once, test the translation to the port. Live runs against the system stay in the smoke
script or a manual pass.

**Accessibility.** `tests/a11y` is the browser suite. A new route,
view or state gets a test there (`CLAUDE.md`).

The browser suite has an explicit ESM boundary and an isolated Vite configuration. Typed municipal
fixtures replace all branding inputs and disable installation environment files. CI runs Sundsvall
first, then Neutral/custom branding cases sequentially, with one worker. Reports and bundles have
separate profile directories. `apps/web/tests` proves the configuration boundary with small in-memory
Vite bundles; it never builds the whole application or starts a server/browser. Temporary env files
and generated modules are removed, and mutated environment variables are restored.

## Rules the tools enforce

- `dependency-cruiser` (`bun run deps`): `usecases-reach-stores-through-ports` (a use case never imports `@clew/db`,
  Drizzle, Postgres, Temporal, an adapter or the composition root; an error for every `usecases` folder),
  `unit-tests-stay-fast` (`tests/unit` never imports a live adapter, the composition root,
  `@clew/db` or Temporal; a type needed from the schema comes from `packages/db/src/schema.ts`, because TypeScript 7
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
docker exec -w /workspace clew-app-1 bun run test:durability # real Node, PostgreSQL, Temporal and synthetic fault source
sh scripts/a11y.sh                                           # the WCAG suite
```

### Running the WCAG suite

`sh scripts/a11y.sh` builds the web app once, then runs the suite in the pinned Playwright image; everything after the
script name goes to `playwright test`. The full suite is 287 tests on one worker, about eight minutes when green and
much longer when red, so it is not the per-edit check ([D51](../decisions/D51-the-wcag-suite-is-cis-gate.md)):

- Per change, run the spec files the change touches: `sh scripts/a11y.sh menu.spec.ts shell.spec.ts`. Add
  `--timeout 15000` so a red run fails in seconds instead of waiting out 30 s per test.
- During the lab phase the whole suite runs by hand: `gh workflow run a11y.yml`, or `sh scripts/a11y.sh`
  ([D59](../decisions/D59-the-wcag-suite-runs-by-hand-until-the-run-up-to-a-release.md)). Nothing waits for it before
  landing on `main`. In the run-up to a release the `push` and `pull_request` triggers in
  `.github/workflows/a11y.yml` come back, and with them D51's gate: the GitHub plan cannot block a merge on a red run,
  so read the WCAG check of the previous landing before landing on `main` again, and fix a red check before new work
  lands.
- A test that passes alone and fails on a slower runner is holding a timer it should hold a promise for (see
  `api.holdAnswer()` and HANDOVER session 41).
- Two runs in the same checkout empty each other's `test-results`; give the second `--output=test-results/<name>`.

## What is ported

Everything in the server that holds logic is over ports (D25), each with `adapters/postgres.ts` (plus `temporal.ts`
or `provider.ts` where a service is involved) beside `adapters/memory.ts`, wired in `apps/server/src/composition/`:

| Folder | Factory | Ports (`model.ts` or `ports.ts`) | Scenario tests |
|---|---|---|---|
| `threads/usecases/` | `threadUsecases`, `reminderUsecases` (including `surface`, the Temporal activity's body) | `ThreadStore`, `ThreadTx` (with `lockThread`), `ReminderTimers` | `tests/unit/threads.test.ts` |
| `modules/calendar/usecases/` | `calendarUsecases` | `ProposalStore`, `CalendarBinder`, `CalendarProvider` (D11) | `tests/unit/samtal.test.ts` |
| `scheduler/` | `createScheduler` | `JobQueue`, `People` | `tests/unit/scheduler.test.ts` |
| `assistant/` | `assistantUsecases` | `ThreadStore`, `ModelProvider` | `tests/unit/conversation.test.ts` |

`temporal/activities.ts` and `temporal/workflows.ts` call use cases through the composition root. Durable timer generations, execution progress, bounded follow-up and scheduled job ownership are tested separately from workflow history compatibility. The fixture `apps/server/tests/fixtures/workflows-v46.ts` preserves the previous workflow functions for replay. `today()` and `isPast()` in `@clew/calendar/dates` are for the browser;
the server derives the date from `clock()` and the purity guard refuses them.

Still outside the pattern, on purpose: `auth.ts`, `system-context.ts` and `connectors/remote.ts` (identity and
connector loading, platform code over `@clew/db` directly) and the connector descriptors `modules/*/connector.ts`
(`people` reads the grant tables; it is Clew's own core record and has no port yet).

The shared follow-up contract (`tests/followup-contract.ts`) runs on memory and PostgreSQL. Calendar execution projection, refresh/attention and ownership have PostgreSQL scenarios in addition to pure/use-case tests. Runtime tests are required for boundaries memory cannot prove: real transactions, process/protocol response loss and Temporal history replay. Keep these in the separate reliability lane, not the fast suite.

The older `scripts/auth-dev-check.ts` assumes synchronous decisions and refresh. It is a historical development smoke script, not a current acceptance gate for the asynchronous lifecycle; do not use its results to claim this roadmap is verified. `scripts/jobs-check.ts` runs the job across systems on the fixture connectors of the development stack (D61). Use the maintained suites above and the [acceptance matrix](../reference/reliability-acceptance.md). A live login/calendar run still needs an updated scenario, authorized synthetic records and explicit source assertions.
