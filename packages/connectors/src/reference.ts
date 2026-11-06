import type { ManifestReference, ReferenceField, ReferenceRecipe, ReferenceRule, ReferenceSection } from '@clew/contracts';
import { ConnectorManifestSchema, PROTOCOL_ACCEPTED, PROTOCOL_VERSION, type ConnectorManifest } from './protocol';
/** TypeBox itself, for the test that evaluates the generated source and compares the schema it emits with the JSON it came from. */
export { Type as TypeBoxType } from '@sinclair/typebox';

/**
 * The manifest, field by field (D60, item 5): what each field does, its type, whether it is required, its constraints,
 * an example from a real manifest, and what it has to agree with. Walked from `ConnectorManifestSchema`, so a field
 * cannot be documented that does not exist, and rendered as Markdown (committed under docs/generated) and as HTML
 * (drawn with Astryx by the web app at `/protocol/manifest` from `/api/protocol/manifest-reference.json`). The rules are
 * prose kept true by tests against the loader and the registry. Pure: no I/O.
 */
type Schema = Record<string, any>;
export type Rule = ReferenceRule;
export type FieldEntry = ReferenceField;
export type Recipe = ReferenceRecipe;
export type { ManifestReference };

/** A field's type in words, the way the generated tables say it. */
export function shapeOf(schema: Schema): string {
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' / ');
  const variants: Schema[] | undefined = schema.anyOf ?? schema.oneOf;
  if (variants) {
    if (variants.every(v => 'const' in v)) return variants.map(v => JSON.stringify(v.const)).join(' / ');
    const key = discriminator(variants);
    if (key) return `object, one of \`${key}\`: ${variants.map(v => JSON.stringify(v.properties[key].const)).join(' / ')}`;
    return variants.map(shapeOf).join(' / ');
  }
  if (schema.type === 'array') return `array of ${shapeOf(schema.items ?? {})}`;
  if (schema.type === 'object' && schema.patternProperties) {
    const value = Object.values(schema.patternProperties)[0] as Schema;
    return Object.keys(value).length ? `map of string to ${shapeOf(value)}` : 'object (free keys)';
  }
  return schema.type ?? 'JSON value';
}
/** The property whose constant tells the variants of a union apart (`kind` of a view, `strategy` of an execution). */
function discriminator(variants: Schema[]): string | undefined {
  if (!variants.every(v => v.type === 'object' && v.properties)) return undefined;
  const first = variants[0]!;
  return Object.keys(first.properties).find(key => variants.every(v => v.properties[key] && 'const' in v.properties[key]) && new Set(variants.map(v => v.properties[key].const)).size === variants.length);
}
function constraintsOf(schema: Schema, prefix = ''): string[] {
  const out: string[] = [];
  const range = (min: unknown, max: unknown, unit: string) => min !== undefined && max !== undefined ? `${min} to ${max} ${unit}` : max !== undefined ? `at most ${max} ${unit}` : min !== undefined ? `at least ${min} ${unit}` : undefined;
  if (schema.pattern) out.push(`matches \`${schema.pattern}\``);
  const chars = range(schema.minLength, schema.maxLength, 'characters'); if (chars) out.push(chars);
  const items = range(schema.minItems, schema.maxItems, 'items'); if (items) out.push(items);
  if (schema.uniqueItems) out.push('no duplicates');
  const value = range(schema.minimum, schema.maximum, ''); if (value) out.push(value.trim());
  if (schema.format) out.push(`format ${schema.format}`);
  const prefixed = out.map(c => prefix + c);
  if (schema.type === 'array' && schema.items) prefixed.push(...constraintsOf(schema.items, 'each '));
  return prefixed;
}

