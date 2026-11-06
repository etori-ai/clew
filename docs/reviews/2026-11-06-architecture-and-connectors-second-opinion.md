# Second opinion: architecture, connector authoring and shared fact kinds

Date: 2026-11-06
Reviewed revision: `598c9f2`, including the supplied working-tree review.
Status: independent assessment and recommendations; no architectural decision accepted.


## Implementation follow-through, 2026-11-06

The corrective work is now in the shared checkout (no worktree). Payroll narrows every read/follower to its own employee
directory and the signed actor's mapped unit. Bootstrap is explicitly development-only and preserves existing
administrator settings. Reset stops at a live BFF, retires old executions without inventing outcomes, blocks watches,
cancels reminders and archives old card grouping keys before deleting only the five source volumes.

The replacement Node tests use actual HTTP and child processes: response loss after commit, process death, SQLite
recovery, same-operation replay, changed-input rejection, scan and undo; plus HR/payroll's authenticated feed,
next-day visibility, unit denial and source failure. PostgreSQL tests cover pending/unknown/completed retirement,
preserved receipts, cancellation, repeat reset and administrator configuration. Shell tests exercise reset ordering,
volume scope and failure handling without deleting the live stack.

The Eneo adapter had a separate authorization flaw: a document cached by one person could be returned to another
without consulting Eneo. Cross-request source caches are removed. Every request rechecks source access; a missing
document is skipped, but denied/unavailable calls are no longer silently converted into successful empty searches.
Two-user, revoked-access and mid-search-outage tests cover the correction.

Verification: **439 unit/web tests, 6 Node tests and 49 PostgreSQL tests passed**; formatting, types, dependency rules,
purity and generated-document checks passed. No live-source pilot is implied by those results.

The live bootstrap check found **six legacy fixture executions** referring to removed in-process source contracts.
The reset preflight correctly refused while the BFF was running. No live fixture volumes were deleted and those
executions were not retired by this review. This explicit development cutover remains an operator action.

The local Eneo container exists, but its API process is stopped and resource-server mode is disabled, with no accepted
issuer/audience configured. A live pilot still needs a selected test tenant, collection and two users with different
access. No Eneo configuration or data was changed. Keep the next increment to that read/search/permission journey;
do not use the completed fixture work as evidence of a real-source integration.

## Updated assessment: independent fixture connector plan (2026-11-06)

Checkpoint: `838b3da`. The implementation was active during this review; this is a snapshot, not a claim that the
remaining work will still be absent when read.

**This plan improves the architecture and directly addresses part of the earlier criticism.** It removes a privileged
in-process path and makes development exercise the external contract. Keeping fixtures in the repository and starting
them automatically in the development environment is compatible with a core that knows nothing about them.

The next milestone is to finish and prove that transition. The next development project after it should be one real
source adapter, not another generalisation of the protocol.

### What has changed since the original assessment

The English identifier migration and all six standalone fixture implementations are committed. The application registry
still imports and registers the old in-process mocks at this checkpoint. The development bootstrap, full removal of
those mocks and the migration away from their shared state remain the key transition work. Node/SQLite runtime tests
and generated examples were being edited during the review; their completion is not claimed here.

Ran all six new connector unit files: **27 passed, 0 failed, 148 assertions**. These exercise real request handlers
through the transport with synthetic state. They do not by themselves establish a running six-service development
stack, a real process crash, or a usable integration to a vendor API.

### Three corrections before accepting the transition

1. **Enforce source-side unit access in payroll.** Its handler verifies identity and the manager role, but currently
   discards the mapped unit with `void unitOf(actor)`; `payroll.absences` returns the imported feed without narrowing
   it to that actor. Reproduced with synthetic data: a correctly signed manager from `other-unit` received HTTP 200
   and the fixture employee's absence row. Cover other-unit managers, unknown people and mapped identities in the
   acceptance tests. A fixture used as a connector example should demonstrate the source-side scope rule.
   Evidence: [payroll handler](../../connectors/payroll/connector.mjs).

