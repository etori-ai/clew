import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext, Thread } from '../../packages/contracts/src/index';
import { audiencedActorOf, receipt, type ExecuteResult } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import { PRESENCE_MS } from '../../apps/server/src/threads/refresh-model';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import type {
  Execution,
  ExecutionSessions,
  ExecutionSource,
  ExecutionStore,
} from '../../apps/server/src/modules/executions/model';
import { createConnector } from '../../connectors/nextcloud-approval/connector.mjs';
import { createFixtureApproval, type ApprovalSource } from '../../connectors/nextcloud-approval/approvals.mjs';
import { Registry } from '../registry';
import { assertionFor, testJwks } from '../connector-authority';
import { sessionDesk } from '../session-desk';

/*
 * The Approval loop of D101 across the seam between the Nextcloud Approval connector and the work the person's own
 * session stands behind (D103): a person with a live session asks for a refresh, the scan runs with that session's token
 * and yields a card per waiting file, the person decides on a card through the human decision use case, the ledger
 * dispatches the write with the approving session's token, and the receipt on the card is what Nextcloud read back. The
 * connector runs in-process over the protocol on its in-memory stand-in; the use cases run on the memory adapters, wired
 * as `composition/refresh.ts`, `composition/executions.ts` and `composition/index.ts` wire them. `sessionDesk` stands in
 * for `standingSession` in `auth.ts`.
 *
 * One piece is not production code: the memory ledger projects nothing onto the card, because that projection lives only
 * in `composition/execution-projection.ts` over a Postgres transaction. `projectOntoCard` below is its non-calendar path,
 * called where the Postgres ledger calls it (on insert and on update, inside the ledger's transaction).
 */
