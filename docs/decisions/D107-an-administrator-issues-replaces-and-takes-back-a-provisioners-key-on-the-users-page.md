# D107 · An administrator issues, replaces and takes back a provisioner's key on the users page

**Status:** provisional (product owner, 2026-11-11: the key a provisioner pushes with is handed out and replaced from administration), built 2026-11-11; items 2, 3 and 6 are choices made in the build and stand until he says otherwise; accepted once a provisioner outside the team has been issued a key on the page and has pushed with it; no manual screen-reader pass yet, and the page was run on fixtures, not signed in · **Date:** 2026-11-11 · **Area:** identity, ui

**Decision.** The bearer token a provisioner authenticates to `/scim/v2` with (D68) is managed on Administration ›
Användare, under "Inläsning från katalogen", beside when each provisioner last called. The product's word for a
provisioner is katalog and for its token nyckel, as the page already said.

1. **Three things an administrator does.** Add a provisioner and hand it its key ("Lägg till katalog"); replace a key
   ("Byt nyckel", from the row's menu), with the key it replaces still answering for a day or a week, or ended at
   once; take a key back ("Återkalla nyckeln"), after a confirmation, which ends every key of the provisioner and
   takes it off the page. The use cases are `issueProvisioner`, `rotateProvisioner` and `revokeProvisioner` in
   `usersAdminUsecases` (`modules/people/usecases.ts`); the routes are `POST /api/admin/users/provisioners`,
   `…/provisioners/:id/rotate` and `…/provisioners/:id/revoke` (`routes/provisioner-keys.ts`).

2. **The key is kept as a digest, not encrypted.** The product owner asked for the key to be stored encrypted. Clew
   never has to read a key back: it only has to recognise one, and a digest does that. A digest cannot be turned back
   into the key by anybody who holds the database, the master key or both, which an encrypted value can. So the
   storage stays what D68 built (`auth_provisioner.token_digest`, SHA-256 of 32 random bytes) and no migration was
   needed. The price is that a key is shown once: the answer to issuing or replacing one carries it, the dialog shows
   it in a `CodeBlock` whose own button copies it and says it will not be shown again, and a key that is lost is
   replaced. This is the one admin answer that carries a secret, and it is sent `no-store`.

   **A key never stops answering by itself.** It answers until it is replaced or taken back. The day or the week
   chosen when a key is replaced is for the old key alone. The product owner first read that choice as the new key's
   date of expiry, and said that never expiring has to be a choice (2026-11-11): a provisioner sends changes as they
   happen, all year, and a key that ran out would stop them in silence. So the dialogs say it in words, on the choice
   and under the key, and if a date of expiry is ever added, never stays the default.

3. **Behind `admin.users`.** No new capability. A person with `admin.users` already decides which group gives which
   capability (D85), which is the same power a provisioner's key carries, so a second name would separate nothing.

4. **Within the administrator's organisation.** A key is issued for the administrator's own organisation, and only
   that organisation's provisioners are replaced or taken back; another organisation's does not exist here (D101).
   A provisioner's id is the installation's, so an id in use anywhere is refused with one set of words. A provisioner
   whose key was taken back may be issued again under its id by the organisation that held it.

5. **Audited as the script audits it.** `provisioner.added`, `provisioner.rotated` (with the grace period, until when
   the replaced key answers, and until when an older one would have, when a second replacement ends it early) and
   `provisioner.revoked`, in the transaction of the write, with the administrator as the actor. Never the key.

6. **The script stays.** `scripts/provisioner-token.ts` is still how the first key of an installation is issued:
   nobody holds `admin.users` until a provisioner has pushed the group that gives it. It writes the same table and the
   same audit actions, with `bootstrap:cli` as the actor.

**Why.** The [review of 2026-11-10](../reviews/2026-11-10-scim-conformance-and-operability.md) left it open: tokens
were managed by a script in the app container, which the people who administer Clew do not have a shell on. The
alternatives to item 2 were encryption under the master key, as a connector's secret is kept, and a key the browser
makes and sends as a digest. A connector's secret is encrypted because Clew presents it to the connector and so has
to read it; a provisioner's key is only ever presented to Clew. A key made in the browser would keep the rule that no
admin answer carries a secret, at the price that the server cannot vouch for how the key was made.

**As built.** The port gained `provisionerById`, `issueProvisioner`, `rotateProvisioner` and `revokeProvisioner`, and
`provisioners` answers until when a replaced key still answers; both adapters, with a case in
`tests/scim-store-contract.ts` that runs on memory and Postgres. `usersAdminUsecases` takes `token` and `digest` as
ports, bound to `randomToken` and `tokenDigest` in `composition/people.ts`. Contracts: `ProvisionerAdminRow`,
`ProvisionerIssueInput`, `ProvisionerRotateInput`, `ProvisionerKeyIssued`, `PROVISIONER_GRACE_HOURS`. The page:
`apps/web/src/pages/admin/provisioner-key.tsx` (two form dialogs on `DialogFrame` and an `AlertDialog`), a `MoreMenu`
on each row and a button in the card's toolbar in `users.tsx`. Astryx only: `Dialog`, `AlertDialog`, `MoreMenu`,
`RadioList`, `Banner`, `CodeBlock`. When a key is taken back its row and menu are gone, so the focus goes to "Lägg till
katalog". Tests: three scenarios in `tests/unit/users-admin.test.ts`, each with its audit row and with the key opening
the SCIM server or not; `tests/a11y/users.spec.ts` (issue from the keyboard, replace, take back, the key dialog at
320 px).

Found on the way: axe read a dialog while it was still fading in and reported its text as low contrast about one run
in six. `expectNoAxeViolations` now lets finite animations end first, as `reflowProblems` already did.

**After the review of the pull request, 2026-11-11.** Ten findings, all settled.

- **A revocation that failed said nothing.** The confirmation has no place for an error, so it now closes and the
  page says what the server said in a notice that stays until it is dismissed; the list is read again first, so a
  catalogue somebody else took the key back from is gone and the focus goes to the control that is left.
- **One id issued twice at once: the second ended the first one's key.** The check that the id was free read a row
  that did not exist yet, and the write was an upsert. Whether the id is free is now the store's answer, given with
  the write (`issueProvisioner` answers a boolean; on Postgres an insert that does nothing on a conflict, then an
  update of the organisation's own revoked row). A case in `tests/db/postgres-scim-concurrency.test.ts` stops the
  first issue before it commits and sees the second wait and be refused.
- **Where the key is sent** was the page's own address. The routes now answer it (`scimAddress` in `routes/scim.ts`,
  the installation's public address, which the SCIM resources' own locations already used), and the development
  server forwards `/scim` as it forwards `/api`, so the address it shows is one that answers.
- **A key could land in a dialog that was closed**, and **Escape discarded the only copy of one.** While a key is
  being made or shown, the dialog is closed by its one button and nothing else (Astryx's `purpose="required"`, which
  also makes it an alert dialog, and no close button in the header).
- **The three routes had no test.** They are a factory over the use cases now, as the talks routes are, with
  `tests/unit/provisioner-key-routes.test.ts`: what a body has to be, which answers carry a key and that they are
  `no-store`, where the key is said to be sent, the refusals in Swedish, and 403 without `admin.users`.
- **The axe helper waited without a limit** on every animation that ends. It now waits for those that are running,
  a second at most, and the whole accessibility suite was run once because every spec uses it.
- **Smaller.** The answer no longer carries the provisioner's row beside the overview that holds it. One wording for
  an instant on the page (`instantText` in `labels.ts`); Astryx's `Timestamp` was tried and writes "12 nov. 2026
  6:00" beside the page's "10 november 2026 kl. 06:02", so the sentence keeps the page's wording. The two dialogs
  that make a key are one (`KeyDialog`) with different first steps.

Each of the fixes that has a test was switched off and its test seen to fail.

**Not done.** A manual pass with a screen reader. The page looked at signed in on the development stack (screenshots
were taken from the suite's fixtures at desktop and phone width). A way to change a provisioner's name.

**Replaces.** Amends [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) item 5: the key is issued on the
page as well as by the script.
