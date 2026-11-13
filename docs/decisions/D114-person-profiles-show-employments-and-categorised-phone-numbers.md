# D114 · Person profiles show current employments and categorised phone numbers

**Status:** provisional (product owner, 2026-11-12, who directed the build against the freeze on new surface of [D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) and settled items 3, 5 and 6 after the [review of the same day](../reviews/2026-11-12-scim-and-the-guides-before-the-handover.md)); implemented with the synthetic provisioner; accepted once a real directory has sent employments and numbers; no manual screen-reader pass yet; item 3 amended 2026-11-12 in the fixes of the review of users and the organisation (S8, Q2): blank addresses are left out before one is chosen, and the primary work address is taken before the first; the section on work placements, first written the same day with [the note on municipal employment](../reviews/2026-11-12-municipal-employment-and-work-placements.md), which names nobody who chose it, was settled in the same fixes, whose open decisions the product owner asked the work to take (X4, X5): a work placement is not a placement in the sense of [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md), is not sent today and gives no access or reporting line, and a person who must act at another unit gets a `unit:` membership there · **Date:** 2026-11-12 · **Area:** identity, ui

**Amended 2026-11-12.** In the fixes of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md),
which the product owner asked for on 2026-11-12 with every open decision taken in the work. The items and the section
below stay as written; where they differ from this paragraph, this paragraph holds.

- **Item 3, which address is published (S8, Q2).** An e-mail entry whose value is absent, `null`, empty or only space
  is left out first; a value that is present but not text is still refused. Then Clew takes a `work` address, the
  primary one before the first (`primary` true, or the word for it in any case); else an untyped address the same
  way; else, for a whole list only (a body, or a `replace` on `emails`), any other address the same way. So a home
  address is published when the work entry is blank, as it is when a body carries only a home address. An `add` of
  an address of another type stands beside the one Clew holds and changes nothing. A person with no readable address
  is refused, since one address is required ([D68](D68-people-are-pushed-into-clew-through-standard-scim.md) item 1
  as amended).
- **Work placements (X4, X5).** A work placement in the section below is not a placement in the sense of
  [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md), where a placement is a
  membership of a `unit:` group. It is not sent today, and it gives no access and no reporting line. An employment names
  the unit that holds the job. A person who must act at another unit is given a `unit:` membership there, which gives
  the access and the reporting line of a placement under
  [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md): the host unit's
  manager then has the person in their team and their talks round, and the person's active unit may move
  ([D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
  item 8, the order of unit ids). Work at another unit that needs no access is not sent. The three facts the first
  municipal mapping must supply are among the operations guide's questions before anything is built: how the source
  tells two employments on one unit apart, what dates or bookings make a placement, and which source names the manager
  responsible for the employee.

**Why these choices.** They were taken in the work, as the product owner asked. The primary work address is taken first
because RFC 7643 §2.4 says `primary` marks the preferred value, and a directory that keeps an old alias beside the
current address marks the current one: taking the first would publish the alias for everybody whose directory lists it
first, depending on an order the directory team never chose. Blank entries are left out because a serializer that writes
every empty field would otherwise refuse a new hire whose work address is readable. A home address is published when the
work entry is blank because the product owner decided in S2 of the
[handover review](../reviews/2026-11-12-scim-and-the-guides-before-the-handover.md#outcome) that what the directory
sends is the directory's to answer for, which item 3 already applied to a body that carries only a home address. For
work placements, building a placement now was weighed and left: no source sends one, the freeze on new surface of
[D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md) (the first real
integration) holds, and the note shows that the source's model is not known. Sending every temporary posting as a
`unit:` membership was also left: it would make a visiting care worker a direct report of each host manager, in that
manager's talks round, and could move the worker's active unit; for staff booked from a staffing unit, as in the note's
example, the reporting line would change with every booking. A membership only where the person must act keeps the
reporting line and the talks round where the employment is until the first real mapping says more.

A person can hold several current employments, including two on the same unit. The profile shows the unit and optional title for each, alongside the person's e-mail address and all phone numbers supplied for display. A phone category may occur several times. The existing person page is the destination for an active person's name in Administration › Användare and Administration › Organisation.

**Decision.**

1. **The installation's provisioner owns both lists.** It sends categorised numbers through SCIM's `phoneNumbers` and employments through the optional [employment extension](../guides/writing-a-provisioner.md#current-employments), `urn:clew:params:scim:schemas:extension:employment:2.0:User`. A full replacement can withdraw entries. An entry names a unit and describes the employment there: an optional title and, where the source has them, the form of employment, its first day and its percentage of full time. It has no id of its own, so the list is sent whole and two entries that say the same are one. A list holds at most 50 entries.
2. **An employment only describes work.** Membership of the `unit:` and `unit-manager:` groups still determines access, so a change of title or employment cannot change a person's grant.
3. **Clew does not judge what it is sent by what it is called.** Every number is stored and shown to everybody who is signed in to the organisation, whatever its `type`, `home` included. Clew publishes the first e-mail address with type `work`. Otherwise it chooses among untyped addresses if present, or among all remaining addresses. In each fallback it prefers the primary address and takes the first if none is primary. A person whose only address has type `home` is stored with it. What a directory publishes is the directory's to answer for. This replaces the rule from the [operations review of 2026-11-11](../reviews/2026-11-11-provisioning-operations-guide-and-source-lifecycle.md) that an address of another type than `work` is never taken.
4. **Empty is not a mistake.** A number or an employment entry with nothing readable in it (empty, `null`, not text, a number longer than 512 characters) is left out and the person is stored, as a title is under D110. A person does not have to have a phone number. The provisioning check counts people with a number and with an employment, which is where a mapping that sends nothing readable shows.
5. **Wrong is refused, with the reason.** An employment on a unit the organisation does not hold, an employment with a title and no `unitId`, `employments` written without the extension's URN, and a list past its limit answer 400 and name what was wrong. The unit is asked about when a request changes the list. A unit that is removed afterwards is not held back by the employments on it: the profile shows any remaining employment details without a unit name, omits a row with no remaining details, and the check identifies the affected reference. Beside a deactivation none of this refuses the request, and the list is left as it was (D113).
6. **A person's titles are the titles of their employments**, on the profile each with its unit, and in the user list and its search each once. The core `title` of D110 is shown where no employment carries a title.

This amends [D110](D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md). A core SCIM title already in the directory remains usable on its own. Assigning it to an employment requires the source to identify the unit. A real installation still needs to verify its mapping.

**Not built.** An id for an employment; a filter that picks one employment in a `PATCH`.

## Employment and work placement in a municipality

For future directory mappings, each employment has an organisational home unit. A work placement belongs to that employment and identifies the unit where the person works for a given period. When someone works at their home unit, the home unit alone is sufficient. One employment can also cover work at several other units at the same time. Managerial responsibility and permission to act each have their own source. This distinction guides future modelling. Today's SCIM employment describes the job, and group memberships still determine Clew assignments and access under item 2.

The reasons for this choice, the effect of a transfer or a temporary posting, and the questions for the first municipal directory are in [Municipal employment, work placements and managerial responsibility](../reviews/2026-11-12-municipal-employment-and-work-placements.md).
