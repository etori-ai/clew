# Clew · product vision

Product direction, originally written 2026-11-04. This page describes intended product boundaries, not a delivery checklist; the [architecture overview](architecture/overview.md) explains the current system. For implemented behavior and connector onboarding, read the [platform overview](overview.md) and [implementation status](reference/status.md). This is the file to read when a question is "should Clew do this at all?" rather than
"how". Decisions that follow from it are numbered in `docs/decisions/`; the first is D14, the line between
Clew and Eneo.

## One sentence

Clew is mission control for every employee in the public sector: one place that shows what needs you
today across the systems you work in, lets you decide and act there, and remembers what was done, so the
same work is never done twice.

## What that means

**For all kinds of employees.** A rektor planning utvecklingssamtal, an undersköterska on a shift with a
phone, an ekonom with invoices to attest, a new employee in their first week, a systemförvaltare who keeps
the thing running. The personas in `docs/personas.md` are the test: a feature that only serves one of them
is fine, a feature that makes the page worse for the others is not. Public sector first, municipality
first, but nothing in a contract or an identifier is municipal; another agency or region must be able to
run it unchanged. For now the promise is to the employee who opens Clew in a browser, at a desk or on a phone
([D100](decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md)): work reaches a person
through an open page, and delivery outside the browser (a push notification, e-mail, an installed app) is
deferred. Until it exists, the personas on a shift test that the page works on a phone; they are not a claim
that Clew reaches them there.

**Tie subsystems together.** The employee's work is spread across HR, finance, calendar, case handling,
communication and whatever the next procurement brings. Each system has its own inbox, its own deadlines
and its own idea of what the person should do next. Clew reads them through its own contracts
(`docs/architecture/integration-paths.md`), pushes one stream of threads with a reason and a deadline,
and lets the person act from the card. A system the organisation keeps stays the system of record; Clew
holds refs, decisions and receipts. The domains Clew owns itself are the paragraph "Own the domain where that
removes a system" below.

**Find, then act.** Search is the first thing employees ask for: a colleague's phone number, a document,
a case, a room. Today that means knowing which system holds it. Clew is the place you search from: one
box, results from every connector in the person's scope, each result an object (D12) that can be opened,
added to the conversation or turned into a card. Clew does not own the employee directory. It holds only
what it needs to identify and scope a person (subject, name, user name, work e-mail, units, roles and
group memberships, pushed in through SCIM; D68); everything else about
a colleague, such as phone, title, location and manager, is read from the organisation's directory as a
pass-through connector. In Sundsvall that is Metakatalogen, the established system where all employee data
is kept. Documents and cases are found
where they live, through the source's own search as the user, and through Eneo's retrieval over indexed
knowledge when Eneo is installed. Clew does not build an index of other systems' content; it asks, merges
and links. Finding something is a read; what you do with it is a card.

**Minimise dual work.** The measure of a Clew feature is work removed, not features added. A decision
taken in Clew is taken once: the receipt shows the source system's answer read back, the thread does not
come back, and the same occurrence is never pushed twice. Where two systems want the same fact from the
person, Clew asks once. Where a workflow today means opening three systems in order, Clew is the order.

**Orchestrate the person's work.** Clew is a workflow orchestrator for one person and one unit, not for
the organisation chart. It holds the state of an obligation across systems and days: find the slots,
confirm, send the invitations, wait for the answers, remind, follow up, close. It waits on other people
("Pågår utan dig"), retries what came back unknown, expires undo windows, bundles interruptions and
re-opens what was dismissed too early. The person has the same engine for their own triggers: "påminn
mig om tio minuter om det här", "bevaka fakturan tills den är attesterad", set from the conversation and
changed as casually. The scheduler is therefore a crucial part of the system, not housekeeping. DBOS Transact runs durable reminders, workflows and scheduled-job execution inside the server (D85, after Temporal in D17); PostgreSQL retains their intent and evidence (the earlier Postgres-only scheduler is recorded in D15); see the [implementation status](reference/status.md) for the limits of current delivery. What Clew does not do is model the organisation's processes: there is no
process designer, no swimlanes, and a process that is the organisation's record of a case lives in the
case system, which Clew links to and pushes from.

