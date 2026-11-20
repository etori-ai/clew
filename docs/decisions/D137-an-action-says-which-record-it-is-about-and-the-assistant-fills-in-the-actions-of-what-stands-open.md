# D137 · An action says which record it is about, and the assistant fills in the actions of what stands open

**Status:** provisional (the product owner chose its open points on 2026-11-19: the action says what it is about, a record's actions are shown on the record's page only, and it is built first for one example of a connector and then for Kalender. The server half is built (2026-11-19): the declaration with its rules in the loader, the reference, the preview and the check; the registry's index; the routes that list a record's actions and start or decide one; the assistant's draft about a record; and one example in the service desk fixture. The web half is built (2026-11-20), in the look that landed on `main`: the record's page draws its actions, and the assistant's draft about a record is the filled-in row of [D138](D138-the-corners-fraga-ai-opens-the-assistants-pane-a-card-in-the-shells-column.md) item 8. Nothing outside the repository has tested it. Numbered D132 until the merge of `main` on 2026-11-20, where `main` had taken the number) · **Date:** 2026-11-19 · **Area:** integrations, assistant, ui

**Context.** A connector can declare an action a person takes on a work item (the item's `actions`) and on a person
or a unit (`about` on a propose or an execute,
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)), and the assistant can fill one in for the
person to send ([D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item
8). A record of a view has none: a request in a service desk, an invoice or a booking can be read and nothing can be
done with it, by the person or through the assistant. When the assistant was first asked in place, on Kalender
([D129](D129-the-assistant-is-asked-in-place-where-its-answer-is-drawn-on-the-page.md)), moving and cancelling a
meeting were therefore built as two kinds of Clew's own with two tools named in the assistant, and the product owner
said the same day that this belongs in the protocol and not in the calendar.
[D135](D135-the-assistant-is-asked-beside-every-page-through-one-button-and-one-pane-of-the-page-frame.md) rule 8
(the assistant fills in only an action about what stands open, and the person sends it) is met today for a work
item, a person and a unit, and for Kalender's own two.
[D136](D136-the-thing-that-stands-open-on-its-page-is-told-to-the-assistant-by-clew.md) made the record that stands
open known to the server. The review [Where the assistant is asked](../reviews/2026-11-18-where-the-assistant-is-asked.md)
section 7 weighed three ways to declare it.

**Decision.**

1. **An action says which record it is about.** `about` on a `propose` or an `execute` gains a second form beside a
   person or a unit: a record of one of the same connector's reads. It names the read and maps the action's input
   properties to the read's own input properties, the mirror of a view's `open.params`. A record is identified by
   its read and that read's input, as the page's address holds it and as D136 sends it; no key a source made up for
   the purpose. The read must be one that answers one record (a `record`, `detail`, `text` or `document` view), never
   rows. Nothing is added to the view catalogue
   ([D100](D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md)).
2. **Clew decides where the action shows: on the record's page** (the product owner, 2026-11-19). Its buttons stand
   under the record's title, as a person's page has a person's actions, for a reader the action's scope admits. A
   list's rows get no menu: a row's name opens the record.
3. **The action runs the way an action about a person runs.** Its asks are drawn as the first step of the action's
   own dialog, "Det här händer" is its `effect` read or its description, and the last button is the person's. A
   propose becomes a work item; an execute goes through the human decision endpoint and the execution ledger
   ([D45](D45-approved-intent-precedes-source-dispatch.md)) with its audit row. The properties mapped from the record
   are filled by Clew from the address and are never asked.
4. **The assistant fills in the actions of what stands open, with one tool.** `clew.draftAction` is offered for the
   actions about the thing that stands open as the question is asked (D136): a work item's, as before, and now a
   record's. (An action in a person's or a unit's menu is not drafted today, whatever this sentence first said; a
   propose about a person that the model may call becomes a work item with a draft, which is another path.) The model never names the record. The tool checks the values against the asks as the decision
   will, writes nothing and reaches no source, and its result is a draft about that object, which the pane draws as
   one row that opens the action's own dialog with the values filled in. An execute is still never a model tool
   ([D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md)
   item 7): filling in is not running.
5. **Clew's own decisions are declared the same way.** A decision that is no capability (the calendar's move and
   cancel, reached by routes and never a tool) declares what it is about and what it asks in the same shape, and the
   one tool fills it in. `Prepared`, its two kinds and the two prepare tools of D129 then go. The page still draws
   the draft in the decision's own form: Kalender fills in "Flytta …" with the block on the grid, and opens its own
   question for a cancellation.
