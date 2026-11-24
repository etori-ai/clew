# The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA, reviewed

Date: 2026-11-23. Asked by the product owner as area 9 of a review of the whole repository. Reviewed: `origin/main`
at `9fd4c962`. Review only: nothing was changed, and the fixes come later.

Scope: `apps/web/src` (pages, components, the shell, the status and address helpers), the parts of `packages/ui/src`
the web draws with (the theme, branding, the calendar family, the document reader, Clew's own components),
`packages/site-header`, the theme file and its contrast check in `packages/contracts/src/theme-file.ts`, and the
accessibility suite in `tests/a11y` with its mock of `/api`. The questions were: the Astryx rule, the interface
spaces of D83 and D126, WCAG 2.2 AA, what the suite covers and what its mock invents, the language rule, theme and
branding (D98, D46, D38, D39), and the shared header.

Method: every page and every overlay was read and checked against `docs/reference/interface-spaces.md`, D126, D130
and D27. Candidates that a browser could show were probed with single Playwright files in a compose project of this
worktree's own (`clew-review9`, profile `neutral`, Chromium, the suite's mock of `/api`): a probe of the calendar
tool pages, of the day heading and of WCAG 2.4.11 on five pages, and copies of the eight stale tests of the
baseline's finding 1 with only their out-of-date assertions relaxed, to see what the checks after them say. All of
these files were removed before the commit. The theme check was probed by calling `checkThemeContrast` from
`packages/contracts/src/theme-file.ts` with a theme file in `bun -e` (a pure function; nothing was stored). Three
automated readers were given narrow questions: the coverage map, the mock's answers against the routes, and the
language rule; their claims were checked against the code before anything of theirs was written here, and one was
corrected. No suite was run, nothing was run against the shared database or the running development server, and no
person has reviewed these findings. No screen reader was used.

## Summary

| Severity | Findings |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 5 |
| Low | 13 |

