// Clew reads this contract to discover the phone book's operations and draw their views.
// Each capability keeps its input, output and view together. No HTML or frontend code is sent.

// Shared data contracts: only work contact details can cross this boundary.
export const personRefPattern = '^person:[A-Za-z0-9_.@-]{1,80}$';

const string = { type: 'string' };

const personSchema = {
  type: 'object',
  properties: {
    ref: string,
    name: string,
    title: string,
    unit: string,
    phone: string,
    mobile: string,
    email: string,
  },
  required: ['ref', 'name', 'title', 'unit'],
};

const contactCardSchema = {
  type: 'object',
  properties: {
    ...personSchema.properties,
    room: string,
    manager: string,
    link: string,
  },
  required: ['ref', 'name', 'title', 'unit'],
};

const searchHitSchema = {
  type: 'object',
  properties: {
    ref: string,
    kind: string,
    label: string,
    snippet: string,
    link: string,
    source: string,
  },
  required: ['ref', 'kind', 'label', 'snippet', 'source'],
};

const personRefInput = {
  type: 'object',
  properties: {
    ref: { type: 'string', pattern: personRefPattern },
  },
  required: ['ref'],
  additionalProperties: false,
};

// Shared presentation: every person row opens the same contact card.
const openContactCard = {
  capability: 'phonebook.person',
  title: 'Kontaktkort',
  params: { ref: 'ref' },
};

const contactFields = [
  { key: 'phone', label: 'Telefon', format: 'phone' },
  { key: 'mobile', label: 'Mobil', format: 'phone' },
  { key: 'email', label: 'E-post', format: 'email' },
];

// Directory: choose the table, its columns and its search controls here.
const directoryCapability = {
  name: 'phonebook.directory',
  kind: 'read',
  title: 'Sök i telefonboken',
  model: true,
  scope: {},
  menu: { label: 'Telefonbok', icon: 'phone' },
  description:
    'Söker kollegor i hela organisationen eller på den egna enheten, på namn, titel eller enhet. Träffarna visas för personen som en tabell med telefon och e-post.',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', maxLength: 80 },
      scope: { type: 'string', enum: ['all', 'unit'] },
    },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      rows: { type: 'array', items: personSchema },
    },
    required: ['rows'],
  },
  view: {
    kind: 'table',
    title: 'name',
    ref: 'ref',
    open: openContactCard,
    modelReads: 'summary',
    empty: 'Inga träffar i telefonboken.',
    fields: [
      { key: 'name', label: 'Namn' },
      { key: 'title', label: 'Titel' },
      { key: 'unit', label: 'Enhet' },
      ...contactFields,
    ],
    input: {
      query: {
        key: 'query',
        label: 'Sök i telefonboken',
        placeholder: 'Namn, titel eller enhet',
      },
      filter: {
        key: 'scope',
        label: 'Sök i',
        options: [
          { value: 'all', label: 'Hela organisationen' },
          { value: 'unit', label: 'Min enhet' },
        ],
      },
    },
  },
};

// Team: a list scoped to the verified actor's unit, with no input to fill in.
const teamCapability = {
  name: 'phonebook.team',
  kind: 'read',
  title: 'Mitt teams kontaktlista',
  model: true,
  scope: {},
  menu: { label: 'Mitt team', icon: 'people' },
  description: 'Kontaktuppgifter till alla på den inloggades enhet. Listan visas för personen i en vy.',
  input: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      unit: string,
      rows: { type: 'array', items: personSchema },
    },
    required: ['unit', 'rows'],
  },
  view: {
    kind: 'list',
    title: 'name',
    ref: 'ref',
    open: openContactCard,
    modelReads: 'summary',
    empty: 'Telefonboken har ingen på din enhet.',
    fields: [{ key: 'name', label: 'Namn' }, { key: 'title', label: 'Titel' }, ...contactFields],
  },
};

// Contact card: the details opened from a directory row, team row or search hit.
const personCapability = {
  name: 'phonebook.person',
  kind: 'read',
  title: 'Kontaktkort',
  model: false,
  scope: {},
  description: 'Arbetsrelaterade kontaktuppgifter för en kollega: telefon, e-post, rum, enhet och chef.',
  input: personRefInput,
  output: contactCardSchema,
  view: {
    kind: 'detail',
    title: 'name',
    modelReads: 'summary',
    fields: [
      { key: 'title', label: 'Titel' },
      { key: 'unit', label: 'Enhet' },
      ...contactFields,
      { key: 'room', label: 'Rum' },
      { key: 'manager', label: 'Chef' },
      { key: 'link', label: 'Öppna i telefonboken', format: 'link' },
    ],
  },
};

// Composite search: hits expose name and context, while numbers stay in the contact card.
const searchCapability = {
  name: 'phonebook.search',
  kind: 'read',
  title: 'Sök person',
  model: true,
  scope: {},
  kinds: ['person'],
  description: 'Hittar kollegor på namn, titel eller enhet.',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      rows: { type: 'array', items: searchHitSchema },
    },
    required: ['rows'],
  },
  view: {
    kind: 'list',
    title: 'label',
    ref: 'ref',
    open: openContactCard,
    fields: [
      { key: 'label', label: 'Namn' },
      { key: 'snippet', label: 'Titel och enhet' },
    ],
  },
};

const fetchCapability = {
  name: 'phonebook.fetch',
  kind: 'read',
  title: 'Hämta person',
  model: false,
  scope: {},
  description: 'En träff från en tidigare sökning, hämtad igen.',
  input: personRefInput,
  output: searchHitSchema,
};

// Registration: the connector's identity, area and available operations.
export const manifest = {
  protocol: 2,
  id: 'phonebook',
  kind: 'passthrough',
  source: 'Telefonboken',
  areas: [
    {
      id: 'kontakter',
      title: 'Kontakter',
      icon: 'phone',
      roles: ['manager', 'employee'],
      standing: ['phonebook.team', 'phonebook.directory'],
      schedules: [],
    },
  ],
  capabilities: [directoryCapability, teamCapability, personCapability, searchCapability, fetchCapability],
  scan: false,
};
