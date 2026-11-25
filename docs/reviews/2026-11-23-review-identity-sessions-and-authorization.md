# Identity, sessions and authorization, reviewed

Date: 2026-11-23. Asked by the product owner as one of ten areas of a review of the whole repository. Reviewed:
`origin/main` at `9fd4c962`. Review only: nothing was changed, and the fixes come later.

Scope: sign-in and sessions (`apps/server/src/auth*.ts`, `context.ts`, `system-context.ts`, `main.ts`,
`packages/db/src/auth.ts`), the routes `auth`, `scim`, `admin`, `staff`, `capabilities`, `provisioner-keys`,
`appearance` and `health`, the people and appearance modules with their composition, the capability list and the theme
file in `packages/contracts`, the identity tables, the identity scripts, the web image's server, and the tests of all
of these.

Method: every file in scope was read, each route followed to its use case and store. A candidate was reported only
after the path was read end to end, and where a probe could show it, the probe was run in the development container on
the memory adapters (`bun test` on one temporary file, removed afterwards, and `bun -e`). Nothing was run against the
shared database or the running development server, and no suite was run. The earlier SCIM reviews were not repeated;
two automated readers checked whether what their outcome sections say was fixed is in the code, and their answer is
under [The earlier SCIM reviews](#the-earlier-scim-reviews). No person has reviewed these findings.

## Summary

| Severity | Findings |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 6 |

The sign-in itself is sound: state, nonce and PKCE are checked, the session is an opaque cookie over a sealed row, a
new sign-in replaces the old session, every request reads the person's grant again, and a deactivated person's session
ends at their next request. The development sign-in cannot be switched on outside the local stack. Every route in
scope reaches data through a use case that checks the actor, and every administration route has its capability check.

The gravest finding is in the derivation: a group that an administrator has mapped to Kompetenssökning is treated as a
plain group by the SCIM server, so a person the directory takes out of it keeps the relation, and with it the read of
everybody's competence, until something else happens to derive them. Next come a return address after sign-in that
can leave the installation, a unit a person is only placed on that is told to a source as a unit they follow up, and
a web image that sends no framing rule and no content security policy.

## Findings

### 1. High: a SCIM write of a group mapped to Kompetenssökning derives nobody

**Where.** `apps/server/src/modules/people/usecases.ts:324` (`authorityOf`) and
`apps/server/src/modules/people/domain.ts:228` (`givesAuthority`); used by `writeGroup` (line 639), `createGroup`
(line 829) and `deleteGroup` (line 917).

**What.** A group write derives its members only when the group "gives something". `givesAuthority` answers yes for a
reserved key and for a key that one of D85's capability rows names. It is never handed D121's relation rows
(`auth_group_relation`), so a plain group whose only meaning is that it gives `registrar` counts as a group that
gives nothing.

**Scenario.** An administrator maps the directory group `ad:kompetenssamordnare` to Kompetenssökning, as the
development seed does for Hillevi. Later the directory takes Hillevi out of the group and puts Nora in (`PATCH` of the
group's members), or removes the group (`DELETE`). The write answers 200 and writes `scim.group.patched`, but derives
neither of them: Hillevi's grant still carries `relations: ['registrar']`, so she still searches everybody's
competence in the organisation, and Nora, who should, cannot. No `grant.derived` row is written, so the audit trail
says nothing either. The grant is put right only when something else derives the person: a write of their own User
resource, a change of one of their unit or capability groups, or an administrator touching the mapping. A provisioner
that sends only what changed, as the example does, may never send that.

This breaks the rule that the grant is rewritten in the same transaction as the change that moves it (`CLAUDE.md`,
D68, and D121 item 2: "derived into the person's access in the same transaction as the change"). The same holds in
the other direction for a row that outlived its group (D85): when the group is pushed again, its members are not
derived.

**Established by.** A temporary test over the memory adapters, which run the same use case code as PostgreSQL; both
assertions fail on `9fd4c962`:

```ts
test('a member taken out of a group mapped to Kompetenssökning loses the relation in that write', async () => {
  const { s, users, scim, admin, directory } = stack(); // hillevi is the one member of ad:kompetenssamordnare
  await users.addGroupRelation(admin, { groupExternalId: 'ad:kompetenssamordnare', relation: 'registrar' });
  expect(s.grants.get('hillevi')?.relations).toEqual(['registrar']);
  await scim.patchGroup(directory, 'g-ks', patch([
    { op: 'remove', path: 'members[value eq "hillevi"]' },
    { op: 'add', path: 'members', value: [{ value: 'nora' }] },
  ]), 'http://clew.test/scim/v2');
  expect(s.grants.get('hillevi')?.relations).toBeUndefined();    // Received: ["registrar"]
  expect(s.grants.get('nora')?.relations).toEqual(['registrar']);
});
test('removing the group takes the relation back', async () => {
  const { s, users, scim, admin, directory } = stack();
  await users.addGroupRelation(admin, { groupExternalId: 'ad:kompetenssamordnare', relation: 'registrar' });
  await scim.deleteGroup(directory, 'g-ks');
  expect(s.grants.get('hillevi')?.relations).toBeUndefined();    // Received: ["registrar"]
});
```

An unrelated `PATCH` of Hillevi's own resource afterwards removed the relation, which is the healing described above.
No existing test writes a relation-mapped group over SCIM: `tests/unit/users-admin.test.ts` covers the mapping, and
`tests/provisioning-store-contract.ts` the derivation of one person.

**Where a fix would land.** `givesAuthority` and `authorityOf` (the relation rows beside the capability rows, read
under the same hold), `docs/architecture/identity.md` ("a key that one of the organisation's capability mappings
names"), and a scenario in `tests/unit/scim.test.ts`.

### 2. Medium: the return address after sign-in can leave the installation

**Where.** `apps/server/src/auth-crypto.ts:112` (`localReturnTo`); used by `beginLogin` (`auth.ts:136`), `devLogin`
(`auth.ts:269`) and the redirects in `routes/auth.ts:54` and `:76`.

**What.** `localReturnTo` refuses a value that starts with `//`, then parses it and answers the parsed
`pathname + search`. The parser removes dot segments, so `/.//evil.example/login` passes the first test and comes
back as `//evil.example/login`, which a browser reads as another host. The same holds for `/..//…`, `/%2e//…` and
`/a/..//…`.

**Scenario.** A person gets a link in an e-mail:
`https://clew.example.org/api/auth/login?returnTo=/.//evil.example/login`. The address is Clew's own. They sign in at
the real identity provider, or are signed in already and see nothing. Clew opens their session and answers
`303 Location: //evil.example/login`. The page they land on can look like Clew's sign-in and ask for their password.
The route's refusal of `Sec-Fetch-Site: cross-site` does not stop this: a link opened from an e-mail client, a chat
application or a document carries `none`, and a link on another site of the same registrable domain carries
`same-site`. The web app's own sign-in page is not a way in: the browser has normalised the path before the page reads
it, and the server then refuses the leading `//`.

**Established by.** `localReturnTo('/.//evil.example/login')` returns `"//evil.example/login"` (run in the
container), and a Hono route that redirects to it answers `303` with `Location: //evil.example/login`, which resolves
against `https://clew.example.org/api/auth/callback` to `https://evil.example/login`. The path from `/login` to the
callback's redirect was read: the value is stored as returned and redirected to unchanged. No test names
`localReturnTo`.

**Where a fix would land.** `localReturnTo` (test the parsed path, not only the text), with cases in a unit test.

### 3. Medium: a unit a person is only placed on is told to a source as a unit they follow up

**Where.** `apps/server/src/composition/people.ts:116` (`withFollowedUnits`) over
`apps/server/src/modules/entities/domain.ts:73` (`readerUnits`) and `:99` (`followedUnits`).

**What.** For a person whose primary role is manager, a read from `GET /api/cap/:name` and from an entity's page is
signed with `units`, "the units they follow up". `followedUnits` builds it from every assignment of the reader,
whatever their role there, and the units below. D135 item 5 says of exactly this field that "a source that reads
`units` as the units a manager may see figures for must not be handed an employee's unit", and gives it as the reason
the new `assignments` field is not `units`. The code that fills `units` was not narrowed, and
`docs/architecture/identity.md` still describes it as "their own, managed or placed on".

**Scenario.** Anna leads unit A and holds a second employment as a teacher on unit B, the case D135 was written for.
She opens a Qlik view. Clew signs `units: [A, B, …]`. The Qlik connector answers for the actor's own unit and every
unit in `units` (`connectors/qlik/connector.mjs:97` and `:111`), so Anna reads unit B's sick-leave figures. A
colleague who is only an employee on B never reaches them, since every capability of that connector is scoped to
managers. Small groups are withheld by the connector, and the figures are aggregates; who may see sick leave per unit
is itself open (D117, "Not established").

**Established by.** `followedUnits` for a reader with `units: [A as manager, B as employee]` and `managed: [A]`
returns both A and B (run in the container). `withFollowedUnits`, `actorOf` (`packages/connectors/src/index.ts:130`)
and the signing in `apps/server/src/connectors/authority.ts:45` were read: the list reaches the assertion unchanged.

**Where a fix would land.** `readerUnits` or `followedUnits` in the entities module (session 2's files), the sentence
in `identity.md`, and a case in the tests of the entities domain. It needs a decision on what "their own" means for a
unit the reader is placed on: D117 as built and D135 as written disagree.

### 4. Medium: the web image sends no framing rule and no content security policy

**Where.** `apps/web/nginx.conf.template` (the whole file: its only added header is `Cache-Control`), the proxy
example in `docs/guides/scim-sign-in-and-hosting.md` (the `nginx` block under "The hosting team"), and
`apps/server/src/main.ts`, which mounts no header middleware. The server sets `X-Content-Type-Options` and
`Cache-Control` on protected answers (`context.ts:11`) and a sandboxing policy on the logo and on document bytes, and
nothing else.

**What.** The page that carries the whole product is served without `Content-Security-Policy`, without
`frame-ancestors` or `X-Frame-Options`, without `Strict-Transport-Security` and without `Referrer-Policy`. D131 calls
this image "the one address an installation publishes", and the hosting guide's own example has none of them either,
so an installation built from either has none unless its operator thinks of it.

**Scenario.** Another site under the municipality's domain, such as `intranet.kommun.example` beside
`clew.kommun.example`, frames Clew. The two are the same site, so the `SameSite=Lax` session cookie is sent and the
person is signed in inside the frame. A page that covers the frame and leaves "Godkänn" showing gets a decision
pressed that the person did not mean to make, and the human decision is the control that assistant proposals and
source writes rest on. From an unrelated site the cookie is not sent to a frame, so this needs a page on a sibling
host. Without a content security policy, a script injected by any future fault runs with nothing to hold it.

**Established by.** A search of the repository for the header names: outside tests they occur only in
`routes/appearance.ts`, `routes/api.ts` (document bytes), `routes/protocol.ts` (public reads),
`routes/auth.ts` (`Referrer-Policy` on the callback) and the frame a document preview is drawn in
(`packages/ui/src/document.tsx`). Not tried in a browser.

**Where a fix would land.** The nginx template and the guide's example. `GET /api/auth/frontchannel-logout` must stay
loadable in the identity provider's frame (D121), so a framing rule belongs on the pages, not on that address.

### 5. Low: the session cookie can be shadowed from a sibling host

**Where.** `apps/server/src/auth.ts:56` and `:98` (`clew-session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).

**Scenario.** A page on a sibling host sets `clew-session=<a session of the attacker's own>; Domain=kommun.example`.
A person who is not signed in then uses Clew inside the attacker's session, and what they write there (a note about
an employee, a registration) is the attacker's to read. A cookie named `__Host-clew-session` cannot be set for a
parent domain. Read from the code; not tried.

### 6. Low: the logo's upload check lets through what it says it refuses

**Where.** `apps/server/src/modules/appearance/domain.ts:11` (`UNSAFE_SVG`).

**What.** The check is a list of patterns over the file's text. An element under a namespace prefix is not matched
(`<s:script>` with `xmlns:s="http://www.w3.org/2000/svg"`, and `<s:foreignObject>`), nor is a CSS escape
(`fill:\75rl(https://…)`, `@\69mport "https://…"`), nor a character reference in an animated attribute
(`<set attributeName="href" to="&#106;avascript:…"/>`). All five were accepted by `logoImageOf` in the container.

**Why it is low.** Nothing runs or loads today. The header draws the logo through `img`, and the route serves it with
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`
(`routes/appearance.ts:31`), which a test holds. The comment and D98 call the upload check the third lock; it is the
one that does not hold, so the day the logo is drawn inline or served without that header, the file an administrator
with `admin.appearance` saved earlier is live. `tests/unit/appearance-admin.test.ts` ("an SVG that could run, load or
embed anything is refused whole") tests the plain spellings only.

### 7. Low: the mapping to Kompetenssökning is not held as the mapping to a capability is

**Where.** `apps/server/src/modules/people/usecases.ts:1126` (`changeRelation`) beside `:1148` (`change`), and
`packages/contracts/src/index.ts:4325` (`GroupRelationInput`).

Three differences, each of which the status page and `identity.md` describe as true of both mappings:

- **Decided before the group is held.** `change` reads the group again once it holds the group's row and the
  organisation's rows, and refuses when no group holds the key by then (K4 of the review of 2026-11-12).
  `changeRelation` decides on the group it found before it waited. With the tests' own harness, a group re-keyed
  while "Lägg till" waited left a `registrar` row on the old key, audited under the old name; the next group pushed
  under that key gives the relation to people nobody mapped it to, once they are derived.
- **A NUL answers 503.** `removeGroupCapability` with a NUL in the key answers as for no group. `addGroupRelation` and
  `removeGroupRelation` hand it to the store, which PostgreSQL refuses: the route answers 503 and logs an error (run
  with `tests/refusing-nul.ts`: "invalid byte sequence for encoding "UTF8": 0x00").
- **A row whose key another organisation's group now holds cannot be removed.** `changeRelation` refuses whenever the
  group it finds is another organisation's, also on removal; the status page says such a row "is removed like a row
  whose group is gone". Only an installation with two organisations meets it, which is not supported.

### 8. Low: the back-channel logout address does unbounded work for anyone

**Where.** `apps/server/src/auth.ts:449` and `apps/server/src/routes/auth.ts:119`.

- The key set is created with `cooldownDuration: 0`. jose fetches the provider's keys again whenever a token names a
  key it does not hold and the last fetch is older than the cooldown, 30 seconds unless set
  (`jose/dist/webapi/jwks/remote.js`, line 72). At 0, every forged logout token with an unknown `kid` makes Clew's
  server call the identity provider.
- The body is read whole (`c.req.text()`) and measured afterwards. Behind the web image nginx stops it at 1 MB; a
  server reached another way reads whatever is sent. The administration routes' `body` helper does the same
  (`routes/admin.ts:70`) but stands behind the session.

Read from the code and the library; not load-tested.

### 9. Low: nothing tests a sign-in that succeeds, the session guard or a sign-out

**Where.** `tests/unit/auth-*.test.ts`, `tests/db/sign-in-routes.test.ts`, `tests/db/standing-session.test.ts`.

The refusals are well covered. What is not asserted anywhere, found by searching the unit, database and server tests:

- a callback that succeeds: the session row, the `login` row and the cookie's flags (`HttpOnly`, `Secure`, `SameSite`);
- a second sign-in ending the first session (`replaced`);
- `verifyMutation`: a mutation from another origin, or without the session's token, being refused (the only mention
  of `x-csrf-token` in the tests is in the browser suite);
- `authenticate` ending the session of a person the directory has deactivated or left without a grant
  (`access-revoked`), which is the answer to what happens to a live session;
- `POST /api/auth/logout` (`logout`) and the development sign-in (`login-dev`);
- `localReturnTo` (finding 2).

Each writes a row in the authentication log in the same transaction as the change, which was read; none has the
scenario test the repository's rule asks of a change with an audit row.

### 10. Low: a path-less SCIM patch is not held to the nesting limit

**Where.** `apps/server/src/modules/people/domain.ts:570` (`PATCH_NAMES` marks an operation's `value` as a leaf, so
`plain` and its `MAX_DEPTH` of eight never look into it), `:1452` (`applyUserPatch`) and `:1563`
(`applyGroupPatch`), which each call themselves once for every level of a value that nests the core schema's URN.

**Scenario.** A provisioner sends `PATCH /Users/<id>` with
`{"op":"replace","value":{"urn:ietf:params:scim:schemas:core:2.0:User":{"urn:…:User":{ … }}}}`, 2 000 levels deep:
94 kB, far under the 4 MB limit. The stack runs out, the `RangeError` is no `ScimError`, and the route answers 500
with an error line, where a `POST` of the same depth answers 400 "nested too deeply". At 500 levels the patch is
accepted. It needs a valid token and writes nothing, and the process goes on.

**Established by.** `applyUserPatch` run under Node, the server's runtime, in the container: 500 levels accepted,
2 000 and 4 000 levels `RangeError: Maximum call stack size exceeded`. The full SCIM review of 2026-11-11 marks this
fixed (I9); its test sends a deep `POST` only (`tests/unit/scim-as-clients-send-it.test.ts:1223`).

## Not established

- **Finding 1 on PostgreSQL.** The fault is in the use case and the pure rule, which both adapters share, and was
  shown on the memory adapter. No database test was run. A case in `tests/db/postgres-provisioning.test.ts` would
  settle it.
- **A relation change beside a user write.** `deriveWithin` reads the relation rows after it holds the person, and
  `changeRelation` takes no hold on the rows as `change` does on the capability rows. Read through, the person's row
  lock orders the two, so no stale grant was found; it was reasoned, not run. A case in
  `tests/db/postgres-scim-concurrency.test.ts` would settle it.
- **Migration 0083.** Whether its backfill of `auth_access_grant.assignments` gives every person exactly what the
  derivation gives (labels included) was not compared; `tests/db/grant-assignments-upgrade.test.ts` exists and was
  not run.
- **Back-channel logout from a provider that does not sign with RS256.** `receiveLogout` accepts RS256 only
  (`auth.ts:456`). A provider that signs logout tokens with PS256 or ES256 would have every logout refused, and its
  sessions would live until a refresh is refused. Keycloak's default is RS256, and Entra uses the front channel. A
  real provider would settle it.
- **Framing in a browser** (finding 4) and **cookie shadowing** (finding 5) were read from the code and the cookie
  rules, not tried.

## Looked at and found sound

- **Every route in scope.** `admin`, `staff`, `provisioner-keys` and `auth`'s protected routes stand behind
  `protectedRoute`; each administration use case checks its capability (`admin.users`, `admin.appearance`,
  `admin.connectors` for connectors, models and the reliability counts), and every write also calls `authorize()`. No
  handler takes a person's or a unit's id from the address and reads without the use case's own check: the
  organisation's unit, the people list's `personId` and a provisioner's id are all read inside the administrator's
  organisation. `admin.models` does not exist; models are administered under `admin.connectors`.
- **The OIDC exchange.** State, nonce and PKCE (S256) are made per sign-in, kept in a row keyed by the digest of an
  `HttpOnly` cookie, consumed once and checked by `openid-client`. A sign-in without a refresh token or an ID token is
  refused. Nothing is created at sign-in.
- **The session.** An opaque random cookie, stored as its digest; tokens sealed per session under the master key; a
  sign-in revokes the session the browser held; both expiries are in the query that reads a session; the refresh
  claims a token generation in the database before it asks the provider and never replays one.
- **A live session and the directory.** Every request, and the change stream every two seconds, resolves the subject
  to the person and reads the grant again. A deactivated person, a person without a grant and a released binding all
  end the session at the next request. A capability or a group taken away is gone from the next request, and
  `authorize()` refuses work that started before.
- **Mutations.** Every protected route that is not `GET` or `HEAD` needs an allowed origin and the session's token,
  compared in constant time. No `GET` route in scope changes anything except the sign-in's own (the start of a
  sign-in, the development sign-in and front-channel logout). The browser keeps the token in memory, not in storage.
- **Sign-out.** Clew's own, the back channel (signature, issuer, audience, age, event, no nonce, a receipt against
  replay) and the front channel (issuer checked, sessions of the `sid` only).
- **The development sign-in.** `devAccounts` throws unless `AUTH_LOCAL_HTTP=true`, `PUBLIC_URL` is on `localhost`
  and the issuer is `keycloak.orb.local`, at start and at every request; a production configuration, which must be
  HTTPS, cannot pass. The development stack publishes its ports on loopback only.
- **The grant has one writer.** `writeGrant` is called by `deriveWithin` and by the erasure, and nothing else in the
  repository inserts, updates or deletes `auth_access_grant` outside migrations. Apart from finding 1, each case
  asked about was followed: a group removed, a person moved, a re-keyed group, a capability mapping added or removed,
  a deactivation, an erasure, `protected` (refused at the boundary) and a unit moved in the tree (no grant follows
  from it; the reporting line is read at each call).
- **Several assignments (D135).** The grant, the context, the authorization version and Personal all read the same
  assignments; Personal and the reporting line are the union of the units the reader manages and nothing more. Apart
  from finding 3, nothing in scope reaches beyond them.
- **A provisioner's token.** 32 random bytes, kept as a SHA-256 digest and found by it; one replaced digest answers
  until its time; revoking clears both; issuing an id twice at once gives it to one. A provisioner reads and writes
  its own organisation's people and groups. What it can do beyond that (a `capability:` key gives an installation-wide
  capability, and uniqueness answers tell that a name is taken elsewhere) is the documented limit of one organisation
  per installation.
- **SCIM as an entry point.** The body is read in pieces and stopped at 4 MB; a filter is one equality, parsed by one
  linear pattern; a page is capped; a patch holds at most 500 operations; a `POST` or `PUT` body is held to eight
  levels of nesting (a patch's value is not: finding 10).
- **The public appearance.** `GET /api/appearance` answers the revision, the colours, the theme's name and the
  logo's address and text, never who changed it. The logo is served with its stored type, `nosniff` and a sandboxing
  policy. The theme file's parser takes the closed token list only, six-digit colours only, follows references at
  most nine deep with a loop refused, and the route stops the file at 65 000 characters.
- **Audit rows.** Every mutation in scope writes its row in the transaction of the change: the SCIM writes, the
  derivation, the mappings, the provisioner keys, the appearance, the erasure, the binding and the rebind. Each
  action of the `audit` table is named in a test's assertions (found by searching the tests for each name, not by
  reading every test); the authentication log's are in finding 9.

## The earlier SCIM reviews

Ten documents were read for what their outcome sections say was fixed, by two automated readers, and each claim was
looked up in the code at `9fd4c962`: the nine SCIM reviews of 2026-11-06 to 2026-11-13 and the server findings of
[users, the organisation and the guides in two rounds](2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md),
about 240 claims in all. Tests were checked to exist and to assert what the claim says, not run. Guide wording was
spot-checked only, since the guides have been split and rewritten since.

Every fix is in the code where it was made, and none was reverted. Three do not reach as far as their review says:

- **I9 of [the full review](2026-11-11-scim-full-review.md), "a deeply nested body overflowed the stack": half
  there.** This is finding 10.
- **L13 of the two-round review, "wherever a userName is compared": no longer true.** The people store, the sign-in
  and the indexes compare under ICU as it says. `activeByUserName` in the competence store, merged later the same
  day, compares `lower(user_name)` with JavaScript's `toLowerCase()`. It is under "Seen outside this area".
- **B1, K3 and K4 of the two-round review are intact for capabilities and were not carried to D121's relations**,
  which were merged after them. Both readers reached findings 1 and 7 from this side, without having seen them.

Replaced on purpose by later decisions, and so no discrepancy: the `assignments.derived` row (D135 puts the placements
on `grant.derived`), the guide's flat units (D99's tree), and the plain `lower(user_name)` index (now folded by ICU).

## Seen outside this area

- `scripts/auth-setup.ts:68` writes the local stack's passwords and provisioner token to `.auth-test.env` at the
  repository root. `.dockerignore` keeps out `**/.env` and `**/.env.*`, which that name does not match, and
  `apps/server/Dockerfile:13` copies the whole context, so an image built from a developer's checkout carries them.
  Session 5.
- `GET /api/cap/:name` takes a read's input in the address (`routes/capabilities.ts:51`), so a person's user name in
  an input reaches access logs; D100 moved the people search into a body for that reason. Session 2.
- The change stream authenticates again every two seconds for every open tab (`routes/api.ts:190`): about five
  statements a tab every two seconds. Session 4 or 5.
- `activeByUserName` in the competence store (`apps/server/src/modules/competence/adapters/postgres.ts:710`)
  compares `lower(user_name)` with JavaScript's `toLowerCase()`, not the ICU and NFC expression every other user name
  comparison uses (L13 of the review of 2026-11-12): on a database created with the C locale a name with å, ä or ö is
  not found, a decomposed name is found nowhere, and neither user name index serves the read. The same in
  `scripts/boarding-seed.ts:37`. Wave 2, competence.
- `followedUnits` (finding 3) and the Qlik connector's reading of `units` are session 2's and the connectors' files.
- No route file outside this area lacks its session guard: `api`, `boarding`, `competence`, `dialogue`, `entities`,
  `talks` and `header` all mount `protectedRoute`; `connectors`, `connector-callback` and `protocol` are public by
  design and were not read further.