The Astryx rule holds in the code: no hand-rolled element, no second styled system, `styles.css` holds the imports
and body basics, every inline `style` and every `ResizeObserver` has a decision behind it, and FullCalendar is
imported in `calendar.tsx` alone (besides `calendar-theme.ts`, the baseline's finding 14). The interface spaces hold
with one exception: an entry of the calendar opens a dialog over the conversation page (L4). Keyboard paths,
focus return, 2.4.11, 2.5.7, 2.5.8, reflow and the forms' own error handling held wherever they were probed or
read. Clew's own words are Swedish everywhere and its addresses English; English reaches a reader only through
Astryx's untranslated defaults and raw technical messages (L11, L12).

What does not hold:

- **The theme check does not look at the card's ground for the focus ring, marks, icons or the success and
  information text** (M1). An administrator can save a theme whose focus ring on every card is 2.60:1 and whose
  success text there is 2.77:1, and the page says the file has no problems.
- **A calendar entry is a button everywhere it is drawn, and in four places it does nothing** (M2). On the calendar
  tool pages the summary also tells a screen reader that Enter opens an entry, and Enter does nothing.
- **What a source read back about a single row is shown nowhere when the work item has no rows of its own** (M3).
  POB's fault report says "Felanmälan är skickad" and drops the case number the source gave.
- **The suite's mock answers a decision with the source's final answer at once** (M4), so the sequence the server
  actually produces (pending, then the receipt arriving by itself) is never drawn, announced or axe-checked, and two
  fixtures show states the server cannot reach.
- **Most pages' read failure, several empty states and loading surfaces have no spec** (M5), against the rule
  that a new route, view or state gets one.

## Findings

### Medium

#### M1. The theme check leaves out the card's ground for the focus ring, marks, icons and status text

`packages/contracts/src/theme-file.ts:143-169`, with `packages/ui/src/theme.ts:353`.

`THEME_CONTRAST_PAIRS` checks `text-primary`, `text-secondary` and `text-accent` on `background-card`, but `accent`,
`icon-*`, `text-success` and `text-info` only on `background-surface` (and `accent` on `background-body`). The
installation's theme sets `--focus-outline-color` to the accent (`theme.ts:353`), and Astryx's `Card` paints
`--color-background-card` (`@astryxdesign/core` `src/Card/Card.tsx:113`). Hem's boards (`BoardCard`, I dag, Läget)
and the work item's sections (`work-item.tsx`) are cards, so the focus ring, the status dots, the icons and the
success and information words in them are drawn on a ground the check never sees.

Scenario: an administrator uploads a theme file on Administration › Utseende with `background-card`
`#a8c0e8`/`#1d2a44`, `accent` `#3b6fd0`/`#8fb4ff`, `text-secondary` `#1f2a3d`/`#d6def0` and `text-accent`
`#10244d`/`#cfe0ff`. The check reports no problem, the page offers the file, the server stores it. In the light
appearance the focus ring and the accent marks on a card are 2.60:1 (1.4.11 asks 3:1), `text-success` on the card
is 2.77:1 and `text-info` 2.97:1 (1.4.3 asks 4.5:1), and `icon-secondary` is 2.93:1. The base theme passes, so
only an installation's own file reaches this; D98 promises that such a file is refused.

Severity: medium (a WCAG AA failure across every card that the one gate meant to stop it lets through). Established
by calling `checkThemeContrast` with that file and `contrastRatio` for the four pairs in the development container:
`problems: 0 []`, `accent on background-card light 2.60 dark 6.91`, `text-success … light 2.77`, `text-info … light
2.97`, `icon-secondary … light 2.93`.

#### M2. A calendar entry is a button wherever it is drawn, and in four places it does nothing

`packages/ui/src/calendar.tsx:168` (`eventInteractive`, unconditional), `apps/web/src/components/views/panel.tsx:242-276`,
`apps/web/src/pages/tool.tsx:291`; the embeds in `apps/web/src/components/work/action-dialog.tsx:732,746`,
`apps/web/src/components/calendar/event-dialog.tsx:232` and `apps/web/src/components/conversation/conversation.tsx:526`.

FullCalendar's `eventInteractive` makes every entry a `div` with `tabindex=0` and `role=button`. Only
`onItemClick` gives the press a meaning (`calendar.tsx:276-277`), and `PanelBody` passes it only when its caller gives
`onOpenItem` (`panel.tsx:247,259,275`). The tool page calls `PanelBody` without it (`tool.tsx:291`), yet `PanelBody`
always adds "Retur på en post öppnar den." to the calendar's spoken summary (`panel.tsx:246,258,274`, the visually
hidden paragraph inside the calendar's group, `calendar.tsx:142-152`). The action dialog's day, the event dialog's
day and the list in a chat bubble pass no `onItemClick` either.

Scenario: a keyboard user opens Dagens möten (`/tools/calendar.today`) from Hem. The screen reader reads the
calendar's summary ending "Retur på en post öppnar den." Tab reaches "Rektorsmöte, knapp"; Enter does nothing: no
dialog, no new address, no announcement. On Hela veckan the five entries are five such stops. In the action dialog,
where a manager is choosing a time for a talk, each meeting of that day is an extra stop between the fields and the
buttons that does nothing. A role and an instruction that promise an action the control does not have fail 4.1.2
(name, role, value) and mislead under 3.3.2; the entry also has no page its name could lead to (D126 rule 1).

Severity: medium (a keyboard and screen-reader trap of expectation on three pages and in the dialog that books a
talk). Established by a probe on `/tools/calendar.today` and `/tools/calendar.week` at 1440 × 900: `promise=1
events=2 focusable=2`, the focused element `DIV tabindex=0 role=button class=clew-cal-event …`, after Enter `url
same=true dialogs=0`; the week `promise=1 events=5 focusable=5`, `url same=true dialogs=0`. The three embeds by
reading.

#### M3. A single row read back is shown nowhere when the work item has no rows of its own

`apps/web/src/components/work/work-item.tsx:138`, `apps/web/src/status-of.ts:281-284`.

`rowsShown` is `rowsSaySomething(thread) || receipt.rows.length > 1`. A work item with no rows of its own, or one
row that only repeats its title, therefore never draws the receipt's single row, and the done notice says only the
receipt's headline and "Bekräftat av <källa> <när>." The row's `detail`, which `ReceiptRowSchema` requires
(`packages/contracts/src/index.ts:3630-3636`), is shown nowhere: not in the notice, not in a section, not in the toast.
D112 item 10 says the receipt is drawn on the work item "each row read back", and `docs/reference/status/work.md:63`
says the same.

Scenario: on an installation with POB's writes on (`POB_WRITES=create`), a person asks the assistant to report a
broken computer. The work item "Felanmäl dator" has `items: []` (`connectors/pob/connector.mjs:400`). The person
fills in the dialog and sends. POB answers one row: "Ärendet <nummer> är skapat hos IT-supporten med dig som
anmälare." (`connector.mjs:432-441`). The page says "Felanmälan är skickad" and "Bekräftat av IT-supporten i dag
09:41."; the case number, the one thing the person needs when they call the service desk, is gone. Any connector's
work item with no rows and a one-row execute behaves the same.

This follows the baseline's note under "Seen outside" (`work-item.tsx:135-138`). It is narrower than that note and
than the stale tests suggested: the omtanke card and an action from a person's page, where the probe first showed
it, carry a row with a subject on the server (`connectors/hr/connector.mjs:589-598`,
`apps/server/src/modules/entities/actions.ts:124-133`), so there the row is drawn; the suite's fixtures for both
lack that row (M4, and the baseline's finding 1, row 3).

Severity: medium (what was done in another system, and its reference, is withheld from the person who did it).
Established by a copy of `action-dialog.spec.ts` with its stale assertions relaxed: after "Boka samtalet" with
torsdag 13:15 and Bergsåkers skola rum 12 the item said only "Samtalet är registrerat i personalsystemet" and
"Bekräftat av Personalsystemet i dag 09:00", and the check for the row's detail failed; then by reading
`rowsSaySomething` (`apps/web/src/work-items.ts:149-153`) and POB's fault report end to end.

#### M4. The suite's decisions come back final at once, so the sequence the server produces is never drawn

`tests/a11y/support.ts:1787-1834` (confirm, undo, undo-receipt), `:1866-1956` (act), `:596-597` (`/changes`);
`tests/a11y/data.ts:273-307` (`samtal-svar`), `:352-378` (`attest`).

The mock answers `act` with the work item `handled` and its full receipt, `confirm` with the proposals `confirmed`
and a receipt, and `undo` with the item open again; none of them sets `execution`, and `/changes` never sends an
event. On the server these routes record the decision and queue the work: `act` returns the item as it is after
`approve` (`apps/server/src/threads/usecases/decisions.ts:150-164`), and the projection gives it
`execution:{state:'pending'}` and `waitingOn:'källans besked'`; the receipt, `handled` and `confirmed` arrive later,
written only by the projection (`apps/server/src/composition/execution-projection.ts:208-226`), and reach the
browser through `/changes`. Two fixtures are in states that path cannot make: `attest` is `handled` with an
`unknown` row and no execution (the server keeps such an item `open` with `execution.state:'unknown'`, so it is not
under Klart and its notice is "Kontrollera status", `status-of.ts:182-198`), and `samtal-svar` has confirmed
proposals with neither receipt nor execution.

Scenario: what a person meets after "Godkänn" is a pending notice, then, without touching anything, the receipt
replacing it. Whether that arrival is announced (4.1.3), where the focus is when the notice under it is replaced, and
whether Ångra then appears where the focus can reach it, is checked by no test. Instead `executions.spec.ts:123-141`
asserts the focus on the title and the announcement right after Enter, and `undo.spec.ts` and
`action-dialog.spec.ts:61-130` assert Ångra right after the button; `card-actions.spec.ts:366-378`,
`queue.spec.ts:482` and `item.spec.ts:136-157` assert `attest` under Klart with "Obekräftat · 1 av 2". Against the
server these would fail, and the state they stand for (a receipt with an `unknown` execution) is never drawn. The
same blind spot hides that `canUndoReceipt` offers Ångra on a receipt without an execution
(`apps/web/src/receipt-state.ts:14`), which the server always refuses ("Det äldre kvittot behöver kontrolleras …",
`decisions.ts:206-207`); on a new installation the server makes no such receipt, so this is a latent mismatch, not
a visible fault.

Severity: medium (the one automated check of a hard requirement tests a flow the product does not have, at the
point where status announcements and focus matter most). Established by reading the mock and the routes side by
side; the routes, the projection and `receipt-state.ts` were read for this review, the rest of the reading came from
an automated reader and was checked at the lines cited.

#### M5. Most pages' read failure, several empty states and loading surfaces have no spec

The coverage map below; `CLAUDE.md` ("A new route, view or state gets a test in `tests/a11y`").

Every route has a spec except the catch-all `*`, and every view kind except `text` and `document`. The gap is in
states. Sixteen pages outside Administration, and most of its pages, draw a read failure with "Försök igen" that
no spec reaches, because the mock has no failure switch for those reads (entities, boarding, competence, the
protocol pages, conversations, news, the tools catalogue, the admin lists). Hem's Banner for a model that is configured but not answering (`apps/web/src/pages/start.tsx:460-478`,
D8) never shows: the fixture always answers `configured` and `available` alike (`tests/a11y/data.ts:1274-1275`) and
no spec overrides `/api/assistant/status`. The calendar's refused move (`apps/web/src/pages/calendar.tsx:465-470`,
the alert at `767-770`) is never drawn, since the move mock always succeeds. Administration › Utseende's refused
save (`apps/web/src/pages/admin/appearance.tsx:281,404`) is never reached. Nine empty states are never drawn, and the loading surfaces
of `/conversations`, `/tools`, `/items`, the review page, `/boarding`, `/competence`, the matrix, a person's sections
and a lens on Personal are never held open. Twelve states
that are drawn run no axe check, among them Hem's and Att göra's failed first read, the review's refusal and its
uncertain result; in `documents.spec.ts:292` the axe call runs before the 409 it is meant to cover is mocked
(`:294-298`).

