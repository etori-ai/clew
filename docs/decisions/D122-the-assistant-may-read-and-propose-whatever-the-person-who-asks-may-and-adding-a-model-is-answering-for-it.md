# D122 · The assistant may read and propose whatever the person who asks may, and adding a model is answering for it

**Status:** provisional (product owner, 2026-11-13, said in a working session; nothing is built and nothing outside the repository has tested it) · **Date:** 2026-11-13 · **Area:** assistant, identity, product

**Decision.** [D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md) item 7 kept
every row of a domain Clew owns from a model endpoint "until the installation's rule for classification-gated
inference is settled". This record settles the rule, and it is a rule for the whole platform, not for one domain:
the assistant can read what the person who asks can read and can propose what that person can do, and the
administrator who adds a model answers for where that data goes.

1. **Every model an administrator adds is one the organisation answers for.** There is one kind of model. Adding
   one on Administration › Modeller is the administrator's statement that the organisation may process its data
   with it, personal data included, and the page says so in plain words where a model is added and above the list:
   what a model receives (whatever the person who asks may read) and that only a model the organisation may
   process personal data with belongs there. The administrator confirms it when adding, and the audit row of the
   addition records that they did. Clew cannot verify where a model runs and does not pretend to.
2. **Two levels on a capability, as today.** A capability is offered to the model or it is not (`model`). No third
   level and no mark per model: a second kind of model was considered and dropped (below).
3. **Clew's own domains are offered.** The reads of talks, competence, the calendar and the talk seam that are
   closed today are opened, so the assistant can plan a meeting from the calendar and a talk, and answer what a
   report lacks. What stays closed is listed per read with its reason (a read that opens a document's bytes, a read
   that exists only for another read), not by domain.
4. **An administrator can still close a read.** The existing switch on Administration › Anslutna system that keeps
   one read of a connector from the model stays, and Clew's own reads get the same switch, for an installation
   that wants a domain kept from the assistant.
5. **The assistant reads as the person, never more.** Every read runs with the asking person's relation to whoever
   it names (D117): their own rows, a manager's direct reports'. One relation is not resolved for the assistant:
   `registrar` ([D121](D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md)),
   the search across the organisation, stays a thing a person does on its page, where each search is one the
   person asked for.
6. **Reads of people are logged with their caller.** Where a read is logged when a person makes it (D121 item 5),
   it is logged when the assistant makes it for them, with the fact that the assistant did.
7. **Actions are proposed, and a person decides.** What a person can do in a domain Clew owns (book and prepare a
   talk, set an action point, register or confirm a competence, approve a registration) becomes something the
   assistant can propose and the person accepts, through the human decision endpoint that connector writes already
   use (D45), never as a tool that writes. This is built after the reads, domain by domain. Acting without the
   person stays with
   [D104](D104-the-model-does-the-work-a-floor-holds-without-it-and-the-assistant-may-act-alone-within-limits.md)
   item 4, whose governance is still open: nothing here lets the assistant act alone.
8. **What leaves no trace of content.** D91 stands: a model span carries no prompt or completion unless the
   operator has set `CLEW_MODEL_TELEMETRY_CONTENT`; a turn's audit row names the read and its count, never a row.

**Order.** First the text and the confirmation on Modeller and the switch for Clew's own reads, with competence
and the calendar opened. Then talks. Then proposals for owned domains, one domain at a time. Each is shown before
the next.

**Why.** The product owner, 2026-11-13: to get value from the assistant "it would need to be able to read some data
at least"; "if we assume that the model used is high security, meaning ran on local gpus, we should be able to let
it process personal data"; and "this is however relevant for the entire platform, all kinds of data and actions has
to be readable by the model to help me plan meetings, act on actions etc". The risk D95 guarded against is personal
data leaving the organisation for a model endpoint; a model the organisation runs itself is inside the same
boundary as the database. A mark per model, separating one the organisation runs from one it
does not, was written first and dropped the same day: the product owner asked when any other model would be used,
and the answer for a municipality is that it should not be. A connector's reads are already offered to whichever
model is configured, personal data included, so the line was never between kinds of model; it is at the moment a
model is added, and that is where the page now says it.

**Alternatives.** A mark per model and a third level on a capability (only a marked model): more to set and to
get wrong, for a case (a hosted model beside a local one) no installation has. It can be added if one does.
Deciding from the endpoint's address: easy to get wrong behind a proxy, and it would look like verification where
there is none. Letting the registrar search through the assistant: the widest read in the product behind the least
predictable caller.

**Open.** Whether a conversation that quoted a person's rows should be reached by that person's erasure: it is
stored as conversations are, and no erasure reaches it today. Whether the read log should show the question that
led to a read. Whether the confirmation should be asked again when a model's address changes. D104's governance of acting alone.

**Not established.** Nothing is built. No model has been run locally against it. How well an open-weight model
answers and plans from these reads is unknown.

**Replaces.** Amends D95 item 7 (the assistant) and
[D120](D120-a-skill-is-a-holding-with-a-level-and-the-competence-domain-covers-what-a-skills-platform-does.md) "Left
out, on purpose" (every competence read stays `model: false`; a plan or a report drafted by the model), which no
longer hold.
