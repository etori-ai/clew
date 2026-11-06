import { describe, expect, test } from 'bun:test';
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
