# D104 · The model does the work: a floor holds without it, and the assistant may act alone within governed limits

**Status:** provisional (product owner, 2026-11-10; the direction is chosen, the governance is not designed and nothing is built; accepted when one action has been carried out by the assistant alone, under a level an administrator set, against a source that was not written for Clew) · **Date:** 2026-11-10 · **Area:** product, platform

Written on 2026-11-10 under the working number D103 and numbered D104 when it landed on 2026-11-11, by
[D102](D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md)'s rule.

**Decision.** Two rules that have bound every session since the first week are changed in direction.
[D8](D08-every-action-works-without-the-model.md) said the model is an accelerator and never a dependency, and
that it never calls `execute`. `docs/vision.md` and `CLAUDE.md` repeat both. From this record on:

1. **The model is the main way work gets done.** Clew is designed for the assistant doing the work: reading what
   a person writes, choosing capabilities and calling them, preparing what needs a decision and, within limits,
   carrying things out. A feature may depend on the model. It no longer needs a second, deterministic path to be
   allowed.
2. **A floor holds without a model.** Core features keep working when no model is attached or the provider is
   down. The floor, as far as it is named today:
   - seeing what needs the person: the scans, the stream and its cards;
   - opening a card and deciding it, with its receipt and undo;
   - opening a tool, a list and a record, and starting an action from a menu;
   - signing in, and administration.

   Everything on the floor stays testable without a model. A feature above the floor says plainly when it is
   unavailable, as D8's explicit degraded state already requires; that part of D8 stands. A new feature says
   which side of the floor it is on.
3. **The assistant may act on its own, on some things.** Where today every write waits for a person's decision,
   a capability can come to stand at one of three levels: the assistant may read it; the assistant may prepare it
   and a person decides (today's rule, and the default); the assistant may carry it out alone.
4. **Acting alone is governed, and sensitive actions are never the assistant's.** The level is set by governance,
   not by the model and not by a prompt. An action that is sensitive stays locked to a human decision, whatever
   else is allowed. What makes an action sensitive, and who says so, is open (below).

What is not decided by this record, and is not to be assumed by a session reading it:

- Who decides that an action is sensitive: the connector that declares it, an administrator per installation, a
  list Clew holds, or a ceiling from the first that the second can only lower.
- Whether the level is set per installation, per unit or per person, and whether a person must agree before the
  assistant acts for them.
- What the assistant may do while the person is not signed in. Delegated work runs with the token of the session
  that asked ([D103](D103-the-session-that-asked-stands-behind-delegated-work.md)): a write for as long as that
  session lives, a scan only while the person was recently active, and `needs-session` otherwise.
- How an act the assistant carried out alone is undone, by whom, and for how long.
- Limits beyond the level: how many, how often, what amount, which records.
- What the assistant must never act on: a sentence found in a document, a card or a source row is content, not an
  instruction, and an assistant that can act alone needs that line drawn before it can.
- What exactly belongs to the floor beyond the list in item 2.
- How the three levels show in the interface. The discovery canvas of the same day draws candidates; none is
  chosen.

Mechanics this record proposes for whoever designs the governance, none of them decided: the default is that a
person decides; acting alone is off until an administrator turns it on for a capability, with an audit row, as
the model switch and the lens choice are set today; an act the assistant carries out alone still runs as the
person through the execution ledger (D45), with the person's authorization checked at that moment and an audit
row that names the assistant as the one that acted and links the model turn (D91); only a write that can be read
back or deduplicated is eligible (D99 item 4); and the person sees afterwards everything the assistant did
alone, with undo where the source offers it.

**Until something is built, nothing changes in the code or in what a session may build.** An `execute` is still
never a model tool (the loader refuses it, `packages/connectors/src/validation.ts`), assistant proposals are still
carried out only through the human decision endpoint, and the freeze on new surface
([D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)) holds. This record changes what a design may assume and what a later
decision may build on. A request to build acting alone gets a decision of its own for the governance first.

**Why.** The product owner, 2026-11-10, correcting two rules that had been passed to a design discovery as
binding: "Not EVERYTHING must work without ai model. AI will definitely be the main power for doing the work, but
we should at least try and keep core features functional even without AI models attached." And: "AI should also
be allowed to act on some things on its own. This needs to be governed somehow though, sensitive actions etc
should not be allowed by AI."

D8 was written on the project's first day, when the model was one optional provider behind a start page and the
argument was that a municipality's page must not stop because a vendor's API is down. That argument still carries
the floor. What it no longer carries is the rule that every feature needs a path without the model, which has
shaped the product since: the deterministic router beside the model, the menu as the only way to start an action,
and an assistant that answers "Jag har inte möjlighet att registrera sjukfrånvaro" about an action the system has.
The same day's discovery began from the owner finding it hard to tell what the chat can do; a chat that may only
ever prepare, and is designed so that everything also works without it, has little it can show.

Alternatives weighed. **Keep D8 as written and treat the owner's words as a wish:** every session reads D8 and
`CLAUDE.md` and builds to them, so an unrecorded change of direction is undone by the next session. **Rewrite D8,
the vision and `CLAUDE.md` now:** the governance does not exist, and rules that allow acting alone before there is
a way to govern it would be the opposite of what was asked. **Decide the governance here:** it was not asked for
and has consequences for connectors, administration and audit that deserve their own record.

**Not established.** Everything about how. No capability can be carried out by the assistant alone, no level can
be set, and no source that was not written for Clew has met any of it. Whether administrators in a municipality
would allow any write to be made by an assistant alone, and which, has not been asked of anyone outside the team.

**Replaces.** Refines [D8](D08-every-action-works-without-the-model.md): its floor and its explicit degraded
state stand; "nothing that reads, proposes or executes may have the model in its only path" and "it never calls
`execute`" become the default and the starting point, no longer the limit. When the governance is decided and
built, three texts follow: the paragraph "The assistant takes the initiative, the person decides" and the row
"Never a tool, for anyone" in `docs/vision.md`; the working rule in `CLAUDE.md` that assistant proposals are
executed only through the human decision endpoint; and item 3 of
[D55](D55-a-job-is-assembled-from-what-connectors-follow-approved-once-and-run-per-system.md). They are not
edited by this record. [D45](D45-approved-intent-precedes-source-dispatch.md),
[D91](D91-one-logger-opentelemetry-export-and-the-model-turn-in-the-audit-trail.md) and
[D99](D99-an-unresolved-job-step-reaches-a-person-and-is-finished-forward.md) are what an act of the assistant's
own would run on.
