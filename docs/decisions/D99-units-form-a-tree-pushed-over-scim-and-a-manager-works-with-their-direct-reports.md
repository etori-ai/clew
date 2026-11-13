# D99 · Units form a tree pushed over SCIM, and a manager works with their direct reports

**Status:** accepted (product owner, 2026-11-10: units form a tree, the tree is pushed as resources of its own, a manager works with their direct reports and not with everyone below), built 2026-11-10 (the parent on the unit group, the SCIM extension and its refusals, the reporting line in Personal, talks and the calendar's team, the development directory as a tree, the check, Administration › Organisation; see "As built"); the transport in item 2 is proposed until a real provisioner has used it, the branch of item 5 has no user yet, and the items under "Open" are not decided; the order of a push and whose a unit is are D101 (2026-11-11); the order inside the unit overlay of item 6 and where its close returns the focus are amended by [D121](D121-a-unit-is-walked-one-step-up-and-one-step-down-and-the-people-pages-follow-their-canvas.md) (2026-11-13, provisional, built 2026-11-13: see the last paragraph of "As built") · **Date:** 2026-11-10 · **Area:** identity, product

**Decision.** A unit in Clew has at most one parent, so the units of an installation form a tree, or several. The
provisioner pushes the tree explicitly; Clew never infers it from the people that arrive. Who a manager works with
follows the tree as a **reporting line**: the people placed with them and the managers directly below them, never
everyone in the branch.

1. **What Clew holds about a unit.** An id, a name and a parent, nothing else. The parent is held on the pushed
   group (`auth_group.parent_unit_id`), since the `unit:` group is the node; `auth_unit` stays one row per unit
   somebody is assigned to (D68). There are no levels and no kinds: Clew does not know what a förvaltning or an avdelning is, because depth differs between
   organisations and between branches of one, and the level follows from the parents. A unit without a parent is a
   root, and an installation may have several (a municipality and each of its companies). Clew holds the current tree
   only: validity stays in the source (D68 item 4) and history is the audit rows.

2. **Transport (proposed).** A unit is still the group whose `externalId` is `unit:<unitId>` (D68 item 2). That group
   gains one attribute in an extension schema, `urn:clew:params:scim:schemas:extension:unit:2.0:Group`: `parent`, the
   `externalId` of the parent unit's group (`unit:<parentId>`), absent on a root. Every node is pushed, also one where
   nobody is placed. The server lists the extension in `Schemas` and `ResourceTypes`, takes it in `POST`, `PUT` and
   `PATCH`, and refuses with 400 `invalidValue` and the reason in `detail`, as D96 (a key written wrong) does:
   - a parent that does not exist, so a tree is pushed from the root down;
   - a parent in another organisation, the unit itself, or one that would close a cycle;
   - the attribute on a group that is not a `unit:` group;
   - a new key on a unit group that still has units below it.

   A unit group whose key stops being a `unit:` key gives up its parent with the key, since a group that is no node
   has no place: the write is taken and audited with the parent before and after, and it is refused only when the
   same request names a parent for the new key (product owner, 2026-11-10: the interface takes what a reorganisation
   sends without the client having to know Clew's order of operations). A reorganisation is then one ordinary push,
   root down and leaves up: a unit under a new id is a new unit that the units below move to before the old one goes,
   two units change places, and a level is taken away.

   `DELETE` of a unit that still has units below it answers 409 and names them, so a tree is removed from the leaves
   up. A move is a change of `parent` on the unit. The unit's id stays, so everything that names the unit follows it
   through a reorganisation. It writes its audit row with the parent before and after, and re-derives nobody: a
   person's own unit and role did not change. A write that changes the tree holds the organisation's tree for the
   transaction (`lockTree`), so a parent is not removed while a unit is placed under it and two moves cannot close a
   cycle between them.

3. **A placement stays a membership.** A person is a member of the `unit:` group of the one node they are placed on,
   and of `unit-manager:<id>` for a node they lead, once. A user resource carries no unit id. A provisioner no longer
   repeats a manager in every unit below their own; D68's keys are otherwise unchanged, and a unit that does not exist
   cannot be a placement, since there is no group to be a member of.

4. **The reporting line.** For the work a manager does with persons (Personal, D94; the talks round, action points and
   the talk record, D96 talks):
   - a person placed on a unit as `employee` reports to the managers of the nearest unit, their own or above it, that
     has a manager;
   - a person who is `manager` of a unit reports to the managers of the nearest unit strictly above it that has one;
   - a unit with no manager passes the line through; a person with no managed unit above them reports to nobody;
   - a deactivated manager leads nobody, so a unit whose only managers are deactivated has no manager (`leadsUnit` in
     `domain.ts`, asked by Personal's walk and by the tree an administrator reads; the check mirrors it).

   A manager's **reports** are the people who report to them by these rules: the people placed with them and the
   managers of the nearest managed units below, not the people those managers lead. Managers of the same unit are
   still listed with each other on that unit, as D94 lists them; whether one of them reports to the other is not
   something the tree can say (see "Open"). The line is computed from the
   assignments and the parents when it is read, as D94 reads the assignments and D96 computes the round; it is not
   written into `auth_access_grant` and does not change the authorization fingerprint, so a move leaves durable work
   alone. For a manager of a unit without children the result is what D94 lists today.

5. **The branch.** A manager's branch is the units they manage and everything below. It is for what names no person:
   an aggregate figure, an audience, the structure itself. Nothing uses it yet; a function that wants it says so in
   its own decision, and the default for anything that lists or opens a person is item 4.

6. **Seeing it.** A destination under Administration beside Användare, `/admin/organisation`, behind `admin.users`,
   read only as that page is: the tree as an Astryx `TreeList` at every width, each row with the unit's managers as
   avatars (initials), who leads it and how many people are placed on it and in its branch; and what a push left
   wrong is named above the tree and marked on the row: people with no manager on the unit or above it, a unit nobody
   is placed on and nothing stands under, a unit people are on that no unit group names, people placed on no unit. A
   row opens the unit's people as a focused overlay over the tree (D83), not as leaves in it: origin the row, space an
   end `Drawer` (a `BottomSheet` on a phone), parent the tree, address `?unit=<unitId>`, close back to the tree with the
   focus on the row. The overlay says who leads the unit first, in a group of their own, then the others placed on
   it, then who reports to its managers from the units below (item 4, the walk Personal makes, answered by the same
   function), each named by the unit they lead: the product owner, 2026-11-11, opened the municipality, saw its
   director alone and could not tell from the page that the heads of the administrations report to him; the line was
   only in the tree's indentation. `scripts/provisioner-check.ts` reports the tree and the units whose people report
   to nobody over SCIM.

7. **The development stack.** `scripts/provisioner/directory.ts` is a municipality's line organisation as a tree of
   six levels at its deepest: the municipality and its director, five administrations with a head each, departments
   under three of them with a head each (the managers below the managers), an area under a department, the units
   people work in, and a group under a unit; a manager on every level, a department nobody leads, a unit led from the
   one above it, and two administrations with their units directly under them, since depth differs between branches.
   Two hundred and fifty people in forty-eight units (first built as two hundred and ten in thirty-four over five
   levels; grown 2026-11-10 on the product owner's word that the development stack should simulate a large
   organisation with managers, managers below them and employees, so that the synthetic provisioner pushes what a
   real one would). The people who were there keep their ids and names; the forty new ones are the heads of the
   departments and the people of six further units. `push.ts` pushes the units from the root down and removes from
   the leaves up. `docs/guides/writing-a-provisioner.md` is rewritten for the tree: it is what an installation's
   operations are handed. The size is held where it is by the unit suite, which pushes the whole directory through
   the memory store several times.

**Why.** The product owner, 2026-11-10, before asking Sundsvall's operations for a provisioner: the organisation is a
tree ("det är så vår organisation ser ut") and Clew has to hold it. The example was one person's record from the
source: a path of six levels, municipality to group, written into the person as one string of `level|id|name` parts,
two levels of which share a name under different ids, and a manager flag that names no unit. A tree read out of such
records has no empty nodes and changes on a thousand people when a unit is renamed, which is why the tree is pushed as
its own resources and why the path is not copied into Clew's person.

D68 left the tree to the provisioner: flatten it, and put a manager into `unit-manager:` of every unit below. That
gives the wrong answer for exactly the case asked about. A manager high up would be handed every person in the branch
on Personal and in the talks round, "jäkligt mycket att hålla hand om", while the managers who report to them would be
due a talk with nobody, since a unit's manager is not one of the unit's own people. What that manager wants is "sina
underchefer": the reporting line, which only a tree can give. It is also the smaller authority: a talk record is read
by the person's own manager and not by every manager above.

**Alternatives.** A unit id on the user resource: one write to move a person, and it is how the source looks, but it
holds one placement, cannot say which unit a person leads, and SCIM writes membership on the group, which is what
Entra and Okta send; with both there would be two answers to where a person is placed. A group as a member of a
group, SCIM's own nesting: no extension, but a unit could then have two parents and one member list would mix people
and units. Inheriting authority down the branch, so a manager of a node manages everything below: rejected as the
default by the product owner's case above, and kept as item 5 for what names no person. Levels or kinds on a unit:
rejected, they are the source's vocabulary and differ between organisations.

**Open.**
- Whether the line organisation is the only tree Clew holds. Proposed: yes; cost centres and the political
  organisation are other hierarchies and stay with their sources. Not yet confirmed by the product owner.
- The source: what the manager flag in Sundsvall's records refers to and where a manager is placed (in the unit they
  lead or the one above), whether unit ids survive a reorganisation, whether the units can be delivered as a list of
  their own with a parent id (answered 2026-11-11, D101: they can), and whether a second placement or an acting manager exists anywhere.
- A photograph of a manager. Clew holds none; it would be new personal data with a source and an origin to decide.
- Who besides an administrator sees the tree. A tree with names is a list of other people, and whether Clew may hold
  the fact that a person is protected is still unanswered (D93).
- What a connector is told. Protocol 2's `Actor` carries one unit id and label (D68 item 3); the path above it, and an
  audience that names a branch, belong to the first function that needs them.
- Whether a manager reports to another manager of the same unit (a rektor and a biträdande rektor). Both are pushed
  as managers of the unit and the source says nothing more, so Personal lists them with each other as before and each
  is due a talk with the other.

**As built.** 2026-11-10, branch `organisation-tree`. Migration `0045_organisation_tree` (the parent on `auth_group`,
indexed). `modules/people`: `parentUnitOf`, `assertAcceptedParent`, `closesCycle` and `organisationOf` in `domain.ts`
(pure); `lockTree`, `childUnits`, `unitTree` and `placements` on the provisioning port, in both adapters and the store
contract; the SCIM use cases place a unit, refuse what breaks the tree and audit a move; `staffUsecases.overview`
walks down from each managed unit to the nearest managers, so Personal, the talks round and the calendar's team, which
all read it, follow the line; `organisationUsecases` answers `GET /api/admin/organisation` and
`/api/admin/organisation/units/:id`. A report from below carries `below` (the units they lead, or are placed on where
nobody leads) and Personal says "Chef för Bergsåkers fritidshem" in the role column. Tests:
`tests/unit/organisation-tree.test.ts` (each with its audit row where something is written), the provisioner's, the
store contract on memory and Postgres, a Postgres case for a placement against a removal and for two moves that would
close a ring, `tests/a11y/organisation.spec.ts` and a Personal case in `staff.spec.ts`. On the development stack the
municipality's director has five reports of two hundred and ten people (of two hundred and fifty since the directory grew to six levels, item 7).

Two things about the page were settled by its spec. The row's label holds the unit's name, who leads it, the counts
and the marks, so the row's accessible name is all a person sees on it; the avatars are hidden from assistive
technology, because the row's text already names the managers. And axe's rule for 2.5.3,
`label-content-name-mismatch`, which is experimental, is left out on this page: it reads the rows nested under a
`treeitem` and the name of its expander as that row's visible label, so it fails every row of a nested tree whatever
the row is named. The spec checks the criterion in its place, row by row (`expectRowsNamedByWhatTheyShow`). Astryx has
not been sent a report (the product owner's standing decision). The focus ring of a tree row is drawn on the row
inside the focused list item, which the suite's walk now reads.

After the review of the pull request, 2026-11-10: the line has one rule for who leads a unit (`leadsUnit`), so a
deactivated manager no longer stops it in Personal while the tree said otherwise, and the check counts active managers
only. A unit group whose key stops being a `unit:` key by `PATCH` loses its parent with the key instead of being
refused for a parent the client never sent. `attributes` and `excludedAttributes` name the extension by its URN.
`unitPeople` reads several units at once and within an organisation, so Personal reads the tree once and the people a
level at a time, and the overlay reads one unit instead of the organisation. The overlay counts as the row does,
deactivated people named beside the count.

Since 2026-11-13 ([D121](D121-a-unit-is-walked-one-step-up-and-one-step-down-and-the-people-pages-follow-their-canvas.md)) item 6 is built in another order and
with another return. The overlay is walked: "Ingår i …" steps to the unit above, and the unit a reporting row names,
or a row under "Enheter under", steps down, each replacing `?unit=` without a history entry, with the focus on the
unit's heading and "Visar <enhet>" announced. Its order is the step up, the status line, who leads the unit, who
reports to them from the units below, the units below that no reporting row names, and last the others placed on
the unit, one line each; no row shows a user name. Closing with no step taken still returns the focus to the row
that opened the overlay; after a step it goes to the row of the unit shown, with the tree open down to it. The tree
is a ledger on a screen wider than a phone, the counts in a column at the row's end and still in the row's name,
and what a push left wrong is one card, "Att rätta i katalogen", whose units open the overlay.

**Not done.** A manual pass with a screen reader, which the suite does not replace. Personal looked at signed in as a
manager with a report from below (the use case was read against the development database; the page was run on
fixtures). A provisioner against a real source. The two figures in `docs/architecture/figures/` that draw the group
keys do not show the parent.

**Replaces.** Amends [D68](D68-people-are-pushed-into-clew-through-standard-scim.md): the provisioner no longer
flattens a hierarchy, a `unit:` group gains a parent, and a group as a member of a group stays refused. Amends
[D94](D94-a-manager-has-a-personal-section-listing-the-people-on-their-units.md) item 2 (Personal lists a manager's
reports, which adds the managers directly below) and
[D96 talks](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 1 (a person is
due a talk with the manager they report to, and that manager reads the record). The bodies of those records are left
as they are; their status lines name this decision.
