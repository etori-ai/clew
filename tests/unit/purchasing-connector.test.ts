import { describe, expect, test } from 'bun:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Registry } from '../registry';
import { CapabilityError, type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector } from '../../connectors/purchasing/connector.mjs';
import { memoryState } from '../../connectors/purchasing/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The purchasing fixture connector over the protocol (D147): a system that answers only for the account in a token its
 * own authorization server issued. The tokens here are signed by a key of the test's own, standing for that server.
 */
const secret = 'test-secret-test-secret';
const T0 = new Date('2026-11-25T08:00:00+01:00');
const ISSUER = 'https://id.vendor.test/realms/vendor';
const RESOURCE = 'https://purchasing.vendor.test';
const keys = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const issuerJwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] };
/** An access token as the system's server signs it for an account. */
const tokenFor = (
  account: string,
  change: { issuer?: string; expires?: Date; typ?: string; key?: CryptoKey; kid?: string } = {},
) =>
  new SignJWT({ preferred_username: account, typ: change.typ ?? 'Bearer' })
    .setProtectedHeader({ alg: 'RS256', kid: change.kid ?? 'k1' })
    .setIssuer(change.issuer ?? ISSUER)
    .setSubject('sub-' + account)
    .setIssuedAt(T0)
    .setExpirationTime(change.expires ?? new Date(T0.getTime() + 300_000))
    .sign(change.key ?? keys.privateKey);
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const hassan: Actor = { ...hillevi, id: 'hassan', name: 'Hassan Ali', unitId: 'unit-omsorg', role: 'employee' };
type Rows = { rows: Array<{ ref: string; title: string; amount: string; status: string }> };
type Result = { headline: string; rows: Array<{ ref: string; outcome: string; detail: string }> };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const service = createConnector({
    jwks: testJwks,
    secret,
    state: memoryState(),
    clock: () => T0,
    resource: RESOURCE,
    issuer: ISSUER,
    issuerJwks,
    ...options,
  });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  /** The token Clew holds for each person's link; nobody in it has no link. */
  const linked = new Map<string, string>();
  const refused: string[] = [];
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(service.manifest, 'purchasing'), {
      url: 'http://purchasing',
      key: secret,
      assert: assertionFor('purchasing', secret),
      fetch: connectorFetch,
      linked: {
        async token(actor) {
          const token = linked.get(actor.id);
          if (!token) throw new CapabilityError('Systemet behöver ditt konto.', 'authorization-required');
          return token;
        },
        async refused(actor) {
          refused.push(actor.id);
        },
      },
    }),
  );
  return { service, registry, connectorFetch, linked, refused };
}
const code = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'answered',
    error => (error instanceof CapabilityError ? error.code : 'another error: ' + String(error)),
  );

