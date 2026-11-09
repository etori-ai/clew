# D92 · What goes into the box enters on Astryx's entry motion

**Status:** accepted, built 2026-11-09 on `main` · **Date:** 2026-11-09 · **Area:** ui

**Decision.** Pressing "Lägg till i samtalet" on a card, a row, a source or a meeting changes four things in one
frame: the button's `@` becomes a check, the drawer appears above the field, the chip appears in it and the verbs
about the card appear in the footer, with the field taking the focus from the same click. From now on each of them
enters instead of popping, on Astryx's own entry motion and nothing else:

1. The drawer (`ChatComposerDrawer`) slides down the first time it appears (`useEntryAnimation('slideDown')`).
2. A chip (`Token`) scales in when it is added (`useEntryAnimation('scaleIn')`), the same motion as the
   completion check of [D70](D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md).
3. The verb row's buttons fade in (`useEntryAnimation('fadeIn')`), the motion of
   [D76](D76-loading-sections-reserve-their-place-and-enter-together.md)'s loaded sections.
4. The check on the icon button (`AddToConversation`) scales in, so the card and the box say "done" with one
   movement. The desktop card's text button ("I samtalet") changes its words as before and draws no check.
5. A screen reader hears what the eye sees enter: a visually hidden `role="status"` in the box says
   "<the chip's name> är med i samtalet" once, when a chip is added. Removing a chip stays silent; its own button
   and the focus rule of 2.4.3 already say what happened.
6. The column fades in when it changes hands (added the same day, when the product owner found the swap from Hem
   to the conversation as abrupt): the conversation taking Hem's place when a question is sent, and Hem coming back
   when the conversation closes, one `useEntryAnimation('fadeIn')` over the whole column as
   [D76](D76-loading-sections-reserve-their-place-and-enter-together.md) fades a loaded section. `Entering` in
   `apps/web/src/pages/start.tsx` is keyed by whose turn it is, so each hand-over mounts anew; the page's first paint
   does not animate. The question bubble and the pending answer are inside the fade, so the transcript arrives as one
   thing, and the box keeps the focus throughout ([D36](D36-an-answer-is-drawn-as-it-is-written.md)).

Nothing is slowed down: the motion runs alongside the focus move and never blocks the next action. Chips and
drawers that are on the page from the first paint do not animate (the hook only fires on a late mount). Reduced
motion is the library's: the element is there at once. The wrappers (`Drawer`, `Chip`, `Verb` in
`apps/web/src/components/composer.tsx`, `AddedCheck` in `add-to-conversation.tsx`) pass the hook's style through
`xstyle`; no custom CSS, timer, animation library or stagger is introduced, so no Astryx gap is recorded.

**Why.** The product owner (2026-11-09) added a card to the box from Startsidan and found the change too fast to
follow: the card is in the column or the panel and the box at the foot of the page, and nothing led the eye from
one to the other. Astryx's motion foundation names this case ("elements entering the screen", "moments where the
user needs to understand what happened") and warns against adding duration to the click itself. `useAnimatedLayout`
was considered and does not apply: it glides `Collapsible`, `TreeList` and table rows only
([D63](D63-hem-is-drawn-as-the-canvas-draws-it.md)), not a composer growing to take its drawer. Flying the chip from
the card to the box with `useAnimator` was rejected: choreography the canvas does not draw, easy to get wrong, and
more than the moment needs.

**Evidence.** `tests/a11y/card-actions.spec.ts`: the chip enters the drawer with an animation under
`no-preference` and with none under `reduce`, the field has the focus, and the status says the chip's name.
`tests/a11y/answer.spec.ts`: Hem's first paint is not animated, the conversation's column is under `no-preference`
and not under `reduce`, and so is Hem when the conversation closes.

**Replaces.** Nothing. Extends [D12](D12-objects-chips-proposals.md)'s chips and [D31](D31-the-conversation-swaps-the-stream-inside-one-chatlayout.md)'s
drawer with their entrance; [D70](D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md)
and [D76](D76-loading-sections-reserve-their-place-and-enter-together.md) stand as the precedents for the motion.
