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

6. **A person links where the work would have been, in a window of its own, and leaves from one place.** Where a
   list, a card or an answer needs a system the person has not linked, Clew does not call the connector. It shows
   that the system needs their account and one button, "Koppla ditt konto". The button opens the system's
   authorization page in a small window of its own, and the page the person was on stays as it is. The system returns
   that window to Clew, to a page that tells the page that opened it and closes itself; the page that stayed says
   what happened and reads the system again. A browser that opens no window leaves the redirect: the page leaves for
   the system in the same tab, and the system returns to Clew, which returns the person to the page they were on.
   No page of another address stands inside Clew's, so the content security policy of
   [D145](D145-the-web-app-is-served-under-a-content-security-policy-and-keeps-its-cookies-to-its-own-host.md)
   is not widened. (Amended by the product owner on 2026-11-25, on meeting the redirect in the built pages: the
   item first said the same tab and no popup. The redirect is kept as the way when no window opens.) The person's linked systems are listed on one page, reached from the person's menu, with when
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
- *A window of its own, with the redirect behind it.* The draft chose a redirect in the same tab, because nothing
  opens over a page ([interface spaces](../reference/interface-spaces.md)) and because focus returning from another
  window is hard to make reliable for a screen reader. The product owner met the redirect in the built pages and
  chose the window, as Eneo opens one: the page keeps what was on it, a person with several systems to link stays on
  one page, and the two products link an account the same way. The rule of the interface spaces is about showing a
  thing of Clew's; the window shows another system's own sign-in, which Clew could not draw in any case. What the
  draft feared is met in three ways. The outcome is said in the page's toast, which a screen reader hears; a button
  that went away with its line hands the focus to a named place; and the redirect stays for a browser that opens no
  window. The window can reach the page that opened it, as any window a page opens can, which is no more than the
  redirect gave the same server: a page of an authorization server that an administrator approved. Eneo's pause of
  a running turn is not carried over: the list or card says what is missing and the person asks again after
  linking.
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

Four slices on the branch `linked-accounts`, 2026-11-25: everything but the administrator's review, with the
development stack's test run against the real Keycloak. The fourth slice is the pages, drawn first and chosen by the
product owner the same day (canvas "Clew · linking an account (D147)",
`https://claude.ai/artifact/MCGMtaNHsp2ShnkR4Fg49u`): a person links, puts off and ends a link from the web app.

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

- **In the running server**, the same day, on the development stack with the fixture as the compose service: the
  flow was started from the signed-in app and reached the realm's sign-in page; with one persona linked, the
  background scan raised the card "Inköp att godkänna" on Hem with that person's two requests, and approving one from
  the card went through the human decision endpoint and the ledger and was read back, its dispatch row saying
  `credential: linked`. This found what neither the scripts nor the unit suite could: the composition read
  `PUBLIC_URL` and the local-http setting when its module was loaded, before the server has read its settings file,
  so every link was refused there. Both are now read at each use, and a refusal's reason is logged. Nothing in the
  web app starts linking yet: the start was a call from the browser's console.

