import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '@clew/contracts';
import { memoryLinkStore } from '../../apps/server/src/modules/linked-accounts/adapters/memory';
import { oauthAdapter } from '../../apps/server/src/modules/linked-accounts/adapters/oauth';
import { linkedAccountUsecases } from '../../apps/server/src/modules/linked-accounts/usecases';
import { linkedAccountRoutes } from '../../apps/server/src/routes/linked-accounts';
import { authorizationServer } from '../authorization-server';

/**
 * The linked-account routes (D147) over the memory store and an authorization server in memory: what a signed-in
 * person's browser is answered, either side of the system's page.
 */
const REDIRECT = 'http://clew.local/callback';
const person = (id: string) =>
  ({
    id,
    name: 'Namn Namnsson',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorize: async () => ({ version: 'v' }),
  }) as unknown as AuthenticatedContext;
function stack(who = person('anna')) {
  const vendor = authorizationServer();
  const store = memoryLinkStore();
  const usecases = linkedAccountUsecases({
    store,
    connectors: {
      declared: async id => (id === 'hr' ? { resource: vendor.resource, scopes: [] } : null),
      reaches: async () => true,
      linkable: async () => [{ connectorId: 'hr', source: 'Personalsystemet' }],
    },
    oauth: oauthAdapter({ clientName: 'Clew', fetch: vendor.fetch }),
    clock: () => new Date('2026-11-25T08:00:00.000Z'),
    redirectUri: REDIRECT,
    clientDocumentUrl: null,
    log: () => undefined,
  });
  const guard: NonNullable<Parameters<typeof linkedAccountRoutes>[1]> = async (c, next) => {
    c.set('session', { context: who } as never);
    await next();
  };
  const routes = linkedAccountRoutes(usecases, guard);
  const call = (method: string, path: string, body?: unknown) =>
    routes.request('http://clew.local' + path, {
      method,
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
  return { vendor, store, usecases, call };
}

describe('linked-account routes', () => {
  test('a person starts linking, returns from the system to the page they left, and sees the link without a token', async () => {
    const s = stack();
    await s.usecases.approveAsOperator('hr');
    const entry = {
      connectorId: 'hr',
      source: 'Personalsystemet',
      state: 'not-linked',
      linkedAt: null,
      lostAt: null,
      putOff: false,
      revocable: true,
    };
    expect(await (await s.call('GET', '/')).json()).toEqual({ accounts: [entry] });

    const started = await s.call('POST', '/hr/link', { returnTo: '/todo?tab=mine' });
    expect(started.status).toBe(200);
    expect(started.headers.get('cache-control')).toBe('no-store, private');
    const { url } = (await started.json()) as { url: string };
    expect(url.startsWith(s.vendor.endpoints.authorize)).toBe(true);

    const back = new URL(await s.vendor.consent(url, 'account-anna'));
    const returned = await s.call('GET', '/callback' + back.search);
    expect(returned.status).toBe(303);
    expect(returned.headers.get('location')).toBe('/todo?tab=mine&account=linked&system=hr');

    const listed = await s.call('GET', '/');
    const body = await listed.text();
    expect(JSON.parse(body)).toEqual({
      accounts: [{ ...entry, state: 'linked', linkedAt: '2026-11-25T08:00:00.000Z' }],
    });
    const token = await s.usecases.tokenFor('anna', 'hr');
    expect(body).not.toContain(token);

    const unlinked = await s.call('DELETE', '/hr');
    expect(await unlinked.json()).toEqual({ unlinked: true, revocation: 'revoked' });
    expect(s.vendor.accepts(token)).toBeNull();
    expect(await (await s.call('DELETE', '/hr')).json()).toEqual({ unlinked: false, revocation: 'not-offered' });
  });

  test('a person who declines, and a return nobody started, land on a page of Clew that says so', async () => {
    const s = stack();
    await s.usecases.approveAsOperator('hr');
    const { url } = (await (await s.call('POST', '/hr/link', { returnTo: '/calendar' })).json()) as { url: string };
    const declined = new URL(await s.vendor.consent(url, 'account-anna', { decline: true }));
    const back = await s.call('GET', '/callback' + declined.search);
    expect([back.status, back.headers.get('location')]).toEqual([303, '/calendar?account=declined&system=hr']);

    const stray = await s.call('GET', '/callback?code=x&state=never-started');
    expect([stray.status, stray.headers.get('location')]).toEqual([303, '/?account=failed']);

    // A link that is the person's own and fails at the system is said where it was started, by the system: the
    // window's return page when the link was started in a window (D147 item 6).
    const again = (await (
      await s.call('POST', '/hr/link', { returnTo: '/accounts/return?link=0a1b2c3d4e5f' })
    ).json()) as { url: string };
    const state = new URL(again.url).searchParams.get('state');
    const refused = await s.call('GET', `/callback?code=not-the-code&state=${state}`);
    expect([refused.status, refused.headers.get('location')]).toEqual([
      303,
      '/accounts/return?link=0a1b2c3d4e5f&account=failed&system=hr',
    ]);
    expect(await (await s.call('GET', '/')).json()).toMatchObject({
      accounts: [{ connectorId: 'hr', state: 'not-linked', putOff: false }],
    });
  });

  test('a person puts a system off, and only with a list of connectors that are theirs', async () => {
    const s = stack();
    await s.usecases.approveAsOperator('hr');
    const later = await s.call('POST', '/later', { connectors: ['hr'] });
    expect([later.status, later.headers.get('cache-control')]).toEqual([200, 'no-store, private']);
    expect(await later.json()).toEqual({ putOff: ['hr'] });
    expect(await (await s.call('GET', '/')).json()).toMatchObject({
      accounts: [{ connectorId: 'hr', state: 'not-linked', putOff: true }],
    });
    expect(s.store.audit.at(-1)).toMatchObject({ actor: 'person:anna', action: 'account.link-put-off' });
    expect((await s.call('POST', '/later', { connectors: ['payroll'] })).status).toBe(404);
    for (const body of [{}, { connectors: [] }, { connectors: 'hr' }, { connectors: ['Not-One'] }, '{not json'])
      expect((await s.call('POST', '/later', body)).status).toBe(400);
    expect((await s.call('POST', '/later', { connectors: Array.from({ length: 21 }, (_, i) => 'c' + i) })).status).toBe(
      400,
    );
  });

  test('a return is led to a page of Clew and never to another address', async () => {
    const s = stack();
    await s.usecases.approveAsOperator('hr');
    for (const returnTo of ['https://evil.test/', '//evil.test/x', '/\\evil.test']) {
      const { url } = (await (await s.call('POST', '/hr/link', { returnTo })).json()) as { url: string };
      const back = new URL(await s.vendor.consent(url, 'account-anna'));
      const returned = await s.call('GET', '/callback' + back.search);
      expect(returned.headers.get('location')).toBe('/?account=linked&system=hr');
    }
  });

  test('refusals are answered in the person’s words, with a code and never the reason', async () => {
    const s = stack();
    // A connector that does not exist for this person, and one no administrator has approved.
    const missing = await s.call('POST', '/payroll/link', {});
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'Systemet finns inte eller går inte att koppla.',
      code: 'link-refused',
    });
    const unapproved = await s.call('POST', '/hr/link', {});
    expect(unapproved.status).toBe(400);
    expect(await unapproved.json()).toEqual({
      error: 'Kopplingen kunde inte slutföras. Försök igen.',
      code: 'link-refused',
    });
    await s.usecases.approveAsOperator('hr');
    s.vendor.failing = 503;
    const down = await s.call('POST', '/hr/link', {});
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({
      error: 'Systemet svarar inte just nu. Försök igen om en stund.',
      code: 'source-unavailable',
    });
    for (const [path, body] of [
      ['/Not-A-Connector/link', {}],
      ['/hr/link', '{not json'],
      ['/hr/link', { returnTo: 7 }],
      ['/hr/link', 'x'.repeat(5000)],
    ] as const)
      expect((await s.call('POST', path, body)).status).toBe(400);
  });
});
