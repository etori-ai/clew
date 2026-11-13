# D110 · A person's title is pushed as SCIM's `title` and kept apart from the role

**Status:** provisional (product owner, 2026-11-11: the user list should say what a person is called at work, and that is another fact than manager or employee; built against the freeze on new surface on the product owner's word), built 2026-11-11; amended by D114 on 2026-11-12 for multiple employments and titles on the profile; item 4 amended 2026-11-12 in the fixes of the review of users and the organisation (Q1, X3): a title's value never refuses a request, while an `add` or `replace` on `title` without a value is malformed and refused with 400 `invalidValue`, except beside a deactivation; the Open paragraph answered by D114 item 6 the same day (X5); accepted once a real directory has pushed titles; no manual screen-reader pass yet · **Date:** 2026-11-11 · **Area:** identity, ui

**Amended 2026-11-12.** [D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md) gives each current employment its own optional title on the profile.

Later the same day, in the fixes of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md),
which the product owner asked for on 2026-11-12 with every open decision taken in the work:

- **Item 4 (Q1, X3).** A title's value still never refuses a request: text past 512 characters is cut, a run of
  control or invalid Unicode characters becomes one space, and a value that is not text is no title. An operation
  without a value is another matter. An `add` or `replace` on `title` that carries no `value` member is malformed, as
  on every path of a user and a group, and is refused with 400 `invalidValue` ("Operation '<op>' on 'title' requires
  a value."), with nothing written. Beside a deactivation the refusal waits and the person is deactivated, with the title left as it was
  ([D113](D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)). A `replace` with `null`, a `remove`
  and a `PUT` that leaves the title out still clear it. Item 4's "A title never refuses a request" means its value.
- **Open (X5).** The paragraph below is answered by D114 item 6: a person's titles are the titles of their current
  employments, each with its unit, and the core title is shown where no employment carries one. The row it points to
  in `docs/maintainers/open-questions.md` was removed when D114 settled it. Whether a title belongs to a work
  placement at another unit than the employment's is part of D114's section on work placements, which is not sent
  today.

**Why item 4 changed.** The choice was taken in the work, as the product owner asked. RFC 7644 §3.5.2.1 and §3.5.2.3
require a value for `add` and `replace`, and its Table 9 calls a missing one `invalidValue`. Read as `null`, a missing
value once emptied a person's lists and took a unit's key or parent away, each with a 200. A JavaScript provisioner
sends exactly this when a lookup answers `undefined`, since `JSON.stringify` leaves the member out. Microsoft Entra ID
and Okta never send one, so only a hand-written provisioner meets the refusal, and it learns of its mistake at once
instead of losing data without notice. Keeping a title the one path that accepts a missing value was weighed and left:
one rule for every path is what a directory team can follow, and the deferral beside a deactivation keeps what item 4
was written to protect.

**Decision.** Clew holds two facts about a person's work and never lets one stand in for the other.

1. **The role is Clew's word.** `manager` or `employee`, per unit, from the `unit:` and `unit-manager:` groups (D68,
   D99). It is a closed list of two, it means the same in every installation, and it is what Clew acts on: who
   reports to whom, whose people a manager sees, which unit a person acts as. Nothing here changes it.

2. **The title is the organisation's word.** Byggchef, rektor, specialpedagog, HR-ansvarig: what the source calls the
   person's work. It is free text in the source's own words, there are hundreds of them, and they differ between
   municipalities. A byggchef and a rektor are both `manager`; a biträdande rektor is a manager where the source
   places them in the manager group and an employee where it does not. Clew builds in no list of titles and no
   classification.

3. **Clew never acts on a title.** It is shown and it is searched. No grant, capability, audience, reporting line or
   rule reads it, it is not in the authorization fingerprint, the signed actor a connector receives or the session,
   and a change of title moves nobody's access. A source that wants people of a profession to be an audience pushes a
   group, as for any other audience (D23). This is the rule that keeps an installation's vocabulary out of Clew's
   code.

4. **It arrives as the standard attribute.** `title` on the SCIM User (RFC 7643 §4.1.1), which a directory sends
   without knowing anything about Clew. It is optional. It is kept as sent, less the space around it. An empty
   string, `null`, a `remove` and a `PUT` that leaves it out all mean the person has no title, and a resource
   without one carries no `title`. The five attributes D68 requires are still required; this is a sixth that is
   not.

   **A title never refuses a request.** Text past 512 characters is cut there, a control character in it (a line
   break, or the NUL that PostgreSQL cannot hold) becomes a space, and a value that is not text is read as no title. The first build refused both with a 400, and the review of the change (2026-11-11) turned that
   round: before this record any `title` was accepted and ignored, a refused `POST` leaves a person without access
   and stops a reconciliation at that person, and a client such as Entra sends several changes in one `PATCH`, so a
   refused title would also have refused the deactivation beside it. An attribute that decides nothing must not be
   able to do that. What a directory loses is the error: a mapping that sends something unreadable shows as people
   without a title on the page.

