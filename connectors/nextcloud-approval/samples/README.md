# Nextcloud Approval: recorded requests and responses

Real exchanges with the development Nextcloud (D101), recorded 2026-11-10 for whoever builds the connector and its
test fake. Nothing here is the connector. Nextcloud 33.0.9 with Approval 3.3.2 and user_oidc 8.13.0, Keycloak 26.2,
realm `clew`. Every call was made with curl from inside `clew-app-1` to `http://calendar`. The token was the one Clew
itself obtains: a real login through the BFF, then RFC 8693 token exchange for the audience `nextcloud` on that session
(`delegatedToken` in `apps/server/src/auth.ts`, the code path behind `context.delegate`).

Each `NN-*.json` holds `description`, `as` (the person), `request` (method, path, headers, body) and `response`
(status, the headers that matter, body). Tokens and cookies are removed: `Authorization` shows a placeholder that says
which token was sent. `token-claims-hillevi.json` is the decoded payload of one exchanged token, without session ids.
File ids (625 to 632), etags and timestamps belong to this instance; a fake should take them as examples, not constants.

## The setup that makes it work

- Keycloak: client `nextcloud` with no flows and the client scope `nextcloud-audience` (an audience mapper), optional
  on `clew-web`; `scripts/auth-setup.ts`. The exchanged token has `aud: "nextcloud"`, `azp: "clew-web"`, a 60 second
  life, and `preferred_username`.
- Nextcloud, applied by `sh scripts/calendar.sh seed`: apps `files_sharing`, `user_oidc` and `approval` enabled; a
  user_oidc provider `keycloak` with client id `nextcloud`, the realm's discovery URL, `check-bearer=1`,
  `mapping-uid=preferred_username`, `unique-uid=0`, `bearer-provisioning=0`; system config
  `user_oidc.auto_provision=false`. The container must reach `keycloak.orb.local:8090` (`extra_hosts` in
  `.devcontainer/compose.yaml`).
- Data, from `.devcontainer/calendar/approval-seed.php`: one rule ("Underlag att godkänna", approvers the users
  `hillevi` and `hassan`, requesters the group `calendar-staff`, tags "Väntar på godkännande", "Godkänd", "Avvisad");
  Erik shares three files with Hillevi and Karin two with Hassan, and each asks for approval. Mikael has none.
  `php approval-seed.php reset` makes every seeded file wait again.

## The API

All Approval routes are OCS: `/ocs/v2.php/apps/approval/api/v1/...`, with `Authorization: Bearer <token>`,
`OCS-APIRequest: true` and `Accept: application/json`. The answer is wrapped as `{"ocs": {"meta": {...}, "data": ...}}`;
on v2 the HTTP status matches `meta.statuscode`. Parameters may be a JSON body or the query string (sample 23).

| Route | Parameters | `data` on success |
|---|---|---|
| `GET pendings` | `since` (accepted, ignored by 3.3.2) | `[{file_id, file_name, mimetype, activity: {userId, userName, timestamp, message} \| null}]`, newest request first, no paging |
| `GET state/{fileId}` | | `{state, rule?, userId?, userName?, timestamp?, message?}` |
| `PUT approve/{fileId}` | `etag` (required), `message` (optional) | `[]` |
| `PUT reject/{fileId}` | `etag` (required), `message` (optional) | `[]` |
| `GET user-requester-rules` | `fileId` (optional) | the rules the person may request with |
| `POST request/{fileId}/{ruleId}` | `createShares` | not recorded |

`state` is 0 nothing (also: no access, or no such file), 1 pending (for someone else), 2 approved, 3 rejected,
4 approvable by me. For 1 and 4 the `userId`, `timestamp` and `message` are the request's; for 2 and 3 they are the
decision's: who decided, when (Unix seconds) and the message. Only the last action per file and rule is kept.

**Pending for me** is computed on every call: the rules where I am an approver (user, group or circle), the files that
carry such a rule's pending tag, and of those the ones I can reach in my own files (owned or shared with me). Remove the
share or the person from the rule and the file leaves the list at once (sample 31). Tags are per file, not per person:
the first approver to decide decides for everyone.

