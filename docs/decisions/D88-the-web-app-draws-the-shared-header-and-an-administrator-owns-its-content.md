# D88 · The web app draws the shared header above its rail, a connector gives Clew its content, and Clew has one front end

**Status:** accepted, built 2026-11-09 on `main`; item 5 amended 2026-11-12 in the fixes of the review of users and the organisation (A2): the last good header is kept per person, authorization version and provisioned groups, so a changed group membership is a new read too; items 4 and 5 amended 2026-11-13 in the fixes of the gaps that review left: a holder that fails, a 401 for Clew's key or assertion included, leaves the last good header in place for up to an hour, a holder that refuses the person with a 403 takes their places away at that answer, which the conformance check takes as an answer, and who may have the header is decided at every read · **Date:** 2026-11-09 · **Area:** ui, product, integrations

**Amended 2026-11-12.** Since A2 of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md),
the registry is handed the person's provisioned groups with the published actor on every path in the process, the
header included, so a header holder whose audience names a group
([D68](D68-people-are-pushed-into-clew-through-standard-scim.md), D23) answers its members and nobody else. Item 5's
cache therefore keeps the last good header per person, authorization version and provisioned groups (`headerScope`):
a changed grant or a changed group membership is a new read. The groups are in the key because a membership change
need not move the grant or its version. A change in a group that gives no unit, role or capability never does, and
an audience may name any group. The cache logic is in `apps/server/src/connectors/usecases/header.ts` (`siteHeaders`,
`headerScope`), which `apps/server/src/connectors/header.ts` binds to the live registry and the clock. The rest of
item 5 stands.

**Amended 2026-11-13.** In the fixes of the gaps that the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)
left, a failure of the holder and a refusal are told apart, since item 5's cache keeps a header through the one and
never past the other. Before this, a background read that failed or was refused put Clew's default in the kept
answer's place for the next minute, so one failed refresh turned a person's band into the default. Item 4's
`Registry.header` now answers `answered`; `denied`, when the holder refuses the person with the protocol's `denied`
and its 403, which is how a content system lists nothing for them, since a `SiteHeaderOutput` has at least one place;
`failed`, when the holder the person may have throws otherwise, does not answer within the budget or answers out of
shape, a delegated token the exchange cannot give (D26) included; or `refused`, when no connector gives the person the
header, or the holder was switched off, replaced or narrowed while it was asked, judged on the governance read after
the call whether the holder answered or not. A remote connector's error code reaches the registry
(`CapabilityError.code`), which is how it tells a refusal of the person from a failure. Only a `denied` with a 403 is
a refusal: a 401 is the holder rejecting Clew's key or assertion, as the protocol defines it, so it reaches the
registry as `unavailable` whatever its body says, and an outage of the holder's key set leaves everyone's last header
in place and is logged instead of taking everyone's places away. Item 4's conformance check takes a holder's `denied`
for one of its two people as the holder's answer, in the header's lines and in the capability's, and warns when the
holder denies both, since no answer's shape was then checked; a failure still fails it. `connectors/intranet` answers
`denied` for a person its file lists no place for. `Registry.headerHolder` names the connector that gives the person
the header, without asking it. Item 5 now reads: a holder that fails leaves the last good header in place for
up to an hour after it gave it (`HEADER_STALE_MS`), or the default when it has given none, and is asked again a minute
later; after the hour the default stands until it answers. An hour, because a stale menu is harmless and an access
change is not: in a large organisation an hour carries everyone's menu through a restart or an ordinary outage of the
content system, which meanwhile is asked once a minute per person, and the bound never reaches who may have the
header. A holder's `denied` is its answer, not a failure: the default takes the place of what was kept at that answer
and is kept until the next refresh like any answer, so a content system takes a person's places away as fast as it
narrows its listing, and is not asked at every page load for a person it refuses. An answer is kept whatever was kept
while it was asked, and a failure takes nothing's place, so of two reads at once the one that fails cannot undo the
other's answer. Who may have the header is decided at every read, before anything kept is served: the holder switched
off as the holder or another chosen, its audience narrowed to leave the person out, the connector or its header
capability switched off, and a refusal by the registry while it is asked take effect at the next read, and such a
refusal is never kept, so a person let in is asked at once. A kept header past the hour leaves the process.
`forgetSiteHeaders`, which nothing called, is gone. The cache is in `apps/server/src/connectors/usecases/header.ts`
and its tests in `tests/unit/intranet-connector.test.ts`. The rest of items 4 and 5 stands.

