import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ConnectorPatchInput,
  GroupCapabilityInput,
  ModelPatchInput,
  PROVISIONED_KEY_LENGTH,
  PreviewQuery,
  ProviderPatchInput,
  UsersAdminQuery,
  SiteHeaderOutputSchema,
  SnoozeInput,
  WeekEventsSchema,
  WeekViewSchema,
  checkContract,
  contractProblems,
  literals,
} from '../../packages/contracts/src/index';
import { ConnectorManifestSchema, ExecuteResultSchema, FigureSchema } from '../../packages/connectors/src/protocol';
import { isKey } from '../../apps/server/src/modules/entities/domain';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { scimUsecases } from '../../apps/server/src/modules/people/usecases';
import { manifest as hello } from '../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../connectors/phonebook/connector.mjs';

/** A list with a least and a most length, and an item with a typed field: what the length and type wordings are read from. */
const BoundedListSchema = {
  type: 'object',
  required: ['schemas', 'Operations'],
  properties: {
    schemas: { type: 'array', items: { type: 'string' } },
    Operations: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: { type: 'object', required: ['op'], properties: { op: { type: 'string' } } },
    },
  },
} as never;

/**
 * What a value's problems are called is Clew's, not the validation library's: these words and paths reach an
 * administrator, a connector author and a provisioner (the manifest dry run, the conformance check, a SCIM `detail`).
 */
const edited = (document: unknown, change: (m: any) => void) => {
  const copy = JSON.parse(JSON.stringify(document));
  change(copy);
  return copy;
};
const lines = (schema: Parameters<typeof contractProblems>[0], value: unknown) =>
  contractProblems(schema, value).map(p => `${p.path}: ${p.message}`);

