/**
 * The manifest of artboard I (D97): a talks system that says its rows are about a person. One read asked with a batch
 * of keys, drawn as a list whose state warns when the talk is missing and whose rows open the action points; one
 * propose that takes the person. The preview spec pastes it, and the variant artboard J draws: the row without `key`.
 */
const keys = {
  type: 'object',
  properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
  required: ['keys'],
};
export const appraisals = {
  protocol: 2,
  id: 'appraisals',
  kind: 'passthrough',
  source: 'Samtalssystemet',
  scan: false,
  areas: [],
  capabilities: [
    {
      name: 'appraisals.person',
      kind: 'read',
      title: 'Utvecklingssamtal',
      description: 'Utvecklingssamtalet per person.',
      about: { entity: 'person' },
      input: keys,
      output: {
        type: 'object',
        properties: {
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                state: { type: 'string' },
                at: { type: 'string' },
                overdue: { type: 'integer' },
              },
              required: ['key'],
            },
          },
        },
      },
      model: false,
      scope: {},
      view: {
        kind: 'list',
        title: 'state',
        fields: [
          { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn', Bokat: 'none' } },
          { key: 'at', label: 'När', format: 'instant' },
          { key: 'overdue', label: 'Försenade', format: 'number' },
        ],
        open: { capability: 'appraisals.commitments', title: 'Åtgärdspunkter', params: { person: 'key' } },
      },
    },
    {
      name: 'appraisals.commitments',
      kind: 'read',
      title: 'Åtgärdspunkter',
      description: 'Åtgärdspunkterna för en person.',
      input: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
      output: {
        type: 'object',
        properties: { rows: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } } } } },
      },
      model: false,
      scope: {},
      view: { kind: 'table', title: 'text', fields: [{ key: 'text', label: 'Punkt' }] },
    },
    {
      name: 'appraisals.book',
      kind: 'propose',
      title: 'Boka samtal',
      description: 'Föreslår en tid för utvecklingssamtalet.',
      about: { entity: 'person', param: 'person' },
      input: {
        type: 'object',
        properties: { person: { type: 'string' }, at: { type: 'string' } },
        required: ['person'],
      },
      output: {},
      model: false,
      scope: { roles: ['manager'] },
    },
  ],
};
/** Artboard J's problem: the rows no longer require the key they were asked with. */
export const appraisalsWithoutKey = JSON.parse(JSON.stringify(appraisals));
appraisalsWithoutKey.capabilities[0].output.properties.rows.items.required = [];
