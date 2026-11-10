import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { actorOf, SEARCH_CONNECTOR } from '../../packages/connectors/src/index';
import { fixtureConnectors } from '../fixture-connectors';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { INTRODUCTION_DAYS, threadUsecases, type ThreadDeps } from '../../apps/server/src/threads/usecases/cards';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';
import { helpCapabilities, HELP_CAPABILITY } from '../../apps/server/src/modules/help/capabilities';
import { helpUsecases } from '../../apps/server/src/modules/help/usecases';
import { helpText } from '../../apps/server/src/modules/help/domain';
import type { HelpOutput } from '../../apps/server/src/modules/help/contracts';
import { matchCapability } from '../../apps/server/src/assistant/router';
import { groupThreads } from '../../apps/web/src/stream';

/**
 * The introduction and the help (D97) without a server or a database: the help's text as a pure function, the read
 * through the real registry over the fixture connectors, the question that finds it without a model, and the card a
 * person gets once, with what the audit log says about it.
 */
const persona = (
  id: string,
  role: 'manager' | 'employee',
  over: Partial<AuthenticatedContext> = {},
): AuthenticatedContext => ({
  id,
  name: id,
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
  ...over,
});
const hillevi = persona('hillevi', 'manager'),
  hassan = persona('hassan', 'employee');
const T0 = '2026-11-10T07:00:00.000Z';
const DAY = 24 * 60 * 60_000;

function world(only: Array<'hr' | 'finance' | 'incidents'> = ['hr', 'finance', 'incidents']) {
  const registry = new Registry();
  let now = Date.parse(T0);
  const clock = Object.assign(() => new Date(now), {
    advance(ms: number) {
      now += ms;
    },
  });
  registry.register({ id: 'calendar', kind: 'core', source: 'Kalendern', areas: [], capabilities: [] });
  for (const m of fixtureConnectors({ only, clock }).connectors) registry.register(m);
  const core = searchConnector(searchUsecases({ sources: a => registry.searchSources(a), clock }));
  const help = helpUsecases({ registry });
  registry.register({ ...core, capabilities: [...core.capabilities, ...helpCapabilities(help).capabilities] });
  const store = memoryThreadStore();
  let n = 0;
  const deps: ThreadDeps = {
    store,
    registry,
    run: (p, name, input) => registry.run(actorOf(p), name, input),
    calendar: {
      ensureProposalThread: async () => undefined,
      replan: async (_p, id) => (await store.readThreadById(id))!,
      dismiss: async (_p, id) => (await store.readThreadById(id))!,
      todayEvents: async () => [],
    },
    clock,
    ids: () => `thread-${++n}`,
  };
  const threads = threadUsecases(deps);
  // The card's step as the server runs it: the read, and the stream told that it was answered (D97).
  const decisions = cardDecisions({
    read: threads.threadFor,
    answered: threads.concludeIntroduction,
    registry,
    run: deps.run,
    approve: async () => {
      throw new Error('a read approves nothing');
    },
    clock,
  });
  return { registry, store, help, threads, decisions, clock };
}
const read = (w: ReturnType<typeof world>, p: AuthenticatedContext) =>
  w.registry.run<HelpOutput>(actorOf(p), HELP_CAPABILITY, {});