function walk(schema: Schema, path: string, required: boolean, depth: number, out: FieldEntry[], variants?: string[]) {
  out.push({ id: anchorOf(path), path, depth, required, type: shapeOf(schema), description: schema.description ?? schema.items?.description ?? '', constraints: constraintsOf(schema), ...(variants ? { variants } : {}), rules: [] });
  children(schema, path, depth, out);
}
function children(schema: Schema, path: string, depth: number, out: FieldEntry[]) {
  if (schema.type === 'array') return children(schema.items ?? {}, path + '[]', depth, out);
  const variants: Schema[] | undefined = schema.anyOf ?? schema.oneOf;
  const key = variants && discriminator(variants);
  if (variants && key) {
    const names = variants.map(v => String(v.properties[key].const));
    const merged = new Map<string, { schema: Schema; present: string[]; required: string[] }>();
    variants.forEach((v, i) => { for (const [name, s] of Object.entries(v.properties as Record<string, Schema>)) { const m = merged.get(name) ?? { schema: s, present: [], required: [] }; m.present.push(names[i]!); if (v.required?.includes(name)) m.required.push(names[i]!); merged.set(name, m); } });
    for (const [name, m] of merged) {
      const everywhere = m.present.length === names.length;
      const { const: _c, ...rest } = m.schema;
      const s = name === key ? { ...rest, anyOf: variants.map(v => ({ const: v.properties[key].const })), description: variants.map(v => `\`${v.properties[key].const}\`: ${v.properties[key].description ?? ''}`.trimEnd()).join(' ') } : m.schema;
      walk(s, `${path}.${name}`, m.required.length === m.present.length, depth + 1, out, everywhere ? undefined : m.present);
    }
    return;
  }
  if (schema.type === 'object' && schema.properties) for (const [name, s] of Object.entries(schema.properties as Record<string, Schema>)) walk(s, path ? `${path}.${name}` : name, schema.required?.includes(name) ?? false, depth + 1, out);
}

/** Every value at a path in the examples, arrays flattened, in order. */
function valuesAt(value: unknown, segments: string[]): unknown[] {
  if (value === undefined || value === null) return [];
  if (!segments.length) return [value];
  const [head, ...rest] = segments;
  const name = head!.replace(/\[\]$/, '');
  const next = name ? (value as Record<string, unknown>)[name] : value;
  if (head!.endsWith('[]')) return Array.isArray(next) ? next.flatMap(item => valuesAt(item, rest)) : [];
  return valuesAt(next, rest);
}
const empty = (v: unknown) => v === '' || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Object.keys(v).length);
const EXAMPLE_LIMIT = 240;

/**
 * Examples for fields the two example connectors do not use, kept valid by a test that loads them in a manifest. A field
 * named here still takes its example from a real manifest when one has it.
 */
export const HANDWRITTEN_EXAMPLES: Record<string, unknown> = {
  'facts': [{ kind: 'hr:absence', title: 'Sjukfrånvaro', attributes: { type: 'object', properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, required: ['from'] } }],
  'facts[].kind': 'hr:absence', 'facts[].title': 'Sjukfrånvaro',
  'facts[].attributes': { type: 'object', properties: { from: { type: 'string', format: 'date' } }, required: ['from'] },
  'capabilities[].follows': ['hr:absence'], 'capabilities[].creates': 'hr:absence',
  'capabilities[].execution': { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'hr.absenceByOperation' },
  'capabilities[].execution.strategy': 'deduplicated', 'capabilities[].execution.retentionSeconds': 86400, 'capabilities[].execution.lookup': 'hr.absenceByOperation',
  'delegation': { audience: 'eneo' }, 'delegation.audience': 'eneo',
  'capabilities[].view.body': 'markdown', 'capabilities[].view.empty': 'Inga träffar.',
  'capabilities[].view.fields[].format': 'status', 'capabilities[].view.fields[].tones': { open: 'warn', closed: 'ok' },
  'capabilities[].view.input.filter': { key: 'state', label: 'Status', options: [{ value: 'open', label: 'Öppna' }, { value: 'closed', label: 'Avslutade' }] },
  'capabilities[].view.input.filter.key': 'state', 'capabilities[].view.input.filter.label': 'Status',
  'capabilities[].view.input.filter.options': [{ value: 'open', label: 'Öppna' }, { value: 'closed', label: 'Avslutade' }],
  'capabilities[].view.input.filter.options[].value': 'open', 'capabilities[].view.input.filter.options[].label': 'Öppna',
  'capabilities[].view.modelReads': 'summary',
};