Scenario: a change to the shared read-failure notice breaks its focus or its live region on a person's page; the
suite stays green, because no test opens a person's page whose read fails.

Severity: medium (failure states are where 3.3.1 and 4.1.3 are tested, and the suite is the only automated check).
Established by an automated reader that walked every route in `apps/web/src/main.tsx` and every spec test by test;
the claims about Hem's Banner, the `text` kind, the catch-all route, the screenshot specs and the 409 order were
checked in the code.

### Low

#### L1. Three work items in the fixtures cannot be decided on the server, and a catch-all answers any unknown read

`tests/a11y/data.ts:196-244,318-329`; `tests/a11y/support.ts:1682,1957-1960`.

`omtanke` (Boka samtalet), `ledighet` (Godkänn) and `rutin` (Jag har läst) have no rows and no `usesItems`, and
`pattern` ("Se mönstret") has no `input`. The server adds `refs` only with `usesItems`
(`apps/server/src/threads/usecases/decisions.ts:99`); `hr.bookTalk` and its effect read require `refs`
(`connectors/hr/manifest.mjs:240-248`), as does `hr.decideLeave`; `hr.absencePattern` requires `ref` and declares a
`detail` view. The real fixture item carries the employee row with `usesItems: true`
(`connectors/hr/connector.mjs:589-616`). Any `/cap/*` read the mock does not know answers `hr.whoIsOn`'s output with
no view (`support.ts:1682`). Scenario: `action-dialog.spec.ts` books a talk that the server would refuse with 400
"Ogiltig förfrågan till hr.bookTalk.", and `todo.spec.ts:108-155` asserts "Anna Lindqvist 07:00–16:00" on
`/tools/hr.absencePattern`, whose declared detail view is never drawn. The spec's comment says "as the server
resolves their paths" (`action-dialog.spec.ts:22-23`). Severity: low (tests that pass for the wrong reason).
Established by reading the fixtures, the manifest and the route.

