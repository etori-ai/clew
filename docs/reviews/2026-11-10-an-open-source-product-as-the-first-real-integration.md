# Comparison: an open-source product as the first real integration · 2026-11-10

Status: comparison and recommendation. Nothing was installed or called. Every statement about a product comes from
its own documentation or source as read on this date, and is marked where it is weaker than that. The choice is the
product owner's.

The [project review](2026-11-10-project-review-and-alternative-paths.md) found that nothing in Clew has met a system
that was not written for it. The product owner's answer: no municipal system is within reach, so an open-source
product, run locally with made-up data, should stand in. The [review of 2026-11-06](2026-11-06-from-mock-connectors-to-real-test-sources.md)
already listed such products behind the fixtures; none was built. This comparison asks a narrower question than that
one did: which single product tests the things the project review says are unproven.

## What the product has to test

1. **Work that waits for a person's decision**, listed for the calling user with stable ids, with an action and a way
   to read the result back. This is Clew's loop.
2. **Calls as a specific person**, with access that differs between two people and is enforced by the product, not
   by Clew.
3. **Authorization for work in the background**, the problem `needs-session` marks today: can a scan or a durable
   write run as the person when no browser is open?
4. **The same adapter built both ways**, on Clew's protocol and over MCP, acting as the same user
   ([D100](../decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md), item 2). This needs a first-party
   MCP server with per-user authorization, in the free edition.
5. An OSI-approved licence with no needed feature in a paid edition, an official container image, and sign-in through
   Keycloak.

## The candidates

"Docs" means read in the product's documentation or source; "weak" means a secondary source or not established.

| Product | Licence, paid split | Decision work | API as a user | Background as the user | First-party MCP, per user | Verdict |
|---|---|---|---|---|---|---|
| **Frappe HR** (on Frappe 16) | GPL-3.0, framework MIT; no paid edition found (docs) | Leave applications and expense claims awaiting an approver; workflow transitions checked against the caller's roles (docs, source) | Its own OAuth 2 server: authorization code with PKCE, per user. Does **not** accept the identity provider's token (source) | Refresh tokens from its own server (docs) | Built in at `/api/v2/mcp`, per-user OAuth (docs) | **Recommended first** |
| **Nextcloud Approval app** | AGPL-3.0, no split (docs) | Files awaiting approval: `pendings`, `approve`, `reject`, `state` (source) | Accepts the identity provider's token as a bearer, audience checked (docs); a forum thread reports failures outside OCS routes (weak) | None: lives with the session's token | The official server takes an app password, not per-user OAuth (docs) | **Recommended second**, already in the stack |
| Odoo Community | LGPL-3.0 (weak); open core, the generic approvals app appears paid (weak) | Time off approval (weak) | Per-user API key (docs) | The key | Not established | Good domain, weaker on 3 and 4 |
| Zammad | AGPL-3.0 (weak) | Tickets by owner, no approval step | Per-user token or its own OAuth 2 (docs) | The token | Community only (weak) | The candidate for errands later |
| OpenProject | GPL-3.0; single sign-on and MCP are paid add-ons (docs) | Assigned work packages | Accepts the identity provider's token, but needs the paid provider setup (docs, inferred) | Its own OAuth 2 is free | Paid | Ruled out by the paid split |
| OrangeHRM | GPL-3.0 (weak); a paid edition exists | Leave approval; endpoints not established | Its own OAuth 2 (docs) | Not established | None found | Too much unknown |
| GLPI | GPL-3.0; single sign-on is a paid plugin (docs) | Ticket approvals; paths from a forum only | Its own OAuth 2 (docs) | Not established | None found | Ruled out by the paid split |
| Redmine | GPL-2.0 | Assigned issues, no approvals | Per-user key (docs) | The key | Not established | Little to test |
| Open ePlatform | AGPL-3.0 (weak) | The closest to municipal work | Not established | Not established | None found | No container found; not runnable from what was read |

