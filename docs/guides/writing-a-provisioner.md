# Writing a provisioner

A **provisioner** is the one thing that puts people, units and groups into a Clew installation ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md)). It is a process the installation runs, reads the organisation's own source (a directory, an HR export, a metadata catalogue) and pushes to Clew's SCIM 2.0 server at `/scim/v2`. Clew never reads the source and never learns its name; everything the source knows about fields, groups and roles is mapped inside the provisioner. A provisioner is not a connector ([D22](../decisions/D22-connectors-not-modules.md)): it calls Clew, offers no capabilities and is reached by nobody.

This page is the protocol, for whoever writes the provisioner. What the teams around it deliver (the directory, the identity provider, hosting) and how to tell that it works is [Provisioning: what operations deliver](provisioning-for-operations.md).

The repository ships one: [`scripts/provisioner/`](../../scripts/provisioner), which pushes the development stack's directory. Read it alongside this page: [`push.ts`](../../scripts/provisioner/push.ts), which does the work, is about four hundred lines.

![How people enter Clew: the source, the provisioner, the SCIM server, the stored tables, the derivation and the person's grant](../architecture/figures/provisioning-flow.svg)

*Figure 1: A provisioner reads the organisation's source and sends it to Clew's SCIM server; Clew stores what was sent and derives each person's grant in the same transaction. A person who leaves the source is deactivated, never erased: audit rows and threads still point at them.*

## What Clew expects

### Users

`/scim/v2/Users`, the core schema of RFC 7643. Clew requires four attributes. `active` defaults to `true`. `title`, `phoneNumbers` and the employment extension are optional: they are shown, and never read for access.

| Attribute | Meaning in Clew |
|---|---|
| `externalId` | The source's stable id for the person, never reused. Clew finds the person by it on later pushes. |
| `userName` | What a login is matched on. Unique across the installation and matched without regard to case, the standard's default for `userName`; a login carries no organisation. |
| `displayName` (or `name.formatted`) | The name shown in the product. |
| `emails` | Clew holds one address for a person and shows it. It takes the address with `type: "work"`; otherwise one **without a type**, the primary before the first; otherwise the primary, or the first, of what was sent. Clew does not judge an address by its type: send the one colleagues should see. A user with no address at all is refused. |
| `active` | Not required: left out, it is `true`. `false` deactivates. `DELETE` also deactivates, because audit rows and threads reference the person; nothing is erased. A `PUT` without `active` re-enables, since the source is the authority. `true` and `false` may be sent as the words in any case (`"False"`), as Microsoft Entra does. |
| `title` | What the source calls the person's work, in its own words: Byggchef, Rektor, Specialpedagog. For a source that has one title per person. A source that knows each employment sends [those](#current-employments), and their titles are then the ones shown. It decides nothing: whether a person is a manager comes from the `unit-manager:` group and never from a title. |
| `phoneNumbers` | The numbers the directory publishes to colleagues, each with a `type` and a `value`. See [Phone numbers](#phone-numbers). |

An empty string, `null`, a `remove` and a `PUT` without it all clear the title. A title never refuses a request: text past 512 characters is cut there, a control character becomes a space, and a value that is not text is read as no title. [Title handling (D110)](../decisions/D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md).

Clew holds one name per person. Send `displayName` (or `name.formatted`). Without either, `name.givenName` and `name.familyName` are joined into the name. A `PUT` is a full replacement, so it reads the name again from what it carries; a `PATCH` of `name.givenName` or `name.familyName` alone changes nothing.

### Phone numbers

```json
{
  "phoneNumbers": [
    { "type": "work", "value": "070-174 06 05" },
    { "type": "work", "value": "070-174 06 06" },
    { "type": "Jour", "value": "070-174 06 07" }
  ]
}
```

- **Every number that is sent is shown** on the person's profile, to everybody who is signed in to the organisation, whatever its `type`. Which numbers are published is decided in the source. Clew does not leave one out for being called `home`.
- **`value` is shown as it is sent**, less the space around it and a leading `tel:`. Write a number the way the organisation writes it.
- **`type`** is one of the standard's (`work`, `mobile`, `home`, `fax`, `pager`, `other`, in any case) or the directory's own word, such as `Jour`, which is shown as written. A number without a type is listed as "Övrigt". A type may occur several times.
- **A person without a number is not a mistake.** A number Clew cannot read (empty, `null`, not text, longer than 512 characters) is left out, and the person is stored. The [check](#checking-a-push) says how many people have a number.
- **A list holds at most 50 numbers**, each once.
- **To change one of several work numbers, send the complete list.** A full user `PUT` or a `PATCH` with `replace` on `phoneNumbers` replaces the list. An unfiltered `add` appends. An unfiltered `remove` clears the entire list, even if it carries a `value`.
- **A filter selects every match.** A write to `phoneNumbers[type eq "work"].value` sets the value of every work number. Identical type/value pairs then collapse to one. A value filter matches the number across all categories where it occurs. Clearing a selected value removes every match. A type filter with `.value` can also set the first number in an empty category.
- Clew supports the filtered sub-attributes `.value` and `.type`. It accepts writes to other sub-attributes such as `.display` or `.primary` without storing them. Unsupported filter syntax returns 400 `invalidPath`. A write with an additional `and primary eq true` or `and primary eq false` predicate returns 400 `invalidPath` if multiple numbers match the type or value. This applies to the filtered list itself and its `.value` and `.type` sub-attributes. Writes to unheld sub-attributes remain ignored. Clew stores no primary flag. An `add` or `replace` that sets a new number via `phoneNumbers[value eq "…"].value` returns 400 `noTarget` if the old number is missing.

For the three numbers above, this `PATCH /scim/v2/Users/{id}` changes the second work number from `070-174 06 06` to `070-174 06 08` and keeps the first work number and the on-call number.

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{
    "op": "replace",
    "path": "phoneNumbers",
    "value": [
      { "type": "work", "value": "070-174 06 05" },
      { "type": "work", "value": "070-174 06 08" },
      { "type": "Jour", "value": "070-174 06 07" }
    ]
  }]
}
```

### Current employments

Send one entry per current employment in the user's employment extension. The directory chooses which employment details to publish to signed-in colleagues.

**For 50 % of full-time hours, send `"employmentPercentage": 50` on that employment.** The field takes a JSON number from 0 to 100 inclusive, without quotes or a percent sign. Clew displays `0.5` as 0.5 %. If the source expresses full-time hours as a fraction from 0 to 1, multiply that fraction by 100 before sending it. Omit the field when unknown. An explicit `0` displays as 0 %.

This example creates Mikael with `POST /scim/v2/Users` in a test installation where the group `unit:9540` already exists and the account name and external id are available.

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:clew:params:scim:schemas:extension:employment:2.0:User"],
  "externalId": "demo:1001",
  "userName": "mikael",
  "displayName": "Mikael Lund",
  "emails": [{ "type": "work", "value": "mikael@example.org" }],
  "active": true,
  "urn:clew:params:scim:schemas:extension:employment:2.0:User": {
    "employments": [
      { "unitId": "9540", "title": "Systemförvaltare", "employmentType": "Tillsvidare", "startDate": "2019-02-01", "employmentPercentage": 60 },
      { "unitId": "9540", "title": "Projektsamordnare", "employmentType": "Vikariat", "startDate": "2026-09-01", "employmentPercentage": 40 }
    ]
  }
}
```

- **`unitId` is the unit's id**: what follows `unit:` in the `externalId` of the unit's group, written exactly as there. It is required. The unit must be one Clew holds for the organisation, so a unit is sent before an employment names it; an employment on any other unit answers 400 `invalidValue` and names the unit.
- **An employment gives no access.** It says where a person works and what they are called. What a person may do comes from membership of the `unit:` and `unit-manager:` groups, which is sent as [the groups below](#groups) say: a person with an employment on a unit and no membership of its group can do nothing there.
- **The titles of the employments are the person's titles** in the product: on the profile each with its unit, and in the list on Administration › Användare and its search, each title once. Where no employment carries a title, the core `title` is shown.
- **The list is sent whole.** A `PUT` replaces it, and one without the extension clears it. In a `PATCH`, `replace` on `urn:clew:params:scim:schemas:extension:employment:2.0:User:employments` replaces it, `add` appends and `remove` clears the entire list even if it carries a `value`. To withdraw one job, replace the list with the jobs that remain. An entry has no id, so one cannot be picked by a filter, and two entries that say the same are one. A list holds at most 50.
- **The attribute is named with its URN.** `employments` by itself, in a body or as a `PATCH` path, answers 400 `invalidPath` with the name to use.
- **Each employment can carry its own details.** Send `employmentType` as the source's label (such as `Vikariat`) and `startDate` as the first calendar day of this employment in `YYYY-MM-DD` format. Both are optional. An empty entry is left out. An entry with details needs a `unitId`. Clew omits an unreadable date. The date is displayed on the profile. The provisioner sends changes to placements and access when they take effect.
- **Each employment has its own percentage.** The percentages may total more or less than 100. Clew omits an out-of-range value or a string such as `"50"` or `"50%"`. The employment stays on the profile with its other details.
- **When a unit is removed**, send the employments of its people first. The profile shows any remaining employment details without a unit name, and the [check](#checking-a-push) names the affected employment.

[Employments and phone numbers (D114)](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md).

#### Updating employment details

Suppose the first job changes from 60 % to 62.5 % and the second job stays at 40 %. Send this body to `PATCH /scim/v2/Users/{id}` using the user `id` returned by Clew. Include both jobs and every detail the source still publishes.

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [{
    "op": "replace",
    "path": "urn:clew:params:scim:schemas:extension:employment:2.0:User:employments",
    "value": [
      { "unitId": "9540", "title": "Systemförvaltare", "employmentType": "Tillsvidare", "startDate": "2019-02-01", "employmentPercentage": 62.5 },
      { "unitId": "9540", "title": "Projektsamordnare", "employmentType": "Vikariat", "startDate": "2026-09-01", "employmentPercentage": 40 }
    ]
  }]
}
```

To withdraw only the second job's percentage, keep its entry and omit `employmentPercentage` from that entry in the replacement. To withdraw the second job itself, omit its whole entry. Read back `GET /scim/v2/Users/{id}` to see the resulting list.

### How a request is read

The same rules hold for a full representation (`POST`, `PUT`) and for a `PATCH`.

- **Unknown attributes are ignored.** A well-formed write to an extension or attribute Clew does not hold (such as the enterprise extension’s `manager`) is accepted and changes nothing. A path-based user `add` or `replace` must include `value` even for an unknown attribute.
- **Names are read without regard to case**, as the standard says (RFC 7643 §2.1): `Title`, `Active` and `DisplayName` are `title`, `active` and `displayName`. That holds for the attributes of a body, the nested ones (`emails[].Value`, `members[].Value`, the unit extension's `Parent`), a `PATCH` path, the PatchOp message's own `Operations`, `op`, `path` and `value`, and a `.search` body.
- **In a full representation, `null` is the same as leaving the attribute out** (RFC 7643 §2.5), so a serializer that writes every empty field as `null` is not refused for it. In a `PATCH`, an explicit `null` takes the attribute away, as a `remove` does. On a user, a path-based `add` or `replace` with its `value` member missing returns 400 `invalidSyntax`. A simultaneous deactivation follows the rule below.
- **A required attribute that is wrong is refused by name**, with 400 `invalidValue`: one that is missing, empty, only space, longer than 512 characters, not text, or holding a NUL character. The same holds for a group's name, key, parent and members. A body that is not a JSON object at all answers 400 `invalidSyntax`.
- **What is only shown never refuses a person for being empty.** A title, a phone number or an employment entry with nothing readable in it is left out, and the rest of the request is stored. What is refused is a request that says something Clew cannot take as said: an employment on a unit it does not hold, a list past its limit.
- **A required attribute cannot be taken away.** A `remove` of one, or a value of `null`, answers 400 `mutability`.
- **A deactivation is never refused for what stands beside it** ([D113](../decisions/D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)). A request that says `active: false` deactivates the person even when it also takes a required attribute away, sets one wrongly or names an employment on a unit Clew does not hold; that attribute is left as it was. Entra sends a leaver's emptied mailbox in the same `PATCH` as the deactivation, and a `PUT` of a leaver whose address is gone from the source is the same case. Valid attributes in the same request can still change. For a returning person, reconcile memberships first and send the full profile once with `active: true`.
- **A `PUT` that leaves out `externalId` keeps the one Clew holds.** Okta's update sends none. A `POST` needs it.
- **A path-less `PATCH` may repeat the resource's own `id`, `schemas` and `meta`**, as Okta does; an `id` that names another resource is refused.

### Deactivation, not deletion

`DELETE /Users/<id>` deactivates, and the resource stays readable with `active: false`, where the standard expects a 404 afterwards. Three consequences follow. A client that deletes and then posts the same `userName` gets 409 `uniqueness`, so find the person by filter first and `PUT` or `PATCH`, as `push.ts` does. A deactivated person keeps the `userName` until a `PATCH` changes it, so a recycled account name has to be moved off the old row before a new person can take it ([how the example does it](#what-a-provisioner-does-on-every-reconciliation)). And a `PUT` of a deactivated person without `active: false` re-enables them: a provisioner that pushes everyone present undoes an administrator's `DELETE` on the next run, which is D68's intent, and the audit row says `scim.user.reactivated`.

### Groups

![What a pushed group means: keys in externalId give units, manager roles and capabilities; any other group may be mapped by an administrator](../architecture/figures/group-keys.svg)

*Figure 2: What a group means is carried by a key in its `externalId`: a unit, a manager's role or a capability. Any other group means nothing until an administrator maps it.*

`/scim/v2/Groups`. Every group is stored as pushed. Meaning is carried by a key in the group's `externalId`:

| `externalId` | A member gets | `displayName` |
|---|---|---|
| `unit:<unitId>` | An assignment to that unit as `employee`. The group is also the unit itself: a node of the organisation tree, which may name the unit above it (see below) | The unit's name, shown in the product |
| `unit-manager:<unitId>` | An assignment to that unit as `manager`, which wins over `unit:` for the same unit | Free |
| `capability:<name>` | That capability, one of the closed list (`admin.connectors`, `admin.users`, `admin.appearance`, `admin.competence`) | Free |
| `position:<code>` | That position ([D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) item 5): what the person is employed as, such as undersköterska or maskinförare. It is the person's, not a unit's, and by itself decides no access; like any group, an administrator can map it to a capability ([D85](../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)). The code is the source's own: Clew builds in no classification of positions | The position's name |
| `protected`, in any case | Refused with 400 `invalidValue` ([D93](../decisions/D93-the-protected-key-is-refused-at-the-scim-boundary.md)): Clew has not decided whether it may hold that fact, so do not send it | Free |
| Anything else | Nothing by itself; an administrator may map it to a capability in Clew ([D85](../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)) or to Kompetenssökning, the relation to people `registrar` that reads competence across the organisation ([D121](../decisions/D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md)), and use it as a connector audience | Free |

A person with no `unit:` or `unit-manager:` membership exists but can do nothing, so a mapping mistake fails closed. Several memberships give several assignments; until a person can switch, the active one is a managed unit before an employed one, then the first unit id in text order. Text order is not numeric order: `10` comes before `9`.

**A position is the person's.** A person holds zero or more positions, one membership each, and holds them wherever they are placed: a person who is a maskinförare and a handläggare is both, on every unit they work in. Send every position the source lists as a group, also one nobody holds yet; its name is the label. A code is unique in the installation, as a unit id is, because a group's `externalId` is. Renaming the group renames the position for everyone who holds it. Removing the group, or giving it another key, takes the position from everyone who held it, and Clew no longer has it. A change in which positions a person holds is audited on the person as `positions.derived`, with the codes. A position by itself decides no access: what a person may do comes from the `unit:` and `unit-manager:` groups. Like any provisioned group, an administrator can map a `position:` group to a capability on Administration › Användare, and its holders then have that capability.

**Kompetenssökning has no key.** Who may search competence across the organisation ([D121](../decisions/D121-a-registrar-reads-competence-across-the-organisation-through-a-relation-of-its-own.md)) is a relation to people, not a capability, and no group key gives it: `capability:registrar` is refused as a name outside the list. Push the people who should have it as an ordinary group (an HR team, the staffing coordinators), and an administrator maps that group to Kompetenssökning on Administration › Användare, as a capability is mapped. Every read made with it is logged.

**Keys are exact, and one written wrong is refused** ([D96](../decisions/D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md)). The prefixes are lower case with the id, name or code directly after the colon. `Unit:skola`, `Position:usk`, ` unit:skola` or `unit :skola` with space in or before the prefix, `unit:` or `position:` with nothing after it, `unit: skola` or `position: usk` with space after the colon, and `capability:` with a name outside the list answer 400 `invalidValue` with the key and the reason in `detail`, instead of becoming a plain group that gives nobody anything.

### The organisation tree

**Units form a tree, and you push it** ([D99](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)). An organisation is a tree, and Clew holds it as you send it: every unit is a `unit:` group, also a unit nobody is placed on (a heading such as "Avdelningar"), and a unit below another names the one above it in an extension schema on the group:

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group", "urn:clew:params:scim:schemas:extension:unit:2.0:Group"],
  "externalId": "unit:9540",
  "displayName": "Utveckling",
  "members": [{ "value": "<the person's SCIM id>" }],
  "urn:clew:params:scim:schemas:extension:unit:2.0:Group": { "parent": "unit:11213" }
}
```

`parent` is the `externalId` of the unit group above, written as exactly as a key is. A root carries no extension, and an installation may have several roots (a municipality and each of its companies). Clew holds an id, a name and a parent for a unit and nothing else: no levels and no kinds, so a förvaltning, an avdelning and an enhet are all units, and the depth may differ from branch to branch. Clew never works the tree out from the people: a tree that exists only as a path on each person has to be turned into units in the provisioner, and it is better still when the source can list its units with a parent id.

- **A name in the extension is read without regard to case too**, and the extension's URN likewise.
- **Push from the root down, remove from the leaves up.** A parent that does not exist yet answers 400 `invalidValue`, and so does a parent in another organisation, a unit as its own parent, a parent that stands below the unit (a cycle), and the extension on a group that is not a `unit:` group. `DELETE` of a unit that still has units below it answers 409 and names them.
- **A move is a change of `parent`.** `PUT` the unit group with the new parent, or `PATCH` the path `urn:clew:params:scim:schemas:extension:unit:2.0:Group:parent` (`replace` to move, `remove` to make a root); a `PUT` without the extension also makes a root, and a unit group whose key stops being a `unit:` key (a `PATCH` that replaces or removes `externalId`) loses its parent with it. Name the extension by its URN in `attributes` or `excludedAttributes` to read or leave out the parent. Keep the unit's id through a reorganisation: everything in Clew that names the unit follows it, and remember that a new parent can change which managers see a branch’s people.
- **Place a person once.** A person is a member of the `unit:` group of the unit they work in, and of `unit-manager:<id>` for a unit they lead. Do not put a manager into the manager group of every unit below their own.
- **The reporting line follows the tree.** A person reports to the managers of the nearest unit, their own or above it, that has a manager; a manager reports to the managers of the nearest unit above their own that has one; a unit nobody leads passes the line through, and so does a unit whose only managers are deactivated. In the product a manager sees and works with their reports: the people placed with them and the managers directly below, never everyone in the branch. So a manager high up needs the managers below them to be pushed as managers of their own units, and a person on a unit with no manager on it or anywhere above it reports to nobody: the check names such a unit.

**A group's members are people, named by Clew's id.** A member's `value` is the `id` Clew answered when the person was created, not the source's id: a source id answers 400 `invalidValue` with `Member '<id>' is not a user of this organisation.` Find the id with `GET /Users?filter=externalId eq "<source id>"`. A group as a member of a group is refused with 400 `invalidValue`; send the people. The tree is the `parent` above, not nesting.

### Transport

- **Filters.** `filter` supports one equality: `userName eq "…"` or `externalId eq "…"` on users, `externalId eq "…"` or `displayName eq "…"` on groups. `userName` and `displayName` are matched without regard to case, `externalId` exactly. The attribute may carry its schema's URN, and the value is a JSON string. Anything else answers 400 `invalidFilter`.
- **Pages.** `startIndex` and `count` page, at most 200 rows.
- **Narrowing an answer.** `attributes` and `excludedAttributes` narrow what any request answers: a read, a list, a `.search` body, and a `POST`, `PUT` or `PATCH` too. `excludedAttributes=members` changes a large group without having all its members sent back.
- **`PATCH`.** A path per operation, the schema-qualified form, and the path-less object form that Microsoft Entra and Okta send. One message carries at most 500 operations; more answers 400 `invalidSyntax`.
- **Members.** Two paths are read: `members`, with a list of `{ "value": "<id>" }` to `add`, `remove` or `replace`, and `members[value eq "<id>"]`, to `remove` one. Any other path under `members` (another filter, two values joined by `or`, a trailing `.value`) answers 400 `invalidPath`: Clew does not answer yes to a removal it did not make. `add` and `replace` need a value; `replace` with an empty list empties the group, and so does `remove` on `members` without a value.
- **E-mail.** Clew holds one address. `emails`, `emails.value` and `emails[type eq "work"].value` (or `primary eq true`) are that address, and `replace` on `emails` with a list picks from the list as a body does. A path that names another type, such as `emails[type eq "home"].value`, is beside the one address and changes nothing, and `add` of an address of another type likewise. A list sent to a work or primary filter is read by the same preference (work, then one without a type), and one that holds only another type is refused with 400 `invalidValue`: the path says work and the value says otherwise. Any other filter answers 400 `invalidPath`.
- **Not offered.** Bulk, `/Me` and a search across resource types answer 501. Sorting and ETags are not offered either, and `ServiceProviderConfig` says so. A method an address does not take answers 405 with `Allow`.
- **Errors** are the standard's error resource with `scimType` and an English `detail`. While the server starts, or cannot check a token, it answers 503 with `Retry-After`.

**Concurrent writes.** User PUT, PATCH and DELETE lock the person's row before reading current fields. Group writes lock their group, and grant derivation serialises changes for each person. Independent patches preserve each other's attributes. Two changes to the same attribute take effect in commit order. The writer must order its source events and snapshot replay.

### Authentication

A bearer token issued to the provisioner by a Clew administrator, for this purpose alone. An administrator with `admin.users` issues it on Administration › Användare ("Lägg till katalog"), where it is shown once, and replaces it or takes it back there ([D107](../decisions/D107-an-administrator-issues-replaces-and-takes-back-a-provisioners-key-on-the-users-page.md)). The first token of an installation, before anybody is an administrator, comes from a script that is run inside Clew's app container (in the development stack, with `docker exec -w /workspace clew-app-1` in front):

```bash
bun scripts/provisioner-token.ts add metakatalogen --organisation sundsvall --label "Metakatalogen"
```

Send it as `Authorization: Bearer <token>`.

The token is printed once; Clew keeps its digest. `rotate <id>` issues a new one and lets the old one answer for a grace period (24 hours unless `--grace-hours` says otherwise), so the provisioner is switched without a push failing (Clew keeps one old token: rotating again inside the grace period ends the one before, and the script says so); `revoke <id>` ends every token of the provisioner at once; `list` shows each provisioner with its state and when it was last seen. The token scopes users and groups to the organisation it was issued for: another organisation's resources do not exist for this client, while `userName` and `externalId` stay unique across the installation. A unit belongs to the organisation that pushed it: `unit:<id>` or `unit-manager:<id>` for a unit another organisation holds is refused with 400 `invalidValue` (D101).

Clew records when a provisioner last called, and Administration › Användare shows it with a warning after two days of silence. An audit row, `provisioner.seen`, is written when a provisioner is heard from after half an hour of silence. A provisioner that sends changes through the day is seldom silent that long, so Clew cannot tell that its daily comparison ran: log the last successful full run in the provisioner, and alarm on that.

## What a provisioner does when something changes

A change in the source is sent to Clew when it happens, not saved for a nightly run ([D109](../decisions/D109-a-provisioner-sends-a-change-when-it-happens-and-reconciles-the-whole-source-daily.md)). A profile update takes one request. Creating and placing a person or moving them between units takes two. More complex duty changes can require several requests. Each committed change takes effect at the next access check.

| In the source | Send |
|---|---|
| A person begins | `POST /Users`, then `PATCH` `add` on the `unit:` group they are placed on |
| A name, a user name or the published e-mail address changes | `PATCH /Users/<id>` |
| A title is set, changed or taken away | `PATCH /Users/<id>`: `replace` on `title`, or `remove` |
| A phone number is added, changed or taken away | `PATCH /Users/<id>`: `replace` on `phoneNumbers` with the numbers the person now has |
| An employment begins, ends, or changes unit, title, employment type, start date or percentage | Send the [complete employment list](#updating-employment-details) in a user PATCH as soon as any published detail changes. |
| A person leaves | `PATCH /Users/<id>` with `active` `false` |
| A person moves to another unit | `PATCH` `add` on the unit they join, then `PATCH` `remove` on the unit they leave; their employments, when the source sends them, with a `PATCH` on the user |
| A person becomes a manager, or stops being one | `PATCH` `add` or `remove` on `unit-manager:<id>` |
| A person gains or loses a capability | `PATCH` `add` or `remove` on the capability's group |
| A unit is added | `POST /Groups` with its `parent`, once the unit above exists |
| A unit is renamed or moved | `PATCH` its `displayName` or its `parent` |
| A unit is removed | `DELETE` both of its groups, `unit:<id>` and `unit-manager:<id>`, once nothing stands below it, its people have been placed elsewhere and their employments have been sent. Clew removes the group it is asked to and no other: a manager group left behind keeps its members as managers of a unit that is gone. |

A unit, a manager's role and a capability are memberships, and SCIM changes a membership on the group, not on the person: a user's `groups` are read only. An employment is the other way round: it is an attribute of the user, and it places nobody. A source that holds the unit and the manager flag as fields on the person turns a change of such a field into the group requests above. A change that takes effect on a day (an acting manager from the first of the month) is sent on that day: Clew holds no dates of validity.

## What a provisioner does on every reconciliation

Beside the changes, the whole source is compared with what Clew holds at least once a day. A change that was lost on the way, because the provisioner was down or a request failed and was not sent again, is found by nothing else, and the run leaves an unchanged person’s fields, memberships and grant intact. It still sends a full replacement for each present person.

The organisation first, then the people, then who is placed where, so that a unit exists when an employment or a membership names it ([D101](../decisions/D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)). Read the organisation from the source as a list of its own: each unit with its id, its name and the id of the unit above it.

1. **Check the export whole, before the first write.** Read the people Clew holds (`GET /Users`, a page at a time, with `attributes=externalId,userName,active` so that nobody's groups are read) and compare with the source. Stop here when the run would deactivate far too many (see the guard below), and when an id names two rows: two people with one `externalId`, two units or two groups with one id, or two active people with one account name. Clew cannot see the first of those. Both rows are well-formed requests, and the result is one person with the later row's name and both rows' placements. A person with two employments is the usual way a source comes to list an id twice: give them one row with both placements. Plain directory groups also need their own keys. The example refuses `unit:`, `unit-manager:`, `capability:`, `position:` and the exact key `protected` in that list, including case and spacing variants. A key such as `ad:newsletter` is available for an ordinary group.
2. **Deactivate who has left**, before anything else is written: each person Clew knows under this provisioner's `externalId` space who is gone from the source, and each the source now says is inactive. `PATCH` `active` to `false`. A deactivation depends on nothing that follows, so nothing that goes wrong further down, a unit Clew refuses or a name that is taken, keeps a leaver active.
3. The units, from the root down: `GET /Groups?filter=externalId eq "unit:<id>"`, then `POST` the unit when it is absent, with its name and its `parent` and no members, or `PATCH` its `displayName` or its `parent` when one of them changed. The unit above then exists when the one below is written. Do not `PUT` a unit without its members: that empties it.
4. The people, in this order:
   1. **Move a reused account name off its old row** (see below).
   2. **Send new active people and update existing people whose return is not pending**, with an explicit active state: `POST` when absent, `PUT` when present. Do not create a person the source keeps as inactive and Clew has never held: a disabled row holds their `userName` against the next person who is given it. The server writes nothing when nothing changed.
   3. **Keep the existing SCIM id for a returning person.** Their profile is written in step 7.
   4. **A person Clew refuses is that person's alone.** A 400 or a 409 about one person says the source has that row wrong. Record it, send everybody else, and fail the run at the end with the list. The example returns them as `refused` and exits non-zero. A run that stops at the first refusal leaves everybody after that person unsent.
5. Who is in which group (the units, the managers of each unit, the capability holders, the positions, the plain directory groups), using existing SCIM ids and those returned in step 4, **in two rounds**. First, for every group, `PATCH` `add` the members it gains (or `POST` a group that does not exist with its members). Then, for every group, `PATCH` `remove` the members it loses. A person who moves between two units is then in both for a moment and never in neither. Sent the other way round, the person has no unit between the two writes, Clew takes their access away and hands it back, and a request in between signs them out.
6. For each group with a key this provisioner owns that no longer follows from the source: `DELETE`, a unit only once no unit that is also going still stands below it. Groups with other keys belong to somebody else and are left alone.
7. **Activate who has returned, with the whole row.** Once their old duties are gone, send one `PUT` with the full profile and `active: true`. Clew validates the profile and activates the person in the same request. A refused return leaves the person inactive and appears in the run's list of refusals.

Run it at least daily, as the net under the changes sent as they happen. Validity lives in the source (a ställföreträdare is a membership the provisioner adds when the period starts and removes when it ends), so access ends when the change arrives. A leaver's account must also be closed at the identity provider.

**Guard the complete export.** Only mark `Directory.complete` after checking all pages or source manifest counts for people, units, groups and memberships. An incomplete export is refused before any write, including with `force`. After a retryable 503, the example reads Clew again. The completed run reports deactivations and group changes against the first complete read and counts each accepted person once. The example checks four populations: owned active users (absent or now inactive), units, plain groups, and manager and capability groups together. It stops when a run would withdraw all of one of them, which is what an empty export looks like, or more than one row and more than 20% of it. A single row is let through when it is not the only one of its kind, so a source of three people can lose one of them, while removing the only plain group there is needs an operator's word. An operator can approve a verified large change. Give each writer a stable user prefix and disjoint group prefixes or exact keys, including for administrative groups. The token scopes the organisation and does not partition writers within it.

**A user name is not free again by itself.** `DELETE` deactivates and erases nothing, so a leaver keeps their `userName` and a new person with the same one is refused with 409. A source that reuses user names gives the old row another `userName` first, with a `PATCH`. The example gives it the row's own `externalId`: it is unique, it is never reused, and nobody signs in with it. It does so for a leaver who is gone from the source, for one the source keeps as inactive under the name it has given away, and for two people who swap names.

## Checking a push

Export `CLEW_PROVISIONER_TOKEN` from the secret store before running the checker.
```bash
bun scripts/provisioner-check.ts https://clew.example/scim/v2
bun scripts/provisioner-check.ts https://clew.example/scim/v2 --roots 1
```

`--roots <n>` says how many roots the source's tree has; the check warns when the count differs in either direction. Compare exact parent links separately.

The check reads what the installation holds, over SCIM alone, and changes nothing: that the endpoint and the token answer, how many users and groups of each kind there are, which active users have no unit (and so no access), how many active users have a title, a phone number and an employment, which employments name a unit that is no longer held, which managed units no `unit:` group names, how many roots and levels the tree has, which unit groups are empty (a unit with units below it may be a heading and is not named), which units have people and no manager on them or above them, and which stored groups carry a key written wrong. An administrator sees the same tree in the product, on Administration › Organisation. It authenticates as the provisioner, so it counts as a call from it; issue the check a token under an id of its own to leave the provisioner's last-seen time alone.

## The example

`scripts/provisioner/directory.ts` is the development stack's source: two hundred and fifty people in forty-eight units that form a tree of six levels at its deepest (the municipality, its five administrations, departments under three of them, an area under a department, the units people work in, and a group under a unit), with a manager on every level, so a head of an administration has heads of departments below them who have unit managers below them; a department nobody leads, a unit led from the one above it, and two administrations whose units stand directly under them, since the depth differs between branches; each person with a unit, a manager flag and an employment with a title after the unit they work in (one person has no title), some working in or managing a second unit, four with two employments and three with phone numbers, one unit with two managers, everyone in plain directory groups (`ad:…`, which mean nothing in Clew until an administrator maps or names them) that run from nobody to eighty-seven members, a few with Clew capabilities, seven written by hand with the names a generator does not come up with (a hyphen, an apostrophe, accents, a very long name, two people with one name), and four of them personas with a Keycloak account. `push.ts` maps those facts to the groups above (`plan()`, pure: the units from the root down) and pushes them in the order above (`push()`, idempotent: the organisation, the people, additions before removals, removing from the leaves up, with the guard against an empty or truncated source, and with the people Clew refused reported at the end), through `client.ts`, the SCIM client. `bun run auth:setup` runs it in-process after creating the Keycloak accounts; `bun run dev:provision` runs it over HTTP against a running `bun run dev`. `tests/unit/provisioner.test.ts` runs it against the routes on the memory store and is the shape a provisioner's own tests can take: no network, no vendor account. Its last test is of another kind: it runs the Bash blocks of the [operations walkthrough](provisioning-for-operations.md) with `bash`, `curl` and `python3` against the same routes on a loopback port.

To write yours, supply a complete source snapshot with explicit `active` values, an e-mail address approved for publication and a `SourceScope` for `push`. List exact keys for shared prefixes that have different owners. The example removes expired duties before re-enabling a returning person. Serialize snapshots with event delivery and persist the last confirmed source cursor. Log the last successful full run and the oldest outstanding change. [Operations handover](provisioning-for-operations.md) includes recovery by HTTP outcome and an executable installation check.
