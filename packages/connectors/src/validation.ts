import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ENTITY_KEYS_MAX, rowsKey, type Ask } from '@clew/contracts';
import { menuProblem, viewProblem, type ViewSubject } from './views';

/** Rules shared by manifest preview, remote loading and in-process registration. No installation state. */
interface Descriptor {
  id: string;
  /** `core` for Clew's own connectors; a manifest says `passthrough` or `derived`. */
  kind?: string;
  capabilities: Array<
    ViewSubject & {
      model: boolean;
      follows?: string[];
      creates?: string;
      kinds?: unknown[];
      about?: { entity: string; param?: string; page?: unknown };
      asks?: Ask[];
      effect?: string;
    }
  >;
  facts?: Array<{ kind: string; attributes: object }>;
  areas: Array<{ id: string; standing: string[] }>;
  documents?: unknown;
  /** The manifest names the capability in an object; a Connector carries its name. */
  header?: string | { capability: string };
}
function schemaCompiler() {
  const ajv = addFormats(new Ajv({ strict: false, addUsedSchema: false }));
  return (schema: object) => ajv.compile(schema);
}
type Schema = { type?: unknown; properties?: Record<string, Schema>; items?: Schema; required?: unknown };
const asSchema = (value: unknown): Schema | undefined =>
  value && typeof value === 'object' ? (value as Schema) : undefined;
const requires = (schema: Schema | undefined, name: string) =>
  Array.isArray(schema?.required) && schema.required.includes(name);
/** The names whose shape a profile of the protocol fixes (D26, D35, D89, D96, D111): none of them is about an entity. */
const PROFILES = ['search', 'fetch', 'errands', 'talks', 'commitments', 'news'];

/**
 * Why a capability's `about` (D97) may not be used, or undefined when it may. A read is asked with `{ keys }`, at most
 * `ENTITY_KEYS_MAX` strings, and answers rows that each carry the string `key` they were asked with, drawn as a table or
 * list, never a tool. An action names the string input that takes one key, and requires nothing else, so it can be started
 * from the entity's menu without a question. A follower, a profile read and the header have shapes of their own and are
 * about nothing.
 */
function aboutProblem(c: Descriptor['capabilities'][number], connector: Descriptor, header?: string) {
  const about = c.about!;
  if (c.follows)
    return `Capability ${c.name}: follows and about exclude each other; a follower answers for a fact (D97).`;
  if (c.kinds || PROFILES.some(p => c.name === `${connector.id}.${p}`) || c.name === header)
    return `Capability ${c.name}: a profile read or the header has a shape of its own and cannot declare about (D97).`;
  if (about.page !== undefined && connector.kind !== 'core')
    return `Capability ${c.name}: only Clew's own connectors name a page in about (D97).`;
  const input = asSchema(c.input);
  if (c.kind === 'read') {
    if (about.param !== undefined)
      return `Capability ${c.name}: a read about an entity takes its keys in keys and declares no param (D97).`;
    const keys = input?.properties?.keys as (Schema & { maxItems?: unknown }) | undefined;
    if (
      input?.type !== 'object' ||
      !requires(input, 'keys') ||
      keys?.type !== 'array' ||
      asSchema(keys.items)?.type !== 'string' ||
      typeof keys.maxItems !== 'number' ||
      keys.maxItems > ENTITY_KEYS_MAX
    )
      return `Capability ${c.name}: a read about an entity takes { keys }, a required array of strings with maxItems at most ${ENTITY_KEYS_MAX} (D97).`;
    if (c.view?.kind !== 'table' && c.view?.kind !== 'list')
      return `Capability ${c.name}: a read about an entity declares a table or list view (D97).`;
    const rows = rowsKey(c.view)!;
    const items = asSchema(asSchema(c.output)?.properties?.[rows]?.items);
    if (
      asSchema(c.output)?.properties?.[rows]?.type !== 'array' ||
      !requires(items, 'key') ||
      asSchema(items?.properties?.key)?.type !== 'string'
    )
      return `Capability ${c.name}: a read about an entity answers each row with the key it was asked with; its output ${rows} must be an array whose items require a string key (D97).`;
    if (c.model) return `Capability ${c.name}: a read about an entity is never a tool; declare model: false (D97).`;
    return undefined;
  }
  if (about.param === undefined || asSchema(input?.properties?.[about.param])?.type !== 'string')
    return `Capability ${c.name}: an action about an entity names in param a string property of its input that takes the key (D97).`;
  // The entity's menu starts the action with the key (D97, D8); anything else it requires, the person is asked (D111).
  const required = Array.isArray(input?.required) ? (input.required as unknown[]) : [];
  const asked = new Set((c.asks ?? []).map(a => a.property));
  if (!required.includes(about.param) || required.some(r => r !== about.param && !asked.has(r as string)))
    return `Capability ${c.name}: an action about an entity requires ${about.param} and otherwise only what it asks, so the entity's menu can start it with the key and the person's answers; anything more is optional with a default the source chooses (D97, D111).`;
  return undefined;
}

