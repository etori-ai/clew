# Review: the connector services (2026-11-23)

Area 10 of the review of the whole repository, wave 2. It covers the eighteen services under `connectors/`, with
`connectors/README.md`, each folder's README, manifest, compose file and Dockerfile, the development scripts that
register and reset them (`scripts/dev-connectors.ts`, `fixture-development.ts`, `fixture-maintenance.ts`,
`fixtures-reset.sh`, `moodle.sh`), `tests/fixture-connectors.ts`, and the unit tests that run the connectors in process.
The reviewed commit is `origin/main` at `9fd4c962`. How Clew's core meets a connector (registry, signing, transport,
administration) is the connector boundary review of wave 1, `2026-11-23-review-connector-boundary-in-the-core.md`. This
review does not repeat its findings, the baseline's (images that do not start, base images pinned by tag, a test in
`apps/web` that imports `connectors/hr`, no licence), or what `docs/maintainers/open-questions.md` lists as undecided
(`hr.whoIsOn` handing the names of the absent to the model is one).

Method: every source file of the eighteen connectors was read. That covers the real-system connectors first, then the
examples and `reference`, then the fixtures. Each finding below was established by running it:

- Two temporary unit files in this worktree, run one at a time in the devcontainer with `bun test tests/unit/<file>`
  and deleted before the commit. They used the connectors' own handlers, `remoteConnector`, the test authority and
  `tests/registry.ts`, as the unit suites do.
- Two processes of my own, both stopped and removed:
  - a `node:26.13.0-bookworm-slim` container `clew-review10-hello`, with `connectors/hello` mounted read-only and
    published on 127.0.0.1:47010;
  - a `node connectors/nextcloud-approval/server.mjs` process on port 47052 inside the app container.
- No shared container, database or dev server was touched. Nothing was pushed.

## Summary

There are two medium findings and eight low ones. No finding is critical or high.

The verifier that all eighteen connectors carry is sound, and identical in every copy. So is the way the real-system
connectors act as the person. The serious problems are around it:

- **M1. Eight services exit on one unauthenticated request.** These are `hello`, `intranet`, `phonebook`, `eneo`,
  `appraisals`, `qlik`, `moodle` and `nextcloud-approval`. Their HTTP wrapper turns a malformed request into an
  unhandled rejection, which ends the process. No transport key is needed. The wrapper also reads any body whole.
  Nothing restarts the services.
- **M2. Five undo writes and one write act on records outside the caller's unit.** They are in the HR, finance and
  time fixtures. Clew's decision endpoint takes them from any manager with any refs. One manager can withdraw another
  unit's sick report, undo its leave decision or its talk booking, take back its invoice approval, and mark or unmark
  its shifts as absent.

The low findings:

- **Replay (L1).** A captured write can be sent again under a new operation id within its two minutes. It then runs
  again in five connectors. In one case payroll imports the duplicates.
- **Capability binding (L2).** D117's promise that an assertion "cannot be replayed … on another capability" does not
  hold in fifteen connectors. They route on a path the verifier does not bind.
- **Configuration and documentation (L3–L8).** These are smaller gaps in configuration, conformance and
  documentation.

The wave-1 follow-ups are answered below:

- replay and what each write deduplicates on (L1 and the write table);
- who reads `units`, `assignments` or the signed relation (question 2);
- what each connector puts in its error messages (L6 and the error table);
- the manifest table an administrator never sees.

The conformance check `connector-check` runs. It passes seventeen of the eighteen connectors and fails one:
`reference` (L5). It catches none of M1, M2, L1 or L2 (question 5).

| Severity | Count | Ids |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 2 | M1, M2 |
| Low | 8 | L1–L8 |

## Findings

### Medium

#### M1. One unauthenticated request ends eight connector processes, and they read any body whole

**Where.** The wrapper reads every chunk into memory, then builds a `Request` and awaits `handle`. It has no size limit
and no `try`/`catch`. The `createServer` callback is async, so a throw becomes an unhandled rejection, and Node 26 ends
the process on one. The wrapper is at these lines:

- `connectors/hello/server.mjs:10`
- `connectors/intranet/server.mjs:10`
- `connectors/eneo/server.mjs:11`
- `connectors/phonebook/server.mjs:31`
- `connectors/appraisals/server.mjs:31`
- `connectors/nextcloud-approval/server.mjs:49`
- `connectors/moodle/server.mjs:77`
- `connectors/qlik/server.mjs:94`

`new Request(...)` throws before `handle` and before any key is checked in two cases:

- on a GET or HEAD request with a body ("Request with GET/HEAD method cannot have body");
- on a `Host` header that does not parse as a URL authority ("Failed to parse URL from http://a b/clew/manifest").

The other ten services do not have this problem:

- `supportmanagement` and `pob` use the hardened `http.mjs` listener: a 1 MB limit, no `Host` in the URL, and a
  `catch` that logs only the error's name.
