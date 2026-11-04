# The Eneo connector

Eneo's retrieval over the person's knowledge bases as a search source for Clew (D14, D26). Clew's composite search asks
it beside every other source; the person sees Eneo's passages as citations and in the sources view, and nothing of the
text is stored on Clew's side. The connector is one file and the Node runtime, in the same shape as `connectors/hello`.

## What it declares

| Capability | Kind | What it does |
|---|---|---|
| `eneo.search` | read, `kinds: ["document"]` | Lists the person's spaces and their collections, searches every collection at once (`POST /groups/{id}/searches/`), keeps the best chunks and fetches their documents' titles and links. |
| `eneo.fetch` | read | One document by its id (`GET /info-blobs/{id}/`), as a `SearchHit` with the first 1 500 characters as the snippet. |
| `eneo.whoami` | read | The claims of the token the connector was handed (unverified), so an operator can see what Eneo is given. |

No areas, no scan, no figure: everything here needs the person's own token, which those paths never have.

## Acting as the person

The manifest declares `delegation: { audience: "eneo" }`. On every call Clew trades the person's session for an IdP token
bound to the audience `eneo` (RFC 8693 token exchange) and sends it in `X-Clew-Delegated-Token` beside the assertion.
The connector forwards that token as `Authorization: Bearer` to Eneo and nothing else: no Origin, no cookie, no header
from the incoming request. Without the header it answers `denied`, which Clew's composite reports as "Eneo svarade inte"
for that source. The token lives about a minute; the connector never stores it and never retries after a 401.

## What Eneo needs

Eneo accepts an external IdP's access token only in its resource-server mode (`backend/src/eneo/authentication/oidc_resource_server.py`):

| Setting | Value |
|---|---|
| `OIDC_RESOURCE_SERVER_ENABLED` | `true` |
| `OIDC_ACCEPTED_ISSUER` | The realm issuer Clew logs in against, e.g. `http://keycloak.orb.local:8090/realms/clew` |
| `OIDC_ACCEPTED_AUDIENCE` | `eneo` |
| `OIDC_TENANT_ID` | The tenant the persons belong to (the mode is single-tenant) |

The token is verified against the issuer's JWKS, so Eneo must reach the issuer. The person is matched by the `email`
claim (`email_verified` must not be false) and admitted by Eneo's federation rules, so each person needs an Eneo account
with the same e-mail, or JIT provisioning for the domain, and membership of the spaces whose collections hold the routines.
Websites and integration knowledge have no search endpoint in Eneo's API today, so only collections are searched.

Eneo's documents carry no owner, review date or review interval. The connector reports `updatedAt`, so Clew's staleness
rule (a year without a review) counts from the last change.

## Running it

```sh
ENEO_SECRET=<16+ characters> ENEO_URL=https://eneo.example docker compose -f connectors/eneo/compose.yaml up eneo
bun scripts/connector-check.ts http://127.0.0.1:4011 --secret <the secret>          # expects "denied" answers: it has no token
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts eneo http://host.docker.internal:4011 --secret <the secret> --enable
```

`bun scripts/auth-setup.ts` creates the Keycloak client `eneo` and the scope `eneo-audience` that the exchange needs,
and enables standard token exchange on `clew-web`. `bun scripts/auth-exchange-check.ts` logs in as `hillevi` and
shows the exchanged token's claims through `eneo.whoami`.

Environment: `CLEW_CONNECTOR_SECRET`, `ENEO_URL`, `PORT` (4011), `ENEO_COLLECTIONS_TTL_SECONDS` (300: how long a
person's collection list and a document's title are remembered). The tests are `tests/unit/eneo-connector.test.ts`,
against recorded Eneo answers.
