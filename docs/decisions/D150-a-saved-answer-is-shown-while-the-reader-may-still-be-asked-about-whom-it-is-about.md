# D150 · A saved answer is shown while the reader may still be asked about whom it is about

**Status:** provisional (Max Eriksson, product owner, 2026-11-27: a saved answer about a person is to stop being shown when the person is no longer the reader's to ask about, answer by answer and not by ending the reader's authority; accepted once an installation with real people has had a report change manager with answers about them saved) · **Date:** 2026-11-27 · **Area:** identity, assistant

**Decision.** An answer the assistant saved is shown again only while the reader may still be asked about everyone it
is about. The answer keeps who that is. Each time a conversation is read, Clew asks its own directory whether the
reader still stands to each of them as they did, and an answer that fails is withheld alone.

An example. In March Karin, who is Anna's and Bo's manager, asks which certificates Anna lacks, and the answer is
saved in her conversation. In June Anna's employment names another manager. Karin is a manager still, for Bo, so her
own authority has not changed. When she opens the conversation the answer about Anna is no longer sent. Her question
stands, and so does everything she asked about Bo. A new question about Anna was refused already
([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)).

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
3. **Nothing of what was answered.** The record is who, never what: `access.about` on the saved message, beside the
   connectors, the capabilities and the authorization fingerprint it already kept.

When it is shown:

4. **Asked on every read.** A thread is read through one boundary (`threadAccess`), for the list of work, a
   conversation, the list of conversations and what a later turn's model is handed. There each answer's people and
   units are asked of the directory, once for all the threads of the read: the reader stands to a person as
   themselves, as their manager or as a colleague, and to a unit as one they lead, belong to or follow up, and the
   answer is sent only if that is one of the relations it was read under, for every one of them.
5. **Withheld alone.** An answer that fails is sent as its place in the conversation and nothing else: no text, no
   rows, no sources, no card and no record of what it read. The conversation, the question and every other answer
   stand. The page draws a line in the answer's place: "Svaret visas inte längre. Det handlar om en person eller en
   enhet som du inte längre får fråga om."
6. **Not handed to the model.** A later turn's model is told that an answer stood there, as it is of any answer it may
   not have, and never what it said.
7. **Shown again when the relation is back.** Nothing is deleted. When the person reports to the reader again, the
   answer is sent as it was saved.
8. **Closed where Clew cannot tell.** A registry without the rule stands to nobody. An answer about more people than
   it can hold (500) is shown to nobody again. A directory that cannot be read fails the read; it is never taken as
   "show it".

The reader's own authority is still checked first, as before: a thread made under another unit, role or set of
capabilities is not shown at all. This decision adds the question that check cannot answer, since a report who gets
another manager changes nothing of the manager's own authority.

**Known limits.**

- A read that answers about people without being asked about them by key keeps nobody. A list of a manager's leave
  requests names the people in its rows, and the answer written from it is not tied to them.
- Work items pushed by a source are not asked again by this rule. A card about a person the reader no longer manages
  is closed when the source's next scan no longer returns it; one already handled stays readable under the reader's
  own authority.
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

**Evidence.** `tests/unit/assistant-reads.test.ts` (an answer about a report is withheld alone when she gets another
manager, a later turn's model is not handed it, and it is shown again when she is back; an answer about nobody is
never asked about; more people than an answer holds; a registry without the rule), `tests/unit/asked-about.test.ts` (what
a call tells of whom it was about, a context that carries something else in its place, how a reader stands to a person
and to a unit by Clew's key, a report who gets another manager or leaves, a directory that cannot be read),
`tests/unit/conversation.test.ts` (the turn's own people), and `tests/a11y/answer.spec.ts` (the line in the answer's
place at a wide and a narrow window).