- The seven fixtures and `reference` limit the body (64 KB, or 16 KB for `reference`; `hr/server.mjs:35`,
  `reference/server.mjs:17`) and catch.

**Scenario.** Anything that can reach the port sends `curl -X GET --data x http://<connector>/clew/manifest`, and the
service exits. The sender needs no transport key and no assertion. None of the compose files has a `restart:` policy,
including `.devcontainer/compose.yaml` and the folders' own. So Moodle, the Nextcloud approval app and Qlik stay away
from Clew until an operator starts them again. Even with a restart policy, one request a second keeps a service down.
A large POST is read whole into memory first.

**Established.**

- In the container `clew-review10-hello`, the manifest answered 200 first. Then `curl -X GET --data 'x'
  http://127.0.0.1:47010/clew/manifest` got no reply (curl exit 52) and the container stood `Exited (1)` with the
  TypeError above. The same happened with `-H 'Host: a b'` on a fresh start.
- For a real-system connector, `node connectors/nextcloud-approval/server.mjs` on port 47052 answered the manifest
  with 200, took the same GET with a body, and exited with code 1 at `server.mjs:49:19`.
- The other six wrappers have the same lines.

Severity: medium. The impact is availability, and the trigger is open to any client that can reach the port.

#### M2. Five undo writes and `timesheet.markAbsence` act on records outside the caller's unit

**Where.** These writes never look at the actor:

- `hr.unbookTalk`, `connectors/hr/connector.mjs:438`;
- `hr.undecideLeave`, `:478`;
- `hr.withdrawAbsence`, `:511`;
- `finance.unapprove`, `connectors/finance/connector.mjs:335`;
- `timesheet.unmarkAbsence`, `connectors/timesheet/connector.mjs:134`;
- `timesheet.markAbsence`, `connectors/timesheet/connector.mjs:107`. It writes for any `person` and answers with that
  person's shift and ward (`shiftOf`, `:127`).

The first five are written `(_actor, input) =>` and delete every ref they are given. The writes these undo do check
the unit: `hr.bookTalk` (`:406-412`), `hr.decideLeave` (`:452-456`), `hr.reportAbsence` (`:497`) and `finance.approve`
(`:276-279`). So does `incidents.withdraw` (`connectors/incidents/connector.mjs:107-112`).

On Clew's side, `POST /api/executions` (`apps/server/src/routes/api.ts:220-225`) accepts any execute the persona may
call. The capability's input schema is the only check on the payload:

- `authorize` validates the schema and the write safety (`apps/server/src/composition/executions.ts:58-78`);
- `review` applies only to capabilities that declare it (`apps/server/src/connectors/usecases/documents.ts:100-103`);
- `compensates` is checked only when the request names it (`apps/server/src/modules/executions/usecases.ts:88`).

Only the source can know whose record a ref is, and these sources do not ask.

**Scenario.** Karin manages Hemtjänst Norr. She posts `{ decisionId, operation: 'hr.withdrawAbsence', payload: {
refs: ['hr:absence:1005:2026-11-04'] } }`. The ref is guessable: the employee number and the day. The decision is
approved, dispatched and audited as hers, and Hillevi's sick report for employee 1005 at Skönsmons skola is deleted
from the HR system. Payroll imports from that feed. In the same way she can:

- reopen a leave request Hillevi approved;
- delete a talk Hillevi booked;
- take back Hillevi's invoice approval;
- mark Hillevi's employee absent in the time system, and learn the shift ("07:00–16:00 på Björken").

**Established.** A temporary unit test ran the HR, finance and time fixtures over the protocol. The actors were Hillevi
(a manager, `unit-skola`) and Karin (a manager, `enhet-17`, who has no staff in the fixtures). Karin's own attempts
were refused as they should be: `hr.reportAbsence` for 1005 answered "inte i din enhet", `hr.bookTalk` for 1006
answered "failed", and `timesheet.today` was empty. Her undo writes all went through:

| Write by Karin | Before | After |
|---|---|---|
| `hr.withdrawAbsence` | feed has 1 row | outcome `done`, feed has 0 rows |
| `hr.undecideLeave` | Hillevi's leave cards: 2, then 1 after her decision | 2 |
| `hr.unbookTalk` | talks `["hr:emp:1005"]` | `[]` |
| `finance.unapprove` | approved `["finance:inv:55120"]` | `[]` |
| `timesheet.markAbsence` for `hr:emp:1005` | | `done`, "4 nov., 07:00–16:00 på Björken, markerad i tidrapporteringen"; Hillevi's roster shows 1005 absent |

Severity: medium. Where this happens:

- The writes are in fixtures with synthetic data, so no real system is exposed.
- They run on the development stack that demonstrates Clew.
- They are the worked examples the connector guide points to: `hr.bookTalk` is "the worked example" for asks and
  effect in `docs/guides/creating-a-connector.md`.