describe('the problems of a value that fails a contract', () => {
  test('a value that passes has none', () => {
    expect(contractProblems(ConnectorManifestSchema, hello)).toEqual([]);
    expect(contractProblems(ConnectorManifestSchema, phonebook)).toEqual([]);
  });
  test('a missing property is named at its own path, once', () => {
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void delete m.source),
      ),
    ).toEqual(['/source: Expected required property']);
    expect(lines(ConnectorManifestSchema, {})).toEqual(
      ['protocol', 'id', 'kind', 'source', 'areas', 'capabilities', 'scan'].map(
        key => `/${key}: Expected required property`,
      ),
    );
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void delete m.capabilities[0].name),
      ),
    ).toEqual(['/capabilities/0/name: Expected required property']);
  });
  test('an unexpected property is named at its own path', () => {
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.colour = 'red')),
      ),
    ).toEqual(['/colour: Unexpected property']);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.capabilities[0]['a/b'] = 1)),
      ),
    ).toEqual(['/capabilities/0/a~1b: Unexpected property']);
  });
  test('a value that fits no branch of a union is one problem at the union', () => {
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.capabilities[0].kind = 'write')),
      ),
    ).toEqual(['/capabilities/0/kind: Expected union value']);
    // A union of objects: whichever branch the library tried, the problem is the view, not that branch's fields.
    expect(
      lines(
        ConnectorManifestSchema,
        edited(phonebook, m => void (m.capabilities[0].view.kind = 'hologram')),
      ),
    ).toEqual(['/capabilities/0/view: Expected union value']);
  });
  test('the type, the literal and the limits are said as they always were', () => {
    expect(lines(ConnectorManifestSchema, 'hello')).toEqual([': Expected object']);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.id = 7)),
      ),
    ).toEqual(['/id: Expected string']);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.protocol = '2')),
      ),
    ).toEqual(['/protocol: Expected 2']);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.id = 'x'.repeat(200))),
      ),
    ).toEqual(['/id: Expected string length less or equal to 40']);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.id = 'Hello World')),
      ),
    ).toEqual(["/id: Expected string to match '^[a-z][a-z0-9-]*$'"]);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.areas = 'hr')),
      ),
    ).toEqual(['/areas: Expected array']);
    expect(
      lines(
        ConnectorManifestSchema,
        edited(hello, m => void (m.scan = 'yes')),
      ),
    ).toEqual(['/scan: Expected boolean']);
  });
  test('a list, a number and a format are said as they always were', () => {
    const roles = (value: unknown) => edited(hello, m => void (m.capabilities[0].scope.roles = value));
    expect(lines(ConnectorManifestSchema, roles(['manager', 'manager']))).toEqual([
      '/capabilities/0/scope/roles: Expected array elements to be unique',
    ]);
    expect(lines(BoundedListSchema, { schemas: ['x'], Operations: [] })).toEqual([
      '/Operations: Expected array length to be greater or equal to 1',
    ]);
    const operations = Array.from({ length: 501 }, () => ({ op: 'add' }));
    expect(lines(BoundedListSchema, { schemas: ['x'], Operations: operations })).toEqual([
      '/Operations: Expected array length to be less or equal to 500',
    ]);
    const result = (undoMinutes: number) => ({ headline: 'Klart', rows: [], undoMinutes });
    expect(lines(ExecuteResultSchema, result(0))).toEqual([
      '/undoMinutes: Expected integer to be greater or equal to 1',
    ]);
    expect(lines(ExecuteResultSchema, result(1441))).toEqual([
      '/undoMinutes: Expected integer to be less or equal to 1440',
    ]);
    expect(lines(ExecuteResultSchema, result(1.5))).toEqual(['/undoMinutes: Expected integer']);
    expect(lines(FigureSchema, { label: 'x', value: 'y', tone: 'none', progress: { value: -1, max: 0 } })).toEqual([
      '/progress/value: Expected number to be greater or equal to 0',
      '/progress/max: Expected number to be greater than 0',
    ]);
    expect(lines(SnoozeInput, { until: 'tomorrow' })).toEqual(["/until: Expected string to match 'date-time' format"]);
    expect(lines(SnoozeInput, { preset: '' })).toEqual(['/preset: Expected string length greater or equal to 1']);
  });
  test('every problem is listed, however many there are (D60)', () => {
    // The library stops at eight errors by default, and one failed union of many literals is more than that.
    const many = edited(phonebook, m => {
      m.capabilities[0].view.fields[0].format = 'hologram';
      for (let i = 0; i < 20; i++) m['extra' + i] = i;
      delete m.source;
    });
    const problems = lines(ConnectorManifestSchema, many);
    expect(problems).toHaveLength(22);
    expect(problems).toContain('/source: Expected required property');
    expect(problems).toContain('/extra19: Unexpected property');
    expect(problems).toContain('/capabilities/0/view: Expected union value');
  });
  test('a caller that names only the first problems gets the same ones, without the rest being looked for', () => {
    const values = [
      edited(hello, m => {
        for (let i = 0; i < 20; i++) m['extra' + i] = i;
        delete m.source;
        m.protocol = '2';
      }),
      // Twenty errors of the library that are no problem by themselves come before the one that names the properties.
      edited(hello, m => {
        for (let i = 0; i < 20; i++) m['extra' + i] = i;
      }),
      // The type error is followed by the literal's, which replaces it.
      edited(hello, m => void (m.protocol = '2')),
      edited(phonebook, m => void (m.capabilities[0].view.fields[0].format = 'hologram')),
      {},
      null,
    ];
    for (const value of values) {
      const all = lines(ConnectorManifestSchema, value);
      for (const limit of [1, 2, 3, 9])
        expect(contractProblems(ConnectorManifestSchema, value, limit).map(p => `${p.path}: ${p.message}`)).toEqual(
          all.slice(0, limit),
        );
    }
    expect(contractProblems(ConnectorManifestSchema, hello, 1)).toEqual([]);
    // The limit is the call's own: the next caller is still told everything.
    expect(lines(ConnectorManifestSchema, values[0])).toHaveLength(22);
    const large = { schemas: ['x'], Operations: Array.from({ length: 20_000 }, () => ({ op: 1 })) };
    expect(contractProblems(BoundedListSchema, large, 1)).toEqual([
      { path: '/Operations/0/op', message: 'Expected string' },
    ]);
  });
  test('the first problem of a header answer is the one the refusal names', () => {
    expect(lines(SiteHeaderOutputSchema, { site: { name: 'x' }, items: [] })[0]).toBe(
      '/site/href: Expected required property',
    );
    expect(lines(SiteHeaderOutputSchema, null)[0]).toBe(': Expected object');
  });
});

