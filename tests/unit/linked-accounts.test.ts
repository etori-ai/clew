import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '@clew/contracts';
import { manifestProblems } from '../../packages/connectors/src/remote';
import { manifest as hello } from '../../connectors/hello/connector.mjs';
import { memoryLinkStore } from '../../apps/server/src/modules/linked-accounts/adapters/memory';
import { oauthAdapter } from '../../apps/server/src/modules/linked-accounts/adapters/oauth';
import {
  LinkRefusedError,
  LinkRequiredError,
  LinkUnavailableError,
} from '../../apps/server/src/modules/linked-accounts/contracts';
import { clientChoice, localPath } from '../../apps/server/src/modules/linked-accounts/domain';
import {
  GrantRefused,
  type AuthorizationServer,
  type ConnectorLinks,
  type OAuthClient,
} from '../../apps/server/src/modules/linked-accounts/ports';
import {
  LINK_SYSTEM_ACTOR,
  linkedAccountLeavers,
  linkedAccountUsecases,
} from '../../apps/server/src/modules/linked-accounts/usecases';
import {
  authorizationServer,
  type AuthorizationServerOptions,
  type MemoryAuthorizationServer,
} from '../authorization-server';

/**
 * Linked accounts (D147), end to end below the routes: the use cases over the memory store and the real OAuth adapter,
 * which runs openid-client against an authorization server in memory (`tests/authorization-server.ts`). Each scenario
 * asserts the audit rows it leaves, and that no row carries a token.
 */
const REDIRECT = 'https://clew.example.test/api/linked-accounts/callback';
const T = '2026-11-25T08:00:00.000Z';
const SUBJECT = 'linked-account:hr';
const persona = (id: string): AuthenticatedContext => ({
  id,
  name: 'Namn Namnsson',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
  organisationId: 'test',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'session-' + id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const anna = persona('anna');
const bo = persona('bo');
/** The server as an administrator approved it: what its metadata says, or what was typed for one that has none. */
const approved = (vendor: MemoryAuthorizationServer): AuthorizationServer => ({
  issuer: vendor.issuer,
  authorizationEndpoint: vendor.endpoints.authorize,
  tokenEndpoint: vendor.endpoints.token,
  revocationEndpoint: vendor.kind === 'modern' ? vendor.endpoints.revoke : null,
  registrationEndpoint: vendor.kind === 'modern' ? vendor.endpoints.register : null,
  pkce: vendor.kind === 'modern',
  issuerOnReturn: vendor.kind === 'modern',
  clientDocuments: false,
});

function world(options: AuthorizationServerOptions & { client?: OAuthClient | null } = {}) {
  let now = Date.parse(T);
  const vendor = authorizationServer(options);
  /** Which server answers an address; a test replaces it to move the system to another authorization server. */
  const routing = { to: (_url: string): MemoryAuthorizationServer => vendor };
  const store = memoryLinkStore();
  /** What each connector's approved manifest declares. */
  const declared = new Map([['hr', { resource: vendor.resource, scopes: ['leave'] }]]);
  // An administrator has approved the server already, as most scenarios find it. The store runs its transactions in
  // the order they were asked for, so this write is in before a scenario's first.
  void store.transaction(tx =>
    tx.approve('hr', {
      resource: vendor.resource,
      server: approved(vendor),
      origin: vendor.kind === 'modern' ? 'discovered' : 'entered',
      client: options.client ?? null,
      approvedBy: 'Mikael Lund',
      approvedAt: T,
    }),
  );
  /** The people a connector's audience leaves out. */
  const outside = new Set<string>();
  const connectors: ConnectorLinks = {
    declared: async id => declared.get(id) ?? null,
    reaches: async (who, id) => declared.has(id) && !outside.has(who.id),
  };
  const logged: string[] = [];
  const links = linkedAccountUsecases({
    store,
    connectors,
    oauth: oauthAdapter({ clientName: 'Clew', fetch: (url, init) => routing.to(url).fetch(url, init) }),
    clock: () => new Date(now),
    redirectUri: REDIRECT,
    clientDocumentUrl: null,
    log: message => logged.push(message),
  });
  return {
    vendor,
    routing,
    store,
    declared,
    outside,
    links,
    logged,
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
    /** The whole of linking: the person leaves for the system, consents there as `account` and returns. */
    link: async (who: AuthenticatedContext, account = 'account-' + who.id) => {
      const { url } = await links.begin(who, 'hr', '/todo');
      return links.complete(who, await vendor.consent(url, account));
    },
    rows: () => store.audit.map(a => [a.actor, a.action, a.subject, a.details]),
    actions: () => store.audit.map(a => a.action),
    held: (personId: string) => store.transaction(tx => tx.link(personId, 'hr')),
  };
}
/** Why a use case refused, or what else happened. */
const refusal = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'resolved',
    error => (error instanceof LinkRefusedError ? error.reason : 'another error: ' + String(error)),
  );
const required = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'resolved',
    error => (error instanceof LinkRequiredError ? error.reason : 'another error: ' + String(error)),
  );

