import { expect, type Locator } from '@playwright/test';
import type {
  CompetenceApproval,
  CompetenceMatrixCell,
  CompetenceMatrixOutput,
  CompetenceOwnSkill,
  CompetenceRequirementsOutput,
  CompetenceSearchRow,
  CompetenceShareTarget,
  CompetenceSkillValidation,
  CompetenceSource,
  CompetenceType,
  PanelViewSpec,
} from '@clew/contracts';
import { rowMark } from '@clew/contracts';

/**
 * Kompetens (D108) as the browser specs meet it: one person's holdings as the declared view, the catalogue, its sources,
 * the requirements and share targets, and the manager's matrix.
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
      tones: { expired: 'alert', missing: 'alert', expiring: 'warn', 'awaiting-approval': 'none', rejected: 'none' },
    },
    { key: 'level', label: 'Nivå' },
    { key: 'assessment', label: 'Bedömning', format: 'status', tones: { 'Egen bedömning': 'none' }, beside: true },
    { key: 'interest', label: 'Utveckling', format: 'status', tones: { 'Vill utveckla': 'none' }, beside: true },
    { key: 'required', label: 'Krävd nivå' },
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
/**
 * What needs doing among a manager's reports (`competence.attention`), as the module declares it: a row names the
 * person it is about (`subject`), so the name leads to their page, in a card under an answer too.
 */
export const attentionSpec: PanelViewSpec = {
  kind: 'table',
  title: 'name',
  subject: { entity: 'person', key: 'userName' },
  noun: { one: 'kompetens', other: 'kompetenser' },
  empty: 'Inget saknas, inget har gått ut och inget går ut inom 90 dagar.',
  fields: [
    { key: 'name', label: 'Namn' },
    { key: 'competence', label: 'Kompetens' },
    {
      key: 'status',
      label: 'Status',
      format: 'status',
      tones: { expired: 'alert', missing: 'alert', expiring: 'warn' },
    },
    { key: 'level', label: 'Nivå' },
    { key: 'assessment', label: 'Bedömning', format: 'status', tones: { 'Egen bedömning': 'none' }, beside: true },
    { key: 'required', label: 'Krävd nivå' },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
    { key: 'source', label: 'Källa' },
    { key: 'readAt', label: 'Inläst', format: 'instant', beside: true },
  ],
  capability: 'competence.attention',
  connector: 'competence',
  source: 'Kompetens',
  chip: false,
};
const due = (userName: string, name: string, competence: string, status: string, expiresOn: string) => ({
  ref: `holding:competence:${userName}-${competence.toLowerCase()}`,
  userName,
  name,
  competence,
  area: 'Säkerhet',
  kind: 'course',
  issuedOn: '2023-05-02',
  expiresOn,
  status,
  evidence: 'manager',
});
/** Four rows, Maria's last: the three first, a whole read's excerpt, would leave her out. */
export const attentionOutput = {
  rows: [
    due('anna.lindqvist', 'Anna Lindqvist', 'Brandskydd', 'expired', '2025-05-02'),
    due('anna.lindqvist', 'Anna Lindqvist', 'HLR', 'expired', '2026-01-10'),
    due('erik.sandstrom', 'Erik Sandström', 'HLR', 'expiring', '2026-12-20'),
    due('maria.kallstrom', 'Maria Källström', 'Brandskydd', 'expiring', '2027-01-20'),
  ],
};
/** The marks the server keeps of the rows an answer names (`rowMark`): Maria's row, and Anna's Brandskydd in her holdings. */
export const mariaMark = rowMark(attentionSpec, attentionOutput.rows[3]!);
export const brandskyddMark = rowMark(
  holdingsSpec,
  holdingsOutput.rows.find(r => r.competence === 'Brandskydd')!,
);
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
 * Administration › Kompetens › Krav (D108 item 6): requirements on positions, by code, one of them on a type since
 * archived and one on a position the provisioner has since removed; one on a unit; and the positions and units the
 * dialog offers.
 */
