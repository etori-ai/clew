import { CapabilityError } from '../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../connectors/hello/connector.mjs';
import { Registry } from './registry';
import { assertionFor, testJwks } from './connector-authority';

/**
 * The hello connector over the protocol, declaring a linked account (D147), in front of a system that takes only the
 * tokens `accepted` holds and says `authorization-required` for any other. The transport's `linked` is what composition
 * binds to the linked-accounts module; here it is a map of who has linked, and `refused` takes a person's link away as
 * the module does. `calls` records each request's route and token.
 */
export const LINKING_RESOURCE = 'https://hello.vendor.test';
export function linkingHello() {
  const hello = createConnector({
    jwks: testJwks,
    secret: 'test-secret-test-secret',
    clewUrl: 'http://clew',
    fetch: async () => Response.json({ output: {} }),
  });
  /** The token each person's link gives now; nobody in it has no link. */
  const linked = new Map<string, string>();
  /** The tokens the system takes. */
  const accepted = new Set<string>();
  const asked: string[] = [];
  const refused: Array<{ person: string; token: string }> = [];
  const calls: Array<{ path: string; token: string | null }> = [];
  let unavailable = false;
  const fetch: FetchLike = (input, init) => {
    const token = new Headers(init?.headers).get('x-clew-delegated-token');
    calls.push({ path: new URL(String(input)).pathname, token });
    // The connector's system would not take the token: the connector says so, as the protocol asks.
    if (!token || !accepted.has(token))
      return Promise.resolve(
        Response.json(
          { error: { code: 'authorization-required', message: 'Systemet tog inte emot kontot.' } },
          { status: 403 },
        ),
      );
    return hello.handle(new Request(input, init));
  };
  const registry = new Registry();
  registry.register(
    remoteConnector(
      parseManifest({ ...(helloManifest as object), linkedAccount: { resource: LINKING_RESOURCE } }, 'hello'),
      {
        url: 'http://hello',
        key: 'test-secret-test-secret',
        assert: assertionFor('hello', 'test-secret-test-secret'),
        fetch,
        linked: {
          async token(who) {
            asked.push(who.id);
            if (unavailable) throw new CapabilityError('Systemet svarar inte just nu.', 'unavailable');
            const token = linked.get(who.id);
            if (!token) throw new CapabilityError('Systemet behöver ditt konto.', 'authorization-required');
            return token;
          },
          async refused(who, token) {
            refused.push({ person: who.id, token });
            linked.delete(who.id);
          },
        },
      },
    ),
  );
  return {
    registry,
    linked,
    accepted,
    asked,
    refused,
    calls,
    down: (value: boolean) => {
      unavailable = value;
    },
    unavailable: () => unavailable,
  };
}