describe('linking an account', () => {
  test('a person leaves for the system, consents and returns linked, and a call then carries their token', async () => {
    const w = world();
    const { url } = await w.links.begin(anna, 'hr', '/todo?tab=mine');
    const asked = new URL(url);
    expect(asked.origin + asked.pathname).toBe(w.vendor.endpoints.authorize);
    // Clew registered itself, without a secret, since this server says it checks PKCE.
    expect(w.vendor.clientIds()).toEqual([asked.searchParams.get('client_id')!]);
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: 'leave',
      resource: w.vendor.resource,
      code_challenge_method: 'S256',
    });
    expect(asked.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Nothing about the person has changed yet: the authorization waits, for ten minutes, with where they came from.
    expect(w.store.pending()).toEqual([
      {
        state: asked.searchParams.get('state')!,
        verifier: expect.any(String),
        personId: 'anna',
        connectorId: 'hr',
        issuer: w.vendor.issuer,
        returnTo: '/todo?tab=mine',
        expiresAt: '2026-11-25T08:10:00.000Z',
      },
    ]);
    expect(await w.links.list(anna)).toEqual([]);
    const verifier = w.store.pending()[0]!.verifier;

    const done = await w.links.complete(anna, await w.vendor.consent(url, 'account-anna'));
    expect(done).toEqual({ connectorId: 'hr', returnTo: '/todo?tab=mine', linked: true });
    expect(w.store.pending()).toEqual([]);
    // The code was redeemed with the verifier, for the system the token is for.
    expect(w.vendor.grants[0]!.get('code_verifier')).toBe(verifier);
    expect(w.vendor.grants[0]!.get('resource')).toBe(w.vendor.resource);

    const token = await w.links.tokenFor('anna', 'hr');
    expect(w.vendor.accepts(token)).toBe('account-anna');
    expect(await w.links.list(anna)).toEqual([
      { connectorId: 'hr', state: 'linked', issuer: w.vendor.issuer, linkedAt: T },
    ]);
    expect(await w.links.list(bo)).toEqual([]);
    expect(w.rows()).toEqual([
      ['person:anna', 'account.client-registered', SUBJECT, { connector: 'hr', issuer: w.vendor.issuer }],
      [
        'person:anna',
        'account.linked',
        SUBJECT,
        { connector: 'hr', issuer: w.vendor.issuer, person: 'anna', scopes: ['leave'] },
      ],
    ]);
    // No audit row carries a token, and the list a person is shown has none.
    const held = (await w.held('anna'))!;
    for (const secret of [token, held.refreshToken!]) {
      expect(JSON.stringify(w.store.audit)).not.toContain(secret);
      expect(JSON.stringify(await w.links.list(anna))).not.toContain(secret);
    }
  });

  test('the second person links through the client the first one registered', async () => {
    const w = world();
    await w.link(anna);
    await w.link(bo);
    expect(w.vendor.clientIds().length).toBe(1);
    expect(w.actions()).toEqual(['account.client-registered', 'account.linked', 'account.linked']);
    expect(w.vendor.accepts(await w.links.tokenFor('anna', 'hr'))).toBe('account-anna');
    expect(w.vendor.accepts(await w.links.tokenFor('bo', 'hr'))).toBe('account-bo');
  });

  test('a return is used once, only by the person who left, and only for ten minutes', async () => {
    const w = world();
    const first = await w.vendor.consent((await w.links.begin(anna, 'hr')).url);
    expect((await w.links.complete(anna, first)).linked).toBe(true);
    expect(await refusal(w.links.complete(anna, first))).toBe('state-unknown');

    // Another person's session at the return links nobody, and the state is spent.
    const second = await w.vendor.consent((await w.links.begin(bo, 'hr')).url, 'account-bo');
    expect(await refusal(w.links.complete(anna, second))).toBe('another-person');
    expect(await refusal(w.links.complete(bo, second))).toBe('state-unknown');
    expect(await w.links.list(bo)).toEqual([]);

    const late = await w.vendor.consent((await w.links.begin(bo, 'hr')).url, 'account-bo');
    w.advance(600);
    expect(await refusal(w.links.complete(bo, late))).toBe('state-expired');
    // An authorization nobody returned from is removed the next time somebody starts one.
    await w.links.begin(bo, 'hr');
    w.advance(601);
    await w.links.begin(anna, 'hr');
    expect(w.store.pending().map(p => p.personId)).toEqual(['anna']);

    expect(await refusal(w.links.complete(bo, REDIRECT + '?code=code-x&state=never-started'))).toBe('state-unknown');
    expect(await refusal(w.links.complete(bo, REDIRECT + '?code=code-x'))).toBe('state-unknown');
    expect(await refusal(w.links.complete(bo, 'not an address'))).toBe('state-unknown');
    expect(w.actions()).toEqual(['account.client-registered', 'account.linked']);
  });

  test('a person who declines at the system is returned to where they were, linked to nothing', async () => {
    const w = world();
    const { url } = await w.links.begin(anna, 'hr', '/calendar');
    const done = await w.links.complete(anna, await w.vendor.consent(url, 'account-anna', { decline: true }));
    expect(done).toEqual({ connectorId: 'hr', returnTo: '/calendar', linked: false });
    expect(await w.links.list(anna)).toEqual([]);
    expect(await required(w.links.tokenFor('anna', 'hr'))).toBe('not-linked');
    expect(w.actions()).toEqual(['account.client-registered']);
  });

  test('a return that names another issuer than the one asked is refused', async () => {
    const w = world();
    const { url } = await w.links.begin(anna, 'hr');
    const mixedUp = await w.vendor.consent(url, 'account-anna', { issuer: 'https://another.vendor.test' });
    expect(await refusal(w.links.complete(anna, mixedUp))).toBe('code-refused');
    expect(await w.links.list(anna)).toEqual([]);
    // The code never reached the token endpoint.
    expect(w.vendor.grants).toEqual([]);
  });

  test('a connector outside the person’s audience reads as one that does not exist', async () => {
    const w = world();
    w.outside.add('bo');
    const outside = await w.links.begin(bo, 'hr').catch(error => error);
    const missing = await w.links.begin(bo, 'payroll').catch(error => error);
    expect(outside).toBeInstanceOf(LinkRefusedError);
    expect([outside.reason, outside.message]).toEqual([missing.reason, missing.message]);
    expect(outside.reason).toBe('unknown-connector');
    expect(w.vendor.requests).toEqual([]);
    expect(w.store.pending()).toEqual([]);
  });

  test('the server metadata is found where a server that began with OpenID Connect serves it', async () => {
    const w = world({ issuer: 'https://id.vendor.test/realms/vendor', metadataAt: 'appended' });
    expect((await w.link(anna)).linked).toBe(true);
    expect(w.vendor.requests.slice(0, 3)).toEqual([
      'GET https://hr.vendor.test/.well-known/oauth-protected-resource',
      'GET https://id.vendor.test/.well-known/oauth-authorization-server/realms/vendor',
      'GET https://id.vendor.test/realms/vendor/.well-known/oauth-authorization-server',
    ]);
  });
});

