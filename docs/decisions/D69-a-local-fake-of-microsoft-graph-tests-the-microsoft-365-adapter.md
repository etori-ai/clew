# D69 · A local fake of Microsoft Graph tests the Microsoft 365 adapter

**Status:** accepted, built 2026-11-06, in the development stack for one persona since the same day, not yet run against a real tenant · **Date:** 2026-11-06 · **Area:** integrations

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

**Amended 2026-11-06**, when the commit was merged as D69 (pushed as D61, a number this repository had already used for
the fixture connectors) and read against the decisions it rests on
([review](../reviews/2026-11-06-microsoft-365-adapter-against-the-decisions.md)): the fake is a test double in the
sense of D61, run in-process by the unit suite and as the `graph` service of the development stack, and the server
never imports it. The synthetic directory in `accounts.ts` had imported it for the fixture token's convention, which
put the fake in every deployment's module graph; the convention now lives in `accounts.ts` and the dependency cruiser
refuses an import of `fake-graph.ts` from `apps/` or `packages/`. The adapter itself stands as built: it sits behind
the factory of D11, keeps the ledger's rules of D45 and D47 (a reference before the write, a read-back as the receipt,
no undo without the exact revision), and the room's late answer is the one thing D47's bounded watch could carry when
rooms are used for real.

**Amended 2026-11-06, second**, when the product owner asked for the Microsoft 365 adapter to be seeded in the
development stack and brought to the level the fixture connectors have under D61 and D66. Microsoft 365 is an adapter of
the core `calendar` connector (D11, D61), not a connector of its own: it is never a row that `dev:connectors` registers,
and a second, protocol-side calendar would contradict D11. What "on par" means for an adapter is therefore this:

1. **The fake is part of the base stack.** The `graph` service leaves its compose profile and runs beside the six
   fixture connectors, so "Reopen in Container" brings it up with them. It seeds itself as it starts, as the fixtures
   do: `scripts/fake-graph.ts` books the synthetic meetings in `scripts/calendar-fixtures.ts` (one list for both
   development calendars, shared with `calendar-seed.ts`) through the adapter over the network, and `/health` answers
   503 until the seed is in place, so `--wait` means seeded. State lives in memory, so `sh scripts/graph.sh seed` is a
   restart and a fresh seed from today. It is published on loopback at 4047 for a look with curl.
2. **The fixture directory is a mixed estate.** `accounts.ts` binds Mikael to Microsoft 365 over the fake and keeps
   Hillevi and Hassan on CalDAV in Nextcloud, which exercises D11's selection per account in one BFF with nothing to
   restart or configure; `CALENDAR_ADAPTER=microsoft365` still binds every account to the fake and `=caldav` every
   account to Nextcloud. Mikael has no unit, so no slot search crosses the two systems; a manager with a team on one
   system and rooms on another is the open question the review named, not something this amendment answers.
3. **The calendar's reads carry their contracts and the rooms declare a view.** `calendar.today`, `calendar.week` and
   `calendar.day` declare the browser's `TodayView`, `WeekView` and `DayView` schemas as their outputs instead of
   `Type.Any()`, and `tests/unit/panel-labels.test.ts` holds their fields to the Swedish label list as it holds the
   fixtures'. They declare no `view` on purpose: the calendar family draws them (D32), and a table would be a second
   mapping. The one read whose output is rows like any connector's is new: `calendar.rooms`, a `table` of the rooms
   the person's calendar knows (name, seats, equipment), drawn by the one renderer, a tool "Mötesrum" when an
   administrator chooses it (D40), and a read the model may answer a room question from.
4. **What does not apply.** The calendar declares no `scan`, so there are no drafts with `occurrences` and `reason`;
   its proposals keep their own lifecycle (D47). Its writes are human decisions in `decisions.ts` with receipts that
   already name a room's pending or declined answer (D45, D47), and no calendar write has a document to review, so
   `review`/`preview` (D70) do not arise. `scripts/connector-check.ts` checks a connector's protocol and cannot check a
   calendar adapter; the stack's fake is checked instead by `tests/calendar/graph-provider.test.ts`, which runs the
   adapter contract against the running service through `bun run test:calendar`, beside the Nextcloud run.

5. **A bundled row follows its code.** The administration page draws a connector from its stored row, and a bundled
   connector's row was written once, at the first boot, so the Kalendern page showed the description of 2026-11-04 and
   neither `calendar.day` nor the rooms. `syncBundledRows` now writes the current description over an existing bundled
   row when it differs (keys compared in canonical order, so a jsonb round trip is not a change), through the health
   path: no audit row, no version bump, the administrator's governance untouched, as a remote row takes a refetched
   manifest.

Not run: a signed-in pass as Mikael in the browser on the Microsoft 365 binding. The binding was verified from the
container (eight meetings, seven rooms, the declined room empty) and the contract passed over the network.

**Replaces.** Nothing. It adds a test double and the build status to D11.
