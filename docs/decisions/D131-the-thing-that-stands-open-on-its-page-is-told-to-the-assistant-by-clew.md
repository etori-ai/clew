# D131 · The thing that stands open on its page is told to the assistant by Clew: a person as one the asker named, a record as its read, and a system's read about a person stays closed

**Status:** provisional (the product owner chose its three open points on 2026-11-19: on a person's page the assistant is told who the person is; what another system shows about a person or a unit stays closed for now; a conversation asked beside a person's page is deleted when the person is erased. Built the same day: a work item, the review, a record, a person, a unit and a plan ask through the frame's button and pane, the browser names the thing and the server resolves it on every turn, and `subject-erase` deletes the conversations asked beside a person. Tried on the development stack with its local model: beside a report's page "hon" was read as that person, her competences were read with her user name and the open work about her was named by title; beside a plan's page the plan was read and its overdue items named; beside a service desk request, whose read the assistant may not make, the pane said so. Nothing outside the repository has tested it, and no manual screen-reader pass is made) · **Date:** 2026-11-19 · **Area:** assistant, ui, identity

**Context.** [D130](D130-the-assistant-is-asked-beside-every-page-through-one-button-and-one-pane-of-the-page-frame.md)
puts the assistant's pane beside every page, about one subject: "the page's thing, the page's list, or the thing
standing in the page's own pane" (rule 4). Its stages 1 and 2 built it for lists, where the subject is the read that
draws the list. A thing's page is different: what stands open is one work item, one record, one person, one unit or
one plan, and today the server is told which only for a work item and a calendar entry. A record goes as the name of
its read without the input that says which record; a person and a unit go as nothing, because
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) item 7 keeps a source's read about a person
from the model and [D115](D115-the-assistant-resolves-a-person-the-asker-names-and-hands-the-model-the-work-about-them-not-health-rows.md) hands the model only the people
the asker's own words name. A pane about Anna Lindqvist that is told nothing about Anna can answer nothing, and
D130's "Not built" asked for this decision before a person's page gets the pane. It also noted that erasing a person
does not reach the subject a conversation was asked beside.

**Decision.**

1. **The page says what stands open, and Clew resolves it as the person who asks.** With every question asked beside
   a thing's page the browser names the thing (`ConversationInput.thing`): a person or a unit by Clew's id, a record
   by its read and the input that draws it. Nothing the browser says about it is trusted: no name, no label, no row.
   The server resolves it again on every turn, as the asker and at that moment, and a thing it cannot resolve for
   them is told to the model as nothing. A conversation asked beside a page keeps the thing with its subject
   (`Thread.askedBeside.thing`), so every later turn is about it wherever the conversation is continued. A work item
   and a calendar entry go as they do today, as the chip that stands open (`beside`).
2. **A person whose page stands open is a person the asker named.** One of the people the asker manages is handed to
   the model as D115 item 3 hands a name the asker wrote: who they are (name, unit and user name), and the asker's
   open work about them by title, last day and buttons. D115 item 4 holds from the first question: every work item
   about them is handed by its title alone, in that conversation and for as long as it lasts. The model then reads
   about them with the reads it is offered that take a person
   ([D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md)
   item 3), each made as the asker and answered only where the asker may ask.
3. **The asker's own page is the asker.** The model is told that the page is the asker's own, and reads with the
   reads that answer for the asker without a person.
4. **Anyone else's page names nobody to the model.** A page of a person the asker neither is nor manages (a colleague
   found through a phone book, a manager above) tells the model nothing about who it is, and the pane says so under
   its heading before anything is asked. D115 item 1 stands: Clew names a person to the model only among the asker's
   own people.
5. **A unit whose page stands open is told by its name and id**, where the asker manages it or follows it up (the
   units Läget lists for them), so the reads that take a unit can be made for it. Any other unit is told as nothing.
