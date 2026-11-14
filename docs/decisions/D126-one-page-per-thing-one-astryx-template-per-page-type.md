# D126 · One page per thing, and one Astryx template per page type

**Status:** provisional (product owner, 2026-11-14; accepted when a manager outside the repository has cleared a day's queue and handed a question to another system's assistant in it, and a manual screen-reader pass has been made over the queue, a thing's page and the conversation) · **Date:** 2026-11-14 · **Area:** ui

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
4. **The assistant has two homes:** the composer on Hem and the conversation page. "Fråga Clew" on a page starts a
   conversation with that thing beside it. No other page has a composer.
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
9. **Hem is a dashboard:** the composer once, then Behöver dig, I dag, Läget and Nyheter, each linking to its own
   place. No tool tiles, no digest sentence, no suggestion chips.
10. **The rail** (`shell-side-nav`): Ny fråga and Sök; Mitt arbete (Hem, Att göra, Kalender); Min enhet for a manager
    (Personal, Läget); Verktyg; Samtal (the latest three and a page of all); Administration as one row and the person
    at the foot. Administration's sections sit in a panel of its own (`settings-sidebar`).
11. **Clew's own look** is the example appearance `themes/clew`: ink indigo as the accent on a cool paper ground,
    the status colours left to status, the ball of thread as the logo. It is applied like any appearance
    ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)); an installation nobody has
    configured is still Astryx Neutral.

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
screen-reader pass has been made.
