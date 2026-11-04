# SupportManagement integration review · 2026-11-04

Requested: explore Sundsvall's errand service `api-service-support-management` and its API, and map how Clew
should integrate against it. In particular: are errands a core-level entity Clew should support?
Based on `github.com/Sundsvallskommun/api-service-support-management` at `a530b0f` (2026-11-04), its README
and OpenAPI document (30 069 lines), the sibling `api-service-case-data`, the shared web UI `web-app-draken-public`,
and Clew `main` at `cea0520` (`docs/vision.md`, D1–D17, `docs/architecture/integration-paths.md`,
`packages/modules`). Nothing was run against a live installation; everything below is read from source.

## Outcome

**Errands are a Clew-owned domain contract and object type, but a pass-through module kind, never core.**
The record lives in the case system; Clew holds refs, the person's threads about the errand, decisions and
receipts. This is the calendar pattern (D11): one `ErrandProvider` contract in Clew, one adapter per case
system, SupportManagement first. The adapter is written in Clew (D10 fallback) because SupportManagement's REST
API is already close to what Clew needs and is consumed by other clients; the one change worth making in
SupportManagement itself is an outbound notification channel, which serves anyone, not just Clew.

What makes SupportManagement a good first errand source:

- It already answers "what needs this person" per AD account: notifications per owner, errands by
  `assignedUserId` and `assignedGroupId`, suspensions with an end time, deadlines on investigations, decisions,
  statements and measures, and subscriptions (bevakning) per user.
- It enforces per-user access itself when the namespace turns it on, and reports what a caller may do per errand
  (`GET …/errands/{id}/access`), so Clew can render only the buttons the next request would be allowed.
- It has optimistic locking (`If-Match` on the errand version) and a revision history, which is exactly what
  Clew's re-validate, execute, read back, receipt loop needs.
- It has a link-out for free: namespace config carries `baseUrl`, and Draken renders an errand at
  `<baseUrl>/arende/<errandNumber>`.
- MIT licence, our own code, in the open on GitHub.

What it lacks for Clew: outbound change notification (no webhook; only `INTERNAL`, `EMAIL` and `SMS` channels),
an errand-level deadline (deadlines sit on sub-entities), and token-based caller identity (it trusts an
`X-Sent-By` header behind the WSO2 gateway).

Filed as proposed decisions the same day: D18 (errands are a Clew-owned pass-through domain; SupportManagement
is the first adapter; identity reaches dept44 services as an asserted `X-Sent-By` from a BFF-held gateway
credential, as Draken does today, until the gateway accepts exchanged user tokens) and D19 (change
notification is a Clew-owned contract: payload-free CloudEvents over HTTP, which the webhook channel in
section 6 would be the first source to meet).

## 1. What SupportManagement is

A Java 25 Spring Boot microservice on the dept44 parent (8.1.0), MariaDB, optional OpenSearch for full-text
search, built to run behind the municipality's WSO2 API gateway. It is multi-tenant by path:
`/{municipalityId}/{namespace}/…`, where a namespace is a business area (Kontaktcenter `KC`, alcohol and tobacco
permits, and so on) with its own metadata: categories and types, statuses, phases and transitions, roles,
labels (a tree with classifications), contact reasons, decision and statement outcomes, measure types,
attachment purposes, external id types.

It depends on thirteen other dept44 services, of which the ones that matter to Clew are Eventlog (every errand
event is written there and read back as the errand's history), Employee (AD account to name, backed by
Metakatalogen), AccessMapper (AD groups to labels, resources and roles per namespace), Relations (linked
errands, referrals, handovers) and Messaging (e-mail, SMS, Open-E web messages to stakeholders). Draken is the
case officer UI, shared with CaseData; `web-app-support-management-admin` administers the metadata.

### The errand

