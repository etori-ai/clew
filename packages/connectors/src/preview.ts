import { ANY_TONE, rowsKey, type ViewField } from '@clew/contracts';
import { menuRowOf, placesOf } from './views';
import { manifestProblems } from './remote';
import { RULES, anchorOf, manifestReference, shapeOf } from './reference';
import {
  PROTOCOL_ACCEPTED,
  PROTOCOL_VERSION,
  type ActionPathPreview,
  type ConnectorManifest,
  type InputFiller,
  type ManifestIssue,
  type ManifestPreview,
} from './protocol';

/**
 * A dry run of a manifest document (D60): the pure part of `POST /api/protocol/manifest`. The same rules the loader
 * applies, with every problem listed rather than the first thrown and each placed (its path, its manifest reference entry,
 * the rule it breaks), and, when the document passes, what Clew would make of it: who may call what, what the model is
 * offered, what could be a row in the menu, where a capability about an entity would show and who would see it there,
 * which read opens which (D97), rows to draw those places with, and what the conformance check would and would not
 * exercise. No I/O; an integrator gets this before any service exists.
 */
export interface PreviewOptions {
  /** The id the connector will be registered with, when known. */
  id?: string;
  /** Validates `{}` against an input schema with a real validator. Absent, a schema that lists `required` properties is taken to need input. */
  acceptsEmptyInput?: (schema: object) => boolean;
}
const listsNothingRequired = (schema: object) =>
  !((schema as { required?: unknown }).required as unknown[] | undefined)?.length;
type Role = 'manager' | 'employee';
const BOTH: Role[] = ['manager', 'employee'];
type ManifestCapability = ConnectorManifest['capabilities'][number];
type PreviewCapability = NonNullable<ManifestPreview['manifest']>['capabilities'][number];

export function previewManifest(document: unknown, options: PreviewOptions = {}): ManifestPreview {
  const protocol = { current: PROTOCOL_VERSION, accepted: [...PROTOCOL_ACCEPTED] };
  const problems = manifestProblems(document, options.id);
  if (problems.length) return { ok: false, protocol, problems, issues: problems.map(p => placeProblem(p, document)) };
  const manifest = document as ConnectorManifest;
  const accepts = options.acceptsEmptyInput ?? listsNothingRequired;
  const capabilities = manifest.capabilities.map((c): PreviewCapability => {
    const roles = c.scope.roles ?? BOTH;
    const needsInput = !accepts(c.input as object);
    const check =
      c.kind === 'execute'
        ? 'Not called: an execute runs only after a human decision.'
        : c.kind === 'read' && c.about
          ? `Called with { keys } as ${roles.join(' and ')}: an unknown key and keys asked by a person on another unit must answer no row and no error; the keys given to the check (--keys, signed --as a person who may see them) must come back one row per key, each carrying a key it was asked with, within the budget.`
          : needsInput
            ? 'Not called: it needs input. Test it against your own fixture.'
            : `Called with {} as ${roles.join(' and ')}${roles.length < 2 ? `; the other role must be refused by scope` : ''}${c.view ? `; the ${c.view.kind} view is checked against the answer` : ''}.`;
    const samples = samplesOf(c);
    return {
      name: c.name,
      kind: c.kind,
      title: c.title,
      roles,
      tool: c.model && c.kind !== 'execute',
      needsInput,
      view: c.view?.kind ?? null,
      menu: menuRowOf(c) ?? null,
      check,
      ...(c.follows ? { follows: c.follows } : {}),
      ...(c.creates ? { creates: c.creates } : {}),
      ...(c.about ? { about: c.about } : {}),
      places: placesOf(c),
      openedFrom: manifest.capabilities.flatMap(o =>
        (o.view?.kind === 'table' || o.view?.kind === 'list') && o.view.open?.capability === c.name ? [o.name] : [],
      ),
      audience: audienceOf(c, roles),
      ...(samples ? { samples } : {}),
      ...(c.asks ? { asks: c.asks } : {}),
      ...(c.effect ? { effect: c.effect } : {}),
      ...(c.kind !== 'read' ? { path: pathPreviewOf(c, manifest) } : {}),
    };
  });
  return {
    ok: true,
    protocol,
    problems: [],
    issues: [],
    manifest: {
      id: manifest.id,
      source: manifest.source,
      kind: manifest.kind,
      scan: manifest.scan,
      delegation: manifest.delegation?.audience ?? null,
      uses: manifest.uses ?? [],
      facts: (manifest.facts ?? []).map(f => f.kind),
      capabilities,
      areas: manifest.areas.map(a => ({
        id: a.id,
        title: a.title,
        roles: a.roles,
        standing: a.standing,
        figure: !!a.figure,
        icon: a.icon ?? null,
      })),
      menu: capabilities.flatMap(c => (c.menu ? [{ capability: c.name, label: c.menu.label, icon: c.menu.icon }] : [])),
      // The reads Clew makes as the installation (D119): no person reaches them, and the check reads their first pages.
      ...(manifest.installation?.length
        ? {
            installation: manifest.installation.map(r => ({
              name: r.name,
              title: r.title,
              check:
                'Read as the installation, with no person behind it: its first two pages, counted and not shown. A person signed on its route must be refused (401).',
            })),
          }
        : {}),
    },
  };
}

