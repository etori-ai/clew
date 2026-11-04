# Creating an integration

How to connect a system to Clew. Read `docs/architecture/integrations.md` for the principles and
`docs/architecture/integration-paths.md` for the menu of paths; this guide is the order of work. A
complete worked example, a municipality with a custom employee directory, is in
`example-custom-directory.md`.

Two ways exist, and the order between them is fixed (D10):

1. **The system fulfils Clew's contract.** The system's owner implements the API Clew has defined for the
   domain. Clew needs no code for it beyond configuration. Section 2 says what the owner has to build.
2. **Clew gets an adapter.** When the system cannot or will not do that, an adapter is written in this
   repository, from the system's protocol to Clew's contract. Sections 3 to 9 are that work.

In both cases the contract is Clew's and does not bend to the system.

## 1. Before writing anything

Answer these in a short note; they become the top of the module's file comment and a row in the landscape
table in `integration-paths.md`.

| Question | Why it matters | Where the answer goes |
|---|---|---|
| Who owns the records? | Decides the module kind: pass-through (the system keeps them, Clew stores refs and audit), derived (a scheduled snapshot), core (Clew is the system of record, needs a decision) | `Module.kind` |
| What does a person need from it, today, that makes them act? | Each answer is a capability: a read to look, a propose to draft, an execute to do. If nothing makes a person act, the system may only need link-out and search | The capability list |
| Who may see and do what, and how is a call narrowed to that person's unit or own records? | Becomes the `scope` function on every capability, evaluated on every call | `Capability.scope` |
| How does the system recognise the user? Tokens from the shared IdP, its own accounts, or one integration account? | Picks the auth mode: `user-delegated`, `bound-credential` or `service` | The adapter's credential type |
| Does the system have an API at all? | No API means read through whatever exists plus link-out; writes are not offered in v1 | Capability kinds |
| What is the system's licence and that of any client library? | Open source only, OSI licence, checked before pinning | `HANDOVER.md` section 3 |
| Does a dept44 service, another municipality or a vendor already expose this domain? | May already fulfil the contract, or be the only API there is | The landscape table |

Nothing about the model is in that list. The model reads capability titles and descriptions; it never
gets a capability of its own.

## 2. Path one: the system fulfils Clew's contract

What the owner of the system implements, so that Clew needs no adapter:

- **The provider interface for the domain**, as an HTTP API with the same operations, inputs and outputs.
  Clew publishes the shape as OpenAPI generated from the TypeBox schemas in `packages/contracts` (D2 says
  OpenAPI is Clew's output). Today the only published contract is `CalendarProvider`; a new domain's
  contract is written in Clew first (section 4) and then published.
- **The user, not a service account**, on every call that returns personal rows: accept access tokens from
  the organisation's IdP with Clew's audience, or document that only `service` mode is available and that
  Clew will narrow every call itself.
- **Refs that are stable**, so Clew can store them, link to them and recognise the same occurrence twice.
- **An outcome per row on every write**, so Clew's receipt can read back done, failed or unknown. A lost
  reply is `unknown`, never success.
- **A deep-link template per entity type**, for link-out.

Clew's side is then a generic HTTP adapter for that contract plus configuration (base URL, credential,
auth mode). The generic adapter does not exist yet; the first system that takes this path builds it.

## 3. Path two: the module and its adapter

An integration in this repository is a **module** (`packages/modules`, the `Module` type) with its
capabilities, areas and scan, and an **adapter** behind it that speaks the system's protocol. Keep the
two apart from the start: the module knows Clew's contract and nothing about HTTP, SOAP or CalDAV; the
adapter knows the protocol and nothing about cards or scope. The calendar is the pattern:
`packages/calendar/src/model.ts` is the contract, `nextcloud.ts` an adapter, `adapters.ts` the factory,
`apps/server/src/calendar-module.ts` the module.

Layout for a new domain `<name>`:

```
packages/<name>/
  src/model.ts          the provider interface: Clew's contract for the domain
  src/adapters.ts       credential union and createXProvider(credential) factory
  src/adapters/<kind>.ts  one file per system, implements the interface
  src/module.ts         the Module: capabilities, areas, scan, built on the interface
  package.json          exact versions, OSI licences only
tests/unit/<name>.test.ts
```

Mock modules under `packages/modules/src/mock/` keep records in a `StateStore` instead of an adapter;
they are the shape to copy for capabilities, scan and areas.

## 4. Write the contract first

`model.ts` is a TypeScript interface plus TypeBox schemas for everything that crosses it. Rules:

- Domain granularity, not endpoint granularity. "Search people", "a person's contact card", "pending
  leave requests for a unit", never "GET /v2/employees?page=".
- Every row has a `ref`: a string Clew can store and hand back, prefixed with the module id
  (`heroma:leave:2026-1187`).
- Outputs are rows the UI renders; no markup, no links to be followed by the browser, no names of
  individuals where a card would show them (the names guardrail; names belong in a panel view or the
  source system).
- Writes return an outcome per row and, when reversible, what reverses them.
- Write the interface so that it is the tool surface an MCP server would expose if the adapter were
  lifted out of process (D3). If it reads well as five to ten tool descriptions, it is right.

## 5. Write the adapter

- One credential type per system in a union, selected by `kind`, as in `packages/calendar/src/adapters.ts`.
  The factory throws a configuration error for a kind that is decided but not built.
