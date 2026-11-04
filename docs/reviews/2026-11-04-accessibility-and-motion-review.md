# Accessibility, component and motion review · 2026-11-04

Requested: list the components in use, check whether Astryx motion is included, and assess whether Clew
has strict handling of WCAG. Clew targets the public sector, so accessibility is a hard requirement.
Based on `main` at `d574efe`, measured against WCAG 2.2 AA in the running application.

## Outcome

Clew was **not WCAG 2.2 AA conformant at `d574efe`**, and it had **no process that would keep it
conformant**. Findings 1 to 14 are fixed on `main` and guarded by an automated suite, see
[What it led to](#what-it-led-to). The sections below record the state as measured.

The base is good. The UI is almost entirely Astryx, and axe-core found no WCAG A or AA violation in ten
tested states. The failures are in what automated tools cannot see: layout on narrow screens, focus
handling and status announcements. Most are small, local fixes.

| Question | Answer |
|---|---|
| Components | 46 of the 58 exports in `@clew/ui` are in live use, nearly all Astryx |
| Astryx motion | Available through `@astryxdesign/core`, but Clew uses none of it. The motion spec in `HANDOVER.md` section 6 is not built |
| Strict WCAG handling | No. No rule in `CLAUDE.md`, no accessibility tests and no CI |
| WCAG 2.2 AA | 8 success criteria confirmed failing, 1 needs a decision |

## How it was tested

- Account `hillevi`, synthetic data, the app's built-in Chromium-based browser pane.
- axe-core 4.10.3, injected at runtime, with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`
  and `best-practice`. States: login, start page, open menu, open conversation, open drawer, calendar,
  Redan hanterat, area view, start page at 375 px, calendar at 375 px.
- Real keyboard input through 48 consecutive tab stops, the card menu, Enter and Escape.
- Layout measured at 1280×800, 375×812, 320×640 and 320×256 (400 % zoom on a 1280×1024 screen).
- A MutationObserver over every live region to record what would be announced.
- WCAG 1.4.12 text spacing overrides on the desktop start page.

**Not covered:** real screen readers (NVDA, JAWS, VoiceOver, TalkBack), forced colours and Windows High
Contrast, speech input, the `hassan` persona, states needing a configured model, and users with
disabilities. Announcements here are inferred from the DOM, not heard. A clean axe run covers only part
of WCAG, so it is no proof of conformance.

## Components

`packages/ui/src/index.tsx` re-exports Astryx and adds only `WeekAgenda` and the session helpers.

| Group | Used, with JSX uses in brackets |
|---|---|
| Layout | `VStack` (29), `HStack` (44), `Layout`, `LayoutHeader`, `LayoutContent`, `LayoutPanel` (2 each), `Grid` (2), `ScrollableArea`, `Divider` |
| Text and status | `Text` (73), `Heading` (8), `Badge` (21), `Icon` (18), `StatusDot` (5), `Timestamp` (5), `Token` (2), `Kbd`, `Avatar`, `VisuallyHidden` |
| Actions | `Button` (42), `IconButton` (4), `MoreMenu` (3), `SegmentedControl` with `SegmentedControlItem` |
| Data | `List` (13), `ListItem` (16), `CheckboxList`, `CheckboxListItem` (3 each), `Card` (8) |
| Disclosure and surfaces | `Collapsible` (3), `Drawer`, `Overlay`, `Banner`, `EmptyState`, `useToast` |
| Chat | `ChatComposer` (2), `ChatComposerInput`, `ChatMessageList` (2), `ChatMessage`, `ChatMessageBubble` (3 each), `ChatMessageMetadata` (2), `ChatSystemMessage`, `ChatDictationButton`, `useChatDictation` |
| Infrastructure | `LinkProvider`, `useMediaQuery`, `Theme`, `InternationalizationProvider` |

- **Exported, unused:** `BottomSheet`, `LayoutFooter`, `StackItem`, `SideNav` and its parts, `Skeleton`,
  `ChatComposerDrawer`, `Link`.
- **Dead code:** `apps/web/src/components/lage.tsx` is imported nowhere, so `ClickableCard` and
  `ProgressBar` never render.
- **Not used and relevant here:** `AppShell`, which is what carries the skip link, and `useAnnounce`, the
  hook for WCAG 4.1.3 status messages.
- **Outside the "no custom CSS" rule:** `packages/ui/src/styles.css` has `.stream-column`, `.stream-fill`,
  `.composer-dock`, `.stream` and a card ring override, used by three raw `div` elements in
  `apps/web/src/pages/start.tsx`. The file's own comment says nothing else is styled there, which no
  longer holds. Findings 2 and 12 start in these rules.

## Motion

Motion ships inside `@astryxdesign/core`; there is no separate package to install. The tokens and the
components' built-in transitions are loaded, and `astryx.css` has 51 `prefers-reduced-motion` rules. A
drawer or toast therefore animates and honours the setting without any Clew code.

The motion Clew itself is supposed to add is missing:

| Astryx feature | Purpose | In Clew |
|---|---|---|
| `useAnimatedLayout` plus `animatedLayout` on `Collapsible` | Content below a disclosure glides instead of jumping | Not used, in any of the 3 `Collapsible`s |
| `useEntryAnimation` | Inserted elements animate on mount | Not used |
| Duration and easing tokens | Consistent timing | Not referenced by Clew code |
| `useStreamingText` | Smooth streamed text | Not relevant yet, answers are not streamed |

`@clew/ui` exports only `useMediaQuery` and `useToast` from the hook set, so the motion hooks are not
reachable from the app. `HANDOVER.md` line 159 asks for 160 to 220 ms on height and opacity when a card
expands, collapses, enters or leaves. None of it exists: cards jump.

Two adjustments before building it:

- Astryx says not to animate height alongside `useAnimatedLayout`, because the glide uses a compositor
  translate. Reword the spec from height to position and opacity.
- The spec says reduced motion turns every transition off. Astryx instead cross-fades under touch, in
  200 ms or less. Accept that behaviour or decide otherwise.

Not building the motion is not a WCAG failure, and it means Clew has no motion of its own that could
break reduced-motion settings. Add it through the Astryx hooks so that stays true.

## WCAG findings

Status: **Fail** is confirmed by measurement. **Decide** needs a project decision.

| # | Criterion | Status | What was measured | Where | Fix |
|---|---|---|---|---|---|
| 1 | 1.4.10 Reflow (AA) | Fail | Start page is 405 px wide in a 320 and a 375 px viewport, caused by the attention badge, which also runs off screen | `apps/web/src/pages/start.tsx:172` | Let the text wrap, or use `Text` on narrow screens |
| 2 | 1.4.10 Reflow (AA) | Fail | At 320×256 the 146 px composer and the header fill the view; the 119 px stream area is entirely behind the composer | `packages/ui/src/styles.css:15` | Release the sticky composer on short viewports |
| 3 | 1.4.10 Reflow (AA) | Fail | Mobile area filter shrinks to one or two letters (A, M, B, A, V, K). A sighted user cannot tell the areas apart | `apps/web/src/components/areas.tsx:22` | Use `wrap="wrap"` |
| 4 | 1.4.10 Reflow (AA) | Fail | Calendar content is 836 px wide in 375 px; Wednesday to Friday are off screen behind horizontal scrolling | `packages/ui/src/week-agenda.tsx:24` | `columns={{ minWidth, max }}`; Astryx warns against numeric columns on phones |
| 5 | 2.4.11 Focus Not Obscured (AA) | Fail | 4 of 48 tab stops end up behind the composer, 3 of them fully hidden, at 1280×800 | `packages/ui/src/styles.css:15` | Scroll padding equal to the composer height |
| 6 | 2.4.3 Focus Order (A) | Fail | Focus falls to `body` whenever the window regains focus, for example after Alt+Tab, because `html` is briefly set to `visibility: hidden` | `packages/ui/src/session.tsx:76` | Hide without `visibility`, or restore focus afterwards |
| 7 | 2.4.3 Focus Order (A) | Fail | Focus falls to `body` when a collapsed card is expanded with Enter; the button unmounts | `apps/web/src/components/card.tsx:175` | Use `Collapsible`, or move focus to the expanded card. Also gives `aria-expanded`, missing today, and a way to collapse |
| 8 | 2.4.3 Focus Order (A) | Fail | Focus falls to `body` after Inte nu, and from there the 10 second Ångra is far away in tab order | `apps/web/src/components/card.tsx:21`, `:122` | Move focus to the next card or the heading, and make Ångra reachable by keyboard in time |
| 9 | 2.4.2 Page Titled (A) | Fail | Every route has the title `Startsidan`, including `/kalender` and `/hanterat` | `apps/web/index.html:7` | Set a title per route and view |
| 10 | 4.1.3 Status Messages (AA) | Fail | No live region changed when the first conversation answer arrived, because the `role="log"` is inserted together with its content. Nothing says a question is in progress | `apps/web/src/components/composer.tsx:204` | `useAnnounce` for "söker svar" and the answer, or keep the log mounted |
| 11 | 4.1.3 Status Messages (AA) | Fail | Changing week on the calendar replaces the heading and content with no live region change; focus stays on the button | `apps/web/src/pages/calendar.tsx:69` | `useAnnounce` with the new week |
| 12 | 1.3.1 Info and Relationships (A) | Fail | `/hanterat` has no headings at all though it shows a visual title and day headings. Card titles, weekday labels and the drawer title are `Text`. The start page has no `h1`. Neither start nor calendar has a `main` landmark, and no page has a banner | `handled.tsx:31`, `panel.tsx:11`, `week-agenda.tsx:26`, `start.tsx:180`, `calendar.tsx:78` | `Heading` where it looks like one, `LayoutContent role="main"`, one `h1` per page |
| 13 | 3.1.2 Language of Parts (AA) | Fail | Screen reader text says "Meddelande från user" and "Meddelande från assistant". `Command + K` and the `@astryx.kbd.key.*` strings are English | `composer.tsx:167`, `packages/ui/src/index.tsx:48` | Give `ChatMessage` a `name`, complete the catalog |
| 14 | 2.4.6 Headings and Labels (AA) | Fail | The drawer shows raw English keys and JSON: `onDuty`, `absent`, `{"name":"Lena Öhman","kind":"sjukskriven"}` | `apps/web/src/components/panel.tsx:15`, `:17` | Render labelled Swedish fields per view |
| 15 | 2.2.1 Timing Adjustable (A) | Decide | The session ends at 8 hours with no warning or extension, and the unmount discards a draft. The 20 hour exception does not apply | `packages/ui/src/session.tsx:100` | Warn before the end with an option to continue, or record why the limit is essential |

### Further weaknesses

- **Skip link (2.4.1):** there is none, and a keyboard user passes about 12 stops before the stream. The
  `h2` headings may meet the criterion, but a skip link is the safe answer. `AppShell` provides one.
- **Drawer close:** there is no visible close button, only Escape and the scrim. Astryx requires one, and
  a touch screen reader user has no clear way out. Use `DrawerHeader` with `onOpenChange`.
- **Conversation open:** 46 controls under the dimmed stream stay in the tab order and are not `inert`. A
  mouse click on the dim closes the conversation, so keyboard and mouse behave differently. axe could not
  verify contrast for 76 elements in this state.
- **Truncation on narrow screens:** invoice rows cut off the deciding information, such as "ingen
  beställning". On calendar proposals the text stays readable.
- **Target size:** WCAG 2.5.8 passes, since small targets have the row or the spacing exception. Clew's own
  promise of 44 px (`HANDOVER.md` line 156) does not: 59 of 60 targets on desktop and all 56 on mobile are
  smaller. Measured from element boxes, so any extended hit area is not counted.
- **Smaller points:** the avatar is a non-interactive tab stop (`start.tsx:165`), the section label
  `Deadline: 1` appears twice (`start.tsx:117`), and the back button is a `button` with a full page reload
  (`calendar.tsx:66`). `aria-label` on a plain `Card` or `HStack` has no effect on some screen readers.
- **Page background:** `--color-background-wash` does not exist in the theme, so the page has no defined
  background (`styles.css:8`). In standard Chromium that gives white; in the Claude pane under a dark
  system theme it gave black text on a dark background. It is also why the gradient needed a hard-coded
  `#f1f1f1`. Use `--color-background-body`.

### What already works

- `lang="sv"`, the login page and the sign-in flow.
- A visible 2 px focus ring on every tested stop, and a logical tab order.
- The card menu: keyboard operation, name, and focus returning on Escape.
- Drawer focus moves in, Escape closes.
- Toasts use `role="status"`, errors use `role="alert"`.
- Status colour always has a word or an icon beside it.
- Labelled checkboxes, and the filter as a radio group.
- No WCAG contrast violation in the light theme on the tested pages.

## Governance

| Control | Today |
|---|---|
| WCAG named as a requirement in `CLAUDE.md` or `HANDOVER.md` | No. `docs/` mentions it nowhere |
| Definition of done for UI work | No |
| Automated tests in the repository | None. No axe, no Playwright, no component tests |
| CI | None, there is no `.github` |
| Manual assistive technology protocol | None |
| Accessibility statement and feedback channel | None |

"Astryx components only" gives a good base but is not a control: all the failures above were built with
Astryx components. Swedish public sector rules (the DOS law, 2018:1937, with EN 301 549, supervised by
DIGG) are expected to apply. That has not been legally reviewed here.

## What it led to

Fixed the same day on `main`. `sh scripts/a11y.sh` runs the new suite, 74 tests in
`tests/a11y`: axe over every route and state at desktop and phone width, plus checks for what axe cannot
see, such as reflow, text spacing, focus, titles and announcements. It runs a production build in the
pinned Playwright image with `/api` mocked, so it needs no Keycloak, database or password. 65 of the 74
tests fail on the code before the fixes and all pass after, 222 of 222 over three repeats. The nine that
pass both ways are guards for behaviour that was already right.

| Findings | Change |
|---|---|
| 1, 3, 4 | On a phone the attention line is `Text`, the area filter wraps and is a `nav`, and the week agenda reflows through `Grid columns={{ minWidth, max }}` |
| 2, 5 | Below 480 px height the row joins the page and the page scrolls. Above that, `--composer-height` follows the row's real size and sets the scroll margin |
| 6 | The session check conceals with `opacity`, which keeps focus |
| 7 | A collapsed title is a heading with `aria-expanded`; focus continues at the title in the open card |
| 8 | Focus moves to the next card, or the heading when none is left. Ångra has no time limit |
| 9, 10, 11 | `usePageTitle` titles every view and speaks a client-side change. The conversation says it is searching and speaks an answer that opens the list |
| 12 | Banner, main and one navigation landmark; one `h1` per page; headings for areas, cards, weekdays, days and the drawer; unique section names |
| 13 | Swedish `@astryx.kbd.*` strings and speaker names through `ChatMessage name` |
| 14 | `panel-labels.ts` holds Swedish field names and readable values; a unit test holds every module output to it |

The drawer got a close button through `DrawerHeader`, and the page background is now
`--color-background-body`. The suite also found what the manual pass missed:

- `useToast` without `LayerProvider` mounted its own root outside the providers, so the toast region was
  called "Notifications". `Providers` now holds a `LayerProvider`.
- `isDisabled={busy}` dropped focus from the button that had just been pressed, on every card action. Busy
  no longer disables the buttons; `run` ignores a second press instead.
- A string `label` or `description` on `ListItem` and `CheckboxListItem` truncates to one line, which hid
  message text and invoice rows. These now pass a `Text`, which wraps.
- `SegmentedControl` truncated the five log filters on a phone. There they are wrapping buttons.
- `thread-<id>` was on two elements after the reminder change.

Still open: finding 15, a skip link, the stream staying in the tab order under the conversation scrim
(D12), the 44 px target promise, manual testing with NVDA and VoiceOver, CI, the accessibility statement,
and the motion spec. Automated checks do not prove conformance on their own.

## Recommended order

1. **Stop the failures, before any pilot.** Findings 1 to 11, plus 13.
2. **Structure.** Finding 12, a skip link, the drawer close button and finding 14.
3. **Make it stay fixed.** Add the rule below, an axe suite for the states in this review, keyboard and
   320 px tests, and CI. `frontend/apps/web-next/ACCESSIBILITY.md` in Eneo is a usable template. Check the
   licence of any test dependency first (`CLAUDE.md`).
4. **Verify by hand.** NVDA and VoiceOver on the main flows, then users with disabilities.
5. **Decide and publish.** Finding 15, the accessibility statement and the feedback channel.
6. **Motion.** Export the Astryx hooks and build the section 6 spec with the two adjustments above.

Suggested rule for `CLAUDE.md`:

> WCAG 2.2 AA is a hard requirement, not a goal. A UI change is not done until keyboard use, focus
> handling, status announcements and reflow at 320 px have been checked, and the accessibility suite passes.
