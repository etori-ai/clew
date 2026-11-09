# Interface spaces and navigation

Clew gives each space a stable job. **Going to a destination changes the main page. Opening something from the current task keeps that task underneath or beside it.** A provider integration does not choose a different navigation model. A URL identifies content; having its own URL does not make that content a page.

This is the current placement reference, consolidated in [D83](../decisions/D83-interface-spaces-have-stable-navigation-roles.md). It brings together [D42](../decisions/D42-a-tool-opens-as-a-page.md), [D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md), [D66](../decisions/D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md), [D72](../decisions/D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md), the amendments to [D73](../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md), and [D81](../decisions/D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md). Earlier bodies retain their historical wording; use their amendments and this reference when placing new content.

## Where content belongs

| Space | Responsibility | Examples and behavior |
|---|---|---|
| Navigation rail | Choose a standing destination or earlier conversation. | Home, Calendar, approved tools, Administration and conversation history. A row here changes the main page and identifies the current destination. |
| Main page | The place the person is working, including its conversation. | Home's work list, Calendar, the phone book, an assistant transcript or administration. A conversation occupies the main column; it is not moved into the detail sidebar. |
| Page content | Information that belongs to the destination without being opened. | Home's cards, I dag and Sedan i går. The day may occupy a right-hand grid column, but it is page content, not a panel tab replaced by an opened record. |
| Context panel | Keep related information beside the current task. | An opened work item, source record or declared view. Native content uses the shared panel and its open-content menu; where space allows it is non-modal beside the page, otherwise it uses the existing responsive overlay. Closing returns to the opener or reveals another retained entry. |
| Focused overlay | Browse a contextual collection or complete an interaction while retaining the originating task. | Service catalogue, provider MCP Apps/notices, and a multi-row review. Use the existing end Drawer on desktop and the corresponding sheet flow on mobile. A service opened from the catalogue is one level deeper; close returns to the catalogue, then to the page. |
| Confirmation and feedback | Decide about the active interaction or report its result. | Keep the established inline confirmation for simple card actions; use a small Dialog when a separate decision is needed, such as sending an MCP App's exact arguments. It sits above its owning interaction. Receipts, banners and status announcements stay with the affected content. A toast supplements durable state; it does not replace it. |

The context panel and focused overlay are related side surfaces with different behavior: one keeps reference material available alongside work; the other temporarily takes focus. Do not give the same entry point a different role depending on the provider. Mobile changes presentation, not the navigation level or the destination reached on close. The existing native panel still uses its own responsive Drawer composition for views; this consolidation does not claim a rewrite of every native view to sheets.

## Placement and return rules

1. A standing tool selected from the rail opens its page. A record selected inside that tool opens beside or over the tool, preserving its search and filters. Only an explicit **Öppna som sida** action promotes a contextual view to an available tool page.
2. A contextual chooser, including **Alla tjänster** / **Tjänster i samtalet**, opens in an overlay over the page that launched it. It does not introduce a new main-page destination just because the chooser is a list.
3. Opening one item from a collection preserves that collection as its parent. Close and Escape dismiss the top interaction only. A source-write confirmation closes back into the App, the App into its catalogue, and the catalogue into the originating page. A card opened directly from Home returns directly to Home.
4. Keep the originating path, filters, open native context and unsent composer text. Put the selected content in the address so Back/Forward and reload can reproduce it. A cold legacy link without an origin uses Home underneath; do not guess a prior page.
5. Astryx owns stacking, focus containment and responsive surfaces. Render stacked drawers as siblings. Return focus to the actual opener; if completion removed it, use the owning collection's section or the page's service entry. Never send focus behind an open modal.
6. Opening, closing or navigating does not approve a source write. Current session, AI availability and source authorization still apply at every read/decision. Pending confirmations are cancelled when their owning interaction closes.
7. Name the selected content and provide a visible close action. Preserve the parent collection's scroll position while drilling into a service. Keep an App mounted only while its interaction is open or exiting; hidden views must not continue source calls.

A new interaction should be reviewable by naming its **origin, space, parent, close target, focus target and address**. If it cannot fit one of these roles, amend the decision before introducing another space. Do not resolve placement ad hoc inside a provider component.

## MCP catalogue and App flow

| User action | Main page | Foreground | Address example |
|---|---|---|---|
| Open All services from filtered Home | Home and `tab=waiting` stay mounted | Service catalogue Drawer/sheet | `/?tab=waiting&open-services=1` |
| Open a service from that catalogue | Same Home, catalogue retained underneath | Selected provider App or notice | `/?tab=waiting&open-services=1&open-service=example-pulse` |
| Open a delivered item directly from Home | Same Home | Only that delivery's App/notice | `/?open-service=example-pulse&open-delivery=delivery-id` |
| Close the service opened from the catalogue | Same Home | Catalogue, with focus back on its entry | `/?tab=waiting&open-services=1` |
| Close the catalogue | Same Home and filters | Page, with focus on All services | `/?tab=waiting` |

The catalogue and App are sibling Astryx overlays in one protected session, not native panel tabs. The optional confirmation is another small Dialog above the App. The catalogue remains available even when a completed delivery disappears; it does not automatically open provider HTML or submit anything. Existing `/chat/services` and `/labs/mcp` links redirect to the catalogue overlay over Home; `/chat/services/:id?delivery=…` links open that selected item over Home.

## Implementation and verification

- [Native panel and retained entries](../../apps/web/src/components/panel.tsx), [panel addresses](../../apps/web/src/panel-address.ts), [review overlay](../../apps/web/src/components/review-overlay.tsx).
- [MCP overlay stack](../../apps/web/src/labs/mcp/services-overlay.tsx), [catalogue content](../../apps/web/src/labs/mcp/service-catalogue.tsx), [App/notice and confirmation](../../apps/web/src/labs/mcp/service-overlay.tsx), [addresses](../../apps/web/src/service-address.ts), [legacy redirects](../../apps/web/src/labs/mcp/preview.tsx).
- [MCP browser scenarios](../../tests/a11y/mcp.spec.ts) exercise filters/draft retention, drill-in and focus return, history and reload, compatibility links, AI-off, completed-card removal, confirmation, 320 px reflow and axe checks. Native panel/review behavior remains covered by its existing [panel scenarios](../../tests/a11y/todo.spec.ts) and [review scenarios](../../tests/a11y/review.spec.ts).

This is a placement contract and an implemented correction to the MCP prototype. OAuth, production App hosting and normal conversation-level service enablement remain outside this change; see [MCP services](../architecture/mcp-chat-services.md). Browser checks do not substitute for a manual screen-reader pass. The user's screenshots and existing Astryx compositions supplied the visual reference; the private design canvas remains unavailable.