| Field | Notes for Clew |
|---|---|
| `id` (UUID), `errandNumber` (`KC-23010001`) | The ref and the human label. The number carries the namespace prefix. |
| `title`, `description` | Free text, may contain personal data. Not stored in Clew (section 5). |
| `status` (string from namespace metadata), `lifecycle` (`DRAFT`/active), `resolution` | Status names are per namespace; Clew reads `metadata/statuses` for display names. |
| `priority` (`LOW`/`MEDIUM`/`HIGH`), `classification.category`/`type`, `labels[]`, `channel` | Grouping and the attention level. |
| `reporterUserId`, `assignedUserId`, `assignedGroupId` | AD accounts and a group id. "Mine" is `assignedUserId`; "my queue" is `assignedGroupId` with no assignee; "I reported this" is `reporterUserId`. |
| `stakeholders[]` (partyId, role, name, address, contact channels) | Citizens and companies. Never leaves the source into a card (principle 7). |
| `suspension.suspendedFrom`/`suspendedTo` | "Parked until": the closest thing to a reminder date on the errand. A scheduler clears expired suspensions every two minutes and that is an event. |
| `phases[]`, `activePhaseId`, `process` | Phase history; for process namespaces the live Operaton process with `currentActivityName` and `awaitingSignals`. |
| `activeNotifications[]`, `actions[]` | The owner's unacknowledged notifications and scheduled actions (`executeAfter`). |
| `measures[]`, plus sub-resources `investigations`, `decisions`, `statements` | Each has `dueAt`, `completedAt`, a status and a responsible user. These are the deadlines. |
| `externalTags[]`, `parameters[]`, `jsonParameters[]` | Namespace-specific data; JSON parameters validated against the JsonSchema service. |
| `created`, `modified`, `touched`, `version` | `version` is the ETag for `If-Match`. `touched` drives "untouched for N days". |

Sub-resources: attachments, communication (e-mail, SMS, web message, conversations through MessageExchange,
`viewed` flag), notes (with revisions), decisions (with terms), investigations (with sections), statements
(remisser, with `sentAt`, `remindedAt`, `respondedAt`), measures, time measurement, revisions and diffs, events,
notifications, processes and signals, handover to another namespace (preview, then execute), soft delete and
restore.

### Who needs the person: notifications and subscriptions

Every event on an errand creates a **notification** for its `assignedUserId` (type `CREATE`/`UPDATE`/…,
subtype such as `ATTACHMENT` or `MESSAGE`, description, `acknowledged`, `globalAcknowledged`, `expires` after
`notificationTTLInDays`). `GET /{m}/{ns}/notifications?ownerId=<ad>` lists them; `PATCH /notifications`
acknowledges. This is the handläggare's inbox and the first thing Clew's scan reads.

**Subscriptions** are the user's own watch: a subscriber (AD account or partyId) with channels and event
filters, subscriptions on one errand or the whole namespace, optional profiles administered per namespace.
A dispatch job every five minutes groups events per subscriber and delivers them as `INTERNAL` (stored, read
through `subscriber-notifications/{type}/{value}` with the events since the last acknowledgement), `EMAIL` or
`SMS` through an outbox with retry. There is **no webhook channel**. Events also go to a process engine
(pw-alkt) through a same-transaction outbox and a relay, but only for the configured `processConsumer` of a
namespace.

### Listing and search

`GET /{m}/{ns}/errands?filter=<spring-filter>&page&size&sort` with expressions such as
`assignedUserId:'joe01doe' and status:'ONGOING' and touched<'2026-10-20T00:00:00+02:00'`, plus `/count`.
`GET …/errands/search?query=<lucene>` searches an OpenSearch index over the errand and everything attached
to it, restricted to the errands the requesting user may read, with `/count?groupBy=status`. Search answers
503 where OpenSearch is not deployed; the filter listing always works.

### Caller identity and access

The service has no inbound security of its own (`securitySchemes: {}`); the WSO2 gateway authenticates the
calling application with an API key or OAuth2 client credentials. The person is asserted by the caller in the
dept44 header `X-Sent-By: type=adAccount; joe01doe` (a process engine sends `type=processEngine`). Draken sets
it from its SAML session (`backend/src/services/api.service.ts`). Everything personal hangs on that header:
notification ownership, subscription ownership, reporter identity, the access evaluation and the audit of who
acted.

Access control is opt-in per namespace. When on, the AccessMapper is asked per AD account for three group
types: `label` patterns decide which errands are visible and writable (`LR` < `R` < `RW`), `resource`
patterns decide which sub-resources are reachable, `role` names decide which fields come back. A caller with
no labels reaches no errand at all, so a call without `X-Sent-By` sees nothing in such a namespace.

