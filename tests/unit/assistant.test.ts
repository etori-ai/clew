import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { Thread } from '../../packages/contracts/src/index';
import { type Actor } from '../../packages/connectors/src/index';
import { fixtureConnectors } from '../fixture-connectors';
import { draftSelection, parseVerb, verbsFor } from '../../apps/server/src/assistant/verbs';
import { matchCapability, nearest, templatedAnswer } from '../../apps/server/src/assistant/router';
import {
  buildTools,
  createGenerator,
  fromToolName,
  modelAnswer,
  ModelUnavailable,
  systemPrompt,
  toToolName,
} from '../../apps/server/src/assistant/model';
import { openAICompatibleWire } from '../../apps/server/src/assistant/adapters/openai-compatible';
import type { WireError } from '../../apps/server/src/assistant/ports';
import { serialiseContext } from '../../apps/server/src/assistant/context';
import { citationsOf, parseAnswer, visibleSoFar } from '../../apps/server/src/assistant/answer';

const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
};
const registry = () => {
  const r = new Registry();
  for (const m of fixtureConnectors({ only: ['hr', 'finance', 'incidents'] }).connectors) r.register(m);
  return r;
};
const now = '2026-11-03T07:40:00.000Z';
const today = '2026-11-03';
const card: Thread = {
  id: 'c1',
  kind: 'pushed',
  topic: 'finance:invoices',
  title: 'Attestera 3 fakturor, 37 050 kr',
  state: 'open',
  trigger: { reason: 'Den första förfaller 5 nov', source: 'Ekonomisystemet', at: now },
  createdAt: now,
  updatedAt: now,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'finance',
  area: 'budget',
  summary: 'Tre fakturor väntar.',
  items: [
    {
      ref: 'finance:inv:55120',
      label: 'Skolgrossisten · 11 200 kr',
      detail: '6451 · förfaller 5 nov',
      selectable: true,
      selected: true,
    },
    {
      ref: 'finance:inv:55121',
      label: 'Skolgrossisten · 7 200 kr',
      detail: '6451 · förfaller 6 nov',
      selectable: true,
      selected: true,
    },
    {
      ref: 'finance:inv:55140',
      label: 'Städbolaget · 18 650 kr',
      detail: '6452 · ingen beställning',
      selectable: true,
      selected: false,
    },
  ],
  actions: [
    {
      id: 'approve',
      label: 'Attestera valda',
      capability: 'finance.approve',
      kind: 'execute',
      role: 'primary',
      usesItems: true,
    },
    {
      id: 'open',
      label: 'Öppna i ekonomisystemet',
      capability: 'finance.open',
      kind: 'read',
      role: 'secondary',
      target: 'link',
    },
  ],
  waitingOn: null,
  deadline: '2026-11-05',
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
};
const samtal: Thread = {
  ...card,
  id: 's1',
  topic: 'utvecklingssamtal',
  title: 'Planera utvecklingssamtal vecka 46',
  connector: 'calendar',
  area: 'utvecklingssamtal',
  week: '2026-11-09',
  deadline: null,
  trigger: { reason: '4 samtal saknar tid före 28 november', source: 'Kalendern', at: now },
  proposals: [
    {
      id: 'p1',
      threadId: 's1',
      status: 'proposed',
      start: '2026-11-09T09:15:00.000Z',
      end: '2026-11-09T10:15:00.000Z',
      participant: { name: 'Anna Lindqvist', email: 'anna@example.test' },
      eventRef: null,
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    },
    {
      id: 'p2',
      threadId: 's1',
      status: 'proposed',
      start: '2026-11-10T12:00:00.000Z',
      end: '2026-11-10T13:00:00.000Z',
      participant: { name: 'Johan Svensson', email: 'johan@example.test' },
      eventRef: null,
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    },
    {
      id: 'p3',
      threadId: 's1',
      status: 'proposed',
      start: '2026-11-11T09:00:00.000Z',
      end: '2026-11-11T10:00:00.000Z',
      participant: { name: 'Fatima Rahimi', email: 'fatima@example.test' },
      eventRef: null,
      undoUntil: null,
      reminders: 0,
      remindedAt: null,
    },
  ],
  items: [
    { ref: 'proposal:p1', label: 'Anna Lindqvist', detail: 'mån 9 nov 10:15–11:15', selectable: true, selected: true },
    { ref: 'proposal:p2', label: 'Johan Svensson', detail: 'tis 10 nov 13:00–14:00', selectable: true, selected: true },
    { ref: 'proposal:p3', label: 'Fatima Rahimi', detail: 'ons 11 nov 10:00–11:00', selectable: true, selected: true },
  ],
  actions: [
    {
      id: 'confirm',
      label: 'Skicka inbjudningar',
      capability: 'calendar.confirm',
      kind: 'execute',
      role: 'primary',
      usesItems: true,
    },
  ],
};

