import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { receipt, type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as financeManifest } from '../../connectors/finance/connector.mjs';
import { memoryState } from '../../connectors/finance/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/** The finance fixture connector over the protocol: the invoice card, attest row by row with one unknown, undo, read-back. */
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
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
};
const stranger: Actor = {
  id: 'karin',
  name: 'Karin Holm',
  unitId: 'enhet-17',
  unitLabel: 'Hemtjänst Norr',
  role: 'manager',
};
type Result = {
  rows: Array<{ ref: string; outcome: string }>;
  undoCapability?: string;
  undoMinutes?: number;
  headline: string;
};

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const state = memoryState();
  const service = createConnector({ jwks: testJwks, secret, state, clock: () => T0, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(financeManifest, 'finance'), {
      url: 'http://finance',
      key: secret,
      assert: assertionFor('finance', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch, state };
}

describe('the finance fixture connector', () => {
  test('the manifest is valid and passes the conformance check', async () => {
    expect(manifestProblems(financeManifest, 'finance')).toEqual([]);
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('finance', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://finance',
      id: 'finance',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
  test('the scan gives the manager one card with the invoices as items, the ones matching an order preselected', async () => {
    const { registry } = stack();
    const [draft] = await registry.scan(hillevi);
    expect(draft!.topic).toBe('finance:invoices');
    expect(draft!.title).toMatch(/^Attestera 3 fakturor, 37\s050\skr$/);
    expect(draft!.deadline).toBe('2026-11-05');
    expect(draft!.items!.map(i => i.selected)).toEqual([true, true, false]);
    expect(draft!.actions.map(a => [a.capability, a.role])).toEqual([
      ['finance.approve', 'primary'],
      ['finance.open', 'secondary'],
    ]);
    expect(await registry.scan(hassan)).toEqual([]);
    expect(await registry.scan(stranger)).toEqual([]);
    await expect(registry.run(hassan, 'finance.invoices', {})).rejects.toThrow(/behörighet/);
    expect(await registry.run(stranger, 'finance.invoices', {})).toEqual({ rows: [] });
  });
  test('the figure and the budget detail say where the cost centre stands', async () => {
    const { registry } = stack();
    const [budget] = await registry.areas(hillevi);
    expect(budget!.figure).toEqual({ label: '-1,9 % · vikarier −710 tkr', tone: 'alert' });
    expect(await registry.run(hillevi, 'finance.budget', {})).toMatchObject({
      label: 'Kostnadsställe KS-4410',
      deviationPct: -1.9,
    });
    expect((await registry.areas(stranger))[0]!.figure).toBeNull();
  });
  test('attest answers row by row with one unknown, once per operation id, undoable and read back', async () => {
    const { registry, state } = stack();
    const refs = ['finance:inv:55120', 'finance:inv:55121', 'finance:inv:55140'];
    const result = await registry.run<Result>(hillevi, 'finance.approve', { refs }, { operationId: 'op-1' });
    expect(result.rows.map(r => r.outcome)).toEqual(['done', 'done', 'unknown']);
    expect(result.headline).toBe('2 fakturor attesterade, 1 väntar på svar.');
    expect(receipt(result as never).undoUntil).not.toBeNull();
    expect(await registry.run<Result>(hillevi, 'finance.approve', { refs }, { operationId: 'op-1' })).toEqual(result);
    expect(await registry.run(hillevi, 'finance.lookup', { operationId: 'op-1' })).toEqual({ found: true, result });
    expect(Object.keys(state.get<Record<string, string>>('approved'))).toEqual([
      'finance:inv:55120',
      'finance:inv:55121',
    ]);
    expect((await registry.scan(hillevi))[0]!.items).toHaveLength(1);
    await registry.run(hillevi, 'finance.unapprove', { refs });
    expect((await registry.scan(hillevi))[0]!.items).toHaveLength(3);
  });
  test('the card asks for a review one invoice at a time, and the preview draws the invoice for its own cost centre only (D70)', async () => {
    const { registry } = stack();
    const [draft] = await registry.scan(hillevi);
    expect(draft!.actions[0]).toMatchObject({ id: 'approve', review: 'each', preview: 'finance.preview' });
    const out = await registry.run<{ title: string; mediaType: string; data: string }>(hillevi, 'finance.preview', {
      ref: 'finance:inv:55120',
    });
    expect(out.title).toBe('Faktura 55120 · Skolgrossisten');
    expect(out.mediaType).toBe('image/svg+xml');
    const svg = Buffer.from(out.data, 'base64').toString();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Läromedel matematik åk 4–6, 24 ex');
    expect(svg).toMatch(/Att betala.*11\s200\skr/s);
    expect(svg).not.toContain('<script');
    await expect(registry.run(stranger, 'finance.preview', { ref: 'finance:inv:55120' })).rejects.toThrow(/finns inte/);
    await expect(registry.run(hassan, 'finance.preview', { ref: 'finance:inv:55120' })).rejects.toThrow(/behörighet/);
  });
  test('the fault switches: conflict writes nothing, a crash after the commit is found by the lookup', async () => {
    const conflict = await stack({ fault: 'conflict' }).registry.run<Result>(hillevi, 'finance.approve', {
      refs: ['finance:inv:55120'],
    });
    expect(conflict.rows[0]!.outcome).toBe('failed');
    const crashing = stack({ fault: 'crash-after-commit' });
    await expect(
      crashing.registry.run(hillevi, 'finance.approve', { refs: ['finance:inv:55120'] }, { operationId: 'op-9' }),
    ).rejects.toThrow(/svarar inte/);
    expect(await crashing.registry.run(hillevi, 'finance.lookup', { operationId: 'op-9' })).toMatchObject({
      found: true,
    });
    await expect(stack({ fault: 'unavailable' }).registry.scan(hillevi)).rejects.toThrow(/svarar inte/);
  });
});
