import { describe, expect, test } from 'bun:test';
import { Registry, receipt, type Actor } from '../../packages/modules/src/index';
import { memoryState } from '../../packages/modules/src/memory-state';
import { heromaModule, rehabCandidates } from '../../packages/modules/src/mock/heroma';
import { raindanceModule } from '../../packages/modules/src/mock/raindance';
import { treservaModule } from '../../packages/modules/src/mock/treserva';
import { kommunikationModule } from '../../packages/modules/src/mock/kommunikation';

const hillevi: Actor = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' };
const registry = () => { const state = memoryState(); const r = new Registry(); for (const m of [heromaModule(state), raindanceModule(state), treservaModule(state), kommunikationModule(state)]) r.register(m); return { r, state }; };

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
