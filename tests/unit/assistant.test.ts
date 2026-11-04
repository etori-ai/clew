import { describe, expect, test } from 'bun:test';
import type { Thread } from '../../packages/contracts/src/index';
import { Registry, type Actor } from '../../packages/connectors/src/index';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { heromaConnector } from '../../packages/connectors/src/mock/heroma';
import { raindanceConnector } from '../../packages/connectors/src/mock/raindance';
import { treservaConnector } from '../../packages/connectors/src/mock/treserva';
import { draftSelection, parseVerb, verbsFor } from '../../apps/server/src/assistant/verbs';
import { matchCapability, nearest, templatedAnswer } from '../../apps/server/src/assistant/router';
import { buildTools, createProvider, fromToolName, modelAnswer, ModelUnavailable, systemPrompt, toToolName } from '../../apps/server/src/assistant/model';
import { serialiseContext } from '../../apps/server/src/assistant/context';
import { citationsOf, parseAnswer } from '../../apps/server/src/assistant/answer';

const hillevi: Actor = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' };
const registry = () => { const state = memoryState(); const r = new Registry(); for (const m of [heromaConnector(state), raindanceConnector(state), treservaConnector(state)]) r.register(m); return r; };
const now = '2026-11-03T07:40:00.000Z';
const today = '2026-11-03';
const card: Thread = {
  id: 'c1', kind: 'pushed', topic: 'raindance:invoices', title: 'Attestera 3 fakturor, 37 050 kr', state: 'open', trigger: { reason: 'Den första förfaller 5 nov', source: 'Raindance', at: now },
  createdAt: now, updatedAt: now, handledAt: null, messages: [], proposals: [], week: null, connector: 'raindance', area: 'budget', summary: 'Tre fakturor väntar.',
  items: [
    { ref: 'raindance:inv:55120', label: 'Lekolar · 11 200 kr', detail: '6451 · förfaller 5 nov', selectable: true, selected: true },
    { ref: 'raindance:inv:55121', label: 'Lekolar · 7 200 kr', detail: '6451 · förfaller 6 nov', selectable: true, selected: true },
    { ref: 'raindance:inv:55140', label: 'Städbolaget · 18 650 kr', detail: '6452 · ingen beställning', selectable: true, selected: false },
  ],
  actions: [{ id: 'approve', label: 'Attestera valda', capability: 'raindance.approve', kind: 'execute', role: 'primary', usesItems: true }, { id: 'open', label: 'Öppna i Raindance', capability: 'raindance.open', kind: 'read', role: 'secondary', target: 'link' }],
  waitingOn: null, deadline: '2026-11-05', receipt: null, remindedAt: null, snoozedUntil: null,
};
const samtal: Thread = {
  ...card, id: 's1', topic: 'utvecklingssamtal', title: 'Planera utvecklingssamtal vecka 46', connector: 'calendar', area: 'utvecklingssamtal', week: '2026-11-09', deadline: null,
  trigger: { reason: '4 samtal saknar tid före 28 november', source: 'Kalendern', at: now },
  proposals: [
    { id: 'p1', threadId: 's1', status: 'proposed', start: '2026-11-09T09:15:00.000Z', end: '2026-11-09T10:15:00.000Z', participant: { name: 'Anna Lindqvist', email: 'anna@example.test' }, eventRef: null, undoUntil: null, reminders: 0, remindedAt: null },
    { id: 'p2', threadId: 's1', status: 'proposed', start: '2026-11-10T12:00:00.000Z', end: '2026-11-10T13:00:00.000Z', participant: { name: 'Johan Svensson', email: 'johan@example.test' }, eventRef: null, undoUntil: null, reminders: 0, remindedAt: null },
    { id: 'p3', threadId: 's1', status: 'proposed', start: '2026-11-11T09:00:00.000Z', end: '2026-11-11T10:00:00.000Z', participant: { name: 'Fatima Rahimi', email: 'fatima@example.test' }, eventRef: null, undoUntil: null, reminders: 0, remindedAt: null },
  ],
  items: [
    { ref: 'proposal:p1', label: 'Anna Lindqvist', detail: 'mån 9 nov 10:15–11:15', selectable: true, selected: true },
    { ref: 'proposal:p2', label: 'Johan Svensson', detail: 'tis 10 nov 13:00–14:00', selectable: true, selected: true },
    { ref: 'proposal:p3', label: 'Fatima Rahimi', detail: 'ons 11 nov 10:00–11:00', selectable: true, selected: true },
  ],
  actions: [{ id: 'confirm', label: 'Skicka inbjudningar', capability: 'calendar.confirm', kind: 'execute', role: 'primary', usesItems: true }],
};

