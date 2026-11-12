# Parity with the startsidan prototype

The product manager's prototype of the start page is a wishlist drawn as a product: it runs on invented data and says so. This page is the checklist of what it asks for and whether Clew's architecture can carry each item. It is not a list of what is built ([implementation status](status.md) is) and not a plan: the order of work is the product owner's.

**Read at.** Prototype repository `etori-ai/startsidan-prototype`, commit `a623404` (2026-11-11): the feature list, the requirement picture for UX, the two requirement specifications (Dialogstöd, Målgruppsingång), the definition of version 1.0, the workshops of 8 October and 10 November, the vision, the module plans and the decision records. Clew at `main` on 2026-11-11, after the organisation tree landed.

The prototype's feature list lives in its project site's database; the repository holds the start data, so wishes added on the site later are not here.

## How to read and keep this page

| Verdict | Meaning |
|---|---|
| Built | Works in this checkout, usually against fixtures |
| Ready | The architecture carries it as it is. What is missing is a connector to the source system |
| Extension | The architecture carries it. The platform needs a bounded change |
| New block | The architecture carries it. A building block has to be designed and built first; see [building blocks](#building-blocks) |
| Line decision | The [vision](../vision.md) says today that this is not Clew. A product decision settles it |
| Not made for | The chosen architecture does not do this; it is solved outside Clew |

- A feature that a connector with declared views, cards or a figure can deliver is Ready, whatever the vision says about who authors the content.
- Ready says the contracts hold the feature, not that it is small. Every such row needs a source system with an interface to read from.
- Built nearly always means against fixtures. One connector has met a product that was not written for Clew.
- Change a row in the change that makes it untrue, and recount the summary. When the prototype moves, read it again and update the line "Read at".
- The verdicts are a judgement from the contracts and patterns that exist. No building block below is designed, and a design can find obstacles this page does not show.
- Extensions and new blocks are new surface, which waits for the first real integration ([D101, the first real integration](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)). That rule decides when, not whether.

## Summary

The prototype's feature list has 40 features. The architecture carries 38 of them.

| Verdict | Features |
|---|---|
| Built | 13 |
| Ready | 14 |
| Extension | 8 |
| New block | 3 |
| Line decision | 2 |

Version 1.0 leans on the harder rows, and Hem now holds most of them ([D111, amended 2026-11-11](../decisions/D111-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md)): of its seven modules five are built against fixtures, one is ready, and one waits for a line decision. Dialogstöd is counted as built for its figures, drawn on Hem as Läget; its dialogue needs two building blocks.

## Version 1.0, for managers

The prototype defines version 1.0 as three functions of the shell and seven modules (`apps/portal/src/shell/version.ts`).

| Part of version 1.0 | Verdict | What it needs | In Clew |
|---|---|---|---|
| Att agera på and Mina aktiviteter | Built | Real sources | [Approved writes](status/work.md#approved-writes) |
| Personal | Ready | Connectors for employment, competence and cases; each becomes its own section without changing the page | [Personal](status/people.md#personal) |
| Dialogstöd: the figures | Built | Läget's tiles on Hem under the three blocks, headed by the unit with "Öppna dialogstödet" leading to the unit's page, against fixtures. Real figures need a connector to the data warehouse; key figures, charts with tables, tone, "last updated" and a minimum group size fit today's views | [Hem under the box](status/interface.md#hem-under-the-box), [Views](status/views.md), [sick-leave statistics](status/connectors.md#sick-leave-statistics) |
| Dialogstöd: the dialogue | New block | B1 and B2: status with history, activities and notes as an owned domain, and following a branch of the tree | [Organisation tree](status/identity.md#organisation-tree) |
| Nyheter | Built | Against a fixture: a news profile, `<id>.news`, joined as `clew.news`; the three newest as a block on Hem and "Alla nyheter" as a tool's page an administrator can place in the menu. A connector to the news source | [News](status/connectors.md#news), [Hem under the box](status/interface.md#hem-under-the-box) |
| Fokusnyhet | Built | Against a fixture: a work item whose receipt action the source marks is a callout between the box and the blocks, with "Läs" and the receipt, until the person has acknowledged it. Drawn as Astryx's banner, not as a picture surface. A connector to the news source | [Hem under the box](status/interface.md#hem-under-the-box), [Fixture connectors](status/connectors.md#fixture-connectors) |
| Min AI | Line decision | A link to Eneo in the header works today. Inside Clew it needs the path for [tools with their own interface](#tools-with-their-own-interface) | [D14](../decisions/D14-clew-stands-alone-eneo-enhances.md) |
| Verktygslådan | Built | The tools an administrator placed, as tiles on Hem, and a link to the intranet's own page of tools when the shared header marks one. The page itself is editorial and stays the intranet's ([not made for](#not-made-for)) | [Hem under the box](status/interface.md#hem-under-the-box), [Views and menu tools](status/views.md#views-and-menu-tools) |
| The AI field | Built | | |
| Anpassa startsidan | Line decision | B8, if the line moves | |
| The intranet's menu | Ready | A connector to the intranet's content system; the header already takes its places from a connector | [Shared header](status/interface.md#shared-header) |

## The feature list

The prototype's own ids are kept so a row can be found in `apps/projekt/src/app/(projekt)/funktioner/funktioner.ts`.

### Infrastructure

| Feature | Id | Verdict | What it needs | In Clew |
|---|---|---|---|---|
| Skalet och modulkontraktet | `modulkontrakt` | Built | | [Remote connectors](status/protocol.md#remote-connectors) |
| Designsystemet | `designsystem` | Built | | [Theme and logo](status/interface.md#theme-and-logo) |
| Adaptermönstret och kontraktet för uppgifter | `adapter` | Built | | [Fixture connectors](status/connectors.md#fixture-connectors), [Nextcloud Approval](status/connectors.md#nextcloud-approval) |
| Appkatalogen | `appkatalog` | Built | An administrator's registry with an audience per connector, not a catalogue a person browses | [Remote connectors](status/protocol.md#remote-connectors) |
| Teknikval för drift | `teknikval` | Built | Settled | |
| Backend med sessioner och lagring | `bff` | Built | | |
| AI-motorn: Eneo först | `ai-motor` | Ready | Any model behind an OpenAI-compatible endpoint; not run against Eneo. A source that speaks MCP is reached through a connector | [Model configuration](status/operations.md#model-configuration) |
| Inloggning med kommunens konto | `inloggning` | Built | OIDC; automatic sign-in on the organisation's computers is the identity provider's | [Users and identity](status/identity.md#users-and-identity) |
| Användare och organisation via SCIM | `scim` | Built | Only the synthetic provisioner has pushed | [Users and identity](status/identity.md#users-and-identity), [Organisation tree](status/identity.md#organisation-tree) |
| Grundtjänster via adapter (post, SMS, notiser, signering) | `grundtjanster` | New block | B4, deferred and to be built | |
| Intranätets väg in | `intranat` | Ready | The connector to the intranet's content system is explored, not built | [Shared header](status/interface.md#shared-header) |
| Drift, kvalitetsgrindar och driftstatus | `drift` | Ready | Disruption notices from the IT department become a connector | [Observability](status/operations.md#observability) |

### Basic functions

| Feature | Id | Verdict | What it needs | In Clew |
|---|---|---|---|---|
| Dagens uppgifter och topp 5 | `idag` | Built | "Top five" and a day or week switch are small additions | [Approved writes](status/work.md#approved-writes) |
| AI-assistenten som hittar och gör | `assistent` | Built | The assistant proposes, the person decides; dictation is built. Acting alone within limits is a chosen direction, not built ([D104](../decisions/D104-the-model-does-the-work-a-floor-holds-without-it-and-the-assistant-may-act-alone-within-limits.md)) | |
| Sök och tydlig struktur | `sok` | Ready | Each new source offers its own search | [Search](status/protocol.md#search) |
| Dokument, rutiner och protokoll | `dokument` | Ready | A connector to the document source. Must-read with a receipt runs against a fixture | [Document catalogue](status/views.md#document-and-semantic-catalogue) |
| Kalendern | `kalender` | Built | | [Calendar](status/calendar.md#calendar) |
| Notiser och påminnelser | `notiser` | New block | B4 and B5, deferred and to be built | [Browser updates](status/work.md#browser-updates) |
| Nyheter och information | `nyheter` | Built | Against a fixture: the news profile, Hem's block and "Alla nyheter"; a connector to the news source. Opting out of feeds needs B8 | [News](status/connectors.md#news) |
| Kontakt och support | `kontakt` | Ready | Disruption status and "who is responsible for what" become connectors | [Errands](status/connectors.md#errands) |
| Snabbåtgärder och genvägar | `snabbatgarder` | Extension | Actions from the menu exist; a person's own shortcuts need B8 | [Actions about a person](status/people.md#actions-about-a-person) |
| Min startsida, mina val | `mittval` | Line decision | B8, if the line moves | |
| Mallar på en plats, med AI-stöd | `mallar` | Ready | A search source for templates; Word files are already previewed | [Document catalogue](status/views.md#document-and-semantic-catalogue) |
| Startsidan efter roll | `roll` | Extension | Content follows role and unit. A person with several assignments cannot switch between them yet | [Users and identity](status/identity.md#users-and-identity) |
| Navigering och meny | `navigering-och-meny` | Built | | [Interface spaces](interface-spaces.md) |
| Mitt konto och inställningar | `mitt-konto-och-installningar` | Extension | B8 | |
| Intranätets meny i startsidan | `intranatets-meny-i-startsidan` | Ready | The connector to the intranet's content system | [Shared header](status/interface.md#shared-header) |
| Hjälp, introduktion och återkoppling | `hjalp-introduktion-och-aterkoppling` | Extension | Nothing exists; nothing in the architecture is in the way | |

### Services

| Feature | Id | Verdict | What it needs | In Clew |
|---|---|---|---|---|
| Utvecklingssamtalet | `utvecklingssamtal` | Extension | The round, booked and held, and action points exist. The record (preparation, notes, both approving) is not built | [Talks](status/people.md#utvecklingssamtal-talks) |
| Chefens dashboard med nyckeltal | `dashboard` | Ready | A connector to the data warehouse. A person choosing their own figures is the line decision under `mittval` | [Views](status/views.md) |
| Min personal | `min-personal` | Ready | See version 1.0 | [Personal](status/people.md#personal) |
| Personalärenden | `personalarenden` | Ready | Leave, absence and deviations run against fixtures; rehabilitation needs a connector to its system | [Fixture connectors](status/connectors.md#fixture-connectors) |
| Kompetensregistret | `kompetens` | Ready | A connector gives a section per person, a column on Personal and cards when a certificate expires. Uploading evidence needs B6 | [Sources about an entity](status/people.md#sources-about-an-entity) |
| Ledighet och frånvaro | `ledighet` | Ready | Balance, requests and decisions run against a fixture | [Fixture connectors](status/connectors.md#fixture-connectors) |
| Felanmälan som samtal | `felanmalan` | Extension | A short report with a few fields works today. The form filled in beside the conversation needs B3 | [Errands](status/connectors.md#errands) |
| Utvecklingsförslag | `utvecklingsarende` | New block | B3 and B6 for a simpler document. The workspace the prototype draws is a [tool with its own interface](#tools-with-their-own-interface) | |
| Schema, bemanning och vikarier | `schema` | Ready | A connector to the scheduling system | [Fixture connectors](status/connectors.md#fixture-connectors) |
| Någon börjar, någon slutar | `boarding` | Extension | The engine exists: one approval that starts work in several systems. It has no interface yet, and a checklist needs B3 | [Jobs across systems](status/work.md#jobs-across-systems) |
| AI inför möten | `moten` | Extension | The calendar and search exist; the preparation is not built | [Calendar](status/calendar.md#calendar) |
| Målgruppsingång | `malgruppsingang` | Line decision | The hub is editorial ([not made for](#not-made-for)). The tools behind it can be connectors | |

## Building blocks

The eleven features that do not fit today come back to eight building blocks. The architecture carries all eight.

| Block | Exists to build on | Missing | Unlocks |
|---|---|---|---|
| **B1 · Following a branch of the organisation tree.** Largely built | Units form a tree pushed over SCIM; a manager sees their direct reports, including the managers of the nearest units below; an administrator sees the whole tree ([D99, the organisation tree](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)) | Nothing follows a branch: opening the units below one's own and continuing down, a figure summed over a branch, a connector told where in the tree a unit sits | Dialogstöd for managers at every level, aggregation up the organisation |
| **B2 · Records a person writes about a unit or a person** | The owned-domain pattern, proven by talks ([D95](../decisions/D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md), [D96, talks](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)) | Notes, activities and a manual status with history | Dialogstöd's dialogue, notes on Personal |
| **B3 · Forms and guided flows** | A proposal becomes a card the person approves; short input with a few fields works | A view the person writes in: a form beside the conversation, a document in steps, a checklist, a knowledge test. The view catalogue grows by decision ([D100, the narrowed vision](../decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md)), so this is a new view kind | Fault report as a conversation in full, on- and offboarding, the work aids of the audience entrance |
| **B4 · Reaching the person outside the page.** Deferred, to be built | Durable timers, reminders and an attention budget | A channel out (push, e-mail, SMS) as an adapter per service, and the person's choice of what notifies | The notification requirements, base services through an adapter |
| **B5 · A notification inbox** | The bell counts the person's own reminders; the page updates when something changes | Read and unread, other kinds of notice, word that something was handled automatically | |
| **B6 · Attaching a file** | Authorised delivery and preview of PDF, Word and Excel with versions | The other direction: a person uploads a file to a source | Evidence in the competence register, files on notes, material for the development proposal |
| **B7 · The year and legal requirements** | Cards with a deadline and an attention level that already order the list | A period that is current (the salary review) and decides what is lifted and held back; a field that marks a task as a legal requirement so it sorts first | What HR asked for |
| **B8 · A person's settings and languages** | Light and dark, kept in the browser | Settings stored per person in the server (text size, notifications, own shortcuts), a place to see and clear what the assistant knows, texts that can be translated | Account and settings, own shortcuts, opting out of feeds |

## Tools with their own interface

In the prototype every module brings its own screens. A connector does the opposite: it says what its data is and Clew draws it ([D38, declared views](../decisions/D38-views-are-declared-by-connectors-and-drawn-by-clew.md)). That keeps the interface uniform and accessible, and it does not carry a tool with its own workspace, such as the development proposal's tables and calculations or the poster and mailing tools of the communication entrance.

A second lane for that has been tried and is not in the code. On 8 and 9 November 2026 a gateway was built for services that speak standard MCP and bring their interface as an MCP App, shown in an isolated frame and opened from a card. It needed no Clew contract from the provider and kept Clew's rules around it: access checked in the server, the person's confirmation before a write, audit, and cards when something new waits. It fitted the architecture and could be built. It was removed on 11 November and [D81](../decisions/D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md) withdrawn because there was no use case then ([closing note](../reviews/2026-11-11-external-mcp-chat-services-exploration.md)). The prototype's tools are such a use case.

If the lane is taken up again it needs per-person sign-in at the provider (the large part), a production sandbox, an administration page and an accessibility requirement on each tool, since Clew cannot repair a provider's interface. It met two invented services and no real provider. Until then such a tool lives as its own service behind a link in the header, and Clew carries the task, the decision and the receipt.

## Not made for

| Promise in the prototype | Why | Where it is solved |
|---|---|---|
| Content written and edited in the start page: hub pages with areas and cards, editing without a deploy, reviewers' comments | Clew has no content store and no editor. Showing content written elsewhere, such as news, is a connector | The intranet hosts the pages under the same header, and Clew searches them |
| Open content without sign-in | Everything in Clew is built around a signed-in person and their scope | The intranet |

## Chosen away, and possible

These are not held back by the architecture. They wait for the product owner; see [open questions](../maintainers/open-questions.md).

| Item | What it would take |
|---|---|
| A person arranges the start page, opts out of parts and chooses their own figures | B8. Today an administrator chooses what appears in fixed places |
| Min AI inside Clew | The lane for tools with their own interface. A link to Eneo works today |
| A picture for HR of when managers are heavily loaded | Group-level figures can come through a connector to the data warehouse, as sick leave does. Clew itself is not a data warehouse |
| Taking up the lane for tools with their own interface again | See above |

## The requirement specifications

### Dialogstöd

| Requirement group | Verdict | What it needs |
|---|---|---|
| Data cards per unit: value, target, trend, tone, chart with an explanation, "last updated", missing shown as missing, the source's minimum group size (D-6 to D-20, DATA-5 to DATA-9, NIV-14 to NIV-16) | Ready | A connector to the data warehouse; thresholds and interpretation texts are the connector's |
| Every manager opens on their own unit; refusal looks like "does not exist"; a change of assignment applies by the next day (NIV-1 to NIV-3, NIV-6 to NIV-9) | Built | Scope is checked in the server on every call |
| A manager opens the units below and continues down, never above (NIV-4, NIV-13, NIV-17) | Extension | B1: the tree exists, nothing follows a branch yet |
| A manager of several units chooses, and the choice is remembered (NIV-5) | Extension | B8 |
| Dialogue questions per area, general and per unit (D-21, D-25 to D-27) | Ready | A text or list view from a connector |
| Manual status with a comment and an append-only history (D-22 to D-24) | New block | B2 |
| Activities per unit and area, seen by the manager and the managers above (D-28 to D-30, NIV-10) | New block | B1 and B2 |
| Notes per unit and area, personal to the author, with files (D-31 to D-35) | New block | B2 and B6 |

### Målgruppsingång

| Requirement group | Verdict | What it needs |
|---|---|---|
| A new entrance without code, edited without a deploy, every change logged, reviewers' comments (MGI-1 to MGI-5, MGI-18, MGI-19) | Not made for | The intranet |
| Own tools and integrations per entrance, connected through the app catalogue (MGI-20 to MGI-24) | Built | This is a connector with declared views and a menu row; a tool with its own screens is the lane above |
| Answers with sources, suggesting only what exists (MGI-7, MGI-8, MGI-11) | Built | The box answers with citations |
| An assistant per entrance and per topic page (MGI-6, MGI-9, MGI-10) | Line decision | Assistants with their own knowledge are Eneo's |
| A contact person by the employee's department (MGI-12 to MGI-14) | Ready | A connector, or the directory |
| The work-aid library: checklist, knowledge test, a form that becomes a document, templates (MGI-16, T-7) | New block | B3; templates alone are Ready as a search source |
| Fault reports and orders followed on the start page, disruptions, "Mina system" by unit, an idea followed into the project portfolio (DAI-1 to DAI-10) | Ready | Connectors to the case system, the system register and the project portfolio; the writing parts need B3 |
| Open parts without sign-in (T-14) | Not made for | The intranet |

## What HR asked for on 10 November 2026

| Wish | Verdict | What it needs |
|---|---|---|
| Collect the notices from many systems and show status, not one more reminder | Built | |
| What is a legal requirement with a deadline comes first | Extension | B7, and an owner of the list of legal requirements |
| Remind before the deadline and say the next step (plan for return, personnel cases) | Ready | Connectors to the rehabilitation and case systems |
| The payroll approval list with the deviations first | Ready | A connector to the payroll system; review one item at a time exists for invoices |
| Reminders to enter and remove sick leave | Ready | The job across HR, time report and payroll runs against fixtures |
| Certificates and authorisations that expire | Ready | See `kompetens` |
| Templates and guidance beside the case | Ready | A search source |
| Remind the manager above about managers who have not done the introduction | Ready | A source for completed training; a manager already sees the managers of the units below |
| The year decides what is current | New block | B7, and an owner of the year plan per department |
| Guided recruitment and a checklist when someone starts | New block | B3. Steps that cannot be skipped belong in the source system; Clew shows and reminds, and does not model the process |
| A picture for HR of when managers are heavily loaded | Line decision | See [chosen away](#chosen-away-and-possible) |

## The prototype's shared requirements

| Requirement | Verdict | Limit |
|---|---|---|
| G-1 WCAG 2.2 AA | Built | A suite per route; no screen-reader pass on any flow |
| G-2 As good on a phone as on a computer | Built | Phone layouts; no pass on a device |
| G-3 Not everything for everyone | Built | Scope from provisioned groups, checked in the server |
| G-4 Say when something does not work | Built | A silent source is said on the page |
| G-5 AI proposes, the person decides | Built | |
| G-6 Plain Swedish | Built | Swedish only: other languages are B8 |
| G-7 Few clicks | Built | Not measured |
| G-8 One whole with the intranet | Ready | The shared header; the connector to the intranet's content system is not built |
| G-9 Enter a thing once | Built | Against fixtures |
