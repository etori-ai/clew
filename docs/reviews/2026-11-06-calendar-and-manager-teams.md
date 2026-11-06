# Review: the calendar and a manager's team · 2026-11-06

Date: 2026-11-06

Reviewed revision: `0857b46`, with the uncommitted calendar work of the same day in the tree
Status: review and recommendation; no decision changed

## Question

The product owner asked how the calendar works, how it integrates with a manager's team, and what it would take for
a person to get support booking meetings with others.

## Assessment

The calendar's engine is sound and the team is not really connected to it. Writes, read-back, audit and follow-up are
durable and tested, and the provider port is enough for meetings with others. But the team a person can invite is a
hard-coded fixture, the only time-finding is built for utvecklingssamtal, and the calendar cannot run against a real
calendar system at all. The result today is one manager in a demo unit who can check a time they already picked.

## What exists

| Part | State | Where |
|---|---|---|
| Calendar page, day strip, lists | Built (D27, D32) | `packages/ui/src/calendar.tsx`, `apps/web/src/pages/calendar.tsx` |
| Own booking with guests and a room | Built; a decision card through the execution ledger, free-busy re-checked at dispatch | `apps/web/src/components/calendar/booking-dialog.tsx`, `apps/server/src/modules/calendar/usecases/decisions.ts:111` |
| Free-busy check for one chosen time | Built | `checkAvailability`, `apps/server/src/modules/calendar/usecases/events.ts:84` |
| Utvecklingssamtal: find slots, confirm, wait, remind, close | Built, and the fullest flow in the product | `usecases/samtal.ts`, `usecases/followups.ts`, `packages/calendar/src/proposals.ts:36` |
| CalDAV adapter | Built; Nextcloud in development | `packages/calendar/src/nextcloud.ts` |
| Microsoft 365 adapter | Throws; D11 decided it, nothing built | `packages/calendar/src/adapters.ts:25` |

## How the team is modelled

A team is not a concept in Clew. There is a person with one grant holding one `unitId` and one `role`
(`apps/server/src/auth.ts:274`), and the list of people a booking may invite is `CalendarBinding.members`:

```ts
members: persona.role === 'manager' ? (units[persona.unitId] ?? []) : [],
```

`units` is a constant in `packages/calendar/src/accounts.ts:25` with one entry, `unit-skola`, and four invented
people. The file calls itself a synthetic directory, and `bindCalendar` throws unless `CLEW_POC=true`.

The phone book connector holds a real-looking team (`telefonbok.team`, by unit) but has no link to the calendar. Its
manager is a display name on the contact card (`connectors/telefonbok/directory.mjs:41`), not a relation anything can
follow.

## Findings

Blocking real use:

1. **No real calendar can be reached.** `bindCalendar` refuses to run outside the POC flag and knows three accounts,
   and the municipality runs Microsoft 365, whose adapter is unimplemented. HANDOVER item 10 (how a delegated Graph
   token reaches the BFF) is still open, and it needs an Entra tenant.
2. **The team is a fixture.** Nothing reads unit membership from SCIM, Clew's grants or the directory.

Limiting what people can do:

3. **Only managers can invite, and only their own unit.** An employee gets an empty list ("Bara du själv"), which
   excludes the undersköterska and handläggare personas. A manager cannot invite their own manager, a peer manager or
   anyone in another unit. `createEvent` enforces this on the server ("Deltagarna måste tillhöra din enhet"), so it is
   a rule and not only a UI gap.
4. **Nothing finds a time.** The person guesses a time and checks it. `planWeek` is the only slot search, and it plans
   1:1 utvecklingssamtal between one manager and many people. It cannot answer "when can these five meet".
5. **The assistant cannot help.** The model's calendar tools are `calendar.today`, `calendar.week` and `calendar.day`,
   all of the person's own calendar. It has no free-busy read and no way to lay a booking proposal; the only proposal
   path is utvecklingssamtal.
6. **A meeting cannot be booked over a conflict.** Dispatch requires every invitee to be readably free
   (`usecases/decisions.ts:312`). One busy or unreadable calendar fails the whole booking with "Tiden kunde inte
   bekräftas som ledig", and the check before Boka is optional, so the person learns this on the card afterwards.
   Ordinary meetings are often booked over a soft conflict, so this needs a choice rather than a refusal.
7. **Ordinary meetings have no replies or follow-up.** `toEvent` keeps participant names and drops `response`
   (`usecases/reads.ts:22`), so the organiser cannot see who accepted. Follow-up exists only for utvecklingssamtal.

Small defect, found by reading and not reproduced:

8. **Eight guests and a room breaks the check.** `checkAvailability` sends members and room as one target list, and
   the adapter refuses more than eight (`packages/calendar/src/nextcloud.ts:257`), so the person sees "Ogiltig
   tillgänglighetsperiod" instead of an answer. Dispatch checks the room separately and is not affected.

## Against the vision

Booking support within a unit fits exactly: the vision describes Clew as an orchestrator "for one person and one unit,
not for the organisation chart", and names find the slots, confirm, send the invitations, wait for the answers,
remind and close as the obligation it holds. Inviting across units is not against that, since the invitation is the
person's own act, but it does need a decision: whose free-busy may be read, and from where. The vision also keeps the
employee directory out of Clew, so the list of people must come through the directory connector or SCIM rather than a
new table of teams.

## Recommendation

Order by what removes the most work, and keep the human decision as the only way a booking leaves Clew.

1. **Generalise the slot search.** Split `planWeek` into a general "common free times for these people and this
   length" and a samtal policy on top. Pure domain code, testable on the memory adapters now, and it solves finding 4.
2. **Replace the fixture with a port.** A `People` or directory read that answers "who may this person invite" and
   gives each person a calendar address, with the unit as the first answer and the phone book as the source. This
   solves findings 2 and 3 and needs the decision below.
3. **Let the booking form suggest times.** "Föreslå tider" next to the check, and a stated choice to book anyway over
   a conflict, solving finding 6.
4. **Give the assistant a free-busy read and a booking proposal.** The proposal is a card and the send stays the human
   decision endpoint (D8). This is what makes "boka ett möte med Anna och Erik nästa vecka" work.
5. **Carry replies on ordinary meetings** by keeping `response` in `CalendarEvent`, and reuse the bounded follow-up
   where the organiser asks for it.
6. **Build the Microsoft 365 adapter** when an Entra tenant is available. It is independent of the steps above because
   they all sit above `CalendarProvider`, and it is the step that makes any of this real for a Sundsvall manager.

Step 2 needs the product owner's call: who may invite whom, and whose free-busy a person may see. Free-busy reveals
when a colleague is occupied, so the audience needs a stated rule, and protected records in the phone book must stay
out of the invite list.

## Verified

`tests/unit/events.test.ts` passes in the devcontainer (4 tests). All other findings come from reading the code at the
lines cited. Nothing was run against the live stack, and no screen reader or browser pass was made.