**A file is identified** by `file_id`, Nextcloud's file id, stable while the file exists in the same storage.

**The etag.** Approve and reject require the file's current etag, and neither `pendings` nor `state` returns it. Read
it over WebDAV with the same bearer token, by file id: `SEARCH /remote.php/dav/` (samples 09 and 16, the scope needs the
person's Nextcloud user id, which `GET /ocs/v2.php/cloud/user` returns, sample 01). `d:getetag` is quoted; send it
without the quotes. The same answer carries `nc:approval-state`. The etag changes when the content changes; an approval
made on an old etag is refused (sample 20), so it guards against approving something other than what was read.

**Errors, and what they cannot tell apart.**

| Answer | Means |
|---|---|
| 400, `data: []` | not approvable by me now: already decided (13, 14), not an approver, or no access with an empty etag (18) |
| 400, `data.error` "…inaktuellt innehåll…" | the etag differs from the file's: the content changed (20), **or** the person cannot reach the file and any non-empty etag was sent (17, 19). The etag check runs before the access check. Text is localised (Swedish here) |
| 400, empty `text/html` body | a required parameter is missing (10) |
| 401, `statuscode: 997`, "Current user is not logged in" | no token, not a token, another audience, expired, or no Nextcloud account (25 to 29) |
| 401, "Unauthorised", `WWW-Authenticate: Basic` | the account is disabled (30) |

A second approve is not idempotent: it answers 400 `[]`, the same as "not allowed". There is no operation id. After a
lost response, `GET state/{fileId}` tells what happened: state 2 or 3 with `userId` me and a `timestamp` after the call
was sent means the call (or another by the same person) went through; state 4 means it did not.

**Tokens.** user_oidc validates the access token itself (self-encoded): signature against the realm's keys, `iss`
equal to the discovery document's issuer, `exp`, and `aud` containing `nextcloud`. It does not check `azp`, `scope` or
`typ`, and does not call the userinfo endpoint. The account is the one named by `preferred_username`. Nextcloud's
database backend also resolves an e-mail address to its account, so a mapped value equal to someone's e-mail address
reaches that account. Failed bearer attempts do not count towards brute-force throttling. Each accepted call opens a
Nextcloud session: a temporary token row named after the client's User-Agent, visible in the person's devices and
sessions, and it updates the last-login time.

## The calls

01 whoami as Hillevi: the token resolves to the existing local account `hillevi` (backend `Database`). 02 to 04 the
lists: Hillevi three files, Hassan two others, Mikael none. 05 the rule shape. 06 a file waiting for Hillevi (state 4);
07 the same file read by Hassan (0, he cannot reach it); 08 an unknown id (0). 09 the etag by WebDAV SEARCH. 10 approve
without an etag. 11 approve; 12 the receipt (state 2, who, when, message); 13 approve again; 14 reject after approval;
15 the shorter list. 16 the etag of a second file. 17 to 19 approve by people who cannot reach the file. 20 reject with
the etag from before the owner saved new content; 21 reject with the fresh etag; 22 the receipt (state 3). 23 approve
with query parameters. 24 the empty list. 25 no token, 26 not a token, 27 Hillevi's token for the audience `eneo`,
28 Hillevi's token two seconds after `exp`. 29 a valid token whose mapped id names no account (recorded by switching
the uid mapping to `sub` for one call; nothing was created). 30 Mikael while his account was disabled. 31 Hassan after
one share was removed.

01 to 19 ran in one sequence from a fresh seed, 20 to 28 after file 626's content was changed by its owner, 29 to 31
each on its own with the temporary change described.

The connector built on these is described in [../README.md](../README.md). Its unit test
(`tests/unit/nextcloud-approval-connector.test.ts`) replays these recordings against its API adapter, request for
request, and checks that the in-memory stand-in refuses as Nextcloud did here.