describe('what the schemas say after they are built', () => {
  const ajv = addFormats(new Ajv({ allErrors: false }));
  test('a body derived with Partial or Omit is still closed: an unknown property is refused', () => {
    for (const [name, schema] of Object.entries({
      SnoozeInput,
      ConnectorPatchInput,
      ProviderPatchInput,
      ModelPatchInput,
      WeekEventsSchema,
    })) {
      expect({ name, closed: (schema as { additionalProperties?: unknown }).additionalProperties }).toEqual({
        name,
        closed: false,
      });
    }
    expect(ajv.compile(SnoozeInput)({ preset: 'tomorrow', surprise: 1 })).toBe(false);
    expect(ajv.compile(SnoozeInput)({ preset: 'tomorrow' })).toBe(true);
    expect(checkContract(ProviderPatchInput, { title: 'Lokal modell', surprise: 1 })).toBe(false);
    expect(Object.keys((WeekEventsSchema as { properties: object }).properties)).toEqual(
      Object.keys((WeekViewSchema as { properties: object }).properties).filter(key => key !== 'proposals'),
    );
  });
  test('an instant is checked by Clew’s own `date-time`, not the library’s', () => {
    const at = (until: string) => checkContract(SnoozeInput, { until });
    expect(at('2026-11-09T06:00:00Z')).toBe(true);
    expect(at('2026-11-09T06:00Z')).toBe(true);
    expect(at('2026-11-09T06:00:00+01:00')).toBe(true);
    expect(at('2026-11-09t06:00:00z')).toBe(false);
    expect(at('2026-11-09T06:00:00Z[Europe/Stockholm]')).toBe(false);
    expect(at('2026-11-09T06:00:00')).toBe(false);
    expect(at('2026-11-09')).toBe(false);
  });
  test('a string’s length is counted in Unicode code points, by the schema, by Ajv and by the code beside them', () => {
    // 0.34 counted UTF-16 units, so forty of these, eighty units, did not fit in forty characters.
    const fits = '😀'.repeat(40),
      long = '😀'.repeat(41);
    expect(checkContract(SnoozeInput, { preset: fits })).toBe(true);
    expect(checkContract(SnoozeInput, { preset: long })).toBe(false);
    expect(ajv.compile(SnoozeInput)({ preset: fits })).toBe(true);
    expect(ajv.compile(SnoozeInput)({ preset: long })).toBe(false);
    expect(isKey('😀'.repeat(256))).toBe(true);
    expect(isKey('😀'.repeat(257))).toBe(false);
    expect(isKey('')).toBe(false);
  });
  test('a key SCIM stores fits wherever an administrator names it, an audience of a connector or a model among them, and a longer one fits nowhere (A6)', async () => {
    // A group key in distinguished-name form runs past the 80 characters an audience once took.
    const key = 'CN=' + 'x'.repeat(PROVISIONED_KEY_LENGTH - 3),
      longer = key + 'x';
    expect(PROVISIONED_KEY_LENGTH).toBe(512);
    const scim = scimUsecases({
        store: memoryProvisionStore(),
        clock: () => new Date('2026-11-12T06:00:00Z'),
        ids: () => randomUUID(),
        digest: token => token,
      }),
      p = { id: 'mk', organisationId: 'org', label: 'Metakatalogen' };
    expect(
      (await scim.createGroup(p, { externalId: key, displayName: 'Lång' }, 'https://clew.test/scim/v2')).externalId,
    ).toBe(key);
    await expect(
      scim.createGroup(p, { externalId: longer, displayName: 'Längre' }, 'https://clew.test/scim/v2'),
    ).rejects.toMatchObject({
      status: 400,
      scimType: 'invalidValue',
      detail: "Attribute 'externalId' needs a non-empty string of at most 512 characters.",
    });
    const audience = (k: string) => ({ mode: 'selected', units: [k], groups: [k] });
    const named: Array<[string, Parameters<typeof ajv.compile>[0], (k: string) => unknown]> = [
      ['a connector audience', ConnectorPatchInput, k => ({ audience: audience(k) })],
      ['a model audience', ModelPatchInput, k => ({ audience: audience(k) })],
      ['a group-capability row', GroupCapabilityInput, k => ({ groupExternalId: k, capability: 'admin.users' })],
      ["the people list's unit", UsersAdminQuery, k => ({ unitId: k })],
      ["a preview's unit", PreviewQuery, k => ({ role: 'employee', unitId: k })],
    ];
    for (const [what, schema, value] of named) {
      const valid = ajv.compile(schema);
      expect({ what, key: valid(value(key)), longer: valid(value(longer)) }).toEqual({
        what,
        key: true,
        longer: false,
      });
    }
  });
  test('a union of literals from a list is one branch per value, in the list’s order', () => {
    expect(JSON.parse(JSON.stringify(literals(['a', 'b', 3], { description: 'x' })))).toEqual({
      anyOf: [
        { type: 'string', const: 'a' },
        { type: 'string', const: 'b' },
        { type: 'number', const: 3 },
      ],
      description: 'x',
    });
  });
});
