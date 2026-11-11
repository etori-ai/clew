# D50 · The conversation is the column, and the panel holds what it is about

**Status:** accepted, built 2026-11-05, amended the same day (a brief row opens its card beside the landing); the panel's tabs for what a conversation has opened, the box on the calendar page, a conversation's origin shown on a card and on a tool's page, a resizable panel, and a manual screen-reader pass are not built; item 2's page is `/` and the day stands beside it since [D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md) · **Date:** 2026-11-05 · **Area:** ui

**Decision.** Every surface has one job. The rail holds places and earlier conversations. The column shows where the
person is: a page, or a conversation. The panel holds the one thing they keep beside the column: a view, a source or a
card. The conversation is never in the panel. The product owner chose this ("B") on 2026-11-05 over the alternative
drawn beside it, a conversation that lives in the panel on every page ("A").

1. **The rail** (`apps/web/src/components/nav.tsx`, `shell.tsx`) is places first, then where the person has been:
   Nytt samtal and the search; **Att göra** with how much needs the person; **Verktyg** (Kalender and the views chosen
   under D40); then **Samtal**, the latest five with when each was, ending in Alla samtal; Administration at the foot. A card's state and the areas
   are no longer rows in the rail.
2. **Att göra** (`/todo`, `apps/web/src/pages/start.tsx`) is the one page for everything the assistant has pushed,
   after Astryx's `table-inbox` template: a card's state as tabs (`tab=needs-you|waiting|snoozed|done`, the first is
   the default and is left out of the address), the areas as a filter (`area=`), the tab's rows, and the chosen row's
   card in the panel (`card=`). Behöver dig keeps D34's groups (Nu, Senare, Jag föreslår, Till kännedom); Klart is the
   log. On a phone every thread is a card in the list and a card has no panel. It replaces `/overview`, `/waiting`,
   `/snoozed`, `/handled` and `/areas/:area`. No redirects: nothing is deployed and no stored row holds an address.
