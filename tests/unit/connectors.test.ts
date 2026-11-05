import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { receipt, type Actor } from '../../packages/connectors/src/index';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { heromaConnector, rehabCandidates } from '../../packages/connectors/src/mock/heroma';
import { raindanceConnector } from '../../packages/connectors/src/mock/raindance';
import { treservaConnector } from '../../packages/connectors/src/mock/treserva';
import { kommunikationConnector } from '../../packages/connectors/src/mock/kommunikation';

const hillevi: Actor = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' };
const registry = () => { const state = memoryState(); const r = new Registry(); for (const m of [heromaConnector(state), raindanceConnector(state), treservaConnector(state), kommunikationConnector(state)]) r.register(m); return { r, state }; };

describe('registry', () => {
  test('refuses an execute capability exposed as a tool (D8)', () => {
    const r = new Registry();
    expect(() => r.register({ id: 'x', kind: 'core', source: 'x', areas: [], capabilities: [{ name: 'x.go', kind: 'execute', title: 'g', description: 'g', input: {} as never, output: {} as never, model: true, scope: () => true, run: async () => ({}) }] })).toThrow(/D8/);
  });
  test('checks scope on every call, whatever the path', async () => {
    const { r } = registry();
    await expect(r.run(hassan, 'raindance.invoices', {})).rejects.toThrow(/behörighet/);
    await expect(r.run(hillevi, 'raindance.invoices', {})).resolves.toMatchObject({ rows: expect.any(Array) });
  });
  test('derives tools only from model-exposed read and propose capabilities in scope', () => {
    const { r } = registry();
    const names = r.tools(hillevi).map(t => t.name);
    expect(names).toContain('heroma.absenceOverview');
    expect(names).not.toContain('raindance.approve');
    expect(r.tools(hassan).map(t => t.name)).not.toContain('heroma.absenceOverview');
  });
  test('areas follow the role and carry figures and standing actions', async () => {
    const { r } = registry();
    const manager = await r.areas(hillevi), employee = await r.areas(hassan);
    expect(manager.map(a => a.id)).toEqual(['medarbetare', 'budget', 'arbetsmiljo', 'viktigt-nu']);
    expect(employee.map(a => a.id)).toEqual(['mitt-pass', 'viktigt-nu']);
    expect(manager[0]!.figure?.label).toMatch(/Frånvaro/);
    expect(manager[0]!.standing.map(s => s.capability)).toContain('heroma.whoIsOn');
    // The icon a connector names for its area (D41) comes with the area, for the button under the box.
    expect(manager.map(a => a.icon)).toEqual(['people', 'chart', 'document', 'bell']);
  });
});
describe('mock scans push threads a person can act on, and the state survives in the store', () => {
  test('heroma finds the rehab candidate and the pending leave requests', async () => {
    expect(rehabCandidates('unit-skola', '2026-11-03').map(c => c.employee.name)).toEqual(['Anna Lindqvist']);
    const { r } = registry();
    const drafts = await r.scan(hillevi);
    const topics = drafts.map(d => d.topic);
    expect(topics).toContain('heroma:rehab:heroma:emp:1001');
    expect(topics.filter(t => t.startsWith('heroma:leave:'))).toHaveLength(2);
    expect(topics).toContain('raindance:invoices');
    expect(drafts.find(d => d.topic.startsWith('treserva:dev:'))?.waitingOn).toMatch(/skyddsombud/);
    for (const d of drafts) for (const a of d.actions) expect(r.find(a.capability)).toBeDefined();
    expect(drafts.filter(d => d.actions.filter(a => a.role === 'primary').length > 1)).toHaveLength(0);
  });
  test('approving invoices answers row by row, with one unknown, and is undoable', async () => {
    const { r, state } = registry();
    const [draft] = (await r.scan(hillevi)).filter(d => d.topic.startsWith('raindance:'));
    const refs = draft!.items!.map(i => i.ref);
    const result = await r.run<{ rows: { outcome: string }[]; undoCapability?: string }>(hillevi, 'raindance.approve', { refs });
    expect(result.rows.map(x => x.outcome)).toEqual(['done', 'done', 'unknown']);
    expect(receipt(result as never).undoUntil).not.toBeNull();
    expect((await r.scan(hillevi)).filter(d => d.topic.startsWith('raindance:'))[0]!.items).toHaveLength(1);
    await r.run(hillevi, 'raindance.unapprove', { refs });
    expect((await r.scan(hillevi)).filter(d => d.topic.startsWith('raindance:'))[0]!.items).toHaveLength(3);
    expect(Object.keys(state.dump())).toContain('raindance:approved');
  });
  test('an employee sees the delegation and the waiting leave, never the manager cards', async () => {
    const { r } = registry();
    const drafts = await r.scan(hassan);
    expect(drafts.map(d => d.area)).not.toContain('medarbetare');
    expect(drafts.find(d => d.topic.startsWith('heroma:delegation:'))?.actions[0]?.capability).toBe('heroma.renewDelegation');
    expect(drafts.find(d => d.topic.startsWith('heroma:leave-waiting:'))?.waitingOn).toBe('din chef');
    await r.run(hassan, 'heroma.renewDelegation', { refs: ['heroma:deleg:301'] });
    expect((await r.scan(hassan)).some(d => d.topic.startsWith('heroma:delegation:'))).toBe(false);
  });
  test('a read receipt clears the notice for that person only', async () => {
    const { r } = registry();
    await r.run(hassan, 'kommunikation.acknowledge', { refs: ['komm:notice:2026-44-1'] });
    expect((await r.scan(hassan)).some(d => d.topic.startsWith('komm:'))).toBe(false);
    expect((await r.scan(hillevi)).some(d => d.topic.startsWith('komm:'))).toBe(true);
  });
});

