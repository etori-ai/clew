# phonebook: the organisation's phone book as a Clew connector

A pass-through connector with reads only. It is the reference for two things in the connector protocol
([protocol reference](../../docs/reference/connector-protocol.md)): a **search source for people** (D26) and **declared views** (D38), where
the connector says what its output holds and Clew draws it. The walkthrough is
[the integrator walkthrough](../../docs/guides/example-custom-directory.md). No dependencies beyond Node; nothing here imports the rest of the repository.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: shared schemas, one named block per capability with its input/output and view, and the area |
| `connector.mjs` | Read operations, response mapping, the assertion check and HTTP error handling; also exports the manifest |
| `directory.mjs` | The phone book behind a port: the HTTP adapter, the mapping `toPerson`, and a made-up organisation |
| `server.mjs` | Serves it over HTTP and reads the configuration |

To change how the directory is shown, start with `directoryCapability` in `manifest.mjs`. Its `view.kind: 'table'`
chooses a table, `view.fields` chooses the columns, and `view.input` declares the search and unit controls. The team
and contact card have their own blocks (`teamCapability` and `personCapability`). To change source field names,
adapt `toPerson` in `directory.mjs` instead.

## What a person gets

| Capability | Shown as | Notes |
|---|---|---|
| `phonebook.directory` "Sök i telefonboken" | A table with a search field and a choice between the whole organisation and the person's own unit | 50 rows at most |
| `phonebook.team` "Mitt teams kontaktlista" | A list of everyone on the person's unit | The unit is the one in Clew's assertion |
| `phonebook.person` "Kontaktkort" | One colleague: title, unit, phone, mobile, e-mail, room, manager, link out | Opened from a row or a search hit |
| `phonebook.search`, `phonebook.fetch` | The composite search's hits | A hit says who and where, not the number |

The area `Kontakter` lists the team list and the search as standing and names the icon `phone`, so both views carry
the area's word and icon (D71) and the area is a choice in Hem's area filter, for everyone in the connector's
audience. Both views open without input, so an administrator can put either or both in Clew's menu under Verktyg (D40; the
connector's page, Områden, "Verktyg i menyn"). The manifest names their rows: "Telefonbok" for the search and "Mitt
team" for the team list. Everything works without a model. With a model, the views say
`modelReads: "summary"` on the directory/team/contact views: the model receives a summary/count for those views. Search hits and fetch results can still include names and context; this is not a global redaction rule.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks` for protocol 2 verification. Required; HTTPS outside the explicit local development allowlist |
| `PORT` | Default 4020 |
| `PHONEBOOK_ADAPTER` | `fixture` (default, the made-up organisation) or `http` |
| `PHONEBOOK_URL`, `PHONEBOOK_API_KEY` | The phone book API and its integration key, for `http`. The key comes from a secrets store and stays in this container; Clew never sees it |
| `PHONEBOOK_UNIT_MAP` | Optional JSON object, Clew unit id to the phone book's unit id, where they differ |

## The phone book API

The real API's shape is not confirmed. The HTTP adapter assumes:

```
GET {PHONEBOOK_URL}/persons?q=<text>&unit=<unit id>&limit=<n>   -> { "persons": [ … ] }  (or a bare array)
GET {PHONEBOOK_URL}/persons/{id}                                -> one record, 404 when unknown
header x-api-key: <PHONEBOOK_API_KEY>
```

and a record with `id`, `name` (or `givenName` and `familyName`), `title`, `unit: { id, name }` (or `unitId` and
`unitName`), `phone`, `mobile`, `email`, `room`, `manager.name` (or `managerName`), and `protected` or `hidden` for a
record that must not be shown. `toPerson` in `directory.mjs` is the one function to change when the real shape is
known; `tests/unit/phonebook-connector.test.ts` holds a recorded answer to change with it. A search must match every
word of the question; the fixture does, and an API that matches any word would add noise to Clew's composite search.

## What it never does

It does not store anything, write to the phone book, push cards, or pass on the phone book's own error text. A
protected record is dropped in `toPerson`, before any capability sees it. Private fields (home address, personal
number) are not mapped, so they cannot cross.

## Run and check

Follow [the runnable walkthrough](../../docs/guides/example-custom-directory.md#run-the-fixture-as-a-service) for the service, checker and draft registration commands. Both the transport secret and a valid RS256 assertion are required on every POST; the secret cannot sign identity. The connector uses the verified actor, never the request body's identity. [Authorization](../../docs/guides/authorization.md) explains source access and key rotation.

For a check without any running Clew services:

```sh
docker exec -w /workspace clew-app-1 bun run docs:smoke
```

After a change to the manifest, restart the connector and press "Hämta manifest igen" on its page in Administration.

Node's official image is MIT. The connector has no other dependency.
