# Implementation status: calendar

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Calendar

**Works in this checkout.** CalDAV adapter and core calendar paths. The Microsoft 365 adapter passes the same contract against a local fake of Microsoft Graph, which runs in-process in the unit suite and as the `graph` service of the base development stack, self-seeded, never imported by the server (D69, amended). The development directory is a mixed estate: Mikael's calendar is Microsoft 365 over the fake, Hillevi's and Hassan's are CalDAV; `CALENDAR_ADAPTER` binds everyone to one. The calendar's reads declare their output schemas and Swedish labels, and `calendar.rooms` is a declared table view that an administrator can put in the menu as Mötesrum. An event's `id` is the source's own handle and may be up to 1 000 characters: a Nextcloud handle is the base64 of its CalDAV path, over a hundred, and until 2026-11-11 the registry refused every `calendar.today`, `calendar.week` and `calendar.day` answer with an event in it for a person on Nextcloud, which left the model's calendar tools and the action dialog's day without data.

**Limits and pending work.** The Microsoft 365 adapter has not met a real tenant, and no delegated token reaches it, so it runs only in development. Today, the week and a day are drawn by the calendar family, not by a declared view (D32). No signed-in browser pass on the Microsoft 365 binding yet.

**Evidence.** [Adapter factory](../../../packages/calendar/src/adapters.ts), [directory](../../../packages/calendar/src/accounts.ts), [connector](../../../apps/server/src/modules/calendar/connector.ts), [D11](../../decisions/D11-one-calendar-contract-two-adapters.md), [D69](../../decisions/D69-a-local-fake-of-microsoft-graph-tests-the-microsoft-365-adapter.md), [tests](../../../tests/unit/calendar-connector.test.ts)

## The calendar page

**Works in this checkout.** [D112](../../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 9, board Calendar. `EventCalendar` (D27, D32) is unchanged. An event or a proposal chosen in the grid opens in the panel in the end slot (`entry` in the address), in place of the Förslag panel: a meeting with when it is and, unfolded, where, who organises it and who comes, "Du är inbjuden" when the person does not organise it, and "Flytta …" and "Ställ in …" on a booking of their own (the entry's dialog, opened at that step); a proposal with "Förslag, inte bokat", the round's last day, when and with whom, and its existing decisions: "Skicka inbjudan" for that time, "Flytta …" (the dialog; drag is never the only way), "Föreslå andra tider", "Ångra" while the calendar allows it and "Öppna som sida" (its work item). "Förslag N" in the header lists the proposals that wait, each a link to its week with it open in the panel; "Fråga om veckan" (or om dagen, om månaden) makes the range on screen the thing, with what is booked and what waits in it. The box beside any of them asks about it (D112 item 7).

**Limits and pending work.** A meeting someone else organises has no buttons: the calendar source offers the invitee no reply of their own, so "Ändra mitt svar …" (the board) is not drawn, and the person's own answer is not shown. An answer that proposes a time is not drawn in the grid: the calendar family can draw a time not yet saved (`agendaItems`' `chosen`), but an answer carries no time as data unless it is an action's draft, and a draft belongs to a work item, not to the calendar; the grid is left as the calendar reads it. On a phone the head keeps its two full rows and has no "Fråga om veckan"; an entry opened there has its box in the drawer. The browser scenarios (`tests/a11y/calendar.spec.ts`) passed on routed data on 2026-11-12; no signed-in pass on the development stack and no screen-reader pass.

**Evidence.** [page](../../../apps/web/src/pages/calendar.tsx), [event dialog](../../../apps/web/src/components/calendar/event-dialog.tsx), [decisions](../../../apps/server/src/modules/calendar/usecases/decisions.ts), [browser evidence](../../../tests/a11y/calendar.spec.ts)

## Calendar follow-up

**Works in this checkout.** Approved bounded policies, two reminders maximum per invitation, two working days apart, 30-day expiry, current assignment checks and transactional invitee cards/counters/audit. An invitee is found by the person's id, which a proposal stores beside the address it was drawn with (migration 0054), so a changed work address keeps the reminders, the booking and the round's count; the invitation still goes to the stored address and replies are matched on it, and an alternative after a decline goes to the address the team has now.

**Limits and pending work.** Legacy invitations are paused for review; no implicit authorization for new automatic policy.

**Evidence.** [Follow-up](../../../apps/server/src/modules/calendar/usecases/followups.ts), [shared contract](../../../tests/followup-contract.ts), [proposal store contract](../../../tests/proposal-store-contract.ts), [planner tests](../../../tests/unit/samtal.test.ts)