/**
 * Both halves of a write (D112 item 11), from the declaration alone: where a person can start it, which steps of the one
 * path it draws, and who fills each property of its input. What a draft's action declares (`confirm`, `review: "each"`,
 * its `input`) the manifest cannot say, and the preview says so.
 */
function pathPreviewOf(c: ManifestCapability, manifest: ConnectorManifest): ActionPathPreview {
  const execute = c.kind === 'execute';
  const state = (declared: boolean) => (declared ? ('declared' as const) : ('not-declared' as const));
  const draftsWorkItems = manifest.scan || manifest.capabilities.some(o => o.kind === 'propose' && o.about?.param);
  const standing = manifest.areas.some(a => a.standing.includes(c.name));
  const follower = manifest.capabilities.some(o => o.kind === 'propose' && o.follows?.length);
  const input = c.input as { properties?: Record<string, Record<string, unknown>>; required?: unknown };
  const required = new Set(Array.isArray(input.required) ? (input.required as string[]) : []);
  const refs = input.properties?.['refs'] as { type?: unknown } | undefined;
  return {
    starts: [
      { place: 'work-item', state: state(draftsWorkItems), declares: 'scan: true' },
      { place: 'entity', state: state(!!c.about?.param), declares: 'about: { entity, param }' },
      { place: 'question-box', state: state(standing), declares: 'areas[].standing' },
      execute
        ? { place: 'conversation', state: 'never', declares: 'model: true' }
        : { place: 'conversation', state: state(c.model), declares: 'model: true' },
      execute
        ? { place: 'fact', state: state(follower), declares: 'follows, on a propose of this manifest' }
        : { place: 'fact', state: state(!!c.follows?.length), declares: 'follows' },
    ],
    steps: [
      { step: 'fill-in', state: state(!!c.asks?.length), declares: 'asks' },
      execute
        ? { step: 'effect', state: state(!!c.effect), declares: 'effect' }
        : { step: 'effect', state: 'never', declares: 'effect' },
      { step: 'confirm', state: 'on-the-work-item', declares: 'ThreadDraft.actions[].confirm' },
      execute && refs?.type === 'array'
        ? { step: 'review', state: 'on-the-work-item', declares: 'ThreadDraft.actions[].review: "each", preview' }
        : { step: 'review', state: 'never', declares: 'ThreadDraft.actions[].review: "each", preview' },
      execute
        ? { step: 'receipt', state: 'always', declares: 'ExecuteResult { rows, undoCapability, undoMinutes }' }
        : { step: 'receipt', state: 'never', declares: 'ExecuteResult' },
    ],
    input: Object.entries(input.properties ?? {}).map(([property, schema]) => {
      const ask = c.asks?.find(a => a.property === property);
      const by: InputFiller = c.follows?.length
        ? 'fact'
        : property === c.about?.param
          ? 'entity'
          : ask
            ? 'person'
            : (property === 'refs' && (schema as { type?: unknown }).type === 'array') ||
                (property === 'reviews' && !!c.review)
              ? 'rows'
              : required.has(property)
                ? 'work-item'
                : 'source';
      const format = typeof schema['format'] === 'string' ? `, ${schema['format']}` : '';
      return {
        property,
        type: shapeOf(schema) + format,
        required: required.has(property),
        by,
        ...(ask ? { ask } : {}),
      };
    }),
  };
}

