# D150 · A saved answer is shown while the reader may still be asked about whom it is about

**Status:** provisional (Max Eriksson, product owner, 2026-11-27: a saved answer about a person is to stop being shown when the person is no longer the reader's to ask about, answer by answer and not by ending the reader's authority; accepted once an installation with real people has had a report change manager with answers about them saved) · **Date:** 2026-11-27 · **Area:** identity, assistant

**Decision.** An answer the assistant saved is shown again only while the reader may still be asked about everyone it
is about. The answer keeps who that is. Each time a conversation is read, Clew asks its own directory whether the
reader still stands to each of them as they did, and an answer that fails is withheld by itself: the conversation, its
questions and what was answered before it stand.

An example. In March Karin, who is Anna's and Bo's manager, asks which certificates Bo lacks and then which Anna
lacks, and both answers are saved in her conversation. In June Anna's employment names another manager. Karin is a
manager still, for Bo, so her own authority has not changed. When she opens the conversation the answer about Anna is
no longer sent. Her questions stand, and so does the answer about Bo. A new question about Anna was refused already
([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)).

Had she gone on with "Sammanfatta det i en mening", that answer goes with the one about Anna. It read nothing and
names nobody, and it was written with the answer about Anna in hand.

What an answer keeps:

1. **Whom the reads of the turn were about.** Every read the assistant makes in a turn tells whom it was about once
   the registry has resolved that: each person or unit the input named that the asker may ask about, by Clew's own key
   (a person's id, [D122](D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md); a unit's id), with the
   relations the capability admits. A read nested in another tells too. A key the asker may not ask about was never
   sent to the source and is not kept.
2. **The people the turn itself brought in.** A name the question wrote, a person the model looked up and the person
   whose page stood open are among the asker's reports and nobody else
   ([D115](D115-the-assistant-resolves-a-person-the-asker-names-and-hands-the-model-the-work-about-them-not-health-rows.md)), so each is kept as read under
   `managed`.
3. **Whom the answers it was written with were about.** The model is handed the conversation's earlier answers, and
   what it writes may repeat any of them. So an answer the model wrote is about whom every answer it was handed was
   about, whether or not it read anything itself. An answer that is already withheld is not handed, and adds nobody.
4. **Whom the work items it was written from are about.** A work item the person pointed at or named, one the answer
   drafted an action on and one the turn started: each person and unit the item names, under the relation the asker
   stands in to them as the answer is written, the narrowest that holds (themselves, their manager, a colleague; a
   unit they lead, belong to, follow up). Such an answer reads no source about anybody, and says what the item says.
5. **Nothing of what was answered.** The record is who, never what: `access.about` on the saved message, beside the
   connectors, the capabilities and the authorization fingerprint it already kept.

When it is shown:

6. **Asked on every read.** A thread is read through one boundary (`threadAccess`), for the list of work, a
   conversation, the list of conversations and what a later turn's model is handed, and a request that changes a
   thread (set aside, reminded of, put back) answers with the thread as that boundary sends it. There each answer's
   people and units are asked of the directory, once for all the threads of the read: the reader stands to a person as
   themselves, as their manager or as a colleague, and to a unit as one they lead, belong to or follow up, and the
   answer is sent only if that is one of the relations it was read under, for every one of them.
7. **Withheld by itself.** An answer that fails is sent as its place in the conversation and nothing else: no text, no
   rows, no sources, no card and no record of what it read. The conversation, its questions and every answer that is
   not about the person stand. The page draws a line in the answer's place: "Svaret visas inte längre. Det handlar om
   en person eller en enhet som du inte längre får fråga om."
8. **With every copy of it.** A conversation's summary is its newest answer's text, and is withheld with that answer.
   A card made from an answer carries the answer's record, and its summary, which is the answer's text, is withheld
   with it. A reply written in a work item is the conversation's answer copied into the item, and the copy carries the
   record where the answer is about somebody.
9. **Not handed to the model.** A later turn's model is told that an answer stood there, as it is of any answer it may
   not have, and never what it said.
10. **Shown again when the relation is back.** Nothing is deleted. When the person reports to the reader again, the
    answer is sent as it was saved.
11. **Closed where Clew cannot tell.** A registry without the rule stands to nobody. An answer about more people than
    it can hold (500) is shown to nobody again, and so is one written with such an answer in hand. A directory that
    cannot be read fails the read; it is never taken as "show it".

The reader's own authority is still checked first, as before: a thread made under another unit, role or set of
capabilities is not shown at all. This decision adds the question that check cannot answer, since a report who gets
another manager changes nothing of the manager's own authority.