3. **The panel** (`apps/web/src/components/panel.tsx`, `usePanel` and `PanelBody`) is one component for every page.
   Where it fits beside the page's column it is a `LayoutPanel` in the page's `end` slot, a named complementary
   region that is not modal, so the column stays in use (the `ai-chat` template's artifact beside the transcript,
   composed as the calendar page composes its own panel, without the template's stylesheet). Where it does not fit,
   on a phone and on a short screen it is the drawer it was. A table keeps the width it needs: on a tool's page the
   panel is beside the table only on a screen wide enough for both. Beside the page, opening the panel moves focus to
   its heading unless the person is typing, Esc inside it closes it and returns focus to what opened it, and one thing
   taking another's place is named aloud.
4. **What the panel holds is in the address** (`apps/web/src/panel-address.ts`), the same way on the landing, in a
   conversation and on Att göra: `open`, `open-title`, `open-input` and `via` are a view (the names D42 gave a tool's
   page), `open-card` and `open-action` are a card's own read, `card` is a card. A view lies over a card: closing the
   view leaves the card. `/views/:capability` and `/views/card/:threadId/:actionId` are gone.
5. **The box is on every page, and asking opens a conversation** (`composer.tsx`, `conversation-context.tsx`). On
   Att göra and on a tool's page the box sits at the foot of the column, one line tall, and its placeholder names what
   the page shows ("Fråga om kortet …", "Fråga om Telefonbok …"), or says "Nytt samtal" where nothing is open. Sending takes the person to `/conversations/new` at once, with the transcript in
   the column and what they were looking at in the panel (the open card, or the tool's view with its search as it
   stood), and the address becomes `/conversations/:id` when the answer is written. The card or the view goes with
   the question as a chip. "Stäng samtalet" leads back to the page it was asked on. The conversation's state is held
   above the pages (`ConversationProvider` in `main.tsx`), so a question survives the change of page.
6. **A question where no transcript is on the page starts a conversation of its own.** The box on the landing and on
   a page is "Nytt samtal"; an earlier conversation is continued from its own address. Before this, a question asked on
   the landing after "Stäng samtalet" was appended to the conversation that had just been closed.
7. **From the panel to the page.** A view in the panel that is also a tool in the person's menu offers "Öppna som
   sida" (the item D42 listed as not built).
8. **A card beside its row** takes the id `card-<thread>`; the row keeps `thread-<thread>`. The card beside a
   transcript is not drawn again in the turn that is about it.

**Amended 2026-11-05: a brief row opens its card beside the landing.** The canvas draws "Granska" on Hem leading to
Att göra with the card in its panel, and that is how it was built: the brief's title, "Granska" and "Visa förslaget" and
a matching "Menar du" row led to `/todo?card=`. The product owner found the change of page confusing: the person asked
for one card and got another page with the Att göra row lit in the rail. Item 4 already names the card in the address
the same way on the landing, so the brief now leads to `/?card=` (`withCard` in `start.tsx`), and the card opens in the
landing's own panel, a `LayoutPanel` beside the column where it fits and the drawer where it does not; Esc closes it and
gives the focus back to the row. "Allt i Att göra" is still the way to the list, and the bell, the reminder toast and
the rail's search still lead to `/todo?card=`, because they are asked from outside the landing. The canvas's Hem artboard
is out of date on this one arrow.

**Why.** The review [one flow between conversations, views and the panel](../reviews/2026-11-05-ux-flow-exploration.md) and the canvas **Clew · ett sammanhängande
flöde** (https://claude.ai/artifact/1dDLtj7R5AMmUa4qZNk6Da). The rail mixed five kinds of thing, a view opened three
ways with nothing leading from one to the other, and a conversation could only be asked on the landing: opening a
view from a conversation left the conversation's address and closed its transcript. A was drawn and rejected: it gives
a conversation two homes and two widths, makes the panel hold both the conversation and what was opened, squeezes an
answer's card or week into the panel, and a phone has no room for it and does B anyway. B is one motion everywhere and
is a subset of A, so a page people stay and work in (Kalender is the candidate) can still get a conversation beside it
later without undoing this.

**Astryx.** `Layout` with `LayoutPanel` in `end`, `Toolbar`, `Drawer`, `TabList` and `Tab` with `role="tablist"`,
`Selector`, `ListItem isSelected`. Nothing custom and no new dependency. The `ai-chat` template draws its artifact
panel with its own stylesheet and a container query; Clew does not write CSS, so the panel is the `LayoutPanel` and
the switch to a drawer is a media query on the window (`useMediaQuery`), with the rail's and the panel's widths as
constants in `panel.tsx`. A `LayoutPanel` takes `resizable`; that is not used yet.

**What moved, and what the page no longer shows.** The overview is gone, and what stood on it is placed again:
Läget's figures follow the groups under Behöver dig, the tip on how often the assistant interrupts sits beside Att
göra's heading, and the landing keeps the sentence and the day line. The day beside the groups ("Dagen", with the
Klart i dag bar), "Vid sidan av" and "Så här bevakar jag" are not on Att göra; `Today` is still in the repository.

**Replaces.** Parts of five earlier records, whose status lines now point here; their bodies are unchanged.
[D34](D34-the-box-is-the-page-and-the-push-is-its-brief.md): the rail (Från mig, Pågår, Samtal, Verktyg, Områden) and
`/overview`. [D28](D28-the-stream-has-two-groups-and-three-piles.md): the three pile routes; the piles are tabs.
[D31](D31-the-conversation-swaps-the-stream-inside-one-chatlayout.md): the side panel as a drawer over the page, and a
conversation that could only be asked on the landing. [D42](D42-a-tool-opens-as-a-page.md) item 4, where the screen is
wide enough for a table and a panel. [D43](D43-addresses-are-english.md): the start page's addresses. The rail's foot
(Administration with its two sections, the account as the last row) is as
[D45 · Administration keeps the rail](D45-administration-keeps-the-rail.md) and the shared header left it.
The words, the one filled button, the row's single next step and the type scale are
[D48 · One next step, the rest one step away](D48-one-next-step-the-rest-one-step-away.md), decided the same day from
a review of the screens as they were before this structure, and a card's one time action is
[D49 · A card has one time action](D49-a-card-has-one-time-action-and-always-says-when-it-is-back.md); all three stand, and where that record names the overview, the
piles' rows in the menu or the box at the overview's foot, this one says where those are now.

**Amended 2026-11-11 (D107): item 7 is withdrawn.** A view in the panel no longer offers "Öppna som sida" for a view
that is also a tool ([D107](D107-where-something-opens-is-decided-by-what-it-is.md) rule 7, the product owner's answer 5:
no control chooses a surface). The tool stays in the rail where an administrator put it, and "Stäng samtalet" still
leads back to a tool's page when the question was asked there. The other part of this record that D107 replaces, the
box asking about the open card by opening it, is changed separately.
