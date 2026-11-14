import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ENTITY_KEYS_MAX,
  HOLDINGS_PER_ROW_MAX,
  HOLDINGS_ROWS_MAX,
  HOLDING_KINDS,
  rowsKey,
  type Ask,
} from '@clew/contracts';
import { menuProblem, viewProblem, type ViewSubject } from './views';
import { namedInputs, plainStringProperty } from './named';
import { INSTALLATION_PROFILES, PROTOCOL_VERSION, protocolTerms } from './protocol';

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
      person?: { param?: string; admits?: readonly string[]; ids?: boolean };
      unit?: { admits?: readonly string[] };
      asks?: Ask[];
      effect?: string;
    }
  >;
  /** The reads Clew makes as the installation (D119); never capabilities. */
  installation?: Array<{ name: string; input: unknown; output: unknown }>;
  facts?: Array<{ kind: string; attributes: object }>;
  areas: Array<{ id: string; standing: string[] }>;
  documents?: unknown;
  /** The manifest names the capability in an object; a Connector carries its name. */
  header?: string | { capability: string };
  /** The assistants profile: the manifest names the listing read in an object; a Connector carries it beside `ask`. */
  assistants?: { list: string };
  /** The protocol a remote connector's manifest is written to (D60); absent for Clew's own, which follow the current one. */
  protocol?: number;
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
/** The names whose shape a profile of the protocol fixes (D26, D35, D89, D96, D112, D123): none of them is about an entity. */
const PROFILES = ['search', 'fetch', 'errands', 'requests', 'talks', 'commitments', 'news'];

/**
 * Why a capability's `about` (D97) may not be used, or undefined when it may. A read is asked with `{ keys }`, at most
 * `ENTITY_KEYS_MAX` strings, and answers rows that each carry the string `key` they were asked with, drawn as a table or
 * list, never a tool. An action names the string input that takes one key, and requires nothing else, so it can be started
 * from the entity's menu without a question. A follower, a profile read and the header have shapes of their own and are
 * about nothing.
 */
function aboutProblem(
  c: Descriptor['capabilities'][number],
  connector: Descriptor,
  header?: string,
  assistants?: string,
) {
  const about = c.about!;
  if (c.follows)
    return `Capability ${c.name}: follows and about exclude each other; a follower answers for a fact (D97).`;
  if (c.kinds || PROFILES.some(p => c.name === `${connector.id}.${p}`) || c.name === header || c.name === assistants)
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
  // The entity's menu starts the action with the key (D97, D8); anything else it requires, the person is asked (D112).
  const required = Array.isArray(input?.required) ? (input.required as unknown[]) : [];
  const asked = new Set((c.asks ?? []).map(a => a.property));
  if (!required.includes(about.param) || required.some(r => r !== about.param && !asked.has(r as string)))
    return `Capability ${c.name}: an action about an entity requires ${about.param} and otherwise only what it asks, so the entity's menu can start it with the key and the person's answers; anything more is optional with a default the source chooses (D97, D112).`;
  return undefined;
}

/**
 * Why a capability's `person` or `unit` (D117) may not be used, or undefined when it may. A capability about a person
 * has its key where `about` says and declares only `admits`; any other names in `param` a string property of its input
 * that takes one person's key. `unit` belongs to a capability about a unit, and `person` never does. Only Clew's own
 * connectors take a person by Clew's id (`ids`).
 */
function accessProblem(c: Descriptor['capabilities'][number], connector: Descriptor): string | undefined {
  if (c.unit && c.about?.entity !== 'unit')
    return `Capability ${c.name}: unit belongs to a capability about a unit; declare who it may be asked about in person (D117).`;
  const person = c.person;
  if (!person) return undefined;
  if (c.about?.entity === 'unit')
    return `Capability ${c.name}: person is about people; a capability about a unit declares who it may be asked about in unit (D117).`;
  if (person.ids && connector.kind !== 'core')
    return `Capability ${c.name}: only Clew's own connectors take a person by Clew's id (D117).`;
  // A manifest cannot name it (the protocol's relations leave it out); an in-process connector of another kind may not
  // either, so the grant opens Clew's own competence reads and nothing else (D121 item 3).
  if (person.admits?.includes('registrar') && connector.kind !== 'core')
    return `Capability ${c.name}: only Clew's own connectors admit registrar (D121).`;
  if (c.about?.entity === 'person') {
    if (person.param !== undefined)
      return `Capability ${c.name}: a capability about a person takes its key in keys or about.param and declares no person.param (D117).`;
    return undefined;
  }
  if (person.param === undefined)
    return `Capability ${c.name}: person names no input; a capability not about a person names in person.param the input that takes the key (D117).`;
  return undefined;
}

/** Why an ask does not fit the property it names (D112), as the end of a sentence; undefined when it does. */
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
 * Why a capability's asks (D112) may not be used: an ask belongs to a propose or an execute that is not a follower; it
 * names a property of the input once, never the entity's key, of a type its kind takes; and a property the input
 * requires is a required ask.
 */