describe('connectors reach each other only through the registry (D20)', () => {
  const composite = (r: Registry) => r.register({ id: 'comp', kind: 'derived', source: 'Sammansatt', areas: [], capabilities: [
    { name: 'comp.invoiceCount', kind: 'read', title: 'Antal fakturor', description: 'x', input: {} as never, output: {} as never, model: true, scope: {},
      run: async (_actor, _input, clew) => ({ count: (await clew.call<{ rows: unknown[] }>('raindance.invoices')).rows.length }) },
    { name: 'comp.tryExecute', kind: 'read', title: 'x', description: 'x', input: {} as never, output: {} as never, model: false, scope: { roles: ['manager'] },
      run: async (_actor, _input, clew) => clew.call('raindance.approve', { refs: [] }) },
  ] });
  test('the other connector\'s scope applies to the same actor', async () => {
    const { r } = registry(); composite(r);
    expect(await r.run(hillevi, 'comp.invoiceCount', {})).toMatchObject({ count: expect.any(Number) });
    await expect(r.run(hassan, 'comp.invoiceCount', {})).rejects.toThrow(/behörighet/);
  });
  test('a connector can never execute in another connector', async () => {
    const { r } = registry(); composite(r);
    await expect(r.run(hillevi, 'comp.tryExecute', {})).rejects.toThrow(/annan anslutning/);
  });
  test('declarative scope: no roles means everyone, roles narrow', () => {
    const { r } = registry(); composite(r);
    expect(r.tools(hassan).map(t => t.name)).toContain('comp.invoiceCount');
    expect(r.tools(hillevi).some(t => t.name === 'comp.tryExecute')).toBe(false);
  });
});

describe('the registry changes without a restart (D23)', () => {
  test('replace swaps a connector and its capabilities; unregister removes them', async () => {
    const { r } = registry();
    const names = () => r.list().map(c => c.id);
    expect(r.unregister('nope')).toBe(false);
    r.replace({ id: 'heroma', kind: 'passthrough', source: 'Heroma 2', areas: [], capabilities: [{ name: 'heroma.ping', kind: 'read', title: 'x', description: 'x', input: {} as never, output: {} as never, model: false, scope: {}, run: async () => 'pong' }] });
    expect(r.find('heroma.whoIsOn')).toBeUndefined();
    expect(await r.run(hassan, 'heroma.ping', {})).toBe('pong');
    expect(r.unregister('heroma')).toBe(true);
    expect(names()).not.toContain('heroma');
    expect(r.find('heroma.ping')).toBeUndefined();
  });
});

