# D126 · One page per thing, and one Astryx template per page type

**Status:** provisional (product owner, 2026-11-14; accepted when a manager outside the repository has cleared a day's queue and handed a question to another system's assistant in it, and a manual screen-reader pass has been made over the queue, a thing's page and the conversation; item 4 amended by [D140](D140-the-assistant-is-asked-in-place-where-its-answer-is-drawn-on-the-page.md) on 2026-11-18: a page whose answer is drawn on the page itself may hold the assistant's box in its pane, Kalender first; and by [D135](D135-the-assistant-is-asked-beside-every-page-through-one-button-and-one-pane-of-the-page-frame.md) the same day: the assistant is asked beside every page, which replaces the item's last sentence when built) · **Date:** 2026-11-14 · **Area:** ui

**Current scope.** This decision governs destinations, panes, actions and focus.
[D130](D130-clews-look-and-layout-are-the-startsidan-prototypes-built-with-astryx.md) replaces its rail, sheet layout
and Hem composition. Use D130 for visual comparisons.

**Context.** The product owner found the interface unresolved and asked for a review of the feature set and flows as
if Clew were a new application, preferably on Astryx's own templates
([review](../reviews/2026-11-14-one-pattern-on-astryx-and-the-library-question.md)). The critique counted nine ways of
showing a thing and four homes for the assistant; a work item alone had four containers. The answer was drawn on the
canvas "Clew · one pattern, on Astryx", whose artboards are rendered from the real components, and the product owner
chose from it: one page per thing, the assistant in two homes, the manager's places as tabs of Personal, the palette
"Bläck" and the ball-of-thread mark.

**Decision.** Every screen is one of eight page types, each one Astryx template, and a thing opens in one way.

1. **One page per thing.** A work item, a person, a unit, a plan, a request and a connected system each have one
   page, the `work-item-detail` composition: the way back and the title, the actions directly under the title, the
   read in the column, the facts in the end `LayoutPanel` (above the read when the page is narrow). The name in a
   row is the link to that page, wherever the row is.
2. **A pane exists in two places.** Beside the queue in Att göra (`table-inbox`: the `Table`, the three piles as a
   `TabList`, the reading pane in the end slot), and beside a conversation (`ai-chat`: the thing the conversation is
   about). The pane draws the same parts as the page; its title is the link to the page; the decision buttons sit
   under the title and do not scroll away. With two opposed decisions both are shown at every width.
3. **Nothing opens over a page.** The side panel that opened over Hem, Personal and the tools, the wide overlays of
   the talk and the dialogue, and the inline unfold are removed. An address that carried such a panel redirects to
   the thing's page.
4. **The assistant has two homes** (amended 2026-11-16, product owner; canvas board HemFraga, variant a): a one-line
   way in on Hem and the conversation page, which holds the composer (Ny fråga, item 14, is a conversation not asked
   yet). Hem's line answers nothing on Hem: what is written there is sent as the conversation's first question, as the
   composer sends it, and the conversation page takes the column with the question asked; with nothing written its
   button opens Ny fråga. Whom to ask, the model, `@` and dictation are the composer's alone. "Fråga Clew" on a page
   starts a conversation with that thing beside it. No other page has a composer.
5. **While Clew works, the turn shows it:** every tool call as a row of `ChatToolCalls` with the system it goes to
   and its own status, the answer's place held, the send button as Stop. A read's result is a card in the
   transcript whose names are links.
6. **A question handed to another system's assistant stands once** ([D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md)
   items 5, 6 and 11 to 13 otherwise unchanged). Clew names the assistant and asks; when the person chooses it, the
   question already written is marked as sent on, Clew's suggestion becomes one line in the transcript, and the
   assistant's answer follows on its own surface. The question is not written into the transcript a second time.
7. **Every write is the action dialog** (`form-wizard-dialog`, as `action-dialog.tsx` composes it): fill in, "Det
   här händer", send. A row's menu opens the dialog; nothing is created before its last button.
