# Design exploration: scheduling and attention · 2026-11-04

Requested: the current UI feels flat; look at how comparable products solve scheduling and notification
UI, then draw design examples for review. Astryx preferred, stepping outside it allowed. Based on `main`
after session 15 and the canvas "Clew uppmärksamhet" (session 7). Two research passes over public
help pages, changelogs and reviews (marketing claims were discounted); the result is drawn on the canvas
**Clew designutforskning · schemaläggning och uppmärksamhet** (Claude Design,
https://claude.ai/artifact/MW2VeKV2pTrVvfLBUnzpki, private until shared), eight artboards in two rows.

## Outcome

Nothing is decided. The canvas proposes six changes to the product, each drawn with Astryx Neutral
tokens and mapped to Astryx components in the blue sticky notes:

1. **Nu / Senare instead of five levels.** One stream with a two-way split, the day word ("tor", "fre")
   in place of a colour for everything that is not due today. Colour stays reserved for today's deadline
   and for receipts.
2. **The day has a rhythm, drawn once.** 06:00 genomgång, the interruptions used of the budget, the 12:00
   and 16:00 samlingar and the quiet hours as one horizontal track on the digest card. An Astryx
   `Stepper` with `indicatorPosition="on-track"`.
3. **Piles at the edge, not sections.** "Pågår utan dig", "Inte nu" and "Klart i dag" as three pills
   docked above the composer, each with a count; the stream above holds only what needs the person.
4. **Snooze that shows where it lands and breaks on activity.** Every preset carries the resolved time
   ("Efter lunch · 13:00", "I morgon · 06:00 i genomgången"), the free text is parsed in place, and a
   watch ("bevaka tills fakturan är attesterad") is the same picker with a condition instead of a time.
5. **Twenty talks are one obligation with four steps**, not twenty bookings: Förslag → Inbjudningar →
   Svar → Klart on the thread, a load bar per weekday, proposals as dashed ghosts in the agenda, the three
   people who could not be placed as judgement calls with one button each, and the plan reviewed as a diff
   (+17, →2, ?3, 0 krockar) with the follow-up policy stated on the thread.
6. **A "passar inte" is a card with two checked alternatives**, each showing what sits around the time,
   never a calendar to search.

## What was looked at

Scheduling: Reclaim, Motion, Clockwise (Prism), Notion Calendar, Amie, Sunsama, Akiflow, Fantastical
(Openings, Proposals), Google Calendar (suggested times, appointment schedules, Gemini), Microsoft
(Scheduling Assistant, Copilot, Bookings), Calendly (Meeting Polls, Pending), Cal.com, Vimcal, Rise,
Morgen, and the e-mail assistants Clara, x.ai, Howie, Lindy.

Attention: Linear Inbox, GitHub notifications, Height, Jira For you, Asana Inbox, Monday My work,
Superhuman, HEY, Spark, Gmail, Outlook Focused, Things 3, Todoist, Sunsama, TickTick, Apple Reminders,
iOS Scheduled Summary and interruption levels, Android channels, macOS Focus, Slack reminders and
to-dos, Teams Activity, Google Chat, Viva Connections, ServiceNow Employee Center, Workday My Tasks,
SuccessFactors For You Today, Personio, Oracle HCM, Zapier Agents, Copilot agent activity, Dust, Lindy,
Intercom and Zendesk ticket states, ChatGPT Pulse, Perplexity Tasks.

## Patterns worth taking

| Pattern | Seen in | On the canvas |
|---|---|---|
| Dotted outline for proposed, solid for confirmed; nothing syncs until approved | Reclaim, Morgen, Clockwise, Outlook (hatched = tentative) | E, H: ghost slots |
| A bulk plan reviewed as a diff with judgement calls, per-item undo and re-plan | Sunsama | E: Granska planen, Oplacerade |
| Capacity per day summed against a threshold | Sunsama, Outlook | E, H: load bar in the day heading |
| Candidates as a property of the invite, invitee sees who else answered | Fantastical Proposals, Calendly polls | F, G |
| A Pending view for what waits on others; it flips back on activity | Calendly, Intercom, Zendesk, Linear, Gmail | A, D: the piles; B: the watch card |
| Decline-triggered "reschedule to" with ranked alternatives and why | Google Calendar, Cal.com | G |
| Follow-up policy stated and editable on the thread | Howie | E, F |
| Snooze presets with the resolved time printed; free text to the minute | Gmail, Superhuman, Linear | B, D |
| Reason as a filterable field, not a tooltip | GitHub `reason:`, ServiceNow card summary | A: "Varför: …" token on every row |
| Time words and position carry urgency; one colour for overdue | Things, Todoist, Monday, iOS levels | A: Nu / Senare, day word |
| Digest as a group header with a count and one sentence, at user-chosen times | iOS Scheduled Summary, Asana summaries | A, D: Genomgången |
| Secondary states as piles at the edge of the screen | HEY Reply later / Set aside | A, D |
| Explicit empty state and one action per card on a phone | SuccessFactors, Oracle HCM | D, H |

## Patterns to avoid

Three inboxes to check (HEY); a colour wall per category; opaque AI ranking as the default sort
(ServiceNow, Outlook Focused); state carried by emoji in titles (Reclaim); silent reshuffling of other
people's meetings (Motion, Clockwise); a time grid on a phone; drag-and-drop as the only way to move a
proposal; shortcut-only discoverability (Vimcal); a catch-all "Later" bucket (Monday).

## Where the canvas leaves Astryx

Nothing requires a second component system. Three drawings have no exact Astryx counterpart and would be
built as props on components that exist: the dashed border on ghost slots and on the "Inte nu" pile
(`Card variant="muted"` has no dashed variant: a gap report), the segmented reply bar in F (three
`ProgressBar`s or one `Grid` of `Token`s), and the day tabs with a load bar in H (`SegmentedControl`
does not take a second line: a `ToggleButtonGroup` with stacked content, or `TabList`). The week agenda
stays Clew's own `WeekAgenda` over Astryx `Grid`.

## Open questions

Listed in the orange sticky note on the canvas: Nu/Senare versus the five levels; whether the piles earn
their 48 px on a phone; whether a watch is its own verb in the composer or a reminder with a condition;
caching free/busy per night for the load bars; what "annan tid" looks like with three or more
alternatives.

## What it led to

Nothing built yet. The product owner reviews the canvas; accepted rows become decisions in
`docs/decisions/` and canvas rows on the main design canvas before any code.
