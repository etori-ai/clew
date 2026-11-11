# Review: where things open, and a proposal for one place per thing · 2026-11-11

Status: decided. The product owner answered the seven choices on 2026-11-11 and the rules are
[D107](../decisions/D107-where-something-opens-is-decided-by-what-it-is.md); choice 6 was answered with the
alternative, the list of cards beside Personal. The text below is the review as it was written, before the answers.
The inventory in the second half is a reading of the working tree on 2026-11-11, not of a running application, and
describes the code before D107 was built.

## Why

On 2026-11-11 the product owner followed four ordinary links on Personal and each one surprised them:

1. "1 att agera på" led to Hem with the card already in the question box: the list was gone, and a link that counts
   what waits had started the work instead of showing it.
2. A name opened the person beside the list, with "Öppna som sida" as a link inside the panel: "a bit reversed".
3. A menu choice "Visa bredvid", added the same hour to keep the panel reachable, was "dumb": either the panel is the
   one way to show a person or it goes; a menu must not hold a choice of where Clew shows something.
4. A card under "Behöver dig" on the person's page led to Hem again.

Their conclusion: the flows are not defined well enough for an end user to predict, nor for someone who builds a
connector. [Interface spaces](../reference/interface-spaces.md) (D83) is the placement contract, and an earlier attempt
at this "has not landed enough". This review is the inventory they asked for and a proposal to react to. It is drawn
on the canvas "Clew navigation map" ([design canvases](../reference/design-canvases.md)): where things open today,
the proposed rules, and what a connector author can count on.

## What was changed before the review

These were made in the same session, one complaint at a time, before the owner asked for the review. They are in the
code and its specs; the rest of this page starts from them.

- "1 att agera på" and "1 förslag" on Personal open the card beside the list (`/staff?card=<threadId>`), and a card
  under the opened person's "Behöver dig" opens over the person (`/staff?person=<key>&card=<threadId>`). The card is
  drawn by `apps/web/src/components/card-panel.tsx` (`useCardFrame`), which any page can use.
- A name on Personal leads to the person's page. "Visa bredvid" was added and removed. The person is still drawn
  beside the list where "Just nu" counts several cards, and by address.
- Personal's panel stands on the window's edge: the page width is set on the list's column, not on the layout that
  holds the panel.
- On Hem an address with `open-card` and `open-action` asks the server only for a read. Before, an address that named
  an execute made the decision when the page loaded, with no button pressed and no confirm asked.
- "Lägg till i samtalet" on a page without a question box leads to Hem with the chip in the box, since a chip added
  where nothing shows it left the focus on nothing.

## What the inventory shows

- **Hem is the only page that can hold everything.** Only Hem's panel holds cards, views, a card's read and the
  review. Every other page either has no panel (a person, a unit, the calendar), a panel for one kind of thing (a
  tool's row, Personal's person or card), or sends the person to Hem.
- **Seven kinds of control end on Hem from another page**, and all but one arrive with the card in the question box
  as "Om kortet": an action about a person (five controls), "Behöver dig" on a person's and a unit's page, "Granska
  N" from a card beside Personal or in a conversation, "Lägg till i samtalet" where the page has no box, and a card
  from the bell, a toast or the rail's search.
- **The same thing opens differently by where it was clicked.** A card: beside Hem, inside an answer, beside
  Personal, or a jump to Hem. A row's own view (`view.open`): a link on Hem and a tool page, inert in a card's read
  beside Personal and on a person's page. "Öppna samtalet": a drawer that keeps the lens from the row menu, drops the
  lens and the person from the opened person, and leaves the page from a person's page.
- **Two controls choose a surface instead of doing something**: "Öppna som sida" on a view beside Hem and on the
  person beside the list. "Visa bredvid" was a third.
- **The phone changes more than presentation.** A card on Hem is a bottom sheet and is not put in the box; the same
  card on Personal is a drawer; the person's drawer has no "Öppna som sida".
- **A connector author is told almost nothing about placement.** The guides say a view is drawn "in a panel, below an
  answer and, if selected by an administrator, on a tool page". `target` and `confirm` on a card action are described
  only in the schema. An action about a person "becomes the person's card" and nothing says it leaves the page for
  Hem. An action about a unit is accepted and shown nowhere. The area documentation describes `/areas/<id>`, a button
  under the box and "Gör själv", none of which exist.

## Proposal: one place per thing

Where something opens is decided by what it is, never by the page it was clicked on.

1. **Only choosing a place changes the page.** The rail, and a name that leads to a person or a unit.
2. **What is opened from a page opens beside that page.** Every page has the panel, not only Hem. A card from the
   bell, a toast or search opens beside the page the person is on. Closing puts the page back exactly as it was. In a
   narrow window the panel is drawn over the page, on a phone as a sheet: the same thing, the same way back.
3. **A person and a unit are pages, shown one way.** Cards about them open beside their page. No person beside a
   list.
4. **Starting something never moves the person.** An action about a person makes a card, and the card opens beside
   the page where it was started.
5. **Focused work lies over the page it was started on.** "Granska N" from a card beside Personal stays over Personal
   and closes back to that card; one person's utvecklingssamtal opens over whichever page it was opened from.
6. **Opening is not asking.** A card goes into the question box only with "Lägg till i samtalet", which is offered
   only where the page has a box. Asking opens the conversation with what the person was looking at beside it, and
   closing it returns them.
7. **No control chooses a surface.** No "Öppna som sida", no "Visa bredvid". The window's width decides how the panel
   is drawn, never where the person ends up.
8. **Out of Clew is a new tab, every time, and marked as leaving.**

For a connector author the rules collapse to one table, with no column for "depends on the page": a read's view and a
card open beside the page; a row's own view takes the list's place there; a name leads to the person's or unit's
page; a card's read lies over the card; a decision runs on the card; a review lies over the page; an entity read is a
section of the entity's page; an entity action makes a card beside the page; a link out is a new tab. The third board
of the canvas is that table with what differs today.

## What the proposal would change in the code

In the order that removes the most surprise first. Each is a fix to existing surface, not a new one (D101), but items
1 and 5 move code that many specs cover, and the freeze is the owner's to read.

1. Make the panel the shell's. Hem's wiring in `apps/web/src/pages/start.tsx` (card, a card's read, a view, the open
   things as tabs) becomes one hook every page uses; `useCardFrame` is its start. Person and unit pages get the panel.
2. Open cards where the person is: `apps/web/src/entity-actions.ts` (an action's new card), `CardList`'s default in
   `apps/web/src/components/entity-sections.tsx`, the bell (`reminders.tsx`), the toasts (`shell.tsx`) and the rail's
   search (`nav.tsx`) stop leading to `/?card=`.
3. Take the person out of the panel: `?person=`, the compact list, the phone's section drill-in and "Öppna som sida"
   in `person-panel.tsx` go. "Just nu" with several cards needs a destination (a choice below).
4. Stop putting an opened card in the question box (`about` in `start.tsx`, `composer.tsx`), and offer "Lägg till i
   samtalet" only where a box exists; the jump in `conversation-context.tsx` then goes.
5. Let the review and the talk lie over any page: `/cards/<id>/review` and `/staff?talk=` become parameters of the
   page they were opened on, and closing returns to it with its lens, tab and open card.
6. Remove "Öppna som sida" from a view beside Hem (`start.tsx`).
7. Make a row's own view a link wherever a row is drawn (`card-panel.tsx`, the person's page).
8. Show an action about a unit on the unit's page, or refuse it when the connector is registered.
9. One overlay per kind on a phone.
10. Write the author's page "where it opens" from the canvas's third board; document `target` and `confirm`; correct
    the area documentation in `packages/connectors/src/protocol.ts` and regenerate the manifest reference; mark links
    out of Clew.

The placement table in [interface spaces](../reference/interface-spaces.md) and D83, D97 item 5, D50 (the box asks
about the open card), D42 ("Öppna som sida") and D73 (the review over Hem) would each be amended in the change that
builds the item they describe.

## Choices that are the product owner's

