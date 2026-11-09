# absence: sick-leave statistics as a Clew connector

A pass-through connector with reads only, for managers ([D82](../../docs/decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md)).
It shows sick leave as a rate per unit and month, never per person. Qlik's Engine API is its first source; the contract
belongs to Clew and does not name Qlik, so another statistics source can take its place behind the same port. No
dependencies beyond Node; nothing here imports the rest of the repository.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: two reads with their table views, and the area with its figure |
| `connector.mjs` | The reads, the minimum group size, the figure, the assertion check and HTTP error handling |
| `statistics.mjs` | The port, the mapping `toStatRow`, and made-up statistics for Clew's synthetic units |
| `qlik.mjs` | Qlik's Engine API behind the port: one session hypercube over one WebSocket per read |
| `server.mjs` | Serves it over HTTP and reads the configuration |

## What a manager gets

| Capability | Shown as | Notes |
|---|---|---|
| `absence.unitRates` "Sjukfrånvaro per enhet" | A table: unit, month, total, short-term and long-term rate, same month last year, change, headcount | The latest closed month. A row opens the unit's trend |
| `absence.trend` "Sjukfrånvaro per månad" | A table of twelve months, newest first | Opens without input for the first of the manager's units |
| Area `absence` "Sjukfrånvaro" | Both reads as standing actions, and a figure: "Sjukfrånvaro 5,3 %", "oktober 2026 · 5,5 % i fjol, −0,2" | A tile on Läget (D54) that opens the table of units |

Both views can be menu tools (D40). An employee does not see the area, and the connector refuses an employee itself.
A unit whose headcount is below `ABSENCE_MIN_GROUP`, or unknown, is shown with a note and without rates. The model
reads the aggregates.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks`. Required; HTTPS outside the local development allowlist |
| `PORT` | Default 4048 |
| `ABSENCE_ADAPTER` | `fixture` (default, made-up statistics) or `qlik` |
| `ABSENCE_UNIT_MAP` | JSON object, Clew unit id to an array of the source's unit names: `{"unit-skola":["Barn- och utbildningsförvaltningen"]}`. Required for `qlik`; a unit without an entry sees nothing |
| `ABSENCE_MIN_GROUP` | The smallest headcount whose rates are shown. Default 5, a placeholder: HR and the data protection officer decide |
| `ABSENCE_WARN_ABOVE` | Optional rate in percent from which the figure's tone is `warn`. Without it the tone is `none` |
| `ABSENCE_CACHE_SECONDS` | How long the aggregates stay in memory. Default 300 |
| `QLIK_URL` | The engine's base: `wss://<host>/<virtual proxy>` (Qlik Sense Enterprise) or `wss://<tenant>` (Qlik Cloud). `/app/<id>` is appended |
| `QLIK_APP_ID` | The app holding the aggregate |
| `QLIK_TOKEN` | Bearer for the service identity: a JWT for the virtual proxy, or a Qlik Cloud OAuth token. From a secrets store; Clew never sees it |
| `QLIK_CUBE` | JSON: `{"unit":"<field>","period":"<field>","measures":{"total":"…","short":"…","long":"…","headcount":"…"}}`. A measure is an expression or `library:<master measure id>`; `total` and `headcount` are required |
| `QLIK_RATES_AS` | `fraction` (default: the measures answer 0.052) or `percent` (5.2) |

The month field may be text `YYYY-MM`, a date, or Qlik's date number.

## Before it is switched on against Qlik

1. The Qlik owners provide one object or app with the aggregate per unit and month, and a service identity whose
   section access reaches that and nothing else.
2. HR and the data protection officer set `ABSENCE_MIN_GROUP`, and agree who may see which units (`ABSENCE_UNIT_MAP`).
3. Check that the app holds closed months, not only the current state; otherwise last year's comparison moves.
4. Run the connector against the test server and `bun scripts/connector-check.ts` before registering it.

D82 lists what is unverified: the WebSocket CSRF rule on a JWT virtual proxy, client certificates (not built), a
renewing Qlik Cloud token (not built) and the licence.

## What it never does

It does not store anything, return a person, write to Qlik, push cards, log request or response bodies, or pass on
Qlik's error text.

## Run and check

With the local Clew stack running, inside the devcontainer:

```sh
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 clew-app-1 node connectors/absence/server.mjs
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4048 --id absence --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts absence http://127.0.0.1:4048 --secret local-docs-only-transport-key
```

The last command creates a draft registration; choose its audience (managers) and enable it under Administration ›
Anslutna system. Tests: `bun test tests/unit/absence-connector.test.ts`, including the Qlik adapter against a fake
engine.

Node's official image is MIT. The connector has no other dependency.