describe('the help text', () => {
  test('names the systems, what each area pushes and offers, and the tools', () => {
    const body = helpText({
      areas: [
        {
          title: 'Personal',
          source: 'Personalsystemet',
          schedules: [{ label: 'Nya saker att göra', when: 'Varje vardag 06:00' }],
          standing: ['Vem är på plats', 'Frånvaro'],
        },
        { title: 'Ekonomi', source: 'Ekonomisystemet', schedules: [], standing: [] },
      ],
      tools: ['Telefonbok'],
    });
    expect(body).toContain('Startsidan läser ur två system åt dig: Personalsystemet och Ekonomisystemet.');
    expect(body).toContain(
      [
        '- **Personal** (Personalsystemet)',
        '  - Kommer hit: Nya saker att göra (varje vardag 06:00)',
        '  - Gör själv: Vem är på plats · Frånvaro',
        '- **Ekonomi** (Ekonomisystemet)',
        '- **Verktyg i menyn**: Telefonbok.',
      ].join('\n'),
    );
    // The view places the first heading level (D38), so the text's sections are all on it.
    expect(body.match(/^# .+$/gm)).toEqual([
      '# Det här är Startsidan',
      '# Fråga eller sök i rutan',
      '# Korten under Behöver dig',
      '# Det här har du',
      '# Hitta tillbaka hit',
    ]);
  });
  test('says so when no system is connected, and leaves out what the person does not have', () => {
    const body = helpText({ areas: [], tools: [] });
    expect(body).toContain('Inget system är anslutet för dig ännu.');
    expect(body).not.toContain('Verktyg i menyn');
  });
});

describe('clew.help', () => {
  test("is computed from the person's own page: a manager and an employee read different systems", async () => {
    const w = world();
    const manager = await w.help.overview(actorOf(hillevi)),
      employee = await w.help.overview(actorOf(hassan));
    // Startsidan's own areas are never listed: the text explains the question box itself.
    expect(manager.areas.map(a => a.title)).not.toContain('Dina frågor');
    expect(manager.areas.length).toBeGreaterThan(0);
    expect(manager.areas.every(a => a.source !== 'Startsidan')).toBe(true);
    expect(JSON.stringify(manager)).not.toBe(JSON.stringify(employee));
    const body = (await read(w, hillevi)).body;
    for (const source of new Set(manager.areas.map(a => a.source))) expect(body).toContain(source);
    for (const area of manager.areas) expect(body).toContain(`- **${area.title}** (${area.source})`);
  });
  test('follows the registry at call time: with one system the text names only that', async () => {
    const w = world(['finance']);
    const overview = await w.help.overview(actorOf(hillevi));
    expect([...new Set(overview.areas.map(a => a.source))]).toEqual(['Ekonomisystemet']);
    const body = (await read(w, hillevi)).body;
    expect(body).toContain('Startsidan läser ur ett system åt dig: Ekonomisystemet.');
    expect(body).not.toContain('Personalsystemet');
  });
  test('declares a text view the model is not handed, and can be a tool in the menu', () => {
    const w = world();
    const found = w.registry.find(HELP_CAPABILITY)!;
    expect(found.connector.id).toBe(SEARCH_CONNECTOR);
    expect(found.capability).toMatchObject({
      kind: 'read',
      model: true,
      view: { kind: 'text', body: 'body', modelReads: 'summary' },
      menu: { label: 'Hjälp', icon: 'book' },
    });
  });
  test('is what the question box finds without a model', () => {
    const w = world();
    for (const p of [hillevi, hassan]) {
      const tools = w.registry.tools(actorOf(p)).filter(t => t.name !== 'clew.search');
      for (const q of ['Vad kan jag göra här?', 'Så fungerar Startsidan', 'Hur fungerar startsidan?', 'hjälp'])
        expect(matchCapability(q, tools)?.name).toBe(HELP_CAPABILITY);
      // A question about the work still goes to the system that answers it.
      expect(matchCapability('visa fakturor', w.registry.tools(actorOf(hillevi)))?.name).toBe('finance.invoices');
    }
  });
});

