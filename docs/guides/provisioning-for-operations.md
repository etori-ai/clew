# Provisioning: what operations deliver

This page is for the people who run an installation of Clew: the team that runs the organisation's directory, the team that runs the identity provider and the team that hosts Clew. It says what each of them delivers before anybody can sign in, what has to be answered before anything is built, and how to tell that it works. The walkthrough loads a complete school organisation into an empty test installation and checks the resulting state. The protocol itself, every attribute and every answer, is in [Writing a provisioner](writing-a-provisioner.md).

Clew never reads an organisation's directory. People, units and groups are sent to Clew by a **provisioner**, a process the installation runs itself, using SCIM 2.0 with Clew’s unit extension and group-key conventions. A person who has not been sent cannot sign in, and a person who has been sent signs in through the organisation's own identity provider.

Three words on this page have a narrower meaning than usual. The **source** is the system that knows the people and the organisation: a directory, an HR system, a metadata catalogue. The **provisioner** is the process that reads it and sends to Clew; in Clew's own pages it is called *katalog*, under "Inläsning från katalogen" on Administration › Användare. The provisioner's **token** is what it authenticates with, a bearer token that Clew's pages call *nyckel*. A **group key** is something else: the prefix in a group's `externalId` that tells Clew what the group means, such as `unit:`.

![Two paths into Clew. Above: the source is read by the provisioner, which sends people, units and groups to Clew's SCIM server over HTTPS with a token, and the person is stored in Clew with a user name. Below: a person signs in at the identity provider, which sends an ID token with the account name to Clew's sign-in, and the sign-in finds the stored person whose user name is that account name.](../architecture/figures/provisioning-and-sign-in.svg)

*Figure 1: Two paths meet in Clew. The provisioner sends each person with a `userName`, and the identity provider sends the account name when the person signs in. Clew finds the person by comparing the two, so they must be the same value.*

The server side is built and tested with a synthetic directory of two hundred and fifty people. No provisioner has yet run against a real source, and no identity provider other than the development one has signed anybody in ([implementation status](../reference/status/identity.md)). The first installation that does both will find things this page does not say; tell the Clew team what they were.

## Who delivers what

