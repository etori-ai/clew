# D119 · Key figures per unit come through one vendor-neutral profile

**Status:** proposed (Oliver Borgström asked for it on 2026-11-13; nothing built; the source, the history and the class of the data are open, and building it needs the product owner's word on the freeze, D101) · **Date:** 2026-11-13 · **Area:** integrations

**Decision.** A unit's key figures (economy, sick leave, the employee survey's HME, and what follows) reach Clew through
one profile that names no vendor, and every page that shows them reads Clew's composite of it: decision B of the
[plan for absorbing big-boss-board](../reviews/2026-11-12-absorbing-big-boss-board-into-clew.md). Which system answers is
an installation's choice; the pages, the follow-up dialogue and its configuration do not change when it does.

1. **The profile `<id>.keyFigures`** is a read (the D89 convention: the name is the contract, `connectorId + '.keyFigures'`)
   taking `{ keys }`, the unit keys as Clew sends them on a read about a unit (D97), and answering one row per unit and
   measure: the unit's key as asked, the measure's key, a label, a value as a number, its unit ("%", "mnkr", "av 100"),
   a tone (`ok`, `warn`, `alert`, `none`), an optional target, an optional comparison (a value and its words, such as
   "+0,3 procentenheter mot samma månad i fjol"), the period it is about ("oktober 2026"), when the source last
   answered, and an optional series of at most 24 points for the chart (D79). No free text beyond those words, no
   person. The schema is TypeBox in `@clew/contracts` and a `$def` of the published protocol schema.
2. **A measure is a key from a closed list in `@clew/contracts`**, `KEY_FIGURE_MEASURES`, as capabilities are (D85):
   `economy.deviation`, `sick-leave.total`, `sick-leave.long-term`, `hme.total` and the three HME perspectives to start
   with. A new measure is a contract change. This is what makes the profile vendor-neutral: Clew and a configuration
   name the measure, never the read that answers it.
3. **Several systems may answer, and Clew merges them** into the core read `clew.keyFigures`, as `clew.errands` merges
   the errand lists (D89): every `<id>.keyFigures` in the person's scope asked at the same time with a budget per
   system, rows that are not key-figure rows counted as no answer, the systems that did not answer named. Economy may come
   from one system and sick leave from another. When two systems answer the same measure for the same unit, the one an
   administrator placed first (the connector's `ordinal`) wins and the other is left out; how Administration › Anslutna
   system shows that conflict is not designed.
4. **The pages read the composite.** A unit's key-figure tiles and sections, Dialogstöd's columns and "Att ta upp"
   (D117), and the follow-up dialogue's measured areas, whose configuration names a measure key instead of a read
   (amends [D118](D118-the-follow-up-dialogue-is-an-owned-domain.md) item 3: `"measure": "economy.deviation"`, not
   `"qlik.economyUnit"`). Läget's figure on Hem stays an area figure (D54).
5. **Clew never computes a tone.** The thresholds, the economy assessment (below zero is an alert, no warning level, no
   assessment without both budget and forecast), the twelve-month rule for sick leave and the rise of more than 1.5
   points in three months, the HME limits and the cost estimate are the organisation's rules, applied in the connector
   and listed in its README with where each comes from (D82 item 7). Big-boss-board's backend tests are the cases to
   port.
6. **Aggregates only, and the units the person follows up.** D82 items 2 and 3 carry over to every answerer: no person,
   no name, a group below the minimum held back in the connector. A connector answers for the units in the actor's
   `units` (D117) and refuses every other.
7. **Not a model tool.** The profile and `clew.keyFigures` are reads about an entity, and what a source says about an
   entity never reaches the model (D97 item 7). Whether the box's fixed answers (D8) may read them is left to the
   decision that needs it.

**Why.** Oliver Borgström, 2026-11-12 and 2026-11-13: the Qlik connector is not settled and may be replaced, the data is
to come through an API that is still being looked into, and big-boss-board's figures need a home before it is retired.
Today each figure is a read of one named connector (`qlik.unit`, `qlik.economyUnit`), so the dialogue's configuration
and anything that picks a figure is bound to Qlik's names; a profile keyed by measure removes that.

Weighed and left: one connector per vendor with its own reads, as today, which binds pages and configuration to a
vendor; Clew computing tones from raw values, which moves the organisation's rules into Clew's code; reading
big-boss-board as a bridge, which the plan rules out; a free measure key per connector, which would let two systems
call the same figure by two names.

**Not established.** Each waits for someone outside the repository, and `docs/maintainers/open-questions.md` lists them:

- **The source.** Which API answers, and how Clew's units map to its units. Until it is known, the Qlik connector's
  fixture is the only answerer; whether `connectors/qlik` is rebuilt to answer the profile or withdrawn with a closing
  note (D105) follows from it.
- **The history.** If the source answers closed months, the connector keeps nothing. If it answers only the current
  state, the connector must store its series, health aggregates at rest outside the source, which needs an impact
  assessment with the data protection officer; big-boss-board's series would be its starting point.
- **The class of the data.** If key figures per unit are public information, as big-boss-board treats them, item 6 is
  enough. If they are not, a connector must also check that the reader may see each unit's figures, beyond following it
  up. The data protection officer and HR answer.
- **HME.** Its source is the employee survey, not Qlik. HR says who delivers the yearly report, and in which format,
  once big-boss-board is gone.
- **The freeze.** The profile, the measure list and the composite are new contract surface under D101.

**Replaces.** [D82](D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md), once
this record is `provisional`: its contract names Qlik, and its items 2, 3 and 7 carry over as items 5 and 6 here. D82's
status is left as it is until then. Builds on D89 (a profile merged into one list), D97 (reads about an entity), D117
(the units in the actor) and D118 (the dialogue's measured areas).
