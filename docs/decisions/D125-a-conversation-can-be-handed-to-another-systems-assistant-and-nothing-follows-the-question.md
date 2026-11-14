# D125 · A conversation can be handed to another system's assistant, and nothing of it follows the question

**Status:** provisional (the product owner's statements of 2026-11-13 and 2026-11-14, in substance: an assistant in another system is indivisible, so Clew asks it and never reaches into its knowledge; only the person's own message and what they choose goes there, and Clew adds and rewrites nothing; the handover is the person's own choice, sticky and visible; what may leave the Clew chat is closed by default and opened by a mark from the source; a person may send data about themselves and never about another person. They approved the plan this record follows on 2026-11-14. Items 1 to 9 are built on the hello connector's example assistant and against recorded answers of Eneo's API; item 10 is not built, and of item 11 the source's own finding read is not; item 13's hold knows names and card titles only; Eneo serves the protocol itself (item 9) and a real Eneo assistant has answered through it, by the person's pick and by the model's choice, on one development machine. Nothing outside the repository has tested it: no real Eneo has been asked) · **Date:** 2026-11-14 · **Area:** assistant, integrations

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
5. **Sticky and visible.** Whom the box talks to is a button above the field that names the recipient ("Till: Clew",
   "Till: HR-assistenten"), so the person sees it before they write. It opens the list: Clew first, always; the
   assistants of the conversations the person had last; then every assistant they may ask, under the system it
   lives in, each with what it is for; with seven or more, a field that narrows the list by name or description. A
   switch with a segment per assistant was built first and replaced the same day: a person may have ten assistants
   or more. What is selected gets the next message and every one after it, until the person selects another, presses
   "Tillbaka till Clew" beside the button, or starts a new conversation. While an assistant is selected the box says
   which system what is written goes to, takes no `@` and shows no drawer, since nothing in it would follow, and the
   menu of Clew's own models is not drawn. Each question is marked "Skickat till …". A conversation is handed to at
   most one assistant and remembers it with the source's key for the conversation there (`thread.handover`,
   migration 0079), so a follow-up continues it and a conversation opened again is still talking to it. Another
   assistant is a new conversation.
6. **The answer is the assistant's, and looks it.** It is drawn on a surface of its own, with the assistant's
   mark beside it (its initials on a rounded tile) and above it the assistant's name with the mark of the system it
   lives in, in that system's own colour and with its word ([D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md)); it does
   not say "not Clew", which the surface and the mark already show; Clew's own answers stay on the page itself, and in a conversation where another assistant
   has answered they are named "Clew". The surface says "not Clew"; the name and the mark say which assistant, since
   colour cannot tell ten apart. The sources the source named and a link that continues the same conversation in the
   source's own interface are on the same surface. Where the person turned to an assistant, or back to Clew, the
   transcript says so once, on a line of its own. Clew offers nothing of its own under such an answer: no follow-up
   suggestions, no card from the answer, no proposal. An assistant of another system cannot act in Clew: the card
   and the human decision endpoint stay the only way to a write ([D45](D45-approved-intent-precedes-source-dispatch.md)).
   The design is the canvas "Clew · Who answered, and whom you ask".
7. **When the source does not answer.** A refusal, a failure, a stream that ends before `done` and an answer without
   a word are said in Clew's own words, under Clew's name, and marked `failed`; a half answer already shown is taken
   back. Clew never falls back to its own model for a handed-over question: that would be answering in the
   assistant's name. A connector's own error text never travels further ([D91](D91-one-logger-opentelemetry-export-and-the-model-turn-in-the-audit-trail.md)).
8. **Stored and audited as every turn.** The question, the answer, the conversation's state and one audit row
   (`conversation.handed`: which assistant, new or continued, how many sources, whether it failed; never a word of
   either text) commit together. The stored answer is the source's content: it stays readable only while the person
   still has that connector and its listing read (`MessageMeta.access`). A turn the person stops writes nothing in
   Clew, though the source may already hold the question. One answer is kept up to 60 000 characters and says when
   it was cut. When the person is back with Clew, its model hears the exchange as history, each question and answer
   marked in its first words as put to and written by the other assistant, so the model never takes them for its own
   answers or its own reads. Clew listens; nothing it read goes the other way.
9. **Eneo is the first implementer, stays a connector, and is to speak the protocol itself.** Nothing in `apps/` or
   `packages/` knows Eneo: the profile is general, and an installation without Eneo is unchanged
   ([D14](D14-clew-stands-alone-eneo-enhances.md)). What is built is an adapter, `connectors/eneo`: it lists the
   assistants an owner in Eneo made available to other clients and sends a question through Eneo's conversation API
   as the person, with Eneo's file-producing functions left out of the turn, since Clew's conversation cannot carry a
   generated file. The product owner decided on 2026-11-14 that Eneo, being the same team's product, serves the
   connector protocol from its own backend instead (not built): an administrator then registers Eneo's address and
   secret in Clew and nothing else is deployed, and no setting of the integration lives in an environment variable
   on Clew's side ([D23](D23-connectors-are-managed-in-the-database.md)). It is meant as the precedent for one of our
   own products exposing itself to Clew directly; a system we do not control keeps the adapter container. The adapter
   is retired once the native connector passes `scripts/connector-check.ts`, so the two never drift.
   `connectors/hello` carries a small example assistant.
