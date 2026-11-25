# Review: the connector boundary in the core (2026-11-23)

One of five reviews of the whole repository made on the same day. This one covers how Clew's core meets a connector: the protocol package, the registry, signing and the callback, registration and governance by an administrator, the joined reads, and what a connector's answer may do on its way to a page. Reviewed: `origin/main` at `9fd4c962`. Nothing was changed; the fixes come later. The connector services under `connectors/` are a later review's and were read only to follow a request end to end.

## Summary

The boundary's central mechanisms hold. A call from Clew is signed with the installation's RSA key for one connector, for two minutes, and bound to the exact body and the capability's name. A connector's way back in, `POST /api/connectors/call`, takes only a separate callback grant, rebuilds the person from their current grant, re-checks the target connector's audience, switch and scope for that person, refuses an `execute` on the capability it would run, and passes the input through the rule of who may be asked about (D117). The published JSON Schema and OpenAPI document are byte for byte what the code generates, and the Scalar page loads nothing from outside the installation.

What does not hold is mostly around the manifest and the transport:

- A connector decides by its own manifest which other connectors' reads it may call as the person (`uses`) and which audience the person's token is exchanged for (`delegation.audience`). No administrator is shown either, neither can be narrowed, and a change to them goes live without review or an audit row.
- "Hämta manifest igen" fetches from the service and answers differently for an id that exists before it checks that the caller is an administrator, so any signed-in person can tell which connectors are registered.
- The transport follows redirects on most calls, sending the transport key and the person's delegated token along, and reads an answer of any size into memory.
- The public manifest dry run keeps every schema it compiles, so an unauthenticated caller can grow the server's memory without bound.
- A job proposal names a connector to a person outside its audience.

**Findings: 1 high, 6 medium, 6 low.** Six more points are under [Not established](#not-established).

How each finding was established is said with it: a code path read from the route to the store, or a test or probe whose output is quoted. The tests and probes were temporary files in the worktree, run as single files inside the devcontainer (`bun test tests/unit/<file>`, and `node --import tsx` for the transport, since Node is the server runtime), and removed afterwards. Nothing was run against the shared database or the shared development server, except that the built-in browser read `http://localhost:3020/api/protocol`, after its page and its script were compared byte for byte with this commit's.

## Findings

### High

#### 1. A connector declares for itself what it may read through Clew and whose token it is handed, and no administrator sees or decides it

**Where.** `packages/connectors/src/protocol.ts:457-464` (`uses`: up to 100 capability names of any connector) and `:393-401`, `:480` (`delegation.audience`). The callback grant is signed from the manifest's own list (`apps/server/src/connectors/remote.ts:75-77`, `authority.ts:75-77`), and the callback is checked against the same list (`packages/connectors/src/index.ts:987-989`, `apps/server/src/routes/connector-callback.ts:82-91`). The token exchange takes whatever audience the manifest names (`packages/connectors/src/remote.ts:130-141`), checked only against a character pattern (`apps/server/src/auth-exchange.ts:15`, `:24`). `Governance` has no field for either (`packages/connectors/src/index.ts:616-628`), `ConnectorDetail` shows neither (`packages/contracts/src/index.ts:4517-4527`), and `ManifestDiff` and the `connector.manifest` audit row cover capabilities and areas only (`packages/contracts/src/index.ts:4537-4544`, `apps/server/src/connectors/usecases/admin.ts:596-603`, `:611-617`).

**Scenario.** A vendor's connector is registered for its own reads. Its manifest also says `scan: true` and `uses: ["clew.work", "hr.person", "people.search"]`. Every scan Clew makes for a person in the connector's audience (nightly, and when the person is present) carries a callback grant that is valid for two minutes. Within them the service posts to `/api/connectors/call` and is answered the person's whole Att göra list from every other system (`clew.work`: titles, systems, states and the source's sentence), the HR rows about the people that person manages, and anything else it listed, each as the person may read it. Nothing on Anslutna system says that this connector reads other systems, the administrator cannot switch it off short of disabling the target for everyone, and no audit row records the reads. In the same way a manifest that says `delegation: { "audience": "<another system's client id>" }` is handed the person's token for that system in `X-Clew-Delegated-Token` on every call a session stands behind, wherever the identity provider lets Clew's client exchange for that audience, which it must for every other delegating connector of the installation.

