# D147 · A person links an account once where a system issues its own credential, and Clew holds the token

**Status:** provisional (drafted 2026-11-24 with four choices left to the product owner, who took them on 2026-11-25: "as drafted, and include a service we can test this with, either a custom one via orbstack or some widely available service". Nothing is built. Accepted when item 15 holds. The number is the next unused one on 2026-11-25 and is taken again from the generated index when the change lands on `main`.) · **Date:** 2026-11-25 · **Area:** identity, integrations

**Context.** Clew has one way to act as a person against a system: a connector declares `delegation`, and Clew
trades the person's signed-in session for a short-lived token at the identity provider (D26, D89,
[D103](D103-the-session-that-asked-stands-behind-delegated-work.md)). It works only where the system accepts the
identity provider's token for its own audience. Nothing is stored, so with no live session a write stops at
`needs-session` and a scan answers `authorization-required`.

Three systems read so far cannot take that token. Frappe HR, the second source of
[D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) item 3, accepts a
bearer token only when its own authorization server issued it. An open-source bookkeeping product read on 2026-11-24
does the same. POB takes no token of a person at all. The open question "What must a system offer before it is
connected?" in [open questions](../maintainers/open-questions.md) already names the second form: "a credential the
system issues per user". D103 ends on it: "Work in the background for a person who is away needs a credential the
source issues".

