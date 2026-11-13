# D122 · A model the organisation runs itself may read and propose whatever the person who asks may, across the platform

**Status:** provisional (product owner, 2026-11-13, said in a working session; nothing is built and nothing outside the repository has tested it) · **Date:** 2026-11-13 · **Area:** assistant, identity, product

**Decision.** [D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md) item 7 kept
every row of a domain Clew owns from a model endpoint "until the installation's rule for classification-gated
inference is settled". This record settles the rule, and it is a rule for the whole platform, not for one domain:
with a model the organisation runs itself, the assistant can read what the person who asks can read and can propose
what that person can do.

1. **Two kinds of model.** An administrator with `admin.connectors` marks a model, on Administration › Modeller, as
   one the installation runs itself and may process personal data with: one switch per model, off by default, with
   a text that says what it allows. Turning it on or off is audited. Clew cannot verify where a model runs; the
   switch is the administrator's statement, and the audit row says who made it. A model with the mark is called
   *internal* below.
2. **Three levels on a capability.** What a capability offers the model becomes one of three: *open* (any
   configured model, today's `model: true`), *internal* (only an internal model) and *closed* (no model, today's
   `model: false`). The registry decides on every call, where
   [D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md) already
   decides who may be asked about; the assistant is never trusted to hold back.
3. **Clew's own domains are internal.** The reads of talks, competence, the calendar and the talk seam that are
   closed today become *internal*, so an internal model can plan a meeting from the calendar and a talk, and answer
   what a report lacks. What stays *closed* is listed per read with its reason (a read that opens a document's
   bytes, a read that exists only for another read), not by domain.
4. **A connector's reads can be held to an internal model.** The published protocol keeps its boolean: a connector
   says whether a read is offered to the model at all. An administrator may set a read of a connector to
   *internal* on Administration › Anslutna system, beside the existing switch that closes it, so that an
   installation with both kinds of model sends a source's personal data only to the one it runs. Nothing changes
   for an installation that sets nothing.
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

**Order.** First the mark, the three levels in the registry and the administrator's two switches, with competence
and the calendar opened as *internal*. Then talks. Then proposals for owned domains, one domain at a time. Each is
shown before the next.

**Why.** The product owner, 2026-11-13: to get value from the assistant "it would need to be able to read some data
at least"; "if we assume that the model used is high security, meaning ran on local gpus, we should be able to let
it process personal data"; and "this is however relevant for the entire platform, all kinds of data and actions has
to be readable by the model to help me plan meetings, act on actions etc". The risk D95 guarded against is personal
data leaving the organisation for a model endpoint; a model the organisation runs itself is inside the same
boundary as the database. The mark is per model because an installation may configure a local model and a hosted
one side by side. The third level exists because the opposite case is real too: a connector's reads are offered to
whichever model is configured today, personal data included, and an installation that adds a hosted model needs a
way to keep them from it.

**Alternatives.** Opening everything to any configured model: a hosted endpoint would receive employees' talks and
holdings because someone asked a question. One setting for the whole installation: one switch for models that
differ in exactly this respect. Deciding from the endpoint's address: easy to get wrong behind a proxy, and it would
look like verification where there is none. A classification that each connector declares in the protocol: a
protocol change for every connector, when the administrator who knows the installation's models can say it per
read. Letting the registrar search through the assistant: the widest read in the product behind the least
predictable caller.

**Open.** Whether a conversation that quoted a person's rows should be reached by that person's erasure: it is
stored as conversations are, and no erasure reaches it today. Whether the read log should show the question that
led to a read. Whether the mark should expire or be re-confirmed. Whether an installation with only an internal
model should have connectors' reads default to *internal*. D104's governance of acting alone.

**Not established.** Nothing is built. No model has been run locally against it. How well an open-weight model
answers and plans from these reads is unknown.

**Replaces.** Amends D95 item 7 (the assistant) and
[D120](D120-a-skill-is-a-holding-with-a-level-and-the-competence-domain-covers-what-a-skills-platform-does.md) "Left
out, on purpose" (every competence read stays `model: false`; a plan or a report drafted by the model), which now
hold only for a model without the mark.