describe('verbs about a chipped card come from its actions, never the model', () => {
  test('the verb row carries Clew\'s standard actions plus the card\'s own', () => {
    const labels = verbsFor(card).map(v => v.label);
    expect(labels).toContain('Avfärda det');
    expect(labels).toContain('Inte nu, i morgon 06:00');
    expect(labels).toContain('Varför ser jag detta?');
    expect(labels).toContain('Bara Lekolar');
    expect(verbsFor(samtal).map(v => v.label)).toContain('Vecka 47 i stället');
    expect(verbsFor({ ...card, state: 'handled' })).toEqual([]);
  });
  test('free text about the card parses to one verb, or nothing', () => {
    expect(parseVerb('avfärda det', card, today)?.kind).toBe('dismiss');
    expect(parseVerb('Inte nu, ta det i morgon', card, today)?.kind).toBe('snooze');
    expect(parseVerb('varför ser jag detta?', card, today)?.kind).toBe('why');
    expect(parseVerb('attestera bara Lekolar', card, today)?.refs).toEqual(['raindance:inv:55120', 'raindance:inv:55121']);
    expect(parseVerb('skicka bara Anna och Johan', samtal, today)?.refs).toEqual(['proposal:p1', 'proposal:p2']);
    const replan = parseVerb('vecka 47 i stället', samtal, today);
    expect(replan?.kind).toBe('replan');
    expect(replan?.week).toBe('2026-11-16');
    expect(parseVerb('vecka 47 i stället', card, today)).toBeUndefined();
    expect(parseVerb('hur många fakturor är det?', card, today)).toBeUndefined();
  });
  test('a draft selects the named rows and leaves non-selectable rows alone', () => {
    const items = draftSelection([...card.items, { ref: 'x', label: 'Fast rad', detail: '', selectable: false, selected: true }], ['raindance:inv:55140']);
    expect(items.map(i => i.selected)).toEqual([false, false, true, true]);
    expect(() => draftSelection(card.items, ['nope'])).toThrow();
  });
});
describe('the deterministic router matches capabilities by title and description (D8)', () => {
  test('finds the capability, respects scope, gives up honestly', () => {
    const r = registry();
    expect(matchCapability('Vem är på plats i dag?', r.tools(hillevi))?.name).toBe('heroma.whoIsOn');
    expect(matchCapability('visa fakturor', r.tools(hillevi))?.name).toBe('raindance.invoices');
    expect(matchCapability('frånvaro per person', r.tools(hassan))?.name).not.toBe('heroma.absenceOverview');
    expect(matchCapability('xyzzy plugh', r.tools(hillevi))).toBeUndefined();
    expect(nearest('fakturor och budget', r.tools(hillevi)).map(t => t.name)).toContain('raindance.budget');
  });
  test('templated answers name the source and offer a view for rows', () => {
    const tool = { name: 'raindance.invoices', title: 'Fakturor att attestera', description: '', kind: 'read', source: 'Raindance' };
    const a = templatedAnswer(tool, {}, { rows: [{ supplier: 'Lekolar' }, { supplier: 'Städbolaget' }] }, now);
    expect(a.body).toMatch(/2 poster under fakturor att attestera: Lekolar, Städbolaget\. Raindance \d\d:\d\d\./);
    expect(a.view?.capability).toBe('raindance.invoices');
    const b = templatedAnswer({ ...tool, name: 'heroma.whoIsOn', title: 'Vem är på plats i dag?', source: 'Heroma' }, {}, { onDuty: ['Anna', 'Johan'], absent: 2 }, now);
    expect(b.body).toContain('onDuty: Anna, Johan');
    expect(b.body).toContain('Heroma');
  });
});
describe('a document answer is read in code (D26): the trailer, the steps, the citations', () => {
  test('the follow-up trailer is lifted off the body and capped at three; steps make the shape "steg"', () => {
    const parsed = parseAnswer('Lyft inte själv [1]. Ring sjuksköterskan [1].\nFöljdfrågor: Om hen slagit i huvudet | Vem ringer jag på natten? | Anhöriga | En fjärde');
    expect(parsed).toEqual({ body: 'Lyft inte själv [1]. Ring sjuksköterskan [1].', followUps: ['Om hen slagit i huvudet?', 'Vem ringer jag på natten?', 'Anhöriga?'] });
    const steps = parseAnswer('1. Lyft inte själv [1].\n2. Ring sjuksköterskan [1].\n3. Skriv avvikelse [2].\n\nFöljdfrågor: Anhöriga?');
    expect(steps.shape).toBe('steg');
    expect(steps.body.split('\n')).toHaveLength(3);
    expect(parseAnswer('Tre på plats. Heroma 08:00.')).toEqual({ body: 'Tre på plats. Heroma 08:00.', followUps: [] });
    expect(parseAnswer('1. Ett steg bara.\nFöljdfrågor: ').shape).toBeUndefined();
  });
  test('citations carry refs, owner and date, never the text', () => {
    const cited = citationsOf({ rows: [{ ref: 'r1', connector: 'docs', kind: 'document', label: 'Rutin vid fall', snippet: 'hemligt', source: 'Intranätet', owner: 'MAS', reviewedAt: '2026-03-12T00:00:00Z', stale: false, link: 'https://x' }, { ref: 'r2', connector: 'eneo', kind: 'document', label: 'Lathund', snippet: 's', source: 'Eneo', updatedAt: '2024-11-02T00:00:00Z', stale: true }] });
    expect(cited).toEqual([
      { n: 1, ref: 'document:docs:r1', label: 'Rutin vid fall', source: 'Intranätet', stale: false, link: 'https://x', owner: 'MAS', reviewedAt: '2026-03-12T00:00:00Z' },
      { n: 2, ref: 'document:eneo:r2', label: 'Lathund', source: 'Eneo', stale: true, reviewedAt: '2024-11-02T00:00:00Z' },
    ]);
    expect(JSON.stringify(cited)).not.toContain('hemligt');
  });
  test('the prompt carries the document rules and a chipped passage', () => {
    const prompt = systemPrompt({ name: 'x', role: 'employee', unitLabel: 'y', now: new Date(now), week: 45, objects: serialiseContext([{ kind: 'document', ref: 'document:docs:r1', hit: { ref: 'r1', kind: 'document', label: 'Rutin vid fall', section: 'Vid fall', snippet: 'Lyft inte själv.', source: 'Intranätet', owner: 'MAS', reviewedAt: '2026-03-12T00:00:00Z' } }]) });
    expect(prompt).toContain('Följdfrågor:');
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('Avsnitt "Rutin vid fall, Vid fall" ur Intranätet (MAS, granskad 2026-03-12): "Lyft inte själv."');
  });
});

