import { generateKeyPair, exportPKCS8 } from 'jose';
import { connectorAuthority, type ConnectorAuthority } from '../apps/server/src/connectors/authority';
import type { Actor } from '../packages/connectors/src/index';

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
  async (actor: Actor, chain: string[] = []) =>
    (await testAuthority(label)).assert(id, actor, id === 'hello' ? ['calendar.today'] : [], chain);
