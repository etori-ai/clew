# D63 · Hem is drawn as the canvas draws it, pixel for pixel, with Astryx's own tokens

**Status:** accepted, built 2026-11-06 on `main`; the elements the artboards draw without anything behind them are listed under "Asked, not built" and wait for the product owner · **Date:** 2026-11-06 · **Area:** ui

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
3. **Two columns under the box** (`Grid columns={3}` with the day's work in a `GridSpan` of two and the side column in
   the third track, 32 px apart; a `VStack` under 1024 px and on a phone). Beside the column stand two cards: **I dag**,
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
   secondary heading, the card's one time action (D49) in the panel's header beside ✕ (`CardTimeAction`). The state
   line (the "i dag" badge, the area and the source), the title at 20 px, the lead sentence, the rows in a bordered card
   with the label in semibold and the detail under it, the buttons at 36 px ("Attestera 2 valda", the secondary
   actions, "Lägg till i samtalet", ⋯ with Avfärda), one line on what the next step does ("… skrivs till
   ekonomisystemet och läses tillbaka som kvitto. Ångra i 10 minuter. Fungerar utan modellen."), and "Varför nu?" and
   "Historik" as `Collapsible`s in cards, gliding with Astryx's `useAnimatedLayout`.
8. **Läget**: the label with its `StatusDot` at the end of the line, the figure, and one line with the status word and
   the comparison, or the bar where the figure is a count. Two tiles a row beside the panel and on a phone.
9. **The quiet page** (artboard B): a green-tinted card, "Lugnt läge", one sentence with the sources, what waits and the
   next review, and the links "2 väntar på andra" and "1 klar i dag"; under it **Det du kan göra** with its caption, the
   areas as toggles with the first chosen, and the chosen area's standing actions as muted cards in three columns. With
   work on Hem the areas are not drawn (the product owner, 2026-11-06: "the design doesn't have these").
10. **The rail**: "Ny fråga" as the primary button, the Hem row's badge "2 i dag" when something is due, a plain count
    otherwise and "lugnt" when nothing needs the person, the conversations under "I dag" and "I går" without times.
11. **The conversation** (artboard G): the assistant's turn names itself and what it read ("Assistenten · läste Mitt
    team") with the sparkle; "Stäng samtalet" carries its ✕ after the words; the box says "Det här samtalet · Ny fråga i
    stället", without the keyboard shortcut. The transcript, its header and the box take the width Hem's content has,
    40 px in from the rail, not the 800 px centred column of D31 (the product owner, 2026-11-06, with the two pages
    side by side: "The chat content is narrower than startpage. This need to be the same").
12. **A view as a page** (artboard I): the view's name at 20 px with its source under it at the start of the line and
    the view's own search (240 px, its label hidden) and its choice as a `Selector` at the end; the table in a bordered
    `Card`; the page 32 px in from the rail, at the width the rail leaves. The `SegmentedControl` of D38 is gone from the
    view's controls in the panel too.
13. **The tints** are tokens: `--color-background-red` and `--color-border-red` take the artboard's faint red and
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

**Asked, not built** (each put to the product owner on 2026-11-06, listed in the review): Läget's tiles from the
connectors (D54), "underlaget ligger i samtalet" and "förberedelsen är klar" on a meeting, the green dot on an older
conversation and the "något hände" divider (H), the panel's tabs (F, H, J, K), the job across three connectors (J), the
phone's shift strip, balance card and chips (D), "Avtalet Skanska 2025 · 2 träffar" on a pushed card (E), "Vad jag
bevakar" (B), and a role word on the person's row.

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
items 3 to 5 now apply to the quiet page only, with the first area chosen. [D34](D34-the-box-is-the-page-and-the-push-is-its-brief.md)'s
group order (Senare before Jag föreslår). D49, D50 and D54 stand.