#### L2. A spec asserts a person's link by user name, the address D122 forbids

`tests/a11y/answer.spec.ts:180`, `tests/a11y/competence.ts:132-138`.

The competence view's `people` map sends each user name to itself, and the spec asserts
`href=/people/maria.kallstrom?from=…`. The server maps a user name to Clew's id (`viewWithPeople`,
`apps/server/src/threads/usecases/keys.ts:26-35`), Maria's id in the suite is `maria` (`data.ts:1816`), and D122 item
1 says a user name in `/people/<id>` names nobody and is answered 404. Following the asserted link in the suite gives
"Personen finns inte". `views.spec.ts:454` maps it correctly. Severity: low. Established by reading.

#### L3. The mock sends error answers the routes never send, and a calendar card the server never makes

`tests/a11y/support.ts:1765,1789,1821,1852,1878,1966,2182`, `tests/a11y/undo.spec.ts:11-12`, `support.ts:1030-1056`.

The routes' generic 503 body is "Något gick fel. Försök igen." (`apps/server/src/context.ts:58-62`); the mock sends
503 "Källan svarade inte." for dismiss, snooze and reopen, which call no source, and for act, confirm, undo and the
history. A source read that does not answer is a 400 "<källa> svarar inte just nu." on the server
(`packages/connectors/src/remote.ts:126`); the mock sends a 503 with other words, and the web retries a 503 once and
a 400 not at all (`apps/web/src/query-policy.ts:7-10`). `undo.spec.ts` answers `undo-receipt` with 409, which no
route outside SCIM returns. The talks write refusal lacks the server's `code:'denied'` and wording
(`apps/server/src/routes/talks.ts:42,71-74`). The mock's calendar decision card has the wrong id, a title without
"Boka: / Flytta: / Ställ in:", `operation` always `calendar.createEvent` and the trigger copied from the first
thread, so its notice would name Ekonomisystemet (`apps/server/src/modules/calendar/usecases/decisions.ts:137-151`).
Scenario: `optimistic.spec.ts:49-51` and `item.spec.ts:231` assert words a person never reads. Severity: low.
Established by reading both sides at the lines cited.

#### L4. An entry in the pane beside a conversation opens a dialog over the conversation page

`apps/web/src/pages/conversation.tsx:173,187,309-323`, `apps/web/src/components/calendar/event-dialog.tsx`.

The pane's day strip passes `onOpenItem: setOpenItem`, and the page draws `EventDialog` in its view mode: the day
around the entry and its details, over the conversation. D126 rule 3 says nothing opens over a page to show a thing,
and `docs/reference/interface-spaces.md:15` lists "Kalender's entry or range" among what the pane itself shows; the
dialogs of a page are a form or a choice. Scenario: a manager asks about Thursday, the day stands beside the
conversation, Enter on "Rektorsmöte" covers the conversation with a dialog that shows the same day again. The
dialog's move and cancel modes are D27's and are not in question. Severity: low (a space rule, with focus return
intact). Established by reading.

#### L5. The calendar recognises a talk's meeting by its title, which D133 forbids

`packages/ui/src/agenda-items.ts:26,69,84`.

`agendaItems` draws every event whose title starts with "Utvecklingssamtal" as a booked talk and every other event
as a meeting; only a live proposal's `eventRef` is matched by id (`:61`). D133 item 1: "Never by title: a meeting
renamed in the calendar is still the invitation's, and another meeting that carries a talk's title is nobody's."
Scenario: a unit's "Utvecklingssamtal – genomgång" is drawn, counted and spoken as "bokat samtal"
(`packages/ui/src/calendar.tsx:56,342`, `apps/web/src/pages/calendar.tsx:530`), and a talk's meeting that someone
renamed in Outlook is drawn as "Möte". Severity: low (what is said about an entry, not what is written). Follows
the decisions area's note for wave 2. Established by reading.

#### L6. "Startsidan" is hard-coded where the installation's site name belongs

`apps/web/src/page-title.ts:7`, `apps/web/src/pages/login.tsx:5,40`, `packages/ui/src/session.tsx:188`, and sentences in
`apps/web/src/components/views/view.tsx:956,1057,1108`, `panel.tsx:186,311`,
`apps/web/src/components/people/register-holding.tsx:509` and four admin pages.

