import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  audiencedActorOf,
  CapabilityError,
  deniedGovernance,
  openGovernance,
  type Actor,
  type Capability,
  type Connector,
  type ExecuteResult,
} from '../../packages/connectors/src/index';
import { manifestProblems } from '../../packages/connectors/src/remote';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { startedCards } from '../../apps/server/src/threads/usecases/started';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { threadAccess } from '../../apps/server/src/threads/access';
import { STARTED_ACTION } from '../../apps/server/src/threads/domain';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { ExecutionError, type ExecutionSource } from '../../apps/server/src/modules/executions/model';
import { recordActionUsecases } from '../../apps/server/src/modules/records/actions';
import { filledBy, recordLabel } from '../../apps/server/src/modules/records/domain';
import type { Records } from '../../apps/server/src/modules/records/model';
import { recordRoutes } from '../../apps/server/src/routes/records';
import { assistantUsecases } from '../../apps/server/src/assistant';
import { DRAFT_TOOL } from '../../apps/server/src/assistant/drafts';
import type { ModelGenerate } from '../../apps/server/src/assistant/model';
import { memoryModelHealth, memoryModelStore, memoryModelWire } from '../../apps/server/src/assistant/adapters/memory';
import { modelUsecases } from '../../apps/server/src/assistant/usecases/models';
import { InputError } from '../../apps/server/src/context';
import { manifest as deskManifest } from '../../connectors/servicedesk/manifest.mjs';
import { fixtureConnectors } from '../fixture-connectors';
import { Registry } from '../registry';

/**
 * An action about a record (D132): a connector's propose or execute that is about one record of one of its reads, here
 * the service desk's "Lägg till en kommentar" on a request the person made, run over the protocol from the fixture of
 * the development stack. The loader holds the declaration to its rules; the registry indexes the read to the actions
 * about its records for one person; the records module lists and starts them only once the person has made the
 * record's read, fills what the record fills from its input and never from an answer, and an execute goes through the
 * human decision into the execution ledger as an entity's does. The assistant's draft of it is in its own block below.
 */
