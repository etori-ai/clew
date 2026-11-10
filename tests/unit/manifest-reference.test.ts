import { describe, expect, test } from 'bun:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { FactEnvelopeSchema, FollowResponseSchema } from '../../packages/connectors/src/protocol';
import {
  HANDWRITTEN_EXAMPLES,
  RULES,
  TypeBoxType,
  anchorOf,
  manifestReference,
  referenceMarkdown,
  shapeOf,
  typeboxOf,
} from '../../packages/connectors/src/reference';
import { manifestProblems, parseManifest, remoteConnector } from '../../packages/connectors/src/remote';
import { Registry } from '../../packages/connectors/src/index';
import { protocolRoutes } from '../../apps/server/src/routes/protocol';
import { manifest as hello } from '../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../connectors/phonebook/connector.mjs';

/** The manifest field by field (D60, item 5): walked from the schema, exemplified from real manifests, its rules proven against the loader. */
const examples = [parseManifest(phonebook, 'phonebook'), parseManifest(hello, 'hello')];
const reference = manifestReference(examples);
const paths = reference.fields.map(f => f.path);
const copy = (m: unknown) => JSON.parse(JSON.stringify(m));
const broken = (base: unknown, change: (m: any) => void) => {
  const m = copy(base);
  change(m);
  return m;
};
const transport = { url: 'http://x', assert: async () => 'x' };
const ajv = addFormats(new Ajv({ strict: false }));
/** A read asked with a batch of keys and an action that takes one (D97), as a manifest declares them. */
const keysInput = {
  type: 'object',
  properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
  required: ['keys'],
};
const aboutManifest = {
  protocol: 2,
  id: 'hr',
  kind: 'passthrough',
  source: 'Personalsystemet',
  scan: false,
  areas: [],
  capabilities: [
    {
      name: 'hr.employment',
      kind: 'read',
      title: 'Anställning',
      description: 'Anställningen per person.',
      input: keysInput,
      output: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: { key: { type: 'string' }, title: { type: 'string' } },
              required: ['key'],
            },
          },
        },
        required: ['rows'],
      },
      model: false,
      scope: {},
      about: HANDWRITTEN_EXAMPLES['capabilities[].about'],
      view: { kind: 'list', title: 'title', fields: [{ key: 'title', label: 'Befattning' }] },
    },
    {
      name: 'hr.bookTalk',
      kind: 'propose',
      title: 'Boka samtal',
      description: 'Föreslår en tid för ett samtal.',
      input: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
      output: {},
      model: false,
      scope: { roles: ['manager'] },
      about: {
        entity: HANDWRITTEN_EXAMPLES['capabilities[].about.entity'],
        param: HANDWRITTEN_EXAMPLES['capabilities[].about.param'],
      },
    },
  ],
};

