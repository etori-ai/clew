# D139 · A card with nothing to decide says what holds, and the person can say that the next step is taken

**Status:** provisional (the product owner chose it on 2026-11-20 from the canvas "Clew · clearer actions on a card that nothing is pressed on", five boards rendered from the real components, with "A with B", and the same day added that the rows follow. Built on the branch `assistant-beside-every-page` on 2026-11-20; see "As built". Accepted when a person outside the repository has met such a card, said that they have asked their manager and seen the card end by itself, and a manual screen-reader pass has been made over the item and its rows. The number is taken again from the generated index when the change lands on `main`. It amends item 13 of [D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md)) · **Date:** 2026-11-20 · **Area:** ui, product, integrations

**Context.** The competence check raises a card for a certificate that has run out: "Delegering läkemedel gick ut 8
oktober". Its only action is a read, "Visa mina kompetenser". On its page that read was the one filled button, the badge
by the title said "Försenad", the facts said "Svara senast: försenad" though there is nothing to answer, the card's own
summary was folded away under "Varför ser jag detta?", and nothing said how the card ends: it ends by itself when the
scan stops raising it, and "Inte nu" and "Avfärda" were under ⋯. Asked how such a card is marked completed and told
that it is not, the product owner said: "I think there needs to be clearer actions for the user on a card like this. Use
claude design to explore".

