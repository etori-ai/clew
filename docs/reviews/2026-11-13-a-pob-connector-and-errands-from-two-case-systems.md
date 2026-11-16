# Implementation plan: a POB connector, and one errand list from two case systems · 2026-11-13

Oliver Borgström asked what a connector to POB (Wendia's POB G6, an IT service desk) would take, so that a person's POB errands are listed in Clew beside the ones from SupportManagement, and then for a plan to build it from. This is that plan, revised the same day after a critique of its first version and after public code that already talks to POB had been read. What has been built since is under [Outcome](#outcome).

It is in phases, each useful alone:

| Phase | Gives | Depends on |
|---|---|---|
| [0 · Verify](#phase-0--verify-against-a-running-pob) | The facts the rest is built on | A test POB and someone who runs it |
| [1 · List](#phase-1--list-a-persons-errands) | `pob.errands` and `pob.errand` | Phase 0 |
| [2 · Two systems](#phase-2--one-list-with-supportmanagement) | POB and SupportManagement in "Mina ärenden", tested together | Phase 1 |
| [3 · Create](#phase-3--create-an-errand) | An errand sent in from Clew, typed or drafted by the assistant | Phase 1, the product owner's word on the freeze |
| [4 · Reply](#phase-4--reply-in-an-errand) | A note or a message in an errand | Phase 3 |

## Outcome

**2026-11-16, later the same day: moved onto main as it stood then, which changed what the plan says below.** Main had
taken three decisions while this was built, and the work was fitted to them at Oliver Borgström's request:

- **What a person reported is a request, not an errand**
  ([D123](../decisions/D123-requests-are-a-profile-of-their-own-apart-from-the-errands-a-person-handles.md)). The
  connector now answers two profiles: `pob.errands` and `pob.errand` for what a person handles (assigned, and the
  group's queue), and `pob.requests` and `pob.request` for what they reported. Phase 2's first view ("what the person
  reported comes first" in `clew.errands`) and its amendment of D90 are taken back; the errand profile's `reported`
  view answers no rows for POB. The card for what waits on the person and the fault report's draft are filed under
  Clew's area `requests`, and the fault report's receipt names a request. A request's `since` is when it was reported,
  which the port and the API adapter's field map got a field for (`created`, assumed).
- **Protocol 3** (D117): the assertion is bound to the request's body and capability. The connector's verifier is
  main's.
- **Hem has no tool blocks** (D126 rule 9): "Mina ärenden" and "Mina beställningar" are tools with pages of their own,
  so nothing here is a section on Hem.

Where the sections below say otherwise, this note is what was built. Nothing of it has been seen in a browser since the
move.

**2026-11-16.** Built on made-up data at Oliver Borgström's request, out of the plan's order (phase 0 has not been done):

- `connectors/pob` with phase 1's identity check, relation rule, second check, access log, person lookup and configuration, on a made-up POB, running in the development stack beside `sm`. Seen in the browser as one person: both systems in one list, an errand opened, another person's errand not found.
- Phase 2's first view: `clew.errands` asks every system for what the person reported (D90, amended), and the two connectors are tested together, each with the token for its own audience.
- A draft of the API adapter, `pob.mjs`, from the public code's field names, with a table of names an installation can change (`POB_FIELDS`) and a check of them against POB's own description at start. It was written before phase 0 on purpose and has met no POB; its assumptions are listed in [the connector's README](../../connectors/pob/README.md#the-api-adapters-assumptions). This also settles "what is code and what is configuration" differently from below: the standard names are defaults that can be replaced, not constants.
- The guide's own assistant was asked about fields and filters. It answered that its source is an endpoint catalogue without them, and added two facts: when `view` is given every other filter parameter is ignored, and a memo can be fetched as `text/plain`.

- **Cards and the fault report**, asked for by Oliver Borgström the same day with the freeze set aside by him ("it is important that the assistant can help to create a fault report"). The scan gives a card for each reported errand that waits for the person's answer. `pob.reportFault` (a propose the model may call), `pob.createCase` (the execute, with asks and an effect read) and the made-up POB's `create` follow the prototype's flow in `startsidan-prototype`: whether the fault is the person's own or someone else's, the problem, the place, the computer's name. It needed one change in Clew itself, which had no way for the assistant to start a work item: a propose the model calls now becomes a work item through `startCard`, and what the model gave it is the draft of the item's asks (D112 item 8's draft, on an item the turn started). Seen signed in with a real model: the draft, "Det här händer", the receipt with the new errand's number, and the card for the waiting errand.

Not done: phase 0, the numbered record for the departure from D89, a numbered record for the assistant starting a work item from a propose, creating through the API adapter, the browser specs with the new first view, phases 3 and 4. Found while trying it: Hem reads the list several times for one page, which a real POB would feel.

## What it rests on

Three readings, none of them a running POB.

**An API guide for POB G6** (API v2.3, an overview behind an access code, read in the session; not public and not linked here). It lists endpoints and no fields.

| Read in the guide | Consequence |
|---|---|
| Authentication is HTTP Basic, an account's user name and password in every call. No OAuth, no token for a person, nothing that asks "as" someone else | POB is reached with one account that sees what its POB role allows, whoever sits in Clew |
| `PUT` creates and `POST` updates, the reverse of the convention. The guide marks it itself | A `PUT` that is sent again creates a second errand. Nothing in the connector may repeat a create |
| `GET /case` lists and searches "with filters or saved views" (`view=`); `GET /case/{id}`, `/case/{id}/memo`, `/case/{id}/suspension`, `/case/{id}/timelimits`, `/case/{id}/history` | Enough endpoints for a list and one errand |
| `/user`, `/usergroup`, `/account` and `/customer`; `/casetype`, `/casecategory`, `GET /enum/{id}`, `GET /entity/{id}` | A person can be looked up, display names can be read, and the field list the guide lacks can be read from a running POB |

**Public code that integrates with POB**: [api-service-supportcenter](https://github.com/Sundsvallskommun/api-service-supportcenter) and [api-service-incident-mapper](https://github.com/Sundsvallskommun/api-service-incident-mapper), both MIT. Their client and mapper classes and a `pob.yaml` were read through a delegated fetch on 2026-11-13, not line by line by the author of this plan, and not `CaseService`, the generated model or the tests. What they show is what one installation's integrations send, not what POB requires.

| Seen in that code | Consequence |
|---|---|
| A request body is `{ "Type": "Case", "Links": [], "Data": { … }, "Memo": { … } }` | The envelope for phases 3 and 4 |
| On create, `Data` carries `Description`, `CaseType`, `CaseCategory`, `Contact.Customer`, `PriorityInfo.Priority`, `ResponsibleGroup`, and some twenty `Virtual.Shop_…` fields of that installation's ordering flow | Six fields look standard. `Virtual.…` fields are an installation's own additions, so no two POBs can be assumed to have the same |
| On update, `Data` carries `Id`, `CaseStatus`, `ClosureCode`, `Responsible`, `ResponsibleGroup`, `Virtual.ExternalCaseId` | The handler and the group are `Responsible` and `ResponsibleGroup`. That installation has a field for an outside reference |
| A reference is read back as `Data.<field>.Data.Id` | How a reference is written on create is not shown |
| Free text is in `Memo`, keyed by memo type (`Problem` and `CaseInternalNotesCustom` are read by one client), each `{ Extension: ".html" \| ".txt", Style, Memo, HandleSeparators, IsValidForWeb }` | The description is not a field of `Data` |
| A note on an existing errand is an update of the errand with a memo. The mapper appends the new text to the memo's existing text before sending | A `POST` seems to replace a memo. Adding a note is then read, append, write, and two writers can lose a note |
| Other lists are read with `?Filter=<Field>=<value>`, `Fields=` and `limit=` | Probably the filter syntax for `/case` too. Not shown for errands |
| The key goes in the `Authorization` header. One client takes it per call from its own caller | Consistent with Basic. An account per calling system, not per person |
| One client calls `cases`, the other `case` | One of them is probably behind a gateway that renames paths. The guide says `/case` |
| Create answers a list of trigger results, each with an `Id` and links | Whether that `Id` is the new errand's is not shown |

**The errand code in this checkout** at `d0ec82b5`: `apps/server/src/modules/errands/`, `connectors/supportmanagement/`, `connectors/nextcloud-approval/`, `packages/connectors/src/asks.ts` and `apps/server/src/threads/usecases/decisions.ts`.

## Design

### The POB handling is in the connector

The first answer in the session followed [D89](../decisions/D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md) to the letter: the connector forwards the person's token, so something in front of POB would have to accept it. Oliver Borgström rejected that, for reasons that hold:

- D89 was written for SupportManagement, a service its installation owns, and says "the surrounding systems may be changed". POB is a vendor's product. An installation cannot make it accept a token.
- Clew is meant for other municipalities, and each connector is meant to be movable to a repository of its own. A service in front of POB plus a connector is two things to set up and keep for one list.
- The service in front and the connector would be the same code in two places.

What is kept from D89 is the part that protects a person's errands: **who the person is never rests on Clew's word.**

1. The manifest declares `delegation` with the installation's audience for POB. Clew trades the person's session for an identity provider token for that audience and sends it in `X-Clew-Delegated-Token`, as it does for `sm` today. Nothing in the protocol changes.
2. The connector validates that token itself against the identity provider's keys: signature, issuer, audience, expiry.
3. The account in the token must be the actor in Clew's assertion (`actor.userName`), as `connectors/nextcloud-approval` already checks.
4. The connector finds the person in POB from that account and asks POB with its service account, narrowed to that person.
5. Without a valid token no call is made to POB. The service account is never used for anything that has no signed-in person behind it, so D89 item 5 stands unchanged.

This departs from D89 items 1 and 2 (no service credential; no lookup from a Clew person to an account in the case system) and needs a numbered record, `provisional` under [D102](../decisions/D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md), in the change that lands phase 1. Proposed wording: *when a case system cannot accept the person's token and the installation cannot change it, the connector is the trust boundary: it validates the person's token itself, holds the service credential, uses it only behind a valid token, and applies a relation rule and nothing wider.*

### What is code and what is configuration

Other installations have POB set up differently, so what differs between them is configuration. What must be the same everywhere, and above all what protects access, is code.

| In the code, the same for every installation | In the configuration, per installation |
|---|---|
| POB's protocol: Basic auth, the envelope, `PUT` creates, the memo object, the filter syntax | The address and the account |
| POB's standard fields: `Description`, `CaseType`, `CaseCategory`, `Contact.Customer`, `Responsible`, `ResponsibleGroup` | Which field of a POB user and a POB customer the directory account is compared with |
| The identity checks, their order, and the relation rule. Never switchable and never widened by a setting | What each status means: open, waits for the reporter, closed |
| The mapping to Clew's errand row | **Which case types the connector reads at all** |
| | The type, the group and the priority a new errand gets; the categories a person may choose from |
| | The memo type the description and a note are written to |
| | **Every field that is not standard in POB** (the `Virtual.…` fields and their like): the outside reference, and extra fields with fixed values for a POB that requires fields of its own |
| | The system's name and the address of an errand in POB's interface |

Oliver Borgström settled three things about how general the connector is to be (2026-11-16):

- **Standard fields are named in the code, fields that are not standard in POB are configuration.** The standard names are constants in `pob.mjs`. If phase 0 shows that one of them is not what this POB calls it, it is by that not standard and moves to the configuration.
- **Which case types are read is configuration.** A POB can hold several service desks, some of them sensitive. `POB_CASE_TYPES` is the list of case types the connector lists and opens; an errand of another type is not found, in the filter and again in the connector's own check.
- **One POB per installation is assumed.** The connector's id is the constant `pob`, as `sm`'s is. Two POB instances in one installation are not planned for.

A script that runs phase 0's questions against any POB was proposed and set aside by him the same day: the first installation is verified by hand, and a script is written when a second installation needs one.

No mapping language: no expressions, templates or per-field rules in the configuration. An installation that needs more fields filled in by the person needs a change in the code, and Clew's form takes six fields at most.

**A check at start.** With the `api` adapter the connector reads `GET /entity/case` and the lookup lists once when it starts, and refuses to start, with an error that names the variable, when the configuration names a field, a case type, a category or a group that this POB does not have, or when POB has a status that `POB_STATUS_KINDS` gives no meaning. A misconfiguration is then found at start and not when the first errand is created. Whether `/entity/case` answers enough for this is a phase 0 question.

### The limits this design has

For the three things planned it is not a corner. For some others it is, and they are better known now.

- **Anything about other people's errands.** With a service account there is no way to ask POB what a person may see. "My errands" is a small rule. A colleague's errands, a manager's view of a unit, or free search would each mean rebuilding a part of POB's own permissions in the connector, and each is a security decision. This follows from POB's Basic auth, not from the plan. If an installation's POB ever accepts a person's token, `pob.mjs` and `identity.mjs` change, the service account goes away and D89 applies as written.
- **The combined list is Clew's.** A field only POB has (priority, an SLA) is shown when the errand is opened, not in the list. Putting it in the list is a contract change for every case system.
- **Forms are small.** Six asks, eight choices. Enough to report a fault, not for a service catalogue with a form per service.
- **The ref is hard to change.** `errand:pob:<id>` is kept in cards once a scan is switched on, so which of POB's identities it carries is chosen once (phase 0).
- **Token exchange is assumed.** The identity check needs an identity provider that exchanges a token for the POB audience (RFC 8693). Keycloak does. This is Clew's own assumption for every delegating connector (D26), but this plan stands or falls with it.

## Phase 0 · Verify against a running POB

The first version of this plan built a made-up POB from guesses and verified last. That is the pattern the project review of 2026-11-10 found: `sm` has still not met its system. So this comes first, and nothing in phase 1 beyond the skeleton is written before it.

It is an afternoon with a test POB and the person who runs it, done by hand. Each answer is written into the connector's README under "Verified", with the request that gave it. An exchange recorded from a real POB names people; what enters the repository is rewritten with made-up values first, as `connectors/nextcloud-approval/samples/` is.

| | Question | How | If the answer is bad |
|---|---|---|---|
| 1 | Which field of `/user`, `/account` and `/customer` holds the directory account or the address, in which form (with or without a domain part), and is it filled in and **unique** for everyone? | A sample of each, and a count of duplicates | The plan stops here. Without a sure match from a person to their POB records there is no list |
| 2 | Which fields of an errand carry the handler, the group, the reporter, the status, the last change, a deadline? | `GET /entity/case` | The standard names above are wrong for this POB, and they become configuration |
| 3 | Can `GET /case` filter on handler, on group with no handler, on reporter and on case type? How is a filter written, combined and paged, what is the limit when none is given, and does an answer say that it was cut? | Trial | The connector reads more and narrows itself, within the page limit; the group queue may have to go |
| 4 | Which is the stable identity of an errand, the internal id or the number? Are times given with a zone? | Two reads of the same errand | Decides the ref. Without a zone, `POB_TIMEZONE` says which one POB writes in |
| 5 | The status values, and which of them mean "waits for the reporter". Is there a field that says an errand is closed, apart from the status name, and when it was closed? | `GET /enum/{id}`, `GET /entity/case` and the people who run the service desk | Every open status counts as open, and "Väntar på dig" is never shown to a reporter |
| 5b | Which memo types does an errand have, and which of them is the reporter's own text and which are internal? | `GET /case/{id}/memo` on a few errands | Only the one memo type known to be the reporter's is ever shown |
| 6 | How long do the five calls of one list take? | Timed | A person lookup kept for a few minutes becomes necessary (planned below) |
| 7 | Is there a read-only role? Does a locked or expired account answer differently from a wrong password? Is there a limit on calls or sessions per account? | POB's administration | Shapes the back-off in phase 1 |
| 8 | Does `/entity/case` name required fields, and do the lookup lists answer ids the start check can compare with? | Trial | The start check covers less |
| 9 | Can the identity provider exchange a token for a `pob` audience, and which claim carries the account? | The identity provider's operator | No phase 1 |
| 10 | Is the path `/case` or `/cases`? Is the credential a user name and password, or a ready key for the `Authorization` header? Does the installation's POB have any sign-in for the API besides these? Is its certificate from an internal authority? | Its operator | |
| 11 | For phase 3: which fields does a create require; how is a reference written; what does the answer hold; can `Virtual.ExternalCaseId` or its like be set on create and filtered on? | A create in the test POB | Without a reference field a create is `manual` |
| 12 | For phase 4: does a `POST` with a memo replace or append; can a call name the author of a note? | Trial | Phase 4 writes the person's name into the text |

**Done when** 1 to 10 are answered in writing. 1 and 9 can stop the work; the rest shape it. Since what a person reported is shown first (phase 2), question 5 decides whether the list can say "Väntar på dig" to a reporter, and of question 1 the customer match is the part most people depend on.

## Phase 1 · List a person's errands

### The connector

A folder `connectors/pob/`, id `pob`, shaped as `connectors/supportmanagement` is, with no dependency beyond Node and nothing imported from the rest of the repository.

| File | Holds |
|---|---|
| `manifest.mjs` | The two reads, their views, the errand row and the ref pattern |
| `connector.mjs` | The reads, the row mapping, the state rule, the assertion check, the order of the identity checks, the access log and HTTP error handling |
| `identity.mjs` | Validation of the delegated token against the identity provider's JWKS and the comparison with the actor. New compared with `sm`, whose fixture reads the token without checking the signature |
| `cases.mjs` | The case port, the mapping from POB's errand to what the connector works with, the relation rule, and a made-up POB |
| `pob.mjs` | POB's API behind the port: the only file that knows Basic auth, the paths, the envelope and the field names. Also the check at start |
| `config.mjs` | Reads and validates the configuration, and throws an English error that names the variable |
| `verification.mjs` | The check of Clew's assertion, as `sm` has it |
| `server.mjs`, `Dockerfile`, `compose.yaml`, `README.md`, the `.d.mts` files, `samples/` | As `sm` and `nextcloud-approval` |

The manifest: `protocol: 3` (2 when this plan was written; main moved to 3 before the work was merged), `kind: 'passthrough'`, `areas: []`, `scan: false`, `delegation: { audience }`, and two capabilities.

| Capability | Kind | Model | Answers |
|---|---|---|---|
| `pob.errands` | read | `model: true`, `modelReads: 'summary'` | `{ view?: 'assigned' \| 'reported' }` to an `ErrandsOutput`. A list view whose `open` is `pob.errand`. The profile name, so Clew joins it into `clew.errands` and offers the model that list instead |
| `pob.errand` | read | `model: false` | `{ ref }` to the row's fields plus title and description, a detail view. The free text may name anyone, so it is never a tool |

### Identity, in order

Each step that fails ends the request with the answer in the right column, and no later step runs.

| | Check | On failure |
|---|---|---|
| 1 | Clew's assertion and the connector key | 401 `denied` |
| 2 | `X-Clew-Delegated-Token` is present | 403 `denied`, "Din inloggning kan inte styrkas mot ärendesystemet i den här sessionen." |
| 3 | The token's signature against the keys at `POB_IDP_JWKS_URL`, its issuer equal to `POB_IDP_ISSUER`, the audience including `POB_AUDIENCE`, not expired | 403 `denied`. When the keys cannot be fetched: 503 `unavailable`, since nothing is known about the token |
| 4 | The claim named by `POB_ACCOUNT_CLAIM` (default `preferred_username`) equals `actor.userName`, compared without case | 403 `denied` |
| 5 | The person in POB: **exactly one** handler record and **exactly one** customer record may match the account. No match in a role means the person has no errands in that role | No match in the role asked for: an empty list, not an error. Two or more: 403 `denied`, "Dina uppgifter i <system> är inte entydiga, så dina ärenden kan inte visas här.", and the access log says `ambiguous` |

Step 5's "exactly one" is the rule the first version lacked. A field that is not unique (a shared mailbox, a reused account) would otherwise give one person another's errands, which is the one failure this connector must not have. A person with two records is told so and is not shown an empty list: "no errands" would be false, and nobody would know to clean the records up. In the combined list the system is then named among those that did not answer. The count of `ambiguous` lines in the log is the operator's measure of how many people it concerns.

The account goes into a filter to POB, so before step 5 it must fit a strict pattern (letters, digits, `.`, `_`, `-`, `@`); anything else is refused at step 4 and never sent.

The keys are fetched from the configured address only, over HTTPS outside the development allowlist, and kept for a short time. The algorithm comes from an allowlist in the code, never from the token's header. The validation is written with Node's own `crypto`, as `verification.mjs` checks Clew's assertion.

### The questions to POB

The port has two functions, `mine(person, relation)` and `one(person, id)`, where `person` is what step 5 found: the handler id, the ids of their groups, the customer id.

| Relation | Returns the open errands that are | In `view` |
|---|---|---|
| `assigned` | assigned to the person as handler | `assigned` |
| `group` | assigned to a group the person belongs to, with no handler | `assigned` |
| `reported` | reported by the person as customer | `reported` |

- Each relation is one filtered `GET /case`, with the filter written out in the request and only the fields the row needs asked for. **Not a saved view (`view=`)**: a view is defined inside POB and can be changed there without the connector knowing, which would widen what the service account returns without a line of code changing.
- The filter is a first narrowing. Every errand that comes back is checked again in the connector against `person` before it becomes a row, so an ignored or misspelt filter answers with fewer rows or none, never with someone else's.
- Only errands of the case types in `POB_CASE_TYPES` are asked for, and the second check drops any other type.
- `one(person, id)` reads `GET /case/{id}`, decides the relation from the errand's own fields and its case type, and answers nothing unless both hold. The memo is read only after that.
- **Only the reporter's own text is shown.** The description is the one memo type `POB_PROBLEM_MEMO` names and no other. An internal note is never read for a reporter, and in phase 1 not for a handler either. Text stored as HTML is turned into plain text, never drawn as markup.
- Closed errands are left out of the list, decided by POB's own field for closed if phase 0 finds one and otherwise by `POB_STATUS_KINDS`. At most five pages are read. An answer that was cut, or a sixth page that exists, makes the connector answer as a system with no answer, never as a list that looks whole.
- A time without a zone is read in `POB_TIMEZONE`.
- Display names for types, categories and statuses are read once and kept for ten minutes.
- **The person lookup is kept for five minutes**, in memory, keyed on the validated account: the POB ids of the person and their groups, nothing else. This changes the first version, which kept nothing. Without it every list is five calls to POB inside Clew's four seconds; with it, two. The cost is that a person removed from a group in POB sees that group's queue for up to five minutes more. Nothing of an errand is ever kept.

### The row

| `ErrandRow` | From POB |
|---|---|
| `ref` | `errand:pob:<the stable identity, phase 0 question 4>`. One POB per installation is assumed, so nothing in the ref says which |
| `label` | The errand number and the type and category display names. Never `Description`, a name or an account |
| `state` | From the status and the relation, by the same rule as `sm` (`stateOf` in its `connector.mjs`). What a status means is `POB_STATUS_KINDS`; a status without an entry counts as open |
| `status` | POB's own display name for the status |
| `waitingOn` | `Dig`, `Din grupp`, `Anmälaren`, `Handläggare` or `Parkerat till …`, where the errand says so |
| `since` | When the errand last changed |
| `dueAt` | Not set in phase 1. See phase 2, the deadline question |
| `area` | The handling group's display name. A label only |
| `link` | From `POB_CASE_LINK`, where the operator has set one |

### Operation

- **An access log.** POB's own log shows the service account for every read, so the connector says who looked: one line per list (the account, the view, the number of rows) and one per opened errand (the account, the errand's id, `shown`, `not-found` or `ambiguous`). Never a title, a description or a name from POB. To standard output, for the operator's log collection; how long it is kept is the operator's.
- **The account must not be locked by the connector.** When POB refuses the credential the connector answers `unavailable`, logs it once, and makes no call for a while that grows up to some minutes, so a wrong password does not become a locked account. A changed password is a restart.
- **A limit on calls in flight** to POB and a time limit per call below Clew's four seconds, so a slow POB is `unavailable` here and named in the combined list, not a hang.
- **Nothing sensitive leaves.** The password is read from the environment or a mounted file and appears in no log line and no error. POB's error text (`UserMessage`, `Message`, `InternalMessage`) stays in the connector.

### Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET`, `CLEW_URL`, `PORT` | As every connector. Port 4055 (4053, free when this was written, is the Moodle connector's on main) |
| `POB_ADAPTER` | `fixture` (default) or `api` |
| `POB_URL` | POB's API base, with the path prefix this installation has. Required for `api`; HTTPS outside localhost |
| `POB_USER`, `POB_PASSWORD` or `POB_PASSWORD_FILE` | The service account. Required for `api` |
| `POB_AUDIENCE` | The audience the person's token is issued for. Default `pob`. Part of the manifest |
| `POB_IDP_ISSUER`, `POB_IDP_JWKS_URL` | The identity provider the token must come from, and where its keys are |
| `POB_ACCOUNT_CLAIM` | The claim that carries the account. Default `preferred_username` |
| `POB_USER_MATCH`, `POB_CUSTOMER_MATCH` | The POB field the account is compared with, for a handler and for a customer. Required for `api`: there is no safe default |
| `POB_SOURCE_LABEL` | The system's name as a person reads it. It must differ from every other case system's |
| `POB_STATUS_KINDS` | JSON object, POB status to `new`, `open`, `waiting-reporter`, `waiting-other` or `closed`. Every status this POB has must be in it |
| `POB_CASE_TYPES` | JSON array of the case types the connector reads. Required for `api`: which service desks a person meets in Clew is the installation's choice |
| `POB_PROBLEM_MEMO` | The memo type that holds the reporter's own description. Default `Problem` |
| `POB_TIMEZONE` | The zone POB writes times in, when it writes them without one. Default `Europe/Stockholm` |
| `POB_CASE_LINK` | The address of one errand in POB's interface, with `{id}` or `{number}` in it |
| `POB_WRITES` | Empty in phase 1. `create` in phase 3, `create,reply` in phase 4. With it empty the manifest holds the two reads and the POB account can be read-only |

The only settings that touch access are the two match fields, and step 5's rule holds whatever they say.

### The fixture and the development stack

- `cases.mjs` holds a made-up POB that answers the port: a handful of errands, two handling groups, the development realm's synthetic people as a handler, a reporter and a person with no record, and two records that share an account, for the ambiguity rule. No vendor data. It is written after phase 0, in the shapes POB was seen to answer.
- Token validation is the connector's, not the fixture's, so it runs in development against the development Keycloak's real keys. A test passes its own key set.
- `scripts/auth-setup.ts` gets `audienceClient('pob')` beside the SupportManagement audience.
- Registered by hand, as `sm` is: `connector-check.ts`, then `connector-add.ts`, then the audience and the switch on Administration › Anslutna system.

### The order of work

1. The skeleton: manifest, server, `verification.mjs`, `config.mjs`, an empty port. Passes `connector-check.ts`, which has no session and expects the delegated reads to be denied.
2. `identity.mjs` with its tests.
3. The port, the relation rule, the second check and the fixture, with their tests.
4. `pob.mjs` against the rewritten samples from phase 0, and the check at start.
5. The access log, the back-off, the limits.
6. The documents: the connector's README (what it does, what an installation sets up, verified and unverified), a row in `connectors/README.md` under "Written for a real system", `docs/reference/status/connectors.md` under Errands, the top of `docs/reference/licences.md` (Node's image, nothing new), the numbered record, and D89 naming it.
7. Phase 2's tests.

### Tests

`tests/unit/pob-connector.test.ts`:

- The identity table, one case per row, and that POB is not called when any of steps 1 to 4 fails.
- A token for another audience, an expired one, one signed by another key, one whose account is not the actor, one whose header names an algorithm outside the allowlist.
- **Two POB records for one account give no errands in that role**: the person is told why, and the log line says `ambiguous`.
- An account with a character outside the pattern never reaches POB.
- An errand of a case type outside `POB_CASE_TYPES` is not listed and not found by its id, also when the port returns it.
- A reporter is shown the problem memo and nothing of an internal one, also when the port returns both. HTML comes out as text.
- An answer that was cut is a system with no answer, not a short list. A time without a zone is read in the configured one.
- The check at start refuses a POB status that has no meaning in the configuration.
- The three relations; a handler sees their own and their group's queue; a reporter sees only what they reported; a person with no record gets an empty list.
- **The second check:** a port that ignores the filter and returns every errand still gives the person only their own rows.
- An errand the person has no relation to answers "not found" with the same text as one that does not exist, and its memo is never requested.
- The row: nothing of `Description`, a name or an account in `label`; `state` for each status kind and relation.
- The adapter against the samples: Basic auth on every request, no verb but `GET`, the filter written as phase 0 found it.
- A refused credential stops the calls for the back-off time. The password is in no log line and no error body.
- The check at start refuses a configuration that names a field this POB lacks.
- The person lookup is kept for five minutes and never across accounts.

### Done when

- `bun run check` passes and the connector passes `connector-check.ts`.
- The documents of step 6 are written.
- Against the test POB, signed in on the development stack: **two people see different errands, a person with no POB record sees none, and an errand opened by its id by someone with no relation to it is not found.** This is the condition D101 set for Nextcloud, and until it holds the status page says "not run against its system".
- A person has tried it in the development stack before anything is committed.

## Phase 2 · One list with SupportManagement

Most of this already holds, because D89 item 8 built the list for several systems before a second one existed.

| Needed | State |
|---|---|
| Both systems asked at the same time, each under its own budget (4 s inside 5 s) | Built: `apps/server/src/modules/errands/usecases.ts` |
| A token per system: `sm` for the audience `supportmanagement`, `pob` for `pob` | Built: the registry asks `delegate(audience)` with each manifest's audience (`packages/connectors/src/remote.ts`) |
| One list ordered by the shared state, whichever system holds the errand | Built: `merge` in `domain.ts` |
| A row opens in its own system: `pob.errand` or `sm.errand` | Built: `rowViews`, from each connector's `open` |
| A system that fails or is late is named and the other is listed; nobody answering is an error, never an empty list | Built |
| A person with one of the systems sees that one alone, and cannot tell the other exists | Built: the audience of each registration |
| One area, one menu row, one model tool, whatever the number of systems | Built; `pob` declares none of them |
| The same ref in two systems is two errands | Built: `merge` keys on the connector id and the ref |

What this phase adds, so that it is tested with the real connectors and not only with stand-ins:

- A case in `tests/unit/errands.test.ts` beside "the SupportManagement connector is one system among the others": **both `sm` and `pob` as remote connectors on their fixtures**, the delegate answering a different token per audience. It asserts that each connector got the token for its own audience and refuses the other's, that the rows interleave by state, that a row of each opens its own read, that a failing POB leaves SupportManagement's rows with POB named, and the reverse.
- A person who is a handler in one and only a reporter in the other.
- In `tests/a11y/views.spec.ts`, the existing two-system case run once with `pob` as the second system. Last, after everything else is built.
- Both connectors on their fixtures in the development stack, ports 4050 and 4055, for the trial by hand.

### What the person reported comes first

`clew.errands` takes `assigned` or `reported` and today shows `assigned` first: it passes no view on, and each connector then answers with its own default. Most employees are reporters in a service desk and handlers nowhere, so "Mina ärenden" and the section on Hem would be empty for them until they changed the filter. Oliver Borgström said on 2026-11-16 that Mina ärenden should first of all show the errands a person has reported, since the status of one's own support errands is what most people on the start page want to see. So the first view becomes `reported`, for every case system, `sm` included. It is a change in Clew's own list and not in a connector, and it does not wait for POB:

- `apps/server/src/modules/errands/usecases.ts`: `list` asks every system for `reported` when no view is given, and says so explicitly, so that the first view is Clew's and not each connector's own default.
- `apps/server/src/modules/errands/capabilities.ts`: "Anmälda av mig" is the filter's first choice, and the description names it first. The model's tool `clew.errands` then also answers with what the person reported unless asked otherwise.
- The profile is unchanged: `<id>.errands` still takes both views, and a connector's own default is no longer what a person meets.
- Tests: the default in `tests/unit/errands.test.ts`; `tests/a11y/errands.spec.ts` and `tests/a11y/views.spec.ts` where they expect the assigned rows first, run last.
- D90, which owns the section on Hem, gets an amended line. No numbered record: it is one list's first view (D102).

What follows from it:

- **A handler is one choice away** from what is assigned to them and their group. The alternatives, a first view that joins both or `reported` only when `assigned` is empty, were not chosen. If handlers ask for more, a joined view is the next step.
- **"Väntar på dig" for a reporter is now the row that matters most**: the service desk has asked something and waits for the answer. It rests on knowing which statuses mean that (phase 0, question 5), so that question moves up beside the two that can stop the work.
- **Phase 1 can be delivered in two parts.** `reported` needs one match (the person's customer record) and one question to POB. `assigned` and `group` need the handler match, the group memberships and two more filters. Building `reported` first gives most people the list sooner and on fewer of phase 0's answers. Until the second part is there the connector must answer `assigned` as a system that has no answer, never as an empty list, so that a handler is not told they have no errands.

### What a second system brings to the surface

Two more things, neither the connector's to settle; each waits for the product owner.

1. **A deadline in one system moves its errands ahead.** Within a state the order is the nearest `dueAt`, and a row without one sorts last. `sm` never sets `dueAt`. If `pob` set it, every POB errand in a state would stand before every SupportManagement errand in that state. So `pob` leaves it unset until this is decided.
2. **Two systems need two names.** `sm`'s default source label is "Ärendesystemet". With a second system that says nothing, in the list's system column and in "svarar inte just nu". An installation sets both labels; the defaults could become the systems' own names.

**Done when** the first view is what the person reported, the two-system test passes, both systems have been seen in one list in the development stack, and the two questions are in `docs/maintainers/open-questions.md` or answered.

## Phase 3 · Create an errand

"My computer does not start", typed or said to the assistant, becomes an errand in POB after the person has read it and approved.

| Capability | Kind | Notes |
|---|---|---|
| `pob.reportProblem` | propose, `model: true` | Started from the conversation. Input: an optional title, description and category. It writes nothing; it answers a draft, a card with the action below, carrying as the action's own input whatever the conversation gave |
| `pob.createCase` | execute, `model: false` | `asks`: title (`text`), description (`long-text`), category (`choice`, at most eight, from `POB_CATEGORIES`). `PUT` |
| `pob.createEffect` | read | The `effect` of the execute: "Ett ärende skapas i <system> med dig som anmälare", drawn as "Det här händer" |

How the text gets in is settled by how asks work (`asksFor` in `packages/connectors/src/asks.ts`): **a property the draft already gives is not asked.** So for each of the title and the description it is one or the other.

- Left out by the assistant: the person types it in the step "Fyll i".
- Drafted by the assistant: it is shown on the card and approved as it stands. It cannot be edited in "Fyll i"; the person asks the assistant for a new draft.

The typed path is built first. It needs no model, and it is the floor D104 asks for.

What the connector sends, from the public code and to be confirmed by phase 0 question 11:

| Part | From |
|---|---|
| `Type: "Case"`, `Links: []` | Code |
| `Data.Description` | The title |
| `Data["Contact.Customer"]` | The customer found from the validated token. Never an input. A person with no customer record, or an ambiguous one, is refused with a sentence that says so; the connector creates no customers |
| `Data.CaseType`, `Data.ResponsibleGroup`, `Data["PriorityInfo.Priority"]` | `POB_CASE_TYPE`, `POB_RESPONSIBLE_GROUP`, `POB_PRIORITY` |
| `Data.CaseCategory` | The person's choice among `POB_CATEGORIES`, or the one configured category |
| Further fields with fixed values | `POB_CREATE_DEFAULTS`, a JSON object, for a POB that requires fields of its own |
| `Memo[<POB_PROBLEM_MEMO>]` | The description, as plain text (`.txt`). Default memo type `Problem` |
| The outside reference | Clew's operation id in the field `POB_EXTERNAL_REF_FIELD` names, when it is set |

- **Never repeated.** `execution: { strategy: 'manual' }` when no reference field is configured: a lost answer is an unknown outcome the person resolves by looking in the list. With a reference field that can be filtered on: `deduplicated`, with a lookup read that searches for the operation id, so Clew can tell whether the errand exists before anyone sends it again.
- The receipt is the errand number, read back with `GET /case/{id}`.
- The dispatch carries the token of the session that approved, as every delegated write does (`docs/architecture/identity.md`). The identity checks of phase 1 run again at execution.
- The POB account needs the right to create errands. `POB_WRITES=create` adds the three capabilities to the manifest; without it they are not there, and the check at start covers the create settings only when it is on.

Open before this phase starts:

- **What Clew keeps of the text.** The approved input is kept in the execution ledger, and the answers to the asks are in the audit row (`apps/server/src/modules/executions/usecases.ts`). A drafted title and description are on the card. So the text of an errand created through Clew is stored in Clew, which D18's rule for errand text (read live, not kept) did not have to consider. It is the person's own words about their own problem, but it can name a colleague. Whether that is acceptable, and for how long it is kept, is the product owner's.
- **Where a person starts it without the assistant.** From the conversation it needs nothing new. As a suggestion under "Menar du" it needs an area with a standing action, and D89 item 8 says an errand connector declares no area. A new errand may belong to the area "Ärenden" that `clew.errands` owns, which a connector outside Clew's process cannot add to today.
- **The freeze (D101).** A write on an errand connector uses the action path that exists and adds no view kind, entity kind or destination. That reading is this plan's, not the product owner's; ask before building.

**Done when** an errand typed in Clew is in the test POB with the right reporter and its number is on the receipt; a lost answer does not give a second errand; a person with no customer record is told why; the scenario test asserts the audit row; and the flow has had a pass with a screen reader.

## Phase 4 · Reply in an errand

**Set aside on 2026-11-16 (Oliver Borgström).** The reply that matters is not the one this phase was written for. With what a person reported shown first, the case is the reporter answering the service desk when their errand says "Väntar på dig"; today they see that in Clew and have to go to POB or to their mail to answer. It is not built, on the made-up POB either, because how such an answer is handled today is unclear, and without that nobody can say which of POB's two ways is the right one:

| Way | In the guide | What is not known |
|---|---|---|
| A message on the errand | `PUT /mail` "Skapa nytt", under "Skickade/mottagna meddelanden kopplade till ärenden"; read back with `GET /case/{id}/mails` | Its fields (`GET /entity/mail`); whether a message made through the API moves the errand out of "waits for the reporter" and reaches the handler as a mail that came in does; whether POB sends it out as mail, which would make it the wrong way |
| A note on the errand | Only the read, `GET /case/{id}/memo`; the public code writes by updating the whole errand with `POST /case` | Whether anyone at the service desk sees it; and the write replaces the memo's text, so a note written in POB at the same time can be lost |

The guide has no endpoint for a reporter's answer as such, and says nothing of a self-service portal. The first looks more likely to be right, since a reporter's answer normally reaches POB as mail; that is a conclusion, not something read. It is taken up again when the people who run the service desk have said how a reporter's answer reaches them today. What follows is the phase as first written, for a handler's note and a handler's message.

| Capability | Kind | Notes |
|---|---|---|
| `pob.addNote` | execute, `model: false` | An internal note. `asks`: the text (`long-text`). Written to the memo type `POB_NOTE_MEMO` names |
| `pob.messageReporter` | execute, `model: false`, with a confirmation | A message that leaves POB to the person who reported. A separate action because it cannot be taken back |

- The relation is checked again at execution, from the validated token and the errand as it is then. A handler may note; who may message the reporter is decided with the people who run the service desk.
- **A note may be read, append, write.** If phase 0 question 12 shows that a `POST` replaces the memo, the connector reads the memo, appends and writes, and a note written in POB between the read and the write is lost. Then either POB has a safer way (a diary entry, an activity), or the README says what can be lost and the action is kept to errands the person is the handler of.
- **POB will show the service account as the author** unless the API lets a call name one. Until then the person's name is written into the text itself, and the README says so. Clew's audit row says who approved either way.
- A `POST` that updates an errand must send the `Id` and the memo and nothing else, so that no other field is overwritten.
- The assistant never calls either. It can draft the text; a person approves.
- The POB account needs the right to update errands, and should not have the right to delete or close them if POB's roles can tell those apart.

## Not covered

Found when the plan was read again on 2026-11-16. None of these has a phase; each is a decision before it is work.

- **Errands that were just closed.** With what a person reported shown first, "solved" is often the answer they came for, and the list leaves every closed errand out. The shared state has `closed`, sorted last, so errands closed in the last days could be listed; how many days is not decided.
- **What the service desk answered.** The errand view shows the status and the person's own description, not what was written back. That is probably what a reporter most wants to read, and it is the hardest text to tell apart from an internal note (phase 0, question 5b).
- **Rows that cannot be told apart.** The errand row's `label` may never carry the title, so five reported errands can all read "Incident, Hårdvara". For one's own errands that is a real problem, and it is a question about Clew's contract (a title that the list shows and the model never reads), not about this connector.
- **Attachments.** A screenshot is what a person most often wants to send with a fault. Phase 3 has none.
- **Bringing it in.** The audience of the connector's registration can hold a small group first, and switching it off is one choice on Administration › Anslutna system. Who is in the first group and what they are asked to look for is not planned.
- **Personal data.** The access log, the person lookup kept for five minutes and, from phase 3, errand text kept in Clew are processing an installation has to describe and assess for itself. The connector's README says what is processed, where and for how long.
- **Other installations' identities.** Clew, the identity provider and POB may write the same account differently (with or without a domain part, in different case), and a POB may take a ready key instead of a user name and a password. Phase 0 answers both for the first installation, and what it needs is built. Options for other forms are added when an installation needs them, as the verification script is.

## Later, and not planned here

- **Cards on Hem.** The first version copied `scan: false` from `sm`. A scan on a delegating connector does run while the person's own session asks for it (`scanOne` in `packages/connectors/src/index.ts`; `nextcloud-approval` gets its cards this way), so "the service desk waits for your answer" could be a card. It needs D89 item 4's card for an errand, which nobody has built, and it fixes the ref.
- **Search by errand number** (`pob.search` with `kinds: ['case']`), within the relation rule.
- **The person's own equipment** from POB's CMDB as a choice when reporting a fault. The public code reads `configurationitems` by serial number.

## What an installation sets up

One container, and three things around it:

1. The connector, with the address of POB and of the identity provider.
2. An account in POB for it, read-only until `POB_WRITES` is set.
3. An audience for it at the identity provider, with token exchange from Clew's client.
4. The registration in Clew, with the audience of people it is for.

No service in front of POB, and no change to POB.

## Questions this leaves, and who they wait for

| Question | Waits for |
|---|---|
| Is there a test POB to verify against, and who runs it? | Whoever operates POB |
| Does POB carry the directory account, uniquely, on handlers and customers? | Whoever operates POB |
| Is the departure from D89 for a system that cannot be changed accepted, in the wording above? | Product owner |
| Does `pob` set `dueAt` while `sm` cannot? | Product owner |
| Is `reported` built first in the POB connector, with `assigned` and the group queue after? | Product owner |
| May Clew keep the text of an errand a person creates through it, and for how long? | Product owner |
| May phases 3 and 4 be built while the freeze stands? | Product owner |
| Who may send a message to a reporter from Clew? | The people who run the service desk |
| How does a reporter's answer reach the service desk today: as mail that POB ties to the errand, in a portal, or otherwise? Phase 4 waits for this | The people who run the service desk |
