# D27 · The event calendar is FullCalendar 7 Standard, themed with Astryx tokens, behind Astryx components

**Status:** accepted · **Date:** 2026-11-04 · **Area:** ui

**Decision.** The calendar page (`/kalender`) renders its day, week, month and list views with FullCalendar 7
Standard through `@fullcalendar/react`, pinned exactly, MIT only. Astryx 0.7.7 has no event calendar, so
this is a gap filled by a library, not an exception to the component rule; the rule is amended for this one
surface under these conditions:

1. **Standard packages only.** `@fullcalendar/react` with its `daygrid`, `timegrid`, `list` and `interaction`
   plugins. No `*-scheduler` package, no `schedulerLicenseKey`, no Premium view, ever. A resource view, if one is
   ever wanted, is a new decision.
2. **One theme, in `packages/ui`.** `packages/ui/src/calendar-theme.css` is the only stylesheet besides
   `styles.css`, and `packages/ui/src/calendar.tsx` is the only place FullCalendar is imported. The theme is
   built from FullCalendar 7's class-name props and resolves every colour, spacing, radius, focus ring and
   type value to an Astryx token (`var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)`, `var(--focus-*)`,
   `var(--text-*)`), as `bunx astryx docs styling-libraries other-libraries` prescribes for third-party
   libraries. No stock FullCalendar theme, no palette file, no hex value, no Tailwind, no StyleX plugin
   (the plain CSS path stays). FullCalendar's `skeleton.css` is imported as the library's own structural
   stylesheet.
3. **Astryx around and inside it.** The toolbar (week heading, previous, today, next, the Dag / Vecka / Månad
   switch, "Ny bokning"), the proposal panel, every dialog and every form are Astryx components;
   FullCalendar's `headerToolbar` stays off. Event content is JSX through `eventContent`, rendered with
   Astryx `Text`, `Badge` and `Token`, so a proposal, a booked samtal and an existing meeting look as the
   agenda does today. Icons go through Astryx `Icon`.
4. **The assistant proposes, the person decides** (D8, D12). Drag and resize are enabled for proposals only,
   never for events the person does not own through a thread, and a keyboard path exists for every drag:
   a focused proposal offers "Flytta" (Astryx `MoreMenu` or the panel's reply field). FullCalendar's
   `dateClick` by keyboard is not relied on; "Ny bokning" opens an Astryx form with `DateTimeInput`.
5. **Accessibility Clew owns.** FullCalendar's time grid does not expose its cells as a grid (fullcalendar#8095)
   and has no keyboard drag (#2535). The proposal list in the panel is the accessible path to every
   proposal, and the grid carries a spoken summary, as the canvas draws it. Week changes are announced through
   `useAnnounce`; `headingLevel` and `hints` carry Swedish labels; the `sv` locale is loaded. On a phone
   (`useMediaQuery`, 720 px as today) the page renders the list or day view, never a five-column time grid,
   so reflow at 320 px holds. `tests/a11y` keeps its calendar cases and gains one per new view and state.
6. **`WeekAgenda` stays** for the thread card on the start page: the small, read-only week over Astryx
   `Grid`. The time grid is the calendar page only.
7. **Licence record.** `@fullcalendar/react` 7.1.4 MIT, `@fullcalendar/core` 7.1.4 MIT,
   `@full-ui/headless-calendar` 7.1.4 MIT (transitive), `temporal-polyfill` 1.0.7 MIT (already pinned),
   checked with `npm view` on 2026-11-04 and recorded in `HANDOVER.md` section 3.

**Why.** `docs/reviews/2026-11-04-calendar-component-alternatives.md` compared nine libraries and four
headless engines against four constraints: open source only, Astryx only, WCAG 2.2 AA, React 19 under
Vite without Tailwind. FullCalendar 7 is the only candidate that passes all four with the features Clew
needs free of charge: version 7 ships no CSS and lets a host theme map every element to its own tokens;
its React package is native React 17 to 19; month, week, day, list and drag are MIT; accessibility is
documented and its gaps are tracked in public issues that Clew can cover itself. Schedule-X puts moving an
event behind a paid plugin and has no accessibility documentation; MUI X Scheduler brings Material UI and
Emotion; EventCalendar is compiled Svelte with no keyboard story; ilamy needs Tailwind; react-big-calendar is
dormant; Toast UI is archived. FullCalendar's own headless package would fit the Astryx rule best but is
undocumented beta; when it is documented, moving the rendering to Astryx components is a new decision.

**Replaces.** The sentence "The week view is an Astryx Grid agenda, not a time grid" in `CLAUDE.md`, now
narrowed to the start-page card, and the session-16 note that the week agenda stays Clew's own `WeekAgenda`
(`docs/reviews/2026-11-04-design-exploration-scheduling-and-attention.md`), likewise narrowed.

**Amended 2026-11-05 by D47.** The start page's week agenda (§6) reflows with `Grid columns={{ minWidth, max }}`, and a booked event is text with its time.