- They teach that an undo needs no ownership check.

`hello.markDone` and `hello.undo` also act on one shared list with no unit check. The guide already says hello's
writes are a toy.

### Low

#### L1. A captured write sent again under a new operation id runs again in five connectors

**Where.** The verifier requires `jti` to be a string and never records it (`connectors/*/verification.mjs:62`). The
operation id travels in `X-Clew-Operation-Id`, which neither the body digest nor the assertion covers. So within the
assertion's two minutes, a request with the same body and assertion but another operation id verifies.

The write logs deduplicate on the operation id alone. That holds in hr (`connectors/hr/connector.mjs:549-563`),
timesheet, finance, incidents, communication and servicedesk (`connectors/servicedesk/connector.mjs:240-252`). The pob
fixture deduplicates on the operation id as well (`connectors/pob/cases.mjs:327-345`). Some writes also key their own
record on it, so a new id is a new row:

- `hr.reportAbsence`, `key = operationId ?? person:from` (`connectors/hr/connector.mjs:495`);
- `timesheet.markAbsence` (`connectors/timesheet/connector.mjs:121`).

**Scenario.** An attacker holds the transport key and captures one approved request. The connectors' own comments
plan for that ("Clew did, but the transport key could leak", `hr/connector.mjs:801`). The attacker sends the request
twice more with new operation ids:

- The HR system then holds three sick reports with the same ref, and payroll imports all three the next day.
- A replayed `servicedesk.order` files a second order at the desk.
- A replayed `incidents.report` files a second deviation.
- A replayed `timesheet.markAbsence` writes a second row.

Clew's ledger and audit show one execution.

**Established.** A temporary unit test captured the exact request that `remoteConnector` sent and resent it with only
`X-Clew-Operation-Id` changed:

| Write | Replays | Result |
|---|---|---|
| `hr.reportAbsence` | two | each 200; feed rows 3, all `hr:absence:1005:2026-11-04`; `payroll.absences` a day later: 3 rows |
| `timesheet.markAbsence` | one | 200; 2 stored rows |
| `servicedesk.order` | one | `SD-26110101` then `SD-26110102` |
| `incidents.report` | one | `incidents:dev:2026-1200` then `-1201`; 2 stored |
| `finance.approve` | one | `failed`, "Fakturan är redan attesterad", so no double effect |
| `reference.complete` | one | `failed`, "Läs tillbaka aktuell version": the revision makes it safe |

`pob`'s fixture was read, not run. Per connector, the answer to "what does a replay do" is in the write table under
question 7.

Severity: low. It needs the transport key and a captured request. But it doubles health and pay records, and nothing in
Clew's audit shows it. Binding the operation id into the signed request (or recording `jti`) closes it for every
connector at once. Wave 1 left this under "Not established".

#### L2. Fifteen connectors run a capability on a path the verifier does not bind, so D117's capability binding does not hold

**Where.** `bindingOf` gives a `capability` claim only to a path that matches `^/clew/(capabilities|installation)/…$`.
Any other path that does not contain `/clew/capabilities/` must carry an assertion with no capability claim
(`connectors/*/verification.mjs:12-34`). Scan, figure, documents and ask assertions are of that kind.

Fifteen connectors check only `startsWith('/clew/')`, handle `/clew/scan` and `/clew/figure` (and `/clew/ask`,
`/clew/documents`), and then take the capability name as `pathname.slice('/clew/capabilities/'.length)`:

| Connector | Line |
|---|---|
| hr | `hr/connector.mjs:798` |
| finance | `finance/connector.mjs:539` |
| incidents | `incidents/connector.mjs:240` |
| communication | `communication/connector.mjs:240` |
| timesheet | `timesheet/connector.mjs:201` |
| payroll | `payroll/connector.mjs:125` |
| servicedesk | `servicedesk/connector.mjs:375` |
| supportmanagement | `supportmanagement/connector.mjs:181` |
| pob | `pob/connector.mjs:548` |
| nextcloud-approval | `nextcloud-approval/connector.mjs:433` |
| eneo | `eneo/connector.mjs:425` |
| qlik | `qlik/connector.mjs:569` |
| phonebook | `phonebook/connector.mjs:149` |
| hello | `hello/connector.mjs:285` |
| reference | `reference/connector.mjs:140` |

`reference` checks no prefix at all. The other three are not affected: moodle and appraisals require
`startsWith('/clew/capabilities/')`, and intranet matches the exact path.

D117 item 5 says the verifier makes sure "an assertion cannot be replayed with another body or on another capability";
the code holds that only for paths that spell the prefix.

