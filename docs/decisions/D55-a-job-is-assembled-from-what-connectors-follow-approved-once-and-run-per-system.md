# D55 · A job is assembled from what connectors follow, approved once, and run as one execution or watch per system

**Status:** proposed · **Date:** 2026-11-06 · **Area:** integrations

**Decision.** One event in a person's work (an employee's sick report) often means work in several systems at once:
an entry in the HR system, a changed shift in time reporting, payroll picking it up, a talk that may need moving.
Clew carries that as a **job**: one proposal with one step per system, approved once, and run as one execution or
one watch per system through the ledger (D45, D47). Clew writes no code per flow. The steps come from what the
connectors declare and from what an administrator has bound, assembled the way the search composite assembles its
sources (D26). Design: `docs/architecture/working-across-connectors.md`; evidence:
[the cross-system stress test](../reviews/2026-11-06-cross-system-work-stress-test.md) and canvas
**Clew startsida · dagen i ett svep**, artboard J ("Arbete över tre anslutningar").

1. **Facts and followers in the manifest.** Three optional fields, in the style of D37's `uses`, so the protocol
   stays at 2:
   - A connector may declare `facts`: the ref kinds it brings about, each with a Swedish title and a JSON Schema for
     the fact's attributes (`hr:absence`: a person ref, from, to, extent). The kind's name is its contract, by D37's
     rule: a breaking change is a new kind.
   - A `propose` capability may declare `follows: ['hr:absence']`. Its input is Clew's envelope
     `{ fact: { kind, ref?, attributes } }` and its output `{ steps: StepDraft[] }`; zero steps means nothing to do.
     A `StepDraft` is either `{ kind: 'execute', operation, payload, title, detail }`, naming an execute **of the
     follower's own connector**, or `{ kind: 'watch', operation, expect, within, title, detail }`, naming a read of
     its own connector. A follower never names another connector's capability, and a propose still never writes.
   - A `propose` or `execute` that brings a fact about says so with `creates: 'hr:absence'`, and its output carries the
     fact's attributes, so Clew can fan out before the fact exists in the source.
2. **Clew assembles, generically.** One core use case, built like `clew.search` (`apps/server/src/modules/search/`):
   given an actor and a fact, list every bound follower in the actor's scope, call them all at the same time under a
   budget as the actor, merge the step drafts into one **job proposal**, and name the sources. A follower that did not
   answer makes the proposal **partial and says which system is missing**, never silently fewer steps. Two entries lead
   to the same job: asked (the composer picks the creating propose, and its fact fans out) and pushed (a scan
   occurrence, or later a D19 event, carries an existing fact ref, and Clew fans out with `ref` set).
3. **One approval, N intents.** The person approves the job once, through the human decision endpoint and never a
   tool (D8). The approval transaction writes the job row, one execution row per execute step (its own connector,
   its own `decisionId` of the form `<jobDecision>:<step>`, its own write safety, its own 24 h expiry), one
   `execution.approved` audit row each plus one `job.approved`, and one outbox row per execution. D45 is unchanged:
   Temporal dispatches only saved intents, one step at a time.
4. **Steps are independent.** No step's input depends on another step's output; every step is computed from the
   fact. Dispatch order carries no meaning. Something that needs another system's *result* is a **next job**: a
   receipt may carry a fact (`timesheet:unstaffed-shift`), whose followers (the substitute pool, the calendar) produce
   the next *proposal*, which the person approves again. "Clew is the order" (`docs/vision.md`) is then the chain of
   facts and approvals, with no process definition anywhere.
5. **A watch is a step that writes nothing.** A bounded read policy committed with the approval (the read capability,
   the expectation, absolute times derived from `within`, an expiry), run as timer generations (D47). Each fire reads
   as the person and settles `seen`, stays `waiting`, or at expiry becomes `expired` and draws a card
   ("Lönesystemet har inte läst sjukanmälan"). A system Clew cannot write in (the HR system has no write API today)
   gets a link out plus a watch, never a robotic write by default. A watch that needs a session (`delegation` without
   a background credential) is visibly blocked, as an execution is (D45), never faked.
6. **Undo is per step.** "Ångra allt" approves one linked compensation per undoable step in one decision. Each is
   judged alone, and a failed or unknown undo keeps that step's receipt (D45).
7. **D35 refined, not replaced.** A pushed card stays one system's. A **job card is Clew's**: its rows are the steps,
   each naming its system and showing its own state, and its buttons approve or undo the job. A connector still never
   executes in another connector.
8. **Not Clew's job.** Propagation between systems (payroll reading the HR system) stays in the systems or in the
   integration platform; Clew watches the result. Derived obligations (the rehabilitation rule) come from scans, not
   from the job.
