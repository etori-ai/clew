# D127 · A read can say its rows are a read about people, asked for everyone, and then has one place

**Status:** provisional (the product owner found on 2026-11-14 that Hem's "Frånvaro per person" still opened a page of its own beside Personal's Frånvaro tab; the field is built and the HR fixture and Clew's talks module declare it, and nothing outside the repository has declared or tested it) · **Date:** 2026-11-14 · **Area:** integrations, ui

**Context.** Since [D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md) a thing has one page, and
Personal is one register whose tabs are the lenses an administrator offers over the manager's people
([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)). A lens is a read `about` a person,
asked with the keys of the people Clew lets the reader ask about ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)).
A source often also has the same rows as a read that takes no input, for everyone it knows the reader manages: the HR
fixture's `hr.absenceOverview` beside its lens `hr.person`, the talks module's `talks.talks` beside `talks.person`. That
read is what a figure on Hem opens (a figure opens only a read without input, D54), what the model may call and what a
standing read and an answer's "Visa allt" name. The web could not tell that it was the lens's rows, so it opened as a
page of its own, a second place for the same people. The protocol had no way to say it: `subject` says that each row
names a person, not that the rows are a lens's, and a read about people cannot be opened without keys.

**Decision.** A `table` or `list` view may name, in `byKey`, the read of the same connector about the entities its
`subject` names (`about`, with a `table` or `list` view) that answers the same rows asked by key, one per entity.

1. **The rule at load.** `byKey` requires `subject`; the read declaring it opens without input; it names another read
   of the same connector whose `about.entity` is `subject.entity` and whose view is a table or a list. A manifest that
   breaks one is refused with the rule (`packages/connectors/src/validation.ts`). An additive field: protocol 3 keeps
   its number ([D60](D60-the-instance-serves-its-connector-protocol.md)).
2. **One place.** The registry lists, for each read about an entity, the reads the person may call that name it in
   `byKey` (`AboutRead.overviews`), and the entity list carries them on each lens (`EntitySource.overviews`). Where an
   administrator offers that lens, whatever opens such a read without input opens the lens's tab of the list instead
   (`peopleReadHref` in `apps/web/src/view-address.ts`): Hem's figure "Sjukfrånvaro", whose read is "Frånvaro per
   person", opens Personal's Frånvaro tab, and a name there the person's page at that tab, which draws the lens's
   fuller read about them (its view's `open`). Read with an input, or without the lens offered, the read keeps its own
   page.
3. **The read stays.** It is still what the model is offered (`model`, `modelReads`), what a reader without the lens
   is shown and what an address that names it reads. Clew does not compare the two answers; a source that declares
   `byKey` promises they hold the same rows, so `hr.person` now also counts the last six months as the overview does.

**Why.** Personal's tabs are the only place for a read about the manager's people since D126, and only the source knows
that two of its reads are the same rows. The alternatives weighed: let a figure open a read about people directly
(only the figure would lead there, not a standing read or an answer's "Visa allt", and a read with keys cannot run
without them); make the overview itself a read about people (it could then no longer be a figure's target, a standing
read or a model tool); or let the web infer it from two reads whose rows open the same fuller read (a guess, not a
declaration, and D97 has Clew place a source only from what it declares). `byKey` names a read, not a place: Clew still
decides where the lens is shown and an administrator whether it is offered.

**Replaces.** Nothing. It adds to D97 (where a read about an entity is placed) and D126 rule 8 (Personal is one
register). Not covered: a table of units, such as Qlik's `qlik.sickLeaveByUnit`, names units by the source's own refs,
not Clew's unit ids, so it cannot declare `subject` and therefore not `byKey`; and the units have no register with
tabs to lead to.