- Declare the auth mode in the credential type and honour it: `user-delegated` takes a token function
  for the current user, `bound-credential` a per-user secret from Clew's DB, `service` one integration
  credential and nothing about the user. In `service` mode the module narrows the call (next section);
  the adapter never widens it.
- Translate the system's errors into the contract's: not found, denied, unavailable, unknown outcome.
  Never let a protocol exception reach a capability.
- Store nothing. Not a cache, not a log line with a row in it. Refs and outcomes only.
- Dependencies: standard-library `fetch` first; a client library only if it is OSI-licensed and
  pinned exactly. Record the licence check.

Configuration is read in one place, from the environment: `<NAME>_ADAPTER=<kind>`, `<NAME>_URL`, and the
credential from a secret, never from source. In dev that is `apps/server/.env.local`; `.env.example` lists
the keys with empty values.

## 6. Write the module

For each capability, in `module.ts`:

| Field | What to put there |
|---|---|
| `name` | `<module>.<verb>`; the registry refuses any other prefix |
| `kind` | `read`, `propose` or `execute`. Anything that changes the source is `execute` |
| `title`, `description` | Swedish; the title is a button label, the description is what the model reads. Say what the capability does and for whom, in one sentence |
| `input`, `output` | TypeBox schemas with `additionalProperties: false`; the BFF validates input before `run` is called |
| `model` | `true` only for `read` and `propose` that a model should be able to call. `execute` must be `false`; the registry throws otherwise (D8) |
| `scope` | A function of the `Actor` (id, name, unit, role) returning whether this person may call it at all. Called on every path: REST, card, tool |
| `run` | Narrows the call to the actor (unit, own records, period) before touching the adapter, then maps the adapter's answer to the output schema |

For `execute`, return an `ExecuteResult`: a Swedish `headline`, one `ReceiptRow` per ref with `outcome`
(`done`, `unknown`, `failed`, `skipped`) and a `detail` that is the source's answer read back, and
`undoCapability` plus `undoMinutes` when a compensating capability exists. Green in the UI comes only from
a read-back, so if the system cannot confirm, the outcome is `unknown`.

`scan(actor)` returns the thread drafts the module wants to push for this person right now:
deterministic, no model, and idempotent through `topic` (the same occurrence must produce the same topic
every night). Each draft names an `area`, a `reason` the card shows under "Varför ser jag detta?", items
with refs, and actions. Actions follow the thread action contract: at most one primary
(`execute` or `propose`), up to two secondaries (`read`, with `target: 'panel'` for a view or
`target: 'link'` for the source system), the rest overflow. Clew adds the standard actions itself.

`areas` are the sidebar entries for this module per role: a title, the roles that see it, the standing
capabilities under "Gör själv", the schedules the module runs, and optionally a figure. Reuse an existing
area id when the module belongs in one that exists.

## 7. Register and configure

- Add the module to the list in `apps/server/src/modules.ts`. That is the only place the BFF names
  modules; routes, cards, areas and tools derive from the registry.
- Add the package to the root `devDependencies` as `workspace:*` and run `bun install --frozen-lockfile`
  in the devcontainer.
- Add the environment keys to `apps/server/.env.example` and set them in `.env.local`.
- If the adapter is `user-delegated`, add the system as an audience in Keycloak (`scripts/auth-setup.ts`)
  and note the token path in `docs/architecture/identity.md`.

## 8. Test

- **Unit, no network:** a fake implementation of the provider interface in the test, the real module on
  top, the registry around it, as in `tests/unit/modules.test.ts`. Assert scope on every capability for a
  person in and out of scope, the shape of every output, that `scan` is idempotent across two runs, that
  an `execute` returns outcomes per ref and that its undo reverses them.
- **Adapter, against the real system or a recorded fixture:** one test per operation and one per error
  mapping. In dev the calendar does this against the Nextcloud container; a new system needs its own
  container or a recorded fixture, never a shared production endpoint.
- **End to end in Chrome:** the card appears after a scan, the primary action produces a receipt with
  the right outcomes, undo reverses it, "Varför ser jag detta?" shows the reason.

Run everything inside the devcontainer:

```sh
docker exec -w /workspace clew-app-1 bun run check
```

## 9. Document

- A row in the landscape table in `docs/architecture/integration-paths.md` with the path, auth mode and status.
- The licence check in `HANDOVER.md` section 3 and the module in the repository layout.
- A decision in `docs/decisions/` only if something was decided that a later session must not reopen:
  a new core domain, a new auth path, a new transport. Adding a pass-through module needs no decision.
- A line in the session log.

## What a review checks

- The contract is Clew's: nothing in `model.ts` names the system's endpoints, IDs or vocabulary.
- Every capability has a `scope` and `run` narrows further; no capability trusts anything from the browser.
- No `execute` with `model: true`. No capability that reads a secret or changes a module's state.
- The adapter stores nothing and logs no rows.
- Names of individuals appear only in panel views or link-outs, never in a card's title, summary or items.
- Every `execute` returns one outcome per ref and `unknown` when the source did not answer.
- `scan` is deterministic and idempotent by `topic`.
- Swedish only in titles, descriptions, headlines and error messages; English everywhere else.
- Every new dependency is OSI-licensed, pinned exactly, and recorded.
