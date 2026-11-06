# Review: the Microsoft 365 adapter commit against the decisions · 2026-11-06

**What was reviewed.** Max Eriksson's commit `f59457c` on origin ("Microsoft 365 adapter tested against a local fake of
Graph", merged to this tree's `main` as `60f6d60` with its decisions renumbered D68 and D69), read file by file against
the decisions it rests on: D11 and D32 (one calendar contract, one calendar family), D25 (ports and purity), D45 and
D47 (approved intent, durable identities), D61 (fixture sources as independent services), D62 (users are core
entities), the vision's line on the directory, and the working rules in `CLAUDE.md`. The product owner asked on
2026-11-06 for the commit to be folded into this tree's work and reoriented around its decisions.

**Short answer.** The adapter itself is right by the decisions and stays as built. Two things were out of line and
are fixed in this commit: the server imported the test double, and the identity document called users a core
connector. One thing was missing and is added: the receipt now says what the calendar holds about a room. The rest
are open items the commit names honestly, listed at the end with where each belongs.

## Findings

1. **The adapter sits behind the factory (D11, D32). Holds.** `Microsoft365Provider` implements `CalendarProvider` and
   is chosen by `CalendarCredential.kind` in `adapters.ts`; nothing above the factory knows which protocol a calendar
   speaks, and the planner, the decision endpoint and the UI are untouched. The adapter contract
   (`tests/calendar-provider-contract.ts`) runs on both adapters, which is D11's promise made testable. One fixture
   detail: the synthetic directory in `accounts.ts` chooses the adapter with one variable for every account
   (`CALENDAR_ADAPTER`), where D11 argues for selection per account so a mixed estate works. The fixture therefore
   cannot show a mixed estate. Left as it is: the directory is synthetic and the real binding per person comes with
   D68's provisioner.

2. **Purity (D25). Holds.** `fetch`, `setTimeout` and `Date` are in the adapter, which is where they belong; the use
   case changes in `decisions.ts` and `samtal.ts` read no clock and no configuration. `bun run purity` and the
   dependency cruiser pass. `accounts.ts` reads `CALENDAR_ADAPTER` and `GRAPH_URL` the way it already read
   `CALENDAR_URL`: it is the fixture directory, guarded by `CLEW_POC`.

3. **The fake as a fixture (D61). Fixed.** The fake runs as the `graph` service of the development stack and in-process
   in the unit suite, which is how the fixture connectors run too, and a call it does not implement answers 501. But
   `accounts.ts` imported `fakeGraphToken` from `fake-graph.ts`, and `apps/server/src/composition/calendar.ts` imports
   `accounts.ts`, so every deployment's module graph carried the test double. The token convention now lives in
   `accounts.ts` (the fixture directory, which already owns the synthetic accounts), `fake-graph.ts` imports it from
   there and re-exports it for the tests and the service, and a dependency-cruiser rule refuses an import of
   `fake-graph.ts` from `apps/` or `packages/`. Recorded as an amendment to D69.

4. **D68 against D62 and the vision. Reconciled in writing.** D68 (people are pushed into Clew through standard SCIM,
   mapping outside Clew) and D62 (users are core entities, not connected systems) agree on the two things that matter:
   users, login and grants are Clew's core, and the thing that supplies them (a provisioner) is not a connector. Both
   keep the directory outside Clew, as the vision says. They differ on where a capability comes from: D62 keeps the
   locally written grants of today, D68 item 2 makes group membership the only authority once a provisioner runs. The
   relation is recorded in D68: until D68 is built D62 governs; when it is built the `capability:<name>` groups replace
   the local grants. `docs/architecture/identity.md` called users "a core connector" and now calls them core entities.
   D62 is written in another session of the same day and lands separately; D68 names it without a link until it does.

5. **Approved intent and durable identities (D45, D47). Holds, and one addition.** No undo is offered while a room has
   yet to answer, because the answer changes the event's revision and the ledger accepts only the exact revision it
   stored; a stale undo would fail on its first try and could not be retried from a fresh read. That is D45 applied,
   not worked around. A declined invitation keeps the revision that holds the answer, so the replacement's cancel
   carries the right one (D47's occurrence identity). What the receipt said was incomplete: "Kontrollerat i kalendern"
   for a booking whose room had not answered, or had said no. The receipt is the read-back, so it now says
   "Rummet har inte svarat än, så bokningen kan inte ångras härifrån" and "Rummet tackade nej, så mötet saknar rum"
   (principle 5: the person sees why), with a case in `tests/unit/microsoft365.test.ts`.

6. **Language and form. Holds.** Every message a person reads is Swedish; identifiers, comments, scripts and the
   decisions are English; Prettier is clean.

7. **Documents.** The status table's Calendar row names the fake and its limits; D11's status names D69; HANDOVER
   item 10 keeps the token path open. The commit's two decisions were pushed as D60 and D61, numbers this tree had
   taken for the served protocol and the fixture connectors; they are D68 and D69 here with every reference following
   (the merge commit `60f6d60`), which keeps the duplicate pairs at the historical D37–D39 and D44–D46.

## Open, with where each belongs

- **The room's late no.** A room that declines after the receipt leaves the meeting without a room and nothing tells
  the person. D47's bounded watch (the jobs' watch step, D55) is the one conditional timer Clew has, read as the
  person and settled in the ledger; a booking with a room could carry a watch on the room's answer. That needs a
  decision before rooms are used for real; D69 names it.
- **The token path.** The ledger dispatches without a session (`needsSession: false`); a delegated Graph token must be
  obtainable in the background, or calendar writes move to `needsSession: true`. HANDOVER item 10, unchanged.
- **A mixed estate in the fixture directory** (finding 1), and the real per-person binding, come with D68's
  provisioner.
- **D68's "must land first"**: `authorizationVersion` must stop hashing the whole person row, and `granted()` must
  narrow the nightly scan, before a municipality is pushed. Unchanged by this review.
- **A real tenant.** D69's list of what the fake cannot prove stands until one exists.
