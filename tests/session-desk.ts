import type { AuthenticatedContext } from '../packages/contracts/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../connectors/hello/connector.mjs';
import { Registry } from './registry';
import { assertionFor, testJwks } from './connector-authority';

/** What `standingSession` in `apps/server/src/auth.ts` answers for a binding, in memory: whose session it is, when its person was last active in it, and its delegate. */
export interface DeskSession {
  personId: string;
  lastActiveAt: string;
  delegate: (audience: string) => Promise<string | undefined>;
}
/**
 * Signed-in sessions for the unit scenarios of work the person's own session stands behind (D26). A binding names a
 * session while it is active, and its delegate reads the session again before every token, as `standingSession` does;
 * every token handed out is recorded with the binding and audience it was for. A session's last activity is its sign-in
 * time unless `touch` moves it, as `POST /api/auth/activity` does; the desk has no clock of its own, so a scenario that
 * cares passes the time.
 */
export function sessionDesk() {
  const sessions = new Map<string, { personId: string; active: boolean; token: string | null; lastActiveAt: string }>();
  const tokens: Array<{ binding: string; audience: string }> = [];
  const find = async (binding: string): Promise<DeskSession | undefined> => {
    const s = sessions.get(binding);
    if (!s?.active) return undefined;
    return {
      personId: s.personId,
      lastActiveAt: s.lastActiveAt,
      delegate: async audience => {
        if (!sessions.get(binding)?.active) throw new Error('Session ended');
        tokens.push({ binding, audience });
        return s.token ?? undefined;
      },
    };
  };
  return {
    tokens,
    find,
    /** `token: null` is a session without IdP tokens (a development session, D6). */
    signIn: (
      binding: string,
      personId: string,
      token: string | null = 'token-of-' + binding,
      at = '1970-01-01T00:00:00.000Z',
    ) => sessions.set(binding, { personId, active: true, token, lastActiveAt: at }),
    /** The page reported activity in this session at `at`. */
    touch: (binding: string, at: string) => sessions.set(binding, { ...sessions.get(binding)!, lastActiveAt: at }),
    end: (binding: string) => sessions.set(binding, { ...sessions.get(binding)!, active: false }),
  };
}
export type SessionDesk = ReturnType<typeof sessionDesk>;
export const hillevi = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager' as const,
};
const persona = (personId: string, binding: string): AuthenticatedContext => ({
  ...hillevi,
  id: personId,
  organisationId: 'test',
  principal: { id: 'person:' + personId, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: binding,
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
/** The person as a signed-in request sees them: their session's binding and its delegate. */
export const signedIn = (desk: SessionDesk, binding: string, personId = hillevi.id): AuthenticatedContext => ({
  ...persona(personId, binding),
  delegate: async audience => (await desk.find(binding))?.delegate(audience),
});
/** The person as background work sees them: the current grant, no session and no delegate (`systemContext`). */
export const fromGrant = (personId = hillevi.id, binding = 'system:execution') => persona(personId, binding);

/**
 * The hello connector over the protocol, declaring `delegation` as the Nextcloud connector will and refusing every call
 * that arrives without the person's token. `calls` records each request's route, token and operation id.
 */
export function delegatingHello(audience = 'nextcloud') {
  const hello = createConnector({
    jwks: testJwks,
    secret: 'test-secret-test-secret',
    clewUrl: 'http://clew',
    fetch: async () => Response.json({ output: {} }),
  });
  const calls: Array<{ path: string; token: string | null; operationId: string | null }> = [];
  const fetch: FetchLike = (input, init) => {
    const h = new Headers(init?.headers);
    calls.push({
      path: new URL(String(input)).pathname,
      token: h.get('x-clew-delegated-token'),
      operationId: h.get('x-clew-operation-id'),
    });
    if (!h.get('x-clew-delegated-token'))
      return Promise.resolve(
        Response.json({ error: { code: 'denied', message: 'Ingen token från personen.' } }, { status: 403 }),
      );
    return hello.handle(new Request(input, init));
  };
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest({ ...(helloManifest as object), delegation: { audience } }, 'hello'), {
      url: 'http://hello',
      key: 'test-secret-test-secret',
      assert: assertionFor('hello', 'test-secret-test-secret'),
      fetch,
    }),
  );
  return { registry, calls };
}
