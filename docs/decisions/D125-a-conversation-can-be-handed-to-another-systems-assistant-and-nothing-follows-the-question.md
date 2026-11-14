# D125 · A conversation can be handed to another system's assistant, and nothing of it follows the question

**Status:** provisional (the product owner's statements of 2026-11-13 and 2026-11-14, in substance: an assistant in another system is indivisible, so Clew asks it and never reaches into its knowledge; only the person's own message and what they choose goes there, and Clew adds and rewrites nothing; the handover is the person's own choice, sticky and visible; what may leave the Clew chat is closed by default and opened by a mark from the source; a person may send data about themselves and never about another person. They approved the plan this record follows on 2026-11-14. Items 1 to 9 are built on the hello connector's example assistant and against recorded answers of Eneo's API; item 10 is not built. Nothing outside the repository has tested it: no real Eneo has been asked) · **Date:** 2026-11-14 · **Area:** assistant, integrations

**Decision.** A system that has assistants of its own can offer them to the people who use Clew, through a profile of
the connector protocol. A person picks one in the box's menu; from then on what they write in that box goes to that
assistant, unchanged and alone, and its answer is shown as that assistant's own, unchanged. The whole assistant answers
there, with its own instructions, knowledge and tools. Clew routes, shows, stores and audits; it never searches an
assistant's knowledge without the assistant, never lets its own model speak to one, and never answers in one's name.

1. **The assistants profile.** A manifest's optional `assistants: { list }` names one of its reads, which takes no
   input, is never a model tool and answers a `SourceAssistantsOutput`: the assistants the person behind the call may
   ask now, each with the source's own key, a name and what it is for. Declaring it means the connector serves
   `POST /clew/ask`. Which assistants are listed is the source's to decide; Clew switches none on or off, and an
   administrator governs the profile as any read: the connector's audience, the listing read's switch and its scope
   decide both who sees the assistants and who may ask them. Added under protocol 3 as an optional field
   ([D60](D60-the-instance-serves-its-connector-protocol.md) item 4); a manifest on 2 cannot declare it.
2. **Asking.** `POST /clew/ask` carries the actor, the assistant's key, the person's question as they wrote it, the
   source's key for the conversation it keeps when there is one, and what the person chose to attach (item 10). It is
   signed and bound to its body as every call is ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)),
   and carries the person's own token for a connector that declares `delegation`. The answer is server-sent events:
   the text as it is written, the sources it cites, then one `done` with the session to continue in and, when the
   source has one, the address where the same conversation continues there, or one `error` with the protocol's code.
   Clew stops reading when the person stops the turn, after 30 seconds of silence and after 3 minutes in all.
3. **It is not a capability.** No model, page, card, job or callback can name the route: only `Registry.ask` reaches
   it, and only a turn whose `ConversationInput.assistant` the person's own box sent. Before a question leaves, the
   registry checks what a capability's run checks (the connector is visible to the person, the listing read is
   switched on and in their scope, their live authority holds) and reads the listing again as the person: an assistant
   the source no longer lists for them cannot be asked by its old key. The governance and the authority are read again
   before the final event is released, so a turn whose permission ended while it was answered stores nothing.
4. **What leaves Clew.** The person's text, as typed, and nothing else of the conversation: no earlier turn, no read
   result, no card, no row, no chip. Clew's own model is not asked in a handed-over turn at all, so nothing is
   rewritten on the way out or on the way back. The turn works with no model configured
   ([D8](D08-every-action-works-without-the-model.md)).
5. **Sticky and visible.** Picking an assistant changes whom the box talks to until the person goes back to Clew or
   starts a new conversation. While it lasts the box says so above the field ("Du pratar med …", the system's name,
   and that what is written is sent there), offers "Tillbaka till Clew", takes no `@` and shows no drawer, since
   nothing in it would follow. Each question is marked "Skickat till …". A conversation is handed to at most one
   assistant and remembers it with the source's key for the conversation there (`thread.handover`, migration 0079),
   so a follow-up continues it and a conversation opened again is still talking to it. Another assistant is a new
   conversation.