8. **A register** (`table-page`) is a title, at most one primary action, the views of the same rows as tabs, and the
   table. Personal is one register: Kompetens, Samtal and Introduktion och avslut are its tabs, and a person's own
   competences and plan are tabs of their own page.
9. **Hem is a dashboard:** one line under the greeting to ask Clew (amended 2026-11-16: the field "Vad vill du göra?"
   filling the row and the button "Fråga Clew", item 4), then Behöver dig, I dag, Läget and Nyheter, each linking to
   its own place. No tool tiles, no digest sentence, no suggestion chips. The composer that stood there first offered
   the question's options before there was a question and pushed the work down the page.
10. **The rail** (`shell-side-nav`; amended 2026-11-16, product owner, canvas board RailOrder, variant b "Arbetet
    först"): Sök alone at the top, the rail's one utility; Mitt arbete (Hem, Att göra, Kalender, Påminnelser); Min
    enhet for a manager (Personal, Läget); Verktyg (the person's tools, then Alla verktyg); Fråga Clew (Ny fråga first,
    the latest three conversations and Alla samtal); Administration as one row and the person at the foot.
    Administration's sections sit in a panel of its own (`settings-sidebar`). The work comes first because asking
    Clew is one way of doing it, not a place above it, and Ny fråga heads the conversations it starts. Ny fråga and Sök
    as the rail's first two rows, over the work, were built first.
11. **Clew's own look** is the example appearance `themes/clew`: ink indigo as the accent on a cool paper ground,
    the status colours left to status, the ball of thread as the logo. It is applied like any appearance
    ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)); an installation nobody has
    configured is still Astryx Neutral.

