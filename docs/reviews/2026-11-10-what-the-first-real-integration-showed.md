# Review: what the first real integration showed · 2026-11-10

Status: findings from building [D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)'s
first slice, the connector to Nextcloud's Approval app on protocol 2. Branch `nextcloud-approval`, not merged. The
loop has run against the real Nextcloud and the real Keycloak through Clew's use cases; it has not run through the
running server and the web page. The freeze of D101 is not lifted.

This is the first time Clew met a product that was not written for it. The value is the list of things that turned
out differently from what the documentation, the protocol and the earlier reviews assumed.

## What works

| Piece | Evidence |
|---|---|
| Nextcloud accepts the token Clew obtains by exchange for the audience `nextcloud`, as the existing account of the same person, with no service credential | 31 recorded exchanges in `connectors/nextcloud-approval/samples/`; refusals recorded for a garbage, expired, wrong-audience and unmapped token and a disabled account |
| The connector: what waits for me, one file's state, a scan with one card per file, approve and reject with a receipt read back | `tests/unit/nextcloud-approval-connector.test.ts` (27 cases, including a replay of the recordings), the conformance checker, and a run against the real Nextcloud for three people |
| A scan and an approved write on a connector that acts as the person, with the asking session's token ([D103](../decisions/D103-the-session-that-asked-stands-behind-delegated-work.md)) | `tests/unit/delegated-executions.test.ts`, `tests/unit/delegated-scans.test.ts`, store contracts on both adapters |
| The whole loop: a visit scans, a card per file, a decision through the card's button, dispatch with the person's token, a receipt naming who decided and when, the audit rows | `tests/unit/approval-loop.test.ts` on the memory adapters; the same use cases against the real Nextcloud with real sessions, four decisions by two people, confirmed in Nextcloud |

Two people saw different files; a person with nothing saw nothing; one person's token under another person's signed
assertion was refused before anything was read.

## What the product is really like

1. **"Accepts the identity provider's token" needed five settings**: per-provider bearer checking, the account mapped
   by user name, automatic account creation off, the issuer reachable from the container, and file sharing enabled.
   With the defaults, every caller would have got a new shadow account named by a Keycloak identifier.
2. **Approving needs the file's version tag, and the Approval routes do not return it.** Every write costs a WebDAV
   read first. Neither the comparison review nor D101 knew.
3. **There is no operation identity and errors are ambiguous.** A second approval, "not an approver" and "already
   decided" are the same empty refusal; "outdated content" is also what a person without access gets. The read-back is
   the only receipt.
4. **Each accepted call opens a session in the product**, visible in the person's device list. A connector that calls
   often leaves a trail.
5. **The exchanged token lives sixty seconds, refused two seconds after expiry**, and the product caches signing keys
   for an hour (from its source, untested), so a key rotation can refuse every call for that long.
6. **Failed bearer attempts are not throttled** by the product.
7. The forum report that bearer validation fails outside OCS routes did not reproduce: OCS and WebDAV both work.

## Where Clew's protocol did not fit

| # | Gap | Consequence today |
|---|---|---|
| 1 | A card row's `revision` does not reach the execute; only reviewed documents carry evidence | The connector repeats the version tag in the action's input, and nothing in Clew checks that the two agree |
| 2 | The `conditional` strategy calls its lookup with the operation id alone | A source with a per-record read-back but no operation ids must use `manual`; after a lost answer the card stays unknown although the source could say what happened |
| 3 | A connector cannot answer "nothing was sent" to an execute: a `denied` error becomes an unknown outcome | The connector answers failed rows instead, which contradicts the manifest reference |
| 4 | No outcome for "already so" | A decision the person had already made in the product is reported as done with a sentence |
| 5 | An action cannot carry a message from the person | A rejection is sent without a reason, although the product accepts one |
| 6 | A scan needs an area, and an area is a place on Hem and in the rail | The connector adds "Godkännanden"; whether that is inside D101's freeze is a judgement |
| 7 | Nothing signed binds the delegated token to the actor | Every call costs one more request to ask the product who the token belongs to, and the check rests on the product's account name equalling the directory user name |
| 8 | A row has one subject | A file row cannot name the person who asked by key |
| 9 | The conformance checker has no session | For a connector that acts as the person it can show refusals and an empty scan only |

