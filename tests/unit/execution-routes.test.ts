import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { executionRoutes, type ExecutionRouteDeps } from '../../apps/server/src/routes/executions';

/**
 * The human decision endpoint (`/api/executions`, D45, D47): an execute capability the person may run is approved as
 * them, anything else is "Okänd förmåga.", and a compensation is refused before anything is approved (DE-L5), since an
 * undo is made from its own item, whose receipt it replaces. The registry and the ledger are stubbed here.
 */
const persona = { id: 'hillevi', name: 'Hillevi Berg' } as AuthenticatedContext;
const world = () => {
  const approved: unknown[] = [];
  const deps: ExecutionRouteDeps = {
    registry: {
      allowed: (_actor, name) =>
        (name === 'calendar.cancelEvent'
          ? { capability: { kind: 'execute' } }
          : name === 'calendar.events'
            ? { capability: { kind: 'read' } }
            : undefined) as never,
    },
    executions: {
      approve: async (_p, input) => {
        approved.push(input);
        return { id: 'execution-1', state: 'pending' } as never;
      },
      read: async (_p, id) => (id === 'execution-1' ? ({ id, state: 'pending' } as never) : undefined),
      reconcile: async (_p, id) => ({ id, state: 'running' }) as never,
    },
    guard: async (c, next) => {
      c.set('session', { context: persona } as never);
      await next();
    },
  };
  const routes = executionRoutes(deps);
  const post = (path: string, body: unknown) =>
    routes.request('http://clew.test' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { routes, approved, post };
};

describe('the human decision endpoint', () => {
  test('an execute the person may run is approved as them and answered 202', async () => {
    const w = world();
    const response = await w.post('/', { decisionId: 'd-1', operation: 'calendar.cancelEvent', payload: { id: 'e' } });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: 'execution-1', state: 'pending' });
    expect(w.approved).toEqual([{ decisionId: 'd-1', operation: 'calendar.cancelEvent', payload: { id: 'e' } }]);
  });
  test('a compensation is refused with nothing approved: an effect is undone from its own item (DE-L5)', async () => {
    const w = world();
    const response = await w.post('/', {
      decisionId: 'undo:execution-1',
      operation: 'calendar.cancelEvent',
      payload: { id: 'e' },
      compensates: 'execution-1',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Ett beslut ångras från sitt ärende.' });
    expect(w.approved).toEqual([]);
  });
  test('a read, an unknown name and a body outside the schema are refused with nothing approved', async () => {
    const w = world();
    for (const [body, error] of [
      [{ decisionId: 'd-2', operation: 'calendar.events', payload: {} }, 'Okänd förmåga.'],
      [{ decisionId: 'd-3', operation: 'nobody.knows', payload: {} }, 'Okänd förmåga.'],
      [{ decisionId: 'd-4', operation: 'calendar.cancelEvent', payload: {}, extra: true }, 'Ogiltig förfrågan.'],
    ] as const) {
      const response = await w.post('/', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: error });
    }
    expect(w.approved).toEqual([]);
  });
  test('a decision is read back, and one the person cannot read is not found', async () => {
    const w = world();
    expect(await (await w.routes.request('http://clew.test/execution-1')).json()).toEqual({
      id: 'execution-1',
      state: 'pending',
    });
    const missing = await w.routes.request('http://clew.test/execution-2');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Åtgärden finns inte.' });
    const checked = await w.post('/execution-1/reconcile', {});
    expect(checked.status).toBe(202);
  });
});
