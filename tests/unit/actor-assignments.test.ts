import { describe, expect, test } from 'bun:test';
import { decodeJwt } from 'jose';
import { checkContract } from '../../packages/contracts/src/index';
import { actorOf, audiencedActorOf, leadsOf, type Actor } from '../../packages/connectors/src/index';
import { ActorSchema } from '../../packages/connectors/src/protocol';
import { assertionFor, testAuthority } from '../connector-authority';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { manifest as hrManifest } from '../../connectors/hr/connector.mjs';

/**
 * D135, D149: the actor a connector is told. `role` says that the person is a manager and `unitId` where they are
 * employed; `leads` says which units they lead, to every connector, and `assignments` their units with the role on
 * each, to a connector that takes them, apart from D117's `units`. Both are in the request's assertion and body. The
 * callback grant carries neither, so what a connector may call back with is no larger than before.
 */
const A = { unitId: 'u-a', unitLabel: 'A' };
const B = { unitId: 'u-b', unitLabel: 'B' };
const one: Actor = { id: 'p', name: 'Sara Nyström', ...A, role: 'manager' };
const two: Actor = {
  ...one,
  assignments: [
    { ...A, role: 'manager' },
    { ...B, role: 'employee' },
  ],
};
/** Employed on A, where they lead nothing, and leading B. */
const elsewhere: Actor = {
  ...one,
  assignments: [
    { ...A, role: 'employee' },
    { ...B, role: 'manager' },
  ],
};
/** A manager because people report to them, who leads no unit: one unit, and an employee on it. */
const reportedTo: Actor = { ...one, assignments: [{ ...A, role: 'employee' }] };
const employee: Actor = { ...one, role: 'employee' };

describe('the units a person leads, as the published actor says them (D149)', () => {
  test('a manager carries them, an employee carries none, and a manager who leads no unit carries an empty list', () => {
    // One unit and the role say it all: a manager with no assignments leads the unit they are employed on.
    expect(actorOf(one)).toEqual({ ...one, leads: [A] });
    expect(actorOf(employee)).toEqual(employee);
    expect(actorOf(employee)).not.toHaveProperty('leads');
    // The role is `manager` and the unit is where they are employed: neither says that they lead it.
    expect(actorOf(elsewhere)).toEqual({ ...elsewhere, leads: [B] });
    expect(actorOf(reportedTo)).toEqual({ ...reportedTo, leads: [] });
    expect(leadsOf(reportedTo)).toEqual([]);
    // Several, by the assignments' order; an employee's assignments lead nothing.
    expect(
      actorOf({ ...one, assignments: [...two.assignments!, { unitId: 'u-c', unitLabel: 'C', role: 'manager' }] }),
    ).toMatchObject({ leads: [A, { unitId: 'u-c', unitLabel: 'C' }] });
    expect(
      actorOf({
        ...employee,
        assignments: [
          { ...A, role: 'employee' },
          { ...B, role: 'employee' },
        ],
      }),
    ).not.toHaveProperty('leads');
    for (const actor of [one, employee, elsewhere, reportedTo, two])
      expect(checkContract(ActorSchema, actorOf(actor))).toBe(true);
  });
  test('what is published is not worked out again: an actor cut twice, with its assignments taken out between, says the same', () => {
    // A connector that does not take the assignments is posted the actor without them. Had the units been worked out
    // from what is left, the role and the unit, each of these would lead the unit they are only employed on.
    for (const actor of [elsewhere, reportedTo]) {
      const { assignments: _taken, ...told } = actorOf(actor);
      expect(actorOf(told)).toEqual(told);
      expect(leadsOf(told)).toEqual(actorOf(actor).leads!);
    }
    expect(leadsOf(actorOf(elsewhere))).toEqual([B]);
  });
  test('the request is signed with them and the callback grant without them', async () => {
    const authority = await testAuthority();
    for (const [actor, leads] of [
      [one, [A]],
      [elsewhere, [B]],
      [reportedTo, []],
    ] as const) {
      const claims = decodeJwt(await authority.assert('src', actorOf(actor), ['src.read'])) as {
        actor: Actor;
        callback: string;
      };
      expect(claims.actor.leads).toEqual([...leads]);
      expect((decodeJwt(claims.callback) as { actor: Actor }).actor).not.toHaveProperty('leads');
    }
    const plain = decodeJwt(await authority.assert('src', actorOf(employee))) as { actor: Actor };
    expect(plain.actor).not.toHaveProperty('leads');
  });
});