**Scenario.** Someone with the transport key captures a manager's scan request (`{ actor }`, sent on every refresh) and
replays it, within two minutes, to `/clew/` followed by any thirteen characters and a capability name. The capability
runs with the empty input. The executes looked at need refs or other input and fail on it. Reads answer, health data
included.

**Established.** In a temporary unit test, Hillevi's captured HR scan request gave these answers:

- To `/clew/capabilities/hr.whoIsOn` it answered 401, as it should.
- To `/clew/XXXXXXXXXXXXXhr.whoIsOn` it answered 200 with `onDuty` and `absent` (names with "sjukskriven", "vab",
  "sjuk").
- To `/clew/capabilitiesXhr.absenceOverview` it answered 200 with per-person counts of short and long sickness.
- `reference` answered `/aaaaaaaaaaaaaaaaaareference.items`, a path outside `/clew/`, with its rows.

Severity: low. It has the same preconditions as L1, it is limited to what that person may read, and the input is
fixed. But the code contradicts a guarantee the protocol documents. Each connector should route only on the exact
prefix, or the verifier should refuse an assertion with no capability claim on any path under `/clew/` other than the
four it names.

#### L3. The phonebook's HTTP adapter sends its API key across a redirect to another host, and neither it nor Eneo requires https

**Where.**

- `connectors/phonebook/directory.mjs:55-66` fetches `PHONEBOOK_URL` with `x-api-key`, with no `redirect: 'error'`
  and no scheme check.
- `connectors/eneo/connector.mjs:137` takes `ENEO_URL` as given, while the person's bearer token goes to it
  (`:150-161`).

The other real-system adapters refuse both:

- supportmanagement: `supportmanagement.mjs:29`, `:39`;
- pob: `pob.mjs:119`, `:158`;
- nextcloud-approval: `nextcloud.mjs:99`, `:116`;
- moodle: `moodle.mjs:260`, `:278`;
- qlik requires `wss:` (`engine.mjs:138`).

**Scenario.** The phone book's address answers with a redirect to another host. That can be a misconfigured proxy, a
moved service, or an attacker who controls the redirect. The integration key then goes to that host. With an `http:`
address the key or the person's Eneo token crosses the network in clear.

**Established.** In the app container, `createHttpDirectory({ url: 'http://localhost:47998', apiKey })` was pointed at
a local server that redirects to `127.0.0.1:47999`. The second server logged `x-api-key: k-123`. The same redirect with
`authorization` was stripped by Node's fetch, so Eneo's bearer token does not follow a cross-origin redirect; only the
scheme check is missing there.

Severity: low.

#### L4. The supportmanagement and pob compose files tell the operator to set a `CLEW_URL` the verifier refuses

**Where.** `connectors/supportmanagement/compose.yaml:4` and `connectors/pob/compose.yaml:4` give
`CLEW_URL=http://host.docker.internal:3000`. The verifier fetches keys over `http:` only for `localhost`, `127.0.0.1`,
`clew-app-1`, `app` and `clew` (`verification.mjs:158`).

**Scenario.** An operator copies the comment. Every call to the connector answers 401 "Ogiltigt behörighetsbevis",
because no key is ever fetched. Clew shows the source as unavailable, and nothing says why.

**Established.** The verifier was built with `clewUrl: 'http://host.docker.internal:3000'` and asked about an
assertion. It returned `null` without calling `fetch`.

Severity: low.

#### L5. `reference` answers 401 to an employee and fails the conformance check

**Where.** `connectors/reference/connector.mjs:98`: `if (!actor || actor.role !== 'manager') return fail('Du saknar
behörighet.', 401)`. The protocol keeps 401 for Clew's key or assertion, so `remoteConnector` reads it as "source
unavailable". The same handler verifies before it looks at the method, so a GET to anything but the manifest costs a
key fetch. It also routes on any path (L2).

**Established.** The conformance check that `connector-check.ts` runs (question 5) failed `reference` on one point:
"scan as employee: Testkälla svarar inte just nu." The guide sends readers to `reference` to study deduplication and
lookup, and that logic is sound (question 7). The fix is 403 for a refused person and a route check.

Severity: low.

#### L6. `hello` puts the underlying error's text in its answer

**Where.** `connectors/hello/connector.mjs:295`: `fail('unavailable', 'Hello-anslutningen kunde inte svara: ' +
error.message, 503)`. `error.message` can carry three things:

- a callback's refusal, which is another connector's or Clew's message (`clewCall`, `:138-145`);
- a runtime `TypeError`;
- a network error's English text.

That answer reaches the person, and through a tool call the model (assistant review, finding 8).

Every other connector answers fixed Swedish sentences, with at most the operator's configured `sourceLabel` (error
table below). `hello` is the example the guide offers for routes and callbacks.

Severity: low.

#### L7. Five real-system connectors serve made-up data when the adapter is left unset

**Where.**

