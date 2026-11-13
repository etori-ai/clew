# SCIM school walkthrough

Run the commands in order on an empty test installation with a provisioner token. [Get the test address and token](scim-sign-in-and-hosting.md#the-hosting-team-address-token-and-environments).

## The school directory

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

## Try it by hand first

Run these Bash blocks in order, in one shell, from the root of a checkout of the repository with Bun, Python 3 and curl (7.76 or newer).

- **Start a shell of its own first**, with `bash`. The first block sets it to stop at the first error, which closes the shell: in your login shell that would close the terminal.
- **Use an empty test installation.** To reproduce the printed results, start each run on a fresh test installation or one the hosting team has restored to its empty state. The script creates the fixed group `capability:admin.users` and the checker counts the whole installation. A second run against the existing records encounters duplicate keys.
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

## Move an employee and deactivate a leaver

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
