# One pattern on Astryx, and the library question

Date: 2026-11-14. Asked by the product owner: the interface does not look good and its UX pattern is unresolved; look at
other UI libraries, review the feature set and flows as if Clew were a new application, and propose a theme and a logo,
preferably staying on Astryx's own templates and components.

Method: an Impeccable critique run as two isolated assessments (a design review of the live application and its source as
the manager test user; the deterministic detector with a browser overlay and measurements), a separate comparison of
open source libraries checked against npm on the day, and a design canvas whose artboards are rendered from the real
Astryx components through Clew's own providers and theme mechanism. Nothing in the application's code was changed.

Canvas: [Clew · one pattern, on Astryx](https://claude.ai/artifact/V3PABcJjKtntgButisL4mo) (private until shared).

## The library question

Switching would not fix what is wrong. Astryx (MIT, `@astryxdesign/core` 0.7.13 pinned here, 0.7.16 published) already
ships more page-level structure for this application than any alternative: the app shell and side navigation, the inbox
table, the work item detail page, wizards, dashboards, the chat family and token theming with a dark appearance.

| Library | Licence | Why it is not the answer |
|---|---|---|
| Cloudscape | Apache-2.0 | The closest match in documented patterns (split view, details page, wizard, chat components), but a strong console look and less room to theme; no scheduler |
| PatternFly | MIT | Page shell, table toolbar, wizard, a chatbot package and the most explicit accessibility statement (WCAG 2.1 AA stated, not 2.2); dense vendor look; no scheduler |
| Mantine | MIT | The only one with a free first-party scheduler; no chat components and no official page templates |
| React Aria Components | Apache-2.0 | The strongest accessibility base, but no styling and no patterns: it means building a design system |
| Carbon | Apache-2.0 | Shell and AI chat, but the look is one vendor's |
| MUI | MIT core, commercial X | Multi-filter, column pinning and grouping in the data grid need a paid key: outside the open source rule |
| Digg's design system, GOV.UK Frontend | MIT | Stale on React 18, or not React and brand-locked |

Real reasons to watch Astryx are risk, not UX: it is a beta at 0.x with several canary releases a day, one vendor
governs it, it makes no WCAG conformance statement and its charts are not stable. None of the alternatives was found to
publish an audit either. A move would rewrite about 150 UI files and repeat every keyboard, focus and screen-reader check.

## What the critique found

Design health 22 of 40 (Nielsen's ten heuristics; consistency scored 1). The detector's static scan was clean; in the
browser it found one skipped heading level on Hem and a flat type scale on the work item (steps of 1.2), and measured
7 to 8 font sizes, up to 12 text colours and 18 backgrounds on Hem, and 33 to 94 interactive elements above the fold.

1. **No single rule for where a thing opens.** A work item has four containers (side panel from Hem, reading pane in Att
   göra, its own page, a full-screen page when narrow), and nine ways of showing a thing exist in all: panel, pane, page,
   wide overlay, wizard dialog, inline unfold, chat answer card, popover, palette.
2. **The side panel does three jobs** (peek, work surface, conversation) and reflows the page under it.
3. **Hem is a chat landing glued to a dashboard**: the box takes the best 300 px, eight equal tiles follow.
4. **Navigation is flat**: nine fixed rail entries, an unbounded conversation list and seven administration rows; four
   manager places are about the same people; tools have no home.
5. **Actions create things on the click** (a row menu's "Registrera frånvaro" made a draft work item at once), and a
   source record and its work item are shown as two different things.
6. **The look is the default**: accent, text and neutral are the same black, so the page is monochrome and the status
   colours carry everything.

Worth keeping: the address is the state (Back, reload and Esc work everywhere), Att göra as a queue with
"Varför ser jag detta?", the action path that never sends before the last button, and honest degraded states.

## The proposal, as the canvas draws it

Eight page types, each one Astryx template, and one rule per type:

| Page type | Astryx template | Used for |
|---|---|---|
| Shell | `shell-side-nav` | The rail: two verbs, then Mitt arbete, Min enhet, Verktyg, Samtal; Administration and the person at the foot |
| Dashboard | `Layout` column with `Grid` | Hem: one composer, then Behöver dig, I dag, Läget, Nyheter, each linking to its place |
| Queue with a reading pane | `table-inbox` | Att göra; the only place a pane sits beside a list |
| Register | `table-page` | Personal (Kompetens, Samtal, Introduktion och avslut as tabs), units, tool lists, administration lists |
| A thing's page | `work-item-detail` | Work item, person, unit, plan, request, connected system |
| Conversation | `ai-chat` | The transcript with the thing it is about in the end panel |
| Action | `form-wizard-dialog` | Every write: fill in, "Det här händer", send |
| Settings | `settings-sidebar` | Administration's sections in a panel of their own |

Rules that follow: a name is a link to the thing's page; a thing has one page and, in the queue and beside a
conversation, the same parts in a pane; the assistant has two homes (the composer on Hem and the conversation page) and
"Fråga Clew" opens the conversation with the thing beside it; nothing is created before the dialog's last button; the
side panel that opens over other pages, the wide overlays and the inline unfold go away.

Theme: colour tokens only (the closed list of D98), ink indigo `#2c3990` ("Bläck", chosen by the product owner on 2026-11-14 over petrol, plum and forest green) on a cool paper ground, status colours left to
status; it passes `checkThemeContrast` in both appearances. Logo: a wound ball of thread with the thread leading out.

## What this would change, and what is open

- It reverses the thing-on-top panel of D112 and the "one panel" rule: the product owner's decision to make.
- Dialogstöd and the development talk become a tab on the person and the unit instead of overlays: needs a design of its own.
- The calendar page (D27), the row-by-row review and the competence matrix are not redrawn; the calendar keeps its page,
  the matrix needs a real grid, the review becomes a sub-page of the thing.
- The `table-inbox` and `work-item-detail` templates use `stylex.create` for a few details; Clew uses the pre-compiled
  CSS path, so those details are either dropped (as on the canvas) or need a decision.
- The open row in the queue is marked with an inline background from a table plugin, as the template does it.
- 320 px, a screen reader and the dark appearance of every board are not verified by this review.
