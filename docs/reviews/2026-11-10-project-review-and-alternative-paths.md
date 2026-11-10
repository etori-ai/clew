# Review: the project, its vision, its state, and other ways to reach the vision · 2026-11-10

Reviewed revision: `f2afe8d` (main, clean tree).
Status: review and recommendation. No decision is changed and no code was touched. The decisions it calls for are listed at the end.

The product owner asked for an honest review of the project, its vision and its current state, and for other paths and techniques that could reach the vision. The example given: if the path without a model were let go, would it be easier to build this with MCP only?

## Verdict

1. **The vision is good and the core of it is built well.** One place that shows what needs a person, lets them decide, and proves what happened is a real gap, and the part that makes it trustworthy (the decision endpoint that is not a tool, approved intent committed before dispatch, receipts read back, unknown outcomes kept unknown, audit in the same transaction) is the most valuable thing in the repository. It is worth keeping on any path.
2. **Nothing has met a real system or a real employee.** The repository is eight days old. Every row of the status matrix ends in "not run against a real …". Three earlier reviews each concluded that one real integration is the next step; the days after each of them added new surface instead. This is the project's main risk, and it is larger than any architecture choice below.
3. **The product is widening faster than it is deepening.** Since the first "do one real source" recommendation the project has gained an owned HR domain, a manager's staff page, entity sources, an intranet header, theme administration, statistics, an MCP lab and a second and then removed web app. Several of these sit on or over the lines in "What Clew is not".
4. **MCP only, with a model required, would make the demo easier and the product harder.** It removes the cheap part (drawing views from a declaration) and keeps every hard part (finding work, background authorization, safe writes, attention). It also puts an unanswered legal question, which data may reach a model, in front of every feature.
5. **The question hides a better option.** "Without a model" and "Clew's own wire protocol" are two separate choices. Keep the first; reconsider the second. MCP can be the wire format of a connector while buttons, cards and receipts still work with no model.

## What was looked at

Read: `docs/vision.md`, `docs/overview.md`, `docs/reference/status.md`, `docs/reference/reliability-acceptance.md`, the architecture overview, integration paths and MCP chat services pages, D1, D2, D4, D8, D10, D21, the reviews of 2026-11-06 (second opinion; mock connectors to real sources), 2026-11-07 (system foundation), 2026-11-08 (MCP provider compatibility) and 2026-11-09 (MCP-backed connectors). Measured from the tree and git. The MCP specification's 2026-07-28 change log, authorization page and elicitation page were read from the specification site.

Not done: no test suite was run, no code was read line by line, the application was not opened, and the design canvas was not compared. Statements about what works are taken from the status matrix, which is unusually candid, and are not verified here.

| Measure | Value |
|---|---|
| Age | First commit 2026-11-03, last 2026-11-10; 288 commits, three authors |
| Product code | About 70,000 lines: server 23,100, web 22,100, packages 15,300, connectors 10,100 |
| Test code | About 46,600 lines, about 1,400 test declarations, 50 browser specs |
| Schema | 47 migrations |
| Records | 107 decision records, 51 reviews |
| Connectors | 14, all fixtures or adapters that have not met their system |
| Protocol | `protocol.ts` 1,036 lines; the generated manifest reference 2,360 lines; nine view kinds |

## The vision

**What holds.** The four questions in the overview (what needs me, what do I need to know, what can I do, what happened after) are the right frame. Leaving records in their systems, holding refs and receipts, and refusing to become an index, a warehouse or a process designer keeps the product small enough to finish. The line to Eneo is clear and usable. "The model is optional" is the correct position for a public-sector start page, for reasons given under the MCP question below.

**Where the vision works against itself.**

