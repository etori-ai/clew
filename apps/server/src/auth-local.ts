/**
 * Which identity provider host may be reached over plain HTTP in development (D60). Only loopback names qualify, so a
 * production configuration can never sign people in without TLS by mistake. `keycloak.orb.local` is OrbStack's name for
 * the shared Keycloak container on macOS; `*.localhost` (RFC 6761) is resolved to loopback by every browser.
 */
const localIssuerHostNames = new Set(['localhost', '127.0.0.1', '[::1]', 'keycloak.orb.local']);

export function isLocalIssuerHost(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return localIssuerHostNames.has(name) || name.endsWith('.localhost');
}
