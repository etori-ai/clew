# D96 · Talks is Clew's first owned domain: the round and action points, behind a profile a connector can answer

**Status:** accepted, built 2026-11-10 (the round, action points, the profile and its fixture; see "As built"); synthetic data only until questions 6 and 11 below are answered; item 1 amended by [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) (2026-11-10): a person is due a talk with the manager they report to in the organisation tree; item 7 amended by [D111](D111-where-something-opens-is-decided-by-what-it-is.md) (2026-11-11, provisional, rule 5): the talk lies over the page it was opened on; items 2 and 4 and As built item 4 amended 2026-11-12 in the fixes of the review of users and the organisation (Q12): a person has one talk a round however many current managers they have, a booking any of them made through Clew counts as booked for all of them, any of them marks, moves or undoes the held mark, and a manager ticks off only their own action points and a manager's point whose owner no longer manages the person; question 6 of the checklist amended the same day (M2): every current manager reads the record, and a former manager reads nothing about the person but the action points they own, which stay on their Hem until done; item 8 amended by [D116](D116-clew-keys-its-own-records-about-a-person-by-the-persons-id.md) (2026-11-12, provisional): rows stay keyed on the user name on the wire, a user name can be renamed and reused, and Clew keys its own records about a person by the person's id · **Date:** 2026-11-10 · **Area:** product, integrations

**Amended 2026-11-12.** The product owner asked on 2026-11-12 for every finding of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)
to be fixed and every open decision to be taken. Q12 of that review settled how talks work for a person with two
current managers (M1, M2), and Q11 the key of item 8 (N2). The items below stay as written; where they differ from
this paragraph, this paragraph holds.

- **One talk per person per round (items 1 and 2).** The record stays one per person per round, keyed on the
  employee. A person with two current managers, such as co-managers of one unit
  ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)), has one talk a
  round, whichever of them books it. A proposal another current manager made through Clew counts as booked for every
  current manager, without its time, when it is confirmed, final or accepted, starts on a day of the round's period
  and its owner still has the person in their team. The row then shows "Bokat" and no time, no planner draws the
  person, and the nightly "N samtal saknar tid" leaves them out. A booking whose manager has left the person, or is
  gone from the directory, books nothing for anyone else.
- **Where the rule holds.** The rule is one function, `bookedElsewhere` in
  `apps/server/src/modules/calendar/usecases/booked.ts`. The round's rows, the planner, the nightly count, the open
  card, the confirmation and the dispatch all ask it. Confirming a proposal is refused, after the person's name, with
  "har redan ett utvecklingssamtal bokat med en annan chef.", or with "har redan haft sitt utvecklingssamtal i den här
  omgången." when the round records the talk as held. Dispatch skips the invitation and leaves the card open, also
  when it cannot tell whether the person is booked. The nightly scan takes such people off an open card as unplaced
  rows, "bokad av en annan chef" or "har redan haft sitt samtal", with the audit row `proposals.settled_elsewhere`.
  On PostgreSQL the approval projection adds a check of its own, which does not ask the rule
  (`apps/server/src/composition/execution-projection.ts`). Under a lock per invitee, it refuses a confirmation while
  another manager's approved invitation to the same person may be on its way: a proposal of that manager's that is
  still `proposed`, with an execution that is pending, running or unknown. Its refusal, after the person's name, is
  "bjuds redan in till ett utvecklingssamtal av en annan chef.".
- **The held mark (item 2).** Any current manager of the person marks the talk held, moves its day or undoes it, as
  the code did before. The audit rows `talks.held` and `talks.held_undone` name who acted. This is how a co-manager
  corrects a wrong mark.
- **Action points (item 4).** The owner marks their own done or open again. A current manager of the employee may
  also take over a manager's point whose owner no longer manages the employee or was erased. A co-manager's points
  and the employee's own stay with their owners: the use case refuses them with 403 "Du kan inte ändra den här
  åtgärdspunkten.". As built item 4's "the use case would also let the current manager tick off the employee's" is
  no longer true. The audit rows `talks.commitment_done` and `talks.commitment_reopened` say in `details.by` whether
  the owner or a manager acted. A row of `clew.commitments` carries its id only when the reader may change it, and
  the talk's drawer offers "Klar" and "Öppna igen" on a point the reader may take over, labelled "Tidigare chef".
