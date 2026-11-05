# Connector administration

How an administrator connects a system to a running Clew, decides who sees it, and keeps it healthy, from
the browser and without a restart; and, on the same surface, which model providers and models the composer
may use (D24). Implements D22 (the word), D23 (the database as the only registration path) and D24.
Status: D23 built 2026-11-04 (sessions 15 and 18): the rows, the loader, governance in the registry, bundled connectors as
rows, the admin use cases and API, the shared checker, reconciliation without a restart, the screens and their tests.
The canvas row for the screens is still to be drawn and compared against (`CLAUDE.md`). D24 (section Modeller) built
2026-11-05 (session 29).

## The model

One row per connector in Postgres, one `Connector` in the live registry per enabled row. Bundled connectors (people, the
calendar, the mocks until they are lifted) get a row at boot with `bundled` true and no url or secret, so the same
audience and switches govern them; they cannot be removed or re-addressed, only switched off. Decided 2026-11-04 so
the Hassan demo works with today's mocks.

```
connector
  id                  text pk        'heroma', what the manifest must declare
  bundled             boolean        true for a connector in Clew's own process (no url, no secret)
  url                 text, null     base URL of the service as seen from Clew
  secret              text, null     sealed envelope (auth-crypto), purpose 'connector:secret:<id>'
  secret_changed_at   timestamptz
  state               text           'draft' | 'enabled' | 'disabled'
  audience            jsonb          { mode: 'all' } | { mode: 'selected', roles?: Role[], units?: string[], groups?: string[] }
  scan_enabled        boolean        push cards for people in the audience
  tools_enabled       boolean        offer model:true capabilities to the assistant
  capabilities        jsonb          { [name]: { enabled?: false, model?: false } }   overrides, narrowing only
  manifest            jsonb          last valid manifest, so the page works while the service is down
  manifest_at         timestamptz
  health              jsonb          { status: 'ok'|'unreachable'|'manifest-invalid'|'secret-rejected'|'untested', at, detail }
  created_by, updated_by, created_at, updated_at, version
```

A person is in the audience when `mode` is `all`, or when their role is in `roles`, or their unit in
`units`, or any of their groups in `groups` (any-of across the three lists). Groups are empty until SCIM
provisions them (identity.md); the shape carries them from day one so the editor does not change later.

Effective visibility of one capability for one actor is `state === 'enabled'` and in audience and the
manifest scope passes and the override does not disable it. Effective tool exposure adds `tools_enabled`
and the capability's `model` flag and the override's `model`. The registry evaluates all of it in one
place (`inScope` grows a sibling `inAudience`), so REST, cards, tools, search, scan, figures and the
callback route cannot disagree. Out of audience answers as unknown ("Okänd förmåga.", 404), never as
denied, so existence is not revealed.

Core connectors that live in Clew's process (people, calendar, the four mocks for now) appear in the same
list with their kind, cannot be removed or re-addressed, but can be limited to an audience the same way;
the calendar for everyone, Raindance for chefer and ekonomer.

## Server

Folder `apps/server/src/connectors/` (D22, D25): `registry.ts` (the live registry, `bundledIds`), `remote.ts` (assertions,
the boot loader), `model.ts` (the ports: `ConnectorStore`, `ConnectorTx`, `Secrets`, `Transport`, `LiveRegistration`,
`Units`), `usecases/admin.ts` (`connectorUsecases(deps)`: one function per admin action, actor first, step-up,
transaction with the audit row, then the live registry), `adapters/postgres.ts` and `adapters/memory.ts`,
`describe.ts` (a bundled connector in the manifest's shape), `reconcile.ts` (bundled rows at boot, governance applied,
a watcher that polls row versions every five seconds so a change from the CLI or another instance lands without a
restart) and the shared checker in `packages/connectors/src/check.ts`. Routes in `routes/admin.ts`; the use cases
refuse anyone without the grant capability `admin.connectors` (`ForbiddenError`, 403), and `GET /api/auth/session`
says `admin: true` so the browser shows the entry point.

| Route | Does |
|---|---|
| `GET /api/admin/connectors` | the list with state, health, audience summary, counts |
| `POST /api/admin/connectors` | `{ id, url, secret }` → fetch manifest, run the checker, store as `draft` with health |
| `GET /api/admin/connectors/:id` | row, manifest, effective capabilities with overrides, health, audit tail |
| `PATCH /api/admin/connectors/:id` | `state`, `audience`, `scan_enabled`, `tools_enabled`, `capabilities`, `url` |
| `POST /api/admin/connectors/:id/secret` | replace the secret; the response says only that it was replaced |
| `POST /api/admin/connectors/:id/test` | run the checker now, store and return health |
| `POST /api/admin/connectors/:id/refresh` | refetch the manifest; diff against the stored one is returned |
| `GET /api/admin/units` | the units the grants name, for the audience editor |
| `GET /api/admin/connectors/:id/preview?role=&unitId=` | structural preview: the areas, standing actions and tool names an actor with that role and unit would get (no data, no call to the service) |
| `DELETE /api/admin/connectors/:id` | remove; open cards from it are closed with reason `connector.removed` |