6. **The protocol changes in place.** It is one more form of `about` in the protocol as it stands, with its rule in
   the loader, its line in the reference and the preview, and a case in the connector check; no new version.

**Order** (the product owner, 2026-11-19). First the declaration, the record's page and the assistant's draft, on
one example in a fixture connector of the development stack, shown. Then Kalender's move and cancel onto item 5.
Then the booking for several people that D129 left as its stage 2, which is an action about nothing that exists yet
and is decided when it is reached.

**Why.** It adds one case to a concept the protocol already has (a capability says what it is about) and reuses
everything behind it: the registry's index, the action dialog, the decision endpoint, the ledger. The alternative
that reads best in a manifest, a list of actions on the view, is a new presentation field of a catalogue that is
closed on purpose. Identifying the record by its read and input means the browser sends nothing a source has to
trust beyond what it already answers a read for.

**Alternatives.** The view lists its actions (the review's P2): above. Leaving the protocol and keeping `Prepared`
for Clew's own decisions (P3): what stood, and what the product owner said it should not be. A menu on every row of
a list: more reach, but dense tables get a control per row and the record's page is one click away.

**Open when decided.**

- A check an ask cannot say (a time that has passed, a meeting that would cross a day) belongs to the action's
  `effect` read as a dry run; whether an effect may refuse, and what a call to a source inside a tool call costs,
  is settled when Kalender moves over.
- An ask whose limits depend on the record (a move keeps the meeting's length).
- An action about nothing that exists yet (a new booking).
- Whether a record's actions should also reach the conversation's page, where a record stands beside the
  transcript.

**As built, where it says more than the items above.**

- The shape: `about: { record: '<read of this connector>', params: { <action input property>: <read input property> } }`,
  beside `{ entity, param }`, which is unchanged. The loader also holds an action about a record to requiring only
  what `params` fills and what it asks, and refuses an ask that names a property the record fills.
- An action about a record is never a model tool, whatever it declares: the model would have to name the record.
- `GET /api/records/:read/actions?input=`, `POST /api/records/:read/actions`, `/decide` and `/effect`. Before an
  action is listed, started or decided Clew makes the record's read as the person; a record they may not read
  answers as an unknown address. A property `params` fills is taken from the record's input and refused in an
  answer. The work item's audit row says which read the record is of, never its input.
- The draft is a field of its own beside the work item's (`recordDraft` on the answer and on the stored message):
  the action, the record by its read and input, and the values. The turn's audit row says that a draft was made,
  for which read and action and which asks, never the values.
- A record's page draws its actions where a person's page draws a person's: at the end of the title's line, the
  first as the primary button, and under the title in one "Åtgärder" menu on a phone. A list's rows get none.
- A draft sent from its card is marked `sent: { threadId }` on the stored message in the work item's own transaction,
  and the start's audit row says `fromDraft`, with no conversation id, message id or text. Only the server writes the
  mark. The card then says what the work item says of itself: "Skickat" with the receipt's headline, "Skickat, väntar
  på källan", or "Väntar på dig" where the item was made and nothing was decided in it, each with "Visa ärendet". The
  values are not compared, since the person may change them in the dialog.
- The example is `servicedesk.comment`, "Lägg till en kommentar", an execute about `servicedesk.request` with one
  ask and an effect read; the request shows the comment afterwards.

**Limits, found while building.**

- Where the record's read is not the assistant's to make (the fixture's `servicedesk.request` is one), the draft tool
  can only check the read against the registry, without calling the source. A page that names someone else's request
  can therefore be offered a draft; sending it is refused as an unknown address, and the draft says nothing of the
  record.
- The loader does not require the read's mapped input property to be a required one. A page that opens the record
  without it leaves the action refused by its own input at the start.
- A record's page whose read has actions makes that read twice: once to draw it, once before the actions are listed.
- A draft is not marked when the person already has the same action open with the same answers, started from the
  record's page: the send finds that work item and makes nothing, so the card keeps offering "Granska och skicka".
- The record's page can show the record as it was: the decision answers before the source is written, so a person who
  goes back at once reads the old record until it is read again.

**Not built.** Item 5, Clew's own decisions and Kalender. The booking for several people.
