# Appraisals connector (fixture)

A generic stand-in for a third-party system that holds the round of development talks and the action points agreed
in them ([D96](../../docs/decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md),
items 8 and 9). It proves that a system other than Clew's own talks module can answer the talks profile: an
installation that keeps its talks elsewhere switches Clew's built-in connector off on Administration › Anslutna system
and enables this one, and Clew's pages then show the round and the action points read-only, each row opening this
system by its link. It is a fixture with synthetic data, not an integration with any real product.

## What it answers

| Capability | Input | Output |
|---|---|---|
| `appraisals.talks` | `{}` | The profile's `TalksOutput`: the open round (`label`, `opensOn`, `dueOn`) and one row per person the caller is manager of in this system, `missing`, `booked` (with the booked instant) or `held` (with the day), the number of open action points and a link to the talk. A caller who manages nobody gets the round and no rows. |
| `appraisals.commitments` | `{ person?: userName }` | The profile's `CommitmentsOutput`. With `person`: that employee's action points, for their manager (or the employee); anyone else gets none. Without: the caller's, the ones they are to do as the employee or as the employee's manager and the ones about them (their manager's in their own talk), the caller's own first. Open ones from the last round are `carried` and listed first. Declares `person: { param: 'person', admits: ['self', 'managed'] }` ([D117](../../docs/decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)): Clew sends only the caller or their reports. |
| `appraisals.round` | `{}` | Not part of the profile: the round as a table with the state in Swedish (Saknas, Bokat, Hållet), for managers, so the system can be used from the menu on its own. |
| `appraisals.person` | `{ keys: [userName, …] }`, at most 200 | A read about a person ([D97](../../docs/decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)): one row per key that is a person the caller is manager of here, `{ key, state, at, overdue }`, the key as it was asked, the state in Swedish and the number of overdue action points. Anyone else, an unknown key and a key asked twice are no row. For managers. Clew places it: a section on the opened person, a lens on Personal when an administrator offers it, and a mark on a row whose talk is missing. A row opens `appraisals.commitments` for that person. Declares `person: { admits: ['managed'] }` (D117): Clew sends only the manager's reports. |

All four are `model: false`: no read of this domain is offered to a model (D96 item 6). Their views carry no `ref`,
so a row cannot be added to a conversation. The profile's shapes are written out in `connector.mjs`, since a connector
imports nothing from Clew; `tests/unit/appraisals-connector.test.ts` checks the answers against `@clew/contracts`.

## The records

`fixture.mjs` holds the records as small tables, keyed on the provisioned user name (SCIM `userName`), which is all
another system knows a person by. The five people are the named people on Bergsåkers skola (`unit-skola`) in the
development directory, managed by `hillevi`, under the user names the directory gives them (`anna`, `erik`, `maria`,
`johan`, `karin`). User names are compared without regard to case. Clew maps each row to a person on the reader's own
units and drops the rows about anyone else, so a user name the directory does not have is simply not shown. Every date
is an offset from today, so the round is always the open one.

**Who is asking.** Only Clew's signed assertion says who the caller is. It carries the person's user name when they have
one (D97), and that is the key this system holds, so it comes first. A person Clew knows without one is found by
`FIXTURE_PERSON_MAP` (Clew person id to user name), then by an id that is a user name here (a test's persona). The name
is never used: two people can share one.

**No booking.** The system has no write Clew could call, so it declares no action about a person: "Boka samtal" in the
person's menu would need a `propose` this fixture can back with a draft a person decides on.

## Environment

| Variable | Meaning |
|---|---|
| `PORT` | Default 4051 |
| `CLEW_CONNECTOR_SECRET` | The transport secret shared with Clew (16+ characters) |
| `CLEW_URL` | Where Clew's public keys are fetched |
| `FIXTURE_TODAY` | A fixed day (`YYYY-MM-DD`) instead of the clock, for a repeatable demo or test |
| `FIXTURE_PERSON_MAP` | A JSON object, Clew person id to user name |
| `APPRAISALS_LINK_BASE` | The https address rows link to; default `https://appraisals.example` |

## Run and register

The development stack runs it as the `appraisals` service on port 4051, and `bun run dev:connectors` registers it as
a draft: it is not enabled, since the built-in talks module answers while it is enabled (D96 item 9). To switch, an
administrator enables this connector and switches the built-in one off on Anslutna system. On its own:

```bash
CLEW_CONNECTOR_SECRET=<16+ characters> node connectors/appraisals/server.mjs
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://appraisals:4051 --id appraisals --secret <the secret> \
  --keys anna,erik,maria,johan,karin --as hillevi
```

A real connector answers the same two reads over its system's API; see
[Create a connector](../../docs/guides/creating-a-connector.md).
