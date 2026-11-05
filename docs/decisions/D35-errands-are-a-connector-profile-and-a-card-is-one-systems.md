# D35 · Errands from several case systems: one connector per system, a shared profile for the reads, and a card's buttons reach only its own connector

**Status:** accepted, the card-action rule built 2026-11-05; the errand profile, `clew.errands` and the errand connectors not built · **Date:** 2026-11-05 · **Area:** integrations

**Decision.** A person acts on errands from several case systems (SupportManagement, CaseData and a third municipality's
system) through Clew as follows.

1. **One connector per case system.** Each system is a connector of its own (D21–D23): its own container, a `connector`
   row registered by an administrator under Administration › Anslutna system, an audience. The ids are the systems',
   `sm`, `casedata` and so on. Identity towards the system is the connector's business: `sm` asserts the person with
   `X-Sent-By` behind its gateway credential as D18 describes; a system that accepts user tokens declares `delegation`
   (D26). The system's owner may build and run the connector (D10). Nothing errand-specific sits in Clew's server except
   the composite in item 4.

2. **The errand profile: reserved names and shapes for the reads**, the way D26 reserved `<id>.search`. A connector that
   holds errands declares:
   - `<id>.errands`, a `read` with input `{ view: 'assigned' | 'reported' }` (assigned to the person or their group; reported
     by the person) and output `{ rows: ErrandRow[] }`;
   - `<id>.errand`, a `read` with input `{ ref }` and output `ErrandView`: the row plus the free text (title, description,
     what is waiting and on whom, stakeholders where question 6 of HANDOVER section 4 item 7 allows), read live for the
     side panel and never stored;
   - `<id>.errandCard`, a `propose` with input `{ ref }` and a `ThreadDraft` for that errand as output, with the same
     `topic` the connector's scan gives the same errand;
   - `<id>.search` with `kinds: ['case']` (D26), so an errand is found by number or words with the other sources.

   An `ErrandRow` is `ref` (`errand:<connector id>:<municipalityId>:<namespace>:<id>`, D18's scheme with the connector in
   place of the adapter), `label` (non-personal only: the errand number and the category or type display name), `status`
   (the system's display name), `waitingOn`, `since`, `dueAt` (nullable) and `link` (the errand in its own system).
   `ErrandRow` and `ErrandView` go into the protocol's `$defs` beside `SearchHit`, and their fields into `panel-labels.ts`.

3. **The executes are each system's own.** No errand verb is standardised. Each connector declares what its system can
   do (`sm.park`, `sm.addNote`, `casedata.addStatement` …) as `execute` with `model: false`, re-reads the errand, sends
   `If-Match` with the version seen, reads the result back and returns an `ExecuteResult` (D18). An execute is reached
   only from a card its own connector drew.

4. **`clew.errands` combines the lists.** A core `read` built like `clew.search` (`apps/server/src/modules/search/`):
   every `<id>.errands` in the person's scope through `clew.call` at the same time, a budget per source inside a budget
   for the whole, the rows merged and ordered by `dueAt`, then `since`, and the systems that did not answer named. It is
   the one standing chip "Mina ärenden", the one read the router matches and the one tool the model sees; the
   per-connector `<id>.errands` are left out of the tools while the composite is registered, as search sources are.

5. **A person acts from a card, and there are three ways to the card.** The push: each connector's scan drafts a card for
   an errand that needs the person (assigned, a deadline, a new notification), fed by D19 when the system can notify and
   by polling until then. The list: a row in "Mina ärenden" carries "Öppna som kort", which calls that connector's
   `<id>.errandCard` and pushes the draft; the store's one open card per (person, topic) makes it the same card the scan
   would push, so a pull and a push meet (D34). The box: a question naming an open card gets that card (`matchCards`),
   otherwise the search finds the errand and the row opens the card. The card's button goes through
   `POST /api/threads/:id/act` to that connector's execute, and the receipt, the audit row and the undo window follow.

6. **A card is one system's (built).** Every action on a card names a capability of the connector that pushed it, and the
   action's `kind` is that capability's kind. `Registry.scan` (`packages/connectors/src/index.ts`) refuses a draft that
   breaks this and reports it through `RegistryOptions.onRefused`: the server logs it, `connector-check` fails on it, and
   the connector's other drafts still become cards. `act` (`apps/server/src/threads/usecases/cards.ts`) takes the kind
   from the registry, not from the stored card, and refuses a button whose capability belongs to another connector
   ("Knappen hör inte till kortets källa och kan inte användas."), which covers cards stored before the rule. An
   `undoCapability` must be an `execute` of the same connector; any other is dropped, the receipt stands without Ångra,
   and the `thread.acted` audit row carries `undoRefused` with the name. Tests: "a card is one system's (D35)" in
   `tests/unit/connectors.test.ts` and `tests/unit/threads.test.ts`.

7. **What Clew does not do with errands.** No action spans systems: moving an errand from one system to another is two
   cards, or the systems' own business. A connector never executes in another (the callback refuses it, D21). The model
   never presses a button (D8). No free text is stored: `label` is the only errand text that reaches a card title, a
   templated answer (`templatedAnswer` names the first rows) or a conversation message.

Not built: the profile in `protocol.ts` and the published schema, `clew.errands`, the handling of a connector's
`propose` whose output is a `ThreadDraft` (today only the core `clew.cardFromAnswer` makes a card on demand), buttons on
the generic panel's rows (only search hits have them), and the `sm` and `casedata` connectors. D18's open questions stand:
the test namespace and WSO2 credential, whether the realm's `preferred_username` is the AD account, stakeholder names in a
Clew-drawn view, the webhook channel.

**Why.** The product owner asked how a person would act on an errand from three different errand systems through Clew
(2026-11-05). D18 answered for one contract with adapters inside Clew, but it was written before D21 and D22 made
every new integration a connector in its own container with capability names under its own id, so its `packages/errands`,
`ErrandProvider` port, `errand-module.ts` and `errand.*` names have no place in the current rules. Keeping one errand
contract in Clew's process would also mean a Clew release for each municipality's case system, which D21 was written to
avoid.

The shared contract moves into the protocol instead, where any connector can meet it, and only as far as Clew needs it:
the reads Clew combines (the list, the search) and the on-demand card. The executes are not standardised because the
systems differ in what they can do (SupportManagement parks, suspends and notifies; CaseData has decisions and
statements), a shared verb list would be either the intersection, too little to work with, or a union no system fulfils,
and an execute is only ever reached from its own connector's card, so it never needs a shared name. The model cannot call
an execute (D8), so there is no tool list to unify either. Without the composite, a person in three systems would get three
chips titled "Mina ärenden", the router would pick one of them (`matchCapability` keeps the first best score) and the
model would see three tools for one question.

The card rule came out of the same walk-through. The connector protocol already said a connector cannot "execute in another
connector", but only the callback route enforced it: `Registry.scan` passed drafts through as they came and `act` took the
kind from the draft. With three suppliers' connectors on one page, a card from one could have carried another's execute,
or labelled an execute `read`, which `act` would then have run without a receipt, a `thread.acted` row or an undo window
(`runCapability` still re-checked the session). Refusing at the scan keeps such a card off the page; checking again in `act`
covers what is already stored. A foreign undo is dropped rather than refused because the execute has already happened, and
throwing then would lose its receipt.

**Replaces.** D18's hosting: `packages/errands`, the `ErrandProvider` port, `apps/server/src/errand-module.ts`, the
`errand.*` capability names, and "adapter" for SupportManagement and CaseData (now connectors `sm` and `casedata`). D18's
other rules stand as written and stay proposed with its open questions: cards from non-personal fields only, free text
read live into the panel, `If-Match` and the read-back on every execute, no undo for a message sent to a stakeholder, a
watch through the system's own subscription, identity by asserted `X-Sent-By` until the gateway accepts exchanged tokens.
D18's status becomes `proposed, hosting shape replaced by D35`. The connector protocol gains the card-action rule
(`docs/architecture/connector-protocol.md`).