/** The words for an entity kind in the audience's sentences. */
const NOUNS = { person: 'person', unit: 'unit' } as const;
/** Who a scope names, at the start of a sentence: anyone when it names both roles. */
const whoOf = (roles: Role[], anyone: string) =>
  roles.length > 1 ? anyone : roles[0] === 'manager' ? 'A manager' : 'An employee';
/**
 * Who would see a capability about an entity, place by place (D97), from its scope and the declaration alone. A lens and
 * a mark live on a list of that kind and wait for an administrator's choice; a list of people is a manager's (Personal,
 * D94), so a read about a person that leaves managers out reaches nobody there. A section is on the opened entity, for
 * whoever opens one the connector answers a row for. An action is in the entity's menu and on its row. A read about an
 * entity is never a tool. The connector's audience (D23) narrows every place further.
 */
function audienceOf(c: ManifestCapability, roles: Role[]): PreviewCapability['audience'] {
  if (!c.about) return [];
  const one = NOUNS[c.about.entity];
  if (c.kind !== 'read')
    return [
      {
        places: ['menu'],
        who: `${whoOf(roles, 'Anyone')} who opens a ${one} or meets one on a list; the action becomes a card and runs only after their decision.`,
      },
      {
        places: ['tool'],
        who:
          c.kind === 'execute'
            ? 'No. An execute is never offered to the model.'
            : c.model
              ? 'Yes, once an administrator enables tools for the connector.'
              : 'No. It declares model: false.',
      },
    ];
  const listed = placesOf(c).filter((p): p is 'lens' | 'mark' => p === 'lens' || p === 'mark');
  const list =
    c.about.entity === 'person'
      ? roles.includes('manager')
        ? `${roles.length > 1 ? 'A person who has a list of people: a manager' : 'A manager'} on Personal, once an administrator chooses the source.`
        : "Nobody yet: the list of people is a manager's (Personal), and the scope leaves managers out."
      : `${whoOf(roles, 'A person')} who has a list of units, once an administrator chooses the source.`;
  return [
    ...(listed.length ? [{ places: listed, who: list }] : []),
    { places: ['section'], who: `${whoOf(roles, 'Anyone')} who opens a ${one} the connector answers a row for.` },
    { places: ['tool'], who: `No. A read about a ${one} is never offered to the model.` },
  ];
}

/** A moment that reads "tors 12 nov. kl. 09:00" in Swedish time, and its day. Fixed, so a preview never depends on the clock. */
const SAMPLE_INSTANT = '2026-11-12T08:00:00.000Z';
const SAMPLE_DATE = '2026-11-12';
const SAMPLE_TEXT = 'Exempel';
const SAMPLE_ROWS_MAX = 6;
type JsonSchema = { type?: unknown; enum?: unknown[]; const?: unknown; properties?: Record<string, JsonSchema> };
const typesOf = (s: JsonSchema | undefined): unknown[] => (Array.isArray(s?.type) ? s.type : s?.type ? [s.type] : []);
const allowedOf = (s: JsonSchema | undefined): unknown[] =>
  Array.isArray(s?.enum) ? s.enum : s && 'const' in s ? [s.const] : [];