function asksProblems(c: Descriptor['capabilities'][number]): string[] {
  if (!c.asks) return [];
  if (c.kind !== 'propose' && c.kind !== 'execute')
    return [`Capability ${c.name}: asks belong to a propose or an execute (D112).`];
  if (c.follows) return [`Capability ${c.name}: a follower is asked with a fact and asks the person nothing (D112).`];
  const input = asSchema(c.input);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const ask of c.asks) {
    const name = ask.property;
    const property = asSchema(input?.properties?.[name]);
    if (seen.has(name)) problems.push(`Capability ${c.name}: ask "${name}" is asked twice (D112).`);
    else if (!property) problems.push(`Capability ${c.name}: ask "${name}" names no property of the input (D112).`);
    else if (c.about?.param === name)
      problems.push(`Capability ${c.name}: ask "${name}" names the input that takes the entity's key (D112).`);
    else {
      const fit = fitProblem(ask, property);
      if (fit) problems.push(`Capability ${c.name}: ask "${name}" ${fit} (D112).`);
      if (requires(input, name) && !ask.required)
        problems.push(`Capability ${c.name}: ask "${name}" is optional, but the input requires ${name} (D112).`);
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
 * Why a capability's `effect` (D112) may not be used: it belongs to an execute and names a read of the same connector
 * that takes the same input and is never offered to the model. A read writes nothing by contract.
 */
function effectProblem(c: Descriptor['capabilities'][number], connector: Descriptor): string | undefined {
  if (c.kind !== 'execute') return `Capability ${c.name}: effect belongs to an execute (D112).`;
  const read = connector.capabilities.find(r => r.name === c.effect);
  if (!read || read.kind !== 'read')
    return `Capability ${c.name}: effect names ${c.effect}, which is not a read of this connector (D112).`;
  if (read.model)
    return `Capability ${c.name}: effect ${c.effect} is offered to the model; an effect read declares model: false (D112).`;
  if (!sameSchema(read.input, c.input))
    return `Capability ${c.name}: effect ${c.effect} takes another input than ${c.name}; it declares the same input schema (D112).`;
  return undefined;
}

/** The properties a schema lists. */
const listed = (schema: Schema | undefined) => Object.keys(schema?.properties ?? {});
/** Whether a schema's `enum` or `const`, where it has one, stays within `allowed`. */
const within = (schema: (Schema & { enum?: unknown; const?: unknown }) | undefined, allowed: readonly unknown[]) =>
  !schema ||
  ((!Array.isArray(schema.enum) || schema.enum.every(v => allowed.includes(v))) &&
    (schema.const === undefined || allowed.includes(schema.const)));
/**
 * Why an installation read named `<id>.holdings` does not fit the holdings profile (D108 item 9, D119), at load: its
 * input takes `{ cursor? }` and nothing else, and its output is a HoldingsOutput with nothing more and bounds no wider.
 * Clew also validates every answer against the profile itself; this catches a declaration that could never fit.
 */
function holdingsProblems(read: { name: string; input: unknown; output: unknown }): string[] {
  const problems: string[] = [];
  const input = asSchema(read.input);
  if (
    input?.type !== 'object' ||
    listed(input).some(k => k !== 'cursor') ||
    (Array.isArray(input.required) && input.required.length > 0) ||
    (listed(input).includes('cursor') && !plainStringProperty(read.input, 'cursor'))
  )
    problems.push(
      `Installation read ${read.name}: the holdings profile takes { cursor? }, an object whose only property is an optional string cursor and which requires nothing (D119).`,
    );
  const output = asSchema(read.output);
  const rows = asSchema(output?.properties?.rows) as (Schema & { maxItems?: unknown }) | undefined;
  const row = asSchema(rows?.items);
  const held = asSchema(row?.properties?.holdings) as (Schema & { maxItems?: unknown }) | undefined;
  const holding = asSchema(held?.items);
  const reported = asSchema(output?.properties?.withdrawalsReported) as (Schema & { const?: unknown }) | undefined;
  if (
    output?.type !== 'object' ||
    !requires(output, 'rows') ||
    !requires(output, 'withdrawalsReported') ||
    listed(output).some(k => !['rows', 'next', 'withdrawalsReported'].includes(k)) ||
    !(reported?.type === 'boolean' || typeof reported?.const === 'boolean') ||
    (listed(output).includes('next') && asSchema(output.properties?.next)?.type !== 'string') ||
    rows?.type !== 'array' ||
    row?.type !== 'object' ||
    !requires(row, 'key') ||
    !requires(row, 'holdings') ||
    listed(row).some(k => !['key', 'holdings', 'partial'].includes(k)) ||
    asSchema(row.properties?.key)?.type !== 'string' ||
    held?.type !== 'array' ||
    holding?.type !== 'object' ||
    ['id', 'type', 'label', 'kind', 'issuedOn'].some(k => !requires(holding, k)) ||
    listed(holding).some(k => !['id', 'type', 'label', 'kind', 'issuedOn', 'expiresOn'].includes(k)) ||
    !within(asSchema(holding.properties?.kind), HOLDING_KINDS)
  )
    problems.push(
      `Installation read ${read.name}: the holdings profile answers a HoldingsOutput: rows (each a required string key and holdings, optionally partial), withdrawalsReported (a boolean) and optionally next (a string), each holding requiring id, type, label, kind (one of ${HOLDING_KINDS.join(', ')}) and issuedOn, optionally expiresOn, and nothing else (D119).`,
    );
  else if (
    typeof rows.maxItems !== 'number' ||
    rows.maxItems > HOLDINGS_ROWS_MAX ||
    typeof held.maxItems !== 'number' ||
    held.maxItems > HOLDINGS_PER_ROW_MAX
  )
    problems.push(
      `Installation read ${read.name}: a page of the holdings profile is bounded: rows declares maxItems at most ${HOLDINGS_ROWS_MAX} and holdings at most ${HOLDINGS_PER_ROW_MAX} (D119).`,
    );
  return problems;
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
      const about = aboutProblem(c, connector, header, connector.assistants?.list);
      if (about) problems.push(about);
    }
    const access = accessProblem(c, connector);
    if (access) problems.push(access);
    problems.push(...asksProblems(c));
    if (c.effect !== undefined) {
      const effect = effectProblem(c, connector);
      if (effect) problems.push(effect);
    }
    schemaProblem(`Capability ${c.name} input`, c.input as object);
    schemaProblem(`Capability ${c.name} output`, c.output as object);
  }
  // Every input that names a person or a unit, declared or not, is a plain string property (D117), so what the loader
  // let in is what the registry resolves: never an array, an object or a property the schema does not list.
  // A connector on the previous protocol (D60) is held to it: the registry still refuses anything but a string at every call.
  for (const [name, inputs] of protocolTerms(connector.protocol ?? PROTOCOL_VERSION).strictNamedInputs
    ? namedInputs(connector)
    : []) {
    const c = connector.capabilities.find(x => x.name === name)!;
    for (const param of inputs.params)
      if (!plainStringProperty(c.input, param))
        problems.push(
          `Capability ${name}: ${param} names a ${inputs.entity}, so it must be a plain string property of the input: listed under properties with type string, in an object schema without allOf, anyOf, oneOf or patternProperties (D117).`,
        );
  }
  // The reads Clew makes as the installation (D119): a profile Clew knows, named for this connector, unique across both
  // lists, of the profile's shape. Added under protocol 3, so a manifest on 2 cannot declare one.
  const installation = connector.installation ?? [];
  if (installation.length && !protocolTerms(connector.protocol ?? PROTOCOL_VERSION).installation)
    problems.push(
      `Installation reads were added under protocol 3 (D119); a manifest on protocol ${connector.protocol} cannot declare installation.`,
    );
  for (const read of installation) {
    if (names.has(read.name)) problems.push(`Capability ${read.name} is already registered.`);
    names.add(read.name);
    const profile = read.name.startsWith(connector.id + '.') ? read.name.slice(connector.id.length + 1) : undefined;
    if (!profile || !(INSTALLATION_PROFILES as readonly string[]).includes(profile)) {
      problems.push(
        `Installation read ${read.name}: Clew reads only its profiles as the installation, named for this connector: ${INSTALLATION_PROFILES.map(p => `${connector.id}.${p}`).join(', ')} (D119).`,
      );
      continue;
    }
    schemaProblem(`Installation read ${read.name} input`, read.input as object);
    schemaProblem(`Installation read ${read.name} output`, read.output as object);
    if (profile === 'holdings') problems.push(...holdingsProblems(read));
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
  // The assistants profile: the read it names lists whom the person may ask, as the person, without a question, and is
  // never a model tool: Clew's model neither picks an assistant of another system nor speaks to one.
  if (connector.assistants) {
    const list = connector.assistants.list;
    const c = connector.capabilities.find(x => x.name === list);
    if (!protocolTerms(connector.protocol ?? PROTOCOL_VERSION).assistants)
      problems.push(
        `The assistants profile was added under protocol 3; a manifest on protocol ${connector.protocol} cannot declare assistants.`,
      );
    if (!c) problems.push(`Assistants names unknown capability ${list}.`);
    else if (c.kind !== 'read') problems.push(`Assistants capability ${c.name} must be a read.`);
    else {
      if (c.model) problems.push(`Assistants capability ${c.name} is never a tool; declare model: false.`);
      if (menuProblem({ ...c, menu: { label: 'x', icon: 'link' }, view: c.view ?? { kind: 'text', body: 'x' } }))
        problems.push(`Assistants capability ${c.name} must take no input.`);
    }
  }
  return problems;
}
