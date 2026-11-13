# servicedesk: a generic IT service desk, as a fixture connector

A municipality's IT service desk as the development stack and the unit suite meet it: what a person ordered or
reported and waits for, an order placed for a person from the desk's catalogue, and the equipment the desk has
registered to a person. A kind of system, not a product (D52); every request and device is made up. An independent Node
service behind the connector protocol that imports nothing from the rest of the repository (D21); the shape is
[incidents](../incidents/README.md)'s, with the same store and switches.

It is the first connector to answer the requests profile (D123): Clew lists its `servicedesk.requests` with every other
such read as `clew.requests`, "Beställningar och felanmälningar" on Hem.

The development stack's boarding layers (D124, `scripts/boarding-development.ts`) name two of its capabilities as what an
item is done with: `servicedesk.order` with the catalogue's item (`servicedesk.order?item=laptop`, `access-card`,
`system-access`), which the item's row on a plan starts for the plan's person on the same path the person's page uses,
and `servicedesk.equipment`, which the row of "Lämna tillbaka utrustning" opens with the person. The names are data in a
layers file; nothing of Clew imports the connector, and an order placed does not tick the item.

## Capabilities

| Capability | Kind | What |
|---|---|---|
| `servicedesk.requests` | read, the `requests` profile | The asking person's own orders and fault reports as `RequestRow`s: open ones and those closed in the last 30 days. Input `{}`. The label is the desk's number and the type ("SD-26110041 · Dator, Beställning"), never a subject, a description or a name. A row opens `servicedesk.request`. |
| `servicedesk.request` | read, detail | One request with its free text (subject, description, the desk's latest note), the person's own only; anyone else's is not found. `model: false`, opens in the panel. |
| `servicedesk.order` | execute, about a person | Orders a laptop, a phone, an access card or access to a system for the person: the caller themself, or a direct report of a manager (`person.admits: ['self', 'managed']`, D117). Asks what (a choice) and an optional message. Deduplicated by Clew's operation id and read back through `servicedesk.lookup` (D45); the desk also files the order under the operation id. The request is the caller's: it shows in their list and on their cards, and records who it is for by user name. |
| `servicedesk.orderEffect` | read | "Det här händer": what is ordered, for whom ("till dig", "till medarbetaren"), which group handles it and the day it is expected. Checked as the order is, written nowhere. |
| `servicedesk.lookup` | read | The read-back of an order by operation id, for the person who made it. |
| `servicedesk.person` | read, about a person | One row per key: how many devices are registered to the person, and how many orders for them are not delivered. Read about oneself, every such order counts; read by anyone else (a manager), only the orders someone else placed on the person's behalf, never what the person ordered for themself. A section on the opened person; its row opens the equipment. |
| `servicedesk.equipment` | read, list | The devices registered to one person: type, model, inventory number, since when. |

The area `it-service` ("IT-service") is everyone's. The scan gives one card per open request the person made: waiting on
"IT-servicedesken" while it is the desk's move, the person's own work when the desk waits for them (it asked something,
or a delivery is ready to collect), due on the day the desk expects it, with "Se beställningen" or "Se felanmälan" as its
one action. A card for an order placed for someone else names that person by key (`subject`), never by name. Every scan
is a complete observation, so when the desk closes a request its card resolves.

Who may be asked about is Clew's (D117): the order, its effect, the summary and the equipment answer only a person the
verified request's `about` vouches for as the caller themself or a manager's direct report. What a person made is
theirs: the list, one request and the read-back answer the caller and nobody else. The desk knows a person by their
directory user name (`actor.userName`); a caller without one is refused ("IT-servicedesken känner inte igen dig."): the
list and the scan answer a failure, never an empty list or a complete scan of nothing, which would say that they ordered
nothing and resolve every card they have, and an order is refused.

## The source port

`desk.mjs` is the port and the one place the desk's records become Clew's rows. The port speaks the desk's own records,
envelopes `{ Type, Data, Memo }` as a typical service-desk API answers them: a case (`Service Request` for an order,
`Incident` for a fault report) with its number, status, category, responsible group, the contact it is for, the requester
who made it and the requester's description in `Memo`, and configuration items with an inventory and a serial number.
`listRequests`, `getRequest`, `createRequest`, `findByReference`, `listEquipment` and `catalogueItem` answer promises;
the in-memory fixture over the connector's store is the only implementation, and a real desk is another one passed as
`createConnector({ desk })`. `STATUSES` says what each of the desk's statuses means for the person who waits.

The seeded records (`fixture.mjs`) are relative to the day the store is seeded, for the development directory's people:
Hillevi (a manager) has an order for Anna on its way, a fault report the desk waits on her for, a new request and a phone
delivered two days ago; Anna a fault report being handled; Hassan a phone ready to collect and a solved fault report;
Mikael a request being handled. Each of them, Erik, Maria, Johan and Karin has two to four devices.

## Moving a request forward

A real desk moves its requests itself. The fixture has a route of its own for that, outside the protocol and behind its
key, as the HR fixture's feed is: `POST /fixture/requests/<number>` with `{ "to": "active" | "waiting-on-me" | "closed" }`
and the header `x-fixture-key`. Without `FIXTURE_KEY` the route answers 401. In the development stack:

```sh
docker exec clew-app-1 curl -s -X POST http://servicedesk:4054/fixture/requests/<number> \
  -H 'x-fixture-key: clew-dev-only-servicedesk-key' -H 'content-type: application/json' -d '{"to":"closed"}'
```

`<number>` is the desk's number as the list and the card show it (`SD-…`); the key is the development stack's
`CLEW_DEV_SERVICEDESK_KEY`, a key of its own (never the HR feed's, which carries health data). A number that is not a
valid path segment answers 400. The answer is the request's new state and status. After a closing
move the next scan no longer has the request's draft, and its card on Hem resolves; after `waiting-on-me` the card is the
person's to act on.

## Running it

In the development stack it is the compose service `servicedesk` on port 4054, and `bun run dev:connectors` registers
and enables it. To run a separate instance inside the app container (the keys and the SQLite file are for local
development only):

```sh
docker exec -w /workspace -e PORT=4154 -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 \
  -e FIXTURE_DB=/tmp/servicedesk-standalone.sqlite -e FIXTURE_KEY=local-docs-only-fixture-key clew-app-1 node connectors/servicedesk/server.mjs
```

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The transport key shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | The trusted Clew base URL, for the public keys that verify assertions. Required |
| `PORT` | Default 4054 |
| `FIXTURE_DB` | The SQLite file; the records are seeded into it on first start. Default `./servicedesk.sqlite` |
| `FIXTURE_TODAY` | A fixed day (`YYYY-MM-DD`) instead of the clock, for a repeatable demo or test |
| `FIXTURE_RESEED` | `true` forgets every record and order and seeds again from today |
| `FIXTURE_FAULT` | `unavailable`, `slow`, `unauthorized`, `conflict` or `crash-after-commit`, as the [HR fixture](../hr/README.md#the-realism-switches) has them |
| `FIXTURE_KEY` | The key of `POST /fixture/requests/<number>`; without it the route answers 401 |

## Checks

`tests/unit/servicedesk-connector.test.ts` runs it in process over the protocol with the memory store: the conformance
check, the list joined into `clew.requests`, a person seeing only their own, closed requests leaving the list after 30
days, an order for a direct report and one refused by Clew for someone else, one order per operation id and its
read-back (with the log entry lost too, where another caller or another input under the id is still refused), the
desk's refusal logged as a failed receipt, the card waiting, becoming the person's, waiting again and resolving, no card
resolved by a caller the desk cannot know or a desk that does not answer, the fixture's route, and the summary and the
equipment within what they admit, counted for the person and for their manager. The unit suites build it with the other fixtures through
`tests/fixture-connectors.ts`. From a running stack:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://servicedesk:4054 --id servicedesk \
  --secret 'replace-with-configured-dev-secret' --keys anna,erik,hassan --as hillevi
```