- **The outside test** (item 14, the third of the three), run on 2026-11-25 against the development stack's
  Nextcloud 35.0.2 with [linked-account-nextcloud-check.ts](../../scripts/linked-account-nextcloud-check.ts), four
  times. Every check held from the second run; the first run's one failure was the check's own expectation about
  Nextcloud, below. The Approval connector of D101 runs in its linked mode
  (`NEXTCLOUD_ACCOUNT=linked`), and nothing else in it changes. A client is made in Nextcloud with
  `occ oauth2:add-client`; the authorize address as a browser reaches Nextcloud, the token address as the server
  reaches it, and the client with its secret are entered, since Nextcloud publishes nothing to discover. Two people
  sign in at Nextcloud's own sign-in page and grant access on its own page; Nextcloud answers the code with tokens
  though it is sent PKCE and a resource it does not know; each person reads their own waiting files (three and two,
  none shared) and a scan raises a card per file, with no session; a token made to look due is refreshed and the
  rotated refresh token kept; a file is approved in Nextcloud and read back (and undone with the seed's reset); a
  token removed in Nextcloud makes the connector answer `authorization-required`, the link is lost as
  `refused-by-system` with its audit row, and linking again restores the list. Clew's code did not change for it.
  What it showed about the product:
  - Nextcloud keeps taking the access token a refresh replaced, for a while. Clew never sends it again, so nothing
    follows from it here.
  - A token Clew drops when a person unlinks stays valid at Nextcloud: it has no revocation endpoint. Nextcloud's own
    call to remove a token (`DELETE /ocs/v2.php/core/apppassword`, as the token) does end it. That is one answer to
    the open item on unlinking, and it would be the connector's to make.

Where it differs from the items above:

- **Item 4.** The approval is kept in the module's own table, not with the approved manifest. Until 2026-11-25 only
  an operator made it, with `bun scripts/connector-link.ts <connector id>`; the connector's page now does (below).
  A system that names another server sends nobody new anywhere, as the item says, but the links to the approved
  server are used as before until an administrator approves the new one: a call sends the token it holds and
  refreshes it at the approved server's own addresses. The item says the links stop being used meanwhile. The page
  says what is built, and which of the two should hold is the product owner's to decide.
- **Item 6.** The button does not go to a route that redirects. The page asks `POST /api/linked-accounts/:connector/link`
  for the system's address, with the session's CSRF token, and then sends its window there (or leaves for it in the
  same tab): a link that could be started by a plain address could be started by any other site.
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

- **The pages (the fourth slice).** Where a system needs the person's account it is said where its content is missing,
  the pattern of D116, never as a banner and never as a counted row (the product owner chose this over a row among
  the rows, 2026-11-25):
  - **Hem**, under the rows of "Behöver dig" after a rule (`AccountLines` in
    [account-lines.tsx](../../apps/web/src/components/accounts/account-lines.tsx)). A link that was lost and a first
    link are two weights of one line. Lost: "<System> godtar inte längre ditt konto", the badge "Behöver kopplas
    igen", since when, "Koppla igen"; it cannot be put off. First: "<System> behöver ditt konto", what the sign-in is,
    "Koppla ditt konto" and "Inte nu". One system of a kind is named and linked from the line; two or more of a kind
    are one line that leads to the page; there are never more than two lines, and when both kinds are several they
    are one line with the lost ones first. The rules and every word are pure functions in
    [linked-accounts.ts](../../apps/web/src/linked-accounts.ts).
  - **"Inte nu"** is `POST /api/linked-accounts/later` and the use case `later`: one row per person and system in
    `linked_account_later` (migration `0002_linked_account_list`), with the audit row `account.link-put-off` in the
    same transaction. Only a system never linked can be put off. Linking takes it up again; a person who takes their
    link away has put the system off by that press, so Hem does not ask for what they just ended. A leaver's rows go
    in the transaction that deactivates them.
  - **The system's own list** (a tool's page): the same line where the rows would have been, with no "Inte nu" and
    no empty state. The capability route answers a read that needs the account with the code
    `authorization-required` beside its 400, which is what the page reads; no other refusal of a source has a code.
  - **A decision that waits** (`needs-link`): its notice's move is "Koppla ditt konto igen" while the account is
    missing, and "Kontrollera status" once it is linked. Linking does not send what waited (as after a new sign-in,
    D45): the person presses.
  - **Back from the system**: the callback's `account` and `system` in the address are read once by the shell, said
    in a toast by the system's name (linked, or failed as an error; a person who declined is told nothing), and taken
    out of the address.
  - **"Kopplade konton"** at `/accounts`, from the person's menu beside "Min sida" when there is a system to list:
    `GET /api/linked-accounts` now answers every system the person may link at (`accounts`, with the system's word,
    the state, since when it is linked or was lost, whether it is put off and whether the system can be told), what
    needs the person first. "Koppla från" is done at once where the system has a revocation address and asked first
    where it has none, since the account then lives on there until the person removes it.
  - `linked_account` has `lost_at`. A system that needs the account is no longer named among the systems that do not
    answer.
  - Read at linking: nothing new was needed. The cards' read asks for a scan of a blocked system again when a person's
    own session visits (`requestChange`), so the system's work comes with the first read after the return.

Linking in a window of its own (item 6 as amended, 2026-11-25):

- The press opens the window itself, before the server is asked, since a browser lets no later window through; the
  window is sent on to the system once the server has answered. One link is under way at a time: a second press, on
  any button, brings the window forward. The link is started with the return page's address and an id the page made
  up (`/accounts/return?link=<id>`), and the return route sends the window there with the outcome.
