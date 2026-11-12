# D63 · Hem is drawn as the canvas draws it, pixel for pixel, with Astryx's own tokens

**Status:** accepted, built 2026-11-06 on `main`; the elements the artboards draw without anything behind them are listed under "Asked, not built" and wait for the product owner; Hem's layout replaced by [D111](D111-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) items 2 and 3 (2026-11-11), with the board Hem10 as the reference · **Date:** 2026-11-06 · **Area:** ui

**Decision.** Hem, the card beside it, the quiet page, the conversation and the phone are built to match the artboards
of the canvas **Clew startsida · dagen i ett svep** (https://claude.ai/artifact/9xn43bAwXy2VioBqiG3xc6, artboards A, B,
E, G, I, D and K; C was not chosen) element by element: position, size, spacing, type size and weight, colour, borders,
radii, the order and wording of every label. The product owner asked for this on 2026-11-06 ("indistinguishable from
the artboards, not an approximation in the same spirit"), together with two rules: where Astryx measures differently
from the drawing, the prop, size, density or token that matches is used and the rest is recorded here as an Astryx gap,
never papered over with a style; and anything the drawing shows that the code cannot do is asked about, never invented
and never quietly dropped. The comparison is
[Hem against the canvas, artboard by artboard](../reviews/2026-11-06-hem-against-the-canvas.md).

1. **The type scale is the canvas's.** `packages/ui/src/theme.ts` sets Astryx's own scale token to the artboards' 14 px
   body (`typography: { scale: { base: 14, ratio: 1.2 } }`, Astryx's default). The section headings are drawn at the
   third step (`Heading level={3} accessibilityLevel={2}`, 16.8 px against the drawing's 16) and the greeting likewise
   (`level={3} accessibilityLevel={1}`), so the outline stays h1, h2 while the size is the drawing's. A tile's figure is
   `Text size="2xl"` (24.2 px against 26), the panel's card title `Heading level={2}` (20.2 against 20).
2. **The lead.** "Hej Hillevi" with the sparkle, small, and the day, the week and the unit at the end of the same line
   ("Onsdag 5 november · vecka 45 · Skolan"). The box is one line tall from the start and spans the whole content width.
3. **The day beside the day's work.** Where the panel fits beside the column (1336 px and up) the day and Sedan i går
   are the resting panel, a `LayoutPanel` that folds (item 14), and the box spans the column alone; between 1024 and
   1336 px they are the third track of a `Grid columns={3}` under the box, 32 px from the day's work, as artboard A
   draws them; under 1024 px and on a phone a `VStack` after the day's work. Beside the column stand two cards: **I dag**,
   the meetings with their time, name, room and length and the free gaps as "Ledigt till …" rows, the longest saying
   "Längsta luckan · jag bokar inget här utan att fråga", with "Hela veckan"; and **Sedan i går**, a muted card with
   three sentences in the artboard's words (what closed with its receipt's time, what waits with how many have
   answered, the next review with whether every source answered) and "Allt som är klart". While a card, a view or a
   card's read stands in the panel the side column is not drawn (artboard E); the resting `LayoutPanel` of D53 item 6
   is gone.
4. **The tabs** carry their count as a neutral `Badge` after the name (Behöver dig always, the others when they hold
   something; Klart counts what closed today, not conversations), and the area filter is one `DropdownMenu` with a ghost
   button that says the chosen area, on the same line, with one `Divider` under both. The attention tip is not on the
   artboard and is not on Hem.
5. **The groups** come in the artboard's order, Nu, Jag föreslår, Senare, Till kännedom, each a heading with its count
   and the artboard's caption at the end of the line ("Deadline i dag, eller något du bad om", "Ingen deadline, nej
   tack är ett svar", "Bara det som har en dag får en dag", "Alltid samma fyra · varje ruta öppnar sin tråd"). Nu stands
   in a red-tinted `Card`; the others are rows fenced by dividers.
6. **A row** (`ThreadRow`): a 56 px day cell ("i dag" as the one red badge, "försenad" when overdue, the day word for a
   later deadline, "✦ klart" or "✦ utkast" on a proposal, the info mark on a notice), the title as the `Link` to its
   card (`/?card=`), one line with the area and the reason, and at the end "Lägg till i samtalet" (ghost) and the one
   next step, 32 px buttons, "Granska 3" when it counts rows. No ⋯ on a row: Inte nu, Avfärda and "Varför nu?" belong
   to the open card. The open row is the current one, says "öppet bredvid" and offers ✕ "Stäng kortet"; beside the
   panel a row keeps its next step alone.
7. **The open card** (`GenericCard` with `beside`, artboard E): the panel is its surface, its name "Kort" a small
   secondary heading, the card's one time action (D49) among the card's buttons (first in the panel's header beside
   ✕ as artboard E draws it; moved into the card by [D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)
   item 2 on 2026-11-06, since the header is the panel's). The state
   line (the "i dag" badge, the area and the source), the title at 20 px, the lead sentence, the rows in a bordered card
   with the label in semibold and the detail under it, the buttons at 36 px ("Attestera 2 valda", the secondary
   actions, "Lägg till i samtalet", ⋯ with Avfärda), one line on what the next step does ("… skrivs till
   ekonomisystemet och läses tillbaka som kvitto. Ångra i 10 minuter. Fungerar utan modellen."), and "Varför nu?" and
   "Historik" as `Collapsible`s in cards, gliding with Astryx's `useAnimatedLayout`.
8. **Läget is not on Hem.** The artboard draws four tiles; the server's figures are a fixed synthetic list and D54,
   which would take them from the connectors, is not decided. The product owner chose on 2026-11-06 to leave Läget out
   until it is; `lage.tsx` is gone with it and comes back with D54's figures.
9. **The quiet page** (artboard B): a green-tinted card, "Lugnt läge", one sentence with the sources, what waits and the
   next review, and the links "2 väntar på andra" and "1 klar i dag". **Det du kan göra** (D41's areas with their standing
   actions) is not drawn at all, on the quiet page either: the product owner saw the toggles on the dev stack and asked
   for them to go ("seeing multiple of these, maybe remove entirely", 2026-11-06); what an area can start is reached
   through the box and "Menar du" (D36).
10. **I dag names what a meeting came from.** A meeting whose `event:` chip the person pointed at in a conversation says
    "underlaget ligger i samtalet", a link to that conversation; a meeting a card's confirmed proposal created says
    "från kortet <title>", a link to the card (the product owner chose to build the link, 2026-11-06).
11. **The rail**: "Ny fråga" as the primary button, the Hem row's badge "2 i dag" when something is due, a plain count
    otherwise and "lugnt" when nothing needs the person, the conversations under "I dag" and "I går" without times.
12. **The conversation** (artboard G): the assistant's turn names itself and what it read ("Assistenten · läste Mitt
    team") with the sparkle; "Stäng samtalet" carries its ✕ after the words; the box says "Det här samtalet · Ny fråga i
    stället", without the keyboard shortcut. The transcript, its header and the box take the width Hem's content has,
    40 px in from the rail, not the 800 px centred column of D31 (the product owner, 2026-11-06, with the two pages
    side by side: "The chat content is narrower than startpage. This need to be the same").
13. **A view as a page** (artboard I): the view's name at 20 px with its source under it at the start of the line and
    the view's own search (240 px, its label hidden) and its choice as a `Selector` at the end; the table in a bordered
    `Card`; the page 32 px in from the rail, at the width the rail leaves. The `SegmentedControl` of D38 is gone from the
    view's controls in the panel too.
14. **The open panel folds away.** Beside the page the panel (a card, a view, a card's read) is Astryx's resizable
    region: a `ResizeHandle` on its inner edge, `useResizable` with `collapsible`, the width remembered per browser
    (`clew-panel-width`), the fold not remembered so a thing opened later is seen. One icon button folds it and brings
    it back: it stands in the `end` slot on the handle's content side, at the top (`IconButton` in a `VStack`,
    chevrons right as "Fäll ihop panelen", chevrons left as "Visa panelen"), so it rides the panel's edge to the
    window's top right corner when the panel folds and back out with it (the product owner, 2026-11-06 afternoon: "an
    icon at top right corner … that animates in and out with the sidebar panel as a handle", after a first build had
    put "Fäll ihop panelen" in the panel's header and "Visa panelen" among the page's own buttons). Folding with a
    card or a view open lets go of it as ✕ does (the product owner, the same afternoon: "closing the sidebar does not
    clear the selection"): the row stops saying "öppet bredvid", the box asks nothing, and the focus goes back to what
    opened it; folding the resting panel keeps the focus on the button, which now says the way back; expanding puts
    the focus on the panel's heading; every move is spoken. The card's token in the box carries Astryx's `Token` X,
    which lets go of the card as "Ny fråga i stället" does. The product owner asked for the fold on 2026-11-06, first for the open panel
    alone, then, with a picture of Hem with nothing open and no sidebar to open, for the resting day column too: at
    rest the panel holds I dag and Sedan i går with the same handle and fold button, so at 1440 px the box ends at the
    panel's edge rather than spanning the width as artboard A draws it.
    **Revised 2026-11-06, the same evening: folding hides and nothing more.** The product owner saw that ✕ closed one
    thing, that the fold was the only way to close all, and that it threw the open cards away ("if I click the arrow
    the sidebar resets, is that what you'd expect?"): a layout act carried a state act. The fold now keeps the tabs,
    the current thing and the address, so the row keeps saying "öppet bredvid" and the box keeps its token; the focus
    stays on the button, which says the way back, and showing the panel again puts it on the panel's start. A thing
    opened while the panel is folded still shows it; a closed tab's neighbour taking its place does not. Letting go
    of everything is [D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md) item 3's Stäng alla. Not on the canvas; the departure is this
    item's.
    **Revised 2026-11-10: the button floats, it has no column.** The `VStack` in the `end` slot was a row item, so it
    stood the height of the page, 44 px wide, for one 28 px button, between the page's scrollbar and the handle, open
    and folded alike (the product owner, with the column marked in the inspector: "why does the handle now render in a
    full vertical box"). A first change put the button in the panel's header while the panel was open and kept the
    strip only while it was folded; the product owner's answer was "I want the button to float to the left of the
    sidebar". The button is now an Astryx layer (`useLayer`, context mode, `placement: 'start'`,
    `alignment: 'start'`, 20 px off the handle) anchored to the `ResizeHandle`: a manual popover in the top layer,
    so it takes no width from the page or the panel, follows the handle as the panel is dragged or folded, and is at
    the window's top right corner when the panel has no width. It is one button in both states, so folding keeps the
    focus on it as before; its place in the document is still before the handle, so the tab order is unchanged; it
    has no light dismiss and no Esc. Its first place, 4 px off the handle at the height of the panel's header, lay
    over the top of the page's scrollbar wherever a scrollbar takes space (a mouse on macOS, Windows; the product
    owner the same day: "The icon is on top of the scrollbar"). **Astryx gap:** nothing in Astryx says how wide the
    page's scrollbar is or whether the page has one, and measuring it by hand is not Clew's to write. So the button
    stands where neither can matter: 20 px in from the handle, clear of a 15 to 17 px scrollbar, and 4 px down, inside
    the 32 px every page keeps free above its header ([D74](D74-one-page-header-for-every-surface.md)), so it lies over no content whether or
    not the page scrolls. `PANEL_EDGE` is
    the handle's 1 px alone, so [D72](D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md)'s three-track breakpoint is 256 + 1088 + 1 + 440 = 1785 px, not 1829.
    `tests/a11y/todo.spec.ts` asserts that the button is outside the panel, 18 to 24 px from its edge, above Hem's
    heading and inside an open popover.
    **Revised 2026-11-11: the handle is there only while the panel is shown, and nothing slides.** The product owner
    saw a horizontal scrollbar at the foot of Hem. A folded region's `ResizeHandle` stood on the window's edge, and
    Astryx keeps the whole 16 px grab zone for a folded region, centred on the handle's 1 px line, so 8 px of it lay
    past the edge and the shell's main area scrolled sideways by those 8 px wherever the panel fits beside the page.
    **Astryx gap:** `ResizeHandle` has no documented way to keep its grab zone inside the region's container, so a
    collapsible region in the `end` slot cannot rest folded on the edge of a scrolling container. Nothing custom is
    written around it: the handle is now rendered only while the panel is shown, as Astryx's `ai-chat` template mounts
    its handle with the open panel, and the folded panel is a plain `LayoutPanel` of no width that the fold button's
    layer is anchored to (21 px off the panel, the same pixels as 20 px off the handle). The region's slide went
    with the handle: opening, folding, showing and closing now land in one frame, the page, the panel, the handle and
    the button together. Before, measured frame by frame, the page and the panel's content took their final place
    in one frame and the handle and the button then travelled the panel's width on their own, and on a fold the
    content was gone before the emptied surface slid away. Whether the panel should move at all, and as what, is the
    product owner's to choose ([review](../reviews/2026-11-11-the-panel-beside-the-page-against-what-astryx-ships.md),
    [open questions](../maintainers/open-questions.md)). `tests/a11y/todo.spec.ts` asserts that the main area is no
    wider inside than it shows at rest, shown empty, with a card and folded, and that the handle is there only while
    the panel is.
15. **The tints** are tokens: `--color-background-red` and `--color-border-red` take the artboard's faint red and
    red border, `--color-background-green` and `--color-border-green` its faint green, in the light appearance; the dark
    appearance keeps Neutral's values.

**Astryx gaps** (recorded here, not styled around):

- The font: the artboards are drawn in Inter, Astryx Neutral in Figtree. Every glyph differs by that.
- The rail is 260 px (Astryx's `SideNav`) against the artboard's 272, so everything to the right sits 12 px further left.
- Sizes off the 4 px scale: the content's 28 px top padding (24 built), the box's 12/14 px padding, the rows' 14 px
  block padding (12), the tiles' 26 px figure (24.2), the section headings' 16 px (16.8).
- A `Badge` is 20 px high at 13 px/500 against the artboard's 22 px at 12 px/600.
- The panel's name "KORT" in small capitals: drawn as "Kort" in the secondary colour.
- The gap row's dashed divider in I dag: `Divider` has no dashed variant.
- The circled check of Lugnt läge: drawn as an `Icon` without the circle.
- A `TabList` with `role="tablist"` holds only tabs (D53), so the filter stands beside the strip with one `Divider`
  under both.
- The phone's top bar: Astryx's `AppShell` puts the menu button at the end; the artboard draws it at the start.
- `useAnimatedLayout` reaches `Collapsible`, `TreeList` and a `Table`'s row expansion only; the tabs' rows, the panel
  taking the side column's place and "Menar du" growing under the box change at once.

**Asked and answered** (twelve questions put to the product owner on 2026-11-06, listed in the review): Läget left out
until D54 (item 8); Sedan i går as sentences; no ⋯ on a row; no attention tip; the meeting's link built (item 10); nothing
at the end of the person's row; one time action in the panel's header (D49); the phone waits for a schedule and a balance
read and gets no chips; the panel's tabs (built 2026-11-06 as [D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)), the "något hände" divider and dot (H), the job across three connectors (J) and
the phone sheet's tabs (K) left for later; the captions kept; "Vad jag bevakar" left out. "Förberedelsen är klar" on a
meeting and "Avtalet Skanska 2025 · 2 träffar" on a pushed card have nothing to read from and are not drawn.

**Why.** The product owner reviewed Hem as built under D53 and found the structure right and the pixels not. The canvas
is the reference for every screen (CLAUDE.md); a drawing the product owner chose is the specification, and a built page
that differs from it in a dozen small ways is a different page. Weighed and left: keeping the 15 px base of D48 (the
drawing is 14 and the product owner approved the drawing); theming Astryx's heading sizes to the drawing's exact pixels
(a theme override of a component's size would reach every page, including those not on this canvas, and the scale
token is what Astryx offers); a `SideNav` width through its resize handle (adds a control the drawing does not have).

**Replaces.** [D48](D48-one-next-step-the-rest-one-step-away.md) item 1 (base 15), item 3 (⋯ on a row; a card keeps
it), item 5's captions (the artboards draw them) and item 6's secondary "Nytt samtal"; item 7's shortcut in the box.
[D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md) item 2 (the display heading and
the day under it), item 6 (the resting panel: the day and Sedan i går are cards in the page's own side column, and
their rows are the artboard's sentences), and the Astryx note on the tab strip, which stands. [D41](D41-the-landing-is-the-ai-chat-landing-template-with-the-persons-areas-under-the-box.md)
items 3 to 5 (the areas as toggles with their standing actions as cards) are gone from the page. [D34](D34-the-box-is-the-page-and-the-push-is-its-brief.md)'s
group order (Senare before Jag föreslår). D49, D50 and D54 stand.

**Amended 2026-11-07 by [D72](D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md).** Item 3's resting
panel is gone: I dag and Sedan i går are Hem's own at every width, the third track under the box from 1024 px while
nothing is open, and the panel exists only while a card, a view or a card's read is open. Item 14's fold at rest goes
with it; the fold of the open panel stands.

**Amended 2026-11-07: the dark tints.** Item 15's dark half no longer keeps Neutral's values. Neutral's dark tints
(step 25 of its dark red and green) read as brown and green-brown on the dark ground, and held the meta line's secondary
text at 4.3:1 on the red card and 4.1:1 on the green, under WCAG's 4.5:1. The dark appearance now takes the quiet tint
from Neutral's own dark palette (`neutralPalettes` in `packages/ui/src/theme.ts`): step 15 for the ground (`#3d1917`
red, `#192b19` green; the secondary text 5.8:1 and 5.6:1) and step 40 for the border (`#92423e`, `#436a43`). The red
badge ("i dag", "försenad", "Påminnelse", "behöver dig") had Neutral's dark error, a salmon with dark text as light as
the info blue (relative luminance 0.34 both), so the two told apart by hue alone; the dark `--color-error` is now step 50
of Neutral's dark red (`#be4e49`) with white text as in the light appearance (4.8:1; luminance 0.17 against info 0.34
and warning 0.66; at least 3.1:1 as a mark on the dark grounds). The light appearance is unchanged.

**Amended 2026-11-07 by [D74](D74-one-page-header-for-every-surface.md).** Item 2's lead is the page header every
surface opens with, `PageHeader`: the sparkle before "Hej Hillevi" and the day, the week and the unit at the end of its
line (under it in supporting on a phone). The 40 px of items 2 and 12 are now 32: Hem's title, a conversation's title,
its transcript and its box stand 32 px in from the rail and the title 32 px down, like every other surface.
