# D116 · Start and the row under it are Clew's; the intranet keeps the other places

**Status:** provisional (Oliver Borgström, 2026-11-13; built on the branch `start-is-clews`, tested by nothing outside the repository) · **Date:** 2026-11-13 · **Area:** ui, integrations

**Decision.** In the shared header, the place Start and the row of pages under it belong to Clew. The header connector
(D88) still gives the band its name, its logo and every other place, which are the intranet's.

1. **Clew draws Start first among the places**, leading to `/`, with Clew's own pages under it: Hem (`/`), Att göra
   (`/todo`), Kalender (`/calendar`) and, for a manager, Personal (`/staff`), the places at the top of the rail (D112
   item 1) in its order and with its words; and for a manager **Dialogstöd**, the page of their own unit, which Läget
   on Hem already calls the dialogue support ("Öppna dialogstödet"). It leads to `/units`, the overview of the units
   they follow up, the address every unit page shares, so the entry stays marked on each of them (amended by
   [D117](D117-a-manager-follows-up-the-units-below-and-a-source-is-told-them.md); first built as `/units/<id>`).
2. **The rail stays.** The same places stand in the rail and under Start; the header is the intranet's way through the
   site and the rail is Clew's own navigation, with its tools, conversations and administration.
3. **A connector's own Start is left out.** A place the header connector lists with the id `start`, or with Clew's root
   `/` as its address, is dropped with the pages under it, and Clew's Start takes its place first in the row. The
   connector lists the intranet's places; it no longer decides what stands under Start.
4. **The row grows with Clew.** A page Clew gains that every person of a role should reach from the header joins the
   row here, in code, not in the intranet's menu. Dialogstöd is the unit's page with its key figures until the dialogue
   itself is built (the plan for absorbing big-boss-board, `docs/reviews/2026-11-12-absorbing-big-boss-board-into-clew.md`
   in PR #41); then the entry leads to that. No new destination is added by this record: every page in the row exists.
5. **Without a header connector** nothing changes: there is no band (D112 item 1), and Clew's default header is the
   name and Start, as before.

**Not covered.** The header the intranet embeds on its own pages (`<site-header>`, D87) reads its own static menu, whose
`start` item it keeps; whether it should list Clew's pages under Start there is not decided. The intranet's flow
"Nytt utvecklingsärende", which the development fixture listed under Start, is no longer in that row; it is the
intranet's page and belongs among its places if it should be in the header.

**Why.** Oliver Borgström, 2026-11-13: "Start should be part of Clew, and all its sub-rows." The row under Start listed
Clew's pages, but which ones was decided in the intranet's menu (the fixture's `menu.json`), so a page of Clew's could
only reach the header by an edit in another system. Asked which pages, whether the rail stays and where to build it, the
answers were Clew's main pages, keep the rail, and a branch of its own.

Weighed and left: the prototype's row (Mina aktiviteter, Min AI, Personal, Dialogstöd), since Clew's places have other
names since D112; the rail's tools in the row too, since the row would then grow with every administrator's choice;
removing the rail, which D112 keeps and the prototype decision withdrew on 2026-11-11.

**Amends** [D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md): the connector an
administrator chooses still gives the header its content, except Start and its row.
