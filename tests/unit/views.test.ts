import { describe, expect, test } from 'bun:test';
import type { SearchResult, View } from '../../packages/contracts/src/index';
import { Registry, openRef, viewProblem, viewRows, viewSummary, type Actor, type Connector } from '../../packages/connectors/src/index';
import { ManifestError, parseManifest } from '../../packages/connectors/src/remote';
import { manifest as telefonbokManifest } from '../../connectors/telefonbok/connector.mjs';
import { citationsOf } from '../../apps/server/src/assistant/answer';
import { buildTools, modelAnswer, systemPrompt, toToolName, type ToolSchemaInfo } from '../../apps/server/src/assistant/model';
import { matchCapability, searchAnswer, viewAnswer, viewInput } from '../../apps/server/src/assistant/router';

/**
 * Declared views (D38): the rules a declaration keeps, in the manifest loader and in the registry; what the model is
 * handed in place of the content; and the same view reached without a model, by typing or by a row.
 */
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', role: 'employee' };
const now = '2026-11-05T09:00:00.000Z';
const table: View = { kind: 'table', title: 'name', fields: [{ key: 'name', label: 'Namn' }, { key: 'phone', label: 'Telefon', format: 'phone' }] };
const rowsOut = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { ref: {}, name: {}, phone: {} } } } } };
const read = (over: Record<string, unknown> = {}) => ({ name: 'x.list', kind: 'read', input: { type: 'object', properties: { query: {} } }, output: rowsOut, view: table, ...over });
const card = { name: 'x.card', kind: 'read', input: { type: 'object', properties: { ref: {} } }, output: {} };
const withView = (name: string, view: unknown) => ({ ...(telefonbokManifest as { capabilities: Array<{ name: string }> }), capabilities: (telefonbokManifest as { capabilities: Array<{ name: string }> }).capabilities.map(c => c.name === name ? { ...c, view } : c) });

