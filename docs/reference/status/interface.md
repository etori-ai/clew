# Implementation status: pages and appearance

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Theme and logo

**Works in this checkout.** An installation's colours and header logo are saved in Clew's database on Administration › Utseende (`admin.appearance`, D98) and read by every browser from the public `GET /api/appearance`, the sign-in page included; no build variable and no restart. A theme is a Design Tokens (`.tokens.json`) file of Astryx's semantic colour tokens for the light and dark appearance, or two colours the page makes one from; a file is refused, with every problem named, when it sets an unknown colour or fails the WCAG contrast pairs. The logo is a stored PNG or SVG with an accessible name; an SVG with active content is refused. Each change is audited. The embedded `<site-header>` reads the same appearance through `appearance-src`.

**Limits and pending work.** Colour only: no typography, radius or component overrides from a file. No picture of the stored logo on the page (Astryx has no image component); no colour picker. Not exercised signed in against the development identity provider, and no manual screen-reader pass. Several instances would each need to re-read the row; a browser re-reads it on every visit.

**Evidence.** [D98](../../decisions/D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md), [branding guide](../../maintainers/branding.md), [theme file](../../../packages/contracts/src/theme-file.ts), [use cases](../../../apps/server/src/modules/appearance/usecases.ts), [tests](../../../tests/unit/appearance-admin.test.ts) The same changes are made from the command line with `bun scripts/appearance-set.ts <folder> | --reset | --show`, and `themes/sundsvall/` is an example folder with a theme file and a logo.

## Shared header

**Works in this checkout.** `packages/site-header` (D87, D88): one Astryx header for the web app and the intranet, drawn above the web app's rail as a band with the logo and the site's name, the reminder bell and the person, the places under them, and the current place's own pages under the band; the intranet loads `<site-header>` (`bun run build:site-header`), rendered in a shadow root with the same theme and band. The places, their pages, the site's name and the logo come from the one connector an administrator chose with "Ger sidhuvudet" on its page among those whose manifest declares `header: { capability }` (`Governance.header`, exclusive, audited; `Registry.header`, `GET /api/header` for the signed-in person), else Clew's default with Start alone; `connectors/intranet` is the development fixture (port 4049), answering the menu, logo and site name from `connectors/intranet/menu.json` (or `INTRANET_MENU_FILE`, with an optional `roles` per place). The intranet may instead list its pages from Sitevision or WordPress through the embed's source adapters. The web app's dev server serves an intranet stand-in at `/intranat/`.

**Limits and pending work.** Not yet looked at signed in on the development stack; no screen-reader pass. The band is Vattjom, not the proof of concept's `#003c69`. No overflow menu (rows wrap). No editing of links or logo in Clew by decision: a connector owns the content, an administrator only chooses which. No Sitevision or SharePoint connector yet; no cache of a connector's header.

**Evidence.** [Package](../../../packages/site-header), [registry](../../../packages/connectors/src/index.ts), [server read](../../../apps/server/src/connectors/header.ts), [fixture](../../../connectors/intranet), [D87](../../decisions/D87-one-header-shared-by-the-portal-and-the-intranet.md), [D88](../../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md), [review](../../reviews/2026-11-09-header-from-a-connector.md), [tests](../../../tests/unit/intranet-connector.test.ts), [browser evidence](../../../tests/a11y/header.spec.ts)

## Type levels and the area mark

**Works in this checkout.** Page titles at Astryx level 1, the open card at level 2, sections at level 3, a row's title 14 px semibold over a 12 px supporting meta line (D71). Every connected system's mark has a hue from six by its registration ordinal, stored on the `connector` row (lowest free, so a removed system frees its colour) and sent in `GET /api/areas` as `systems`; Clew's own systems are an outlined house mark. `AreaChip` above the open card's title (with the source and when), `AreaLine` with the area's glyph in every row's meta line and on Klart, a card across systems with one chip and each row's system glyph and words, Anslutna system in registration order with a swatch and "2:a anslutna systemet · färg lila", the area chip on the Områden tab. The calendar family is the house (artboard 6): the week as the page's level 1, the panel as the proposal card (the outlined Kalender chip, "Kalendern · vecka 46", the one badge, the title at level 2), the grid's titles at 12 px with the time under them, meetings neutral and a proposal's ✦ on info-muted with a dashed edge as the only blue, I dag and the lists at the row level through `agendaItems()`, which also maps the day's gaps. On a phone Hem draws rows with the next step under the line and the card in a `BottomSheet`.

**Limits and pending work.** Not yet drawn with the mark: the figure tiles (D54). The phone keeps one "Visa:" menu for the tabs. No signed-in pass on the development stack or screen-reader pass yet.

**Evidence.** [D71](../../decisions/D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md), [mark](../../../packages/ui/src/mark.tsx), [marks lookup](../../../apps/web/src/marks.ts), [registry test](../../../tests/unit/system-marks.test.ts), [store contract](../../../tests/connector-store-contract.ts), [admin spec](../../../tests/a11y/admin.spec.ts)

## Initial page loading

**Works in this checkout.** Hem reserves its work, figures and side cards; calendar, tool and administration pages show skeletons and a single Astryx fade when ready. Background refreshes preserve mounted content and focus; reduced motion is respected.

**Limits and pending work.** Placeholders reserve representative space, not exact heights for arbitrary payloads. No manual screen-reader pass yet.

**Evidence.** [D76](../../decisions/D76-loading-sections-reserve-their-place-and-enter-together.md), [browser evidence](../../../tests/a11y/loading.spec.ts)

## Adding to the box

**Works in this checkout.** Pressing Lägg till i samtalet slides the drawer open, scales the chip and the button's check in and fades the verbs in, on Astryx's entry motion; the field has the focus from the same click and a hidden status says the chip's name. The column fades in when the conversation takes Hem's place and when Hem comes back. Reduced motion shows everything at once.

**Limits and pending work.** The desktop card's text button draws no check. No manual screen-reader pass yet.

**Evidence.** [D92](../../decisions/D92-what-goes-into-the-box-enters-on-astryxs-entry-motion.md), [browser evidence](../../../tests/a11y/card-actions.spec.ts)

## Sedan i går beside Hem

**Works in this checkout.** Three sentences at any count: the cards closed since midnight, newest first, at most three named and the rest as a number, a card closed more than once named once; what waits on others the same way; the next review and the sources. "Allt som är klart" leads to the Klart tab.

**Limits and pending work.** A development fixture reset closes the open fixture cards at its time and leaves closed ones' state and time alone (fixed 2026-11-06); a card the reset closed still counts as "klar". Not verified with a screen reader.

**Evidence.** [D65](../../decisions/D65-sedan-i-gar-names-a-few-cards-and-sums-the-rest.md), [sentences](../../../apps/web/src/since.ts), [unit evidence](../../../tests/unit/web-since.test.ts), [browser evidence](../../../tests/a11y/structure.spec.ts), [reset](../../../scripts/fixture-maintenance.ts)
