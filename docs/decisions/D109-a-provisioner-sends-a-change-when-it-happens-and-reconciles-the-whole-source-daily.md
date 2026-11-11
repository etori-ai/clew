# D109 · A provisioner sends a change when it happens, and reconciles the whole source at least daily

**Status:** provisional (product owner, 2026-11-11: with SCIM a change is pushed when it happens, and once a day is not the rule); accepted once a provisioner outside the team sends its changes as they happen; the page, the guide and the comments say it, and the example provisioner still only reconciles · **Date:** 2026-11-11 · **Area:** identity

**Decision.** People, units and groups enter Clew through SCIM (D68). Two things are asked of a provisioner, and the
first is the rule.

1. **A change is sent when it happens.** When a person begins, leaves, changes name or address, moves between
   units, becomes or stops being a manager, or gains or loses a capability, and when a unit is added, renamed, moved
   or removed, the provisioner sends that one change to Clew then: one request, or two for a move. The server takes
   each as it is and derives the person's grant in the same transaction, so the person has the right access at their
   next request. Nothing new was built for this: every operation was already a request of its own.

2. **A membership is changed on the group, the addition first.** A unit, a manager's role and a capability are
   memberships (D68 item 2), and SCIM changes a membership on the group, not on the person. A person who moves is
   added to the unit they join before they are removed from the one they leave
   ([D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)).

3. **The whole source is reconciled at least daily, as the net under it.** A change that was lost on the way (the
   provisioner was down, a request failed and was not sent again) is found by nothing else. The run is D101's: the
   organisation, the people, the memberships, what left the source. It writes nothing where nothing differs, so it
   costs little on a day when every change arrived.

4. **Time stays in the source.** Clew holds no validity dates (D68 item 4). A change that takes effect on a day, an
   acting manager from the first of the month, is sent by the provisioner on that day.

5. **The page says so.** Administration › Användare, under "Inläsning från katalogen", says that the catalogue sends
   each change when it happens and reconciles everything at least once a day, and that until a change has arrived
   the access the person had is the one that holds. The warning after two days of silence stays: a provisioner that
   reconciles daily is heard from daily, whatever else it sends.

**Why.** The product owner, 2026-11-11, reading the page: this is SCIM, and that it should be done once a day is
wrong; it should be done at the change, with a push. D68 item 4 said a provisioner "must run at least daily", the
guide said "run it at least daily" and the page said the catalogue "ska föra in ändringar minst en gång per dygn".
Each of them made the daily run the rule and read as a nightly batch, under which a person who changed unit or
stopped being a manager kept their old access for up to a day. The server never needed that: the daily run was the
only thing the example provisioner did, and the texts described the example.

The alternative was to drop the daily run and rely on the changes alone. A push has no acknowledgement beyond its own
answer, and a provisioner that was down for an hour has no way to know what it missed except to compare.

**Not built.** The example provisioner (`scripts/provisioner/`) still only reconciles: the development directory is a
file and has no events. The guide gives the request for each kind of change. A way for Clew to tell that changes
arrive as they happen and not only once a day: the page shows when a provisioner last called, not how often.

**Replaces.** Amends [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) item 4: a provisioner sends a
change when it happens, and the daily run is the reconciliation under it.
