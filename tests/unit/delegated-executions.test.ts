import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { audiencedActorOf, type ExecuteResult } from '../../packages/connectors/src/index';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import type { ExecutionSessions, ExecutionSource, WriteSafety } from '../../apps/server/src/modules/executions/model';
import { delegatingHello, fromGrant, sessionDesk, signedIn } from '../session-desk';

/*
 * A write on a connector that acts as the person (D26) is carried out with the person's own token, from the signed-in
 * session that approved it, while that session is active; a later session of theirs may stand behind its read-back only.
 * `sessionDesk` stands in for `standingSession` in `auth.ts`.
 */

/** The ledger over the real registry, wired the way `composition/executions.ts` wires it. */
function ledger() {
  const desk = sessionDesk(),
    { registry, calls } = delegatingHello(),
    store = memoryExecutionStore();
  let now = Date.parse('2026-11-10T09:00:00.000Z'),
    id = 0;
  const source: ExecutionSource = {
    async authorize(persona, operation, input) {
      const found = await registry.validate(audiencedActorOf(persona), operation, input);
      return {
        connector: found.connector.id,
        safety: found.capability.execution ?? { strategy: 'manual' },
        needsSession: !!found.connector.delegation,
      };
    },
    current: async personId => fromGrant(personId),
    execute: (persona, e) =>
      registry.run<ExecuteResult>(audiencedActorOf(persona), e.operation, e.payload, {
        operationId: e.id,
        ...(persona.delegate ? { delegate: persona.delegate } : {}),
      }),
    lookup: async () => {
      throw new Error('No safe lookup');
    },
  };
  const sessions: ExecutionSessions = {
    find: desk.find,
    async ready(persona, e) {
      const audience = registry.connector(e.connector)?.delegation?.audience;
      return !!audience && !!persona.delegate && !!(await persona.delegate(audience));
    },
  };
  const uc = executionUsecases({
    store,
    source,
    sessions,
    clock: () => new Date(now),
    ids: () => 'e' + ++id,
    digest: input => JSON.stringify(input),
  });
  const writes = () => calls.filter(c => c.path === '/clew/capabilities/hello.markDone');
  const approve = (persona: AuthenticatedContext, decisionId = 'card:hello') =>
    uc.approve(persona, { decisionId, operation: 'hello.markDone', payload: { refs: ['hello:item:1'] } });
  return { desk, store, uc, sessions, writes, approve, advance: (ms: number) => (now += ms) };
}