describe('verbs about a chipped card come from its actions, never the model', () => {
  test("the verb row carries Clew's standard actions plus the card's own", () => {
    const labels = verbsFor(card).map(v => v.label);
    expect(labels).toContain('Avfärda det');
    expect(labels).toContain('Inte nu, i morgon 06:00');
    expect(labels).toContain('Varför ser jag detta?');
    expect(labels).toContain('Bara Skolgrossisten');
    expect(verbsFor(samtal).map(v => v.label)).toContain('Vecka 47 i stället');
    expect(verbsFor({ ...card, state: 'handled' })).toEqual([]);
  });
  test('free text about the card parses to one verb, or nothing', () => {
    expect(parseVerb('avfärda det', card, today)?.kind).toBe('dismiss');
    expect(parseVerb('Inte nu, ta det i morgon', card, today)?.kind).toBe('snooze');
    expect(parseVerb('varför ser jag detta?', card, today)?.kind).toBe('why');
    expect(parseVerb('attestera bara Skolgrossisten', card, today)?.refs).toEqual([
      'finance:inv:55120',
      'finance:inv:55121',
    ]);
    expect(parseVerb('skicka bara Anna och Johan', samtal, today)?.refs).toEqual(['proposal:p1', 'proposal:p2']);
    const replan = parseVerb('vecka 47 i stället', samtal, today);
    expect(replan?.kind).toBe('replan');
    expect(replan?.week).toBe('2026-11-16');
    expect(parseVerb('vecka 47 i stället', card, today)).toBeUndefined();
    expect(parseVerb('hur många fakturor är det?', card, today)).toBeUndefined();
  });
  test('a draft selects the named rows and leaves non-selectable rows alone', () => {
    const items = draftSelection(
      [...card.items, { ref: 'x', label: 'Fast rad', detail: '', selectable: false, selected: true }],
      ['finance:inv:55140'],
    );
    expect(items.map(i => i.selected)).toEqual([false, false, true, true]);
    expect(() => draftSelection(card.items, ['nope'])).toThrow();
  });
});
describe('the deterministic router matches capabilities by title and description (D8)', () => {
  test('finds the capability, respects scope, gives up honestly', () => {
    const r = registry();
    expect(matchCapability('Vem är på plats i dag?', r.tools(hillevi))?.name).toBe('hr.whoIsOn');
    expect(matchCapability('visa fakturor', r.tools(hillevi))?.name).toBe('finance.invoices');
    expect(matchCapability('frånvaro per person', r.tools(hassan))?.name).not.toBe('hr.absenceOverview');
    expect(matchCapability('xyzzy plugh', r.tools(hillevi))).toBeUndefined();
    expect(nearest('fakturor och budget', r.tools(hillevi)).map(t => t.name)).toContain('finance.budget');
  });
  test('templated answers name the source and offer a view for rows', () => {
    const tool = {
      name: 'finance.invoices',
      title: 'Fakturor att attestera',
      description: '',
      kind: 'read',
      source: 'Ekonomisystemet',
    };
    const a = templatedAnswer(tool, {}, { rows: [{ supplier: 'Skolgrossisten' }, { supplier: 'Städbolaget' }] }, now);
    expect(a.body).toMatch(
      /2 poster under fakturor att attestera: Skolgrossisten, Städbolaget\. Ekonomisystemet \d\d:\d\d\./,
    );
    expect(a.view?.capability).toBe('finance.invoices');
    const b = templatedAnswer(
      { ...tool, name: 'hr.whoIsOn', title: 'Vem är på plats i dag?', source: 'Personalsystemet' },
      {},
      { onDuty: ['Anna', 'Johan'], absent: 2 },
      now,
    );
    expect(b.body).toContain('onDuty: Anna, Johan');
    expect(b.body).toContain('Personalsystemet');
  });
});
describe('a document answer is read in code (D26): the trailer, the steps, the citations', () => {
  test('the follow-up trailer is lifted off the body and capped at three; steps make the shape "steg"', () => {
    const parsed = parseAnswer(
      'Lyft inte själv [1]. Ring sjuksköterskan [1].\nFöljdfrågor: Om hen slagit i huvudet | Vem ringer jag på natten? | Anhöriga | En fjärde',
    );
    expect(parsed).toEqual({
      body: 'Lyft inte själv [1]. Ring sjuksköterskan [1].',
      followUps: ['Om hen slagit i huvudet?', 'Vem ringer jag på natten?', 'Anhöriga?'],
    });
    const steps = parseAnswer(
      '1. Lyft inte själv [1].\n2. Ring sjuksköterskan [1].\n3. Skriv avvikelse [2].\n\nFöljdfrågor: Anhöriga?',
    );
    expect(steps.shape).toBe('steg');
    expect(steps.body.split('\n')).toHaveLength(3);
    expect(parseAnswer('Tre på plats. Personalsystemet 08:00.')).toEqual({
      body: 'Tre på plats. Personalsystemet 08:00.',
      followUps: [],
    });
    expect(parseAnswer('1. Ett steg bara.\nFöljdfrågor: ').shape).toBeUndefined();
  });
  test('while it streams, the trailer is never shown and what is shown only grows (D36)', () => {
    const full = '1. Lyft inte själv [1].\n2. Först: ring sjuksköterskan.\nFöljdfrågor: Anhöriga? | Natten?';
    const shown = Array.from({ length: full.length }, (_, i) => visibleSoFar(full.slice(0, i + 1)));
    shown.forEach((text, i) => {
      if (i > 0) expect(text.startsWith(shown[i - 1]!)).toBe(true);
      expect(text.toLowerCase()).not.toContain('följd');
    });
    expect(shown.at(-1)).toBe('1. Lyft inte själv [1].\n2. Först: ring sjuksköterskan.\n');
    // A line that could still become the trailer waits; one that cannot is shown.
    expect(visibleSoFar('Tre.\nFö')).toBe('Tre.\n');
    expect(visibleSoFar('Tre.\nFör')).toBe('Tre.\nFör');
    expect(visibleSoFar('Tre på plats.')).toBe('Tre på plats.');
  });
  test('citations carry refs, owner and date, never the text', () => {
    const cited = citationsOf({
      rows: [
        {
          ref: 'r1',
          connector: 'docs',
          kind: 'document',
          label: 'Rutin vid fall',
          snippet: 'hemligt',
          source: 'Intranätet',
          owner: 'MAS',
          reviewedAt: '2026-03-12T00:00:00Z',
          stale: false,
          link: 'https://x',
        },
        {
          ref: 'r2',
          connector: 'eneo',
          kind: 'document',
          label: 'Lathund',
          snippet: 's',
          source: 'Eneo',
          updatedAt: '2024-11-02T00:00:00Z',
          stale: true,
        },
      ],
    });
    expect(cited).toEqual([
      {
        n: 1,
        ref: 'document:docs:r1',
        label: 'Rutin vid fall',
        source: 'Intranätet',
        stale: false,
        link: 'https://x',
        owner: 'MAS',
        reviewedAt: '2026-03-12T00:00:00Z',
      },
      {
        n: 2,
        ref: 'document:eneo:r2',
        label: 'Lathund',
        source: 'Eneo',
        stale: true,
        reviewedAt: '2024-11-02T00:00:00Z',
      },
    ]);
    expect(JSON.stringify(cited)).not.toContain('hemligt');
  });
  test('the prompt carries the document rules and a chipped passage', () => {
    const prompt = systemPrompt({
      name: 'x',
      role: 'employee',
      unitLabel: 'y',
      now: new Date(now),
      week: 45,
      objects: serialiseContext(
        [
          {
            kind: 'document',
            ref: 'document:docs:r1',
            hit: {
              ref: 'r1',
              kind: 'document',
              label: 'Rutin vid fall',
              section: 'Vid fall',
              snippet: 'Lyft inte själv.',
              source: 'Intranätet',
              owner: 'MAS',
              reviewedAt: '2026-03-12T00:00:00Z',
            },
          },
        ],
        now,
      ),
    });
    expect(prompt).toContain('Följdfrågor:');
    expect(prompt).toContain('[1]');
    expect(prompt).toContain(
      'Avsnitt "Rutin vid fall, Vid fall" ur Intranätet (MAS, granskad 2026-03-12): "Lyft inte själv."',
    );
  });
});

