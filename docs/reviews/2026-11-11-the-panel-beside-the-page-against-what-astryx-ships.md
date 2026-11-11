# Review: the panel beside the page against what Astryx ships · 2026-11-11

Status: a comparison with a recommendation. The choice between the options is the product owner's and is listed in
[open questions](../maintainers/open-questions.md). One change was made the same day because it fixed a defect
([D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14, revised 2026-11-11); nothing else is built.

## What was reported

The product owner, on Hem at 1720 px, signed in: opening a card opens the panel beside the page; "the animation
looks bad", the panel's handle is small and "does not follow the panel well while it animates", and "there must be a
better UI pattern for accomplishing this". The same day a horizontal scrollbar stood at the foot of Hem.

## What was measured

Positions were sampled every frame in the mocked browser suite (Astryx 0.7.12, 1720 and 1440 px wide), before any
change.

| Moment | What moved |
|---|---|
| A card is opened, or the folded panel is shown | In one frame Hem's column takes its narrow width, the day and Sedan i går move from beside the work to under it, and the panel's content stands at its final place. About 150 ms later the handle and the fold button, 48 px to its left, travel the panel's 440 px from the window's edge to the panel's edge on their own, over some 250 ms. |
| The panel is folded, or the last thing is closed | In one frame the panel's content is gone and Hem's column is wide again. The handle and the button then travel back across the page's own content, and the emptied panel gives up its width when they arrive. |
| At rest, folded | The handle stands on the window's edge. Its grab zone is 16 px wide, centred on the handle's 1 px line, so 8 px lie past the edge and the shell's main area scrolls sideways by 8 px. |

Two of these are Clew's own doing: the panel's content is drawn from Clew's `collapsed` state, so it is unmounted
before the region has slid away, and Hem changes its grid from three tracks to one in the same commit. The third is
how the region's slide is built: the panel is revealed in place while the page beside it has already reflowed, so the
handle is the only thing that travels.

## What Astryx ships

Read with `bunx astryx search`, `bunx astryx template --list`, `bunx astryx docs layout/side-panels`,
`bunx astryx component` for `LayoutPanel`, `ResizeHandle` and `Drawer`, `bunx astryx hook useResizable`, the
`ai-chat` template and the `ResizableSidebar` block.

| Pattern | Where | How it opens and closes | Handle | Motion |
|---|---|---|---|---|
| A docked panel that is always there | `docs layout/side-panels` | It does not: "Render an EmptyState when nothing is selected, so the region never collapses" | `ResizeHandle` before a panel in the `end` slot, `isReversed` | None |
| A docked panel that comes with what was opened | The `ai-chat` template (the artifact beside the transcript) | The handle and the panel are mounted while something is open and unmounted on ✕; the thing in the page opens it again | Only while the panel is open | None |
| A collapsible region | `useResizable({ collapsible })`, the `ResizableSidebar` block | Dragged past its minimum it folds; an ordinary button in the content calls `expand()` | Stays on the edge while folded; the block is a start-side panel inside a card | The panel "slides closed and open from the edge facing its ResizeHandle" |
| A side surface over the page | `Drawer`, `hasScrim={false}` "for master-detail flows" | `isOpen`; ✕ and Esc | None, not resizable | Astryx's own slide in and out, reduced motion respected; it "overlays the layout instead of reflowing it" |

Astryx has no fold button for a panel, no layer anchored to a handle, and no template in which a docked panel rests
folded with nothing open.

## How Clew composes it

`apps/web/src/components/panel.tsx` combined the second and third patterns and added two things of its own, each at
the product owner's request ([D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14,
[D72](../decisions/D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md) revised 2026-11-10): a fold
button in a `useLayer` popover anchored to the handle, and a panel that rests folded, with its handle, while nothing
is open. Each piece is an Astryx component; the combination is not one Astryx ships, and the two defects come from
it. The slide carries a handle and a button across a page that has already changed, and a folded handle on the
window's edge overflows.

