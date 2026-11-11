import { describe, expect, test } from 'bun:test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  ConnectorPatchInput,
  ModelPatchInput,
  ProviderPatchInput,
  SiteHeaderOutputSchema,
  SnoozeInput,
  WeekEventsSchema,
  WeekViewSchema,
  checkContract,
  contractProblems,
  literals,
} from '../../packages/contracts/src/index';
import { ConnectorManifestSchema } from '../../packages/connectors/src/protocol';
import { manifest as hello } from '../../connectors/hello/connector.mjs';
import { manifest as phonebook } from '../../connectors/phonebook/connector.mjs';

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
