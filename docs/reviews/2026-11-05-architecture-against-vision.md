# Architecture review against the Clew vision

Date: 2026-11-05

Reviewed revision: `4696f6d`
Status: review and recommendations; no architectural decisions changed

## Assessment

Clew has a sound architectural direction and an unusually explicit product boundary. Keep the modular monolith, PostgreSQL, deterministic use cases, connector protocol, optional model, and source-owned records. A rewrite or a move to microservices would not address the main weaknesses.

The implementation is a capable prototype, but it does not yet support several guarantees at the heart of the vision: act once, remember the outcome, preserve authorization everywhere, keep working when a source fails, and bring work back at the right time. These are architectural gaps because the missing concepts cross routes, persistence, connectors, background work and the browser.

The next milestone should be a trustworthy end-to-end integration. More connector types and interface refinements would otherwise multiply paths that inherit the same gaps.

## Basis and limits

Reviewed the vision, personas, project instructions, handover, decision index and relevant decisions, architecture documents, and existing reviews. Traced the implementation through authentication, registry and remote connectors, threads, calendar commands, assistant context and persistence, schedulers, database adapters, browser queries and CI.

Validation performed inside the devcontainer:

- `bun run check`: passed, including types, dependency boundaries, purity checks, 307 tests and four Node runtime tests.
- `bun test tests/db/postgres-store.test.ts`: six tests passed against PostgreSQL.
- Temporary probes using synthetic actors, memory stores and fake transports reproduced the failure cases described below. No live connector was attacked and no real source action was executed.

This was a repository and architecture review, not a penetration test, load test, dependency licence audit, visual review or accessibility certification. Live Eneo, Microsoft 365, SCIM provisioning, production hosting and a real model endpoint were not validated. Existing documented deferrals are identified as readiness gaps rather than undisclosed implementation failures.

## Choices worth keeping

| Choice | Assessment | Qualification |
|---|---|---|
| Modular monolith with functional use cases and ports | Strong fit. Most business records live elsewhere; the core needs coordination, policies and durable local state. Dependency rules and injectable clocks make the structure practical. | Add explicit execution and obligation state within this structure. No need for tactical DDD, event sourcing or a service per core module. |
| PostgreSQL and transactional local audit | Strong fit for decisions, references, receipts, configuration and work state. | A transaction cannot cover a remote source or a Temporal start. Local audit atomicity must not be described as atomicity of the whole action. |
| Node runtime, Bun toolchain, Hono and TypeScript contracts | Reasonable combination with a clear runtime boundary. The Node checks complement the Bun suite. | Expand Node coverage of critical production paths. Changing framework or package manager would bring little value compared with closing reliability gaps. |
| Separate HTTP connector services | Justified for independently maintained municipal/vendor integrations and separate credentials. A small language-neutral protocol is useful. | These are distributed trust and failure boundaries even though the core is a monolith. They need authentication, isolation, contract enforcement and operational ownership. Container separation alone provides none of those guarantees. |
| Clew-owned contracts and selective domain profiles | Better than exposing arbitrary vendor APIs or converting every OpenAPI operation into a tool. Shared search and errand reads can make different systems useful in one interface. | Standardise the semantics Clew must combine, including outcomes, freshness and occurrence identity. Do not standardise every vendor's write verbs. |
| Model optional; propose separated from execute | One of the best decisions. It supports predictable public-sector workflows and makes the core testable. | Enforce the distinction through a single execution boundary. An inaccessible tool is only one part of that boundary. |
| Eneo optional; no duplicate knowledge platform | A clear, defensible product boundary. Search fan-out and citations fit the mission. | Keep model endpoint administration narrow. Data release rules remain Clew's responsibility even if Eneo supplies classifications. |
| Declared views drawn by Clew | Good control of accessibility, consistency and executable content. Link-out is a sensible escape hatch. | Keep the schema small. Complex forms and workflows could turn it into the page-builder language the vision rejects. |
| Temporal for waits and follow-up | The intended problem earns a durable workflow engine. Container count is not a good reason to remove it given the hosting vision. | Complete integration with durable local intent and recovery. Merely running Temporal does not make source effects exactly once. |
| TanStack Query and one UI system | Useful consolidation. Session-scoped caches, disabled mutation retries and shared components reduce incidental complexity. | The cache needs invalidation from background work. Component rules should remain subordinate to task completion and accessibility, with documented exceptions. |
| Fast scenario tests plus shared store contracts | A strong foundation. The existing tests are quick and useful. | Most current scenarios are sequential. Add concurrency, failure-between-systems, revocation and restart cases, plus a small real-stack CI suite. |

