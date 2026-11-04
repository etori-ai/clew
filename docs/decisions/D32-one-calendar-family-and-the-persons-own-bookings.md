# D32 · One calendar family, and a person's own bookings as use cases

**Status:** accepted · **Date:** 2026-11-04 · **Area:** ui

**Decision.** The calendar is one family of three members, and every calendar write is a use case with an audit
row, never a tool.

1. **Three members, one mapping.** `EventCalendar` (`packages/ui/src/calendar.tsx`, FullCalendar 7 under the D27
   theme) is the page's grid and, `compact`, the embedded day strip and list; `WeekAgenda` (Astryx `Grid`) stays
   the read-only week on a start-page card; Astryx `Calendar` is the month picker ("Gå till datum", the booking
   form). The embedded presets live in `packages/ui/src/calendar-embeds.tsx` and import no FullCalendar:
   `DayStrip` (one day on its axis, for a `LayoutPanel`, a `Drawer` or a `Dialog` of 380 px or more), `EventList`
   (a day or a week as a list with a heading per day, down to 280 px, so a chat bubble on a phone), `DatePicker`.
   `agendaItems()` (`packages/ui/src/agenda-items.ts`) is the only mapping from `CalendarEvent[]` and
   `Proposal[]` to what any of them draws; an `AgendaItem` carries the event or the proposal it stands for, so a
   dialog can act on it. The time-grid week renders on the page alone; a phone gets `listWeek`, `timeGridDay`
   and `dayGridMonth`.
2. **Where the family is used.** The calendar page (Dag / Vecka / Månad, addressable as `?datum=&vy=`), the side
   panel's day view (the `calendar.day` read capability, drawn as `DayStrip` with each entry opening the event
   dialog), the event dialog's own day strip, and the proposals' week under a proposal answer in the transcript
   (`EventList` in a ghost bubble, the `ai-chat` template's card-in-a-bubble).
3. **Writes are use cases.** `apps/server/src/modules/calendar/usecases/events.ts` holds `createEvent`,
   `rescheduleEvent`, `cancelEvent` (a person's own booking: `If-Match` through the provider's revision, organiser
   only, a lost reply read back by uid before it is recorded as `event.create_unknown`) and `moveProposal` (the
   draft's time changes under the same collision rules as the draw; nothing is sent until confirm). Each writes its
   audit row (`event.created`, `event.rescheduled`, `event.cancelled`, `proposal.moved`). Routes under
   `/api/calendar/*` and `/api/threads/:id/proposals/:id/move` stay thin. None of these is a capability or a tool
   (D8); a person's own booking is their own execute and needs no decision endpoint; confirm stays the one place an
   invitation goes out. The browser's `CalendarEvent` carries `ref`, `revision`, `canCancel`, `recurring` and the
   organiser's name for this.
4. **Every action has a keyboard path.** "Ny bokning" is an Astryx form dialog (title, `DateTimeInput`, `TimeInput`,
   `MultiSelector` of the unit's members, `Selector` of rooms, a free-busy check as rows with a `StatusDot`); a span
   dragged on the grid only fills it in. An entry opens with Enter into a `Dialog` (the day strip, a `MetadataList`,
   then Flytta, Ställ in with an inline confirmation, Flytta förslaget, Visa dagen). Drag of a proposal calls the same
   move as the dialog and is put back when the server refuses.

**Why.** D27 chose the library and the theme; this settles what is built on it. The provider port already had
`create`, `reschedule` and `cancel` with revisions and read-back (the review of 2026-11-04 noted "the gap is the
UI, not the port"), so the writes needed one layer, not a new contract. One component family with one mapping
keeps the same hour looking the same in the panel, the dialog, the transcript and the page, and keeps FullCalendar
in one file as D27 requires. The product owner chose FullCalendar's list and month on a phone over the Grid agenda
(2026-11-04), so the agenda stays the card's. Astryx gaps met: `Calendar` cannot mark days that hold events (no
`renderDay`); recorded here, not filed, per the standing decision not to send gap reports.

**Replaces.** Narrows D27 §2: FullCalendar is imported in `packages/ui/src/calendar.tsx` alone, and the embeds
compose it from outside. Retires `WeekAgenda`'s `detailed` mode (the phone's calendar page), which has no consumer.
Withdraws the HANDOVER §5 line "no drag-to-move" for proposals, already amended by D27 §4.
