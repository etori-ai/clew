# qlik: what Qlik knows, as a Clew connector

The Qlik connector ([D82](../../docs/decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md)):
when it is registered and enabled, Clew shows what it reads from Qlik. Sick leave was the first: a rate per unit and
month for managers, never per person. Economy and HME followed as the key figures of the follow-up dialogue that is to
replace big-boss-board ([the plan](../../docs/reviews/2026-11-12-absorbing-big-boss-board-into-clew.md)). A pass-through
connector with reads only. The capabilities describe the figures in Clew's words (D1); `engine.mjs` translates sick leave
to Qlik's Engine API, and a fixture stands in for Qlik in development.
No dependencies beyond Node; nothing here imports the rest of the repository.

**Economy and HME are made up, for now.** Only the fixture answers them: where they come from in production is not
settled (an API is being looked into, not the file feed), and HME's real source is the employee survey, not Qlik. They
are here so the development stack shows the follow-up dialogue's figures and their way through Clew. With the engine
adapter, their tables have no rows and their areas no figure.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: tables, charts and reads about a unit for sick leave, economy and HME, and the three areas with their figures |
| `connector.mjs` | The reads, the minimum group size, the organisation's thresholds, the figures, the assertion check and HTTP error handling |
| `statistics.mjs` | The port, the mapping `toStatRow`, and made-up sick leave, economy and HME for any unit |
| `engine.mjs` | Qlik's Engine API behind the port: one session hypercube over one WebSocket per read |
| `server.mjs` | Serves it over HTTP and reads the configuration |

## What a manager gets

