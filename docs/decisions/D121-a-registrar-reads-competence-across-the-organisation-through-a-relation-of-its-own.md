# D121 · A registrar reads competence across the organisation through a relation of its own, and every such read is logged

**Status:** provisional (product owner, 2026-11-12: chose "a new relation" over an exception to D118 and over counts without names; nothing outside the repository has tested it; not built when written) · **Date:** 2026-11-12 · **Area:** identity, product

**Decision.** Some people need to find who holds a competence across the organisation: HR, and whoever staffs a
shift or looks for a person with a licence.
[D118](D118-an-administrators-capability-is-no-relation-to-a-person.md) rules that no capability decides whom a
reader may see, and names the way this is allowed instead: a person relation of its own. This record is that
relation.

1. **A fourth relation.** `registrar` joins `PERSON_RELATIONS` beside `self`, `managed` and `colleague`
   ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)). A reader
   stands as `registrar` to every active person of their own organisation when they hold the grant of item 2, unless
   a closer relation applies: `self` and `managed` come first, so a manager is never demoted by also being a
   registrar.
2. **Granted on its own, not as a capability.** The grant is not a name in `CAPABILITIES`, so it gives no
   administration page and D118's sentence "no capability in `CAPABILITIES` is a relation and none widens one" stays
   true as written. It is a closed list of its own in `@clew/contracts` (`RELATION_GRANTS`, today only `registrar`),
   mapped from a provisioned group by an administrator with `admin.users` on Administration › Användare, as a
   capability is mapped (D85), and derived into the person's access in the same transaction as the change. Mapping
   and unmapping are audited. D108 item 8's capability name `competence.search` is not introduced.
3. **Admitted source by source.** A read admits `registrar` only by declaring it (`person.admits`). The competence
   module's reads of holdings do; nothing else in the repository does, and a connector that does not declare it is
   never asked about a person on a registrar's behalf. So the grant opens competence and nothing more: not HR rows,
   not talks, not the learning platform's own rows (which reach a registrar only as the copies the register holds).
4. **What a registrar can do.** Search who holds a type, with a least level for a skill, across the organisation
   (`/competence/search`); open one person's holdings from a hit; export the hits. A registrar registers, validates,
   approves and revokes nothing: writes stay with the manager the person reports to and the person themselves.
5. **Every read is logged.** D108 item 15 is built with this: a search, an opened person's holdings and an export
   each write a row saying who read, as which relation, whom or which type, and when; never a name and never
   content. A manager's and a person's own reads of one person are logged the same way, so the log does not single
   the registrar out and is complete.

**Why.** The product owner's rule behind D117 is that a person sees their own data and a manager their employees'.
Finding a holder across units is a real need that rule does not cover, and D118 foresaw it. A relation keeps the
exception where every other rule about people already lives: the core resolves it on every call (D117), a source
must opt in, and a source that does not know the word answers nothing. A capability would have been checked in one
module's use case and nowhere else.

**Alternatives.** An exception to D118 for one capability: turned down by the product owner; it reopens what D118
closed on the day it was accepted. Counts that name nobody: turned down; it removes the reason to search. Making
`admin.competence` reach holdings: D118 item 3 says it does not. Granting the relation per unit branch rather than
per organisation: more exact, and nobody has asked for it; the list is closed so a narrower grant can be added.

**As built (2026-11-13).** Narrower than the items above in four places, each found when it was built or reviewed.

- *Only a core read can admit `registrar`, and only when the person's own session calls it* (item 3). The published
  connector protocol keeps its three relations (`PROTOCOL_PERSON_RELATIONS`), a remote manifest that admits
  `registrar` is refused, and no connector is sent the word. A call that reaches the read through a connector (a
  callback, a scan, a job) is answered as for a colleague: otherwise any connector allowed to use the read could
  ask about anybody while it served a registrar. Opening the relation to connectors is a protocol change with a
  decision of its own. The one read that admits it is `competence.holdings`.
- *An opened person shows a registrar the holdings that count* (item 4): certificates and the like that are
  approved, registered by a manager or copied and mapped, and skills with their level and the mark "Egen
  bedömning". Not a registration that waits or was rejected, not a copied row of an unmapped source type, not the
  interest mark, not revoked rows.
- *A person's own reads are not logged* (item 5, amended). They disclose nothing and a page that reads again wrote
  so many rows that the others were hard to find. A manager's read of one report's holdings and everything a
  registrar reads are logged, and so are both CSV exports (the search's and the matrix's). A logged read runs only
  when the reader asks, never because the page refreshed. Not logged, though they name people: the matrix itself,
  the attention list, and the reads behind an approval and a skill confirmation, all a manager's over their own
  reports. D108 item 15's row per unit for coverage is not built. So the log is complete for reads across the
  organisation and partial for a manager's.
- *Who can grant it* (item 2). A holder of `admin.users` can map the grant to a group they are themselves in, with
  nobody else involved. The mapping and the derived grant are audited and every read that follows is logged, but
  D118 item 3 ("not one person's holdings") is then one mapping away, kept by the trail and not by a second
  person.

- *The search is in the address, and may ask for several types* (item 4, amended 2026-11-13 after a review of the
  page, on the product owner's word). The chosen types, the unit, the least level, the status and validity filters,
  the order and the page are in the address as ids and codes, never a name, as
  [D100](D100-the-people-list-is-read-a-page-at-a-time-and-narrowed-on-the-server.md) item 5 has filters; the
  session memory that kept them out is gone. A search may name up to five types and finds who holds every one of
  them, each passing the filters by itself. A reload or an opened link is therefore a search, and is logged; going
  back to an address read a few minutes ago is shown from what was read and is not. One search is one row in the
  log, with the list of type ids (migration 0074). The status and validity filters are not recorded in the log,
  though they change who was shown.

Erasure of a person leaves the log's rows, which hold an id and no name. The log is read with
`scripts/competence-read-log.ts`; no page shows it.

**Open.** Whether a person can see who has read their holdings. Whether a registrar should be limited to a branch of
the organisation tree. How long the read log is kept.

**Not established.** Nothing is measured. The cost of resolving a fourth relation on every call (D117 has
not measured the three). Whether "registrar" is the word HR would use; in the product the grant is shown as
"Kompetenssökning".

**Replaces.** Amends [D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) item 8 (no
`competence.search` capability; the relation instead) and builds its item 15. Adds a relation to
[D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md). Uses the way
[D118](D118-an-administrators-capability-is-no-relation-to-a-person.md) names and changes nothing in it.