| # | Choice | Proposed |
|---|---|---|
| 1 | Is a person shown as a page only, or beside a list only? | A page only: a person has sections, actions and cards of their own, which is a place, and cards then open beside it. |
| 2 | Does every page get the panel, so that a card from the bell, a toast or search opens beside the page the person is on and not on Hem? | Yes. |
| 3 | Does opening a card on Hem stop putting it in the question box as "Om kortet"? It reverses a part of D50. | Yes: the first complaint was that a link started the work. |
| 4 | "Lägg till i samtalet" where the page has no box: hide it there, or give every page a box? | Hide it there. |
| 5 | Does "Öppna som sida" on a view beside Hem go? The tool is still in the rail when an administrator put it there. | Yes. |
| 6 | Where does "N att agera på" lead when it counts several cards and a person is not beside the list? | The person's page at "Behöver dig", where each card opens beside the page. The alternative is the list of those cards beside Personal. |
| 7 | Is this work inside the freeze on new surface (D101)? | It restructures what exists; the owner's word is needed for items 1 and 5. |

## The inventory

Made by a read-only pass over the working tree on 2026-11-11: every `href`, `navigate`, link, menu row and overlay
under `apps/web/src`, and every field of the connector protocol that leads to navigation. Nothing was run. It was
taken while "Visa bredvid" was still in the row menu on Personal; that choice was removed the same day, so the rows
that name it describe a control that no longer exists, and the person is opened beside the list only by "Just nu"
with several cards, by the compact list and by address. Row 1 of "Docs versus code" was corrected in the same change.

Read-only; nothing was edited, run or tested. Paths are repo-relative; `web/` = `apps/web/src/`. Items I could not settle from code are marked **not verified**.

### Conventions used in the tables

