# Add search and views: the phone book

The [phone book connector](../../connectors/phonebook/connector.mjs) is a complete read-only integration: a directory search, the person's team and one contact card. It has no workspace dependency and uses a synthetic organization until a real API is configured. Start with the [quickstart](creating-a-connector.md) to run its signed fixture exchange.

## Read the implementation in this order

| Source | What to adapt |
|---|---|
| [Generated manifest](../generated/phonebook.manifest.json) | Complete schemas, capabilities, views and menu hints. Generated from `connector.mjs`. |
| [manifest.mjs](../../connectors/phonebook/manifest.mjs) | Shared schemas and one named block per capability: input, output, view and menu hint. `directoryCapability.view.kind` chooses the table and `view.fields` its columns. |
| [directory.mjs](../../connectors/phonebook/directory.mjs) | `createFixtureDirectory`, `createHttpDirectory` and `toPerson`: source access and mapping. |
| [connector.mjs](../../connectors/phonebook/connector.mjs) | Read operations, verified actor, unit mapping, input checks and response mapping; exports the manifest from `manifest.mjs`. |
| [verification.mjs](../../connectors/phonebook/verification.mjs) | Protocol 2 identity and transport checks. |
| [server.mjs](../../connectors/phonebook/server.mjs) | HTTP service and environment configuration. |
| [Connector tests](../../tests/unit/phonebook-connector.test.ts) | Search, protected records, unit scoping and recorded HTTP responses. |

## The five reads

| Capability | Input | Purpose |
|---|---|---|
| `phonebook.directory` | Optional `query`, optional `scope` (`all` or `unit`) | Table with a query control and an organization/unit choice. |
| `phonebook.team` | Empty object | List for the verified actor's unit. |
| `phonebook.person` | `ref` | Contact detail, opened from a row. |
| `phonebook.search` | `query` | Person hits for Clew's composite search. |
| `phonebook.fetch` | `ref` | Resolve a hit again when used as conversation context. |

The input/output schemas in the generated manifest are authoritative. The fixture uses `person:<id>` refs. Another connector must define its own stable ref scheme and reject unknown or unauthorized refs on every lookup.

## Declare the view beside the read

A `view` describes meaning, not layout. The directory is a `table`; the team is a `list`; the contact card is a `detail`. Fields name output properties and Swedish labels, with formats such as `phone` and `email`. `input.query` and `input.filter` bind controls to the capability's input schema. `open.params` maps the chosen row's fields into another read of this same connector.

Clew renders the same declaration in a panel, below an answer and, if selected by an administrator, on a tool page; [Where things open](where-things-open.md) says which opens where. A read with a view and no required input can be offered under Verktyg. Its optional `menu` supplies a short label and icon; it does not publish itself in the menu. No frontend code is needed for another connector using these supported view kinds.

The view rules live in [views.ts](../../packages/connectors/src/views.ts); the renderer is [view.tsx](../../apps/web/src/components/view.tsx). The schema currently supports `table`, `list`, `detail` and `text`. A text view names a Markdown string property; this is content, not an HTML app or a layout extension.

## Control what reaches the model

The directory, team and contact views use `modelReads: "summary"`. The tool still reads the data for the person's view, but the model receives a summary/count instead of the rows. This applies to that capability's view handling. It is not a global redaction policy: audit what search hits, fetches, other capabilities and user-entered text can disclose as well.

The phone book's search hit includes a label and context, with no phone number. The source adapter drops protected/hidden records and maps only work fields; it does not map home addresses or personal numbers. The source must still enforce the correct access for the acting person. A service credential cannot substitute for that policy.

## Join composite search

Implement `<id>.search` as a `read` returning `$defs.SearchOutput`, and `<id>.fetch` to retrieve a `$defs.SearchHit` by ref. Declare `kinds` to identify which kinds of objects your search can find. Use the [schema](../protocol/connector-protocol.schema.json) for required fields and nullability rather than inferring a new shape from this guide.

Clew's [search use case](../../apps/server/src/modules/search/usecases.ts) asks eligible sources concurrently, validates their results and reports missing sources. A source's own search is also callable directly. Do not assume the composite's timeout means the source has no matching records.

## Run the fixture as a service

With the [local Clew stack](../maintainers/local-development.md) running, use a development-only transport key:

```sh
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 -e PHONEBOOK_ADAPTER=fixture clew-app-1 node connectors/phonebook/server.mjs
```

Leave that process running. In another terminal:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4020 --id phonebook --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts phonebook http://127.0.0.1:4020 --secret local-docs-only-transport-key
```

The second command creates or updates a **draft** registration. In Administration → Anslutna system, choose its audience, review the check and enable it. Select Telefonbok and/or Mitt team as menu tools. These commands reuse the id `phonebook`; use a disposable development installation or an intentionally chosen registration.

To connect a real source, set `PHONEBOOK_ADAPTER=http`, `PHONEBOOK_URL`, `PHONEBOOK_API_KEY` and, if needed, `PHONEBOOK_UNIT_MAP`. The assumed `/persons` API in the adapter is a demonstration, not a confirmed Metakatalogen API. Update the adapter and recorded response tests before enabling real access.

## Verify the adaptation

```sh
docker exec -w /workspace clew-app-1 bun test tests/unit/phonebook-connector.test.ts tests/unit/views.test.ts tests/unit/search.test.ts
```

Exercise a query with required input, the unit filter, an unknown ref, a protected record and source failure. These supplement the conformance check, which skips reads that require input. [View accessibility tests](../../tests/a11y/views.spec.ts) and [tool-page tests](../../tests/a11y/tools.spec.ts) cover Clew's rendering; new UI behavior follows the [maintainer testing rules](../architecture/testing.md).