const ID = 'nextcloud-approval';
const secret = 'test-secret-test-secret';
const T0 = Date.parse('2026-11-10T13:00:00.000Z');
const TOKEN_UNTIL = '2099-01-01T00:00:00.000Z';
const names: Record<string, string> = { hillevi: 'Hillevi Berg', hassan: 'Hassan Ali' };
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The person as Clew knows them, with the user name Nextcloud knows them by. */
const persona = (user: string, binding: string): AuthenticatedContext => ({
  id: user,
  name: names[user]!,
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: user === 'hillevi' ? 'manager' : 'employee',
  userName: user,
  organisationId: 'test',
  principal: { id: 'person:' + user, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: binding,
  expiresAt: TOKEN_UNTIL,
  authorize: async () => ({ version: 'v1' }),
});
/** The token the identity provider exchanges for Nextcloud in one session. The stand-in reads it unverified. */
const tokenFor = (user: string, session: string) =>
  'h.' +
  Buffer.from(
    // Valid for as long as the session it stands in for (`expiresAt` above): one scenario runs on the wall clock, and a
    // lifetime counted from T0 ran out a day after the test was written.
    JSON.stringify({ preferred_username: user, aud: 'nextcloud', exp: Date.parse(TOKEN_UNTIL) / 1000, sid: session }),
  ).toString('base64url') +
  '.s';

/**
 * `wall`: run on the wall clock, with the connector stamping its observations from it. A scan the registry answers
 * itself (`authorization-required`, `Registry.scanOne`) is stamped with `new Date()`, and the refresh refuses an
 * observation older than the last one it stored before it looks at completeness, so a scenario that reaches that
 * answer after the connector has answered once cannot run on a fixed clock.
 */
function world(wrap: (source: ApprovalSource) => ApprovalSource = source => source, { wall = false } = {}) {
  let now = wall ? Date.now() : T0;
  const clock = () => new Date(now);
  const at = () => clock().toISOString();
  const desk = sessionDesk();
  const nextcloud = createFixtureApproval({ now: () => now });
  const service = createConnector({
    jwks: testJwks,
    secret,
    source: wrap(nextcloud),
    now: wall ? () => Date.now() : () => now,
  });
  const calls: Array<{ path: string; token: string | null; operationId: string | null }> = [];
  const fetch: FetchLike = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path: new URL(String(input)).pathname,
      token: headers.get('x-clew-delegated-token'),
      operationId: headers.get('x-clew-operation-id'),
    });
    return service.handle(new Request(input, init));
  };
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(service.manifest, ID), {
      url: 'http://nextcloud-approval',
      key: secret,
      assert: assertionFor(ID, secret),
      fetch,
    }),
  );
  const threads = memoryThreadStore();
  const refreshStore = memoryRefreshStore(threads);
  let cardIds = 0,
    executionIds = 0;
  /** Background work sees the person through their current grant, without a session (`systemContext`). */
  const fromGrant = async (user: string) => persona(user, 'system:background');
  const refresh = refreshUsecases({
    store: refreshStore,
    clock,
    ids: () => 'card-' + ++cardIds,
    key: sha,
    current: fromGrant,
    sources: async () => [ID],
    system: () => 'Nextcloud',
    scan: (p, id) => registry.scanOne(p, id, p.delegate ? { delegate: p.delegate } : {}),
    session: desk.find,
  });

  /** `composition/execution-projection.ts` for a card that is not the calendar's, on the memory thread store. */
  async function projectOntoCard(e: Execution, stage: 'approval' | 'update') {
    if (!e.presentation) return;
    const presentation = e.presentation;
    await threads.transaction(async tx => {
      const thread = await tx.lockThread(e.personId, presentation.threadId);
      if (!thread) throw new Error('Kortet finns inte.');
      const previous = thread.execution;
      if (stage === 'approval') {
        if (thread.updatedAt !== presentation.version || thread.connector !== e.connector)
          throw new Error('Kortet har ändrats. Läs tillbaka det innan du bekräftar.');
        if (previous && ['pending', 'running', 'unknown'].includes(previous.state))
          throw new Error('Ett tidigare beslut väntar redan på besked.');
        if (e.compensates ? previous?.id !== e.compensates : thread.state !== 'open')
          throw new Error('Kortet är redan hanterat.');
      } else if (previous?.id !== e.id) return;
      const confirmed = e.state === 'succeeded';
      const projected = e.result ? receipt(e.result, new Date(e.dispatchedAt ?? e.createdAt)) : null;
      // The port's patch type leaves out the execution fields the Postgres projection writes in SQL; the memory store
      // applies any patch.
      const patch: Partial<Thread> = {
        execution: {
          id: e.id,
          decisionId: e.decisionId,
          operation: e.operation,
          state: e.state,
          reason: e.reason,
          compensates: e.compensates,
        },
        updatedAt: e.updatedAt,
        ...(stage === 'approval' ? { waitingOn: 'Väntar på källans besked' } : {}),
        ...(!e.compensates && projected && e.state !== 'running' ? { receipt: projected } : {}),
        ...(!e.compensates && confirmed ? { state: 'handled' as const, handledAt: e.updatedAt, waitingOn: null } : {}),
        ...(['unknown', 'partial', 'failed'].includes(e.state) || e.reason ? { waitingOn: null } : {}),
      };
      await tx.updateThread(thread.id, patch as Parameters<typeof tx.updateThread>[1]);
    });
  }
  const memoryLedger = memoryExecutionStore();
  const ledger: ExecutionStore = {
    readDecision: memoryLedger.readDecision,
    read: memoryLedger.read,
    readJob: memoryLedger.readJob,
    transaction: fn =>
      memoryLedger.transaction(tx =>
        fn({
          ...tx,
          async insert(e) {
            const saved = await tx.insert(e);
            if (saved.inserted) await projectOntoCard(saved.execution, 'approval');
            return saved;
          },
          async update(e) {
            await tx.update(e);
            await projectOntoCard(e, 'update');
          },
        }),
      ),
  };
  // As `composition/executions.ts`: the registry validates, executes with the operation id and the delegate it is given.
  const source: ExecutionSource = {
    async authorize(p, operation, input) {
      const found = await registry.validate(audiencedActorOf(p), operation, input);
      return {
        connector: found.connector.id,
        safety: found.capability.execution ?? { strategy: 'manual' },
        needsSession: !!found.connector.delegation,
      };
    },
    current: fromGrant,
    execute: (p, e) =>
      registry.run<ExecuteResult>(audiencedActorOf(p), e.operation, e.payload, {
        operationId: e.id,
        ...(p.delegate ? { delegate: p.delegate } : {}),
      }),
    lookup: async () => {
      throw new Error('No safe lookup');
    },
  };
  const sessions: ExecutionSessions = {
    find: desk.find,
    async ready(p, e) {
      const audience = registry.connector(e.connector)?.delegation?.audience;
      return !!audience && !!p.delegate && !!(await p.delegate(audience));
    },
  };
  const executions = executionUsecases({
    store: ledger,
    source,
    sessions,
    clock,
    ids: () => 'exec-' + ++executionIds,
    digest: sha,
  });
  const run = (p: AuthenticatedContext, name: string, input: unknown) =>
    registry.run(audiencedActorOf(p), name, input, p.delegate ? { delegate: p.delegate } : {});
  const decisions = cardDecisions({
    read: (p, id) => threads.readThread(p.id, id),
    registry,
    run,
    approve: executions.approve,
    clock,
  });
  const cards = threadUsecases({
    store: threads,
    registry,
    run: run as never,
    calendar: {
      ensureProposalThread: async () => undefined,
      replan: async (_p, id) => (await threads.readThreadById(id))!,
      dismiss: async (_p, id) => (await threads.readThreadById(id))!,
      todayEvents: async () => [],
    },
    clock,
    ids: () => 'thread-' + ++cardIds,
  });

  /** The person as a signed-in request of `binding` sees them: its delegate reads the session again before each token. */
  const asking = (user: string, binding: string): AuthenticatedContext => ({
    ...persona(user, binding),
    delegate: async audience => (await desk.find(binding))?.delegate(audience),
  });
  const signIn = (user: string, binding: string) => desk.signIn(binding, user, tokenFor(user, binding), at());
  /** The page asks for the person's cards (a visit, with activity reported), and the worker runs what is due. */
  async function visit(user: string, binding: string) {
    now += 61_000;
    desk.touch(binding, at());
    await refresh.request(asking(user, binding));
    while (await refresh.tick());
  }
  const cardsOf = (user: string) =>
    threads
      .dump()
      .filter(x => x.personId === user)
      .map(x => x.thread);
  /** The newest card for a file. */
  const card = (user: string, fileId: number): Thread => {
    const found = cardsOf(user).filter(t => t.topic.startsWith(`${ID}:file:${fileId}:`));
    if (!found.length) throw new Error(`No card for ${fileId}`);
    return found.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1)!;
  };
  /**
   * A card's button, as `POST /api/threads/:id/act` takes it in the session `binding`; then the approved write's workflow
   * runs, after `meanwhile` (what happens between the approval and the dispatch).
   */
  async function decide(
    user: string,
    binding: string,
    thread: Thread,
    actionId: 'approve' | 'reject',
    meanwhile: () => void = () => {},
  ) {
    const answer = await decisions.act(asking(user, binding), thread.id, actionId);
    const executionId = 'thread' in answer ? answer.thread?.execution?.id : undefined;
    meanwhile();
    if (executionId) await executions.progress(executionId);
    return (await threads.readThread(user, thread.id))!;
  }
  const writes = () => calls.filter(c => c.path.endsWith('.approve') || c.path.endsWith('.reject'));
  const scans = () => calls.filter(c => c.path === '/clew/scan');
  const audit = (action: string) => threads.audit.filter(a => a.action === action);
  return {
    desk,
    nextcloud,
    refresh,
    refreshStore,
    executions,
    memoryLedger,
    cards,
    calls,
    writes,
    scans,
    audit,
    signIn,
    asking,
    visit,
    cardsOf,
    card,
    decide,
    advance: (ms: number) => (now += ms),
    at,
  };
}
const waiting = async (w: ReturnType<typeof world>, user: string, fileId: number) =>
  (await w.nextcloud.state(tokenFor(user, 'check'), fileId)).state;

