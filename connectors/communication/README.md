# communication: a generic internal communication system, as a fixture connector

The municipality's notices and the person's read receipts ("Viktigt nu"), as the development stack and the unit suite
meet them. A kind of system, not a product (D52); the notices are made up. An independent Node service behind the
connector protocol that imports nothing from the rest of the repository (D21); the shape is [hr](../hr/README.md)'s,
with the same files, store, switches and environment (`PORT` is 4043, `FIXTURE_DB` defaults to
`./communication.sqlite`, there is no feed).

Everyone gets the area `important-now`: the notices as a list that says which still need the person's receipt, and one
card per notice that requires a receipt the person has not given. Its figure (D54) is what was published today, or
the sentence "Inget nytt sedan i går." `communication.acknowledge` registers the receipt for
the verified person only (after `FIXTURE_PERSON_MAP`), deduplicated by Clew's operation id and read back through
`communication.lookup` (D45). Receipts are the one record this system keeps about a person.

The card's "Jag har läst" carries `acknowledgement: { publishedAt }` (D112, amended 2026-11-11): it is the person's read
receipt, so Hem lifts the card above its blocks until it is given. The card is the notice (D112, amended 2026-11-12):
its `summary` is the notice's text, a few paragraphs separated by a blank line, which Clew draws first in the work item;
its `reason` says who published it, when, and that a receipt is required; and its one row is the notice itself, with no
detail of its own, so Clew draws no "Rader" for it. A notice the system shows in full ("Ny rutin vid hot och våld", at a
synthetic address on a reserved example domain) also has a read that leads out of Clew, "Läs hela nyheten"
(`communication.open`, `target: 'link'`, answering `{ url }`), which Clew draws after the text.

The same notices are the system's news, the news profile's first source: `communication.news` lists them newest first
with their sender (the department that published them) and, for one the system shows in full, its `link`, which leaves
Clew in a new tab; one without a link opens with its text in Clew through `communication.newsItem`. Clew joins them with
every other news source as `clew.news`, "Nyheter" on Hem and "Alla nyheter". A notice seeded before senders and links
existed carries the system's name and no link until the fixture is reseeded (`bun run fixtures:reset`, or the
service's own state removed).

`tests/unit/communication-connector.test.ts` runs it over the protocol with the memory store.