6. **The answer is the assistant's.** It is drawn under the assistant's name and its system's, never as
   "Assistenten", with the sources the source named and a link that continues the same conversation in the source's
   own interface. Clew offers nothing of its own under it: no follow-up suggestions, no card from the answer, no
   proposal. An assistant of another system cannot act in Clew: the card and the human decision endpoint stay the only
   way to a write ([D45](D45-approved-intent-precedes-source-dispatch.md)).
7. **When the source does not answer.** A refusal, a failure, a stream that ends before `done` and an answer without
   a word are said in Clew's own words, under Clew's name, and marked `failed`; a half answer already shown is taken
   back. Clew never falls back to its own model for a handed-over question: that would be answering in the
   assistant's name. A connector's own error text never travels further ([D91](D91-one-logger-opentelemetry-export-and-the-model-turn-in-the-audit-trail.md)).
8. **Stored and audited as every turn.** The question, the answer, the conversation's state and one audit row
   (`conversation.handed`: which assistant, new or continued, how many sources, whether it failed; never a word of
   either text) commit together. The stored answer is the source's content: it stays readable only while the person
   still has that connector and its listing read (`MessageMeta.access`). A turn the person stops writes nothing in
   Clew, though the source may already hold the question. One answer is kept up to 60 000 characters and says when
   it was cut.
9. **Eneo is the first implementer, and stays a connector.** The `eneo` connector lists the assistants an owner in
   Eneo made available to other clients and sends a question through Eneo's conversation API as the person, with
   Eneo's file-producing functions left out of the turn, since Clew's conversation cannot carry a generated file.
   Nothing in `apps/` or `packages/` knows Eneo: the profile is general, and an installation without Eneo is
   unchanged ([D14](D14-clew-stands-alone-eneo-enhances.md)). `connectors/hello` carries a small example assistant.
10. **What may follow a question (not built).** Nothing can be attached yet: a handed-over turn with a chip is
    refused before anything leaves. The rule it will be built to: closed by default. A source marks a read
    `forward: true` to say its content may be sent to another system's assistant when the person attaches it, an
    administrator can only narrow that, and the core refuses, whatever a source says, anything about another person
    than the one asking, and anything Clew's own model may not read. Documents first; rows about the asker themself,
    minus fields the source holds back, later. The person ticks what goes, each time, and the question shows what
    went.

**Why.** An assistant is where its owner's curation lives: which knowledge belongs together, the instructions that
keep its answers safe, the tools that complete them. Searching its knowledge from outside throws that away and still
shows the result under its name. Asking the whole assistant keeps it, and keeps the line of
[the vision](../vision.md): Clew owns the assistant that works in Clew, the other system owns the one that is a product
in itself. Sending only the person's own words keeps what Clew read for them (rows about colleagues, cards, cases)
from reaching a model and a system they never chose for it.

**What this changes in earlier records.**

- [D26](D26-questions-over-documents-are-search-not-knowledge.md) argued against embedding an Eneo assistant because
  it "hands the whole dialogue to Eneo and loses Clew's rules on the way: the audit row per turn, no names of
  individuals, source and time on every answer, and the card as the only path to action". Items 6 and 8 keep the audit
  row, the source and time, and the card as the only path to action. "No names of individuals" cannot be kept for
  words the person types themself; item 4 keeps it for everything Clew holds.
- [D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md)
  item 2 says a capability has two levels for the model and no third. Whether content may leave Clew (item 10) is a
  separate question about another system's assistant, not a third level of what Clew's model reads.
- [D4](D04-foreign-mcp-servers-are-wrapped.md) and the withdrawn D81 are untouched: the other system is reached
  through a connector, and no interface of its own is shown in Clew.

**Not decided.**

- Whether Clew's copy of an answer may outlive the retention the source sets for the assistant's conversations.
- Whether a question to another system's assistant may be longer than the 400 characters on one line a question to
  Clew may be.
- Whether Clew's own assistant may suggest handing a question over. Today only the person's own pick does.
- With many assistants listed, how the menu stays usable.