describe('the field list', () => {
  test('covers the whole manifest and every field has a description', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        'protocol',
        'id',
        'kind',
        'source',
        'areas',
        'areas[].id',
        'areas[].schedules[].when',
        'capabilities',
        'capabilities[].name',
        'capabilities[].execution.strategy',
        'capabilities[].execution.lookup',
        'capabilities[].scope.roles',
        'capabilities[].view.kind',
        'capabilities[].view.fields[].tones',
        'capabilities[].view.input.filter.options[].value',
        'capabilities[].view.open.params',
        'capabilities[].view.body',
        'capabilities[].menu.icon',
        'facts[].attributes',
        'delegation.audience',
        'header.capability',
        'uses',
        'scan',
      ]),
    );
    expect(paths.length).toBeGreaterThan(45);
    expect(new Set(paths).size).toBe(paths.length);
    expect(reference.fields.filter(f => !f.description).map(f => f.path)).toEqual([]);
  });
  test('says which union variants a field belongs to, and what is required where', () => {
    const body = reference.fields.find(f => f.path === 'capabilities[].view.body')!;
    expect(body.variants).toEqual(['document', 'metrics', 'activity', 'series', 'text']);
    expect(body.required).toBe(true);
    const rows = reference.fields.find(f => f.path === 'capabilities[].view.rows')!;
    expect(rows.variants).toEqual(['table', 'list']);
    expect(rows.required).toBe(false);
    const kind = reference.fields.find(f => f.path === 'capabilities[].view.kind')!;
    expect(kind.variants).toBeUndefined();
    expect(kind.type).toBe(
      '"document" / "metrics" / "activity" / "series" / "record" / "table" / "list" / "detail" / "text"',
    );
    expect(kind.description).toContain('`detail`:');
    expect(reference.fields.find(f => f.path === 'capabilities[].execution')!.type).toBe(
      'object, one of `strategy`: "manual" / "deduplicated" / "conditional"',
    );
    expect(reference.fields.find(f => f.path === 'capabilities[].execution.retentionSeconds')!.variants).toEqual([
      'deduplicated',
    ]);
  });
  test('types and constraints read as words', () => {
    const byPath = Object.fromEntries(reference.fields.map(f => [f.path, f]));
    expect(byPath['protocol']!.type).toBe('2');
    expect(byPath['capabilities']!.type).toBe('array of object');
    expect(byPath['capabilities[].input']!.type).toBe('object (free keys)');
    expect(byPath['capabilities[].view.fields[].tones']!.type).toBe(
      'map of string to "ok" / "warn" / "alert" / "none"',
    );
    expect(byPath['id']!.constraints).toEqual(['matches `^[a-z][a-z0-9-]*$`', 'at most 40 characters']);
    expect(byPath['uses']!.constraints).toEqual(
      expect.arrayContaining(['at most 100 items', 'no duplicates', expect.stringMatching(/^each matches/)]),
    );
    expect(byPath['capabilities[].view.input.filter.options']!.constraints).toContain('2 to 6 items');
    expect(shapeOf({ type: 'string' })).toBe('string');
  });
  test('examples come from the real manifests first, then the handwritten ones, and stay short', () => {
    const byPath = Object.fromEntries(reference.fields.map(f => [f.path, f]));
    expect(byPath['capabilities[].menu']!.example).toEqual({ label: 'Telefonbok', icon: 'phone' });
    expect(byPath['capabilities[].scope']!.example).toEqual({ roles: ['manager'] });
    expect(byPath['uses']!.example).toEqual(['calendar.today']);
    expect(byPath['delegation']!.example).toEqual({ audience: 'eneo' });
    expect(byPath['capabilities[].view.body']!.example).toBe('markdown');
    expect(byPath['capabilities']!.example).toBeUndefined();
    for (const f of reference.fields)
      if (f.example !== undefined) expect(JSON.stringify(f.example).length).toBeLessThanOrEqual(240);
  });
  test('the handwritten examples load as a manifest', () => {
    const manifest = {
      protocol: 2,
      id: 'hr',
      kind: 'passthrough',
      source: 'Personalsystemet',
      scan: false,
      areas: [],
      delegation: HANDWRITTEN_EXAMPLES['delegation'],
      facts: HANDWRITTEN_EXAMPLES['facts'],
      capabilities: [
        {
          name: 'hr.absenceByOperation',
          kind: 'read',
          title: 'Slå upp',
          description: 'Slår upp en operation.',
          input: { type: 'object', properties: { operationId: { type: 'string' } }, required: ['operationId'] },
          output: {},
          model: false,
          scope: {},
        },
        {
          name: 'hr.registerAbsence',
          kind: 'execute',
          title: 'Registrera',
          description: 'Registrerar.',
          input: {},
          output: {},
          model: false,
          scope: {},
          creates: HANDWRITTEN_EXAMPLES['capabilities[].creates'],
          execution: HANDWRITTEN_EXAMPLES['capabilities[].execution'],
        },
        {
          name: 'hr.onAbsence',
          kind: 'propose',
          title: 'Följ upp',
          description: 'Följer upp.',
          input: {},
          output: {},
          model: false,
          scope: {},
          follows: HANDWRITTEN_EXAMPLES['capabilities[].follows'],
        },
        {
          name: 'hr.note',
          kind: 'read',
          title: 'Anteckning',
          description: 'En text.',
          input: {},
          output: { type: 'object', properties: { markdown: { type: 'string' } } },
          model: true,
          scope: {},
          view: {
            kind: 'text',
            body: HANDWRITTEN_EXAMPLES['capabilities[].view.body'],
            modelReads: HANDWRITTEN_EXAMPLES['capabilities[].view.modelReads'],
          },
        },
        {
          name: 'hr.cases',
          kind: 'read',
          title: 'Ärenden',
          description: 'Ärenden.',
          input: { type: 'object', properties: { state: { type: 'string' } } },
          output: {
            type: 'object',
            properties: {
              rows: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, state: { type: 'string' }, person: { type: 'string' } },
                },
              },
            },
          },
          model: true,
          scope: {},
          view: {
            kind: 'table',
            title: 'name',
            // The person a case is about (D97 item 6): the case's name links to them.
            subject: HANDWRITTEN_EXAMPLES['capabilities[].view.subject'],
            fields: [
              { key: 'name', label: 'Namn' },
              {
                key: 'state',
                label: 'Status',
                format: HANDWRITTEN_EXAMPLES['capabilities[].view.fields[].format'],
                tones: HANDWRITTEN_EXAMPLES['capabilities[].view.fields[].tones'],
              },
            ],
            input: { filter: HANDWRITTEN_EXAMPLES['capabilities[].view.input.filter'] },
            empty: HANDWRITTEN_EXAMPLES['capabilities[].view.empty'],
          },
        },
      ],
    };
    expect(manifestProblems(manifest, 'hr')).toEqual([]);
    expect(() => new Registry().register(remoteConnector(parseManifest(manifest, 'hr'), transport))).not.toThrow();
    // The examples of `about` (D97): a read asked with keys and an action that takes one.
    expect(manifestProblems(aboutManifest, 'hr')).toEqual([]);
    expect(() => new Registry().register(remoteConnector(parseManifest(aboutManifest, 'hr'), transport))).not.toThrow();
    const byPath = Object.fromEntries(reference.fields.map(f => [f.path, f]));
    expect(byPath['capabilities[].about']!.example).toEqual({ entity: 'person' });
    expect(byPath['capabilities[].about.entity']!.type).toBe('"person" / "unit"');
    expect(byPath['capabilities[].about.param']!.rules.map(r => r.id)).toEqual([
      'about-read-keys',
      'about-action-param',
      'about-action-key-alone',
      'about-action-start',
    ]);
  });
  test('the job recipe is a working exchange: three manifests that load, an envelope and answers that validate, steps that name their own connector', () => {
    const example = reference.recipes.find(r => r.id === 'job-follower')!.example as {
      manifests: Record<string, any>;
      exchange: Record<string, any>;
    };
    const loaded: Record<string, ReturnType<typeof parseManifest>> = {};
    for (const [id, fragment] of Object.entries(example.manifests)) {
      const manifest = { protocol: 2, kind: 'passthrough', source: 'System', scan: false, areas: [], ...fragment };
      expect({ id, problems: manifestProblems(manifest, id) }).toEqual({ id, problems: [] });
      loaded[id] = parseManifest(manifest, id);
      expect(() => new Registry().register(remoteConnector(loaded[id]!, transport))).not.toThrow();
    }
    const [envelope, tid, lon] = Object.values(example.exchange);
    const validate = (schema: object) => ajv.compile(JSON.parse(JSON.stringify(schema)));
    expect(validate(FactEnvelopeSchema)(envelope)).toBe(true);
    expect(validate(FollowResponseSchema)(tid)).toBe(true);
    expect(validate(FollowResponseSchema)(lon)).toBe(true);
    // The fact's attributes are what hr declares; each step names a capability of the answering connector and its payload or input fits that capability.
    expect(validate(loaded['hr']!.facts![0]!.attributes)(envelope.fact.attributes)).toBe(true);
    for (const [id, answer] of [
      ['tid', tid],
      ['lon', lon],
    ] as const)
      for (const step of answer.steps) {
        const capability = loaded[id]!.capabilities.find(c => c.name === step.operation)!;
        expect({ id, step: step.operation, kind: capability.kind }).toEqual({
          id,
          step: step.operation,
          kind: step.kind === 'execute' ? 'execute' : 'read',
        });
        expect(validate(capability.input)(step.kind === 'execute' ? step.payload : step.input)).toBe(true);
      }
    expect((reference.recipes.find(r => r.id === 'menu-tool')!.example as { name: string }).name).toBe(
      'phonebook.directory',
    );
    expect((reference.recipes.find(r => r.id === 'scan-cards')!.example as { scan: boolean }).scan).toBe(true);
  });
});

