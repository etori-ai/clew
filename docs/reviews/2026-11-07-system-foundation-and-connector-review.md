# Clew system foundation and connector review

Date: 2026-11-07. Reviewed baseline: `5c0810d`.

**Clew is a credible foundation to continue building on. Keep the modular application and the connector boundary. Correct the authorization gaps below before using sensitive source data, and make one real integration the next architectural test.** The main opportunity for simplification is to reduce repeated mechanisms and the number of optional concepts an integrator must learn.

This review concerns architecture, source integration, authorization and operational behavior. The initial checkout was clean; unrelated review-overlay UI edits appeared during the review and are outside its assessment. No application code was changed during the review. The five numbered findings were subsequently addressed at the product owner’s request; see the implementation outcome below. The original findings and reproductions remain as the baseline evidence.

## What is solid

The core is a modular application with explicit ports and adapters. Its domain and use-case code can be exercised without running a database or external source, while database contracts check the live adapters. Dependency rules enforce meaningful boundaries. This gives the project a practical way to change implementations without rewriting business behavior.

The connector boundary now has stronger evidence than the earlier architecture reviews: the six development sources are independent services, and neither `apps/` nor `packages/` imports their implementations. They exercise the same remote transport used by third-party integrations. A source can be replaced without adding vendor-specific code to the browser.

The division of responsibility is sound: sources own their records and source permissions; Clew owns coordination, approvals, receipts and presentation. The model is optional and cannot directly execute source writes. Declared views let Clew keep consistent interaction and accessibility behavior across integrations.

The execution ledger is particularly valuable. Approval, audit and delivery intent commit together before source I/O. Dispatch retains a stable operation identity; recovery uses the declared source lookup and replay policy. An uncertain effect is preserved as `unknown`, and compensation has its own recorded execution. This is useful complexity for a system that acts across unreliable boundaries.

Temporal has an identifiable responsibility here: waiting and delivery for committed work. PostgreSQL holds the business intent and evidence. The real-stack tests passed for lost-response recovery, timers and bounded watches. Removing Temporal would require preserving those behaviors elsewhere; it is not the first simplification to pursue.

Evidence: [registry](../../packages/connectors/src/index.ts), [execution use cases](../../apps/server/src/modules/executions/usecases.ts), [workflows](../../apps/server/src/temporal/workflows.ts), [dependency rules](../../.dependency-cruiser.cjs).

## Findings to address

### P1 Preserve authorization provenance on scanned cards

A person who transfers from unit A to unit B can still read previously scanned unit A cards when the connector remains visible to that person. Changing the person's authorization version does not prevent this.

The scan projection saves card content and an assistant message without access metadata. `visibleThread` requires connector visibility for a pushed card, but only checks the authorization version when a message carries access metadata. Occurrences retain their assignment separately; the shared card reader does not consult it. A complete scan for the new assignment does not resolve the old assignment's occurrences.

**Reproduced:** create a card through `refreshUsecases` under `unit-a:manager` and authorization version `v1`; change the same actor to unit B and `v2`; run a complete empty scan for B. Both `threadAccess.list` and `threadAccess.read` still returned the unit A card, and the old occurrence remained open. This used the current use cases and memory adapters, with no live personal data.

Persist the authority under which a source snapshot was obtained and enforce it on every read path. An assignment or authorization change must hide affected snapshots until explicitly revalidated, with a conservative policy for older snapshots lacking provenance. Cover cards, history, chips and model context. Source-side permission changes that do not change Clew's own grant also need an explicit snapshot revalidation policy.

Evidence: [shared reader](../../apps/server/src/threads/access.ts), [scan projection](../../apps/server/src/threads/usecases/refresh.ts), [occurrence storage](../../apps/server/src/threads/adapters/refresh-postgres.ts).

### P1 Recheck authority before releasing area figures

Ordinary `Registry.run` calls refresh governance after a source answers and reject the result if access changed. `Registry.areas` and `figureOf` do not apply that protection to figures. The `/areas` route also has no final person-authorization check after awaiting them.

**Reproduced:** use the real communication manifest and remote transport, disable its governance while the synthetic source responds with a valid figure, then await `areas`. It returns the figure although `visible` is now false. This establishes the behavior without depending on a live timing race.

Apply the same current-authority rule to figures as to ordinary reads, including the connector audience, area role and figure switch, and revalidate the authenticated person before releasing the combined response. Filter the final result so a figure obtained earlier in the batch cannot survive a later revocation. Add tests for policy changes and person revocation during the await.

Evidence: [area and figure reads](../../packages/connectors/src/index.ts), [area composition](../../apps/server/src/threads/usecases/cards.ts), [route](../../apps/server/src/routes/api.ts).

### P2 Separate permission refresh from connector reconstruction

`refreshConnectors` calls `applyAllRows`. For every remote row, `applyRow` opens the secret, parses the manifest and replaces the connector even when nothing changed. Replacement validates the registration in a temporary registry and again in the live registry. Freshly loaded JSON schemas are compiled again.

