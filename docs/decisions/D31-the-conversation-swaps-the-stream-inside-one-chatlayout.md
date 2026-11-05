# D31 · The conversation swaps the stream inside one ChatLayout; chips live in the composer drawer

**Status:** accepted; the panel beside the column and a conversation asked on any page are [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) · **Date:** 2026-11-04 · **Area:** ui

**Decision.** The start page is composed the way Astryx's own `ai-chat` template is, and nothing about the
composer's placement is written by the project:

1. The page is `AppShell` (one shell shared with Administration and the calendar: `TopNav` for identity and
   the way out, `SideNav` for the areas and Kommande) → `Layout contentWidth={800}` → `ChatLayout`. The
   composer is the `ChatLayout` `composer` slot, docked by Astryx with its frosted layer and scroll-to-bottom
   button, never by a class, an inline style, a `ResizeObserver` or a media query in project code. Amended
   2026-11-04: the `ChatLayout` sits full bleed in the `LayoutContent` (`padding={0}`) and owns the scroll, so
   its scrollbar is at the window's edge like a page's, and its `spacious` density is what centres the stream
   and the dock to one 800 px column; the product owner asked for the scrollbar at the edge. Delegating the
   scroll to `LayoutContent` through `scrollRef` was tried and rejected: in that mode Astryx fixes the dock to
   the viewport, across the sidebar.
2. Opening a conversation (`/samtal/:id`, or the first send) replaces the stream with a `ChatMessageList` as
   the `ChatLayout` children; Esc, "Stäng samtalet" or the back button restores the stream. The conversation
   title and its actions sit in the content `Layout`'s `header` slot. There is no `Overlay` scrim, no card above
   the composer and no project-drawn ring on a chipped card: a chipped row is `ListItem isSelected`, a chipped
   card is `Card elevation="low"` with `aria-current`.
3. Chipped objects are `Token`s with `onRemove` in `ChatComposerDrawer` ("Objekt i samtalet"), and tokens in
   the field through the `@` trigger as before. The "Om n saker" header line goes; the drawer's count says it.
4. Assistant answers render through `Markdown`. A proposal to confirm is plain content in a ghost bubble
   (one `Badge variant="warning"` "Att bekräfta", a decimal `List`, two buttons), never a `Card` in a bubble.
5. The three piles (D28) sit in the content `Layout`'s header slot as a `Toolbar`, pinned above the column, on every
   width: on a desktop as the `ToggleButtonGroup`, on a phone as a `DropdownMenu presentation="adaptive"` whose
   items navigate, because the group never wraps and three labels do not fit 320 px. They are not on the dock:
   `ChatLayout`'s frosted band is sized for one composer, and a second row there floats over the cards (verified in
   the a11y harness 2026-11-04).
6. `packages/ui/src/styles.css` holds the four Astryx `@import`s and two body rules. Anything else needs a
   decision that names the gap.
7. Below 480 px of viewport height the composer, the piles and the transcript render in page flow through
   `useMediaQuery` (the responsive guide's "swap"), because `ChatLayout` has no undocked mode.
8. Contingency for WCAG 2.4.11: `ChatLayout`'s dock is sticky and the component sets no scroll padding, so a
   control the browser scrolls to the bottom edge can land under the dock. If the focus walk in `tests/a11y`
   finds a stop under the dock, one static `scroll-padding-bottom` on the `ChatLayout` root is tolerated and
   recorded here with its value; nothing else.

Known Astryx gaps this decision lives with (recorded here, not filed; the product owner decided 2026-11-04
that Clew sends no gap reports): no scroll padding under the dock (item 8); `ChatLayout`'s external-scroll
mode fixes the dock to the viewport, not to its own column, and its only centred width is the `spacious`
800 px (item 1); no undocked mode (item 7); no
header slot in `ChatLayout` (the content `Layout` header is used); the dock's blur layer is sized for one
composer (verified; the piles went to the toolbar); `ScrollableArea` has no max-height; `SelectableCard` is a
checkbox, so a single choice between two cards is a `RadioList` or two `ClickableCard`s; no dashed or ghost
`Card`/`Token` variant; `Card` has no selected state tied to `aria-current`; `SideNavItem` has no description
line; `Token` labels cannot wrap; `ChatComposerInputHandle` has no `removeToken` (the drawer's remove resets
the value and re-inserts the remaining tokens).

**Why.** The review `docs/reviews/2026-11-04-astryx-adoption-against-the-templates.md`: the floating composer
was twenty-five lines of layout CSS copying `ChatLayout`, the conversation was a card in a bubble in a card,
and the chipped-card ring was a project box-shadow; every one of those has an Astryx answer the `ai-chat` and
`ai-chat-landing` templates use. The product owner chose the transcript-in-page-flow model over keeping the
overlay with Astryx parts on 2026-11-04, because the overlay was a composition no template uses and the
CLAUDE.md rule now reads "never rebuild what Astryx ships".

**Replaces.** D13 (superseded by this decision: the conversation is no longer a drawer over a dimmed stream).
Narrows D12: "chips sit above the input, removable" is now literally the composer drawer, and "the chipped
object is highlighted where it is" is the Astryx selected state, not a ring. Amends HANDOVER §6: the sentence
"the conversation is an overlay that unfolds from the composer row over the dimmed stream" is withdrawn; "the
row keeps focus throughout; sending never moves it" stays.

**Amended 2026-11-05 by D36.** The transcript takes the column the moment a question is sent: the question is drawn at
once and its answer streams in under it. The box keeps the focus and stays open while the answer is written (Stoppa
in place of send, Enter held back) instead of resting greyed.