describe('a write on a connector that acts as the person (D26)', () => {
  test("is dispatched with the approving session's own token while that session is active, and the audit says which session stood behind it", async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    expect(approved).toMatchObject({ state: 'pending', reason: null });
    expect(approved).not.toHaveProperty('approvingSession');
    expect(w.store.dump()[0]).toMatchObject({ approvingSession: 'session-1', checkingSession: null });
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(w.writes()).toEqual([
      { path: '/clew/capabilities/hello.markDone', token: 'token-of-session-1', operationId: approved.id },
    ]);
    expect(await w.uc.read(signedIn(w.desk, 'session-1'), approved.id)).toMatchObject({
      state: 'succeeded',
      reason: null,
      result: { rows: [{ ref: 'hello:item:1', outcome: 'done' }] },
    });
    expect(w.desk.tokens.every(t => t.binding === 'session-1' && t.audience === 'nextcloud')).toBe(true);
    expect(w.store.audit()).toEqual([
      {
        actor: 'person:hillevi',
        action: 'execution.approved',
        subject: 'execution:' + approved.id,
        at: '2026-11-10T09:00:00.000Z',
        details: {
          connector: 'hello',
          operation: 'hello.markDone',
          digest: expect.any(String),
          compensates: null,
          session: 'approving',
        },
      },
      expect.objectContaining({ actor: 'system:execution', action: 'execution.claimed' }),
      {
        actor: 'system:execution',
        action: 'execution.dispatched',
        subject: 'execution:' + approved.id,
        at: '2026-11-10T09:00:00.000Z',
        details: { attempt: 1, session: 'approving' },
      },
      {
        actor: 'system:execution',
        action: 'execution.succeeded',
        subject: 'execution:' + approved.id,
        at: '2026-11-10T09:00:00.000Z',
        details: { attempt: 1, reason: null, outcomes: ['done'], session: 'approving' },
      },
    ]);
    // No audit row carries the binding or a token.
    expect(JSON.stringify(w.store.audit())).not.toContain('session-1');
  });

  test('stays pending with needs-session and reaches nothing when the approving session has ended; a later session does not dispatch it, and the approval expires after a day', async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    w.desk.end('session-1');
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(await w.store.read(approved.id)).toMatchObject({
      state: 'pending',
      reason: 'needs-session',
      dispatchedAt: null,
    });
    expect(w.writes()).toEqual([]);
    expect(w.desk.tokens).toEqual([]);
    expect(w.store.audit().at(-1)).toMatchObject({
      action: 'execution.pending',
      details: { reason: 'needs-session' },
    });
    // Signing in again and asking to check it keeps no session for a write that was never sent, and sends nothing.
    w.desk.signIn('session-2', 'hillevi');
    await w.uc.reconcile(signedIn(w.desk, 'session-2'), approved.id);
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(await w.store.read(approved.id)).toMatchObject({
      state: 'pending',
      reason: 'needs-session',
      approvingSession: 'session-1',
      checkingSession: null,
    });
    expect(w.writes()).toEqual([]);
    // Asked again after the approval's 24 hours (D45), it fails as expired instead of waiting for a session for ever.
    w.advance(24 * 3600_000);
    await w.uc.reconcile(signedIn(w.desk, 'session-2'), approved.id);
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'failed', reason: 'approval-expired' });
    expect(w.writes()).toEqual([]);
  });

  test('does not depend on recent activity in the approving session: the approval is the person’s own act', async () => {
    const w = ledger();
    // Signed in, approved, and no activity reported since: a scan would not stand on this session (PRESENCE_MS).
    w.desk.signIn('session-1', 'hillevi', 'token-of-session-1', '2026-11-10T01:00:00.000Z');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    w.advance(6 * 3600_000);
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'succeeded' });
    expect(w.writes()).toHaveLength(1);
  });

  test("never uses another person's session, even one that is active", async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    w.desk.signIn('session-of-mikael', 'mikael');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    // A binding that names someone else's session, however it got there, stands behind nothing.
    await w.store.transaction(async tx => {
      const row = (await tx.lock(approved.id))!;
      await tx.update({ ...row, approvingSession: 'session-of-mikael' });
    });
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'pending', reason: 'needs-session' });
    expect(w.writes()).toEqual([]);
    expect(w.desk.tokens).toEqual([]);
  });

  test('a session revoked between approval and dispatch stops the write before it is sent', async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    const first = await w.approve(signedIn(w.desk, 'session-1'), 'card:first');
    await w.uc.progress(first.id);
    expect(w.writes()).toHaveLength(1);
    const second = await w.approve(signedIn(w.desk, 'session-1'), 'card:second');
    w.desk.end('session-1');
    await w.uc.progress(second.id);
    expect(await w.store.read(second.id)).toMatchObject({
      state: 'pending',
      reason: 'needs-session',
      dispatchedAt: null,
    });
    expect(w.writes()).toHaveLength(1);
  });

  test('a session revoked after its token was obtained stops the call inside Clew; the write is uncertain and never repeated', async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    const ready = w.sessions.ready;
    w.sessions.ready = async (persona, e) => {
      const result = await ready(persona, e);
      w.desk.end('session-1');
      return result;
    };
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    // Dispatch was recorded first (D45), then the delegate refused before any request left Clew.
    expect(await w.uc.progress(approved.id)).toBe('reconcile');
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'unknown', reason: 'source-outcome-unknown' });
    expect(await w.uc.progress(approved.id)).toBe('done');
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'unknown', reason: 'needs-session' });
    expect(w.writes()).toEqual([]);
  });

  test('an identity provider that cannot exchange a token now leaves the write undispatched, not uncertain', async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi');
    w.sessions.ready = async () => {
      throw new Error('token endpoint unavailable');
    };
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({
      state: 'pending',
      reason: 'source-unavailable',
      dispatchedAt: null,
    });
    expect(w.writes()).toEqual([]);
  });

  test('a session without IdP tokens stands behind nothing', async () => {
    const w = ledger();
    w.desk.signIn('session-1', 'hillevi', null);
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'pending', reason: 'needs-session' });
    expect(w.writes()).toEqual([]);
  });

  test('without a port to find a session again, a delegated write waits for a session as before', async () => {
    const w = ledger();
    const plain = executionUsecases({
      store: w.store,
      source: {
        authorize: async () => ({ connector: 'hello', safety: { strategy: 'manual' }, needsSession: true }),
        current: async id => fromGrant(id),
        execute: async () => {
          throw new Error('never');
        },
        lookup: async () => undefined,
      },
      clock: () => new Date('2026-11-10T09:00:00.000Z'),
      ids: () => 'plain',
      digest: JSON.stringify,
    });
    w.desk.signIn('session-1', 'hillevi');
    const approved = await plain.approve(signedIn(w.desk, 'session-1'), {
      decisionId: 'plain',
      operation: 'hello.markDone',
      payload: { refs: ['hello:item:1'] },
    });
    expect(approved).toMatchObject({ state: 'pending', reason: 'needs-session' });
    expect((await w.store.read(approved.id))?.approvingSession).toBeNull();
    await plain.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'pending', reason: 'needs-session' });
  });
});