describe('the actor of a person with several assignments', () => {
  test('carries them whenever the person holds them, beside units and never in their place', () => {
    expect(actorOf(one)).not.toHaveProperty('assignments');
    // One alone is carried too: it says what the unit and the role do not, as for someone who leads no unit.
    expect(actorOf(reportedTo).assignments).toEqual(reportedTo.assignments);
    const followed = { ...two, units: [A] };
    expect(actorOf(followed)).toEqual({ ...followed, leads: [A] });
    expect(audiencedActorOf({ ...two, groups: ['g'] })).toEqual({ ...two, leads: [A], groups: ['g'] });
    expect(checkContract(ActorSchema, actorOf(two))).toBe(true);
    // The protocol's schema is strict: an empty list is no list, and a role outside the two is refused.
    expect(checkContract(ActorSchema, { ...one, assignments: [two.assignments![0]] })).toBe(true);
    expect(checkContract(ActorSchema, { ...one, assignments: [] })).toBe(false);
    expect(
      checkContract(ActorSchema, {
        ...one,
        assignments: [...two.assignments!.slice(0, 1), { unitId: 'u-c', unitLabel: 'C', role: 'owner' }],
      }),
    ).toBe(false);
    // A unit led is a unit and its name, and nothing else.
    expect(checkContract(ActorSchema, { ...one, leads: [{ ...A, role: 'manager' }] })).toBe(false);
    expect(checkContract(ActorSchema, { ...one, leads: [{ unitId: '', unitLabel: 'A' }] })).toBe(false);
  });
  test('the request is signed with them and the callback grant without them', async () => {
    const authority = await testAuthority();
    const token = await authority.assert('src', actorOf(two), ['src.read']);
    const claims = decodeJwt(token) as { actor: Actor; callback: string };
    expect(claims.actor.assignments).toEqual(two.assignments);
    const callback = decodeJwt(claims.callback) as { actor: Actor };
    expect(callback.actor.assignments).toBeUndefined();
    expect(callback.actor).toMatchObject({ unitId: 'u-a', role: 'manager' });
    // The grant still verifies as the protocol's actor.
    expect((await authority.verify(claims.callback)).actor.id).toBe('p');
    const single = decodeJwt(await authority.assert('src', actorOf(one))) as { actor: Actor };
    expect(single.actor.assignments).toBeUndefined();
  });
  test('only a connector whose manifest takes them is sent them, in the body and in the assertion alike; the units a person leads reach every connector', async () => {
    const posted = async (manifest: Record<string, unknown>, actor: Actor = two) => {
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
      await connector.scan!(actor, {} as never);
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
    // D149: what the person leads is told to both, and is the same in the body and in the assertion.
    for (const sent of [told, untold]) expect([sent.body.actor.leads, sent.claims.actor.leads]).toEqual([[A], [A]]);
    // Someone employed on one unit who leads another, and someone who leads none: a connector that does not take the
    // assignments is told so all the same, and nothing it is sent says that they lead the unit they are employed on.
    for (const [actor, leads] of [
      [elsewhere, [B]],
      [reportedTo, []],
    ] as const) {
      const sent = await posted(withoutField, actor);
      expect(sent.body.actor).toEqual({ ...one, leads: [...leads] });
      expect(sent.claims.actor).toEqual(sent.body.actor);
      expect(checkContract(ActorSchema, sent.body.actor)).toBe(true);
      const taken = await posted(hrManifest as Record<string, unknown>, actor);
      expect(taken.body.actor).toEqual({ ...actor, leads: [...leads] });
      expect(taken.claims.actor).toEqual(taken.body.actor);
    }
  });
});