describe('the model path only reads, and falls back when the provider fails', () => {
  test('tool names round-trip without dots and never include an execute capability', () => {
    expect(fromToolName(toToolName('heroma.whoIsOn'))).toBe('heroma.whoIsOn');
    const r = registry();
    const calls: string[] = [];
    const tools = buildTools(r.tools(hillevi), async name => { calls.push(name); return { ok: true }; });
    expect(Object.keys(tools)).toContain('heroma__whoIsOn');
    expect(Object.keys(tools).some(n => /approve|decide|book|report/.test(n))).toBe(false);
  });
  test('the system prompt carries role, unit, week and the chipped objects', () => {
    const prompt = systemPrompt({ name: 'Hillevi Berg', role: 'manager', unitLabel: 'Skönsmons skola', now: new Date(now), week: 45, objects: serialiseContext([{ kind: 'thread', ref: 'thread:c1', thread: card }]) });
    expect(prompt).toContain('chef på Skönsmons skola');
    expect(prompt).toContain('vecka 45');
    expect(prompt).toContain('Du tittar på');
    expect(prompt).toContain('Kort "Attestera 3 fakturor, 37 050 kr" (Raindance');
    expect(prompt).toContain('Lekolar · 11 200 kr · 6451 · förfaller 5 nov [vald]');
    expect(systemPrompt({ name: 'x', role: 'employee', unitLabel: 'y', now: new Date(now), week: 45, objects: [] })).not.toContain('Du tittar på');
  });
  test('an injected generate yields the answer and a view from the first rows result', async () => {
    const r = registry();
    const tools = r.tools(hillevi);
    const answer = await modelAnswer({ system: 's', history: [], text: 'fakturor?', tools, run: async () => ({}), generate: async () => ({ text: 'Tre fakturor väntar. Raindance 08:00.', toolCalls: [{ capability: 'raindance.invoices', input: {}, output: { rows: [{}, {}, {}] } }] }) });
    expect(answer.view?.capability).toBe('raindance.invoices');
    expect(answer.view?.source).toBe('Raindance');
    await expect(modelAnswer({ system: 's', history: [], text: 'x', tools, run: async () => ({}), generate: async () => { throw new Error('boom'); } })).rejects.toBeInstanceOf(ModelUnavailable);
    await expect(modelAnswer({ system: 's', history: [], text: 'x', tools, run: async () => ({}), generate: async () => ({ text: '  ', toolCalls: [] }) })).rejects.toBeInstanceOf(ModelUnavailable);
  });
  test('the real SDK wiring: a tool_calls turn runs the capability through the registry, then the text comes back', async () => {
    const r = registry();
    const seen: string[] = [];
    let call = 0;
    const completion = (message: Record<string, unknown>, finish: string) => new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    const fakeFetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push(...(body.tools ?? []).map((t: { function: { name: string } }) => t.function.name));
      call += 1;
      if (call === 1) return completion({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'heroma__whoIsOn', arguments: '{}' } }] }, 'tool_calls');
      return completion({ role: 'assistant', content: 'Tre på plats. Heroma 08:00.' }, 'stop');
    };
    const provider = createProvider({ AI_BASE_URL: 'http://fake.test/v1', AI_MODEL: 'open-model' }, fakeFetch)!;
    const ran: string[] = [];
    const answer = await modelAnswer({ system: 's', history: [], text: 'vem är på plats?', tools: r.tools(hillevi), run: async name => { ran.push(name); return r.run(hillevi, name, {}); }, generate: provider.generate });
    expect(ran).toEqual(['heroma.whoIsOn']);
    expect(answer.body).toBe('Tre på plats. Heroma 08:00.');
    expect(answer.toolCalls[0]?.capability).toBe('heroma.whoIsOn');
    expect(seen).toContain('raindance__invoices');
    expect(seen.some(n => n.includes('approve'))).toBe(false);
  });
  test('no AI_BASE_URL means no provider; a base URL without a model is a configuration error', () => {
    expect(createProvider({})).toBeUndefined();
    expect(() => createProvider({ AI_BASE_URL: 'http://x' })).toThrow(/AI_MODEL/);
  });
});
