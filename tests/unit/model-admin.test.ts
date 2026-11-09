import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { memoryModelHealth, memoryModelStore, memoryModelWire } from '../../apps/server/src/assistant/adapters/memory';
import { modelUsecases } from '../../apps/server/src/assistant/usecases/models';
import { choicesFor, pickModel, slugFor } from '../../apps/server/src/assistant/domain';
import type { ModelRecord } from '../../apps/server/src/assistant/ports';

/**
 * Model administration and the person's model (D24) on the memory store with an endpoint the test plays: what the
 * administrator does, what the store and the audit log hold afterwards, what Hillevi and Hassan may pick, and which
 * model a turn gets. The key never leaves the server.
 */
const persona = (id: string, role: 'manager' | 'employee', capabilities: string[] = []) => {
  const p: AuthenticatedContext & { stepUps: number } = {
    id,
    name: id,
    unitId: id === 'mikael' ? 'unit-it' : 'unit-skola',
    unitLabel: 'Enheten',
    role,
    stepUps: 0,
    organisationId: 'sundsvall',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities,
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    async authorize() {
      p.stepUps += 1;
      return { version: 'v1' };
    },
  };
  return p;
};
const KEY = 'sk-kommunens-nyckel-123';
const T0 = '2026-11-05T07:00:00.000Z';
function world() {
  const mikael = persona('mikael', 'employee', ['admin.connectors']),
    hillevi = persona('hillevi', 'manager'),
    hassan = persona('hassan', 'employee');
  const store = memoryModelStore(),
    health = memoryModelHealth();
  const endpoints = {
    'http://llm.test/v1': { models: ['gpt-oss:120b', 'gpt-oss:20b'], key: KEY },
    'http://lokal.test/v1': { noList: true },
    'http://nere.test/v1': { down: true },
    'http://resonerar.test/v1': { models: ['tankande'], refusesReasoningTools: true },
  };
  const wire = memoryModelWire({
    endpoints,
    generate: async () => ({ text: 'ok', toolCalls: [] }),
  });
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  const models = modelUsecases({
    store,
    wire,
    health,
    clock,
    sealer: {
      seal: (v, id) => `sealed(${id}):${Buffer.from(v).toString('base64')}`,
      open: (s, id) => Buffer.from(s.replace(`sealed(${id}):`, ''), 'base64').toString(),
    },
  });
  return {
    mikael,
    hillevi,
    hassan,
    store,
    health,
    wire,
    endpoints,
    models,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const actions = (store: ReturnType<typeof memoryModelStore>, subject: string) =>
  store.audit.filter(a => a.subject === subject).map(a => a.action);
/** A provider with two models, the capable one on and the default, the small one on and for managers only. */
async function installed(w: ReturnType<typeof world>) {
  await w.models.addProvider(w.mikael, {
    id: 'kommunen',
    title: 'Kommunens modeller',
    baseUrl: 'http://llm.test/v1/',
    apiKey: KEY,
  });
  const { model: big } = await w.models.addModel(w.mikael, {
    providerId: 'kommunen',
    model: 'gpt-oss:120b',
    title: 'Kapabel',
    description: 'Långa svar och utkast.',
  });
  const { model: small } = await w.models.addModel(w.mikael, {
    providerId: 'kommunen',
    model: 'gpt-oss:20b',
    title: 'Snabb (lokal)',
    description: 'Korta frågor om dagen.',
  });
  await w.models.updateModel(w.mikael, big.id, { state: 'enabled', isDefault: true });
  await w.models.updateModel(w.mikael, small.id, {
    state: 'enabled',
    audience: { mode: 'selected', roles: ['manager'] },
  });
  return { big: big.id, small: small.id };
}

describe('the pure rules', () => {
  test("Clew's id comes from the endpoint's id, made unique", () => {
    expect(slugFor('gpt-oss:120b', new Set())).toBe('gpt-oss-120b');
    expect(slugFor('Qwen/Qwen3-32B', new Set())).toBe('qwen-qwen3-32b');
    expect(slugFor('gpt-oss:120b', new Set(['gpt-oss-120b', 'gpt-oss-120b-2']))).toBe('gpt-oss-120b-3');
    expect(slugFor('7b-instruct', new Set())).toBe('b-instruct');
    expect(slugFor('123', new Set())).toBe('modell');
  });
  test('the choices are the switched-on models on a provider that exists, in the audience, the default first; the pick falls back silently', () => {
    const row = (id: string, values: Partial<ModelRecord> = {}): ModelRecord => ({
      id,
      providerId: 'p',
      model: id,
      title: id,
      description: '',
      state: 'enabled',
      audience: { mode: 'all' },
      isDefault: false,
      tools: true,
      reasoning: 'provider-default',
      createdBy: 'x',
      updatedBy: 'x',
      createdAt: T0,
      updatedAt: T0,
      version: 1,
      ...values,
    });
    const all = [
      row('a'),
      row('b', { isDefault: true }),
      row('off', { state: 'disabled' }),
      row('chefer', { audience: { mode: 'selected', roles: ['manager'] } }),
      row('orphan', { providerId: 'gone' }),
    ];
    const employee = { id: 'hassan', name: 'Hassan', unitId: 'unit-skola', unitLabel: '', role: 'employee' as const };
    expect(choicesFor(all, new Set(['p']), employee).map(m => m.id)).toEqual(['b', 'a']);
    expect(choicesFor(all, new Set(['p']), { ...employee, role: 'manager' }).map(m => m.id)).toEqual([
      'b',
      'a',
      'chefer',
    ]);
    expect(pickModel(choicesFor(all, new Set(['p']), employee), 'chefer')?.id).toBe('b');
    expect(pickModel(choicesFor(all, new Set(['p']), employee), 'a')?.id).toBe('a');
    expect(pickModel([], 'a')).toBeUndefined();
  });
});

describe('who may administer', () => {
  test('without the grant every call is forbidden, reads included; every mutation asks for the step-up', async () => {
    const w = world();
    await expect(w.models.list(w.hillevi)).rejects.toThrow(/behörighet/);
    await expect(
      w.models.addProvider(w.hassan, { id: 'x', title: 'X', baseUrl: 'http://llm.test/v1' }),
    ).rejects.toThrow(/behörighet/);
    await installed(w);
    expect(w.mikael.stepUps).toBe(5);
    await expect(w.models.updateModel(w.hillevi, 'gpt-oss-120b', { state: 'disabled' })).rejects.toThrow(/behörighet/);
  });
});

describe('providers', () => {
  test('adding one seals the key, asks the endpoint for its models, records health and one audit row; no view carries the key', async () => {
    const w = world();
    const { provider, report } = await w.models.addProvider(w.mikael, {
      id: 'kommunen',
      title: 'Kommunens modeller',
      baseUrl: 'http://llm.test/v1/',
      apiKey: KEY,
    });
    expect(report).toMatchObject({
      ok: true,
      models: ['gpt-oss:120b', 'gpt-oss:20b'],
      health: { status: 'ok', at: T0 },
    });
    expect(provider).toMatchObject({
      id: 'kommunen',
      baseUrl: 'http://llm.test/v1',
      hasKey: true,
      keyChangedAt: T0,
      models: 0,
      health: { status: 'ok' },
    });
    expect((await w.store.readProvider('kommunen'))!.apiKey).toStartWith('sealed(kommunen):');
    expect(w.wire.calls[0]).toMatchObject({ kind: 'list', apiKey: KEY });
    expect(actions(w.store, 'provider:kommunen')).toEqual(['provider.added']);
    expect(
      JSON.stringify([
        provider,
        await w.models.list(w.mikael),
        await w.models.readProvider(w.mikael, 'kommunen'),
        w.store.audit,
      ]),
    ).not.toContain(KEY);
    await expect(
      w.models.addProvider(w.mikael, { id: 'kommunen', title: 'Igen', baseUrl: 'http://llm.test/v1' }),
    ).rejects.toThrow('finns redan');
  });
  test('a wrong key, an endpoint that is down and one without a model list are each named, and the row is kept', async () => {
    const w = world();
    expect(
      (
        await w.models.addProvider(w.mikael, {
          id: 'fel',
          title: 'Fel nyckel',
          baseUrl: 'http://llm.test/v1',
          apiKey: 'fel',
        })
      ).report,
    ).toMatchObject({
      ok: false,
      health: { status: 'key-rejected' },
      findings: [{ level: 'fail', text: expect.stringContaining('Nyckeln avvisas') }],
    });
    expect(
      (await w.models.addProvider(w.mikael, { id: 'nere', title: 'Nere', baseUrl: 'http://nere.test/v1' })).report,
    ).toMatchObject({ ok: false, health: { status: 'unreachable' } });
    const lokal = await w.models.addProvider(w.mikael, {
      id: 'lokal',
      title: 'Lokal',
      baseUrl: 'http://lokal.test/v1',
      apiKey: '',
    });
    expect(lokal.report).toMatchObject({
      ok: true,
      models: [],
      health: { status: 'untested' },
      findings: [{ level: 'warn' }],
    });
    expect(lokal.provider.hasKey).toBe(false);
    expect((await w.models.list(w.mikael)).providers.map(p => p.id)).toEqual(['fel', 'lokal', 'nere']);
  });
  test('name, address and key changes are audited one row each; a key rotation is used by the next turn; testing records health', async () => {
    const w = world();
    await installed(w);
    await w.models.updateProvider(w.mikael, 'kommunen', { title: 'Egna modeller', baseUrl: 'http://llm.test/v1' });
    expect(actions(w.store, 'provider:kommunen')).toEqual(['provider.added', 'provider.title']);
    w.advance(60_000);
    await w.models.rotateKey(w.mikael, 'kommunen', { apiKey: 'fel-nyckel' });
    expect((await w.models.readProvider(w.mikael, 'kommunen')).keyChangedAt).toBe('2026-11-05T07:01:00.000Z');
    expect(await w.models.testProvider(w.mikael, 'kommunen')).toMatchObject({
      ok: false,
      health: { status: 'key-rejected' },
    });
    expect(w.health.available('kommunen')).toBe(false);
    expect((await w.store.readProvider('kommunen'))!.health.status).toBe('key-rejected');
    await w.models.rotateKey(w.mikael, 'kommunen', { apiKey: KEY });
    expect(await w.models.testModel(w.mikael, 'gpt-oss-120b')).toMatchObject({ ok: true, health: { status: 'ok' } });
    expect(w.health.available('kommunen')).toBe(true);
    expect(actions(w.store, 'provider:kommunen')).toEqual([
      'provider.added',
      'provider.title',
      'provider.key',
      'provider.key',
    ]);
  });
  test('adding a model settles its reasoning: off only when the provider refuses tools with it, audited, and back when it stops', async () => {
    const w = world();
    await w.models.addProvider(w.mikael, { id: 'tanke', title: 'Tanke', baseUrl: 'http://resonerar.test/v1' });
    const pings = () => w.wire.calls.filter(c => c.kind === 'ping').map(c => c.reasoning);
    const added = await w.models.addModel(w.mikael, { providerId: 'tanke', model: 'tankande' });
    const id = added.model.id;
    expect(added.report).toMatchObject({ ok: true, health: { status: 'ok' } });
    expect(added.report.findings.map(f => f.text).join(' ')).toContain('utan resonemang');
    expect(added.model.reasoning).toBe('none');
    expect(pings()).toEqual(['provider-default', 'none']);
    expect(actions(w.store, 'model:' + id)).toEqual(['model.added', 'model.reasoning']);
    expect(w.store.audit.find(a => a.action === 'model.reasoning')).toMatchObject({
      actor: 'person:mikael',
      subject: 'model:' + id,
      details: { from: 'provider-default', to: 'none', found: 'test' },
    });
    await w.models.updateModel(w.mikael, id, { state: 'enabled', isDefault: true });
    await (await w.models.resolve(w.hillevi))!.generate({ system: '', messages: [], tools: {}, timeoutMs: 1000 });
    expect(w.wire.calls.at(-1)).toMatchObject({ kind: 'generate', reasoning: 'none' });
    // Testa with the same answer writes nothing; a provider that starts taking the call gets its default back.
    await w.models.testModel(w.mikael, id);
    expect(w.store.audit.filter(a => a.action === 'model.reasoning')).toHaveLength(1);
    w.endpoints['http://resonerar.test/v1'].refusesReasoningTools = false;
    expect((await w.models.testModel(w.mikael, id)).findings).toHaveLength(1);
    expect((await w.models.readModel(w.mikael, id)).reasoning).toBe('provider-default');
    expect(w.store.audit.at(-1)).toMatchObject({
      action: 'model.reasoning',
      details: { from: 'none', to: 'provider-default', found: 'test' },
    });
  });
  test('a failed test on add keeps the model and its reasoning, and a model without tools is tested without one', async () => {
    const w = world();
    await w.models.addProvider(w.mikael, { id: 'tanke', title: 'Tanke', baseUrl: 'http://resonerar.test/v1' });
    const wrong = await w.models.addModel(w.mikael, { providerId: 'tanke', model: 'finns-inte' });
    expect(wrong.report).toMatchObject({ ok: false, health: { status: 'ok' } });
    expect(wrong.report.findings[0]!.text).toContain('vägrar anropet');
    expect(wrong.report.findings[0]!.text).toContain('model not found');
    expect(wrong.model).toMatchObject({ state: 'disabled', reasoning: 'provider-default' });
    expect(await w.models.testModel(w.mikael, wrong.model.id)).toMatchObject({ ok: false });
    const before = w.wire.calls.length;
    const quiet = await w.models.addModel(w.mikael, { providerId: 'tanke', model: 'tankande', tools: false });
    expect(quiet.report).toMatchObject({ ok: true });
    expect(w.wire.calls.slice(before)).toEqual([
      expect.objectContaining({ kind: 'ping', reasoning: 'provider-default' }),
    ]);
    expect(w.store.audit.some(a => a.action === 'model.reasoning')).toBe(false);
  });
  test('a provider goes only after its models', async () => {
    const w = world();
    const { big, small } = await installed(w);
    await expect(w.models.removeProvider(w.mikael, 'kommunen')).rejects.toThrow('modeller först');
    await w.models.removeModel(w.mikael, big);
    await w.models.removeModel(w.mikael, small);
    await w.models.removeProvider(w.mikael, 'kommunen');
    expect(await w.store.readProvider('kommunen')).toBeUndefined();
    expect(actions(w.store, 'provider:kommunen').at(-1)).toBe('provider.removed');
  });
});

describe('models', () => {
  test("a model is added off, by the endpoint's id; the same id twice on one provider is refused", async () => {
    const w = world();
    await w.models.addProvider(w.mikael, {
      id: 'kommunen',
      title: 'Kommunens modeller',
      baseUrl: 'http://llm.test/v1',
      apiKey: KEY,
    });
    const { model: m, report } = await w.models.addModel(w.mikael, { providerId: 'kommunen', model: 'gpt-oss:20b' });
    expect(report).toMatchObject({ ok: true, findings: [{ level: 'ok', text: 'gpt-oss:20b svarar.' }] });
    expect(m).toMatchObject({
      id: 'gpt-oss-20b',
      providerTitle: 'Kommunens modeller',
      model: 'gpt-oss:20b',
      title: 'gpt-oss:20b',
      description: '',
      state: 'disabled',
      audience: { mode: 'all' },
      isDefault: false,
      tools: true,
    });
    expect(m.history).toEqual([
      {
        at: T0,
        actor: 'person:mikael',
        action: 'model.added',
        details: { provider: 'kommunen', model: 'gpt-oss:20b' },
      },
    ]);
    await expect(w.models.addModel(w.mikael, { providerId: 'kommunen', model: 'gpt-oss:20b' })).rejects.toThrow(
      'finns redan',
    );
    await expect(w.models.addModel(w.mikael, { providerId: 'saknas', model: 'x' })).rejects.toThrow(
      'Leverantören finns inte',
    );
  });
  test('the default is one switched-on model: a new default clears the old one with its own row, and switching the default off clears its flag', async () => {
    const w = world();
    const { big, small } = await installed(w);
    await expect(
      w.models.updateModel(
        w.mikael,
        (await w.models.addModel(w.mikael, { providerId: 'kommunen', model: 'extra' })).model.id,
        { isDefault: true },
      ),
    ).rejects.toThrow('Slå på modellen');
    await w.models.updateModel(w.mikael, small, { isDefault: true });
    expect((await w.store.listModels()).filter(m => m.isDefault).map(m => m.id)).toEqual([small]);
    expect(actions(w.store, 'model:' + big)).toEqual([
      'model.added',
      'model.enabled',
      'model.default',
      'model.default',
    ]);
    expect(w.store.audit.filter(a => a.subject === 'model:' + big).at(-1)!.details).toEqual({
      to: false,
      replacedBy: small,
    });
    await w.models.updateModel(w.mikael, small, { state: 'disabled' });
    expect(await w.store.readModel(small)).toMatchObject({ state: 'disabled', isDefault: false });
    expect(actions(w.store, 'model:' + small).slice(-2)).toEqual(['model.disabled', 'model.default']);
    const before = w.store.audit.length;
    await w.models.updateModel(w.mikael, small, { state: 'disabled', title: 'Snabb (lokal)' });
    expect(w.store.audit.length).toBe(before);
  });
});

describe("the person's model", () => {
  test("each person sees the models in their audience, the default first; Hassan does not see the managers' model", async () => {
    const w = world();
    const { big, small } = await installed(w);
    expect(await w.models.statusFor(w.hillevi)).toEqual({
      configured: true,
      available: true,
      model: 'Kapabel',
      checkedAt: T0,
      current: { id: big, title: 'Kapabel', description: 'Långa svar och utkast.', isDefault: true },
      choices: [
        { id: big, title: 'Kapabel', description: 'Långa svar och utkast.', isDefault: true },
        { id: small, title: 'Snabb (lokal)', description: 'Korta frågor om dagen.', isDefault: false },
      ],
    });
    expect((await w.models.statusFor(w.hassan)).choices.map(c => c.id)).toEqual([big]);
    await expect(w.models.choose(w.hassan, small)).rejects.toThrow('Modellen finns inte.');
  });
  test("a pick is the person's own, audited, used by the next turn with the opened key, and falls back silently when the model goes away", async () => {
    const w = world();
    const { big, small } = await installed(w);
    const status = await w.models.choose(w.hillevi, small);
    expect(status.current?.id).toBe(small);
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'person:hillevi',
      action: 'model.chosen',
      subject: 'person:hillevi',
      details: { model: small },
    });
    const turn = (await w.models.resolve(w.hillevi))!;
    expect(turn).toMatchObject({ id: small, title: 'Snabb (lokal)', providerId: 'kommunen', tools: true });
    await turn.generate({ system: '', messages: [], tools: {}, timeoutMs: 1000 });
    expect(w.wire.calls.at(-1)).toEqual({
      kind: 'generate',
      baseUrl: 'http://llm.test/v1',
      model: 'gpt-oss:20b',
      reasoning: 'provider-default',
      apiKey: KEY,
    });
    expect((await w.models.resolve(w.hassan))!.id).toBe(big);
    // Out of her audience now: the default answers, nothing is said, the answer's model line makes it visible.
    await w.models.updateModel(w.mikael, small, { audience: { mode: 'selected', units: ['unit-annan'] } });
    expect((await w.models.resolve(w.hillevi))!.id).toBe(big);
    await w.models.updateModel(w.mikael, small, { audience: { mode: 'all' } });
    expect((await w.models.resolve(w.hillevi))!.id).toBe(small);
    await w.models.removeModel(w.mikael, small);
    expect(w.store.choices.has('hillevi')).toBe(false);
    expect((await w.models.resolve(w.hillevi))!.id).toBe(big);
    await w.models.choose(w.hillevi, null);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'model.chosen', details: { model: null } });
  });
  test('with every model off there is no model, and the router answers (D8)', async () => {
    const w = world();
    const { big, small } = await installed(w);
    await w.models.updateModel(w.mikael, big, { state: 'disabled' });
    await w.models.updateModel(w.mikael, small, { state: 'disabled' });
    expect(await w.models.resolve(w.hillevi)).toBeUndefined();
    expect(await w.models.statusFor(w.hillevi)).toMatchObject({
      configured: false,
      available: false,
      model: null,
      current: null,
      choices: [],
    });
  });
  test('the probe asks every provider with a switched-on model, marks it, and stores a change of health', async () => {
    const w = world();
    await installed(w);
    await w.models.addProvider(w.mikael, { id: 'nere', title: 'Nere', baseUrl: 'http://nere.test/v1' });
    await w.models.addProvider(w.mikael, { id: 'lokal', title: 'Lokal', baseUrl: 'http://lokal.test/v1' });
    for (const [provider, model] of [
      ['nere', 'x'],
      ['lokal', 'y'],
    ] as const) {
      const { model: m } = await w.models.addModel(w.mikael, { providerId: provider, model });
      await w.models.updateModel(w.mikael, m.id, { state: 'enabled' });
    }
    w.health.mark('nere', true, T0);
    await w.models.probe();
    expect([w.health.available('kommunen'), w.health.available('nere'), w.health.available('lokal')]).toEqual([
      true,
      false,
      true,
    ]);
    expect((await w.store.readProvider('lokal'))!.health.status).toBe('ok');
    expect((await w.store.readProvider('nere'))!.health.status).toBe('unreachable');
  });
});
