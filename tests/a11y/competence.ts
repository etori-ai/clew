import type {
  CompetenceRequirementsOutput,
  CompetenceShareTarget,
  CompetenceSource,
  CompetenceType,
  PanelViewSpec,
} from '@clew/contracts';

/**
 * Kompetens (D108) as the browser specs meet it: one person's holdings as the declared view, the catalogue, its sources,
 * and the requirements and share targets.
 */

export const holdingsSpec: PanelViewSpec = {
  kind: 'list',
  title: 'competence',
  noun: { one: 'kompetens', other: 'kompetenser' },
  empty: 'Det finns inga registrerade kompetenser.',
  fields: [
    { key: 'competence', label: 'Kompetens' },
    {
      key: 'status',
      label: 'Status',
      format: 'status',
      tones: { expired: 'alert', missing: 'alert', expiring: 'warn' },
    },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
    { key: 'issuedOn', label: 'Utfärdat', format: 'date' },
    { key: 'area', label: 'Område' },
    { key: 'source', label: 'Källa' },
    { key: 'readAt', label: 'Inläst', format: 'instant', beside: true },
  ],
  capability: 'competence.holdings',
  connector: 'competence',
  source: 'Kompetens',
  chip: false,
};
const holding = (competence: string, area: string, status: string, issuedOn: string, expiresOn?: string) => ({
  ref: 'holding:competence:' + competence.toLowerCase().replace(/[^a-z]+/g, '-'),
  userName: 'anna.lindqvist',
  name: 'Anna Lindqvist',
  competence,
  area,
  kind: 'certificate',
  issuedOn,
  ...(expiresOn ? { expiresOn } : {}),
  status,
  evidence: 'manager',
});
/** Copied from the learning platform (D108 item 9): one mapped to the catalogue, one whose type is not, which counts towards nothing. */
const READ_AT = '2026-11-12T03:02:00.000Z';
export const holdingsOutput = {
  rows: [
    holding('Heta arbeten', 'Säkerhet', 'expired', '2021-06-01', '2026-05-31'),
    holding('HLR', 'Akut omhändertagande', 'expiring', '2025-01-10', '2027-01-10'),
    // Required of her (D108 item 6) and held by nobody's word: a missing row has no dates and no evidence.
    {
      ref: 'holding:competence:missing:p-anna:t-fall',
      userName: 'anna.lindqvist',
      name: 'Anna Lindqvist',
      competence: 'Fallskydd',
      area: 'Säkerhet',
      kind: 'certificate',
      status: 'missing',
    },
    holding('Socionomexamen', 'Examen', 'valid', '2015-06-05'),
    {
      ...holding('Brandskydd', 'Säkerhet', 'valid', '2025-11-01', '2028-11-01'),
      kind: 'course',
      evidence: 'system',
      source: 'Lärplattformen',
      readAt: READ_AT,
    },
    {
      ref: 'holding:competence:copied-livsmedel',
      userName: 'anna.lindqvist',
      name: 'Anna Lindqvist',
      competence: 'Livsmedelshygien',
      issuedOn: '2026-02-03',
      status: 'uncounted',
      evidence: 'system',
      source: 'Lärplattformen',
      readAt: READ_AT,
    },
  ],
};
/** The catalogue as the manager's registration form lists it: two areas, one type with the employer's rule. */
export const competenceTypes = (): CompetenceType[] => [
  { id: 't-hlr', name: 'HLR', area: 'Akut omhändertagande', kind: 'course', validityMonths: 24, archived: false },
  { id: 't-heta', name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate', archived: false },
  { id: 't-fall', name: 'Fallskydd', area: 'Säkerhet', kind: 'certificate', archived: false },
];
/** The catalogue as its administrator reads it: the same, and one archived type. */
export const competenceCatalogue = (): CompetenceType[] => [
  ...competenceTypes(),
  { id: 't-old', name: 'Äldre brandskydd', area: 'Säkerhet', kind: 'course', validityMonths: 36, archived: true },
];
/**
 * Administration › Kompetens › Källor (D108 item 9): a learning platform read this morning, with one type mapped to the
 * catalogue and two waiting, and a course register that no longer answers and whose last read failed.
 */
export const competenceSources = (): CompetenceSource[] => [
  {
    connectorId: 'lms',
    source: 'Lärplattformen',
    answering: true,
    reading: false,
    lastRead: {
      startedAt: '2026-11-12T03:00:00.000Z',
      finishedAt: READ_AT,
      outcome: 'complete',
      unmatched: 3,
      counts: { read: 412, stored: 12, unchanged: 400, invalid: 0, unmapped: 2, revoked: 0, outside: 0, removed: 0 },
    },
    types: [
      { sourceType: 'badge:4', label: 'HLR-instruktör', holdings: 3 },
      { sourceType: 'clew-dev:hlr', label: 'Hjärt-lungräddning med hjärtstartare', holdings: 38, typeId: 't-hlr' },
      { sourceType: 'clew-dev:livsmedelshygien', label: 'Livsmedelshygien', holdings: 21 },
    ],
  },
  {
    connectorId: 'kursregister',
    source: 'Kursregistret',
    answering: false,
    reading: false,
    lastRead: {
      startedAt: '2026-11-11T03:00:00.000Z',
      finishedAt: '2026-11-11T03:00:10.000Z',
      outcome: 'failed',
      unmatched: 0,
      counts: { read: 0, stored: 0, unchanged: 0, invalid: 0, unmapped: 0, revoked: 0, outside: 0, removed: 0 },
    },
    types: [],
  },
];
/**
 * Administration › Kompetens › Krav (D108 item 6): two requirements on positions, one of them on a type since archived,
 * one on a unit, and the positions and units the dialog offers.
 */
export const competenceRequirements = (): CompetenceRequirementsOutput => ({
  rows: [
    { id: 'r-hlr-usk', typeId: 't-hlr', on: 'position', targetId: 'pos-usk', targetLabel: 'Undersköterska' },
    { id: 'r-old-ssk', typeId: 't-old', on: 'position', targetId: 'pos-ssk', targetLabel: 'Sjuksköterska' },
    { id: 'r-fall-gata', typeId: 't-fall', on: 'unit', targetId: 'unit-gata', targetLabel: 'Gata och park' },
  ],
  positions: [
    { id: 'pos-mask', code: 'maskinforare', label: 'Maskinförare' },
    { id: 'pos-ssk', code: 'sjukskoterska', label: 'Sjuksköterska' },
    { id: 'pos-usk', code: 'underskoterska', label: 'Undersköterska' },
  ],
  units: [
    { id: 'unit-skola', label: 'Bergsåkers skola' },
    { id: 'unit-gata', label: 'Gata och park' },
    { id: 'unit-hemtjanst', label: 'Hemtjänst Norr' },
  ],
});
/** One share target across the organisation. */
export const competenceShareTargets = (): CompetenceShareTarget[] => [
  { id: 's-hlr-usk', typeId: 't-hlr', positionId: 'pos-usk', positionLabel: 'Undersköterska', minShare: 80 },
];
