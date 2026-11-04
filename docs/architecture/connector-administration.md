# Connector administration

How an administrator connects a system to a running Clew, decides who sees it, and keeps it healthy, from
the browser and without a restart; and, on the same surface, which model providers and models the composer
may use (D24). Implements D22 (the word), D23 (the database as the only registration path) and D24.
Status: proposed design, nothing built. The screens need a row on the design canvas
before they are built (`CLAUDE.md`: the canvas is the reference for every screen).

## The model

One row per connector in Postgres, one `Connector` in the live registry per enabled row.

```
connector
  id                  text pk        'heroma', what the manifest must declare
  url                 text           base URL of the service as seen from Clew
  secret              text           sealed envelope (auth-crypto), purpose 'connector:secret:<id>'
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

Folder `apps/server/src/connectors/` (D22): `registry.ts` and `remote.ts` move here; new `usecases.ts`
(one function per admin action, actor first, step-up, transaction, audit row, then registry update) and
`adapters/` for the Drizzle rows and the sealed secret. Routes in `routes/admin.ts`, guarded by the grant
capability `admin.connectors`.

| Route | Does |
|---|---|
| `GET /api/admin/connectors` | the list with state, health, audience summary, counts |
| `POST /api/admin/connectors` | `{ id, url, secret }` → fetch manifest, run the checker, store as `draft` with health |
| `GET /api/admin/connectors/:id` | row, manifest, effective capabilities with overrides, health, audit tail |
| `PATCH /api/admin/connectors/:id` | `state`, `audience`, `scan_enabled`, `tools_enabled`, `capabilities`, `url` |
| `POST /api/admin/connectors/:id/secret` | replace the secret; the response says only that it was replaced |
| `POST /api/admin/connectors/:id/test` | run the checker now, store and return health |
| `POST /api/admin/connectors/:id/refresh` | refetch the manifest; diff against the stored one is returned |
| `GET /api/admin/connectors/:id/preview?role=&unit=` | structural preview: the areas, standing actions and tool names an actor with that role and unit would get (no data, no call to the service) |
| `DELETE /api/admin/connectors/:id` | remove; open cards from it are closed with reason `connector.removed` |

Every mutation: `persona.authorize()`, one transaction with the row and the audit row, then
`registry.replace(connector)` or `registry.unregister(id)`. At boot, `loadConnectors()` reads every
`enabled` row and registers it with the retry loop that `loadRemoteConnectors` has today; a row whose service
is down stays registered with the stored manifest and `health.unreachable`, so its areas show the warning
figure instead of vanishing (D8: one connector being down never takes the page down).

`GET /api/connectors` stays for signed-in people but is filtered by visibility.
`GET /api/auth/session` gains `admin: boolean` so the web app knows whether to show the entry point;
the server still checks on every admin call.

## Screens

Route `/admin` with `/admin/anslutningar`, `/admin/anslutningar/:id`, `/admin/modeller` and
`/admin/modeller/:id`. Same `Layout`, `LayoutHeader` and `LayoutPanel` as the start and calendar pages; the
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
inside each:

1. *Adress och nyckel.* `TextInput` id (pattern shown as `FieldStatus`), `TextInput` URL, `TextInput`
   type password for the secret with the rule "minst 16 tecken". Nothing is sent until Nästa.
2. *Kontroll.* POST creates the draft and runs the checker; a `Spinner` with a live region, then the result
   as a `List`: manifest hämtat (source, protocol, kind), N förmågor, N områden, skanning ja/nej, signerat
   anrop godkänt, fel nyckel avvisad. A `Banner` error on failure with the connector's own message and a
   "Försök igen" button; the draft is kept.
3. *Vem ser det.* The audience editor (below) plus two `Switch`es: "Skicka kort" (scan) and "Erbjud
   assistenten" (tools), both on by default.
4. *Aktivera.* `MetadataList` summary and two buttons: "Spara som utkast" (secondary) and "Sätt på"
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
  manifest owns areas.
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

The second admin section. Today the composer's model is `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`
(`apps/server/src/assistant/model.ts`); D24 moves it into the database so an administrator adds providers
and models in the browser and the composer can offer more than one.

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
  is_default           exactly one enabled model per installation, or none (the composer then routes without a model, D8)
  tools                boolean: offer capabilities as tools; off for a model that does not call tools reliably
  created_by, updated_by, created_at, updated_at, version
```

Effective choice for a person: the enabled models whose audience includes them, in admin order, the
default first. The server resolves the model per request from the person's saved choice (a per-person
preference row, falling back to the default) and never from the browser alone: the browser sends a model
id, the server checks it is enabled and in the audience, else uses the default and says so. Every answer
records the model id in the message metadata, so a reply can say "Svar från Snabb (lokal)" and the audit
shows which model drafted a card. The `AssistantStatus` the page reads becomes the list of models the
person may choose plus the current one; `configured: false` when none is enabled (the D8 banner).

**Screens.** The list is a `Table` grouped by provider: title, model id (`Code`), audience summary, Standard
`Badge`, Verktyg yes/no, health `StatusDot`, on/off `Switch`. "Lägg till leverantör" opens a `Dialog`
with `FormLayout`: title, base URL, key (password field, may be empty), then "Testa" runs one tiny
completion and, when the endpoint answers `GET /v1/models`, offers the returned ids in a `CheckboxList` to
add in one go; otherwise the admin adds models by id. A model's detail page has the same tabs as a
connector where they apply: Översikt (`MetadataList`, Testa, Ta bort), Vem ser det (the audience editor),
Historik. The provider's detail page holds the key rotation and the health banner.

**In the composer.** The scope line in the composer's header already sits in `headerActions`; the model
choice goes beside it as an Astryx `DropdownMenu` with a `DropdownMenuRadioGroup` of the person's models,
each with title and description, shown only when more than one model is available. Choosing one is a
PATCH to the person's preference; the next message uses it; the menu's label shows the current model's
title. On the phone the same menu opens as a sheet (adaptive presentation, as the reminder menu does). A
model that is removed or taken out of the person's audience falls back to the default silently, with the
"Svar från …" line making the change visible.

**Rules.** Keys are never returned by any API, logged or shown again (D23). Only the OpenAI-compatible
protocol is supported, so the repository depends on no closed provider (`CLAUDE.md`); a closed model is an
operator's entry in this table. Classification-gated inference (which data may go to which endpoint) stays
an open question in `vision.md`; the audience is not that gate, it only says who may pick a model. Every
mutation: step-up, audit row (`provider.added`, `provider.key`, `model.added`, `model.enabled`,
`model.audience`, `model.default`, `model.removed`), registry of models refreshed in process.

**Admin API.** `GET|POST /api/admin/providers`, `GET|PATCH|DELETE /api/admin/providers/:id`,
`POST /api/admin/providers/:id/key`, `POST /api/admin/providers/:id/test` (returns the model ids the
endpoint lists, when it does), `GET|POST /api/admin/models`, `GET|PATCH|DELETE /api/admin/models/:id`.
For the person: `GET /api/assistant/status` (models in audience, current, default) and
`PATCH /api/assistant/model { id }`.

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

## Order of work

Connectors first (steps 1 to 5), then models (step 7), since the audience editor, the sealed-secret
adapter, the admin permission and the page shell are shared.

1. Rename (D22): folders, package, protocol doc and schema, callback route, hello connector, checker, guide,
   `CLAUDE.md`. Mechanical, one commit, before the uncommitted D21 work lands.
2. `connector` table and migration; sealed secret adapter; `loadConnectors()` from rows at boot;
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
