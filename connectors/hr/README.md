# hr: a generic HR and scheduling system, as a fixture connector

The HR system of a municipality, as Clew's development stack and unit suite meet it: absences, leave requests, delegations,
shifts, the sick-report fact and its follower. It stands for a kind of system, not a product (D52); every person and
record is made up. It is an independent Node service behind the connector protocol, registered in Clew like a vendor's
connector, and imports nothing from the rest of the repository (D21). Start with the
[integrator guide](../../docs/guides/creating-a-connector.md); for the shape of a small connector read
[hello](../hello/README.md) first.

| File                | Holds                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `manifest.mjs`      | The contract: capabilities with schemas and views, the areas, the fact `hr:absence`, deduplicated execution |
| `connector.mjs`     | The handlers, the scan, the figures, the write log and the HTTP boundary                                    |
| `fixture.mjs`       | The records, generated relative to the day the store was seeded                                             |
| `state.mjs`         | The store: SQLite in the service, memory in tests                                                           |
| `verification.mjs`  | Protocol 2 identity and transport checks, the copy every connector carries                                  |
| `server.mjs`        | The Node HTTP service and its configuration                                                                 |

## What it answers

A manager of the unit (role `manager`, unit `unit-skola` after `FIXTURE_UNIT_MAP`) gets the area `employees`: who is at
work, absence per person with the rehab pattern, the leave requests waiting, the figure "Sjukfrånvaro n %" against the target, opening absence per person (D54), and the cards
the scan pushes (a rehab talk to book, each leave request to decide). An employee the HR system knows (by person id
after `FIXTURE_PERSON_MAP`) gets `my-shift`: today's shift, the balance, a delegation about to expire, the own leave
request waiting on the manager. A manager of another unit gets the same reads over an empty unit, never a denial.

Every `execute` is deduplicated by Clew's operation id (`X-Clew-Operation-Id`): the same id answers with the first
result, a different input under the same id is refused with 409, and `hr.lookup` finds the result afterwards (D45). The
writes are the leave decision and its undo, the rehab talk and its undo, the sick report and its withdrawal, the
delegation renewal. `hr.proposeAbsence` follows the fact `hr:absence` (D55): one `hr.reportAbsence` step when the report
does not exist yet, none when it does.

## Running it

In the development stack it is one of the services in `.devcontainer/compose.yaml` and `bun run dev:connectors`
registers it. To run a separate instance inside the app container (the key and SQLite file below are for local development only):

```sh
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 -e FIXTURE_DB=/tmp/hr-standalone.sqlite clew-app-1 node connectors/hr/server.mjs
```

| Variable             | Meaning                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `CLEW_CONNECTOR_SECRET` | The transport key shared with Clew, 16 characters or more. Required                                       |
| `CLEW_URL`           | The trusted Clew base URL, for the public keys that verify assertions. Required                              |
| `PORT`               | Default 4040                                                                                                 |
| `FIXTURE_DB`         | The SQLite file; the records are seeded into it on first start. Default `./hr.sqlite`                       |
| `FIXTURE_TODAY`      | A fixed day (`YYYY-MM-DD`) instead of the clock, for a repeatable demo or test                                |
| `FIXTURE_RESEED`     | `true` forgets every record and decision and seeds again from today                                          |
| `FIXTURE_FAULT`      | `unavailable`, `slow`, `unauthorized`, `conflict` or `crash-after-commit` (see below)                          |
| `FIXTURE_UNIT_MAP`   | JSON object, Clew unit id to the HR system's unit id, where they differ                                       |
| `FIXTURE_PERSON_MAP` | JSON object, Clew person id to the HR system's person id, where they differ                                   |
| `FIXTURE_FEED_KEY`   | The key the payroll fixture presents on `GET /fixture/absences`; without it the feed answers 401              |

## The realism switches

A real source fails in ways a fixture that always answers never shows. `FIXTURE_FAULT` is process configuration, never a
route (the rule the [reference source](../reference/README.md) set):

| Value                | What the connector does                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `unavailable`        | Every call answers 503; Clew shows "Personalsystemet svarar inte"                                            |
| `slow`               | Every call takes 1.5 seconds longer                                                                          |
| `unauthorized`       | Every call answers 401, as a source whose integration credential expired                                     |
| `conflict`           | Every write answers that the record changed under the person, with no write made                            |
| `crash-after-commit` | Every write is committed and then the answer is lost: Clew's read-back through `hr.lookup` finds it           |

## Checks

`tests/unit/hr-connector.test.ts` runs this connector in-process over the protocol with the memory store; the unit
suites run it the same way as the HR system of their scenarios. The Node lane boots `server.mjs` on a temporary SQLite
file and finds a write again after a restart. From a running stack:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://hr:4040 --id hr --secret 'replace-with-configured-dev-secret'
```