What limits it: the target is run as the person, so the connector reaches only what a person in its own audience may read, and only while it holds a grant for them; an `execute` is refused; the token exchange is the identity provider's to refuse.

**Severity: high.** Personal data from one system reaches another system's service on that service's own say-so, and a change to it is reviewed by nobody (finding 3).

**Established by.** The code paths above. `tests/unit/connector-callback.test.ts` ("a read and a proposal answer their output") shows a listed target answered. A temporary test over the admin use cases, the memory store and the reconciler: the service's manifest gained two callback targets and a delegation audience, and afterwards the live connector had them and the audit log had not changed:

```
B uses before: ["calendar.today"] -> live after: ["calendar.today","finance.invoices","clew.work"]
B stored delegation: {"audience":"another-system"} live delegation: {"audience":"another-system"}
B audit before: ["connector.added","connector.enabled"] after: ["connector.added","connector.enabled"]
B refresh diff for the same change: {"added":[],"removed":[],"changed":[],"areasAdded":[],"areasRemoved":[],"same":false}
```

D37, which would list what a connector uses on its page, is `proposed` and its status is an open question; this finding is about what the code grants today, not about that record.

### Medium

#### 2. "Hämta manifest igen" fetches the service and tells an existing connector from a missing one before it asks who is calling

**Where.** `apps/server/src/connectors/usecases/admin.ts:575-608`: `must(id)`, `remote(row)` and `transport.fetchManifest(url, id)` run first; `requireAdmin` is at `:605` and `mutating` at `:608`. The route stands behind the session guard only (`apps/server/src/routes/admin.ts:83`, `:206-214`).

**Scenario.** Any signed-in person posts `{}` to `/api/admin/connectors/<id>/refresh`. For an id nobody registered the answer is 400 "Anslutningen finns inte."; for a remote connector that answers it is 403; for one whose service is down it is 503; for one of Clew's own it is 400 "En inbyggd anslutning har ingen adress och ingen nyckel.". A person outside a connector's audience can so learn that it is connected and whether it is up, which D23 says they cannot ("cannot learn that Raindance is connected"). Each such request also makes the server fetch the service's manifest, for a caller who is no administrator, and nothing limits how often.

**Severity: medium.**

**Established by.** The code path, and a temporary test calling the use case as a person without `admin.connectors`:

```
A missing id  -> InputError | Anslutningen finns inte.
A existing id -> ForbiddenError | Du saknar behörighet för åtgärden.
A manifest fetches made for the non-administrator: 1
A existing id, service down -> Error | ECONNREFUSED
```

`failure()` (`apps/server/src/context.ts:40-63`) answers these as 400, 403 and 503. Every other use case in the file checks the capability first.

#### 3. "Testa anslutning" replaces the stored manifest and the reconciler puts it live, with no audit row and no step-up, and the reviewed path does not show what matters

**Where.** `apps/server/src/connectors/usecases/admin.ts:557-573`: `test` checks `requireAdmin` only, never `persona.authorize()`, and ends with `store.recordHealth(id, health, report.manifest, at)`, which overwrites the row's manifest (`adapters/postgres.ts:112-117`, `adapters/memory.ts:26-34`). The reconciler registers a row whose manifest differs from the one it holds (`apps/server/src/connectors/reconcile.ts:116-127`), on its five-second tick and before every protected read. Enabling a draft that had no manifest stores the fetched one the same way, outside the audited transaction (`admin.ts:368-376`). The reviewed path compares capability names and area ids only (`admin.ts:584-603`).

**Scenario.** A connector's service starts serving a manifest with a new capability offered to the model, another callback target or a delegation audience. An administrator presses "Testa anslutning", whose own comment says "health recorded, nothing else changed". The new manifest is stored and is live within seconds; the new capability is enabled, since governance only narrows. No `connector.manifest` row is written, no step-up was asked, and the page shows no difference. Had the administrator pressed "Hämta manifest igen" instead, the difference shown for a change of `uses`, `delegation`, `scan`, `assignments`, `installation` or `documents` would have been empty lists, and the audit row would carry the same empty lists.