describe('the rules of a declared view', () => {
  test('a view belongs to a read, names its title among its fields, and its fields are in the output schema when the schema says what it holds', () => {
    expect(viewProblem(read(), [])).toBeUndefined();
    expect(viewProblem(read({ kind: 'execute' }), [])).toMatch(/only a read/);
    expect(viewProblem(read({ view: { ...table, title: 'ref' } }), [])).toMatch(/title "ref" must be one of its fields/);
    expect(viewProblem(read({ view: { ...table, fields: [...table.fields, { key: 'mobile', label: 'Mobil' }] } }), [])).toMatch(/field "mobile" is not in the output schema/);
    expect(viewProblem(read({ view: { ...table, rows: 'people' } }), [])).toMatch(/rows "people" is not in the output schema/);
    expect(viewProblem(read({ view: { ...table, fields: [...table.fields, table.fields[0]!] } }), [])).toMatch(/listed twice/);
    // A schema that does not say what a row holds is not second-guessed.
    expect(viewProblem(read({ output: { type: 'object' }, view: { ...table, fields: [{ key: 'name', label: 'Namn' }, { key: 'anything', label: 'Vad som helst' }] } }), [])).toBeUndefined();
    expect(viewProblem({ name: 'x.text', kind: 'read', input: {}, output: { properties: { body: {} } }, view: { kind: 'text', body: 'text' } }, [])).toMatch(/body "text"/);
  });
  test('input controls bind to the capability\'s own input, and a row opens only a read of the same connector with input it has', () => {
    expect(viewProblem(read({ view: { ...table, input: { query: { key: 'q', label: 'Sök' } } } }), [])).toMatch(/input "q" is not in the input schema/);
    expect(viewProblem(read({ view: { ...table, input: { query: { key: 'query', label: 'Sök' } }, open: { capability: 'x.card', title: 'Kort', params: { ref: 'ref' } } } }), [card])).toBeUndefined();
    expect(viewProblem(read({ view: { ...table, open: { capability: 'other.card', title: 'Kort', params: {} } } }), [card])).toMatch(/not a read of the same connector/);
    expect(viewProblem(read({ view: { ...table, open: { capability: 'x.card', title: 'Kort', params: { id: 'ref' } } } }), [card])).toMatch(/takes no input "id"/);
    expect(viewProblem(read({ view: { ...table, open: { capability: 'x.card', title: 'Kort', params: { ref: 'personId' } } } }), [card])).toMatch(/no "personId"/);
    expect(viewProblem(read({ view: { ...table, open: { capability: 'x.do', title: 'Gör', params: {} } } }), [{ ...card, name: 'x.do', kind: 'execute' }])).toMatch(/not a read/);
  });
  test('the manifest loader and the registry refuse a connector whose view breaks a rule; markup is not a thing a view can carry', () => {
    expect(parseManifest(telefonbokManifest, 'telefonbok').capabilities[0]!.view?.kind).toBe('table');
    expect(() => parseManifest(withView('telefonbok.team', { kind: 'list', title: 'name', fields: [{ key: 'title', label: 'Titel' }] }))).toThrow(ManifestError);
    expect(() => parseManifest(withView('telefonbok.team', { kind: 'html', body: '<b>x</b>' }))).toThrow(/Invalid connector manifest/);
    expect(() => parseManifest(withView('telefonbok.team', { kind: 'list', title: 'name', fields: [{ key: 'name', label: 'Namn', style: 'color: red' }] }))).toThrow(/Invalid connector manifest/);
    const bundled = (view: View): Connector => ({ id: 'x', kind: 'passthrough', source: 'X', areas: [], capabilities: [{ name: 'x.list', kind: 'read', title: 'Lista', description: '', model: true, scope: () => true, view,
      input: { type: 'object', properties: {} } as never, output: { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } } } as never, run: async () => ({ rows: [] }) }] });
    expect(() => new Registry().register(bundled({ kind: 'list', title: 'name', fields: [{ key: 'name', label: 'Namn' }] }))).not.toThrow();
    expect(() => new Registry().register(bundled({ kind: 'list', title: 'name', fields: [{ key: 'name', label: 'Namn' }, { key: 'phone', label: 'Telefon' }] }))).toThrow(/D38/);
  });
  test('rows are read where the view says, and a row opens the declared read with its own values', () => {
    expect(viewRows(table, { rows: [{ name: 'A' }, 'skräp', { name: 'B' }] })).toEqual([{ name: 'A' }, { name: 'B' }]);
    expect(viewRows({ ...table, rows: 'people' }, { rows: [] })).toBeUndefined();
    expect(viewRows({ kind: 'detail', title: 'name', fields: table.fields }, { rows: [] })).toBeUndefined();
    const open = { capability: 'x.card', title: 'Kort', params: { ref: 'ref' } };
    expect(openRef(open, { ref: 'person:1', name: 'A' }, 'X')).toEqual({ capability: 'x.card', input: { ref: 'person:1' }, title: 'Kort', source: 'X' });
    expect(openRef(open, { name: 'A' }, 'X')).toBeUndefined();
  });
});

