# billing: invoices to attest in BillingPreprocessor

The billing records in BillingPreprocessor that wait for attest, for one category: `SALARY_AND_PENSION` by default,
the one Draken's Lön och pension lists under its attest tab. A person in the connector's audience gets one work item,
"Attestera n fakturor", with the records as rows, and attests or rejects the ones they choose. The decision is written
to BillingPreprocessor the way Draken writes it, then read back. Raindance gets the record afterwards, on its transfer
date. [D143](../../docs/decisions/D143-lop-invoices-are-attested-in-billingpreprocessor-and-clews-audience-holds-who-may.md)
says why the connector talks to BillingPreprocessor and not to SupportManagement or Raindance.

The development profile selects `BILLING_ADAPTER=fixture` and serves made-up records (`records.mjs`). The adapter for BillingPreprocessor's API (`billingpreprocessor.mjs`,
API 4.5 through the gateway) is written against Draken's contract and has met no real installation.

An independent Node service behind the connector protocol, importing nothing from the rest of the repository (D21).

## What it declares

| Capability | Kind | What it does |
|---|---|---|
| `billing.records` | read, table | The records that wait for attest: cost type, amount, manager, customer, errand, registered. Can be placed in the Verktyg menu as "Fakturor att attestera". |
| `billing.record` | read, record | One record with its rows and coding, read live: manager, customer, references, dates. |
| `billing.preview` | read | One record drawn as a page (SVG), for the review one at a time before attest. |
| `billing.approve` | execute | Attest, after the review one at a time: `status: APPROVED`, `approvedBy` and `ourReference` set to the person's name. |
| `billing.reject` | execute | Reject: `status: REJECTED`, `approvedBy` set to the person's name. The work item asks first. |
| `billing.reopen` | execute | The undo of either, within ten minutes: back to `NEW` with the reference it had. Refused once the record has left for Raindance. |
| `billing.lookup` | read | Reads an operation back. A row whose answer was missing is settled from the record's status. |
| `billing.open` | read, link | Only with `BILLING_ERRAND_LINK`: the errand in Draken that the record comes from. |

The scan gives one work item, topic `billing:records`, in the area "Fakturor". Each row is named as Draken's attest list
names a record: "Extra löneutbetalning - Systemet · 306 kr" over "Chef Hanna Jonzon · Kommunstyrelsekontoret · 1 × 300
kr + Utvecklingskostnad 2% · Ärende LoP-…". "Granska n rader" leads through the records one at a time, each drawn as
a page, and attests the approved ones at the end. "Avslå valda" asks first. The deadline is the earliest transfer
date. Nothing is offered to the model.

## Naming the customers

BillingPreprocessor answers a customer number. Draken names it from a table in its own code for each year
(`frontend/src/supportmanagement/services/invoiceData-<year>.ts`: `customers.internal` by `customerId`,
`customers.external` by `companyId`). Give the connector the same table, per type since the numbers overlap:

```sh
BILLING_CUSTOMERS='{"INTERNAL":{"10":"Kommunstyrelsekontoret"},"EXTERNAL":{"14":"Mitthem"}}'
```

A number it does not hold is shown as "Kundnummer n". The fixture has its own made-up table.

## Who may attest

The connector cannot tell. It calls BillingPreprocessor with its own gateway credential, as Draken does, and as far
as is known BillingPreprocessor checks no person. Draken lets a person attest when they are in the AD group that maps to
`draken_superadmin`. In Clew, that rule is the connector's **audience**: on Administration › Anslutna system, set the
audience to that group (provisioned into Clew) before enabling the connector. Clew checks it on every call. The
capabilities have no role scope.

Every call names the person to the gateway as Draken does: `X-Sent-By: type=adAccount; <userName>`. A person without a
provisioned user name reads nothing and decides nothing.

## Try it in the development stack

The service is in `.devcontainer/compose.yaml` under the profile `billing`, on port 4056.

```sh
docker compose -f .devcontainer/compose.yaml --profile billing up -d billing
docker exec -w /workspace clew-app-1 sh -c 'bun scripts/connector-add.ts billing http://billing:4056 --secret "${CLEW_DEV_CONNECTOR_SECRET:-clew-dev-only-transport-key}"'
```

The connector is then a draft. On Administration › Anslutna system › Lön och pension, set the audience to a group
(the development directory has no attest group, so "Alla chefer" lets Hillevi try it), then enable it. The work item
"Attestera 4 fakturor" appears in Att göra at the next scan.

The made-up records live in memory: a restart of the service puts them back. Two routes help when trying:

