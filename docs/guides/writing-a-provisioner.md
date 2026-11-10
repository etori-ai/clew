# Writing a provisioner

A **provisioner** is the one thing that puts people, units and groups into a Clew installation ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md)). It is a process the installation runs, reads the organisation's own source (a directory, an HR export, a metadata catalogue) and pushes to Clew's SCIM 2.0 server at `/scim/v2`. Clew never reads the source and never learns its name; everything the source knows about fields, groups and roles is mapped inside the provisioner. A provisioner is not a connector ([D22](../decisions/D22-connectors-not-modules.md)): it calls Clew, offers no capabilities and is reached by nobody.

The repository ships one: `scripts/provisioner/`, which pushes the development stack's directory. Read it alongside this page; it is about two hundred lines.

![How people enter Clew: the source, the provisioner, the SCIM server, the stored tables, the derivation and the person's grant](../architecture/figures/provisioning-flow.svg)

## What Clew expects

**Users** (`/scim/v2/Users`, RFC 7643 core schema). Four attributes are required beyond the standard's `userName`, and Clew names the missing one in the error:

| Attribute | Meaning in Clew |
|---|---|
| `externalId` | The source's stable id for the person, never reused. Clew finds the person by it on later pushes. |
| `userName` | What a login is matched on. Unique across the installation and matched without regard to case, the standard's default for `userName`; a login carries no organisation. |
| `displayName` (or `name.formatted`) | The name shown in the product. |
| `emails` | A work address (`type: "work"`, else the primary, else the first). Clew needs it to invite the person to a meeting. |
| `active` | `false` deactivates. `DELETE` also deactivates, because audit rows and threads reference the person; nothing is erased. A `PUT` without `active` re-enables, since the source is the authority. |

Extension schemas and unknown attributes are accepted and ignored, as the standard asks, in a `PATCH` too: adding, replacing or removing an attribute Clew does not hold (`title`, a phone number, the enterprise extension's `manager`) changes nothing and is not an error. Removing one of the five above is refused with `mutability`. A path-less `PATCH` may repeat the resource's own `id`, `schemas` and `meta`, as Okta does; an `id` that names another resource is refused.

Clew holds one name per person. Send `displayName` (or `name.formatted`) when a name changes: `name.givenName` and `name.familyName` build the name when a person is created without a display name, and do not change it afterwards.

**Deactivation, not deletion.** `DELETE /Users/<id>` deactivates, and the resource stays readable with `active: false`, where the standard expects a 404 afterwards. Three consequences follow. A client that deletes and then posts the same `userName` gets 409 `uniqueness`, so find the person by filter first and `PUT` or `PATCH`, as `push.ts` does. A deactivated person keeps the `userName` until a `PATCH` changes it, so a recycled account name has to be moved off the old row before a new person can take it. And a `PUT` of a deactivated person without `active: false` re-enables them: a provisioner that pushes everyone present undoes an administrator's `DELETE` on the next run, which is D68's intent, and the audit row says `scim.user.reactivated`.

![What a pushed group means: keys in externalId give units, manager roles and capabilities; any other group may be mapped by an administrator](../architecture/figures/group-keys.svg)

**Groups** (`/scim/v2/Groups`). Every group is stored as pushed. Meaning is carried by a key in the group's `externalId`:

| `externalId` | A member gets | `displayName` |
|---|---|---|
| `unit:<unitId>` | An assignment to that unit as `employee` | The unit's name, shown in the product |
| `unit-manager:<unitId>` | An assignment to that unit as `manager`, which wins over `unit:` for the same unit | Free |
| `capability:<name>` | That capability, one of the closed list (`admin.connectors`, `admin.users`) | Free |
| `protected`, in any case | Refused with 400 `invalidValue` ([D93](../decisions/D93-the-protected-key-is-refused-at-the-scim-boundary.md)): Clew has not decided whether it may hold that fact, so do not send it | Free |
| Anything else | Nothing by itself; an administrator may map it to a capability in Clew ([D85](../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)) and use it as a connector audience | Free |

A person with no `unit:` or `unit-manager:` membership exists but can do nothing, so a mapping mistake fails closed. Several memberships give several assignments; until a person can switch, the active one is a managed unit before an employed one, then the lowest unit id.

**Keys are exact, and one written wrong is refused** ([D96](../decisions/D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md)). The prefixes are lower case with the id or name directly after the colon. `Unit:skola`, `unit:` with nothing after it, `unit: skola` and `capability:` with a name outside the list answer 400 `invalidValue` with the key and the reason in `detail`, instead of becoming a plain group that gives nobody anything.

**Units are flat, and a group's members are people.** Clew has no organisation tree: a manager of a förvaltning manages its enheter only where the provisioner puts them in each `unit-manager:<id>` group, so a source with a hierarchy flattens it in the provisioner. A group as a member of a group is refused with 400 `invalidValue`; send the people.

**Transport.** `filter` supports one equality: `userName eq "…"` or `externalId eq "…"` on users, `externalId eq "…"` or `displayName eq "…"` on groups. `startIndex` and `count` page, at most 200 rows. `attributes` and `excludedAttributes` narrow what a read answers, in the address or in a `.search` body; `excludedAttributes=members` reads a large group without its members. `PATCH` takes a path per operation (`members`, `members[value eq "<id>"]`, `active`, `userName`, …), the schema-qualified form and the path-less object form that Microsoft Entra and Okta send. Bulk, sorting and ETags are not offered; `ServiceProviderConfig` says so. Errors are the standard's error resource with `scimType` and an English `detail`. While the server starts it answers 503 with `Retry-After`.

**Requests may be sent in parallel.** Clew derives one person at a time and writes one group at a time: two requests that touch the same person or the same group queue behind each other, so the grant that results is the same whatever order they arrive in. A group need not be split either: the first write of a unit group with ten thousand members took about five seconds on the development stack, and writing it again unchanged under one.

**Authentication.** A bearer token issued to the provisioner by a Clew administrator, for this purpose alone:

```bash
docker exec -w /workspace clew-app-1 bun scripts/provisioner-token.ts add metakatalogen --organisation sundsvall --label "Metakatalogen"
```

The token is printed once; Clew keeps its digest. `rotate <id>` issues a new one and lets the old one answer for a grace period (24 hours unless `--grace-hours` says otherwise), so the provisioner is switched without a push failing; `revoke <id>` ends every token of the provisioner at once; `list` shows each provisioner with its state and when it was last seen. The token scopes users and groups to the organisation it was issued for: another organisation's resources do not exist for this client, while `userName` and `externalId` stay unique across the installation.

Clew records when a provisioner last called, and Administration › Användare shows it with a warning after two days of silence. A push that changes nothing still leaves that mark and one `provisioner.seen` audit row, so "it ran and nothing changed" and "it has stopped" look different.

## What a provisioner does on every run

1. For each person in the source: `GET /Users?filter=externalId eq "<id>"`, then `POST` when absent or `PUT` when present. The server writes nothing when nothing changed.
2. For each person Clew knows under this provisioner's `externalId` space who is no longer in the source: `PATCH` `active` to `false`.
3. For each group that follows from the source (the units, the managers of each unit, the capability holders, the plain directory groups): `GET /Groups?filter=externalId eq "<key>"`, then `POST` or `PUT` with the full member list, as SCIM ids from step 1.
4. For each group with a key this provisioner owns that no longer follows from the source: `DELETE`. Groups with other keys belong to somebody else and are left alone.

Run it at least daily: validity lives in the source (a ställföreträdare is a membership the provisioner adds when the period starts and removes when it ends), so access ends when the push arrives. A leaver's account must also be closed at the identity provider.

**Guard against an empty source.** Steps 2 and 4 remove what the source no longer has, so a provisioner that reads an empty or truncated export deactivates everyone and deletes every unit. Clew cannot tell that from a real change. Stop the run before step 2 when the source returned no people, or far fewer than the last run did, and let a person decide.

## Checking a push

```bash
CLEW_PROVISIONER_TOKEN=<token> bun scripts/provisioner-check.ts https://clew.example/scim/v2
```

The check reads what the installation holds, over SCIM alone, and changes nothing: that the endpoint and the token answer, how many users and groups of each kind there are, which active users have no unit (and so no access), which managed units no `unit:` group names, which unit groups are empty, and which stored groups carry a key written wrong. It authenticates as the provisioner, so it counts as a call from it; issue the check a token under an id of its own to leave the provisioner's last-seen time alone.

## The example

`scripts/provisioner/directory.ts` is the development stack's source: fifty people in eleven units, each with a unit and a manager flag, some working in or managing a second unit, some in plain directory groups (`ad:…`, which mean nothing in Clew until an administrator maps or names them), a few with Clew capabilities, and three of them personas with a Keycloak account. `push.ts` maps those facts to the groups above (`plan()`, pure) and pushes them (`push()`, idempotent), through `client.ts`, a forty-line SCIM client. `bun run auth:setup` runs it in-process after creating the Keycloak accounts; `bun run dev:provision` runs it over HTTP against a running `bun run dev`. `tests/unit/provisioner.test.ts` runs it against the routes on the memory store and is the shape a provisioner's own tests can take: no network, no vendor account.

To write yours, replace `directory.ts` with a reader of your source, keep `plan()`'s mapping or change the keys it emits, and point `index.ts` at your installation. Nothing in Clew changes. `check.ts` is what `scripts/provisioner-check.ts` runs.
