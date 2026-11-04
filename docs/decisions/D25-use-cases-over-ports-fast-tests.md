# D25 · Use cases take their ports from a composition root; the unit suite runs on memory adapters held to a store contract

**Status:** accepted · **Date:** 2026-11-04 · **Area:** platform

**Decision.** A use case never reaches a database, a timer service, a calendar, the clock, an id source or
configuration on its own. It is built by a factory that receives those as ports: `threadUsecases(deps)` and
`reminderUsecases(deps)` in `apps/server/src/threads/usecases/` over `threads/model.ts` (`ThreadStore`, `ThreadTx`,
`ReminderTimers`), `calendarUsecases(deps)` in `modules/calendar/usecases/samtal.ts` over `modules/calendar/model.ts`
(`ProposalStore`, `ProposalTx`, `CalendarBinder`) and the `CalendarProvider` port from D11, and `mockUsecases(deps)`
over `modules/mocks/model.ts`; `clock()` and `ids()` are plain functions in `deps`. `apps/server/src/composition/`
is the one place that pairs use cases with their live adapters (`*/adapters/postgres.ts`, `threads/adapters/temporal.ts`,
the cached `bindCalendar`): `calendar.ts` first, because the registry builds the calendar connector over those use
cases, then `index.ts` for the stream over the registry. Routes, the scheduler, the assistant and the registry import
the built use cases from there. The tests build the same use cases over the memory adapters (`*/adapters/memory.ts`,
`@clew/calendar/memory`), whose transaction is a snapshot that rolls back the audit row with everything else.

Each store port is held to one behaviour by a contract, `tests/store-contract.ts` and `tests/proposal-store-contract.ts`,
run twice: against the memory adapter in `bun test tests/unit` (part of `bun run check`), and against Postgres by
`bun run test:db` inside the devcontainer. Everything else in `tests/unit` trusts the memory adapters. `bun run check`
therefore never needs Postgres, Temporal, Keycloak, Nextcloud, a browser or the network, and CI keeps running it
without the stack.

Enforced, not reviewed: `dependency-cruiser` rules `usecases-reach-stores-through-ports` (an error for every
`usecases` folder: no `@clew/db`, Drizzle, Postgres, Temporal, adapter or composition import) and
`unit-tests-stay-fast` (`tests/unit` never imports a live adapter, the composition root, `@clew/db` or Temporal;
types may come from `packages/db/src/schema.ts`), plus `scripts/purity-check.ts` in `bun run check`, which fails on
`Date.now()`, `new Date()`, `process.env`, `randomUUID()` and `Math.random()` in domain files and every use case.
The kinds of test, where a new one goes and how a scenario test is written are in `docs/architecture/testing.md`.
`fast-check` 4.10.2 (MIT) is added for property tests of domain functions, starting with the planner.

Two system mutations that wrote no audit row now do, because the memory store made the gap visible: a scan that
refreshes an untouched card writes `thread.refreshed` (and only when the draft actually changed), and the scheduler
closing an undo window writes `thread.receipt_final` with actor `system:scheduler`.

**Why.** D20 said use cases are tested "with a fake port", but every use case imported `database()` directly, a
module-level singleton that reads `DATABASE_URL` and opens a client on first call, and read the clock in thirty
places. The domain layer had good tests; the use cases, which own the one invariant that matters most, "every
mutation writes its audit row in the same transaction", had none, and could not have any without Postgres. The
choice was between integration tests against a container for every use case, which are slow, order-dependent and
need the stack in CI, and one seam that makes the use cases unit-testable. The seam wins: a scenario test of the
whole stream (scan, act, undo, snooze, reminder) runs in a millisecond against the real registry, the real mock
connectors and the memory store, and the only slow test the stream has is the contract that proves the memory
store faithful. A factory over a `deps` object was chosen over a last parameter with defaults because a default
would import the adapter again, and over a module-level singleton because the singleton is what made the tests
impossible. Tests do not mock modules (`mock.module`) because a mock of an import hides the dependency the rule
is meant to expose.

**Replaces.** Nothing. It narrows D20's import table: a use case may no longer import `@clew/db` or an adapter;
it imports its ports and gets the adapter from `composition/`. The D20 debt item "`threads/usecases/cards.ts`
imports the calendar's proposal use cases" is now a `deps.calendar` port handed in by the composition root, still
a coupling, now in one visible place. Still writing threads directly, outside any `usecases` folder and recorded in
`testing.md` as next: `temporal/activities.ts` (`surfaceReminder`, an adapter by D20) and the clock reads in
`packages/calendar/src/dates.ts` (`today()`, `isPast()`).
