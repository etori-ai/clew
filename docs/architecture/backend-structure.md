# Backend structure

Clew's server is a modular monolith: one Node application, organised by responsibility, with ports and adapters at the edges. External integrations are independent connector services. Start with the [architecture overview](overview.md) for the running system; this page maps it to code.

A **module** is a bounded responsibility inside the server. A **connector** is an integration contract and deployment unit an operator or source developer meets. A **capability** is an operation exposed through the registry. These are related concepts, not interchangeable names.

## Repository map

```text
apps/
  server/src/       Node/Hono backend and embedded Temporal worker
  web/src/          Startsidan React frontend
  portal/src/       experimental second frontend over the same server
packages/
  contracts/src/   shared TypeBox schemas and types
  connectors/src/  capability registry, protocol, transport and validation
  db/src/          PostgreSQL schema, migrations and database adapters/helpers
  calendar/src/    calendar domain, provider port, CalDAV and Microsoft 365 adapters
  ui/src/          shared Astryx-based UI, branding and calendar rendering
connectors/
  hello/           small protocol demonstration; in-memory writes
  phonebook/       read/search/view example with fixture and HTTP adapters
  reference/       synthetic durable source for execution recovery
  eneo/            optional delegated document-retrieval connector
  hr/ finance/ incidents/ communication/ timesheet/ payroll/
                   independent synthetic sources in the development stack
tests/             unit, shared store/provider contracts, database and browser suites
scripts/           development, conformance, migration and documentation commands
```

Connectors under `connectors/` import no Clew application or workspace package. Neither `apps/` nor `packages/` imports their runtime implementation; the served protocol's documentation examples are the explicit exception. Tests can run their handlers in-process while still exercising the remote protocol. See [D61](../decisions/D61-fixture-sources-are-independent-connectors.md).

## Server map

| Folder/file | Responsibility |
|---|---|
| [main.ts](../../apps/server/src/main.ts), [startup.ts](../../apps/server/src/startup.ts) | HTTP app, readiness, registration initialization and starting dispatchers/worker. |
| [auth.ts](../../apps/server/src/auth.ts), [system-context.ts](../../apps/server/src/system-context.ts) | Session-backed identity and current-grant identity for background work. |
| [routes/](../../apps/server/src/routes/) | Auth, business API, connector callbacks/public keys, administration and served protocol. |
| [composition/](../../apps/server/src/composition/) | Wires ports to live stores, calendar providers, model endpoints, clocks, ids and workflow delivery. |
| [connectors/](../../apps/server/src/connectors/) | Live registry, signed authority, remote registration, reconciliation and administration. |
| [threads/](../../apps/server/src/threads/) | Authorized card/history reads, occurrence refresh, decisions, reminders, timers and attention. |
| [assistant/](../../apps/server/src/assistant/) | Conversation/router, model tools, answer context, provider/model administration and adapters. |
| [modules/calendar/](../../apps/server/src/modules/calendar/) | Calendar capabilities, planning, reads, approval, execution and bounded follow-up. |
| [modules/people/](../../apps/server/src/modules/people/) | Internal user reads over a `UserReads` port; no managed connector lifecycle. |
| [modules/search/](../../apps/server/src/modules/search/) | Composite search, source budgets, result contracts and answer-card capability. |
| [modules/executions/](../../apps/server/src/modules/executions/) | Approval ledger, source progress/reconciliation, compensation, job/watch state and outbox dispatch. |
| [modules/jobs/](../../apps/server/src/modules/jobs/) | Fact/follower binding and cross-system proposal assembly. |
| [modules/operations/](../../apps/server/src/modules/operations/) | Reliability diagnostics over ports. |
| [scheduler/](../../apps/server/src/scheduler/) | Scheduled job use cases, queue and durable ownership adapters. |
| [temporal/](../../apps/server/src/temporal/) | Workflow definitions, activities, worker and delivery adapters. |

There is no bundled `packages/connectors/src/mock` implementation or separate `modules/figures` module. Figures come from connectors through the registry. Model providers are administered in the database, not selected by an `adapters/provider.ts` environment adapter.

## Dependency direction

