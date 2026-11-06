# D61 · A local fake of Microsoft Graph tests the Microsoft 365 adapter

**Status:** accepted, built 2026-11-06, not yet run against a real tenant · **Date:** 2026-11-06 · **Area:** integrations

**Decision.** The `microsoft365` adapter from [D11](D11-one-calendar-contract-two-adapters.md) is built in
`packages/calendar/src/microsoft365.ts` and is tested against `packages/calendar/src/fake-graph.ts`, a fake of the part
of Microsoft Graph v1.0 the adapter calls. The fake is written here from Microsoft's public documentation, runs on Web
`Request`/`Response` with no dependency, and needs no Microsoft account, tenant or network. The only difference between
local and live is the adapter's base URL and where its token comes from.

- The unit suite serves the fake on loopback. `sh scripts/graph.sh start` runs it as the `graph` service of the
  devcontainer, in the `graph` profile, and seeds it with the synthetic meetings. `CALENDAR_ADAPTER=microsoft365` on
  the BFF binds the synthetic accounts in `accounts.ts` to it; `caldav` stays the default.
- `tests/calendar-provider-contract.ts` is the calendar's adapter contract. It runs on the adapter over the fake in
  `bun run check` and on the Nextcloud adapter in `bun run test:calendar`. A real tenant is a third harness when one
  exists.
- The fake answers a call it does not implement with `501`, so a gap fails loudly instead of looking like an empty
  calendar.
- A room is an attendee of type `resource`. Its answer comes after the booking, as in Exchange, so `create` may return
  `pending`. `roomDelayMs` sets the delay, and the fake decides the answer from the room's calendar.

Graph assigns an event's id, but the execution ledger needs a reference before anything is written and a read that
finds the attempt after a lost reply (D45/D47). So the adapter stores Clew's uid in a single-value extended property,
sends the same uid as `transactionId`, and an event with that property has the reference `microsoft365:uid:…`, which a
filter on the property resolves. An event Clew did not create keeps `microsoft365:id:…`.

**Why.** The review of the calendar and a manager's team found that no real calendar can be reached and that the
Microsoft 365 adapter blocks real use, and HANDOVER item 10 says it needs an Entra tenant. Writing the adapter against a
fake moves that work ahead of the tenant and tests what a tenant makes hard to provoke: a room's late answer, refusals,
stale revisions and throttling. A Microsoft 365 developer tenant was the alternative, but no build, run or test may
require a vendor account. Microsoft's Dev Proxy was the other: it adds a .NET tool to the stack, and its licence could
not be read from the repository metadata on 2026-11-06.

**Cost.** The fake proves that the adapter agrees with this repository's reading of the documentation, not that
Microsoft behaves that way. Unverified until a tenant run:

- `If-Match` on `PATCH`, `DELETE` and `accept` is not documented on those pages, so the adapter also compares the
  revision itself before writing, and it treats both `409` and `412` as a stale revision.
- That `transactionId` stops a duplicate, and that a filter on an extended property sees a new event at once.
- How an all-day event's time reads under `Prefer: outlook.timezone="UTC"`. The adapter refuses anything but a UTC
  midnight rather than guess a day, so if Graph converts these times, a calendar holding an all-day event fails to
  load until the adapter is changed.
- That an attendee's copy keeps its own answer in `responseStatus` while its `attendees` list goes stale.
- How soon `accept`'s `202` shows in a read. The adapter returns the event with the answer it sent when the read still
  shows the old one.
- Whether Sundsvall's rooms are room mailboxes at all, whether they refuse conflicts and how complete `/places` is.
  `exclusiveRooms` therefore stays `false`.

A room's answer changes the organizer's event, and so its revision. An undo carries the exact revision read at
dispatch, and the ledger refuses any other payload, so a stale undo cannot be retried from a fresh read. No undo is
therefore offered while the room's answer is pending, which on Microsoft 365 will usually mean that a booking or a
move with a room has no undo and the person changes the meeting instead. A guest's reply has the same effect on both
adapters: the undo is refused and its row stays `unknown`.

A room's answer can also come after the receipt. A room that declined leaves `room` empty, so the calendar stops
showing it, but nothing yet tells the person. That has to be built before rooms are used for real.

The token path (HANDOVER item 10) is not settled by this decision, but it has one requirement: the execution ledger
dispatches and reads back without a session (`needsSession: false`), possibly after the person's session has ended. A
delegated token must therefore be obtainable in the background, or calendar writes must move to `needsSession: true`,
which leaves decisions already queued at `source-contract-changed`.

**Replaces.** Nothing. It adds a test double and the build status to D11.