That a manifest refetched at boot goes live silently (`apps/server/src/connectors/remote.ts:113-118`) is stated in D37 item 4, a proposed record whose status is an open question, and is not counted here. This path is not stated anywhere, and the use case's comment says the opposite.

**Severity: medium.** D23 holds every administration change to an audit row in the same transaction and a step-up; this one changes what a connector may do with neither.

**Established by.** The code path, and the output quoted under finding 1 (the same temporary test: `admin.test` on an enabled connector whose service had changed its manifest, then `applyAllRows`).

#### 4. The transport follows redirects, with the transport key and the person's token, and shows the other host's words to the person

**Where.** `packages/connectors/src/remote.ts:218-230` (`post`: every capability call, scan and figure) and `:117-120` (`fetchManifest`) set no `redirect`. The document read (`:387`), the question to an assistant (`:462`) and the installation read (`:287`) set `redirect: 'error'`, so the rule is known and missing on the other calls. The two direct probes of the conformance check (`packages/connectors/src/check.ts:666-674`, `:692-700`) set neither a redirect rule nor a timeout.

**Scenario.** A registered service, or whatever answers at its address, answers a capability call with 307 to another host. Clew posts the same body there, the person's identity in it, with `X-Clew-Connector-Key` and, for a delegating connector, the person's own token in `X-Clew-Delegated-Token`. Whatever that host answers in the shape `{ "error": { "message": … } }` is shown to the person as the connector's refusal. So a connector's service decides which hosts inside the network Clew's server posts to, though an administrator registered one address, and the person's token for the connector's system leaves for a host nobody registered. A manifest read is redirected the same way, and the refusal the administrator reads names the properties of the other host's answer.

**Severity: medium.** The service already holds the key and the token it is sent, so the new reach is the request itself, into the server's network, and the reflected text.

**Established by.** A temporary probe under Node 26 with two local servers, the registered one answering 307 and 302:

```
1 capability call answered 307 to another host -> CapabilityError: INTERNAL: text from the other host
1 the other host received: POST /internal/admin
1 headers there: x-clew-connector-key=PRESENT x-clew-delegated-token=PRESENT authorization=absent body bytes=90
2 manifest read answered 302 to another host -> ManifestError: Invalid connector manifest: /id: Expected required property; … /leaked: Unexpected property
2 the other host received: GET /latest/meta-data
```

#### 5. A connector's answer is read into memory whatever its size

**Where.** `packages/connectors/src/remote.ts:236` (`response.json()` in `post`) and `:122` (the manifest). The document read caps its bytes (`:412-427`) and the assistant's stream its length (`:147`, `:168-169`); a capability call, a scan, a figure and a manifest have a time limit (ten and five seconds) and no size limit.

**Scenario.** A connector answers one read with several hundred megabytes of valid JSON inside the ten seconds. The server holds the text and the parsed value at once, then validates it and, for `/api/cap`, serialises it again for the browser. One such answer, or a few at once from a joined read that asks every source in parallel, ends the server's process, and with it the durable engine that runs in it (D85).

**Severity: medium.** It takes a registered connector that misbehaves or is taken over; the effect is the whole installation.

**Established by.** The same probe, one call each:

```
3 a 64 MB answer -> accepted, a string of 67108864 characters in 94 ms, rss +297 MB
3 a 400 MB answer -> accepted, a string of 419430400 characters in 519 ms, rss +1624 MB
```

#### 6. The public manifest dry run keeps every schema it compiles

