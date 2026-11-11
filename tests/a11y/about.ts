import type { AboutResult, CompetenceType, PanelViewSpec, View } from '@clew/contracts';

/**
 * What the sources say about the people of `staffOverview()` (D97), as `clew.about` answers it with the competence
 * module as the one source: Anna has a certificate that has run out, Erik one that runs out soon, Lena stands well and
 * the others hold nothing. And Anna's holdings, the view a mark opens.
 */
const standingView: View = {
  kind: 'list',
  title: 'status',
  noun: { one: 'person', other: 'personer' },
  empty: 'Inga registrerade kompetenser.',
  fields: [
    { key: 'status', label: 'Status', format: 'status', tones: { expired: 'alert', expiring: 'warn' } },
    { key: 'expired', label: 'Har gått ut', format: 'number' },
    { key: 'expiring', label: 'Går ut inom 90 dagar', format: 'number' },
    { key: 'holdings', label: 'Registrerade', format: 'number' },
  ],
  open: { capability: 'competence.holdings', title: 'Kompetenser', params: { person: 'person' } },
};
export const aboutResult = (): AboutResult => ({
  kind: 'person',
  sections: [
    {
      connector: 'competence',
      source: 'Kompetens',
      capability: 'competence.standing',
      title: 'Kompetens',
      view: standingView,
      status: 'ok',
      rows: [
        { key: 'anna', person: 'anna.lindqvist', status: 'expired', expired: 1, expiring: 1, holdings: 3 },
        { key: 'erik', person: 'erik.nystrom', status: 'expiring', expired: 0, expiring: 1, holdings: 2 },
        { key: 'lena', person: 'lena.berg', status: 'valid', expired: 0, expiring: 0, holdings: 1 },
      ],
    },
  ],
});
export const holdingsSpec: PanelViewSpec = {
  kind: 'list',
  title: 'competence',
  noun: { one: 'kompetens', other: 'kompetenser' },
  empty: 'Det finns inga registrerade kompetenser.',
  fields: [
    { key: 'competence', label: 'Kompetens' },
    { key: 'status', label: 'Status', format: 'status', tones: { expired: 'alert', expiring: 'warn' } },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
    { key: 'issuedOn', label: 'Utfärdat', format: 'date' },
    { key: 'area', label: 'Område' },
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
export const holdingsOutput = {
  rows: [
    holding('Heta arbeten', 'Säkerhet', 'expired', '2021-06-01', '2026-05-31'),
    holding('HLR', 'Akut omhändertagande', 'expiring', '2025-01-10', '2027-01-10'),
    holding('Socionomexamen', 'Examen', 'valid', '2015-06-05'),
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