/** The rules between fields, as Clew applies them. Each `loader` rule is proven by a test that breaks it and reads the problem. */
export const RULES: Rule[] = [
  { id: 'protocol-accepted', title: 'The protocol number is one this instance loads', fields: ['protocol'], enforced: 'loader', decision: 'D60',
    text: `A manifest on a retired or unknown number is refused, naming the number, the accepted ones and the reason. This instance loads ${PROTOCOL_ACCEPTED.join(' and ')}.` },
  { id: 'id-matches', title: 'The id is the registered id', fields: ['id'], enforced: 'loader', decision: 'D23',
    text: 'An administrator registers the connector under an id; a manifest with another id is refused.' },
  { id: 'name-prefixed', title: 'Every capability name starts with the id', fields: ['id', 'capabilities[].name'], enforced: 'loader', decision: 'D37',
    text: 'A capability is named `<id>.<verb>`. The name is the contract: keep it for a compatible change, choose a new name for a break.' },
  { id: 'execute-never-a-tool', title: 'An execute is never a tool', fields: ['capabilities[].kind', 'capabilities[].model'], enforced: 'loader', decision: 'D8',
    text: 'A capability of kind `execute` must declare `model: false`. It runs only through a human decision, and a callback cannot reach it either.' },
  { id: 'view-on-a-read', title: 'A view belongs to a read', fields: ['capabilities[].kind', 'capabilities[].view'], enforced: 'loader', decision: 'D38',
    text: 'Only a `read` may declare a view. A propose or execute with one is refused.' },
  { id: 'view-keys-in-output', title: 'A view names what the output declares', fields: ['capabilities[].output', 'capabilities[].view.rows', 'capabilities[].view.title', 'capabilities[].view.fields[].key', 'capabilities[].view.ref', 'capabilities[].view.body'], enforced: 'loader', decision: 'D38',
    text: 'Where the output schema declares `properties`, the view\'s `rows`, `title`, every field `key`, `ref` and `body` must be among them (the record\'s properties for a table or list). `title` must also be one of `fields`. An output without declared properties is not checked until the conformance check reads a real answer.' },
  { id: 'view-input-in-input', title: 'A view\'s controls bind to the input', fields: ['capabilities[].input', 'capabilities[].view.input.query.key', 'capabilities[].view.input.filter.key'], enforced: 'loader', decision: 'D38',
    text: 'The query and the filter each bind to a property the input schema declares, and not to the same one.' },
  { id: 'row-opens-own-read', title: 'A row opens a read of the same connector', fields: ['capabilities[].view.open.capability', 'capabilities[].view.open.params'], enforced: 'loader', decision: 'D35',
    text: '`open.capability` is a `read` of this manifest, and every key of `params` is an input property of that read, taken from a property the row has. A card\'s buttons and a row\'s link stay within one system.' },
  { id: 'menu-needs-open-view', title: 'A menu row is a view that opens without a question', fields: ['capabilities[].menu', 'capabilities[].view', 'capabilities[].input'], enforced: 'loader', decision: 'D40',
    text: '`menu` may be declared only on a `read` that has a `view` and whose input accepts `{}` (nothing `required`). The administrator still chooses which eligible views go in the menu; `menu` says what the row is called and marked with.' },
  { id: 'standing-exists', title: 'Standing actions are capabilities of this manifest', fields: ['areas[].standing', 'capabilities[].name'], enforced: 'loader',
    text: 'Every name under an area\'s `standing` must be a capability declared in the same manifest.' },
  { id: 'follows-on-a-propose', title: 'Only a propose follows a fact', fields: ['capabilities[].kind', 'capabilities[].follows'], enforced: 'registry', decision: 'D55',
    text: '`follows` may be declared only on a `propose`. Its input is a `FactEnvelope` and its output a `FollowResponse` whose steps name this connector only.' },
  { id: 'creates-declared', title: 'A created fact kind is declared in facts', fields: ['capabilities[].creates', 'facts[].kind'], enforced: 'registry', decision: 'D55',
    text: '`creates` must name one of the manifest\'s `facts`, so followers know the attributes they will receive.' },
  { id: 'scan-route', title: 'scan: true means you serve the scan route', fields: ['scan', 'areas[].id'], enforced: 'check', decision: 'D35',
    text: 'With `scan: true` Clew posts `/clew/scan` per person, nightly and on first visit. Each draft names an `area` of this manifest, its `topic` is the same for the same occurrence, and its actions name capabilities of this connector only. The conformance check runs the scan twice and compares.' },
  { id: 'figure-route', title: 'figure: true means you serve the figure route', fields: ['areas[].figure'], enforced: 'call',
    text: 'For an area with `figure: true` Clew posts `/clew/figure` with the area id and draws the one-line answer on the area\'s button. A connector that does not answer shows a warning figure, never an error.' },
  { id: 'uses-exact', title: 'Callbacks reach only what uses lists', fields: ['uses'], enforced: 'call', decision: 'D37',
    text: 'While serving a request, a connector may call back `POST /api/connectors/call` with the `callback` grant from the assertion, for the exact names in `uses` and as the same person. Anything else, and every `execute`, is refused.' },
  { id: 'search-profile', title: 'search and fetch make a search source', fields: ['capabilities[].kinds', 'capabilities[].name'], enforced: 'call', decision: 'D26',
    text: 'A `read` named `<id>.search` with `kinds` is a source of Clew\'s composite search: its output is a `SearchOutput`, and `<id>.fetch` takes one of its refs back and returns one `SearchHit`.' },
  { id: 'delegation-token', title: 'Delegation brings the person\'s own token', fields: ['delegation.audience'], enforced: 'call', decision: 'D26',
    text: 'With `delegation`, Clew exchanges the person\'s session for a token bound to `audience` and sends it in `X-Clew-Delegated-Token` beside the assertion. Scans, figures, callbacks and sessions without an IdP token carry none; the connector then answers `denied`.' },
];


