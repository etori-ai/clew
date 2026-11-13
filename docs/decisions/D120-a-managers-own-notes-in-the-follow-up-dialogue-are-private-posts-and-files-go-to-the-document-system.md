# D120 · A manager's own notes in the follow-up dialogue are private posts, and their files go to the document system

**Status:** provisional (Oliver Borgström, 2026-11-13; built on the branch `dialogue-notes`, tested by nothing outside the repository; a new record in an owned domain, built as an exception to the freeze on new surface, D101, at Oliver Borgström's choice; item 8 is a direction, nothing of it is built) · **Date:** 2026-11-13 · **Area:** product

**Decision.** The follow-up dialogue ([D118](D118-the-follow-up-dialogue-is-an-owned-domain.md)) gets the notes
big-boss-board's specification describes (§5.7 of the function specification in the startsidan prototype,
`apps/projekt/public/kravspecifikationer/dashboard/Funktionsspecifikation_Dialogstod.md`, written from the running
service at commit `43eceac`, 2026-11-05), with the choices below. The prototype's requirements D-31 to D-35 are the
same notes.

1. **Posts, not a running block.** The specification tests two shapes side by side since 2026-10-14 and has not
   chosen: A, separate notes, the newest first, changed and removed; B, one running document per unit and area that
   saves itself 1.2 seconds after the last keystroke, the last save winning. Clew builds A. Every change in Clew
   writes its audit row in the same transaction, which a block saved on every pause would fill with rows that say
   nothing, and "the last save wins" loses text where the same person writes in two windows.
2. **Private to their author.** A note is read, changed and removed by the person who wrote it and by nobody else:
   not the unit's manager, not the manager above, not an administrator in the product. In big-boss-board everyone
   with the access code saw every note, which the specification accepts only because one person has the code, and it
   says the notes should become personal once people sign in. With D117 two managers follow up the same unit, so
   here they must be.
3. **A record of the dialogue module**: `dialogue_note` (migration `0055_dialogue_note`), per unit and area, with its
   author. There is no note about a unit as a whole, as big-boss-board decided on 2026-10-14. The text is sealed at
   rest under a purpose bound to the row and appears in no audit row, log line, trace or card (D118 item 9). At most
   4 000 characters, as an activity.
4. **Written within the author's reach.** A note is written on a unit the author follows up (D117, read when asked).
   An author who no longer follows up the unit reads nothing of its dialogue, their own notes included; the notes
   stay in the table until the author removes them or is erased, and come back if the unit is theirs again. A refusal
   reads the same for a note that does not exist as for another person's, so an id tells nobody anything.
5. **Looser than an activity.** No owner, no card in Att göra, no timer and nothing to mark done. A note is removed
   for good behind a confirmation. Each change has its audit row (`dialogue.note_added`, `dialogue.note_edited`,
   `dialogue.note_removed`) with the unit and the area, never the text.
6. **Drawn last in an area's panel**, under the activities, as "Mina anteckningar" with the line "Bara du ser dem. De
   följer enheten mellan samtalen.": the list, the newest first, each with when it was written and changed, and the
   form behind "Ny anteckning", as the drawer's other forms are (D118 item 11). No new page, drawer or address.
7. **Erasure and export.** Erasing a person (`scripts/dialogue-erase.ts`) removes their notes whole, since a note
   without its author is nobody's; the table's foreign key does the same if the person's row goes. The operator's
   export holds every note with its author, text opened; `clew.dialogue/1` gains the list `notes` and keeps its
   version, since nothing that read it before breaks.
8. **A file attached to a note is not stored in Clew** (Oliver Borgström, 2026-11-13). The specification lets a note
   carry files (20 MB each, a whitelist of types) and calls them public documents that may hold names. Such a file
   goes to the municipality's document or case system through a connector, and the note keeps that system's id for
   the file, its name and a link. Registration, retention and archiving are then that system's, which has them. This
   needs a write in the connector protocol that takes a file (building block B6 of the
   [parity page](../reference/prototype-parity.md), in the other direction than today's delivery) and a connector to
   that system. Neither is built, and no file store is added to Clew for notes in the meantime.

**Why.** Oliver Borgström, 2026-11-13, after the count of what version 1.0 of the startsidan prototype still lacks in
Clew: the notes are the part of Dialogstöd's dialogue D118 left out. The plan for absorbing big-boss-board said bbb
has no notes; that was read from the public repository (latest commit 2026-10-28), which has none, while the
specification of the running service has them.

**Not established.** Which of the two shapes the people who use big-boss-board prefer; the specification says to ask
them. Whether a manager's own notes are public documents or working material, and how long they are kept (D118's
question 6 covers them too). Which document system takes the files, and whether it can take a file from a connector.
Whether the operator's export should hold notes nobody but their author reads in the product. No screen-reader pass
has been made.

**Replaces.** Nothing. Amends the
[plan](../reviews/2026-11-12-absorbing-big-boss-board-into-clew.md)'s row "The prototype's notes block" (not carried
over) and D118, whose records were two kinds and are now three. Builds on D95, D96 (sealing), D117 (the reach) and
D118.