describe('the model path only reads, and falls back when the provider fails', () => {
  test('tool names round-trip without dots and never include an execute capability', () => {
    expect(fromToolName(toToolName('hr.whoIsOn'))).toBe('hr.whoIsOn');
    const r = registry();
    const calls: string[] = [];
    const tools = buildTools(r.tools(hillevi), async name => {
      calls.push(name);
      return { ok: true };
    });
    expect(Object.keys(tools)).toContain('hr__whoIsOn');
    expect(Object.keys(tools).some(n => /approve|decide|book|report/.test(n))).toBe(false);
  });
  test('the system prompt carries role, unit, week and the chipped objects', () => {
    const prompt = systemPrompt({
      name: 'Hillevi Berg',
      role: 'manager',
      unitLabel: 'Skönsmons skola',
      now: new Date(now),
      week: 45,
      objects: serialiseContext([{ kind: 'thread', ref: 'thread:c1', thread: card }], now),
    });
    expect(prompt).toContain('chef på Skönsmons skola');
    expect(prompt).toContain('vecka 45');
    expect(prompt).toContain('Du tittar på');
    expect(prompt).toContain('Kort "Attestera 3 fakturor, 37 050 kr" (Ekonomisystemet');
    expect(prompt).toContain('Skolgrossisten · 11 200 kr · 6451 · förfaller 5 nov [vald]');
    expect(prompt).toContain(
      'Knappar på kortet nu: Attestera valda, Öppna i ekonomisystemet, Inte nu, Fler val (Lägg till i samtalet, Avfärda, Varför ser jag detta?).',
    );
    expect(
      systemPrompt({ name: 'x', role: 'employee', unitLabel: 'y', now: new Date(now), week: 45, objects: [] }),
    ).not.toContain('Du tittar på');
  });
  test('a card already acted on offers Ångra allt, never its own buttons, and nothing once the window has closed', () => {
    const handledAt = '2026-11-03T09:47:00.000Z',
      undoUntil = '2026-11-03T09:57:00.000Z';
    const acted: Thread = {
      ...card,
      state: 'handled',
      handledAt,
      receipt: {
        at: handledAt,
        headline: 'Två fakturor är attesterade.',
        undoUntil,
        undoCapability: 'finance.unapprove',
        rows: [
          {
            ref: 'finance:inv:55120',
            label: 'Skolgrossisten · 11 200 kr',
            outcome: 'done',
            detail: 'attesterad i ekonomisystemet',
          },
          { ref: 'finance:inv:55121', label: 'Skolgrossisten · 7 200 kr', outcome: 'unknown', detail: 'inget svar' },
        ],
      },
    };
    const [within] = serialiseContext(
      [{ kind: 'thread', ref: 'thread:c1', thread: acted }],
      '2026-11-03T09:50:00.000Z',
    );
    expect(within).toContain(
      'Kortet är redan hanterat 10:47: Två fakturor är attesterade. Kvitto: Skolgrossisten · 11 200 kr · attesterad i ekonomisystemet (klart); Skolgrossisten · 7 200 kr · inget svar (okänt).',
    );
    expect(within).toContain('Knappar på kortet nu: Ångra allt (fram till 10:57), Öppna i ekonomisystemet.');
    expect(within).toContain('först därefter visar kortet Attestera valda igen');
    expect(within).not.toContain('Knappar på kortet nu: Attestera valda');
    const [after] = serialiseContext([{ kind: 'thread', ref: 'thread:c1', thread: acted }], '2026-11-03T09:58:00.000Z');
    expect(after).toContain(
      'Det går inte längre att ångra i Startsidan; en ändring görs i Ekonomisystemet. Kortet har inga knappar nu.',
    );
    expect(after).not.toContain('Ångra allt');
    const prompt = systemPrompt({
      name: 'Hillevi Berg',
      role: 'manager',
      unitLabel: 'Skönsmons skola',
      now: new Date(now),
      week: 45,
      objects: [within!],
    });
    expect(prompt).toContain('Nämn bara knappar som står under "Knappar på kortet nu"');
  });
  test('a snoozed, a waiting and a dismissed card name only what they show', () => {
    const [snoozed] = serialiseContext(
      [{ kind: 'thread', ref: 'thread:c1', thread: { ...card, snoozedUntil: '2026-11-04T05:00:00.000Z' } }],
      now,
    );
    expect(snoozed).toContain(
      'Kortet ligger under Inte nu. Knappar på kortet nu: Ta upp nu, Fler val (Lägg till i samtalet, Avfärda, Varför ser jag detta?).',
    );
    const [waiting] = serialiseContext(
      [{ kind: 'thread', ref: 'thread:c1', thread: { ...card, waitingOn: 'Ekonomisystemet' } }],
      now,
    );
    expect(waiting).toContain('Kortet väntar på Ekonomisystemet. Knappar på kortet nu: Påminn mig, Fler val');
    const [dismissed] = serialiseContext(
      [{ kind: 'thread', ref: 'thread:c1', thread: { ...card, state: 'dismissed' } }],
      now,
    );
    expect(dismissed).toContain('Kortet är avfärdat. Kortet har inga knappar nu.');
  });
  test('an injected generate yields the answer and a view from the first rows result', async () => {
    const r = registry();
    const tools = r.tools(hillevi);
    const answer = await modelAnswer({
      system: 's',
      history: [],
      text: 'fakturor?',
      tools,
      run: async () => ({}),
      generate: async () => ({
        text: 'Tre fakturor väntar. Ekonomisystemet 08:00.',
        toolCalls: [{ capability: 'finance.invoices', input: {}, output: { rows: [{}, {}, {}] } }],
      }),
    });
    expect(answer.view?.capability).toBe('finance.invoices');
    expect(answer.view?.source).toBe('Ekonomisystemet');
    await expect(
      modelAnswer({
        system: 's',
        history: [],
        text: 'x',
        tools,
        run: async () => ({}),
        generate: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toBeInstanceOf(ModelUnavailable);
    await expect(
      modelAnswer({
        system: 's',
        history: [],
        text: 'x',
        tools,
        run: async () => ({}),
        generate: async () => ({ text: '  ', toolCalls: [] }),
      }),
    ).rejects.toBeInstanceOf(ModelUnavailable);
  });
  test('the real SDK wiring: a streamed tool_calls turn runs the capability through the registry, then the text streams back (D36)', async () => {
    const r = registry();
    const seen: string[] = [];
    let call = 0;
    // The provider asks for a stream; the endpoint answers in OpenAI's chunk format, as an open-weight server does.
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const stream = (...events: string[]) =>
      new Response(events.join('') + 'data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(true);
      seen.push(...(body.tools ?? []).map((t: { function: { name: string } }) => t.function.name));
      call += 1;
      if (call === 1)
        return stream(
          chunk(
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { index: 0, id: 'call_1', type: 'function', function: { name: 'hr__whoIsOn', arguments: '{}' } },
              ],
            },
            null,
          ),
          chunk({}, 'tool_calls'),
        );
      return stream(
        chunk({ role: 'assistant', content: 'Tre på plats.' }, null),
        chunk({ content: ' Personalsystemet 08:00.' }, null),
        chunk({}, 'stop'),
      );
    };
    const generate = createGenerator({ baseUrl: 'http://fake.test/v1' }, 'open-model', fakeFetch);
    const ran: string[] = [];
    const heard: string[] = [];
    const answer = await modelAnswer({
      system: 's',
      history: [],
      text: 'vem är på plats?',
      tools: r.tools(hillevi),
      run: async name => {
        ran.push(name);
        return r.run(hillevi, name, {});
      },
      generate,
      onText: text => heard.push(text),
    });
    expect(ran).toEqual(['hr.whoIsOn']);
    expect(answer.body).toBe('Tre på plats. Personalsystemet 08:00.');
    expect(answer.toolCalls[0]?.capability).toBe('hr.whoIsOn');
    expect(heard).toEqual(['Tre på plats.', 'Tre på plats. Personalsystemet 08:00.']);
    expect(seen).toContain('finance__invoices');
    expect(seen.some(n => n.includes('approve'))).toBe(false);
  });
  test('a turn says nothing about reasoning unless the model is set to none (D76)', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    };
    const request = { system: 's', messages: [{ role: 'user' as const, content: 'hej' }], tools: {}, timeoutMs: 1000 };
    const endpoint = { baseUrl: 'http://fake.test/v1' };
    await createGenerator(endpoint, 'open-model', fakeFetch)(request);
    await createGenerator(endpoint, 'open-model', fakeFetch, 'none')(request);
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'none' });
  });
  test('a stopped turn ends the streamed call like a timeout: the generator rejects and nothing is answered (D36)', async () => {
    const stop = new AbortController();
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Tre' }, finish_reason: null }] })}\n\n`,
              ),
            );
            init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const generate = createGenerator({ baseUrl: 'http://fake.test/v1' }, 'open-model', fakeFetch);
    const heard: string[] = [];
    const pending = generate({
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      tools: {},
      timeoutMs: 5_000,
      signal: stop.signal,
      onText: t => {
        heard.push(t);
        stop.abort();
      },
    });
    await expect(pending).rejects.toBeDefined();
    expect(heard).toEqual(['Tre']);
  });
  test('the OpenAI-compatible wire (D24) lists models with the key as a bearer and names every failure: no answer, a refused key, an answer that is not a list', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    const endpoint = (status: number, body: unknown): typeof fetch =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
    expect(
      await openAICompatibleWire(endpoint(200, { data: [{ id: 'qwen3:32b' }, { id: 'gpt-oss:20b' }] })).listModels({
        baseUrl: 'http://llm.test/v1/',
        apiKey: 'nyckel',
      }),
    ).toEqual(['gpt-oss:20b', 'qwen3:32b']);
    expect(seen[0]).toEqual({ url: 'http://llm.test/v1/models', auth: 'Bearer nyckel' });
    await openAICompatibleWire(endpoint(200, { data: [] })).listModels({ baseUrl: 'http://llm.test/v1' });
    expect(seen[1]!.auth).toBeNull();
    const plain = { tools: false, reasoning: 'provider-default' } as const;
    const kind = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: WireError) => e.kind,
      );
    expect(
      await kind(openAICompatibleWire(endpoint(401, { error: 'nope' })).listModels({ baseUrl: 'http://llm.test' })),
    ).toBe('key-rejected');
    expect(await kind(openAICompatibleWire(endpoint(503, {})).listModels({ baseUrl: 'http://llm.test' }))).toBe(
      'unreachable',
    );
    expect(
      await kind(
        openAICompatibleWire(endpoint(404, { error: { message: 'not found' } })).listModels({
          baseUrl: 'http://llm.test',
        }),
      ),
    ).toBe('unsupported');
    expect(
      await kind(openAICompatibleWire(endpoint(200, { models: [] })).listModels({ baseUrl: 'http://llm.test' })),
    ).toBe('unsupported');
    expect(
      await kind(
        openAICompatibleWire((async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch).listModels({ baseUrl: 'http://llm.test' }),
      ),
    ).toBe('unreachable');
    expect(
      await kind(
        openAICompatibleWire(endpoint(404, { error: { message: 'model "x" not found' } })).ping(
          { baseUrl: 'http://llm.test' },
          'x',
          plain,
        ),
      ),
    ).toBe('unsupported');
    expect(
      await kind(openAICompatibleWire(endpoint(200, { choices: [] })).ping({ baseUrl: 'http://llm.test' }, 'x', plain)),
    ).toBe('ok');
    // The test is shaped like the turn the model will get (D76).
    const bodies: Record<string, unknown>[] = [];
    const recording = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await openAICompatibleWire(recording).ping({ baseUrl: 'http://llm.test' }, 'x', plain);
    await openAICompatibleWire(recording).ping({ baseUrl: 'http://llm.test' }, 'x', { tools: true, reasoning: 'none' });
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(bodies[0]).not.toHaveProperty('reasoning_effort');
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'none', tools: [{ type: 'function' }] });
  });
});