- *Mission control for every employee, with no way to reach them.* The stream pushes work, but delivery is an open browser tab: no push notification, no e-mail, no installed app. For the nurse's assistant on a shift with a phone, the persona the vision names second, that is the whole product. It is listed as a limit in the status matrix and nowhere as a priority.
- *"Own the domain where that removes a system" (D95) is a second product.* A pass-through hub and a suite of small HR applications have different customers, different legal duties (retention, erasure, public-document rules, secrecy) and different competitors. The decision was taken on day eight, before the hub had read one real record, and its own text lists the legal questions as unanswered. The first owned domain is already built on synthetic data.
- *"Not a page builder", with a growing page language.* Nine view kinds, tones, units, nouns, `beside`, `compact`, figures, lenses, columns and marks are a declarative interface language. Each real source will ask for one more field. That is a page builder whose editor is a manifest file.
- *"Not an intranet", with the intranet's header.* The shared header, its content connector and the theme administration are intranet work.
- *"Integrations are asked to meet Clew's contract first" (D10).* A vendor will not implement a protocol that one installation uses. The 2026-11-08 review found the opposite movement: vendors in exactly this field are publishing MCP servers. In practice every adapter will be written by the Clew team or a municipality, so the public-standard apparatus around the protocol (served OpenAPI, a preview page, a conformance checker, a version policy) is early.

## The current state

**Strong.**

- The execution ledger, timers with generations, occurrence identity and the bounded watch are careful work on the problems that actually hurt in systems of this kind.
- The ports-and-adapters structure is enforced by tooling, not by habit, and the fast suite runs without infrastructure.
- The fixtures are independent services behind the same transport a third party would use, so the boundary is exercised.
- The documentation separates "decided" from "built" from "verified" better than most projects several years old.
- Earlier reviews' findings were fixed within a day.

**Weak.**

- *No contact with reality.* The fixtures, the protocol they satisfy, the tests that pass against them and the reviews that judged them were produced by the same small group in the same week. That is a closed loop. The protocol's hardest promises (stable occurrence keys, complete scans, deduplicated writes, lookup after a lost reply) are promises a real source may simply not be able to make; the first target landscape recorded in D10 includes a system reached by screen automation because it has no API.
- *The unsolved problem is authorization for work in the background, and no protocol choice solves it.* A scan carries no delegated token; a durable write on a connector that declares delegation stops at `needs-session`. The errand list landed on Hem as a live read and not as cards for exactly this reason. So the central promise, "what needs you today, pushed", currently works only for sources reached with a service credential, where Clew and the connector must reproduce the source's access rules themselves. That is the riskiest authorization model, and both first-priority findings of the 2026-11-07 review were of that kind.
- *Volume against attention.* About 117,000 lines and 107 decisions in eight days is more than three people can have read closely. Seven decision numbers are used twice. The durable engine was chosen on 2026-11-04 and replaced on 2026-11-09; a second web app was built on 2026-11-06 and removed on 2026-11-09. Changing course fast is right for a lab. Recording each turn as a numbered, accepted decision makes the result look more settled than it is, and the rules that follow from those records now constrain every later session.
- *Accessibility is declared a hard requirement and is unproven.* No screen-reader pass has been made on any flow, the browser suite runs by hand against mocked APIs, and many rows say "no signed-in pass on the development stack".
- *Half-built breadth.* Jobs across systems have a ledger and no interface. Talks have a round and no record. The MCP lane has delivery and no OAuth. Each is a plausible start; together they are a wide front with nothing finished to a person's hands.

## The question: let go of the path without a model, and build on MCP only?

The question joins two choices that are independent.

| | Model optional | Model required |
|---|---|---|
| **Clew's own protocol** | Today's native connector lane | No reason to exist |
| **MCP** | Not explored as a main path (the 2026-11-09 review touches it as a wrapper) | Today's D81 lab |

MCP does not need a model. A tool call is an HTTP request that deterministic code can make; the 2026-11-09 review says the same. So "MCP only" and "no path without a model" must be judged separately.

### Requiring a model

**What it removes.** The view catalogue and its renderer, areas and tool pages, the administrator's placement of lenses and columns, the deterministic router, the manifest's presentation half and its documentation. From file sizes this is roughly 10,000 to 15,000 of the 70,000 lines, and a larger share of the documentation. It is an estimate, not a measurement.

**What it does not remove.** Threads and cards, decisions, the ledger, jobs, timers, attention, identity and provisioning, audit, the calendar, administration. That is most of the code and all of the difficult code.

**What it costs.**