**Own the domain where that removes a system.** Part of Clew's purpose is to take away third-party systems
an organisation would otherwise buy and integrate ([D95](decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md),
2026-11-10). Some work is the same in every organisation and is mostly a workflow between people: the yearly
utvecklingssamtal and the 1:1s between them, onboarding and offboarding, the annual plan, a deviation
report. For such a domain Clew may be the owner and not a pass-through, whether the alternative is a procured
product or mail and spreadsheets: a core module with its own tables, its own capabilities and its own audit.
The ladder is pass-through (the source owns the record; Clew retains minimal coordination data and evidence),
derived (a computed result or snapshot), core (the record lives here). A domain moves up the ladder only by a
numbered decision that answers the [core-or-connector checklist](maintainers/core-or-connector.md), because
owning a record means owning its retention, erasure and export, and being its vendor. Three things keep this
from turning Clew into the systems it replaces. Regulated calculations, ledgers and master data stay where
they are: no payroll, no bookkeeping, no employee file. An owned domain answers the same capabilities a
connector would, so an organisation that keeps its own system connects that instead and loses nothing. And
Clew never keeps a second copy of a record whose owner is another system.

**Hosted by a provider, self-hostable by anyone.** Most municipalities have no IT department of their
own and will buy Clew as a hosted service. The open-source rule guarantees that any of them, or a region
or an agency, can run the whole stack themselves instead. Architecture choices are judged on fitness for
the work, not on how many containers a self-hosted install needs; a component that earns its place
(Keycloak, Postgres) is taken.

**The assistant takes the initiative, the person decides.** Clew pushes; the person reads, asks, adjusts
and confirms. Every proposal is computed by deterministic code or drafted by the model, and nothing
reaches a source system except through the human decision endpoint, which is never a tool. The model is an
accelerator and optional (D8). A municipality that runs Clew without any model still gets the stream, the
cards, the buttons and the receipts.

## What Clew is not

- Not an intranet, a news site or a document store. Editorial content can appear as a card with a link;
  it is not authored here. Clew may draw the installation's shared header, whose places and pages come from
  a connector (D88); it authors and hosts none of that content.
- Not a page builder. There is no operator-composed layout; the page is the stream, the areas and the
  composer. A connector says what its data is from a closed catalogue of view kinds and Clew draws it; an
  administrator chooses which declared reads appear in Clew's fixed places (a menu row, a figure, a lens, a
  column), never a block or a layout. The catalogue is closed (D100): a read without a declared view is to
  be drawn from its output schema, and a new view kind or presentation field needs two sources that were
  not written for Clew to need it, and a numbered decision.
- Not a search index over other systems' content. Clew is the place you search from; the index stays in
  the source system or in Eneo, and Clew asks them as the user.
- Not a data warehouse or a federated query engine. Clew does not run queries across sources; a connector
  returns rows, search is a fan-out, and work that spans connectors is composed in code on Clew's own keys
  (`docs/architecture/working-across-connectors.md`).
- Not an AI platform. Clew has no knowledge bases, no document ingestion, no assistant builder and no model
  administration beyond which endpoints and models the composer may use and who may pick them (D24). That
  is Eneo's product, below.
- Not a payroll system, a ledger or an employee file. Regulated calculations and master data stay in their
  systems, reached through connectors, however many workflow domains Clew comes to own (D95).
- Not a process-modelling tool or a case system. Clew orchestrates a person's work across systems and
  owns the state of its own threads and obligations; the organisation's record of a case, and the design
  of its processes, live in the case system.

## Principles

1. **Open source, always.** No closed dependency, no required hosted service, an open-weight model is enough.
   Full rule in `CLAUDE.md`.
2. **Clew owns what the model and the UI see** (D1). An adapter is the normal way a system meets that
   contract, written by the Clew team, a municipality or an integrator; a vendor that implements it itself
   is welcome, not expected (D10, amended by D100). Which wire format a connector speaks is open until one
   adapter to a product that was not written for Clew has been built both ways.
3. **The server decides.** Identity, scope, connector state and audit are enforced server-side; the browser
   and the model are untrusted.
4. **Every mutation is audited in the same transaction.** Every receipt is a read-back, never a sent request.
5. **The person sees why.** Every thread answers "varför ser jag detta?" with trigger, source and time.
6. **Attention is budgeted.** A fixed number of interruptions per day; the rest bundles.
7. **Names of individuals stay in the source system.** Never in a card or the stream.
8. **Astryx only, canvas as reference.** One component system, one design canvas, no custom CSS.
9. **Swedish in the product, English everywhere else.**

## Clew and Eneo: who does what

Eneo (AGPL-3.0, Sundsvall and partner municipalities, forked from Intric) is the municipal AI platform:
assistants configured with prompts and knowledge, knowledge bases with retrieval over documents and crawled
sites, spaces with members, apps for structured tasks such as transcription, services for API-callable
prompts, model administration across providers including self-hosted ones, and security classifications
on models and spaces.

**The line in one sentence.** Clew owns the AI that manipulates Clew; Eneo owns the AI that is a product
in itself. Clew must work with an inference endpoint and nothing else; Eneo makes it richer when present.