const T0 = new Date('2026-11-13T08:00:00+01:00');
const READ = 'servicedesk.request';
const COMMENT = 'servicedesk.comment';
/** Hillevi's fault report, which the desk waits on her for; Anna's own; the computer Hillevi ordered for Anna. */
const PRINTER = { ref: 'request:servicedesk:SD-26110047' };
const ANNAS = { ref: 'request:servicedesk:SD-26110049' };
const persona = (userName: string, role: Actor['role'] = 'employee', unitId = 'unit-skola'): AuthenticatedContext => ({
  id: 'person-' + userName,
  name: userName === 'hillevi' ? 'Hillevi Berg' : 'Anna Lindqvist',
  unitId,
  unitLabel: 'Skolan',
  role,
  userName,
  organisationId: 'test',
  principal: { id: 'person:person-' + userName, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const hillevi = persona('hillevi', 'manager');
const anna = persona('anna');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const edited = (change: (m: any) => void) => {
  const m = copy(deskManifest) as any;
  change(m);
  return m;
};
const cap = (m: any, name: string) => m.capabilities.find((c: any) => c.name === name);
const problemsOf = (change: (m: any) => void) => manifestProblems(edited(change), 'servicedesk');
const ASK = { kind: 'long-text' as const, property: 'text', label: 'Kommentar', required: true };
const DESCRIPTION =
  'Lägger till din kommentar på beställningen eller felanmälan i IT-servicedesken, där handläggarna ser den. Bara på det du själv har beställt eller felanmält.';

describe('the loader holds the record form of about to its rules (D132)', () => {
  test("the service desk's comment is about a request, filled from its ref, and loads", () => {
    expect(manifestProblems(deskManifest, 'servicedesk')).toEqual([]);
    expect(cap(deskManifest, COMMENT)).toMatchObject({
      kind: 'execute',
      model: false,
      about: { record: READ, params: { ref: 'ref' } },
      asks: [ASK],
      effect: 'servicedesk.commentEffect',
    });
  });
  test('each break is refused with its own sentence', () => {
    const refused: Array<[string, (m: any) => void, RegExp]> = [
      [
        'on a read',
        m => (cap(m, 'servicedesk.equipment').about = { record: READ, params: { person: 'ref' } }),
        /servicedesk\.equipment: a read is never about a record; about\.record belongs to a propose or an execute/,
      ],
      [
        'a read of no manifest',
        m => (cap(m, COMMENT).about.record = 'servicedesk.nothing'),
        /names servicedesk\.nothing, which is not a read of this connector/,
      ],
      [
        'not a read',
        m => (cap(m, COMMENT).about.record = 'servicedesk.order'),
        /names servicedesk\.order, which is not a read of this connector/,
      ],
      [
        'a read that answers rows',
        m => {
          cap(m, COMMENT).about = { record: 'servicedesk.equipment', params: { ref: 'person' } };
        },
        /names servicedesk\.equipment, which answers rows; an action is about one record, a read whose view is record, detail, text or document/,
      ],
      [
        'a read without a view',
        m => (cap(m, COMMENT).about = { record: 'servicedesk.lookup', params: { ref: 'operationId' } }),
        /names servicedesk\.lookup, which declares no view/,
      ],
      [
        'an empty params',
        m => (cap(m, COMMENT).about.params = {}),
        /about\.params maps nothing; name the input properties the record fills, at least one/,
      ],
      [
        "a key that is not the action's input",
        m => (cap(m, COMMENT).about.params = { nowhere: 'ref' }),
        /about\.params maps nowhere, which is not a property of its input/,
      ],
      [
        "a value that is not the read's input",
        m => (cap(m, COMMENT).about.params = { ref: 'nowhere' }),
        /about\.params fills ref from nowhere, which is not a property of the input of servicedesk\.request/,
      ],
      [
        'an input that requires more than the record and the asks',
        m => {
          const c = cap(m, COMMENT);
          c.input = copy(c.input);
          c.input.properties.note = { type: 'string' };
          c.input.required.push('note');
          cap(m, 'servicedesk.commentEffect').input = c.input;
        },
        /an action about a record requires only what about\.params fills and what it asks, so the record's page can start it; note is neither/,
      ],
      [
        'an ask for what the record fills',
        m => cap(m, COMMENT).asks.push({ kind: 'text', property: 'ref', label: 'Beställning', required: true }),
        /ask "ref" names an input the record fills/,
      ],
      // What holds for every action holds for this one.
      ['an execute offered to the model', m => (cap(m, COMMENT).model = true), /execute capabilities are never tools/],
      ['an effect that is not a read', m => (cap(m, COMMENT).effect = 'servicedesk.order'), /is not a read/],
    ];
    for (const [what, change, problem] of refused)
      expect({ what, problems: problemsOf(change) }).toEqual({
        what,
        problems: expect.arrayContaining([expect.stringMatching(problem)]),
      });
    // Either form, never both: the published schema says so for a manifest, the loader for Clew's own connectors.
    expect(problemsOf(m => (cap(m, COMMENT).about.entity = 'person'))).toEqual([
      expect.stringMatching(/^\/capabilities\/2\/about: Expected union value/),
    ]);
    const both: Connector = {
      id: 'notes',
      kind: 'core',
      source: 'Anteckningar',
      areas: [],
      capabilities: [
        { ...noteRead(), about: undefined },
        { ...appendNote(), about: { record: 'notes.note', params: { id: 'id' }, entity: 'person' } as never },
      ],
    };
    expect(() => new Registry().register(both)).toThrow(/about is either \{ entity, param \} or \{ record, params \}/);
  });
});

/** A small connector of Clew's process: a note read by its id, which the model may read, and an append about it. */
function noteRead(): Capability {
  return {
    name: 'notes.note',
    kind: 'read',
    title: 'Anteckningen',
    description: 'En anteckning.',
    model: true,
    scope: {},
    input: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    } as never,
    output: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } as never,
    view: { kind: 'detail', title: 'title', fields: [{ key: 'title', label: 'Anteckning' }] },
    run: async (_actor, input) => {
      if ((input as { id: string }).id !== 'n1') throw new CapabilityError('Anteckningen finns inte.', 'not-found');
      return { title: 'Planeringen' };
    },
  };
}
function appendNote(scope: Capability['scope'] = {}): Capability {
  return {
    name: 'notes.append',
    kind: 'propose',
    title: 'Skriv till',
    description: 'Föreslår ett tillägg till anteckningen.',
    model: false,
    scope,
    input: {
      type: 'object',
      properties: { note: { type: 'string' }, text: { type: 'string', maxLength: 40 } },
      required: ['note', 'text'],
      additionalProperties: false,
    } as never,
    output: { type: 'object' } as never,
    about: { record: 'notes.note', params: { note: 'id' } },
    asks: [{ kind: 'text', property: 'text', label: 'Tillägg', required: true }],
    run: async () => {
      throw new Error('not here');
    },
  };
}
const notes = (scope?: Capability['scope']): Connector => ({
  id: 'notes',
  kind: 'passthrough',
  source: 'Anteckningar',
  areas: [],
  capabilities: [noteRead(), appendNote(scope)],
});

describe("the registry's index from a read to the actions about its records (D132)", () => {
  const desk = () => {
    const registry = new Registry();
    registry.register(fixtureConnectors({ only: ['servicedesk'], clock: () => T0 }).connectors[0]!);
    return registry;
  };
  test('a person who may call the read and the action gets it, with what it asks less what the record fills', () => {
    const registry = desk();
    expect(registry.recordActions(audiencedActorOf(hillevi), READ)).toEqual([
      {
        name: COMMENT,
        connectorId: 'servicedesk',
        source: 'IT-servicedesken',
        title: 'Lägg till en kommentar',
        kind: 'execute',
        params: { ref: 'ref' },
        path: { asks: [ASK], effect: true, description: DESCRIPTION },
      },
    ]);
    // Only under the read it is about: another read, or a read nobody declared, has none.
    expect(registry.recordActions(audiencedActorOf(hillevi), 'servicedesk.requests')).toEqual([]);
    expect(registry.recordActions(audiencedActorOf(hillevi), 'servicedesk.nothing')).toEqual([]);
  });
  test('switched off, outside the audience or the scope, the action is not listed; nor is it once the read is not theirs', () => {
    const registry = desk();
    const actor = audiencedActorOf(anna);
    expect(registry.recordActions(actor, READ).map(a => a.name)).toEqual([COMMENT]);
    registry.govern('servicedesk', deniedGovernance());
    expect(registry.recordActions(actor, READ)).toEqual([]);
    registry.govern('servicedesk', { ...openGovernance(), audience: { mode: 'selected', roles: ['manager'] } });
    expect(registry.recordActions(actor, READ)).toEqual([]);
    expect(registry.recordActions(audiencedActorOf(hillevi), READ)).toHaveLength(1);
    registry.govern('servicedesk', { ...openGovernance(), capabilities: { [COMMENT]: { enabled: false } } });
    expect(registry.recordActions(actor, READ)).toEqual([]);
    registry.govern('servicedesk', { ...openGovernance(), capabilities: { [READ]: { enabled: false } } });
    expect(registry.recordActions(actor, READ)).toEqual([]);
    // A scope that leaves the person out leaves the action out; the read stays theirs.
    const scoped = new Registry().register(notes({ roles: ['manager'] }));
    expect(scoped.recordActions(audiencedActorOf(anna), 'notes.note')).toEqual([]);
    expect(scoped.recordActions(audiencedActorOf(hillevi), 'notes.note').map(a => a.name)).toEqual(['notes.append']);
    // Never a model tool, whatever it declares (D132 item 4): the model never names the record.
    const offered = new Registry().register({
      ...notes(),
      capabilities: [noteRead(), { ...appendNote(), model: true }],
    });
    expect(offered.tools(audiencedActorOf(anna)).map(t => t.name)).toEqual(['notes.note']);
    expect(offered.recordActions(audiencedActorOf(anna), 'notes.note').map(a => a.name)).toEqual(['notes.append']);
    // Gone with its connector.
    scoped.unregister('notes');
    expect(scoped.recordActions(audiencedActorOf(hillevi), 'notes.note')).toEqual([]);
  });
});

/**
 * The world as the composition wires it (`composition/records.ts`): the registry with the service desk over the
 * protocol, the stream's started card on the memory thread store, its human decision into the execution ledger on its
 * memory store, and the records module between them. The ledger's source validates the approved input as
 * `composition/executions.ts` does; dispatch is the test's, as the ledger's worker would run it.
 */
function world() {
  const clock = () => T0;
  const fixtures = fixtureConnectors({ only: ['servicedesk'], clock });
  const registry = new Registry();
  registry.register(fixtures.connectors[0]!);
  const run = async (p: AuthenticatedContext, name: string, input: unknown) => {
    try {
      return await registry.run(audiencedActorOf(p), name, input);
    } catch (error) {
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
  };
  const store = memoryThreadStore();
  let n = 0;
  const started = startedCards({
    store,
    registry,
    run,
    digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32),
    clock,
    ids: () => 'card-' + ++n,
  });
  const ledger = memoryExecutionStore();
  const source: ExecutionSource = {
    async authorize(p, operation, input) {
      const found = await registry.validate(audiencedActorOf(p), operation, input);
      if (found.capability.kind !== 'execute') throw new ExecutionError('Förmågan är ingen åtgärd.');
      return { connector: found.connector.id, safety: found.capability.execution!, needsSession: false };
    },
    current: async () => undefined,
    execute: async () => {
      throw new Error('dispatched by the test');
    },
    lookup: async () => undefined,
  };
  let e = 0;
  const executions = executionUsecases({
    store: ledger,
    source,
    clock,
    ids: () => 'execution-' + ++e,
    digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  });
  const access = threadAccess(store, registry);
  const decisions = cardDecisions({
    read: (p, id) => access.read(p, id),
    registry,
    run,
    approve: executions.approve,
    clock,
  });
  const reads: string[] = [];
  const records: Records = async (actor, read) => {
    const found = registry.allowed(actor, read);
    if (!found || found.capability.kind !== 'read') return undefined;
    return {
      title: found.capability.title,
      ...(found.capability.view ? { view: found.capability.view } : {}),
      actions: registry.recordActions(actor, read),
    };
  };
  const actions = recordActionUsecases({
    records,
    read: async (p, read, input) => {
      reads.push(read);
      return registry.run(audiencedActorOf(p), read, input, { authorize: () => p.authorize(), direct: true });
    },
    start: started.startCard,
    decide: (p, threadId, answers) => decisions.act(p, threadId, STARTED_ACTION, undefined, undefined, answers),
    effect: decisions.effectFor,
    clock,
  });
  const request = (p: AuthenticatedContext, input = PRINTER) =>
    registry.run<Record<string, unknown>>(audiencedActorOf(p), READ, input);
  const nothingWritten = async () => {
    expect(store.dump()).toEqual([]);
    expect(store.audit).toEqual([]);
    expect(ledger.audit()).toEqual([]);
    expect(await request(hillevi)).not.toHaveProperty('text');
  };
  return { registry, store, ledger, access, decisions, actions, request, reads, nothingWritten };
}

describe('an action about a record, listed and run from its page (D132)', () => {
  test("the request's owner gets the comment with what it asks, once the request is read as her", async () => {
    const w = world();
    expect(await w.actions.list(hillevi, READ, PRINTER)).toEqual({
      actions: [
        {
          capability: COMMENT,
          connector: 'servicedesk',
          source: 'IT-servicedesken',
          title: 'Lägg till en kommentar',
          kind: 'execute',
          path: { asks: [ASK], effect: true, description: DESCRIPTION },
        },
      ],
    });
    expect(w.reads).toEqual([READ]);
    // A read with no actions about its records lists none, and is not made for that.
    expect(await w.actions.list(hillevi, 'servicedesk.equipment', { person: 'hillevi' })).toEqual({ actions: [] });
    expect(w.reads).toEqual([READ]);
    await w.nothingWritten();
  });

  test('a request the person may not read, a read they may not make, an input the read refuses: nothing is listed or run', async () => {
    const w = world();
    const values = { text: 'Hej' };
    for (const [who, read, input] of [
      [anna, READ, PRINTER],
      [hillevi, READ, ANNAS],
      [hillevi, READ, { ref: 'nonsense' }],
      [hillevi, READ, { ...PRINTER, extra: 1 }],
      [hillevi, 'servicedesk.nothing', PRINTER],
    ] as const) {
      const label = [who.userName, read, JSON.stringify(input)];
      expect([label, await w.actions.list(who, read, input)]).toEqual([label, undefined]);
      expect([label, await w.actions.start(who, read, input, COMMENT)]).toEqual([label, undefined]);
      expect([label, await w.actions.decide(who, read, input, COMMENT, values)]).toEqual([label, undefined]);
      expect([label, await w.actions.effect(who, read, input, COMMENT, values)]).toEqual([label, undefined]);
    }
    // An action the record does not offer: another read's, or none at all.
    expect(await w.actions.start(hillevi, READ, PRINTER, 'servicedesk.order')).toBeUndefined();
    expect(await w.actions.decide(hillevi, READ, PRINTER, 'servicedesk.nothing', values)).toBeUndefined();
    await w.nothingWritten();
    // Anna's own request is hers to comment on.
    expect((await w.actions.list(anna, READ, ANNAS))!.actions.map(a => a.capability)).toEqual([COMMENT]);
  });

  test('"Det här händer" is the effect read with what the record fills and the answer; nothing is written', async () => {
    const w = world();
    expect(await w.actions.effect(hillevi, READ, PRINTER, COMMENT, { text: 'Felkoden är E07.' })).toEqual({
      source: 'IT-servicedesken',
      rows: [
        {
          label: 'Din kommentar läggs till på SD-26110047 · Skrivare, Felanmälan',
          detail: 'Klientsupport ser den i ärendet',
        },
      ],
    });
    await expect(w.actions.effect(hillevi, READ, PRINTER, COMMENT, {})).rejects.toThrow('Kommentar behöver fyllas i.');
    await w.nothingWritten();
  });

  test('sent from the dialog: the card, the human decision into the ledger with its audit row, and the comment on the request once dispatched', async () => {
    const w = world();
    const { threadId } = (await w.actions.decide(hillevi, READ, PRINTER, COMMENT, { text: '  Felkoden är E07.  ' }))!;
    const card = (await w.access.read(hillevi, threadId))!;
    expect(card).toMatchObject({
      kind: 'pushed',
      connector: 'servicedesk',
      title: 'Lägg till en kommentar',
      summary: DESCRIPTION,
      // The person's choice, named as the request's page heads it.
      trigger: {
        reason: 'Du valde Lägg till en kommentar för SD-26110047 · Skrivare, Felanmälan',
        source: 'IT-servicedesken',
      },
      items: [
        {
          ref: 'record:servicedesk.request',
          label: 'SD-26110047 · Skrivare, Felanmälan',
          detail: 'Beställning eller felanmälan',
          selectable: false,
          selected: true,
        },
      ],
      // What the record fills is the card's own input; the answer is the decision's.
      actions: [{ id: STARTED_ACTION, capability: COMMENT, kind: 'execute', input: PRINTER }],
    });
    expect(w.store.audit).toEqual([
      expect.objectContaining({
        actor: 'person:person-hillevi',
        action: 'thread.started',
        subject: 'thread:' + threadId,
        details: expect.objectContaining({ capability: COMMENT, kind: 'execute', about: { record: READ } }),
      }),
    ]);
    // The approved intent in the ledger first (D45), with its audit row naming the answer; nothing reached the desk yet.
    const approved = { ...PRINTER, text: 'Felkoden är E07.' };
    expect(w.ledger.audit()).toEqual([
      expect.objectContaining({
        actor: 'person:person-hillevi',
        action: 'execution.approved',
        subject: 'execution:execution-1',
        details: expect.objectContaining({
          connector: 'servicedesk',
          operation: COMMENT,
          asked: { text: 'Felkoden är E07.' },
        }),
      }),
    ]);
    const execution = (await w.ledger.read('execution-1'))!;
    expect(execution.payload).toEqual(approved);
    expect(execution.presentation).toMatchObject({ threadId, actionId: STARTED_ACTION });
    expect(w.ledger.enqueued().map(s => s.id)).toEqual(['execution:execution-1']);
    expect(await w.request(hillevi)).not.toHaveProperty('text');
    // Dispatched as the ledger dispatches it: the desk keeps the comment once, and the request's read shows it.
    const receipt = {
      headline: 'Kommentaren är tillagd i IT-servicedesken.',
      rows: [
        {
          ref: PRINTER.ref,
          label: 'SD-26110047 · Skrivare, Felanmälan',
          outcome: 'done' as const,
          detail: 'din kommentar',
        },
      ],
    };
    const send = () =>
      w.registry.run<ExecuteResult>(audiencedActorOf(hillevi), COMMENT, execution.payload, {
        operationId: execution.id,
      });
    expect(await send()).toEqual(receipt);
    expect(await send()).toEqual(receipt);
    expect(await w.request(hillevi)).toMatchObject({ text: 'Felkoden är E07.' });
    expect(
      await w.registry.run(audiencedActorOf(hillevi), 'servicedesk.lookup', { operationId: execution.id }),
    ).toEqual({ found: true, result: receipt });
    // The same order sent again while its card is open is the one card.
    expect(await w.actions.decide(hillevi, READ, PRINTER, COMMENT, { text: 'Felkoden är E07.' })).toEqual({ threadId });
  });

  test("started without answers, the execute's card waits for the decision, which asks the text", async () => {
    const w = world();
    const { threadId } = (await w.actions.start(hillevi, READ, PRINTER, COMMENT))!;
    expect(w.ledger.audit()).toEqual([]);
    await expect(w.decisions.act(hillevi, threadId, STARTED_ACTION)).rejects.toThrow('Kommentar behöver fyllas i.');
    await w.decisions.act(hillevi, threadId, STARTED_ACTION, undefined, undefined, { text: 'Kan ni ringa mig?' });
    expect((await w.ledger.read('execution-1'))!.payload).toEqual({ ...PRINTER, text: 'Kan ni ringa mig?' });
  });

  test('what the record fills is never taken from an answer: one that names it is refused, and nothing is made', async () => {
    const w = world();
    await expect(w.actions.decide(hillevi, READ, PRINTER, COMMENT, { text: 'Hej', ref: ANNAS.ref })).rejects.toThrow(
      'Åtgärden frågar inte efter det värdet.',
    );
    await expect(w.actions.effect(hillevi, READ, PRINTER, COMMENT, { text: 'Hej', ref: ANNAS.ref })).rejects.toThrow(
      'Åtgärden frågar inte efter det värdet.',
    );
    // An execute takes its answers when it is decided, never when its card is made.
    await expect(w.actions.start(hillevi, READ, PRINTER, COMMENT, { text: 'Hej' })).rejects.toThrow(
      'Svaren ges när du beslutar på ärendet.',
    );
    // On its card the record's own `ref` is the action's input, and the decision cannot answer it either.
    const { threadId } = (await w.actions.start(hillevi, READ, PRINTER, COMMENT))!;
    await expect(
      w.decisions.act(hillevi, threadId, STARTED_ACTION, undefined, undefined, { text: 'Hej', ref: ANNAS.ref }),
    ).rejects.toThrow('Åtgärden frågar inte efter det värdet.');
    expect(w.ledger.audit()).toEqual([]);
    expect((await w.access.read(hillevi, threadId))!.actions[0]!.input).toEqual(PRINTER);
  });

  test('a propose about a record starts with its answers and the record, and becomes its draft’s card', async () => {
    const asked: unknown[] = [];
    const append: Capability = {
      ...appendNote(),
      run: async (_actor, input) => {
        asked.push(input);
        return {
          topic: 'notes:append:n1',
          area: 'notes',
          title: 'Tillägg till Planeringen',
          summary: 'Ett tillägg att skicka.',
          reason: 'x',
          actions: [],
        };
      },
    };
    const registry = new Registry().register({
      id: 'notes',
      kind: 'passthrough',
      source: 'Anteckningar',
      areas: [{ id: 'notes', title: 'Anteckningar', roles: ['manager', 'employee'], standing: [], schedules: [] }],
      capabilities: [noteRead(), append],
    });
    const store = memoryThreadStore();
    const started = startedCards({
      store,
      registry,
      run: (p, name, input) => registry.run(audiencedActorOf(p), name, input),
      digest: value => JSON.stringify(value),
      clock: () => T0,
      ids: () => 'card-1',
    });
    const uc = recordActionUsecases({
      records: async (actor, read) => ({ title: 'Anteckningen', actions: registry.recordActions(actor, read) }),
      read: (p, read, input) => registry.run(audiencedActorOf(p), read, input),
      start: started.startCard,
      effect: async () => {
        throw new Error('not here');
      },
      clock: () => T0,
    });
    await expect(uc.start(anna, 'notes.note', { id: 'n1' }, 'notes.append')).rejects.toThrow(
      'Tillägg behöver fyllas i.',
    );
    expect(await uc.start(anna, 'notes.note', { id: 'x' }, 'notes.append', { text: 'Hej' })).toBeUndefined();
    expect(await uc.start(anna, 'notes.note', { id: 'n1' }, 'notes.append', { text: ' Och mer. ' })).toEqual({
      threadId: 'card-1',
    });
    expect(asked).toEqual([{ text: 'Och mer.', note: 'n1' }]);
    expect(store.audit[0]!.details).toMatchObject({
      kind: 'propose',
      about: { record: 'notes.note' },
      asked: { text: 'Och mer.' },
    });
    // Without a decision port an execute is not decided from the page.
    await expect(uc.decide(anna, 'notes.note', { id: 'n1' }, 'notes.append', { text: 'x' })).rejects.toThrow(
      'Åtgärden kan inte beslutas härifrån.',
    );
  });

  test('the pure part: what the record fills, and what it is called', () => {
    expect(filledBy({ ref: 'ref', note: 'id' }, { ref: 'r1', id: 'n1', other: 1 })).toEqual({ ref: 'r1', note: 'n1' });
    expect(filledBy({ ref: 'ref' }, {})).toEqual({});
    const detail = { kind: 'detail' as const, title: 'label', fields: [{ key: 'label', label: 'L' }] };
    expect(recordLabel(detail, { label: '  SD-1 · Dator  ' })).toBe('SD-1 · Dator');
    expect(recordLabel(detail, { label: '' })).toBeUndefined();
    expect(recordLabel({ kind: 'text', body: 'label' }, { label: 'x' })).toBeUndefined();
  });
});

describe('the routes (D132)', () => {
  function stack(who = hillevi) {
    const w = world();
    const routes = recordRoutes({
      actions: w.actions,
      guard: async (c, next) => {
        c.set('session', { context: who } as never);
        await next();
      },
    });
    // Served as `main.ts` mounts it under /api/records; the paths below are the part after that.
    const get = (path: string) => routes.request('http://clew.test' + path);
    const post = (path: string, body: string) =>
      routes.request('http://clew.test' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    return { ...w, get, post };
  }
  const input = encodeURIComponent(JSON.stringify(PRINTER));
  test("a record's actions, its effect and its decision reach their use case; what the reader may not reach is the one 404", async () => {
    const w = stack();
    const listed = await w.get(`/${READ}/actions?input=${input}`);
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { actions: Array<{ capability: string }> }).actions.map(a => a.capability),
    ).toEqual([COMMENT]);
    const effect = await w.post(
      `/${READ}/effect`,
      JSON.stringify({ input: PRINTER, capability: COMMENT, values: { text: 'Hej' } }),
    );
    expect(effect.status).toBe(200);
    const decided = await w.post(
      `/${READ}/decide`,
      JSON.stringify({ input: PRINTER, capability: COMMENT, values: { text: 'Hej' } }),
    );
    expect(decided.status).toBe(200);
    const { threadId } = (await decided.json()) as { threadId: string };
    expect(w.store.dump().map(r => r.thread.id)).toEqual([threadId]);
    for (const answer of [
      await w.get(`/${READ}/actions?input=${encodeURIComponent(JSON.stringify(ANNAS))}`),
      await w.get(`/servicedesk.nothing/actions?input=${input}`),
      await w.get(`/not-a-capability/actions`),
      await w.post(`/${READ}/actions`, JSON.stringify({ input: ANNAS, capability: COMMENT })),
      await w.post(`/${READ}/decide`, JSON.stringify({ input: ANNAS, capability: COMMENT, values: { text: 'x' } })),
    ]) {
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ error: 'Okänd adress.' });
    }
    expect(w.store.dump()).toHaveLength(1);
  });
  test('a body or an input out of shape is refused, and a refused answer is said in Swedish', async () => {
    const w = stack();
    for (const body of [
      'not json',
      JSON.stringify({ capability: COMMENT }),
      JSON.stringify({ input: PRINTER, capability: 'nope' }),
      JSON.stringify({ input: PRINTER, capability: COMMENT, extra: true }),
      JSON.stringify({ input: [PRINTER], capability: COMMENT }),
      JSON.stringify({ input: PRINTER, capability: COMMENT, values: { text: 3 } }),
      JSON.stringify({ input: { ref: 'x'.repeat(2001) }, capability: COMMENT }),
    ]) {
      const answer = await w.post(`/${READ}/decide`, body);
      expect([body.slice(0, 60), answer.status]).toEqual([body.slice(0, 60), 400]);
      expect(await answer.json()).toEqual({ error: 'Ogiltig förfrågan.' });
    }
    expect((await w.get(`/${READ}/actions?input=nope`)).status).toBe(400);
    const named = await w.post(
      `/${READ}/decide`,
      JSON.stringify({ input: PRINTER, capability: COMMENT, values: { text: 'x', ref: ANNAS.ref } }),
    );
    expect(named.status).toBe(400);
    expect(await named.json()).toEqual({ error: 'Åtgärden frågar inte efter det värdet.' });
    await w.nothingWritten();
  });
});

