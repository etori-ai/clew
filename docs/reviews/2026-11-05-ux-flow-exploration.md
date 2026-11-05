# Design exploration: one flow between conversations, views and the panel · 2026-11-05

Requested by the product owner on 2026-11-05: the architecture is landing (connectors register views,
D38, D40, D42), but the UX lacks a logical flow. Three questions: should Clew work with chat sessions,
how do sessions relate to the static views, and is a side panel needed for files, views and app views.
Drawn on the canvas **Clew · ett sammanhängande flöde** (Claude Design,
https://claude.ai/artifact/1dDLtj7R5AMmUa4qZNk6Da, private until shared): a flow map and seven screens
joined by working links.

The canvas proposed one model at first; a second was drawn beside it when the product owner hesitated. What was
chosen is under Outcome at the end.

## What is wrong today

Read from `apps/web/src/components/nav.tsx`, `main.tsx` and the decisions D31, D34, D38, D40, D42:

- The rail mixes five kinds of thing: groups of cards (Behöver dig, Jag föreslår, Till kännedom), states
  of cards (Pågår, Inte nu), conversations by day, tools, and areas as lenses. A person cannot tell a
  place from a filter.
- A view opens in three ways (the panel, compact under an answer, a page under Verktyg) and nothing
  leads from one to the other; D42 lists the link from a panel view to its page as not built.
- A card shows in the brief, the overview, an area, a pile and a conversation turn, each with its own
  address.
- A conversation is reachable only from the box and the rail. A tool page and the overview have no way
  to ask about what they show, so the conversation and the views are two products side by side.

## The proposal: three places, one conversation, one panel

One sentence: **the main column shows where you are, the panel shows what you hold beside it, and the
conversation can sit in either.**

- **Places** (the rail): Ny fråga (the landing with the box and "Dagens tre"), **Att göra** (every pushed
  card), the tools (Kalender and the views chosen under D40). Below them, earlier conversations by day.
  Nothing else: card states become tabs on Att göra (Behöver dig, Pågår, Inte nu, Klart), areas become a
  filter there and stay as toggles under the box (D41).
- **Sessions: yes.** A conversation is a session: the transcript plus what it has opened in the panel.
  It starts from the box, from a card ("Fråga om kortet") or from a tool page ("Fråga om sidan"), and
  remembers where it started. A reply on a card and a question on a page are the same kind of session, so
  the card and the page list their conversations.
- **Views and sessions.** A view is a place with an address and works without the model (D8, D38). A
  session visits a view in the panel. The same view has two sizes, page and panel, and one control
  switches: "Öppna som sida" on a panel view, "Öppna samtalet" on a conversation in a page's panel.
  When the conversation runs beside a page it drives the page's own input (the search field, the filter:
  the `input` in the address), so what the person sees is still the deterministic view.
- **The panel: one, on the right.** It holds a declared view, a source or file (D26), a card, or the
  conversation when a page is in the main column. Tabs list what the session has opened. On a phone it
  is a bottom sheet. A sandboxed app view, if D38's replacement of MCP Apps is ever revisited, would be
  one more kind of content in the same panel and on a tool page, nowhere else.

## The screens on the canvas