**Known limits.**

- Every answer the model writes after one about a person, in the same conversation, is about that person too, and
  goes with it, whatever it said. It stops when the first answer is no longer among the twenty messages the model is
  handed, or is withheld. This shows less than it could: Clew cannot tell which of the answers in hand a text repeats.
- A read that answers about people without being asked about them by key keeps nobody. A list of a manager's leave
  requests names the people in its rows, and the answer written from it is not tied to them.
- Work items pushed by a source are not asked again by this rule. A card about a person the reader no longer manages
  is closed when the source's next scan no longer returns it; one already handled stays readable under the reader's
  own authority.
- A person or unit a work item names whom the asker stands in no relation to as the answer is written is not kept. The
  item is the asker's to read under their own authority, and the answer says no more than the item does.
- A reply in a work item that is about somebody carries the authority it was written under with the record, as a card
  made from an answer does: the item is then shown only under that authority. No page writes such a reply today.
- A withheld answer carries none of its state. Where it held the newest draft of an action, an earlier draft of the
  same action in the conversation is drawn as the current one, and a card it drew may be drawn again under a later
  answer. Nothing of the person is shown by either.
- An answer another system's assistant wrote keeps nobody: Clew does not know whom it read about.
- The question the person wrote stays as written, also when it names the person.
- A name in the question ties the answer to that person whatever the answer said. It is withheld with them, which errs
  on the side of showing less.
- An answer saved before this decision keeps nobody and is shown as before. The product is not launched, so there are
  none to bring forward.
- Each read of a thread with such an answer reads where the reader stands once, and looks up a colleague once for
  each person kept as one.

**Why.** A review of the change that made the reporting line explicit
([D147](D147-an-employment-is-a-row-of-its-own-and-names-the-person-it-reports-to.md),
[D149](D149-a-manager-is-who-leads-a-unit-or-is-reported-to.md)) found that a manager who keeps another report keeps the
same authorization fingerprint, and can reopen a conversation that holds a former report's competence. It was so
before those decisions too. The fingerprint covers the reader's unit, role, capabilities and units. Who reports to
them is not part of it, and should not be: it is another person's fact, and it changes far more often.

Two ways out were weighed. Changing the manager's fingerprint whenever a report is withdrawn is simple, and it signs
the manager out, hides every answer they have saved and ends their work in flight each time anybody leaves their
staff: for a manager of forty people that is every staff change. Asking again, answer by answer, withholds exactly
the answer that is about the person and nothing else, and gives it back if the person returns.

Clew's own key and not the user name, because a user name can be renamed and later given to somebody else
([D122](D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)): an answer kept by name would follow the
name to a stranger. The relations the read admitted and not only "managed", because a read that any colleague may
make, such as a phone number, is still the reader's to see when the person has another manager.

The registry tells whom a call was about, and no caller works it out, so that one rule decides both what a source is
sent and what is kept of it.

**Alternatives.** Deleting the answer when the relation ends: a person who returns would find a hole, and deleting on
a directory change that is later corrected cannot be undone. Hiding the whole conversation, as a change of the reader's
own authority does: the conversation is mostly about other things. Keeping the rows an answer drew and asking about
each: the answer's own text is the content that matters, and it has no rows.

**Refines.** [D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md): who
may be asked about decides what is shown again, not only what is asked.
[D122](D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md): a saved answer is one more of Clew's own
records that names a person by id. The open question the review of pull request 156 left is answered by this record.

**Evidence.** `tests/unit/assistant-reads.test.ts` (an answer about a report is withheld when she gets another
manager, with the answer written after it and the conversation's summary, while the answer before it stands; a later
turn's model is handed neither and writes about nobody they were about; they are shown again when she is back; an
answer written from a work item keeps the item's people under the relation that holds; a card made from an answer; an
answer about nobody is never asked about; more people than an answer holds; a registry without the rule),
`tests/unit/asked-about.test.ts` (what a call tells of whom it was about, a read made inside another, a context that
carries something else in its place, how a reader stands to a person and to a unit by Clew's key, a report without a
user name, a report who gets another manager or leaves, a directory that cannot be read),
`tests/unit/conversation.test.ts` (a person the question names, one the model looks up and the one whose page stands
open; the answer that started a work item; a withheld answer in what a set-aside and a reminder answer with; a reply
in a work item), and `tests/a11y/answer.spec.ts` (the line in the answer's place at a wide and a narrow window).
