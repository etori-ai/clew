import { createHash, createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT, jwtVerify, createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { Value } from 'typebox/value';
import { ActorSchema, INSTALLATION_CALLER, INSTALLATION_SUBJECT } from '@clew/connectors/protocol';
import type { Actor } from '@clew/connectors';
import type { AssertionBinding } from '@clew/connectors/remote';

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
/** What a connector's verifier recomputes from the body it received (D117): SHA-256 of the exact bytes, base64url. */
export const bodyDigest = (body: string) => createHash('sha256').update(body, 'utf8').digest('base64url');
/** The two routes that name a capability, as a connector's verifier reads them (D117, D119): the name, nothing after. */
const NAMED_ROUTE = /^\/clew\/(capabilities|installation)\/([^/]+)$/;
/**
 * The claims that bind an assertion to its request (D117): `path`, the route it is posted to; `body`, the digest of the
 * exact body; on `/clew/capabilities/{name}` and `/clew/installation/{name}` the name as `capability`, read from the
 * path so the two never disagree; and an approved write's `operationId`. Refused for a path that is not absolute (an
 * address with its host, say) or a name that does not decode: neither is what a connector's verifier reads.
 */
function boundClaims(binding: AssertionBinding) {
  if (typeof binding?.path !== 'string' || !binding.path.startsWith('/') || typeof binding.body !== 'string')
    throw new AssertionError('An assertion is bound to the route and the body of its request.');
  const named = NAMED_ROUTE.exec(binding.path);
  let capability: string | undefined;
  try {
    capability = named ? decodeURIComponent(named[2]!) : undefined;
  } catch {
    throw new AssertionError('An assertion is bound to a route Clew posts to.');
  }
  return {
    route: named?.[1],
    claims: {
      path: binding.path,
      body: bodyDigest(binding.body),
      ...(capability ? { capability } : {}),
      ...(binding.operationId ? { operationId: binding.operationId } : {}),
    },
  };
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
  // connector knows them by; so are the units they follow up when the call has them (D117), and, on a request's
  // assertion, every assignment of a person who holds more than one (D135). All optional, so a grant signed without them
  // still verifies. The callback grant never carries the assignments: Clew answers a callback from the person's current
  // record, and what is signed twice is what makes a header too large (issue 64).
  const sign = (audience: string, actor: Actor, claims: Record<string, unknown>, assignments = false) =>
    new SignJWT({
      actor: {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        unitId: actor.unitId,
        unitLabel: actor.unitLabel,
        ...(actor.userName ? { userName: actor.userName } : {}),
        ...(actor.units?.length ? { units: actor.units } : {}),
        ...(assignments && actor.assignments && actor.assignments.length > 1
          ? { assignments: actor.assignments.map(a => ({ unitId: a.unitId, unitLabel: a.unitLabel, role: a.role })) }
          : {}),
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
    /**
     * The request assertion for one call, bound to it (D117): `path` is the route it is posted to, `body` the SHA-256
     * of the exact request body, base64url, `capability` the capability's name on its route, and `operationId` the
     * `X-Clew-Operation-Id` an approved write is sent with, so the same assertion cannot be sent to another route or
     * carry the write again as another operation. The body carries the input and, when it names people or units, how
     * the actor stands to each (`about`), so the binding covers both and the bearer stays the same size however many
     * keys a call names. Without a binding the assertion verifies nowhere. The callback grant is never bound and never
     * carries `about`; `callback: false` leaves it out.
     */
    async assert(
      connectorId: string,
      actor: Actor,
      uses: string[] = [],
      chain: string[] = [],
      binding?: AssertionBinding,
    ) {
      // No grant when the connector uses nothing, or when the call is one nothing may be read back during (D144).
      const callback =
        uses.length && binding?.callback !== false
          ? await sign('clew:connector-callback', actor, { connectorId, uses, chain })
          : undefined;
      return sign(
        connectorId,
        actor,
        { ...(callback ? { callback } : {}), ...(binding ? boundClaims(binding).claims : {}) },
        true,
      );
    },
    /**
     * The installation's own assertion, for a read Clew makes with no person behind it (D119): subject
     * `clew:installation`, `caller: "installation"`, no `actor` and no `callback`, so it verifies as nobody's person
     * and grants no callback. Bound to its one request as every assertion is (D117): the binding is required, and its
     * path is `/clew/installation/{name}`.
     */
    async installation(connectorId: string, binding: AssertionBinding) {
      const bound = binding ? boundClaims(binding) : undefined;
      if (bound?.route !== 'installation' || binding.operationId)
        throw new AssertionError('An installation assertion is bound to its request on the installation route.');
      return new SignJWT({ caller: INSTALLATION_CALLER, ...bound.claims })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
        .setIssuer('clew')
        .setAudience(connectorId)
        .setSubject(INSTALLATION_SUBJECT)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(privateKey);
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
