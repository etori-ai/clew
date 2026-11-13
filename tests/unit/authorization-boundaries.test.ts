import { describe, expect, test } from 'bun:test';
import {
  CapabilityError,
  Registry,
  openGovernance,
  type Actor,
  type Connector,
  actorOf,
} from '../../packages/connectors/src/index';
import { threadAccess } from '../../apps/server/src/threads/access';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { testAuthority } from '../connector-authority';
import { decodeJwt, generateKeyPair, exportPKCS8 } from 'jose';
import { connectorAuthority } from '../../apps/server/src/connectors/authority';
import { verifyAssertion } from '../../connectors/hello/verification.mjs';
import { sessionEntryPoints } from '../../apps/server/src/session-entry-points';

const actor: Actor & { authorizationVersion: string } = {
  authorizationVersion: 'v1',
  id: 'person',
  name: 'Person',
  role: 'manager',
  unitId: 'unit',
  unitLabel: 'Unit',
};
const shape = (properties: Record<string, object>) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }) as never;
const connector = (id = 'source', run: () => Promise<unknown> = async () => ({ count: 1 })): Connector => ({
  id,
  kind: 'passthrough',
  source: 'Källa',
  areas: [],
  capabilities: [
    {
      name: id + '.count',
      kind: 'read',
      title: 'Antal',
      description: 'Antal',
      model: true,
      scope: {},
      input: shape({}),
      output: shape({ count: { type: 'integer' } }),
      run,
    },
  ],
});

