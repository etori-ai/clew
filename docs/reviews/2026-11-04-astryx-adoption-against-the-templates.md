# Review: how Clew composes Astryx, against Astryx's own templates (2026-11-04)

Question from the product owner: the pages have too many bad-looking elements and faulty grid layouts; are we using the components as intended?

Method: the start page, an area, Redan hanterat, the calendar page and the admin list were rendered through the a11y harness (mocked API, 1280 × 800 and 320 × 640) and compared with the two AI Chat templates (`bunx astryx template ai-chat`, `ai-chat-landing`, their `--skeleton`), the layout guides (`bunx astryx docs layout/scaffold`, `structure`, `headers-and-footers`, `layout-spacing`) and the docs for Layout, ChatLayout, Section, Card, Badge, Token, Grid and ClickableCard. Astryx 0.7.7.

## Short answer

Partly. The component **choice** is mostly right: the composer is a `ChatComposer` with the same slots the template uses, the conversation is `ChatMessageList`, rows are `List`, the admin page is an `AppShell` with `Table`. The **composition** is not what Astryx intends in five places, and those five explain almost everything that looks wrong. All five have a documented Astryx answer; none needs custom CSS, and most of what sits in `styles.css` today exists because we did not use that answer.

## Findings, worst first

### 1. The floating composer is hand-rolled CSS; Astryx ships it as `ChatLayout`

`styles.css` holds `.stream-column`, `.stream-fill`, `.composer-dock` (sticky bottom, gradient fade, pointer-events games), `.stream` (a 944 px centred column) and a `scroll-margin-bottom` rule driven by a `--composer-height` variable that `start.tsx` measures with a `ResizeObserver`. That is twenty-five lines of layout CSS in a file that the project rules say holds imports and body basics only.

`ChatLayout` (`@astryxdesign/core/Chat`) is exactly this: "messages in page flow, composer fixed bottom with frosted glass dock, scroll-to-bottom button, `density`, `scrollRef` delegates to a parent scroller". The `ai-chat` template is `Layout → LayoutContent padding 0 → ChatLayout composer={<ChatComposer …/>}><ChatMessageList/></ChatLayout>`. The centred column is `Layout contentWidth={960}` (the Layout docs name 960 for content pages, 640 for text), not a max-width class.

Consequence of the hand-rolled version: the dock's gradient is drawn over the last card instead of the frosted blur, the stream column and the dock column are kept equal by two magic numbers (944 and 880), a focused control under the dock is rescued by the `scroll-margin` hack, and the short-viewport media query re-implements what `ChatLayout` does on its own.

### 2. Badges everywhere; Astryx says a Badge is for status that needs action

Badge docs: "NOT for metadata like dates, durations, counts, or descriptions", "every badge steals attention", "don't repeat loud badges in every row". On one start page we render:

- the attention sentence in the header as a neutral Badge (a sentence, not a status);
- the area name on every card as a neutral Badge (a category that never changes per row: plain supporting text, or a Token if it must be a chip);
- the deadline as a coloured Badge with a clock icon and a duration, "Senast 13 nov. · 9 dagar" (the anti-example in the docs: duration and date → supporting text; the urgency colour belongs to the group's StatusDot, which we already draw);
- the receipt time as a Badge, "I samtalet" as a Badge, "Att bekräfta" as a Badge, "Till kännedom" on every notice row, the counts in the sidebar as Badges (counts → text), "Inbyggd" and the kind in the admin name cell.

This is the single largest source of "bad-looking elements": five to seven pills per card, in four colours, all competing. The templates use one Token per chip and `Text type="supporting"` for every other piece of metadata.

### 3. Card soup and nested cards

Structure guide: "Card soup: each record wrapped in its own Card", "full-width Cards stacked as page structure", "cards inside cards". Card docs: a Card is for something you could reorder or remove independently. A thread passes that test, so an expanded thread as a Card is fine. What is not:

- a collapsed thread (Ledighetsansökan, Introduktion) is a one-line record in its own full-width Card, with a `Heading` that contains a ghost `Button` as the title (the visible 12 px left offset in the screenshot is that button's padding). Astryx's shape for this is rows: `Section padding={0}` with a `List hasDividers`, one `ListItem` per thread with the action row as `endContent`, exactly what `NoticeList` already does for notices. The expanded card is the exception, not the default;
- `NoticeList` puts a List inside a `Card padding={2}`: double inset (the List carries its own) and a card around rows. The guide's pattern is `Section padding={0}` + `List`;
- the conversation is a `Card` that contains a `ChatMessageList` whose bubble contains another `Card` for "Att bekräfta". Three nested surfaces; the `ai-chat` template nests a `ClickableCard variant="muted"` directly in a ghost bubble and nothing else;
- the custom `.astryx-card:has([aria-current])` ring in styles.css exists because a Card has no selected state. Astryx's answer for a row that is "in the conversation" is `ListItem isSelected` (already used on item rows) and for a card `elevation` or `variant="muted"`, not a theme-coloured box-shadow.

### 4. Headings used for size, two leads per region, double insets

Structure guide: "one lead per region", "demote by weight and colour, not size", "flexbox soup". Spacing guide: "one content line per region", "the container owns padding, the component with a built-in inset owns the line".

- On an area page "Personal" (`Heading level 2 accessibilityLevel 1`) and "Behöver dig · 3" (`Heading level 2`) render identically: two leads, nothing says which one the page is about.
- Group headings are `Heading level 3 color="secondary"` beside a StatusDot that already has a label, day headings in Redan hanterat are `Heading level 6 accessibilityLevel 2`, the week agenda uses levels 5 and 6 for day names. Levels are chosen for size; Astryx wants `Text weight="semibold"` or `type="supporting"` for support and metadata and a heading only for the lead.
- The sidebar is a `List` inside `LayoutPanel padding={2}`: double inset, and the right column (counts, "1 pågår", "Kalender") does not share a line with anything.
- The start page uses `Layout` as the page shell with identity in the header. Layout docs: "Don't use Layout as the page shell; use AppShell". The admin surface already does this right (`AppShell` + `TopNav` + `SideNav`); the start page should share that shell so both halves of the product get one header, one nav width budget and one content width.

### 5. Grid used for a week; the calendar page wastes two thirds of its width

`WeekAgenda` draws `Grid columns={{minWidth: 160, max: 5}}` with `repeat` left at its default `'fill'`. Grid docs: `'fill'` "preserves empty tracks for consistent widths"; `'fit'` "collapses empty tracks so items stretch". The result on a 1280 px calendar page is five 160 px columns and 400 px of nothing. The docs also say a fixed week is the one case for a numeric `columns={5}`. On the start-page card the same Grid holds Tokens with the full title inside, so a long meeting name becomes a clipped chip. D27 replaces the calendar page with FullCalendar; the start-page agenda stays a Grid and needs `columns={5}` (or `repeat: 'fit'`) and a Token label that is the time plus a short title.

## Smaller things the templates do differently

- Phone filters: `Areas` compact renders eight secondary Buttons wrapping over three rows. The landing template uses `ToggleButtonGroup` for a row of mutually exclusive choices; a `Select` or `DropdownMenu` is the other documented shape when they do not fit on one line.
- Chips in the composer: the template keeps attachments in `ChatComposerDrawer` as `Token`s with `onRemove`, and inserts mentions as tokens in the field. We do only the latter; the drawer is the right place for "Om 2 saker" so the scope line stops being prose.
- Admin tiles: four identical `Card`s "label + number" in a row, one of them `variant="yellow"` for status. Card docs: "don't create identical card grids", "don't use colour variants for status". The dashboard templates use one tile row as `Grid` of Cards with a `StatusDot` in the tile, not a coloured card.
- Mixed control sizes in one row: the proposal card's action row has a `md` primary beside `sm` ghosts; the spacing guide wants one size per row.
- Status announced twice: group heading = StatusDot with label + heading text with the same word.

## What is fine and should stay

- `ChatComposer` with `headerActions`, `headerContext`, `footerActions`, `sendActions`, `triggers` and `ChatDictationButton` matches the template slot for slot.
- `ChatMessageList` / `ChatMessage` / `ChatMessageBubble` with `variant="ghost"` for the assistant and `width="100%"` for a card in a bubble is the template's pattern.
- Rows as `List` with `startContent`, `label`, `description`, `endContent` in the sidebar, Redan hanterat, the side panel and the admin phone list.
- The admin shell (`AppShell` + `TopNav` + `SideNav` + a `Section` for the gutters + `Card padding={0}` around a `Toolbar` and a `Table`) is the closest thing in the app to an Astryx template and reads that way in the screenshot.
- `CheckboxList` for selectable rows, `MoreMenu` for the overflow, `DropdownMenu presentation="adaptive"` for Påminn mig, `useToast` for Ångra.

## Proposed order of work

1. Start page shell: `AppShell` (shared with admin) → `Layout contentWidth={960}` → `ChatLayout` with the composer in `composer` and the stream as children. Delete `.stream*`, `.composer-dock`, the `--composer-height` observer and the short-viewport rule. This alone fixes the dock, the column width and the focus margin.
2. Badge audit: keep a Badge only for a state that needs action (receipt with a failed row, "Att bekräfta"). Area → supporting text; deadline → supporting text with the group's colour already on the StatusDot; counts → text; chips → Token.
3. Threads as rows: a group is `Section padding={0}` + `List hasDividers`; a collapsed thread is a `ListItem` with the action row as `endContent`; only the first (expanded) thread in a group is a `Card`. Drop the Card around `NoticeList` and the Card inside the chat bubble (a `ClickableCard variant="muted"` or plain rows).
4. One lead per region and tokens for rank: the page title is the one `Heading`; groups and days are `Text weight="semibold"`; remove the StatusDot label duplication.
5. `WeekAgenda`: `columns={5}` on the card, time plus short title in the Token; the calendar page follows D27.
6. Phone filters as `ToggleButtonGroup`; "Om n saker" as `ChatComposerDrawer`.

Each step is a UI change under the WCAG rule in `CLAUDE.md`: keyboard, focus, announcements and 320 px reflow re-checked, `sh scripts/a11y.sh` green, and the canvas redrawn where it drew a Badge or a card that Astryx renders as text or a row (the rule that the canvas follows Astryx, HANDOVER §7).

## Template ids worth reading before each step

`ai-chat` (ChatLayout, bubbles, artifact card), `ai-chat-landing` (ChatComposerDrawer, ToggleButtonGroup, suggestion grid), `table-inbox` and `table-grouped` (records as rows under group headers), `dashboard-alert-rail` (status tiles without coloured cards), `shell-side-nav` (the shell the start page should share with admin), `messaging-shell` (WIP: the rail, nav, stream, panel column frame the scaffold guide names for feeds). Read with `bunx astryx template <id>` and `--skeleton`.
