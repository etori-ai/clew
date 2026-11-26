import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { CapabilityError, audiencedActorOf, type ExecuteResult } from '../../packages/connectors/src/index';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import type { ExecutionSource } from '../../apps/server/src/modules/executions/model';
import { linkingHello } from '../linking-hello';
import { fromGrant, sessionDesk, signedIn } from '../session-desk';

/*
 * A write on a connector whose person links an account (D147 items 8 and 9) needs no session: it is carried out with
 * the link's token whether or not the person is signed in, and it waits with `needs-link`, unsent, when the link is
 * gone. The ledger over the real registry, wired the way `composition/executions.ts` wires it; `linkingHello` stands in
 * for the linked-accounts module behind the transport.
 */
function ledger() {
  const desk = sessionDesk(),
    hello = linkingHello(),
    store = memoryExecutionStore();
  let now = Date.parse('2026-11-25T09:00:00.000Z'),
    id = 0;
  const source: ExecutionSource = {
    async authorize(persona, operation, input) {
      const found = await hello.registry.validate(audiencedActorOf(persona), operation, input);
      return {
        connector: found.connector.id,
        safety: found.capability.execution ?? { strategy: 'manual' },
        needsSession: !!found.connector.delegation,
        needsLink: !!found.connector.linkedAccount,
      };
    },
    // As composition does: the link's token is asked for, and only "no link" is an answer.
    async linked(persona) {
      if (hello.unavailable()) throw new CapabilityError('Systemet svarar inte just nu.', 'unavailable');
      return hello.linked.has(persona.id);
    },
    current: async personId => fromGrant(personId),
    execute: (persona, e) =>
      hello.registry.run<ExecuteResult>(audiencedActorOf(persona), e.operation, e.payload, {
        operationId: e.id,
        authorize: () => persona.authorize(),
      }),
    lookup: async () => {
      throw new Error('No safe lookup');
    },
  };
  const uc = executionUsecases({
    store,
    source,
    // No session stands behind anything here: one that were asked for would refuse.
    sessions: { find: async () => undefined, ready: async () => false },
    clock: () => new Date(now),
    ids: () => 'e' + ++id,
    digest: input => JSON.stringify(input),
  });
  const writes = () => hello.calls.filter(c => c.path === '/clew/capabilities/hello.markDone');
  const approve = (persona: AuthenticatedContext, decisionId = 'card:hello') =>
    uc.approve(persona, { decisionId, operation: 'hello.markDone', payload: { refs: ['hello:item:1'] } });
  return { desk, hello, store, uc, writes, approve, advance: (ms: number) => (now += ms) };
}

describe('an approved write on a connector whose person links an account', () => {
  test('is sent with the link’s token after the person has signed out, and the audit row says which credential', async () => {
    const w = ledger();
    w.hello.linked.set('hillevi', 'token-1');
    w.hello.accepted.add('token-1');
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    // No session is needed, so nothing waits for one.
    expect(approved).toMatchObject({ state: 'pending', reason: null });
    w.desk.end('session-1');
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(w.writes()).toEqual([{ path: '/clew/capabilities/hello.markDone', token: 'token-1' }]);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'succeeded', reason: null });
    expect(w.store.audit().find(a => a.action === 'execution.dispatched')).toMatchObject({
      details: { attempt: 1, credential: 'linked' },
    });
    expect(JSON.stringify(w.store.audit())).not.toContain('token-1');
  });

  test('waits unsent with needs-link when the link is gone, and is not sent by itself when the person links again', async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(w.writes()).toEqual([]);
    expect(await w.store.read(approved.id)).toMatchObject({
      state: 'pending',
      reason: 'needs-link',
      dispatchedAt: null,
    });
    // Linking again changes nothing by itself; the next check of the write finds the link and sends it.
    w.hello.linked.set('hillevi', 'token-2');
    w.hello.accepted.add('token-2');
    expect(w.writes()).toEqual([]);
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(w.writes()).toEqual([{ path: '/clew/capabilities/hello.markDone', token: 'token-2' }]);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'succeeded', reason: null });
  });

  test('stays unsent when the system’s authorization server cannot be asked, and expires like any approval', async () => {
    const w = ledger();
    w.hello.linked.set('hillevi', 'token-1');
    w.hello.down(true);
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(w.writes()).toEqual([]);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'pending', reason: 'source-unavailable' });
    w.advance(24 * 60 * 60 * 1000 + 1);
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'failed', reason: 'approval-expired' });
    expect(w.writes()).toEqual([]);
  });
});