describe('the rules', () => {
  test('name only fields that exist, and every field with a rule lists it', () => {
    for (const rule of RULES) for (const field of rule.fields) expect(paths).toContain(field);
    for (const field of reference.fields) expect(field.rules).toEqual(RULES.filter(r => r.fields.includes(field.path)));
  });
  /** Break each loader rule once and read the loader's problem: the prose stays as true as the code. */
  const probes: Record<string, [unknown, string | undefined]> = {
    'protocol-accepted': [
      broken(hello, m => {
        m.protocol = 1;
      }),
      'hello',
    ],
    'id-matches': [hello, 'other'],
    'name-prefixed': [
      broken(hello, m => {
        m.capabilities[2].name = 'other.thing';
      }),
      'hello',
    ],
    'execute-never-a-tool': [
      broken(hello, m => {
        m.capabilities.find((c: any) => c.kind === 'execute').model = true;
      }),
      'hello',
    ],
    'view-on-a-read': [
      broken(phonebook, m => {
        m.capabilities[0].kind = 'propose';
      }),
      'phonebook',
    ],
    'view-keys-in-output': [
      broken(phonebook, m => {
        m.capabilities[0].view.fields[0].key = 'nowhere';
      }),
      'phonebook',
    ],
    'view-input-in-input': [
      broken(phonebook, m => {
        m.capabilities[0].view.input.query.key = 'nowhere';
      }),
      'phonebook',
    ],
    'row-opens-own-read': [
      broken(phonebook, m => {
        m.capabilities[0].view.open.capability = 'hello.greeting';
      }),
      'phonebook',
    ],
    'view-subject-is-a-string': [
      broken(phonebook, m => {
        m.capabilities[0].view.subject = { entity: 'person', key: 'nowhere' };
      }),
      'phonebook',
    ],
    'menu-needs-open-view': [
      broken(phonebook, m => {
        m.capabilities[0].input = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };
      }),
      'phonebook',
    ],
    'follows-on-a-propose': [
      broken(hello, m => {
        m.capabilities[0].follows = ['hr:absence'];
      }),
      'hello',
    ],
    'creates-declared': [
      broken(hello, m => {
        m.capabilities[3].creates = 'hello:done';
      }),
      'hello',
    ],
    'standing-exists': [
      broken(hello, m => {
        m.areas[0].standing.push('hello.nothing');
      }),
      'hello',
    ],
    'about-read-keys': [
      broken(aboutManifest, m => {
        m.capabilities[0].input.properties.keys.maxItems = 500;
      }),
      'hr',
    ],
    'about-read-rows': [
      broken(aboutManifest, m => {
        m.capabilities[0].output.properties.rows.items.required = [];
      }),
      'hr',
    ],
    'about-never-a-tool': [
      broken(aboutManifest, m => {
        m.capabilities[0].model = true;
      }),
      'hr',
    ],
    'about-action-param': [
      broken(aboutManifest, m => {
        m.capabilities[1].about.param = 'nobody';
      }),
      'hr',
    ],
    'about-action-key-alone': [
      broken(aboutManifest, m => {
        m.capabilities[1].input.properties.when = { type: 'string' };
        m.capabilities[1].input.required.push('when');
      }),
      'hr',
    ],
    'about-not-a-follower': [
      broken(aboutManifest, m => {
        m.capabilities[1].follows = ['hr:absence'];
      }),
      'hr',
    ],
    'about-not-a-profile': [
      broken(aboutManifest, m => {
        m.capabilities[0].name = 'hr.search';
      }),
      'hr',
    ],
  };
  test('every loader rule has a probe and the loader refuses it', () => {
    expect(Object.keys(probes).sort()).toEqual(
      RULES.filter(r => r.enforced === 'loader')
        .map(r => r.id)
        .sort(),
    );
    for (const [id, [document, expected]] of Object.entries(probes))
      expect({ id, problems: manifestProblems(document, expected) }).toEqual({
        id,
        problems: expect.arrayContaining([expect.any(String)]),
      });
    for (const m of examples) expect(manifestProblems(m, m.id)).toEqual([]);
  });
});

