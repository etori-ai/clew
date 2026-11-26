import { describe, expect, test } from 'bun:test';
import { CapabilityError, type Actor } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector } from '../../packages/connectors/src/remote';
import { manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { Registry } from '../registry';
import { assertionFor } from '../connector-authority';
import { LINKING_RESOURCE as RESOURCE, linkingHello } from '../linking-hello';
import { fromGrant, hillevi } from '../session-desk';

/**
 * The token on a call to a connector that declares `linkedAccount` (D147 items 2, 7 and 8), over the hello connector
 * of `tests/linking-hello.ts`.
 */
const actor: Actor = hillevi;
const code = (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'answered',
    error => (error instanceof CapabilityError ? error.code : 'another error: ' + String(error)),
  );

describe('a call to a connector whose person links an account', () => {
  test('carries the linked token with no session behind it, and the registry says what the connector declares', async () => {
    const w = linkingHello();
    w.linked.set('hillevi', 'token-1');
    w.accepted.add('token-1');
    expect(w.registry.connector('hello')?.linkedAccount).toEqual({ resource: RESOURCE });
    expect(w.registry.connector('hello')?.delegation).toBeUndefined();
    // Background work: the person's current grant, no session and no delegate.
    await w.registry.run(fromGrant(), 'hello.greeting', {});
    expect(w.calls).toEqual([{ path: '/clew/capabilities/hello.greeting', token: 'token-1' }]);
    expect(w.asked).toEqual(['hillevi']);
  });

  test('is not made for a person with no link: the answer is authorization-required and nothing is sent', async () => {
    const w = linkingHello();
    expect(await code(w.registry.run(actor, 'hello.greeting', {}))).toBe('authorization-required');
    expect(w.calls).toEqual([]);
    w.down(true);
    expect(await code(w.registry.run(actor, 'hello.greeting', {}))).toBe('unavailable');
    expect(w.calls).toEqual([]);
  });

  test('tells Clew when the system would not take the token, so the link is lost', async () => {
    const w = linkingHello();
    w.linked.set('hillevi', 'token-the-system-ended');
    expect(await code(w.registry.run(actor, 'hello.greeting', {}))).toBe('authorization-required');
    expect(w.refused).toEqual([{ person: 'hillevi', token: 'token-the-system-ended' }]);
    // The next call is not sent at all.
    expect(await code(w.registry.run(actor, 'hello.greeting', {}))).toBe('authorization-required');
    expect(w.calls.length).toBe(1);
  });

  test('a scan without a link is blocked, not failed, and one with a link runs with the token', async () => {
    const w = linkingHello();
    const blocked = await w.registry.scanOne(actor, 'hello');
    expect(blocked.drafts).toEqual([]);
    expect(blocked.observation?.completeness).toBe('authorization-required');
    expect(w.calls).toEqual([]);

    w.linked.set('hillevi', 'token-1');
    w.accepted.add('token-1');
    const scanned = await w.registry.scanOne(actor, 'hello');
    expect(scanned.observation?.completeness).not.toBe('authorization-required');
    expect(w.calls).toEqual([{ path: '/clew/scan', token: 'token-1' }]);

    // The system ends the token: the scan is blocked again and Clew is told.
    w.accepted.clear();
    expect((await w.registry.scanOne(actor, 'hello')).observation?.completeness).toBe('authorization-required');
    expect(w.refused).toEqual([{ person: 'hillevi', token: 'token-1' }]);
  });

  test('a connector with no one to answer for links is called without a token and refuses the person', async () => {
    const calls: Array<string | null> = [];
    const registry = new Registry();
    registry.register(
      remoteConnector(parseManifest({ ...(helloManifest as object), linkedAccount: { resource: RESOURCE } }, 'hello'), {
        url: 'http://hello',
        key: 'test-secret-test-secret',
        assert: assertionFor('hello', 'test-secret-test-secret'),
        fetch: async (_input, init) => {
          calls.push(new Headers(init?.headers).get('x-clew-delegated-token'));
          return Response.json({ error: { code: 'denied', message: 'Ingen token från personen.' } }, { status: 403 });
        },
      }),
    );
    expect(await code(registry.run(actor, 'hello.greeting', {}))).toBe('denied');
    expect(calls).toEqual([null]);
  });
});
