import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AssistantAskEvent, AuthenticatedContext, TurnEvent } from '../../packages/contracts/src/index';
import { CapabilityError, audiencedActorOf, openGovernance, type Connector } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import {
  assistantUsecases,
  HandoverHeld,
  HandoverOffered,
  heardBody,
  TurnStopped,
} from '../../apps/server/src/assistant';
import type { AssistantDeps, ManagedPerson } from '../../apps/server/src/assistant/ports';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';
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

function world(
  options: {
    extra?: Connector[];
    modelAsked?: () => void;
    generate?: ModelGenerate;
    /** The people the asker manages, when they are a manager; nobody otherwise. */
    people?: ManagedPerson[];
  } = {},
) {
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
        // A model the test plays, with tools, when the test gives one; else no model and the router answers.
        return options.generate
          ? { id: 'open-model', title: 'Öppen modell', providerId: 'llm', tools: true, generate: options.generate }
          : undefined;
      },
      health: { available: () => true, mark: () => undefined },
    },
    clock: () => new Date(T0),
    ids: () => `id-${++n}`,
    log: () => undefined,
    ...(options.people
      ? { people: async (p: AuthenticatedContext) => (p.role === 'manager' ? options.people! : []) }
      : {}),
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
  test("Clew's own model hears the exchange as another assistant's, never as its own answer", async () => {
    const w = world();
    const turn = await w.assistant.converse(hillevi, { text: 'Hur många semesterdagar?', assistant: GUIDE });
    const [question, answer] = turn.thread.messages;
    expect(heardBody(question!)).toBe('(Frågan ställdes till Hello-guiden i Hello.) Hur många semesterdagar?');
    expect(heardBody(answer!)).toStartWith(
      '(Det här svarade Hello-guiden i Hello, inte du. Det är inget du själv har läst.) Hej Hillevi Berg!',
    );
    // A turn Clew answered itself, and Clew's own words about a source that failed, are heard as they are.
    expect(heardBody({ role: 'assistant', body: 'Du har 18 dagar.', meta: { assistant: 'model' } })).toBe(
      'Du har 18 dagar.',
    );
    expect(
      heardBody({
        role: 'assistant',
        body: 'Hello svarar inte just nu.',
        meta: { handover: { assistant: GUIDE, name: 'Hello-guiden', source: 'Hello', failed: true } },
      }),
    ).toBe('Hello svarar inte just nu.');
  });
  test('the registry refuses a question to an assistant the source no longer lists', async () => {
    const w = world();
    const gen = w.registry.ask(audiencedActorOf(hillevi), 'hello:withdrawn', { question: 'Hej' });
    await expect(gen.next()).rejects.toBeInstanceOf(CapabilityError);
    expect(asks(w)).toEqual([]);
  });
});