The shell takes the site's name from the header connector (D88) into the `SiteName` context
(`apps/web/src/components/shell/shell.tsx:44,270`), and `page-frame.tsx` reads it, but every browser tab is titled
"<sida> · Startsidan", the sign-in page and the session's error page say "Startsidan" in their h1, and the read
views say "Inget av det sparas på Startsidan." Startsidan is Clew's earlier name and Sundsvall's intranet. Scenario:
another municipality's installation, whose header names its site "Intranätet", titles every tab and the sign-in
page with a name it does not use. Severity: low (2.4.2 still holds; the product names itself wrongly).
Established by reading.

#### L7. Sundsvall's colours are the examples on Administration › Utseende and in the parser's message

`apps/web/src/pages/admin/appearance.tsx:147,227-228,238-239`, `packages/contracts/src/theme-file.ts:199`.

The field descriptions, placeholders and error messages give `#005595` and `#daeff1`, the values of
`themes/sundsvall/theme.tokens.json:36,47`. `CLAUDE.md` keeps brand colours out of the repository's code, and the
example folder in `themes/` is where they belong. Severity: low. Established by reading.

#### L8. The calendar theme sizes and offsets in pixels where D27 asks for tokens

`packages/ui/src/calendar-theme.css:155,280-281,391,394,597-598,646`.

`min-height: 44px`, the now-dot's `margin: -5px` and `border: 5px`, `top`/`bottom: -4px`, `max-width: 176px`,
`min-height: 36px` and `max-width: 160px`. D27 item 2 says the theme "resolves every colour, spacing, radius, focus
ring and type value to an Astryx token". The 1 px borders fall back from `--border-width` and are not counted here.
Severity: low. Established by reading.

#### L9. The admin pages decide a phone at 720 px, the rest of the app at 767 px

`apps/web/src/pages/admin/models.tsx:49`, `model.tsx:55`, `connector.tsx:126`, `connectors.tsx:72`, `users.tsx:262`,
`provider.tsx:47`; `apps/web/src/media.ts:6`.

`media.ts` says every phone decision follows AppShell's line (`(max-width: 767px)`), and `AdminFrame` uses it
(`admin-frame.tsx:157`); the six pages ask `(max-width: 720px)`. Between 721 and 767 px the frame is in its phone
layout and the page in its wide one (fixed 280 px and 320 px fields, the wide pagination). Nothing breaks at 320 px.
Severity: low. Established by reading.

#### L10. The interface spaces still list "Visa detaljer" as a dialog of a page

`docs/reference/interface-spaces.md:17`.

The table names "Visa detaljer" where the facts do not fit; the code has no such control, and `person.spec.ts:306`
and `unit.spec.ts:208` assert it is gone (the facts stand above the read at 1024 px and below). Severity: low (the
document a new flow is placed by). Established by reading.

#### L11. Astryx's English fallbacks reach a Swedish reader in dialogs, date and number fields and on a phone

`packages/ui/src/locale.ts` (the overrides), `apps/web/src/components/shell/dialog-frame.tsx:47`,
`apps/web/src/pages/competence-search.tsx:564`, the date fields, `admin/competence-requirements.tsx:462`,
`admin/competence.tsx:556`, `conversation/composer.tsx:239`, `conversation/assistant-pane.tsx:292`.

Astryx 0.7.16's `sv-SE` catalogue lacks keys that Clew reaches, and `locale.ts` covers only some of them. An
overflowing `LayoutContent` without a label becomes a group named by `@astryx.scrollRegion.label`, "Content"
(`useScrollRegionProps.js:49`); `DialogFrame` passes no label unless `scrollLabel` is given, which reaches eighteen
dialogs (the action dialog and the booking dialog among them), and `PageFrame` with `pin` and no label reaches
Kalender and the item page. A date field without a placeholder shows "e.g., …" when focused, a date that does not
exist gives "Enter a real date" in all twelve date fields, and a `min` gives "Enter a date on or after …". A number
that does not parse gives "Invalid number" before Clew's own status. Kompetenssökning's `Tokenizer` is `adaptive`,
so on a touch device it opens Astryx's sheet in English throughout ("Search Kompetens", "Save", "Discard
changes?", "Keep editing"). A long paste into the composer becomes a token "3 lines, 450 chars". Scenario: a screen
reader in the action dialog at 320 px hears "Content, grupp"; a manager who types 31/11 in "Datum" reads "Enter a
real date" under the field. English inside a `lang="sv"` document is also read with Swedish pronunciation (3.1.2).
Severity: low (one rule broken in many places; the field error is still described, 3.3.1). Established by an
automated reader that diffed the catalogues and traced each key to its call site; the scroll label, the date and
number keys, their absence from `sv-SE.generated.js` and from `locale.ts`, `dialog-frame.tsx:47` and the Tokenizer
were checked in the code.

#### L12. Raw technical and browser messages are shown as they come

