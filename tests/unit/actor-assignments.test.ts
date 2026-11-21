import { describe, expect, test } from 'bun:test';
import { decodeJwt } from 'jose';
import { checkContract } from '../../packages/contracts/src/index';
import { actorOf, audiencedActorOf, type Actor } from '../../packages/connectors/src/index';
import { ActorSchema } from '../../packages/connectors/src/protocol';
import { assertionFor, testAuthority } from '../connector-authority';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { manifest as hrManifest } from '../../connectors/hr/connector.mjs';

/**
 * D135: the actor a connector is told carries every assignment of a person who holds more than one, beside the primary
 * `unitId` and `role` and apart from D117's `units`, in the request's assertion and body. The callback grant never
 * carries it, so what a connector may call back with is no larger than before.
 */
const one: Actor = { id: 'p', name: 'Sara Nyström', unitId: 'u-a', unitLabel: 'A', role: 'manager' };
const two: Actor = {
  ...one,
  assignments: [
    { unitId: 'u-a', unitLabel: 'A', role: 'manager' },
    { unitId: 'u-b', unitLabel: 'B', role: 'employee' },
  ],
};

describe('the actor of a person with several assignments', () => {
  test('carries them when there are two or more, beside units and never in their place', () => {
    expect(actorOf(one)).toEqual(one);
    expect(actorOf({ ...one, assignments: [{ unitId: 'u-a', unitLabel: 'A', role: 'manager' }] })).toEqual(one);
    const followed = { ...two, units: [{ unitId: 'u-a', unitLabel: 'A' }] };
    expect(actorOf(followed)).toEqual(followed);
    expect(audiencedActorOf({ ...two, groups: ['g'] })).toEqual({ ...two, groups: ['g'] });
    expect(checkContract(ActorSchema, actorOf(two))).toBe(true);
    // The protocol's schema is strict: one assignment alone is no list, and a role outside the two is refused.
    expect(checkContract(ActorSchema, { ...one, assignments: [two.assignments![0]] })).toBe(false);
    expect(
      checkContract(ActorSchema, {
        ...one,
        assignments: [...two.assignments!.slice(0, 1), { unitId: 'u-c', unitLabel: 'C', role: 'owner' }],
      }),
    ).toBe(false);
  });
  test('the request is signed with them and the callback grant without them', async () => {
    const authority = await testAuthority();
    const token = await authority.assert('src', two, ['src.read']);
    const claims = decodeJwt(token) as { actor: Actor; callback: string };
    expect(claims.actor.assignments).toEqual(two.assignments);
    const callback = decodeJwt(claims.callback) as { actor: Actor };
    expect(callback.actor.assignments).toBeUndefined();
    expect(callback.actor).toMatchObject({ unitId: 'u-a', role: 'manager' });
    // The grant still verifies as the protocol's actor.
    expect((await authority.verify(claims.callback)).actor.id).toBe('p');
    const single = decodeJwt(await authority.assert('src', one)) as { actor: Actor };
    expect(single.actor.assignments).toBeUndefined();
  });
  test('only a connector whose manifest takes them is sent them, in the body and in the assertion alike', async () => {
    const posted = async (manifest: Record<string, unknown>) => {
      const seen: Array<{ body: { actor: Actor }; claims: { actor: Actor } }> = [];
      const fetch: FetchLike = async (_url, init) => {
        const bearer = String((init?.headers as Record<string, string>).authorization).replace(/^Bearer /, '');
        seen.push({ body: JSON.parse(String(init?.body)), claims: decodeJwt(bearer) as { actor: Actor } });
        return Response.json({ drafts: [] });
      };
      const connector = remoteConnector(parseManifest(manifest, 'hr'), {
        url: 'http://hr',
        assert: assertionFor('hr', 'test-secret-test-secret'),
        fetch,
      });
      await connector.scan!(two, {} as never);
      return seen[0]!;
    };
    const told = await posted(hrManifest as Record<string, unknown>);
    expect(told.body.actor.assignments).toEqual(two.assignments);
    expect(told.claims.actor.assignments).toEqual(two.assignments);
    const { assignments: _, ...withoutField } = hrManifest as Record<string, unknown>;
    const untold = await posted(withoutField);
    expect(untold.body.actor.assignments).toBeUndefined();
    expect(untold.claims.actor.assignments).toBeUndefined();
    expect(untold.body.actor).toMatchObject({ unitId: 'u-a', role: 'manager' });
  });
});
