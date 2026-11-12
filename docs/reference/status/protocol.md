# Implementation status: connector protocol and registration

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Manifest preview

**Works in this checkout.** `/protocol/preview`, public: an integrator pastes a manifest or chooses its file, the page posts it to the dry run and draws every problem placed in the document with its rule, where each capability about an entity shows, who would see it there, and the row mark, the section and the menu drawn with Clew's components from sample rows. Under them, "Every write, both halves" ([D112](../../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 11, board Entrypoints): for each propose and execute, from the dry run's `path`, where a person can start it (the person is…, you declare, Clew draws, this capability's state), what the person passes through (each step, what declares it, how it is drawn, its state) and its input as the person will meet it (property, schema, filled by, drawn as); tables on a wide screen, lists on a phone. The board's row for actions on a view's rows is a proposal and is not drawn.

**Limits and pending work.** The samples are made from the declaration and nothing is called: it proves the declaration, not the source. Browser specs on a desktop and at 320 px; the scenario for the write sections (over the HR fixture's manifest) was written on 2026-11-11 and passed on 2026-11-12; no screen-reader pass.

**Evidence.** [Page](../../../apps/web/src/pages/protocol-preview.tsx), [dry run](../../../packages/connectors/src/preview.ts), [served protocol tests](../../../tests/unit/protocol-served.test.ts), [model tests](../../../apps/web/tests/protocol-preview-model.test.ts), [browser scenarios](../../../tests/a11y/protocol.spec.ts)

## What a write asks and what it says it will do

**Works in this checkout.** The server and protocol half of [D112](../../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) items 10 and 11. A propose or execute may declare `asks` (a closed list of kinds: `meeting`, `text`, `long-text`, `date`, `choice`, each naming one property of its own input) and an execute an `effect` (a `model: false` read of the same connector with the same input, answering an `EffectOutput`). The loader refuses an ask on a read or a follower, an ask that names no property, the entity's key or a property of the wrong type, an optional ask for a required property, an action about an entity that requires something it does not ask, and an effect that is not such a read; the dry run places each refusal. A draft whose propose or execute leaves a required property to nobody is refused at the scan. Every card action and entity action the API answers carries its `path` (the asks it meets, whether it has an effect, its description), resolved from the registered manifest on every read. `POST /api/threads/:id/effect` and `POST /api/entities/:kind/:key/effect` run the effect read as the person and write nothing; `GET /api/asks/times` answers three free times of the ask's length from the person's own calendar (`calendar.freeTimes`, never a tool) and their day. The human decision (`POST /api/threads/:id/act`) takes `values`, refuses an answer to anything not asked, a required answer left out and an answer that does not fit its kind, and puts the answers in the approved intent and in the `execution.approved` audit row of the same commit. The dry run's capabilities carry `path`: where a write can start, which steps it draws, who fills each input property. The HR fixture's `hr.bookTalk` asks for the time, the place and a message and declares `hr.bookTalkEffect`; `hr.decideLeave` asks for an optional comment.

The web half: one action dialog (`apps/web/src/components/action-dialog.tsx`, Astryx's `form-wizard-dialog`) opens for every action whose `path` asks something or has an effect, from the work item in Att göra, the panel, the item's page and the phone's pinned bar, from a person's or a unit's page and from the row menu on Personal. "Uppgifter" draws one Astryx field per ask (a meeting as up to three free times with "Annan tid" and the person's own day drawn by the calendar family and said in words), "Det här händer" the values and the effect read's rows with `undoMinutes`, re-read when the values change, or the system's name and the description; nothing is sent before the last button. A path that requires nothing opens at "Det här händer" (two presses for "Godkänn" with its optional comment). A refusal is placed on the field whose label it starts with, else at the top of the step, with the focus there; ✕, Esc and Avbryt send nothing and give the focus back, and the values stay while the work item is open. An execute about an entity starts its work item beside the page and opens the dialog on its `decide` action; a propose about one that asks is filled in first and starts with the answers. After sending, the receipt and Ångra are the work item's as for any decision. A write with neither asks nor an effect stays one press.

**Limits and pending work.** Free times come from the person's own calendar only (no free-busy of the employee), and a meeting time is written to the source system only, never to a calendar. The answers are in the audit row as given; a source that asks for something sensitive in free text puts it there. The `path` does not carry a property's `maxLength`, so a text area shows no counter and a text too long is refused when sent, on its field. The question box's suggestion does not open the dialog yet; an assistant's draft does, at its last step with "Granska och …" and at its first with "Ändra" ([the panel](interface.md#the-panel-and-the-assistant-beside-a-thing)). A `confirm` on an action that opens the dialog is shown on its last step, not asked in a second dialog. The web unit tests (`apps/web/tests/action-path.test.ts`) and the server scenarios pass in `bun run check`, and the store's `history` passes its contract on both adapters. On 2026-11-11 the server half was exercised over HTTP against the development stack, signed in as a manager through the local Keycloak: the thread list carried the `path` of "Boka samtalet", `GET /api/asks/times` answered three free times and the chosen day, the effect read answered the talk's row and wrote no audit row, the decision with values wrote `details.asked` in `execution.approved`, the receipt read the time and the place back with Ångra, the undo removed the talk from the source, and Händelser listed both. The browser scenarios (`tests/a11y/action-dialog.spec.ts` and the updated specs) passed on routed data on 2026-11-12; in one of about ten runs of "by keyboard alone" Escape did not close the dialog, cause not found. The dialog has not been driven in a browser against the stack. No screen-reader pass.

**Evidence.** [Action dialog](../../../apps/web/src/components/action-dialog.tsx), [its pure part](../../../apps/web/src/action-path.ts) and [tests](../../../apps/web/tests/action-path.test.ts), [browser scenarios](../../../tests/a11y/action-dialog.spec.ts), [asks and answers](../../../packages/connectors/src/asks.ts), [loader rules](../../../packages/connectors/src/validation.ts), [card decisions](../../../apps/server/src/threads/usecases/decisions.ts), [meeting times](../../../apps/server/src/threads/usecases/asks.ts), [free slots](../../../packages/calendar/src/proposals.ts), [scenario tests](../../../tests/unit/action-path.test.ts), [property test](../../../tests/unit/proposals.property.test.ts), [manifest rules](../../../tests/unit/manifest-reference.test.ts), [placed problems](../../../tests/unit/protocol-served.test.ts)

## Remote connectors

**Works in this checkout.** Manifest, capability calls, optional scan/figure and database registration. Governance refreshes reuse unchanged descriptors; manifest, address or secret changes rebuild them. Overlapping fresh reads coalesce without reusing a snapshot taken before a final access check.

**Limits and pending work.** No published production distribution or standalone checker image is established by these docs. "Hämta manifest igen" (`refreshManifest`) compares the stored and the fetched manifest as JSON text, and PostgreSQL's `jsonb` reorders an object's keys, so against the database every capability is listed as changed and the two are never "the same", even right after the new manifest was applied (seen on the development stack on 2026-11-11); the added and removed capabilities are right.

**Evidence.** [Transport](../../../packages/connectors/src/remote.ts), [admin use cases](../../../apps/server/src/connectors/usecases/admin.ts)

## Served protocol

**Works in this checkout.** `/api/protocol`: OpenAPI 3.1 and JSON Schema generated from the validating code, a RapiDoc page from the image, a manifest dry run that shares descriptor rules and schema compilation with registration and lists problems or what Clew would make of the document, and the manifest field by field with examples and rules at `/protocol/manifest`, drawn by the web app from `/api/protocol/manifest-reference.json` (also [committed](../../generated/manifest-reference.md)).

**Limits and pending work.** The viewer page is outside the WCAG suite; versioning beyond 2 is a written policy (accept N and N-1, retire only for security), not yet an exercised code path, since no 3 exists.

**Evidence.** [Routes](../../../apps/server/src/routes/protocol.ts), [preview](../../../packages/connectors/src/preview.ts), [tests](../../../tests/unit/protocol-served.test.ts), [D60](../../decisions/D60-the-instance-serves-its-connector-protocol.md)

## Cross-connector dependencies

**Works in this checkout.** Exact string targets in `uses`, enforced calls and output validation.

**Limits and pending work.** No `deprecated` field, semantic compatibility classifier, dependent health UI or checker `--clew` option. The D37 dependency document is a proposal with a different example shape.

**Evidence.** [Registry](../../../packages/connectors/src/index.ts), [schema](../../protocol/connector-protocol.schema.json), [D37 dependencies](../../decisions/D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md)

## Change notifications

**Works in this checkout.** Scans and source reads are available.

**Limits and pending work.** D19's CloudEvents ingest route/event log is proposed, not a supported connector endpoint.

**Evidence.** [D19](../../decisions/D19-change-notification-is-a-clew-owned-contract.md)

## Search

**Works in this checkout.** Composite search, `<id>.search`/`<id>.fetch`, citations and source budgets.

**Limits and pending work.** The broader D26 proposal is not a claim that every proposed answer shape or source exists.

**Evidence.** [Search module](../../../apps/server/src/modules/search), [tests](../../../tests/unit/search.test.ts)

## External agent MCP

**Works in this checkout.** Design intent only; SCIM moved to the Users and identity row.

**Limits and pending work.** No supported Clew MCP server or enterprise ID-JAG flow is established in this checkout. The development sign-in ([D6](../../decisions/D06-dev-login-local-only.md), amended 2026-11-11) is built as a list of personas on the sign-in page, through the local Keycloak.

**Evidence.** [Identity design](../../architecture/identity.md), [D5](../../decisions/D05-oidc-and-oauth-only-identification-path.md), [D6](../../decisions/D06-dev-login-local-only.md)
