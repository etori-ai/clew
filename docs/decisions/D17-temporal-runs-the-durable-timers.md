# D17 · Temporal runs the durable timers, starting with a person's own reminders

**Status:** superseded by D85 (2026-11-09: DBOS Transact replaces Temporal; the worker, the server services and the legacy `reminder` function are gone) · **Date:** 2026-11-04 · **Area:** platform

**Decision.** Temporal (MIT; server `temporalio/auto-setup` 1.29.7 in the devcontainer with its two
databases in the shared Postgres, UI `temporalio/ui` 2.58.0 on port 3023, TypeScript SDK 1.25.0) is
Clew's engine for durable timers and workflows. The worker runs inside the BFF process on one task queue,
`clew`, with the workflows in `apps/server/src/temporal/workflows.ts` and the activities beside them.
The first workflow is `reminder`: a person's own timer set from a card ("Påminn mig …"), which waits,
can be cancelled by signal (Ångra on the toast), and then brings that card back. While the timer runs the
card is parked under "Pågår utan dig" ("Väntar på påminnelsen 10:16"). When it fires the card is reopened
in its own place in the stream, marked `remindedAt` with a red "Påminnelse" badge, its trigger saying "Du
bad 09:44 om en påminnelse", and a persistent toast "Påminnelse: …" with "Visa" announces it beside the
composer. Nothing pushes the stream down and nothing hides behind an icon. A reminder never creates a
second card and never duplicates the card's actions; a card already handled with a receipt is left alone. If Temporal is unreachable the page works
and reminders say they are unavailable (D8).

The nightly scan, `undo-expiry` and `receipt-final` stay on the Postgres `job` table (D15) until they
are moved; moving them is a bounded next step, not part of this decision.

**Why.** User-set reminders and watches are the first dynamic trigger from `scheduled-work.md`, and the
product treats the scheduler as central: many short-lived, person-owned, editable timers whose state the
person expects to see and change. Building them on the `job` table and migrating later would mean two
migrations. Temporal fits the problem (timers of any length, signals, retries, queries, a UI) and the two
objections raised, Node-only worker and operational weight, were dismissed: the runtime is Node (D16),
and Clew is operated hosted for most municipalities, so one more well-known component is routine.

**Replaces.** Narrows D15 ("Temporal later") to "Temporal now for new timers, the existing three job kinds
migrate later". D15's status is updated accordingly.

**Amended 2026-11-05 by D49.** The button sits only on a card that waits on someone; an open card's Inte nu ends the same way. A reminder keeps who the card waits on, and the card comes to the person when it fires.
