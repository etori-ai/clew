import {
  COMPETENCE_CATALOGUE_MAX,
  COMPETENCE_SEARCH_PAGE_SIZES,
  COMPETENCE_STATUSES,
  COMPETENCE_TYPE_SEARCH_MAX,
  ENTITY_KEY_MAX,
  type CompetenceReadRelation,
  type Relation,
  type CompetenceSearchBody,
  type CompetenceSearchFileBody,
  type CompetenceSearchOptions,
  type CompetenceSearchPage,
  type CompetenceTypeSearchBody,
  type CompetenceTypeSearchOutput,
  competenceImportRowProblem,
  importText,
  isCompetenceLevel,
  type AuthenticatedContext,
  type Capability,
  type CompetenceApproval,
  type CompetenceAttentionOutput,
  type CompetenceDecision,
  type CompetenceHoldingBody,
  type CompetenceOwnOutput,
  type CompetenceOwnSkill,
  type CompetenceSkillBody,
  type CompetenceSkillChangeBody,
  type CompetenceSkillRatingBody,
  type CompetenceSkillValidation,
  type CompetenceValidationBody,
  type CompetenceImportBody,
  type CompetenceImportOutcome,
  type CompetenceMergeBody,
  type CompetenceMergePreview,
  type CompetenceHoldingsInput,
  type CompetenceHoldingsOutput,
  type CompetenceMappingBody,
  type CompetenceMatrixInput,
  type CompetenceMatrixOutput,
  type CompetenceReadCounts,
  type CompetenceReadOutcome,
  type CompetenceRequirement,
  type CompetenceRequirementBody,
  type CompetenceRequirementsOutput,
  type CompetenceShareTarget,
  type CompetenceShareTargetBody,
  type CompetenceShareTargetsOutput,
  type CompetenceSource,
  type CompetenceSourcesOutput,
  type CompetenceType,
  type CompetenceTypeBody,
  type CompetenceTypePatch,
  type CompetenceValidityImpact,
  type StaffPerson,
} from '@clew/contracts';
import { ForbiddenError, InputError } from '../../context';
import {
  awaiting,
  branchOf,
  confirmed,
  counts,
  coverageOf,
  isSkill,
  leastLevels,
  levelOf,
  reachesLevel,
  revocable,
  dailyCopyStart,
  deciding,
  endOf,
  holdingRow,
  importPlan,
  isCalendarDay,
  mergeFigures,
  mergePlan,
  leaseUntil,
  matrixCsv,
  decidingRevocation,
  requiredSince,
  matrixOf,
  meets,
  needsAttention,
  organisationOutcome,
  nextDailyCopy,
  normaliseArea,
  normaliseName,
  orderHoldingRows,
  orderTypes,
  ownCard,
  ownRow,
  countingRows,
  pageOfRows,
  searchCsv,
  searchRows,
  typeSearchWords,
  COPY_HOLDINGS_MAX,
  PAGES_MAX,
  personKey,
  planCopy,
  readNowStart,
  requiredOf,
  requirementsOn,
  SOURCE_ID_MAX,
  SOURCE_KEY_MAX,
  safeText,
  sourceReadError,
  statusOn,
  summarise,
  swedishDay,
  teamCard,
  typeRow,
  UNAVAILABLE_PAUSES_MS,
  uncounted,
  uncountedRow,
  usableHolding,
  type PersonSummary,
  type ReadHolding,
  type CardIdentity,
  type ImportRow,
  type Standing,
  type UnitCoverage,
} from './domain';
import {
  PendingTaken,
  RequirementTaken,
  ShareTargetTaken,
  SkillTaken,
  TypeNameTaken,
  type CompetenceDeps,
  type CompetenceExport,
  type CompetenceTx,
  type HoldingRecord,
  type HoldingsSourceRef,
  type PersonRef,
  type ReadLogEntry,
  type ReadLogQuery,
  type RequirementRecord,
  type ShareTargetRecord,
  type SourceHoldingsPage,
  type SourceHoldingsRow,
  type SourceReadCounts,
  type SourceRecord,
  type TypeRecord,
} from './model';

/** A request the competence module turns down for what it asks, not who asks (D108); a 400 with this message. */
export class CompetenceError extends InputError {
  constructor(message: string) {
    super(message);
    this.name = 'CompetenceError';
  }
}
/** Erasure was asked for a person who is still active (D108 item 14); an operator's error, so in English. */
export class PersonStillActive extends Error {
  constructor() {
    super(
      'The person is still active. Erasure is for a person the directory has deactivated (D108 item 14): an active person would get their copied holdings back at the next read of the source.',
    );
    this.name = 'PersonStillActive';
  }
}
/** The grant capability behind the catalogue (D108 item 8). */
export const COMPETENCE_ADMIN: Capability = 'admin.competence';
/**
 * The version of the export document (D108 item 14); a breaking change is a new version. Version 2 (item 9): a holding
 * may have no type (a copied row whose source type is not mapped) and carries `copy`, and the document lists the
 * mappings of sources. Version 3 (item 6): the document lists the requirements and the share targets. Version 4: a
 * requirement and a share target name a position by its code (`positionCode`) and a unit by the id of its `unit:` key,
 * never by an internal row, and `createdBy` may be null (its author was erased). Version 5 (item 7): a holding may be a
 * person's own registration (evidence `self`, `pending` or `rejected`), and carries the decision on one (`decidedBy`,
 * `decidedAt`) and its approval's key (`threadId`). Version 6 (D120): a type may be of kind `skill`; a holding carries
 * its `level` (null on every kind but a skill), `interest`, and the confirmation of a skill's level (`validatedBy`,
 * `validatedAt`); a requirement of a skill carries its least level (`minLevel`). Version 7: a skill carries when its
 * level was last rated (`ratedAt`, null on every other kind). Version 8 (D120 item 7, D108 item 2): a type carries the
 * address it was imported with (`sourceUri`) and the type it was merged into (`mergedInto`), both null when none.
 */
export const COMPETENCE_EXPORT_FORMAT = 'clew.competence/8';
/** The actor of the scheduled copy (D108 item 9) in its audit rows. */
export const COPY_ACTOR = 'system:competence-copy';
/** The actor of the reconciliation of approvals' cards (D108 item 7) in its audit rows. */
export const RECONCILE_ACTOR = 'system:competence-approvals';
const NOT_A_MANAGER = 'Intyg registreras av den som är chef för en enhet.';
const NOT_YOURS = 'Personen finns inte bland dem du är chef för.';
const NO_TYPE = 'Kompetensen finns inte i katalogen.';
const ARCHIVED = 'Kompetensen är arkiverad och kan inte registreras.';
const BAD_DAY = 'Ange ett giltigt datum.';
const NAME_TAKEN = 'Det finns redan en kompetens med det namnet.';
const BAD_NAME = 'Ange ett namn på högst 120 tecken.';
const BAD_AREA = 'Ange ett område på högst 80 tecken.';
const NOT_ALLOWED = 'Du kan inte ändra det här intyget.';
const NO_SOURCE = 'Källan finns inte bland de system som svarar om intyg.';
const NOT_ANSWERING = 'Källan svarar inte om intyg just nu.';
const READING = 'Källan läses in just nu.';
const ARCHIVED_MAPPING = 'Kompetensen är arkiverad och kan inte kopplas.';
const BAD_SOURCE_TYPE = 'Ogiltig typ i källan.';
const ONE_TARGET = 'Ett krav gäller en befattning, en enhet eller en person.';
const NOT_THEIR_MANAGER = 'Krav på en enskild person sätts av den som är personens chef.';
const ARCHIVED_REQUIREMENT = 'Kompetensen är arkiverad och kan inte krävas.';
const NO_POSITION = 'Befattningen finns inte.';
const NO_UNIT = 'Enheten finns inte.';
const REQUIREMENT_TAKEN = 'Det kravet finns redan.';
const NOT_YOUR_REQUIREMENT = 'Du kan inte ta bort det här kravet.';
const BAD_SHARE = 'Ange en andel mellan 1 och 100 procent.';
const TARGET_TAKEN = 'Det finns redan ett andelsmål för den kompetensen och befattningen där.';
const NO_TARGET = 'Andelsmålet finns inte.';
const NOT_YOUR_UNIT = 'Enheten finns inte bland dem du är chef för.';
const NOT_A_MANAGER_MATRIX = 'Medarbetarnas kompetens visas för den som är chef för en enhet.';
const NO_APPROVER = 'Registreringen kan inte skickas: ingen chef är registrerad för dig.';
const PENDING_TAKEN = 'Du har redan en registrering av den kompetensen som väntar på godkännande.';
const NOT_YOURS_TO_DECIDE = 'Registreringen finns inte bland dem du kan granska.';
const DECIDED = 'Registreringen är redan granskad.';
const NOT_YOUR_OWN = 'Du har ingen sådan registrering.';
const DECIDED_OWN = 'Registreringen är redan granskad och kan inte tas tillbaka.';
const NOT_REJECTED = 'Bara en registrering som din chef har avvisat kan tas bort.';
const SKILL_ONLY = 'Bara en färdighet bedöms med en nivå.';
const SKILL_NOT_DATED = 'En färdighet registreras med en nivå, inte med datum.';
const BAD_LEVEL = 'Välj en nivå: Grundläggande, Självständig eller Expert.';
const SKILL_NO_VALIDITY = 'En färdighet har ingen giltighetstid.';
const KIND_LOCKED =
  'Kompetensen har registrerade innehav eller krav och kan inte göras om till eller från en färdighet.';
const KIND_MAPPED = 'Kompetensen är kopplad till en källa och kan inte göras om till eller från en färdighet.';
const NOT_YOUR_SKILL = 'Du har ingen sådan färdighet.';
const NOT_YOURS_TO_VALIDATE = 'Färdigheten finns inte bland dem du kan bekräfta.';
const SKILL_HELD = 'Personen har redan den färdigheten. Bekräfta nivån i stället.';
const SKILL_TAKEN = 'Du har redan den färdigheten. Ändra nivån under Färdigheter i stället.';
const NOT_REVOCABLE_SKILL = 'Färdigheten är medarbetarens egen bedömning, som bara medarbetaren kan ta bort.';
const LEVEL_ON_SKILL_ONLY = 'Bara en färdighet kan krävas på en viss nivå.';
const SKILL_UNMAPPABLE = 'En färdighet kan inte kopplas till en källa: det som läses in har ingen nivå.';
const MERGE_SELF = 'En kompetens kan inte slås ihop med sig själv.';
const MERGE_NO_TARGET = 'Kompetensen att slå ihop med finns inte i katalogen.';
const MERGE_INTO_ARCHIVED = 'Kompetensen att slå ihop med är arkiverad. Välj en som används.';
const MERGE_INTO_MERGED = 'Kompetensen att slå ihop med är redan sammanslagen med en annan.';
const MERGED_ALREADY = 'Kompetensen är redan sammanslagen med en annan.';
const MERGE_KINDS =
  'En färdighet kan bara slås ihop med en annan färdighet, och en kompetens av annat slag inte med en färdighet.';
const MERGED_FOR_GOOD =
  'Kompetensen är sammanslagen med en annan och kan inte återställas: en sammanslagning går inte att ångra.';
const MERGED_LOCKED = 'Kompetensen är sammanslagen med en annan och kan inte ändras.';
const RESTORE_NAME_TAKEN = 'Det finns redan en kompetens med det namnet. Byt namn på den ena först.';
const CATALOGUE_FULL = `Katalogen får ha högst ${COMPETENCE_CATALOGUE_MAX} kompetenser, arkiverade medräknade.`;
const ESCO_ROW = 'En rad ur ESCO är en färdighet med en adress.';
const NOT_A_REGISTRAR = 'Kompetenssökning är inte tilldelad dig. En administratör ger den genom en grupp.';
const LEVEL_ON_SKILL_SEARCH = 'Bara en färdighet söks på en viss nivå.';
/**
 * A merge refused while registrations of people's own wait for both types (D108 items 2 and 7). It says neither who nor
 * how many: an administrator has no relation to the people (D118).
 */
const WAITING_BOTH =
  'Det finns egna registreringar av båda kompetenserna som väntar på godkännande. Slå ihop dem när registreringarna är granskade.';
/**
 * A unit's coverage (D108 items 6 and 8) as the read about a unit and its table answer it: counts only, each share
 * target set on the unit with its position's label.
 */
export interface UnitCoverageResult extends Omit<UnitCoverage, 'targets'> {
  unitId: string;
  unitLabel: string;
  targets: Array<UnitCoverage['targets'][number] & { positionLabel: string }>;
}
/** The keys a requirement's audit row carries: ids, a position's code and a skill's least level, never a name. */
const requirementDetails = (r: RequirementRecord) => ({
  organisationId: r.organisationId,
  typeId: r.typeId,
  positionCode: r.positionCode,
  unitId: r.unitId,
  personId: r.personId,
  ...(r.minLevel !== null ? { minLevel: r.minLevel } : {}),
});
/** A holding registered in Clew before what makes it one kind or another: the columns no new holding sets. */
const registered = {
  revokedAt: null,
  revokedBy: null,
  copy: null,
  decidedBy: null,
  decidedAt: null,
  threadId: null,
  level: null,
  interest: false,
  validatedBy: null,
  validatedAt: null,
  ratedAt: null,
} satisfies Partial<HoldingRecord>;
/** The person's own skills (D120) in the order the page lists them: by area, then name, in Swedish order. */
const bySkillName = (a: CompetenceOwnSkill, b: CompetenceOwnSkill) =>
  a.area.localeCompare(b.area, 'sv') ||
  a.competence.localeCompare(b.competence, 'sv') ||
  a.typeId.localeCompare(b.typeId);
const targetDetails = (t: ShareTargetRecord) => ({
  organisationId: t.organisationId,
  typeId: t.typeId,
  positionCode: t.positionCode,
  unitId: t.unitId,
  minShare: t.minShare,
});
/** Standings in the order a person's cards are listed: by status (expired, missing, expiring), the soonest end first. */
const byUrgency = (a: Standing, b: Standing) =>
  COMPETENCE_STATUSES.indexOf(a.status) - COMPETENCE_STATUSES.indexOf(b.status) ||
  (a.end ?? '').localeCompare(b.end ?? '') ||
  a.type.name.localeCompare(b.type.name, 'sv') ||
  a.type.id.localeCompare(b.type.id) ||
  (a.holding?.id ?? '').localeCompare(b.holding?.id ?? '');
/**
 * What one read of a source came to: `busy` when another run held the source (or it was removed) and nothing was read
 * or written, `off` when the module was switched off before it began. The counts are the whole read's.
 */
export interface CopyResult {
  connectorId: string;
  outcome: CompetenceReadOutcome | 'busy' | 'off';
  counts?: CompetenceReadCounts;
  unmatched?: number;
}

/**
 * The competence module's use cases (D108): the catalogue, a manager's registration of a certificate, the copy of what
 * sources hold and the mapping of their types (item 9), requirements and share targets (item 6), and the reads that work
 * out where every holding stands today, what a person lacks and how a unit's branch is covered; and Kompetenssökning
 * (D121), who of the organisation holds a type, read only through the relation `registrar` by grant. A read of one
 * person's holdings, a search and its file each write a row of the read log (D108 item 15) in the transaction that
 * reads what it records.
 * A manager's reach is their reports, computed when asked (`deps.staff`, D99 item 4) and never stored, so a former
 * manager reads and writes nothing the day the line changes. Every change is one `deps.store` transaction with its
 * audit row. Audit rows carry ids, dates, counts and kinds: never a person's name, a type's name, a source's key or
 * its label.
 */
