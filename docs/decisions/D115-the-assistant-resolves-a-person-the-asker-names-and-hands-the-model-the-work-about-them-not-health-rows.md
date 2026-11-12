# D115 · The assistant resolves a person the asker names among their own people, and hands the model the work about them, never a source's health rows

**Status:** provisional (product owner, 2026-11-12: make a question like "Anna har varit sjuk i två veckor, vad gör jag?" work with an ordinary model first; the freeze on new surface lifted on his word for what it needs), built 2026-11-12; accepted when a manager outside the repository has asked about one of their people with an open-weight model configured and found the answer useful; item 8, a model marked as safe for health data, is the intended next step and is not built · **Date:** 2026-11-12 · **Area:** product

**Context.** Hillevi Berg, a manager on the development stack, asked the question box "Anna har varit sjuk i två
veckor, vad gör jag?". No model was configured (the dev database had no provider and no model; the turn's audit row
says `assistant: router` with no `fallbackReason`), so the router answered, and its figure rule matched the bare
word "sjuk" and gave the digest of every figure ("Utvecklingssamtal hållna: 0 av 11 … Sjukfrånvaro: 4,2 %"). Nothing
about Anna and nothing about what to do, while her "Behöver dig" already held the HR system's work item "Boka ett
omtankesamtal med en medarbetare" about Anna, whose "Boka samtalet" opens the action dialog. With a model configured
the model path runs before the router (`apps/server/src/assistant/index.ts`, `converse`), so the ordering was not the
fault; but the model would have known nothing of Anna either, since a conversation told the model nothing about a
person (D97 item 7) and no source held the routine.

**Decision.**

1. **Clew resolves the name, among the asker's own people.** A name the asker writes is matched by Clew, never by the
   model and never by a source, against the people the asker manages (the people module's list behind Personal,
   D94 and D99) and nobody else: not a colleague elsewhere, not the asker. The match is without regard to case on
   whole names and name parts: the full name, else the first name, else the family name; a Swedish genitive
   ("Annas") is read as the name. One person is that person; several are named back by their names and the asker is
   asked which; nobody is said to be nobody. The names of the asker's own people are not health data. The rule and
   its tiers are the ones the parked branch `entity-sources` (6a22b59, `matchManaged`) built for a sick report by
   name, with one change: several matches are named, not counted, so the asker can be asked which.
2. **What counts as a name in a question.** A whole name in any case ("anna lindqvist"), or a word written as a name,
   with a capital ("Anna", "Lindqvist"); capitalised words in a row are one name, so "Anna Svensson" names nobody
   rather than Anna Lindqvist. A lower-case word that happens to be someone's name ("frånvaro per person" and Per)
   is not read as one. The model may also look a name up itself with Clew's tool `clew.findPerson`, which resolves it
   only among the people the asker's own words in the conversation could name, in any case: the model cannot look
   up a name it got from a source.
3. **What the model is handed about the person.** Who the name is (name and unit), and the asker's open work about
   them from the index from entity to cards (D97 item 6): every card under "Behöver dig" whose rows name them, by
   its title, its source, its last day and the buttons it shows now. Nothing else. A source's read about the person
   still never reaches the model (D97 item 7 stands for reads). A card of Clew's own that names its employee only on
   the thread (an action point, D96 item 6) is not listed.
4. **A card about a named person is handed by its title alone.** A card's summary, rows and receipt are a source's
   words and may say what the source knows about a person's health ("tredje korta sjukfrånvaron på sex månader",
   "3 korta perioder"). Once the conversation names the person, Clew would be the one tying those words to them. So
   every card about anyone the asker's words in the conversation could name, by rows or by thread, is handed to the
   model by its title, last day and buttons wherever it appears in the turn: chipped, named by its title, or listed
   under the person; in that turn and in every later turn of the same conversation. Without a name a chipped card is
   read as before. What the asker typed is theirs to say, and the model reads it as typed.
5. **Policy text is not health data.** A source may offer its routine as an ordinary read the model uses and is
   handed whole. The HR fixture's `hr.rehabRoutine` ("Rehabiliteringsrutinen", a list view with a menu row) answers
   the synthetic steps of the rehabilitation routine for short, repeated and long sick leave and the return to work.
   The prompt tells the model to read the routine when asked what to do, to point at the work item and its button,
   never to guess and never to ask about a diagnosis.
