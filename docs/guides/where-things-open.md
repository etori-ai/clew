# Where things open

Your manifest says what a capability is. Clew decides where it shows, and it decides from what the thing is, never from the page the person clicked on ([D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md)). The same declaration opens the same way on Hem, on Personal, on a person's page and anywhere else, so the table below is the whole rule for an author.

## The page and the panel

A **page** is where the person chose to be: Hem, Att göra, a work item's page, Kalender, Personal, a tool, a person, a unit. The rail and a name that leads to a person or a unit change the page, and so do the few links that say where they go: a work item's row on Hem leads to it in Att göra, and "Öppna som sida" leads to the work item's own page ([D112](../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)).

Every page has one **panel**, which holds one opened thing: a work item, a view, a record, a calendar entry or the page itself, never a list of work items. Under the thing is the conversation about it and, while a model is configured, a question box that asks about that thing alone. From a window 1336 px wide the panel stands beside the page and the page makes room for it; in a narrower window, on a short screen and on a phone it is a drawer over the page. Administration always uses the drawer. Closing the panel puts the page back as it was. In Att göra the chosen work item is drawn in a reading pane beside the queue, in the panel's shape.

**Focused work**, a review of a work item's rows one at a time or one person's talk, lies over the page it was started on in a wide drawer (a sheet on a phone) and closes back to that page. **A write** that asks the person something or says beforehand what it writes opens one dialog over the page, wherever its button is.

On a phone the rail is a drawer, a work item opens full screen with its next step pinned at the foot, and the panel is the drawer over the page.

## What you declare, and where Clew shows it

