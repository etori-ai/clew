# Where things open

Your manifest says what a capability is. Clew decides where it shows, and it decides from what the thing is, never from the page the person clicked on ([D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md)). The same declaration opens the same way on Hem, on Personal, on a person's page and anywhere else, so the table below is the whole rule for an author.

## One page per thing

A **page** is where the person is: Hem, Att göra, Kalender, Personal, a view, a conversation, and a thing's own page. Every thing has one page ([D126](../decisions/D126-one-page-per-thing-one-astryx-template-per-page-type.md)): a work item (`/items/<threadId>`), a person, a unit, a plan, and every read a person may open (`/tools/<capability>`, whether or not an administrator put it in the rail; [D116](../decisions/D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)). A list or a table is a register there, a record, a text or a document a thing's page. The name in a row is the link to that page wherever the row is, with the page it was on as the way back, and Back returns to where the person was. Nothing opens over a page to show a thing: there is no panel beside Hem, Personal or a tool, and an address that opened one before leads to the thing's page.

**A pane beside something exists in two places only.** In Att göra the chosen work item stands in a reading pane beside the queue; beside a conversation, the thing the conversation is about. Both draw the same parts as the thing's page, and the title is the link to it. Kalender's entry has a pane of its own beside the grid ([D27](../decisions/D27-event-calendar-is-fullcalendar-themed-with-astryx-tokens.md)).

**The assistant has two homes**, a one-line way in on Hem, whose question is asked on the conversation's page, and that page, which holds the composer. "Fråga Clew" on a thing's page starts a conversation with that thing beside it; nothing is asked until the person writes.

**The review is a page**: "Granska N" and each row under "Dokument" lead to `/items/<threadId>/review`, one row at a time with its document, then Skicka, and Back returns to the work item where it was ([D73](../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md) as amended 2026-11-12, under D116's rule). The person's decisions are kept for the session in their browser tab, so the item says "Fortsätt granska" when they come back; nothing reaches your system until Skicka. **Work a person goes through** is a page or a tab: one person's talk is a tab of their page, a unit's dialogue a tab of the unit's. **A write** opens one dialog over the page, wherever its button is: always when it is about a person or a unit, and on a work item when it asks the person something or says beforehand what it writes.

**When your system does not answer**, Clew says so where its content is missing, never over the page ([D116, amended 2026-11-12](../decisions/D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)): your open work items say "kan vara gammal" on their rows and, in their heads, since when your system last answered; a view's page, a tab on a person's or a unit's page and a figure under Läget say so in their place, the first two with "Försök igen" (a news source that does not answer only leaves Hem's "Nyheter" out, as D112 decided); a write pressed on one of your work items says that what is sent is queued and read back when your system answers. The first time in a session a person meets it, a screen reader hears "<your system> svarar inte" once. You declare nothing for it: it follows from your scans' and reads' answers.

On a phone the rail is a drawer, a work item's page pins its next step at the foot, and a page's tabs past the first are under "Fler".

## What you declare, and where Clew shows it