describe("Clew's own assistant hands a question over (D125 item 11)", () => {
  type Tool = { execute: (input: unknown, options: unknown) => Promise<unknown> };
  /** A model that hands the question to the assistant the test names, then writes something that must never be shown. */
  const handing =
    (assistant: string, seen: { system?: string; tools?: string[] } = {}): ModelGenerate =>
    async ({ system, tools, onText }) => {
      seen.system = system;
      seen.tools = Object.keys(tools);
      onText?.('Jag lämnar');
      const output = await (tools['clew__handOver'] as Tool).execute({ assistant }, {});
      onText?.('Jag lämnar över frågan.');
      return {
        text: 'Jag lämnar över frågan.',
        toolCalls: [{ capability: 'clew.handOver', input: { assistant }, output }],
      };
    };
  test('the model is told of the assistants and given the tool; its choice is a suggestion, and nothing leaves Clew or is saved', async () => {
    const seen: { system?: string; tools?: string[] } = {};
    const w = world({ generate: handing(GUIDE, seen) });
    const events: TurnEvent[] = [];
    const offered = await w.assistant
      .converse(
        hillevi,
        { text: 'Hur många semesterdagar har jag rätt till?' },
        { emit: e => events.push(e), offers: true },
      )
      .catch(e => e);
    expect(seen.tools).toContain('clew__handOver');
    expect(seen.system).toContain('Assistenter du kan lämna frågan till:');
    expect(seen.system).toContain('- hello:guide: Hello-guiden i Hello. Exempelassistenten i hello-anslutningen.');
    // The person is asked first: the turn ends as an offer that names the assistant, with what it is for.
    expect(offered).toBeInstanceOf(HandoverOffered);
    expect((offered as HandoverOffered).assistant).toEqual({
      id: GUIDE,
      name: 'Hello-guiden',
      description: 'Exempelassistenten i hello-anslutningen.',
      source: 'Hello',
    });
    expect(asks(w)).toEqual([]);
    expect(w.store.audit).toEqual([]);
    // What the model wrote on the way is taken back.
    expect(events.filter(e => e.type === 'text')).toEqual([
      { type: 'text', delta: 'Jag lämnar' },
      { type: 'text', delta: '', reset: true },
    ]);
  });
  test('yes to the suggestion sends the person\u2019s own words, and the turn says it was on Clew\u2019s suggestion', async () => {
    const w = world({ generate: handing(GUIDE) });
    const events: TurnEvent[] = [];
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'Hur många semesterdagar har jag rätt till?', assistant: GUIDE, suggested: true },
      { emit: e => events.push(e), offers: true },
    );
    expect(asks(w)).toEqual([{ question: 'Hur många semesterdagar har jag rätt till?', assistant: 'guide' }]);
    expect(turn.assistant).toBe('handover');
    expect(turn.answer.body).toStartWith('Hej Hillevi Berg! Du frågade:');
    // The listener is told whose words follow before the first of them.
    expect(events[0]).toEqual({ type: 'handed', assistant: { id: GUIDE, name: 'Hello-guiden', source: 'Hello' } });
    expect(turn.thread.messages[0]!.meta!.handed).toEqual({
      assistant: GUIDE,
      name: 'Hello-guiden',
      source: 'Hello',
      routed: true,
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'conversation.handed',
      details: { assistant: GUIDE, session: 'new', routed: 'suggested' },
    });
    expect(w.store.audit).toHaveLength(1);
  });
  test('no to it: Clew answers and is not offered the handover, and a caller that cannot ask the person never gets a suggestion', async () => {
    const seen: string[][] = [];
    const quiet: ModelGenerate = async ({ tools }) => {
      seen.push(Object.keys(tools));
      return { text: 'Det svarar jag på själv.', toolCalls: [] };
    };
    const w = world({ generate: quiet });
    const own = await w.assistant.converse(hillevi, { text: 'Hur många semesterdagar?', own: true }, { offers: true });
    expect(own.assistant).toBe('model');
    // Without `offers` (a card's reply, the plain route) the model is not given the tool at all.
    await w.assistant.converse(hillevi, { text: 'Hur många semesterdagar?' });
    expect(seen.flat()).not.toContain('clew__handOver');
    expect(asks(w)).toEqual([]);
  });
  test('a model that does not hand over answers as Clew, and one that names an assistant the person cannot ask is refused', async () => {
    const stays: ModelGenerate = async () => ({ text: 'Det svarar jag på själv.', toolCalls: [] });
    const w = world({ generate: stays });
    const turn = await w.assistant.converse(hillevi, { text: 'Vad kan du göra?' }, { offers: true });
    expect(turn.assistant).toBe('model');
    expect(asks(w)).toEqual([]);
    let refusal: unknown;
    const wrong: ModelGenerate = async ({ tools }) => {
      refusal = await (tools['clew__handOver'] as Tool).execute({ assistant: 'hello:other' }, {});
      return { text: 'Då svarar jag själv.', toolCalls: [] };
    };
    const w2 = world({ generate: wrong });
    const kept = await w2.assistant.converse(hillevi, { text: 'Vad kan du göra?' }, { offers: true });
    expect(refusal).toMatchObject({ handed: false });
    expect(kept.assistant).toBe('model');
    expect(asks(w2)).toEqual([]);
  });
  test('nothing is offered when something is attached to the question, or when no source lists an assistant', async () => {
    const seen: { system?: string; tools?: string[] } = {};
    const quiet: ModelGenerate = async ({ system, tools }) => {
      seen.system = system;
      seen.tools = Object.keys(tools);
      return { text: 'Jag svarar.', toolCalls: [] };
    };
    const w = world({ generate: quiet });
    await w.assistant.converse(
      hillevi,
      {
        text: 'Vad säger den här?',
        chips: [{ ref: 'capability:hello.greeting', kind: 'capability', label: 'Säg hej' }],
      },
      { offers: true },
    );
    expect(seen.tools).not.toContain('clew__handOver');
    expect(seen.system).not.toContain('Assistenter du kan lämna frågan till');
    w.registry.govern('hello', { ...openGovernance(), capabilities: { 'hello.assistants': { enabled: false } } });
    await w.assistant.converse(hillevi, { text: 'Hur många semesterdagar har jag rätt till?' }, { offers: true });
    expect(seen.tools).not.toContain('clew__handOver');
    expect(asks(w)).toEqual([]);
  });
});