The product owner, 2026-11-24: "this is something that will need to be managed anyways, there are probably multiple
integrations that wont be able to connect via the oidc like we want. This is the same we have implemented on eneo for
oauth2.1". Eneo's implementation is its pull request "Eneo as an OAuth 2.1 client toward MCP servers"
(https://github.com/eneo-ai/eneo/pull/1119, open against `develop` on that date). This record takes its design and
says where Clew's differs. The pull request's description and its connection, token provider and connect service
files were read; it was not run.

**Decision.** General, for every connector, never per system.

1. **Two ways to act as a person, and a connector declares one.** Beside `delegation: { audience }` the manifest may
   carry `linkedAccount: { resource, scopes? }`: the address of the system the connector calls and, optionally, the
   scopes it needs. A manifest with both is refused. Token exchange stays the form Clew prefers, because the person
   links nothing and the system decides access from the installation's own sign-in. A linked account is for a system
   that cannot take that token. As with the audience (D89 item 1), the address is the installation's and is part of
   the manifest the connector serves.

2. **Clew is the OAuth client and holds the tokens.** The connector holds none. Before a call Clew obtains a fresh
   access token and sends it in the header a delegating connector already reads, `X-Clew-Delegated-Token`. The
   connector forwards it to its system and stores and logs nothing, as today. So one implementation serves every
   connector, and a connector written by a third party never holds a person's long-lived credential.

3. **Discovery and client identity follow the standards, in Eneo's order, and a system without them is entered by
   hand.** From `resource` Clew reads the protected resource metadata (RFC 9728) and the authorization server's
   metadata (RFC 8414), and checks the issuer. Its client identity is, in this order: a client an administrator
   registered at the system and entered on Administration › Anslutna system; a client metadata document Clew serves;
   dynamic registration (RFC 7591). The grant is the authorization code with PKCE (S256), the `resource` parameter
   (RFC 8707), a state used once and the issuer checked on return (RFC 9207). A system that publishes no metadata is
   still connected: an administrator enters its authorization and token addresses beside the client. Clew is a
   client without a secret only where the metadata says the server checks PKCE; everywhere else the administrator
   enters a secret, which is sealed. `openid-client`, already pinned, covers this; no dependency is added.

4. **An administrator approves where people are sent.** `linkedAccount` is part of the manifest, so it goes live
   only when an administrator approves it
   ([D144](D144-a-connectors-manifest-goes-live-only-when-an-administrator-approves-it.md)), and D144 item 3's
   review names it as it names the audience of `delegation`: the address, the scopes, and the issuer Clew found
   there. That issuer and the client identity in use are kept with the approved manifest and shown on the
   connector's page. A discovery that later answers another issuer sends nobody anywhere and stops the existing
   links from being used until an administrator approves it.

5. **The link is the person's own record.** One row per person and connector, keyed by the person's id
   ([D122](D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)): the issuer, the resource, the
   scopes, the access and refresh tokens sealed as the installation's signing key is, the expiry, the state
   (`linked` or `needs-link`), the last error as a code, and when it was linked. A token never reaches the browser,
   an audit row, a log line or a trace. The store is a port with a memory and a Postgres adapter and a contract test
   ([D25](D25-use-cases-over-ports-fast-tests.md)).

6. **A person links where the work would have been, in the same tab, and leaves from one place.** Where a list, a
   card or an answer needs a system the person has not linked, Clew does not call the connector. It shows that the
   system needs their account and one button, "Koppla ditt konto". The button goes to a route of Clew's own, which
   redirects to the system's authorization page in the same tab; the system returns to Clew, which returns the
   person to the page they were on. No popup, and no page of another address inside Clew's, so the content security
   policy of [D145](D145-the-web-app-is-served-under-a-content-security-policy-and-keeps-its-cookies-to-its-own-host.md)
   is not widened. The person's linked systems are listed on one page, reached from the person's menu, with when
   each was linked and "Koppla från", which revokes the tokens at the system when it offers revocation and deletes
   the row. That page is new surface: it is drawn before it is built.

7. **Fresh tokens, one refresh at a time.** A stored access token is sent as it is until a minute before its expiry.
   After that Clew refreshes it under a lock in PostgreSQL, so two calls never spend the same refresh token, and a
   rotated refresh token replaces the stored one in the same transaction. A refresh the system refuses for good
   (`invalid_grant`, a 400 or a 401) sets the link to `needs-link` and removes the tokens. A refusal for a passing
   reason keeps the link and answers `source-unavailable`, as a failed exchange does today. A connector whose system
   refuses the token Clew sent answers `authorization-required`, and Clew treats that as a refusal for good.

8. **A linked account stands behind work with no session.** On a connector that declares `linkedAccount`, an
   approved write (dispatch, replay, read-back), a scan, the nightly scan and a job's watch step carry the person's
   token whether or not the person is signed in. `needs-session` does not arise there. What D103 item 2 checks is
   kept: the person is enabled, the connector is in their scope, and the current grant decides what Clew asks for;
   the link adds a token, never authority. The refresh worker's fifteen-minute presence rule (D103 item 4) stays for
   the scans it repeats every minute; the nightly scan is one read per person and day.

9. **A missing link is shown as what it is.** A write approved before the link was lost stays pending with the
   reason `needs-link` and nothing is sent. As with `needs-session`, linking again does not send it: the person
   checks it from its card, and after its 24 hours it fails as `approval-expired`. A scan without a link is blocked
   and existing cards are left alone, as `authorization-required` is today.

10. **Leaving ends the links.** When provisioning disables or removes a person, the use case that rewrites their
    grants deletes their links in the same transaction and revokes them at each system afterwards, best effort.
    Removing a connector, or narrowing its audience so that a person is outside it, does the same for the links it
    covers. Erasure of one person's links is a use case with a scenario test from the first slice.

11. **Audit.** Linking, unlinking and a link lost to a refusal each write a row in the same transaction, with the
    connector and the issuer and never a token or the account's name. A row about a call says which credential stood
    behind it: `linked`, beside D103's `approving`, `checking`, `true` and `idle`.

12. **Not a way in for other credentials.** A person does not paste an API key or a password into Clew. A system
    that offers only a personal key and no authorization server is not connected this way. A system with only a
    service account stays as it is: the connector holds that credential and Clew reads as the installation
    ([D119](D119-the-installation-reads-as-itself-through-a-read-no-person-can-reach.md)); Eneo's `shared` scope has
    no counterpart here.

13. **The protocol.** `linkedAccount` is an optional manifest field, additive under
    [D60](D60-the-instance-serves-its-connector-protocol.md) item 4; the header's description is widened to both
    forms. `connector-check` and the manifest dry run learn the field. As with every optional field, a Clew from
    before this change refuses a manifest that carries it.

14. **What it is tested against.** Three things, and the development stack already runs the software behind the
    first two, so no image is added. Nothing here needs an account at a vendor: a hosted service an installation
    happens to use may be linked the same way, but it is never the repository's test.
    - **The unit suite: an authorization server in memory**, behind the OAuth port, as Eneo's tests have. It answers
      discovery, registration, the code and refresh grants and revocation, and can be told to rotate, refuse and
      expire. The unit suite still needs no Keycloak.
    - **The development stack: a system written here whose authorization server is not.** A second realm, `vendor`,
      in the stack's Keycloak stands for a system's own authorization server, and a fixture connector in a compose
      profile of its own is the system: it serves the protected resource metadata that names the realm, accepts only
      that realm's tokens, and holds a few requests that wait for a person's approval. `scripts/auth-setup.ts`
      creates the realm with refresh tokens rotated, registration open to Clew's own address, consent asked, and the
      `clew` realm as its identity provider, so a person signs in once and meets a consent page. Keycloak 26.2.5 as
      it runs in the stack advertises the authorization server metadata, PKCE with S256, the refresh grant, a
      revocation endpoint, a registration endpoint and the issuer on return; it advertises no client metadata
      documents and no resource indicators, so those two are sent and not proven here. This is where discovery,
      dynamic registration, rotation, revocation and a link taken away are exercised on every change.
    - **The outside test: Nextcloud's own OAuth 2 server, on the Approval loop.** The stack's Nextcloud (35.0.2)
      ships an authorization server of its own beside `user_oidc`. The Approval connector of D101 gets a second way
      to be configured, declaring `linkedAccount` where it declares `delegation` today, and nothing else in it
      changes: the same files, the same approve and reject, the same read-back, the same seeded approvers. So the
      two forms are compared on one loop against one product that was not written for Clew. This server is the old
      kind on purpose: at that version it publishes no metadata, checks no PKCE, has no revocation endpoint and no
      registration, issues an hour's access token and rotates the refresh token on every use; a client is made with
      `occ oauth2:add-client`. It is what proves item 3's addresses entered by hand and its rule on secrets.
    Frappe HR stays the second source of D101 item 3 and follows this: it is the one real product read so far with
    discovery and registration of its own, and its thirty-day cleanup is a case neither test above has.

15. **Accepted when**, signed in on the development stack with the Approval connector linked through Nextcloud's own
    server: two approvers have linked and see different files; the nightly scan made a card for a person with no
    session; an approved decision was written and read back with the page closed; a link taken away in Nextcloud is
    shown as `needs-link` and linking again restores the list; a person disabled by provisioning has no link left;
    the fixture of item 14 has passed discovery, registration, rotation and revocation; and the linking flow has had
    one manual pass with a screen reader
    ([D102](D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md)).

**Why.**

- *Clew holds the token, not the connector.* The
  [review of 2026-11-10](../reviews/2026-11-10-an-open-source-product-as-the-first-real-integration.md) had the
  connector keep the refresh token. That would put a person's long-lived credential in every connector that needs
  one, in a container Clew treats as untrusted (D21), and each connector would write the flow, the refresh, the lock
  and the revocation again. In Clew it is written once, sealed with the key Clew already guards, and deleted in the
  transaction that removes the person. This is the one place where D103 item 1, "what is kept is a reference, never
  a token", no longer holds.
- *The same header.* A connector cannot tell, and need not, whether the token came from an exchange or from a link.
  That is why the Approval connector can be tested both ways with one change to its manifest.
- *A redirect in the same tab, not a popup.* Eneo opens a popup from the chat. Clew's rule is that nothing opens
  over a page ([interface spaces](../reference/interface-spaces.md)), and focus returning from another window is
  hard to make reliable for a screen reader. Eneo's pause of a running turn is not carried over for the same reason:
  the list or card says what is missing and the person asks again after linking.
- *The nightly scan as the person.* D103 kept scans to a person who is present, partly because
  [D100](D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md) promises that work reaches a person through an
  open page. D101 item 3 chose the second source to test "work in the background as the person", and a link that
  still needed a session would test nothing D103 did not. A card can now be waiting when the person arrives.
- *Three tests, not one.* A fixture written here, with an authorization server written here, would be the closed
  loop the project review of 2026-11-10 found. Keycloak is somebody else's server and Nextcloud is somebody else's
  product; between them they cover the newest and the oldest of what a connected system may offer, and both already
  run in the stack. Frappe HR needs a MariaDB, a Redis and a second application, and its own repository gives no
  pinned way to run it, so it is not what the first slice waits for.
- *PostgreSQL, not Redis.* Eneo keeps the pending state and the refresh lock in Redis. Clew has none; a row with an
  expiry and a row lock do the same work.

**Open.**

- **Is the linked account the same person?** Clew cannot compare today: Frappe HR knows a person by email, Clew by
  its own id and a user name the directory may rename (the open question on which key `Actor` carries, D122 item 6).
  Where people reach the system through the installation's identity provider, the person who links is signed in
  there as themselves, so the common case is right by construction. Until the key is settled Clew records the
  account's subject from the system's user information where there is one, shows the person which account they
  linked, and a connector that can compare the token's account with the assertion's person must refuse a mismatch,
  as the POB connector does.
- **A token that outlives its use.** At the pinned version Frappe deletes a token row thirty days after its access
  token expired, so a person whose link was not refreshed for a month links again. Whether Clew refreshes idle links
  to keep them is not decided; doing so reads nothing but keeps a credential alive for a person who is not using it.
- **Unlinking at a system with no revocation endpoint.** Nextcloud's server has none. Clew deletes its row and the
  token stays valid there until it expires or the person removes it in the system; whether Clew should say so to the
  person, or call a system's own way to remove a token through the connector, is not decided.
- **Signing as a confidential client.** Eneo signs client assertions with a deployment key (`private_key_jwt`). Clew
  has an installation key for connector assertions; whether the same key may identify Clew to an authorization
  server is not decided, and no system read so far asks for it.
- **A silent link.** Where a system and the identity provider both support identity assertion grants, the link could
  be made without the person pressing anything, as Eneo's `id_jag` strategy does. Not planned.

**Not covered.** The model reaching a system the person has not linked: the assistant is told the system needs the
person's account and says so; it never starts a link. Systems that take only a service account (POB) still need the
numbered record their README asks for. Eneo's own MCP servers are Eneo's to connect; this record does not make Clew
an MCP client (D81's lane stays withdrawn).

**Amends.** D103 item 1 and its "Not covered" for a connector that declares `linkedAccount`: a token is stored,
sealed, and work in the background has a credential. D144 item 3's review gains the field. D101 item 3 keeps Frappe
HR as the second source, after the test on Nextcloud's own server. D89 is unchanged for a case system that takes the
identity provider's token. It answers the second form in the open question "What must a system offer before it is
connected?" without settling the rest of that question. D45, D47, D75, D86, D121 and D145 are unchanged.

## As built

Three slices on the branch `linked-accounts`, 2026-11-25: everything but the pages and the administrator's review,
with the development stack's test run against the real Keycloak. A person cannot link from the web app yet, so the
branch is not ready for `main`.

- **The protocol.** `LinkedAccountSchema` and the manifest's `linkedAccount` in
  [protocol.ts](../../packages/connectors/src/protocol.ts); the rule that a manifest declares one way and an address
  Clew can discover from, `actsAsProblems` in [validation.ts](../../packages/connectors/src/validation.ts), applied by
  the loader, placed in the preview and listed as `acts-as-one-way` in the manifest reference. The error code
  `authorization-required` is new (item 7): a connector answers it with a 403 when its system would not take the
  token, and Clew answers a caller with it when the person has no link. `connector-check` names the field.
- **The module** [linked-accounts](../../apps/server/src/modules/linked-accounts/usecases.ts): `approve` for item 4,
  `begin` and `complete` either side of the system's page, `tokenFor` before a call, `refused` after one, `list`,
  `unlink`, and `forgetPerson`, `forgetConnector` and `forgetLink`. The rules of items 3 and 7 are pure functions in
  `domain.ts`. The audit actions are `account.server-approved`, `account.client-registered`, `account.linked`,
  `account.unlinked` and `account.link-lost`; a refresh that succeeds writes none.
- **The OAuth port** over `openid-client` in
  [adapters/oauth.ts](../../apps/server/src/modules/linked-accounts/adapters/oauth.ts). The server metadata is looked
  for at RFC 8414's place and then after the issuer's path, where Keycloak serves it. A failure is final or passing
  (`refusalOf`), and only a final one loses a link.
- **The store**: four tables (`linked_account`, `linked_account_pending`, `linked_account_client`,
  `linked_account_server`, migration `0001_linked_accounts`), with every token, verifier and client secret sealed
  under the installation's key and bound to its person and connector. One contract runs on the memory and the
  Postgres adapter. A link is held by the transaction that refreshes it, the refresh request included: that is the
  lock of item 7, and the request's ten-second limit bounds it.
- **The token on a call.** Bound once, where the server builds a connector's transport
  ([remote.ts](../../apps/server/src/connectors/remote.ts), `useLinkedAccounts`), so every path gets it without
  threading: a request, an approved write, a scan, a document read and a question to the source's assistant.
- **The ledger.** `needsLink` beside `needsSession`: the link's token is asked for before the dispatch is recorded,
  a write whose link is gone waits unsent with `needs-link`, and the dispatch's audit row says `credential: linked`.
- **The routes** under `/api/linked-accounts`
  ([linked-accounts.ts](../../apps/server/src/routes/linked-accounts.ts)): the list, the start, the callback and the
  removal.
- **Evidence**: the scenarios run the real OAuth client against
  [an authorization server in memory](../../tests/authorization-server.ts), of today's kind and of the older kind,
  and assert the audit rows ([use cases](../../tests/unit/linked-accounts.test.ts),
  [calls](../../tests/unit/linked-account-calls.test.ts), [the ledger](../../tests/unit/linked-executions.test.ts),
  [routes](../../tests/unit/linked-account-routes.test.ts)).

- **The development stack's test** (item 14, the second of the three): the realm is made by
  [vendor-realm.ts](../../scripts/vendor-realm.ts), the system is the fixture connector
  [purchasing](../../connectors/purchasing/README.md) in the compose profile `linked`, and
  [linked-account-check.ts](../../scripts/linked-account-check.ts) runs the whole of it against the real Keycloak
  without a browser: discovery, registration, two people who sign in and consent at the realm's own pages, calls with
  no session, a scan, a decision and its read-back, the rotated refresh token, a link the system takes away and one
  the person takes away. **Run on 2026-11-25** against Keycloak 26.2.5, on a database of the branch's own, twice:
  all 21 checks held both times, and the second run registered no new client. What it showed for the first time
  against a server not written here: the realm's metadata is found after its issuer's path, where the adapter looks
  second; Clew registers itself as a client without a secret and the realm then asks the person's consent; the code
  is redeemed with PKCE and the issuer on return; a one-minute access token is refreshed on the next call and the
  refresh token rotated; the spent one is refused; a session ended at the realm loses the link as `invalid_grant`
  with its audit row; and unlinking is revoked there. No code of Clew's or of the fixture's changed for it. The
  check's own driver of Keycloak's pages did, twice: it loads connectors through the server's composition, since the
  registry's governance is installed there, and it resolves a form's address against its page.

Where it differs from the items above:

- **Item 4.** The approval is kept in the module's own table and made by an operator with
  `bun scripts/connector-link.ts <connector id>`. D144's review does not name the field yet, and no page enters
  addresses.
- **Item 6.** The button does not go to a route that redirects. The page asks `POST /api/linked-accounts/:connector/link`
  for the system's address, with the session's CSRF token, and then leaves for it in the same tab: a link that could
  be started by a plain address could be started by any other site.
- **Item 10.** A deactivation removes the person's links in the SCIM transaction, through the people module's leavers
  port, with their audit rows. It does not revoke them at the system: that transaction waits for no network, and the
  tokens are gone when it commits. `forgetPerson` revokes, for an operator's own removal.

- **Item 14.** The realm `vendor` has accounts of its own for the stack's personas, with the test passwords they
  already have, and the `clew` realm is not its identity provider: the check signs in at the realm's own form, which
  brokering through a second realm would make two forms and a first-login page. The fixture checks a token's
  signature, issuer and expiry and not its audience, since Keycloak 26.2 does not bind a token to the `resource`
  Clew names. Where Clew's actor carries a user name, the fixture refuses an account with another name, which is the
  mismatch the open item on "the same person" asks a connector to refuse.
- **The conformance check.** `connector-check` takes `authorization-required` from a connector that declares
  `linkedAccount` as the expected answer, on a capability and on the scan, and says the scan is not verified.

Not built: both pages and anything in the web app that starts linking; the administrator's review and the entered
addresses on Administration › Anslutna system; a client metadata document served by Clew; the callback for a person
whose session ended while they were at the system; and, of item 14, the outside test against Nextcloud's own server.

## Sources

- Eneo's pull request, read 2026-11-24 on its branch `feat/mcp-oauth-client`: the description, and
  `mcp_oauth_connection.py`, `mcp_oauth_token_provider.py`, `mcp_oauth_service.py` and `mcp_oauth_table.py` under
  `backend/src/eneo/`.
- Frappe at tag `v16.60.2` and its HR app at `v16.60.0`, read the same day and not run: PKCE (S256) and refresh
  tokens in `frappe/oauth.py`; the two metadata documents and dynamic registration, on by default, in
  `frappe/integrations/oauth2.py`; a bearer token accepted only from its own table in `frappe/auth.py`; the
  thirty-day cleanup in `frappe/hooks.py` and the bearer token doctype.
- The stack's Keycloak (26.2.5), asked 2026-11-25 for the `clew` realm's
  `/.well-known/oauth-authorization-server`. The realm `vendor` does not exist yet, and registration, rotation and
  brokering between the realms were not run.
- Nextcloud at tag `v35.0.2`, read 2026-11-25 and not run: `apps/oauth2/appinfo/routes.php` (an authorize route and
  a token route, nothing else for a client), `OauthApiController.php` (the two grants, the hour, the rotation) and
  `Command/AddClient.php`. The access token is an app token made through core's token provider, and core's
  `Session::tryTokenLogin` takes an app token from a `Bearer` header; that the Approval app's routes answer one was
  not run.
- Clew: `DelegationSchema` in [protocol.ts](../../packages/connectors/src/protocol.ts), `delegated` in
  [remote.ts](../../packages/connectors/src/remote.ts), `sealSecret` in
  [auth-crypto.ts](../../apps/server/src/auth-crypto.ts), "Authenticate to the source" in
  [Authorization](../guides/authorization.md), and the
  [Approval connector](../../connectors/nextcloud-approval/README.md).
