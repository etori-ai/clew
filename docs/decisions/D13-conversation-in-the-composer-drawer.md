# D13 · The conversation lives in the composer's drawer; the dim is an Astryx Overlay

**Status:** accepted · **Date:** 2026-11-03 · **Area:** ui

**Decision.** The conversation overlay described in D12 and `integrations.md` ("unfolds upward from the composer
row over the dimmed stream") is built with two Astryx components and no custom CSS: the grouped focus list and the
conversation render in `ChatComposer`'s `drawer` slot (`ChatComposerDrawer` with a `ScrollableArea` budget), so
they unfold from the row inside the same rounded surface and the row keeps focus; the stream is wrapped in
`Overlay` with a light scrim while the row is open, and a click on the scrim or Esc closes it. The side panel
(`Drawer`) and the row are outside the overlay and stay live. Chips are tokens in the field
(`ChatComposerInput` triggers), never a separate row.

**Why.** The Astryx-only rule (CLAUDE.md) leaves no room for a hand-made floating surface, and Astryx has no
"popover over a region" primitive; the drawer slot is the component's own place for context above the input. A
programmatic token insert does not emit `onChange`, so the composer reads the serialized draft back after inserting
and re-inserts chips after a turn (an external value clears the field). Known limit: `ScrollableArea` has no
max-height, so the drawer has a fixed height budget.

**Replaces.** Nothing; implements D9's "the conversation is never in the panel" and D12.
