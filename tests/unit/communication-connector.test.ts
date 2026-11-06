import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as communicationManifest } from '../../connectors/communication/connector.mjs';
import { memoryState } from '../../connectors/communication/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/** The communication fixture connector over the protocol: the notice that needs a receipt, the receipt per person, read-back. */
const secret = 'test-secret-test-secret';
const T0 = new Date('2026-11-04T08:00:00+01:00');
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
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
type Rows = { rows: Array<{ ref: string; acknowledged: boolean }> };
type Result = { rows: Array<{ ref: string; outcome: string; detail: string }> };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const service = createConnector({ jwks: testJwks, secret, state: memoryState(), clock: () => T0, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(communicationManifest, 'communication'), {
      url: 'http://communication',
      key: secret,
      assert: assertionFor('communication', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch };
}

describe('the communication fixture connector', () => {
  test('the manifest is valid and passes the conformance check', async () => {
    expect(manifestProblems(communicationManifest, 'communication')).toEqual([]);
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('communication', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://communication',
      id: 'communication',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
  test('a notice that requires a receipt is a card for everyone until that person has read it', async () => {
    const { registry } = stack();
    const [draft] = await registry.scan(hassan);
    expect(draft).toMatchObject({ topic: 'communication:communication:notice:2026-44-1', area: 'important-now' });
    expect(draft!.reason).toBe('Publicerat 2026-11-03 06:30 · läskvitto krävs');
    const result = await registry.run<Result>(
      hassan,
      'communication.acknowledge',
      { refs: ['communication:notice:2026-44-1'] },
      { operationId: 'op-1' },
    );
    expect(result.rows[0]).toMatchObject({ outcome: 'done', detail: 'kvitterat 08:00' });
    expect(await registry.scan(hassan)).toEqual([]);
    expect((await registry.scan(hillevi)).map(d => d.topic)).toEqual(['communication:communication:notice:2026-44-1']);
    expect((await registry.run<Rows>(hassan, 'communication.notices', {})).rows.map(r => r.acknowledged)).toEqual([
      true,
      false,
    ]);
    expect((await registry.run<Rows>(hillevi, 'communication.notices', {})).rows.map(r => r.acknowledged)).toEqual([
      false,
      false,
    ]);
    expect(await registry.run(hassan, 'communication.lookup', { operationId: 'op-1' })).toEqual({
      found: true,
      result,
    });
    expect(await registry.run(hillevi, 'communication.lookup', { operationId: 'op-1' })).toEqual({ found: false });
  });
  test('the person map decides whose receipt it is, and a crash after the commit is found by the lookup', async () => {
    const mapped = stack({ personMap: { karin: 'hassan' } });
    await mapped.registry.run(hassan, 'communication.acknowledge', { refs: ['communication:notice:2026-44-1'] });
    expect(await mapped.registry.scan({ ...hassan, id: 'karin' })).toEqual([]);
    const crashing = stack({ fault: 'crash-after-commit' });
    await expect(
      crashing.registry.run(
        hassan,
        'communication.acknowledge',
        { refs: ['communication:notice:2026-44-1'] },
        { operationId: 'op-9' },
      ),
    ).rejects.toThrow(/svarar inte/);
    expect(await crashing.registry.run(hassan, 'communication.lookup', { operationId: 'op-9' })).toMatchObject({
      found: true,
    });
    expect(await crashing.registry.scan(hassan)).toEqual([]);
  });
});