describe('a call with a linked account', () => {
  test('the stored token is sent until a minute before its end, then refreshed, and a rotated refresh token is kept', async () => {
    const w = world({ lifetime: 3600 });
    await w.link(anna);
    const first = await w.links.tokenFor('anna', 'hr');
    w.advance(3539);
    expect(await w.links.tokenFor('anna', 'hr')).toBe(first);
    expect(w.vendor.grants.length).toBe(1);

    w.advance(2);
    const second = await w.links.tokenFor('anna', 'hr');
    expect(second).not.toBe(first);
    expect(w.vendor.accepts(second)).toBe('account-anna');
    expect(w.vendor.grants[1]!.get('grant_type')).toBe('refresh_token');
    const spent = w.vendor.grants[1]!.get('refresh_token');

    // The server ended the refresh token it was given; the next refresh spends the one it answered with.
    w.advance(3600);
    await w.links.tokenFor('anna', 'hr');
    expect(w.vendor.grants[2]!.get('refresh_token')).not.toBe(spent);
    expect((await w.held('anna'))!.expiresAt).toBe(
      new Date(Date.parse(T) + (3539 + 2 + 3600 + 3600) * 1000).toISOString(),
    );
    // A refresh is no act of a person or an administrator and writes no audit row.
    expect(w.actions()).toEqual(['account.client-registered', 'account.linked']);
  });

  test('two calls at once refresh once: the second reads the token the first got', async () => {
    const w = world();
    await w.link(anna);
    w.advance(3600);
    const [one, two] = await Promise.all([w.links.tokenFor('anna', 'hr'), w.links.tokenFor('anna', 'hr')]);
    expect(one).toBe(two);
    expect(w.vendor.grants.filter(g => g.get('grant_type') === 'refresh_token').length).toBe(1);
  });

  test('a link the system took away is lost: nothing more is sent, and linking again restores it', async () => {
    const w = world();
    await w.link(anna);
    w.advance(3600);
    w.vendor.removeAccount('account-anna');
    const error = await w.links.tokenFor('anna', 'hr').catch(e => e);
    expect(error).toBeInstanceOf(LinkRequiredError);
    expect([error.connectorId, error.reason]).toEqual(['hr', 'invalid_grant']);
    expect(await w.held('anna')).toMatchObject({
      state: 'needs-link',
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      lastError: 'invalid_grant',
    });
    expect((await w.links.list(anna))[0]!.state).toBe('needs-link');
    expect(w.rows().at(-1)).toEqual([
      LINK_SYSTEM_ACTOR,
      'account.link-lost',
      SUBJECT,
      { connector: 'hr', issuer: w.vendor.issuer, person: 'anna', reason: 'invalid_grant' },
    ]);
    // Asked again, Clew does not call the authorization server and writes no second row.
    const asked = w.vendor.requests.length;
    expect(await required(w.links.tokenFor('anna', 'hr'))).toBe('invalid_grant');
    expect(w.vendor.requests.length).toBe(asked);
    expect(w.actions().filter(a => a === 'account.link-lost').length).toBe(1);

    expect((await w.link(anna)).linked).toBe(true);
    expect(w.vendor.accepts(await w.links.tokenFor('anna', 'hr'))).toBe('account-anna');
    expect(await w.held('anna')).toMatchObject({ state: 'linked', lastError: null });
  });

  test('an authorization server that is down or busy keeps the link, and the call says the source is unavailable', async () => {
    const w = world();
    await w.link(anna);
    w.advance(3600);
    for (const down of [503, 429]) {
      w.vendor.failing = down;
      const error = await w.links.tokenFor('anna', 'hr').catch(e => e);
      expect(error).toBeInstanceOf(LinkUnavailableError);
      expect(error.code).toBe('source-unavailable');
    }
    w.vendor.failing = null;
    w.vendor.refusing = 'temporarily_unavailable';
    expect(await w.links.tokenFor('anna', 'hr').catch(e => e)).toBeInstanceOf(LinkUnavailableError);
    expect((await w.held('anna'))!.state).toBe('linked');
    expect(w.actions()).toEqual(['account.client-registered', 'account.linked']);
    expect(w.logged).toContain('A linked account could not be refreshed');

    w.vendor.refusing = null;
    expect(w.vendor.accepts(await w.links.tokenFor('anna', 'hr'))).toBe('account-anna');
  });

  test('a token the system would not take loses the link, unless it has been refreshed since', async () => {
    const w = world();
    await w.link(anna);
    const older = await w.links.tokenFor('anna', 'hr');
    w.advance(3600);
    const newer = await w.links.tokenFor('anna', 'hr');
    await w.links.refused('anna', 'hr', older);
    expect((await w.held('anna'))!.state).toBe('linked');

    await w.links.refused('anna', 'hr', newer);
    expect(await required(w.links.tokenFor('anna', 'hr'))).toBe('refused-by-system');
    expect(w.rows().at(-1)).toEqual([
      LINK_SYSTEM_ACTOR,
      'account.link-lost',
      SUBJECT,
      { connector: 'hr', issuer: w.vendor.issuer, person: 'anna', reason: 'refused-by-system' },
    ]);
  });
});