Five boards were drawn on the canvas "Clew · clearer actions on a card that nothing is pressed on"
(https://claude.ai/artifact/HSMDyq1iKUFsuueHur7koW): the page as it was; A, the page says what holds; B, the person says
that the step is taken, before and after the press; and C, Clew asks the manager, a request between people. With the
recommendation of A now and B on top, the product owner chose "A with B". C was drawn and not chosen. Told that Att
göra's row and Hem's row for such an item still said "försenad" and that they ought to follow, he answered: "yes the rows
should follow too".

**Decision.** General, for every source, never per domain.

1. **Which card.** A work item has *nothing to decide* when it is open, offers at least one action and every one is a
   read, holds no proposal, has nothing decided or sent on it (no execution, no receipt), waits on nobody and is not set
   aside (`nothingToDecide`). An item with no action at all is a notice of something that happened and is as before. The
   same item *asks for no answer* wherever it stands, also while it waits, is set aside or is closed (`asksNoAnswer`).
2. **The page says what holds (A).** Such an item has a notice of the kind Behöver dig under its title, with no move:
   the source's `summary`, its first sentence as the notice's title and the rest as its description. It stands over the
   buttons and replaces none of them, and "Varför ser jag detta?" does not say the summary again. This amends D126 item
   13, whose "A plain to-do has no notice: its title and its buttons say what is expected" now continues: a to-do with
   nothing to decide (it offers at least one action and every one is a read) has a notice with no move, which stands
   over its buttons and says the source's summary, its first sentence as the title and the rest as the description; no
   button on it is filled, "Inte nu" and "Avfärda" stand beside its read, the badge by its title says the source's
   reason, and its day is "Sista dag".
3. **The source says how the item ends**, as the last sentence of its summary, since nothing on the card is pressed to
   end it. The competence check's cards do: "Ärendet avslutas av sig självt när ett giltigt intyg är registrerat."
4. **No filled button where there is no decision.** The read is a secondary button, and the two ways out stand beside
   it instead of under ⋯: "Inte nu", the time picker of
   [D49](D49-a-card-has-one-time-action-and-always-says-when-it-is-back.md), and "Avfärda", each with its toast and
   Ångra as before.
5. **Nothing claims a late answer**, on the item or on any row that draws it. Where another item says when its answer
   is due, an item that asks for no answer says the source's `reason` ("Har gått ut", "Saknas"), once, where it is at
   most 32 characters, in the colour its day gives it, or the warning of Behöver dig where it has no day (`reasonMark`):
   the badge by the page's title, the badge at the end of its row on Hem, on a person's page and in an answer, and the
   words in Att göra's Status column. The row's line does not say the reason again; a reason too long for a badge stays
   in the line and under "Varför ser jag detta?". The row's edge on Hem keeps the day's colour, and the lists keep
   their order. The fact that is "Svara senast" elsewhere is "Sista dag" with the plain date, and Att göra's "Försenade"
   does not count the item.
6. **The person can say that the next step is taken (B), where the source offers it.** A draft can carry
   `handOn: { label, waitingOn }`: the button's words in the person's own voice ("Jag har bett min chef") and whom the
   card then waits on ("din chef"). On an item with nothing to decide it is the one filled button, the read stands
   beside it, and "Inte nu" and "Avfärda" are under ⋯ again; on a to-do that has a decision it is a row under ⋯. It is
   the person's own statement about something done outside Clew: Clew records it, nothing is sent to the source, and
   nobody is told.
7. **Said, the item waits.** It leaves Behöver dig for Väntar på andra. Its notice says "Väntar på din chef" (the
   offer's `waitingOn`) and when the person said it, in the words they pressed; "Påminn mig" is the notice's offer, as
   on any item that waits (D49); the read is still a button; the toast after the press has Ångra; and "Det blev inte
   gjort" under ⋯ takes it back.
8. **When it stops standing.** The hand-over stands across scans that raise the same occurrence at the same revision.
   It ends when the person takes it back; when a reminder they set fires, which brings the item back as theirs with
   "Väntade på din chef" in its reason; when the occurrence's revision changes, as a snooze breaks on activity; when a
   draft names whom the card waits on itself, since the source is believed over the person; and when the scan stops
   raising the card, which ends the card as it always did. There is no default reminder and nothing escalates by itself.
9. **Not a tool.** The statement is a thin route to a use case (`POST /api/threads/:id/hand-on` and `hand-back`), with
   the audience and scope checked on the server as for "Inte nu" and the audit row in the same transaction. It is no
   capability and no tool of the assistant's: the model is told the button is there and has nothing that presses it.

**Why.** A card that asks for nothing cannot use the vocabulary of a card that asks for an answer without saying things
that are false: a filled button for a read, a late answer for a day that is not an answer's. The source knows what
holds and how the matter ends, so its summary says it, and Clew gives the summary the place where a button's words would
have been. B is Clew's own and not the competence module's because the same card comes from any source, a remote
connector could only copy it with an execute, which would put a statement that writes nothing to any system through the
decision ledger, and because the nearest thing that exists, "Inte nu", is the same shape: one column, one use case with
its audit row, one route, a toast with Ångra. The source names the offer because only it knows whose step is next.

**As built (2026-11-20), and how it differs from what was drawn.**

- The names are `handOn` on the draft and the thread and `handedOn` for the person's having said so, with the columns
  `hand_on`, `handed_on_to` and `handed_on_at` of migration 0084, and not `handOver` as first written: a thread already
  has `handover`, a conversation's exchange with another system's assistant.
- The person's statement is written to the thread's own `waitingOn`, with `handedOn` beside it, and the refresh keeps
  it: where the occurrence stands at the same revision and the draft names nobody, the card keeps waiting on whom the
  person said. So every list, count and read that already handles an item that waits handles this one unchanged.
- The notice after the press says "Du sa ”Jag har bett min chef” i dag 13:40." and nothing more. The board's "Du bad om
  förnyelse 20 november. Ärendet avslutas när den nya delegeringen är registrerad." would have been Clew's words about a
  source's matter; how the item ends is still in its summary, under "Varför ser jag detta?" while it waits.
- The badge by the title stays the source's reason after the press. The board drew "Väntar på din chef" there, which
  the notice under it says: the state is said once (D126 item 13).
- The facts are the item's own (Sista dag, Källa, Kom). The board's "Intyg", "Förnyas av", "Du bad om förnyelse" and
  "Ärendet avslutas" are fields the protocol does not have; when the person said so is in the notice and in Händelser.
- The competence check offers the statement on the cards whose summary sends the person to their manager: a certificate
  that has run out, one that soon will, a required certificate that is missing, and a skill confirmed below the level
  asked. It does not on a skill the person has not added or rated, whose next step is their own, nor on one that waits
  for the manager's confirmation. The manager's own card about their reports has no offer and its summary does not say
  how it ends.
- The item's bar pinned to a phone's foot (`pinned`) has the layout for these items and no caller.

**Not decided.**

- Whether the board's words "Påminn mig" and "Inte aktuellt" replace D49's "Inte nu" and "Avfärda". D49's are kept.
- The label "Sista dag" for the day of an item that asks for no answer.
- That the manager is told nothing: the statement is the person's own record, and C, a request between people, was
  drawn and not chosen.
- Whether a card that waits for the manager's confirmation of a skill should offer the statement too.

**Evidence.** [The work items' model](../../apps/web/src/work-items.ts) and
[the status mapping](../../apps/web/src/status-of.ts) with their tests
([status](../../apps/web/tests/status-of.test.ts), [rows](../../apps/web/tests/work-row.test.ts));
[the item's buttons](../../apps/web/src/components/work/card.tsx);
[the use cases](../../apps/server/src/threads/usecases/cards.ts), [the refresh](../../apps/server/src/threads/usecases/refresh.ts)
and [the reminder](../../apps/server/src/threads/usecases/reminders.ts) with their scenarios
([threads](../../tests/unit/threads.test.ts), [refresh](../../tests/unit/refresh.test.ts)) and
[the store contract](../../tests/store-contract.ts);
[the draft's field](../../packages/connectors/src/protocol.ts);
[the competence cards](../../apps/server/src/modules/competence/capabilities.ts);
browser scenarios for [the item](../../tests/a11y/item.spec.ts), [Att göra's row](../../tests/a11y/queue.spec.ts) and
[Hem's row](../../tests/a11y/hem.spec.ts). Current state: [the work item](../reference/status/work.md#the-work-item).
