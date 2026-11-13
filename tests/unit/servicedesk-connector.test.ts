import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext, Relation, RequestsResult, Thread } from '../../packages/contracts/src/index';
import {
  SEARCH_CONNECTOR,
  UNKNOWN,
  type Actor,
  type ExecuteResult,
  type RelationResolver,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { requestCapabilities } from '../../apps/server/src/modules/requests/capabilities';
import { requestUsecases } from '../../apps/server/src/modules/requests/usecases';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import { createConnector, manifest as deskManifest } from '../../connectors/servicedesk/connector.mjs';
import { REQUEST_TITLE } from '../../connectors/servicedesk/manifest.mjs';
import { memoryState } from '../../connectors/servicedesk/state.mjs';
import { assertionFor, signedRequest, testJwks } from '../connector-authority';

/**
 * The service-desk fixture connector (D123) over the protocol: the first source of the requests profile, joined into
 * Clew's `clew.requests`; one request the person made, theirs alone; an order for a person, which Clew lets through for
 * the caller themself and a manager's direct report only (D117), filed once per operation id and read back (D45); the
 * card that waits on the desk and resolves when the desk closes the request; and what the desk has registered to a
 * person, within what the reads admit. The connector runs in process on its memory store, behind Clew's registry with a
 * directory that says how each reader stands to each person, and the refresh use case runs on the memory adapters.
 */
const ID = 'servicedesk';
const secret = 'test-secret-test-secret';
const KEY = 'test-fixture-key';
/** Friday 13 November 2026, a morning in Swedish time: the fixture's records are seeded relative to it. */
const T0 = Date.parse('2026-11-13T08:00:00+01:00');
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
/** A day as the desk writes it in a sentence: "23 nov.". */
const spoken = (iso: string) => day.format(new Date(iso + 'T12:00:00Z'));

const person = (userName: string, name: string, role: Actor['role'], unitId: string): Actor => ({
  id: 'person-' + userName,
  name,
  unitId,
  unitLabel: 'Enheten',
  role,
  userName,
});
const hillevi = person('hillevi', 'Hillevi Berg', 'manager', 'unit-skola');
const anna = person('anna', 'Anna Lindqvist', 'employee', 'unit-skola');
const hassan = person('hassan', 'Hassan Ali', 'employee', 'unit-omsorg');

/**
 * How each reader stands to each person, as Clew's directory says it (D117, D99): their own, the school's people for the
 * school's manager, and anyone else Clew knows a colleague.
 */
const READS: Record<string, Record<string, Relation>> = {
  hillevi: { hillevi: 'self', anna: 'managed', erik: 'managed', maria: 'managed', johan: 'managed', karin: 'managed' },
  anna: { anna: 'self' },
  hassan: { hassan: 'self' },
};
const KNOWN = new Set([...Object.keys(READS), ...Object.values(READS).flatMap(Object.keys), 'mikael']);
const directory: RelationResolver = async (actor, entity, keys, admits) =>
  keys.flatMap(asked => {
    const key = asked.toLowerCase();
    if (entity !== 'person' || !actor.userName || !KNOWN.has(key)) return [];
    const relation = READS[actor.userName.toLowerCase()]?.[key] ?? 'colleague';
    return admits.includes(relation) ? [{ asked, key, relation }] : [];
  });

type Rows<T = Record<string, unknown>> = { rows: T[] };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  let now = T0;
  const clock = () => new Date(now);
  const state = memoryState();
  const service = createConnector({ jwks: testJwks, secret, state, clock, fixtureKey: KEY, ...options });
  // The same desk over the same records, not answering (`FIXTURE_FAULT=unavailable`), for an outage partway through.
  const down = createConnector({ jwks: testJwks, secret, state, clock, ...options, fault: 'unavailable' });
  let live = service;
  const posted: string[] = [];
  const fetch: FetchLike = (input, init) => {
    posted.push(new URL(String(input)).pathname);
    return live.handle(new Request(input, init));
  };
  const registry = new Registry({ relations: directory });
  registry.register(
    remoteConnector(parseManifest(deskManifest, ID), {
      url: 'http://servicedesk',
      key: secret,
      assert: assertionFor(ID, secret),
      fetch,
    }),
  );
  // Clew's combined list (D123), registered with the core connector as the composition registers it.
  const requests = requestUsecases({
    sources: a => registry.requestSources(a),
    budget: { perSourceMs: 2000, totalMs: 3000 },
  });
  registry.register({
    id: SEARCH_CONNECTOR,
    kind: 'core',
    source: 'Startsidan',
    ...requestCapabilities(requests, a => registry.requestSources(a).length > 0),
    uses: ['*'],
  });
  const list = (actor: Actor) => registry.run<RequestsResult>(actor, 'clew.requests', {});
  /** The fixture's own route: the desk's staff moving a request forward (README, "Moving a request forward"). */
  const advance = (number: string, to: string, key = KEY) =>
    service.handle(
      new Request(`http://servicedesk/fixture/requests/${number}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fixture-key': key },
        body: JSON.stringify({ to }),
      }),
    );
  /** A request straight to the service, past Clew's rule and with the `about` given (none: a call that vouches for nobody). */
  const post = async (actor: Actor, capability: string, input: object, about?: object) =>
    service.handle(
      await signedRequest(`http://servicedesk/clew/capabilities/${capability}`, {
        id: ID,
        actor,
        key: secret,
        body: { actor, input, ...(about ? { about } : {}) },
      }),
    );
  return {
    registry,
    service,
    state,
    fetch,
    posted,
    list,
    advance,
    post,
    clock,
    later: (ms: number) => {
      now += ms;
    },
    outage: (on: boolean) => {
      live = on ? down : service;
    },
  };
}
type Stack = ReturnType<typeof stack>;