| Artboard | Main column | Panel | Leads to |
|---|---|---|---|
| Karta | the four screens and the actions between them | | each screen |
| 1 · Hem | "Dagens tre", the greeting, the box, the areas | none | 2 (send), 3 (Granska) |
| 2 · Samtal med panel | the transcript, the box docked | tabs: the Telefonbok view, the cited source | 5 (Öppna som sida), 3 (Gör till ett kort) |
| 3 · Att göra | tabs by state, the list in Nu and Senare | tabs: Samtal, the open card; the box at the panel's foot, scoped to the card | 2 (Öppna samtalet) |
| 4 · Verktygssida, en rad öppnad | the Telefonbok table | tabs: Samtal, the row's contact card; the box at the panel's foot, scoped to the row | 5 (ask, or the Samtal tab) |
| 5 · Verktygssida, samtalet i samma panel | the same table, searched by the conversation | the same tabs with Samtal chosen; the box has not moved | 2 (Öppna samtalet), 4 (the row's tab) |
| 6, 7 · Telefon | the landing with the box docked; the transcript | the panel as a sheet with the same tabs | |

## Amended the same day: on a page the conversation always lives in the panel

The first drawing put a box under the page's content and moved it into the panel once a question was
sent, so the panel changed role between screens 4 and 5 (a row's card, then the conversation). The
product owner was uneasy about that and asked: what if the chat on a page always lives in the sidebar.
Screens 3, 4 and 5 are redrawn that way, and the rule is now:

- On the landing the conversation is the main column, and the panel holds what it touches.
- On every page (Att göra, a tool, and by the same rule Kalender) the panel is the assistant: the box
  at its foot, always, and above it tabs with Samtal first and whatever the person has opened after it
  (a row, a card, a source). The box's scope line follows the chosen tab.
- Nothing moves when a question is sent: the Samtal tab is chosen and the page keeps its place.
  "Öppna samtalet" in the panel's header takes the conversation to the main column with the page as a
  tab in the panel.

This settles the fork below towards letting the conversation sit in the panel, and it is a rule rather
than an exception. Still to settle: whether the panel can be hidden on a page and what brings it back,
and what the Samtal tab shows before anything is asked (the page's earlier conversations are the
candidate).

## The choice the product owner named: A or B

After the amendment the product owner put it as a choice of two: the chat on a page always in the
sidebar (A, screens 4 and 5), or the chat kept in the main content (B). B is drawn as artboard 4B: the
box sits under the page's content, and sending opens screen 2, where the conversation takes the main
column and the page steps into the panel.

| | A · the chat in the panel on pages | B · the chat always in the main column |
|---|---|---|
| The rule | Two homes for a conversation: the column on the landing, the panel on a page | One: the conversation is always the column, what it is about is always the panel |
| The panel | Two jobs, as tabs: the conversation and what was opened | One job: the object beside the column |
| The page when asked about | Keeps its width | Steps into the panel (a table becomes a list, the week a day strip) |
| A phone | Has no room for A; does B | The same as a desktop |
| Rich answers (a card in the turn, a week of proposals, a compact view) | In about 420 px | In the column they were built for |
| Cost | A second conversation width, tabs in the panel, D31 changed, the table's 1360 px rule revisited | Built: D31, `PanelView`, the embeds; new is the box on a page and the origin on the session |

Recommended: **B**, and A later for a page where people stay and work (Kalender is the candidate) if
that turns out to be needed. B is a subset of A, so starting with B closes nothing. The first reply in
this session leaned towards A; drawing it showed the cost (the row's card and the conversation
competing for one panel), which is what changed the recommendation. The product owner answered "go with B".

## What it would change

- **D31 and HANDOVER section 6** say the conversation is never in the side panel. Screen 5 puts it there
  when a page holds the main column. The alternative that keeps D31 is to navigate to screen 2 with the
  page in the panel whenever a person asks from a page; it is simpler to build (`PanelView` and the
  compact embeds exist) and worse for work in a tool, because the tool shrinks the moment it is asked
  about. This is the one real fork.
- **D34's rail** (Från mig, Pågår, Samtal, Verktyg, Områden) becomes places and sessions only.
  `/overview`, `/waiting`, `/snoozed`, `/handled` and `/areas/:area` fold into one page with a state tab
  and an area filter.
- **D42** gains the two switches (panel view to page, page conversation to full conversation).
- A session needs to store what it has opened (the panel's tabs) and what it started from (a card, a
  capability with its input). `MessageMeta` already keeps chips, views and sources per turn; the origin
  is new.

## Astryx

Everything drawn has a counterpart already in use: `AppShell` and `SideNav` for the rail, `Layout` with
an end `LayoutPanel` for main and panel (the calendar page), `ChatLayout` and `ChatComposer` for the
transcript and the box, `TabList` for the states and the panel's tabs, `List`, `Table`, `MetadataList`
and `DeclaredView` for the views, `BottomSheet` on a phone. To check with `bunx astryx` before building:
`ChatLayout` inside a `LayoutPanel` at panel width, and tabs in a `LayoutPanel` header.

## Open questions for the product owner

1. The fork above: may the conversation sit in the panel when a page is in the main column?
2. Is "Att göra" the name, and does Till kännedom belong in it or only in "Dagens tre"?
3. Does a session started from a card show under Samtal in the rail, or only on the card?
4. Does the panel keep its tabs when a session is reopened the next day, or only the origin?
5. Kalender has its own end panel with proposals and a reply field (D32). Does it become the same panel?

## Outcome

Decided and built on 2026-11-05 as [D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md):
the product owner chose B, the conversation always in the column and the panel for what it is about. The canvas now
shows B only. A was not built. Of the open questions above, the first is answered (no: the conversation is never in the
panel), the second is answered in part (the page is called Att göra and Till kännedom is one of its groups), and the
other three are open: D50 lists what is not built.