`apps/web/src/components/shell/shell.tsx:218-223`, `apps/web/src/components/work/my-commitments.tsx:93`;
`apps/web/src/pages/admin/connector.tsx:335,752`, `admin/model.tsx:199,391`, `admin/provider.tsx:148`,
`admin/check-result.tsx:105`.

Sign-out puts any `Error`'s message in the toast; `signOut()` throws a Swedish sentence for a refused reply, but a
network failure throws the browser's `TypeError` ("Failed to fetch"). "Mina åtgärdspunkter" on Hem puts any
`Error`'s message in a `role="alert"` paragraph, which includes "Failed to fetch", an abort's message and
`sessionFetch`'s own "Session unavailable" (`packages/ui/src/session.tsx:16`). On the administration pages a
connector's, model's or provider's health detail ("Teknisk orsak: GET …/clew/manifest answered 503."), the check
result's items and the history tabs (`JSON.stringify(h.details)`, `{"from":"draft"}`, and the raw action id when no
label exists) show infrastructure text and JSON. Scenario: a teacher on a train with a dropped connection opens Hem
and hears "Failed to fetch" as an alert. The administration's technical cause is labelled as such and may be meant
for an administrator; the two on Hem and in the toast are not. Severity: low. Established by reading
`errorMessage()` (`apps/web/src/query-policy.ts:52`, which shows only `ApiError` text) against these call sites.

#### L13. The English protocol pages speak Swedish through Astryx without marking it

`apps/web/src/pages/protocol.tsx:96,110,151,192`, `apps/web/src/pages/protocol-preview.tsx:276,520,680`,
`apps/web/src/protocol-preview-model.ts:190-219`.

D60 makes these pages English and they set `lang="en"` while shown (`protocol.tsx:328-331`), but they render under
the `sv-SE` provider, so Astryx's own words come out Swedish: "Kopiera kod", "Flikar" (a `TabList` without a
label), "Rensa Filter the outline", the file input's "Släpp filer här" and "1 fil vald: …". The model's sentences
name "Menar du", "Uppgifter", "Det här händer" and "Händelser" inside English, and the sample-row options show the
Swedish sample titles, all without `lang="sv"`; the deliberate samples elsewhere carry it (`protocol-preview.tsx:285,
297,348`). Scenario: a vendor's developer with an English screen reader hears "Kopiera kod" pronounced as English.
Severity: low (3.1.2 on a developer page). Established by an automated reader; the `lang` switch and the samples'
marking were checked in the code.

## Coverage map

`tests/a11y` at `9fd4c962` against the routes in `apps/web/src/main.tsx`, the view kinds and the states each page
draws. "axe" means a test that opens the route also runs `expectNoAxeViolations` (`tests/a11y/support.ts:2603`) in
the same test. The thirteen `screens.*.spec.ts` files are not counted: they take screenshots and assert nothing.
States every route shares are covered: the first load (`loading.spec.ts:78-115`), the sign-in page when signed out
(`axe.spec.ts:26-31`) and an ended session (`axe.spec.ts:33-41`).

### Routes

