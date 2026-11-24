import { randomUUID } from 'node:crypto';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { memoryProjection } from '../../apps/server/src/threads/adapters/projection-memory';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { projectionAt, projectionContract } from '../projection-contract';

/** The projection contract on its memory port, behind the memory ledger (D25); `tests/db/postgres-projection.test.ts` runs it on Postgres. */
projectionContract('memory', async () => {
  const prefix = 'm-' + randomUUID().slice(0, 8);
  const threads = memoryThreadStore();
  let ledger: ReturnType<typeof memoryExecutionStore>;
  const projection = memoryProjection(threads, { execution: id => ledger.read(id) });
  ledger = memoryExecutionStore({ projection });
  return {
    personId: prefix + '-manager',
    otherId: prefix + '-other-manager',
    prefix,
    store: ledger,
    async seedCard(card) {
      await threads.transaction(tx =>
        tx.insertThread({
          id: card.id,
          personId: card.personId,
          kind: 'pushed',
          topic: card.id,
          title: 'Synthetic card',
          state: card.state ?? 'open',
          week: null,
          connector: card.connector,
          area: card.connector,
          summary: '',
          items: [],
          actions: [],
          waitingOn: null,
          deadline: null,
          trigger: { reason: 'Test', source: 'Test', at: projectionAt },
          createdAt: projectionAt,
          updatedAt: projectionAt,
        }),
      );
    },
    async seedProposal(proposal, executionId = null) {
      projection.seedProposal(proposal, executionId);
    },
    card: id => threads.readThreadById(id),
    proposal: async id => projection.proposal(id),
    policy: async threadId => projection.policy(threadId),
    timer: id => threads.readTimer(id),
    jobs: async prefix =>
      projection
        .jobs()
        .filter(j => j.id.startsWith(prefix))
        .sort((a, b) => a.id.localeCompare(b.id)),
    audit: async subject =>
      threads.audit
        .filter(a => a.subject === subject)
        .map(a => ({ actor: a.actor, action: a.action, details: a.details })),
    told: async () => projection.told(),
  };
});
