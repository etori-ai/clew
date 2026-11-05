# D40 · A connector's views can be tools in the menu, and an administrator chooses which

**Status:** accepted, built 2026-11-05 (first as one row per connector, changed the same day to a choice per view); a tool opens as a page of its own since D42 (item 5 and "Why the panel and not a page" below are replaced by it); a row pinned by a person or a manager is not built; the icon list extended and opened to areas by D41 · **Date:** 2026-11-05 · **Area:** ui

**Decision.** The menu has a section **Verktyg** at its foot. It holds Kalender and, after it, the views (D38) an
administrator has chosen as tools. Any view that opens without a question can be one. The administrator chooses view
by view; the connector may say what a view's row is called; Clew decides everything about how and where.

1. **Which views can be tools** (`menuEligible` in `packages/connectors/src/views.ts`): a read capability that declares
   a view and whose input lists nothing as required. A row is one click and no question, so a read that needs a
   reference or a search term cannot be one. A connector with five such views has five to choose from.
2. **What the connector may say** (`menu` on a capability in `packages/connectors/src/protocol.ts`, `MenuHintSchema` in
   `packages/contracts`, `$defs.Menu` in the published schema; `menu` on a bundled `Capability`): `{ label, icon }` for
   the view's row. `label` is Swedish and at most 24 characters, the name of the tool ("Telefonbok"), not of the action
   ("Sök i telefonboken"). `icon` is a name from a fixed list Clew owns (`phone`, `people`, `book`, `document`, `chart`,
   `search`, `clock`, `link`); a connector sends a name, never a drawing. It is optional: a view without it takes the
   capability's title and the `document` icon (`menuRowOf`). The loader and `Registry.register` refuse `menu` on a
   capability that cannot be a tool (`menuProblem`). The field is optional, so the protocol stays version 1.
3. **The administrator chooses, view by view.** The connector's page lists, under Områden, every view that can be a
   tool with the row it would be and a switch each ("Verktyg i menyn"). All are off until chosen. The choice is stored
   as `menu: true` in the capability's override (`connector.capabilities`, the same map that holds the switches På and
   Assistent), changed through the admin use case `update` with `menu: { "<capability>": true | false }`, one audit row
   `connector.menu` per view that changed (`capability`, `to`, the label), in the same transaction, live at once. The
   capability's own switches do not disturb the choice and the choice does not disturb them.
4. **Who gets a row** (`Registry.menu(actor)`, handed to the browser beside the areas by `GET /api/areas`): a person in
   the connector's audience, while the connector is on, the view is chosen, the read is switched on and in the person's
   scope, and the capability can still be a tool. A row has no audience of its own: it follows the connector's.
5. **How it is drawn** (`apps/web/src/components/nav.tsx`, `Shell` in `shell.tsx`): an Astryx `SideNavSection` titled
   Verktyg with a `SideNavItem` per row, Kalender first, then the tools of all connectors in one Swedish alphabetical
   order. Four tools show; the rest sit under a collapsible "Fler verktyg", so the foot of the menu keeps its height
   however many views are chosen. A row is a link to the view's own address (`/vy/:capability`), the same address the
   chip under the box opens, so it opens in the side panel, the back button closes it, the row is marked current while
   it is open, and focus returns to the row when the panel closes. The menu's search field finds a tool by its name.
6. **The icons.** Astryx's semantic icon names have no phone, people, book, document, chart or link. Those six are
   Heroicons outline components (`@heroicons/react` 2.2.0, MIT, already a dependency) handed to `SideNavItem` as SVG
   components, which is Astryx's documented way for an icon outside the semantic list; `search` and `clock` are the
   semantic names. The gap is recorded here and not filed as a gap report.

**Why.** The product owner asked where a phone book stays put, and proposed the menu, in a section with the calendar.
That is the right kind of place: the calendar is the precedent for a tool one goes to, where an area is a lens on the
stream. Before this a view was reachable as a chip under the box and under its area. The chips show only on the landing,
never in a conversation, and there are at most eight with the doing actions first, so a read is pushed out as
connectors arrive. A phone book is looked up in from wherever one is.

*Why per view and not per connector.* The first build let a connector offer one row and gave the administrator one
switch, "Visa i menyn". The product owner tried it and said it was too narrow: a connector exposes several views, of
different kinds, and which of them are tools is the organisation's call. A switch per connector cannot say which, and
a rule of one row per connector made the connector's author decide for every organisation. So the unit is the view, as
it already is for the switches På and Assistent.

*Why any view that can be a tool, and not only the ones the connector marks.* If the administrator could only choose
among views the connector had marked, a connector written before this, or by someone who did not think of the menu,
would have nothing to choose. What makes a view fit for the menu is a fact Clew can check: it opens without input.
What the connector knows better than Clew is what the tool is called, so that is what it may add.

*Why this is not the page builder the vision rules out.* The vision says an operator configures connectors, scopes and
bundle times, not blocks, and that there is no operator-composed layout. The choice is a property of a connector's
capability, like På and Assistent. The administrator cannot choose a row's place, order, section, label or icon, and
cannot add a row that is not a connector's view. The page itself, the stream, the areas and the box, is untouched: the
row opens a view in the panel that already exists.

*Why off by default, when every other switch only narrows (D23).* The other switches govern access, and the manifest
is the ceiling. The menu is a place every person in the audience sees on every page, and it is short. No connector
takes that place by itself; an administrator gives it.

*Why the administrator and not the person or a manager.* A person pinning a view for themselves needs a per-person
setting and a place to manage it; a manager pinning for a unit needs manager-level settings, which Clew has none of.
The first request, a team's contact list for every team member, needs neither: the phone book's team list is derived
from each person's own unit, and is now one of the views an administrator can choose. Both other forms stay open.

*Why a cap on what shows, and none on what is chosen.* The cap keeps the foot of the menu from pushing the
conversations out on a low screen. How many tools an organisation wants is its own matter; the fifth and later are one
click further away. Alphabetical order means no connector and no operator competes for the top.

*Why the panel and not a page.* A view exists only in the side panel today. From the calendar the row therefore leads
to the start page with the panel open. A view lifted to a full page (D38's list of what is not built) would make a
tool a true sibling of Kalender; the row's address would stay the same.

**Verified.** `tests/unit/menu.test.ts` (which views can be tools, the row with and without the connector's name, the
manifest loader, a bundled connector, who gets a row, several views of one connector, the order, the choice with its
audit rows, the choice beside the other switches, a manifest that stops offering a view, a restart); the store contract
on both adapters (`menu: true` in an override); migration `0013_menu_per_view` run on a scratch database with rows in
the first build's shape; `tests/a11y/menu.spec.ts` (the named section, keyboard, current page, focus back to the row,
the menu's search, more than four tools, the phone drawer, 320 px, the administrator's list of views on desktop and on
a phone, a connector with none, axe). `connectors/telefonbok` names two rows: "Telefonbok" on its search and "Mitt
team" on its team list.

**Not built.** A view as a full page. A row a person pins for themselves, and a row a manager pins for a unit. An
audience for a row narrower than the connector's. A count or a status dot on a row. The same choice for the chips under
the box. Kalender is still Clew's own page and not a declared tool.

**Replaces.** Its own first form, built and replaced the same day before anything was published: a `menu` object at
the top of the manifest naming one capability, and a `menu_enabled` column per connector (migration
`0012_connector_menu`; `0013_menu_per_view` carries a switched-on row over to the view it named, takes the top-level
`menu` out of stored manifests and drops the column). Closes the item "a view pinned to the rail" in D38's list of what
is not built, in the administrator's form.
