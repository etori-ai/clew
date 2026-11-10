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
| `appraisals.commitments` | `{ person?: userName }` | The profile's `CommitmentsOutput`. With `person`: that employee's action points, for their manager (or the employee); anyone else gets none. Without: the caller's own, the ones they are to do as the employee or as the employee's manager. Open ones from the last round are `carried` and listed first. |
| `appraisals.round` | `{}` | Not part of the profile: the round as a table with the state in Swedish (Saknas, Bokat, Hållet), for managers, so the system can be used from the menu on its own. |

All three are `model: false`: no read of this domain is offered to a model (D96 item 6). Their views carry no `ref`,
so a row cannot be added to a conversation. The profile's shapes are written out in `connector.mjs`, since a connector
imports nothing from Clew; `tests/unit/appraisals-connector.test.ts` checks the answers against `@clew/contracts`.

## The records

`fixture.mjs` holds the records as small tables, keyed on the provisioned user name (SCIM `userName`), which is all
another system knows a person by. The five people are those on Bergsåkers skola (`unit-skola`) in the development
directory, managed by `hillevi`, with user names formed as the directory forms them (`anna.lindqvist`,
`erik.sandstrom`, `maria.kallstrom`, `johan.bystrom`, `karin.lindqvist`). Clew maps each row to a person on the
reader's own units and drops the rows about anyone else, so a user name the directory does not have is simply not
shown. Every date is an offset from today, so the round is always the open one.

**Who is asking.** Only Clew's signed assertion says who the caller is, and it carries the person's id and name, not
their user name. The fixture therefore looks the caller up by `FIXTURE_PERSON_MAP` (Clew person id to user name)
first, then takes an id that is a user name here (the persona `hillevi`), and last matches the name, since the
development stack's person ids are generated. Matching on a name is a fixture's shortcut; a real connector maps from
what its installation gives it.

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
docker exec -w /workspace clew-app-1 bun scripts/connector-check.ts http://appraisals:4051 --id appraisals --secret <the secret>
```

A real connector answers the same two reads over its system's API; see
[Create a connector](../../docs/guides/creating-a-connector.md).