### Writes a case officer makes

`PATCH /errands/{id}` with `If-Match` (status, resolution, assignee, group, priority, suspension, labels,
parameters; 412 when the version moved), `POST`/`PATCH`/`DELETE` notes, `POST communication/email|sms|webmessage`
and conversation messages, `PATCH notifications` (acknowledge), `POST decisions`, `measures`, `statements`,
`investigations`, `POST handover/preview` then `handover/execute`, `POST processes/start` and signals, soft
delete and restore. Three request headers matter: `X-Sent-By` (who), `X-Request-Group-Id` (groups the events
of one operation), `X-notify: false` (suppress notifications for this write).

### CaseData is the second errand system

`api-service-case-data` (parking permits, land and exploitation) has the same shape: `errandNumber`, `status`,
`phase`, `stakeholders`, `decisions`, `notes`, `notifications`, `suspension`, `labels`, `relatesTo`, and the
same Draken UI. A Sundsvall case officer in MEX sees CaseData errands; one in Kontaktcenter sees both. Any
errand concept Clew builds therefore needs two adapters in Sundsvall alone, and a municipality that buys a
different case system needs a third. That is the argument for a Clew-owned contract rather than a
`supportmanagement` module with its own vocabulary.

## 2. Is an errand a core entity?

Run it through the vision's ladder (`docs/vision.md`, "Own the model where nobody else does") and D3.

| Question | Answer | Consequence |
|---|---|---|
| Who owns the record? | SupportManagement (or CaseData, or the next case system). The organisation's record of a case lives there by law and by the vision ("not a case system"). | Not core. Clew never copies the errand to own it. |
| Does Clew compute a figure from it on a schedule? | Yes, for Läget: open errands, overdue, untouched. | A derived capability inside the errand module, like Treserva's area figure. |
| Does Clew need refs, audit and decisions about it? | Yes: threads, reminders, watches, receipts. | Pass-through module, refs only. |
| Is the *concept* shared across sources and personas? | Yes: two systems in Sundsvall today, every municipality has several, and every employee is a reporter of some errand (IT support, facilities). | A Clew-owned **domain contract** and **object type**, like `calendar`. |

So the answer to "is errands a core-level entity" is: core as a *concept* (contract, ref scheme, object type,
standard card slots), pass-through as a *module kind*. What Clew owns around an errand is already core:
the thread, the person's reminder (D17), the watch, the audit row and the receipt. Nothing new has to move up
the ladder for this. The two domains the vision names as core candidates (utvecklingssamtal records,
delegations) are unaffected.

One boundary to hold: Clew's "bevaka ärendet tills det är besvarat" is a Clew thread waiting on someone
else, driven by SupportManagement's own subscription mechanism where it exists. Clew does not build a second
subscription store. If the source has no watch mechanism, the Clew watch polls through the adapter.

## 3. The contract: `ErrandProvider`

Mirror `packages/calendar`: `packages/errands` with the model, the provider interface and the adapter
selector; the module wrapping it in `apps/server/src/errand-module.ts`. The interface is what a case system
would implement natively under D10 and what an MCP server would expose if the adapter is ever lifted out.

```
ref scheme        errand:<adapter>:<municipalityId>:<namespace>:<id>      e.g. errand:sm:2281:KC:b82bd8ac-…
object type       errand   (ChipKind gains 'errand'; search results, items and chips carry it)

ErrandProvider
  mine(actor, filter)        errands assigned to the person (or their group, unassigned), with what is due
  needsMe(actor)             unacknowledged notifications, suspensions ending, sub-entity deadlines, statements
                             overdue without reminder, untouched errands; deterministic rows the scan turns into drafts
  reported(actor)            errands the person reported, with the last external communication and the status
  get(actor, ref)            one errand for the side panel: status, phase, waiting on, deadlines, last communication
  access(actor, ref)         what the person may do: level and resources, so cards show only allowed buttons
  search(actor, query)       the fan-out capability; falls back from Lucene to the filter listing
  link(ref)                  <baseUrl>/arende/<errandNumber> from namespace config
  acknowledge(actor, refs)   PATCH notifications; undo = un-acknowledge
  takeOver(actor, ref, v)    assignedUserId = me with If-Match; undo = previous assignee
  park(actor, ref, until, v) suspension; undo = clear
  setStatus(actor, ref, status, resolution?, v)   undo = previous status
  addNote(actor, ref, text)  undo = DELETE note within the window
  reply(actor, ref, channel, text)                e-mail / SMS / web message; no undo, the card says so
  watch(actor, ref)          subscription on the errand, INTERNAL channel; the Clew thread waits on it
```

