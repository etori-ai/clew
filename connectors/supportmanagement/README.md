# sm: a person's errands in SupportManagement, as a Clew connector

The first errand connector ([D35](../../docs/decisions/D35-errands-are-a-connector-profile-and-a-card-is-one-systems.md),
[D89](../../docs/decisions/D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md)): when it is
registered and enabled, the errands a person has in SupportManagement are listed under "Mina ärenden", together with
those of every other case system connected to Clew, and one opens in the panel. A pass-through connector with reads only. Its id is `sm`; the folder carries the system's name.

It acts as the person. Clew sends the person's own token for SupportManagement beside its assertion, every call to
SupportManagement carries that token and nothing else, and **SupportManagement decides what the person may see**. The
connector holds no service credential and interprets no group, namespace or access rule. No dependencies beyond Node;
nothing here imports the rest of the repository.

SupportManagement cannot answer this way today. [What SupportManagement has to provide](#what-supportmanagement-has-to-provide)
lists what is needed; until then the connector runs on a fixture that behaves as the changed system would.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: the two reads, their views, the errand row and the ref pattern |
| `connector.mjs` | The reads, the shared state, the assertion check, the token requirement and HTTP error handling |
| `errands.mjs` | The errand port, the mapping `toSourceErrand`, and a made-up SupportManagement with its own access rules |
| `supportmanagement.mjs` | SupportManagement's API behind the port |
| `server.mjs` | Serves it over HTTP and reads the configuration |

## What a person gets

| Capability | Shown as | Notes |
|---|---|---|
| `sm.errands` "Ärenden i ärendesystemet" | A list: errand number and type, status, who it waits on, area, last changed | `view: assigned` (the default: assigned to the person, and their group's unassigned queue) or `view: reported`. What waits on the person first, then the oldest. A row opens the errand |
| `sm.errand` "Ärende" | One errand: the row's fields plus title, description and a link out | Read live with the person's token. Never offered to the model |

The names are the errand profile's. Clew asks every connector's `<id>.errands` at the same time and shows the answers
as one list, `clew.errands` "Mina ärenden", ordered by the shared state; a row there opens this connector's
`sm.errand`. That list owns the area "Ärenden", its button on Hem and the menu row, so this connector declares no
area and no menu row, and the model is offered the combined list instead of this one.

A row is the errand model every case system answers with:

| Field | Content |
|---|---|
| `ref` | `errand:sm:<municipalityId>:<namespace>:<id>`. Clew treats it as opaque |
| `label` | The errand number and the category and type display names: `IK-26110007 · Behörighet, Beställning`. Never the title, a name or an account |
| `state` | The shared state: `new`, `active`, `waiting-on-me`, `waiting-on-others` or `closed`. What lets lists from several systems be ordered together |
| `status` | SupportManagement's own display name for the status |
| `waitingOn` | `Dig`, `Din grupp`, `Anmälaren`, `Handläggare` or `Parkerat till 12 nov.`, where the errand says so |
| `since` | When the errand was last touched |
| `area` | The namespace's display name. A label only: nothing in Clew reads it for access |
| `link` | The errand in its own system, where the operator has configured an address for the namespace |

`dueAt` is part of the model and never set here: SupportManagement has no deadline on the errand itself.

The model reads only a summary of the list (how many rows), and nothing of an errand's free text.

## What SupportManagement has to provide

Today SupportManagement is reached through the API gateway with one credential per client application (OAuth 2.0 client
credentials), the person is named in an `X-Sent-By` header the client sets, and which namespaces a person may work in is
decided in the case officers' web application, from the AD groups in its SAML login. A client that holds a gateway
credential can therefore read any namespace as any person. Clew is not built to be trusted with that, and does not keep
a copy of the access rules. The following moves identity and access into SupportManagement, where every client gets
the same answer.

### Required

1. **Accept the person's own token.** A bearer access token issued by the organisation's identity provider for the
   audience SupportManagement (or the gateway in front of it) is registered as. SupportManagement or the gateway
   verifies the signature against the provider's keys, and the issuer, audience and expiry. The person is identified
   from the token (the claim that carries the AD account, or a lookup from the token's subject), never from
   `X-Sent-By`. For this client the gateway must pass the user's token through or validate it itself; an application
   credential may remain for throttling but does not decide who the caller is.

2. **Decide access from that identity.** For every request: which namespaces the person handles, from their groups
   (carried in the token or looked up in the directory, as SupportManagement's access mapping already relates AD groups
   to namespaces and roles). The rule that today lives in the web application's configuration (the groups allowed to
   log in to one namespace's installation) has to hold in the API. An errand outside what the person may see is answered
   with `404`, so its existence is not revealed.

3. **One question for "my errands" across namespaces.** New:

   ```
   GET /{municipalityId}/errands/mine?relation={assigned|group|reported}&page={n}&size={n}
   ```

   | `relation` | Returns the open errands, in every namespace the rule in 2 allows, that are |
   |---|---|
   | `assigned` | assigned to the person |
   | `group` | assigned to a group the person belongs to, with no person assigned |
   | `reported` | reported by the person. A reporter sees their own errand without handling its namespace |

   The answer is the page of errands SupportManagement already returns from `…/{namespace}/errands`, with one field
   added to each errand: **`namespace`**. Optionally `namespaceDisplayName`. The connector reads `id`, `errandNumber`,
   `namespace`, `status`, `classification.category`, `classification.type`, `suspension.suspendedTo`, `touched`,
   `modified` and `created` and ignores the rest. Closed errands are left out. The connector reads at most five pages of 100.

4. **The existing reads, with the same token.**

   | Read | Used for | Needed behaviour |
   |---|---|---|
   | `GET /{municipalityId}/{namespace}/errands/{id}` | The errand view: `title` and `description` | Allowed for a handler of the namespace and for the errand's reporter; `404` otherwise |
   | `GET /{municipalityId}/{namespace}/metadata` | Display names for categories, types and statuses | Readable by anyone who may see an errand in the namespace. When it is refused the connector shows the source names instead |

### Wanted, not required

| Addition | What it gives |
|---|---|
| `relation` on a single errand (`assigned`, `group` or `reported` for the caller) | The errand view can say who it waits on. Without it an opened errand shows `active` where the list said `waiting-on-me` |
| The errand's address in its own system, readable without administrator rights | The link out without `SM_NAMESPACE_LINKS` in the connector |
| A deadline on the errand | `dueAt`, so errands sort by what is due |
| A change event without content ("errand X changed") delivered to Clew ([D19](../../docs/decisions/D19-change-notification-is-a-clew-owned-contract.md)) | Fresh cards without polling, and notices while the person is away |
| What the caller may do with one errand (the existing `…/errands/{id}/access`), honouring the same token | The buttons a card may show, when writes are built |

### What the identity provider has to provide

- OAuth 2.0 token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) from Clew's client to the audience in 1,
  so that Clew can trade the person's session for a short-lived token that only SupportManagement accepts.
- In that token: the claim SupportManagement identifies the person by, and the groups if access is decided from the
  token.

### What Clew still lacks

Nothing above is needed for the list and the errand view to work against a changed SupportManagement. Not built in
Clew: a scan with the person's token (so no cards on Hem and `scan: false` here), a card on demand, search by errand
number, and writes such as a note. D89 lists them.

## How a status becomes a state

Statuses are per namespace, so the meaning is configuration. `SM_STATUS_KINDS` adds to or replaces these; a status
without an entry counts as `open`.

| Kind | Default statuses | State for the handler | State for the reporter |
|---|---|---|---|
| `new` | `NEW` | `waiting-on-me` when assigned to the person, `new` in the group's queue | `waiting-on-others` |
| `open` | `ONGOING`, `ASSIGNED`, `REOPENED` | `waiting-on-me` when assigned to the person, `active` in the group's queue | `waiting-on-others` |
| `waiting-reporter` | `PENDING` | `waiting-on-others` | `waiting-on-me` |
| `waiting-other` | `AWAITING_INTERNAL_RESPONSE`, `SUSPENDED` | `waiting-on-others` | `waiting-on-others` |
| `closed` | `SOLVED` | `closed` | `closed` |

An errand suspended until a time in the future is `waiting-on-others` whatever its status. That `PENDING` means the
reporter has to answer is an assumption to confirm per namespace.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks`. Required; HTTPS outside the local development allowlist |
| `PORT` | Default 4050 |
| `SM_ADAPTER` | `fixture` (default, made-up errands) or `api` (SupportManagement) |
| `SM_AUDIENCE` | The audience the person's token is issued for. Default `supportmanagement`. It is part of the manifest, so refresh the manifest in Clew after changing it |
| `SM_SOURCE_LABEL` | The system's name as a person reads it. Default `Ärendesystemet` |
| `SM_URL` | The API base, the gateway's address for SupportManagement. Required for `api`; HTTPS outside localhost |
| `SM_MUNICIPALITY_ID` | The municipality id, part of every path and ref. Required for `api` |
| `SM_STATUS_KINDS` | JSON object, status name to `new`, `open`, `waiting-reporter`, `waiting-other` or `closed`: `{"UPSTART":"open"}` |
| `SM_NAMESPACE_LABELS` | JSON object, namespace to the name a person reads, used where SupportManagement sends no `namespaceDisplayName` |
| `SM_NAMESPACE_LINKS` | JSON object, namespace to an address with `{errandNumber}` in it: `{"IK":"https://…/arende/{errandNumber}"}` |

None of these decide access. A namespace missing from the labels or links is shown by its code, without a link.

## The fixture

`errands.mjs` holds a made-up SupportManagement: three namespaces (`KC` Kontaktcenter, `IK` Intern kundtjänst, `LOP` Lön
och pension), each handled by one AD group, and seven errands. It reads the person from the token's
`preferred_username`, requires the configured audience and an unexpired token, and applies the access rule itself. It
does not check the token's signature, which is acceptable for made-up data only.

| Account | Groups | Sees |
|---|---|---|
| `mikael` | `sg-intern-kundtjanst` | Three errands assigned to him and one in the group's queue, in `IK` |
| `karin` | `sg-kontaktcenter` | One assigned errand in `KC` |
| `hillevi` | none | Nothing assigned; two errands she reported in `IK` |
| `hassan` | none | Nothing assigned; errands he reported in `IK` and `LOP` |

The accounts are the development realm's synthetic users (`karin` exists only in the tests).

## Run and check

With the local Clew stack running, inside the devcontainer:

```sh
docker exec -w /workspace clew-app-1 bun scripts/auth-setup.ts
docker exec -w /workspace -e CLEW_CONNECTOR_SECRET=local-docs-only-transport-key -e CLEW_URL=http://127.0.0.1:3000 clew-app-1 node connectors/supportmanagement/server.mjs
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://127.0.0.1:4050 --id sm --secret local-docs-only-transport-key
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts sm http://127.0.0.1:4050 --secret local-docs-only-transport-key
```

`auth-setup.ts` creates the Keycloak client `supportmanagement` and the scope `supportmanagement-audience` that the
token exchange needs. The checker has no session, so it expects the delegated reads to be denied. The last command
creates a draft registration; choose its audience and enable it under Administration › Anslutna system. The key above is
for local development only.

Tests: `bun test tests/unit/supportmanagement-connector.test.ts`: the fixture behind the connector, the mapping, and the
API adapter against recorded answers in the shape asked for above.

## What it never does

It does not store anything, keep a person's errands or token between requests, write to SupportManagement, push cards,
send `X-Sent-By`, log request or response bodies, or pass on SupportManagement's error text. The only thing kept in
memory is a namespace's metadata (display names), for ten minutes.

## Unverified

- The API adapter has not met a SupportManagement: `errands/mine` does not exist, and the two existing reads have not
  been called with a user token.
- Whether the identity provider supports token exchange for this audience, and whether the gateway can pass a user
  token through.
- Which claim identifies the person to SupportManagement.
- The status meanings above, per namespace.
- The view has not been through a screen reader, and the connector has no test in `tests/a11y` (it adds no route or
  component: Clew draws the declared views).

Node's official image is MIT. The connector has no other dependency.