describe('an assistant hands the conversation back (D125 item 12)', () => {
  /** A source with one assistant whose answers the test scripts, one list of events per question. */
  const scripted = (script: AssistantAskEvent[][]): Connector => ({
    id: 'kunskap',
    kind: 'passthrough',
    source: 'Kunskapsbanken',
    areas: [],
    capabilities: [
      {
        name: 'kunskap.assistants',
        kind: 'read',
        title: 'Assistenter',
        description: 'x',
        input: { type: 'object', properties: {}, additionalProperties: false } as never,
        output: { type: 'object' } as never,
        model: false,
        scope: {},
        run: async () => ({
          assistants: [{ ref: 'hr', name: 'HR-assistenten', description: 'Anställning och ledighet.' }],
        }),
      },
    ],
    assistants: {
      list: 'kunskap.assistants',
      ask: async function* () {
        yield* script.shift()!;
      },
    },
  });
  const HR = 'kunskap:hr';
  test('declined: nothing the assistant wrote stands, Clew answers the same words itself, and the turn says who handed back', async () => {
    const asked: string[] = [];
    const clew: ModelGenerate = async ({ messages, tools }) => {
      asked.push(String(messages.at(-1)!.content));
      // Handed back, the question is Clew's: it is not offered the handover again.
      expect(Object.keys(tools)).not.toContain('clew__handOver');
      return { text: 'Du har APT 10:00 i morgon.', toolCalls: [] };
    };
    const w = world({
      generate: clew,
      extra: [
        scripted([
          [
            { type: 'text', delta: 'Det där kan jag inte svara på.' },
            { type: 'handback', reason: 'declined', session: 's-1' },
          ],
        ]),
      ],
    });
    const events: TurnEvent[] = [];
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'Vad har jag i kalendern i morgon?', assistant: HR },
      { emit: e => events.push(e) },
    );
    expect(asked).toEqual(['Vad har jag i kalendern i morgon?']);
    expect(turn.assistant).toBe('model');
    expect(turn.answer.body).toBe('Du har APT 10:00 i morgon.');
    // The assistant's own sentence was heard and taken back.
    expect(events).toContainEqual({ type: 'text', delta: '', reset: true });
    // The listener hears that it was handed back before a word of Clew's own answer.
    const back = events.findIndex(e => e.type === 'handedBack');
    expect(events[back]).toEqual({
      type: 'handedBack',
      assistant: { id: HR, name: 'HR-assistenten', source: 'Kunskapsbanken' },
    });
    expect(events.slice(back + 1).some(e => e.type === 'handed')).toBe(false);
    const [question, answer] = turn.thread.messages;
    expect(turn.thread.messages).toHaveLength(2);
    expect(question!.meta!.handed).toEqual({
      assistant: HR,
      name: 'HR-assistenten',
      source: 'Kunskapsbanken',
      declined: true,
    });
    expect(answer!.meta!.handedBack).toEqual({ assistant: HR, name: 'HR-assistenten', source: 'Kunskapsbanken' });
    expect(answer!.meta!.handover).toBeUndefined();
    // The conversation remembers the assistant and its session there, so the person can turn to it again.
    expect(turn.thread.handover).toEqual({
      assistant: HR,
      name: 'HR-assistenten',
      source: 'Kunskapsbanken',
      session: 's-1',
    });
    expect(w.store.audit).toHaveLength(1);
    expect(w.store.audit[0]).toMatchObject({ action: 'conversation.asked', details: { handedBack: HR } });
    expect(JSON.stringify(w.store.audit[0])).not.toContain('kan jag inte');
  });
  test('declined after the person said yes to Clew\u2019s suggestion: Clew answers, and the turn keeps who suggested', async () => {
    const model: ModelGenerate = async ({ tools }) => {
      expect(Object.keys(tools)).not.toContain('clew__handOver');
      return { text: 'Det svarar jag på själv.', toolCalls: [] };
    };
    const w = world({ generate: model, extra: [scripted([[{ type: 'handback', reason: 'declined' }]])] });
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'Hur många semesterdagar har jag rätt till?', assistant: HR, suggested: true },
      { offers: true },
    );
    expect(turn.answer.body).toBe('Det svarar jag på själv.');
    expect(turn.thread.messages[0]!.meta!.handed).toMatchObject({ assistant: HR, routed: true, declined: true });
    expect(w.store.audit[0]).toMatchObject({ details: { handedBack: HR, routed: 'suggested' } });
  });
  test('completed: the answer stands as the assistant\u2019s and is marked as its last word', async () => {
    const w = world({
      extra: [
        scripted([
          [
            { type: 'text', delta: 'Du har 25 dagar.' },
            { type: 'handback', reason: 'completed', session: 's-9', link: 'https://kunskap.example/s/9' },
          ],
        ]),
      ],
    });
    const turn = await w.assistant.converse(hillevi, { text: 'Hur många semesterdagar?', assistant: HR });
    expect(turn.assistant).toBe('handover');
    expect(turn.answer.body).toBe('Du har 25 dagar.');
    expect(turn.thread.messages[1]!.meta!.handover).toEqual({
      assistant: HR,
      name: 'HR-assistenten',
      source: 'Kunskapsbanken',
      link: 'https://kunskap.example/s/9',
      returned: true,
    });
    expect(turn.thread.handover).toMatchObject({ session: 's-9' });
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'conversation.handed', details: { returned: 'completed' } });
  });
});

