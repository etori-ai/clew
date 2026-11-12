# D116 · A panel is a peek at one thing; a list is a page, and every view has an address

**Status:** provisional (product owner, 2026-11-12; accepted when a manager outside the repository has worked through a list reached from Hem and back, and one connector author has known from the guide alone where their table and their record open; no manual screen-reader pass yet); amended 2026-11-12 (product owner): a system that does not answer is said where its content is missing, not as a banner at the top of the page, which replaces [D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md)'s artboard 8 rule and the banner drawn under [D8](D08-every-action-works-without-the-model.md) for it · **Date:** 2026-11-12 · **Area:** ui

**Context.** On 2026-11-12 the product owner looked at a unit's people in a drawer over Administration › Organisation:
"should an organisation really open in a sidebar? This can get extremely crammed, an organisation might have hundreds
of employees. The sidebar needs to be for peeking or some kind of instant actions, otherwise a full route is needed."
The same day an earlier change added that as a ninth rule to
[D111](D111-where-something-opens-is-decided-by-what-it-is.md) and applied it to the organisation tree only. Looking at
the rest of the interface he added: "clicking on item should navigate in a way the user will find predictable", and
that a dedicated "Öppna som sida" as the way to get somewhere is wrong, but "if already viewed in sidebar its ok if
there is a dedicated link to open the full page for that item." He approved the model below. An audit of the web code
found the panel holding lists and tables from nine places (Hem's Läget tiles, the suggestions under the box, an
answer's "Visa allt", search hits, a work item's read, rows of a read unfolded in a work item, a tool's inspector, the
news page, and the panel's own rows, which drilled from a list into a row and back with "Tillbaka"), a table in a wide
drawer, a view without an address unless an administrator had put it in the rail, and an invoice with its PDF and up to
500 lines in the 440 px panel with no page of its own.

**Decision.** A panel, a drawer or a sheet is for a peek at one thing or for an instant action. A list, a table or a
task a person works through is a page with an address of its own. A click leads where a person would predict, and a
link to the full page inside the panel is allowed. Every view has an address.

1. **A list or a table is a page.** A read that answers with rows (a declared `table` or `list`, the search's hits, an
   undeclared answer with `rows`) is shown on its view's page, never in the panel. Everything that opens one is a link
   there: a tile of Läget, a suggestion under the box ("öppnar vyn"), an answer's "Visa allt", a search hit, a row whose
   own read is itself a list, a work item's read such as "Se i personalsystemet" on a leave request. Back returns to
   the page it was opened from with the focus on the link that opened it (`apps/web/src/way-back.ts`), and the page
   names its way back at its top as a person's page does (`from`; "Tillbaka" when Clew cannot name the place).
2. **Every view has an address.** Every read the person may call has the page `/tools/<capability>`
   (`apps/web/src/pages/tool.tsx`), whether or not an administrator placed it in the rail
   ([D40](D40-views-can-be-tools-in-the-menu-and-an-administrator-chooses-which.md), [D42](D42-a-tool-opens-as-a-page.md)): `input` is what it is
   read with, `title` the name it was opened under and `from` the way back (`apps/web/src/view-address.ts`). The rail
   marks it only when it is a placed tool; otherwise it marks the place the view was opened from, as a work item's page
   does. A read the person may not call and one that does not exist give the same "Verktyget finns inte", and neither
   is read. `GET /api/areas` lists the reads the person may open with the kind of view each declares (`views`,
   `Registry.views`, `ViewEntry` in `@clew/contracts`), and the browser decides page or peek from it.
3. **The panel holds one thing.** A work item, a calendar entry, one record or detail (a contact card, a budget, a
   piece of news, an errand), a text, a figure, or the page itself with "Fråga Clew". It no longer drills from a list
   into a row: `via` and its "Tillbaka" are gone, and a row inside the thing in the panel leads a list to its page and
   one thing into the thing's place. A record or a document, too large to read beside a page alone (an invoice with its
   PDF and its lines), is also a page (its view's page with its input), and the panel's header has "Öppna som sida" to
   it, worded and placed as a work item's link to its own page; a calendar proposal in the panel has that link to
   `/items/<threadId>` as every other work item does. The link is never the only way to do anything.
4. **Where a person already works in the list, the list keeps its companion.** Att göra's reading pane and a tool's
   inspector (a row's own read beside the table) are unchanged.
5. **Addresses from before keep working.** An address that opens a table or a list beside a page (`?open=`) is replaced
   by the view's page, with the page it lay beside as the way back; a work item's read that turns out to answer with
   rows leads to its page the same way. The wide drawer for a table (`min(1100px, 100vw)`) is gone with the last thing
   that used it.
6. **Unchanged:** the talk overlay, the reminders popover, the administration's wizards, and the review (another change
   of the same day turns it into a page under this record's rule: [D73](D73-the-review-is-a-page-in-the-shell-with-an-address.md),
   amended 2026-11-12).

**Why.** The panel is 440 px; a table there is a list with its columns folded, a list of hundreds is scrolled in a
column beside another column, and a drill from a row into a contact card and back with "Tillbaka" is a second
navigation inside the first, which neither the browser's Back nor a link to send knows. Pages give lists the width,
the address, Back and a new tab for free. Deciding by what a thing is (D111's principle) rather than by where it was
clicked keeps the rule one rule: rows are a page, one thing is a peek. The kind comes from the connector's own
declaration (D38), so nothing in a manifest chooses a surface and an author learns where their view opens from its
kind. Alternatives weighed: deciding in the panel after the read (every opener a `?open=` that the panel replaces when
rows arrive) would work without a list of views, but every opener would then name the wrong address for middle-click
and the status line; it is kept only as the way an older address and an undeclared read reach their page.

**Replaces.** In [D111](D111-where-something-opens-is-decided-by-what-it-is.md): rule 2 for a view that answers with
rows (it is a page, not beside the page); the amendment of 2026-11-12 (its ninth rule is this record's opening rule,
and the organisation tree stays its first application); answer 2's "Tillbaka in the same place"; answer 4's last two
sentences (a row's view in the card's place with "Tillbaka", and a table in the card's place); and choice 5 of the
first table ("Öppna som sida" on a view beside Hem: removed), since a record or a document in the panel now links to
its page while a list is never in the panel. In [D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md):
item 6's tool page becomes every view's page, and item 7's one panel "always about a thing" holds a view only when the
view is one thing. Rule 5 of D111 (focused work over the page) is not decided here; the talk overlay is still an open
question for the product owner.

**As built (2026-11-12).** Server: `Registry.views` in `packages/connectors/src/index.ts`, `views` on `GET /api/areas`,
`ViewEntrySchema` and `answersWithRows` in `packages/contracts/src/index.ts`. Web: `apps/web/src/view-address.ts`
(`viewPageHref`, `viewOpenHref`, `openedAsPage`, `readPageHref`), `apps/web/src/way-back.ts`, the view page in
`apps/web/src/pages/tool.tsx`, the panel in `apps/web/src/components/page-panel.tsx` and `panel.tsx` (no `via`, no
table branch, no wide drawer, "Öppna som sida" for a record or a document), a work item's rows read as a link
(`card.tsx`, `work-item.tsx`, `card-read.tsx`), Hem's openers (`start.tsx`, `composer.tsx`, `conversation.tsx`,
`thing-panel.tsx`) and the proposal's link to its page (`thread.tsx`). Tests: `apps/web/tests/view-address.test.ts`,
`apps/web/tests/panel-address.test.ts`, `tests/unit/menu.test.ts`, and the a11y specs named in the commit.

**Amended 2026-11-12: a system that does not answer is said where its content is missing.** Until this amendment a
connected system that did not answer was a full-width warning `Banner` at the top of every page, one per system
([D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md) artboard 8, under
[D8](D08-every-action-works-without-the-model.md)): "<system> svarar inte sedan HH:MM", which work items might be old,
that what is sent is queued, and "Försök igen". The product owner saw it on Kalender ("this massive notice at the top")
while Hem said "Någon källa kunde inte kontrolleras. Sparade uppgifter visas och kontrolleras igen." under "Behöver dig"
and its "I dag" block vanished without a word, and approved the replacement the same day:

1. **No banner over the page for a silent system.** The model's own banner (D8) is not this and stays.
2. **Where its content is missing.** "I dag" on Hem stays when the calendar does not answer and says "Kalendern svarar
   inte" (with since when, when the cards' statuses or the page's last read know it) and "Försök igen" in the block,
   over what it read before if anything; Kalender says the same in its own head and keeps what it has, or says that
   nothing can be shown rather than drawing an empty week. A block or a view page whose own read failed already said so
   in itself (Läget's tiles, a tool's page, a person's and a unit's sections, Personal), and keeps its words. A news
   source that fails still only leaves "Nyheter" out (D112, amended 2026-11-11).
3. **On the work items from it.** An open work item from a silent system says "kan vara gammal" at the end of its row's
   why line, in words as a reminder's wait is said there, and in its head "Kan vara gammal · Personalsystemet svarar
   inte sedan 14:32". The sentence under "Behöver dig" is gone: the rows say it. With nothing left to draw, "Behöver dig"
   says "Inväntar källornas besked." and names the system, and Att göra's empty pile does the same; a source not read
   yet keeps "Källorna kontrolleras. Sparade uppgifter visas under tiden."
4. **The queue is said when it matters.** The action dialog's last step, a `confirm` asked before an action, and a
   decision on its way that the source has not confirmed (D45, D47: "Ditt beslut är sparat …") say "Det du skickar köas
   och läses tillbaka när systemet svarar." while the item's system is silent.
5. **Said once aloud.** The first time a system is seen silent in a session it is announced once, politely, "<system>
   svarar inte" (4.1.3), whichever page or block notices it first; nothing on the page announces itself.
6. **A person with no calendar gets no warning.** When the calendar is not switched on for the person (D23) or their
   account has no calendar bound, "I dag" says "Ingen kalender är kopplad till dig." with who connects one (an
   administrator under Anslutna system, or an administrator who binds the account), Kalender says the same as its page,
   and the rail draws Kalender only while the calendar is the person's to see.

*As built.* `apps/web/src/components/silent-sources.tsx` (the statuses named, the session's one announcement, the row's
and the head's mark, the in-block notice), `today.tsx` and `start.tsx` (the day), `calendar.tsx` (the head, the empty
state), `work-row.tsx` and `work-item.tsx` (the marks), `action-dialog.tsx`, `card.tsx` and `execution-status.ts` (the
queue), `todo.tsx` and `work-items.ts` (the empty pile, `sourcesNotice`), `noCalendar` in `query-policy.ts`, and the rail in
`nav.tsx`; `source-banner.tsx` is removed. No server change: the statuses come with `/api/threads` and the person's
systems with `/api/areas`. An account with no calendar bound is told apart from a calendar that does not answer by the
calendar's own 400 sentence ("Ditt konto har ingen kalender kopplad."), as `refused` reads the registry's sentences; a
code on that answer would be sturdier. Browser scenarios in `tests/a11y/hem.spec.ts`, `calendar.spec.ts`,
`queue.spec.ts`, `action-dialog.spec.ts`, `announcements.spec.ts`, `reliability.spec.ts` and `views.spec.ts`.