/** A tone's key as the value it stands for: `true` and `false` for a yes or no, a number where the schema says so. */
function valueOfKey(word: string, s: JsonSchema | undefined): unknown {
  const types = typesOf(s);
  if ((word === 'true' || word === 'false') && !types.includes('string')) return word === 'true';
  if (types.some(t => t === 'number' || t === 'integer') && !types.includes('string') && Number.isFinite(Number(word)))
    return Number(word);
  return word;
}
/** One value for a field that names no toned values: by its format, else what its schema allows, else a placeholder. */
function plainValue(field: ViewField, s: JsonSchema | undefined): unknown {
  if (field.format === 'instant') return SAMPLE_INSTANT;
  if (field.format === 'date') return SAMPLE_DATE;
  if (field.format === 'email') return 'exempel@example.org';
  if (field.format === 'phone') return '+46 70 000 00 00';
  if (field.format === 'link') return 'https://example.org/';
  const allowed = allowedOf(s);
  if (allowed.length) return allowed[0];
  const types = typesOf(s);
  if (field.format === 'number' || types.some(t => t === 'number' || t === 'integer')) return 2;
  if (types.includes('boolean')) return true;
  return SAMPLE_TEXT;
}
/** The values a field takes in turn across the samples: each it gives a tone, and one more for `*`, the tone of any other. */
function sampleValues(field: ViewField, s: JsonSchema | undefined): unknown[] {
  const tones = field.tones ?? {};
  const named = Object.keys(tones)
    .filter(k => k !== ANY_TONE)
    .map(k => valueOfKey(k, s));
  if (Object.prototype.hasOwnProperty.call(tones, ANY_TONE)) {
    const taken = new Set(named.map(String));
    const other = [...allowedOf(s), plainValue(field, s), `${SAMPLE_TEXT} 2`, 3].find(
      v => v !== null && v !== '' && !taken.has(String(v)),
    );
    named.push(other);
  }
  return named.length ? named : [plainValue(field, s)];
}
/**
 * Rows to draw a read about an entity with before any service runs (D97): one per value a field gives a tone (at most
 * six), each field taking its values in turn, every row a synthetic `key`. From the view and the output schema alone.
 */
function samplesOf(c: ManifestCapability): Array<Record<string, unknown>> | undefined {
  const view = c.view;
  if (!c.about || c.kind !== 'read' || (view?.kind !== 'table' && view?.kind !== 'list')) return undefined;
  const rows = (c.output as JsonSchema).properties?.[rowsKey(view)!] as { items?: JsonSchema } | undefined;
  const properties = rows?.items?.properties ?? {};
  const columns = view.fields.map(f => [f.key, sampleValues(f, properties[f.key])] as const);
  const count = Math.min(SAMPLE_ROWS_MAX, Math.max(1, ...columns.map(([, values]) => values.length)));
  return Array.from({ length: count }, (_, i) => ({
    ...Object.fromEntries(columns.map(([key, values]) => [key, values[i % values.length]])),
    key: `exempel-${i + 1}`,
  }));
}

/**
 * Where a problem is (D60, D97): the loader's sentence matched to the place in the document it names and to the rule of
 * the manifest reference (`RULES`) it breaks. The sentences are the loader's (`remote.ts`, `validation.ts`, `views.ts`);
 * a unit test breaks every loader rule and reads the place back, so a sentence that changes without this table fails it.
 */