describe('governance: an administrator decides who sees a connector (D23)', () => {
  const hassanIt = { ...hassan, unitId: 'unit-it' };
  test('outside the audience a connector does not exist: no area, no tool, no capability, and a call reads like an unknown capability', async () => {
    const { r } = registry();
    r.govern('raindance', { state: 'enabled', audience: { mode: 'selected', roles: ['manager'] }, scanEnabled: true, toolsEnabled: true, capabilities: {} });
    expect(r.visible(hillevi, 'raindance')).toBe(true);
    expect(r.visible(hassan, 'raindance')).toBe(false);
    expect((await r.areas(hassan)).some(a => a.connector === 'raindance')).toBe(false);
    expect(r.tools(hassan).some(t => t.name.startsWith('raindance.'))).toBe(false);
    expect(r.capabilitiesFor(hassan).some(c => c.connector.id === 'raindance')).toBe(false);
    expect(r.listFor(hassan).map(c => c.id)).not.toContain('raindance');
    await expect(r.run(hassan, 'raindance.budget', {})).rejects.toThrow('Okänd förmåga.');
    await expect(r.run(hassan, 'raindance.nope', {})).rejects.toThrow('Okänd förmåga.');
    expect((await r.scan(hassan)).some(d => d.connector === 'raindance')).toBe(false);
    expect(r.listFor(hillevi).map(c => c.id)).toContain('raindance');
  });
  test('a unit in the audience is enough; the connector\'s own scope still applies on top', async () => {
    const { r } = registry();
    r.govern('heroma', { state: 'enabled', audience: { mode: 'selected', units: ['unit-it'] }, scanEnabled: true, toolsEnabled: true, capabilities: {} });
    expect(r.visible(hassan, 'heroma')).toBe(false);
    expect(r.visible(hassanIt, 'heroma')).toBe(true);
    await expect(r.run(hassanIt, 'heroma.absenceOverview', {})).rejects.toThrow(/behörighet/);
  });
  test('disabled or draft hides the connector from everyone; enabling it again brings it back without re-registering', async () => {
    const { r } = registry();
    const g = { audience: { mode: 'all' as const }, scanEnabled: true, toolsEnabled: true, capabilities: {} };
    r.govern('heroma', { ...g, state: 'disabled' });
    expect(r.visible(hillevi, 'heroma')).toBe(false);
    await expect(r.run(hillevi, 'heroma.whoIsOn', {})).rejects.toThrow('Okänd förmåga.');
    r.govern('heroma', { ...g, state: 'enabled' });
    expect(r.visible(hillevi, 'heroma')).toBe(true);
    expect(r.connector('heroma')?.source).toBe('Heroma');
  });
  test('a switched-off capability leaves standing actions, tools and run; a tool switch only removes the tool; the scan switch stops the cards', async () => {
    const { r } = registry();
    const before = r.tools(hillevi).map(t => t.name);
    expect(before).toContain('heroma.whoIsOn');
    r.govern('heroma', { state: 'enabled', audience: { mode: 'all' }, scanEnabled: false, toolsEnabled: true, capabilities: { 'heroma.whoIsOn': { enabled: false }, 'heroma.absenceOverview': { model: false } } });
    expect(r.tools(hillevi).map(t => t.name)).not.toContain('heroma.whoIsOn');
    expect(r.tools(hillevi).map(t => t.name)).not.toContain('heroma.absenceOverview');
    await expect(r.run(hillevi, 'heroma.whoIsOn', {})).rejects.toThrow('Okänd förmåga.');
    expect(await r.run(hillevi, 'heroma.absenceOverview', {})).toMatchObject({ rows: expect.any(Array) });
    expect((await r.areas(hillevi)).flatMap(a => a.standing.map(s => s.capability))).not.toContain('heroma.whoIsOn');
    expect((await r.scan(hillevi)).some(d => d.connector === 'heroma')).toBe(false);
    r.govern('heroma', { state: 'enabled', audience: { mode: 'all' }, scanEnabled: true, toolsEnabled: false, capabilities: {} });
    expect(r.tools(hillevi).some(t => t.name.startsWith('heroma.'))).toBe(false);
    expect(await r.run(hillevi, 'heroma.whoIsOn', {})).toMatchObject({ date: expect.any(String) });
  });
  test('governance survives a replace and is forgotten on unregister; missing governance denies access', () => {
    const { r } = registry();
    r.govern('heroma', { state: 'disabled', audience: { mode: 'all' }, scanEnabled: true, toolsEnabled: true, capabilities: {} });
    r.replace({ id: 'heroma', kind: 'passthrough', source: 'Heroma 2', areas: [], capabilities: [] });
    expect(r.governance('heroma').state).toBe('disabled');
    r.unregister('heroma');
    expect(r.governance('heroma').state).toBe('disabled');
    expect(r.visible(hillevi, 'heroma')).toBe(false);
    expect(r.visible(hillevi, 'raindance')).toBe(true);
  });
});