| Route | Specs (axe) | States with no spec |
|---|---|---|
| `/login` | login, admin-appearance; the page is axe-checked only through `/calendar` and `/` | the `?reason=` notices (`login.tsx:42-46`) |
| `/protocol/manifest` | protocol (axe) | read error (`protocol.tsx:343-353`), skeleton |
| `/protocol/preview` | protocol (axe) | the dry run's failure Banner (`protocol-preview.tsx:694-697`) |
| `/calendar` | calendar, axe, header, reliability, shell, login (axe); eight more | a refused move (`calendar.tsx:465-470`, `767-770`) |
| `/tools/clew.news` | hem (axe) | failed (`news.tsx:78-87`), "Inget att visa", skeleton |
| `/tools/competence.approval`, `/tools/boarding.plan`, `/tools/boarding.person` | competence-matrix, boarding (redirects; `boarding.person` without axe) | "Planen finns inte" (`boarding.tsx:902-906`) |
| `/tools/:capability` | views, tools, errands, requests, keyboard, competence, axe, documents (axe) | the areas read failing (`tool.tsx:158-164`) |
| `/tools` | tools (axe) | failed (`tools.tsx:110-124`), loading |
| `/staff` | staff, talk, action-dialog, person, register-holding, review (axe) | list error (`staff.tsx:288-301`), skeleton, "Ingen medarbetare på enheten" |
| `/competence` | competence (axe) | read error (`competence.tsx:431-445`), loading |
| `/competence/matrix` | competence-matrix (axe) | read error (`:1010-1024`), "Inga medarbetare att visa", loading |
| `/competence/search` | competence-search (axe) | the options read failing (`:541-555`) |
| `/people/:key` | person, talk, register-holding, action-dialog (axe) | read error (`person.tsx:401-412`), section skeleton, "Inget mer att visa" |
| `/boarding` | boarding-list (axe) | plans error (`:108-122`), suggestions error, loading |
| `/boarding/:personId` | boarding, boarding-start (axe) | read error (`boarding.tsx:345-356`), "Planen har inga punkter", the action-refusal Banner |
| `/units/:id` | unit, dialogue (axe) | read error (`unit.tsx:429-441`), head-count failure, empty |
| `/units` | units (axe) | list error (`units.tsx:222-225`), the page's own skeleton |
| `/admin` | admin (axe) | "Inget att administrera ännu"; `NotAdmin` checked on `/admin/connectors` only |
| `/admin/connectors`, `/admin/connectors/:id` | admin, admin-boarding, menu (axe) | list error, empty; a missing connector, read error |
| `/admin/models`, `/admin/models/:id`, `/admin/models/providers/:id` | models (axe) | error, empty; a missing model or provider, read error |
| `/admin/users` | users (axe) | none |
| `/admin/organisation` | organisation (axe) | none |
| `/admin/appearance` | admin-appearance (axe) | a refused save (`appearance.tsx:281,404`) |
| `/admin/competence`, `…/sources`, `…/requirements`, `…/import` | the four admin-competence specs (axe) | the read errors, the merge preview's error, "Ingen rad matchar" |
| `/admin/boarding`, `/admin/boarding/import` | admin-boarding (axe) | read errors, "Inga lager ännu" |
| `/todo` | 22 specs, axe in 15 | "Tomt här" (`todo.tsx:649-660`, asserted only absent) |
| `/items/:threadId` | item, action-dialog, answer, axe, review (axe) | read error (`item.tsx:100-112`), skeleton |
| `/items/:threadId/review` | review, documents (axe) | read error (`review.tsx:154-163`), skeleton |
| `/cards/:id`, `/cards/:id/review`, `?review=` | item, review (redirects) | none |
| `/` and the redirects from `/?tab=`, `/?area=` | 32 specs, axe in 20 | the model-down Banner (`start.tsx:460-478`) |
| `/conversations` | menu (axe), shell | empty (`conversations.tsx:153-155`), failed (`:136-150`), loading |
| `/conversations/:id`, `/conversations/new` | answer, handover, new-question, models, todo (axe) | opening fails (`conversation-context.tsx:709`), asking fails (`:447`), loading, the pane's "Ärendet finns inte längre" |
| `*` | none | the whole route (it draws Hem, `main.tsx:459`) |

### View kinds

Nine kinds (`packages/contracts/src/index.ts:1006-1014`), all drawn by `apps/web/src/components/views/view.tsx`.
`table`, `list`, `detail`, `record`, `metrics`, `series` and `activity` have specs with axe (`views.spec.ts`,
`documents.spec.ts:302-311,380-396`). **`text` has none**: no fixture read declares it (the `kind: 'text'` in
`data.ts:96` is a dialog field). **`document` has none as a view**: the reader is exercised inside the record view
and on the review page, but no spec opens a `document` view (`view.tsx:900-911`).

### Drawn without an axe check

Att göra's failed first read (`queue.spec.ts:89-96`) and the optimistic refusal (`optimistic.spec.ts:40-58`); Hem's
failed read (`loading.spec.ts:180-194`) and every held loading surface in `loading.spec.ts:147-176`; Händelser
failed (`item.spec.ts:223-241`); the review's refusal, uncertain result and document outage; Användare forbidden;
Organisation empty and forbidden; the competence search failing; a refused tick on a plan; a refused action on a
person's page; and the preview's 409 (`documents.spec.ts:292`, axe before the 409 is mocked).

### Mock fixtures the server cannot produce

Beside the baseline's decided-item fixture (its finding 1, row 3), which is not repeated:

| Fixture or answer | What the server does instead | Specs that rely on it | Here |
|---|---|---|---|
| `act`, `confirm`, `undo`, `undo-receipt` answer final at once, no `execution`, no `/changes` events | records the decision, the item is `pending`; the receipt arrives later | executions, undo, action-dialog | M4 |
| `attest`: `handled`, an `unknown` row, no execution | `open`, `execution.state:'unknown'`, "Kontrollera status" | card-actions, queue, item | M4 |
| `samtal-svar`: confirmed proposals, no receipt, no execution | `confirmed` only with the execution's receipt | calendar and Hem specs | M4 |
| `omtanke`, `ledighet`, `rutin` without rows or `usesItems`; `pattern` without `input`; the `/cap/*` catch-all | 400 for missing `refs`/`ref`; the declared detail view | action-dialog, todo, cache | L1 |
| the competence view's `people` maps a user name to itself | maps it to Clew's id | answer | L2 |
| 503 "Källan svarade inte.", 409 on undo, talks refusal without `code` | 503 "Något gick fel. Försök igen.", 400 for a silent source, no 409 | optimistic, item, undo, action-dialog | L3 |
| the calendar decision card | another id, title, operation and trigger | none asserts it yet | L3 |

Most bodies built inside `MockApi.handle` are not typed against a route's output (`/cap/*` answers are `unknown`),
so none of this fails the type check.

## The wave-1 points followed up

