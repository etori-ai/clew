# Calendar component alternatives · 2026-11-04

Requested: the calendar page (`/kalender`) needs to become a fully capable calendar, and the team does not
want to hand-roll a calendar component. Which open source components could Clew use?
Based on `main` at `a09c7de`, the live page, `startsidan` at `~/code/startsidan`, the design canvas row
"Chef-kalender", Astryx 0.7.7's CLI docs, `npm view` on 2026-11-04, the GitHub API on the same day, and the
libraries' own documentation. Marketing claims were discounted; accessibility claims were checked against
each project's issue tracker.

## Outcome

Nothing is decided. The recommendation is **FullCalendar 7 Standard (MIT) rendered through
`@fullcalendar/react`, with a Clew theme built from Astryx tokens and Astryx components in every slot
FullCalendar leaves to the host**, taken as a decision (D27) that amends the "Astryx components only" rule
for this one surface and retires the sentence "the week view is an Astryx Grid agenda, not a time grid" in
`CLAUDE.md`. Schedule-X is the runner-up; everything else fails a hard constraint or is too small to carry a
public-sector calendar. The headless route (an engine plus Astryx rendering) is not available yet: FullCalendar's
own headless package is undocumented beta, and the other headless engines are one-person projects.

## Where the calendar stands

| | Clew today (`packages/ui/src/week-agenda.tsx`, 45 lines) | startsidan (`packages/modules/calendar`, 1 768 lines) | Canvas "Chef-kalender" |
|---|---|---|---|
| Week | Five Astryx `Grid` columns, entries in time order, no hour axis | Seven columns on an hour axis (07–18, stretched to fit), 30-min lines, lane packing of overlapping events, a live "now" line, event chips as buttons | Five columns on an 08–17 hour axis, bookings as grey blocks, proposals as outlined blocks |
| Day / month | None | Agenda list (`agenda-view.tsx`); no month | Dag / Vecka / Månad switch in the header |
| Create | None (the assistant proposes, the person confirms) | `meeting-form.tsx`: title, start and end (`DateTimeInput`), room (`Selector`), participants (`Tokenizer`), live availability check, idempotency key | "Ny bokning" button |
| Open an event | None | `event-dialog.tsx`: details, accept, cancel | Not drawn |
| Move an event | None; the assistant redraws | None | The panel text says "Dra ett förslag i veckovyn för att byta tid" |
| Styling | Astryx only | Custom CSS classes (`week`, `week-axis`, `event-chip`) | Hand-drawn |
| Accessibility | Headings per day, list semantics, legend; reflow fails at 375 px (a11y review item 4) | Grid is `role="group"`, axis `aria-hidden`, now line `role="img"` | The whole grid is one `role="img"` with a spoken summary; the panel list is the accessible path |

The backend contract already carries what a full calendar needs: `CalendarProvider` in
`packages/calendar/src/model.ts` has `list`, `lookup`, `resources`, `availability`, `freeBusy`, `create`,
`reschedule` and `cancel` (startsidan also had `accept`). The gap is the UI, not the port.

## Constraints the choice must satisfy

1. **Open source only** (`CLAUDE.md`): the package and everything it needs must be OSI-licensed; a paid tier
   may exist upstream, but no feature Clew ships may depend on it.
2. **Astryx only, no second component system, no custom CSS, no Tailwind** (`CLAUDE.md`). Astryx's own
   review rubric (`bunx astryx docs is-my-code-good`) phrases the rule as: Astryx owns each pattern for
   which it has a suitable component; raw elements remain only where native semantics are necessary or
   Astryx has no equivalent. Astryx 0.7.7 has `Calendar` (a month date picker), `DateInput`,
   `DateRangeInput`, `DateTimeInput`, `TimeInput` and the `useGridFocus` hook. It has **no event calendar,
   week view, time grid or scheduler**, and no integration package in `bunx astryx discover` adds one.
   So a calendar library is a gap, not a violation, provided its styling resolves to Astryx tokens
   (`bunx astryx docs styling-libraries other-libraries`: keep third-party theme objects semantic and
   store `var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)` as the values).
3. **WCAG 2.2 AA** is a hard requirement. A time grid is the hardest calendar surface to make accessible;
   the library's track record on keyboard and ARIA weighs more than its feature list.
4. **React 19 + Vite**, no Next, no Tailwind; `temporal-polyfill` 1.0.7 is already a dependency of
   `@clew/calendar`.
