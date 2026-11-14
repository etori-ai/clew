import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AssistantAskEvent } from '../../packages/contracts/src/index';
import { CapabilityError, type Actor } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as eneoManifest } from '../../connectors/eneo/connector.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The Eneo connector's assistants profile against Eneo's API as recorded: the listing of the assistants an owner made
 * available to other systems, and a question sent through Eneo's conversation API (the UI message stream, version 3)
 * as the person, read as it is written. Through the real transport and registry, so the events are held to the
 * profile's shape.
 */
const secret = 'test-secret-test-secret';
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
const HR = '3f2b8c1e-5a47-4e0b-9a51-0c6d2f7e8a10';
const SESSION = '9d1c2b3a-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const BLOB_A = '1a2b3c4d-0000-4000-8000-000000000001';
const BLOB_B = '5e6f7a8b-0000-4000-8000-000000000002';
const listing = {
  items: [
    { id: HR, name: 'HR-assistenten', description: 'Svarar på frågor om anställning.', space: { id: 's', name: 'HR' } },
    { id: 'not-a-uuid', name: 'Trasig' },
  ],
  count: 2,
};
/** One answer as Eneo streams it: the session first, what was retrieved, the text with citation tags, then finish. */
const parts = [
  { type: 'start', messageId: 'q-1' },
  { type: 'data-session', data: { session_id: SESSION, completion_model: null, files: [] } },
  {
    type: 'source-document',
    sourceId: BLOB_A,
    mediaType: 'text/plain',
    title: 'Semesterregler',
    providerMetadata: {
      eneo: { id: BLOB_A, metadata: { url: 'https://intra.example/semester', title: 'Semesterregler' } },
    },
  },
  {
    type: 'source-document',
    sourceId: BLOB_B,
    mediaType: 'text/plain',
    title: 'Aldrig citerad',
    providerMetadata: { eneo: { id: BLOB_B, metadata: { url: 'http://insecure.example/x', title: 'Aldrig citerad' } } },
  },
  { type: 'reasoning-start', id: 'r-0' },
  { type: 'reasoning-delta', id: 'r-0', delta: 'tänker' },
  { type: 'reasoning-end', id: 'r-0' },
  { type: 'text-start', id: 'text-0' },
  { type: 'text-delta', id: 'text-0', delta: 'Du har 25 dagar <inr' },
  { type: 'text-delta', id: 'text-0', delta: 'ef id="1a2b3c4d"/> per år, och 3 < 5.' },
  { type: 'text-end', id: 'text-0' },
  { type: 'finish' },
];
const stream = (events: unknown[], options: { chunk?: number; done?: boolean } = {}) => {
  const text =
    ': ping\n\n' +
    events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') +
    (options.done === false ? '' : 'data: [DONE]\n\n');
  const bytes = new TextEncoder().encode(text);
  const size = options.chunk ?? 37;
  return new Response(
    new ReadableStream({
      start(controller) {
        // Cut without regard to events or characters, as a network does.
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
};
function stack(options: { token?: string; answer?: () => Response; publicUrl?: string } = {}) {
  const calls: Array<{ key: string; headers: Record<string, string>; body?: any }> = [];
  const eneoFetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
    calls.push({
      key,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (key === 'GET /api/v1/assistants/external/') return Response.json(listing);
    if (key === 'POST /api/v1/conversations/?version=3') return (options.answer ?? (() => stream(parts)))();
    return new Response('', { status: 404 });
  };
  const eneo = createConnector({
    jwks: testJwks,
    secret,
    eneoUrl: 'https://eneo.example/',
    eneoPublicUrl: options.publicUrl ?? 'https://eneo.example',
    fetch: eneoFetch,
  });
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(eneoManifest, 'eneo'), {
      url: 'http://eneo-connector',
      key: secret,
      assert: assertionFor('eneo', secret),
      fetch: (input, init) => eneo.handle(new Request(input, init)),
    }),
  );
  const context = { delegate: async () => ('token' in options ? options.token : 'idp-token-for-eneo') };
  const ask = async (assistant = 'eneo:' + HR, extra: { session?: string; context?: any[] } = {}) => {
    const events: AssistantAskEvent[] = [];
    for await (const e of registry.ask(
      hassan,
      assistant,
      { question: 'Hur många semesterdagar har jag?', ...extra },
      context,
    ))
      events.push(e);
    return events;
  };
  return { registry, calls, context, ask };
}
const conversations = (calls: ReturnType<typeof stack>['calls']) =>
  calls.filter(c => c.key.startsWith('POST /api/v1/conversations/'));

describe("the Eneo connector's assistants", () => {
  test('lists what Eneo made available to other systems, as the person, and leaves out what is not an assistant of Eneo', async () => {
    const { registry, calls, context } = stack();
    expect(await registry.assistantsFor(hassan, context)).toEqual([
      { id: 'eneo:' + HR, name: 'HR-assistenten', description: 'Svarar på frågor om anställning.', source: 'Eneo' },
    ]);
    expect(calls[0]).toMatchObject({
      key: 'GET /api/v1/assistants/external/',
      headers: { authorization: 'Bearer idp-token-for-eneo' },
    });
  });
  test('without the person’s token nothing is listed and nothing is asked', async () => {
    const { registry, calls, context, ask } = stack({ token: undefined });
    expect(await registry.assistantsFor(hassan, context)).toEqual([]);
    await expect(ask()).rejects.toBeInstanceOf(CapabilityError);
    expect(calls).toEqual([]);
  });
  test('a question goes to Eneo’s conversation API as the person, unchanged, with file-producing functions left out', async () => {
    const { calls, ask } = stack();
    const events = await ask();
    const [sent] = conversations(calls);
    expect(sent!.headers).toMatchObject({ authorization: 'Bearer idp-token-for-eneo', accept: 'text/event-stream' });
    expect(sent!.headers.origin).toBeUndefined();
    expect(sent!.body).toEqual({
      assistant_id: HR,
      question: 'Hur många semesterdagar har jag?',
      stream: true,
      disabled_capabilities: ['image_generation', 'file_creation', 'file_analysis', 'compute', 'charts'],
    });
    // The text without Eneo's citation tag, whole though the tag and the bytes arrived in pieces; a lone `<` is text.
    expect(
      events
        .filter(e => e.type === 'text')
        .map(e => (e.type === 'text' ? e.delta : ''))
        .join(''),
    ).toBe('Du har 25 dagar  per år, och 3 < 5.');
    // Only the source the answer cites, with its https address; the session and where it continues in Eneo.
    expect(events.filter(e => e.type !== 'text')).toEqual([
      { type: 'source', source: { label: 'Semesterregler', link: 'https://intra.example/semester' } },
      { type: 'done', session: SESSION, link: `https://eneo.example/dashboard/${HR}/${SESSION}` },
    ]);
  });
  test('a follow-up names the session, and what the person attached goes as context apart from the question', async () => {
    const { calls, ask } = stack({ publicUrl: 'http://not-https.example' });
    const events = await ask('eneo:' + HR, {
      session: SESSION,
      context: [{ label: 'Rutin vid fall', text: 'Innan den enskilde hjälps upp…' }],
    });
    expect(conversations(calls)[0]!.body).toEqual({
      session_id: SESSION,
      question: 'Hur många semesterdagar har jag?',
      stream: true,
      context: [{ label: 'Rutin vid fall', text: 'Innan den enskilde hjälps upp…' }],
      disabled_capabilities: ['image_generation', 'file_creation', 'file_analysis', 'compute', 'charts'],
    });
    // No link when the public address is not https.
    expect(events.at(-1)).toEqual({ type: 'done', session: SESSION });
  });
  test('Eneo’s refusals and failures keep their kind', async () => {
    const failing = async (answer: () => Response) => {
      try {
        await stack({ answer }).ask();
      } catch (error) {
        return (error as CapabilityError).code;
      }
      return 'answered';
    };
    expect(await failing(() => new Response('', { status: 403 }))).toBe('denied');
    expect(await failing(() => new Response('', { status: 404 }))).toBe('not-found');
    expect(await failing(() => new Response('', { status: 500 }))).toBe('unavailable');
    // An error in the stream, a stream that ends before `finish`, and one that is not JSON.
    expect(await failing(() => stream([parts[0], parts[1], { type: 'error', errorText: 'x' }]))).toBe('unavailable');
    expect(await failing(() => stream(parts.slice(0, 9), { done: false }))).toBe('unavailable');
    expect(await failing(() => new Response('data: {not json\n\n', { status: 200 }))).toBe('unavailable');
  });
  test('only an assistant the listing holds for the person is asked, and only by Eneo’s own keys', async () => {
    const { calls, ask } = stack();
    await expect(ask('eneo:2b0f6a43-1111-4222-8333-444455556666')).rejects.toThrow('Assistenten finns inte längre.');
    await expect(ask('eneo:' + HR, { session: 'not-a-uuid' })).rejects.toBeInstanceOf(CapabilityError);
    expect(conversations(calls)).toEqual([]);
  });
});