```sh
curl -X POST localhost:4056/fixture/reset      # every record back as it was
curl -X POST localhost:4056/fixture/transfer   # the attested ones leave for the economy system, so their undo is refused
```

`BILLING_FIXTURE_FAULT=unavailable` makes the source not answer.

## Against BillingPreprocessor

| Variable | |
|---|---|
| `BILLING_ADAPTER` | `api` |
| `BILLING_URL` | BillingPreprocessor at the gateway, with its version: `https://…/billingpreprocessor/4.5` |
| `BILLING_MUNICIPALITY_ID` | The municipality id |
| `BILLING_TOKEN_URL`, `BILLING_CLIENT_ID`, `BILLING_CLIENT_SECRET` | The gateway's OAuth 2 client credentials |
| `BILLING_CATEGORY` | Default `SALARY_AND_PENSION`. The same connector can serve another of BillingPreprocessor's categories. |
| `BILLING_SOURCE_LABEL` | Default `Lön och pension` |
| `BILLING_ERRAND_LINK` | Optional, https with `{errandNumber}`: the errand in Draken, as Draken links it, `https://<Draken>/LOP/arende/{errandNumber}` |
| `BILLING_CUSTOMERS` | Optional, JSON: customer number to name per type (above) |
| `CLEW_CONNECTOR_SECRET`, `CLEW_URL`, `PORT` | As for every connector. `PORT` defaults to 4056. |

`compose.yaml` runs it on its own. Set `BILLING_ADAPTER=api` for BillingPreprocessor, or `fixture` for made-up records in development. The service refuses to start with API settings in fixture mode. The calls are: `GET /{municipalityId}/billingrecords?filter=category:'…' and
status:'NEW'` (at most five pages of 100), `GET /{municipalityId}/billingrecords/{id}` and
`PUT /{municipalityId}/billingrecords/{id}` with the record shaped as Draken shapes it: the fields a person may set,
without the id, dates, totals and an internal record's recipient, which the API refuses. A record of another category is
treated as not found. A refusal is logged with the API's own reason (`event: refused`).

## Testing against BillingPreprocessor

In four steps, each needing the one before. Every step runs against the test gateway, never production, and the
first two write nothing.

1. **A credential of the connector's own.** An application in the gateway subscribed to `billingpreprocessor/4.5`,
   with its client id and secret. Draken's own credential should not be borrowed: the gateway would then record
   Clew's calls as Draken's. The token address is the gateway's `/token`, as Draken's `API_BASE_URL` + `/token`.
   The gateway is probably reachable only from the municipality's network.
2. **A read-only probe.** It fetches a token, lists the category's waiting records and reads the oldest one. It
   prints counts and which fields the connector relies on are present, and nothing from the records:

   ```sh
   BILLING_URL=https://<test gateway>/billingpreprocessor/4.5 BILLING_TOKEN_URL=https://<test gateway>/token \
   BILLING_CLIENT_ID=… BILLING_CLIENT_SECRET=… BILLING_MUNICIPALITY_ID=… PROBE_ACCOUNT=<your AD account> \
   node connectors/billing/probe.mjs
   ```

3. **The connector on the test API, in the development stack.** Start the service with the same variables and
   `BILLING_ADAPTER=api`, which the devcontainer passes on:

   ```sh
   BILLING_ADAPTER=api BILLING_URL=… BILLING_TOKEN_URL=… BILLING_CLIENT_ID=… BILLING_CLIENT_SECRET=… \
   BILLING_MUNICIPALITY_ID=… docker compose -f .devcontainer/compose.yaml --profile billing up -d --force-recreate billing
   ```

   `X-Sent-By` then carries the development persona's user name (`hillevi`), not a real AD account. Agree with the
   API's team whether the test environment accepts that.

4. **A decision on a record made for the test.** Create a billing record in the category in Draken's Lön och pension
   test, then from Clew: attest it and check in Draken that it is attested with the persona's name; undo and check
   that it waits again; reject a second one. Leave nothing attested afterwards: an attested record is sent on to
   the economy system's test on its transfer date. This step answers the two open questions below.

After that, the connector goes into Clew's own test environment as a container of its own, with the audience set to
the group that may attest.

## Not known yet

- Whether BillingPreprocessor reads `X-Sent-By` for anything but its log.
- Whether it accepts a record going back to `NEW`, which the undo relies on.
- Operation ids are kept in memory: after a restart, `billing.lookup` answers `found: false`, and an unknown outcome
  is then to be checked in Draken.

`tests/unit/billing-connector.test.ts` runs it over the protocol, and the API adapter against a fake gateway.