| Team | Delivers | Section |
|---|---|---|
| The directory team | A provisioner: a process that sends each change in the source to Clew when it happens, and compares the whole source with Clew at least once a day | [The directory team](#the-directory-team-a-provisioner) |
| The identity provider team | A client for Clew, the claim that carries the account name, and accounts that are closed when a person leaves | [The identity provider team](#the-identity-provider-team-sign-in) |
| The hosting team | A public address over HTTPS, a proxy that lets a request through, a place for the token, the first token and a test installation | [The hosting team](#the-hosting-team-address-token-and-environments) |
| Clew's administrator | The provisioner's token, replaced or taken back on Administration › Användare | [What Clew gives back](#what-clew-gives-back) |

## The example on this page

A school administration with three units under the municipality and three people. Replace the ids and names with your own; everything else in the examples stays as it is.

| Unit id | Name | Unit above |
|---|---|---|
| `100` | Kommunen | none: the root |
| `110` | Utbildning | `100` |
| `111` | Centralskolan | `110` |
| `112` | Skolbiblioteket | `110` |

| Person id | Account name | Name | Works in | Leads |
|---|---|---|---|---|
| `e-1001` | `anna.berg` | Anna Berg | `110` Utbildning | `110` Utbildning |
| `e-1002` | `omar.ali` | Omar Ali | `111` Centralskolan | `111` Centralskolan |
| `e-1003` | `lena.holm` | Lena Holm | `111` Centralskolan | nobody |

Anna is also the one who administers Clew.

## Answer these before anything is built

The format fits a source that can answer yes to the first three. Each answer changes how the provisioner is written, so they come first.

| Question | Why Clew needs the answer | An answer that fits |
|---|---|---|
| Does every person have an id that is stable and never given to somebody else? | A provisioner filters by this source ID (`externalId`) to recover Clew’s resource ID for later writes. An id that changes makes a new person; an id that is reused hands one person's history to another. | "The employee number, `e-1001`. It follows the person for life and is never issued again." |
| Can the units be delivered as a list of their own, each with an id, a name and the id of the unit above it? | Clew holds the organisation as a tree and never works it out from the people. A tree that exists only as a path on each person has to be turned into units in the provisioner. | "Yes: the table of units above." |
| Do unit ids survive a reorganisation? | Everything in Clew that names a unit follows the id. A unit that moves keeps its id and changes only the unit above it; a unit that gets a new id is a new unit to Clew. | "Yes. `111` stays `111` when Centralskolan moves to another administration." |
| What does the source's manager flag refer to, and where is a manager placed: on the unit they lead, or on the one above? | A manager must be sent as manager of the unit they lead. Who a person reports to is read from that and from the tree. | "Each unit names its manager. Anna is placed on `110` and leads `110`." |
| Does a person ever have a second placement, or act as manager for a period? | The source owns the validity period. The provisioner adds and removes memberships on the effective dates. An employment start date is displayed on the profile and does not schedule a membership. | "Yes, with a start and an end date. The provisioner adds the membership on the first day and removes it on the last." |
| Can the source tell the provisioner that something changed (an event, a change log, a question for what changed since a time)? | A change is sent to Clew when it happens. A source that can only be read as a whole gives a provisioner that has to compare often to come close. | "Yes: a change log that can be read from a given time." |
| Is an account name ever given to a new person? | A person who leaves is deactivated, not erased, and keeps the account name, which is unique in the installation. The provisioner has to move it off the old row first; the example renames the old row to its own source id. | "No." Or: "Yes, after two years; the provisioner renames the old row first." |
| Which phone numbers and employment details does the source publish to colleagues? | Both lists are optional. Clew shows the supplied details to signed-in colleagues. Each employment references a unit by its source id. Send its `employmentPercentage` as a JSON number from 0 to 100 without quotes or a percent sign. | "We send work numbers and mobiles. For a half-time job we send `50`. In Clew, `0.5` means 0.5 %. We omit the field when the percentage is unknown." |
| Which claim in the identity provider's ID token carries the account name? | A first sign-in is matched on it, against the `userName` the provisioner sent. The two must be the same value for the same person. | "`preferred_username`, which holds `anna.berg`." |

## The directory team: a provisioner

The directory team owns the provisioner: the part that reads the source, the mapping from its fields to what Clew takes, and the daily comparison.

A provisioner is told what it owns, so that it never withdraws what somebody else sent. The [example provisioner](../../scripts/provisioner) takes this as its `SourceScope`:

- **A prefix that every person's source id begins with** (`userPrefix`). The example on this page uses `e-`, as in `e-1001`. Choose it once: it becomes part of each person's permanent id in Clew (`externalId`), and a source with bare employee numbers has to put one in front. The example refuses a person outside its prefix.
- **The group keys it writes**, as prefixes (`unit:`, `unit-manager:`, `position:`, `ad:`) or exact keys (`capability:admin.users`).

When two provisioners send to one organisation, give them prefixes and keys that do not overlap, capability groups included. A provisioner owns the whole membership of the groups it writes.

It does two things ([D109](../decisions/D109-a-provisioner-sends-a-change-when-it-happens-and-reconciles-the-whole-source-daily.md)). It sends each change to Clew when it happens, which is the rule. And it compares the whole source with what Clew holds at least once a day, which is the net under the rule: a change that was lost on the way is found by nothing else. The example does only the second, because its source is a file that has no events; sending a change when it happens is yours to add. This page calls the second the **comparison**; [Writing a provisioner](writing-a-provisioner.md) calls the same thing a reconciliation.

### What it reads from the source

| From the source | Becomes in Clew | In the example | Required |
|---|---|---|---|
| Each unit: id, name, id of the unit above | A group with the key `unit:<id>`, the name and its `parent`. A unit nobody is placed on, such as a heading over several departments, is sent as well. | `unit:100` Kommunen, `unit:110` Utbildning with parent `unit:100` | Yes |
| Each person: stable id, account name, name, e-mail address for colleagues, whether they are active | A user with `externalId`, `userName`, `displayName`, `emails` and `active` | `e-1001`, `anna.berg`, Anna Berg, `anna.berg@example.org`, `true` | The first four are required. `active` is read as `true` when it is left out, so send it for everybody. |
| The organisational unit each person is assigned to | Membership of the group `unit:<id>` of that unit | Lena is a member of `unit:111` | Yes: a person with no unit exists and can do nothing |
| Who leads each unit | Membership of the group `unit-manager:<id>` of that unit. Once, on the unit they lead; not on every unit below it. | Anna is a member of `unit:110` and of `unit-manager:110` | Yes, for anybody who is to see their reports |
| Who administers Clew | A group with the key `capability:<name>`, such as `capability:admin.users`. Or any directory group, which an administrator then maps to a capability in Clew. | Anna is a member of `capability:admin.users` | At least one person in that capability group. The first administrator can come from nowhere else: mapping a directory group takes an administrator. |
| Each position the source lists, with its code and name, and who holds it | A group with the key `position:<code>` and the position's name, and membership of it for each person who holds it ([D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) item 5). A person may hold several. The code is the source's own; Clew builds in no classification. A position nobody holds is sent as well. | Not in the example; the development directory sends `position:underskoterska` Undersköterska | No. A position by itself decides no access: who may do what comes from the unit and manager groups. Like any provisioned group, an administrator can map it to a capability. |
| Other directory groups | Plain groups. They mean nothing until an administrator maps one or uses it as the audience of a connected system. | `ad:larare` | No |
| Each person's current employments, each with its unit and optional title, employment type, start date and percentage of full-time hours | One entry per employment in the user's [employment extension](writing-a-provisioner.md#current-employments) | `{"unitId":"111","title":"Rektor"}` for Omar | Optional. Each employment's supplied details appear on the profile. The user list shows the titles. Send the unit first and manage access through group membership. |
| One title per person, where the source has no employments | The user's `title`, in the source's own words | `Rektor` | No. It is shown where no employment carries a title, and decides nothing: who is a manager comes from the manager group. |
| Phone numbers published to colleagues | The user's [`phoneNumbers`](writing-a-provisioner.md#phone-numbers), each with a `type` and a `value` | `{"type":"work","value":"070-174 06 02"}` | No. Every number sent is shown on the profile to everybody in the organisation, whatever its type: what is published is decided in the source. A person without a number is sent without one. |

Clew’s organisational model uses the SCIM Group resource and its own unit extension. Enterprise User attributes such as `department`, `division`, `organization` and `manager` can be accepted without creating a placement or reporting line. Convert the source tree into unit groups, and nested directory groups into explicit person memberships. An installation supports one organisation with one or more root units. The token selects the organisation. A person needs an enabled account and an employee or manager assignment to sign in. The first administrator also needs `admin.users`. Clew publishes one e-mail address. It uses the first address of type `work`. Otherwise it chooses among untyped addresses if any exist, then among all supplied addresses. In either fallback it takes the primary address if present, or the first. Send contact details intended for colleagues.

A group's members are named by the id Clew gave the person when it was created, not by the source's id. The provisioner looks it up by the source id (`GET /Users?filter=externalId eq "e-1001"`) and keeps it.

Use the reserved prefix in lower case, followed immediately by the source ID in its original case. Do not send whether a person is protected. Clew has not decided whether it may hold that fact, and refuses the key `protected`.

### Try it by hand first

Run these Bash blocks in order, in one shell, from the root of a checkout of the repository with Bun, Python 3 and curl (7.76 or newer).

- **Start a shell of its own first**, with `bash`. The first block sets it to stop at the first error, which closes the shell: in your login shell that would close the terminal.
- **Use an empty test installation.** The walkthrough can be run once in an installation. A person is deactivated and never erased, and an account name and a source id stay taken in the whole installation, so a second run answers 409. To run it again, ask the hosting team for a new test installation, or change the ids and account names.
- **Export two variables:** `CLEW`, the SCIM address ending in `/scim/v2`, and `CLEW_PROVISIONER_TOKEN`, the token, from the secret store.

The commands create the complete school example. If a create response is lost, find the resource by its source id before continuing.

**Verify the token.** The `scim` command shows HTTP errors. The `id_of` command requires exactly one result and returns the ID Clew assigned.

```bash
set -euo pipefail
: "${CLEW:?Export the SCIM base URL ending in /scim/v2}"
: "${CLEW_PROVISIONER_TOKEN:?Supply the test token through your secret store}"
export CLEW CLEW_PROVISIONER_TOKEN
scim() {
  curl --silent --show-error --fail-with-body \
    -H "Authorization: Bearer $CLEW_PROVISIONER_TOKEN" \
    -H 'Content-Type: application/scim+json' "$@"
}
id_of() {
  scim -G "$CLEW/$1" --data-urlencode "filter=externalId eq \"$2\"" |
    python3 -c 'import json,sys; [resource] = json.load(sys.stdin)["Resources"]; print(resource["id"])'
}
scim "$CLEW/ServiceProviderConfig" >/dev/null
```

**Create all four units, three people and their memberships.** A child's `parent` holds its parent's **external group key**. Membership values are **Clew user IDs**. Membership requests target a **Clew group ID**. Each person is sent with an employment, which names its unit by the **unit id** and places nobody: the membership does that.

```bash
bun - <<'TS'
import { scimClient } from './scripts/provisioner/client';
const client = scimClient(process.env.CLEW, process.env.CLEW_PROVISIONER_TOKEN);
const core = 'urn:ietf:params:scim:schemas:core:2.0:';
const unit = 'urn:clew:params:scim:schemas:extension:unit:2.0:Group';
const employment = 'urn:clew:params:scim:schemas:extension:employment:2.0:User';
const patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

async function create(path, data) {
  const { status, body } = await client.request('POST', path, data);
  if (status !== 201 || !body.id) throw new Error('Expected a created SCIM resource');
  return body.id;
}
function group(key, label, members = [], parent) {
  return create('/Groups', {
    schemas: parent ? [core + 'Group', unit] : [core + 'Group'],
    externalId: key, displayName: label, members: members.map(value => ({ value })),
    ...(parent && { [unit]: { parent } }),
  });
}
function person(externalId, userName, displayName, unitId, title, phone) {
  return create('/Users', { schemas: [core + 'User', employment], externalId, userName, displayName,
    emails: [{ type: 'work', value: userName + '@example.org' }],
    phoneNumbers: [{ type: 'work', value: phone }],
    [employment]: { employments: [{ unitId, title }] }, active: true });
}
function place(groupId, ...users) {
  return client.request('PATCH', '/Groups/' + groupId, { schemas: [patchSchema],
    Operations: [{ op: 'add', path: 'members', value: users.map(value => ({ value })) }] });
}

await group('unit:100', 'Kommunen');
const education = await group('unit:110', 'Utbildning', [], 'unit:100');
const school = await group('unit:111', 'Centralskolan', [], 'unit:110');
await group('unit:112', 'Skolbiblioteket', [], 'unit:110');
const anna = await person('e-1001', 'anna.berg', 'Anna Berg', '110', 'Skolchef', '070-174 06 01');
const omar = await person('e-1002', 'omar.ali', 'Omar Ali', '111', 'Rektor', '070-174 06 02');
const lena = await person('e-1003', 'lena.holm', 'Lena Holm', '111', 'Lärare', '070-174 06 03');
await place(education, anna);
await place(school, omar, lena);
await group('unit-manager:110', 'Chefer Utbildning', [anna]);
await group('unit-manager:111', 'Chefer Centralskolan', [omar]);
await group('capability:admin.users', 'Clew-administratörer', [anna]);
TS
```

**Check the result.** The first line of the checker names your installation. This command omits that variable line so that the output can be compared exactly.

```bash
bun scripts/provisioner-check.ts "$CLEW" --roots 1 | sed '1d'
```

```text
  ok   Without a token the endpoint answers 401 with the SCIM error resource.
  ok   The token is accepted. PATCH yes, filter yes (at most 200 rows a page), bulk no, sort no, ETags no.
  ok   3 users: 3 active, 0 deactivated.
  ok   7 groups: 4 unit, 2 unit-manager, 1 capability, 0 position, 0 plain (0 without an externalId).
  ok   Every active user is in a unit.
  ok   3 of 3 active users have a title.
  ok   Phone numbers on 3 of 3 active users, employments on 3.
  ok   The units form a tree: 1 root, 3 levels deep.
  warn 1 unit or unit-manager group has no members: unit:112.

No failures, 1 warning(s).
```

The library is deliberately empty. In Personal, the page in Clew where a manager sees their staff, Anna sees Omar and Omar sees Lena. A level without an active manager passes the reporting line upward. Managers on the same unit share its staff. An acting manager joins the incumbent unless the source also removes the incumbent's membership. Verify the three parent links and those staff lists against the source. The checker can count a tree whose people report to the wrong managers.

### What it sends when something changes

Send a change when it happens. Updating a person’s name takes one request. Creating and placing someone or moving them between two units takes two. A change to several duties can require more. Each committed request takes effect on the next access check. Every kind of change is in [Writing a provisioner](writing-a-provisioner.md#what-a-provisioner-does-when-something-changes).

| In the source | Request |
|---|---|
| A person begins | `POST /Users`, then `PATCH` `add` on the group of their unit |
| A name, an account name or an address changes | `PATCH /Users/<id>` |
| A core title or a phone number changes | `PATCH /Users/<id>` with `replace` on `title` or on the complete `phoneNumbers` list |
| An employment changes, including its percentage, or ends | Replace the person's complete current employment list. The [worked example](writing-a-provisioner.md#updating-employment-details) shows the request and how to withdraw one value or one job. |
| A person leaves | `PATCH /Users/<id>` that sets `active` to `false` |
| A person moves to another unit | `PATCH` `add` on the unit they join, then `PATCH` `remove` on the unit they leave. Their employment, when it is sent, with a `PATCH` on the user. |
| A person becomes a manager, or stops being one | `PATCH` `add` or `remove` on `unit-manager:<id>` |
| A person takes a position, or leaves one | `PATCH` `add` or `remove` on `position:<code>` |
| A position is added, renamed or removed | `POST /Groups`, `PATCH` its `displayName`, or `DELETE` it; a removed position is taken from everyone who held it |
| A unit is added, renamed or moved | `POST /Groups`, or `PATCH` its `displayName` or its `parent`. A move keeps the unit's id. |
| A unit is removed | `DELETE` both of its groups, `unit:<id>` and `unit-manager:<id>`, once its people are placed elsewhere, their employments have been sent and no unit stands below it |
| A change that takes effect on a day, such as an acting manager from the first of the month | Send the membership change on its effective date. Clew applies it when the request arrives. |

In the same Bash session, move Lena to the library, then move the library under Centralskolan. Each membership change targets the group; her employment is an attribute of her own and is sent to her. A unit move changes only the fully qualified parent path. Read the unit back to verify its parent and members. A full group `PUT` replaces its members, and a unit `PUT` without its extension makes it a root.

```bash
library=$(id_of Groups unit:112)
school=$(id_of Groups unit:111)
lena=$(id_of Users e-1003)
omar=$(id_of Users e-1002)
extension=urn:clew:params:scim:schemas:extension:unit:2.0:Group
employment=urn:clew:params:scim:schemas:extension:employment:2.0:User
patch() {
  scim -X PATCH "$CLEW/$1" --data "{\"schemas\":[\"urn:ietf:params:scim:api:messages:2.0:PatchOp\"],\"Operations\":[$2]}" >/dev/null
}
patch "Groups/$library" "{\"op\":\"add\",\"path\":\"members\",\"value\":[{\"value\":\"$lena\"}]}"
patch "Groups/$school" "{\"op\":\"remove\",\"path\":\"members[value eq \\\"$lena\\\"]\"}"
patch "Users/$lena" "{\"op\":\"replace\",\"path\":\"$employment:employments\",\"value\":[{\"unitId\":\"112\",\"title\":\"Bibliotekarie\"}]}"
patch "Groups/$library" "{\"op\":\"replace\",\"path\":\"$extension:parent\",\"value\":\"unit:111\"}"
scim "$CLEW/Groups/$library" | python3 -c '
import json, sys
group = json.load(sys.stdin)
assert group[sys.argv[1]]["parent"] == "unit:111"
assert [m["value"] for m in group["members"]] == [sys.argv[2]]
print("Library moved with Lena still assigned.")
' "$extension" "$lena"
patch "Users/$omar" '{"op":"replace","path":"active","value":false}'
scim "$CLEW/Users/$omar" | python3 -c 'import json,sys; assert json.load(sys.stdin)["active"] is False; print("Omar deactivated.")'
```

```text
Library moved with Lena still assigned.
Omar deactivated.
```

Removing a person's last placement before adding the new one leaves a gap. A protected request during that gap ends their session. A deactivated person retains their identity binding and existing memberships until the writer removes them. On return, reconcile current duties before enabling access. If several sources own groups, confirm that every writer has withdrawn its expired duties. Use `active=false` for a leaver. Clew also treats user `DELETE` as deactivation and keeps the row searchable, which differs from the 404 and search omission required after deletion by [RFC 7644 §3.6](https://www.rfc-editor.org/rfc/rfc7644.html#section-3.6). A full user `PUT` without `active` enables the person.

A deactivation is never refused for what stands beside it ([D113](../decisions/D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)): a request that says `active: false` deactivates the person even when the same request gets another attribute wrong, such as an address the source has already emptied. That attribute is left as it was.

A deactivation starts a clock for the person's competence register (Kompetens, [D108](../decisions/D108-competence-is-an-owned-domain-one-holding-typed-against-a-catalogue.md) item 14): once a retention period is set for the organisation, their competences and certificates are erased that long after the deactivation, unless they are activated again first. The period has no default and nothing is erased while it is unset; the hosting team sets it with `bun scripts/competence-retention.ts --organisation <id> --days <n>` ([operations runbook](../maintainers/reliability-operations.md#erasure-after-a-person-leaves)). A reactivation before the period runs out keeps what was registered in Clew as it was, the managers' attestations included. Rows copied from another system, such as courses from a learning platform, are the exception: they are deleted at the daily read while the person is deactivated and come back, as new rows, at the first read after the reactivation, if that system still holds them. So a leaver deactivated by mistake, or a truncated export that deactivates many people, is put right by sending `active: true` again before the period runs out.

**Deactivated does not always mean left.** Clew erases on the deactivation alone; it cannot tell a leaver from someone whose account the directory disables for a while. If the source disables accounts during long leave (parental leave, long sick leave, a leave of absence), an employee who is away for longer than the period comes back to an empty register: the certificates their manager attested in Clew are erased, and those attestations exist nowhere else. Choose the period with that in mind (longer than the longest leave during which the source keeps an account disabled), or have the provisioner keep such people active. Ask the organisation's HR how long the register should be kept after someone leaves, and write it down beside the other answers.

### What the daily comparison does

The order matters; the reasons are in [Writing a provisioner](writing-a-provisioner.md#what-a-provisioner-does-on-every-reconciliation).

1. Validate the source's final pages or export manifest for people, units, directory groups and memberships. Set `complete` only when every part succeeds. An incomplete snapshot stops even with `force`.
2. Check the writer's user prefix, group prefixes and exact group keys. Before writing, the example stops if all of its active people would be disabled, or more than one of them and more than one fifth. It applies the same rule to its units, its positions, its plain directory groups and its manager and capability groups together, each counted separately. A single person or group is let through when it is not the only one of its kind, so the school of three can lose Omar. A human who has verified a large change approves it by passing `force: true` to the example's `push()`; wire that to a flag of your own.
3. Check that every id names one row: a person id, a unit id, a group id, and an account name among the active people. A person with two employments belongs on one row with both placements. Give plain directory groups a distinct key such as `ad:newsletter`. Clew reserves the `unit:`, `unit-manager:`, `capability:` and `position:` prefixes and the key `protected`.
4. Disable who has left, before anything else is written: the people absent from the source in the provisioner's own prefix, and those the source now marks inactive.
5. Send units from roots to leaves. Move an account name that is being given to somebody new off its old row. Keep the existing SCIM id of each returning person for step 6. Send the other people with an explicit active state, including inactive people retained by HR whom Clew already holds. An inactive person Clew has never held is not created. A person Clew refuses is recorded and everybody else is sent; the run fails at the end with the list.
6. Add memberships across all groups before removing old ones. Delete obsolete owned groups from leaves to roots. Last, send one full active profile for each returning person. A refusal leaves the person inactive and is included in the run report.
7. Use one ordered writer for a snapshot and its change stream. Capture the change cursor with the snapshot, apply the snapshot, then replay subsequent events in source order. Persist the cursor only after success. On restart, recover by stable ID and resume from the last confirmed cursor. If the source cannot supply a consistent snapshot cursor, serialize comparison and replay and read current source state for each queued change.

On an unchanged export the example still sends a `PUT` for each present person. Identity, membership and grant state stay the same.

### What Clew answers when something is wrong

Every refusal is the standard's error resource, with the reason in `detail`. Nothing is stored when a request is refused. A field that is merely empty is not a mistake: a person without a phone number or a title is stored without one. These are the answers to the mistakes a first provisioner makes:

| The request | Status | `detail` |
|---|---|---|
| No token, or a token that is mistyped, taken back or replaced and past its time | 401 | `A bearer token issued to a provisioner is required.` |
| A group key in the wrong case, `Unit:120`, or with space in or before it | 400 `invalidValue` | `The key 'Unit:120' must begin with 'unit:' in lower case (D96). The group was not stored.` |
| A position key with nothing after the colon, or with space after it, `position: usk` | 400 `invalidValue` | `The key 'position: usk' needs a position code directly after 'position:' (D96). The group was not stored.` |
| A unit whose parent has not been sent yet | 400 `invalidValue` | `The parent 'unit:120' is not a unit of this organisation; a tree is pushed from the root down (D99). The group was not stored.` |
| A capability Clew does not have | 400 `invalidValue` | `The key 'capability:admin.everything' names no capability of this installation; the capabilities are …`, followed by the list |
| The key `protected` | 400 `invalidValue` | `The key 'protected' is not accepted: Clew has not decided whether it may hold that fact (D93). The group was not stored.` |
| A person without an address | 400 `invalidValue` | `Attribute 'emails' is required.` |
| A required attribute that is only space, longer than 512 characters or not text. An empty one answers that it is required. | 400 `invalidValue` | `Attribute 'displayName' needs a non-empty string of at most 512 characters.` |
| A person whose account name somebody already has, in any case, also a person who has left | 409 `uniqueness` | `A user with this userName already exists.` |
| A member named by the source's id and not by Clew's | 400 `invalidValue` | `Member 'e-1001' is not a user of this organisation.` |
| A group as a member of a group | 400 `invalidValue` | `Member '<id>' is a group. Nested groups are not supported: send the people as members.` |
| A path under `members` other than `members` and `members[value eq "<id>"]` | 400 `invalidPath` | `Path '…' is not supported: use 'members' with a list of values, or members[value eq "<id>"] to remove one.` |
| An employment on a unit that has not been sent, or with the id written as the group's key (`unit:111`) | 400 `invalidValue` | `An employment names 'unit:111', which is no unit of this organisation. 'unitId' is what follows 'unit:' in the externalId of the unit's group, and the unit is sent before an employment names it (D114). The user was not stored.` |
| An employment with a title and no `unitId` | 400 `invalidValue` | `An employment needs a 'unitId': the id of the unit, which is what follows 'unit:' in the externalId of its group. A title that belongs to no unit is sent as the user's 'title'.` |
| `employments` written without the extension's URN, in a body or as a path | 400 `invalidPath` | `Use 'urn:clew:params:scim:schemas:extension:employment:2.0:User:employments' for a person's employments.` |
| More than 50 phone numbers, or employments, on one person | 400 `invalidValue` | `Attribute 'phoneNumbers' carries at most 50 entries.` |
| More than 500 operations in one `PATCH` | 400 `invalidSyntax` | `A PatchOp body carries between 1 and 500 Operations.` |
| Removing a unit that still has units below it | 409 | `The unit '110' still has 2 units below it ('unit:111', 'unit:112'); move or remove them first, a tree is removed from the leaves up (D99). The group was not removed.` |
| A body over 4 MB | 413 | `The request body is too large.` |
| Any request while Clew starts | 503 with `Retry-After` | Wait for the time it names and send the request again |

### Running it

- **Changes when they happen, the comparison at least daily.** Clew holds no validity dates: access begins and ends when the change arrives, and until then the access the person had is the one that holds.
- **Recover by outcome.** A 400 or a 409 about one person is that person's alone: record it, send everybody else, correct the mapping or the source, and fail the run so that somebody looks. Check the token on 401. After a POST timeout or uniqueness conflict, look up `externalId` and compare the resource before retrying. Respect `Retry-After` on 503. The client exposes the header as `ScimClientError.retryAfter`. After a 503 with a valid wait of up to 60 seconds, the example waits and starts one fresh reconciliation. A longer delay or another failure is returned to the scheduler. Retry transient failures with bounded backoff and keep the event pending until confirmed.
- **Alarm on a change that could not be sent, and on a comparison that failed or did not start.** Clew shows when each provisioner last called, with a warning after two days of silence, on Administration › Användare. A failed run can advance that timestamp. Monitor the last successful complete comparison and the age of the oldest unapplied change in the provisioner.
- **Keep the token in a secret store.** It is a bearer token for this purpose alone. It is shown once when it is issued and never stops answering by itself.
- **One organisation per installation** is what is supported today.

### Done when

- The check counts the roots the source has and names nothing you cannot explain: no active person without a unit, no managed unit without its unit group, and no unit whose people report to nobody unless the source says so. It also says how many active people have a title, a phone number and an employment; compare those with the source, since what Clew cannot read of them is left out without a refusal.

  ```bash
  bun scripts/provisioner-check.ts "$CLEW" --roots 1
  ```

- For a test person with two concurrent employments, read `GET /scim/v2/Users/{id}` and compare both entries to the source, including unit, title, employment type, start date and numeric percentage. Change one percentage and verify the other entry still matches. Compare the selected e-mail by `value`. Clew returns that address with `type: "work"` and `primary: true`, even if the source used another type. Compare every phone number with its category, allowing for lowercase standard phone types. Custom categories keep their spelling. The check counts people with an employment even when a malformed percentage was omitted. [Worked two-job example](writing-a-provisioner.md#updating-employment-details)
- Administration › Organisation shows the tree as the source has it.
- A second comparison leaves identity fields, memberships and effective access unchanged. The checker exits zero with warnings. Investigate unexpected warnings and compare exact unit parents, placements and intended administrators with the source.
- A person who is moved in the source is moved in Clew without waiting for the comparison, and was never without a unit in between.

## The identity provider team: sign-in

Clew signs people in with OpenID Connect and creates nobody at sign-in. The identity provider vouches for the account; the provisioner has already said who the person is.

| What | Value |
|---|---|
| Client | Confidential (with a client secret), Authorization Code with PKCE (`S256`) |
| Scopes | `openid profile email`. Clew requires a refresh token. For direct Microsoft Entra v2, configure `OIDC_REQUEST_OFFLINE_ACCESS=true` in Clew to also request `offline_access`. Agree consent with the IdP team. |
| Redirect address | `<Clew's public address>/api/auth/callback` |
| Address after sign-out | `<Clew's public address>/login` |
| Back-channel logout | `<Clew's public address>/api/auth/backchannel-logout` (OpenID Connect Back-Channel Logout, RS256) |
| Issuer | Over HTTPS, with its discovery document reachable from Clew's server |

### The claim and the user name

The ID token carries the account name in a claim, `preferred_username` unless the installation says otherwise. Clew compares it with the `userName` the provisioner sent, without regard to case, and never matches on an e-mail address or a name. A first sign-in binds the account to the one person with that `userName`; after that the binding uses the issuer and subject together (`iss` and `sub`).

Anna's ID token, the part Clew reads at her first sign-in:

```json
{
  "iss": "https://login.example.org/realms/organisation",
  "sub": "7c0d1c1e-5a4b-4f0e-9d53-0b9a4c6f2a11",
  "preferred_username": "anna.berg"
}
```

| The claim holds | The provisioner sent `userName` | The sign-in |
|---|---|---|
| `anna.berg` | `anna.berg` | Anna is signed in |
| `Anna.Berg` | `anna.berg` | Anna is signed in: case does not matter |
| `anna.berg@example.org` | `anna.berg` | Refused: the two are not the same value |
| `anna.berg` | nobody has it | Refused: the person has not been sent |
| `anna.berg`, from a new account with another `sub` | `anna.berg`, already bound to her first account | Refused: an account that is replaced is not bound again by itself |

With some identity providers the claim holds the whole sign-in address, `anna.berg@example.org`, and not the short account name. Either the provisioner sends that same value as `userName`, or the installation names another claim that holds the short name. Decide which with the directory team before the first person is sent. In `auth_audit` an unknown or disabled account name can produce `identity-unmatched` with the claim value. A changed subject can produce `identity-conflict`. A missing claim can produce only `login-denied`. Administration shows whether a binding exists. Verify usable access with a signed-in request and check the person's active state and unit assignment.

**Never recreate a person's account.** An account that is deleted and made again has a new subject (`sub`), and Clew refuses it because the person is bound to the old one. Nothing in Clew undoes a binding today: there is no page and no script for it, and it takes a change in Clew's database by whoever hosts it. Disable and re-enable the same account instead. Tell the Clew team if this has happened.

For direct Entra integrations, verify the [Microsoft refresh-token scope requirement](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#the-offline_access-scope) with the IdP team.

### Hand over, and keep doing

- **Hand to the hosting team:** the issuer's address, the client id, the client secret, and the name of the claim when it is not `preferred_username`.
- **Close the account when a person leaves.** Deactivation in Clew arrives when the provisioner sends it; the identity provider is what stops a sign-in if that change is late.

### Done when

- An active person with a placement opens a protected page and retains access after the first access token expires and the session is refreshed.
- A person who has an account at the identity provider and has not been sent is refused.
- Signing out at the identity provider ends the session in Clew.

## The hosting team: address, token and environments

| What | Value |
|---|---|
| Public address | `PUBLIC_URL`, over HTTPS, with no path. The SCIM server answers at `<public address>/scim/v2`. |
| Listening address | `HOST`. The server listens on loopback (`127.0.0.1`) unless `HOST` says otherwise; behind a proxy in another container it is `0.0.0.0`. `PORT` is 3000 unless set. |
| Reachable from | Wherever the provisioner runs. Nobody else needs `/scim/v2`; it may be closed to every other network. |
| Request size | Let 4 MB through. Clew refuses a larger body itself. The largest request is a unit group with all its members. |
| Request time | The first write of a group with ten thousand members took about five seconds on the development stack. Do not cut a request off before that with room to spare. |
| While Clew starts | It answers 503 with `Retry-After`. A provisioner waits and tries again. |
| Sign-in settings | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REQUEST_OFFLINE_ACCESS` when required and, when the claim is not `preferred_username`, `OIDC_BINDING_CLAIM`, from the identity provider team |

The settings for the example, as Clew's server reads them from its environment:

```bash
export PUBLIC_URL=https://clew.example.org
export HOST=0.0.0.0
export OIDC_ISSUER=https://login.example.org/realms/organisation
export OIDC_CLIENT_ID=clew
: "${OIDC_CLIENT_SECRET:?Supply the client secret through the secret store}"
export OIDC_CLIENT_SECRET
export OIDC_BINDING_CLAIM=preferred_username
```

A reverse proxy in front of Clew, here nginx, that lets a request through:

```nginx
location /scim/v2/ {
    client_max_body_size 4m;
    proxy_read_timeout   60s;
    proxy_pass           http://clew-app:3000;
}
```

There is no recipe for running Clew in production yet: the repository's compose stack is the development one. The hosting team builds the installation from the server's image and the settings above; say what was missing.

- **The first token comes from a script.** Nobody is an administrator until a provisioner has sent the group that makes somebody one, so the first token of an installation is issued by running a script inside Clew's app container. The organisation is an id you choose once, such as `example`, and it cannot be changed afterwards: a second token issued with the id misspelt belongs to another, empty organisation. The provisioner's id is 2 to 64 lower-case letters, digits and dashes, beginning with a letter or a digit.

  ```bash
  bun scripts/provisioner-token.ts add directory --organisation example --label "The directory"
  ```

  ```text
  Provisioner 'directory' may push to /scim/v2 for organisation 'example'. Its token, shown once:
  <the token>
  ```

  Clew keeps only the token's digest. Hand the token to the directory team through the secret store, not in a message.
- **After that, on the page.** An administrator with `admin.users` adds a provisioner ("Lägg till katalog"), replaces its token ("Byt nyckel") and takes it back ("Återkalla nyckeln") on Administration › Användare. A replaced token may go on answering for a day or a week, so the provisioner is switched without a request failing.
- **A test installation first.** Give the directory team an installation to send to before the real one, and a token under an id of its own for the check, so the check has its own last-seen time. Its token has full provisioning write access for the organisation. Store it accordingly.

  ```bash
  bun scripts/provisioner-token.ts add check --organisation example --label "The check"
  ```

- **What to watch.** An unexpected failure of a request is one `error` line with the scope `scim` in the server log. What a request changed is in the audit table ([operations runbook](../maintainers/reliability-operations.md#provisioning)).

## What Clew gives back

- [Writing a provisioner](writing-a-provisioner.md): the attributes, the group keys, the organisation tree, the transport and every refusal.
- [scripts/provisioner/](../../scripts/provisioner): an example to start from, with its tests.
- [scripts/provisioner-check.ts](../../scripts/provisioner-check.ts): reads what was sent, over SCIM alone, and changes nothing. It is run from a checkout of the repository.
- Administration › Användare: the provisioners and when each last called, the people with their titles, unit, role and capabilities, and whether each has signed in. A name opens the person's profile, with the employments and the phone numbers as they were sent.
- Administration › Organisation: the tree as it was sent, and what was left wrong.

## Not decided yet

These are open on Clew's side and change what is sent or how an installation is run. They are listed with the [open questions](../maintainers/open-questions.md).

- Whether people who are not meant to sign in should be sent at all. Sending a User creates a local person. Usable access requires an active account, a unit assignment and a matching identity at sign-in.
- Whether Clew may hold the fact that a person is protected. Until it is answered, do not send it.
- Whether a person with several placements can switch between them. Today they act as one: a unit they lead before a unit they work in, then the first unit id in text order (`10` before `9`).
- Whether one installation can hold several organisations. Today it is one.
- How a person whose account at the identity provider was replaced is bound to the new one. Today nothing in Clew does it.