describe('the introduction card', () => {
  const actions = (w: ReturnType<typeof world>, id: string) =>
    w.store.audit.filter(e => e.subject === 'thread:' + id).map(e => e.action);
  test('is created once, as a card of Startsidan with the help as its one step, and audited', async () => {
    const w = world();
    await w.threads.introduce(hassan);
    const card = (await w.threads.threadFor(hassan, 'introduction:hassan'))!;
    expect(card).toMatchObject({
      kind: 'pushed',
      state: 'open',
      connector: 'clew',
      area: 'fragor',
      topic: 'introduction',
      title: 'Så fungerar Startsidan',
      deadline: null,
      waitingOn: null,
      trigger: { source: 'Startsidan', reason: 'Du är ny på Startsidan. Kortet visas en gång', at: T0 },
      actions: [
        { id: 'show', label: 'Kom igång', capability: HELP_CAPABILITY, kind: 'read', role: 'primary', target: 'panel' },
      ],
    });
    // Startsidan's own card: no source authority, so a new authority does not hide it.
    expect(card.sourceAuthorization).toBeUndefined();
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'assistant:introduction',
      action: 'thread.introduced',
      subject: 'thread:introduction:hassan',
      at: T0,
      details: { connector: 'clew', topic: 'introduction', owner: 'hassan' },
    });
    await w.threads.introduce(hassan);
    await w.threads.introduce(hassan);
    expect(actions(w, 'introduction:hassan')).toEqual(['thread.introduced']);
    expect((await w.threads.listThreadsFor(hassan)).filter(t => t.topic === 'introduction')).toHaveLength(1);
    // One card per person: another person's first read makes theirs, and neither sees the other's.
    await w.threads.introduce(hillevi);
    expect((await w.threads.listThreadsFor(hillevi)).map(t => t.id)).toEqual(['introduction:hillevi']);
    expect(await w.threads.threadFor(hillevi, 'introduction:hassan')).toBeUndefined();
  });
  test('stands under Senare as a requirement without a day, and its step reads the help', async () => {
    const w = world();
    await w.threads.introduce(hassan);
    const groups = groupThreads(await w.threads.listThreadsFor(hassan), T0, T0.slice(0, 10));
    expect(groups.senare.map(t => t.id)).toEqual(['introduction:hassan']);
    expect([...groups.nu, ...groups.foreslar, ...groups.kannedom]).toEqual([]);
    const card = groups.senare[0]!;
    const output = await w.registry.run<HelpOutput>(actorOf(hassan), card.actions[0]!.capability, {});
    expect(output.body).toContain('# Det här har du');
  });
  test('never comes back: not after a dismissal, and not when the unit, the role or the authority changes', async () => {
    const w = world();
    await w.threads.introduce(hassan);
    await w.threads.dismissAny(hassan, 'introduction:hassan');
    expect(actions(w, 'introduction:hassan')).toEqual(['thread.introduced', 'thread.dismissed']);
    const moved = persona('hassan', 'manager', {
      unitId: 'unit-annan',
      unitLabel: 'En annan enhet',
      authorizationVersion: 'v2',
      async authorize() {
        return { version: 'v2' };
      },
    });
    await w.threads.introduce(hassan);
    await w.threads.introduce(moved);
    expect(actions(w, 'introduction:hassan')).toEqual(['thread.introduced', 'thread.dismissed']);
    expect((await w.threads.listThreadsFor(moved)).filter(t => t.state === 'open')).toEqual([]);
    // An open card is still the person's after the authority changed: it holds nothing from a source.
    await w.threads.introduce(hillevi);
    const later = persona('hillevi', 'manager', {
      authorizationVersion: 'v2',
      async authorize() {
        return { version: 'v2' };
      },
    });
    expect((await w.threads.listThreadsFor(later)).map(t => t.id)).toEqual(['introduction:hillevi']);
  });
  test('is done when the help is opened from it: the step answers the text and the closed card, once', async () => {
    const w = world();
    await w.threads.introduce(hassan);
    w.clock.advance(5 * 60_000);
    const first = (await w.decisions.act(hassan, 'introduction:hassan', 'show')) as {
      kind: string;
      output: HelpOutput;
      view?: { kind: string; capability: string };
      thread?: { id: string; state: string; handledAt: string | null };
    };
    expect(first.kind).toBe('read');
    expect(first.output.body).toContain('# Det här har du');
    expect(first.view).toMatchObject({ kind: 'text', capability: HELP_CAPABILITY });
    expect(first.thread).toMatchObject({
      id: 'introduction:hassan',
      state: 'handled',
      handledAt: '2026-11-10T07:05:00.000Z',
    });
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'person:hassan',
      action: 'thread.introduction_closed',
      subject: 'thread:introduction:hassan',
      at: '2026-11-10T07:05:00.000Z',
      details: { reason: 'help-opened', owner: 'hassan' },
    });
    // The address of the step still answers the help after the card is closed, and closes nothing twice.
    const again = (await w.decisions.act(hassan, 'introduction:hassan', 'show')) as typeof first;
    expect(again.output.body).toContain('# Det här har du');
    expect(again.thread).toBeUndefined();
    expect(actions(w, 'introduction:hassan')).toEqual(['thread.introduced', 'thread.introduction_closed']);
    // Only the person's own introduction is closed by a read: any other card's read leaves the stream as it is.
    expect(await w.threads.concludeIntroduction(hassan, 'introduction:hillevi')).toBeUndefined();
    expect(await w.threads.concludeIntroduction(hassan, 'thread-1')).toBeUndefined();
    await w.threads.introduce(hassan);
    expect((await w.threads.listThreadsFor(hassan)).filter(t => t.state === 'open')).toEqual([]);
  });
  test(`leaves by itself after ${INTRODUCTION_DAYS} days untouched, at the person's next read, snoozed or not`, async () => {
    const w = world();
    await w.threads.introduce(hassan);
    await w.threads.introduce(hillevi);
    await w.threads.snoozeThread(hillevi, 'introduction:hillevi', {
      until: new Date(Date.parse(T0) + 30 * DAY).toISOString(),
    });
    w.clock.advance(INTRODUCTION_DAYS * DAY - 60_000);
    await w.threads.introduce(hassan);
    expect((await w.threads.threadFor(hassan, 'introduction:hassan'))!.state).toBe('open');
    w.clock.advance(60_000);
    await w.threads.introduce(hassan);
    const closed = (await w.threads.threadFor(hassan, 'introduction:hassan'))!;
    expect(closed).toMatchObject({ state: 'dismissed', handledAt: '2026-11-24T07:00:00.000Z' });
    expect(closed.messages.at(-1)).toMatchObject({ role: 'assistant', body: 'Stängt efter 14 dagar' });
    expect(w.store.audit.at(-1)).toMatchObject({
      actor: 'assistant:introduction',
      action: 'thread.introduction_closed',
      subject: 'thread:introduction:hassan',
      details: { reason: 'expired', owner: 'hassan' },
    });
    // Put off with Inte nu, it still leaves: the snooze ends with it.
    await w.threads.introduce(hillevi);
    expect(await w.threads.threadFor(hillevi, 'introduction:hillevi')).toMatchObject({
      state: 'dismissed',
      snoozedUntil: null,
    });
    // And it is not made again afterwards.
    w.clock.advance(DAY);
    await w.threads.introduce(hassan);
    expect(actions(w, 'introduction:hassan')).toEqual(['thread.introduced', 'thread.introduction_closed']);
  });
  test('is not made when the help is switched off or the person is no longer authorized', async () => {
    const w = world();
    w.registry.govern(SEARCH_CONNECTOR, {
      ...w.registry.governance(SEARCH_CONNECTOR),
      capabilities: { [HELP_CAPABILITY]: { enabled: false } },
    });
    await w.threads.introduce(hassan);
    expect(await w.store.readThread('hassan', 'introduction:hassan')).toBeUndefined();
    const revoked = persona('hillevi', 'manager', {
      async authorize() {
        throw new Error('person revoked');
      },
    });
    await expect(w.threads.introduce(revoked)).rejects.toThrow('person revoked');
    expect(w.store.audit).toEqual([]);
  });
});
