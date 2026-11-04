# Backend structure

How `apps/server` and the packages are laid out, what goes in which file, and the rules `bun run deps`
enforces. Implements D20. For how a module reaches the outside world and other modules, see
`connector-protocol.md` (D21, D22) and `working-across-connectors.md`. "Module" here is D20's code word, a bounded
context in this process; the integration unit a person, an operator or a vendor meets is a **connector** (D22).

## The shape in one paragraph

A modular monolith: one Node process, organised by module, with ports and adapters at the edge. Inside a
module the code is functional TypeScript in four kinds of file. Routes are thin and sit outside the modules.
A module never imports another module; it calls the other module's capabilities through the registry as the
acting person. It is the strategic half of domain-driven design (a module is a bounded context; the
contracts are its language) without the tactical half (no aggregates, entities, repositories or domain
events), because most records live in other systems and Clew holds refs and audit rows.

## Layout

```
apps/server/src/
  main.ts  context.ts  auth.ts  auth-crypto.ts  system-context.ts  scheduler.ts     platform
  routes/            auth.ts, api.ts, connectors.ts     HTTP only: parse, validate, call one use case, map errors
  threads/usecases/  cards.ts, reminders.ts             the stream (Clew core): scan into cards, act, undo, snooze, dismiss, reminders, attention
  assistant/         router, model, chips, objects…     the composer's deterministic router and the optional model (D8)
  temporal/          worker, workflows, activities      durable timers (D17)
  connectors/        platform: the connector registry and the remote transport
    registry.ts      the registry the BFF runs with: bundled connectors + remote connectors; runCapability, callFromConnector
    remote.ts        remote-connector configuration, assertions, loader (D21)
  modules/
    calendar/        connector.ts, usecases/reads.ts, usecases/samtal.ts
    people/          connector.ts
    figures/         domain.ts
    mocks/           usecases.ts (dev reset)
packages/
  contracts/         TypeBox schemas and types shared by server, web and connectors. Imports nothing of ours.
  connectors/        the capability layer: Connector, Capability, Registry; protocol.ts; remote.ts; mock/ (bundled mock connectors)
  db/                Drizzle schema, migrations and queries: an adapter
  calendar/          the calendar domain: model.ts (port), dates and proposals (domain), nextcloud.ts and adapters.ts (adapters)
connectors/
  hello/             a connector: built the way a third party builds one, depends on nothing above (D21)
```

## The four kinds of file

| Kind | File name | May import | Holds | Tested how |
|---|---|---|---|---|
| contracts | `packages/contracts`, or `model.ts` in a domain package | TypeBox only | Schemas, types, error classes, the port (provider interface) | By the schema tests of its users |
| domain | `domain.ts` or `domain/` | contracts, other domain files | Pure functions: planning, date arithmetic, attention levels, figures. No database, no network, no runtime library, no Node built-in | `bun test`, no database, no fakes needed |
| usecases | `usecases.ts`, or `usecases/<topic>.ts` when one file gets long | contracts, domain, ports, `@clew/db`, the registry | One exported function per user action. Takes the actor (`AuthenticatedContext`) first, never a request. Owns the scope check, the transaction and the audit row in that transaction | `bun test` with a fake port, or the Node runtime tests |
| adapters | `adapters/<kind>.ts`, `nextcloud.ts`, `packages/db`, `temporal/activities.ts` | contracts, the port, protocol libraries | One system's protocol, translated to the port. Stores nothing, logs no rows | Against a container or a recorded fixture |

Outside the modules:

- **Routes** (`routes/`): parse and validate the body against a contract, call one use case, turn errors into
  Swedish JSON. Never `@clew/db`, never an adapter, never business logic. A route that grows a second
  statement of logic is a use case that has not been written yet.
- **The registry** (`connectors/registry.ts`): the only place that names connectors. Everything else, routes,
  cards, tools, the composer, derives from it. It is platform code, outside `modules/`.
- **`connector.ts`**: the registry descriptor for a bundled module (capabilities, areas, scan) built on the
  module's use cases. A remote connector has the same content as a manifest instead.

## Rules

1. One folder per module. Core modules under `apps/server/src/modules/<name>/`; a domain with a port and
   adapters as `packages/<name>/`; a connector built here under `connectors/<name>/`. Nothing module-specific at the
   server root.
2. Imports flow one way: routes, then usecases, then domain, then contracts, with adapters only reached
   through a port from a use case. The table above is exhaustive; a file that does not fit one kind is two files.
3. A use case takes the actor first and never receives a request object. Scope is enforced there or in the
   registry, never in a route and never from the browser.
4. Ports are interfaces in the domain's package; adapters are chosen by a factory from configuration
   (`packages/calendar/src/adapters.ts` is the pattern). A use case never imports an adapter by name.
5. A module never imports another module. In process it calls `clew.call(name, input)`, the handle every
   `run`, `scan` and `figure` receives; from a connector it posts to `/api/connectors/call`. Both re-check
   the other module's scope for the same actor and refuse `execute`. The stream (`threads/`) and the
   assistant are platform code and may call a module's use cases directly; the proposal path of the
   calendar (`ensureProposalThread`, `replan`, `confirm`) is the one such coupling today and is recorded as
   debt below.
6. The direction is checked by `dependency-cruiser` (`.dependency-cruiser.cjs`) in `bun run check`, so a
   pull request that breaks it fails CI. Change the rules file together with the decision that changes the rule.
7. Every module ships its unit tests for domain and use cases and runs without its external system: a mock
   adapter for a bundled module, a fixture mode for a connector (D8).

## Checking it

```sh
docker exec -w /workspace clew-app-1 bun run deps     # dependency rules only
docker exec -w /workspace clew-app-1 bun run check    # tsc, deps, bun test, node tests
```

A violation prints the rule name, the file and the import. The rule names are the comments in
`.dependency-cruiser.cjs`.

## Debt recorded at D20

- `threads/usecases/cards.ts` imports the calendar's proposal use cases; the target is a
  `calendar.proposeWeek` propose capability so the stream only knows the registry.
- `routes/api.ts` still has `/today`, `/calendar` and `/figures`, which predate capabilities; the target is
  that the web reads them through `/api/cap/calendar.today` and a `figures.read` capability.
- `assistant/` calls calendar use cases directly for chips and fixed answers; same target.
- The bundled mock connectors (`packages/connectors/src/mock`) are in-process; they become connectors
  under `connectors/` when the dev compose can run them (D21).
