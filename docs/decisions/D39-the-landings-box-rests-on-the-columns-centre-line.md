# D39 · The landing's box rests on the column's centre line when what is above it fits

**Status:** accepted, built 2026-11-05; replaced by [D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md) on 2026-11-06: the brief is gone and the box is anchored under the greeting · **Date:** 2026-11-05 · **Area:** ui

**Decision.** On the landing (`/`, `apps/web/src/pages/start.tsx`) the box is centred vertically whenever that is
possible, and it still never moves while the person types (D36).

1. **The brief and the box are one block that is at least half the column high.** The block is a `VStack` with
   `minHeight="50%"` and `vAlign="between"`, a direct child of the `LayoutContent` that scrolls: the greeting line
   and the brief at its top, the heading and the box at its lower edge. With no cards, or with a brief short enough
   for the upper half, the box's lower edge is on the column's centre line. A brief too long for the half makes the
   block as tall as it needs, and the box follows the brief as before.
2. **Everything that changes under the box comes after that block.** "Menar du", the chips and their line are a
   second `VStack` in the flow. Their height never enters the first block's, so nothing under the box moves it.
   The distances are the ones the flow had: "Menar du" one step under the box, the chips two steps under whichever
   ends above them.
3. **The day line is the `Layout`'s footer.** "I dag · …" with "Hela veckan" sits in `LayoutFooter` (no divider of its
   own; the line keeps its `Divider` on the 760 px column). It was the last item of a stack stretched to the column's
   height; as a footer it stays at the foot without a second minimum height under the box, which would have given the
   page a scrollbar whenever the brief was longer than the upper half. When the content is longer than the window the
   day line stays in view and the content scrolls above it.
4. **A phone and a short screen are unchanged.** On a phone the box is docked in the footer and the content is one
   flow from the top. With 480 px or less in height nothing is docked and the page is one flow that ends with the
   day line (1.4.10).
5. **While the cards load** the brief's skeleton stands in the same block, so on a window where the brief fits the
   upper half the box is in the same place before and after the read.

Astryx only: `VStack` `minHeight` and `vAlign`, `Layout` `footer`, `LayoutFooter`. No style, no measuring, no reserved
height. Tests: `tests/a11y/answer.spec.ts` (with no cards the box's block ends on the middle of the column, the column
does not scroll, "Menar du" does not move the box, axe; with a full brief no scrollbar at 1280 × 800, and at 600 px
in height the box follows the brief, below the line).

**Why.** The product owner asked for it on 2026-11-05: with nothing above it the box sat at the top of an otherwise
empty page. D36 had taken the centring away because of how it was done, a stack that spread its items over the
column's height, so the box moved by half of every change in what stood under it. Weighed and left:

- Centring the whole group as Astryx's `ai-chat-landing` template does (`vAlign="center"`): the template's box moves
  when its suggestion cards appear, which is the jump D36 removed.
- `StackItem size="fill"` above and under the box: it is `flex-grow: 1` on the items' own heights, so the two halves
  are not equal and the box moves by half of what "Menar du" adds.
- Centring only when the brief is empty: the box would jump once on every first read, from under the skeleton to the
  middle. One rule for every brief keeps it still.
- A second block of at least half the height under the box, with the day line at its foot: a brief longer than the
  upper half then makes the page taller than the window with nothing to scroll to.
- A height in viewport units: the column is not the viewport once a banner is shown.

**Replaces.** Amends D36 and D34 as amended by D36 ("the landing's box is anchored from the top with the brief, and
only the day line is pushed to the foot"). D36's rule that the box never moves under the cursor stands.
