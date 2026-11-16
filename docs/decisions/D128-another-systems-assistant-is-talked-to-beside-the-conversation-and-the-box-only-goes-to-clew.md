# D128 · Another system's assistant is talked to beside the conversation, and the box only ever goes to Clew

**Status:** provisional (the product owner chose it on 2026-11-16 from the canvas "Clew · Vart går nästa meddelande?", after the sticky recipient of D125 item 5 sent a question about their team to another system a second time; built against the development stack's one test assistant in a local Eneo, where a question at the side, a follow-up, a declined question and the press to Clew were seen to work. Two assistants in one conversation are covered by a unit scenario only. Nothing outside the repository has tested it, and no manual screen-reader pass is made) · **Date:** 2026-11-16 · **Area:** ui, product

**Context.** [D125](D125-a-conversation-can-be-handed-to-another-systems-assistant-and-nothing-follows-the-question.md)
made whom the box talks to a sticky choice, named on a button above the field (item 5). A person wrote a question
about their team to another system's assistant by mistake on 2026-11-14, which item 13 answered with a warning line and
a hold on names; on 2026-11-16 the same thing happened again, with the warning in place. A recipient that sticks is a
mode, and a mode is read from one small control and noticed after sending. Six ways of drawing it were tried on the
canvas: the mode with clearer words, the stretch with the assistant as a ruled section, one message addressed at a
time, that with Clew's turns folded away, the exchange as a block with a field of its own, and the assistant in a panel
beside the conversation. The owner chose the last, which removes the mode: the question of where a message goes is
answered by which box it is typed in.

**Decision.**

1. **The transcript and the box under it are Clew's, always.** In a conversation and on Ny fråga the box has no
   recipient menu, no warning line and no recipient that sticks, and it takes no `@` or `/` for an assistant. This
   replaces D125 item 5 and the *Seen* half of item 13.
2. **An assistant of another system has a panel beside the conversation, with a box of its own.** The panel is the
   pane beside a conversation of [D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md) rule 2 and is
   named in the address (`?assistant=<id>`), so Back, a reload and Esc work as for any pane. It draws that assistant's
   whole exchange in this conversation and nothing else. One panel holds one thing: while it is open it stands in the
   place of the thing the conversation is about. What is typed in its box goes to that system, unchanged and alone
   (D125 item 4), and the box says so. This is the one box outside D126 item 4's two homes: it is not Clew's box, and it
   exists only on the conversation's page.
3. **Three ways lead to the panel**, and opening it sends nothing: "Fortsätt med …" under an assistant's answer in the
   transcript; "Assistenter" in the conversation's header, which lists the assistants this conversation already has an
   exchange with and then every other the person may ask; and a row under "Fråga någon annan" on Ny fråga, which opens
   a new conversation with the panel (`/conversations/new?assistant=<id>`).
4. **Clew still suggests, and the person says yes** (D125 item 11, unchanged). The answer to a question Clew sent on
   stands in the transcript as that assistant's own (D125 item 6) with the way on under it, and nothing opens by
   itself.
5. **What is asked at the side is drawn at the side.** A question asked in the panel and its answer are stored in the
   conversation, marked `side`, and are not drawn in the transcript. The transcript shows that they exist: the
   assistant's answer card counts them, and an assistant with no card gets one line where it was first asked ("Du
   frågade … i sidofältet").
6. **A conversation keeps one exchange with each assistant asked in it.** A question to an assistant asked before,
   from the panel or on Clew's suggestion, continues the conversation its source keeps; another assistant starts its
   own. This replaces "a conversation is handed to at most one assistant" in D125 item 5. The thread remembers the
   assistant asked last and, under `others`, the ones before it (`handoversOf`, `withHandover` in
   `packages/contracts/src/handover.ts`); no migration.
7. **An assistant does not hand a question back; the person puts it to Clew** (amended 2026-11-16, product owner,
   after a test run in which the assistant handed back a question Clew had suggested it for, declined a follow-up it
   should have taken, and wrote a refusal as text without handing back). Clew does not act on `handback`: the text an
   assistant wrote stands as its answer, on a question Clew sent on and on one asked in the panel alike, and Clew
   never answers in its place unasked. An assistant that cannot answer says so in its own words. Nothing goes from
   the panel to Clew: a button that put a side question to Clew ("Fråga Clew samma sak") was built and removed the
   same day, since a question for Clew is typed in Clew's box, which is always beside the panel. A source may still end an answer with `handback`: it is read as `done`, and with no text the turn is said
   in Clew's words as not answered. Eneo no longer offers its assistants the hand-back tool. This replaces D125 item
   12.
8. **Clew hears every exchange of the conversation; nothing goes the other way** (D125 items 4 and 8). The side
   exchange is part of the history Clew's model is given, each part marked as the other assistant's.
9. **Nothing in the transcript moves by itself.** An answer landing, a hand-back or a turn ending appends rows or
   changes a box; folding, opening and closing are the person's own press.
10. **The whole assistant is in its own system.** The panel links there ("Öppna i …") when the source gives the
    address. Clew has no page or window of its own for another system's assistant.

**Why.** Each drawing that kept two counterparts in one transcript needed something to say which one the next message
goes to, and each such thing was either missed (the button, the warning) or moved the transcript (the fold). Two boxes
need nothing of the kind. Sharing the transcript was how Clew got to read the assistant's answers, which is what it
needs to act on them ("påminn mig om det"); storing the side exchange with the conversation keeps that without the
shared scroll. A full chat with the assistant inside Clew would repeat the other system's own interface, where its
files and other functions work.

**Replaces.** D125 item 5 (sticky recipient, one assistant per conversation), item 12 (the assistant handing a
question back and Clew answering it), and the warning line of item 13; the hold of item 13 stands and is drawn in the panel. It
adds a box to the conversation's page beside D126 item 4's.

**Not built.**

- Two assistants in one conversation are not checked in a browser (the development stack lists one).
- Clew's reading of a side exchange is not shown as a step in its answer; it is part of the history it is given.
- At a width where no pane fits, the panel takes the column until it is closed; this has no design of its own.
- A second question to Clew while the panel's turn runs, and the reverse, wait for the first.
