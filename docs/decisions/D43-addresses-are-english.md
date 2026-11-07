# D43 · Addresses are English

**Status:** accepted, built 2026-11-05; an area's id, which is data and shows in `/areas/:area`, is still Swedish; the start page's addresses changed by [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) · **Date:** 2026-11-05 · **Area:** ui

**Decision.** The address bar is not interface text. Every path, query parameter, parameter value and anchor the
browser shows is English, like the identifiers in the code. Swedish stays where a person reads the product: labels,
headings, messages, page titles.

| Was | Is |
|---|---|
| `/samtal/:id` | `/conversations/:id` |
| `/oversikt` | `/overview` |
| `/oversikt#foreslar`, `/oversikt#kannedom` | `/overview#proposals`, `/overview#notices` |
| `/oversikt?kort=` | `/overview?card=` |
| `/omrade/:area` | `/areas/:area` |
| `/pagar`, `/inte-nu`, `/hanterat` | `/waiting`, `/snoozed`, `/handled` |
| `/vy/:capability?titel=&input=&omrade=` | `/views/:capability?title=&input=&area=` |
| `/vy/kort/:threadId/:actionId` | `/views/card/:threadId/:actionId` |
| `/kalender?datum=&vy=dag\|vecka\|manad` (and the older `?vecka=`) | `/calendar?date=&view=day\|week\|month` (and `?week=`) |
| `/admin/anslutningar`, `/admin/anslutningar/:id` | `/admin/connectors`, `/admin/connectors/:id` |
| `/admin/modeller`, `/admin/modeller/:id`, `/admin/modeller/leverantorer/:id` | `/admin/models`, `/admin/models/:id`, `/admin/models/providers/:id` |
| (new in D42) | `/tools/:capability?input=&open=&open-title=&open-input=&via=` |
| (new in D73) | `/cards/:threadId/review?step=` |

`/`, `/login` and `/admin` are unchanged. A collection is plural (`/conversations/:id`, `/areas/:area`, `/views/…`,
`/tools/…`); a pile is named by the state its threads are in (`waiting`, `snoozed`, `handled`), the words the code
already uses.

**What follows in the code.** The three piles are `'waiting' | 'snoozed' | 'handled'` in `start.tsx` and `nav.tsx`, so
a pile's id is its address. The calendar's view is `'day' | 'week' | 'month'`. The headings the anchors point at have
the ids `proposals` and `notices`. Nothing on the server changed: the BFF's `/api/…` routes were English already, and
no connector, card or use case builds a browser address.

**Why.** The product owner asked for it. It is also the rule the repository already had, applied where it had been
missed: Swedish only where a person reads it in the product, English for everything else. An address is read by
developers, operators, logs, tests and other municipalities' integrators far more than by the person at the screen, and
Clew is to be shared with governments that do not read Swedish. Swedish paths also could not hold their own letters
(`omrade`, `pagar`, `oversikt`), so they were not good Swedish either.

*Why no redirects from the old addresses.* Nothing is deployed, so nobody has a bookmark, and no stored row holds an
address: cards and reminders build their links in the browser. A redirect table would be kept forever for links that
do not exist. An old address now lands on the start page, as any unknown address does.

*Why the area's id is left.* `/areas/kalender` shows an area's id, and that is data: an area is declared by a connector
(`id: 'kalender'` in the calendar connector), stored on every thread (`thread.area`, default `kalender`) and named in
connector manifests. Renaming it is a contract change with a migration, not a rename of a route, and it belongs with a
decision about what an area id is.

*What else is still Swedish in the code and is not an address:* the stream's group names (`foreslar`, `kannedom`,
`behover-dig`), the page mode (`fraga`, `oversikt`), the rail's surface names, the admin pages' tab ids, the answer
shapes in the contract (`svar`, `vy`, `forslag`, `steg`) and card kinds. They are identifiers, and the working rules
already say identifiers are English; they were not changed here because the request was the addresses, and several of
them are in contracts and stored rows.

**Verified.** `bun run check`; the WCAG suite, whose every `open(...)` and `toHaveURL(...)` now uses the new addresses.

**Not built.** English area ids. The remaining Swedish identifiers listed above. Redirects, on purpose.

**Replaces.** The addresses named in D27, D28, D31, D33, D34, D36, D38, D39 (the compact header), D40 and in the
reviews of 2026-11-04: read them through the table above. D42 was written with the new ones.