export const competenceRequirements = (): CompetenceRequirementsOutput => ({
  rows: [
    { id: 'r-hlr-usk', typeId: 't-hlr', on: 'position', targetId: 'underskoterska', targetLabel: 'Undersköterska' },
    { id: 'r-old-ssk', typeId: 't-old', on: 'position', targetId: 'sjukskoterska', targetLabel: 'Sjuksköterska' },
    { id: 'r-heta-tolk', typeId: 't-heta', on: 'position', targetId: 'tolk', targetLabel: 'tolk', gone: true },
    { id: 'r-fall-gata', typeId: 't-fall', on: 'unit', targetId: 'unit-gata', targetLabel: 'Gata och park' },
  ],
  positions: [
    { code: 'maskinforare', label: 'Maskinförare' },
    { code: 'sjukskoterska', label: 'Sjuksköterska' },
    { code: 'underskoterska', label: 'Undersköterska' },
  ],
  units: [
    { id: 'unit-skola', label: 'Bergsåkers skola' },
    { id: 'unit-gata', label: 'Gata och park' },
    { id: 'unit-hemtjanst', label: 'Hemtjänst Norr' },
  ],
});
/**
 * Share targets: one across the organisation measured over enough people, one held by too few to show, and one on a unit,
 * which its manager reads.
 */
export const competenceShareTargets = (): CompetenceShareTarget[] => [
  {
    id: 's-hlr-usk',
    typeId: 't-hlr',
    positionCode: 'underskoterska',
    positionLabel: 'Undersköterska',
    minShare: 80,
    outcome: { holders: 24, meeting: 20, share: 83, met: true },
  },
  {
    id: 's-fall-mask',
    typeId: 't-fall',
    positionCode: 'maskinforare',
    positionLabel: 'Maskinförare',
    minShare: 50,
    outcome: { tooFew: true },
  },
  {
    id: 's-heta-gata',
    typeId: 't-heta',
    positionCode: 'maskinforare',
    positionLabel: 'Maskinförare',
    unitId: 'unit-gata',
    unitLabel: 'Gata och park',
    minShare: 50,
  },
];
/**
 * The manager's matrix (D108 item 11) over three of the people Personal lists (`staffOverview()`): three columns, each
 * state a cell can be in. Anna's HLR runs out soon and her Heta arbeten has run out, both registered by her manager and
 * so revocable, and Fallskydd is required of her unit and missing; Erik's HLR was copied from the learning platform and
 * cannot be revoked, and Fallskydd is required of him by his manager's own requirement; Lena holds Heta arbeten without
 * its being required of her.
 */
const cell = (typeId: string, c: Partial<CompetenceMatrixCell> & Pick<CompetenceMatrixCell, 'status'>) =>
  ({ typeId, required: false, through: [], revocable: false, ...c }) satisfies CompetenceMatrixCell;
