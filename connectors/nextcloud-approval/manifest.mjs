// Clew reads this contract to find the files that wait for a person's approval in Nextcloud's Approval app, to draw
// them, and to carry out the person's decision (D101). Every call acts as the person with their own token for Nextcloud;
// the connector holds no credential of its own. connector.mjs holds the handlers, nextcloud.mjs the only code that knows
// Nextcloud's API, approvals.mjs the port and the in-memory stand-in.

export const CONNECTOR = 'nextcloud-approval';
export const DEFAULT_AUDIENCE = 'nextcloud';
export const DEFAULT_SOURCE = 'Nextcloud';
export const AREA = 'approvals';

/** `nextcloud-approval:file:<Nextcloud file id>`. Clew treats it as opaque; the id is the instance's own. */
export const fileRefPattern = `^${CONNECTOR}:file:[1-9][0-9]{0,14}$`;
const fileRef = { type: 'string', pattern: fileRefPattern, maxLength: 60 };

const text = (maxLength = 400) => ({ type: 'string', minLength: 1, maxLength });
const instant = { type: 'string', format: 'date-time', maxLength: 40 };
const link = { type: 'string', pattern: '^https?://', maxLength: 2000 };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** What a state read says, in the person's words. Only the one that needs the person carries a tone. */
export const STATUS = {
  none: 'Inget godkännande begärt',
  others: 'Väntar på en annan godkännare',
  approved: 'Godkänd',
  rejected: 'Avvisad',
  mine: 'Väntar på dig',
};

const pendingRow = object({ ref: fileRef, file: text(), requestedBy: text(200), requestedAt: instant, link }, [
  'ref',
  'file',
]);

/**
 * The execute input: the files the person decides on, and for each the version (Nextcloud's etag) and name the card
 * showed. Nextcloud refuses a decision on any other version, so a file changed after it was listed is not approved.
 */
export const decisionInput = object({
  refs: { type: 'array', items: fileRef, minItems: 1, maxItems: 20, uniqueItems: true },
  files: {
    type: 'object',
    maxProperties: 20,
    propertyNames: { pattern: fileRefPattern },
    additionalProperties: object({ etag: text(200), name: text() }, ['etag']),
  },
});

export const executeResult = object(
  {
    headline: text(200),
    rows: {
      type: 'array',
      items: object({
        ref: fileRef,
        label: text(),
        outcome: { enum: ['done', 'failed', 'unknown', 'skipped'] },
        detail: text(600),
      }),
    },
  },
  ['headline', 'rows'],
);

// No operation id, and a repeated decision is refused like a forbidden one, so nothing can make a replay safe: Clew never
// repeats a write by itself, and a lost answer the connector could not settle by reading the state back stays unknown.
const manual = { strategy: 'manual' };
const everyone = {};

function capabilities(source) {
  const pending = {
    name: `${CONNECTOR}.pending`,
    kind: 'read',
    title: 'Filer att godkänna',
    description: `Filer i ${source} som väntar på ditt godkännande: filens namn, vem som bad om det och när.`,
    // A tool, but the model gets the count only: a file name is written by someone else and the rows name people.
    model: true,
    scope: everyone,
    input: object({}),
    output: object({ rows: { type: 'array', items: pendingRow } }),
    menu: { label: 'Filer att godkänna', icon: 'document' },
    view: {
      kind: 'table',
      title: 'file',
      ref: 'ref',
      modelReads: 'summary',
      noun: { one: 'fil', other: 'filer' },
      empty: 'Inga filer väntar på ditt godkännande.',
      open: { capability: `${CONNECTOR}.state`, title: 'Godkännande', params: { ref: 'ref' } },
      fields: [
        { key: 'file', label: 'Fil' },
        { key: 'requestedBy', label: 'Begärd av' },
        { key: 'requestedAt', label: 'Begärd', format: 'instant' },
      ],
    },
  };

  // One file's approval as Nextcloud answers it now, with free text, so never a tool.
  const state = {
    name: `${CONNECTOR}.state`,
    kind: 'read',
    title: 'Godkännande',
    description: `En fils godkännande i ${source}: om den väntar, är godkänd eller avvisad, av vem och när.`,
    model: false,
    scope: everyone,
    input: object({ ref: fileRef }),
    output: object(
      {
        ref: fileRef,
        file: text(),
        status: { type: 'string', enum: Object.values(STATUS) },
        requestedBy: text(200),
        requestedAt: instant,
        decidedBy: text(200),
        decidedAt: instant,
        message: text(2000),
        link,
      },
      ['ref', 'file', 'status'],
    ),
    view: {
      kind: 'detail',
      title: 'file',
      fields: [
        { key: 'file', label: 'Fil' },
        { key: 'status', label: 'Status', format: 'status', tones: { [STATUS.mine]: 'warn' } },
        { key: 'requestedBy', label: 'Begärd av' },
        { key: 'requestedAt', label: 'Begärd', format: 'instant' },
        { key: 'decidedBy', label: 'Beslutad av' },
        { key: 'decidedAt', label: 'Beslutad', format: 'instant' },
        { key: 'message', label: 'Meddelande' },
        { key: 'link', label: `Öppna i ${source}`, format: 'link' },
      ],
    },
  };

  const open = {
    name: `${CONNECTOR}.open`,
    kind: 'read',
    title: `Öppna i ${source}`,
    description: `Adressen till filen i ${source}.`,
    model: false,
    scope: everyone,
    input: object({ ref: fileRef }),
    output: object({ url: link }),
  };

  const decision = (verb, title, description) => ({
    name: `${CONNECTOR}.${verb}`,
    kind: 'execute',
    title,
    description,
    model: false,
    scope: everyone,
    execution: manual,
    input: decisionInput,
    output: executeResult,
  });

  return [
    pending,
    state,
    open,
    decision('approve', 'Godkänn', `Godkänner filen i ${source} i den version kortet visade.`),
    decision('reject', 'Avvisa', `Avvisar filen i ${source} i den version kortet visade.`),
  ];
}

/**
 * `audience` is what the person's token is issued for: the identity provider and Nextcloud's user_oidc provider agree on
 * it, so it is configuration. `source` is the system's name as a person reads it.
 */
export function createManifest({ audience = DEFAULT_AUDIENCE, source = DEFAULT_SOURCE } = {}) {
  return {
    protocol: 2,
    id: CONNECTOR,
    kind: 'passthrough',
    source,
    areas: [
      {
        id: AREA,
        title: 'Godkännanden',
        icon: 'document',
        roles: ['manager', 'employee'],
        standing: [`${CONNECTOR}.pending`],
        // The scan needs the person's token, so it runs when their session asks, never at night.
        schedules: [{ label: 'Filer som väntar på ditt godkännande', when: 'När du öppnar Clew' }],
      },
    ],
    capabilities: capabilities(source),
    scan: true,
    delegation: { audience },
  };
}

export const manifest = createManifest();