describe('a question on its way to another assistant is held when it names the person\u2019s staff or cards (D125 item 13)', () => {
  const managed = [{ key: 'anna', name: 'Anna Lindqvist', unit: 'Skönsmons skola' }];
  test('a managed person\u2019s name holds it: nothing is sent or saved, and the person\u2019s yes sends it and is recorded', async () => {
    const w = world({ people: managed });
    const held = await w.assistant
      .converse(
        hillevi,
        { text: 'Hur länge har Anna Lindqvist varit sjukskriven?', assistant: GUIDE },
        { offers: true },
      )
      .catch(e => e);
    expect(held).toBeInstanceOf(HandoverHeld);
    expect((held as HandoverHeld).about).toBe('person');
    expect((held as HandoverHeld).assistant).toMatchObject({ id: GUIDE, name: 'Hello-guiden', source: 'Hello' });
    expect(asks(w)).toEqual([]);
    expect(w.store.audit).toEqual([]);
    // A caller that cannot ask the person refuses instead.
    await expect(
      w.assistant.converse(hillevi, { text: 'Hur länge har Anna Lindqvist varit sjukskriven?', assistant: GUIDE }),
    ).rejects.toThrow('Frågan nämner något som hör hemma i Clew');
    expect(asks(w)).toEqual([]);
    // Sent anyway, by the person's own choice: it goes as written, and the audit row says it was confirmed.
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'Hur länge har Anna Lindqvist varit sjukskriven?', assistant: GUIDE, confirmed: true },
      { offers: true },
    );
    expect(turn.assistant).toBe('handover');
    expect(asks(w)).toEqual([{ question: 'Hur länge har Anna Lindqvist varit sjukskriven?', assistant: 'guide' }]);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'conversation.handed', details: { confirmed: true } });
    expect(JSON.stringify(w.store.audit.at(-1))).not.toContain('Anna');
  });
  test('a question that names nobody and no card goes straight through, and someone who manages nobody is never held for a name', async () => {
    const w = world({ people: managed });
    const turn = await w.assistant.converse(
      hillevi,
      { text: 'Hur fungerar föräldraledighet?', assistant: GUIDE },
      { offers: true },
    );
    expect(turn.assistant).toBe('handover');
    const w2 = world();
    const free = await w2.assistant.converse(
      hassan,
      { text: 'Vad säger rutinen om Anna Lindqvist?', assistant: GUIDE },
      { offers: true },
    );
    expect(free.assistant).toBe('handover');
  });
  test('the model is told to suggest an assistant before searching, and never for the person\u2019s own things', async () => {
    let system = '';
    const quiet: ModelGenerate = async request => {
      system = request.system;
      return { text: 'Jag svarar.', toolCalls: [] };
    };
    const w = world({ generate: quiet });
    await w.assistant.converse(hillevi, { text: 'Vad kan du?' }, { offers: true });
    const rules = system.indexOf('Assistenter i andra system:');
    expect(rules).toBeGreaterThan(-1);
    expect(rules).toBeLessThan(system.indexOf('När svaret bygger på sökverktyget'));
    expect(system).toContain('föreslå hellre assistenten än att gissa ett svar');
    expect(system).toContain('"Hur många semesterdagar har jag kvar?" svarar du på själv.');
  });
});
