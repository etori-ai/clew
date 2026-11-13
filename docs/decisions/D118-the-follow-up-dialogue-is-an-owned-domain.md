# D118 · The follow-up dialogue is an owned domain: assessments and activities per unit, areas and questions as configuration

**Status:** provisional (Oliver Borgström, 2026-11-13; built on the branch `followup-dialogue`, tested by nothing outside the repository; a new owned domain and a new drawer, built as an exception to the freeze on new surface, D101, at Oliver Borgström's choice; checklist questions 6, 11 and 12 are open) · **Date:** 2026-11-13 · **Area:** product

**Decision.** Big-boss-board's dialogue, the part of Dialogstöd that is not key figures, becomes a domain Clew owns
([D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md)): decision A of the
[plan for absorbing big-boss-board](../reviews/2026-11-12-absorbing-big-boss-board-into-clew.md), with the choices
below. The key figures stay with connectors (decision B of the plan, not taken here).

1. **Its own module, `dialogue`**, in `apps/server/src/modules/dialogue/` with its own tables (`dialogue_area`,
   `dialogue_question`, `dialogue_assessment`, `dialogue_activity`, migration `0054_dialogue`). Not an extension of
   talks: a talk's action point is about a person in a round, the dialogue is about a unit with no round. The plan's
   name `followup` was taken by the calendar's follow-ups (D30). The card and timer port copies the talks one
   (`composition/dialogue-work-items.ts` beside `talk-work-items.ts`, sharing its date helpers) instead of generalising
   it, so talks is untouched.
2. **No round.** The dialogue is continuous per unit; assessments and activities are dated. Big-boss-board's `period`
   was free text nobody read.
3. **Areas, dimensions and questions are configuration**, replaced whole per organisation by an operator from a JSON
   file (`bun scripts/dialogue-areas.ts <file>`, `DialogueConfigSchema`); records stay when the file changes. An area
   is `measured` (it names the read about a unit that answers its figure, such as `qlik.economyUnit`) or `assessed`
   (optionally in dimensions, as Verksamhet's Grunduppdrag and Fullmäktigemål). A question may be written for given
   units and then replaces the area's general questions there, and may name the employee-survey statement it is drawn
   from. `scripts/dialogue-areas.example.json` holds made-up questions; `bun run dev:connectors` loads it when the
   development organisation has none. An organisation's own file belongs outside the repository.
4. **Who follows up which unit is D117's reach**: a manager's own units and the units of the managers who report to
   them, read when asked (`Followed`, filled in `composition/dialogue.ts` from Personal's reach), never stored. Both may
   read and write the unit's dialogue. This is a change from big-boss-board, where everyone saw and changed everything.
5. **An activity has an owner**, the unit's manager when it is added: the reader on their own unit, the reporting
   manager on a unit below. The owner gets it as a card in Att göra about the unit (so it shows under "Behöver dig" on
   the unit's page), and may mark it done even after the unit is no longer one they follow up. The author is recorded.
6. **The due date is optional.** A dated activity's card has a timer of the kind `dialogue-due` that brings it back the
   morning after the due date while the activity is open; an undated card has none and says "En aktivitet utan
   slutdatum" (D49). Changing the date moves the timer; taking it away cancels it.
7. **Assessments are append-only**: unit, area, dimension, state (`ok`, `warn`, `alert`, shown as Bra, Bevaka and Åtgärd
   krävs), an optional comment, author and time. The newest per dimension counts and an area shows the worst of its
   dimensions; only assessed areas take them.
8. **Done, reopened, removed.** An activity is marked done with an optional note, opened again, changed, and removed
   only once done (big-boss-board's rule), behind a confirmation, with an audit row and its card removed with it.
9. **Free text is sealed at rest** (the activity, the note, the comment), under purposes bound to the row, and appears
   in no card title, audit row, log line or trace (D96 item 6). Limits as big-boss-board: 4 000, 1 000 and 2 000
   characters.
10. **Clew's own connector, `dialogue`** (source "Uppföljningsdialog"), bundled and enabled by default, answers two
    reads, neither a model tool: `dialogue.unit` about a unit (open and overdue activities, and the assessed areas that
    need action or watching by name, "Åtgärd krävs: Verksamhet"), which Clew draws as a section on the unit's page, a
    column on Dialogstöd and a line under "Att ta upp" that leads into the drawer; and `dialogue.activities`, the reader's own open activities, which the card opens. The routes under
    `/api/dialogue` refuse while an administrator has switched the module off. No profile lets another system answer;
    the plan's `<id>.followup` waits until a second system exists.
11. **The dialogue is a drawer over the unit's page** (D83, D111 rule 5) at `?dialog=<unitId>`, opened by the section's
    "Öppna dialogen" or a unit's line under "Att ta upp". It reads as an agenda (amended 2026-11-13 after a design
    critique): the areas as tabs, each with its state, opened on the area that needs action, else the one to watch;
    each area in the order of the conversation, where it stands (a measured area's figure from its source, an assessed
    area's state per dimension with who set it and the history), what to talk about, then a new assessment and the
    activities, their forms behind "Ny bedömning" and "Lägg till aktivitet". An area to act on or watch with no open
    activity says so. Every area's panel stays mounted, so text being written survives a change of tab. It is the one
    new page surface of this record.
12. **Erasure and export** use operator scripts. After deactivation, `scripts/dialogue-erase.ts` clears the person's
    identity references and removes owned activity cards and the person's private notes
    ([private notes](D120-a-managers-own-notes-in-the-follow-up-dialogue-are-private-posts-and-files-go-to-the-document-system.md)).
    The unit's assessments and activities keep their free text. Run it as part of [erasing one person](../maintainers/reliability-operations.md#erasing-one-person).
    `scripts/dialogue-export.ts` exports one organisation's dialogue as `clew.dialogue/1`.

**Why.** Oliver Borgström, 2026-11-13: big-boss-board is to be retired once Clew is in production, and the dialogue is
what it has that Clew lacked. The plan's checklist (D95 Part 3) answers questions 1 to 5 and 7 to 10 with yes; the
records are small (two kinds), the work is between Clew's users (every activity is a card for its owner), and nothing
reads them without a person.

**Not established.** Checklist question 6: whether the assessments and activities are public documents, their
retention and archive rules, and what happens to big-boss-board's database. Question 11: the people who run the
dialogue today have not seen this. Question 12: whether the team accepts being the vendor of this domain. Whether
scoping by reporting line suits the municipal director's office, which in big-boss-board sees every organisation.
Migrating big-boss-board's activities and statuses (the plan's phase 4) is not built. Real data waits for question 6.

**Replaces.** Nothing. Amends the [plan](../reviews/2026-11-12-absorbing-big-boss-board-into-clew.md)'s decision A as
listed above (the module's name, the copied card port, no profile yet). Builds on D95, D96 (the card, the timer and
sealing), D97 (reads about a unit), D99 and D117 (the reach).