Gaps 1 to 3 are the ones a second source will hit again. None was fixed here: under D100 a change to the protocol
waits for a second source that needs it.

## What it found in Clew itself

- **A card is stuck after a failed decision.** This is not about this connector. The card stays open with the failed
  receipt; the same button returns the failed attempt and sends nothing; the other button says an earlier decision is
  still waiting; the next scan neither updates the card (it has a receipt) nor replaces it (the open card holds its
  topic); when someone else decided first the work is resolved but the card stays. Avfärda is the only way on. A fix
  is sketched in the handover note; it touches the same ground as D80 and is the product owner's to choose.
- **The banner says a source "svarar inte" for any error**, including a refused token, which is not an outage.
- **A partial scan leaves no trace for the person**: it is stored as complete, and only the audit row says otherwise.
- **The card projection of an execution exists only over Postgres**, so the loop test carries a copy of it.
- **The remote scan sends the whole authenticated context as the actor**, more than the published schema allows.
- Before the change, a session-backed scan would have run every minute for eight hours with the page closed; D103
  bounds it to fifteen minutes after the person's last activity.

## The signed-in pass, 2026-11-11

After the merge to `main`: migration 0046 applied, the `nextcloud-approval` service started, checked and registered
with `connector-add --enable`, and Hem opened signed in as Hillevi on `localhost:3020`.

| Step | On the page | In Clew's audit | In Nextcloud's own table |
|---|---|---|---|
| The visit | Three cards under Godkännanden, one per file | `refresh.requested` and `refresh.completed` with `session: true`, three `thread.pushed` | |
| Godkänn on "Plan för klassresa.txt" | The row turns to its receipt, a toast says "Filen är godkänd i Nextcloud" | `execution.approved`, `claimed`, `dispatched`, `succeeded` with `session: 'approving'` and `['done']` | File 627, state approved, by `hillevi`, the same second |
| Avvisa on "Inköp av läsplattor.txt" (under Fler val, after its confirmation) | "Filen är avvisad i Nextcloud" | The same four rows | File 625, state rejected, by `hillevi` |
| The next scan | Two cards, then one | `refresh.completed` with the lower count | |

This is the first time the loop ran through the running server, Postgres, the durable engine and the page. What the
page showed that the tests had not:

- **The card promises an undo that does not exist.** The footer reads "… läses tillbaka som kvitto. Ångra i 10
  minuter." for every card (`apps/web/src/components/card.tsx`), whether or not the source declares one. Approval has
  none. Removed the same day in commit `591fbdf`: whether a write can be undone is said by its receipt.
- **The source's name is written in lower case** in that footer, in the row's meta line ("nextcloud svarade 06:57")
  and in Sedan i går, which suits a generic word like "ekonomisystemet" and is wrong for a product's name. Also changed in `591fbdf`: the name is written as the source gave it.
- **A confirmation is the browser's own dialog** (`window.confirm`), not an Astryx one. The automated browser could
  not answer it, so the pass answered it by script; a person would have seen the sentence "Avvisa filen? Ditt beslut
  gäller för alla som kan godkänna den."

Not done on the page: a second person, a person whose access was taken away, and a failed decision. Those are shown
through the use cases, the harness and the recorded exchanges above.

## What is left before the freeze lifts

D101 item 5: the loop signed in on the development stack is done for one person (above). Still open: two people
and a revoked person on the page, not only in the harness; one manual pass with a screen reader; the second build as
an MCP server and the comparison of the two. Not started: Frappe HR.

Open on the stack itself: the running Nextcloud container needs to be recreated once to pick up the compose change
that lets it reach Keycloak (a hosts line was added by hand meanwhile), and running the calendar seed from `main`
before the merge switches the three new apps off again.