const onPosition = { on: 'position' as const, label: 'Undersköterska' };
export const competenceMatrix = (): CompetenceMatrixOutput => ({
  groups: [],
  awaiting: [],
  columns: [
    { typeId: 't-hlr', name: 'HLR', area: 'Akut omhändertagande', kind: 'course' },
    { typeId: 't-fall', name: 'Fallskydd', area: 'Säkerhet', kind: 'certificate' },
    { typeId: 't-heta', name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' },
  ],
  rows: [
    {
      personId: 'anna',
      key: 'anna.lindqvist',
      name: 'Anna Lindqvist',
      cells: [
        cell('t-hlr', {
          status: 'expiring',
          expiresOn: '2027-01-10',
          required: true,
          through: [onPosition],
          holdingId: 'h-anna-hlr',
          evidence: 'manager',
          revocable: true,
        }),
        cell('t-fall', { status: 'missing', required: true, through: [{ on: 'unit', label: 'Skönsmons skola' }] }),
        cell('t-heta', {
          status: 'expired',
          expiresOn: '2026-05-31',
          required: true,
          through: [onPosition],
          holdingId: 'h-anna-heta',
          evidence: 'manager',
          revocable: true,
        }),
      ],
    },
    {
      personId: 'erik',
      key: 'erik.sandstrom',
      name: 'Erik Sandström',
      cells: [
        cell('t-hlr', {
          status: 'valid',
          expiresOn: '2028-11-01',
          required: true,
          through: [onPosition],
          holdingId: 'h-erik-hlr',
          evidence: 'system',
        }),
        cell('t-fall', {
          status: 'missing',
          required: true,
          through: [{ on: 'person', requirementId: 'r-erik-fall' }],
        }),
        cell('t-heta', { status: 'none' }),
      ],
    },
    {
      personId: 'lena',
      key: 'lena.berg',
      name: 'Lena Berg',
      cells: [
        cell('t-hlr', { status: 'missing', required: true, through: [onPosition] }),
        cell('t-fall', { status: 'none' }),
        cell('t-heta', {
          status: 'valid',
          holdingId: 'h-lena-heta',
          evidence: 'manager',
          revocable: true,
        }),
      ],
    },
  ],
  required: 3,
});
/**
 * The same matrix as it is when more is required than the most columns shown (the mock keeps the three columns and
 * offers them in sets, saying 42 are required): by area and by position, the set in the address choosing the columns,
 * the first when none is named.
 */
export const matrixSets = [
  { by: 'area:Akut omhändertagande', part: 1, parts: 1, kind: 'area', label: 'Akut omhändertagande', types: 1 },
  { by: 'area:Säkerhet', part: 1, parts: 1, kind: 'area', label: 'Säkerhet', types: 2 },
  { by: 'position:underskoterska', part: 1, parts: 1, kind: 'position', label: 'Undersköterska', types: 2 },
] as const;
const setColumns: Record<string, string[]> = {
  'area:Akut omhändertagande': ['t-hlr'],
  'area:Säkerhet': ['t-fall', 't-heta'],
  'position:underskoterska': ['t-hlr', 't-heta'],
};
/** The matrix with only the columns at these indexes, in every row. */
const keeping = (base: CompetenceMatrixOutput, keep: number[]): Pick<CompetenceMatrixOutput, 'columns' | 'rows'> => ({
  columns: keep.map(i => base.columns[i]!),
  rows: base.rows.map(r => ({ ...r, cells: keep.map(i => r.cells[i]!) })),
});
/**
 * The matrix the mock answers, as the server does: where everything fits, every column unless an area is chosen (`by`),
 * with the areas offered where there is more than one; with `beyond`, more is required than fits, so a set is always
 * shown, the one `by` names or the first.
 */
export function matrixAnswer(base: CompetenceMatrixOutput, beyond: boolean, by: string | null): CompetenceMatrixOutput {
  if (beyond) {
    const chosen = matrixSets.find(s => s.by === by) ?? matrixSets[0];
    const ids = setColumns[chosen.by]!;
    return {
      ...base,
      by: chosen.by,
      part: 1,
      groups: matrixSets.map(s => ({ ...s })),
      ...keeping(
        base,
        base.columns.map((c, i) => (ids.includes(c.typeId) ? i : -1)).filter(i => i >= 0),
      ),
      required: 42,
    };
  }
  const areas = [...new Set(base.columns.map(c => c.area))];
  const groups =
    areas.length > 1
      ? areas.map(area => ({
          by: 'area:' + area,
          part: 1,
          parts: 1,
          kind: 'area' as const,
          label: area,
          types: base.columns.filter(c => c.area === area).length,
        }))
      : [];
  const chosen = groups.find(g => g.by === by);
  if (!chosen) return { ...base, groups };
  return {
    ...base,
    by: chosen.by,
    part: 1,
    groups,
    ...keeping(
      base,
      base.columns.map((c, i) => (c.area === chosen.label ? i : -1)).filter(i => i >= 0),
    ),
  };
}
/**
 * A matrix at the size a manager of a large unit reads (D108 item 11): twenty required types in two areas, the last a
 * skill, against thirty reports, every state a cell can be in turning through the rows, and a long name or two among
 * the types, so the page can be judged at size.
 */
export function largeMatrix(): CompetenceMatrixOutput {
  const columns = Array.from({ length: 20 }, (_, i) => ({
    typeId: `t-big-${i + 1}`,
    name: i % 7 === 3 ? `Hjärt- och lungräddning med hjärtstartare ${i + 1}` : `Kompetens ${i + 1}`,
    area: i < 10 ? 'Säkerhet' : 'Vård',
    kind: i === 19 ? ('skill' as const) : ('course' as const),
    ...(i === 19 ? { levels: [2 as const] } : {}),
  }));
  const state = (p: number, i: number): CompetenceMatrixCell => {
    const typeId = columns[i]!.typeId;
    const required = { required: true, through: [onPosition] };
    if (i === 19)
      return (p + i) % 3 === 0
        ? cell(typeId, { status: 'missing', ...required, least: 2 })
        : cell(typeId, { status: 'valid', ...required, least: 2, holdingId: `h-${p}-${i}`, level: 3, validated: true });
    switch ((p + i) % 7) {
      case 0:
        return cell(typeId, { status: 'missing', ...required });
      case 1:
        return cell(typeId, { status: 'expiring', expiresOn: '2027-01-10', ...required, holdingId: `h-${p}-${i}` });
      case 2:
        return cell(typeId, { status: 'expired', expiresOn: '2026-05-31', ...required, holdingId: `h-${p}-${i}` });
      case 3:
        return cell(typeId, { status: 'none' });
      default:
        return cell(typeId, { status: 'valid', expiresOn: '2028-11-01', ...required, holdingId: `h-${p}-${i}` });
    }
  };
  return {
    groups: [],
    awaiting: [],
    columns,
    rows: Array.from({ length: 30 }, (_, p) => ({
      personId: `p-${p + 1}`,
      key: `person${p + 1}`,
      name: `Person ${String(p + 1).padStart(2, '0')}`,
      cells: columns.map((_, i) => state(p, i)),
    })),
    required: 20,
  };
}

/**
 * Lena's own registration of HLR (D108 item 7), waiting for her manager's decision: as the decision's dialog reads it,
 * and the matrix with it noted in her HLR cell, which stays "Saknas" without it.
 */
export const lenaApproval = (): CompetenceApproval => ({
  holdingId: 'own-lena',
  personId: 'lena',
  key: 'lena.berg',
  name: 'Lena Berg',
  typeId: 't-hlr',
  competence: 'HLR',
  area: 'Akut omhändertagande',
  issuedOn: '2026-10-01',
  expiresOn: '2028-10-01',
  registeredAt: '2026-11-03T08:00:00.000Z',
});
export const withLenaWaiting = (m: CompetenceMatrixOutput): CompetenceMatrixOutput => ({
  ...m,
  awaiting: [
    {
      holdingId: 'own-lena',
      personId: 'lena',
      key: 'lena.berg',
      name: 'Lena Berg',
      typeId: 't-hlr',
      competence: 'HLR',
      issuedOn: '2026-10-01',
      expiresOn: '2028-10-01',
    },
  ],
  rows: m.rows.map(r =>
    r.personId === 'lena'
      ? { ...r, cells: r.cells.map(c => (c.typeId === 't-hlr' ? { ...c, pending: 'own-lena' } : c)) }
      : r,
  ),
});
/** The reader's own list with a registration of hers that waits, which the page draws in its own card, and one rejected. */
export const holdingsWithOwn = {
  rows: [
    ...holdingsOutput.rows,
    {
      ...holding('Heta arbeten', 'Säkerhet', 'awaiting-approval', '2026-10-01', '2031-09-30'),
      ref: 'holding:competence:own-1',
      evidence: 'self',
    },
    {
      ...holding('Fallskydd', 'Säkerhet', 'rejected', '2026-09-01'),
      ref: 'holding:competence:own-2',
      evidence: 'self',
    },
  ],
};

/**
 * Skills (D120): two types of the kind Färdighet, held at a level and never ending. A spec that needs them adds them to
 * the catalogue (`withSkills`), so the specs of the certificates read the catalogue they always have.
 */
export const skillTypes = (): CompetenceType[] => [
  { id: 't-eng', name: 'Engelska', area: 'Språk', kind: 'skill', archived: false },
  { id: 't-journal', name: 'Journalsystem', area: 'Digital kompetens', kind: 'skill', archived: false },
];
export const withSkills = (): CompetenceType[] => [...competenceTypes(), ...skillTypes()];
/** The reader's Engelska, rated by herself at Självständig and wanting to develop it, as her page lists it. */
export const ownEnglish = (): CompetenceOwnSkill => ({
  holdingId: 'skill-eng',
  typeId: 't-eng',
  competence: 'Engelska',
  area: 'Språk',
  level: 2,
  validated: false,
  interest: true,
});
/**
 * The matrix with a skill's column (D120 items 1 and 4): Journalsystem required of every report at least Självständig.
 * Anna rated herself Expert, unconfirmed, so it is missing with her rating beside it; Erik's Självständig is confirmed and
 * meets it; Lena holds nothing of it.
 */
export const withJournal = (m: CompetenceMatrixOutput): CompetenceMatrixOutput => {
  const asked = { required: true, through: [onPosition], least: 2 as const };
  const cells: Record<string, CompetenceMatrixCell> = {
    // Her own rating: hers to remove, never the manager's to revoke.
    anna: cell('t-journal', {
      status: 'missing',
      ...asked,
      holdingId: 'h-anna-journal',
      evidence: 'self',
      revocable: false,
      level: 3,
      validated: false,
      interest: true,
    }),
    erik: cell('t-journal', {
      status: 'valid',
      ...asked,
      holdingId: 'h-erik-journal',
      evidence: 'self',
      revocable: false,
      level: 2,
      validated: true,
    }),
    lena: cell('t-journal', { status: 'missing', ...asked }),
  };
  return {
    ...m,
    columns: [
      ...m.columns,
      { typeId: 't-journal', name: 'Journalsystem', area: 'Digital kompetens', kind: 'skill', levels: [2] },
    ],
    rows: m.rows.map(r => ({ ...r, cells: [...r.cells, cells[r.personId]!] })),
    required: m.required + 1,
  };
};
/** Anna's Journalsystem as her manager confirms it: her own rating, Expert. */
export const annaJournal = (): CompetenceSkillValidation => ({
  holdingId: 'h-anna-journal',
  personId: 'anna',
  name: 'Anna Lindqvist',
  typeId: 't-journal',
  competence: 'Journalsystem',
  area: 'Digital kompetens',
  level: 3,
  validated: false,
  interest: true,
});
/**
 * Kompetenssökning (D121): who in the organisation holds each type, as the server finds them, by name. HLR is held by
 * three people across two units, one run out and one about to, one without a user name and so without a page; Engelska
 * (a skill) by two, one confirmed and one the person's own rating; Heta arbeten by nobody. `many` gives HLR sixty more
 * holders, for three pages.
 */
export function searchHolders(many = false): Record<string, CompetenceSearchRow[]> {
  const extra = many
    ? Array.from({ length: 60 }, (_, i) => {
        const n = String(i + 1).padStart(2, '0');
        return {
          personId: 'p' + n,
          key: 'person' + n,
          name: 'Person ' + n,
          units: ['Hemtjänst Centrum'],
          status: 'valid' as const,
          expiresOn: '2027-06-01',
        };
      })
    : [];
  return {
    't-hlr': [
      {
        personId: 'p-anna',
        key: 'anna.lindqvist',
        name: 'Anna Lindqvist',
        units: ['Bergsåkers skola'],
        status: 'expiring',
        expiresOn: '2027-01-10',
      },
      {
        personId: 'p-bo',
        key: null,
        name: 'Bo Ek',
        units: ['Hemtjänst Centrum'],
        status: 'expired',
        expiresOn: '2026-01-10',
      },
      {
        personId: 'p-hassan',
        key: 'hassan',
        name: 'Hassan Ali',
        units: ['Hemtjänst Centrum', 'Bergsåkers skola'],
        status: 'valid',
        expiresOn: '2027-11-01',
      },
      ...extra,
    ],
    't-eng': [
      {
        personId: 'p-anna',
        key: 'anna.lindqvist',
        name: 'Anna Lindqvist',
        units: ['Bergsåkers skola'],
        status: 'valid',
        level: 3,
        validated: true,
      },
      {
        personId: 'p-hassan',
        key: 'hassan',
        name: 'Hassan Ali',
        units: ['Hemtjänst Centrum'],
        status: 'valid',
        level: 2,
        validated: false,
      },
    ],
  };
}

/**
 * The three levels of a skill (D120 item 1) as a radio group names and describes them, in order: each radio named by
 * its word and described by what it means, never by the number behind it, whichever of the three forms draws the group
 * (a person's own skill, a manager's registration, a requirement's least level).
 */
export async function expectLevelNames(group: Locator) {
  const radios = group.getByRole('radio');
  await expect(radios).toHaveCount(3);
  const levels = [
    ['Grundläggande', 'Kan grunderna och arbetar med stöd.'],
    ['Självständig', 'Arbetar på egen hand.'],
    ['Expert', 'Kan lära ut och leda andra.'],
  ] as const;
  for (const [i, [name, meaning]] of levels.entries()) {
    await expect(radios.nth(i)).toHaveAccessibleName(name);
    await expect(radios.nth(i)).toHaveAccessibleDescription(meaning);
  }
  for (const number of ['1', '2', '3'])
    await expect(group.getByRole('radio', { name: number, exact: true })).toHaveCount(0);
}
