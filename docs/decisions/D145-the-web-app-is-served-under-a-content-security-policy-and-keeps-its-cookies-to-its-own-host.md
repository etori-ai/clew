# D145 · The web app is served under a content security policy and keeps its cookies to its own host

**Status:** provisional (the product owner, 2026-11-23, set the order of work that fixes the review of 2026-11-23 and named the content security policy as what its fourth batch decides first, leaving the policy itself to the team; tested by nothing outside the repository yet: the headers were read from the web image's nginx on a workstation, and no installation's proxy has served them) · **Date:** 2026-11-23 · **Area:** platform, identity

**Decision.** The page that carries the whole product, and every file it loads, is served under a policy that lets
only Clew's own address run code or be reached, and no other page may frame it. What the page keeps and what a
source hands it are held to the same line.

1. **One file of headers.** `apps/web/security-headers.conf` holds them, as nginx `add_header` lines. The web image's
   nginx includes it in every location that serves the built files (`/assets/` and `/`), and an installation that
   serves the files from a proxy of its own includes the same file there (the hosting guide). The server's own
   answers under `/api/` and `/scim/` do not carry it: the front-channel logout must stay loadable in the identity
   provider's frame ([D121](D121-a-sign-in-follows-the-identity-providers-session.md)). The one page the server
   answers, the protocol's viewer at `/api/protocol`, sends a policy of its own that is as strict: scripts, connections
   and everything else from its own origin only, no inline script, styles inline for the viewer, no framing.
2. **The policy.**
   - `default-src`, `script-src`, `connect-src`, `worker-src` and `frame-src` are `'self'`: no inline script, no code
     built from a string, no script, request, worker or frame from another address.
   - `style-src 'self' 'unsafe-inline'`: Astryx writes `<style>` elements of its own while the page runs (its layers'
     rules and the like), React and Astryx set `style` attributes, and the Word preview draws into a frame that
     inherits the page's policy and writes its own `<style>` (`packages/ui/src/document.tsx`). A style cannot run code.
   - `img-src 'self' data: blob: https:`: a document's preview is `data:` or `blob:`, and the shared header's logo is
     the intranet's own https address ([D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)).
   - `font-src 'self' data:`: pdf.js, which draws a PDF's preview, loads a font the PDF embeds as a `data:` address
     where the browser's font loading API is not used. A font cannot run code.
   - `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`.
3. **The other headers.** `X-Frame-Options: DENY` for a browser that reads no `frame-ancestors`;
   `X-Content-Type-Options: nosniff`; `Referrer-Policy: same-origin`, since an address in Clew names a person, a work
   item or a question; `Strict-Transport-Security: max-age=31536000`, without `includeSubDomains`, which is the domain
   owner's decision and not Clew's.
4. **The cookies are the host's own.** Outside the local stack, the session's and the sign-in's cookies are named
   `__Host-clew-session` and `__Host-clew-login`: a browser keeps such a cookie only when this host set it, Secure,
   for every path and with no Domain, so a page on a sibling host cannot put a session or a sign-in of its own in their
   place. The local stack runs on plain http, where a prefixed cookie is not kept, and keeps the bare names.
5. **A link a source gives is http(s).** Every field in which a source hands Clew an address to link to or open
   (`SourceLinkSchema` in the contracts: a search hit, an errand, a request, a talk, an action point, a news item, an
   answer's citation, `clew.openSource`) is an absolute http(s) address, and an answer with another is out of shape.
   The page checks it again before it opens one.
6. **The suite draws every page under the policy.** The accessibility suite serves its build with the same file and
   fails a test on any violation reported by the page, a frame in it, a popup it opens or a worker it starts (from
   the moment the worker's first run is over); a spec shows the guard hearing each and failing a test. A unit test
   holds what the policy must keep and that every location of the image's nginx that is not Clew's server includes
   it. A change that loads or runs something the policy refuses
   changes the file in the same change, and widening a source is a decision, recorded here or in a record that amends
   this one.

The logo's SVG check (D98 item 5), the third lock behind serving the logo through `img` and under its own sandboxing
policy, now reads the file as XML and holds it to what a drawing needs, so a namespace prefix, a character reference
or a CSS escape no longer hides script, embedded content or a resource outside the file.

**Why.** The review of 2026-11-23 found the web image serving the page with no content security policy, no framing
rule, no `Strict-Transport-Security` and no `Referrer-Policy`, and the hosting guide's proxy example the same
(findings `ID-4` and `BL-10` in [the original review register](https://github.com/etori-ai/clew/blob/0d24b14faca255b6a0ac80e3cc7e00f5fe3335a0/docs/maintainers/open-findings.md)). A page on a sibling host
of the municipality's domain is the same site, so the `SameSite=Lax` session is sent to it in a frame, and a covered
frame can get "Godkänn" pressed: the human decision that assistant proposals and source writes rest on. Without a
policy, a script injected by any later fault runs with nothing to hold it. The same sibling could also set a
`clew-session` for the parent domain and have a person work in the attacker's session (`ID-5`), and a source could
hand Clew a link of any scheme to open (`CB-8`). The logo's check was a list of text patterns that let through what it
said it refused (`ID-6`).

Inline styles are allowed because the component system writes its own at run time, which no narrower source
allows, and a style injected without script cannot run code. Images from any https address are allowed rather than
the header's logo fetched and served by Clew: the logo is the intranet's to change, and an image cannot run code
either. An installation whose header logo is on its own origin can narrow `img-src` in its copy of the file.

**Replaces.** Nothing. Amends [D131](D131-clew-builds-a-server-image-and-a-web-image-from-the-repository-root.md) (the
web image serves the headers) and [D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)
item 5 (how the SVG check reads the file).