describe('the Approval loop, signed in (D101, D103)', () => {
  test("a visit scans with the session's token, a card's button approves through the ledger with the approving session, and the receipt is Nextcloud's read-back", async () => {
    const w = world();
    w.signIn('hillevi', 'session-1');
    await w.visit('hillevi', 'session-1');
    // The scan ran with the token of the session that asked.
    expect(w.scans()).toEqual([{ path: '/clew/scan', token: tokenFor('hillevi', 'session-1'), operationId: null }]);
    const cards = w.cardsOf('hillevi');
    expect(cards.map(t => [t.topic.split(':').slice(0, 3).join(':'), t.state, t.title])).toEqual([
      [`${ID}:file:625`, 'open', 'Godkänn eller avvisa Inköp av läsplattor.txt'],
      [`${ID}:file:627`, 'open', 'Godkänn eller avvisa Plan för klassresa.txt'],
      [`${ID}:file:626`, 'open', 'Godkänn eller avvisa Schema för studiedag.txt'],
    ]);
    expect(cards[0]!.trigger).toMatchObject({ reason: 'Du kan godkänna filen i Nextcloud', source: 'Nextcloud' });
    expect(w.audit('refresh.requested').at(-1)).toMatchObject({
      actor: 'person:hillevi',
      details: { connector: ID, session: true },
    });
    expect(w.audit('refresh.completed').at(-1)).toMatchObject({
      actor: 'system:refresh',
      details: { connector: ID, complete: true, count: 3, session: true },
    });
    expect(w.audit('thread.pushed')).toHaveLength(3);

    const decidedAt = w.at();
    const done = await w.decide('hillevi', 'session-1', w.card('hillevi', 625), 'approve');
    expect(w.writes()).toEqual([
      {
        path: `/clew/capabilities/${ID}.approve`,
        token: tokenFor('hillevi', 'session-1'),
        operationId: 'exec-1',
      },
    ]);
    expect(done).toMatchObject({
      state: 'handled',
      waitingOn: null,
      execution: { id: 'exec-1', operation: `${ID}.approve`, state: 'succeeded', reason: null },
      receipt: {
        at: decidedAt,
        headline: 'Filen är godkänd i Nextcloud.',
        rows: [
          {
            ref: `${ID}:file:625`,
            label: 'Inköp av läsplattor.txt',
            outcome: 'done',
            detail: 'Godkänd i Nextcloud av Hillevi Berg 10 nov kl. 14:01.',
          },
        ],
        undoUntil: null,
        undoCapability: null,
      },
    });
    expect(await waiting(w, 'hillevi', 625)).toBe(2);
    expect(w.memoryLedger.audit()).toEqual([
      {
        actor: 'person:hillevi',
        action: 'execution.approved',
        subject: 'execution:exec-1',
        at: decidedAt,
        details: {
          connector: ID,
          operation: `${ID}.approve`,
          digest: expect.any(String),
          compensates: null,
          session: 'approving',
        },
      },
      {
        actor: 'system:execution',
        action: 'execution.claimed',
        subject: 'execution:exec-1',
        at: decidedAt,
        details: { attempt: 1, recovery: false },
      },
      {
        actor: 'system:execution',
        action: 'execution.dispatched',
        subject: 'execution:exec-1',
        at: decidedAt,
        details: { attempt: 1, session: 'approving' },
      },
      {
        actor: 'system:execution',
        action: 'execution.succeeded',
        subject: 'execution:exec-1',
        at: decidedAt,
        details: { attempt: 1, reason: null, outcomes: ['done'], session: 'approving' },
      },
    ]);
    // Neither a binding nor a token is in any audit row.
    const everything = JSON.stringify([
      w.memoryLedger.audit(),
      w.audit('refresh.requested'),
      w.audit('refresh.completed'),
    ]);
    expect(everything).not.toContain('session-1');
    expect(everything).not.toContain(tokenFor('hillevi', 'session-1'));

    // The next visit: the file no longer waits, its work is resolved by the complete snapshot, the receipt stays.
    await w.visit('hillevi', 'session-1');
    expect(w.audit('work.resolved')).toHaveLength(1);
    expect(w.card('hillevi', 625)).toMatchObject({
      state: 'handled',
      receipt: { headline: 'Filen är godkänd i Nextcloud.' },
    });
    expect(w.cardsOf('hillevi').filter(t => t.state === 'open')).toHaveLength(2);
  });

  test('a reject, confirmed on the card, is carried out and read back the same way', async () => {
    const w = world();
    w.signIn('hillevi', 'session-1');
    await w.visit('hillevi', 'session-1');
    const card = w.card('hillevi', 627);
    expect(card.actions.find(a => a.id === 'reject')).toMatchObject({
      kind: 'execute',
      role: 'secondary',
      confirm: 'Avvisa filen? Ditt beslut gäller för alla som kan godkänna den.',
    });
    const rejected = await w.decide('hillevi', 'session-1', card, 'reject');
    expect(rejected).toMatchObject({
      state: 'handled',
      receipt: {
        headline: 'Filen är avvisad i Nextcloud.',
        rows: [{ outcome: 'done', detail: 'Avvisad i Nextcloud av Hillevi Berg 10 nov kl. 14:01.' }],
      },
    });
    expect(await waiting(w, 'hillevi', 627)).toBe(3);
    expect(w.writes().map(c => [c.path, c.token])).toEqual([
      [`/clew/capabilities/${ID}.reject`, tokenFor('hillevi', 'session-1')],
    ]);
  });

  test('a card outlives the session that scanned it: a later session approves it, and an ended approving session stops the write before it is sent', async () => {
    const w = world();
    w.signIn('hillevi', 'session-1');
    await w.visit('hillevi', 'session-1');
    w.desk.end('session-1');
    // Signed in again: the card from the first session's scan is decided in the second, with the second's token.
    w.signIn('hillevi', 'session-2');
    const approved = await w.decide('hillevi', 'session-2', w.card('hillevi', 625), 'approve');
    expect(approved).toMatchObject({ state: 'handled', receipt: { rows: [{ outcome: 'done' }] } });
    expect(w.writes().map(c => c.token)).toEqual([tokenFor('hillevi', 'session-2')]);

    // Approved in the second session, which ends (sign-out, expiry) before the workflow runs: nothing reaches Nextcloud.
    const stopped = await w.decide('hillevi', 'session-2', w.card('hillevi', 626), 'approve', () =>
      w.desk.end('session-2'),
    );
    expect(stopped).toMatchObject({
      state: 'open',
      waitingOn: null,
      receipt: null,
      execution: { state: 'pending', reason: 'needs-session' },
    });
    expect(w.writes()).toHaveLength(1);
    expect(await waiting(w, 'hillevi', 626)).toBe(4);
    // A later sign-in does not resume it, and the same button returns the waiting execution without sending anything.
    w.signIn('hillevi', 'session-3');
    await w.decide('hillevi', 'session-3', stopped, 'approve');
    expect(w.card('hillevi', 626).execution).toMatchObject({ id: stopped.execution!.id, state: 'pending' });
    expect(w.writes()).toHaveLength(1);
    expect(await w.executions.read(w.asking('hillevi', 'session-3'), stopped.execution!.id)).toMatchObject({
      state: 'pending',
      reason: 'needs-session',
    });
  });

  test('a file changed after its card was made is refused by Nextcloud; the card keeps the failure until the person puts it away, and then the new version comes as a new card', async () => {
    const w = world();
    w.signIn('hillevi', 'session-1');
    await w.visit('hillevi', 'session-1');
    const listed = w.card('hillevi', 626);
    w.nextcloud.controls.edit(626);
    const failed = await w.decide('hillevi', 'session-1', listed, 'approve');
    expect(failed).toMatchObject({
      state: 'open',
      waitingOn: null,
      execution: { state: 'failed' },
      receipt: {
        headline: 'Beslutet registrerades inte i Nextcloud.',
        rows: [
          {
            outcome: 'failed',
            detail: 'Filen har ändrats sedan kortet skapades. Granska den nya versionen i Nextcloud innan du beslutar.',
          },
        ],
      },
    });
    expect(await waiting(w, 'hillevi', 626)).toBe(4);

    // FINDING: the next scan reports a new revision of the same work, but the card is neither updated (it carries a
    // receipt, refresh.ts: `if (thread?.receipt)`) nor replaced (a new card with the same topic clashes with the open one,
    // `insertThread` returns false and the draft is skipped). The card keeps the old version in its actions.
    await w.visit('hillevi', 'session-1');
    expect(w.cardsOf('hillevi').filter(t => t.topic.startsWith(`${ID}:file:626:`))).toHaveLength(1);
    expect(w.card('hillevi', 626).items[0]!.revision).toBe(listed.items[0]!.revision);
    // FINDING: the same button gives back the failed execution and sends nothing; the other gives a wrong reason.
    await w.decide('hillevi', 'session-1', w.card('hillevi', 626), 'approve');
    expect(w.writes()).toHaveLength(1);
    await expect(w.decide('hillevi', 'session-1', w.card('hillevi', 626), 'reject')).rejects.toThrow(
      'Ett tidigare beslut väntar redan på besked.',
    );

    // The way forward today: Avfärda. The next scan brings the new version as a new card, which approves.
    await w.cards.dismissThread(w.asking('hillevi', 'session-1'), listed.id);
    await w.visit('hillevi', 'session-1');
    const fresh = w.card('hillevi', 626);
    expect(fresh.id).not.toBe(listed.id);
    expect(fresh.state).toBe('open');
    expect(fresh.items[0]!.revision).not.toBe(listed.items[0]!.revision);
    expect(await w.decide('hillevi', 'session-1', fresh, 'approve')).toMatchObject({
      state: 'handled',
      receipt: { rows: [{ outcome: 'done' }] },
    });
    expect(await waiting(w, 'hillevi', 626)).toBe(2);
  });

  test('when another approver decides first, the card says who did; the work is resolved, but the card stays open until put away', async () => {
    const w = world();
    w.nextcloud.controls.share(631, 'hillevi');
    w.signIn('hillevi', 'session-h');
    w.signIn('hassan', 'session-a');
    await w.visit('hillevi', 'session-h');
    await w.visit('hassan', 'session-a');
    const hers = w.card('hillevi', 631);
    const decidedAt = w.at();
    expect(await w.decide('hassan', 'session-a', w.card('hassan', 631), 'approve')).toMatchObject({
      state: 'handled',
      receipt: { rows: [{ outcome: 'done', detail: 'Godkänd i Nextcloud av Hassan Ali 10 nov kl. 14:02.' }] },
    });
    expect(decidedAt).toBe('2026-11-10T13:02:02.000Z');
    const lost = await w.decide('hillevi', 'session-h', hers, 'approve');
    expect(lost).toMatchObject({
      state: 'open',
      execution: { state: 'failed' },
      receipt: {
        headline: 'Beslutet registrerades inte i Nextcloud.',
        rows: [{ outcome: 'failed', detail: 'Filen är redan godkänd av Hassan Ali 10 nov kl. 14:02.' }],
      },
    });
    expect(w.writes().map(c => c.token)).toEqual([tokenFor('hassan', 'session-a'), tokenFor('hillevi', 'session-h')]);
    // FINDING: the next scan resolves the work (the file no longer waits for her), but a card with a receipt is never
    // marked handled by a scan (refresh.ts: `t.receipt` in the resolution loop), so the failed card stays open.
    const hersFor631 = () =>
      w.refreshStore.dump().find(o => o.personId === 'hillevi' && o.sourceKey === `${ID}:file:631`)!;
    expect(hersFor631().sourceState).toBe('open');
    await w.visit('hillevi', 'session-h');
    expect(hersFor631()).toMatchObject({ sourceState: 'resolved', threadId: hers.id });
    expect(w.card('hillevi', 631)).toMatchObject({
      id: hers.id,
      state: 'open',
      receipt: { rows: [{ outcome: 'failed' }] },
    });
  });

  test('a person idle beyond PRESENCE_MS is not scanned as: blocked, Nextcloud not called, the cards untouched; a decision still goes through', async () => {
    const w = world(undefined, { wall: true });
    w.signIn('hillevi', 'session-1');
    await w.visit('hillevi', 'session-1');
    const cards = w.cardsOf('hillevi'),
      lastSuccess = w.refreshStore.requests()[0]!.lastSuccess;
    w.advance(PRESENCE_MS + 1000);
    expect(await w.refresh.tick()).toBe(true);
    expect(w.scans()).toHaveLength(1);
    expect(w.refreshStore.requests()[0]).toMatchObject({
      state: 'blocked',
      error: 'authorization-required',
      lastSuccess,
    });
    expect(w.cardsOf('hillevi')).toEqual(cards);
    expect(w.audit('refresh.failed').at(-1)).toMatchObject({
      details: { reason: 'authorization-required', connector: ID, session: 'idle' },
    });
    // A write needs no presence: the approval is the person's own act (D103 item 3).
    expect(await w.decide('hillevi', 'session-1', w.card('hillevi', 625), 'approve')).toMatchObject({
      state: 'handled',
    });
    // Back on the page: the next ask scans at once.
    await w.visit('hillevi', 'session-1');
    expect(w.scans()).toHaveLength(2);
    expect(w.refreshStore.requests()[0]).toMatchObject({ state: 'complete', error: null });
  });

  test('a scan that cannot read one waiting file’s version is partial: no banner, that card kept as it was', async () => {
    let hide = false;
    const w = world(source => ({
      ...source,
      versions: async (token, user, ids) =>
        (await source.versions(token, user, ids)).filter(v => !hide || v.fileId !== 626),
    }));
    w.signIn('hillevi', 'session-1');
    await w.visit('hillevi', 'session-1');
    const before = w.card('hillevi', 626);
    hide = true;
    await w.visit('hillevi', 'session-1');
    expect(w.audit('refresh.completed').at(-1)).toMatchObject({ details: { complete: false, count: 2 } });
    // What the page reads: the source answered, so no "svarar inte" banner; the card for 626 is untouched.
    expect(await w.refresh.statuses(w.asking('hillevi', 'session-1'))).toEqual([
      { connector: ID, state: 'complete', lastSuccess: w.at(), error: null },
    ]);
    expect(w.card('hillevi', 626)).toEqual(before);
    expect(w.audit('work.resolved')).toEqual([]);
  });
});
