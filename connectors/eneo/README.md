# The Eneo connector

Eneo's retrieval over the person's knowledge bases as a search source for Clew (D14, D26). Clew's composite search asks
it beside every other source; the person sees Eneo's passages as citations and in the sources view, and nothing of the
source document is indexed in Clew. It also carries the assistants profile (D125): the assistants an owner in Eneo made available to other clients can be picked in Clew's box, and a question then goes to the whole assistant in Eneo. The connector uses Node and the companion protocol 3 verifier, in the same service shape as [hello](../hello/README.md). Start with the [integrator guide](../../docs/guides/creating-a-connector.md) and [authorization](../../docs/guides/authorization.md).

## What it declares

| Capability | Kind | What it does |
|---|---|---|
| `eneo.search` | read, `kinds: ["document"]` | Lists the person's spaces and their collections, searches every collection at once (`POST /groups/{id}/searches/`), keeps the best chunks and fetches their documents' titles and links. |
| `eneo.fetch` | read | One document by its id (`GET /info-blobs/{id}/`), as a `SearchHit` with the first 1 500 characters as the snippet. |
| `eneo.whoami` | read | The claims of the token the connector was handed (unverified), so an operator can see what Eneo is given. |
| `eneo.assistants` | read, the manifest's `assistants.list` | The assistants the person may ask from other clients (`GET /assistants/external/`). Never a model tool. |

No areas, no scan, no figure: everything here needs the person's own token, which those paths never have.

## Acting as the person

The manifest declares `delegation: { audience: "eneo" }`. On every call Clew trades the person's session for an IdP token
bound to the audience `eneo` (RFC 8693 token exchange) and sends it in `X-Clew-Delegated-Token` beside the assertion.
The connector forwards that token as `Authorization: Bearer` to Eneo and nothing else: no Origin, no cookie, no header
from the incoming request. Without the header it answers `denied`, which Clew's composite reports as "Eneo svarade inte"
for that source. The token lives about a minute; the connector never stores it and never retries after a 401. Each search and document fetch rechecks current source access; source documents and collection lists are not cached across requests. A missing source record is omitted from search, while an authorization failure or source outage fails that source visibly.

## Assistants

The manifest declares `assistants: { list: "eneo.assistants" }` and the connector serves `POST /clew/ask`. A person picks
an assistant in Clew's box; each question then goes to Eneo's conversation API as the person
(`POST /conversations/?version=3`, streamed), with `assistant_id` for the first question and `session_id` for a
follow-up, so the assistant answers with its own prompt, knowledge and tools and Eneo keeps the conversation as the
person's own, in their history there. What the connector does on the way:

- sends the question as it was typed, and what the person attached as `context`, apart from the question;
- leaves Eneo's file-producing functions out of the turn (`disabled_capabilities`: image generation, file creation,
  file analysis, compute, charts), since Clew's conversation cannot carry a generated file, and asks for no tool
  approvals;
- relays the text as it is written, takes Eneo's citation tags (`<inref id="…"/>`) out of it and lists the sources
  they point at, each once, with its title and its address when that is https;
- ends with the session id and, when `ENEO_PUBLIC_URL` is an https address, the link
  `{ENEO_PUBLIC_URL}/dashboard/{assistant}/{session}` that opens the same conversation in Eneo.

A 401 or 403 from Eneo is `denied`, a 404 `not-found`, anything else, an error in the stream or a stream that ends
before `finish` is `unavailable`. Nothing of a question or an answer is kept or logged here.

Eneo needs, beside the settings below, the flag on an assistant that makes it available to other clients and the
listing `GET /api/v1/assistants/external/`. Those are a change in Eneo that has not been released: until an
installation runs an Eneo with it, the listing answers 404, no assistant is listed and the rest of the connector works
as before. The tests are `tests/unit/eneo-assistants.test.ts`, against Eneo's stream as recorded; no real Eneo has
been asked.

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
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 -e ENEO_URL=https://eneo.example clew-app-1 node connectors/eneo/server.mjs
```

Replace the example source URL with your Eneo URL. With that process running, use another terminal:

```sh
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4011 --id eneo --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts eneo http://127.0.0.1:4011 --secret local-docs-only-transport-key
```

The live checker needs the installation database/master key and expects denied delegated reads because it has no session. The second command creates or updates a draft; configure audience and enable it in administration. The key above is for local development only. Validate the Eneo-side settings against the deployed Eneo version before enabling real access.

`bun scripts/auth-setup.ts` creates the Keycloak client `eneo` and the scope `eneo-audience` that the exchange needs,
and enables standard token exchange on `clew-web`. `bun scripts/auth-exchange-check.ts` logs in as `hillevi` and
shows the exchanged token's claims through `eneo.whoami`.

Environment: `CLEW_CONNECTOR_SECRET`, `CLEW_URL` (trusted Clew base URL for public signing keys), `ENEO_URL`, `ENEO_PUBLIC_URL` (optional: where a person opens Eneo in a browser, https, for the link that continues a conversation there), `PORT` (4011). The former `ENEO_COLLECTIONS_TTL_SECONDS` setting is no longer used. The tests are `tests/unit/eneo-connector.test.ts`,
against recorded Eneo answers.