5. **One title per person.** It is on `auth_person`, not on the assignment. A person who works on two units has one
   title, and a move in the organisation tree or between units leaves it alone.

6. **Where it shows.** On Administration › Användare, under the person's name, in the table and in the phone's list,
   and the search box finds it. A person without a title has no line and no words about what is missing, so an
   installation whose directory sends none sees the page as it was. Nowhere else yet.

7. **Audited by the name of the field.** A changed title is a `scim.user.*` row whose `changed` lists `title`, in the
   transaction of the write. The words themselves are not in the audit.

8. **Attribute names are read without regard to case, in a full representation as in a patch** (RFC 7643 §2.1). A
   second review (2026-11-11) found that `Title` in a `PUT` was read as an unknown attribute, so a body that carried
   the title cleared it, while the same spelling in a `PATCH` path set it. The fault was older than the title and
   wider: `Active: false` in a `PUT` was ignored the same way and enabled the person. A `POST` and a `PUT` now read
   the names of a user and a group as a patch does, the nested ones of `name`, `emails` and `members` included. The
   name as the schema writes it wins over the same name in another case.

9. **A required attribute PostgreSQL cannot hold is refused by name.** The same review found that a NUL in a title
   failed in the store with a 500 and took the deactivation beside it down. For the title that is item 4's rule. For
   the five required attributes of a user, and a group's name, key, parent and members, a NUL is now a 400
   `invalidValue` that names the attribute, where it was a 500 that named nothing.

Items 8 and 9 were the first two of a class. [The full review of the SCIM server](../reviews/2026-11-11-scim-full-review.md) found the rest, and [D113](D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md) records the rules that came of it: one way of reading a request, no yes to what the server did not do, and no deactivation refused for what stands beside it.

**What this changes in earlier records.**

- [D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) item 9 said "No employee file: title,
  phone and employment facts are a section read from the system that holds them", and `docs/vision.md` said the same.
  The title is now one line Clew holds. Phone, location, employment facts and everything else about a colleague are
  still read from the source, and this is not the start of an employee file: the test for a seventh attribute is
  whether a list of people is unreadable without it.
- [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) held five attributes of a user. It holds six.
- [D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) (the first real
  integration) allows no new presentation field until its loop works. This is one, added on the product owner's word
  on 2026-11-11. Nothing else of the freeze moves.

**Why one title on the person, and the standard attribute.** Clew is to run in municipalities whose directories the
team will never see. `title` is the one way to say what a person is called that every directory can send as it is.
A title on the person follows the person through a reorganisation, where anything keyed to a unit has to be pushed
again when units are merged or moved. And it is not thrown away if more is built later: with several positions per
person, a row in a list still needs one line to show.

**Weighed and left.**

- *Reading the title from a directory connector when a row is drawn* (D97's way). A page of twenty-five people would
  ask the source for each of them or need a batch read no source offers, the search box could not find a title, and
  there is no directory connector to ask.
- *`position:<code>` groups* ([D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md)
  item 5, proposed and not built). They carry a code a requirement can name, and several per person. They are a
  group per title for the source to maintain, and they answer another question: what a person must hold, not what
  the person is called. D108's positions are neither built nor replaced by this record.
- *A SCIM extension for assignments*, each with a unit, a title and a period. It can say that a person is
  specialpedagog and utvecklingsledare on the same school until June. No directory sends it today, and what
  Metakatalogen can deliver (stable assignment ids, title codes, periods) is not known.

**Open.** Whether a person needs several titles, and whether a title belongs to a placement on a unit with a period
of its own, waits for the review of how Clew describes people, positions and manager responsibility, and for what
the directory can deliver. It is in `docs/maintainers/open-questions.md`. (Answered 2026-11-12 by
[D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md) item 6: a title on each current
employment; for work placements see D114's section
[Employment and work placement in a municipality](D114-person-profiles-show-employments-and-categorised-phone-numbers.md#employment-and-work-placement-in-a-municipality).)

**As built.** `auth_person.title` (migration `0050_person_title`). `ScimUserInputSchema`, `userFields`,
`applyUserPatch`, `userResource` and the User schema document in `modules/people` take, clear and answer it;
`searchUsers` on both adapters looks for a word in it; `UserAdminRow.title` carries it to
`apps/web/src/pages/admin/users.tsx`. The development directory (`scripts/provisioner/directory.ts`) gives its two
hundred and fifty people titles by unit, with a long one, one the source has none for and a school with a rektor and
a biträdande rektor, and `push.ts` sends them. Tests: the scenario in `tests/unit/scim.test.ts` with its audit row
and the unmoved grant, `tests/unit/users-admin.test.ts`, `tests/unit/provisioner.test.ts`, the store contract
(`tests/scim-store-contract.ts`) on memory and Postgres, and `tests/a11y/users.spec.ts` at desktop, phone and 320 px.

**Not done.** A manual pass with a screen reader. The organisation page and Personal do not show the title. An
installation that exists gets the column from the migration and the titles from the next push.