## Findings that should block a pilot with real data or actions

### F1 · P1 — A connector can create an accepted identity assertion for another person

The connector and Clew share the HS256 key used both to issue assertions and verify callbacks. A connector therefore has the material needed to sign an assertion, not just verify one. The callback trusts the asserted person id and rebuilds that person's current grant. Rebuilding the grant prevents invented roles, but does not prove that Clew authorised this connector to act for that person.

The synthetic probe signed a token with a fixture connector key and a different subject; the production `verifyAssertion` accepted it. If that subject has a real grant, the callback then runs permitted reads/proposals as that person. The callback also does not check that the originating connector is currently enabled for this person or that it may call the named target. The proposed integration decision D37 addresses declared dependencies, but not assertion forgery.

**Change:** Clew should keep exclusive signing authority, with connectors receiving verification keys, or issue opaque callback grants validated against server-held state. Bind grants to the person, originating connector, permitted target capabilities and expiry. Recheck origin governance and current target permissions on callbacks. An actor id alone must never grant delegated authority.

Evidence: [assertion signing and verification](../../apps/server/src/connectors/remote.ts#L21), [callback identity reconstruction](../../apps/server/src/routes/connectors.ts#L25). The shared-key property follows directly from [RFC 7518 §3.2](https://www.rfc-editor.org/rfc/rfc7518.html#section-3.2).

### F2 · P1 — Connector governance is not applied consistently or safely at startup

Two separate paths undermine D23's promise that a hidden connector cannot be discovered:

1. The server listens and starts the scheduler before loading connector governance. A registration without governance defaults to enabled for everyone. Applying stored restrictions waits for all remote manifest loading to finish; a slow/unreachable connector can extend the interval, and an initialisation failure can leave governance unapplied.
2. The stream filters hidden cards, but assistant object discovery, chip resolution and named-card matching read the store directly. Disabling a connector hid its card from the stream in the probe, while object search still returned it and its thread chip still resolved.

The second problem can also put formerly visible content into a new model prompt. This finding concerns open cards; whether historical receipts should remain accessible needs a separate explicit policy.

**Change:** default ungoverned connectors to denied, install stored governance before serving business requests or starting scans, and distinguish readiness from liveness. Use one authorised thread/object reader for the stream, assistant, chips, suggestions and follow-up endpoints. Test revocation across every surface.

Evidence: [startup order](../../apps/server/src/main.ts#L32), [default governance](../../packages/connectors/src/index.ts#L170), [stream filtering](../../apps/server/src/threads/usecases/cards.ts#L263), [object discovery](../../apps/server/src/assistant/objects.ts#L19), [chip resolution](../../apps/server/src/assistant/chips.ts#L21), [named-card matching](../../apps/server/src/assistant/index.ts#L182).

### F3 · P1 — “Act once” needs a durable execution model

The generic action path reads an open thread, calls the source and then records the receipt and audit. There is no durable command identity or atomic claim before the call.

The probes demonstrated:

- Two concurrent calls for the same card/action both executed the source capability and wrote action audit rows.
- A simulated database failure after the source call left the thread open, with one completed source call and no action audit row.
- An undo returning `unknown` reopened the thread and erased its receipt anyway.

The generic POST capability route also accepts execute capabilities directly. It runs authorization and input validation, but bypasses the thread action's receipt and audit handling. This route is session/CSRF protected; the issue is an inconsistent command lifecycle, not anonymous access.

Calendar confirmation has a useful stable event UID, but calendar operations still have source/local commit gaps. The remote transport converts lost responses into ordinary unavailability rather than preserving a durable uncertain execution.

**Change:** introduce a persisted execution record with a stable idempotency key, exact approved inputs and source revision, actor/authority, and per-item outcomes. Atomically claim the decision and persist dispatch intent with its audit, then execute through a worker or controlled dispatcher. Reconcile unknown outcomes by reading the source before repeating a write. Keep failed/unknown compensation visible and retain the original receipt. Route every external write through this lifecycle, including standing actions and calendar writes.

This does not require a distributed database transaction. It requires an honest, recoverable state machine around a non-transactional boundary.

Evidence: [execute before local transaction](../../apps/server/src/threads/usecases/cards.ts#L133), [undo discarding outcomes](../../apps/server/src/threads/usecases/cards.ts#L157), [direct capability POST](../../apps/server/src/routes/api.ts#L63), [remote error handling](../../packages/connectors/src/remote.ts#L53), [calendar writes](../../apps/server/src/modules/calendar/usecases/events.ts).

### F4 · P1 — Source failure can prevent the whole stream from loading

Every `GET /threads` awaits `ensureThreads`, which first awaits the calendar and then scans connectors sequentially. A failing connector scan throws out of the whole operation. The probe reproduced that failure despite existing stored cards.

Consequently, an unavailable source can prevent a first page load from returning work from healthy systems. Repeated browser refetches also repeat source scanning; the “first visit of the day” label is not a persisted daily freshness check. The in-process promise map coalesces simultaneous calls on one instance only.

**Change:** serve the authorised local work projection immediately, with explicit source freshness and failure status. Refresh sources independently under bounded concurrency and time budgets. Preserve successful source results when another fails. Share refresh coordination across instances and distinguish a successful empty scan from an unavailable source.

Evidence: [GET blocks on scan](../../apps/server/src/routes/api.ts#L40), [calendar-first scan](../../apps/server/src/threads/usecases/cards.ts#L54), [sequential registry scan](../../packages/connectors/src/index.ts#L247). Search already demonstrates a better partial-result approach in [its use cases](../../apps/server/src/modules/search/usecases.ts).

### F5 · P1 — An open card is not a durable work occurrence

The uniqueness rule is only `(person, topic)` while a pushed thread is open. A dismissed or handled card frees that topic. The scan only inserts/refreshes drafts that are present; it does not reconcile disappeared work.

The probe dismissed an occurrence, rescanned unchanged source output, and obtained another open card for the same occurrence. When the source subsequently returned no drafts, that open card remained. This breaks both “the same occurrence is never pushed twice” and the personas' expectation that work completed in its source disappears.

Unknown/failed generic action results also move the thread to `handled`, without a general reconciliation lifecycle. Whether the connector continues returning the occurrence then determines whether it disappears or reappears as another card.

**Change:** separate the identity and lifecycle of a work occurrence from its presentation as a thread. Persist `connector + source occurrence key + responsible person/assignment`, source revision, observed status, dismissal/suppression and confirmed resolution. Define when a changed occurrence may reopen and how recurring periods differ. Add a scan completeness/cursor or explicit resolution contract so an outage is never interpreted as completion.

The existing thread can remain the UI container; this is a focused data-model addition, not a generic process designer.

Evidence: [partial uniqueness](../../packages/db/src/schema.ts#L67), [insert/refresh-only scan](../../apps/server/src/threads/usecases/cards.ts#L60), [store contract deliberately freeing a topic](../../tests/store-contract.ts). This directly affects UC-KIM-7 and UC-ALEX-2.

### F6 · P1 — Background obligations are not reliably coupled to committed state

There are three durability boundaries:

- A reminder starts in Temporal before the database records the request. If the transaction fails, the timer can still fire despite the request appearing unsuccessful.
- Calendar confirmation commits first, then attempts to start its follow-up workflow. Failure writes an audit entry but creates no durable retry intent. The card can promise follow-up that will never be scheduled.
- Legacy PostgreSQL jobs remain `running` after a worker crash; failed jobs are terminal. These limitations are documented, but are consequential now that follow-up is a core promise.

**Change:** write timer/workflow intent into a transactional outbox beside local state and audit, dispatch it with stable workflow ids, and reconcile it until acknowledged. Move the remaining scheduler jobs to Temporal or give the transitional queue leases, recovery and retry policy. Treat failed follow-up as actionable operational state.

Keep Temporal. Its documentation explicitly requires idempotent Activities because effects can complete before completion is recorded; [durable execution does not remove this responsibility](https://github.com/temporalio/documentation/blob/main/docs/best-practices/error-handling.mdx).

Evidence: [reminder start before commit](../../apps/server/src/threads/usecases/reminders.ts#L27), [follow-up start after confirmation](../../apps/server/src/modules/calendar/usecases/samtal.ts#L215), [job claim/finish](../../packages/db/src/jobs.ts#L11).

## Gaps to close in the next architecture milestone

### F7 · P2 — The platform describes contracts more strongly than it enforces them

Remote calls validate the response envelope, but not the capability's output schema. A fake transport returned a string where an integer was required, and the production remote adapter accepted it.

Input validation is outside the registry. An in-process `clew.call` goes directly through `Registry.run` and skips that validator. The server's validator cache is keyed by capability name, so a changed manifest can keep an old compiled input schema.

**Change:** put input and output checks at the common invocation boundary and key compiled validators by the schema/manifest revision. Implement the proposed D37 dependency allowlist and basic compatibility reporting. Add semantic contract fixtures for important consumers: JSON Schema comparison cannot prove unchanged meaning, permissions, ordering or side effects.

Evidence: [input cache](../../apps/server/src/connectors/registry.ts#L36), [nested calls](../../packages/connectors/src/index.ts#L193), [unchecked output](../../packages/connectors/src/remote.ts#L83). D37 is correctly marked proposed; these protections should not be described as already operating.

### F8 · P2 — Timely delivery and the attention budget are not yet an end-to-end mechanism

The browser query policy has no thread polling or background event subscription. The reminder toast observes changed query data, but a timer firing on the server does not itself refresh that data. Keeping the tab focused and untouched therefore has no guaranteed reminder delivery latency. Conversation SSE carries a conversation response, not background thread changes.

The attention budget computes a count and a “bundled until” label after cards have been created. It is not consulted when work is admitted or delivered. The store also limits a combined set of open work and conversations to 50 newest threads before the UI prioritises them; enough newer conversations can exclude older unresolved work and distort counts.

**Change:** add authenticated change notifications that invalidate query keys, with bounded polling as a fallback if needed. Persist attention/delivery decisions separately from discovery of work. Query/count open obligations independently of conversation history and paginate history without hiding unresolved work.

Evidence: [query policy](../../apps/web/src/query-client.ts), [thread query](../../apps/web/src/queries.ts#L12), [reminder observer](../../apps/web/src/pages/start.tsx#L92), [attention calculation](../../apps/server/src/threads/usecases/cards.ts#L250), [50-row limit](../../apps/server/src/threads/adapters/postgres.ts#L53).

### F9 · Readiness decision — Make stored content and model release rules explicit

“Refs, decisions and receipts only” is not an accurate description of present persistence. Card titles, summaries and item labels are stored; conversation answers are stored in full and sent back as history on later turns. Those answers can reproduce source content. Proposal participants also have stored names and email addresses.

Declared views with `modelReads: summary` are a useful minimisation mechanism, but they are opt-in and do not classify the full conversation, historical text or chipped context. A model's audience controls who may choose it, not what that endpoint may receive.

**Change before real sensitive sources:** adopt a field-level storage and release policy. Distinguish source references, necessary operational metadata, permitted snapshots, generated prose and restricted content. Specify retention, erasure/export, authority after revocation and endpoint release restrictions, including historical conversation context. Include Temporal history, logs and backups in that inventory. The policy can remain small; it must exist before data flows rely on it.

This is a design/readiness issue, not a claim of legal non-compliance. The vision already acknowledges classification as open.

Evidence: [thread/message schema](../../packages/db/src/schema.ts#L40), [history sent to model](../../apps/server/src/assistant/index.ts#L148), [answer persistence](../../apps/server/src/assistant/index.ts#L206), [tool summarisation](../../apps/server/src/assistant/model.ts#L29).

### F10 · Readiness decision — Prove real identity and one deployment boundary

OIDC login, server-held tokens, CSRF checks and explicit subject binding are good foundations. But the product's identity problem goes further: one employee can have several assignments, temporarily act for another manager, move unit, lose source authority or need background follow-up without an active login.

The current grant is one row per person with one unit and a manager/employee role. Calendar bindings are guarded synthetic fixtures, and background/callback contexts have no delegated token. These are acceptable prototype constraints, not support for the full persona set.

**Change:** prove one real source's identity mapping, provisioning/deprovisioning and current source authorization, including an acting-manager scenario and a timer firing after a grant changes. Decide the policy for background delegated reads explicitly; a live-login token exchange cannot simply be assumed available to a nightly scan.

For hosting, I recommend an explicitly isolated installation per municipality initially. The current schema is not a complete shared-database tenancy design merely because people have an `organisationId`. Define how database, secrets, connector configuration, Temporal namespace/history and backups are isolated. Shared tenancy can be a later explicit decision rather than an accidental property.

Evidence: [grant shape](../../packages/db/src/schema.ts#L14), [actor shape](../../packages/connectors/src/index.ts#L22), [synthetic calendar binding](../../packages/calendar/src/accounts.ts), [system identity](../../apps/server/src/system-context.ts), [delegation context](../../packages/connectors/src/index.ts#L37).

### F11 · Architecture governance — Establish one current baseline

The documentation is valuable but its authority is becoming ambiguous:

- D37, D38 and D39 each identify multiple decisions.
- The vision still says Temporal arrives later and forbids names in cards, while later decisions/code have moved on.
- The persona catalogue still includes an operator page builder, view DSL and draggable layouts that the Clew vision explicitly excludes.
- The handover mixes current statements with obsolete next steps. Identity and integration documents also mix designs with implemented paths.

These inconsistencies matter because future work can follow different documents correctly and still diverge.

**Change:** publish a concise current architecture/status page, uniquely identify every decision, and classify persona use cases as supported, planned or deliberately excluded. Keep historical decisions and session logs as history. Add a small vision-to-acceptance matrix with measurable promises: no duplicate source action on retry, no disclosure after revocation, source outage does not block other work, and bounded reminder visibility.

## Recommended next milestone

Build one vertical slice that demonstrates the central promise with a real source and two relevant personas. Use an authorised test environment and a reversible action.

1. **Identity and access:** close F1/F2; prove provisioning, source mapping, revocation and the intended hosting boundary.
2. **Durable decisions:** add execution identity, approval inputs/revision, transactional dispatch intent, read-back and unknown-outcome reconciliation. Make compensation honest.
3. **Work lifecycle:** add occurrence identity and resolution, partial source refresh, durable timer starts and browser invalidation.
4. **Production proof:** automate restart and concurrency scenarios against PostgreSQL, Temporal and a contract-faithful connector. Then validate the selected real source. Include data release/retention and basic operational recovery.
5. **Broaden only after the slice holds:** validate a second source with different failure/authentication behaviour, then extract the genuinely shared pieces.

The acceptance scenarios should include a double click, a timeout after the source commits, a database failure after dispatch, a restart before workflow acknowledgement, an uncertain undo, a source outage, source-side completion, permission removal and a reminder while the browser remains focused.

Keep the fast existing CI suite. Add a small real-stack lane for these boundary scenarios; memory adapters cannot prove PostgreSQL locking or crash recovery. Operationally, make readiness, outstanding unknown executions, failed workflow starts and stale source scans visible. A health endpoint returning `ok` and console logs are not enough to operate the promises above.

## Product and design judgement

The brief, cards and standing actions keep the chat-first direction compatible with the model-optional principle. Continue testing them with frontline/mobile employees as well as managers. Chat should accelerate finding and shaping work; daily task completion should remain discoverable without knowing the right words.

Astryx-only composition has already produced consistent components and an accessibility test discipline. Keep that preference, while allowing narrow, reviewed exceptions when a documented task or accessibility requirement demands one. The calendar exception is a useful precedent. Layout refinements deserve less priority than reliable work completion until the architecture milestone is complete.

The main design correction is to make work occurrence, execution and delivery explicit concepts behind the thread UI. That preserves the product's simplicity while giving its strongest promises somewhere concrete to live.

## Outcome

Review saved with source evidence and prioritised recommendations. No application code, dependencies, architectural decisions, connector configuration or external systems were changed. Implementation and roadmap acceptance remain separate work.

Follow-up, 2026-11-05: the requested [implementation plan](../architecture/reliability-and-authorization-plan.md)
now sequences these findings into six phases with acceptance checks and rollout boundaries. The product owner
explicitly left the real-system pilot source open. The plan was subsequently approved for implementation; its checkpoint and D44–D46 record the delivered mechanisms and pending work.
