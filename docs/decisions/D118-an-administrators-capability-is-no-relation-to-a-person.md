# D118 · An administrator's capability is no relation to a person: Användare and Personal list the same people, and what is shown about one follows the relation

**Status:** accepted (product owner, 2026-11-12: "keep it that way"; a boundary of scope that confirms what is built, nothing in the code changes) · **Date:** 2026-11-12 · **Area:** identity, product

**Decision.** Three rules for what a person with an administration capability may see about another person.

1. **One entity, two lists.** A person is one core record, pushed in over SCIM
   ([D62](D62-users-are-core-entities-not-connected-systems.md),
   [D68](D68-people-are-pushed-into-clew-through-standard-scim.md)). Administration › Användare (`/admin/users`, behind
   `admin.users`) lists everyone in the installation, for identity and access. Personal (`/staff`,
   [D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md)) lists the people on the units the
   reader manages. Personal is a manager's cut of the same directory, not a second kind of record, and both lists open
   the same page, `/people/<user name>`.
2. **The page follows the relation, never the list.** What a person's page shows from a source is decided by how the
   reader stands to that person, `self`, `managed` or `colleague`
   ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)), whichever
   list or link the reader came by. No capability in `CAPABILITIES` is a relation and none widens one. An administrator
   who opens a person they do not manage is a `colleague` and sees what any colleague sees: employments and contact
   details ([D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md)). The person's courses and
   badges from the learning platform, HR rows, appraisals, talks and competence holdings are not asked for.
3. **`admin.users` is for identity and access.** It reaches who exists, their placements, their groups and the mapping
   to capabilities ([D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)), and the organisation tree
   ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) item 6).
   `admin.competence` reaches the catalogue, the requirements, the share targets and the source mappings
   ([D108](D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md)), not one person's holdings; a manager handles the one-person case. `admin.connectors` and
   `admin.appearance` name no person at all.

**Why.** The product owner asked on 2026-11-12, with Användare and Personal side by side in the rail, whether they are
different entities and whether an administrator should see every user's learning-platform data. They are not, and the
administrator should not:

- D117 was built on his rule "a user can view and edit their own data and nothing else; a manager their employees'".
  An administrator who saw everyone's source data would be the first exception to it, and the widest possible one.
- `admin.users` is a technical capability, typically held by the people who run the installation. Running the
  directory gives no authority over a colleague's course records, absence or appraisal. That is personnel data, and
  data minimisation applies to it: access follows a need in the work, and administering accounts is not such a need.
- A source that trusts Clew's relation (D117 item 5) would answer for everyone the moment a capability counted as one.
  Keeping capabilities out of the relation keeps that mistake impossible rather than merely unbuilt.

**If someone needs to see across the organisation later** (HR, a competence coordinator), neither way rides on
`admin.users`:

- figures that name no person, per unit or per branch (D99 item 5, the share targets of D108);
- a new person relation in `PERSON_RELATIONS`, granted on its own, audited, admitted capability by capability by each
  source, as a contract change with its own decision.

**Alternatives.** Letting `admin.users` count as `managed` for everyone: rejected for the reasons above. A separate
"view as administrator" switch on the person's page: rejected, it is the same exception with a button. Hiding
Användare's link to the person's page so that the two lists cannot be confused: not needed, the page is safe to open
and useful for checking a placement.

**Not established.** That the two rows in the rail read as one concept to a person who has both has not been tested;
if they do not, the answer is naming or placement, not access. Clew's own domain routes (`/api/talks`,
`/api/competence`, `/api/staff`) keep their own D99 check (D117, "Not established"); none of them consults a
capability to decide whom a reader may see, and this record binds them to stay so.

**Replaces.** Nothing. States for capabilities what D117 states for relations.
