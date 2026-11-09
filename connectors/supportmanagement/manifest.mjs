// Clew reads this contract to discover the errands a person has in SupportManagement and to draw them (D35, D89).
// The rows are the errand model every case system answers with: a ref, a non-personal label, a shared state and the
// system's own status. Free text is in the errand view only, read live and never offered to the model.

export const CONNECTOR = 'sm';
export const DEFAULT_AUDIENCE = 'supportmanagement';
export const DEFAULT_SOURCE = 'Ärendesystemet';

/** `errand:sm:<municipalityId>:<namespace>:<id>` (D35). Clew treats it as opaque. */
export const errandRefParts = {
  municipalityId: '[0-9]{1,8}',
  namespace: '[A-Za-z0-9_.-]{1,60}',
  id: '[A-Za-z0-9-]{1,80}',
};
export const errandRefPattern = `^errand:sm:${errandRefParts.municipalityId}:${errandRefParts.namespace}:${errandRefParts.id}$`;

/** The shared state (D89): what lets lists from several case systems be ordered together. */
export const STATES = ['new', 'active', 'waiting-on-me', 'waiting-on-others', 'closed'];

const string = { type: 'string' };

const errandRowSchema = {
  type: 'object',
  properties: {
    ref: { type: 'string', pattern: errandRefPattern },
    label: string,
    state: { type: 'string', enum: STATES },
    status: string,
    waitingOn: string,
    since: string,
    dueAt: string,
    area: string,
    link: string,
  },
  required: ['ref', 'label', 'state', 'status', 'since', 'area'],
};

const errandViewSchema = {
  type: 'object',
  properties: {
    ...errandRowSchema.properties,
    title: string,
    description: string,
  },
  required: errandRowSchema.required,
};

const openErrand = { capability: 'sm.errand', title: 'Ärende', params: { ref: 'ref' } };

// Only the person the errand waits on is given a tone; every other value stays neutral.
const waitingOnField = { key: 'waitingOn', label: 'Väntar på', format: 'status', tones: { Dig: 'warn' } };

// The list: what is assigned to the person or their group, or what the person reported (D35's two views). The name
// is the errand profile's: Clew lists every connector's `<id>.errands` together as `clew.errands`, and that list is
// the one a person sees, so this read has no menu row and no button of its own.
const errandsCapability = {
  name: 'sm.errands',
  kind: 'read',
  title: 'Ärenden i ärendesystemet',
  model: true,
  scope: {},
  description:
    'Personens öppna ärenden i ärendesystemet: tilldelade personen eller gruppen, eller anmälda av personen. Ärendenummer, typ, status och område; aldrig rubrik, beskrivning eller parter.',
  input: {
    type: 'object',
    properties: { view: { type: 'string', enum: ['assigned', 'reported'] } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { rows: { type: 'array', items: errandRowSchema } },
    required: ['rows'],
  },
  view: {
    kind: 'list',
    title: 'label',
    ref: 'ref',
    open: openErrand,
    modelReads: 'summary',
    noun: { one: 'ärende', other: 'ärenden' },
    empty: 'Du har inga öppna ärenden här.',
    fields: [
      { key: 'label', label: 'Ärende' },
      { key: 'status', label: 'Status' },
      waitingOnField,
      { key: 'area', label: 'Område' },
      { key: 'since', label: 'Senast ändrat', format: 'date' },
    ],
    input: {
      filter: {
        key: 'view',
        label: 'Visa',
        options: [
          { value: 'assigned', label: 'Tilldelade mig eller min grupp' },
          { value: 'reported', label: 'Anmälda av mig' },
        ],
      },
    },
  },
};

// One errand with its free text, read live for the panel. Never a tool: the text may name a citizen.
const errandCapability = {
  name: 'sm.errand',
  kind: 'read',
  title: 'Ärende',
  model: false,
  scope: {},
  description: 'Ett ärende med rubrik och beskrivning, läst direkt från ärendesystemet för personen som öppnar det.',
  input: {
    type: 'object',
    properties: { ref: { type: 'string', pattern: errandRefPattern } },
    required: ['ref'],
    additionalProperties: false,
  },
  output: errandViewSchema,
  view: {
    kind: 'detail',
    title: 'label',
    fields: [
      { key: 'status', label: 'Status' },
      waitingOnField,
      { key: 'area', label: 'Område' },
      { key: 'since', label: 'Senast ändrat', format: 'date' },
      { key: 'title', label: 'Rubrik' },
      { key: 'description', label: 'Beskrivning' },
      { key: 'link', label: 'Öppna i ärendesystemet', format: 'link' },
    ],
  },
};

/**
 * `audience` is what the person's token is issued for: the identity provider and SupportManagement's gateway agree on
 * it, so it is configuration, not a constant. `source` is the system's name as a person reads it.
 */
export function createManifest({ audience = DEFAULT_AUDIENCE, source = DEFAULT_SOURCE } = {}) {
  return {
    protocol: 2,
    id: CONNECTOR,
    kind: 'passthrough',
    source,
    // No area: "Ärenden" and its button belong to Clew's combined list, whatever the number of case systems.
    areas: [],
    capabilities: [errandsCapability, errandCapability],
    // No scan yet: a scan has no session, so it has no token to act as the person with (D89).
    scan: false,
    delegation: { audience },
  };
}

export const manifest = createManifest();
