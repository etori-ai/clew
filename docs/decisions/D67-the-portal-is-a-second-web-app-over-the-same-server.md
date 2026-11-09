# D67 · The portal is a second web app over the same server, drawn as the product owner's proof of concept draws it

**Status:** superseded by [D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md) on 2026-11-09: the product owner decided that Clew has one front end, and `apps/portal` was removed; built 2026-11-06 as an experiment beside the web app; the top bar is the header shared with the intranet and Clew's places are a `SideNav` since [D87](D87-one-header-shared-by-the-portal-and-the-intranet.md) · **Date:** 2026-11-06 · **Area:** ui, product

**Decision.** The product owner's proof of concept at https://start.sundsvall.dev/portal/start (reviewed in
[the review of the same day](../reviews/2026-11-06-startsidan-poc-against-clews-core.md)) is built as `apps/portal`, a
second Vite app in the workspace, not as a mode of Hem. It runs over the same BFF through the same `/api` proxy, the
same session cookie and CSRF token, the same `@clew/ui`, `@clew/contracts` and `@clew/calendar`, and the same
components for the pieces both pages draw: the composer and "Menar du", the conversation, a thread's row, the generic
and the proposal card, I dag, Sedan i går, Redan hanterat, a declared view, the reminder bell, the login page, the
query client and the change notices. Those are imported from `apps/web/src` by relative path. The server does not
know there are two apps.

1. **What it draws.** The start page: a greeting by the hour, the box with the chips from `completions`, the figures
   from `/api/figures` as four tiles, Att agera på with Hem's rows in Hem's order (Nu, Jag föreslår, Senare, Till
   kännedom) and "Visa alla", the areas as count cards (what waits on the person, what waits on others, the area's
   figure), I dag, Sedan i går and what was handled. Mina aktiviteter at `/activities`: the counts (Att göra, Frist
   passerad, Tjänster, Hanterade), the tabs Hem has (`tab`, D53) and the area filter (`area`), and the rows. A card as
   a page at `/cards/:id`, where a read action's view opens under the card. A view as a page at `/tools/:capability`
   with `title` and `input`: a tool from the menu (D40) or a row's own view. The conversation at `/conversations/:id`,
   the route the shared provider expects. The shell is Astryx's `AppShell` with a `TopNav`: the municipal logo and
   "Startsidan", the places as items (Start, Mina aktiviteter, then the menu's views), the bell and the person at
   the end.
2. **What it leaves out, by the vision.** The intranet's sections in the top bar, the fokusnyhet, the news from
   sundsvall.se, "Anpassa startsidan", "Lämna synpunkter" and Min AI as a general assistant. They are the host's
   (the intranet, Eneo), not Clew's. The row where the sections would stand is left for the host. The errands table
   (no errands connector), the competence figures and the dialog matrix (no `figures` or `series` view kind) and the
   utvecklingsärende flow (no `form` view kind) wait for what they need.
3. **A chip asks, never decides.** The chips under the box put their words in the box. "Godkänn 4
   ledighetsansökningar" becomes a question, "Menar du" names the card, and the decision is the card's own button
   through the human decision endpoint (D45). Nothing runs from a chip.
4. **The profile is Sundsvall unless the build says otherwise.** The proof of concept is Sundsvall's page, so the
   portal's `branding.ts` defaults to the Sundsvall profile (D38); the web app keeps Neutral as its default (D46). The
   logo assets are the web app's `public` directory, served as they are (`publicDir` in the portal's Vite config).
5. **Addresses are English (D43)**: `/activities?tab=done&area=leave`, `/cards/<id>?action=<id>`,
   `/tools/<capability>?title=…&input=…`. A card is a page, not a panel beside the column: the proof of concept opens
   pages, and the two layouts are meant to be compared, not merged.
6. **How it runs.** `bun run dev:portal` starts it on port 5174 inside the devcontainer, proxying `/api` to the BFF
   as the web app does; `compose.yaml` publishes it on `127.0.0.1:3024` (the app container must be recreated once for
   the new port to be published). A sign-in made on the web app's origin holds on the portal's: the cookie is the
   host's, not the port's. The OIDC callback returns to the web app's `PUBLIC_URL`; the person then opens the portal.
   **A second front end's origin is listed, never inferred.** The CSRF check (`verifyMutation` in
   `apps/server/src/auth.ts`) compared a mutation's `Origin` with `PUBLIC_URL` alone, and the session boundary's
   first activity call is a POST, so the portal was signed out on the first click. An operator now lists the other
   front ends in `FRONTEND_ORIGINS` (comma-separated bare origins under the public origin's scheme, refused at start
   otherwise; `apps/server/src/auth-origin.ts`, `tests/unit/auth-origin.test.ts`), and a mutation is accepted from
   the public origin or a listed one, with the CSRF token still required. Sign-out (`POST /api/auth/logout`) kept
   its own check against the public origin alone until 2026-11-09, so the portal's "Logga ut" was refused; it now
   takes the same list. The product owner's purpose for the portal
   is to show that several front ends can sit on the one server, so the list is the server's rule, not the portal's
   workaround. The development stack lists `http://localhost:3024`.
7. **Checks.** `bun run typecheck` and `bun run format:check` cover `apps/portal` through the root `tsconfig.json`
   and Prettier's glob. The WCAG suite (`tests/a11y`) builds `apps/web` alone: the portal has no browser specs yet and
   is not held to D51 until it is more than an experiment, which is why this decision is proposed, not accepted.

**Astryx gaps** (recorded, not styled around): the `shell-top-nav` template caps the content width with a StyleX
style, which app code may not write, so the portal's content takes the shell's full width where the proof of concept
centres it at about 1100 px; `TopNav`'s own guidance is five items or fewer and the menu's views may push the row past
that (the proof of concept has eight), with no overflow menu composed yet.

**Why.** The product owner asked on 2026-11-06 whether Clew's core still holds under the proof of concept's design and
whether that design could be built as a separate web app on Clew's infrastructure. The review found that every work
element on the page is a view over what the server already holds, so the right experiment is the same data under
the other layout, side by side with Hem, for the product owner to compare. A mode of Hem would have to reconcile two
ideas of what the page is (a stream with the card beside it, D50/D53; a dashboard with pages behind it) and would put
the experiment's code in the product. A second app keeps `apps/web` and the server untouched and costs one Vite
configuration. The relative imports from `apps/web/src` are the honest shortcut: what both apps use belongs in a
package (`packages/web-shared` or the like), which is the next step if the portal outlives the experiment, and the
dependency cruiser does not cover `apps/web` or `apps/portal` today.

**Replaces.** Nothing. D34, D45, D50, D53 and D63 stand for Hem; the portal is beside it.