describe('the TypeBox tab', () => {
  /** Run the generated module with the real TypeBox and read the JSON Schema it emits. */
  const evaluate = (source: string): Record<string, unknown> => {
    const names = [...source.matchAll(/^export const (\w+) =/gm)].map(m => m[1]!);
    const body =
      source.replace(/^import .*$/m, '').replace(/^export const /gm, 'const ') + `\nreturn { ${names.join(', ')} };`;
    return JSON.parse(JSON.stringify(new Function('Type', body)(TypeBoxType)));
  };
  /** TypeBox writes a string enum as a union of literals; the two say the same thing to a validator, so the comparison reads them alike. */
  const alike = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(alike)
      : value && typeof value === 'object'
        ? 'enum' in value && Array.isArray((value as { enum: unknown[] }).enum)
          ? { anyOf: (value as { enum: unknown[] }).enum.map(v => ({ const: v, type: typeof v })) }
          : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, alike(v)]))
        : value;
  test('is generated from the JSON and emits the same JSON Schema back', () => {
    const job = reference.recipes.find(r => r.id === 'job-follower')!;
    expect(job.typebox).toContain("import { Type } from '@sinclair/typebox';");
    expect(evaluate(job.typebox!)).toEqual((job.example as { manifests: Record<string, unknown> }).manifests);
    const tool = reference.recipes.find(r => r.id === 'menu-tool')!;
    expect(alike(evaluate(tool.typebox!))).toEqual(alike({ directory: tool.example }));
    // A view's `input` is controls, not a schema, and stays a literal.
    expect(tool.typebox).toContain('filter: {');
    expect(reference.recipes.find(r => r.id === 'scan-cards')!.typebox).toBeUndefined();
  });
  test('prints the subset the examples use', () => {
    expect(typeboxOf({ type: 'string', format: 'date' })).toBe("Type.String({ format: 'date' })");
    expect(
      typeboxOf({
        type: 'object',
        properties: { a: { type: 'integer', minimum: 1 }, b: { type: 'boolean' } },
        required: ['a'],
        additionalProperties: false,
      }),
    ).toBe(
      'Type.Object({\n  a: Type.Integer({ minimum: 1 }),\n  b: Type.Optional(Type.Boolean()),\n}, { additionalProperties: false })',
    );
    expect(typeboxOf({})).toBe('Type.Unknown()');
    expect(typeboxOf({ type: 'array', items: { enum: ['x', 'y'] }, uniqueItems: true })).toBe(
      "Type.Array(Type.Union([Type.Literal('x'), Type.Literal('y')]), { uniqueItems: true })",
    );
  });
});