/** The person as Clew's background work sees them, from their current grant. */
const persona = (actor: Actor): AuthenticatedContext => ({
  ...actor,
  organisationId: 'test',
  principal: { id: 'person:' + actor.id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'session-' + actor.id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
/** Hillevi as a provisioner that sent no user name would leave her: nobody the desk can know. */
const { userName: _userName, ...nameless } = hillevi;

/**
 * Hillevi's cards from the desk's scans, through the refresh use case on the memory adapters as `composition/refresh.ts`
 * wires it. `who` is how her current grant reads at each scan.
 */
function cardsOf(w: Stack, who: () => Actor = () => hillevi) {
  const threads = memoryThreadStore();
  let ids = 0;
  const refresh = refreshUsecases({
    store: memoryRefreshStore(threads),
    clock: w.clock,
    ids: () => 'card-' + ++ids,
    key: sha,
    current: async id => (id === hillevi.id ? persona(who()) : undefined),
    sources: async () => [ID],
    system: () => 'IT-servicedesken',
    scan: (p, id) => w.registry.scanOne(p, id),
  });
  /** A visit a minute later: the page asks for her cards and the worker runs what is due. */
  const visit = async () => {
    w.later(61_000);
    await refresh.request(persona(who()));
    while (await refresh.tick());
  };
  const cards = () =>
    threads
      .dump()
      .filter(x => x.personId === hillevi.id)
      .map(x => x.thread);
  /** The draft's topic: the stored one carries the authority it was scanned under after it (`refresh.ts`). */
  const topicOf = (t: Thread) => t.topic.slice(0, t.topic.lastIndexOf(':'));
  const card = (number: string): Thread => cards().find(t => topicOf(t) === `servicedesk:req:${number}`)!;
  const audit = (action: string) => threads.audit.filter(a => a.action === action);
  const status = async () => (await refresh.statuses(persona(who())))[0];
  return { visit, cards, card, topicOf, audit, status };
}

describe('the service-desk fixture connector', () => {
  test('the manifest is valid and passes the conformance check, rows about people included', async () => {
    expect(manifestProblems(deskManifest, ID)).toEqual([]);
    const { fetch } = stack();
    const sign = (key: string) => assertionFor(ID, key);
    const report = await checkConnector({
      key: secret,
      url: 'http://servicedesk',
      id: ID,
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch,
      about: { keys: ['anna', 'erik', 'hassan'], as: hillevi, relations: directory },
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
    // Every read and order that names a person says what it admits (D117), so the check has nothing to warn about there.
    expect(report.findings.filter(f => f.level === 'warn' && f.text.includes('admits'))).toEqual([]);
  });

  test('what a person ordered or reported is joined into clew.requests, theirs alone, each row opening in the desk', async () => {
    const { registry, list } = stack();
    const mine = await list(hillevi);
    expect(mine.unanswered).toEqual([]);
    // What waits on her first, then what is open from the oldest, then what was closed lately (D123 item 4).
    expect(mine.rows.map(r => [r.label, r.state, r.status, r.expectedAt ?? null])).toEqual([
      ['SD-26110047 · Skrivare, Felanmälan', 'Väntar på dig', 'Väntar på ditt svar', null],
      ['SD-26110041 · Dator, Beställning', 'Pågår', 'Under leverans', '2026-11-16'],
      ['SD-26110052 · Behörighet, Beställning', 'Ny', 'Mottagen', null],
      ['SD-26110033 · Mobiltelefon, Beställning', 'Stängd', 'Levererad', null],
    ]);
    expect(mine.rows[0]).toMatchObject({
      ref: 'request:servicedesk:SD-26110047',
      connector: ID,
      system: 'IT-servicedesken',
      since: '2026-11-10T06:52:00.000Z',
      view: {
        capability: 'servicedesk.request',
        input: { ref: 'request:servicedesk:SD-26110047' },
        title: REQUEST_TITLE,
        source: 'IT-servicedesken',
      },
    });
    // The computer Hillevi ordered for Anna is Hillevi's; Anna's list has her own fault report only.
    expect((await list(anna)).rows.map(r => r.label)).toEqual(['SD-26110049 · Dator, Felanmälan']);
    expect((await list(hassan)).rows.map(r => [r.label, r.state, r.status])).toEqual([
      ['SD-26110044 · Mobiltelefon, Beställning', 'Väntar på dig', 'Klar att hämta'],
      ['SD-26110038 · Programvara, Felanmälan', 'Stängd', 'Löst'],
    ]);
    // The model is offered the combined list, never the desk's own read beside it.
    expect(registry.tools(hillevi).map(t => t.name)).toContain('clew.requests');
    expect(registry.tools(hillevi).map(t => t.name)).not.toContain('servicedesk.requests');
  });

  test('one request opens with its free text for the person who made it, and is not found for anyone else', async () => {
    const { registry } = stack();
    const ref = 'request:servicedesk:SD-26110047';
    expect(await registry.run(hillevi, 'servicedesk.request', { ref })).toEqual({
      ref,
      label: 'SD-26110047 · Skrivare, Felanmälan',
      state: 'waiting-on-me',
      status: 'Väntar på ditt svar',
      since: '2026-11-10T06:52:00.000Z',
      group: 'Klientsupport',
      title: 'Skrivaren på expeditionen skriver inte ut',
      description: 'Skrivaren tar emot jobben men inget kommer ut. Papper finns.',
      latest: 'Står det någon felkod i skrivarens fönster? Svara gärna med en bild så kommer en tekniker ut.',
    });
    await expect(registry.run(anna, 'servicedesk.request', { ref })).rejects.toThrow(
      'Beställningen finns inte, eller så får du inte se den.',
    );
    // The order Hillevi made for Anna is not Anna's to open either.
    await expect(registry.run(anna, 'servicedesk.request', { ref: 'request:servicedesk:SD-26110041' })).rejects.toThrow(
      /finns inte/,
    );
  });

  test('a manager orders for a direct report, sees what it will do first, and Clew refuses an order for anyone else (D117)', async () => {
    const { registry, list, posted, post } = stack();
    const input = { person: 'anna', item: 'laptop', note: 'Till det nya klassrummet.' };
    expect(await registry.run(hillevi, 'servicedesk.orderEffect', input)).toEqual({
      rows: [
        {
          label: 'Bärbar dator beställs',
          detail: `Till medarbetaren, hanteras av Klientsupport, beräknas klar ${spoken('2026-11-23')}, med ditt meddelande`,
        },
      ],
    });
    const done = await registry.run<ExecuteResult>(hillevi, 'servicedesk.order', input, { operationId: 'op-1' });
    expect(done).toEqual({
      headline: 'Beställningen är registrerad i IT-servicedesken.',
      rows: [
        {
          ref: 'request:servicedesk:SD-26110101',
          label: 'SD-26110101 · Dator, Beställning',
          outcome: 'done',
          detail: `till medarbetaren, beräknas klar ${spoken('2026-11-23')}`,
        },
      ],
    });
    // The order is the manager's: in her list, not in Anna's.
    expect((await list(hillevi)).rows.find(r => r.ref === 'request:servicedesk:SD-26110101')).toMatchObject({
      state: 'Ny',
      status: 'Mottagen',
      expectedAt: '2026-11-23',
    });
    expect((await list(anna)).rows.map(r => r.ref)).not.toContain('request:servicedesk:SD-26110101');
    expect(
      await registry.run(hillevi, 'servicedesk.request', { ref: 'request:servicedesk:SD-26110101' }),
    ).toMatchObject({ title: 'Bärbar dator', description: 'Till det nya klassrummet.', group: 'Klientsupport' });

    // Hassan is not hers: Clew refuses before the desk is asked, as it refuses a capability that does not exist.
    const before = posted.length;
    await expect(
      registry.run(hillevi, 'servicedesk.order', { person: 'hassan', item: 'phone' }, { operationId: 'op-2' }),
    ).rejects.toThrow(UNKNOWN);
    await expect(registry.run(hillevi, 'servicedesk.orderEffect', { person: 'hassan', item: 'phone' })).rejects.toThrow(
      UNKNOWN,
    );
    // An employee orders for herself, never for her manager.
    expect(
      (await registry.run<ExecuteResult>(anna, 'servicedesk.order', { person: 'anna', item: 'phone' })).rows[0],
    ).toMatchObject({ outcome: 'done', detail: `till dig, beräknas klar ${spoken('2026-11-18')}` });
    await expect(registry.run(anna, 'servicedesk.order', { person: 'hillevi', item: 'phone' })).rejects.toThrow(
      UNKNOWN,
    );
    expect(posted.slice(before)).toEqual(['/clew/capabilities/servicedesk.order']);

    // Sent past Clew, an order nobody vouched for is refused by the desk too, and so is an item outside the catalogue.
    const unvouched = await post(hillevi, 'servicedesk.order', { person: 'hassan', item: 'phone' });
    expect(unvouched.status).toBe(400);
    expect(await unvouched.json()).toEqual({
      error: { code: 'invalid', message: 'Personen finns inte bland dem du kan beställa åt.' },
    });
    const outside = await post(
      hillevi,
      'servicedesk.order',
      { person: 'anna', item: 'printer' },
      { entity: 'person', relations: { anna: 'managed' } },
    );
    expect(await outside.json()).toEqual({ error: { code: 'invalid', message: 'Vad: välj något ur katalogen.' } });
  });

  test('the same operation id files one order, a lost answer is read back, and another input under it is refused', async () => {
    const { registry, list, state, advance } = stack();
    const input = { person: 'hillevi', item: 'access-card' };
    const first = await registry.run<ExecuteResult>(hillevi, 'servicedesk.order', input, { operationId: 'op-9' });
    expect(await registry.run(hillevi, 'servicedesk.order', input, { operationId: 'op-9' })).toEqual(first);
    expect((await list(hillevi)).rows.filter(r => r.label.includes('Passerkort'))).toHaveLength(1);
    expect(await registry.run(hillevi, 'servicedesk.lookup', { operationId: 'op-9' })).toEqual({
      found: true,
      result: first,
    });
    // The read-back is the person's own.
    expect(await registry.run(anna, 'servicedesk.lookup', { operationId: 'op-9' })).toEqual({ found: false });
    await expect(
      registry.run(hillevi, 'servicedesk.order', { ...input, item: 'phone' }, { operationId: 'op-9' }),
    ).rejects.toThrow('Beslutet gäller annat innehåll.');

    // An answer lost between the desk and the connector's log: the desk filed the order under the operation id, so the
    // read-back still finds it and the order sent again files nothing new.
    state.delete('op:op-9');
    expect(await registry.run(hillevi, 'servicedesk.lookup', { operationId: 'op-9' })).toEqual({
      found: true,
      result: first,
    });
    // The desk's read-back is the requester's own too.
    expect(await registry.run(anna, 'servicedesk.lookup', { operationId: 'op-9' })).toEqual({ found: false });
    // Another caller under the same id is refused, as the log refuses it, and takes nothing over.
    await expect(
      registry.run(anna, 'servicedesk.order', { person: 'anna', item: 'access-card' }, { operationId: 'op-9' }),
    ).rejects.toThrow('Beslutet gäller annat innehåll.');
    expect(state.get('op:op-9')).toBeUndefined();
    expect(await registry.run(hillevi, 'servicedesk.lookup', { operationId: 'op-9' })).toEqual({
      found: true,
      result: first,
    });
    // So is the same caller with another input.
    await expect(
      registry.run(hillevi, 'servicedesk.order', { ...input, note: 'Ett annat kort.' }, { operationId: 'op-9' }),
    ).rejects.toThrow('Beslutet gäller annat innehåll.');
    expect((await list(anna)).rows.map(r => r.label)).toEqual(['SD-26110049 · Dator, Felanmälan']);

    // Delivered, and the log lost again: the receipt read back from the desk is still the first, expected day and all.
    await advance('SD-26110101', 'closed');
    expect(await registry.run(hillevi, 'servicedesk.lookup', { operationId: 'op-9' })).toEqual({
      found: true,
      result: first,
    });
    expect(await registry.run(hillevi, 'servicedesk.order', input, { operationId: 'op-9' })).toEqual(first);
    expect(state.get<{ result: unknown }>('op:op-9')?.result).toEqual(first);
    expect((await list(hillevi)).rows.filter(r => r.label.includes('Passerkort'))).toHaveLength(1);
  });

  test('the desk refusing an order is a failed receipt, logged under the operation id and read back as such', async () => {
    const { registry, list, state } = stack({ fault: 'conflict' });
    const input = { person: 'anna', item: 'phone' };
    const failed = await registry.run<ExecuteResult>(hillevi, 'servicedesk.order', input, { operationId: 'op-5' });
    expect(failed).toEqual({
      headline: 'IT-servicedesken tog inte emot beställningen.',
      rows: [{ ref: 'request:servicedesk:none', label: 'Beställning', outcome: 'failed', detail: 'försök igen' }],
    });
    expect(state.get<{ result: unknown }>('op:op-5')?.result).toEqual(failed);
    expect(await registry.run(hillevi, 'servicedesk.lookup', { operationId: 'op-5' })).toEqual({
      found: true,
      result: failed,
    });
    expect(await registry.run(hillevi, 'servicedesk.order', input, { operationId: 'op-5' })).toEqual(failed);
    // Nothing was filed.
    expect((await list(hillevi)).rows.map(r => r.ref)).not.toContain('request:servicedesk:SD-26110101');
  });

  test('the fault switches: unavailable fails the list, a crash after the order is found by the read-back', async () => {
    await expect(stack({ fault: 'unavailable' }).registry.run(hillevi, 'servicedesk.requests', {})).rejects.toThrow(
      /svarar inte/,
    );
    const crashing = stack({ fault: 'crash-after-commit' });
    await expect(
      crashing.registry.run(hillevi, 'servicedesk.order', { person: 'anna', item: 'phone' }, { operationId: 'op-7' }),
    ).rejects.toThrow(/svarar inte/);
    expect(await crashing.registry.run(hillevi, 'servicedesk.lookup', { operationId: 'op-7' })).toMatchObject({
      found: true,
      result: { rows: [{ label: 'SD-26110101 · Mobiltelefon, Beställning', outcome: 'done' }] },
    });
  });

  test('a card waits on the desk after an order, needs the person when the desk asks, waits again, and resolves when the desk closes it', async () => {
    const w = stack();
    const { visit, cards, card, topicOf, audit } = cardsOf(w);

    await visit();
    // One card per open request she made: the printer waits on her, the rest on the desk; the delivered phone has none.
    expect(
      cards()
        .map(t => [topicOf(t), t.waitingOn])
        .sort(),
    ).toEqual([
      ['servicedesk:req:SD-26110041', 'IT-servicedesken'],
      ['servicedesk:req:SD-26110047', null],
      ['servicedesk:req:SD-26110052', 'IT-servicedesken'],
    ]);
    // The computer for Anna names her by key on its row, never by name (D97).
    expect(card('SD-26110041')).toMatchObject({
      title: 'SD-26110041 · Dator, Beställning',
      area: 'it-service',
      deadline: '2026-11-16',
      items: [{ label: 'SD-26110041 · Dator, Beställning', subject: { entity: 'person', key: 'anna' } }],
    });
    expect(JSON.stringify(card('SD-26110041'))).not.toMatch(/Anna|Lindqvist/);

    await w.registry.run(hillevi, 'servicedesk.order', { person: 'anna', item: 'phone' }, { operationId: 'op-3' });
    await visit();
    expect(card('SD-26110101')).toMatchObject({
      state: 'open',
      waitingOn: 'IT-servicedesken',
      deadline: '2026-11-18',
      trigger: { reason: expect.stringMatching(/^Du beställde åt en medarbetare/), source: 'IT-servicedesken' },
      actions: [
        {
          id: 'open',
          capability: 'servicedesk.request',
          kind: 'read',
          input: { ref: 'request:servicedesk:SD-26110101' },
        },
      ],
    });

    // The desk asks her something: the card is hers to act on.
    expect(await (await w.advance('SD-26110101', 'waiting-on-me')).json()).toEqual({
      number: 'SD-26110101',
      state: 'waiting-on-me',
      status: 'Väntar på ditt svar',
    });
    await visit();
    expect(card('SD-26110101')).toMatchObject({ state: 'open', waitingOn: null });
    expect(card('SD-26110101').summary).toContain('Servicedesken väntar på dig.');

    // She answered, and it is the desk's move again: the same card waits on the desk.
    expect(await (await w.advance('SD-26110101', 'active')).json()).toEqual({
      number: 'SD-26110101',
      state: 'active',
      status: 'Pågår',
    });
    await visit();
    expect(card('SD-26110101')).toMatchObject({ state: 'open', waitingOn: 'IT-servicedesken' });
    expect(card('SD-26110101').summary).not.toContain('väntar på dig');
    expect(cards().filter(t => topicOf(t) === 'servicedesk:req:SD-26110101')).toHaveLength(1);

    // Delivered: the next complete scan has no draft for it, so the card resolves, audited.
    await w.advance('SD-26110101', 'closed');
    await visit();
    expect(card('SD-26110101').state).toBe('handled');
    expect(audit('thread.source_resolved').map(a => a.subject)).toEqual([`thread:${card('SD-26110101').id}`]);
    expect(audit('work.resolved')).toHaveLength(1);
    // The others are untouched.
    expect(card('SD-26110041').state).toBe('open');
  });

  test('a scan that cannot be read, a caller the desk cannot know or a desk that does not answer, resolves no card', async () => {
    const w = stack();
    let who: Actor = hillevi;
    const { visit, cards, audit, status } = cardsOf(w, () => who);
    await visit();
    expect(cards()).toHaveLength(3);

    // Her grant comes without a user name: the desk refuses, and nothing she has is taken for gone.
    who = nameless;
    await expect(w.registry.scanOne(nameless, ID)).rejects.toThrow();
    await visit();
    expect(cards().map(t => t.state)).toEqual(['open', 'open', 'open']);
    expect(audit('work.resolved')).toEqual([]);
    expect(await status()).toMatchObject({ connector: ID, state: 'failed', error: 'unavailable' });
    // Nor is she told that she ordered nothing: the list is refused, and the combined list says the desk did not answer.
    await expect(w.registry.run(nameless, 'servicedesk.requests', {})).rejects.toThrow(/känner inte igen dig/);
    await expect(w.list(nameless)).rejects.toThrow(/IT-servicedesken/);
    const straight = await w.post(nameless, 'servicedesk.requests', {});
    expect(straight.status).toBe(403);
    expect(await straight.json()).toEqual({
      error: { code: 'denied', message: 'IT-servicedesken känner inte igen dig.' },
    });

    // The desk does not answer (FIXTURE_FAULT=unavailable): the cards stay as they were.
    who = hillevi;
    w.outage(true);
    await visit();
    expect(cards().map(t => t.state)).toEqual(['open', 'open', 'open']);
    expect(audit('work.resolved')).toEqual([]);
    expect(audit('thread.source_resolved')).toEqual([]);
    expect(await status()).toMatchObject({ state: 'failed', error: 'unavailable' });
    // Back again, the scan completes and changes nothing it should not.
    w.outage(false);
    await visit();
    expect(await status()).toMatchObject({ state: 'complete', error: null });
    expect(cards().map(t => t.state)).toEqual(['open', 'open', 'open']);
  });

  test("the fixture's own route moves a request only with its key, and answers a bad number or state as such", async () => {
    const w = stack();
    expect((await w.advance('SD-26110041', 'closed', 'wrong-key')).status).toBe(401);
    expect((await w.advance('SD-26110041', 'closed', '')).status).toBe(401);
    // A connector started without FIXTURE_KEY opens it to nobody, not even with an empty key.
    const unset = stack({ fixtureKey: '' });
    expect((await unset.advance('SD-26110041', 'closed', '')).status).toBe(401);
    expect((await unset.advance('SD-26110041', 'closed', KEY)).status).toBe(401);
    expect((await w.advance('SD-00000000', 'closed')).status).toBe(404);
    expect((await w.advance('SD-26110041', 'new')).status).toBe(400);
    // A malformed percent sequence in the number is a bad request, not a broken connection.
    const malformed = await w.advance('SD-%E0%A4%A', 'closed');
    expect(malformed.status).toBe(400);
    expect((await malformed.json()) as unknown).toMatchObject({ error: { code: 'invalid' } });
    expect((await w.list(hillevi)).rows.find(r => r.ref.endsWith('SD-26110041'))?.state).toBe('Pågår');
  });

  test('a closed request stays in the list for thirty days and is gone after', async () => {
    const w = stack();
    // Hassan's fault report was solved eight days before the fixture's day, Hillevi's phone delivered two days before.
    w.later(26 * 86_400_000);
    expect((await w.list(hassan)).rows.map(r => r.label)).toEqual(['SD-26110044 · Mobiltelefon, Beställning']);
    expect((await w.list(hillevi)).rows.map(r => r.label)).toContain('SD-26110033 · Mobiltelefon, Beställning');
    w.later(3 * 86_400_000);
    expect((await w.list(hillevi)).rows.map(r => r.label)).not.toContain('SD-26110033 · Mobiltelefon, Beställning');
  });

  test('the summary and the equipment answer for the caller and a manager’s direct reports only', async () => {
    const { registry, post } = stack();
    // Hassan is a colleague and Clew does not send him; an unknown key is no one.
    expect(
      (await registry.run<Rows>(hillevi, 'servicedesk.person', { keys: ['anna', 'hassan', 'hillevi', 'okand'] })).rows,
    ).toEqual([
      // Anna has two devices and the computer Hillevi ordered for her on its way; Hillevi her own permission request.
      { key: 'anna', devices: 2, ordered: 1 },
      { key: 'hillevi', devices: 3, ordered: 1 },
    ]);
    expect((await registry.run<Rows>(anna, 'servicedesk.person', { keys: ['anna', 'hillevi'] })).rows).toEqual([
      { key: 'anna', devices: 2, ordered: 1 },
    ]);
    // Anna orders a phone for herself. She counts it; her manager counts only what was ordered on her behalf.
    await registry.run(anna, 'servicedesk.order', { person: 'anna', item: 'phone' }, { operationId: 'op-own' });
    expect((await registry.run<Rows>(anna, 'servicedesk.person', { keys: ['anna'] })).rows).toEqual([
      { key: 'anna', devices: 2, ordered: 2 },
    ]);
    expect((await registry.run<Rows>(hillevi, 'servicedesk.person', { keys: ['anna'] })).rows).toEqual([
      { key: 'anna', devices: 2, ordered: 1 },
    ]);
    expect((await registry.run<Rows>(hillevi, 'servicedesk.equipment', { person: 'anna' })).rows).toEqual([
      {
        ref: 'equipment:servicedesk:INV-104388',
        kind: 'Bärbar dator',
        model: 'Bärbar dator 13 tum',
        inventoryNumber: 'INV-104388',
        since: '2022-11-14',
      },
      {
        ref: 'equipment:servicedesk:INV-410090',
        kind: 'Headset',
        model: 'Headset med mikrofon',
        inventoryNumber: 'INV-410090',
        since: '2026-01-17',
      },
    ]);
    expect((await registry.run<Rows>(anna, 'servicedesk.equipment', { person: 'anna' })).rows).toHaveLength(2);
    await expect(registry.run(hillevi, 'servicedesk.equipment', { person: 'hassan' })).rejects.toThrow(UNKNOWN);
    await expect(registry.run(anna, 'servicedesk.equipment', { person: 'hillevi' })).rejects.toThrow(UNKNOWN);

    // Straight to the service without a relation from Clew, the desk vouches for no one either.
    const keys = await post(hillevi, 'servicedesk.person', { keys: ['anna', 'hillevi'] });
    expect(await keys.json()).toEqual({ output: { rows: [] } });
    const one = await post(hillevi, 'servicedesk.equipment', { person: 'anna' });
    expect(one.status).toBe(404);
    // Under `self`, the key must be the signed caller's own.
    const posing = await post(
      anna,
      'servicedesk.person',
      { keys: ['hillevi'] },
      {
        entity: 'person',
        relations: { hillevi: 'self' },
      },
    );
    expect(await posing.json()).toEqual({ output: { rows: [] } });
    const posingOne = await post(
      anna,
      'servicedesk.equipment',
      { person: 'hillevi' },
      { entity: 'person', relations: { hillevi: 'self' } },
    );
    expect(posingOne.status).toBe(404);
    expect(await posingOne.json()).toEqual({
      error: {
        code: 'not-found',
        message: 'Personen finns inte i IT-servicedesken, eller så får du inte se uppgifterna.',
      },
    });
  });
});
