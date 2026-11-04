# D31 · The conversation swaps the stream inside one ChatLayout; chips live in the composer drawer

**Status:** proposed · **Date:** 2026-11-04 · **Area:** ui

**Decision.** The start page is composed the way Astryx's own `ai-chat` template is, and nothing about the
composer's placement is written by the project:

1. The page is `AppShell` (one shell shared with Administration and the calendar: `TopNav` for identity and
   the way out, `SideNav` for the areas and Kommande) → `Layout contentWidth={960}` → `ChatLayout`. The
   composer is the `ChatLayout` `composer` slot, docked by Astryx with its frosted layer and scroll-to-bottom
   button, never by a class, an inline style, a `ResizeObserver` or a media query in project code.
2. Opening a conversation (`/samtal/:id`, or the first send) replaces the stream with a `ChatMessageList` as
   the `ChatLayout` children; Esc, "Stäng samtalet" or the back button restores the stream. The conversation
   title and its actions sit in the content `Layout`'s `header` slot. There is no `Overlay` scrim, no card above
   the composer and no project-drawn ring on a chipped card: a chipped row is `ListItem isSelected`, a chipped
   card is `Card elevation="low"` with `aria-current`.
3. Chipped objects are `Token`s with `onRemove` in `ChatComposerDrawer` ("Objekt i samtalet"), and tokens in
   the field through the `@` trigger as before. The "Om n saker" header line goes; the drawer's count says it.
4. Assistant answers render through `Markdown`. A proposal to confirm is plain content in a ghost bubble
   (one `Badge variant="warning"` "Att bekräfta", a decimal `List`, two buttons), never a `Card` in a bubble.
5. The three piles (D28) sit in the composer slot above the `ChatComposer` on every width: on a desktop as the
   `ToggleButtonGroup`, on a phone as a `DropdownMenu presentation="adaptive"` whose items navigate, because the
   group never wraps and three labels do not fit 320 px.
6. `packages/ui/src/styles.css` holds the four Astryx `@import`s and two body rules. Anything else needs a
   decision that names the gap.
7. Below 480 px of viewport height the composer, the piles and the transcript render in page flow through
   `useMediaQuery` (the responsive guide's "swap"), because `ChatLayout` has no undocked mode.
8. Contingency for WCAG 2.4.11: `ChatLayout`'s dock is sticky and the component sets no scroll padding, so a
   control the browser scrolls to the bottom edge can land under the dock. If the focus walk in `tests/a11y`
   finds a stop under the dock, one static `scroll-padding-bottom` on the `ChatLayout` root is tolerated and
   recorded here with its value; nothing else.

Known Astryx gaps this decision lives with (recorded here, not filed; the product owner decided 2026-11-04
that Clew sends no gap reports): no scroll padding under the dock (item 8); no undocked mode (item 7); no
header slot in `ChatLayout` (the content `Layout` header is used); the dock's blur layer is sized for one
composer (the piles row is verified visually); `ScrollableArea` has no max-height; `SelectableCard` is a
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