describe('the model and a view it may not read', () => {
  const tool: ToolSchemaInfo = { name: 'telefonbok.directory', title: 'Sök i telefonboken', description: 'Söker kollegor på namn, titel eller enhet.', kind: 'read', source: 'Telefonboken', input: { type: 'object', properties: { query: { type: 'string' } } }, view: { ...table, modelReads: 'summary', input: { query: { key: 'query', label: 'Sök' } }, empty: 'Inga träffar i telefonboken.' } };
  const open: ToolSchemaInfo = { ...tool, name: 'x.rows', title: 'Rader', view: table };
  const output = { rows: [{ name: 'Anna Lindqvist', phone: '0980-319 203' }, { name: 'Hassan Ali', phone: '0980-319 202' }] };
  const execute = (t: ToolSchemaInfo, run: () => Promise<unknown>) => (buildTools([t], run)[toToolName(t.name)] as unknown as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute({}, { toolCallId: '1', messages: [] });
  test('the tool is run, but the model is handed how much is shown, never the content', async () => {
    let ran = 0;
    const handed = await execute(tool, async () => { ran++; return output; });
    expect(ran).toBe(1);
    expect(handed).toEqual(viewSummary(tool.view!, tool.title, output));
    expect(handed).toMatchObject({ shown: true, view: 'Sök i telefonboken', rows: 2 });
    expect(JSON.stringify(handed)).not.toMatch(/Anna|0980/);
    // A view that does not ask for it is read as before.
    expect(await execute(open, async () => output)).toEqual(output);
    expect(systemPrompt({ name: 'x', role: 'employee', unitLabel: 'y', now: new Date(now), week: 45, objects: [] })).toContain('resultatet visas i en vy');
  });
  test('the answer carries the declared view with the input the model chose, so the person sees the rows the model did not', async () => {
    const generate = async () => ({ text: 'Två träffar finns i vyn. Telefonboken 10:00.', toolCalls: [{ capability: 'clew.search', input: { query: 'anna' }, output: { rows: [], sources: [] } }, { capability: 'telefonbok.directory', input: { query: 'anna' }, output: viewSummary(tool.view!, tool.title, output) }] });
    const answer = await modelAnswer({ system: '', history: [], text: 'anna', tools: [tool, { ...tool, name: 'clew.search', title: 'Sök', view: undefined }], run: async () => output, generate });
    expect(answer.view).toEqual({ capability: 'telefonbok.directory', input: { query: 'anna' }, title: 'Sök i telefonboken', source: 'Telefonboken', declared: true });
  });
  test('without a model the same view is reached by typing: the rest of the sentence is the view\'s question, and the answer counts rows without naming anyone', () => {
    expect(matchCapability('telefonboken anna lindqvist', [tool])?.name).toBe('telefonbok.directory');
    expect(viewInput('telefonboken anna lindqvist', tool)).toEqual({ query: 'anna lindqvist' });
    expect(viewInput('Sök i telefonboken', tool)).toEqual({});
    expect(viewInput('sök efter rektor på bergsåkers skola i telefonboken', tool)).toEqual({ query: 'efter rektor bergsåkers skola' });
    expect(viewInput('telefonboken anna', open)).toEqual({});
    const answer = viewAnswer({ ...tool, view: tool.view! }, { query: 'anna' }, output);
    expect(answer.body).toBe('Sök i telefonboken: 2 rader.');
    expect(answer.view).toEqual({ capability: 'telefonbok.directory', input: { query: 'anna' }, title: 'Sök i telefonboken', source: 'Telefonboken', declared: true });
    expect(viewAnswer({ ...tool, view: tool.view! }, {}, { rows: [] }).body).toBe('Inga träffar i telefonboken.');
  });
});

describe('a person found by the search is counted, never named, in what Clew stores', () => {
  const person = { ref: 'person:1', connector: 'telefonbok', kind: 'person' as const, label: 'Anna Lindqvist', snippet: 'Lärare · Bergsåkers skola', source: 'Telefonboken', stale: null };
  const routine = { ref: 'r1', connector: 'docs', kind: 'document' as const, label: 'Rutin vid fall', snippet: 'text', source: 'Intranätet', stale: false };
  const sources: SearchResult['sources'] = [{ id: 'telefonbok', source: 'Telefonboken', status: 'ok' }];
  test('the sentence without a model and the citations stored with an answer leave the name in its source', () => {
    expect(searchAnswer({ rows: [person], sources }, now).body).toMatch(/^1 person hittades\. Se kontaktuppgifterna i panelen\. Källor: Telefonboken\./);
    const mixed = searchAnswer({ rows: [routine, person, { ...person, ref: 'person:2', label: 'Hassan Ali' }], sources }, now).body;
    expect(mixed).toContain('1 träff i rutiner och dokument: Rutin vid fall. Dessutom 2 personer.');
    expect(mixed).not.toMatch(/Anna|Hassan/);
    expect(citationsOf({ rows: [person, routine] })).toEqual([{ n: 2, ref: 'document:docs:r1', label: 'Rutin vid fall', source: 'Intranätet', stale: false }]);
  });
});
