import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, EntityDetail, EntityKind } from '../../packages/contracts/src/index';
import { entityRoutes } from '../../apps/server/src/routes/entities';
import type { EntityUsecases } from '../../apps/server/src/modules/entities/usecases';

/**
 * The entities routes (D97) are thin: they parse the address, call one use case with the session's context and answer
 * what it returns. Whatever the reader may not reach answers the same 404 as an unknown address; a malformed source
 * name is a bad request. The use cases are stubbed here; `entities.test.ts` holds what they decide.
 */
const persona = { id: 'hillevi', name: 'Hillevi' } as AuthenticatedContext;
const detail = (key: string): EntityDetail => ({
  entity: { kind: 'person', key, sourceKey: 'anna.l', name: 'Anna' },
  relation: 'managed',
  actions: [],
  sections: [],
  cards: [],
});
function stack() {
  const calls: unknown[][] = [];
  const entities: Pick<EntityUsecases, 'list' | 'rows' | 'detail' | 'section'> = {
    list: async (p, kind) => {
      calls.push(['list', p.id, kind]);
      return { kind, groups: [], columns: [], lenses: [], actions: [], attention: [] };
    },
    rows: async (p, kind, capability) => {
      calls.push(['rows', p.id, kind, capability]);
      return capability === 'hr.absence' ? { capability, status: 'ok', rows: [] } : undefined;
    },
    detail: async (p, kind: EntityKind, key) => {
      calls.push(['detail', p.id, kind, key]);
      return key === 'nobody' ? undefined : detail(key);
    },
    section: async (p, kind, key, capability) => {
      calls.push(['section', p.id, kind, key, capability]);
      return key === 'nobody' ? undefined : { capability, status: 'timeout' };
    },
  };
  const routes = entityRoutes({
    entities,
    // The session guard's part: who is signed in. The real guard also checks the cookie.
    guard: async (c, next) => {
      c.set('session', { context: persona } as never);
      await next();
    },
  });
  // Served as `main.ts` mounts it under /api/entities; the paths below are the part after that.
  const get = (path: string) => routes.request('http://clew.test' + path);
  return { calls, get };
}

describe('the entities routes', () => {
  test('the list, the rows of one source, the opened entity and its section reach their use case', async () => {
    const { calls, get } = stack();
    expect((await get('/person')).status).toBe(200);
    expect(await (await get('/unit/rows?capability=hr.absence')).json()).toEqual({
      capability: 'hr.absence',
      status: 'ok',
      rows: [],
    });
    expect(await (await get('/person/anna.lindqvist%40kommun')).json()).toMatchObject({
      entity: { key: 'anna.lindqvist@kommun' },
    });
    expect(await (await get('/person/anna/section?capability=appraisals.round')).json()).toEqual({
      capability: 'appraisals.round',
      status: 'timeout',
    });
    expect(calls).toEqual([
      ['list', 'hillevi', 'person'],
      ['rows', 'hillevi', 'unit', 'hr.absence'],
      ['detail', 'hillevi', 'person', 'anna.lindqvist@kommun'],
      ['section', 'hillevi', 'person', 'anna', 'appraisals.round'],
    ]);
  });
  test('a kind Clew does not have, a key outside the rule and a source not theirs all answer the one 404', async () => {
    const { calls, get } = stack();
    for (const path of [
      '/room',
      '/room/rows?capability=hr.absence',
      '/room/anna',
      '/room/anna/section?capability=hr.absence',
      '/person/nobody',
      '/person/nobody/section?capability=hr.absence',
      '/person/rows?capability=hr.other',
    ]) {
      const answer = await get(path);
      expect([path, answer.status]).toEqual([path, 404]);
      expect(await answer.json()).toEqual({ error: 'Okänd adress.' });
      expect(answer.headers.get('cache-control')).toBe('no-store, private');
    }
    // The unknown kinds reached no use case.
    expect(calls.filter(c => c[2] === 'room')).toEqual([]);
  });
  test('a person called "rows" is opened when no source is named; a source name that is no name is a bad request', async () => {
    const { calls, get } = stack();
    expect(await (await get('/person/rows')).json()).toMatchObject({ entity: { key: 'rows' } });
    for (const path of ['/person/rows?capability=', '/person/anna/section', '/person/anna/section?capability=Hr x']) {
      const answer = await get(path);
      expect([path, answer.status]).toEqual([path, 400]);
      expect(await answer.json()).toEqual({ error: 'Ogiltig förfrågan.' });
    }
    expect(calls).toEqual([['detail', 'hillevi', 'person', 'rows']]);
  });
});