/**
 * The assistant fills in the actions of the record that stands open (D132 item 4): `clew.draftAction` is offered for
 * the actions about that record and that record only, as the question is asked beside its page (D131). The model picks
 * the action and its values and never the record; the values are checked against the asks as the decision will check
 * them; nothing is written and no source is reached beyond the record's read the turn makes anyway. The draft comes back
 * on the answer with the action as the person may take it, and is kept on the stored message without it.
 */
describe('the assistant fills in an action about the record that stands open (D132 item 4)', () => {
  type Callable = { execute: (input: unknown, options: unknown) => Promise<unknown> };
  type Played = { tools: Record<string, unknown>; system: string };
  function assistantWorld(play: (turn: Played) => Promise<{ text: string; toolCalls: [] }>) {
    const clock = () => T0;
    const registry = new Registry();
    registry.register(fixtureConnectors({ only: ['servicedesk'], clock }).connectors[0]!);
    registry.register(notes());
    const store = memoryThreadStore();
    const modelStore = memoryModelStore();
    const turns: Played[] = [];
    const generate: ModelGenerate = async ({ tools, system }) => {
      const turn = { tools: tools as Record<string, unknown>, system };
      turns.push(turn);
      return play(turn);
    };
    const models = modelUsecases({
      store: modelStore,
      wire: memoryModelWire({ endpoints: { 'http://llm.test/v1': { models: ['open-model'] } }, generate }),
      health: memoryModelHealth(),
      clock,
      sealer: { seal: v => v, open: v => v },
    });
    const at = T0.toISOString();
    const seeded = modelStore.transaction(async tx => {
      await tx.insertProvider({
        id: 'llm',
        title: 'Kommunens modeller',
        baseUrl: 'http://llm.test/v1',
        apiKey: null,
        health: { status: 'ok', at },
        createdBy: 'test',
        at,
      });
      await tx.insertModel({
        id: 'open-model',
        providerId: 'llm',
        model: 'open-model',
        title: 'Öppen modell',
        description: '',
        tools: true,
        createdBy: 'test',
        at,
      });
      await tx.updateModel('open-model', { state: 'enabled', isDefault: true }, 'test', at);
    });
    let n = 0;
    const sent: string[] = [];
    const assistant = assistantUsecases({
      store,
      registry,
      run: (p, name, input, context) => {
        sent.push(name);
        return registry.run(audiencedActorOf(p), name, input, context);
      },
      calendar: {} as never,
      models: {
        resolve: async p => {
          await seeded;
          return models.resolve(p);
        },
        health: memoryModelHealth(),
      },
      clock,
      ids: () => 'conversation-' + ++n,
      log: () => {},
    });
    const ask = (text: string, thing?: { capability: string; input: Record<string, unknown> }, who = hillevi) =>
      assistant.converse(who, { text, ...(thing ? { thing: { kind: 'record' as const, ...thing } } : {}) });
    return { registry, store, turns, sent, ask };
  }
  const drafting =
    (...calls: Array<Record<string, unknown>>) =>
    async ({ tools }: Played) => {
      const draft = tools['clew__draftAction'] as Callable | undefined;
      for (const call of calls) answers.push(draft ? await draft.execute(call, {}) : 'no tool');
      return { text: 'Jag har fyllt i kommentaren. Inget är skickat.', toolCalls: [] as [] };
    };
  let answers: unknown[] = [];

  test('beside a request of hers the comment is offered and filled in; the draft is about that request, nothing is sent', async () => {
    answers = [];
    const w = assistantWorld(
      drafting(
        // The model cannot name the record: what the record fills is no answer, and another action is none of its.
        { action: COMMENT, values: { text: 'Hej', ref: ANNAS.ref } },
        { action: 'servicedesk.order', values: { text: 'Hej' } },
        { action: COMMENT, values: { text: '   ' } },
        { action: COMMENT, values: { text: '  Felkoden är E07.  ' } },
      ),
    );
    const turn = await w.ask('Skriv att felkoden är E07', { capability: READ, input: PRINTER });
    expect(answers).toEqual([
      { error: 'Åtgärden frågar inte efter det värdet.' },
      { error: 'Posten har ingen sådan åtgärd.' },
      { error: 'Kommentar behöver fyllas i.' },
      { drafted: true, note: 'Utkastet visas för personen. Inget är skickat.' },
    ]);
    // The tool names the record by its read's title, takes the action and the values only, and says the person sends it.
    const tool = w.turns[0]!.tools['clew__draftAction'] as { description: string; inputSchema: { jsonSchema: any } };
    expect(tool.description).toStartWith(
      'Fyll i en av åtgärderna för den öppna posten "Beställning eller felanmälan" som ett utkast åt personen. Du fyller bara i det åtgärden frågar efter; posten är den som står öppen bredvid samtalet och anges aldrig. Ingenting skickas eller sparas i något system: personen granskar utkastet och skickar det själv med åtgärdens knapp.',
    );
    const schema = tool.inputSchema.jsonSchema;
    expect(Object.keys(schema.properties)).toEqual(['action', 'values']);
    expect(schema.properties.action.enum).toEqual([COMMENT]);
    expect(Object.keys(schema.properties.values.properties)).toEqual(['text']);
    expect(w.turns[0]!.system).toContain('När personen vill att en av den öppna postens åtgärder görs:');
    expect(w.turns[0]!.system).toContain('posten är den som står öppen bredvid samtalet och anges inte');
    // The request is no read of the assistant's (`model: false`): it is told so, and its actions may still be filled in.
    expect(w.turns[0]!.system).toContain(
      'Den öppna posten "Beställning eller felanmälan" (IT-servicedesken) kan du inte läsa.',
    );
    const values = { text: 'Felkoden är E07.' };
    expect(turn).toMatchObject({
      shape: 'forslag',
      assistant: 'model',
      recordDraft: {
        capability: COMMENT,
        record: { capability: READ, input: PRINTER },
        values,
        action: {
          capability: COMMENT,
          connector: 'servicedesk',
          source: 'IT-servicedesken',
          title: 'Lägg till en kommentar',
          kind: 'execute',
          path: { asks: [ASK], effect: true, description: DESCRIPTION },
        },
      },
    });
    expect(turn).not.toHaveProperty('draft');
    // Kept with the answer, without the action, which is resolved again whenever it is drawn.
    expect(turn.thread.messages.at(-1)!.meta?.recordDraft).toEqual({
      capability: COMMENT,
      record: { capability: READ, input: PRINTER },
      values,
    });
    // One audit row for the turn: which action about a record of which read, and which asks it answered; never the
    // values, the request or the text.
    const row = w.store.audit.at(-1)!;
    expect(row).toMatchObject({
      action: 'conversation.asked',
      details: { thing: 'record', tools: [], drafted: { record: READ, action: COMMENT, asks: ['text'] } },
    });
    for (const content of ['E07', 'SD-26110047', 'Jag har fyllt i']) expect(JSON.stringify(row)).not.toContain(content);
    // Nothing was sent or started, and the desk was asked nothing: the request has no comment, no source was read.
    expect(w.store.dump().map(r => r.thread.kind)).toEqual(['question']);
    expect(w.sent).toEqual([]);
    expect(await w.registry.run<Record<string, unknown>>(audiencedActorOf(hillevi), READ, PRINTER)).not.toHaveProperty(
      'text',
    );
  });

  test('only for the record that stands open: none open, another read’s record, or an input the read refuses offer no draft', async () => {
    answers = [];
    const w = assistantWorld(drafting({ action: COMMENT, values: { text: 'Hej' } }));
    await w.ask('Skriv en kommentar');
    await w.ask('Skriv en kommentar', { capability: 'servicedesk.equipment', input: { person: 'hillevi' } });
    await w.ask('Skriv en kommentar', { capability: READ, input: { ref: 'nonsense' } });
    expect(w.turns.map(t => DRAFT_TOOL.replace('.', '__') in t.tools)).toEqual([false, false, false]);
    expect(answers).toEqual(['no tool', 'no tool', 'no tool']);
    for (const turn of w.turns) expect(turn.system).not.toContain('clew__draftAction');
  });

  test('a record the assistant reads is read once for the turn: answered, its actions are offered; refused, nothing is', async () => {
    answers = [];
    const w = assistantWorld(drafting({ action: 'notes.append', values: { text: 'Och mer.' } }));
    const turn = await w.ask('Lägg till och mer', { capability: 'notes.note', input: { id: 'n1' } });
    expect(answers).toEqual([{ drafted: true, note: 'Utkastet visas för personen. Inget är skickat.' }]);
    expect(w.sent).toEqual(['notes.note']);
    expect(turn.recordDraft).toMatchObject({
      capability: 'notes.append',
      record: { capability: 'notes.note', input: { id: 'n1' } },
      values: { text: 'Och mer.' },
      action: { kind: 'propose', title: 'Skriv till' },
    });
    // A read of the assistant's that its source refuses: the record is not one the person can act on, so no draft.
    const refused = await w.ask('Lägg till och mer', { capability: 'notes.note', input: { id: 'x' } });
    expect(answers).toHaveLength(2);
    expect(answers[1]).toBe('no tool');
    expect(refused).not.toHaveProperty('recordDraft');
    expect(w.store.dump().every(r => r.thread.kind === 'question')).toBe(true);
  });
});
