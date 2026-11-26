import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AssistantAsk, AssistantAskEvent, AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  CapabilityError,
  Registry,
  openGovernance,
  type Actor,
  type Clew,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { nameManagers } from '../named-managers';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { relationUsecases } from '../../apps/server/src/modules/entities/relations';
import { personKey } from '../../apps/server/src/modules/entities/domain';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { startedCards } from '../../apps/server/src/threads/usecases/started';
import { capabilityRunner } from '../../apps/server/src/connectors/run';
import { assistantFunctions } from '../../apps/server/src/assistant/functions';
import { InputError } from '../../apps/server/src/context';
import { memoryPersonKeys } from '../person-keys';

/**
 * The assistant's function ports, `run`, `handover`, `people` and `start`, as the server binds them (AM-13 of the
 * 2026-11-23 assistant review): built by `assistantFunctions`, the factory composition binds them with, here over the
 * memory adapters. What each port must do for the assistant is held here once, so a test world that binds the ports by
 * hand cannot pass while the server's binding fails: the review's finding 3 was a `people` port whose key the registry
 * did not take. In this directory Erik's Clew id and user name differ, which is what tells the two apart.
 */
const T = '2026-11-24T08:00:00.000Z';
const ORG = 'poc';
type Placement = { unitId: string; role: 'manager' | 'employee' };

/**
 * Bergsåkers skola is led by Hillevi; Anna, Erik (`Erik.S`), Hassan and Nils, who has no user name, work there and
 * report to her. Olle leads Fritids and reports to her too; Sven, on Fritids, reports to Olle. Who reports to whom is
 * written on the employments (D147) by `nameManagers`.
 */
function directory() {
  const store = memoryProvisionStore(),
    s = store.state;
  const unit = (id: string, label: string, parent: string | null) => {
    s.units.set(id, { organisationId: ORG, label });
    s.groups.set('g-' + id, {
      id: 'g-' + id,
      organisationId: ORG,
      externalId: 'unit:' + id,
      label,
      parentUnitId: parent,
      createdAt: T,
      updatedAt: T,
    });
  };
  const person = (id: string, userName: string | null, name: string, placement: Placement) => {
    s.users.set(id, {
      id,
      organisationId: ORG,
      externalId: 'dev:' + id,
      userName,
      name,
      email: null,
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled: true,
      createdAt: T,
      updatedAt: T,
    });
    s.assignments.set(id, [placement]);
    s.grants.set(id, {
      unitId: placement.unitId,
      unitLabel: s.units.get(placement.unitId)!.label,
      role: placement.role,
      capabilities: [],
    });
  };
  unit('unit-skola', 'Bergsåkers skola', null);
  unit('unit-fritids', 'Fritids', 'unit-skola');
  person('hillevi', 'hillevi', 'Hillevi Berg', { unitId: 'unit-skola', role: 'manager' });
  person('anna', 'anna', 'Anna Lindqvist', { unitId: 'unit-skola', role: 'employee' });
  person('erik', 'Erik.S', 'Erik Sandström', { unitId: 'unit-skola', role: 'employee' });
  person('hassan', 'hassan', 'Hassan Ali', { unitId: 'unit-skola', role: 'employee' });
  person('nils', null, 'Nils Ek', { unitId: 'unit-skola', role: 'employee' });
  person('olle', 'olle', 'Olle Ek', { unitId: 'unit-fritids', role: 'manager' });
  person('sven', 'sven', 'Sven Berg', { unitId: 'unit-fritids', role: 'employee' });
  /** The person signed in: their live authority is counted, and their token for a source names the audience. */
  const persona = (id: string) => {
    const user = s.users.get(id)!,
      grant = s.grants.get(id)!;
    const p: AuthenticatedContext & { checks: number } = {
      id,
      name: user.name,
      unitId: grant.unitId,
      unitLabel: grant.unitLabel,
      role: grant.role,
      ...(user.userName ? { userName: user.userName } : {}),
      organisationId: ORG,
      principal: { id: 'person:' + id, kind: 'person' },
      capabilities: [],
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      checks: 0,
      async authorize() {
        p.checks += 1;
        return { version: 'v1' };
      },
      delegate: async audience => `${id}-token-for-${audience}`,
    };
    return p;
  };
  const staff = staffUsecases({ store });
  const relations = relationUsecases({
    directory: staff,
    reader: async actor => persona(actor.id),
    holders: memoryPersonKeys(s).holders,
  });
  // D147: who reports to whom is said on the employments, as a directory says it.
  nameManagers(store.state);
  return { persona, staff, relations };
}

