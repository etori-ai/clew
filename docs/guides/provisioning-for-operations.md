# SCIM objects and delivery order

The directory team sends two SCIM resource types to Clew: `User` for a person and `Group` for a unit, a manager assignment or a permission. Use the installation's HTTPS base URL ending in `/scim/v2`, a provisioner bearer token and `Content-Type: application/scim+json`. Paths below are relative to that base. [Transport and authentication](writing-a-provisioner.md#transport)

## 1. Send units from root to leaf

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

Send a `POST /Users` with a stable source `externalId`, a unique account name, the person's name and an email address approved for publication to colleagues. Send the source's current `active` value explicitly. Clew defaults it to `true` on creation and full replacement. The account name must match the configured ID token claim at first sign-in. [User fields and accepted name formats](writing-a-provisioner.md#users)

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

A membership update targets the **group's Clew ID**. Each `members[].value` contains the **person's Clew ID**. For example, to place Anna in Utbildning as an employee, send this body to `PATCH /Groups/<Clew ID of unit:110>` and substitute the user ID returned for Anna.

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "add", "path": "members", "value": [{ "value": "<Anna's Clew user ID>" }] }
  ]
}
```

| To give someone… | Use this group's `externalId` |
|---|---|
| An employee placement | `unit:110` |
| Responsibility for unit 110 | `unit-manager:110`. Membership supplies a manager placement on its own. Clew derives reporting lines from placements and the unit tree. |
| Permission to administer users | `capability:admin.users`. Give the first administrator this membership as well as a unit placement. |

Create each group before updating its members. A directory group such as `ad:larare` can also be mapped to a capability by a Clew administrator. An active person needs an employee or manager placement to sign in. [Group semantics and reserved keys](writing-a-provisioner.md#groups)

## Test the delivery

[Run the school walkthrough](scim-school-walkthrough.md) on an empty test installation. It creates four units and three people, checks the resulting placements, then moves an employee and deactivates a leaver. The output shows which checks passed.

| Next task | Guide |
|---|---|
| Map optional fields or look up a response code | [SCIM protocol reference](writing-a-provisioner.md) |
| Send a change, reconcile the directory or recover from a rejected request | [Directory operations](scim-directory-operations.md) |
| Set up sign-in, hosting and tokens | [Sign-in and hosting](scim-sign-in-and-hosting.md) |
| Prepare the meeting with the directory, identity and hosting teams | [Rollout questions](scim-rollout-questions.md) |