Every mutation: `persona.authorize()`, one transaction with the row and the audit row, then
`registry.replace(connector)` or `registry.unregister(id)`. At boot, `loadConnectors()` reads every
`enabled` row and registers it with the retry loop in `loadConnectors` (built); a row whose service
is down stays registered with the stored manifest and `health.unreachable`, so its areas show the warning
figure instead of vanishing (D8: one connector being down never takes the page down).

`GET /api/connectors` stays for signed-in people but is filtered by visibility.
`GET /api/auth/session` gains `admin: boolean` so the web app knows whether to show the entry point;
the server still checks on every admin call.

## Screens

Route `/admin` with `/admin/connectors`, `/admin/connectors/:id`, `/admin/models`, `/admin/models/:id` and
`/admin/models/providers/:id`. Same `Layout`, `LayoutHeader` and `LayoutPanel` as the start and calendar pages; the
panel is an Astryx `List` of admin sections (Anslutna system and Modeller; Bundlingstider and Behörigheter
are later rows of the same list). The entry point is
an item "Administration" in the avatar menu, rendered only when the session says `admin`. On a phone the
list collapses to the compact `Button` row the areas use. Everything is Astryx: no custom components, no CSS.

**1. Anslutna system (list).** `Toolbar` with the primary `Button` "Anslut system" and a `SegmentedControl`
Alla · På · Av · Problem. An Astryx `Table` on desktop, `List` rows on the phone (same switch as the areas):

| Column | Rendered as |
|---|---|
| System | `Text` weight semibold (manifest `source`), supporting `Text` with the id and kind `Badge` (Kärna · Genomgång · Härledd) |
| Status | `StatusDot` + word: Ansluten (success), Avstängd (neutral), Svarar inte (warning), Fel (error), Utkast (neutral) |
| Vem ser det | one line: "Alla", "Chefer", "Chefer · 3 enheter", "Ingen" |
| Förmågor | "12 · 3 åtgärder · 7 till assistenten" |
| Senast kontakt | `Timestamp` |
| På | `Switch` with a visible label; flipping it calls PATCH and announces the result through the existing toast |

`EmptyState` when nothing is connected, with the one button. Disabled rows keep full contrast (the status
word carries the state, colour never alone).

**2. Anslut system (add).** A `Dialog` holding an Astryx `Stepper` with four steps, `FormLayout` and `Field`
inside each. Since 2026-11-05 it is Astryx's `form-wizard-dialog` composition (`pages/admin/dialog-frame.tsx`, shared
with the model dialogs): the title and the stepper pinned, the step scrolling in `LayoutContent`, Tillbaka and the
step's buttons pinned in `LayoutFooter`, so the longest step (the audience editor) never pushes them off a short screen.
The manifest diff dialog uses the same frame. Two rules hold for every admin dialog: the frame and its `DialogHeader`
stay rendered while the dialog is closed, because the Dialog names itself from a title present when it mounts (4.1.2;
the diff and "Lägg till modell" dialogs had no name while their content waited for data); and a body with nothing
focusable in it (the diff list) scrolls in a labelled `ScrollableArea` that takes focus while it overflows (2.1.1):

1. *Adress och nyckel.* `TextInput` id (pattern shown as `FieldStatus`), `TextInput` URL, `TextInput`
   type password for the secret with the rule "minst 16 tecken". Nothing is sent until Nästa.
2. *Kontroll.* POST creates the draft and runs the checker; a `Spinner` with a live region, then the result
   as a `List`: manifest hämtat (source, protocol, kind), N förmågor, N områden, skanning ja/nej, signerat
   anrop godkänt, fel nyckel avvisad. A `Banner` error on failure with the connector's own message and a
   "Försök igen" button; the draft is kept.
3. *Vem ser det.* The audience editor (below) plus two `Switch`es: "Skicka kort" (scan) and "Erbjud
   assistenten" (tools), both on by default. Which views are tools in the menu (D40) is chosen afterwards, on the connector's
   page.
4. *Aktivera.* `MetadataList` summary and two buttons: "Spara som utkast" (secondary) and "Slå på"
   (primary). The default is the draft, so a connector is never live by accident.

