import { describe, expect, test } from 'bun:test';
import { isLocalIssuerHost } from '../../apps/server/src/auth-local';

/** Plain-HTTP sign-in is allowed only against an identity provider with a loopback name (D60). */
describe('isLocalIssuerHost', () => {
  test('accepts loopback names and the OrbStack name of the shared Keycloak', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'keycloak.localhost',
      'idp.dev.localhost',
      'keycloak.orb.local',
    ]) {
      expect(isLocalIssuerHost(hostname)).toBe(true);
    }
  });

  test('reads a name the way a URL does, whatever its case', () => {
    expect(isLocalIssuerHost(new URL('http://Keycloak.LocalHost:8090/realms/clew').hostname)).toBe(true);
    expect(isLocalIssuerHost('KEYCLOAK.ORB.LOCAL')).toBe(true);
  });

  test('refuses every name that could be a host on a network', () => {
    for (const hostname of [
      'keycloak.example.se',
      'localhost.example.se',
      'notlocalhost',
      'keycloaklocalhost',
      'other.orb.local',
      'host.docker.internal',
      '10.0.0.5',
      '192.168.65.254',
      'keycloak.localhost.',
    ]) {
      expect(isLocalIssuerHost(hostname)).toBe(false);
    }
  });
});