/** What the source heard on each call: who asked, what, and what came with it. */
type Heard = Record<string, unknown>;
/** One source, Provkällan: a read about a person, a read it refuses, an assistant and a propose. */
function probe(heard: Heard[]): Connector {
  const object = (properties: Record<string, unknown> = {}) =>
    ({ type: 'object', properties, additionalProperties: false }) as never;
  const text = { type: 'string', maxLength: 200 };
  const base = { model: true, scope: {}, output: { type: 'object' } as never };
  return {
    id: 'probe',
    kind: 'passthrough',
    source: 'Provkällan',
    areas: [],
    capabilities: [
      {
        ...base,
        name: 'probe.person',
        kind: 'read',
        title: 'Person',
        description: 'Läser om personen själv eller en medarbetare, med användarnamnet som person.',
        input: object({ person: text }),
        person: { param: 'person', admits: ['self', 'managed'] },
        run: async (actor: Actor, input: { person?: string }, clew: Clew) => {
          heard.push({
            read: 'probe.person',
            actor: actor.id,
            person: input.person,
            relation: input.person === undefined ? undefined : clew.about?.relations[input.person],
            caller: clew.caller,
            forModel: clew.forModel,
            token: await clew.delegate?.('probe'),
          });
          return {};
        },
      },
      {
        ...base,
        name: 'probe.refused',
        kind: 'read',
        title: 'Vägras',
        description: 'Svarar aldrig.',
        input: object(),
        run: async () => {
          throw new CapabilityError('Provkällan svarar inte just nu.', 'unavailable');
        },
      },
      {
        ...base,
        model: false,
        name: 'probe.assistants',
        kind: 'read',
        title: 'Assistenter',
        description: 'Källans assistenter.',
        input: object(),
        run: async () => ({ assistants: [{ ref: 'guide', name: 'Guiden', description: 'Svarar på frågor.' }] }),
      },
      {
        ...base,
        name: 'probe.draft',
        kind: 'propose',
        title: 'Förbered ett utkast',
        description: 'Förbereder ett utkast åt personen.',
        input: object({ what: text }),
        run: async (actor: Actor, input: { what?: string }) => {
          heard.push({ read: 'probe.draft', actor: actor.id, what: input.what });
          return {
            topic: 'probe:draft',
            area: 'probe',
            title: 'Utkast',
            summary: 'Ett utkast. Inget är skickat.',
            reason: 'Källans egen anledning',
            items: [],
            actions: [],
          };
        },
      },
    ],
    assistants: {
      list: 'probe.assistants',
      ask: async function* (actor: Actor, ask: AssistantAsk, clew: Clew): AsyncGenerator<AssistantAskEvent> {
        heard.push({
          ask: ask.assistant,
          actor: actor.id,
          question: ask.question,
          signal: clew.signal !== undefined,
          token: await clew.delegate?.('probe'),
        });
        yield { type: 'text', delta: 'Hej ' + actor.id };
        yield { type: 'done', session: 's-1' };
      },
    },
  } as unknown as Connector;
}

function world() {
  const d = directory();
  const heard: Heard[] = [];
  const registry = new Registry({ relations: d.relations.relate });
  const source = probe(heard);
  registry.register({ ...source, uses: [] }).govern(source.id, openGovernance());
  const threads = memoryThreadStore();
  let n = 0;
  const started = startedCards({
    store: threads,
    registry,
    run: capabilityRunner(registry),
    digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32),
    clock: () => new Date(T),
    ids: () => 'thread-' + ++n,
  });
  // As composition binds them (`apps/server/src/composition/index.ts`).
  const ports = assistantFunctions({
    registry,
    people: { reach: d.staff.reach, userNameOf: personKey },
    start: started.startCard,
  });
  return { ...d, registry, threads, heard, ports };
}
const ASSISTANT = { caller: 'assistant', forModel: true } as const;
/** How a call through `run` failed: the error's words, and the protocol code of the refusal it carries. */
async function refusal(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    const cause = (error as Error & { cause?: unknown }).cause;
    return { message: error.message, code: cause instanceof CapabilityError ? cause.code : undefined };
  }
  throw new Error('The call was expected to be refused');
}

