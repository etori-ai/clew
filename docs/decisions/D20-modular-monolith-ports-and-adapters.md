# D20 · Backend structure: a modular monolith with ports and adapters, not tactical DDD

**Status:** accepted · **Date:** 2026-11-04 · **Area:** platform

**Decision.** The backend is one process (`apps/server`) organised by module, with four kinds of file inside a
module and one direction of imports: `contracts` (schemas, types, errors; imports nothing of ours), `domain`
(pure functions, no I/O), `usecases` (one exported function per user action; owns the scope check, the
transaction and the audit row; depends on ports), `adapters` (Drizzle, CalDAV, HTTP, Temporal activities;
implement ports). Routes sit outside the modules: parse, validate, call one use case, map errors. A module
never imports another module; it calls the other module's capabilities through the registry as the acting
person (`clew.call` in process, `POST /api/module/call` from a module service, D21), reads and proposals
only, scope re-checked, never `execute`. The rules are enforced by `dependency-cruiser` in `bun run check`
(`.dependency-cruiser.cjs`), not by review. The layout and the rules are in
`docs/architecture/backend-structure.md`; the short form is in `CLAUDE.md`.

**Why.** The code already had this shape (D1, D3, D11: contracts in TypeBox, provider interfaces with
adapters, thin Hono routes calling one function that owns the transaction) but nothing named it, three files
had grown into grab-bags and two routes read the database directly. Naming the shape and checking it
mechanically keeps contributions uniform without a review step per pull request.

Tactical domain-driven design (aggregates, entities with behaviour, repositories, domain events) was
rejected: most records live in other systems and Clew holds refs and audit rows, so aggregates would wrap
refs, and the class and repository ceremony contradicts the functional, schema-first style. The strategic
half of DDD is kept: a module is a bounded context, the contracts are its language. Controller, service and
repository layering was rejected because it organises by layer and hides the module boundary, which is the
one that matters for shipping modules separately (D21). Strict Clean Architecture with a package per ring
was rejected as too heavy for a BFF of a few thousand lines.

**Replaces.** The implicit structure of sessions 1 to 12. `apps/server/src/modules.ts`, `planner.ts`,
`calendar.ts`, `calendar-module.ts`, `people-module.ts`, `figures.ts` and `reminders.ts` moved into
`modules/<name>/` and `threads/` folders; the `/calendar` and `/attention` routes and the thread reads now
go through use cases. The rule in `working-across-modules.md` that a composite calls other modules only
through the registry is now enforced.