/**
 * The same example authored in TypeScript with TypeBox (MIT), generated from the JSON so the two tabs cannot drift: the
 * subset of JSON Schema the examples use, and a manifest's other fields as plain literals. On the wire a schema is
 * always JSON Schema; this shows how it is written without writing it by hand. zod and Pydantic emit the same JSON.
 */
const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k: string) => ident.test(k) ? k : JSON.stringify(k);
const str = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** A JavaScript literal on one line: options objects, arrays of scalars. */
function inline(value: unknown): string {
  if (typeof value === 'string') return str(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([k, v]) => `${key(k)}: ${inline(v)}`).join(', ')} }`;
  return String(value);
}
const options = (schema: Schema, keys: string[]) => { const picked = Object.fromEntries(keys.filter(k => schema[k] !== undefined).map(k => [k, schema[k]])); return Object.keys(picked).length ? inline(picked) : ''; };
export function typeboxOf(schema: Schema, indent = ''): string {
  if ('const' in schema) return `Type.Literal(${inline(schema.const)})`;
  if (schema.enum) return `Type.Union([${schema.enum.map((v: unknown) => `Type.Literal(${inline(v)})`).join(', ')}])`;
  if (schema.anyOf) return `Type.Union([${schema.anyOf.map((v: Schema) => typeboxOf(v, indent)).join(', ')}])`;
  const call = (name: string, keys: string[], first?: string) => { const o = options(schema, keys); return `${name}(${[first, o].filter(Boolean).join(', ')})`; };
  switch (schema.type) {
    case 'string': return call('Type.String', ['format', 'pattern', 'minLength', 'maxLength', 'description']);
    case 'integer': return call('Type.Integer', ['minimum', 'maximum', 'description']);
    case 'number': return call('Type.Number', ['minimum', 'maximum', 'description']);
    case 'boolean': return call('Type.Boolean', ['description']);
    case 'array': return call('Type.Array', ['minItems', 'maxItems', 'uniqueItems', 'description'], typeboxOf(schema.items ?? {}, indent));
    case 'object': {
      if (!schema.properties) return 'Type.Record(Type.String(), Type.Unknown())';
      const inner = indent + '  ';
      const props = Object.entries(schema.properties as Record<string, Schema>).map(([k, v]) => { const expr = typeboxOf(v, inner); return `${inner}${key(k)}: ${schema.required?.includes(k) ? expr : `Type.Optional(${expr})`},`; }).join('\n');
      return call('Type.Object', ['additionalProperties', 'description'], `{\n${props}\n${indent}}`);
    }
  }
  return 'Type.Unknown()';
}
/** Which keys of an object hold a JSON Schema: a capability's input and output, a fact's attributes. A view's `input` is controls, not a schema. */
const schemaKeysOf = (value: Record<string, unknown>): string[] => 'name' in value && 'kind' in value ? ['input', 'output'] : typeof value['kind'] === 'string' && value['kind'].includes(':') && 'attributes' in value ? ['attributes'] : [];
/** A manifest fragment as a TypeScript literal, its schemas as TypeBox. */
export function typescriptOf(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (!value.some(v => v && typeof v === 'object')) return inline(value);
    const inner = indent + '  ';
    return `[\n${value.map(v => `${inner}${typescriptOf(v, inner)},`).join('\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const inner = indent + '  ';
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const schemas = schemaKeysOf(value as Record<string, unknown>);
    return `{\n${entries.map(([k, v]) => `${inner}${key(k)}: ${schemas.includes(k) && v && typeof v === 'object' ? typeboxOf(v as Schema, inner) : typescriptOf(v, inner)},`).join('\n')}\n${indent}}`;
  }
  return inline(value);
}
const holdsSchema = (value: unknown): boolean => Array.isArray(value) ? value.some(holdsSchema) : !!value && typeof value === 'object' && (schemaKeysOf(value as Record<string, unknown>).length > 0 || Object.values(value).some(holdsSchema));
/** The TypeBox module for a recipe: one exported constant per manifest, or none when the example holds no schema. */
export function typeboxModule(constants: Record<string, unknown>): string | undefined {
  if (!holdsSchema(constants)) return undefined;
  return [
    "import { Type } from '@sinclair/typebox';",
    '',
    ...Object.entries(constants).map(([name, value]) => `export const ${name} = ${typescriptOf(value)};`),
  ].join('\n') + '\n';
}

/** The three manifests of the job recipe: one object behind both the JSON and the TypeBox tab. */
const JOB_MANIFESTS = {
          hr: { id: 'hr', facts: [{ kind: 'hr:absence', title: 'Sjukfrånvaro', attributes: { type: 'object', properties: { person: { type: 'string' }, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, extent: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['person', 'from'] } }],
            capabilities: [{ name: 'hr.registerAbsence', kind: 'execute', title: 'Registrera frånvaro', description: 'Registrerar sjukfrånvaro i personalsystemet.', input: { type: 'object', properties: { person: { type: 'string' }, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, required: ['person', 'from'] }, output: {}, model: false, scope: { roles: ['manager'] }, creates: 'hr:absence' }] },
          tid: { id: 'tid', capabilities: [
            { name: 'tid.onAbsence', kind: 'propose', title: 'Justera schemat', description: 'Föreslår schemaändringar när en frånvaro registreras.', input: {}, output: {}, model: false, scope: {}, follows: ['hr:absence'] },
            { name: 'tid.adjustShift', kind: 'execute', title: 'Justera pass', description: 'Tar bort passen under frånvaron.', input: { type: 'object', properties: { person: { type: 'string' }, from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } }, required: ['person', 'from', 'to'] }, output: {}, model: false, scope: { roles: ['manager'] }, execution: { strategy: 'deduplicated', retentionSeconds: 604800, lookup: 'tid.byOperation' } },
            { name: 'tid.byOperation', kind: 'read', title: 'Slå upp operation', description: 'Slår upp en tidigare ändring.', input: { type: 'object', properties: { operationId: { type: 'string' } }, required: ['operationId'] }, output: {}, model: false, scope: { roles: ['manager'] } }] },
          lon: { id: 'lon', capabilities: [
            { name: 'lon.onAbsence', kind: 'propose', title: 'Bevaka löneunderlaget', description: 'Bevakar att lönesystemet läser frånvaron.', input: {}, output: {}, model: false, scope: {}, follows: ['hr:absence'] },
            { name: 'lon.absenceSeen', kind: 'read', title: 'Frånvaro i lönesystemet', description: 'Säger om en frånvaro har nått lönesystemet.', input: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] }, output: { type: 'object', properties: { seen: { type: 'boolean' } }, required: ['seen'] }, model: false, scope: { roles: ['manager'] } }] },
};

