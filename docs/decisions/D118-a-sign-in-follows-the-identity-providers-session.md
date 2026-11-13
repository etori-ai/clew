# D118 · A sign-in follows the identity provider's session, and a sign-out there ends Clew's

**Status:** provisional (taken in the fixes of [the review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md), Q9, L5 and L9, on the product owner's word of 2026-11-12 to fix every finding and take every open decision), built 2026-11-12; accepted once an organisation's own identity provider, outside the development stack, has signed a person in to Clew by single sign-on and ended that Clew session with its own sign-out · **Date:** 2026-11-12 · **Area:** identity

**Decision.**

1. **A sign-in follows the identity provider's session.** The authorization request carries no `prompt` and no
   `max_age`, and the code is redeemed without `maxAge`, so the ID token needs no `auth_time` (`authorizationUrl` and
   `redeemCode` in `apps/server/src/auth-login.ts`). A person who is already signed in at the identity provider reaches
   Clew without entering a password again. The rest is as before: the Authorization Code flow with PKCE, `state` and
   `nonce`, and an opaque session cookie. A Clew session lasts at most eight hours.
2. **A fresh prompt is the identity provider's policy.** An organisation that wants people to prove themselves again at
   each sign-in, on shared computers for example, sets it in the identity provider: in Microsoft Entra ID, a Conditional
   Access policy with the sign-in frequency "Every time"; in Keycloak, the realm's authentication flow and session
   settings. Clew has no setting for it.
3. **A refresh ends the session only on an answer that a new sign-in alone can heal.** While a person works, Clew
   refreshes the identity provider's tokens when 15 seconds or less are left, and it stores a token as lasting at most
   300 seconds. The identity provider is therefore asked at least every five minutes during use.
   - These end the Clew session with a `refresh-failed` row in the authentication log: the answers `invalid_grant`,
     `interaction_required`, `login_required` and `consent_required` (`grantEnded` in
     `apps/server/src/auth-refresh.ts`), a refreshed ID token for another subject, and sealed tokens that can no longer
     be opened. An abandoned refresh claim whose 30-second window elapsed ends it the same way, since its owner may
     already have consumed the refresh token. A session row that is gone ends it with an `expired` row. The request is answered 401 with
     "Din inloggning har gått ut. Logga in igen.".
   - Everything else keeps the session and its tokens: `invalid_client` after a secret rotation, 429, any 5xx, a refused
     connection, a name that does not resolve, a timeout and an answer that does not conform. Clew's own pages go on,
     since its authorization never reads the identity provider's tokens. Only delegation waits: a connector that acts as
     the person gets no token until a refresh succeeds, and the request is answered 503 with
     "Tjänsten går inte att nå just nu.". An approved write that meets this is settled with the reason
     `source-unavailable`, and the person checks it again from its card.
     This gate also applies before a cached exchanged token is returned: every delegation request reads the live
     session and checks refresh availability, even when that audience's exchanged token has not expired.
   - After such a failure the session waits 30 seconds before it asks again. Each server process logs the failure at
     most once a minute, as the warning "token refresh failed; sessions are kept and delegation waits", scope `auth`,
     with the error's code and the HTTP status.
   - A short database write claims the session's current token generation before the provider is asked. A random
     claim id fences token storage, release and terminal updates; no connection stays held during provider I/O. A
     request in another process waits up to two seconds for the answer, then uses the new tokens or keeps local access
     while delegation answers 503. An expired claim is ended, never taken over and retried: a process may have died
     after the provider rotated the token. A provider answer that could not be stored leaves that claim in place.
4. **A sign-out at the identity provider ends the Clew session**, by one of two OpenID Connect standards.
   - **Back-channel logout** (Back-Channel Logout 1.0), as before, for a provider that offers it, such as Keycloak. The
     provider posts a logout token to `POST /api/auth/backchannel-logout`. The token must be signed RS256 by the
     configured issuer for Clew's client, be at most five minutes old, and carry a `jti`, the back-channel event and no
     `nonce`. It ends the open sessions under the configured issuer and client that match its `sid` and its `sub`,
     whichever it carries, with one `backchannel-logout` row each. A receipt for each `jti`, kept five minutes, makes a
     replayed token end nothing. A refused token is answered 400 with "Ogiltig utloggning." and logged as the warning
     "back-channel logout refused".
   - **Front-channel logout** (Front-Channel Logout 1.0), new, for Microsoft Entra ID, which has no back-channel logout.
     The provider's sign-out page loads `GET /api/auth/frontchannel-logout` in the person's browser, with `iss` and
     `sid` in the query. A `sid` with an `iss` equal to the configured issuer, or a `sid` without an `iss`, ends every
     open session of that `sid` under the configured issuer and client as back-channel logout does: the session is
     revoked, its tokens are emptied, and it gets one `frontchannel-logout` row, actor `person:<id>`. An `iss` that is
     given and is not the configured issuer, an empty one included, ends nothing: the answer is 400, and the server logs
     the warning "front-channel logout refused", scope `auth`, with the error's name and code and never the `sid` or the
     `iss`. A failure to end the sessions, a database that does not answer for example, is answered and logged the same
     way. A request whose `iss` is absent or the configured issuer, and whose `sid` is absent or empty, ends nothing
     and is answered 200. Every answer has an empty body and `Cache-Control: no-store`. The route asks for no session,
     origin or CSRF token, since no cookie reaches the provider's frame and the request ends only what the provider
     names. It keeps no receipt: there is no token to replay, and a repeated request ends nothing more.
   - Clew keeps the `sid` of the ID token with the session, and a session without one cannot be ended by front-channel
     logout. Entra sends `sid` only as an optional claim, so the Entra team adds the `sid` optional claim to the ID
     token and enters `<public address>/api/auth/frontchannel-logout` as the app registration's front-channel logout
     URL. The person's browser loads that address, not the provider's server, so the reverse proxy must let browsers
     reach it.
5. **"Logga ut" in Clew** revokes the Clew session with a `logout` row and sends the browser to the identity provider's
   end-session page with `client_id`, Clew's own `/login` as the address to return to, and `ui_locales` `sv`. It never
   puts a token in the address, so it sends no `id_token_hint`. The provider's own session therefore ends only when the
   person confirms there: Keycloak asks, and Entra shows an account picker. A provider session left open lets the next
   "Logga in" in the same browser enter the previous person's account without a prompt, so on a shared computer the
   policy of item 2 is the answer.

**Why.** Every sign-in sent `prompt=login` and `max_age=0` and redeemed the code with `maxAge: 0`, from the first commit
and in no record (L9). Microsoft documents that `prompt=login` forces the person to enter credentials and bypasses
single sign-on. `maxAge: 0` also made `auth_time` a required claim, so an ID token without a fresh one failed the
sign-in, with no log line and no row in the authentication log.

In an organisation of several thousand employees, a password at every sign-in to one application, on top of the second
factor the identity provider already asks for, is thousands of extra password entries a day. It teaches people to type
their password whenever a page asks, which is what phishing relies on, and it protected Clew alone while every other
application followed the provider's session. Under OpenID Connect the identity provider owns authentication policy, as
[D05](D05-oidc-and-oauth-only-identification-path.md) puts access policy there. Conditional Access can treat a shared
computer differently from a personal one, by device, location or group, which one flag in Clew cannot. A leaver needs
nothing from this record: the provisioner's deactivation ends their session at its next request, and a provider that has
ended a session refuses its next refresh.

**Weighed and left.**

- Keeping the forced prompt, with its cost above. It did not protect a shared computer either: a person who walks away
  without signing out leaves the session open for its eight hours either way.
- A setting in Clew for a fresh prompt: a second place for a policy the identity provider already holds, which every
  installation would have to set and keep in step with it.
- Shorter sessions: more sign-ins for everyone, and still an open window between them.
- Back-channel logout alone, as before. Entra has none: its sign-out loads a front-channel `GET`, which Clew answered
  404, so on a shared computer the next person could go on in the last person's Clew session for up to eight hours,
  while the operations guide's "Done when" said that a sign-out at the provider ended it (L5). The review's fix only
  documented the gap. Once a sign-in follows the provider's session, a sign-out there has to reach Clew too.
- OpenID Connect Session Management, in which a frame in Clew polls the provider's session: it needs the provider's
  cookie in a third-party frame, which browsers block. The front-channel request needs no cookie.

Front-channel logout is an OpenID Connect standard on one route, not new surface under the freeze of
[D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md).

Two choices were made in the build. A `sid` without an `iss` is taken as the configured issuer's. The specification
sends `iss` with `sid`, and Microsoft's MSAL documentation says Entra sends both, but NGINX's guide for Entra says it
sends only `sid`. Clew has one issuer, whose name is public, so requiring it would protect nothing and could leave the
feature dead on Entra. An `iss` that is given and wrong is still refused. And the action in the authentication log names
the channel, `frontchannel-logout` beside `backchannel-logout`, because that table has no column for details, so the
channel needs no change to the schema.

**Limits.**

- With neither channel set up, a sign-out at the provider reaches Clew only when the provider refuses the next refresh.
  A provider that keeps refreshing after its own sign-out leaves the Clew session open until it expires.
- Front-channel logout depends on the person's browser: it ends Clew's session only if the provider's sign-out page
  loads the address. A browser closed first, or one that blocks the frame, leaves the session until a refresh is refused
  or the session expires.
- A request that names a live `sid` ends that session whoever sent it, as the specification accepts. It can do nothing
  else.
- Token rotation and a lost reply remain ambiguous: a timeout or disconnect may occur after the provider consumed
  the token. The nonterminal failure policy above keeps the session and allows a later attempt; a provider that
  revoked the token may then require a new sign-in. The database claim prevents concurrent healthy BFFs from issuing
  the same generation's grant, not loss of an external response. Claim deadlines use the BFFs' wall clocks, which
  operators must keep synchronized. An owner stalled beyond 30 seconds can conservatively lose its session.
- Migration `0057_session_refresh_claim` adds the claim fields. Stop all older BFF instances before starting the new
  release: an old binary does not acquire the claim, so overlapping versions do not have the new concurrency guarantee.

**As built.** `authorizationUrl` and `redeemCode` in `apps/server/src/auth-login.ts`; `grantEnded`, `sessionRefresher`
and `failureDetails` in `apps/server/src/auth-refresh.ts`; `authenticate`, `logout`, `receiveLogout` and
`receiveFrontChannelLogout` in `apps/server/src/auth.ts`; `POST /api/auth/logout`, `POST /api/auth/backchannel-logout`
and `GET /api/auth/frontchannel-logout` in `apps/server/src/routes/auth.ts`; `endProviderSessions`, `backchannelRevoke`
and `frontchannelRevoke`, `claimSessionRefresh`, `releaseSessionRefresh` and `storeRefreshedTokens` in
`packages/db/src/auth.ts`. Tests: `tests/unit/auth-login.test.ts` (no `prompt` and no
`max_age`, and an ID token without `auth_time` signs in), `tests/unit/auth-refresh.test.ts` and
`tests/db/session-refresh.test.ts` (each kind of failure, and delegation's 503 against a provider that cannot be
reached, two independent BFFs sharing one claim, a subsequent rotation, abandoned ownership, late logout and fenced
terminal writes), `tests/unit/auth-routes.test.ts` and `tests/db/sign-in-routes.test.ts` (both channels, their answers and
their log lines, and a cross-site frame without a cookie), and `tests/unit/auth-failure.test.ts` (what a log line about
a failure may carry). The development sign-in ([D06](D06-dev-login-local-only.md)) uses the password grant and never
the browser's session at the provider, so this record does not change it.

**Replaces.** Nothing numbered. [D05](D05-oidc-and-oauth-only-identification-path.md) chose the Authorization Code flow
with PKCE and an opaque server session, and put access policy in the identity provider; it said nothing of a prompt,
which was in the code alone. Back-channel logout was described only in the identity page and the operations guide; this
record now holds it beside front-channel logout. How a sign-in binds to a person is
[D68](D68-people-are-pushed-into-clew-through-standard-scim.md) item 6, as amended on 2026-11-12 (L2, Q8); this record
does not change it.