- The return page (`pages/account-return.tsx`, outside the session's shell and reading nothing) says the outcome on
  a broadcast channel of Clew's own origin and closes. It does not use the window's opener: a system's sign-in may
  cut the two windows apart (a cross-origin opener policy), and the channel reaches the page all the same. The page
  that started the link says it in a toast and puts the focus right; every page of Clew in the browser reads again
  what a newly linked system changes. A window the browser will not close says what happened and that it can be
  closed.
- A window closed with nothing said (the person closed it) puts the button back and reads the accounts again.
- `window.open` answering nothing is the redirect, unchanged from the first build.
- A link that fails once it is known to be the person's own is returned to where it was started, with the system's
  id, in both ways of linking; before, every failure ended on the start page. A return that cannot be placed (an
  unknown or outrun state, another person's) still ends on the start page, and inside the window the return page
  takes it from there.
- Tested in `tests/a11y/accounts.spec.ts` at 1280 and 320 px: the window, the page that stayed, the focus after a
  line went, a browser that opens no window, a closed window, and the return page that cannot close. Not tested:
  a system whose sign-in really cuts the windows apart, and a phone, where the window is a tab.

The administrator's side (items 3 and 4), drawn first and chosen by the product owner on 2026-11-25 (A: the facts
under Översikt, with the count of people):

- **One approval.** The diff of a changed system names `linkedAccount` (`ManifestDiff.linkedAccount`), and the
  review that exists (D144) says it in one row: that people link an account of their own, the server the system
  names, what Clew asks for and how Clew is known there. When the administrator approves the manifest, the server the
  system names is approved in the same request (`approvedWith` on the connector administration, bound in
  composition), with its own audit row `account.server-approved`. It is not one transaction: the server is found by
  asking the system. A system that names none, or does not answer, leaves the manifest approved and the account
  waiting, which the page says with the way on.
- **Under Översikt.** One fact beside "Får personens inloggning" ("Personer kopplar eget konto"), and the block
  "Personernas konton": the server and who named it, how Clew is known there, whether the system is told when a link
  ends, how many people have linked and how many must link again, and who approved it. The count is
  `LinkStore.counts`, grouped in the database: no token is opened and no person is named.
- **A read of its own.** `GET /api/admin/connectors/:id/linked-account` (`overview`) asks the system what it names
  each time, so a changed server is seen before anybody approves it; `POST` on the same address approves
  (`approveEntered`). Both are behind `admin.connectors`, and the approval behind the step-up.
- **States.** `approved`; `waiting` (nothing approved for the address the manifest names); `no-server` (the system
  names none); `no-client` (the server is approved but Clew is no client there and cannot register itself);
  `changed` (the system names another server). Each of the last four is a notice of the page's own kind with one
  button.
- **Entering it.** A dialog with Clew's return address to copy, the client's id and secret, and, only for a system
  that names no server, its three addresses in plain words. An entered server is known by the origin of the address
  people sign in at, since it publishes nothing that names it and the form has no field for an issuer. A secret left
  empty keeps the one saved for the same client; it is never shown again.
- **Another server.** A review that says from what to what and how many people must link again. Once it is
  approved, a person whose link is to the old server is told that the system needs their account before any call
  finds it out (`accounts`).
- Differs from the canvas: the notice for another server says that the linked accounts are used as before (see item
  4 above); the dialog is the page's scrolling dialog frame, so its buttons stay on a low screen; and two states the
  canvas did not draw have words of their own (`waiting` with a server to review, and `no-client`).
- Tested: the use cases with their audit rows, the store's count on memory and Postgres, the routes, the words as
  pure functions, and `tests/a11y/admin-account.spec.ts` at 1280 and 320 px.

Not built: a client
metadata document served by Clew; the callback for a person whose session ended while they were at the system; a
mark on the person's menu when a link is lost (the unsent decision already raises the count).

Open after the pages:

- The dialog for a system that cannot be told says "ta också bort Clew i dina inställningar där". The canvas named
  the place in Nextcloud; Clew does not know a system's own menus, and a connector cannot say them yet.
- A link that is lost while a page is open is seen with the next read of the person's accounts (at most a minute
  old when a page is opened); no change signal says it. Where a session stands behind the scan, the cards' read takes
  the blocked scan up again itself, so its status does not say that the system needs the account.
- A system that stays unlinked is asked for a scan on every read of the cards from a signed-in session, which
  writes a `refresh.requested` and a `refresh.failed` audit row each time. That is how a blocked request has always
  been taken up when its person comes back; with "Inte nu" the state can now last for months.

Against item 15, what holds and what does not: two approvers linked and see different files, a scan with no session
raised their cards, a decision was written and read back with no session, a link taken away in Nextcloud reads as
`needs-link` and linking again restores it, and the fixture passed discovery, registration, rotation and revocation.
Not yet: the scheduled nightly scan itself has not run with a linked account (the scan was asked for directly, and
the ledger's path was run with the purchasing fixture, not with Nextcloud); a person disabled by provisioning losing
their links is unit-tested and bound, not run live; and the pages pass the accessibility suite
(`tests/a11y/accounts.spec.ts`) but have had no manual pass with a screen reader. The record stays provisional.

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
