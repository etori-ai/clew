import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { receipt, type Actor } from '../../packages/connectors/src/index';
import { fixtureConnectors } from '../fixture-connectors';

const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
};
/** The four fixture connectors of the first scenarios, over the protocol on their memory stores. */
const registry = () => {
  const { connectors, states } = fixtureConnectors({ only: ['hr', 'finance', 'incidents', 'communication'] });
  const r = new Registry();
  for (const m of connectors) r.register(m);
  return { r, states };
};

describe('registry', () => {
  test('refuses an execute capability exposed as a tool (D8)', () => {
    const r = new Registry();
    expect(() =>
      r.register({
        id: 'x',
        kind: 'core',
        source: 'x',
        areas: [],
        capabilities: [
          {
            name: 'x.go',
            kind: 'execute',
            title: 'g',
            description: 'g',
            input: {} as never,
            output: {} as never,
            model: true,
            scope: () => true,
            run: async () => ({}),
          },
        ],
      }),
    ).toThrow(/D8/);
  });
  test('checks scope on every call, whatever the path', async () => {
    const { r } = registry();
    await expect(r.run(hassan, 'finance.invoices', {})).rejects.toThrow(/behörighet/);
    await expect(r.run(hillevi, 'finance.invoices', {})).resolves.toMatchObject({ rows: expect.any(Array) });
  });
  test('derives tools only from model-exposed read and propose capabilities in scope', () => {
    const { r } = registry();
    const names = r.tools(hillevi).map(t => t.name);
    expect(names).toContain('hr.absenceOverview');
    expect(names).not.toContain('finance.approve');
    expect(r.tools(hassan).map(t => t.name)).not.toContain('hr.absenceOverview');
  });
  test('areas follow the role and carry figures and standing actions', async () => {
    const { r } = registry();
    const manager = await r.areas(hillevi),
      employee = await r.areas(hassan);
    expect(manager.map(a => a.id)).toEqual(['employees', 'budget', 'work-environment', 'important-now']);
    expect(employee.map(a => a.id)).toEqual(['my-shift', 'important-now']);
    expect(manager[0]!.figure?.label).toMatch(/Frånvaro/);
    expect(manager[0]!.standing.map(s => s.capability)).toContain('hr.whoIsOn');
    // The icon a connector names for its area (D41) comes with the area, for the button under the box.
    expect(manager.map(a => a.icon)).toEqual(['people', 'chart', 'document', 'bell']);
  });
});
describe('the fixture connectors push cards a person can act on, and the state survives in the source', () => {
  test('hr finds the rehab candidate and the pending leave requests', async () => {
    const { r } = registry();
    const drafts = await r.scan(hillevi);
    const topics = drafts.map(d => d.topic);
    expect(topics).toContain('hr:rehab:hr:emp:1001');
    expect(topics.filter(t => t.startsWith('hr:leave:'))).toHaveLength(2);
    expect(topics).toContain('finance:invoices');
    expect(drafts.find(d => d.topic.startsWith('incidents:dev:'))?.waitingOn).toMatch(/skyddsombud/);
    for (const d of drafts) for (const a of d.actions) expect(r.find(a.capability)).toBeDefined();
    expect(drafts.filter(d => d.actions.filter(a => a.role === 'primary').length > 1)).toHaveLength(0);
  });
  test('approving invoices answers row by row, with one unknown, and is undoable', async () => {
    const { r, states } = registry();
    const [draft] = (await r.scan(hillevi)).filter(d => d.topic.startsWith('finance:'));
    const refs = draft!.items!.map(i => i.ref);
    const result = await r.run<{ rows: { outcome: string }[]; undoCapability?: string }>(hillevi, 'finance.approve', {
      refs,
    });
    expect(result.rows.map(x => x.outcome)).toEqual(['done', 'done', 'unknown']);
    expect(receipt(result as never).undoUntil).not.toBeNull();
    expect((await r.scan(hillevi)).filter(d => d.topic.startsWith('finance:'))[0]!.items).toHaveLength(1);
    await r.run(hillevi, 'finance.unapprove', { refs });
    expect((await r.scan(hillevi)).filter(d => d.topic.startsWith('finance:'))[0]!.items).toHaveLength(3);
    expect(states.finance!.keys('approved')).toEqual(['approved']);
  });
  test('an employee sees the delegation and the waiting leave, never the manager cards', async () => {
    const { r } = registry();
    const drafts = await r.scan(hassan);
    expect(drafts.map(d => d.area)).not.toContain('employees');
    expect(drafts.find(d => d.topic.startsWith('hr:delegation:'))?.actions[0]?.capability).toBe('hr.renewDelegation');
    expect(drafts.find(d => d.topic.startsWith('hr:leave-waiting:'))?.waitingOn).toBe('din chef');
    await r.run(hassan, 'hr.renewDelegation', { refs: ['hr:deleg:301'] });
    expect((await r.scan(hassan)).some(d => d.topic.startsWith('hr:delegation:'))).toBe(false);
  });
  test('a read receipt clears the notice for that person only', async () => {
    const { r } = registry();
    await r.run(hassan, 'communication.acknowledge', { refs: ['communication:notice:2026-44-1'] });
    expect((await r.scan(hassan)).some(d => d.topic.startsWith('communication:'))).toBe(false);
    expect((await r.scan(hillevi)).some(d => d.topic.startsWith('communication:'))).toBe(true);
  });
});