Capabilities at domain granularity, roughly: `errand.mine`, `errand.reported`, `errand.search`,
`errand.view` (reads, `model: true`), `errand.draftReply` (propose), and the executes above with
`model: false`. A 30 000-line OpenAPI document is the textbook case for D2: nothing of its REST granularity
reaches the model or the UI.

## 4. SupportManagement mapped onto Clew's paths

| Clew path (`integration-paths.md`) | SupportManagement | Status |
|---|---|---|
| Pass-through read | `GET errands?filter=…`, `GET errands/{id}`, `GET …/access`, `GET …/events`, `GET notifications?ownerId=` | exists, no change |
| Search fan-out | `GET errands/search?query=` (OpenSearch, access-filtered); `GET errands?filter=` as fallback | exists; OpenSearch per environment |
| Scan trigger | Compose from notifications by owner, `assignedUserId`/`assignedGroupId` listing, `suspension.suspendedTo`, `dueAt` on investigations, decisions, statements, measures; `touched` age; `statements` with `sentAt` set, `respondedAt` null, `remindedAt` null | exists; sub-entity deadlines need the search index or per-errand reads |
| Change notification | None outbound. Short term: poll `notifications?ownerId=` and `subscriber-notifications` on the bundle cadence. Long term: a `WEBHOOK` channel in SupportManagement's subscriber dispatch (section 6) | gap |
| Execute through a human decision | `PATCH errands/{id}` with `If-Match`; `POST notes`, `communication/*`; `PATCH notifications`; read back with `GET errands/{id}` and compare `version` | exists; 412 maps to "the errand changed, card redrawn" |
| Undo | Compensating PATCH with the version read back; `DELETE notes/{id}`; un-acknowledge. Communications are irreversible | exists |
| Link-out | `baseUrl` from `namespace-config`, Draken route `/arende/<errandNumber>` | exists, zero adapter code |
| Side-panel view | Clew renders `errand.view` rows; Draken is the "inside the source" view behind the link | open: whether a Clew-rendered errand view counts as "inside the source" for names (HANDOVER question 6) |
| Derived figure | `GET errands/count?filter=` and `search/count?groupBy=status` per namespace | exists |
| Clew as MCP server for Eneo | `errand.search`, `errand.mine` as read tools under the release policy | follows from the registry |

### Auth mode

None of Clew's three modes fits exactly. The gateway sees a `service` credential; the source applies the
person's own access from the asserted header. Call it **service credential with asserted identity**: the
adapter runs in `service` mode, Clew's `scope` rule still narrows every call (the person may only ask about
their own AD account, their own group, their own namespaces), and the adapter sets `X-Sent-By` from the
person's AD account. The source then enforces the rest. The risk is real and should be named in D18: the BFF
holds a credential that can act as any AD user against the gateway, which is also true of Draken today. The
mitigation is the one `identity.md` already prefers: the gateway or dept44 accepts an exchanged user token
(RFC 8693) and derives the identifier from it. That is a change in dept44 or WSO2, not in Clew, and not a
blocker for the first adapter.

Clew needs the **person to AD account mapping** for this. The identity mapping table in
`working-across-modules.md` is designed, not built; the minimum is an `ad_account` on the person from the
IdP's `preferred_username` (or `sAMAccountName`) claim, verified by issuer and subject at login. This is the
first real use of that table.

### Operator configuration

Per installation: gateway base URL and credential, `municipalityId`, and the list of namespaces to read,
each with its display name (from `namespace-config`). Each namespace's statuses, phases and labels are read
from `metadata` and cached per process with a short TTL (SupportManagement itself caches namespace config for
ten minutes). A municipality without SupportManagement configures no `sm` adapter and the `errand` module is
simply empty, like the calendar without accounts.

