# D42 · A tool opens as a page

**Status:** accepted, built 2026-11-05; sorting and column filters on the page are not built; the link from a view in the panel to the tool's page, the box on the page and the row's view beside the table are [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md); the width rule that counts the rail and the box on the page to be replaced by [D115](D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md) (provisional, 2026-11-11; not built, so this record still binds what is built) · **Date:** 2026-11-05 · **Area:** ui

**Amended 2026-11-05 by D48.** The table starts at 1280 px, not 1360 (§8): the phone book's seven columns need 970 px at the new floors, and the rail takes 260, so a 1280 px laptop has the table and nothing scrolls sideways. The reason to keep a list below that still holds.

**Decision.** Everything under Verktyg in the menu opens the same way: as a page of its own, inside the one shell.
Kalender already did. A view an administrator has chosen as a tool (D40) now does too, and no longer opens in the side
panel over the start page.

1. **The address.** `/tools/:capability`. What the view's own controls ask for is `input`, as before. The address is
   English, as every address is from D43 on. The row in the menu, and the hit in the menu's search, lead there.
2. **The page** (`apps/web/src/pages/tool.tsx`) follows Astryx's `table-page` template: one scrolling column in a
   `Layout` with the tool's name as the `h1` (the row's label, "Telefonbok"), then the view's search field and choice,
   then its rows, with `LayoutContent padding={0}` and the padding on the stack so a table sits on the heading's line.
   The view is drawn by the one renderer (`DeclaredView`, D38), so a tool looks, reads and tabs like the same view in
   the panel. A heading inside the view is an `h2` on the page and an `h3` in the panel (`headingLevel`).
3. **Typing asks again in place.** The controls rewrite `input` in the address with `replace`, so a search is
   addressable and one step back leaves the tool, however much was typed.
4. **A row's own view opens in the side panel over the page.** A name in the phone book opens the contact card in the
   existing `PanelView`, as an entry on the calendar opens a dialog over the calendar. The address names both:
   `open` (the capability), `open-title`, `open-input`, and `via=1` when the card was opened from another opened view,
   which then shows Tillbaka. A reload or a link lands on the page with the card open, the back button closes the
   card, closing it returns focus to the name, and what was typed in the tool is still there.
5. **Only a tool has a page.** The page is drawn for a capability the person has as a row in the menu
   (`GET /api/areas`). Anything else, a view that is not chosen or not theirs, gets "Verktyget finns inte" and the way
   home, and the view is never asked for. The read itself is checked on the server as before.
6. **The row is current on its page** (`RailCurrent.surface: 'verktyg'`), as Kalender is on its own. A view opened in
   the panel no longer marks a row.
7. **Where the panel stays.** A view opened from inside something else, a chip under the box, an area's card, an
   answer, a search hit or a card's button, still opens in the side panel at `/views/:capability`, over where the
   person is. That is the same split the calendar has: Kalender is a page, and a day asked for in a conversation is the
   day strip in the panel (D32).
8. **Table or list.** A table is drawn as a table when the window is at least 1360 px wide; narrower, the same rows are
   the list a phone gets (`tableQuery`). The phone book's seven columns need about 1060 px (the floors set in D38), and
   the rail takes 260.

**Why.** The product owner saw the two rows under Verktyg behave differently: Kalender opened a page, Telefonbok a
drawer over the start page. A section of the menu should not hold two kinds of thing. D40 put a view in the panel
because the panel was the only place a view could be drawn, and said so: "a view lifted to a full page would make a tool
a true sibling of Kalender". This is that step.

*Why a page and not the panel for both.* A tool is somewhere one goes: it is named in the menu, it is marked as
current, and it should hold the whole width for a table of seven columns. The panel is for a look at something beside
what one is doing. A drawer opened from the menu covered the page behind it for no reason, and from the calendar it
first had to load the start page to have something to lie over.

*Why a new address instead of D40's "the row's address would stay the same".* `/views/:capability` (`/vy/…` then) is
what a chip, an answer and a search hit open, in the panel, and that must keep working (item 7). One address cannot be
both a page and a panel over another page.

*Why the row's view is in the panel and not a second page or a fixed side column.* A second page loses the list the
person is looking through. A fixed `LayoutPanel` beside the table (the layout guide's master-detail) would take 380 px
from a table that needs all it has, and would stand empty until a row is chosen. The panel over the page costs nothing
until it is asked for, and it is the same component the rest of the product uses.

*Why only a view in the person's menu.* The page is what the row leads to. If any readable view had a page at a
guessable address, an administrator switching a tool off would not take its page away, and the menu would stop being
the list of tools.

*Why the list below 1360 px.* A table that scrolls sideways hides its last columns, and here those are the e-mail and
the button that puts a person into the conversation. The list shows everything at every width. At 1280 px a list of
people is longer than a table would be; that is the cost.

**Verified.** `tests/a11y/tools.spec.ts`: the page's name, title and table, no dialog, the row current, axe; typing
(focus kept, the address, the spoken count, one step back); a name opening the card over the page, the address, focus
into the card and back to the name, the title; a reload with the card open and the back button; another tool taking the
page with its name spoken; a view not in the menu; the tab order; the list beside the rail at 1280 px; a phone; reflow
and axe at 320 px. `tests/a11y/menu.spec.ts`: the rows' addresses, the row opening the page by keyboard, from the
calendar, from the menu's search, and from the drawer on a phone. `bun run check`.

**Not built.** A link from a view in the panel to the tool's own page when the view is one. Sorting and column filters
on the page (the template's; the view's declared controls are what there is). A width for the search field. A canvas
artboard for a tool's page: the canvas has none, so the page was built from the template and the calendar page, and
needs a row drawn. A manual screen-reader pass.

**Replaces.** Item 5 of D40 where it says a row opens in the side panel, and its paragraph "Why the panel and not a
page". Closes "a view lifted to a full page" in D38's and D40's lists of what is not built, for the views that are
tools.
