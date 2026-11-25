import { randomUUID } from 'node:crypto';
import { memoryTalkStore } from '../../apps/server/src/modules/talks/adapters/memory';
import { memoryBoardingStore } from '../../apps/server/src/modules/boarding/adapters/memory';
import { memoryDialogueStore } from '../../apps/server/src/modules/dialogue/adapters/memory';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import {
  approvalWorkItemContract,
  boardingWorkItemContract,
  dialogueWorkItemContract,
  talkWorkItemContract,
  type CardTimer,
} from '../work-item-contract';

/**
 * The card port contract on each module's memory card sink (D25); `tests/db/postgres-work-items.test.ts` runs it on
 * composition's card ports over Postgres. The sinks keep a card's state and its timer as the thread store's row has it.
 */
const ids = () => {
  const prefix = 'm-' + randomUUID().slice(0, 8);
  let n = 0;
  return { person: () => `${prefix}-p${++n}`, card: () => `${prefix}-card-${++n}` };
};
const timer = (t: CardTimer | undefined) => t && { generation: t.generation, state: t.state, dueAt: t.dueAt };

talkWorkItemContract('memory', async () => {
  const store = memoryTalkStore();
  const id = ids();
  return {
    person: async () => id.person(),
    cardId: id.card,
    run: fn => store.transaction(tx => fn(tx.workItems)),
    card: async threadId => store.state.cards.get(threadId)?.state,
    timer: async threadId => timer(store.state.timers.get(threadId)),
  };
});

boardingWorkItemContract('memory', async () => {
  const store = memoryBoardingStore();
  const id = ids();
  return {
    person: async () => id.person(),
    cardId: id.card,
    run: fn => store.transaction(tx => fn(tx.workItems)),
    card: async threadId => store.state.cards.get(threadId)?.state,
    timer: async threadId => timer(store.state.timers.get(threadId)),
  };
});

dialogueWorkItemContract('memory', async () => {
  const store = memoryDialogueStore();
  const id = ids();
  return {
    person: async () => id.person(),
    cardId: id.card,
    run: fn => store.transaction(tx => fn(tx.workItems)),
    card: async threadId => store.state.cards.get(threadId)?.state,
    timer: async threadId => timer(store.state.timers.get(threadId)),
  };
});

approvalWorkItemContract('memory', async () => {
  const store = memoryCompetenceStore();
  const id = ids();
  return {
    person: async () => id.person(),
    approvalId: id.card,
    run: fn => store.transaction(tx => fn(tx.workItems)),
    async putAway(approvalId, managerId, state) {
      store.setOwn(`${approvalId}:${managerId}`, state);
    },
  };
});
