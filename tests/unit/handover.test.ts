import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AssistantAskEvent, AuthenticatedContext, TurnEvent } from '../../packages/contracts/src/index';
import { CapabilityError, audiencedActorOf, openGovernance, type Connector } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { assistantUsecases, TurnStopped } from '../../apps/server/src/assistant';
import type { AssistantDeps } from '../../apps/server/src/assistant/ports';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * A conversation handed to an assistant of another system (the assistants profile), end to end over the hello
 * connector's example assistant behind the real transport and registry, the stream over the memory store, and no model
 * at all: the person's words go out unchanged and alone, the answer comes back as that assistant's own, and every turn
 * commits with its audit row.
 */
const secret = 'test-secret-test-secret';
const persona = (id: string, role: 'manager' | 'employee' = 'manager'): AuthenticatedContext => ({
  id,
  name: id === 'hillevi' ? 'Hillevi Berg' : 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role,
  organisationId: 'sundsvall',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: 'v1' };
  },
});
const hillevi = persona('hillevi');
const hassan = persona('hassan', 'employee');
const T0 = '2026-11-14T07:00:00.000Z';
const GUIDE = 'hello:guide';

function world(options: { extra?: Connector[]; modelAsked?: () => void } = {}) {
  const registry = new Registry();
  const hello = createConnector({ jwks: testJwks, secret, clewUrl: 'http://clew' });
  const sent: Array<{ path: string; body: any }> = [];
  const connectorFetch: FetchLike = (input, init) => {
    sent.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body ?? 'null')) });
    return hello.handle(new Request(input, init));
  };
  registry.register(
    remoteConnector(parseManifest(helloManifest, 'hello'), {
      url: 'http://hello',
      key: secret,
      assert: assertionFor('hello', secret),
      fetch: connectorFetch,
    }),
  );
  for (const c of options.extra ?? []) registry.register(c);
  const store = memoryThreadStore();
  let n = 0;
  const deps = {
    store,
    registry,
    run: <O>(p: AuthenticatedContext, name: string, input: unknown) =>
      registry.run<O>(audiencedActorOf(p), name, input),
    // A handed-over turn reaches neither the calendar nor a model: a turn that did would fail on these.
    calendar: {} as AssistantDeps['calendar'],
    models: {
      resolve: async () => {
        options.modelAsked?.();
        return undefined;
      },
      health: { available: () => true, mark: () => undefined },
    },
    clock: () => new Date(T0),
    ids: () => `id-${++n}`,
    log: () => undefined,
    handover: {
      list: (p: AuthenticatedContext) =>
        registry.assistantsFor(audiencedActorOf(p), { authorize: () => p.authorize() }),
      ask: (
        p: AuthenticatedContext,
        assistant: string,
        ask: { question: string; session?: string },
        signal?: AbortSignal,
      ) =>
        registry.ask(audiencedActorOf(p), assistant, ask, {
          authorize: () => p.authorize(),
          ...(signal ? { signal } : {}),
        }),
    },
  } satisfies AssistantDeps;
  return { registry, store, sent, assistant: assistantUsecases(deps) };
}
const asks = (w: ReturnType<typeof world>) => w.sent.filter(s => s.path === '/clew/ask').map(s => s.body.ask);