## 5. Guardrails checked

- **Names stay in the source (principle 7).** Stakeholders are citizens; the errand `title` and
  `description` are free text and often name them. The card must be composed from non-personal fields:
  `errandNumber`, category and type display names, status display name, what is waiting and since when. The
  free-text title is read live for the side panel and never written to Clew's `thread.title` or `summary`.
  This is stricter than the mock modules are today and should be stated in D18, because `ThreadDraft` makes
  it easy to do the wrong thing.
- **Pass-through stores refs, revisions, audit, receipts; never bodies.** The ref, the `version` seen at
  proposal time, the notification ids acknowledged, the audit row and the receipt rows. Nothing else.
- **Every receipt is a read-back.** After `PATCH`, `GET errands/{id}` and compare; outcome `unknown` when the
  read fails, as today.
- **Execute is never a tool.** All executes `model: false`. `errand.draftReply` as a `propose` is fine, but
  drafting a reply to a citizen puts their message in front of the model: the classification-gated inference
  question in `docs/vision.md` ("Open questions") becomes concrete with this module. Until decided, the draft
  capability should be off, or restricted to internal errands where the reporter is an employee.
- **Every mutation audited in the same transaction.** Unchanged; the adapter returns, the BFF writes.
- **Open source.** SupportManagement is MIT; nothing is imported from it. The adapter is plain `fetch`
  against its REST API. No Java, no generated client.
- **Server decides.** `access(ref)` is the source's answer, re-read on execute, never cached in the browser.

## 6. Changes worth making in SupportManagement

It is our system, so the question is which changes are generally useful rather than Clew-shaped.

1. **A `WEBHOOK` notification channel** (`NotificationChannelType`, `NotificationChannelDispatcher`, a
   destination URL and a shared secret on the channel). The dispatcher already has the outbox, the grouping
   per subscriber and the retry; adding a channel is small. Clew registers one subscriber per namespace with
   a `NAMESPACE` target and reads back under its own authorization; payload: `errandId`, `errandNumber`,
   event type and subtype, `requestGroupId`, `created`, nothing else. This is the payload-free change
   notification `integration-paths.md` asks for, and it serves any other consumer too.
2. **Expose `baseUrl` and display names without namespace-admin rights.** `namespace-config` is an
   administration resource; a read-only projection of the fields a client needs for links and labels avoids
   handing Clew an admin grant.
3. **Accept an exchanged user token at the gateway** and derive `Identifier` from it (dept44 level). Removes
   the asserted-identity risk for every dept44 service at once. Longer term.

Not worth doing: making SupportManagement implement `ErrandProvider` natively. Its API is already close, and
the adapter is a few hundred lines of TypeScript; the native path (D10) pays off for systems whose API is far
from Clew's needs or that are not ours to change.

## 7. Order of work

1. `packages/errands`: model, `ErrandProvider`, ref scheme, a `mock` adapter with fixtures (the Treserva
   mock stays; it is a different domain). `errand` object type in `packages/contracts`. Module in the
   registry with areas for the case officer ("Mina ärenden") and for every employee ("Mina frågor till
   kommunen", the reporter side).
2. The `sm` adapter: configuration, `X-Sent-By` from the AD account, listing and notifications, `access`,
   link-out, the scan. Verify against a test namespace behind the test gateway; record the responses as
   fixtures for the contract tests. Running SupportManagement locally (Java 25, MariaDB, thirteen services)
   is not worth it for Clew's tests.
3. Executes with `If-Match` and read-back: acknowledge, take over, park, status, note. Reply last, since it
   has no undo.
4. The reporter side for all employees: "Ditt ärende KC-… har fått svar" under Pågår utan dig and the
   webhook or polling cadence that drives it.
5. The `casedata` adapter as the proof that the contract holds (as `microsoft365` is for the calendar).

Questions for the next session: which test namespace and gateway credential Clew may use; whether the
`preferred_username` claim in the `clew` realm is the AD account; whether a Clew-rendered errand view may show
stakeholder names (HANDOVER question 6); and whether to file the webhook channel as an issue on
`api-service-support-management` now.
