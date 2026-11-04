import { describe, expect, test } from 'bun:test';
import { Registry, type Actor, type ExecuteResult } from '../../packages/modules/src/index';
import { memoryState } from '../../packages/modules/src/memory-state';
import { mockSupportManagement } from '../../packages/errands/src/mock-support-management';
import { supportManagementFixtures } from '../../packages/errands/src/support-management-fixtures';
import type { ErrandProvider } from '../../packages/errands/src/model';
import { errandModule } from '../../apps/server/src/errand-module';

const hillevi: Actor = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };
const hassan: Actor = { ...hillevi, id: 'hassan', name: 'Hassan Ali', role: 'employee' };
const setup = () => {
  const state = memoryState(), provider = mockSupportManagement(state), module = errandModule(provider);
  return { state, provider, module, registry: new Registry().register(module) };
};

describe('SupportManagement-shaped errands through Clew\'s contract', () => {
  test('each person sees assigned and reported errands through explicit source identity bindings', async () => {
    const { provider } = setup();
    expect((await provider.mine(hillevi)).map(e => e.errandNumber)).toEqual(['KC-26110001']);
    expect((await provider.reported(hillevi)).map(e => e.errandNumber)).toEqual(['KC-26110002']);
    expect((await provider.mine(hassan)).map(e => e.errandNumber)).toEqual(['KC-26110003']);
    expect((await provider.reported(hassan)).map(e => e.errandNumber)).toEqual(['KC-26110004']);
    expect(await provider.mine({ ...hillevi, unitId: 'another-unit' })).toEqual([]);
    expect(await provider.reported({ ...hillevi, id: 'unmapped' })).toEqual([]);
  });

  test('foreign refs and foreign events cannot read or change another person\'s errand', async () => {
    const { provider, state } = setup();
    const [own] = await provider.mine(hassan), [foreign] = await provider.mine(hillevi);
    expect(own).toBeDefined(); expect(foreign).toBeDefined();
    expect(await provider.access(hassan, foreign!.ref)).toEqual({ read: false, acknowledge: false });
    await expect(provider.get(hassan, foreign!.ref)).rejects.toThrow(/tillgängligt/);
    await expect(provider.acknowledge(hassan, foreign!.ref, foreign!.unreadEvents.map(e => e.id))).rejects.toThrow();
    await expect(provider.acknowledge(hassan, own!.ref, [own!.unreadEvents[0]!.id, foreign!.unreadEvents[0]!.id])).rejects.toThrow();
    expect(state.dump()).toEqual({});
  });

  test('labels, phase history, opaque revision and a task deadline are mapped from the source', async () => {
    const { provider } = setup();
    const [e] = await provider.mine(hillevi);
    expect(e).toMatchObject({
      status: { code: 'ONGOING', label: 'Pågående', closed: false }, phase: 'Handläggning', version: '3', relationships: ['handler'],
      deadlines: [{ label: 'Utredning', dueAt: '2026-11-06T15:00:00+01:00' }],
    });
    expect(e!.deadlines[0]!.ref).toContain(':investigation:');
    const [waiting] = await provider.reported(hillevi);
    expect(waiting!.deadlines).toEqual([]);
    expect(waiting!.suspendedUntil).toBe('2026-11-10T09:00:00+01:00');
  });

  test('source free text appears only in the live detail view, never in scans, lists or model tools', async () => {
    const { provider, registry } = setup();
    const safe = JSON.stringify([
      await registry.scan(hillevi), await registry.scan(hassan),
      await registry.run(hillevi, 'errand.mine', {}), await registry.run(hassan, 'errand.reported', {}),
    ]);
    for (const f of supportManagementFixtures) {
      expect(safe).not.toContain(f.errand.title);
      expect(safe).not.toContain(f.errand.description);
      for (const c of f.communication) expect(safe).not.toContain(c.message);
    }
    const [e] = await provider.mine(hillevi);
    const detail = await registry.run<{ title: string; description: string }>(hillevi, 'errand.view', { ref: e!.ref });
    expect(detail.title).toBe(supportManagementFixtures[0]!.errand.title);
    expect(detail.description).toContain('Exempeldata');
    expect(registry.tools(hillevi).map(t => t.name)).toEqual(['errand.mine', 'errand.reported']);
  });

  test('both roles can browse; scans distinguish an unread event from a waiting reported errand', async () => {
    const { registry } = setup();
    for (const actor of [hillevi, hassan]) {
      expect((await registry.areas(actor)).find(a => a.id === 'arenden')?.standing.map(s => s.capability)).toEqual(['errand.mine', 'errand.reported']);
      for (const d of await registry.scan(actor)) for (const a of d.actions) expect(registry.find(a.capability)).toBeDefined();
    }
    const waiting = (await registry.scan(hillevi)).find(d => !!d.waitingOn);
    expect(waiting?.actions.map(a => a.kind)).toEqual(['read']);
    expect(waiting?.deadline).toBeNull();
    expect((await registry.scan(hassan)).filter(d => !d.waitingOn)).toHaveLength(2);
  });

  test('reading an event survives adapter recreation, clears that event card and leaves the errand unchanged', async () => {
    const { state, provider, registry } = setup();
    const [e] = await provider.mine(hassan);
    const draft = (await registry.scan(hassan)).find(d => d.items?.some(i => i.ref === e!.ref));
    const action = draft!.actions.find(a => a.kind === 'execute')!;
    const result = await registry.run<ExecuteResult>(hassan, action.capability, action.input);
    expect(result.rows[0]?.outcome).toBe('done');
    expect(result.headline).toContain('samma status');
    const after = await mockSupportManagement(state).get(hassan, e!.ref);
    expect(after.status).toEqual(e!.status); expect(after.version).toBe(e!.version); expect(after.unreadEvents).toEqual([]);
    expect((await registry.scan(hassan)).some(d => d.topic === draft!.topic)).toBe(false);
    expect((await provider.mine(hillevi))[0]!.unreadEvents).toHaveLength(1);
    expect(Object.values(state.dump())).toEqual([true]);
    await registry.run(hassan, action.capability, action.input);
    expect(Object.values(state.dump())).toEqual([true]);
  });

  test('an acknowledgement without read-back returns an explicit unknown receipt', async () => {
    const { provider } = setup();
    const [e] = await provider.mine(hassan);
    const unavailable: ErrandProvider = { ...provider, get: async () => { throw new Error('Source unavailable'); } };
    const registry = new Registry().register(errandModule(unavailable));
    const result = await registry.run<ExecuteResult>(hassan, 'errand.acknowledge', { ref: e!.ref, eventIds: e!.unreadEvents.map(event => event.id) });
    expect(result.rows[0]?.outcome).toBe('unknown');
    expect(result.headline).toContain('kunde inte kontrolleras');
  });

  test('a later event remains actionable after the previous event was read', async () => {
    const { provider, registry } = setup();
    const [e] = await provider.mine(hassan);
    const previous = (await registry.scan(hassan)).find(d => d.items?.some(i => i.ref === e!.ref))!;
    await provider.acknowledge(hassan, e!.ref, e!.unreadEvents.map(event => event.id));
    const next: ErrandProvider = {
      ...provider,
      mine: async actor => (await provider.mine(actor)).map(item => ({
        ...item, unreadEvents: [{ id: 'next-event', label: 'Nytt meddelande', at: '2026-11-05T08:00:00+01:00' }],
      })),
    };
    const followUp = (await new Registry().register(errandModule(next)).scan(hassan)).find(d => d.items?.some(i => i.ref === e!.ref))!;
    expect(followUp.topic).not.toBe(previous.topic);
    expect(followUp.actions.find(a => a.kind === 'execute')?.input?.eventIds).toEqual(['next-event']);
  });
});