| Your manifest declares | Where Clew shows it |
|---|---|
| A `read` with a `view` | Drawn by Clew from the view wherever the read is opened, on its page, `/tools/<capability>`: a `table` or a `list` as a register, any other kind as a thing's page. Beside a conversation one thing stands in the pane, its name the link to its page. Under an assistant's answer when `model` is true, a few rows of it, and "Visa allt" leads where the view opens. |
| `menu` on such a read | Nothing until an administrator puts the view in the rail under Verktyg; then the rail (its first four tools) and Alla verktyg (`/tools`, every one) lead to its page, `/tools/<capability>`, under the row's name, and the rail marks it there. |
| `view.open` (a row's own read) | The row's name is the link to that read's page, with the list as the way back. |
| `view.subject`, `items[].subject` or a search hit's `subject` | The name leads to the person's or the unit's page, with the page it was on as the way back, and only there: a person's name always leads to the person. A row that also opens a read of its own (`view.open`) keeps that read as a link of its own, named with the read's title for the row ("Mönster för Anna Lindqvist"): at the row's end in a list, in a column headed with the read's title in a table. On a search hit the subject replaces the hit's own link and view. |
| `fields[].format: "link"` | A link out of Clew (see below). `phone` and `email` are `tel:` and `mailto:` links. |
| `scan: true`, answering a `ThreadDraft` | A work item ("ärende"). Its row is in Att göra, and the three most urgent are also on Hem; choosing a row in Att göra shows the item in the reading pane (`/todo?item=<threadId>`), whose title is the link to its page of its own (`/items/<threadId>`); a row's name on Hem leads to that page. A work item opened from a reminder, a toast or the rail's search opens in the reading pane when the person is in Att göra, else on its page. A single row that only repeats the item's title (no `detail`, no `subject`, not `selectable`) is not drawn. |
| A draft row's `subject` naming a person or unit | The work item is also listed under "Behöver dig" and Ärenden on that person's or unit's page, and counted under "Just nu" on Personal; its name there leads to its page. |
| A work item action `kind: "read"` | A link to the read's page ("Se i personalsystemet"), with the page the item is on as the way back; nothing unfolds inside the item. See `target`. |
| A work item action `target: "link"` | A link out of Clew: see `target`. |
| A work item action `propose` or `execute` | Runs on the work item, where the person decides, through the action dialog when its capability declares `asks` or `effect`. The outcome and its receipt show on the item, row by row, and under its Händelser; nothing moves. |
| `confirm` on a work item action | A dialog over the item asks first; when the action opens the action dialog, the question is on its last step instead. See `confirm`. |
| A `propose` with `model: true` | The assistant may call it in a conversation when the person asks for what it prepares. It is never run as a read: its draft becomes a work item (the same way as an item the person starts), shown in the conversation. Where the item's action asks for a property the assistant gave the propose under the same name, that value is the draft of the ask, which the person opens in the action's dialog and can change. Without a model the person starts it by typing its title. Nothing is sent before the person decides. |
| `asks` on a propose or execute | Its button opens one dialog over the page, wherever the action starts (a work item, a person or unit, Personal's row menu): the first step, "Uppgifter", asks what the action does not already fill. A meeting time is offered as three free times from the person's own calendar. See `asks` and `effect`. |
| `effect` on an execute | The dialog's last step, "Det här händer", shows your read's rows for exactly the filled-in input, before anything is sent. Without it the step names your system and shows the capability's description. |
| `review: "each"` with a `preview` read | The work item's next step is "Granska N", and each row's document is listed under "Dokument": both lead to the review's page, `/items/<threadId>/review`, and Back returns to the item where it was, with the person's decisions as its selection. |
| `about: { entity }` on a read | A tab of that person's or unit's page, with its row in short on the overview. When an administrator chooses, also a lens (a tab of Personal) and a column on Personal, and a `warn` or `alert` tone marks the person's row. |
| `about: { entity, param }` on a propose or execute | An action under the name on that person's or unit's page, and in the row's menu on Personal. Starting it opens the action dialog before anything exists; its last button makes the work item, which opens on its page. |
| `areas[]` | The area names and marks your work items, and is a choice in Att göra's system filter (`/todo?area=<id>`) and a hit in the rail's search. |
| `areas[].standing` | A read gets no entry of its own; its view carries the area's mark. A propose or execute here is offered nowhere since 2026-11-13, when the suggestions under Hem's question box ("Menar du") were removed; the protocol's description of the field still names them. |
| `areas[].figure`, with `opens` | A tile in "Läget" on Hem (at most four, worst first) and a row on the unit's page. With `opens`, the tile leads to that view's page; a table of people that names its lens (`view.byKey`, [D127](../decisions/D127-a-read-can-say-its-rows-are-a-read-about-people-asked-for-everyone.md)) leads to Personal's tab for it. |
| `<id>.search` hits with a `link` or a view | The hits are rows: opened from an answer, they are the search's page. A hit's `link` is a link out; a hit's view leads to its own page. |
| `<id>.errands` | Rows of the tool "Mina ärenden" (`/tools/clew.errands`), under Verktyg and on Alla verktyg; a row's name leads to the errand's read (its view's `open`) as its page. |
| `<id>.requests` | Rows of the tool "Mina beställningar" (`/tools/clew.requests`), under Verktyg and on Alla verktyg, what waits on the person first and marked "väntar på dig". A row's name leads to the request's read (its view's `open`) as its page. |
| `<id>.news` | The three newest rows, across every news source the person may read, in the block "Nyheter" on Hem, and every row on "Alla nyheter" (`/tools/clew.news`). A row with `link` is a link out in a new tab; without one its name leads to its read (the view's `open`) as its page. |
| `acknowledgement: { publishedAt }` on a draft's execute | The work item is the person's read receipt to give: while it is open, the most urgent such item stands above Hem's blocks with "Läs" (the item's page) and that action as its button, and is not a row under "Behöver dig" too. The item is a notice: your `summary` is the text the person reads, first in the item (separate paragraphs with a blank line); your first `read` with `target: "link"` stands after that text as the way to the whole of it, not among the buttons; "Varför ser jag detta?" shows your `reason` (who published it and when) and where the item came from. |
| `header` | The band above every page. Its places open in the same tab: the one exception to the rule for links out. A place or page with `purpose: "toolbox"` is also the link to the intranet's page of tools at the foot of Alla verktyg, which opens in a new tab. |

[Entities](../architecture/entities.md) gives the detail for reads and actions about a person or a unit. [Interface spaces](../reference/interface-spaces.md) is the maintainers' version of this page, with the addresses, close targets and focus.

## `target` and `confirm`

Both are fields of a work item's action (`ThreadDraft.actions[]`).

**`target`** is for an action with `kind: "read"`, and says where the read's answer goes. It is ignored on a propose or execute.

| `target` | What the person gets |
|---|---|
| absent or `"panel"` | The button is a link to the read's page, with the work item's page as the way back; nothing unfolds inside the item since D126. To leave Clew, use `"link"`. |
| `"link"` | The button is marked as leaving Clew. When pressed, Clew calls your read as the person and opens the `url` in its output in a new tab. An output without a string `url` opens nothing. |

**`confirm`** is a Swedish string on any work item action. Before the action runs, Clew asks it in a dialog over the item, with "Avbryt" and the action's own label as the buttons (on the action dialog's last step when the action opens one). The text up to the first question mark is the question; the rest says what follows from yes: `"Avvisa filen? Ditt beslut gäller för alla som kan godkänna den."`. Without a question mark the action's label is the question and your text the explanation. Nothing is called before the person says yes.

## `asks` and `effect`

Both are fields of a capability ([D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)). A write passes one path from every place it starts, and a step is drawn only when your declaration calls for it:

| Step | Drawn when |
|---|---|
| Uppgifter | The capability declares `asks` and the action does not already fill them all |
| Det här händer | The dialog is open: the last step, with your `effect` read's rows, or your system's name and the capability's description |
| Ask first | A work item action declares `confirm` |
| One at a time | A work item action declares `review: "each"` |
| Receipt and Ångra | Every execute: on the work item, row by row, with Ångra while your answer allows it |

A write without `asks` and without `effect` stays one press. Nothing is sent before the dialog's last button, whose label is the action's own, and the work item the write belongs to shows the receipt, row by row, with Ångra while your answer allows it, and the decision under Händelser.

What the person meets, from every place the button is drawn (a work item in Att göra's pane, beside a conversation, as a page and on a phone's pinned bar; a person's or a unit's page; the row menu on Personal):

- **The dialog** is Astryx's `form-wizard-dialog` over the page, fullscreen on a phone with its buttons pinned at the foot. ✕, Esc and Avbryt send nothing and give the focus back to the button; what the person typed stays while the work item is open.
- **Uppgifter** has one field per ask, labelled with your Swedish `label`, a required one marked as Astryx marks it. A `meeting` ask offers up to three free times from the person's own calendar (each with its day, its time and that the person is free), then "Annan tid" with a date and a clock; under them the person's own day for the chosen date, drawn by the calendar family and said in words for a screen reader. Without a calendar only the date and the clock are asked. `text` is a text field, `long-text` a text area, `date` a date field and `choice` a radio list (a selector above five options).
- **Det här händer** lists the values, then your `effect` read's rows for exactly those values (read again whenever they change, and "Du kan ångra i N minuter." when you give `undoMinutes`), or your system's name and the capability's `description` without an effect read. While your effect read has not answered, nothing can be sent.
- **When nothing is required** (an approval with an optional comment) the dialog opens at Det här händer, so it is two presses; the ask is one step back ("Lägg till kommentar till medarbetaren").
- **A refusal** from your input schema or Clew's check is shown on the field whose label it starts with ("När: tiden har redan passerat."), with the focus there, else at the top of Det här händer. A `maxLength` in your schema is checked when the person sends.
- **An action about a person or a unit** opens the dialog before anything exists (D126 item 7): an execute's Det här händer is its effect read for that person or unit, and its last button makes the work item with the person's decision in it; a propose's last button drafts its work item with the answers. Cancelling leaves nothing behind.

[Status](../reference/status/protocol.md#what-a-write-asks-and-what-it-says-it-will-do).

## Links out of Clew

Everything that leaves Clew opens in a new tab and is marked as leaving, with Astryx's external-link icon and, for a screen reader, "(öppnas i ny flik)": a `link` field, a search hit's `link`, a news row's `link`, a work item action with `target: "link"`, an action point's `link` and a review's link to the source. You cannot make a link out open in the same tab.

The one exception is the shared header ([D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)): its places cross between the organisation's own sites, so they load in the same tab.

## What you can and cannot influence

You decide what a capability is (read, propose or execute), its view and its Swedish labels; whether a work item's read stays in Clew or leaves (`target`); whether an action asks first (`confirm`); whether rows are reviewed one at a time (`review`); what a write asks the person (`asks`: which properties, with which labels, required or not) and whether it says beforehand what it will write (`effect`); what rows are about (`about`) or name (`subject`); and which read a row or a tile opens (`view.open`, `opens`).

You cannot name a page, a pane, a side, a width or a tab: Clew decides where a thing opens, and every thing has its page. You cannot draw a form: an ask is one of Clew's closed kinds (a meeting time, a line of text, a paragraph, a date, a choice), Clew decides how it is drawn, and a meeting time's suggestions come from the person's own calendar, never from someone else's. Nothing you declare opens Hem or moves the person to another page except by a name or a link the person presses. The window decides whether a pane stands beside the queue or the conversation, or the thing is its page. An administrator decides whether a view is in the rail and whether a read about a person is a lens or a column; the [manifest preview](../reference/connector-protocol.md#served-by-the-instance) at `/protocol/preview` lists the places a read or an action about an entity can take, and, for every propose and execute, where a person can start it and which steps of the path it draws.
