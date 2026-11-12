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
/** The installation's own assertion for one connector (D119): no actor, bound to the request it is sent with. */
export const installationAssertionFor =
  (id: string, label: string) => async (binding: AssertionBinding & { capability: string }) =>
    (await testAuthority(label)).installation(id, binding);
/**
 * A read Clew makes as the installation, as it sends it (D119): `{ input }` to `/clew/installation/{name}`, the body
 * serialised once and the installation's assertion bound to it and to the name. For suites that call a handler directly.
 */
export async function installationRequest(
  url: string,
  options: { id: string; body: unknown; key?: string; label?: string; headers?: Record<string, string> },
) {
  const text = JSON.stringify(options.body);
  const capability = decodeURIComponent(new URL(url).pathname.split('/clew/installation/')[1] ?? '');
  const token = await (await testAuthority(options.label)).installation(options.id, { body: text, capability });
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