Panel thresholds come from `web/components/panel.tsx:359-370` (rail 256 + the page's least width + panel width) and each page's `usePanel` call.

| Short name | Meaning | Source |
|---|---|---|
| **P-Hem** | Hem's panel: beside the column from 1336 px wide and above 480 px high; otherwise an end Drawer (440 px; up to 1100 px for a table view) over Hem. A **card** on a phone (<768 px, no conversation open) is a tall BottomSheet instead. Keeps several things as tabs ("N öppna bredvid"). | `web/pages/start.tsx:105,436,449-451,994-999,1004-1039` |
| **P-Conv** | Same panel beside a transcript from 1296 px; else Drawer (also for cards on a phone). | `web/pages/start.tsx:164,995` |
| **P-Tool** | Panel beside a tool page from 1296 px (1756 px when the tool is a table); else Drawer. | `web/pages/tool.tsx:172` |
| **P-Pers** | Personal's panel, 560 px, beside the list from 1256 px; else Drawer, also on phones (never a BottomSheet). One thing at a time, no tabs. | `web/components/person-panel.tsx:87-89,383` |

**Composer attachment rule.** Any arrival at `/?card=<id>` at 768 px or wider puts the card in Hem's box as the token "Om kortet" with the placeholder "Fråga om kortet …" (`web/pages/start.tsx:938-939,1041-1048`; `web/components/composer.tsx:247-248,265-271,291-299`). On a phone the card is in the sheet and the box gets nothing. "Lägg till i samtalet" adds an explicit chip instead (`web/components/conversation-context.tsx:236-244`). Only Hem, a conversation and a tool page have a box (`start.tsx:884,1115,1131,1166`; `tool.tsx:182`).

Closing a panel layer pushes a new history entry (`navigate(withoutPanel(...))`), so Back reopens it. `replace` is used only for view search input, review steps, review close, talk close and the auto-reveal of the next tab.

---

## Part 1: inventory

### 1.1 Rail, header, bell, toasts (on every page)

| Control | file:line | Opens | Space | Address | Origin stays? Back/close | Attaches to box |
|---|---|---|---|---|---|---|
| Rail "Ny fråga" | `web/components/nav.tsx:149` | Hem | main page | `/` | no; Back | no |
| Rail search "Sök i samtal och kort": conversation hit | `nav.tsx:112-116,163-166` | conversation | main page (Hem's column) | `/conversations/<id>` | no | no |
| Rail search: card hit ("Kort · källa") | `nav.tsx:117-121` | card | Hem + P-Hem | `/?card=<id>` | no (leaves any page for Hem) | yes |
| Rail search: area hit ("Område") | `nav.tsx:122-126` | Hem filtered | main page | `/?area=<id>` | no | no |
| Rail search: tool hit ("Verktyg · källa") | `nav.tsx:127-131` | tool page | main page | `/tools/<capability>` | no | no |
| Rail "Hem" | `nav.tsx:173-177` | Hem | main page | `/` | no | no |
| Rail "Kalender" | `nav.tsx:191` | calendar | main page | `/calendar` | no | no |
| Rail "Personal" (managers) | `nav.tsx:193-200` | Personal | main page | `/staff` | no | no |
| Rail tool rows, "Fler verktyg" | `nav.tsx:135-143,201-210` | tool page | main page | `/tools/<capability>` | no | no |
| Rail "Samtal" rows (latest 5) | `nav.tsx:214-226` | conversation | main page | `/conversations/<id>` | no; "Stäng samtalet" then leads to `/`, not the page it was opened from (`conversation-context.tsx:151,159-163`) | no |
| Rail "Alla samtal" | `nav.tsx:145` | Hem, tab Klart | main page | `/?tab=done` | no | no |
| Rail "Administration" rows | `nav.tsx:232-254` | admin pages | main page | `/admin/...` | no | no |
| Header: site name, places, sub-pages (connector-provided) | `packages/site-header/src/site-header.tsx:15-25,122,198,216` | Clew path or external site | whole-page load, same tab | as given by the connector | no; browser Back | no |
| Header places on a phone ("Huvudmeny" rows in the rail drawer) | `web/components/shell.tsx:192-197` | same | client-side for Clew paths, plain anchor for http | same | no | no |
| Bell "Påminnelser" | `web/components/reminders.tsx:51-60` | reminder list | Popover; BottomSheet on a touch phone | none | yes | no |
| Bell row (a reminder) | `reminders.tsx:120` | card | Hem + P-Hem | `/?card=<id>` | no, from any page | yes |
| Bell "Öppna Hem" | `reminders.tsx:127` | Hem | main page | `/` | no | no |
| Toast "Påminnelse: …" / "Nya uppgifter finns på Hem." → "Visa" | `shell.tsx:115-129` | card | Hem + P-Hem | `/?card=<id>` | no, from any page | yes |
| Person menu: sign out, appearance | `shell.tsx:170-175` | sign-out | leaves the app | — | — | no |

### 1.2 Hem (`/`)

| Control | file:line | Opens | Space | Address | Origin stays? Back/close | Attaches |
|---|---|---|---|---|---|---|
| Tabs "Behöver dig / Väntar på andra / Inte nu / Klart" (menu "Visa: …" on a phone) | `web/pages/start.tsx:705-733` | same page, other rows | page content | `/?tab=waiting\|snoozed\|done` | yes | no |
| Area filter "Alla områden" / "Område: …" | `start.tsx:736-759` | same page filtered | page content | `/?area=<id>` | yes | no |
| Lugnt läge: "N väntar på andra", "N klara i dag" | `start.tsx:561,566` | tab | page content | `/?tab=waiting`, `/?tab=done` | yes | no |
| Row title (any group) | `start.tsx:501`; `web/components/card.tsx:1317` | card | P-Hem | `/?card=<id>` (keeps tab/area) | yes; ✕, Esc, row's "Stäng kortet" | yes (not phone) |
| Phone sheet "Hem" / "Stäng kortet" | `start.tsx:1032-1033` | closes the card | — | `/` | — | — |
| Card action, read, `target` panel or absent | `card.tsx:483-494`; `start.tsx:447` | the card's own read | P-Hem, over the card | `…&card=<id>&open-card=<id>&open-action=<aid>` | yes; ✕ leaves the card | no (token gone while the read is on top) |
| Card action, read, `target: 'link'` | `card.tsx:484-490` | source URL | new browser tab | external | yes | no |
| Card read whose output holds `url` (no `target`) | `start.tsx:362-363,399` | source URL | new tab; nothing drawn in the panel | address still has `open-card` | yes | no |
| Card action execute/propose | `card.tsx:496-506` | runs in place | none | none | yes | no |
| Action with `confirm` | `card.tsx:461-474,481` | question | AlertDialog ("Avbryt" + action label) | none | yes | no |
| "Granska N" | `card.tsx:695-702`; `web/review-address.ts:6` | review, one row at a time | Drawer 1040 px over Hem; tall BottomSheet over the card's sheet on a phone (`web/components/review-overlay.tsx:285-306`) | `/cards/<id>/review?step=n` | yes (Hem and the card stay under it); close → `/?card=<id>` with `replace` (`review-overlay.tsx:54,154,182`) | yes after close |
| "Visa granskning" (sent card) | `card.tsx:761-764` | read-only review | same | same | same | same |
| "Inte nu" / "Påminn mig" picker; "Skriv själv …" | `card.tsx:386-403,319-354` | time choice | DropdownMenu (sheet on phone); Dialog "När ska jag ta upp det igen?" | none | yes | no |
| "Lägg till i samtalet" (row, card, ⋯ menu) | `card.tsx:715-727,797-803`; `web/components/thread.tsx:147-151` | chip | composer drawer | none | yes | yes (chip) |
| Card row label naming a person/unit (`subject`) | `card.tsx:934-942` | person or unit | main page | `/people/<key>?from=<here>` or `/units/<id>?from=<here>` | no; breadcrumb back to Hem with the card still in the address | no |
| Done card: "Nästa som behöver dig" → "Öppna" | `card.tsx:1118-1129`; `start.tsx:453-456` | next card | P-Hem | `/?card=<next>` | yes | yes |
| Avfärda / Inte nu toast "Ångra" | `card.tsx:102-122` | undo | toast | none | yes | no |
| Receipt toast "Visa" | `web/components/receipt-notice.tsx:36-41` | card under its tab | P-Hem | `/?tab=<done\|waiting\|needs-you>&card=<id>` | raised on Hem; if still up on another page it leads to Hem | yes |
| Proposal card "Justera i kalendern" / "Visa i veckan" | `thread.tsx:384-385` | calendar week | main page | `/calendar?date=<week>&view=week` | no | no |
| "Mina ärenden" row | `web/components/my-errands.tsx:59-70`; `start.tsx:619` | the errand's read, in its own system | P-Hem | `/?open=<cap>&open-title=…&open-input=…` | yes | no |
| "Visa alla N ärenden" | `my-errands.tsx:72-76` | more rows | in place | none | yes | no |
| "Mina åtgärdspunkter": person name | `web/components/my-commitments.tsx:153` | person | main page | `/people/<userName>?from=<here>` | no; breadcrumb | no |
| "Mina åtgärdspunkter": row text (read-only system) | `my-commitments.tsx:209-212` | other system | new tab (`isExternalLink`) | external | yes | no |
| "Läget på <enhet>" (unit name) | `web/components/lage.tsx:45-53` | unit | main page | `/units/<id>?from=<here>` | no; breadcrumb | no |
| Läget tile with `opens` | `lage.tsx:63-67`; `start.tsx:632` | declared view | P-Hem | `/?open=<cap>&open-title=<title>` | yes | no |
| I dag "Hela veckan" | `web/components/today.tsx:44` | calendar | main page | `/calendar` | no | no |
| I dag "underlaget ligger i samtalet" | `today.tsx:91` | conversation | main page (column) | `/conversations/<id>` | no | no |
| I dag "från kortet …" | `today.tsx:99` | card | P-Hem | `/?card=<id>` | yes | yes |
| Sedan i går "Allt som är klart" | `web/components/since.tsx:57` | tab Klart | page content | `/?tab=done` | yes | no |
| Klart row: a question | `web/components/handled.tsx:104-106` | conversation | column | `/conversations/<id>` | Hem's column replaced | no |
| Klart row: reviewed card | `handled.tsx:107-108` | review | Drawer/BottomSheet | `/cards/<id>/review` | yes; close → `/?card=<id>` (tab lost) | yes after close |
| Klart row: other card | `handled.tsx:109` | card | P-Hem | `/?tab=done&card=<id>` | yes | yes |
| "Menar du": matching card | `composer.tsx:410-415` | card | P-Hem | `/?card=<id>` | yes | yes |
| "Menar du": standing action / question | `composer.tsx:416-431` | asks it | conversation in the column | then `/conversations/<id>` | Hem replaced | — |
| "Menar du": "Fortsätt samtalet · …" | `composer.tsx:432-439` | conversation | column | `/conversations/<id>` | Hem replaced | no |
| Sending a question; verb buttons ("Om kortet") | `composer.tsx:279,346-355`; `conversation-context.tsx:324-361,153-158` | conversation | column, in place, then address | `/conversations/<id>` plus `?card=` from 1296 px | Hem replaced; "Stäng samtalet"/Esc → Hem as it stood when asked about a card, else `/` | card rides along beside the transcript |
| "Ny fråga i stället" (card open) / chip ✕ | `composer.tsx:297,338-339` | closes the card | — | Hem without `card` | yes | removes token |
| Banner "Försök igen" | `start.tsx:1205-1210` | refetch | none | none | yes | no |

#### In Hem's panel (a view or a card's read)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| Row name with `view.open` | `web/components/view.tsx:421-427,451-461`; `start.tsx:977` | the row's own read | P-Hem, replaces the view | `…open=<cap2>&via=1` | "Tillbaka" = history back (`panel.tsx:233-237`; `start.tsx:978`) | no |
| Row/record name with `view.subject` | `view.tsx:430-461,672-692` | person or unit | main page | `/people/…` or `/units/…` with `from` | breadcrumb | no |
| Row with both: "Öppna <namn>" / column "Person"/"Enhet" | `view.tsx:437-450,501-510` | entity | main page | same | breadcrumb | no |
| Row `@` "Lägg till i samtalet" | `view.tsx:463-472` | chip | composer | none | — | yes (chip) |
| Field `format: link` / `phone` / `email` | `view.tsx:224-249` | URL / dialler / mail | new tab (link); `tel:`, `mailto:` | external | — | no |
| View search field and choice | `view.tsx:314-397`; `start.tsx:968-976` | same view re-read | in place | `open-input=` rewritten with `replace` | Back leaves the view in one step | no |
| "Öppna som sida" (only when the view is in the person's menu) | `start.tsx:940,951-958` | tool page | main page | `/tools/<cap>?input=…` | no | no |
| Search hit: title with `subject` | `panel.tsx:130-136` | entity | main page | with `from` | breadcrumb | no |
| Search hit: view button (its `open.title`) | `panel.tsx:161-163` | the hit's read | P-Hem (`via`) | `open=…&via=1` | "Tillbaka" | no |
| Search hit: "Öppna" / "Öppna i <källa>" | `panel.tsx:164-172` | source | new tab | external | — | no |
| Search hit `@` | `panel.tsx:173-176` | chip | composer | none | — | yes |
| Day/week strip entry (calendar reads) | `panel.tsx:249-286`; `start.tsx:967,1222-1235` | meeting | Dialog over the panel | none | closes to the panel | no |
| Tab menu "N öppna bredvid", "Stäng alla (N)", ✕ "Stäng …", fold "Fäll ihop/Visa panelen" | `panel.tsx:629-666,494-506,780-786` | another open thing / closes | same panel | that thing's query; next tab with `replace` | — | follows the card in the address |
| Document view "Hämta originalet" | `web/components/document-reader.tsx:60-73` | original file | download via `/api/…` | — | — | no |
| Record `recovery` source link | `web/components/review-recovery.tsx:153` | source | new tab | external | — | no |

### 1.3 Conversation (`/conversations/:id`)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| "Visa allt" (embed header / button), "Visa <vy>" | `web/components/conversation.tsx:168,280,285-289`; `start.tsx:411` | the answer's view | P-Conv | `/conversations/<id>?open=<cap>…` | ✕ | no |
| Embedded view row with `open` | `conversation.tsx:173-179`; `start.tsx:1104` | row's read | P-Conv (`via`) | `…open=…&via=1` | "Tillbaka" | no |
| Card inside an answer: all card controls | `conversation.tsx:268-270`; `start.tsx:1103` | as on Hem; the read → P-Conv | — | `…open-card&open-action` | — | — |
| "Granska N" on a card in an answer | `card.tsx:701` | review | Drawer over **Hem** | `/cards/<id>/review` | conversation is left; close → `/?card=<id>`; Back → conversation | yes after close |
| Citation `[n]` with `link` | `conversation.tsx:86-87,258-266` | source | **not verified** (Astryx Markdown) | external | — | no |
| "Lägg under Behöver dig" | `conversation.tsx:291-297`; `conversation-context.tsx:445-466` | creates a card | none (system message) | none | — | no |
| Follow-up buttons ("Följdfrågor") | `conversation.tsx:413-418` | asks | same conversation | none | — | — |
| "Gör det"/"Gör båda", "Avbryt", "Ångra" | `conversation.tsx:387-409` | acts in place | none | none | — | no |
| "Stäng samtalet", Esc | `start.tsx:1070-1093`; `conversation-context.tsx:217-224,159-163,308-313` | closes | main page | the page it was asked on, else `/` | — | — |
| "Nytt samtal" (phone ⋯), "Ny fråga i stället", ⌘K | `start.tsx:1081`; `composer.tsx:328-337`; `conversation-context.tsx:253-263,302-307` | new conversation | Hem | `/` | — | no |

### 1.4 Tool page (`/tools/:capability`)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| Row name with `view.open` | `web/pages/tool.tsx:230` | row's read | P-Tool | `/tools/<cap>?input=…&open=<cap2>&open-title=…&open-input=…` | ✕ → the tool with its search (`tool.tsx:143`) | no |
| A row in that opened view with its own `open` | `tool.tsx:165-166` | next read | P-Tool (`via`) | `…&via=1` | "Tillbaka" | no |
| Row name with `subject` | `view.tsx:430-461` | entity | main page | `/people/…?from=/tools/<cap>…` | breadcrumb names the tool (`web/person-address.ts:66-84`) | no |
| Search field / choice | `tool.tsx:229` | re-read | in place | `input=` with `replace` | — | no |
| Row `@` | `view.tsx:463-472` | chip | this page's box | none | stays (box exists) | yes (chip) |
| Box at the foot: sending a question | `tool.tsx:175-182`; `conversation-context.tsx:356-361` | conversation | main page (column) | `/conversations/new?open=…` → `/conversations/<id>?open=…` (view beside from 1296 px, else a chip only) | tool replaced; "Stäng samtalet" → the tool as it stood | view rides along |
| "Till startsidan" (missing tool) | `tool.tsx:204` | Hem | main page | `/` | — | no |

### 1.5 Personal (`/staff`)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| "Visa: Alla" / a lens | `web/pages/staff-parts.tsx:79-123`; `web/pages/staff.tsx:109-115` | the list through a lens | page content | `/staff?show=<cap>` | yes | no |
| A person's name (table and phone row) | `staff-parts.tsx:195-207,324-330` | person | **main page** | `/people/<key>?from=/staff?show=…` | no; breadcrumb "Personal" | no |
| Row menu "Visa bredvid" (not on phones) | `staff-parts.tsx:162,410,500` | person | P-Pers | `/staff?show=…&person=<key>` | yes, list drawn compact; ✕/Esc | no |
| Compact list row (panel open) | `staff-parts.tsx:561-570` | another person | P-Pers, replaces | `?person=<key2>` | yes | no |
| "Just nu": "1 att agera på", "1 förslag" (one card) | `staff-parts.tsx:177-193`; `web/components/card-panel.tsx:108-133` | card | P-Pers | `/staff?show=…&card=<id>` | yes; ✕ → list | no box on the page |
| "Just nu": "N att agera på", "N förslag" (several) | `staff-parts.tsx:182-187` | the person | P-Pers | `?person=<key>` | yes | no |
| Row menu: an action (per system) | `staff-parts.tsx:151-156`; `web/entity-actions.ts:54-71` | a new card | **Hem** + P-Hem | `/?card=<id>` | no; Back → Personal with lens and person | yes |
| Row menu: source page ("Öppna samtalet") | `staff-parts.tsx:157-160`; `web/pages/staff-model.ts:232-247` | talk | Drawer / tall BottomSheet over Personal (`web/components/talk-overlay.tsx:180-200`) | `/staff?show=…&talk=<personId>` (lens kept) | yes; close → same address without `talk` (`replace`) | no |
| "Till startsidan" (empty list) | `staff.tsx:184` | Hem | main page | `/` | — | no |

#### Inside the opened person (P-Pers)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| Action buttons (first two), "Fler", phone "Åtgärder" | `web/components/person-panel.tsx:97-162` | a new card | **Hem** + P-Hem | `/?card=<id>` | no; Back → Personal | yes |
| "Öppna som sida" (not on phones) | `person-panel.tsx:148-152,347` | person page | main page | `/people/<key>?from=<list>` | breadcrumb | no |
| Unit under the name | `web/components/entity-sections.tsx:84-88`; `person-panel.tsx:326` | unit | main page | `/units/<id>?from=/staff?…person=<key>` | breadcrumb back to Personal with the person open | no |
| "Behöver dig": a card title | `entity-sections.tsx:400-427`; `person-panel.tsx:304` | card | P-Pers, over the person | `/staff?person=<key>&card=<id>` | ✕ → the person | no |
| Section way in by the read's `open.title` | `entity-sections.tsx:445-457`; `person-panel.tsx:340,348` | the source's fuller view | main page (person page, that section) | `/people/<key>?section=<cap>&from=<list>` | breadcrumb | no |
| Section way in by a source page ("Öppna samtalet") | `entity-sections.tsx:215-219,446-447,493-498` | talk | Drawer over Personal | `/staff?talk=<id>`: **`person` and `show` are dropped** | person panel closes; drawer close → `/staff` | no |
| Phone: a section row; "Tillbaka"; "‹ Personal" | `person-panel.tsx:241-249,265,313-321,339` | one section in the same drawer | Drawer | `…&person-section=<cap\|needs-you>` | "Tillbaka" → section list | no |
| ✕ / Esc | `person-panel.tsx:301` | closes | — | list address | focus to the row's name | — |

#### Inside a card on Personal (P-Pers, `card-panel.tsx`)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| Read action (panel) | `card-panel.tsx:71-83` | card's read | P-Pers over the card | `…&card=<id>&open-card=<id>&open-action=<aid>` | ✕ → the card. Rows in that read are **not** links (no `hrefFor`, `card-panel.tsx:31-32,81`) | no |
| Read action `target: 'link'` / output `url` | `card.tsx:484-490`; `card-panel.tsx:57-65` | source | new tab | external | — | no |
| Execute / confirm | `card.tsx:461-506` | in place / AlertDialog | — | none | list and person counts re-read (`staff.tsx:72-79`) | no |
| "Granska N", "Visa granskning" | `card.tsx:701,763` | review | Drawer over **Hem** | `/cards/<id>/review` | Personal is left; close → `/?card=<id>`; Back → Personal | yes after close |
| "Lägg till i samtalet" | `card.tsx:715-727`; `conversation-context.tsx:233-241` | chip | **Hem** | `/` (the card is not in the address) | Personal is left | yes (chip) |
| Row label with `subject` | `card.tsx:934-942` | entity | main page | with `from=/staff?…card=…` | breadcrumb | no |
| Proposal card "Visa i veckan" | `thread.tsx:385`; `card-panel.tsx:120-121` | calendar | main page | `/calendar?…` | Personal is left | no |
| No "Nästa som behöver dig" here (no `next` passed) | `card-panel.tsx:123-130` | — | — | — | — | — |

### 1.6 Person page (`/people/:key`) and unit page (`/units/:id`)

| Control | file:line | Opens | Space | Address | Back/close | Attaches |
|---|---|---|---|---|---|---|
| Trail "Du är här" (only when `from` names Hem, Kalender, Personal or a tool) | `web/pages/person.tsx:164,180,310-315`; `web/pages/unit.tsx:198-203` | the origin page | main page | the `from` address | — | no |
| Section list rows ("Om <namn>") | `person.tsx:186,232`; `entity-sections.tsx:581-652` | that section | page content (drill-in under 768 px, "Tillbaka till Om <namn>" `person.tsx:266-285`) | `/people/<key>?section=<cap\|needs-you>&from=…` | yes | no |
| Header actions (two buttons, "Fler", phone "Åtgärder"); a section's own action buttons | `person.tsx:95-97,247`; `entity-actions.ts:64` | a new card | **Hem** + P-Hem | `/?card=<id>` | page left; Back | yes |
| "Behöver dig" card title (person and unit page) | `person.tsx:140`; `unit.tsx:179`; `entity-sections.tsx:395,413` | card | **Hem** + P-Hem | `/?card=<id>` | page left; Back | yes |
| Source page link in a section ("Öppna samtalet") | `person.tsx:74,98-102` | talk | **Personal** + Drawer | `/staff?talk=<id>` | page left; drawer close → `/staff` | no |
| Unit page: "Visa i Personal" (talks' way in) | `unit.tsx:182`; `apps/server/src/modules/talks/capabilities.ts:237` | Personal through the lens | main page | `/staff?show=talks.person` | page left | no |
| Unit page: "Öppna Personal" | `unit.tsx:68` | Personal | main page | `/staff` | page left | no |
| Unit under the person's name | `person.tsx:252-256` | unit | main page | `/units/<id>?from=/people/<key>…` | breadcrumb only if Clew can name the origin; a person page is not nameable (`person-address.ts:57-64`), so **no trail** | no |
| Row `@` in a section's fuller view | `view.tsx:463-472`; `person.tsx:124`; `conversation-context.tsx:241` | chip | **Hem** | `/` | page left | yes (chip) |
| Rows of the fuller view | `entity-sections.tsx:266-272` | not links (no `hrefFor`); a `subject` still links to the entity | — | — | — | — |
| "Till startsidan" (missing) | `person.tsx:206`; `unit.tsx:141` | Hem | main page | `/` | — | no |

The unit page draws no actions at all: `detail.actions` is never read in `unit.tsx`.

### 1.7 Calendar (`/calendar`)

| Control | file:line | Opens | Space | Address | Attaches |
|---|---|---|---|---|---|
| Step, "I dag", date picker, "Vy" (Dag/Vecka/Månad) | `web/pages/calendar.tsx:126-133,345-363,393-412` | another period/view | page content | `/calendar?date=&view=` | no |
| A calendar entry | `calendar.tsx:459,480-485` | meeting | Dialog (`web/components/calendar/event-dialog.tsx:127`) | none | no |
| Dialog "Visa dagen" | `event-dialog.tsx:151-160`; `calendar.tsx:484` | day view | page content | `?date=<d>&view=day` | no |
| "Ny bokning"; dragging a range | `calendar.tsx:374,461,486-490` | booking form | Dialog (`booking-dialog.tsx:122`) | none | no |
| "Förslag · N" (under 1280 px) | `calendar.tsx:365-371,468-478` | the proposal thread | Drawer 420 px; a fixed 340 px side panel from 1280 px (`calendar.tsx:428-434`) | none | no |
| "Visa vecka N" in that panel | `calendar.tsx:241-249` | that week | page content | `?date=&view=week` | no |

The calendar does not use the shared panel, has no box, and ignores `card`/`open` in its address.

### 1.8 Review and talk overlays

| Control | file:line | Opens | Space | Address |
|---|---|---|---|---|
| Review: step buttons | `review-overlay.tsx:365` | next/previous row | same overlay | `?step=n` (`replace`) |
| Review: ✕, Esc, scrim, "Tillbaka till kortet", after Skicka | `review-overlay.tsx:153-164,182,253-256,824` | card | Hem + P-Hem | `/?card=<id>` (`replace`), or `/` if the card is gone |
| Review: "Till första steget" | `review-overlay.tsx:267` | step 1 | same overlay | `/cards/<id>/review` |
| Review: "Granska avvisade igen" | `review-overlay.tsx:826-835` | a new review card | same overlay | `/cards/<newId>/review` |
| Review: "Förstora"; "Hämta underlaget (PDF)" | `review-overlay.tsx:530,556,560-562` | Lightbox; a `data:` link (**behaviour not verified**) | overlay | none |
| Talk: ✕, Esc, "Tillbaka till Personal" | `talk-overlay.tsx:96-98,171` | closes | Personal | `/staff` + what remained, `replace` |

### 1.9 Admin, login, protocol pages (brief)

- Admin pages are rail destinations with a breadcrumb "Startsidan › Administration › …" (`web/pages/admin/shell.tsx:45-48`). List rows lead to detail pages (`/admin/connectors/:id`, `/admin/models/:id`, `/admin/models/providers/:id`). Add/edit/delete use Dialog and AlertDialog (`admin/add.tsx:129`, `add-model.tsx:247,391`, `connector.tsx:774,833,909`, `model.tsx:364`, `provider.tsx:318,360`); deleting navigates to the list.
- Organisation: a unit opens as a Drawer / BottomSheet with an address, `/admin/organisation?unit=<id>` (`admin/organisation.tsx:48-49,188,313,403-424`). Users keeps its filters in the query (`admin/users.tsx:138-170`).
- Login "Logga in" → `/api/auth/login?returnTo=…` (`web/pages/login.tsx:30`). Protocol pages link to each other and to `/api/protocol` (`web/pages/protocol.tsx:237-240`).
- Unknown paths render Hem (`web/main.tsx:264`).

---

### Jumps away from the current page

Everything below replaces the main page from inside a task. Reasons are quoted from code comments where one exists.

| # | From → to | file:line | Reason found |
|---|---|---|---|
| 1 | An action about a person (Personal row menu; opened person's buttons, "Fler", "Åtgärder"; person page header and section buttons) → **Hem with the card** | `web/entity-actions.ts:64` | `entity-actions.ts:47-50`: "Hem is where a card and its decision live, with its receipt, its settling and its next step, and Personal's own panel holds one person at a time (D83)". The second half no longer holds: Personal's panel holds a card in the working tree. |
| 2 | "Behöver dig" card on the person page and the unit page → **Hem with the card** | `entity-sections.tsx:395,402`; `person.tsx:140`; `unit.tsx:179` | `entity-sections.tsx:394`: "Where a card opens when the page has no panel of its own for it: beside Hem's column (D50)". |
| 3 | "Granska N" / "Visa granskning" on a card in Personal's panel or inside a conversation → **Hem with the review drawer**, closing to `/?card=` | `card.tsx:701,763`; `review-overlay.tsx:54,154` | `card-panel.tsx:30`: "the review of a card's rows one at a time (D73) is a drawer over Hem, so 'Granska N' leads there"; `main.tsx:165-167`: it is a start route so Hem is never remounted. |
| 4 | "Lägg till i samtalet" where the page has no box (card in Personal's panel; `@` on a row in the person page) → **Hem**, chip in the box, card not opened | `conversation-context.tsx:236-244` | `:233-235`: "the person chose the conversation, and a chip added where nothing shows it would leave the pressed button resting with the focus on nothing (2.4.3)". |
| 5 | Asking in a tool page's box → **conversation** | `conversation-context.tsx:358-361` | `:356-357`: "the conversation takes the column at once, with what the page showed beside it, and 'Stäng samtalet' leads back to the page as it stood". |
| 6 | Toast "Visa" (reminder, new tasks), bell rows, rail search card hit, from any page → **Hem with the card** | `shell.tsx:125`; `reminders.tsx:120`; `nav.tsx:120` | none for the toast and bell; `nav.tsx:72-73`: a card's state and the areas "are not places: they are the tabs and the filter on Hem". |
| 7 | A row, record or search hit that names a person or unit (`subject`) on Hem, in a panel view, on a tool page → **person / unit page** | `card.tsx:936`; `view.tsx:430-461,686`; `panel.tsx:133`; `my-commitments.tsx:153` | `person-address.ts:48-51`: "each with the address of the page the row was on as `from`, so the way back returns to it as it was". |
| 8 | A person's name on Personal → **person page** | `staff-parts.tsx:201-207,324-330` | `person-panel.tsx:79-82`: "the product owner, 2026-11-11: the name opens the page, the panel is the look beside". |
| 9 | "Öppna samtalet" on the person page → **Personal with the talk drawer**; from the opened person's section on Personal it also drops the lens and closes the person | `person.tsx:98-102`; `entity-sections.tsx:215-219` | `web/talk-address.ts:2-4`: "The list stays the page and the talk is a drawer over it". No comment on the dropped parameters; the row menu's variant keeps them (`staff-model.ts:227-231`). |
| 10 | Section way in ("fuller view"), "Öppna som sida" on the opened person → **person page** | `person-panel.tsx:340,347-348` | explicit promotion (D97 item 5). |
| 11 | Unit name under a person, "Läget på <enhet>" → **unit page** | `entity-sections.tsx:85`; `lage.tsx:47` | `unit.tsx:105-107`: no rail entry leads to a unit; these links do. |
| 12 | "Öppna som sida" on a view in Hem's panel → **tool page** | `start.tsx:951-958` | explicit promotion (D42, D50). |
| 13 | "Justera i kalendern" / "Visa i veckan" on a proposal card (Hem, conversation, Personal's panel); I dag "Hela veckan" → **Kalender** | `thread.tsx:384-385`; `today.tsx:44` | none. |
| 14 | "Stäng samtalet" / Esc on a conversation opened from the rail while on another page → **Hem** | `conversation-context.tsx:159-163` | `:151`: "the page the conversation was asked from, else the landing". |
| 15 | Review close from a Klart row → `/?card=` without `tab=done` | `review-overlay.tsx:54` | none. |
| 16 | Header places from a connector → whole-page load, possibly another site | `site-header.tsx:15-25` | "the header crosses sites … so no host's client-side routing may catch it". |
| 17 | "Visa i Personal", "Öppna Personal" on the unit page; "Till startsidan" on empty states | `unit.tsx:68,182`; `staff.tsx:184`; `tool.tsx:204` | ordinary destination links. |

Rows 1, 2, 3, 4 and 6 all end on Hem, and all but 4 arrive with the card attached to the box as "Om kortet".

---

### Same thing, different behaviour

#### A card

| Clicked on | Wide window | Narrow window | Phone |
|---|---|---|---|
| Hem (row title, "Menar du", I dag, "Öppna") | beside Hem, tabs kept, box says "Om kortet" | Drawer over Hem, box still gets the token | BottomSheet; box gets nothing (`start.tsx:938-939`) |
| Personal "Just nu" with one card | beside the list | Drawer over the list | Drawer (not a sheet) |
| Personal "Just nu" with several cards | opens the **person**, not a card | same | same |
| Opened person's "Behöver dig" on Personal | over the person, same panel | Drawer | Drawer, after a section drill-in |
| Person page / unit page "Behöver dig" | navigates to Hem | same | same |
| Bell, toast "Visa", rail search (any page) | navigates to Hem | same | same |
| An answer in a conversation | drawn inside the answer; beside the transcript only if it was the card asked about | inside the answer | inside the answer |
| Calendar's proposal thread | fixed 340 px side panel, no address | Drawer "Förslag" | Drawer |
| Tool page | no slot; `?card=` is ignored | — | — |

Further differences for the same card: on Personal there is no "Nästa som behöver dig", no tabs, and rows in its read are not links (`card-panel.tsx:30-32`). By code reading (**not run**), on a phone a card under "Inte nu", or a done card past its undo window without a review, changes the address but opens no sheet, because the sheet requires `inStream` while the desktop panel does not (`start.tsx:929-939,1004-1007`).

#### Other objects

| Object | Where clicked → space |
|---|---|
| Card's own read (`read`, panel) | Hem: over the card in P-Hem; on a phone the sheet gives way to a Drawer. Conversation: P-Conv. Personal: over the card in P-Pers. `target: 'link'` or an output `url`: new tab everywhere. |
| Declared view | Läget tile, Mina ärenden row, answer "Visa allt": P-Hem / P-Conv. Rail row, rail search, "Öppna som sida": tool page. Under an answer: an embedded card of three rows. On a person: a section (one row), up to five rows under it, the full view on the person page. As a lens: the list on Personal itself. |
| Row's own view (`view.open`) | Hem panel: replaces the view with "Tillbaka". Tool page: beside/over the tool. Answer embed: beside the transcript. Person section in the panel: a short inline list plus a link to the person page. Person page: drawn in full, rows not links. A card's read on Personal: not links. Search hit: a button. |
| Person | Name on Personal: page. "Visa bredvid", compact row, "Just nu" with several cards: beside the list (Drawer when narrow; drill-in on a phone, with no "Visa bredvid" and no "Öppna som sida" there, `staff-parts.tsx:410,500`; `person-panel.tsx:111-129`). A row naming them anywhere else: page with `from`. Their talk: Drawer / BottomSheet at `/staff?talk=`. |
| Unit | Always a page (`/units/:id`). In Administration › Organisation a unit is a Drawer / BottomSheet (`?unit=`). |
| Source record outside Clew | Search hit `link`, field `format: link`, action `target: 'link'`, read-only action point, recovery link: new tab. Header places: same tab, full load. Citation link: **not verified**. |
| Conversation | Rail, Klart row, I dag link, "Fortsätt samtalet": the column at `/conversations/:id`. Asked on Hem: in place, then the address. Asked on a tool page: `/conversations/new` first. Close returns to the asking page only when it was asked from one. |
| "Öppna samtalet" | Row menu: drawer, lens kept. Opened person's section: drawer, lens and person dropped. Person page: navigates to Personal. |
| Phone overlay type | BottomSheet: Hem card, review, talk, bell, admin unit. Drawer: views, Personal person/card, calendar proposals, card in a conversation. |

---

### Docs versus code

| # | Doc says | Code does |
|---|---|---|
| 1 | `docs/reference/interface-spaces.md:39`: a person opens beside the list from "A name on a row of Personal". | The name leads to the page (`staff-parts.tsx:201-207,324-330`); beside is "Visa bredvid" (`:162`). The D97 amendment of 2026-11-11 and `docs/reference/status/people.md` already say so; this row was not updated. |
| 2 | `interface-spaces.md:42`: person page close target is "Personal for the reader's own people, else the page in `from`"; origins do not list the name on Personal. | The trail exists only when `from` is present and nameable (`person.tsx:164,180`); without `from` only the rail marks Personal (`:173-174`). |
| 3 | `interface-spaces.md:3,24-25` (rules 3 and 4): opening from the current task keeps it underneath; close returns "into the originating page"; keep the originating path and filters. | The review always runs over Hem and closes to `/?card=` whatever launched it (`review-address.ts:6`; `review-overlay.tsx:54,154`). "Öppna samtalet" from the opened person drops `person` and `show` (`entity-sections.tsx:215-219`). Review close from Klart drops `tab=done`. |
| 4 | `interface-spaces.md:18`: "Mobile changes presentation, not the navigation level or the destination reached on close." | On a phone the Hem card is not attached to the box (`start.tsx:938-939`), the row menu has no "Visa bredvid" and the person drawer no "Öppna som sida" (`staff-parts.tsx:410,500`; `person-panel.tsx:111-129`), and some cards open nothing (see above, by code reading). |
| 5 | `docs/reference/status/people.md` (Personal): "Personal never gives way to Hem for a card." | From a card on Personal, "Granska N", "Lägg till i samtalet" and every menu action lead to Hem (`card.tsx:701`; `conversation-context.tsx:241`; `entity-actions.ts:64`). |
| 6 | `entity-actions.ts:49` (comment): "Personal's own panel holds one person at a time (D83)". | Personal's panel holds a person or a card (`card-panel.tsx:22-28`; `staff.tsx:79-80`). |
| 7 | `interface-spaces.md:14`: native content uses "the shared panel and its open-content menu". | Personal uses the shared panel with `replaces: true`, so there is no menu of open things (`person-panel.tsx:383`; `panel.tsx:544-545`). The calendar uses its own panel (`calendar.tsx:428-434`). |
| 8 | `packages/connectors/src/protocol.ts:255` and `docs/generated/manifest-reference.md:827`: an area's id "is the area's address, `/areas/<id>`". | No such route (`main.tsx:178-264`); it falls through to Hem unfiltered. The real address is `/?area=<id>` (`nav.tsx:125`; `start.tsx:199`). D50 item 2 removed `/areas/:area` (`docs/decisions/D50-…md:19`). |
| 9 | `protocol.ts:257,318`; `manifest-reference.md:794`: each area "is a button under the box on Hem". `protocol.ts:265`; `manifest-reference.md:264`: standing capabilities are "shown under 'Gör själv'", schedules "as text". | Hem has no area buttons; areas are the filter menu (`start.tsx:736-759`). "Gör själv" appears only on admin pages (`admin/audience.tsx:146`; `admin/connector.tsx:688`). `schedules` is drawn nowhere in `apps/web/src`. |
| 10 | `composer.tsx:421-422` handles a standing **read** ("öppnar vyn"). | The server never sends reads in that list (`apps/server/src/assistant/completions.ts:26`), so the branch is dead. |
| 11 | `docs/decisions/D42-…md:31`: views open "at `/views/:capability`". | Gone since D50 (`D50-…md:31`); the address is `?open=` (`panel-address.ts:14`). Historical wording, as `interface-spaces.md:5` warns. |
| 12 | `protocol.ts:613` (preview `openedFrom`): from any non-entity read "a row opens it beside the list". | True on Hem and a tool page; not in a card's read on Personal (`card-panel.tsx:81`) nor on the person page (`entity-sections.tsx:266-272`). |

The bodies of D50, D66, D72 and D73 were only spot-checked against the code (**not verified** line by line).

---

## Part 2: what a connector author declares, and where it opens

"Documented?" quotes the connector-facing docs. `interface-spaces.md` is a maintainer page and is not counted.

| Field (where declared) | Author writes | What the person gets, and where | Documented? | Cannot control or predict |
|---|---|---|---|---|
| `capabilities[].view` (`protocol.ts:223`; `packages/contracts/src/index.ts:477-553`) | a view kind and fields | The one renderer (`view.tsx:584`) in Hem's panel (`start.tsx:959-980`), a tool page (`tool.tsx:220-231`), three rows under an answer (`conversation.tsx:150-182`), a person/unit section (`entity-sections.tsx:152,284`), a lens on Personal. `kind: table` gets a wide Drawer (`panel.tsx:824`) and is drawn as a list beside the page. | `docs/guides/example-custom-directory.md:33`: "Clew renders the same declaration in a panel, below an answer and, if selected by an administrator, on a tool page." | Which of these; whether it is beside or over; the search controls are absent under an answer, in a card's read and in a section. |
| `view.open` (`index.ts:399-413,469`) | a read of the same connector plus `params` | The row's name becomes a link. Hem panel: replaces the view (`start.tsx:977`). Tool page: beside the tool (`tool.tsx:230`). Answer: beside the transcript (`start.tsx:1104`). Person section: up to five rows inline and a link titled `open.title` to the person page (`entity-sections.tsx:284-340,445-450`). | `manifest-reference.md:1903`: "A row opens another read of the same connector as a view (D35, D38)." Place only in the preview text (`protocol.ts:613`). | Not a link in a card's read on Personal or on the person page. A second level works only where a panel exists. |
| `view.subject` (`index.ts:415-427`) | the record property holding a person or unit key | The row's name links to `/people/<key>` or `/units/<id>`, replacing the main page, with a breadcrumb back (`view.tsx:430-461,672-692`). With `open` too, the entity moves to a separate link "Öppna <namn>" or a column "Person"/"Enhet" (`view.tsx:437-450,501-510`). | `manifest-reference.md:1125`: "The record's title then links to that person or unit for a reader who may open it". `docs/architecture/entities.md:64`: "with the current page as the way back." | It always leaves the page; never beside. No breadcrumb when the origin is itself a person or unit page. |
| `view.ref` (`index.ts:456-460`) | the property with the row's ref | An `@` button "Lägg till i samtalet" per row (`view.tsx:463-472`), when the server sets `chip`. | "so a row can be added to the conversation as a chip" (`index.ts:458`). | On a page without a box the click navigates to Hem (`conversation-context.tsx:241`). When `chip` is true was not read (**not verified**). |
| `view.input` (query, filter) (`index.ts:471`) | a search field and/or a choice | Controls above the rows; each change rewrites the address with `replace` (`start.tsx:968-976`; `tool.tsx:229`). | Field descriptions only. | Drawn only in Hem's panel, a tool page and Mina ärenden. |
| `view.fields[].format` `link`/`phone`/`email` | a format | `link`: new tab, the label as link text (`view.tsx:242-246`); `tel:`, `mailto:`. | `manifest-reference.md:1487`: "`link` an http(s) link out". | New tab is not stated. In a section's one-line summary it is plain text (`entity-sections.tsx:193-199`). |
| `capabilities[].menu` (`protocol.ts:231`; `index.ts:622-637`) | label and icon | After an administrator chooses it: a rail row under Verktyg opening `/tools/<capability>` (`nav.tsx:135-143`), a rail search hit, and "Öppna som sida" on the same view when it is in Hem's panel (`start.tsx:940,951-958`). | `example-custom-directory.md:33`: "A read with a view and no required input can be offered under Verktyg … it does not publish itself in the menu." | Whether it is a tool at all; its place among "Fler verktyg" after the fourth. |
| `capabilities[].model: true` with a view | a boolean | The assistant may call it; the view is drawn under the answer, "Visa allt" opens it beside the transcript (`conversation.tsx:273-290`; `start.tsx:411`). | `manifest-reference.md:15`: "the view is drawn under the answer." | Only the latest answer embeds it; older ones show a button. |
| `areas[]` id, title, icon (`protocol.ts:250-284`) | an area | The area chip on cards, the filter on Hem (`/?area=<id>`), a rail search hit "Område". | Says "button under the box" and `/areas/<id>`: wrong (rows 8-9 above). | — |
| `areas[].standing` (`protocol.ts:263`) | capability names | Non-read standing capabilities appear under "Menar du" while typing and are asked in a conversation (`composer.tsx:416-423`; `completions.ts:23-27`). | Says "shown under 'Gör själv'": not in the product. | A standing **read** has no entry point on Hem today. |
| `areas[].figure` and `Figure.opens` (`protocol.ts:277,464-470`) | a figure, optionally a read to open | A tile under "Läget på <enhet>"; with `opens` the tile links to that view in Hem's panel (`lage.tsx:57-68`; `start.tsx:632`). The tone also words the rail's Hem badge (`nav.tsx:108,178-187`). | `manifest-reference.md:941`: "`opens`, a read of yours whose view needs no input, which the tile then links to." | Place of the opened view is not stated. |
| `scan: true` → `ThreadDraft` (`protocol.ts:387-411`) | drafts | A row on Hem; its title opens the card (P-Hem). | `docs/guides/actions-and-receipts.md:16-23`. | The same card opens beside Personal when it names one of the reader's people. |
| `ThreadDraft.items[].subject` (`index.ts:1219-1223`) | a person or unit key per row | The row's label links to the entity page (`card.tsx:934-942`). The card is listed under that person's "Behöver dig" and counted in "Just nu" on Personal. | `entities.md:64,70-71`. | From Personal the card opens beside the list; from the person or unit page it navigates to Hem. |
| `ThreadDraft.actions[].kind: 'read'` with `target` (`index.ts:1228-1247`) | `target: 'panel'` (or nothing) or `'link'` | Panel: the read lies over the card, address `open-card`/`open-action` (`card.tsx:492-494`). Link: the read is called and its `url` opens in a new tab (`card.tsx:484-490`). | **Not documented** in the guides; only in the schema (`docs/protocol/connector-protocol.schema.json:3050`) and a code comment (`index.ts:1235`). | Rows of a panel read link onward on Hem but not on Personal. An output with `url` and no `target` opens a tab and leaves an empty panel address (`start.tsx:362-363,399`). |
| `actions[].confirm` (`index.ts:1240`) | a Swedish question | An AlertDialog before the action runs (`card.tsx:461-474`). | **Not documented** in the guides. | — |
| `actions[].review: 'each'` with `preview`; capability `review` (`index.ts:1241-1247`; `protocol.ts:224-230`) | review flags | The next step becomes "Granska N", opening `/cards/<id>/review`: a Drawer over Hem, a sheet on a phone (`review-overlay.tsx:285-306`). | `actions-and-receipts.md:25`: "Clew then offers `Granska N` as the card's next step, shows each item's document beside its facts". | It always runs over Hem, also when the card was opened on Personal or in a conversation. |
| `actions[].role` | primary / secondary / overflow | A row shows the primary only; a card shows two secondaries, the rest under "Fler val" (`card.tsx:667-671`). | `actions-and-receipts.md:23`. | — |
| `about: { entity }` on a read (`index.ts:978-989`) | the entity kind | A section on the opened person (panel and page) or unit page; a lens under "Visa" and a column on "Alla" when an administrator chooses; a mark in "Just nu" for a `warn`/`alert` tone. | `docs/reference/connector-protocol.md:58-63` (table); `docs/guides/creating-a-connector.md:197`: "Clew then decides where they show. You never name a place". | Everything about placement; a read about a unit shows only on the unit page (`entities.md:101`). |
| `about: { entity, param }` on a propose/execute | the input property for the key | For a person: the row menu on Personal, the opened person's buttons / "Fler" / "Åtgärder", the person page. Choosing it creates a card and **navigates to Hem** (`entity-actions.ts:64`). | `manifest-reference.md:1058`: "it becomes the person's card." | That it leaves the page for Hem is not stated. For a **unit** it is accepted but shown nowhere (`unit.tsx` reads no actions). |
| `about.page` (`index.ts:990-997`) | — | Core connectors only ("never a remote manifest"). | — | Not available to a third party. |
| `<id>.search` hits: `link`, `subject`; the search read's `view.open` (`index.ts:681-705`; `apps/server/src/modules/search/usecases.ts:50-56`) | hits | `link`: button "Öppna" / "Öppna i <källa>", new tab. `view.open`: a button titled `open.title`, opening in the panel. `subject`: the title links to the entity page and both buttons are hidden (`panel.tsx:130-172`). | `example-custom-directory.md` (walkthrough); `index.ts:689` "Where to open it, in the source system." | A hit with `subject` loses its own link and view. |
| `<id>.errands` (`protocol.ts:197`) | the profile read | Rows under "Mina ärenden" on Hem; a row opens the errand's read in Hem's panel (`my-errands.tsx`; `start.tsx:619`). | `protocol.ts:197`: "Its view's `open` names the read that shows one errand". | Shown on Hem only; five rows first. |
| `<id>.talks`, `<id>.commitments` | the profile reads | Read-only: an action point's text is a link to the system in a new tab (`my-commitments.tsx:209-212`); the talk drawer is not used. | `connector-protocol.md:115`: "Clew then shows that system read-only and a row opens its `link`." | New tab not stated. |
| `header.capability` → `SiteHeaderOutput` (`protocol.ts:347-359`; `index.ts:2405-2437`) | site name, places, sub-pages, logo | The band above every page; every link is a full page load in the same tab (`site-header.tsx:15-25`). On a phone the places are rows in the rail drawer (`shell.tsx:192-197`). | `creating-a-connector.md:148`: Clew "draws it above every page for the people in the connector's audience, and edits nothing of it." | Same tab vs new tab is not stated. Whether sub-pages are reachable on a phone: **not verified**. |

### Gaps a third-party author would hit

1. **No connector-facing page says where things open.** The placement table lives in a maintainer reference (`interface-spaces.md`); the guides say only "in a panel, below an answer and … on a tool page".
2. **`target` and `confirm` on a card action are undocumented** outside the schema.
3. **Placement depends on the origin page.** The same card opens beside Hem, beside Personal, or navigates to Hem from a person or unit page. The same `view.open` is a link on Hem and a tool page and inert in a card's read on Personal and on the person page.
4. **An action about a person leaves the page for Hem**; the docs say only that it "becomes the person's card".
5. **An action about a unit is accepted and shown nowhere.**
6. **The review always runs over Hem**, whatever page the card was on.
7. **The area documentation is stale**: `/areas/<id>`, "button under the box", "Gör själv" and schedules do not exist in the product; a standing read has no entry point.
8. **`subject` changes other behaviour**: it always replaces the main page, moves beside `open` as a second link, and on a search hit hides the hit's own `link` and view.
9. **New tab versus same tab is unstated** for `format: link`, hit `link`, `target: 'link'`, read-only action points and header places (the last is same tab, the rest new tab).
10. **"Lägg till i samtalet" on a row** navigates to Hem on pages without a box.
11. **Viewport changes more than presentation**: phone sheet versus drawer, missing "Visa bredvid" and "Öppna som sida", and the box token.
12. **Administrator choices decide visibility** (menu tool, lens, column, figure), so an author cannot tell from the manifest whether a declaration shows at all; the preview page lists possibilities only.

---

## Part 3: the navigation patterns that exist today

Counts are entry-point kinds from the tables above, not instances.

- **Rail destination → main page.** Hem, Kalender, Personal, each tool, five admin sections, "Ny fråga", "Alla samtal", up to five conversations; header places on a phone. About 9 fixed, plus tools and conversations.
- **Page state in the address, same page.** Hem tab and area, Personal lens, calendar date/view, person page section, view search input. About 12.
- **Card beside Hem (`/?card=`), attached to the box.** From Hem: row title, "Menar du", I dag, "Öppna", Klart row (5). From any page: bell row, two toasts, rail search (4).
- **Forced jump to Hem with a card.** Entity actions (5 controls), "Behöver dig" on person and unit page (2), review close (1).
- **Card beside Personal (`/staff?card=`), no box.** "Just nu" single-card links, opened person's "Behöver dig" (2).
- **A card's own read over the card (`open-card`/`open-action`).** One control on three surfaces: Hem, conversation, Personal.
- **Declared view in the shared panel (`open=`).** Läget tile, Mina ärenden row, answer "Visa allt" (two controls), row's own view, search hit view (6).
- **View as a tool page (`/tools/:capability`)**, with a row's view beside it. Rail row, rail search, "Öppna som sida" (3), plus the row link (1).
- **Person beside the list (`?person=`), one thing at a time.** "Visa bredvid", compact row, "Just nu" with several cards (3); phone drill-in (`person-section`).
- **Entity page with a way back (`/people/:key`, `/units/:id`, `from`).** Name on Personal, "Öppna som sida", section way in, card row, view row (three variants), search hit, action-point name, Läget heading, unit under a name. About 11.
- **Focused overlay with an address.** Review `/cards/:id/review` (5 entry points, always over Hem); talk `/staff?talk=` (3, always over Personal); admin unit `?unit=` (1).
- **Overlay without an address.** Calendar meeting and booking dialogs, "Förslag" drawer, meeting dialog over Hem's panel, snooze dialog, confirm dialog, bell popover, lightbox, admin dialogs. About 9 plus admin.
- **Conversation takes the column (`/conversations/:id`, `/conversations/new`).** Rail rows, rail search, Klart row, I dag link, "Fortsätt samtalet", sending on Hem, sending on a tool page, verbs, follow-ups, "Menar du" questions. About 10. Closing returns to the asking page or Hem.
- **Add to the box (chip).** Card "Lägg till i samtalet" (row, card, two menus), view row `@`, search hit `@` (6); navigates to Hem where the page has no box.
- **Out of Clew.** New tab: action `target: 'link'`, read output `url`, search hit link, field `format: link`, read-only action point, recovery link (6). Same tab: header places, `tel:`/`mailto:`, document download, login.

### Not verified

- Where an answer's citation link opens (Astryx Markdown `sources`).
- What "Hämta underlaget (PDF)" does with its `data:` address (`review-overlay.tsx:556`).
- Whether header sub-pages are reachable on a phone; the shared header's own mobile branch was not read in full.
- The phone case where a snoozed or long-done card opens no sheet: derived from code only.
- When the server sets `chip` on a view.
- D50, D66, D72 and D73 were spot-checked; admin pages were grepped, not read.
- Nothing was run: no tests, no browser, no server.
