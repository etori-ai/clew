import { createContext, useContext } from 'react';

/** A chip as the page hands it to the composer (D12): the object's ref, kind and label, plus its card when it has one. */
export interface ChipRef { ref: string; kind: 'thread' | 'item' | 'event' | 'proposal' | 'capability'; label: string; threadId?: string; }
/** What cards and the page may do with the conversation row. The composer owns the state; the page passes it down here. */
export interface ConversationApi {
  /** Refs currently in the row as chips, so a card can show "I samtalet". */
  chipped: string[];
  /** Whether the conversation overlay is open (the stream is dimmed). */
  open: boolean;
  addChip(chip: ChipRef): void;
  openConversation(threadId: string): void;
}
const noop = () => undefined;
export const ConversationContext = createContext<ConversationApi>({ chipped: [], open: false, addChip: noop, openConversation: noop });
export const useConversation = () => useContext(ConversationContext);