describe('the read-back of a delegated write after the approving session ended (D26, D45)', () => {
  /** A source with an operation key and a lookup, whose every call records the token it came with. */
  function world(safety: WriteSafety = { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'test.lookup' }) {
    const desk = sessionDesk(),
      store = memoryExecutionStore(),
      committed = new Map<string, ExecuteResult>(),
      seen: Array<{ call: 'execute' | 'lookup'; token: string | undefined }> = [];
    let loseReply = false,
      down = false,
      id = 0;
    const result: ExecuteResult = {
      headline: 'Godkänd',
      rows: [{ ref: 'file:1', label: 'Avtal.pdf', outcome: 'done', detail: 'Godkänd' }],
    };
    const source: ExecutionSource = {
      authorize: async () => ({ connector: 'files', safety, needsSession: true }),
      current: async personId => fromGrant(personId),
      async execute(persona, e) {
        const token = await persona.delegate?.('files');
        seen.push({ call: 'execute', token });
        if (down) throw new Error('unavailable');
        committed.set(e.id, result);
        if (loseReply) throw new Error('reply lost');
        return result;
      },
      async lookup(persona, e) {
        seen.push({ call: 'lookup', token: await persona.delegate?.('files') });
        return committed.get(e.id);
      },
    };
    const uc = executionUsecases({
      store,
      source,
      sessions: { find: desk.find, ready: async persona => !!(await persona.delegate?.('files')) },
      clock: () => new Date('2026-11-10T09:00:00.000Z'),
      ids: () => 'x' + ++id,
      digest: JSON.stringify,
    });
    return {
      desk,
      store,
      uc,
      seen,
      committed,
      loseReply: () => (loseReply = true),
      down: (value: boolean) => (down = value),
      approve: (persona: AuthenticatedContext, decisionId = 'card:file') =>
        uc.approve(persona, { decisionId, operation: 'files.approve', payload: { ref: 'file:1' } }),
    };
  }
  test('a later session of the same person, in which they asked to check it, stands behind the lookup', async () => {
    const w = world();
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    w.loseReply();
    expect(await w.uc.progress(approved.id)).toBe('reconcile');
    w.desk.end('session-1');
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'unknown', reason: 'needs-session' });
    w.desk.signIn('session-2', 'hillevi');
    await w.uc.reconcile(signedIn(w.desk, 'session-2'), approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ checkingSession: 'session-2' });
    expect(w.store.audit().at(-1)).toMatchObject({
      actor: 'person:hillevi',
      action: 'execution.reconciliation_requested',
      details: { session: 'checking' },
    });
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'succeeded', reason: null });
    expect(w.seen).toEqual([
      { call: 'execute', token: 'token-of-session-1' },
      { call: 'lookup', token: 'token-of-session-2' },
    ]);
    expect(w.store.audit().at(-1)).toMatchObject({
      action: 'execution.succeeded',
      details: { session: 'checking', outcomes: ['done'] },
    });
    expect(JSON.stringify(w.store.audit())).not.toContain('session-2');
  });
  test('never stands behind a replay: absence read back under a later session leaves the write uncertain and unsent', async () => {
    const w = world();
    w.desk.signIn('session-1', 'hillevi');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    w.down(true);
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'unknown', reason: 'source-outcome-unknown' });
    w.down(false);
    w.desk.end('session-1');
    w.desk.signIn('session-2', 'hillevi');
    await w.uc.reconcile(signedIn(w.desk, 'session-2'), approved.id);
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'unknown', reason: 'needs-session' });
    expect(w.seen.map(s => [s.call, s.token])).toEqual([
      ['execute', 'token-of-session-1'],
      ['lookup', 'token-of-session-2'],
    ]);
    expect(w.committed.size).toBe(0);
    // The approving session, were it still active, may replay inside the source's deduplication window.
    const again = world();
    again.desk.signIn('session-1', 'hillevi');
    const kept = await again.approve(signedIn(again.desk, 'session-1'));
    again.down(true);
    await again.uc.progress(kept.id);
    again.down(false);
    await again.uc.progress(kept.id);
    expect(await again.store.read(kept.id)).toMatchObject({ state: 'succeeded' });
    expect(again.seen.map(s => s.token)).toEqual(['token-of-session-1', 'token-of-session-1', 'token-of-session-1']);
  });
  test("another person's session is never kept or used for a read-back", async () => {
    const w = world();
    w.desk.signIn('session-1', 'hillevi');
    w.desk.signIn('session-of-mikael', 'mikael');
    const approved = await w.approve(signedIn(w.desk, 'session-1'));
    w.loseReply();
    await w.uc.progress(approved.id);
    w.desk.end('session-1');
    // Mikael cannot reach Hillevi's execution at all; a binding that names his session is refused at use.
    await expect(w.uc.reconcile(signedIn(w.desk, 'session-of-mikael', 'mikael'), approved.id)).rejects.toThrow(
      'finns inte',
    );
    await w.store.transaction(tx => tx.keepCheckingSession(approved.id, 'session-of-mikael'));
    await w.uc.progress(approved.id);
    expect(await w.store.read(approved.id)).toMatchObject({ state: 'unknown', reason: 'needs-session' });
    expect(w.seen.map(s => s.call)).toEqual(['execute']);
  });
});