**Astryx gap.** `ResizeHandle` has no documented way to keep its grab zone inside the region's container ("a collapsed
pane, or one at 0px, has nothing to protect and keeps the whole zone"), so a collapsible region in the `end` slot
cannot rest folded on the edge of a scrolling container without making it scroll. A start-side region overflows to
the left, where nothing scrolls, which is why the block does not show it. Recorded in D63 item 14; not filed.

## What was changed

The handle is rendered only while the panel is shown, as the `ai-chat` template has it, and the folded panel is a
plain `LayoutPanel` of no width for the fold button's layer to stand beside. The sideways scroll is gone. The
region's slide went with the handle, since the region finds its panel through it: every transition now lands in one
frame, the page, the panel, the handle and the button together, and the button stands on the same pixels as before.
The fold button, the empty panel, the tabs, the focus rules and the announcements are unchanged.

## Options

1. **In place, no motion** (as it stands). The `ai-chat` template's behaviour. Nothing travels and nothing is out of
   step. Astryx's motion guidance says a panel that appears at once can disorient; its own template does it anyway.
2. **The same, without the fold button and the empty panel.** The template in full: the panel is there while something
   is open, ✕ closes the current thing, Stäng alla closes all, a row opens its card again. It removes the one piece
   Astryx has no pattern for, and with it the layer, its offsets and the scrollbar caveat in D63. It takes back two
   things the product owner asked for: hiding the panel without closing what is in it, and a button that is always
   there.
3. **Astryx's non-modal `Drawer` where the panel is docked today.** The only side surface Astryx animates as a whole.
   Hem does not reflow, so the day stays beside the work. It lies over the page: at 1720 px it covers the day and
   Sedan i går almost exactly, and between 1336 and about 1700 px it would also cover the end of the rows, where
   their buttons are. It is not resizable and has no handle. It changes
   [D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md)'s "beside the
   column" to "over the page" and needs a decision of its own.
4. **The region's slide, composed as Astryx documents it.** The content kept mounted while the region slides and the
   grid left alone during it. It needs the handle on the edge while folded, so it brings the sideways scroll back
   until Astryx can keep a folded handle inside its container. Not available today without custom code.

## Recommendation

Keep option 1 now. It is the smallest composition that is Astryx's own and has neither defect. Then decide whether
the fold button still earns its place: with tabs, ✕ and Stäng alla, it does one thing, hide without closing, and it is
the part that needed a hand-placed layer. If it does not, take option 2. If motion matters more than resizing and
"beside", option 3 is the Astryx pattern for it and should be drawn on a canvas first, since it changes where the day
stands while a card is open.

On size: the grip is Astryx's 3 by 32 px pill and the fold button is an `IconButton` at `size="sm"` (28 px). The
button can be `md` (32 px) by a prop. The pill's size is a theme value (`resize-handle-pill`), which would change it
for every handle in the installation.

## Against the canvas

The canvas **Clew · dagen bredvid eller i spalten** ([D72](../decisions/D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md))
was read from its files. A1's note: at rest there is no panel, "inget handtag, ingen fällknapp". A2's note: when a
card is opened "panelen glider in från höger med kortet, och bara kortet", the day folds under the work, and "handtaget
och fällknappen hör till panelen, alltså till det öppnade". So the canvas has no handle at rest, which is how it
stands again, and no fold button at rest, which the product owner added on 2026-11-10. It also asks for a panel that
glides in. Option 1 has no glide and departs from A2 in that; before the change the glide was the handle's alone.
A glide of the whole panel is option 3 (a drawer, which does not fold the day under the work as A2 draws) or
option 4 (not available). That is the choice left open.

The canvas **Clew · att bli klar** ([D70](../decisions/D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md))
was read for the selection fix made the same day: artboard B says of a row's decision "Beslutet sparas som markering
på kortet", and its note that closing "behåller besluten som markering på kortet". A decision marks its row; a close
with no decision changes no mark ([D73](../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md),
amended 2026-11-11).

## Not verified

Measured in the mocked browser suite, not in a signed-in session, and not with a screen reader. The artboards were
read as source and notes, not rendered and compared pixel by pixel.
