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
| The identity provider team | A client for Clew that is never replaced, the claim that carries the account name, a sign-out that reaches Clew, and accounts that are disabled, not deleted, when a person leaves | [The identity provider team](#the-identity-provider-team-sign-in) |
| The hosting team | A public address over HTTPS, a proxy that lets a request through, PostgreSQL and the master key, a place for the token, the first token, a test installation, and an operator for Clew's scripts | [The hosting team](#the-hosting-team-address-token-and-environments) |
| Clew's administrator | The provisioner's token, replaced or taken back on Administration › Användare, and the check's token, taken back after each check | [The hosting team](#the-hosting-team-address-token-and-environments) |

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
| Does every person have an id that is stable and never given to somebody else? | A provisioner filters by this source ID (`externalId`) to recover Clew’s resource ID for later writes. An id that changes makes a new person, and one who has signed in is refused at the next sign-in. When the source can map the old id to the new, re-key the existing row with a `PATCH` of `externalId` before the push, and nobody is refused. Once a new row holds the new id, Clew refuses that `PATCH` with 409, and Clew's operator moves the sign-in ([Moving a sign-in](#moving-a-sign-in-to-another-account)). An id that is reused hands one person's history to another. | "The employee number, `e-1001`. It follows the person for life and is never issued again." |
| Can the units be delivered as a list of their own, each with an id, a name and the id of the unit above it? | Clew holds the organisation as a tree and never works it out from the people. A tree that exists only as a path on each person has to be turned into units in the provisioner. | "Yes: the table of units above." |
| Do unit ids survive a reorganisation? | Everything in Clew that names a unit follows the id. A unit that moves keeps its id and changes only the unit above it; a unit that gets a new id is a new unit to Clew. | "Yes. `111` stays `111` when Centralskolan moves to another administration." |
| What does the source's manager flag refer to, and where is a manager placed: on the unit they lead, or on the one above? | A manager must be sent as manager of the unit they lead. Who a person reports to is read from that and from the tree. | "Each unit names its manager. Anna is placed on `110` and leads `110`." |
| Which people does the source send, and which statuses in the source make a person inactive? Think of parental leave, leave of absence, hourly substitutes between assignments and consultants kept in another register. | Clew knows only who is sent and whether they are `active`, and `active: false` ends a person's access at once. A person on leave who may still sign in stays active on their unit. A substitute between assignments stays active on the unit that employs them, such as a staffing unit, if they may sign in between bookings, which spares a deactivation and a return for every booking; otherwise the provisioner sends `active: false` when an assignment ends and brings them back as a returner at the next one. Do not leave an active person on no unit: they are refused at every sign-in, and the check warns of each of them. Consultants kept in another register are best merged into the export the provisioner reads, with source ids that can never equal an employee's. A provisioner of their own, with its own id, prefix and keys, fits only consultants on units it writes itself, since a provisioner owns the whole membership of every group it writes. | "Everybody with an employment in the HR system, hourly substitutes included, who stay on the staffing unit between bookings. Parental leave and leave of absence stay active; only an ended employment becomes `active: false`. Consultants are added to the same export from the purchasing register." |
| Does a person ever have a second placement, work for a period at a unit other than the one that holds their job, or act as manager for a period? | The source owns the validity period. The provisioner adds and removes memberships on the effective dates. An employment start date is displayed on the profile and does not schedule a membership. A `unit:` membership is a placement ([D99](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)): it makes the person a direct report of its manager in Personal and in that manager's round of development talks, and opens the unit's page to them. The person still acts from one unit only: one they lead before one they work in, then the unit id that comes first ([Not decided yet](#not-decided-yet)). A second placement can therefore move the unit they act from, which their page shows under "Tillhör". Send work away from the home unit as a membership only if the person is to act there. The person then has two managers: there is still one talk per person in a round, and a talk either manager books through Clew counts as booked for both ([D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)). A work placement as [D114](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md#employment-and-work-placement-in-a-municipality) describes it is not sent today and gives no access and no reporting line. | "Yes, with a start and an end date. The provisioner adds the membership on the first day and removes it on the last. A care worker booked at another home-care unit for the autumn is not placed there: they act from their own unit." |
| For the first municipal mapping: how does the source tell two jobs on one unit apart, what dates or bookings establish a work placement, and which source names the manager responsible for each employee? | These three facts decide how a work placement can be sent later ([the note behind D114](../reviews/2026-11-12-municipal-employment-and-work-placements.md)). Today an employment carries no id of its own, a work placement is not sent, and who a person reports to is read from the `unit:` and `unit-manager:` memberships and the tree, never from a field that names each employee's manager. | "Each employment has an employment number. The staffing system's bookings carry a unit and dates. The HR system names the manager of each employee's unit." |
| Can the source tell the provisioner that something changed (an event, a change log, a question for what changed since a time)? | A change is sent to Clew when it happens. A source that can only be read as a whole gives a provisioner that has to compare often to come close. | "Yes: a change log that can be read from a given time." |
| Is an account name ever given to a new person? | A person who leaves is deactivated and keeps the account name, which is unique in the installation, until Clew's operator erases them, which frees the name and the source id. To give the name to someone new before that, the provisioner moves it off the old row first; the example renames the old row to its own source id. The identity provider gives the name to the new account only after that ([the order](#the-claim-and-the-user-name)). Clew keeps its own records about a person by the person's id, so a reused name reaches nothing Clew holds about the leaver ([D116](../decisions/D116-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)), and nobody has to be erased before their name is given to someone else: when a leaver is erased is the organisation's decision on retention. A connected system that keeps its records under the account name answers for whoever holds the name now: ask the owner of each such system what a reuse does there. | "No." Or: "Yes, after two years; the provisioner renames the old row first." |
| Which phone numbers and employment details does the source publish to colleagues? | Both lists are optional. Clew shows the supplied details to signed-in colleagues. Each employment references a unit by its source id. Send its `employmentPercentage` as a JSON number from 0 to 100 without quotes or a percent sign. | "We send work numbers and mobiles. For a half-time job we send `50`. In Clew, `0.5` means 0.5 %. We omit the field when the percentage is unknown." |
| Does the identity provider ever delete a leaver's account, and when? | Clew knows an account by its subject from the first sign-in. A deleted account that is made again for a returner has a new subject, and the person is refused until Clew's operator moves the sign-in. So a leaver's account is disabled, never deleted, for as long as the person may come back, and deleted only under the organisation's retention decision ([D117](../decisions/D117-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)). | "Disabled on the last day of employment. Deleted only when the organisation's retention rules say so, and never to be made again for a returner." |
| Which claim in the identity provider's ID token carries the account name? | A first sign-in is matched on it, against the `userName` the provisioner sent. The two must be the same value for the same person. | "`preferred_username`, which holds `anna.berg`." |

## The directory team: a provisioner

The directory team owns the provisioner: the part that reads the source, the mapping from its fields to what Clew takes, and the daily comparison.

A provisioner is told what it owns, so that it never withdraws what somebody else sent. The [example provisioner](../../scripts/provisioner) takes this as its `SourceScope`:

- **A prefix that every person's source id begins with** (`userPrefix`). The example on this page uses `e-`, as in `e-1001`. Choose it once: it becomes part of each person's permanent id in Clew (`externalId`), and a source with bare employee numbers has to put one in front. The example refuses a person outside its prefix.
- **The group keys it writes**, as prefixes (`unit:`, `unit-manager:`, `ad:`) or exact keys (`capability:admin.users`).

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
| Other directory groups | Plain groups. They mean nothing until an administrator maps one or uses it as the audience of a connected system. | `ad:larare` | No |
| Each person's current employments, each with its unit and optional title, employment type, start date and percentage of full-time hours | One entry per employment in the user's [employment extension](writing-a-provisioner.md#current-employments) | `{"unitId":"111","title":"Rektor"}` for Omar | Optional. Each employment's supplied details appear on the profile. The user list shows the titles. Send the unit first and manage access through group membership. |
| One title per person, where the source has no employments | The user's `title`, in the source's own words | `Rektor` | No. It is shown where no employment carries a title, and decides nothing: who is a manager comes from the manager group. |
| Phone numbers published to colleagues | The user's [`phoneNumbers`](writing-a-provisioner.md#phone-numbers), each with a `type` and a `value` | `{"type":"work","value":"070-174 06 02"}` | No. Every number sent is shown on the profile to everybody in the organisation, whatever its type: what is published is decided in the source. A person without a number is sent without one. |

Clew’s organisational model uses the SCIM Group resource and its own unit extension. Enterprise User attributes such as `department`, `division`, `organization` and `manager` can be accepted without creating a placement or reporting line. Convert the source tree into unit groups, and nested directory groups into explicit person memberships. An installation supports one organisation with one or more root units. The token selects the organisation. To sign in, a person must be active (`active: true`) and have an employee or manager assignment: a `unit:` or a `unit-manager:` membership. The first administrator also needs `admin.users`. Clew publishes one e-mail address. It first leaves out every entry whose address is absent, `null`, empty or only space. Of the rest it takes an address of type `work`: the one marked primary, or else the first. Otherwise it takes an address without a type, chosen the same way. Otherwise, in a request that sends the whole list (`POST`, `PUT`, or a `replace` of `emails`), it takes an address of any other type, chosen the same way, so a home address is published when the work entry is blank. An `add` that brings only addresses of another type leaves the published address as it was. Clew answers the address it holds as `type: "work"` and `primary: true`. Send contact details intended for colleagues.

A group's members are named by the id Clew gave the person when it was created, not by the source's id. The provisioner looks it up by the source id (`GET /Users?filter=externalId eq "e-1001"`) and keeps it.

Use the reserved prefix in lower case, followed immediately by the source ID in its original case. Do not send whether a person is protected. Clew has not decided whether it may hold that fact, and refuses the key `protected`.

### Try it by hand first

Run these Bash blocks in order, in one shell, from the root of a checkout of the repository with Bun, Python 3 and curl (7.76 or newer).

- **Start a shell of its own first**, with `bash`. The first block sets it to stop at the first error, which closes the shell: in your login shell that would close the terminal.
- **Use an empty test installation.** The walkthrough can be run once in an installation. SCIM deactivates a person and never erases one, and an account name and a source id stay taken in the whole installation, so a second run answers 409. To run it again, ask the hosting team for a new test installation, or change the ids and account names.
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
  ok   7 groups: 4 unit, 2 unit-manager, 1 capability, 0 plain (0 without an externalId).
  ok   Every active user is in a unit.
  ok   3 of 3 active users have a title.
  ok   Phone numbers on 3 of 3 active users, employments on 3.
  ok   The units form a tree: 1 root, 3 levels deep.
  warn 1 unit or unit-manager group has no members: unit:112.

No failures, 1 warning(s).
```

The library is deliberately empty. In Personal, the page in Clew where a manager sees their staff, Anna sees Omar and Omar sees Lena. A level without an active manager passes the reporting line upward. Managers on the same unit share its staff. An acting manager joins the incumbent unless the source also removes the incumbent's membership. Verify the three parent links and those staff lists against the source. The checker can count a tree whose people report to the wrong managers.

### What it sends when something changes

Send a change when it happens. Updating a person’s name takes one request. Creating and placing someone takes two. Moving them between two units takes two, and a third on the user when the source sends employments. A change to several duties can require more. Each committed request takes effect on the next access check. Every kind of change is in [Writing a provisioner](writing-a-provisioner.md#what-a-provisioner-does-when-something-changes).

| In the source | Request |
|---|---|
| A person begins | `POST /Users`, then `PATCH` `add` on the group of their unit |
| A person who left comes back | Find them by their source id (`GET /Users?filter=externalId eq "e-1002"`): their row, account name and source id are still theirs, so never `POST` them. `PATCH` `add` on the group of their unit, take away duties that ended while they were away, then one `PUT` with the whole profile and `active: true`. Only a person an operator has erased is not found; they come back as a new person. |
| A name, an account name or an address changes | `PATCH /Users/<id>`. Clew keeps its own records about a person by the person's id, so a new account name moves nothing in Clew ([D116](../decisions/D116-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)). A connected system that keeps its records under the account name answers for whoever holds the name now. |
| A core title or a phone number changes | `PATCH /Users/<id>` with `replace` on `title` or on the complete `phoneNumbers` list |
| An employment begins, ends, or changes unit, title, employment type, start date or percentage | Send the person's complete current employment list in a `PATCH` on the user as soon as any published detail changes. The [worked example](writing-a-provisioner.md#updating-employment-details) shows the request and how to withdraw one value or one job. |
| A person leaves | `PATCH /Users/<id>` that sets `active` to `false` |
| A person moves to another unit | `PATCH` `add` on the unit they join, then `PATCH` `remove` on the unit they leave. Their employment, when it is sent, with a `PATCH` on the user. |
| A person becomes a manager, or stops being one | `PATCH` `add` or `remove` on `unit-manager:<id>`. When a lookup by key (`GET /Groups?filter=externalId eq "unit-manager:<id>"`) finds no such group, `POST` it with its key, a name and the person; `DELETE` it when its last member leaves. |
| A person gains or loses a capability | `PATCH` `add` or `remove` on the capability's group, `capability:<name>`. When a lookup by key finds no such group, `POST` it with its key, a name and the person; `DELETE` it when its last member leaves. |
| A person joins or leaves any other directory group | `PATCH` `add` or `remove` on the group's members. An administrator may have mapped the group to a capability, or named it as the audience of a connected system, and the source cannot see that: send the change when it happens, like any other. |
| A directory group is added or removed | `POST /Groups` with its key, a name and its members, or `DELETE` it |
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

Removing a person's last placement before adding the new one leaves a gap. A request that needs sign-in during that gap ends their session. A deactivated person retains their identity binding and existing memberships until the writer removes them or an operator erases the person. Take a leaver out of their `unit-manager:`, `capability:` and plain directory groups too: making them active again gives back at once every duty they still hold. On return, reconcile current duties before enabling access. If several sources own groups, confirm that every writer has withdrawn its expired duties. Use `active=false` for a leaver. Clew also treats user `DELETE` as deactivation and keeps the row searchable, which differs from the 404 and search omission required after deletion by [RFC 7644 §3.6](https://www.rfc-editor.org/rfc/rfc7644.html#section-3.6). A full user `PUT` without `active` enables the person.

A deactivation is never refused for what stands beside it ([D113](../decisions/D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)): a request that says `active: false` deactivates the person even when the same request gets another attribute wrong, such as an address the source has already emptied. That attribute is left as it was. What is wrong with the request itself is still refused, and the person then stays active: a body that is not a resource, a malformed `PATCH` (no operations or more than 500, an operation without a known `op`, a path that is not text, a `remove` without a path), a path to an attribute a client cannot write (`id`, `schemas`, `meta` or a user's `groups`), an `id` that names another resource, and an account name or a source id that another person holds, a person who has left included, which answers 409 `uniqueness`. So send a deactivation as a request of its own: a `PATCH` that does `replace` on `active` with `false` and nothing else, as the walkthrough and the example do.

### A person pushed by mistake

SCIM cannot erase anybody. A person who was sent and should not have been, such as a whole register of pupils, is first stopped where they came from: correct the source or the mapping, so that the provisioner no longer sends them. The provisioner then deactivates them and removes their memberships. The example stops such a run before it writes anything when it would deactivate all of the active people it has sent, or more than one of them and more than one fifth (step 2 of [the comparison](#what-the-daily-comparison-does)). Once somebody has checked that the source is right, run it once with `force: true`. Deactivation ends their access and takes them off colleagues' pages and every manager's Personal, but it erases nothing. Until an operator erases them, Clew keeps:

- over SCIM, everything that was sent: `GET /Users/<id>` returns the name, the account name, the source id, the e-mail address, the phone numbers, the employments, the title and any groups the person is still in;
- on Administration › Användare, the person listed as "Avstängd", with the name, the title, the account name and any units they are still on;
- in the audit table, the `scim.user.*` rows with the account name and the source id they were written with, and in `auth_audit`, the person's sign-ins;
- the person's sign-in binding, if they ever signed in;
- the cards, development talks and competence about them, if any were made while they were active.

How long a deactivated person's record is kept is the organisation's decision, under its own archive and data-protection rules, not Clew's ([D117](../decisions/D117-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)). Clew keeps the record unchanged until an operator erases it. When the organisation decides that a record goes, Clew's operator follows [Erasing one person](../maintainers/reliability-operations.md#erasing-one-person) in the operations runbook, inside Clew's app container, in this order:

1. `bun scripts/subject-erase.ts person <person id> --confirm` takes the person off every card in every stream.
2. `bun scripts/talks-erase.ts --person <person id> --confirm` erases their development talks.
3. `bun scripts/competence-erase.ts --person <person id> --confirm` erases their competence.
4. Last, `bun scripts/person-erase.ts --person <person id> --confirm` erases the record itself. It refuses an id Clew does not hold and a person who is still active, and writes nothing for either. In one transaction it removes the person's memberships, placements, grant, sign-in bindings and sessions; clears the name, the address, the phone numbers, the employments and the title; and keeps no account name and no source id. In `audit` and `auth_audit` it replaces the account names, the source ids, the sign-in subjects and the claim values that name the person with `[erased]` and keeps the events, and it writes one `person.erased` row in the audit table, with counts only. The person's row keeps its id, which other records point at, its organisation, its deactivation and its time of creation, and nothing personal. Afterwards `GET /Users/<id>` answers the id as the account name, an empty name, no address and `active: false`, Administration › Användare shows the id where the account name stood, and a filter on the account name or the source id the person held no longer finds them. A card whose one button is a write someone started from the person's menu in Clew can no longer be decided, and such a write approved before the erasure is not sent. A card whose actions a source system wrote, whether the source pushed it or someone started it from the person's menu, keeps them: they can still be decided after the erasure and are sent as the source wrote them.

The person id is Clew's own, and a person who has left has no page in Clew to read it from. The provisioner holds it, since it addresses the person as `/Users/<id>` in every write, and `GET /Users?filter=externalId eq "<source id>"` or `GET /Users?filter=userName eq "<account name>"` answers a deactivated person too, with the `id` and `active: false`. Clew's operator can also read it in the database ([Erasing one person](../maintainers/reliability-operations.md#erasing-one-person), step 1). Erase only after the source has stopped sending the person. Otherwise the next comparison sends them again, and since the erased row no longer holds the source id or the account name, they come back as a new person with a new id. A client that still writes to the old id fills the erased row again: a `PUT /Users/<id>` gives it an account name and fields, and a `PATCH` with `active: true` makes it active without one.

Where the organisation keeps the record but wants less in it, one request clears what SCIM can clear. Once the person's memberships are removed, send a `PUT` with `active: false` that leaves out `title`, `phoneNumbers` and the employments. Only the name, the account name, the address and the source id stay, since Clew requires them.

### What the daily comparison does

The order matters; the reasons are in [Writing a provisioner](writing-a-provisioner.md#what-a-provisioner-does-on-every-reconciliation).

1. Validate the source's final pages or export manifest for people, units, directory groups and memberships. Set `complete` only when every part succeeds. An incomplete snapshot stops even with `force`.
2. Check the people rows whole, before anything is written. The writer's user prefix and each of its group prefixes must not be empty. Every row needs an explicit active state, every person id is inside the user prefix and on one row, and every active person's account name is on one row, compared without regard to case or Unicode form. A person with two employments belongs on one row with both placements. The example also stops if all of its active people would be disabled, or more than one of them and more than one fifth. A single person is let through when they are not the only one, so the school of three can lose Omar. Every stop in this step says "Nothing was written."
3. Disable who has left: the people absent from the source in the provisioner's own prefix, and those the source now marks inactive. Nothing about the organisation is read from the export before this, so nothing the export has wrong about a unit or a group keeps a leaver active.
4. Check the organisation whole: every unit id and group id on one row, every unit and plain group inside the writer's keys, and plain directory groups with a key of their own such as `ad:newsletter`, since Clew reserves the `unit:`, `unit-manager:` and `capability:` prefixes and the key `protected`. The example applies the guard of step 2 to its units, to its manager and capability groups together and to its plain directory groups, each counted separately. A stop here says that the people who have left were deactivated and nothing else was written, or "Nothing was written." when nobody had left. A human who has verified a large change approves it by passing `force: true` to the example's `push()`; wire that to a flag of your own.
5. Send units from roots to leaves. A unit the source has wrong (its parent is not listed, it stands in a cycle, an active person names it and the source does not list it, or the unit above it was not written) is recorded and skipped with what depends on it, and the rest is sent. Somebody the source places only on units that were not written stays on the units Clew holds them on; a newcomer in that place is not created, and a returner stays inactive. Move an account name that is being given to somebody new off its old row. When two people who held one account name in turn have both left, the first keeps the name Clew holds it under, and nothing is refused. Keep the existing SCIM id of each returning person for step 6. Send the other people with an explicit active state, including inactive people retained by HR whom Clew already holds. An inactive person Clew has never held is not created. A person Clew refuses is recorded and everybody else is sent; the run fails at the end with the people and the units and groups it could not write.
6. Add memberships across all groups before removing old ones. Delete obsolete owned groups from leaves to roots; a `DELETE` answered 404 is done. Last, send one full active profile for each returning person. A refusal leaves the person inactive and is included in the run report.
7. Use one ordered writer for a snapshot and its change stream. Capture the change cursor with the snapshot, apply the snapshot, then replay subsequent events in source order. Persist the cursor only after success. On restart, recover by stable ID and resume from the last confirmed cursor. If the source cannot supply a consistent snapshot cursor, serialize comparison and replay and read current source state for each queued change.

On an unchanged export the example still sends a `PUT` for each present person. Identity, membership and grant state stay the same.

### What Clew answers when something is wrong

Every refusal is the standard's error resource, with the reason in `detail`. Nothing is stored when a request is refused. A field that is merely empty is not a mistake: a person without a phone number or a title is stored without one. These are the answers to the mistakes a first provisioner makes:

| The request | Status | `detail` |
|---|---|---|
| No token, or a token that is mistyped, taken back or replaced and past its time | 401 | `A bearer token issued to a provisioner is required.` |
| A group key in the wrong case, `Unit:120`, or with space in or before it | 400 `invalidValue` | `The key 'Unit:120' must begin with 'unit:' in lower case (D96). The group was not stored.` |
| A unit whose parent has not been sent yet | 400 `invalidValue` | `The parent 'unit:120' is not a unit of this organisation; a tree is pushed from the root down (D99). The group was not stored.` |
| A capability Clew does not have | 400 `invalidValue` | `The key 'capability:admin.everything' names no capability of this installation; the capabilities are …`, followed by the list |
| The key `protected` | 400 `invalidValue` | `The key 'protected' is not accepted: Clew has not decided whether it may hold that fact (D93). The group was not stored.` |
| A person without an address | 400 `invalidValue` | `Attribute 'emails' is required.` |
| A required attribute that is empty, only space, longer than 512 characters or not text | 400 `invalidValue` | `Attribute 'displayName' needs a non-empty string of at most 512 characters.` A missing one answers `Attribute '<name>' is required.`, and so do three empty ones: an empty `displayName` in a `POST` or `PUT` of a user, an empty `externalId` in a `POST` (a `PUT` keeps the stored one), and an address list whose addresses are all empty. |
| An account name with space at either end, or a control character in it | 400 `invalidValue` | `Attribute 'userName' cannot begin or end with space or hold a control character.` |
| A person whose account name somebody already has, in any case or Unicode form (`Åsa` and `åsa` are one name), also a person who has left | 409 `uniqueness` | `A user with this userName already exists.` |
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
- **Recover by outcome.** A 400 or a 409 about one person is that person's alone: record it, send everybody else, correct the mapping or the source, and fail the run so that somebody looks. The example does the same for a unit or a group the source has wrong, and lists those apart from the people. A run the example stops before any write says "Nothing was written."; one it stops at the organisation says that the people who have left were deactivated and nothing else was written, or "Nothing was written." when nobody had left. Correct the export and run again. Check the token on 401. After a POST timeout or uniqueness conflict, look up `externalId` and compare the resource before retrying. Respect `Retry-After` on 503. The client exposes the header as `ScimClientError.retryAfter`. After a 503 with a valid wait of up to 60 seconds, the example waits and starts one fresh comparison. A longer delay or another failure is returned to the scheduler. Retry transient failures with bounded backoff and keep the event pending until confirmed.
- **Expect another writer at the same time.** Clew answers a list a page at a time, ordered by id, and reads each page on its own, so a row another writer adds or removes between two pages shifts the rows after it. Drop a row you have already seen, find a unit by its key before you `POST` it, answer a 409 on a `POST` by finding the row by `externalId` and writing to it, and take a 404 on a `DELETE` as done. The example does all four; a row that slipped past one run and has left the source is removed by the next.
- **Alarm on a change that could not be sent, and on a comparison that failed or did not start.** Clew shows when each provisioner last called, with a warning after two days of silence, on Administration › Användare. A failed run can advance that timestamp. Monitor the last successful complete comparison and the age of the oldest unapplied change in the provisioner.
- **Keep the token in a secret store.** It is a bearer token for this purpose alone. It is shown once when it is issued and never stops answering by itself.
- **One organisation per installation** is what is supported today.

### Done when

- The check counts the roots the source has and names nothing you cannot explain: no active person without a unit, no managed unit without its unit group, and no unit whose people report to nobody unless the source says so. It counts the members of a group by those who are active, and says "no active members" for a unit or manager group that only people who have left are still in. It warns of a person who has left and is still in a `unit-manager:` or `capability:` group, or in a plain group: making them active again gives that back at once, so a provisioner that only deactivates should take leavers out of those groups too. It counts two kinds of group apart from the others, and warns of each. A key written wrong (a reserved word in another case or with space in it, a unit key without an id, or `protected`) gives nobody anything. A `capability:` key whose name the check's copy of the capability list does not know gives nobody anything either, unless the installation is newer than that copy ([What Clew gives back](#what-clew-gives-back)). It also says how many active people have a title, a phone number and an employment; compare those with the source, since what Clew cannot read of them is left out without a refusal. Run it with the check's own token, and take that token back afterwards ([The hosting team](#the-hosting-team-address-token-and-environments)).

  ```bash
  bun scripts/provisioner-check.ts "$CLEW" --roots 1
  ```

- For a test person with two concurrent employments, read `GET /scim/v2/Users/{id}` and compare both entries to the source, including unit, title, employment type, start date and numeric percentage. Change one percentage and verify the other entry still matches. Compare the selected e-mail by `value`. Clew returns that address with `type: "work"` and `primary: true`, even if the source used another type. Compare every phone number with its category as Clew stores them ([Phone numbers](writing-a-provisioner.md#phone-numbers)). The six standard categories (`work`, `mobile`, `home`, `fax`, `pager`, `other`) come back in lower case. Any other category comes back as written, less the space around it, with each run of control or invalid Unicode characters turned into one space and cut at 64 characters. A number without a readable category comes back as `other`. A number loses the space around it and has each such run turned into one space in the same way; one longer than 512 characters is left out, and one sent twice with the same category comes back once. The check counts people with an employment even when a malformed percentage was omitted. [Worked two-job example](writing-a-provisioner.md#updating-employment-details)
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
| Back-channel logout, for a provider that has it, such as Keycloak | `<Clew's public address>/api/auth/backchannel-logout` (OpenID Connect Back-Channel Logout, RS256) |
| Front-channel logout, for Microsoft Entra ID, which has no back-channel logout | `<Clew's public address>/api/auth/frontchannel-logout`, entered as the app registration's front-channel logout URL. Add the optional claim `sid` to the ID token: without it, Clew's sessions carry no `sid`, and a sign-out at Entra cannot name them. |
| Issuer | Over HTTPS, with its discovery document reachable from Clew's server |

### The claim and the user name

The ID token carries the account name in a claim, `preferred_username` unless the installation says otherwise. Clew compares it with the `userName` the provisioner sent, without regard to case and in one Unicode form, so `Åsa`, `åsa` and an `å` written as two characters are one name on either side. It never matches on an e-mail address or a name. A first sign-in binds the account to the one active person with that `userName`; after that the binding uses the issuer and subject together (`iss` and `sub`). At every later sign-in Clew compares the claim again: when it names another person, the sign-in is refused and nothing is bound anew. A claim that names nobody, or names the person, lets them in, since the identity provider may rename an account before Clew does.

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
| `anna.berg`, from a new account with another `sub` | `anna.berg`, already bound to her first account | Refused: an account that is replaced is not bound again by itself, only by [Clew's operator](#moving-a-sign-in-to-another-account) |
| `omar.ali`, from Anna's account | `anna.berg` for Anna and `omar.ali` for Omar | Refused: the account is bound to Anna, and the claim names Omar |

With some identity providers the claim holds the whole sign-in address, `anna.berg@example.org`, and not the short account name. Either the provisioner sends that same value as `userName`, or the installation names another claim that holds the short name. Decide which with the directory team before the first person is sent. Changing `OIDC_BINDING_CLAIM` after people have signed in keeps their bindings, but the new claim is the one compared at every sign-in: a person whose value under it is another person's account name is refused. Administration shows whether a binding exists. Verify usable access with a signed-in request and check the person's active state and unit assignment. Why a sign-in was refused is in [When a sign-in is refused](#when-a-sign-in-is-refused).

**Give an account name to another person in this order.** The provisioner moves the name off the old row in Clew first, and the identity provider gives it to the new account only once the provisioner has confirmed that. Two people who swap names go through a temporary name on both sides: one of them to the temporary name, the other to their new name, then the first from the temporary name to theirs, each step in Clew before the identity provider. In the other order, the new holder can sign in while Clew still has the name on somebody else, and be bound to that person.

For direct Entra integrations, verify the [Microsoft refresh-token scope requirement](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#the-offline_access-scope) with the IdP team.

### Keep each account's subject

Clew knows an account by its subject (`sub`) from the first sign-in on. Every account's subject must stay the same under the configured issuer for as long as the installation lives.

- **Disable a leaver's account; do not delete it.** "Close the account" on these pages means disable it. Keep it disabled for as long as the person may come back, and delete it only under the organisation's retention decision ([D117](../decisions/D117-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)). A returner then signs in with the same account once the provisioner has made them active again.
- **Never make an account again for the same person.** An account that is deleted and made again has a new subject, and Clew refuses it, since the person is bound to the old one. Disable and enable the same account instead.
- **Never replace Clew's client.** In Microsoft Entra ID the subject differs for every app registration, so a new registration gives every account a new subject and refuses everybody who has signed in before. Keep the registration for the installation's whole life: rotate its secret, never replace it. A rotated secret ends no session in Clew; Clew's requests to connected systems that act as the person wait until the hosting team has set the new secret.
- **Keep the accounts' ids in a migration.** A move that keeps the issuer but not the accounts' ids, such as a realm imported again without its user ids, gives every account a new subject too.

A new issuer is another matter. Bindings are kept per issuer, so after a change of `OIDC_ISSUER` every open session ends and everybody is bound again by the claim at their next sign-in. If a change that gives the accounts new subjects under the same issuer cannot be avoided, tell Clew's operator before anybody signs in again: each person who has signed in before is then moved one at a time ([Moving a sign-in](#moving-a-sign-in-to-another-account)).

### Signing in and signing out

A sign-in follows the identity provider's own session ([D115](../decisions/D115-a-sign-in-follows-the-identity-providers-session.md)). Clew sends no `prompt` and no `max_age` and does not require `auth_time`, so a person who is already signed in at the identity provider comes into Clew without typing anything. A session in Clew lasts at most eight hours. Where a fresh sign-in is needed, the identity provider asks for it: in Microsoft Entra ID, a Conditional Access policy for Clew's app registration with the sign-in frequency "Every time", for example on shared computers; in Keycloak, the realm's authentication flow and session settings.

"Logga ut" in Clew ends Clew's session, with a `logout` row in `auth_audit`, and sends the browser to the identity provider's sign-out page. Keycloak asks the person to confirm, and Entra asks which account to sign out; the provider's own session ends only if the person does. A person who leaves that page without doing so leaves the provider's session open, and on a shared computer the next person who chooses "Logga in" in the same browser comes into the previous person's account, unless the provider's policy asks for a sign-in.

Signing out at the identity provider ends the person's sessions in Clew: through back-channel logout with Keycloak, and through front-channel logout with Entra. Each session that ends is a `backchannel-logout` or a `frontchannel-logout` row in `auth_audit`. The front-channel address is loaded by the person's browser, in a frame of the provider's sign-out page, not by the provider's server, so the proxy must let a `GET` of it through from every browser; it needs no cookie. A front-channel request ends the sessions that carry its `sid`, and one without an `iss` is taken as the configured issuer's. One that gives another `iss`, or an empty one, ends nothing and is answered 400; one without `sid` ends nothing and is answered 200. Front-channel logout depends on the browser: one that is closed before the provider's page loads the address, or that blocks the frame, leaves Clew's session open until a renewal is refused or the session ends.

While a person works, Clew renews the identity provider's tokens with the person's requests, at least every five minutes. When the provider refuses because only a new sign-in would help (`invalid_grant`, `interaction_required`, `login_required` or `consent_required`, which a Conditional Access policy can cause), the session ends with `refresh-failed` in `auth_audit`, and the person signs in again. A renewal whose ID token names another subject ends it the same way, and so do tokens that the master key can no longer open. Any other failure keeps the session: an unreachable provider, a wrong client secret, a time-out. Clew's own pages go on working, and Clew answers a request to a connected system that acts as the person with "Tjänsten går inte att nå just nu." until a renewal succeeds. The server log then has a `warn` line with the scope `auth`, "token refresh failed; sessions are kept and delegation waits", at most once a minute in each server process.

### When a sign-in is refused

A person who is refused comes back to Clew's sign-in page with one line. "Kontot saknar behörighet till Startsidan." means that Clew refused the person, and Clew's database says why: the authentication log (`auth_audit`) and the audit table (`audit`).

| What happened | In `auth_audit` | In `audit` | What to do |
|---|---|---|---|
| A first sign-in, and the claim names one active person | `identity-bound` on `person:<id>` | `identity.bound`, with the issuer and the claim's name | Nothing: the person is bound |
| At a first sign-in, the claim names nobody, or a person who has left | `identity-unmatched`, with the actor `claim:<value>`; then `login-denied`, which names the person who has left when the claim named one | Nothing | Check that the provisioner sent the person as active, and that the claim and the `userName` hold the same value |
| The person is bound, but has left or has no `unit:` or `unit-manager:` membership | `login-denied` naming the person, at every sign-in | Nothing | Nothing for a person who has left; otherwise the provisioner places the person |
| The account has a new subject: it was deleted and made again, or Clew has a new app registration | `identity-conflict` on the person, then `login-denied` naming them | `identity.conflict` on the person, with the claim's value, the refused `subject` and no `holder` | [Move the sign-in](#moving-a-sign-in-to-another-account) |
| The subject is bound to one person, and the claim names another | `identity-conflict` on the person the claim names, then `login-denied` naming the person who holds the subject | `identity.conflict` on the person the claim names, with the claim's value, the refused `subject` and the `holder` | [Move the sign-in](#moving-a-sign-in-to-another-account), once the account names agree |
| The ID token carries no claim at a first sign-in | `login-denied` with no person | Nothing | Have the identity provider put the claim in the ID token |

"Inloggningstjänsten går inte att nå just nu." and "Inloggningen kunde inte slutföras. Försök igen." mean that the sign-in failed before Clew could decide about the person. Each sign-in that fails at its start or at the callback, a refused person included, and each refused back-channel or front-channel logout, is one line with the scope `auth` in the server log: "sign-in could not start" at the level `error`, or "sign-in failed at the callback", "back-channel logout refused" or "front-channel logout refused" at the level `warn`. A refused "Logga ut", answered "Utloggningen kunde inte bekräftas. Försök igen.", writes no line. Its field `failure` holds `name`, and where they exist `code`, `oauthError`, `status`, `message` and `cause`. The line never holds a claim, the provider's `error_description`, a token or a value a database statement was given.

| In `failure` | It means |
|---|---|
| `oauthError` `invalid_client`, `status` 401 | The client secret is wrong |
| `code` `OAUTH_JWT_CLAIM_COMPARISON_FAILED`, with a `cause` that names `aud`, `iss` or `nonce` | The client id or the issuer is wrong, or a sign-in was replayed |
| `code` `ERR_JWT_CLAIM_VALIDATION_FAILED` or `ERR_JWT_EXPIRED`, on a back-channel logout | A logout token for another client, or clocks that differ |
| `name` `TypeError`, `code` `ENOTFOUND` or `ECONNREFUSED` | Clew's server cannot reach the identity provider |
| `name` `AuthError`, `code` `denied`, `status` 403 | Clew refused the person; why is in `auth_audit` |
| `name` `AuthError`, `code` `invalid`, `status` 401 | Clew's own refusal: no sign-in under way in this browser, or one older than five minutes, an answer without a refresh token or an ID token, or a logout from another issuer |
| `name` `DrizzleQueryError` or `PostgresError` | The database failed. `code` is PostgreSQL's SQLSTATE (`57P01` or `57P03` a failover, `57014` a statement timeout, `40P01` a deadlock, `53300` too many connections) or the connection's code (`ECONNREFUSED`, `ENOTFOUND`, `CONNECTION_CLOSED`, `CONNECT_TIMEOUT`) |

### Moving a sign-in to another account

Only Clew's operator moves a binding, with a script inside Clew's app container: never on a page, and never by itself ([D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md) item 6). It is needed when the source changed the id of a person who had signed in and could not re-key the row first, when an account was deleted and made again, when Clew got a new app registration or the accounts got new ids under the same issuer, and when an account name moved between two people and one of them signed in before Clew had moved it. The refusal's `identity.conflict` row in the audit table holds what the script needs: `subject`, the refused subject, and `holder`, the person who holds it, if anybody does.

- `bun scripts/identity-rebind.ts --person <person id> --subject <new subject> --operator "<your name>"` moves the person's binding to the new subject.
- `bun scripts/identity-rebind.ts --person <person id> --release --operator "<your name>"` removes the binding. The next sign-in whose claim names the person binds them again, as a first sign-in does.

Each run that changes a binding writes one `identity.rebound` row in the audit table, about the person, with the issuer, the old and the new subject, and the operator's name; a subject is `null` where there is none, as the new one is after a release. A run that changes nothing says so and writes nothing. The script refuses a subject that another person holds, writing nothing, and prints the command that releases that person. The person's sessions under the old subject end at their next request. To undo a move, run the script again with the old subject from that row.

| What happened | What the refusal shows | What the operator does |
|---|---|---|
| The source gave a person who had signed in a new id, and the example deactivated the old row O and made a new row N with the same account name | `identity-conflict` on N, `holder` O | `--person <O> --release`; the next sign-in binds N by the claim. To bind at once, follow it with `--person <N> --subject <subject>`. Better: when the source can map the old id to the new, re-key the existing row with a `PATCH` of `externalId` before the push, and nobody is refused. |
| The account was deleted and made again, or Clew has a new app registration | `identity-conflict` on the person, with the new `subject` and no `holder` | `--person <id> --subject <subject>`, or `--release`. After a new registration, one run for each person who is refused: there is no run for everybody at once, and a release needs no subject. |
| An account name moved, and the new holder T signed in while Clew still had the name on H | `identity-conflict` on T, `holder` H | Once the names agree in the identity provider and in Clew, `--person <H> --release`; each of them then binds by the claim. If H's own subject is known from H's own refused sign-in, `--person <H> --subject <it>` frees T's subject as well. |

Never change account names to make a refusal go away. While T's subject is bound to H, a claim that names nobody, or names H, lets T in as H with H's access: only a claim that names another person is refused.

### Hand over, and keep doing

- **Hand to the hosting team:** the issuer's address, the client id, the client secret, and the name of the claim when it is not `preferred_username`. A rotated client secret goes the same way.
- **Disable the account when a person leaves, and keep it disabled.** Deactivation in Clew arrives when the provisioner sends it; the identity provider is what stops a sign-in if that change is late. Delete the account only under the organisation's retention decision, never while the person may come back.
- **Keep every account's subject.** Rotate the client's secret, never replace the client, and never make an account again for the same person. If a change that gives the accounts new subjects cannot be avoided, tell Clew's operator before anybody signs in again.
- **Give an account name to another person only after Clew has moved it off the old row.**

### Done when

- An active person with a placement opens a page that needs sign-in and retains access after the first access token expires and the session is refreshed.
- A person who is already signed in at the identity provider comes into Clew without a new prompt, unless the provider's policy asks for one.
- A person who has an account at the identity provider and has not been sent is refused.
- Signing out at the identity provider ends the session in Clew, as a `backchannel-logout` row in `auth_audit` with Keycloak and a `frontchannel-logout` row with Microsoft Entra ID.

## The hosting team: address, token and environments

| What | Value |
|---|---|
| Public address | `PUBLIC_URL`, over HTTPS, with no path. The SCIM server answers at `<public address>/scim/v2`. |
| Listening address | `HOST`. The server listens on loopback (`127.0.0.1`) unless `HOST` says otherwise; behind a proxy in another container it is `0.0.0.0`. `PORT` is 3000 unless set. |
| Reachable from | Wherever the provisioner runs. Nobody else needs `/scim/v2`; it may be closed to every other network. Every person's browser needs the rest of the address, `/api/` included: the sign-in returns there, and Entra's sign-out loads the front-channel logout address there. Keycloak's servers need `/api/auth/backchannel-logout`. |
| Database | PostgreSQL, named by `DATABASE_URL`. Run `bun run db:init` before the first start and after each upgrade: it applies Clew's migrations and the schema of the engine that runs Clew's durable work. |
| Instance and release | `CLEW_EXECUTOR_ID`: a name for each server process that it keeps across restarts and deployments, such as `clew-1`. Unset, it is the host name, which changes whenever a container is made again. `CLEW_RELEASE`: a new name for each release. The durable engine marks every piece of waiting work with the release that started it and resumes it only in a process of that release ([D85](../decisions/D85-dbos-transact-replaces-temporal-as-the-durable-engine.md)), so each deployment ends with a step, below the example. |
| Master key | `MASTER_KEY`: 32 random bytes in base64, made once with `openssl rand -base64 32`. Keep it in the secret store and back it up with the database. Never make a new one on a redeploy. At its first start Clew seals its own signing key for connected systems with this key. Under another key Clew cannot open that signing key, so it does not start at all. A new key also cannot open the secrets and sessions sealed with the old one, and changes every stored authorization value at once ([runbook](../maintainers/reliability-operations.md#changing-the-authorization-fingerprint)). |
| Request size | Let 4 MB through. Clew refuses a larger body itself. The largest request is a unit group with all its members. |
| Request time | The first write of a group with ten thousand members took about five seconds on the development stack. Do not cut a request off before that with room to spare. |
| While Clew starts | It answers 503 with `Retry-After`. A provisioner waits and tries again. `GET /api/ready` answers 200 once Clew has started and its database answers within a second, and 503 until then; `GET /api/health` answers 200 whenever the process runs. |
| Sign-in settings | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REQUEST_OFFLINE_ACCESS` when required and, when the claim is not `preferred_username`, `OIDC_BINDING_CLAIM`, from the identity provider team |

The settings for the example, as Clew's server reads them from its environment:

```bash
export PUBLIC_URL=https://clew.example.org
export HOST=0.0.0.0
export CLEW_EXECUTOR_ID=clew-1     # clew-2 for the second process, and so on
export CLEW_RELEASE=2026.11.13     # a new name for each release
: "${DATABASE_URL:?Supply the database address through the secret store}"
: "${MASTER_KEY:?Supply the master key through the secret store}"
export DATABASE_URL MASTER_KEY
export OIDC_ISSUER=https://login.example.org/realms/organisation
export OIDC_CLIENT_ID=clew
: "${OIDC_CLIENT_SECRET:?Supply the client secret through the secret store}"
export OIDC_CLIENT_SECRET
export OIDC_BINDING_CLAIM=preferred_username
```

A reverse proxy in front of Clew, here nginx, that lets a request through. Clew's server answers `/scim/v2/` and `/api/`; every other path is the web app's files, and a path that is not a file is answered with `index.html`:

```nginx
location /scim/v2/ {
    client_max_body_size 4m;
    proxy_read_timeout   60s;
    proxy_pass           http://clew-app:3000;
}
location /api/ {
    proxy_pass           http://clew-app:3000;
}
location / {
    root                 /srv/clew/web;
    try_files            $uri /index.html;
}
```

There is no recipe for running Clew in production yet: the repository's compose stack is the development one, and there is no image of the server. Today an installation is built from a checkout of the repository, with Node 26.13.0 and Bun 1.4.4 as the development container has them (`.devcontainer/Dockerfile`). Install with `bun install --frozen-lockfile`, bring the database up to date with `bun run db:init`, and start the server with `bun run --cwd apps/server start`. Build the web app with `bun run build` and serve the files in `apps/web/dist` from the same public address, as `/srv/clew/web` above. Once the processes of the older release have stopped, move the work that still waits under it, as the operations runbook says [after every deployment](../maintainers/reliability-operations.md#after-every-deployment): a reminder, an approved action, a watch or a follow-up that a process of the older release had taken does not run until it is moved, and nothing logs it. The nightly scan and the nightly clean-up need no step: a server that starts takes over their next night. Say what was missing.

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
- **A test installation first.** Give the directory team an installation to send to before the real one, and a token under an id of its own for the check, so the check has its own last-seen time. There is one kind of token, so the check's token can write as much as the provisioner's: it can create, change and deactivate people and groups in the organisation. Issue it right before the check runs, and take it back afterwards, with "Återkalla nyckeln" on Administration › Användare or `bun scripts/provisioner-token.ts revoke check`. Until it is taken back, its row there shows "Tyst i över två dygn" two days after the check last ran.

  ```bash
  bun scripts/provisioner-token.ts add check --organisation example --label "The check"
  ```

- **The nightly clean-up runs by itself.** Every night at 03:00 Stockholm time, Clew's server deletes the sessions past either of their two expiries, with their sealed tokens, and the expired records that a sign-in under way and a back-channel logout leave behind. A session that was still open when it expired gets an `expired` row in `auth_audit`. It runs inside the server on its durable engine, once a night however many server processes there are: there is no cron job and no setting of its own. Each night schedules the next, and a server that starts schedules the next night too, and takes it over when a deployment left it waiting under the release it replaced, so a deployment needs no step for it. A session cannot be used once it has expired, but its row stays until the next clean-up. The authentication log itself is never deleted: how long sign-in history is kept is the organisation's decision ([D117](../decisions/D117-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)). A night whose clean-up fails writes one `error` line with the scope `scheduler`, "sign-in clean-up failed", and the next night tries again: alarm on that line. A night that did not run at all writes no such line: by 04:00 the `audit` table has no `job.completed` row for `job:sign-in-cleanup:<date>` ([runbook](../maintainers/reliability-operations.md#sign-in)).
- **Two scripts for one person, run by Clew's operator inside the app container.** `scripts/identity-rebind.ts` moves a person's sign-in to another account ([Moving a sign-in](#moving-a-sign-in-to-another-account)). `scripts/person-erase.ts`, after the other erase scripts, erases a person who has left, when the organisation decides that their record goes ([A person pushed by mistake](#a-person-pushed-by-mistake)).
- **What to watch.** An unexpected failure of a request is one `error` line with the scope `scim` in the server log. What a request changed is in the audit table ([operations runbook](../maintainers/reliability-operations.md#provisioning)). A start that fails is an `error` line with the scope `startup`, "startup initialization failed; retrying in five seconds", every five seconds until the cause is put right: a database that does not answer, a schema that `bun run db:init` has not brought up to date, or a `MASTER_KEY` that is missing, is not 32 bytes, or is not the key Clew first started with on this database (bring that key back from the secret store). Until then every SCIM request, the first push included, answers 503 with `Retry-After: 5`, and Clew's own interface answers "Tjänsten startar. Försök igen om en stund." A sign-in that fails is a line with the scope `auth` ([When a sign-in is refused](#when-a-sign-in-is-refused)).

## What Clew gives back

- [Writing a provisioner](writing-a-provisioner.md): the attributes, the group keys, the organisation tree, the transport and every refusal.
- [scripts/provisioner/](../../scripts/provisioner): an example to start from. Its tests are in [tests/unit/provisioner.test.ts](../../tests/unit/provisioner.test.ts). The folder needs nothing of Clew's but one file that imports nothing, `packages/contracts/src/scim-group-key.ts`, at `../../packages/contracts/src/` beside it: the group keys and the names of the capabilities. Copy that file along from the release the installation runs, and copy it again on every upgrade: a capability the installation has and the copy does not is reported as one the check does not know.
- [scripts/provisioner-check.ts](../../scripts/provisioner-check.ts): reads what was sent, over SCIM alone, and changes nothing. It is run from a checkout of the repository.
- Administration › Användare: the provisioners and when each last called, the people with their titles, unit, role and capabilities, and whether each has signed in. An active person's name opens their profile, with the employments and the phone numbers as they were sent. A person who has left is listed as "Avstängd", with the name as plain text; what Clew holds for them is read with `GET /scim/v2/Users/<id>`.
- Administration › Organisation: the tree as it was sent, and what was left wrong.
- [scripts/identity-rebind.ts](../../scripts/identity-rebind.ts) and [scripts/person-erase.ts](../../scripts/person-erase.ts): the operator's scripts for [moving a sign-in](#moving-a-sign-in-to-another-account) and for [erasing a person who has left](#a-person-pushed-by-mistake).

## Not decided yet

These are open on Clew's side and change what is sent or how an installation is run. They are listed with the [open questions](../maintainers/open-questions.md).

- Whether people who are not meant to sign in should be sent at all. Sending a User creates a local person. Usable access requires the person to be active (`active: true`), a unit assignment and a matching identity at sign-in.
- Whether Clew may hold the fact that a person is protected. Until it is answered, do not send it.
- Whether a person with several placements can switch between them. Today they act as one: a unit they lead before a unit they work in, then the unit id that comes first when the ids are compared character by character, by each character's code and with no regard to language. So `10` comes before `9`, `Z-skola` before `a-skola`, `Skola` before `förskola`, and `skola-2` before `skola_2`.
- Whether one installation can hold several organisations. Today it is one.