/** Why an ask does not fit the property it names (D111), as the end of a sentence; undefined when it does. */
function fitProblem(ask: Ask, property: Schema & { format?: unknown; enum?: unknown }): string | undefined {
  const values = Array.isArray(property.enum) ? (property.enum as unknown[]) : undefined;
  const string = property.type === 'string' || (property.type === undefined && !!values);
  switch (ask.kind) {
    case 'meeting':
      return !string || values || (property.format !== undefined && property.format !== 'date-time')
        ? 'is a meeting, which takes a string property without enum (format date-time when it declares one)'
        : undefined;
    case 'date':
      return !string || values || (property.format !== undefined && property.format !== 'date')
        ? 'is a date, which takes a string property without enum (format date when it declares one)'
        : undefined;
    case 'text':
    case 'long-text':
      return !string || values || property.format !== undefined
        ? `is ${ask.kind}, which takes a string property without enum or format`
        : undefined;
    case 'choice': {
      const offered = ask.options.map(o => o.value);
      return !string ||
        !values ||
        new Set(offered).size !== offered.length ||
        offered.length !== values.length ||
        values.some(v => !offered.includes(v as string))
        ? "is a choice, whose options name every value of the property's enum once"
        : undefined;
    }
  }
}
/**
 * Why a capability's asks (D111) may not be used: an ask belongs to a propose or an execute that is not a follower; it
 * names a property of the input once, never the entity's key, of a type its kind takes; and a property the input
 * requires is a required ask.
 */
function asksProblems(c: Descriptor['capabilities'][number]): string[] {
  if (!c.asks) return [];
  if (c.kind !== 'propose' && c.kind !== 'execute')
    return [`Capability ${c.name}: asks belong to a propose or an execute (D111).`];
  if (c.follows) return [`Capability ${c.name}: a follower is asked with a fact and asks the person nothing (D111).`];
  const input = asSchema(c.input);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const ask of c.asks) {
    const name = ask.property;
    const property = asSchema(input?.properties?.[name]);
    if (seen.has(name)) problems.push(`Capability ${c.name}: ask "${name}" is asked twice (D111).`);
    else if (!property) problems.push(`Capability ${c.name}: ask "${name}" names no property of the input (D111).`);
    else if (c.about?.param === name)
      problems.push(`Capability ${c.name}: ask "${name}" names the input that takes the entity's key (D111).`);
    else {
      const fit = fitProblem(ask, property);
      if (fit) problems.push(`Capability ${c.name}: ask "${name}" ${fit} (D111).`);
      if (requires(input, name) && !ask.required)
        problems.push(`Capability ${c.name}: ask "${name}" is optional, but the input requires ${name} (D111).`);
    }
    seen.add(name);
  }
  return problems;
}
/** JSON with its keys in order: two schemas written alike compare alike. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const sameSchema = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(JSON.parse(JSON.stringify(a ?? {})))) ===
  JSON.stringify(canonical(JSON.parse(JSON.stringify(b ?? {}))));
/**
 * Why a capability's `effect` (D111) may not be used: it belongs to an execute and names a read of the same connector
 * that takes the same input and is never offered to the model. A read writes nothing by contract.
 */