/** Three combinations people reach for, each as a fragment of a valid manifest. */
export function recipes(examples: ConnectorManifest[]): Recipe[] {
  const tool = examples.flatMap(m => m.capabilities).find(c => c.menu);
  const scanning = examples.find(m => m.scan && m.areas.length);
  return [
    { id: 'menu-tool', title: 'A read that can be a tool in the menu',
      text: 'A `read` with a `view` and an input that accepts `{}` is eligible for the menu under Verktyg (D40); an administrator chooses which eligible views go there. `menu` names the row and its icon. The same read also answers the assistant when `model` is true, and the view is drawn under the answer.',
      example: tool ?? {}, ...(tool ? { typebox: typeboxModule({ directory: tool }) } : {}) },
    { id: 'scan-cards', title: 'A scan that becomes cards',
      text: 'With `scan: true` Clew asks the connector, per person, what needs attention; each draft names an area of the manifest and carries actions of this connector (D35). The area shows the drafts as cards, its standing actions under "Gör själv", its schedules as text, and, with `figure: true`, one line from `/clew/figure` on its button.',
      example: scanning ? { scan: scanning.scan, areas: scanning.areas } : {} },
    { id: 'job-follower', title: 'Work across connectors: a fact, its followers, one approval (D55, proposed)',
      text: 'One event means work in several systems, and no connector writes in another. The connector that owns the event declares the fact kind under `facts` and marks the capability that brings it about with `creates`. Every other connector that has something to do declares a `propose` with `follows`. An administrator binds followers to the kind; an unbound offer is inert. When the fact arrives (the creating propose is chosen in the box, or a scan brings an existing `ref`), Clew posts the `FactEnvelope` below to every bound follower at once, as the person, and each answers with steps of its own connector only: an `execute` with its approved payload, or a `watch`, one of its reads repeated within a window until `expect` holds, for a system Clew cannot write in. Zero steps is an answer. Clew merges the steps into one job proposal, names the systems, says which did not answer, and the person approves once; each execute then runs as its own execution with its own write safety and read-back, each watch as timed reads, and undo is per step. No step reads another step\'s result: a result that must reach a third system becomes a fact on the receipt and the next job. To read another connector while answering, declare its capability under `uses` and call back; an execute can never be called back.',
      example: {
        manifests: JOB_MANIFESTS,
        exchange: {
          'POST tid/clew/capabilities/tid.onAbsence and lon/clew/capabilities/lon.onAbsence, as the person': { fact: { kind: 'hr:absence', ref: 'hr:absence:4711', attributes: { person: 'person:hassan', from: '2026-11-09', to: '2026-11-13', extent: 100 } } },
          'tid answers': { steps: [{ kind: 'execute', operation: 'tid.adjustShift', payload: { person: 'person:hassan', from: '2026-11-09', to: '2026-11-13' }, title: 'Ta bort passen 9 till 13 november', detail: 'Tidrapporteringen' }] },
          'lon answers': { steps: [{ kind: 'watch', operation: 'lon.absenceSeen', input: { ref: 'hr:absence:4711' }, expect: { path: ['seen'], equals: true }, within: 'P2D', title: 'Lönesystemet har läst sjukanmälan', detail: 'Bevakas i två dygn' }] },
          'then': 'The person approves the job once. Clew runs tid.adjustShift as its own execution (deduplicated on the operation id, looked up by tid.byOperation) and reads lon.absenceSeen as the person until seen is true or two days have passed, then draws a card either way.',
        },
      },
      typebox: typeboxModule(JOB_MANIFESTS) },
  ];
}