describe('connectors reach each other only through the registry (D20)', () => {
  const composite = (r: Registry) =>
    r.register({
      id: 'comp',
      kind: 'derived',
      source: 'Sammansatt',
      areas: [],
      capabilities: [
        {
          name: 'comp.invoiceCount',
          kind: 'read',
          title: 'Antal fakturor',
          description: 'x',
          input: {} as never,
          output: {} as never,
          model: true,
          scope: {},
          run: async (_actor, _input, clew) => ({
            count: (await clew.call<{ rows: unknown[] }>('finance.invoices')).rows.length,
          }),
        },
        {
          name: 'comp.tryExecute',
          kind: 'read',
          title: 'x',
          description: 'x',
          input: {} as never,
          output: {} as never,
          model: false,
          scope: { roles: ['manager'] },
          run: async (_actor, _input, clew) => clew.call('finance.approve', { refs: [] }),
        },
      ],
    });
  test("the other connector's scope applies to the same actor", async () => {
    const { r } = registry();
    composite(r);
    expect(await r.run(hillevi, 'comp.invoiceCount', {})).toMatchObject({ count: expect.any(Number) });
    await expect(r.run(hassan, 'comp.invoiceCount', {})).rejects.toThrow(/behörighet/);
  });
  test('a connector can never execute in another connector', async () => {
    const { r } = registry();
    composite(r);
    await expect(r.run(hillevi, 'comp.tryExecute', {})).rejects.toThrow(/annan anslutning/);
  });
  test('declarative scope: no roles means everyone, roles narrow', () => {
    const { r } = registry();
    composite(r);
    expect(r.tools(hassan).map(t => t.name)).toContain('comp.invoiceCount');
    expect(r.tools(hillevi).some(t => t.name === 'comp.tryExecute')).toBe(false);
  });
});

describe('the registry changes without a restart (D23)', () => {
  test('replace swaps a connector and its capabilities; unregister removes them', async () => {
    const { r } = registry();
    const names = () => r.list().map(c => c.id);
    expect(r.unregister('nope')).toBe(false);
    r.replace({
      id: 'hr',
      kind: 'passthrough',
      source: 'Personalsystemet 2',
      areas: [],
      capabilities: [
        {
          name: 'hr.ping',
          kind: 'read',
          title: 'x',
          description: 'x',
          input: {} as never,
          output: {} as never,
          model: false,
          scope: {},
          run: async () => 'pong',
        },
      ],
    });
    expect(r.find('hr.whoIsOn')).toBeUndefined();
    expect(await r.run(hassan, 'hr.ping', {})).toBe('pong');
    expect(r.unregister('hr')).toBe(true);
    expect(names()).not.toContain('hr');
    expect(r.find('hr.ping')).toBeUndefined();
  });
});