- *The open question becomes a gate.* The vision leaves "may data about identifiable people go to an inference endpoint" unsettled, and can afford to, because the model is an accelerator. With a model in the only path, sick leave, cases and invoices cannot be shown until that is answered for every source and every endpoint.
- *Availability and cost.* D8's argument stands: a start page cannot stop because inference is down, and the rule that an open-weight, self-hosted model must be enough means tool selection across many tools has to work on a modest model, in Swedish.
- *Accessibility.* An answer composed by a model, or a provider's own HTML in a frame, cannot be held to WCAG 2.2 AA by Clew's tests. A declared view drawn by Clew's components can.
- *Identity of the product.* A chat surface with MCP tools, model administration and audit is what Eneo is. A Clew that requires a model has given up the line in D14, and the fair question then is why it is not a feature of Eneo.

Conclusion: do not require a model. The saving is modest and sits in the easy part.

### MCP as the only integration contract

**What gets easier.**

- Vendors that already publish MCP servers connect without anyone writing an adapter. Today that lane exists only as a lab.
- An adapter a municipality writes for its own system is useful to every MCP host it runs, Eneo included, and not only to Clew. For software meant to be shared between municipalities this is a real argument: the investment is not specific to Clew.
- Per-user OAuth is the standard's own model, so the source decides access as the person. That is the authorization model Clew should prefer anyway.
- Form-mode elicitation (text, numbers, booleans, single and multiple choice) covers the "bounded native form" that the 2026-11-09 review found missing, without a new protocol field.
- Clew stops being a protocol vendor: no served protocol, version policy or conformance tool of its own design.

**What does not get easier, because MCP has no concept for it.**

- *Work.* MCP has tools and resources. It has no scan, no work item, no occurrence, no "this is done". The D81 lab already had to invent a watch rule per tool (an identity pointer, an eligibility condition, an interval). That rule is a manifest by another name, written by an administrator for each tool instead of once by the adapter's author. The declaration does not disappear; it moves to whoever is least able to write it.
- *Push.* The current specification offers list-changed and resource-subscription hints on an open stream, with no delivery guarantee. Finding new work still means Clew polling as the person.
- *Background authorization.* The authorization page states that a client must not assume a refresh token is issued. The `needs-session` problem is the same problem in new clothes.
- *Safe writes.* Tool annotations are hints from an untrusted server. There is no operation identity, no lookup, no read-back and no compensation. On a foreign MCP tool the ledger can only run its most conservative strategy: one attempt, and "unknown" after a lost reply. Principle 4, "every receipt is a read-back", holds only where someone has configured which read confirms which write.
- *Scope without a per-user token.* In-house systems reached with a service credential need an adapter that narrows to the actor either way. Writing it as an MCP server is the same work as writing it as a connector.

**What gets worse.**

- *Churn.* The 2026-07-28 revision removed sessions and the initialize handshake, replaced resource subscriptions, moved tasks out to an extension and deprecated dynamic client registration, eight months after the revision the lab was tested against. Clew's own protocol changes only when Clew wants it to.
- *The interface.* Without declared views, a read is drawn from its output schema alone (workable for a table or a record, poor for a document review) or by the provider's own App, which Clew cannot theme or test for accessibility.

Conclusion: MCP alone is not enough to carry the vision, because the vision's distinctive half (work found, decided once, proven) is exactly what MCP leaves undefined. As the wire format under a thin Clew convention it is a serious candidate, described as path B.

## Other paths

**A. Depth before breadth: one real source, one loop, real people.** Not an architecture change. Stop adding surface. Choose one source that exists within reach (the review of 2026-11-06 names a running Eneo instance and the open-source case-handling service; the CalDAV calendar is already real in development), and carry one loop to people who are not on the team: sign in, see work, decide, get a receipt, with two people who have different access and one revocation. Everything else in this review is opinion until this is done, including path B.

**B. MCP as the wire format, a Clew profile on top, the model still optional.** A connector is an MCP server. A capability is a tool with an output schema. What Clew needs beyond the standard is carried as optional metadata under Clew's own key in `_meta`, or set by an administrator at registration when the server does not carry it: the kind (read, propose, execute), which tool lists pending work and which field is its identity, which read confirms which write, a view hint. A server that declares nothing still works as a plain tool with a default view drawn from its schema. A server that declares more earns more: cards, automatic retry, undo. Guarantees become graded and visible instead of a condition of entry. The ledger, decisions, cards and the model-free interface are unchanged. D1 survives in a weaker form (Clew owns the profile, not the transport); D4 and D21 would be superseded. The costs are the churn above and a migration of fourteen fixtures. This should be tried on the one real source from path A, built both ways, before it is decided.