9. **Composition is administered, not coded and not designed.** A connector's `follows` is an *offer*. What runs in an
   installation is a **binding** saved in Clew's database by an administrator (D23: Administration › Anslutna system,
   no environment variables, no restart, audited): fact kind, follower capability, audience and, for a watch, the
   `within` window. Default deny: an offered follow is inert until bound. A binding is a flat list per fact kind with
   no conditions, branching or ordering (the follower decides from the fact whether it has a step, and zero is an
   answer), so it is connector governance, not the process designer the vision rejects. Chains emerge from facts on
   receipts (item 4) and are shown read-only on the admin page ("vad följer på vad"). Personal overrides ("fråga inte
   om vikarie") are a later decision.
10. **Drift is D37's rule, extended to facts.** A fact kind's name is its contract: a new optional attribute or a looser
    constraint is compatible; anything else is a new kind, with the old one marked `deprecated: { replacedBy, until }`.
    Clew classifies every manifest change against the bindings (D37 item 3): a binding whose kind is no longer offered,
    whose follower's envelope no longer validates, or whose follower is disabled or out of audience becomes `degraded`
    with the reason, is named in the disable and narrow confirmations (D37 item 4), and at assembly is reported in the
    job proposal as a missing system (the composite rule: partial, named), never as silently fewer steps. A follower's
    output is validated against the step-draft schema on every call (D37 item 5). Bounds: at most 10 steps per job,
    at most 3 checks per watch, a follower names only its own connector's capabilities, and no transitive fan-out
    inside one job.

**Why.** The product owner asked how Clew handles one event that means work in several systems, with two constraints
(2026-11-05): the scenario is artboard J extended (the rehabilitation rule is the scan the HR mock already runs, and
the 13:00 talk in the calendar is a dependent next proposal), and connectors are standalone, so Clew writes no code
per flow and must assemble the flow from what connectors declare. The stress test traced the scenario against the
code and found that the ledger holds for one system at a time and nothing holds across them: `approve` takes one
operation on one connector and a thread refuses a second approval while one is active; D35 items 6 and 7 forbid a card
that spans systems; the only bounded follow-up is the calendar obligation, so there is no watch on a system Clew does
not write in; the one composite is hand-written and bypasses the registry; and nothing assembles steps from what
connectors declare. The job answers all of these with one envelope, one assembler and the ledger as it is.

Weighed and left:

- **A saga engine or a second workflow engine.** Temporal already runs the durable timers (D17) and must not become
  a business authority (D47). A job has no cross-step state to coordinate: every step is computed from the fact, so
  the ledger's per-execution guarantees are the whole story, and the order of dispatch is meaningless.
- **A process definition or DSL.** The vision rejects a process designer and swimlanes. A binding has no conditions,
  no branching and no ordering, which is what keeps it governance rather than a process. The follower decides, from
  the fact alone, whether it has a step.
- **Clew relaying data between sources.** Payroll reads the HR system itself today, and the integration platform is
  the municipality's chosen place for propagation. Clew watches that the result shows up and says so when it does
  not; it never copies a record one system owns into another (vision, "never copies a record").
- **Automatic chaining of executions.** A receipt that carries a fact produces the next proposal, never the next
  execution. The person approves every job, so a chain is as long as the person's approvals.
- **A semantic type system for facts.** One envelope, the creator owns the attribute schema, and a follower reads
  the attributes it knows. There is no shared ontology to maintain and no mapping layer between kinds; a kind that
  must change is a new kind, which is D37's rule applied once more.
- **Composition in code or in configuration files.** Each would mean a change per flow and a restart. A binding in
  the database, audited and default deny, is what D23 already does for the connectors themselves, and the drift
  question (what happens to a binding when a connector changes) is answered by D37's classification, extended to
  fact kinds, instead of by a new mechanism.

Proven on 2026-11-06, before any route or screen: `tests/unit/job-executions.test.ts` (twenty cases on the memory adapters:
assembly, disabled and degraded bindings, off-contract and silent followers, one approval over three systems, a lost reply
read back on one step with the other untouched, revocation, the watch's committed checks and expiry, undo-all with an
uncertain compensation, and rollback) and the store contract on the memory and Postgres adapters. Implementation status
and limits: `docs/reference/status.md`, row "Jobs across systems".

**Replaces.** Refines [D35](D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md) items 6 and 7: a
pushed card is still one system's and no connector executes in another, and a job card, which is Clew's, is the one
card whose rows name several systems. Extends
[D37 · Connectors declare the capabilities they use](D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md)
with `facts`, `follows` and `creates` on the manifest and with bindings as dependents in its classification.
Extends [D23](D23-connectors-are-managed-in-the-database.md) with the binding as a governed row on the same admin
page. Extends [D45 · Approved intent precedes source dispatch](D45-approved-intent-precedes-source-dispatch.md) and
[D47](D47-occurrences-timers-and-attention-have-durable-identities.md) with the job row, the per-step execution
identity and the watch as a bounded timer policy. [D19](D19-change-notification-is-a-clew-owned-contract.md) stays
proposed and unchanged: the pushed entry to a job uses a scan occurrence until an event ingest exists. D8, D20, D26
and D52 stand.