- `supportmanagement/server.mjs:37` and its compose file (`SM_ADAPTER:-fixture`);
- `pob/config.mjs:29`;
- `nextcloud-approval/server.mjs:15`;
- `qlik/server.mjs:43`;
- `phonebook/server.mjs:10`.

Moodle refuses to start without an explicit `MOODLE_ADAPTER`, and says why (`moodle/compose.yaml:9-19`).

**Scenario.** An operator at another municipality follows the compose file and forgets the adapter. Managers then see:

- Qlik's invented sick-leave and economy figures for whatever unit they are on (`unitMap: null`, open mode);
- invented errands in supportmanagement, whose fixture reads the delegated token's claims without checking the
  signature;
- an invented directory in the phone book.

All of it is under the real system's name. The comment says it, but a default that looks like a working system is the
wrong default for a product shared with other organisations.

**Established.** Read from the code and the compose files. Each of the five logs its adapter when it starts.

Severity: low.

#### L8. `connectors/README.md` undercounts communication's reads

**Where.** `connectors/README.md:49` says "4 reads, 1 write, scan". The manifest has five reads:

- `communication.notices`
- `communication.news`
- `communication.newsItem`
- `communication.open`
- `communication.lookup`

Every other row's count matches its manifest; they count the lookup read too.

Severity: low.

## The eight questions

### 1. Verifying Clew

All eighteen `verification.mjs` files are byte-identical (one MD5 for all). Each connector calls `verify(token, key,
request)` with the request, so the assertion is bound to the body and, on a capability route, the capability. Moodle
also calls `verify.installation` on `/clew/installation/…` (`moodle/connector.mjs:601`). What the verifier checks:

- RS256 only, `typ` JWT, a `kid`, and exactly one public JWK that matches.
- `iss`, `aud`, `exp` and `iat` with five seconds of skew, and a life of at most 120 s.
- The actor's shape, and that a person's assertion is never valid on the installation's route.
- The transport key, with `timingSafeEqual`.
- Keys come only from the configured `CLEW_URL`: `https:` outside a fixed local allow-list, `redirect: 'error'`, a
  five-second timeout, cached for 60 s, an unknown `kid` refetched at most once a second.

The gaps are that `jti` is not recorded and the operation id is outside the binding (L1), and that most connectors
route on a path the binding does not cover (L2).

### 2. Acting as the person (D89, D117) and who reads `units`, `assignments` and the relation

| Connector | Delegation audience | How it knows the person | Who decides access |
|---|---|---|---|
| supportmanagement | `supportmanagement` | Passes the person's token to the gateway (api adapter). The fixture reads its claims unverified, which is documented. | SupportManagement |
| pob | `pob` | Validates the token itself (`identity.mjs`: RS256/384/512 allow-list, kid, issuer, audience, exp/nbf/iat, keys from an `https` JWKS, `redirect: 'error'`) and requires its account claim to equal the signed `userName`, case-insensitive | POB, through `holds()` in the fixture |
| nextcloud-approval | `nextcloud` | `whoami` with the token; the id must equal `userName` | Nextcloud; a decision is settled by reading the state back |
| eneo | `eneo` | Passes the token to Eneo; `eneo.whoami` decodes the claims for the person, `model: false` | Eneo |

No connector stores or logs a token. Who reads what:

- **`assignments` (D135).** Only hr reads it. A manager's reads and writes cover only the units where the
  assignment's role is `manager` (`hr/connector.mjs:86-95`). That is right.
- **`units`.** Only qlik reads `actor.units`, and it answers every unit in it after one `requireManager` on the primary
  role (`qlik/connector.mjs:97-103`). It is the consumer of the identity review's finding 3: a unit the person is only
  placed on gets figures.
- **The signed relation (`about`).** Moodle (`:181-200`) and servicedesk (`:71-93`) narrow by it: `self` and
  `managed` only, and under `self` the key must be the caller's own user name. Appraisals keeps its own manager map,
  which D117 allows.

The fixtures read the acting person's unit from the assertion and nothing else.

### 3. Input and output

- **Listeners.**
  - supportmanagement and pob: a 1 MB limit, no `Host` in the URL, and the error name only.
  - The fixtures: 64 KB, `reference` 16 KB, with a catch.
  - The other eight read without limit and exit on a throw (M1).
- **Input.** Input is taken from `body.input` when it is an object, else `{}`. State is a parameterised node:sqlite
  key–value table (`state.mjs`, the same file in seven fixtures).
- **Source requests.**
  - Qlik's engine expressions come from configuration only.
  - The phone book drops protected and hidden records before anything else reads them (`directory.mjs:25`).
  - Finance documents are bytes built in memory, never a file path.
- **Links.**
  - Eneo's search hits pass `metadata.url` through as `link` unchecked (`eneo/connector.mjs`, `hitOf`); its assistant
    sources are checked for `https`.
  - The phone book's `raw.link` is likewise unchecked.
  - Both are the boundary review's finding 8 seen from the source side.

