# A header owned by a connector: what a content system may give Clew

**Date:** 2026-11-09 · **Asked by:** the product owner ("the header links should come from an external system like
SharePoint. This will probably be part of a Sitevision connector. So we should explore how a connector could be
allowed to manage the header links, or potentially entire header. So no header admin within Clew") · **Outcome:**
[D88](../decisions/D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md) item 4.

## The question

The shared header (D87) has four kinds of content: the **identity** (logo and the site's name), the **places** (the
sections of the intranet, with each one's own pages), the **person** (who is signed in, their settings and sign-out),
and the **reminders** (Clew's bell). Which of these may a connector decide, through what, and who decides which
connector?

## Options

| Option | How | Holds | Falls short |
|---|---|---|---|
| **A. A header read capability, named in the manifest** (chosen) | `header: { capability }` names a read without input that answers `SiteHeaderOutput` (site, places with pages, optional logo). An administrator chooses the one connector that holds the header ("Ger sidhuvudet"); `Registry.header(actor)` asks that holder, as the person. | One protocol shape for Sitevision, SharePoint and WordPress; the content system lists what *this person* may read, so audience is the system's rule; the holder switch and the registry's governance (on or off, who sees it) are the only administration; the conformance check covers it like scan and figure. | One connector answers; a second is a candidate, never a fallback or a merge. The header is asked per page load (the browser keeps it for the visit). |
| B. Places as a declared view | A `list` view on a read capability, put in the header the way a view is put in the menu (D40). | Reuses the view machinery and the admin switch per capability. | A view is drawn as content, not as navigation; the header needs ids, nested pages and a logo, which a view's fields do not carry; the admin switch is exactly the per-link administration the product owner does not want. |
| C. A static menu file, built or served by the intranet | D87's `VITE_SITE_MENU_SRC` and the embed's `menu-src`. | No connector needed; the intranet already serves its public menu. | The same for every person; a file an operator maintains; nothing of the connector protocol's identity or audit; a build variable for Clew's own pages. |
| D. The connector sends the whole header as a view, person included | A `header` view kind with markup-like layout data. | Everything in one place. | Who is signed in is the host's to say (D87), the bell is Clew's, and Clew does not take layout from a connector (D21: data, never presentation). |

## What a connector may decide, in D88

- **Places and their pages**: yes, entirely, per person. The content system's own access rules are the audience.
- **The site's name and the logo**: yes, when the system has them; otherwise the build's branding (D37/D38). A logo is
  an https address or a path on Clew's origin, drawn on the band; a connector cannot ask for colours.
- **The person and the bell**: no. Clew's session and Clew's reminders.
- **Which connector**: the one an administrator chose on its page ("Ger sidhuvudet", exclusive, an audit row on the
  new and the previous holder). A connector that declares a header is a candidate until chosen; the registry reports a
  refused or failed answer and draws Clew's default, never another connector's header.

## What a Sitevision connector would do

Sitevision's Model REST API (`/rest-api/1/1/<node>/headless`, D87 item 5) lists a page's children with their paths and
absolute addresses. A Sitevision connector's `header` capability walks the start page's children one level (the
sections) and the start page's own menu (the pages under Start), as the connector's service identity or, with
delegation (D26), as the person, and returns absolute addresses on the intranet's public origin. SharePoint's and
WordPress's REST APIs give the same walk. The fixture `connectors/intranet` returns the proof of concept's places so
the header can be seen before that connector exists.

## Not settled

A cache of the header per person in the registry, if a content system is slow; whether the intranet's embed (`<site-header>`) should ask Clew for the header on pages where the visitor is
signed in to Clew, which would need a session on the intranet's page.
