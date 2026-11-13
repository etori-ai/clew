import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  CapabilityError,
  Registry,
  actorOf,
  openGovernance,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { connectorCallback } from '../../apps/server/src/routes/connector-callback';
import { AssertionError, type CallbackGrant } from '../../apps/server/src/connectors/authority';

/**
 * `POST /api/connectors/call`, a remote connector calling back into Clew as the person it serves (D21), answers in the
 * published contract (`/api/connectors/call` in the connector OpenAPI document): a capability the person may not know
 * of exactly as one nobody registered, 404 `not-found` (D23); the scope and an execute 403 `denied`; input 400
 * `invalid`; a target that is down 503 `unavailable`. Only what is nobody's to know is logged, and answered 503. Run
 * over a real registry; the grant and the person are the test's.
 */
const persona = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
  groups: ['S-1-5-21-alla'],
} as AuthenticatedContext;
const shape = { type: 'object', properties: {}, additionalProperties: false } as never;
const capability = (name: string, kind: Capability['kind'], run: () => Promise<unknown>, roles?: ['manager']) =>
  ({
    name,
    kind,
    title: name,
    description: name,
    input: shape,
    output: { type: 'object' } as never,
    model: false,
    scope: roles ? { roles } : {},
    ...(kind === 'execute' ? { execution: { strategy: 'manual' } } : {}),
    run,
  }) as Capability;
const connector = (id: string, capabilities: Capability[], uses: string[] = []): Connector => ({
  id,
  kind: 'passthrough',
  source: id,
  areas: [],
  capabilities,
  uses,
});
const answers = async () => ({ ok: true });
const TARGETS = [
  'calendar.today',
  'calendar.managers',
  'calendar.book',
  'calendar.move',
  'calendar.off',
  'hr.read',
  'hr.close',
  'crm.read',
  'source.down',
  'source.denies',
  'source.refuses',
  'source.breaks',
  'nobody.read',
  'nobody.close',
];
function world() {
  const registry = new Registry();
  registry.register(connector('caller', [capability('caller.read', 'read', answers)], TARGETS));
  registry.register(
    connector('calendar', [
      capability('calendar.today', 'read', answers),
      capability('calendar.managers', 'read', answers, ['manager']),
      capability('calendar.book', 'propose', answers),
      capability('calendar.move', 'execute', answers),
      capability('calendar.off', 'read', answers),
    ]),
  );
  registry.register(
    connector('hr', [capability('hr.read', 'read', answers), capability('hr.close', 'execute', answers)]),
  );
  registry.register(connector('crm', [capability('crm.read', 'read', answers)]));
  registry.register(
    connector('source', [
      capability('source.down', 'read', async () => {
        throw new CapabilityError('Källan svarar inte just nu.', 'unavailable');
      }),
      capability('source.denies', 'read', async () => {
        throw new CapabilityError('Du saknar behörighet.', 'denied');
      }),
      // A refusal of Clew's own modules carries no code: the person's to read, as on /api/cap.
      capability('source.refuses', 'read', async () => {
        throw new CapabilityError('Avsnittet finns inte längre.');
      }),
      capability('source.breaks', 'read', async () => {
        throw new Error('connection reset');
      }),
    ]),
  );
  for (const id of ['caller', 'source']) registry.govern(id, openGovernance());
  registry.govern('calendar', { ...openGovernance(), capabilities: { 'calendar.off': { enabled: false } } });
  registry.govern('hr', { ...openGovernance(), state: 'disabled' });
  registry.govern('crm', { ...openGovernance(), audience: { mode: 'selected', groups: ['S-1-5-21-crm'] } });
  const grant = (chain: string[] = []): CallbackGrant => ({
    connectorId: 'caller',
    actor: actorOf(persona),
    uses: TARGETS,
    chain,
  });
  const failed: unknown[] = [];
  const routes = connectorCallback({
    verify: async token => {
      if (token === 'grant') return grant();
      if (token === 'circle') return grant(['calendar.today']);
      throw new AssertionError('Not a callback grant.');
    },
    person: async id => (id === persona.id ? persona : undefined),
    refresh: async () => {},
    registry,
    failed: error => failed.push(error),
  });
  /** Everything a connector could compare: the status, every header and the body as sent. */
  const call = async (name: string, input: unknown = {}, token = 'grant') => {
    const response = await routes.request('http://clew.test/call', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ name, input }),
    });
    return { status: response.status, headers: [...response.headers].sort(), body: await response.text() };
  };
  return { call, failed };
}
const answer = (status: number, code: string, message: string) => ({
  status,
  headers: [
    ['cache-control', 'no-store, private'],
    ['content-type', 'application/json;charset=utf-8'],
    ['x-content-type-options', 'nosniff'],
  ] as Array<[string, string]>,
  body: JSON.stringify({ error: { code, message } }),
});

describe('a connector calling back into Clew (POST /api/connectors/call)', () => {
  test('a target the person may not know of answers exactly as a name nobody registered: 404 not-found', async () => {
    const { call, failed } = world();
    const unknown = await call('nobody.read');
    expect(unknown).toEqual(answer(404, 'not-found', 'Okänd förmåga.'));
    // A connector switched off or leaving him out of its audience, its read or its execute, or a capability switched off.
    for (const name of ['hr.read', 'hr.close', 'crm.read', 'calendar.off'])
      expect([name, await call(name)]).toEqual([name, unknown]);
    expect(await call('nobody.close')).toEqual(unknown);
    expect(failed).toEqual([]);
  });
  test('the scope and an execute he may know of are 403 denied, input and a circle 400 invalid', async () => {
    const { call, failed } = world();
    expect(await call('calendar.managers')).toEqual(answer(403, 'denied', 'Du saknar behörighet för åtgärden.'));
    expect(await call('calendar.move')).toEqual(
      answer(403, 'denied', 'En anslutning kan inte utföra åtgärder i en annan anslutning.'),
    );
    expect(await call('calendar.today', { day: 'x' })).toEqual(
      answer(400, 'invalid', 'Ogiltig förfrågan till calendar.today.'),
    );
    expect(await call('calendar.today', {}, 'circle')).toEqual(
      answer(400, 'invalid', 'Anropet innehåller en cirkulär förfrågan.'),
    );
    expect(failed).toEqual([]);
  });
  test("a target's own answer keeps its code: down is 503, a refusal 403, and a refusal without a code 400", async () => {
    const { call, failed } = world();
    expect(await call('source.down')).toEqual(answer(503, 'unavailable', 'Källan svarar inte just nu.'));
    expect(await call('source.denies')).toEqual(answer(403, 'denied', 'Du saknar behörighet.'));
    expect(await call('source.refuses')).toEqual(answer(400, 'invalid', 'Avsnittet finns inte längre.'));
    expect(failed).toEqual([]);
  });
  test('what is nobody’s to know is logged and answered 503; a read and a proposal answer their output', async () => {
    const { call, failed } = world();
    expect(await call('source.breaks')).toEqual(answer(503, 'unavailable', 'Tjänsten går inte att nå just nu.'));
    expect(failed).toEqual([new Error('connection reset')]);
    for (const name of ['calendar.today', 'calendar.book'])
      expect(JSON.parse((await call(name)).body)).toEqual({ output: { ok: true } });
    // A name outside the grant's dependencies, and a bearer Clew did not issue, are refused before anything runs.
    expect((await call('caller.read')).status).toBe(403);
    expect((await call('calendar.today', {}, 'forged')).status).toBe(401);
    expect(failed).toHaveLength(1);
  });
});
