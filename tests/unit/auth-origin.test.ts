import { describe, expect, test } from 'bun:test';
import { authSettings } from '../../apps/server/src/auth';
import { frontendOrigins } from '../../apps/server/src/auth-origin';

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
