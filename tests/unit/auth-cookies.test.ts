import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { clearedCookie, cookieOptions, cookiePrefix } from '../../apps/server/src/auth';
import { sessionCookie } from '../../apps/server/src/context';
import { authRoutes } from '../../apps/server/src/routes/auth';
import { logger } from '../../apps/server/src/logging';

/**
 * The cookies' names and attributes (D145 item 4): `__Host-` outside the local stack, so a page on a sibling host of the
 * same domain cannot set a session or a sign-in of its own in their place, and bare on the local stack's plain http,
 * where a prefixed cookie is not kept. The callback is the route that reads and clears the sign-in's cookie before the
 * database is read. Every route reads the session's through `sessionCookie`; that the prefixed cookie reaches a session
 * and a bare one does not, through a protected route and the sign-out, is `tests/db/sign-in-routes.test.ts`.
 */
const installed = {
  OIDC_ISSUER: 'https://idp.example.test/realms/cookies',
  OIDC_CLIENT_ID: 'clew-cookies-test',
  OIDC_CLIENT_SECRET: 'synthetic-secret',
  PUBLIC_URL: 'https://clew.example.test',
};
const local = {
  ...installed,
  OIDC_ISSUER: 'http://keycloak.orb.local/realms/clew',
  PUBLIC_URL: 'http://localhost:5173',
  AUTH_LOCAL_HTTP: 'true',
};
const names = Object.keys(local) as Array<keyof typeof local>;
const previous = Object.fromEntries(names.map(k => [k, process.env[k]]));
function use(settings: Partial<Record<keyof typeof local, string>>) {
  for (const k of names) delete process.env[k];
  Object.assign(process.env, settings);
}
beforeAll(() => {
  spyOn(logger, 'warn').mockImplementation((() => {}) as never);
});
afterEach(() => {
  for (const k of names) {
    if (previous[k] === undefined) delete process.env[k];
    else process.env[k] = previous[k];
  }
});
afterAll(() => {
  (logger.warn as unknown as { mockRestore(): void }).mockRestore();
});

describe('the cookies a sign-in keeps', () => {
  test('an installation writes them __Host-: Secure, for every path, with no Domain', () => {
    use(installed);
    expect(cookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/', prefix: 'host' });
    expect(cookiePrefix()).toBe('host');
    expect(clearedCookie()).toEqual({ path: '/', secure: true, prefix: 'host' });
  });
  test('the local stack on plain http keeps the bare names without Secure', () => {
    use(local);
    expect(cookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: 'Lax', path: '/' });
    expect(cookiePrefix()).toBeUndefined();
    expect(clearedCookie()).toEqual({ path: '/' });
  });
  test('without sign-in configured, a cookie is still read and cleared under the prefixed name', () => {
    use({});
    expect(cookiePrefix()).toBe('host');
    expect(clearedCookie()).toEqual({ path: '/', secure: true, prefix: 'host' });
  });
  test('the callback clears the sign-in cookie under its __Host- name, and a bare clew-login from a sibling host is no sign-in', async () => {
    use(installed);
    const response = await authRoutes.request('/callback?code=c&state=s', {
      headers: { cookie: 'clew-login=planted' },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/login?reason=invalid');
    const cleared = response.headers.get('set-cookie')!;
    expect(cleared).toStartWith('__Host-clew-login=;');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('Secure');
    expect(cleared).not.toContain('Domain');
  });
  test('the session cookie every route reads is the __Host- one outside the local stack, and the bare one on it', async () => {
    // The request is all the reader looks at.
    const read = async (cookie: string) =>
      sessionCookie({ req: { raw: new Request('http://clew.test/', { headers: { cookie } }) } } as never) ?? 'none';
    use(installed);
    expect(await read('__Host-clew-session=own')).toBe('own');
    expect(await read('clew-session=planted')).toBe('none');
    expect(await read('clew-session=planted; __Host-clew-session=own')).toBe('own');
    use(local);
    expect(await read('clew-session=own')).toBe('own');
    expect(await read('__Host-clew-session=other')).toBe('none');
  });
  test('a sign-out clears the session cookie under its __Host- name', async () => {
    use(installed);
    const signedOut = await authRoutes.request('/logout', {
      method: 'POST',
      headers: { origin: installed.PUBLIC_URL },
    });
    expect(signedOut.status).toBe(200);
    expect(await signedOut.json()).toEqual({ url: installed.PUBLIC_URL + '/login' });
    const cleared = signedOut.headers.get('set-cookie')!;
    expect(cleared).toStartWith('__Host-clew-session=;');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('Secure');
    expect(cleared).not.toContain('Domain');
  });
});
