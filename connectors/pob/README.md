# pob: what a person handles and what they reported in POB, as a Clew connector

A connector for POB, Wendia's service desk system. POB is both a case system and a service desk, so it answers two
profiles, and nothing relates the two lists:

- **The errand profile** ([D35](../../docs/decisions/D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md),
  [D89](../../docs/decisions/D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)): the
  errands a handler has, assigned to them or waiting in their group's queue, listed under "Mina ärenden" together with
  those of every other case system connected to Clew.
- **The requests profile** ([D123](../../docs/decisions/D123-requests-are-a-profile-of-their-own-apart-from-the-errands-a-person-handles.md)):
  what a person reported or ordered and waits for, listed under "Mina beställningar" together with those of every other
  service desk.

A request that waits for the person's own answer becomes a card. When the installation switches it on, the assistant
can prepare a fault report that the person sends. Its id is `pob`.

**It has not met a POB.** In development it runs on made-up data (`POB_ADAPTER=fixture`). The adapter for POB's own API (`pob.mjs`) is a draft
written from an endpoint catalogue that names no field and from public code that calls one installation's POB; what it
assumes is listed under [The API adapter's assumptions](#the-api-adapters-assumptions). Everything around it is built
and tested: the identity check, the rule for which errands are a person's, the row, the access log and the
configuration. The [plan](../../docs/reviews/2026-11-13-a-pob-connector-and-errands-from-two-case-systems.md) has the
phases and the reasons.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: the reads of the two profiles, their views, the rows and the ref patterns |
| `connector.mjs` | The reads, the row and its state, the order of the identity checks, the person lookup, the access log and HTTP error handling |
| `identity.mjs` | Validation of the person's token against the identity provider's keys |
| `cases.mjs` | The case port, the rule for which errands are a person's, memo text, and a made-up POB |
| `pob.mjs` | POB's API behind the port, a draft: the only file that knows the address, the credential, the paths and the field names |
| `config.mjs` | Reads and checks the configuration |
| `verification.mjs` | The check of Clew's assertion |
| `http.mjs` | The HTTP listener: reads a request within a size limit and answers whatever it holds, so nothing sent to the port ends the process |
| `server.mjs` | Reads the configuration and serves the connector with that listener |

## Why this connector holds a credential, and what stands in its place

D89 says an errand connector forwards the person's own token and the case system decides access. POB cannot do that:
its API takes one account's user name and password (HTTP Basic), and an installation cannot change a vendor's product.
So here the connector is the trust boundary, and who the person is still never rests on Clew's word:

1. Clew trades the person's session for an identity provider token for this connector's audience and sends it in
   `X-Clew-Delegated-Token`, as for any connector that declares `delegation`.
2. The connector validates that token itself: the signature against the provider's keys, the issuer, the audience, the
   expiry.
3. The account in the token must be the person Clew signed its assertion for.
4. The connector finds that person's records in POB and asks POB with its own account, narrowed to them.
5. Every errand that comes back is checked against the person again before any of it is answered.

Without a valid token no call is made to POB. This departs from D89 items 1 and 2 and needs a numbered record when the
connector lands; the plan has the proposed wording.

**The rule for which errands are a person's** is three lines in `cases.mjs` (`holds`), and it is deliberately smaller
than POB's own permissions:

| Relation | An errand is the person's when |
|---|---|
| `assigned` | they are its handler |
| `group` | it has no handler and belongs to a group they are a member of |
| `reported` | they reported it |

It can show fewer errands than POB would. It must never show more. A colleague's errand, a manager's view of a unit or
free search would each mean rebuilding a part of POB's permissions here, and each is a decision of its own.

**Exactly one record.** A person is matched to their handler record and their customer record in POB by their directory
account. Two records for one account count as none, and the person is told that their details in the system are not
unambiguous. A field that is not unique in POB can therefore never give one person another's errands.

## What a person gets

| Capability | Shown as | Notes |
|---|---|---|
| `pob.errands` "Ärenden i IT-supporten" | A list: errand number and type, status, who it waits on, group, last changed | What the person **handles**: assigned to them, and their group's unassigned queue. What waits on the person first, then the oldest. Closed errands are not listed |
| `pob.errand` "Ärende" | One errand: the row's fields plus the title, the reporter's own description and a link out | Read live, for its handler only. Never offered to the model |
| `pob.requests` "Mina felanmälningar i IT-supporten" | A list: number and type, status, when it was reported | What the person **reported**: everything open, and what was closed in the last thirty days |
| `pob.request` "Felanmälan eller beställning" | One request: the row's fields plus the handling group, the title, the person's own description and a link out | Read live, for the one who reported it only. Never offered to the model |

The names are the two profiles'. Clew asks every connector's `<id>.errands` at the same time and shows the answers as
one list, `clew.errands` "Mina ärenden", and every `<id>.requests` as another, `clew.requests` "Mina beställningar"; a
row opens this connector's `pob.errand` or `pob.request`. Those lists own the areas, the menu rows and the model's
tools, so this connector declares none of them.

**The same errand is an errand for its handler and a request for its reporter**, under two refs, and each opens it in
their own role only. The errand profile has a `view`, which Clew's list says to every case system: `assigned` is the
default here, and `reported` answers no rows, since what a person reported in POB is a request.

The errand row:

| Field | Content |
|---|---|
| `ref` | `errand:pob:<case id>`. One POB per installation is assumed. Clew treats it as opaque |
| `label` | The errand number and the type and category display names: `IT-48211 · Incident, Dator`. Never the title, a name or an account |
| `state` | The shared state: `new`, `active`, `waiting-on-me`, `waiting-on-others` or `closed` |
| `status` | POB's own display name for the status |
| `waitingOn` | `Dig`, `Din grupp`, `Anmälaren` or `Parkerat till 12 nov.`, where the errand says so |
| `since` | When the errand last changed |
| `area` | The handling group's display name. A label only |
| `link` | The errand in POB's own interface, where `POB_CASE_LINK` is set |

`dueAt` is not set: SupportManagement has no deadline, and one system with a deadline would stand before the other in
every state of the combined list. The plan leaves that to the product owner.

The request row is the protocol's `RequestRow` and nothing besides:

| Field | Content |
|---|---|
| `ref` | `request:pob:<case id>` |
| `label` | The same as the errand's: number, type and category |
| `state` | Seen from the person who waits: `waiting-on-me` when the desk waits for their answer, `new` until someone has started, `active` otherwise (a parked errand and one that waits for a supplier included), `closed` |
| `status` | POB's own display name for the status |
| `since` | When it was reported; a POB that does not say (`created` in `POB_FIELDS` empty) gives when it last changed |
| `link` | The errand in POB's own interface, where `POB_CASE_LINK` is set |

`expectedAt` is not set: no field for a promised time has been seen in POB.

**The description is the reporter's own text and nothing else.** One memo type (`POB_PROBLEM_MEMO`) is asked for; an
internal note is never read, for a reporter or for a handler. Text stored as HTML is answered as plain text.

**Only the case types in `POB_CASE_TYPES`.** A POB can hold several service desks, some of them sensitive. An errand of
another type is not listed and not found by its id, also when it is the person's own.

## A card when a request waits on the person

The connector's scan answers one card for every request that waits for the person's own answer: "IT-supporten väntar
på ditt svar", with the number and type and a button that shows the request. A handler's assigned errands are their
work in POB and get no cards. The scan is a read like the list: it runs with the person's token when their session
asks for it, never at night, and checks every errand against the person. When the request no longer waits on them it
is not among the drafts, and a complete scan resolves its card. The card is filed under Clew's own area
"Beställningar och felanmälningar" (`requests`), so a person has one area for what they reported whatever the number
of service desks. The fault report's draft is filed there too.

The person cannot answer from Clew: how a reporter's answer reaches the service desk is not known (the plan, phase 4).

## Reporting a fault (`POB_WRITES=create`)

The assistant prepares, the person sends. Three capabilities are added to the manifest:

| Capability | Kind | What it does |
|---|---|---|
| `pob.reportFault` "Felanmäl dator" | propose, `model: true` | Writes nothing. Answers a work item with one button, "Skicka felanmälan". The assistant calls it with what the person has said; Clew shows that as a draft of the button's answers, which the person can change |
| `pob.createCase` "Skicka felanmälan" | execute, never a tool | Creates the errand. Asks: what is wrong, where the computer is, its name, whether it is the person's own or someone else's, and in that case whose |
| `pob.createEffect` | read, never a tool | What will be created, for exactly that input: "Det här händer" |

- **The reporter is the person behind the token**: their one customer record in POB. It is not an input, and nothing
  in the input can change it. A person with no customer record, or with two, is told so and nothing is prepared or sent.
- **A fault reported for someone else** names them in the errand's text; the reporter is still the person who sent it.
- **The title** is the first sentence of the description. Place and computer name are lines in the description.
- **Type, category and group** come from `POB_CREATE`, not from the person.
- **Never repeated.** The execute is `manual`: Clew does not send it again by itself. The made-up POB keeps the
  operation id, so the same decision sent twice is one errand; whether a real POB can is not known.
- **One process.** The verifier takes each of Clew's assertions once, but it remembers them in its own process only:
  run as several replicas, or restarted, the connector would take a captured request once more in each process within
  the assertion's two minutes, and a fault report would be created again. With `POB_WRITES=create`, run a single
  process, or share the record of taken `jti`s between the processes in storage that outlives a restart
  ([authorization](../../docs/guides/authorization.md)).
- With `POB_URGENT_NOTE` the work item says what to do when a fault cannot wait.

It works on the made-up POB only. The API adapter reads and has no `create`: how POB creates an errand has been seen
in public code alone, and `PUT` there creates on every call.

## What a unit's agreements cost (`POB_COST_IDENTIFIER`)

Switched on by naming the identifier, the connector answers one more read: `pob.unitCosts` "IT-kostnader", a read about
a unit ([D148](../../docs/decisions/D148-a-unit-carries-the-identifiers-other-systems-know-it-by.md)). Clew places it as a section on the unit's page for the person who leads the unit, and asks nobody
else's connector session for it. A row is a count of the service agreements booked on the unit and, where an amount
can be read, their sum. Never an agreement's text, and never a person.

**How a unit becomes a question to POB.** POB does not know Clew's units. The service desk books an agreement on an
account, a whole accounting string, and the account begins with the code of the unit that pays. The directory holds
that code and pushes it with the unit as one of the unit's identifiers; `POB_COST_IDENTIFIER` is the directory's word
for it (`ansvar` in one municipality, something else in the next). Clew sends the identifiers of that type, and no
other, in the request body beside how the person stands to the unit.

| Step | What stands between a person and another unit's costs |
|---|---|
| The person | Their own token, checked as for every read. Their records in POB are not looked up: a person POB does not know still leads their unit |
| The unit | Clew's word on how the person stands to it, read from the body the assertion binds. Only `manages` is answered. Clew sends no other relation, and the connector does not rest on that |
| The code | The directory's, from the same body. A unit without an identifier of the configured type is no row. Nothing is worked out from the unit's id or its name |
| What a code is | Letters and digits, at least four and at most thirty-two. `POB_COST_CODE_PATTERN` narrows that (`^[0-9]{8}$` for eight digits) and cannot widen it: the bound holds in the connector and again in the adapter, and a pattern that takes a shorter code stops the connector at start. Anything else is not sent to POB: a one-character prefix would read as nearly every account |
| The answer | Every agreement that comes back is compared with the code again, so a filter POB ignored or matched loosely adds nothing |

A unit with several codes is the sum of them, each agreement counted once. An agreement without an amount is counted
and the row says that it is not in the sum. An answer that was cut would look like a whole sum, so then the system has
no answer; raise `POB_LIST_LIMIT` for a unit with more agreements than that.

**This is a decision of its own.** Every other read here shows a person their own errands. This one shows a person
something about a unit, on Clew's word that they lead it: POB has no record of who may see a unit's agreements, and the
connector's account can read them all. "Leads the unit" is membership of the unit's managers' group in the directory,
which is the directory's statement of who answers for the unit, not of who people report to (D147).

## How a status becomes a state

Statuses are an installation's own, so the meaning of each is `POB_STATUS_KINDS`.

| Kind | State for the handler | State for the reporter |
|---|---|---|
| `new` | `waiting-on-me` when assigned to the person, `new` in the group's queue | `waiting-on-others` |
| `open` | `waiting-on-me` when assigned to the person, `active` in the group's queue | `waiting-on-others` |
| `waiting-reporter` | `waiting-on-others` | `waiting-on-me` |
| `waiting-other` | `waiting-on-others` | `waiting-on-others` |
| `closed` | `closed` | `closed` |

An errand suspended until a time in the future is `waiting-on-others` whatever its status (the made-up POB has such
errands; the API adapter does not read suspensions yet). A status with no entry counts as `open`.

## The access log

POB's own log shows the connector's account for every read, so the connector says who looked. One JSON line on
standard output per list and per opened errand or request:

```json
{"at":"2026-11-16T09:00:00.000Z","connector":"pob","event":"requests","account":"hillevi","outcome":"shown","rows":3}
{"at":"2026-11-16T09:00:02.000Z","connector":"pob","event":"list","account":"mikael","view":"assigned","outcome":"shown","rows":3}
{"at":"2026-11-16T09:00:04.000Z","connector":"pob","event":"open-request","account":"hassan","case":"48211","outcome":"not-found"}
```

`event` is `requests` and `open-request` for what a person reported, `list` and `open` for what a person handles, and
`unit-costs` for the cost read, with how many units were asked about (`asked`) and how many were answered (`rows`),
never which and never a code.

`outcome` is `shown`, `not-found` or `ambiguous`; a scan and a created errand have lines of their own (`event: scan`,
`event: create`, with the new errand's id). Never a title, a description or a name from POB, and nothing of what a
person wrote. How long the lines
are kept is the operator's; they are personal data.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks`. Required; HTTPS outside the local development allowlist |
| `PORT` | Default 4055 |
| `POB_ADAPTER` | `api`, the draft adapter for POB's own API, or `fixture`, the made-up POB, for development and tests only. Required: without it the connector does not start, and `fixture` beside a POB address or credential is refused |
| `POB_IDP_ISSUER` | The identity provider the person's token must come from. Required, with the fixture too |
| `POB_IDP_JWKS_URL` | Where that provider's keys are. Required. HTTPS, unless its host is in `POB_INSECURE_HTTP_HOSTS` |
| `POB_INSECURE_HTTP_HOSTS` | Hosts the keys may be fetched from over plain HTTP, for development. Default `localhost,127.0.0.1` |
| `POB_AUDIENCE` | The audience the person's token is issued for. Default `pob`. It is part of the manifest, so refresh the manifest in Clew after changing it |
| `POB_ACCOUNT_CLAIM` | The claim that carries the directory account. Default `preferred_username` |
| `POB_SOURCE_LABEL` | The system's name as a person reads it. Default `IT-supporten`. It must differ from every other case system's: Clew's list names the systems that did not answer |
| `POB_STATUS_KINDS` | JSON object, POB status to `new`, `open`, `waiting-reporter`, `waiting-other` or `closed`. Required with `api` |
| `POB_CASE_TYPES` | JSON array of the case types the connector reads. Required with `api` |
| `POB_PROBLEM_MEMO` | The memo type that holds the reporter's own description. Default `Problem` |
| `POB_CASE_LINK` | The address of one errand in POB's interface, with `{id}` or `{number}` in it |
| `POB_WRITES` | What is switched on beyond reading: empty, or `create` for the fault report. Must be empty with `POB_ADAPTER=api` |
| `POB_CREATE` | JSON object: the `caseType`, `category` and `groupId` a reported fault gets |
| `POB_URGENT_NOTE` | A sentence shown on the fault report for faults that cannot wait, such as a number to call |
| `POB_COST_IDENTIFIER` | Switches on the cost read: the type of unit identifier, as the directory sends it, that holds the code a unit's costs are booked on. No default |
| `POB_COST_CODE_PATTERN` | What a code is: a pattern for a whole code of letters and digits, within the default `^[A-Za-z0-9]{4,32}$`. It narrows the default and never replaces it; one that takes a code of fewer than four characters is refused at start |
| `POB_COST_AMOUNT_LABEL` | What the sum is called on the unit's page. Default `Avtalskostnad`. Only where there is an amount to sum |
| `POB_AGREEMENT_PATH` | With `POB_ADAPTER=api`: where POB lists its service agreements. Default `/sla` |
| `POB_AGREEMENT_FIELDS` | With `POB_ADAPTER=api`: a JSON object naming an agreement's `id`, `account` and `amount`. Defaults `Id`, `Account.Id` and none: without an `amount` the read answers a count |

With `POB_ADAPTER=api`:

| Variable | Meaning |
|---|---|
| `POB_URL` | POB's API base, with the installation's own path prefix. Required. HTTPS, unless its host is in `POB_INSECURE_HTTP_HOSTS` |
| `POB_USER`, and `POB_PASSWORD` or `POB_PASSWORD_FILE` | The account the connector reads POB with, sent as HTTP Basic. Read-only, with the narrowest role POB has |
| `POB_AUTHORIZATION` | Instead of the two above: the whole value of the `Authorization` header, for a POB that takes a ready key |
| `POB_USER_MATCH` | The field of a POB user that holds the directory account. Required: there is no safe default |
| `POB_CUSTOMER_MATCH` | The field of a POB customer that holds the directory account. Required |
| `POB_FIELDS` | JSON object: what this POB calls a field, where it differs from the table below. Names only |
| `POB_STATUS_LABELS` | JSON object, POB status to what a person reads, where POB's own value is not a display name |
| `POB_TIMEZONE` | The zone POB writes times in, when it writes them without one. Default `Europe/Stockholm` |
| `POB_LIST_LIMIT` | The most errands one question may answer with. Default 500. More is an answer that was cut, and the system then has no answer |
| `POB_START_CHECK` | `warn` (default), `strict` or `off`: what happens at start when POB does not have a configured field |

The credential is read from the environment or a mounted file, is sent to POB and nowhere else, and is in no log line
and no error. None of the settings widens access: the rule is in the code and has no switch.

### What a field is called

Installations set POB up differently, so the connector keeps one table of what it needs and what each is called. The
defaults are the names the public code uses, where it uses one; `POB_FIELDS` replaces a name for an installation whose
POB differs. It is a table of names: no expressions, no templates.

| Concept | Default | Evidence for the default |
|---|---|---|
| `id` | `Id` | Public code |
| `number` | `Id` | None: no field for a separate number has been seen |
| `title` | `Description` | Public code |
| `status` | `CaseStatus` | Public code |
| `caseType` | `CaseType` | Public code |
| `category` | `CaseCategory` | Public code |
| `handler` | `Responsible` | Public code |
| `group` | `ResponsibleGroup` | Public code |
| `customer` | `Contact.Customer` | Public code |
| `changed` | `Modified` | None. An errand without it cannot be read, and the system then has no answer |
| `created` | `Created` | None. When the errand was reported, for a request's `since`. Empty means a request says when it last changed; set and missing on an errand, the errand cannot be read |
| `closed` | empty | Empty means an errand is closed by its status alone |
| `userGroups` | empty | The field of a user that lists their groups. Empty means a handler has no group queue |

**The instance describes itself.** At start the adapter asks POB for its description of an errand (`GET /entity/case`)
and looks for every configured name in it. With `POB_START_CHECK=strict` a name that is not found stops the start, with
an error that says which; with `warn` it is logged. `warn` is the default only because the check itself is unproven: the
shape of POB's answer is not known, so it looks at every key and string in it.

## The API adapter's assumptions

`pob.mjs` is a draft. It has been run against answers written for its tests and against nothing else. It assumes:

| Assumed | From | If it is wrong |
|---|---|---|
| An errand is `{ Type, Links, Data, Memo }` and its fields are in `Data` | Public code | No errand can be read: the system has no answer |
| A reference is `{ Type, Data: { Id } }` when read, with a display name in `Data.Description` or `Data.Name` | Public code for the id; the name is a guess | Types, categories and groups show their ids instead of names |
| A list endpoint answers a JSON array | Public code | The system has no answer |
| A filter is `Filter=<field>=<value>` and matches exactly | Public code, on other lists than errands | Fewer rows or none: every record and every errand is compared again in the connector |
| `limit=<n>` caps the rows, and POB has no lower cap of its own | Public code uses `limit=10000` | A list cut by POB below `POB_LIST_LIMIT` would look whole. **The one assumption that can give a short list unnoticed** |
| A user's and a customer's record are at `/user` and `/customer`, with the account in the configured field | The catalogue for the paths | Nobody is found: empty lists |
| A memo is at `/case/{id}/memo?type=<type>&scope=all` and answers `{ Memo: { <type>: { Memo, Extension } } }` | Public code for the address; the answer's shape is a guess | An errand opens without its description |
| `/entity/case` names every field of an errand | The catalogue says it gives field definitions | The start check reports fields as missing that are there |
| Service agreements are listed at `/sla` like errands, and an agreement's account is in `Account.Id` | One installation's own reading of its POB, 2026-11-27, told and not seen here | No agreement can be read: the system has no answer |
| An account is an accounting string that begins with the unit's code, and a filter value ending in `%` matches by prefix | The same | Fewer agreements or none; never another unit's, since each is compared with the code again |
| Which field of an agreement holds an amount, and for which period | Nothing | No sum is shown until `POB_AGREEMENT_FIELDS` names it; what the sum covers is then the installation's to say in `POB_COST_AMOUNT_LABEL` |

What keeps a wrong assumption from becoming someone else's errand:

- **One condition per question.** POB is asked for the errands of one handler, one group or one customer, and nothing
  else is put in the filter. Open or closed, the case type and "no handler" are decided by the connector's own check of
  each errand, which runs whatever POB answers.
- **A record is compared again.** A user or customer that came back for an account is kept only if its account field is
  that account, so a filter POB ignored or matched loosely cannot make one person another.
- **What cannot be read is an outage.** An answer that is not a list, or an errand without an id, a status, a case type
  or a time, makes the system unavailable. It is never skipped, since a skipped errand is a list that looks whole.
- **Only `GET`.** In POB `PUT` creates and `POST` updates; the adapter sends neither.

It also waits before trying again when POB refuses the credential (thirty seconds, doubling to ten minutes), so a wrong
password does not become a locked account; sends at most four calls at a time; and gives each three seconds.

One consequence of one condition per question: POB answers with a person's closed errands too, and the connector drops
them. A person or a group with more than `POB_LIST_LIMIT` errands over the years gets no list until the question can
say "open only", which needs to be known how two conditions are written.

## The made-up POB

`cases.mjs` holds it: eight errands, three handling groups, and people under the accounts of the development realm.

| Account | In POB | Sees |
|---|---|---|
| `hillevi` | A customer | Requests: one that waits for her answer, one in progress and one solved twelve days ago. Her HR errand is not listed. No errands to handle |
| `hassan` | A customer | Requests: one new and one that waits for a supplier |
| `mikael` | A handler in Servicedesk, and a customer | Errands: one of his own, one parked, and one in his group's queue. Requests: one |
| `ingrid` | No record | Nothing, and POB is asked for nothing |
| `karin` | Two customer records | Told that her details are not unambiguous (the account exists only in the tests) |

## Run and check

With the local Clew stack running, inside the devcontainer:

```sh
docker exec -w /workspace clew-app-1 bun scripts/auth-setup.ts
docker exec -d -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 \
  -e POB_ADAPTER=fixture \
  -e POB_IDP_ISSUER=http://keycloak.orb.local:8090/realms/clew \
  -e POB_IDP_JWKS_URL=http://keycloak.orb.local:8090/realms/clew/protocol/openid-connect/certs \
  -e POB_INSECURE_HTTP_HOSTS=keycloak.orb.local \
  clew-app-1 sh -c 'node connectors/pob/server.mjs > /tmp/pob.log 2>&1'
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4055 --id pob --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts pob http://127.0.0.1:4055 --secret local-docs-only-transport-key --enable
```

`auth-setup.ts` creates the Keycloak client `pob` and the scope `pob-audience` that the token exchange needs; without
them Clew has no token to send, and the list names IT-supporten among the systems that did not answer. The checker has
no session, so it expects the reads to be denied. The key above is for local development only.

Tests: `bun test tests/unit/pob-connector.test.ts` (the identity check, the rule, the row, the log, the configuration,
and the API adapter against answers in the shape it assumes) and `tests/unit/errands.test.ts` (this connector and `sm` in one list, each with the token for its own audience).

## What it never does

Without `POB_WRITES` it does not write to POB; with it, it creates an errand only on the person's own decision. It
does not store an errand or a token, read a memo type other than the reporter's own, list an errand
the person has no relation to, call POB without a token the identity provider signed for the person, log a title, a
description or a name, or pass on POB's error text. What it keeps in memory is the identity provider's keys for five
minutes and, per account, the ids of the person's records and groups in POB for five minutes: a person taken out of a
group in POB sees that group's queue for at most that long.

## Unverified

Nothing here has met a POB. The made-up POB answers the port in the shape the connector asks for, not in a shape POB
was seen to answer in, and the API adapter's tests run against answers written for them. Before the adapter is trusted,
beyond the table of its assumptions:

- Which field of a POB user, account and customer holds the directory account, in which form, and whether it is
  unique. Without that there is no match from a person to their records, and no list.
- Which fields of an errand carry the handler, the group, the reporter, the status, the last change and whether it is
  closed; how `GET /case` filters and pages, and whether an answer says that it was cut.
- Which memo types exist and which is the reporter's own text.
- The status values and what each means; the stable identity of an errand; whether times carry a zone.
- For the cost read: where POB lists its service agreements and how the list is filtered and capped; which field holds
  the account and which an amount, and whether the amount is per month, per year or once; whether every agreement that
  costs something is such a record at all. In a sample one installation read, about half of the agreements were
  booked on an account that begins with no unit's code, which is unexplained.
- Whether the identity provider can exchange a token for this audience, and which claim carries the account.

Not built: a question to POB with more than one condition, suspensions and display names for statuses in the API
adapter, a start check of POB's status values, creating an errand through the API adapter, attachments, and replying
in an errand. The view has not been through a screen reader; the connector adds no
route or component of its own, Clew draws the declared views.

Node's official image is MIT. The connector has no other dependency.
