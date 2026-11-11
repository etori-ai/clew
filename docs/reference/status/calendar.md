# Implementation status: calendar

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Calendar

**Works in this checkout.** CalDAV adapter and core calendar paths. The Microsoft 365 adapter passes the same contract against a local fake of Microsoft Graph, which runs in-process in the unit suite and as the `graph` service of the base development stack, self-seeded, never imported by the server (D69, amended). The development directory is a mixed estate: Mikael's calendar is Microsoft 365 over the fake, Hillevi's and Hassan's are CalDAV; `CALENDAR_ADAPTER` binds everyone to one. The calendar's reads declare their output schemas and Swedish labels, and `calendar.rooms` is a declared table view that an administrator can put in the menu as Mötesrum.

**Limits and pending work.** The Microsoft 365 adapter has not met a real tenant, and no delegated token reaches it, so it runs only in development. Today, the week and a day are drawn by the calendar family, not by a declared view (D32). No signed-in browser pass on the Microsoft 365 binding yet.

**Evidence.** [Adapter factory](../../../packages/calendar/src/adapters.ts), [directory](../../../packages/calendar/src/accounts.ts), [connector](../../../apps/server/src/modules/calendar/connector.ts), [D11](../../decisions/D11-one-calendar-contract-two-adapters.md), [D69](../../decisions/D69-a-local-fake-of-microsoft-graph-tests-the-microsoft-365-adapter.md), [tests](../../../tests/unit/calendar-connector.test.ts)

## Calendar follow-up

**Works in this checkout.** Approved bounded policies, two reminders maximum per invitation, two working days apart, 30-day expiry, current assignment checks and transactional invitee cards/counters/audit.

**Limits and pending work.** Legacy invitations are paused for review; no implicit authorization for new automatic policy.

**Evidence.** [Follow-up](../../../apps/server/src/modules/calendar/usecases/followups.ts), [shared contract](../../../tests/followup-contract.ts)
