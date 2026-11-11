# Where things open

Your manifest says what a capability is. Clew decides where it shows, and it decides from what the thing is, never from the page the person clicked on ([D110](../decisions/D110-where-something-opens-is-decided-by-what-it-is.md)). The same declaration opens the same way on Hem, on Personal, on a person's page and anywhere else, so the table below is the whole rule for an author.

## The page and the panel

A **page** is where the person chose to be: Hem, Kalender, Personal, a tool, a person, a unit. Only the rail and a name that leads to a person or a unit change the page.

Every page has one **panel**, which holds one opened thing: a card or a view, never a list of cards. From a window 1336 px wide it stands beside the page and the page makes room for it; in a narrower window, on a short screen and on a phone it is a drawer over the page. Kalender and Administration always use the drawer. Closing the panel puts the page back as it was.

**Focused work**, a review of a card's rows one at a time, lies over the page it was started on in a wide drawer and closes back to that page.

On a phone, which overlay a card uses still differs between Hem and other pages; that half of D110 is [deferred](../maintainers/open-questions.md).

## What you declare, and where Clew shows it

| Your manifest declares | Where Clew shows it |
|---|---|
| A `read` with a `view` | Drawn by Clew from the view wherever the read is opened: in the panel beside the page, and under an assistant's answer when `model` is true ("Visa allt" opens it in the panel). |
| `menu` on such a read | Nothing until an administrator puts the view in the rail under Verktyg; then it is a page of its own at `/tools/<capability>`. No control in the panel leads to that page. |
| `view.open` (a row's own read) | The row's name is a link. The read opens in the panel beside the page; where the list is itself in the panel, or in a card, the new view takes its place there with "Tillbaka". |
| `view.subject`, `items[].subject` or a search hit's `subject` | The name leads to the person's or the unit's page, with the page it was on as the way back. On a search hit it replaces the hit's own link and view. |
| `fields[].format: "link"` | A link out of Clew (see below). `phone` and `email` are `tel:` and `mailto:` links. |
| `scan: true`, answering a `ThreadDraft` | A card. Its row is on Hem and its title opens it in the panel beside Hem. A card opened from the bell, a toast or the rail's search opens beside whatever page the person is on. |
| A draft row's `subject` naming a person or unit | The card is also listed under "Behöver dig" on that person's or unit's page, and counted under "Just nu" on Personal; opened there, it opens beside that page. |
| A card action `kind: "read"` | The read unfolds inside the card, under its buttons. A read whose view is a `table` opens in the card's place in the panel instead, with ✕ back to the card. See `target`. |
| A card action `target: "link"` | A link out of Clew: see `target`. |
| A card action `propose` or `execute` | Runs on the card, where the person decides. The outcome and its receipt show on the card; nothing moves. |
| `confirm` on a card action | A dialog over the card asks first. See `confirm`. |
| `review: "each"` with a `preview` read | The card's next step is "Granska N": the review lies over the page the card is on and closes back to it, with the card as it was. |
| `about: { entity }` on a read | A section on that person's or unit's page. When an administrator chooses, also a lens under "Visa" and a column on Personal, and a `warn` or `alert` tone marks the person's row. |
| `about: { entity, param }` on a propose or execute | An action on that person's or unit's page, and in the row's menu on Personal. Starting it makes a card, which opens beside the page it was started on. |
| `areas[]` | The area names and marks your cards, and is a choice in Hem's area filter (`/?area=<id>`) and a hit in the rail's search. |
| `areas[].standing` | A propose or execute is suggested under "Menar du" while the person types in Hem's question box. A read gets no entry of its own; its view carries the area's mark. |
| `areas[].figure`, with `opens` | A tile in the section "Läget" on Hem. With `opens`, the tile opens that view in the panel beside Hem. |
| `<id>.search` hits with a `link` or a view | The hits are a view in the panel. A hit's `link` is a link out; a hit's view opens in the panel. |
| `<id>.errands` | Rows under "Mina ärenden" on Hem; a row opens the errand's read (its view's `open`) in the panel beside Hem. |
| `header` | The band above every page. Its places open in the same tab: the one exception to the rule for links out. |

[Entities](../architecture/entities.md) gives the detail for reads and actions about a person or a unit. [Interface spaces](../reference/interface-spaces.md) is the maintainers' version of this page, with the addresses, close targets and focus.

## `target` and `confirm`

Both are fields of a card action (`ThreadDraft.actions[]`).

**`target`** is for an action with `kind: "read"`, and says where the read's answer goes. It is ignored on a propose or execute.

| `target` | What the person gets |
|---|---|
| absent or `"panel"` | The button unfolds the answer inside the card, under its buttons, and folds it again; a reload keeps it open. A `table` view opens in the card's place in the panel instead. If the answer's output holds a string `url`, Clew opens that address in a new tab and unfolds nothing, but the button did not say beforehand that it leaves Clew: use `"link"` for that. |
| `"link"` | The button is marked as leaving Clew. When pressed, Clew calls your read as the person and opens the `url` in its output in a new tab. An output without a string `url` opens nothing. |

**`confirm`** is a Swedish string on any card action. Before the action runs, Clew asks it in a dialog over the card, with "Avbryt" and the action's own label as the buttons. The text up to the first question mark is the question; the rest says what follows from yes: `"Avvisa filen? Ditt beslut gäller för alla som kan godkänna den."`. Without a question mark the action's label is the question and your text the explanation. Nothing is called before the person says yes.

## Links out of Clew

Everything that leaves Clew opens in a new tab and is marked as leaving, with Astryx's external-link icon and, for a screen reader, "(öppnas i ny flik)": a `link` field, a search hit's `link`, a card action with `target: "link"`, an action point's `link` and a review's link to the source. You cannot make a link out open in the same tab.

The one exception is the shared header ([D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)): its places cross between the organisation's own sites, so they load in the same tab.

## What you can and cannot influence

You decide what a capability is (read, propose or execute), its view and its Swedish labels; whether a card's read stays in Clew or leaves (`target`); whether an action asks first (`confirm`); whether rows are reviewed one at a time (`review`); what rows are about (`about`) or name (`subject`); and which read a row or a tile opens (`view.open`, `opens`).

You cannot name a page, a panel, a side, a width or a tab. Nothing you declare opens Hem or moves the person to another page, except a name that leads to a person or a unit. The window decides whether the panel stands beside the page or over it. An administrator decides whether a view is in the rail and whether a read about a person is a lens or a column; the [manifest preview](../reference/connector-protocol.md#served-by-the-instance) at `/protocol/preview` lists the places a read or an action about an entity can take.