2. **Make reset actually reset named fixture storage.** The plan proposes named SQLite volumes but resets with
   `docker compose rm -sfv`. Docker documents that this option removes anonymous volumes; it does not remove those
   named stores. Use a deliberately scoped reset/reseed operation and verify both source data and Clew's fixture
   cards afterwards. Include operation logs in the reset policy so an earlier deduplication result does not silently
   survive a supposedly fresh scenario. Do not reset unrelated database or identity-provider storage.
   Source: [Docker Compose rm reference](https://docs.docker.com/reference/cli/docker/compose/rm/).

3. **Define the cutover for existing fixture work.** The plan keeps execution rows while replacing their source
   storage. Also, the new manifests use `hr.lookup` and `timesheet.lookup`, whereas the old execution declarations
   name `hr.absenceLookup` and `timesheet.absenceLookup`. Existing executions retain their recovery contract.
   Fresh SQLite files cannot reconstruct the old source effects. Before removing the old state, establish a development
   cutover that drains or explicitly retires pending fixture work, or preserves the necessary lookup contracts and
   source records. Merely retaining connector ids and cards does not preserve execution recovery. Test the chosen
   policy with pending, uncertain and completed fixture work.

These are changes to the acceptance criteria and remaining implementation, not a proposal for another architecture
layer. No implementation was changed by this review.

### What “this plan is done” should mean

- A clean development start registers the six remote connectors and bindings; a repeated start does not duplicate
  them or overwrite deliberately changed configuration. Automatic registration and enablement are explicitly
  development-only, with no fixture activation in a normal deployment or generic database migration.
- The application and core packages no longer import the fixture implementations or store their source records.
- One employee journey works through the real network boundary: scan, card, approval, receipt, restart, read-back
  and supported undo.
- The HR/payroll chain also works over its actual HTTP feed. Its in-process injection remains useful for fast tests,
  but is not the only evidence.
- An unavailable connector affects its own work without hiding the others. Wrong-unit and forged-identity cases
  cannot disclose or change fixture records.
- Reset produces fresh fixture state, cards and a deliberate operation-log state, while preserving unrelated services.
- A genuinely lost response or terminated process after commit is recovered without a second effect. Distinguish
  this from throwing an exception in a live handler or closing and reopening a store.

Do not expand every fixture to model every vendor limitation. Include or retain one explicit source path without
safe replay so the system's conservative `unknown` behavior remains tested; a collection of universally deduplicated
fixtures would otherwise be an unusually accommodating integration environment.

### The next project: prove one real adapter

The fixture service combines a synthetic source and a connector. That is an effective protocol test, but it does not
yet test translation from an independently designed source API. More fictional systems will not resolve that question.

Choose the smallest available real-source path. Eneo is a plausible first candidate because a connector already
exists and the earlier review identifies a local instance; confirm access and API compatibility before committing
to it. A live directory read is another suitable candidate if that API is available. Do not block this work on buying
access to an HR system or on standardising shared facts.

A bounded first slice would be: sign in as a real test user, search an accessible source, open the result, verify that
a second user cannot see material outside their permissions, and show a useful unavailable state when the source is
down. Use the existing external connector path and a source adapter; avoid a new Clew core mechanism unless the
experiment demonstrates a concrete gap.

Then package what was actually needed into one maintained starter and a standalone conformance runner, and have a
developer unfamiliar with Clew build a small connector from the public instructions. The repeated verifier/server
code is now visible across six services, but it is still too early to infer a generic domain framework from that
repetition. Small optional infrastructure helpers can follow demonstrated repetition.

### Revised recommendation

Finish this plan with the corrected acceptance criteria. Preserve `hr:absence` while proving the chain; defer the
shared-kind catalogue, schema editor, transform rules and broad health propagation. The fixture plan provides better
integration-boundary evidence; a real adapter provides the missing source-translation evidence. Together they give a
much stronger basis for deciding which abstractions Clew actually needs.

## Original assessment at 598c9f2

### Judgment

Clew has a credible core architecture. It is already largely a modular application with external connector services,
not a collection of core microservices that needs to be merged. The strongest choices are source ownership of records,
one rendering model, an optional AI, explicit human approval, and a durable record of source effects.

The project has nevertheless moved ahead of its integration evidence. Shared events, cross-system jobs, watches,
dependency propagation and compatibility policies are being developed while identity mapping and important real-source
paths remain unproven. The primary excess is breadth of platform commitments, not simply the choice of infrastructure.

I would preserve the core and reduce the next increment. Make one useful connector and one complete employee journey
work against a real source before expanding the composition system. Do not rewrite the application.

The supplied documents' recommendations and descriptions of earlier agreement were assessed as evidence, not treated
as instructions to implement them.

## Could the whole architecture be simpler?

Yes, but the answer depends on the promise.

If the first product is search, a unified inbox, source detail and links to act in another system, it can ship with
a much smaller supported surface. Approved source writes, uncertain outcomes, undo and durable follow-up add substantial
responsibilities. If those remain product requirements, deleting their mechanisms does not delete the responsibilities.

A simpler supported architecture would be:

- One Clew application and database owning identity context, connector configuration, the stream, decisions and receipts.
- External HTTP connectors translating source APIs and enforcing source access.
- One common path for calls, one for discovering work, and one for approved actions.
- The existing durable worker machinery behind those paths, invisible to connector authors.
- Cross-system composition available only for the flows that have been proven, rather than the default integration model.

Much of that is already present. The simplification is to narrow what must be understood and supported at once.

| Keep | Simplify or defer |
|---|---|
| The modular core and independent HTTP connector boundary. | Further generalisation before a real integration exposes repetition. |
| Verified identity, source authorization, audit and explicit approval. | Repeated hand-maintained authentication and transport plumbing in every connector. |
| Persisted intent, receipts and conservative handling of unknown effects. | A promise that every source can support automatic retry or undo. |
| Existing durable timers where follow-up is required. | Additional orchestration abstractions or a replacement home-grown scheduler. |
| Clew-rendered semantic views, with links to the source for complex work. | A page builder or arbitrary embedded connector applications. |
| Flat bindings for genuinely independent steps. | Conditions, transforms, branching, ordering and a general dependency engine. |
| D60's generated protocol and field reference. | Multiple competing definitions of the same validation rules. |

Temporal is not my first target for removal. For a read-only portal it would be unnecessary; for the promised durable
actions and follow-up it has a concrete job. Removing a working implementation now could add migration work and force
the team to recreate its responsibilities elsewhere.

Some internal rules are more absolute than necessary. For example, “a route that grows a second statement of logic”
and “a file that does not fit one kind is two files” are useful prompts for review, not measures of correctness.
Keep authorization, transactions and dependency boundaries enforced; allow routine local organization choices without
requiring a new architectural ceremony. This is a maintainability recommendation, not a reason to reorganize working files.

## Can an integrator actually build a connector?

Yes, especially a read connector. The protocol has a practical minimal path: a manifest, a capability handler,
verified identity and an adapter to the source. The phone book is a functioning example with no Clew runtime imports,
and a connector does not have to understand jobs, Temporal, event kinds or the entire decision history.

I verified that claim in two ways:

1. Ran the documented signed walkthrough: manifest validation, five phone-book capabilities, required-input detail,
   actor binding and credential rejection all passed.
2. Copied the complete phone-book connector to a temporary directory outside the checkout and ran its unchanged Node
   server as a separate process. Against an ephemeral public-key server, its manifest and signed read worked,
   a forged body actor did not change the result, and an invalid token returned 401. The connector imported no
   workspace packages. The temporary files and processes were removed.

This demonstrates a runnable standalone example. It does not demonstrate that an unfamiliar integrator can finish
a real integration unaided, and it did not exercise a live directory API.

The difficult part of a real integration is still the source: mapping identities, applying record-level permissions,
handling pagination and revisions, and establishing what happened after an uncertain write. OpenAPI can describe
transport, but the generic call envelopes have arbitrary input/output; each capability's manifest schema and its
business meaning still need to be implemented.

My assessment by integration level:

| Level | Assessment |
|---|---|
| Reads, search and standard views | Credible path today; a competent integration developer should be able to start from the example. |
| Scanned work and cards | Feasible, but stable occurrence identity, revisions and incomplete snapshots need a focused guide and examples. |
| Approved writes | Feasible for an experienced integrator; source-specific recovery evidence is essential. The ordinary checker intentionally does not perform writes. |
| Cross-system jobs | A demonstrated engine with a larger authoring and operating burden. At this revision the job card and binding administration are still missing, so it is not yet a complete self-service integration path. |

### What would improve onboarding most

Publish a deliberately minimal read starter and one maintained action starter. Treat search, scans, writes, delegation
and composition as optional additions, not a checklist every connector must complete. Existing documentation already
encourages starting small; make the executable examples and testing path equally small.

Provide a standalone conformance tool or test image with signed fixture requests. Today a draft can be checked through
a test installation, but the no-installation harness imports Clew's repository internals. A reusable test tool is a
higher-priority developer deliverable than more fact kinds.

Reconsider an absolute “no SDK” position. A language-neutral HTTP contract does not require authors to maintain copies
of security plumbing. Begin with a maintained, tested starter; if duplication persists, a small optional helper for
assertion verification, validation and errors can be worthwhile. It should have a clear update path and never become
a requirement for other languages. The wire protocol remains the contract.

Make supported behavior unambiguous. The status matrix is useful, but a newcomer should not have to reconcile proposed
decision records with implemented behavior. In particular, fix the dry-run/registration disagreement described below.

The next usability test should be a developer who did not write Clew, building one source-specific read from the
public documentation in their normal language. Record where they need help. An isolated-copy test establishes
portability; that exercise establishes authorability.

## Second opinion on the proposed shared kinds

I agree with retaining connector-owned kinds, putting source translation in connectors, keeping bindings flat,
and deferring administrator-authored schemas. I would change the proposal in six respects.

### 1. Connector ownership does not inevitably imply vendor ownership

The registry enforces the connector id as the namespace. An adapter registered as `hr` can be replaced while preserving
`hr:absence` and its attributes and meaning. The example already uses a generic id. Therefore changing vendor does
not necessarily require changing every follower.

A Clew-owned kind is useful when independently implemented connectors need a commonly governed contract. It is not
essential merely because the underlying vendor could change. Private kinds already provide more flexibility than the
original review implies.

### 2. Start with one kind, not the proposed catalogue

The proposed absence, employment, invoice and case list is not justified by implemented followers. Start with the actual
absence flow and add kinds when a concrete reuse case exists.

“A second connector needs it” is too vague: a producer and its follower already meet that condition without proving
portability. Validate the semantics against a second independent producer or representative second-source contracts
and payloads before claiming vendor independence. Do not deploy extra products merely to satisfy this test.

### 3. Distinguish proposed work from observed facts

The review describes completed events such as “absence registered”, but the current envelope also represents proposed
work. Its optional `ref` distinguishes an existing source record from a job that would create it; the HR follower
skips its write when that ref is present.

“Registration requested” and “registration confirmed” can justify different actions. Define the first shared kind's
meaning and who may assert it before publishing it. Use the existing proposal/receipt boundary where it is sufficient;
add a discriminator or another kind only when the real use case requires it. A source reference alone is not a general
proof of completion.

### 4. Independent steps do not prove business independence

The review's “a running job cannot cascade” claim is too broad. The implementation isolates technical outcomes.
A time-reporting write can still succeed while the HR registration fails, leaving inconsistent business state.

Ask whether that partial success is acceptable for this particular action. If yes, the star-shaped job is appropriate.
If no, the action belongs after a confirmed result, using D55's next proposal and approval boundary, or in the source
system that owns the process.

Keep this restriction explicit. Do not solve it by quietly adding step ordering or a workflow language. Also test whether
another approval at each dependent result is acceptable to the employee; that is a product trade-off, not merely a
technical implementation detail.

### 5. Preserve producer and subject identity

A shared `clew:` kind no longer identifies its producer. The current envelope contains kind, optional ref and attributes;
bindings select a kind and follower with an audience, without selecting a producer.

Specify the subject identity and preserve the producer through a trusted invocation or receipt context. A vendor's
employee ref is not by itself a portable person identifier. For the first flow, one authoritative producer per relevant
scope is a reasonable explicit limitation.

Defer general multi-source routing. Before enabling multiple producers or pushed events, establish how an applicable
producer is selected and how repeated observations of one occurrence are recognised. Decision-id deduplication alone
does not establish that two observations describe the same business event.

### 6. Keep extensions from becoming a hidden contract

An unchecked `details` object that followers “may read but must not depend on” is a weak boundary. A follower whose
action needs a vendor-specific field is coupled to that field regardless of the shared kind name.

Omit a general details bag initially unless needed. If retained, keep it optional, bounded and supplementary. Required
behavior belongs in an explicit schema or a private kind. Specify identifier meanings, dates, units and states instead
of collecting fields with similar names.

Compatibility is directional: widening values a producer can emit can break a follower even though it loosens the
producer's schema. “Looser constraints are compatible” needs qualification for shared fact outputs.

## Dependency visibility and validation

Build a simple table on the existing connector page showing direct calls and active follower bindings, their targets,
and known missing or disabled providers. Warn about the affected capabilities/bindings before disabling or removing
a connector. A declared follower offer is not necessarily an enabled dependency.

Do not immediately degrade a whole connector because one potential upstream is absent. Explain which work is affected.
For a shared kind, “one producer is unavailable” differs from “there is no applicable producer”; another producer for
a different audience may not be a replacement. The table also cannot prove that an upstream event was missed.

The original review names `Registry.creates(kind)`; the current method is `offered(kind)`. It checks enabled connectors'
fact declarations, not source liveness or every creating capability's switch. This is configuration evidence, not
a full health verdict.

The dry-run inconsistency is broader than the missing fact-prefix check. `manifestProblems` also lacks the registry's
checks that only a propose may follow and that a created kind must be declared. Share manifest-local rules between
dry run and registration. Keep checks that depend on the installation separate. D60 is valuable precisely when these
answers agree.

## Recommended next investment

1. Finish one employee journey against a real source: read useful work, inspect it, and take one supported action or
   follow a source link. Confirm identity mapping and permissions early.
2. Make that connector reproducible outside the Clew repository with a maintained starter and independent test tool.
3. If cross-system work is essential to the first pilot, finish one job's user and administrator experience and test
   partial failure and recovery with its actual business owners.
4. Add one shared kind only when that flow needs it; expand the catalogue and dependency behavior when demonstrated
   limitations require it.

The architecture is not a dead end. It is ahead of the evidence in composition and behind in integrator convenience.
The most useful simplification is to narrow the supported journey while retaining the extension boundary.

## Evidence and limits

Primary references:
[original fact-kind review](2026-11-06-fact-kinds-ownership-and-dependency-visibility.md),
[D60](../decisions/D60-the-instance-serves-its-connector-protocol.md),
[manifest reference](../generated/manifest-reference.md),
[vision](../vision.md),
[implementation status](../reference/status.md),
[connector guide](../guides/creating-a-connector.md),
[testing guide](../guides/testing-and-deployment.md),
[write guide](../guides/actions-and-receipts.md),
[backend structure](../architecture/backend-structure.md),
[registry](../../packages/connectors/src/index.ts),
[manifest validation](../../packages/connectors/src/remote.ts),
[protocol](../../packages/connectors/src/protocol.ts),
[job bindings](../../apps/server/src/modules/jobs/contracts.ts),
[job assembly](../../apps/server/src/modules/jobs/usecases.ts),
[HR follower](../../connectors/hr/connector.mjs),
[phone-book connector](../../connectors/phonebook/connector.mjs).

Verification in the devcontainer: 43 focused job, mock-job and served-protocol tests passed, with 290 assertions;
the documented signed smoke test passed; the isolated HTTP connector exercise described above passed.
These establish fixture and protocol behavior, not a production pilot, a new-author usability result or an exhaustive
architecture/security audit. No application code changed.