describe('a system that names another authorization server', () => {
  test('sends nobody anywhere until an administrator approves it, and the links to the old one are then not used', async () => {
    const w = world();
    await w.link(anna);
    const token = await w.links.tokenFor('anna', 'hr');
    // The system's own document now names another server, which answers for itself.
    const moved = authorizationServer({ issuer: 'https://new.vendor.test', resource: w.vendor.resource });
    w.routing.to = url =>
      url.startsWith(moved.issuer) || url.includes('/.well-known/oauth-protected-resource') ? moved : w.vendor;
    expect(await refusal(w.links.begin(bo, 'hr'))).toBe('issuer-changed');
    expect(w.store.pending()).toEqual([]);
    expect(moved.clientIds()).toEqual([]);
    // Until then the link an administrator did approve is used as before.
    expect(await w.links.tokenFor('anna', 'hr')).toBe(token);

    // An administrator approves again: the server the system names now.
    expect((await w.links.approveAsOperator('hr')).issuer).toBe(moved.issuer);
    expect(await required(w.links.tokenFor('anna', 'hr'))).toBe('issuer-changed');
    expect(w.rows().at(-1)).toEqual([
      LINK_SYSTEM_ACTOR,
      'account.link-lost',
      SUBJECT,
      { connector: 'hr', issuer: w.vendor.issuer, person: 'anna', reason: 'issuer-changed' },
    ]);
    // A person links again, now at the approved server.
    const { url } = await w.links.begin(anna, 'hr');
    expect(url.startsWith(moved.endpoints.authorize)).toBe(true);
    await w.links.complete(anna, await moved.consent(url, 'account-anna'));
    expect(moved.accepts(await w.links.tokenFor('anna', 'hr'))).toBe('account-anna');
  });

  test('a metadata document that is not the issuer’s own is not believed', async () => {
    const w = world();
    w.vendor.claims = 'https://another.vendor.test';
    expect(await refusal(w.links.begin(anna, 'hr'))).toBe('no-server');
    expect(w.vendor.clientIds()).toEqual([]);
  });
});

