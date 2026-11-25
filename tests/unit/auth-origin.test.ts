import { afterEach, describe, expect, test } from 'bun:test';
import { localReturnTo } from '../../apps/server/src/auth-crypto';
import { AuthError, authSettings, verifyMutation } from '../../apps/server/src/auth';
import { frontendOrigins } from '../../apps/server/src/auth-origin';

test('sign-in returns the normalized local page and its query or falls back to the home page', () => {
  expect(localReturnTo('/work/../calendar?week=48')).toBe('/calendar?week=48');
  expect(localReturnTo('/search?q=two%20words')).toBe('/search?q=two%20words');
  for (const address of [null, '//', '/work/..//', '/%2e//', '/\t/', '/work/../api/session', '/login']) {
    expect(localReturnTo(address)).toBe('/');
  }
});
test('the return address keeps the whole local address but its fragment, and never leaves the installation (ID-9)', () => {
  // A deep link keeps its query through sign-in (WD-M3); the fragment never reaches the server, so none is returned.
  expect(localReturnTo('/items/abc?step=2#rows')).toBe('/items/abc?step=2');
  expect(localReturnTo('/tools?filter=a&b=c')).toBe('/tools?filter=a&b=c');
  expect(localReturnTo('/./calendar')).toBe('/calendar');
  // Encoded slashes stay encoded: a path on this host, never another host.
  expect(localReturnTo('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  for (const address of [
    '',
    'calendar',
    'https://evil.example/x',
    'http:/evil.example',
    'javascript:alert(1)',
    '//evil.example/x',
    '/\\evil.example',
    '\\\\evil.example',
    ' /calendar',
    '/x\ny',
    '/login?reason=expired',
  ])
    expect(localReturnTo(address)).toBe('/');
});

describe('the mutation guard (verifyMutation, ID-9)', () => {
  const settings = {
    OIDC_ISSUER: 'https://idp.example.test/realms/guard',
    OIDC_CLIENT_ID: 'clew-guard-test',
    OIDC_CLIENT_SECRET: 'synthetic-secret',
    PUBLIC_URL: 'https://clew.example.test',
    FRONTEND_ORIGINS: 'https://portal.example.test',
  };
  const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  afterEach(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const csrf = 'the-sessions-own-token';
  const post = (headers: Record<string, string>) =>
    new Request('https://clew.example.test/api/threads/t-1/act', { method: 'POST', headers });
  const refusal = (request: Request) => {
    try {
      verifyMutation(request, csrf);
    } catch (error) {
      return error instanceof AuthError ? { status: error.status, code: error.code } : error;
    }
    return 'passed';
  };
  test('a mutation from the public origin or a listed front end with the session’s token passes', () => {
    Object.assign(process.env, settings);
    expect(refusal(post({ origin: settings.PUBLIC_URL, 'x-csrf-token': csrf }))).toBe('passed');
    expect(refusal(post({ origin: 'https://portal.example.test', 'x-csrf-token': csrf }))).toBe('passed');
  });
  test('another origin, no origin, no token or another token is refused as 403 invalid', () => {
    Object.assign(process.env, settings);
    const refused = { status: 403, code: 'invalid' };
    const sent: Array<Record<string, string>> = [
      { origin: 'https://evil.example', 'x-csrf-token': csrf },
      { origin: 'null', 'x-csrf-token': csrf },
      { 'x-csrf-token': csrf },
      // The public host over another scheme is another origin.
      { origin: 'http://clew.example.test', 'x-csrf-token': csrf },
      { origin: settings.PUBLIC_URL },
      { origin: settings.PUBLIC_URL, 'x-csrf-token': '' },
      { origin: settings.PUBLIC_URL, 'x-csrf-token': csrf + 'x' },
      { origin: settings.PUBLIC_URL, 'x-csrf-token': 'another-sessions-token' },
    ];
    for (const headers of sent) expect(refusal(post(headers))).toEqual(refused);
  });
});

describe('frontendOrigins (D67 item 6)', () => {
  const publicOrigin = 'https://clew.example.se';
  test('the public origin alone when nothing is listed', () => {
    expect(frontendOrigins(publicOrigin, undefined)).toEqual([publicOrigin]);
    expect(frontendOrigins(publicOrigin, ' , ')).toEqual([publicOrigin]);
  });
  test('listed front ends join the public origin, once each', () => {
    expect(frontendOrigins('http://localhost:3020', 'http://localhost:3024, http://localhost:3024')).toEqual([
      'http://localhost:3020',
      'http://localhost:3024',
    ]);
    expect(frontendOrigins(publicOrigin, 'https://portal.example.se')).toEqual([
      publicOrigin,
      'https://portal.example.se',
    ]);
  });
  test('a path, a lesser scheme or a non-origin is refused at start', () => {
    expect(() => frontendOrigins(publicOrigin, 'https://portal.example.se/x')).toThrow(/bare https origin/);
    expect(() => frontendOrigins(publicOrigin, 'http://portal.example.se')).toThrow(/bare https origin/);
    expect(() => frontendOrigins(publicOrigin, 'portal')).toThrow(/not an origin/);
  });
});

test('sign-in requests offline_access when the installation needs that scope for refresh', () => {
  const env = {
    OIDC_ISSUER: 'https://issuer.example.org',
    OIDC_CLIENT_ID: 'test',
    OIDC_CLIENT_SECRET: 'fixture',
    PUBLIC_URL: 'https://clew.example.org',
    OIDC_REQUEST_OFFLINE_ACCESS: 'false',
    FRONTEND_ORIGINS: '',
  };
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    expect(authSettings().scope).toBe('openid profile email');
    process.env.OIDC_REQUEST_OFFLINE_ACCESS = 'true';
    expect(authSettings().scope).toBe('openid profile email offline_access');
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
