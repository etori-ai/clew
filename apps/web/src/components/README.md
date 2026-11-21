# The web app's components

Components that read the session, the address or a query, grouped by what they belong to. A component that knows
nothing of Clew's data or its router is not here: it lives in `packages/ui/src/components` and is imported from
`@clew/ui` (its `README.md` lists them and what each is made of). Pages are in `../pages`; a page composes these and
sets no gap, inset or size of its own (`docs/reference/layout-measures.md`).

| Folder | What it holds | Files |
|---|---|---|
| `shell/` | The frame every page stands in: the shared header with Clew's pages (`shell.tsx`, `nav.tsx`), the page's column, title and card, with the assistant's pane at the column's end (`page-frame.tsx`, `page-header.tsx`), what the frame tells the parts inside it (`page-frame-context.ts`), the floating "Fråga AI" and what a page tells it (`assistant-corner.tsx`), the reminders' bell, a system that does not answer, the placeholders while a page loads, the first paint before the session is known, the administration's frame and a dialog's body | 12 |
| `hem/` | Hem's blocks: the unit's key figures (`lage.tsx`), the day (`today.tsx`), the news and the focus news | 4 |
| `work/` | A work item wherever it is drawn: what it can do (`card.tsx`), the item itself (`work-item.tsx`), its row, its sections, the action dialog, the receipt notice, the review's recovery and the person's own action points | 11 |
| `conversation/` | The conversation: its state for the whole app (`conversation-context.tsx`), its turns (`turns.ts`), the transcript and the drafts in it, the box, the conversation beside a page and what a page is about (`page-conversation.tsx`), the pane for another system's assistant, and a new conversation about a thing (`thing-panel.tsx`) | 10 |
| `people/` | A person's, a unit's and a plan's page and what stands on them: the sections, the follow-up dialogue, a talk, registering a holding, starting an introduction | 8 |
| `views/` | A connector's declared view and what reads it: the view itself (`view.tsx`), a read for an address, the search's panel and its labels, the document reader | 5 |
| `calendar/` | The calendar page's forms and dialogs: an entry opened, a new booking (in the pane and, on a phone, its dialog) and a move | 4 |

## Where a new component goes

1. If it reads no query, no address and no session, it is a Clew component: `packages/ui/src/components`.
2. Else in the folder of what it belongs to. A component two folders use stays in the folder of the thing it draws
   (a work item's row is `work/`, wherever it is listed).
3. A folder imports another folder's component by its path. Nothing here is re-exported through an index.