describe('an administrator approves where people are sent', () => {
  const admin = { ...persona('mikael'), name: 'Mikael Lund', capabilities: ['admin.connectors'] };

  test('the server is discovered from the address the manifest names, and nobody links before it is approved', async () => {
    const w = world();
    w.declared.set('ledger', { resource: w.vendor.resource, scopes: [] });
    expect(await refusal(w.links.begin(anna, 'ledger'))).toBe('not-approved');
    const unavailable = await w.links.tokenFor('anna', 'ledger').catch(e => e);
    expect(unavailable).toBeInstanceOf(LinkUnavailableError);
    expect(unavailable.reason).toBe('not-approved');
    expect(await w.links.approval(admin, 'ledger')).toBeNull();

    w.advance(60);
    const view = await w.links.approve(admin, 'ledger');
    expect(view).toEqual({
      connectorId: 'ledger',
      resource: w.vendor.resource,
      issuer: w.vendor.issuer,
      origin: 'discovered',
      clientId: null,
      approvedBy: 'Mikael Lund',
      approvedAt: '2026-11-25T08:01:00.000Z',
    });
    expect(await w.links.approval(admin, 'ledger')).toEqual(view);
    expect(w.rows()).toEqual([
      [
        'person:mikael',
        'account.server-approved',
        'linked-account:ledger',
        {
          connector: 'ledger',
          resource: w.vendor.resource,
          issuer: w.vendor.issuer,
          origin: 'discovered',
          client: null,
        },
      ],
    ]);
    expect((await w.links.begin(anna, 'ledger')).url.startsWith(w.vendor.endpoints.authorize)).toBe(true);
    // A manifest that later names another address is not approved by this.
    w.declared.set('ledger', { resource: 'https://other.vendor.test', scopes: [] });
    expect(await refusal(w.links.begin(anna, 'ledger'))).toBe('not-approved');
  });

  test('a system without metadata is approved with the addresses and the client an administrator enters', async () => {
    const w = world({ kind: 'legacy' });
    w.vendor.addClient('clew', 'a-secret', REDIRECT);
    w.declared.set('files', { resource: w.vendor.resource, scopes: [] });
    // Nothing to discover: the administrator is told so, and enters the addresses.
    expect(await refusal(w.links.approve(admin, 'files'))).toBe('no-server');
    const entered = {
      server: {
        issuer: w.vendor.issuer,
        authorizationEndpoint: w.vendor.endpoints.authorize,
        tokenEndpoint: w.vendor.endpoints.token,
      },
      client: { id: 'clew', secret: 'a-secret' },
    };
    expect(await w.links.approve(admin, 'files', entered)).toMatchObject({ origin: 'entered', clientId: 'clew' });
    // The secret is in no view and no audit row.
    expect(JSON.stringify([await w.links.approval(admin, 'files'), w.store.audit])).not.toContain('a-secret');
    expect(w.rows().at(-1)![3]).toMatchObject({ origin: 'entered', client: 'clew', issuer: w.vendor.issuer });
    const { url } = await w.links.begin(anna, 'files');
    await w.links.complete(anna, await w.vendor.consent(url, 'account-anna'));
    expect(w.vendor.accepts(await w.links.tokenFor('anna', 'files'))).toBe('account-anna');

    const bad = { ...entered, server: { ...entered.server, tokenEndpoint: 'not an address' } };
    await expect(w.links.approve(admin, 'files', bad)).rejects.toThrow(
      'Adresserna måste vara fullständiga webbadresser.',
    );
  });

  test('only a connector administrator approves, after the step-up, and only what a manifest declares', async () => {
    const w = world();
    await expect(w.links.approve(anna, 'hr')).rejects.toThrow('Du saknar behörighet för åtgärden.');
    await expect(w.links.approval(anna, 'hr')).rejects.toThrow('Du saknar behörighet för åtgärden.');
    const refusedStepUp = {
      ...admin,
      authorize: async () => {
        throw new Error('step-up refused');
      },
    };
    await expect(w.links.approve(refusedStepUp, 'hr')).rejects.toThrow('step-up refused');
    expect(await refusal(w.links.approve(admin, 'payroll'))).toBe('unknown-connector');
    expect(w.rows()).toEqual([]);
  });
});

