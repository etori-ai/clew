# Intranet connector (fixture)

The connector of the development stack that gives Clew its shared header
([D88](../../docs/decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)). It
stands in for the content system an installation lists its sections from (Sitevision, SharePoint, WordPress): its
manifest says `header: { capability: 'intranet.header' }`, and that read answers the site's name, the places in the
band with their own pages, and optionally a logo, as data. Clew validates the answer against `SiteHeaderOutput` in
the protocol and draws it on every page for the people in the connector's audience. The fixture answers the same four sections the intranet stand-in's
Sitevision tree lists for a signed-in visitor, so the header reads the same on Clew's pages and on the intranet's;
a real connector lists what the acting person may read in the content system.

**What it answers is configuration, not code.** `menu.json` beside the connector holds the site's name, the logo and the
places with their own pages, in the protocol's `SiteHeaderOutput` shape; a place or a page with `"roles": ["manager"]`
is listed to that role only. Edit the file, or point `INTRANET_MENU_FILE` at another, and restart the service
(`sh scripts/compose.sh restart intranet` in the development stack). The logo is a path on Clew's origin
(`/branding/…`, served from `apps/web/public`) or an https address. The band's colour is not in this file: that is the
installation's saved theme (Administration › Utseende, D98), since a connector may not choose the page's colours (D88).

Run it beside Clew with the development stack (`bun run dev:connectors` registers it on port 4049), or on its own:

```bash
CLEW_CONNECTOR_SECRET=<16+ characters> node connectors/intranet/server.mjs
```

A real installation writes the same capability over its system's API (Sitevision's Model REST API, SharePoint's or
WordPress's REST API) and returns absolute addresses; see
[Create a connector](../../docs/guides/creating-a-connector.md).