type Located = { rule?: string; path: string };
type Manifestish = {
  capabilities?: Array<{
    name?: string;
    view?: { fields?: Array<{ key?: string }> };
    asks?: Array<{ property?: string }>;
  }>;
  installation?: Array<{ name?: string }>;
  facts?: Array<{ kind?: string }>;
  areas?: Array<{ id?: string; standing?: string[] }>;
};
const indexOf = <T>(list: T[] | undefined, match: (item: T) => boolean, last = false) => {
  const all = list ?? [];
  for (let i = last ? all.length - 1 : 0; last ? i >= 0 : i < all.length; i += last ? -1 : 1)
    if (match(all[i]!)) return i;
  return -1;
};
const at = (base: string, i: number) => (i < 0 ? base : `${base}[${i}]`);
/** The sentences about one capability, after "Capability <name>": the rule each breaks and the path under the capability. */
const CAPABILITY_PROBLEMS: Array<[RegExp, string | undefined, string | ((match: RegExpMatchArray) => string)]> = [
  [/^ must be prefixed with /, 'name-prefixed', '.name'],
  [/^ is already registered\./, undefined, '.name'],
  [/^: execute capabilities are never tools/, 'execute-never-a-tool', '.model'],
  [/^: only a read capability can declare a view/, 'view-on-a-read', '.view'],
  [/^: view body "/, 'view-keys-in-output', '.view.body'],
  [/^: a view field is listed twice/, undefined, '.view.fields'],
  [/^: view field "([^"]*)" has a unit but is not a number/, undefined, 'field:unit'],
  [/^: view field "([^"]*)" is beside nothing/, 'view-beside-follows', 'field:beside'],
  [/^: view fields .* are all compact/, 'view-compact-once', '.view.fields'],
  [/^: view title "/, 'view-keys-in-output', '.view.title'],
  [/^: view rows "/, 'view-keys-in-output', '.view.rows'],
  [/^: view input "/, 'view-input-in-input', '.view.input'],
  [/^: the view's query and filter bind the same input/, 'view-input-in-input', '.view.input'],
  [/^: a row opens /, 'row-opens-own-read', '.view.open.capability'],
  [/^: \S+ takes no input "/, 'row-opens-own-read', '.view.open.params'],
  [/^: a row has no "/, 'row-opens-own-read', '.view.open.params'],
  [/^: view ref "/, 'view-keys-in-output', '.view.ref'],
  [/^: view field "([^"]*)" is not in the output schema/, 'view-keys-in-output', 'field:key'],
  [/^: view subject "/, 'view-subject-is-a-string', '.view.subject.key'],
  [/^: record section "/, 'view-keys-in-output', '.view'],
  [/^: (item |unknown item field)/, undefined, '.view.items'],
  [/^: (only a read capability can be a tool in the menu|a menu row opens)/, 'menu-needs-open-view', '.menu'],
  [/^: document views require/, undefined, '.view'],
  [/^: review must name/, undefined, '.review'],
  [/^: only a propose can follow a fact/, 'follows-on-a-propose', '.follows'],
  [/^ creates /, 'creates-declared', '.creates'],
  [/^: follows and about exclude each other/, 'about-not-a-follower', '.about'],
  [/^: a profile read or the header/, 'about-not-a-profile', '.about'],
  [/^: only Clew's own connectors name a page/, undefined, '.about.page'],
  [/^: a read about an entity takes its keys in keys and declares no param/, 'about-read-keys', '.about.param'],
  [/^: a read about an entity takes \{ keys \}/, 'about-read-keys', '.input'],
  [/^: a read about an entity declares a table or list view/, 'about-read-rows', '.view'],
  [
    /^: a read about an entity answers each row .*its output (\S+) must be/,
    'about-read-rows',
    m => `.output.properties.${m[1]}.items`,
  ],
  [/^: a read about an entity is never a tool/, 'about-never-a-tool', '.model'],
  [/^: an action about an entity names in param/, 'about-action-param', '.about.param'],
  [/^: an action about an entity requires /, 'about-action-key-alone', '.input.required'],
  [/^: person is about people/, 'person-not-a-unit', '.person'],
  [/^: unit belongs to a capability about a unit/, 'unit-on-a-unit', '.unit'],
  [/^: only Clew's own connectors take a person by Clew's id/, undefined, '.person'],
  [/^: a capability about a person takes its key in keys or about\.param/, 'person-param', '.person.param'],
  [/^: person names no input/, 'person-param', '.person'],
  [
    /^: (\S+) names a (person|unit), so it must be a plain string property/,
    'named-input-is-a-string',
    m => `.input.properties.${m[1]}`,
  ],
  [/^: (asks belong to a propose or an execute|a follower is asked with a fact)/, 'asks-on-an-action', '.asks'],
  [/^: ask "([^"]*)" (is asked twice|names no property|names the input that takes)/, 'ask-names-input', 'ask:property'],
  [/^: ask "([^"]*)" is optional, but the input requires/, 'ask-fits-input', 'ask:required'],
  [/^: ask "([^"]*)" is a choice, whose options/, 'ask-fits-input', 'ask:options'],
  [/^: ask "([^"]*)" is (a meeting|a date|text|long-text), which takes/, 'ask-fits-input', 'ask:kind'],
  [/^: effect /, 'effect-is-a-read', '.effect'],
  [/^ input: /, undefined, '.input'],
  [/^ output: /, undefined, '.output'],
];
function locate(problem: string, document: Manifestish): Located {
  const pointer = /^(\/[^:]*): /.exec(problem);
  if (pointer) {
    const path = pointer[1]!
      .split('/')
      .slice(1)
      .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((p, s) => (/^\d+$/.test(s) ? `${p}[${s}]` : p ? `${p}.${s}` : s), '');
    return path === 'protocol' && / is not accepted by this Clew/.test(problem)
      ? { rule: 'protocol-accepted', path }
      : { path };
  }
  if (problem.startsWith('Manifest id ')) return { rule: 'id-matches', path: 'id' };
  const capability = /^Capability ([^\s:]+)(.*)$/s.exec(problem);
  if (capability) {
    const [, name, rest] = capability;
    const duplicate = rest!.startsWith(' is already registered');
    const base = at(
      'capabilities',
      indexOf(document.capabilities, c => c.name === name, duplicate),
    );
    for (const [pattern, rule, suffix] of CAPABILITY_PROBLEMS) {
      const match = pattern.exec(rest!);
      if (!match) continue;
      let path: string;
      if (typeof suffix === 'function') path = base + suffix(match);
      else if (suffix.startsWith('field:')) {
        const fields = document.capabilities?.find(c => c.name === name)?.view?.fields;
        const j = indexOf(fields, f => f.key === match[1]);
        path = `${base}.view.${at('fields', j)}${j < 0 ? '' : '.' + suffix.slice('field:'.length)}`;
      } else if (suffix.startsWith('ask:')) {
        // The last ask with the name: an ask asked twice is placed at the second.
        const asks = document.capabilities?.find(c => c.name === name)?.asks;
        const j = indexOf(asks, a => a.property === match[1], true);
        path = `${base}.${at('asks', j)}${j < 0 ? '' : '.' + suffix.slice('ask:'.length)}`;
      } else path = base + suffix;
      return { ...(rule ? { rule } : {}), path };
    }
    return { path: base };
  }
  // The reads Clew makes as the installation (D119).
  if (problem.startsWith('Installation reads were added under protocol 3'))
    return { rule: 'installation-on-3', path: 'installation' };
  const installation = /^Installation read ([^\s:]+)(?: (input|output))?: (.*)$/s.exec(problem);
  if (installation) {
    const [, name, schema, rest] = installation;
    const base = at(
      'installation',
      indexOf(document.installation, r => r.name === name),
    );
    if (schema) return { path: `${base}.${schema}` };
    if (/^Clew reads only its profiles/.test(rest!)) return { rule: 'installation-profile', path: `${base}.name` };
    if (/^the holdings profile takes/.test(rest!))
      return { rule: 'installation-holdings-input', path: `${base}.input` };
    return { rule: 'installation-holdings-output', path: `${base}.output` };
  }
  const fact = /^Fact (\S+) (must be prefixed|is declared twice|attributes:)/.exec(problem);
  if (fact) {
    const i = indexOf(document.facts, f => f.kind === fact[1], fact[2] === 'is declared twice');
    return { path: `${at('facts', i)}.${fact[2] === 'attributes:' ? 'attributes' : 'kind'}` };
  }
  const standing = /^Area (\S+) lists unknown standing capability (\S+)\.$/.exec(problem);
  if (standing) {
    const i = indexOf(document.areas, a => a.id === standing[1]);
    const j = indexOf(document.areas?.[i]?.standing, s => s === standing[2]);
    return { rule: 'standing-exists', path: `${at('areas', i)}.${at('standing', j)}` };
  }
  const area = /^Area (\S+) is declared twice/.exec(problem);
  if (area)
    return {
      path: `${at(
        'areas',
        indexOf(document.areas, a => a.id === area[1], true),
      )}.id`,
    };
  if (problem.startsWith('Header ')) return { path: 'header.capability' };
  return { path: '' };
}
/** The manifest reference's entries by path, built once: the reference walks the schema the loader validates with. */
let referenced: Set<string> | undefined;
/** The reference entry a path falls under: indices dropped, then the path shortened until it is one. */
function fieldOf(path: string): string {
  referenced ??= new Set(manifestReference([]).fields.map(f => f.path));
  let field = path.replace(/\[\d+\]/g, '[]');
  while (field && !referenced.has(field))
    field = field.endsWith('[]')
      ? field.slice(0, -2)
      : field.includes('.')
        ? field.slice(0, field.lastIndexOf('.'))
        : '';
  return field;
}
/** One problem placed: its path, the reference entry and the rule, and the reference page's anchor for the most precise of them. */
export function placeProblem(problem: string, document: unknown): ManifestIssue {
  const located = locate(problem, (document && typeof document === 'object' ? document : {}) as Manifestish);
  const rule = located.rule ? RULES.find(r => r.id === located.rule) : undefined;
  const field = fieldOf(located.path);
  return {
    problem,
    path: located.path,
    field,
    anchor: rule ? `rule-${rule.id}` : field ? anchorOf(field) : 'fields',
    ...(rule ? { rule: { id: rule.id, title: rule.title } } : {}),
  };
}