describe('a card is one system\'s: its actions name the pushing connector\'s capabilities, with their own kinds (D35)', () => {
  const item = { ref: 'rogue:1', label: 'Ärende 1', detail: '', selectable: true, selected: true };
  const draft = (topic: string, action: { capability: string; kind: 'read' | 'propose' | 'execute' }) =>
    ({ topic, area: 'rogue', title: topic, summary: topic, reason: 'test', items: [item], actions: [{ id: 'go', label: 'Kör', role: 'primary' as const, usesItems: true, ...action }] });
  const rogue = {
    id: 'rogue', kind: 'passthrough' as const, source: 'Rogue', areas: [{ id: 'rogue', title: 'Rogue', roles: ['manager' as const], standing: [], schedules: [] }],
    capabilities: [
      { name: 'rogue.list', kind: 'read' as const, title: 'Lista', description: 'l', input: {} as never, output: {} as never, model: false, scope: () => true, run: async () => ({ rows: [] }) },
      { name: 'rogue.close', kind: 'execute' as const, title: 'Stäng', description: 's', input: {} as never, output: {} as never, model: false, scope: () => true, run: async () => ({ headline: 'Stängt.', rows: [] }) },
    ],
    scan: async () => [
      draft('own', { capability: 'rogue.close', kind: 'execute' }),
      draft('foreign', { capability: 'raindance.approve', kind: 'execute' }),
      draft('mislabelled', { capability: 'rogue.close', kind: 'read' }),
      draft('missing', { capability: 'rogue.nothing', kind: 'read' }),
    ],
  };
  test('the scan keeps a draft whose actions are the connector\'s own and refuses the rest, saying why', async () => {
    const refused: string[] = [];
    const r = new Registry({ onRefused: (id, topic, problem) => refused.push(`${id} ${topic}: ${problem}`) });
    r.register(raindanceConnector(memoryState())).register(rogue);
    const drafts = await r.scan(hillevi);
    expect(drafts.filter(d => d.connector === 'rogue').map(d => d.topic)).toEqual(['own']);
    expect(drafts.some(d => d.connector === 'raindance')).toBe(true);
    expect(refused).toEqual([
      'rogue foreign: action go names raindance.approve, which is not a capability of rogue',
      'rogue mislabelled: action go says read, but rogue.close is execute',
      'rogue missing: action go names rogue.nothing, which is not a capability of rogue',
    ]);
  });
  test('every bundled mock connector already keeps the rule', async () => {
    const refused: string[] = [];
    const state = memoryState(), r = new Registry({ onRefused: (id, topic, problem) => refused.push(`${id} ${topic}: ${problem}`) });
    for (const m of [heromaConnector(state), raindanceConnector(state), treservaConnector(state), kommunikationConnector(state)]) r.register(m);
    const drafts = [...await r.scan(hillevi), ...await r.scan(hassan)];
    expect(drafts.length).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });
});