describe('unlinking', () => {
  test('the person takes the link away, and the tokens are revoked at a system that offers it', async () => {
    const w = world();
    await w.link(anna);
    await w.link(bo);
    const token = await w.links.tokenFor('anna', 'hr');
    expect(await w.links.unlink(anna, 'hr')).toEqual({ unlinked: true, revocation: 'revoked' });
    expect(w.vendor.accepts(token)).toBeNull();
    expect(await w.links.list(anna)).toEqual([]);
    expect(await required(w.links.tokenFor('anna', 'hr'))).toBe('not-linked');
    expect(w.rows().at(-1)).toEqual([
      'person:anna',
      'account.unlinked',
      SUBJECT,
      { connector: 'hr', issuer: w.vendor.issuer, person: 'anna' },
    ]);
    // Another person's link is untouched, and there is nothing to take away twice.
    expect(w.vendor.accepts(await w.links.tokenFor('bo', 'hr'))).toBe('account-bo');
    expect(await w.links.unlink(anna, 'hr')).toEqual({ unlinked: false, revocation: 'not-offered' });
    expect(w.actions().filter(a => a === 'account.unlinked').length).toBe(1);
  });

  test('the row is gone even when the system cannot be told', async () => {
    const w = world();
    await w.link(anna);
    w.vendor.failing = 503;
    expect(await w.links.unlink(anna, 'hr')).toEqual({ unlinked: true, revocation: 'failed' });
    expect(await w.links.list(anna)).toEqual([]);
    expect(w.logged).toContain('A removed link was not revoked at its system');
  });

  test('a person who leaves, a connector that is removed and a person outside an audience keep no link', async () => {
    const w = world();
    const carl = persona('carl');
    await w.link(anna);
    await w.link(bo);
    await w.link(carl);
    const [annas, bos, carls] = [
      await w.links.tokenFor('anna', 'hr'),
      await w.links.tokenFor('bo', 'hr'),
      await w.links.tokenFor('carl', 'hr'),
    ];
    expect(await w.links.forgetPerson('anna', 'scim:provisioner')).toBe(1);
    expect(w.vendor.accepts(annas)).toBeNull();
    expect(await w.held('anna')).toBeNull();
    expect(await w.links.forgetPerson('anna', 'scim:provisioner')).toBe(0);

    expect(await w.links.forgetLink('bo', 'hr', 'person:admin')).toBe(true);
    expect(w.vendor.accepts(bos)).toBeNull();
    expect(await w.links.forgetLink('bo', 'hr', 'person:admin')).toBe(false);

    await w.link(bo);
    expect(await w.links.forgetConnector('hr', 'person:admin')).toBe(2);
    expect(w.vendor.accepts(carls)).toBeNull();
    expect(await w.links.list(carl)).toEqual([]);
    const ended = (person: string, reason: string) => ({
      connector: 'hr',
      issuer: w.vendor.issuer,
      person,
      reason,
    });
    expect(w.rows().filter(row => row[1] === 'account.unlinked')).toEqual([
      ['scim:provisioner', 'account.unlinked', SUBJECT, ended('anna', 'person-removed')],
      ['person:admin', 'account.unlinked', SUBJECT, ended('bo', 'outside-audience')],
      ['person:admin', 'account.unlinked', SUBJECT, ended('bo', 'connector-removed')],
      ['person:admin', 'account.unlinked', SUBJECT, ended('carl', 'connector-removed')],
    ]);
  });
});