**C. Live reads first; store only what the person did.** The errand section shows the shape: fan out reads as the person when the page opens, with the session's own token, and keep in Clew only refs, decisions, snoozes, reminders and receipts. This follows the grain of delegated authorization instead of fighting it, removes stored source snapshots and with them the class of stale-authority findings (D75), and fits principle 7 better than cards that hold source text. What it gives up is work found while nobody is signed in, so no "new since yesterday" beyond a stored set of refs, and no notification to a closed browser. A sensible split: live reads for sources that authorize per user, persisted scans only for sources that issue a background credential and can state completeness.

**D. Build the attention and decision layer inside Eneo.** If the organisations that will run Clew already run Eneo, identity, tenancy, model administration, audit and MCP registration exist there. The cost is that model-optional becomes hard to keep and that Eneo's MCP registration, as the vision records it, holds one static credential and no per-user token. Named for completeness; it is a governance question more than a technical one.

**E. Draw from the schema by default.** Whatever the wire format, let a read without a declared view get a table or a record derived from its output schema, and reserve declared views for the few shapes that need them (document review, series). This stops the manifest language from growing with every source.

## Recommendation

1. Keep the path without a model. Keep the decision endpoint, the ledger, receipts and audit exactly as they are.
2. Freeze new surface until path A is done: no further owned domains, entity kinds, view kinds or administration pages. Finish or park the half-built fronts on purpose and say which.
3. Put delivery outside the browser tab on the list above any new page, because without it the frontline personas are not served.
4. On the first real source, build the adapter twice, once on protocol 2 and once as an MCP server with the profile of path B, and compare the adapter's size, what the administrator must configure, and what the person sees. Decide D4 and D21 from that evidence.
5. Decide path C per source, by whether the source can authorize work in the background.
6. Treat D95 as a separate product question with its own owner and legal answers before more of it is built.
7. Run one screen-reader pass on the one real loop. Mark decisions taken without evidence as provisional, and stop reusing numbers.

## Decisions this review calls for

- Whether MCP replaces protocol 2 as the wire format of a connector (supersedes D4 and D21, narrows D1), after the comparison in recommendation 4.
- Which source and which group of people are the first pilot (the gate that `docs/reference/reliability-acceptance.md` leaves open).
- Whether owned domains stay inside Clew's scope now, or wait for the hub to be in use.
- How work reaches a person whose browser is closed.

## Outcome

2026-11-10, the same day. The product owner took the vision's contradictions first.
[D100](../decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md) records the answers and
`docs/vision.md` carries them:

- Delivery outside the browser is deferred, and the vision now says the promise is to the person who opens Clew.
- An adapter is the normal way a system meets Clew's contract; D10's "ask the vendor first" is dropped. The wire
  format stays open until one adapter has been built both ways.
- The view catalogue is closed; a read without a declared view is to be drawn from its output schema (not built).
- "Not an intranet" is worded so that the shared header (D88) is inside the line.

Owned domains (D95) were not settled. The owner's answer to that question was about the review's main finding
instead: no real system is within reach, so an open-source product, run locally, should stand in as the first real
integration. Recommendation 4 and path A are to be read that way: "a real source" means a product that was not
written for Clew.

Later the same day the owner settled three more of the review's points.
[D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md): the
first real integration is Nextcloud's Approval app (compared in
[an open-source product as the first real integration](2026-11-10-an-open-source-product-as-the-first-real-integration.md)),
built on protocol 2 and as an MCP server and compared, and new surface is frozen until that loop works, a
screen-reader pass included.
[D102](../decisions/D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md): a
decision is `provisional` until something outside the repository has tested it, a one-screen adjustment is not a
numbered record, and a number is taken when the change lands. Still open: D95's place in the vision, a pilot with a
municipality's own system and people, and delivery outside the browser.
