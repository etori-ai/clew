# Working across connectors

> **Reading status:** Composition rationale. Current cross-connector calls require explicit uses strings and a separately signed callback grant, with current-access checks. Historical identity provisioning and callback examples below are not the current wire contract. See [implementation status](../reference/status.md) and the [current protocol](../reference/connector-protocol.md).


How a person's work spans several connectors, and how Clew combines data from more than one source without a
query engine. Startsidan explored the general problem (docs 03, 24, 25, 26, 27: semantic types, a
catalogue, a validated query plan, DuckDB joins). Clew keeps the lessons and drops the engine. Written
2026-11-04 against the code as it is; each mechanism says whether it is built.

## The short answer

Clew joins on **identity** and on **refs**, inside a capability, at request time, for one use case at a
time. There is no cross-source query language, no catalogue of joinable fields and no engine that
executes a plan. Three things make that enough:

1. **Clew owns the keys.** The person id and the unit id are Clew's (core connector `people`, provisioned
   by SCIM). Every connector maps its records onto them. So "my", "my unit's" and "this colleague" mean the
   same thing in every connector without a join table in a query.
2. **Refs travel, rows do not.** Every object has a ref (`hr:emp:1001`, `event:…`,
   `directory:person:42`). A card, a chip or a capability input can carry refs from several connectors at
   once; the owning connector is asked for the rows when they are needed, as the user.
3. **Composition is a capability.** When a use case needs two sources, a `read` or `propose` capability
   in code calls the other connectors' reads through the registry and combines them. The planner that draws
   utvecklingssamtal proposals is the first one: who needs a talk (HR), which talks are held and where
   the gaps are (calendar), what to propose.

That trades generality for three guarantees startsidan had to engineer: each source's scope is applied
before anything is combined, nothing combined is stored except refs and the decision, and a composite that
loses a source says so instead of presenting a complete-looking result.

## The three join keys

| Key | Owner | Comes from | Used for | Status |
|---|---|---|---|---|
| Person id (`actor.id`) | Clew core | SCIM; the OIDC subject binding at login | "Mine" in every connector; the calendar account, the HR employee, the finance attester are all mapped to it | built (the mappings are fixtures today, see below) |
| Unit id (`actor.unitId`) | Clew core | SCIM groups and the role derivation | "My unit's" in every connector; the scope rule for managers | built |
| Object ref | The owning connector | The connector's own stable ids, prefixed with the connector | Linking a card row, a chip, a proposal or a Clew record to the thing in the source; asking the owner for the row later | built |

**Identity mapping.** Startsidan's conclusion stands: renaming a field to `personId` does not establish
that two records are the same person, and a matching id does not establish authorization. In Clew the
mapping from a source's own id to Clew's person id is the adapter's job and comes from the directory or
the IdP, never from matching names or e-mail addresses at query time. Today the mapping is a fixture:
`packages/connectors/src/mock/data.ts` and `packages/calendar/src/accounts.ts` carry `personId` on each
record. The target is one mapping table in Clew's core (person id, connector, source ref, valid from and
to), filled by SCIM and the directory connector, read by adapters. Designed, not built.

## Five ways work crosses connectors

### 1. The actor is the first join (built)

Every capability receives the actor (id, name, unit, role) and nothing else about identity. A connector's
`scope` and `run` narrow to that actor. So a question that spans connectors, "vad behöver jag göra i dag?",
is answered by each connector for the same person, and the stream is the union. No join happens; the key is
the caller.

### 2. Refs in cards and chips (built)

A card's items carry refs, and so do chips in the conversation (D12). "Boka ett möte med @Anna Lindqvist
om @fakturan 4711" puts a directory ref and a finance ref into one sentence. The model or the router
picks a `propose` capability whose input accepts those refs; that capability asks the directory for Anna's
calendar account and finance for the invoice's label, and drafts a calendar card. Nothing from either
source is stored; the card holds the refs and the draft.

A capability declares which foreign refs it accepts in its input schema (a `pattern` on the ref string),
so the registry can validate before `run`, and the composer can offer only chips that fit.

