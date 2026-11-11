# D99 · An unresolved job step reaches a person and is finished forward; no connector is asked for rollback

**Status:** proposed (written up at the product owner's request, 2026-11-10), nothing built · **Date:** 2026-11-10 · **Area:** integrations, product

**Decision.** A job across systems ([D55](D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md))
has no transaction across its sources and gets none. When one step of an approved job does not end confirmed, Clew
does not undo the others. It puts the open step in front of a named person and gives that person a way to finish it.
A connector is asked for a read, never for a compensation; undo stays optional (D55 item 6).

The promise this makes for the running example (a sick report that must always inform the manager, mark the shift in
time reporting and reach a third system): every report ends with each system either confirmed or in front of a
person. It is not all or nothing.

1. **A card for every unresolved step.** When an execute step settles `failed`, `unknown` or `partial`, or a watch
   settles `blocked`, the settlement transaction pushes one card for the person who approved the job, through the
   stream's attention admission (D47), as an expired watch already does
   (`apps/server/src/modules/executions/usecases.ts`, `watchExpiredCard`). The card names the system and the step,
   says which outcome it is in the person's words, and carries the step's next action from items 5 and 6. One card
   per step, fenced like the watch's, with its audit row in the same transaction.
2. **A binding can be required.** An administrator may mark a binding as required for its fact kind (D55 item 9,
   D23). A job proposal in which a required follower is missing, timed out, degraded or disabled cannot be approved;
   the proposal says which system is missing, as it does today. Other bindings keep today's rule: partial, named,
   approvable.
3. **Followers check before they offer.** A follower validates at propose time what it can validate without
   writing: the actor's access, that the record exists, the revision it would write against. A step it knows will be
   refused is answered as a named problem in the proposal, never as a step.
4. **A write step needs a way to be read back.** A follower's `execute` is bindable in a job only when its
   capability declares `deduplicated` or `conditional` execution with a `lookup` read
   ([actions and receipts](../guides/actions-and-receipts.md)), or when the follower pairs the execute with a watch
   on a read of its own connector. A `manual` execute with neither is refused at binding with the reason. The
   lookup resolves an `unknown` outcome without sending the write again; the paired watch confirms the write by
   evidence, and an unconfirmed one ends as the expired watch's card.
5. **Retry is for the failed step only.** A `failed` step, or the rejected rows of a `partial` one, can be approved
   again from its card as a new execution, by the pattern of
   [D80](D80-recover-rejected-rows-without-replaying-confirmed-writes.md): the original receipt and every confirmed
   write stay as they are. An `unknown` step is reconciled first and is never resent on a person's click.
6. **Manual completion is a fallback.** The card of a step that cannot be retried links out to the source. Where
   the source can be read, a watch confirms that the person did it there; where it cannot, the card records the
   person's own confirmation as that, distinct from source evidence.
7. **A reconciliation scan is the safety net.** The system that must hold the result declares a scan that finds the
   state the job should have produced and did not (an absence in the HR system with the shift not marked). It draws
   a card whatever any job did, so it also covers reports made outside Clew and steps lost for a reason nobody
   foresaw. This is D55 item 8's rule (derived obligations come from scans) applied to the job's own outcome.
8. **Where it shows.** The cards of items 1 and 7 are ordinary cards. When they carry a typed subject
   ([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) items 5, 6 and 8) they appear under
   "Behöver dig" on the opened person and count in the list's "Just nu". This record defines no person reference
   and no place of its own.

**Not in this decision.**

- **No ordering of steps.** Running the "safe" step first is a process definition, which D55 rejects.
- **No automatic retry of a write.** Without source-side deduplication it risks a second entry.
- **No approval-free execution.** A write that must happen with no person approving stays in the source systems or
  the integration platform (D55 item 8); Clew's part is the watch and the card. A standing approval would be its own
  decision.
- **A row mark is not evidence.** A read about a person (D97 item 7) is live, budgeted and never stored, and a
  missing row stands for both "none" and "not allowed". A mark such as "skiftet är inte markerat" may show the
  state, but only the card and the ledger record that a step is open.

**Open.**

- Who gets the card when the person who approved is no longer on the unit: the current manager of the unit, by the
  rule D97 item 8 calls "who may be asked about", is the proposal.
- The person key that a fact carries in the ledger. D97 leaves `externalId` against `userName` open; execution rows
  and receipts outlive a rename, so a retry or a reconciliation keyed on a renamed `userName` would miss the person.
  That argues for `externalId` in stored facts, whatever the wire uses for a live read.
- Whether item 4 applies to the fixture connectors at once or after a period in which an unpaired `manual` execute
  only warns.
- Cancelling a running watch, which a retry that succeeds early would want (D55 has no cancel).

**Why.** The product owner asked, 2026-11-10, how three actions can be made to happen for every sick report, what
happens when one fails, and what can be done about it, adding that "requiring rollback support for each connector
will probably not happen". Read against the code that day:

- An execute step ends `succeeded`, `partial`, `failed` or `unknown` (`outcome` in
  `apps/server/src/modules/executions/domain.ts`), each on its own; the other steps keep their results.
- Only an expired watch reaches the person. `pushCard` is called in one place in the executions use cases, for
  `state === 'expired'`. A failed or unknown execute step of a job is visible through `GET /api/jobs/:id` and the
  audit rows and nowhere a person looks.
- The job card with its step list is planned, not built (D55; `docs/reference/status.md`, "Jobs across systems").
- Retry of rejected rows exists for a single system's card (D80) and not for a job step.
- A proposal with a missing follower can be approved, and a follower that recovers later adds nothing to that
  approval, which is right, but nothing lets an administrator say that a system must take part.

Alternatives weighed. **Compensation required of every connector:** the owner ruled it out, and it would not give
atomicity anyway, since an undo can fail or stay unknown like any write (D45). **A saga engine:** D55 weighed and
left it; a job has no cross-step state. **Automatic retries:** unsafe without the source's deduplication, and the
sources that have it are the ones a lookup already covers. **Leaving it to the job card:** a step list shows the
state to someone who opens the job, while the failure has to find the person.

**Replaces.** Nothing. When built it extends
[D55](D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md) items 5, 6 and 9 (the
card for more outcomes than an expired watch, retry beside undo, a required flag and a recovery rule on a binding),
applies [D80](D80-recover-rejected-rows-without-replaying-confirmed-writes.md) to job steps, and leans on
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) for the place and the person key.
[D45](D45-approved-intent-precedes-source-dispatch.md), [D47](D47-occurrences-timers-and-attention-have-durable-identities.md)
and [D77](D77-job-approvals-preserve-intent-bindings-and-receipt-authority.md) stand.