## Recommendation

**Frappe HR first.** It is the only candidate where real approvals in a domain the vision names (leave, expenses),
per-user authorization with refresh tokens, sign-in through Keycloak and a first-party MCP server with per-user
authorization are all in the free edition. That makes the two-way comparison fair: both adapters act as the same
person against the same records.

The first loop, a manager approves a leave application:

| Step | Call (from documentation and source, not run) |
|---|---|
| Link the person once | Authorization code with PKCE against the product's OAuth 2 server; the connector keeps the refresh token. The person signs in to the product through Keycloak. |
| List what waits | `hrms.api.get_leave_applications` with `for_approval`; the document's `name` is the stable id |
| Act | `frappe.model.workflow.apply_workflow` with the document and the action, or a status update where no workflow is configured |
| Read back | `GET /api/resource/Leave Application/<name>`: status and workflow state |
| The MCP variant | `/api/v2/mcp`: `list_documents`, `get_document`, `call_method` |

**Nextcloud's Approval app second**, because it is already running and it is the one free product that accepts
Keycloak's own token. Together the two cover both token models: a credential the product issues and the connector
keeps (background work possible), and the identity provider's token passed through (no background work). That is the
evidence the project review's path C needs, the choice between persisted scans and live reads per source.

## What it will and will not prove

| Concern in the project review | What the first loop shows |
|---|---|
| The protocol's promises have only met fixtures | Whether a product can give stable keys, a complete list (paging, filters), and a safe write. This product has no operation id, so the write runs on the ledger's most conservative strategy and the read-back carries the receipt. |
| Background authorization | A linked account with a refresh token: a scan as the person with no browser open, and what happens when the token is revoked. |
| Access enforced by the source | Two managers with different teams. The approver field alone does not restrict what a caller can list, so the seed must set the product's own user permissions; that is itself a finding about what "as the person" means. |
| Clew's protocol or MCP | Two adapters over the same loop: lines of code, what the administrator has to configure, what the person sees. |
| Views | A product with fields Clew did not invent, drawn first from the output schema (D100, item 3). |

It will not prove anything about a municipal system, real people or real data. The adapter to this product is
throwaway in a real installation. What is kept is every fix on Clew's side that a foreign API, a foreign identity
model and a foreign idea of "done" force.

## Risks and unknowns

- The product will not take Keycloak's token, so each person links an account once. Clew has no "bound personal
  account" flow today; building it is part of the work and part of the point.
- The MCP server and its client registration need version 16; whether the product's container setup tracks that
  version was not established.
- Seed data (employees, a reporting line, leave types, applications) has to be scripted, and it must give two managers
  different access.
- The stack grows by the product, a MariaDB and a Redis. It belongs in an opt-in profile, as the 2026-11-06 review
  proposed, not in the default stack.
- The licence is to be checked again from the image and the repository when a version is pinned, and recorded in
  `HANDOVER.md` section 3.
- For Nextcloud: bearer validation is reported to work on OCS routes, which the Approval app uses, but this is
  untested, and users must exist there before the first call.

## Sources

Read 2026-11-10: the Frappe framework's `auth.py`, OAuth 2 guide and MCP guide, and the HR app's `api/__init__.py` and
`model/workflow.py` in their public repositories and documentation site; the Nextcloud administration manual on OpenID
Connect, the `user_oidc` README, and the Approval app's `routes.php` and `ApprovalController.php`; the external API or
authentication pages of the other products' own documentation. The research was done by a sub-agent from first-party
pages; its report separated what it verified from what it inferred, and this page keeps that separation.

## Outcome

2026-11-10. The product owner chose Nextcloud's Approval app first, because it already runs in the stack, with
Frappe HR as the second source. [D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)
records the choice, the loop, the two builds to compare and the freeze on new surface until the loop works. With this
order the first source tests the identity provider's token passed through and live reads; work in the background as
the person and a vendor's own MCP service wait for the second.
