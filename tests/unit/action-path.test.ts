import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { Ask, AuthenticatedContext, DayView, EntityAction } from '../../packages/contracts/src/index';
import { actorOf, answersOf, CapabilityError, type Connector } from '../../packages/connectors/src/index';
import { manifestProblems, parseManifest } from '../../packages/connectors/src/remote';
import { previewManifest } from '../../packages/connectors/src/preview';
import { freeSlots } from '../../packages/calendar/src/proposals';
import { manifest as hrManifest } from '../../connectors/hr/connector.mjs';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { startedCards } from '../../apps/server/src/threads/usecases/started';
import { askUsecases } from '../../apps/server/src/threads/usecases/asks';
import { entityActionUsecases } from '../../apps/server/src/modules/entities/actions';
import { eventUsecases } from '../../apps/server/src/modules/calendar/usecases/events';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { ExecutionError, type ExecutionSource } from '../../apps/server/src/modules/executions/model';
import { InputError } from '../../apps/server/src/context';
import { Registry } from '../registry';
import { fixtureConnectors } from '../fixture-connectors';

/**
 * The one path a write passes (D112 item 10): what a capability asks the person (`asks`) and what it says beforehand that
 * it will write (`effect`). The loader's rules for both, the answers checked against the asks, the card's path resolved
 * from the registered manifest, the effect read that writes nothing, the human decision with the answers in its audit
 * row and approved intent, the started card of an execute that waits for its answers, and the free times a meeting ask
 * suggests from the person's own calendar. The HR fixture's `hr.bookTalk` is the first use, run over the protocol.
 */
