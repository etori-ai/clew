import { generateKeyPair, exportPKCS8 } from 'jose';
import { connectorAuthority, type ConnectorAuthority } from '../apps/server/src/connectors/authority';
import type { Actor } from '../packages/connectors/src/index';
import type { AssertionBinding } from '../packages/connectors/src/remote';

const issuers = new Map<string, Promise<ConnectorAuthority>>();
/** The legacy fixture secret is now just a test issuer's label, never shared signing material. */
export function testAuthority(label = 'test-secret-test-secret') {
  let issuer = issuers.get(label);
  if (!issuer) {
    issuer = generateKeyPair('RS256', { extractable: true }).then(async keys =>
      connectorAuthority(await exportPKCS8(keys.privateKey), label),
    );
    issuers.set(label, issuer);
  }
  return issuer;
}
export const testJwks = async () => (await testAuthority()).jwks;
export const assertionFor =
  (id: string, label: string) =>
  async (actor: Actor, chain: string[] = [], binding?: AssertionBinding) =>
    (await testAuthority(label)).assert(id, actor, id === 'hello' ? ['calendar.today'] : [], chain, binding);
/**
 * A request to a connector service as Clew sends it (D117): the body serialised once and the assertion bound to it and,
 * on a capability's route, to the capability. For suites that call a service's handler directly.
 */
export async function signedRequest(
  url: string,
  options: { id: string; actor: Actor; body: unknown; key?: string; label?: string; headers?: Record<string, string> },
) {
  const text = JSON.stringify(options.body);
  const at = new URL(url).pathname.indexOf('/clew/capabilities/');
  const capability =
    at < 0 ? undefined : decodeURIComponent(new URL(url).pathname.slice(at + '/clew/capabilities/'.length));
  const token = await (
    await testAuthority(options.label)
  ).assert(options.id, options.actor, [], [], {
    body: text,
    ...(capability ? { capability } : {}),
  });
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
      ...(options.key ? { 'x-clew-connector-key': options.key } : {}),
      ...options.headers,
    },
    body: text,
  });
}
