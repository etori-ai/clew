# SCIM objects and delivery order

Your municipality’s provisioner sends people as SCIM `User` resources and units, placements and permissions as `Group` resources. Before your first delivery, obtain the test installation’s HTTPS base URL ending in `/scim/v2` and its provisioner token. Send the token in `Authorization: Bearer <token>` and request bodies as `Content-Type: application/scim+json`. Paths below are relative to that base. [Transport and authentication](writing-a-provisioner.md#transport)

## 1. Send units from root to leaf

Each Clew installation serves one organisation. The provisioner token identifies that organisation for every request. Within it, give each unit its own permanent source ID. Keep that ID when the unit is renamed or moved. Change its parent link when it moves.

Send a `POST /Groups` for each unit, including empty units. Give a root a stable `externalId`, such as `unit:100`, and a `displayName`. For a child, include the unit extension and set its `parent` to the parent's complete external key. This request creates a child of `unit:100`. [Group keys and unit schema](writing-a-provisioner.md#groups)

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group", "urn:clew:params:scim:schemas:extension:unit:2.0:Group"],
  "externalId": "unit:110",
  "displayName": "Utbildning",
  "urn:clew:params:scim:schemas:extension:unit:2.0:Group": { "parent": "unit:100" }
}
```

## 2. Send people

Give each person a permanent source ID (`externalId`). Keep it through account renames, transfers and returns, and never reassign it to someone else. Send it in `POST /Users` with the unique account name (`userName`), the person’s name and an email address approved for publication to colleagues. Send the source's current `active` value explicitly. Clew defaults it to `true` on creation and full replacement. The account name must match the configured ID token claim at first sign-in. [User fields and accepted name formats](writing-a-provisioner.md#users)

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "externalId": "e-1001",
  "userName": "anna.berg",
  "displayName": "Anna Berg",
  "emails": [{ "type": "work", "value": "anna.berg@example.org" }],
  "active": true
}
```

The response to a successful create contains Clew's `id`. Keep it for subsequent writes. If the response is lost, look up the resource by `externalId` before retrying. The optional profile fields include [phone numbers](writing-a-provisioner.md#phone-numbers), a title and [current employments](writing-a-provisioner.md#current-employments). An employment references the unit by its bare ID, such as `110`. Access comes from group membership.

## 3. Send placements, managers and permissions

A membership update targets the **group's Clew ID**. Each `members[].value` contains the **person's Clew ID**. For example, to place an employee in Utbildning, send this body to `PATCH /Groups/<Clew ID of unit:110>` and substitute the ID returned for that employee.

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "add", "path": "members", "value": [{ "value": "<employee's Clew user ID>" }] }
  ]
}
```

### Assign the manager to the unit they lead

If your HR system marks Anna with `isManager: true`, resolve which unit she leads in your provisioner. If it records a manager against each employee, use those records to identify the responsible manager for each unit. In both cases Clew expects a membership for Anna in `unit-manager:<unitId>`. A flag, title or SCIM Enterprise User `manager` field on a user grants no manager placement.

For Anna to lead Utbildning, create its manager group with `POST /Groups` after creating `unit:110` and Anna. Substitute Anna’s returned user ID below. If the manager group already exists, add Anna with the membership patch above, targeting the manager group's Clew ID.

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "externalId": "unit-manager:110",
  "displayName": "Chefer för Utbildning",
  "members": [{ "value": "<Anna's Clew user ID>" }]
}
```

This membership gives Anna her placement as manager. Send one such membership per unit she leads. Clew derives her direct reports from the unit tree and the people placed on it. Managers on the same unit share its staff. Individual exceptions to that reporting line cannot be expressed with a field on the employee. [Reporting-line rules](writing-a-provisioner.md#the-organisation-tree)

| To give someone… | Use this group's `externalId` |
|---|---|
| An employee placement | `unit:110` |
| Responsibility for unit 110 | `unit-manager:110`. Membership supplies a manager placement on its own. Clew derives reporting lines from placements and the unit tree. |
| Permission to administer users | `capability:admin.users`. Give the first administrator this membership as well as a unit placement. |

Apply membership changes when responsibility starts or ends. A directory group such as `ad:larare` can also be mapped to a capability by a Clew administrator. An active person needs an employee or manager placement to sign in. [Group semantics and reserved keys](writing-a-provisioner.md#groups)

## Test the delivery

[Run the school walkthrough](scim-school-walkthrough.md) on an empty test installation. It creates four units and three people, checks the resulting placements, then moves an employee and deactivates a leaver. Before enabling production sign-in, verify that the tree matches the source, a manager sees the expected employees in Personal, and the test administrator can open Användare. Send subsequent changes when they take effect and compare the full source with Clew at least once a day.

| Next task | Guide |
|---|---|
| Map optional fields or look up a response code | [SCIM protocol reference](writing-a-provisioner.md) |
| Send a change, reconcile the directory or recover from a rejected request | [Directory operations](scim-directory-operations.md) |
| Set up sign-in, hosting and tokens | [Sign-in and hosting](scim-sign-in-and-hosting.md) |
