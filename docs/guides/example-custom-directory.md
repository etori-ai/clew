# Worked example: the phone book

For someone connecting a look-up system to Clew. The organisation has its own phone book ("telefonboken"), reachable
through an API. Employees should find a colleague's number from the box, see their own team's contact details, and
open a contact card, with or without a model. This walks `creating-a-connector.md` from start to finish against the
code in `connectors/telefonbok`, which is the result. It replaces the earlier walkthrough of an in-process directory,
which predated connectors (D21, D23).

## 1. The note before writing

| Question | The answer |
|---|---|
| Who owns the records? | The phone book. Clew stores refs and audit rows, nothing else. **Pass-through.** Clew's own `people` connector keeps only subject, name, unit and role. |
| What makes a person act? | Nothing: this is find-and-look. Reads only, no propose, no execute, no scan, no figure. |
| Who may see what? | Every signed-in employee may see every colleague's work contact details. A protected record is never shown. Home address and personal number exist in the phone book and are not in the contract. |
| How does it recognise the user? | One integration key: `service` mode. The connector narrows every answer itself. "My team" is the unit in Clew's assertion. |
| API? | Yes, JSON over HTTP. Its exact shape is not confirmed, so the mapping sits in one function. |
| Licence? | No client library; `fetch` and Node only. Nothing to pin. |
| Already exposed by someone? | Possibly Metakatalogen, which the vision names as the directory. Not settled; the connector is the same either way, with another adapter. |

## 2. The manifest, read as buttons and questions

Five capabilities, all `read` (`connectors/telefonbok/connector.mjs`):

| Capability | Title | For |
|---|---|---|
| `telefonbok.directory` | Sök i telefonboken | The whole organisation, or the person's own unit, by name, title or unit. Input `{ query?, scope? }`. |
| `telefonbok.team` | Mitt teams kontaktlista | Everyone on the person's unit. No input. |
| `telefonbok.person` | Kontaktkort | One colleague: title, unit, phone, mobile, e-mail, room, manager, and the link into the phone book. |
| `telefonbok.search` | Sök person | The search source (D26) with `kinds: ["person"]`: what the box finds when a name is typed. |
| `telefonbok.fetch` | Hämta person | One hit back by its ref, so a hit can be chipped into the conversation. |

One area, `Kontakter`, for both roles, with the team list and the search as its standing actions. That alone puts both
as chips under the box and under Områden for everyone in the connector's audience: each person's own team list is one
click away without anyone composing a page.

The chips show only on the landing. A phone book is looked up in from anywhere, and both views open without input, so
an administrator can put them in the menu as tools (D40). The manifest says what their rows are called:
`menu: { label: "Telefonbok", icon: "phone" }` on the search and `menu: { label: "Mitt team", icon: "people" }` on the
team list. Which of them are under Verktyg, after Kalender, is chosen view by view on the connector's page.

## 3. The views (D38)

The connector says what each read's output is; Clew draws it. Nothing in the connector is markup.

- **The search is a table**: columns Namn, Titel, Enhet, Telefon, Mobil, E-post; `phone` and `email` formats, so a
  number calls and an address writes; a search field bound to `query` and a choice (Hela organisationen, Min enhet)
  bound to `scope`; a row opens `telefonbok.person`. On a phone Clew draws the same view as a list.
- **The team is a list** with the same fields, and the same contact card behind each row.
- **The contact card is a detail**: the name as its heading, the fields as label and value, the link out last.
- **The search source declares a list too**, for one reason: its `open` is what a hit opens in Clew's panel.

All three views of people say `modelReads: "summary"`. When the model calls the search as a tool, the phone book is
asked and the person's view has its rows, but the model is told only "shown to the person, 2 rows". A hit from the
search source says who and where (name, title, unit) and not the number; the number is in the contact card. So a
number reaches the person and is never in the model's context or the stored conversation.

## 4. The adapter

`directory.mjs` is the only file that knows the phone book's own shapes. The port is two functions:

```js
search(query, { unit, limit })  // -> Person[]; every word must match name, title, unit or a number
person(id)                      // -> Person | null
```

`createHttpDirectory` calls `GET {url}/persons?q=&unit=&limit=` and `GET {url}/persons/{id}` with the key in
`x-api-key`. `toPerson` maps one record to a `Person` and is **the function to adapt** when the real API is known. It
drops a record marked `protected` or `hidden` before anything else sees it, and reads only work fields, so a private
field cannot cross even by mistake. `createFixtureDirectory` is a made-up organisation (numbers from the ranges
reserved for fiction, addresses under `.example`) for development, the check and the tests; one of its records is
protected, and the tests prove it is never found.

Where Clew's unit ids are not the phone book's, `TELEFONBOK_UNIT_MAP` translates them. Clew knows a person's unit from
its own grants; the phone book decides who is on it.

## 5. Run, check, register

```sh
TELEFONBOK_SECRET=<16+ characters> docker compose -f connectors/telefonbok/compose.yaml up telefonbok
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://host.docker.internal:4020 --id telefonbok --secret <the secret>
docker exec -w /workspace clew-app-1 bun scripts/connector-add.ts telefonbok http://host.docker.internal:4020 --secret <the secret> --enable
```

The check validates the manifest, including the rules for views, calls every read that needs no input as a manager and
as an employee, verifies that each declared view finds its rows where it says, and proves that a call signed with
another secret is refused. An administrator can do the same from Administration › Anslutna system and choose who sees
the connector, and which of its views are tools in the menu.

Against the real phone book: `TELEFONBOK_ADAPTER=http`, `TELEFONBOK_URL` and `TELEFONBOK_API_KEY` from the secrets
store. The key lives in the connector's container; Clew holds only the shared secret.

## 6. What a person meets

| The person | What happens | Model needed |
|---|---|---|
| Presses "Telefonbok" or "Mitt team" under Verktyg in the menu, on any page | The view opens in the side panel; closing it gives the focus back to the row | No |
| Presses the chip "Mitt teams kontaktlista" | The list opens in the side panel, read as them | No |
| Presses "Sök i telefonboken" and types | The table asks again after a pause; the count is spoken; the address carries the question | No |
| Types "telefonboken anna lind" in the box | The router matches the capability by its title, hands "anna lind" to the view's search field, answers with a count and draws the rows under the answer | No |
| Types "Anna Lind" in the box | No capability is named, so the composite search asks every source; the hit shows name, title and unit, and opens the contact card | No |
| Asks "vilka lärare finns på min enhet?" | The model calls the search with `scope: "unit"`, is handed a count, and says the rows are in the view; the view is drawn under its answer | Yes |
| Presses `@` on a row | The person goes into the box as a chip, read back from the phone book when the question is asked | For the question |

## 7. Tests

- `tests/unit/telefonbok-connector.test.ts`: the connector over the protocol on the fixture: search, unit scope and the
  unit map, the contact card, the protected record, the composite search, the conformance check, and the HTTP adapter
  against a recorded answer including a failing API.
- `tests/unit/views.test.ts`: the rules of a view, the summary the model is handed, and the router without a model.
- `tests/unit/conversation.test.ts`: two turns end to end, with the audit row, asserting that no name or number the
  person did not type is stored.
- `tests/a11y/views.spec.ts`: the views in a browser, answered by the connector itself: roles and names, keyboard
  order, focus when a row opens its card and on the way back, the spoken count, reflow at 320 px, axe.

## 8. What changes for another system

A second look-up system (rooms, vehicles, a case register) is the same shape: reads, a search source with its `kinds`,
and a view per read. Another phone book, or Metakatalogen, is this connector with another adapter behind the same
port. What a person sees does not change, because none of it was the connector's to draw.