describe('the assistants a person may hand a conversation to', () => {
  test('are listed from every source that has the profile, named by the connector and the source', async () => {
    const w = world();
    expect(await w.assistant.listAssistants(hillevi)).toEqual([
      {
        id: GUIDE,
        name: 'Hello-guiden',
        description: 'Exempelassistenten i hello-anslutningen.',
        source: 'Hello',
      },
    ]);
  });
  test('are not listed when the listing read is switched off or the connector leaves the person out', async () => {
    const w = world();
    w.registry.govern('hello', { ...openGovernance(), capabilities: { 'hello.assistants': { enabled: false } } });
    expect(await w.assistant.listAssistants(hillevi)).toEqual([]);
    w.registry.govern('hello', { ...openGovernance(), audience: { mode: 'selected', units: ['unit-annan'] } });
    expect(await w.assistant.listAssistants(hillevi)).toEqual([]);
  });
  test('a source that fails contributes nothing and the others are still listed', async () => {
    const broken: Connector = {
      id: 'trasig',
      kind: 'passthrough',
      source: 'Trasig',
      areas: [],
      capabilities: [
        {
          name: 'trasig.assistants',
          kind: 'read',
          title: 'Assistenter',
          description: 'x',
          input: { type: 'object', properties: {}, additionalProperties: false } as never,
          output: { type: 'object' } as never,
          model: false,
          scope: {},
          run: async () => ({ assistants: [{ ref: 'no spaces allowed', name: 'x' }] }),
        },
      ],
      assistants: {
        list: 'trasig.assistants',
        // eslint-disable-next-line require-yield
        ask: async function* () {
          throw new Error('never asked');
        },
      },
    };
    const w = world({ extra: [broken] });
    expect((await w.assistant.listAssistants(hillevi)).map(a => a.id)).toEqual([GUIDE]);
  });
  test('the listing read is never a model tool', () => {
    const w = world();
    expect(w.registry.tools(audiencedActorOf(hillevi)).map(t => t.name)).not.toContain('hello.assistants');
    expect(() =>
      parseManifest(
        {
          ...(helloManifest as object),
          capabilities: (helloManifest as { capabilities: Array<{ name: string }> }).capabilities.map(c =>
            c.name === 'hello.assistants' ? { ...c, model: true } : c,
          ),
        },
        'hello',
      ),
    ).toThrow(/never a tool/);
    expect(() =>
      parseManifest({ ...(helloManifest as object), assistants: { list: 'hello.missing' } }, 'hello'),
    ).toThrow(/unknown capability/);
    expect(() => parseManifest({ ...(helloManifest as object), protocol: 2 }, 'hello')).toThrow(
      /protocol 2 cannot declare assistants/,
    );
  });
});

