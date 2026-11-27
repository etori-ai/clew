# D148 · A unit carries the identifiers other systems know it by

**Status:** provisional (Max Eriksson, product owner, 2026-11-27: the unit carries its keys to other systems, the directory pushes them and a connected system is told them; the shape below is this build's choice; accepted once a provisioner has pushed identifiers from a real directory and a connector has answered a real system with one) · **Date:** 2026-11-27 · **Area:** identity

**Decision.** A unit has one id in Clew, the directory's. Other systems know the same unit by other names: an economy
system by the code its costs are booked on, a statistics system by its own key. The directory holds those names, pushes
them with the unit, and Clew hands them to a connected system that asks for them. Clew reads no meaning from one.

What a unit carries:

1. **A unit has identifiers.** The unit extension of a `unit:` group
   (`urn:clew:params:scim:schemas:extension:unit:2.0:Group`) has a second attribute beside `parent`: `identifiers`, a
   list of entries with a `type` and a `value`. The type is the directory's own word for the kind of identifier, such as
   `ansvar`; the value is the identifier as the other system writes it. A unit has any number of entries, several of one
   type too, up to fifty.
2. **An identifier is stored exactly or not at all.** Both parts are text in composed form (NFC), with no space at
   either end and no control character, a type of at most 64 characters and a value of at most 256. An entry that is
   wrong refuses the write with 400 `invalidValue` and names the part, as a key written wrong does
   ([D96](D96-a-key-written-wrong-is-refused-at-the-scim-boundary.md)): cleaned instead, it would be stored as another
   key while the answer said stored. The same entry twice is kept once. The order is the directory's and is kept.
3. **The list is sent whole.** An entry has no id to be changed by. A `PUT` replaces the list and one without the
   extension clears it, as it makes the unit a root. In a `PATCH`, `replace` on the attribute's path sets the list, `add`
   appends to it, and `remove` or `null` clears it; the extension's object sets only what it names, so a move leaves the
   identifiers alone and a new list leaves the unit where it stands. A path into the list, a `remove` with a value and
   the bare name `identifiers` on a unit group are refused, never accepted and ignored.
4. **Only a unit carries them.** On any other group identifiers are refused, as a parent is
   ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)), and a group whose
   key stops being a `unit:` key loses the ones it had.
5. **Nothing follows from one inside Clew.** A change is audited on the group with the list before and after and moves
   the group's time of change. Nobody's grant, assignment or reporting line is derived from it, and no member's
   resource changes.

What a connected system is told:

6. **A capability says which types it reads.** A capability about a unit names them in `unit.identifiers`, spelled as
   the directory sends them (`["ansvar"]`). It is part of the manifest an administrator approves
   ([D144](D144-a-connectors-manifest-goes-live-only-when-an-administrator-approves-it.md)).
7. **It is told those types and no other.** For every unit a call names and the caller may ask about
   ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)), the body's
   `about` carries `identifiers` beside `relations`: the unit's entries of the declared types, in the directory's
   order. A unit with none of them is absent, and the capability answers it as a unit its system holds nothing for.
   The map is in the body, which the assertion binds, and never in the bearer. A capability that declares no type is
   told none, and the registry filters by the declaration whatever the directory read answers.
8. **Clew holds the key, not the other structure.** The open item of D99 is answered: the line organisation is the
   only tree Clew holds. A cost-centre hierarchy and the political organisation stay with their sources. An identifier
   is where a unit stands in such a structure, as the directory says it, and nothing more.

The example provisioner (`scripts/provisioner/`) sends them: a unit of the `Directory` has `identifiers`, a plan stops
on an entry Clew would refuse before anything is written, a changed list is one `replace`, and a second push is silent.
The check says how many units carry each type and names the units with people that lack a type most of them carry.

The first capability to read one is the POB connector's `pob.unitCosts` ([its README](../../connectors/pob/README.md)):
what the service agreements booked on a unit cost, for the person who leads the unit. It is switched on by naming the
identifier type, and its adapter for POB's own API is a draft that has met no POB.

**Known limits.**

- A connected system is told identifiers only on a call that names units: a read or an action about a unit. The acting
  person's own unit, the units they follow up and their assignments carry none, so a scan, a figure and a card cannot
  yet say what a manager's own unit costs without being asked about that unit.
- Nothing in the product shows them. Administration › Organisation does not list a unit's identifiers, and the review
  of a manifest does not say which types a capability reads.
- An identifier need not be unique: two units may carry the same one, and Clew does not say so.
- There is no list of types. A manifest and a directory agree on a type by spelling it the same; the check counts the
  types a push left, which is where a misspelling shows.
- Clew relates no identifier to another. Where a directory gives a unit above the lowest level a short code that the
  codes below begin with, a capability asked about that unit is told the short code and decides for itself what it
  covers.

**Why.** On 2026-11-27 the organisation, the employments and the units' responsibility codes of Sundsvall's directory
were read, counts and unit names only. All but one of the units people work on carry a code, twenty-two carry more
than one, and the service desk books a unit's IT costs on an accounting string that begins with the code. The code is
master data on the organisation's node, held by the directory that already pushes the node. Until now a connector had
only the unit's id, so each one that needed another key kept a table of its own: the finance fixture maps a unit to a
cost centre in its own code, and [D119](D119-key-figures-per-unit-come-through-one-vendor-neutral-profile.md) lists
"how Clew's units map to its units" among what is not established. A table per connector is as many copies as there
are connectors, each to be corrected by hand at every reorganisation. Pushed with the unit, the key has one owner,
moves with the unit and is audited where it changes.

Each type is declared and nothing else is sent because an identifier a system does not need is one more thing it knows
about the organisation. It rides in the body beside the relations because a manager follows up to two hundred units,
and a list that long signed into a header is what once made a header too large.

**Alternatives.** A table in each connector: no change to SCIM, and what the fixture does today, at the cost above. The
enterprise extension's `costCenter` on the user: a standard attribute, but it is the person's, and a cost belongs to a
unit whoever works on it; a person on two units would carry one. The code as the unit's id: a unit above the lowest
level has none, a few have several, and an id may not change when the economy's plan does. A fixed attribute for the
responsibility code: it is one municipality's word for one system's key, where the next system and the next
municipality have another.

**Refines.** [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md): the unit
extension has a second attribute, and the first item under "Open" is answered.
[D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md): what a source is
told of a unit it is asked about. [D119](D119-key-figures-per-unit-come-through-one-vendor-neutral-profile.md): how
Clew's units map to a source's units is no longer open; which API answers still is.

**Evidence.** `tests/unit/unit-identifiers.test.ts` (the attribute over SCIM: created, replaced, patched, cleared,
refused, audited, and nobody derived), `tests/scim-store-contract.ts` on both adapters (kept as written, read by every
read of the group), `tests/unit/asked-about.test.ts` (a read about a unit is told the declared types for the units it is
sent and no other, a resolver that answers more is not believed, the body validates against the published request and
the bearer carries none), `tests/unit/pob-connector.test.ts` (a connector that reads one: only a unit the person leads, only
a code that is one, every agreement compared again), `tests/unit/provisioner.test.ts` (pushed, changed, removed, a second push silent, a wrong
entry stops the plan, and the check's line). The migration is `0002_unit_identifiers`.