### 3. Composite capabilities (built once, rule not enforced yet)

A `read` or `propose` that needs more than one connector is written in the connector that owns the verb, and
calls the other connectors through the registry as the actor:

```
hr.scan ──► who needs an utvecklingssamtal before 28 Nov        (HR, scoped to the unit)
calendar.read ──► held talks, free/busy for manager and employees   (calendar, as the manager and each account)
planner ──► proposals that collide with nothing                     (deterministic code)
```

Rules for a composite:

- It calls other connectors only through the registry, never by importing their adapter or data. Both scopes
  apply: the composite cannot widen what either connector would show the actor on its own.
- It combines in memory within the request and returns rows or a draft. It stores nothing but refs and,
  when the person decides, the decision and the receipt.
- It reports its sources. If one failed, the output says which, and the card shows a partial result as
  partial, never as a complete total.
- One-to-one and many-to-one only. A many-to-many combination across sources is not done in Clew; the
  source pre-aggregates, or the use case is split.

Status: since D20 every `run`, `scan` and `figure` receives a `clew.call` handle and a connector posts to
`/api/connectors/call`; both re-check scope and refuse `execute`, and `dependency-cruiser` fails the build on a
connector importing another. The planner (`apps/server/src/modules/calendar/usecases/samtal.ts`) is a composite but calls the calendar package directly
rather than through the registry, and the HR connector's part is the `scan-utvecklingssamtal` job. Routing
composites through the registry is the target and a small refactor.

### 4. Derived connectors (built with synthetic data)

Figures that span sources, the "Läget" row, are derived connectors: a scheduled job reads each source or a
reviewed aggregate feed and stores a snapshot with period, source and checked-at time. Aggregates over
personal data are produced inside the source trust boundary (startsidan's edge aggregates), never by Clew
joining rows with a service account. Today the figures are synthetic (`apps/server/src/figures.ts`).

### 5. Enrichment on demand (partly built)

A view from one connector may show a ref from another: a calendar event's participant, an invoice's project.
Clew does not join the second connector into the view. The ref renders as an object; clicking it opens the
owning connector's `read` in the side panel (D9), for example the directory contact card. The row is fetched
when asked, as the user, and never copied into the first connector's output.

## Combinations by connector kind

| Combination | How | What Clew stores | Example |
|---|---|---|---|
| Pass-through × pass-through | A composite capability at request time | Refs and the decision | HR absences plus calendar free/busy drawn as rehab-talk proposals |
| Core × pass-through | The core record holds the external ref; the source is read back on display and on execute | The core row, the ref, the receipt | A Clew-owned utvecklingssamtal record (future core connector) holding the calendar event's ref; "held" is read back from the calendar |
| Derived from several | A scheduled snapshot per figure | The snapshot | Läget: absence from the data warehouse reader, budget from finance, talks from Clew's own record |
| Core × core | Plain SQL in Clew's Postgres | Everything | A thread and its audit rows; a person and their grants |
| Anything × directory | Enrichment on demand | Nothing | A participant's phone number from Metakatalogen |

## What a connector author does

- Map every record to Clew's person and unit ids in the adapter, from the directory or the IdP, and expose
  the source id only inside the ref.
- Accept foreign refs in a capability's input schema explicitly, by pattern, and resolve them through the
  owning connector's `read` via the registry.
- Never import another connector's adapter, data or state. If the registry does not offer what you need,
  the other connector gets a `read` capability for it.
- Say which sources an output came from, and mark a partial result.
- Do not reconstruct the general case. If a third use case needs the same two sources combined the same
  way, that is the moment to extract a shared composite, not before.

## What is deliberately left out

- Semantic types, dataset manifests and the view DSL. A connector's output schema is its vocabulary; the
  only shared vocabulary is person id, unit id and the ref format. If a shared vocabulary across connectors
  is ever needed, start from startsidan doc 26.
- A query engine (DuckDB, Cube) and a catalogue the model writes plans against. The model calls
  capabilities; capabilities compose in code.
- Operator-defined joins. Combinations are code, reviewed, with both scopes visible.