describe('the purchasing fixture connector', () => {
  test('the manifest declares a linked account and passes the conformance check, which has no account to send', async () => {
    const { service, connectorFetch } = stack();
    expect(manifestProblems(service.manifest, 'purchasing')).toEqual([]);
    expect((service.manifest as { linkedAccount: unknown }).linkedAccount).toEqual({ resource: RESOURCE });
    const sign = (key: string) => assertionFor('purchasing', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://purchasing',
      id: 'purchasing',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('says who issues the tokens it takes, where Clew looks for it', async () => {
    const { connectorFetch } = stack();
    const answer = await connectorFetch('http://purchasing/.well-known/oauth-protected-resource');
    expect(await answer.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  test('answers for the account in the token: two approvers see different requests, and anyone else none', async () => {
    const w = stack();
    w.linked.set('hillevi', await tokenFor('hillevi'));
    w.linked.set('hassan', await tokenFor('hassan'));
    const hers = await w.registry.run<Rows>(hillevi, 'purchasing.requests', {});
    const his = await w.registry.run<Rows>(hassan, 'purchasing.requests', {});
    expect(hers.rows.map(r => r.ref)).toEqual([
      'purchasing:req:2026-0412',
      'purchasing:req:2026-0415',
      'purchasing:req:2026-0419',
    ]);
    expect(his.rows.map(r => r.ref)).toEqual(['purchasing:req:2026-0407', 'purchasing:req:2026-0421']);
    expect(hers.rows[0]).toMatchObject({ title: 'Läromedel till årskurs 4', status: 'Väntar på dig' });
    // The account is the token's, whoever Clew says is asking: an account with nothing waiting has an empty list.
    w.linked.set('hillevi', await tokenFor('sara.nystrom'));
    expect((await w.registry.run<Rows>(hillevi, 'purchasing.requests', {})).rows).toEqual([]);
  });

  test('takes no token but an access token its own server signed, and says authorization-required for the rest', async () => {
    const w = stack();
    for (const token of [
      await tokenFor('hillevi', { issuer: 'https://another.vendor.test' }),
      await tokenFor('hillevi', { expires: new Date(T0.getTime() - 1000) }),
      await tokenFor('hillevi', { key: other.privateKey }),
      await tokenFor('hillevi', { kid: 'unknown-key' }),
      await tokenFor('hillevi', { typ: 'ID' }),
      'not-a-token',
    ]) {
      w.linked.set('hillevi', token);
      expect(await code(w.registry.run(hillevi, 'purchasing.requests', {}))).toBe('authorization-required');
    }
    // Clew was told each time, so the link is counted as lost.
    expect(w.refused).toEqual(Array(6).fill('hillevi'));
    const scanned = await w.registry.scanOne(hillevi, 'purchasing');
    expect(scanned.observation?.completeness).toBe('authorization-required');
  });

  test('answers nothing for an account that is not the person Clew says is asking', async () => {
    const w = stack();
    w.linked.set('hillevi', await tokenFor('hassan'));
    const named: Actor = { ...hillevi, userName: 'hillevi' };
    expect(await code(w.registry.run(named, 'purchasing.requests', {}))).toBe('denied');
    // A refusal of the person, not of the token: the link is left as it is.
    expect(w.refused).toEqual([]);
  });

  test('a decision is written once, read back by its operation, and only for the approver’s own requests', async () => {
    const w = stack();
    w.linked.set('hillevi', await tokenFor('hillevi'));
    w.linked.set('hassan', await tokenFor('hassan'));
    const input = { refs: ['purchasing:req:2026-0412', 'purchasing:req:2026-0407'], decision: 'approve' };
    const decided = await w.registry.run<Result>(hillevi, 'purchasing.decide', input, { operationId: 'op-1' });
    expect(decided.headline).toBe('1 inköp godkända i inköpssystemet.');
    expect(decided.rows.map(r => [r.ref, r.outcome])).toEqual([
      ['purchasing:req:2026-0412', 'done'],
      // Hassan's request is not said to exist to Hillevi.
      ['purchasing:req:2026-0407', 'failed'],
    ]);
    expect(await w.registry.run<Result>(hillevi, 'purchasing.decide', input, { operationId: 'op-1' })).toEqual(decided);
    expect(await w.registry.run(hillevi, 'purchasing.lookup', { operationId: 'op-1' })).toEqual({
      found: true,
      result: decided,
    });
    expect(await w.registry.run(hassan, 'purchasing.lookup', { operationId: 'op-1' })).toEqual({ found: false });
    expect((await w.registry.run<Rows>(hillevi, 'purchasing.requests', {})).rows.map(r => r.ref)).toEqual([
      'purchasing:req:2026-0415',
      'purchasing:req:2026-0419',
    ]);
    expect((await w.registry.run<Rows>(hassan, 'purchasing.requests', {})).rows.length).toBe(2);
    const rejected = await w.registry.run<Result>(
      hassan,
      'purchasing.decide',
      { refs: ['purchasing:req:2026-0407'], decision: 'reject' },
      { operationId: 'op-2' },
    );
    expect(rejected.rows[0]).toMatchObject({ outcome: 'done', detail: 'avslaget i inköpssystemet' });
  });

  test('the scan raises one card with what waits for the account and the two decisions as its actions', async () => {
    const w = stack();
    w.linked.set('hillevi', await tokenFor('hillevi'));
    const scanned = await w.registry.scanOne(hillevi, 'purchasing');
    expect(scanned.observation?.completeness).toBe('complete');
    expect(scanned.drafts).toHaveLength(1);
    const [draft] = scanned.drafts as Array<{
      title: string;
      items: Array<{ ref: string }>;
      actions: Array<{ id: string; capability: string }>;
    }>;
    expect(draft!.title).toBe('Inköp att godkänna');
    expect(draft!.items.map(i => i.ref)).toHaveLength(3);
    expect(draft!.actions.map(a => [a.id, a.capability])).toEqual([
      ['approve', 'purchasing.decide'],
      ['reject', 'purchasing.decide'],
    ]);
    w.linked.set('hillevi', await tokenFor('sara.nystrom'));
    expect((await w.registry.scanOne(hillevi, 'purchasing')).drafts).toEqual([]);
  });

  test('a server whose keys cannot be read makes the system unavailable, which loses no link', async () => {
    const w = stack({
      issuerJwks: async () => {
        throw new Error('connection refused');
      },
    });
    w.linked.set('hillevi', await tokenFor('hillevi'));
    expect(await code(w.registry.run(hillevi, 'purchasing.requests', {}))).toBe('unavailable');
    expect(w.refused).toEqual([]);
  });
});