This happens in API middleware and before and after capability invocation, with further refreshes for nested calls. There is already a watcher for changed row versions, but the invocation path still rebuilds all remote registrations.

**Measured:** ten refreshes of unchanged copies of the six actual fixture manifests caused 60 connector replacements and took 505 ms in the development container. The synthetic store had no PostgreSQL or network cost. This is evidence of redundant work, not a production latency benchmark.

Retain authoritative permission checks while keeping compiled connector descriptors stable. Rebuild only when the manifest or transport configuration changes; apply governance separately and coalesce concurrent refresh work. Account for manifest updates explicitly: `recordHealth` can change a manifest without bumping the governance version, so caching solely by that version would miss changes.

Evidence: [composition refresh hook](../../apps/server/src/composition/index.ts), [reconciliation](../../apps/server/src/connectors/reconcile.ts), [replacement and invocation](../../packages/connectors/src/index.ts), [manifest persistence](../../packages/db/src/connectors.ts).

### P2 Keep slow figures from delaying all areas

`Registry.areas` awaits each figure inside nested loops. Every slow source adds its waiting time to the same response. The remote transport's default timeout is ten seconds, with no overall figure budget. Cards have an asynchronous refresh path, but `/areas`, its counts and menu data still await this batch.

**Reproduced:** three valid synthetic figures delayed by 100 ms each took 307 ms together. Several unavailable remote figures can therefore make the areas response wait through multiple timeouts.

Use bounded concurrency and a total response budget, preserve the configured ordering, and report unavailable figures individually. If live figures need longer, deliver them separately from area navigation and counts. The existing search fan-out provides a useful pattern without requiring another orchestration framework.

Evidence: [area loop](../../packages/connectors/src/index.ts), [transport timeout](../../packages/connectors/src/remote.ts), [search budgets](../../apps/server/src/modules/search/usecases.ts).

### P2 Make manifest preview and registration agree

The public dry run uses `manifestProblems`; registry registration applies additional rules. The earlier second opinion identified part of this problem, and it remains present.

**Reproduced:** preview reported `ok: true` for four variations of the communication manifest that registration rejected: a duplicate capability, a foreign fact namespace, `follows` on a read, and an invalid capability input schema.

Use one manifest-local validator for preview, registration and conformance checking, including compilation of embedded schemas and cross-field rules. Keep installation-dependent checks separate. An integrator should receive the same answer before and during installation.

Evidence: [manifest validation](../../packages/connectors/src/remote.ts), [preview](../../packages/connectors/src/preview.ts), [registry registration](../../packages/connectors/src/index.ts).

## Is the connector paradigm a good choice

**Yes, for the external-system boundary.** Clew must integrate systems with independent vendors, deployment cycles, authentication rules and languages. An HTTP contract makes those differences local to each adapter. Manifest-driven capabilities and semantic views also let an administrator install an integration without rebuilding the main application.

Keep the minimum connector small: a manifest, one useful read, verified identity, source authorization and a declared result. Search, views, scans, approved writes and cross-system following should be optional profiles that an author adds as needed. This can initially be a documentation and conformance-test structure within protocol 2; it does not require a replacement protocol.

The connector should translate source concepts into useful employee tasks. It should not mechanically expose every vendor endpoint or require Clew to understand the vendor's database. Likewise, a scan should report source work and its stable identity, while Clew continues to own attention, presentation and approval.

Independent deployment adds real operating work: service configuration, credentials, key rotation, network failures and compatibility. Make the deployment unit match an external integration's ownership. Keep ordinary core helpers behind local ports; every internal abstraction does not need a connector lifecycle or a new service.

A connector contract also cannot guarantee business compatibility by itself. An accepted JSON schema does not prove that an employee identifier is mapped correctly, a scan is complete, or two systems mean the same thing by an absence. Those obligations need source-specific examples and tests.

### Delegated reads do not yet imply durable delegated actions

This is the most consequential current capability limit. Session-backed reads can receive a delegated source token. Background scans do not have that token. For generic remote executions, `source.authorize` marks a connector declaring delegation as `needsSession`, and `progress` leaves its operation pending with `needs-session` before source dispatch. Reconciliation does not supply the missing session credential.

That conservative behavior is preferable to silently using broader authority, but it means a working delegated read connector is not automatically an action connector. Select and prove the source's unattended authorization arrangement before promising reminders, scanning or durable writes for it. Retaining an unsupported operation as pending is not a complete sign-in-and-resume experience.

Evidence: [execution source authorization](../../apps/server/src/composition/executions.ts), [execution progress](../../apps/server/src/modules/executions/usecases.ts), [scan delegation guard](../../packages/connectors/src/index.ts), [authorization guide](../guides/authorization.md).