- **A former manager (question 6, M2).** When Clew's own module answers, a former manager keeps the action points
  they own about the person on their Hem until they are done. They read nothing else about the person. Every current
  manager reads the record. Question 6's "Built so far" therefore reads: the record is keyed on the employee, every
  current manager of the employee reads it, a former manager reads nothing about the person but the action points
  they own, HR reads nothing, the text is sealed, erasure and export exist. The question itself stays open.
- **The key (item 8, N2).** On the wire, rows stay keyed on the SCIM `userName`, since that is what a source knows.
  A user name can be renamed and given to a newcomer, so a source answers for the name's current holder and moves
  its records off a leaver when the name moves. Clew compares a row's key with its people's user names NFC-normalised
  and without regard to case, and a key that two people share after that names neither, so its rows are dropped.
  Clew keys its own records about a person, such as cards and started actions, by the person's id, which a rename
  does not change and nobody reuses ([D116](D116-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)).
  The actor and the signed assertion carry the person's `userName` when they have one
  ([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md), As built, item 8, since 2026-11-10), so
  a system behind a connector knows who is calling by the key its rows use and needs no operator's map from Clew's
  id. The sentence on this under "Not established" no longer holds.

**Why these choices.** Q12 was taken in the work, as the product owner asked, and no HR practitioner has seen it
(question 11 is still open).

- *One talk, not one per manager.* The record is already one per person per round. A talk per manager would need
  another model and would hold the same conversation twice with the same person.
- *A booking counts without its time.* A manager may not read another manager's calendar. Counting the booking
  without its time keeps a second planner from proposing a second talk and shows nobody the other manager's day.
- *The held mark stays open to every current manager.* It is one fact about the person, and a co-manager must be
  able to correct a wrong mark. The audit row says who changed it.
- *Ticking off narrowed to the owner, widened to a takeover.* Item 4 and the page say the owner ticks off their own;
  letting any current manager do it closed another manager's card and cancelled that manager's reminder. Without the
  takeover, a point would stay open for good when its owner stops managing the person. A reorganisation moves many
  people to new managers at once, and the new manager must be able to close what the old one left.
- *A former manager keeps their own points.* What a manager promised is still theirs to do after the person moves,
  and only their own Hem offers "Klar" for it.

**Decision.** Utvecklingssamtal becomes the first domain Clew owns under
[D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md): a module
`apps/server/src/modules/talks/` with its own tables. This decision covers the round and the action points. The
record of the talk itself (preparation, notes, approval) is not decided here.

1. **The round.** A period in which every person on a unit is due a talk with the unit's manager, with a date it
   opens and a date it is due. One open round per organisation; opening a new one closes the last. An operator opens
   it with a script, and the development seed opens one; there is no page for it until HR has a view. Who is in a
   round is computed from the assignments (D68) when it is read, so nothing is keyed on the manager.
2. **Held and booked.** Per person the state is missing, booked or held. Held is Clew's own record: the manager marks
   it, it is audited and it can be undone. Booked is not stored: it is read from the calendar when the round is read,
   and when the calendar does not answer the page says so.
3. **The planner reads the round.** The calendar module keeps booking and nothing else. Its topic text, its deadline
   and the people it plans for come from the round and the assignments, through ports filled in composition, not
   from constants and the calendar's persona fixture. No open round means nothing is planned. A handled planning
   thread no longer blocks the next round.