const T0 = new Date('2026-11-04T08:00:00+01:00');
/** How long the HR fixture's talk is (`TALK_MINUTES` in its manifest). */
const TALK_MINUTES = 45;
const LATER = '2026-11-12T13:15:00.000Z';
const persona = (id = 'hillevi', unitId = 'unit-skola'): AuthenticatedContext => ({
  id,
  name: 'Hillevi Berg',
  unitId,
  unitLabel: 'Skönsmons skola',
  role: 'manager',
  userName: id,
  organisationId: 'test',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const edited = (change: (m: any) => void) => {
  const m = copy(hrManifest);
  change(m);
  return m;
};
const cap = (m: any, name: string) => m.capabilities.find((c: any) => c.name === name);
const problemsOf = (change: (m: any) => void) => manifestProblems(edited(change), 'hr');

describe('the loader holds asks and effect to their rules (D112)', () => {
  test("the HR fixture's talk asks for a time, a place and a message, and names the read that says what it writes", () => {
    expect(manifestProblems(hrManifest, 'hr')).toEqual([]);
    const m = parseManifest(hrManifest, 'hr');
    const book = m.capabilities.find(c => c.name === 'hr.bookTalk')!;
    expect(book.asks).toEqual([
      { kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: TALK_MINUTES },
      { kind: 'text', property: 'place', label: 'Plats', required: false },
      { kind: 'long-text', property: 'message', label: 'Meddelande till medarbetaren', required: false },
    ]);
    expect(book.effect).toBe('hr.bookTalkEffect');
    const effect = m.capabilities.find(c => c.name === 'hr.bookTalkEffect')!;
    expect([effect.kind, effect.model, effect.input]).toEqual(['read', false, book.input]);
    expect(m.capabilities.find(c => c.name === 'hr.decideLeave')!.asks).toEqual([
      { kind: 'long-text', property: 'comment', label: 'Kommentar till medarbetaren', required: false },
    ]);
  });
  test('asks belong to a propose or an execute that is not a follower', () => {
    expect(
      problemsOf(m => (cap(m, 'hr.whoIsOn').asks = [{ kind: 'text', property: 'x', label: 'X', required: false }])),
    ).toContain('Capability hr.whoIsOn: asks belong to a propose or an execute (D112).');
    expect(
      problemsOf(
        m => (cap(m, 'hr.proposeAbsence').asks = [{ kind: 'text', property: 'fact', label: 'X', required: false }]),
      ),
    ).toContain('Capability hr.proposeAbsence: a follower is asked with a fact and asks the person nothing (D112).');
  });
  test('an ask names a property of the input, once, and never the entity key', () => {
    expect(problemsOf(m => cap(m, 'hr.bookTalk').asks.push({ ...cap(m, 'hr.bookTalk').asks[1] }))).toContain(
      'Capability hr.bookTalk: ask "place" is asked twice (D112).',
    );
    expect(
      problemsOf(m =>
        cap(m, 'hr.bookTalk').asks.push({ kind: 'text', property: 'room', label: 'Rum', required: false }),
      ),
    ).toContain('Capability hr.bookTalk: ask "room" names no property of the input (D112).');
    expect(
      problemsOf(
        m => (cap(m, 'hr.prepareAbsence').asks = [{ kind: 'text', property: 'person', label: 'Vem', required: true }]),
      ),
    ).toContain('Capability hr.prepareAbsence: ask "person" names the input that takes the entity\'s key (D112).');
  });
  test("an ask's kind fits its property, and a property the input requires is a required ask", () => {
    const talk = (change: (input: any, asks: Ask[]) => void) =>
      problemsOf(m => {
        const c = cap(m, 'hr.bookTalk');
        change(c.input, c.asks);
        cap(m, 'hr.bookTalkEffect').input = c.input;
      });
    expect(talk(input => (input.properties.when = { type: 'integer' }))).toContain(
      'Capability hr.bookTalk: ask "when" is a meeting, which takes a string property without enum (format date-time when it declares one) (D112).',
    );
    expect(talk(input => (input.properties.when = { type: 'string', format: 'date' }))).toContain(
      'Capability hr.bookTalk: ask "when" is a meeting, which takes a string property without enum (format date-time when it declares one) (D112).',
    );
    expect(talk(input => (input.properties.place = { type: 'string', enum: ['a', 'b'] }))).toContain(
      'Capability hr.bookTalk: ask "place" is text, which takes a string property without enum or format (D112).',
    );
    expect(
      talk((_input, asks) => (asks[2] = { kind: 'date', property: 'message', label: 'Dag', required: false })),
    ).toEqual([]);
    expect(talk(input => (input.properties.message = { type: 'string', format: 'email' }))).toContain(
      'Capability hr.bookTalk: ask "message" is long-text, which takes a string property without enum or format (D112).',
    );
    expect(talk(input => (input.required = ['refs', 'place']))).toContain(
      'Capability hr.bookTalk: ask "place" is optional, but the input requires place (D112).',
    );
    // A choice names every value of the enum once, with its Swedish label.
    const choice = (options: Array<{ value: string; label: string }>) =>
      problemsOf(
        m =>
          (cap(m, 'hr.decideLeave').asks = [
            { kind: 'choice', property: 'decision', label: 'Beslut', required: true, options },
          ]),
      );
    expect(
      choice([
        { value: 'approve', label: 'Godkänn' },
        { value: 'reject', label: 'Avslå' },
      ]),
    ).toEqual([]);
    for (const options of [
      [
        { value: 'approve', label: 'Godkänn' },
        { value: 'maybe', label: 'Kanske' },
      ],
      [
        { value: 'approve', label: 'Godkänn' },
        { value: 'approve', label: 'Ja' },
      ],
    ])
      expect(choice(options)).toContain(
        'Capability hr.decideLeave: ask "decision" is a choice, whose options name every value of the property\'s enum once (D112).',
      );
  });
  test('an action about a person may require what it asks, and nothing else beside the key', () => {
    const asking = (required: string[], asks: Ask[]) =>
      problemsOf(m => {
        const c = cap(m, 'hr.prepareAbsence');
        c.input.required = required;
        if (asks.length) c.asks = asks;
      });
    const from: Ask = { kind: 'date', property: 'from', label: 'Från', required: true };
    expect(asking(['person', 'from'], [from])).toEqual([]);
    expect(asking(['person', 'from'], [])).toContain(
      "Capability hr.prepareAbsence: an action about an entity requires person and otherwise only what it asks, so the entity's menu can start it with the key and the person's answers; anything more is optional with a default the source chooses (D97, D112).",
    );
  });
  test('the effect is a read of this connector with the same input, never a tool, and belongs to an execute', () => {
    expect(problemsOf(m => (cap(m, 'hr.prepareAbsence').effect = 'hr.bookTalkEffect'))).toContain(
      'Capability hr.prepareAbsence: effect belongs to an execute (D112).',
    );
    expect(problemsOf(m => (cap(m, 'hr.bookTalk').effect = 'hr.unbookTalk'))).toContain(
      'Capability hr.bookTalk: effect names hr.unbookTalk, which is not a read of this connector (D112).',
    );
    expect(problemsOf(m => (cap(m, 'hr.bookTalk').effect = 'hr.nothing'))).toContain(
      'Capability hr.bookTalk: effect names hr.nothing, which is not a read of this connector (D112).',
    );
    expect(problemsOf(m => (cap(m, 'hr.bookTalkEffect').model = true))).toContain(
      'Capability hr.bookTalk: effect hr.bookTalkEffect is offered to the model; an effect read declares model: false (D112).',
    );
    expect(problemsOf(m => delete cap(m, 'hr.bookTalkEffect').input.properties.message)).toContain(
      'Capability hr.bookTalk: effect hr.bookTalkEffect takes another input than hr.bookTalk; it declares the same input schema (D112).',
    );
    // The same schema written in another key order is the same input.
    expect(
      problemsOf(m => {
        const input = cap(m, 'hr.bookTalkEffect').input;
        cap(m, 'hr.bookTalkEffect').input = Object.fromEntries(Object.entries(input).reverse());
      }),
    ).toEqual([]);
  });
  test('a draft leaves nothing its capability requires to nobody: input, rows, review or an ask fills it', () => {
    const { connectors } = fixtureConnectors({ only: ['hr'], clock: () => T0 });
    const registry = new Registry();
    registry.register(connectors[0]!);
    const book = {
      id: 'book',
      label: 'Boka',
      capability: 'hr.bookTalk',
      kind: 'execute' as const,
      role: 'primary' as const,
    };
    // refs is required: the rows give it, an input gives it, nothing else does.
    expect(registry.draftProblem('hr', { actions: [{ ...book, usesItems: true }] })).toBeUndefined();
    expect(registry.draftProblem('hr', { actions: [{ ...book, input: { refs: ['hr:emp:1001'] } }] })).toBeUndefined();
    expect(registry.draftProblem('hr', { actions: [book] })).toBe(
      'action book leaves refs, which hr.bookTalk requires, to nobody: give it in input, use the rows or ask for it',
    );
    const decide = { ...book, id: 'decide', capability: 'hr.decideLeave', usesItems: true };
    expect(registry.draftProblem('hr', { actions: [decide] })).toBe(
      'action decide leaves decision, which hr.decideLeave requires, to nobody: give it in input, use the rows or ask for it',
    );
    expect(registry.draftProblem('hr', { actions: [{ ...decide, input: { decision: 'approve' } }] })).toBeUndefined();
  });
  test('the preview shows both halves of a write: where it starts, what it draws, who fills its input (D112 item 11)', () => {
    const preview = previewManifest(hrManifest, { id: 'hr' });
    expect(preview.ok).toBe(true);
    const book = preview.manifest!.capabilities.find(c => c.name === 'hr.bookTalk')!;
    expect(book.effect).toBe('hr.bookTalkEffect');
    expect(book.path!.starts).toEqual([
      { place: 'work-item', state: 'declared', declares: 'scan: true' },
      { place: 'entity', state: 'not-declared', declares: 'about: { entity, param }' },
      { place: 'question-box', state: 'not-declared', declares: 'areas[].standing' },
      { place: 'conversation', state: 'never', declares: 'model: true' },
      { place: 'fact', state: 'declared', declares: 'follows, on a propose of this manifest' },
    ]);
    expect(book.path!.steps.map(s => [s.step, s.state])).toEqual([
      ['fill-in', 'declared'],
      ['effect', 'declared'],
      ['confirm', 'on-the-work-item'],
      ['review', 'on-the-work-item'],
      ['receipt', 'always'],
    ]);
    expect(book.path!.input.map(i => [i.property, i.by, i.required, i.type])).toEqual([
      ['refs', 'rows', true, 'array of string'],
      ['when', 'person', false, 'string, date-time'],
      ['place', 'person', false, 'string'],
      ['message', 'person', false, 'string'],
    ]);
    expect(book.path!.input[1]!.ask).toMatchObject({ kind: 'meeting', label: 'När' });
    const prepare = preview.manifest!.capabilities.find(c => c.name === 'hr.prepareAbsence')!;
    expect(prepare.path!.starts.find(s => s.place === 'entity')!.state).toBe('declared');
    expect(prepare.path!.steps.find(s => s.step === 'effect')!.state).toBe('never');
    expect(prepare.path!.input.map(i => [i.property, i.by])).toEqual([
      ['person', 'entity'],
      ['from', 'source'],
    ]);
    const decide = preview.manifest!.capabilities.find(c => c.name === 'hr.decideLeave')!;
    expect(decide.path!.input.map(i => [i.property, i.by])).toEqual([
      ['refs', 'rows'],
      ['decision', 'work-item'],
      ['comment', 'person'],
    ]);
    expect(preview.manifest!.capabilities.find(c => c.name === 'hr.whoIsOn')!.path).toBeUndefined();
  });
});

describe("the person's answers (D112)", () => {
  const asks: Ask[] = [
    { kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: 45 },
    { kind: 'text', property: 'place', label: 'Plats', required: false },
    { kind: 'date', property: 'day', label: 'Dag', required: false },
    {
      kind: 'choice',
      property: 'decision',
      label: 'Beslut',
      required: false,
      options: [
        { value: 'approve', label: 'Godkänn' },
        { value: 'reject', label: 'Avslå' },
      ],
    },
  ];
  const now = T0.toISOString();
  test('are taken as given for what is asked: a text trimmed, an optional answer left empty not sent', () => {
    expect(answersOf(asks, { when: LATER, place: '  Rum 12 ', day: '2026-11-20', decision: 'reject' }, now)).toEqual({
      answers: { when: LATER, place: 'Rum 12', day: '2026-11-20', decision: 'reject' },
    });
    expect(answersOf(asks, { when: LATER, place: '   ' }, now)).toEqual({ answers: { when: LATER } });
  });
  test('refuse what is not asked, a required answer left empty, and an answer that does not fit its kind or length', () => {
    const input = { type: 'object', properties: { place: { type: 'string', maxLength: 5 } } };
    expect(answersOf(asks, { when: LATER, place: 'Rum 123' }, now, input)).toEqual({
      problem: 'Plats: högst 5 tecken.',
    });
    expect(answersOf(asks, { when: LATER, refs: 'x' }, now)).toEqual({
      problem: 'Åtgärden frågar inte efter det värdet.',
    });
    expect(answersOf(asks, {}, now)).toEqual({ problem: 'När behöver fyllas i.' });
    expect(answersOf(asks, { when: '2026-11-01T10:00:00Z' }, now)).toEqual({
      problem: 'När: tiden har redan passerat.',
    });
    expect(answersOf(asks, { when: 'torsdag' }, now)).toEqual({ problem: 'När: välj en tid.' });
    expect(answersOf(asks, { when: LATER, day: '2026-02-30' }, now)).toEqual({ problem: 'Dag: välj ett datum.' });
    expect(answersOf(asks, { when: LATER, decision: 'maybe' }, now)).toEqual({
      problem: 'Beslut: välj ett av alternativen.',
    });
  });
});

/**
 * The stream, the ledger and the HR fixture over the protocol, wired as the composition wires them: a scan pushes the
 * rehab card, the person's decision goes through `cardDecisions` into the execution ledger on its memory store. The
 * ledger's source validates the approved input as `composition/executions.ts` does; dispatch is the source's own call.
 */
function world() {
  const clock = () => T0;
  const fixtures = fixtureConnectors({ only: ['hr'], clock });
  const registry = new Registry();
  registry.register(fixtures.connectors[0]!);
  const run = <O = unknown>(p: AuthenticatedContext, name: string, input: unknown) =>
    registry.run<O>(actorOf(p), name, input).catch(error => {
      throw new InputError(error instanceof Error ? error.message : String(error));
    });
  const store = memoryThreadStore();
  let n = 0;
  const threads = threadUsecases({
    store,
    registry,
    run,
    calendar: {
      ensureProposalThread: async () => undefined,
      replan: async () => {
        throw new Error('not here');
      },
      dismiss: async () => {
        throw new Error('not here');
      },
      todayEvents: async () => [],
    },
    clock,
    ids: () => 'card-' + ++n,
  });
  const ledger = memoryExecutionStore();
  const source: ExecutionSource = {
    async authorize(p, operation, input) {
      const found = await registry.validate(actorOf(p), operation, input);
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
  const decisions = cardDecisions({ read: threads.threadFor, registry, run, approve: executions.approve, clock });
  return { registry, threads, decisions, ledger, store, states: fixtures.states };
}
async function rehabCard(w: ReturnType<typeof world>, p = persona()) {
  await w.threads.ensureThreads(p);
  const cards = await w.threads.listThreadsFor(p);
  return {
    rehab: cards.find(t => t.topic === 'hr:rehab:hr:emp:1001')!,
    leave: cards.find(t => t.topic.startsWith('hr:leave:'))!,
  };
}

describe('a work item whose write asks (D112)', () => {
  test("the card's actions carry their path from the registered manifest, never from the draft", async () => {
    const w = world();
    const { rehab, leave } = await rehabCard(w);
    const book = rehab.actions.find(a => a.id === 'book')!;
    expect(book.path).toEqual({
      asks: parseManifest(hrManifest, 'hr').capabilities.find(c => c.name === 'hr.bookTalk')!.asks!,
      effect: true,
      description: 'Registrerar ett omtankesamtal i personalsystemet.',
    });
    expect(rehab.actions.find(a => a.id === 'pattern')!.path).toBeUndefined();
    // The leave card's decision is the button's own input; only the comment is asked, on approve and on reject.
    for (const id of ['approve', 'reject'])
      expect(leave.actions.find(a => a.id === id)!.path).toEqual({
        asks: [{ kind: 'long-text', property: 'comment', label: 'Kommentar till medarbetaren', required: false }],
        effect: false,
        description: 'Beslutar en ledighetsansökan i personalsystemet.',
      });
    // What the store keeps is the draft as it came: no path.
    const stored = await w.store.readThread('hillevi', rehab.id);
    expect(stored!.actions.some(a => 'path' in a)).toBe(false);
  });
  test('"Det här händer" is the effect read for exactly that input, and nothing is written or audited', async () => {
    const w = world();
    const { rehab } = await rehabCard(w);
    const before = w.store.audit.length;
    expect(
      await w.decisions.effect(persona(), rehab.id, 'book', undefined, {
        when: LATER,
        place: 'Rum 12',
        message: 'Hej!',
      }),
    ).toEqual({
      source: 'Personalsystemet',
      rows: [
        {
          label: 'Omtankesamtalet registreras',
          detail: 'På medarbetaren, torsdag 12 november kl. 14:15, Rum 12, med ditt meddelande',
        },
      ],
      undoMinutes: 10,
    });
    expect(w.states.hr!.get('talks', {})).toEqual({});
    expect(w.ledger.audit()).toEqual([]);
    expect(w.store.audit.length).toBe(before);
    // The answers are checked as the decision checks them; a write without an effect says nothing beforehand.
    await expect(w.decisions.effect(persona(), rehab.id, 'book', undefined, {})).rejects.toThrow(
      'När behöver fyllas i.',
    );
    const { leave } = await rehabCard(w);
    await expect(w.decisions.effect(persona(), leave.id, 'approve')).rejects.toThrow(
      'Åtgärden säger inte i förväg vad den gör.',
    );
  });
  test('the decision takes the answers into the approved input and its audit row, in the same commit', async () => {
    const w = world();
    const { rehab } = await rehabCard(w);
    const result = await w.decisions.act(persona(), rehab.id, 'book', undefined, undefined, {
      when: LATER,
      place: '  Rum 12 ',
      message: 'Hej! Ses vi på torsdag?',
    });
    expect(result.kind).toBe('execute');
    const asked = { when: LATER, place: 'Rum 12', message: 'Hej! Ses vi på torsdag?' };
    const audit = w.ledger.audit();
    expect(audit).toEqual([
      expect.objectContaining({
        actor: 'person:hillevi',
        action: 'execution.approved',
        subject: 'execution:execution-1',
        details: expect.objectContaining({ connector: 'hr', operation: 'hr.bookTalk', asked }),
      }),
    ]);
    const execution = (await w.ledger.read('execution-1'))!;
    expect(execution.payload).toEqual({ refs: ['hr:emp:1001'], ...asked });
    expect(execution.presentation).toEqual({ threadId: rehab.id, version: rehab.updatedAt, actionId: 'book' });
    expect(w.ledger.enqueued().map(s => s.id)).toEqual(['execution:execution-1']);
    // Dispatched as the ledger dispatches it, the source keeps the time, the place and the message with the talk.
    await w.registry.run(actorOf(persona()), 'hr.bookTalk', execution.payload, { operationId: execution.id });
    expect(w.states.hr!.get<Record<string, unknown>>('talks', {})['hr:emp:1001']).toMatchObject({
      when: LATER,
      place: 'Rum 12',
      message: 'Hej! Ses vi på torsdag?',
    });
  });
  test('an answer to anything not asked, a required answer left out, or one that does not fit approves nothing', async () => {
    const w = world();
    const { rehab, leave } = await rehabCard(w);
    const act = (id: string, action: string, values: Record<string, string>) =>
      w.decisions.act(persona(), id, action, undefined, undefined, values);
    await expect(act(rehab.id, 'book', { when: LATER, comment: 'x' })).rejects.toThrow(
      'Åtgärden frågar inte efter det värdet.',
    );
    // The rows are the card's: the person cannot answer `refs`.
    await expect(act(rehab.id, 'book', { when: LATER, refs: 'hr:emp:2001' })).rejects.toThrow(
      'Åtgärden frågar inte efter det värdet.',
    );
    await expect(act(rehab.id, 'book', { place: 'Rum 12' })).rejects.toThrow('När behöver fyllas i.');
    await expect(act(rehab.id, 'book', { when: '2026-11-01T09:00:00Z' })).rejects.toThrow(
      'När: tiden har redan passerat.',
    );
    // The button's own input is not the person's to change.
    await expect(act(leave.id, 'approve', { decision: 'reject' })).rejects.toThrow(
      'Åtgärden frågar inte efter det värdet.',
    );
    // An answer longer than its property allows is named; a merged input outside the schema otherwise is refused by
    // the ledger before anything is committed, as the person's to correct.
    await expect(act(rehab.id, 'book', { when: LATER, place: 'x'.repeat(121) })).rejects.toThrow(
      'Plats: högst 120 tecken.',
    );
    expect(w.ledger.audit()).toEqual([]);
    // The comment, when given, rides with the leave decision.
    await act(leave.id, 'approve', { comment: 'Trevlig ledighet!' });
    expect(w.ledger.audit()[0]!.details).toMatchObject({
      operation: 'hr.decideLeave',
      asked: { comment: 'Trevlig ledighet!' },
    });
    expect((await w.ledger.read('execution-1'))!.payload).toMatchObject({
      decision: 'approve',
      comment: 'Trevlig ledighet!',
    });
  });
  test('a write without asks takes no answers and approves as before, with no answers in its audit row', async () => {
    const w = world();
    const { leave } = await rehabCard(w);
    await w.decisions.act(persona(), leave.id, 'approve');
    expect(w.ledger.audit()[0]!.details).not.toHaveProperty('asked');
  });
});

describe('an execute about a person that asks (D112)', () => {
  const talks: Connector = {
    id: 'talks2',
    kind: 'passthrough',
    source: 'Samtalssystemet',
    areas: [],
    capabilities: [
      {
        name: 'talks2.book',
        kind: 'execute',
        title: 'Boka samtal',
        description: 'Bokar ett samtal.',
        model: false,
        scope: { roles: ['manager'] },
        about: { entity: 'person', param: 'person' },
        input: {
          type: 'object',
          properties: { person: { type: 'string' }, when: { type: 'string', format: 'date-time' } },
          required: ['person', 'when'],
          additionalProperties: false,
        } as never,
        output: { type: 'object' } as never,
        asks: [{ kind: 'meeting', property: 'when', label: 'När', required: true, durationMinutes: 30 }],
        run: async () => ({ headline: 'Bokat.', rows: [] }),
      },
    ],
  };
  test('its card starts with the key alone and waits for the answer, which the decision takes with the user name', async () => {
    const registry = new Registry();
    registry.register(talks);
    expect(registry.aboutActions(actorOf(persona()), 'person')[0]!.path).toEqual({
      asks: talks.capabilities[0]!.asks!,
      effect: false,
      description: 'Bokar ett samtal.',
    });
    const store = memoryThreadStore();
    const started = startedCards({
      store,
      registry,
      run: async () => {
        throw new Error('an execute is never run to start a card');
      },
      digest: value => JSON.stringify(value),
      clock: () => T0,
      ids: () => 'card-1',
    });
    const { threadId } = await started.startCard(persona(), 'talks2.book', { person: 'anna' }, { reason: 'Du valde' });
    // Without the answer the input is not yet whole: the card asks for it, and the decision supplies it.
    await expect(registry.validate(actorOf(persona()), 'talks2.book', { person: 'anna' })).rejects.toThrow(
      'Ogiltig förfrågan',
    );
    const approvals: unknown[] = [];
    const threads = threadUsecases({
      store,
      registry,
      run: async <O>() => undefined as O,
      calendar: {
        ensureProposalThread: async () => undefined,
        replan: async () => {
          throw new Error('not here');
        },
        dismiss: async () => {
          throw new Error('not here');
        },
        todayEvents: async () => [],
      },
      clock: () => T0,
      ids: () => 'x',
    });
    const card = (await threads.threadFor(persona(), threadId))!;
    expect(card.actions[0]!.path!.asks.map(a => a.property)).toEqual(['when']);
    // The card keeps Anna by id; the source is sent the user name she has when the person decides (D116).
    const people = {
      holders: async () => new Map<string, string>(),
      userName: async (id: string) => (id === 'anna' ? 'anna.l' : null),
    };
    const decisions = cardDecisions({
      read: threads.threadFor,
      registry,
      run: async () => undefined,
      approve: async (_p, input) => {
        approvals.push(input);
      },
      clock: () => T0,
      people,
    });
    await expect(decisions.act(persona(), threadId, 'decide')).rejects.toThrow('När behöver fyllas i.');
    await decisions.act(persona(), threadId, 'decide', undefined, undefined, { when: LATER });
    expect(approvals).toEqual([
      expect.objectContaining({
        operation: 'talks2.book',
        payload: { person: 'anna.l', when: LATER },
        asked: { when: LATER },
        subject: { param: 'person', personId: 'anna' },
      }),
    ]);
    // The ledger refusing the merged input against the schema is the person's to correct: a Swedish answer, not a failure.
    const refusing = cardDecisions({
      read: threads.threadFor,
      registry,
      run: async () => undefined,
      approve: async () => {
        throw new CapabilityError('Ogiltig förfrågan till talks2.book.');
      },
      clock: () => T0,
      people,
    });
    const refused = await refusing
      .act(persona(), threadId, 'decide', undefined, undefined, { when: LATER })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(InputError);
    expect((refused as Error).message).toBe('Ogiltig förfrågan till talks2.book.');
  });
  test("from the person page: a propose drafts with the answers, an execute takes them only on its card, the effect gets the source's key", async () => {
    const path = (asks: Ask[], effect = false) => ({ asks, effect, description: 'x' });
    const from: Ask = { kind: 'date', property: 'from', label: 'Från', required: true };
    const actions: EntityAction[] = [
      {
        capability: 'hr.prepare',
        connector: 'hr',
        source: 'Personalsystemet',
        title: 'Förbered',
        kind: 'propose',
        param: 'person',
        path: path([from]),
      },
      {
        capability: 'hr.report',
        connector: 'hr',
        source: 'Personalsystemet',
        title: 'Registrera',
        kind: 'execute',
        param: 'person',
        path: path([from], true),
      },
    ];
    const started: unknown[] = [],
      effects: unknown[] = [],
      persons: unknown[] = [];
    const uc = entityActionUsecases({
      open: async (_p, kind, key) =>
        key === 'anna'
          ? { entity: { kind, key: 'anna', sourceKey: 'anna.l', name: 'Anna', id: 'anna' }, actions }
          : undefined,
      start: async (_p, capability, input, context) => {
        started.push({ capability, input, asked: context.asked });
        persons.push(context.person);
        return { threadId: 't' };
      },
      effect: async (_p, capability, input, connector) => {
        effects.push({ capability, input, connector });
        return { source: 'Personalsystemet', rows: [{ label: 'Registreras' }] };
      },
      clock: () => T0,
    });
    const p = persona();
    await uc.start(p, 'person', 'anna', 'hr.prepare', { from: '2026-11-10' });
    expect(started).toEqual([
      { capability: 'hr.prepare', input: { from: '2026-11-10', person: 'anna' }, asked: { from: '2026-11-10' } },
    ]);
    await expect(uc.start(p, 'person', 'anna', 'hr.prepare')).rejects.toThrow('Från behöver fyllas i.');
    await expect(uc.start(p, 'person', 'anna', 'hr.prepare', { person: 'erik' })).rejects.toThrow(
      'Åtgärden frågar inte efter det värdet.',
    );
    await expect(uc.start(p, 'person', 'anna', 'hr.report', { from: '2026-11-10' })).rejects.toThrow(
      'Svaren ges när du beslutar på ärendet.',
    );
    await uc.start(p, 'person', 'anna', 'hr.report');
    // The card's input names Anna by id; the stream is told which property that is and the user name to send (D116).
    expect(started.at(-1)).toEqual({ capability: 'hr.report', input: { person: 'anna' }, asked: undefined });
    expect(persons.at(-1)).toEqual({ param: 'person', personId: 'anna', sourceKey: 'anna.l' });
    expect(await uc.effect(p, 'person', 'anna', 'hr.report', { from: '2026-11-10' })).toEqual({
      source: 'Personalsystemet',
      rows: [{ label: 'Registreras' }],
    });
    // The effect is the source's read, so it is sent the source's key.
    expect(effects).toEqual([
      { capability: 'hr.report', input: { from: '2026-11-10', person: 'anna.l' }, connector: 'hr' },
    ]);
    expect(await uc.effect(p, 'person', 'bo', 'hr.report', { from: '2026-11-10' })).toBeUndefined();
  });
});

describe('free times for a meeting ask, from the person own calendar (D112)', () => {
  test('three times, one a day where possible, weekdays 09–16 with lunch free, never in the past', () => {
    const busy = [{ start: '2026-11-05T08:00:00.000Z', end: '2026-11-05T15:00:00.000Z' }];
    expect(
      freeSlots({
        from: '2026-11-04',
        until: '2026-11-18',
        busy,
        notBefore: '2026-11-04T09:30:00.000Z',
        durationMinutes: 45,
      }),
    ).toEqual([
      { start: '2026-11-04T09:30:00.000Z', end: '2026-11-04T10:15:00.000Z' },
      { start: '2026-11-06T08:00:00.000Z', end: '2026-11-06T08:45:00.000Z' },
      { start: '2026-11-09T08:00:00.000Z', end: '2026-11-09T08:45:00.000Z' },
    ]);
    // One weekday left in the window: the next free times of that day.
    expect(
      freeSlots({
        from: '2026-11-06',
        until: '2026-11-07',
        busy: [],
        notBefore: '2026-11-01T00:00:00Z',
        durationMinutes: 60,
      }).map(s => s.start),
    ).toEqual(['2026-11-06T08:00:00.000Z', '2026-11-06T08:30:00.000Z', '2026-11-06T09:00:00.000Z']);
  });
  test("the calendar module reads the person's own calendar over two weeks, or until the deadline, and writes nothing", async () => {
    const asked: Array<[string, string]> = [];
    const events = eventUsecases({
      store: {} as never,
      team: async () => [],
      ids: () => 'x',
      clock: () => T0,
      bind: () =>
        ({
          provider: {
            list: async (from: string, to: string) => {
              asked.push([from, to]);
              return [
                { start: '2026-11-04T09:00:00.000Z', end: '2026-11-04T15:00:00.000Z', allDay: false },
                { start: '2026-11-05', end: '2026-11-06', allDay: true },
              ];
            },
          },
        }) as never,
    });
    const { slots } = await events.freeTimes(persona(), { durationMinutes: 45 });
    expect(asked).toEqual([['2026-11-03T23:00:00Z', '2026-11-17T23:00:00Z']]);
    // An hour from 08:00 Stockholm: 09:00 on the 4th, before the meeting from 10 to 16; an all-day event blocks nothing.
    expect(slots.map(s => s.start)).toEqual([
      '2026-11-04T08:00:00.000Z',
      '2026-11-05T08:00:00.000Z',
      '2026-11-06T08:00:00.000Z',
    ]);
    asked.length = 0;
    // Until the deadline: the 4th has one free time, so the 5th gives the next two.
    expect(
      (await events.freeTimes(persona(), { durationMinutes: 45, before: '2026-11-05' })).slots.map(s => s.start),
    ).toEqual(['2026-11-04T08:00:00.000Z', '2026-11-05T08:00:00.000Z', '2026-11-05T08:30:00.000Z']);
    expect(asked).toEqual([['2026-11-03T23:00:00Z', '2026-11-05T23:00:00Z']]);
    await expect(events.freeTimes(persona(), { durationMinutes: 45, before: 'fredag' })).rejects.toThrow(
      'Ogiltigt datum.',
    );
  });
  test('the dialog asks for an action the person may call that asks a meeting there, and gets the times and the day', async () => {
    const { connectors } = fixtureConnectors({ only: ['hr'], clock: () => T0 });
    const registry = new Registry();
    registry.register(connectors[0]!);
    const day: DayView = { from: '2026-11-12', events: [], proposals: [] };
    const calls: unknown[] = [];
    const asks = askUsecases({
      registry,
      calendar: {
        free: async (_p, input) => {
          calls.push(input);
          return [
            { start: '2026-11-05T08:00:00.000Z', end: '2026-11-05T08:45:00.000Z' },
            { start: '2026-11-06T08:00:00.000Z', end: '2026-11-06T08:45:00.000Z' },
            { start: '2026-11-09T08:00:00.000Z', end: '2026-11-09T08:45:00.000Z' },
          ];
        },
        day: async (_p, date) => (date === '2026-11-12' ? day : undefined),
      },
    });
    const times = await asks.meetingTimes(persona(), 'hr.bookTalk', 'when', {
      date: '2026-11-12',
      before: '2026-11-16',
    });
    expect(times).toEqual({ durationMinutes: TALK_MINUTES, slots: expect.any(Array), day });
    expect(times.slots).toHaveLength(3);
    expect(calls).toEqual([{ durationMinutes: TALK_MINUTES, before: '2026-11-16' }]);
    expect((await asks.meetingTimes(persona(), 'hr.bookTalk', 'when')).day).toBeUndefined();
    // Not a meeting ask, not the person's action, or not a date: refused as unknown, the calendar never asked.
    calls.length = 0;
    await expect(asks.meetingTimes(persona(), 'hr.bookTalk', 'place')).rejects.toThrow('Okänd förmåga.');
    await expect(asks.meetingTimes(persona(), 'hr.whoIsOn', 'when')).rejects.toThrow('Okänd förmåga.');
    const employee = { ...persona('hassan', 'unit-omsorg'), role: 'employee' as const };
    await expect(asks.meetingTimes(employee, 'hr.bookTalk', 'when')).rejects.toThrow('Okänd förmåga.');
    await expect(asks.meetingTimes(persona(), 'hr.bookTalk', 'when', { date: 'torsdag' })).rejects.toThrow(
      'Ogiltigt datum.',
    );
    expect(calls).toEqual([]);
  });
});
