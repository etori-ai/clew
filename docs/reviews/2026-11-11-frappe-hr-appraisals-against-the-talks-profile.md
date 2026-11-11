# Comparison: Frappe HR's appraisal cycle against the talks profile · 2026-11-11

Status: comparison. Nothing was installed or called. Every statement about the product comes from its public source
on the `develop` branch (which marks itself 17.x) or its documentation site as read on this date; where neither
supported a statement it is marked "not established". No code changed. The choice of what to do with it is the
product owner's.

## The question

The talks profile ([D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md),
items 8 and 9) lets a system other than Clew's own module answer `<id>.talks` and `<id>.commitments`. So far only
`connectors/appraisals` has answered it, and that fixture was written here, against the profile. Under
[D102](../decisions/D102-a-decision-is-provisional-until-something-outside-the-repository-has-tested-it.md) that is
no outside test.

[D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)
names Frappe HR as the second source, for a manager approving a leave application. The product also has
performance appraisals. The question here: could its appraisal cycle answer the talks profile, so that one product
tests both the connector loop and the seam of the first owned domain?

## The answer

Partly. The round and the roster map cleanly. The talk itself, booked or held, has no counterpart. Action points
map onto the product's goals only by force.

## The profile against the product

The profile's shapes are `TalksOutputSchema` and `CommitmentsOutputSchema` in `packages/contracts/src/index.ts`.

### `<id>.talks`

