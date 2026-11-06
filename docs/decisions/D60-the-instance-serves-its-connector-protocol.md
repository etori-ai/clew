# D60 · The instance serves its connector protocol, and a protocol break keeps the number before it

**Status:** accepted, built 2026-11-06 · **Date:** 2026-11-06 · **Area:** integrations

**Decision.** A running Clew publishes the connector protocol it speaks, generated from the objects it validates with,
under `/api/protocol`, public and without a session. There is no Clew SDK (D21 stands); what an integrator builds
against is the instance they will register with.

1. **Four routes, one source.** `GET /api/protocol/connector-protocol.schema.json` is the JSON Schema bundle
   (`protocolSchema()`); `GET /api/protocol/openapi.json` is an OpenAPI 3.1 document (`openApiDocument()` in
   `packages/connectors/src/protocol.ts`) whose `components.schemas` are those same TypeBox schemas and whose paths are
   both sides of the protocol: the routes a connector serves and Clew calls (tag Connector, server variable
   `{connector}`), and the routes Clew serves and a connector calls (tag Clew: the public keys, the callback, this
   protocol; server = the installation's `PUBLIC_URL`, else the origin the request came in on).
   `POST /api/protocol/manifest` is a dry run: a manifest document in, and out comes every problem the loader would
   refuse it for, else what Clew would make of it (`previewManifest` in `packages/connectors/src/preview.ts`): who may
   call what, what the model is offered, which views could be rows in the menu (D40), what the conformance check would
   and would not exercise. `GET /api/protocol` draws the OpenAPI document. The routes live in
   `apps/server/src/routes/protocol.ts`, mounted before the readiness guard, so they answer while the database is still
   coming up. The same two documents are committed under `docs/protocol/` by `bun run docs:generate`, and
   `docs:check` and the unit suite hold them equal to the code.
2. **The viewer is RapiDoc, served from the image.** `rapidoc` 12.0.0 (MIT) is a dependency of `apps/server`; its
   bundle is served at `/api/protocol/viewer.js` from `node_modules`, never from a CDN, with `load-fonts="false"` so
   the page fetches nothing outside the installation. It is a developer page outside the product: the Astryx-only rule
   (CLAUDE.md) governs what a person meets in Clew, and this page is met by an integrator with a terminal open. It is
   the second sanctioned exception after D27 and, like it, named here. Swagger UI and Stoplight Elements were not
   chosen because both pull `@scarf/scarf`, an install-time analytics package; Redoc because it pulls
   `@redocly/redoc-opentelemetry`; Scalar because it brought 249 packages for one page. The page is English, as
   documentation is. It is read-only (`allow-try="false"`): RapiDoc's request forms have unlabelled inputs, and the
   document is there to be read and handed to a client or generator of the integrator's choice, not to be a client.
   The page carries four lines of its own: RapiDoc's host `min-width: 360px` set to 0 so the page reflows at 320 px
   (WCAG 1.4.10), its `label-operation-path` part given a colour that keeps 4.5:1 and wrapping, and a script that
   names each request-body example textarea by its operation (RapiDoc draws them without a label). With those, axe
   (WCAG 2.0 to 2.2 AA tags) reports no violation on the live page, the page makes no request outside the
   installation, and `scrollWidth` at 320 px is 320.
3. **Every problem is listed.** `manifestProblems` in `packages/connectors/src/remote.ts` returns the schema's errors
   one per path and then every rule between fields (id prefix, execute never a tool, views, menu, standing names);
   `parseManifest` throws on the same list, so the loader, the checker, the admin page and the dry run cannot disagree.
   A protocol number that is retired or unknown is named as such, with the accepted numbers and the retirement's reason,
   rather than as "Expected 2".
4. **Versioning.** `protocol` in a manifest is the version of this contract, not of the connector: D37 settled that a
   connector has no version and a capability's name is its contract, and this decision does not reopen it. The policy
   for the number itself, which D37 referred to and nothing had written down:
   - An additive change (a new optional field, a looser constraint, a new `$def`) keeps the number. Views (D38), the
     menu (D40), delegation (D26), facts and followers (D55) all arrived under 2, correctly.
   - A break (a removed or renamed field, a new required one, a changed meaning) is a new number N. Clew then accepts
     N and N-1 for a stated window of at least one release: `PROTOCOL_ACCEPTED` in `protocol.ts` lists both, the
     manifest literal becomes a union, and the loader normalises an N-1 document to N in one adapter function. A
     connector on N-1 shows in Administration › Anslutna system with health `warn` and the window's end, never as
     refused, and the conformance check says the same. The window closing is a decision of its own.
   - The one exception is a security change, which retires the old number at once with its reason recorded in
     `PROTOCOL_RETIRED`. That is what happened to 1 on 2026-11-05 (shared-secret identity signing replaced by RS256
     installation keys, D44), and it was right; it is now the documented exception rather than the unwritten rule.
   - The served documents carry `x-clew-protocol: { current, accepted, retired }`, so an integrator can see what
     their instance loads without reading the repository.
5. **The manifest, field by field** (added 2026-11-06, same day). OpenAPI is organised by route, and the manifest is
   not a route but a configuration document; what an integrator asks of it is "what may go here, and with what". So
   the web app draws it at `/protocol/manifest`, public like the login, from `GET /api/protocol/manifest-reference.json`
   (the old `/api/protocol/manifest-reference` address redirects there), and the repository commits
   `docs/generated/manifest-reference.md`: one entry per field in the style of a `tsconfig` reference, with what the
   field does in the product, its type, presence and constraints in words, an example cut from the hello or phone
   book manifest (a handwritten one, loaded by a test, where neither uses the field), and "pairs with", the rules
   between fields. `manifestReference()` in `packages/connectors/src/reference.ts` walks `ConnectorManifestSchema`,
   so a field cannot be documented that does not exist and a field without a description fails the unit suite; the
   rules are prose in `RULES`, each loader rule proven by a test that breaks it and reads the loader's problem, each
   registry rule by the registry refusing it. Three recipes open the page: a read that can be a menu tool, a scan
   that becomes cards, and work across connectors (a fact, two followers answering with an execute and a watch, the
   envelope and the answers, one approval). A recipe that holds a schema has two tabs, JSON and TypeBox: the TypeBox
   source is generated from the JSON by `typeboxModule()` in `reference.ts`, and a test runs it with TypeBox and
   compares the schema it emits with the JSON it came from. The page says why: on the wire a schema is JSON Schema,
   written in a schema library (TypeBox, zod, Pydantic) and emitted, never by hand; a shorter dialect of Clew's own
   was weighed and left, since it would be a second schema language for every verifier and generator to learn. The descriptions were written into `protocol.ts` and the view
   schemas in `packages/contracts`, so the OpenAPI document and the dry run's errors improved with them. The page is
   Astryx, not RapiDoc and not hand-written HTML (the product owner asked for one look across Clew after a first
   hand-written version cut its own sidebar short): Astryx's `documentation-technical` template, the article in one
   column with an `Outline` of every heading in a sticky `LayoutPanel` at its start, the left, at a reference's width of 1280 rather than a form's (the product owner's two corrections on the first rendering; the template's own inline panel
   style, given a `maxHeight` so an outline of seventy entries scrolls on its own) and a `Selector` in its place on a
   phone; `Heading`, `Markdown`, `MetadataList` and `CodeBlock` draw the entries, and the rules are Markdown lists because a `ListItem` keeps to one line. The outline names a field by
   its last part, indented by depth, and the heading carries the full path, so nothing is cut off; a `TextInput` above
   it narrows the outline to the headings whose path or name holds the text, named by path, with the count spoken. It is English, the
   document's language set while it is shown (3.1.2), and inside the WCAG suite: `tests/a11y/protocol.spec.ts` runs
   axe on a desktop and at 320 px with the reference the server really builds. Examples come from the repository's
   two example connectors only, never from a registered connector: the page is public. `Outline` and `CodeBlock` are
   re-exported from `packages/ui` for it.

**Why.** The product owner asked, on 2026-11-06, for an interface of the OpenAPI kind, something visual an
integrator can open or point a tool at, that makes the manifest's possible values and combinations graspable while
engineering, and asked that it ship with the Clew image so it matches the instance rather than a published SDK with
its own versions to keep. Before this, the schema bundle lived only in the repository, so an integrator reading `main`
while their municipality ran an older image was already out of sync; and `parseManifest`'s rules were reachable only
with the checkout (`docs:smoke`), a deployed connector plus the installation's database and master key
(`connector-check.ts`), or an administrator's grant and a registration (`Testa anslutning`). Nothing took a manifest
document and said what Clew would do with it. The second question was whether manifests should be versioned so that
a breaking capability does not fail every connector on update; the answer is in item 4: the version is the protocol's,
the number already exists, and what was missing was the written rule that a break keeps N-1 loadable.

OpenAPI describes a server, and most of this protocol is the server the integrator implements rather than one they
call; that is a normal use of the format (server-stub generators exist for most languages) and the document says so
in its description. The two Clew-side routes a connector does call are in the same document, so it is honest about
both directions.

**Replaces.** Nothing. D21 (no SDK), D37 (no connector version; the name is the contract) and D44 (protocol 2
rejects 1) stand; the "Versioning" section D37 refers to is item 4 here. The WCAG suite (D51) does not cover the
viewer page: it runs against the web app with `/api` mocked, and the page is RapiDoc's, not Clew's. The axe run above
is a one-off against the live page (HANDOVER.md says how); a RapiDoc upgrade repeats it before landing.