| Capability | Shown as | Notes |
|---|---|---|
| `qlik.sickLeaveByUnit` "Sjukfrånvaro per enhet" | A table: unit, month, total, short-term and long-term rate, same month last year, change, headcount | The latest closed month. A row opens the unit's trend |
| `qlik.sickLeaveTrend` "Sjukfrånvaro per månad" | A table of twelve months, newest first | Opens without input for the first of the manager's units |
| `qlik.unit` "Sjukfrånvaro" | A read about a unit ([D97](../../docs/decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)): asked with Clew's unit ids (`{ keys }`, at most 200), one row for the manager's own unit through the unit map, with the rate, the month, the change against last year and `watch` ("Bevaka" or "Åtgärd krävs") by the operator's thresholds | Clew draws it as the section Sjukfrånvaro on the opened unit. Any other unit id is no row. Of several source units, the first with a rate to show, as the figure takes it. Never a model tool. A row opens the unit's chart |
| `qlik.sickLeaveChart` "Sjukfrånvaron över tid" | A line chart with its table (D79's `series`): twelve months, the same month last year, and the watch rate when set | Needs a unit, so it opens from a row only |
| `qlik.economyByUnit` "Ekonomi per enhet" | A table: unit, month, full-year budget and forecast of net cost in mnkr, the deviation (budget minus forecast: positive is within budget) and "Klarar budget" or "Mot underskott" by the operator's rule | The close of the latest month this year. A row opens the chart |
| `qlik.economyChart` "Ekonomin över året" | A line chart of the deviation at each month's close this year, against budget in balance | From a row only |
| `qlik.economyUnit` "Ekonomi" | A read about a unit: the deviation, the assessment, the month, forecast and budget | The section Ekonomi on the opened unit. Never a model tool |
| `qlik.hmeByUnit` "Medarbetarengagemang per enhet" | A table: unit, year, HME total and the perspectives motivation, leadership and governance, the change since the measurement before, and "Över mål", "Bevaka" or "Åtgärd krävs" by the operator's rule | The latest measurement, every other year. A unit with fewer respondents than `QLIK_MIN_GROUP` is shown with a note. A row opens the chart |
| `qlik.hmeChart` "Medarbetarengagemanget över tid" | A line chart of the total and the three perspectives at each measurement, and the target when set | From a row only |
| `qlik.hmeUnit` "Medarbetarengagemang" | A read about a unit: the total, the assessment, the year and the change | The section on the opened unit. Never a model tool |
| Area `sick-leave` "Sjukfrånvaro" | The table and the trend as standing actions, and a figure: "Sjukfrånvaro 5,3 %", "oktober 2026 · 5,5 % i fjol, −0,2" | A tile on Läget (D54) that opens the table of units |
| Area `economy` "Ekonomi" | The table as a standing action, and a figure: "+3,2 mnkr", "Helårsprognos mot helårsbudget · oktober 2026" | Opens the table |
| Area `hme` "Hållbart medarbetarengagemang" | The table as a standing action, and a figure: "72", "Mätår 2025 · +2 sedan 2023" | Opens the table |

The tables can be menu tools (D40). An employee does not see the areas, and the connector refuses an employee itself.
A unit whose headcount is below `QLIK_MIN_GROUP`, or unknown, is shown with a note and without rates. The model
reads the aggregates in the tables and charts, never the reads about a unit.

**The tones are the organisation's.** Each figure's tone is `none` until the operator sets its rule (D82 item 7). The
development stack sets big-boss-board's: sick leave good to 6.0 %, watch to 7.5 %, act above; the economy alert below
budget in balance; HME over target from 75, watch from 70. Big-boss-board reads sick leave as a rolling twelve-month
rate and also alerts on a rise of more than 1.5 percentage points in three months; this connector reads a monthly rate,
and which one the source gives is not settled, so the rise rule is not built.

**Open mode.** Without `QLIK_UNIT_MAP` the fixture has no map from Clew's units to the source's: a unit's name in the
source is Clew's unit id, and every manager has made-up figures for their own unit, whatever the organisation tree,
the same every time. The scope is the same as with a map, the reader's own unit only. How Clew's units are mapped to
the real source, and whether a manager sees the units below, are not settled.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks`. Required; HTTPS outside the local development allowlist |
| `PORT` | Default 4048 |
| `QLIK_ADAPTER` | `fixture` (default, made-up statistics) or `engine` (Qlik's Engine API) |
| `QLIK_UNIT_MAP` | JSON object, Clew unit id to an array of the source's unit names: `{"unit-skola":["Barn- och utbildningsförvaltningen"]}`. Required for `engine`; a unit without an entry sees nothing. Without it the fixture runs in open mode |
| `QLIK_MIN_GROUP` | The smallest headcount whose rates are shown. Default 5, a placeholder: HR and the data protection officer decide |
| `QLIK_SICK_LEAVE_WARN_ABOVE` | Optional rate in percent from which the sick-leave figure's tone is `warn`, and `ok` below, and from which `qlik.unit` says "Bevaka". Without it or the next the tone is `none` |
| `QLIK_SICK_LEAVE_ALERT_ABOVE` | Optional rate in percent from which the tone is `alert` and `qlik.unit` says "Åtgärd krävs". Not below the warn rate |
| `QLIK_ECONOMY_ALERT_BELOW` | Optional deviation in mnkr (budget minus forecast) below which the economy is `alert`, "Mot underskott", and `ok`, "Klarar budget", at or above. `0` is budget in balance |
| `QLIK_HME_OK_FROM` | Optional HME index from which HME is `ok`, "Över mål"; below it `warn` |
| `QLIK_HME_WARN_FROM` | Optional, with the previous: the index below which HME is `alert`, "Åtgärd krävs". Not above it |
| `QLIK_CACHE_SECONDS` | How long the aggregates stay in memory. Default 300 |
| `QLIK_URL` | The engine's base: `wss://<host>/<virtual proxy>` (Qlik Sense Enterprise) or `wss://<tenant>` (Qlik Cloud). `/app/<id>` is appended |
| `QLIK_APP_ID` | The app holding the sick-leave aggregate |
| `QLIK_TOKEN` | Bearer for the service identity: a JWT for the virtual proxy, or a Qlik Cloud OAuth token. From a secrets store; Clew never sees it |
| `QLIK_SICK_LEAVE_CUBE` | JSON: `{"unit":"<field>","period":"<field>","measures":{"total":"…","short":"…","long":"…","headcount":"…"}}`. A measure is an expression or `library:<master measure id>`; `total` and `headcount` are required |
| `QLIK_RATES_AS` | `fraction` (default: the measures answer 0.052) or `percent` (5.2) |

The month field may be text `YYYY-MM`, a date, or Qlik's date number.

## Before it is switched on against Qlik

1. The Qlik owners provide one object or app with the aggregate per unit and month, and a service identity whose
   section access reaches that and nothing else.
2. HR and the data protection officer set `QLIK_MIN_GROUP`, and agree who may see which units (`QLIK_UNIT_MAP`).
3. Check that the app holds closed months, not only the current state; otherwise last year's comparison moves.
4. Run the connector against the test server and `bun scripts/connector-check.ts` before registering it.

D82 lists what is unverified: the WebSocket CSRF rule on a JWT virtual proxy, client certificates (not built), a
renewing Qlik Cloud token (not built) and the licence.

## What it never does

It does not store anything, return a person, write to Qlik, push cards, log request or response bodies, or pass on
Qlik's error text. Its made-up figures are synthetic and never real ones.

## Run and check

The development stack runs it as the compose service `qlik` on its made-up statistics in open mode, with
big-boss-board's thresholds, and `bun run dev:connectors` registers it. The first time it does, it switches off the HR
fixture's sick-leave figure and the finance fixture's spent frame on Hem, as an administrator would, so Läget shows these
instead. To run it by hand instead, inside the devcontainer:

```sh
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 clew-app-1 node connectors/qlik/server.mjs
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4048 --id qlik --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts qlik http://127.0.0.1:4048 --secret local-docs-only-transport-key
```

The last command creates a draft registration; choose its audience (managers) and enable it under Administration ›
Anslutna system. Tests: `bun test tests/unit/qlik-connector.test.ts`, including the Qlik adapter against a fake
engine.

Node's official image is MIT. The connector has no other dependency.