```mermaid
flowchart LR
  Routes[Routes] --> Composition[Composition root]
  Composition --> UseCases[Use cases]
  Composition --> Adapters[Live adapters]
  UseCases --> Ports[Ports and contracts]
  UseCases --> Domain[Pure domain functions]
  Adapters --> Ports
  Domain --> Contracts[Contracts]
```

Ports are interfaces describing what a use case needs, such as a store, clock or source operation. An adapter implements a port using PostgreSQL, a network protocol or memory. A test supplies memory adapters to the same use case factory that production uses.

| Kind | Typical location | Rules |
|---|---|---|
| Contracts and ports | `packages/contracts`, module `model.ts`, `ports.ts` or `contracts.ts` | Schemas, types, errors and interfaces. No business I/O. |
| Domain | `domain.ts` or domain helpers | Pure computation. No database, network, clock, runtime framework or Node built-in. |
| Use cases | `usecases.ts` or `usecases/` | User operations receive the actor, not an HTTP request. Own access checks and transactional state/audit through ports. Time and ids are supplied dependencies. |
| Adapters | `adapters/`, calendar provider files, database package | Translate a port into a real system's protocol or persistence, including transactional evidence. Memory versions support tests. |
| Routes | `routes/` | Parse, validate, call the application layer, map errors to safe Swedish responses. No direct database or adapter imports. |
| Composition | `composition/` | Selects and wires live dependencies. Application entry points use the composed functions. |

Modules do not import other modules or the routes, threads, assistant or workflow layer. When one capability needs another, use the registry's `clew.call` handle, or the signed callback route from a remote connector. Both preserve the actor and refuse executes. Platform composition can coordinate several modules through their ports.

The [dependency rules](../../.dependency-cruiser.cjs) enforce these boundaries. The [purity check](../../scripts/purity-check.ts) rejects clocks, environment reads and random identifiers in use cases/domain code. Change the rules only with the architectural decision that changes the boundary.

## Follow one path through the code

| Behavior | Start here | Then follow |
|---|---|---|
| Read a declared view | [Capability routes](../../apps/server/src/routes/api.ts) | [Server registry](../../apps/server/src/connectors/registry.ts) → [capability registry](../../packages/connectors/src/index.ts) → [remote transport](../../packages/connectors/src/remote.ts) |
| Discover source work | [Refresh composition](../../apps/server/src/composition/refresh.ts) | [Refresh use cases](../../apps/server/src/threads/usecases/refresh.ts) → store/registry ports |
| Approve a card action | [Card decisions](../../apps/server/src/threads/usecases/decisions.ts) | [Execution composition](../../apps/server/src/composition/executions.ts) → [execution use cases](../../apps/server/src/modules/executions/usecases.ts) → outbox/workflow |
| Configure a connector | [Administration routes](../../apps/server/src/routes/admin.ts) | [Connector use cases](../../apps/server/src/connectors/usecases/admin.ts) → store and [reconciliation](../../apps/server/src/connectors/reconcile.ts) |
| Read Clew's users | [Internal capabilities](../../apps/server/src/modules/people/capabilities.ts) | [UserReads port](../../apps/server/src/modules/people/ports.ts) → [composition](../../apps/server/src/composition/people.ts) |

## Existing special cases

The architecture is a boundary to preserve, not a claim that every historical path is already identical. Calendar has dedicated API/UI paths and is wired directly into parts of the thread and assistant composition. Its source writes nevertheless converge on the execution ledger. The live thread composition replaces the older synchronous `ensureThreads` path with `refresh.request`; some unit scenarios still exercise the older helper.

Authentication and connector loading are platform code with direct database access. Temporal activities call composed use cases. Old workflow functions remain for history compatibility; removing them requires replay/retirement evidence. These are different concerns from permitting a new vendor integration inside the monolith.

## Verify a change

```sh
docker exec -w /workspace clew-app-1 bun run deps
docker exec -w /workspace clew-app-1 bun run purity
docker exec -w /workspace clew-app-1 bun run check
```

The full check includes formatting, types, dependency/purity rules, fast tests, Node runtime tests and documentation checks. It needs installed dependencies but no running external services. Store changes also need PostgreSQL contracts; workflow/source-effect changes need the relevant runtime scenarios. [Testing](testing.md) describes those separate lanes.