**Where.** `apps/server/src/routes/protocol.ts:21` (one `Ajv` for the module) and `:77-83` (`ajv.compile(schema)` for every capability's input, on every request). Ajv keeps each compiled schema in a cache keyed by the schema object, and each request's objects are new. The same lines read the whole body before the 500 kB limit is applied (`:69-70`). The route is public, answers any origin and is mounted ahead of the startup gate (`apps/server/src/main.ts`); the server has no request size limit and no rate limit anywhere.

**Scenario.** Anyone who can reach the installation posts a manifest of ordinary shape to `/api/protocol/manifest` in a loop. Each request leaves about two megabytes that are never released. A few hundred requests take a gigabyte, and the process ends as in finding 5, without a session.

**Severity: medium.**

**Established by.** A temporary probe that called `protocolRoutes.request('/manifest', …)` in its own process with the repository's phonebook manifest, one capability repeated 300 times (238 kB, accepted, `ok: true`), and read the heap after a forced collection:

```
heap after 1 request (MB, after gc): 38
heap after 50 more requests (MB, after gc): 144
heap after 100 more requests (MB, after gc): 237
heap after 200 more requests (MB, after gc): 335
```

The probe's last label is wrong: it made fifty requests between each line, so the last figure is after 150 requests, not 200. The loader's own compiler does not leak: `packages/connectors/src/validation.ts:45-48` makes a new `Ajv` per call.

#### 7. A job proposal names a connector to a person outside its audience

**Where.** `packages/connectors/src/index.ts:1517-1527`: `Registry.followers` answers every follower "whether or not this person may call it", with the connector's id and name. `apps/server/src/modules/jobs/usecases.ts:76-97` puts each bound follower in the proposal's `sources`, also when it is `disabled` or `degraded` for this person. `POST /api/jobs/assemble` answers the proposal to any signed-in person, for a fact the browser sends (`apps/server/src/routes/api.ts:235-240`).

**Scenario.** An administrator has bound `payroll.followHire` to the fact kind `hr:hired`, and the payroll connector's audience is managers. An employee posts a fact of that kind and is answered `{"connector":"payroll","source":"Lönesystemet","capability":"payroll.followHire","status":"degraded","reason":"capability-unavailable"}`: the id, the name and a capability of a connector that, by D23, does not exist for them. A binding whose own audience leaves the person out is named the same way, with `reason: "audience"`.

**Severity: medium.** It is the one surface found where a hidden connector is named; D55, which asks that every bound system be named, is `proposed`.

**Established by.** The code path, and a temporary test over a registry with that audience and the jobs use case:

```
C visible to hassan: false
C sources answered to hassan: [{"binding":"b1","bindingRevision":"digest","connector":"payroll","source":"Lönesystemet","capability":"payroll.followHire","status":"degraded","reason":"capability-unavailable"}]
```

### Low

#### 8. Four link fields from a source carry no scheme rule

**Where.** `packages/contracts/src/index.ts:1080` (`SearchHit.link`), `:1168` (`ErrandRow.link`), `:433` (`SourceCitation.link`, filled from a hit's link at `apps/server/src/assistant/answer.ts:86`), and the output of `clew.openSource`, `{ url: Type.String() }` (`apps/server/src/modules/search/connector.ts:59-65`). Every other link a source gives is held to http(s): `sourceLink` at `index.ts:1207`, the header's `siteHref`, the assistants profile's `https`.

**Scenario.** A search source answers a hit whose `link` is not a web address. It is drawn as "Öppna" in the hit list (`apps/web/src/components/views/panel.tsx:120`, `:162`), handed to Astryx's `Markdown` as a citation's address, and, for a card made from an answer (its `clew.openSource` action, `apps/server/src/threads/usecases/cards.ts:587-590`), opened with `window.open(url, '_blank', 'noopener')` (`apps/web/src/components/work/card.tsx:482-486`). A `javascript:` address is stopped today by three things that are not validation: React 19 blocks it in an `href`, Astryx's Markdown drops `javascript:`, `vbscript:` and `data:` addresses (`@astryxdesign/core` 0.7.16, `dist/utils/safeUrl.js`), and a window opened with `noopener` should not run it (see Not established). Any other scheme, a `file:` address or one that starts a program registered for it, is passed on as given.

**Severity: low.**

**Established by.** The schemas and the three sinks, read; the React and Astryx versions from `apps/web/package.json` and the installed package. A view's own `link` field is checked in the browser (`apps/web/src/components/views/view.tsx:264`, `:346-352`).

#### 9. Adding or testing a connector whose service does not answer ends in "Något gick fel", and `unreachable` is never recorded

**Where.** `apps/server/src/composition/index.ts:403-405`: the live `check` fetches the manifest itself, to learn `uses`, before it calls `checkConnector`, and that fetch is not caught. The handling written for this case is never reached on that path: `checkConnector`'s own (`packages/connectors/src/check.ts:197-203`) and `healthFrom`'s `unreachable` and `manifest-invalid` branch (`apps/server/src/connectors/usecases/admin.ts:120-123`).

**Scenario.** An administrator adds a connector whose service is not up yet, or tests one that is down. The use case throws a plain error, the route answers 503 "Något gick fel. Försök igen.", nothing is stored on add (so there is no draft to test later, which `docs/architecture/connector-administration.md` describes), and on test the row keeps the health it had, `ok` perhaps.

**Severity: low.**

**Established by.** Reading the wiring. The unit suite does not show it, because its harness hands `checkConnector` straight in, without the fetch before it (`tests/unit/connector-admin.test.ts:137-144`).

#### 10. Audit rows the repository's rule asks a scenario test for, and that have none

**Where.** No test under `tests/` or `apps/server/tests` asserts the action `connector.manifest` ("Hämta manifest igen" with `apply`, `admin.ts:609-618`; called at `tests/unit/connector-admin.test.ts:345` and `tests/unit/menu.test.ts:509`, `:520`, with no audit assertion), `connector.capability`, `connector.scan`, `connector.tools`, `connector.url` or `connector.draft` (`admin.ts:379-394`, `:409-429`, `:511-517`). Nothing tests `signingAuthority` or `rotateSigningKey` at all (`apps/server/src/connectors/signing.ts`: `connector.signing_key_created`, `connector.signing_key_rotated`), nor `setConnectorState` and `removeConnector` in `scripts/connector-registry.ts`.

**Severity: low.** The rows are written, in the same transaction as the change (read in `adapters/postgres.ts:40-102`); what is missing is the test the rule names.

**Established by.** `grep` for each quoted action string and function name over the test folders.

#### 11. The registration script misreports what it changed

**Where.** `scripts/connector-registry.ts:48-77`: re-registering an existing connector without `--enable` sets it to `draft`, also when it was enabled, and writes one row, `connector.secret`, for a change of address, secret, state and manifest. `:84-91`: `setConnectorState` writes `connector.enabled` or `connector.disabled` whether or not the state changed. `:93-99`: `removeConnector` writes `connector.removed` for an id that has no row, and leaves the connector's open cards open, where the use case dismisses them in the same transaction (`admin.ts:624-642`).

**Scenario.** An operator runs `connector-add.ts hr https://new-address --secret …` to move an enabled connector. It leaves every page within seconds, and the audit log says that its secret was replaced.

**Severity: low.** An operator's tool; the audit log is what a data protection officer reads.

**Established by.** Reading.

#### 12. Current documentation still names protocols 2 and 3

**Where.** `docs/reference/connector-protocol.md:183` ("Protocol 2 also supports `document`, `record` …"), `docs/architecture/connector-protocol.md:5`, `docs/guides/authentication-overview.md:26`, `docs/guides/example-custom-directory.md:13`, `docs/guides/document-and-semantic-views.md:3`, the heading "Protocol 2 authority" in `docs/reference/status/identity.md:49`, and "protocol 3" in `docs/reference/status/connectors.md` (`:41`, `:63`).

**Scenario.** An integrator reads that documents are part of protocol 2 and declares `"protocol": 2`; the loader refuses any number but 1 (D129).

**Severity: low.**

**Established by.** `grep`. The contract itself is consistent: see Looked at and found sound.

#### 13. The check script signs for whatever audience an unregistered service names

**Where.** `scripts/connector-check.ts:81-87`, `:140-147`: without `--id` the audience is the id in the manifest the service serves, and the installation's key signs request assertions, a callback grant and the installation's own assertion (`authority.installation(audience, …)`) for it.

**Scenario.** An operator checks a service not yet registered. The service's manifest says `id: "moodle"` and declares `moodle.holdings` under `installation`. It receives an assertion of the installation, valid for two minutes, for the audience `moodle`, bound to the body `{"input":{}}` and that name: what the real Moodle connector accepts for its first page of every account's holdings. What still stands in the way is that connector's own transport key, which the service does not have, so the transport key is carrying more than "transport authentication only".

**Severity: low.**

**Established by.** Reading; `--as` is refused without `--id` (`scripts/connector-check-as.ts`), this path is not.

## Not established

- **Whether a `javascript:` address given to `window.open(…, '_blank', 'noopener')` runs in the browsers the organisation uses.** By the HTML standard the new window has an origin of its own and the address is not run. Settled by one click on a card's link action in each supported browser against a fixture source whose hit has such a link.
- **Replay inside the two minutes.** An assertion is bound to its body and capability, not to `X-Clew-Operation-Id`, and the template verifier keeps no record of `jti` (`connectors/hello/verification.mjs`). Whoever can read the traffic, which also carries the transport key, could send an approved write again under another operation id. `connectorUrl` admits plain `http` (`packages/contracts/src/index.ts:4397`). Settled by deciding whether the operation id belongs in the binding and by looking at what a real connector deduplicates on.
- **Which audiences the identity provider lets Clew's client exchange for.** Finding 1's second half depends on it. Not run against the development Keycloak; `scripts/auth-exchange-check.ts` with an audience no connector declares would show it.
- **Schema patterns a connector declares.** Clew compiles a connector's JSON Schemas and runs them on what people send; a `pattern` that backtracks badly would hold the server's one thread. Not tested.
- **An input that names a person without saying so.** D117's rule covers the declared inputs and three it infers (`packages/connectors/src/named.ts:62-71`). A read that is not `about` a person, whose rows name people (`view.subject`) and whose row opens another read with that field, is not among them, and the loader has no rule for it (`packages/connectors/src/views.ts`). Such an input reaches the source with no `about` and the source alone decides. Whether a connector in the repository has one was not checked.
- **The compiled-schema cache of the live registry.** `Registry` and `acceptsEmptyInput` (`apps/server/src/connectors/registry.ts:144-152`) keep one `Ajv` each, as finding 6's route does; they grow with manifest refreshes and tests, which an administrator bounds. Not measured.

## Looked at and found sound

**Authority (question 1).** RS256 with a 3072-bit key, sealed at rest under a purpose that names its `kid`, created and rotated in one transaction with its audit row; the public half of a replaced key is published for three minutes against a token life of two; every instance reads the row on each use. A request assertion has the connector's id as audience and cannot be a callback grant, whose audience is `clew:connector-callback` and which no connector id can equal (`authority.ts:111-135`; ids are `^[a-z][a-z0-9-]*$`). The callback (`routes/connector-callback.ts`) verifies the grant, rebuilds the person from their current access record and groups (`system-context.ts`), refuses when unit or role differ from the grant's, when the calling connector is not visible to the person, when it is one of Clew's own, and when the target is not in the grant's `uses`; then `registry.clewFor(…).call` checks the calling connector's current `uses`, the chain, and runs `invoke(…, nested)`: the target's visibility and switch for the person (`index.ts:1034-1035`), an execute refused on the capability it would run (`:1038-1039`), the scope (`:1040-1041`), the input, and who may be asked about (`:1046-1048`), with the governance and the person's authority read again before the answer is released. A callback acts as the person the grant was signed for and no one else, and reaches another connector's data only as finding 1 describes.

**Audience (question 2).** `findFor` answers a hidden capability as an unregistered one, and every listing goes through it or through `visible`: `/api/cap` (the same 404 before the input is read), `/api/connectors`, areas and figures, the menu, tools, views, systems, the search's sources, `clew.errands`, `clew.requests` and `clew.news` (sources from `errandSources` and its siblings, which ask `allowed`), the header's holder, entities (404 for every reason alike), documents, executions ("Okänd förmåga." for both) and cards (`threads/access.ts`). The connector names the assistant passes to its answer parser are escaped and reach no one. The two exceptions are findings 2 and 7.

**Who may be asked about (question 3).** Every path into a connector that carries declared keys goes through `Registry.narrow`: `/api/cap`, cards, tools, the callback, the entities module's reads (through `clewFor(…).call`), a document's bytes (asked with the narrowed input) and effect reads. The relation is read from the directory for the actor's id on every call (`modules/entities/relations.ts`, `composition/relations.ts`), not from anything the caller sends; a relation held by grant is admitted only on the person's own direct read of a core capability. A registry built without the rule sends no key. The conformance check sends keys past the rule on purpose, as its own synthetic people.

**Registration (question 4).** An address is any `http` or `https` URL: internal names and link-local addresses are admitted by design, since connectors are services inside the network, and it is an administrator with `admin.connectors` and a step-up who types it. The secret is sealed under `connector:secret:<id>`, never part of `ConnectorSummary` or `ConnectorDetail`, and not logged. "Testa anslutning" answers the administrator the Swedish `items`: structure, counts, the delegation audience and a connector's own refusal text, never an answer's content; the English log with the first hundred characters of each answer stays with the CLI. The installation's read shows counts only and never the connector's message.

**Untrusted content (question 5).** Every answer is checked against the declared output schema and the view (`index.ts:1057-1060`); the joined reads check their profile's shape and count a source out of shape as not answering; the header, the assistants' events and installation reads are checked against Clew's own schemas. A slow source ends at five or ten seconds, figures at two for the batch, the header at three. A source's text is drawn as text; a `text` view and another assistant's answer go through Astryx's `Markdown`, which builds elements from its own parser and drops unsafe link schemes. A DOCX preview is drawn in a frame with `sandbox="allow-same-origin"`, no scripts, a restrictive policy of its own and its links removed; an original is served as an attachment under `default-src 'none'; sandbox`. A draft's actions must name capabilities of the connector that pushed it, with their real kind. A manifest's `about.page`, `person.ids` and `registrar` cannot come from a remote manifest.

**Protocol 1 (question 6).** `docs/protocol/connector-protocol.schema.json` and `connector-protocol.openapi.json` equal, byte for byte, what `protocolSchema()` and `openApiDocument({})` produce at this commit (compared by command); `routes/protocol.ts` serves the same objects. The Scalar page and its script as served on the development stack have the same bytes as this commit's (`@scalar/api-reference` 1.81.0, MIT, recorded in `docs/reference/licences.md` with its licence file); loaded in a browser, scrolled and searched, the page made three requests, all to its own origin.

**Notifications, dependencies and reconciliation (question 7).** No route takes a notification from a connector: D19's ingest is proposed and not built, so there is nothing to forge or replay; a connector reaches Clew through the key set and the callback only. A scan is asked per person and only for a connector visible to them, and its cards are that person's. `composition/changes.ts` reads revision counters for the browser and takes nothing from a connector. The reconciler applies rows; governance that cannot be read denies. What a manifest change does through it is finding 3.

**Backend rules (question 8).** The only imports of `connectors/` from `apps/` or `packages/` source are the two example manifests in `routes/protocol.ts`, the exception `.dependency-cruiser.cjs` names for D60. The modules reviewed import no other module; only `connectors/registry.ts` names connectors. Every administration use case writes its audit row through the same transaction as the change, on both adapters, and the store's contract (`tests/connector-store-contract.ts`) runs on memory and PostgreSQL. `search`, `errands`, `requests`, `news` and `work` write nothing. The tests missing are finding 10.

## Seen outside this area

- Astryx's `Markdown` draws images from any address, and no page of Clew sends a content security policy: a model answer steered by a found document could carry text out in an image's address (assistant, web app).
- `POST /api/jobs/assemble` takes the fact from the browser as given and asks every bound follower about it (jobs).
- `threads/usecases/cards.ts` still holds `scanInto` over `Registry.scan`, which composition replaces with the refresh; that path calls a delegating connector without the person's token and fails whole when one connector fails (threads).
- The server has no request size limit and no rate limit on any route (platform).
- `apps/web/tests/protocol-preview-model.test.ts` imports `connectors/hr`; `bun run deps` does not cruise `apps/web` (baseline).
