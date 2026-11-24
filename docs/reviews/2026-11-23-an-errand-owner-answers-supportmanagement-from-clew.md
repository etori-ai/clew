# Implementation plan: an errand's owner reads and answers its messages from Clew · 2026-11-23

Oliver Borgström asked how a person who owns an errand in SupportManagement (a manager who sent something to Intern
kundtjänst or Lön och pension, say) could always see the messages a drake sends them and answer from Startsidan, and
then for a full plan. This is that plan. It rests on a reading of Draken (`web-app-draken-public` at `8db24425`),
SupportManagement, the access mapper and loader, the Open-E integrator and the web message sender (the public
repositories of Sundsvallskommun as of 2026-11-20 and 2026-11-23), and on what was said in the conversation that
produced it.

The answer takes the drake's own channel, and only Open-E is answered inside Clew:

- **E-mail:** Clew opens the person's own mail program with the address and subject filled in, and the person sends.
  The mail is in their Sent folder and their thread like any other. Clew sends nothing.
- **Open-E:** the person writes the answer in Clew, and Clew posts it to Open-E as the errand's owner, where it lies
  in the e-service's message thread like one written there.
- **Conversation** (katlor, once it replaces Open-E): the same answer in Clew, posted to the conversation. Later.

| Phase | Gives | Depends on |
|---|---|---|
| [0 · Verify](#phase-0--verify) | The facts the rest is built on; question 1 first, since it can stop the plan | The people who run the drakar, SupportManagement, Open-E and the gateway |
| [1 · Identity and the rule](#phase-1--identity-and-the-owner-rule) | The connector knows who asks and refuses what is not theirs | Phase 0, the product owner's word on the departure from D89 |
| [2 · The list](#phase-2--the-list-of-what-i-own) | `sm.requests`: the errands the person owns, with what waits on them first | Phase 1 |
| [3 · The thread and the mail link](#phase-3--the-errand-its-messages-and-the-mail-link) | `sm.request`: one errand with the messages between the drake and the owner, and "Svara via e-post" | Phase 1 |
| [4 · Private answers](#phase-4--an-answer-clew-does-not-keep) | An ask whose text Clew does not keep in its audit | The product owner's word; a core change |
| [5 · The card and the Open-E answer](#phase-5--the-card-and-the-open-e-answer) | "Lön och pension väntar på ditt svar" in Att göra, and "Svara" for Open-E | Phases 2–4 |
| [6 · Tests, docs, try-out](#phase-6--tests-documentation-and-the-try-out) | Done | All |

Phases 1–3 give the person their errands and a mail answer on their own, with no core change; phases 4–5 add the
Open-E answer.

## What it rests on

### Access in SupportManagement today

- **SupportManagement trusts `X-Sent-By`.** The caller is whatever `X-Sent-By: type=adAccount; <account>` says
  (dept44's `WebConfiguration`). No user token is read anywhere; any client holding a gateway credential may name any
  person.
- **The access control it has is not in use.** SupportManagement can decide access per AD account (labels from the
  access mapper, `LR`/`R`/`RW`, `reporterAccess`), but the access mapper does not run in production and almost no
  namespace has `accessControl` switched on (stated 2026-11-20). With it off, everything in a namespace is open to a
  gateway client.
- **Draken decides access in its own client.** Membership of a group in `AUTHORIZED_GROUPS` (from the SAML answer)
  lets a person into one drake's namespace, where they see everything; only the assigned handler may act
  (`validateAction`).

D89's premise, that the case system decides access, therefore does not hold for SupportManagement today, and there is
no plan to put the access mapper in production. Clew's connector has to hold the rule, as the POB connector already
does (it validates the person's token itself and applies its own rule).

### Who owns an errand

The owner is the stakeholder with the role `PRIMARY`. For an employee Draken stores `externalIdType: EMPLOYEE`, the
party id in `externalId`, the AD account as the parameter `username` and the address in `contactChannels`
(`support-stakeholder-service.ts:97`, `:154`). `reporterUserId` is not the owner: Draken sets it to the handler who
registers an errand (`support-errand.controller.ts:651`).

### Where the messages are

A drake talks to an owner by e-mail or through Open-E's message function, and, once Open-E is replaced by katlor, in a
conversation on the errand. All three end up on the errand in SupportManagement, each with its type, so the connector
can tell them apart:

| Channel | Out from the drake | Back from the owner |
|---|---|---|
| E-mail | `…/communication/email`, recorded as an outbound communication with its headers; Draken's subject is `Ärende #<errandNumber>` (`support-message-service.ts:111`) | The namespace's e-mail reader, every five minutes (`cron: 0 */5 * * * *`) |
| Open-E | `…/communication/webmessage`; SupportManagement sends the errand's `caseId` tag as `flowInstanceId` and `ESERVICE_INTERNAL` as the instance `INTERNAL` (`MessagingMapper.java:58-61`) | The web message collector, every five minutes (`cron: 15 */5 * * * *`), for the e-services in its configuration |
| Conversation | `…/communication/conversations/{id}/messages` | The same, at once |

The errand holds more than the drake's exchange with its owner: e-mails marked `internal`, e-mails to other people
(the employee a LÖP errand is about, a colleague), the handover mail to another department ("Överlämnat ärende
#…", `support-errand-service.ts:1198`), `INTERNAL` conversations and the conversation KC shares with a minidrake
through a relation. Draken shows all of them to its handlers on the errand's message tab, and a handler's "Svara" on a
message quotes it under "-----Ursprungligt meddelande-----" with `In-Reply-To` and `References` from its `Message-ID`
(`support-message-reply-context-service.ts`).

### How an answer gets in

SupportManagement has no call that records an owner's answer as an inbound message, so an answer has to come in the
way the channel's own answers do:

- **E-mail.** The e-mail reader takes the errand number from the subject: the text after the **first** `#` up to the
  next space, or to the end (`ErrandNumberParser.parseSubject`). It looks the errand up in its own namespace, whoever
  sent the mail. It saves the mail on the errand, notifies the assigned handler, and moves the status where the
  namespace is configured to (`triggerStatusChangeOn`). A mail on a closed or deleted errand is still saved, and the
  sender gets the namespace's "closed" answer. A subject without a number it can find **creates a new errand**
  (`EmailReaderWorker.java:140-155`, `:224`).
- **Open-E.** `POST /{municipalityId}/INTERNAL/webmessages` on the Open-E integrator, with `sender.userId` set and no
  `administratorId`, calls Open-E's own `AddMessageAsOwner`. The message is stored in Open-E, in the flow instance's
  thread, as the owner's, and the web message collector brings it to the errand as it brings any other, provided the
  e-service is in its configuration (`WebmessageService.java:39-47`, `MessageMapper.java:48-63`). The integrator
  passes `userId` through unchecked.
- **Conversation.** A message posted with the owner's `X-Sent-By`.

## Design

### The rule, in the connector

A person may see an errand, the messages it holds between the drake and them, and answer on it when, and only when, the
errand's `PRIMARY` stakeholder's `username` equals the person's AD account (compared without case). Nothing else gives
access: not `reporterUserId`, not a copy of a mail, not a group. An errand outside the rule is answered as not found.
The rule is checked on every read and again, on the errand as it is then, before an Open-E answer is sent.

The connector is the only thing between a gateway credential that can name anyone and the person, so:

- the AD account comes only from the person's delegated token, validated by the connector (signature against the
  identity provider's keys, issuer, audience, expiry), and must be the person Clew signed its assertion for;
- `X-Sent-By` and Open-E's `sender.userId` are only ever that account;
- every read and every send is written to the connector's access log (account, errand, outcome; never text).

### What the owner sees of an errand

Owning an errand does not open everything on it. The owner sees, and the connector reads state from, only the messages
between the drake and them, chosen by one pure function, `toOwner(message, owner)`:

| Message | Shown to the owner |
|---|---|
| An e-mail not marked `internal`, with the owner's address as its sender or among its recipients (To or Cc) | Yes |
| Any other e-mail: `internal`, to someone else, the handover mail | No |
| An Open-E web message on the errand | Yes: the e-service's thread is the owner's |
| A conversation of type `EXTERNAL` with the owner among its participants | Yes |
| An `INTERNAL` conversation, or one shared with another errand through a relation | No |
| An attachment | Named, under a message that is shown; never one under a message that is not |

The owner's address is the `PRIMARY` stakeholder's e-mail in `contactChannels`, compared without case. An errand whose
owner has no address shows its Open-E and conversation messages only. What is not shown is not counted either: it
never makes an errand wait on the owner, and never decides the channel of an answer.

### Answer where the drake last wrote

The channel of an answer is the channel of the drake's latest message shown to the owner on that errand, not the
channel the errand came in by: an Open-E errand the drake has since mailed about is answered by mail. That is what the
handler expects. One function in the connector, `channelOf(errand, messages)`, makes the choice over what `toOwner`
keeps, so that katlor's conversations take over by a change there:

| The drake's latest message | What the person gets | Who sends | It shows in Draken |
|---|---|---|---|
| An e-mail | The link "Svara via e-post", which opens their mail program with **To** the namespace's reply address and **Subject** `SV: Ärende #<errandNumber>`, which Clew writes itself. The body is empty. | The person, from their own mailbox: the mail is in their Sent folder and their thread | Within five minutes, as a mail in |
| An Open-E web message | "Svara" in Clew: a text box, then sent through the Open-E integrator as the owner, with the errand's `caseId` as `flowInstanceId` | Clew, on the person's confirmation | In Open-E at once; in Draken within five minutes, as an e-service message in |
| A message in a conversation | Later (katlor): the same "Svara" as Open-E, posted to the conversation with `X-Sent-By` | Clew | At once |
| None, or a channel above the errand cannot use | Nothing to answer with: the errand page says how the drake reached the person | — | — |

**A closed errand offers no answer** in any channel: the e-mail reader would send the person its "closed" answer, and
Open-E's thread may be closed. The page says the errand is closed and how to reach the drake for a new one.

**The subject is Clew's own, not a copy of the drake's.** The e-mail reader reads the number after the first `#`, so a
copied subject with a `#` of its own ("Faktura #4411") would make the answer a new errand. `SV: Ärende #<errandNumber>`
has exactly one `#`, matches what Draken writes, and keeps the person's mail program grouping it with the drake's mail.

The mail link is the e-mail answer because nothing else puts the mail in the person's own mailbox. A mail Clew sent in
their name would be missing from their Sent folder and their thread, and would ask the mail service to send as an
employee. The link has what a link cannot do, though:

- **No `In-Reply-To`.** A `mailto:` address cannot set headers, so the person's mail program and Draken group the
  answer by subject and errand, not as a reply to the drake's mail.
- **No quote.** A prefilled body is cut short by some mail programs, so the drake's message is not quoted; it is on the
  errand page beside the link.
- **The subject can be edited.** If the person removes the number, the e-mail reader makes a new errand of it. Clew
  cannot prevent that; the page asks them to leave it.
- **A mail program has to answer `mailto:`.** Outlook on the desktop does; Outlook on the web only where the browser
  hands `mailto:` to it.
- **Clew does not know it was sent.** The errand waits on the person until the e-mail reader has filed the mail, up to
  five minutes later, and a person who sees the card still there may send again. The page says so beside the link
  ("Har du redan svarat? Svaret syns här inom några minuter."), and the card's text does not suggest that nothing was
  sent.

### What Clew keeps, and what it must not leak

The card (ref, label, state, the person's own choices), as for any errand (D89 item 4). Message text is read live and
never kept, never offered to the model, never in a card's text. A mail answer never passes Clew. The text of an Open-E
answer would, because an execute's answers go into the approved intent and the audit row; phase 4 changes that before
the Open-E answer is used outside development.

What LÖP and IK write to a manager can be about the manager's employees (sick pay, a salary attachment). Clew does not
store it, but its server carries it, so:

- **No text in logs, traces or metrics** (D91): the connector's logger and Clew's spans carry the ref and the outcome,
  never a subject, a body or an address.
- **No copy in the browser's cache.** Clew already answers every protected route with `Cache-Control: no-store,
  private` (`protectedRoute` in `apps/server/src/context.ts`), the connector reads included; the connector answers its
  own reads the same way, and a test keeps both.

## Architecture

### A connector, the one there is

The work is the `sm` connector in `connectors/supportmanagement/`, extended: an integration is a connector, its own
container behind the connector protocol, registered by an administrator (D21, D22, D23). Nothing in `apps/` or
`packages/` learns SupportManagement's or Open-E's name; the only change in Clew's core is phase 4, which every
connector may use. The folder is already in `connectors/README.md`, `bun run dev:connectors` and
`tests/fixture-connectors.ts`, so no new folder or registration is added.

### Inside the connector: one port, two adapters, pure rules

The connector already has the shape D20 gives a module, in its own files: `server.mjs` reads the configuration and
chooses the source with `SM_ADAPTER` (`fixture` or `api`), `connector.mjs` speaks the protocol to whatever source it is
given, and the source is the port. The plan keeps that shape and widens the port:

| File | Is | Changes |
|---|---|---|
| `manifest.mjs` | What Clew is offered | `sm.requests` (profile `sm.requests`, D123), `sm.request` (`text`, `model: false`), `sm.reply` (execute), `sm.replyEffect` (effect read), `scan: true` |
| `connector.mjs` | The protocol: Clew's assertion, the delegated token, the capabilities, errors in Swedish | Wires the new capabilities to the port; calls the rules; no HTTP to SupportManagement or Open-E |
| `identity.mjs` (new, a copy of POB's) | Validates the delegated token and reads the AD account | New; a copy, since a connector imports nothing from another |
| `owner.mjs` (new) | The rules, pure: `owns`, `toOwner`, `channelOf`, the state, the mail link | New; no I/O, no clock of its own (time is passed in), as `domain.ts` in D20 |
| `errands.mjs` | The port's shape, the mapping `toSourceErrand`, and the fixture adapter | The port gains `ownedErrands(account, namespace)`, `errandWithMessages(account, ref)` and `postOwnerMessage(account, ref, text)`; the fixture gains owners, messages and what an owner must not see |
| `supportmanagement.mjs` | The `api` adapter for SupportManagement | **Changes model**, below |
| `opene.mjs` (new) | The `api` adapter for the Open-E integrator, behind `postOwnerMessage`; the fixture's counterpart is in `errands.mjs` | New |
| `config.mjs` (new, as POB's) | Reads and checks every setting, each error naming its variable | Moves the reading out of `server.mjs` |

The flow of a call is one way: `server.mjs` builds the adapters → `connector.mjs` validates and asks the port →
`owner.mjs` decides → `connector.mjs` answers. An adapter never decides access; the rules never call out.

### The `api` adapter changes model

Today `supportmanagement.mjs` sends the person's own token as the bearer and nothing else, never `X-Sent-By`, and waits
for SupportManagement to accept that token, decide access from it and add `GET /{municipalityId}/errands/mine` (the
README's "What SupportManagement has to provide"). None of that exists, and none of it is planned. The plan replaces it:

- the gateway's client credentials as the bearer, and `X-Sent-By: type=adAccount; <account>` with the account from
  `identity.mjs`, never from the request;
- the existing per-namespace reads (`…/{namespace}/errands` with a filter, `…/errands/{id}`, communications,
  conversations, metadata), so nothing new is asked of SupportManagement;
- the rule in `owner.mjs`, applied to every answer before it leaves the connector.

What the README says SupportManagement must provide becomes what the connector would hand back to it, under "Later":
when SupportManagement decides access itself, the adapter can return to the person's token. `sm.errands`' `assigned`
and `group` views, which rested on `errands/mine`, answer no rows in `api` mode until the handler rule is planned; the
fixture keeps them. The README's "What it never does" is rewritten: the connector sends `X-Sent-By`, holds a state for
two minutes, and still stores no message, token or answer.

### What stays with Clew's core

| Clew does | As it does for every connector |
|---|---|
| Joins `sm.requests` into `clew.requests`, "Mina beställningar" | D123, the registry |
| Draws `sm.request` as a `text` view with Astryx's `Markdown`, the mail link included | D100's closed catalogue; no component of the connector's |
| Turns the scan's drafts into cards in Att göra | As for POB |
| Runs `sm.reply` through the human decision endpoint and the execution ledger, the audit row in the same transaction, never as a model tool | D45, D47; `model: false` |
| Signs its assertion and exchanges the person's token for the connector's audience | D89's delegation, as for POB |

### The one core change, phase 4

`keep: false` on an ask follows D20's direction inside Clew: the field in the protocol (`packages/contracts`, and the
published `docs/protocol/connector-protocol.schema.json`), the approved intent and audit row written by the executions
use case, a case in the store contract run on both store adapters, a scenario test asserting the audit row, and its own
decision record. Nothing in it names SupportManagement.

### Where it departs, and the record for each

| Departure | Record |
|---|---|
| The connector holds the rule and calls with its own credential, against D89 items 1 and 2 (as POB does without a record) | The provisional decision record of phase 1, covering both |
| The connector's settings stay in its environment, as every connector's do; the namespace-to-group settings that handlers will need raise D125's open question | `docs/maintainers/open-questions.md`, the existing item |
| The README's demands on SupportManagement are withdrawn | The README itself, and the decision record of phase 1 |

## Phase 0 · Verify

To be answered before phase 1 is built against anything but the fixture. **Question 1 comes first**: without it there is
no list, and the plan stops.

| # | Question | Who |
|---|---|---|
| 1 | Which SupportManagement filter finds the errands whose `PRIMARY` stakeholder has a given `username` (`stakeholders.role` and `stakeholders.parameters`), and does it hold on a page of 100? If the filter cannot reach a stakeholder's parameters, is there another key (the party id in `externalId`) that it can? | SupportManagement's team |
| 2 | Is the owner always the `PRIMARY` stakeholder with `username` and an e-mail in `contactChannels` filled in, also on errands that came in by mail and from Open-E? Which drakar besides IK and LÖP send messages to owners this way? | The drakar's owner |
| 3 | Does the e-mail reader run for IK and LÖP, and which address does it read for each? Does the drake's mail come from that address, or from a no-reply address the person should not answer? | The drakar's owner, SupportManagement's team |
| 4 | Do the drakar mark their internal e-mails `internal`, or do some handlers mail colleagues on an errand without it? The filter in the design rests on the recipients either way, but the answer says how much rests on them alone. | The drakar's owner |
| 5 | Is `userId` in `AddMessageAsOwner` the AD account in the internal instance, and does Open-E refuse it when that person is not the flow instance's owner? How does the connector learn who owns a flow instance, since the e-service's messages are that person's and not the errand's `PRIMARY` stakeholder's? Without it, no e-service message is shown or answered. | Whoever runs Open-E |
| 6 | Do the e-services IK and LÖP receive through allow the owner to write messages, and are they in the web message collector's configuration (its `familyId`s)? | Whoever runs Open-E and the collector |
| 7 | A gateway application for Clew's connector with SupportManagement and the Open-E integrator; can it be limited to those, and to the integrator's `webmessages`? | Whoever runs the gateway |
| 8 | Which claim in a token from the identity provider carries the AD account, and is token exchange to the connector's audience available? | Whoever runs the identity provider |
| 9 | Is `notifyReporter` on for any of these namespaces? An owner's own answer must not trigger a notice to themself. | SupportManagement's team |

## Phase 1 · Identity and the owner rule

- **Identity, as POB's connector does it.** `identity.mjs` (a copy, not an import: a connector depends on nothing else
  in the repository): validate the token from `X-Clew-Delegated-Token`, read the account from the configured claim,
  require it to match the signed actor's `userName`. No token, no call.
- **Calling out.** A gateway client (`OAuth 2.0` client credentials) with a token cache; every SupportManagement call
  carries `X-Sent-By: type=adAccount; <account>`. The connector's `delegation` stays, since its token is the identity;
  it is no longer forwarded to SupportManagement. This is the `api` adapter's change of model (Architecture, above).
- **The rules** as pure functions in one file, `owns(errand, account)`, `toOwner(message, owner)` and
  `channelOf(errand, messages)`, used by every read and by the Open-E send.
- **Configuration** (environment, as for every connector today): `SM_NAMESPACES` (the namespaces asked, IK and LÖP
  first), `SM_REPLY_ADDRESSES` (namespace to the address its e-mail reader reads; a namespace without one gets no mail
  link), `SM_NAMESPACE_LINKS` (namespace to the address of an errand in the drake, where the person may follow it), the
  gateway's address and credential, the Open-E integrator's address, the identity provider's issuer, audience and
  account claim. Where an administrator sets this in Clew instead is an open question (below).
- **When SupportManagement starts deciding.** If a namespace switches `accessControl` on, its reads with the owner's
  `X-Sent-By` are answered by its labels, and an owner without `reporterAccess` gets `403` where they got the errand
  yesterday. The connector answers that as its own error naming the namespace ("Lön och pension svarar inte på din
  fråga just nu."), logs it as a refusal by the case system, and leaves the other namespaces' rows in the list.
- **A decision record, `provisional`:** SupportManagement and POB each get a connector that validates the person's token,
  calls with its own credential and applies its own rule, as an exception to D89 items 1 and 2 for a system that does
  not decide access itself. It says when the exception ends for a namespace: when its `accessControl` is on, the access
  mapper runs and owners have `reporterAccess`, the rule moves back to SupportManagement; until then a namespace
  switching it on is an operator's change to be made together with the connector's configuration. POB's departure,
  which has no record yet, is folded in.

## Phase 2 · The list of what I own

`sm.requests`, the requests profile of [D123](../decisions/D123-requests-are-a-profile-of-their-own-apart-from-the-errands-a-person-handles.md):
the errands the person owns, in every configured namespace, open ones and those closed in the last 30 days, under
"Mina beställningar" with every other desk's.

- One filtered read per namespace (phase 0, question 1), at most five pages of 100, each errand checked with `owns`.
- The row is D123's: `label` the number with the category and type ("LÖP-26110042 · Lön, Fråga"), `status`
  SupportManagement's display name, `since` the errand's creation, `link` where `SM_NAMESPACE_LINKS` has one.
- **The state**, seen from the owner: `waiting-on-me` when the drake's latest message kept by `toOwner` is newer than
  the owner's latest answer and the errand is open; `closed` by status; `new` and `active` by status as today. A mail
  answer counts once the e-mail reader has filed it.
- **What the state costs.** Telling `waiting-on-me` needs the errand's messages: its communications, its conversations
  and their messages, two or more calls an errand. The list is asked for by Hem, Att göra and the scan, so:
  - only open errands are read, at most 25 an answer (the newest first; any beyond take their state from the status);
  - at most four reads at a time to SupportManagement;
  - each errand's state is kept in the connector's memory for two minutes, by account and errand, the state alone and
    never a message;
  - a read that fails or runs past its time leaves that errand's state to the status rather than failing the list.
- `sm.errands` keeps `view: assigned` for handlers; its `view: reported` answers no rows, as POB's does, since what a
  person sent in is a request now.

## Phase 3 · The errand, its messages and the mail link

`sm.request`, one errand as its own page, never a tool:

- The errand's number, type, status, namespace and title, and the messages `toOwner` keeps, in time order. For each:
  when, from whom (the drake's name for the handler, "Du" for the owner), the channel in Swedish, and the text as plain
  text (an HTML mail through its plain part, quoted history cut where the mail marks it). Attachments are named under
  their message, not opened.
- Drawn with the views Clew has (D100's closed catalogue): a `text` view whose Markdown the connector writes, every
  piece of message text escaped. If that reads badly in the browser, a `list` of messages under the errand is the
  alternative to try; no new view kind.
- `model: false`, as `sm.errand` today: the assistant is never offered the read and never sees a message.
- **No cache:** the connector answers the read with `Cache-Control: no-store`, as Clew's protected routes already do.
- **The mail link**, when `channelOf` says e-mail and the errand is open: a Markdown link at the end of the thread,
  `[Svara via e-post till Lön och pension](mailto:…?subject=…)`, the address and subject percent-encoded by the
  connector. Astryx's `Markdown` keeps a `mailto:` destination (it blocks only `javascript:`, `vbscript:` and `data:`),
  so this needs no change in Clew. Under it: "Svaret skickas från din egen e-post och syns här inom några minuter. Ändra
  inte ärendenumret i ämnesraden."
- When `channelOf` says Open-E, the line says the answer is written here and sent through the e-service, and points to
  "Svara" (phase 5). On a closed errand, the line says it is closed. When there is no channel, it says how the drake
  reached the person.

## Phase 4 · An answer Clew does not keep

Today an execute's answers are part of the approved intent and stand in the `execution.approved` audit row as given
(`docs/reference/status/protocol.md`). A message to a drake can hold anything about anyone, and Clew should not keep it.
Only the Open-E answer (and later the conversation answer) passes Clew; the mail answer does not.

- **Proposed:** an ask may be marked `keep: false` (name to be settled). Its answer is held in the approved intent only
  until the execution settles, then removed; the audit row records the ask's property, the answer's length and a digest,
  never the text. The dialog, the dry run and the loader treat it as any `long-text` otherwise.
- A scenario test asserts the audit row without the text and the intent emptied after settling, on both store adapters.
- This is a core change with its own decision, and the reason the Open-E answer is not used outside development before
  it lands.

## Phase 5 · The card and the Open-E answer

- **A scan** (`scan: true`): one card for every owned, open errand in `waiting-on-me`, "<namespace> väntar på ditt
  svar", with the row's label and status, never the title or a message. Buttons: "Visa" (`sm.request`, beside the
  card), and, when `channelOf` says Open-E, "Svara". A mail errand's card has "Visa" only; the mail link is on the page
  it opens. The scan runs with the person's token while their session asks, as POB's does; when the errand no longer
  waits, a complete scan resolves the card.
- **`sm.reply`**, an execute, `model: false`, `execution: { strategy: 'manual' }`, `asks: [{ kind: 'long-text', property:
  'text', label: 'Ditt svar', required: true, keep: false }]`, at most 4 000 characters. It answers Open-E only (and
  conversations once katlor is here); an errand whose channel is e-mail is refused with "Svara via e-postlänken på
  ärendet."
- **`sm.replyEffect`**, its effect read: the drake's latest message and that the answer goes to the e-service, so "Det
  här händer" shows what is being answered and where it lands.
- **At dispatch:** read the errand again, `owns` again, `channelOf` again (if the drake has mailed since, refuse and say
  so), a closed errand is refused ("Ärendet är avslutat."), post to the integrator once (the ledger's operation id;
  nothing is retried on an unknown outcome, since a second message cannot be taken back), log.
- **The receipt** says the answer is in the e-service and shows for the handler within a few minutes. No Ångra: a sent
  message cannot be undone.
- The assistant never sends. It may help draft only once that is decided; not in this plan.

## Phase 6 · Tests, documentation and the try-out

- **The fixture** (`errands.mjs`'s made-up SupportManagement) gains IK and LÖP errands with `PRIMARY` owners, mails and
  Open-E messages in and out and a conversation, and, on the same errands, what the owner must not see: an `internal`
  mail, a mail to the employee concerned, a handover mail, an `INTERNAL` conversation and one shared through a relation.
  A made-up Open-E integrator endpoint records what was posted and files it back on the errand as the collector would.
  A fixture-only route lets a handler write, and another files a mail as the e-mail reader would, so the card can be
  seen to come and go for both channels.
- **Unit tests** (`tests/unit/supportmanagement-connector.test.ts`):
  - the rule (owner, not owner, case, a missing `username`) and the token checks;
  - `toOwner` for every row of its table, and that a hidden message neither shows, nor makes the errand wait, nor
    decides the channel, nor lends its attachments;
  - the state, its cap of 25, its two-minute memory, and a failed read falling back to the status;
  - the channel choice for each case, and no answer on a closed errand;
  - the mail link: the address, the subject `SV: Ärende #<errandNumber>` with one `#` whatever the drake's subject held,
    percent-encoded, no link without a reply address;
  - Open-E's `flowInstanceId` and `userId`, a refused answer when the drake has mailed since, nothing sent twice;
  - a `403` from a namespace becoming its own error with the other namespaces' rows kept;
  - the access log and the connector's own log without text, and `no-store` on the request read.
- **Scenario tests** for phase 4 in the server, asserting the audit row.
- **Browser specs**, last (`tests/a11y`): the request page (thread, the mail link's name, keyboard, 320 px), the card
  and the answer dialog (focus, the refusal placed on its field, the receipt announced). A manual screen-reader pass is
  still owed.
- **Documentation:** the connector's README (what it processes and for how long, what it never shows an owner, what an
  installation sets up, phase 0's answers), `docs/reference/status/connectors.md`, the decision records,
  `docs/maintainers/open-questions.md`.
- **Try-out on the development stack** before anything is committed: the connector registered by
  `bun run dev:connectors`, a manager's LÖP errand waiting on a mail and an IK errand waiting on an Open-E message, the
  hidden messages absent from both, the mail link opening a mail program with the right subject, the Open-E answer, and
  the fixture's handler seeing both.

## Not covered

- **Messages to me on errands I do not own**, such as a copy to a colleague. SupportManagement has no question for
  "messages to me" across errands, and the rule would need another relation.
- **Handlers.** The minidrake handler who answers KC, and everyone in a förvaltning seeing its drake's errands, need the
  group rule from the same conversation (namespace and AD group, set by an administrator). They come after this, on the
  same identity and rule machinery.
- **Attachments**, sent or opened. A mail answer can carry them from the person's own mail program.
- **Search by errand number.**

## Later, and asked of other teams

- **SupportManagement:** the access mapper in production with `reporterAccess` for owners, which ends this plan's
  exception namespace by namespace; and what the connector's README asked before this plan (the person's own token,
  access decided from it, `errands/mine`), which would let the `api` adapter return to the person's token.
- **Draken:** a "Startsidan" contact means that starts a conversation with the owner, for when katlor has replaced Open-E.
- **katlor:** which conversation is the owner's and how the owner is identified in it (`adAccount` or `partyId`), so that
  Clew writes in the same thread. When the drakar write there, `channelOf` sends the answer there, and the mail link and
  the Open-E path are used less.

## Questions this leaves, and who they wait for

| Question | Waits for |
|---|---|
| Phase 0's nine questions, the first before anything else | As listed there |
| Is the connector holding the rule for SupportManagement and POB accepted, until the access mapper runs? | Product owner |
| Is `toOwner`'s table the right line between what an owner sees and what stays with the drake? | The drakar's owner, product owner |
| May an Open-E answer's text be dropped from the audit as phase 4 proposes? | Product owner |
| Where an administrator sets the namespaces, reply addresses and, later, the groups: Clew's page (D125's open question on connector settings) or the connector's own deployment | Product owner |
| Which drakar come after IK and LÖP? | The drakar's owner |