describe("the assistant's function ports as the server binds them (AM-13)", () => {
  test('people: everyone the asker manages, by Clew’s key and the user name a read takes; nobody who cannot be asked about, nobody for an employee', async () => {
    const w = world();
    // Each under the unit of the employment that names her (D147): Olle on Fritids, which he leads, not on her school.
    // Sven reports to Olle and is nobody of hers.
    expect(await w.ports.people!(w.persona('hillevi'))).toEqual([
      { key: 'anna', userName: 'anna', name: 'Anna Lindqvist', unit: 'Bergsåkers skola' },
      { key: 'erik', userName: 'Erik.S', name: 'Erik Sandström', unit: 'Bergsåkers skola' },
      { key: 'hassan', userName: 'hassan', name: 'Hassan Ali', unit: 'Bergsåkers skola' },
      { key: 'olle', userName: 'olle', name: 'Olle Ek', unit: 'Fritids' },
    ]);
    expect(await w.ports.people!(w.persona('hassan'))).toEqual([]);
  });
  test('people and run agree: each person listed is read about by the user name the port gives, never by their key (finding 3)', async () => {
    const w = world(),
      hillevi = w.persona('hillevi');
    for (const person of await w.ports.people!(hillevi))
      await w.ports.run(hillevi, 'probe.person', { person: person.userName }, ASSISTANT);
    expect(w.heard.map(h => [h.person, h.relation])).toEqual([
      ['anna', 'managed'],
      ['Erik.S', 'managed'],
      ['hassan', 'managed'],
      ['olle', 'managed'],
    ]);
    // Clew's own id is a key no read takes: the source never hears it.
    expect(await refusal(w.ports.run(hillevi, 'probe.person', { person: 'erik' }, ASSISTANT))).toMatchObject({
      message: 'Okänd förmåga.',
    });
    // Nor anyone the asker does not manage.
    expect(await refusal(w.ports.run(hillevi, 'probe.person', { person: 'sven' }, ASSISTANT))).toMatchObject({
      message: 'Okänd förmåga.',
    });
    expect(w.heard).toHaveLength(4);
  });
  test('run: as the person, marked as the assistant’s and for the model, with their live authority and their own token; a refusal keeps its code', async () => {
    const w = world(),
      hillevi = w.persona('hillevi');
    await w.ports.run(hillevi, 'probe.person', {}, ASSISTANT);
    expect(w.heard).toEqual([
      {
        read: 'probe.person',
        actor: 'hillevi',
        person: undefined,
        relation: undefined,
        caller: 'assistant',
        forModel: true,
        token: 'hillevi-token-for-probe',
      },
    ]);
    expect(hillevi.checks).toBeGreaterThan(0);
    // An unknown capability and a source's refusal are Clew's InputError; the refusal carries the protocol's code, which
    // is what the model is told of it (`toolFailure`), never the source's words.
    expect(await refusal(w.ports.run(hillevi, 'probe.missing', {}, ASSISTANT))).toEqual({
      message: 'Okänd förmåga.',
      code: undefined,
    });
    expect(await refusal(w.ports.run(hillevi, 'probe.refused', {}, ASSISTANT))).toEqual({
      message: 'Provkällan svarar inte just nu.',
      code: 'unavailable',
    });
  });
  test('handover: the source’s assistants are listed and asked as the person, with their live authority and their own token; outside the audience there are none', async () => {
    const w = world(),
      hillevi = w.persona('hillevi');
    expect(await w.ports.handover!.list(hillevi)).toEqual([
      { id: 'probe:guide', name: 'Guiden', description: 'Svarar på frågor.', source: 'Provkällan' },
    ]);
    const listedChecks = hillevi.checks;
    expect(listedChecks).toBeGreaterThan(0);
    const events: AssistantAskEvent[] = [];
    for await (const event of w.ports.handover!.ask(
      hillevi,
      'probe:guide',
      { question: 'Hej' },
      new AbortController().signal,
    ))
      events.push(event);
    expect(events).toEqual([
      { type: 'text', delta: 'Hej hillevi' },
      { type: 'done', session: 's-1' },
    ]);
    expect(w.heard).toEqual([
      { ask: 'guide', actor: 'hillevi', question: 'Hej', signal: true, token: 'hillevi-token-for-probe' },
    ]);
    // Asked before the question and again when the answer ends.
    expect(hillevi.checks).toBeGreaterThanOrEqual(listedChecks + 2);
    w.registry.govern('probe', { ...openGovernance(), audience: { mode: 'selected', units: ['unit-annan'] } });
    expect(await w.ports.handover!.list(hillevi)).toEqual([]);
    const outside = async () => {
      for await (const _ of w.ports.handover!.ask(hillevi, 'probe:guide', { question: 'Hej' })) void _;
    };
    await expect(outside()).rejects.toBeInstanceOf(CapabilityError);
  });
  test('start: a propose run as the person becomes one work item, audited as the assistant’s with its model; the same request gives the same item', async () => {
    const w = world(),
      hillevi = w.persona('hillevi');
    const context = {
      reason: 'Du bad assistenten förbereda det',
      same: 'topic' as const,
      by: { assistant: true as const, model: 'open-model' },
    };
    const { threadId } = await w.ports.start!(hillevi, 'probe.draft', { what: 'Ett utkast' }, context);
    expect(w.heard).toEqual([{ read: 'probe.draft', actor: 'hillevi', what: 'Ett utkast' }]);
    expect(await w.threads.readThread('hillevi', threadId)).toMatchObject({
      connector: 'probe',
      title: 'Utkast',
      state: 'open',
      trigger: { reason: 'Du bad assistenten förbereda det', source: 'Provkällan' },
    });
    const started = w.threads.audit.filter(a => a.action === 'thread.started');
    expect(started).toEqual([
      {
        actor: 'person:hillevi',
        action: 'thread.started',
        subject: 'thread:' + threadId,
        at: T,
        details: expect.objectContaining({
          connector: 'probe',
          capability: 'probe.draft',
          kind: 'propose',
          owner: 'hillevi',
          by: 'assistant',
          model: 'open-model',
        }),
      },
    ]);
    // Worded otherwise while the item is open, the same propose is the same item, and nothing more is written.
    expect(await w.ports.start!(hillevi, 'probe.draft', { what: 'Samma sak' }, context)).toEqual({ threadId });
    expect(w.threads.audit.filter(a => a.action === 'thread.started')).toHaveLength(1);
  });
});