6. **The answer draws the work, and the model may draft on it.** The work items about the people the question
   names, and those the model looked up, are drawn in the turn as the cards an answer is about (`MessageMeta.cards`,
   D34 and the canvas's H1), at most three. When the question names one person with exactly one work item and no
   card is chipped, that item is the one the model may fill in an action of (D112 item 8): "Granska och boka" opens
   the action's own dialog with the values; nothing is sent from the conversation.
7. **Without a model, the router does the honest best it can.** A question that names one of the asker's people
   with open work is answered with it: "Under Behöver dig finns ett öppet ärende om Anna Lindqvist: "Boka ett
   omtankesamtal med en medarbetare", senast måndag 16 november.", and the item is drawn. A name that may be several
   people is answered with their names and "Vem menar du?". Anything else goes on through the router as before. The
   figure rule (D54) answers only questions about the figures: a figure's word ("sjukfrånvaron", "budgeten",
   "läget"), never a question that asks what to do ("vad gör jag", "vad ska jag göra", "hur gör jag") or names one
   of the asker's people, and the bare word "sjuk" is no longer one. "Hur ser sjukfrånvaron ut?" still gets the
   figure.
8. **The intended next step, not built: a model marked as safe.** A model an administrator marks as safe, for
   instance one running on the installation's own GPUs under the installation's control, may later be handed what a
   source holds about a person's health, so the answer can use the absence itself and not only what the asker typed.
   Nothing of this is built and no field or switch exists for it. The questions it raises wait for the product
   owner in [open questions](../maintainers/open-questions.md): who may mark a model, what "safe" must mean, whether
   it is per model, per source or per installation, and what the audit row says.

**As built, 2026-11-12.** `apps/server/src/assistant/people.ts` holds the name rules, the person part of a turn
(`peopleInTurn`: the asker's people, the names, the people the conversation could name and their cards, read once
per turn), the prompt's lines, the tool and the router's answer. The assistant reads the people through a new port,
`AssistantDeps.people`, which the composition root binds to the people module's `staff.reach` (only people who can be
asked about, D97); the cards come from the thread store's index through `subjectCards`. `serialiseContext` takes the
guarded set; `routeFixed` takes whether the question names someone. The system prompt gains a block "Medarbetare som
personen nämnde" and four rules. The turn's audit row lists the tools used (`clew.findPerson` among them) and the
cards drawn, never a name or the text; the name as written is in the conversation's message as the tool's input. No
change to `@clew/contracts` and none to the connector protocol; the HR fixture's manifest adds one read.

**Limits.** Older than this record and against its spirit: `hr.whoIsOn` (`model: true`) hands the model, for a
manager, the names of the absent with "sjuk", "sjukskriven" or "vab"; it is left as it was and noted in the open
questions. A work item's title is handed as the source wrote it, so a title that states a health fact ("Sjukanmälan
att registrera", the HR fixture's card from "Registrera frånvaro") tells the model that fact about the named person,
and an omtankesamtal card exists because of repeated short absence, which the routine says. A pronoun in a later turn
("boka det åt mig") does not carry the person over: who the question names is read per turn. A person on another
unit (D97's colleague) is not resolved. No model has run this outside the tests; the development stack has none
configured, and the HR fixture's new read reaches Clew only after its manifest is fetched again on Anslutna system.

**Why.** The alternatives weighed. Letting the model resolve the name through a read about the person: D97 item 7
keeps those reads from the model, and a source would be the one deciding who "Anna" is. Handing the model the whole
staff list: it would name everyone the asker manages unasked; the parked branch chose "never a key or a list of
names", and names are listed here only when several share the name the asker wrote. Resolving only through a tool:
small open-weight models skip tool calls, and the draft subject and the cards must be known before the model runs.
Handing a named person's card in full: Clew would tie a source's text about health to a name, which is the rule's
whole point. Changing the order so the model runs first: it already does; the router answered because no model was
configured.

**Replaces.** Refines [D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) item 7 for the
assistant: a question that names one of the asker's people tells the model who they are and the asker's work about
them, while a read about the person still never reaches the model. Narrows the router's figure rule of
[D54](D54-figures-come-from-connectors-and-laget-draws-them.md). [D8](D08-every-action-works-without-the-model.md)
and [D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 8 are
unchanged: the assistant drafts, the person decides.
