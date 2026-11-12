# D72 · The day is the page's, and the panel holds only what was opened

**Status:** accepted, built 2026-11-07 on `main`; the breakpoints that count the rail to be replaced by [D115](D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md) (provisional, 2026-11-11; not built, so this record still binds what is built) · **Date:** 2026-11-07 · **Area:** ui

**Decision.** I dag and Sedan i går are Hem's own content and never the panel's. The panel
([D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) item 3) exists only while the
person holds something beside the column: a card, a view or a card's read. Nothing rests in it. The product owner
asked for this on 2026-11-07 ("I am not convinced about the decision about the sidebar 'idag' och 'sedan igår' should
share space with the opened sidebar views, I find it a bit confusing"), and chose direction A of the canvas
**Clew · dagen bredvid eller i spalten** (https://claude.ai/artifact/7XQKJ8PfcHAtp8QNQx7DXS, artboards A1, A2 and A3)
over B, C and D; the comparison is
[the day beside, or in the column](../reviews/2026-11-07-the-day-beside-or-in-the-column.md).

1. **At rest Hem has no panel** (artboard A1). From 1024 px the day and what happened since yesterday are the third
   track of the grid under the box, the day's work spanning two, as [D63](D63-hem-is-drawn-as-the-canvas-draws-it.md)
   item 3 already draws them between 1024 and 1336 px; under 1024 px and on a phone they end the page after the day's
   work, as before. There is no handle and no fold button while nothing is open, and the box spans the column as
   artboard A of the earlier canvas draws it. `usePanel` takes no `rest`.
2. **Opening something brings the panel in with that thing alone** (artboards A2 and A3). The panel is the
   `LayoutPanel` in the page's `end` slot, with its handle, its fold button and its tabs
   ([D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)), exactly as for an open card today.
   Where the rail, the day's work at its least width, the side column and the panel all fit (the window is at least
   `RAIL + HOME_MIN + ASIDE + PANEL` plus the gaps, about 1760 px) the three stand side by side: the work two tracks,
   the day one, the panel at the end. Narrower than that, the side column folds under the day's work as a
   `Grid columns={2}` with I dag and Sedan i går side by side; under 1024 px and on a phone it is the `VStack` it is at
   rest. What the person sees move is their own choice, never the page's content.
3. **Closing the last thing removes the panel**, and the day steps back up beside the work. The fold
   (D63 item 14, revised 2026-11-06 evening) applies to the open panel only: folding hides what was opened, and
   showing it brings it back; there is no fold at rest, since nothing rests.
4. **The side column keeps its landmark**: the `aside` named "Bredvid" with the regions "I dag" and "Sedan i går",
   wherever the layout places it, so the specs and a screen reader find the day in one place.
5. **The conversation is unchanged.** Asked from Hem, a conversation takes the column with what was open in the panel
   (D50 item 5); the day was never in its panel and still is not.

**Why.** D53 and D63 gave the panel something to rest on so that at 1440 px the day stood where a card would open.
Together with the fold at rest (D63 item 14) and the tabs of D66 that made one surface mean two things: sometimes
the page's own content, sometimes what the person had opened, with the same handle and button on both. Opening a card
replaced the day, and closing it brought the day back, as if the day were a tab that had been closed. The canvas drew
four ways out and three were left:

- **B, the day as a strip** under the box (a `DayStrip` from the calendar family, D32, and Sedan i går as one line):
  the day is always in view, but the artboard's two cards go, the gap's sentence and the figure lines have no room,
  and every screen gives up 120 px of the day's work to it.
- **C, the panel splits**: the card above, I dag and Sedan i går as two `Collapsible` rows at the panel's foot. Nothing
  moves, but the panel is still two things, a long card pushes the rows under the edge, and the surface still shares.
- **D, the day as the panel's first tab**: D66's menu gains a fixed first entry. The sharing becomes explicit, but it
  entrenches what confused: the day is not something the person opened, and it is still hidden while a card is open.

A is the one that gives each surface one job again (D50: "Every surface has one job"), is the layout the page already
draws between 1024 and 1336 px, and needs no new component.

**Astryx.** `Grid columns={3}` with `GridSpan columns={2}`, `Grid columns={2}`, `VStack`, `Layout` with `LayoutPanel`
in `end`, `useMediaQuery` on a window width computed from the shell's constants. Nothing custom and no new dependency.
The three-track breakpoint is a media query on the window, not a container query, for the same reason D50 gives.

**Replaces.** D63 item 3's resting panel ("Where the panel fits beside the column (1336 px and up) the day and Sedan i
går are the resting panel") and item 14's fold at rest; D53 item 6's resting `LayoutPanel` was already gone. D63 item
3's layouts under 1336 px stand and now apply at every width while nothing is open. D66 stands: its tabs hold only what
was opened, which is now all the panel holds.

**Tests.** `tests/a11y/todo.spec.ts`: at rest no complementary region "Kort" and no "Fäll ihop panelen" button, the
"Bredvid" aside with "I dag" visible beside the work; a card opened brings the panel with the fold button, and the
"Bredvid" aside is still on the page; the fold with a card open keeps the card (unchanged); closing the last card
removes the panel and leaves "Bredvid". `tests/a11y/screens.hem.spec.ts` keeps its screenshots of both states.

**Built.** `apps/web/src/components/panel.tsx`: `usePanel` takes no `rest` and draws nothing while nothing is open;
`RAIL` and `PANEL` are exported with a new `PANEL_EDGE` (45 px: the fold button's column, 4 + 28 + 12, and the 1 px
handle, measured in the browser). `apps/web/src/pages/start.tsx`: the "Bredvid" aside is always drawn; from 1024 px
Hem's work and day are one `Grid` whose tracks change with what is open (`columns={3}` with the work as
`GridSpan columns={2}` at rest and where all three fit, `columns={1}` with the aside's own `Grid columns={2}` under the
work otherwise), so opening or closing a card never remounts the row that opened it and the focus can go back to it;
under 1024 px and on a phone the `VStack` as before. The three-track breakpoint is
`panelBesideQuery(2 * PAGE_INLINE + 3 * TRACK + 2 * GRID_GAP + PANEL_EDGE)` with
`TRACK = max(ASIDE, (HOME_MIN - GRID_GAP) / 2) = max(320, 304) = 320`, `GRID_GAP = 32`, `PAGE_INLINE = 32` (40 until
D74 put Hem on every surface's 32 px gutter, the same day): RAIL 256 + 64 + 1024 + 45 + PANEL 440 = 1829 px (1845 with
40); `Grid columns={3}` draws equal tracks, so the side column's 320 px, not the work's 640, decides it. The rail Astryx
draws is 260 px, not the 256 `RAIL` says, so at 1829 to 1832 px the side column is a pixel or two under 320; `RAIL` is left as it is because `panelBesideQuery` (D50's 1336 px) uses it too.
`tests/a11y/todo.spec.ts` covers the rest, the open panel, the fold and the last close as the Tests paragraph says;
`tests/a11y/screens.hem.spec.ts` gains a screenshot at 1900 px with a card open (A3).

**Revised 2026-11-10: the panel's button is always there.** Item 1 said there is no handle and no fold button while
nothing is open, so ✕ on the last card took the button away with the panel (the product owner: "I guess the toggle
handle should always be visible. Now it only shows when a card is clicked. If I then press the X in sidebar it
disappears"). Asked what the button should do with nothing open, the product owner chose an empty panel over
reopening the last thing closed and over leaving item 1 as it was. Wherever the panel fits beside the page the handle
and the floating button ([D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14, revised the same day) are drawn
from the first load. At rest the panel is folded away and is no landmark, so Hem still stands as artboard A1 draws it,
with the day beside the day's work. "Visa panelen" shows it with the heading "Öppet bredvid" and an Astryx
`EmptyState` that says "Inget är öppet bredvid sidan"; the day then folds under the work as for an open card; the
button or Esc folds it again. Opening a card or a view shows the panel as before (never taking the focus from a field
the person is typing in), and closing the last thing folds it away and leaves the button. The day and Sedan i går
stay the page's: the panel still holds only what was opened, or says that nothing is. `usePanel` returns `occupied`
(something is open, or the empty panel is shown), which Hem reads instead of the `end` slot's presence to choose its
tracks. Under the width where the panel fits there is no button, as before: the panel is a drawer there.
`tests/a11y/todo.spec.ts` covers the button at rest, the empty panel, Esc and the last close.