| Your manifest declares | Where Clew shows it |
|---|---|
| A `read` with a `view` | Drawn by Clew from the view wherever the read is opened: in the panel beside the page, and under an assistant's answer when `model` is true ("Visa allt" opens it in the panel). |
| `menu` on such a read | Nothing until an administrator puts the view in the rail under Verktyg; then it is a page of its own at `/tools/<capability>`. No control in the panel leads to that page. |
| `view.open` (a row's own read) | The row's name is a link. The read opens in the panel beside the page; where the list is itself in the panel, or in a work item, the new view takes its place there with "Tillbaka". |
| `view.subject`, `items[].subject` or a search hit's `subject` | The name leads to the person's or the unit's page, with the page it was on as the way back. On a search hit it replaces the hit's own link and view. |
| `fields[].format: "link"` | A link out of Clew (see below). `phone` and `email` are `tel:` and `mailto:` links. |
| `scan: true`, answering a `ThreadDraft` | A work item ("ärende"). Its row is in Att göra, and the three most urgent are also on Hem; choosing a row shows the item in Att göra's reading pane (`/todo?item=<threadId>`), and "Öppna som sida" gives it a page of its own (`/items/<threadId>`). A work item opened from the bell, a toast or the rail's search opens over whatever page the person is on. |
| A draft row's `subject` naming a person or unit | The work item is also listed under "Behöver dig" on that person's or unit's page, and counted under "Just nu" on Personal; opened there, it opens beside that page. |
| A work item action `kind: "read"` | The read unfolds inside the work item, under its buttons. A read whose view is a `table` opens in the item's place in the panel instead, with ✕ back to the item. See `target`. |
| A work item action `target: "link"` | A link out of Clew: see `target`. |
| A work item action `propose` or `execute` | Runs on the work item, where the person decides, through the action dialog when its capability declares `asks` or `effect`. The outcome and its receipt show on the item, row by row, and under its Händelser; nothing moves. |
| `confirm` on a work item action | A dialog over the item asks first; when the action opens the action dialog, the question is on its last step instead. See `confirm`. |
| `asks` on a propose or execute | Its button opens one dialog over the page, wherever the action starts (a work item, a person or unit, Personal's row menu): the first step, "Uppgifter", asks what the action does not already fill. A meeting time is offered as three free times from the person's own calendar. See `asks` and `effect`. |
| `effect` on an execute | The dialog's last step, "Det här händer", shows your read's rows for exactly the filled-in input, before anything is sent. Without it the step names your system and shows the capability's description. |
| `review: "each"` with a `preview` read | The work item's next step is "Granska N", and each row's document is listed under "Dokument": the review lies over the page the item is on and closes back to it, with the item as it was. |
| `about: { entity }` on a read | A section on that person's or unit's page. When an administrator chooses, also a lens under "Visa" and a column on Personal, and a `warn` or `alert` tone marks the person's row. |
| `about: { entity, param }` on a propose or execute | An action in the header of that person's or unit's page, and in the row's menu on Personal. Starting it makes a work item, which opens beside the page it was started on. |
| `areas[]` | The area names and marks your work items, and is a choice in Att göra's system filter (`/todo?area=<id>`) and a hit in the rail's search. |
| `areas[].standing` | A propose or execute is suggested under "Menar du" while the person types in Hem's question box. A read gets no entry of its own; its view carries the area's mark. |
| `areas[].figure`, with `opens` | A tile in the section "Läget" on Hem. With `opens`, the tile opens that view in the panel beside Hem. |
| `<id>.search` hits with a `link` or a view | The hits are a view in the panel. A hit's `link` is a link out; a hit's view opens in the panel. |
| `<id>.errands` | Rows under "Mina ärenden" on Hem; a row opens the errand's read (its view's `open`) in the panel beside Hem. |
| `<id>.news` | The three newest rows, across every news source the person may read, in the block "Nyheter" on Hem, and every row on "Alla nyheter" (`/tools/clew.news`). A row with `link` is a link out in a new tab; without one it opens its read (the view's `open`) in the panel beside the page. |
| `acknowledgement: { publishedAt }` on a draft's execute | The work item is the person's read receipt to give: while it is open, the most urgent such item stands above Hem's blocks with "Läs" and that action as its button, and is not a row under "Behöver dig" too. |
| `header` | The band above every page. Its places open in the same tab: the one exception to the rule for links out. A place or page with `purpose: "toolbox"` is also the link "Fler verktyg på intranätet" under Verktygslådan on Hem, which opens in a new tab. |

[Entities](../architecture/entities.md) gives the detail for reads and actions about a person or a unit. [Interface spaces](../reference/interface-spaces.md) is the maintainers' version of this page, with the addresses, close targets and focus.

## `target` and `confirm`

Both are fields of a work item's action (`ThreadDraft.actions[]`).

**`target`** is for an action with `kind: "read"`, and says where the read's answer goes. It is ignored on a propose or execute.

| `target` | What the person gets |
|---|---|
| absent or `"panel"` | The button unfolds the answer inside the work item, under its buttons, and folds it again; a reload keeps it open. A `table` view opens in the item's place in the panel instead. If the answer's output holds a string `url`, Clew opens that address in a new tab and unfolds nothing, but the button did not say beforehand that it leaves Clew: use `"link"` for that. |
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

What the person meets, from every place the button is drawn (a work item in Att göra, in the panel, as a page and on a phone's pinned bar; a person's or a unit's page; the row menu on Personal):

- **The dialog** is Astryx's `form-wizard-dialog` over the page, fullscreen on a phone with its buttons pinned at the foot. ✕, Esc and Avbryt send nothing and give the focus back to the button; what the person typed stays while the work item is open.
- **Uppgifter** has one field per ask, labelled with your Swedish `label`, a required one marked as Astryx marks it. A `meeting` ask offers up to three free times from the person's own calendar (each with its day, its time and that the person is free), then "Annan tid" with a date and a clock; under them the person's own day for the chosen date, drawn by the calendar family and said in words for a screen reader. Without a calendar only the date and the clock are asked. `text` is a text field, `long-text` a text area, `date` a date field and `choice` a radio list (a selector above five options).
- **Det här händer** lists the values, then your `effect` read's rows for exactly those values (read again whenever they change, and "Du kan ångra i N minuter." when you give `undoMinutes`), or your system's name and the capability's `description` without an effect read. While your effect read has not answered, nothing can be sent.
- **When nothing is required** (an approval with an optional comment) the dialog opens at Det här händer, so it is two presses; the ask is one step back ("Lägg till kommentar till medarbetaren").
- **A refusal** from your input schema or Clew's check is shown on the field whose label it starts with ("När: tiden har redan passerat."), with the focus there, else at the top of Det här händer. A `maxLength` in your schema is checked when the person sends.
- **An execute about a person or a unit** opens its work item beside the page first, with the dialog over it on the item's own button; a propose that asks is filled in before it starts, and drafts its work item with the answers.

[Status](../reference/status/protocol.md#what-a-write-asks-and-what-it-says-it-will-do).

## Links out of Clew

Everything that leaves Clew opens in a new tab and is marked as leaving, with Astryx's external-link icon and, for a screen reader, "(öppnas i ny flik)": a `link` field, a search hit's `link`, a news row's `link`, a work item action with `target: "link"`, an action point's `link` and a review's link to the source. You cannot make a link out open in the same tab.

The one exception is the shared header ([D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)): its places cross between the organisation's own sites, so they load in the same tab.

## What you can and cannot influence

You decide what a capability is (read, propose or execute), its view and its Swedish labels; whether a work item's read stays in Clew or leaves (`target`); whether an action asks first (`confirm`); whether rows are reviewed one at a time (`review`); what a write asks the person (`asks`: which properties, with which labels, required or not) and whether it says beforehand what it will write (`effect`); what rows are about (`about`) or name (`subject`); and which read a row or a tile opens (`view.open`, `opens`).

You cannot name a page, a panel, a side, a width or a tab. You cannot draw a form: an ask is one of Clew's closed kinds (a meeting time, a line of text, a paragraph, a date, a choice), Clew decides how it is drawn, and a meeting time's suggestions come from the person's own calendar, never from someone else's. Nothing you declare opens Hem or moves the person to another page, except a name that leads to a person or a unit. The window decides whether the panel stands beside the page or over it. An administrator decides whether a view is in the rail and whether a read about a person is a lens or a column; the [manifest preview](../reference/connector-protocol.md#served-by-the-instance) at `/protocol/preview` lists the places a read or an action about an entity can take, and, for every propose and execute, where a person can start it and which steps of the path it draws.
