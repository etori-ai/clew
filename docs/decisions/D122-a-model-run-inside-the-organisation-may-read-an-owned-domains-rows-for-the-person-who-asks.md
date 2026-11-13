# D122 · A model run inside the organisation may read an owned domain's rows for the person who asks

**Status:** provisional (product owner, 2026-11-13, said in a working session; nothing is built and nothing outside the repository has tested it) · **Date:** 2026-11-13 · **Area:** assistant, identity, product

**Decision.** [D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md) item 7 kept
every row of a domain Clew owns from a model endpoint "until the installation's rule for classification-gated
inference is settled". This record settles it for one case and leaves the rest closed.

1. **The rule.** A read of an owned domain may be answered to the assistant only when the model that will receive
   the answer is marked, by an administrator, as one the installation runs itself and may process personal data
   with. A model that is not so marked receives nothing of an owned domain, as today.
2. **Who marks a model.** An administrator with `admin.connectors`, per model, on Administration › Modeller: one
   switch, off by default, with a text that says what it allows. Turning it on or off is audited. Clew cannot verify
   where a model runs; the switch is the administrator's statement, and the audit row says who made it.
3. **A read says whether it may be opened, and to what.** `model: false` stays the default for every read of an
   owned domain. A read opts in with a second value, working name `model: 'internal'`, which the registry treats as
   `false` unless the turn's model carries the mark of item 2. The check is made in the registry on every call,
   where D117 already decides who may be asked about, not in the assistant.
4. **The assistant reads as the person, never more.** The read runs with the asking person's relation to whoever it
   names ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)): their own rows, and a
   manager's direct reports'. The relation `registrar`
   ([D121](D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md)) is never
   resolved for the assistant: a search across the organisation stays a thing a person does on its page.
5. **First opened: competence, for the person and their manager.** `competence.holdings` (one person's holdings),
   `competence.person`, `competence.attention` and the unit's summary open as `internal`. A manager's read of a
   report through the assistant is written to the read log as any other (D121 item 5), with the fact that the
   assistant made it.
6. **No writes.** The assistant registers, approves, confirms and revokes nothing in this decision. A proposal the
   manager accepts in the existing dialog is a later slice with its own record
   ([D104](D104-the-model-does-the-work-a-floor-holds-without-it-and-the-assistant-may-act-alone-within-limits.md) item 4 keeps sensitive actions with a
   human).
7. **What leaves no trace of content.** D91 stands: a model span carries no prompt or completion unless the
   operator has set `CLEW_MODEL_TELEMETRY_CONTENT`; an audit row of a turn names the read and its count, never a
   row. A conversation that quoted holdings is stored as conversations are; erasure of a person's competence does
   not reach it, which is stated under "Open".

**Why.** The product owner, 2026-11-13: to get value from the assistant "it would need to be able to read some data
at least", and "if we assume that the model used is high security, meaning ran on local gpus, we should be able to
let it process personal data". The risk D95 guarded against is personal data leaving the organisation for a model
endpoint; a model the organisation runs itself is inside the same boundary as the database. The mark is per model
because an installation may configure a local model and a hosted one side by side.

**Alternatives.** Opening the reads to any configured model: a hosted endpoint would receive employees' holdings
because someone asked a question. A setting for the whole installation: one switch for models that differ in
exactly this respect. Deciding from the endpoint's address (a private network range): easy to get wrong behind a
proxy, and it would look like verification where there is none. Letting the registrar search through the assistant:
the widest read in the product behind the least predictable caller.

**Open.** Whether talks' rows open the same way (not in this decision). Whether a conversation that quoted a
person's holdings should be reached by that person's erasure. Whether the read log should show the question that
led to a read. Whether the mark should expire or be re-confirmed.

**Not established.** Nothing is built. No model has been run locally against it. How well an open-weight model
answers from these reads is unknown.

**Replaces.** Amends D95 item 7 (the assistant) and D120 "Left out, on purpose" (every competence read stays
`model: false`) for the case this record describes; a plan or a report drafted by the model stays left out.
