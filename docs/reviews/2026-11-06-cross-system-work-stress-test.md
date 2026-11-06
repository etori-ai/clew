# Stress test: one event, work in several systems

Date: 2026-11-06

Reviewed revision: `5553c27`
Status: review and recommendation; no architectural decision changed

## Assessment

The vision promises that "where a workflow today means opening three systems in order, Clew is the order"
([vision](../vision.md#L44)), and the design canvas **Clew startsida · dagen i ett svep**, artboard **J · Arbete över
tre anslutningar**, draws what that looks like: one conversation carries a *job*, the assistant lays one proposal with
one step per system, the person confirms once, and one receipt per source comes back. The product owner added two
constraints on 2026-11-05: the scenario is artboard J extended with the rehab rule the HR mock already scans for and
the 13:00 utvecklingssamtal as a dependent next proposal, and **connectors are standalone: Clew writes no code per
flow, so the system must assemble the flow from what connectors declare.**

Traced against the code, the per-system half of the promise holds and the cross-system half does not exist. The
execution ledger (D45) gives every write its own decision identity, read-back, unknown-never-replayed state and linked
compensation, and the unit suite proves it. But an approval is one operation on one connector, a card is one system's by
rule (D35), nothing watches a system Clew does not write in, nothing assembles steps from several connectors, and the
only composite in the tree is hand-written. The trigger side is a scan, not an event (D19 is proposed). A watch firing at
20:02 has no identity to fire with. There is no rule for what happens to a follower when the fact it follows changes
shape, and no place where an administrator can see what follows what.

None of this calls for a workflow engine. The missing piece is small and generic: connectors declare the facts they
bring about and the facts they follow, an administrator binds one to the other, Clew fans out once and assembles a job
proposal the way the search composite assembles hits, the person approves the job once, and the ledger runs one
execution or one bounded watch per step, independently. That shape is being recorded as the proposed decision on jobs,
numbered D54 when it lands, and proven in code in a parallel session. This review records the trace, the gaps and the
budget it must stay within.

## Basis and limits

Read: the vision, the personas, D8, D19, D23, D35, D37 (dependencies), D45, D47, D52, D53, the architecture documents
on backend structure and working across connectors, the implementation status and the acceptance matrix, and the
2026-11-05 architecture review. Traced: the execution ledger and its projection, the card decision path, the registry's
card rule and callback handle, the connector callback route, the HR mock's scan, the search composite, the calendar
follow-up and the Temporal workflows. The design canvas is named as the reference; it was not fetched for this review,
and the artboard is read from the approved plan's description of it.

No code was run for this review beyond `git rev-parse`. The evidence is the existing unit suite for the ledger
(`tests/unit/executions.test.ts`) and the file references below, each checked against this checkout. The parallel
proof session's results are not evidence here; its outcome belongs in the decision and in a later review.

Generic system names only (D52): "the HR system", "time reporting", "payroll". Nothing here names a product.

## The scenario

Artboard J extended, as the product owner asked. A manager in home care (Kim in `docs/personas.md`) opens Clew after
an employee has self-reported sick in the HR system for today.

| Step | System | Kind of step | Persona coverage |
|---|---|---|---|
| Register the absence for today's shift | the HR system | write | UC-KIM-1 (who is at work today), UC-FATIMA-2 (the same event producing an action for someone else) |
| Mark the shift unstaffed and reopen it for cover | time reporting | write | UC-KIM-1 (unfilled shifts), UC-ALEX-4 (per-source outcomes on a confirmed proposal) |
| Payroll picks the absence up from the HR system itself | payroll | **watch**: Clew writes nothing, reads at 12:02, 20:02 and 08:02, and says so if it never shows up | UC-ALEX-4 (missing facts shown as unknown) |
| The sick-leave pattern rule | the HR system | the HR mock's existing scan (`hr:rehab:<employee>`): three short absences in 180 days draws a card to book a talk | UC-KIM-2 (six-plus short periods flag a rehab obligation), UC-KIM-8 |
| The 13:00 utvecklingssamtal with the absent employee | the calendar | a **dependent next proposal**: move or cancel, asked after the absence is a fact, never automatic | UC-KIM-8, UC-KIM-3's approve-with-context pattern |
| A substitute for the shift | the substitute pool | the next proposal after time reporting's receipt, never an automatic action | UC-KIM-1 |

What the artboard promises for this: one proposal with one row per system, one confirmation, one receipt per source
("klart med ångra", "okänt, läses tillbaka, skrivs aldrig om", "bevakas"), the job under *Väntar på andra* with its
step list in the panel, and the substitute question as the next proposal.

## The trace

Each step says whether the architecture as built holds, and where the evidence is.

**1. Trigger.** The employee self-reports in the HR system. Clew learns of it only when a scan runs: the HR mock's
`scan` draws cards from fixtures on first visit and nightly ([hr.ts](../../packages/connectors/src/mock/hr.ts#L163)),
and the change-notification contract is proposed, not built ([D19](../decisions/D19-change-notification-is-a-clew-owned-contract.md),
[status](../reference/status.md#L20)). **Holds as a scan; breaks as an event.** The job can start from the box ("Hassan
är sjuk i dag") or from a pushed card, but nothing in the tree carries "an absence came into being" as a fact Clew can
act on.

**2. Proposal.** Who lays the three rows? A `propose` capability belongs to one connector, and a card's actions must
name capabilities of the connector that pushed it: `draftProblem` refuses any other draft at the scan
([index.ts](../../packages/connectors/src/index.ts#L289-L301)) and `act` refuses the button again from the stored card
([decisions.ts](../../apps/server/src/threads/usecases/decisions.ts#L15-L32)). D35 items 6 and 7 are explicit: "a card is
one system's; no action spans systems". The one composite that combines sources, the utvecklingssamtal planner, is
hand-written in the calendar module and calls the calendar package directly rather than the registry
([working across connectors](../architecture/working-across-connectors.md#L90-L94)); the handling of a connector's
`propose` whose output is a card is listed as not built in D35. **Breaks.** There is no generic way to lay a proposal
whose rows come from three connectors, and the only precedent is per-flow code, which the product owner has ruled out.

**3. Approval.** `approve` takes one `decisionId`, one `operation`, one `payload`; `source.authorize` resolves it to one
connector ([usecases.ts](../../apps/server/src/modules/executions/usecases.ts#L8),
[model.ts](../../apps/server/src/modules/executions/model.ts)). A thread has one execution slot, and the projection
refuses a second approval while one is pending, running or unknown
([execution-projection.ts](../../apps/server/src/composition/execution-projection.ts#L22)); the card path refuses it a
line earlier ([decisions.ts](../../apps/server/src/threads/usecases/decisions.ts#L29)). **Breaks.** "One confirmation
for three systems" would today be three confirmations on three cards, serialised.

**4. Dispatch.** Once an intent is saved, the path is right: the approval transaction writes the execution, its audit row
and its outbox row together, the outbox delivers only committed ids into Temporal
([dispatch.ts](../../apps/server/src/modules/executions/dispatch.ts)), and `approvedExecution` runs one saved intent
([workflows.ts](../../apps/server/src/temporal/workflows.ts#L28)). **Holds (D45).** Per step, this is exactly what
artboard J wants; it only needs more than one step to exist under one decision.

**5. Receipts.** Each execution settles `succeeded`, `partial`, `failed` or `unknown` with per-row evidence, and the
projection draws the receipt from the read-back ([execution-projection.ts](../../apps/server/src/composition/execution-projection.ts)).
**Holds.** "Klart med ångra" is the ledger's receipt as built.

**6. Unknown outcome.** A lost reply is `unknown`; recovery reads back by the operation key before any replay is
considered, and conditional or absent deduplication cannot authorise one
([usecases.ts](../../apps/server/src/modules/executions/usecases.ts#L53); tests "a lost reply is unknown, then read
back without repeating the effect" and "an expired worker lease with a persisted dispatch never blindly replays an
unsafe write" in [executions.test.ts](../../tests/unit/executions.test.ts#L46-L58)). **Holds.** Artboard J's "okänt,
läses tillbaka, skrivs aldrig om" is this state, drawn.

**7. Watch.** Payroll reads the HR system itself; Clew should read payroll at 12:02, 20:02 and 08:02 and say so at the
end. The status page says it plainly: "General conditional watches are unbuilt" ([status](../reference/status.md#L14)).
The only bounded follow-up is the calendar's obligation policy, two reminders per invitation, two working days apart,
30 days ([followups.ts](../../apps/server/src/modules/calendar/usecases/followups.ts), D47). Even with a watch, the
20:02 read has nobody to read as: delegated tokens exist only in a session, and the protocol comment says they are
"absent in scans, figures, callbacks" ([protocol.ts](../../packages/connectors/src/protocol.ts#L65-L66),
[status](../reference/status.md#L16)). **Breaks twice**: no watch, and no identity for one.

**8. Next proposal.** The 13:00 talk and the substitute question depend on the absence being a fact. Nothing in the
tree lets one receipt become the input of the next proposal; D53 itself lists "a conversation carrying a job across
connectors with a step list (artboard J)" as not built. **Breaks**, though in the right direction: the artboard wants
the next step as a proposal the person approves, not as a chained execution, and the ledger already refuses to chain.

**9. A connector running steps in another system.** `clew.call` throws "En anslutning kan inte utföra åtgärder i en
annan anslutning." for any `execute` ([index.ts](../../packages/connectors/src/index.ts#L246)); the callback route
checks the caller's `uses` and goes through the same handle ([connectors.ts](../../apps/server/src/routes/connectors.ts#L32));
the backend rule states it ([backend structure](../architecture/backend-structure.md#L87-L88)). **Holds, correctly.**
Time reporting must never be told by the HR connector to reopen a shift; the refusal is the right boundary and the
recommendation keeps it.

**10. Undo.** Compensation is a separately approved execution linked to its original, the original receipt stands until
the compensation succeeds, and the undo must match the confirmed action exactly ([D45](../decisions/D45-approved-intent-precedes-source-dispatch.md#L11),
[usecases.ts](../../apps/server/src/modules/executions/usecases.ts#L12-L17)). **Holds per step.** "Ångra allt" on a
three-step job is three such compensations under one decision; nothing today groups them.

**11. Audit.** Every approval writes `execution.approved` in the same transaction as the intent; every settlement writes
`execution.<state>` ([usecases.ts](../../apps/server/src/modules/executions/usecases.ts#L28)). **Holds.** A job adds one
row of its own above these; it does not change them.

**12. Names.** Artboard J reads "Sjukfrånvaro för Hassan i dag". Principle 7 says names of individuals stay in the source
system, never in a card ([vision](../vision.md#L105)); the product owner decided on 2026-11-03 that the canvas wins for
card rows ([HANDOVER](../../HANDOVER.md#L39)), and the HR mock still writes "Namnet visas i personalsystemet, inte här"
on its rehab card ([hr.ts](../../packages/connectors/src/mock/hr.ts#L172)). **Tension**, recorded as F11 in the
2026-11-05 architecture review and not decided here.

## Findings

### G1 · One approval is one operation on one connector

`approve` authorises one `operation` against one source and saves one `Execution` with one `connector`
([usecases.ts](../../apps/server/src/modules/executions/usecases.ts#L8), [model.ts](../../apps/server/src/modules/executions/model.ts)).
The thread projection and the card path both refuse a second approval while one is active
([execution-projection.ts](../../apps/server/src/composition/execution-projection.ts#L22),
[decisions.ts](../../apps/server/src/threads/usecases/decisions.ts#L29)). Artboard J's one confirmation for three systems
has no entry point.

**Change:** a job approval that, in one transaction, writes a job row and one execution row per execute step, each with
its own connector, decision id, write safety and expiry, plus one `execution.approved` row each and one `job.approved`
row. D45 unchanged below that line: Temporal dispatches saved intents, per step.

### G2 · A card is one system's, by rule and by code

D35 items 6 and 7 and `draftProblem` ([index.ts](../../packages/connectors/src/index.ts#L289-L301)) make every card
action a capability of the pushing connector. The rule is right for a pushed card (it stops a connector from putting
another system's execute on its card) and wrong as the only kind of card there is.

**Change:** refine, do not replace. A pushed card stays one system's. A **job card is Clew's**: its rows are steps, each
naming its system and showing its own state; its buttons approve or undo the job. A connector still never executes in
another connector.

### G3 · No watch on a system Clew does not write in

"General conditional watches are unbuilt" ([status](../reference/status.md#L14)). The calendar's follow-up policy is
the only bounded repeated check, and it is specific to invitations
([followups.ts](../../apps/server/src/modules/calendar/usecases/followups.ts)). Payroll reading the HR system is the
normal case for a municipality, not an edge case; without a watch, Clew either writes to payroll itself (wrong) or
says nothing (artboard J says "bevakas").

**Change:** a watch is a step that writes nothing: a read capability, an expectation, absolute check times derived from
a window, and an expiry, committed with the approval and run as timer generations (D47). Each fire reads as the person
and settles `seen`, stays `waiting`, or at expiry `expired` and draws a card.

### G4 · Nothing assembles steps from several connectors without per-flow code

The search composite shows the pattern Clew already trusts: every source in scope, under a budget, merged, the
missing ones named ([search/usecases.ts](../../apps/server/src/modules/search/usecases.ts)). No such composite exists
for proposals. The only multi-source proposal is the hand-written planner, and the product owner has ruled out code per
flow.

**Change:** one core use case, mirror of the search composite: given an actor and a fact, list every bound follower in
scope, call them all under a budget as the actor, merge the step drafts into one job proposal, and report sources. A
follower that did not answer makes the proposal **partial and names the missing system**, never silently fewer steps.

### G5 · A connector's `propose` cannot become a card

D35 lists "the handling of a connector's `propose` whose output is a `ThreadDraft`" as not built; today only the core
`cardFromAnswer` makes a card on demand ([cards.ts](../../apps/server/src/threads/usecases/cards.ts#L237)). Even a
one-system proposal from the box has no path to the stream, so the job proposal has none either.

**Change:** the job proposal is drawn by Clew from the assembled steps, which removes the dependency on this gap for the
job; the single-connector `propose` → card path stays D35's follow-up.

### G6 · No inbound event

D19's CloudEvents ingest is proposed, not built ([status](../reference/status.md#L20)). The sick report reaches Clew by
scan or by the person typing it. **Change:** none for the job itself; the assembler must accept both entries, asked
(the composer picks the creating propose and its fact fans out) and pushed (a scan occurrence or, later, a D19 event
carries an existing fact ref). D19 stays its own row.

### G7 · No background identity for a watch

Delegated tokens come from the session's token exchange and are absent in scans, figures and callbacks
([protocol.ts](../../packages/connectors/src/protocol.ts#L65-L66), [status](../reference/status.md#L16)). A payroll
read at 20:02 as the person has no credential when payroll declares `delegation`. The ledger already handles the
analogous case for executes: `needsSession` leaves a visible blocked execution (D45).

**Change:** a watch that needs a session without a background credential is visibly `blocked` with the reason, exactly
as executions are, never faked and never read with a service account by default. The policy for background delegated
reads remains F10's open decision.

### G8 · The one composite bypasses the registry

The planner calls the calendar package directly rather than through the registry, so neither scope is re-applied at
the composition boundary ([working across connectors](../architecture/working-across-connectors.md#L90-L94)). The
document itself calls routing it through the registry "the target and a small refactor".

**Change:** the job assembler calls followers only through the registry handle, as the actor, so every step draft is
produced under both scopes; the planner's refactor stays a separate follow-up.

### G9 · The mocks have no time-reporting or payroll system, and the HR mock has no absence write

The bundled mocks are the HR system, finance, incidents and communication
([mock/](../../packages/connectors/src/mock/), D52). The HR mock reads absences and writes talks, leave decisions and
delegation renewals ([hr.ts](../../packages/connectors/src/mock/hr.ts#L39-L160)); it has no execute that registers an
absence. Artboard J cannot be demonstrated end to end on the shipped fixtures.

**Change:** the proof runs on a fake registry of four systems in the scenario test; a `tidrapportering` mock and an
absence-registering execute on the HR mock are follow-ups, after the decision lands.

### G10 · Names in cards

Artboard J names the employee in the proposal; principle 7 forbids it ([vision](../vision.md#L105)) and the 2026-11-03
decision allows it in card rows ([HANDOVER](../../HANDOVER.md#L39)). The HR mock's own rehab card sides with the
principle ([hr.ts](../../packages/connectors/src/mock/hr.ts#L172)). **Change:** none here. F11 in the architecture
review already asks for one baseline; the job card should follow whatever that decision says, and the step rows
(which name systems, not people) are unaffected.

### G11 · Contract drift between a follower and the fact it follows has no rule

D37 makes a capability's **name** its contract and classifies manifest changes against the connectors that `use` it
([D37](../decisions/D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md)); the status page
notes no `deprecated` field or semantic classifier exists yet ([status](../reference/status.md#L11)). A follower does
not call the creating connector; it receives a fact *from Clew*. If the HR connector renames or reshapes the absence
fact, nothing today says what happens to time reporting's follow. Silent drift here is the worst case: a job with one
step fewer and nobody told.

**Change:** D37's rule, extended to facts. A fact kind's name is its contract; compatible changes are a new optional
attribute or a looser constraint; anything else is a new kind with the old one `deprecated: { replacedBy, until }`.
Clew classifies every manifest change against the bindings; a binding whose kind is no longer offered, whose
follower's envelope no longer validates, or whose follower is disabled or out of audience becomes `degraded` with the
reason, is named in the disable or narrow confirmation (D37 item 4), and at assembly is reported as a missing system.
A follower's answer is validated against the step-draft schema on every call (D37 item 5).

### G12 · No place where an administrator sees or governs what follows what

The admin use cases diff a refetched manifest into added, removed and changed capabilities
([admin.ts](../../apps/server/src/connectors/usecases/admin.ts#L180-L189)) and D23 governs a connector's state,
audience, scan and single capabilities. Nothing shows that time reporting follows the HR system's absence, or lets an
administrator decide that it should in this installation. If `follows` in a manifest were enough to run, a vendor's
manifest would compose the municipality's process.

**Change:** composition is administered, not coded and not designed. A connector's `follows` is an offer; what runs is a
**binding** saved in Clew's database by an administrator (D23's page, audited, no environment variables, no restart):
fact kind → follower capability, with an audience and, for a watch, the window. Default deny: an offered follow is inert
until bound. A binding is a flat list per fact kind with no conditions, branching or ordering, so it is connector
governance, not the process designer the vision rejects. The chain that emerges from facts on receipts is shown
read-only ("vad följer på vad").

## What must not be built

The vision and the reliability plan draw these lines, and the trace confirms each would be the wrong answer to a gap
above.

- **A saga engine or a second workflow engine.** Temporal already runs saved intents and timers (D17, D45, D47). A job
  is a row and N intents, not a state machine with compensating transitions.
- **A process designer.** No swimlanes, no conditions, no branching, no ordering ([vision](../vision.md#L53),
  [what Clew is not](../vision.md#L76)). A binding is a flat list; the follower decides from the fact whether it has a
  step, and zero is an answer.
- **Cross-step input dependencies.** No step's input depends on another step's output; all are computed from the fact.
  Something that needs another system's *result* is a next job.
- **Operator-defined joins.** Combinations stay code or declarations with both scopes visible
  ([working across connectors](../architecture/working-across-connectors.md#L132-L139)).
- **Clew relaying data between sources.** Payroll reads the HR system itself, or the integration platform carries it;
  Clew watches the result and never becomes the pipe.
- **Automatic chaining of executions.** The substitute question and the 13:00 talk are proposals the person approves
  again; the ledger's refusal to chain stays.
- **An RPA write to a system without an API.** Such a system gets a link-out plus a watch.

## Complexity budget

The recommendation must fit inside this, or it is the engine the vision rejects.

| Element | Budget |
|---|---|
| Envelope | One: `{ fact: { kind, ref?, attributes } }` in, `{ steps: StepDraft[] }` out. No semantic type system; the creating connector owns the attribute schema |
| Step kinds | Two: `execute` of the follower's own connector, or `watch` as a read of the follower's own connector with an expectation and a window |
| Bindings | A flat list per fact kind: kind → follower capability, audience, window. No conditions, no branching, no ordering |
| Steps per job | At most 10 |
| Checks per watch | At most 3 |
| Fan-out depth | One. A follower names only its own connector's capabilities; no transitive fan-out inside one job |
| Protocol | Stays at 2; `facts`, `follows` and `creates` are optional manifest fields in the style of D37's `uses` |
| New modules | One (`jobs`) for assembly and bindings; the job row and watch live in the executions module because a job must commit in the executions transaction and a module never imports another (D20) |
| Routes and UI | None in the proof; the job card, panel step list and admin page follow the decision |

## Recommendation

Record the shape below as the proposed decision on jobs, numbered D54 when it lands (D53 is the start page), and prove
it on the memory and Postgres adapters before any route or screen is built.

**A job is assembled from what connectors declare, approved once, and run as one execution or watch per system.**

1. **Facts and followers in the manifest.** A connector may declare `facts`: the ref kinds it brings about, each with a
   Swedish title and a JSON Schema for the fact's attributes. A `propose` may declare `follows: ['hr:absence']`; its
   input is Clew's envelope and its output is step drafts, zero meaning nothing to do. A draft names only the follower's
   own connector; a propose still never writes. A `propose` or `execute` that creates a fact says so with `creates`, and
   its output carries the attributes so Clew can fan out before the fact exists.
2. **Clew assembles, generically.** One core use case, mirror of the search composite: every bound follower in scope,
   under a budget, as the actor; drafts merged into one job proposal; sources reported; a silent follower makes the
   proposal partial and named. Two entries, same job: asked (the composer picks the creating propose) or pushed (a scan
   occurrence or, later, a D19 event carries an existing fact ref).
3. **One approval, N intents.** The human approves the job once through the decision endpoint, never a tool (D8). The
   transaction writes the job row, one execution per execute step with its own decision id, safety and 24-hour expiry,
   one `execution.approved` each plus `job.approved`, and one outbox row per execution. D45 unchanged.
4. **Steps are independent.** No step's input depends on another's output; dispatch order carries no meaning. A step
   that needs another system's result is a next job: a receipt may carry a fact, whose followers produce the next
   proposal, which the person approves again. "Clew is the order" is the chain of facts and approvals, with no process
   definition.
5. **A watch is a step that writes nothing.** A bounded read policy committed with the approval and run as timer
   generations (D47); each fire reads as the person and settles `seen`, stays `waiting`, or expires and draws a card. A
   system Clew cannot write in gets a link-out plus a watch. A watch that needs a session without a background
   credential is visibly blocked, never faked.
6. **Undo is per step.** "Ångra allt" approves one linked compensation per undoable step in one decision; each is
   judged alone, and a failed or unknown undo keeps that step's receipt (D45).
7. **D35 refined, not replaced.** A pushed card stays one system's. A job card is Clew's: rows are steps, each naming
   its system and showing its own state; its buttons approve or undo the job. A connector never executes in another.
8. **Not Clew's job.** System-to-system propagation stays in the systems or the integration platform; Clew watches the
   result. Derived obligations, the rehab rule among them, come from scans, not from the job.
9. **Composition is administered, not coded and not designed.** `follows` is an offer; a binding saved by an
   administrator under Administration › Anslutna system makes it run, with an audience and a window, audited, default
   deny, flat, read-only chain shown. Personal overrides are a later decision.
10. **Drift is D37's rule, extended to facts.** A fact kind's name is its contract; a breaking change is a new kind
    with the old one deprecated; every manifest change is classified against the bindings; a degraded binding is named
    in confirmations and reported at assembly as a missing system; a follower's answer is validated on every call.
    Bounds: at most 10 steps per job, at most 3 checks per watch, own-connector capabilities only, no transitive
    fan-out.

Follow-ups outside the decision, in order: a time-reporting mock and an absence-registering execute on the HR mock; the
job card and panel step list built to artboard J with their `tests/a11y` specs; the admin page's bindings view with its
degraded reasons and the read-only chain; Temporal timer wiring for watch steps; D19 event ingest; the names-in-cards
baseline (F11).

## Outcome

Review saved; the ledger and assembler proof is being built in a parallel session; nothing in this review changes code
or decisions.