function effectProblem(c: Descriptor['capabilities'][number], connector: Descriptor): string | undefined {
  if (c.kind !== 'execute') return `Capability ${c.name}: effect belongs to an execute (D111).`;
  const read = connector.capabilities.find(r => r.name === c.effect);
  if (!read || read.kind !== 'read')
    return `Capability ${c.name}: effect names ${c.effect}, which is not a read of this connector (D111).`;
  if (read.model)
    return `Capability ${c.name}: effect ${c.effect} is offered to the model; an effect read declares model: false (D111).`;
  if (!sameSchema(read.input, c.input))
    return `Capability ${c.name}: effect ${c.effect} takes another input than ${c.name}; it declares the same input schema (D111).`;
  return undefined;
}

export function connectorProblems(
  connector: Descriptor,
  compile: (schema: object) => unknown = schemaCompiler(),
): string[] {
  const problems: string[] = [],
    names = new Set<string>(),
    facts = new Set<string>(),
    areas = new Set<string>();
  const header = typeof connector.header === 'string' ? connector.header : connector.header?.capability;
  const schemaProblem = (label: string, schema: object) => {
    try {
      compile(schema);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : 'Invalid JSON Schema.'}`);
    }
  };
  for (const c of connector.capabilities) {
    if (!c.name.startsWith(connector.id + '.'))
      problems.push(`Capability ${c.name} must be prefixed with ${connector.id}.`);
    if (names.has(c.name)) problems.push(`Capability ${c.name} is already registered.`);
    names.add(c.name);
    if (c.kind === 'execute' && c.model)
      problems.push(`Capability ${c.name}: execute capabilities are never tools (D8).`);
    const view = viewProblem(c, connector.capabilities);
    if (view) problems.push(`Capability ${view} (D38).`);
    const menu = menuProblem(c);
    if (menu) problems.push(`Capability ${menu} (D40).`);
    if ((c.view?.kind === 'document' || (c.view?.kind === 'record' && c.view.document)) && !connector.documents)
      problems.push(`Capability ${c.name}: document views require the connector's documents transport.`);
    if (c.review) {
      const read = connector.capabilities.find(r => r.name === c.review);
      if (
        c.kind !== 'execute' ||
        !read ||
        read.kind !== 'read' ||
        !(read.view?.kind === 'document' || (read.view?.kind === 'record' && read.view.document))
      )
        problems.push(`Capability ${c.name}: review must name a document read of the same connector.`);
    }
    if (c.follows && c.kind !== 'propose')
      problems.push(`Capability ${c.name}: only a propose can follow a fact (D55).`);
    if (c.creates && !connector.facts?.some(f => f.kind === c.creates))
      problems.push(`Capability ${c.name} creates ${c.creates}, which ${connector.id} does not declare (D55).`);
    if (c.about) {
      const about = aboutProblem(c, connector, header);
      if (about) problems.push(about);
    }
    problems.push(...asksProblems(c));
    if (c.effect !== undefined) {
      const effect = effectProblem(c, connector);
      if (effect) problems.push(effect);
    }
    schemaProblem(`Capability ${c.name} input`, c.input as object);
    schemaProblem(`Capability ${c.name} output`, c.output as object);
  }
  for (const f of connector.facts ?? []) {
    if (!f.kind.startsWith(connector.id + ':'))
      problems.push(`Fact ${f.kind} must be prefixed with ${connector.id}: (D55).`);
    if (facts.has(f.kind)) problems.push(`Fact ${f.kind} is declared twice.`);
    facts.add(f.kind);
    schemaProblem(`Fact ${f.kind} attributes`, f.attributes);
  }
  for (const a of connector.areas) {
    if (areas.has(a.id)) problems.push(`Area ${a.id} is declared twice.`);
    areas.add(a.id);
    for (const s of a.standing)
      if (!names.has(s)) problems.push(`Area ${a.id} lists unknown standing capability ${s}.`);
  }
  // The shared header (D88): the capability it names must be one of the connector's reads that opens without a question.
  if (header) {
    const c = connector.capabilities.find(x => x.name === header);
    if (!c) problems.push(`Header names unknown capability ${header} (D88).`);
    else if (c.kind !== 'read') problems.push(`Header capability ${c.name} must be a read (D88).`);
    else if (menuProblem({ ...c, menu: { label: 'x', icon: 'link' }, view: c.view ?? { kind: 'text', body: 'x' } }))
      problems.push(`Header capability ${c.name} must take no input (D88).`);
  }
  return problems;
}