describe('governance: an administrator decides who sees a connector (D23)', () => {
  const hassanIt = { ...hassan, unitId: 'unit-it' };
  test('outside the audience a connector does not exist: no area, no tool, no capability, and a call reads like an unknown capability', async () => {
    const { r } = registry();
    r.govern('finance', {
      state: 'enabled',
      audience: { mode: 'selected', roles: ['manager'] },
      scanEnabled: true,
      toolsEnabled: true,
      capabilities: {},
    });
    expect(r.visible(hillevi, 'finance')).toBe(true);
    expect(r.visible(hassan, 'finance')).toBe(false);
    expect((await r.areas(hassan)).some(a => a.connector === 'finance')).toBe(false);
    expect(r.tools(hassan).some(t => t.name.startsWith('finance.'))).toBe(false);
    expect(r.capabilitiesFor(hassan).some(c => c.connector.id === 'finance')).toBe(false);
    expect(r.listFor(hassan).map(c => c.id)).not.toContain('finance');
    await expect(r.run(hassan, 'finance.budget', {})).rejects.toThrow('Okänd förmåga.');
    await expect(r.run(hassan, 'finance.nope', {})).rejects.toThrow('Okänd förmåga.');
    expect((await r.scan(hassan)).some(d => d.connector === 'finance')).toBe(false);
    expect(r.listFor(hillevi).map(c => c.id)).toContain('finance');
  });
  test("a unit in the audience is enough; the connector's own scope still applies on top", async () => {
    const { r } = registry();
    r.govern('hr', {
      state: 'enabled',
      audience: { mode: 'selected', units: ['unit-it'] },
      scanEnabled: true,
      toolsEnabled: true,
      capabilities: {},
    });
    expect(r.visible(hassan, 'hr')).toBe(false);
    expect(r.visible(hassanIt, 'hr')).toBe(true);
    await expect(r.run(hassanIt, 'hr.absenceOverview', {})).rejects.toThrow(/behörighet/);
  });
  test('disabled or draft hides the connector from everyone; enabling it again brings it back without re-registering', async () => {
    const { r } = registry();
    const g = { audience: { mode: 'all' as const }, scanEnabled: true, toolsEnabled: true, capabilities: {} };
    r.govern('hr', { ...g, state: 'disabled' });
    expect(r.visible(hillevi, 'hr')).toBe(false);
    await expect(r.run(hillevi, 'hr.whoIsOn', {})).rejects.toThrow('Okänd förmåga.');
    r.govern('hr', { ...g, state: 'enabled' });
    expect(r.visible(hillevi, 'hr')).toBe(true);
    expect(r.connector('hr')?.source).toBe('Personalsystemet');
  });
  test('a switched-off capability leaves standing actions, tools and run; a tool switch only removes the tool; the scan switch stops the cards', async () => {
    const { r } = registry();
    const before = r.tools(hillevi).map(t => t.name);
    expect(before).toContain('hr.whoIsOn');
    r.govern('hr', {
      state: 'enabled',
      audience: { mode: 'all' },
      scanEnabled: false,
      toolsEnabled: true,
      capabilities: { 'hr.whoIsOn': { enabled: false }, 'hr.absenceOverview': { model: false } },
    });
    expect(r.tools(hillevi).map(t => t.name)).not.toContain('hr.whoIsOn');
    expect(r.tools(hillevi).map(t => t.name)).not.toContain('hr.absenceOverview');
    await expect(r.run(hillevi, 'hr.whoIsOn', {})).rejects.toThrow('Okänd förmåga.');
    expect(await r.run(hillevi, 'hr.absenceOverview', {})).toMatchObject({ rows: expect.any(Array) });
    expect((await r.areas(hillevi)).flatMap(a => a.standing.map(s => s.capability))).not.toContain('hr.whoIsOn');
    expect((await r.scan(hillevi)).some(d => d.connector === 'hr')).toBe(false);
    r.govern('hr', {
      state: 'enabled',
      audience: { mode: 'all' },
      scanEnabled: true,
      toolsEnabled: false,
      capabilities: {},
    });
    expect(r.tools(hillevi).some(t => t.name.startsWith('hr.'))).toBe(false);
    expect(await r.run(hillevi, 'hr.whoIsOn', {})).toMatchObject({ date: expect.any(String) });
  });
  test('governance survives a replace and is forgotten on unregister; missing governance denies access', () => {
    const { r } = registry();
    r.govern('hr', {
      state: 'disabled',
      audience: { mode: 'all' },
      scanEnabled: true,
      toolsEnabled: true,
      capabilities: {},
    });
    r.replace({ id: 'hr', kind: 'passthrough', source: 'Personalsystemet 2', areas: [], capabilities: [] });
    expect(r.governance('hr').state).toBe('disabled');
    r.unregister('hr');
    expect(r.governance('hr').state).toBe('disabled');
    expect(r.visible(hillevi, 'hr')).toBe(false);
    expect(r.visible(hillevi, 'finance')).toBe(true);
  });
});

