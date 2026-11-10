# Review: is the SCIM server standard, and is it easy to run · 2026-11-10

Date: 2026-11-10

Reviewed revision: `8b663a6` on `staff-section`
Status: review and recommendation; the findings were built the same day, see Outcome

## Question

The product owner asked whether the SCIM handling is standard, and whether it is easy to use for operations and for
the team that runs the source directory (in Sundsvall, Metakatalogen) and will write and run the provisioner.

This follows the [review of 2026-11-09](2026-11-09-scim-server-and-provisioning-boundary.md), whose nine findings are
built. It asks a different question: not whether the server is correct, but what a client and an operator meet.

## Assessment

**For a provisioner written for Clew, yes on both counts.** The transport is an honest subset of SCIM 2.0: the content
type, the error resource, discovery that tells the truth, `ListResponse` paging, `PATCH` in the forms the known clients
send, `.search`. What a client has to know about Clew fits one page (four required user attributes, three keys in a
group's `externalId`, `DELETE` deactivates, a bearer token), and the example provisioner is about two hundred lines
with tests that need no network.

**For an off-the-shelf SCIM client, not yet.** Entra's provisioning service, Okta or a metadirectory product's stock
SCIM connector would not work unmodified. One reason is by design (meaning rides in a group's `externalId`, D68); two
are defects in `PATCH` that the probe below confirmed.

**For operations, the daily path is small but blind.** Issuing a token is one command and the runbook says what to
read when a person has no access. What is missing is everything around it: nothing shows that a push ran, a token
cannot be rotated without a gap or listed at all, and a mistyped key is accepted in silence.

## Method

Read `apps/server/src/routes/scim.ts`, `modules/people/` (contracts, domain, use cases, the Postgres adapter),
`scripts/provisioner/`, `scripts/provisioner-token.ts`, D68, D85, D93, `docs/architecture/identity.md`, the provisioner
guide and the provisioning section of the operations runbook. Ran a throwaway probe (not kept) in the devcontainer:
forty requests against the routes on the memory store, shaped as Entra, Okta and a hand-written client send them.
Nothing was written to Postgres. Finding 5 is reasoned from the code and was not reproduced.

## What is standard

- `application/scim+json`, the error resource with `scimType`, 401 with a challenge, 201 with `Location`, 501 for
  `/Bulk` and `/Me`, 404 as an error resource for unknown addresses.
- `ServiceProviderConfig`, `ResourceTypes` and `Schemas` describe what is offered, and `/Schemas` declares Clew's
  profile (`externalId` and `emails` required).
- `userName` is matched without regard to case; attribute names and `eq` in a filter likewise.
- `PATCH`: a path per operation, the schema-qualified path, the path-less object, `"True"`/`"False"` as strings,
  `emails[type eq "work"].value`, `members[value eq "…"]`, `Remove` on `members` with a value list.
- Extension schemas and unknown attributes on `POST` and `PUT` are accepted and ignored.
- An unknown `sortBy` is ignored, as the standard asks of a server that does not sort.

## Where it departs from the standard

Declared and deliberate:

| Departure | Consequence for a client |
|---|---|
| A group's `externalId` carries Clew's key (`unit:`, `unit-manager:`, `capability:`) | A client that puts its own id there (Entra sends the object id) gives nobody a unit, so nobody gets access. Needs a provisioner or an adapter. |
| `DELETE /Users/<id>` deactivates; the resource stays readable and a second `DELETE` answers 204 | A client that deletes and re-creates gets 409. Documented in the guide. |
| `externalId` and a work address are required on a user | A client that sends neither is refused with the attribute named. |
| `filter` is one `eq` on `userName`/`externalId` (users) or `externalId`/`displayName` (groups) | No `and`, `sw`, `id eq`, or `meta.lastModified gt`, so no delta read. Enough for a push. |
| No bulk, sort, ETags | Declared in `ServiceProviderConfig`. |
| Units are flat and a group's members are users only | A source with an organisation tree has to flatten it in the provisioner; a nested group is refused. Not said in the guide. |

Not declared, found by the probe:

### 1. `PATCH` `remove` is refused for attributes Clew does not hold (medium)

`applyUserPatch` refuses every `remove`, whatever the path: `title`, `phoneNumbers[type eq "mobile"].value` and
`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager` all answer 400 "cannot be removed; every attribute
Clew holds is required". Clew holds none of them. The guide says unknown attributes are accepted and ignored, and for
`add` and `replace` they are. Entra sends `Remove` when a mapped attribute is cleared in the directory, and a `PATCH`
is atomic, so a request that also replaces `displayName` fails whole and the person stays stale until someone reads
the provisioning log.

Fix: refuse `remove` only for the attributes Clew requires (`userName`, `externalId`, `displayName`, `emails`,
`active`); ignore it for the rest. A unit case per form.

### 2. A path-less `PATCH` that repeats `id` is refused (low to medium)

`{"op":"replace","value":{"id":"<id>","displayName":"…"}}` answers 400 `mutability` on users and groups. That is
Okta's group rename and its user deactivation. RFC 7644 allows the refusal; no client that sends the resource's own id
back expects it.

Fix: ignore `id`, `schemas` and `meta` in a path-less value (refuse `id` only when it differs from the address).

### 3. A path-less `name` without `formatted` is refused (low)

`POST` and `PUT` build the name from `givenName` and `familyName`; a path-less `PATCH` with
`{"name":{"givenName":"…","familyName":"…"}}` answers 400 "Attribute 'name.formatted' needs a non-empty string".

Fix: the same fallback as `userFields`, or ignore the object when it has no `formatted`.

### 4. A mistyped key is stored as a plain group (medium, operability)

`unit:` with no id, `capability:admin.nope` and `Unit:skola` all answer 201. Each then means nothing, and the people
in it get nothing: fail closed, as D68 wants, but in silence. The provisioner's log says success and the first sign is
a person who cannot do what they should. The capability list is closed, so an unknown name is always a mistake.

Fix: refuse a `unit:` or `unit-manager:` key with an empty id and a `capability:` key outside `CAPABILITIES` with 400
`invalidValue` naming the key, as D93 does for `protected`. A key in the wrong case is a legitimate plain group and
cannot be refused; the guide should say keys are case exact.

### 5. Two requests that touch the same person can leave a stale grant (medium, not reproduced)

`deriveWithin` reads the person's memberships and writes the grant without locking the person. Two transactions that
each change a membership of the same person (one removes them from `unit-manager:x`, the other adds them to a
capability group) each read before the other commits, and the last writer's grant reflects only its own view. It can
fail open: the removed manager role survives until the next derivation. The example provisioner is sequential, and a
`PUT` of the user re-derives, so a daily full push heals it. A client that sends in parallel, or one that pushes
groups only, has no such guarantee.

Fix: lock the person row (`FOR UPDATE`) at the start of `deriveWithin`; a durability or database test with two
concurrent group patches. Until then the guide should say: one request at a time.

### 6. Smaller points

- `count=abc` answers zero rows; the comment in `pageOf` promises the default.
- `attributes` and `excludedAttributes` are still ignored (open since the last review).
- A member that is not a user answers "is not a user of this organisation", also for a group id; say that nested
  groups are not supported.
- `routes/scim.ts:42` logs an unexpected failure with `console.error`, which D91 forbids in `apps/server/src`. A 500
  on a push therefore misses the structured log and its trace id.
- The 503 while the server starts is plain JSON without `Retry-After`, not the error resource.

## Operability

What is easy today:

- One command issues a token, scoped to one organisation, printed once, stored as a digest.
- A second push with nothing changed writes nothing, so the provisioner can run as often as wanted.
- Errors name the attribute. The runbook lists the audit actions and what "can sign in but reaches nothing" means.
- Administration › Användare shows who was pushed, their unit, role, groups and whether they have signed in.
- A provisioner's tests run against the routes in memory: no network, no vendor account.

What an operator lacks:

| Gap | Why it matters |
|---|---|
| Nothing records that a push ran. An unchanged push writes no audit row and `auth_provisioner` has no last-seen time. | D68 item 4: access ends when the push arrives. A provisioner that stopped a week ago looks the same as one with nothing to change, and leavers keep their units. This is the gap worth closing first. |
| Tokens: `add` refuses while one is active, so rotation is revoke-then-add (a gap) or a new id; there is no `list`; nothing expires; the runbook does not describe rotation. | Open since the last review. An operator cannot see which clients exist without SQL. |
| Tokens are managed by a script inside the app container with database access; connectors have an administration page, provisioners none. | The team that runs the source usually has no shell on Clew's host. |
| No check tool for a provisioner, where connectors have `scripts/connector-check.ts`. | A team writing one has the guide and the example's tests, but nothing to point at their own client or a staging installation. |
| The guide does not warn about an empty source. | A provisioner that reads an empty export deactivates everyone. A threshold belongs in the provisioner; the guide should ask for one. |
| Load is unmeasured. A first `PUT` of a group runs one read per member and a derivation per member (about eight queries each) in one transaction. | Fine for a unit; a group of several thousand members may outlast a proxy timeout. Measure before a real directory. |
| Nothing has run against a real source or a real identity provider. | Already in the status matrix; it bounds every claim above. |

## Recommended order

1. A last-seen time per provisioner, shown on Administration › Användare and as a metric, so a silent provisioner is
   visible. Then token `list` and rotation with an overlap, and the runbook text.
2. Findings 1 to 3 together: they are one function each and decide whether a stock client can be tried at all.
3. Finding 4: refuse malformed keys.
4. Finding 5: the row lock and its test.
5. The guide: flat units and no nested groups, keys are case exact, one request at a time, a threshold against an
   empty source.
6. A `provisioner-check` script and a measured push of a municipal-size directory, before the pilot.

## Verification

The probe described under Method; its forty answers are the evidence for the tables and findings 1 to 4 and 6. No code
changed, no test added.

## Outcome

The product owner asked the same day for the findings to be fixed, on branch `scim-conformance-and-operability` off
`staff-section`.

- **Finding 1.** `remove` is refused only for what Clew requires (`userName`, `externalId`, `displayName`, `active`,
  the work address), now with `scimType` `mutability` as RFC 7644 §3.5.2.2 asks; for an attribute Clew does not hold it
  changes nothing.
- **Finding 2.** A path-less value may repeat `id`, `schemas` and `meta`; an `id` that names another resource is
  refused. A path that names a read-only attribute is refused as before.
- **Finding 3.** A `name` object sets the name through `formatted` only, as the paths do; one without it changes
  nothing instead of answering 400. Given and family names are not held, and the guide says to send `displayName`.
- **Finding 4** became [D96](../decisions/D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md), and went
  further than this review proposed: a reserved prefix in another case is refused too, and so is `protected` in
  another case, which D93's exact comparison let through.
- **Finding 5** was reproduced and fixed. A derivation locks the person and a write locks the group
  (`FOR NO KEY UPDATE`; `FOR UPDATE` deadlocked against the key-share locks that membership rows hold through their
  foreign keys, which the test found). People are derived in id order. With the locks taken out,
  `tests/db/postgres-scim-concurrency.test.ts` fails as this review predicted, and it showed a second fault the
  review had not seen: two patches of one group at once lost one of the two members. A `unit:` group now writes its
  unit's label before anyone is derived, so the order no longer decides whether a manager sees the new name.
- **Finding 6.** A count that is no number takes the default; `attributes` and `excludedAttributes` are honoured on
  reads and in `.search`, and a group read without its members does not query them; a group as a member says nested
  groups are not supported; `routes/scim.ts` logs through a port that `main.ts` binds to `logPort('scim', 'error')`;
  the 503 while starting is the error resource with `Retry-After`.
- **Operability.** `auth_provisioner.last_seen_at` (migration `0042`), written at most once a minute, with a
  `provisioner.seen` audit row when a run begins after half an hour of silence; Administration › Användare shows each
  provisioner with when it last called and a warning after two days. `scripts/provisioner-token.ts` gained `list` and
  `rotate` with a grace period, during which the previous token still answers. `scripts/provisioner-check.ts` reads
  what an installation holds and changes nothing. The guide covers flat units, exact keys, parallel requests, the
  empty-source guard and the check; the runbook covers rotation and how to see that pushes arrive.
- **Load, measured** in-process on the development Postgres, rows removed afterwards: ten thousand users created in
  14 s; the first write of a unit group with all of them 5.3 s; the same group replaced unchanged 0.7 s; renamed, every
  member re-derived, 4.4 s. Not a network measurement and not a municipal database.

Not built: an administration page for tokens (the script in the app container remains the way), a metric or alarm for
a silent provisioner, a retry for a request that loses a deadlock (none is expected now that locks are taken in one
order), and a run against a real source or identity provider. The page was verified by `tests/a11y/users.spec.ts`
(axe, focus stops, reflow at 320 px), not looked at in a browser, and not read with a screen reader.

Verification: `bun run check`; `bun run test:db`; `sh scripts/a11y.sh users.spec.ts`; the token script and the check
script run against the development server, their rows removed afterwards.

