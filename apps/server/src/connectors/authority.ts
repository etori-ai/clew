import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT, jwtVerify, createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { Value } from 'typebox/value';
import { ActorSchema } from '@clew/connectors/protocol';
import type { Actor } from '@clew/connectors';

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}
export interface CallbackGrant {
  connectorId: string;
  actor: Actor;
  uses: string[];
  chain: string[];
}
/** Only Clew holds the private key. Connectors verify requests with public keys and cannot mint callback grants. */
export async function connectorAuthority(pem: string, kid: string, previous: JSONWebKeySet['keys'] = []) {
  const privateKey = await importPKCS8(pem, 'RS256');
  const jwks: JSONWebKeySet = {
    keys: [
      { ...createPublicKey(createPrivateKey(pem)).export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
      ...previous,
    ],
  };
  // The person's directory user name is signed with the rest of the actor when they have one (D44, D97): the key a
  // connector knows them by; so are the units they follow up when the call has them (D117). Both optional, so a grant
  // signed without them still verifies.
  const sign = (audience: string, actor: Actor, claims: Record<string, unknown>) =>
    new SignJWT({
      actor: {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        unitId: actor.unitId,
        unitLabel: actor.unitLabel,
        ...(actor.userName ? { userName: actor.userName } : {}),
        ...(actor.units?.length ? { units: actor.units } : {}),
      },
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
      .setIssuer('clew')
      .setAudience(audience)
      .setSubject(actor.id)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);
  return {
    jwks,
    async assert(connectorId: string, actor: Actor, uses: string[] = [], chain: string[] = []) {
      const callback = uses.length
        ? await sign('clew:connector-callback', actor, { connectorId, uses, chain })
        : undefined;
      return sign(connectorId, actor, { ...(callback ? { callback } : {}) });
    },
    async verify(token: string): Promise<CallbackGrant> {
      try {
        const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
          algorithms: ['RS256'],
          issuer: 'clew',
          audience: 'clew:connector-callback',
          requiredClaims: ['exp', 'iat', 'jti', 'sub'],
          maxTokenAge: '2m',
        });
        if (
          !Value.Check(ActorSchema, payload.actor) ||
          payload.sub !== payload.actor.id ||
          typeof payload.connectorId !== 'string' ||
          !Array.isArray(payload.uses) ||
          !payload.uses.every(n => typeof n === 'string' && /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(n)) ||
          !Array.isArray(payload.chain) ||
          payload.chain.length > 8 ||
          !payload.chain.every(n => typeof n === 'string')
        )
          throw new Error('Invalid claims.');
        return { connectorId: payload.connectorId, actor: payload.actor, uses: payload.uses, chain: payload.chain };
      } catch {
        throw new AssertionError('Invalid callback grant.');
      }
    },
  };
}
export type ConnectorAuthority = Awaited<ReturnType<typeof connectorAuthority>>;