export function competenceUsecases(deps: CompetenceDeps) {
  const now = () => deps.clock();
  const admin = async (persona: AuthenticatedContext) => {
    if (!persona.capabilities.includes(COMPETENCE_ADMIN)) throw new ForbiddenError();
    await persona.authorize();
  };
  /**
   * The people who report to the persona now (`deps.staff`: D99's direct reports, D117's `managed`, never a co-manager
   * or the reader's own manager whom Personal also lists), each once, themselves and deactivated people left out.
   */
  async function reports(persona: AuthenticatedContext) {
    const staff = await deps.staff(persona);
    const people = new Map<string, StaffPerson>();
    for (const unit of staff.units)
      for (const p of unit.people)
        if (p.id !== persona.id && p.enabled !== false && !people.has(p.id)) people.set(p.id, p);
    return { manages: staff.units.length > 0, people, units: staff.units };
  }
  /**
   * Whether the reader holds the relation `registrar` by grant (D121 item 2), from their current access record. It is
   * no capability (D118): it lets the reader read competence across their organisation and decides nothing else.
   */
  const registrar = (persona: AuthenticatedContext) => !!persona.relationGrants?.includes('registrar');
  const requireRegistrar = (persona: AuthenticatedContext) => {
    if (!registrar(persona)) throw new ForbiddenError(NOT_A_REGISTRAR);
  };
  /** A row of the read log (D108 item 15, D121 item 5) for a read made now: ids, a level and a count, never a name. */
  const readOf = (
    persona: AuthenticatedContext,
    at: Date,
    relation: CompetenceReadRelation,
    read: Pick<ReadLogEntry, 'kind' | 'rows'> &
      Partial<Pick<ReadLogEntry, 'typeId' | 'minLevel' | 'unitId' | 'personId'>>,
  ): ReadLogEntry => ({
    id: deps.ids(),
    organisationId: persona.organisationId,
    readerId: persona.id,
    relation,
    kind: read.kind,
    typeId: read.typeId ?? null,
    minLevel: read.minLevel ?? null,
    unitId: read.unitId ?? null,
    personId: read.personId ?? null,
    rows: read.rows,
    readAt: at.toISOString(),
  });
  /** What a search asked for, as its read-log row and its audit row carry it: ids and a level. */
  const searched = (body: CompetenceSearchFileBody) => ({
    typeId: body.typeId,
    ...(body.minLevel !== undefined ? { minLevel: body.minLevel } : {}),
    ...(body.unitId !== undefined ? { unitId: body.unitId } : {}),
  });
  /**
   * Every person of the organisation who holds the type (D121 item 4), as narrowed, read in the transaction it is given.
   * A type of another organisation is no type; a least level is for a skill alone.
   */
  async function searchIn(tx: CompetenceTx, organisationId: string, body: CompetenceSearchFileBody, today: string) {
    const [type] = await tx.typesById([body.typeId]);
    if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
    if (body.minLevel !== undefined && !isSkill(type)) throw new CompetenceError(LEVEL_ON_SKILL_SEARCH);
    // A unit is one of the organisation's tree, or the search is refused before anything is read or logged: what the
    // body names reaches the read log and the audit only once it is known to be the organisation's own.
    const units = await tx.units(organisationId);
    if (body.unitId !== undefined && !units.some(u => u.id === body.unitId)) throw new CompetenceError(NO_UNIT);
    const holdings = await tx.holdingsOfType(type.id);
    const ids = [...new Set(holdings.map(h => h.personId))];
    const [persons, active, places] = [
      await tx.persons(ids),
      await tx.activeIds(ids),
      await tx.placesOf(organisationId, ids),
    ];
    const rows = searchRows({
      type,
      holdings,
      persons: new Map(persons.map(p => [p.id, p])),
      active,
      organisationId,
      places: new Map(places.map(p => [p.personId, p])),
      units,
      today,
      ...(body.unitId !== undefined ? { unitId: body.unitId } : {}),
      ...(body.minLevel !== undefined ? { minLevel: body.minLevel } : {}),
    });
    return { type, rows };
  }
  async function reportOf(persona: AuthenticatedContext, personId: string, notAManager = NOT_A_MANAGER) {
    const { manages, people } = await reports(persona);
    if (!manages) throw new ForbiddenError(notAManager);
    const person = people.get(personId);
    if (!person) throw new ForbiddenError(NOT_YOURS);
    return person;
  }
  /**
   * The types required of each of these people (D108 item 6): by the positions they hold, the units they are assigned
   * to and the requirements set on them alone, in their organisation; and the least level each asks of a skill (D120
   * item 4).
   */
  async function requiredFor(
    tx: CompetenceTx,
    organisationId: string,
    personIds: readonly string[],
  ): Promise<{ required: Map<string, string[]>; least: Map<string, Map<string, number>> }> {
    const required = new Map<string, string[]>(),
      least = new Map<string, Map<string, number>>();
    if (!personIds.length) return { required, least };
    const requirements = await tx.requirements(organisationId);
    if (!requirements.length) return { required, least };
    const placed = new Map((await tx.placesOf(organisationId, personIds)).map(p => [p.personId, p]));
    for (const id of personIds) {
      const place = placed.get(id) ?? { personId: id, unitIds: [], positionCodes: [] };
      required.set(id, requiredOf(place, requirements));
      least.set(id, leastLevels(place, requirements));
    }
    return { required, least };
  }
  /** Whom the reader reports to now (D99 item 4), each once, never the reader; nobody without the port. */
  const managersOf = async (persona: AuthenticatedContext) =>
    [...new Set(deps.above ? await deps.above(persona) : [])].filter(id => id !== persona.id).sort();
  /**
   * Who can decide a registration of `holder`'s own now (D108 item 7): of the people above them (`above`), those whose
   * reports include them, as `reports` counts a manager's reports and so as `decideHolding` checks it. The line upwards
   * and the reports downwards disagree where two people lead both a unit and the unit above it: each is above the other,
   * and neither is the other's report. Without `personaOf` it is `above` alone.
   */
  async function decidersOf(holder: AuthenticatedContext): Promise<string[]> {
    const candidates = await managersOf(holder);
    if (!deps.personaOf) return candidates;
    const deciders: string[] = [];
    for (const id of candidates) {
      const manager = await deps.personaOf(id);
      if (manager && (await reports(manager)).people.has(holder.id)) deciders.push(id);
    }
    return deciders;
  }
  /** The card's subject: the person who registered, by the key another system knows them by; nobody without one. */
  const subjectOf = (userName: string | null | undefined) =>
    userName && [...userName].length <= ENTITY_KEY_MAX ? { subject: { entity: 'person' as const, key: userName } } : {};
  /**
   * Make the open cards of one registration that waits (D108 item 7) match exactly the people who can decide it now
   * (`decidersOf`), in one transaction with one audit row of counts, `competence.approval_reconciled`. A card of
   * someone who can no longer decide (they no longer lead the person's line, or they left) is set aside; a decider
   * with no card gets one; a card Clew set aside opens again once its owner can decide. A card its owner put away
   * themselves, handled or dismissed, stays as they left it while they can still decide: the matrix lists what waits.
   * While the person who registered is not active, every card is set aside, and they open again when the person is
   * back and the registration still waits. Nothing to change writes nothing. Without `personaOf` nothing is done.
   */
  async function reconcileOne(actor: string, holdingId: string) {
    if (!deps.personaOf) return null;
    const found = await deps.store.transaction(tx => tx.holding(holdingId));
    const threadId = found?.threadId;
    if (!found || !awaiting(found) || !threadId) return null;
    const holder = await deps.personaOf(found.personId);
    const deciders = new Set(holder ? await decidersOf(holder) : []);
    const at = now().toISOString();
    return deps.store.transaction(async tx => {
      const holding = await tx.holding(holdingId);
      if (!holding || !awaiting(holding) || holding.threadId !== threadId) return null;
      const cards = await tx.workItems.cards(threadId);
      const owners = new Set(cards.map(c => c.personId));
      const close = cards.filter(c => c.open && !deciders.has(c.personId)).map(c => c.personId);
      const reopen = cards.filter(c => !c.open && c.setAside && deciders.has(c.personId)).map(c => c.personId);
      const open = [...deciders].filter(id => !owners.has(id)).sort();
      const changed = { opened: open.length, closed: close.length, reopened: reopen.length };
      if (!close.length && !reopen.length && !open.length) return changed;
      if (close.length) await tx.workItems.close(threadId, at, holder ? 'reassigned' : 'paused', close);
      if (reopen.length) await tx.workItems.reopen(threadId, reopen, at);
      if (open.length) {
        const [person] = await tx.persons([holding.personId]);
        await tx.workItems.open({ threadId, holdingId, managers: open, at, ...subjectOf(person?.userName) });
      }
      await tx.audit({
        actor,
        action: 'competence.approval_reconciled',
        subject: 'holding:' + holdingId,
        at,
        details: { personId: holding.personId, active: !!holder, ...changed },
      });
      return changed;
    });
  }
  /**
   * Where these people stand today: one standing per person and type held, mapped copied rows counted exactly like
   * registered ones (D108 items 4 and 9), and one `missing` standing per type required of them that they hold nothing of
   * that counts (item 6). `waiting` are the copied rows whose type is not mapped; `own` the people's own registrations
   * that wait for a decision or were rejected (item 7), which count towards nothing; `types` every type named.
   */
  async function standingsWith(
    tx: CompetenceTx,
    organisationId: string,
    personIds: readonly string[],
    today: string,
  ): Promise<{
    standings: Standing[];
    waiting: HoldingRecord[];
    own: HoldingRecord[];
    types: ReadonlyMap<string, TypeRecord>;
  }> {
    const holdings = await tx.holdingsOf(personIds);
    const { required, least } = await requiredFor(tx, organisationId, personIds);
    const typeIds = [
      ...new Set([...holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])), ...[...required.values()].flat()]),
    ];
    const types = new Map((await tx.typesById(typeIds)).map(t => [t.id, t]));
    return {
      standings: deciding(holdings, types, today, required, least),
      waiting: holdings.filter(uncounted),
      own: holdings.filter(h => h.evidence === 'self' && (h.state === 'pending' || h.state === 'rejected')),
      types,
    };
  }
  const standings = async (tx: CompetenceTx, organisationId: string, personIds: readonly string[], today: string) =>
    (await standingsWith(tx, organisationId, personIds, today)).standings;
  /**
   * What needs these people today (D108 item 12, D47), each standing that has run out, is missing or soon runs out, the
   * expired first, with the identity of the person's own card of it (`ownCard`): when the type began to be required of
   * them (`requiredSince`) and the last revocation that changed where they stand (`decidingRevocation`). The person's
   * card and the manager's alike are derived from it, so the two never disagree on what is due.
   */
  async function dueCards(tx: CompetenceTx, organisationId: string, personIds: readonly string[], today: string) {
    if (!personIds.length) return [];
    const holdings = await tx.holdingsOf(personIds);
    const requirements = await tx.requirements(organisationId);
    const placed = new Map((await tx.placesOf(organisationId, personIds)).map(p => [p.personId, p]));
    const placeOf = (id: string) => placed.get(id) ?? { personId: id, unitIds: [], positionCodes: [] };
    const applying = new Map(personIds.map(id => [id, requirementsOn(placeOf(id), requirements)]));
    const typeIds = new Set([
      ...holdings.flatMap(h => (h.typeId ? [h.typeId] : [])),
      ...[...applying.values()].flat().map(r => r.typeId),
    ]);
    const types = new Map((await tx.typesById([...typeIds])).map(t => [t.id, t]));
    const required = new Map([...applying].map(([id, rs]) => [id, [...new Set(rs.map(r => r.typeId))]]));
    const least = new Map(personIds.map(id => [id, leastLevels(placeOf(id), requirements)]));
    return deciding(holdings, types, today, required, least)
      .filter(needsAttention)
      .sort(byUrgency)
      .map(standing => ({
        standing,
        card: ownCard(standing, {
          requiredSince: requiredSince(applying.get(standing.personId) ?? [], standing.type.id),
          revoked: decidingRevocation(holdings, standing.personId, standing.type),
        }),
      }));
  }
  /**
   * How a unit's branch is covered today (D108 items 6 and 8, D99 item 5), for its manager: the active people assigned
   * to the unit or a unit below it, against the requirements that apply to each of them, and the share targets set on
   * this unit, each measured over this branch once. `reports` are the reader's own reports, whom they know; the rest of
   * the branch is counted only where it is large enough (`coverageOf`). Counts only.
   */
  async function coverageIn(
    tx: CompetenceTx,
    persona: AuthenticatedContext,
    reports: ReadonlySet<string>,
    unitId: string,
    today: string,
  ): Promise<Omit<UnitCoverageResult, 'unitId' | 'unitLabel'>> {
    const organisationId = persona.organisationId;
    const personIds = await tx.placedOn(organisationId, branchOf(await tx.units(organisationId), unitId));
    const people = await tx.placesOf(organisationId, personIds);
    const requirements = await tx.requirements(organisationId);
    const targets = (await tx.shareTargets(organisationId)).filter(t => t.unitId === unitId);
    const holdings = await tx.holdingsOf(personIds);
    const typeIds = new Set([
      ...holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])),
      ...requirements.map(r => r.typeId),
      ...targets.map(t => t.typeId),
    ]);
    const types = new Map((await tx.typesById([...typeIds])).map(t => [t.id, t]));
    const covered = coverageOf({
      people,
      reader: persona.id,
      reports,
      requirements,
      targets,
      types,
      standings: deciding(holdings, types, today),
    });
    if (!covered.targets.length) return { ...covered, targets: [] };
    const positionLabel = new Map((await tx.positions(organisationId)).map(p => [p.code, p.label]));
    return {
      ...covered,
      targets: covered.targets.map(t => ({
        ...t,
        positionLabel: positionLabel.get(t.target.positionCode) ?? t.target.positionCode,
      })),
    };
  }
  /**
   * The manager's matrix today (D108 item 11): these people, the manager's reports, against what is required of them in
   * their organisation, with the set of columns `input` names. Read in the transaction it is given.
   */
  async function matrixIn(
    tx: CompetenceTx,
    organisationId: string,
    people: readonly StaffPerson[],
    today: string,
    input: CompetenceMatrixInput,
  ): Promise<CompetenceMatrixOutput> {
    const personIds = people.map(p => p.id);
    const placed = await tx.placesOf(organisationId, personIds);
    const requirements = await tx.requirements(organisationId);
    const holdings = await tx.holdingsOf(personIds);
    const typeIds = new Set([
      ...holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])),
      ...requirements.map(r => r.typeId),
    ]);
    const types = new Map((await tx.typesById([...typeIds])).map(t => [t.id, t]));
    return matrixOf({
      people: people.map(p => ({ id: p.id, name: p.name, userName: p.userName })),
      placed,
      requirements,
      types,
      holdings,
      positions: await tx.positions(organisationId),
      units: await tx.units(organisationId),
      today,
      by: input.by,
      part: input.part,
    });
  }
  /**
   * Whether a position (by code) or a unit (by id) is one the organisation has now: a position the provisioner pushed, a
   * node of the tree as pushed, a unit nobody is placed on included.
   */
  const positionExists = async (tx: CompetenceTx, organisationId: string, code: string) =>
    (await tx.positions(organisationId)).some(p => p.code === code);
  const unitExists = async (tx: CompetenceTx, organisationId: string, unitId: string) =>
    (await tx.units(organisationId)).some(u => u.id === unitId);
  /**
   * Add a requirement as `actor` (D108 item 6). The type must be the organisation's and not archived, the position's code
   * one the organisation has and the unit one of its tree; who may set it on what is the caller's to check. A
   * requirement of a skill names the least level a confirmed holding must reach, 1 when the body names none; one of any
   * other kind names none, and a level for it is refused (D120 item 4).
   */
  async function insertRequirement(
    actor: string,
    organisationId: string,
    body: CompetenceRequirementBody,
  ): Promise<string> {
    if (body.minLevel !== undefined && !isCompetenceLevel(body.minLevel)) throw new CompetenceError(BAD_LEVEL);
    const at = now().toISOString(),
      id = deps.ids();
    try {
      return await deps.store.transaction(async tx => {
        const type = await tx.type(body.typeId);
        if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) throw new CompetenceError(ARCHIVED_REQUIREMENT);
        if (body.minLevel !== undefined && !isSkill(type)) throw new CompetenceError(LEVEL_ON_SKILL_ONLY);
        if (body.positionCode !== undefined && !(await positionExists(tx, organisationId, body.positionCode)))
          throw new CompetenceError(NO_POSITION);
        if (body.unitId !== undefined && !(await unitExists(tx, organisationId, body.unitId)))
          throw new CompetenceError(NO_UNIT);
        const record: RequirementRecord = {
          id,
          organisationId,
          typeId: type.id,
          positionCode: body.positionCode ?? null,
          unitId: body.unitId ?? null,
          personId: body.personId ?? null,
          minLevel: isSkill(type) ? (body.minLevel ?? 1) : null,
          createdBy: actor,
          createdAt: at,
        };
        await tx.insertRequirement(record);
        await tx.audit({
          actor,
          action: 'competence.requirement_added',
          subject: 'competence-requirement:' + id,
          at,
          details: requirementDetails(record),
        });
        return id;
      });
    } catch (error) {
      if (error instanceof RequirementTaken) throw new CompetenceError(REQUIREMENT_TAKEN);
      throw error;
    }
  }
  /** Add a share target as `actor` (D108 item 6): the type, the position (by code) and the unit, if any, the organisation's. */
  async function insertShareTarget(
    actor: string,
    organisationId: string,
    body: CompetenceShareTargetBody,
  ): Promise<string> {
    if (!Number.isInteger(body.minShare) || body.minShare < 1 || body.minShare > 100)
      throw new CompetenceError(BAD_SHARE);
    const at = now().toISOString(),
      id = deps.ids();
    try {
      return await deps.store.transaction(async tx => {
        const type = await tx.type(body.typeId);
        if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) throw new CompetenceError(ARCHIVED_REQUIREMENT);
        if (!(await positionExists(tx, organisationId, body.positionCode))) throw new CompetenceError(NO_POSITION);
        if (body.unitId !== undefined && !(await unitExists(tx, organisationId, body.unitId)))
          throw new CompetenceError(NO_UNIT);
        const record: ShareTargetRecord = {
          id,
          organisationId,
          typeId: type.id,
          positionCode: body.positionCode,
          unitId: body.unitId ?? null,
          minShare: body.minShare,
          createdBy: actor,
          createdAt: at,
        };
        await tx.insertShareTarget(record);
        await tx.audit({
          actor,
          action: 'competence.share_target_added',
          subject: 'competence-share-target:' + id,
          at,
          details: targetDetails(record),
        });
        return id;
      });
    } catch (error) {
      if (error instanceof ShareTargetTaken) throw new CompetenceError(TARGET_TAKEN);
      throw error;
    }
  }
  /** The name of each source a copied row came from, as it was when last read. */
  const sourceNames = async (tx: CompetenceTx) => new Map((await tx.sources()).map(s => [s.connectorId, s.source]));
  /** The sources that answer the holdings profile now; none while the module is switched off for the installation. */
  async function answering(only?: string | null): Promise<HoldingsSourceRef[]> {
    const port = deps.holdings;
    if (!port || !(await port.switchedOn())) return [];
    const all = await port.holdingsSources();
    return only ? all.filter(s => s.connectorId === only) : all;
  }
  /** Whether an organisation has anyone a source's rows may be kept for (D23); with no port, no source reaches anyone. */
  const reaches = async (connectorId: string, organisationId: string) =>
    !!deps.holdings && (await deps.holdings.reaches(connectorId, organisationId));
  /** A source's record before its first read. */
  const blankSource = (connectorId: string, source: string): SourceRecord => ({
    connectorId,
    source,
    run: null,
    claimedAt: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
    counts: null,
  });
  const leased = (s: SourceRecord | undefined, at: string) => !!s?.run && !!s.leaseUntil && s.leaseUntil > at;
  function typeFields(body: CompetenceTypePatch) {
    const patch: { name?: string; area?: string } = {};
    if (body.name !== undefined) {
      const name = normaliseName(body.name);
      if (!name) throw new CompetenceError(BAD_NAME);
      patch.name = name;
    }
    if (body.area !== undefined) {
      const area = normaliseArea(body.area);
      if (!area) throw new CompetenceError(BAD_AREA);
      patch.area = area;
    }
    return patch;
  }
  /** Add a type as `actor`; the administrator's and the operator's path share it. A skill has no validity rule (D120). */
  async function insertType(actor: string, organisationId: string, body: CompetenceTypeBody): Promise<string> {
    const { name, area } = typeFields(body);
    if (isSkill(body) && (body.validityMonths ?? null) !== null) throw new CompetenceError(SKILL_NO_VALIDITY);
    const at = now().toISOString(),
      id = deps.ids();
    try {
      return await deps.store.transaction(async tx => {
        // The catalogue first (the lock order): the count checked is the count written to, as an import's is.
        await tx.lockCatalogue(organisationId);
        if ((await tx.countTypes(organisationId)) >= COMPETENCE_CATALOGUE_MAX)
          throw new CompetenceError(CATALOGUE_FULL);
        await tx.insertType({
          id,
          organisationId,
          name: name!,
          area: area!,
          kind: body.kind,
          validityMonths: body.validityMonths ?? null,
          archivedAt: null,
          createdBy: actor,
          createdAt: at,
          sourceUri: null,
          mergedInto: null,
        });
        await tx.audit({
          actor,
          action: 'competence.type_added',
          subject: 'competence-type:' + id,
          at,
          details: { organisationId, kind: body.kind, validityMonths: body.validityMonths ?? null },
        });
        return id;
      });
    } catch (error) {
      if (error instanceof TypeNameTaken) throw new CompetenceError(NAME_TAKEN);
      throw error;
    }
  }
  /**
   * The dates of a holding to be registered (D108 items 3 and 7): real days, issued no later than today in Sweden, and no
   * end before the issue. A manager's, an operator's and a person's own registration share them.
   */
  function checkDates(body: CompetenceHoldingBody, today: string) {
    if (!isCalendarDay(body.issuedOn)) throw new CompetenceError(BAD_DAY);
    if (body.issuedOn > today)
      throw new CompetenceError('Ett intyg kan inte vara utfärdat en dag som inte har kommit.');
    if (body.expiresOn !== undefined) {
      if (!isCalendarDay(body.expiresOn)) throw new CompetenceError(BAD_DAY);
      if (body.expiresOn < body.issuedOn) throw new CompetenceError('Slutdatumet kan inte vara före utfärdandet.');
    }
  }
  /** A type a holding can be registered for in the organisation: its own, and not archived. */
  async function registrable(tx: CompetenceTx, organisationId: string, typeId: string) {
    const type = await tx.type(typeId);
    if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
    if (type.archivedAt) throw new CompetenceError(ARCHIVED);
    return type;
  }
  /**
   * A person's own registration for the reader to decide (D108 item 7): one that exists, is the person's own and belongs
   * to someone who reports to the reader now (D99 item 4). Anything else is refused in the same words, so a refusal never
   * tells whether a registration exists; one the reader may decide that is no longer waiting is said to be decided.
   */
  async function decidable(persona: AuthenticatedContext, holdingId: string) {
    const refused = () => new ForbiddenError(NOT_YOURS_TO_DECIDE);
    const found = await deps.store.transaction(tx => tx.holding(holdingId));
    if (!found || found.evidence !== 'self' || found.typeId === null) throw refused();
    const person = (await reports(persona)).people.get(found.personId);
    if (!person) throw refused();
    if (found.state !== 'pending') throw new CompetenceError(DECIDED);
    return { found, person, refused };
  }
  /** Register a holding for `personId` as `actor`; the manager's and the operator's path share the checks on the type and the dates. */
  async function insertHolding(
    actor: string,
    registeredBy: string | null,
    organisationId: string,
    personId: string,
    body: CompetenceHoldingBody,
  ): Promise<string> {
    const at = now(),
      iso = at.toISOString();
    checkDates(body, swedishDay(at));
    const id = deps.ids();
    return deps.store.transaction(async tx => {
      const type = await registrable(tx, organisationId, body.typeId);
      if (isSkill(type)) throw new CompetenceError(SKILL_NOT_DATED);
      await tx.insertHolding({
        ...registered,
        id,
        personId,
        typeId: type.id,
        issuedOn: body.issuedOn,
        expiresOn: body.expiresOn ?? null,
        evidence: 'manager',
        state: 'valid',
        registeredBy,
        createdAt: iso,
      });
      await tx.audit({
        actor,
        action: 'competence.holding_registered',
        subject: 'holding:' + id,
        at: iso,
        details: { personId, typeId: type.id, issuedOn: body.issuedOn, expiresOn: body.expiresOn ?? null },
      });
      return id;
    });
  }
  /** The skill of this type the person holds that counts (D120 item 1): one at most, which rating again changes. */
  const liveSkill = async (tx: CompetenceTx, personId: string, typeId: string) =>
    (await tx.holdingsOf([personId])).find(h => h.typeId === typeId && h.level !== null && counts(h));
  /** A skill type a holding can be registered for in the organisation: its own, not archived, and of kind `skill`. */
  async function skillType(tx: CompetenceTx, organisationId: string, typeId: string) {
    const type = await registrable(tx, organisationId, typeId);
    if (!isSkill(type)) throw new CompetenceError(SKILL_ONLY);
    return type;
  }
  /**
   * A skill stored for `personId` at `level` (D120 item 2): confirmed at once by a manager (`by`, the manager; null for
   * an operator's), or, `by` undefined, the person's own rating, as the development seed writes both. One per person
   * and type: a second is refused. Audited `competence.skill_registered` (confirmed) or `competence.skill_rated`.
   */
  async function insertSkill(
    actor: string,
    organisationId: string,
    personId: string,
    body: CompetenceSkillBody & { interest?: boolean },
    by: string | null | undefined,
  ): Promise<string> {
    if (!isCompetenceLevel(body.level)) throw new CompetenceError(BAD_LEVEL);
    const at = now(),
      iso = at.toISOString(),
      id = deps.ids();
    const own = by === undefined;
    try {
      return await deps.store.transaction(async tx => {
        const type = await skillType(tx, organisationId, body.typeId);
        if (await liveSkill(tx, personId, type.id)) throw new CompetenceError(own ? SKILL_TAKEN : SKILL_HELD);
        await tx.insertHolding({
          ...registered,
          id,
          personId,
          typeId: type.id,
          issuedOn: swedishDay(at),
          expiresOn: null,
          evidence: own ? 'self' : 'manager',
          state: 'valid',
          registeredBy: own ? personId : by,
          createdAt: iso,
          level: body.level,
          interest: body.interest ?? false,
          validatedBy: own ? null : by,
          validatedAt: own ? null : iso,
          ratedAt: iso,
        });
        await tx.audit({
          actor,
          action: own ? 'competence.skill_rated' : 'competence.skill_registered',
          subject: 'holding:' + id,
          at: iso,
          details: own
            ? { personId, typeId: type.id, level: body.level, levelBefore: null }
            : { personId, typeId: type.id, level: body.level },
        });
        return id;
      });
    } catch (error) {
      if (error instanceof SkillTaken) throw new CompetenceError(own ? SKILL_TAKEN : SKILL_HELD);
      throw error;
    }
  }
  /**
   * A skill held by someone who reports to the reader now (D99 item 4), for the reader to confirm (D120 item 2): one
   * that exists, is a skill that counts, and is not the reader's own. Anything else is refused in the same words, so a
   * refusal never tells whether it exists.
   */
  async function confirmable(persona: AuthenticatedContext, holdingId: string) {
    const refused = () => new ForbiddenError(NOT_YOURS_TO_VALIDATE);
    const found = await deps.store.transaction(tx => tx.holding(holdingId));
    if (!found || found.level === null || !counts(found) || found.typeId === null) throw refused();
    const person = (await reports(persona)).people.get(found.personId);
    if (!person || person.id === persona.id) throw refused();
    return { found, person, refused };
  }

  /**
   * Read one source to the end and copy what it holds (D108 item 9), under a lease on the source so two runs never read
   * it at once; the same run may take its own lease again, which is how a run the engine recovers after a restart goes
   * on. Nothing is read while the module is switched off, which is asked again for each source.
   *
   * Each page is taken in as it comes. Its keys are matched to active people by user name; a key that matches nobody is
   * counted and what it holds dropped there, and so is what the source holds for a person outside the source
   * connector's audience or the competence module's own (D23, `HoldingsPort.admitted`). The read holds only the usable
   * holdings of the people it may keep rows for and the source's row ids, at most `COPY_HOLDINGS_MAX` holdings.
   *
   * A page that does not answer is handled by its error kind (`SourceReadError`): the same page is asked again twice
   * after a pause when the source is unavailable, the sweep starts again from the first page once when the source no
   * longer knows the cursor, and anything else stops the read. A read that stops keeps what it read, revokes nothing and
   * is recorded as failed; the next run reads the source again. Everything the read changes is written in one
   * transaction with the run's one audit row of counts; a write that fails changes nothing, is recorded as failed with
   * its kind (`storage`) and lets go of the source. Logs and audit rows carry kinds and counts, never a source's words.
   */
  async function copySource(
    actor: string,
    run: string,
    ref: HoldingsSourceRef,
    options: { signal?: AbortSignal } = {},
  ): Promise<CopyResult> {
    const port = deps.holdings;
    const connectorId = ref.connectorId;
    const signal = options.signal;
    if (!port) return { connectorId, outcome: 'busy' };
    // Switched off meanwhile: the sources a run listed before are not read.
    if (!(await port.switchedOn())) return { connectorId, outcome: 'off' };
    const claimed = await deps.store.transaction(async tx => {
      const at = now(),
        iso = at.toISOString();
      const current = await tx.source(connectorId);
      if (leased(current, iso) && current!.run !== run) return false;
      const base = current ?? blankSource(connectorId, ref.source);
      await tx.putSource({
        ...base,
        source: ref.source,
        run,
        claimedAt: base.run === run && base.claimedAt ? base.claimedAt : iso,
        leaseUntil: leaseUntil(at),
      });
      return true;
    });
    if (!claimed) return { connectorId, outcome: 'busy' };
    /** Renew the lease between pages; false when another run has taken the source since. */
    const renew = () =>
      deps.store.transaction(async tx => {
        const current = await tx.source(connectorId);
        if (!current || current.run !== run) return false;
        await tx.putSource({ ...current, leaseUntil: leaseUntil(now()) });
        return true;
      });
    /** Who of these people the source's rows may be kept for, asked a thousand at a time. */
    const admitted = async (personIds: readonly string[]) => {
      const inside = new Set<string>();
      for (let i = 0; i < personIds.length; i += 1000)
        for (const id of await port.admitted(connectorId, personIds.slice(i, i + 1000))) inside.add(id);
      return inside;
    };

    const today = swedishDay(now());
    /** What one sweep from the first page has gathered; a sweep started again gives all of it back. */
    const sweep = () => ({
      /** Every row id the source answered, for people Clew matched or not: what is not here may be withdrawn. */
      seen: new Set<string>(),
      /** The usable holdings of the people the source's rows may be kept for. */
      matched: [] as ReadHolding[],
      /** Each key seen, lower case, and the active person it matched, null for nobody. */
      keys: new Map<string, PersonRef | null>(),
      /** The people matched, and whether the source's rows may be kept for them. */
      admitted: new Map<string, boolean>(),
      /** Per organisation: holdings read and unusable for the people admitted, and the people outside. */
      byOrganisation: new Map<string, { read: number; invalid: number; outside: number }>(),
      cursors: new Set<string>(),
      read: 0,
      invalid: 0,
      pages: 0,
      partial: false,
      withdrawals: true,
    });
    let got = sweep();
    const tally = (organisationId: string) => {
      let t = got.byOrganisation.get(organisationId);
      if (!t) got.byOrganisation.set(organisationId, (t = { read: 0, invalid: 0, outside: 0 }));
      return t;
    };
    /** Take one page in: match its new keys and their audiences, keep the usable holdings of those admitted. */
    const take = async (rows: readonly SourceHoldingsRow[]) => {
      // A key Postgres cannot hold or compare (a control character, a lone surrogate) is no key: its holdings are unusable.
      const keyOf = (row: SourceHoldingsRow) =>
        typeof row?.key === 'string' && row.key.length >= 1 && row.key.length <= SOURCE_KEY_MAX && safeText(row.key)
          ? row.key.toLowerCase()
          : '';
      const fresh = [...new Set(rows.map(keyOf).filter(k => k && !got.keys.has(k)))];
      if (fresh.length) {
        const people = await deps.store.transaction(tx => tx.activeByUserName(fresh));
        const byName = new Map(people.flatMap(p => (p.userName ? [[p.userName.toLowerCase(), p] as const] : [])));
        for (const k of fresh) got.keys.set(k, byName.get(k) ?? null);
        const newcomers = people.filter(p => !got.admitted.has(p.id));
        const inside = await admitted(newcomers.map(p => p.id));
        for (const p of newcomers) {
          got.admitted.set(p.id, inside.has(p.id));
          if (!inside.has(p.id)) tally(p.organisationId).outside++;
        }
      }
      for (const row of rows) {
        if (row?.partial) got.partial = true;
        const key = keyOf(row);
        const person = key ? got.keys.get(key) : undefined;
        for (const holding of Array.isArray(row?.holdings) ? row.holdings : []) {
          got.read++;
          if (typeof holding?.id === 'string' && holding.id) got.seen.add(holding.id);
          // A key that matches nobody, or a person outside an audience: counted, neither kept nor looked at.
          if (person === null || (person && !got.admitted.get(person.id))) continue;
          const usable = person ? usableHolding(holding, today) : undefined;
          if (person) tally(person.organisationId).read++;
          if (!person || !usable) {
            got.invalid++;
            if (person) tally(person.organisationId).invalid++;
          } else got.matched.push({ personId: person.id, organisationId: person.organisationId, holding: usable });
        }
      }
    };
    const stop = (failure: string) => {
      deps.log?.(
        `competence: the read of a source stopped (${failure}); what was read is kept and it is read again at the next run`,
        { connector: connectorId, pages: got.pages },
      );
      return failure;
    };
    let failure: string | null = null;
    let outcome: CompetenceReadOutcome = 'complete';
    const blank = (): CompetenceReadCounts => ({
      read: 0,
      stored: 0,
      unchanged: 0,
      invalid: 0,
      unmapped: 0,
      revoked: 0,
      outside: 0,
      removed: 0,
    });
    /** The counts of the read, the whole and per organisation; what was written is added where the write says it. */
    const counting = () => {
      const organisations: Record<string, CompetenceReadCounts> = {};
      const of = (organisationId: string | undefined) =>
        organisationId === undefined ? undefined : (organisations[organisationId] ??= blank());
      for (const [organisationId, t] of got.byOrganisation)
        Object.assign(of(organisationId)!, { read: t.read, invalid: t.invalid, outside: t.outside });
      const total: CompetenceReadCounts = {
        ...blank(),
        read: got.read,
        invalid: got.invalid,
        outside: [...got.admitted.values()].filter(a => !a).length,
      };
      const unmatched = [...got.keys.values()].filter(p => p === null).length;
      return { total, organisations, of, unmatched };
    };
    const finish = async (tx: CompetenceTx, current: SourceRecord, at: string, counts: SourceReadCounts) => {
      await tx.putSource({
        ...current,
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: current.claimedAt ?? at,
        finishedAt: at,
        outcome,
        counts,
      });
      await tx.audit({
        actor,
        action: 'competence.source_read',
        subject: 'connector:' + connectorId,
        at,
        details: {
          run,
          outcome,
          ...(failure ? { failure } : {}),
          pages: got.pages,
          unmatched: counts.unmatched,
          ...counts.total,
        },
      });
    };
    /**
     * Something of Clew's own failed while the source was read or what it answered was written (the database, the
     * directory behind the audiences): the copy is as it was, the read is recorded as failed with the kind `storage` and
     * the source let go of, so the next run reads it again rather than wait for the lease to lapse.
     */
    const failedHere = async (error: unknown, during: 'read' | 'write') => {
      const code = (error as { code?: unknown } | null)?.code;
      deps.log?.(
        during === 'write'
          ? 'competence: what a source answered could not be written; the copy is unchanged'
          : "competence: a source's read failed on Clew's side; the copy is unchanged",
        {
          connector: connectorId,
          failure: 'storage',
          ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { code } : {}),
        },
      );
      failure = 'storage';
      outcome = 'failed';
      return deps.store.transaction(async (tx): Promise<CopyResult> => {
        const at = now().toISOString();
        const current = await tx.source(connectorId);
        if (!current || current.run !== run) return { connectorId, outcome: 'busy' };
        const { total, organisations, unmatched } = counting();
        await finish(tx, current, at, { unmatched, total, organisations });
        return { connectorId, outcome, counts: total, unmatched };
      });
    };

    let keep: (personId: string) => boolean;
    let holders: string[];
    try {
      let cursor: string | undefined;
      let restarted = false,
        retries = 0;
      for (;;) {
        if (signal?.aborted) {
          failure = stop('cancelled');
          break;
        }
        let page: SourceHoldingsPage;
        try {
          page = await port.readHoldings(connectorId, cursor, signal ? { signal } : {});
        } catch (error) {
          const code = sourceReadError(error);
          if (signal?.aborted) {
            failure = stop('cancelled');
            break;
          }
          if (code === 'invalid' && cursor !== undefined && !restarted) {
            // The source no longer knows the cursor: one sweep from the first page, then a second refusal stops the read.
            restarted = true;
            got = sweep();
            cursor = undefined;
            deps.log?.('competence: a source refused its cursor; the read starts again from the first page', {
              connector: connectorId,
            });
            continue;
          }
          if (code === 'unavailable' && retries < UNAVAILABLE_PAUSES_MS.length) {
            await deps.pause?.(UNAVAILABLE_PAUSES_MS[retries++]!);
            if (!(await renew())) return { connectorId, outcome: 'busy' };
            continue;
          }
          failure = stop(code ?? 'unknown');
          break;
        }
        retries = 0;
        got.pages++;
        got.withdrawals &&= page.withdrawalsReported === true;
        await take(page.rows ?? []);
        if (got.read > COPY_HOLDINGS_MAX) {
          failure = stop('too-large');
          break;
        }
        if (!page.next) break;
        if (got.cursors.has(page.next) || got.pages >= PAGES_MAX) {
          failure = stop('endless');
          break;
        }
        got.cursors.add(page.next);
        cursor = page.next;
        if (!(await renew())) return { connectorId, outcome: 'busy' };
      }
      // The people who already have rows of the source and may no longer have them: outside an audience or deactivated.
      holders = await deps.store.transaction(tx => tx.copiedPeople(connectorId));
      const known = new Set(got.admitted.keys());
      const asked = await admitted(holders.filter(id => !known.has(id)));
      keep = (personId: string) => got.admitted.get(personId) ?? asked.has(personId);
    } catch (error) {
      return failedHere(error, 'read');
    }
    const { seen, matched, partial, withdrawals } = got;
    outcome = failure ? 'failed' : partial ? 'partial' : 'complete';
    try {
      return await deps.store.transaction(async (tx): Promise<CopyResult> => {
        const at = now().toISOString();
        // The source's row first, as a mapping, an erasure and forgetting the source take it, and as removing the
        // connector does through its cascade. Gone or taken by another run: nothing is written.
        const current = await tx.source(connectorId);
        if (!current || current.run !== run) return { connectorId, outcome: 'busy' };
        const mapped = new Map(
          (await tx.mappingsOf(connectorId)).map(m => [m.organisationId + '\n' + m.sourceType, m]),
        );
        const existing = await tx.copiedFrom(connectorId);
        // Checked again under the lock: a person deactivated (and perhaps erased) since the page was read gets nothing.
        const active = await tx.activeIds([...new Set([...matched.map(m => m.personId), ...holders])]);
        const removed = existing.filter(h => !active.has(h.personId) || !keep(h.personId));
        const gone = new Set(removed.map(h => h.id));
        const plan = planCopy({
          connectorId,
          existing: existing.filter(h => !gone.has(h.id)),
          read: matched.filter(m => active.has(m.personId)),
          seen,
          mapping: (organisationId, sourceType) => mapped.get(organisationId + '\n' + sourceType)?.typeId ?? null,
          // Only a complete read of a source that reports withdrawals says a missing row is gone (item 9).
          revokeAbsent: outcome === 'complete' && withdrawals,
          at,
          newId: deps.ids,
        });
        await tx.removeCopied(
          connectorId,
          removed.map(h => h.id),
        );
        await tx.putCopied(plan.write);
        await tx.touchCopied(connectorId, plan.touch, at);
        // Each row's organisation: from the read, else from its person.
        const organisationOf = new Map(matched.map(m => [m.personId, m.organisationId]));
        const unknown = [...new Set([...removed, ...plan.revoked].map(h => h.personId))].filter(
          id => !organisationOf.has(id),
        );
        for (let i = 0; i < unknown.length; i += 1000)
          for (const p of await tx.persons(unknown.slice(i, i + 1000))) organisationOf.set(p.id, p.organisationId);
        const { total, organisations, of, unmatched } = counting();
        const add = (key: keyof CompetenceReadCounts, organisationId: string | undefined, n = 1) => {
          total[key] += n;
          const o = of(organisationId);
          if (o) o[key] += n;
        };
        for (const r of plan.stored) add('stored', r.organisationId);
        for (const r of plan.unchanged) add('unchanged', r.organisationId);
        for (const h of plan.revoked) add('revoked', organisationOf.get(h.personId));
        for (const h of removed) add('removed', organisationOf.get(h.personId));
        for (const [organisationId, types] of plan.unmapped) add('unmapped', organisationId, types.size);
        await finish(tx, current, at, { unmatched, total, organisations });
        return { connectorId, outcome, counts: total, unmatched };
      });
    } catch (error) {
      // What the source answered could not be written (a value the database refuses, the database itself).
      return failedHere(error, 'write');
    }
  }

  /** The refusals of a merge of `from` into `into` (D108 item 2), the preview's and the merge's alike. */
  function mergeRefusal(
    organisationId: string,
    fromId: string,
    from: TypeRecord | undefined,
    into: TypeRecord | undefined,
  ): asserts from is TypeRecord {
    if (into?.id === fromId) throw new CompetenceError(MERGE_SELF);
    if (!from || from.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
    if (from.mergedInto !== null) throw new CompetenceError(MERGED_ALREADY);
    if (!into || into.organisationId !== organisationId) throw new CompetenceError(MERGE_NO_TARGET);
    if (into.mergedInto !== null) throw new CompetenceError(MERGE_INTO_MERGED);
    if (into.archivedAt !== null) throw new CompetenceError(MERGE_INTO_ARCHIVED);
    if (isSkill(from) !== isSkill(into)) throw new CompetenceError(MERGE_KINDS);
  }
  /**
   * What a merge of `fromId` into `intoId` reads, as its plan (`mergePlan`) and the figures an administrator may be shown
   * of it (`mergeFigures`). With `lock`, in the lock order of `CompetenceTx`: every source's row (a copy writes copied
   * rows, and a mapping maps, under its source's lock), then the two types in the order of their ids, then every holding
   * of both in the order of theirs; the mappings are read once, under those locks, so every mapping the merge moves has
   * its source locked. Without `lock` (the preview, a GET) nothing is locked and the same is read as it stands.
   */
  async function mergeRead(tx: CompetenceTx, organisationId: string, fromId: string, intoId: string, lock: boolean) {
    if (fromId === intoId) throw new CompetenceError(MERGE_SELF);
    let from: TypeRecord | undefined, into: TypeRecord | undefined;
    if (lock) {
      await tx.lockSources();
      const locked = new Map<string, TypeRecord | undefined>();
      for (const id of [fromId, intoId].sort()) locked.set(id, await tx.type(id));
      [from, into] = [locked.get(fromId), locked.get(intoId)];
    } else {
      const found = new Map((await tx.typesById([fromId, intoId])).map(t => [t.id, t]));
      [from, into] = [found.get(fromId), found.get(intoId)];
    }
    mergeRefusal(organisationId, fromId, from, into);
    const target = into!;
    const held = lock
      ? await tx.lockHoldingsOfTypes([from.id, target.id])
      : [...(await tx.holdingsOfType(from.id)), ...(await tx.holdingsOfType(target.id))];
    const fromHoldings = held.filter(h => h.typeId === from.id),
      intoHoldings = held.filter(h => h.typeId === target.id);
    const requirements = await tx.requirements(organisationId);
    const plan = mergePlan({
      from,
      into: target,
      fromHoldings,
      intoHoldings,
      requirements,
      shareTargets: await tx.shareTargets(organisationId),
      mappings: await tx.mappings(organisationId),
    });
    const active = await tx.activeIds([...new Set(held.map(h => h.personId))]);
    const figures = mergeFigures({
      plan,
      fromHoldings,
      intoHoldings,
      requirements,
      active,
      sameRule: (from.validityMonths ?? null) === (target.validityMonths ?? null),
    });
    return { from, into: target, plan, figures };
  }

  /**
   * Map a source's type to a catalogue type for an organisation, or remove the mapping (D108 item 9), and re-type the
   * rows already copied with it in the same transaction. The administrator's and the operator's path share it.
   */
  async function setMapping(
    actor: string,
    organisationId: string,
    connectorId: string,
    body: CompetenceMappingBody,
    knownSourceOnly: boolean,
  ): Promise<{ holdings: number }> {
    const sourceType = body.sourceType;
    if (!sourceType || sourceType.length > SOURCE_ID_MAX) throw new CompetenceError(BAD_SOURCE_TYPE);
    // An administrator maps only a source their organisation has someone in the audience of (D23); else it is unknown.
    if (knownSourceOnly && !(await reaches(connectorId, organisationId))) throw new CompetenceError(NO_SOURCE);
    const answers = knownSourceOnly ? (await answering(connectorId)).length > 0 : true;
    const at = now().toISOString();
    return deps.store.transaction(async tx => {
      // The source's row is locked first, as the copy's write locks it, so a mapping and a read's write never interleave.
      const record = await tx.source(connectorId);
      if (!answers && !record) throw new CompetenceError(NO_SOURCE);
      if (body.typeId !== null) {
        const type = await tx.type(body.typeId);
        if (!type || type.organisationId !== organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) throw new CompetenceError(ARCHIVED_MAPPING);
        // A copied row has no level (D120): a source's type is never a skill.
        if (isSkill(type)) throw new CompetenceError(SKILL_UNMAPPABLE);
      }
      const before = (await tx.mappings(organisationId, connectorId)).find(m => m.sourceType === sourceType);
      if ((before?.typeId ?? null) === body.typeId) return { holdings: 0 };
      if (body.typeId === null) await tx.removeMapping(connectorId, organisationId, sourceType);
      else
        await tx.putMapping({
          connectorId,
          organisationId,
          sourceType,
          typeId: body.typeId,
          mappedBy: actor,
          mappedAt: at,
        });
      const holdings = await tx.retypeCopied(connectorId, organisationId, sourceType, body.typeId);
      await tx.audit({
        actor,
        action: body.typeId === null ? 'competence.source_unmapped' : 'competence.source_mapped',
        subject: 'connector:' + connectorId,
        at,
        details: { organisationId, sourceType, typeBefore: before?.typeId ?? null, typeAfter: body.typeId, holdings },
      });
      return { holdings };
    });
  }

  return {
    /**
     * The catalogue (D108 item 2). An administrator of it reads every type, archived ones included; a manager reads the
     * ones a certificate can be registered for; anyone else is refused, which the catalogue's page says.
     */
    async types(persona: AuthenticatedContext): Promise<{ rows: CompetenceType[] }> {
      const isAdmin = persona.capabilities.includes(COMPETENCE_ADMIN);
      if (!isAdmin && !(await reports(persona)).manages) throw new ForbiddenError();
      const rows = await deps.store.transaction(tx => tx.types(persona.organisationId, { archived: isAdmin }));
      return { rows: orderTypes(rows).map(typeRow) };
    },

    /**
     * The types a person may register one of their own for (D108 item 7): every type of their organisation that is not
     * archived, for anyone. The routes read nothing while the module is off for the person.
     */
    async ownTypes(persona: AuthenticatedContext): Promise<{ rows: CompetenceType[] }> {
      const rows = await deps.store.transaction(tx => tx.types(persona.organisationId));
      return { rows: orderTypes(rows).map(typeRow) };
    },

    /** An administrator adds a type to the catalogue. Returns its id. */
    async addType(persona: AuthenticatedContext, body: CompetenceTypeBody): Promise<string> {
      await admin(persona);
      return insertType(persona.principal.id, persona.organisationId, body);
    },
    /** An operator adds a type for an organisation, as the development seed does. `actor` is the operator's. */
    seedType: (actor: string, organisationId: string, body: CompetenceTypeBody) =>
      insertType(actor, organisationId, body),

    /**
     * What a new validity would do to the holdings counted from this type's rule (D108 item 3): how many there are and
     * how many are expired today under the current rule and under the new one. Nothing is written.
     */
    async validityImpact(
      persona: AuthenticatedContext,
      typeId: string,
      validityMonths: number | null,
    ): Promise<CompetenceValidityImpact> {
      await admin(persona);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        // A read: nothing is locked.
        const [type] = await tx.typesById([typeId]);
        if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
        const ruled = (await tx.holdingsOfType(typeId)).filter(h => counts(h) && h.expiresOn === null);
        const expired = (months: number | null) =>
          ruled.filter(h => statusOn(endOf(h, { validityMonths: months }), today) === 'expired').length;
        return {
          holdings: ruled.length,
          expiredBefore: expired(type.validityMonths),
          expiredAfter: expired(validityMonths),
        };
      });
    },

    /**
     * An administrator changes a type: its name, area, kind or the employer's validity. A new validity applies at once
     * to every holding counted from the rule (D108 item 3); `validityImpact` says what that does before this is called.
     * A skill has no validity rule, and a type becomes a skill, or stops being one, only while nothing is held of it,
     * nothing requires it and no source's type is mapped to it (D120 item 1): a holding's dates and level, a
     * requirement's least level and a copied row's lack of one belong to one kind or the other.
     */
    async updateType(persona: AuthenticatedContext, typeId: string, body: CompetenceTypePatch): Promise<void> {
      await admin(persona);
      const patch: Partial<TypeRecord> = { ...typeFields(body) };
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.validityMonths !== undefined) patch.validityMonths = body.validityMonths;
      const at = now().toISOString();
      try {
        await deps.store.transaction(async tx => {
          const type = await tx.type(typeId);
          if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
          if (type.mergedInto !== null) throw new CompetenceError(MERGED_LOCKED);
          const changed = (Object.keys(patch) as Array<keyof typeof patch>).filter(key => patch[key] !== type[key]);
          if (!changed.length) return;
          const after = { ...type, ...patch };
          if (isSkill(after) && after.validityMonths !== null) throw new CompetenceError(SKILL_NO_VALIDITY);
          if (isSkill(after) !== isSkill(type)) {
            const held = (await tx.holdingsOfType(typeId)).length > 0;
            const required = (await tx.requirements(type.organisationId)).some(r => r.typeId === typeId);
            if (held || required) throw new CompetenceError(KIND_LOCKED);
            // A source's type mapped to it brings copied rows, which have no level (D108 item 9).
            if ((await tx.mappings(type.organisationId)).some(m => m.typeId === typeId))
              throw new CompetenceError(KIND_MAPPED);
          }
          await tx.updateType(typeId, patch);
          await tx.audit({
            actor: persona.principal.id,
            action: 'competence.type_changed',
            subject: 'competence-type:' + typeId,
            at,
            details: {
              changed: changed.sort(),
              ...(changed.includes('validityMonths')
                ? { validityBefore: type.validityMonths, validityAfter: patch.validityMonths ?? null }
                : {}),
            },
          });
        });
      } catch (error) {
        if (error instanceof TypeNameTaken) throw new CompetenceError(NAME_TAKEN);
        throw error;
      }
    },

    /** An administrator archives a type: it takes no new holdings and keeps the ones it has. Archiving twice is one. */
    async archiveType(persona: AuthenticatedContext, typeId: string): Promise<void> {
      await admin(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const type = await tx.type(typeId);
        if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
        if (type.archivedAt) return;
        await tx.updateType(typeId, { archivedAt: at });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.type_archived',
          subject: 'competence-type:' + typeId,
          at,
        });
      });
    },

    /**
     * An administrator brings an archived type back (D108 item 2): it takes holdings again. A type that was merged into
     * another is refused, since a merge is not undone; one that is not archived is left as it is, and nothing is written.
     * A name another type now has is refused.
     */
    async restoreType(persona: AuthenticatedContext, typeId: string): Promise<void> {
      await admin(persona);
      const at = now().toISOString();
      try {
        await deps.store.transaction(async tx => {
          const type = await tx.type(typeId);
          if (!type || type.organisationId !== persona.organisationId) throw new CompetenceError(NO_TYPE);
          if (type.mergedInto !== null) throw new CompetenceError(MERGED_FOR_GOOD);
          if (type.archivedAt === null) return;
          await tx.updateType(typeId, { archivedAt: null });
          await tx.audit({
            actor: persona.principal.id,
            action: 'competence.type_restored',
            subject: 'competence-type:' + typeId,
            at,
          });
        });
      } catch (error) {
        if (error instanceof TypeNameTaken) throw new CompetenceError(RESTORE_NAME_TAKEN);
        throw error;
      }
    },

    /**
     * What merging one type into another would move (D108 item 2), in counts, for the administrator to confirm, as an
     * administrator may be shown them (`mergeFigures`: nothing of a person's own registration, of a requirement on one
     * person or of a deactivated person, and a count of people or holdings below five said as fewer). Nothing is written
     * and nothing locked: it is a GET. Refused as the merge itself would be, except for registrations waiting for both,
     * which it says are there.
     */
    async mergePreview(persona: AuthenticatedContext, fromId: string, intoId: string): Promise<CompetenceMergePreview> {
      await admin(persona);
      return deps.store.transaction(
        async tx => (await mergeRead(tx, persona.organisationId, fromId, intoId, false)).figures,
      );
    },

    /**
     * An administrator merges one type into another of the same organisation (D108 item 2), in one transaction with
     * one audit row of counts: every holding of it, whatever its state, is re-pointed, so no history is lost; where a
     * person holds a skill of both, the one that decides is kept and the other set aside (revoked), its interest mark
     * carried over; requirements, share targets and the sources' mappings move, and a requirement or a share target the
     * other type already has for the same target is folded into it, the stricter kept. The type is then archived with
     * `mergedInto` set, and keeps its address, so an import never adds it again. Refused into itself, into an archived
     * or a merged type, between a skill and any other kind, from a type already merged, and while a person has a
     * registration of their own waiting for both (one waits per person and type). The cards of the type merged away
     * (`competence:due:<type>`, `competence:missing:<type>`) are not touched here: the next scan no longer observes them
     * and resolves them, and observes the other type's in their place (D47). Everything is read under the locks of
     * `mergeRead`, so a confirmation or a change of a skill that commits first is what the merge decides from, and one
     * that comes after waits for it. The audit row counts what the writes did, exactly; what is answered is what moved as
     * the preview counts it for an administrator (`mergeFigures`).
     */
    async mergeTypes(
      persona: AuthenticatedContext,
      fromId: string,
      body: CompetenceMergeBody,
    ): Promise<CompetenceMergePreview> {
      await admin(persona);
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const { from, into, plan, figures } = await mergeRead(tx, persona.organisationId, fromId, body.into, true);
        if (plan.waiting.length) throw new CompetenceError(WAITING_BOTH);
        const done = {
          holdings: 0,
          skillsSetAside: 0,
          requirements: 0,
          requirementsFolded: 0,
          shareTargets: 0,
          shareTargetsFolded: 0,
          mappings: 0,
        };
        // A skill set aside first: one skill of a type counts per person, and the kept one may be the one re-pointed.
        for (const id of plan.revoke)
          if (await tx.updateHolding(id, { state: 'revoked', revokedAt: at, revokedBy: null })) done.skillsSetAside++;
        for (const id of plan.interest) await tx.updateHolding(id, { interest: true });
        done.holdings = await tx.retypeHoldings(plan.retype, into.id);
        for (const f of plan.requirements.fold)
          if (await tx.removeRequirement(f.remove)) {
            await tx.updateRequirement(f.keep, { minLevel: f.minLevel });
            done.requirementsFolded++;
          }
        for (const id of plan.requirements.retype)
          if (await tx.updateRequirement(id, { typeId: into.id })) done.requirements++;
        done.requirements += done.requirementsFolded;
        for (const f of plan.shareTargets.fold)
          if (await tx.removeShareTarget(f.remove)) {
            await tx.updateShareTarget(f.keep, { minShare: f.minShare });
            done.shareTargetsFolded++;
          }
        for (const id of plan.shareTargets.retype)
          if (await tx.updateShareTarget(id, { typeId: into.id })) done.shareTargets++;
        done.shareTargets += done.shareTargetsFolded;
        done.mappings = await tx.retypeMappings(persona.organisationId, from.id, into.id);
        await tx.updateType(from.id, { archivedAt: from.archivedAt ?? at, mergedInto: into.id });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.type_merged',
          subject: 'competence-type:' + from.id,
          at,
          details: {
            organisationId: persona.organisationId,
            into: into.id,
            ...done,
            people: plan.people,
            ruled: plan.ruled,
          },
        });
        return figures;
      });
    },

    /**
     * An administrator imports chosen rows of a file into the catalogue (D120 item 7), at most
     * `COMPETENCE_IMPORT_REQUEST_MAX` a request. Every row is checked again with the rule the page read the file with
     * (`competenceImportRowProblem`); one that fails refuses the request and names its row. A row the catalogue holds
     * already, by its address or its name (`importPlan`), or one the request named before, is skipped, so a part sent
     * again changes nothing. An area is a type's word, so a row's area that no type has yet comes into being with it.
     * The catalogue keeps at most `COMPETENCE_CATALOGUE_MAX` types. One transaction, one audit row of counts with the
     * file's format, never a name.
     */
    async importTypes(persona: AuthenticatedContext, body: CompetenceImportBody): Promise<CompetenceImportOutcome> {
      await admin(persona);
      const rows: ImportRow[] = body.rows.map(r => {
        const problem = competenceImportRowProblem(r);
        if (problem) throw new CompetenceError(`Rad ${r.row}: ${problem}`);
        if (body.format === 'esco' && (r.kind !== 'skill' || r.uri === null))
          throw new CompetenceError(`Rad ${r.row}: ${ESCO_ROW}`);
        return {
          name: importText(r.name),
          area: importText(r.area),
          kind: r.kind,
          validityMonths: r.validityMonths,
          uri: r.uri,
        };
      });
      const at = now().toISOString(),
        organisationId = persona.organisationId,
        actor = persona.principal.id;
      return deps.store.transaction(async tx => {
        // The catalogue first (the lock order): imports and adds of one organisation follow each other, so the count
        // checked against the limit is the count written to.
        await tx.lockCatalogue(organisationId);
        const existing = await tx.types(organisationId, { archived: true });
        const { add } = importPlan(existing, rows);
        if (existing.length + add.length > COMPETENCE_CATALOGUE_MAX) throw new CompetenceError(CATALOGUE_FULL);
        // The store has the last word on what is taken: a row its own comparison finds taken is left out, not refused.
        const inserted = await tx.insertTypes(
          add.map(r => ({
            id: deps.ids(),
            organisationId,
            name: r.name,
            area: r.area,
            kind: r.kind,
            validityMonths: r.validityMonths,
            archivedAt: null,
            createdBy: actor,
            createdAt: at,
            sourceUri: r.uri,
            mergedInto: null,
          })),
        );
        const added = inserted.length,
          skipped = rows.length - added;
        await tx.audit({
          actor,
          action: 'competence.types_imported',
          subject: 'organisation:' + organisationId,
          at,
          details: { organisationId, format: body.format, rows: rows.length, added, skipped },
        });
        return { added, skipped };
      });
    },

    /**
     * The manager a person reports to registers a certificate for them (D108 item 7): the type, the day it was issued
     * and, where the issuer set one, its end date. Returns the holding's id.
     */
    async registerHolding(
      persona: AuthenticatedContext,
      personId: string,
      body: CompetenceHoldingBody,
    ): Promise<string> {
      await reportOf(persona, personId);
      return insertHolding(persona.principal.id, persona.id, persona.organisationId, personId, body);
    },
    /** An operator registers a holding for a person of an organisation, as the development seed does. */
    seedHolding: (actor: string, organisationId: string, personId: string, body: CompetenceHoldingBody) =>
      insertHolding(actor, null, organisationId, personId, body),

    /**
     * The manager a person reports to registers a skill for them at a level (D120 item 2): stored confirmed at once,
     * evidence `manager`, with the manager as the one who confirmed it, and audited `competence.skill_registered`. A
     * skill the person holds already is refused: its level is confirmed instead (`validateSkill`). Returns its id.
     */
    async registerSkill(persona: AuthenticatedContext, personId: string, body: CompetenceSkillBody): Promise<string> {
      if (!isCompetenceLevel(body.level)) throw new CompetenceError(BAD_LEVEL);
      await reportOf(persona, personId);
      return insertSkill(persona.principal.id, persona.organisationId, personId, body, persona.id);
    },
    /**
     * An operator stores a skill for a person of an organisation, as the development seed does: the person's own rating,
     * or (`confirmed`) one confirmed with nobody named as having confirmed it.
     */
    seedSkill: (
      actor: string,
      organisationId: string,
      personId: string,
      body: CompetenceSkillBody & { interest?: boolean; confirmed?: boolean },
    ) => insertSkill(actor, organisationId, personId, body, body.confirmed ? null : undefined),

    /**
     * A person adds a skill of their own (D120 items 2 and 3): a skill type of the catalogue, the level and whether they
     * want to develop it. It is stored at once with evidence `self` and listed at once to whoever may read their holdings,
     * marked as their own rating; it opens no work item and waits for nothing, since a self-rating meets no requirement
     * until the manager they report to confirms it. A skill they hold already is refused: it is changed instead
     * (`changeOwnSkill`), and two adds of one skill at once are kept apart by the store (`SkillTaken`). Audited
     * `competence.skill_rated` with the ids and the level. Returns the holding's id.
     */
    async rateOwnSkill(persona: AuthenticatedContext, body: CompetenceSkillRatingBody): Promise<string> {
      if (!isCompetenceLevel(body.level)) throw new CompetenceError(BAD_LEVEL);
      return insertSkill(persona.principal.id, persona.organisationId, persona.id, body, undefined);
    },

    /**
     * A person changes a skill of their own (D120 items 2 and 3), by its holding: its level and whether they want to
     * develop it. A new level makes it their own rating again from now (`ratedAt`): the confirmation goes, and so does a
     * manager's registration; the interest mark alone changes nothing else, and the same again writes nothing. The row is
     * read locked, so two changes at once follow each other and each one's audit row says the level it changed from.
     * One that is not the person's skill that counts is refused in the same words; one of an archived type is refused as
     * a registration is. Audited `competence.skill_rated` with the ids and the levels.
     */
    async changeOwnSkill(
      persona: AuthenticatedContext,
      holdingId: string,
      body: CompetenceSkillChangeBody,
    ): Promise<void> {
      if (!isCompetenceLevel(body.level)) throw new CompetenceError(BAD_LEVEL);
      const at = now(),
        iso = at.toISOString();
      await deps.store.transaction(async tx => {
        // The type before the holding (the lock order of `CompetenceTx`): its type is learnt unlocked, locked, and the
        // holding then read locked; a merge that re-pointed it meanwhile is followed to the type it went into.
        let held: HoldingRecord | undefined;
        for (let tries = 0; tries < 3; tries++) {
          const seen = (await tx.holdingsOf([persona.id])).find(h => h.id === holdingId);
          if (!seen?.typeId) break;
          await tx.type(seen.typeId);
          held = await tx.holding(holdingId);
          if (!held || held.typeId === seen.typeId) break;
        }
        if (!held || held.personId !== persona.id || held.level === null || !counts(held) || held.typeId === null)
          throw new ForbiddenError(NOT_YOUR_SKILL);
        // Locked already above; a type merged away is refused here as an archived one is.
        const type = await skillType(tx, persona.organisationId, held.typeId);
        const interest = body.interest === true;
        const relevelled = held.level !== body.level;
        if (!relevelled && held.interest === interest) return;
        await tx.updateHolding(held.id, {
          interest,
          ...(relevelled
            ? {
                level: body.level,
                evidence: 'self' as const,
                registeredBy: persona.id,
                issuedOn: swedishDay(at),
                ratedAt: iso,
                validatedBy: null,
                validatedAt: null,
              }
            : {}),
        });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.skill_rated',
          subject: 'holding:' + held.id,
          at: iso,
          details: { personId: persona.id, typeId: type.id, level: body.level, levelBefore: held.level },
        });
      });
    },

    /**
     * A person removes a skill of their own (D120 item 2), whoever rated or confirmed it, since a skill is what the person
     * says they can do: it is revoked as any holding is, by them, so it stays as a row, counts towards nothing and leaves
     * their lists, and they may add it again. Audited `competence.skill_removed` with the ids and the level. One that is
     * not theirs, or is no skill that counts, is refused in the same words.
     */
    async removeOwnSkill(persona: AuthenticatedContext, holdingId: string): Promise<void> {
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        if (!holding || holding.personId !== persona.id || holding.level === null || !counts(holding) || holding.copy)
          throw new ForbiddenError(NOT_YOUR_SKILL);
        await tx.updateHolding(holdingId, { state: 'revoked', revokedAt: at, revokedBy: persona.id });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.skill_removed',
          subject: 'holding:' + holdingId,
          at,
          details: { personId: persona.id, typeId: holding.typeId, level: holding.level },
        });
      });
    },

    /**
     * A skill as the manager a person reports to confirms it (D120 item 2): who holds it, which skill, its level and
     * whether it is confirmed already. Only for a manager the person reports to now, never the person themselves;
     * anything else is refused as the confirmation is.
     */
    async skillValidation(persona: AuthenticatedContext, holdingId: string): Promise<CompetenceSkillValidation> {
      const { found, person, refused } = await confirmable(persona, holdingId);
      const [type] = await deps.store.transaction(tx => tx.typesById([found.typeId!]));
      const level = levelOf(found);
      if (!type || level === undefined) throw refused();
      return {
        holdingId: found.id,
        personId: person.id,
        name: person.name,
        typeId: type.id,
        competence: type.name,
        area: type.area,
        level,
        validated: confirmed(found),
        interest: found.interest,
      };
    },

    /**
     * The manager a person reports to now confirms a skill's level, or sets another (D120 item 2): who and when are
     * stored, and from then the skill meets a requirement that asks for no more than its level. Confirming again, or
     * another of the person's managers confirming it, stores who and when anew. The person themselves never confirms
     * their own, even where they manage a unit, and a former manager confirms nothing. Audited
     * `competence.skill_validated` with the level before and after.
     */
    async validateSkill(
      persona: AuthenticatedContext,
      holdingId: string,
      body: CompetenceValidationBody = {},
    ): Promise<void> {
      if (body.level !== undefined && !isCompetenceLevel(body.level)) throw new CompetenceError(BAD_LEVEL);
      const { found, refused } = await confirmable(persona, holdingId);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        if (!holding || holding.personId !== found.personId || holding.level === null || !counts(holding))
          throw refused();
        const level = body.level ?? holding.level;
        await tx.updateHolding(holdingId, { level, validatedBy: persona.id, validatedAt: at });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.skill_validated',
          subject: 'holding:' + holdingId,
          at,
          details: {
            personId: holding.personId,
            typeId: holding.typeId,
            levelBefore: holding.level,
            levelAfter: level,
          },
        });
      });
    },

    /**
     * The manager a person reports to now takes back a holding registered in Clew, an approved one of the person's own
     * included: it stays as a row, marked revoked, and counts towards nothing. Revoking twice is one. A registration that
     * waits or was rejected is no holding to revoke (D108 item 7). Of a skill (D120 item 2) only one a manager registered
     * is: one the person rated, confirmed or not, is theirs to remove (`removeOwnSkill`).
     */
    async revokeHolding(persona: AuthenticatedContext, holdingId: string): Promise<void> {
      const { people } = await reports(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        // A copied row is its source's; a person's own registration that waits or was rejected is decided, not revoked.
        if (
          !holding ||
          !people.has(holding.personId) ||
          holding.evidence === 'system' ||
          holding.state === 'pending' ||
          holding.state === 'rejected'
        )
          throw new ForbiddenError(NOT_ALLOWED);
        if (!revocable(holding)) throw new ForbiddenError(NOT_REVOCABLE_SKILL);
        if (holding.state === 'revoked') return;
        await tx.updateHolding(holdingId, { state: 'revoked', revokedAt: at, revokedBy: persona.id });
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.holding_revoked',
          subject: 'holding:' + holdingId,
          at,
          details: { personId: holding.personId, typeId: holding.typeId },
        });
      });
    },

    /**
     * A person registers a holding of their own (D108 item 7): a type of the catalogue, the day it was issued and, where
     * the issuer set one, the day it ends, checked as a manager's registration is. It is stored `pending` with evidence
     * `self` and counts towards nothing until the manager the person reports to approves it. Its approval is a card in
     * the stream of each manager who can decide it now (`decidersOf`: the people whose reports include the person, D99
     * item 4), opened in the same transaction; any one of them deciding closes every card, and the daily reconciliation
     * keeps the cards with whoever can decide it as the line changes. Someone nobody can decide for is refused (who
     * approves then is open in D108). A second registration of the same type waiting for the same person is refused.
     * Returns its id.
     */
    async registerOwn(persona: AuthenticatedContext, body: CompetenceHoldingBody): Promise<string> {
      const at = now(),
        iso = at.toISOString();
      checkDates(body, swedishDay(at));
      const managers = await decidersOf(persona);
      if (!managers.length) throw new CompetenceError(NO_APPROVER);
      const id = deps.ids(),
        threadId = deps.ids();
      try {
        return await deps.store.transaction(async tx => {
          const type = await registrable(tx, persona.organisationId, body.typeId);
          // A skill is rated, not registered with dates for approval (D120 item 2).
          if (isSkill(type)) throw new CompetenceError(SKILL_NOT_DATED);
          await tx.insertHolding({
            ...registered,
            id,
            personId: persona.id,
            typeId: type.id,
            issuedOn: body.issuedOn,
            expiresOn: body.expiresOn ?? null,
            evidence: 'self',
            state: 'pending',
            registeredBy: persona.id,
            createdAt: iso,
            threadId,
          });
          // The cards are about the person (D97 item 6), by the key another system knows them by; nobody without one.
          const [self] = await tx.persons([persona.id]);
          await tx.workItems.open({ threadId, holdingId: id, managers, at: iso, ...subjectOf(self?.userName) });
          await tx.audit({
            actor: persona.principal.id,
            action: 'competence.holding_submitted',
            subject: 'holding:' + id,
            at: iso,
            details: {
              personId: persona.id,
              typeId: type.id,
              issuedOn: body.issuedOn,
              expiresOn: body.expiresOn ?? null,
              managers,
            },
          });
          return id;
        });
      } catch (error) {
        if (error instanceof PendingTaken) throw new CompetenceError(PENDING_TAKEN);
        throw error;
      }
    },

    /**
     * What the reader's own registration needs (D108 item 7): whether anyone would decide it, and the registrations of
     * theirs that wait for a decision, oldest first; and the skills they hold (D120), each with its level, whether a
     * manager confirmed it, the interest mark and, where a requirement asks for more than it meets, the least level asked.
     */
    async ownRegistrations(persona: AuthenticatedContext): Promise<CompetenceOwnOutput> {
      const approver = (await decidersOf(persona)).length > 0;
      return deps.store.transaction(async tx => {
        const holdings = await tx.holdingsOf([persona.id]);
        const own = holdings.filter(awaiting);
        const turnedDown = holdings.filter(h => h.evidence === 'self' && h.state === 'rejected');
        const skills = holdings.filter(h => h.level !== null && counts(h));
        const types = new Map(
          (
            await tx.typesById([
              ...new Set([...own, ...turnedDown, ...skills].flatMap(h => (h.typeId ? [h.typeId] : []))),
            ])
          ).map(t => [t.id, t]),
        );
        const listed = (rows: HoldingRecord[]) =>
          rows.flatMap(h => {
            const type = h.typeId ? types.get(h.typeId) : undefined;
            if (!type) return [];
            const end = endOf(h, type);
            return [
              {
                holdingId: h.id,
                typeId: type.id,
                competence: type.name,
                issuedOn: h.issuedOn,
                ...(end ? { expiresOn: end } : {}),
              },
            ];
          });
        const pending = listed(own);
        const rejected = listed(turnedDown);
        // The reader's skills (D120), each with the least level a requirement asks where it does not reach it.
        const { required, least } = skills.length
          ? await requiredFor(tx, persona.organisationId, [persona.id])
          : { required: new Map<string, string[]>(), least: new Map<string, Map<string, number>>() };
        const asked = new Set(required.get(persona.id) ?? []);
        const rated = skills.flatMap((h): CompetenceOwnSkill[] => {
          const type = h.typeId ? types.get(h.typeId) : undefined;
          const level = levelOf(h);
          if (!type || level === undefined) return [];
          const leastLevel = least.get(persona.id)?.get(type.id) ?? 1;
          const short =
            asked.has(type.id) &&
            type.archivedAt === null &&
            !reachesLevel(h, type, leastLevel) &&
            isCompetenceLevel(leastLevel)
              ? { short: leastLevel }
              : {};
          return [
            {
              holdingId: h.id,
              typeId: type.id,
              competence: type.name,
              area: type.area,
              level,
              validated: confirmed(h),
              interest: h.interest,
              ...short,
            },
          ];
        });
        return { approver, pending, rejected, skills: rated.sort(bySkillName) };
      });
    },

    /**
     * A registration of a person's own as the manager who decides it reads it (D108 item 7): who registered it, the
     * competence and the dates, the end worked out as for any holding. Only while it waits, and only for a manager the
     * person reports to now; anything else is refused as the decision is.
     */
    async approval(persona: AuthenticatedContext, holdingId: string): Promise<CompetenceApproval> {
      const { found, person, refused } = await decidable(persona, holdingId);
      const [type] = await deps.store.transaction(tx => tx.typesById([found.typeId!]));
      if (!type) throw refused();
      const end = endOf(found, type);
      return {
        holdingId: found.id,
        personId: person.id,
        key: personKey(person),
        name: person.name,
        typeId: type.id,
        competence: type.name,
        area: type.area,
        issuedOn: found.issuedOn,
        ...(end ? { expiresOn: end } : {}),
        registeredAt: found.createdAt,
      };
    },

    /**
     * The manager a person reports to now decides their own registration (D108 item 7): `approve` makes it `valid`, with
     * evidence still `self` and the manager's attestation in `decidedBy` and `decidedAt`, and from then it counts like any
     * holding; `reject` makes it `rejected`, which counts towards nothing and is listed to the person alone. Either closes
     * every card of the approval in the same transaction. Only while it waits: deciding twice, or one taken back, is
     * refused. A former manager decides nothing; a manager the person reports to since decides it from the matrix's
     * list of what waits. Before the decision the cards are reconciled with who can decide now (`reconcileOne`), so a
     * former manager's card says it went elsewhere rather than how it was decided; that write failing never keeps the
     * decision from being made.
     */
    async decideHolding(persona: AuthenticatedContext, holdingId: string, decision: CompetenceDecision): Promise<void> {
      const { found, refused } = await decidable(persona, holdingId);
      try {
        await reconcileOne(RECONCILE_ACTOR, holdingId);
      } catch (error) {
        deps.log?.('competence: the cards of an approval could not be reconciled before its decision', {
          code: (error as { code?: unknown } | null)?.code ?? null,
        });
      }
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        if (!holding || holding.personId !== found.personId) throw refused();
        if (holding.state !== 'pending') throw new CompetenceError(DECIDED);
        const approve = decision === 'approve';
        await tx.updateHolding(holdingId, {
          state: approve ? 'valid' : 'rejected',
          decidedBy: persona.id,
          decidedAt: at,
        });
        if (holding.threadId) await tx.workItems.close(holding.threadId, at, approve ? 'approved' : 'rejected');
        await tx.audit({
          actor: persona.principal.id,
          action: approve ? 'competence.holding_approved' : 'competence.holding_rejected',
          subject: 'holding:' + holdingId,
          at,
          details: { personId: holding.personId, typeId: holding.typeId },
        });
      });
    },

    /**
     * A person takes back their own registration while it waits (D108 item 7). The row is removed, since it was never
     * attested and counted towards nothing, and every card of its approval is closed in the same transaction; the audit
     * row keeps that it was. One that is decided, or not the person's own, is refused.
     */
    async withdrawOwn(persona: AuthenticatedContext, holdingId: string): Promise<void> {
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        if (!holding || holding.personId !== persona.id || holding.evidence !== 'self')
          throw new ForbiddenError(NOT_YOUR_OWN);
        if (holding.state !== 'pending') throw new CompetenceError(DECIDED_OWN);
        await tx.deleteHolding(holdingId);
        if (holding.threadId) await tx.workItems.close(holding.threadId, at, 'withdrawn');
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.holding_withdrawn',
          subject: 'holding:' + holdingId,
          at,
          details: { personId: holding.personId, typeId: holding.typeId },
        });
      });
    },

    /**
     * A person removes their own registration that their manager rejected (D108 item 7): it was never attested, counts
     * towards nothing and is theirs alone to see, so the row goes; the audit row keeps that it was. Nobody else may, and
     * one that waits or was approved is refused.
     */
    async removeRejected(persona: AuthenticatedContext, holdingId: string): Promise<void> {
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const holding = await tx.holding(holdingId);
        if (!holding || holding.personId !== persona.id || holding.evidence !== 'self')
          throw new ForbiddenError(NOT_YOUR_OWN);
        if (holding.state !== 'rejected') throw new CompetenceError(NOT_REJECTED);
        await tx.deleteHolding(holdingId);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.holding_removed',
          subject: 'holding:' + holdingId,
          at,
          details: { personId: holding.personId, typeId: holding.typeId },
        });
      });
    },

    /**
     * Make the cards of every registration that waits match the people who can decide it now (D108 item 7,
     * `reconcileOne`), each registration in a transaction of its own. Run each day by the competence module's workflow;
     * one registration that fails is logged and left for the next run while the others are reconciled. Nothing is done
     * while the module is switched off for the installation. Returns counts.
     */
    async reconcileApprovals(actor: string = RECONCILE_ACTOR) {
      const total = { registrations: 0, changed: 0, opened: 0, closed: 0, reopened: 0, failed: 0 };
      if (!deps.personaOf) return total;
      if (deps.holdings && !(await deps.holdings.switchedOn())) return total;
      const waiting = await deps.store.transaction(tx => tx.waitingRegistrations());
      for (const h of waiting) {
        total.registrations++;
        try {
          const changed = await reconcileOne(actor, h.id);
          if (changed && changed.opened + changed.closed + changed.reopened > 0) {
            total.changed++;
            total.opened += changed.opened;
            total.closed += changed.closed;
            total.reopened += changed.reopened;
          }
        } catch (error) {
          total.failed++;
          deps.log?.('competence: the cards of an approval could not be reconciled; the next run tries again', {
            code: (error as { code?: unknown } | null)?.code ?? null,
          });
        }
      }
      return total;
    },
    /** The reconciliation of one registration's cards (D108 item 7), as the daily run and a decision make it. */
    reconcileApproval: (holdingId: string, actor: string = RECONCILE_ACTOR) => reconcileOne(actor, holdingId),

    /**
     * `competence.holdings`. With `person` (a user name, or the id of a person provisioned without one): what that
     * report holds, for the manager they report to; or, for a reader who holds the relation `registrar` (D121) and whom
     * the registry resolved so (`told`, which it says only on the person's own direct read of this core read), what any
     * active person of the reader's organisation holds, by user name. Without: the reader's own. For each type the
     * holding that decides, a copied one with its source and when it was read; a type required of the person that they
     * hold nothing of as a `missing` row (D108 item 6); the person's own registrations that wait for a decision
     * (`awaiting-approval`) and, to the person alone, those that were rejected (item 7); after them the copied rows
     * whose type is not mapped, under the source's own label and marked as counting towards nothing (item 9).
     *
     * A registrar reads less (the decision of 2026-11-13): only the holdings that count, with where each stands, and a
     * skill's level with "Egen bedömning" where no manager has confirmed it (`countingRows`): no requirement the person
     * lacks, no registration of their own that waits or was rejected, no copied row of a type not mapped, no "Vill
     * utveckla". A manager's and a registrar's read writes its row of the read log (D121 item 5), in the transaction
     * that reads it; the person's own read discloses nothing and writes none.
     */
    async holdings(
      persona: AuthenticatedContext,
      input: CompetenceHoldingsInput = {},
      told?: Relation,
    ): Promise<CompetenceHoldingsOutput> {
      let personId = persona.id,
        relation: 'self' | CompetenceReadRelation = 'self';
      const self = await deps.store.transaction(tx => tx.persons([persona.id]));
      // The reader's own key is the reader: a row about them opens their own list.
      if (input.person !== undefined && !(self[0] && personKey(self[0]) === input.person)) {
        const { manages, people } = await reports(persona);
        const found = [...people.values()].find(p => personKey(p) === input.person);
        if (found) {
          personId = found.id;
          relation = 'managed';
        } else if (registrar(persona) && told === 'registrar') {
          // D121 items 1 and 4: anyone active of the reader's own organisation, by user name, for a registrar. The
          // registry said `registrar` (the person's own direct read of this core read); the grant is checked here again.
          const [other] = await deps.store.transaction(tx => tx.activeByUserName([input.person!]));
          if (!other || other.organisationId !== persona.organisationId) throw new ForbiddenError(NOT_YOURS);
          personId = other.id;
          relation = 'registrar';
        } else throw new ForbiddenError(manages ? NOT_YOURS : NOT_A_MANAGER);
      }
      const at = now(),
        today = swedishDay(at);
      return deps.store.transaction(async tx => {
        const [person] = await tx.persons([personId]);
        if (!person) return { rows: [] };
        const names = await sourceNames(tx);
        let rows: CompetenceHoldingsOutput['rows'];
        if (relation === 'registrar') {
          const holdings = await tx.holdingsOf([personId]);
          const typeIds = [...new Set(holdings.flatMap(h => (h.typeId === null ? [] : [h.typeId])))];
          const types = new Map((await tx.typesById(typeIds)).map(t => [t.id, t]));
          rows = countingRows(holdings, types, person, today, names).slice(0, 500);
        } else {
          const {
            standings: held,
            waiting,
            own,
            types,
          } = await standingsWith(tx, persona.organisationId, [personId], today);
          // A rejection is the person's to see, nobody else's (item 7).
          const mine = personId === persona.id;
          const registered = own.flatMap(h => {
            const type = h.typeId ? types.get(h.typeId) : undefined;
            return type && (h.state === 'pending' || mine) ? [ownRow(h, type, person)] : [];
          });
          rows = orderHoldingRows([
            ...held.map(s => holdingRow(s, person, names)),
            ...registered,
            ...waiting.map(h => uncountedRow(h, person, names)),
          ]).slice(0, 500);
        }
        // D108 item 15, D121 item 5: another person's competence opened, by whom and as which relation, in the
        // transaction that read it, so the answer is not given unless the row is written.
        if (relation !== 'self')
          await tx.logRead(readOf(persona, at, relation, { kind: 'person', personId, rows: rows.length }));
        return { rows };
      });
    },

    /**
     * What Kompetenssökning narrows by (D121 item 4): the organisation's units, by name in Swedish order. Asked first by
     * the page, so it is also how the page learns whether the reader holds the relation: anyone else is refused.
     */
    async searchOptions(persona: AuthenticatedContext): Promise<CompetenceSearchOptions> {
      requireRegistrar(persona);
      const tree = await deps.store.transaction(tx => tx.units(persona.organisationId));
      const labelOf = new Map(tree.map(u => [u.id, u.label]));
      return {
        units: tree
          .map(u => ({ id: u.id, label: u.label, parentLabel: (u.parentId && labelOf.get(u.parentId)) || null }))
          .sort((a, b) => a.label.localeCompare(b.label, 'sv') || a.id.localeCompare(b.id)),
      };
    },

    /**
     * The type field of the search (D121 item 4): the types of the reader's organisation that are not archived whose name
     * or area holds every word typed, at most `COMPETENCE_TYPE_SEARCH_MAX`, by name. Asked in a body, so the words are
     * in no address. The catalogue names nobody, so anyone the module is on for may ask it, as `ownTypes` is.
     */
    async findTypes(
      persona: AuthenticatedContext,
      body: CompetenceTypeSearchBody,
    ): Promise<CompetenceTypeSearchOutput> {
      const words = typeSearchWords(body.text);
      const rows = await deps.store.transaction(tx =>
        tx.findTypes(persona.organisationId, words, COMPETENCE_TYPE_SEARCH_MAX + 1),
      );
      return {
        rows: rows.slice(0, COMPETENCE_TYPE_SEARCH_MAX).map(typeRow),
        more: rows.length > COMPETENCE_TYPE_SEARCH_MAX,
      };
    },

    /**
     * Kompetenssökning (D121 item 4): one page of the people of the reader's organisation who hold a type, through the
     * relation `registrar` alone, by name in Swedish order (`searchRows`). A page past the end answers with the last.
     * Read in one transaction with its row of the read log (D121 item 5): the type, the least level and the unit asked
     * for, and how many people the page named; a read whose row cannot be written answers nothing.
     */
    async search(persona: AuthenticatedContext, body: CompetenceSearchBody): Promise<CompetenceSearchPage> {
      requireRegistrar(persona);
      const pageSize = body.pageSize ?? COMPETENCE_SEARCH_PAGE_SIZES[0];
      const at = now();
      return deps.store.transaction(async tx => {
        const { type, rows } = await searchIn(tx, persona.organisationId, body, swedishDay(at));
        const page = pageOfRows(rows, body.page ?? 1, pageSize);
        await tx.logRead(
          readOf(persona, at, 'registrar', { kind: 'search', ...searched(body), rows: page.rows.length }),
        );
        return {
          type: { id: type.id, name: type.name, area: type.area, kind: type.kind },
          rows: page.rows,
          total: rows.length,
          page: page.page,
          pageSize,
        };
      });
    },

    /**
     * The whole result of a search as a file (D121 item 4), with the matrix's writer (`csvFile`, which keeps a value a
     * spreadsheet would read as a formula as text). Audited as an export (`competence.search_exported`, ids and counts)
     * and written to the read log, both in the transaction that reads it.
     */
    async exportSearch(
      persona: AuthenticatedContext,
      body: CompetenceSearchFileBody,
    ): Promise<{ filename: string; text: string }> {
      requireRegistrar(persona);
      const at = now(),
        today = swedishDay(at);
      return deps.store.transaction(async tx => {
        const { type, rows } = await searchIn(tx, persona.organisationId, body, today);
        await tx.logRead(readOf(persona, at, 'registrar', { kind: 'export', ...searched(body), rows: rows.length }));
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.search_exported',
          subject: 'organisation:' + persona.organisationId,
          at: at.toISOString(),
          details: { ...searched(body), people: rows.length },
        });
        return { filename: `kompetenssokning-${today}.csv`, text: searchCsv(type, rows) };
      });
    },

    /**
     * The read log as an operator reads it (`scripts/competence-read-log.ts`), the newest first. Writes nothing: reading
     * the log is an operator's matter, outside the product (D121 asks for no page).
     */
    readLog: (query: ReadLogQuery) => deps.store.transaction(tx => tx.readLog(query)),

    /**
     * What `competence.person` answers (D97): for each asked person who reports to the reader, by their user name
     * without regard to case, how many of their holdings have run out, how many required types they lack, how many soon
     * run out and how many count. A person with no holding has a row too, since it is where a first certificate is
     * registered from. A key that is nobody the reader manages has no row, and is never a refusal.
     */
    async aboutPeople(
      persona: AuthenticatedContext,
      keys: readonly string[],
    ): Promise<{ rows: Array<{ key: string } & PersonSummary> }> {
      const { people } = await reports(persona);
      const byUserName = new Map(
        [...people.values()].flatMap(p => (p.userName ? [[p.userName.toLowerCase(), p.id] as const] : [])),
      );
      const asked = [...new Set(keys)].flatMap(key => {
        const id = byUserName.get(key.toLowerCase());
        return id ? [{ key, id }] : [];
      });
      if (!asked.length) return { rows: [] };
      const today = swedishDay(now());
      const all = await deps.store.transaction(tx =>
        standings(
          tx,
          persona.organisationId,
          asked.map(a => a.id),
          today,
        ),
      );
      return {
        rows: asked.map(a => ({ key: a.key, ...summarise(all.filter(s => s.personId === a.id)) })),
      };
    },

    /**
     * `competence.attention` (D108 items 6 and 11): what has expired, is missing or expires within 90 days among the
     * manager's reports, the expired first.
     */
    async attention(persona: AuthenticatedContext): Promise<CompetenceAttentionOutput> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const due = (await standings(tx, persona.organisationId, [...people.keys()], today)).filter(needsAttention);
        const persons = new Map((await tx.persons([...new Set(due.map(s => s.personId))])).map(p => [p.id, p]));
        const names = await sourceNames(tx);
        const rows = due.flatMap(s => {
          const person = persons.get(s.personId);
          return person ? [holdingRow(s, person, names)] : [];
        });
        return { rows: orderHoldingRows(rows).slice(0, 500) };
      });
    },

    /**
     * The area's figure and the manager's card: how many holdings among the reports have expired, how many required
     * types they lack and how many holdings expire within 90 days, and how many people that is. Null for someone who
     * manages nobody.
     */
    async summary(
      persona: AuthenticatedContext,
    ): Promise<{ expired: number; missing: number; expiring: number; people: number; reports: number } | null> {
      const { manages, people } = await reports(persona);
      if (!manages) return null;
      const today = swedishDay(now());
      const due = (
        await deps.store.transaction(tx => standings(tx, persona.organisationId, [...people.keys()], today))
      ).filter(needsAttention);
      return {
        expired: due.filter(s => s.status === 'expired').length,
        missing: due.filter(s => s.status === 'missing').length,
        expiring: due.filter(s => s.status === 'expiring').length,
        people: new Set(due.map(s => s.personId)).size,
        reports: people.size,
      };
    },

    /**
     * What the reader's own card says: their holdings that have expired or expire within 90 days and the required types
     * they lack, the expired first, then the missing, then the expiring, each the soonest first.
     */
    async ownAttention(persona: AuthenticatedContext): Promise<Standing[]> {
      const today = swedishDay(now());
      const due = (
        await deps.store.transaction(tx => standings(tx, persona.organisationId, [persona.id], today))
      ).filter(needsAttention);
      return due.sort(byUrgency);
    },

    /**
     * What the scan reads (D108 item 12, D47): when it read, the reader's own standings to act on (`ownAttention`), and,
     * for a manager, what is due among their reports, one entry per person and type with its status and end, from which
     * the manager's one card is counted and its occurrences named. Never stored: the scan derives it each time.
     */
    async scanOf(persona: AuthenticatedContext, manager: boolean) {
      const at = now(),
        today = swedishDay(at),
        org = persona.organisationId;
      // Everything is read before anything is said: a store or a staff port that fails throws, and the scan is then
      // no observation at all, never a complete one with nothing in it.
      const own = await deps.store.transaction(tx => dueCards(tx, org, [persona.id], today));
      let team: { expired: number; missing: number; expiring: number; people: number; card: CardIdentity } | null =
        null;
      if (manager) {
        const { manages, people } = await reports(persona);
        if (manages) {
          const due = await deps.store.transaction(tx => dueCards(tx, org, [...people.keys()], today));
          const count = (status: Standing['status']) => due.filter(d => d.standing.status === status).length;
          const [expired, missing, expiring] = [count('expired'), count('missing'), count('expiring')];
          team = {
            expired,
            missing,
            expiring,
            people: new Set(due.map(d => d.standing.personId)).size,
            // The set of things due, each by its person's own identity of it, never stored as it is (D108 item 12).
            card: teamCard(
              { toActOn: expired + missing, expiring },
              due.map(d => [d.standing.personId, d.card.key, d.card.period].join('\n')),
              deps.digest,
            ),
          };
        }
      }
      return { observedAt: at.toISOString(), own, team };
    },

    /**
     * Administration › Kompetens › Krav (D108 item 6): the requirements set on positions and units, and the positions and
     * units of the organisation they can be set on. A requirement set on one person is their manager's, not the
     * administrator's (D118), and is not listed here. Behind the capability and the step-up.
     */
    async requirements(persona: AuthenticatedContext): Promise<CompetenceRequirementsOutput> {
      await admin(persona);
      return deps.store.transaction(async tx => {
        const org = persona.organisationId;
        const [rows, positions, units] = [await tx.requirements(org), await tx.positions(org), await tx.units(org)];
        const positionLabel = new Map(positions.map(p => [p.code, p.label])),
          unitLabel = new Map(units.map(u => [u.id, u.label]));
        // A position or a unit that is gone keeps its requirement, which counts towards nothing until it comes back, and
        // is listed by its key and marked, so an administrator can remove it. A skill's requirement says its least level.
        const on = (
          r: RequirementRecord,
          kind: 'position' | 'unit',
          key: string,
          label: string | undefined,
        ): CompetenceRequirement => ({
          id: r.id,
          typeId: r.typeId,
          on: kind,
          targetId: key,
          targetLabel: label ?? key,
          ...(isCompetenceLevel(r.minLevel) ? { minLevel: r.minLevel } : {}),
          ...(label === undefined ? { gone: true as const } : {}),
        });
        const listed = rows.flatMap((r): CompetenceRequirement[] =>
          r.positionCode !== null
            ? [on(r, 'position', r.positionCode, positionLabel.get(r.positionCode))]
            : r.unitId !== null
              ? [on(r, 'unit', r.unitId, unitLabel.get(r.unitId))]
              : [],
        );
        return {
          rows: listed.sort(
            (a, b) =>
              a.on.localeCompare(b.on) ||
              a.targetLabel.localeCompare(b.targetLabel, 'sv') ||
              a.targetId.localeCompare(b.targetId) ||
              a.id.localeCompare(b.id),
          ),
          positions: positions.map(p => ({ code: p.code, label: p.label })),
          units: units.map(u => ({ id: u.id, label: u.label })),
        };
      });
    },

    /**
     * Add a requirement (D108 item 6) for exactly one of a position or a unit, as an administrator with the capability
     * and the step-up, or one person, as the manager that person reports to (never as an administrator, D118). One
     * requirement per type and target; the same again is refused. A requirement of a skill names its least level, 1 by
     * default; a level on any other kind is refused (D120 item 4). Returns its id.
     */
    async addRequirement(persona: AuthenticatedContext, body: CompetenceRequirementBody): Promise<string> {
      const named = [body.positionCode, body.unitId, body.personId].filter(v => v !== undefined);
      if (named.length !== 1) throw new CompetenceError(ONE_TARGET);
      if (body.personId !== undefined) await reportOf(persona, body.personId, NOT_THEIR_MANAGER);
      else await admin(persona);
      return insertRequirement(persona.principal.id, persona.organisationId, body);
    },
    /** An operator adds a requirement for an organisation, as the development seed does. `actor` is the operator's. */
    seedRequirement: (actor: string, organisationId: string, body: CompetenceRequirementBody) =>
      insertRequirement(actor, organisationId, body),

    /**
     * Remove a requirement (D108 item 6): one on a position or a unit as an administrator, one on a person as the manager
     * that person reports to now, whoever set it. An id that is unknown, of another organisation or not the reader's to
     * remove is refused in the same words, so a refusal never tells whether a requirement exists. Audited with the keys
     * it carried.
     */
    async removeRequirement(persona: AuthenticatedContext, requirementId: string): Promise<void> {
      const found = await deps.store.transaction(tx => tx.requirement(requirementId));
      const refused = () => new ForbiddenError(NOT_YOUR_REQUIREMENT);
      if (!found || found.organisationId !== persona.organisationId) throw refused();
      if (found.personId !== null) {
        if (!(await reports(persona)).people.has(found.personId)) throw refused();
      } else {
        if (!persona.capabilities.includes(COMPETENCE_ADMIN)) throw refused();
        await persona.authorize();
      }
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const current = await tx.requirement(requirementId);
        if (!current) return;
        await tx.removeRequirement(requirementId);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.requirement_removed',
          subject: 'competence-requirement:' + requirementId,
          at,
          details: requirementDetails(current),
        });
      });
    },

    /**
     * Administration › Kompetens › Krav: the organisation's share targets (D108 item 6), behind the capability and the
     * step-up. A target across the whole organisation is measured over it here, once, as a figure that names nobody
     * (D118), shown only over at least `COVERAGE_MIN_GROUP` people (`organisationOutcome`); a unit's target is measured
     * on that unit's read, for the manager who leads it. A target whose position or unit is gone is marked and counts
     * towards nothing.
     */
    async shareTargets(persona: AuthenticatedContext): Promise<CompetenceShareTargetsOutput> {
      await admin(persona);
      const today = swedishDay(now());
      return deps.store.transaction(async tx => {
        const org = persona.organisationId;
        const [rows, positions, units] = [await tx.shareTargets(org), await tx.positions(org), await tx.units(org)];
        const positionLabel = new Map(positions.map(p => [p.code, p.label])),
          unitLabel = new Map(units.map(u => [u.id, u.label]));
        const gone = (t: ShareTargetRecord) =>
          !positionLabel.has(t.positionCode) || (t.unitId !== null && !unitLabel.has(t.unitId));
        const measured = rows.filter(t => t.unitId === null && !gone(t));
        const holders = measured.length
          ? await tx.positionHolders(org, [...new Set(measured.map(t => t.positionCode))])
          : [];
        const holdings = await tx.holdingsOf([...new Set(holders.map(h => h.personId))]);
        const types = new Map(
          (
            await tx.typesById([
              ...new Set([...holdings.flatMap(h => (h.typeId ? [h.typeId] : [])), ...rows.map(t => t.typeId)]),
            ])
          ).map(t => [t.id, t]),
        );
        const met = new Set(
          deciding(holdings, types, today)
            .filter(meets)
            .map(s => s.personId + '\n' + s.type.id),
        );
        return {
          rows: rows.map((t): CompetenceShareTarget => {
            const type = types.get(t.typeId);
            const outcome =
              t.unitId === null && !gone(t) && type && type.archivedAt === null
                ? organisationOutcome(
                    t,
                    holders.filter(h => h.code === t.positionCode).map(h => h.personId),
                    personId => met.has(personId + '\n' + t.typeId),
                  )
                : undefined;
            return {
              id: t.id,
              typeId: t.typeId,
              positionCode: t.positionCode,
              positionLabel: positionLabel.get(t.positionCode) ?? t.positionCode,
              ...(t.unitId !== null ? { unitId: t.unitId, unitLabel: unitLabel.get(t.unitId) ?? t.unitId } : {}),
              minShare: t.minShare,
              ...(gone(t) ? { gone: true as const } : {}),
              ...(outcome ? { outcome } : {}),
            };
          }),
        };
      });
    },

    /**
     * An administrator adds a share target (D108 item 6): of the people who hold a position, at least a share in whole
     * percent hold a type, on a unit's branch or across the organisation. One per type, position and unit. Returns its id.
     */
    async addShareTarget(persona: AuthenticatedContext, body: CompetenceShareTargetBody): Promise<string> {
      await admin(persona);
      return insertShareTarget(persona.principal.id, persona.organisationId, body);
    },
    /** An operator adds a share target for an organisation, as the development seed does. */
    seedShareTarget: (actor: string, organisationId: string, body: CompetenceShareTargetBody) =>
      insertShareTarget(actor, organisationId, body),

    /** An administrator removes a share target. Audited with the ids and the share it carried. */
    async removeShareTarget(persona: AuthenticatedContext, targetId: string): Promise<void> {
      await admin(persona);
      const at = now().toISOString();
      await deps.store.transaction(async tx => {
        const current = await tx.shareTarget(targetId);
        if (!current || current.organisationId !== persona.organisationId) throw new CompetenceError(NO_TARGET);
        await tx.removeShareTarget(targetId);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.share_target_removed',
          subject: 'competence-share-target:' + targetId,
          at,
          details: targetDetails(current),
        });
      });
    },

    /**
     * The table behind a unit's row (D108 items 6 and 8): for a unit the reader manages, how its branch is covered, per
     * required type and per share target that applies. Counts over the branch (D99 item 5); names nobody. Anyone else is
     * refused.
     */
    async coverage(persona: AuthenticatedContext, unitId: string): Promise<UnitCoverageResult> {
      const { units, people } = await reports(persona);
      const unit = units.find(u => u.unitId === unitId);
      if (!unit) throw new ForbiddenError(NOT_YOUR_UNIT);
      const today = swedishDay(now());
      const covered = await deps.store.transaction(tx =>
        coverageIn(tx, persona, new Set(people.keys()), unitId, today),
      );
      return { unitId, unitLabel: unit.unitLabel, ...covered };
    },

    /**
     * What the read about a unit answers (D97, D108 item 8): for each asked unit the reader manages, its branch's
     * coverage. A unit where nothing is required of anyone and no share target applies has no row; a unit the reader
     * does not manage has none either, and is never a refusal.
     */
    async aboutUnits(persona: AuthenticatedContext, keys: readonly string[]): Promise<UnitCoverageResult[]> {
      const asked = new Set(keys);
      const managed = await reports(persona);
      const units = [
        ...new Map(managed.units.filter(u => asked.has(u.unitId)).map(u => [u.unitId, u] as const)).values(),
      ];
      if (!units.length) return [];
      const today = swedishDay(now());
      const own = new Set(managed.people.keys());
      return deps.store.transaction(async tx => {
        const rows: UnitCoverageResult[] = [];
        for (const unit of units) {
          const covered = await coverageIn(tx, persona, own, unit.unitId, today);
          if (covered.under || covered.targets.length)
            rows.push({ unitId: unit.unitId, unitLabel: unit.unitLabel, ...covered });
        }
        return rows;
      });
    },

    /**
     * The manager's matrix (D108 item 11): the people who report to the reader now against the types required of at
     * least one of them, at most ten columns at a time, with the sets of columns to choose from where more are required
     * (`matrixOf`). A manager's reports only (D99 item 4); anyone who manages nobody is refused. A read, so no audit row.
     */
    async matrix(persona: AuthenticatedContext, input: CompetenceMatrixInput = {}): Promise<CompetenceMatrixOutput> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER_MATRIX);
      const today = swedishDay(now());
      return deps.store.transaction(tx => matrixIn(tx, persona.organisationId, [...people.values()], today, input));
    },

    /**
     * The matrix as shown, as a file to download (D108 item 11): the same read as `matrix` with the same set of columns,
     * written as CSV. It names the manager's own reports, which is what it is for; its audit row, in the same
     * transaction, counts the people and the columns and names nobody, and so does its row of the read log (an export
     * by a manager, D108 item 15).
     */
    async exportMatrix(
      persona: AuthenticatedContext,
      input: CompetenceMatrixInput = {},
    ): Promise<{ filename: string; text: string }> {
      const { manages, people } = await reports(persona);
      if (!manages) throw new ForbiddenError(NOT_A_MANAGER_MATRIX);
      const at = now(),
        today = swedishDay(at);
      return deps.store.transaction(async tx => {
        const matrix = await matrixIn(tx, persona.organisationId, [...people.values()], today, input);
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.matrix_exported',
          subject: 'organisation:' + persona.organisationId,
          at: at.toISOString(),
          details: { people: matrix.rows.length, types: matrix.columns.length },
        });
        // An export of the reports' competence is a read of it (D108 item 15): logged beside its audit row, with the
        // number of people in the file and no type, since the file holds several.
        await tx.logRead(readOf(persona, at, 'managed', { kind: 'export', rows: matrix.rows.length }));
        return { filename: `kompetens-${today}.csv`, text: matrixCsv(matrix) };
      });
    },

    /**
     * Administration › Kompetens › Källor (D108 item 9): every system that answers the holdings profile now or has
     * been read, with its last read and its types among the organisation's copied rows, each with its mapping. Behind
     * the capability and the step-up, as the catalogue is.
     */
    async sources(persona: AuthenticatedContext): Promise<CompetenceSourcesOutput> {
      await admin(persona);
      const live = await answering();
      const at = now().toISOString();
      const read = await deps.store.transaction(async tx => ({
        records: new Map((await tx.sources()).map(s => [s.connectorId, s])),
        counted: await tx.sourceTypes(persona.organisationId),
        maps: await tx.mappings(persona.organisationId),
      }));
      const { records, counted, maps } = read;
      const names = new Map(live.map(s => [s.connectorId, s.source]));
      const candidates = new Set([
        ...live.map(s => s.connectorId),
        ...records.keys(),
        ...counted.map(c => c.connectorId),
        ...maps.map(m => m.connectorId),
      ]);
      // A source is shown only to an organisation that has someone in its audience and the module's (D23): to anyone
      // else the connector does not exist, here as everywhere.
      const ids: string[] = [];
      for (const connectorId of candidates)
        if (await reaches(connectorId, persona.organisationId)) ids.push(connectorId);
      {
        const rows = ids.map((connectorId): CompetenceSource => {
          const record = records.get(connectorId);
          const types = new Map<string, CompetenceSource['types'][number]>();
          for (const c of counted.filter(c => c.connectorId === connectorId))
            types.set(c.sourceType, { sourceType: c.sourceType, label: c.label, holdings: c.holdings });
          for (const m of maps.filter(m => m.connectorId === connectorId))
            types.set(m.sourceType, {
              ...(types.get(m.sourceType) ?? { sourceType: m.sourceType, label: m.sourceType, holdings: 0 }),
              typeId: m.typeId,
            });
          return {
            connectorId,
            source: names.get(connectorId) ?? record?.source ?? connectorId,
            answering: names.has(connectorId),
            reading: leased(record, at),
            // The outcome and the time are the source's; the counts are this organisation's own.
            ...(record?.outcome && record.startedAt && record.finishedAt && record.counts
              ? {
                  lastRead: {
                    startedAt: record.startedAt,
                    finishedAt: record.finishedAt,
                    outcome: record.outcome,
                    unmatched: record.counts.unmatched ?? 0,
                    counts: {
                      read: 0,
                      stored: 0,
                      unchanged: 0,
                      invalid: 0,
                      unmapped: 0,
                      revoked: 0,
                      outside: 0,
                      removed: 0,
                      ...record.counts.organisations?.[persona.organisationId],
                    },
                  },
                }
              : {}),
            types: [...types.values()].sort(
              (a, b) => a.label.localeCompare(b.label, 'sv') || a.sourceType.localeCompare(b.sourceType),
            ),
          };
        });
        return {
          rows: rows.sort(
            (a, b) => a.source.localeCompare(b.source, 'sv') || a.connectorId.localeCompare(b.connectorId),
          ),
        };
      }
    },

    /**
     * An administrator maps one type of a source to a catalogue type of their organisation, or removes the mapping
     * with `typeId: null` (D108 item 9). The rows already copied with it are re-typed in the same transaction, so they
     * count, or stop counting, at once. The same mapping again changes nothing and writes nothing.
     */
    async mapSourceType(
      persona: AuthenticatedContext,
      connectorId: string,
      body: CompetenceMappingBody,
    ): Promise<{ holdings: number }> {
      await admin(persona);
      return setMapping(persona.principal.id, persona.organisationId, connectorId, body, true);
    },
    /**
     * An operator maps a source's type for an organisation, as the development convenience script does. The source
     * need not have been read yet, so the first read is typed; the connector's row must exist.
     */
    seedMapping: (actor: string, organisationId: string, connectorId: string, body: CompetenceMappingBody) =>
      setMapping(actor, organisationId, connectorId, body, false),

    /**
     * An administrator's "Läs in nu" (D108 item 9): one run of the copy for one source, started with the transaction
     * that records the request. Refused while the source does not answer and while a read of it is under way.
     */
    async readNow(persona: AuthenticatedContext, connectorId: string): Promise<void> {
      await admin(persona);
      if (!(await answering(connectorId)).length || !(await reaches(connectorId, persona.organisationId)))
        throw new CompetenceError(NOT_ANSWERING);
      const at = now().toISOString(),
        run = deps.ids();
      await deps.store.transaction(async tx => {
        if (leased(await tx.source(connectorId), at)) throw new CompetenceError(READING);
        await tx.enqueue(readNowStart(run, connectorId, at));
        await tx.audit({
          actor: persona.principal.id,
          action: 'competence.read_requested',
          subject: 'connector:' + connectorId,
          at,
          details: { run },
        });
      });
    },

    /**
     * An operator asks for a run now (D108 item 9), of every source that answers or of the one named: started with the
     * transaction that records the request, and read by whichever instance of the server dequeues it. Returns the
     * workflow's id, which the operator's script waits on.
     */
    async requestRun(actor: string, connectorId?: string): Promise<{ run: string; workflowId: string; at: string }> {
      const at = now().toISOString(),
        run = deps.ids();
      const start = readNowStart(run, connectorId, at);
      await deps.store.transaction(async tx => {
        await tx.enqueue(start);
        await tx.audit({
          actor,
          action: 'competence.read_requested',
          subject: connectorId ? 'connector:' + connectorId : 'competence:sources',
          at,
          details: { run },
        });
      });
      return { run, workflowId: start.id, at };
    },
    /** The sources a run reads now (D108 item 9): every one that answers, or the one named; none while the module is off. */
    copySources: (only?: string | null) => answering(only),
    /** One run's read of one source; the workflow calls it once per source, the script for each. */
    copySource,
    /** Every source that answers, or the one named, one after another: what an operator's script runs. */
    async copyAll(actor: string, run: string, only?: string): Promise<CopyResult[]> {
      const results: CopyResult[] = [];
      for (const source of await answering(only)) results.push(await copySource(actor, run, source));
      return results;
    },
    /**
     * Ask for the next daily run (D108 item 9): one workflow per day at 04:00 in Sweden, by its id, so every instance
     * and every boot may ask and the engine keeps one. The engine's own row is the record: no audit row is written.
     */
    async scheduleCopy(): Promise<{ day: string; at: string }> {
      const next = nextDailyCopy(now());
      await deps.store.transaction(tx => tx.enqueue(dailyCopyStart(next.day, next.at)));
      return next;
    },
    /**
     * Remove everything one connector put in the register (D108 item 9): its copied rows, its mappings and its record.
     * The database does the same when an administrator removes the connector; this is the operator's way to do it for a
     * connector that stays. Audited with counts.
     */
    async forgetSource(actor: string, connectorId: string): Promise<{ holdings: number; mappings: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const forgotten = await tx.forgetSource(connectorId);
        await tx.audit({
          actor,
          action: 'competence.source_forgotten',
          subject: 'connector:' + connectorId,
          at,
          details: { ...forgotten },
        });
        return forgotten;
      });
    },

    /**
     * Erase one person from the domain (D108 item 14): their holdings, copied ones included, the requirements set on them
     * alone (item 6), and their id on the holdings they registered, revoked or decided for others. The cards of their own
     * registrations' approvals go from every manager's stream, and the approval cards in their own stream go too (item
     * 7). Only for a person the directory has deactivated: an active person is refused with `PersonStillActive`.
     * `actor` is the operator's.
     */
    async erasePerson(
      actor: string,
      personId: string,
    ): Promise<{ holdings: number; cleared: number; requirements: number; approvals: number }> {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        // Erasure is for a person the directory has deactivated (item 14): an active person's copied rows would come
        // back at the next read of their source, and their manager's attestations are still in use.
        if ((await tx.activeIds([personId])).has(personId)) throw new PersonStillActive();
        const [person] = await tx.persons([personId]);
        const erased = await tx.erasePerson(personId);
        // The cards of their registrations' approvals: by the approvals the rows name, and by the person the cards are
        // about, which also finds those of a registration they took back, whose row is gone.
        if (erased.threadIds.length) await tx.workItems.remove(erased.threadIds);
        if (person?.userName) await tx.workItems.removeAbout({ entity: 'person', key: person.userName });
        await tx.workItems.removeOwned(personId);
        const counted = {
          holdings: erased.holdings,
          cleared: erased.cleared,
          requirements: erased.requirements,
          approvals: erased.threadIds.length,
        };
        await tx.audit({
          actor,
          action: 'competence.person_erased',
          subject: 'person:' + personId,
          at,
          details: counted,
        });
        return counted;
      });
    },

    /** The whole domain of one organisation as one versioned document (D108 item 14). */
    async exportDomain(
      actor: string,
      organisationId: string,
    ): Promise<
      { format: typeof COMPETENCE_EXPORT_FORMAT; exportedAt: string; organisationId: string } & CompetenceExport
    > {
      const at = now().toISOString();
      return deps.store.transaction(async tx => {
        const data = await tx.exportOrganisation(organisationId);
        await tx.audit({
          actor,
          action: 'competence.exported',
          subject: 'organisation:' + organisationId,
          at,
          details: {
            types: data.types.length,
            holdings: data.holdings.length,
            mappings: data.mappings.length,
            requirements: data.requirements.length,
            shareTargets: data.shareTargets.length,
          },
        });
        return { format: COMPETENCE_EXPORT_FORMAT, exportedAt: at, organisationId, ...data };
      });
    },
  };
}
export type CompetenceUsecases = ReturnType<typeof competenceUsecases>;
