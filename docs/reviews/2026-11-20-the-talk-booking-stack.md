# The talk booking stack, reviewed before it lands

Date: 2026-11-20. Asked by the product owner: review the branch that makes a talk's booking Clew's own record, so that
quality and durability are established before it is merged.

Scope: the three stacked changes of [D132](../decisions/D132-when-a-talk-is-booked-is-the-talks-own-record-and-the-calendar-holds-a-copy-of-the-invitation.md),
[D133](../decisions/D133-a-talk-follows-its-meeting-by-the-events-id-and-only-the-manager-changes-it.md) and
[D134](../decisions/D134-a-booked-talk-reminds-its-manager-to-prepare-and-asks-afterwards-whether-it-was-held.md), as one
diff against `main`: the server's source, the web's and the tests. Method: one reading of every changed line by the
session that wrote it, in eight passes (the changed lines, what was removed, callers and callees, reuse,
simplification, wasted work, the depth of each fix, and the project's own rules). It is the author's review: nobody
else has read the change, and no finding was checked by a second reader before it was fixed.

## Findings

| # | Finding | Where | Kind |
|---|---|---|---|
| 1 | Opening a new round left every standing booking in the closed round. The person read as missing in the new one, while the planner still left them out for the invitation it had sent, so they were never planned again and no card was derived for them | `modules/talks/usecases.ts`, `openRound` | Wrong behaviour |
| 2 | The reading back of invitations ran before the planner, inside the calendar source's ten-second scan deadline, looking events up one at a time. Twenty invitations against a slow calendar would time the scan out and the planner would not run | `composition/refresh.ts`, `usecases/invitations.ts` | Wrong behaviour under load |
| 3 | The decision `missed` ended the most recent *past* invitation it found, which could be an older one whose talk was held, and not the one that carries the booking | `usecases/invitations.ts`, `settle` | Wrong behaviour |
| 4 | `ProposalTx` gained the port `invitations` and the proposal store contract had no case for it. The project's rule is that a port change comes with a contract case | `tests/proposal-store-contract.ts` | Rule not followed |
| 5 | The live binding of that port to the talks tables was exercised only on memory adapters: nothing ran the reading back or a settlement over PostgreSQL | `tests/db` | Missing evidence |
| 6 | A card about a person provisioned without a user name had no subject and no action: it said a talk was coming without any way to see whose | `modules/talks/capabilities.ts` | Dead end |
| 7 | The planner's open card still had two phases and an hourly throttle, built to spare a read of the manager's calendar that is no longer made. Someone who joined or left the team reached the card within the hour for no reason | `usecases/samtal.ts`, `settleCard` | A workaround that outlived its cause |
| 8 | The statuses in which a proposal books its invitee were spelled out a second time in the execution's projection | `composition/execution-projection.ts` | Duplication |
| 9 | `book` and `unbook` each repeated the read of the booking before the write and the check that an invitation carries it | `modules/talks/usecases.ts` | Duplication |
| 10 | For a time set by hand whose time had passed, the tab offered "Samtalet blev inte av" and "Ta bort tiden", two buttons for the same write | `components/people/talk-overlay.tsx` | Confusing |

## Outcome

All ten were fixed in the change that carries this review.

1. A new round takes over the talks that are booked for a time still to come and not held: the booking moves with the talk, invitation included, in the transaction that opens the round, and the audit row says how many (`carried`). A scenario test covers a booking by invitation, one whose time has passed and one that was held; the store contract covers `bookedTalks` on both adapters.
2. The scan runs the planner first and starts the reading back without waiting for it, so it is outside the deadline. Events are looked up four at a time.
3. `missed` ends the person's latest invitation and is refused while that one's time has not passed.
4. The contract has a case: what the store is told reaches the port inside the transaction, is kept with the commit and taken back with a rollback. The PostgreSQL harness binds a port that writes on the transaction it is given.
5. Two tests in `tests/db/postgres-calendar-decisions.test.ts` run the reading back and the three settlements over the proposal store bound to the talks tables.
6. Such a card opens the round, where the talk is found by its time. That a person without a user name cannot be a card's subject is a limit of [D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) and stands.
7. The throttle and its two phases are gone: every scan reads the round, the team and the invitations, and what changed reaches the card at the next scan. Three tests that asserted the hour now assert the next scan.
8. The projection uses `BOOKED`.
9. One function reads the booking before a write to it.
10. "Samtalet blev inte av" is offered for an invitation only; a time set by hand is taken off with "Ta bort tiden".

## What this review does not establish

It is not a second pair of eyes. It did not run the change against a real calendar, a real directory or a screen
reader, and those limits are listed under "Not established" in the three decisions. Finding 2 was reasoned from the
code and not measured: no calendar was made slow to show the timeout.
