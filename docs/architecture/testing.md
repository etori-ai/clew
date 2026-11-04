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
| A use case (`threads/usecases/*`, later `modules/*/usecases`) | A scenario test: real registry, mock connectors, memory store, a clock the test owns; asserts the state the store ends up in and the audit rows written | `tests/unit/threads.test.ts` or a sibling per use case folder | `bun run check` |
| A store port (`threads/model.ts`, `modules/calendar/model.ts`) or a store adapter | Add a case to that store's contract; it must pass on both adapters | `tests/store-contract.ts` and `tests/proposal-store-contract.ts`, each run by a `tests/unit/*-store.test.ts` and a `tests/db/postgres-*.test.ts` | `bun run check` (memory) and `bun run test:db` (Postgres) |
| An adapter for an external system (CalDAV, a remote connector's HTTP, Microsoft Graph) | Parse and translate a recorded response; the protocol's edge cases as fixtures | `tests/unit/<adapter>.test.ts` with fixtures in the test file or `tests/fixtures/` | `bun run check` |
| A route | Nothing of its own while it stays thin (parse, validate, call one use case, map errors). Hono's `app.request()` serves a route in process if a test is ever needed | `apps/server/tests/runtime.test.ts` shows the pattern | `bun run test:node` |
| A connector built here (`connectors/<name>`) | Its own tests inside its folder; the conformance checker `bun scripts/connector-check.ts` against it running | `connectors/<name>/` | the connector's own CI |
| A view, route or state in the web app | An accessibility test (axe, keyboard, reflow, announcements) | `tests/a11y/` | `sh scripts/a11y.sh`, CI `a11y.yml` |
| A flow that crosses the stack (login, nightly scan, a reminder firing) | The smoke script against the running dev stack; a manual pass | `scripts/modules-check.ts` | by hand, before a release |

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
`Registry` with the mock connectors over `memoryState()`, `memoryThreadStore()`, `memoryTimers()`, a `fakeClock()`
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

**Accessibility.** `tests/a11y` is the only browser suite and the only one allowed to be slow in CI. A new route,
view or state gets a test there (`CLAUDE.md`).

## Rules the tools enforce

- `dependency-cruiser` (`bun run deps`): `usecases-reach-stores-through-ports` (a use case never imports `@clew/db`,
  Drizzle, Postgres, Temporal, an adapter or the composition root; an error for every `usecases` folder),
  `unit-tests-stay-fast` (`tests/unit` never imports a live adapter, the composition root,
  `@clew/db` or Temporal; a type needed from the schema comes from `packages/db/src/schema.ts`, because TypeScript 7
  has no compiler API and the cruiser cannot tell `import type` apart), `domain-is-pure`, `routes-stay-thin`.
- `scripts/purity-check.ts` (`bun run purity`): no `Date.now()`, `new Date()`, `process.env`, `randomUUID()` or
  `Math.random()` in domain files and use cases. The clock and the id source are `deps.clock` and
  `deps.ids`; the composition root reads configuration.
- `bun run check` = typecheck, deps, purity, `bun test tests/unit`, the Node runtime tests. It must never start to
  need the stack; `.github/workflows/check.yml` runs it with `--no-deps`.
- `bun test` does not use `mock.module`. A mocked import hides the dependency the rules are meant to expose; a fake
  behind a port is the same dependency made visible.

## Commands

```sh
docker exec -w /workspace clew-app-1 bun run check          # everything CI runs, no stack needed
docker exec -w /workspace clew-app-1 bun test tests/unit     # the fast suite alone
docker exec -w /workspace clew-app-1 bun run test:db         # the store contract against Postgres
sh scripts/a11y.sh                                           # the WCAG suite
bun scripts/modules-check.ts                                 # the smoke script on the host, against the dev stack
```

## What is ported and what is next

Every `usecases` folder is over ports (D25): `threads/usecases/{cards,reminders}.ts` over `threads/model.ts`,
`modules/calendar/usecases/samtal.ts` over `modules/calendar/model.ts` and the `CalendarProvider` port, and
`modules/mocks/usecases.ts` over `modules/mocks/model.ts`; each with `adapters/postgres.ts` (and `temporal.ts` for
the timers) beside `adapters/memory.ts`, wired in `apps/server/src/composition/`.

Next, each with its scenario tests and a contract case where a port grows:

1. `temporal/activities.ts` (`surfaceReminder`) writes threads directly; it is an adapter by D20 and may, but the
   reminder's return is untested until it goes over `ThreadStore`.
2. `packages/calendar/src/dates.ts`: `today()` and `isPast()` read the clock; callers pass `now` instead. The
   assistant still uses `today()`.
3. The assistant: its model provider is already a port; the fixed answers and chips call the calendar use cases
   from the composition root, which a test can replace with memory ones once the assistant is a factory too.

When integration tests are the right answer: proving a query against the real database (the contract), a protocol
against a recorded response (fixtures), and the stack end to end before a release (the smoke script, by hand).
Nothing else.