describe("a card is one system's: its actions name the pushing connector's capabilities, with their own kinds (D35)", () => {
  const item = { ref: 'rogue:1', label: 'Ärende 1', detail: '', selectable: true, selected: true };
  const draft = (topic: string, action: { capability: string; kind: 'read' | 'propose' | 'execute' }) => ({
    topic,
    area: 'rogue',
    title: topic,
    summary: topic,
    reason: 'test',
    items: [item],
    actions: [{ id: 'go', label: 'Kör', role: 'primary' as const, usesItems: true, ...action }],
  });
  const rogue = {
    id: 'rogue',
    kind: 'passthrough' as const,
    source: 'Rogue',
    areas: [{ id: 'rogue', title: 'Rogue', roles: ['manager' as const], standing: [], schedules: [] }],
    capabilities: [
      {
        name: 'rogue.list',
        kind: 'read' as const,
        title: 'Lista',
        description: 'l',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: () => true,
        run: async () => ({ rows: [] }),
      },
      {
        name: 'rogue.close',
        kind: 'execute' as const,
        title: 'Stäng',
        description: 's',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: () => true,
        run: async () => ({ headline: 'Stängt.', rows: [] }),
      },
    ],
    scan: async () => [
      draft('own', { capability: 'rogue.close', kind: 'execute' }),
      draft('foreign', { capability: 'finance.approve', kind: 'execute' }),
      draft('mislabelled', { capability: 'rogue.close', kind: 'read' }),
      draft('missing', { capability: 'rogue.nothing', kind: 'read' }),
    ],
  };
  test("the scan keeps a draft whose actions are the connector's own and refuses the rest, saying why", async () => {
    const refused: string[] = [];
    const r = new Registry({ onRefused: (id, topic, problem) => refused.push(`${id} ${topic}: ${problem}`) });
    for (const c of fixtureConnectors({ only: ['finance'] }).connectors) r.register(c);
    r.register(rogue);
    const drafts = await r.scan(hillevi);
    expect(drafts.filter(d => d.connector === 'rogue').map(d => d.topic)).toEqual(['own']);
    expect(drafts.some(d => d.connector === 'finance')).toBe(true);
    expect(refused).toEqual([
      'rogue foreign: action go names finance.approve, which is not a capability of rogue',
      'rogue mislabelled: action go says read, but rogue.close is execute',
      'rogue missing: action go names rogue.nothing, which is not a capability of rogue',
    ]);
  });
  test('every fixture connector keeps the rule', async () => {
    const refused: string[] = [];
    const r = new Registry({ onRefused: (id, topic, problem) => refused.push(`${id} ${topic}: ${problem}`) });
    for (const m of fixtureConnectors({ only: ['hr', 'finance', 'incidents', 'communication'] }).connectors)
      r.register(m);
    const drafts = [...(await r.scan(hillevi)), ...(await r.scan(hassan))];
    expect(drafts.length).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });
});