**Decision.** The product owner showed the header of the proof of concept at https://start.sundsvall.dev/portal/start
on 2026-11-09 and asked for it in Clew. Asked where, the product owner chose the web app on 3020 ("that is where we
should work"), the header above the existing rail (not in its place), and that `apps/portal` go: "from now on there is
only one frontend". The first instruction was that an administrator manages the links and the logo inside Clew; the
product owner then changed direction the same afternoon: the links come from an external system such as SharePoint,
most likely through a Sitevision connector, so Clew gets no header administration of its own, and the question is how
a connector is allowed to manage the links, or potentially the entire header. The decision has four parts.

1. **One front end.** `apps/portal` (D67) is removed, with its port (3024), its scripts, its default in
   `FRONTEND_ORIGINS` and its mention in the documentation. D67 is superseded. The server's rule from D67 item 6 stays:
   a mutation is accepted from `PUBLIC_URL` or an origin an operator lists, so a front end on another origin remains
   possible; none is in the repository. The intranet stand-in that the portal's dev server served (D87 item 8) is served
   by the web app's dev server instead (`apps/web/vite.config.ts`, development only), so `/intranat/…` on 3020 and the
   WCAG spec `tests/a11y/site-header.spec.ts` keep working.
2. **The header is `@clew/site-header`'s `SiteHeader` (D87), drawn as the reference draws it, above the rail.** The web
   app's shell (`apps/web/src/components/shell.tsx`) puts it in `AppShell`'s `topNav`. It is three rows of Astryx's
   `TopNav`: a **band** with the logo and the site's name at the start and the host's controls at the end (the reminder
   bell, D39, and the person), under it in the same band the **places**, and under the band a row with the **current
   place's own pages**, drawn only when the place has any. The band is a nested Astryx `Theme`, `createHeaderBandTheme`
   in `packages/ui/src/theme.ts`: the installation's accent as the ground with its on-accent text, icons, selected mark
   and focus ring, the same in both appearances, as the reference draws a dark blue bar on every page; the selected
   place and a secondary button stand on a lighter wash of the band (`color-mix`), so white text keeps 4.5:1. Neutral's
   bar is Neutral's accent, a near-black. The proof of concept's `#003c69` is not in the published Sundsvall palette, so
   the band is Vattjom (`#005595`, D38) until a published darker blue is agreed. On the band the logo's dark variant is
   drawn (Sundsvall's white dragon), 28 px tall with its own width. The rows of places and pages wrap when there are
   more than fit on one line (1.4.10), inside an `HStack wrap="wrap"` in the `TopNav`'s start slot. The header's
   breakpoint is `md` (768 px), the line every phone decision in the web app follows (D87's `xl` was for one row that
   held heading, places and person together): below it `AppShell` draws the heading row as its bar, without the band
   (the shell's drawer is rendered inside that bar and would inherit the band's colours), with the bell and the person
   as an avatar, and the places are rows in the drawer with the rail, under "Huvudmeny". With a top bar Astryx paints
   the rail and the page on one surface and parts them with a divider (`variant="section"`); D46's "the rail reads as
   its own area" now rests on that divider and the selected row, not on a colour of its own. Every link in the header
   is a whole-page load (D87 item 2), so "Start" reloads the app.
3. **The rail loses its heading and its account row.** The logo, the name and the bell stood in `SideNavHeading` and the
   person was the rail's last row (D39 and its amendments); they are the header's now, so the rail is Clew's places and
   conversations alone (D50) with Administration at its foot. The person is `SiteHeaderPerson`: the avatar and the name
   as a button, `"<name>, inställningar"` (an icon-only button with the avatar on a phone), which opens the settings
   dialog with the unit, the appearance choice (Samma som datorn, Ljust, Mörkt; D39's message when the browser refuses
   to keep it) and "Logga ut". The shell's own settings dialog is gone.
4. **A connector gives Clew the header; Clew edits nothing.** The protocol (D21) gains one optional manifest field,
   `header: { capability }`, naming one of the connector's read capabilities that takes no input and answers a
   `SiteHeaderOutput` (`packages/contracts`): the site's name and address, the places with their own pages (the shape
   `@clew/site-header` reads, D87 item 1) and the logo when the system has one (an https address or a path on Clew's
   origin). The manifest rules refuse a header that names an unknown capability, one that is not a read or one that
   needs input; the conformance check asks it as both roles and reports the count of places, never their words (D23,
   D44). **The header is exclusive, and the holder is chosen, never inferred.** Scan, figures and menu rows are
   additive and Clew merges contributions; the header is one system's navigation and identity, so a connector that
   declares `header` is only a candidate. An administrator chooses the holder on the connector's own page
   (Administration › Anslutna system › Områden, the switch "Ger sidhuvudet"; the status line says "Ja", "Kan ge
   sidhuvudet" or that the connector cannot): governance like the rest of D23 (`Governance.header`, the row's
   `header_holder`, migration 0038), one row at a time. Turning it on for one connector turns it off for the previous
   holder in the same transaction, with an audit row `connector.header` on both (`to`, `from`, `takenBy`); a connector
   whose manifest names no header capability is refused. `Registry.header(actor)` (`packages/connectors`) asks the
   holder alone, as the person, when it is enabled, the person is in its audience and may call the capability, and
   checks the answer against the schema; a person outside the holder's audience, an answer out of shape or a connector
   that does not answer all give Clew's default, reported through `onRefused`, never another connector's header. Two
   connectors claiming the header is a configuration to surface, not a merge to compute. Deciding by registration
   order, as the first build did, was invisible to an administrator and flipped when a connector was added or removed,
   the silent behaviour D23 removed. `GET /api/header`
   (`apps/server/src/connectors/header.ts`, platform code beside the registry like the menu and the tools) answers the
   signed-in person's header, or Clew's default, the site's name and Start, when no connector gives one; the logo falls
   back to the build's (D37/D38). Who gets which header is therefore the connector's audience and the content system's
   own listing (a manager sees sections an employee does not), administered through the holder switch and the existing
   connector governance (on or off, who sees it); the conformance check and the connector's page show a candidate as
   "Kan ge sidhuvudet" whether or not it holds the header, as they show scan and figures. `connectors/intranet` is the
   fixture of the development stack: its menu is a file, `connectors/intranet/menu.json` (or `INTRANET_MENU_FILE`), in
   the protocol's shape plus an optional `roles` per place or page that the connector resolves for the acting person,
   with the site's name, the logo (Sundsvall's white dragon, served from the web app's public folder) and the stand-in
   tree's four sections under `/intranat/`, port 4049, registered by `bun run dev:connectors`. The product owner's
   direction (2026-11-09, evening): the band keeps the installation's Neutral black in the development stack, and the
   header's content is mocked in that file until a content system's connector answers it. A real installation writes the
   same capability over Sitevision's, SharePoint's or WordPress's API and returns absolute addresses.
5. **The header never blocks a page, and never asks for anything.** The browser draws the default band at once and
   fills the places in when `GET /api/header` answers (the query is kept for the visit). On the server the holder gets
   three seconds (`HEADER_TIMEOUT_MS`); a timeout, a failure, an answer out of shape or a delegated token the person has
   not granted (D26: the exchange fails, nothing interactive is started) all mean Clew's default. The last good header
   per person and authorization version is kept for a minute (`HEADER_FRESH_MS`) and served again while a fresh one is
   fetched in the background, so a slow or down intranet costs one page load a moment, not every page load; a changed
   grant is a new read. The cache lives in the process (`apps/server/src/connectors/header.ts`). The intranet stand-in
   draws the same branding profile as the web build it stands beside (`webConfig({ profile })`), and the fixture
   connector answers the same four sections the stand-in's tree lists for a signed-in visitor, so in development the
   header reads the same on Clew's pages and on the stand-in's.

**What the header does not take from a connector, and why.** The person and the bell are Clew's: who is signed in is
the host's to say (D87, "Who is signed in"), and the reminders are Clew's own. The site's name and the logo are the
connector's when it has them, since they are the intranet's identity; otherwise the build's. Colours stay the
installation's profile (D38): a connector that chose colours would make the page's contrast the connector's problem.
The options weighed are in [the review of the same day](../reviews/2026-11-09-header-from-a-connector.md).

**Astryx.** `TopNav`, `TopNavHeading`, `TopNavItem`, `Theme`, `Section`, `SideNav`, `SideNavSection`, `SideNavItem`,
`MobileNav`, `Dialog`, `RadioList`, `Avatar`, `Button` (icon-only). `bunx astryx component TopNav` names a "More menu"
in its anatomy but no component draws one, and `TopNav` neither wraps nor overflows its items, so the places wrap in
an `HStack` (Astryx's own layout primitive, as a slot's content), which is composition, not styling. The band is tokens
on a nested theme, Astryx's documented way to recolour a region; no component override and no CSS. The native image
of the logo stays inside D37's exception.

**Why.** A header administered inside Clew (built and removed the same day) would have made Clew the owner of the
intranet's navigation, with a second place to maintain it; the product owner's direction is that the content system
owns its sections and Clew draws what it is given, which is D4's and D21's rule for every other kind of content.
Weighed and left:

- **The header in place of the rail, as the reference has no rail.** The rail is Hem, Verktyg, Samtal and
  Administration (D50, D53, D63's artboards); the product owner chose header above, rail stays.
- **Keep the rail's heading and account row and add the header without them.** Two logos, two names and two bells.
- **A header per profile in the build (`VITE_SITE_MENU_SRC`).** D87's answer for the embed; it stands there, but it is
  a file an operator maintains, not the content system's own listing per person.
- **A public `GET /api/header`.** The header now depends on who asks (the connector lists what the person may read),
  so it is the signed-in person's; the login page keeps its card.

**Not verified and open.** Not yet looked at signed in on the development stack (the sign-in host is outside what this
session may type credentials into); the browser suite and the intranet stand-in on 3020 are the evidence. No manual
screen-reader pass. The band's blue is Vattjom, not the proof of concept's `#003c69`. No overflow menu (rows wrap).
`SiteHeader` reloads the page on "Start". The embed on the intranet keeps D87's own sources; it could read
`/api/header` only with a Clew session, so a shared header on an intranet page with a public part keeps its own
listing. A connector's header is asked on every page load (the browser keeps it for the visit); a cache in the registry
is a later step if a content system is slow. A Sitevision or SharePoint connector that writes this capability over a
real API is the next connector to build.

**Replaces.** D67 (superseded: no portal). Amends D87 item 3 (the host is the web app, not the portal; the breakpoint
is `md`; the header has three rows and a band) and item 8 (the stand-in is the web app's dev server's). Amends D37
and D39's amendment on placement: the logo, the bell and the account are in the header, and the logo may come from the
header connector. D38, D46 (as read in item 2) and the rest of D39 stand.