4. **Action points** (Swedish in the product: **åtgärdspunkter**; in code the building block's name, `commitment`).
   A short line, an owner who is the employee or the manager, a date it is due, and done or open. Both see them. The
   manager adds them, for either owner, in the person's talk on Personal; the owner marks their own done. Open ones
   from earlier rounds are listed first in the next talk with the same person; they are not copied.
5. **An action point is a work item.** In the same transaction as the action point, its owner gets a card in their
   stream with the due date, and a timer of its own kind, `due`, that brings the card back the morning after the
   date if it is still open. Marking it done closes the card and cancels the timer in the same transaction.
6. **The card carries no text.** The action point's text is free text about a person. It is sealed at rest as
   approved execution input is, it is in no audit row, log line or trace, and it is not in the card's title, summary
   or message, because those are what the assistant reads. The card says that an action point is due and when, and
   opens the list. No read of this domain is a model tool. The domain works with the model off (D8).
7. **Where a person reads and writes.** A manager: a status column on Personal (`/staff`, D94) and one person's talk
   as a drawer over that list at `/staff?talk=<personId>` (D83: the list stays the parent; a sheet on a phone). Anyone
   with open action points: a section **Mina åtgärdspunkter** on Hem after the day's work, as Mina ärenden is (D90).
   The figure "Utvecklingssamtal hållna" moves from the calendar's area to an area of this domain.
8. **The seam.** Two reserved profile reads, as `<id>.search` and `<id>.errands` are reserved: `<id>.talks` (the
   round and one row per person) and `<id>.commitments` (action points). Their shapes are in `@clew/contracts` and in
   the published protocol's `$defs`. Rows are keyed on the SCIM `userName`, since another system cannot know Clew's
   ids. The pages read two composites of Clew's core connector, `clew.talks` and `clew.commitments`, which ask the
   one source, check its answer against the shape, map each row to a person on the reader's own units and say
   whether writing is possible.
9. **One answerer per installation.** The built-in connector (id `talks`, kind `core`, bundled, so an administrator
   can switch it off on Anslutna system) answers while it is enabled and visible to the person. Otherwise exactly one
   connector declaring the profile answers, the pages are read-only, and a row opens that system by its link. Several
   such connectors with the built-in off means none answers, and the registry reports it. `connectors/appraisals` is
   the fixture that proves the profile.
10. **Erasure and export** are use cases with scenario tests from this slice, reached by operator scripts: erasing
    one person removes their talks and action points and their cards, and removes them from other people's records;
    the export is one versioned JSON document (`clew.talks/1`).
11. **`core` is not split.** `ConnectorKind` keeps its three values; the obligations of D95 item 7 are met by this
    module, not signalled by a kind. No fact is declared yet, since nothing creates or follows one; `talks:held` is
    the first to add when a follower is real.

**The checklist's Part 3, as it stands.** [Core or connector](../maintainers/core-or-connector.md):

| Question | Answer |
|---|---|
| 1. It removes something | The talk feature of an HR system (the reference is the medarbetarsamtal feature of a commercial HR system) or the mail and document template used instead. What Sundsvall uses today is unconfirmed |
| 2. The same everywhere | Yes. What differs is a period and a due date, which are data |
| 3. Work between people who use Clew | Yes. Every action point is a work item in its owner's stream |
| 4. Small | Yes. The round is D30's obligation with its constants made data; an action point is a thread with a timer; one new timer kind |
| 5. Works with the model off | Yes. No read is a model tool and no text reaches a model |
| 6. Clew can carry it | **Open.** Retention, public-document status, secrecy and archive rules are not answered. Built so far: the record is keyed on the employee, the current manager of the employee's unit reads it and a former manager does not, HR reads nothing, the text is sealed, erasure and export exist |
| 7. Everything that reads it today still can | Nothing depends on it, checked against this repository only (the calendar's figure, the planner, the assistant's fixed reply), not against a pilot organisation |
| 8. A way in and a way out | Starting empty is accepted: a round starts with its period. Out: the export |
| 9. Behind capabilities | Yes, item 8 |
| 10. An installation can choose | Yes, item 9 |
| 11. Reviewed by someone who knows the domain | **Open.** No HR practitioner has seen it |
| 12. The team accepts being its vendor | The product owner asked for it to be built on 2026-11-10. Support beyond the lab phase is not established |

D95 item 3 requires the answers to question 6 before real data is entered. Until questions 6 and 11 are answered
this domain runs on the development stack's synthetic directory and nowhere else.

**Why.** D95 named medarbetarsamtal first, and Part 4 of the checklist orders it first on three of four counts:
booking, reminders and follow-up are built and Personal is where it sits; it serves every manager and every
employee; and it builds the two blocks the other candidates need (the round for the annual plan, the commitment for
onboarding's checklist). It loses on the weight of its record, which is why this decision takes the round and the
action points and leaves the notes. The reference product's pages for the three candidates were read on 2026-11-10:
its onboarding runs on employment dates Clew does not hold, reaches a person with no account before the first day
and needs form steps; its annual plan starts talk rounds and so comes after them. From the reference product's talks
feature this takes the status per period, action points with an owner and a date that carry over, and the record
belonging to the employee; it leaves the template editor, the pay talk (the pay hard stop) and the employee file.

Alternatives weighed. Storing booked in this module: rejected, every confirm, decline and move in the calendar would
have to write here, and it would copy a record the calendar owns. The action point's text on the card: rejected by
D95 item 7 and principle 7. A card action for Klar: a card action is an execution in the ledger, and D95 keeps a
write that stays in Clew out of it, so the person ticks it off in the section on Hem. A tool page for one's own
action points: rejected for a section on Hem, which needs no rail entry for every employee. A manager opening the
round for their own unit: rejected, HR sets the period and per-unit rounds would have to be undone later. The
profile later, when a second system is real (the review's first advice): withdrawn by D95; the fixture is the second
implementation.

**As built, 2026-11-10.** Where the code settled something the items above left open, or differs from them:

- Item 1: `bun scripts/talk-round.ts` opens a round; `bun run dev:connectors` opens the development round when none
  is open. The round's organisation is the directory's (`poc` on the development stack).
- Item 4: read without a person, an action point list holds the ones the reader owns and the ones about the reader,
  so an employee also sees what their manager took on. On Personal a manager ticks off only their own; the use case
  would also let the current manager tick off the employee's, which no page offers.
- Item 5: the timer is due at 06:00 Swedish time the morning after the date. It carries no check on the owner's
  authorisation version, so the card stays with its owner when they change unit.
- Item 6: the declared views of `talks.talks` and `talks.commitments` name no row ref, so a row cannot be added to a
  conversation.
- Item 7: the calendar's planning area is retitled **Boka utvecklingssamtal**, since this domain's area is
  **Utvecklingssamtal**. The talk on Personal opens only for a person with a row in the open round. The section on
  Hem is not reserved while it loads (unlike D76's sections), since most people have none.
- Item 8: a person provisioned without a user name is keyed on their id. `<id>.talks` may be limited to managers;
  `<id>.commitments` is for everyone.
- Item 9: the answering system is chosen from either read, so an employee has one although the round is a manager's
  read. Clew's own writes go through `/api/talks`, which refuses unless the built-in module answers for the person.
  While the built-in connector is switched off its cards are hidden (a card is shown only while its connector is
  visible to the person); they return when it is switched on, and their timers fire unseen in between.
- The planner's round is read through `clew.talks`, so it follows whichever system answers.

**Not established.** The answers to questions 6 and 11. What a pilot organisation uses today. An assignment has no
period or history and there is no acting manager, so "the current manager reads it" is as far as access goes. There
is no way in the calendar to book one person from their row. The employee cannot add an action point. Competences
and certificates are not part of this domain: they are read from the system that holds them, beside the talk, when
that is built. A system behind a connector is told who is calling by Clew's person id, not by the user name its rows
are keyed on, so it needs an operator's map from one to the other; putting the user name in the connector assertion
is a protocol change (D44) not made here. The planner's round read shares the composite's four-second budget with a
calendar read. The browser tells "no talks system" from "the system failed" by the refusal's sentence, since the
capability route gives a refusal no code. No screen-reader pass has been made on Personal's talk or the section on
Hem.

**Replaces.** The constants `DEADLINE` and the fixture team in `apps/server/src/modules/calendar/usecases/samtal.ts`
and the calendar area's figure. The line in UC-KIM-8 (`docs/personas.md`) that said no conversation
notes are stored, rewritten with this decision. Refines
[D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md) item 3: a click into a person now
opens their talk.

**Amended 2026-11-11 (D111 rule 5): the talk lies over the page it was opened on.** Item 7's drawer over Personal at
`/staff?talk=<personId>` was reached from the person's page too, and from there "Öppna samtalet" left the person's
page for Personal, and from a section drawn beside Personal it dropped the lens. Under
[D111](D111-where-something-opens-is-decided-by-what-it-is.md) rule 5 the talk is a focused overlay over whichever
page its way in is drawn on: the row's menu on Personal, the talks section on the person's page. Its address is that
page's own with `talk=<personId>` added and everything else kept (`/staff?show=<lens>&talk=<personId>`,
`/people/<key>?section=<capability>&from=%2Fstaff&talk=<personId>`); closing it (✕, Esc, the way back) is the same
address without `talk`, and a cold `/staff?talk=<personId>` is still Personal with the talk over it. The way in says so
itself: `talks.person`'s `about.page.href` is the query `?talk={id}`, which the contract now allows beside a path (a
query alone lies over the page it is drawn on, a path is a page of its own), and the web fills every source's way in
with one function (`sourcePageHref` in `apps/web/src/talk-address.ts`). The drawer is mounted by Personal, the person's
page and the unit's page, managers only, and reads nothing until an address names a talk. A talk write also re-reads
what Clew says about people and units, so the lens, the column and "Just nu" on Personal and the talks section on the
person's page follow it. Evidence: `tests/unit/talks.test.ts`, `apps/web/tests/talk-address.test.ts`,
`tests/a11y/talk.spec.ts` (over Personal with its lens, over a person's page with its section and way back).