describe('a person provisioning deactivates', () => {
  test('keeps no link, by the transaction that deactivates them, and the other people keep theirs', async () => {
    const w = world();
    await w.link(anna);
    await w.link(bo);
    const change = { actor: 'provisioner:hr-export', personId: 'anna' };
    await w.store.transaction(tx => linkedAccountLeavers(tx).deactivated(change));
    expect(await w.held('anna')).toBeNull();
    expect(await required(w.links.tokenFor('anna', 'hr'))).toBe('not-linked');
    expect(w.vendor.accepts(await w.links.tokenFor('bo', 'hr'))).toBe('account-bo');
    expect(w.rows().at(-1)).toEqual([
      'provisioner:hr-export',
      'account.unlinked',
      SUBJECT,
      { connector: 'hr', issuer: w.vendor.issuer, person: 'anna', reason: 'person-deactivated' },
    ]);
    // When the deactivation does not commit, neither does the removal.
    await expect(
      w.store.transaction(async tx => {
        await linkedAccountLeavers(tx).deactivated({ actor: 'provisioner:hr-export', personId: 'bo' });
        throw new Error('the change was rolled back');
      }),
    ).rejects.toThrow('the change was rolled back');
    expect((await w.held('bo'))!.state).toBe('linked');
    expect(w.actions().filter(a => a === 'account.unlinked').length).toBe(1);
    // Nothing waits for a system: the deactivation asked nothing of it.
    const asked = w.vendor.requests.length;
    await w.store.transaction(tx => linkedAccountLeavers(tx).deactivated({ ...change, personId: 'bo' }));
    expect(w.vendor.requests.length).toBe(asked);
  });
});

describe('a system with an older authorization server', () => {
  const entered: OAuthClient = { id: 'clew', secret: 'secret-an-administrator-copied', source: 'entered' };
  const legacy = (client: OAuthClient | null = entered) => {
    const w = world({ kind: 'legacy', client });
    w.vendor.addClient('clew', 'secret-an-administrator-copied', REDIRECT);
    return w;
  };

  test('is linked through the addresses and the client an administrator entered, with no metadata asked for', async () => {
    const w = legacy();
    expect((await w.link(anna)).linked).toBe(true);
    const token = await w.links.tokenFor('anna', 'hr');
    expect(w.vendor.accepts(token)).toBe('account-anna');
    expect(w.vendor.requests.filter(r => r.includes('.well-known'))).toEqual([]);
    expect(w.vendor.clientIds()).toEqual(['clew']);
    expect(w.actions()).toEqual(['account.linked']);
    // The refresh token is rotated there too.
    w.advance(3600);
    expect(w.vendor.accepts(await w.links.tokenFor('anna', 'hr'))).toBe('account-anna');
  });

  test('is never met as a client without a secret, since nothing says it checks PKCE', async () => {
    expect(await refusal(legacy({ ...entered, secret: null }).links.begin(anna, 'hr'))).toBe('secret-required');
    const none = world({ kind: 'legacy', client: null });
    expect(await refusal(none.links.begin(anna, 'hr'))).toBe('no-client');
    expect(none.vendor.requests).toEqual([]);
  });

  test('keeps the token after the person unlinks, and the answer says so', async () => {
    const w = legacy();
    await w.link(anna);
    const token = await w.links.tokenFor('anna', 'hr');
    expect(await w.links.unlink(anna, 'hr')).toEqual({ unlinked: true, revocation: 'not-offered' });
    expect(await w.links.list(anna)).toEqual([]);
    // No revocation endpoint: the token is accepted at the system until it expires there (an open item of D147).
    expect(w.vendor.accepts(token)).toBe('account-anna');
  });
});