describe('a conversation handed to an assistant of another system', () => {
  test('sends the question unchanged and alone, stores the answer as the assistant’s own and audits the turn', async () => {
    let modelAsked = false;
    const w = world({ modelAsked: () => (modelAsked = true) });
    const events: TurnEvent[] = [];
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'Hur många semesterdagar har jag rätt till?', assistant: GUIDE },
      { emit: e => events.push(e) },
    );
    // Exactly the person's words left Clew, with nothing of the conversation beside them.
    expect(asks(w)).toEqual([{ question: 'Hur många semesterdagar har jag rätt till?', assistant: 'guide' }]);
    expect(modelAsked).toBe(false);
    expect(turn.assistant).toBe('handover');
    expect(turn.answer).toEqual({
      body: 'Hej Hillevi Berg! Du frågade: ”Hur många semesterdagar har jag rätt till?”. Det är fråga 1 i det här samtalet.',
      source: 'Hello-guiden',
      at: T0,
    });
    expect(turn.clewActions).toEqual([]);
    // The answer arrived as it was written.
    expect(events.filter(e => e.type === 'text').map(e => (e.type === 'text' ? e.delta : ''))).toEqual([
      'Hej Hillevi Berg! ',
      'Du frågade: ”Hur många semesterdagar har jag rätt till?”. Det är fråga 1 i det här samtalet.',
    ]);
    expect(
      events.filter(e => e.type === 'step').map(e => (e.type === 'step' ? [e.step.title, e.step.status] : [])),
    ).toEqual([
      ['Frågar Hello-guiden', 'running'],
      ['Frågar Hello-guiden', 'complete'],
    ]);
    expect(turn.thread.handover).toEqual({
      assistant: GUIDE,
      name: 'Hello-guiden',
      source: 'Hello',
      session: 'hello-1',
    });
    const [question, answer] = turn.thread.messages;
    expect(question!.meta).toEqual({ handed: { assistant: GUIDE, name: 'Hello-guiden', source: 'Hello' } });
    expect(answer!.meta).toMatchObject({
      assistant: 'handover',
      source: 'Hello-guiden',
      access: { connectors: ['hello'], capabilities: ['hello.assistants'] },
      handover: {
        assistant: GUIDE,
        name: 'Hello-guiden',
        source: 'Hello',
        cites: [{ label: 'Hello-anslutningens exempel' }],
      },
    });
    const row = w.store.audit.at(-1)!;
    expect(row).toMatchObject({
      actor: 'person:hillevi',
      action: 'conversation.handed',
      subject: 'thread:' + turn.conversationId,
      details: { assistant: GUIDE, connector: 'hello', session: 'new', chips: [], cites: 1 },
    });
    // Never a word of the question or the answer in the audit row.
    expect(JSON.stringify(row)).not.toContain('semesterdagar');
    expect(JSON.stringify(row)).not.toContain('Hej Hillevi');
  });
  test('a follow-up continues the conversation the source keeps, by its key', async () => {
    const w = world();
    const first = await w.assistant.converse(hillevi, { text: 'Första frågan', assistant: GUIDE });
    const second = await w.assistant.converse(hillevi, {
      text: 'Och en till',
      assistant: GUIDE,
      conversationId: first.conversationId,
    });
    expect(asks(w)[1]).toEqual({ question: 'Och en till', session: 'hello-1', assistant: 'guide' });
    expect(second.answer.body).toContain('Det är fråga 2 i det här samtalet.');
    expect(second.thread.messages).toHaveLength(4);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'conversation.handed', details: { session: 'continued' } });
  });
  test('nothing of the conversation can be sent with the question', async () => {
    const w = world();
    await expect(
      w.assistant.converse(hillevi, {
        text: 'Vad säger rutinen?',
        assistant: GUIDE,
        chips: [{ ref: 'document:hello:1', kind: 'document', label: 'Rutin' }],
      }),
    ).rejects.toThrow('Det går inte att skicka med något till assistenten.');
    expect(asks(w)).toEqual([]);
    expect(w.store.audit).toEqual([]);
  });
  test('a conversation is handed to one assistant, and to none the person may not ask', async () => {
    const w = world();
    await expect(w.assistant.converse(hillevi, { text: 'Hej', assistant: 'hello:other' })).rejects.toThrow(
      'Assistenten finns inte längre.',
    );
    await expect(w.assistant.converse(hillevi, { text: 'Hej', assistant: 'missing:guide' })).rejects.toThrow(
      'Assistenten finns inte längre.',
    );
    const first = await w.assistant.converse(hillevi, { text: 'Hej', assistant: GUIDE });
    // Someone else cannot continue it: the conversation is not theirs.
    await expect(
      w.assistant.converse(hassan, { text: 'Hej', assistant: GUIDE, conversationId: first.conversationId }),
    ).rejects.toThrow('Samtalet finns inte.');
    expect(asks(w)).toHaveLength(1);
  });
  test('when the person loses the connector between two turns the question never leaves', async () => {
    const w = world();
    const first = await w.assistant.converse(hillevi, { text: 'Hej', assistant: GUIDE });
    w.registry.govern('hello', { ...openGovernance(), state: 'disabled' });
    // The earlier answer is the source's and is hidden with it (`visibleThread`), so the conversation cannot go on.
    await expect(
      w.assistant.converse(hillevi, { text: 'Igen', assistant: GUIDE, conversationId: first.conversationId }),
    ).rejects.toThrow();
    expect(asks(w)).toHaveLength(1);
  });
  test('a source that fails is said in Clew’s words, marked failed and never answered in the assistant’s name', async () => {
    const events: AssistantAskEvent[][] = [
      [
        { type: 'text', delta: 'Ett halvt sv' },
        { type: 'error', code: 'unavailable' },
      ],
      [{ type: 'error', code: 'denied' }],
      [{ type: 'text', delta: 'Avbrutet' }],
      [{ type: 'done', session: 's-1' }],
    ];
    const flaky: Connector = {
      id: 'flaky',
      kind: 'passthrough',
      source: 'Kunskapsbanken',
      areas: [],
      capabilities: [
        {
          name: 'flaky.assistants',
          kind: 'read',
          title: 'Assistenter',
          description: 'x',
          input: { type: 'object', properties: {}, additionalProperties: false } as never,
          output: { type: 'object' } as never,
          model: false,
          scope: {},
          run: async () => ({ assistants: [{ ref: 'hr', name: 'HR-assistenten' }] }),
        },
      ],
      assistants: {
        list: 'flaky.assistants',
        ask: async function* () {
          yield* events.shift()!;
        },
      },
    };
    const w = world({ extra: [flaky] });
    const heard: TurnEvent[] = [];
    const down = await w.assistant.converse(
      hillevi,
      { text: 'Hej', assistant: 'flaky:hr' },
      { emit: e => heard.push(e) },
    );
    expect(down.answer.body).toBe('Kunskapsbanken svarar inte just nu.');
    expect(down.thread.messages[1]!.meta!.handover).toEqual({
      assistant: 'flaky:hr',
      name: 'HR-assistenten',
      source: 'Kunskapsbanken',
      failed: true,
    });
    // The half answer that was heard is taken back.
    expect(heard.at(-2)).toEqual({ type: 'text', delta: 'Kunskapsbanken svarar inte just nu.', reset: true });
    expect(heard.at(-1)).toMatchObject({ type: 'step', step: { status: 'error' } });
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'conversation.handed', details: { failed: 'unavailable' } });
    const denied = await w.assistant.converse(hillevi, { text: 'Hej', assistant: 'flaky:hr' });
    expect(denied.answer.body).toBe('Du får inte fråga den här assistenten i Kunskapsbanken.');
    expect(w.store.audit.at(-1)).toMatchObject({ details: { failed: 'denied' } });
    // A stream that ends without `done`, and an answer without a word, are the source failing too.
    for (const _ of [1, 2]) {
      const turn = await w.assistant.converse(hillevi, { text: 'Hej', assistant: 'flaky:hr' });
      expect(turn.thread.messages[1]!.meta!.handover!.failed).toBe(true);
      expect(turn.answer.body).toMatch(/Kunskapsbanken svara/);
    }
  });
  test('a turn the person stops writes nothing', async () => {
    const stop = new AbortController();
    const slow: Connector = {
      id: 'slow',
      kind: 'passthrough',
      source: 'Långsam',
      areas: [],
      capabilities: [
        {
          name: 'slow.assistants',
          kind: 'read',
          title: 'Assistenter',
          description: 'x',
          input: { type: 'object', properties: {}, additionalProperties: false } as never,
          output: { type: 'object' } as never,
          model: false,
          scope: {},
          run: async () => ({ assistants: [{ ref: 'a', name: 'A' }] }),
        },
      ],
      assistants: {
        list: 'slow.assistants',
        ask: async function* () {
          yield { type: 'text', delta: 'Börjar' } as const;
          stop.abort();
          yield { type: 'done', session: 's' } as const;
        },
      },
    };
    const w = world({ extra: [slow] });
    await expect(
      w.assistant.converse(hillevi, { text: 'Hej', assistant: 'slow:a' }, { signal: stop.signal }),
    ).rejects.toBeInstanceOf(TurnStopped);
    expect(w.store.audit).toEqual([]);
  });
  test('the registry refuses a question to an assistant the source no longer lists', async () => {
    const w = world();
    const gen = w.registry.ask(audiencedActorOf(hillevi), 'hello:withdrawn', { question: 'Hej' });
    await expect(gen.next()).rejects.toBeInstanceOf(CapabilityError);
    expect(asks(w)).toEqual([]);
  });
});