- Baseline finding 1, the eight stale tests: with only their out-of-date assertions relaxed, every check after them
  passed except the read-back detail of a one-row receipt, which is M3 (narrowed: on the server it shows for the
  omtanke card and a person's page, and is lost for an item with no rows).
- Baseline finding 12, the week page's heading order: on the day page the level-3 day heading sits inside
  FullCalendar's `aria-hidden` header (`H5 inHidden=true`), so axe sees no skip there; the week's skip stands as the
  baseline reported it.
- The baseline's "Seen outside" note on `work-item.tsx:135-138`: M3.
- The decisions area's note for wave 2, `agenda-items.ts` and titles: L5.
- The assistant area's finding 1 (Astryx `Markdown` draws outside images) is in the web's conversation components
  and is not repeated.

## Not established

- Whether a screen reader announces the receipt's arrival by `/changes` and where the focus lands; no flow of the
  real sequence exists in the suite (M4), and no screen reader was used.
- The shared header's custom element mounts its Swedish UI without `lang` (`packages/site-header/src/embed.tsx:341-345`);
  right only on a host page that is `lang="sv"`.
- `packages/ui/src/document.tsx:228` marks every previewed Office document `lang="sv"`, whatever its language; an
  assistant answer in English carries no `lang` either.
- Whether Kalender's page content without a label (`apps/web/src/pages/calendar.tsx:758`) overflows and so takes
  the name "Content" (L11), or FullCalendar scrolls on its own.
- How `/api/areas`' `systems` without Clew's own connectors changes the row marks on Hem; the fallback showed no
  difference on reading.
- Whether the composite search turns a source's user name into Clew's id for a hit's subject
  (`tests/a11y/unit-data.ts:292` uses the id).
- Hem's model-down Banner's announcement and focus: drawn by no spec (M5).

## Looked at and found sound

- `packages/ui/src/styles.css`: the Astryx imports, Raleway and `html`/`body` basics only; `document.css` is D79's.
- No hand-rolled element and no second styled system in `apps/web/src`, `packages/ui/src` or `packages/site-header/src`.
- Every inline `style`: the corner's position (`assistant-corner.tsx:81`, D130), the logo (`shell.tsx:80`,
  `site-header.tsx:228`, D37/D39), the protocol's outline panel (`protocol.tsx:216`, D60 item 5); every `xstyle` is
  Astryx's `useEntryAnimation`.
- Both `ResizeObserver`s are sanctioned (`todo.tsx:134`, D112 gap 4; `document.tsx:108,249`, D79); the corner's
  scroll and focus listeners are D130's; every media query goes through Astryx's `useMediaQuery`.
- FullCalendar's confinement to `calendar.tsx` (beside the baseline's finding 14); `calendar-theme.css` has no hex
  value; its `outline: none` (`:156`) is on a day header that takes no focus (`navLinks={false}`).
- The calendar's drag has a button alternative everywhere ("Flytta förslaget", "Flytta …"; 2.5.7).
- The panes: Astryx's `ResizeHandle` with arrow keys and a kept width; ✕ and Esc return the focus as the spaces say.
- Every overlay walked: the action dialog, the booking dialog, the event dialog on Kalender, Kompetens's dialogs,
  the admin dialogs (forms or choices), the unit drawer of D124 (an open question, not reported), the header's
  sheets and popovers; each closes with Esc and gives the focus back to what opened it.
- WCAG 2.4.11 on `/calendar` (desktop and phone), `/`, `/items/omtanke` and `/conversations/new`: `hidden=[]
  unmarked=[]` on 26, 20, 33, 6 and 5 stops.
- 2.5.8: no control under 24 px found; the smallest drawn is 28 px.
- Clew's forms mark a field in error with its status and a Swedish sentence (3.3.1, 3.3.3; Astryx's own date and
  number messages are L11); sign-in has no cognitive test (3.3.8); no form asks again for what it was given (3.3.7).
- Toasts are a live region; the page title helper names each view (2.4.2) and speaks a client-side change (4.1.3).
- The status mark on rows says its word beside the dot (1.4.1).
- `lang="sv"` on the document; the protocol pages switch to `en` and mark their Swedish previews `lang="sv"` (D60).
- Addresses (D43): every route, query parameter and value is English; the admin pages' Swedish tab and filter values
  (`oversikt`, `formagor`, `alla`, …) are component state and DOM ids only and never reach the address.
- Theme and branding: one appearance read from `GET /api/appearance`; colour only in the file; the band's text is
  chosen by contrast; the logo keeps its aspect (`objectFit: contain`), its plate comes from Astryx's Neutral palette
  (D39) and it survives forced colours.
- `packages/site-header`: a shadow root with adopted style sheets, `all: initial` on the host, its own layer
  provider, overlays inside the shadow root, and `safeHref` refusing `javascript:`, `//` and control characters.

## Seen outside this area

- Calendar domain: `weekends={false}` (`packages/ui/src/calendar.tsx:164`) hides a meeting booked on a Saturday from
  every calendar surface.
- Identity: `packages/ui/src/session.tsx` hides the waiting app with opacity, which leaves it in the accessibility
  tree.
- Baseline: `playwright.config.ts` has `testDir: '.'`, so any stray spec file in `tests/a11y` joins the suite.