| Profile | Frappe HR | Fit |
|---|---|---|
| `round.label`, `opensOn`, `dueOn` | Appraisal Cycle: `cycle_name` (required, unique, the document's name), `start_date`, `end_date` (both required) | Yes |
| "The open round", one or none | Cycle `status`: Not Started, In Progress, Completed. A cycle is scoped by company and optionally branch, department and designation, so several can be in progress at once | The connector must choose one; the profile has no place for two |
| One row per person, `ref` stable | One Appraisal per employee per cycle (enforced in `validate_duplicate`, not by a constraint), named `HR-APR-<year>-<number>` | Yes |
| `userName` | Appraisal `employee` links to an Employee record; the login is `Employee.user_id` | Only through a mapping, see "The key" |
| `name` | `employee_name` | Yes |
| `state: booked`, `at` an instant | Nothing. No field or document records a meeting or its time | No |
| `state: held`, `at` a day | The Appraisal has no status field, only draft or submitted. Closest: the manager's submitted Employee Performance Feedback (`reviewer`, `added_on`), or the Appraisal being submitted | A proxy the connector would have to invent |
| `openCommitments` | Goals for the employee whose `status` is Pending or In Progress | Loosely, see below |
| `link` | A document's address in the product's desk | Not established |

### `<id>.commitments`

| Profile | Frappe HR | Fit |
|---|---|---|
| `ref` stable | Goal named `HR-GOAL-<year>-<number>`; the doctype allows rename | Stable unless someone renames it |
| `text`, one short line | `goal_name`; `description` is rich text | Yes, with the name |
| `owner`: employee or manager | A goal has one `employee` and no other owner | No: a point the manager is to do has no home |
| `dueOn`, required | `end_date`, optional; taken from the cycle's end when the goal has a cycle | A goal without a cycle may have none |
| `done`, `doneAt` | `status` Completed, set when `progress` reaches 100; no instant is recorded | `done` yes, `doneAt` no |
| `carried` | `appraisal_cycle` is optional on a goal | Only for goals tied to a cycle |
| Input `person` | Filter on `employee` | Yes |

A goal is not an action point. It is an objective with a progress percentage, in a tree (a parent's progress is the
average of its children), weighted by a key result area and scored into the appraisal. It also has the states
Archived and Closed, which the profile cannot say. Listing goals under "Mina åtgärdspunkter" would present one
thing as another.

## What it shows about the profile

1. **`booked` is the calendar's knowledge, not the HR system's.** Clew's own module reads it from Clew's calendar.
   A product that holds appraisals does not know what is in anyone's calendar, and the fixture's booked instants
   were made up to fit. `bookedUnknown` exists for a calendar that did not answer; a system that can never tell is
   a different case the profile does not name.
2. **The commitment shape is the built-in module's shape.** A required due day, an owner that may be the manager
   and a line of at most 280 characters describe what Clew built. The one outside product read here has none of the
   three as given.
3. **One open round is an assumption.** The product runs a cycle per company and, optionally, per branch,
   department or designation.

None of these is a reason to change the profile now. Under
[D100](../decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md) a contract changes when a second
source needs it, and this one has only been read.

## Identity and access

### The key

The profile keys a row on the provisioned SCIM `userName`
([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) left open whether the key on
the wire is `userName` or `externalId`). In the product:

- An Employee is tied to a login through `user_id`, a link to a User; one active Employee per user.
- On sign-in through an identity provider, the login name is the lowercased `email` claim (`upn` or `unique_name`
  as fallbacks). The `preferred_username` claim is not read in that code. The provider's subject is stored
  separately and is not the login name.

So the product knows a person by email, and a connector must map email to the user name Clew sent. Whether a login
name can be anything other than an email was not established. This is evidence for the open item in D97: a real
product's key was neither of the two candidates.

### Who sees what

- No rule in the code read lets a manager see the appraisals or goals of the people who report to them and nobody
  else's. The `reports_to` tree narrows the Employee doctype only.
- The Employee role has role-level read on every Appraisal and every Goal, with no owner condition. The role is
  given to every user linked to an Employee.
- Saving an Employee with a login creates a User Permission for that Employee record by default
  (`create_user_permission`). Appraisal and Goal link to Employee without ignoring user permissions, so that
  permission restricts single documents. Whether it reaches the people who report to the user, and whether list
  calls apply it, was not established: the list query path was not read.
- The mobile API's own checks compare `reports_to` with the caller in a few methods; none of them lists appraisals
  or goals.

The earlier comparison already warned that "the approver field alone does not restrict what a caller can list". The
same holds here: whether two managers see different rows depends on permissions the seed sets, and has to be
tested, not assumed.

### How a connector calls as the person

- The product accepts bearer tokens only when they match a token its own OAuth server issued. An identity
  provider's token is not accepted without a custom authentication hook, and the HR app registers none.
- Its OAuth server offers the authorization code grant. PKCE and refresh tokens were not established in this read.
- A per-user API key and secret can be generated on the user's settings; calls act as that user.
- A first-party MCP endpoint at `/api/v2/mcp` was not established: the guide's address returned 404 and the
  developer API index lists no such page.

The last two differ from the [earlier comparison](2026-11-10-an-open-source-product-as-the-first-real-integration.md),
which recorded PKCE, refresh tokens and the MCP endpoint from documentation, and D101 item 3 rests on them. This read
was of the `develop` branch, not a version 16 tag, so it does not show that they are absent. Refresh tokens decide
whether work in the background as the person is possible, and are to be checked against a pinned version before the
second source is started. The MCP endpoint matters only for as long as D101 asks for a vendor's own MCP service to
be tested there.

### The API

`GET /api/resource/<DocType>` returns the document name as a stable id, takes filters on `appraisal_cycle` and
`employee`, and pages with `limit_start` and `limit_page_length`; twenty rows and only the name by default. The
licence of the HR app is GPL-3.0 and of the framework MIT. Whether any performance feature is in a paid edition was
not established.

## What it means for the two tracks

The discussion that led here weighed building the talks domain as a separate service behind the protocol, to prove
the protocol by building as a third party would. A service written here would not be an outside test (D102), and
[D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md) had already
turned that shape down. The alternative was to let the second real source answer the profile.

- **Frappe HR stays the right second source for leave approval.** Nothing here speaks against D101 item 3, apart
  from the two claims to recheck.
- **As an outside test of the talks seam it is partial.** It would test the round, the roster, the key and access
  enforced by the source, and it would force an answer to what a system without bookings says. It would not test
  action points honestly.
- **Goals should not be bent into action points** to make the fixture's shape fit a real product.

Prerequisites for a connected system were discussed and are not decided. As stated in the discussion: people reach
the system through the installation's identity provider; the account is the same person as in Clew's directory, by
a key both sides hold, created by provisioning and never on first call; and the system itself enforces what each
person may see. Per-person access comes in two forms, the identity provider's token accepted for the system's own
audience (as Nextcloud does) or a credential the system issues per user (as this product does), and a system with
only a service account is fit for aggregate reads alone. This comparison touches all three: the key is an email,
access for a manager is unproven, and the product is of the second form.

## Not established

- Any notion of a booked or held appraisal conversation in the product.
- A built-in rule that a manager sees the appraisals and goals of their own reports only; how list calls apply
  User Permissions.
- The address of a single document in the product's desk.
- Whether a login name can differ from an email.
- PKCE and refresh tokens in the product's OAuth server; a first-party MCP endpoint and the version it arrived in.
- Whether any performance feature is in a paid edition.
- Anything about version 16 in particular.

## Sources

Read 2026-11-11 in the product's public repositories, branch `develop`: the HR app's doctypes Appraisal Cycle,
Appraisal, Goal, Employee Performance Feedback and Appraisee (definition and code), its `hooks.py`, `api/__init__.py`
and licence; the Employee doctype and `hooks.py` of the ERP app it builds on; the framework's `auth.py`,
`permissions.py`, `utils/oauth.py` and licence. On the documentation site: the pages on the appraisal cycle, the
appraisal, the goal and employee performance feedback, the REST API page and the guide to setting up OAuth. The
reading was done by two sub-agents from first-party pages only; their reports separated what they found from what
they did not, and this page keeps that separation.