12. **The page is a sheet that grows** (amended 2026-11-16, product owner). Every page is drawn by `PageFrame`
    (`apps/web/src/components/page-frame.tsx`). From a tablet up the page is a surface of its own (a `Card`) on the
    ground the rail stands on (`AppShell variant="wash"`), and it fills what the rail leaves at any window width. What
    reads as a column (Hem, a register, a thing's page, a form) keeps Hem's measure in the middle of the sheet. A page
    with a pane of its own (Att göra, a conversation about a thing) lets the pane stand at the sheet's far edge and
    gives the rest to its list or transcript. Two things scroll: the rail, and the page's content under its header,
    which stays. On a phone the page is the window. A sheet as wide as the column, centred or beside the rail, was
    tried the same day and left an empty band beside the rail or beside the sheet on a wide screen.

13. **One status vocabulary** (amended 2026-11-16, product owner; canvas boards Status, StatusPanel and
    StatusElsewhere). Where a thing stands is one of eight states, each with one Swedish word, the same wherever it is
    shown: Behöver dig, Skickas, Väntar, Klart, Delvis klart, Obekräftat, Misslyckades and Hindrat. The tone says how it
    went, the words whose move it is; a state is never told by colour alone. It is drawn in three sizes from
    `packages/ui/src/status.tsx`: the mark in a row (`StatusMark`, a dot and the word, with what it concerns after
    it: "Obekräftat · 1 av 3"), the badge beside a title (`StatusBadge`) and the notice under a title (`StatusNotice`,
    Astryx's `Banner`, never folded). A notice's title says what is unresolved in the person's words, its description
    why and since when, and it carries at most one move: a filled button when the move is the person's, a secondary one
    when it is an offer (Påminn, Ångra); the move is the one the thing has always offered for that state (Kontrollera
    status, the decision again, the review, Ångra, Påminn mig, Ta upp nu, Återöppna), and the others stand under ⋯. A
    plain to-do has no notice: its title and its buttons say what is expected (amended 2026-11-20 by
    [D139](D139-a-card-with-nothing-to-decide-says-what-holds-and-the-person-can-say-the-next-step-is-taken.md):
    a to-do with nothing to decide has a notice with no move, which stands over its buttons). Once something has happened or is in
    the way, the notice takes the place of the buttons and of the grey sentence among them, and "Fråga Clew" and ⋯
    stand under it. `apps/web/src/status-of.ts` is the one mapping from what the item holds (its execution, receipt,
    undo window, what it waits on, a silent system) to a state and its words, keeping every sentence D45, D47, D116 and
    D122 gave a case. The state is said once: no fact repeats it, and a decision already made shows when it was due as a
    plain date, never a red badge. Att göra's queue has a Status column with the mark, so a row and its pane say the
    same word; under its tab Behöver dig, whose name the word is, a row that needs the person shows only what the mark
    concerns ("försenad") beside the dot, or the dot alone, and the dot's name says the whole mark. A thing's read is
    named sections in one fixed order, each under a rule with its count as a neutral badge beside its name and an
    optional link at the end of its heading row: Uppgifter, what the thing consists of (rows
    and their documents, when they are the same things, are one list, each row the link to its document with its own
    mark, the unresolved first), Varför ser jag detta? (which holds every sentence that stood without a heading), and
    Händelser, folded by default in Astryx's `Collapsible`.
14. **Ny fråga is a page of its own** (amended 2026-11-16, product owner; canvas board NyFraga, variant b). "Ny
    fråga" in the rail, and on Alla samtal, leads to `/conversations/new` naming nothing to ask about, which is no
    longer Hem: inside the sheet, centred both ways in a column of at most 720 px, the installation's mark as the
    rail's heading draws it (none when no logo is saved; the native image of
    [D37](D37-header-logo-is-installation-branding.md) to D39, here without a name of its own since the rail names the
    installation), Hem's greeting as the page's level-1 heading, "Vad vill du ha hjälp med?" and the box, which has the
    focus. Under the box, "Fortsätt": the person's three latest conversations, as the rail lists them, each the link to
    the conversation with when it was last active, and "Alla samtal"; and "Fråga någon annan": at most three of the
    other systems' assistants the box's "Till:" menu lists ([D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md)),
    each a row that makes that assistant the box's recipient exactly as the menu does and sends nothing, with "Visa
    alla", which opens that menu. A block with nothing to list is not drawn, and with neither nothing stands under the
    box. The rail marks Ny fråga while the page is open. Sending the first question continues on the conversation's
    own address, which takes the page's place in the history, so Back leads to where the person was. Hem keeps its own
    line (item 4); an address that names a thing (`?card=`, `?person=`, `?unit=`, `?open=`, `?lens=`) keeps its "Fråga om …"
    page with the pane.

The calendar keeps its own page ([D27](D27-event-calendar-is-fullcalendar-themed-with-astryx-tokens.md)) and the
address stays the state: every tab, pane and step is a URL.

**Why.** A person could not predict what a click would do: the same item opened in a panel from Hem, a pane in Att
göra and a page elsewhere, and the panel was at once a peek, a work surface and a conversation. One container per
kind of thing removes the question. Astryx already ships each of these page types as a template, so the rule is also
the cheapest thing to build and to keep accessible; the review found no open source library that would have given
more. The alternatives weighed were a peek panel kept on every page (rejected: it is the ambiguity again) and an
assistant dock in the shell (rejected: a conversation needs the column, and the thing beside it is the context).

**Replaces.** The one panel with the assistant in it of [D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)
(items on the panel and on "Öppna som sida"), the peek panel of
[D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md) (a list is still a
page; a single thing is now a page too), the overlays of the talk and the dialogue, the rail of D112 item 1 and
[D120](D120-a-skill-is-a-holding-with-a-level-and-the-competence-domain-covers-what-a-skills-platform-does.md) item 8, and Hem's blocks as
D112 drew them. The canvas is listed in [design canvases](../reference/design-canvases.md).

**Open.** The competence matrix needs a real grid and is not redrawn; Dialogstöd as a tab is drawn only in outline;
Astryx's templates use `stylex.create` for a few details that Clew's pre-compiled CSS path leaves out; no manual
screen-reader pass has been made. Astryx's `Banner` has no neutral tone, so the notice of "Väntar" is blue like
"Skickas" (its mark and badge are neutral). A heading cannot stand inside the `Collapsible`'s trigger button, so the
folded "Händelser" is a named region whose name is the trigger's text, not a heading in the outline.