### 4. Secrets and logs

- **Secrets.** No connector writes a token, key, delegated token or request body to a log. The connectors take
  secrets from the environment or a file (`POB_PASSWORD_FILE`). No secret is in a compose file, apart from documented
  local development defaults: `CLEW_DEV_*` in `.devcontainer/compose.yaml`, Moodle's development token, and the
  `moodle-local-only` role password in `scripts/moodle.sh`.
- **Real connectors.** On an unexpected error they log only the error's name (sm, pob, nextcloud-approval, moodle,
  qlik, servicedesk).
- **Fixtures and phonebook.** hr, finance, incidents, communication, timesheet, payroll and phonebook log the whole
  error object with `console.error(error)`. That is a stack, with no secrets in the paths read.
- **pob's access log.** pob writes one JSON line per call with the account, the case id and the outcome. That is
  personal data in a log, deliberately.

The fixture keys (`x-fixture-key` for the HR feed and the service desk's own route) are compared with `!==`, not in
constant time, on ports bound to 127.0.0.1. That is development only.

### 5. Protocol 1: the conformance check

`scripts/connector-check.ts` signs with the installation key it reads from the database (`signingAuthority`, which
creates one if there is none). Pointing it at a process of my own would have meant reading the shared development
database, which this review was told not to touch. So the check's own routine, `checkConnector` from
`packages/connectors/src/check.ts`, was run with every argument the script passes:

- `assert` from a signing authority;
- the same HS256 foreign signer;
- `assertInstallation`;
- the same `acceptsEmptyInput`;
- no keys.

It ran against every connector's own handler with its fixture adapter, in one temporary unit test.

| Connector | ok | warn | fail | What was not ok |
|---|---|---|---|---|
| hello | 14 | 2 | 0 | `hello.dayWithMeetings` needs a running Clew for its callback |
| phonebook | 14 | 0 | 0 | |
| reference | 9 | 0 | **1** | scan as employee: "Testkälla svarar inte just nu." (L5) |
| intranet | 6 | 0 | 0 | |
| qlik | 34 | 3 | 0 | three unit reads: no keys given |
| appraisals | 17 | 1 | 0 | no keys given |
| supportmanagement | 6 | 1 | 0 | delegation not verifiable without a session |
| pob | 11 | 1 | 0 | delegation |
| nextcloud-approval | 13 | 1 | 0 | delegation |
| eneo | 8 | 1 | 0 | delegation |
| moodle | 13 | 1 | 0 | no keys given |
| hr | 43 | 1 | 0 | no keys given |
| finance | 30 | 0 | 0 | |
| incidents | 12 | 0 | 0 | |
| communication | 17 | 0 | 0 | |
| timesheet | 11 | 0 | 0 | |
| payroll | 9 | 0 | 0 | |
| servicedesk | 25 | 1 | 0 | no keys given |

The check does not try:

- a request the listener cannot parse (M1);
- an undo on a record that is not the caller's (M2);
- a replay under a new operation id (L1);
- a path that is not exactly the capability route (L2).

### 6. People and health data (D115)

The table lists every capability a connector marks `model: true`, with what it says the model may read. The connector
says it, and no administrator sees it.

| Connector | `model: true` capabilities | `modelReads` |
|---|---|---|
| supportmanagement | `sm.errands` | summary |
| pob | `pob.errands`, `pob.requests`; `pob.reportFault` (propose, when writes are on) | summary |
| nextcloud-approval | `nextcloud-approval.pending` | summary |
| qlik | `sickLeaveByUnit`, `sickLeaveTrend`, `sickLeaveChart`, `economyByUnit`, `economyChart`, `hmeByUnit`, `hmeChart` | rows (aggregates, withheld under `QLIK_MIN_GROUP`) |
| hello | `greeting`, `openItems`, `dayWithMeetings` | rows |
| phonebook | `directory`, `team` | summary |
| phonebook | `search` | rows |
| reference | `items` | rows |
| hr | `whoIsOn` | rows (open question) |
| hr | `absenceOverview`, `leaveRequests` | summary |
| hr | `myShift`, `myBalance`, `rehabRoutine` | rows |
| finance | `invoices`, `budget`, `record`, `metrics`, `trend`, `comparison`, `history` | rows |
| finance | `documents` | summary |
| incidents | `deviations` | rows (no names) |
| communication | `notices` | rows |
| timesheet | `today` | summary |
| payroll | `absences` | summary |
| servicedesk | `requests` | summary |
| moodle, eneo, appraisals, intranet | none | |

These capabilities carry a health fact about a named person. All except `hr.whoIsOn` are `summary`:

- `hr.absenceOverview`
- `hr.leaveRequests`
- `payroll.absences`
- `timesheet.today`, through its `absent` flag

`hr.whoIsOn` is the open question already listed. `hr.myShift` gives colleagues' names and hours, not their absence.

The rest of the manifest an administrator does not see:

| Field | Connectors |
|---|---|
| `uses` | only hello: `['calendar.today']` |
| `delegation` | sm `supportmanagement`, pob `pob`, nextcloud-approval `nextcloud`, eneo `eneo` |
| `scan` | pob, nextcloud-approval, hello, reference, hr, finance, incidents, communication, servicedesk |
| `installation` | moodle `['moodle.holdings']` |
| `assistants` | eneo (`eneo.assistants`), hello (`hello.assistants`) |
| `documents` | finance |
| `header` | intranet (`intranet.header`) |
| `assignments` | hr |
| `facts` | hr (`hr:absence`) |

All eighteen declare protocol 1.

Outside the protocol, the HR fixture's `/fixture/absences` feed serves every unit's sick reports to one key, for
payroll. It is development only, with its own key (`.devcontainer/compose.yaml:208`, `:347-348`).

### 7. Writes, idempotency and declared safety

| Write | Declared | Deduplicates on | Replay under a new operation id |
|---|---|---|---|
| `pob.createCase` (writes on) | manual | fixture: the operation id in memory; the api adapter has no create | a second case in the fixture (read) |
| `nextcloud-approval.approve`, `.reject` | manual | nothing; the state is read back, Nextcloud refuses a repeat | no second effect (read) |
| `hello.markDone`, `.undo` | manual (omitted) | nothing; sets or clears a per-ref mark | no second effect (the mark's time moves) |
| `reference.complete`, `.undo` | deduplicated | operation id, with person + name + ref + revision in one SQLite transaction | refused by revision (run) |
| hr, 7 writes | deduplicated | operation id, with person + digest | `reportAbsence` duplicates (run); `decideLeave` and `bookTalk` overwrite |
| `finance.approve`, `.unapprove`, `.correct` | deduplicated | same | `approve` refuses an approved invoice (run); `correct` is revision-checked |
| `incidents.report`, `.withdraw` | deduplicated | same | `report` duplicates (run) |
| `communication.acknowledge` | deduplicated | same, per-person receipts | no second effect |
| `timesheet.markAbsence`, `.unmarkAbsence` | deduplicated | same | `markAbsence` duplicates (run) |
| `servicedesk.order` | deduplicated | operation id, also filed at the desk as the order's reference with the digest | a second order (run) |

Every `deduplicated` write has a `lookup` read of the same connector, and the lookup is per person. Strategy `manual`
on the three real-system writes is right: their sources take no idempotency key.

**Is `reference` right?** Its durability logic is right:

- the operation id is required;
- the digest binds the person, the name, the ref and the revision;
- the operation row and the item update are one `BEGIN IMMEDIATE` transaction (WAL, `synchronous=FULL`);
- the lookup is per person;
- a stale revision is refused, which is also why a replay does no harm.

What is not right is its protocol surface: 401 for a refused person, and routing on any path (L5, L2).

Without an operation id, `hr.reportAbsence` and `timesheet.markAbsence` return an existing receipt keyed by person and
day before the unit check. Clew always sends an operation id for an execute, so this is not reachable through Clew.

### 8. Independence, folders, README rows and other languages

- **Independence.** No connector imports from `apps/`, `packages/` or `@clew/*`. Every connector folder has no
  `package.json` and no dependency. Each Dockerfile starts from `node:26.13.0-bookworm-slim` and runs as `USER node`.
- **README rows.** `connectors/README.md` has a row for every one of the eighteen folders, and the counts match except
  communication's (L8).
- **The development scripts.**
  - They are guarded by `requireFixtureDevelopment` (`CLEW_POC=true`, not production).
  - `fixtures-reset.sh` refuses to run unless the server and worker are stopped, and removes only the fixture
    volumes.
  - `retireFixtureWork` writes an audit row per change in its transaction.
  - `dev-connectors.ts` makes its choices through the administration use cases, with their audit rows.
- **Other languages.** The task's premise of PHP or Python under `connectors/` does not hold: there is none. The
  tracked PHP is the development stack's own seeds and configuration:
  - `.devcontainer/moodle/{config,seed}.php`
  - `.devcontainer/calendar/{approval-seed,poc.config,refresh-calendar-apps,seed}.php`
  - `tests/calendar-image.php`

  The team wrote it (git authors), and it is guarded by `CLEW_POC`. Like the rest of the repository it carries no
  licence (baseline finding 2). The systems it configures are recorded in `docs/reference/licences.md`: Moodle
  GPL-3.0-or-later, Nextcloud and its apps AGPL-3.0, both separate processes. There is no Python anywhere.

### Error messages, per connector (assistant review finding 8)

| Connector | What its error answers carry |
|---|---|
| supportmanagement, pob | fixed Swedish sentences; pob maps a refusal to its own `refusals` table |
| nextcloud-approval, moodle | fixed sentences with the configured `sourceLabel`; own `Invalid` texts |
| qlik | fixed sentences ("Qlik svarar inte just nu."); own `Invalid`/`NotFound`/`Denied` texts |
| eneo | fixed `EneoError` sentences; no upstream text |
| phonebook | fixed sentences; source text deliberately kept out (`connector.mjs:163`) |
| appraisals, intranet | own `Invalid` texts |
| hr, finance, incidents, communication, timesheet, payroll, servicedesk, reference | own Swedish texts from their `Invalid`, `Denied`, `Conflict` and `NotFound` |
| hello | `'Hello-anslutningen kunde inte svara: ' + error.message`: any thrown text (L6) |

## Not established

- **Real source systems.** The real systems behind the adapters were not reached: SupportManagement's gateway, POB,
  Nextcloud, Moodle, Eneo and Qlik's engine. Their adapters were read, not run against a source.
- **Unrun cases.** The `pob` fixture's replay, and whether a client that disconnects in the middle of a body also ends
  one of the eight services of M1 (the `for await` over the request would throw), were not run.
- **Assertion expiry.** That an assertion older than two minutes is refused was read, not run: the verifier reads
  `Date.now()`, which the test could not move.
- **`reference` in a real installation.** Whether Clew scans `reference` as an employee was not checked. Its areas are
  manager-only, so L5 may bite only the check.
- **READMEs.** They were read for configuration tables and run commands. Not every sentence was compared with the
  code.

## Looked at and found sound

- **The verifier.** Its design, the identical copies, and every connector handing it the request.
- **Installation reads.** Moodle answers `/clew/installation/moodle.holdings` only to `verify.installation`.
- **Acting as the person.** As in question 2, including pob's own token validation and the account match.
- **Relations.** moodle and servicedesk narrow by the signed relation, and hr follows the D135 assignments.
- **Writes and lookups.** The deduplicated writes, their lookups, and the per-person operation log. So is the
  durability of `reference` and the read-back of `nextcloud-approval`.
- **Real adapters.** sm, pob, nextcloud-approval and moodle require `https` and refuse redirects; qlik requires
  `wss`.
- **Eneo's token.** Node's fetch strips `Authorization` on a cross-origin redirect (verified), so Eneo's missing
  `redirect: 'error'` does not hand the token on.
- **Moodle's adapter default.** Moodle refuses to start without a stated adapter.
- **Ownership checks.** `incidents.withdraw` checks that the record is the caller's or one they manage. The service
  desk's order checks the vouched relation and the catalogue.
- **Fixture storage.** SQLite access is parameterised, and the stores use WAL with `synchronous=FULL`.
- **Images.** Non-root images.
- **Development scripts.** Guards, audit rows and volume scope.

## Seen outside this area

- **A wave-1 statement that is wrong.** The assistant review's finding 11 says "Neither `connectors/eneo` nor
  `connectors/hello` declares `uses`". hello declares `uses: ['calendar.today']` together with `assistants`
  (`connectors/hello/connector.mjs:112` and the manifest table above). So a source assistant in this repository can
  read through Clew while it answers, which is the case finding 11 describes as hypothetical.
- **Free undo through the decision endpoint.** `POST /api/executions` lets a persona send any execute it may call
  with a free payload, and an "undo" capability can be sent without `compensates`. The design leaves ownership to the
  source, so the finding is M2's. But the endpoint gives a person a direct way to call an undo outside the ten-minute
  window and outside the receipt it belongs to.
- **The test helper's capability.** `tests/connector-authority.ts` `signedRequest` takes the capability from
  `/clew/capabilities/` anywhere in the path (`indexOf`). It mirrors the laxness of L2, in a test helper only.
- **Exception in the import rule.** `apps/server/src/routes/protocol.ts:8-9` imports the hello and phonebook
  manifests. `.dependency-cruiser.cjs` allows it as the one exception (D60), and the baseline notes that `CLAUDE.md`
  does not say so.

## What this review started, and removed

- **The hello container.** `clew-review10-hello` (`node:26.13.0-bookworm-slim`, `connectors/hello` mounted read-only,
  127.0.0.1:47010) exited from the M1 request and was removed with `docker rm`.
- **The nextcloud-approval process.** It ran on port 47052 inside the app container, exited from the M1 request, and
  its log file was deleted.
- **The local redirect servers.** The two servers for L3, on ports 47998 and 47999, were closed by the script that
  opened them.
- **The temporary tests.** `tests/unit/zz-review10-probe.test.ts` and `tests/unit/zz-review10-check.test.ts` were run
  and deleted.
- **The worktree's dependencies.** `bun install --frozen-lockfile` was run in this worktree. `node_modules` is not
  tracked.
