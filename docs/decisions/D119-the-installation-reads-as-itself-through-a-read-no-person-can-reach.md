# D119 · The installation reads as itself, through a read no person can reach

**Status:** provisional (built 2026-11-12 on branch `holdings-caller` for D108 item 9's copy of every source's holdings; accepted once a connector outside the repository answers an installation read and the competence register's copy has run on it) · **Date:** 2026-11-12 · **Area:** integrations, identity

**Decision.** Clew can call a connector as the installation itself, with no person behind the call. Such a call is
not a capability: it is a read of its own kind, declared apart, reachable from the core alone, and signed so that the
connector can tell it from any person's. The holdings profile, `<id>.holdings` (D108 item 9), is its first and for now
only use.

1. **Declared apart.** A manifest may carry `installation`, a list of reads Clew makes as the installation:
   `{ name, title, description, input, output }`. Nothing else: a read is implied, and so is `model: false`; there is
   no scope, view, menu, `about` or `person`, since nobody is asked about and nobody looks. A name is
   `<id>.<profile>` for a profile Clew reads as the installation (`INSTALLATION_PROFILES` in
   `packages/connectors/src/protocol.ts`, today only `holdings`), and no name is both a capability and an installation
   read. In process a `Connector` carries them as `installation`, beside `capabilities` and never in it.
2. **Kept apart in the registry.** `Registry` keeps installation reads in a map of their own. Every path a person takes
   looks a name up among the capabilities: `Registry.run` (`/api/cap` and every caller of `runCapability`: a card's
   action, an assistant's tool, a job's follower), `validate` (a card's or a job's approval), `document`, `clewFor`
   (an in-process `clew.call` and another connector's callback through `/api/connectors/call`), the entity routes,
   `tools`, `views`, `menu`, `aboutReads` and the rest. So a person, an administrator included, who names an
   installation read on any of them is refused exactly as for a name nobody declared, and nothing the model or a
   connector sends can reach one. The way in is two methods, over one private `asInstallation`:
   `holdingsSources()` (the enabled connectors that declare `<id>.holdings` and have not had it switched off) and
   `readHoldings(connectorId, cursor?, { signal? })` (one page). Their type is `HoldingsReader` in `@clew/connectors`;
   `holdingsReader` in `apps/server/src/connectors/registry.ts` binds it to the live registry for composition to hand
   the competence register's copy. The input and the answer are checked against the declaration and against the
   profile, the governance again after the answer, and a failure is an `InstallationReadError` carrying the protocol's
   error kind (`not-found`, `invalid`, `denied`, `unavailable`, `unknown`), in Clew's words for that kind
   (`installationReadText`): a connector's own message is never passed on, into a log, an audit row or an
   administrator's check (D91). The call names nobody, so no audience narrows the call itself; but what it answers is
   about people, and D23's audience still holds for them (amended 2026-11-12 by the working session's coordinator after
   the review of the joined change, not confirmed by the product owner): the competence register keeps a copied row
   only for a person who is inside the source connector's audience and the competence module's own when the row is
   read, and deletes the rows of a person who has left either (the implementer's choice; D108 item 9). Administration › Kompetens › Källor shows a source only to an organisation that has
   someone in both.
3. **Signed as nobody's.** Clew posts an installation read to `/clew/installation/{name}`, never to a person's route,
   with `{ input }` alone (`InstallationCallRequest`): no actor and no `about`. The bearer is the installation's own
   assertion: subject `clew:installation`, claim `caller: "installation"`, no `actor` and no `callback`, for that
   connector only and for two minutes, and bound as every request is since D117: `body` is the SHA-256 of the exact
   body and `capability` the name in the route. The verifier every connector in the repository carries
   (`connectors/*/verification.mjs`, identical copies) keeps `verify(token, key, request)` for a person, which now also
   refuses any assertion with a `caller` claim, and adds `verify.installation(token, key, request)`, which accepts only
   the installation's own assertion bound to that request. Each refuses the other's. The route is bound by its kind as
   well as its name, with no new claim (amended 2026-11-12 after the review): the verifier takes the route only when the
   request's path is exactly `/clew/capabilities/<name>` or `/clew/installation/<name>`, from its start and with nothing
   after the name, and binds to nothing a path that names either route anywhere else (nested, prefixed, longer). The
   installation's assertion is accepted on the installation's route alone, and a person's never there, so the
   `caller` claim already says which route an assertion belongs to. A connector served under a path prefix hands the
   verifier the request with the prefix taken off. A connector built from the previous protocol-3 template still takes
   Clew's person calls, since no claim was added, and refuses the installation's for want of an actor (a frozen copy
   of that template is tested, `tests/fixtures/verification-protocol-3.mjs`). A connector answers an installation read
   to that assertion alone and a person's assertion on its route with 401, as the conformance check probes.
4. **The holdings profile.** `<id>.holdings` takes `HoldingsInput`, `{}` for the first page and `{ cursor }` after, and
   answers `HoldingsOutput`: `rows`, each `{ key, holdings, partial? }` with `key` the value of the source's match field
   for the account (what Clew compares with a person's user name) and each holding
   `{ id, type, label, kind, issuedOn, expiresOn? }`; `next`, the cursor of the following page, absent on the last; and
   `withdrawalsReported`. Both are in `@clew/contracts` (`packages/contracts/src/holdings.ts`) and in the published
   `$defs`. A page carries at most 100 rows and a row at most 500 holdings; `kind` is the catalogue's kinds and `badge`.
   The loader refuses a declaration whose input takes anything but an optional string `cursor`, whose output carries a
   field the profile does not have, or whose bounds are wider. A source answers an account that holds nothing with a
   row, a cursor it no longer knows as `invalid` (the register then starts again), and with
   `withdrawalsReported: false` says that a holding missing later must not be read as revoked.
5. **Protocol 3 is kept.** By D60 item 4 this is additive. Checked against the published schema of 3 (the bundle on
   `main` before this change) rather than assumed: no definition was removed or changed except `ConnectorManifest`,
   which gained the optional `installation` and nothing else; every manifest generated from the repository's connectors
   validates against the published `ConnectorManifest` with `installation` left out; `CallRequest`,
   `DocumentReadRequest` and the scan and figure shapes are unchanged; the OpenAPI document gained one path and one
   security scheme. A connector that declares no installation read is sent nothing new and verifies as before. A
   manifest on 2 that declares `installation` is refused (`protocolTerms(2).installation` is false), since the field was
   added under 3. As with every optional field, a Clew from before this change refuses a manifest that carries it.
6. **The conformance check** (`packages/connectors/src/check.ts`, behind "Testa anslutning" and
   `scripts/connector-check.ts`) reads the first two pages of each installation read as Clew reads them and reports
   counts only (rows, holdings, partial rows, whether more pages follow), never a key or a label, and a read that fails
   by its kind in Clew's words, never the connector's message; and it posts a person's assertion, bound to that very
   request, to the installation route and fails unless the connector answers 401.
7. **`connectors/moodle` answers it.** `moodle.holdings` is no longer a person's read taking `keys`: it is the
   installation's read of every account the service account can see, a page of at most 25 at a time in Moodle's id
   order, each with its completed courses (dated) and badges, `withdrawalsReported: false`, suspended accounts
   included. How it enumerates, pages, bounds a page in time and what it costs is in its
   [README](../../connectors/moodle/README.md#the-installations-read-of-every-holding).
8. **What Clew does with it** is D108 item 9's copy into the register, with its schedule, store and type mapping, built
   beside this record the same day (D108, "As built, 2026-11-12: the copy and the mapping"); this record settles the
   wire and the port it reads through. The copy reads a failure's kind as item 2 names them: a page that is
   `unavailable` is asked again, a cursor refused as `invalid` starts the sweep again once, and anything else ends the
   read without revoking anything.

**Why.** D117 placed D108 item 9's scheduled copy as a read the installation makes, with no actor and no key, and left
two things open: how such a read is declared, since protocol 3 can declare a list of people only on a read about a
person, and how a connector would know a call is the installation's own. The Moodle connector showed both: its
`moodle.holdings` took `keys`, Clew could vouch for nobody in them, and so it answered no row through Clew. The copy
needs every holding a source has, on a schedule, with nobody signed in. Kept apart from capabilities, the read cannot be
reached by any path a person, the model or another connector takes, whatever is declared; signed with a claim no person
carries, it cannot be mistaken for a person's call by the connector either, so a connector can answer everything to the
installation and nothing extra to anyone else. A route of its own means that a connector that routes `/clew/capabilities/`
to its person handlers never hands them an installation call, and one that does not know the route answers 404.

**Alternatives.**
- *A system "person" with every relation.* An actor signed like a person, to whom Clew's rule answers `managed` for
  everyone. Every person's path accepts an actor, so that actor would be a universal key on all of them, and the
  connector could not tell it from a manager without a special case of its own; D117's rule would need an exception
  that grants everyone. Refused.
- *Calling as each manager.* Read every manager's reports under D117 and union the answers. No manager signed in means no
  session and no delegated token anyway; people with no manager, or a co-manager D117 does not count, are never read;
  every report is read once per manager above them in the tree; and the source sees the copy as people reading each
  other. Refused.
- *A `keys` list vouched by Clew for everyone.* Clew sends the whole directory in batches with a relation that means
  "the installation". It keeps the source's work per person, as Moodle's API is shaped, but it is the universal key
  again under another name, protocol 3 would have to learn to declare a list of people on a read that is not about one,
  and every sweep would send every user name of the organisation to every source, which needs none of them to answer
  what it holds. The installation's read sends nothing but a cursor.
- *A flag on a capability* (`caller: "installation"`) instead of a list of its own: one field fewer in the manifest, but
  every consumer of `capabilities` (the registry's person paths, the preview, the check, the reference, the admin page)
  would have to skip such a capability, and one that forgot would be a person's path to it. A list of its own makes the
  separation structural.
- *The same route as a person's call*, told apart by the assertion alone: one route fewer, but a connector's person
  handlers would see installation calls and must refuse them correctly by themselves.

**Not established.** No connector outside the repository declares an installation read or verifies the installation's
assertion. The copy has read through the port in process only, on a memory store (D108), not yet in the running
server. The Moodle connector was read in process from this worktree against the development Moodle only (16 accounts, one page,
81 Moodle calls, 0.4 to 0.7 s; Moodle's guest account left out); a Moodle with thousands of accounts, a slow one, and accounts deleted during a real sweep
are tested on the stand-in only. Administration › Anslutna system does not list a connector's installation reads, and a
switch per read can be stored but has no control; the sources of the holdings profile and how each was last read are
listed under Administration › Kompetens › Källor (D108), while the module is switched on. "Testa anslutning" reads two pages of holdings for an administrator
and shows counts only; whether an administrator's check should read them at all was not asked. Two accounts whose
idnumbers differ in a case other than lower case, on different pages, are both answered under `MOODLE_MATCH_FIELD=idnumber`
(the person's reads share the limit). A user name Clew gives to someone new while the old Moodle account is suspended
and not renamed carries that account's rows; each holding's `id` names the Moodle account, not the user name, but which
person a row is copied to is the register's to decide.

**Replaces.** Amends [D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)'s
"A caller with no person behind it": the installation's read is built, and how a connector knows the call is the
installation's is this record. Amends [D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md)
item 9: `<id>.holdings` is an installation read that takes a cursor, not keys, and its shape is the protocol's. Amends
[D44](D44-authorized-reads-and-clew-signed-connector-authority.md): beside the person's request assertion and the
callback grant there is the installation's assertion, which carries no actor and grants no callback. An additive change
under [D60](D60-the-instance-serves-its-connector-protocol.md) item 4. Under
[D37](D37-connectors-declare-what-they-use-and-a-capability-name-is-its-contract.md) a capability's name is its
contract: `moodle.holdings` keeps its name across the change from a person's read taking `keys` to the installation's
read, since the earlier one answered no row through Clew and nothing consumed it.
