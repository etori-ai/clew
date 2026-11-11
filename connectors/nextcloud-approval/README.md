# nextcloud-approval: files waiting for a person's approval in Nextcloud, as a Clew connector

The first connector to a product that was not written for Clew
([D101](../../docs/decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)):
the [Approval app](https://github.com/nextcloud/approval) of the development stack's Nextcloud. A person sees the files
that wait for their approval, gets a card per file, approves or rejects it through Clew's human decision endpoint, and
the receipt is what Nextcloud reads back. Its id is `nextcloud-approval`.

It acts as the person. Clew sends the person's own token for Nextcloud beside its signed assertion; every call to
Nextcloud carries that token and nothing else, and **Nextcloud decides what the person may see and decide**. The
connector holds no service credential, keeps nothing between requests and interprets no rule, share or approver list.
No dependencies beyond Node; nothing here imports the rest of the repository.

How Nextcloud actually behaves (it differs from its documentation) is recorded in [samples/](samples/README.md): 31 real
exchanges, cited below by number.

| File | Holds |
|---|---|
| `manifest.mjs` | The contract: three reads, two decisions, their views, the area, the file ref pattern |
| `connector.mjs` | The reads, the scan, the decisions and their read-back, the identity check and HTTP error handling |
| `approvals.mjs` | The approval port, its errors, and an in-memory stand-in that decides as Approval 3.3.2 does |
| `nextcloud.mjs` | Nextcloud's OCS and WebDAV API behind the port: the only code here that knows them |
| `server.mjs` | Serves it over HTTP and reads the configuration |

## What a person gets

| Capability | Shown as | Notes |
|---|---|---|
| `nextcloud-approval.pending` "Filer att godkänna" | A table: file, who asked, when. A row opens the file's approval | Computed by Nextcloud on every call and complete (no paging). A model tool, but the model is handed the row count only (`modelReads: summary`): a file name is someone else's words, and the rows name people. Eligible as the menu row "Filer att godkänna" |
| `nextcloud-approval.state` "Godkännande" | One file: status, who asked or decided and when, the message, a link | `Väntar på dig`, `Väntar på en annan godkännare`, `Godkänd`, `Avvisad` or `Inget godkännande begärt`. Never a tool: the message is free text |
| `nextcloud-approval.open` "Öppna i Nextcloud" | The file in Nextcloud, as a link out | Only with `NEXTCLOUD_PUBLIC_URL`; Nextcloud's own permalink `/index.php/f/<id>` |
| `nextcloud-approval.approve` "Godkänn" | The card's primary action | `execute`, `model: false`, `execution: manual` |
| `nextcloud-approval.reject` "Avvisa" | A secondary action with a confirmation | Same |

The area `approvals` "Godkännanden" holds the cards and has the pending list as its standing action.

## The card

The scan answers one draft per waiting file, so each file is its own decision: approve or reject, one receipt, and a
file decided does not take the others with it (Clew marks a card handled once its execution succeeds).

| Part | Content |
|---|---|
| `topic` and occurrence `key` | `nextcloud-approval:file:<file id>` |
| occurrence `revision` and item `revision` | The file's etag: new content is the same work changed, and the card comes back with the new version |
| occurrence `period` | The time of the approval request: a new request after a decision is new work on the same file |
| `title` | `Godkänn eller avvisa <file name>` |
| `summary` | When approval was asked for, and that the first approver to decide decides for everyone (Approval keeps one tag per file) |
| `reason` | `Du kan godkänna filen i Nextcloud` |
| item | The file name and when it was asked for. The file name is the only source text a card carries: the requester's name and message are read live in the state view, never pushed |
| actions | `Godkänn` (primary), `Öppna i Nextcloud` (link, when configured), `Visa godkännandet` (panel), `Avvisa` (with a confirmation) |

The decision is bound to what the person saw: both decisions carry `files: { <ref>: { etag, name } }` in their action
input, the version the card listed. Nextcloud refuses a decision on any other etag (20), so a file changed after it
was listed is refused by Nextcloud's own check and reported as such; the connector never re-reads the etag and decides
on content the person did not see.

The observation is `complete` and `exhausted` when every waiting file got a card, so a file that no longer waits
(decided by anyone, unshared, the person removed from the rule; 15, 31) is resolved by its absence. A waiting file
whose etag the WebDAV search did not return gets no card and makes the snapshot `partial`. A refused or missing token is
`authorization-required`, an outage `unavailable`; both keep the cards Clew already has.

## A decision and its receipt

Approval has no operation id, and a repeated decision answers 400 with empty data, the same as "not allowed" (13, 14).
So nothing makes a replay safe, and the capabilities declare `execution: { strategy: 'manual' }`: Clew never repeats the
write. Every outcome is settled by reading `state/<file id>` back after the call (12, 22), and only a read-back that
shows the decision by this person is `done`.

| Nextcloud answered | State read back | Outcome and detail |
|---|---|---|
| 200 | The decision, by this person | `done`: "Godkänd i Nextcloud av Hillevi Berg 10 nov kl. 14:00." and the message, if any |
| 200 | Anything else, or no answer | `unknown`: it was taken in, but the read-back does not show it |
| 400, any | The same decision by this person | `done`: "Redan godkänd … Inget nytt beslut behövdes." (decided in Nextcloud before, or a repeat) |
| 400, any | Decided by someone else, or the opposite decision | `failed`: "Filen är redan godkänd av Hassan Ali …" |
| 400 with `data.error` | Waiting for this person | `failed`: the content changed since the card was made (20) |
| 400, any | Waiting for another approver | `failed`: the person is no longer an approver |
| 400, any | Nothing | `failed`: the person can no longer reach the file, or it is gone (17 to 19) |
| 401 | | `failed`: the token was refused, nothing was registered |
| No answer, or 5xx | The decision, by this person | `done` |
| No answer, or 5xx | Anything else | `unknown`: check the file in Nextcloud |

Before anything is sent the token's account must be the person (below). A missing, refused or mismatched token, or
Nextcloud not answering, is answered as `failed` rows saying nothing was sent: a known outcome, so the card does not
show an unknown one. There is no undo: Approval has none.

## Identity

Every request is verified as every connector's is (the transport key and the installation-signed assertion,
`verification.mjs`). Then the connector asks Nextcloud who the token belongs to (`GET /ocs/v2.php/cloud/user`, 01) and
requires that account to be the person Clew signed for, by the assertion's `userName` without regard to case. A token
for one person is never used under another person's assertion, whatever account `preferred_username` or an e-mail
address resolves to in Nextcloud. Without a delegated token, without a `userName`, or with a token Nextcloud refuses
(25 to 30), reads answer `denied` in Swedish and nothing is read.