**Standalone, enhanced, never dependent.** Clew is a separate system with its own identity, data and
deployment. Nothing in this repository imports Eneo, calls Eneo at build or test time, or fails when Eneo
is absent. Adding Eneo to an installation gives Clew more capabilities through an optional `eneo` connector
that degrades to the standard fallback when Eneo is disabled or down. The same rule the other way: Eneo
does not need Clew; Clew registers with Eneo as one more external tool source when the municipality wants
that. Recorded as D14.

| Capability | Owner | How it reaches the other side |
|---|---|---|
| Inference for the composer and thread replies: completion, tool calling, structured output | **Clew**, through any OpenAI-compatible endpoint | Eneo may be that endpoint if it passes tools through; then models, keys and classifications are administered once, in Eneo |
| The agent loop: system prompts, choosing a capability, drafting cards, conversation memory with retention | **Clew** | Not exposed to Eneo |
| Proposals, the human decision endpoint, receipts, undo, audit | **Clew**, deterministic | Never a tool, for anyone |
| Scans and triggers: what needs the person now | **Clew** | Eneo can ask Clew through MCP for the same answer, as the user |
| Owning records (core connectors), integrations to HR, finance, calendar | **Clew** | Exposed to Eneo as read and propose tools under a release policy |
| Search across systems: people, cases, documents by where they live, rooms; merged results as objects | **Clew**, through each connector's search capability; people through the directory pass-through connector (Metakatalogen in Sundsvall) | Eneo's retrieval is one more source in the fan-out when installed |
| Knowledge bases, retrieval over documents and sites, citations | **Eneo** | `eneo.search` and `eneo.fetch` as `read` capabilities in the `eneo` connector, as the person, one source behind Clew's composite search (D26) |
| Operator-built assistants with prompts, knowledge and sharing | **Eneo** | An Eneo assistant can be opened as a view in Clew's side panel, or answer inside Eneo with Clew's tools |
| Apps and services: transcription, summarisation, structured prompts | **Eneo** | An app run can be a `propose` capability in the `eneo` connector whose result lands as a card |
| Model and provider administration, keys, quotas, security classifications | **Eneo** as a product; Clew administers only which OpenAI-compatible endpoints and models its composer may use, with an audience per model (D24) | The `eneo` connector imports classifications as inputs to Clew's own rule about which data may leave |
| Identity | **The IdP**, shared | Both use the same OIDC issuer; mappings are verified by issuer and subject, never by e-mail |

**Deciding future cases.** When a new AI capability is wanted, ask: is it *about* Clew's threads, cards,
capabilities and decisions? Then it belongs in Clew. Is it a capability a person would want without Clew
existing? Then it belongs in Eneo and reaches Clew through the `eneo` connector. If it is both, split it the
same way.

**What is known about Eneo's side (startsidan, 2026-10-07).** Eneo registers external MCP servers over
Streamable HTTP with a static bearer or API-key header only, reconnects per completion and enables tools
per assistant. It has no OAuth, token exchange or per-user credential for MCP servers, so an Eneo
registration against Clew acts for the one person whose token it holds. Whether Eneo exposes an
OpenAI-compatible completion endpoint with tool passthrough, knowledge search as a separate operation,
classifications through the API, and a streaming endpoint fit for an embedded view, is unverified. These
are the questions for the first Eneo spike; their answers decide how thick the `eneo` connector is, not
whether the line is right.

## Open questions this vision does not settle

- Classification-gated inference: whether data about identifiable people may ever go to an endpoint
  outside the organisation's control, and who marks endpoints. Not needed until a real source is connected.
- Which core domains Clew owns first. D95 names the starting candidates (medarbetarsamtal and 1:1,
  onboarding and offboarding, the annual plan, deviation reporting) and the ones still unsure (absence
  requests, internal errands, internal news, the phone book); each needs its own decision against the
  checklist. The employee directory as master data is not a candidate: it stays in Metakatalogen.
- The legal answers an owned domain needs in a municipality: whether its records are public documents, which
  secrecy rule covers them, and what the archive rules say about keeping and weeding them.
- Whether Clew's threads should be reachable from Eneo as a resource, not only as tools.
- How work reaches a person whose browser is closed: a push notification, e-mail or an installed app.
  Deferred by D100; until it is settled the promise is to the person who opens Clew.
- The wire format of a connector: Clew's own protocol, or MCP with Clew's additions carried as optional
  metadata. To be decided from one adapter built both ways
  ([review](reviews/2026-11-10-project-review-and-alternative-paths.md)), not before.
