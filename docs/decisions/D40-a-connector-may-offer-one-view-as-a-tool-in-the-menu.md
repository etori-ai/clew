# D40 · A connector may offer one view as a tool in the menu, and an administrator switches it on

**Status:** accepted, built 2026-11-05; a full-page view and a row pinned by a person or a manager are not built · **Date:** 2026-11-05 · **Area:** ui

**Decision.** The menu has a section **Verktyg** at its foot. It holds Kalender and, after it, one row per connector
that offers one of its declared views (D38) as a tool. The connector says which view; an administrator decides whether
the row is shown; Clew decides everything about how and where.

1. **The declaration** (`menu` on the manifest in `packages/connectors/src/protocol.ts`, `MenuDeclarationSchema` in
   `packages/contracts`, `$defs.Menu` in the published schema; `menu` on a bundled `Connector`). One row per connector:
   `{ capability, label, icon }`. `label` is Swedish and at most 24 characters. `icon` is a name from a fixed list Clew
   owns (`phone`, `people`, `book`, `document`, `chart`, `search`, `clock`, `link`); a connector sends a name, never a
   drawing. The field is optional, so the protocol stays version 1.
2. **The rule** (`menuProblem` in `packages/connectors/src/views.ts`, enforced by `parseManifest` and
   `Registry.register`): the row opens a read of the same connector that declares a view and whose input lists nothing
   as required. A row is one click and no question; a read that needs a reference or a search term cannot be one.
3. **Off until an administrator switches it on.** The connector row has `menu_enabled`, false by default (migration
   `0012_connector_menu`). The switch "Visa i menyn" sits under Områden on the connector's page and in the "Vem ser det"
   step of "Anslut system", only where the manifest declares a row. Switching it is the use case `update` with the audit
   row `connector.menu` (`to`, the label and the capability) in the same transaction, and it reaches the live registry
   at once. A refetched manifest says when a row was added, removed or changed; a row the service adds is still off.
4. **Who gets it** (`Registry.menu(actor)`, handed to the browser beside the areas by `GET /api/areas`): a person in the
   connector's audience, while the connector is on, the switch is on and the person may call the read. There is no
   audience of its own for the row: it follows the connector's.
5. **How it is drawn** (`apps/web/src/components/nav.tsx`, `Shell` in `shell.tsx`): an Astryx `SideNavSection` titled
   Verktyg with a `SideNavItem` per row, Kalender first, then the tools in Swedish alphabetical order. Four tools show;
   the rest sit under a collapsible "Fler verktyg", so the foot of the menu keeps its height however many connectors
   offer a row. A row is a link to the view's own address (`/vy/:capability`), the same address the chip under the box
   opens, so it opens in the side panel, the back button closes it, the row is marked current while it is open, and
   focus returns to the row when the panel closes. The menu's search field finds a tool by its name.
6. **The icons.** Astryx's semantic icon names have no phone, people, book, document, chart or link. Those six are
   Heroicons outline components (`@heroicons/react` 2.2.0, MIT, already a dependency) handed to `SideNavItem` as SVG
   components, which is Astryx's documented way for an icon outside the semantic list; `search` and `clock` are the
   semantic names. The gap is recorded here and not filed as a gap report.

**Why.** The product owner asked where a phone book stays put, and proposed the menu, in a section with the calendar.
That is the right kind of place: the calendar is the precedent for a tool one goes to, where an area is a lens on the
stream. Before this a view was reachable as a chip under the box and under its area. The chips show only on the landing,
never in a conversation, and there are at most eight with the doing actions first, so a read is pushed out as
connectors arrive. A phone book is looked up in from wherever one is.

*Why this is not the page builder the vision rules out.* The vision says an operator configures connectors, scopes and
bundle times, not blocks, and that there is no operator-composed layout. The switch is a property of a connector, like
"Skicka kort" and "Erbjud assistenten". The administrator cannot choose the row's place, order, section, label or
icon, and cannot add a row that no connector declares. The page itself, the stream, the areas and the box, is untouched:
the row opens a view in the panel that already exists.

*Why off by default, when every other switch only narrows (D23).* The other switches govern access, and the manifest
is the ceiling. The menu is a place every person in the audience sees on every page, and it is short. A connector
must not take that place by declaring it, so the declaration is an offer and the administrator accepts it.

*Why the administrator and not the person or a manager.* A person pinning a view for themselves needs a per-person
setting and a place to manage it; a manager pinning for a unit needs manager-level settings, which Clew has none of.
The first request, a team's contact list for every team member, needs neither: the phone book's team list is derived
from each person's own unit. The simplest thing that puts a tool in front of everyone who should have it is the
connector's audience, which exists. Both other forms stay open.

*Why one row per connector, and a cap.* A second row is a second tool and is better a second view reached from the
first (a filter, a row's `open`). The cap keeps the foot of the menu from pushing the conversations out on a low
screen. Alphabetical order means no connector and no operator competes for the top.

*Why the panel and not a page.* A view exists only in the side panel today. From the calendar the row therefore leads
to the start page with the panel open. A view lifted to a full page (D38's list of what is not built) would make a
tool a true sibling of Kalender; the row's address would stay the same.

**Verified.** `tests/unit/menu.test.ts` (the rules, the manifest loader, a bundled connector, who gets the row, the
order, the switch with its audit row, a refetched manifest); the store contract on both adapters (`menuEnabled`);
`tests/a11y/menu.spec.ts` (the named section, keyboard, current page, focus back to the row, the menu's search, more
than four tools, the phone drawer, 320 px, the administrator's switch and its disabled state, axe).
`connectors/telefonbok` declares the row "Telefonbok" on its search.

**Not built.** A view as a full page. A row a person pins for themselves, and a row a manager pins for a unit. An
audience for the row narrower than the connector's. A count or a status dot on a row. Kalender is still Clew's own page
and not a declared tool.

**Replaces.** Nothing. Closes the item "a view pinned to the rail" in D38's list of what is not built, in the
administrator's form; D38's status says so.