The current identity model also has one grant per person, one unit and two broad roles. It can serve a deliberately bounded pilot. Multiple simultaneous assignments and enterprise provisioning remain substantive work, as the [reliability acceptance matrix](../reference/reliability-acceptance.md) already acknowledges.

## Simplifications worth making

| Change | Benefit and boundary |
|---|---|
| Keep one runtime manifest validator | Removes contradictory installation answers and duplicated rules. |
| Separate current governance from compiled connector descriptors | Preserves revocation checks while removing repeated construction and schema compilation. |
| Maintain an optional connector support package or generated starter | Ten verifier files are currently byte-identical; six fixture state implementations are also byte-identical. Security fixes need one maintained source and a clear update path. Keep the HTTP contract usable in every language and keep business adapters independent of Clew internals. |
| Make connector profiles explicit | Read-only authors can ignore operation recovery, scans and cross-system jobs until they need them. |
| Consolidate live paths and legacy paths gradually | Production replaces `threadUsecases.ensureThreads` with `refresh.request`, while older tests still exercise the former scan implementation. Move coverage to the live path, then remove unused behavior after checking callers. Preserve old Temporal histories until their replay and retirement policy permits removal. |
| Repair the current architecture map | `backend-structure.md` still lists removed mocks and figures and old composition filenames. Update the as-built map; retain historical decisions as history. |

Avoid expanding the fact catalogue, transform rules, dependency routing or view language before a real use case needs them. The existing flat cross-system jobs are defensible when their steps are business-independent. If HR must succeed before payroll or time reporting may act, an independently dispatched job does not enforce that dependency. Keep that process in its owning system or establish a subsequent proposal after the first result; do not silently grow a general workflow designer.

## Recommended sequence

1. Correct stored-card provenance and figure authorization before connecting sensitive data. Cover transfers, changed roles and revocation during reads.
2. Remove repeated registration and unify manifest validation. Bound figure collection. These are focused changes within the current architecture.
3. Complete one real read journey: sign in, search or list, open a record, prove two users' different access, transfer or revoke access, and observe a useful source-outage state. Eneo and directory adapters are candidates; this review did not establish live readiness for either.
4. Add one real approved action only after its credential, read-back, deduplication and recovery behavior is established. Keep sources that cannot support safe replay on the conservative path.
5. Package a small starter and an independently runnable conformance tool from that experience, then have a developer unfamiliar with Clew build a second adapter. Expand composition only when these integrations demonstrate the need.

## Verification and limits

Executed through `docker exec` in the development container:

- Standard `bun run check`: formatting, TypeScript, dependency rules and purity passed; **536 unit/web tests**, **6 Node runtime tests**, generated documentation checks and the signed phonebook walkthrough passed.
- `bun run test:db`: **52 tests passed** against PostgreSQL.
- `bun run test:durability`: **3 scenarios passed** against PostgreSQL, Temporal and Node.
- Additional isolated diagnostic scripts reproduced the five findings above; the registry measurement used cloned fixture manifests and a synthetic store.

The standard check completed before unrelated UI edits appeared. These results establish useful implementation evidence, not live-source readiness or full security and accessibility conformance. Browser tests, a screen-reader pass, production load, a selected real-source pilot and coordinated source/Temporal restore were not performed in this review.


## Implementation outcome · 2026-11-07

The five findings above are addressed in the working tree:

1. New source cards persist their original authorization version, and the shared reader rejects old or absent source provenance. Fresh scans create new history rather than retagging old messages; uncertain, unchanged confirmed and dismissed occurrences do not produce duplicate approvals. Migration 0034 deliberately leaves legacy provenance unset. The [snapshot policy](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md) records this visibility change and the remaining source-ACL integration responsibility.
2. Figure batches check person authority and refreshed connector governance before releasing any result, including early answers. Disabled figures, revoked links and changed descriptors are filtered.
3. Reconciliation caches descriptors by manifest, address and sealed secret, reapplies current governance without rebuilding them, and serializes/coalesces fresh reads. A final check arriving during an earlier read waits for a subsequent snapshot. Manifest updates without a version bump remain detectable.
4. Figure calls use bounded concurrency (four by default) and one two-second source budget including queued calls. Remote requests receive cancellation; unfinished calls show the existing unavailable state. Completions skip figure reads.
5. Preview, parsing and registration use the same descriptor validator, including duplicate names, fact ownership, follows/creates rules and JSON Schema compilation. Replacements validate before removing the current registration.

Regression coverage includes memory and PostgreSQL transfers and renewed grants, legacy snapshots, chips and model context, uncertain actions, descriptor reuse and concurrent refreshes, in-flight figure revocation, timeouts and HTTP cancellation, and preview/registration parity. Final verification results are recorded in the session log in [HANDOVER](../../HANDOVER.md#9-session-log).

This closes the five code findings, not the separate real-source pilot and operational release gates. The connector starter, explicit profiles, gradual legacy consolidation and architecture-map cleanup remain recommendations for subsequent work.