6. **A record that stands open is read for the model by Clew.** When the read that draws it is one the assistant may
   make for the asker (`ViewEntry.assistant`), Clew makes it with the page's input, as the asker and as the
   assistant's read (D122 items 5 and 6), and hands the model what it would have been handed had it called the read
   itself (the view's `modelReads`). A read the assistant may not make is not made, and the pane says so. A plan is
   such a record (`boarding.plan`); the review of a work item is about the work item.
7. **What another system shows about a person or a unit stays closed** (the product owner, 2026-11-19). D97 item 7
   stands: a source's read about an entity is never the assistant's, on its page as elsewhere, and the pane names
   the systems it cannot read there, by the rule of D130's stage 2. Clew's own domains are read through the reads
   D122 opened. Opening a source's read about a person is a change to the connector protocol and is decided with
   D130's stage 5.
8. **Erasing a person deletes the conversations asked beside their page** (the product owner, 2026-11-19). A
   conversation kept as asked beside a person (item 1) is the one conversation Clew can tie to that person with
   certainty, and it is likely to quote what Clew knows about them. `subject-erase` removes each of them whole, for
   whoever asked, with an audit row of counts only. This answers D122's open question for these conversations and
   no others.
9. **On a thing's page the pane has the end slot and the facts stand above the read** while it is open, as they do
   where the window is narrow (D130 rule 11). The thing's own "Fråga assistenten" among its actions is gone: the
   frame draws the one button. "Öppna som samtal" leads to the conversation's page with the thing beside it, as
   D126 rule 5 placed it.

**Why.** The page already shows the person to the asker, who opened it; telling the model who it is adds no access,
since every read still runs as the asker, and it is what D115 already does for a name typed in the box. Resolving on
the server keeps a link, a stale tab or a forged request from naming someone the asker may not ask about. Keeping
D97 item 7 keeps the one line that has been easy to state and to test: a system's words about a person reach a model
only through a read the system offered as a tool. Deleting the conversation is the erasure a person would expect:
the alternative kept its text and dropped only the label.

**Alternatives.** Telling the model nothing about a person (the state before): the pane would stand on the page
where a manager most wants to ask and answer about other things. Opening every section the page shows to the model:
health-related rows of a source would reach it tied to a name, which D115 item 4 exists to prevent, with no decision
in the protocol about which reads may. Keeping the conversation and dropping its tie at erasure: nothing would then
find it again.

**Limits, known when decided.**

- A conversation started on the conversation's own page about a person (`/conversations/new?person=`, where a phone's
  button leads) is not kept as asked beside a page, so item 8 does not find it. It tells the server the thing with
  each question (item 1) but stores no tie.
- A record's input is kept with the conversation as the page sent it. Where an input names a person by a key, that
  key is stored; erasure by person does not look inside inputs.
- What the model is handed of a record is what its view lets a model read, which for some views is a summary and
  not the rows.

**As built, where it says more than the items above.**

- The unit of item 5 is one the asker manages or one below such a unit (the rule the unit's page and the registry
  ask, `unitRelation`); a unit the asker is only placed on is told as nothing, and its pane has no line that says so.
- What the model is handed of a record (item 6) is the reading a tool call of the same read would give
  (`modelReading` of its view). The record is read only when a model answers; the read is among the turn's reads,
  so the pane shows that it was made and the audit row counts it. The page's input is never told to the model.
- While a thing stands open, a question is not offered to another system's assistant: what stands open must not
  follow a question out of Clew.
- The turn's audit row says which kind of thing stood open (`thing`), never which one.
- The person whose page stands open is also the one whose single work item the model may fill in an action of, and
  whose work is drawn under an answer that speaks of it (D115 item 6), when the question names nobody else.
- Erasure writes `conversation.person_erased` about `person:<id>`, with the number of conversations and messages.
- Found while building: the model was told a person's id where it should have been told their user name
  (`ManagedPerson.key` is Clew's id since D122), so a read it made with it was refused in a real installation. The
  list of the asker's people now carries the user name, and both a named person and an open one are told with it.

**Not built, and what is open.**

- A plan cannot stand beside a conversation: `boarding.plan` is a list, and a list is a page. "Öppna som samtal"
  from a plan's page, and the button on a phone, lead to a conversation about the plan's read with no plan beside
  it and no thing told.
- A person with no plan yet, where the page offers to start one, has no subject and so no button.
- With the pane open at a wide window the read's column is as wide as the sheet leaves it, about 1000 px at 1728:
  the frame gives the column no measure while a pane stands beside it. Whether a thing's read should keep one is
  the product owner's to say.
- Att göra's item still has its own "Fråga assistenten" (D130's stage 4).
