# telefonbok: the organisation's phone book as a Clew connector

A pass-through connector with reads only. It is the reference for two things in the connector protocol
(`docs/architecture/connector-protocol.md`): a **search source for people** (D26) and **declared views** (D38), where
the connector says what its output holds and Clew draws it. The walkthrough is
`docs/guides/example-custom-directory.md`. No dependencies beyond Node; nothing here imports the rest of the repository.

| File | Holds |
|---|---|
| `connector.mjs` | The manifest (capabilities, their views, the area), the assertion check and the capability bodies |
| `directory.mjs` | The phone book behind a port: the HTTP adapter, the mapping `toPerson`, and a made-up organisation |
| `server.mjs` | Serves it over HTTP and reads the configuration |

## What a person gets

| Capability | Shown as | Notes |
|---|---|---|
| `telefonbok.directory` "Sök i telefonboken" | A table with a search field and a choice between the whole organisation and the person's own unit | 50 rows at most |
| `telefonbok.team` "Mitt teams kontaktlista" | A list of everyone on the person's unit | The unit is the one in Clew's assertion |
| `telefonbok.person` "Kontaktkort" | One colleague: title, unit, phone, mobile, e-mail, room, manager, link out | Opened from a row or a search hit |
| `telefonbok.search`, `telefonbok.fetch` | The composite search's hits | A hit says who and where, not the number |

The area `Kontakter` lists the team list and the search as standing actions, so both are chips under the box for
everyone in the connector's audience. Everything works without a model. With a model, the views say
`modelReads: "summary"`: the model is told how many rows are shown to the person, never who or which number.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `PORT` | Default 4020 |
| `TELEFONBOK_ADAPTER` | `fixture` (default, the made-up organisation) or `http` |
| `TELEFONBOK_URL`, `TELEFONBOK_API_KEY` | The phone book API and its integration key, for `http`. The key comes from a secrets store and stays in this container; Clew never sees it |
| `TELEFONBOK_UNIT_MAP` | Optional JSON object, Clew unit id to the phone book's unit id, where they differ |

## The phone book API

The real API's shape is not confirmed. The HTTP adapter assumes:

```
GET {TELEFONBOK_URL}/persons?q=<text>&unit=<unit id>&limit=<n>   -> { "persons": [ … ] }  (or a bare array)
GET {TELEFONBOK_URL}/persons/{id}                                -> one record, 404 when unknown
header x-api-key: <TELEFONBOK_API_KEY>
```

and a record with `id`, `name` (or `givenName` and `familyName`), `title`, `unit: { id, name }` (or `unitId` and
`unitName`), `phone`, `mobile`, `email`, `room`, `manager.name` (or `managerName`), and `protected` or `hidden` for a
record that must not be shown. `toPerson` in `directory.mjs` is the one function to change when the real shape is
known; `tests/unit/telefonbok-connector.test.ts` holds a recorded answer to change with it. A search must match every
word of the question; the fixture does, and an API that matches any word would add noise to Clew's composite search.

## What it never does

It does not store anything, write to the phone book, push cards, or pass on the phone book's own error text. A
protected record is dropped in `toPerson`, before any capability sees it. Private fields (home address, personal
number) are not mapped, so they cannot cross.

## Run and check

```sh
TELEFONBOK_SECRET=<16+ characters> docker compose -f connectors/telefonbok/compose.yaml up telefonbok
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://host.docker.internal:4020 --id telefonbok --secret <the secret>
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts telefonbok http://host.docker.internal:4020 --secret <the secret> --enable
```

Node's official image is MIT. The connector has no other dependency.
