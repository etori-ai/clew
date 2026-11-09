# D94 · A manager has a Personal section that lists the people on the units they manage

**Status:** accepted, built 2026-11-09 (the destination, the read, the page; notes and the utvecklingssamtal are not decided here) · **Date:** 2026-11-09 · **Area:** product, identity

**Decision.** A person who manages a unit has a destination of their own in the rail, **Personal**, under Verktyg,
at `/staff`. It lists the people on the units they manage and nothing else yet.

1. **Who sees it.** The row shows for a session whose role is `manager`, and the server decides on its own: the read
   takes the actor's own assignments (`auth_assignment`, D68) and answers 403 to anyone who manages no unit, whatever
   the browser showed. The units a manager sees are the ones their `unit-manager:` memberships gave them, never a unit
   named in the request.
2. **What it lists.** One card per managed unit, by label in Swedish order. In it, everyone assigned to the unit except
   the manager reading, by name in Swedish order, with the role they hold on that unit (a co-manager is listed as
   chef), their user name, their work address, and a mark when the directory has deactivated them. The rows come from
   the assignments, not from the active grant, so a person on two units is listed on both.
3. **Where it sits.** A destination that changes the main page (D83), in the administration's Layout and with the one
   page header (D74), composed as Användare (D85) is: a Table on a desktop, List rows on a phone, Astryx only. A person
   has no page of their own yet; a click into a person, notes, and the underlag for an utvecklingssamtal are the next
   steps and get their own decisions.
4. **What it is for.** The product owner's purpose, 2026-11-09: a manager should see their own people in Clew, so that
   Clew can later help with utvecklingssamtal and carry notes about what each person needs. The vision names the
   utvecklingssamtal records as a candidate for Clew's own first domain. This decision lays the section they will
   live in.

**Why.** The product owner asked for it on 2026-11-09, once the SCIM server and the fifty-person development directory
were in place: "om du är en manager då vill jag att du kan se min personalsektion i plattformen". The reference is the
proof of concept at `start.sundsvall.dev/portal/verktyg/personal`, which the review of 2026-11-06 read: a table of the
unit's people one click from the start page, with presence and the next utvecklingssamtal per person. Clew has the
people and the units from the provisioner and no presence or talks yet, so the first step is the section and the list.
Reading from the assignments rather than the grant is what makes a manager of two units, which the directory allows,
see both.

**Alternatives.** A declared `table` view from a connector, as the review of 2026-11-06 placed the demo's Personal:
rejected for the list itself, because who belongs to whom is Clew's own core data (D62, D68) and the scope check
belongs with it; a connector may later add presence or absence columns beside it. A tab on Hem: rejected, because the
people are a standing destination, not today's work.

**Replaces.** Adds a rail destination to the examples in [D83](D83-interface-spaces-have-stable-navigation-roles.md)'s
reference. Nothing else changes.