describe('the renderings', () => {
  const markdown = referenceMarkdown(reference, {
    decisionLink: d => (d === 'D40' ? '../decisions/D40.md' : undefined),
  });
  test('the sections cover every field once, in order, and carry element ids', () => {
    // The document's own scalars are gathered first, so the sections' order is the page's, not the schema's; every field is in exactly one.
    expect(reference.sections.flatMap(s => s.paths).sort()).toEqual([...paths].sort());
    expect(reference.sections.map(s => s.title)).toEqual([
      'The document',
      'areas[]',
      'capabilities[]',
      'capabilities[].view',
      'facts[]',
      'delegation',
      'header',
    ]);
    for (const f of reference.fields) expect(f.id).toBe(anchorOf(f.path));
    expect(anchorOf('capabilities[].view.fields[].key')).toBe('field-capabilities-view-fields-key');
  });
  test('markdown has a heading per field, the recipes, every rule, and links the decisions it can', () => {
    for (const f of reference.fields) expect(markdown).toContain(`#### \`${f.path}\``);
    for (const r of reference.recipes) expect(markdown).toContain(`### ${r.title}`);
    for (const r of RULES) expect(markdown).toContain(`**${r.title}**`);
    expect(markdown).toContain('([D40](../decisions/D40.md))');
    expect(markdown).toContain('(D38)');
    expect(markdown).toContain('```ts\nimport { Type } from');
  });
  test('the instance serves it as data beside the OpenAPI page, and sends the old address to the page', async () => {
    const data = await protocolRoutes.request('http://clew.local/manifest-reference.json');
    expect(data.status).toBe(200);
    expect(data.headers.get('access-control-allow-origin')).toBe('*');
    const body = await data.json();
    expect(body.fields.map((f: { path: string }) => f.path)).toEqual(paths);
    expect(body.sections.length).toBe(7);
    const redirect = await protocolRoutes.request('http://clew.local/manifest-reference', { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/protocol/manifest');
    const openapi = await (await protocolRoutes.request('http://clew.local/openapi.json')).json();
    expect(openapi.paths['/api/protocol/manifest-reference.json'].get.operationId).toBe('getManifestReference');
  });
});