10. **What may follow a question (not built).** Nothing can be attached yet: a handed-over turn with a chip is
    refused before anything leaves. The rule it will be built to: closed by default. A source marks a read
    `forward: true` to say its content may be sent to another system's assistant when the person attaches it, an
    administrator can only narrow that, and the core refuses, whatever a source says, anything about another person
    than the one asking, and anything Clew's own model may not read. Documents first; rows about the asker themself,
    minus fields the source holds back, later. The person ticks what goes, each time, and the question shows what
    went.

11. **The main chat suggests, and the person says yes.** The product owner said on 2026-11-14 that a person should
    not have to pick the assistant: the main chat handles it; and, having seen it hand a question over by itself the
    same day, that the person should be asked first. Built so: Clew's own model is told of the assistants the person
    may ask, at most twelve, each by name, system and description, and is given one tool of Clew's own,
    `clew.handOver`, which names one of them and does nothing else. When the model calls it the turn ends as an
    offer: nothing has left Clew, nothing is saved, whatever the model wrote is dropped, and under the person's
    question Clew says which assistant can answer and what would be sent, with two buttons. Yes sends the question
    again as it was written, to that assistant, as items 2 to 8 describe, marked as sent on Clew's suggestion in the
    transcript and the audit row; no sends it again to Clew, which answers and is not offered the handover for it.
    The model chooses the assistant and nothing else, so asking is still no model tool, and the handover is still
    the person's own act, as items 3 and 5 say. The model is told to suggest only for a general question an
    assistant's description covers and never for one about the person's own things in Clew, and the tool is not
    offered at all when something is attached to the question, when the question names a card or a person the asker
    manages, from a caller that cannot ask the person (a card's reply), or without a model that uses tools: then the
    list above the field is the way, as it is with no model at all
    ([D8](D08-every-action-works-without-the-model.md)). Not built: a finding read of the source's own
    (`assistants.find`), which takes the question and answers which assistants fit, for a person with more
    assistants than the model can be told of.
12. **The assistant hands the conversation back.** The product owner decided on 2026-11-14
    that the other assistant can itself return the conversation to Clew, in two cases. *Declined*: the question is
    not its to answer; Clew's box goes back to Clew, the transcript says so, and Clew answers the person's same
    message itself. *Completed*: it has answered and considers the matter done; its answer stands as its own, and
    the box goes back to Clew for what comes next. It is one more way for `POST /clew/ask` to end, beside `done` and
    `error`: a `handback` event with the reason, and for a completed answer the session and the link as `done` has
    them. It carries nothing Clew's model reads as an instruction: on a declined question Clew asks its own model
    with the person's words, never with the other system's. The person can always select the assistant again on the
    list, and the conversation there continues. What it does not do is stop a message before it leaves: that
    would take Clew's own model reading each message first, which is not decided. Built in Clew on 2026-11-14 (the
    event in the profile, the turn, the lines in the transcript, the box going back); and Eneo's connector sends it (uncommitted on Eneo's branch): a real declined handback was answered by Clew on one development machine, 2026-11-14.

13. **The person is shown whom they write to, and a question about their staff or cards is held.** A person
    wrote a question about their team to another system's assistant by mistake on 2026-11-14, with the box still set
    to it. Two things follow, both built that day. *Seen:* while the box talks to another system's assistant, the
    composer's own status line stands above the field and says so ("Du skriver till … i …, inte till Clew"), spoken
    as it appears, with that system's mark beside the recipient. *Held:* before the words leave Clew, a question that
    names someone the person manages, or one of their open cards, is held by what Clew can tell without a model. The
    turn ends with nothing sent and nothing saved, and under the question Clew says what it looks to be about, never
    which person or card, with two buttons: Clew answers it (first, and where the focus goes), or it is sent anyway,
    which the audit row records. A caller that cannot ask the person refuses such a question. It catches names and
    card titles only: "my team" names nobody and goes through, which is what Clew's own model reading each message
    first would catch, and that is still not decided.

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
- With many assistants listed, how the menu stays usable.
- Whether Clew's own model should read each message before it leaves, to keep one that is plainly about the
  person's own things in Clew (a colleague's data, their calendar) from going to another system. Until then the
  conversation stays with the assistant until the person, or the assistant (item 12), returns it.
- Whether a connector may declare settings that an administrator fills in on Clew's page and Clew sends to it. A
  connector's own service still learns where its source system is from its own deployment; item 9 removes that for
  Eneo only.
- What of Eneo's knowledge is searchable from Clew. Not through an assistant, and not everything a person may read:
  a second opt-in on a knowledge source is intended and not built.