/** The page's sections: the document's own fields, then one per top-level structure, the view on its own. */
const SECTIONS: Array<{ id: string; title: string; holds: (path: string) => boolean }> = [
  { id: 'document', title: 'The document', holds: p => !p.includes('.') && !['areas', 'capabilities', 'facts', 'delegation'].includes(p) },
  { id: 'areas', title: 'areas[]', holds: p => p.startsWith('areas') },
  { id: 'capabilities', title: 'capabilities[]', holds: p => p.startsWith('capabilities') && !p.startsWith('capabilities[].view') },
  { id: 'view', title: 'capabilities[].view', holds: p => p.startsWith('capabilities[].view') },
  { id: 'facts', title: 'facts[]', holds: p => p.startsWith('facts') },
  { id: 'delegation', title: 'delegation', holds: p => p.startsWith('delegation') },
];
export const anchorOf = (path: string) => 'field-' + path.replace(/\[\]/g, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
export function manifestReference(examples: ConnectorManifest[]): ManifestReference {
  const fields: FieldEntry[] = [];
  children(ConnectorManifestSchema as unknown as Schema, '', -1, fields);
  for (const field of fields) {
    const candidates = examples.flatMap(m => valuesAt(m, field.path.split('.')));
    const example = candidates.find(v => !empty(v)) ?? candidates[0] ?? HANDWRITTEN_EXAMPLES[field.path];
    if (example !== undefined && JSON.stringify(example).length <= EXAMPLE_LIMIT) field.example = example;
    field.rules = RULES.filter(r => r.fields.includes(field.path));
  }
  const sections: ReferenceSection[] = SECTIONS.map(s => ({ id: s.id, title: s.title, paths: fields.filter(f => s.holds(f.path)).map(f => f.path) })).filter(s => s.paths.length);
  return { protocol: PROTOCOL_VERSION, accepted: [...PROTOCOL_ACCEPTED], sections, fields, rules: RULES, recipes: recipes(examples) };
}

const INTRO = 'One entry per field of the connector manifest: what it does, its type, whether it is required, its constraints, an example and what it must agree with. Generated from the schema the instance validates with, so nothing here is a field that does not exist. The Swedish in examples is what a person reads in Clew; everything else in a manifest is English.';
const code = (value: unknown) => JSON.stringify(value, null, 2);
const requiredText = (f: FieldEntry) => (f.required ? 'required' : 'optional') + (f.variants ? ` (${f.variants.join(', ')} only)` : '');

export interface RenderOptions { decisionLink?: (decision: string) => string | undefined }

export function referenceMarkdown(reference: ManifestReference, options: RenderOptions = {}): string {
  const decision = (d?: string) => d ? (options.decisionLink?.(d) ? ` ([${d}](${options.decisionLink(d)}))` : ` (${d})`) : '';
  const lines: string[] = ['# Manifest field reference', '', `Protocol **${reference.protocol}**. ${INTRO}`, '',
    'A running Clew draws this page at `/protocol/manifest`, serves it as data at `/api/protocol/manifest-reference.json`, the routes as OpenAPI at `/api/protocol`, and a dry run of a manifest at `POST /api/protocol/manifest` (D60). Field tables with less prose: [generated reference](README.md); the wire shapes: [JSON Schema](../protocol/connector-protocol.schema.json).', '',
    '## Recipes', ''];
  lines.push('On the wire a schema is JSON Schema. Write it in your language\'s schema library and emit it (TypeBox or zod in TypeScript, Pydantic in Python); where a recipe holds a schema, the same manifest follows authored with TypeBox.', '');
  for (const r of reference.recipes) { lines.push(`### ${r.title}`, '', r.text, '', '```json', code(r.example), '```', ''); if (r.typebox) lines.push('The same, authored with TypeBox:', '', '```ts', r.typebox.trimEnd(), '```', ''); }
  lines.push('## Fields', '');
  for (const section of reference.sections) {
    const fields = section.paths.map(p => reference.fields.find(f => f.path === p)!);
    lines.push(`### ${section.title}`, '');
    for (const f of fields) {
      lines.push(`#### \`${f.path}\``, '', f.description || '(no description)', '', `- Type: ${f.type}`, `- ${requiredText(f)}`);
      if (f.constraints.length) lines.push(`- Constraints: ${f.constraints.join('; ')}`);
      if (f.rules.length) { lines.push('- Pairs with:'); for (const r of f.rules) lines.push(`  - **${r.title}.** ${r.text}${decision(r.decision)}`); }
      if (f.example !== undefined) lines.push('', 'Example:', '', '```json', code(f.example), '```');
      lines.push('');
    }
  }
  lines.push('## Every rule', '', 'Where Clew applies each: when the manifest is loaded, when the connector is registered, in the conformance check, or on each call.', '');
  for (const r of reference.rules) lines.push(`- **${r.title}** (${r.enforced}; ${r.fields.map(f => `\`${f}\``).join(', ')})${decision(r.decision)}: ${r.text}`);
  return lines.join('\n') + '\n';
}