Nextcloud names each accepted call's short session after the user agent, which the person sees under their devices and
sessions; the connector sends `Clew`.

## Configuration

| Variable | Meaning |
|---|---|
| `CLEW_CONNECTOR_SECRET` | The secret shared with Clew, 16 characters or more. Required |
| `CLEW_URL` | Trusted Clew base URL, used to fetch `/api/connectors/jwks`. Required; HTTPS outside the local development allowlist |
| `PORT` | Default 4052 |
| `NEXTCLOUD_ADAPTER` | `fixture` (default, the stand-in) or `nextcloud` (the real API) |
| `NEXTCLOUD_URL` | Nextcloud's base address as the connector reaches it. Required for `nextcloud`; HTTPS unless localhost |
| `NEXTCLOUD_ALLOW_HTTP` | `true` lets `NEXTCLOUD_URL` be plain http on a private development network (`http://calendar`) |
| `NEXTCLOUD_AUDIENCE` | The audience Clew exchanges the person's token for, the user_oidc client id. Default `nextcloud`. Part of the manifest |
| `NEXTCLOUD_SOURCE_LABEL` | The system's name as a person reads it. Default `Nextcloud` |
| `NEXTCLOUD_PUBLIC_URL` | Nextcloud's address in the person's browser, for links to a file. Optional; HTTPS unless localhost |

What Nextcloud and the identity provider need (the user_oidc provider with bearer validation, the `nextcloud` audience
in Keycloak) is in [samples/README.md](samples/README.md#the-setup-that-makes-it-work); `sh scripts/calendar.sh seed` and
`scripts/auth-setup.ts` apply it to the development stack.

## The stand-in

`approvals.mjs` holds a made-up Nextcloud with one approval rule (approvers `hillevi` and `hassan`) and the files of
`.devcontainer/calendar/approval-seed.php`: Erik's three files shared with Hillevi, Karin's two with Hassan, nothing for
Mikael. It reads the person from the token's `preferred_username`, requires the audience and an unexpired token, and
decides as Approval 3.3.2 does, including what cannot be told apart: the etag is compared before access, so a file the
person cannot reach reads as changed content; a repeated decision is refused like a forbidden one; no access and no
file both read as state 0. It does not check the token's signature, which is acceptable for made-up data only. Its
`controls` change it the way people do (a new version, a share removed, a new request, an account disabled) and the
way a network fails (an outage, a decision whose answer is lost before or after it took effect).

## Run and check

In the development stack the connector is the `nextcloud-approval` service of `.devcontainer/compose.yaml`, in the
`calendar` profile, on `127.0.0.1:4052`, with the `nextcloud` adapter against `http://calendar`. It is not started or
registered by `bun run dev:connectors`. From the host:

```sh
sh scripts/compose.sh --profile calendar up -d nextcloud-approval
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://nextcloud-approval:4052 --id nextcloud-approval --secret <CLEW_DEV_CONNECTOR_SECRET>
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts nextcloud-approval http://nextcloud-approval:4052 --secret <CLEW_DEV_CONNECTOR_SECRET>
```

The secret is the stack's development transport key (`CLEW_DEV_CONNECTOR_SECRET`, `clew-dev-only-transport-key` unless
set). The checker has no session, so it expects the reads to be denied and the scan to ask for authorization. The last
command creates a draft registration; set its audience, enable it, and choose whether "Filer att godkänna" goes in the
menu under Administration › Anslutna system. `php approval-seed.php reset` in the calendar container makes every seeded
file wait again:

```sh
docker exec -i -u www-data -w /var/www/html clew-calendar-1 php -- reset < .devcontainer/calendar/approval-seed.php
```

Tests: `bun test tests/unit/nextcloud-approval-connector.test.ts`: the connector over the stand-in through Clew's
registry and remote transport, the conformance check, and the API adapter against the recorded exchanges, request for
request, alone and behind the connector. `bun test tests/unit/approval-loop.test.ts`: the whole loop on the memory
adapters (D103): a visit's scan with the asking session's token, a card's button through the human decision use case,
the ledger's dispatch with the approving session's token, the receipt on the card and the audit rows; a session that
ends before dispatch, content changed after the card was made, another approver first, a person idle beyond
`PRESENCE_MS`, a reject, and a partial scan.

## Checked against the development Nextcloud

On 2026-11-10 the connector ran with the `nextcloud` adapter against the development Nextcloud (33.0.9, Approval
3.3.2), called through Clew's registry and remote transport with assertions signed by the installation's key and tokens
from real Keycloak logins exchanged by the BFF's own code: the lists for Hillevi (3), Hassan (2) and Mikael (none); a
file's state, and not found for Hassan on Hillevi's file and for an unknown id; scans with one WebDAV search per batch
(`d:or`), complete; approve and reject for both, read back; a repeated approve (`done`, already), a reject after it
(`failed`, already approved); Hassan with Hillevi's card (no access); Hassan's token under Hillevi's assertion and a token
for another audience (nothing sent, the file still waiting); a file whose owner saved new content after the card was
made (refused as changed, the next scan a new revision on the same key and period). The seed was reset afterwards.

The same day the whole loop ran against it through Clew's own use cases on their memory adapters, with real sessions
found again by `standingSession`: a visit each for Hillevi and Hassan scanned with their session's token (three and two
cards, complete), each approved one card and rejected another through the card decision, the ledger dispatched each
write with the approving session's token, every receipt was the read-back ("Godkänd i Nextcloud av Hillevi Berg …"),
Nextcloud showed the four decisions, and the next visits resolved the decided work. The seed was reset afterwards.

On 2026-11-11 the recorded exchanges 01 to 26 in [samples](samples/README.md) were sent again to Nextcloud 35.0.2
(Approval 3.3.2, user_oidc 8.13.0, PostgreSQL 18.6), with the owner's change to the second file made between samples 16
and 20 as in the recording: every status and body answered as recorded, apart from ids, etags, timestamps and the
order of files requested within the same second. The seed's accounts signed the requests (basic authentication), so
this run says nothing about an exchanged token; samples 27 to 31 and the loop through Keycloak were not run again.

## What the protocol could not say

- **The version a person saw.** `ThreadItem.revision` holds it, but Clew passes an item's revision to an execute only
  through the document review (`review`), which needs a document or record read. The etag therefore travels a second
  time in the action's `input`.
- **Read-back after a lost answer.** A `conditional` execution would fit Approval (the write is conditional on the etag
  and `state` tells whether it holds), but Clew calls a lookup with `{ operationId }` alone, and Approval keeps no
  operation id. The connector settles a lost answer itself, inside the call, by reading the state back; once its own
  answer to Clew is lost, the outcome stays `unknown` for the person to check in Nextcloud.
- **A message with the decision.** Approval takes one, and a rejection usually needs it; a card action has no field for
  the person to write in, so none is sent.
- **An effect that already held.** `done`, `failed`, `unknown` and `skipped` have no "already so": a decision the person
  made before in Nextcloud is reported `done` with a detail that says so.

## What it never does

It does not store anything, keep a person's files, tokens or decisions between requests, use a credential of its own,
re-read an etag to decide on content the person did not see, repeat a decision, log request or response bodies, or pass
on Nextcloud's error text.

## Unverified

- The loop has run through the running BFF and the web page on the development stack for two people (2026-11-11,
  [status](../../docs/reference/status/connectors.md#nextcloud-approval)), but no automated test does: the scenario test
  and the run above use the use cases directly, with the card projection of `composition/execution-projection.ts`
  copied onto the memory thread store (the memory ledger has none).
- After a failed decision the card stays open with its receipt and cannot be decided again; a scan neither updates it
  with a changed file's new version nor closes it when the file no longer waits (`approval-loop.test.ts` pins this).
  On the page such a card cannot be dismissed either (seen 2026-11-11): the person decides in Nextcloud.
- The view and the card have not been through a screen reader; the connector adds no route or component (Clew draws the
  declared views), so it has no test in `tests/a11y`.
- Approval with a group or circle as approver, files in group folders or external storage (the WebDAV search covers the
  person's own files), and more pending files than one search batch of 50.

Node's official image is MIT. The connector has no other dependency.