describe('authorization and invocation boundaries', () => {
  test('duplicate capability names reject the entire registration', () => {
    const registry = new Registry(),
      duplicate = connector();
    duplicate.capabilities.push(duplicate.capabilities[0]!);
    expect(() => registry.register(duplicate)).toThrow('already registered');
    expect(registry.connector('source')).toBeUndefined();
    expect(registry.find('source.count')).toBeUndefined();
  });
  test('rotation verifies in-flight callback grants with retained public keys and signs only with the new key', async () => {
    const old = await testAuthority();
    const keys = await generateKeyPair('RS256', { extractable: true });
    const next = await connectorAuthority(await exportPKCS8(keys.privateKey), 'rotated', old.jwks.keys);
    const previousRequest = await old.assert('hello', actor, ['source.count']);
    expect(await next.verify(decodeJwt(previousRequest).callback as string)).toMatchObject({ actor: actorOf(actor) });
    const request = await next.assert('hello', actor);
    expect(verifyAssertion(request, next.jwks, 'hello')).toEqual(actorOf(actor));
    expect(verifyAssertion(request, old.jwks, 'hello')).toBeNull();
    expect(JSON.stringify(next.jwks)).not.toContain('"d":');
  });
  test('registration without governance is denied on reads, tools and scans', async () => {
    const registry = new Registry().register(connector());
    expect(registry.visible(actor, 'source')).toBe(false);
    expect(registry.tools(actor)).toEqual([]);
    expect(await registry.scan(actor)).toEqual([]);
    await expect(registry.run(actor, 'source.count', {})).rejects.toThrow('Okänd förmåga.');
    registry.govern('source', openGovernance());
    expect(await registry.run(actor, 'source.count', {})).toEqual({ count: 1 });
  });
  test('nested calls enforce dependencies, schema and current origin governance', async () => {
    const registry = new Registry().register(connector()).register({ ...connector('caller'), uses: ['source.count'] });
    for (const id of ['source', 'caller']) registry.govern(id, openGovernance());
    const call = registry.clewFor(actor, {}, 'caller').call;
    expect(await call('source.count', {})).toEqual({ count: 1 });
    await expect(call('caller.count', {})).rejects.toThrow('Okänd förmåga.');
    registry.govern('caller', { ...openGovernance(), state: 'disabled' });
    await expect(call('source.count', {})).rejects.toThrow('Okänd förmåga.');
  });
  test('a nested call to an execute the person may not know of answers as a name nobody registered (D23)', async () => {
    const withExecute = (id: string): Connector => ({
      ...connector(id),
      capabilities: [
        {
          name: id + '.close',
          kind: 'execute',
          title: 'Stäng',
          description: 'Stäng',
          model: false,
          scope: {},
          execution: { strategy: 'manual' },
          input: shape({}),
          output: shape({}),
          run: async () => ({ headline: 'Stängt', rows: [] }),
        },
      ],
    });
    const registry = new Registry()
      .register({ ...connector('caller'), uses: ['hidden.close', 'open.close', 'nobody.close'] })
      .register(withExecute('hidden'))
      .register(withExecute('open'));
    registry.govern('caller', openGovernance());
    registry.govern('open', openGovernance());
    // Its audience leaves the person, a manager, out.
    registry.govern('hidden', { ...openGovernance(), audience: { mode: 'selected', roles: ['employee'] } });
    const call = registry.clewFor(actor, {}, 'caller').call;
    const refusal = (name: string) =>
      call(name, {}).then(
        () => undefined,
        (error: CapabilityError) => ({ name: error.name, message: error.message, code: error.code }),
      );
    const unknown = await refusal('nobody.close');
    expect(unknown).toEqual({ name: 'CapabilityError', message: 'Okänd förmåga.', code: 'not-found' });
    expect(await refusal('hidden.close')).toEqual(unknown);
    // An execute of a connector the person can see is refused as an execute; switched off, it is unknown too.
    expect(await refusal('open.close')).toEqual({
      name: 'CapabilityError',
      message: 'En anslutning kan inte utföra åtgärder i en annan anslutning.',
      code: 'denied',
    });
    registry.govern('open', { ...openGovernance(), capabilities: { 'open.close': { enabled: false } } });
    expect(await refusal('open.close')).toEqual(unknown);
  });
  test('a nested call refuses an execute on the lookup it runs: one that comes into view between two reads runs nothing', async () => {
    const paid: string[] = [];
    const finance: Connector = {
      ...connector('finance'),
      capabilities: [
        {
          name: 'finance.pay',
          kind: 'execute',
          title: 'Betala',
          description: 'Betala',
          model: false,
          scope: {},
          execution: { strategy: 'manual' },
          input: shape({}),
          output: { type: 'object' } as never,
          run: async () => {
            paid.push('finance.pay');
            return { headline: 'Betalt', rows: [] };
          },
        },
      ],
    };
    // How an administrator can bring the execute into view: what stands at the nested call's own read of the
    // governance, and what stands from the next read on, the one before the call would run.
    const ways: Array<[how: string, before: (registry: Registry) => void, after: (registry: Registry) => void]> = [
      [
        'switched on',
        r => r.register(finance).govern('finance', { ...openGovernance(), state: 'disabled' }),
        r => r.govern('finance', openGovernance()),
      ],
      [
        'its audience widened',
        r =>
          r
            .register(finance)
            .govern('finance', { ...openGovernance(), audience: { mode: 'selected', roles: ['employee'] } }),
        r => r.govern('finance', openGovernance()),
      ],
      [
        'the capability switched on',
        r =>
          r
            .register(finance)
            .govern('finance', { ...openGovernance(), capabilities: { 'finance.pay': { enabled: false } } }),
        r => r.govern('finance', openGovernance()),
      ],
      ['registered', () => {}, r => r.register(finance).govern('finance', openGovernance())],
    ];
    for (const [how, before, after] of ways) {
      const registry = new Registry().register({ ...connector('caller'), uses: ['finance.pay'] });
      registry.govern('caller', openGovernance());
      before(registry);
      let reads = 0;
      registry.setRefresh(async () => {
        if (++reads === 2) after(registry);
      });
      const answer = await registry
        .clewFor(actor, {}, 'caller')
        .call('finance.pay', {})
        .then(
          output => ({ output }),
          (error: CapabilityError) => ({ message: error.message, code: error.code }),
        );
      expect([how, answer]).toEqual([
        how,
        { message: 'En anslutning kan inte utföra åtgärder i en annan anslutning.', code: 'denied' },
      ]);
    }
    expect(paid).toEqual([]);
  });
  test('output validation rejects bad data, and replacement replaces compiled input schemas', async () => {
    const registry = new Registry()
      .register(connector('source', async () => ({ count: '1' })))
      .govern('source', openGovernance());
    await expect(registry.run(actor, 'source.count', {})).rejects.toThrow('Källans svar kunde inte verifieras.');
    const next = connector();
    next.capabilities[0]!.input = shape({ key: { type: 'string' } });
    registry.replace(next);
    await expect(registry.run(actor, 'source.count', {})).rejects.toThrow('Ogiltig förfrågan');
    expect(await registry.run(actor, 'source.count', { key: 'x' })).toEqual({ count: 1 });
  });
  test('a replacement may reuse schema ids without retaining the old validator', async () => {
    const first = connector();
    first.capabilities[0]!.input = Object.assign(shape({}), { $id: 'urn:source:input' });
    const registry = new Registry().register(first).govern('source', openGovernance());
    const next = connector();
    next.capabilities[0]!.input = Object.assign(shape({ key: { type: 'string' } }), { $id: 'urn:source:input' });
    registry.replace(next);
    await expect(registry.run(actor, 'source.count', {})).rejects.toThrow('Ogiltig förfrågan');
    expect(await registry.run(actor, 'source.count', { key: 'x' })).toEqual({ count: 1 });
  });
  test('revocation during a source call prevents releasing its result', async () => {
    const registry = new Registry();
    registry
      .register(
        connector('source', async () => {
          registry.govern('source', { ...openGovernance(), state: 'disabled' });
          return { count: 1 };
        }),
      )
      .govern('source', openGovernance());
    await expect(registry.run(actor, 'source.count', {})).rejects.toThrow('Okänd förmåga.');
  });
  test('a failed authoritative governance refresh fails closed', async () => {
    let effects = 0;
    const registry = new Registry()
      .register(
        connector('source', async () => {
          effects++;
          return { count: 1 };
        }),
      )
      .govern('source', openGovernance());
    registry.setRefresh(async () => {
      throw new Error('database unavailable');
    });
    await expect(registry.run(actor, 'source.count', {})).rejects.toThrow('database unavailable');
    expect(effects).toBe(0);
  });
  test('disabled cards and generated history cannot be read through the shared reader', async () => {
    const registry = new Registry().register(connector()).govern('source', openGovernance());
    const store = memoryThreadStore(),
      at = '2026-11-05T09:00:00Z';
    await store.transaction(async tx => {
      for (const kind of ['pushed', 'question'] as const) {
        await tx.insertThread({
          id: kind,
          personId: actor.id,
          sourceAuthorization: actor.authorizationVersion,
          kind,
          topic: kind,
          title: 'Restricted',
          summary: 'Restricted',
          state: 'open',
          connector: 'source',
          area: 'source',
          week: null,
          actions: [],
          items: [],
          waitingOn: null,
          deadline: null,
          trigger: { source: 'Source', reason: 'Test', at },
          createdAt: at,
          updatedAt: at,
        });
        await tx.addMessage(kind, {
          role: 'assistant',
          body: 'Restricted',
          at,
          meta: {
            access: {
              connectors: ['source'],
              capabilities: ['source.count'],
              authorizationVersion: actor.authorizationVersion,
            },
          },
        });
      }
    });
    const access = threadAccess(store, registry);
    expect(await access.list(actor, at)).toHaveLength(2);
    registry.govern('source', { ...openGovernance(), state: 'disabled' });
    expect(await access.list(actor, at)).toEqual([]);
    expect(await access.read(actor, 'pushed')).toBeUndefined();
    expect(await access.read(actor, 'question')).toBeUndefined();
    expect(await store.readThread(actor.id, 'question')).toBeDefined();
  });
  test('public keys verify requests but cannot turn request tokens into callback grants', async () => {
    const authority = await testAuthority();
    const request = await authority.assert('hello', actor, ['source.count']);
    expect(verifyAssertion(request, authority.jwks, 'hello')).toEqual(actorOf(actor));
    expect(verifyAssertion(request, authority.jwks, 'other')).toBeNull();
    expect(verifyAssertion(request, authority.jwks, 'hello', Date.now() + 121_000)).toBeNull();
    await expect(authority.verify(request)).rejects.toThrow();
    const grant = await authority.verify(decodeJwt(request).callback as string);
    expect(grant.uses).toEqual(['source.count']);
    expect(JSON.stringify(authority.jwks)).not.toContain('"d":');
    const withSessionFields = {
      ...actor,
      sessionBinding: 'must-not-leave-clew',
      authorize: async () => ({ version: 'v1' }),
    };
    expect(decodeJwt(await authority.assert('hello', withSessionFields)).actor).toEqual(actorOf(actor));
  });
  test("the person's user name is signed into the actor when they have one; a callback grant verifies with it and without it (D44, D97)", async () => {
    const authority = await testAuthority();
    const named = { ...actor, userName: 'person.one' };
    expect(actorOf(named)).toEqual({ ...actorOf(actor), userName: 'person.one' });
    const request = await authority.assert('hello', named, ['source.count']);
    expect(decodeJwt(request).actor).toEqual(actorOf(named));
    expect(verifyAssertion(request, authority.jwks, 'hello')).toEqual(actorOf(named));
    expect((await authority.verify(decodeJwt(request).callback as string)).actor).toEqual(actorOf(named));
    const plain = await authority.assert('hello', actor, ['source.count']);
    expect(decodeJwt(plain).actor).not.toHaveProperty('userName');
    expect((await authority.verify(decodeJwt(plain).callback as string)).actor).toEqual(actorOf(actor));
    // An empty user name is no user name: neither cut into the actor nor signed.
    expect(actorOf({ ...actor, userName: '' })).not.toHaveProperty('userName');
    expect(decodeJwt(await authority.assert('hello', { ...actor, userName: '' })).actor).toEqual(actorOf(actor));
  });
  test('a relation to people by grant (D121) leaves Clew in no actor and no assertion, and turns no administration on', async () => {
    const authority = await testAuthority();
    const registrar = { ...actor, relationGrants: ['registrar' as const] };
    expect(actorOf(registrar)).toEqual(actorOf(actor));
    const request = await authority.assert('hello', registrar, ['source.count']);
    expect(JSON.stringify(decodeJwt(request))).not.toContain('registrar');
    expect(JSON.stringify(await authority.verify(decodeJwt(request).callback as string))).not.toContain('registrar');
    // What the session tells the browser to draw: the search, never Administration (D118).
    expect(sessionEntryPoints({ capabilities: [], relationGrants: ['registrar'] })).toEqual({
      admin: false,
      capabilities: [],
      relations: ['registrar'],
    });
    expect(sessionEntryPoints({ capabilities: ['admin.users', 'registrar', 'calendar:plan'] })).toEqual({
      admin: true,
      capabilities: ['admin.users'],
      relations: [],
    });
  });
});