Focus moves to the step heading on each step; Escape asks before discarding a draft (`AlertDialog`).

**3. One connector (detail).** `Breadcrumbs` (Administration › Anslutna system › Heroma), a `Heading` with
the `StatusDot` and the on/off `Switch`, a `Banner` when health is not ok ("Heroma svarar inte sedan 09:12.
Kort och figurer visas från senast kända läge."). Then `TabList`:

- *Översikt.* `MetadataList`: id, adress, protokollversion, typ, källa, manifest hämtat, nyckel bytt,
  senaste skanning, tillagd av och när. `ButtonGroup`: Testa anslutning, Hämta manifest igen, Byt nyckel
  (a `Dialog` with one password field), Ta bort (an `AlertDialog` that names the number of open cards that
  will close).
- *Förmågor.* `Table`: titel, namn (`Code`), typ `Badge` (Läs · Föreslå · Utför), manifestets roller, two
  `Switch`es per row: På and Assistent. The Assistent switch is disabled with an `InfoTip` when the
  manifest says `model: false` or the kind is `execute` (D8). A `Toolbar` button "Stäng av alla åtgärder"
  sets every `execute` row off: the read-only pilot in one click.
- *Områden.* `List`: title, roles from the manifest, standing capabilities, figure yes/no. Read-only; the
  manifest owns areas. Above it the `Switch` "Skicka kort" and the list **Verktyg i menyn**
  (D40): every view of the connector that can be a tool (a read with a declared view that opens without input), with
  the row it would be (the connector's name for it, else the capability's title), what it opens, and a `Switch` each.
  The same `List` on a phone. A chosen view is under Verktyg for everyone in the audience; each change is one audit row
  `connector.menu`. A connector with no such view says so instead of the list. Översikt names the chosen views.
- *Vem ser det.* The audience editor: `RadioList` "Alla som är inloggade" / "Endast valda", then a
  `CheckboxList` of roles (Chefer, Medarbetare), a `MultiSelector` of units from the people connector, and
  a `MultiSelector` of groups that is shown disabled with the note "Grupper kommer med SCIM" until they
  exist. Under it, the structural preview as a `Collapsible` per role: "Så här ser det ut för en
  medarbetare på Granlo förskola: inget" / "område Ekonomi med 2 åtgärder; 4 frågor till assistenten". It
  calls the preview route; it never fetches data from the service.
- *Historik.* `List` of audit rows for this connector: `Timestamp`, who, what, from → to. Read-only.

**4. States to design and test.** Service down at add time (step 2 failure, draft kept); manifest changed on
refresh (a `Dialog` with the diff as two `List`s, added and removed, before accepting; removed capabilities
that cards still reference are named); secret rejected by the service after a rotation on the connector's
side (health `secret-rejected`, Banner tells the admin which side to change); removal with open cards.

## Modeller: providers and models (D24)

The second admin section, built 2026-11-05. Until then the composer's model was three environment variables
(`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`); D24 moved it into the database so an administrator adds providers
and models in the browser and the composer can offer more than one. Migration `0011_model_administration`.

```
model_provider
  id, title            'ollama-intern', 'Kommunens egna modeller'
  base_url             OpenAI-compatible, the only protocol
  api_key              sealed envelope, purpose 'provider:key:<id>'; may be empty for a local endpoint
  key_changed_at, health { status, at, detail }, created_by, updated_by, created_at, updated_at, version

model
  id                   Clew's own id, 'gpt-oss-120b-intern'
  provider_id, model   the provider row and the id sent in the request
  title                Swedish display name in the composer: 'Snabb (lokal)'
  description          Swedish, one line: what it is good for
  state                'enabled' | 'disabled'
  audience             same shape as a connector's
  is_default           at most one row (partial unique index model_one_default), always a switched-on model
  tools                boolean: offer capabilities as tools; off for a model that does not call tools reliably
  created_by, updated_by, created_at, updated_at, version

model_choice
  person_id            pk, the person's own pick in the composer (cascade with the person)
  model_id             cascade with the model: a removed model takes every pick of it along
  updated_at
```

**Server.** In `apps/server/src/assistant/` (D20, D25): the ports in `ports.ts` (`ModelStore`, `ModelTx`,
`KeySealer`, `ModelWire`, `ModelHealth`, `ModelResolver`), the pure rules in `domain.ts` (`slugFor`, `choicesFor`,
`pickModel`), the use cases in `usecases/models.ts` (`modelUsecases(deps)`), and the adapters: `adapters/postgres.ts`
(the store), `adapters/memory.ts` (the store, a played endpoint and the in-process health), and
`adapters/openai-compatible.ts` (the wire: `GET /models`, one tiny chat completion for "Testa", the AI SDK for a turn;
every failure is a `WireError` of kind `unreachable`, `key-rejected` or `unsupported`). The composition root seals with
the master key under `provider:key:<id>` and starts the minute probe beside the server.

Effective choice for a person: the switched-on models on a provider that exists and whose audience includes them,
the default first, then in the order they were added. The model a turn uses is resolved on the server from the rows
as they are now: the person's pick if they may still use it, else the default, else the first they may use; none
means the router (D8). Nothing is cached in process, so a change on any instance is live on the next question. Every
answer a model wrote carries `model: { id, title }` in the message metadata, the response and the audit row
(`conversation.asked` details `model`), so a reply says "Svar från Snabb (lokal)". `AssistantStatus` is per person:
`configured`, `available`, `model` (the current title, for the D8 banner), `checkedAt`, `current` and `choices`.

**Screens** (`apps/web/src/pages/admin/`). `models.tsx`: the lead says who gets which model when they have not
picked one; four count tiles (På, Problem, Avstängda, Leverantörer); one `Card` per provider (Astryx has no grouped
table) with a `Toolbar` holding the provider's name as a link, its health as a `StatusDot` with the word, and
"Lägg till modell"; under it a `Table` of its models (title as a link with a Standard `Badge`, the endpoint's id as
`Code`, the description; Vem kan välja den; Verktyg; Status; the on/off `Switch`), `List` rows on a phone.
`add-model.tsx`: both dialogs are Astryx's `form-wizard-dialog` composition, a `Layout` with `height="fill"` inside the
`Dialog`: the `DialogHeader` (and the `Stepper`) pinned in the header, the step in `LayoutContent`, which scrolls against
the dialog's `maxHeight`, and the actions in `LayoutFooter`, so an endpoint that lists many models never pushes the
buttons off screen. "Lägg till leverantör" has two steps (Adress och nyckel: name, an id suggested from the name, base
URL, key that may be empty; then Modeller: the test's findings and the picker). "Lägg till modell" asks the endpoint for
its list as it opens (the same call as "Testa", cached a minute) and shows the same picker: the listed models not added
yet as a `CheckboxList`, a field for an id the endpoint does not list, and "Slå på dem direkt". On the provider page,
"Testa" says how many listed models are not added and opens that dialog. `model.tsx`: Översikt (Testa, Gör till standard or Ta bort
som standard, Ta bort; `MetadataList`; a form for the name, the description and the endpoint's id; the Verktyg
switch), Vem kan välja den (the audience editor, worded for a model), Historik; a phone gets the sections as a
menu, as on a connector. `provider.tsx`: the health `Banner`, Testa (findings, then the listed models not yet added
to tick and add), Byt nyckel (empty removes it), Ta bort (disabled with a tooltip while it has models), its models,
the name and address form, Historik.

**In the composer.** `ChatComposer`'s `footerActions`, the slot Astryx documents for a model selector (template
`ChatComposerFooterActions`), holds a `DropdownMenu` whose trigger reads "Modell: Kapabel" and whose
`DropdownMenuRadioGroup` lists the person's models with title, "(standard)" and description. It shows only when the
person has two models or more. Choosing one is `PATCH /api/assistant/model`; the toast says which model the next
question uses. A compound menu is popover-only in Astryx 0.7.7, so a phone gets the anchored menu, not a sheet. A
model that is removed or taken out of the person's audience falls back silently; the "Svar från …" line under the
answer makes the change visible.

**Rules.** Keys are never returned by any API, logged or shown again (D23). Only the OpenAI-compatible
protocol is supported, so the repository depends on no closed provider (`CLAUDE.md`); a closed model is an
operator's entry in this table. Classification-gated inference (which data may go to which endpoint) stays
an open question in `vision.md`; the audience is not that gate, it only says who may pick a model. Every
administrative mutation needs the administration grant `admin.connectors` and the step-up and writes its audit row
in the same transaction: `provider.added`, `provider.title`, `provider.url`, `provider.key`, `provider.removed`,
`model.added`, `model.enabled`, `model.disabled`, `model.default` (on the new default and, with `replacedBy`, on the
old one), `model.audience`, `model.tools`, `model.title`, `model.description`, `model.model`, `model.removed`. The
person's pick is `model.chosen` on `person:<id>`. A provider is removed only once its models are gone. Health is not
administration: a test or a probe that changes it is stored without a version bump or an audit row.

**Admin API.** `GET /api/admin/models` (providers and models), `POST /api/admin/models`,
`GET|PATCH|DELETE /api/admin/models/:id`, `POST /api/admin/models/:id/test`, `POST /api/admin/providers`
(adds and tests; returns the report with the ids the endpoint lists), `GET|PATCH|DELETE /api/admin/providers/:id`,
`POST /api/admin/providers/:id/key`, `POST /api/admin/providers/:id/test`. For the person:
`GET /api/assistant/status` and `PATCH /api/assistant/model { modelId }` (null goes back to the default).

**Checks.** `tests/unit/model-admin.test.ts` (the use cases and the pure rules), `tests/model-store-contract.ts` on
both adapters (`tests/unit/model-store.test.ts`, `tests/db/postgres-model-store.test.ts`), the wire's error kinds and
the SDK wiring in `tests/unit/assistant.test.ts`, the model recorded on an answer in `tests/unit/conversation.test.ts`,
`tests/a11y/models.spec.ts` (the pages, the add dialog by keyboard, the composer menu, the answer's model line, reflow),
and `bun scripts/models-check.ts` in the devcontainer for the live adapters against a stand-in or a real endpoint.

## What the person sees

Nothing new. The audience makes a connector absent from the sidebar, the composer's tool list, the search
objects and the stream. A manager loses nothing they have today; an employee outside Raindance's audience
never sees the word. "Varför ser jag detta?" and "Källa: Heroma" are unchanged.

## Accessibility

A new route and three views, so `tests/a11y` gets: list (empty, with rows, 320 px as List), add dialog
through all four steps by keyboard with the failure state, detail with every tab, the remove confirmation.
Switches have visible labels and announce their new state; the checker's progress is a live region;
tables reflow to lists at 320 px; focus returns to the row's switch after a PATCH, to the list heading
after a removal (the pattern the stream uses when a card leaves).

## Built, and what to know

- Visibility is one check in the registry (`visible`, `allowed`, `listFor`, `capabilitiesFor`): `run` answers
  "Okänd förmåga." for a hidden connector, and `areas`, `scan`, `tools`, the search objects, the typeahead and
  `GET /api/connectors` all go through it. The stream hides open cards from a hidden connector while handled ones
  stay (`threads/usecases/cards.ts`).
- The structural preview cannot satisfy a scope written as code (the mocks narrow by identity), so it lists areas
  and only the tools a declarative scope allows; the page says so.
- Screens: `apps/web/src/pages/admin/` (`shell.tsx`, `connectors.tsx`, `add.tsx`, `connector.tsx`, `audience.tsx`,
  `labels.ts`), routes `/admin`, `/admin/connectors`, `/admin/connectors/:id`, the entry "Administration" in
  the start page header for an administrator, `NotAdmin` for anyone else. Tests: `tests/a11y/admin.spec.ts`,
  `tests/unit/connector-admin.test.ts`, `tests/unit/connectors.test.ts` (governance), the connector store contract
  on both adapters, and the administration flow in `scripts/modules-check.ts`.

## Order of work

Connectors first (steps 1 to 5), then models (step 7), since the audience editor, the sealed-secret
adapter, the admin permission and the page shell are shared.

1. Rename (D22): folders, package, protocol doc and schema, callback route, hello connector, checker, guide,
   `CLAUDE.md`. Mechanical, one commit, before the uncommitted D21 work lands.
2. (Done, session 15.) `connector` table and migration; sealed secret adapter; `loadConnectors()` from rows at boot;
   `CLEW_CONNECTORS` removed; `scripts/auth-setup.ts` seeds `mikael` with `admin.connectors` and, in the
   calendar profile, the hello connector as a draft.
3. Visibility in the registry (`inAudience`, state, overrides) applied to areas, tools, scan, figures,
   run, objects, threads and `GET /api/connectors`; unit tests that Hassan outside an audience gets 404 and
   no area, tool, object or card.
4. Admin use cases and routes with audit; the shared checker in `packages/connectors/check.ts`.
5. Screens 1 to 3 in `apps/web/src/pages/admin/`, after a canvas row; a11y tests; `scripts/modules-check.ts`
   gains the admin flow (add hello, limit to managers, verify as Hassan, remove).
6. Models (D24): `model_provider` and `model` tables with the sealed key; `assistant/model.ts` reads the registry
   of models instead of `AI_*`; per-person preference; `AssistantStatus` as a list; the admin routes; the
   Modeller screens and the composer's model menu; `AI_*` removed from `.env.example`; a11y tests for the
   menu (keyboard, announced change, 320 px).
7. Later: groups when SCIM lands; `LISTEN/NOTIFY` for multi-instance; per-connector token-exchange settings
   (D5) when the first user-delegated connector arrives; bundle times and permissions as further admin
   sections.