describe('the adapter and the rules', () => {
  test('an address that is not HTTPS is refused, except on a local stack', async () => {
    const vendor = authorizationServer({ issuer: 'http://id.vendor.test', resource: 'http://hr.vendor.test' });
    const strict = oauthAdapter({ clientName: 'Clew', fetch: vendor.fetch });
    const refused = await strict.discover(vendor.resource).catch(e => e);
    expect(refused).toBeInstanceOf(GrantRefused);
    expect([refused.code, refused.final]).toEqual(['insecure-address', true]);
    expect(vendor.requests).toEqual([]);
    const local = oauthAdapter({ clientName: 'Clew', fetch: vendor.fetch, insecure: true });
    expect((await local.discover(vendor.resource))?.issuer).toBe('http://id.vendor.test');
  });

  test('a system that publishes nothing has no authorization server to discover', async () => {
    const vendor = authorizationServer({ kind: 'legacy' });
    expect(await oauthAdapter({ clientName: 'Clew', fetch: vendor.fetch }).discover(vendor.resource)).toBeNull();
  });

  test('which client Clew is: entered, then a document, then registered, then a new registration', () => {
    const server = approved(authorizationServer());
    const client = (source: OAuthClient['source'], secret: string | null = null): OAuthClient => ({
      id: source,
      secret,
      source,
    });
    const known = { entered: client('entered'), registered: client('registered'), documentUrl: 'https://clew/doc' };
    expect(clientChoice(server, known)).toEqual({ use: client('entered') });
    expect(clientChoice({ ...server, clientDocuments: true }, { ...known, entered: null })).toEqual({
      use: { id: 'https://clew/doc', secret: null, source: 'document' },
    });
    expect(clientChoice(server, { ...known, entered: null })).toEqual({ use: client('registered') });
    expect(clientChoice(server, { entered: null, registered: null, documentUrl: null })).toEqual({ register: true });
    expect(
      clientChoice({ ...server, registrationEndpoint: null }, { entered: null, registered: null, documentUrl: null }),
    ).toEqual({ refused: 'no-client' });
    // Without PKCE said, only a client with a secret.
    expect(clientChoice({ ...server, pkce: false }, known)).toEqual({ refused: 'secret-required' });
    expect(clientChoice({ ...server, pkce: false }, { ...known, entered: client('entered', 's') })).toEqual({
      use: client('entered', 's'),
    });
  });

  test('a person is returned to a path inside Clew and nowhere else', () => {
    expect(localPath('/todo?tab=mine#row-3')).toBe('/todo?tab=mine#row-3');
    for (const elsewhere of [
      null,
      undefined,
      '',
      'todo',
      'https://evil.test/',
      '//evil.test/',
      '/\\evil.test',
      '/a\nb',
    ])
      expect(localPath(elsewhere)).toBe('/');
  });

  test('a manifest declares a linked account with an address Clew can discover from, and never beside delegation', () => {
    const declaring = (linkedAccount: unknown, more: object = {}) =>
      manifestProblems({ ...JSON.parse(JSON.stringify(hello)), linkedAccount, ...more }, 'hello');
    expect(declaring({ resource: 'https://hr.vendor.test' })).toEqual([]);
    expect(declaring({ resource: 'http://calendar:8080/nextcloud', scopes: ['leave', 'profile'] })).toEqual([]);
    for (const resource of [
      'hr.vendor.test',
      'ftp://hr.vendor.test',
      'https://u:p@hr.vendor.test',
      'https://hr.vendor.test/?a=1',
      'https://hr.vendor.test/#top',
    ])
      expect(declaring({ resource })).toEqual([
        'linkedAccount.resource must be an http or https address without credentials, a query or a fragment (D147).',
      ]);
    expect(declaring({ resource: 'https://hr.vendor.test' }, { delegation: { audience: 'hr' } })).toEqual([
      'The manifest declares both delegation and linkedAccount: a connector acts as the person one way (D147).',
    ]);
    // The schema refuses what is not a linked account at all.
    expect(declaring({}).length).toBeGreaterThan(0);
    expect(declaring({ resource: 'https://hr.vendor.test', scopes: ['two words'] }).length).toBeGreaterThan(0);
  });
});