5. **The assistant proposes, the person decides**: drag is a convenience for moving a proposal before
   confirming, never the only way (the design exploration review lists "drag-and-drop as the only way to
   move a meeting" under what Clew does not copy).

## Candidates

Numbers from `npm view`, `api.npmjs.org` (downloads, 30 days to 2026-11-03) and the GitHub API on 2026-11-04.

| Library | Licence | Version · last publish | Downloads / 30 d | Stars · open issues | Views | Styling | Accessibility | Verdict |
|---|---|---|---|---|---|---|---|---|
| **FullCalendar 7** (`@fullcalendar/react`) | MIT (Standard); Premium is AGPL-3.0 or paid, separate `*-scheduler` packages | 7.1.4 · 2026-11-04 | 7.5 M | 20 746 · 1 080 | Month, week, day time grid, list, multi-month; Standard includes `interaction` (drag, resize, select) | v7 ships no CSS by default; a theme is a set of class-name props per element; stock themes, Shadcn and MUI themes exist; CSS variables `--fc-event-color` per event | Documented: WAI-ARIA, Tab to every control, `eventInteractive`, `headingLevel`, `hints` for labels. Open issues: time grid cells not exposed as a grid (#8095), no keyboard drag (#2535), no keyboard `dateClick` (#6528), `aria-pressed` on prev/next (#8042) | **Recommended** |
| **Schedule-X** (`@schedule-x/calendar` + `/react`) | MIT core; drag-and-drop, resize, drag-to-create, sidebar, scheduling assistant, resource views and Gantt are **paid** (€479/year per project) | 4.9.1 · 2026-09-29 | 754 k | 2 608 · 58 | Month grid, week, day, month agenda | Default theme package; React custom components for events, dates, hours and header | No accessibility documentation; open issue #1345 (`aria-label` on role-less divs). Renders through Preact + `@preact/signals` (peer deps), a second UI runtime beside React | Runner-up; moving an event is paid, so Clew would have no drag at all |
| **EventCalendar** (`@event-calendar/core`, vkurko) | MIT | 5.18.1 · 2026-10-25 | 315 k | 2 301 · 23 | Day grid, time grid, list, resource views, interaction plugin (free) | One CSS file; `theme` option replaces every class name; `eventContent` accepts DOM nodes | No keyboard or ARIA documentation; only `dayHeaderAriaLabelFormat`. Compiled Svelte 5, so it depends on the `svelte` runtime and is mounted into React through a ref | Not chosen: no accessibility story, second framework runtime |
| **DayPilot Lite** (`@daypilot/daypilot-lite-react`) | Apache-2.0 (Lite); Pro is commercial | 6.2.0 · 2026-10-30 | 50 k | repo not public on GitHub | Day, week, work week, month, navigator | CSS themes and `--dp-*` variables; built on `create-react-class` | No accessibility statement | Not chosen: closed development, legacy React API |
| **MUI X Scheduler** (`@mui/x-scheduler`) | MIT (Community); recurrence and lazy loading are Premium | 9.0.0-beta.15 · 2026 | 83 k | MUI X 5 872 · 1 190 | Day, week, month; timeline is Premium | Requires `@mui/material`, `@mui/system`, Emotion and `@mui/icons-material` as peers | The best documented of all: `role="grid"`, arrow keys between cells, Enter to create, `aria-current`, live region on navigation | Not chosen: beta, and it brings Material UI and Emotion, a second component system |
| **ilamy Calendar** (`@ilamy/calendar`) | MIT | 3.3.0 · 2026-10-26 | 56 k | 353 · 8 | Month, week, day, year, resource, agenda; RFC 5545 recurrence | Requires Tailwind 4 and `tailwindcss-animate`; uses shadcn tokens, Radix primitives, `lucide-react`, `@dnd-kit` | No accessibility statement | Not chosen: Tailwind is excluded by `CLAUDE.md` |
| **react-big-calendar** | MIT | 1.20.0 · 2026-06-01 | 4.7 M | 8 763 · 125 | Month, week, day, agenda | Compiled CSS and Sass; overriding is warned against | No accessibility statement; carries moment, luxon, globalize, dayjs and lodash as dependencies at once | Not chosen: dormant since June, heavy, no a11y |
| **Toast UI Calendar** | MIT | 2.1.3 · 2022-08-16 | 22 k | 12 688 · 208, **archived** | Month, week, day | Own CSS | None | Rejected: archived |
| **CalendarKit** (calendarkit.io) | MIT claimed | no npm package found under that name | | | | Compiled scoped CSS, `--ck-*` variables | Vendor claims WCAG AA colours and named buttons | Rejected: cannot verify the package or the project |

Headless engines, for completeness:

| Library | Licence | State | Why not now |
|---|---|---|---|
| `@full-ui/headless-calendar` (FullCalendar's own) | MIT, 7.1.4 | "Not yet thoroughly documented", offered as beta to Premium subscribers; used inside `@fullcalendar/core` | The right shape for the Astryx rule (engine from them, rendering from us), but not usable until documented. Watch it. |
| `react-headless-agenda` | ISC, 0.3.0 (2025-04) | 9 stars, "under heavy development" | Too small |
| `@daywatch/cal-react` | MIT, 0.2.0 | 0 stars, no releases | Too small |
| `react-week-scheduler`, `react-timegrid`, `@veccu/react-calendar` | MIT | unpublished or dormant since 2022 | Dead |

## Why FullCalendar 7

- **Licence is clean for what Clew needs.** Month, week, day, list and the interaction plugin are Standard
  and MIT. Premium is only resource timelines and the vertical resource view, which Clew does not need:
  a manager's week, never a room board. Premium's open source licence moved to AGPL-3.0 in v7, so even
  that door is open if a resource view were ever wanted, at the price of a separate package.
- **v7 fits the styling rule better than any alternative.** FullCalendar no longer ships CSS. A theme is a
  function per element returning class names, so a `@clew/ui` theme can resolve every colour, spacing and
  radius to `var(--color-*)`, `var(--spacing-*)` and `var(--radius-*)` exactly as Astryx's
  styling-libraries guide prescribes for third-party libraries. The Shadcn theme shows the pattern Clew
  would copy: the toolbar is not FullCalendar's, it is the host's own components (`Button`, `Tabs`); Clew's
  toolbar is already Astryx (`IconButton`, `Button`, `Heading`) and stays. Event content is JSX through
  `eventContent`, so an event renders as Astryx `Text`, `Badge` and `Token`, like the agenda does today.
- **React 19 native.** `@fullcalendar/react` 7 is written in React (not a Preact wrapper), supports
  StrictMode and SSR, and declares React 17 to 19 as peers. It needs `temporal-polyfill` ^1.0.7, which
  Clew already pins.
- **Accessibility is documented and actively worked on**, with an issue tracker that names the gaps.
  That matters more than a clean marketing page: the gaps above are exactly the ones Clew's a11y suite
  would have to cover, and they are known.
- **Scale.** 7.5 million downloads a month, a release this week, a 20-year-old project with a company behind it
  that other municipalities will recognise and trust.

## Why not the others

- **Schedule-X** puts moving an event behind a paid plugin. Clew could live without drag (the assistant
  redraws), but a calendar that other municipalities adopt should not have a price tag on its most
  obvious interaction. It also has no accessibility documentation and renders through Preact.
- **MUI X Scheduler** has the best accessibility documentation of the field, but pulling Material UI and
  Emotion into an Astryx app is the "second component system" the rules forbid, and it is beta.
- **EventCalendar** is good engineering with a free interaction plugin, but it is compiled Svelte with no
  keyboard story; Clew would be writing the ARIA layer itself around a framework it does not use.
- **ilamy** needs Tailwind, **react-big-calendar** is dormant, **Toast UI** is archived, **DayPilot Lite**
  develops behind closed doors.

## What a FullCalendar build means for the rules

1. **A decision (D27, proposed)** that an event calendar is an Astryx gap, filled by FullCalendar 7
   Standard, with these conditions: only Standard packages; the theme lives in `packages/ui` and resolves
   every value to Astryx tokens; no `fc-*` CSS of our own beyond that theme file; toolbar, panel, dialogs and
   event content are Astryx components; `WeekAgenda` stays for the thread card on the start page (the
   small, non-interactive week), and the time grid is the calendar page only. File a
   `bunx astryx gap-report Calendar --category missing_component` so Astryx knows.
2. **`CLAUDE.md`** loses "The week view is an Astryx Grid agenda, not a time grid" for the calendar page
   and gains the D27 conditions. The design exploration review's "the week agenda stays Clew's own
   `WeekAgenda` over Astryx `Grid`" is narrowed to the start page.
3. **Accessibility work Clew owns regardless of library**, because FullCalendar's open issues are real:
   - Keyboard moves: a focused proposal gets "Flytta" in its event content (Astryx `Menu` or the panel's
     reply field), so drag is never the only way (#2535).
   - Keyboard creation: "Ny bokning" opens a form with `DateTimeInput`, as startsidan's `meeting-form.tsx`
     did; `dateClick` by keyboard (#6528) is not needed.
   - The time grid's cells are not exposed as a grid (#8095). The canvas already solves this the right way:
     the proposal list in the panel is the accessible path, and the grid gets a spoken summary. Keep that.
   - Status messages: week change announces through `useAnnounce` (a11y review item 11), not FullCalendar.
   - Reflow at 320 px: FullCalendar's week on a phone is a horizontal scroll; the a11y suite's "a calendar
     week stacks its days on a phone" test keeps the day view (`timeGridDay`) or the list view
     (`listWeek`) as the phone rendering, chosen by `useMediaQuery` as `calendar.tsx` already does.
   - `headingLevel` and `hints` get Swedish labels; FullCalendar's `sv` locale covers the rest.
4. **Licence record** for `HANDOVER.md` section 3: `@fullcalendar/react` 7.1.4 MIT, `@fullcalendar/core`
   7.1.4 MIT, `@full-ui/headless-calendar` 7.1.4 MIT (transitive), checked with `npm view` 2026-11-04.
   No Premium package, no licence key.

## Order of work, if D27 is accepted

1. Theme: `packages/ui/src/calendar-theme.ts` mapping FullCalendar 7's class-name props to Astryx tokens;
   compare against the canvas before any view is wired.
2. Week view on `/kalender` with existing events, proposals as outlined events (`eventContent` with the
   `Förslag` badge), the panel unchanged; a11y suite green, including reflow.
3. Day and month views behind an Astryx `ToggleButtonGroup` (Dag / Vecka / Månad as on the canvas); list
   view on phones.
4. "Ny bokning": startsidan's `meeting-form.tsx` ported to Astryx, calling `create` through a use case with
   its audit row.
5. Open an event: Astryx `Dialog` with details and the contract's `cancel` / `reschedule`.
6. Drag of proposals only (`editable` per event), writing back through the thread's replan, with the
   keyboard alternative from item 3 above.

## Sources

- FullCalendar: [upgrading from v6](https://fullcalendar.io/docs/upgrading-from-v6),
  [accessibility](https://fullcalendar.io/docs/accessibility), [plugin index](https://fullcalendar.io/docs/plugin-index),
  [custom themes](https://fullcalendar.io/docs/custom-themes), [Shadcn theme](https://fullcalendar.io/docs/shadcn),
  [React](https://fullcalendar.io/docs/react), [premium](https://fullcalendar.io/docs/premium),
  issues [#8095](https://github.com/fullcalendar/fullcalendar/issues/8095), [#2535](https://github.com/fullcalendar/fullcalendar/issues/2535),
  [#6528](https://github.com/fullcalendar/fullcalendar/issues/6528), [#8042](https://github.com/fullcalendar/fullcalendar/issues/8042).
- Schedule-X: [calendar docs](https://schedule-x.dev/docs/calendar), [React](https://schedule-x.dev/docs/frameworks/react),
  [premium](https://schedule-x.dev/premium), issue [#1345](https://github.com/schedule-x/schedule-x/issues/1345).
- EventCalendar: [vkurko/calendar](https://github.com/vkurko/calendar).
- MUI X Scheduler: [overview](https://mui.com/x/react-scheduler/), [accessibility](https://mui.com/x/react-scheduler/accessibility/).
- ilamy: [kcsujeet/ilamy-calendar](https://github.com/kcsujeet/ilamy-calendar). react-big-calendar:
  [jquense/react-big-calendar](https://github.com/jquense/react-big-calendar). DayPilot Lite:
  [tutorial](https://code.daypilot.org/42221/react-calendar-open-source). Headless:
  [react-headless-agenda](https://github.com/lucassaid/react-headless-agenda), [daywatch-cal](https://github.com/sdougbrown/daywatch-cal).
- Surveys read and discounted where they were vendor-written:
  [DEV Community 2026 roundup](https://dev.to/hadil/best-open-source-react-calendar-libraries-for-scheduling-in-2026-4h11),
  [LogRocket](https://blog.logrocket.com/best-react-scheduler-component-libraries/),
  [Bryntum comparison](https://bryntum.com/blog/react-fullcalendar-vs-big-calendar/),
  [OpenSoftwareAlliance research issue](https://github.com/OpenSoftwareAlliance/cal/issues/1).
